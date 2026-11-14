// Drop Four: a rack standing on its edge. Take turns dropping a disc into a column; it falls to the
// lowest free place. Four of yours in a line (across, up and down, or on a slant) wins, and a full
// rack with no line is a draw. House rules change the size of the rack and how many in a line it
// takes, and Pop Out lets you take one of your own discs out of the bottom row instead of dropping
// one, so everything above it falls a place.
//
// Red always goes first. A table can play one game or a short match; in a match the players take
// turns going first.
//
// Drinking mode adds a shot clock, the first clock in the card room that a game declares for itself
// (see `deadline` at the bottom, and `TableGame.deadline`): once the other player's disc has landed
// you have three seconds to drop yours, or you take a drink and lose your turn.
import type { PlayStyle } from "@spades/rules";
import { cellAt, colOf, lineThrough, type BoardGame, type BoardGrid, type BoardPiece, type BoardView } from "./board.js";
import { drink, newTally, type Tally } from "./drinks.js";
import { drinkingField } from "./kit.js";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, thinkFor, who, type BaseRules, type GameDeadline } from "./table.js";

export interface DropFourRules extends BaseRules {
  /** Columns across the rack. */
  cols: number;
  /** How many discs a column holds. */
  rows: number;
  /** How many in a line win. More than that in a line wins too. */
  line: number;
  /** Pop Out: on your turn you may take one of your own discs out of the bottom row instead. */
  popOut: boolean;
  /** Who plays red (and so goes first) in the first game. */
  first: "random" | "seat1" | "seat2";
  /** Games in a match: most wins takes it. */
  games: number;
  /** Drinking mode: the shot clock. */
  drinking: boolean;
}

export const classicDropFour: DropFourRules = { id: "dropfour-classic", name: "Classic (7×6)", cols: 7, rows: 6, line: 4, popOut: false, first: "random", games: 1, drinking: false };
export const bigDropFour: DropFourRules = { ...classicDropFour, id: "dropfour-big", name: "Big board (9×7)", cols: 9, rows: 7 };
export const popOutDropFour: DropFourRules = { ...classicDropFour, id: "dropfour-popout", name: "Pop Out", popOut: true };
export const fiveDropFour: DropFourRules = { ...classicDropFour, id: "dropfour-five", name: "Five in a row (9×6)", cols: 9, line: 5 };
export const drinkingDropFour: DropFourRules = { ...classicDropFour, id: "dropfour-drinking", name: "Drinking Drop Four 🍺", drinking: true };
const PRESETS = [classicDropFour, bigDropFour, popOutDropFour, fiveDropFour, drinkingDropFour];
const COLS = [4, 5, 6, 7, 8, 9, 10];
const ROWS = [4, 5, 6, 7, 8];

/** Drinking mode: how long you have to drop a disc once the other player's has landed, in ms. */
export const SHOT_CLOCK_MS = 3000;

/** A place in the rack: the seat whose disc is there, or null. */
type Mark = number | null;

export interface DropFourState {
  game: "dropfour";
  rules: DropFourRules;
  seats: number;
  rng: number;
  /** Which game of the match, from 1. */
  round: number;
  /** Who plays red (and so goes first) in this game. */
  first: number;
  /** Row by row from the top: rows × cols. */
  cells: Mark[];
  turn: number;
  /** Where the last disc landed; null at the start and after a pop. */
  last: number | null;
  /** The bottom of the column a disc was just popped out of; null otherwise. */
  popped: number | null;
  /** Discs dropped and popped so far this game. */
  moves: number;
  /**
   * Drinking mode: the shot clock is running on whoever's turn it is. It starts when the other
   * player's disc lands, so not on the first move of a game, and not after a turn lost to the clock
   * (two people who have both walked away don't go on missing turns for ever).
   */
  clock: boolean;
  /** The cells of the winning line, once there is one. */
  won: number[] | null;
  /** Who won the game just played; null for a draw (or while playing). */
  roundWinner: number | null;
  wins: number[];
  draws: number;
  /** Drinks taken for running out the shot clock. */
  tally: Tally;
  phase: "playing" | "scored" | "finished";
  ready: boolean[];
  narration: string | null;
}

export type DropFourMove =
  | { type: "drop"; col: number }
  /** Pop Out: `from` is your disc in the bottom row (`to` is the same cell: you tap it twice). */
  | { type: "pop"; from: number; to?: number }
  /** The shot clock ran out: made by the table for the seat whose turn it was. */
  | { type: "timeout" }
  | { type: "next" };

const other = (seat: number) => 1 - seat;
const bottom = (r: DropFourRules, col: number) => cellAt(r.cols, r.rows - 1, col);

/** A Pop Out game could go round for ever: one that gets this long with no winner is a draw. */
export const moveLimit = (r: DropFourRules) => r.cols * r.rows * 4;

function startRound(s: DropFourState) {
  s.cells = Array<Mark>(s.rules.rows * s.rules.cols).fill(null);
  s.turn = s.first;
  s.last = null;
  s.popped = null;
  s.moves = 0;
  s.clock = false;
  s.won = null;
  s.roundWinner = null;
  s.phase = "playing";
  s.ready = Array<boolean>(s.seats).fill(false);
  s.narration = null;
}

export function newDropFour(rules: DropFourRules, seats: number, seed: number): DropFourState {
  const s = { game: "dropfour", rules, seats: 2, rng: seed >>> 0, round: 1, wins: [0, 0], draws: 0, tally: newTally(2) } as DropFourState;
  s.first = rules.first === "seat1" ? 0 : rules.first === "seat2" ? 1 : nextRandom(s)() < 0.5 ? 0 : 1;
  startRound(s);
  return s;
}

type Rack = Pick<DropFourState, "rules" | "cells" | "phase">;

/** Where a disc dropped into `col` would land, or null when the column is full. */
export function landing(s: Pick<DropFourState, "rules" | "cells">, col: number): number | null {
  for (let row = s.rules.rows - 1; row >= 0; row--) if (s.cells[cellAt(s.rules.cols, row, col)] === null) return cellAt(s.rules.cols, row, col);
  return null;
}
/** The columns a disc can be dropped into now. */
export function openColumns(s: Rack): number[] {
  if (s.phase !== "playing") return [];
  return Array.from({ length: s.rules.cols }, (_, col) => col).filter((col) => s.cells[col] === null);
}
/** Pop Out: the columns `seat` can pop a disc out of now (their own disc is at the bottom). */
export function poppable(s: Rack, seat: number): number[] {
  if (s.phase !== "playing" || !s.rules.popOut) return [];
  return Array.from({ length: s.rules.cols }, (_, col) => col).filter((col) => s.cells[bottom(s.rules, col)] === seat);
}

const lineAt = (s: DropFourState, cell: number, seat: number) => lineThrough(s.rules.rows, s.rules.cols, cell, s.rules.line, (c) => s.cells[c] === seat);

// ---- Moves --------------------------------------------------------------------------------------

/** How a match stands once this game is in: finished when the games run out or one side can't be caught. */
function matchOver(s: DropFourState): boolean {
  const left = s.rules.games - s.round;
  return left <= 0 || Math.abs(s.wins[0]! - s.wins[1]!) > left;
}

/** The game just ended: `winner` took it, or nobody did. */
function endRound(s: DropFourState, winner: number | null) {
  const many = s.rules.games > 1;
  s.clock = false;
  s.roundWinner = winner;
  if (winner === null) {
    s.draws += 1;
    s.narration = many ? `Game ${s.round} is a draw` : "It's a draw!";
  } else {
    s.wins[winner]! += 1;
    s.narration = `${who(winner)} wins${many ? ` game ${s.round}` : ""}!`;
  }
  s.phase = matchOver(s) ? "finished" : "scored";
}

/** After a disc has been dropped or popped with no line made: the other player's turn, or a draw. */
function passTurn(s: DropFourState, seat: number) {
  s.moves += 1;
  const next = other(seat);
  // A full rack is a draw, unless the next player can pop a disc out of it.
  const stuck = openColumns(s).length === 0 && poppable(s, next).length === 0;
  if (stuck || (s.rules.popOut && s.moves >= moveLimit(s.rules))) return endRound(s, null);
  s.turn = next;
  s.clock = s.rules.drinking;
}

function apply(state: DropFourState, seat: number, move: DropFourMove): DropFourState {
  if (move?.type === "next") {
    if (state.phase !== "scored") throw new GameError("There's a game going on.");
    const s = clone(state);
    if (markReady(s.ready, seat)) {
      // Take turns going first.
      s.round += 1;
      s.first = other(s.first);
      startRound(s);
    }
    return s;
  }
  if (move?.type !== "drop" && move?.type !== "pop" && move?.type !== "timeout") throw new GameError("That's not a move in Drop Four.");
  if (state.phase !== "playing") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const { rules } = state;

  if (move.type === "timeout") {
    if (!state.clock) throw new GameError("There's no clock running.");
    const s = clone(state);
    s.narration = `${who(seat)} was too slow · ${drink(s.tally, [seat], 1)}`;
    s.turn = other(seat);
    s.clock = false;
    return s;
  }

  if (move.type === "drop") {
    const col = Number(move.col);
    if (!Number.isInteger(col) || col < 0 || col >= rules.cols) throw new GameError("That's not a column.");
    const cell = landing(state, col);
    if (cell === null) throw new GameError("That column is full.");
    const s = clone(state);
    s.cells[cell] = seat;
    s.last = cell;
    s.popped = null;
    s.narration = `${who(seat)} drops ${discOf(s, seat).label} in column ${col + 1}`;
    const line = lineAt(s, cell, seat);
    if (line) {
      s.won = line;
      endRound(s, seat);
    } else passTurn(s, seat);
    return s;
  }

  if (!rules.popOut) throw new GameError("Popping a disc out isn't in these rules.");
  const from = Number(move.from);
  if (!Number.isInteger(from) || from < 0 || from >= state.cells.length) throw new GameError("That's not in the rack.");
  const col = colOf(rules.cols, from);
  if (from !== bottom(rules, col) || (move.to !== undefined && Number(move.to) !== from)) throw new GameError("You can only pop a disc out of the bottom row.");
  if (state.cells[from] !== seat) throw new GameError("You can only pop out a disc of your own.");
  const s = clone(state);
  for (let row = rules.rows - 1; row > 0; row--) s.cells[cellAt(rules.cols, row, col)] = s.cells[cellAt(rules.cols, row - 1, col)] ?? null;
  s.cells[col] = null;
  s.last = null;
  s.popped = from;
  s.narration = `${who(seat)} pops a disc out of column ${col + 1}`;
  // Everything in the column moved, so either colour may have a line now. Both at once goes to
  // whoever popped.
  for (const side of [seat, other(seat)]) {
    for (let row = rules.rows - 1; row >= 0 && !s.won; row--) {
      const cell = cellAt(rules.cols, row, col);
      if (s.cells[cell] === side) s.won = lineAt(s, cell, side);
    }
    if (s.won) {
      endRound(s, side);
      return s;
    }
  }
  passTurn(s, seat);
  return s;
}

/** Best first. A drawn match lists the player who went second in the last game first: holding red to a draw is the better result. */
function order(s: DropFourState): number[] {
  const [a, b] = s.wins as [number, number];
  if (a !== b) return a > b ? [0, 1] : [1, 0];
  return [other(s.first), s.first];
}
const winners = (s: DropFourState) => (s.wins[0] === s.wins[1] ? [0, 1] : [s.wins[0]! > s.wins[1]! ? 0 : 1]);

// ---- What a seat sees ---------------------------------------------------------------------------

const RED: Omit<BoardPiece, "owner"> = { kind: "disc", glyph: "●", label: "red", tone: "red" };
const YELLOW: Omit<BoardPiece, "owner"> = { kind: "disc", glyph: "●", label: "yellow", tone: "gold" };
const discOf = (s: DropFourState, seat: number): BoardPiece => ({ ...(seat === s.first ? RED : YELLOW), owner: seat });

const NUMBER_WORDS = ["Three", "Four", "Five", "Six"];
const goal = (r: DropFourRules) => `${NUMBER_WORDS[r.line - 3] ?? r.line} in a row wins`;
const CLOCK_LINE = `🍺 ${SHOT_CLOCK_MS / 1000} seconds to drop, or drink and lose your turn`;

function view(s: DropFourState, seat: number): BoardView {
  const { rules } = s;
  const over = s.phase === "finished";
  const mine = s.phase === "playing" && s.turn === seat;
  const many = rules.games > 1;
  const w = over ? winners(s) : [];
  const marks: NonNullable<BoardGrid["marks"]> = [];
  if (s.last !== null) marks.push({ cell: s.last, mark: "last" });
  if (s.popped !== null) marks.push({ cell: s.popped, mark: "from" });
  for (const cell of s.won ?? []) marks.push({ cell, mark: "win" });
  const drops = mine ? openColumns(s) : [];
  const pops = mine ? poppable(s, seat) : [];
  const grid: BoardGrid = {
    id: "board",
    label: "Rack",
    rows: rules.rows,
    cols: rules.cols,
    gravity: true,
    cells: s.cells.map((m) => (m === null ? null : discOf(s, m))),
    marks,
    // A whole column is one target; the cells listed are where each disc would land.
    tap: drops.length ? { type: "drop", by: "col", cells: drops.map((col) => landing(s, col)!) } : null,
    // Pop Out: pick up one of your own discs in the bottom row, and tap it again to pop it.
    select: pops.length ? { type: "pop", sources: pops.map((col) => ({ from: bottom(rules, col), to: [bottom(rules, col)] })) } : null,
  };
  const scoreTitle = s.roundWinner === null ? `Game ${s.round} is a draw` : `${who(s.roundWinner)} wins game ${s.round}`;
  const line = (i: number) => [...(many ? [`${s.wins[i]} win${s.wins[i] === 1 ? "" : "s"}`] : []), ...(rules.drinking ? [`🍺 ${s.tally.drank[i]}`] : [])].join(" · ");
  return {
    game: "dropfour",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" ? s.turn : null,
    grids: [grid],
    reserves: [],
    choices: s.phase === "scored" ? nextHandChoices(s.ready, seat, false, "Next game") : null,
    players: s.wins.map((_, i) => ({ line: line(i), piece: discOf(s, i), badge: s.phase === "playing" && s.moves === 0 && i === s.first ? "Goes first" : undefined })),
    info: [
      goal(rules),
      ...(many ? [`Game ${s.round} of ${rules.games}`] : []),
      ...(rules.popOut && s.phase === "playing" ? ["Pop Out: tap one of your discs in the bottom row twice to pop it"] : []),
      ...(rules.drinking && s.phase === "playing" ? [CLOCK_LINE] : []),
    ],
    narration: s.narration ?? (mine ? "You're red: you go first" : null),
    scores: s.wins.map((value, i) => ({ seats: [i], value })),
    result:
      many && s.phase !== "playing"
        ? {
            key: `game-${s.round}`,
            title: scoreTitle,
            sides: [[0], [1]],
            rows: [
              { label: "Wins", values: s.wins.map(String), tone: "total" },
              ...(s.draws ? [{ label: "Draws", values: [String(s.draws), String(s.draws)] }] : []),
              ...(rules.drinking ? [{ label: "Drinks 🍺", values: s.tally.drank.map(String) }] : []),
            ],
          }
        : null,
    over: over ? { winners: w, title: w.length > 1 ? "It's a draw!" : `${who(w[0]!)} wins${many ? ` ${s.wins[w[0]!]} to ${s.wins[other(w[0]!)]}` : ""}!` } : null,
  };
}

// ---- The computer player ------------------------------------------------------------------------
// A look ahead (alpha-beta) over a small copy of the rack, deeper the sharper the player. What it
// can't see to the end it scores by counting: every run of `line` places that only one colour is in
// is one that colour is building, worth far more the fuller it is (so an open three outweighs any
// number of twos), plus a little for discs near the middle, where more lines pass through.
//
// How far it looks is counted in positions, never in milliseconds, so the same seat in the same
// position always plays the same move and a slow server only makes it slower, not worse. A careless
// player (see `careless`) drops a disc in whatever column comes to mind.

const WIN = 1_000_000;

interface Rack2 {
  rows: number;
  cols: number;
  line: number;
  pop: boolean;
  /** 0 empty, 1 and 2 for the two seats. */
  cells: Int8Array;
  /** Discs in each column. */
  heights: Int8Array;
  /** Every run of `line` places, `line` cells each, end to end. */
  windows: Int16Array;
  /** What a disc in each column is worth for being near the middle. */
  centre: Int8Array;
  /** Columns from the middle out: the order moves are tried in. */
  order: number[];
  /** Positions looked at so far, and where to give up. */
  nodes: number;
  limit: number;
}

const windowsFor = new Map<string, Int16Array>();
function windowsOf(rows: number, cols: number, line: number): Int16Array {
  const key = `${rows}x${cols}x${line}`;
  let found = windowsFor.get(key);
  if (!found) {
    const out: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
          const r2 = r + dr * (line - 1);
          const c2 = c + dc * (line - 1);
          if (r2 < 0 || r2 >= rows || c2 < 0 || c2 >= cols) continue;
          for (let k = 0; k < line; k++) out.push(cellAt(cols, r + dr * k, c + dc * k));
        }
      }
    }
    found = Int16Array.from(out);
    windowsFor.set(key, found);
  }
  return found;
}

function rackOf(s: DropFourState): Rack2 {
  const { rows, cols, line } = s.rules;
  const cells = Int8Array.from(s.cells, (m) => (m === null ? 0 : m + 1));
  const heights = new Int8Array(cols);
  for (let c = 0; c < cols; c++) for (let r = rows - 1; r >= 0 && cells[cellAt(cols, r, c)] !== 0; r--) heights[c]!++;
  const mid = (cols - 1) / 2;
  const order = Array.from({ length: cols }, (_, c) => c).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  return { rows, cols, line, pop: s.rules.popOut, cells, heights, windows: windowsOf(rows, cols, line), centre: Int8Array.from({ length: cols }, (_, c) => Math.round(mid - Math.abs(c - mid))), order, nodes: 0, limit: Infinity };
}

/** What `k` of one colour in an otherwise empty run is worth. */
const RUN_WORTH = [0, 1, 6, 40, 240, 1400];

/** The rack as `me` (1 or 2) sees it: what I'm building less what they are. */
function evaluate(b: Rack2, me: number): number {
  const { cells, windows, line } = b;
  let total = 0;
  for (let i = 0; i < windows.length; i += line) {
    let mine = 0;
    let theirs = 0;
    for (let k = 0; k < line; k++) {
      const m = cells[windows[i + k]!]!;
      if (m === me) mine++;
      else if (m !== 0) theirs++;
    }
    if (theirs === 0) total += RUN_WORTH[mine]!;
    else if (mine === 0) total -= RUN_WORTH[theirs]!;
  }
  for (let c = 0; c < b.cols; c++) {
    if (!b.centre[c]) continue;
    for (let r = b.rows - b.heights[c]!; r < b.rows; r++) total += cells[r * b.cols + c] === me ? b.centre[c]! : -b.centre[c]!;
  }
  return total;
}

/** Whether the disc at `cell` is part of a line of `who`'s. */
function lined(b: Rack2, cell: number, who: number): boolean {
  const { rows, cols, line, cells } = b;
  const r0 = Math.floor(cell / cols);
  const c0 = cell % cols;
  for (let d = 0; d < 4; d++) {
    const dr = d === 0 ? 0 : 1;
    const dc = d === 0 ? 1 : d === 1 ? 0 : d === 2 ? 1 : -1;
    let n = 1;
    for (let r = r0 + dr, c = c0 + dc; r < rows && c >= 0 && c < cols && cells[r * cols + c] === who; r += dr, c += dc) n++;
    for (let r = r0 - dr, c = c0 - dc; r >= 0 && c >= 0 && c < cols && cells[r * cols + c] === who; r -= dr, c -= dc) n++;
    if (n >= line) return true;
  }
  return false;
}

/** A move in the search: a column to drop into, or `cols + column` to pop out of. */
function movesOf(b: Rack2, me: number, out: number[]): number[] {
  out.length = 0;
  for (const c of b.order) if (b.heights[c]! < b.rows) out.push(c);
  if (b.pop) for (const c of b.order) if (b.heights[c]! > 0 && b.cells[(b.rows - 1) * b.cols + c] === me) out.push(b.cols + c);
  return out;
}

/** Make a move; says who it won the game for (1 or 2), or 0. */
function make(b: Rack2, move: number, me: number): number {
  const { rows, cols, cells } = b;
  if (move < cols) {
    const cell = (rows - 1 - b.heights[move]!) * cols + move;
    cells[cell] = me;
    b.heights[move]!++;
    return lined(b, cell, me) ? me : 0;
  }
  const c = move - cols;
  for (let r = rows - 1; r > 0; r--) cells[r * cols + c] = cells[(r - 1) * cols + c]!;
  cells[c] = 0;
  b.heights[c]!--;
  // Both colours may have a line now: whoever popped is looked at first.
  for (const side of [me, 3 - me]) for (let r = rows - b.heights[c]!; r < rows; r++) if (cells[r * cols + c] === side && lined(b, r * cols + c, side)) return side;
  return 0;
}

function unmake(b: Rack2, move: number, me: number) {
  const { rows, cols, cells } = b;
  if (move < cols) {
    b.heights[move]!--;
    cells[(rows - 1 - b.heights[move]!) * cols + move] = 0;
    return;
  }
  const c = move - cols;
  for (let r = 0; r < rows - 1; r++) cells[r * cols + c] = cells[(r + 1) * cols + c]!;
  cells[(rows - 1) * cols + c] = me;
  b.heights[c]!++;
}

/** The value of the rack for `me`, who is about to move, looking `depth` moves ahead. */
function search(b: Rack2, me: number, depth: number, alpha: number, beta: number, ply: number): number {
  const moves = movesOf(b, me, []);
  // Nowhere to go: the rack is full, a draw.
  let best = moves.length ? -Infinity : 0;
  for (const move of moves) {
    if (++b.nodes > b.limit) return 0;
    const winner = make(b, move, me);
    // Sooner wins are better than later ones, and later losses better than sooner ones.
    const value = winner === me ? WIN - ply : winner ? ply - WIN : depth <= 1 ? evaluate(b, me) : -search(b, 3 - me, depth - 1, -beta, -alpha, ply + 1);
    unmake(b, move, me);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

/**
 * The best move for `seat`: looks one move deeper each time round, up to `depth` moves or until
 * `budget` positions have been looked at (the last, unfinished look is thrown away).
 */
export function bestDropFourMove(s: DropFourState, seat: number, depth: number, budget: number, rand: () => number = Math.random): { move: number; value: number; depth: number; nodes: number } {
  const b = rackOf(s);
  const me = seat + 1;
  // Columns the same distance from the middle are tried in either order, so games differ.
  if (rand() < 0.5) b.order = b.order.map((c) => b.cols - 1 - c);
  let moves = movesOf(b, me, []);
  let found = { move: moves[0]!, value: 0, depth: 0, nodes: 0 };
  b.limit = budget;
  for (let d = 1; d <= depth; d++) {
    let best = moves[0]!;
    let bestValue = -Infinity;
    for (const move of moves) {
      b.nodes++;
      const winner = make(b, move, me);
      const value = winner === me ? WIN : winner ? -WIN : d <= 1 ? evaluate(b, me) : -search(b, 3 - me, d - 1, -Infinity, -bestValue, 1);
      unmake(b, move, me);
      if (b.nodes > b.limit) break;
      if (value > bestValue) [best, bestValue] = [move, value];
    }
    // Out of positions part way through a look: keep what the last whole one found.
    if (b.nodes > b.limit && d > 2) break;
    found = { move: best, value: bestValue, depth: d, nodes: b.nodes };
    // Looking deeper won't change a game that's already decided, and the next look costs several times this one.
    if (Math.abs(bestValue) >= WIN - 100 || b.nodes * 4 > budget) break;
    // Start the next look with the best move so far: the rest are cut off sooner.
    moves = [best, ...moves.filter((m) => m !== best)];
  }
  return found;
}

/** Whether a disc of `seat`'s dropped into `col` now would make a line. */
function wouldWin(s: DropFourState, col: number, seat: number): boolean {
  const cell = landing(s, col);
  return cell !== null && lineThrough(s.rules.rows, s.rules.cols, cell, s.rules.line, (c) => c === cell || s.cells[c] === seat) !== null;
}

/**
 * How hard a computer player thinks: [moves ahead, positions looked at]. Scoring a position costs
 * more on a bigger rack (there are more runs to count), so the sharpest player's allowance shrinks
 * with it, and its slowest move takes about as long on any rack: a few hundredths of a second.
 */
function effort(style: PlayStyle, r: DropFourRules): [number, number] {
  const skill = style.skill ?? 1;
  return skill >= 0.9 ? [12, Math.round(6_000_000 / windowsOf(r.rows, r.cols, r.line).length)] : skill >= 0.5 ? [4, 8000] : [2, 2000];
}

function bot(s: DropFourState, seat: number, style: PlayStyle, rand: () => number = Math.random): DropFourMove | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const open = openColumns(s);
  if (open.length && careless(style, rand)) return { type: "drop", col: pickRandom(open, rand) };
  const [depth, budget] = effort(style, s.rules);
  const found = bestDropFourMove(s, seat, depth, budget, rand);
  // Lost whatever it does (they have two ways to finish): stop one of them anyway. The other
  // player may only have seen the one.
  const move = found.value <= 2 - WIN ? (open.find((col) => wouldWin(s, col, other(seat))) ?? found.move) : found.move;
  if (move < s.rules.cols) return { type: "drop", col: move };
  const from = bottom(s.rules, move - s.rules.cols);
  return { type: "pop", from, to: from };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): DropFourRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<DropFourRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicDropFour;
  const r = { ...base, ...given };
  const within = (value: unknown, list: number[], or: number) => Math.min(list.at(-1)!, Math.max(list[0]!, Math.round(Number(value)) || or));
  return {
    id: String(r.id),
    name: String(r.name),
    cols: within(r.cols, COLS, 7),
    rows: within(r.rows, ROWS, 6),
    line: within(r.line, [3, 6], 4),
    popOut: !!r.popOut,
    first: r.first === "seat1" || r.first === "seat2" ? r.first : "random",
    games: [1, 3, 5, 7].includes(Number(r.games)) ? Number(r.games) : 1,
    drinking: !!r.drinking,
  };
}

export const dropFour: BoardGame<DropFourRules, DropFourState, DropFourMove> = {
  id: "dropfour",
  name: "Drop Four",
  emoji: "🔴",
  blurb: "Drop your discs, four in a row wins",
  tagline: "Drop a disc in a column and line up four before the other player does.",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "cols", label: "Columns", kind: "choice", options: COLS.map((n) => [n, String(n)]) },
    { key: "rows", label: "Rows", kind: "choice", options: ROWS.map((n) => [n, String(n)]) },
    { key: "line", label: "In a row to win", kind: "choice", options: [[3, "Three"], [4, "Four"], [5, "Five"], [6, "Six"]] },
    { key: "popOut", label: "Pop Out", hint: "On your turn you may pop one of your own discs out of the bottom row instead.", kind: "toggle" },
    { key: "first", label: "Who goes first", kind: "choice", options: [["random", "Luck of the draw"], ["seat1", "The first seat"], ["seat2", "The second seat"]] },
    { key: "games", label: "Games in a match", kind: "choice", options: [[1, "Just one"], [3, "Three"], [5, "Five"], [7, "Seven"]] },
    drinkingField<DropFourRules>(`Adults only. A shot clock: ${SHOT_CLOCK_MS / 1000} seconds to drop your disc, or drink and lose your turn (water counts).`),
  ],
  normalize,
  validate(r) {
    return r.line > r.cols && r.line > r.rows ? [`${r.line} in a row doesn't fit in a rack ${r.cols} across and ${r.rows} high.`] : [];
  },
  describe(r) {
    return [
      `Take turns dropping a disc into one of ${r.cols} columns. It falls to the lowest free place; a column holds ${r.rows}.`,
      `${NUMBER_WORDS[r.line - 3]} in a row wins: across, up and down, or on a slant. More than that in a row wins too.`,
      ...(r.popOut
        ? [
            "Pop Out: instead of dropping a disc, you may take one of your own out of the bottom row. Everything above it falls a place.",
            `If a pop lines up ${NUMBER_WORDS[r.line - 3]!.toLowerCase()} for both players, whoever popped wins. A full rack isn't the end while someone can pop; a game that reaches ${moveLimit(r)} moves is a draw.`,
          ]
        : ["If the rack fills up first, it's a draw."]),
      r.first === "random" ? "Red goes first; who gets to be red is the luck of the draw." : `Red goes first, and the ${r.first === "seat1" ? "first" : "second"} seat is red.`,
      ...(r.games > 1 ? [`A match is ${r.games} games; most wins takes it. Players take turns going first.`] : []),
      ...(r.drinking
        ? [`🍺 Drinking mode: once the other player's disc lands you have ${SHOT_CLOCK_MS / 1000} seconds to drop yours. Too slow, and you take a drink and lose your turn. The first move of a game, and the move after a missed turn, have no clock. Computer players don't drink.`]
        : []),
    ];
  },
  newGame: newDropFour,
  apply,
  view,
  bot,
  // With a shot clock on, a computer player keeps up with it.
  thinkingTime: (s) => (s.rules.drinking ? 900 : thinkFor(Math.min(openColumns(s).length, 6), s.moves === 0 ? 0.7 : 1)),
  // The shot clock: a clock of the game's own, which the table keeps (see TableGame.deadline).
  deadline(s): GameDeadline<DropFourMove> | null {
    return s.phase === "playing" && s.clock ? { after: SHOT_CLOCK_MS, seat: s.turn, move: { type: "timeout" } } : null;
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "dropfour",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.round,
      scoreLine: `${s.wins[0]} to ${s.wins[1]}${s.draws ? ` · ${s.draws} drawn` : ""}${s.rules.drinking ? ` · 🍺 ${s.tally.drank[0]} and ${s.tally.drank[1]}` : ""}`,
      order: over ? order(s) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
