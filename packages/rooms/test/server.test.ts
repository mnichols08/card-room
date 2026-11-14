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

  it("lets a player stand up before the deal, and tells the app whenever the seats change", async () => {
    const changes: (string | null)[][] = [];
    const rooms = createRooms(counting, { log: memoryLog({ keep: "latest" }), id: () => "abc123", onSeats: ({ room }) => changes.push(room.seats.map((s) => s.name)) });
    open.push(rooms);
    const browser = () => {
      let cookie = "";
      return async (path: string, body: unknown = {}) => {
        const r = (await rooms.fetch(new Request(BASE + path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", cookie } })))!;
        const set = r.headers.get("set-cookie");
        if (set) cookie = set.split(";")[0]!;
        return { status: r.status, body: await r.json() };
      };
    };
    const a = browser();
    const b = browser();
    await a("/rooms", { options: { start: 0 } });
    expect((await a("/rooms/abc123/stand")).status).toBe(403); // not seated
    await a("/rooms/abc123/sit", { seat: 0, name: "A" });
    await b("/rooms/abc123/sit", { seat: 1, name: "B" });
    await a("/rooms/abc123/bot", { seat: 2, name: "Bot" });
    expect((await b("/rooms/abc123/stand")).status).toBe(200);
    expect(changes).toEqual([["A", null, null], ["A", "B", null], ["A", "B", "Bot"], ["A", null, "Bot"]]);
    expect(await rooms.holders("abc123")).toEqual([expect.any(String), null, null]);
    expect((await b("/rooms/abc123/act", { move: { add: 1 } })).status).toBe(403); // B no longer holds a seat

    // The seat is free for someone else; once the game starts nobody can stand.
    await b("/rooms/abc123/sit", { seat: 1, name: "B again" });
    await a("/rooms/abc123/start");
    expect((await b("/rooms/abc123/stand")).status).toBe(409);
    expect(await rooms.unseat("abc123", 1)).toBe(false);
  });

  it("a bot can take over a person's seat mid-game, and chat can be checked on the way in", async () => {
    const rooms = createRooms(counting, {
      log: memoryLog({ keep: "latest" }),
      botDelay: 5,
      id: () => "abc123",
      beforeSay: ({ seat, text }) => (seat === 1 ? { error: "Muted." } : text.replace("darn", "****")),
    });
    open.push(rooms);
    const browser = () => {
      let cookie = "";
      return async (path: string, body?: unknown) => {
        const r = (await rooms.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json", cookie } })))!;
        const set = r.headers.get("set-cookie");
        if (set) cookie = set.split(";")[0]!;
        return { status: r.status, body: await r.json() };
      };
    };
    const a = browser();
    const b = browser();
    const c = browser();
    await a("/rooms", { options: { start: 0 } });
    await a("/rooms/abc123/sit", { seat: 0, name: "A" });
    await b("/rooms/abc123/sit", { seat: 1, name: "B" });
    await c("/rooms/abc123/sit", { seat: 2, name: "C" });
    await a("/rooms/abc123/start", {});
    expect((await a("/rooms/abc123/say", { text: "well darn" })).body).toMatchObject({ text: "well ****" });
    expect((await b("/rooms/abc123/say", { text: "hello" })).body).toEqual({ error: "Muted." });

    // It's B's turn after A; B is replaced, and the bot makes B's move.
    await a("/rooms/abc123/act", { move: { add: 5 } });
    expect(await rooms.replaceWithBot("abc123", 1, "Robo")).toBe(true);
    await wait(60);
    const info = (await b("/rooms/abc123")).body;
    expect(info).toMatchObject({ seat: null, summary: { total: 6 } });
    expect(info.seats[1]).toEqual({ name: "Robo", bot: true });
    expect((await b("/rooms/abc123/act", { move: { add: 1 } })).status).toBe(403);
    expect((await b("/rooms/abc123/sit", { seat: 1, name: "B" })).status).toBe(409);
    expect((await c("/rooms/abc123/act", { move: { add: 1 } })).status).toBe(200);
    expect(await rooms.replaceWithBot("abc123", 1, "Again")).toBe(false);
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

describe("chat", () => {
  it("seated players talk; everyone at the table reads it; strangers can't post", async () => {
    const { browser, rooms } = setup();
    const a = browser();
    const b = browser();
    const stranger = browser();
    await a.post("/rooms", { options: { start: 0 } });
    await a.post("/rooms/abc123/sit", { seat: 0, name: "brokennil" });
    await b.post("/rooms/abc123/sit", { seat: 1, name: "Rick" });
    await a.post("/rooms/abc123/bot", { seat: 2, name: "Dot" });

    expect((await a.post("/rooms/abc123/say", { text: "  good luck  ♠️ " })).body).toMatchObject({ seat: 0, name: "brokennil", text: "good luck ♠️", bot: false });
    expect((await stranger.post("/rooms/abc123/say", { text: "hi" })).status).toBe(403);
    expect((await b.post("/rooms/abc123/say", { text: "   " })).status).toBe(400);
    const long = await b.post("/rooms/abc123/say", { text: "x".repeat(1000) });
    expect(long.body.text).toHaveLength(280);
    expect(await rooms.say("abc123", 2, "🎉")).toMatchObject({ seat: 2, name: "Dot", bot: true });

    const said = (await stranger.pull()).filter((c) => c.collection === "chat").map((c) => [c.field, c.value.text]);
    expect(said).toEqual([
      ["m000000", "good luck ♠️"],
      ["m000001", "x".repeat(280)],
      ["m000002", "🎉"],
    ]);
  });

  it("slows down a player who sends too fast", async () => {
    const { browser } = setup();
    const a = browser();
    await a.post("/rooms", { options: { start: 0 } });
    await a.post("/rooms/abc123/sit", { seat: 0, name: "A" });
    expect((await a.post("/rooms/abc123/say", { text: "one" })).status).toBe(200);
    expect((await a.post("/rooms/abc123/say", { text: "two" })).status).toBe(429);
    await wait(450);
    expect((await a.post("/rooms/abc123/say", { text: "three" })).status).toBe(200);
  });

  it("numbers messages after a restart without overwriting old ones", async () => {
    const log = memoryLog({ keep: "latest" });
    const first = setup(log);
    const a = first.browser();
    await a.post("/rooms", { options: { start: 0 } });
    await a.post("/rooms/abc123/sit", { seat: 0, name: "A" });
    await a.post("/rooms/abc123/say", { text: "before" });
    await wait(10);
    const second = createRooms(counting, { log, botDelay: 5 });
    open.push(second);
    await second.say("abc123", 0, "after");
    const pulled = (await (await second.fetch(new Request(`${BASE}/_zb/sync/pull?since=0`)))!.json()).changes.filter((c: { collection: string }) => c.collection === "chat");
    expect(pulled.map((c: { field: string; value: { text: string } }) => [c.field, c.value.text])).toEqual([
      ["m000000", "before"],
      ["m000001", "after"],
    ]);
  });
});

describe("table settings", () => {
  // The counting game with settings: `step` is how much a bot adds, `wait` how long it takes.
  const seen: { settings: unknown; delay: number }[] = [];
  const withSettings: typeof counting = {
    ...counting,
    settings: (given) => {
      const g = (given ?? {}) as { step?: unknown; wait?: unknown };
      return { step: Number.isInteger(g.step) ? g.step : 1, wait: g.wait === "slow" ? "slow" : "fast" };
    },
    bot: (state, seat, _name, settings) => (state.turn === seat ? { add: settings.step } : null),
    botDelay: (_state, _seat, _name, settings) => {
      const delay = settings.wait === "slow" ? 400 : 5;
      seen.push({ settings, delay });
      return delay;
    },
  };

  it("are kept with the room, public, passed to the bots, and changed mid-game by anyone seated", async () => {
    const rooms = createRooms(withSettings, { log: memoryLog({ keep: "latest" }), seed: () => 1, id: () => "set123" });
    open.push(rooms);
    let cookie = "";
    const post = async (path: string, body: unknown = {}, as = cookie) => {
      const r = (await rooms.fetch(new Request(BASE + path, { method: "POST", headers: { "content-type": "application/json", cookie: as }, body: JSON.stringify(body) })))!;
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return { status: r.status, body: await r.json() };
    };
    const info = async () => (await rooms.fetch(new Request(`${BASE}/rooms/set123`, { headers: { cookie } })))!.json();

    await post("/rooms", { options: { start: 0 }, settings: { step: 5, wait: "slow", nonsense: true } });
    expect((await info()).settings).toEqual({ step: 5, wait: "slow" });
    await post("/rooms/set123/sit", { seat: 0, name: "A" });
    await post("/rooms/set123/bot", { seat: 1 });
    await post("/rooms/set123/bot", { seat: 2 });
    await post("/rooms/set123/start");
    await post("/rooms/set123/act", { move: { add: 1 } });
    await wait(30);
    expect((await info()).summary).toEqual({ total: 1 }); // the slow bot is still thinking

    // Speeding up mid-game: the waiting bot starts over at the new pace, and adds the new step.
    expect((await post("/rooms/set123/settings", { settings: { step: 2, wait: "fast" } }, "rooms_player=stranger")).status).toBe(403);
    expect((await post("/rooms/set123/settings", { settings: { step: 2, wait: "fast" } })).body).toEqual({ settings: { step: 2, wait: "fast" } });
    await wait(60);
    expect((await info()).summary).toEqual({ total: 5 }); // 1, then 2 and 2
    expect(seen.at(-1)!.settings).toEqual({ step: 2, wait: "fast" });
  });
});

describe("the player cookie", () => {
  it("is HttpOnly always, and Secure when the browser came over HTTPS (directly or through a proxy)", async () => {
    const sit = async (url: string, headers: Record<string, string> = {}) => {
      const rooms = createRooms(counting, { botDelay: 5, seed: () => 1, id: () => "cook01" });
      open.push(rooms as any);
      await rooms.create({ start: 0 });
      const r = await rooms.fetch(new Request(url + "/rooms/cook01/sit", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ seat: 0, name: "A" }) }));
      return r!.headers.get("set-cookie")!;
    };
    const plain = await sit("http://localhost:8787");
    expect(plain).toContain("HttpOnly");
    expect(plain).not.toContain("Secure");
    expect(await sit("https://cards.example")).toContain("; Secure");
    expect(await sit("http://internal:8080", { "x-forwarded-proto": "https" })).toContain("; Secure");
    expect(await sit("https://cards.example", { "x-forwarded-proto": "http" })).not.toContain("Secure");
  });
});
