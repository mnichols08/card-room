// The spades server: rooms (moves, seats, bots), the sync log, and the built web app.
//
//   PORT=8787 SPADES_DB=spades.db node dist/index.js
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRooms } from "@spades/rooms/server";
import { spadesRoom } from "./spades.js";

const port = Number(process.env.PORT ?? 8787);
const web = resolve(process.env.SPADES_WEB ?? fileURLToPath(new URL("../../web/dist", import.meta.url)));

// A SQLite log keeps tables across restarts; without SPADES_DB, they live in memory.
const log = process.env.SPADES_DB
  ? await (await import("@zubra/sync/sqlite")).sqliteLog(process.env.SPADES_DB, { keep: "latest" })
  : undefined;
const rooms = createRooms(spadesRoom, { log, botDelay: Number(process.env.SPADES_BOT_DELAY ?? 700) });

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    if (await rooms.handle(req, res)) return;
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    let file = normalize(join(web, path));
    if (!file.startsWith(web)) return void res.writeHead(403).end();
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(web, "index.html"); // the app routes itself
    if (!existsSync(file)) return void res.writeHead(404).end("Build the web app first: npm run build -w @spades/web");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(port, () => console.log(`spades on http://localhost:${port}`));
