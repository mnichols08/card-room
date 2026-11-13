import type { PalaceRules } from "@cardroom/palace";
import type { RulePreset } from "@spades/rules";
import type { GameId } from "./storage";

export interface OfferedGame {
  id: GameId;
  name: string;
  rules: string;
}

export interface MyLink {
  code: string | null;
  name?: string;
  enabled?: boolean;
  rules?: string;
  games?: OfferedGame[];
  notifications: boolean;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `Request failed (${r.status})`);
  return data;
}

export const challenges = {
  mine: () => call<MyLink>("/challenges/mine"),
  update: (change: { name?: string; rules?: RulePreset; palaceRules?: PalaceRules; kitRules?: Record<string, unknown>; games?: GameId[]; enabled?: boolean; newLink?: boolean }) => call<MyLink>("/challenges/mine", change),
  get: (code: string) => call<{ name: string; enabled: boolean; rules: string; games?: OfferedGame[] }>(`/challenges/${encodeURIComponent(code)}`),
  send: (code: string, name: string, message: string, game?: GameId) => call<{ id: string; game?: GameId; notified: boolean }>(`/challenges/${encodeURIComponent(code)}`, { name, message, game }),
};

export const challengeUrl = (code: string) => new URL(`${import.meta.env.BASE_URL}?challenge=${code}`, location.origin).href;
