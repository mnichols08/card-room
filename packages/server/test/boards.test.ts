// A board game in the card room, through the same doors as the card games: a house table with
// house rules played to the end by a person (from nothing but what their view offers) against a
// computer player, the leaderboard, a challenge, and a tournament match that names a champion.
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

async function viewOf(send: Send, id: string, seat: number): Promise<BoardView | undefined> {
  const changes = (await send("/_zb/sync/pull?since=0")).body.changes as { collection: string; key: string; field: string; value: any }[];
  return changes.filter((c) => c.collection === "views" && c.key === `${id}/${seat}` && c.field === "view").at(-1)?.value;
}

/** A person playing only from their view: the first thing it offers, every time. */
async function playBoard(send: Send, id: string, seat: number) {
  for (let i = 0; i < 2000; i++) {
    const v = await viewOf(send, id, seat);
    if (v?.over) return v;
    const move = v ? movesOffered(v)[0] : undefined;
    if (move) {
      const r = await send(`/rooms/${id}/act`, { move });
      expect(r.status, JSON.stringify([move, r.body])).toBe(200);
    }
    await sleep(2);
  }
  throw new Error("the game didn't finish");
}

describe("board games in the card room", () => {
  it("Tic-Tac-Toe: a house table with house rules, played to the end, on the leaderboard", async () => {
    const { phone } = setup();
    const grammi = phone();
    const made = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    expect(made.kitRules.tictactoe.presets.map((p: { id: string }) => p.id)).toEqual(["tictactoe-classic", "tictactoe-ultimate", "tictactoe-four", "tictactoe-gomoku"]);

    // House rules: a three-game match, Grammi first. Rules that don't fit the board are refused.
    const saved = await grammi("/houses/grammis-house/presets", { game: "tictactoe", preset: { ...made.kitRules.tictactoe.presets[0], id: "", name: "Best of three", games: 3, first: "seat1" }, makeDefault: true });
    expect(saved.status).toBe(200);
    const match = saved.body.kitRules.tictactoe.presets.find((p: { name: string }) => p.name === "Best of three");
    expect(saved.body.kitRules.tictactoe.default).toBe(match.id);
    expect((await grammi("/houses/grammis-house/presets", { game: "tictactoe", preset: { ...match, line: 5 } })).status).toBe(400);

    const { id } = (await grammi("/houses/grammis-house/tables", { game: "tictactoe", seats: 6 })).body;
    const room = (await grammi(`/rooms/${id}`)).body;
    expect(room.info).toEqual({ game: "tictactoe", rules: "Best of three" });
    expect(room.seats).toHaveLength(2);
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await grammi(`/rooms/${id}/bot`, { seat: 1, name: "Hank" });
    await grammi(`/rooms/${id}/start`, {});

    // Her view is a board she can tap; she is X and it's her move.
    const first = (await viewOf(grammi, id, 0))!;
    expect(first.grids[0]).toMatchObject({ rows: 3, cols: 3, tap: { type: "mark" } });
    expect(first.grids[0]!.tap!.cells).toHaveLength(9);
    expect(first.players[0]!.piece).toMatchObject({ kind: "x" });
    // The server refuses what the rules refuse, and says why.
    const taken = await grammi(`/rooms/${id}/act`, { move: { type: "mark", cell: 99 } });
    expect(taken.status).not.toBe(200);

    const end = await playBoard(grammi, id, 0);
    expect(end.over!.winners.length).toBeGreaterThan(0);
    const summary = (await grammi(`/rooms/${id}`)).body.summary;
    expect(summary).toMatchObject({ game: "tictactoe", over: true, teams: false, seats: 2 });

    const board = (await grammi("/houses/grammis-house/leaderboard?game=tictactoe")).body;
    expect(board).toMatchObject({ game: "tictactoe", games: 1, teams: false });
    expect(board.players[0]).toMatchObject({ name: "brokennil", played: 1 });
  }, 60_000);

  it("Checkers: a house table against a computer player, a hop at a time, to the end", async () => {
    const { phone } = setup();
    const grammi = phone();
    const made = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    expect(made.kitRules.checkers.presets.map((p: { id: string }) => p.id)).toEqual(["checkers-american", "checkers-international", "checkers-russian", "checkers-friendly"]);
    // House rules: Russian, but Grammi always moves first. The biggest capture can't be insisted on when none is forced.
    const saved = await grammi("/houses/grammis-house/presets", { game: "checkers", preset: { ...made.kitRules.checkers.presets[2], id: "", name: "Grammi's Russian", first: "seat1" }, makeDefault: true });
    expect(saved.status).toBe(200);
    expect((await grammi("/houses/grammis-house/presets", { game: "checkers", preset: { ...made.kitRules.checkers.presets[3], id: "", name: "Muddle", most: true } })).body.kitRules.checkers.presets.at(-1)).toMatchObject({ name: "Muddle", most: false });

    const { id } = (await grammi("/houses/grammis-house/tables", { game: "checkers" })).body;
    expect((await grammi(`/rooms/${id}`)).body.info).toEqual({ game: "checkers", rules: "Grammi's Russian" });
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await grammi(`/rooms/${id}/bot`, { seat: 1, name: "Hank" });
    await grammi(`/rooms/${id}/start`, {});

    // Her view is a board of pieces to pick up; she moves first, from her own side.
    const first = (await viewOf(grammi, id, 0))!;
    expect(first.grids[0]).toMatchObject({ rows: 8, cols: 8, shade: "checker", flip: false, select: { type: "move" } });
    expect(movesOffered(first)).toHaveLength(7);
    // The server refuses what the rules refuse: a man can't go backwards, or two squares.
    const from = first.grids[0]!.select!.sources[0]!.from as number;
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "move", from, to: from + 9 } })).status).not.toBe(200);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "move", from, to: from - 18 } })).status).not.toBe(200);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "stop" } })).status).not.toBe(200);

    const end = await playBoard(grammi, id, 0);
    expect(end.over!.winners.length).toBeGreaterThan(0);
    const summary = (await grammi(`/rooms/${id}`)).body.summary;
    expect(summary).toMatchObject({ game: "checkers", over: true, teams: false, seats: 2 });
    const board = (await grammi("/houses/grammis-house/leaderboard?game=checkers")).body;
    expect(board).toMatchObject({ game: "checkers", games: 1 });
    expect(board.players[0]).toMatchObject({ name: "brokennil", played: 1 });
  }, 60_000);

  it("each seat is sent only its own view", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const id = (await grammi("/rooms", { options: { game: "tictactoe", rules: { id: "tictactoe-classic", first: "seat2" }, seats: 2 } })).body.id;
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await rick(`/rooms/${id}/sit`, { seat: 1, name: "Rick" });
    await grammi(`/rooms/${id}/start`, {});
    const [mine, his] = [(await viewOf(grammi, id, 0))!, (await viewOf(rick, id, 1))!];
    expect([mine.me, his.me]).toEqual([0, 1]);
    // Rick goes first by the rules: only his view offers a move, and Grammi's is refused.
    expect(mine.grids[0]!.tap).toBeNull();
    expect(his.grids[0]!.tap!.cells).toHaveLength(9);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "mark", cell: 4 } })).status).not.toBe(200);
    expect((await rick(`/rooms/${id}/act`, { move: { type: "mark", cell: 4 } })).status).toBe(200);
    expect((await viewOf(grammi, id, 0))!.grids[0]!.cells[4]).toMatchObject({ owner: 1, kind: "x" });
  });

  it("a challenge link takes Tic-Tac-Toe challenges with the rules it was made with", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const link = (await grammi("/challenges/mine", { name: "brokennil", games: ["tictactoe"], kitRules: { tictactoe: { id: "tictactoe-ultimate", name: "Nine boards", board: "ultimate" } } })).body;
    expect(link.games.map((g: { id: string; rules: string }) => [g.id, g.rules])).toEqual([["tictactoe", "Nine boards"]]);
    const sent = await rick(`/challenges/${link.code}`, { name: "Rick", game: "tictactoe" });
    expect(sent.status).toBe(201);
    const room = (await rick(`/rooms/${sent.body.id}`)).body;
    expect(room.info).toEqual({ game: "tictactoe", rules: "Nine boards" });
    expect(room.seats.map((s: { name: string; bot: boolean }) => [s.name, s.bot])).toEqual([["brokennil", false], ["Rick", false]]);
  });

  it("a Tic-Tac-Toe tournament: the match is played and its winner is the champion", async () => {
    const { phone } = setup();
    const grammi = phone();
    const house = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    const rick = phone();
    await rick("/houses/grammis-house/join", { code: house.code, name: "Rick" });
    const t = (await grammi("/houses/grammis-house/tournaments", { name: "Noughts Cup", game: "tictactoe" })).body;
    const at = `/houses/grammis-house/tournaments/${t.id}`;
    await grammi(`${at}/enter`, {});
    await rick(`${at}/enter`, {});
    const started = (await grammi(`${at}/start`, {})).body;
    const match = started.rounds[0].matches[0];
    const room = (await grammi(`/rooms/${match.table}`)).body;
    expect(room.seats).toHaveLength(2);
    expect(room.seats.map((s: { name: string }) => s.name).sort()).toEqual(["Rick", "brokennil"]);
    expect(room.locked).toBe(true);
    await grammi(`/rooms/${match.table}/start`, {});
    const seatOf = (name: string) => room.seats.findIndex((s: { name: string }) => s.name === name);
    const [end] = await Promise.all([playBoard(grammi, match.table, seatOf("brokennil")), playBoard(rick, match.table, seatOf("Rick"))]);
    expect(end.over).not.toBeNull();
    // A drawn game still sends someone through (the player who held X to the draw).
    let done: any;
    for (let i = 0; i < 200 && done?.status !== "finished"; i++) {
      await sleep(5);
      done = (await grammi(at)).body;
    }
    expect(done.status).toBe("finished");
    const summary = (await grammi(`/rooms/${match.table}`)).body.summary;
    expect(done.entrants[done.champion].name).toBe(room.seats[summary.order[0]].name);
  }, 60_000);
});
