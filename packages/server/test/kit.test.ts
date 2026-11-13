// The kit games in the card room: a house table played to the end by a person (from nothing but
// what their view offers) and computer players; house rules, the leaderboard, a challenge, and a
// tournament for a game that needs more than two players.
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

async function viewOf(send: Send, id: string, seat: number) {
  const changes = (await send("/_zb/sync/pull?since=0")).body.changes as { collection: string; key: string; field: string; value: any }[];
  return changes.filter((c) => c.collection === "views" && c.key === `${id}/${seat}` && c.field === "view").at(-1)?.value;
}

/** A person playing only from their view: buttons first, then a pick, then the first card a tap plays. */
export async function playKit(send: Send, id: string, seat: number) {
  for (let i = 0; i < 4000; i++) {
    const v = await viewOf(send, id, seat);
    if (v?.over) return v;
    let move: Record<string, unknown> | null = null;
    if (v?.choices?.options.length) move = v.choices.options[0].move;
    else if (v?.pick) move = { type: v.pick.actions[0].type, ...(v.pick.actions[0].extra ?? {}), cards: v.pick.cards.slice(0, v.pick.min) };
    else if (v?.tap?.cards.length) move = { type: v.tap.type, card: v.tap.cards[0] };
    if (move) {
      const r = await send(`/rooms/${id}/act`, { move });
      expect(r.status, JSON.stringify([move, r.body])).toBe(200);
    }
    await sleep(2);
  }
  throw new Error("the game didn't finish");
}

describe("kit games in a house", () => {
  it("Hearts: a house table, house rules, played to the end, on the leaderboard", async () => {
    const { phone } = setup();
    const grammi = phone();
    const made = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    expect(made.kitRules.hearts.presets.map((p: { id: string }) => p.id)).toContain("hearts-classic");

    // Quick house rules: to 25, no passing.
    const saved = await grammi("/houses/grammis-house/presets", { game: "hearts", preset: { ...made.kitRules.hearts.presets[0], id: "", name: "Quick", playTo: 25, passing: "none" }, makeDefault: true });
    expect(saved.status).toBe(200);
    const quick = saved.body.kitRules.hearts.presets.find((p: { name: string }) => p.name === "Quick");
    expect(saved.body.kitRules.hearts.default).toBe(quick.id);
    expect((await grammi("/houses/grammis-house/presets", { game: "hearts", preset: { ...quick, playTo: 5 } })).status).toBe(400);

    const { id } = (await grammi("/houses/grammis-house/tables", { game: "hearts", seats: 4 })).body;
    const room = (await grammi(`/rooms/${id}`)).body;
    expect(room.info).toEqual({ game: "hearts", rules: "Quick" });
    expect(room.seats).toHaveLength(4);
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    for (const [seat, name] of [[1, "Hank"], [2, "Bea"], [3, "Dot"]] as const) await grammi(`/rooms/${id}/bot`, { seat, name });
    await grammi(`/rooms/${id}/start`, {});

    const end = await playKit(grammi, id, 0);
    expect(end.over.winners.length).toBeGreaterThan(0);
    const summary = (await grammi(`/rooms/${id}`)).body.summary;
    expect(summary).toMatchObject({ game: "hearts", over: true, teams: false });

    const board = (await grammi("/houses/grammis-house/leaderboard?game=hearts")).body;
    expect(board).toMatchObject({ game: "hearts", games: 1 });
    expect(board.players[0]).toMatchObject({ name: "brokennil", played: 1 });
  }, 60_000);

  it("a challenge link takes Hearts challenges: both people seated, computers in the rest", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const link = (await grammi("/challenges/mine", { name: "brokennil", games: ["spades", "hearts"], kitRules: { hearts: { id: "x", name: "Fast Hearts", playTo: 50 } } })).body;
    expect(link.games.map((g: { id: string; rules: string }) => [g.id, g.rules])).toEqual([["spades", "Brokennil's Table"], ["hearts", "Fast Hearts"]].map(([a, b]) => [a, a === "spades" ? link.games[0].rules : b]));
    const sent = await rick(`/challenges/${link.code}`, { name: "Rick", game: "hearts" });
    expect(sent.status).toBe(201);
    const room = (await rick(`/rooms/${sent.body.id}`)).body;
    expect(room.info.game).toBe("hearts");
    expect(room.seats.map((s: { name: string; bot: boolean }) => [s.name, s.bot])).toEqual([["brokennil", false], ["Rick", false], [room.seats[2].name, true], [room.seats[3].name, true]]);
    expect((await rick(`/challenges/${link.code}`, { name: "Rick", game: "palace" })).status).toBe(400);
  });

  it("a Hearts tournament: each match has both entrants and computers filling the table", async () => {
    const { phone } = setup();
    const grammi = phone();
    const house = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    const rick = phone();
    await rick("/houses/grammis-house/join", { code: house.code, name: "Rick" });
    const t = (await grammi("/houses/grammis-house/tournaments", { name: "Heart Cup", game: "hearts" })).body;
    const at = `/houses/grammis-house/tournaments/${t.id}`;
    await grammi(`${at}/enter`, {});
    await rick(`${at}/enter`, {});
    const started = (await grammi(`${at}/start`, {})).body;
    const match = started.rounds[0].matches[0];
    const room = (await grammi(`/rooms/${match.table}`)).body;
    expect(room.seats).toHaveLength(3);
    expect(room.seats.slice(0, 2).map((s: { name: string }) => s.name).sort()).toEqual(["Rick", "brokennil"]);
    expect(room.seats[2].bot).toBe(true);
    expect(room.locked).toBe(true);
  });
});
