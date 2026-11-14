// Reversi. Two players, dark and light discs, on a square board. On your turn you put a disc down
// so that it traps a straight run of the other player's discs between it and another of yours, in
// any of the eight directions, and every disc trapped turns over to your colour. A move has to turn
// at least one. A player with no move sits the turn out, and when neither can move the game is
// over: most discs wins.
//
// Dark always goes first. A table can play one game or a short match; in a match the players take
// turns playing dark.
import type { PlayStyle } from "@spades/rules";
import { cellName, DIRECTIONS, type BoardGame, type BoardGrid, type BoardPiece, type BoardView } from "./board.js";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, thinkFor, who, type BaseRules } from "./table.js";

export interface ReversiRules extends BaseRules {
  /** The board is size × size. */
  size: number;
  /** Who plays dark (and so goes first) in the first game. */
  first: "random" | "seat1" | "seat2";
  /** Show where you can move. Off is the purist's game: you find the moves yourself. */
  hints: boolean;
  /** Games in a match: most wins takes it. */
  games: number;
}

export const classicReversi: ReversiRules = { id: "reversi-classic", name: "Classic 8×8", size: 8, first: "random", hints: true, games: 1 };
export const smallReversi: ReversiRules = { id: "reversi-small", name: "Small 6×6", size: 6, first: "random", hints: true, games: 1 };
export const bigReversi: ReversiRules = { id: "reversi-big", name: "Big 10×10", size: 10, first: "random", hints: true, games: 1 };
const PRESETS = [classicReversi, smallReversi, bigReversi];
const SIZES = [6, 8, 10];

/** A cell: the seat whose disc is there, or null. */
type Disc = number | null;

export interface ReversiState {
  game: "reversi";
  rules: ReversiRules;
  seats: number;
  rng: number;
  /** Which game of the match, from 1. */
  round: number;
  /** Who plays dark (and so goes first) in this game. */
  first: number;
  /** Row by row from the top left, size × size. */
  cells: Disc[];
  turn: number;
  /** Where the last disc went down, and the discs it turned over. */
  last: number | null;
  flipped: number[];
  /** The seat that had no move after the last one and sat its turn out; null when play just passed across. */
  passed: number | null;
  /** Who won the game just played; null for a draw (or while playing). */
  roundWinner: number | null;
  wins: number[];
  draws: number;
  phase: "playing" | "scored" | "finished";
  ready: boolean[];
  narration: string | null;
}

export type ReversiMove = { type: "place"; cell: number } | { type: "next" };

const other = (seat: number) => 1 - seat;

// ---- The board ------------------------------------------------------------------------------------

/**
 * From every cell, the cells along each of the eight directions out to the edge. Worked out once
 * per board size: both the rules and the computer player walk these instead of doing the sums again.
 * Directions with fewer than two cells are left out, since nothing can be trapped along them.
 */
const RAYS = new Map<number, number[][][]>();
function raysOf(n: number): number[][][] {
  let rays = RAYS.get(n);
  if (rays) return rays;
  rays = [];
  for (let cell = 0; cell < n * n; cell++) {
    const from: number[][] = [];
    for (const [dr, dc] of DIRECTIONS) {
      const ray: number[] = [];
      for (let r = Math.floor(cell / n) + dr!, c = (cell % n) + dc!; r >= 0 && r < n && c >= 0 && c < n; r += dr!, c += dc!) ray.push(r * n + c);
      if (ray.length >= 2) from.push(ray);
    }
    rays.push(from);
  }
  RAYS.set(n, rays);
  return rays;
}

/** The discs a disc of `seat`'s in `cell` would turn over: empty when the move isn't allowed. */
export function flipsFor(cells: readonly Disc[], n: number, cell: number, seat: number): number[] {
  if (cells[cell] !== null) return [];
  const out: number[] = [];
  for (const ray of raysOf(n)[cell]!) {
    let i = 0;
    while (i < ray.length && cells[ray[i]!] === other(seat)) i++;
    // A run of theirs with one of mine at the far end.
    if (i > 0 && i < ray.length && cells[ray[i]!] === seat) for (let k = 0; k < i; k++) out.push(ray[k]!);
  }
  return out;
}

/** Every cell `seat` could play in. */
export function legalMoves(cells: readonly Disc[], n: number, seat: number): number[] {
  const out: number[] = [];
  for (let cell = 0; cell < cells.length; cell++) if (cells[cell] === null && flipsFor(cells, n, cell, seat).length) out.push(cell);
  return out;
}

/** How many discs each seat has on the board. */
export function discCount(cells: readonly Disc[]): [number, number] {
  const count: [number, number] = [0, 0];
  for (const d of cells) if (d !== null) count[d]! += 1;
  return count;
}

function startRound(s: ReversiState) {
  const n = s.rules.size;
  s.cells = Array<Disc>(n * n).fill(null);
  // The four in the middle: light on the slant from the top left, dark on the other.
  const a = n / 2 - 1;
  const b = n / 2;
  s.cells[a * n + a] = s.cells[b * n + b] = other(s.first);
  s.cells[a * n + b] = s.cells[b * n + a] = s.first;
  s.turn = s.first;
  s.last = null;
  s.flipped = [];
  s.passed = null;
  s.roundWinner = null;
  s.phase = "playing";
  s.ready = Array<boolean>(s.seats).fill(false);
  s.narration = null;
}

export function newReversi(rules: ReversiRules, seats: number, seed: number): ReversiState {
  const s = { game: "reversi", rules, seats: 2, rng: seed >>> 0, round: 1, wins: [0, 0], draws: 0 } as ReversiState;
  s.first = rules.first === "seat1" ? 0 : rules.first === "seat2" ? 1 : nextRandom(s)() < 0.5 ? 0 : 1;
  startRound(s);
  return s;
}

// ---- Moves --------------------------------------------------------------------------------------

/** How a match stands once this game is in: finished when the games run out or one side can't be caught. */
function matchOver(s: ReversiState): boolean {
  const left = s.rules.games - s.round;
  return left <= 0 || Math.abs(s.wins[0]! - s.wins[1]!) > left;
}

const colourOf = (s: Pick<ReversiState, "first">, seat: number) => (seat === s.first ? "dark" : "light");

function apply(state: ReversiState, seat: number, move: ReversiMove): ReversiState {
  if (move?.type === "next") {
    if (state.phase !== "scored") throw new GameError("There's a game going on.");
    const s = clone(state);
    if (markReady(s.ready, seat)) {
      // Take turns playing dark.
      s.round += 1;
      s.first = other(s.first);
      startRound(s);
    }
    return s;
  }
  if (move?.type !== "place") throw new GameError("That's not a move in Reversi.");
  if (state.phase !== "playing") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const cell = Number(move.cell);
  if (!Number.isInteger(cell) || cell < 0 || cell >= state.cells.length) throw new GameError("That's not on the board.");
  if (state.cells[cell] !== null) throw new GameError("There's a disc there already.");
  const n = state.rules.size;
  const flips = flipsFor(state.cells, n, cell, seat);
  if (!flips.length) throw new GameError("A disc there wouldn't flip anything: it has to trap at least one of theirs in a line.");

  const s = clone(state);
  s.cells[cell] = seat;
  for (const f of flips) s.cells[f] = seat;
  s.last = cell;
  s.flipped = flips;
  s.passed = null;
  // (The table turns "{0} plays" into "You play" for the player it names; one verb each keeps that right.)
  const played = `${who(seat)} plays ${cellName(gridOf(n), cell)}, flipping ${flips.length}`;
  if (legalMoves(s.cells, n, other(seat)).length) {
    s.turn = other(seat);
    s.narration = played;
    return s;
  }
  if (legalMoves(s.cells, n, seat).length) {
    // Nowhere for the other player to go: they sit this turn out, and the same player moves again.
    s.passed = other(seat);
    s.narration = `${played}. ${who(other(seat))} has no move and must pass, so ${who(seat)} goes again`;
    return s;
  }

  // Neither can move: count up.
  const [a, b] = discCount(s.cells);
  const many = s.rules.games > 1;
  const full = s.cells.every((d) => d !== null);
  const why = full ? "The board is full" : "Nobody can move";
  if (a === b) {
    s.draws += 1;
    s.narration = `${why}. ${many ? `Game ${s.round} is a draw` : "It's a draw"}, ${a} all`;
  } else {
    const winner = a > b ? 0 : 1;
    s.wins[winner]! += 1;
    s.roundWinner = winner;
    s.narration = `${why}. ${who(winner)} wins${many ? ` game ${s.round}` : ""} ${Math.max(a, b)} to ${Math.min(a, b)}`;
  }
  s.phase = matchOver(s) ? "finished" : "scored";
  return s;
}

/** Best first. A drawn match lists the player who went second in the last game first, as Tic-Tac-Toe does. */
function order(s: ReversiState): number[] {
  const [a, b] = s.wins as [number, number];
  if (a !== b) return a > b ? [0, 1] : [1, 0];
  return [other(s.first), s.first];
}
const winners = (s: ReversiState) => (s.wins[0] === s.wins[1] ? [0, 1] : [s.wins[0]! > s.wins[1]! ? 0 : 1]);

// ---- What a seat sees ---------------------------------------------------------------------------

const DARK: Omit<BoardPiece, "owner"> = { kind: "disc", glyph: "●", label: "dark", tone: "dark" };
const LIGHT: Omit<BoardPiece, "owner"> = { kind: "disc", glyph: "●", label: "light", tone: "light" };
const discOf = (s: Pick<ReversiState, "first">, seat: number): BoardPiece => ({ ...(seat === s.first ? DARK : LIGHT), owner: seat });

/** The board without its discs: enough to name a cell. Columns a, b, c…; rows 1, 2, 3… from the top, the way Reversi is written down. */
function gridOf(n: number): Pick<BoardGrid, "cols" | "coords"> {
  return { cols: n, coords: { cols: Array.from({ length: n }, (_, c) => String.fromCharCode(97 + c)), rows: Array.from({ length: n }, (_, r) => String(r + 1)) } };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function view(s: ReversiState, seat: number): BoardView {
  const over = s.phase === "finished";
  const mine = s.phase === "playing" && s.turn === seat;
  const many = s.rules.games > 1;
  const n = s.rules.size;
  const w = over ? winners(s) : [];
  const discs = discCount(s.cells);
  const legal = mine ? legalMoves(s.cells, n, seat) : [];
  const marks: NonNullable<BoardGrid["marks"]> = [];
  if (s.last !== null) marks.push({ cell: s.last, mark: "last" });
  for (const cell of s.flipped) marks.push({ cell, mark: "flipped" });
  // Where you can go is only pointed out when the table plays that way.
  if (s.rules.hints) for (const cell of legal) marks.push({ cell, mark: "hint" });
  const grid: BoardGrid = {
    id: "board",
    label: "Board",
    rows: n,
    ...gridOf(n),
    cells: s.cells.map((d) => (d === null ? null : discOf(s, d))),
    marks,
    // The purist's game: any empty cell can be tried, and the rules refuse the ones that flip nothing.
    tap: mine ? { type: "place", cells: s.rules.hints ? legal : s.cells.flatMap((d, i) => (d === null ? [i] : [])) } : null,
  };
  const [a, b] = discs;
  const scoreTitle = s.roundWinner === null ? `Game ${s.round} is a draw` : `${who(s.roundWinner)} wins game ${s.round}`;
  const title = () => {
    if (w.length > 1) return many ? "It's a draw!" : `It's a draw: ${a} all!`;
    const tally = many ? s.wins : discs;
    return `${who(w[0]!)} wins ${tally[w[0]!]} to ${tally[other(w[0]!)]}!`;
  };
  return {
    game: "reversi",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" ? s.turn : null,
    grids: [grid],
    reserves: [],
    choices: s.phase === "scored" ? nextHandChoices(s.ready, seat, false, "Next game") : null,
    players: discs.map((count, i) => ({
      line: `${plural(count, "disc")}${many ? ` · ${plural(s.wins[i]!, "win")}` : ""}`,
      piece: discOf(s, i),
      badge: s.phase !== "playing" ? undefined : s.passed === i ? "No move" : s.last === null && i === s.first ? "Goes first" : undefined,
    })),
    info: ["Most discs wins", ...(many ? [`Game ${s.round} of ${s.rules.games}`] : []), ...(s.rules.hints ? [] : ["Find your own moves: a disc must flip at least one"])],
    narration: s.narration ?? (mine ? "You're dark: you go first" : null),
    // One game is scored in discs; a match in games won, with the discs under each name.
    scores: (many ? s.wins : discs).map((value, i) => ({ seats: [i], value })),
    result:
      many && s.phase !== "playing"
        ? {
            key: `game-${s.round}`,
            title: scoreTitle,
            sides: [[0], [1]],
            rows: [{ label: "Discs", values: discs.map(String), tone: "score" }, { label: "Wins", values: s.wins.map(String), tone: "total" }, ...(s.draws ? [{ label: "Draws", values: [String(s.draws), String(s.draws)] }] : [])],
          }
        : null,
    over: over ? { winners: w, title: title() } : null,
  };
}

// ---- The computer player --------------------------------------------------------------------------
// It looks ahead: every move it could make, every answer to each, and so on a few moves deep,
// skipping lines that can't change its mind (alpha-beta). Where the looking stops, the position is
// judged the way a good player would: corners can never be flipped back, so they are worth a lot;
// the squares next to an empty corner hand it to the other player, so they cost; edges are good; and
// having more places to go than the other player matters more than having more discs, until near the
// end, when discs are all that counts. With few empty squares left it stops judging and plays the
// rest out exactly. A careless player (see `careless`) just puts a disc somewhere legal.
//
// It works on its own copy of the board: +1 for the player to move, -1 for the other, 0 for empty.

interface Geometry {
  n: number;
  rays: number[][][];
  /** What holding each cell is worth, apart from the cells beside the corners (those depend on the corner). */
  worth: number[];
  /** Cells in the order worth trying them: the best-looking first, so the search can skip more. */
  order: number[];
  /** Each corner with the cell on its slant and the two edge cells beside it. */
  corners: { corner: number; slant: number; sides: [number, number] }[];
}

const GEOMETRY = new Map<number, Geometry>();
function geometryOf(n: number): Geometry {
  let g = GEOMETRY.get(n);
  if (g) return g;
  const worth: number[] = [];
  const rank: number[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      // How far in from the nearest edges.
      const dr = Math.min(r, n - 1 - r);
      const dc = Math.min(c, n - 1 - c);
      const [near, far] = dr < dc ? [dr, dc] : [dc, dr];
      const corner = far === 0;
      const beside = near <= 1 && far === 1;
      worth.push(corner ? 120 : beside ? 0 : near === 0 ? (far === 2 ? 12 : 8) : near === 1 ? -4 : near === 2 && far === 2 ? 4 : 1);
      rank.push(corner ? 1000 : beside ? (near === 1 ? -100 : -50) : worth[worth.length - 1]!);
    }
  }
  const at = (r: number, c: number) => r * n + c;
  const m = n - 1;
  g = {
    n,
    rays: raysOf(n),
    worth,
    order: worth.map((_, i) => i).sort((x, y) => rank[y]! - rank[x]!),
    corners: [
      { corner: at(0, 0), slant: at(1, 1), sides: [at(0, 1), at(1, 0)] },
      { corner: at(0, m), slant: at(1, m - 1), sides: [at(0, m - 1), at(1, m)] },
      { corner: at(m, 0), slant: at(m - 1, 1), sides: [at(m, 1), at(m - 1, 0)] },
      { corner: at(m, m), slant: at(m - 1, m - 1), sides: [at(m, m - 1), at(m - 1, m)] },
    ],
  };
  GEOMETRY.set(n, g);
  return g;
}

/** Whether `me` could play in an empty `cell`. */
function canPlay(g: Geometry, b: Int8Array, cell: number, me: number): boolean {
  for (const ray of g.rays[cell]!) {
    if (b[ray[0]!] !== -me) continue;
    let i = 1;
    while (i < ray.length && b[ray[i]!] === -me) i++;
    if (i < ray.length && b[ray[i]!] === me) return true;
  }
  return false;
}

/** Put `me` in `cell`: turns the trapped discs over and returns them, or nothing when the move isn't allowed (and nothing changed). */
function playAt(g: Geometry, b: Int8Array, cell: number, me: number): number[] | null {
  let flips: number[] | null = null;
  for (const ray of g.rays[cell]!) {
    if (b[ray[0]!] !== -me) continue;
    let i = 1;
    while (i < ray.length && b[ray[i]!] === -me) i++;
    if (i < ray.length && b[ray[i]!] === me) {
      flips ??= [];
      for (let k = 0; k < i; k++) flips.push(ray[k]!);
    }
  }
  if (!flips) return null;
  b[cell] = me;
  for (const f of flips) b[f] = me;
  return flips;
}
function takeBack(b: Int8Array, cell: number, me: number, flips: number[]) {
  b[cell] = 0;
  for (const f of flips) b[f] = -me;
}

function mobility(g: Geometry, b: Int8Array, me: number): number {
  let count = 0;
  for (let cell = 0; cell < b.length; cell++) if (b[cell] === 0 && canPlay(g, b, cell, me)) count++;
  return count;
}

/** A finished game is worth more than anything a judgement can say, and a bigger win more than a smaller one. */
const DECIDED = 10000;
function finalValue(b: Int8Array, me: number): number {
  let diff = 0;
  for (let i = 0; i < b.length; i++) diff += b[i]!;
  return diff * me * DECIDED;
}

/** How good the position looks for `me`. */
function judge(g: Geometry, b: Int8Array, me: number): number {
  let place = 0;
  let discs = 0;
  let empty = 0;
  for (let i = 0; i < b.length; i++) {
    const d = b[i]!;
    if (d === 0) empty++;
    else {
      place += d * g.worth[i]!;
      discs += d;
    }
  }
  for (const { corner, slant, sides } of g.corners) {
    const held = b[corner]!;
    // Beside an empty corner is a gift to whoever isn't there; beside a corner you hold is as safe as the corner.
    if (held === 0) place -= b[slant]! * 45 + (b[sides[0]]! + b[sides[1]]!) * 18;
    else place += ((b[sides[0]] === held ? held : 0) + (b[sides[1]] === held ? held : 0)) * 14;
  }
  const moves = mobility(g, b, 1) - mobility(g, b, -1);
  // Discs only start to count as the board fills up.
  const late = empty * 4 <= b.length;
  return me * (place + moves * 11 + discs * (late ? 6 : 0));
}

interface Search {
  g: Geometry;
  b: Int8Array;
  /** Work done (positions looked at, more or less), and the most it may do: past that it gives up and the answer so far stands. */
  nodes: number;
  limit: number;
  stopped: boolean;
}

/** The value of the position for `me`, who is about to move, looking `depth` moves ahead. `passed`: the other player just had no move. */
function search(x: Search, me: number, depth: number, alpha: number, beta: number, passed: boolean): number {
  if (++x.nodes > x.limit) {
    x.stopped = true;
    return 0;
  }
  const { g, b } = x;
  if (depth <= 0) return judge(g, b, me);
  let best = -Infinity;
  if (depth >= 3) {
    // Worth a moment to try the most promising moves first: the ones that leave the other player the fewest answers.
    const options: { cell: number; key: number }[] = [];
    for (const cell of g.order) {
      if (b[cell] !== 0) continue;
      const flips = playAt(g, b, cell, me);
      if (!flips) continue;
      options.push({ cell, key: mobility(g, b, -me) * 8 - g.worth[cell]! });
      takeBack(b, cell, me, flips);
    }
    options.sort((p, q) => p.key - q.key);
    // Sorting them was work too.
    x.nodes += options.length;
    for (const { cell } of options) {
      const flips = playAt(g, b, cell, me)!;
      const value = -search(x, -me, depth - 1, -beta, -alpha, false);
      takeBack(b, cell, me, flips);
      if (x.stopped) return 0;
      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) return best;
    }
  } else {
    for (const cell of g.order) {
      if (b[cell] !== 0) continue;
      const flips = playAt(g, b, cell, me);
      if (!flips) continue;
      const value = -search(x, -me, depth - 1, -beta, -alpha, false);
      takeBack(b, cell, me, flips);
      if (x.stopped) return 0;
      if (value > best) best = value;
      if (best > alpha) alpha = best;
      if (alpha >= beta) return best;
    }
  }
  if (best > -Infinity) return best;
  // No move: the game is over if the other player had none either; otherwise it's their turn again.
  if (passed) return finalValue(b, me);
  return -search(x, -me, depth, -beta, -alpha, true);
}

/** How hard a computer player thinks: moves ahead, how many empty squares it can play out exactly, and how much work it may do. */
export interface ReversiEffort {
  depth: number;
  exact: number;
  limit: number;
}

/** In the opening, moves judged within this much of the best are all good enough to play. */
const OPENING_SLACK = 12;
/**
 * The most work for one move. A unit costs about a microsecond on a 6×6 board and three on a 10×10
 * (there is more board to look over), so this keeps the slowest move to a few dozen milliseconds at
 * every size: the server thinks for every table on one thread.
 */
const workLimit = (n: number) => Math.round(800_000 / (n * n));
function effortFor(n: number, skill: number): ReversiEffort {
  const limit = workLimit(n);
  if (skill >= 0.85) return { depth: n <= 6 ? 7 : n <= 8 ? 5 : 4, exact: n <= 6 ? 12 : n <= 8 ? 11 : 10, limit };
  if (skill >= 0.5) return { depth: 3, exact: 6, limit };
  return { depth: 1, exact: 0, limit };
}

/**
 * The move the search likes best for `seat`. It looks one move further each time round, trying the
 * best move so far first, so if the work runs out the last finished look still stands.
 */
export function bestReversiMove(cells: readonly Disc[], n: number, seat: number, effort: ReversiEffort, rand: () => number = Math.random): number | null {
  const g = geometryOf(n);
  const b = Int8Array.from(cells, (d) => (d === null ? 0 : d === seat ? 1 : -1));
  // Moves that look equally good are tried in a different order each time, so it doesn't always play the same game.
  const keyed = legalMoves(cells, n, seat).map((cell) => ({ cell, key: g.order.indexOf(cell) + rand() * 3 }));
  let moves = keyed.sort((p, q) => p.key - q.key).map((o) => o.cell);
  if (moves.length <= 1) return moves[0] ?? null;
  const x: Search = { g, b, nodes: 0, limit: effort.limit, stopped: false };
  const empty = b.reduce((count, d) => count + (d === 0 ? 1 : 0), 0);
  // In the first few moves there is little to choose between the good ones, so it picks any of
  // them: otherwise two computer players would play the same game every time.
  const opening = b.length - empty - 4 < n;
  const look = (depth: number, loose = false): number | null => {
    let best = moves[0]!;
    let alpha = -Infinity;
    const close: { cell: number; value: number }[] = [];
    for (const cell of moves) {
      const flips = playAt(g, b, cell, 1)!;
      // Picking among near-equals needs each move's real value, not just "no better than the best".
      const value = -search(x, -1, depth - 1, -Infinity, loose ? Infinity : -alpha, false);
      takeBack(b, cell, 1, flips);
      if (x.stopped) return null;
      if (loose) close.push({ cell, value });
      if (value > alpha) [best, alpha] = [cell, value];
    }
    return loose ? pickRandom(close.filter((o) => o.value >= alpha - OPENING_SLACK), rand).cell : best;
  };
  let best = moves[0]!;
  // (And it needn't look far to do that.)
  const deepest = Math.min(opening ? Math.min(effort.depth, 3) : effort.depth, empty);
  for (let depth = 1; depth <= deepest; depth++) {
    const found = look(depth, opening && depth === deepest);
    if (found === null) return best;
    best = found;
    moves = [best, ...moves.filter((cell) => cell !== best)];
  }
  // Near the end, play it out to the last disc.
  if (empty <= effort.exact && empty > effort.depth) best = look(empty + 1) ?? best;
  return best;
}

function bot(s: ReversiState, seat: number, style: PlayStyle, rand: () => number = Math.random): ReversiMove | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const n = s.rules.size;
  if (careless(style, rand)) return { type: "place", cell: pickRandom(legalMoves(s.cells, n, seat), rand) };
  return { type: "place", cell: bestReversiMove(s.cells, n, seat, effortFor(n, style.skill ?? 1), rand)! };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): ReversiRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<ReversiRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicReversi;
  const r = { ...base, ...given };
  return {
    id: String(r.id),
    name: String(r.name),
    size: SIZES.includes(Number(r.size)) ? Number(r.size) : 8,
    first: r.first === "seat1" || r.first === "seat2" ? r.first : "random",
    hints: r.hints !== false,
    games: [1, 3, 5, 7].includes(Number(r.games)) ? Number(r.games) : 1,
  };
}

export const reversi: BoardGame<ReversiRules, ReversiState, ReversiMove> = {
  id: "reversi",
  name: "Reversi",
  emoji: "⚫",
  blurb: "Trap their discs and flip them to yours",
  tagline: "Dark against light: trap a line of their discs between two of yours and they all turn over. Most discs at the end wins.",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "size", label: "Board size", kind: "choice", options: SIZES.map((n) => [n, `${n}×${n}`]) },
    { key: "first", label: "Who plays dark and goes first", kind: "choice", options: [["random", "Luck of the draw"], ["seat1", "The first seat"], ["seat2", "The second seat"]] },
    { key: "hints", label: "Show where you can move", hint: "Off is the purist's game: tap any empty square, and a move that flips nothing is refused.", kind: "toggle" },
    { key: "games", label: "Games in a match", kind: "choice", options: [[1, "Just one"], [3, "Three"], [5, "Five"], [7, "Seven"]] },
  ],
  normalize,
  validate: () => [],
  describe(r) {
    return [
      `Dark and light take turns putting a disc on a ${r.size}×${r.size} board, starting from four in the middle.`,
      "Your disc has to trap a straight line of their discs between it and another of yours: across, down or on a slant. Every disc trapped flips to your colour, in every direction at once.",
      "If you have no move, your turn is passed. When neither of you can move, whoever has the most discs wins; the same number is a draw.",
      r.first === "random" ? "Dark goes first; who gets to be dark is the luck of the draw." : `Dark goes first, and the ${r.first === "seat1" ? "first" : "second"} seat is dark.`,
      r.hints ? "The squares you can move to are marked." : "The squares you can move to aren't marked: you find them yourself.",
      ...(r.games > 1 ? [`A match is ${r.games} games; most wins takes it. Players take turns playing dark.`] : []),
    ];
  },
  newGame: newReversi,
  apply,
  view,
  bot,
  thinkingTime: (s) => thinkFor(Math.min(s.phase === "playing" ? legalMoves(s.cells, s.rules.size, s.turn).length : 0, 6), s.last === null ? 0.7 : 1),
  summary(s) {
    const over = s.phase === "finished";
    const [a, b] = discCount(s.cells);
    return {
      game: "reversi",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.round,
      // One game is told in discs, a match in games won.
      scoreLine: s.rules.games > 1 ? `${s.wins[0]} to ${s.wins[1]}${s.draws ? ` · ${s.draws} drawn` : ""}` : `${a} to ${b}`,
      order: over ? order(s) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
