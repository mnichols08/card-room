import type { RulePreset } from "@spades/rules";

export interface HouseTable {
  id: string;
  rules: string;
  created: number;
  seats: { name: string | null; bot: boolean }[];
  started: boolean;
  summary: { phase: string; hand: number; scores: { points: number }[]; winner: number | null } | null;
}

export interface House {
  slug: string;
  name: string;
  code: string;
  me: { id: string; name: string; role: "owner" | "admin" | "member" };
  members: { id: string; name: string; role: "owner" | "admin" | "member" }[];
  presets: RulePreset[];
  defaultPreset: string;
  tables: HouseTable[];
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
  openTable: (slug: string, presetId?: string) => call<{ id: string }>(at(slug, "tables"), { presetId }),
  rename: (slug: string, name: string) => call<House>(at(slug, "me"), { name }),
  savePreset: (slug: string, preset: RulePreset, makeDefault = false) => call<House>(at(slug, "presets"), { preset, makeDefault }),
  deletePreset: (slug: string, id: string) => call<House>(at(slug, "presets/delete"), { id }),
  makeDefault: (slug: string, id: string) => call<House>(at(slug, "default"), { id }),
  setRole: (slug: string, member: string, role: "admin" | "member") => call<House>(at(slug, "role"), { member, role }),
  remove: (slug: string, member: string) => call<House>(at(slug, "remove"), { member }),
  newLink: (slug: string) => call<House>(at(slug, "new-link"), {}),
};

export const inviteLink = (house: Pick<House, "slug" | "code">) =>
  `${location.origin}${location.pathname}?house=${encodeURIComponent(house.slug)}&code=${encodeURIComponent(house.code)}`;
