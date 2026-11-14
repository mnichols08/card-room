// The world format. A table (a mini golf hole, a pool table, a Carrom board) is plain data: it
// goes through JSON unchanged, sits in a room's state, and is what every browser simulates from.
//
// Units. Lengths are whole numbers in whatever unit the game picks; the two example worlds use a
// tenth of a millimetre, which keeps a resting ball's position exact to well under anything the eye
// can see. Speeds are units per second and accelerations units per second squared, so the numbers
// in a world mean something to the person writing it; `tickRate` turns them into per-step values.

export type Point = [x: number, y: number];

export interface World {
  /** A ball whose centre leaves this rectangle is out. It is the net under everything else. */
  bounds: { x: number; y: number; w: number; h: number };
  /** Simulation steps per second. The step is fixed: it is part of the table, not of the device. */
  tickRate: number;
  /** A shot is stopped after this many steps, whatever is still moving. */
  maxTicks: number;
  /** How fast a ball slows on open ground, in units/s². Regions can have their own. */
  friction: number;
  /** A ball slower than this, on ground that can hold it, stops. Units/s. */
  restSpeed: number;
  /** Bounce between two balls, 0 to 1. A body can carry its own; the lower of the two is used. */
  restitution: number;
  /** Bounce off a wall, 0 to 1, for walls that don't say. */
  wallRestitution: number;
  /** The speed a shot at full power (1000) gives the ball, in units/s. */
  maxShotSpeed: number;
  bodies: Body[];
  walls: Wall[];
  pockets: Pocket[];
  regions: Region[];
}

/** A disc. Everything that moves, and round things that don't (a bumper, a peg). */
export interface Body {
  id: string;
  x: number;
  y: number;
  r: number;
  /** Defaults to 1. Only ratios matter. */
  mass?: number;
  /** Never moves, whatever hits it. */
  fixed?: boolean;
  restitution?: number;
  /** Velocity in units/s. A resting world never has these; they are for setting something rolling without a shot. */
  vx?: number;
  vy?: number;
  /** Set when the body dropped into a pocket: the pocket's id. Such a body takes no part until a game puts it back. */
  pocketed?: string;
  /** Set when the body left play: the id of the out region, or "bounds". */
  out?: string;
  /** Reserved for spin, which this version does not simulate. Must be absent or zero. */
  spin?: Spin;
}

/**
 * A chain of straight wall pieces through `points`; `closed` joins the last back to the first,
 * which makes a polygon. Walls have no thickness and stop a ball from either side, and every
 * point is a rounded corner as far as a ball is concerned.
 */
export interface Wall {
  id: string;
  points: Point[];
  closed?: boolean;
  restitution?: number;
}

/**
 * A hole. A ball drops when its centre is over the hole and it is moving no faster than
 * `maxSpeed` (units/s); faster, it skips across, which is a golf cup. Leave `maxSpeed` out and the
 * hole takes anything, which is a pool pocket.
 */
export interface Pocket {
  id: string;
  x: number;
  y: number;
  r: number;
  maxSpeed?: number;
}

export type Shape = { points: Point[] } | { x: number; y: number; r: number };

/**
 * A patch of ground. A ball is on it when its centre is inside the shape. Where patches overlap,
 * the last one listed that sets `friction` decides the friction, every `slope` adds up, and any
 * `out` takes the ball out of play.
 */
export interface Region {
  id: string;
  shape: Shape;
  /** Units/s², in place of the world's. Sand, rough. */
  friction?: number;
  /** A steady pull on anything here, in units/s²: the downhill direction and how steep. */
  slope?: Point;
  /** Water. A ball that ends a step here is out. */
  out?: boolean;
}

/** Reserved. The shape will hold side and top/back spin; today both must be zero. */
export interface Spin {
  side: number;
  top: number;
}

export interface Shot {
  /** The body struck. */
  body: string;
  /** Whole hundredths of a degree, 0 to 35999. 0 is along +x, 9000 along +y. */
  angle: number;
  /** A whole number from 0 to 1000; 1000 is the world's `maxShotSpeed`. */
  power: number;
  spin?: Spin;
}

/**
 * What happened, in the order it happened. `tick` is the step it happened in, counting from 1.
 * `speed` is how hard the two met along the line of contact, in units/s: enough to pick a sound
 * and its volume. Two things that stay touching report once, not every step.
 */
export type SimEvent =
  | { type: "hit"; tick: number; a: string; b: string; speed: number }
  | { type: "wall"; tick: number; body: string; wall: string; speed: number }
  | { type: "pocket"; tick: number; body: string; pocket: string }
  | { type: "skip"; tick: number; body: string; pocket: string }
  | { type: "out"; tick: number; body: string; region: string }
  | { type: "capped"; tick: number };

export interface SimResult {
  /** The table at rest: whole-number positions, no velocities. The world passed in is untouched. */
  world: World;
  events: SimEvent[];
  /** How many steps the shot took. */
  ticks: number;
  /** True when `maxTicks` ran out with something still moving; everything was stopped where it was. */
  capped: boolean;
  /** The first other body the struck body touched, or null. */
  firstContact: string | null;
}

/** One step of a running shot, for drawing. */
export interface Frame {
  tick: number;
  /** True on the last frame; its positions are the resting ones. */
  done: boolean;
  /** What happened during this step. */
  events: SimEvent[];
  /** Every body, in the world's order. Speeds in units/s. */
  bodies: { id: string; x: number; y: number; vx: number; vy: number; live: boolean }[];
}
