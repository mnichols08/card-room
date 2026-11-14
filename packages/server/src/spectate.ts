// Watching: the tables with a game going, for anyone to look in on, and tables of computer
// players that anyone can set going to watch and learn from.
//
// What a watcher sees depends on who's playing. At a table of computer players there are no hands
// to keep secret, so a watcher sees everything, over any seat's shoulder (the rooms kit lets anyone
// read a `watchable` table's views). At a table with people, a watcher sees what's already public:
// who's there and the score. Their cards stay in their own browsers. The host can switch watching
// people's tables off altogether (the catalogue).
import { kitGame, isKitGame } from "@cardroom/games";
import { familyPalace } from "@cardroom/palace";
import { cleanSettings, familyTable, pickPersonas } from "@spades/rules";
import type { RoomDoc } from "@spades/rooms/server";
import type { Catalogue } from "./catalogue.js";
import { gameEmoji, gameName, gameOfOptions, isGameId, type GameId, type TableOptions } from "./games.js";
import { kitOptions } from "./kit.js";
import { palaceOptions } from "./palace.js";

interface Rooms {
  sync: {
    documents(): Promise<{
      get(collection: string, key: string): Record<string, unknown> | undefined;
      all(collection: string, prefix?: string): Array<{ key: string } & Record<string, unknown>>;
    }>;
  };
  create(options: TableOptions, settings?: unknown): Promise<string>;
  room(id: string): Promise<RoomDoc<unknown> | undefined>;
  seatBot(id: string, seat: number, name: string): Promise<void>;
  exhibit(id: string, label?: string): Promise<void>;
  start(id: string): Promise<string | null>;
  nudge(id: string): void;
}

/** How many computer tables may be going at once, and how soon after one another can be started. */
export const COMPUTER_TABLES = 6;
const START_GAP_MS = 3000;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Whether a game is over, from its public summary. */
export const isOver = (summary: unknown) => {
  const s = summary as { phase?: string; over?: boolean } | null;
  return s?.phase === "finished" || s?.over === true;
};

/** Where a game stands, in a line, from what's already public: "Hand 3 · 120 to 85". */
export function standing(summary: unknown, names: (string | null)[]): string {
  const s = (summary ?? {}) as { hand?: number; scoreLine?: string; scores?: unknown; playTo?: number; left?: number[]; finished?: number[] };
  const named = (text: string) => text.replace(/\{(\d+)\}/g, (_, seat) => names[Number(seat)] ?? `Seat ${Number(seat) + 1}`);
  const parts: string[] = [];
  if (typeof s.hand === "number") parts.push(`Hand ${s.hand}`);
  if (typeof s.scoreLine === "string" && s.scoreLine) parts.push(named(s.scoreLine));
  else if (Array.isArray(s.scores)) {
    // Spades: each partnership's score (points, with bags counted separately).
    const points = s.scores.map((team) => (typeof team === "number" ? team : (team as { points?: number } | null)?.points)).filter((n): n is number => typeof n === "number");
    if (points.length) parts.push(`${points.join(" to ")}${s.playTo ? `, playing to ${s.playTo}` : ""}`);
  }
  else if (Array.isArray(s.left)) parts.push(s.finished?.length ? `${s.finished.length} out, ${s.left.length} still holding cards` : `${s.left.length} holding cards`);
  return parts.join(" · ");
}

export function createSpectate(rooms: Rooms, catalogue: Catalogue, { mount = "/spectate", now = () => Date.now() }: { mount?: string; now?: () => number } = {}) {
  const docs = rooms.sync.documents();
  let lastStarted = 0;

  /** Every table with a game going that a watcher may see, computer tables first. */
  async function live() {
    const view = await docs;
    const people = await catalogue.watching();
    return view
      .all("rooms")
      .map((doc) => doc as unknown as RoomDoc<unknown> & { key: string })
      .filter((r) => r.started && !r.closed && !isOver(r.summary) && (r.watchable || people))
      .map((r) => {
        const game = gameOfOptions(r.info ?? r.summary);
        return {
          id: r.key,
          game,
          gameName: gameName(game),
          emoji: gameEmoji(game),
          rules: String((r.info as { rules?: unknown } | null)?.rules ?? ""),
          label: r.label ?? "",
          /** Computer players only: a watcher sees every hand. */
          computers: !!r.watchable,
          seats: r.seats.map((s) => ({ name: s.name, bot: s.bot })),
          /** Where the game stands, from its public summary. */
          standing: standing(r.summary, r.seats.map((s) => s.name)),
        };
      })
      .sort((a, b) => Number(b.computers) - Number(a.computers));
  }

  /** A game's own first rules, for a table nobody chose rules for. */
  function optionsFor(game: GameId, seats: unknown): TableOptions {
    if (isKitGame(game)) return kitOptions(kitGame(game)!, kitGame(game)!.presets[0], seats ?? kitGame(game)!.seats.default);
    if (game === "palace") return palaceOptions(familyPalace, seats ?? 4);
    return familyTable;
  }

  async function handle(request: Request): Promise<Response> {
    // GET /spectate → what there is to watch
    if (request.method === "GET") {
      const tables = await live();
      // A table of computer players has nobody to wake it after the server restarts.
      for (const t of tables) if (t.computers) rooms.nudge(t.id);
      return json({ tables, watching: await catalogue.watching(), computerTables: { going: tables.filter((t) => t.computers).length, limit: COMPUTER_TABLES } });
    }
    if (request.method !== "POST") return json({ error: "Not found" }, 404);

    // POST /spectate { game, seats?, skill?, pace? } → a table of computer players, already dealing
    const input = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const game = input.game;
    if (!isGameId(game)) return json({ error: "Pick a game for the computers to play." }, 400);
    if (!(await catalogue.isOn(game))) return json({ error: `${gameName(game)} is switched off in this card room.` }, 403);
    if ((await live()).filter((t) => t.computers).length >= COMPUTER_TABLES) return json({ error: "The computers' tables are all busy. Watch one of those, or try again when a game ends." }, 429);
    if (now() - lastStarted < START_GAP_MS) return json({ error: "Someone just started one. Give it a moment." }, 429);
    lastStarted = now();

    const options = optionsFor(game, input.seats);
    const id = await rooms.create(options, cleanSettings({ skill: input.skill, pace: input.pace }));
    const seats = (await rooms.room(id))?.seats.length ?? 0;
    const players = pickPersonas(seats);
    for (let seat = 0; seat < seats; seat++) await rooms.seatBot(id, seat, players[seat]?.name ?? `Bot ${seat + 1}`);
    await rooms.exhibit(id, `Computers playing ${gameName(game)}`);
    const problem = await rooms.start(id);
    if (problem) return json({ error: problem }, 500);
    return json({ id }, 201);
  }

  return {
    live,
    /** Answers /spectate requests; null for anything else. */
    async fetch(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url);
      return pathname === mount ? handle(request) : null;
    },
  };
}
