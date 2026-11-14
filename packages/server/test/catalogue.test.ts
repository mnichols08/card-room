// The catalogue (which games, in what order), the host's say over houses, and watching: tables of
// computer players anyone can read, and people's tables shown by their score alone.
import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";
import { COMPUTER_TABLES } from "../src/spectate.js";

const BASE = "http://test";
const TOKEN = "let-grammi-in";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
});

function setup() {
  const app = createCardRoom({ log: memoryLog({ keep: "latest" }), botDelay: 1, talk: false, adminToken: TOKEN });
  open.push(app);
  const phone = () => {
    let cookie = "";
    const send = async (path: string, body?: unknown) => {
      const r = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })))!;
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return { status: r.status, body: await r.json() };
    };
    return send;
  };
  const admin = async (path: string, body?: unknown) => {
    const r = (await app.fetch(new Request(`${BASE}/moderation${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` }, body: body ? JSON.stringify(body) : undefined })))!;
    return { status: r.status, body: await r.json() };
  };
  return { app, phone, admin };
}

const PALACE = { options: { game: "palace", rules: { id: "family-palace", name: "Family Palace" }, seats: 2 } };
const HEARTS = { options: { game: "hearts", rules: {}, seats: 4 } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const names = (games: { id: string }[]) => games.map((g) => g.id);

describe("the catalogue", () => {
  it("lists every game, switched on, until the host says otherwise", async () => {
    const { phone } = setup();
    const { body } = await phone()("/catalogue");
    expect(names(body.games).slice(0, 3)).toEqual(["spades", "palace", "hearts"]);
    expect(body.games.every((g: { on: boolean }) => g.on)).toBe(true);
    expect(body.games[0]).toMatchObject({ id: "spades", name: "Spades", seats: [4, 4], teams: true });
    expect(body.watching).toBe(true);
  });

  it("puts games in the host's order, with any they haven't placed after", async () => {
    const { phone, admin } = setup();
    expect((await admin("/games", { order: ["palace", "euchre", "nonsense", "palace"] })).status).toBe(200);
    const { games } = (await phone()("/catalogue")).body;
    expect(names(games).slice(0, 4)).toEqual(["palace", "euchre", "spades", "hearts"]);
    expect(new Set(names(games)).size).toBe(games.length);
  });

  it("a game that's switched off takes no new tables, anywhere; tables already going carry on", async () => {
    const { phone, admin } = setup();
    const grammi = phone();
    const going = (await grammi("/rooms", PALACE)).body.id;
    await grammi(`/rooms/${going}/sit`, { seat: 0, name: "brokennil" });
    const house = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body.slug;

    expect((await admin("/games", { off: ["palace"] })).body.games.find((g: { id: string }) => g.id === "palace").on).toBe(false);
    const refused = await grammi("/rooms", PALACE);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe("Palace is switched off in this card room.");
    expect((await grammi(`/houses/${house}/tables`, { game: "palace" })).status).toBe(403);
    expect((await grammi("/spectate", { game: "palace" })).status).toBe(403);
    // Other games are untouched, and the table that was open still takes players.
    expect((await grammi("/rooms", HEARTS)).status).toBe(201);
    expect((await phone()(`/rooms/${going}/sit`, { seat: 1, name: "Pappy" })).status).toBe(200);

    expect((await admin("/games", { off: [] })).status).toBe(200);
    expect((await grammi("/rooms", PALACE)).status).toBe(201);
  });

  it("won't switch every game off, and only the host changes it", async () => {
    const { phone, admin } = setup();
    const all = names((await phone()("/catalogue")).body.games);
    expect((await admin("/games", { off: all })).status).toBe(409);
    expect((await phone()("/catalogue", { off: ["spades"] })).status).toBe(404);
    expect((await phone()("/moderation/games", { off: ["spades"] })).status).toBe(401);
    expect((await admin("/log")).body.log).toEqual([]);
  });
});

describe("the host and houses", () => {
  async function house() {
    const kit = setup();
    const grammi = kit.phone();
    const rick = kit.phone();
    const made = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    expect((await rick(`/houses/${made.slug}/join`, { code: made.code, name: "Pappy" })).status).toBe(200);
    const listed = (await kit.admin("/houses")).body.houses[0];
    return { ...kit, grammi, rick, slug: made.slug as string, listed };
  }

  it("sees every house and its members, never a cookie", async () => {
    const { listed, slug } = await house();
    expect(listed).toMatchObject({ slug, name: "Grammi's House", tables: 0 });
    expect(listed.members.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([["brokennil", "owner"], ["Pappy", "member"]]);
    expect(listed.members[0].player).toMatch(/^[0-9a-f]{16}$/);
  });

  it("renames a house; its link stays the same", async () => {
    const { admin, grammi, slug } = await house();
    expect((await admin(`/houses/${slug}/rename`, { name: "  The Nichols House  " })).status).toBe(200);
    expect((await grammi(`/houses/${slug}`)).body.name).toBe("The Nichols House");
    expect((await admin(`/houses/${slug}/rename`, { name: "   " })).status).toBe(409);
    expect((await admin("/log")).body.log[0]).toMatchObject({ action: "Renamed a house", target: "Grammi's House", note: "Now “The Nichols House”" });
  });

  it("hands a house to another member: one owner, the old one an admin", async () => {
    const { admin, slug, listed } = await house();
    const pappy = listed.members[1].id;
    expect((await admin(`/houses/${slug}/owner`, { member: pappy })).status).toBe(200);
    const after = (await admin("/houses")).body.houses[0].members;
    expect(after.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([["brokennil", "admin"], ["Pappy", "owner"]]);
    expect((await admin(`/houses/${slug}/owner`, { member: "nobody" })).status).toBe(409);
  });

  it("removes a member, but never the owner", async () => {
    const { admin, rick, slug, listed } = await house();
    expect((await admin(`/houses/${slug}/remove-member`, { member: listed.members[0].id })).status).toBe(409);
    expect((await admin(`/houses/${slug}/remove-member`, { member: listed.members[1].id })).status).toBe(200);
    expect((await rick(`/houses/${slug}/tables`, {})).status).toBe(403);
    expect((await admin("/houses")).body.houses[0].members).toHaveLength(1);
  });

  it("deletes a house: gone for its members, and the name is free again", async () => {
    const { admin, grammi, slug } = await house();
    expect((await admin(`/houses/${slug}/delete`, {})).status).toBe(200);
    expect((await grammi(`/houses/${slug}`)).status).toBe(404);
    expect((await admin("/houses")).body.houses).toEqual([]);
    expect((await admin(`/houses/${slug}/rename`, { name: "Back" })).status).toBe(404);
    const again = await grammi("/houses", { name: "Grammi's House", you: "brokennil" });
    expect(again.status).toBe(201);
    expect(again.body.slug).toBe(slug);
    expect((await admin("/houses")).body.houses[0].members).toHaveLength(1);
  });
});

describe("watching", () => {
  it("starts a table of computer players that plays itself and anyone can read", async () => {
    const { app, phone } = setup();
    const visitor = phone();
    const made = await visitor("/spectate", { game: "hearts", skill: "hard", pace: "instant" });
    expect(made.status).toBe(201);
    const id = made.body.id as string;

    const room = (await visitor(`/rooms/${id}`)).body;
    expect(room).toMatchObject({ started: true, locked: true, watchable: true, label: "Computers playing Hearts", seat: null });
    expect(room.seats).toHaveLength(4);
    expect(room.seats.every((s: { bot: boolean; name: string }) => s.bot && s.name)).toBe(true);
    expect(new Set(room.seats.map((s: { name: string }) => s.name)).size).toBe(4);
    expect(room.settings).toMatchObject({ skill: "hard", pace: "instant" });

    // Nobody can sit down at it or play its cards.
    expect((await visitor(`/rooms/${id}/sit`, { seat: 0, name: "Me" })).status).toBe(409);
    expect((await visitor(`/rooms/${id}/act`, { move: {} })).status).toBe(403);

    // It plays on by itself.
    const before = (await visitor(`/rooms/${id}`)).body.version;
    await sleep(120);
    expect((await visitor(`/rooms/${id}`)).body.version).toBeGreaterThan(before);

    // Every seat's view is there for a watcher; a table with people keeps its views to its seats.
    const views = (await app.rooms.sync.documents()).all("views", `${id}/`);
    expect(views).toHaveLength(4);
    const listed = (await visitor("/spectate")).body;
    expect(listed.tables[0]).toMatchObject({ id, game: "hearts", gameName: "Hearts", computers: true });
    expect(listed.computerTables).toEqual({ going: 1, limit: COMPUTER_TABLES });
  });

  it("lets anyone read a computer table's hands, and nobody else's", async () => {
    const { app, phone } = setup();
    const grammi = phone();
    const computers = (await grammi("/spectate", { game: "palace", seats: 2 })).body.id as string;
    const family = (await grammi("/rooms", PALACE)).body.id as string;
    await grammi(`/rooms/${family}/sit`, { seat: 0, name: "brokennil" });
    await phone()(`/rooms/${family}/sit`, { seat: 1, name: "Pappy" });
    await grammi(`/rooms/${family}/start`, {});

    // Ask the sync log the way a stranger's browser would: with no cookie at all.
    const authorize = (collection: string, key: string) => readable(app, collection, key);
    expect(await authorize("views", `${computers}/0`)).toBe(true);
    expect(await authorize("views", `${computers}/1`)).toBe(true);
    expect(await authorize("views", `${family}/0`)).toBe(false);
    expect(await authorize("views", `${family}/1`)).toBe(false);
  });

  it("shows people's tables by what's already public, unless the host turns watching off", async () => {
    const { phone, admin } = setup();
    const grammi = phone();
    const id = (await grammi("/rooms", PALACE)).body.id as string;
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await phone()(`/rooms/${id}/sit`, { seat: 1, name: "Pappy" });
    // Not dealt yet: nothing to watch.
    expect((await phone()("/spectate")).body.tables).toEqual([]);
    await grammi(`/rooms/${id}/start`, {});

    const seen = (await phone()("/spectate")).body.tables;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id, computers: false, gameName: "Palace", seats: [{ name: "brokennil", bot: false }, { name: "Pappy", bot: false }] });
    expect(JSON.stringify(seen)).not.toMatch(/"hand"/);

    expect((await admin("/games", { watching: false })).body.watching).toBe(false);
    expect((await phone()("/spectate")).body).toMatchObject({ tables: [], watching: false });
    // The computers' tables can always be watched.
    await grammi("/spectate", { game: "war" });
    expect((await phone()("/spectate")).body.tables.map((t: { computers: boolean }) => t.computers)).toEqual([true]);

    // A closed table is nothing to watch.
    await admin("/games", { watching: true });
    await admin(`/tables/${id}/close`, {});
    expect((await phone()("/spectate")).body.tables.map((t: { id: string }) => t.id)).not.toContain(id);
  });

  it("keeps the computers to a few tables at a time", async () => {
    const { phone } = setup();
    const visitor = phone();
    expect((await visitor("/spectate", { game: "checkers" })).status).toBe(400);
    expect((await visitor("/spectate", { game: "spades" })).status).toBe(201);
    const soon = await visitor("/spectate", { game: "spades" });
    expect(soon.status).toBe(429);
    expect(soon.body.error).toMatch(/just started one/);
  });
});

/** Whether a browser with no cookie may read a document from the sync log. */
async function readable(app: ReturnType<typeof createCardRoom>, collection: string, key: string): Promise<boolean> {
  const url = `${BASE}/_zb/sync/pull?scope=${encodeURIComponent(JSON.stringify({ [collection]: key }))}`;
  const response = await app.fetch(new Request(url));
  const text = response ? await response.text() : "";
  return text.includes(`${key}`) && text.includes('"view"');
}
