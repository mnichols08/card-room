import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";

const BASE = "http://test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((a) => a.close());
  open = [];
});

function setup() {
  const clock = { now: 1_000_000 };
  const app = createCardRoom({ log: memoryLog({ keep: "latest" }), botDelay: 5, talk: false, lobby: { now: () => clock.now, quietAfter: 60_000 } });
  open.push(app);
  const phone = () => {
    let cookie = "";
    return async (path: string, body?: unknown) => {
      const r = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })))!;
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return { status: r.status, body: await r.json() };
    };
  };
  return { app, phone, clock };
}
const names = (t: { seats: { name: string | null }[] }) => t.seats.map((s) => s.name);

describe("the lobby", () => {
  it("finds players: the first waits at a new open table, the next ones join it, and the last seat deals", async () => {
    const { phone, clock } = setup();
    const grammi = phone();
    const rick = phone();
    const jimmy = phone();

    const first = await grammi("/lobby/join", { game: "hearts", name: "brokennil", seats: 3 });
    expect(first).toMatchObject({ status: 201, body: { seat: 0, waiting: true } });
    const id = first.body.id as string;
    expect((await rick("/rooms/" + id)).body).toMatchObject({ open: true, started: false, info: { game: "hearts" } });

    // Someone looking for a different game gets a table of their own.
    clock.now += 5000;
    const palace = await jimmy("/lobby/join", { game: "palace", name: "Jimmy", seats: 2 });
    expect(palace.body.waiting).toBe(true);
    expect(palace.body.id).not.toBe(id);

    const all = (await rick("/lobby")).body.tables;
    expect(all.map((t: { game: string }) => t.game)).toEqual(["hearts", "palace"]); // longest wait first
    expect(all[0]).toMatchObject({ id, rules: expect.any(String), created: 1_000_000, free: 2, seat: null });
    expect(names(all[0])).toEqual(["brokennil", null, null]);
    expect((await rick("/lobby?game=palace")).body.tables).toHaveLength(1);

    expect((await rick("/lobby/join", { game: "hearts", name: "Rick" })).body).toEqual({ id, seat: 1, waiting: false });
    // Asking twice puts you back at your table, not at a second one.
    expect((await rick("/lobby/join", { game: "hearts", name: "Rick" })).body).toEqual({ id, seat: 1, waiting: false });
    expect((await grammi("/lobby")).body.tables[0]).toMatchObject({ id, free: 1, seat: 0 });

    // The last seat: the game deals itself and leaves the list.
    const third = phone();
    expect((await third("/lobby/" + id + "/sit", { name: "Pappy" })).body).toEqual({ id, seat: 2 });
    expect((await third("/rooms/" + id)).body).toMatchObject({ started: true, open: false, seat: 2 });
    expect((await third("/lobby?game=hearts")).body.tables).toEqual([]);
    expect((await phone()("/lobby/" + id + "/sit", { name: "Late" })).status).toBe(404);
  });

  it("a family table can be opened to everyone, and closed again", async () => {
    const { phone } = setup();
    const host = phone();
    const guest = phone();
    const { id } = (await host("/rooms", { options: { game: "palace", seats: 3 } })).body;
    expect((await guest("/lobby/" + id + "/open", { open: true })).status).toBe(403); // not seated
    await host("/rooms/" + id + "/sit", { seat: 1, name: "Host" });
    expect((await guest("/lobby")).body.tables).toEqual([]);

    expect((await host("/lobby/" + id + "/open", { open: true })).body).toEqual({ open: true });
    expect((await guest("/lobby")).body.tables).toMatchObject([{ id, game: "palace", free: 2 }]);
    expect((await host("/lobby/" + id + "/open", { open: false })).body).toEqual({ open: false });
    expect((await guest("/lobby")).body.tables).toEqual([]);
    expect((await guest("/rooms/" + id)).body.open).toBe(false);

    // Open again; a bot and a guest who came by the invite link fill it, and it deals.
    await host("/lobby/" + id + "/open", { open: true });
    await host("/rooms/" + id + "/bot", { seat: 0, name: "Bot" });
    await guest("/rooms/" + id + "/sit", { seat: 2, name: "Guest" });
    await host("/lobby"); // waits its turn behind the deal
    expect((await guest("/rooms/" + id)).body).toMatchObject({ started: true });
    expect((await host("/lobby/" + id + "/open", { open: true })).status).toBe(409);
  });

  it("frees the seat of someone who went quiet, and drops a table nobody's waiting at", async () => {
    const { phone, clock } = setup();
    const a = phone();
    const b = phone();
    const { id } = (await a("/lobby/join", { game: "spades", name: "A" })).body;
    await b("/lobby/join", { game: "spades", name: "B" });
    expect((await a("/rooms/" + id)).body.info).toMatchObject({ game: "spades" });

    // A keeps saying they're here; B's phone went to sleep.
    clock.now += 50_000;
    expect((await a("/lobby/" + id + "/here", {})).body).toEqual({ ok: true, open: true });
    clock.now += 20_000;
    const [table] = (await phone()("/lobby")).body.tables;
    expect(names(table)).toEqual(["A", null, null, null]);
    expect((await b("/rooms/" + id)).body.seat).toBe(null);

    // Then A goes too: the table isn't listed any more, though it's still there for its link.
    clock.now += 61_000;
    expect((await phone()("/lobby")).body.tables).toEqual([]);
    expect((await phone()("/rooms/" + id)).body).toMatchObject({ open: false, started: false });
    // Looking for spades now starts a fresh table.
    expect((await phone()("/lobby/join", { game: "spades", name: "C" })).body).toMatchObject({ waiting: true, seat: 0 });
  });

  it("only the same rules, for a player who asks for that", async () => {
    const { phone } = setup();
    const host = phone();
    const picky = phone();
    const easy = phone();
    const { id } = (await host("/lobby/join", { game: "palace", name: "Host", seats: 3 })).body;

    // A different table size isn't the same game: picky waits at a table of their own.
    const own = (await picky("/lobby/join", { game: "palace", name: "Picky", seats: 4, sameRules: true })).body;
    expect(own).toMatchObject({ waiting: true, seat: 0 });
    expect(own.id).not.toBe(id);
    // Without the flag, the longest-waiting table will do.
    expect((await easy("/lobby/join", { game: "palace", name: "Easy", seats: 5 })).body).toEqual({ id, seat: 1, waiting: false });
    // Same rules and size under another name still match; a family table opened later matches too.
    const twin = phone();
    expect((await twin("/lobby/join", { game: "palace", name: "Twin", seats: 4, sameRules: true })).body).toEqual({ id: own.id, seat: 1, waiting: false });
    const family = phone();
    const made = (await family("/rooms", { options: { game: "gin" } })).body.id;
    await family("/rooms/" + made + "/sit", { seat: 0, name: "Fam" });
    await family("/lobby/" + made + "/open", { open: true });
    expect((await phone()("/lobby/join", { game: "gin", name: "G", sameRules: true })).body).toMatchObject({ id: made, waiting: false });
    // The fingerprint stays on the server.
    expect((await phone()("/lobby")).body.tables.every((t: object) => !("match" in t))).toBe(true);
  });

  it("turns down games for one, unknown games and a rush of new tables", async () => {
    const { phone } = setup();
    const a = phone();
    expect((await a("/lobby/join", { game: "klondike", name: "A" })).status).toBe(400);
    expect((await a("/lobby/join", { game: "tiddlywinks", name: "A" })).status).toBe(400);
    expect((await a("/lobby/join", { game: "gin", name: "A" })).status).toBe(201);
    // Already waiting for gin: back to the same table. Another game straight away: slow down.
    expect((await a("/lobby/join", { game: "gin", name: "A" })).status).toBe(200);
    expect((await a("/lobby/join", { game: "war", name: "A" })).status).toBe(429);
    // Pages can't read the lobby's own document through the sync log.
    const pulled = (await a("/_zb/sync/pull?since=0")).body.changes.map((c: { collection: string }) => c.collection);
    expect(pulled).not.toContain("lobby");
  });
});
