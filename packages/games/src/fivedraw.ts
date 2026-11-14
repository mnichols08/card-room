// Five Card Draw, for chips only: everyone antes, gets five cards, bets, swaps up to three, bets
// again, and the best hand takes the pot. Fixed-limit betting (10, then 20), so the buttons are just
// Fold, Check, Call and Raise. Run out of chips and you're out; the last one with chips, or the most
// chips after the set number of hands, wins.
import type { PlayStyle } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  nextHandChoices,
  nextRandom,
  rankSeats,
  shuffled,
  SUITS,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type Meld,
  type PipCard,
} from "./kit.js";
import { bestHand, bet, betChoices, chipsWord, decide, handName, lastStanding, newRound, nextToAct, pot, putIn, roundDone, settle, strengthOf, type Betting, type BetMove } from "./poker.js";

export interface DrawRules extends BaseRules {
  startChips: number;
  ante: number;
  /** The small bet (the second round's is double). */
  bet: number;
  /** Hands before the most chips wins; 0 plays until one player has them all. */
  hands: number;
}

export const friendlyDraw: DrawRules = { id: "draw-friendly", name: "Five Card Draw (20 hands)", startChips: 500, ante: 5, bet: 10, hands: 20 };
export const shortDraw: DrawRules = { ...friendlyDraw, id: "draw-short", name: "Quick (10 hands)", hands: 10 };
export const longDraw: DrawRules = { ...friendlyDraw, id: "draw-long", name: "Until one player has every chip", hands: 0 };

type Phase = "bet1" | "draw" | "bet2" | "scored" | "finished";

export interface DrawState {
  game: "fivedraw";
  rules: DrawRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  stock: KCard[];
  betting: Betting;
  /** In the draw: who has swapped, and how many each took. */
  drew: (number | null)[];
  /** The last showdown: what each showed (null if folded or out) and what each won. */
  showdown: { names: (string | null)[]; cards: (KCard[] | null)[]; won: number[]; uncontested: boolean } | null;
  ready: boolean[];
  narration: string | null;
}

const rankOf = (c: KCard) => (c as PipCard).rank;
/** With no hand limit the stakes double every ten hands, so the game always comes to an end. */
export const stakes = (r: DrawRules, hand: number) => (r.hands ? 1 : 2 ** Math.floor(hand / 10));
const sortHand = (cards: KCard[]) => [...cards].sort((a, b) => rankOf(a) - rankOf(b) || SUITS.indexOf((a as PipCard).suit) - SUITS.indexOf((b as PipCard).suit));

function deal(s: DrawState) {
  const b = s.betting;
  const seated = b.stacks.map((n) => n > 0);
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hands = b.stacks.map(() => []);
  let k = 0;
  for (let round = 0; round < 5; round++)
    for (let i = 1; i <= s.seats; i++) {
      const seat = (s.dealer + i) % s.seats;
      if (seated[seat]) s.hands[seat]!.push(deck[k++]!);
    }
  s.hands = s.hands.map(sortHand);
  s.stock = deck.slice(k);
  b.live = seated;
  b.committed = b.stacks.map(() => 0);
  b.roundBet = b.stacks.map(() => 0);
  b.acted = b.stacks.map(() => false);
  const x = stakes(s.rules, s.hand);
  for (let i = 0; i < s.seats; i++) if (seated[i]) putIn(b, i, s.rules.ante * x);
  newRound(b, s.rules.bet * x, (s.dealer + 1) % s.seats);
  s.drew = b.stacks.map(() => null);
  s.showdown = null;
  s.ready = b.stacks.map(() => false);
  s.phase = "bet1";
  s.narration = `Everyone antes ${s.rules.ante * x}${x > 1 && s.hand % 10 === 0 ? " (the stakes have gone up)" : ""}`;
  // Short stacks can be all in on the ante, leaving no one to bet.
  afterBet(s);
}

export function newDraw(rules: DrawRules, seats: number, seed: number): DrawState {
  const s = { game: "fivedraw", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats } as unknown as DrawState;
  s.betting = { stacks: Array.from({ length: seats }, () => rules.startChips), live: [], committed: [], roundBet: [], toMatch: 0, size: rules.bet, raises: 0, acted: [], turn: 0 };
  deal(s);
  return s;
}

/** After a betting move: on to the draw, the second round, or the showdown. */
function afterBet(s: DrawState) {
  const b = s.betting;
  const alone = lastStanding(b);
  if (alone !== null) {
    showdown(s, true);
    return;
  }
  if (!roundDone(b)) return;
  if (s.phase === "bet1") {
    s.phase = "draw";
    s.drew = s.drew.map((_, i) => (b.live[i] ? null : 0));
    s.narration = "The draw: swap up to three cards";
  } else showdown(s, false);
}

function showdown(s: DrawState, uncontested: boolean) {
  const b = s.betting;
  const scores = s.hands.map((h, i) => (b.live[i] && h.length === 5 ? bestHand(h).score : null));
  let won: number[];
  if (uncontested) {
    won = b.stacks.map(() => 0);
    const w = lastStanding(b)!;
    won[w] = pot(b);
    b.stacks[w]! += pot(b);
    s.narration = `Everyone else folded: ${who(w)} takes ${chipsWord(won[w]!)}`;
  } else {
    won = settle(b, scores, s.dealer);
    const top = won.indexOf(Math.max(...won));
    s.narration = `${who(top)} wins with ${handName(scores[top]!)}`;
  }
  s.showdown = { names: scores.map((sc) => (sc && !uncontested ? handName(sc) : null)), cards: s.hands.map((h, i) => (b.live[i] && !uncontested ? h : null)), won, uncontested };
  b.committed = b.committed.map(() => 0);
  s.ready = b.stacks.map(() => false);
  const left = b.stacks.filter((n) => n > 0).length;
  s.phase = left <= 1 || (s.rules.hands > 0 && s.hand + 1 >= s.rules.hands) ? "finished" : "scored";
}

type Move = BetMove | { type: "draw"; cards?: string[] } | { type: "next" };

function apply(state: DrawState, seat: number, move: Move): DrawState {
  const s = clone(state);
  const b = s.betting;
  switch (move.type) {
    case "next": {
      if (s.phase !== "scored") throw new GameError("The hand isn't over.");
      // Players out of chips are already ready.
      if (b.stacks[seat] === 0) throw new GameError("You're out of chips.");
      s.ready[seat] = true;
      if (b.stacks.every((n, i) => n === 0 || s.ready[i])) {
        s.hand += 1;
        // The deal moves to the next player with chips.
        s.dealer = nextToAct({ ...b, live: b.stacks.map((n) => n > 0) }, s.dealer) ?? s.dealer;
        deal(s);
      }
      return s;
    }
    case "draw": {
      if (s.phase !== "draw") throw new GameError("It's not the draw.");
      if (!b.live[seat]) throw new GameError("You're out of this hand.");
      if (s.drew[seat] !== null) throw new GameError("You've already drawn.");
      const ids = move.cards ?? [];
      if (ids.length > 3) throw new GameError("Swap three cards at most.");
      const away = ids.map((id) => s.hands[seat]!.find((c) => c.id === id));
      if (away.some((c) => !c) || new Set(ids).size !== ids.length) throw new GameError("Pick cards from your hand.");
      s.hands[seat] = sortHand([...s.hands[seat]!.filter((c) => !ids.includes(c.id)), ...s.stock.splice(0, ids.length)]);
      s.drew[seat] = ids.length;
      s.narration = `${who(seat)} ${ids.length ? `takes ${ids.length}` : "stands pat"}`;
      if (s.drew.every((d) => d !== null)) {
        s.phase = "bet2";
        newRound(b, s.rules.bet * 2 * stakes(s.rules, s.hand), (s.dealer + 1) % s.seats);
        afterBet(s);
      }
      return s;
    }
    case "fold":
    case "check":
    case "call":
    case "raise": {
      if (s.phase !== "bet1" && s.phase !== "bet2") throw new GameError("It's not time to bet.");
      const words = bet(b, seat, move);
      s.narration = `${who(seat)} ${words}`;
      afterBet(s);
      return s;
    }
    default:
      throw new GameError("That's not a move in Five Card Draw.");
  }
}

function winners(s: DrawState): number[] {
  const most = Math.max(...s.betting.stacks);
  return s.betting.stacks.map((n, i) => (n === most ? i : -1)).filter((i) => i >= 0);
}

function view(s: DrawState, seat: number): KitView {
  const b = s.betting;
  const over = s.phase === "finished";
  const betting = s.phase === "bet1" || s.phase === "bet2";
  const myBet = betting && b.turn === seat && b.live[seat] && b.stacks[seat]! > 0;
  const drawing = s.phase === "draw" && b.live[seat] && s.drew[seat] === null;
  const sd = s.showdown;
  const melds: Meld[] = sd && (s.phase === "scored" || over) ? sd.cards.flatMap((cards, i) => (cards && i !== seat ? [{ owner: i, label: `${sd.names[i]}${sd.won[i] ? `: wins ${sd.won[i]}` : ""}`, cards }] : [])) : [];
  const w = over ? winners(s) : [];
  return {
    game: "fivedraw",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: betting ? b.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: null,
    pick: drawing ? { min: 1, max: 3, prompt: "Pick up to three cards to swap", cards: s.hands[seat]!.map((c) => c.id), actions: [{ label: "Swap", type: "draw", primary: true }] } : null,
    choices: myBet
      ? { prompt: b.toMatch > b.roundBet[seat]! ? `${b.toMatch - b.roundBet[seat]!} to call` : "", options: betChoices(b, seat), layout: "row" }
      : drawing
        ? { prompt: "", options: [{ label: "Keep them all", move: { type: "draw", cards: [] } }] }
        : s.phase === "scored" && b.stacks[seat]! > 0
          ? nextHandChoices(s.ready, seat, false)
          : null,
    players: b.stacks.map((n, i) => ({
      cards: s.hands[i]!.length,
      line: n === 0 && !b.committed[i] && !b.live[i] ? "Out of chips" : `${n} chips`,
      dealer: i === s.dealer,
      out: !b.live[i] && (betting || s.phase === "draw"),
      badge: !b.live[i] ? (n === 0 && !b.committed[i] ? undefined : betting || s.phase === "draw" ? "Folded" : undefined) : b.stacks[i] === 0 && b.committed[i]! > 0 ? "All in" : betting && b.roundBet[i] ? `Bet ${b.roundBet[i]}` : s.phase === "draw" && s.drew[i] !== null ? (s.drew[i] ? `Took ${s.drew[i]}` : "Pat") : undefined,
    })),
    center: { kind: "none" },
    melds,
    info: [sd && !betting && s.phase !== "draw" ? `Pot was ${sd.won.reduce((a, n) => a + n, 0)}` : `Pot ${pot(b)}`, s.rules.hands ? `Hand ${s.hand + 1} of ${s.rules.hands}` : `Hand ${s.hand + 1}`, `Bets ${s.rules.bet * stakes(s.rules, s.hand)} and ${s.rules.bet * 2 * stakes(s.rules, s.hand)}`, "Chips only"],
    narration: s.narration,
    scores: b.stacks.map((n, i) => ({ seats: [i], value: n })),
    result:
      sd && (s.phase === "scored" || over)
        ? {
            key: `fivedraw-${s.hand}`,
            title: sd.uncontested ? "Everyone else folded" : "The showdown",
            sides: b.stacks.map((_, i) => [i]),
            rows: [
              ...(sd.uncontested ? [] : [{ label: "Hand", values: sd.names.map((n) => n ?? "Folded") }]),
              { label: "Won", values: sd.won.map((n) => (n ? `+${n}` : "0")), tone: "score" as const },
              { label: "Chips", values: b.stacks.map(String), tone: "total" as const },
            ],
          }
        : null,
    over: over ? { winners: w, title: w.length === 1 ? `${who(w[0]!)} wins with ${chipsWord(b.stacks[w[0]!]!)}` : "A tie for the most chips" } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** Which cards to swap: keep pairs and better, four to a flush or straight; else the two highest. */
export function drawPlan(hand: KCard[]): KCard[] {
  const score = bestHand(hand).score;
  const counts = new Map<number, KCard[]>();
  for (const c of hand) counts.set(rankOf(c), [...(counts.get(rankOf(c)) ?? []), c]);
  if (score[0]! >= 4) return []; // a straight or better: stand pat
  if (score[0]! >= 1) return hand.filter((c) => counts.get(rankOf(c))!.length === 1).slice(0, 3);
  for (const suit of SUITS) {
    const same = hand.filter((c) => (c as PipCard).suit === suit);
    if (same.length === 4) return hand.filter((c) => (c as PipCard).suit !== suit);
  }
  const ranks = [...new Set(hand.map(rankOf))].sort((a, b) => a - b);
  for (let i = 0; i + 3 < ranks.length + 0; i++) if (ranks[i + 3]! - ranks[i]! === 3) return hand.filter((c) => rankOf(c) < ranks[i]! || rankOf(c) > ranks[i + 3]!);
  return [...hand].sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 3);
}

function bot(s: DrawState, seat: number, style: PlayStyle): Move | null {
  const b = s.betting;
  if (s.phase === "scored") return b.stacks[seat]! > 0 && !s.ready[seat] ? { type: "next" } : null;
  if (s.phase === "draw") return b.live[seat] && s.drew[seat] === null ? { type: "draw", cards: drawPlan(s.hands[seat]!).map((c) => c.id) } : null;
  if ((s.phase !== "bet1" && s.phase !== "bet2") || b.turn !== seat || !b.live[seat]) return null;
  let strength = strengthOf(bestHand(s.hands[seat]!).score);
  // Before the draw, a hand can improve: count draws for a little.
  if (s.phase === "bet1" && drawPlan(s.hands[seat]!).length === 1) strength = Math.max(strength, 0.42);
  const sloppy = Math.random() < (style.sloppy ?? 0);
  return decide(b, seat, sloppy ? Math.random() : strength, Math.max(0, style.bold ?? 0.3));
}

export const fiveDraw: CardGame<DrawRules, DrawState, Move> = {
  id: "fivedraw",
  name: "Five Card Draw",
  emoji: "🎲",
  blurb: "Poker for chips: bet, swap, bet, show",
  tagline: "The friendliest poker: five cards, swap up to three, and the best hand takes the pot. Chips only.",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [friendlyDraw, shortDraw, longDraw],
  fields: [
    { key: "startChips", label: "Starting chips", kind: "choice", options: [[200, "200"], [500, "500"], [1000, "1,000"]] },
    { key: "hands", label: "Hands", kind: "choice", options: [[10, "10"], [20, "20"], [0, "Until one player has every chip"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<DrawRules>;
    const base = [friendlyDraw, shortDraw, longDraw].find((p) => p.id === given.id) ?? friendlyDraw;
    const merged = { ...base, ...given };
    return { ...merged, startChips: Math.max(50, Number(merged.startChips) || 500), hands: Math.max(0, Math.round(Number(merged.hands) || 0)) };
  },
  validate: (r) => (r.startChips >= 50 && r.startChips <= 100000 ? [] : ["Starting chips between 50 and 100,000."]),
  describe(r) {
    return [
      `Chips only: everyone starts with ${r.startChips}, and they're just for keeping score.`,
      `Everyone antes ${r.ante} and gets five cards. A round of betting: check, bet ${r.bet}, call, raise by ${r.bet}, or fold (four bets a round at most).`,
      `The draw: swap up to three of your cards for new ones, or keep them all. Then another round of betting, in ${r.bet * 2}s.`,
      "The showdown: the best hand takes the pot. High card, a pair, two pair, three of a kind, a straight, a flush, a full house, four of a kind, a straight flush.",
      r.hands ? `After ${r.hands} hands the most chips wins (or sooner, if one player has them all).` : "Run out of chips and you're out; the last player with chips wins. The ante and bets double every ten hands.",
    ];
  },
  newGame: newDraw,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "scored" ? 1500 : s.phase === "draw" ? 1400 : thinkFor(3, 1.2)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "fivedraw",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.betting.stacks.join(" · ") + " chips",
      order: over ? rankSeats(s.betting.stacks.map((n, i) => ({ seats: [i], score: n }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
