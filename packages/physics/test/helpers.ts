import type { Frame, World } from "../src/index.js";

/** A small seeded generator, so "random" shots are the same shots on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An empty, frictionless, lossless sheet with nothing on it: the lab bench for the sums. */
export function bench(over: Partial<World> = {}): World {
  return {
    bounds: { x: -100000, y: -100000, w: 200000, h: 200000 },
    tickRate: 120,
    maxTicks: 240,
    friction: 0,
    restSpeed: 0,
    restitution: 1,
    wallRestitution: 1,
    maxShotSpeed: 60000,
    bodies: [],
    walls: [],
    pockets: [],
    regions: [],
    ...over,
  };
}

export function energy(world: World, f: Frame): number {
  return f.bodies.reduce((sum, b, i) => (b.live && !world.bodies[i]!.fixed ? sum + 0.5 * (world.bodies[i]!.mass ?? 1) * (b.vx * b.vx + b.vy * b.vy) : sum), 0);
}

export function momentum(world: World, f: Frame): [number, number] {
  let px = 0;
  let py = 0;
  f.bodies.forEach((b, i) => {
    const m = world.bodies[i]!.mass ?? 1;
    px += m * b.vx;
    py += m * b.vy;
  });
  return [px, py];
}

/** How far a point is from the nearest piece of any wall. */
export function wallDistance(world: World, x: number, y: number): number {
  let best = Infinity;
  for (const wall of world.walls) {
    const n = wall.closed ? wall.points.length : wall.points.length - 1;
    for (let k = 0; k < n; k++) {
      const [ax, ay] = wall.points[k]!;
      const [bx, by] = wall.points[(k + 1) % wall.points.length]!;
      const ex = bx - ax;
      const ey = by - ay;
      const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey)));
      best = Math.min(best, Math.sqrt((x - ax - u * ex) ** 2 + (y - ay - u * ey) ** 2));
    }
  }
  return best;
}
