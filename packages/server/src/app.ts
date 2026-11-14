// The card room as one handler: houses, rooms, card designs, moderation and the sync log. index.ts
// serves it with the web app, the card designer and the admin app.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Log } from "@zubra/sync/server";
import { createRooms, type RoomDoc } from "@spades/rooms/server";
import { createChallenges } from "./challenges.js";
import { createDesigns } from "./designs.js";
import { BLOCKED_MESSAGE, createModeration } from "./moderation.js";
import { createHouses } from "./houses.js";
import { createPush, type PushOptions } from "./push.js";
import { playerOf } from "@spades/rooms/server";
import { gameOfOptions, tableRoom, talk, type GameId, type Remark } from "./games.js";

export function createCardRoom(options: { log?: Log; botDelay?: number; talk?: boolean; push?: PushOptions; /** Turns moderation on (see moderation.ts). */ adminToken?: string } = {}) {
  const talking = options.talk ?? true;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const lastWord = new Map<string, number>();

  const castOf = (room: RoomDoc<unknown>) => ({
    bots: room.seats.flatMap((s, i) => (s.bot ? [{ seat: i, name: s.name ?? "Bot" }] : [])),
  });
  const gameOfRoom = (room: RoomDoc<unknown>): GameId => gameOfOptions(room.info ?? room.summary);

  /** Say each remark after its delay, unless another bot spoke a moment ago (no talking over each other). */
  function speak(id: string, remarks: Remark[], always = false) {
    if (!talking) return;
    for (const r of remarks) {
      const timer = setTimeout(() => {
        timers.delete(timer);
        const now = Date.now();
        if (!always && now - (lastWord.get(id) ?? 0) < 1200) return;
        lastWord.set(id, now);
        void rooms.say(id, r.seat, r.text);
      }, r.delay);
      timer.unref?.();
      timers.add(timer);
    }
  }

  const rooms = createRooms(tableRoom, {
    log: options.log,
    botDelay: options.botDelay,
    onStart: ({ id, state, room }) => speak(id, talk.greet(state, castOf(room))),
    onMove: ({ id, before, after, room }) => {
      speak(id, talk.react(before, after, castOf(room)), talk.finished(after));
      // A tournament match that just ended moves its winner on.
      if (talk.finished(after) && !talk.finished(before)) void houses.tableFinished(id, tableRoom.summary!(after)).catch((e) => console.error("tournament", e));
    },
    // Someone spoke to the table: an answer is never dropped for being close to other talk.
    onSay: ({ id, message, room }) => speak(id, talk.reply(gameOfRoom(room), message.text, message.seat, castOf(room)), true),
  });
  const push = createPush(rooms.sync, options.push);
  const houses = createHouses(rooms, { push });
  const challenges = createChallenges(rooms, push);
  const designs = createDesigns(rooms.sync);
  const moderation = createModeration(rooms, designs, { token: options.adminToken });

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

  /** Everything a blocked player may not do: sit, move, talk, make houses, challenges or designs. Reading is left alone. */
  const ACTS = ["/rooms", "/houses", "/challenges", "/designs", "/push"];
  const under = (pathname: string, mounts: string[]) => mounts.some((m) => pathname === m || pathname.startsWith(`${m}/`));
  async function refusal(request: Request): Promise<Response | null> {
    if (request.method === "GET" || request.method === "HEAD" || !under(new URL(request.url).pathname, ACTS)) return null;
    return (await moderation.blocked(request)) ? json({ error: BLOCKED_MESSAGE }, 403) : null;
  }
  /** The routes that aren't the rooms kit's own. */
  const ours = async (request: Request) =>
    (await refusal(request)) ?? (await moderation.fetch(request)) ?? (await pushRoutes(request)) ?? (await designs.fetch(request)) ?? (await challenges.fetch(request)) ?? (await houses.fetch(request));

  return {
    rooms,
    houses,
    designs,
    moderation,
    push,
    /** Answers houses, designs, moderation, rooms and sync requests; null for anything else. */
    async fetch(request: Request): Promise<Response | null> {
      return (await ours(request)) ?? (await rooms.fetch(request));
    },
    /** For Node's http: answers and resolves true, or resolves false for anything else. */
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = new URL(req.url ?? "/", "http://localhost");
      const headers = req.headers as Record<string, string>;
      const answer = (response: Response) => {
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return response.arrayBuffer().then((body) => (res.end(Buffer.from(body)), true));
      };
      if (under(url.pathname, ["/houses", "/challenges", "/push", "/designs", "/moderation"])) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const request = new Request(url, {
          method: req.method,
          headers,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
        });
        return answer((await ours(request))!);
      }
      // The rooms kit reads the request itself; a blocked player is turned away before it does.
      const blocked = await refusal(new Request(url, { method: req.method === "GET" || req.method === "HEAD" ? "GET" : "POST", headers }));
      if (blocked) return answer(blocked);
      return rooms.handle(req, res);
    },
    close: () => {
      for (const t of timers) clearTimeout(t);
      rooms.close();
    },
  };
}
