// Crazy Eights: match the top card by suit or rank, or play an eight (wild) and name the suit.
// Can't play? Draw. First to empty their hand wins the hand.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  markReady,
  nextRandom,
  rankLabel,
  rankSeats,
  shuffled,
  sortCards,
  SUITS,
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type PipCard,
} from "./kit.js";

export interface Crazy8Rules extends BaseRules {
  /** Draw until you can play, or draw one and pass if it doesn't play. */
  draw: "until" | "one";
  /** One hand (first out wins) or points: the winner scores what's left in everyone's hands, to 100. */
  scoring: "single" | "points";
  playTo: number;
  /** 2s make the next player draw two; queens skip the next player; aces reverse. */
  specials: boolean;
}

export const classicEights: Crazy8Rules = { id: "crazy8-classic", name: "Classic (one hand)", draw: "until", scoring: "single", playTo: 100, specials: false };
export const pointsEights: Crazy8Rules = { ...classicEights, id: "crazy8-points", name: "Points to 100", scoring: "points" };
export const partyEights: Crazy8Rules = { ...classicEights, id: "crazy8-party", name: "Party (2s, queens, aces)", draw: "one", specials: true };

type Phase = "playing" | "suit" | "scored" | "finished";

export interface Crazy8State {
  game: "crazy8";
  rules: Crazy8Rules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  stock: KCard[];
  discard: KCard[];
  /** The suit to match: the top card's, or the one named with an eight. */
  suit: Suit;
  turn: number;
  direction: 1 | -1;
  /** Cards the next player must draw (from 2s). */
  owed: number;
  /** This turn's player has drawn (under draw-one they may then pass). */
  drew: boolean;
  /** Turns in a row where nobody could play or draw anything: a full round ends the hand. */
  stuck: number;
  /** How often the discards have been shuffled into a new stock this hand (at most twice). */
  reshuffles: number;
  scores: number[];
  lastHand: { winner: number; points: number; left: number[] } | null;
  ready: boolean[];
  narration: string | null;
}

const rank = (c: KCard) => (c as PipCard).rank;
const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const top = (s: Crazy8State) => s.discard[s.discard.length - 1]!;
const cardPoints = (c: KCard) => (rank(c) === 8 ? 50 : rank(c) === 14 ? 1 : rank(c) >= 11 ? 10 : rank(c));
const step = (s: Crazy8State, from: number, by = 1) => (((from + s.direction * by) % s.seats) + s.seats) % s.seats;

/** Twice a hand at most: without a limit, a hand where only eights are left going round never ends. */
const MAX_RESHUFFLES = 2;

function refill(s: Crazy8State) {
  if (s.stock.length || s.discard.length <= 1 || s.reshuffles >= MAX_RESHUFFLES) return;
  s.reshuffles += 1;
  const keep = s.discard.pop()!;
  s.stock = shuffled(s.discard, nextRandom(s));
  s.discard = [keep];
}

function deal(s: Crazy8State) {
  const rand = nextRandom(s);
  const deck = shuffled(makeDeck({ ranks: FULL }), rand);
  const n = s.seats === 2 ? 7 : 5;
  s.hands = Array.from({ length: s.seats }, (_, i) => sortCards(deck.slice(i * n, (i + 1) * n)));
  let rest = deck.slice(s.seats * n);
  // Don't start on an eight: bury it.
  while (rank(rest[0]!) === 8) rest = [...rest.slice(1), rest[0]!];
  s.discard = [rest[0]!];
  s.stock = rest.slice(1);
  s.suit = suitOf(rest[0]!);
  s.turn = (s.dealer + 1) % s.seats;
  s.direction = 1;
  s.owed = 0;
  s.drew = false;
  s.stuck = 0;
  s.reshuffles = 0;
  s.ready = Array(s.seats).fill(false);
  s.phase = "playing";
  s.narration = null;
}

export function newCrazy8(rules: Crazy8Rules, seats: number, seed: number): Crazy8State {
  const s = { game: "crazy8", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, scores: Array(seats).fill(0), lastHand: null } as unknown as Crazy8State;
  deal(s);
  return s;
}

/** Cards this seat may play now: matching suit or rank, or any eight. Nothing while it owes a draw. */
export function crazy8Legal(s: Crazy8State, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat || s.owed > 0) return [];
  const t = top(s);
  return s.hands[seat]!.filter((c) => rank(c) === 8 || suitOf(c) === s.suit || rank(c) === rank(t));
}


/** Nothing to draw, now or after a reshuffle. */
const dry = (s: Crazy8State) => s.stock.length === 0 && (s.discard.length <= 1 || s.reshuffles >= MAX_RESHUFFLES);
const canDraw = (s: Crazy8State, seat: number) => s.phase === "playing" && s.turn === seat && (s.owed > 0 || (crazy8Legal(s, seat).length === 0 && !dry(s) && !(s.rules.draw === "one" && s.drew)));
const canPass = (s: Crazy8State, seat: number) => s.phase === "playing" && s.turn === seat && s.owed === 0 && crazy8Legal(s, seat).length === 0 && ((s.rules.draw === "one" && s.drew) || dry(s));

function endTurn(s: Crazy8State, skip = 0) {
  s.drew = false;
  s.turn = step(s, s.turn, 1 + skip);
}

type Move = { type: "play"; card: string } | { type: "suit"; suit: Suit } | { type: "draw" } | { type: "pass" } | { type: "next" };

function apply(state: Crazy8State, seat: number, move: Move): Crazy8State {
  const s = clone(state);
  switch (move.type) {
    case "next": {
      if (s.phase !== "scored") throw new GameError("The hand isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        s.dealer = (s.dealer + 1) % s.seats;
        deal(s);
      }
      return s;
    }
    case "draw": {
      if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
      if (!canDraw(s, seat)) throw new GameError(crazy8Legal(s, seat).length ? "You have a card that plays: play it." : "You've drawn: play it if you can, or pass.");
      const n = s.owed > 0 ? s.owed : 1;
      let got = 0;
      for (let i = 0; i < n; i++) {
        refill(s);
        const card = s.stock.pop();
        if (!card) break;
        s.hands[seat] = sortCards([...s.hands[seat]!, card]);
        got++;
      }
      if (s.owed > 0) {
        s.narration = `${who(seat)} drew ${got}`;
        s.owed = 0;
        endTurn(s);
        return s;
      }
      s.drew = true;
      s.narration = `${who(seat)} drew a card`;
      // Nothing left to draw and nothing to play: the turn passes.
      if (got === 0 && crazy8Legal(s, seat).length === 0) return blocked(s);
      return s;
    }
    case "pass": {
      if (!canPass(s, seat)) throw new GameError(crazy8Legal(s, seat).length ? "You have a card that plays." : "Draw a card first.");
      s.narration = `${who(seat)} passed`;
      if (dry(s)) return blocked(s);
      endTurn(s);
      return s;
    }
    case "suit": {
      if (s.phase !== "suit" || s.turn !== seat) throw new GameError("It's not time to name a suit.");
      if (!SUITS.includes(move.suit)) throw new GameError("That's not a suit.");
      s.suit = move.suit;
      s.phase = "playing";
      s.narration = `${who(seat)} played an eight: ${SYMBOL[move.suit]} now`;
      endTurn(s);
      return s;
    }
    case "play": {
      if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
      const card = s.hands[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      if (s.owed > 0) throw new GameError(`Draw ${s.owed} first.`);
      if (!crazy8Legal(s, seat).some((c) => c.id === card.id)) throw new GameError(`Match the ${SYMBOL[s.suit]} or a ${rankLabel(rank(top(s)))}, or play an eight.`);
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.discard.push(card);
      s.stuck = 0;
      s.suit = suitOf(card);
      if (s.hands[seat]!.length === 0) {
        scoreHand(s, seat);
        return s;
      }
      if (rank(card) === 8) {
        s.phase = "suit";
        return s;
      }
      s.narration = null;
      let skip = 0;
      if (s.rules.specials) {
        if (rank(card) === 2) {
          s.owed = 2;
          s.narration = `${who(seat)} played a 2: ${who(step(s, seat))} draws two`;
        } else if (rank(card) === 12) {
          skip = 1;
          s.narration = `${who(seat)} skipped ${who(step(s, seat))}`;
        } else if (rank(card) === 14) {
          if (s.seats === 2) skip = 1;
          else s.direction = s.direction === 1 ? -1 : 1;
          s.narration = `${who(seat)} reversed the direction`;
        }
      }
      endTurn(s, skip);
      return s;
    }
    default:
      throw new GameError("That's not a move in Crazy Eights.");
  }
}

/** Nobody can play and there's nothing to draw. After a full round of that, the lowest hand wins. */
function blocked(s: Crazy8State): Crazy8State {
  s.stuck += 1;
  if (s.stuck < s.seats) {
    endTurn(s);
    return s;
  }
  const left = s.hands.map((h) => h.reduce((n, c) => n + cardPoints(c), 0));
  const winner = left.indexOf(Math.min(...left));
  scoreHand(s, winner);
  s.narration = `Nobody can play: ${who(winner)} has the lowest hand and wins it`;
  return s;
}

function scoreHand(s: Crazy8State, winner: number) {
  const left = s.hands.map((h) => h.reduce((n, c) => n + cardPoints(c), 0));
  const points = left.reduce((a, b) => a + b, 0);
  if (s.rules.scoring === "points") s.scores[winner]! += points;
  else s.scores[winner]! += 1;
  s.lastHand = { winner, points, left };
  s.narration = `${who(winner)} went out! 🎉`;
  s.ready = Array(s.seats).fill(false);
  const done = s.rules.scoring === "single" || s.scores.some((n) => n >= s.rules.playTo);
  s.phase = done ? "finished" : "scored";
}

function winners(s: Crazy8State): number[] {
  if (s.rules.scoring === "single") return s.lastHand ? [s.lastHand.winner] : [];
  const best = Math.max(...s.scores);
  return s.scores.flatMap((n, i) => (n === best ? [i] : []));
}

function finishOrder(s: Crazy8State): number[] {
  if (s.rules.scoring === "points") return rankSeats(s.scores.map((score, i) => ({ seats: [i], score })));
  // One hand: the winner, then whoever holds the fewest points.
  const w = s.lastHand!.winner;
  return [w, ...rankSeats(s.hands.map((h, i) => ({ seats: [i], score: s.lastHand!.left[i]! })).filter((x) => x.seats[0] !== w), true)];
}

function view(s: Crazy8State, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.turn === seat && (s.phase === "playing" || s.phase === "suit");
  const legal = crazy8Legal(s, seat).map((c) => c.id);
  const options = [];
  if (s.phase === "suit" && s.turn === seat) for (const suit of SUITS) options.push({ label: SYMBOL[suit], move: { type: "suit", suit } });
  if (canPass(s, seat)) options.push({ label: "Pass", move: { type: "pass" } });
  return {
    game: "crazy8",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" || s.phase === "suit" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: s.phase === "playing" && s.turn === seat ? { type: "play", cards: legal } : null,
    pick: null,
    choices: options.length
      ? { prompt: s.phase === "suit" ? "Your eight: name the suit." : "Nothing plays.", options, layout: s.phase === "suit" ? "row" : undefined }
      : s.phase === "scored" && !s.ready[seat]
        ? { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] }
        : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: h.length === 1 ? "One card left!" : "", dealer: i === s.dealer })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.discard.slice(-3),
      discardCount: s.discard.length,
      drawMove: mine && canDraw(s, seat) ? { type: "draw" } : null,
      takeMove: null,
      note: s.suit !== suitOf(top(s)) ? `Suit: ${SYMBOL[s.suit]}` : null,
      ...(dry(s) ? { stockLabel: "No more to draw" } : {}),
    },
    melds: [],
    info: [
      `Match ${SYMBOL[s.suit]} or ${rankLabel(rank(top(s)))} · 8s are wild`,
      ...(s.owed > 0 ? [`${who(s.turn)} draws ${s.owed}`] : []),
      ...(s.rules.specials && s.seats > 2 ? [s.direction === 1 ? "Play goes left ↻" : "Play goes right ↺"] : []),
      ...(s.rules.scoring === "points" ? [`To ${s.rules.playTo}`] : []),
    ],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `crazy8-${s.hand}`,
            title: `${who(s.lastHand.winner)} went out!`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "Left in hand", values: s.lastHand.left.map((n, i) => (i === s.lastHand!.winner ? "—" : String(n))) },
              ...(s.rules.scoring === "points" ? [{ label: "Score", values: s.scores.map(String), tone: "total" as const }] : []),
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: `${who(winners(s)[0]!)} wins!` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: Crazy8State, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const hand = s.hands[seat]!;
  const count = (suit: Suit) => hand.filter((c) => suitOf(c) === suit && rank(c) !== 8).length;
  if (s.phase === "suit") return { type: "suit", suit: [...SUITS].sort((a, b) => count(b) - count(a))[0]! };
  if (s.phase !== "playing") return null;
  const legal = crazy8Legal(s, seat);
  if (!legal.length) return canDraw(s, seat) ? { type: "draw" } : canPass(s, seat) ? { type: "pass" } : null;
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  if (sloppy) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  const next = step(s, seat);
  const nextLow = s.hands[next]!.length <= 2;
  const value = (c: KCard) => {
    if (rank(c) === 8) return hand.length === 1 ? 100 : -50; // keep eights for when nothing else plays
    let v = count(suitOf(c)) * 3 + rank(c) / 10; // play from your long suit, shed high cards first
    if (s.rules.specials && nextLow && (rank(c) === 2 || rank(c) === 12)) v += 20;
    return v;
  };
  return { type: "play", card: [...legal].sort((a, b) => value(b) - value(a))[0]!.id };
}

export const crazy8: CardGame<Crazy8Rules, Crazy8State, Move> = {
  id: "crazy8",
  name: "Crazy Eights",
  emoji: "8️⃣",
  blurb: "Match the card; eights are wild",
  tagline: "Match the top card by suit or number. Eights are wild. First one out wins.",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [classicEights, pointsEights, partyEights],
  fields: [
    { key: "draw", label: "When you can't play", kind: "choice", options: [["until", "Draw until you can"], ["one", "Draw one, then pass"]] },
    { key: "scoring", label: "Scoring", kind: "choice", options: [["single", "One hand: first out wins"], ["points", "Points: winner scores what's left"]] },
    { key: "playTo", label: "Points game to", kind: "choice", options: [[50, "50"], [100, "100"], [200, "200"]] },
    { key: "specials", label: "Party cards", hint: "2s make the next player draw two, queens skip, aces reverse.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<Crazy8Rules>;
    const base = [classicEights, pointsEights, partyEights].find((p) => p.id === given.id) ?? classicEights;
    return { ...base, ...given };
  },
  validate(r) {
    const errors: string[] = [];
    if (!["until", "one"].includes(r.draw)) errors.push("Pick a drawing rule.");
    if (!["single", "points"].includes(r.scoring)) errors.push("Pick a way to score.");
    if (!(r.playTo >= 25 && r.playTo <= 500)) errors.push("Play to between 25 and 500.");
    return errors;
  },
  describe(r) {
    return [
      "Seven cards each for two players, five for more. Match the top card by suit or by number.",
      "Eights are wild: play one any time and name the suit that comes next.",
      r.draw === "until" ? "Can't play? Draw until you can." : "Can't play? Draw one; if it still doesn't play, pass.",
      ...(r.specials ? ["A 2 makes the next player draw two. A queen skips the next player. An ace reverses the direction."] : []),
      r.scoring === "single" ? "First to get rid of every card wins." : `The first one out scores the cards left in everyone's hands (8s 50, faces 10, aces 1, others face value). First to ${r.playTo} wins.`,
    ];
  },
  newGame: newCrazy8,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "scored") return 900;
    if (s.phase === "suit") return 1100;
    return thinkFor(crazy8Legal(s, seat).length, 0.8);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "crazy8",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.rules.scoring === "points" ? s.scores.join(" · ") : s.hands.map((h) => h.length).join(" · ") + " cards",
      order: over ? finishOrder(s) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
