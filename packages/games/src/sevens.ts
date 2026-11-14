// Sevens (also Fan Tan, or Parliament): the whole deck is dealt. The 7 of diamonds starts. Each suit
// is built out from its 7: the 6 and then down to the ace on one side, the 8 and then up to the king
// on the other. On your turn play a card that fits, or pass if you can't (you must play if you can).
// First to get rid of every card wins.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  drinkingField,
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
  withDrinks,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
} from "./kit.js";

export interface SevensRules extends BaseRules {
  /** One hand, or points: cards left count against you, lowest when someone reaches the limit wins. */
  scoring: "single" | "points";
  limit: number;
  drinking: boolean;
}

export const classicSevens: SevensRules = { id: "sevens-classic", name: "Sevens", scoring: "single", limit: 50, drinking: false };
export const pointsSevens: SevensRules = { ...classicSevens, id: "sevens-points", name: "Points (to 50)", scoring: "points" };
export const drinkingSevens: SevensRules = { ...classicSevens, id: "sevens-drinking", name: "Drinking Sevens 🍺", drinking: true };

export interface SevensState {
  game: "sevens";
  rules: SevensRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  hands: KCard[][];
  /** Each suit's range on the table: lowest and highest rank played (ace low: 1), or null. */
  rows: Record<Suit, { low: number; high: number } | null>;
  turn: number;
  phase: "playing" | "scored" | "finished";
  passes: number[];
  out: number[];
  scores: number[];
  lastHand: { left: number[]; winner: number } | null;
  ready: boolean[];
  narration: string | null;
}

const suitOf = (c: KCard) => (c as { suit: Suit }).suit;
/** Ace low: A 1 … K 13. */
const low = (c: KCard) => ((c as { rank: number }).rank === 14 ? 1 : (c as { rank: number }).rank);
const label = (c: KCard) => `${rankLabel((c as { rank: number }).rank)}${SYMBOL[suitOf(c)]}`;
const cardAt = (suit: Suit, n: number): KCard => ({ kind: "pip", suit, rank: n === 1 ? 14 : n, id: `${n === 1 ? "A" : rankLabel(n)}${SYMBOL[suit]}` }) as KCard;

export function sevensLegal(s: SevensState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  const hand = s.hands[seat]!;
  // The very first card is the 7 of diamonds.
  if (Object.values(s.rows).every((r) => r === null)) return hand.filter((c) => suitOf(c) === "diamonds" && low(c) === 7);
  return hand.filter((c) => {
    const row = s.rows[suitOf(c)];
    if (!row) return low(c) === 7;
    return low(c) === row.low - 1 || low(c) === row.high + 1;
  });
}

function deal(s: SevensState) {
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hands = Array.from({ length: s.seats }, () => []);
  deck.forEach((c, i) => s.hands[(s.dealer + 1 + i) % s.seats]!.push(c));
  s.hands = s.hands.map((h) => sortCards(h));
  s.rows = { clubs: null, diamonds: null, hearts: null, spades: null };
  s.turn = s.hands.findIndex((h) => h.some((c) => suitOf(c) === "diamonds" && low(c) === 7));
  s.passes = Array(s.seats).fill(0);
  s.out = [];
  s.ready = Array(s.seats).fill(false);
  s.phase = "playing";
  s.narration = `${who(s.turn)} has the 7♦ and starts`;
}

export function newSevens(rules: SevensRules, seats: number, seed: number): SevensState {
  const s = { game: "sevens", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, scores: Array(seats).fill(0), lastHand: null } as unknown as SevensState;
  deal(s);
  return s;
}

const next = (s: SevensState, from: number) => {
  for (let k = 1; k <= s.seats; k++) {
    const n = (from + k) % s.seats;
    if (s.hands[n]!.length) return n;
  }
  return from;
};

type Move = { type: "play"; card: string } | { type: "pass" } | { type: "next" };

function apply(state: SevensState, seat: number, move: Move): SevensState {
  const s = clone(state);
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The hand isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = (s.dealer + 1) % s.seats;
      deal(s);
    }
    return s;
  }
  if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
  const legal = sevensLegal(s, seat);
  if (move.type === "pass") {
    if (legal.length) throw new GameError("You have a card that plays: you have to play it.");
    s.passes[seat]! += 1;
    s.narration = withDrinks(s.rules.drinking, `${who(seat)} passed`, [seat], 1);
    s.turn = next(s, seat);
    return s;
  }
  if (move.type !== "play") throw new GameError("That's not a move in Sevens.");
  const card = s.hands[seat]!.find((c) => c.id === move.card);
  if (!card) throw new GameError("You don't have that card.");
  if (!legal.some((c) => c.id === card.id)) throw new GameError(Object.values(s.rows).every((r) => !r) ? "The 7♦ starts." : "Play a 7, or the next card out from a 7 in the same suit.");
  s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
  const row = s.rows[suitOf(card)];
  s.rows[suitOf(card)] = row ? { low: Math.min(row.low, low(card)), high: Math.max(row.high, low(card)) } : { low: 7, high: 7 };
  s.narration = `${who(seat)} played the ${label(card)}`;
  if (!s.hands[seat]!.length) {
    s.out.push(seat);
    const left = s.hands.map((h) => h.length);
    const most = Math.max(...left);
    s.lastHand = { left, winner: seat };
    if (s.rules.scoring === "points") s.scores = s.scores.map((n, i) => n + left[i]!);
    else s.scores[seat]! += 1;
    // Drinking: the one stuck with the most cards drinks three.
    s.narration = withDrinks(s.rules.drinking, `${who(seat)} played the last card! 🎉`, left.flatMap((n, i) => (n === most && n > 0 ? [i] : [])), 3);
    s.ready = Array(s.seats).fill(false);
    const done = s.rules.scoring === "single" || s.scores.some((n) => n >= s.rules.limit);
    s.phase = done ? "finished" : "scored";
    return s;
  }
  s.turn = next(s, seat);
  return s;
}

function winners(s: SevensState): number[] {
  if (s.rules.scoring === "single") return s.lastHand ? [s.lastHand.winner] : [];
  const best = Math.min(...s.scores);
  return s.scores.flatMap((n, i) => (n === best ? [i] : []));
}

function view(s: SevensState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.phase === "playing" && s.turn === seat;
  const legal = sevensLegal(s, seat);
  const cells: (KCard | null)[] = [];
  const empty: number[] = [];
  for (const suit of ["spades", "hearts", "clubs", "diamonds"] as Suit[]) {
    const row = s.rows[suit];
    const vals = row ? [row.low < 7 ? row.low : null, 7, row.high > 7 ? row.high : null] : [null, null, null];
    for (const v of vals) {
      if (v === null) empty.push(cells.length);
      cells.push(v === null ? null : cardAt(suit, v));
    }
  }
  const w = over ? winners(s) : [];
  return {
    game: "sevens",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: mine && legal.length ? { type: "play", cards: legal.map((c) => c.id) } : null,
    pick: null,
    choices: mine && !legal.length ? { prompt: "Nothing fits.", options: [{ label: s.rules.drinking ? "Pass (and drink 🍺)" : "Pass", move: { type: "pass" }, primary: true }] } : s.phase === "scored" && !s.ready[seat] ? { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] } : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: s.passes[i] ? `Passed ${s.passes[i]}×` : "", dealer: i === s.dealer })),
    center: { kind: "board", cols: 3, cards: cells, empty, tap: null },
    melds: [],
    info: ["Build each suit out from its 7: down to the ace, up to the king", ...(s.rules.drinking ? ["🍺 Pass and drink 1; most cards left at the end drinks 3"] : []), ...(s.rules.scoring === "points" ? [`Lowest wins when someone reaches ${s.rules.limit}`] : [])],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? { key: `sevens-${s.hand}`, title: `${who(s.lastHand.winner)} went out first`, sides: s.scores.map((_, i) => [i]), rows: [{ label: "Cards left", values: s.lastHand.left.map(String) }, ...(s.rules.scoring === "points" ? [{ label: "Total", values: s.scores.map(String), tone: "total" as const }] : [])] }
        : null,
    over: over ? { winners: w, title: w.length > 1 ? "A tie!" : `${who(w[0]!)} wins!` } : null,
  };
}

function bot(s: SevensState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const legal = sevensLegal(s, seat);
  if (!legal.length) return { type: "pass" };
  if (Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  // Open up the side where I hold the most cards beyond it; hold back cards that only help others.
  const hand = s.hands[seat]!;
  const behind = (c: KCard) => {
    const v = low(c);
    const mine = hand.filter((x) => suitOf(x) === suitOf(c) && x.id !== c.id);
    if (v === 7) return mine.length;
    return mine.filter((x) => (v < 7 ? low(x) < v : low(x) > v)).length;
  };
  return { type: "play", card: [...legal].sort((a, b) => behind(b) - behind(a))[0]!.id };
}

export const sevens: CardGame<SevensRules, SevensState, Move> = {
  id: "sevens",
  name: "Sevens",
  emoji: "7️⃣",
  blurb: "Build out from the 7s",
  tagline: "Build each suit out from its 7, down to the ace and up to the king. Can't play? Pass. First out wins.",
  seats: { min: 3, max: 7, default: 4 },
  teams: false,
  presets: [classicSevens, pointsSevens, drinkingSevens],
  fields: [
    { key: "scoring", label: "Scoring", kind: "choice", options: [["single", "One hand: first out wins"], ["points", "Points: cards left count against you"]] },
    { key: "limit", label: "Points game ends at", kind: "choice", options: [[25, "25"], [50, "50"], [100, "100"]] },
    drinkingField<SevensRules>("Adults only. Pass and drink 1; whoever has the most cards left drinks 3 (or sips of water)."),
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SevensRules>;
    const base = [classicSevens, pointsSevens, drinkingSevens].find((p) => p.id === given.id) ?? classicSevens;
    const r = { ...base, ...given };
    return { ...r, limit: Number(r.limit), drinking: !!r.drinking };
  },
  validate: (r) => (["single", "points"].includes(r.scoring) ? [] : ["Pick a way to score."]),
  describe(r) {
    return [
      "The whole deck is dealt. Whoever has the 7♦ plays it first.",
      "Then each suit builds out from its 7: the 6, 5 … down to the ace on one side, the 8, 9 … up to the king on the other. Any 7 can start a new suit.",
      "On your turn play one card that fits. If one fits you have to play it; if none does, pass.",
      r.scoring === "single" ? "First to play every card wins." : `Cards left count against you each hand. When someone reaches ${r.limit}, the lowest total wins.`,
      ...(r.drinking ? ["🍺 Drinking mode: every pass is a sip, and whoever has the most cards left at the end drinks 3."] : []),
    ];
  },
  newGame: newSevens,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => (s.phase === "scored" ? 900 : thinkFor(sevensLegal(s, seat).length + 1, 0.7)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "sevens",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.rules.scoring === "points" ? s.scores.join(" · ") : s.hands.map((h) => h.length).join(" · ") + " cards",
      order: over ? (s.rules.scoring === "points" ? rankSeats(s.scores.map((score, i) => ({ seats: [i], score })), true) : rankSeats(s.lastHand!.left.map((score, i) => ({ seats: [i], score })), true)) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
