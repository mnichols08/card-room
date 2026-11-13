// Palace, as pure functions: a state, an action, the next state. Deterministic from a seed, so a
// game can be replayed from its moves (the rooms kit relies on that after a restart).
//
//   swapping → playing → finished
//
// Each player gets face-down cards, face-up cards on top of them, and a hand. Play one or more cards
// of a rank, equal to or higher than the top of the pile, then draw back up while the deck lasts.
// Can't play: pick up the pile. Hand gone and deck gone: play your face-up cards, then flip your
// face-down cards blind. First out wins; the last player holding cards loses.
import { cardId, mulberry32, shuffle, type Card, type Rank, type Suit } from "@spades/rules";
import type { PalaceRules } from "./rules.js";

export type PCard = Extract<Card, { kind: "pip" }>;
export type Source = "hand" | "up" | "down";
export type PalacePhase = "swapping" | "playing" | "finished";

export class PalaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PalaceError";
  }
}

export interface PalacePlayer {
  hand: PCard[];
  up: PCard[];
  down: PCard[];
  /** Done swapping. */
  ready: boolean;
  /** 1 for first out, 2 for second... null while still playing. */
  place: number | null;
}

/** What just happened, for the table to show and the bots to talk about. */
export interface PalaceLast {
  seat: number;
  kind: "play" | "flip" | "pickup";
  cards: PCard[];
  from: Source | null;
  /** The pile burned. */
  burned: boolean;
  /** Cards picked up (a blind flip that missed picks up the flipped card too). */
  pickedUp: number;
  /** The same player goes again. */
  again: boolean;
}

export interface PalaceState {
  game: "palace";
  rules: PalaceRules;
  seats: number;
  seed: number;
  dealer: number;
  deck: PCard[];
  pile: PCard[];
  burned: number;
  players: PalacePlayer[];
  phase: PalacePhase;
  turn: number;
  /** Seats in the order they went out. */
  finished: number[];
  loser: number | null;
  last: PalaceLast | null;
  moves: number;
}

export type PalaceAction =
  | { type: "choose"; seat: number; cards: string[] }
  | { type: "swap"; seat: number; hand: string; up: string }
  | { type: "ready"; seat: number }
  | { type: "play"; seat: number; cards: string[] }
  | { type: "flip"; seat: number; index: number }
  | { type: "pickup"; seat: number };

/** A move as a player sends it: an action without the seat (the table knows who's sending). */
export type PalaceMove = PalaceAction extends infer A ? (A extends { seat: number } ? Omit<A, "seat"> : never) : never;

export const MIN_SEATS = 2;
export const MAX_SEATS = 6;

const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const sortCards = (cards: PCard[]) => [...cards].sort((a, b) => a.rank - b.rank || SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit));

export function newPalace(rules: PalaceRules, seats: number, seed: number, dealer = 0): PalaceState {
  if (!Number.isInteger(seats) || seats < MIN_SEATS || seats > MAX_SEATS) throw new PalaceError(`Palace takes ${MIN_SEATS} to ${MAX_SEATS} players.`);
  const each = rules.handSize + rules.tableCards * 2;
  const decks = seats * each > 52 ? 2 : 1;
  const cards: PCard[] = [];
  for (let d = 0; d < decks; d++) for (const suit of SUITS) for (const rank of RANKS) cards.push({ kind: "pip", suit, rank });
  const deck = shuffle(cards, seed);
  const players: PalacePlayer[] = [];
  for (let i = 0; i < seats; i++) {
    const seat = (dealer + 1 + i) % seats;
    const down = deck.splice(0, rules.tableCards);
    // Choosing: the face-up cards are dealt into the hand, and each player picks which to lay down.
    const up = rules.choose ? [] : sortCards(deck.splice(0, rules.tableCards));
    const hand = sortCards(deck.splice(0, rules.handSize + (rules.choose ? rules.tableCards : 0)));
    players[seat] = { down, up, hand, ready: false, place: null };
  }
  const s: PalaceState = { game: "palace", rules, seats, seed, dealer, deck, pile: [], burned: 0, players, phase: "swapping", turn: dealer, finished: [], loser: null, last: null, moves: 0 };
  return rules.swap || rules.choose ? s : start(s);
}

/** Cards that don't do anything special under these rules; the lowest of them in hand goes first. */
const plain = (rank: number, rules: PalaceRules) => !(rules.twoResets && rank === 2) && !(rules.tenBurns && rank === 10);

function start(s: PalaceState): PalaceState {
  s.phase = "playing";
  let best: { seat: number; rank: number } | null = null;
  for (let i = 0; i < s.seats; i++) {
    const seat = (s.dealer + 1 + i) % s.seats;
    for (const c of s.players[seat]!.hand) {
      if (plain(c.rank, s.rules) && (!best || c.rank < best.rank)) best = { seat, rank: c.rank };
    }
  }
  s.turn = best?.seat ?? (s.dealer + 1) % s.seats;
  return s;
}

/** Whether a card of this rank may go on the pile. */
export function canPlayOn(rank: number, pile: readonly PCard[], rules: PalaceRules): boolean {
  if (!pile.length) return true;
  if (rules.twoResets && rank === 2) return true;
  if (rules.tenBurns && rank === 10) return true;
  const top = pile[pile.length - 1]!.rank;
  if (rules.twoResets && top === 2) return true;
  if (rules.sevenLower && top === 7) return rank <= 7;
  return rank >= top;
}

/** Where this player plays from now: their hand, then their face-up cards, then blind. */
export function sourceOf(p: PalacePlayer): Source | null {
  return p.hand.length ? "hand" : p.up.length ? "up" : p.down.length ? "down" : null;
}

export interface Option {
  rank: number;
  /** How many of this rank the player holds where they play from. */
  count: number;
}

/** The ranks a seat can play now (not counting a blind flip, which is a gamble). */
export function options(s: PalaceState, seat: number): Option[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  const p = s.players[seat]!;
  const from = sourceOf(p);
  if (from !== "hand" && from !== "up") return [];
  const counts = new Map<number, number>();
  for (const c of p[from]) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  return [...counts].filter(([rank]) => canPlayOn(rank, s.pile, s.rules)).map(([rank, count]) => ({ rank, count })).sort((a, b) => a.rank - b.rank);
}

export function canPickUp(s: PalaceState, seat: number): boolean {
  if (s.phase !== "playing" || s.turn !== seat || !s.pile.length) return false;
  const from = sourceOf(s.players[seat]!);
  if (from !== "hand" && from !== "up") return false;
  return s.rules.pickUpAnytime || options(s, seat).length === 0;
}

const takeIds = (from: PCard[], ids: string[]): PCard[] | null => {
  const left = [...from];
  const taken: PCard[] = [];
  for (const id of ids) {
    const i = left.findIndex((c) => cardId(c) === id);
    if (i < 0) return null;
    taken.push(left.splice(i, 1)[0]!);
  }
  from.splice(0, from.length, ...left);
  return taken;
};

function burns(pile: PCard[], rules: PalaceRules): boolean {
  const top = pile[pile.length - 1];
  if (!top) return false;
  if (rules.tenBurns && top.rank === 10) return true;
  if (!rules.fourBurns || pile.length < 4) return false;
  return pile.slice(-4).every((c) => c.rank === top.rank);
}

function nextSeat(s: PalaceState, from: number): number {
  for (let i = 1; i <= s.seats; i++) {
    const seat = (from + i) % s.seats;
    if (s.players[seat]!.place === null) return seat;
  }
  return from;
}

/** After cards land on the pile: burn, draw, maybe go out, and whose turn it is. */
function settle(s: PalaceState, seat: number, move: PalaceLast) {
  const p = s.players[seat]!;
  if (burns(s.pile, s.rules)) {
    s.burned += s.pile.length;
    s.pile = [];
    move.burned = true;
  }
  while (p.hand.length < s.rules.handSize && s.deck.length) p.hand.push(s.deck.pop()!);
  p.hand = sortCards(p.hand);
  if (!p.hand.length && !p.up.length && !p.down.length) {
    s.finished.push(seat);
    p.place = s.finished.length;
    const left = s.players.map((x, i) => (x.place === null ? i : -1)).filter((i) => i >= 0);
    if (left.length === 1) {
      s.loser = left[0]!;
      s.players[s.loser]!.place = s.seats;
      s.phase = "finished";
      s.last = move;
      return;
    }
  }
  // A burn means you go again; so does a 2, under that house rule (unless it burned the pile).
  const two = s.rules.twoResets && s.rules.twoAgain && move.cards.at(-1)?.rank === 2;
  move.again = (move.burned || two) && p.place === null;
  s.turn = move.again ? seat : nextSeat(s, seat);
  s.last = move;
}

export function applyPalace(state: PalaceState, action: PalaceAction): PalaceState {
  const s = structuredClone(state);
  const seat = action.seat;
  const p = s.players[seat];
  if (!p) throw new PalaceError("No such seat.");
  if (s.phase === "finished") throw new PalaceError("The game is over.");

  if (action.type === "swap" || action.type === "ready" || action.type === "choose") {
    if (s.phase !== "swapping") throw new PalaceError("Swapping is over.");
    if (p.ready) throw new PalaceError("You're already ready.");
    const choosing = s.rules.choose && p.up.length === 0;
    if (action.type === "choose") {
      if (!choosing) throw new PalaceError("Your face-up cards are already down.");
      const ids = Array.isArray(action.cards) ? action.cards : [];
      if (ids.length !== s.rules.tableCards) throw new PalaceError(`Pick ${s.rules.tableCards} cards to lay face-up.`);
      const picked = takeIds(p.hand, ids);
      if (!picked) throw new PalaceError("You don't have those cards.");
      p.up = sortCards(picked);
      p.ready = true;
      s.moves += 1;
      return s.players.every((x) => x.ready) ? start(s) : s;
    }
    if (choosing) throw new PalaceError(`Pick ${s.rules.tableCards} cards to lay face-up first.`);
    if (action.type === "ready") {
      p.ready = true;
      s.moves += 1;
      return s.players.every((x) => x.ready) ? start(s) : s;
    }
    if (!s.rules.swap) throw new PalaceError("These rules don't swap.");
    const h = p.hand.findIndex((c) => cardId(c) === action.hand);
    const u = p.up.findIndex((c) => cardId(c) === action.up);
    if (h < 0 || u < 0) throw new PalaceError("You don't have those cards.");
    [p.hand[h], p.up[u]] = [p.up[u]!, p.hand[h]!];
    p.hand = sortCards(p.hand);
    p.up = sortCards(p.up);
    s.moves += 1;
    return s;
  }

  if (s.phase !== "playing") throw new PalaceError("Everyone has to be ready first.");
  if (s.turn !== seat) throw new PalaceError("It's not your turn.");
  const from = sourceOf(p);
  s.moves += 1;

  if (action.type === "pickup") {
    if (!canPickUp(state, seat)) throw new PalaceError(s.pile.length ? "You can play, so you can't pick up." : "There's nothing to pick up.");
    const count = s.pile.length;
    p.hand = sortCards([...p.hand, ...s.pile]);
    s.pile = [];
    s.last = { seat, kind: "pickup", cards: [], from: null, burned: false, pickedUp: count, again: false };
    s.turn = nextSeat(s, seat);
    return s;
  }

  if (action.type === "flip") {
    if (from !== "down") throw new PalaceError("Play your hand and face-up cards first.");
    if (!Number.isInteger(action.index) || action.index < 0 || action.index >= p.down.length) throw new PalaceError("No such card.");
    const card = p.down.splice(action.index, 1)[0]!;
    if (canPlayOn(card.rank, s.pile, s.rules)) {
      s.pile.push(card);
      settle(s, seat, { seat, kind: "flip", cards: [card], from: "down", burned: false, pickedUp: 0, again: false });
    } else {
      const count = s.pile.length + 1;
      p.hand = sortCards([...s.pile, card]);
      s.pile = [];
      s.last = { seat, kind: "flip", cards: [card], from: "down", burned: false, pickedUp: count, again: false };
      s.turn = nextSeat(s, seat);
    }
    return s;
  }

  // play
  if (from !== "hand" && from !== "up") throw new PalaceError("Flip one of your face-down cards.");
  if (!Array.isArray(action.cards) || !action.cards.length) throw new PalaceError("Pick a card to play.");
  const cards = takeIds(p[from], action.cards);
  if (!cards) throw new PalaceError(from === "up" ? "Play from your face-up cards now." : "You don't have those cards.");
  const rank = cards[0]!.rank;
  if (cards.some((c) => c.rank !== rank)) throw new PalaceError("Play cards of one rank at a time.");
  if (from === "up" && cards.length > 1 && s.rules.upOneAtATime) throw new PalaceError("Face-up cards go down one at a time.");
  if (!canPlayOn(rank, s.pile, s.rules)) throw new PalaceError(s.rules.sevenLower && s.pile.at(-1)?.rank === 7 ? "After a 7, play 7 or lower." : "That's lower than the pile.");
  s.pile.push(...cards);
  settle(s, seat, { seat, kind: "play", cards, from, burned: false, pickedUp: 0, again: false });
  return s;
}

/** What one seat may see: their own hand, everyone's face-up cards, counts of the rest. */
export function viewPalace(s: PalaceState, seat: number | null) {
  const me = seat === null ? null : s.players[seat] ?? null;
  return {
    game: "palace" as const,
    rules: s.rules,
    seats: s.seats,
    phase: s.phase,
    turn: s.turn,
    you: me ? seat : null,
    hand: me?.hand ?? [],
    players: s.players.map((p) => ({ up: p.up, down: p.down.length, hand: p.hand.length, ready: p.ready, place: p.place })),
    pile: s.pile.slice(-6),
    pileCount: s.pile.length,
    deck: s.deck.length,
    burned: s.burned,
    last: s.last,
    finished: s.finished,
    loser: s.loser,
    can:
      me && seat !== null
        ? {
            source: sourceOf(me),
            ranks: options(s, seat).map((o) => o.rank),
            pickUp: canPickUp(s, seat),
            flip: s.phase === "playing" && s.turn === seat && sourceOf(me) === "down",
            choose: s.phase === "swapping" && s.rules.choose && me.up.length === 0 ? s.rules.tableCards : 0,
          }
        : null,
  };
}
export type PalaceView = ReturnType<typeof viewPalace>;

export { mulberry32 };
