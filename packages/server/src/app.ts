// The card room as one handler: houses, rooms and the sync log. index.ts serves it with the web app.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Log } from "@zubra/sync/server";
import { createRooms, type RoomDoc } from "@spades/rooms/server";
import { createChallenges } from "./challenges.js";
import { createHouses } from "./houses.js";
import { createAi, type AiOptions } from "./ai.js";
import { personaFor } from "@spades/rules";
import { createLobby, type LobbyOptions } from "./lobby.js";
import { createPush, type PushOptions } from "./push.js";
import { playerOf } from "@spades/rooms/server";
import { gameName, gameOfOptions, tableRoom, talk, type GameId, type Remark } from "./games.js";

export function createCardRoom(options: { log?: Log; botDelay?: number; talk?: boolean; push?: PushOptions; ai?: AiOptions; lobby?: LobbyOptions } = {}) {
  const talking = options.talk ?? true;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const lastWord = new Map<string, number>();
  let closed = false;

  const castOf = (room: RoomDoc<unknown>) => ({
    bots: room.seats.flatMap((s, i) => (s.bot ? [{ seat: i, name: s.name ?? "Bot" }] : [])),
  });
  const gameOfRoom = (room: RoomDoc<unknown>): GameId => gameOfOptions(room.info ?? room.summary);

  /** The last few things said at a table, oldest first. */
  async function recentChat(id: string) {
    const chat = (await rooms.sync.documents()).get("chat", id) ?? {};
    return Object.keys(chat)
      .filter((k) => /^m\d+$/.test(k))
      .sort()
      .slice(-8)
      .map((k) => chat[k] as { name: string; text: string })
      .map((m) => ({ name: m.name, text: m.text }));
  }

  /**
   * A remark in the words of the house's model, when the table's house has connected one; null for the
   * bot's own line. The model gets only what the whole table can see.
   */
  async function inModelWords(id: string, r: Remark, said?: { name: string; text: string }): Promise<string | null> {
    const connected = await houses.aiFor(id);
    const room = connected && (await rooms.room(id));
    if (!connected || !room) return null;
    const bot = room.seats[r.seat]?.name ?? "Bot";
    return ai.line(
      connected.who,
      connected.ai,
      {
        house: connected.name,
        game: gameName(gameOfRoom(room)),
        bot,
        character: personaFor(bot).blurb,
        players: room.seats.flatMap((s) => (s.name ? [{ name: s.name, bot: s.bot }] : [])),
        summary: room.summary,
        chat: await recentChat(id),
        gist: r.text || undefined,
        replyingTo: said,
      },
      connected.limit,
    );
  }

  /**
   * Say each remark after its delay, unless another bot spoke a moment ago (no talking over each other).
   * At a house with a model connected the line is asked for meanwhile, and said in the model's words.
   */
  function speak(id: string, remarks: Remark[], always = false, said?: { name: string; text: string }) {
    if (!talking) return;
    for (const r of remarks) {
      const written = inModelWords(id, r, said).catch(() => null);
      const timer = setTimeout(async () => {
        timers.delete(timer);
        const text = (await written) ?? r.text;
        if (closed || !text) return;
        const now = Date.now();
        if (!always && now - (lastWord.get(id) ?? 0) < 1200) return;
        lastWord.set(id, now);
        void rooms.say(id, r.seat, text);
      }, r.delay);
      timer.unref?.();
      timers.add(timer);
    }
  }

  /**
   * Someone spoke to the table. The bots' own replies cover a handful of things (thanks, good luck…);
   * with a model connected, a bot also answers a question or its own name.
   */
  async function answer(id: string, message: { text: string; seat: number; name: string }, room: RoomDoc<unknown>) {
    const cast = castOf(room);
    const said = { name: message.name, text: message.text };
    const scripted = talk.reply(gameOfRoom(room), message.text, message.seat, cast);
    if (scripted.length || !cast.bots.length) return speak(id, scripted, true, said);
    const named = cast.bots.find((b) => message.text.toLowerCase().includes(b.name.toLowerCase()));
    if (!named && !message.text.includes("?")) return;
    if (!(await houses.aiFor(id))) return;
    const bot = named ?? cast.bots[Math.floor(Math.random() * cast.bots.length)]!;
    speak(id, [{ seat: bot.seat, text: "", delay: 900 + Math.random() * 1300 }], true, said);
  }

  const rooms = createRooms(tableRoom, {
    log: options.log,
    botDelay: options.botDelay,
    onStart: ({ id, state, room }) => {
      speak(id, talk.greet(state, castOf(room)));
      lobby.started(id);
    },
    // An open table deals itself when its last seat is taken.
    onSeats: ({ id }) => lobby.seatsChanged(id),
    onMove: ({ id, before, after, room }) => {
      speak(id, talk.react(before, after, castOf(room)), talk.finished(after));
      // A tournament match that just ended moves its winner on.
      if (talk.finished(after) && !talk.finished(before)) void houses.tableFinished(id, tableRoom.summary!(after)).catch((e) => console.error("tournament", e));
    },
    // Someone spoke to the table: an answer is never dropped for being close to other talk.
    onSay: ({ id, message, room }) => void answer(id, message, room).catch((e) => console.error("talk", e)),
  });
  const push = createPush(rooms.sync, options.push);
  const ai = createAi(options.ai);
  const houses = createHouses(rooms, { push, ai });
  const challenges = createChallenges(rooms, push);
  const lobby = createLobby(rooms, { push, ...options.lobby });

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  /** /push: the public key, and saying yes (or no) to notifications on this phone. */
  async function pushRoutes(request: Request): Promise<Response | null> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/push/")) return null;
    if (pathname === "/push/key" && request.method === "GET") return json({ enabled: push.enabled, publicKey: push.publicKey });
    const player = playerOf(request);
    if (!player) return json({ error: "Join a house, sit at a table or make a challenge link first." }, 403);
    const input = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    if (pathname === "/push/subscribe" && request.method === "POST") {
      const problem = await push.subscribe(player, input.subscription);
      return problem ? json({ error: problem }, push.enabled ? 400 : 503) : json({ ok: true });
    }
    if (pathname === "/push/unsubscribe" && request.method === "POST") {
      await push.unsubscribe(player, String(input.endpoint ?? ""));
      return json({ ok: true });
    }
    if (pathname === "/push/test" && request.method === "POST") {
      const n = await push.notify(player, { title: "Card Room 🃏", body: "Notifications are on. You'll hear about challenges and new tables.", url: "/", tag: "test" });
      return json({ delivered: n });
    }
    return json({ error: "Not found" }, 404);
  }

  return {
    rooms,
    houses,
    lobby,
    /** Answers houses, rooms and sync requests; null for anything else. */
    push,
    async fetch(request: Request): Promise<Response | null> {
      return (await pushRoutes(request)) ?? (await challenges.fetch(request)) ?? (await lobby.fetch(request)) ?? (await houses.fetch(request)) ?? (await rooms.fetch(request));
    },
    /** For Node's http: answers and resolves true, or resolves false for anything else. */
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = new URL(req.url ?? "/", "http://localhost");
      const ours = ["/houses", "/challenges", "/push", "/lobby"].some((m) => url.pathname === m || url.pathname.startsWith(`${m}/`));
      if (ours) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
        });
        const response = (await pushRoutes(request)) ?? (await challenges.fetch(request)) ?? (await lobby.fetch(request)) ?? (await houses.fetch(request))!;
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return true;
      }
      return rooms.handle(req, res);
    },
    close: () => {
      closed = true;
      for (const t of timers) clearTimeout(t);
      rooms.close();
    },
  };
}
