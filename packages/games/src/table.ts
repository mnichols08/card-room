// What every game here has in common, whatever is on the table. A game is a pure, deterministic
// engine (the same seed and moves always give the same game, so a room can replay its log): its
// house rules, how a game starts, what a move does, what each seat may see, what a computer player
// does, and a summary for lobbies and leaderboards. What a seat sees is the one part that differs:
// card games describe hands, tricks and piles (a `KitView`, in kit.ts) and board games a grid and
// its pieces (a `BoardView`, in board.ts). Everything else (the room on the server, the setup
// screen, the rules editor, houses, challenges, tournaments, practice) only needs this file.
import { mulberry32, type PlayStyle } from "@spades/rules";

/** The games that are played with cards. */
export type CardGameId = "hearts" | "ohhell" | "euchre" | "crazy8" | "gin" | "pinochle" | "canasta" | "gofish" | "oldmaid" | "war" | "whist" | "golf" | "rummy500" | "president" | "klondike" | "freecell" | "handfoot" | "cribbage" | "fivedraw" | "holdem" | "bluff" | "liarspoker" | "switch" | "thirtyone" | "kingscorner" | "blackjack" | "spite" | "pitch" | "fivehundred" | "durak" | "bridge" | "fruitsalad" | "slapjack" | "speed" | "memory" | "sevens" | "cuckoo" | "contractrummy" | "spider" | "pyramid" | "ridethebus" | "kingscup" | "horserace" | "drinkingpyramid";
/** The games that are played on a board. */
export type BoardGameId = "tictactoe" | "dropfour";
/** Every game on the kit. (Rooms, houses and saved rules have always called these "kit" games.) */
export type KitGameId = CardGameId | BoardGameId;

/** A move that isn't allowed. The message is shown to the player as is. */
export class GameError extends Error {}

export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A seeded random source that survives being stored in a state (a number, advanced each use). */
export function nextRandom(state: { rng: number }): () => number {
  return () => {
    const r = mulberry32(state.rng)();
    state.rng = (state.rng + 0x9e3779b9) >>> 0;
    return r;
  };
}

// ---- What every view shares ---------------------------------------------------------------------

/** One choice a player can make with a button. `move` is sent as is. */
export interface Choice {
  label: string;
  move: Record<string, unknown>;
  /** The main choice: drawn as the big gold button. */
  primary?: boolean;
  hint?: string;
}

/** Buttons a seat can press now: a bid, a trump call, "Next hand". */
export interface Choices {
  prompt: string;
  options: Choice[];
  layout?: "grid" | "row" | "list";
}

/** One line of a hand summary table: a label and a value per side (team or player). */
export interface SummaryRow {
  label: string;
  values: string[];
  tone?: "score" | "total";
}

/** The scoreboard: one entry per side (team or player): the seats on that side and its score. */
export type Scores = { seats: number[]; value: number }[];
/** After a hand or a round: what it scored, a column per side (the seats on it), until everyone moves on. */
export interface RoundResult {
  key: string;
  title: string;
  sides: number[][];
  rows: SummaryRow[];
}
export interface GameOver {
  winners: number[];
  title: string;
}

/** A finished or running game, in a few words, for lobbies, houses, leaderboards and tournaments. */
export interface KitSummary {
  game: KitGameId;
  rules: string;
  phase: string;
  over: boolean;
  /** Which hand (or round) it's on, from 1. */
  hand: number;
  /** "120 to 85", "Ann 34 · Bo 51 · …". */
  scoreLine: string;
  /** Seats best to worst once it's over (partners together); null while playing. */
  order: number[] | null;
  winners: number[] | null;
  teams: boolean;
  seats: number;
}

// Text from engines names seats as {0}, {1}…; the table puts the players' names in.
export const who = (seat: number) => `{${seat}}`;

// ---- Rules -------------------------------------------------------------------------------------

export interface BaseRules {
  id: string;
  name: string;
}

/** One house rule, described so the rules editor can draw it. */
export type RuleField<R> =
  | { key: keyof R & string; label: string; hint?: string; kind: "toggle" }
  | { key: keyof R & string; label: string; hint?: string; kind: "choice"; options: [string | number, string][] }
  | { key: keyof R & string; label: string; hint?: string; kind: "number"; min: number; max: number; step?: number };

/**
 * A clock of the game's own: a shot clock, a chess clock, a window for claiming a discard. The
 * table keeps the time (the server for a family table, the browser in practice) and makes `move`
 * as `seat` if nothing else happens first.
 */
export interface GameDeadline<M = Record<string, unknown>> {
  /** How long the seat has, in ms, counted from the last move anyone made (or the deal). */
  after: number;
  /** Whose clock it is: the table counts down on this seat. */
  seat: number;
  /** The move made as that seat when time runs out. It goes through `apply` like any other. */
  move: M;
}

/**
 * A game, apart from what its table looks like: `View` is what one seat sees (a `KitView` for a
 * card game, a `BoardView` for a board game).
 */
export interface TableGame<R extends BaseRules = BaseRules, S = unknown, M = Record<string, unknown>, View = unknown> {
  id: KitGameId;
  name: string;
  emoji: string;
  /** For the game picker. */
  blurb: string;
  /** For the setup screen's heading. */
  tagline: string;
  seats: { min: number; max: number; default: number };
  /** Partners across the table (needs four seats). */
  teams: boolean;
  presets: R[];
  fields: RuleField<R>[];
  /** Rules from storage or a page: anything missing comes from the first preset. */
  normalize(rules: unknown): R;
  validate(rules: R): string[];
  /** The rules in plain sentences, for the rules sheet and summaries. */
  describe(rules: R): string[];
  newGame(rules: R, seats: number, seed: number): S;
  /** Apply a seat's move; throws GameError when it isn't allowed. Never changes the given state. */
  apply(state: S, seat: number, move: M): S;
  view(state: S, seat: number): View;
  /** The move a computer player makes now, or null when it has nothing to do. */
  bot(state: S, seat: number, style: PlayStyle): M | null;
  /** How long a person would think here, in ms (before the persona's own pace). */
  thinkingTime(state: S, seat: number): number;
  /**
   * For a race (a slap in Slapjack): how long this computer player takes to react, in ms. When it
   * gives a number, it's used as is, whatever pace the table is set to, so a person can win the race.
   */
  reactionTime?(state: S, seat: number, style: PlayStyle): number | null;
  /**
   * The game's own clock in this state, if one is running: null (or no `deadline` at all) when the
   * game waits as long as it takes. Asked again after every move, so it describes this state only,
   * and like everything else here it must be worked out from the state alone, never from the time
   * of day. The table's turn timer is separate; when both are running, the sooner one counts. A
   * computer player in the seat is never held to it (and never takes longer than it).
   */
  deadline?(state: S): GameDeadline<M> | null;
  summary(state: S): KitSummary;
}

// ---- Helpers for engines ------------------------------------------------------------------------

export const clone = <T>(value: T): T => structuredClone(value);

/** Order sides best-first by score (higher better unless `lowWins`), then flatten to seats. */
export function rankSeats(sides: { seats: number[]; score: number }[], lowWins = false): number[] {
  return [...sides].sort((a, b) => (lowWins ? a.score - b.score : b.score - a.score)).flatMap((s) => s.seats);
}

export const teamOfSeat = (seat: number) => (seat % 2) as 0 | 1;
export const teamSeats = (team: 0 | 1) => [team, team + 2];

/** A "Next hand" button for each person who hasn't moved on yet; bots move on at once. */
export function nextHandChoices(ready: boolean[], seat: number, last: boolean, next = "Deal the next hand"): Choices | null {
  if (ready[seat]) return null;
  return { prompt: "", options: [{ label: last ? "See the final score" : next, move: { type: "next" }, primary: true }] };
}

/** Moving on after a hand: marks the seat ready; returns true once everyone is. */
export function markReady(ready: boolean[], seat: number): boolean {
  if (ready[seat]) throw new GameError("Waiting for the others.");
  ready[seat] = true;
  return ready.every(Boolean);
}

/** How long to think: a beat plus a little per option, longer when it matters. */
export function thinkFor(options: number, weight = 1): number {
  return Math.round((700 + Math.min(options, 10) * 120) * weight);
}

/** The persona's sharpness: careless players sometimes pick a random option. */
export function careless(style: PlayStyle, rand: () => number = Math.random): boolean {
  return rand() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.25;
}

export function pickRandom<T>(items: T[], rand: () => number = Math.random): T {
  return items[Math.floor(rand() * items.length)]!;
}
