// Combat in the card room: the first board game with something to hide. A person plays a table to
// the end against a computer player over HTTP, and nothing the server sends them (their own view,
// the room anyone can read) says where the other fleet is until the game is over. Then two people:
// each is sent their own grid and never the other's.
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
type Change = { collection: string; key: string; field: string; value: any };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Everything this phone is allowed to read. */
const pull = async (send: Send) => (await send("/_zb/sync/pull?since=0")).body.changes as Change[];
const viewIn = (changes: Change[], id: string, seat: number): BoardView | undefined => changes.filter((c) => c.collection === "views" && c.key === `${id}/${seat}` && c.field === "view").at(-1)?.value;
const viewOf = async (send: Send, id: string, seat: number) => viewIn(await pull(send), id, seat);
const grid = (v: BoardView, id: string) => v.grids.find((g) => g.id === id)!;

describe("Combat in the card room", () => {
  it("a table against a computer player, played to the end: its fleet stays hidden until then", async () => {
    const { phone } = setup();
    const grammi = phone();
    const id = (await grammi("/rooms", { options: { game: "combat", rules: { id: "combat-quick", first: "seat1" }, seats: 2 } })).body.id;
    expect((await grammi(`/rooms/${id}`)).body.info).toEqual({ game: "combat", rules: "Quick (7×7, three ships)" });
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await grammi(`/rooms/${id}/bot`, { seat: 1, name: "Hank" });
    await grammi(`/rooms/${id}/start`, {});

    // Placing: her own grid and nothing else. Shooting before the fleets are down is refused.
    const first = (await viewOf(grammi, id, 0))!;
    expect(first).toMatchObject({ phase: "placing", turn: null });
    expect(first.grids.map((g) => [g.id, g.owner])).toEqual([["mine", 0]]);
    expect(first.reserves.map((r) => r.owner)).toEqual([0]);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "shoot", cell: 0, grid: "theirs" } })).status).not.toBe(200);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "place", from: "destroyer", to: 6 } })).status).not.toBe(200);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "place", from: "destroyer", to: 0 } })).status).toBe(200);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "auto" } })).status).toBe(200);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "ready" } })).status).toBe(200);

    let shots = 0;
    let end: BoardView | undefined;
    for (let i = 0; i < 3000 && !end; i++) {
      const changes = await pull(grammi);
      const v = viewIn(changes, id, 0)!;
      // She is never sent the other seat's view, and the room anyone can read has no ships in it.
      // The table's watch view (what someone looking on sees) has nobody's fleet in it either.
      expect(changes.some((c) => c.collection === "views" && c.key !== `${id}/0` && c.key !== `${id}/watch`)).toBe(false);
      const watch = changes.filter((c) => c.collection === "views" && c.key === `${id}/watch` && c.field === "view").at(-1)?.value as BoardView | undefined;
      if (watch && !watch.over) expect(watch.grids.filter((g) => g?.id === "mine").flatMap((g) => g.cells.filter(Boolean))).toEqual([]);
      expect(changes.some((c) => c.collection === "games" || c.collection === "moves")).toBe(false);
      const room = (await grammi(`/rooms/${id}`)).body;
      expect(JSON.stringify(room)).not.toMatch(/fleets|"ships"|"at":|"span"/);
      if (v.over) {
        end = v;
        break;
      }
      if (v.phase === "shooting") {
        // All she has of the other grid is what her shots told her: hits, misses, and ships she's been told are sunk.
        const theirs = grid(v, "theirs");
        expect(theirs.owner).toBeUndefined();
        const known = theirs.cells.filter(Boolean);
        expect(known.every((p) => ["hit", "miss", "sunk"].includes(p!.kind))).toBe(true);
        expect(known).toHaveLength(shots);
        expect(known.filter((p) => p!.span).every((p) => p!.kind === "sunk")).toBe(true);
        // Nothing else in the view has a ship of Hank's in it either: his are the only pieces of seat 1.
        const hanks = JSON.stringify(v).match(/"owner":1,"kind":"(\w+)"/g) ?? [];
        expect(hanks.every((m) => m.includes('"sunk"') || m.includes('"destroyer"') || m.includes('"patrol"'))).toBe(true);
        const move = movesOffered(v)[0];
        if (v.turn === 0 && move) {
          expect((await grammi(`/rooms/${id}/act`, { move })).status).toBe(200);
          shots++;
          continue;
        }
      }
      await sleep(2);
    }
    expect(end?.over!.winners.length).toBe(1);
    // Now both fleets are on the table: all seven squares of Hank's ships.
    expect(grid(end!, "theirs").cells.filter((p) => p?.owner === 1)).toHaveLength(7);
    const summary = (await grammi(`/rooms/${id}`)).body.summary;
    expect(summary).toMatchObject({ game: "combat", over: true, teams: false, seats: 2 });
    expect(Object.keys(summary).sort()).toEqual(["game", "hand", "order", "over", "phase", "rules", "scoreLine", "seats", "teams", "winners"]);
  }, 60_000);

  it("two people: each is sent their own grid, and placing is nobody else's business", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const id = (await grammi("/rooms", { options: { game: "combat", rules: { id: "combat-classic", first: "seat2" }, seats: 2 } })).body.id;
    await grammi(`/rooms/${id}/sit`, { seat: 0, name: "brokennil" });
    await rick(`/rooms/${id}/sit`, { seat: 1, name: "Rick" });
    await grammi(`/rooms/${id}/start`, {});
    const quiet = JSON.stringify(await viewOf(rick, id, 1));

    // Grammi places, turns and shuffles; Rick's view doesn't change, and he can't read hers.
    for (const move of [{ type: "place", from: "carrier", to: 0 }, { type: "turn" }, { type: "place", from: "cruiser", to: 19 }, { type: "auto" }]) {
      expect((await grammi(`/rooms/${id}/act`, { move })).status).toBe(200);
      const his = await pull(rick);
      expect(his.some((c) => c.collection === "views" && c.key === `${id}/0`)).toBe(false);
      expect(JSON.stringify(viewIn(his, id, 1))).toBe(quiet);
    }
    const hers = (await viewOf(grammi, id, 0))!;
    expect(hers.grids[0]!.cells.filter((p) => p?.kind === "ship")).toHaveLength(17);
    // Both move at once: Rick places while Grammi is still deciding, and "Ready" is all either learns.
    expect((await rick(`/rooms/${id}/act`, { move: { type: "auto" } })).status).toBe(200);
    expect((await rick(`/rooms/${id}/act`, { move: { type: "ready" } })).status).toBe(200);
    expect((await viewOf(grammi, id, 0))!.players.map((p) => p.line)).toEqual(["Placing ships", "Ready"]);
    expect((await rick(`/rooms/${id}/act`, { move: { type: "auto" } })).status).not.toBe(200);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "ready" } })).status).toBe(200);

    // Rick shoots first by the rules; Grammi's shot is refused until he has.
    const [mine, his] = [(await viewOf(grammi, id, 0))!, (await viewOf(rick, id, 1))!];
    expect([mine.phase, mine.turn, his.turn]).toEqual(["shooting", 1, 1]);
    expect(grid(mine, "theirs").tap ?? null).toBeNull();
    expect(grid(his, "theirs").tap!.cells).toHaveLength(100);
    expect(grid(his, "theirs").cells.every((p) => p === null)).toBe(true);
    expect(grid(his, "mine").owner).toBe(1);
    expect((await grammi(`/rooms/${id}/act`, { move: { type: "shoot", cell: 0, grid: "theirs" } })).status).not.toBe(200);
    expect((await rick(`/rooms/${id}/act`, { move: { type: "shoot", cell: 0, grid: "theirs" } })).status).toBe(200);
    const after = (await viewOf(rick, id, 1))!;
    expect(["hit", "miss"]).toContain(grid(after, "theirs").cells[0]!.kind);
    expect(grid(after, "theirs").cells.filter(Boolean)).toHaveLength(1);
    expect(grid((await viewOf(grammi, id, 0))!, "mine").marks).toEqual([{ cell: 0, mark: "last" }]);
  });
});
