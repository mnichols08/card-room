// Palace in the card room: a table plays to the end with a person and bots, a house keeps Palace
// rules and a Palace leaderboard beside its spades ones, and a challenge link takes Palace challenges.
import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";

const BASE = "http://test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
});

function setup() {
  const app = createCardRoom({ log: memoryLog({ keep: "latest" }), botDelay: 1, talk: false });
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
  return { app, phone };
}

type Send = ReturnType<ReturnType<typeof setup>["phone"]>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** This browser's latest view of a table, as the sync log gives it to them. */
async function viewOf(send: Send, id: string, seat: number) {
  const changes = (await send("/_zb/sync/pull?since=0")).body.changes as { collection: string; key: string; field: string; value: any }[];
  return changes.filter((c) => c.collection === "views" && c.key === `${id}/${seat}` && c.field === "view").at(-1)?.value;
}

const label = (c: { rank: number; suit: string }) => `${({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[c.rank] ?? c.rank}${({ spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" } as Record<string, string>)[c.suit]}`;

/** A person playing simply from what they can see: ready at once, lowest playable rank, else pick up or flip. */
async function playOut(send: Send, id: string, seat: number) {
  for (let i = 0; i < 2000; i++) {
    const v = await viewOf(send, id, seat);
    if (v?.phase === "finished") return v;
    if (v?.phase === "swapping" && !v.players[seat].ready) {
      const move = v.can?.choose ? { type: "choose", cards: v.hand.slice(0, v.can.choose).map(label) } : { type: "ready" };
      const r = await send(`/rooms/${id}/act`, { move });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    else if (v?.phase === "playing" && v.turn === seat && v.can) {
      const cards: { rank: number; suit: string }[] = v.can.source === "hand" ? v.hand : v.players[seat].up;
      const move = v.can.flip
        ? { type: "flip", index: 0 }
        : v.can.ranks.length
          ? { type: "play", cards: cards.filter((c) => c.rank === v.can.ranks[0]).map(label) }
          : { type: "pickup" };
      const r = await send(`/rooms/${id}/act`, { move });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
    }
    await sleep(3);
  }
  throw new Error("the game didn't finish");
}

describe("Palace", () => {
  it("plays a whole game: a person and three bots, to the last one holding cards", async () => {
    const { phone } = setup();
    const grammi = phone();
    const made = await grammi("/rooms", { options: { game: "palace", rules: { id: "family-palace", name: "Family Palace" }, seats: 4 } });
    expect(made.status).toBe(201);
    const id = made.body.id;
    const lobby = (await grammi(`/rooms/${id}`)).body;
    expect(lobby.seats).toHaveLength(4);
    expect(lobby.info).toEqual({ game: "palace", rules: "Family Palace" });
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    for (const [seat, name] of [[1, "Hank"], [2, "Junior"], [3, "Gigi"]] as const) await grammi(`/rooms/${id}/bot`, { seat, name });
    expect((await grammi(`/rooms/${id}/start`, {})).status).toBe(200);

    const end = await playOut(grammi, id, 0);
    expect(end.finished).toHaveLength(3);
    expect(end.loser).not.toBeNull();
    const room = (await grammi(`/rooms/${id}`)).body;
    expect(room.summary).toMatchObject({ game: "palace", phase: "finished", seats: 4 });
  }, 60_000);

  it("never shows anyone else's hand or face-down cards", async () => {
    const { phone } = setup();
    const a = phone();
    const b = phone();
    const id = (await a("/rooms", { options: { game: "palace", seats: 2 } })).body.id;
    await a(`/rooms/${id}/sit`, { seat: 0, name: "A" });
    await b(`/rooms/${id}/sit`, { seat: 1, name: "B" });
    await a(`/rooms/${id}/start`, {});
    const mine = await viewOf(a, id, 0);
    // The family deal: 6 in hand, 3 to pick for face-up.
    expect(mine.hand).toHaveLength(6);
    expect(mine.can.choose).toBe(3);
    expect(await viewOf(a, id, 1)).toBeUndefined();
    expect(mine.players[1]).toMatchObject({ hand: 6, down: 3, up: [] });
    expect(JSON.stringify(mine.players[1])).not.toContain("suit\":\"hearts\",\"rank\":0");
  });

  it("a house keeps its own Palace rules, opens Palace tables, and ranks Palace on its own board", async () => {
    const { phone } = setup();
    const grammi = phone();
    const made = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    expect(made.palacePresets.map((p: { name: string }) => p.name)).toEqual(["Family Palace"]);
    const saved = (await grammi("/houses/grammis-house/presets", { game: "palace", preset: { name: "Grammi's Palace", sevenLower: true }, makeDefault: true })).body;
    expect(saved.palacePresets).toHaveLength(2);
    expect(saved.presets).toHaveLength(1);
    const bad = await grammi("/houses/grammis-house/presets", { game: "palace", preset: { name: "x", handSize: 12 } });
    expect(bad.status).toBe(400);

    const { id } = (await grammi("/houses/grammis-house/tables", { game: "palace", seats: 3 })).body;
    const room = (await grammi(`/rooms/${id}`)).body;
    expect(room.seats).toHaveLength(3);
    expect(room.info).toEqual({ game: "palace", rules: "Grammi's Palace" });
    const house = (await grammi("/houses/grammis-house")).body;
    expect(house.tables[0]).toMatchObject({ id, game: "palace", rules: "Grammi's Palace" });

    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await grammi(`/rooms/${id}/bot`, { seat: 1, name: "Skeeter" });
    await grammi(`/rooms/${id}/bot`, { seat: 2, name: "Junior" });
    await grammi(`/rooms/${id}/start`, {});
    const end = await playOut(grammi, id, 0);
    const board = (await grammi("/houses/grammis-house/leaderboard?game=palace")).body;
    expect(board).toMatchObject({ game: "palace", games: 1 });
    const me = board.players[0];
    expect(me.played).toBe(1);
    expect(me.won).toBe(end.finished[0] === 0 ? 1 : 0);
    expect(me.last).toBe(end.loser === 0 ? 1 : 0);
    // The spades board doesn't count it.
    expect((await grammi("/houses/grammis-house/leaderboard")).body.games).toBe(0);
  }, 60_000);

  it("a challenge link takes Palace challenges when its owner offers them", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const link = (await grammi("/challenges/mine", { name: "brokennil" })).body;
    expect(link.games.map((g: { id: string }) => g.id)).toEqual(["spades", "palace"]);
    expect((await rick(`/challenges/${link.code}`)).body.games[1]).toEqual({ id: "palace", name: "Palace", rules: "Family Palace" });
    const sent = (await rick(`/challenges/${link.code}`, { name: "Rick", game: "palace", message: "Castle time 🏰" })).body;
    expect(sent.game).toBe("palace");
    const room = (await grammi(`/rooms/${sent.id}`)).body;
    expect(room.info.game).toBe("palace");
    expect(room.seat).toBe(0);
    expect(room.seats.map((s: { bot: boolean }) => s.bot)).toEqual([false, false, true, true]);

    await grammi("/challenges/mine", { games: ["spades"] });
    expect((await phone()(`/challenges/${link.code}`, { name: "Jimmy", game: "palace" })).status).toBe(400);
  });
});

describe("Palace games from before the family deal", () => {
  it("a room saved with the old rules is dealt the old way, so its moves still replay", async () => {
    const { palaceOptions } = await import("../src/palace.js");
    const old = { id: "family-palace", name: "Family Palace", twoResets: true, tenBurns: true, fourBurns: true, sevenLower: false, handSize: 3, tableCards: 3, swap: true, pickUpAnytime: false };
    expect(palaceOptions(old, 4).rules).toMatchObject({ choose: false, swap: true, pickUpAnytime: false });
    expect(palaceOptions({ id: "family-palace" }, 4).rules).toMatchObject({ choose: true, pickUpAnytime: true });
  });
});

describe("table settings", () => {
  it("a house table starts with the settings it was opened with, and anyone seated changes them", async () => {
    const { phone } = setup();
    const grammi = phone();
    await grammi("/houses", { name: "Grammi's House", you: "brokennil" });
    const { id } = (await grammi("/houses/grammis-house/tables", { game: "palace", seats: 3, settings: { skill: "hard", pace: "fast" } })).body;
    expect((await grammi(`/rooms/${id}`)).body.settings).toEqual({ skill: "hard", pace: "fast" });
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    expect((await grammi(`/rooms/${id}/settings`, { settings: { skill: "easy", pace: "instant" } })).body.settings).toEqual({ skill: "easy", pace: "instant" });
    expect((await grammi(`/rooms/${id}`)).body.settings).toEqual({ skill: "easy", pace: "instant" });
    // A spades table from before settings existed plays with the defaults.
    const old = (await grammi("/rooms", { options: { name: "Old table" } })).body.id;
    expect((await grammi(`/rooms/${old}`)).body.settings).toEqual({ skill: "mixed", pace: "natural" });
  });
});
