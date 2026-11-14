// Moderation: what the person who runs this card room can see and do about its tables and the
// people at them. The admin app (packages/admin, served at /admin/) is its only page.
//
// It's off until the server has an admin token (CARDROOM_ADMIN_TOKEN). Every request carries it as
// `Authorization: Bearer <token>`; there are no accounts.
//
// People here are player cookies, which are secrets: whoever holds one is that player. So the admin
// never sees them. A player is shown by a reference (a hash of the cookie) that's enough to pick
// them out and block them, and useless for being them.
//
//   moderation/bans   server only: one field per blocked player's reference
//   moderation/log    server only: what the admin did, one field per action
import { createHash, timingSafeEqual } from "node:crypto";
import { playerOf, type ChatMessage, type RoomDoc } from "@spades/rooms/server";
import type { Catalogue } from "./catalogue.js";
import type { Designs } from "./designs.js";
import type { HouseDoc } from "./houses.js";
import { gameName, gameOfOptions } from "./games.js";

interface Rooms {
  sync: {
    write(collection: string, key: string, fields: Record<string, unknown>): Promise<unknown>;
    documents(): Promise<{
      get(collection: string, key: string): Record<string, unknown> | undefined;
      all(collection: string, prefix?: string): Array<{ key: string } & Record<string, unknown>>;
    }>;
  };
  closeTable(id: string, reason: string): Promise<boolean>;
  removePlayer(id: string, seat: number, bot?: string): Promise<string | null>;
  redact(id: string, key: string): Promise<boolean>;
}

/** The parts of the houses module moderation uses. */
interface Houses {
  all(): Promise<HouseDoc[]>;
  moderate(slug: string, change: { name?: unknown; removeMember?: string; owner?: string; delete?: true }): Promise<string | null>;
}

export interface Ban {
  reason: string;
  at: number;
  /** The name they went by when they were blocked, for the list. */
  name: string;
}

export interface LogEntry {
  at: number;
  action: string;
  /** What it was done to, in words. */
  target: string;
  note: string;
}

/** What everyone but the admin is told when a blocked player tries to do something. */
export const BLOCKED_MESSAGE = "This card room's host has blocked you from playing here.";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const digest = (text: string) => createHash("sha256").update(text).digest();

/** A player's reference: stable, safe to show the admin, and no use as a cookie. */
export const playerRef = (player: string) => digest(`cardroom-player:${player}`).toString("hex").slice(0, 16);

const finished = (summary: unknown) => {
  const s = summary as { phase?: string; over?: boolean } | null;
  return s?.phase === "finished" || s?.over === true;
};

/** How many wrong tokens a minute before everyone waits. */
const WRONG_TOKENS_PER_MINUTE = 20;

export function createModeration(rooms: Rooms, designs: Designs, { token, houses, catalogue, mount = "/moderation", now = () => Date.now() }: { token?: string; houses?: Houses; catalogue?: Catalogue; mount?: string; now?: () => number } = {}) {
  const secret = token?.trim() ? digest(token.trim()) : null;
  const docs = rooms.sync.documents();
  let wrong: number[] = [];
  let logged: number | null = null;

  const bans = async () => {
    const doc = ((await docs).get("moderation", "bans") ?? {}) as Record<string, Ban | null>;
    return new Map(Object.entries(doc).filter((e): e is [string, Ban] => /^[0-9a-f]{16}$/.test(e[0]) && !!e[1] && typeof e[1] === "object"));
  };

  async function record(action: string, target: string, note = "") {
    const view = await docs;
    logged ??= Object.keys(view.get("moderation", "log") ?? {}).filter((k) => /^a\d+$/.test(k)).length;
    const entry: LogEntry = { at: now(), action, target, note };
    await rooms.sync.write("moderation", "log", { [`a${String(logged++).padStart(6, "0")}`]: entry });
  }

  /** Every table, with who's at it. Player ids stay in here: `tablesShown` is what a page gets. */
  async function tables() {
    const view = await docs;
    const blocked = await bans();
    const houseOf = new Map<string, { slug: string; name: string }>();
    for (const house of view.all("houses") as unknown as { slug: string; name: string; tables?: { id: string }[] }[])
      for (const t of house.tables ?? []) houseOf.set(t.id, { slug: house.slug, name: house.name });
    return view.all("rooms").map((doc) => {
      const room = doc as unknown as RoomDoc<unknown> & { key: string };
      const game = view.get("games", room.key) as { options?: unknown; holders?: (string | null)[] } | undefined;
      const id = gameOfOptions(game?.options ?? room.info ?? room.summary);
      const chat = view.get("chat", room.key) ?? {};
      return {
        id: room.key,
        game: id,
        gameName: gameName(id),
        rules: String((room.info as { rules?: unknown } | null)?.rules ?? ""),
        label: room.label ?? "",
        house: houseOf.get(room.key) ?? null,
        started: !!room.started,
        finished: finished(room.summary),
        closed: room.closed ?? "",
        messages: Object.keys(chat).filter((k) => /^m\d+$/.test(k)).length,
        seats: (room.seats ?? []).map((seat, i) => {
          const holder = game?.holders?.[i] ?? null;
          const ref = holder ? playerRef(holder) : null;
          return { seat: i, name: seat.name, bot: !!seat.bot, holder, player: ref, blocked: ref !== null && blocked.has(ref) };
        }),
      };
    });
  }
  type Table = Awaited<ReturnType<typeof tables>>[number];
  const status = (t: Table) => (t.closed ? "closed" : t.finished ? "finished" : t.started ? "playing" : "open");
  const tableShown = (t: Table) => ({ ...t, status: status(t), seats: t.seats.map(({ holder: _secret, ...seat }) => seat) });

  /** Everyone this server knows: from seats, houses, challenge links and saved designs. */
  async function players() {
    const view = await docs;
    const blocked = await bans();
    const people = new Map<string, { player: string; names: Set<string>; tables: { id: string; game: string; seat: number; status: string }[]; houses: { slug: string; name: string; role: string }[]; designs: number; challenge: boolean }>();
    const person = (player: string, name?: string | null) => {
      let p = people.get(player);
      if (!p) people.set(player, (p = { player, names: new Set(), tables: [], houses: [], designs: 0, challenge: false }));
      if (name) p.names.add(name);
      return p;
    };
    for (const t of await tables()) for (const s of t.seats) if (s.holder) person(s.holder, s.name).tables.push({ id: t.id, game: t.gameName, seat: s.seat, status: status(t) });
    for (const house of view.all("houses") as unknown as { slug: string; name: string; members?: { player: string; name: string; role: string }[] }[])
      for (const m of house.members ?? []) person(m.player, m.name).houses.push({ slug: house.slug, name: house.name, role: m.role });
    for (const c of view.all("challenges") as unknown as { player?: string; name?: string }[]) if (c.player) person(c.player, c.name).challenge = true;
    for (const d of await designs.all()) person(d.owner, d.author).designs += 1;
    return [...people.values()].map((p) => {
      const ref = playerRef(p.player);
      return { ref, player: p.player, names: [...p.names], tables: p.tables, houses: p.houses, designs: p.designs, challenge: p.challenge, ban: blocked.get(ref) ?? null };
    });
  }
  type Person = Awaited<ReturnType<typeof players>>[number];
  const personShown = ({ player: _secret, ...p }: Person) => ({ ...p, name: p.names[0] ?? p.ban?.name ?? "Unnamed player", seated: p.tables.filter((t) => t.status === "open" || t.status === "playing").length });

  function allowed(request: Request): Response | null {
    if (!secret) return json({ error: "Moderation is off. Set CARDROOM_ADMIN_TOKEN on the server to turn it on." }, 503);
    const at = now();
    wrong = wrong.filter((t) => at - t < 60_000);
    if (wrong.length >= WRONG_TOKENS_PER_MINUTE) return json({ error: "Too many wrong tokens. Wait a minute." }, 429);
    const given = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (given && timingSafeEqual(digest(given), secret)) return null;
    wrong.push(at);
    return json({ error: given ? "That isn't this card room's admin token." : "Sign in with the admin token." }, 401);
  }

  async function handle(request: Request, path: string): Promise<Response> {
    const refused = allowed(request);
    if (refused) return refused;
    const parts = path.split("/").filter(Boolean);
    const [area = "", id = "", action = ""] = parts;
    const method = request.method;
    const input = method === "POST" ? (((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>) : {};
    const view = await docs;

    // GET /moderation/overview → the numbers on the front page
    if (area === "overview" && method === "GET") {
      const all = await tables();
      const count = (s: string) => all.filter((t) => status(t) === s).length;
      const made = await designs.all();
      return json({
        tables: { total: all.length, open: count("open"), playing: count("playing"), finished: count("finished"), closed: count("closed") },
        players: (await players()).length,
        blocked: (await bans()).size,
        houses: view.all("houses").length,
        designs: { total: made.length, shared: made.filter((d) => d.shared && !d.hidden).length, hidden: made.filter((d) => d.hidden).length },
      });
    }

    // GET /moderation/log → what's been done, newest first
    if (area === "log" && method === "GET") {
      const entries = Object.entries(view.get("moderation", "log") ?? {})
        .filter(([k]) => /^a\d+$/.test(k))
        .sort(([a], [b]) => (a < b ? 1 : -1))
        .slice(0, 200)
        .map(([key, entry]) => ({ id: key, ...(entry as LogEntry) }));
      return json({ log: entries });
    }

    if (area === "tables") {
      const all = await tables();
      // GET /moderation/tables → every table: the ones still going first
      if (!id && method === "GET") {
        const order = ["playing", "open", "finished", "closed"];
        return json({ tables: all.map(tableShown).sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)) });
      }
      const table = all.find((t) => t.id === id);
      if (!table) return json({ error: "There's no table with that code." }, 404);
      const name = `${table.gameName} table ${table.id}`;
      // GET /moderation/tables/:id → the table and its chat
      if (!action && method === "GET") {
        const chat = Object.entries(view.get("chat", id) ?? {})
          .filter(([k]) => /^m\d+$/.test(k))
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([key, m]) => ({ key, ...(m as ChatMessage) }));
        return json({ table: tableShown(table), chat });
      }
      if (method !== "POST") return json({ error: "Not found" }, 404);
      // POST /moderation/tables/:id/close { reason } → nobody can sit, move or talk there again
      if (action === "close") {
        if (table.closed) return json({ error: "That table is already closed." }, 409);
        const reason = clean(input.reason, 200) || "This table was closed by the card room's host.";
        await rooms.closeTable(id, reason);
        await record("Closed a table", name, reason);
        return json({ ok: true });
      }
      // POST /moderation/tables/:id/unseat { seat } → out of the seat (a bot plays on if the game has started)
      if (action === "unseat") {
        const seat = Number(input.seat);
        const who = table.seats[seat]?.name ?? `Seat ${seat + 1}`;
        const problem = await rooms.removePlayer(id, seat);
        if (problem) return json({ error: problem }, 409);
        await record("Removed a player from a table", `${who} at ${name}`, clean(input.reason, 200));
        return json({ ok: true });
      }
      // POST /moderation/tables/:id/redact { key } → a chat message's words are gone
      if (action === "redact") {
        const key = String(input.key ?? "");
        const message = (view.get("chat", id) ?? {})[key] as ChatMessage | undefined;
        if (!(await rooms.redact(id, key))) return json({ error: "There's no such message." }, 404);
        await record("Removed a chat message", `${message?.name ?? "Someone"} at ${name}`, clean(message?.text, 120));
        return json({ ok: true });
      }
      return json({ error: "Not found" }, 404);
    }

    if (area === "players") {
      const all = await players();
      // GET /moderation/players → everyone, blocked first, then whoever's at a table
      if (!id && method === "GET") {
        const list = all.map(personShown).sort((a, b) => Number(!!b.ban) - Number(!!a.ban) || b.seated - a.seated || a.name.localeCompare(b.name));
        // Blocked players who've left no other trace still belong in the list.
        const known = new Set(list.map((p) => p.ref));
        for (const [ref, ban] of await bans()) if (!known.has(ref)) list.unshift({ ref, names: [ban.name], name: ban.name, tables: [], houses: [], designs: 0, challenge: false, ban, seated: 0 });
        return json({ players: list });
      }
      if (!/^[0-9a-f]{16}$/.test(id) || method !== "POST") return json({ error: "Not found" }, 404);
      const person = all.find((p) => p.ref === id);
      // POST /moderation/players/:ref/block { reason } → they can't sit, play, talk or share here any more
      if (action === "block") {
        if (!person) return json({ error: "There's no such player." }, 404);
        const ban: Ban = { reason: clean(input.reason, 200), at: now(), name: person.names[0] ?? "Unnamed player" };
        await rooms.sync.write("moderation", "bans", { [id]: ban });
        // Tables they're at shouldn't wait on someone who can't move: a bot takes over, or the seat frees.
        for (const t of person.tables) if (t.status === "open" || t.status === "playing") await rooms.removePlayer(t.id, t.seat);
        await record("Blocked a player", ban.name, ban.reason);
        return json({ ok: true });
      }
      // POST /moderation/players/:ref/unblock → welcome back
      if (action === "unblock") {
        const ban = (await bans()).get(id);
        if (!ban) return json({ error: "That player isn't blocked." }, 409);
        await rooms.sync.write("moderation", "bans", { [id]: null });
        await record("Unblocked a player", person?.names[0] ?? ban.name);
        return json({ ok: true });
      }
      return json({ error: "Not found" }, 404);
    }

    if (area === "houses" && houses) {
      const all = await houses.all();
      const blocked = await bans();
      // GET /moderation/houses → every house and who's in it
      if (!id && method === "GET") {
        return json({
          houses: all
            .map((h) => ({
              slug: h.slug,
              name: h.name,
              tables: h.tables.length,
              tournaments: h.tournaments?.length ?? 0,
              members: h.members.map((m) => ({ id: m.id, name: m.name, role: m.role, joined: m.joined, player: playerRef(m.player), blocked: blocked.has(playerRef(m.player)) })),
            }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
      const house = all.find((h) => h.slug === id);
      if (!house || method !== "POST") return json({ error: "There's no such house." }, 404);
      const member = house.members.find((m) => m.id === input.member);
      const done = async (problem: string | null, what: string, target: string, note = "") => {
        if (problem) return json({ error: problem }, 409);
        await record(what, target, note);
        return json({ ok: true });
      };
      // POST /moderation/houses/:slug/rename { name } → a new name (its link stays the same)
      if (action === "rename") return done(await houses.moderate(id, { name: input.name }), "Renamed a house", house.name, `Now “${clean(input.name, 30)}”`);
      // POST /moderation/houses/:slug/remove-member { member } → out of the house
      if (action === "remove-member") return done(await houses.moderate(id, { removeMember: String(input.member ?? "") }), "Removed a member from a house", `${member?.name ?? "Someone"} from ${house.name}`);
      // POST /moderation/houses/:slug/owner { member } → the house's new owner; the old one stays as an admin
      if (action === "owner") return done(await houses.moderate(id, { owner: String(input.member ?? "") }), "Changed a house's owner", house.name, `Now ${member?.name ?? "someone"}`);
      // POST /moderation/houses/:slug/delete → gone, for everyone; its tables carry on
      if (action === "delete") return done(await houses.moderate(id, { delete: true }), "Deleted a house", house.name);
      return json({ error: "Not found" }, 404);
    }

    if (area === "games" && catalogue) {
      // GET /moderation/games → every game in order, on or off, and the watching switch
      if (method === "GET") return json(await catalogue.state());
      // POST /moderation/games { order?, off?, watching? } → the catalogue, changed
      if (method === "POST") {
        const problem = await catalogue.set({ order: input.order, off: input.off, watching: input.watching });
        if (problem) return json({ error: problem }, 409);
        const parts = [input.order !== undefined ? "order" : "", input.off !== undefined ? "which games are on" : "", input.watching !== undefined ? `watching ${input.watching === true ? "on" : "off"}` : ""].filter(Boolean);
        await record("Changed the games", parts.join(", ") || "nothing");
        return json(await catalogue.state());
      }
    }

    if (area === "designs") {
      const made = await designs.all();
      const blocked = await bans();
      // GET /moderation/designs → every shared design (hidden ones too), newest first
      if (!id && method === "GET") {
        return json({
          designs: made
            .filter((d) => d.shared || d.hidden)
            .map((d) => ({ id: d.id, author: d.author, design: d.design, created: d.created, shared: d.shared, hidden: d.hidden ?? "", player: playerRef(d.owner), blocked: blocked.has(playerRef(d.owner)) })),
        });
      }
      const design = made.find((d) => d.id === id);
      if (!design || method !== "POST") return json({ error: "There's no such design." }, 404);
      const name = `“${design.design.name}” by ${design.author}`;
      // POST /moderation/designs/:id/hide { reason } → out of the gallery; its maker sees why
      if (action === "hide") {
        const reason = clean(input.reason, 200) || "The card room's host took this out of the gallery.";
        await designs.hide(id, reason);
        await record("Hid a card design", name, reason);
        return json({ ok: true });
      }
      // POST /moderation/designs/:id/restore → back in the gallery
      if (action === "restore") {
        await designs.restore(id);
        await record("Restored a card design", name);
        return json({ ok: true });
      }
    }
    return json({ error: "Not found" }, 404);
  }

  return {
    /** Whether the server has an admin token. */
    enabled: secret !== null,
    /** Whether this request comes from a blocked player. */
    async blocked(request: Request): Promise<boolean> {
      const player = playerOf(request);
      return player !== null && (await bans()).has(playerRef(player));
    },
    /** Answers /moderation requests; null for anything else. */
    async fetch(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url);
      if (pathname !== mount && !pathname.startsWith(`${mount}/`)) return null;
      return handle(request, pathname.slice(mount.length));
    },
  };
}
