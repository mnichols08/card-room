import type { PalaceRules } from "@cardroom/palace";
import type { RulePreset, TableSettings } from "@spades/rules";
import type { GameId } from "./storage";

export interface HouseTable {
  id: string;
  game: GameId;
  tournament: string | null;
  rules: string;
  created: number;
  seats: { name: string | null; bot: boolean }[];
  started: boolean;
  summary: { phase: string; hand?: number; scores?: { points: number }[]; winner?: number | null; finished?: number[]; loser?: number | null; left?: number[] } | null;
}

export interface House {
  slug: string;
  name: string;
  code: string;
  me: { id: string; name: string; role: "owner" | "admin" | "member" };
  members: { id: string; name: string; role: "owner" | "admin" | "member" }[];
  presets: RulePreset[];
  defaultPreset: string;
  palacePresets: PalaceRules[];
  palaceDefault: string;
  tables: HouseTable[];
  tournaments: TournamentBrief[];
  /** House rules for the kit games (Hearts, Euchre…), by game. */
  kitRules: Record<string, { presets: KitRules[]; default: string }>;
  /** The house's AI connection for bot talk: its settings for an owner or admin, on or off for a member, null when there's none. */
  ai: HouseAiSettings | { on: boolean } | null;
  /** The card room has an AI account of its own (set by whoever runs it) that houses may use. */
  aiServer: boolean;
}

export type AiProvider = "anthropic" | "openai";
/** The same list as the server's (packages/server/src/ai.ts). */
export const AI_PROVIDERS: { id: AiProvider; name: string; model: string }[] = [
  { id: "anthropic", name: "Claude (Anthropic)", model: "claude-haiku-5-5" },
  { id: "openai", name: "OpenAI", model: "gpt-5.6-luna" },
];
export interface HouseAiSettings {
  /** "server": the card room's own account; no key of the house's. */
  provider: AiProvider | "server";
  model: string;
  context: string;
  on: boolean;
  /** The last four characters of the saved key: all of it that ever comes back. */
  keyEnding: string;
}

export type KitRules = { id: string; name: string } & Record<string, unknown>;

export type TournamentStatus = "signup" | "playing" | "finished";

export interface TournamentBrief {
  id: string;
  name: string;
  game: GameId;
  status: TournamentStatus;
  entrants: number;
  champion: string | null;
  round: string | null;
}

/** One side of a match: an entrant's index, a bye, or not known yet. */
export type Side = number | "bye" | null;

export interface Tournament {
  id: string;
  name: string;
  game: GameId;
  rules: string;
  status: TournamentStatus;
  champion: number | null;
  created: number;
  by: string;
  /** Your entry's index, if you're playing. */
  mine: number | null;
  entrants: { id: string; name: string; players: ({ bot: true; name: string } | { bot: false; id: string; name: string })[] }[];
  rounds: {
    name: string;
    matches: { a: Side; b: Side; table: string | null; winner: 0 | 1 | null; how: "played" | "bye" | "called" | null; playing: boolean; score: string | null }[];
  }[];
}

export interface Standings {
  games: number;
  players: { id: string; name: string; played: number; won: number; winPct: number | null; nil: { bid: number; made: number }; blindNil: { bid: number; made: number } }[];
  partners: { ids: [string, string]; names: [string, string]; played: number; won: number }[];
  highlights: {
    biggestComeback: { names: string[]; behindBy: number; final: [number, number]; game: string } | null;
    mostNils: { name: string; made: number } | null;
  };
}

export interface PalaceStandings {
  game: GameId;
  teams?: boolean;
  games: number;
  players: { id: string; name: string; played: number; won: number; last: number; winPct: number | null; avgPlace: number | null }[];
}

export class HouseError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new HouseError(data.error ?? `Request failed (${response.status})`, response.status);
  return data;
}

const at = (slug: string, action = "") => `/houses/${encodeURIComponent(slug)}${action ? `/${action}` : ""}`;

export const houses = {
  create: (name: string, you: string, rules?: RulePreset) => call<House>("/houses", { name, you, rules }),
  /** The house for a member; with an invite code, just its name for someone who hasn't joined. */
  get: (slug: string, code?: string | null) =>
    call<House | { slug: string; name: string; member: false }>(code ? `${at(slug)}?code=${encodeURIComponent(code)}` : at(slug)),
  /** Someone holding the invite link: the house's name, before they join. */
  preview: (slug: string, code: string) => call<{ slug: string; name: string; member: false }>(`${at(slug)}?code=${encodeURIComponent(code)}`),
  join: (slug: string, code: string, name: string) => call<House>(at(slug, "join"), { code, name }),
  leaderboard: (slug: string) => call<Standings>(at(slug, "leaderboard")),
  palaceLeaderboard: (slug: string) => call<PalaceStandings>(`${at(slug, "leaderboard")}?game=palace`),
  /** Standings by finishing place, for Palace and the kit games. */
  placesLeaderboard: (slug: string, game: GameId) => call<PalaceStandings>(`${at(slug, "leaderboard")}?game=${encodeURIComponent(game)}`),
  saveKit: (slug: string, game: GameId, preset: KitRules, makeDefault = false) => call<House>(at(slug, "presets"), { game, preset, makeDefault }),
  deleteKit: (slug: string, game: GameId, id: string) => call<House>(at(slug, "presets/delete"), { game, id }),
  defaultKit: (slug: string, game: GameId, id: string) => call<House>(at(slug, "default"), { game, id }),
  openTable: (slug: string, presetId?: string, game: GameId = "spades", seats?: number, settings?: TableSettings) => call<{ id: string }>(at(slug, "tables"), { presetId, game, seats, settings }),
  rename: (slug: string, name: string) => call<House>(at(slug, "me"), { name }),
  savePreset: (slug: string, preset: RulePreset, makeDefault = false) => call<House>(at(slug, "presets"), { preset, makeDefault }),
  deletePreset: (slug: string, id: string) => call<House>(at(slug, "presets/delete"), { id }),
  makeDefault: (slug: string, id: string) => call<House>(at(slug, "default"), { id }),
  savePalace: (slug: string, preset: PalaceRules, makeDefault = false) => call<House>(at(slug, "presets"), { game: "palace", preset, makeDefault }),
  deletePalace: (slug: string, id: string) => call<House>(at(slug, "presets/delete"), { game: "palace", id }),
  setRole: (slug: string, member: string, role: "admin" | "member") => call<House>(at(slug, "role"), { member, role }),
  remove: (slug: string, member: string) => call<House>(at(slug, "remove"), { member }),
  newLink: (slug: string) => call<House>(at(slug, "new-link"), {}),
  /** Connect or change the house's AI (the key and model are tried before they're saved), or { disconnect: true }. */
  saveAi: (slug: string, change: { provider?: AiProvider | "server"; key?: string; model?: string; context?: string; on?: boolean; disconnect?: boolean }) => call<House>(at(slug, "ai"), change),
  testAi: (slug: string) => call<{ line: string }>(at(slug, "ai-test"), {}),
  tournament: (slug: string, id: string) => call<Tournament>(at(slug, `tournaments/${encodeURIComponent(id)}`)),
  newTournament: (slug: string, name: string, game: GameId, presetId: string, settings: TableSettings) => call<Tournament>(at(slug, "tournaments"), { name, game, presetId, settings }),
  /** enter { partner? } · leave · add { players } · remove { entrant } · start · call { round, match, winner } · cancel */
  tournamentAction: (slug: string, id: string, action: string, body: Record<string, unknown> = {}) =>
    call<Tournament>(at(slug, `tournaments/${encodeURIComponent(id)}/${action}`), body),
};

export const inviteLink = (house: Pick<House, "slug" | "code">) =>
  `${location.origin}${location.pathname}?house=${encodeURIComponent(house.slug)}&code=${encodeURIComponent(house.code)}`;
