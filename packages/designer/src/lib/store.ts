// Where designs are kept. With a card room server behind the page, they're saved there (yours
// under your player cookie; shared ones in the gallery for everyone). Without one (the GitHub Pages
// copy of the card room), they stay in this browser and there's no gallery to share to.
import { normalizeDesign, validateDesign, type CardDesign } from "@cardroom/decks";

export interface SavedDesign {
  id: string;
  author: string;
  design: CardDesign;
  shared: boolean;
  created: number;
  updated: number;
  mine: boolean;
  /** Why the card room's host took it out of the gallery. */
  hidden?: string;
}

export class StoreError extends Error {}

/** The designs endpoints sit beside the app: /designer/ → /designs. */
const BASE = new URL("../designs", document.baseURI).href;
const LOCAL_KEY = "cardroom.designer.decks";
const AUTHOR_KEY = "cardroom.designer.author";

/** Null until the first request tells us whether there's a server. */
let server: boolean | null = null;

async function send<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(BASE + path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
  } catch {
    throw new StoreError("Couldn't reach the card room. Check your connection and try again.");
  }
  const answer = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !answer) throw new StoreError(answer?.error ?? "The card room couldn't do that. Try again.");
  return answer;
}

/** Whether a card room server is behind this page. Asked once. */
export async function hasServer(): Promise<boolean> {
  if (server !== null) return server;
  try {
    const response = await fetch(BASE, { credentials: "same-origin" });
    const answer = (await response.json().catch(() => null)) as { designs?: unknown } | null;
    server = response.ok && Array.isArray(answer?.designs);
  } catch {
    server = false;
  }
  return server;
}

function readLocal(): SavedDesign[] {
  try {
    const list = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]") as SavedDesign[];
    return Array.isArray(list) ? list.map((d) => ({ ...d, design: normalizeDesign(d.design), shared: false, mine: true })) : [];
  } catch {
    return [];
  }
}
function writeLocal(list: SavedDesign[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    throw new StoreError("This browser wouldn't keep the deck (private browsing, or its storage is full).");
  }
}

export async function gallery(): Promise<SavedDesign[]> {
  if (!(await hasServer())) return [];
  return (await send<{ designs: SavedDesign[] }>("")).designs;
}

export async function mine(): Promise<SavedDesign[]> {
  if (!(await hasServer())) return readLocal();
  return (await send<{ designs: SavedDesign[] }>("/mine")).designs;
}

/** Save a new design, or changes to one of yours (`id`). */
export async function save(design: CardDesign, author: string, shared: boolean, id?: string | null): Promise<SavedDesign> {
  const clean = normalizeDesign(design);
  const problems = validateDesign(clean);
  if (problems.length) throw new StoreError(problems[0]!);
  rememberAuthor(author);
  if (await hasServer()) return send<SavedDesign>(id ? `/${id}` : "", { design: clean, author, shared });
  const list = readLocal();
  const now = Date.now();
  const existing = list.find((d) => d.id === id);
  const saved: SavedDesign = existing
    ? { ...existing, design: clean, author, updated: now }
    : { id: `local-${now.toString(36)}`, author: author || "Me", design: clean, shared: false, created: now, updated: now, mine: true };
  writeLocal(existing ? list.map((d) => (d.id === saved.id ? saved : d)) : [saved, ...list]);
  return saved;
}

export async function share(id: string, shared: boolean): Promise<SavedDesign> {
  return send<SavedDesign>(`/${id}`, { shared });
}

export async function remove(id: string): Promise<void> {
  if (await hasServer()) return void (await send(`/${id}/delete`, {}));
  writeLocal(readLocal().filter((d) => d.id !== id));
}

/** The name you last signed a deck with. */
export function rememberedAuthor(): string {
  try {
    // Someone who's played here already has a name: the one they sit down with.
    return localStorage.getItem(AUTHOR_KEY) ?? String(JSON.parse(localStorage.getItem("spades:name") ?? '""') ?? "");
  } catch {
    return "";
  }
}
function rememberAuthor(author: string): void {
  try {
    if (author) localStorage.setItem(AUTHOR_KEY, author);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}
