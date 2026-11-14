import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { frames, GOLF_HOLE, POOL_TABLE, simulate, type Shot, type SimResult, type World } from "../src/index.js";
import { seeded } from "./helpers.js";

// Recorded shots and exactly where everything came to rest. If one of these changes, the physics
// changed: every replayed game would come out differently, so bump PHYSICS_VERSION and record
// them again on purpose (UPDATE_FIXTURES=1 npm test -w @cardroom/physics), never to quiet a test.
const FIXTURES = new URL("./fixtures.json", import.meta.url);
const TABLES: Record<string, World> = { pool: POOL_TABLE, golf: GOLF_HOLE };

interface Recorded {
  table: string;
  /** Shots played one after another, each from where the last one left the table. */
  shots: Shot[];
  ticks: number[];
  events: number[];
  bodies: [id: string, x: number, y: number, where: string][];
}

// A pocketed or drowned ball is put back where it started, so a sequence can keep going.
const respot = (table: World, world: World): World => ({
  ...world,
  bodies: world.bodies.map((b, i) => (b.pocketed !== undefined || b.out !== undefined ? table.bodies[i]! : b)),
});

function play(table: string, shots: Shot[]): Recorded {
  let world = TABLES[table]!;
  const ticks: number[] = [];
  const events: number[] = [];
  let res: SimResult | undefined;
  for (const shot of shots) {
    if (res) world = respot(TABLES[table]!, res.world);
    res = simulate(world, shot);
    ticks.push(res.ticks);
    events.push(res.events.length);
  }
  return { table, shots, ticks, events, bodies: res!.world.bodies.map((b) => [b.id, b.x, b.y, b.pocketed ?? b.out ?? ""]) };
}

function scripts(): { table: string; shots: Shot[] }[] {
  const rnd = seeded(20261114);
  const shot = (body: string): Shot => ({ body, angle: Math.floor(rnd() * 36000), power: 200 + Math.floor(rnd() * 801) });
  const out: { table: string; shots: Shot[] }[] = [
    { table: "pool", shots: [{ body: "cue", angle: 0, power: 1000 }] },
    { table: "pool", shots: [{ body: "cue", angle: 35950, power: 870 }, { body: "cue", angle: 12345, power: 640 }, { body: "cue", angle: 30001, power: 999 }] },
    { table: "golf", shots: [{ body: "ball", angle: 27000, power: 530 }] },
    { table: "golf", shots: [{ body: "ball", angle: 25500, power: 1000 }, { body: "ball", angle: 31007, power: 450 }] },
  ];
  for (let k = 0; k < 6; k++) out.push({ table: "pool", shots: [shot("cue"), shot("cue"), shot("cue"), shot("cue")] });
  for (let k = 0; k < 6; k++) out.push({ table: "golf", shots: [shot("ball"), shot("ball"), shot("ball")] });
  return out;
}

describe("recorded shots", () => {
  if (process.env.UPDATE_FIXTURES) {
    writeFileSync(FIXTURES, "[\n" + scripts().map((s) => "  " + JSON.stringify(play(s.table, s.shots))).join(",\n") + "\n]\n");
  }
  const recorded = JSON.parse(readFileSync(FIXTURES, "utf8")) as Recorded[];

  it("covers every script", () => {
    expect(recorded.map((r) => ({ table: r.table, shots: r.shots }))).toEqual(scripts());
  });

  it.each(recorded.map((r, i) => [i, r] as const))("fixture %i comes to rest exactly where it did when it was recorded", (_i, r) => {
    expect(play(r.table, r.shots)).toEqual(r);
  });
});

describe("the same shot", () => {
  const shots: [World, Shot][] = [
    [POOL_TABLE, { body: "cue", angle: 0, power: 1000 }],
    [POOL_TABLE, { body: "cue", angle: 277, power: 912 }],
    [GOLF_HOLE, { body: "ball", angle: 24013, power: 1000 }],
  ];

  it("played twice gives the same result, down to every event's speed", () => {
    for (const [world, shot] of shots) expect(simulate(world, shot)).toEqual(simulate(world, shot));
  });

  it("stepped frame by frame ends exactly where the one call does", () => {
    for (const [world, shot] of shots) {
      const it = frames(world, shot);
      let next = it.next();
      let last: unknown;
      while (!next.done) {
        last = next.value;
        next = it.next();
      }
      expect(next.value).toEqual(simulate(world, shot));
      expect((last as { done: boolean }).done).toBe(true);
    }
  });

  it("doesn't care what order a world's keys are in, or that it has been through JSON", () => {
    const flip = (o: unknown): unknown =>
      Array.isArray(o) ? o.map(flip) : typeof o === "object" && o !== null ? Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, flip(v)])) : o;
    for (const [world, shot] of shots) {
      const want = simulate(world, shot);
      const got = simulate(JSON.parse(JSON.stringify(flip(world))) as World, shot);
      expect(got.world.bodies.map((b) => [b.id, b.x, b.y, b.pocketed])).toEqual(want.world.bodies.map((b) => [b.id, b.x, b.y, b.pocketed]));
      expect(got.events).toEqual(want.events);
    }
  });
});

describe("the forbidden functions", () => {
  // The ones the language lets an engine approximate, plus the two sources of anything-goes.
  const FORBIDDEN = ["sin", "cos", "tan", "asin", "acos", "atan", "atan2", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "exp", "expm1", "log", "log1p", "log2", "log10", "pow", "cbrt", "hypot", "random"] as const;
  afterEach(() => vi.restoreAllMocks());

  it("are never called while a shot is simulated", () => {
    const spies = FORBIDDEN.map((name) => vi.spyOn(Math, name));
    const now = vi.spyOn(Date, "now");
    const perf = vi.spyOn(performance, "now");
    simulate(POOL_TABLE, { body: "cue", angle: 123, power: 1000 });
    simulate(GOLF_HOLE, { body: "ball", angle: 24013, power: 1000 });
    for (const _ of frames(GOLF_HOLE, { body: "ball", angle: 20000, power: 800 })) void _;
    const called = spies.filter((s) => s.mock.calls.length > 0).map((s) => s.getMockName());
    expect(called).toEqual([]);
    expect(now).not.toHaveBeenCalled();
    expect(perf).not.toHaveBeenCalled();
  });

  it("the guard itself works: it notices a call", () => {
    const spy = vi.spyOn(Math, "sin");
    Math.sin(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("don't appear in the source at all, nor does the ** operator", () => {
    const allowed = new Set(["sqrt", "abs", "round"]);
    const dir = new URL("../src/", import.meta.url);
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const code = readFileSync(new URL(file, dir), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const used = [...code.matchAll(/Math\s*\.\s*(\w+)/g)].map((m) => m[1]!);
      expect(used.filter((name) => !allowed.has(name)), file).toEqual([]);
      expect(/Math\s*\[/.test(code), file).toBe(false);
      expect(code.includes("**"), file).toBe(false);
      expect(/\bDate\b|performance\./.test(code), file).toBe(false);
    }
  });
});
