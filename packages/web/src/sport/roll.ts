// Playing a shot on the screen. The server has already decided where everything stops; what a
// browser does is run the very same simulation from the very same bodies, a few steps a frame,
// and draw each step. Because the physics core is deterministic to the bit, the last step lands
// exactly on the table the server stored, so the animation is a replay and never a guess.
//
// That is checked every time (`landed`), in every build, because it is cheap and because the one
// time it failed would be the time someone wants to know. If it ever does fail (a browser running
// an older build against a newer server, say), nothing breaks: the table screen shows the
// server's table when the roll ends, whatever the roll did.
import { sameRest, worldBefore, type SportShot, type SportView } from "@cardroom/games";
import { PHYSICS_VERSION, result, start, step, type Point, type Run, type SimEvent, type World } from "@cardroom/physics";

export interface Roll {
  /** The view this shot leads to: shown once the roll is over. */
  target: SportView;
  record: SportShot;
  /** The world the shot started from. */
  world: World;
  /** The running simulation, or null when this browser can't step it (another physics version). */
  run: Run | null;
  /** Where each body of the run is now. */
  at: Map<string, { x: number; y: number; r: number; live: boolean }>;
  /** When each ball dropped into a pocket, and where each went in the water (ms on the roll's own clock). */
  sunk: Map<string, number>;
  splashes: { x: number; y: number; at: number }[];
  /** The path of the struck body, kept for when the roll is shown as a line and not as motion. */
  trace: Point[];
  /** Shown as a trace: the result at once, with the path drawn over it. */
  jump: boolean;
  /** The roll's own clock, in ms: it runs faster when the table is hurrying to catch up. */
  clock: number;
  /** Steps owed but not yet taken (a fraction of one carries over to the next frame). */
  owed: number;
  /** The clock time at which the physics came to rest, or null while it is moving. */
  rested: number | null;
  /** How long to hold the resting picture before the table moves on: longer when there is a drop or a splash to see. */
  hold: number;
  over: boolean;
}

/** A browser can only replay a shot played by the same physics it has. */
export const canStep = (record: SportShot) => record.physics === PHYSICS_VERSION;

export function beginRoll(target: SportView, jump: boolean): Roll {
  const record = target.last!;
  const world = worldBefore(target)!;
  const roll: Roll = {
    target,
    record,
    world,
    run: canStep(record) ? start(world, record.shot) : null,
    at: new Map(world.bodies.map((b) => [b.id, { x: b.x, y: b.y, r: b.r, live: b.pocketed === undefined && b.out === undefined }])),
    sunk: new Map(),
    splashes: [],
    trace: [],
    jump: jump || !canStep(record),
    clock: 0,
    owed: 0,
    rested: null,
    hold: 250,
    over: false,
  };
  const struck = roll.at.get(record.shot.body);
  if (struck) roll.trace.push([struck.x, struck.y]);
  return roll;
}

/** One step of the simulation, drawn into the roll. Returns what happened in it. */
function tick(roll: Roll): SimEvent[] {
  const frame = step(roll.run!);
  for (const b of frame.bodies) {
    const at = roll.at.get(b.id);
    if (at) [at.x, at.y, at.live] = [b.x, b.y, b.live];
  }
  for (const e of frame.events) {
    if (e.type === "pocket") roll.sunk.set(e.body, roll.clock);
    if (e.type === "out") {
      const at = roll.at.get(e.body);
      if (at) roll.splashes.push({ x: at.x, y: at.y, at: roll.clock });
    }
    if (e.type === "pocket" || e.type === "out") roll.hold = 650;
  }
  const struck = roll.at.get(roll.record.shot.body);
  // Every few steps is plenty for a line, and always the last one.
  if (struck && (frame.tick % 4 === 0 || frame.done)) roll.trace.push([struck.x, struck.y]);
  return frame.events;
}

/** Runs the rest of the simulation at once. Returns everything that happened. */
export function finishRoll(roll: Roll): SimEvent[] {
  const events: SimEvent[] = [];
  while (roll.run && !roll.run.done) events.push(...tick(roll));
  if (!roll.run) {
    // Nothing to step: put the bodies where the server says they stopped.
    for (const r of roll.record.rest) {
      const at = roll.at.get(r.id);
      if (at) [at.x, at.y, at.live] = [r.x, r.y, r.pocketed === undefined && r.out === undefined];
      if (r.id === roll.record.shot.body) roll.trace.push([r.x, r.y]);
    }
  }
  if (roll.rested === null) roll.rested = roll.clock;
  return events;
}

/**
 * Moves a roll on by `ms` of real time at `speed`. Steps the simulation at the world's own tick
 * rate, whatever the screen's frame rate, and returns the events of the steps it took so their
 * sounds play as they happen.
 */
export function advanceRoll(roll: Roll, ms: number, speed: number): SimEvent[] {
  let events: SimEvent[] = [];
  roll.clock += ms * speed;
  if (roll.rested === null) {
    if (roll.jump || !roll.run) {
      events = finishRoll(roll);
      // A trace stays up a moment longer: it is all there is to see.
      roll.hold = Math.max(roll.hold, 700);
    } else {
      roll.owed += (ms * speed * roll.world.tickRate) / 1000;
      while (roll.owed >= 1 && !roll.run.done) {
        roll.owed -= 1;
        events.push(...tick(roll));
      }
      if (roll.run.done) roll.rested = roll.clock;
    }
  }
  if (roll.rested !== null && roll.clock - roll.rested >= roll.hold) roll.over = true;
  return events;
}

/**
 * Whether the roll stopped exactly where the server's did: every body, to the unit. True too for a
 * roll this browser couldn't step, which made no claim.
 */
export function landed(roll: Roll): boolean {
  if (!roll.run) return true;
  if (!roll.run.done) return false;
  return sameRest(result(roll.run).world, roll.record.rest);
}
