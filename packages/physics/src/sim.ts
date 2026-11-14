// The simulation. One shot is run step by step until everything is at rest, and the same run has
// to come out bit for bit the same on the server and in every browser, because the server stores
// only the resting table and each browser animates the shot for itself.
//
// What makes that hold:
//  - Numbers are ordinary doubles, but the only operations on them are + - * /, comparisons and
//    Math.sqrt, which IEEE-754 and the language pin down exactly. No sin, cos, atan2, pow, exp or
//    hypot anywhere (see trig.ts for how an angle becomes a direction), no `**`.
//  - The step is fixed and belongs to the world (`tickRate`), never to a clock or a frame rate.
//  - Everything is visited in the order the world lists it, and ties go to the first one found.
//  - At rest, positions are rounded to whole numbers, so the next shot starts from the same
//    integers everywhere and the stored table is small and exact.
//
// How a step works. First the ground acts on each ball: slopes push, friction slows. Then the
// balls move for one step in straight lines, and rather than moving them and looking for overlaps
// afterwards, the step finds the earliest moment anything touches anything (a quadratic at most),
// moves everything to that moment, bounces the pair, and repeats until the step is used up.
// Nothing ever moves further than its next contact, so nothing passes through a wall or another
// ball however fast it goes.
import { direction } from "./trig.js";
import type { Frame, Shape, Shot, SimEvent, SimResult, World } from "./types.js";
import { MAX_POWER, PhysicsError, validateShot, validateWorld } from "./validate.js";

/**
 * Bump this whenever a change could alter where anything comes to rest. A room restored by
 * replaying its shots only lands on the same table if the physics is the same physics.
 */
export const PHYSICS_VERSION = 1;

// Two things closing on each other slower than this (units per step) are treated as not closing.
// A bounce leaves rounding dust in the velocity, and without the margin the same contact would be
// found again and again at the same instant.
const EPS = 1e-9;
// How many steps in a row everything has to be still before the shot is over. More than one, so
// a ball caught at the top of its roll up a slope isn't taken for one that has stopped.
const REST_TICKS = 4;

interface Disc {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** 1 / mass; 0 for a fixed body, which is how it takes a hit without moving. */
  im: number;
  fixed: boolean;
  rest: number;
  live: boolean;
  pocketed: string | undefined;
  out: string | undefined;
  /** This step: the slope's pull here, whether the ground can hold a still ball, whether it touched anything. */
  drive: number;
  held: boolean;
  contact: boolean;
}
interface Seg {
  wall: number;
  ax: number;
  ay: number;
  /** Unit vector along the piece, its length, and the unit normal. */
  ex: number;
  ey: number;
  len: number;
  nx: number;
  ny: number;
  rest: number;
}
interface Corner {
  wall: number;
  x: number;
  y: number;
  rest: number;
}
interface Hole {
  id: string;
  x: number;
  y: number;
  r2: number;
  /** Squared, per step. Infinity for a hole that takes anything. */
  max2: number;
}
interface Ground {
  id: string;
  shape: Shape;
  /** Per step squared; -1 when the region doesn't set it. */
  friction: number;
  ax: number;
  ay: number;
  acts: boolean;
  out: boolean;
}

/**
 * A shot in progress. `start` makes one and `step` moves it on; it is the one thing in this
 * package that changes in place, and it belongs to whoever started it. Treat everything but `tick`
 * and `done` as private.
 */
export interface Run {
  readonly tick: number;
  readonly done: boolean;
}
interface State {
  world: World;
  tick: number;
  done: boolean;
  capped: boolean;
  still: number;
  discs: Disc[];
  segs: Seg[];
  corners: Corner[];
  holes: Hole[];
  grounds: Ground[];
  wallIds: string[];
  friction: number;
  rest2: number;
  restSpeed: number;
  restitution: number;
  /** The step each pair last touched, so a lasting contact is reported once. */
  lastHit: Int32Array;
  lastWall: Int32Array;
  lastSkip: Int32Array;
  /** Holes a ball is crossing too fast this step, so the crossing isn't found twice. */
  over: Uint8Array;
  shooter: number;
  firstContact: string | null;
  events: SimEvent[];
}

function inShape(s: Shape, x: number, y: number): boolean {
  if ("points" in s) {
    // Even-odd rule: count the edges a ray to the right crosses.
    let inside = false;
    const pts = s.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i]!;
      const [xj, yj] = pts[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const dx = x - s.x;
  const dy = y - s.y;
  return dx * dx + dy * dy < s.r * s.r;
}

/**
 * Sets a shot going. The world is checked first and never changed. Without a shot, the bodies
 * move with whatever `vx`, `vy` the world gives them.
 */
export function start(world: World, shot?: Shot): Run {
  const bad = validateWorld(world);
  if (shot !== undefined && bad.length === 0) bad.push(...validateShot(world, shot));
  if (bad.length) throw new PhysicsError(bad.join(". "));

  const rate = world.tickRate;
  const perTick = (speed: number) => speed / rate;
  const perTick2 = (accel: number) => accel / (rate * rate);

  const discs: Disc[] = world.bodies.map((b) => ({
    id: b.id,
    x: b.x,
    y: b.y,
    vx: b.fixed ? 0 : perTick(b.vx ?? 0),
    vy: b.fixed ? 0 : perTick(b.vy ?? 0),
    r: b.r,
    im: b.fixed ? 0 : 1 / (b.mass ?? 1),
    fixed: b.fixed === true,
    rest: b.restitution ?? world.restitution,
    live: b.pocketed === undefined && b.out === undefined,
    pocketed: b.pocketed,
    out: b.out,
    drive: 0,
    held: true,
    contact: false,
  }));

  const segs: Seg[] = [];
  const corners: Corner[] = [];
  world.walls.forEach((wall, wi) => {
    const rest = wall.restitution ?? world.wallRestitution;
    const pts = wall.points;
    for (const [x, y] of pts) corners.push({ wall: wi, x, y, rest });
    const n = wall.closed ? pts.length : pts.length - 1;
    for (let k = 0; k < n; k++) {
      const [ax, ay] = pts[k]!;
      const [bx, by] = pts[(k + 1) % pts.length]!;
      const len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      const ex = (bx - ax) / len;
      const ey = (by - ay) / len;
      segs.push({ wall: wi, ax, ay, ex, ey, len, nx: 0 - ey, ny: ex, rest });
    }
  });

  const holes: Hole[] = world.pockets.map((p) => ({
    id: p.id,
    x: p.x,
    y: p.y,
    r2: p.r * p.r,
    max2: p.maxSpeed === undefined ? Infinity : perTick(p.maxSpeed) * perTick(p.maxSpeed),
  }));
  const grounds: Ground[] = world.regions.map((g) => ({
    id: g.id,
    shape: g.shape,
    friction: g.friction === undefined ? -1 : perTick2(g.friction),
    ax: g.slope ? perTick2(g.slope[0]) : 0,
    ay: g.slope ? perTick2(g.slope[1]) : 0,
    acts: g.friction !== undefined || g.slope !== undefined,
    out: g.out === true,
  }));

  let shooter = -1;
  if (shot) {
    shooter = discs.findIndex((d) => d.id === shot.body);
    const d = discs[shooter]!;
    const [dx, dy] = direction(shot.angle);
    const speed = perTick((shot.power * world.maxShotSpeed) / MAX_POWER);
    d.vx = dx * speed;
    d.vy = dy * speed;
  }

  const n = discs.length;
  const restSpeed = perTick(world.restSpeed);
  const state: State = {
    world,
    tick: 0,
    done: false,
    capped: false,
    still: 0,
    discs,
    segs,
    corners,
    holes,
    grounds,
    wallIds: world.walls.map((w) => w.id),
    friction: perTick2(world.friction),
    rest2: restSpeed * restSpeed,
    restSpeed,
    restitution: world.restitution,
    lastHit: new Int32Array(n * n).fill(-9),
    lastWall: new Int32Array(n * world.walls.length).fill(-9),
    lastSkip: new Int32Array(n * holes.length).fill(-9),
    over: new Uint8Array(n * holes.length),
    shooter,
    firstContact: null,
    events: [],
  };
  return state;
}

// Marks a pair as touching this step, and says whether that is news: true unless they were
// already touching in this step or the one before.
function fresh(last: Int32Array, at: number, tick: number): boolean {
  const before = last[at]!;
  last[at] = tick;
  return before < tick - 1;
}

function drop(s: State, d: Disc, h: Hole, ev: SimEvent[]): void {
  d.live = false;
  d.pocketed = h.id;
  d.x = h.x;
  d.y = h.y;
  d.vx = 0;
  d.vy = 0;
  ev.push({ type: "pocket", tick: s.tick, body: d.id, pocket: h.id });
}

// A ball is out when its centre is past the edge of the world or on ground marked out. It stays
// where it went out, on a whole number, for the game to do what its rules say.
function checkOut(s: State, d: Disc, ev: SimEvent[]): void {
  const b = s.world.bounds;
  let region: string | undefined;
  if (d.x < b.x || d.x > b.x + b.w || d.y < b.y || d.y > b.y + b.h) region = "bounds";
  else for (const g of s.grounds) if (g.out && inShape(g.shape, d.x, d.y)) { region = g.id; break; }
  if (region === undefined) return;
  d.live = false;
  d.out = region;
  d.x = Math.round(d.x);
  d.y = Math.round(d.y);
  d.vx = 0;
  d.vy = 0;
  ev.push({ type: "out", tick: s.tick, body: d.id, region });
}

function advance(s: State): SimEvent[] {
  const ev: SimEvent[] = [];
  const { discs, segs, corners, holes } = s;
  const n = discs.length;
  const nh = holes.length;
  const rate = s.world.tickRate;
  s.tick++;

  // The ground. A slow ball on ground that can hold it (friction at least as strong as the
  // slope's pull) simply stops: that is the rest threshold. Anything else is pushed by the slope
  // and then slowed by friction, which takes a fixed amount off the speed each step and so
  // brings a ball to exactly zero rather than creeping towards it for ever.
  for (const d of discs) {
    if (!d.live || d.fixed) continue;
    d.contact = false;
    let f = s.friction;
    let ax = 0;
    let ay = 0;
    for (const g of s.grounds) {
      if (!g.acts || !inShape(g.shape, d.x, d.y)) continue;
      if (g.friction >= 0) f = g.friction;
      ax += g.ax;
      ay += g.ay;
    }
    const pull = ax === 0 && ay === 0 ? 0 : Math.sqrt(ax * ax + ay * ay);
    d.drive = pull;
    d.held = pull <= f;
    if (d.held && d.vx * d.vx + d.vy * d.vy < s.rest2) {
      d.vx = 0;
      d.vy = 0;
    } else {
      d.vx += ax;
      d.vy += ay;
      const speed = Math.sqrt(d.vx * d.vx + d.vy * d.vy);
      if (speed <= f) {
        d.vx = 0;
        d.vy = 0;
      } else {
        const k = (speed - f) / speed;
        d.vx *= k;
        d.vy *= k;
      }
    }
  }

  // A ball already over a hole drops as soon as it is slow enough.
  s.over.fill(0);
  for (let i = 0; i < n; i++) {
    const d = discs[i]!;
    if (!d.live || d.fixed) continue;
    for (let p = 0; p < nh; p++) {
      const h = holes[p]!;
      const dx = d.x - h.x;
      const dy = d.y - h.y;
      if (dx * dx + dy * dy >= h.r2) continue;
      if (d.vx * d.vx + d.vy * d.vy <= h.max2) {
        drop(s, d, h, ev);
        break;
      }
      s.over[i * nh + p] = 1;
    }
  }

  // The move. Kinds of contact: 1 two discs, 2 a wall piece, 3 a wall corner, 4 the rim of a hole.
  let remaining = 1;
  // If one step needs more contacts than this (balls wedged in a corner, trading the same push
  // back and forth), everything waits where it is for the rest of the step. Nothing is lost but a
  // sliver of time, and friction ends the argument within a few steps.
  const cap = 16 + 8 * n;
  for (let count = 0; ; ) {
    let bt = remaining;
    let kind = 0;
    let bi = -1;
    let bj = -1;
    let side = 1;
    for (let i = 0; i < n; i++) {
      const a = discs[i]!;
      if (!a.live) continue;
      const moving = a.vx !== 0 || a.vy !== 0;
      for (let j = i + 1; j < n; j++) {
        const b = discs[j]!;
        if (!b.live || (!moving && b.vx === 0 && b.vy === 0)) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const wx = b.vx - a.vx;
        const wy = b.vy - a.vy;
        const reach = a.r + b.r;
        // Too far apart to meet within one step, whichever way they are heading: skip the sums.
        if (Math.abs(dx) > reach + Math.abs(wx) || Math.abs(dy) > reach + Math.abs(wy)) continue;
        const closing = dx * wx + dy * wy;
        if (closing > -EPS * reach) continue;
        const gap = dx * dx + dy * dy - reach * reach;
        let t = 0;
        if (gap > 0) {
          const ww = wx * wx + wy * wy;
          const disc = closing * closing - ww * gap;
          if (disc < 0) continue;
          t = (-closing - Math.sqrt(disc)) / ww;
          if (t < 0) t = 0;
        }
        if (t < bt) {
          bt = t;
          kind = 1;
          bi = i;
          bj = j;
        }
      }
      if (!moving) continue;
      const avx = Math.abs(a.vx);
      const avy = Math.abs(a.vy);

      for (let k = 0; k < segs.length; k++) {
        const g = segs[k]!;
        const px = a.x - g.ax;
        const py = a.y - g.ay;
        let dist = px * g.nx + py * g.ny;
        let vn = a.vx * g.nx + a.vy * g.ny;
        let sgn = 1;
        // Work on whichever side of the wall the ball is. Dead on the line, call it the side it
        // is heading away from, so that it is turned back the way it came.
        if (dist < 0 || (dist === 0 && vn > 0)) {
          dist = -dist;
          vn = -vn;
          sgn = -1;
        }
        if (vn > -EPS) continue;
        let t = 0;
        if (dist > a.r) {
          t = (dist - a.r) / -vn;
          if (t >= bt) continue;
        }
        // Only the straight part counts here; past either end it is the corner's business.
        const along = (px + a.vx * t) * g.ex + (py + a.vy * t) * g.ey;
        if (along < 0 || along > g.len) continue;
        if (t < bt) {
          bt = t;
          kind = 2;
          bi = i;
          bj = k;
          side = sgn;
        }
      }

      for (let k = 0; k < corners.length; k++) {
        const c = corners[k]!;
        const dx = a.x - c.x;
        const dy = a.y - c.y;
        if (Math.abs(dx) > a.r + avx || Math.abs(dy) > a.r + avy) continue;
        const closing = dx * a.vx + dy * a.vy;
        if (closing > -EPS * a.r) continue;
        const gap = dx * dx + dy * dy - a.r * a.r;
        let t = 0;
        if (gap > 0) {
          const vv = a.vx * a.vx + a.vy * a.vy;
          const disc = closing * closing - vv * gap;
          if (disc < 0) continue;
          t = (-closing - Math.sqrt(disc)) / vv;
          if (t < 0) t = 0;
        }
        if (t < bt) {
          bt = t;
          kind = 3;
          bi = i;
          bj = k;
        }
      }

      for (let p = 0; p < nh; p++) {
        if (s.over[i * nh + p]) continue;
        const h = holes[p]!;
        const dx = a.x - h.x;
        const dy = a.y - h.y;
        const closing = dx * a.vx + dy * a.vy;
        if (closing >= 0) continue;
        const gap = dx * dx + dy * dy - h.r2;
        let t = 0;
        if (gap > 0) {
          const vv = a.vx * a.vx + a.vy * a.vy;
          const disc = closing * closing - vv * gap;
          if (disc < 0) continue;
          t = (-closing - Math.sqrt(disc)) / vv;
          if (t < 0) t = 0;
        }
        if (t < bt) {
          bt = t;
          kind = 4;
          bi = i;
          bj = p;
        }
      }
    }

    const dt = kind === 0 ? remaining : bt;
    if (dt > 0) {
      for (const d of discs) {
        if (!d.live) continue;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
    }
    if (kind === 0) break;
    remaining -= bt;
    const a = discs[bi]!;

    if (kind === 1) {
      const b = discs[bj]!;
      let nx = b.x - a.x;
      let ny = b.y - a.y;
      const dist = Math.sqrt(nx * nx + ny * ny);
      if (dist > 0) {
        nx /= dist;
        ny /= dist;
      } else {
        // Two centres on the same spot have no line between them; any fixed one will do.
        nx = 1;
        ny = 0;
      }
      const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (vn < 0) {
        // A touch too gentle to bounce is a lean, not a hit. The margin grows with the slope
        // pressing the two together, or a ball lying against another downhill would chatter.
        const e = -vn < s.restSpeed + 2 * (a.drive + b.drive) ? 0 : a.rest < b.rest ? a.rest : b.rest;
        const push = (-(1 + e) * vn) / (a.im + b.im);
        a.vx -= push * a.im * nx;
        a.vy -= push * a.im * ny;
        b.vx += push * b.im * nx;
        b.vy += push * b.im * ny;
      }
      a.contact = true;
      b.contact = true;
      // A pass so close that the two only brush, with nothing pressing them together, is not a hit.
      if (vn < -EPS) {
        if (s.firstContact === null && (bi === s.shooter || bj === s.shooter)) s.firstContact = bi === s.shooter ? b.id : a.id;
        if (fresh(s.lastHit, bi * n + bj, s.tick)) ev.push({ type: "hit", tick: s.tick, a: a.id, b: b.id, speed: -vn * rate });
      }
    } else if (kind === 2 || kind === 3) {
      let nx: number;
      let ny: number;
      let rest: number;
      let wall: number;
      if (kind === 2) {
        const g = segs[bj]!;
        nx = g.nx * side;
        ny = g.ny * side;
        rest = g.rest;
        wall = g.wall;
      } else {
        const c = corners[bj]!;
        nx = a.x - c.x;
        ny = a.y - c.y;
        const dist = Math.sqrt(nx * nx + ny * ny);
        const speed = Math.sqrt(a.vx * a.vx + a.vy * a.vy);
        if (dist > 0) {
          nx /= dist;
          ny /= dist;
        } else {
          nx = -a.vx / speed;
          ny = -a.vy / speed;
        }
        rest = c.rest;
        wall = c.wall;
      }
      const vn = a.vx * nx + a.vy * ny;
      if (vn < 0) {
        const e = -vn < s.restSpeed + 2 * a.drive ? 0 : rest;
        a.vx -= (1 + e) * vn * nx;
        a.vy -= (1 + e) * vn * ny;
      }
      a.contact = true;
      if (vn < -EPS && fresh(s.lastWall, bi * s.wallIds.length + wall, s.tick)) ev.push({ type: "wall", tick: s.tick, body: a.id, wall: s.wallIds[wall]!, speed: -vn * rate });
    } else {
      const h = holes[bj]!;
      if (a.vx * a.vx + a.vy * a.vy <= h.max2) drop(s, a, h, ev);
      else {
        s.over[bi * nh + bj] = 1;
        if (fresh(s.lastSkip, bi * nh + bj, s.tick)) ev.push({ type: "skip", tick: s.tick, body: a.id, pocket: h.id });
      }
    }
    if (++count >= cap) break;
  }

  for (const d of discs) if (d.live && !d.fixed) checkOut(s, d, ev);

  // Rest. A ball counts as still when it has no speed at all, or is slow and either on ground
  // that holds it or leaning on something.
  let still = true;
  for (const d of discs) {
    if (!d.live || d.fixed) continue;
    if (d.vx === 0 && d.vy === 0) continue;
    if (d.vx * d.vx + d.vy * d.vy < s.rest2 && (d.held || d.contact)) continue;
    still = false;
    break;
  }
  s.still = still ? s.still + 1 : 0;

  if (s.still >= REST_TICKS) settle(s, ev);
  else if (s.tick >= s.world.maxTicks) {
    s.capped = true;
    ev.push({ type: "capped", tick: s.tick });
    settle(s, ev);
  }
  for (const e of ev) s.events.push(e);
  return ev;
}

// The end of a shot: everything stops and moves onto whole numbers. Rounding can nudge a ball
// that stopped on the lip of a hole or the edge of the water over it, so those are looked at once
// more; otherwise the stored table would hold a ball that drops by itself at the start of the
// next shot.
function settle(s: State, ev: SimEvent[]): void {
  for (const d of s.discs) {
    if (!d.live || d.fixed) continue;
    d.vx = 0;
    d.vy = 0;
    d.x = Math.round(d.x);
    d.y = Math.round(d.y);
    for (const h of s.holes) {
      const dx = d.x - h.x;
      const dy = d.y - h.y;
      if (dx * dx + dy * dy < h.r2) {
        drop(s, d, h, ev);
        break;
      }
    }
    if (d.live) checkOut(s, d, ev);
  }
  s.done = true;
}

function frame(s: State, events: SimEvent[]): Frame {
  const rate = s.world.tickRate;
  return {
    tick: s.tick,
    done: s.done,
    events,
    bodies: s.discs.map((d) => ({ id: d.id, x: d.x, y: d.y, vx: d.vx * rate, vy: d.vy * rate, live: d.live })),
  };
}

/** Moves a run on by one step and says where everything is and what happened in that step. */
export function step(run: Run): Frame {
  const s = run as State;
  if (s.done) throw new PhysicsError("This shot has already come to rest");
  return frame(s, advance(s));
}

/** The outcome of a run that has come to rest. */
export function result(run: Run): SimResult {
  const s = run as State;
  if (!s.done) throw new PhysicsError("This shot is still moving");
  const bodies = s.world.bodies.map((b, i) => {
    const d = s.discs[i]!;
    const { vx: _vx, vy: _vy, ...rest } = b;
    const at = { ...rest, x: d.x, y: d.y };
    if (d.pocketed !== undefined) at.pocketed = d.pocketed;
    if (d.out !== undefined) at.out = d.out;
    return at;
  });
  return { world: { ...s.world, bodies }, events: s.events.slice(), ticks: s.tick, capped: s.capped, firstContact: s.firstContact };
}

/**
 * Plays a shot to rest in one call: what a game engine uses to apply a move. Pure: the same world
 * and shot always give the same result, and the world passed in is not changed.
 */
export function simulate(world: World, shot?: Shot): SimResult {
  const run = start(world, shot);
  const s = run as State;
  while (!s.done) advance(s);
  return result(run);
}

/**
 * The same shot one step at a time: what a canvas uses to draw it. Yields a frame per step and
 * returns the same result `simulate` gives, because it is the same code taking the same steps.
 */
export function* frames(world: World, shot?: Shot): Generator<Frame, SimResult, void> {
  const run = start(world, shot);
  while (!run.done) yield step(run);
  return result(run);
}
