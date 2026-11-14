// Checks on a world and a shot before anything is simulated. Worlds will be written by hand (and
// one day by a hole editor), and shots arrive from browsers, so both are treated as unknown data.
// The limits are generous for a table game and tight enough that every number in a simulation
// stays far inside what a double holds exactly.
import { ANGLE_UNITS } from "./trig.js";
import type { Shot, World } from "./types.js";

export const MAX_COORD = 1_000_000;
export const MIN_RADIUS = 4;
export const MAX_BODIES = 256;
export const MAX_POWER = 1000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isCoord = (v: unknown): v is number => isInt(v) && v >= -MAX_COORD && v <= MAX_COORD;
const isPoint = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isCoord(v[0]) && isCoord(v[1]);

/** Everything wrong with a world, in plain words; an empty list means it can be simulated. */
export function validateWorld(world: unknown): string[] {
  const bad: string[] = [];
  if (!isObj(world)) return ["The world must be an object"];
  const w = world;

  const b = w.bounds;
  if (!isObj(b) || !isCoord(b.x) || !isCoord(b.y) || !isInt(b.w) || !isInt(b.h) || b.w <= 0 || b.h <= 0 || b.w > 2 * MAX_COORD || b.h > 2 * MAX_COORD) {
    bad.push("bounds must be { x, y, w, h } in whole numbers with a positive size");
  }
  if (!isInt(w.tickRate) || w.tickRate < 30 || w.tickRate > 1000) bad.push("tickRate must be a whole number from 30 to 1000");
  if (!isInt(w.maxTicks) || w.maxTicks < 1 || w.maxTicks > 1_000_000) bad.push("maxTicks must be a whole number from 1 to 1000000");
  if (!isNum(w.friction) || w.friction < 0) bad.push("friction must be zero or more");
  if (!isNum(w.restSpeed) || w.restSpeed < 0) bad.push("restSpeed must be zero or more");
  if (!isNum(w.restitution) || w.restitution < 0 || w.restitution > 1) bad.push("restitution must be from 0 to 1");
  if (!isNum(w.wallRestitution) || w.wallRestitution < 0 || w.wallRestitution > 1) bad.push("wallRestitution must be from 0 to 1");
  if (!isNum(w.maxShotSpeed) || w.maxShotSpeed < 0 || w.maxShotSpeed > 1e9) bad.push("maxShotSpeed must be zero or more");

  const ids = (kind: string) => {
    const seen = new Set<string>();
    return (id: unknown, at: string) => {
      if (typeof id !== "string" || id === "") bad.push(`${at} needs an id`);
      else if (seen.has(id)) bad.push(`Two ${kind} are called "${id}"`);
      else seen.add(id);
    };
  };

  if (!Array.isArray(w.bodies)) bad.push("bodies must be a list");
  else {
    if (w.bodies.length > MAX_BODIES) bad.push(`There can be at most ${MAX_BODIES} bodies`);
    const id = ids("bodies");
    w.bodies.forEach((body: unknown, i: number) => {
      const at = `Body ${i}`;
      if (!isObj(body)) return void bad.push(`${at} must be an object`);
      id(body.id, at);
      if (!isCoord(body.x) || !isCoord(body.y)) bad.push(`${at} needs whole-number x and y`);
      if (!isInt(body.r) || body.r < MIN_RADIUS || body.r > MAX_COORD) bad.push(`${at} needs a whole-number radius of at least ${MIN_RADIUS}`);
      if (body.mass !== undefined && (!isNum(body.mass) || body.mass <= 0 || body.mass > 1e6 || body.mass < 1e-6)) bad.push(`${at} has a mass that isn't a sensible positive number`);
      if (body.fixed !== undefined && typeof body.fixed !== "boolean") bad.push(`${at}: fixed must be true or false`);
      if (body.restitution !== undefined && (!isNum(body.restitution) || body.restitution < 0 || body.restitution > 1)) bad.push(`${at}: restitution must be from 0 to 1`);
      for (const k of ["vx", "vy"] as const) if (body[k] !== undefined && (!isNum(body[k]) || Math.abs(body[k] as number) > 1e9)) bad.push(`${at}: ${k} must be a number`);
      for (const k of ["pocketed", "out"] as const) if (body[k] !== undefined && typeof body[k] !== "string") bad.push(`${at}: ${k} must be an id`);
      if (!spinIsZero(body.spin)) bad.push(`${at}: spin is not simulated yet and must be left out or zero`);
      const gone = body.pocketed !== undefined || body.out !== undefined;
      if (!gone && isObj(b) && isCoord(body.x) && isCoord(body.y) && isNum(b.x) && isNum(b.y) && isNum(b.w) && isNum(b.h)) {
        if (body.x < b.x || body.x > b.x + b.w || body.y < b.y || body.y > b.y + b.h) bad.push(`${at} is outside the bounds`);
      }
    });
  }

  if (!Array.isArray(w.walls)) bad.push("walls must be a list");
  else {
    const id = ids("walls");
    w.walls.forEach((wall: unknown, i: number) => {
      const at = `Wall ${i}`;
      if (!isObj(wall)) return void bad.push(`${at} must be an object`);
      id(wall.id, at);
      const pts = wall.points;
      if (!Array.isArray(pts) || pts.length < 2 || !pts.every(isPoint)) return void bad.push(`${at} needs two or more whole-number points`);
      if (wall.closed !== undefined && typeof wall.closed !== "boolean") bad.push(`${at}: closed must be true or false`);
      if (wall.closed === true && pts.length < 3) bad.push(`${at} is closed, so it needs three or more points`);
      const n = wall.closed === true ? pts.length : pts.length - 1;
      for (let k = 0; k < n; k++) {
        const p = pts[k] as [number, number];
        const q = pts[(k + 1) % pts.length] as [number, number];
        if (p[0] === q[0] && p[1] === q[1]) bad.push(`${at} has the same point twice in a row`);
      }
      if (wall.restitution !== undefined && (!isNum(wall.restitution) || wall.restitution < 0 || wall.restitution > 1)) bad.push(`${at}: restitution must be from 0 to 1`);
    });
  }

  if (!Array.isArray(w.pockets)) bad.push("pockets must be a list");
  else {
    const id = ids("pockets");
    w.pockets.forEach((p: unknown, i: number) => {
      const at = `Pocket ${i}`;
      if (!isObj(p)) return void bad.push(`${at} must be an object`);
      id(p.id, at);
      if (!isCoord(p.x) || !isCoord(p.y)) bad.push(`${at} needs whole-number x and y`);
      if (!isInt(p.r) || p.r < 1 || p.r > MAX_COORD) bad.push(`${at} needs a whole-number radius`);
      if (p.maxSpeed !== undefined && (!isNum(p.maxSpeed) || p.maxSpeed < 0)) bad.push(`${at}: maxSpeed must be zero or more`);
    });
  }

  if (!Array.isArray(w.regions)) bad.push("regions must be a list");
  else {
    const id = ids("regions");
    w.regions.forEach((r: unknown, i: number) => {
      const at = `Region ${i}`;
      if (!isObj(r)) return void bad.push(`${at} must be an object`);
      id(r.id, at);
      if (r.id === "bounds") bad.push(`${at} can't be called "bounds": that name means the edge of the world`);
      const s = r.shape;
      if (!isObj(s)) bad.push(`${at} needs a shape`);
      else if (s.points !== undefined) {
        if (!Array.isArray(s.points) || s.points.length < 3 || !s.points.every(isPoint)) bad.push(`${at}: a polygon needs three or more whole-number points`);
      } else if (!isCoord(s.x) || !isCoord(s.y) || !isInt(s.r) || s.r < 1 || s.r > MAX_COORD) bad.push(`${at}: a shape is { points } or { x, y, r } in whole numbers`);
      if (r.friction !== undefined && (!isNum(r.friction) || r.friction < 0)) bad.push(`${at}: friction must be zero or more`);
      if (r.slope !== undefined && !(Array.isArray(r.slope) && r.slope.length === 2 && isNum(r.slope[0]) && isNum(r.slope[1]))) bad.push(`${at}: slope must be [x, y]`);
      if (r.out !== undefined && typeof r.out !== "boolean") bad.push(`${at}: out must be true or false`);
    });
  }
  return bad;
}

function spinIsZero(spin: unknown): boolean {
  if (spin === undefined) return true;
  return isObj(spin) && spin.side === 0 && spin.top === 0;
}

/** Everything wrong with a shot on this world; an empty list means it can be played. */
export function validateShot(world: World, shot: unknown): string[] {
  if (!isObj(shot)) return ["The shot must be an object"];
  const bad: string[] = [];
  const body = world.bodies.find((b) => b.id === shot.body);
  if (!body) bad.push("The shot names a ball that isn't on the table");
  else if (body.fixed) bad.push("That can't be struck: it is fixed in place");
  else if (body.pocketed !== undefined || body.out !== undefined) bad.push("That ball is not in play");
  if (!isInt(shot.angle) || shot.angle < 0 || shot.angle >= ANGLE_UNITS) bad.push(`The angle must be a whole number from 0 to ${ANGLE_UNITS - 1}`);
  if (!isInt(shot.power) || shot.power < 0 || shot.power > MAX_POWER) bad.push(`The power must be a whole number from 0 to ${MAX_POWER}`);
  if (!spinIsZero(shot.spin)) bad.push("Spin is not simulated yet and must be left out or zero");
  return bad;
}

/** A world or shot that can't be simulated. The message lists what is wrong. */
export class PhysicsError extends Error {}
