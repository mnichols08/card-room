// The lobby: tables that are open to anyone in the card room, not only people holding the link.
//
// Two ways in. "Find players" names a game: you're seated at a waiting table for that game if there
// is one, and otherwise a new open table is set up with your rules and you wait there. Or you look
// at every open table (who's playing what, and since when) and jump into one.
//
// An open table deals itself when its last seat is taken. People who are waiting say so every few
// seconds; a seat whose player has gone quiet is freed, and a table nobody is waiting at leaves the
// list, so the lobby never shows a table that no one is at.
//
//   lobby/open   server only: one field per listed table (its game, rules and when it opened)
//
// A table's public room doc carries `open: true` while it's listed, so its page can say so, and
// `host`: the seat of whoever opened it.
//
// Strangers. The host can remove a player before the deal, and that player can't sit back down at
// that table. Names on open tables go through a filter (names.ts). And a player can ask for a buzz
// when a table opens for a game they like:
//
// After the deal the table stays the host's: they can still remove a player (a computer player takes
// over the seat and plays on) and mute one, and its chat stays filtered. Blocking someone from the
// whole card room is its host's job, in the admin app (moderation.ts).
//
//   lobby/alerts   server only: one field per player who asked (the games they want to hear about)
import { kitGame, isKitGame } from "@cardroom/games";
import { familyTable, pickPersonas, validatePreset, type RulePreset } from "@spades/rules";
import { newPlayerId, playerCookie, playerOf, type RoomDoc } from "@spades/rooms/server";
import { GAMES, gameEmoji, gameName, gameOfOptions, isGameId, type GameId, type TableOptions } from "./games.js";
import { kitOptions } from "./kit.js";
import { maskText, nameOk } from "./names.js";
import { palaceOptions } from "./palace.js";
import type { Push } from "./push.js";

interface Entry {
  game: GameId;
  rules: string;
  /** When it was opened to everyone (ms). */
  created: number;
  /** The table's rules and size in one string, for players who only want a table set up exactly like theirs. */
  match?: string;
  /** Whoever opened it (a player id), or the longest-seated player since they left. They can remove players. */
  host?: string;
  /** Players the host removed: they can't sit back down here. */
  removed?: string[];
  /** Players the host muted: they can't chat here. */
  muted?: string[];
  /** The game has been dealt: no longer listed, but still the host's table. */
  dealt?: boolean;
}

export interface OpenTable extends Entry {
  id: string;
  seats: { name: string | null; bot: boolean }[];
  /** Seats nobody has taken. */
  free: number;
  /** The seat this browser holds there, or null. */
  seat: number | null;
}

interface Rooms {
  sync: {
    write(collection: string, key: string, fields: Record<string, unknown>): Promise<unknown>;
    documents(): Promise<{ get(collection: string, key: string): Record<string, unknown> | undefined }>;
  };
  create(options: TableOptions, settings?: unknown): Promise<string>;
  room(id: string): Promise<RoomDoc<unknown> | undefined>;
  holders(id: string): Promise<(string | null)[]>;
  seatPlayer(id: string, seat: number, player: string, name: string): Promise<void>;
  unseat(id: string, seat: number): Promise<boolean>;
  replaceWithBot(id: string, seat: number, name: string): Promise<boolean>;
  start(id: string): Promise<string | null>;
}

export interface LobbyOptions {
  mount?: string;
  /** How long (ms) a waiting player may go quiet before their seat is freed. Default 90 seconds. */
  quietAfter?: number;
  /** How many tables the lobby lists at once. Default 200. */
  limit?: number;
  /** The time (ms). For tests. */
  now?: () => number;
  /** Buzzes the players who asked to hear when a table opens. */
  push?: Push;
  /** The least time (ms) between two buzzes to one player about open tables. Default 10 minutes. */
  alertGap?: number;
  /** More words that names on open tables may not contain. */
  blockedNames?: string[];
  /** Whether new tables of a game may be opened (the card room's catalogue). */
  gameOn?: (game: GameId) => boolean | Promise<boolean>;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const cleanName = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 20) || "Player";
const BAD_NAME = "Pick a different name for an open table.";
/** What a listing is called for alerts: every game. */
const ANY = "any";

/** A dealt table is forgotten after this long, finished or not. */
const KEEP_DEALT_MS = 7 * 24 * 60 * 60 * 1000;

/** How often one player may have a new open table set up for them. */
const NEW_TABLE_GAP_MS = 3000;

/** A game's table options from what a page sent: checked, falling back to the game's own rules. */
function optionsFor(game: GameId, rules: unknown, seats: unknown): TableOptions {
  if (isKitGame(game)) return kitOptions(kitGame(game)!, rules, seats);
  if (game === "palace") return palaceOptions(rules, seats);
  const preset = rules && typeof rules === "object" ? ({ ...familyTable, ...(rules as RulePreset) } as RulePreset) : familyTable;
  try {
    return validatePreset(preset).length === 0 ? preset : familyTable;
  } catch {
    return familyTable;
  }
}

/** The same string for the same rules and table size, whatever they're called and whoever saved them. */
function fingerprint(game: GameId, options: TableOptions): string {
  const o = options as unknown as { rules?: Record<string, unknown>; seats?: number } & Record<string, unknown>;
  const { id: _id, name: _name, ...rules } = (game === "spades" ? o : (o.rules ?? {})) as Record<string, unknown>;
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify([game, game === "spades" ? 4 : o.seats, stable(rules)]);
}

export function createLobby(rooms: Rooms, { mount = "/lobby", quietAfter = 90_000, limit = 200, now = Date.now, push, alertGap = 600_000, blockedNames = [], gameOn = () => true }: LobbyOptions = {}) {
  const okName = (name: string) => nameOk(name, blockedNames);
  const lastBuzz = new Map<string, number>();
  const docs = rooms.sync.documents();
  /** When each waiting player was last heard from, by `<table>/<seat>`. Not kept across restarts: everyone gets a fresh start. */
  const heard = new Map<string, number>();
  const lastNew = new Map<string, number>();

  // One thing at a time: two people taking the last seat, or a seat being freed while someone sits.
  let queue: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };

  async function entries(): Promise<Record<string, Entry>> {
    const doc = (await docs).get("lobby", "open") ?? {};
    const found: Record<string, Entry> = {};
    for (const [id, value] of Object.entries(doc)) {
      const e = value as Entry | null;
      if (e && typeof e === "object" && isGameId(e.game)) found[id] = e;
    }
    return found;
  }
  const entry = async (id: string) => (await entries())[id];

  async function unlist(id: string) {
    for (const key of [...heard.keys()]) if (key.startsWith(`${id}/`)) heard.delete(key);
    if (!(await entry(id))) return;
    await rooms.sync.write("lobby", "open", { [id]: null });
    if (await rooms.room(id)) await rooms.sync.write("rooms", id, { open: false, host: null });
  }

  /** The game was dealt: off the list, but the host keeps their say, and the chat stays filtered. */
  async function dealt(id: string) {
    for (const key of [...heard.keys()]) if (key.startsWith(`${id}/`)) heard.delete(key);
    const e = await entry(id);
    if (!e || e.dealt) return;
    await rooms.sync.write("lobby", "open", { [id]: { ...e, dealt: true } });
    await rooms.sync.write("rooms", id, { open: false });
  }

  /** Forget a table for good: its game is over, or it was dealt long ago. */
  async function forget(id: string) {
    if (await entry(id)) await rooms.sync.write("lobby", "open", { [id]: null });
  }

  /** The host is whoever opened the table; if they've gone, the player in the first seat. */
  async function rehost(id: string, e: Entry, holders: (string | null)[], room: RoomDoc<unknown>) {
    if (!e.host || !holders.includes(e.host)) {
      e.host = holders.find(Boolean) ?? undefined;
      await rooms.sync.write("lobby", "open", { [id]: e });
    }
    const seat = e.host ? holders.indexOf(e.host) : null;
    if (room.host !== seat) await rooms.sync.write("rooms", id, { host: seat });
    const muted = holders.flatMap((h, i) => (h && e.muted?.includes(h) ? [i] : []));
    if (JSON.stringify(room.muted ?? []) !== JSON.stringify(muted)) await rooms.sync.write("rooms", id, { muted });
  }

  /**
   * Put an open table right: free the seats of people who've gone quiet, take it off the list if
   * nobody's waiting (or it's no longer a table people can join), and deal if every seat is taken.
   * Resolves to the table as the lobby shows it, or null if it isn't listed any more.
   */
  async function settle(id: string): Promise<{ entry: Entry; room: RoomDoc<unknown>; holders: (string | null)[] } | null> {
    const e = await entry(id);
    if (!e) return null;
    let room = await rooms.room(id);
    if (e.dealt) return void (room && now() - e.created < KEEP_DEALT_MS ? undefined : await forget(id)), null;
    if (room?.started) return void (await dealt(id)), null;
    if (!room || room.locked) return void (await unlist(id)), null;
    const at = now();
    for (const [seat, holder] of (await rooms.holders(id)).entries()) {
      if (!holder) continue;
      const key = `${id}/${seat}`;
      const last = heard.get(key);
      if (last === undefined) heard.set(key, at);
      else if (at - last > quietAfter) {
        heard.delete(key);
        await rooms.unseat(id, seat);
      }
    }
    // Someone the host removed came back by the table's link: no.
    for (const [seat, holder] of (await rooms.holders(id)).entries()) if (holder && e.removed?.includes(holder)) await rooms.unseat(id, seat);
    const holders = await rooms.holders(id);
    room = (await rooms.room(id))!;
    if (!holders.some(Boolean)) return void (await unlist(id)), null;
    // A name that came in by the table's link is shown to everyone too.
    if (room.seats.some((s, i) => holders[i] && s.name && !okName(s.name))) {
      await rooms.sync.write("rooms", id, { seats: room.seats.map((s, i) => (holders[i] && s.name && !okName(s.name) ? { ...s, name: "Player" } : s)) });
      room = (await rooms.room(id))!;
    }
    await rehost(id, e, holders, room);
    if (room.seats.every((s, i) => s.bot || holders[i])) {
      await rooms.start(id);
      await dealt(id);
      return null;
    }
    return { entry: e, room, holders };
  }

  async function list(player: string | null, game?: GameId): Promise<OpenTable[]> {
    const tables: OpenTable[] = [];
    for (const id of Object.keys(await entries())) {
      const t = await settle(id);
      if (!t || (game && t.entry.game !== game)) continue;
      tables.push({
        id,
        ...t.entry,
        seats: t.room.seats.map((s) => ({ name: s.name, bot: s.bot })),
        free: t.room.seats.filter((s, i) => !s.bot && !t.holders[i]).length,
        seat: player ? (t.holders.indexOf(player) >= 0 ? t.holders.indexOf(player) : null) : null,
      });
    }
    // The table that's waited longest first.
    return tables.sort((a, b) => a.created - b.created);
  }

  /** Sit a player in a listed table's first free seat. Resolves to the seat, or null if there isn't one. */
  async function takeSeat(id: string, player: string, name: string): Promise<number | null> {
    const t = await settle(id);
    if (!t) return null;
    const mine = t.holders.indexOf(player);
    if (mine >= 0) return heard.set(`${id}/${mine}`, now()), mine;
    const seat = t.room.seats.findIndex((s, i) => !s.bot && !t.holders[i]);
    if (seat < 0) return null;
    await rooms.seatPlayer(id, seat, player, name);
    heard.set(`${id}/${seat}`, now());
    await settle(id); // the last seat deals the game
    return seat;
  }

  /** Who asked to hear about which games: player id → game ids, or "any". */
  async function alerts(): Promise<Record<string, string[]>> {
    const doc = (await docs).get("lobby", "alerts") ?? {};
    return Object.fromEntries(Object.entries(doc).filter((e): e is [string, string[]] => Array.isArray(e[1]) && e[1].length > 0));
  }

  /** A table just opened: buzz the players who asked to hear about its game, but not too often. */
  async function announce(id: string) {
    const t = await settle(id);
    if (!t || !push?.enabled) return;
    const { game, rules } = t.entry;
    const host = t.room.seats[t.holders.indexOf(t.entry.host ?? "")]?.name ?? "Someone";
    const free = t.room.seats.filter((s, i) => !s.bot && !t.holders[i]).length;
    const at = now();
    for (const [player, games] of Object.entries(await alerts())) {
      if (t.holders.includes(player) || !(games.includes(ANY) || games.includes(game))) continue;
      if (at - (lastBuzz.get(player) ?? -Infinity) < alertGap) continue;
      lastBuzz.set(player, at);
      void push
        .notify(player, {
          title: `${host} is looking for ${gameName(game)} players ${gameEmoji(game)}`,
          body: `${rules ? `${rules}. ` : ""}${free === 1 ? "One seat open" : `${free} seats open`}. Tap to see the open tables.`,
          url: "/?lobby=1",
          tag: "lobby",
        })
        .catch((e) => console.error("lobby", e));
    }
  }

  /**
   * Take a person out of a seat at any table, listed or not. Before the deal the seat is free again;
   * after it, a computer player with a name nobody at the table has takes over and plays on.
   */
  async function evict(id: string, seat: number): Promise<boolean> {
    const room = await rooms.room(id);
    if (!room) return false;
    let gone: boolean;
    if (!room.started) gone = await rooms.unseat(id, seat);
    else {
      const taken = room.seats.flatMap((s) => (s.name ? [s.name] : []));
      gone = await rooms.replaceWithBot(id, seat, pickPersonas(1, Math.random, taken)[0]?.name ?? `Bot ${seat + 1}`);
    }
    // The table may need a new host, and its muted seats have moved.
    const e = await entry(id);
    const after = await rooms.room(id);
    if (gone && e?.dealt && after) await rehost(id, e, await rooms.holders(id), after);
    else if (gone && e) await settle(id);
    return gone;
  }

  async function open(id: string, room: RoomDoc<unknown>, host: string): Promise<string | null> {
    if (await entry(id)) return null;
    if (Object.values(await entries()).filter((e) => !e.dealt).length >= limit) return "The lobby is full right now. Try again in a little while.";
    const info = (room.info ?? {}) as { rules?: string };
    const game = gameOfOptions(room.info);
    // The table's own options, checked the same way a player's are, so equal rules compare equal.
    const given = ((await docs).get("games", id)?.options ?? {}) as { rules?: unknown; seats?: unknown };
    const match = fingerprint(game, optionsFor(game, game === "spades" ? given : given.rules, given.seats));
    await rooms.sync.write("lobby", "open", { [id]: { game, rules: String(info.rules ?? ""), created: now(), match, host } satisfies Entry });
    await rooms.sync.write("rooms", id, { open: true });
    return null;
  }

  async function handle(request: Request, path: string): Promise<Response> {
    const parts = path.split("/").filter(Boolean);
    const method = request.method;
    const player = playerOf(request);

    // GET /lobby[?game=hearts] → every open table: its game, who's there, and since when
    if (parts.length === 0 && method === "GET") {
      const asked = new URL(request.url).searchParams.get("game");
      const tables = await inTurn(() => list(player, isGameId(asked) ? asked : undefined));
      return json({ tables: tables.map(({ match: _match, host: _host, removed: _removed, muted: _muted, ...t }) => t) });
    }
    // GET /lobby/alerts → the games this player asked to hear about
    if (parts.length === 1 && parts[0] === "alerts" && method === "GET") {
      return json({ games: (player && (await alerts())[player]) || [], notifications: Boolean(push?.enabled) });
    }
    if (method !== "POST") return json({ error: "Not found" }, 404);
    const input = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const me = player ?? newPlayerId();
    const cookie: Record<string, string> = player ? {} : { "set-cookie": playerCookie(me, request) };

    // POST /lobby/alerts { games } → buzz me when a table opens for these games ("any" for every game; none to stop)
    if (parts.length === 1 && parts[0] === "alerts") {
      const games = [...new Set((Array.isArray(input.games) ? input.games : []).filter((g): g is string => g === ANY || isGameId(g)))];
      await rooms.sync.write("lobby", "alerts", { [me]: games.length ? games : null });
      return json({ games, notifications: Boolean(push?.enabled) }, 200, cookie);
    }

    // POST /lobby/join { game, name, rules?, seats?, settings?, sameRules? } → { id, seat, waiting }
    // A seat at a table that's waiting for this game; or a new open table with these rules. With
    // `sameRules`, only a table with exactly these rules and this many seats will do.
    if (parts.length === 1 && parts[0] === "join") {
      const game = input.game;
      const about = GAMES.find((g) => g.id === game);
      if (!isGameId(game) || !about) return json({ error: "Pick a game first." }, 400);
      if (about.seats[1] < 2) return json({ error: `${about.name} is a game for one.` }, 400);
      const name = cleanName(input.name);
      if (!okName(name)) return json({ error: BAD_NAME }, 400);
      return inTurn(async () => {
        const options = optionsFor(game, input.rules, input.seats);
        const wanted = fingerprint(game, options);
        const strict = input.sameRules === true;
        const waiting = (await list(me, game)).filter((t) => !t.removed?.includes(me));
        // Already waiting somewhere for this game: go back there. Else the same rules first, then
        // (unless only the same rules will do) whoever has waited longest.
        const choices = [
          ...waiting.filter((t) => t.seat !== null && (!strict || t.match === wanted)),
          ...waiting.filter((t) => t.seat === null && t.match === wanted),
          ...(strict ? [] : waiting.filter((t) => t.seat === null && t.match !== wanted)),
        ];
        for (const t of choices) {
          const seat = await takeSeat(t.id, me, name);
          if (seat !== null) return json({ id: t.id, seat, waiting: false }, 200, cookie);
        }
        const at = now();
        if (at - (lastNew.get(me) ?? 0) < NEW_TABLE_GAP_MS) return json({ error: "Give it a second, then try again." }, 429, cookie);
        if (Object.values(await entries()).filter((e) => !e.dealt).length >= limit) return json({ error: "The lobby is full right now. Try again in a little while." }, 503, cookie);
        if (!(await gameOn(game))) return json({ error: `${about.name} is switched off in this card room.` }, 403, cookie);
        lastNew.set(me, at);
        const id = await rooms.create(options, input.settings);
        await rooms.seatPlayer(id, 0, me, name);
        heard.set(`${id}/0`, at);
        await open(id, (await rooms.room(id))!, me);
        await announce(id);
        return json({ id, seat: 0, waiting: true }, 201, cookie);
      });
    }

    const id = parts[0]!;
    const action = parts[1] ?? "";

    // POST /lobby/:id/sit { name } → { seat }: jump into an open table's first free seat
    if (action === "sit") {
      const name = cleanName(input.name);
      if (!okName(name)) return json({ error: BAD_NAME }, 400);
      return inTurn(async () => {
        const t = await settle(id);
        if (!t) return json({ error: "That table isn't open any more." }, 404, cookie);
        if (t.entry.removed?.includes(me)) return json({ error: "You can't sit at that table." }, 403, cookie);
        const seat = await takeSeat(id, me, name);
        return seat === null ? json({ error: "Someone just took the last seat." }, 409, cookie) : json({ id, seat }, 200, cookie);
      });
    }

    const room = await rooms.room(id);
    if (!room) return json({ error: "There's no table with that code." }, 404);

    // POST /lobby/:id/remove { seat } → the host takes a player's seat away for good. Before the deal
    // the seat is free again; after it, a computer player takes over.
    // POST /lobby/:id/mute { seat, muted } → the host stops a player chatting here, or lets them again.
    if (action === "remove" || action === "mute") {
      return inTurn(async () => {
        await settle(id);
        const e = await entry(id);
        if (!e) return json({ error: "That only works at an open table." }, 404);
        if (!player || e.host !== player) return json({ error: "Only the table's host can do that." }, 403);
        const holders = await rooms.holders(id);
        const target = Number(input.seat);
        const who = Number.isInteger(target) ? holders[target] : null;
        if (!who || who === player) return json({ error: "There's nobody else in that seat." }, 400);
        if (action === "mute") {
          const muted = (e.muted ?? []).filter((p) => p !== who);
          if (input.muted !== false) muted.push(who);
          e.muted = muted.slice(-50);
          await rooms.sync.write("lobby", "open", { [id]: e });
          await rehost(id, e, holders, room);
          return json({ muted: input.muted !== false });
        }
        e.removed = [...(e.removed ?? []), who].slice(-50);
        await rooms.sync.write("lobby", "open", { [id]: e });
        await evict(id, target);
        return json({ ok: true });
      });
    }

    const seat = player ? (await rooms.holders(id)).indexOf(player) : -1;
    if (seat < 0) return json({ error: "Take a seat first." }, 403);

    // POST /lobby/:id/here → still waiting at this table
    if (action === "here") {
      heard.set(`${id}/${seat}`, now());
      return json({ ok: true, open: Boolean(await entry(id)) });
    }

    // POST /lobby/:id/open { open } → anyone seated opens the table to everyone, or closes it again
    if (action === "open") {
      return inTurn(async () => {
        if (input.open === false) return void (await unlist(id)), json({ open: false });
        if (room.started) return json({ error: "This game has started." }, 409);
        if (room.locked) return json({ error: "The seats at this table are already set." }, 409);
        if (room.seats.length < 2) return json({ error: "This is a game for one." }, 400);
        const holders = await rooms.holders(id);
        if (room.seats.every((s, i) => s.bot || holders[i])) return json({ error: "Every seat is taken. Free one up first, or deal." }, 409);
        const fresh = !(await entry(id));
        const problem = await open(id, room, player!);
        if (problem) return json({ error: problem }, 503);
        heard.set(`${id}/${seat}`, now());
        if (fresh) await announce(id);
        else await settle(id);
        return json({ open: true });
      });
    }

    return json({ error: "Not found" }, 404);
  }

  return {
    /** The open tables, as a page sees them. */
    list: (game?: GameId) => inTurn(() => list(null, game)),
    /** The seats at a table changed: an open table that's now full deals itself. */
    seatsChanged: (id: string) => void inTurn(() => settle(id)).catch((e) => console.error("lobby", e)),
    /** A game started (someone dealt, or the last seat was taken): it's no longer waiting for anyone. */
    started: (id: string) => void inTurn(() => dealt(id)).catch((e) => console.error("lobby", e)),
    /** A game ended: nothing more to keep about its table. */
    finished: (id: string) => void inTurn(() => forget(id)).catch((e) => console.error("lobby", e)),
    /** A message on its way into a table's chat: at a table that is or was open, muted players are turned away and crude words covered. */
    async beforeSay(id: string, seat: number, text: string): Promise<string | { error: string }> {
      const e = await entry(id);
      if (!e) return text;
      const who = (await rooms.holders(id))[seat];
      if (who && e.muted?.includes(who)) return { error: "You've been muted at this table." };
      return maskText(text, blockedNames);
    },
    async fetch(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url);
      const base = mount.replace(/\/$/, "");
      if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
      return handle(request, pathname.slice(base.length));
    },
  };
}
