// The server's moderation endpoints (packages/server/src/moderation.ts). Every request carries the
// admin token; the server never sends a player's cookie, only a reference to pick them out by.
import type { CardDesign } from "@cardroom/decks";

export type TableStatus = "open" | "playing" | "finished" | "closed";

export interface Seat {
  seat: number;
  name: string | null;
  bot: boolean;
  /** The player's reference, or null for a bot or an empty seat. */
  player: string | null;
  blocked: boolean;
}

export interface Table {
  id: string;
  game: string;
  gameName: string;
  rules: string;
  label: string;
  house: { slug: string; name: string } | null;
  started: boolean;
  finished: boolean;
  /** Why it was closed, or "". */
  closed: string;
  status: TableStatus;
  messages: number;
  seats: Seat[];
}

export interface ChatLine {
  key: string;
  seat: number;
  name: string;
  text: string;
  at: number;
  bot: boolean;
  removed?: boolean;
}

export interface Ban {
  reason: string;
  at: number;
  name: string;
}

export interface Player {
  ref: string;
  name: string;
  names: string[];
  tables: { id: string; game: string; seat: number; status: TableStatus }[];
  houses: { slug: string; name: string; role: string }[];
  designs: number;
  challenge: boolean;
  seated: number;
  ban: Ban | null;
}

export interface SharedDesign {
  id: string;
  author: string;
  design: CardDesign;
  created: number;
  shared: boolean;
  /** Why it was hidden, or "". */
  hidden: string;
  player: string;
  blocked: boolean;
}

export interface Overview {
  tables: { total: number; open: number; playing: number; finished: number; closed: number };
  players: number;
  blocked: number;
  houses: number;
  designs: { total: number; shared: number; hidden: number };
}

export interface LogEntry {
  id: string;
  at: number;
  action: string;
  target: string;
  note: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The moderation endpoints sit beside the app: /admin/ → /moderation. */
const BASE = new URL("../moderation", document.baseURI).href;

export class Api {
  constructor(private readonly token: () => string) {}

  private async send<T>(path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(BASE + path, {
        method: body === undefined ? "GET" : "POST",
        headers: { authorization: `Bearer ${this.token()}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      throw new ApiError("Couldn't reach the card room. Check your connection and try again.", 0);
    }
    const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!response.ok || !answer) throw new ApiError(answer?.error ?? `The card room answered ${response.status}.`, response.status);
    return answer;
  }

  overview = () => this.send<Overview>("/overview");
  tables = () => this.send<{ tables: Table[] }>("/tables").then((r) => r.tables);
  table = (id: string) => this.send<{ table: Table; chat: ChatLine[] }>(`/tables/${id}`);
  players = () => this.send<{ players: Player[] }>("/players").then((r) => r.players);
  designs = () => this.send<{ designs: SharedDesign[] }>("/designs").then((r) => r.designs);
  log = () => this.send<{ log: LogEntry[] }>("/log").then((r) => r.log);

  closeTable = (id: string, reason: string) => this.send(`/tables/${id}/close`, { reason });
  unseat = (id: string, seat: number) => this.send(`/tables/${id}/unseat`, { seat });
  redact = (id: string, key: string) => this.send(`/tables/${id}/redact`, { key });
  block = (ref: string, reason: string) => this.send(`/players/${ref}/block`, { reason });
  unblock = (ref: string) => this.send(`/players/${ref}/unblock`, {});
  hideDesign = (id: string, reason: string) => this.send(`/designs/${id}/hide`, { reason });
  restoreDesign = (id: string) => this.send(`/designs/${id}/restore`, {});
}
