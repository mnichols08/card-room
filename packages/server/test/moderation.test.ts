// Moderation and card designs: the admin sees tables and people (never anyone's cookie), closes
// tables, removes players and chat, blocks players and hides designs; makers keep designs for
// themselves or share them with everyone.
import { CLASSIC, STARTERS } from "@cardroom/decks";
import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";
import { BLOCKED_MESSAGE, playerRef } from "../src/moderation.js";

const BASE = "http://test";
const TOKEN = "let-grammi-in";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
});

function setup(adminToken: string | undefined = TOKEN) {
  const app = createCardRoom({ log: memoryLog({ keep: "latest" }), botDelay: 1, talk: false, adminToken });
  open.push(app);
  const phone = () => {
    let cookie = "";
    const send = async (path: string, body?: unknown) => {
      const r = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })))!;
      const set = r.headers.get("set-cookie");
      if (set) cookie = set.split(";")[0]!;
      return { status: r.status, body: await r.json(), text: "" };
    };
    return Object.assign(send, { cookie: () => cookie.split("=")[1] ?? "" });
  };
  const admin = async (path: string, body?: unknown, token: string | null = TOKEN) => {
    const r = (await app.fetch(
      new Request(`${BASE}/moderation${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }),
    ))!;
    return { status: r.status, body: await r.json() };
  };
  return { app, phone, admin };
}

const PALACE = { options: { game: "palace", rules: { id: "family-palace", name: "Family Palace" }, seats: 2 } };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A two-seat Palace table with two people sitting at it. */
async function tableFor(a: ReturnType<ReturnType<typeof setup>["phone"]>, b: ReturnType<ReturnType<typeof setup>["phone"]>) {
  const id = (await a("/rooms", PALACE)).body.id as string;
  expect((await a(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" })).status).toBe(200);
  expect((await b(`/rooms/${id}/sit`, { seat: 1, name: "Rowdy" })).status).toBe(200);
  return id;
}

describe("moderation", () => {
  it("is off without an admin token, and shut to anyone without the right one", async () => {
    const off = setup("");
    expect(off.app.moderation.enabled).toBe(false);
    expect((await off.admin("/overview")).status).toBe(503);

    const { admin } = setup();
    expect((await admin("/overview", undefined, null)).status).toBe(401);
    expect((await admin("/overview", undefined, "guess")).status).toBe(401);
    expect((await admin("/tables", undefined, "guess")).body).toEqual({ error: "That isn't this card room's admin token." });
    expect((await admin("/overview")).status).toBe(200);
  });

  it("stops guessing at the token", async () => {
    const { admin } = setup();
    for (let i = 0; i < 20; i++) expect((await admin("/overview", undefined, `guess-${i}`)).status).toBe(401);
    expect((await admin("/overview", undefined, "one-more")).status).toBe(429);
    // Even the right token waits: the limit is on the door, not on who's knocking.
    expect((await admin("/overview")).status).toBe(429);
  });

  it("shows tables and people, and never anyone's cookie", async () => {
    const { phone, admin } = setup();
    const grammi = phone();
    const rowdy = phone();
    const id = await tableFor(grammi, rowdy);
    await grammi("/houses", { name: "Grammi's House", you: "brokennil" });

    const overview = (await admin("/overview")).body;
    expect(overview).toMatchObject({ tables: { total: 1, open: 1, playing: 0 }, players: 2, blocked: 0, houses: 1 });

    const tables = (await admin("/tables")).body.tables;
    expect(tables).toHaveLength(1);
    expect(tables[0]).toMatchObject({ id, game: "palace", gameName: "Palace", rules: "Family Palace", status: "open" });
    expect(tables[0].seats.map((s: { name: string }) => s.name)).toEqual(["brokennil", "Rowdy"]);
    expect(tables[0].seats[0].player).toBe(playerRef(grammi.cookie()));

    const players = (await admin("/players")).body.players;
    const her = players.find((p: { name: string }) => p.name === "brokennil");
    expect(her).toMatchObject({ ref: playerRef(grammi.cookie()), seated: 1, houses: [{ slug: "grammis-house", name: "Grammi's House", role: "owner" }], ban: null });

    const everything = JSON.stringify([overview, tables, players, (await admin(`/tables/${id}`)).body]);
    expect(everything).not.toContain(grammi.cookie());
    expect(everything).not.toContain(rowdy.cookie());
  });

  it("closes a table: nobody sits, moves or talks there again, and it says why", async () => {
    const { phone, admin } = setup();
    const grammi = phone();
    const rowdy = phone();
    const id = await tableFor(grammi, rowdy);
    expect((await grammi(`/rooms/${id}/start`, {})).status).toBe(200);

    expect((await admin(`/tables/${id}/close`, { reason: "Keep it friendly." })).status).toBe(200);
    expect((await admin(`/tables/${id}/close`, {})).status).toBe(409);
    expect((await grammi(`/rooms/${id}`)).body.closed).toBe("Keep it friendly.");
    for (const path of ["act", "say", "sit", "start"]) {
      const r = await rowdy(`/rooms/${id}/${path}`, { move: { type: "ready" }, text: "hi", seat: 1 });
      expect(r.status, path).toBe(410);
      expect(r.body.error).toBe("Keep it friendly.");
    }
    expect((await admin("/tables")).body.tables[0].status).toBe("closed");
    expect((await admin("/tables/nosuch/close", {})).status).toBe(404);
    expect((await admin("/log")).body.log[0]).toMatchObject({ action: "Closed a table", note: "Keep it friendly." });
  });

  it("takes a player out of a seat: free before the deal, a bot after", async () => {
    const { phone, admin } = setup();
    const grammi = phone();
    const rowdy = phone();
    const open = await tableFor(grammi, rowdy);
    expect((await admin(`/tables/${open}/unseat`, { seat: 1 })).status).toBe(200);
    expect((await grammi(`/rooms/${open}`)).body.seats[1]).toEqual({ name: null, bot: false });
    expect((await rowdy(`/rooms/${open}`)).body.seat).toBeNull();
    expect((await admin(`/tables/${open}/unseat`, { seat: 1 })).status).toBe(409);

    const going = await tableFor(grammi, rowdy);
    await grammi(`/rooms/${going}/start`, {});
    expect((await admin(`/tables/${going}/unseat`, { seat: 1 })).status).toBe(200);
    expect((await grammi(`/rooms/${going}`)).body.seats[1]).toEqual({ name: "Bot", bot: true });
    expect((await rowdy(`/rooms/${going}/act`, { move: { type: "ready" } })).status).toBe(403);
  });

  it("removes a chat message's words", async () => {
    const { phone, admin } = setup();
    const grammi = phone();
    const rowdy = phone();
    const id = await tableFor(grammi, rowdy);
    await rowdy(`/rooms/${id}/say`, { text: "something unkind" });
    const chat = (await admin(`/tables/${id}`)).body.chat;
    expect(chat).toHaveLength(1);
    expect(chat[0]).toMatchObject({ name: "Rowdy", text: "something unkind" });

    expect((await admin(`/tables/${id}/redact`, { key: chat[0].key })).status).toBe(200);
    expect((await admin(`/tables/${id}`)).body.chat[0]).toMatchObject({ name: "Rowdy", text: "(removed by a moderator)", removed: true });
    expect((await admin(`/tables/${id}/redact`, { key: "m999999" })).status).toBe(404);
    expect((await admin(`/tables/${id}/redact`, { key: "seats" })).status).toBe(404);
  });

  it("blocks a player: out of their seats, and nothing they do lands until they're unblocked", async () => {
    const { phone, admin } = setup();
    const grammi = phone();
    const rowdy = phone();
    const id = await tableFor(grammi, rowdy);
    await grammi(`/rooms/${id}/start`, {});
    const ref = playerRef(rowdy.cookie());

    expect((await admin(`/players/${ref}/block`, { reason: "Unkind at the table" })).status).toBe(200);
    // A bot plays their seat on, so Grammi's game isn't stuck.
    expect((await grammi(`/rooms/${id}`)).body.seats[1]).toEqual({ name: "Bot", bot: true });

    for (const [path, body] of [["/rooms", PALACE], [`/rooms/${id}/say`, { text: "hi" }], ["/houses", { name: "Rowdy's" }], ["/designs", { design: CLASSIC }], ["/challenges/mine", { enabled: true }]] as const) {
      const r = await rowdy(path, body);
      expect(r.status, path).toBe(403);
      expect(r.body.error).toBe(BLOCKED_MESSAGE);
    }
    // Looking is still allowed, and nobody else is affected.
    expect((await rowdy("/designs")).status).toBe(200);
    expect((await grammi(`/rooms/${id}/say`, { text: "that's better" })).status).toBe(200);

    const listed = (await admin("/players")).body.players[0];
    expect(listed).toMatchObject({ ref, name: "Rowdy", ban: { reason: "Unkind at the table", name: "Rowdy" } });
    expect((await admin("/overview")).body.blocked).toBe(1);

    expect((await admin(`/players/${ref}/unblock`, {})).status).toBe(200);
    expect((await admin(`/players/${ref}/unblock`, {})).status).toBe(409);
    expect((await rowdy("/rooms", PALACE)).status).toBe(201);
    expect((await admin("/players/0000000000000000/block", {})).status).toBe(404);
    expect((await admin("/log")).body.log.map((e: { action: string }) => e.action)).toEqual(["Unblocked a player", "Blocked a player"]);
  });

  it("turns a blocked player away from the rooms kit's own handler too", async () => {
    const { app, phone, admin } = setup();
    const rowdy = phone();
    const id = (await rowdy("/rooms", PALACE)).body.id;
    await rowdy(`/rooms/${id}/sit`, { seat: 0, name: "Rowdy" });
    await admin(`/players/${playerRef(rowdy.cookie())}/block`, {});
    // Node's http path: index.ts hands /rooms straight to the kit, so the block has to come first.
    let status = 0;
    let body = "";
    const req = Object.assign((async function* () {})(), { url: `/rooms/${id}/say`, method: "POST", headers: { cookie: `rooms_player=${rowdy.cookie()}` } });
    const res = { writeHead: (s: number) => void (status = s), end: (b: Buffer) => void (body = b.toString()) };
    expect(await app.handle(req as never, res as never)).toBe(true);
    expect(status).toBe(403);
    expect(JSON.parse(body).error).toBe(BLOCKED_MESSAGE);
  });
});

describe("card designs", () => {
  it("keeps a design for its maker, or shares it with everyone", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();

    const fun = await grammi("/designs", { design: { ...STARTERS[3], name: "Just for me" }, author: "Grammi" });
    expect(fun.status).toBe(201);
    expect(fun.body).toMatchObject({ author: "Grammi", shared: false, mine: true, design: { name: "Just for me" } });
    expect((await rick("/designs")).body.designs).toEqual([]);
    expect((await rick(`/designs/${fun.body.id}`)).status).toBe(404);
    expect((await grammi("/designs/mine")).body.designs).toHaveLength(1);

    await sleep(5);
    const shared = await rick("/designs", { design: { ...STARTERS[1], name: "Pappy's deck" }, author: "Rick", shared: true });
    expect(shared.status).toBe(201);
    const gallery = (await grammi("/designs")).body.designs;
    expect(gallery).toHaveLength(1);
    expect(gallery[0]).toMatchObject({ id: shared.body.id, author: "Rick", mine: false, design: { name: "Pappy's deck" } });
    expect(JSON.stringify(gallery)).not.toContain(rick.cookie());
    expect((await grammi(`/designs/${shared.body.id}`)).status).toBe(200);

    // Sharing later, then taking it back.
    expect((await grammi(`/designs/${fun.body.id}`, { shared: true })).body.shared).toBe(true);
    expect((await rick("/designs")).body.designs).toHaveLength(2);
    expect((await grammi(`/designs/${fun.body.id}`, { shared: false })).body.shared).toBe(false);
    expect((await rick("/designs")).body.designs).toHaveLength(1);
  });

  it("only a design's maker changes or deletes it", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const made = (await grammi("/designs", { design: CLASSIC, shared: true })).body;
    expect((await rick(`/designs/${made.id}`, { design: { ...CLASSIC, name: "Mine now" } })).status).toBe(403);
    expect((await rick(`/designs/${made.id}/delete`, {})).status).toBe(403);
    expect((await grammi(`/designs/${made.id}`, { design: { ...CLASSIC, name: "Sunday best" } })).body.design.name).toBe("Sunday best");
    expect((await grammi(`/designs/${made.id}/delete`, {})).status).toBe(200);
    expect((await rick("/designs")).body.designs).toEqual([]);
    expect((await grammi(`/designs/${made.id}`)).status).toBe(404);
  });

  it("stores only what a design is, and refuses decks nobody could play with", async () => {
    const { phone } = setup();
    const grammi = phone();
    const odd = await grammi("/designs", { design: { name: "<b>Bold</b>", back: { pattern: "nope", color: "red; } body { display: none" }, face: { font: "comic" }, extra: 1 }, author: "  Grammi\n\n  " });
    expect(odd.status).toBe(201);
    expect(odd.body.design).toEqual({ ...CLASSIC, name: "<b>Bold</b>" }); // a name is text, shown as text
    expect(odd.body.author).toBe("Grammi");

    await sleep(5);
    const faint = await grammi("/designs", { design: { ...CLASSIC, face: { ...CLASSIC.face, black: "#f5f0e6" } } });
    expect(faint.status).toBe(400);
    expect(faint.body.error).toMatch(/too faint/);
    expect((await grammi("/designs", {})).status).toBe(400);
  });

  it("the admin hides a shared design; its maker sees why; restoring brings it back", async () => {
    const { phone, admin } = setup();
    const rowdy = phone();
    const grammi = phone();
    const made = (await rowdy("/designs", { design: { ...CLASSIC, name: "Rude words" }, author: "Rowdy", shared: true })).body;

    const listed = (await admin("/designs")).body.designs;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: made.id, author: "Rowdy", hidden: "", player: playerRef(rowdy.cookie()) });

    expect((await admin(`/designs/${made.id}/hide`, { reason: "Not for a family card room." })).status).toBe(200);
    expect((await grammi("/designs")).body.designs).toEqual([]);
    expect((await grammi(`/designs/${made.id}`)).status).toBe(404);
    expect((await rowdy("/designs/mine")).body.designs[0]).toMatchObject({ id: made.id, hidden: "Not for a family card room." });
    expect((await admin("/overview")).body.designs).toEqual({ total: 1, shared: 0, hidden: 1 });

    expect((await admin(`/designs/${made.id}/restore`, {})).status).toBe(200);
    expect((await grammi("/designs")).body.designs).toHaveLength(1);
    expect((await rowdy("/designs/mine")).body.designs[0]).not.toHaveProperty("hidden");
    expect((await admin("/designs/nosuch/hide", {})).status).toBe(404);
  });

  it("a table wears a deck everyone at it sees, kept as it was when it was chosen", async () => {
    const { phone, admin } = setup();
    const grammi = phone();
    const rick = phone();
    const pearl = phone();
    const stranger = phone();
    const shared = (await pearl("/designs", { design: { ...STARTERS[1], name: "Pearl's deck" }, author: "Pearl", shared: true })).body;
    const secret = (await rick("/designs", { design: { ...STARTERS[2], name: "Not yet" } })).body;
    const id = (await grammi("/rooms", PALACE)).body.id as string;

    // Only someone seated chooses, and only a deck they could show everyone.
    expect((await grammi(`/designs/table/${id}`, { design: shared.id })).status).toBe(403);
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    expect((await stranger(`/designs/table/${id}`, { design: shared.id })).status).toBe(403);
    expect((await grammi(`/designs/table/${id}`, { design: secret.id })).status).toBe(404);
    expect((await grammi(`/designs/table/${id}`, { design: "nosuchid" })).status).toBe(404);
    expect((await grammi("/designs/table/nosuch", { design: shared.id })).status).toBe(404);
    expect((await grammi(`/designs/table/${id}`, {})).status).toBe(400);

    const set = await grammi(`/designs/table/${id}`, { design: shared.id });
    expect(set.status).toBe(200);
    expect(set.body.deck).toEqual({ id: shared.id, author: "Pearl", design: { ...STARTERS[1], name: "Pearl's deck" } });
    // Everyone who opens the table gets it with the room, a stranger included.
    expect((await stranger(`/rooms/${id}`)).body.deck).toEqual(set.body.deck);
    expect(JSON.stringify((await stranger(`/rooms/${id}`)).body)).not.toContain(pearl.cookie());

    // The maker changes it, the host hides it, the maker deletes it: the table's cards stay as chosen.
    await pearl(`/designs/${shared.id}`, { design: { ...STARTERS[4], name: "Changed my mind" } });
    await admin(`/designs/${shared.id}/hide`, { reason: "Testing" });
    await pearl(`/designs/${shared.id}/delete`, {});
    expect((await stranger(`/rooms/${id}`)).body.deck.design.name).toBe("Pearl's deck");

    // One of the card room's own, the maker's own private deck at their own table, and none at all.
    expect((await grammi(`/designs/table/${id}`, { design: "starter:Holly" })).body.deck).toMatchObject({ id: "starter:Holly", author: "Card Room", design: { name: "Holly" } });
    await rick(`/rooms/${id}/sit`, { seat: 1, name: "Pappy" });
    expect((await rick(`/designs/table/${id}`, { design: secret.id })).body.deck.design.name).toBe("Not yet");
    expect((await grammi(`/designs/table/${id}`, { design: null })).body).toEqual({ deck: null });
    expect((await stranger(`/rooms/${id}`)).body.deck).toBeNull();

    // Once the cards are dealt, they're set.
    await rick(`/designs/table/${id}`, { design: "starter:Midnight" });
    await grammi(`/rooms/${id}/start`, {});
    expect((await grammi(`/designs/table/${id}`, { design: null })).status).toBe(409);
    expect((await stranger(`/rooms/${id}`)).body.deck.design.name).toBe("Midnight");
  });
});
