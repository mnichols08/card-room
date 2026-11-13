// Oh Hell (Up and Down the River): every hand you bid exactly how many tricks you'll take, and only
// an exact bid scores. Hand sizes climb one card at a time and come back down; the turned-up card
// after the deal is trump. The dealer bids last and can't make the bids add up to the tricks.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  markReady,
  nextRandom,
  rankSeats,
  shuffled,
  sortCards,
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type PipCard,
} from "./kit.js";
import { bestLoser, cheapestWinner, following, trickWinner, type Play } from "./tricks.js";

export interface OhHellRules extends BaseRules {
  /** The hands, by cards dealt: up from 1 then back down, the reverse, or only down. */
  order: "up-down" | "down-up" | "down";
  /** The most cards in a hand (fewer when there aren't enough cards for everyone). */
  maxCards: number;
  /** The dealer can't bid so the bids add up to the tricks in the hand. */
  hook: boolean;
  /** Exact: 10 + your bid. Tricks: a point a trick, +10 for exact. Penalty: 10 + bid, or lose 5 for each trick you're off. */
  scoring: "exact" | "tricks" | "penalty";
}

export const riverOhHell: OhHellRules = { id: "ohhell-river", name: "Up and Down the River", order: "up-down", maxCards: 7, hook: true, scoring: "exact" };
export const longOhHell: OhHellRules = { ...riverOhHell, id: "ohhell-long", name: "The long river (to 10)", maxCards: 10 };
export const quickOhHell: OhHellRules = { ...riverOhHell, id: "ohhell-quick", name: "Down the river (quick)", order: "down", maxCards: 7, scoring: "tricks" };

type Phase = "bidding" | "playing" | "scored" | "finished";

export interface OhHellState {
  game: "ohhell";
  rules: OhHellRules;
  seats: number;
  rng: number;
  /** Cards dealt in each hand, in order. */
  plan: number[];
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  trumpCard: KCard | null;
  bids: (number | null)[];
  trick: Play[];
  lastTrick: { plays: Play[]; winner: number } | null;
  turn: number;
  tricksWon: number[];
  scores: number[];
  lastHand: { bids: number[]; took: number[]; points: number[] } | null;
  ready: boolean[];
  narration: string | null;
}

const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const power = (c: KCard) => (c as PipCard).rank;
const trumpOf = (s: OhHellState): Suit | null => (s.trumpCard ? suitOf(s.trumpCard) : null);

/** The cards dealt in each hand. Everyone gets the same; one card is left to turn up for trump when it can be. */
export function riverPlan(rules: OhHellRules, seats: number): number[] {
  const most = Math.max(1, Math.min(rules.maxCards, Math.floor(51 / seats)));
  const up = Array.from({ length: most }, (_, i) => i + 1);
  const down = [...up].reverse();
  if (rules.order === "down") return down;
  if (rules.order === "down-up") return [...down, ...up.slice(1)];
  return [...up, ...down.slice(1)];
}

function deal(s: OhHellState) {
  const rand = nextRandom(s);
  const deck = shuffled(makeDeck({ ranks: FULL }), rand);
  const n = s.plan[s.hand]!;
  s.hands = Array.from({ length: s.seats }, (_, i) => sortCards(deck.slice(i * n, (i + 1) * n)));
  s.trumpCard = deck[s.seats * n] ?? null;
  s.bids = Array(s.seats).fill(null);
  s.trick = [];
  s.lastTrick = null;
  s.tricksWon = Array(s.seats).fill(0);
  s.ready = Array(s.seats).fill(false);
  s.phase = "bidding";
  s.turn = (s.dealer + 1) % s.seats;
  s.narration = s.trumpCard ? `${rankName(s.trumpCard)} turned up: ${SYMBOL[suitOf(s.trumpCard)]} are trump` : "No trump this hand";
}
const rankName = (c: KCard) => `${(c as PipCard).rank > 10 ? ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[(c as PipCard).rank] : (c as PipCard).rank}${SYMBOL[suitOf(c)]}`;

export function newOhHell(rules: OhHellRules, seats: number, seed: number): OhHellState {
  const s: OhHellState = {
    game: "ohhell",
    rules,
    seats,
    rng: seed >>> 0,
    plan: riverPlan(rules, seats),
    hand: 0,
    dealer: seed % seats,
    phase: "bidding",
    hands: [],
    trumpCard: null,
    bids: [],
    trick: [],
    lastTrick: null,
    turn: 0,
    tricksWon: [],
    scores: Array(seats).fill(0),
    lastHand: null,
    ready: [],
    narration: null,
  };
  deal(s);
  return s;
}

/** The bids this seat may make now: 0 to the hand size, without the dealer's forbidden one. */
export function allowedBids(s: OhHellState, seat: number): number[] {
  if (s.phase !== "bidding" || s.turn !== seat) return [];
  const n = s.plan[s.hand]!;
  const all = Array.from({ length: n + 1 }, (_, i) => i);
  const last = seat === s.dealer;
  if (!last || !s.rules.hook) return all;
  const sofar = s.bids.reduce<number>((a, b) => a + (b ?? 0), 0);
  return all.filter((b) => sofar + b !== n);
}

export function ohHellLegal(s: OhHellState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  return following(s.hands[seat]!, s.trick, suitOf);
}

type Move = { type: "bid"; bid: number } | { type: "play"; card: string } | { type: "next" };

function apply(state: OhHellState, seat: number, move: Move): OhHellState {
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
  if (move.type === "bid") {
    if (s.phase !== "bidding") throw new GameError("It's not time to bid.");
    if (s.turn !== seat) throw new GameError("It's not your turn to bid.");
    if (!allowedBids(s, seat).includes(move.bid)) {
      throw new GameError(move.bid >= 0 && move.bid <= s.plan[s.hand]! ? `The dealer can't bid ${move.bid}: the bids would add up to the tricks.` : "That's not a bid.");
    }
    s.bids[seat] = move.bid;
    s.narration = `${who(seat)} bid ${move.bid}`;
    if (s.bids.every((b) => b !== null)) {
      s.phase = "playing";
      s.turn = (s.dealer + 1) % s.seats;
    } else s.turn = (seat + 1) % s.seats;
    return s;
  }
  if (move.type !== "play") throw new GameError("That's not a move in Oh Hell.");
  if (s.phase !== "playing") throw new GameError("It's not time to play.");
  if (s.turn !== seat) throw new GameError("It's not your turn.");
  const card = s.hands[seat]!.find((c) => c.id === move.card);
  if (!card) throw new GameError("You don't have that card.");
  if (!ohHellLegal(s, seat).some((c) => c.id === card.id)) throw new GameError(`Follow suit: play a ${SYMBOL[suitOf(s.trick[0]!.card)]} if you have one.`);
  if (!s.trick.length) s.lastTrick = null;
  s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
  s.trick.push({ seat, card });
  s.narration = null;
  if (s.trick.length < s.seats) {
    s.turn = (seat + 1) % s.seats;
    return s;
  }
  const win = trickWinner(s.trick, trumpOf(s), suitOf, power);
  s.tricksWon[win.seat]! += 1;
  s.lastTrick = { plays: s.trick, winner: win.seat };
  s.trick = [];
  s.turn = win.seat;
  if (s.hands.every((h) => h.length === 0)) scoreHand(s);
  return s;
}

export function handPoints(rules: OhHellRules, bid: number, took: number): number {
  const exact = bid === took;
  if (rules.scoring === "tricks") return took + (exact ? 10 : 0);
  if (rules.scoring === "penalty") return exact ? 10 + bid : -5 * Math.abs(bid - took);
  return exact ? 10 + bid : 0;
}

function scoreHand(s: OhHellState) {
  const bids = s.bids.map((b) => b ?? 0);
  const points = bids.map((b, i) => handPoints(s.rules, b, s.tricksWon[i]!));
  s.scores = s.scores.map((n, i) => n + points[i]!);
  s.lastHand = { bids, took: [...s.tricksWon], points };
  const made = points.filter((_, i) => bids[i] === s.tricksWon[i]).length;
  s.narration = made === s.seats ? "Everyone made their bid! 🎯" : made === 0 ? "Nobody made their bid 😅" : null;
  s.ready = Array(s.seats).fill(false);
  s.phase = s.hand + 1 >= s.plan.length ? "finished" : "scored";
}

function winners(s: OhHellState) {
  const top = Math.max(...s.scores);
  return s.scores.flatMap((n, i) => (n === top ? [i] : []));
}

function view(s: OhHellState, seat: number): KitView {
  const n = s.plan[s.hand]!;
  const over = s.phase === "finished";
  const trump = trumpOf(s);
  const bids = allowedBids(s, seat);
  const sofar = s.bids.reduce<number>((a, b) => a + (b ?? 0), 0);
  return {
    game: "ohhell",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "bidding" || s.phase === "playing" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: s.phase === "playing" && s.turn === seat ? { type: "play", cards: ohHellLegal(s, seat).map((c) => c.id) } : null,
    pick: null,
    choices:
      bids.length > 0
        ? {
            prompt: `Your bid: how many tricks will you take?${seat === s.dealer && s.rules.hook && bids.length <= n ? ` (Not ${n - sofar}: the bids can't add up to ${n}.)` : ""}`,
            options: bids.map((b) => ({ label: String(b), move: { type: "bid", bid: b } })),
            layout: "grid",
          }
        : s.phase === "scored" && !s.ready[seat]
          ? { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] }
          : null,
    players: s.hands.map((h, i) => ({
      cards: h.length,
      line: s.bids[i] === null ? (s.phase === "bidding" ? "Bidding…" : "") : `Bid ${s.bids[i]} · Took ${s.tricksWon[i]}`,
      dealer: i === s.dealer,
      badge: s.phase === "playing" && s.bids[i] === s.tricksWon[i] ? "On target" : undefined,
    })),
    center: { kind: "trick", plays: s.trick.length ? s.trick : (s.lastTrick?.plays ?? []), winner: s.trick.length ? null : (s.lastTrick?.winner ?? null) },
    melds: [],
    info: [
      trump ? `Trump ${SYMBOL[trump]} (${rankName(s.trumpCard!)} turned up)` : "No trump",
      `Hand ${s.hand + 1} of ${s.plan.length}: ${n} card${n === 1 ? "" : "s"}`,
      ...(s.phase !== "bidding" ? [`Bids ${sofar} for ${n} trick${n === 1 ? "" : "s"}`] : []),
    ],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `ohhell-${s.hand}`,
            title: `Hand ${s.hand + 1}`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "Bid / took", values: s.lastHand.bids.map((b, i) => `${b} / ${s.lastHand!.took[i]}`) },
              { label: "This hand", values: s.lastHand.points.map((p) => (p > 0 ? `+${p}` : String(p))), tone: "score" },
              { label: "Total", values: s.scores.map(String), tone: "total" },
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: winners(s).length > 1 ? "A tie at the top" : `${who(winners(s)[0]!)} wins with ${Math.max(...s.scores)}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** How many tricks a hand should take: high trumps, aces, guarded kings, and long trump. */
export function estimateTricks(hand: KCard[], trump: Suit | null, seats: number): number {
  let est = 0;
  const bySuit = (suit: Suit) => hand.filter((c) => suitOf(c) === suit);
  for (const c of hand) {
    const r = power(c);
    const len = bySuit(suitOf(c)).length;
    if (trump && suitOf(c) === trump) est += r >= 12 ? 0.9 : r >= 10 ? 0.6 : 0.3;
    else if (r === 14) est += 0.85 - (hand.length > 5 && len > 4 ? 0.3 : 0);
    else if (r === 13 && len >= 2) est += 0.45;
  }
  // More players means more ways to be beaten.
  return est * (seats <= 3 ? 1.1 : seats >= 6 ? 0.85 : 1);
}

function bot(s: OhHellState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  if (s.phase === "bidding") {
    if (s.turn !== seat) return null;
    const allowed = allowedBids(s, seat);
    const guess = Math.round(estimateTricks(s.hands[seat]!, trumpOf(s), s.seats) + (style.bold ?? 0) * 0.5);
    const pick = sloppy ? allowed[Math.floor(Math.random() * allowed.length)]! : [...allowed].sort((a, b) => Math.abs(a - guess) - Math.abs(b - guess) || a - b)[0]!;
    return { type: "bid", bid: pick };
  }
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const legal = ohHellLegal(s, seat);
  if (legal.length === 1 || sloppy) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  const need = (s.bids[seat] ?? 0) - s.tricksWon[seat]!;
  const trump = trumpOf(s);
  if (need > 0) {
    if (!s.trick.length) return { type: "play", card: [...legal].sort((a, b) => strength(b, trump) - strength(a, trump))[0]!.id };
    const win = cheapestWinner(legal, seat, s.trick, trump, suitOf, power);
    return { type: "play", card: (win ?? bestLoser(legal, seat, s.trick, trump, suitOf, power)).id };
  }
  // Made it (or over): stay out of the way.
  if (!s.trick.length) return { type: "play", card: [...legal].sort((a, b) => strength(a, trump) - strength(b, trump))[0]!.id };
  return { type: "play", card: bestLoser(legal, seat, s.trick, trump, suitOf, power).id };
}
const strength = (c: KCard, trump: Suit | null) => power(c) + (trump && suitOf(c) === trump ? 100 : 0);

export const ohHell: CardGame<OhHellRules, OhHellState, Move> = {
  id: "ohhell",
  name: "Oh Hell",
  emoji: "🎯",
  blurb: "Bid exactly what you'll take",
  tagline: "Bid exactly how many tricks you'll take. Hands go up and down the river.",
  seats: { min: 3, max: 7, default: 4 },
  teams: false,
  presets: [riverOhHell, longOhHell, quickOhHell],
  fields: [
    { key: "order", label: "Hands", kind: "choice", options: [["up-down", "Up then down the river"], ["down-up", "Down then back up"], ["down", "Down only (quicker)"]] },
    { key: "maxCards", label: "Most cards in a hand", kind: "number", min: 3, max: 13 },
    { key: "hook", label: "Dealer can't make the bids add up", hint: "So somebody always misses.", kind: "toggle" },
    { key: "scoring", label: "Scoring", kind: "choice", options: [["exact", "Exact: 10 + your bid"], ["tricks", "1 a trick, +10 for exact"], ["penalty", "Exact: 10 + bid; off: −5 a trick"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<OhHellRules>;
    const base = [riverOhHell, longOhHell, quickOhHell].find((p) => p.id === given.id) ?? riverOhHell;
    return { ...base, ...given };
  },
  validate(r) {
    const errors: string[] = [];
    if (!(Number.isInteger(r.maxCards) && r.maxCards >= 3 && r.maxCards <= 13)) errors.push("The most cards in a hand is 3 to 13.");
    if (!["up-down", "down-up", "down"].includes(r.order)) errors.push("Pick an order for the hands.");
    if (!["exact", "tricks", "penalty"].includes(r.scoring)) errors.push("Pick a way to score.");
    return errors;
  },
  describe(r) {
    const plan = riverPlan(r, 4);
    return [
      `Hands go ${r.order === "up-down" ? "up from 1 card" : "down from the most cards"}${r.order === "down" ? " to 1" : " and back"}: ${plan.join(", ")} cards for four players (fewer at a big table).`,
      `Bid how many tricks you'll take. ${r.scoring === "exact" ? "Exactly right scores 10 + your bid; anything else scores nothing." : r.scoring === "tricks" ? "Every trick is a point, and exactly right adds 10." : "Exactly right scores 10 + your bid; each trick you're off costs 5."}`,
      "The card turned up after the deal is trump. Follow suit if you can.",
      ...(r.hook ? ["The dealer bids last and can't make the bids add up to the tricks."] : []),
      "Highest total after the last hand wins.",
    ];
  },
  newGame: newOhHell,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "bidding") return 1800;
    if (s.phase === "scored") return 900;
    return thinkFor(ohHellLegal(s, seat).length);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "ohhell",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats(s.scores.map((score, i) => ({ seats: [i], score }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
