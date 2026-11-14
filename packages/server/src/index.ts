// The Card Room server: rooms (moves, seats, bots), the sync log, and the built web app.
//
//   PORT=8787 CARDROOM_DB=cardroom.db node dist/index.js
//
// Settings are CARDROOM_*; the older SPADES_* names still work (CARDROOM_* wins if both are set).
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
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

// A SQLite log keeps tables across restarts; without CARDROOM_DB, they live in memory.
const db = setting("DB");
const log = db ? await (await import("@zubra/sync/sqlite")).sqliteLog(db, { keep: "latest" }) : undefined;
// Bots take humanlike time unless CARDROOM_BOT_DELAY fixes it (handy for testing).
const botDelay = setting("BOT_DELAY");
const cardRoom = createCardRoom({
  log,
  botDelay: botDelay ? Number(botDelay) : undefined,
  // Push notifications are on when the server has VAPID keys (`npx web-push generate-vapid-keys`).
  push: {
    publicKey: setting("VAPID_PUBLIC_KEY"),
    privateKey: setting("VAPID_PRIVATE_KEY"),
    subject: setting("VAPID_SUBJECT"),
  },
  // Words that names on open tables may not contain, on top of the built-in list.
  lobby: { blockedNames: (setting("BLOCKED_NAMES") ?? "").split(",").map((w) => w.trim()).filter(Boolean) },
  // Houses can connect their own AI key for their bots' table talk; this seals those keys at rest.
  // CARDROOM_AI_KEY is the card room's own key: with it, every table's bots talk through a model.
  ai: { secret: setting("SECRET"), shared: { key: setting("AI_KEY"), provider: setting("AI_PROVIDER"), model: setting("AI_MODEL"), daily: Number(setting("AI_DAILY")) || undefined } },
});
if (!setting("SECRET")) console.log("houses' AI keys are stored unsealed: set CARDROOM_SECRET to encrypt them");
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
    let file = normalize(join(web, path));
    if (!file.startsWith(web)) return void res.writeHead(403).end();
    // The embed's files are fetched by other sites' pages: a missing one is a 404, never the app.
    const embed = path.startsWith("/embed/");
    if (embed && (!existsSync(file) || statSync(file).isDirectory())) return void res.writeHead(404).end();
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(web, "index.html"); // the app routes itself
    if (!existsSync(file)) return void res.writeHead(404).end("Build the web app first: npm run build -w @spades/web");
    // The page and the service worker must never be stale; the hashed assets can be cached for good.
    const fresh = file.endsWith("index.html") || file.endsWith("sw.js") || file.endsWith(".webmanifest");
    res.writeHead(200, {
      "content-type": TYPES[extname(file)] ?? "application/octet-stream",
      "cache-control": fresh ? "no-cache" : path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : embed ? "public, max-age=300" : "public, max-age=3600",
      // A <script type="module"> on another site fetches with CORS.
      ...(embed ? { "access-control-allow-origin": "*", "cross-origin-resource-policy": "cross-origin" } : {}),
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
