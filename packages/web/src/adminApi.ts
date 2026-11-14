// The card room's admin: sign in with the server's key, block players, see who's blocked.
export interface BlockedPlayer {
  id: string;
  name: string;
  at: number;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "Couldn't reach the card room. Try again in a minute.");
  return data;
}

type Me = { enabled: boolean; admin: boolean };
let asked: Promise<boolean> | null = null;

export const admin = {
  me: () => call<Me>("/admin/me"),
  /** Whether this device is an admin: asked once, then remembered until it signs in or out. */
  amI: () => (asked ??= call<Me>("/admin/me").then((me) => me.admin, () => false)),
  signIn: (key: string) => ((asked = null), call<Me>("/admin/signin", { key })),
  signOut: () => ((asked = null), call<Me>("/admin/signout", {})),
  blocked: async () => (await call<{ blocked: BlockedPlayer[] }>("/admin/blocked")).blocked,
  /** Block whoever holds that seat from the whole card room, and take them out of it. */
  block: (table: string, seat: number) => call<{ ok: true; id: string; name: string }>("/admin/block", { table, seat }),
  unblock: (id: string) => call<{ ok: true }>("/admin/unblock", { id }),
};
