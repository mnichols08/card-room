// Liar's Poker, with cards, for 2 to 6. Everyone gets five cards. In turn, bid a poker hand you say can
// be made from ALL the cards on the table put together ("a pair of kings", "a straight to the ten"),
// each bid higher than the last, or call "Liar!". Everyone shows: if the hand is there, the caller
// loses a life; if not, the bidder does. Lose all your lives and you're out; the last one left wins.
import type { PlayStyle } from "@spades/rules";
import { clone, FULL, GameError, makeDeck, markReady, nextRandom, rankSeats, shuffled, SUITS, thinkFor, who, withDrinking, withDrinks, type BaseRules, type CardGame, type Choice, type KCard, type KitView, type Meld, type PipCard } from "./kit.js";

export interface LiarsRules extends BaseRules {
  lives: number;
  cards: number;
  /** Drinking mode, a house rule: see the game's describe(). */
  drinking?: boolean;
}

export const classicLiars: LiarsRules = { id: "liars-classic", name: "Liar's Poker (3 lives)", lives: 3, cards: 5 };
export const quickLiars: LiarsRules = { ...classicLiars, id: "liars-quick", name: "Quick (2 lives)", lives: 2 };
export const smallLiars: LiarsRules = { ...classicLiars, id: "liars-small", name: "Three cards each (harder)", cards: 3 };

type Phase = "bidding" | "reveal" | "finished";

/** A bid: a kind of hand (0 high card … 8 straight flush) and its rank. */
export interface Bid {
  cat: number;
  rank: number;
}

export interface LiarsState {
  game: "liarspoker";
  rules: LiarsRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  lives: number[];
  bid: { bid: Bid; seat: number } | null;
  turn: number;
  /** The last call: who called, on whose bid, whether the hand was there, and who lost a life. */
  call: { caller: number; bidder: number; bid: Bid; there: boolean; loser: number } | null;
  ready: boolean[];
  narration: string | null;
}

const rankOf = (c: KCard) => (c as PipCard).rank;
const suitOf = (c: KCard) => (c as PipCard).suit;
const NAME: Record<number, [string, string]> = { 14: ["ace", "aces"], 13: ["king", "kings"], 12: ["queen", "queens"], 11: ["jack", "jacks"], 10: ["ten", "tens"], 9: ["nine", "nines"], 8: ["eight", "eights"], 7: ["seven", "sevens"], 6: ["six", "sixes"], 5: ["five", "fives"], 4: ["four", "fours"], 3: ["three", "threes"], 2: ["two", "twos"] };
const one = (r: number) => NAME[r]![0];
const many = (r: number) => NAME[r]![1];

/** Every bid, lowest first. */
export const LADDER: Bid[] = (() => {
  const out: Bid[] = [];
  const ranks = (lo: number) => Array.from({ length: 15 - lo }, (_, i) => lo + i);
  for (const r of ranks(2)) out.push({ cat: 0, rank: r });
  for (const r of ranks(2)) out.push({ cat: 1, rank: r });
  for (const r of ranks(3)) out.push({ cat: 2, rank: r });
  for (const r of ranks(2)) out.push({ cat: 3, rank: r });
  for (const r of ranks(5)) out.push({ cat: 4, rank: r });
  out.push({ cat: 5, rank: 0 });
  for (const r of ranks(2)) out.push({ cat: 6, rank: r });
  for (const r of ranks(2)) out.push({ cat: 7, rank: r });
  for (const r of ranks(5)) out.push({ cat: 8, rank: r });
  return out;
})();
export const ladderIndex = (b: Bid) => LADDER.findIndex((x) => x.cat === b.cat && x.rank === b.rank);

export function bidName(b: Bid): string {
  const r = b.rank;
  switch (b.cat) {
    case 0:
      return `${r === 14 || r === 8 ? "an" : "a"} ${one(r)}`;
    case 1:
      return `a pair of ${many(r)}`;
    case 2:
      return `two pair, ${many(r)} up`;
    case 3:
      return `three ${many(r)}`;
    case 4:
      return `a straight to the ${one(r)}`;
    case 5:
      return "a flush";
    case 6:
      return `a full house, ${many(r)} full`;
    case 7:
      return `four ${many(r)}`;
    default:
      return r === 14 ? "a royal flush" : `a straight flush to the ${one(r)}`;
  }
}

const straightRanks = (top: number) => (top === 5 ? [14, 2, 3, 4, 5] : [top - 4, top - 3, top - 2, top - 1, top]);

/** Can this hand be made from these cards? */
export function bidThere(b: Bid, cards: KCard[]): boolean {
  const count = new Map<number, number>();
  for (const c of cards) count.set(rankOf(c), (count.get(rankOf(c)) ?? 0) + 1);
  const n = (r: number) => count.get(r) ?? 0;
  switch (b.cat) {
    case 0:
      return n(b.rank) >= 1;
    case 1:
      return n(b.rank) >= 2;
    case 2:
      return n(b.rank) >= 2 && [...count].some(([r, k]) => r < b.rank && k >= 2);
    case 3:
      return n(b.rank) >= 3;
    case 4:
      return straightRanks(b.rank).every((r) => n(r) >= 1);
    case 5:
      return SUITS.some((s) => cards.filter((c) => suitOf(c) === s).length >= 5);
    case 6:
      return n(b.rank) >= 3 && [...count].some(([r, k]) => r !== b.rank && k >= 2);
    case 7:
      return n(b.rank) >= 4;
    default:
      return SUITS.some((s) => straightRanks(b.rank).every((r) => cards.some((c) => suitOf(c) === s && rankOf(c) === r)));
  }
}

const alive = (s: LiarsState) => s.lives.map((l, i) => (l > 0 ? i : -1)).filter((i) => i >= 0);
const nextAlive = (s: LiarsState, from: number) => {
  for (let i = 1; i <= s.seats; i++) if (s.lives[(from + i) % s.seats]! > 0) return (from + i) % s.seats;
  return from;
};

function deal(s: LiarsState, first: number) {
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hands = s.lives.map(() => []);
  let k = 0;
  for (let i = 0; i < s.seats; i++) if (s.lives[i]! > 0) s.hands[i] = deck.slice(k, (k += s.rules.cards)).sort((a, b) => rankOf(a) - rankOf(b));
  s.bid = null;
  s.call = null;
  s.turn = s.lives[first]! > 0 ? first : nextAlive(s, first);
  s.ready = s.lives.map((l) => l <= 0);
  s.phase = "bidding";
  s.narration = `${who(s.turn)} bids first`;
}

export function newLiars(rules: LiarsRules, seats: number, seed: number): LiarsState {
  const s = { game: "liarspoker", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats } as unknown as LiarsState;
  s.lives = Array.from({ length: seats }, () => rules.lives);
  deal(s, (s.dealer + 1) % seats);
  return s;
}

type Move = { type: "bid"; at: number } | { type: "liar" } | { type: "next" };

function apply(state: LiarsState, seat: number, move: Move): LiarsState {
  const s = clone(state);
  switch (move.type) {
    case "bid": {
      if (s.phase !== "bidding" || s.turn !== seat) throw new GameError("It's not your turn.");
      const at = Number(move.at);
      const bid = LADDER[at];
      if (!bid) throw new GameError("That's not a hand you can bid.");
      if (s.bid && at <= ladderIndex(s.bid.bid)) throw new GameError(`Bid higher than ${bidName(s.bid.bid)}.`);
      s.bid = { bid, seat };
      s.narration = `${who(seat)} bids ${bidName(bid)}`;
      s.turn = nextAlive(s, seat);
      return s;
    }
    case "liar": {
      if (s.phase !== "bidding" || s.turn !== seat) throw new GameError("It's not your turn.");
      if (!s.bid) throw new GameError("Nobody has bid yet: make the first bid.");
      const all = s.hands.flat();
      const there = bidThere(s.bid.bid, all);
      const loser = there ? seat : s.bid.seat;
      s.lives[loser]! -= 1;
      s.call = { caller: seat, bidder: s.bid.seat, bid: s.bid.bid, there, loser };
      s.narration = there ? `${who(seat)} called liar, but there is ${bidName(s.bid.bid)}: ${who(seat)} loses a life` : `${who(seat)} called liar, and there's no ${bidName(s.bid.bid).replace(/^(a|an) /, "")}: ${who(s.bid.seat)} loses a life`;
      if (s.lives[loser] === 0) s.narration += `, and is out`;
      s.narration = withDrinks(!!s.rules.drinking, s.narration, [loser], s.lives[loser] === 0 ? 99 : 2);
      s.ready = s.lives.map((l, i) => l <= 0 && i !== loser);
      s.phase = alive(s).length <= 1 ? "finished" : "reveal";
      return s;
    }
    case "next": {
      if (s.phase !== "reveal") throw new GameError("The round isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        deal(s, s.call!.loser);
      }
      return s;
    }
    default:
      throw new GameError("That's not a move in Liar's Poker.");
  }
}

function view(s: LiarsState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.phase === "bidding" && s.turn === seat;
  const shown = s.phase === "reveal" || over;
  const melds: Meld[] = shown && s.call ? s.hands.flatMap((h, i) => (h.length && i !== seat ? [{ owner: i, label: `${h.length} cards`, cards: h }] : [])) : [];
  let choices: KitView["choices"] = null;
  if (mine) {
    const from = s.bid ? ladderIndex(s.bid.bid) + 1 : 0;
    const picks = new Set<number>();
    for (let i = from; i < Math.min(LADDER.length, from + 4); i++) picks.add(i);
    // And the first bid of each higher kind of hand, to jump ahead.
    for (let cat = (LADDER[from]?.cat ?? 9) + 1; cat <= 8 && picks.size < 9; cat++) picks.add(LADDER.findIndex((b) => b.cat === cat));
    const options: Choice[] = [...picks].filter((i) => i >= 0 && i < LADDER.length).sort((a, b) => a - b).map((i) => ({ label: bidName(LADDER[i]!), move: { type: "bid", at: i } }));
    if (s.bid) options.unshift({ label: "Liar!", move: { type: "liar" }, primary: true });
    choices = { prompt: s.bid ? "Bid higher, or call liar." : "Bid a hand that's somewhere in everyone's cards together.", options, layout: "list" };
  } else if (s.phase === "reveal" && !s.ready[seat]) choices = { prompt: "", options: [{ label: "Next round", move: { type: "next" }, primary: true }] };
  const hearts = (n: number) => (n > 0 ? "♥".repeat(n) : "Out");
  return {
    game: "liarspoker",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "bidding" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: null,
    pick: null,
    choices,
    players: s.hands.map((h, i) => ({ cards: h.length, line: hearts(s.lives[i]!), out: s.lives[i]! <= 0, badge: s.bid?.seat === i && s.phase === "bidding" ? "Top bid" : undefined })),
    center: { kind: "none" },
    melds,
    info: [`${s.hands.reduce((n, h) => n + h.length, 0)} cards in play`],
    narration: s.narration,
    scores: s.lives.map((l, i) => ({ seats: [i], value: l })),
    result: null,
    over: over ? { winners: alive(s), title: `${who(alive(s)[0]!)} is the last one standing!` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** How likely a bid is there, given my cards and how many others hold, by dealing the rest at random. */
export function chance(bid: Bid, mine: KCard[], others: number, samples = 120): number {
  if (bidThere(bid, mine)) return 1;
  const seen = new Set(mine.map((c) => c.id));
  const rest = makeDeck({ ranks: FULL }).filter((c) => !seen.has(c.id));
  let hits = 0;
  for (let k = 0; k < samples; k++) {
    // A partial shuffle: the first `others` cards.
    const pool = [...rest];
    for (let i = 0; i < others; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j]!, pool[i]!];
    }
    if (bidThere(bid, [...mine, ...pool.slice(0, others)])) hits++;
  }
  return hits / samples;
}

function bot(s: LiarsState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "reveal") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "bidding" || s.turn !== seat) return null;
  const mine = s.hands[seat]!;
  const others = s.hands.reduce((n, h, i) => n + (i === seat ? 0 : h.length), 0);
  const bold = style.bold ?? 0.3;
  // A bid is evidence: whoever made it probably holds some of it. Give them part of the doubt.
  const believe = (p: number) => 1 - (1 - p) * 0.45;
  if (s.bid && believe(chance(s.bid.bid, mine, others)) < 0.5 - bold * 0.1) return { type: "liar" };
  // The highest bid up to a few steps ahead that's likely enough; else the next one up.
  const from = s.bid ? ladderIndex(s.bid.bid) + 1 : 0;
  if (from >= LADDER.length) return { type: "liar" };
  let pick = from;
  for (let i = from; i < Math.min(LADDER.length, from + 12); i++) if (chance(LADDER[i]!, mine, others, 60) >= 0.62 - bold * 0.1) pick = i;
  if (s.bid && chance(LADDER[pick]!, mine, others) < 0.25 && believe(chance(s.bid.bid, mine, others)) < 0.6) return { type: "liar" };
  return { type: "bid", at: pick };
}

const liarsPokerGame: CardGame<LiarsRules, LiarsState, Move> = {
  id: "liarspoker",
  name: "Liar's Poker",
  emoji: "🗣️",
  blurb: "Bid poker hands hiding in everyone's cards",
  tagline: "Bid a poker hand that's somewhere in all the cards on the table, raise the bid, or call liar.",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [classicLiars, quickLiars, smallLiars],
  fields: [
    { key: "lives", label: "Lives", kind: "choice", options: [[2, "2"], [3, "3"], [5, "5"]] },
    { key: "cards", label: "Cards each", kind: "choice", options: [[3, "3"], [5, "5"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<LiarsRules>;
    const base = [classicLiars, quickLiars, smallLiars].find((p) => p.id === given.id) ?? classicLiars;
    const merged = { ...base, ...given };
    return { ...merged, lives: Math.max(1, Math.min(9, Math.round(Number(merged.lives) || 3))), cards: Number(merged.cards) === 3 ? 3 : 5 };
  },
  validate: () => [],
  describe(r) {
    return [
      `Everyone gets ${r.cards} cards and ${r.lives} lives.`,
      "In turn, bid a poker hand you say can be made from all the cards on the table put together, not just yours: an ace, a pair of kings, two pair, three of a kind, a straight, a flush, a full house, four of a kind, a straight flush. Each bid must be higher than the last.",
      "Or call \"Liar!\": everyone shows their cards. If the hand is there, the caller loses a life; if it isn't, the bidder does. Whoever lost bids first next round.",
      "Lose all your lives and you're out. The last one with lives left wins.",
    ];
  },
  newGame: newLiars,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "reveal" ? 2200 : thinkFor(4, 1.2)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "liarspoker",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.lives.join(" · ") + " lives",
      order: over ? rankSeats(s.lives.map((l, i) => ({ seats: [i], score: l }))) : null,
      winners: over ? alive(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};

export const liarsPoker = withDrinking(liarsPokerGame, "Adults only. Lose a life and drink 2; lose your last and finish your drink (or sip water).", "lose a life and drink 2; lose your last one and finish your drink.");
