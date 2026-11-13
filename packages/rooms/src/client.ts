// The browser side of a room: follow the public room and your own seat's view through
// @zubra/sync, and send moves to the server. Framework-agnostic: React, Vue, a Zubra component
// or plain script can all subscribe.
import { configure, indexedDBStore, memoryStore, type Store } from "@zubra/sync";
import { connect } from "@zubra/sync/connect";
import type { RoomDoc, ViewDoc } from "./server.js";

type Listener = (doc: Record<string, unknown>) => void;

// Sync has no plain-JavaScript subscription yet: documents reach components through
// 'use collection'. Its store is public API, though, and every change it receives is stored, so
// a store that tells us about each save is how a page without a component follows a document.
const listeners = new Map<string, Set<Listener>>();
let watched: Store | null = null;

function watchStore(): Store {
  if (watched) return watched;
  const inner = typeof indexedDB === "undefined" ? memoryStore() : indexedDBStore();
  watched = {
    get: (collection, key) => inner.get(collection, key),
    async set(collection, key, fields) {
      await inner.set(collection, key, fields);
      const subs = listeners.get(`${collection}\u0000${key}`);
      if (!subs?.size) return;
      const doc = (await inner.get(collection, key)) ?? {};
      for (const fn of subs) fn(doc);
    },
  };
  configure({ store: watched });
  return watched;
}

function follow(collection: string, key: string, fn: Listener): () => void {
  const store = watchStore();
  const id = `${collection}\u0000${key}`;
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(fn);
  void store.get(collection, key).then((doc) => doc && fn(doc));
  return () => listeners.get(id)?.delete(fn);
}

export interface RoomInfo<Summary = unknown> extends RoomDoc<Summary> {
  id: string;
  /** The seat this browser holds, or null. */
  seat: number | null;
}

export class RoomError extends Error {
  override name = "RoomError";
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface OpenRoomOptions {
  /** Where the rooms endpoints live. Default `/rooms`. */
  base?: string;
  /** Where the sync log is served. Default `/_zb/sync`. */
  sync?: string;
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin", headers: { "content-type": "application/json" }, ...init });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new RoomError(body.error ?? `Request failed (${response.status})`, response.status);
  return body;
}

/** Create a room on the server. Resolves to its id. */
export async function createRoom(options: unknown, { base = "/rooms" }: OpenRoomOptions = {}): Promise<string> {
  const { id } = await call<{ id: string }>(base, { method: "POST", body: JSON.stringify({ options }) });
  return id;
}

export function openRoom<View = unknown, Move = unknown, Summary = unknown>(id: string, { base = "/rooms", sync = "/_zb/sync" }: OpenRoomOptions = {}) {
  const url = `${base}/${encodeURIComponent(id)}`;
  watchStore();
  const scope = { rooms: id, views: `${id}/` };
  let connection = connect({ url: sync, scope });
  const post = <T>(path: string, body: unknown = {}) => call<T>(`${url}/${path}`, { method: "POST", body: JSON.stringify(body) });

  // The live stream is authorized with the cookies it was opened with. Sitting down can give this
  // browser its player cookie, so open the stream again to be sent this seat's view.
  async function sit(seat: number, name: string) {
    const result = await post<{ seat: number }>("sit", { seat, name });
    connection.stop();
    connection = connect({ url: sync, scope });
    return result;
  }

  return {
    id,
    /** The public room as the server has it now, and the seat this browser holds. */
    info: () => call<RoomInfo<Summary>>(url),
    /** Follow the public room: seats, whether it started, the summary. */
    onRoom(fn: (room: RoomDoc<Summary>) => void) {
      return follow("rooms", id, (doc) => fn(doc as unknown as RoomDoc<Summary>));
    },
    /** Follow one seat's view. The server only sends it to that seat's holder. */
    onView(seat: number, fn: (view: ViewDoc<View>) => void) {
      return follow("views", `${id}/${seat}`, (doc) => doc.view !== undefined && fn(doc as unknown as ViewDoc<View>));
    },
    sit,
    addBot: (seat: number, name?: string) => post("bot", { seat, name }),
    removeBot: (seat: number) => post("bot", { seat, add: false }),
    start: () => post("start"),
    act: (move: Move) => post("act", { move }),
    /** Pull now, instead of waiting for the live stream. */
    refresh: () => connection.pull(),
    close: () => connection.stop(),
  };
}

export type Room<View = unknown, Move = unknown, Summary = unknown> = ReturnType<typeof openRoom<View, Move, Summary>>;
