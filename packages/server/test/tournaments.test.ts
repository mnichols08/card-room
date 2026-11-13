// Tournaments: the bracket draws fairly and moves winners on; a house runs one end to end, with
// tables opened for each match, players seated, computer matches playing themselves, and a champion.
import { memoryLog } from "@zubra/sync/server";
import { afterEach, describe, expect, it } from "vitest";
import { createCardRoom } from "../src/app.js";
import { bracket, roundName, settle, sideThatWon, type Tournament } from "../src/tournaments.js";

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fake = (n: number): Tournament => ({
  id: "t",
  house: "h",
  name: "Cup",
  game: "palace",
  rules: {} as Tournament["rules"],
  settings: { skill: "mixed", pace: "natural" },
  status: "playing",
  entrants: Array.from({ length: n }, (_, i) => ({ id: `e${i}`, name: `E${i}`, players: [] })),
  rounds: bracket(n, () => 0.5),
  champion: null,
  by: "m",
  created: 0,
});

describe("the bracket", () => {
  it.each([2, 3, 5, 6, 8, 13])("%i entrants: everyone once, no match of two byes, a power of two", (n) => {
    const rounds = bracket(n);
    const first = rounds[0]!;
    const size = first.length * 2;
    expect(size & (size - 1)).toBe(0);
    expect(size).toBeGreaterThanOrEqual(n);
    expect(size / 2).toBeLessThan(n);
    const seen = first.flatMap((m) => [m.a, m.b]).filter((s) => typeof s === "number");
    expect(seen.sort((a, b) => (a as number) - (b as number))).toEqual(Array.from({ length: n }, (_, i) => i));
    expect(first.some((m) => m.a === "bye" && m.b === "bye")).toBe(false);
    expect(rounds.at(-1)!.length).toBe(1);
  });

  it("byes go through at once; winners fill the next round; the final crowns a champion", () => {
    const t = fake(3);
    // Four slots, one bye: the bye's entrant waits in round 2 for the other match's winner.
    const ready = settle(t);
    expect(ready).toHaveLength(1);
    expect(t.rounds[0]![0]!.how).toBe("bye");
    expect(t.rounds[1]![0]!.a).toBe(t.rounds[0]![0]!.a);
    ready[0]!.winner = 1;
    expect(settle(t)).toHaveLength(1); // the final is ready
    expect(t.rounds[1]![0]!.b).toBe(ready[0]!.b);
    t.rounds[1]![0]!.winner = 0;
    settle(t);
    expect(t.status).toBe("finished");
    expect(t.champion).toBe(t.rounds[1]![0]!.a);
  });

  it("names rounds from the end", () => {
    const t = fake(8);
    expect([0, 1, 2].map((r) => roundName(t, r))).toEqual(["Quarterfinals", "Semifinals", "Final"]);
    expect(roundName(fake(16), 0)).toBe("Round 1");
  });

  it("reads the winning side from a finished table", () => {
    expect(sideThatWon("spades", { phase: "finished", winner: 1 })).toBe(1);
    expect(sideThatWon("spades", { phase: "playing", winner: null })).toBe(null);
    expect(sideThatWon("palace", { phase: "finished", finished: [0], loser: 1 })).toBe(0);
    expect(sideThatWon("palace", { phase: "finished", finished: [1], loser: 0 })).toBe(1);
  });
});

/** Play a Palace table out as a seat, simply: lowest playable rank, else pick up or flip. */
async function playPalace(send: ReturnType<ReturnType<typeof setup>["phone"]>, id: string, seat: number) {
  const label = (c: { rank: number; suit: string }) => `${({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[c.rank] ?? c.rank}${({ spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" } as Record<string, string>)[c.suit]}`;
  await send(`/rooms/${id}/start`, {});
  for (let i = 0; i < 3000; i++) {
    const changes = (await send("/_zb/sync/pull?since=0")).body.changes as { collection: string; key: string; field: string; value: any }[];
    const v = changes.filter((c) => c.collection === "views" && c.key === `${id}/${seat}` && c.field === "view").at(-1)?.value;
    if (v?.phase === "finished") return;
    if (v?.phase === "swapping" && v.can?.choose) await send(`/rooms/${id}/act`, { move: { type: "choose", cards: v.hand.slice(0, v.can.choose).map(label) } });
    else if (v?.phase === "swapping" && !v.players[seat].ready) await send(`/rooms/${id}/act`, { move: { type: "ready" } });
    else if (v?.phase === "playing" && v.turn === seat && v.can) {
      const cards: { rank: number; suit: string }[] = v.can.source === "hand" ? v.hand : v.players[seat].up;
      const move = v.can.flip ? { type: "flip", index: 0 } : v.can.ranks.length ? { type: "play", cards: cards.filter((c) => c.rank === v.can.ranks[0]).map(label) } : { type: "pickup" };
      await send(`/rooms/${id}/act`, { move });
    }
    await sleep(2);
  }
  throw new Error("the game didn't finish");
}

describe("a house tournament", () => {
  it("Palace: sign up, start, play the matches, and crown a champion", async () => {
    const { phone } = setup();
    const grammi = phone();
    const rick = phone();
    const house = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    const rickIn = (await rick("/houses/grammis-house/join", { code: house.code, name: "Rick" })).body;

    // Only owners and admins start one.
    expect((await rick("/houses/grammis-house/tournaments", { name: "Nope", game: "palace" })).status).toBe(403);
    const made = await grammi("/houses/grammis-house/tournaments", { name: "Thanksgiving Palace", game: "palace" });
    expect(made.status).toBe(201);
    const id = made.body.id as string;
    const at = `/houses/grammis-house/tournaments/${id}`;

    await grammi(`${at}/enter`, {});
    expect((await grammi(`${at}/enter`, {})).status).toBe(409); // once is enough
    await rick(`${at}/enter`, {});
    expect((await rick(`${at}/start`, {})).status).toBe(403);
    await grammi(`${at}/add`, { players: ["computer"] });
    const before = (await grammi(`${at}/add`, { players: ["computer"] })).body;
    expect(before.entrants.map((e: { name: string }) => e.name)).toEqual(expect.arrayContaining(["brokennil", "Rick"]));
    expect(before.entrants).toHaveLength(4);

    const started = (await grammi(`${at}/start`, {})).body;
    expect(started.status).toBe("playing");
    expect(started.rounds.map((r: { name: string }) => r.name)).toEqual(["Semifinals", "Final"]);
    expect(started.rounds[0].matches.every((m: { table: string | null }) => m.table)).toBe(true);
    expect((await grammi(`${at}/enter`, {})).status).toBe(409); // signup is over

    // The tables show on the house page, and the house lists the tournament.
    const page = (await grammi("/houses/grammis-house")).body;
    expect(page.tournaments[0]).toMatchObject({ id, name: "Thanksgiving Palace", status: "playing", round: "Semifinals" });
    expect(page.tables.filter((t: { tournament: string | null }) => t.tournament === id)).toHaveLength(2);

    // Everyone plays their own semifinal from the seat they were given. A computer-only match
    // plays itself out.
    const seatOf = async (send: typeof grammi, table: string) => (await send(`/rooms/${table}`)).body.seat as number | null;
    const plays: Promise<void>[] = [];
    for (const m of started.rounds[0].matches) {
      for (const send of [grammi, rick]) {
        const seat = await seatOf(send, m.table);
        if (seat !== null) plays.push(playPalace(send, m.table, seat));
      }
    }
    await Promise.all(plays);

    // The final opens with the two winners; play it if we're in it, until there's a champion.
    for (let i = 0; i < 400; i++) {
      const t = (await grammi(at)).body;
      if (t.status === "finished") {
        expect(t.champion).not.toBeNull();
        expect(t.rounds[1].matches[0].winner).not.toBeNull();
        expect((await grammi("/houses/grammis-house")).body.tournaments[0]).toMatchObject({ status: "finished", champion: t.entrants[t.champion].name });
        return;
      }
      const final = t.rounds[1].matches[0];
      if (final.table && !final.playing && final.winner === null) {
        // Both people may be in the final: play their seats at the same time, or each waits on the other.
        const finalists = [];
        for (const send of [grammi, rick]) {
          const seat = await seatOf(send, final.table);
          if (seat !== null) finalists.push(playPalace(send, final.table, seat));
        }
        await Promise.all(finalists);
      }
      await sleep(10);
    }
    throw new Error(`no champion: ${JSON.stringify((await grammi(at)).body.rounds)}`);
  }, 60_000);

  it("spades: fixed teams sit across from each other; the organizer can call a match", async () => {
    const { phone, app } = setup();
    const grammi = phone();
    const rick = phone();
    const jimmy = phone();
    const house = (await grammi("/houses", { name: "Grammi's House", you: "brokennil" })).body;
    const rickId = (await rick("/houses/grammis-house/join", { code: house.code, name: "Rick" })).body.me.id;
    await jimmy("/houses/grammis-house/join", { code: house.code, name: "Jimmy" });
    const id = (await grammi("/houses/grammis-house/tournaments", { name: "Cup", game: "spades" })).body.id;
    const at = `/houses/grammis-house/tournaments/${id}`;

    // Grammi signs up with Rick as her partner; Rick can't sign up twice.
    const entered = (await grammi(`${at}/enter`, { partner: rickId })).body;
    expect(entered.entrants[0].name).toBe("brokennil & Rick");
    expect((await rick(`${at}/enter`, {})).status).toBe(409);
    // Jimmy has no partner: the computer plays with him.
    const jim = (await jimmy(`${at}/enter`, {})).body;
    expect(jim.entrants[1].players.map((p: { bot: boolean }) => p.bot)).toEqual([false, true]);
    await grammi(`${at}/add`, { players: ["computer", "computer"] });
    await grammi(`${at}/add`, { players: ["computer", "computer"] });
    const t = (await grammi(`${at}/start`, {})).body;
    expect(t.rounds).toHaveLength(2);

    // Four teams, two semifinals. Check the seats at ours.
    const withUs = t.rounds[0].matches.find((m: { a: number; b: number }) => m.a === 0 || m.b === 0)!;
    expect(withUs.table).toBeTruthy();
    {
      const room = (await grammi(`/rooms/${withUs.table}`)).body;
      const ours = withUs.a === 0 ? [0, 2] : [1, 3];
      expect(ours.map((s) => room.seats[s].name).sort()).toEqual(["Rick", "brokennil"]);
      expect(room.seat).toBe(ours[0]);
      expect((await rick(`/rooms/${withUs.table}`)).body.seat).toBe(ours[1]);
      // The seats are set: nobody swaps seats or changes the computer players.
      expect((await jimmy(`/rooms/${withUs.table}/sit`, { seat: 0, name: "Jimmy" })).status).toBe(409);
      expect((await grammi(`/rooms/${withUs.table}/sit`, { seat: ours[1], name: "brokennil" })).status).toBe(409);
      expect(room.locked).toBe(true);
      expect(room.label).toBe("Cup · Semifinals");
      // Rick's not well: Grammi calls it for the other team.
      expect((await rick(`${at}/call`, { round: 0, match: t.rounds[0].matches.indexOf(withUs), winner: 1 })).status).toBe(403);
      const called = (await grammi(`${at}/call`, { round: 0, match: t.rounds[0].matches.indexOf(withUs), winner: withUs.a === 0 ? 1 : 0 })).body;
      expect(called.rounds[0].matches[t.rounds[0].matches.indexOf(withUs)].how).toBe("called");
    }
    // Calling the remaining matches finishes it.
    for (let i = 0; i < 5; i++) {
      const now = (await grammi(at)).body;
      if (now.status === "finished") break;
      now.rounds.forEach((round: { matches: { a: unknown; b: unknown; winner: number | null }[] }, r: number) =>
        round.matches.forEach((m, mi) => {
          if (m.winner === null && typeof m.a === "number" && typeof m.b === "number") void grammi(`${at}/call`, { round: r, match: mi, winner: 0 });
        }),
      );
      await sleep(30);
    }
    expect((await grammi(at)).body.status).toBe("finished");
    void app;
  });

  it("a computer-only spades match plays itself and moves its winner on", async () => {
    const { phone } = setup();
    const grammi = phone();
    await grammi("/houses", { name: "Grammi's House", you: "brokennil" });
    const id = (await grammi("/houses/grammis-house/tournaments", { name: "Bots", game: "spades", settings: { pace: "instant" } })).body.id;
    const at = `/houses/grammis-house/tournaments/${id}`;
    await grammi(`${at}/add`, { players: ["computer", "computer"] });
    await grammi(`${at}/add`, { players: ["computer", "computer"] });
    const t = (await grammi(`${at}/start`, {})).body;
    expect(t.rounds).toHaveLength(1);
    for (let i = 0; i < 600; i++) {
      const now = (await grammi(at)).body;
      if (now.status === "finished") {
        expect(now.rounds[0].matches[0].how).toBe("played");
        return;
      }
      await sleep(20);
    }
    throw new Error("the computer match didn't finish");
  }, 30_000);

  it("strangers and other houses can't see a tournament; a cancelled one disappears", async () => {
    const { phone } = setup();
    const grammi = phone();
    const stranger = phone();
    await grammi("/houses", { name: "Grammi's House", you: "brokennil" });
    await stranger("/houses", { name: "Other House", you: "x" });
    const id = (await grammi("/houses/grammis-house/tournaments", { game: "palace" })).body.id;
    expect((await stranger(`/houses/grammis-house/tournaments/${id}`)).status).toBe(403);
    expect((await stranger(`/houses/other-house/tournaments/${id}`)).status).toBe(404);
    expect((await grammi(`/houses/grammis-house/tournaments/${id}/cancel`, {})).status).toBe(200);
    expect((await grammi("/houses/grammis-house")).body.tournaments).toEqual([]);
    // The tournament's own documents are the server's alone.
    const pulled = (await grammi("/_zb/sync/pull?since=0")).body.changes as { collection: string }[];
    expect(pulled.filter((c) => c.collection.startsWith("tournament"))).toEqual([]);
  });
});
