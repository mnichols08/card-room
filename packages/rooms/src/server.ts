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
import { createSyncServer, memoryLog, type Log } from "@zubra/sync/server";

export interface RoomDefinition<State, Move, View, Options, Summary = unknown> {
  /** Seats at the table. */
  seats: number;
  /** A new game, from the options a room was created with and a seed. */
  setup(options: Options, seed: number): State;
  /** Apply a move by a seat. Throw a RefusedMove (or any Error) to refuse it; the message goes back to the player. */
  act(state: State, seat: number, move: Move): State;
  /** What one seat may see. */
  view(state: State, seat: number): View;
  /** What everyone may see (lobby, scoreboards, a blog embed). */
  summary?(state: State): Summary;
  /** A bot's move for a seat, or null when it isn't that seat's move. */
  bot?(state: State, seat: number): Move | null;
  /** Whether the game is over. Finished rooms are dropped from memory (the log keeps them). */
  finished?(state: State): boolean;
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
  started: boolean;
  summary: Summary | null;
  version: number;
}

export interface ViewDoc<View = unknown> {
  view: View;
  version: number;
}

interface GameDoc<Options> {
  options: Options;
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
  /** How long a bot waits before moving (ms). Default 700. */
  botDelay?: number;
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

/** The Set-Cookie value that makes a browser this player, for a year. */
export const playerCookie = (player: string) => `${COOKIE}=${player}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`;

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
  const botDelay = options.botDelay ?? 700;
  const newSeed = options.seed ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]!);
  const newId = options.id ?? (() => randomId(6));
  const live = new Map<string, Live<State>>();

  const sync = createSyncServer({
    mount: options.syncMount ?? "/_zb/sync",
    log: options.log ?? memoryLog({ keep: "latest" }),
    authorize: async ({ request, collection, key, kind }) => {
      if (kind === "change") return false; // the server is the only writer
      if (collection === "rooms") return true; // reading, and presence (who's at the table)
      if (collection === "views" && kind === "read") {
        const [id, seat] = splitViewKey(key);
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

  /** Open a new room with these options. Resolves to its id. */
  async function create(roomOptions: Options): Promise<string> {
    const id = newId();
    await sync.write("games", id, { options: roomOptions, seed: null, holders: Array(def.seats).fill(null) });
    await sync.write("rooms", id, { seats: Array.from({ length: def.seats }, () => ({ name: null, bot: false })), started: false, summary: null, version: 0 });
    return id;
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
      for (let seat = 0; seat < def.seats; seat++)
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
  function apply(id: string, entry: Live<State>, seat: number, move: Move) {
    const next = def.act(entry.state as State, seat, move); // throws to refuse
    entry.state = next;
    const n = entry.moves++;
    void sync.write("moves", id, { [String(n)]: { seat, move } });
  }

  /** If it's a bot's move, make it after a pause. */
  async function driveBots(id: string) {
    const entry = await stateOf(id);
    if (!def.bot || entry.state === null || entry.timer) return;
    const seats = (await room(id))?.seats ?? [];
    for (let seat = 0; seat < def.seats; seat++) {
      if (!seats[seat]?.bot) continue;
      if (def.bot(entry.state, seat) === null) continue;
      entry.timer = setTimeout(async () => {
        entry.timer = null;
        const move = entry.state === null ? null : def.bot!(entry.state, seat);
        if (move === null) return;
        try {
          apply(id, entry, seat, move);
        } catch (e) {
          console.error(`rooms: bot in ${id} seat ${seat} made a refused move`, e);
          return;
        }
        await publish(id, entry);
        if (!forgetIfFinished(id, entry)) void driveBots(id);
      }, botDelay);
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

    // POST /rooms { options } → { id }
    if (parts.length === 0 && method === "POST") {
      const { options: given } = await body(request);
      return json({ id: await create((given ?? {}) as Options) }, 201);
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
    const input = await body(request);

    if (action === "sit") {
      const seat = Number(input.seat);
      const name = String(input.name ?? "").trim().slice(0, 20) || "Player";
      if (!Number.isInteger(seat) || seat < 0 || seat >= def.seats) return json({ error: "No such seat." }, 400);
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
      return json({ seat }, 200, player ? {} : { "set-cookie": playerCookie(me) });
    }

    if (mySeat < 0) return json({ error: "Take a seat first." }, 403);

    if (action === "bot") {
      const seat = Number(input.seat);
      const add = input.add !== false;
      if (r.started) return json({ error: "This game has started." }, 409);
      if (!Number.isInteger(seat) || seat < 0 || seat >= def.seats || g.holders[seat]) return json({ error: "That seat isn't free." }, 409);
      const seats = [...r.seats];
      seats[seat] = add ? { name: String(input.name ?? `Bot ${seat + 1}`), bot: true } : { name: null, bot: false };
      await sync.write("rooms", id, { seats });
      return json({ ok: true });
    }

    if (action === "start") {
      if (r.started) return json({ ok: true });
      if (r.seats.some((s, i) => !s.bot && !g.holders[i])) return json({ error: "Every seat needs a player or a bot." }, 409);
      const seed = newSeed();
      await sync.write("games", id, { seed });
      const entry = await stateOf(id);
      entry.state = def.setup(g.options, seed);
      entry.moves = 0;
      await publish(id, entry);
      void driveBots(id);
      return json({ ok: true });
    }

    if (action === "act") {
      const entry = await stateOf(id);
      if (entry.state === null) return json({ error: "The game hasn't started." }, 409);
      try {
        apply(id, entry, mySeat, input.move as Move);
      } catch (e) {
        return json({ error: e instanceof Error ? e.message : "That move isn't allowed." }, 400);
      }
      await publish(id, entry);
      if (!forgetIfFinished(id, entry)) void driveBots(id);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  }

  return {
    sync,
    create,
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
