// The card room as one handler: houses, rooms and the sync log. index.ts serves it with the web app.
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Log } from "@zubra/sync/server";
import { createRooms } from "@spades/rooms/server";
import { createHouses } from "./houses.js";
import { spadesRoom } from "./spades.js";

export function createCardRoom(options: { log?: Log; botDelay?: number } = {}) {
  const rooms = createRooms(spadesRoom, { log: options.log, botDelay: options.botDelay ?? 700 });
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
    close: () => rooms.close(),
  };
}
