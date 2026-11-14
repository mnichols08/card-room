// The Card Room server: rooms (moves, seats, bots), the sync log, and the built apps: the card room
// itself at /, the card designer at /designer/, the watch page at /watch/ and the admin app at /admin/.
//
//   PORT=8787 CARDROOM_DB=cardroom.db node dist/index.js
//
// Settings are CARDROOM_*; the older SPADES_* names still work (CARDROOM_* wins if both are set).
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createCardRoom } from "./app.js";

/** A setting: CARDROOM_<name>, or the older SPADES_<name>. */
function setting(name: string): string | undefined {
  const now = process.env[`CARDROOM_${name}`];
  const old = process.env[`SPADES_${name}`];
  if (now === undefined && old !== undefined) console.log(`SPADES_${name} is now CARDROOM_${name} (the old name still works)`);
  return now ?? old;
}

const port = Number(process.env.PORT ?? 8787);
const web = resolve(setting("WEB") ?? fileURLToPath(new URL("../../web/dist", import.meta.url)));
// The other apps live under the card room's address, each from its own build.
const apps = [
  { at: "/designer/", root: resolve(setting("DESIGNER") ?? fileURLToPath(new URL("../../designer/dist", import.meta.url))), build: "npm run build -w @cardroom/designer" },
  { at: "/watch/", root: resolve(setting("WATCH") ?? fileURLToPath(new URL("../../watch/dist", import.meta.url))), build: "npm run build -w @cardroom/watch" },
  { at: "/admin/", root: resolve(setting("ADMIN") ?? fileURLToPath(new URL("../../admin/dist/browser", import.meta.url))), build: "npm run build -w @cardroom/admin" },
];

// A SQLite log keeps tables across restarts; without CARDROOM_DB, they live in memory.
const db = setting("DB");
const log = db ? await (await import("@zubra/sync/sqlite")).sqliteLog(db, { keep: "latest" }) : undefined;
// Bots take humanlike time unless CARDROOM_BOT_DELAY fixes it (handy for testing).
const botDelay = setting("BOT_DELAY");
const cardRoom = createCardRoom({
  log,
  botDelay: botDelay ? Number(botDelay) : undefined,
  // Moderation (the admin app) is on when the server has an admin token.
  adminToken: setting("ADMIN_TOKEN"),
  // Push notifications are on when the server has VAPID keys (`npx web-push generate-vapid-keys`).
  push: {
    publicKey: setting("VAPID_PUBLIC_KEY"),
    privateKey: setting("VAPID_PRIVATE_KEY"),
    subject: setting("VAPID_SUBJECT"),
  },
});
if (!cardRoom.moderation.enabled) console.log("moderation is off: set CARDROOM_ADMIN_TOKEN to turn on the admin app at /admin/");
if (!cardRoom.push.enabled) console.log("push notifications are off: set CARDROOM_VAPID_PUBLIC_KEY and CARDROOM_VAPID_PRIVATE_KEY to turn them on");

/**
 * This server's own address, for link previews: from the proxy's headers (Railway) or the Host header.
 * Anything that isn't a plain host name and port is refused, so nothing odd lands in the page.
 */
function originOf(headers: Record<string, string | string[] | undefined>): string {
  const first = (h: string | string[] | undefined) => String(Array.isArray(h) ? h[0] : (h ?? "")).split(",")[0]!.trim();
  const host = first(headers["x-forwarded-host"]) || first(headers.host);
  const proto = first(headers["x-forwarded-proto"]) === "https" ? "https" : "http";
  return /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? `${proto}://${host}` : "";
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  try {
    // Railway (and any other host) checks this before sending traffic to a new deploy.
    if (req.url === "/healthz") return void res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    if (await cardRoom.handle(req, res)) return;
    const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    // /designer and /admin are their apps' front doors: with the slash, so their files resolve.
    const bare = apps.find((a) => `${path}/` === a.at);
    if (bare) return void res.writeHead(308, { location: bare.at }).end();
    const app = apps.find((a) => path.startsWith(a.at));
    const root = app?.root ?? web;
    let file = normalize(join(root, app ? path.slice(app.at.length) : path));
    if (file !== root && !file.startsWith(root + sep)) return void res.writeHead(403).end();
    // The embed's files are fetched by other sites' pages: a missing one is a 404, never the app.
    const embed = !app && path.startsWith("/embed/");
    if (embed && (!existsSync(file) || statSync(file).isDirectory())) return void res.writeHead(404).end();
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html"); // the app routes itself
    if (!existsSync(file)) return void res.writeHead(404).end(`Build the app first: ${app?.build ?? "npm run build -w @spades/web"}`);
    // The page and the service worker must never be stale; the hashed assets can be cached for good.
    const fresh = file.endsWith("index.html") || file.endsWith("sw.js") || file.endsWith(".webmanifest");
    const hashed = /[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2)$/.test(file);
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": fresh ? "no-cache" : path.startsWith("/assets/") || (app && hashed) ? "public, max-age=31536000, immutable" : embed ? "public, max-age=300" : "public, max-age=3600",
      // A <script type="module"> on another site fetches with CORS.
      ...(embed ? { "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin" } : {}),
      // The admin app is nobody else's business: not in a frame, not in a search engine.
      ...(app?.at === "/admin/" ? { "x-frame-options": "DENY", "x-robots-tag": "noindex", "referrer-policy": "no-referrer" } : {}),
    });
    // The page carries link-preview tags whose image needs this server's full address.
    if (file.endsWith("index.html")) return void res.end(readFileSync(file, "utf8").replaceAll("__ORIGIN__", originOf(req.headers)));
    createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(port, () => console.log(`Card Room on http://localhost:${port}`));
