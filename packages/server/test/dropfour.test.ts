// Drop Four's shot clock (drinking mode): the first clock a game on the kit declares for itself
// (`TableGame.deadline`), kept by the room like the turn timer is. On a fake clock: an idle seat
// loses its turn and takes a drink, a table without drinking mode has no such clock, computer
// players aren't held to it, and it gets along with the table's turn timer and a restart.
import { SHOT_CLOCK_MS, type BoardView } from "@cardroom/games";
import { memoryLog } from "@zubra/sync/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCardRoom } from "../src/app.js";
import { GAME_CLOCK_GRACE_MS } from "../src/kit.js";

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
type App = ReturnType<typeof createCardRoom>;

const DRINKING = { game: "dropfour", rules: { id: "dropfour-drinking", first: "seat1" }, seats: 2 };
const CLASSIC = { game: "dropfour", rules: { id: "dropfour-classic", first: "seat1" }, seats: 2 };

/** A dealt table: Grammi in seat 0, and in seat 1 another person (if given) or a computer player. */
async function table(me: Phone, options: unknown, settings?: unknown, them?: Phone) {
  const { id } = (await me("/rooms", { options, settings })).body;
  await me(`/rooms/${id}/sit`, { seat: 0, name: "Grammi" });
  if (them) await them(`/rooms/${id}/sit`, { seat: 1, name: "Pappy" });
  else await me(`/rooms/${id}/bot`, { seat: 1, name: "Dot" });
  expect((await me(`/rooms/${id}/start`, {})).status).toBe(200);
  return id as string;
}
const movesOf = async (app: App, id: string) => {
  const doc = (await app.rooms.sync.documents()).get("moves", id) ?? {};
  return Object.keys(doc)
    .filter((k) => /^\d+$/.test(k))
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => doc[k] as { seat: number; move: Record<string, unknown>; at: number });
};
async function viewOf(send: Phone, id: string, seat: number): Promise<BoardView> {
  const changes = (await send("/_zb/sync/pull?since=0")).body.changes as { collection: string; key: string; field: string; value: any }[];
  return changes.filter((c) => c.collection === "views" && c.key === `${id}/${seat}` && c.field === "view").at(-1)!.value;
}
const drop = (send: Phone, id: string, col: number) => send(`/rooms/${id}/act`, { move: { type: "drop", col } });
const deadlineOf = async (send: Phone, id: string) => (await send(`/rooms/${id}`)).body.deadline ?? null;

describe("Drop Four's shot clock", () => {
  it("an idle seat on a drinking table loses the turn after the clock, and takes a drink", async () => {
    const { app, phone } = setup();
    const grammi = phone();
    const pappy = phone();
    const id = await table(grammi, DRINKING, undefined, pappy);

    // The first move of a game has no clock: red can take all day over it.
    expect(await deadlineOf(grammi, id)).toBeNull();
    await pass(60 * 60 * 1000);
    expect(await movesOf(app, id)).toEqual([]);

    // Grammi drops, and Pappy's three seconds start.
    expect((await drop(grammi, id, 3)).status).toBe(200);
    const dropped = Date.now();
    expect(await deadlineOf(pappy, id)).toEqual({ at: dropped + SHOT_CLOCK_MS, seat: 1 });
    expect(SHOT_CLOCK_MS).toBe(3000);

    // Pages count down to three seconds; the server waits a moment longer, for the trip there and back.
    await pass(SHOT_CLOCK_MS + GAME_CLOCK_GRACE_MS - 1);
    expect(await movesOf(app, id)).toHaveLength(1);
    await pass(1);
    expect(await movesOf(app, id)).toEqual([
      { seat: 0, move: { type: "drop", col: 3 }, at: dropped },
      { seat: 1, move: { type: "timeout" }, at: dropped + SHOT_CLOCK_MS + GAME_CLOCK_GRACE_MS },
    ]);

    // Pappy drank and lost his turn: it's Grammi's move again, with the rack as it was.
    const view = await viewOf(grammi, id, 0);
    expect(view.turn).toBe(0);
    expect(view.players.map((p) => p.line)).toEqual(["🍺 0", "🍺 1"]);
    expect(view.narration).toBe("{1} was too slow · 🍺 {1} drinks 1");
    expect(view.grids[0]!.cells.filter(Boolean)).toHaveLength(1);
    expect((await grammi(`/rooms/${id}`)).body.summary.scoreLine).toBe("0 to 0 · 🍺 0 and 1");

    // And she has no clock: Pappy didn't drop anything. Two people who have both gone don't drink for ever.
    expect(await deadlineOf(grammi, id)).toBeNull();
    await pass(24 * 60 * 60 * 1000);
    expect(await movesOf(app, id)).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);

    // A move in time is the player's own, and puts the clock on the other seat.
    expect((await drop(grammi, id, 4)).status).toBe(200);
    await pass(2900);
    expect((await drop(pappy, id, 4)).status).toBe(200);
    expect(await deadlineOf(grammi, id)).toEqual({ at: Date.now() + SHOT_CLOCK_MS, seat: 0 });
    // One that arrives as the page's countdown reaches zero still counts: that's what the grace is for.
    await pass(SHOT_CLOCK_MS + GAME_CLOCK_GRACE_MS - 50);
    expect((await drop(grammi, id, 5)).status).toBe(200);
    await pass(100);
    expect((await movesOf(app, id)).map((m) => m.move.type)).toEqual(["drop", "timeout", "drop", "drop", "drop"]);
    expect((await viewOf(grammi, id, 0)).players.map((p) => p.line)).toEqual(["🍺 0", "🍺 1"]);
  });

  it("a table without drinking mode has no such clock", async () => {
    const { app, phone } = setup();
    const grammi = phone();
    const pappy = phone();
    const id = await table(grammi, CLASSIC, undefined, pappy);
    expect(await deadlineOf(grammi, id)).toBeNull();
    expect((await drop(grammi, id, 3)).status).toBe(200);
    expect(await deadlineOf(grammi, id)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await pass(24 * 60 * 60 * 1000);
    expect(await movesOf(app, id)).toHaveLength(1);
    expect((await viewOf(pappy, id, 1)).turn).toBe(1);
    // The timeout move isn't something a seat can make there either.
    expect((await pappy(`/rooms/${id}/act`, { move: { type: "timeout" } })).status).not.toBe(200);
    expect((await drop(pappy, id, 3)).status).toBe(200);
    expect(await deadlineOf(grammi, id)).toBeNull();
  });

  it("a computer player isn't on the clock, and a person playing one is", async () => {
    const { app, phone } = setup();
    const grammi = phone();
    const id = await table(grammi, DRINKING);
    expect((await drop(grammi, id, 3)).status).toBe(200);
    // The clock the game declares is on the computer player's seat now: the room doesn't keep it.
    expect(await deadlineOf(grammi, id)).toBeNull();
    await pass(5);
    const [, answer] = await movesOf(app, id);
    expect(answer).toMatchObject({ seat: 1, move: { type: "drop" } });
    expect(await deadlineOf(grammi, id)).toEqual({ at: answer!.at + SHOT_CLOCK_MS, seat: 0 });

    // Grammi dawdles: she drinks, the computer player drops again, and her clock starts over.
    await pass(SHOT_CLOCK_MS + GAME_CLOCK_GRACE_MS);
    await pass(5);
    const moves = await movesOf(app, id);
    expect(moves.map((m) => [m.seat, m.move.type])).toEqual([[0, "drop"], [1, "drop"], [0, "timeout"], [1, "drop"]]);
    expect(await deadlineOf(grammi, id)).toEqual({ at: moves[3]!.at + SHOT_CLOCK_MS, seat: 0 });
    const view = await viewOf(grammi, id, 0);
    expect(view.players.map((p) => p.line)).toEqual(["🍺 1", "🍺 0"]);
    expect(view.grids[0]!.cells.filter(Boolean)).toHaveLength(3);

    // Left alone she loses every turn, and the computer player wins the game; then nothing is left running.
    for (let i = 0; i < 60 && !(await grammi(`/rooms/${id}`)).body.summary.over; i++) await pass(SHOT_CLOCK_MS + GAME_CLOCK_GRACE_MS + 5);
    const done = (await grammi(`/rooms/${id}`)).body;
    expect(done.summary).toMatchObject({ over: true, winners: [1] });
    expect(done.deadline).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    // The computer player never drank.
    expect((await viewOf(grammi, id, 0)).players[1]!.line).toBe("🍺 0");
  });

  it("with the table's turn timer on as well, whichever clock is sooner counts", async () => {
    const { app, phone } = setup();
    const grammi = phone();
    const pappy = phone();
    const id = await table(grammi, DRINKING, { timer: "15s" }, pappy);
    // The first move has no shot clock, so it's the turn timer's: 15 seconds, then the computer player's move for her.
    expect(await deadlineOf(grammi, id)).toEqual({ at: T0 + 15_000, seat: 0 });
    await pass(15_000);
    const [first] = await movesOf(app, id);
    expect(first).toMatchObject({ seat: 0, move: { type: "drop" }, at: T0 + 15_000 });
    // A disc landed, so Pappy is on the shot clock: three seconds, not fifteen.
    expect(await deadlineOf(grammi, id)).toEqual({ at: first!.at + SHOT_CLOCK_MS, seat: 1 });
    await pass(SHOT_CLOCK_MS + GAME_CLOCK_GRACE_MS);
    const [, second] = await movesOf(app, id);
    expect(second).toMatchObject({ seat: 1, move: { type: "timeout" } });
    // He lost his turn; there's no shot clock on Grammi, and the turn timer is back.
    expect(await deadlineOf(grammi, id)).toEqual({ at: second!.at + 15_000, seat: 0 });
    // Turning the turn timer off mid-game leaves only the game's own clock.
    expect((await grammi(`/rooms/${id}/settings`, { settings: { timer: "off" } })).status).toBe(200);
    expect(await deadlineOf(grammi, id)).toBeNull();
    expect((await drop(grammi, id, 0)).status).toBe(200);
    expect(await deadlineOf(grammi, id)).toEqual({ at: Date.now() + SHOT_CLOCK_MS, seat: 1 });
  });

  it("survives a restart: the timeout is in the move log, and a running clock comes back", async () => {
    const first = setup();
    const grammi = first.phone();
    const pappy = first.phone();
    const id = await table(grammi, DRINKING, undefined, pappy);
    await drop(grammi, id, 3);
    await pass(SHOT_CLOCK_MS + GAME_CLOCK_GRACE_MS);
    await drop(grammi, id, 2);
    const deadline = await deadlineOf(grammi, id);
    expect(deadline).toEqual({ at: Date.now() + SHOT_CLOCK_MS, seat: 1 });
    await pass(1000);
    first.app.close();

    const second = setup(first.log);
    await second.app.rooms.restored;
    const again = second.phone(grammi.cookie());
    // The replayed game has Pappy's missed turn and his drink in it. His clock was running, and still
    // is, but a clock that comes back with a restart never has less than the room's five seconds on
    // it: nobody loses a turn to the server going away.
    expect((await viewOf(again, id, 0)).players.map((p) => p.line)).toEqual(["🍺 0", "🍺 1"]);
    expect(await deadlineOf(again, id)).toEqual({ at: Date.now() + 5000, seat: 1 });
    expect(deadline.at).toBeLessThan(Date.now() + 5000);
    await pass(5000 + GAME_CLOCK_GRACE_MS - 1);
    expect(await movesOf(second.app, id)).toHaveLength(3);
    await pass(1);
    expect((await movesOf(second.app, id)).map((m) => [m.seat, m.move.type])).toEqual([[0, "drop"], [1, "timeout"], [0, "drop"], [1, "timeout"]]);
    expect((await viewOf(again, id, 0)).players.map((p) => p.line)).toEqual(["🍺 0", "🍺 2"]);
  });
});
