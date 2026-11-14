// Checkers (draughts), the ways families and federations play it. The rules that differ from one
// tradition to the next are house rules here, so a table can mix them: the size of the board,
// whether men capture backwards, whether kings fly the length of a diagonal, whether a capture has
// to be taken (and whether it has to be the biggest one), and what happens to a man that reaches
// the far row in the middle of a capture.
//
// A multi-jump is played a hop at a time: the player taps each landing square in turn and keeps the
// turn until the capture is finished. The state remembers the capture in progress (`jump`), so the
// server checks every hop as it is made, the other player watches the hops happen, and a phone only
// ever asks for one tap on one square. Pieces jumped stay on the board, faded, until the whole move
// is done, and can't be jumped twice or passed over again: that is the rule in International and
// Russian draughts, and for pieces that move a square at a time it plays exactly as taking them off
// at once would.
//
// The board is kept one way up whoever is looking: the side that moves first starts on the bottom
// rows and moves up. Each seat's view asks the table to draw the board from its own side.
import type { PlayStyle } from "@spades/rules";
import { cellName, chessCoords, type BoardGame, type BoardGrid, type BoardPiece, type BoardView } from "./board.js";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, thinkFor, who, type BaseRules } from "./table.js";

export interface CheckersRules extends BaseRules {
  /** The board is size × size, with size ÷ 2 − 1 rows of men a side: 12 men on 8×8, 20 on 10×10. */
  size: number;
  /** Men capture backwards as well as forwards. (They only ever move forwards.) */
  backward: boolean;
  /** Kings move and capture any distance along a diagonal, instead of one square. */
  flying: boolean;
  /** A capture has to be taken when there is one, and carried on while it can be. */
  forced: boolean;
  /** With forced captures: the capture that takes the most pieces has to be the one played. */
  most: boolean;
  /**
   * A man that reaches the far row in the middle of a capture: "stop" crowns it and ends the move,
   * "pass" lets it carry on as a man (crowned only if the move ends there), "king" crowns it and it
   * carries on as a king.
   */
  crowning: "stop" | "pass" | "king";
  /** Which colour moves first. */
  opens: "dark" | "light";
  /** Who has the first move in the first game. */
  first: "random" | "seat1" | "seat2";
  /** A draw after this many moves by each side with no capture and no man moved. */
  quiet: number;
  /** Games in a match: most wins takes it. */
  games: number;
}

export const americanCheckers: CheckersRules = { id: "checkers-american", name: "American (8×8)", size: 8, backward: false, flying: false, forced: true, most: false, crowning: "stop", opens: "dark", first: "random", quiet: 40, games: 1 };
export const internationalCheckers: CheckersRules = { id: "checkers-international", name: "International (10×10)", size: 10, backward: true, flying: true, forced: true, most: true, crowning: "pass", opens: "light", first: "random", quiet: 40, games: 1 };
export const russianCheckers: CheckersRules = { id: "checkers-russian", name: "Russian (flying kings)", size: 8, backward: true, flying: true, forced: true, most: false, crowning: "king", opens: "light", first: "random", quiet: 40, games: 1 };
export const friendlyCheckers: CheckersRules = { ...americanCheckers, id: "checkers-friendly", name: "Friendly (jumps optional)", forced: false };
const PRESETS = [americanCheckers, internationalCheckers, russianCheckers, friendlyCheckers];
const SIZES = [8, 10];

/** A piece on the board: whose it is, whether it has been crowned, and a number it keeps all game. */
export interface CheckersPiece {
  o: number;
  k: boolean;
  id: number;
}

export interface CheckersState {
  game: "checkers";
  rules: CheckersRules;
  seats: number;
  rng: number;
  /** Which game of the match, from 1. */
  round: number;
  /** Who moves first in this game: they start on the bottom rows of `cells` and move up. */
  first: number;
  /** Row by row from the top left, size × size. Only the dark squares are ever used. */
  cells: (CheckersPiece | null)[];
  turn: number;
  /**
   * A capture in progress: where the move began, where the piece is now, every square it has
   * landed on, and the pieces jumped so far (still on the board until the move is done).
   */
  jump: { from: number; at: number; path: number[]; over: number[]; crowned: boolean } | null;
  /** The last finished move: every square the piece stood on, first to last. */
  last: number[] | null;
  /** What each seat has captured. */
  taken: { men: number; kings: number }[];
  /** Moves (by either side) since a capture or a man's move. */
  quiet: number;
  /** How often each position has come up since then, for the threefold rule. */
  seen: Record<string, number>;
  /** Who won the game just played; null for a draw (or while playing). */
  roundWinner: number | null;
  wins: number[];
  draws: number;
  phase: "playing" | "scored" | "finished";
  ready: boolean[];
  narration: string | null;
}

export type CheckersMove = { type: "move"; from: number; to: number } | { type: "stop" } | { type: "next" };

const other = (seat: number) => 1 - seat;

// ---- The board, and what can move on it ---------------------------------------------------------
// Move generation works on a plain list of numbers, so the computer player can look ahead quickly
// and the rules are written once: 0 is empty, 1 a man and 2 a king of the side that moves up the
// board (the one that opened), −1 and −2 the other side's.

interface Geo {
  n: number;
  /** For each of the four diagonals (up-left, up-right, down-left, down-right): the next square, or −1 off the edge. */
  next: Int16Array[];
  row: Int8Array;
  col: Int8Array;
  /** The squares in play. */
  dark: number[];
}
const geos = new Map<number, Geo>();
function geoOf(n: number): Geo {
  let g = geos.get(n);
  if (g) return g;
  const steps = [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const;
  const row = new Int8Array(n * n);
  const col = new Int8Array(n * n);
  const dark: number[] = [];
  const next = steps.map(() => new Int16Array(n * n));
  for (let sq = 0; sq < n * n; sq++) {
    const r = Math.floor(sq / n);
    const c = sq % n;
    row[sq] = r;
    col[sq] = c;
    if ((r + c) % 2 === 1) dark.push(sq);
    steps.forEach(([dr, dc], d) => {
      const [r2, c2] = [r + dr, c + dc];
      next[d]![sq] = r2 >= 0 && r2 < n && c2 >= 0 && c2 < n ? r2 * n + c2 : -1;
    });
  }
  g = { n, next, row, col, dark };
  geos.set(n, g);
  return g;
}

/** The rules a move generator needs, with the board's geometry. */
interface Gen {
  geo: Geo;
  backward: boolean;
  flying: boolean;
  forced: boolean;
  most: boolean;
  crowning: CheckersRules["crowning"];
}
const genOf = (r: CheckersRules): Gen => ({ geo: geoOf(r.size), backward: r.backward, flying: r.flying, forced: r.forced, most: r.forced && r.most, crowning: r.crowning });

type Grid = number[] | Int8Array;

/** A whole move: where the piece starts, each square it lands on, the pieces it jumps, and whether it ends up crowned. */
export interface CheckersLine {
  from: number;
  steps: number[];
  over: number[];
  crown: boolean;
}

/** The row a side's men are crowned on. */
const crownRow = (g: Gen, side: number) => (side > 0 ? 0 : g.geo.n - 1);

/**
 * How much looking for moves has been done: one for every piece looked at for jumps and every
 * quiet move found (and a dozen for every position a search stops at). A computer player's thinking is rationed by this and not by the clock, so it
 * plays the same on a slow machine, and a board full of flying kings can't make it slow.
 */
let work = 0;

/**
 * The jumps `piece` can make from `at`, as [jumped square, landing square, …]. `over` are pieces
 * already jumped in this move: they are still on the board and in the way, but can't be taken again.
 */
function jumpsFrom(g: Gen, b: Grid, at: number, piece: number, over: number[]): number[] {
  work++;
  const out: number[] = [];
  const side = piece > 0 ? 1 : -1;
  const king = piece === 2 || piece === -2;
  for (let d = 0; d < 4; d++) {
    // Up the board is forwards for the side that opened.
    if (!king && !g.backward && d < 2 !== side > 0) continue;
    const next = g.geo.next[d]!;
    let sq = next[at]!;
    if (king && g.flying) while (sq >= 0 && b[sq] === 0) sq = next[sq]!;
    if (sq < 0 || b[sq]! * side >= 0 || over.includes(sq)) continue;
    let land = next[sq]!;
    while (land >= 0 && b[land] === 0) {
      out.push(sq, land);
      if (!(king && g.flying)) break;
      land = next[land]!;
    }
  }
  return out;
}

/** Follow every capture from `at` to its end, adding each finished line to `out`. The moving piece is off the board meanwhile. */
function follow(g: Gen, b: Grid, from: number, at: number, piece: number, wasMan: boolean, steps: number[], over: number[], out: CheckersLine[]) {
  const jumps = jumpsFrom(g, b, at, piece, over);
  if (!jumps.length) {
    if (steps.length) out.push({ from, steps: [...steps], over: [...over], crown: wasMan && (Math.abs(piece) === 2 || g.geo.row[at] === crownRow(g, piece)) });
    return;
  }
  const side = piece > 0 ? 1 : -1;
  for (let i = 0; i < jumps.length; i += 2) {
    const victim = jumps[i]!;
    const land = jumps[i + 1]!;
    // A flying king that can land where the capture carries on has to (the biggest-capture rule
    // settles it by itself). Landings past one piece come together in `jumps`.
    if (g.forced && !g.most && Math.abs(piece) === 2 && g.flying) {
      let carries = false;
      for (let j = 0; j < jumps.length && !carries; j += 2) if (jumps[j] === victim && jumpsFrom(g, b, jumps[j + 1]!, piece, [...over, victim]).length) carries = true;
      if (carries && !jumpsFrom(g, b, land, piece, [...over, victim]).length) continue;
    }
    steps.push(land);
    over.push(victim);
    if (Math.abs(piece) === 1 && g.geo.row[land] === crownRow(g, side) && g.crowning !== "pass") {
      if (g.crowning === "stop") out.push({ from, steps: [...steps], over: [...over], crown: true });
      else follow(g, b, from, land, side * 2, true, steps, over, out);
    } else follow(g, b, from, land, piece, wasMan, steps, over, out);
    steps.pop();
    over.pop();
  }
}

/**
 * Every move `side` may make. With `jump`, only ways to carry on the capture in progress (none
 * when it is finished). Captures come first; when they are forced they are all there is.
 */
function linesFor(g: Gen, b: Grid, side: number, jump?: { at: number; over: number[] } | null, capturesOnly = false): CheckersLine[] {
  const caps: CheckersLine[] = [];
  const { dark, next, row } = g.geo;
  if (jump) {
    const piece = b[jump.at]!;
    b[jump.at] = 0;
    follow(g, b, jump.at, jump.at, piece, Math.abs(piece) === 1, [], [...jump.over], caps);
    b[jump.at] = piece;
    // The pieces jumped before now aren't part of what is still to come.
    for (const line of caps) line.over.splice(0, jump.over.length);
  } else {
    for (const sq of dark) {
      const piece = b[sq]!;
      if (piece * side <= 0) continue;
      b[sq] = 0;
      follow(g, b, sq, sq, piece, Math.abs(piece) === 1, [], [], caps);
      b[sq] = piece;
    }
  }
  if (caps.length && g.most) {
    const most = Math.max(...caps.map((l) => l.over.length));
    return caps.filter((l) => l.over.length === most);
  }
  if (jump || capturesOnly || (caps.length && g.forced)) return caps;
  for (const sq of dark) {
    const piece = b[sq]!;
    if (piece * side <= 0) continue;
    const king = Math.abs(piece) === 2;
    for (let d = 0; d < 4; d++) {
      if (!king && d < 2 !== side > 0) continue;
      let to = next[d]![sq]!;
      while (to >= 0 && b[to] === 0) {
        caps.push({ from: sq, steps: [to], over: [], crown: !king && row[to] === crownRow(g, side) });
        if (!(king && g.flying)) break;
        to = next[d]![to]!;
      }
    }
  }
  work += caps.length;
  return caps;
}

/** Whether `side` has a move that isn't a capture: enough to tell a quiet position from a lost one. */
function canStep(g: Gen, b: Grid, side: number): boolean {
  const { dark, next } = g.geo;
  for (const sq of dark) {
    const piece = b[sq]!;
    if (piece * side <= 0) continue;
    const king = piece === 2 || piece === -2;
    for (let d = 0; d < 4; d++) {
      if (!king && d < 2 !== side > 0) continue;
      const to = next[d]![sq]!;
      if (to >= 0 && b[to] === 0) return true;
    }
  }
  return false;
}

/** The side of the board a seat plays from: 1 moves up (it opened), −1 moves down. */
const sideOf = (s: Pick<CheckersState, "first">, seat: number) => (seat === s.first ? 1 : -1);
const gridOf = (s: Pick<CheckersState, "cells" | "first">): number[] => s.cells.map((p) => (p ? sideOf(s, p.o) * (p.k ? 2 : 1) : 0));

/** Every whole move the player to move may make from here (or every way to carry on a capture in progress). */
export function checkersLines(s: CheckersState): CheckersLine[] {
  if (s.phase !== "playing") return [];
  return linesFor(genOf(s.rules), gridOf(s), sideOf(s, s.turn), s.jump);
}

function startRound(s: CheckersState) {
  const n = s.rules.size;
  const rows = n / 2 - 1;
  let id = 0;
  s.cells = Array.from({ length: n * n }, (_, sq) => {
    const r = Math.floor(sq / n);
    if ((r + (sq % n)) % 2 === 0 || (r >= rows && r < n - rows)) return null;
    return { o: r < rows ? other(s.first) : s.first, k: false, id: id++ };
  });
  s.turn = s.first;
  s.jump = null;
  s.last = null;
  s.taken = [{ men: 0, kings: 0 }, { men: 0, kings: 0 }];
  s.quiet = 0;
  s.seen = { [keyOf(s)]: 1 };
  s.roundWinner = null;
  s.phase = "playing";
  s.ready = Array<boolean>(s.seats).fill(false);
  s.narration = null;
}

export function newCheckers(rules: CheckersRules, seats: number, seed: number): CheckersState {
  const s = { game: "checkers", rules, seats: 2, rng: seed >>> 0, round: 1, wins: [0, 0], draws: 0 } as CheckersState;
  s.first = rules.first === "seat1" ? 0 : rules.first === "seat2" ? 1 : nextRandom(s)() < 0.5 ? 0 : 1;
  startRound(s);
  return s;
}

/** A position, for telling when it has come round again: what is where, and whose move it is. */
const keyOf = (s: Pick<CheckersState, "cells" | "turn">) => s.cells.map((p) => (p ? "mkMK"[p.o * 2 + (p.k ? 1 : 0)] : ".")).join("") + s.turn;

// ---- Moves --------------------------------------------------------------------------------------

const coordsOf = (s: Pick<CheckersState, "rules">) => ({ cols: s.rules.size, coords: chessCoords(s.rules.size, s.rules.size) });
const at = (s: CheckersState, sq: number) => cellName(coordsOf(s), sq);

/** How a match stands once this game is in: finished when the games run out or one side can't be caught. */
function matchOver(s: CheckersState): boolean {
  const left = s.rules.games - s.round;
  return left <= 0 || Math.abs(s.wins[0]! - s.wins[1]!) > left;
}

function endRound(s: CheckersState, winner: number | null, why: string) {
  const many = s.rules.games > 1;
  if (winner === null) s.draws += 1;
  else s.wins[winner]! += 1;
  s.roundWinner = winner;
  s.narration = winner === null ? `${why}: ${many ? `game ${s.round} is a draw` : "it's a draw"}` : `${why}: ${who(winner)} wins${many ? ` game ${s.round}` : ""}!`;
  s.phase = matchOver(s) ? "finished" : "scored";
}

/** The move is done: take off what was jumped, crown, pass the turn, and see whether the game is over. Changes `s`. */
function finish(s: CheckersState, seat: number, path: number[], over: number[], crownedOnTheWay: boolean) {
  const g = genOf(s.rules);
  const to = path.at(-1)!;
  const piece = s.cells[to]!;
  const wasMan = !piece.k || crownedOnTheWay;
  for (const sq of over) {
    s.taken[seat]![s.cells[sq]!.k ? "kings" : "men"] += 1;
    s.cells[sq] = null;
  }
  const crowned = crownedOnTheWay || (!piece.k && g.geo.row[to] === crownRow(g, sideOf(s, seat)));
  if (crowned) piece.k = true;
  s.jump = null;
  s.last = path;
  s.turn = other(seat);
  // Nothing before a capture or a man's move can come round again.
  if (over.length || wasMan) {
    s.quiet = 0;
    s.seen = {};
  } else s.quiet += 1;
  const key = keyOf(s);
  s.seen[key] = (s.seen[key] ?? 0) + 1;
  s.narration = `${who(seat)} ${over.length ? `jumps ${path.map((sq) => at(s, sq)).join("×")}${over.length > 1 ? `, taking ${over.length}` : ""}` : `moves ${at(s, path[0]!)} to ${at(s, to)}`}${crowned ? " and is crowned" : ""}`;
  if (!linesFor(g, gridOf(s), sideOf(s, s.turn)).length) endRound(s, seat, s.cells.some((p) => p?.o === s.turn) ? `${who(s.turn)} has no move left` : `${who(seat)} has taken every piece`);
  else if (s.seen[key]! >= 3) endRound(s, null, "The same position three times");
  else if (s.quiet >= s.rules.quiet * 2) endRound(s, null, `${s.rules.quiet} moves each with no capture and no man moved`);
}

function apply(state: CheckersState, seat: number, move: CheckersMove): CheckersState {
  if (move?.type === "next") {
    if (state.phase !== "scored") throw new GameError("There's a game going on.");
    const s = clone(state);
    if (markReady(s.ready, seat)) {
      // Take turns moving first.
      s.round += 1;
      s.first = other(s.first);
      startRound(s);
    }
    return s;
  }
  if (move?.type !== "move" && move?.type !== "stop") throw new GameError("That's not a move in Checkers.");
  if (state.phase !== "playing") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  if (move.type === "stop") {
    if (!state.jump) throw new GameError("You haven't moved yet.");
    if (state.rules.forced) throw new GameError("You have to finish the capture.");
    const s = clone(state);
    finish(s, seat, s.jump!.path, s.jump!.over, s.jump!.crowned);
    return s;
  }
  const from = Number(move.from);
  const to = Number(move.to);
  const on = (sq: number) => Number.isInteger(sq) && sq >= 0 && sq < state.cells.length;
  if (!on(from) || !on(to)) throw new GameError("That's not on the board.");
  const lines = checkersLines(state);
  const line = lines.find((l) => l.from === from && l.steps[0] === to);
  if (!line) {
    if (state.jump && from !== state.jump.at) throw new GameError("Carry on with the piece that's jumping.");
    if (state.cells[from]?.o !== seat) throw new GameError("That's not your piece.");
    if (state.rules.forced && lines[0]?.over.length) throw new GameError(state.rules.most ? "You have to make the capture that takes the most." : "You have to capture.");
    throw new GameError("That piece can't go there.");
  }
  const s = clone(state);
  const g = genOf(s.rules);
  const piece = s.cells[from]!;
  s.cells[from] = null;
  s.cells[to] = piece;
  if (!line.over.length) {
    finish(s, seat, [from, to], [], false);
    return s;
  }
  const jump = s.jump ?? { from, at: from, path: [from], over: [], crowned: false };
  jump.at = to;
  jump.path.push(to);
  jump.over.push(line.over[0]!);
  // A man on the far row with more to take: it stops there, carries on as a man, or carries on as a king.
  const reached = !piece.k && g.geo.row[to] === crownRow(g, sideOf(s, seat));
  if (reached && s.rules.crowning === "king") {
    piece.k = true;
    jump.crowned = true;
  }
  const more = reached && s.rules.crowning === "stop" ? [] : linesFor(g, gridOf(s), sideOf(s, seat), jump);
  if (!more.length) {
    finish(s, seat, jump.path, jump.over, jump.crowned);
    return s;
  }
  s.jump = jump;
  s.narration = `${who(seat)} jumps ${jump.path.map((sq) => at(s, sq)).join("×")}…`;
  return s;
}

/** Best first. A drawn match lists the player who moved second in the last game first: holding the first move to a draw is the better result. */
function order(s: CheckersState): number[] {
  const [a, b] = s.wins as [number, number];
  if (a !== b) return a > b ? [0, 1] : [1, 0];
  return [other(s.first), s.first];
}
const winners = (s: CheckersState) => (s.wins[0] === s.wins[1] ? [0, 1] : [s.wins[0]! > s.wins[1]! ? 0 : 1]);

// ---- What a seat sees ---------------------------------------------------------------------------

/** The colour a seat plays: whoever moves first has the colour the rules say opens. */
const colourOf = (s: Pick<CheckersState, "first" | "rules">, seat: number) => ((seat === s.first) === (s.rules.opens === "dark") ? "dark" : "light");
function pieceOf(s: Pick<CheckersState, "first" | "rules">, seat: number, king: boolean): BoardPiece {
  const colour = colourOf(s, seat);
  return { owner: seat, kind: king ? "king" : "man", glyph: king ? "♛" : "●", label: `${colour} ${king ? "king" : "man"}`, tone: colour };
}

function view(s: CheckersState, seat: number): BoardView {
  const over = s.phase === "finished";
  const playing = s.phase === "playing";
  const mine = playing && s.turn === seat;
  const many = s.rules.games > 1;
  const n = s.rules.size;
  const w = over ? winners(s) : [];
  const lines = checkersLines(s);
  const capturing = lines.length > 0 && lines[0]!.over.length > 0;
  const marks: NonNullable<BoardGrid["marks"]> = [];
  const path = s.jump?.path ?? s.last;
  if (path) {
    for (const sq of path.slice(0, -1)) marks.push({ cell: sq, mark: "from" });
    marks.push({ cell: path.at(-1)!, mark: "last" });
  }
  // When a capture has to be made, the pieces that have to make it are lit for both players.
  if (s.rules.forced && capturing) for (const from of new Set(lines.map((l) => l.from))) marks.push({ cell: from, mark: "must" });
  const sources = new Map<number, number[]>();
  if (mine) for (const l of lines) if (!sources.get(l.from)?.includes(l.steps[0]!)) sources.set(l.from, [...(sources.get(l.from) ?? []), l.steps[0]!]);
  const grid: BoardGrid = {
    id: "board",
    label: "Board",
    rows: n,
    ...coordsOf(s),
    shade: "checker",
    // The side that opened is at the bottom of `cells`; the other seat sees the board turned round.
    flip: seat !== s.first,
    cells: s.cells.map((p, sq) => (p ? { ...pieceOf(s, p.o, p.k), id: `p${p.id}`, ...(s.jump?.over.includes(sq) ? { faded: true } : {}) } : null)),
    marks,
    select: mine ? { type: "move", sources: [...sources].map(([from, to]) => ({ from, to })), ...(s.jump ? { held: s.jump.at } : {}) } : null,
  };
  const left = s.rules.quiet * 2 - s.quiet;
  const scoreTitle = s.roundWinner === null ? `Game ${s.round} is a draw` : `${who(s.roundWinner)} wins game ${s.round}`;
  return {
    game: "checkers",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: playing ? s.turn : null,
    grids: [grid],
    reserves: [0, 1].map((o) => ({
      owner: o,
      label: "Captured",
      pieces: [
        { piece: pieceOf(s, other(o), false), count: s.taken[o]!.men },
        { piece: pieceOf(s, other(o), true), count: s.taken[o]!.kings },
      ],
    })),
    choices:
      s.phase === "scored"
        ? nextHandChoices(s.ready, seat, false, "Next game")
        : mine && s.jump && !s.rules.forced
          ? { prompt: "", options: [{ label: "Stop here", move: { type: "stop" }, hint: "End your move without jumping again" }] }
          : null,
    players: [0, 1].map((i) => {
      const count = s.cells.filter((p) => p?.o === i).length;
      return {
        line: [`${count} piece${count === 1 ? "" : "s"}`, ...(many ? [`${s.wins[i]} win${s.wins[i] === 1 ? "" : "s"}`] : [])].join(" · "),
        piece: pieceOf(s, i, false),
        badge: playing && s.last === null && !s.jump && i === s.first ? "Goes first" : undefined,
      };
    }),
    info: [
      ...(many ? [`Game ${s.round} of ${s.rules.games}`] : []),
      ...(playing && s.rules.forced && capturing ? [s.rules.most ? "The biggest capture has to be taken" : s.jump ? "The capture has to be finished" : "A capture has to be taken"] : []),
      ...(playing && left <= Math.min(20, s.rules.quiet) ? [`A draw in ${Math.ceil(left / 2)} more move${left <= 2 ? "" : "s"} each without a capture`] : []),
    ],
    narration: s.narration ?? (mine ? `You're ${colourOf(s, seat)}: you go first` : null),
    scores: s.wins.map((value, i) => ({ seats: [i], value })),
    result:
      many && !playing
        ? { key: `game-${s.round}`, title: scoreTitle, sides: [[0], [1]], rows: [{ label: "Wins", values: s.wins.map(String), tone: "total" }, ...(s.draws ? [{ label: "Draws", values: [String(s.draws), String(s.draws)] }] : [])] }
        : null,
    over: over ? { winners: w, title: w.length > 1 ? "It's a draw!" : `${who(w[0]!)} wins${many ? ` ${s.wins[w[0]!]} to ${s.wins[other(w[0]!)]}` : ""}!` } : null,
  };
}

// ---- Computer players ---------------------------------------------------------------------------
// Look ahead, alpha-beta, a whole move at a time (a multi-jump is one move to the search, however
// many taps it takes to play). The search never stops in the middle of an exchange: when the side
// to move can capture it keeps looking until the board is quiet. What is left is judged by
// material, with kings worth more where they fly, and a little for men that have got on, for men
// still guarding the back row, and for holding the middle.
//
// How far ahead goes by skill, and a ration of looking (see `work`) keeps the slowest move short on
// any board: a 10×10 with flying kings has far more to look at than an 8×8. A careless player (see
// `careless`) plays the first thing it sees.

const WIN = 1_000_000;
/** How much of a man (100) luck is worth when moves are about as good as each other. */
const LUCK = 6;
/**
 * The most looking a computer player does over one move, in units of `work`. At this the slowest
 * move measured was about 25 ms on every board (10×10 with flying kings included) and the usual
 * one 8 ms; a busy machine took three times that.
 */
const CAP = 150_000;
/** Thrown when a search has done all the looking it may; the last depth it finished stands. */
const SPENT = new Error("spent");

function judge(g: Gen, b: Grid, side: number): number {
  const { n, dark, row, col, next } = g.geo;
  const kingWorth = g.flying ? 320 : 160;
  let total = 0;
  // Pieces, and squares they could step to, for the side moving up and the side moving down.
  let up = 0;
  let down = 0;
  let upSteps = 0;
  let downSteps = 0;
  for (const sq of dark) {
    const piece = b[sq]!;
    if (!piece) continue;
    const own = piece > 0 ? 1 : -1;
    const king = piece === 2 || piece === -2;
    // How near the middle of the board, 0 at the edge.
    const inCol = Math.min(col[sq]!, n - 1 - col[sq]!);
    let worth: number;
    if (king) worth = kingWorth + (inCol + Math.min(row[sq]!, n - 1 - row[sq]!)) * 2;
    else {
      const gone = own > 0 ? n - 1 - row[sq]! : row[sq]!;
      // Men are worth more as they get on, and the ones at home keep the other side from crowning.
      worth = 100 + gone * 3 + (gone === 0 ? 8 : 0) + inCol;
    }
    total += own * worth;
    let steps = 0;
    for (let d = king ? 0 : own > 0 ? 0 : 2, end = king ? 4 : own > 0 ? 2 : 4; d < end; d++) {
      const to = next[d]![sq]!;
      if (to >= 0 && b[to] === 0) steps++;
    }
    if (own > 0) [up, upSteps] = [up + 1, upSteps + steps];
    else [down, downSteps] = [down + 1, downSteps + steps];
  }
  // Ahead with little left on the board: swapping pieces off is winning.
  total += ((up - down) * 240) / (up + down + 2);
  // Room to move, and above all not running out of it: a side with nothing to move has lost.
  total += (upSteps - downSteps) * 2 - 60 / (1 + upSteps) + 60 / (1 + downSteps);
  return total * side;
}

function make(b: Grid, line: CheckersLine, undo: number[]) {
  const piece = b[line.from]!;
  undo.length = 0;
  for (const sq of line.over) {
    undo.push(b[sq]!);
    b[sq] = 0;
  }
  b[line.from] = 0;
  b[line.steps.length ? line.steps[line.steps.length - 1]! : line.from] = line.crown ? (piece > 0 ? 2 : -2) : piece;
  return piece;
}
function unmake(b: Grid, line: CheckersLine, undo: number[], piece: number) {
  b[line.steps.length ? line.steps[line.steps.length - 1]! : line.from] = 0;
  b[line.from] = piece;
  for (let i = 0; i < line.over.length; i++) b[line.over[i]!] = undo[i]!;
}

interface Look {
  /** Stop when `work` passes this. */
  cap: number;
  /** How often a quiet move from one square to another has turned out too good to allow: those are tried first. */
  good: Int32Array;
}

/** The value of the position for `side`, who is about to move, looking `depth` whole moves ahead. */
function search(g: Gen, b: Grid, side: number, depth: number, alpha: number, beta: number, ply: number, look: Look): number {
  // Every position costs something to look at, however little is on the board.
  if ((work += 12) > look.cap) throw SPENT;
  let best = -Infinity;
  let lines: CheckersLine[];
  if (depth <= 0) {
    // As far as it looks, except that an exchange is followed to its end.
    lines = ply > 40 ? [] : linesFor(g, b, side, null, true);
    // Nothing to move loses, the sooner the worse.
    if (!lines.length) return canStep(g, b, side) || ply > 40 ? judge(g, b, side) : -WIN + ply;
    if (!g.forced) {
      // A capture that needn't be taken: the position is worth at least what it is as it stands.
      best = judge(g, b, side);
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    }
  } else {
    lines = linesFor(g, b, side);
    if (!lines.length) return -WIN + ply;
  }
  const size = g.geo.n * g.geo.n;
  if (lines.length > 1) {
    const good = look.good;
    const rank = (l: CheckersLine) => (l.over.length ? 1e9 + l.over.length * 10 : good[l.from * size + l.steps[0]!]!) + (l.crown ? 5e8 : 0);
    lines.sort((x, y) => rank(y) - rank(x));
  }
  const undo: number[] = [];
  for (const line of lines) {
    const piece = make(b, line, undo);
    const value = -search(g, b, -side, depth - 1, -beta, -alpha, ply + 1, look);
    unmake(b, line, undo, piece);
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) {
      if (!line.over.length && depth > 0) look.good[line.from * size + line.steps[0]!]! += depth * depth;
      break;
    }
  }
  return best;
}

/**
 * The best whole move for the player to move, looking up to `depth` moves ahead and doing no more than
 * `cap` of work (see `work`). In the middle of a capture it is the best way to carry on; a line with no steps
 * means stopping where the piece stands (only when captures aren't forced). Null when there is
 * nothing to do.
 */
export function bestCheckersLine(s: CheckersState, depth: number, cap: number, rand: () => number = Math.random): CheckersLine | null {
  const g = genOf(s.rules);
  // A copy to try moves on: a search that runs out of positions leaves it half played.
  const b = Int8Array.from(gridOf(s));
  const side = sideOf(s, s.turn);
  const lines = linesFor(g, b, side, s.jump);
  if (s.jump && !s.rules.forced) lines.push({ from: s.jump.at, steps: [], over: [], crown: false });
  if (lines.length < 2) return lines[0] ?? null;
  // What each move leaves on the board: with a capture under way, the pieces already jumped go too.
  const before = s.jump?.over ?? [];
  const crownRowHere = crownRow(g, side);
  const options = lines.map((line) => ({
    line,
    whole: { ...line, over: [...before, ...line.over], crown: line.crown || (!!s.jump && Math.abs(b[s.jump.at]!) === 1 && !line.steps.length && g.geo.row[s.jump.at] === crownRowHere) },
    value: 0,
    luck: rand(),
  }));
  // Going back to a position that has already come up is how a won game turns into a draw.
  const repeats = (o: (typeof options)[number]) => {
    if (o.whole.over.length) return 0;
    const undo: number[] = [];
    const piece = make(b, o.whole, undo);
    const key = Array.from(b, (v) => (v ? "mkMK"[(v * side > 0 ? s.turn : other(s.turn)) * 2 + (v === 2 || v === -2 ? 1 : 0)] : ".")).join("") + other(s.turn);
    unmake(b, o.whole, undo, piece);
    return s.seen[key] ?? 0;
  };
  const look: Look = { cap: work + cap, good: new Int32Array(b.length * b.length) };
  let best = options[0]!;
  const undo: number[] = [];
  try {
    for (let d = 1; d <= depth; d++) {
      let top = -Infinity;
      let pick = options[0]!;
      for (const o of options) {
        const piece = make(b, o.whole, undo);
        // A move is only scored exactly when it comes within a whisker of the best so far: that is
        // all that's needed, and the whisker is where luck gets in, so no two games go the same way.
        o.value = -search(g, b, -side, d - 1, -Infinity, -(top - LUCK), 1, look) + o.luck * LUCK;
        unmake(b, o.whole, undo, piece);
        if (o.value > 0 && o.value < WIN / 2) o.value -= repeats(o) * 60;
        if (o.value > top) [top, pick] = [o.value, o];
      }
      best = pick;
      // Next time round, look at the moves that did best first: it prunes far more.
      options.sort((x, y) => y.value - x.value);
      if (top > WIN / 2 || top < -WIN / 2) break;
    }
  } catch (e) {
    if (e !== SPENT) throw e;
  }
  return best.line;
}

/** How far ahead a computer player looks, and how much looking it may do, by skill. */
function reach(style: PlayStyle): [depth: number, cap: number] {
  const skill = style.skill ?? 1;
  return skill >= 0.9 ? [10, CAP] : skill >= 0.5 ? [4, CAP / 3] : [2, CAP / 8];
}

function bot(s: CheckersState, seat: number, style: PlayStyle, rand: () => number = Math.random): CheckersMove | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  if (careless(style, rand)) {
    // Whatever comes to hand, though even a careless player finishes a capture it has started.
    const line = pickRandom(checkersLines(s), rand);
    return { type: "move", from: line.from, to: line.steps[0]! };
  }
  const line = bestCheckersLine(s, ...reach(style), rand)!;
  return line.steps.length ? { type: "move", from: line.from, to: line.steps[0]! } : { type: "stop" };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): CheckersRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<CheckersRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? americanCheckers;
  const r = { ...base, ...given };
  const forced = !!r.forced;
  return {
    id: String(r.id),
    name: String(r.name),
    size: SIZES.includes(Number(r.size)) ? Number(r.size) : base.size,
    backward: !!r.backward,
    flying: !!r.flying,
    forced,
    // The biggest capture can only be insisted on when captures are.
    most: forced && !!r.most,
    crowning: r.crowning === "pass" || r.crowning === "king" ? r.crowning : "stop",
    opens: r.opens === "light" ? "light" : "dark",
    first: r.first === "seat1" || r.first === "seat2" ? r.first : "random",
    quiet: Math.min(100, Math.max(10, Math.round(Number(r.quiet)) || 40)),
    games: [1, 3, 5, 7].includes(Number(r.games)) ? Number(r.games) : 1,
  };
}

export const checkers: BoardGame<CheckersRules, CheckersState, CheckersMove> = {
  id: "checkers",
  name: "Checkers",
  emoji: "👑",
  blurb: "Jump their pieces and crown your kings",
  tagline: "Draughts the way your family plays it: American, International on the big board, Russian, or friendly with no forced jumps.",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "size", label: "Board", kind: "choice", options: [[8, "8×8, 12 men each"], [10, "10×10, 20 men each"]] },
    { key: "forced", label: "Captures are forced", hint: "If you can jump, you have to", kind: "toggle" },
    { key: "most", label: "Must take the most", hint: "With forced captures: the jump that takes the most pieces is the one you have to make", kind: "toggle" },
    { key: "backward", label: "Men capture backwards", kind: "toggle" },
    { key: "flying", label: "Flying kings", hint: "Kings move and capture any distance along a diagonal", kind: "toggle" },
    { key: "crowning", label: "Reaching the far row mid-capture", kind: "choice", options: [["stop", "Crowned, and the move ends"], ["pass", "Carries on as a man"], ["king", "Crowned, and carries on as a king"]] },
    { key: "opens", label: "Which colour moves first", kind: "choice", options: [["dark", "Dark"], ["light", "Light"]] },
    { key: "first", label: "Who moves first", kind: "choice", options: [["random", "Luck of the draw"], ["seat1", "The first seat"], ["seat2", "The second seat"]] },
    { key: "quiet", label: "Draw after moves each with no capture", hint: "Moves by each side with no capture and no man moved", kind: "number", min: 10, max: 100, step: 5 },
    { key: "games", label: "Games in a match", kind: "choice", options: [[1, "Just one"], [3, "Three"], [5, "Five"], [7, "Seven"]] },
  ],
  normalize,
  validate(r) {
    return r.most && !r.forced ? ["Taking the most only means something when captures are forced."] : [];
  },
  describe(r) {
    const men = (r.size / 2 - 1) * (r.size / 2);
    return [
      `A ${r.size}×${r.size} board, ${men} men each, played on the dark squares. ${r.opens === "dark" ? "Dark" : "Light"} moves first${r.first === "random" ? "; who that is is the luck of the draw" : `, and that's the ${r.first === "seat1" ? "first" : "second"} seat`}.`,
      `Men move one square forwards on a slant. They capture by jumping a piece next to them into the empty square beyond: forwards${r.backward ? " or backwards" : " only"}.`,
      r.flying ? "A man that reaches the far row is crowned a king. Kings fly: they move any distance along a diagonal, and capture a piece from any distance, landing anywhere clear beyond it." : "A man that reaches the far row is crowned a king. Kings move and capture one square at a time, forwards or backwards.",
      r.forced
        ? `If you can capture, you have to, and you carry on jumping with the same piece while it can.${r.most ? " When there's a choice, you have to make the capture that takes the most pieces." : " When there's a choice of captures, take whichever you like."}`
        : "Captures are never forced: jump if you want to, and stop a run of jumps whenever you like.",
      "Tap each square in turn to make a run of jumps. Pieces you've jumped stay put until your move is done, and can't be jumped twice.",
      ...(r.backward || r.flying
        ? [r.crowning === "stop" ? "A man that reaches the far row during a capture is crowned and the move ends there." : r.crowning === "pass" ? "A man that passes through the far row during a capture carries on as a man: it's only crowned if the move ends there." : "A man that reaches the far row during a capture is crowned at once and carries on as a king."]
        : []),
      `You win by taking every piece or leaving the other player with no move. It's a draw after ${r.quiet} moves each with no capture and no man moved, or when the same position comes up three times.`,
      ...(r.games > 1 ? [`A match is ${r.games} games; most wins takes it. Players take turns moving first.`] : []),
    ];
  },
  newGame: newCheckers,
  apply,
  view,
  bot,
  // A hop in the middle of a capture comes quickly: the thinking was done before the first one.
  thinkingTime: (s) => (s.jump ? 450 : thinkFor(Math.min(new Set(checkersLines(s).map((l) => l.from)).size, 6), s.last === null ? 0.7 : 1)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "checkers",
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
