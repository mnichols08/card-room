import { describe, expect, it } from "vitest";
import { frames, GOLF_HOLE, POOL_TABLE, simulate, type Shot, type World } from "../src/index.js";
import { energy, seeded, wallDistance } from "./helpers.js";

// Many seeded shots, each from wherever the last one left the table, checking the things that must
// hold whatever the shot: it ends, on whole numbers, with nothing through a wall, nothing inside
// anything else, and no energy from nowhere.

const live = (w: World) => w.bodies.filter((b) => b.pocketed === undefined && b.out === undefined);

function checkResting(world: World, label: string): void {
  for (const b of world.bodies) {
    expect(Number.isInteger(b.x) && Number.isInteger(b.y), label).toBe(true);
    expect(b.vx === undefined && b.vy === undefined, label).toBe(true);
  }
  const balls = live(world);
  // Rounding to whole numbers can leave two touching things overlapping by a hair, never more.
  for (const b of balls) expect(wallDistance(world, b.x, b.y), `${label}: ${b.id} in a wall`).toBeGreaterThan(b.r - 1);
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i]!;
      const b = balls[j]!;
      expect(Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2), `${label}: ${a.id} in ${b.id}`).toBeGreaterThan(a.r + b.r - 2);
    }
  }
  for (const b of balls) for (const p of world.pockets) expect((b.x - p.x) ** 2 + (b.y - p.y) ** 2, `${label}: ${b.id} left over a hole`).toBeGreaterThanOrEqual(p.r * p.r);
}

describe("many shots on the pool table", () => {
  it("always end in time with every ball on the cloth or in a pocket, and never gain energy", () => {
    const rnd = seeded(8);
    let world = POOL_TABLE;
    let pocketed = 0;
    let longest = 0;
    for (let n = 0; n < 250; n++) {
      // Every tenth shot is at full power; every twentieth starts from a fresh rack.
      if (n % 20 === 0) world = POOL_TABLE;
      const shot: Shot = { body: "cue", angle: Math.floor(rnd() * 36000), power: n % 10 === 0 ? 1000 : 1 + Math.floor(rnd() * 1000) };
      const label = `shot ${n} ${JSON.stringify(shot)}`;
      const res = simulate(world, shot);
      expect(res.capped, label).toBe(false);
      expect(res.ticks, label).toBeLessThan(world.maxTicks);
      longest = Math.max(longest, res.ticks);
      expect(res.world.bodies.map((b) => b.id), label).toEqual(world.bodies.map((b) => b.id));
      expect(res.events.filter((e) => e.type === "out"), label).toEqual([]);
      checkResting(res.world, label);
      for (const b of live(res.world)) expect(b.x > 0 && b.x < 25400 && b.y > 0 && b.y < 12700, `${label}: ${b.id} off the cloth`).toBe(true);
      for (const b of res.world.bodies) if (b.pocketed !== undefined) expect(world.pockets.some((p) => p.id === b.pocketed && p.x === b.x && p.y === b.y), label).toBe(true);
      pocketed += res.events.filter((e) => e.type === "pocket").length;

      // Every fifth shot is also stepped: energy only ever goes down (there are no slopes here),
      // no ball is ever through a cushion, and the frames end where the one call did.
      if (n % 5 === 0) {
        let before = Infinity;
        let last;
        for (const f of frames(world, shot)) {
          const now = energy(world, f);
          expect(now, `${label} tick ${f.tick}`).toBeLessThanOrEqual(before * (1 + 1e-12));
          before = now;
          for (const b of f.bodies) if (b.live) expect(b.x > -700 && b.x < 26100 && b.y > -800 && b.y < 13500, `${label} tick ${f.tick}: ${b.id} escaped`).toBe(true);
          last = f;
        }
        expect(last!.bodies.map((b) => [b.x, b.y, b.live]), label).toEqual(res.world.bodies.map((b) => [b.x, b.y, b.pocketed === undefined]));
      }

      // The cue ball goes back on its spot if it went down; everything else stays where it is.
      world = { ...res.world, bodies: res.world.bodies.map((b, i) => (b.id === "cue" && b.pocketed !== undefined ? POOL_TABLE.bodies[i]! : b)) };
    }
    expect(pocketed).toBeGreaterThan(20);
    expect(longest).toBeGreaterThan(600);
  });
});

describe("many putts on the golf hole", () => {
  it("always end in time, inside the walls and outside the block, in the cup or in the pond", () => {
    const rnd = seeded(3);
    let world = GOLF_HOLE;
    const seen = { cup: 0, pond: 0, skip: 0 };
    for (let n = 0; n < 400; n++) {
      const shot: Shot = { body: "ball", angle: Math.floor(rnd() * 36000), power: n % 10 === 0 ? 1000 : 1 + Math.floor(rnd() * 1000) };
      const label = `putt ${n} ${JSON.stringify(shot)} from ${world.bodies[0]!.x},${world.bodies[0]!.y}`;
      const res = simulate(world, shot);
      expect(res.capped, label).toBe(false);
      checkResting(res.world, label);
      const ball = res.world.bodies[0]!;
      expect(ball.out === undefined || ball.out === "pond", label).toBe(true);
      expect(ball.x > 0 && ball.x < 12000 && ball.y > 0 && ball.y < 40000, label).toBe(true);
      expect(ball.x > 2500 && ball.x < 4500 && ball.y > 28000 && ball.y < 30000, `${label}: inside the block`).toBe(false);
      if (ball.pocketed) seen.cup++;
      if (ball.out) seen.pond++;
      seen.skip += res.events.filter((e) => e.type === "skip").length;

      if (n % 8 === 0) {
        for (const f of frames(world, shot)) {
          const b = f.bodies[0]!;
          expect(b.x > 200 && b.x < 11800 && b.y > 200 && b.y < 39800, `${label} tick ${f.tick}: through the edge`).toBe(true);
          expect(b.x > 2500 && b.x < 4500 && b.y > 28000 && b.y < 30000, `${label} tick ${f.tick}: inside the block`).toBe(false);
        }
      }
      // Play on from where it lies; back to the tee after the cup or the pond.
      world = ball.pocketed || ball.out ? GOLF_HOLE : res.world;
    }
    expect(seen.pond).toBeGreaterThan(0);
    expect(seen.cup + seen.skip).toBeGreaterThan(0);
  });

  it("the cup takes the putts that reach it gently, from a spread of straight shots", () => {
    const made: number[] = [];
    for (let power = 400; power <= 1000; power += 10) if (simulate(GOLF_HOLE, { body: "ball", angle: 27000, power }).world.bodies[0]!.pocketed) made.push(power);
    // Too soft rolls back down the hill, too hard skips over: a band in the middle goes in.
    expect(made.length).toBeGreaterThan(5);
    expect(made[0]).toBeGreaterThan(450);
    expect(made.at(-1)).toBeLessThan(900);
    expect(made).toEqual(made.map((_, i) => made[0]! + 10 * i));
  });
});
