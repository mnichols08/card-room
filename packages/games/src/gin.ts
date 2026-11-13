// Gin rummy: two players, ten cards each. Draw from the stock or the discard pile, then discard.
// Make melds: sets (three or four of a rank) and runs (three or more in a row in one suit, ace low).
// Cards that aren't in a meld are deadwood. With 10 or less, you can knock; with none, it's gin. The
// engine finds everyone's best melds itself, and the other player's deadwood is laid off on the
// knocker's melds where it fits.
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
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type Meld,
  type PipCard,
} from "./kit.js";

export interface GinRules extends BaseRules {
  playTo: number;
  /** Most deadwood you can knock with. */
  knockAt: number;
  ginBonus: number;
  undercutBonus: number;
}

export const classicGin: GinRules = { id: "gin-classic", name: "Classic Gin (to 100)", playTo: 100, knockAt: 10, ginBonus: 25, undercutBonus: 25 };
export const quickGin: GinRules = { ...classicGin, id: "gin-quick", name: "Quick Gin (to 50)", playTo: 50 };
export const straightGin: GinRules = { ...classicGin, id: "gin-straight", name: "Gin only (no knocking)", knockAt: 0 };

type Phase = "draw" | "discard" | "scored" | "finished";

export interface GinState {
  game: "gin";
  rules: GinRules;
  seats: 2;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  stock: KCard[];
  discard: KCard[];
  turn: number;
  /** The card just taken from the discard pile: it can't go straight back. */
  taken: string | null;
  scores: [number, number];
  lastHand: GinResult | null;
  ready: boolean[];
  narration: string | null;
}

export interface GinResult {
  knocker: number | null;
  gin: boolean;
  undercut: boolean;
  melds: KCard[][][];
  deadwood: number[];
  deadCards: KCard[][];
  laidOff: KCard[];
  points: [number, number];
  winner: number | null;
}

const rank = (c: KCard) => (c as PipCard).rank;
const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
/** Aces are low in Gin: A, 2, 3 is a run; Q, K, A isn't. */
const low = (c: KCard) => (rank(c) === 14 ? 1 : rank(c));
export const ginValue = (c: KCard) => Math.min(10, low(c));

// ---- Melds --------------------------------------------------------------------------------------

/** Every set and run these cards could make (including three-card parts of four-card sets). */
function possibleMelds(cards: KCard[]): KCard[][] {
  const melds: KCard[][] = [];
  const byRank = new Map<number, KCard[]>();
  for (const c of cards) byRank.set(low(c), [...(byRank.get(low(c)) ?? []), c]);
  for (const group of byRank.values()) {
    if (group.length >= 3) melds.push(group);
    if (group.length === 4) for (let skip = 0; skip < 4; skip++) melds.push(group.filter((_, i) => i !== skip));
  }
  for (const suit of ["spades", "hearts", "diamonds", "clubs"] as Suit[]) {
    const run = cards.filter((c) => suitOf(c) === suit).sort((a, b) => low(a) - low(b));
    for (let i = 0; i < run.length; i++) {
      const seq = [run[i]!];
      for (let j = i + 1; j < run.length && low(run[j]!) === low(seq[seq.length - 1]!) + 1; j++) {
        seq.push(run[j]!);
        if (seq.length >= 3) melds.push([...seq]);
      }
    }
  }
  return melds;
}

/** The melds that leave the least deadwood. */
export function bestMelds(cards: KCard[]): { melds: KCard[][]; deadwood: number; dead: KCard[] } {
  const options = possibleMelds(cards);
  let best = { melds: [] as KCard[][], deadwood: cards.reduce((n, c) => n + ginValue(c), 0) };
  const search = (from: number, used: Set<string>, chosen: KCard[][], melded: number) => {
    const dead = cards.reduce((n, c) => n + ginValue(c), 0) - melded;
    if (dead < best.deadwood) best = { melds: [...chosen], deadwood: dead };
    for (let i = from; i < options.length; i++) {
      const m = options[i]!;
      if (m.some((c) => used.has(c.id))) continue;
      for (const c of m) used.add(c.id);
      chosen.push(m);
      search(i + 1, used, chosen, melded + m.reduce((n, c) => n + ginValue(c), 0));
      chosen.pop();
      for (const c of m) used.delete(c.id);
    }
  };
  search(0, new Set(), [], 0);
  const inMelds = new Set(best.melds.flat().map((c) => c.id));
  return { ...best, dead: cards.filter((c) => !inMelds.has(c.id)) };
}

/** Best deadwood after discarding the best card from 11 (and which card that is). */
function bestDiscard(cards: KCard[], not: string | null): { card: KCard; deadwood: number } {
  let best: { card: KCard; deadwood: number } | null = null;
  for (const c of cards) {
    if (c.id === not) continue;
    const d = bestMelds(cards.filter((x) => x.id !== c.id)).deadwood;
    if (!best || d < best.deadwood || (d === best.deadwood && ginValue(c) > ginValue(best.card))) best = { card: c, deadwood: d };
  }
  return best!;
}

/** Lay the defender's deadwood off on the knocker's melds where it fits (runs at either end, sets to four). */
export function layOff(knockerMelds: KCard[][], dead: KCard[]): { laid: KCard[]; left: KCard[] } {
  const melds = knockerMelds.map((m) => [...m]);
  const laid: KCard[] = [];
  let left = [...dead];
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of left) {
      for (const m of melds) {
        const isSet = m.every((x) => low(x) === low(m[0]!));
        const fits = isSet
          ? m.length < 4 && low(c) === low(m[0]!)
          : suitOf(c) === suitOf(m[0]!) && (low(c) === Math.min(...m.map(low)) - 1 || low(c) === Math.max(...m.map(low)) + 1);
        if (fits) {
          m.push(c);
          laid.push(c);
          left = left.filter((x) => x.id !== c.id);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return { laid, left };
}

/** Sort a hand so its melds sit together, then the deadwood low to high. */
export function arrange(cards: KCard[]): KCard[] {
  const { melds, dead } = bestMelds(cards);
  return [...melds.flatMap((m) => [...m].sort((a, b) => low(a) - low(b))), ...[...dead].sort((a, b) => low(a) - low(b) || suitOf(a).localeCompare(suitOf(b)))];
}

// ---- The game -----------------------------------------------------------------------------------

function deal(s: GinState) {
  const rand = nextRandom(s);
  const deck = shuffled(makeDeck({ ranks: FULL }), rand);
  s.hands = [arrange(deck.slice(0, 10)), arrange(deck.slice(10, 20))];
  s.discard = [deck[20]!];
  s.stock = deck.slice(21);
  s.turn = (s.dealer + 1) % 2;
  s.phase = "draw";
  s.taken = null;
  s.ready = [false, false];
  s.narration = null;
}

export function newGin(rules: GinRules, _seats: number, seed: number): GinState {
  const s = { game: "gin", rules, seats: 2, rng: seed >>> 0, hand: 0, dealer: seed % 2, scores: [0, 0], lastHand: null } as unknown as GinState;
  deal(s);
  return s;
}

type Move = { type: "draw" } | { type: "take" } | { type: "discard"; cards: string[] } | { type: "knock"; cards: string[] } | { type: "next" };

function apply(state: GinState, seat: number, move: Move): GinState {
  const s = clone(state);
  switch (move.type) {
    case "next": {
      if (s.phase !== "scored") throw new GameError("The hand isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        s.dealer = s.lastHand?.winner ?? (s.dealer + 1) % 2;
        deal(s);
      }
      return s;
    }
    case "draw":
    case "take": {
      if (s.phase !== "draw" || s.turn !== seat) throw new GameError("It's not your turn to draw.");
      const card = move.type === "draw" ? s.stock.pop() : s.discard.pop();
      if (!card) throw new GameError("There's nothing there.");
      s.hands[seat] = arrange([...s.hands[seat]!, card]);
      s.taken = move.type === "take" ? card.id : null;
      s.phase = "discard";
      s.narration = move.type === "take" ? `${who(seat)} took the ${rankLabel(rank(card))}${SYMBOL[suitOf(card)]}` : `${who(seat)} drew from the stock`;
      return s;
    }
    case "discard":
    case "knock": {
      if (s.phase !== "discard" || s.turn !== seat) throw new GameError("It's not your turn to discard.");
      const id = Array.isArray(move.cards) && move.cards.length === 1 ? move.cards[0] : null;
      const card = s.hands[seat]!.find((c) => c.id === id);
      if (!card) throw new GameError("Pick one card.");
      if (card.id === s.taken) throw new GameError("You can't throw back the card you just took.");
      const rest = s.hands[seat]!.filter((c) => c.id !== card.id);
      if (move.type === "knock") {
        const { deadwood } = bestMelds(rest);
        if (deadwood > s.rules.knockAt) throw new GameError(s.rules.knockAt === 0 ? `Only gin goes out: you'd have ${deadwood} left.` : `That leaves ${deadwood} points of deadwood: you can knock with ${s.rules.knockAt} or less.`);
        s.hands[seat] = rest;
        s.discard.push(card);
        settle(s, seat);
        return s;
      }
      s.hands[seat] = arrange(rest);
      s.discard.push(card);
      s.taken = null;
      // Two cards left in the stock and nobody knocked: the hand is a wash.
      if (s.stock.length <= 2) {
        s.lastHand = { knocker: null, gin: false, undercut: false, melds: [[], []], deadwood: [0, 0], deadCards: [[], []], laidOff: [], points: [0, 0], winner: null };
        s.narration = "The stock ran down: nobody scores this hand";
        s.ready = [false, false];
        s.phase = "scored";
        return s;
      }
      s.turn = (seat + 1) % 2;
      s.phase = "draw";
      s.narration = null;
      return s;
    }
    default:
      throw new GameError("That's not a move in Gin.");
  }
}

/** Score a knock: gin, a plain knock, or an undercut. */
function settle(s: GinState, knocker: number) {
  const other = (knocker + 1) % 2;
  const mine = bestMelds(s.hands[knocker]!);
  const theirs = bestMelds(s.hands[other]!);
  const gin = mine.deadwood === 0;
  const { laid, left } = gin ? { laid: [], left: theirs.dead } : layOff(mine.melds, theirs.dead);
  const theirDead = left.reduce((n, c) => n + ginValue(c), 0);
  const points: [number, number] = [0, 0];
  let winner: number;
  let undercut = false;
  if (gin) {
    winner = knocker;
    points[knocker] = s.rules.ginBonus + theirDead;
  } else if (theirDead <= mine.deadwood) {
    winner = other;
    undercut = true;
    points[other] = s.rules.undercutBonus + (mine.deadwood - theirDead);
  } else {
    winner = knocker;
    points[knocker] = theirDead - mine.deadwood;
  }
  s.scores = [s.scores[0] + points[0], s.scores[1] + points[1]];
  const deadwood = [0, 0];
  deadwood[knocker] = mine.deadwood;
  deadwood[other] = theirDead;
  const melds: KCard[][][] = [[], []];
  melds[knocker] = mine.melds;
  melds[other] = theirs.melds;
  const deadCards: KCard[][] = [[], []];
  deadCards[knocker] = mine.dead;
  deadCards[other] = left;
  s.lastHand = { knocker, gin, undercut, melds, deadwood, deadCards, laidOff: laid, points, winner };
  s.narration = gin ? `${who(knocker)} went gin! 🍸` : undercut ? `${who(knocker)} knocked, but ${who(other)} undercut! 😮` : `${who(knocker)} knocked with ${mine.deadwood}`;
  s.ready = [false, false];
  s.phase = s.scores.some((n) => n >= s.rules.playTo) ? "finished" : "scored";
}

function view(s: GinState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.turn === seat;
  const hand = s.hands[seat]!;
  const now = bestMelds(hand);
  // While discarding: could any discard knock (or go gin)?
  const discarding = s.phase === "discard" && mine;
  const after = discarding ? bestDiscard(hand, s.taken) : null;
  const canKnock = !!after && after.deadwood <= s.rules.knockAt;
  const shown = s.lastHand && (s.phase === "scored" || over);
  const melds: Meld[] = shown
    ? [0, 1].flatMap((p) => [
        ...s.lastHand!.melds[p]!.map((cards) => ({ owner: p, cards })),
        ...(s.lastHand!.deadCards[p]!.length ? [{ owner: p, label: `Deadwood ${s.lastHand!.deadwood[p]}`, cards: s.lastHand!.deadCards[p]! }] : []),
      ])
    : [];
  return {
    game: "gin",
    seats: 2,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "draw" || s.phase === "discard" ? s.turn : null,
    dealer: s.dealer,
    // Once a hand is over, everyone's cards are laid out on the table as melds instead.
    hand: shown ? [] : hand,
    tap: null,
    pick: discarding
      ? {
          min: 1,
          max: 1,
          prompt: canKnock ? (after!.deadwood === 0 ? "Pick a card to discard: you can go gin!" : "Pick a card to discard, or knock") : "Pick a card to discard",
          cards: hand.filter((c) => c.id !== s.taken).map((c) => c.id),
          actions: [
            { label: "Discard", type: "discard", primary: !canKnock },
            ...(canKnock ? [{ label: after!.deadwood === 0 ? "Gin! 🍸" : "Knock", type: "knock", primary: true }] : []),
          ],
        }
      : null,
    choices: s.phase === "scored" && !s.ready[seat] ? { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] } : null,
    players: s.hands.map((h, i) => ({ cards: shown ? 0 : h.length, line: i === seat && !shown ? `Deadwood ${now.deadwood}` : "", dealer: i === s.dealer })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.discard.slice(-3),
      discardCount: s.discard.length,
      drawMove: s.phase === "draw" && mine ? { type: "draw" } : null,
      takeMove: s.phase === "draw" && mine && s.discard.length ? { type: "take" } : null,
    },
    melds,
    info: [
      ...(!shown ? [`Your melds: ${now.melds.length} · deadwood ${now.deadwood}`] : []),
      s.rules.knockAt > 0 ? `Knock with ${s.rules.knockAt} or less` : "Gin only",
      `To ${s.rules.playTo}`,
    ],
    narration: s.narration ?? (s.phase === "draw" && mine ? "Draw from the stock, or take the top discard" : null),
    scores: [
      { seats: [0], value: s.scores[0] },
      { seats: [1], value: s.scores[1] },
    ],
    result: shown
      ? {
          key: `gin-${s.hand}`,
          title: s.lastHand!.knocker === null ? "No score this hand" : s.lastHand!.gin ? `${who(s.lastHand!.knocker)} went gin! 🍸` : s.lastHand!.undercut ? `Undercut! ${who(s.lastHand!.winner!)} wins the hand` : `${who(s.lastHand!.knocker)} knocked and won`,
          sides: [[0], [1]],
          rows: [
            { label: "Deadwood", values: s.lastHand!.deadwood.map(String) },
            { label: "This hand", values: s.lastHand!.points.map((p) => (p > 0 ? `+${p}` : "0")), tone: "score" },
            { label: "Score", values: s.scores.map(String), tone: "total" },
          ],
        }
      : null,
    over: over ? { winners: [s.scores[0] >= s.scores[1] ? 0 : 1], title: `${who(s.scores[0] >= s.scores[1] ? 0 : 1)} wins ${Math.max(...s.scores)} to ${Math.min(...s.scores)}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: GinState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  const hand = s.hands[seat]!;
  if (s.phase === "draw") {
    const top = s.discard[s.discard.length - 1];
    if (!top || sloppy) return { type: "draw" };
    // Take the discard when it makes the hand better than it is now.
    const now = bestMelds(hand).deadwood;
    const withIt = bestDiscard([...hand, top], top.id).deadwood;
    return withIt < now - 1 || bestMelds([...hand, top]).melds.some((m) => m.some((c) => c.id === top.id)) ? { type: "take" } : { type: "draw" };
  }
  if (s.phase !== "discard") return null;
  const best = sloppy ? { card: hand.filter((c) => c.id !== s.taken)[Math.floor(Math.random() * (hand.length - (s.taken ? 1 : 0)))]!, deadwood: 99 } : bestDiscard(hand, s.taken);
  const deadwood = bestMelds(hand.filter((c) => c.id !== best.card.id)).deadwood;
  // Knock right away with gin or a small count; with more, wait for a better hand while the stock is deep.
  const knock = deadwood <= s.rules.knockAt && (deadwood === 0 || deadwood <= 4 || s.stock.length < 16 + (style.bold ?? 0) * 8);
  return { type: knock ? "knock" : "discard", cards: [best.card.id] };
}

export const gin: CardGame<GinRules, GinState, Move> = {
  id: "gin",
  name: "Gin Rummy",
  emoji: "🍸",
  blurb: "Two players, melds and knocking",
  tagline: "Make sets and runs. Knock with 10 or less, or go gin with none.",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: [classicGin, quickGin, straightGin],
  fields: [
    { key: "playTo", label: "Game to", kind: "choice", options: [[50, "50"], [100, "100"], [150, "150"]] },
    { key: "knockAt", label: "Knock with", kind: "choice", options: [[10, "10 or less"], [5, "5 or less"], [0, "Gin only"]] },
    { key: "ginBonus", label: "Gin bonus", kind: "choice", options: [[20, "20"], [25, "25"], [31, "31"]] },
    { key: "undercutBonus", label: "Undercut bonus", kind: "choice", options: [[10, "10"], [20, "20"], [25, "25"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<GinRules>;
    const base = [classicGin, quickGin, straightGin].find((p) => p.id === given.id) ?? classicGin;
    return { ...base, ...given };
  },
  validate(r) {
    const errors: string[] = [];
    if (!(r.playTo >= 25 && r.playTo <= 500)) errors.push("Play to between 25 and 500.");
    if (!(r.knockAt >= 0 && r.knockAt <= 10)) errors.push("Knock with 0 to 10.");
    return errors;
  },
  describe(r) {
    return [
      "Two players, ten cards each. On your turn, draw from the stock or take the top discard, then discard one.",
      "Make melds: three or four of a rank, or three or more in a row in one suit (ace is low). Cards not in a meld are deadwood: aces 1, faces 10, others their number.",
      r.knockAt > 0 ? `Knock with ${r.knockAt} or less deadwood; the other player lays cards off on your melds. You score the difference. If they have as little as you, they undercut you for ${r.undercutBonus} plus the difference.` : "Only gin goes out.",
      `Gin (no deadwood) scores ${r.ginBonus} plus the other player's deadwood. First to ${r.playTo} wins.`,
      "Your melds are found for you: your hand is sorted with them together.",
    ];
  },
  newGame: newGin,
  apply,
  view,
  bot,
  thinkingTime(s) {
    if (s.phase === "scored") return 900;
    return s.phase === "draw" ? 1100 : thinkFor(6);
  },
  summary(s) {
    const over = s.phase === "finished";
    const w = s.scores[0] >= s.scores[1] ? 0 : 1;
    return {
      game: "gin",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: `${s.scores[0]} to ${s.scores[1]}`,
      order: over ? rankSeats([{ seats: [0], score: s.scores[0] }, { seats: [1], score: s.scores[1] }]) : null,
      winners: over ? [w] : null,
      teams: false,
      seats: 2,
    };
  },
};
