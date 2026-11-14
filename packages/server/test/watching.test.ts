// Watching a table with people at it: the watch view shows the table as every seat sees it, and
// nobody's hand, in every game.
import { KIT_GAMES } from "@cardroom/games";
import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";
import { GAMES, type GameId } from "../src/games.js";

const BASE = "http://test";
let open: ReturnType<typeof createCardRoom>[] = [];
afterEach(() => {
  open.forEach((c) => c.close());
  open = [];
});

function setup() {
  const app = createCardRoom({ log: memoryLog({ keep: "latest" }), botDelay: 1, talk: false, adminToken: "t" });
  open.push(app);
  const send = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = (await app.fetch(new Request(BASE + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined })))!;
    return { status: r.status, body: await r.json() };
  };
  const view = async (id: string, seat: number | "watch") => (await app.rooms.sync.documents()).get("views", `${id}/${seat}`)?.view as Record<string, unknown> | undefined;
  /** Whether a browser with no cookie may read a view from the sync log. */
  const readable = async (key: string) => {
    const r = await app.fetch(new Request(`${BASE}/_zb/sync/pull?scope=${encodeURIComponent(JSON.stringify({ views: key }))}`));
    return (r ? await r.text() : "").includes('"view"');
  };
  return { app, send, view, readable };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Every card id anywhere in a value. */
const cardIds = (value: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((v) => cardIds(v, out));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.id === "string" && typeof o.kind === "string") out.add(o.id);
    Object.values(o).forEach((v) => cardIds(v, out));
  }
  return out;
};

describe("watching a table with people at it", () => {
  it("shows Palace as everyone sees it: face-up cards and the pile, nobody's hand or moves", async () => {
    const { send, view, readable } = setup();
    const id = (await send("/spectate", { game: "palace", seats: 3, pace: "instant" })).body.id as string;
    await sleep(60);
    const watch = (await view(id, "watch"))!;
    const seats = [await view(id, 0), await view(id, 1), await view(id, 2)].map((v) => v!);
    expect(watch.hand).toEqual([]);
    expect(watch.can).toBeNull();
    expect(watch.you).toBe(0);
    // Everything public matches what a seat sees.
    for (const key of ["phase", "turn", "players", "pile", "pileCount", "deck", "finished"]) expect(watch[key], key).toEqual(seats[1]![key]);
    expect(await readable(`${id}/watch`)).toBe(true);
  });

  it("is closed to watchers when the host turns watching off", async () => {
    const { send, readable } = setup();
    const id = (await send("/rooms", { options: { game: "palace", rules: {}, seats: 2 } })).body.id as string;
    expect(await readable(`${id}/watch`)).toBe(false); // nothing to see before the deal
    await send("/moderation/games", { watching: false }, { authorization: "Bearer t" });
    const computers = (await send("/spectate", { game: "war" })).body.id as string;
    await sleep(30);
    expect(await readable(`${computers}/watch`)).toBe(false);
    // The computers' own seats stay open: there are no people's hands there.
    expect(await readable(`${computers}/0`)).toBe(true);
    await send("/moderation/games", { watching: true }, { authorization: "Bearer t" });
    expect(await readable(`${computers}/watch`)).toBe(true);
  });

  // Every game, a few moves in: the watch view never holds a card that only some seats can see.
  for (const game of GAMES.map((g) => g.id) as GameId[]) {
    it(`${game}: a watcher sees no card that any seat can't`, async () => {
      const { app, send, view } = setup();
      // Past the per-request pace limit: each test has its own card room.
      const made = await send("/spectate", { game, pace: "instant" });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      const id = made.body.id as string;
      const n = (await app.rooms.room(id))!.seats.length;
      let checked = 0;
      for (let round = 0; round < 6; round++) {
        await sleep(12);
        const watch = await view(id, "watch");
        const seats = await Promise.all(Array.from({ length: n }, (_, s) => view(id, s)));
        if (!watch || seats.some((v) => !v)) continue;
        const shown = cardIds(watch);
        // A card in the watch view must be in every seat's view (the views are written together;
        // a round that caught them mid-write is skipped by comparing versions through the card sets).
        const everySeat = seats.map((v) => cardIds(v));
        const leaked = [...shown].filter((c) => !everySeat.every((set) => set.has(c)));
        if (leaked.length) {
          // Re-read once: the documents may have been from two different moves.
          const again = cardIds(await view(id, "watch"));
          const seatsAgain = (await Promise.all(Array.from({ length: n }, (_, s) => view(id, s)))).map((v) => cardIds(v));
          expect([...again].filter((c) => !seatsAgain.every((set) => set.has(c))), `${game} round ${round}`).toEqual([]);
        }
        expect((watch as { hand?: unknown[] }).hand ?? [], game).toEqual([]);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it("covers every game the card room has", () => {
    expect(GAMES.length).toBe(KIT_GAMES.length + 2);
  });
});

// Combat: each seat has a grid of its own. Squares where two fleets happen to overlap look alike
// from both seats, so the watch view has to leave those grids out rather than compare them.
describe("watching Combat", () => {
  it("shows nobody's fleet, even where the two fleets share a square", async () => {
    const { kitGame } = await import("@cardroom/games");
    const { watchView } = await import("../src/games.js");
    const combat = kitGame("combat")! as unknown as { presets: unknown[]; newGame(rules: unknown, seats: number, seed: number): unknown; apply(s: unknown, seat: number, move: unknown): unknown; view(s: unknown, seat: number): { grids: { id: string; cells: unknown[] }[] } };
    let overlapped = 0;
    for (let seed = 1; seed <= 25; seed++) {
      let s = combat.newGame(combat.presets[0], 2, seed);
      for (const seat of [0, 1]) s = combat.apply(s, seat, { type: "auto" });
      const seats = [0, 1].map((seat) => combat.view(s, seat));
      const mine = seats.map((v) => v.grids.find((g) => g.id === "mine")!.cells);
      if (mine[0]!.some((p, i) => p && mine[1]![i])) overlapped++;
      const watch = watchView("combat", seats) as { grids: { cells: unknown[] }[]; reserves: unknown[] };
      expect(watch.grids.flatMap((g) => (g?.cells ?? []).filter(Boolean)), `seed ${seed}`).toEqual([]);
      expect(watch.reserves).toEqual([]);
    }
    // The test means something only if fleets did overlap.
    expect(overlapped).toBeGreaterThan(0);
  });
});
