// The kit every card game here is built on. A game is a pure, deterministic engine (the same seed
// and moves always give the same game, so a room can replay its log) that also describes, for each
// seat, what that player sees in one shared shape: their hand and which cards a tap plays, any
// decision they owe (a bid, a trump call, a knock), the middle of the table, the melds on it, the
// scores. One table screen draws every game from that, and one room runs them all on the server.
//
// The engine contract itself, and everything else that isn't about cards (rules, summaries,
// helpers), lives in table.ts, shared with the board games; card engines import it all from here.
import type { Card, Suit } from "@spades/rules";
import { GameError, who, type BaseRules, type CardGameId, type Choices, type GameOver, type RoundResult, type RuleField, type Scores, type TableGame } from "./table.js";

export * from "./table.js";

export type PipCard = Extract<Card, { kind: "pip" }>;
export const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
export const SYMBOL: Record<Suit, string> = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
const RANK_LABEL: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };
export const rankLabel = (rank: number) => RANK_LABEL[rank] ?? String(rank);
const RANK_WORD: Record<number, string> = { 11: "jack", 12: "queen", 13: "king", 14: "ace" };
export const rankWord = (rank: number) => RANK_WORD[rank] ?? String(rank);

/**
 * A card with its own id. Games with two decks (Pinochle, Canasta) have identical cards, so every
 * card a kit game deals carries a unique `id` ("A♠", or "A♠·2" for the second copy). Moves name
 * cards by id.
 */
/** A card from a colour-card deck (Fruit Salad): a fruit and a number or an action; wild cards have no fruit. */
export type FruitCard = { kind: "fruit"; fruit: Fruit | null; face: FruitFace };
export type Fruit = "cherry" | "lemon" | "pear" | "grape";
export type FruitFace = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | "hop" | "turn" | "plus2" | "salad" | "salad4";
export type KCard = (Card | FruitCard) & { id: string };

const baseId = (c: Card) => (c.kind === "joker" ? (c.size === "big" ? "BJ" : "LJ") : `${rankLabel(c.rank)}${SYMBOL[c.suit]}`);

/** Decks: which ranks, how many copies, how many jokers. Copies after the first get "·2", "·3". */
export function makeDeck({ ranks, copies = 1, jokers = 0 }: { ranks: number[]; copies?: number; jokers?: number }): KCard[] {
  const out: KCard[] = [];
  for (let copy = 1; copy <= copies; copy++) {
    const tag = copy === 1 ? "" : `·${copy}`;
    for (const suit of SUITS) for (const rank of ranks) out.push({ kind: "pip", suit, rank, id: `${rankLabel(rank)}${SYMBOL[suit]}${tag}` } as KCard);
    for (let j = 0; j < jokers; j++) {
      const size = j % 2 === 0 ? "big" : "little";
      out.push({ kind: "joker", size, id: `${size === "big" ? "BJ" : "LJ"}${copy === 1 && j < 2 ? "" : `·${copy}${j >= 2 ? j : ""}`}` } as KCard);
    }
  }
  return out;
}
export const FULL = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export const isPip = (c: Card | FruitCard): c is PipCard & { id: string } => c.kind === "pip";
export const plainId = baseId;

/** Find cards in a hand by id; throws a GameError when one isn't there. */
export function takeCards(hand: KCard[], ids: string[]): { taken: KCard[]; rest: KCard[] } {
  if (new Set(ids).size !== ids.length) throw new GameError("Pick each card once.");
  const taken: KCard[] = [];
  for (const id of ids) {
    const card = hand.find((c) => c.id === id);
    if (!card) throw new GameError("You don't have that card.");
    taken.push(card);
  }
  return { taken, rest: hand.filter((c) => !ids.includes(c.id)) };
}

/** Sort by suit (alternating colours: ♠ ♥ ♣ ♦), then high to low, with an optional rank order. */
export function sortCards(cards: KCard[], power: (c: KCard) => number = (c) => (isPip(c) ? c.rank : 100), suitOf: (c: KCard) => Suit | "joker" = (c) => (isPip(c) ? c.suit : "joker")): KCard[] {
  const order: Record<string, number> = { joker: -1, spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
  return [...cards].sort((a, b) => order[suitOf(a)]! - order[suitOf(b)]! || power(b) - power(a));
}

// ---- What a seat sees ---------------------------------------------------------------------------

export interface SeatInfo {
  /** Cards in hand. */
  cards: number;
  /** A short line under the name: "Bid 3 · Took 1", "12 points". */
  line: string;
  /** Partners: 0 or 1 (seats 0 and 2 are team 0). */
  team?: 0 | 1;
  dealer?: boolean;
  /** Out of this hand, or sitting it out (a partner going alone). */
  out?: boolean;
  /** A small badge: "Called it", "Alone", "Knocked". */
  badge?: string;
}

export type Center =
  | { kind: "trick"; plays: { seat: number; card: KCard }[]; winner: number | null; lead?: string | null }
  | {
      kind: "piles";
      /** Cards left to draw, or null for no stock. */
      stock: number | null;
      /** The discard pile, newest last (the last few). */
      discard: KCard[];
      discardCount: number;
      /** Tapping the stock or the top discard sends these moves (when it's your move). */
      drawMove: Record<string, unknown> | null;
      takeMove: Record<string, unknown> | null;
      /** A note on the pile: "Frozen", "Suit: ♥". */
      note?: string | null;
      /** What to call the piles, when it isn't "N to draw" and "N in the pile" (Euchre's kitty). */
      stockLabel?: string;
      discardLabel?: string;
      /** The discard pile is face down (Bluff): drawn as backs, discardCount of them. */
      faceDown?: boolean;
      /** Only a stock, no discard pile beside it (Go Fish's pond). */
      noDiscard?: boolean;
      /** The discard pile spread out so every card shows; tapping one of `cards` sends { type, card } (Rummy 500). */
      spread?: { type: string; cards: string[] };
      /** Face-down cards after the spread (the dealer's hole card in Blackjack). */
      spreadHidden?: number;
      /** A card just drawn, shown beside the piles until it's placed (Golf). */
      held?: KCard | null;
      heldLabel?: string;
    }
  /**
   * A solitaire layout (Klondike, FreeCell): the stock and the turned cards, the foundations (their
   * top cards), free cells, and the columns (how many face down, then the face-up cards). Tapping one
   * of `tap.cards` sends { type, card }; tapping the stock sends drawMove.
   */
  | {
      kind: "solitaire";
      stock: number | null;
      waste: KCard[];
      foundations: (KCard | null)[];
      /** What an empty foundation shows (suit marks by default). */
      foundationLabels?: string[];
      cells: (KCard | null)[] | null;
      columns: { down: number; up: KCard[] }[];
      tap: { type: string; cards: string[] } | null;
      /**
       * Dragging one of `tap.cards` to a place of your choosing sends { type, card, to, index }:
       * `to` is "column" or "cell" with its index, or "foundation" (only when `foundations` is true).
       */
      drop?: { type: string; foundations: boolean } | null;
      drawMove: Record<string, unknown> | null;
      stockLabel?: string;
    }
  /**
   * A cross of piles round the stock (Kings in the Corner): the four sides (top, right, bottom, left)
   * then the four corners (top-left, top-right, bottom-right, bottom-left). Each pile shows its top
   * card with its bottom card peeking out; tapping a pile sends its move.
   */
  | {
      kind: "cross";
      stock: number;
      piles: { cards: KCard[]; empty?: string; move: Record<string, unknown> | null; label: string; note?: string }[];
      /** In a row beside the stock instead (Spite and Malice's building piles). */
      layout?: "row";
    }
  /** Pyramid solitaire: rows of cards (null once cleared), the stock and the turned-up card. */
  | {
      kind: "pyramid";
      /** null: an empty place; "back": a card still face down. */
      rows: (KCard | null | "back")[][];
      /** No stock beside it (the drinking-game pyramids). */
      noStock?: boolean;
      tap: { type: string; cards: string[] } | null;
      held: string | null;
      stock: number;
      waste: KCard | null;
      drawMove: Record<string, unknown> | null;
      stockLabel: string;
    }
  /** Cards in a grid in the middle (Memory); null is face down. Tapping a cell sends { type, index }. */
  | { kind: "board"; cols: number; cards: (KCard | null)[]; empty: number[]; tap: { type: string; cells: number[] } | null }
  /** Attacks and the cards that beat them (Durak), beside the stock with the trump card under it. */
  | { kind: "pairs"; stock: number; trumpCard: KCard | null; trumpLabel: string; pairs: { attack: KCard; defense: KCard | null }[]; discards: number }
  /** Another player's hand, face down: tap a card to take it (Old Maid). Sends { type: takeType, index }. */
  | { kind: "fan"; from: number; count: number; takeType: string | null; label?: string }
  | { kind: "none" };

export interface Meld {
  /** Whose: a seat, or a team (0 or 1) when the game melds by team. */
  owner: number;
  byTeam?: boolean;
  label?: string;
  cards: KCard[];
}

export interface KitView {
  game: CardGameId;
  seats: number;
  me: number;
  teams: boolean;
  phase: string;
  /** Whose move it is, or null when everyone may move (passing cards, say). */
  turn: number | null;
  dealer: number;
  hand: KCard[];
  /** Your own cards are face down and unseen (War): the table shows your pile, not a hand. "none": no cards of your own at all (Memory). */
  handHidden?: boolean | "none";
  /** Tapping one of these cards in your hand sends { type, card: id }. */
  tap: { type: string; cards: string[] } | null;
  /** Pick several cards, then press one of the buttons: sends { type, cards: ids }. */
  pick: { min: number; max: number; prompt: string; cards: string[]; actions: { label: string; type: string; primary?: boolean; extra?: Record<string, unknown> }[] } | null;
  /** Buttons: a bid, a trump call, "Next hand". */
  choices: Choices | null;
  players: SeatInfo[];
  center: Center;
  melds: Meld[];
  /** Cards laid out in front of each player in rows and columns (Golf); null is a face-down card. */
  grids?: { owner: number; cols: number; cards: (KCard | null)[]; /** Cells drawn as empty spaces. */ empty?: number[] }[];
  /** Cells of your own grid you can tap now: sends { type, index }. */
  gridTap?: { type: string; cells: number[]; prompt?: string } | null;
  /** A score track (Cribbage's board): each side's front peg, and the back peg where it was before. */
  track?: { to: number; pegs: { seats: number[]; value: number; back: number }[] };
  /** Small facts for the table: "Trump ♥", "Hearts broken", "Hand 3 of 13". */
  info: string[];
  /** What just happened, in words. */
  narration: string | null;
  /** The scoreboard: one entry per side (team or player): the seats on that side and its score. */
  scores: Scores;
  /** After a hand: what it scored, a column per side (the seats on it), until everyone moves on. */
  result: RoundResult | null;
  over: GameOver | null;
}

/** A card game: an engine whose seats see a `KitView`. */
export interface CardGame<R extends BaseRules = BaseRules, S = unknown, M = Record<string, unknown>> extends TableGame<R, S, M, KitView> {
  id: CardGameId;
}

// ---- Drinking mode -----------------------------------------------------------------------------
// A house rule some party games offer (off unless a table turns it on): the round's losers drink.

/** The house-rule switch, for a game's `fields`. */
export const drinkingField = <R>(hint = "Adults only. Losers drink (or sip water)."): RuleField<R> =>
  ({ key: "drinking", label: "Drinking mode 🍺", hint, kind: "toggle" }) as RuleField<R>;

/** "Lou drinks 2" (one or more seats). */
export function drinkLine(seats: number[], n: number): string {
  if (!seats.length || n <= 0) return "";
  return `🍺 ${seats.map(who).join(" and ")} drink${seats.length === 1 ? "s" : ""} ${n === 99 ? "the rest of the glass" : n}`;
}

/** Add a drinking line to a narration when drinking mode is on. */
export const withDrinks = (on: boolean, narration: string | null, seats: number[], n: number): string | null =>
  on && seats.length && n > 0 ? [narration, drinkLine(seats, n)].filter(Boolean).join(" · ") : narration;

/** Give a game a drinking mode: the house-rule switch, and a line in its rules when it's on. */
export function withDrinking<R extends BaseRules & { drinking?: boolean }, S, M>(game: CardGame<R, S, M>, hint: string, line: string): CardGame<R, S, M> {
  return {
    ...game,
    // A preset too, so it's one pick in the house-rules list.
    presets: [...game.presets, { ...game.presets[0]!, id: `${game.presets[0]!.id}-drinking`, name: `Drinking ${game.name} 🍺`, drinking: true }],
    fields: [...game.fields, drinkingField<R>(hint)],
    normalize: (rules) => {
      const given = rules as { id?: string; drinking?: unknown } | undefined;
      const preset = given?.id === `${game.presets[0]!.id}-drinking`;
      return { ...game.normalize(preset ? { ...given, id: game.presets[0]!.id } : rules), ...(preset ? { id: given!.id, name: `Drinking ${game.name} 🍺` } : {}), drinking: given?.drinking !== undefined ? !!given.drinking : preset };
    },
    describe: (r) => [...game.describe(r), ...(r.drinking ? [`🍺 Drinking mode: ${line}`] : [])],
  };
}

