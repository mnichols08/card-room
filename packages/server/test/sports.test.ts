// A table sport in the card room, through the same doors as the card and board games: a house
// table with house rules, putted to the end by a person (from nothing but what their view shows)
// against a computer player, the leaderboard, private views, the turn timer and a restart.
import { PHYSICS_VERSION, simulate } from "@cardroom/physics";
import { angleTo, sameRest, worldBefore, type SportView } from "@cardroom/games";
import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCardRoom } from "../src/app.js";
import { warmSports } from "../src/kit.js";

const BASE = "http://test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
  vi.useRealTimers();
});

function setup(log = memoryLog({ keep: "latest" })) {
  const app = createCardRoom({ log, botDelay: 1, talk: false });
  open.push(app);
  const phone = (cookie = "") => {
    const send = async (path: string, body?: unknown) => {
      const r = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })))!;
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return { status: r.status, body: await r.json() };
    };
    return Object.assign(send, { cookie: () => cookie });
  };
  return { app, phone, log };
}
type Send = ReturnType<ReturnType<typeof setup>["phone"]>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function viewOf(send: Send, id: string, seat: number): Promise<SportView | undefined> {
  const changes = (await send("/_zb/sync/pull?since=0")).body.changes as { collection: string; key: string; field: string; value: any }[];
  return changes.filter((c) => c.collection === "views" && c.key === `${id}/${seat}` && c.field === "view").at(-1)?.value;
}
const movesOf = async (app: ReturnType<typeof createCardRoom>, id: string) => {
  const doc = (await app.rooms.sync.documents()).get("moves", id) ?? {};
  return Object.keys(doc)
    .filter((k) => /^\d+$/.test(k))
    .map((k) => doc[k] as { seat: number; move: Record<string, unknown>; at: number });
};

/** What a person does: aim at the cup and hit it about hard enough to get there. */
function putt(v: SportView) {
  const ball = v.table.world.bodies.find((b) => b.id === v.shoot!.body)!;
  const cup = v.table.world.pockets[0]!;
  const far = Math.hypot(cup.x - ball.x, cup.y - ball.y);
  // v² = 2 × friction × distance, as a share of the full shot speed.
  const power = Math.round((Math.sqrt(2 * v.table.world.friction * (far + 300)) / v.table.world.maxShotSpeed) * 1000);
  return { type: "shot", body: v.shoot!.body, angle: angleTo(ball, cup), power: Math.min(v.shoot!.maxPower, Math.max(v.shoot!.minPower, power)) };
}

/** A person playing only from their view, to the end. Checks every shot the view carries along the way. */
async function playRound(send: Send, id: string, seat: number) {
  const seen = new Set<number>();
  for (let i = 0; i < 4000; i++) {
    const v = await viewOf(send, id, seat);
    if (v?.last && !seen.has(v.last.n)) {
      seen.add(v.last.n);
      // What a browser does with it: the same shot from the same bodies ends at the same rest.
      expect(sameRest(simulate(worldBefore(v)!, v.last.shot).world, v.last.rest)).toBe(true);
      expect(v.last.physics).toBe(PHYSICS_VERSION);
    }
    if (v?.over) return { view: v, shots: seen.size };
    const move = v?.shoot ? putt(v) : v?.choices?.options[0]?.move;
    if (move) {
      const r = await send(`/rooms/${id}/act`, { move });
      expect(r.status, JSON.stringify([move, r.body])).toBe(200);
    } else await sleep(2);
  }
  throw new Error("the round didn't finish");
}

describe("table sports in the card room", () => {
  it("warms the physics up without fuss", () => {
    expect(warmSports()).toBeGreaterThanOrEqual(0);
  });

  it("Mini Golf: a house table with house rules, putted to the end against a computer player, on the leaderboard", async () => {
    const { phone } = setup();
    const grammi = phone();
    const made = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    expect(made.kitRules.minigolf.presets.map((p: { id: string }) => p.id)).toEqual(["minigolf-nine", "minigolf-together", "minigolf-quick", "minigolf-quick-together"]);

    // House rules: three holes in turn, four strokes a hole, water is free. Rules that make no sense are put right.
    const saved = await grammi("/houses/grammis-house/presets", { game: "minigolf", preset: { ...made.kitRules.minigolf.presets[2], id: "", name: "Porch putting", limit: 4, penalty: 0 }, makeDefault: true });
    expect(saved.status).toBe(200);
    const porch = saved.body.kitRules.minigolf.presets.find((p: { name: string }) => p.name === "Porch putting");
    expect(porch).toMatchObject({ holes: 3, order: "turns", limit: 4, penalty: 0, course: "back-garden" });

    const { id } = (await grammi("/houses/grammis-house/tables", { game: "minigolf", seats: 2 })).body;
    const room = (await grammi(`/rooms/${id}`)).body;
    expect(room.info).toEqual({ game: "minigolf", rules: "Porch putting" });
    expect(room.seats).toHaveLength(2);
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await grammi(`/rooms/${id}/bot`, { seat: 1, name: "Hank" });
    await grammi(`/rooms/${id}/start`, {});

    const first = (await viewOf(grammi, id, 0))!;
    expect(first).toMatchObject({ game: "minigolf", seats: 2, me: 0, phase: "playing" });
    expect(first.table.name).toBe("Hole 1: Welcome Mat");
    expect(first.table.world.bodies).toEqual([{ id: "ball-0", x: 5000, y: 13500, r: 240 }]);
    // The server refuses what the rules refuse, and says why.
    const wrong = await grammi(`/rooms/${id}/act`, { move: { type: "shot", body: "ball-1", angle: 27000, power: 500 } });
    expect(wrong.status).not.toBe(200);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "shot", body: "ball-0", angle: 27000.5, power: 500 } })).status).not.toBe(200);

    const end = await playRound(grammi, id, 0);
    expect(end.shots).toBeGreaterThan(3);
    expect(end.view.over!.winners.length).toBeGreaterThan(0);
    expect(end.view.card!.rows.every((r) => r.cells.every((c) => Number(c) >= 1 && Number(c) <= 5))).toBe(true);
    const summary = (await grammi(`/rooms/${id}`)).body.summary;
    expect(summary).toMatchObject({ game: "minigolf", over: true, teams: false, seats: 2, hand: 3 });

    const board = (await grammi("/houses/grammis-house/leaderboard?game=minigolf")).body;
    expect(board).toMatchObject({ game: "minigolf", games: 1, teams: false });
    expect(board.players[0]).toMatchObject({ name: "brokennil", played: 1 });
  }, 60_000);

  it("each seat is sent only its own view, and all at once nobody waits for anybody", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const id = (await grammi("/rooms", { options: { game: "minigolf", rules: { id: "minigolf-quick-together" }, seats: 2 } })).body.id;
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await rick(`/rooms/${id}/sit`, { seat: 1, name: "Rick" });
    await grammi(`/rooms/${id}/start`, {});
    const [mine, his] = [(await viewOf(grammi, id, 0))!, (await viewOf(rick, id, 1))!];
    expect([mine.me, his.me, mine.turn, his.turn]).toEqual([0, 1, null, null]);
    expect([mine.shoot!.body, his.shoot!.body]).toEqual(["ball-0", "ball-1"]);
    // Rick putts twice before Grammi has moved: no turns.
    expect((await rick(`/rooms/${id}/act`, { move: { type: "shot", body: "ball-1", angle: 27000, power: 300 } })).status).toBe(200);
    expect((await rick(`/rooms/${id}/act`, { move: { type: "shot", body: "ball-1", angle: 27000, power: 200 } })).status).toBe(200);
    // Each may strike only their own ball.
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "shot", body: "ball-1", angle: 27000, power: 300 } })).status).not.toBe(200);
    const after = (await viewOf(grammi, id, 0))!;
    // Grammi sees Rick's ball out on the green as a ghost, and no shot of his to replay.
    expect(after.table.ghosts.map((g) => g.owner)).toEqual([1]);
    expect(after.last).toBeNull();
    expect((await viewOf(rick, id, 1))!.last).toMatchObject({ seat: 1, shot: { power: 200 } });
    // A stranger's phone gets nobody's view.
    expect(await viewOf(phone(), id, 0)).toBeUndefined();
  });

  it("the turn timer putts for someone who has walked away, in turn and all at once", async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 0, 1) });
    for (const rules of ["minigolf-quick", "minigolf-quick-together"]) {
      const { app, phone } = setup();
      const me = phone();
      const { id } = (await me("/rooms", { options: { game: "minigolf", rules: { id: rules, holes: 1 }, seats: 2 }, settings: { timer: "15s" } })).body;
      await me(`/rooms/${id}/sit`, { seat: 0, name: "Grammi" });
      await me(`/rooms/${id}/bot`, { seat: 1, name: "Dot" });
      expect((await me(`/rooms/${id}/start`, {})).status).toBe(200);
      for (let i = 0; i < 60 && !(await me(`/rooms/${id}`)).body.summary.over; i++) {
        const room = (await me(`/rooms/${id}`)).body;
        // A clock that is showing is always the person's.
        if (room.deadline) expect(room.deadline.seat).toBe(0);
        await vi.advanceTimersByTimeAsync(15_100);
      }
      const done = (await me(`/rooms/${id}`)).body;
      expect(done.summary.over, rules).toBe(true);
      // Every one of the person's putts was the timer's, and each is a whole-number shot like any other.
      const mine = (await movesOf(app, id)).filter((m) => m.seat === 0);
      expect(mine.length).toBeGreaterThan(0);
      for (const m of mine) expect(m.move).toMatchObject({ type: "shot", body: "ball-0", angle: expect.any(Number), power: expect.any(Number) });
      expect(vi.getTimerCount()).toBe(0);
    }
  }, 60_000);

  it("survives a restart: the log replays to the same table, ball for ball", async () => {
    const first = setup();
    const me = first.phone();
    const { id } = (await me("/rooms", { options: { game: "minigolf", rules: { id: "minigolf-nine" }, seats: 2 } })).body;
    await me(`/rooms/${id}/sit`, { seat: 0, name: "Grammi" });
    await me(`/rooms/${id}/bot`, { seat: 1, name: "Dot" });
    await me(`/rooms/${id}/start`, {});
    // A few putts each, some of them off the walls.
    for (let i = 0; i < 300; i++) {
      const v = await viewOf(me, id, 0);
      // Stop where one more tap is only a stroke: not the one that reaches the limit and picks the ball up.
      const stroke = Number(/Stroke (\d+)/.exec(v?.info.join(" ") ?? "")?.[1] ?? 99);
      if (v && v.last && v.last.n >= 6 && v.shoot && stroke <= 4) break;
      if (v?.shoot) await me(`/rooms/${id}/act`, { move: { type: "shot", body: "ball-0", angle: 25000 + i * 37, power: 300 + (i % 5) * 90 } });
      else if (v?.choices) await me(`/rooms/${id}/act`, { move: v.choices.options[0]!.move });
      else await sleep(2);
    }
    const before = (await viewOf(me, id, 0))!;
    expect(before.last!.n).toBeGreaterThanOrEqual(6);
    const logged = await movesOf(first.app, id);
    first.app.close();

    // A new server on the same log: nothing in memory, so the table is rebuilt from its moves.
    const second = setup(first.log);
    const again = second.phone(me.cookie());
    const shot = { type: "shot", body: "ball-0", angle: 27000, power: 20 };
    expect((await again(`/rooms/${id}/act`, { move: shot })).status).toBe(200);
    const after = (await viewOf(again, id, 0))!;
    expect(await movesOf(second.app, id)).toHaveLength(logged.length + 1);
    // The tap moved nothing: the ball lies where the first server left it, and the scores carried over.
    expect(after.last!.n).toBe(before.last!.n + 1);
    expect(after.last!.from).toEqual(before.table.world.bodies);
    expect(after.scores[0]!.value).toBe(before.scores[0]!.value + 1);
    expect(after.scores[1]).toEqual(before.scores[1]);
    expect(after.card!.rows[1]).toEqual(before.card!.rows[1]);
  }, 60_000);
});
