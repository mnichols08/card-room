// Mini Golf, for one to six players: the first game on the physics core and on the table-sports
// kit. Putt the ball into the cup in as few strokes as you can, hole after hole; the lowest total
// wins.
//
// Each player has a ball of their own colour, and **balls never touch each other**, whichever way
// a table plays. Every shot is simulated on a hole with only the striker's ball on it, and the
// other balls are drawn as ghosts. That is a choice, and it is the same in both ways of playing:
//  - everyone starts from the same tee, so the second ball would start on top of the first one if
//    that hadn't gone far;
//  - nobody can knock someone else's ball into the pond, and no rule is needed for whose stroke
//    that was;
//  - a shot's result depends on nothing but the striker's own ball, so "everyone at once" is the
//    same game as "in turn", a computer player can think without guessing what others will do, and
//    a replay doesn't depend on the order two people happened to putt in.
//
// Who putts when is a house rule. *In turn*: everyone tees off in order (the honour moves round
// one seat a hole), and after that whoever is furthest from the cup plays next, as on a real
// green. *Everyone at once*: no turns; each player plays the hole at their own pace and the table
// moves on when all of them have holed out or picked up.
//
// What is stored, and why (the replay decision). The state keeps where every ball lies as whole
// numbers and, for the last shot each seat took, the shot, the bodies it started from, where the
// physics came to rest and the physics version that played it. A view is made from that alone:
// nothing is simulated to draw a table, and what a browser animates is checked against the stored
// rest. The room on the server, though, rebuilds a table after a restart by replaying its move
// log through `apply`, which simulates each shot again. The physics core is bit-for-bit
// deterministic (test/minigolf.test.ts steps a recorded shot and compares), so under the same
// PHYSICS_VERSION and the same course data a replay is exact. A change to either can only alter
// rounds that are in progress across the deploy: finished rounds are never replayed for their
// results, and a replayed round stays a legal game (every logged shot is still a shot), it may
// just come out differently. Making history immune to that needs the room to keep a snapshot of
// the state beside the move log, which is on the roadmap for the rooms kit and not something an
// engine can do from inside `apply`.
import { PHYSICS_VERSION, simulate, type Point, type Shape } from "@cardroom/physics";
import type { PlayStyle } from "@spades/rules";
import { BALL_RADIUS, courseOf, COURSES, holeWorld, type GolfHole } from "./minigolfcourse.js";
import { angleTo, restOf, type ShotMove, type SportBody, type SportCard, type SportGame, type SportShot, type SportTone, type SportView } from "./sport.js";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, rankSeats, thinkFor, who, type BaseRules, type RoundResult } from "./table.js";

export interface MiniGolfRules extends BaseRules {
  /** Which course (see COURSES). */
  course: string;
  /** How many of its holes to play, from the first. */
  holes: number;
  /** In turn, or everyone at once. */
  order: "turns" | "together";
  /** Strokes allowed on a hole. Not in by then: pick up, and write down one more than this. */
  limit: number;
  /** Strokes added for a ball in the water or off the course. It is played again from where it was struck. */
  penalty: number;
}

export const nineHoles: MiniGolfRules = { id: "minigolf-nine", name: "Nine holes, in turn", course: "back-garden", holes: 9, order: "turns", limit: 6, penalty: 1 };
export const nineTogether: MiniGolfRules = { id: "minigolf-together", name: "Nine holes, all at once", course: "back-garden", holes: 9, order: "together", limit: 6, penalty: 1 };
export const quickThree: MiniGolfRules = { id: "minigolf-quick", name: "Quick three, in turn", course: "back-garden", holes: 3, order: "turns", limit: 6, penalty: 1 };
export const quickTogether: MiniGolfRules = { id: "minigolf-quick-together", name: "Quick three, all at once", course: "back-garden", holes: 3, order: "together", limit: 6, penalty: 1 };
const PRESETS = [nineHoles, nineTogether, quickThree, quickTogether];

/** The gentlest and hardest a ball may be struck. A putt of nothing would be a stroke that moves nothing. */
export const MIN_POWER = 20;
export const MAX_POWER = 1000;

export interface GolfBall {
  x: number;
  y: number;
  /** Strokes on this hole so far, penalties included. */
  strokes: number;
  /** Has left the tee on this hole. */
  teed: boolean;
  done: "holed" | "pickup" | null;
}

export interface MiniGolfState {
  game: "minigolf";
  rules: MiniGolfRules;
  seats: number;
  rng: number;
  /** The physics that plays this table's shots. */
  physics: number;
  /** Which hole, from 0. */
  hole: number;
  /** Who tees off first on this hole. */
  first: number;
  /** In turn: whose shot it is. Everyone at once: always null. */
  turn: number | null;
  balls: GolfBall[];
  /** What each seat wrote down for each hole: card[seat][hole]; null until the hole is finished. */
  card: (number | null)[][];
  /** Shots taken in the whole round. */
  shots: number;
  /** Each seat's last shot on this hole. */
  lasts: (SportShot | null)[];
  phase: "playing" | "holed" | "finished";
  ready: boolean[];
  narration: string | null;
}

export type MiniGolfMove = ShotMove | { type: "next" };

const holesOf = (s: { rules: MiniGolfRules }): GolfHole[] => courseOf(s.rules.course).holes.slice(0, s.rules.holes);
const holeOf = (s: Pick<MiniGolfState, "rules" | "hole">): GolfHole => holesOf(s)[s.hole]!;
export const ballId = (seat: number) => `ball-${seat}`;
const cupOf = (h: GolfHole) => h.world.pockets[0]!;

function startHole(s: MiniGolfState, hole: number) {
  const h = holesOf(s)[hole]!;
  s.hole = hole;
  s.balls = Array.from({ length: s.seats }, () => ({ x: h.tee[0], y: h.tee[1], strokes: 0, teed: false, done: null }));
  s.lasts = Array<null>(s.seats).fill(null);
  s.phase = "playing";
  s.ready = Array<boolean>(s.seats).fill(false);
  s.narration = null;
  s.turn = s.rules.order === "turns" ? nextUp(s) : null;
}

export function newMiniGolf(rules: MiniGolfRules, seats: number, seed: number): MiniGolfState {
  const s = { game: "minigolf", rules, seats, rng: seed >>> 0, physics: PHYSICS_VERSION, shots: 0 } as MiniGolfState;
  s.card = Array.from({ length: seats }, () => Array<null>(holesOf(s).length).fill(null));
  s.first = Math.floor(nextRandom(s)() * seats);
  startHole(s, 0);
  return s;
}

/** Seats in the order they tee off on this hole. */
const teeOrder = (s: Pick<MiniGolfState, "first" | "seats">) => Array.from({ length: s.seats }, (_, i) => (s.first + i) % s.seats);

/**
 * In turn: who plays next. Anyone still on the tee goes first, in tee order; after that it is
 * whoever lies furthest from the cup (the earlier in tee order if two are as far).
 */
function nextUp(s: MiniGolfState): number | null {
  const order = teeOrder(s).filter((seat) => !s.balls[seat]!.done);
  const onTee = order.find((seat) => !s.balls[seat]!.teed);
  if (onTee !== undefined) return onTee;
  const cup = cupOf(holeOf(s));
  const far = (seat: number) => (s.balls[seat]!.x - cup.x) * (s.balls[seat]!.x - cup.x) + (s.balls[seat]!.y - cup.y) * (s.balls[seat]!.y - cup.y);
  let best: number | null = null;
  for (const seat of order) if (best === null || far(seat) > far(best)) best = seat;
  return best;
}

// ---- Scores -------------------------------------------------------------------------------------

/** A seat's strokes so far: finished holes and the one in play. */
const totalOf = (s: MiniGolfState, seat: number) => s.card[seat]!.reduce<number>((n, v) => n + (v ?? 0), 0) + (s.card[seat]![s.hole] === null ? s.balls[seat]!.strokes : 0);
/** Against par, over the holes a seat has finished. */
const toParOf = (s: MiniGolfState, seat: number) => holesOf(s).reduce((n, h, i) => (s.card[seat]![i] === null ? n : n + s.card[seat]![i]! - h.par), 0);
const parText = (n: number) => (n === 0 ? "Level" : n > 0 ? `+${n}` : `−${-n}`);
const strokesText = (n: number) => `${n} stroke${n === 1 ? "" : "s"}`;

/** What golfers call a score on a hole. */
export function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return "a hole in one";
  return { [-2]: "an eagle", [-1]: "a birdie", 0: "par", 1: "a bogey", 2: "a double bogey" }[strokes - par] ?? `${strokes}`;
}

const winnersOf = (s: MiniGolfState) => {
  const totals = Array.from({ length: s.seats }, (_, seat) => totalOf(s, seat));
  const best = Math.min(...totals);
  return totals.flatMap((t, seat) => (t === best ? [seat] : []));
};

// ---- Moves --------------------------------------------------------------------------------------

function apply(state: MiniGolfState, seat: number, move: MiniGolfMove): MiniGolfState {
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats) throw new GameError("That's not a seat at this table.");
  if (move?.type === "next") {
    if (state.phase !== "holed") throw new GameError("The hole isn't finished yet.");
    const s = clone(state);
    if (markReady(s.ready, seat)) {
      // The honour moves round a seat each hole.
      s.first = (s.first + 1) % s.seats;
      startHole(s, s.hole + 1);
    }
    return s;
  }
  if (move?.type !== "shot") throw new GameError("That's not a move in Mini Golf.");
  if (state.phase !== "playing") throw new GameError(state.phase === "finished" ? "This round is over." : "Everyone is in. On to the next hole.");
  const ball = state.balls[seat]!;
  if (ball.done) throw new GameError(ball.done === "holed" ? "You've holed out. Waiting for the others." : "You've picked up on this hole.");
  if (state.turn !== null && state.turn !== seat) throw new GameError("It's not your shot.");
  if (move.body !== ballId(seat)) throw new GameError("That's not your ball.");
  if (!Number.isInteger(move.angle) || move.angle < 0 || move.angle >= 36000) throw new GameError("Aim somewhere first.");
  if (!Number.isInteger(move.power) || move.power < MIN_POWER || move.power > MAX_POWER) throw new GameError("That's not a putt: too soft or too hard.");

  const s = clone(state);
  const h = holeOf(s);
  const mine = s.balls[seat]!;
  const shot = { body: ballId(seat), angle: move.angle, power: move.power };
  const before = holeWorld(h, { id: shot.body, x: mine.x, y: mine.y });
  const played = simulate(before, shot);
  const at = played.world.bodies[0]!;
  s.shots += 1;
  s.lasts[seat] = { n: s.shots, seat, shot, from: before.bodies, rest: restOf(played.world), ticks: played.ticks, physics: PHYSICS_VERSION };
  mine.strokes += 1;
  mine.teed = true;

  if (at.pocketed !== undefined) {
    mine.done = "holed";
    mine.x = at.x;
    mine.y = at.y;
    const name = scoreName(mine.strokes, h.par);
    s.narration = mine.strokes === 1 ? `${who(seat)} makes a hole in one!` : `${who(seat)} holes out in ${mine.strokes}${/^\d/.test(name) ? "" : `: ${name}`}`;
  } else if (at.out !== undefined) {
    // Wet, or off the course: the ball goes back to where it was struck from, at a cost.
    mine.strokes += s.rules.penalty;
    const cost = s.rules.penalty ? `, plus ${strokesText(s.rules.penalty)}` : "";
    s.narration = `${who(seat)} ${at.out === "bounds" ? "is off the course" : "finds the water"}: back where it was${cost}`;
  } else {
    mine.x = at.x;
    mine.y = at.y;
    const lipped = played.events.some((e) => e.type === "skip");
    s.narration = lipped ? `${who(seat)} runs it over the cup: too fast to drop` : `${who(seat)} putts`;
  }
  if (!mine.done && mine.strokes >= s.rules.limit) {
    mine.done = "pickup";
    s.narration = `${who(seat)} picks up after ${s.rules.limit} and writes down ${s.rules.limit + 1}`;
  }
  if (mine.done) s.card[seat]![s.hole] = mine.done === "holed" ? Math.min(mine.strokes, s.rules.limit + 1) : s.rules.limit + 1;

  if (s.balls.every((b) => b.done)) {
    s.turn = null;
    s.phase = s.hole + 1 >= holesOf(s).length ? "finished" : "holed";
  } else if (s.rules.order === "turns") s.turn = nextUp(s);
  return s;
}

// ---- What a seat sees ---------------------------------------------------------------------------

const TONES: SportTone[] = ["white", "red", "blue", "gold", "purple", "orange"];
const lookOf = (seat: number): SportBody => ({ id: ballId(seat), owner: seat, kind: "ball", tone: TONES[seat % TONES.length]!, label: `${who(seat)}'s ball` });

function cardOf(s: MiniGolfState): SportCard {
  const holes = holesOf(s);
  return {
    title: courseOf(s.rules.course).name,
    columns: holes.map((h, i) => ({ label: String(i + 1), sub: String(h.par) })),
    current: s.phase === "finished" ? null : s.hole,
    rows: Array.from({ length: s.seats }, (_, seat) => ({
      seat,
      cells: holes.map((_, i) => (s.card[seat]![i] !== null ? String(s.card[seat]![i]) : i === s.hole && s.balls[seat]!.strokes ? String(s.balls[seat]!.strokes) : "")),
      total: String(totalOf(s, seat)),
      note: parText(toParOf(s, seat)),
    })),
    totalLabel: "Total",
    noteLabel: "To par",
  };
}

function resultOf(s: MiniGolfState): RoundResult | null {
  if (s.phase === "playing") return null;
  const seats = Array.from({ length: s.seats }, (_, i) => i);
  const h = holeOf(s);
  const total = { label: "Total", values: seats.map((i) => String(totalOf(s, i))), tone: "total" as const };
  const par = { label: "To par", values: seats.map((i) => parText(toParOf(s, i))) };
  if (s.phase === "finished") return { key: "final", title: `${courseOf(s.rules.course).name}: the final card`, sides: seats.map((i) => [i]), rows: [{ label: `Hole ${s.hole + 1}`, values: seats.map((i) => String(s.card[i]![s.hole])) }, total, par] };
  return { key: `hole-${s.hole}`, title: `Hole ${s.hole + 1}: ${h.name} (par ${h.par})`, sides: seats.map((i) => [i]), rows: [{ label: "This hole", values: seats.map((i) => String(s.card[i]![s.hole])), tone: "score" }, total, par] };
}

function overTitle(s: MiniGolfState, winners: number[]): string {
  const total = totalOf(s, winners[0]!);
  const par = toParOf(s, winners[0]!);
  const against = par === 0 ? "level par" : `${Math.abs(par)} ${par > 0 ? "over" : "under"} par`;
  if (s.seats === 1) return `Round finished: ${strokesText(total)}, ${against}`;
  if (winners.length > 1) return `It's a tie at ${total}!`;
  return `${who(winners[0]!)} wins with ${total} (${against})!`;
}

function view(s: MiniGolfState, seat: number): SportView {
  const holes = holesOf(s);
  const h = holes[s.hole]!;
  const mine = s.balls[seat]!;
  const playing = s.phase === "playing";
  const together = s.rules.order === "together";
  const canShoot = playing && !mine.done && (together || s.turn === seat);
  // In turn, everyone watches every shot. All at once, a seat watches its own, and sees the
  // other balls where they lie.
  const last = together ? s.lasts[seat]! : s.lasts.reduce<SportShot | null>((a, b) => (b && (!a || b.n > a.n) ? b : a), null);
  const winners = s.phase === "finished" ? winnersOf(s) : [];
  const onTee = playing && s.balls.every((b) => !b.teed);
  return {
    game: "minigolf",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: playing && !together ? s.turn : null,
    table: {
      key: `${s.rules.course}/${h.id}`,
      name: `Hole ${s.hole + 1}: ${h.name}`,
      // A ball that was picked up is off the green; one that is in sits in the cup.
      world: holeWorld(h, { id: ballId(seat), x: mine.x, y: mine.y, ...(mine.done ? { pocketed: mine.done === "holed" ? "cup" : "pickup" } : {}) }),
      look: h.look,
      bodies: s.balls.map((_, i) => lookOf(i)),
      // The other balls that are out on the green. Those still on the tee would all sit under yours.
      ghosts: s.balls.flatMap((b, i) => (i !== seat && b.teed && !b.done ? [{ ...lookOf(i), x: b.x, y: b.y, r: BALL_RADIUS }] : [])),
    },
    shoot: canShoot ? { body: ballId(seat), minPower: MIN_POWER, maxPower: MAX_POWER } : null,
    last,
    card: cardOf(s),
    choices: s.phase === "holed" ? nextHandChoices(s.ready, seat, false, "Next hole") : null,
    players: s.balls.map((b, i) => ({
      line: b.done === "holed" ? `In the cup in ${b.strokes}` : b.done === "pickup" ? `Picked up: ${s.rules.limit + 1}` : b.strokes ? strokesText(b.strokes) : "On the tee",
      body: lookOf(i),
      done: !!b.done,
      badge: onTee && !together && s.seats > 1 && i === s.first ? "Tees off first" : undefined,
    })),
    info: [`Hole ${s.hole + 1} of ${holes.length}`, `Par ${h.par}`, ...(playing && !mine.done ? [`Stroke ${mine.strokes + 1} of ${s.rules.limit}`] : [])],
    narration: s.narration ?? (playing ? h.tip : null),
    scores: s.balls.map((_, i) => ({ seats: [i], value: totalOf(s, i) })),
    result: resultOf(s),
    over: s.phase === "finished" ? { winners, title: overTitle(s, winners) } : null,
  };
}

// ---- Computer players ---------------------------------------------------------------------------
// A computer player does what a person does with more patience: it tries putts in its head. The
// physics is quick, so it simulates a couple of hundred shots (every direction at several strengths,
// then a closer look round the best of them) and keeps the one that holes out, or failing that the
// one that stops nearest the cup. "Nearest" is measured along the green, round the walls and the
// water (a ball a short way from the cup on the wrong side of a fence is not close), from a map of
// distances worked out once for each hole.
//
// That finds the putt a perfect player would make. What makes a persona is how well it then hits
// it: the aim and the strength are both nudged off by an amount that grows as skill drops, and a
// careless moment (see `careless`) is a much bigger slip.

interface Field {
  x: number;
  y: number;
  cols: number;
  rows: number;
  /** Distance to the cup along the green from each cell, in world units; Infinity where no ball can be. */
  dist: Float64Array;
}
const CELL = 200;
const FAR = 1e9;
const fields = new Map<string, Field>();

function inShape(s: Shape, x: number, y: number): boolean {
  if ("points" in s) {
    let inside = false;
    const pts = s.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  return (x - s.x) * (x - s.x) + (y - s.y) * (y - s.y) < s.r * s.r;
}

/** The square of the distance from a point to a straight piece of wall. */
function toSegment(x: number, y: number, a: Point, b: Point): number {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey)));
  const dx = x - a[0] - t * ex;
  const dy = y - a[1] - t * ey;
  return dx * dx + dy * dy;
}

/** How far each spot on a hole is from the cup by the shortest way a ball could roll there. */
export function greenDistances(h: GolfHole): Field {
  const known = fields.get(h.id);
  if (known) return known;
  const f = h.look.frame;
  const cols = Math.ceil(f.w / CELL);
  const rows = Math.ceil(f.h / CELL);
  const dist = new Float64Array(cols * rows).fill(Infinity);
  // What a step onto each cell costs: 0 where a ball can't be (against a wall, in the water),
  // more through sand than over grass.
  const cost = new Float64Array(cols * rows);
  const clear = (BALL_RADIUS - 40) * (BALL_RADIUS - 40);
  const pieces: [Point, Point][] = h.world.walls.flatMap((w) => w.points.slice(0, w.closed ? w.points.length : -1).map((p, i): [Point, Point] => [p, w.points[(i + 1) % w.points.length]!]));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = f.x + (c + 0.5) * CELL;
      const y = f.y + (r + 0.5) * CELL;
      if (pieces.some(([a, b]) => toSegment(x, y, a, b) < clear)) continue;
      if (h.world.regions.some((g) => g.out && inShape(g.shape, x, y))) continue;
      cost[r * cols + c] = h.world.regions.some((g) => g.friction !== undefined && g.friction > h.world.friction && inShape(g.shape, x, y)) ? 3 : 1;
    }
  }
  // Dijkstra outwards from the cup, on a small heap of [distance, cell].
  const heap: [number, number][] = [];
  const push = (d: number, cell: number) => {
    heap.push([d, cell]);
    for (let i = heap.length - 1; i > 0; ) {
      const up = (i - 1) >> 1;
      if (heap[up]![0] <= heap[i]![0]) break;
      [heap[up], heap[i]] = [heap[i]!, heap[up]!];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0]!;
    const end = heap.pop()!;
    if (heap.length) {
      heap[0] = end;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let low = i;
        if (l < heap.length && heap[l]![0] < heap[low]![0]) low = l;
        if (r < heap.length && heap[r]![0] < heap[low]![0]) low = r;
        if (low === i) break;
        [heap[low], heap[i]] = [heap[i]!, heap[low]!];
        i = low;
      }
    }
    return top;
  };
  const cup = cupOf(h);
  const start = Math.floor((cup.y - f.y) / CELL) * cols + Math.floor((cup.x - f.x) / CELL);
  dist[start] = 0;
  push(0, start);
  while (heap.length) {
    const [d, cell] = pop();
    if (d > dist[cell]!) continue;
    const r = Math.floor(cell / cols);
    const c = cell % cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if ((!dr && !dc) || r + dr < 0 || r + dr >= rows || c + dc < 0 || c + dc >= cols) continue;
        const next = (r + dr) * cols + c + dc;
        if (!cost[next]) continue;
        const nd = d + (dr && dc ? 1.4142 : 1) * CELL * cost[next]!;
        if (nd < dist[next]!) {
          dist[next] = nd;
          push(nd, next);
        }
      }
    }
  }
  const field = { x: f.x, y: f.y, cols, rows, dist };
  fields.set(h.id, field);
  return field;
}

/** How far a ball lying here is from the cup, along the green. */
export function distanceToCup(h: GolfHole, x: number, y: number): number {
  const f = greenDistances(h);
  const c = Math.floor((x - f.x) / CELL);
  const r = Math.floor((y - f.y) / CELL);
  // A ball resting against a wall is in a cell no ball's centre is meant to reach: use its neighbours.
  let best = FAR;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (r + dr < 0 || r + dr >= f.rows || c + dc < 0 || c + dc >= f.cols) continue;
      const d = f.dist[(r + dr) * f.cols + c + dc]! + (dr || dc ? CELL : 0);
      if (d < best) best = d;
    }
  }
  return best;
}

const wrap = (angle: number) => ((Math.round(angle) % 36000) + 36000) % 36000;
const clampPower = (power: number) => Math.min(MAX_POWER, Math.max(MIN_POWER, Math.round(power)));

/** A putt tried in the head: lower is better; anything under zero is in the cup. */
const HOLED = -1e6;
function tryPutt(h: GolfHole, x: number, y: number, angle: number, power: number, penalty: number): number {
  const at = simulate(holeWorld(h, { id: "ball", x, y }), { body: "ball", angle, power }).world.bodies[0]!;
  if (at.pocketed !== undefined) return HOLED;
  // In the water: as bad as staying put and throwing strokes away.
  if (at.out !== undefined) return distanceToCup(h, x, y) + 3000 * (1 + penalty);
  return distanceToCup(h, at.x, at.y);
}

export interface Putt {
  angle: number;
  power: number;
  /** What the search made of it: under zero means it expects to hole out. */
  score: number;
  /** How many putts were simulated to find it. */
  tried: number;
}
const COARSE_POWERS = [200, 320, 430, 530, 640, 800, 1000];
const thoughts = new Map<string, Putt>();

/**
 * The best putt from here that a search can find: what a player with a perfect stroke would hit.
 * The work is bounded (at most 286 simulated putts) and remembered, since a table asks more than once.
 */
export function bestPutt(h: GolfHole, x: number, y: number, penalty = 1): Putt {
  const key = `${h.id}/${x}/${y}/${penalty}`;
  const known = thoughts.get(key);
  if (known) return known;
  let tried = 0;
  const score = (angle: number, power: number) => {
    tried++;
    return tryPutt(h, x, y, angle, power, penalty);
  };
  const cup = cupOf(h);
  const base = angleTo({ x, y }, cup);
  // Every direction, straight at the cup included, at a spread of strengths.
  let found: { angle: number; power: number; score: number }[] = [];
  for (let k = 0; k < 30; k++) for (const power of COARSE_POWERS) found.push({ angle: wrap(base + k * 1200), power, score: score(wrap(base + k * 1200), power) });
  found.sort((a, b) => a.score - b.score);
  // A closer look round the best few that aren't each other's neighbours.
  const seeds: typeof found = [];
  for (const f of found) {
    if (seeds.length >= 4) break;
    if (!seeds.some((s) => Math.abs(s.power - f.power) <= 120 && Math.min(Math.abs(s.angle - f.angle), 36000 - Math.abs(s.angle - f.angle)) <= 1200)) seeds.push(f);
  }
  for (const seed of seeds) {
    for (const da of [-360, -180, 0, 180, 360]) {
      for (const dp of [-50, 0, 50]) {
        if (!da && !dp) continue;
        const angle = wrap(seed.angle + da);
        const power = clampPower(seed.power + dp);
        found.push({ angle, power, score: score(angle, power) });
      }
    }
  }
  found.sort((a, b) => a.score - b.score);
  // Several putts may drop, in a few families: straight at the cup, off this wall, off that one.
  // From each family take the putt in the middle of its range of strengths (or, when nothing
  // drops, take the three that stop nearest), gentlest families first.
  const drops = found.filter((f) => f.score < 0).sort((a, b) => a.angle - b.angle);
  const families: (typeof found)[] = [];
  for (const f of drops) {
    const family = families.at(-1);
    if (family && f.angle - family.at(-1)!.angle <= 500) family.push(f);
    else families.push([f]);
  }
  const middles = families.map((family) => family.sort((a, b) => a.power - b.power)[family.length >> 1]!).sort((a, b) => a.power - b.power);
  const shortlist = middles.length ? middles.slice(0, 5) : found.slice(0, 3);
  // Of those, prefer the one that still works when it's hit a little wrong.
  let best = shortlist[0]!;
  let bestSteady = Infinity;
  for (const f of shortlist) {
    let near = 0;
    for (const [da, dp] of [[-120, -35], [120, -35], [-120, 35], [120, 35]] as const) near += Math.max(0, Math.min(score(wrap(f.angle + da), clampPower(f.power + dp)), 20000));
    // All else equal, the gentler putt: the plain one a person would try, not a full-power ricochet.
    const steady = (f.score < 0 ? -20000 : f.score) + near / 4 + f.power * 3;
    if (steady < bestSteady) [best, bestSteady] = [f, steady];
  }
  const putt = { ...best, tried };
  if (thoughts.size > 400) thoughts.clear();
  thoughts.set(key, putt);
  return putt;
}

/** The most a computer player's aim (hundredths of a degree) and strength (a share of it) can be off: at full skill, and how much more at none. */
export const AIM_SLIP = [300, 1100] as const;
export const POWER_SLIP = [0.2, 0.45] as const;

function bot(s: MiniGolfState, seat: number, style: PlayStyle, rand: () => number = Math.random): MiniGolfMove | null {
  if (s.phase === "holed") return s.ready[seat] ? null : { type: "next" };
  const ball = s.balls[seat];
  if (s.phase !== "playing" || !ball || ball.done || (s.turn !== null && s.turn !== seat)) return null;
  const ideal = bestPutt(holeOf(s), ball.x, ball.y, s.rules.penalty);
  const skill = Math.min(1, Math.max(0, style.skill ?? 1));
  const slip = careless(style, rand) ? 2 : 1;
  // Three dice make a bell: mostly near the middle, now and then out at the edge.
  const wobble = () => (rand() + rand() + rand() - 1.5) / 1.5;
  // At full skill the aim is within 3° and the strength within 20%, and usually a third of that;
  // at none, 14° and 65%. That is about what people manage with a thumb, which is the point: the
  // search alone would hole nearly everything from the tee.
  const angle = wrap(ideal.angle + wobble() * (AIM_SLIP[0] + (1 - skill) * AIM_SLIP[1]) * slip);
  const power = clampPower(ideal.power * (1 + wobble() * (POWER_SLIP[0] + (1 - skill) * POWER_SLIP[1]) * slip));
  return { type: "shot", body: ballId(seat), angle, power };
}

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): MiniGolfRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<MiniGolfRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? nineHoles;
  const r = { ...base, ...given };
  const course = courseOf(r.course);
  const whole = (v: unknown, min: number, max: number, or: number) => (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : or);
  return {
    id: String(r.id),
    name: String(r.name),
    course: course.id,
    holes: whole(r.holes, 1, course.holes.length, course.holes.length),
    order: r.order === "together" ? "together" : "turns",
    limit: whole(r.limit, 3, 12, 6),
    penalty: whole(r.penalty, 0, 3, 1),
  };
}

export const miniGolf: SportGame<MiniGolfRules, MiniGolfState, MiniGolfMove> = {
  id: "minigolf",
  name: "Mini Golf",
  emoji: "⛳",
  blurb: "Nine holes of putting, in turn or all at once",
  tagline: "Pull back, let go, and hope for a hole in one. Fewest strokes round the course wins.",
  seats: { min: 1, max: 6, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    ...(COURSES.length > 1 ? [{ key: "course" as const, label: "Course", kind: "choice" as const, options: COURSES.map((c): [string, string] => [c.id, c.name]) }] : []),
    { key: "holes", label: "Holes to play", kind: "choice", options: [[3, "The first three (a quick game)"], [9, "All nine"]] },
    { key: "order", label: "Who putts when", kind: "choice", hint: "Balls never knock into each other either way.", options: [["turns", "In turn: furthest from the cup plays next"], ["together", "Everyone at once, at their own pace"]] },
    { key: "limit", label: "Most strokes on a hole", kind: "number", min: 3, max: 12, hint: "Not in by then? Pick up and write down one more." },
    { key: "penalty", label: "Strokes for a ball in the water", kind: "choice", options: [[0, "None: just play it again"], [1, "One"], [2, "Two"]] },
  ],
  normalize,
  validate(r) {
    const course = COURSES.find((c) => c.id === r.course);
    if (!course) return ["That course isn't one we have."];
    return r.holes < 1 || r.holes > course.holes.length ? [`${course.name} has ${course.holes.length} holes.`] : [];
  },
  describe(r) {
    const course = courseOf(r.course);
    return [
      `${r.holes >= course.holes.length ? `All ${course.holes.length} holes` : `The first ${r.holes} holes`} of ${course.name}. Putt your ball into the cup in as few strokes as you can; the lowest total wins, and a tie is shared.`,
      "To putt, pull back from the ball and let go: the further you pull, the harder it goes. A ball going too fast skips over the cup.",
      r.order === "turns" ? "Everyone tees off in turn. After that, whoever is furthest from the cup plays next." : "Everyone plays at once, each at their own pace. The table moves on when all are in.",
      "Each player has a ball of their own, and balls pass through each other: nobody can knock yours away.",
      `A ball in the water is played again from where it was struck${r.penalty ? `, with ${r.penalty === 1 ? "a penalty stroke" : `${r.penalty} penalty strokes`}` : ", with no penalty"}.`,
      `Not in after ${r.limit} strokes? Pick up and write down ${r.limit + 1}.`,
    ];
  },
  newGame: newMiniGolf,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase !== "playing") return 500;
    // In turn, a player watches the last putt stop before stepping up; all at once, only their own.
    const last = s.rules.order === "turns" ? s.lasts.reduce<SportShot | null>((a, b) => (b && (!a || b.n > a.n) ? b : a), null) : s.lasts[seat];
    const rolling = last ? Math.round((last.ticks * 1000) / holeOf(s).world.tickRate) : 0;
    return rolling + thinkFor(3, s.balls[seat]?.teed ? 0.8 : 1.1);
  },
  warmUp() {
    // A putt thought through from every tee: the distance maps get made, and the simulation gets hot.
    for (const course of COURSES) for (const h of course.holes) bestPutt(h, h.tee[0], h.tee[1]);
  },
  summary(s) {
    const over = s.phase === "finished";
    const seats = Array.from({ length: s.seats }, (_, i) => i);
    return {
      game: "minigolf",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hole + 1,
      scoreLine: seats.map((i) => totalOf(s, i)).join(" · ") + (s.seats === 1 ? " strokes" : ""),
      order: over ? rankSeats(seats.map((i) => ({ seats: [i], score: totalOf(s, i) })), true) : null,
      winners: over ? winnersOf(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
