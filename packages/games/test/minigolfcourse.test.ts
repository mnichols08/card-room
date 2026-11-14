// Every hole of every course: it is a world the physics accepts, the tee and the cup are on the
// green and clear of trouble, water is too wide to jump, and it can be finished. A hole added to a
// course is checked here without touching this file.
import { simulate, validateWorld, type Point, type Shape } from "@cardroom/physics";
import { describe, expect, it } from "vitest";
import { BALL_RADIUS, COURSES, CUP_RADIUS, bestPutt, distanceToCup, holeWorld, type GolfHole } from "../src/index.js";

function inside(s: Shape, x: number, y: number): boolean {
  if (!("points" in s)) return (x - s.x) ** 2 + (y - s.y) ** 2 < s.r ** 2;
  let hit = false;
  for (let i = 0, j = s.points.length - 1; i < s.points.length; j = i++) {
    const [xi, yi] = s.points[i]!;
    const [xj, yj] = s.points[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function toWalls(h: GolfHole, [x, y]: Point): number {
  let best = Infinity;
  for (const w of h.world.walls) {
    const n = w.closed ? w.points.length : w.points.length - 1;
    for (let i = 0; i < n; i++) {
      const a = w.points[i]!;
      const b = w.points[(i + 1) % w.points.length]!;
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / (ex * ex + ey * ey)));
      best = Math.min(best, Math.hypot(x - a[0] - t * ex, y - a[1] - t * ey));
    }
  }
  return best;
}
/** The narrowest a shape gets: a circle's width, or for a polygon the least of its widths across each side. */
function thickness(s: Shape): number {
  if (!("points" in s)) return 2 * s.r;
  let least = Infinity;
  s.points.forEach((a, i) => {
    const b = s.points[(i + 1) % s.points.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    least = Math.min(least, Math.max(...s.points.map((p) => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len)));
  });
  return least;
}

/** A player who always hits the putt the search finds: how many strokes to hole out (or `most` + 1). */
function strokesToHoleOut(h: GolfHole, most: number): number {
  let [x, y] = h.tee;
  for (let stroke = 1; stroke <= most; stroke++) {
    const putt = bestPutt(h, x, y);
    const at = simulate(holeWorld(h, { id: "ball", x, y }), { body: "ball", angle: putt.angle, power: putt.power }).world.bodies[0]!;
    if (at.pocketed !== undefined) return stroke;
    if (at.out === undefined) [x, y] = [at.x, at.y];
  }
  return most + 1;
}

describe("the course list", () => {
  it("has courses with their own ids, and a first course of nine holes", () => {
    expect(new Set(COURSES.map((c) => c.id)).size).toBe(COURSES.length);
    expect(COURSES[0]!.holes).toHaveLength(9);
    for (const c of COURSES) expect(new Set(c.holes.map((h) => h.id)).size).toBe(c.holes.length);
  });
  it("is plain data: a hole survives a trip through JSON unchanged", () => {
    for (const c of COURSES) expect(JSON.parse(JSON.stringify(c))).toEqual(c);
  });
});

for (const course of COURSES) {
  describe(course.name, () => {
    course.holes.forEach((h, i) => {
      describe(`hole ${i + 1}: ${h.name}`, () => {
        const cup = h.world.pockets[0]!;
        const green = { points: h.look.ground[0]!.points };

        it("is a world the physics accepts, with one cup and nothing left on it", () => {
          expect(validateWorld(holeWorld(h, { id: "ball", x: h.tee[0], y: h.tee[1] }))).toEqual([]);
          expect(h.world.bodies).toEqual([]);
          expect(h.world.pockets.map((p) => p.id)).toEqual(["cup"]);
          expect(cup.r).toBe(CUP_RADIUS);
          expect(cup.maxSpeed).toBeGreaterThan(0);
          expect(h.par).toBeGreaterThanOrEqual(2);
          expect(h.par).toBeLessThanOrEqual(5);
          expect(h.name && h.tip).toBeTruthy();
          // Everything the look names is in the world, and the frame is inside the bounds.
          const b = h.world.bounds;
          const f = h.look.frame;
          expect(f.x >= b.x && f.y >= b.y && f.x + f.w <= b.x + b.w && f.y + f.h <= b.y + b.h).toBe(true);
          for (const r of h.look.regions) expect(h.world.regions.some((g) => g.id === r.id)).toBe(true);
          for (const d of h.look.decor) expect(d.x >= f.x && d.x <= f.x + f.w && d.y >= f.y && d.y <= f.y + f.h, `${d.kind} is off the picture`).toBe(true);
        });

        it("has its tee and its cup on the green, clear of walls, sand and water", () => {
          for (const [what, at] of [["tee", h.tee], ["cup", [cup.x, cup.y] as Point]] as const) {
            expect(inside(green, at[0], at[1]), `the ${what} is off the green`).toBe(true);
            expect(toWalls(h, at), `the ${what} is against a wall`).toBeGreaterThan(2 * BALL_RADIUS);
            for (const r of h.world.regions) if (r.out || r.friction !== undefined) expect(inside(r.shape, at[0], at[1]), `the ${what} is in ${r.id}`).toBe(false);
          }
          // A ball can sit on the tee: no slope carries it off before it is struck.
          const still = simulate(holeWorld(h, { id: "ball", x: h.tee[0], y: h.tee[1] }));
          expect([still.world.bodies[0]!.x, still.world.bodies[0]!.y]).toEqual(h.tee);
          expect(distanceToCup(h, h.tee[0], h.tee[1])).toBeLessThan(1e8);
        });

        it("has water too wide for a ball to jump", () => {
          // Regions are sampled once a step. Five steps of travel at full power is the margin.
          const perStep = h.world.maxShotSpeed / h.world.tickRate;
          for (const r of h.world.regions) if (r.out) expect(thickness(r.shape), `${r.id} is thin enough to jump`).toBeGreaterThan(5 * perStep);
        });

        it(`can be holed out within par + 2 (${h.par + 2} strokes)`, () => {
          expect(strokesToHoleOut(h, h.par + 2)).toBeLessThanOrEqual(h.par + 2);
        });
      });
    });
  });
}

describe("the water on Koi Pond", () => {
  it("takes every ball sent straight at it, however hard: none comes out the far side", () => {
    const h = COURSES[0]!.holes.find((x) => x.id === "koi-pond")!;
    const pond = h.world.regions.find((r) => r.out)!.shape as { x: number; y: number; r: number };
    let wet = 0;
    for (let power = 300; power <= 1000; power += 10) {
      for (const angle of [26400, 26700, 27000, 27300, 27600]) {
        const played = simulate(holeWorld(h, { id: "ball", x: h.tee[0], y: h.tee[1] }), { body: "ball", angle, power });
        const at = played.world.bodies[0]!;
        if (at.out !== undefined) wet++;
        // Dry means it stopped short of the pond: never beyond it.
        else expect(at.y, `${angle}/${power} crossed the water`).toBeGreaterThan(pond.y + pond.r - 1);
      }
    }
    expect(wet).toBeGreaterThan(100);
  });
});
