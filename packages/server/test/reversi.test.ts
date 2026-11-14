// Reversi in the card room: a house table with house rules, played to the end by a person (from
// nothing but what their view offers) against a computer player, and on the leaderboard.
import { movesOffered, type BoardView } from "@cardroom/games";
import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";

const BASE = "http://test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
});

function phone() {
  const app = createCardRoom({ log: memoryLog({ keep: "latest" }), botDelay: 1, talk: false });
  open.push(app);
  let cookie = "";
  return async (path: string, body?: unknown) => {
    const r = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined })))!;
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0]!;
    return { status: r.status, body: await r.json() };
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function viewOf(send: ReturnType<typeof phone>, id: string, seat: number): Promise<BoardView | undefined> {
  const changes = (await send("/_zb/sync/pull?since=0")).body.changes as { collection: string; key: string; field: string; value: any }[];
  return changes.filter((c) => c.collection === "views" && c.key === `${id}/${seat}` && c.field === "view").at(-1)?.value;
}

describe("Reversi in the card room", () => {
  it("a house table with house rules, played to the end against a computer player", async () => {
    const grammi = phone();
    const made = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    expect(made.kitRules.reversi.presets.map((p: { id: string }) => p.id)).toEqual(["reversi-classic", "reversi-small", "reversi-big"]);
    // House rules: the small board, Grammi plays dark.
    const saved = await grammi("/houses/grammis-house/presets", { game: "reversi", preset: { ...made.kitRules.reversi.presets[1], id: "", name: "Grammi goes first", first: "seat1" }, makeDefault: true });
    expect(saved.status).toBe(200);

    const { id } = (await grammi("/houses/grammis-house/tables", { game: "reversi", seats: 4 })).body;
    const room = (await grammi(`/rooms/${id}`)).body;
    expect(room.info).toEqual({ game: "reversi", rules: "Grammi goes first" });
    expect(room.seats).toHaveLength(2);
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await grammi(`/rooms/${id}/bot`, { seat: 1, name: "Hank" });
    await grammi(`/rooms/${id}/start`, {});

    // Her view is a 6×6 board with four discs on it; she is dark, and her four moves are marked.
    const first = (await viewOf(grammi, id, 0))!;
    expect(first.grids[0]).toMatchObject({ rows: 6, cols: 6, tap: { type: "place" } });
    expect(first.grids[0]!.tap!.cells).toHaveLength(4);
    expect(first.grids[0]!.marks!.filter((m) => m.mark === "hint")).toHaveLength(4);
    expect(first.players[0]!.piece).toMatchObject({ kind: "disc", label: "dark" });
    // The server refuses a disc that flips nothing, and says why.
    const refused = await grammi(`/rooms/${id}/act`, { move: { type: "place", cell: 0 } });
    expect(refused.status).not.toBe(200);
    expect(JSON.stringify(refused.body)).toMatch(/wouldn't flip anything/);

    // She plays the first move she is offered every time; when she has none, the turn passes without her.
    let end: BoardView | undefined;
    for (let i = 0; i < 2000 && !end; i++) {
      const v = await viewOf(grammi, id, 0);
      if (v?.over) end = v;
      const move = v && !v.over ? movesOffered(v)[0] : undefined;
      if (move) expect((await grammi(`/rooms/${id}/act`, { move })).status, JSON.stringify(move)).toBe(200);
      await sleep(2);
    }
    expect(end!.over!.winners.length).toBeGreaterThan(0);
    const discs = end!.grids[0]!.cells.filter(Boolean).length;
    expect(end!.scores.reduce((sum, s) => sum + s.value, 0)).toBe(discs);

    const summary = (await grammi(`/rooms/${id}`)).body.summary;
    expect(summary).toMatchObject({ game: "reversi", over: true, teams: false, seats: 2 });
    const board = (await grammi("/houses/grammis-house/leaderboard?game=reversi")).body;
    expect(board).toMatchObject({ game: "reversi", games: 1, teams: false });
    expect(board.players[0]).toMatchObject({ name: "brokennil", played: 1 });
  }, 60_000);
});
