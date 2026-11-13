// Old Maid for 2 to 6: one queen comes out of the deck, so its partner can never be paired. Deal
// everything, put down your pairs, then take turns drawing a face-down card from the next player's
// hand. Run out of cards and you're safe; whoever is left holding the Old Maid loses.
import type { PlayStyle } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  nextRandom,
  rankLabel,
  shuffled,
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

export interface OldMaidRules extends BaseRules {
  /** The Old Maid: the queen of spades (the queen of clubs comes out), or a joker added to the deck. */
  maid: "queen" | "joker";
}

export const classicOldMaid: OldMaidRules = { id: "oldmaid-classic", name: "Old Maid", maid: "queen" };
export const jokerOldMaid: OldMaidRules = { id: "oldmaid-joker", name: "Old Maid (the joker)", maid: "joker" };

type Phase = "drawing" | "finished";

export interface OldMaidState {
  game: "oldmaid";
  rules: OldMaidRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  /** Pairs each seat has put down. */
  pairs: number[];
  /** Seats in the order they ran out of cards. */
  out: number[];
  turn: number;
  /** The last draw, so the taker sees what they got and the giver what they lost. */
  last: { seat: number; from: number; card: KCard; paired: boolean } | null;
  narration: string | null;
}

const rankOf = (c: KCard) => (c.kind === "joker" ? 0 : (c as PipCard).rank);
/** The Old Maid under these rules: the joker, or (with the Q♣ out of the deck) the queen of spades. */
const isMaidFor = (rules: OldMaidRules) => (c: KCard) => (rules.maid === "joker" ? c.kind === "joker" : c.kind === "pip" && c.rank === 12 && c.suit === "spades");
const plural = (r: number) => (r === 14 ? "aces" : r === 13 ? "kings" : r === 12 ? "queens" : r === 11 ? "jacks" : `${rankLabel(r)}s`);
const sortHand = (cards: KCard[]) => [...cards].sort((a, b) => rankOf(a) - rankOf(b) || (a.kind === "pip" && b.kind === "pip" ? SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) : 0));
const cardName = (c: KCard) => (c.kind === "joker" ? "the joker" : `the ${rankLabel((c as PipCard).rank)}${SYMBOL[(c as PipCard).suit]}`);

/** Put down every pair in a hand; returns the ranks paired. */
function putDownPairs(s: OldMaidState, seat: number): number[] {
  const isMaid = isMaidFor(s.rules);
  const paired: number[] = [];
  const keep: KCard[] = [];
  const byRank = new Map<number, KCard[]>();
  for (const c of s.hands[seat]!) {
    if (isMaid(c)) {
      keep.push(c);
      continue;
    }
    byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  }
  for (const [rank, cards] of byRank) {
    const n = Math.floor(cards.length / 2);
    for (let i = 0; i < n; i++) paired.push(rank);
    if (cards.length % 2) keep.push(cards[0]!);
  }
  s.hands[seat] = sortHand(keep);
  s.pairs[seat]! += paired.length;
  return paired;
}

const holding = (s: OldMaidState) => s.hands.map((h, i) => i).filter((i) => s.hands[i]!.length > 0);
/** Who this seat draws from: the next player still holding cards. */
export const drawsFrom = (s: OldMaidState, seat: number) => {
  for (let i = 1; i < s.seats; i++) if (s.hands[(seat + i) % s.seats]!.length) return (seat + i) % s.seats;
  return seat;
};

function markOut(s: OldMaidState) {
  for (let i = 0; i < s.seats; i++) if (!s.hands[i]!.length && !s.out.includes(i)) s.out.push(i);
}

function nextTurn(s: OldMaidState, from: number) {
  markOut(s);
  if (holding(s).length <= 1) {
    s.phase = "finished";
    return;
  }
  for (let i = 1; i <= s.seats; i++) {
    const seat = (from + i) % s.seats;
    if (s.hands[seat]!.length) {
      s.turn = seat;
      return;
    }
  }
}

export function newOldMaid(rules: OldMaidRules, seats: number, seed: number): OldMaidState {
  const s = { game: "oldmaid", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, last: null, narration: null } as unknown as OldMaidState;
  let deck = makeDeck({ ranks: FULL, jokers: rules.maid === "joker" ? 1 : 0 });
  if (rules.maid === "queen") deck = deck.filter((c) => !(c.kind === "pip" && c.rank === 12 && c.suit === "clubs"));
  deck = shuffled(deck, nextRandom(s));
  s.hands = Array.from({ length: seats }, () => []);
  deck.forEach((c, i) => s.hands[(s.dealer + 1 + i) % seats]!.push(c));
  s.pairs = Array.from({ length: seats }, () => 0);
  s.out = [];
  s.phase = "drawing";
  for (let i = 0; i < seats; i++) putDownPairs(s, i);
  nextTurn(s, s.dealer);
  return s;
}

type Move = { type: "take"; index: number };

function apply(state: OldMaidState, seat: number, move: Move): OldMaidState {
  const s = clone(state);
  if (s.phase !== "drawing" || s.turn !== seat) throw new GameError("It's not your turn.");
  if (move.type !== "take") throw new GameError("That's not a move in Old Maid.");
  const from = drawsFrom(s, seat);
  const theirs = s.hands[from]!;
  const index = Number(move.index);
  if (!Number.isInteger(index) || index < 0 || index >= theirs.length) throw new GameError("Pick one of their cards.");
  // Their cards are face down and shuffled before every draw: where a card sits tells you nothing.
  const order = shuffled(theirs, nextRandom(s));
  const card = order[index]!;
  s.hands[from] = theirs.filter((c) => c.id !== card.id);
  s.hands[seat]!.push(card);
  const paired = putDownPairs(s, seat);
  s.last = { seat, from, card, paired: paired.length > 0 };
  s.narration = paired.length ? `${who(seat)} took a card from ${who(from)} and made a pair of ${plural(paired[0]!)}` : `${who(seat)} took a card from ${who(from)}`;
  nextTurn(s, seat);
  return s;
}

const loserOf = (s: OldMaidState) => holding(s)[0] ?? null;

function view(s: OldMaidState, seat: number): KitView {
  const over = s.phase === "finished";
  const loser = over ? loserOf(s) : null;
  const from = over ? null : drawsFrom(s, s.turn);
  const mine = !over && s.turn === seat;
  const isMaid = isMaidFor(s.rules);
  // What only you know: the card you just took, or the one taken from you.
  let narration = s.narration;
  if (s.last?.seat === seat) narration = `You took ${cardName(s.last.card)} from ${who(s.last.from)}${isMaid(s.last.card) ? ": the Old Maid! 😱" : s.last.paired ? ", and made a pair" : ""}`;
  else if (s.last?.from === seat) narration = `${who(s.last.seat)} took ${cardName(s.last.card)} from you${isMaid(s.last.card) ? ": the Old Maid is gone! 😅" : ""}`;
  return {
    game: "oldmaid",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: null,
    pick: null,
    choices: null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: !h.length && s.out.includes(i) ? "Safe!" : `${s.pairs[i]} pair${s.pairs[i] === 1 ? "" : "s"}`, dealer: i === s.dealer, out: !h.length })),
    center: from === null ? { kind: "none" } : { kind: "fan", from, count: s.hands[from]!.length, takeType: mine ? "take" : null, label: mine ? `Take one of ${who(from)}'s cards` : `${who(s.turn)} is taking one of ${who(from)}'s cards` },
    melds: [],
    info: [s.rules.maid === "joker" ? "The joker is the Old Maid" : "The Q♠ is the Old Maid"],
    narration,
    scores: s.pairs.map((n, i) => ({ seats: [i], value: n })),
    result: null,
    over: over ? { winners: s.hands.map((h, i) => i).filter((i) => i !== loser), title: loser === null ? "Everyone's safe!" : `${who(loser)} is left holding the Old Maid!` } : null,
  };
}

function bot(s: OldMaidState, seat: number, _style: PlayStyle): Move | null {
  if (s.phase !== "drawing" || s.turn !== seat) return null;
  return { type: "take", index: Math.floor(Math.random() * s.hands[drawsFrom(s, seat)]!.length) };
}

export const oldMaid: CardGame<OldMaidRules, OldMaidState, Move> = {
  id: "oldmaid",
  name: "Old Maid",
  emoji: "👵",
  blurb: "Pairs, and don't get stuck with her",
  tagline: "Make pairs, take a card from your neighbour, and don't be the one left holding the Old Maid.",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [classicOldMaid, jokerOldMaid],
  fields: [{ key: "maid", label: "The Old Maid", kind: "choice", options: [["queen", "The queen of spades"], ["joker", "A joker"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<OldMaidRules>;
    const base = [classicOldMaid, jokerOldMaid].find((p) => p.id === given.id) ?? classicOldMaid;
    const merged = { ...base, ...given };
    return { ...merged, maid: merged.maid === "joker" ? "joker" : "queen" };
  },
  validate: () => [],
  describe(r) {
    return [
      r.maid === "joker" ? "A joker goes into the deck: it's the Old Maid, and it has no partner." : "The queen of clubs comes out of the deck, so the queen of spades has no partner: she's the Old Maid.",
      "All the cards are dealt. Put down every pair you can.",
      "On your turn, take a face-down card from the next player's hand. If it makes a pair, put the pair down.",
      "Run out of cards and you're safe. The last one holding the Old Maid loses.",
    ];
  },
  newGame: newOldMaid,
  apply,
  view,
  bot,
  thinkingTime: () => thinkFor(3, 0.8),
  summary(s) {
    const over = s.phase === "finished";
    const loser = over ? loserOf(s) : null;
    return {
      game: "oldmaid",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.hands.map((h) => h.length).join(" · ") + " cards",
      order: over ? [...s.out, ...(loser === null ? [] : [loser])] : null,
      winners: over ? s.hands.map((h, i) => i).filter((i) => i !== loser) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
