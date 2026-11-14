// Rooms: turn-based games (or anything with private per-person state) over @zubra/sync.
//
// The server is the only writer. A page never writes a document; it sends a move to
// `POST <mount>/<id>/act`, the room's `act` decides it, and the server writes every seat's view.
// `authorize` lets a player read only their own seat's view, so a hand stays in one browser.
//
// Collections:
//   rooms/<id>          public: seats (names, bots), whether it started, a summary,
//                       and the deadline that's running, if any                      (everyone reads)
//   views/<id>/<seat>   one seat's view of the game                                  (that seat only)
//   games/<id>          options, seed, when it was dealt, and seat holders           (server only)
//   moves/<id>          every move and its time, one field per move, for replays     (server only)
//   chat/<id>           the table's chat, one field per message                       (everyone)
import { createSyncServer, memoryLog, type Log } from "@zubra/sync/server";

export interface RoomDefinition<State, Move, View, Options, Summary = unknown> {
  /** Seats at the table: a number, or worked out from the room's options (a game for 2 to 6, say). */
  seats: number | ((options: Options) => number);
  /** A new game, from the options a room was created with and a seed. */
  setup(options: Options, seed: number): State;
  /**
   * Apply a move by a seat. Throw a RefusedMove (or any Error) to refuse it; the message goes back to the player.
   * `time` is when the server decided the move and how long the table had waited for it. A game with
   * clocks (a bank per seat that runs down) keeps them in its state from this, and nothing else: the
   * move log keeps each move's time, so a replay hands `act` the same numbers. Never read the clock yourself.
   */
  act(state: State, seat: number, move: Move, time: MoveTime): State;
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
  /**
   * What happens if nobody moves: by when, and the move the server then makes for which seat (a turn
   * timer playing for someone who walked away, a flag falling on a chess clock, a claim window closing).
   * Null when the game waits for ever. Asked again after every move, so it describes this state only.
   * It must not read the clock: `after` counts from the last move, and a state that needs real times
   * gets them from `act`'s `time`.
   */
  deadline?(state: State, table: TableInfo): Deadline<Move> | null;
}

/** When a move was decided. */
export interface MoveTime {
  /** Server time (ms). Never earlier than the move before it. */
  at: number;
  /** Ms since the move before it (or since the deal, for the first move). */
  elapsed: number;
}

/** What a deadline may depend on besides the state: the table's settings, and who sits where. */
export interface TableInfo {
  /** The table's settings (see RoomDefinition.settings), or null. */
  settings: any;
  seats: Seat[];
}

export interface Deadline<Move> {
  /**
   * When time runs out, one of two ways. `after`: this many ms after the last move (or the deal); "30
   * seconds a turn" is `after: 30_000`, and a chess clock is `after: bank[turn]` with `act` taking each
   * move's `elapsed` off the mover's bank. `at`: a server time, for a state that keeps times itself
   * (it learned them from `act`'s `time`).
   */
  after?: number;
  at?: number;
  /** The seat the clock is on: the timeout move is made as this seat, and pages count down on it. */
  seat: number;
  /**
   * The move to make when time runs out, worked out only then (it may be a bot's whole think). Null
   * for nothing to do. It goes through `act` and into the move log like any other move.
   */
  move(): Move | null;
}

/** The deadline as pages see it: whose clock, and when it runs out (server time, ms). Never the move. */
export interface DeadlineDoc {
  at: number;
  seat: number;
}

/** What happened in a room, for an app that wants to react (bots chatting, say). */
export interface MoveEvent<State, Move, Summary> {
  id: string;
  before: State;
  after: State;
  seat: number;
  move: Move;
  room: RoomDoc<Summary>;
  /** The server made this move because the seat's time ran out (see RoomDefinition.deadline). */
  timeout?: boolean;
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
  /** Set by an app that lists the table somewhere public (a lobby), so its page can say so. */
  open?: boolean;
  /** The seat of whoever runs a listed table (they can remove players), set by the app. */
  host?: number | null;
  /** Seats that may not chat, set by the app. */
  muted?: number[];
  summary: Summary | null;
  /** The clock that's running, if the game has one (see RoomDefinition.deadline). */
  deadline?: DeadlineDoc | null;
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
}

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
  /** When the game was dealt (server time, ms): where the first move's clock starts. */
  startedAt?: number;
  holders: (string | null)[];
}

interface Armed {
  at: number;
  seat: number;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Live<State> {
  state: State | null;
  moves: number;
  version: number;
  /** The bot that's thinking. */
  timer: ReturnType<typeof setTimeout> | null;
  /** When the last move was decided (or the game dealt): where `elapsed` and `after` count from. */
  last: number;
  /** The settings and seats a deadline may read, kept here so a timer never has to wait for them. */
  table: TableInfo;
  /** The deadline that's armed. Separate from the bot's timer: both can be waiting at once. */
  deadline: Armed | null;
}

/** setTimeout can't wait longer than this (about 24.8 days): a longer deadline wakes and waits again. */
const LONGEST_TIMEOUT = 2 ** 31 - 1;

export interface RoomsOptions {
  /** Where the rooms endpoints live. Default `/rooms`. */
  mount?: string;
  /** Where the sync log is served. Default `/_zb/sync`. */
  syncMount?: string;
  /** The sync log. Default: in memory, keeping each field's latest value. */
  log?: Log;
  /** A fixed time (ms) every bot waits before moving, overriding the room's own botDelay. For tests. */
  botDelay?: number;
  /**
   * The least warning (ms) a seat gets when a deadline arrives out of nowhere: a room coming back after
   * a restart with its time already up, or a setting that puts the clock on someone mid-turn. Default 5000.
   */
  deadlineGrace?: number;
  /** After every move is published. */
  onMove?(event: MoveEvent<any, any, any>): void;
  /** After the seats change before a game starts: someone sat, stood up, or a bot was added or removed. */
  onSeats?(event: { id: string; room: RoomDoc<any> }): void;
  /** After a game starts. */
  onStart?(event: { id: string; state: any; room: RoomDoc<any> }): void;
  /**
   * Before a person's message is added to the chat: return the text to post (changed, perhaps), or
   * `{ error }` to turn it away with a reason.
   */
  beforeSay?(event: { id: string; seat: number; text: string; room: RoomDoc<any> }): string | { error: string } | Promise<string | { error: string }>;
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
  const grace = options.deadlineGrace ?? 5000;
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
    const entry = live.get(id);
    if (entry) return entry;
    // Two requests for a room that isn't in memory share one restore: a second copy of the room
    // would mean a second deadline, and a timeout applied twice.
    let pending = restoring.get(id);
    if (!pending) {
      pending = restore(id).finally(() => restoring.delete(id));
      restoring.set(id, pending);
    }
    return pending;
  }
  const restoring = new Map<string, Promise<Live<State>>>();

  async function restore(id: string): Promise<Live<State>> {
    const r = await room(id);
    const g = await game(id);
    const entry: Live<State> = { state: null, moves: 0, version: r?.version ?? 0, timer: null, last: Date.now(), table: tableOf(r, g), deadline: null };
    if (g?.seed != null) {
      // A game dealt before moves had times starts its clock now, for good: writing it down means
      // every later replay counts from the same moment.
      const startedAt = g.startedAt ?? Date.now();
      if (g.startedAt == null) void sync.write("games", id, { startedAt });
      let state = def.setup(g.options, g.seed);
      const log = (await docs).get("moves", id) ?? {};
      const count = Object.keys(log).filter((k) => /^\d+$/.test(k)).length;
      // Each move gets the time it was first decided at, so a game with clocks replays to the same
      // state. A move from before times were kept took no time at all.
      let last = startedAt;
      for (let n = 0; n < count; n++) {
        const { seat, move, at } = log[String(n)] as { seat: number; move: Move; at?: number };
        const when = Math.max(at ?? last, last);
        state = def.act(state, seat, move, { at: when, elapsed: when - last });
        last = when;
      }
      entry.state = state;
      entry.moves = count;
      entry.last = last;
    }
    live.set(id, entry);
    // The clock kept running while the server was away: the deadline is where it was, measured from
    // the last move's own time. If that has already passed, the seat gets a moment's grace first.
    arm(id, entry, true);
    const now = deadlineDoc(entry);
    if (now?.at !== r?.deadline?.at || now?.seat !== r?.deadline?.seat) void sync.write("rooms", id, { deadline: now });
    return entry;
  }

  const tableOf = (r: RoomDoc<Summary> | undefined, g: GameDoc<Options> | undefined): TableInfo => ({
    // A room from before it had settings plays with the defaults.
    settings: g?.settings ?? def.settings?.(undefined) ?? null,
    seats: r?.seats ?? [],
  });
  const deadlineDoc = (entry: Live<State>): DeadlineDoc | null => (entry.deadline ? { at: entry.deadline.at, seat: entry.deadline.seat } : null);

  function disarm(entry: Live<State>) {
    if (entry.deadline?.timer) clearTimeout(entry.deadline.timer);
    entry.deadline = null;
  }

  /**
   * Ask the game for its deadline in this state and set the one timer that keeps it. `sudden` is for a
   * deadline nobody at the table saw coming (a restart, a changed setting): it's never closer than the
   * grace period, unless the one it replaces already was. Returns whether there is one now.
   */
  function arm(id: string, entry: Live<State>, sudden = false): boolean {
    const before = entry.deadline?.at ?? null;
    disarm(entry);
    if (!def.deadline || entry.state === null || def.finished?.(entry.state)) return false;
    let due: Deadline<Move> | null = null;
    try {
      due = def.deadline(entry.state, entry.table);
    } catch (e) {
      console.error(`rooms: the deadline of ${id} threw`, e);
    }
    const asked = due ? (due.at ?? (due.after === undefined ? NaN : entry.last + due.after)) : NaN;
    if (!due || !Number.isFinite(asked)) return false;
    let at = Math.round(asked);
    // The grace never puts off a deadline that was already armed, or asking twice would be a way to stall.
    if (sudden) at = Math.max(at, Math.min(Date.now() + grace, before ?? Infinity));
    const armed: Armed = { at, seat: due.seat, timer: null };
    const wait = () => {
      armed.timer = setTimeout(() => {
        armed.timer = null;
        if (entry.deadline !== armed) return; // a move got in first
        if (Date.now() < armed.at) return wait(); // longer than one timer can sleep, or the timer woke early
        timeUp(id, entry, armed);
      }, Math.min(Math.max(armed.at - Date.now(), 0), LONGEST_TIMEOUT));
    };
    entry.deadline = armed;
    wait();
    return true;
  }

  /**
   * Time ran out: make the game's timeout move, exactly as if the seat had sent it. Everything up to
   * recording the move happens with no await, and a move that got in first has already put this
   * deadline away (see apply), so a move and a timeout can never both land on the same state.
   */
  function timeUp(id: string, entry: Live<State>, armed: Armed) {
    entry.deadline = null;
    let applied: { before: State; move: Move } | null = null;
    try {
      const due = entry.state === null ? null : def.deadline!(entry.state, entry.table);
      const move = due && due.seat === armed.seat ? due.move() : null;
      if (move !== null) applied = { before: apply(id, entry, armed.seat, move), move };
    } catch (e) {
      console.error(`rooms: the timeout move in ${id} for seat ${armed.seat} was refused`, e);
    }
    // Nothing to do for that seat: the game waits, and pages stop counting down.
    if (!applied) return void sync.write("rooms", id, { deadline: null });
    void settle(id, entry, applied.before, armed.seat, applied.move, true);
  }

  /** After any move: tell everyone, then let the bots and the clock carry on (or put the game away). */
  async function settle(id: string, entry: Live<State>, before: State, seat: number, move: Move, timeout = false) {
    const after = entry.state as State;
    await publish(id, entry);
    void moved(id, before, after, seat, move, timeout);
    if (!forgetIfFinished(id, entry)) void driveBots(id);
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
    await seatsChanged(id);
  }
  async function seatBot(id: string, seat: number, name: string): Promise<void> {
    const r = await room(id);
    if (!r || r.started) throw new Error("That table isn't open.");
    const seats = [...r.seats];
    seats[seat] = { name, bot: true };
    await sync.write("rooms", id, { seats });
    await seatsChanged(id);
  }
  /** Free a person's seat before the game starts (they left, say). Resolves to whether anyone was there. */
  async function unseat(id: string, seat: number): Promise<boolean> {
    const g = await game(id);
    const r = await room(id);
    if (!g || !r || r.started || !g.holders[seat]) return false;
    const holders = [...g.holders];
    holders[seat] = null;
    const seats = [...r.seats];
    seats[seat] = { name: null, bot: false };
    await sync.write("games", id, { holders });
    await sync.write("rooms", id, { seats });
    await seatsChanged(id);
    return true;
  }
  /**
   * Take a person's seat away and sit a bot there, at any point. In a game that's been dealt, the bot
   * plays on from where they were. Resolves to whether anyone was there.
   */
  async function replaceWithBot(id: string, seat: number, name: string): Promise<boolean> {
    const g = await game(id);
    const r = await room(id);
    if (!g || !r || !g.holders[seat]) return false;
    const holders = [...g.holders];
    holders[seat] = null;
    const seats = [...r.seats];
    seats[seat] = { name, bot: true };
    await sync.write("games", id, { holders });
    await sync.write("rooms", id, { seats });
    if (!r.started) return await seatsChanged(id), true;
    const entry = await stateOf(id);
    entry.table = { ...entry.table, seats };
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    // A clock that was running on the person isn't the bot's: work it out again.
    if (def.deadline && entry.state !== null) {
      const before = deadlineDoc(entry);
      arm(id, entry, true);
      const now = deadlineDoc(entry);
      if (before?.at !== now?.at || before?.seat !== now?.seat) void sync.write("rooms", id, { deadline: now });
    }
    void driveBots(id);
    return true;
  }
  /** Tell the app the seats changed. */
  async function seatsChanged(id: string) {
    if (!options.onSeats) return;
    const r = await room(id);
    if (r) safely(() => options.onSeats!({ id, room: r }));
  }
  /** Deal: from a seated player's request, or from server code. Resolves to a problem, or null. */
  async function start(id: string): Promise<string | null> {
    const g = await game(id);
    const r = await room(id);
    if (!g || !r) return "No such table.";
    if (r.started) return null;
    if (r.seats.some((s, i) => !s.bot && !g.holders[i])) return "Every seat needs a player or a bot.";
    const seed = newSeed();
    const entry = await stateOf(id);
    if (entry.state !== null) return null; // two people pressed Deal at once
    const startedAt = Date.now();
    entry.state = def.setup(g.options, seed);
    entry.moves = 0;
    entry.last = startedAt;
    entry.table = tableOf(r, g);
    await sync.write("games", id, { seed, startedAt });
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

  /** Who holds each seat (player ids), for server code. Never send these to a page. */
  async function holders(id: string): Promise<(string | null)[]> {
    return (await game(id))?.holders ?? [];
  }

  /** A finished game no longer needs its state in memory: a later request replays it from the log. */
  function forgetIfFinished(id: string, entry: Live<State>): boolean {
    if (entry.state === null || !def.finished?.(entry.state)) return false;
    if (entry.timer) clearTimeout(entry.timer);
    disarm(entry);
    live.delete(id);
    return true;
  }

  /** Write every seat's view and the public room doc. */
  async function publish(id: string, entry: Live<State>) {
    entry.version += 1;
    // The state changed, so its deadline did: arm it before anything is awaited, and publish it with the rest.
    arm(id, entry);
    const deadline = deadlineDoc(entry);
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
        ...(def.deadline ? { deadline } : {}),
        version: entry.version,
      }),
    );
    await Promise.all(writes);
  }

  /** Apply a move. No await between deciding and recording it, so two moves can't interleave. */
  function apply(id: string, entry: Live<State>, seat: number, move: Move): State {
    const before = entry.state as State;
    const at = Math.max(Date.now(), entry.last); // a clock set back never makes a move take less than no time
    const next = def.act(before, seat, move, { at, elapsed: at - entry.last }); // throws to refuse
    entry.state = next;
    entry.last = at;
    // The deadline was for the state before this move: put it away now, so it can't fire on this one.
    disarm(entry);
    const n = entry.moves++;
    void sync.write("moves", id, { [String(n)]: { seat, move, at } });
    return before;
  }

  async function moved(id: string, before: State, after: State, seat: number, move: Move, timeout = false) {
    if (!options.onMove) return;
    const r = await room(id);
    if (r) safely(() => options.onMove!({ id, before, after, seat, move, room: r, ...(timeout ? { timeout } : {}) }));
  }

  /** If it's a bot's move, make it after a pause. */
  async function driveBots(id: string) {
    const entry = await stateOf(id);
    if (!def.bot || entry.state === null || entry.timer) return;
    const seats = (await room(id))?.seats ?? [];
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
        // The game moved on while this bot was thinking (a deadline's move, say): see whose move it is now.
        if (move === null) return void (live.get(id) === entry && driveBots(id));
        let before: State;
        try {
          before = apply(id, entry, seat, move);
        } catch (e) {
          console.error(`rooms: bot in ${id} seat ${seat} made a refused move`, e);
          return;
        }
        await settle(id, entry, before, seat, move);
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
    // `now` is the server's clock, so a page can count down to a deadline by it and not its own.
    if (action === "" && method === "GET") return json({ id, ...r, seat: mySeat >= 0 ? mySeat : null, now: Date.now() });

    if (method !== "POST") return json({ error: "Not found" }, 404);
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
      const entry = live.get(id);
      if (entry) entry.table = { ...entry.table, seats };
      await seatsChanged(id);
      return json({ seat }, 200, player ? {} : { "set-cookie": playerCookie(me, request) });
    }

    if (mySeat < 0) return json({ error: "Take a seat first." }, 403);

    // POST /rooms/:id/stand → give up your seat, before the game starts
    if (action === "stand") {
      if (r.started) return json({ error: "This game has started." }, 409);
      if (r.locked) return json({ error: "The seats at this table are already set." }, 409);
      await unseat(id, mySeat);
      return json({ ok: true });
    }

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
      // A deadline may depend on the settings (a turn timer): work it out again. The clock isn't
      // restarted, or changing a setting would be a way to stall.
      if (entry && def.deadline && entry.state !== null) {
        const before = deadlineDoc(entry);
        entry.table = { ...entry.table, settings };
        arm(id, entry, true);
        const now = deadlineDoc(entry);
        if (before?.at !== now?.at || before?.seat !== now?.seat) void sync.write("rooms", id, { deadline: now });
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
      await seatsChanged(id);
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
      const checked = options.beforeSay ? await options.beforeSay({ id, seat: mySeat, text: String(input.text ?? ""), room: r }) : String(input.text ?? "");
      if (typeof checked !== "string") return json({ error: checked.error }, 403);
      const result = await say(id, mySeat, checked);
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
      await settle(id, entry, before, mySeat, input.move as Move);
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  }

  // Deadlines have to be kept even if nobody opens the table again after a restart (a day a move):
  // bring back every room that had a clock running. Rooms without one wait for their next request.
  const restored: Promise<void> = def.deadline
    ? docs.then(async (d) => {
        for (const r of d.all("rooms")) if (r.started && r.deadline) await stateOf(r.key).catch((e) => console.error(`rooms: couldn't restore ${r.key}`, e));
      }, (e) => console.error("rooms: couldn't read the rooms to restore their deadlines", e))
    : Promise.resolve();

  return {
    sync,
    /** Resolves once the rooms that had a deadline running before a restart have theirs again. */
    restored,
    create,
    say,
    seatPlayer,
    seatBot,
    unseat,
    replaceWithBot,
    start,
    lock,
    holders,
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
    /** Stop bot timers and deadlines (for tests and shutdown). */
    close() {
      for (const entry of live.values()) {
        if (entry.timer) clearTimeout(entry.timer);
        disarm(entry);
      }
    },
  };
}
