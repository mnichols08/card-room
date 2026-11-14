// The turn timer: a table setting that has the game's computer player move for a person who runs
// out of time. On a fake clock, with every kind of table: the kit's games, Palace and Spades.
import { memoryLog } from "@zubra/sync/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCardRoom } from "../src/app.js";

const BASE = "http://test";
const T0 = Date.UTC(2026, 0, 1);
let open: ReturnType<typeof createCardRoom>[] = [];
beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
  vi.useRealTimers();
});
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);

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
type Phone = ReturnType<ReturnType<typeof setup>["phone"]>;

/** A table with one person in seat 0 and bots in the rest, dealt. */
async function table(me: Phone, options: unknown, settings: unknown, seats: number) {
  const { id } = (await me("/rooms", { options, settings })).body;
  await me(`/rooms/${id}/sit`, { seat: 0, name: "Grammi" });
  for (let seat = 1; seat < seats; seat++) await me(`/rooms/${id}/bot`, { seat, name: ["Dot", "Vern", "Duke"][seat - 1] });
  expect((await me(`/rooms/${id}/start`, {})).status).toBe(200);
  return id as string;
}
const movesOf = async (app: ReturnType<typeof createCardRoom>, id: string) => {
  const doc = (await app.rooms.sync.documents()).get("moves", id) ?? {};
  return Object.keys(doc)
    .filter((k) => /^\d+$/.test(k))
    .map((k) => doc[k] as { seat: number; move: Record<string, unknown>; at: number });
};

describe("the turn timer", () => {
  it("is off unless the table turns it on: the game waits for a person for ever", async () => {
    const { app, phone } = setup();
    const me = phone();
    const id = await table(me, { game: "crazy8", seats: 3 }, undefined, 3);
    await pass(3 * 60 * 60 * 1000);
    const room = (await me(`/rooms/${id}`)).body;
    expect(room.settings).toEqual({ skill: "mixed", pace: "natural" });
    expect(room.deadline ?? null).toBeNull();
    expect((await movesOf(app, id)).filter((m) => m.seat === 0)).toHaveLength(0);
  });

  it("plays a kit game to the end for someone who never touches it, passing and dealing included", async () => {
    const { app, phone } = setup();
    const me = phone();
    // Hearts: a pass everyone makes at once, tricks in turn, and "Deal the next hand" between hands.
    const id = await table(me, { game: "hearts", seats: 4 }, { timer: "15s" }, 4);
    const first = (await me(`/rooms/${id}`)).body;
    expect(first.settings).toEqual({ skill: "mixed", pace: "natural", timer: "15s" });
    expect(first.deadline).toEqual({ at: T0 + 15_000, seat: 0 });
    expect(first.now).toBe(T0);

    // The pass is everyone at once: the clock is on the one person, 15 seconds from the last pass
    // anyone made (the computer players', a few ms in).
    await pass(100);
    const { deadline } = (await me(`/rooms/${id}`)).body;
    expect(deadline.seat).toBe(0);
    expect(deadline.at).toBeGreaterThan(T0 + 15_000);
    expect(deadline.at).toBeLessThan(T0 + 15_100);
    await pass(deadline.at - Date.now() - 1);
    expect((await movesOf(app, id)).filter((m) => m.seat === 0)).toHaveLength(0);
    await pass(1);
    const mine = (await movesOf(app, id)).filter((m) => m.seat === 0);
    expect(mine).toEqual([{ seat: 0, move: expect.objectContaining({ type: "pass" }), at: deadline.at }]);

    for (let i = 0; i < 2000 && !(await me(`/rooms/${id}`)).body.summary.over; i++) await pass(15_100);
    const done = (await me(`/rooms/${id}`)).body;
    expect(done.summary.over).toBe(true);
    expect(done.deadline).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("leaves the clock off a computer player's turn, and puts it back on the person's", async () => {
    const { phone } = setup();
    const me = phone();
    const id = await table(me, { game: "crazy8", seats: 2 }, { timer: "30s" }, 2);
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      const room = (await me(`/rooms/${id}`)).body;
      if (room.summary.over) break;
      // Whenever a deadline is showing it's the person's, a full 30 seconds from the move before it.
      if (room.deadline) {
        expect(room.deadline.seat).toBe(0);
        expect(room.deadline.at).toBeGreaterThan(room.now);
        expect(room.deadline.at).toBeLessThanOrEqual(room.now + 30_000);
        seen++;
      }
      await pass(30_000);
    }
    expect(seen).toBeGreaterThan(3);
  });

  it("a move in time is the person's own, and starts the next clock", async () => {
    const { app, phone } = setup();
    const me = phone();
    const id = await table(me, { game: "palace", rules: {}, seats: 2 }, { timer: "1m" }, 2);
    // Palace starts with everyone swapping at once: the clock is on the person, who's the one not ready.
    expect((await me(`/rooms/${id}`)).body.deadline).toEqual({ at: T0 + 60_000, seat: 0 });
    await pass(20_000);
    expect((await me(`/rooms/${id}/act`, { move: { type: "ready" } })).status).toBe(200);
    await pass(59_000);
    expect((await movesOf(app, id)).filter((m) => m.seat === 0)).toEqual([{ seat: 0, move: { type: "ready" }, at: T0 + 20_000 }]);
  });

  it("plays Palace to the end for an idle person too, the swap included", async () => {
    const { app, phone } = setup();
    const me = phone();
    const id = await table(me, { game: "palace", rules: {}, seats: 3 }, { timer: "15s" }, 3);
    for (let i = 0; i < 3000 && (await me(`/rooms/${id}`)).body.summary.phase !== "finished"; i++) await pass(15_100);
    expect((await me(`/rooms/${id}`)).body).toMatchObject({ summary: { phase: "finished" }, deadline: null });
    expect((await movesOf(app, id)).filter((m) => m.seat === 0).length).toBeGreaterThan(3);
  });

  it("bids and plays a hand of Spades for an idle person too", async () => {
    const { app, phone } = setup();
    const me = phone();
    const id = await table(me, {}, { timer: "15s" }, 4);
    // One whole hand is enough (the computer players think hard): a bid, then thirteen cards.
    for (let i = 0; i < 100 && (await me(`/rooms/${id}`)).body.summary.hand === 1; i++) await pass(15_100);
    expect((await me(`/rooms/${id}`)).body.summary.hand).toBe(2);
    const mine = (await movesOf(app, id)).filter((m) => m.seat === 0).map((m) => m.move.type);
    expect(mine.slice(0, 14)).toEqual(["bid", ...Array(13).fill("play")]);
  }, 20_000);

  it("can be turned on mid-game by anyone seated, and off again", async () => {
    const { app, phone } = setup();
    const me = phone();
    const id = await table(me, { game: "crazy8", seats: 2 }, undefined, 2);
    await pass(10 * 60_000);
    while ((await me(`/rooms/${id}`)).body.deadline) await pass(1000); // (there is none: this never runs)
    const before = (await movesOf(app, id)).filter((m) => m.seat === 0).length;
    expect((await me(`/rooms/${id}/settings`, { settings: { timer: "15s" } })).body.settings.timer).toBe("15s");
    // Ten minutes late already: a few seconds' warning rather than an instant move.
    const { deadline, now } = (await me(`/rooms/${id}`)).body;
    expect(deadline).toEqual({ at: now + 5000, seat: 0 });
    await me(`/rooms/${id}/settings`, { settings: { timer: "off" } });
    expect((await me(`/rooms/${id}`)).body.deadline).toBeNull();
    await pass(60_000);
    expect((await movesOf(app, id)).filter((m) => m.seat === 0)).toHaveLength(before);
  });

  it("doesn't run for someone playing alone", async () => {
    const { phone } = setup();
    const me = phone();
    const id = await table(me, { game: "klondike", seats: 1 }, { timer: "15s" }, 1);
    expect((await me(`/rooms/${id}`)).body.deadline).toBeNull();
  });

  it("survives a restart: the same deadline, and the move when it passes", async () => {
    const first = setup();
    const me = first.phone();
    const id = await table(me, { game: "hearts", seats: 4 }, { timer: "1d" }, 4);
    const day = 86_400_000;
    await pass(60 * 60 * 1000);
    const { deadline } = (await me(`/rooms/${id}`)).body;
    expect(deadline.seat).toBe(0);
    expect(Math.abs(deadline.at - (T0 + day))).toBeLessThan(100); // a day from the last pass the others made
    first.app.close();

    const second = setup(first.log);
    await second.app.rooms.restored;
    const again = second.phone(me.cookie());
    expect((await again(`/rooms/${id}`)).body.deadline).toEqual(deadline);
    await pass(deadline.at - Date.now() - 1);
    expect((await movesOf(second.app, id)).filter((m) => m.seat === 0)).toHaveLength(0);
    await pass(1);
    expect((await movesOf(second.app, id)).filter((m) => m.seat === 0)).toHaveLength(1);
  });
});
