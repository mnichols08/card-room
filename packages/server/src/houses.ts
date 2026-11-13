// Houses: a family's own corner of the card room. A house has members (who joined with its invite
// link), saved house rules with one as the default, and the tables it has opened.
//
// Everything is one server-only document per house (`houses/<slug>` in the sync log); pages read
// it through these endpoints, which show members only what members may see. A member is the same
// player cookie that holds a seat at a table.
import { familyPalace, validatePalaceRules, type PalaceRules } from "@cardroom/palace";
import { brokennilsTable, validatePreset, type RulePreset } from "@spades/rules";
import { newPlayerId, playerCookie, playerOf, type RoomDoc } from "@spades/rooms/server";
import { leaderboard, palaceLeaderboard, type FinishedGame, type FinishedPalace } from "./leaderboard.js";
import type { Push } from "./push.js";
import { gameName, type GameId, type TableOptions } from "./games.js";
import { palaceOptions, type PalaceSummary } from "./palace.js";

export type Role = "owner" | "admin" | "member";

interface Member {
  /** A public id, safe to show other members. */
  id: string;
  /** The player's secret cookie value. Never sent to anyone. */
  player: string;
  name: string;
  role: Role;
  joined: number;
}

interface TableRecord {
  id: string;
  /** Missing on tables from before there were other games: those are spades. */
  game?: GameId;
  rules: string;
  created: number;
}

export interface HouseDoc {
  slug: string;
  name: string;
  code: string;
  members: Member[];
  /** Spades house rules (the house's first game, so they keep their original names). */
  presets: RulePreset[];
  defaultPreset: string;
  /** Palace house rules. Missing until the house saves some: then they're the family rules. */
  palacePresets?: PalaceRules[];
  palaceDefault?: string;
  tables: TableRecord[];
}

interface Rooms {
  sync: {
    write(collection: string, key: string, fields: Record<string, unknown>): Promise<unknown>;
    documents(): Promise<{ get(collection: string, key: string): Record<string, unknown> | undefined }>;
  };
  create(options: TableOptions): Promise<string>;
  room(id: string): Promise<RoomDoc<unknown> | undefined>;
}

const LETTERS = "abcdefghjkmnpqrstuvwxyz23456789";
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => LETTERS[b % LETTERS.length]).join("");

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** "Grammi's House" → "grammis-house". */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "house"
  );
}

const cleanName = (value: unknown, fallback: string) => String(value ?? "").trim().slice(0, 30) || fallback;

const gameOf = (value: unknown): GameId => (value === "palace" ? "palace" : "spades");

/** Palace house rules from a page: checked, and given an id of their own if they're new. */
function cleanPalace(value: unknown): PalaceRules | string {
  if (!value || typeof value !== "object") return "Those rules are missing.";
  const rules = { ...familyPalace, ...(value as PalaceRules) };
  rules.name = cleanName(rules.name, "House rules");
  // The id is the page's, or a new one: never the defaults' (that would replace them).
  const given = (value as { id?: unknown }).id;
  rules.id = typeof given === "string" && /^[\w-]{1,60}$/.test(given) ? given : `house-${random(8)}`;
  const errors = validatePalaceRules(rules);
  return errors.length ? errors.join(" ") : rules;
}

/** House rules from a page: checked, and given an id of their own if they're new. */
function cleanPreset(value: unknown): RulePreset | string {
  if (!value || typeof value !== "object") return "Those rules are missing.";
  const preset = { ...brokennilsTable, ...(value as RulePreset) };
  preset.name = cleanName(preset.name, "House rules");
  const given = (value as { id?: unknown }).id;
  preset.id = typeof given === "string" && /^[\w-]{1,60}$/.test(given) ? given : `house-${random(8)}`;
  const errors = validatePreset(preset);
  return errors.length ? errors.join(" ") : preset;
}

export function createHouses(rooms: Rooms, { mount = "/houses", push }: { mount?: string; push?: Push } = {}) {
  const docs = rooms.sync.documents();
  const get = async (slug: string) => {
    const doc = (await docs).get("houses", slug);
    if (!doc) return undefined;
    // Keep only the house's own fields (the view may carry sync bookkeeping such as $clocks).
    const { slug: s, name, code, members, presets, defaultPreset, palacePresets, palaceDefault, tables } = doc as unknown as HouseDoc;
    return structuredClone({ slug: s, name, code, members, presets, defaultPreset, palacePresets: palacePresets ?? [familyPalace], palaceDefault: palaceDefault ?? palacePresets?.[0]?.id ?? familyPalace.id, tables }) as HouseDoc;
  };
  const save = (house: HouseDoc) => rooms.sync.write("houses", house.slug, { ...house });

  /** What a member sees. No player secrets; the invite code, since members share the link. */
  async function forMember(house: HouseDoc, me: Member) {
    const tables = await Promise.all(
      house.tables
        .slice(-20)
        .reverse()
        .map(async (t) => {
          const room = await rooms.room(t.id);
          return {
            id: t.id,
            game: t.game ?? "spades",
            rules: t.rules,
            created: t.created,
            seats: room?.seats ?? [],
            started: room?.started ?? false,
            summary: room?.summary ?? null,
          };
        }),
    );
    return {
      slug: house.slug,
      name: house.name,
      code: house.code,
      me: { id: me.id, name: me.name, role: me.role },
      members: house.members.map((m) => ({ id: m.id, name: m.name, role: m.role })),
      presets: house.presets,
      defaultPreset: house.defaultPreset,
      palacePresets: house.palacePresets,
      palaceDefault: house.palaceDefault,
      // Games still going first, then the rest, newest first.
      tables: tables.sort((a, b) => Number((a.summary as { phase?: string } | null)?.phase === "finished") - Number((b.summary as { phase?: string } | null)?.phase === "finished")),
    };
  }

  /** The house's finished games, with each seat as a member, a guest or a bot. */
  async function finishedGames(house: HouseDoc): Promise<FinishedGame[]> {
    const view = await docs;
    const games: FinishedGame[] = [];
    for (const table of house.tables) {
      if ((table.game ?? "spades") !== "spades") continue;
      const room = await rooms.room(table.id);
      if (!room || (room.summary as { phase?: string } | null)?.phase !== "finished") continue;
      const game = view.get("games", table.id) as { holders?: (string | null)[] } | undefined;
      // Any seat's view has the whole history and the winner; seat 0's is always written.
      const seen = view.get("views", `${table.id}/0`)?.view as { history?: FinishedGame["history"]; winner?: 0 | 1 | null } | undefined;
      if (!seen?.history || seen.winner == null) continue;
      const seats = room.seats.map((seat, i): FinishedGame["seats"][number] => {
        if (seat.bot) return { kind: "bot", name: seat.name ?? "Bot" };
        const member = house.members.find((m) => m.player === game?.holders?.[i]);
        return member ? { kind: "member", id: member.id, name: member.name } : { kind: "guest", name: seat.name ?? "Guest" };
      });
      games.push({ id: table.id, seats, winner: seen.winner, history: seen.history });
    }
    return games;
  }

  /** The house's finished Palace games: who sat where and the order they went out. */
  async function finishedPalace(house: HouseDoc): Promise<FinishedPalace[]> {
    const view = await docs;
    const games: FinishedPalace[] = [];
    for (const table of house.tables) {
      if (table.game !== "palace") continue;
      const room = await rooms.room(table.id);
      const summary = room?.summary as PalaceSummary | null;
      if (!room || summary?.phase !== "finished" || summary.loser === null) continue;
      const game = view.get("games", table.id) as { holders?: (string | null)[] } | undefined;
      const seats = room.seats.map((seat, i): FinishedPalace["seats"][number] => {
        if (seat.bot) return { kind: "bot", name: seat.name ?? "Bot" };
        const member = house.members.find((m) => m.player === game?.holders?.[i]);
        return member ? { kind: "member", id: member.id, name: member.name } : { kind: "guest", name: seat.name ?? "Guest" };
      });
      games.push({ id: table.id, seats, order: [...summary.finished, summary.loser] });
    }
    return games;
  }

  async function handle(request: Request, path: string): Promise<Response> {
    const parts = path.split("/").filter(Boolean);
    const method = request.method;
    let input: Record<string, unknown> = {};
    if (method === "POST") input = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const cookiePlayer = playerOf(request);

    // POST /houses { name, you, rules? } → a new house, with you as its owner
    if (parts.length === 0 && method === "POST") {
      const name = cleanName(input.name, "Our House");
      let slug = slugify(name);
      while (await get(slug)) slug = `${slugify(name)}-${random(3)}`;
      const rules = input.rules ? cleanPreset(input.rules) : brokennilsTable;
      if (typeof rules === "string") return json({ error: rules }, 400);
      const player = cookiePlayer ?? newPlayerId();
      const owner: Member = { id: random(8), player, name: cleanName(input.you, "Host"), role: "owner", joined: Date.now() };
      const house: HouseDoc = { slug, name, code: random(6), members: [owner], presets: [rules], defaultPreset: rules.id, palacePresets: [familyPalace], palaceDefault: familyPalace.id, tables: [] };
      await save(house);
      return json(await forMember(house, owner), 201, cookiePlayer ? {} : { "set-cookie": playerCookie(player) });
    }

    const house = parts[0] ? await get(parts[0]) : undefined;
    if (!house) return json({ error: "There's no house at that link." }, 404);
    const action = parts[1] ?? "";
    const me = house.members.find((m) => m.player === cookiePlayer);

    // GET /houses/:slug[?code=…] → the house for a member; its name for someone holding the invite
    if (action === "" && method === "GET") {
      if (me) return json(await forMember(house, me));
      const code = new URL(request.url).searchParams.get("code");
      if (code && code === house.code) return json({ slug: house.slug, name: house.name, member: false }, 200);
      return json({ error: "Ask someone in the house for the invite link." }, 403);
    }
    // GET /houses/:slug/leaderboard → standings from the house's finished games (members only)
    if (action === "leaderboard" && method === "GET") {
      if (!me) return json({ error: "Join the house first." }, 403);
      const members = house.members.map((m) => ({ id: m.id, name: m.name }));
      if (gameOf(new URL(request.url).searchParams.get("game")) === "palace") return json(palaceLeaderboard(await finishedPalace(house), members));
      return json(leaderboard(await finishedGames(house), members));
    }

    if (method !== "POST") return json({ error: "Not found" }, 404);

    // POST /houses/:slug/join { code, name }
    if (action === "join") {
      if (me) return json(await forMember(house, me));
      if (input.code !== house.code) return json({ error: "That invite link has expired. Ask for a new one." }, 403);
      const player = cookiePlayer ?? newPlayerId();
      const member: Member = { id: random(8), player, name: cleanName(input.name, "Guest"), role: "member", joined: Date.now() };
      house.members.push(member);
      await save(house);
      return json(await forMember(house, member), 200, cookiePlayer ? {} : { "set-cookie": playerCookie(player) });
    }

    if (!me) return json({ error: "Join the house first." }, 403);
    const canManage = me.role === "owner" || me.role === "admin";

    // POST /houses/:slug/tables { game?, presetId?, seats? } → a new table with house rules
    if (action === "tables") {
      const game = gameOf(input.game);
      let id: string;
      let rulesName: string;
      if (game === "palace") {
        const rules = house.palacePresets!.find((p) => p.id === (input.presetId ?? house.palaceDefault)) ?? house.palacePresets![0] ?? familyPalace;
        id = await rooms.create(palaceOptions(rules, input.seats));
        rulesName = rules.name;
      } else {
        const preset = house.presets.find((p) => p.id === (input.presetId ?? house.defaultPreset)) ?? house.presets[0] ?? brokennilsTable;
        id = await rooms.create(preset);
        rulesName = preset.name;
      }
      house.tables.push({ id, game, rules: rulesName, created: Date.now() });
      await save(house);
      // Let the rest of the house know there's a seat waiting.
      const emoji = game === "palace" ? "🏰" : "♠️";
      for (const m of house.members) {
        if (m.player === me.player) continue;
        void push?.notify(m.player, { title: `${me.name} opened a ${gameName(game)} table at ${house.name} ${emoji}`, body: `${rulesName}. Tap to pull up a chair.`, url: `/?table=${id}&house=${house.slug}`, tag: `table-${id}` });
      }
      return json({ id }, 201);
    }

    // POST /houses/:slug/me { name } → change your own name
    if (action === "me") {
      me.name = cleanName(input.name, me.name);
      await save(house);
      return json(await forMember(house, me));
    }

    if (!canManage) return json({ error: "Only the house owner or an admin can change that." }, 403);

    // POST /houses/:slug/presets { preset, makeDefault? } → add or replace house rules
    if (action === "presets" && gameOf(input.game) === "palace") {
      const rules = cleanPalace(input.preset);
      if (typeof rules === "string") return json({ error: rules }, 400);
      const list = house.palacePresets!;
      const at = list.findIndex((p) => p.id === rules.id);
      if (at >= 0) list[at] = rules;
      else list.push(rules);
      if (input.makeDefault) house.palaceDefault = rules.id;
      await save(house);
      return json(await forMember(house, me));
    }
    if (action === "presets") {
      const preset = cleanPreset(input.preset);
      if (typeof preset === "string") return json({ error: preset }, 400);
      const at = house.presets.findIndex((p) => p.id === preset.id);
      if (at >= 0) house.presets[at] = preset;
      else house.presets.push(preset);
      if (input.makeDefault) house.defaultPreset = preset.id;
      await save(house);
      return json(await forMember(house, me));
    }

    // POST /houses/:slug/presets/delete { id }
    if (action === "presets-delete" && gameOf(input.game) === "palace") {
      if (house.palacePresets!.length <= 1) return json({ error: "A house needs at least one set of rules." }, 409);
      house.palacePresets = house.palacePresets!.filter((p) => p.id !== input.id);
      if (house.palaceDefault === input.id) house.palaceDefault = house.palacePresets[0]!.id;
      await save(house);
      return json(await forMember(house, me));
    }
    if (action === "presets-delete") {
      if (house.presets.length <= 1) return json({ error: "A house needs at least one set of rules." }, 409);
      house.presets = house.presets.filter((p) => p.id !== input.id);
      if (house.defaultPreset === input.id) house.defaultPreset = house.presets[0]!.id;
      await save(house);
      return json(await forMember(house, me));
    }

    // POST /houses/:slug/default { id }
    if (action === "default" && gameOf(input.game) === "palace") {
      if (!house.palacePresets!.some((p) => p.id === input.id)) return json({ error: "No such rules." }, 404);
      house.palaceDefault = String(input.id);
      await save(house);
      return json(await forMember(house, me));
    }
    if (action === "default") {
      if (!house.presets.some((p) => p.id === input.id)) return json({ error: "No such rules." }, 404);
      house.defaultPreset = String(input.id);
      await save(house);
      return json(await forMember(house, me));
    }

    // POST /houses/:slug/role { member, role } (owner only; there is always exactly one owner)
    if (action === "role") {
      if (me.role !== "owner") return json({ error: "Only the house owner can change roles." }, 403);
      const target = house.members.find((m) => m.id === input.member);
      if (!target || target.role === "owner") return json({ error: "No such member." }, 404);
      if (input.role !== "admin" && input.role !== "member") return json({ error: "A role is admin or member." }, 400);
      target.role = input.role;
      await save(house);
      return json(await forMember(house, me));
    }

    // POST /houses/:slug/remove { member } (owner, or an admin removing a member)
    if (action === "remove") {
      const target = house.members.find((m) => m.id === input.member);
      if (!target || target.role === "owner" || (target.role === "admin" && me.role !== "owner")) return json({ error: "You can't remove them." }, 403);
      house.members = house.members.filter((m) => m !== target);
      await save(house);
      return json(await forMember(house, me));
    }

    // POST /houses/:slug/new-link → a new invite code; the old link stops working
    if (action === "new-link") {
      house.code = random(6);
      await save(house);
      return json(await forMember(house, me));
    }

    return json({ error: "Not found" }, 404);
  }

  return {
    /** Answers house requests; null for anything else. */
    async fetch(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url);
      if (pathname !== mount && !pathname.startsWith(`${mount}/`)) return null;
      const rest = pathname.slice(mount.length).replace("/presets/delete", "/presets-delete");
      return handle(request, rest);
    },
  };
}
