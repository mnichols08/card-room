// The card room's catalogue: which games its host offers, and in what order (set in the admin app).
// The last answer is kept in this browser, so the front page is right from its first paint; a card
// room with no server (the GitHub Pages copy) offers every game in the built-in order.
const KEY = "cardroom.catalogue";

interface Catalogue {
  /** Game ids in the host's order, with the ones switched off left out. */
  on: string[];
}

function cached(): Catalogue | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Catalogue | null;
    return saved && Array.isArray(saved.on) ? saved : null;
  } catch {
    return null;
  }
}

/** Ask the server for the catalogue and remember it. Resolves to whether it changed. */
export async function refreshCatalogue(): Promise<boolean> {
  try {
    const response = await fetch("/catalogue");
    const body = (await response.json()) as { games?: { id: string; on: boolean }[] };
    if (!response.ok || !Array.isArray(body.games)) return false;
    const next = JSON.stringify({ on: body.games.filter((g) => g.on).map((g) => g.id) } satisfies Catalogue);
    const changed = next !== localStorage.getItem(KEY);
    localStorage.setItem(KEY, next);
    return changed;
  } catch {
    return false; // no server here, or no storage: every game, in the built-in order
  }
}

/** A list of games as the host arranged it: theirs in their order, without the ones switched off. */
export function arranged<T extends { id: string }>(games: T[]): T[] {
  const catalogue = cached();
  if (!catalogue) return games;
  const place = new Map(catalogue.on.map((id, i) => [id, i]));
  return games.filter((g) => place.has(g.id)).sort((a, b) => place.get(a.id)! - place.get(b.id)!);
}
