// Rooms: turn-based games (or anything with private per-person state) over @zubra/sync.
//
// The server is the only writer. A page never writes a document; it sends a move to
// `POST <mount>/<id>/act`, the room's `act` decides it, and the server writes every seat's view.
// `authorize` lets a player read only their own seat's view, so a hand stays in one browser.
//
// Collections:
//   rooms/<id>          public: seats (names, bots), whether it started, a summary   (everyone reads)
//   views/<id>/<seat>   one seat's view of the game                                  (that seat only)
//   games/<id>          options, seed and seat holders                               (server only)
//   moves/<id>          every move, one field per move, for replays and restarts     (server only)
//   chat/<id>           the table's chat, one field per message                       (everyone)
import { createSyncServer, memoryLog, type Log } from "@zubra/sync/server";

export interface RoomDefinition<State, Move, View, Options, Summary = unknown> {
  /** Seats at the table: a number, or worked out from the room's options (a game for 2 to 6, say). */
  seats: number | ((options: Options) => number);
  /** A new game, from the options a room was created with and a seed. */
  setup(options: Options, seed: number): State;
  /** Apply a move by a seat. Throw a RefusedMove (or any Error) to refuse it; the message goes back to the player. */
  act(state: State, seat: number, move: Move): State;
  /** What one seat may see. */
  view(state: State, seat: number): View;
  /** What everyone may see (lobby, scoreboards, a blog embed). */
  summary?(state: State): Summary;
  /** What everyone may see before the game starts, from the room's options: its game and rules, say. */
  info?(options: Options): unknown;
  /**
   * A table's settings (how well and how fast its bots play, say), from a page: checked, with defaults
   * for anything missing. Without it a room has no settings. They're public, and anyone seated can change
   * them mid-game.
   */
  settings?(given: unknown): unknown;
  /** A bot's move for a seat, or null when it isn't that seat's move. `name` is the bot's name in that seat. */
  bot?(state: State, seat: number, name: string, settings?: any): Move | null;
  /** Whether the game is over. Finished rooms are dropped from memory (the log keeps them). */
  finished?(state: State): boolean;
  /** How long (ms) a bot takes over its move, so bots feel like people. Default 700. */
  botDelay?(state: State, seat: number, name: string, settings?: any): number;
}

/** What happened in a room, for an app that wants to react (bots chatting, say). */
export interface MoveEvent<State, Move, Summary> {
  id: string;
  before: State;
  after: State;
  seat: number;
  move: Move;
  room: RoomDoc<Summary>;
}

export class RefusedMove extends Error {
  override name = "RefusedMove";
}

export interface Seat {
  name: string | null;
  bot: boolean;
}

export interface RoomDoc<Summary = unknown> {
  seats: Seat[];
  /** The room's public info from its options (see RoomDefinition.info), or null. */
  info: unknown;
  /** The table's settings (see RoomDefinition.settings), or null. */
  settings?: unknown;
  started: boolean;
  /** Seats set by the server (a tournament match, say): nobody may sit, swap or change bots. */
  locked?: boolean;
  /** A name for the table, set by the server, for pages to show. */
  label?: string;
  /**
   * A table to watch: every seat is a computer player and anyone may read every seat's view. Only
   * the server makes one (see `exhibit`).
   */
  watchable?: boolean;
  /** Why the server's admin closed this table. A closed table takes no more seats, moves or chat. */
  closed?: string;
  summary: Summary | null;
  version: number;
}

export interface ChatMessage {
  /** The seat that said it. */
  seat: number;
  name: string;
  text: string;
  /** Server time (ms). */
  at: number;
  bot: boolean;
  /** A moderator took the words away; `text` says so instead. */
  removed?: boolean;
}

/** What a removed chat message says instead. */
export const REMOVED_TEXT = "(removed by a moderator)";

/** How long a message may be, and how often one player may send. */
export const CHAT_LIMIT = 280;
const CHAT_GAP_MS = 400;

export interface ViewDoc<View = unknown> {
  view: View;
  version: number;
}

interface GameDoc<Options> {
  options: Options;
  settings?: unknown;
  seed: number | null;
  holders: (string | null)[];
}

interface Live<State> {
  state: State | null;
  moves: number;
  version: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface RoomsOptions {
  /** Where the rooms endpoints live. Default `/rooms`. */
  mount?: string;
  /** Where the sync log is served. Default `/_zb/sync`. */
  syncMount?: string;
  /** The sync log. Default: in memory, keeping each field's latest value. */
  log?: Log;
  /** A fixed time (ms) every bot waits before moving, overriding the room's own botDelay. For tests. */
  botDelay?: number;
  /** Whether a page may open a room with these options: a reason to refuse, or null. Server code's own `create` isn't asked. */
  allow?(options: unknown): string | null | Promise<string | null>;
  /** After every move is published. */
  onMove?(event: MoveEvent<any, any, any>): void;
  /** After a game starts. */
  onStart?(event: { id: string; state: any; room: RoomDoc<any> }): void;
  /** After a person (not a bot) says something. */
  onSay?(event: { id: string; message: ChatMessage; room: RoomDoc<any> }): void;
  /** Seeds for new games. Default: random. */
  seed?: () => number;
  /** Room ids. Default: 6 random letters and digits. */
  id?: () => string;
}

const COOKIE = "rooms_player";
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const randomId = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % ALPHABET.length]).join("");

/** A new player id: the secret a browser's cookie holds. */
export const newPlayerId = () => randomId(24);

/** Whether the browser reached us over HTTPS: directly, or through a proxy that says so (Railway). */
export function overHttps(request?: Request): boolean {
  if (!request) return false;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The Set-Cookie value that makes a browser this player, for a year. Over HTTPS it's also Secure, so
 * the browser never sends it over plain http; plain-http development (localhost) still works.
 */
export const playerCookie = (player: string, request?: Request) => `${COOKIE}=${player}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${overHttps(request) ? "; Secure" : ""}`;

export function playerOf(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-z0-9]+)`));
  return match?.[1] ?? null;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export function createRooms<State, Move, View, Options, Summary = unknown>(
  def: RoomDefinition<State, Move, View, Options, Summary>,
  options: RoomsOptions = {},
) {
  const mount = (options.mount ?? "/rooms").replace(/\/$/, "");
  const fixedDelay = options.botDelay;
  const seatsFor = (o: Options) => (typeof def.seats === "function" ? def.seats(o) : def.seats);
  /** Run an app's hook without letting it break the room. */
  const safely = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      console.error("rooms: a hook threw", e);
    }
  };
  const newSeed = options.seed ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]!);
  const newId = options.id ?? (() => randomId(6));
  const live = new Map<string, Live<State>>();

  const sync = createSyncServer({
    mount: options.syncMount ?? "/_zb/sync",
    log: options.log ?? memoryLog({ keep: "latest" }),
    authorize: async ({ request, collection, key, kind }) => {
      if (kind === "change") return false; // the server is the only writer
      if (collection === "rooms") return true; // reading, and presence (who's at the table)
      if (collection === "chat" && kind === "read") return true;
      if (collection === "views" && kind === "read") {
        const [id, seat] = splitViewKey(key);
        // A table of computer players has no hands to keep secret.
        if ((await room(id))?.watchable) return true;
        const player = playerOf(request);
        return player !== null && (await game(id))?.holders[seat] === player;
      }
      return false; // games and moves are the server's alone
    },
  });
  const docs = sync.documents();

  const splitViewKey = (key: string): [string, number] => {
    const at = key.lastIndexOf("/");
    return [key.slice(0, at), Number(key.slice(at + 1))];
  };
  const game = async (id: string) => (await docs).get("games", id) as GameDoc<Options> | undefined;
  const room = async (id: string) => (await docs).get("rooms", id) as RoomDoc<Summary> | undefined;

  /** The live state of a room, replaying its move log after a restart. */
  async function stateOf(id: string): Promise<Live<State>> {
    let entry = live.get(id);
    if (entry) return entry;
    entry = { state: null, moves: 0, version: (await room(id))?.version ?? 0, timer: null };
    const g = await game(id);
    if (g?.seed != null) {
      let state = def.setup(g.options, g.seed);
      const log = (await docs).get("moves", id) ?? {};
      const count = Object.keys(log).filter((k) => /^\d+$/.test(k)).length;
      for (let n = 0; n < count; n++) {
        const { seat, move } = log[String(n)] as { seat: number; move: Move };
        state = def.act(state, seat, move);
      }
      entry.state = state;
      entry.moves = count;
    }
    live.set(id, entry);
    return entry;
  }

  /** Messages per room, counted once from the log and then kept here. */
  const chatCount = new Map<string, number>();
  const lastSaid = new Map<string, number>();

  /** Add a message to a room's chat, as a seat. Bots speak through this too. */
  async function say(id: string, seat: number, text: string): Promise<ChatMessage | string> {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, CHAT_LIMIT);
    if (!clean) return "Say something first.";
    const r = await room(id);
    const who = r?.seats[seat];
    if (!r || !who) return "No such seat.";
    if (!chatCount.has(id)) {
      const existing = (await docs).get("chat", id) ?? {};
      chatCount.set(id, Object.keys(existing).filter((k) => /^m\d+$/.test(k)).length);
    }
    const n = chatCount.get(id)!;
    chatCount.set(id, n + 1);
    const message: ChatMessage = { seat, name: who.name ?? `Seat ${seat + 1}`, text: clean, at: Date.now(), bot: who.bot };
    await sync.write("chat", id, { [`m${String(n).padStart(6, "0")}`]: message });
    return message;
  }

  /** Open a new room with these options. Resolves to its id. */
  async function create(roomOptions: Options, given?: unknown): Promise<string> {
    const id = newId();
    const n = seatsFor(roomOptions);
    const settings = def.settings ? def.settings(given) : null;
    await sync.write("games", id, { options: roomOptions, settings, seed: null, holders: Array(n).fill(null) });
    await sync.write("rooms", id, { seats: Array.from({ length: n }, () => ({ name: null, bot: false })), info: def.info?.(roomOptions) ?? null, settings, started: false, summary: null, version: 0 });
    return id;
  }

  /**
   * Seat a player (by their player id) or a bot, from server code, before the game starts. An app
   * that sets up a table itself (a challenge, say) uses these instead of the HTTP endpoints.
   */
  async function seatPlayer(id: string, seat: number, player: string, name: string): Promise<void> {
    const g = await game(id);
    const r = await room(id);
    if (!g || !r || r.started) throw new Error("That table isn't open.");
    const holders = g.holders.map((h) => (h === player ? null : h));
    holders[seat] = player;
    const seats = r.seats.map((s, i) => (holders[i] === null && !s.bot ? { name: null, bot: false } : s));
    seats[seat] = { name: name.trim().slice(0, 20) || "Player", bot: false };
    await sync.write("games", id, { holders });
    await sync.write("rooms", id, { seats });
  }
  async function seatBot(id: string, seat: number, name: string): Promise<void> {
    const r = await room(id);
    if (!r || r.started) throw new Error("That table isn't open.");
    const seats = [...r.seats];
    seats[seat] = { name, bot: true };
    await sync.write("rooms", id, { seats });
  }
  /** Deal: from a seated player's request, or from server code. Resolves to a problem, or null. */
  async function start(id: string): Promise<string | null> {
    const g = await game(id);
    const r = await room(id);
    if (!g || !r) return "No such table.";
    if (r.started) return null;
    if (r.seats.some((s, i) => !s.bot && !g.holders[i])) return "Every seat needs a player or a bot.";
    const seed = newSeed();
    await sync.write("games", id, { seed });
    const entry = await stateOf(id);
    entry.state = def.setup(g.options, seed);
    entry.moves = 0;
    await publish(id, entry);
    if (options.onStart) {
      const started = await room(id);
      if (started) safely(() => options.onStart!({ id, state: entry.state, room: started }));
    }
    void driveBots(id);
    return null;
  }
  /** Set the seats for good (after seating everyone from server code), and name the table. */
  async function lock(id: string, label?: string): Promise<void> {
    await sync.write("rooms", id, { locked: true, ...(label ? { label: label.slice(0, 60) } : {}) });
  }

  /**
   * Make a table one to watch: its seats are set (all computer players, seated from server code)
   * and anyone may read every seat's view. Refuses a table with a person at it.
   */
  async function exhibit(id: string, label?: string): Promise<void> {
    const g = await game(id);
    const r = await room(id);
    if (!g || !r || g.holders.some(Boolean) || r.seats.some((s) => !s.bot)) throw new Error("Only a table of computer players can be watched this way.");
    await sync.write("rooms", id, { locked: true, watchable: true, ...(label ? { label: label.slice(0, 60) } : {}) });
  }

  /**
   * Close a table for good (moderation): bots stop, and every later seat, move or message is
   * refused with `reason`. Pages see `closed` on the room. Resolves false when there's no such table.
   */
  async function closeTable(id: string, reason: string): Promise<boolean> {
    if (!(await room(id))) return false;
    await sync.write("rooms", id, { closed: reason.replace(/\s+/g, " ").trim().slice(0, 200) || "This table was closed." });
    const entry = live.get(id);
    if (entry?.timer) clearTimeout(entry.timer);
    live.delete(id);
    return true;
  }

  /**
   * Take a person out of a seat (moderation). Before the game starts the seat is simply free again;
   * once it has, a bot called `bot` plays the seat on, so the others can finish. Resolves to a
   * problem, or null.
   */
  async function unseat(id: string, seat: number, bot = "Bot"): Promise<string | null> {
    const g = await game(id);
    const r = await room(id);
    if (!g || !r) return "No such table.";
    if (!Number.isInteger(seat) || seat < 0 || seat >= r.seats.length || !g.holders[seat]) return "Nobody's sitting there.";
    const holders = [...g.holders];
    holders[seat] = null;
    const seats = [...r.seats];
    seats[seat] = r.started ? { name: bot.trim().slice(0, 20) || "Bot", bot: true } : { name: null, bot: false };
    await sync.write("games", id, { holders });
    await sync.write("rooms", id, { seats });
    if (r.started && !r.closed) void driveBots(id);
    return null;
  }

  /** Take the words out of a chat message (moderation). `key` is the message's field in `chat/<id>`. */
  async function redact(id: string, key: string): Promise<boolean> {
    const message = ((await docs).get("chat", id) ?? {})[key] as ChatMessage | undefined;
    if (!/^m\d+$/.test(key) || !message) return false;
    await sync.write("chat", id, { [key]: { ...message, text: REMOVED_TEXT, removed: true } });
    return true;
  }

  /** Who holds each seat (player ids), for server code. Never send these to a page. */
  async function holders(id: string): Promise<(string | null)[]> {
    return (await game(id))?.holders ?? [];
  }

  /** A finished game no longer needs its state in memory: a later request replays it from the log. */
  function forgetIfFinished(id: string, entry: Live<State>): boolean {
    if (entry.state === null || !def.finished?.(entry.state)) return false;
    if (entry.timer) clearTimeout(entry.timer);
    live.delete(id);
    return true;
  }

  /** Write every seat's view and the public room doc. */
  async function publish(id: string, entry: Live<State>) {
    entry.version += 1;
    const writes: Promise<unknown>[] = [];
    if (entry.state !== null) {
      const n = (await game(id))?.holders.length ?? 0;
      for (let seat = 0; seat < n; seat++)
        writes.push(sync.write("views", `${id}/${seat}`, { view: def.view(entry.state, seat), version: entry.version }));
    }
    writes.push(
      sync.write("rooms", id, {
        started: entry.state !== null,
        summary: entry.state !== null && def.summary ? def.summary(entry.state) : null,
        version: entry.version,
      }),
    );
    await Promise.all(writes);
  }

  /** Apply a move. No await between deciding and recording it, so two moves can't interleave. */
  function apply(id: string, entry: Live<State>, seat: number, move: Move): State {
    const before = entry.state as State;
    const next = def.act(before, seat, move); // throws to refuse
    entry.state = next;
    const n = entry.moves++;
    void sync.write("moves", id, { [String(n)]: { seat, move } });
    return before;
  }

  async function moved(id: string, before: State, after: State, seat: number, move: Move) {
    if (!options.onMove) return;
    const r = await room(id);
    if (r) safely(() => options.onMove!({ id, before, after, seat, move, room: r }));
  }

  /** If it's a bot's move, make it after a pause. */
  async function driveBots(id: string) {
    const entry = await stateOf(id);
    if (!def.bot || entry.state === null || entry.timer) return;
    const current = await room(id);
    if (current?.closed) return;
    const seats = current?.seats ?? [];
    // A room from before it had settings plays with the defaults.
    const settings = (await game(id))?.settings ?? def.settings?.(undefined);
    if (entry.timer) return; // set while this was reading
    for (let seat = 0; seat < seats.length; seat++) {
      if (!seats[seat]?.bot) continue;
      const botName = seats[seat]!.name ?? "";
      if (def.bot(entry.state, seat, botName, settings) === null) continue;
      const delay = fixedDelay ?? def.botDelay?.(entry.state, seat, botName, settings) ?? 700;
      entry.timer = setTimeout(async () => {
        entry.timer = null;
        const move = entry.state === null ? null : def.bot!(entry.state, seat, botName, settings);
        if (move === null) return;
        let before: State;
        try {
          before = apply(id, entry, seat, move);
        } catch (e) {
          console.error(`rooms: bot in ${id} seat ${seat} made a refused move`, e);
          return;
        }
        await publish(id, entry);
        void moved(id, before, entry.state as State, seat, move);
        if (!forgetIfFinished(id, entry)) void driveBots(id);
      }, delay);
      return;
    }
  }

  async function body(request: Request): Promise<Record<string, unknown>> {
    try {
      const value = await request.json();
      return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  async function handleRooms(request: Request, path: string): Promise<Response> {
    const parts = path.split("/").filter(Boolean);
    const method = request.method;

    // POST /rooms { options, settings? } → { id }
    if (parts.length === 0 && method === "POST") {
      const { options: given, settings } = await body(request);
      const refused = await options.allow?.(given ?? {});
      if (refused) return json({ error: refused }, 403);
      return json({ id: await create((given ?? {}) as Options, settings) }, 201);
    }

    const id = parts[0]!;
    const action = parts[1] ?? "";
    const g = await game(id);
    const r = await room(id);
    if (!g || !r) return json({ error: "There's no table with that code." }, 404);
    const player = playerOf(request);
    const mySeat = player ? g.holders.indexOf(player) : -1;

    // GET /rooms/:id → the public room and which seat (if any) this browser holds
    if (action === "" && method === "GET") return json({ id, ...r, seat: mySeat >= 0 ? mySeat : null });

    if (method !== "POST") return json({ error: "Not found" }, 404);
    if (r.closed) return json({ error: r.closed }, 410);
    const input = await body(request);

    if (action === "sit") {
      if (r.locked) return json({ error: "The seats at this table are already set." }, 409);
      const seat = Number(input.seat);
      const name = String(input.name ?? "").trim().slice(0, 20) || "Player";
      if (!Number.isInteger(seat) || seat < 0 || seat >= r.seats.length) return json({ error: "No such seat." }, 400);
      if (r.started && mySeat !== seat) return json({ error: "This game has started." }, 409);
      const holder = g.holders[seat];
      if ((holder && holder !== player) || r.seats[seat]?.bot) return json({ error: "Someone's already sitting there." }, 409);
      const me = player ?? newPlayerId();
      const holders = g.holders.map((h) => (h === me ? null : h));
      holders[seat] = me;
      const seats = r.seats.map((s, i) => (holders[i] === null && !s.bot ? { name: null, bot: false } : s));
      seats[seat] = { name, bot: false };
      await sync.write("games", id, { holders });
      await sync.write("rooms", id, { seats });
      return json({ seat }, 200, player ? {} : { "set-cookie": playerCookie(me, request) });
    }

    if (mySeat < 0) return json({ error: "Take a seat first." }, 403);

    // POST /rooms/:id/settings { settings } → anyone seated changes the table's settings, mid-game too.
    // A bot already waiting to move starts over at the new pace.
    if (action === "settings") {
      if (!def.settings) return json({ error: "This table has no settings." }, 404);
      const settings = def.settings(input.settings);
      await sync.write("games", id, { settings });
      await sync.write("rooms", id, { settings });
      const entry = live.get(id);
      if (entry?.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      void driveBots(id);
      return json({ settings });
    }

    if (action === "bot") {
      const seat = Number(input.seat);
      const add = input.add !== false;
      if (r.started) return json({ error: "This game has started." }, 409);
      if (r.locked) return json({ error: "The seats at this table are already set." }, 409);
      if (!Number.isInteger(seat) || seat < 0 || seat >= r.seats.length || g.holders[seat]) return json({ error: "That seat isn't free." }, 409);
      const seats = [...r.seats];
      seats[seat] = add ? { name: String(input.name ?? `Bot ${seat + 1}`), bot: true } : { name: null, bot: false };
      await sync.write("rooms", id, { seats });
      return json({ ok: true });
    }

    if (action === "start") {
      const problem = await start(id);
      return problem ? json({ error: problem }, 409) : json({ ok: true });
    }

    // POST /rooms/:id/say { text }
    if (action === "say") {
      const key = `${id}/${mySeat}`;
      const now = Date.now();
      if (now - (lastSaid.get(key) ?? 0) < CHAT_GAP_MS) return json({ error: "Slow down a little." }, 429);
      const result = await say(id, mySeat, String(input.text ?? ""));
      if (typeof result === "string") return json({ error: result }, 400);
      lastSaid.set(key, now); // only a message that was sent counts toward the pace
      if (options.onSay) {
        const said = await room(id);
        if (said) safely(() => options.onSay!({ id, message: result, room: said }));
      }
      return json(result);
    }

    if (action === "act") {
      const entry = await stateOf(id);
      if (entry.state === null) return json({ error: "The game hasn't started." }, 409);
      let before: State;
      try {
        before = apply(id, entry, mySeat, input.move as Move);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "That move isn't allowed." }, 400);
      }
      await publish(id, entry);
      void moved(id, before, entry.state as State, mySeat, input.move as Move);
      if (!forgetIfFinished(id, entry)) void driveBots(id);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  }

  return {
    sync,
    create,
    say,
    seatPlayer,
    seatBot,
    start,
    lock,
    exhibit,
    /** Get a table's computer players moving again (after a restart, nothing else would wake a table with no people). */
    nudge: (id: string) => void driveBots(id),
    holders,
    closeTable,
    unseat,
    redact,
    /** The public room doc, or undefined. */
    room,
    /** How many rooms have their state in memory (finished ones are dropped). */
    get inMemory() {
      return live.size;
    },
    /** Answers rooms and sync requests; null for anything else. */
    async fetch(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url);
      if (pathname === mount || pathname.startsWith(`${mount}/`)) return handleRooms(request, pathname.slice(mount.length));
      return sync.fetch(request);
    },
    /** For Node's http: answers rooms and sync requests and resolves true, else false. */
    async handle(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): Promise<boolean> {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === mount || url.pathname.startsWith(`${mount}/`)) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
        });
        const response = await handleRooms(request, url.pathname.slice(mount.length));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return true;
      }
      return sync.handle(req, res);
    },
    /** Stop bot timers (for tests and shutdown). */
    close() {
      for (const entry of live.values()) if (entry.timer) clearTimeout(entry.timer);
    },
  };
}
