// "Report a problem": a player says what went wrong from inside the app, and the server opens an
// issue for it on GitHub. Nobody needs a GitHub account: the server has a token (CARDROOM_GITHUB_TOKEN)
// that may open issues on the card room's repository, and that token never leaves it.
//
// The issue is public, so it is built from as little as explains the problem: the player's own words,
// where they were (which screen, which game), what the page had logged going wrong, and, only when
// they agreed to each, a picture of their screen and their browser's details. Never their name, their
// player cookie, the chat, or a table's link (a table's link is its invitation). Which table it was is
// kept here, beside the issue's number, for whoever runs the server.
//
// GitHub's API can't take a picture with an issue, so a screenshot is kept here and the issue links
// to it. Only the newest few are kept.
//
//   bugs/shot-<id>   server only: one screenshot (served at <mount>/shots/<id>.jpg)
//   bugs/shots       server only: when each was taken, for dropping the oldest
//   bugs/reports     server only: issue number → the table it was sent from
import { playerOf, type RoomDoc } from "@spades/rooms/server";
import { gameName, gameOfOptions } from "./games.js";

interface Rooms {
  sync: {
    write(collection: string, key: string, fields: Record<string, unknown>): Promise<unknown>;
    documents(): Promise<{ get(collection: string, key: string): Record<string, unknown> | undefined }>;
  };
  room(id: string): Promise<RoomDoc<unknown> | undefined>;
}

export interface BugOptions {
  /** A GitHub token that may open issues on `repo` (CARDROOM_GITHUB_TOKEN). Without one, reporting is off. */
  token?: string;
  /** "owner/name" (CARDROOM_GITHUB_REPO). */
  repo?: string;
  /** What's deployed (a commit), for the issue. */
  version?: string;
  mount?: string;
  /** Reports one browser may send in ten minutes, and everyone together in a day. */
  each?: number;
  daily?: number;
  /** For tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

export const DEFAULT_REPO = "mnichols08/card-room";
export const DESCRIPTION_LIMIT = 2000;
/** The biggest screenshot taken, in bytes. The page shrinks its picture to fit well under this. */
export const SHOT_LIMIT = 600_000;
/** The biggest report the server reads at all: a screenshot as base64, and the rest. */
export const REPORT_LIMIT = 1_000_000;
const SHOTS_KEPT = 30;
const ERRORS_KEPT = 10;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** One line of someone's text: no control characters, no longer than `max`. */
const line = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, max);
/** Several lines of it. */
const lines = (value: unknown, max: number) =>
  String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);

/**
 * A stranger's words as plain text in an issue: no formatting, no links by name, no HTML, and above all
 * no @mentions or #references, which would notify people and mark other issues in the token's name.
 */
export const plain = (text: string) => text.replace(/[\\`*_~[\]<>|#]/g, "\\$&").replace(/@/g, "@\u200b");
/** The same words as a quote. */
const quote = (text: string) =>
  plain(text)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
/** A code block nothing inside can close. */
function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}\n${text}\n${ticks}`;
}
const details = (summary: string, body: string) => `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;

/** The picture in a `data:image/jpeg;base64,…` address, or null if it isn't a JPEG that fits. */
function jpegOf(value: unknown): Buffer | null {
  const match = typeof value === "string" ? value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/) : null;
  if (!match || match[1]!.length > SHOT_LIMIT * 1.4) return null;
  const bytes = Buffer.from(match[1]!, "base64");
  const jpeg = bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return jpeg && bytes.length <= SHOT_LIMIT ? bytes : null;
}

/** The browser's details, down to the ones asked for, each cut to size. */
const BROWSER_FIELDS: [string, string][] = [
  ["userAgent", "Browser"],
  ["platform", "Device"],
  ["viewport", "Window"],
  ["screen", "Screen"],
  ["language", "Language"],
  ["installed", "Installed as an app"],
  ["touch", "Touch screen"],
  ["online", "Online"],
  ["reducedMotion", "Prefers reduced motion"],
];
function browserOf(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const given = value as Record<string, unknown>;
  const rows = BROWSER_FIELDS.flatMap(([key, label]) => {
    const v = given[key];
    const text = typeof v === "boolean" ? (v ? "yes" : "no") : line(v, 300);
    return text ? [`${label}: ${text}`] : [];
  });
  return rows.length ? rows.join("\n") : null;
}

/** This server's own address as the player reached it, for the screenshot's link. */
function originOf(request: Request): string {
  const first = (name: string) => (request.headers.get(name) ?? "").split(",")[0]!.trim();
  const host = first("x-forwarded-host") || first("host") || new URL(request.url).host;
  const forwarded = first("x-forwarded-proto");
  const proto = forwarded ? (forwarded === "https" ? "https" : "http") : new URL(request.url).protocol.replace(":", "");
  return /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? `${proto}://${host}` : "";
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const randomId = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => ALPHABET[b % ALPHABET.length]).join("");

export function createBugs(rooms: Rooms, options: BugOptions = {}) {
  const token = options.token?.trim() ?? "";
  const repo = /^[\w.-]+\/[\w.-]+$/.test(options.repo?.trim() ?? "") ? options.repo!.trim() : DEFAULT_REPO;
  const enabled = token.length > 0;
  const mount = (options.mount ?? "/bugs").replace(/\/$/, "");
  const send = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const each = options.each ?? 3;
  const daily = options.daily ?? 40;
  const version = line(options.version, 40);
  const docs = rooms.sync.documents();

  // Anyone can reach this without signing in to anything, and every report becomes a public issue:
  // so a browser gets a few, and the whole card room gets a day's worth.
  const sent = new Map<string, number[]>();
  let today: number[] = [];
  function tooMany(who: string): string | null {
    const at = now();
    today = today.filter((t) => at - t < 86_400_000);
    const mine = (sent.get(who) ?? []).filter((t) => at - t < 600_000);
    sent.set(who, mine);
    if (mine.length >= each) return "That's a few reports in a row. Thank you! Give it ten minutes before the next.";
    if (today.length >= daily) return "The card room has had a lot of reports today. Try again tomorrow.";
    return null;
  }
  function count(who: string) {
    const at = now();
    today.push(at);
    sent.set(who, [...(sent.get(who) ?? []), at]);
    // Forget browsers that haven't reported in a while.
    if (sent.size > 500) for (const [k, times] of sent) if (times.every((t) => at - t >= 600_000)) sent.delete(k);
  }

  /** Keep a screenshot, drop the oldest past the newest few, and answer its id. */
  async function keep(shot: Buffer): Promise<string> {
    const id = randomId(20);
    await rooms.sync.write("bugs", `shot-${id}`, { jpeg: shot.toString("base64"), at: now() });
    const index = { ...((await docs).get("bugs", "shots") ?? {}), [id]: now() } as Record<string, unknown>;
    const old = Object.entries(index)
      .filter((e): e is [string, number] => typeof e[1] === "number")
      .sort((a, b) => b[1] - a[1])
      .slice(SHOTS_KEPT)
      .map(([k]) => k);
    for (const k of old) await rooms.sync.write("bugs", `shot-${k}`, { jpeg: null, at: null });
    await rooms.sync.write("bugs", "shots", { [id]: now(), ...Object.fromEntries(old.map((k) => [k, null])) });
    return id;
  }
  const drop = async (id: string) => {
    await rooms.sync.write("bugs", `shot-${id}`, { jpeg: null, at: null });
    await rooms.sync.write("bugs", "shots", { [id]: null });
  };

  /** What everyone at a table can see about it that helps explain a problem: never who's there. */
  async function tableLines(id: string): Promise<string[] | null> {
    const room = /^[a-z0-9-]{1,40}$/i.test(id) ? await rooms.room(id) : undefined;
    if (!room) return null;
    const people = room.seats.filter((s) => s.name && !s.bot).length;
    const bots = room.seats.filter((s) => s.bot).length;
    const moves = Object.keys((await docs).get("moves", id) ?? {}).length;
    return [
      `Game: ${gameName(gameOfOptions(room.info ?? room.summary))}`,
      `Seats: ${room.seats.length} (${people} ${people === 1 ? "person" : "people"}, ${bots} computer, ${room.seats.length - people - bots} empty)`,
      `Dealt: ${room.started ? `yes, ${moves} ${moves === 1 ? "move" : "moves"} in` : "not yet"}`,
      `Kind of table: ${room.locked ? "tournament match" : room.open ? "open to everyone" : "family table"}`,
      ...(room.settings ? [`Settings: ${JSON.stringify(room.settings)}`] : []),
      ...(room.info ? [`Rules: ${JSON.stringify(room.info).slice(0, 3000)}`] : []),
    ];
  }

  async function report(request: Request): Promise<Response> {
    if (!enabled) return json({ error: "This card room can't take reports yet." }, 503);
    if (Number(request.headers.get("content-length") ?? 0) > REPORT_LIMIT) return json({ error: "That report is too big to send." }, 413);
    const player = playerOf(request);
    const who = player ?? `ip:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"}`;
    const wait = tooMany(who);
    if (wait) return json({ error: wait }, 429);

    const input = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const description = lines(input.description, DESCRIPTION_LIMIT);
    const screen = line(input.screen, 60);
    const game = line(input.game, 40);
    const table = line(input.table, 40);
    const built = line(input.built, 40);
    const errors = (Array.isArray(input.errors) ? input.errors : []).slice(-ERRORS_KEPT).map((e) => lines(e, 1200)).filter(Boolean);
    const browser = browserOf(input.browser);
    const shot = jpegOf(input.screenshot);
    if (input.screenshot && !shot) return json({ error: "That picture couldn't be sent. Try again without it." }, 400);
    const aboutTable = table ? await tableLines(table) : null;

    const origin = originOf(request);
    // Without an address of our own there's nowhere for the picture's link to point.
    const shotId = shot && origin ? await keep(shot) : null;

    const where = [screen || "somewhere in the app", game && `(${game})`].filter(Boolean).join(" ");
    const firstLine = description.split("\n")[0]!.trim();
    const title = firstLine ? (firstLine.length > 80 ? `${firstLine.slice(0, 79).trimEnd()}…` : firstLine) : `Problem reported on ${where}`;
    const body = [
      description ? quote(description) : "_The player didn't add a description._",
      "",
      "| | |",
      "| --- | --- |",
      `| Where | ${plain(where)} |`,
      ...(version ? [`| Server version | \`${version}\` |`] : []),
      ...(built ? [`| Page built | ${plain(built)} |`] : []),
      `| Sent | ${new Date(now()).toISOString()} |`,
      "",
      ...(shotId ? [`![What the player saw](${origin}${mount}/shots/${shotId}.jpg)`, ""] : []),
      ...(errors.length ? [details(`Errors the page logged (${errors.length})`, fence(errors.join("\n\n"))), ""] : []),
      ...(aboutTable ? [details("The table", fence(aboutTable.join("\n"))), ""] : []),
      ...(browser ? [details("Browser", fence(browser)), ""] : []),
      `_Sent from inside Card Room with “Report a problem”.${shot ? "" : " No screenshot."}${browser ? "" : " The player chose not to share browser details."}_`,
    ].join("\n");

    let issue: { number?: number; html_url?: string } | null = null;
    try {
      const response = await send(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          "content-type": "application/json",
          "user-agent": "card-room",
        },
        body: JSON.stringify({ title: plain(title), body, labels: ["bug", "player report"] }),
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) issue = (await response.json()) as { number?: number; html_url?: string };
      else console.error(`bugs: GitHub answered ${response.status} opening an issue on ${repo}`, (await response.text().catch(() => "")).slice(0, 300));
    } catch (e) {
      console.error("bugs: couldn't reach GitHub", e);
    }
    if (!issue || typeof issue.number !== "number") {
      if (shotId) await drop(shotId);
      return json({ error: "The report couldn't be sent just now. Try again in a minute." }, 502);
    }
    count(who);
    if (table) await rooms.sync.write("bugs", "reports", { [`n${issue.number}`]: { table, at: now() } });
    return json({ ok: true, number: issue.number, url: issue.html_url ?? `https://github.com/${repo}/issues/${issue.number}` }, 201);
  }

  return {
    enabled,
    repo,
    async fetch(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url);
      if (pathname !== mount && !pathname.startsWith(`${mount}/`)) return null;
      const action = pathname.slice(mount.length).split("/").filter(Boolean).join("/");
      // GET /bugs/config → whether the page should offer "Report a problem" at all
      if (action === "config" && request.method === "GET") return json({ enabled });
      // POST /bugs { description?, screen?, game?, table?, built?, errors?, browser?, screenshot? } → { number, url }
      if (action === "" && request.method === "POST") return report(request);
      // GET /bugs/shots/<id>.jpg → a screenshot an issue links to
      const shot = action.match(/^shots\/([a-z0-9]{20})\.jpg$/);
      if (shot && request.method === "GET") {
        const jpeg = (await docs).get("bugs", `shot-${shot[1]}`)?.jpeg;
        if (typeof jpeg !== "string") return json({ error: "That picture is gone." }, 404);
        return new Response(Buffer.from(jpeg, "base64"), {
          headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" },
        });
      }
      return json({ error: "Not found" }, 404);
    },
  };
}
