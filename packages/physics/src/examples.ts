// Two tables as data: what a world looks like, what the tests play on, and a starting point for
// the games. Lengths are tenths of a millimetre, so the numbers can be checked against a tape
// measure: a pool ball is 57.15 mm across, which is a radius of 286.
import type { World } from "./types.js";

/**
 * A nine-foot pool table with the balls racked for a break. The cloth is the rectangle from
 * (0, 0) to (25400, 12700); the six cushions stop short of the corners and the middle of the long
 * sides, and a pocket sits in each gap. Each pocket's circle covers every path a ball's centre can
 * take through its gap, so a ball that gets past the cushion ends always drops, and a ball rolling
 * along the rail past a side pocket does not.
 */
export const POOL_TABLE: World = {
  bounds: { x: -1500, y: -1500, w: 28400, h: 15700 },
  tickRate: 120,
  maxTicks: 7200,
  friction: 2000,
  restSpeed: 50,
  restitution: 0.95,
  wallRestitution: 0.75,
  maxShotSpeed: 80000,
  bodies: [
    { id: "cue", x: 6350, y: 6350, r: 286 },
    // The rack: apex on the foot spot, rows 496 apart (286 × √3, rounded up so nothing overlaps).
    { id: "1", x: 19050, y: 6350, r: 286 },
    { id: "2", x: 19546, y: 6064, r: 286 },
    { id: "3", x: 19546, y: 6636, r: 286 },
    { id: "4", x: 20042, y: 5778, r: 286 },
    { id: "8", x: 20042, y: 6350, r: 286 },
    { id: "5", x: 20042, y: 6922, r: 286 },
    { id: "6", x: 20538, y: 5492, r: 286 },
    { id: "7", x: 20538, y: 6064, r: 286 },
    { id: "9", x: 20538, y: 6636, r: 286 },
    { id: "10", x: 20538, y: 7208, r: 286 },
    { id: "11", x: 21034, y: 5206, r: 286 },
    { id: "12", x: 21034, y: 5778, r: 286 },
    { id: "13", x: 21034, y: 6350, r: 286 },
    { id: "14", x: 21034, y: 6922, r: 286 },
    { id: "15", x: 21034, y: 7494, r: 286 },
  ],
  walls: [
    { id: "top-left", points: [[820, 0], [12050, 0]] },
    { id: "top-right", points: [[13350, 0], [24580, 0]] },
    { id: "right", points: [[25400, 820], [25400, 11880]] },
    { id: "bottom-right", points: [[24580, 12700], [13350, 12700]] },
    { id: "bottom-left", points: [[12050, 12700], [820, 12700]] },
    { id: "left", points: [[0, 11880], [0, 820]] },
  ],
  pockets: [
    { id: "top-left", x: 0, y: 0, r: 660 },
    { id: "top", x: 12700, y: -300, r: 480 },
    { id: "top-right", x: 25400, y: 0, r: 660 },
    { id: "bottom-right", x: 25400, y: 12700, r: 660 },
    { id: "bottom", x: 12700, y: 13000, r: 480 },
    { id: "bottom-left", x: 0, y: 12700, r: 660 },
  ],
  regions: [],
};

/**
 * A mini golf hole, 1.2 m by 4 m, walled all round. The tee is near the bottom (large y) and the
 * cup near the top. Between them the green climbs a hill that pulls the ball back towards the
 * tee, so a timid putt rolls back down. A block stands to the left of the tee, there is a pond on
 * the left beyond the hill and a patch of sand on the right. The cup takes a ball rolling at up
 * to 1.5 m/s; anything faster skips over it.
 */
export const GOLF_HOLE: World = {
  bounds: { x: -500, y: -500, w: 13000, h: 41000 },
  tickRate: 120,
  maxTicks: 3600,
  friction: 5000,
  restSpeed: 100,
  restitution: 0.9,
  wallRestitution: 0.6,
  maxShotSpeed: 40000,
  bodies: [{ id: "ball", x: 6000, y: 36000, r: 213 }],
  walls: [
    { id: "edge", closed: true, points: [[0, 0], [12000, 0], [12000, 40000], [0, 40000]] },
    { id: "block", closed: true, restitution: 0.5, points: [[2500, 28000], [4500, 28000], [4500, 30000], [2500, 30000]] },
  ],
  pockets: [{ id: "cup", x: 6000, y: 5000, r: 540, maxSpeed: 15000 }],
  regions: [
    { id: "hill", shape: { points: [[0, 16000], [12000, 16000], [12000, 24000], [0, 24000]] }, slope: [0, 7000] },
    { id: "sand", shape: { x: 9000, y: 10000, r: 1800 }, friction: 30000 },
    { id: "pond", shape: { points: [[0, 11000], [3500, 11000], [3500, 14000], [0, 14000]] }, out: true },
  ],
};
