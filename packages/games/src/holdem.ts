// Texas Hold'em, for chips only: two cards each, five shared on the board (the flop, the turn, the
// river), and the best five of your seven win. Blinds, fixed-limit betting (one size before and on
// the flop, double on the turn and river). 20 hands, or until one player has every chip.
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

export interface HoldemRules extends BaseRules {
  startChips: number;
  /** The big blind; the small blind is half. Bets are this size before and on the flop, double after. */
  blind: number;
  /** Hands before the most chips wins; 0 plays until one player has them all (blinds double every ten hands). */
  hands: number;
}

export const friendlyHoldem: HoldemRules = { id: "holdem-friendly", name: "Texas Hold'em (20 hands)", startChips: 500, blind: 10, hands: 20 };
export const shortHoldem: HoldemRules = { ...friendlyHoldem, id: "holdem-short", name: "Quick (10 hands)", hands: 10 };
export const longHoldem: HoldemRules = { ...friendlyHoldem, id: "holdem-long", name: "Until one player has every chip", hands: 0 };

type Street = "preflop" | "flop" | "turn" | "river";
type Phase = Street | "scored" | "finished";
const STREETS: Street[] = ["preflop", "flop", "turn", "river"];

export interface HoldemState {
  game: "holdem";
  rules: HoldemRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hole: KCard[][];
  board: KCard[];
  stock: KCard[];
  betting: Betting;
  blinds: [number, number];
  showdown: { names: (string | null)[]; cards: (KCard[] | null)[]; won: number[]; uncontested: boolean } | null;
  ready: boolean[];
  narration: string | null;
}

const rankOf = (c: KCard) => (c as PipCard).rank;
const suitOf = (c: KCard) => (c as PipCard).suit;
export const holdemStakes = (r: HoldemRules, hand: number) => (r.hands ? 1 : 2 ** Math.floor(hand / 10));
const big = (s: HoldemState) => s.rules.blind * holdemStakes(s.rules, s.hand);

/** The next seat after `from` that's dealt in this hand. */
function nextIn(s: HoldemState, from: number): number {
  for (let i = 1; i <= s.seats; i++) {
    const seat = (from + i) % s.seats;
    if (s.betting.live[seat]) return seat;
  }
  return from;
}

function deal(s: HoldemState) {
  const b = s.betting;
  const seated = b.stacks.map((n) => n > 0);
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hole = b.stacks.map(() => []);
  let k = 0;
  for (let round = 0; round < 2; round++)
    for (let i = 1; i <= s.seats; i++) {
      const seat = (s.dealer + i) % s.seats;
      if (seated[seat]) s.hole[seat]!.push(deck[k++]!);
    }
  s.stock = deck.slice(k);
  s.board = [];
  b.live = seated;
  b.committed = b.stacks.map(() => 0);
  b.roundBet = b.stacks.map(() => 0);
  b.acted = b.stacks.map(() => false);
  const players = seated.filter(Boolean).length;
  // Heads up, the dealer is the small blind; otherwise the two players after the dealer.
  const sb = players === 2 ? s.dealer : nextIn(s, s.dealer);
  const bb = nextIn(s, sb);
  s.blinds = [sb, bb];
  newRound(b, big(s), nextIn(s, bb));
  putIn(b, sb, big(s) / 2);
  putIn(b, bb, big(s));
  b.toMatch = big(s);
  b.turn = nextToAct(b, bb) ?? bb;
  s.showdown = null;
  s.ready = b.stacks.map(() => false);
  s.phase = "preflop";
  s.narration = `Blinds ${big(s) / 2} and ${big(s)}${holdemStakes(s.rules, s.hand) > 1 && s.hand % 10 === 0 ? " (the blinds have gone up)" : ""}`;
  afterBet(s);
}

export function newHoldem(rules: HoldemRules, seats: number, seed: number): HoldemState {
  const s = { game: "holdem", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats } as unknown as HoldemState;
  s.betting = { stacks: Array.from({ length: seats }, () => rules.startChips), live: [], committed: [], roundBet: [], toMatch: 0, size: rules.blind, raises: 0, acted: [], turn: 0 };
  deal(s);
  return s;
}

/** After a betting move (or a deal): the next street, the showdown, or nothing yet. */
function afterBet(s: HoldemState) {
  const b = s.betting;
  for (let guard = 0; guard < 5; guard++) {
    if (lastStanding(b) !== null) return showdown(s, true);
    if (!roundDone(b)) return;
    const street = STREETS.indexOf(s.phase as Street);
    if (street === 3) return showdown(s, false);
    const next = STREETS[street + 1]!;
    s.board.push(...s.stock.splice(0, next === "flop" ? 3 : 1));
    s.phase = next;
    newRound(b, big(s) * (next === "flop" ? 1 : 2), nextIn(s, s.dealer));
    s.narration = next === "flop" ? "The flop" : next === "turn" ? "The turn" : "The river";
    // If everyone (or all but one) is all in, the rest of the board comes out on its own.
  }
}

function showdown(s: HoldemState, uncontested: boolean) {
  const b = s.betting;
  // All-in players see the whole board.
  if (!uncontested) while (s.board.length < 5) s.board.push(s.stock.shift()!);
  const scores = s.hole.map((h, i) => (b.live[i] && h.length === 2 && !uncontested ? bestHand([...h, ...s.board]).score : null));
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
  s.showdown = { names: scores.map((sc) => (sc ? handName(sc) : null)), cards: s.hole.map((h, i) => (scores[i] ? h : null)), won, uncontested };
  b.committed = b.committed.map(() => 0);
  s.ready = b.stacks.map(() => false);
  const left = b.stacks.filter((n) => n > 0).length;
  s.phase = left <= 1 || (s.rules.hands > 0 && s.hand + 1 >= s.rules.hands) ? "finished" : "scored";
}

type Move = BetMove | { type: "next" };

function apply(state: HoldemState, seat: number, move: Move): HoldemState {
  const s = clone(state);
  const b = s.betting;
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The hand isn't over.");
    if (b.stacks[seat] === 0) throw new GameError("You're out of chips.");
    s.ready[seat] = true;
    if (b.stacks.every((n, i) => n === 0 || s.ready[i])) {
      s.hand += 1;
      s.dealer = nextToAct({ ...b, live: b.stacks.map((n) => n > 0) }, s.dealer) ?? s.dealer;
      deal(s);
    }
    return s;
  }
  if (!STREETS.includes(s.phase as Street)) throw new GameError("It's not time to bet.");
  if (!["fold", "check", "call", "raise"].includes(move.type)) throw new GameError("That's not a move in Hold'em.");
  const words = bet(b, seat, move);
  s.narration = `${who(seat)} ${words}`;
  afterBet(s);
  return s;
}

function winners(s: HoldemState): number[] {
  const most = Math.max(...s.betting.stacks);
  return s.betting.stacks.map((n, i) => (n === most ? i : -1)).filter((i) => i >= 0);
}

function view(s: HoldemState, seat: number): KitView {
  const b = s.betting;
  const over = s.phase === "finished";
  const betting = STREETS.includes(s.phase as Street);
  const myBet = betting && b.turn === seat && b.live[seat] && b.stacks[seat]! > 0;
  const sd = s.showdown;
  const melds: Meld[] = sd && (s.phase === "scored" || over) ? sd.cards.flatMap((cards, i) => (cards && i !== seat ? [{ owner: i, label: `${sd.names[i]}${sd.won[i] ? `: wins ${sd.won[i]}` : ""}`, cards }] : [])) : [];
  const mine = s.hole[seat]!;
  const myBest = mine.length === 2 && s.board.length >= 3 && b.live[seat] ? handName(bestHand([...mine, ...s.board]).score) : null;
  const w = over ? winners(s) : [];
  return {
    game: "holdem",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: betting ? b.turn : null,
    dealer: s.dealer,
    hand: mine,
    tap: null,
    pick: null,
    choices: myBet ? { prompt: b.toMatch > b.roundBet[seat]! ? `${b.toMatch - b.roundBet[seat]!} to call` : "", options: betChoices(b, seat), layout: "row" } : s.phase === "scored" && b.stacks[seat]! > 0 ? nextHandChoices(s.ready, seat, false) : null,
    players: b.stacks.map((n, i) => ({
      cards: s.hole[i]!.length,
      line: n === 0 && !b.committed[i] && !b.live[i] ? "Out of chips" : `${n} chips`,
      dealer: i === s.dealer,
      out: betting && !b.live[i],
      badge: betting && !b.live[i] && (n > 0 || b.committed[i]) ? "Folded" : b.live[i] && n === 0 && b.committed[i]! > 0 ? "All in" : betting && b.roundBet[i] ? `${i === s.blinds[0] && s.phase === "preflop" && b.roundBet[i] === big(s) / 2 ? "Small blind" : i === s.blinds[1] && s.phase === "preflop" && b.roundBet[i] === big(s) ? "Big blind" : `Bet ${b.roundBet[i]}`}` : undefined,
    })),
    center: {
      kind: "piles",
      stock: null,
      discard: s.board,
      discardCount: s.board.length,
      drawMove: null,
      takeMove: null,
      spread: { type: "none", cards: [] },
      discardLabel: s.board.length ? (myBest ? `You have ${myBest}` : "The board") : "The board",
    },
    melds,
    info: [sd && !betting ? `Pot was ${sd.won.reduce((a, n) => a + n, 0)}` : `Pot ${pot(b)}`, s.rules.hands ? `Hand ${s.hand + 1} of ${s.rules.hands}` : `Hand ${s.hand + 1}`, `Blinds ${big(s) / 2}/${big(s)}`, "Chips only"],
    narration: s.narration,
    scores: b.stacks.map((n, i) => ({ seats: [i], value: n })),
    result:
      sd && (s.phase === "scored" || over)
        ? {
            key: `holdem-${s.hand}`,
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

/** Two hole cards before the flop: pairs, high cards, suited and connected ones. */
export function preflopStrength(hole: KCard[]): number {
  const [a, c] = hole.map(rankOf).sort((x, y) => y - x) as [number, number];
  if (a === c) return 0.5 + ((a - 2) / 12) * 0.45;
  let v = ((a + c - 4) / 24) * 0.45;
  if (suitOf(hole[0]!) === suitOf(hole[1]!)) v += 0.06;
  if (a - c === 1) v += 0.05;
  if (a === 14) v += 0.08;
  return Math.min(0.85, v);
}

/** After the flop: the made hand, less when the board makes it alone, more for a good draw. */
function postflopStrength(hole: KCard[], board: KCard[]): number {
  const best = bestHand([...hole, ...board]).score;
  let v = strengthOf(best);
  // A pair or trips on the board isn't yours.
  const counts = new Map<number, number>();
  for (const c of board) counts.set(rankOf(c), (counts.get(rankOf(c)) ?? 0) + 1);
  const boardCat = Math.max(...counts.values()) >= 3 ? 3 : [...counts.values()].filter((n) => n === 2).length >= 2 ? 2 : [...counts.values()].some((n) => n === 2) ? 1 : 0;
  if (best[0]! <= boardCat) v = 0.18;
  if (board.length < 5) {
    const all = [...hole, ...board];
    const flushDraw = ["spades", "hearts", "diamonds", "clubs"].some((su) => all.filter((x) => suitOf(x) === su).length === 4);
    if (flushDraw) v = Math.max(v, 0.45);
  }
  return v;
}

function bot(s: HoldemState, seat: number, style: PlayStyle): Move | null {
  const b = s.betting;
  if (s.phase === "scored") return b.stacks[seat]! > 0 && !s.ready[seat] ? { type: "next" } : null;
  if (!STREETS.includes(s.phase as Street) || b.turn !== seat || !b.live[seat]) return null;
  const strength = s.board.length ? postflopStrength(s.hole[seat]!, s.board) : preflopStrength(s.hole[seat]!);
  const sloppy = Math.random() < (style.sloppy ?? 0);
  return decide(b, seat, sloppy ? Math.random() : strength, Math.max(0, style.bold ?? 0.3));
}

export const holdem: CardGame<HoldemRules, HoldemState, Move> = {
  id: "holdem",
  name: "Texas Hold'em",
  emoji: "♣️",
  blurb: "Two cards, five on the board, chips only",
  tagline: "Two cards of your own, five on the board for everyone, and the best five win. Chips only.",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [friendlyHoldem, shortHoldem, longHoldem],
  fields: [
    { key: "startChips", label: "Starting chips", kind: "choice", options: [[200, "200"], [500, "500"], [1000, "1,000"]] },
    { key: "hands", label: "Hands", kind: "choice", options: [[10, "10"], [20, "20"], [0, "Until one player has every chip"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<HoldemRules>;
    const base = [friendlyHoldem, shortHoldem, longHoldem].find((p) => p.id === given.id) ?? friendlyHoldem;
    const merged = { ...base, ...given };
    return { ...merged, startChips: Math.max(50, Number(merged.startChips) || 500), hands: Math.max(0, Math.round(Number(merged.hands) || 0)) };
  },
  validate: (r) => (r.startChips >= 50 && r.startChips <= 100000 ? [] : ["Starting chips between 50 and 100,000."]),
  describe(r) {
    return [
      `Chips only: everyone starts with ${r.startChips}, and they're just for keeping score.`,
      `Two cards each, face down. The two players after the dealer put in blinds of ${r.blind / 2} and ${r.blind}, then a round of betting: call, raise by ${r.blind}, or fold (four bets a round at most).`,
      `Three cards are dealt face up for everyone (the flop), then a fourth (the turn), then a fifth (the river), with betting after each: ${r.blind}s on the flop, ${r.blind * 2}s on the turn and river.`,
      "The showdown: your best five of your two and the five on the board. The best hand takes the pot.",
      r.hands ? `After ${r.hands} hands the most chips wins (or sooner, if one player has them all).` : "Run out of chips and you're out; the last player with chips wins. The blinds double every ten hands.",
    ];
  },
  newGame: newHoldem,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "scored" ? 1500 : thinkFor(3, 1.2)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "holdem",
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
