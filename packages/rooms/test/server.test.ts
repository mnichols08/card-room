import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createRooms, RefusedMove, type RoomDefinition } from "../src/server.js";

// A tiny game: each seat has a secret; on your turn you add to a shared total.
interface State {
  secrets: number[];
  total: number;
  turn: number;
}
type Move = { add: number };
const counting: RoomDefinition<State, Move, { secret: number; total: number; turn: number }, { start: number }, { total: number }> = {
  seats: 3,
  setup: (options, seed) => ({ secrets: [seed + 1, seed + 2, seed + 3], total: options.start, turn: 0 }),
  act(state, seat, move) {
    if (seat !== state.turn) throw new RefusedMove("Not your turn.");
    if (!Number.isInteger(move?.add) || move.add < 1) throw new RefusedMove("Add a positive number.");
    return { ...state, total: state.total + move.add, turn: (state.turn + 1) % 3 };
  },
  view: (state, seat) => ({ secret: state.secrets[seat]!, total: state.total, turn: state.turn }),
  summary: (state) => ({ total: state.total }),
  bot: (state, seat) => (state.turn === seat ? { add: 1 } : null),
};

const BASE = "http://test";
let open: ReturnType<typeof createRooms<State, Move, any, any, any>>[] = [];
afterEach(() => {
  open.forEach((r) => r.close());
  open = [];
});

function setup(log = memoryLog({ keep: "latest" }), botDelay = 5) {
  const rooms = createRooms(counting, { log, botDelay, seed: () => 100, id: () => "abc123" });
  open.push(rooms);
  /** A browser: keeps its own cookie. */
  const browser = () => {
    let cookie = "";
    const send = async (path: string, init: RequestInit = {}) => {
      const response = (await rooms.fetch(new Request(BASE + path, { ...init, headers: { "content-type": "application/json", cookie } })))!;
      const set = response.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return response;
    };
    return {
      send,
      post: async (path: string, body: unknown = {}) => {
        const r = await send(path, { method: "POST", body: JSON.stringify(body) });
        return { status: r.status, body: await r.json() };
      },
      /** Everything this browser may pull from the sync log. */
      pull: async () => (await (await send("/_zb/sync/pull?since=0")).json()).changes as { collection: string; key: string; field: string; value: any }[],
    };
  };
  return { rooms, browser };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("rooms", () => {
  it("creates a room, seats players, starts, and decides moves on the server", async () => {
    const { browser } = setup();
    const a = browser();
    const b = browser();
    const c = browser();
    expect((await a.post("/rooms", { options: { start: 10 } })).body).toEqual({ id: "abc123" });
    expect((await a.post("/rooms/abc123/sit", { seat: 0, name: "brokennil" })).status).toBe(200);
    expect((await b.post("/rooms/abc123/sit", { seat: 0, name: "Rick" })).status).toBe(409);
    await b.post("/rooms/abc123/sit", { seat: 1, name: "Rick" });
    expect((await a.post("/rooms/abc123/start")).status).toBe(409); // seat 2 is empty
    await c.post("/rooms/abc123/sit", { seat: 2, name: "Jimmy" });
    expect((await a.post("/rooms/abc123/start")).status).toBe(200);

    expect((await b.post("/rooms/abc123/act", { move: { add: 1 } })).body).toEqual({ error: "Not your turn." });
    expect((await a.post("/rooms/abc123/act", { move: { add: 0 } })).status).toBe(400);
    expect((await a.post("/rooms/abc123/act", { move: { add: 5 } })).status).toBe(200);
    expect((await b.post("/rooms/abc123/act", { move: { add: 2 } })).status).toBe(200);

    const info = await (await a.send("/rooms/abc123")).json();
    expect(info).toMatchObject({ id: "abc123", started: true, seat: 0, summary: { total: 17 } });
    expect(info.seats.map((s: { name: string }) => s.name)).toEqual(["brokennil", "Rick", "Jimmy"]);
  });

  it("a browser can read only its own seat's view, and never the server's documents", async () => {
    const { browser } = setup();
    const a = browser();
    const b = browser();
    const stranger = browser();
    await a.post("/rooms", { options: { start: 0 } });
    await a.post("/rooms/abc123/sit", { seat: 0, name: "A" });
    await b.post("/rooms/abc123/sit", { seat: 1, name: "B" });
    await a.post("/rooms/abc123/bot", { seat: 2 });
    await a.post("/rooms/abc123/start");

    const viewKeys = async (who: ReturnType<typeof browser>) =>
      [...new Set((await who.pull()).filter((c) => c.collection === "views").map((c) => c.key))];
    expect(await viewKeys(a)).toEqual(["abc123/0"]);
    expect(await viewKeys(b)).toEqual(["abc123/1"]);
    expect(await viewKeys(stranger)).toEqual([]);

    const collections = new Set((await stranger.pull()).map((c) => c.collection));
    expect([...collections]).toEqual(["rooms"]);
    const secret = (await a.pull()).find((c) => c.collection === "views" && c.field === "view")!.value.secret;
    expect(secret).toBe(101);
  });

  it("pages can't write documents directly", async () => {
    const { browser } = setup();
    const a = browser();
    await a.post("/rooms", { options: { start: 0 } });
    await a.post("/rooms/abc123/sit", { seat: 0, name: "A" });
    const push = await a.send("/_zb/sync/push", {
      method: "POST",
      body: JSON.stringify({ changes: [{ collection: "rooms", key: "abc123", field: "started", value: true, clock: `${String(Date.now()).padStart(15, "0")}-00000-x` }] }),
    });
    expect(push.status, await push.clone().text()).toBe(403);
  });

  it("bots take their turns", async () => {
    const { browser } = setup();
    const a = browser();
    await a.post("/rooms", { options: { start: 0 } });
    await a.post("/rooms/abc123/sit", { seat: 0, name: "A" });
    await a.post("/rooms/abc123/bot", { seat: 1 });
    await a.post("/rooms/abc123/bot", { seat: 2 });
    await a.post("/rooms/abc123/start");
    await a.post("/rooms/abc123/act", { move: { add: 10 } });
    await wait(60);
    const info = await (await a.send("/rooms/abc123")).json();
    expect(info.summary).toEqual({ total: 12 }); // 10, then a bot's 1 and the other bot's 1
    expect((await a.post("/rooms/abc123/act", { move: { add: 1 } })).status).toBe(200); // back to seat 0
  });

  it("a restarted server replays the move log", async () => {
    const log = memoryLog({ keep: "latest" });
    const first = setup(log);
    const a = first.browser();
    const b = first.browser();
    const c = first.browser();
    await a.post("/rooms", { options: { start: 0 } });
    await a.post("/rooms/abc123/sit", { seat: 0, name: "A" });
    await b.post("/rooms/abc123/sit", { seat: 1, name: "B" });
    await c.post("/rooms/abc123/sit", { seat: 2, name: "C" });
    await a.post("/rooms/abc123/start");
    await a.post("/rooms/abc123/act", { move: { add: 4 } });
    await b.post("/rooms/abc123/act", { move: { add: 6 } });
    await wait(20);

    // Same log, new process. C is still seated (cookies), and it's C's turn at total 10.
    const second = createRooms(counting, { log, botDelay: 5 });
    open.push(second);
    const response = await second.fetch(
      new Request(`${BASE}/rooms/abc123/act`, { method: "POST", headers: { cookie: (await cookieOf(c)) }, body: JSON.stringify({ move: { add: 1 } }) }),
    );
    expect(response!.status).toBe(200);
    const info = await (await second.fetch(new Request(`${BASE}/rooms/abc123`)))!.json();
    expect(info.summary).toEqual({ total: 11 });
  });
});

/** The cookie a test browser holds, read back from a request it sends. */
async function cookieOf(browser: { send: (path: string, init?: RequestInit) => Promise<Response> }) {
  let seen = "";
  const original = globalThis.Request;
  // The browser helper builds a Request with its cookie; capture it.
  globalThis.Request = class extends original {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init);
      seen = new Headers(init?.headers).get("cookie") ?? seen;
    }
  } as typeof Request;
  try {
    await browser.send("/rooms/abc123");
  } finally {
    globalThis.Request = original;
  }
  return seen;
}

describe("finished rooms", () => {
  it("are dropped from memory, and a request replays them from the log", async () => {
    const short: RoomDefinition<State, Move, any, { start: number }, { total: number }> = { ...counting, finished: (s) => s.total >= 3 };
    const rooms = createRooms(short, { botDelay: 5, seed: () => 1, id: () => "done01" });
    open.push(rooms as any);
    const send = (path: string, body?: unknown, cookie = "") =>
      rooms.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined }));
    expect(await rooms.create({ start: 0 })).toBe("done01");
    const sat = await send("/rooms/done01/sit", { seat: 0, name: "A" });
    const cookie = sat!.headers.get("set-cookie")!.split(";")[0]!;
    await send("/rooms/done01/bot", { seat: 1 }, cookie);
    await send("/rooms/done01/bot", { seat: 2 }, cookie);
    await send("/rooms/done01/start", {}, cookie);
    expect(rooms.inMemory).toBe(1);
    await send("/rooms/done01/act", { move: { add: 1 } }, cookie);
    await wait(60); // bots add 1 each: total 3, finished
    expect((await (await send("/rooms/done01"))!.json()).summary).toEqual({ total: 3 });
    expect(rooms.inMemory).toBe(0);
    // The next request rebuilds the state from the move log: the room still works.
    expect((await send("/rooms/done01/act", { move: { add: 1 } }, cookie))!.status).toBe(200);
  });
});
