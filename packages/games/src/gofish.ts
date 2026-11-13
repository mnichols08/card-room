// Go Fish for 2 to 6: ask another player for a rank you hold. If they have any, they hand them all
// over and you go again; if not, "go fish" from the pond. Four of a kind make a book (or pairs, for
// little ones). When every card is in a book, the most books wins.
import type { PlayStyle } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  nextRandom,
  rankLabel,
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

export interface GoFishRules extends BaseRules {
  /** Cards that make a book: 4 (classic) or 2 (pairs, for little ones). */
  bookSize: 2 | 4;
  /** Fishing up the rank you asked for lets you go again. */
  luckyFish: boolean;
}

export const classicGoFish: GoFishRules = { id: "gofish-classic", name: "Go Fish", bookSize: 4, luckyFish: true };
export const pairsGoFish: GoFishRules = { id: "gofish-pairs", name: "Little ones (pairs)", bookSize: 2, luckyFish: true };

type Phase = "asking" | "finished";

export interface GoFishState {
  game: "gofish";
  rules: GoFishRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  pond: KCard[];
  /** Each seat's books: the cards of each, in the order made. */
  books: KCard[][][];
  turn: number;
  /** What the table knows each seat holds: ranks they asked for or were handed, until they give them up or book them. */
  known: number[][];
  narration: string | null;
}

const rankOf = (c: KCard) => (c as PipCard).rank;
const plural = (r: number) => (r === 14 ? "aces" : r === 13 ? "kings" : r === 12 ? "queens" : r === 11 ? "jacks" : `${rankLabel(r)}s`);
const sortHand = (cards: KCard[]) => [...cards].sort((a, b) => rankOf(a) - rankOf(b) || SUITS.indexOf((a as PipCard).suit) - SUITS.indexOf((b as PipCard).suit));
const forget = (s: GoFishState, seat: number, rank: number) => (s.known[seat] = s.known[seat]!.filter((r) => r !== rank));
const learn = (s: GoFishState, seat: number, rank: number) => {
  if (!s.known[seat]!.includes(rank)) s.known[seat]!.push(rank);
};

/** Lay down any books in this hand; returns the ranks booked. */
function layBooks(s: GoFishState, seat: number): number[] {
  const size = s.rules.bookSize;
  const made: number[] = [];
  for (const rank of [...new Set(s.hands[seat]!.map(rankOf))]) {
    let same = s.hands[seat]!.filter((c) => rankOf(c) === rank);
    while (same.length >= size) {
      const book = same.slice(0, size);
      s.hands[seat] = s.hands[seat]!.filter((c) => !book.includes(c));
      s.books[seat]!.push(book);
      same = same.slice(size);
      made.push(rank);
    }
    if (!same.length) forget(s, seat, rank);
  }
  return made;
}

const cardsLeft = (s: GoFishState) => s.pond.length + s.hands.reduce((n, h) => n + h.length, 0);

/** Others this seat could ask: anyone else still holding cards. */
const targets = (s: GoFishState, seat: number) => s.hands.map((h, i) => i).filter((i) => i !== seat && s.hands[i]!.length > 0);

/**
 * Hand the turn to `seat`, or the next seat that can play. An empty hand draws from the pond first;
 * with no cards anywhere, the game is over.
 */
function startTurn(s: GoFishState, seat: number) {
  for (let step = 0; step < s.seats; step++) {
    const at = (seat + step) % s.seats;
    if (!s.hands[at]!.length && s.pond.length) {
      s.hands[at]!.push(s.pond.pop()!);
      layBooks(s, at);
    }
    if (s.hands[at]!.length) {
      s.turn = at;
      return;
    }
  }
  if (!cardsLeft(s)) s.phase = "finished";
}

export function newGoFish(rules: GoFishRules, seats: number, seed: number): GoFishState {
  const s = { game: "gofish", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, narration: null } as unknown as GoFishState;
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  const deal = seats <= 3 ? 7 : 5;
  s.hands = Array.from({ length: seats }, (_, i) => sortHand(deck.slice(i * deal, i * deal + deal)));
  s.pond = deck.slice(seats * deal);
  s.books = Array.from({ length: seats }, () => []);
  s.known = Array.from({ length: seats }, () => []);
  s.phase = "asking";
  for (let i = 0; i < seats; i++) layBooks(s, i);
  startTurn(s, (s.dealer + 1) % seats);
  return s;
}

type Move = { type: "ask"; cards: string[]; target: number } | { type: "fish" };

function apply(state: GoFishState, seat: number, move: Move): GoFishState {
  const s = clone(state);
  if (s.phase !== "asking" || s.turn !== seat) throw new GameError("It's not your turn.");
  const hand = s.hands[seat]!;
  if (move.type === "fish") {
    // Only when nobody else has cards to ask for.
    if (targets(s, seat).length) throw new GameError("Ask someone for a card first.");
    if (!s.pond.length) throw new GameError("The pond is empty.");
    hand.push(s.pond.pop()!);
    const booked = layBooks(s, seat);
    s.hands[seat] = sortHand(s.hands[seat]!);
    s.narration = booked.length ? `${who(seat)} fished and made a book of ${plural(booked[0]!)}!` : `${who(seat)} went fishing`;
    startTurn(s, (seat + 1) % s.seats);
    return s;
  }
  if (move.type !== "ask") throw new GameError("That's not a move in Go Fish.");
  const card = hand.find((c) => c.id === move.cards?.[0]);
  if (!card || move.cards.length !== 1) throw new GameError("Pick a card in your hand to ask for its rank.");
  const target = Number(move.target);
  if (!targets(s, seat).includes(target)) throw new GameError("Ask someone who still has cards.");
  const rank = rankOf(card);
  learn(s, seat, rank);
  const given = s.hands[target]!.filter((c) => rankOf(c) === rank);
  let again = false;
  if (given.length) {
    s.hands[target] = s.hands[target]!.filter((c) => rankOf(c) !== rank);
    forget(s, target, rank);
    hand.push(...given);
    again = true;
    s.narration = `${who(seat)} asked ${who(target)} for ${plural(rank)} and got ${given.length === 1 ? "one" : given.length}!`;
  } else if (s.pond.length) {
    const fished = s.pond.pop()!;
    hand.push(fished);
    again = s.rules.luckyFish && rankOf(fished) === rank;
    s.narration = again ? `${who(target)} said go fish, and ${who(seat)} fished up the ${rankLabel(rank)}! Go again.` : `${who(target)} said go fish!`;
  } else {
    s.narration = `${who(target)} said go fish, but the pond is empty.`;
  }
  const booked = layBooks(s, seat);
  s.hands[seat] = sortHand(s.hands[seat]!);
  if (booked.length) s.narration += ` A book of ${plural(booked[0]!)}!`;
  // The person asked may have run out: they draw at the start of their next turn.
  startTurn(s, again ? seat : (seat + 1) % s.seats);
  if (!cardsLeft(s)) s.phase = "finished";
  return s;
}

const bookCounts = (s: GoFishState) => s.books.map((b) => b.length);
function winners(s: GoFishState): number[] {
  const counts = bookCounts(s);
  const best = Math.max(...counts);
  return counts.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
}

function view(s: GoFishState, seat: number): KitView {
  const mine = s.phase === "asking" && s.turn === seat;
  const asks = mine ? targets(s, seat) : [];
  const over = s.phase === "finished";
  const melds: Meld[] = s.books.flatMap((books, i) =>
    books.length ? [{ owner: i, label: `${books.length} book${books.length === 1 ? "" : "s"}: ${books.map((b) => rankLabel(rankOf(b[0]!))).join(" ")}`, cards: books.map((b) => b[0]!) }] : [],
  );
  const w = over ? winners(s) : [];
  return {
    game: "gofish",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: null,
    pick:
      mine && asks.length
        ? {
            min: 1,
            max: 1,
            prompt: "Pick a card, then who to ask for that rank.",
            cards: s.hands[seat]!.map((c) => c.id),
            actions: asks.map((t, i) => ({ label: `Ask ${who(t)}`, type: "ask", primary: i === 0, extra: { target: t } })),
          }
        : null,
    choices: mine && !asks.length && s.pond.length ? { prompt: "Nobody else has cards left.", options: [{ label: "Go fish", move: { type: "fish" }, primary: true }] } : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: `${s.books[i]!.length} book${s.books[i]!.length === 1 ? "" : "s"}`, dealer: i === s.dealer })),
    center: { kind: "piles", stock: s.pond.length, discard: [], discardCount: 0, drawMove: null, takeMove: null, stockLabel: `${s.pond.length} in the pond`, noDiscard: true },
    melds,
    info: [s.rules.bookSize === 2 ? "Pairs make a book" : "Four of a kind make a book"],
    narration: s.narration,
    scores: s.books.map((b, i) => ({ seats: [i], value: b.length })),
    result: null,
    over: over ? { winners: w, title: w.length === 1 ? `${who(w[0]!)} wins with ${s.books[w[0]!]!.length} books!` : `A tie at ${s.books[w[0]!]!.length} books` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: GoFishState, seat: number, style: PlayStyle): Move | null {
  if (s.phase !== "asking" || s.turn !== seat) return null;
  const asks = targets(s, seat);
  if (!asks.length) return s.pond.length ? { type: "fish" } : null;
  const hand = s.hands[seat]!;
  const memory = Math.max(0, Math.min(1, (style.skill ?? 1) - (style.sloppy ?? 0)));
  // A rank someone is known to hold, if this player remembers it; the rank closest to a book first.
  const count = (r: number) => hand.filter((c) => rankOf(c) === r).length;
  const ranks = [...new Set(hand.map(rankOf))].sort((a, b) => count(b) - count(a));
  if (Math.random() < memory) {
    for (const rank of ranks) {
      const holder = asks.find((t) => s.known[t]!.includes(rank));
      if (holder !== undefined) return { type: "ask", cards: [hand.find((c) => rankOf(c) === rank)!.id], target: holder };
    }
  }
  const rank = Math.random() < memory ? ranks[0]! : ranks[Math.floor(Math.random() * ranks.length)]!;
  return { type: "ask", cards: [hand.find((c) => rankOf(c) === rank)!.id], target: asks[Math.floor(Math.random() * asks.length)]! };
}

export const goFish: CardGame<GoFishRules, GoFishState, Move> = {
  id: "gofish",
  name: "Go Fish",
  emoji: "🐟",
  blurb: "Ask for cards, make books",
  tagline: "Got any sevens? Ask for cards, go fish when they've got none, and make the most books.",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [classicGoFish, pairsGoFish],
  fields: [
    { key: "bookSize", label: "A book is", kind: "choice", options: [[4, "Four of a kind"], [2, "A pair (for little ones)"]] },
    { key: "luckyFish", label: "Lucky fish", hint: "Fish up the rank you asked for and you go again.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<GoFishRules>;
    const base = [classicGoFish, pairsGoFish].find((p) => p.id === given.id) ?? classicGoFish;
    const merged = { ...base, ...given };
    return { ...merged, bookSize: Number(merged.bookSize) === 2 ? 2 : 4 };
  },
  validate: () => [],
  describe(r) {
    return [
      "Seven cards each for two or three players, five for four or more. The rest go in the middle: the pond.",
      `On your turn, pick a card and ask another player for that rank. If they have any, they hand them all over and you go again. If not, they say "go fish" and you draw from the pond${r.luckyFish ? " (and if you fish up the rank you asked for, you go again)" : ""}.`,
      r.bookSize === 2 ? "Every pair you collect is a book and goes down." : "Four of a kind is a book and goes down.",
      "Run out of cards and you draw one from the pond on your turn. When every card is in a book, the most books wins.",
    ];
  },
  newGame: newGoFish,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => thinkFor(new Set(s.hands[seat]?.map(rankOf)).size, 0.9),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "gofish",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: bookCounts(s).join(" · "),
      order: over ? rankSeats(s.books.map((b, i) => ({ seats: [i], score: b.length }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
