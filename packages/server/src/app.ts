// The card room as one handler: houses, rooms and the sync log. index.ts serves it with the web app.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Log } from "@zubra/sync/server";
import { createRooms, type RoomDoc } from "@spades/rooms/server";
import { greet, reactToMove, replyTo, type GameState, type Remark, type Seat, type TableCast } from "@spades/rules";
import { createHouses } from "./houses.js";
import { spadesRoom } from "./spades.js";

export function createCardRoom(options: { log?: Log; botDelay?: number; talk?: boolean } = {}) {
  const talking = options.talk ?? true;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const lastWord = new Map<string, number>();

  const castOf = (room: RoomDoc<unknown>): TableCast => ({
    bots: room.seats.flatMap((s, i) => (s.bot ? [{ seat: i as Seat, name: s.name ?? "Bot" }] : [])),
  });

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

  const rooms = createRooms(spadesRoom, {
    log: options.log,
    botDelay: options.botDelay,
    onStart: ({ id, room }) => speak(id, greet(castOf(room))),
    onMove: ({ id, before, after, room }) => {
      const remarks = reactToMove(before as GameState, after as GameState, castOf(room));
      speak(id, remarks, (after as GameState).phase === "finished");
    },
    // Someone spoke to the table: an answer is never dropped for being close to other talk.
    onSay: ({ id, message, room }) => speak(id, replyTo(message.text, message.seat as Seat, castOf(room)), true),
  });
  const houses = createHouses(rooms);

  return {
    rooms,
    houses,
    /** Answers houses, rooms and sync requests; null for anything else. */
    async fetch(request: Request): Promise<Response | null> {
      return (await houses.fetch(request)) ?? (await rooms.fetch(request));
    },
    /** For Node's http: answers and resolves true, or resolves false for anything else. */
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/houses" || url.pathname.startsWith("/houses/")) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const request = new Request(url, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.method === "GET" || req.method === "HEAD" ? undefined : Buffer.concat(chunks),
        });
        const response = (await houses.fetch(request))!;
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
        return true;
      }
      return rooms.handle(req, res);
    },
    close: () => {
      for (const t of timers) clearTimeout(t);
      rooms.close();
    },
  };
}
