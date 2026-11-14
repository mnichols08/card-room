import { memoryLog } from "@zubra/sync/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRooms, RefusedMove, type RoomDefinition, type RoomsOptions } from "../src/server.js";

// Every test here runs on a fake clock: time only passes when a test says so.
const T0 = Date.UTC(2026, 0, 1);
let open: { close(): void }[] = [];
beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
});
afterEach(() => {
  open.forEach((r) => r.close());
  open = [];
  vi.useRealTimers();
});
const pass = (ms: number) => vi.advanceTimersByTimeAsync(ms);

const BASE = "http://test";
/** A server and the people at it: `as(n)` is the nth browser, with its own cookie. */
function table<S, M>(def: RoomDefinition<S, M, any, any, any>, options: RoomsOptions = {}) {
  const rooms = createRooms(def, { seed: () => 1, id: () => "room01", botDelay: 5, ...options });
  open.push(rooms);
  const cookies: string[] = [];
  const send = async (who: number, path: string, body?: unknown) => {
    const response = (await rooms.fetch(
      new Request(BASE + path, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", cookie: cookies[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    ))!;
    const set = response.headers.get("set-cookie");
    if (set) cookies[who] = set.split(";")[0]!;
    return { status: response.status, body: await response.json() };
  };
  return {
    rooms,
    cookies,
    post: (who: number, path: string, body: unknown = {}) => send(who, `/rooms/room01/${path}`, body),
    info: async () => (await send(0, "/rooms/room01")).body,
    /** The move log, as the server's own documents have it. */
    moves: async () => {
      const doc = (await rooms.sync.documents()).get("moves", "room01") ?? {};
      return Object.keys(doc)
        .filter((k) => /^\d+$/.test(k))
        .sort((a, b) => Number(a) - Number(b))
        .map((k) => doc[k] as { seat: number; move: unknown; at: number });
    },
  };
}

// The counting game with a turn limit from the table's settings: when it runs out, the server adds 1
// for the seat. A bot's seat has no limit (the bot has its own timer).
interface Counting {
  total: number;
  turn: number;
}
type Add = { add: number };
const SEATS = 3;
const counting: RoomDefinition<Counting, Add, Counting, { start: number }, { total: number; turn: number }> = {
  seats: SEATS,
  setup: (options) => ({ total: options.start ?? 0, turn: 0 }),
  act(state, seat, move) {
    if (seat !== state.turn) throw new RefusedMove("Not your turn.");
    if (!Number.isInteger(move?.add) || move.add < 1) throw new RefusedMove("Add a positive number.");
    return { total: state.total + move.add, turn: (state.turn + 1) % SEATS };
  },
  view: (state) => state,
  summary: (state) => state,
  finished: (state) => state.total >= 100,
  settings: (given) => ({ limit: Number((given as { limit?: number } | undefined)?.limit) || 0 }),
  bot: (state, seat) => (state.turn === seat ? { add: 10 } : null),
  deadline: (state, { settings, seats }) => (settings.limit && !seats[state.turn]?.bot ? { after: settings.limit, seat: state.turn, move: () => ({ add: 1 }) } : null),
};

/** Three people sit down and deal, with a turn limit. */
async function threePeople(def = counting, options: RoomsOptions = {}, limit = 30_000) {
  const t = table(def, options);
  await t.rooms.create({ start: 0 }, { limit });
  for (const seat of [0, 1, 2]) await t.post(seat, "sit", { seat, name: `P${seat}` });
  await t.post(0, "start");
  return t;
}

describe("deadlines", () => {
  it("publishes the deadline as server time, and makes the seat's move when it passes", async () => {
    const t = await threePeople();
    expect(await t.info()).toMatchObject({ deadline: { at: T0 + 30_000, seat: 0 }, summary: { total: 0, turn: 0 }, now: T0 });

    await pass(29_999);
    expect((await t.info()).summary).toEqual({ total: 0, turn: 0 });
    await pass(1);
    // The server moved for seat 0, and the clock is on seat 1 now, a full period from that move.
    expect(await t.info()).toMatchObject({ summary: { total: 1, turn: 1 }, deadline: { at: T0 + 60_000, seat: 1 } });
    // It went through the same path as any move: it's in the log, with its time.
    expect(await t.moves()).toEqual([{ seat: 0, move: { add: 1 }, at: T0 + 30_000 }]);
  });

  it("starts over after every move, and tells the app which moves were timeouts", async () => {
    const seen: { seat: number; timeout?: boolean }[] = [];
    const t = await threePeople(counting, { onMove: (e) => void seen.push({ seat: e.seat, ...(e.timeout ? { timeout: true } : {}) }) });
    await pass(10_000);
    expect((await t.post(0, "act", { move: { add: 5 } })).status).toBe(200);
    expect((await t.info()).deadline).toEqual({ at: T0 + 40_000, seat: 1 });
    await pass(29_999);
    expect((await t.info()).summary.total).toBe(5); // the old deadline (T0 + 30s) came and went
    await pass(1);
    expect(await t.info()).toMatchObject({ summary: { total: 6, turn: 2 }, deadline: { at: T0 + 70_000, seat: 2 } });
    expect(seen).toEqual([{ seat: 0 }, { seat: 1, timeout: true }]);
  });

  it("stops when the game finishes", async () => {
    const t = await threePeople();
    await t.post(0, "act", { move: { add: 100 } });
    expect(await t.info()).toMatchObject({ summary: { total: 100 }, deadline: null });
    expect(vi.getTimerCount()).toBe(0);
    await pass(120_000);
    expect((await t.info()).summary.total).toBe(100);
    expect(await t.moves()).toHaveLength(1);
  });

  it("never applies a timeout and a real move to the same turn", async () => {
    // The move arrives in the same millisecond the timer is due: it's decided before the timer runs.
    const t = await threePeople();
    await pass(29_999);
    vi.setSystemTime(T0 + 30_000);
    expect((await t.post(0, "act", { move: { add: 7 } })).status).toBe(200);
    await pass(5);
    expect((await t.info()).summary).toEqual({ total: 7, turn: 1 });
    expect(await t.moves()).toHaveLength(1);

    // The other way round: the timer wins, and the late move is refused like any move out of turn.
    await pass(30_000);
    expect((await t.info()).summary).toEqual({ total: 8, turn: 2 });
    expect((await t.post(1, "act", { move: { add: 7 } })).body).toEqual({ error: "Not your turn." });
    expect(await t.moves()).toHaveLength(2);

    // And a move still on its way in when the timer fires: one of them lands, not both.
    await pass(29_999);
    const racing = t.post(2, "act", { move: { add: 20 } });
    await pass(1);
    expect([200, 400]).toContain((await racing).status);
    expect((await t.moves()).filter((m) => m.seat === 2)).toHaveLength(1);
    expect((await t.info()).summary.turn).toBe(0);
  });

  it("does nothing when the game has no move for the seat, and pages stop counting", async () => {
    const stuck: typeof counting = { ...counting, deadline: (state, table) => ({ ...counting.deadline!(state, table)!, move: () => null }) };
    const t = await threePeople(stuck);
    await pass(30_000);
    expect(await t.info()).toMatchObject({ summary: { total: 0, turn: 0 }, deadline: null });
    expect(await t.moves()).toHaveLength(0);
    // The seat can still move, and the next seat gets its clock.
    await t.post(0, "act", { move: { add: 2 } });
    expect((await t.info()).deadline).toEqual({ at: T0 + 60_000, seat: 1 });
  });

  it("works out the deadline again when the settings change, without restarting the clock", async () => {
    const t = await threePeople(counting, {}, 0);
    expect((await t.info()).deadline ?? null).toBeNull();
    await pass(60_000);
    expect((await t.info()).summary.total).toBe(0); // no limit: the game waits

    // A minute in, someone turns on a 30 second limit. It's already past: the seat gets the grace period, not nothing.
    await t.post(1, "settings", { settings: { limit: 30_000 } });
    expect((await t.info()).deadline).toEqual({ at: T0 + 65_000, seat: 0 });
    // Saying the same thing again isn't a way to stall.
    await pass(2_000);
    await t.post(0, "settings", { settings: { limit: 30_000 } });
    expect((await t.info()).deadline).toEqual({ at: T0 + 65_000, seat: 0 });
    // A longer limit counts from the last move (the deal), as it always would have.
    await t.post(0, "settings", { settings: { limit: 90_000 } });
    expect((await t.info()).deadline).toEqual({ at: T0 + 90_000, seat: 0 });
    await t.post(0, "settings", { settings: { limit: 0 } });
    expect((await t.info()).deadline).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps a deadline longer than one timer can sleep", async () => {
    const days = 40 * 24 * 60 * 60 * 1000; // setTimeout tops out near 24.8 days
    const t = await threePeople(counting, {}, days);
    await pass(days - 1);
    expect((await t.info()).summary.total).toBe(0);
    await pass(1);
    expect((await t.info()).summary.total).toBe(1);
  });
});

describe("deadlines and bots", () => {
  it("run side by side: the clock is on the person, the bots keep their own time", async () => {
    const t = table(counting, { botDelay: 2_000 });
    await t.rooms.create({ start: 0 }, { limit: 30_000 });
    await t.post(0, "sit", { seat: 0, name: "A" });
    await t.post(0, "bot", { seat: 1 });
    await t.post(0, "bot", { seat: 2 });
    await t.post(0, "start");

    await pass(30_000); // the person's time runs out: 1
    expect(await t.info()).toMatchObject({ summary: { total: 1, turn: 1 }, deadline: null }); // a bot's turn has no deadline
    await pass(4_000); // both bots: 10 each
    expect(await t.info()).toMatchObject({ summary: { total: 21, turn: 0 }, deadline: { at: T0 + 64_000, seat: 0 } });
    expect((await t.moves()).map((m) => m.seat)).toEqual([0, 1, 2]);
  });

  it("a deadline that lands on a bot's turn before the bot moves doesn't stall the table or move twice", async () => {
    // Here the clock runs on every seat, bots too, and is quicker than the bots think.
    const strict: typeof counting = { ...counting, deadline: (state, { settings }) => ({ after: settings.limit, seat: state.turn, move: () => ({ add: 1 }) }) };
    const t = table(strict, { botDelay: 1_000 });
    await t.rooms.create({ start: 0 }, { limit: 400 });
    await t.post(0, "sit", { seat: 0, name: "A" });
    await t.post(0, "bot", { seat: 1 });
    await t.post(0, "bot", { seat: 2 });
    await t.post(0, "start");
    await t.post(0, "act", { move: { add: 5 } }); // seat 1's bot starts thinking (1000), its clock is 400
    await pass(400);
    expect((await t.info()).summary).toEqual({ total: 6, turn: 2 }); // the clock moved for the bot
    await pass(400);
    expect((await t.info()).summary).toEqual({ total: 7, turn: 0 }); // and for the next
    // Seat 1's bot wakes at 1000 to find it isn't its move, and the table carries on: one move a turn.
    await pass(4_000);
    const moves = await t.moves();
    expect(moves.map((m) => m.seat)).toEqual(moves.map((_, i) => i % 3));
    expect(moves.length).toBeGreaterThan(8);
  });
});

describe("deadlines across a restart", () => {
  it("come back without anyone opening the table, where they were", async () => {
    const log = memoryLog({ keep: "latest" });
    const first = await threePeople(counting, { log }, 60_000);
    await pass(10_000);
    await first.post(0, "act", { move: { add: 3 } }); // seat 1's clock: T0 + 70s
    await pass(20_000);
    first.rooms.close();

    // Same log, new process, 25 seconds later. Nobody asks for the room.
    vi.setSystemTime(T0 + 55_000);
    const second = table(counting, { log });
    await second.rooms.restored;
    expect(second.rooms.inMemory).toBe(1);
    expect((await second.info()).deadline).toEqual({ at: T0 + 70_000, seat: 1 }); // not a fresh minute
    await pass(14_999);
    expect((await second.info()).summary.total).toBe(3);
    await pass(1);
    expect(await second.info()).toMatchObject({ summary: { total: 4, turn: 2 }, deadline: { at: T0 + 130_000, seat: 2 } });
    expect(await second.moves()).toEqual([
      { seat: 0, move: { add: 3 }, at: T0 + 10_000 },
      { seat: 1, move: { add: 1 }, at: T0 + 70_000 },
    ]);
  });

  it("give a moment's grace when the time ran out while the server was down", async () => {
    const log = memoryLog({ keep: "latest" });
    const first = await threePeople(counting, { log }, 60_000);
    first.rooms.close();

    vi.setSystemTime(T0 + 600_000); // ten minutes down: the deadline passed nine minutes ago
    const second = table(counting, { log, deadlineGrace: 5_000 });
    second.cookies.push(...first.cookies);
    await second.rooms.restored;
    expect((await second.info()).deadline).toEqual({ at: T0 + 605_000, seat: 0 });
    await pass(4_999);
    expect((await second.info()).summary.total).toBe(0);
    await pass(1);
    expect((await second.info()).summary).toEqual({ total: 1, turn: 1 });
  });

  it("a request and the restore at boot share one copy of the room: one timeout, not two", async () => {
    const log = memoryLog({ keep: "latest" });
    const first = await threePeople(counting, { log }, 60_000);
    first.rooms.close();

    vi.setSystemTime(T0 + 30_000);
    const second = table(counting, { log });
    second.cookies.push(...first.cookies);
    // Requests land while the restore at boot is still reading the log.
    const refused = await Promise.all([second.post(1, "act", { move: { add: 9 } }), second.post(2, "act", { move: { add: 9 } }), second.rooms.restored]);
    expect(refused[0].status).toBe(400);
    expect(second.rooms.inMemory).toBe(1);
    await pass(30_000);
    expect(await second.moves()).toEqual([{ seat: 0, move: { add: 1 }, at: T0 + 60_000 }]);
  });

  it("leaves rooms that had no deadline running alone until someone asks", async () => {
    const log = memoryLog({ keep: "latest" });
    const first = await threePeople(counting, { log }, 0);
    first.rooms.close();
    const second = table(counting, { log });
    await second.rooms.restored;
    expect(second.rooms.inMemory).toBe(0);
  });
});

// A toy chess clock: two seats, each with a bank of time that runs down while it's their move, and
// an increment added after each move. The state keeps the banks; they change only through `act`'s
// `time`, so the move log replays to the same clocks. When a bank runs out, the server's timeout move
// is the flag falling.
interface Clocked {
  turn: number;
  bank: number[];
  moves: number;
  lostOnTime: number | null;
}
type ClockMove = { type: "move" } | { type: "flag" };
const BANK = 60_000;
const INCREMENT = 2_000;
const clocked: RoomDefinition<Clocked, ClockMove, Clocked, object, Clocked> = {
  seats: 2,
  setup: () => ({ turn: 0, bank: [BANK, BANK], moves: 0, lostOnTime: null }),
  act(state, seat, move, time) {
    if (state.lostOnTime !== null) throw new RefusedMove("The game is over.");
    if (seat !== state.turn) throw new RefusedMove("Not your turn.");
    const left = state.bank[seat]! - time.elapsed;
    const bank = state.bank.map((b, i) => (i === seat ? Math.max(0, left) : b));
    // Out of time, whether the server's flag says so or the move itself arrived too late.
    if (move.type === "flag" || left <= 0) {
      if (left > 0) throw new RefusedMove("There's time on the clock yet.");
      return { ...state, bank, lostOnTime: seat };
    }
    bank[seat] = left + INCREMENT;
    return { turn: 1 - seat, bank, moves: state.moves + 1, lostOnTime: null };
  },
  view: (state) => state,
  summary: (state) => state,
  finished: (state) => state.lostOnTime !== null,
  deadline: (state) => (state.lostOnTime === null ? { after: state.bank[state.turn]!, seat: state.turn, move: () => ({ type: "flag" }) } : null),
};

describe("a chess clock on deadlines", () => {
  async function twoPeople(options: RoomsOptions = {}) {
    const t = table(clocked, options);
    await t.rooms.create({});
    for (const seat of [0, 1]) await t.post(seat, "sit", { seat, name: `P${seat}` });
    await t.post(0, "start");
    return t;
  }

  it("runs each side's bank down on its own moves, adds the increment, and drops the flag", async () => {
    const t = await twoPeople();
    expect((await t.info()).deadline).toEqual({ at: T0 + 60_000, seat: 0 });
    await pass(10_000);
    await t.post(0, "act", { move: { type: "move" } }); // 60 - 10 + 2
    expect(await t.info()).toMatchObject({ summary: { bank: [52_000, 60_000], turn: 1 }, deadline: { at: T0 + 70_000, seat: 1 } });
    await pass(45_000);
    await t.post(1, "act", { move: { type: "move" } }); // 60 - 45 + 2
    // Seat 0's flag falls when its 52 seconds are gone, not a fixed time after the last move.
    expect(await t.info()).toMatchObject({ summary: { bank: [52_000, 17_000], turn: 0 }, deadline: { at: T0 + 107_000, seat: 0 } });
    // A player can't call the other's flag, or their own early.
    expect((await t.post(0, "act", { move: { type: "flag" } })).body).toEqual({ error: "There's time on the clock yet." });
    await pass(51_999);
    expect((await t.info()).summary.lostOnTime).toBeNull();
    await pass(1);
    expect(await t.info()).toMatchObject({ summary: { bank: [0, 17_000], lostOnTime: 0 }, deadline: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replays to the same clocks after a restart, and the bank kept running meanwhile", async () => {
    const log = memoryLog({ keep: "latest" });
    const first = await twoPeople({ log });
    await pass(10_000);
    await first.post(0, "act", { move: { type: "move" } });
    await pass(5_000);
    await first.post(1, "act", { move: { type: "move" } }); // banks 52 and 57; seat 0 to move since T0 + 15s
    await pass(1_000);
    first.rooms.close();

    vi.setSystemTime(T0 + 30_000);
    const second = table(clocked, { log });
    second.cookies.push(...first.cookies);
    await second.rooms.restored;
    expect(await second.info()).toMatchObject({ summary: { bank: [52_000, 57_000], turn: 0, moves: 2 }, deadline: { at: T0 + 67_000, seat: 0 } });
    // Seat 0 moves 20 seconds into its turn: the 14 the server was down for count too.
    vi.setSystemTime(T0 + 35_000);
    await second.post(0, "act", { move: { type: "move" } });
    expect((await second.info()).summary.bank).toEqual([34_000, 57_000]);
    second.rooms.close();

    // A third process replays all three moves from the log, the last one included.
    const third = table(clocked, { log });
    await third.rooms.restored;
    expect(await third.info()).toMatchObject({ summary: { bank: [34_000, 57_000], turn: 1, moves: 3 }, deadline: { at: T0 + 35_000 + 57_000, seat: 1 } });
  });
});

describe("deadlines by the state's own times", () => {
  it("take an absolute server time as well as a wait", async () => {
    // A window that closes five seconds after the first move, however many moves follow it.
    interface Window {
      opened: number | null;
      claims: number;
      closed: boolean;
    }
    const windowed: RoomDefinition<Window, { type: "claim" | "close" }, Window, object, Window> = {
      seats: 2,
      setup: () => ({ opened: null, claims: 0, closed: false }),
      act: (state, _seat, move, time) => {
        if (state.closed) throw new RefusedMove("Too late.");
        return move.type === "close" ? { ...state, closed: true } : { ...state, opened: state.opened ?? time.at, claims: state.claims + 1 };
      },
      view: (state) => state,
      summary: (state) => state,
      deadline: (state) => (state.opened !== null && !state.closed ? { at: state.opened + 5_000, seat: 0, move: () => ({ type: "close" }) } : null),
    };
    const t = table(windowed);
    await t.rooms.create({});
    for (const seat of [0, 1]) await t.post(seat, "sit", { seat, name: `P${seat}` });
    await t.post(0, "start");
    await pass(1_000);
    await t.post(1, "act", { move: { type: "claim" } });
    await pass(3_000);
    await t.post(0, "act", { move: { type: "claim" } });
    expect((await t.info()).deadline).toEqual({ at: T0 + 6_000, seat: 0 }); // still five seconds from the first
    await pass(2_000);
    expect(await t.info()).toMatchObject({ summary: { claims: 2, closed: true }, deadline: null });
    expect((await t.post(1, "act", { move: { type: "claim" } })).body).toEqual({ error: "Too late." });
  });
});
