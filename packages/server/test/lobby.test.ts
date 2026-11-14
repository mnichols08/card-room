import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";
import type { Notice } from "../src/push.js";

const BASE = "http://test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((a) => a.close());
  open = [];
});

function setup() {
  const clock = { now: 1_000_000 };
  const sent: { to: string; notice: Notice }[] = [];
  const app = createCardRoom({
    log: memoryLog({ keep: "latest" }),
    botDelay: 5,
    talk: false,
    push: { send: async (s, payload) => void sent.push({ to: s.endpoint, notice: JSON.parse(payload) }) },
    lobby: { now: () => clock.now, quietAfter: 60_000, alertGap: 600_000, blockedNames: ["sucks"] },
    admin: { key: "let-me-in-please" },
  });
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
  return { app, phone, clock, sent };
}
const sub = (n: number) => ({ endpoint: `https://push.example/phone-${n}`, keys: { p256dh: "BPkey", auth: "authkey" } });
const tick = () => new Promise((r) => setTimeout(r, 10));
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

  it("the host can remove a player before the deal, and they can't sit back down", async () => {
    const { phone } = setup();
    const host = phone();
    const pest = phone();
    const friend = phone();
    const { id } = (await host("/lobby/join", { game: "hearts", name: "Host", seats: 4 })).body;
    await pest("/lobby/" + id + "/sit", { name: "Pest" });
    await friend("/lobby/" + id + "/sit", { name: "Friend" });
    expect((await host("/rooms/" + id)).body).toMatchObject({ open: true, host: 0 });

    expect((await pest("/lobby/" + id + "/remove", { seat: 0 })).status).toBe(403); // not the host
    expect((await phone()("/lobby/" + id + "/remove", { seat: 1 })).status).toBe(403); // not even seated
    expect((await host("/lobby/" + id + "/remove", { seat: 0 })).status).toBe(400); // not yourself
    expect((await host("/lobby/" + id + "/remove", { seat: 1 })).body).toEqual({ ok: true });
    expect(names((await host("/lobby")).body.tables[0])).toEqual(["Host", null, "Friend", null]);

    // Not through the lobby, not by finding players (that opens a table of their own), not by the link.
    expect((await pest("/lobby/" + id + "/sit", { name: "Pest" })).status).toBe(403);
    const elsewhere = (await pest("/lobby/join", { game: "hearts", name: "Pest", seats: 4 })).body;
    expect(elsewhere).toMatchObject({ waiting: true });
    expect(elsewhere.id).not.toBe(id);
    await pest("/rooms/" + id + "/sit", { seat: 3, name: "Pest again" });
    const tables = (await host("/lobby")).body.tables;
    expect(names(tables.find((t: { id: string }) => t.id === id))).toEqual(["Host", null, "Friend", null]);
    expect(tables.every((t: object) => !("removed" in t) && !("host" in t))).toBe(true); // player ids stay on the server

    // The host leaves: the next player runs the table.
    await host("/rooms/" + id + "/stand", {});
    await friend("/lobby");
    expect((await friend("/rooms/" + id)).body).toMatchObject({ open: true, host: 2 });
  });

  it("keeps crude names off open tables", async () => {
    const { phone } = setup();
    const a = phone();
    expect((await a("/lobby/join", { game: "hearts", name: "sh1t head" })).body).toEqual({ error: "Pick a different name for an open table." });
    expect((await a("/lobby/join", { game: "hearts", name: "Grammi Sucks" })).status).toBe(400); // the owner's own word
    const { id } = (await a("/lobby/join", { game: "hearts", name: "A" })).body;
    expect((await phone()("/lobby/" + id + "/sit", { name: "F.U.C.K" })).status).toBe(400);
    // By the table's link the name isn't checked on the way in, so the lobby renames it.
    await phone()("/rooms/" + id + "/sit", { seat: 2, name: "fuuuck" });
    expect(names((await a("/lobby")).body.tables[0]).slice(0, 3)).toEqual(["A", null, "Player"]);

    // A family table keeps its names until it's opened to everyone.
    const fam = phone();
    const made = (await fam("/rooms", { options: { game: "palace", seats: 3 } })).body.id;
    await fam("/rooms/" + made + "/sit", { seat: 0, name: "Big Shit" });
    expect((await fam("/rooms/" + made)).body.seats[0].name).toBe("Big Shit");
    await fam("/lobby/" + made + "/open", { open: true });
    expect((await fam("/rooms/" + made)).body.seats[0].name).toBe("Player");
  });

  it("buzzes the players who asked to hear when a table opens for their game", async () => {
    const { phone, sent, clock } = setup();
    const grammi = phone();
    const anyone = phone();
    expect((await grammi("/lobby/alerts")).body).toEqual({ games: [], notifications: true });
    expect((await grammi("/lobby/alerts", { games: ["spades", "tiddlywinks"] })).body).toEqual({ games: ["spades"], notifications: true });
    await grammi("/push/subscribe", { subscription: sub(1) });
    await anyone("/lobby/alerts", { games: ["any"] });
    await anyone("/push/subscribe", { subscription: sub(2) });
    expect((await grammi("/lobby/alerts")).body.games).toEqual(["spades"]);

    await phone()("/lobby/join", { game: "palace", name: "Jimmy" });
    await tick();
    expect(sent.map((s) => s.to)).toEqual([sub(2).endpoint]); // not spades: grammi isn't bothered

    const rick = phone();
    const { id } = (await rick("/lobby/join", { game: "spades", name: "Rick" })).body;
    await tick();
    // "Any game" was buzzed a moment ago, so it waits; grammi hears about spades.
    expect(sent.slice(1)).toEqual([{ to: sub(1).endpoint, notice: { title: "Rick is looking for Spades players ♠️", body: expect.stringContaining("3 seats open"), url: "/?lobby=1", tag: "lobby" } }]);

    // Opening your own table doesn't buzz you, and a second table soon after doesn't buzz anyone.
    clock.now += 700_000;
    sent.length = 0;
    await grammi("/lobby/join", { game: "spades", name: "brokennil", sameRules: true, rules: { playTo: 250 } });
    await tick();
    expect(sent.map((s) => s.to)).toEqual([sub(2).endpoint]);
    expect(id).toBeTruthy();

    // Asking for nothing turns it off.
    await anyone("/lobby/alerts", { games: [] });
    clock.now += 700_000;
    sent.length = 0;
    await phone()("/lobby/join", { game: "gin", name: "G" });
    await tick();
    expect(sent).toEqual([]);
    // The list of who asked stays on the server.
    const pulled = (await grammi("/_zb/sync/pull?since=0")).body.changes.map((c: { collection: string }) => c.collection);
    expect(pulled).not.toContain("lobby");
  });

  it("after the deal the host can still remove a player (a bot plays on) and mute one, and chat is filtered", async () => {
    const { phone } = setup();
    const host = phone();
    const pest = phone();
    const friend = phone();
    const { id } = (await host("/lobby/join", { game: "palace", name: "Host", seats: 3 })).body;
    await pest("/lobby/" + id + "/sit", { name: "Pest" });
    await friend("/lobby/" + id + "/sit", { name: "Friend" }); // the last seat deals
    expect((await host("/rooms/" + id)).body).toMatchObject({ started: true, open: false, host: 0 });
    expect((await host("/lobby")).body.tables).toEqual([]);

    // Crude words are covered; a muted player can't chat; the host can't be muted by a guest.
    expect((await pest("/rooms/" + id + "/say", { text: "you sh1t players" })).body).toMatchObject({ text: "you •••• players" });
    expect((await pest("/lobby/" + id + "/mute", { seat: 0 })).status).toBe(403);
    expect((await host("/lobby/" + id + "/mute", { seat: 1 })).body).toEqual({ muted: true });
    expect((await host("/rooms/" + id)).body.muted).toEqual([1]);
    await new Promise((r) => setTimeout(r, 450));
    expect((await pest("/rooms/" + id + "/say", { text: "hello?" })).body).toEqual({ error: "You've been muted at this table." });
    expect((await host("/lobby/" + id + "/mute", { seat: 1, muted: false })).body).toEqual({ muted: false });
    expect((await pest("/rooms/" + id + "/say", { text: "hello again" })).status).toBe(200);

    // Removed mid-game: a computer player has the seat, and the game goes on.
    expect((await host("/lobby/" + id + "/remove", { seat: 1 })).body).toEqual({ ok: true });
    const room = (await pest("/rooms/" + id)).body;
    expect(room).toMatchObject({ started: true, seat: null, host: 0 });
    expect(room.seats[1]).toMatchObject({ bot: true });
    expect(room.seats[1].name).not.toBe("Pest");
    expect((await pest("/rooms/" + id + "/sit", { seat: 1, name: "Pest" })).status).toBe(409);
    expect((await pest("/rooms/" + id + "/say", { text: "let me in" })).status).toBe(403);
    // A family table that was never open keeps its own way of talking, and has no host.
    const fam = phone();
    const made = (await fam("/rooms", { options: { game: "gin" } })).body.id;
    await fam("/rooms/" + made + "/sit", { seat: 0, name: "Fam" });
    expect((await fam("/rooms/" + made + "/say", { text: "well shit" })).body).toMatchObject({ text: "well shit" });
    expect((await fam("/lobby/" + made + "/mute", { seat: 0 })).status).toBe(404);
  });
});
