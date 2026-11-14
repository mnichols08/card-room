// Tic-Tac-Toe, three ways. Classic: three in a row on a 3×3 board. Bigger boards with N in a row,
// up to Gomoku (five in a row on 15×15). And Ultimate: nine small boards in a 3×3; the square you
// play in a small board says which small board the other player must play in next, a small board
// goes to whoever gets three in a row in it, and three small boards in a row win the game.
//
// X always goes first. A table can play one game or a short match; in a match the players take
// turns going first.
import type { PlayStyle } from "@spades/rules";
import { cellAt, cellName, chessCoords, colOf, lineThrough, rowOf, type BoardGame, type BoardGrid, type BoardPiece, type BoardView } from "./board.js";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, thinkFor, who, type BaseRules } from "./table.js";

export interface TicTacToeRules extends BaseRules {
  /** One board, or Ultimate's nine small ones (always 3×3 each, three in a row). */
  board: "single" | "ultimate";
  /** The board is size × size (one board only). */
  size: number;
  /** How many in a row win (one board only). More than that in a row wins too. */
  line: number;
  /** Who plays X in the first game. */
  first: "random" | "seat1" | "seat2";
  /** Games in a match: most wins takes it. */
  games: number;
}

export const classicTicTacToe: TicTacToeRules = { id: "tictactoe-classic", name: "Classic 3×3", board: "single", size: 3, line: 3, first: "random", games: 1 };
export const ultimateTicTacToe: TicTacToeRules = { id: "tictactoe-ultimate", name: "Ultimate (nine boards)", board: "ultimate", size: 3, line: 3, first: "random", games: 1 };
export const fourTicTacToe: TicTacToeRules = { id: "tictactoe-four", name: "Four in a row on 6×6", board: "single", size: 6, line: 4, first: "random", games: 1 };
export const gomoku: TicTacToeRules = { id: "tictactoe-gomoku", name: "Gomoku (15×15, five in a row)", board: "single", size: 15, line: 5, first: "random", games: 1 };
const PRESETS = [classicTicTacToe, ultimateTicTacToe, fourTicTacToe, gomoku];
const SIZES = [3, 4, 5, 6, 7, 9, 11, 13, 15];

/** A cell: the seat whose mark is there, or null. */
type Mark = number | null;

export interface TicTacToeState {
  game: "tictactoe";
  rules: TicTacToeRules;
  seats: number;
  rng: number;
  /** Which game of the match, from 1. */
  round: number;
  /** Who plays X (and so goes first) in this game. */
  first: number;
  /** Row by row. One board: size × size. Ultimate: the whole 9×9. */
  cells: Mark[];
  /** Ultimate: who has each small board; "draw" for a full one nobody took. */
  blocks: (number | "draw" | null)[] | null;
  /** Ultimate: the small board the next move must be in; null for anywhere open. */
  forced: number | null;
  turn: number;
  last: number | null;
  /** The cells of the winning line, once there is one. */
  won: number[] | null;
  /** Who won the game just played; null for a draw (or while playing). */
  roundWinner: number | null;
  wins: number[];
  draws: number;
  phase: "playing" | "scored" | "finished";
  ready: boolean[];
  narration: string | null;
}

export type TicTacToeMove = { type: "mark"; cell: number } | { type: "next" };

const ultimate = (s: { rules: TicTacToeRules }) => s.rules.board === "ultimate";
/** Cells along one side of the whole grid. */
export const sideOf = (rules: TicTacToeRules) => (rules.board === "ultimate" ? 9 : rules.size);
const other = (seat: number) => 1 - seat;

function startRound(s: TicTacToeState) {
  const n = sideOf(s.rules);
  s.cells = Array<Mark>(n * n).fill(null);
  s.blocks = ultimate(s) ? Array<null>(9).fill(null) : null;
  s.forced = null;
  s.turn = s.first;
  s.last = null;
  s.won = null;
  s.roundWinner = null;
  s.phase = "playing";
  s.ready = Array<boolean>(s.seats).fill(false);
  s.narration = null;
}

export function newTicTacToe(rules: TicTacToeRules, seats: number, seed: number): TicTacToeState {
  const s = { game: "tictactoe", rules, seats: 2, rng: seed >>> 0, round: 1, wins: [0, 0], draws: 0 } as TicTacToeState;
  s.first = rules.first === "seat1" ? 0 : rules.first === "seat2" ? 1 : nextRandom(s)() < 0.5 ? 0 : 1;
  startRound(s);
  return s;
}

// ---- Ultimate's geometry --------------------------------------------------------------------------

/** The small board a cell of the 9×9 is in, and its place within that board (both 0–8). */
export const blockOf = (cell: number) => Math.floor(rowOf(9, cell) / 3) * 3 + Math.floor(colOf(9, cell) / 3);
export const spotOf = (cell: number) => (rowOf(9, cell) % 3) * 3 + (colOf(9, cell) % 3);
/** The 9×9 cell at a spot of a small board. */
export const cellIn = (block: number, spot: number) => cellAt(9, Math.floor(block / 3) * 3 + Math.floor(spot / 3), (block % 3) * 3 + (spot % 3));
const LINES3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]] as const;
const SPOTS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const lineOf3 = (at: (i: number) => unknown, who: unknown) => LINES3.find((l) => l.every((i) => at(i) === who)) ?? null;

/** The cells a move can go in now. */
export function openCells(s: Pick<TicTacToeState, "rules" | "cells" | "blocks" | "forced" | "phase">): number[] {
  if (s.phase !== "playing") return [];
  if (!ultimate(s)) return s.cells.flatMap((m, i) => (m === null ? [i] : []));
  return s.cells.flatMap((m, i) => (m === null && s.blocks![blockOf(i)] === null && (s.forced === null || s.forced === blockOf(i)) ? [i] : []));
}

/** Put a mark down and work out what it did. Changes `s`: callers pass a copy. */
function place(s: TicTacToeState, seat: number, cell: number): "won" | "draw" | null {
  s.cells[cell] = seat;
  s.last = cell;
  if (!ultimate(s)) {
    const n = s.rules.size;
    const line = lineThrough(n, n, cell, s.rules.line, (c) => s.cells[c] === seat);
    if (line) {
      s.won = line;
      return "won";
    }
    return s.cells.every((m) => m !== null) ? "draw" : null;
  }
  const block = blockOf(cell);
  const blocks = s.blocks!;
  if (lineOf3((i) => s.cells[cellIn(block, i)], seat)) blocks[block] = seat;
  else if (SPOTS.every((i) => s.cells[cellIn(block, i)] !== null)) blocks[block] = "draw";
  // The square played says where the other player goes, unless that small board is finished.
  s.forced = blocks[spotOf(cell)] === null ? spotOf(cell) : null;
  const big = lineOf3((i) => blocks[i], seat);
  if (big) {
    s.won = big.flatMap((b) => SPOTS.map((i) => cellIn(b, i)));
    return "won";
  }
  return blocks.every((b) => b !== null) ? "draw" : null;
}

// ---- Moves --------------------------------------------------------------------------------------

/** How a match stands once this game is in: finished when the games run out or one side can't be caught. */
function matchOver(s: TicTacToeState): boolean {
  const left = s.rules.games - s.round;
  return left <= 0 || Math.abs(s.wins[0]! - s.wins[1]!) > left;
}

function apply(state: TicTacToeState, seat: number, move: TicTacToeMove): TicTacToeState {
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
  if (move?.type !== "mark") throw new GameError("That's not a move in Tic-Tac-Toe.");
  if (state.phase !== "playing") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const cell = Number(move.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.cells.length) throw new GameError("That's not on the board.");
  if (state.cells[cell] !== null) throw new GameError("That square is taken.");
  if (ultimate(state)) {
    if (state.blocks![blockOf(cell)] !== null) throw new GameError("That small board is finished.");
    if (state.forced !== null && state.forced !== blockOf(cell)) throw new GameError("You have to play in the lit-up board.");
  }
  const s = clone(state);
  const end = place(s, seat, cell);
  const grid = gridOf(s);
  s.narration = `${who(seat)} plays ${markOf(s, seat).label} ${nameOf(grid, cell)}`;
  if (!end) {
    s.turn = other(seat);
    return s;
  }
  if (end === "won") {
    s.wins[seat]! += 1;
    s.roundWinner = seat;
  } else s.draws += 1;
  const many = s.rules.games > 1;
  s.narration = end === "won" ? `${who(seat)} wins${many ? ` game ${s.round}` : ""}!` : many ? `Game ${s.round} is a draw` : "It's a draw!";
  s.phase = matchOver(s) ? "finished" : "scored";
  return s;
}

/** Best first. A drawn match lists the player who went second in the last game first: holding X to a draw is the better result. */
function order(s: TicTacToeState): number[] {
  const [a, b] = s.wins as [number, number];
  if (a !== b) return a > b ? [0, 1] : [1, 0];
  return [other(s.first), s.first];
}
const winners = (s: TicTacToeState) => (s.wins[0] === s.wins[1] ? [0, 1] : [s.wins[0]! > s.wins[1]! ? 0 : 1]);

// ---- What a seat sees ---------------------------------------------------------------------------

const X: Omit<BoardPiece, "owner"> = { kind: "x", glyph: "✕", label: "X", tone: "red" };
const O: Omit<BoardPiece, "owner"> = { kind: "o", glyph: "◯", label: "O", tone: "blue" };
const markOf = (s: TicTacToeState, seat: number): BoardPiece => ({ ...(seat === s.first ? X : O), owner: seat });

const ROWS3 = ["top", "middle", "bottom"];
const COLS3 = ["left", "middle", "right"];
const spotName = (spot: number) => (spot === 4 ? "centre" : `${ROWS3[Math.floor(spot / 3)]} ${COLS3[spot % 3]}`);

/** The board without its pieces: enough to name a cell. */
function gridOf(s: TicTacToeState): Pick<BoardGrid, "cols" | "coords" | "names"> {
  if (ultimate(s)) return { cols: 9, names: s.cells.map((_, i) => `${spotName(spotOf(i))} of the ${spotName(blockOf(i))} board`) };
  if (s.rules.size === 3) return { cols: 3, names: s.cells.map((_, i) => spotName(i)) };
  return { cols: s.rules.size, coords: chessCoords(s.rules.size, s.rules.size) };
}
const nameOf = (grid: ReturnType<typeof gridOf>, cell: number) => (grid.names ? `in the ${grid.names[cell]}` : `at ${cellName(grid, cell)}`);

const goal = (r: TicTacToeRules) => (r.board === "ultimate" ? "Three small boards in a row wins" : `${["Three", "Four", "Five", "Six"][r.line - 3] ?? r.line} in a row wins`);

function view(s: TicTacToeState, seat: number): BoardView {
  const over = s.phase === "finished";
  const mine = s.phase === "playing" && s.turn === seat;
  const many = s.rules.games > 1;
  const n = sideOf(s.rules);
  const w = over ? winners(s) : [];
  const marks: NonNullable<BoardGrid["marks"]> = [];
  if (s.last !== null) marks.push({ cell: s.last, mark: "last" });
  for (const cell of s.won ?? []) marks.push({ cell, mark: "win" });
  const open = openCells(s);
  const grid: BoardGrid = {
    id: "board",
    label: "Board",
    rows: n,
    ...gridOf(s),
    cells: s.cells.map((m) => (m === null ? null : markOf(s, m))),
    marks,
    tap: mine ? { type: "mark", cells: open } : null,
  };
  if (ultimate(s)) {
    grid.blocks = {
      rows: 3,
      cols: 3,
      states: s.blocks!.map((b, i) => ({
        owner: typeof b === "number" ? b : null,
        glyph: typeof b === "number" ? markOf(s, b).glyph : undefined,
        label: typeof b === "number" ? `won by ${markOf(s, b).label}` : b === "draw" ? "drawn" : undefined,
        closed: b !== null,
        active: s.phase === "playing" && b === null && (s.forced === null || s.forced === i),
      })),
    };
  }
  const scoreTitle = s.roundWinner === null ? `Game ${s.round} is a draw` : `${who(s.roundWinner)} wins game ${s.round}`;
  return {
    game: "tictactoe",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" ? s.turn : null,
    grids: [grid],
    reserves: [],
    choices: s.phase === "scored" ? nextHandChoices(s.ready, seat, false, "Next game") : null,
    players: s.wins.map((wins, i) => ({ line: many ? `${wins} win${wins === 1 ? "" : "s"}` : "", piece: markOf(s, i), badge: s.phase === "playing" && s.last === null && i === s.first ? "Goes first" : undefined })),
    info: [goal(s.rules), ...(many ? [`Game ${s.round} of ${s.rules.games}`] : []), ...(ultimate(s) && s.phase === "playing" ? [s.forced === null ? "Play in any open board" : `Play in the ${spotName(s.forced)} board`] : [])],
    narration: s.narration ?? (mine ? "You're X: you go first" : null),
    scores: s.wins.map((value, i) => ({ seats: [i], value })),
    result:
      many && s.phase !== "playing"
        ? { key: `game-${s.round}`, title: scoreTitle, sides: [[0], [1]], rows: [{ label: "Wins", values: s.wins.map(String), tone: "total" }, ...(s.draws ? [{ label: "Draws", values: [String(s.draws), String(s.draws)] }] : [])] }
        : null,
    over: over ? { winners: w, title: w.length > 1 ? "It's a draw!" : `${who(w[0]!)} wins${many ? ` ${s.wins[w[0]!]} to ${s.wins[other(w[0]!)]}` : ""}!` } : null,
  };
}

// ---- Computer players ---------------------------------------------------------------------------
// Three brains. 3×3 is small enough to know completely, so at full skill it never loses. Bigger
// boards are scored square by square (what a mark there would build, and what it would stop) with
// a look at the other player's best answer. Ultimate looks a few moves ahead. A careless player
// (see `careless`) plays the first square that comes to mind instead, which is how the easier
// tables get beaten.

// -- 3×3: the whole game tree, remembered. The value is for the player about to move: 1 win, 0 draw, -1 loss.
const solved = new Map<string, number>();
function solve3(cells: Mark[], turn: number): number {
  const key = cells.map((m) => (m === null ? "." : m)).join("") + turn;
  const known = solved.get(key);
  if (known !== undefined) return known;
  let best = -2;
  for (let i = 0; i < 9 && best < 1; i++) {
    if (cells[i] !== null) continue;
    cells[i] = turn;
    const value = lineOf3((j) => cells[j], turn) ? 1 : cells.every((m) => m !== null) ? 0 : -solve3(cells, other(turn));
    cells[i] = null;
    best = Math.max(best, value);
  }
  solved.set(key, best);
  return best;
}

/** Every best move on a 3×3 board: the squares that keep the best result that can still be had. */
export function bestClassicMoves(cells: Mark[], turn: number): number[] {
  const board = [...cells];
  let best = -2;
  let moves: number[] = [];
  for (let i = 0; i < 9; i++) {
    if (board[i] !== null) continue;
    board[i] = turn;
    const value = lineOf3((j) => board[j], turn) ? 1 : board.every((m) => m !== null) ? 0 : -solve3(board, other(turn));
    board[i] = null;
    if (value > best) [best, moves] = [value, [i]];
    else if (value === best) moves.push(i);
  }
  return moves;
}

// -- Bigger boards. Every run of `line` squares through a square counts: a run with only my marks
// in it is one I'm building (worth more the fuller it is), a run with only theirs is one to stop.
const WORTH = [1, 6, 40, 400, 6000, 90000];
const WIN = 1e9;
/** What a mark in `cell` would do for `seat`: [what it builds, what it stops]. WIN in either means a line finished or denied. */
function rate(cells: Mark[], n: number, line: number, cell: number, seat: number): [number, number] {
  const r0 = rowOf(n, cell);
  const c0 = colOf(n, cell);
  let build = 0;
  let stop = 0;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]] as const) {
    for (let start = 1 - line; start <= 0; start++) {
      const r1 = r0 + dr * start;
      const c1 = c0 + dc * start;
      const r2 = r1 + dr * (line - 1);
      const c2 = c1 + dc * (line - 1);
      if (r1 < 0 || r1 >= n || c1 < 0 || c1 >= n || r2 < 0 || r2 >= n || c2 < 0 || c2 >= n) continue;
      let mine = 0;
      let theirs = 0;
      for (let k = 0; k < line; k++) {
        const m = cells[cellAt(n, r1 + dr * k, c1 + dc * k)];
        if (m === seat) mine++;
        else if (m !== null && m !== undefined) theirs++;
      }
      if (!theirs) build += mine === line - 1 ? WIN : WORTH[Math.min(mine, 5)]!;
      if (!mine && theirs) stop += theirs === line - 1 ? WIN : WORTH[Math.min(theirs, 5)]! * 0.8;
    }
  }
  return [build, stop];
}

/** Squares worth thinking about: all of a small board; on a big one, those within two of a mark. */
function candidates(cells: Mark[], n: number): number[] {
  const empty = cells.flatMap((m, i) => (m === null ? [i] : []));
  if (n <= 7) return empty;
  if (empty.length === cells.length) return [cellAt(n, Math.floor(n / 2), Math.floor(n / 2))];
  const near = empty.filter((i) => {
    const r = rowOf(n, i);
    const c = colOf(n, i);
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (r + dr >= 0 && r + dr < n && c + dc >= 0 && c + dc < n && cells[cellAt(n, r + dr, c + dc)] !== null) return true;
    return false;
  });
  return near.length ? near : empty;
}

function bestBigMove(s: TicTacToeState, seat: number, rand: () => number): number {
  const n = s.rules.size;
  const line = s.rules.line;
  const cells = [...s.cells];
  const scored = candidates(cells, n)
    .map((cell) => {
      const [build, stop] = rate(cells, n, line, cell, seat);
      return { cell, build, stop, value: build + stop + rand() };
    })
    .sort((a, b) => b.value - a.value);
  // Finish my own line if I can; failing that, stop theirs.
  const win = scored.find((o) => o.build >= WIN);
  if (win) return win.cell;
  const block = scored.find((o) => o.stop >= WIN);
  if (block) return block.cell;
  // Otherwise weigh the best few against what each leaves the other player.
  let best = scored[0]!;
  let bestNet = -Infinity;
  for (const option of scored.slice(0, 8)) {
    cells[option.cell] = seat;
    const after = candidates(cells, n);
    const wins = after.filter((c) => rate(cells, n, line, c, seat)[0] >= WIN);
    // Two ways to finish next turn can't both be stopped.
    if (wins.length >= 2) return option.cell;
    // One way to finish forces their answer; otherwise they play whatever builds the most.
    const answers = (wins.length ? wins : after).map((cell) => ({ cell, build: rate(cells, n, line, cell, other(seat))[0] })).sort((a, b) => b.build - a.build);
    let net = option.value - Math.min(answers[0]?.build ?? 0, WIN / 10) * 0.6;
    // And an answer that leaves them two ways to finish is one I can't come back from.
    for (const answer of answers.slice(0, 5)) {
      cells[answer.cell] = other(seat);
      if (candidates(cells, n).filter((c) => rate(cells, n, line, c, other(seat))[0] >= WIN).length >= 2) net -= WIN / 100;
      cells[answer.cell] = null;
    }
    cells[option.cell] = null;
    if (net > bestNet) [best, bestNet] = [option, net];
  }
  return best.cell;
}

// -- Ultimate: look a few moves ahead, and judge what's left by the small boards held and the
// lines of them still open.
const SPOT_WEIGHT = [1.2, 1, 1.2, 1, 1.4, 1, 1.2, 1, 1.2];
function judge(s: TicTacToeState, seat: number): number {
  const blocks = s.blocks!;
  let total = 0;
  for (let b = 0; b < 9; b++) {
    const held = blocks[b];
    if (held === seat) total += 100 * SPOT_WEIGHT[b]!;
    else if (typeof held === "number") total -= 100 * SPOT_WEIGHT[b]!;
    else if (held === null) {
      for (const l of LINES3) {
        let mine = 0;
        let theirs = 0;
        for (const i of l) {
          const m = s.cells[cellIn(b, i)];
          if (m === seat) mine++;
          else if (m !== null) theirs++;
        }
        if (!theirs) total += [0, 1, 6][mine]! * SPOT_WEIGHT[b]!;
        if (!mine) total -= [0, 1, 6][theirs]! * SPOT_WEIGHT[b]!;
      }
    }
  }
  for (const l of LINES3) {
    const held = l.map((i) => blocks[i]);
    const mine = held.filter((h) => h === seat).length;
    const theirs = held.filter((h) => typeof h === "number" && h !== seat).length;
    const dead = held.some((h) => h === "draw");
    if (!dead && !theirs) total += [0, 30, 250][mine] ?? 0;
    if (!dead && !mine) total -= [0, 30, 250][theirs] ?? 0;
  }
  return total;
}

/** The value of the position for `seat`, who is about to move, looking `depth` moves ahead. */
function search(s: TicTacToeState, seat: number, depth: number, alpha: number, beta: number): number {
  const moves = openCells(s);
  if (depth === 0) return judge(s, seat);
  let best = -Infinity;
  for (const cell of moves) {
    const next = { ...s, cells: [...s.cells], blocks: [...s.blocks!] };
    const end = place(next, seat, cell);
    // Sooner wins are better than later ones.
    const value = end === "won" ? 100000 + depth : end === "draw" ? 0 : -search(next, other(seat), depth - 1, -beta, -alpha);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function bestUltimateMove(s: TicTacToeState, seat: number, depth: number, rand: () => number): number {
  const moves = openCells(s);
  // A free choice of all nine boards is a lot of moves: look one move less far.
  const deep = moves.length > 27 ? depth - 1 : depth;
  let best = moves[0]!;
  let bestValue = -Infinity;
  for (const cell of moves) {
    const next = { ...s, cells: [...s.cells], blocks: [...s.blocks!] };
    const end = place(next, seat, cell);
    const value = (end === "won" ? 100000 + deep : end === "draw" ? 0 : -search(next, other(seat), deep - 1, -Infinity, Infinity)) + rand();
    if (value > bestValue) [best, bestValue] = [cell, value];
  }
  return best;
}

function bot(s: TicTacToeState, seat: number, style: PlayStyle, rand: () => number = Math.random): TicTacToeMove | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const open = openCells(s);
  if (ultimate(s)) {
    if (careless(style, rand)) return { type: "mark", cell: pickRandom(open, rand) };
    return { type: "mark", cell: bestUltimateMove(s, seat, (style.skill ?? 1) >= 0.9 ? 4 : (style.skill ?? 1) >= 0.5 ? 3 : 2, rand) };
  }
  if (s.rules.size === 3 && s.rules.line === 3) {
    if (careless(style, rand)) return { type: "mark", cell: pickRandom(open, rand) };
    return { type: "mark", cell: pickRandom(bestClassicMoves(s.cells, seat), rand) };
  }
  // A careless move on a big board is still somewhere near the action, just not thought through.
  if (careless(style, rand)) return { type: "mark", cell: pickRandom(candidates(s.cells, s.rules.size), rand) };
  return { type: "mark", cell: bestBigMove(s, seat, rand) };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): TicTacToeRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<TicTacToeRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicTicTacToe;
  const r = { ...base, ...given };
  const board = r.board === "ultimate" ? "ultimate" : "single";
  // Ultimate is always 3×3 boards and three in a row, whatever was saved with it.
  const size = board === "ultimate" ? 3 : Math.min(15, Math.max(3, Math.round(Number(r.size)) || 3));
  const line = board === "ultimate" ? 3 : Math.min(6, Math.max(3, Math.round(Number(r.line)) || 3));
  return {
    id: String(r.id),
    name: String(r.name),
    board,
    size,
    line,
    first: r.first === "seat1" || r.first === "seat2" ? r.first : "random",
    games: [1, 3, 5, 7].includes(Number(r.games)) ? Number(r.games) : 1,
  };
}

export const ticTacToe: BoardGame<TicTacToeRules, TicTacToeState, TicTacToeMove> = {
  id: "tictactoe",
  name: "Tic-Tac-Toe",
  emoji: "⭕",
  blurb: "Three in a row, or nine boards at once",
  tagline: "Xs and Os: get yours in a row first. Try Ultimate when three in a row gets too easy.",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "board", label: "Board", kind: "choice", options: [["single", "One board"], ["ultimate", "Ultimate: nine small boards"]] },
    { key: "size", label: "Board size (one board)", kind: "choice", options: SIZES.map((n) => [n, `${n}×${n}`]) },
    { key: "line", label: "In a row to win (one board)", kind: "choice", options: [[3, "Three"], [4, "Four"], [5, "Five"], [6, "Six"]] },
    { key: "first", label: "Who goes first", kind: "choice", options: [["random", "Luck of the draw"], ["seat1", "The first seat"], ["seat2", "The second seat"]] },
    { key: "games", label: "Games in a match", kind: "choice", options: [[1, "Just one"], [3, "Three"], [5, "Five"], [7, "Seven"]] },
  ],
  normalize,
  validate(r) {
    return r.board === "single" && r.line > r.size ? [`${r.line} in a row doesn't fit on a ${r.size}×${r.size} board.`] : [];
  },
  describe(r) {
    const match = r.games > 1 ? [`A match is ${r.games} games; most wins takes it. Players take turns going first.`] : [];
    const first = r.first === "random" ? "X goes first; who gets to be X is the luck of the draw." : `X goes first, and the ${r.first === "seat1" ? "first" : "second"} seat is X.`;
    if (r.board === "ultimate") {
      return [
        "Nine small Tic-Tac-Toe boards make one big one. Take turns putting your mark in a square.",
        "The square you pick says where the other player goes next: play the top-right square of a small board, and they must play in the top-right small board.",
        "Three in a row in a small board wins that board. If you're sent to a board that's finished, play in any open one.",
        "Win three small boards in a row to win. If every board is finished first, it's a draw.",
        first,
        ...match,
      ];
    }
    return [
      `Take turns putting your mark on a ${r.size}×${r.size} board.`,
      `${["Three", "Four", "Five", "Six"][r.line - 3]} in a row wins: across, down or on a slant.${r.line < r.size ? " More than that in a row wins too." : ""}`,
      "If the board fills up first, it's a draw.",
      first,
      ...match,
    ];
  },
  newGame: newTicTacToe,
  apply,
  view,
  bot,
  thinkingTime: (s) => thinkFor(Math.min(openCells(s).length, 6), s.last === null ? 0.7 : 1),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "tictactoe",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.round,
      scoreLine: `${s.wins[0]} to ${s.wins[1]}${s.draws ? ` · ${s.draws} drawn` : ""}`,
      order: over ? order(s) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
