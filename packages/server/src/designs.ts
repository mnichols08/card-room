// Card designs: decks people draw in the designer. A design is saved for its maker alone ("just for
// fun") or shared, which puts it in the gallery for everyone to play with. A maker is the same
// player cookie that holds a seat at a table.
//
//   designs/<id>   server only: the design, its maker's player id, shared or not
//
// A design is data (colours and choices from fixed lists; see @cardroom/decks), checked here again
// whatever the page sent, so nothing in the gallery can carry markup or CSS of its maker's own.
import { STARTERS, cleanName, normalizeDesign, validateDesign, type CardDesign, type TableDeck } from "@cardroom/decks";
import { newPlayerId, playerCookie, playerOf } from "@spades/rooms/server";

export interface DesignDoc {
  id: string;
  /** The maker's secret cookie value. Never sent to anyone. */
  owner: string;
  /** The name the maker signed it with. */
  author: string;
  design: CardDesign;
  /** In the gallery for everyone, or the maker's alone. */
  shared: boolean;
  created: number;
  updated: number;
  /** The maker deleted it. */
  deleted?: boolean;
  /** Why a moderator took it out of the gallery. Its maker still sees it, with the reason. */
  hidden?: string;
}

interface Sync {
  write(collection: string, key: string, fields: Record<string, unknown>): Promise<unknown>;
  documents(): Promise<{
    get(collection: string, key: string): Record<string, unknown> | undefined;
    all(collection: string, prefix?: string): Array<{ key: string } & Record<string, unknown>>;
  }>;
}

/** The parts of the rooms kit a table's deck needs. */
interface Tables {
  room(id: string): Promise<{ started: boolean; closed?: string } | undefined>;
  holders(id: string): Promise<(string | null)[]>;
  setDeck(id: string, deck: unknown): Promise<void>;
}

const LETTERS = "abcdefghjkmnpqrstuvwxyz23456789";
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => LETTERS[b % LETTERS.length]).join("");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** How many designs one person may keep, how many the gallery shows, and how often one person may save a new one. */
export const DESIGNS_PER_PLAYER = 40;
export const GALLERY_SIZE = 120;
const CREATE_GAP_MS = 1500;

export function createDesigns(sync: Sync, { mount = "/designs", tables, now = () => Date.now() }: { mount?: string; /** The card room's tables, so a table can wear a design. */ tables?: Tables; now?: () => number } = {}) {
  const docs = sync.documents();
  const lastMade = new Map<string, number>();

  const get = async (id: string) => (await docs).get("designs", id) as unknown as DesignDoc | undefined;
  /** Every design that hasn't been deleted, newest first. */
  async function all(): Promise<DesignDoc[]> {
    return ((await docs).all("designs") as unknown as DesignDoc[]).filter((d) => d.id && !d.deleted).sort((a, b) => b.created - a.created);
  }
  const save = (doc: DesignDoc) => sync.write("designs", doc.id, doc as unknown as Record<string, unknown>);

  /** What a page gets: never the maker's player id. A maker also learns why theirs was hidden. */
  const shown = (doc: DesignDoc, player: string | null) => {
    const mine = player !== null && doc.owner === player;
    return {
      id: doc.id,
      author: doc.author,
      design: doc.design,
      shared: doc.shared,
      created: doc.created,
      updated: doc.updated,
      mine,
      ...(mine && doc.hidden ? { hidden: doc.hidden } : {}),
    };
  };

  /** A design from a page: checked, or the reasons it can't be played with. */
  function checked(given: unknown): CardDesign | string[] {
    if (!given || typeof given !== "object") return ["That design is missing."];
    const design = normalizeDesign(given);
    const problems = validateDesign(design);
    return problems.length ? problems : design;
  }

  async function handle(request: Request, path: string): Promise<Response> {
    const parts = path.split("/").filter(Boolean);
    const method = request.method;
    const player = playerOf(request);
    const input = method === "POST" ? (((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>) : {};

    // GET /designs → the gallery: shared designs, newest first
    if (parts.length === 0 && method === "GET") {
      const gallery = (await all()).filter((d) => d.shared && !d.hidden).slice(0, GALLERY_SIZE);
      return json({ designs: gallery.map((d) => shown(d, player)) });
    }

    // POST /designs { design, author?, shared? } → a new design, yours
    if (parts.length === 0 && method === "POST") {
      const design = checked(input.design);
      if (Array.isArray(design)) return json({ error: design[0], problems: design }, 400);
      const me = player ?? newPlayerId();
      const mine = (await all()).filter((d) => d.owner === me);
      if (mine.length >= DESIGNS_PER_PLAYER) return json({ error: `You can keep ${DESIGNS_PER_PLAYER} designs. Delete one to make room.` }, 409);
      if (now() - (lastMade.get(me) ?? 0) < CREATE_GAP_MS) return json({ error: "Slow down a little." }, 429);
      lastMade.set(me, now());
      let id = random(8);
      while (await get(id)) id = random(8);
      const doc: DesignDoc = { id, owner: me, author: cleanName(input.author, "Someone"), design, shared: input.shared === true, created: now(), updated: now() };
      await save(doc);
      return json(shown(doc, me), 201, player ? {} : { "set-cookie": playerCookie(me, request) });
    }

    // POST /designs/table/:table { design: id | "starter:<name>" | null } → the deck everyone at that table sees
    if (parts.length === 2 && parts[0] === "table" && method === "POST" && tables) {
      const table = parts[1]!;
      const room = await tables.room(table);
      if (!room) return json({ error: "There's no table with that code." }, 404);
      if (!player || !(await tables.holders(table)).includes(player)) return json({ error: "Take a seat first: the players choose the table's cards." }, 403);
      if (room.closed) return json({ error: room.closed }, 410);
      if (room.started) return json({ error: "The cards are set once the game starts." }, 409);
      const wanted = input.design;
      if (wanted === undefined || wanted === "") return json({ error: "Pick a deck." }, 400);
      if (wanted === null) {
        await tables.setDeck(table, null);
        return json({ deck: null });
      }
      let deck: TableDeck | undefined;
      const starter = STARTERS.find((s) => wanted === `starter:${s.name}`);
      if (starter) deck = { id: `starter:${starter.name}`, author: "Card Room", design: starter };
      else {
        const design = typeof wanted === "string" ? await get(wanted) : undefined;
        // Yours, or one in the gallery: a table never shows everyone a deck its maker kept private.
        const usable = design && !design.deleted && (design.owner === player || (design.shared && !design.hidden));
        if (usable) deck = { id: design.id, author: design.author, design: design.design };
      }
      if (!deck) return json({ error: "That deck isn't in the gallery any more. Pick another." }, 404);
      // The table keeps its own copy: changing, deleting or hiding the design later doesn't change
      // the cards in the middle of someone's game.
      await tables.setDeck(table, deck);
      return json({ deck });
    }

    // GET /designs/mine → everything you've saved, shared or not
    if (parts.length === 1 && parts[0] === "mine" && method === "GET") {
      const mine = player ? (await all()).filter((d) => d.owner === player) : [];
      return json({ designs: mine.map((d) => shown(d, player)) });
    }

    const doc = parts[0] ? await get(parts[0]) : undefined;
    const action = parts[1] ?? "";
    const mine = !!doc && player !== null && doc.owner === player;
    // A private design, or one a moderator hid, exists only for its maker.
    if (!doc || doc.deleted || (!mine && (!doc.shared || doc.hidden))) return json({ error: "There's no design at that link." }, 404);

    // GET /designs/:id → one design
    if (action === "" && method === "GET") return json(shown(doc, player));
    if (method !== "POST") return json({ error: "Not found" }, 404);
    if (!mine) return json({ error: "Only its maker can change a design." }, 403);

    // POST /designs/:id { design?, author?, shared? } → change yours
    if (action === "") {
      const design = input.design === undefined ? doc.design : checked(input.design);
      if (Array.isArray(design)) return json({ error: design[0], problems: design }, 400);
      const next: DesignDoc = {
        ...doc,
        design,
        author: input.author === undefined ? doc.author : cleanName(input.author, "Someone"),
        shared: typeof input.shared === "boolean" ? input.shared : doc.shared,
        updated: now(),
      };
      await save(next);
      return json(shown(next, player));
    }
    // POST /designs/:id/delete → gone, from the gallery too
    if (action === "delete") {
      await sync.write("designs", doc.id, { deleted: true, shared: false, updated: now() });
      return json({ ok: true });
    }
    return json({ error: "Not found" }, 404);
  }

  return {
    /** Every design that hasn't been deleted, for server code (moderation). Holds player ids: never send these to a page as they are. */
    all,
    /** Take a design out of the gallery, with a reason its maker sees (moderation). */
    async hide(id: string, reason: string): Promise<boolean> {
      const doc = await get(id);
      if (!doc || doc.deleted) return false;
      await sync.write("designs", id, { hidden: reason.replace(/\s+/g, " ").trim().slice(0, 200) || "A moderator took this out of the gallery." });
      return true;
    },
    /** Put a hidden design back. */
    async restore(id: string): Promise<boolean> {
      const doc = await get(id);
      if (!doc || doc.deleted) return false;
      // The log keeps each field's latest value: an empty reason is "not hidden".
      await sync.write("designs", id, { hidden: "" });
      return true;
    },
    /** Answers /designs requests; null for anything else. */
    async fetch(request: Request): Promise<Response | null> {
      const { pathname } = new URL(request.url);
      if (pathname !== mount && !pathname.startsWith(`${mount}/`)) return null;
      return handle(request, pathname.slice(mount.length));
    },
  };
}

export type Designs = ReturnType<typeof createDesigns>;
