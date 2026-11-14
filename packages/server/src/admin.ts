// The card room's admin: whoever runs the server. There are no accounts: the server has a key
// (CARDROOM_ADMIN_KEY), and a device that has entered it once is an admin from then on.
//
// An admin can block a player from the whole card room. A blocked player's browser can still look,
// but can't sit, chat, play, open tables or send challenges. A block follows the browser's player
// cookie, so it stops the casual pest, not someone who clears their cookies and comes back.
//
//   admin/blocked   server only: one field per blocked player
import { createHash, timingSafeEqual } from "node:crypto";
import { overHttps, playerOf } from "@spades/rooms/server";

interface Rooms {
  sync: {
    write(collection: string, key: string, fields: Record<string, unknown>): Promise<unknown>;
    documents(): Promise<{ get(collection: string, key: string): Record<string, unknown> | undefined }>;
  };
  room(id: string): Promise<{ seats: { name: string | null; bot: boolean }[] } | undefined>;
  holders(id: string): Promise<(string | null)[]>;
}

export interface AdminOptions {
  /** The admin key. Without one there is no admin. */
  key?: string;
  mount?: string;
  /** Takes a person out of a seat (see the lobby's evict). */
  evict?: (id: string, seat: number) => Promise<boolean>;
}

interface Blocked {
  player: string;
  name: string;
  at: number;
}

const COOKIE = "cardroom_admin";
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** A blocked player's public id: safe to show an admin, and no use to anyone as a player cookie. */
const publicId = (player: string) => `b${sha(`blocked:${player}`).slice(0, 16)}`;

/** Wrong keys allowed in a minute, from everyone together, before sign-in waits. */
const TRIES_PER_MINUTE = 5;

export function createAdmin(rooms: Rooms, { key, mount = "/admin", evict }: AdminOptions = {}) {
  const enabled = typeof key === "string" && key.trim().length >= 8;
  // The cookie holds a hash of the key, so the key itself never sits in a browser.
  const token = enabled ? sha(`cardroom-admin:${key!.trim()}`) : "";
  const docs = rooms.sync.documents();
  let misses: number[] = [];

  function isAdmin(request: Request): boolean {
    if (!enabled) return false;
    const given = (request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]+)`))?.[1];
    return !!given && same(given, token);
  }

  async function blocked(): Promise<Record<string, Blocked>> {
    const doc = (await docs).get("admin", "blocked") ?? {};
    return Object.fromEntries(Object.entries(doc).filter((e): e is [string, Blocked] => /^b[a-f0-9]{16}$/.test(e[0]) && !!e[1] && typeof (e[1] as Blocked).player === "string"));
  }

  async function handle(request: Request, path: string): Promise<Response> {
    const action = path.split("/").filter(Boolean).join("/");
    const method = request.method;
    const admin = isAdmin(request);
    if (action === "me" && method === "GET") return json({ enabled, admin });
    const cookie = (value: string, age: number) => ({ "set-cookie": `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${overHttps(request) ? "; Secure" : ""}` });
    const input = method === "POST" ? (((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>) : {};

    if (action === "signin" && method === "POST") {
      if (!enabled) return json({ error: "This card room has no admin key set." }, 503);
      const at = Date.now();
      misses = misses.filter((t) => at - t < 60_000);
      if (misses.length >= TRIES_PER_MINUTE) return json({ error: "Too many tries. Wait a minute." }, 429);
      if (!same(sha(`cardroom-admin:${String(input.key ?? "").trim()}`), token)) return misses.push(at), json({ error: "That isn't the key." }, 403);
      return json({ enabled, admin: true }, 200, cookie(token, 31536000));
    }
    if (action === "signout" && method === "POST") return json({ enabled, admin: false }, 200, cookie("", 0));

    if (!admin) return json({ error: "Sign in as the card room's admin first." }, 403);

    // GET /admin/blocked → who's blocked, newest first
    if (action === "blocked" && method === "GET") {
      const list = Object.entries(await blocked()).map(([id, b]) => ({ id, name: b.name, at: b.at }));
      return json({ blocked: list.sort((a, b) => b.at - a.at) });
    }
    // POST /admin/block { table, seat } → block whoever holds that seat, and take them out of it
    if (action === "block" && method === "POST") {
      const table = String(input.table ?? "");
      const seat = Number(input.seat);
      const who = Number.isInteger(seat) ? (await rooms.holders(table))[seat] : null;
      if (!who) return json({ error: "There's nobody in that seat." }, 400);
      if (who === playerOf(request)) return json({ error: "That's you." }, 400);
      const name = (await rooms.room(table))?.seats[seat]?.name ?? "Player";
      await rooms.sync.write("admin", "blocked", { [publicId(who)]: { player: who, name, at: Date.now() } satisfies Blocked });
      await evict?.(table, seat);
      return json({ ok: true, id: publicId(who), name });
    }
    // POST /admin/unblock { id }
    if (action === "unblock" && method === "POST") {
      const id = String(input.id ?? "");
      if (!(await blocked())[id]) return json({ error: "Nobody's blocked under that id." }, 404);
      await rooms.sync.write("admin", "blocked", { [id]: null });
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }

  return {
    enabled,
    isAdmin,
    /** Whether this player has been blocked from the card room. */
    async isBlocked(player: string | null): Promise<boolean> {
      return !!player && !!(await blocked())[publicId(player)];
    },
    async fetch(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url);
      const base = mount.replace(/\/$/, "");
      if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
      return handle(request, pathname.slice(base.length));
    },
  };
}
