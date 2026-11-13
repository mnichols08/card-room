// Challenges: a player can turn on a link that anyone may use to challenge them to a game. Sending
// one sets up a table (the challenged player's rules, them against the challenger, a random
// partner for each), puts the challenger's message in the table chat, and buzzes the challenged
// player's phone. They tap it and land at the table.
//
//   challenges/<code>      server only: the link's owner, their name, rules, on or off
//   challengeOf/<player>   server only: a player's code
import { familyPalace, validatePalaceRules, type PalaceRules } from "@cardroom/palace";
import { brokennilsTable, mulberry32, pickPersonas, validatePreset, type RulePreset } from "@spades/rules";
import { GAMES, gameName, type GameId, type TableOptions } from "./games.js";
import { palaceOptions, palaceRulesFrom } from "./palace.js";
import { newPlayerId, playerCookie, playerOf } from "@spades/rooms/server";
import type { Push } from "./push.js";

interface ChallengeDoc {
  code: string;
  player: string;
  name: string;
  enabled: boolean;
  /** Spades rules. */
  rules: RulePreset;
  /** Palace rules. Missing on links from before there were other games: the family rules. */
  palaceRules?: PalaceRules;
  /** The games this link takes challenges for; the challenger picks one. Missing means spades. */
  games?: GameId[];
  /** Recent challenge times, for the rate limit. */
  recent: number[];
}

interface Rooms {
  sync: {
    write(collection: string, key: string, fields: Record<string, unknown>): Promise<unknown>;
    documents(): Promise<{ get(collection: string, key: string): Record<string, unknown> | undefined }>;
  };
  create(options: TableOptions, settings?: unknown): Promise<string>;
  seatPlayer(id: string, seat: number, player: string, name: string): Promise<void>;
  seatBot(id: string, seat: number, name: string): Promise<void>;
  say(id: string, seat: number, text: string): Promise<unknown>;
}

const LETTERS = "abcdefghjkmnpqrstuvwxyz23456789";
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => LETTERS[b % LETTERS.length]).join("");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const clean = (value: unknown, max: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** How many challenges one link takes in an hour, and how often one person may send. */
export const LINK_LIMIT_PER_HOUR = 6;
const SENDER_GAP_MS = 60_000;

export function createChallenges(rooms: Rooms, push: Push, { mount = "/challenges" } = {}) {
  const docs = rooms.sync.documents();
  const lastSent = new Map<string, number>();

  async function get(code: string): Promise<ChallengeDoc | undefined> {
    const doc = (await docs).get("challenges", code) as unknown as ChallengeDoc | undefined;
    return doc?.player
      ? structuredClone({ code: doc.code, player: doc.player, name: doc.name, enabled: doc.enabled, rules: doc.rules, palaceRules: palaceRulesFrom(doc.palaceRules ?? familyPalace), games: doc.games ?? ["spades"], recent: doc.recent ?? [] })
      : undefined;
  }
  const save = (c: ChallengeDoc) => rooms.sync.write("challenges", c.code, { ...c });
  const codeOf = async (player: string) => (await docs).get("challengeOf", player)?.code as string | undefined;

  const offered = (c: ChallengeDoc) => (c.games ?? ["spades"]).map((id) => ({ id, name: gameName(id), rules: id === "palace" ? (c.palaceRules ?? familyPalace).name : c.rules.name }));
  const mine = (c: ChallengeDoc) => ({ code: c.code, name: c.name, enabled: c.enabled, rules: c.rules.name, games: offered(c), notifications: push.enabled });
  const known = new Set<string>(GAMES.map((g) => g.id));

  async function handle(request: Request, path: string): Promise<Response> {
    const parts = path.split("/").filter(Boolean);
    const method = request.method;
    const input = method === "POST" ? (((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>) : {};
    const player = playerOf(request);

    // GET /challenges/mine → your link, if you have one
    if (parts[0] === "mine" && method === "GET") {
      const code = player ? await codeOf(player) : undefined;
      const c = code ? await get(code) : undefined;
      return json(c ? mine(c) : { code: null, notifications: push.enabled });
    }

    // POST /challenges/mine { name, rules?, enabled?, newLink? } → make or change your link
    if (parts[0] === "mine" && method === "POST") {
      const me = player ?? newPlayerId();
      const existing = await codeOf(me);
      let c = existing ? await get(existing) : undefined;
      const rules = input.rules ? { ...brokennilsTable, ...(input.rules as RulePreset) } : (c?.rules ?? brokennilsTable);
      if (validatePreset(rules).length) return json({ error: validatePreset(rules).join(" ") }, 400);
      const palaceRules = input.palaceRules ? palaceRulesFrom(input.palaceRules) : (c?.palaceRules ?? familyPalace);
      if (validatePalaceRules(palaceRules).length) return json({ error: validatePalaceRules(palaceRules).join(" ") }, 400);
      const games = Array.isArray(input.games) ? (input.games.filter((g) => known.has(String(g))) as GameId[]) : (c?.games ?? (["spades", "palace"] as GameId[]));
      if (!games.length) return json({ error: "Pick at least one game to be challenged to." }, 400);
      if (c && input.newLink) {
        await rooms.sync.write("challenges", c.code, { enabled: false, player: null }); // the old link stops working
        c = undefined;
      }
      const name = clean(input.name, 20) || c?.name || "Player";
      c = c ?? { code: random(6), player: me, name, enabled: true, rules, palaceRules, games, recent: [] };
      c.name = name;
      c.rules = rules;
      c.palaceRules = palaceRules;
      c.games = [...new Set(games)];
      if (typeof input.enabled === "boolean") c.enabled = input.enabled;
      await save(c);
      await rooms.sync.write("challengeOf", me, { code: c.code });
      return json(mine(c), 200, player ? {} : { "set-cookie": playerCookie(me) });
    }

    const code = parts[0];
    const c = code ? await get(code) : undefined;
    if (!c) return json({ error: "That challenge link doesn't work anymore." }, 404);

    // GET /challenges/:code → who you'd be challenging
    if (parts.length === 1 && method === "GET") return json({ name: c.name, enabled: c.enabled, rules: c.rules.name, games: offered(c) });

    // POST /challenges/:code { name, message } → challenge them
    if (parts.length === 1 && method === "POST") {
      if (!c.enabled) return json({ error: `${c.name} isn't taking challenges right now.` }, 409);
      if (player === c.player) return json({ error: "You can't challenge yourself. Send the link to someone!" }, 400);
      const name = clean(input.name, 20);
      if (!name) return json({ error: "Tell them who's challenging." }, 400);
      const message = clean(input.message, 140);
      const offers = c.games ?? ["spades"];
      const game: GameId = input.game === undefined ? offers[0]! : (String(input.game) as GameId);
      if (!offers.includes(game)) return json({ error: `${c.name} isn't taking ${gameName(game)} challenges.` }, 400);
      const now = Date.now();
      // A sender is known by their cookie and their address, whichever they have. Someone with
      // neither isn't held to the per-sender pace; the link's hourly cap still applies.
      const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      const known = [player, address].filter((k): k is string => !!k).map((k) => `${code}/${k}`);
      if (known.some((k) => now - (lastSent.get(k) ?? 0) < SENDER_GAP_MS)) return json({ error: "You just sent one. Give them a minute." }, 429);
      c.recent = c.recent.filter((t) => now - t < 3_600_000);
      if (c.recent.length >= LINK_LIMIT_PER_HOUR) return json({ error: `${c.name} has a lot of challenges right now. Try again later.` }, 429);
      c.recent.push(now);
      await save(c);

      // Them in the south seat, the challenger next to them as an opponent, and two bots: in spades
      // a partner each; in Palace, two more players to make it lively.
      const challenger = player ?? newPlayerId();
      // Remember the sender under the cookie they'll have from now on, too.
      for (const k of [...known, `${code}/${challenger}`]) lastSent.set(k, now);
      const id = await rooms.create(game === "palace" ? palaceOptions(c.palaceRules, 4) : c.rules);
      await rooms.seatPlayer(id, 0, c.player, c.name);
      await rooms.seatPlayer(id, 1, challenger, name);
      const [p1, p2] = pickPersonas(2, mulberry32(now >>> 0));
      await rooms.seatBot(id, 2, p1!.name);
      await rooms.seatBot(id, 3, p2!.name);
      if (message) await rooms.say(id, 1, message);

      const delivered = await push.notify(c.player, {
        title: `${name} challenged you to ${gameName(game)}! ${game === "palace" ? "🏰" : "♠️"}`,
        body: message ? `"${message}" · Tap to take your seat.` : "Tap to take your seat.",
        url: `/?table=${id}`,
        tag: `challenge-${id}`,
      });
      return json({ id, game, notified: delivered > 0 }, 201, player ? {} : { "set-cookie": playerCookie(challenger) });
    }

    return json({ error: "Not found" }, 404);
  }

  return {
    async fetch(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url);
      if (pathname !== mount && !pathname.startsWith(`${mount}/`)) return null;
      return handle(request, pathname.slice(mount.length));
    },
  };
}
