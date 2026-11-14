// The lobby: tables open to anyone in the card room. Find players for a game, or see every open
// table (who's playing what, and since when) and jump in.
import type { GameId } from "./storage";

export interface OpenTable {
  id: string;
  game: GameId;
  rules: string;
  /** When it was opened to everyone (ms). */
  created: number;
  seats: { name: string | null; bot: boolean }[];
  free: number;
  /** The seat this browser holds there, or null. */
  seat: number | null;
}

export class LobbyError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new LobbyError(data.error ?? `Request failed (${response.status})`, response.status);
  return data;
}

const at = (id: string, action: string) => `/lobby/${encodeURIComponent(id)}/${action}`;

export const lobby = {
  list: async (game?: GameId | null) => (await call<{ tables: OpenTable[] }>(game ? `/lobby?game=${encodeURIComponent(game)}` : "/lobby")).tables,
  /** A seat at a table waiting for this game, or a new open table of your own to wait at. */
  join: (ask: { game: GameId; name: string; rules?: unknown; seats?: number; settings?: unknown; sameRules?: boolean }) => call<{ id: string; seat: number; waiting: boolean }>("/lobby/join", ask),
  /** Jump into an open table's first free seat. */
  sit: (id: string, name: string) => call<{ id: string; seat: number }>(at(id, "sit"), { name }),
  /** Open your table to everyone, or close it to people with the link again. */
  setOpen: (id: string, open: boolean) => call<{ open: boolean }>(at(id, "open"), { open }),
  /** The host takes a player's seat away, before the deal; they can't sit back down at this table. */
  remove: (id: string, seat: number) => call<{ ok: true }>(at(id, "remove"), { seat }),
  /** The games this player gets a buzz about when a table opens ("any" for every game). */
  alerts: () => call<{ games: string[]; notifications: boolean }>("/lobby/alerts"),
  setAlerts: (games: string[]) => call<{ games: string[]; notifications: boolean }>("/lobby/alerts", { games }),
  /** Still waiting at this table. */
  here: (id: string) => call<{ ok: true; open: boolean }>(at(id, "here"), {}),
};

/** What to tell someone when the lobby said no, or couldn't be reached. */
export const lobbyProblem = (e: unknown) => (e instanceof LobbyError ? e.message : "Couldn't reach the card room. Try again in a minute.");

/** "just now", "3 min", "2 hr": how long a table has been waiting. */
export function waited(since: number, now = Date.now()): string {
  const minutes = Math.floor((now - since) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} hr`;
}

/** Who's at a table, in words: "brokennil and Rick", "Jimmy, a bot". */
export function whoIsThere(table: Pick<OpenTable, "seats">): string {
  const people = table.seats.filter((s) => s.name && !s.bot).map((s) => s.name!);
  const bots = table.seats.filter((s) => s.bot).length;
  const all = [...people, ...(bots ? [bots === 1 ? "a bot" : `${bots} bots`] : [])];
  return all.length > 1 ? `${all.slice(0, -1).join(", ")} and ${all.at(-1)}` : (all[0] ?? "Nobody yet");
}
