// Tournaments: a house runs a single-elimination bracket, of spades (fixed teams of two) or Palace
// (one against one). Members sign up during signup; an owner or admin can add or remove entrants,
// fill a gap with the computer, then start the bracket. Each match gets its own table with the
// players already seated, and they get a push to come and play, whenever suits them. When a table
// finishes, its winner moves on; the last one standing is the champion.
//
//   tournaments/<id>       server only: the whole tournament
//   tournamentOf/<table>   server only: which tournament a table belongs to
import type { PalaceRules } from "@cardroom/palace";
import { cleanSettings, mulberry32, pickPersonas, type RulePreset, type TableSettings } from "@spades/rules";
import type { RoomDoc } from "@spades/rooms/server";
import { gameName, type GameId, type TableOptions } from "./games.js";
import { palaceOptions } from "./palace.js";
import type { Push } from "./push.js";

/** A seat in an entrant: a house member (by their public id), or a computer player (by its name). */
export type Player = { member: string } | { bot: string };

export interface Entrant {
  id: string;
  name: string;
  players: Player[];
}

/** One side of a match: an entrant (by index), a bye, or not known yet. */
export type Side = number | "bye" | null;

export interface Match {
  a: Side;
  b: Side;
  table: string | null;
  /** 0 when side a won, 1 when side b won. */
  winner: 0 | 1 | null;
  /** How it was decided: at the table, a bye, or called by the organizer. */
  how: "played" | "bye" | "called" | null;
}

export type Status = "signup" | "playing" | "finished" | "cancelled";

export interface Tournament {
  id: string;
  house: string;
  name: string;
  game: GameId;
  rules: RulePreset | PalaceRules;
  settings: TableSettings;
  status: Status;
  entrants: Entrant[];
  /** Round 1 first; the last round has one match, the final. */
  rounds: Match[][];
  champion: number | null;
  /** The member who made it. */
  by: string;
  created: number;
}

/** What tournaments need from a house: who's in it, and a place to list tables. */
export interface HouseLike {
  slug: string;
  name: string;
  members: { id: string; player: string; name: string; role: string }[];
  tables: { id: string; game?: GameId; rules: string; created: number; tournament?: string }[];
  tournaments?: string[];
}

interface Rooms {
  sync: {
    write(collection: string, key: string, fields: Record<string, unknown>): Promise<unknown>;
    documents(): Promise<{ get(collection: string, key: string): Record<string, unknown> | undefined }>;
  };
  create(options: TableOptions, settings?: unknown): Promise<string>;
  room(id: string): Promise<RoomDoc<unknown> | undefined>;
  seatPlayer(id: string, seat: number, player: string, name: string): Promise<void>;
  seatBot(id: string, seat: number, name: string): Promise<void>;
  start(id: string): Promise<string | null>;
  lock(id: string, label?: string): Promise<void>;
}

const LETTERS = "abcdefghjkmnpqrstuvwxyz23456789";
const random = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => LETTERS[b % LETTERS.length]).join("");

/** How many players make one entrant. */
export const teamSize = (game: GameId) => (game === "spades" ? 2 : 1);

/**
 * The first round for these many entrants, shuffled with this random function: every entrant
 * appears once, the bracket is the next power of two, and the byes are spread so no match is two
 * byes. Later rounds start empty and fill in as matches are won.
 */
export function bracket(count: number, rand: () => number = Math.random): Match[][] {
  if (count < 2) throw new Error("A bracket needs at least two entrants.");
  let size = 2;
  while (size < count) size *= 2;
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const byes = size - count;
  const first: Match[] = [];
  let next = 0;
  for (let m = 0; m < size / 2; m++) {
    // The first `byes` matches give one entrant a free pass.
    const a = order[next++]!;
    const b: Side = m < byes ? "bye" : order[next++]!;
    first.push({ a, b, table: null, winner: null, how: null });
  }
  const rounds = [first];
  for (let n = size / 4; n >= 1; n /= 2) rounds.push(Array.from({ length: n }, () => ({ a: null, b: null, table: null, winner: null, how: null })));
  return rounds;
}

/** The entrant who won a match, or null. */
export const winnerOf = (m: Match): Side => (m.winner === null ? null : m.winner === 0 ? m.a : m.b);

/**
 * Move every decided winner on: byes are won at once, a winner fills their slot in the next round,
 * and the final's winner is the champion. Returns the matches that are ready for a table now.
 */
export function settle(t: Tournament): Match[] {
  const ready: Match[] = [];
  for (let r = 0; r < t.rounds.length; r++) {
    t.rounds[r]!.forEach((m, i) => {
      if (m.winner === null && m.a !== null && m.b !== null) {
        if (m.b === "bye") Object.assign(m, { winner: 0, how: "bye" });
        else if (m.a === "bye") Object.assign(m, { winner: 1, how: "bye" });
      }
      const won = winnerOf(m);
      if (won === null) {
        if (typeof m.a === "number" && typeof m.b === "number" && !m.table) ready.push(m);
        return;
      }
      const next = t.rounds[r + 1]?.[Math.floor(i / 2)];
      if (next) {
        if (i % 2 === 0) next.a = won;
        else next.b = won;
      } else if (typeof won === "number") {
        t.champion = won;
        t.status = "finished";
      }
    });
  }
  return ready;
}

/** Which side won a finished table: spades by team (seats 0 and 2 are side a), Palace by first out. */
export function sideThatWon(game: GameId, summary: unknown): 0 | 1 | null {
  const s = summary as { phase?: string; winner?: number | null; finished?: number[] } | null;
  if (s?.phase !== "finished") return null;
  if (game === "palace") {
    const first = s.finished?.[0];
    return first === 0 ? 0 : first === 1 ? 1 : null;
  }
  return s.winner === 0 ? 0 : s.winner === 1 ? 1 : null;
}

export function createTournaments(rooms: Rooms, { push, saveHouse }: { push?: Push; saveHouse: (house: HouseLike) => Promise<unknown> }) {
  const docs = rooms.sync.documents();

  async function get(id: string): Promise<Tournament | undefined> {
    const doc = (await docs).get("tournaments", id) as unknown as Tournament | undefined;
    if (!doc?.id) return undefined;
    const { id: i, house, name, game, rules, settings, status, entrants, rounds, champion, by, created } = doc;
    return structuredClone({ id: i, house, name, game, rules, settings, status, entrants, rounds, champion, by, created });
  }
  const save = (t: Tournament) => rooms.sync.write("tournaments", t.id, { ...t });

  const memberOf = (house: HouseLike, id: string) => house.members.find((m) => m.id === id);
  const playerName = (house: HouseLike, p: Player) => ("bot" in p ? p.bot : (memberOf(house, p.member)?.name ?? "Someone"));
  const entrantName = (house: HouseLike, players: Player[]) => players.map((p) => playerName(house, p)).join(" & ");
  const entered = (t: Tournament, member: string) => t.entrants.some((e) => e.players.some((p) => "member" in p && p.member === member));
  const sideName = (t: Tournament, side: Side) => (typeof side === "number" ? (t.entrants[side]?.name ?? "?") : side === "bye" ? "a bye" : "to be decided");

  /** Computer players with names not already in this tournament. */
  function computers(t: Tournament, n: number): { bot: string }[] {
    const taken = t.entrants.flatMap((e) => e.players.flatMap((p): string[] => ("bot" in p ? [p.bot] : [])));
    return pickPersonas(n, mulberry32((Date.now() ^ t.entrants.length * 7919) >>> 0), taken).map((p) => ({ bot: p.name }));
  }

  /** Players from a page: member ids or "computer", checked against the house and the tournament. */
  function playersFrom(house: HouseLike, t: Tournament, given: unknown): Player[] | string {
    if (!Array.isArray(given) || given.length !== teamSize(t.game)) return t.game === "spades" ? "A spades team is two players." : "Pick one player.";
    const out: Player[] = [];
    for (const g of given) {
      if (g === "computer") out.push(...computers({ ...t, entrants: [...t.entrants, { id: "", name: "", players: out }] }, 1));
      else {
        const m = memberOf(house, String(g));
        if (!m) return "They aren't in the house.";
        if (entered(t, m.id) || out.some((p) => "member" in p && p.member === m.id)) return `${m.name} is already playing.`;
        out.push({ member: m.id });
      }
    }
    if (out.every((p) => "bot" in p) && t.game === "spades") return "A team needs at least one person. Use \"Add the computer\" for an all-computer team.";
    return out;
  }

  /** Give a ready match its table: everyone seated, the players told. */
  async function openTable(house: HouseLike, t: Tournament, m: Match) {
    const a = t.entrants[m.a as number]!;
    const b = t.entrants[m.b as number]!;
    // Spades: partners sit across (seats 0 and 2 against 1 and 3). Palace: one against one.
    const seats = t.game === "spades" ? [a.players[0]!, b.players[0]!, a.players[1]!, b.players[1]!] : [a.players[0]!, b.players[0]!];
    const people = seats.filter((p): p is { member: string } => "member" in p);
    const options = t.game === "palace" ? palaceOptions(t.rules as PalaceRules, 2) : (t.rules as RulePreset);
    // A match with nobody to watch it plays itself out quickly.
    const id = await rooms.create(options, people.length ? t.settings : { ...t.settings, pace: "fast" });
    for (const [i, p] of seats.entries()) {
      if ("bot" in p) await rooms.seatBot(id, i, p.bot);
      else {
        const member = memberOf(house, p.member);
        // Someone who has left the house: the computer sits in for them.
        if (member) await rooms.seatPlayer(id, i, member.player, member.name);
        else await rooms.seatBot(id, i, computers(t, 1)[0]!.bot);
      }
    }
    m.table = id;
    const label = `${t.name} · ${roundName(t, t.rounds.findIndex((r) => r.includes(m)))}`;
    await rooms.lock(id, label);
    await rooms.sync.write("tournamentOf", id, { tournament: t.id, house: house.slug });
    house.tables.push({ id, game: t.game, rules: label, created: Date.now(), tournament: t.id });
    if (!people.length) await rooms.start(id);
    const emoji = t.game === "palace" ? "🏰" : "♠️";
    for (const p of people) {
      const member = memberOf(house, p.member);
      if (!member) continue;
      const mine = a.players.some((x) => "member" in x && x.member === member.id);
      const [us, them] = mine ? [a, b] : [b, a];
      void push?.notify(member.player, {
        title: `Your ${t.name} match is ready ${emoji}`,
        body: `${us.name} vs ${them.name}. Tap to sit down and play when you can.`,
        url: `/?table=${id}&house=${house.slug}`,
        tag: `match-${id}`,
      });
    }
  }

  /** Settle the bracket, open tables for every match that's ready, and tell the house of a champion. */
  async function advance(house: HouseLike, t: Tournament) {
    const wasFinished = t.status === "finished";
    for (let pass = 0; pass < 8; pass++) {
      const ready = settle(t);
      if (!ready.length) break;
      for (const m of ready) await openTable(house, t, m);
    }
    await save(t);
    await saveHouse(house);
    if (!wasFinished && t.status === "finished" && t.champion !== null) {
      const champ = t.entrants[t.champion]!;
      for (const m of house.members)
        void push?.notify(m.player, { title: `🏆 ${champ.name} won ${t.name}!`, body: `The ${gameName(t.game)} tournament at ${house.name} is over.`, url: `/?house=${house.slug}&tournament=${t.id}`, tag: `tournament-${t.id}` });
    }
  }

  /** Check tables that finished while nobody was looking (a restart, say). */
  async function catchUp(house: HouseLike, t: Tournament) {
    if (t.status !== "playing") return;
    let changed = false;
    for (const round of t.rounds)
      for (const m of round) {
        if (m.winner !== null || !m.table) continue;
        const won = sideThatWon(t.game, (await rooms.room(m.table))?.summary);
        if (won !== null) Object.assign(m, { winner: won, how: "played" }), (changed = true);
      }
    if (changed) await advance(house, t);
  }

  /** What a member sees: names, not secrets; each match's table, and whether it's theirs. */
  async function view(house: HouseLike, t: Tournament, me: string) {
    const tables = new Map<string, unknown>();
    for (const round of t.rounds) for (const m of round) if (m.table) tables.set(m.table, (await rooms.room(m.table))?.summary ?? null);
    const mineIdx = t.entrants.findIndex((e) => e.players.some((p) => "member" in p && p.member === me));
    return {
      id: t.id,
      name: t.name,
      game: t.game,
      rules: t.rules.name,
      status: t.status,
      champion: t.champion,
      created: t.created,
      by: memberOf(house, t.by)?.name ?? "Someone",
      mine: mineIdx >= 0 ? mineIdx : null,
      entrants: t.entrants.map((e) => ({ id: e.id, name: e.name, players: e.players.map((p) => ("bot" in p ? { bot: true, name: p.bot } : { bot: false, id: p.member, name: playerName(house, p) })) })),
      rounds: t.rounds.map((round, r) => ({
        name: roundName(t, r),
        matches: round.map((m) => {
          const summary = m.table ? tables.get(m.table) : null;
          return { a: m.a, b: m.b, table: m.table, winner: m.winner, how: m.how, playing: !!summary && (summary as { phase?: string }).phase !== "finished", score: scoreOf(t.game, summary) };
        }),
      })),
    };
  }

  /** A short line for the list on the house page. */
  const brief = (house: HouseLike, t: Tournament) => ({
    id: t.id,
    name: t.name,
    game: t.game,
    status: t.status,
    entrants: t.entrants.length,
    champion: t.champion === null ? null : (t.entrants[t.champion]?.name ?? null),
    round: t.status === "playing" ? roundName(t, t.rounds.findIndex((r) => r.some((m) => m.winner === null))) : null,
  });

  async function list(house: HouseLike) {
    const out = [];
    for (const id of [...(house.tournaments ?? [])].reverse()) {
      const t = await get(id);
      if (!t || t.status === "cancelled") continue;
      await catchUp(house, t);
      out.push(brief(house, t));
    }
    return out;
  }

  /** A table finished: if it was a tournament match, its winner moves on. */
  async function tableFinished(tableId: string, summary: unknown, houseOf: (slug: string) => Promise<HouseLike | undefined>) {
    const link = (await docs).get("tournamentOf", tableId) as { tournament?: string; house?: string } | undefined;
    if (!link?.tournament || !link.house) return;
    const t = await get(link.tournament);
    const house = await houseOf(link.house);
    if (!t || !house || t.status !== "playing") return;
    const m = t.rounds.flat().find((x) => x.table === tableId);
    const won = sideThatWon(t.game, summary);
    if (!m || m.winner !== null || won === null) return;
    Object.assign(m, { winner: won, how: "played" });
    await advance(house, t);
  }

  type Me = { id: string; role: string };
  type Reply = { status: number; body: unknown };
  const ok = (body: unknown, status = 200): Reply => ({ status, body });
  const no = (error: string, status = 400): Reply => ({ status, body: { error } });

  /**
   * /houses/:slug/tournaments[/:id[/:action]] for a member. `rules` finds the house rules by id for
   * a new tournament. Changes to the house (its list, its tables) are saved here.
   */
  async function handle(
    house: HouseLike,
    me: Me,
    parts: string[],
    method: string,
    input: Record<string, unknown>,
    rules: (game: GameId, id: unknown) => RulePreset | PalaceRules,
  ): Promise<Reply> {
    const canManage = me.role === "owner" || me.role === "admin";
    const [id, action = ""] = parts;

    if (!id) {
      if (method === "GET") return ok(await list(house));
      // POST /houses/:slug/tournaments { name, game, presetId, settings }
      if (!canManage) return no("Only the house owner or an admin can start a tournament.", 403);
      const game: GameId = input.game === "palace" ? "palace" : "spades";
      const chosen = rules(game, input.presetId);
      const t: Tournament = {
        id: random(8),
        house: house.slug,
        name: String(input.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40) || `${house.name} ${gameName(game)} Cup`,
        game,
        rules: structuredClone(chosen),
        settings: cleanSettings(input.settings),
        status: "signup",
        entrants: [],
        rounds: [],
        champion: null,
        by: me.id,
        created: Date.now(),
      };
      await save(t);
      house.tournaments = [...(house.tournaments ?? []), t.id];
      await saveHouse(house);
      for (const m of house.members)
        if (m.id !== me.id)
          void push?.notify(m.player, { title: `Sign up for ${t.name} ${game === "palace" ? "🏰" : "♠️"}`, body: `A ${gameName(game)} tournament at ${house.name}. Tap to sign up.`, url: `/?house=${house.slug}&tournament=${t.id}`, tag: `tournament-${t.id}` });
      return ok(await view(house, t, me.id), 201);
    }

    const t = (house.tournaments ?? []).includes(id) ? await get(id) : undefined;
    if (!t || t.status === "cancelled") return no("There's no such tournament.", 404);
    if (method === "GET" && !action) {
      await catchUp(house, t);
      return ok(await view(house, t, me.id));
    }
    if (method !== "POST") return no("Not found", 404);

    const done = async () => ok(await view(house, t, me.id));
    const signup = t.status === "signup";

    // POST …/enter { partner? }: sign yourself up (spades: with a partner, a member or "computer")
    if (action === "enter") {
      if (!signup) return no("Signup is over.", 409);
      const players = playersFrom(house, t, t.game === "spades" ? [me.id, input.partner ?? "computer"] : [me.id]);
      if (typeof players === "string") return no(players, 409);
      t.entrants.push({ id: random(6), name: entrantName(house, players), players });
      await save(t);
      return done();
    }
    // POST …/leave: take your entry (and your team's) out
    if (action === "leave") {
      if (!signup) return no("The bracket has started. Ask the organizer to call your match.", 409);
      t.entrants = t.entrants.filter((e) => !e.players.some((p) => "member" in p && p.member === me.id));
      await save(t);
      return done();
    }

    if (!canManage) return no("Only the house owner or an admin can change that.", 403);

    // POST …/add { players: (memberId | "computer")[] }: add an entrant; all "computer" for a computer entrant
    if (action === "add") {
      if (!signup) return no("Signup is over.", 409);
      const given = Array.isArray(input.players) ? input.players : [];
      const players = given.length && given.every((g) => g === "computer") ? computers(t, teamSize(t.game)) : playersFrom(house, t, given);
      if (typeof players === "string") return no(players, 409);
      if (players.length !== teamSize(t.game)) return no("Pick who's playing.");
      t.entrants.push({ id: random(6), name: entrantName(house, players), players });
      await save(t);
      return done();
    }
    // POST …/remove { entrant }
    if (action === "remove") {
      if (!signup) return no("The bracket has started. Call their match instead.", 409);
      t.entrants = t.entrants.filter((e) => e.id !== input.entrant);
      await save(t);
      return done();
    }
    // POST …/start: draw the bracket and open the first tables
    if (action === "start") {
      if (!signup) return no("It's already started.", 409);
      if (t.entrants.length < 2) return no("A tournament needs at least two entrants.", 409);
      if (t.entrants.length > 32) return no("That's more than 32 entrants.", 409);
      t.rounds = bracket(t.entrants.length);
      t.status = "playing";
      await advance(house, t);
      return done();
    }
    // POST …/call { round, match, winner: 0 | 1 }: decide a match that won't be played
    if (action === "call") {
      const m = t.rounds[Number(input.round)]?.[Number(input.match)];
      if (t.status !== "playing" || !m || m.winner !== null || typeof m.a !== "number" || typeof m.b !== "number") return no("That match can't be called.", 409);
      if (input.winner !== 0 && input.winner !== 1) return no("Pick who goes through.");
      Object.assign(m, { winner: input.winner, how: "called" });
      await advance(house, t);
      return done();
    }
    // POST …/cancel
    if (action === "cancel") {
      if (t.status === "finished") return no("It's already over.", 409);
      t.status = "cancelled";
      await save(t);
      return ok({ cancelled: true });
    }
    return no("Not found", 404);
  }

  return { handle, list, tableFinished, get };
}

/** "Final", "Semifinals", "Quarterfinals", else "Round 1"… */
export function roundName(t: Pick<Tournament, "rounds">, r: number): string {
  const fromEnd = t.rounds.length - 1 - r;
  if (r < 0) return "";
  if (fromEnd === 0) return "Final";
  if (fromEnd === 1) return "Semifinals";
  if (fromEnd === 2) return "Quarterfinals";
  return `Round ${r + 1}`;
}

/** A finished or running table's score, as a short line. */
function scoreOf(game: GameId, summary: unknown): string | null {
  const s = summary as { phase?: string; hand?: number; scores?: { points: number }[]; left?: number[] } | null;
  if (!s) return null;
  if (game === "palace") return s.left ? `${s.left[0]} cards to ${s.left[1]}` : null;
  if (!s.scores) return null;
  return `${s.scores[0]?.points ?? 0} to ${s.scores[1]?.points ?? 0}`;
}
