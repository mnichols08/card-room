import { describe, expect, it } from "vitest";
import { GOLF_HOLE, PhysicsError, POOL_TABLE, simulate, validateShot, validateWorld, type World } from "../src/index.js";

const edit = (change: (w: any) => void): unknown => {
  const w = JSON.parse(JSON.stringify(GOLF_HOLE));
  change(w);
  return w;
};

describe("validateWorld", () => {
  it("passes the two example tables", () => {
    expect(validateWorld(POOL_TABLE)).toEqual([]);
    expect(validateWorld(GOLF_HOLE)).toEqual([]);
  });

  it("passes a world that has been through JSON", () => {
    expect(validateWorld(JSON.parse(JSON.stringify(POOL_TABLE)))).toEqual([]);
  });

  it("says what is wrong, one line per problem", () => {
    expect(validateWorld(null)).toHaveLength(1);
    expect(validateWorld(edit((w) => (w.bodies[0].x = 1.5)))).toEqual(["Body 0 needs whole-number x and y"]);
    expect(validateWorld(edit((w) => (w.bodies[0].r = 2)))[0]).toMatch(/radius/);
    expect(validateWorld(edit((w) => (w.bodies[0].mass = 0)))[0]).toMatch(/mass/);
    expect(validateWorld(edit((w) => w.bodies.push({ ...w.bodies[0] })))[0]).toMatch(/Two bodies are called "ball"/);
    expect(validateWorld(edit((w) => (w.bodies[0].x = 99999)))[0]).toMatch(/outside the bounds/);
    expect(validateWorld(edit((w) => (w.tickRate = 59.94)))[0]).toMatch(/tickRate/);
    expect(validateWorld(edit((w) => (w.wallRestitution = 1.2)))[0]).toMatch(/wallRestitution/);
    expect(validateWorld(edit((w) => (w.friction = NaN)))[0]).toMatch(/friction/);
    expect(validateWorld(edit((w) => (w.walls[0].points = [[0, 0]])))[0]).toMatch(/two or more/);
    expect(validateWorld(edit((w) => (w.walls[0].points = [[0, 0], [0, 0], [5, 5]])))[0]).toMatch(/twice in a row/);
    expect(validateWorld(edit((w) => (w.pockets[0].r = 0)))[0]).toMatch(/radius/);
    expect(validateWorld(edit((w) => (w.regions[0].shape = { points: [[0, 0], [1, 1]] })))[0]).toMatch(/polygon/);
    expect(validateWorld(edit((w) => (w.regions[0].id = "bounds")))[0]).toMatch(/bounds/);
    expect(validateWorld(edit((w) => delete w.regions))[0]).toMatch(/regions/);
  });

  it("refuses spin until spin is simulated, so a recorded shot never changes meaning", () => {
    expect(validateWorld(edit((w) => (w.bodies[0].spin = { side: 1, top: 0 })))[0]).toMatch(/spin/);
    expect(validateWorld(edit((w) => (w.bodies[0].spin = { side: 0, top: 0 })))).toEqual([]);
    expect(validateShot(GOLF_HOLE, { body: "ball", angle: 0, power: 10, spin: { side: 0, top: 3 } })[0]).toMatch(/Spin/);
  });
});

describe("validateShot", () => {
  it("wants a ball in play, a whole angle on the circle and a whole power up to 1000", () => {
    expect(validateShot(POOL_TABLE, { body: "cue", angle: 35999, power: 1000 })).toEqual([]);
    expect(validateShot(POOL_TABLE, { body: "nobody", angle: 0, power: 1 })).toHaveLength(1);
    expect(validateShot(POOL_TABLE, { body: "cue", angle: 36000, power: 1 })).toHaveLength(1);
    expect(validateShot(POOL_TABLE, { body: "cue", angle: 0.5, power: 1 })).toHaveLength(1);
    expect(validateShot(POOL_TABLE, { body: "cue", angle: 0, power: 1001 })).toHaveLength(1);
    expect(validateShot(POOL_TABLE, { body: "cue", angle: 0, power: -1 })).toHaveLength(1);
    expect(validateShot(POOL_TABLE, "hard")).toHaveLength(1);
    const sunk: World = { ...POOL_TABLE, bodies: POOL_TABLE.bodies.map((b) => (b.id === "cue" ? { ...b, pocketed: "top" } : b)) };
    expect(validateShot(sunk, { body: "cue", angle: 0, power: 1 })[0]).toMatch(/not in play/);
  });

  it("is enforced by simulate", () => {
    expect(() => simulate(POOL_TABLE, { body: "cue", angle: 0, power: 5000 })).toThrow(PhysicsError);
    expect(() => simulate({ ...POOL_TABLE, tickRate: 0 })).toThrow(PhysicsError);
  });
});
