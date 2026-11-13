import type { RulePreset } from "@spades/rules";

export interface MyLink {
  code: string | null;
  name?: string;
  enabled?: boolean;
  rules?: string;
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
  update: (change: { name?: string; rules?: RulePreset; enabled?: boolean; newLink?: boolean }) => call<MyLink>("/challenges/mine", change),
  get: (code: string) => call<{ name: string; enabled: boolean; rules: string }>(`/challenges/${encodeURIComponent(code)}`),
  send: (code: string, name: string, message: string) => call<{ id: string; notified: boolean }>(`/challenges/${encodeURIComponent(code)}`, { name, message }),
};

export const challengeUrl = (code: string) => new URL(`${import.meta.env.BASE_URL}?challenge=${code}`, location.origin).href;
