// Mini golf courses, as data. A course is a list of holes; a hole is a physics world without a
// ball (walls, a cup, sand, water, slopes), where the ball starts, its par, and how it is drawn.
// Everything is plain JSON-serialisable data once built, so a hole can be stored, sent and
// simulated as is; `hole()` below is only a shorter way to write one.
//
// Lengths are tenths of a millimetre, as in the physics examples, but these are toy greens: about
// a metre wide and a metre and a half long, so a ball is big enough to see on a phone.
//
// Writing a hole:
//  - Keep to whole numbers, and build shapes with + - * / and Math.round only. A hole must come out
//    identical on the server and in every browser, and sin/cos may differ in the last digit.
//  - Regions are sampled once a step. A ball at full power moves about 180 units a step, so make
//    water at least 1000 thick where a ball can cross it, or a hard shot may jump it.
//  - A slope steeper than the green's friction (6000) won't hold a ball: it rolls back off.
//  - test/minigolfcourse.test.ts checks every hole of every course listed in COURSES: it validates,
//    the tee and the cup are on the green and clear of walls, sand and water, and a search over
//    shots holes out within par + 2. A hole that can't be finished doesn't ship.
import type { Point, Region, Shape, Wall, World } from "@cardroom/physics";
import type { SportDecor, SportLook } from "./sport.js";

export interface GolfHole {
  id: string;
  name: string;
  par: number;
  /** One line of advice, shown at the tee. */
  tip: string;
  /** Where every ball starts. */
  tee: Point;
  /** The hole with no ball on it; the cup is the pocket called "cup". */
  world: World;
  look: SportLook;
}

export interface GolfCourse {
  id: string;
  name: string;
  holes: GolfHole[];
}

export const BALL_RADIUS = 240;
export const CUP_RADIUS = 440;
/** A ball crossing the cup faster than this (units/s) skips over it. */
export const CUP_SPEED = 4500;
export const GREEN_FRICTION = 6000;
export const SAND_FRICTION = 26000;

/** What every hole shares: how the green plays. A full-power putt on open ground rolls about four metres. */
const GREEN = { tickRate: 120, maxTicks: 2400, friction: GREEN_FRICTION, restSpeed: 100, restitution: 0.9, wallRestitution: 0.7, maxShotSpeed: 22000 };

const rect = (x1: number, y1: number, x2: number, y2: number): Point[] => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];

// The eight compass directions as unit vectors, and the eight directions halfway between them,
// written out as short decimals so that a mound is the same numbers everywhere.
const D = 0.7071;
const COMPASS: Point[] = [[1, 0], [D, D], [0, 1], [-D, D], [-1, 0], [-D, -D], [0, -1], [D, -D]];
const A = 0.9239;
const B = 0.3827;
const BETWEEN: Point[] = [[A, B], [B, A], [-B, A], [-A, B], [-A, -B], [-B, -A], [B, -A], [A, -B]];

interface Slope {
  shape: Shape;
  /** The pull on a ball here, in units/s²: which way is downhill, and how steep. */
  pull: Point;
}

/**
 * A round hill (or with a negative pull, a bowl): a ring of eight wedges from `inner` to `outer`
 * round a centre, each sloping straight away from it. Inside `inner` it is flat.
 */
function mound(cx: number, cy: number, inner: number, outer: number, pull: number): Slope[] {
  return COMPASS.map(([ux, uy], k) => {
    const [ax, ay] = BETWEEN[(k + 7) % 8]!;
    const [bx, by] = BETWEEN[k]!;
    const at = (r: number, x: number, y: number): Point => [Math.round(cx + r * x), Math.round(cy + r * y)];
    return { shape: { points: [at(inner, ax, ay), at(outer, ax, ay), at(outer, bx, by), at(inner, bx, by)] }, pull: [Math.round(pull * ux), Math.round(pull * uy)] };
  });
}

interface HoleSpec {
  id: string;
  name: string;
  par: number;
  tip: string;
  tee: Point;
  cup: Point;
  /** The edge of the green, as one closed wall. */
  outline: Point[];
  /** Solid things standing on the green. */
  blocks?: Point[][];
  slopes?: Slope[];
  sand?: Shape[];
  water?: Shape[];
  decor?: SportDecor[];
}

/** A hole from its parts: the world the physics plays and the look the table draws. */
export function hole(spec: HoleSpec): GolfHole {
  const xs = spec.outline.map((p) => p[0]);
  const ys = spec.outline.map((p) => p[1]);
  const margin = 900;
  const frame = { x: Math.min(...xs) - margin, y: Math.min(...ys) - margin, w: Math.max(...xs) - Math.min(...xs) + 2 * margin, h: Math.max(...ys) - Math.min(...ys) + 2 * margin };
  const walls: Wall[] = [{ id: "edge", closed: true, points: spec.outline }, ...(spec.blocks ?? []).map((points, i) => ({ id: `block-${i + 1}`, closed: true, points }))];
  const regions: Region[] = [
    ...(spec.slopes ?? []).map((s, i) => ({ id: `slope-${i + 1}`, shape: s.shape, slope: s.pull })),
    ...(spec.sand ?? []).map((shape, i) => ({ id: `sand-${i + 1}`, shape, friction: SAND_FRICTION })),
    ...(spec.water ?? []).map((shape, i) => ({ id: `water-${i + 1}`, shape, out: true })),
  ];
  return {
    id: spec.id,
    name: spec.name,
    par: spec.par,
    tip: spec.tip,
    tee: spec.tee,
    world: {
      // The edge wall keeps every ball in; the bounds are only the net under it.
      bounds: { x: frame.x - 500, y: frame.y - 500, w: frame.w + 1000, h: frame.h + 1000 },
      ...GREEN,
      bodies: [],
      walls,
      pockets: [{ id: "cup", x: spec.cup[0], y: spec.cup[1], r: CUP_RADIUS, maxSpeed: CUP_SPEED }],
      regions,
    },
    look: {
      frame,
      ground: [{ points: spec.outline, surface: "green" }],
      regions: regions.map((r) => ({ id: r.id, surface: r.out ? "water" : r.friction !== undefined ? "sand" : "slope" })),
      blocks: walls.slice(1).map((w) => w.id),
      pockets: "cup",
      decor: [{ kind: "tee", x: spec.tee[0], y: spec.tee[1] }, ...(spec.decor ?? [])],
    },
  };
}

/** The hole with one ball on it, ready to be struck. */
export function holeWorld(h: GolfHole, ball: { id: string; x: number; y: number; pocketed?: string }): World {
  return { ...h.world, bodies: [{ id: ball.id, x: ball.x, y: ball.y, r: BALL_RADIUS, ...(ball.pocketed !== undefined ? { pocketed: ball.pocketed } : {}) }] };
}

// ---- The Back Garden ----------------------------------------------------------------------------
// Nine holes that teach one thing each: a straight putt, a dogleg, a bank shot, a slope, sand, a
// narrow gap, water, a hill round the cup, and then all of it at once. The tee is at the bottom of
// the screen (large y) and the cup towards the top.

const welcomeMat = hole({
  id: "welcome-mat",
  name: "Welcome Mat",
  par: 2,
  tip: "Straight up the middle. Too hard and the ball skips over the cup.",
  tee: [5000, 13500],
  cup: [5000, 3200],
  outline: rect(2800, 1500, 7200, 15000),
  decor: [{ kind: "flowers", x: 2150, y: 2400 }, { kind: "bush", x: 7850, y: 9000, r: 420 }, { kind: "flowers", x: 7850, y: 13800 }],
});

const elbow = hole({
  id: "elbow",
  name: "The Elbow",
  par: 3,
  tip: "The cup is round the corner. The slanted board at the top turns a straight putt for you.",
  tee: [2750, 13500],
  cup: [7600, 3250],
  // An L, with the outside corner cut off at 45° so a ball sent straight up is turned to the right.
  outline: [[3000, 1500], [9000, 1500], [9000, 5000], [4500, 5000], [4500, 15000], [1000, 15000], [1000, 3500]],
  decor: [{ kind: "tree", x: 7000, y: 9500, r: 1300 }, { kind: "flowers", x: 5600, y: 13200 }, { kind: "rock", x: 8300, y: 6300, r: 380 }, { kind: "bush", x: 1300, y: 1800, r: 420 }],
});

const offTheFence = hole({
  id: "off-the-fence",
  name: "Off the Fence",
  par: 3,
  tip: "The planter is in the way. Bounce the ball off the right-hand fence to get round it.",
  tee: [3200, 13500],
  cup: [3200, 4000],
  outline: rect(1500, 2000, 8500, 15000),
  blocks: [rect(1500, 7800, 5800, 8400)],
  decor: [{ kind: "bush", x: 9100, y: 3000, r: 380 }, { kind: "rock", x: 900, y: 12000, r: 330 }, { kind: "flowers", x: 9150, y: 12500 }],
});

const theRamp = hole({
  id: "ramp",
  name: "The Ramp",
  par: 3,
  tip: "Uphill in the middle. A timid putt rolls back down to you.",
  tee: [5000, 13500],
  cup: [5000, 2800],
  outline: rect(2500, 1000, 7500, 15000),
  slopes: [{ shape: { points: rect(2500, 5500, 7500, 9500) }, pull: [0, 7500] }],
  decor: [{ kind: "bush", x: 1900, y: 7500, r: 450 }, { kind: "bush", x: 8100, y: 7500, r: 450 }, { kind: "flowers", x: 8050, y: 2000 }],
});

const sandbox = hole({
  id: "sandbox",
  name: "Sandbox",
  par: 3,
  tip: "Sand stops a ball in a hurry. Go round it, or hit it hard enough to plough through.",
  tee: [5000, 13500],
  cup: [5000, 3200],
  outline: rect(1500, 1500, 8500, 15000),
  sand: [{ x: 5000, y: 8000, r: 2000 }, { x: 7300, y: 4300, r: 900 }, { x: 2600, y: 5200, r: 800 }],
  decor: [{ kind: "rock", x: 900, y: 4000, r: 360 }, { kind: "flowers", x: 9150, y: 11000 }, { kind: "bush", x: 9100, y: 2000, r: 400 }],
});

const gardenGate = hole({
  id: "garden-gate",
  name: "The Garden Gate",
  par: 3,
  tip: "Only the gap in the middle lets a ball through. Aim small.",
  tee: [3800, 13500],
  cup: [6200, 3000],
  outline: rect(2000, 1500, 8000, 15000),
  blocks: [rect(2000, 7900, 4350, 8300), rect(5650, 7900, 8000, 8300)],
  decor: [{ kind: "bush", x: 1400, y: 8100, r: 430 }, { kind: "bush", x: 8600, y: 8100, r: 430 }, { kind: "flowers", x: 1450, y: 13000 }],
});

const koiPond = hole({
  id: "koi-pond",
  name: "Koi Pond",
  par: 3,
  tip: "In the water costs a stroke, and you play again from where you were. Go round.",
  tee: [5000, 13500],
  cup: [5000, 3200],
  outline: rect(1000, 1500, 9000, 15000),
  water: [{ x: 5000, y: 8200, r: 1900 }],
  decor: [{ kind: "rock", x: 3300, y: 6700, r: 300 }, { kind: "flowers", x: 6800, y: 9700 }, { kind: "bush", x: 9500, y: 14000, r: 400 }],
});

const molehill = hole({
  id: "molehill",
  name: "Molehill",
  par: 3,
  tip: "The cup sits on top of a little hill. Firm enough to climb it, soft enough to stay.",
  tee: [5000, 13500],
  cup: [5000, 5200],
  outline: rect(1500, 2000, 8500, 15000),
  slopes: mound(5000, 5200, 1000, 2500, 7000),
  decor: [{ kind: "flowers", x: 950, y: 5200 }, { kind: "flowers", x: 9050, y: 5200 }, { kind: "rock", x: 9000, y: 13500, r: 340 }],
});

const wholeYard = hole({
  id: "whole-yard",
  name: "The Whole Yard",
  par: 4,
  tip: "Up the ramp, through the gate, round the top past the sand, and down the far side beside the pond.",
  tee: [2750, 14000],
  cup: [7250, 10600],
  // A horseshoe: up the left leg, across the top, down the right. The top-left corner is cut off
  // at 45° to turn the ball, as on The Elbow.
  outline: [[3000, 1500], [9000, 1500], [9000, 12000], [5500, 12000], [5500, 5200], [4500, 5200], [4500, 15000], [1000, 15000], [1000, 3500]],
  blocks: [rect(1000, 6900, 2100, 7300), rect(3400, 6900, 4500, 7300)],
  slopes: [{ shape: { points: rect(1000, 9000, 4500, 11500) }, pull: [0, 6500] }],
  sand: [{ x: 8100, y: 2400, r: 1000 }],
  water: [{ points: rect(5500, 6000, 7100, 8600) }],
  decor: [{ kind: "tree", x: 7300, y: 13700, r: 1000 }, { kind: "flowers", x: 5700, y: 14300 }, { kind: "rock", x: 1400, y: 1900, r: 380 }],
});

export const backGarden: GolfCourse = {
  id: "back-garden",
  name: "The Back Garden",
  holes: [welcomeMat, elbow, offTheFence, theRamp, sandbox, gardenGate, koiPond, molehill, wholeYard],
};

/** Every course there is. A new course goes here, and the tests play each of its holes. */
export const COURSES: GolfCourse[] = [backGarden];
export const courseOf = (id: unknown): GolfCourse => COURSES.find((c) => c.id === id) ?? backGarden;
