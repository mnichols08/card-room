// How you hold your cards: grouped by suit or run by rank, high or low first, or in an order you
// dragged them into. It's only how this device shows your hand; the game never hears about it.

/** "game": the order the game deals them in (its own idea of a tidy hand). */
export type SortGroup = "game" | "suit" | "rank";
export type SortDir = "high" | "low";
export interface HandSort {
  group: SortGroup;
  dir: SortDir;
}

/** Where a card stands: its suit's place in the hand (♠ ♥ ♣ ♦) and how high it is. */
export interface SortKey {
  suit: number;
  rank: number;
}

type AnyCard =
  | { kind: "pip"; suit: string; rank: number }
  | { kind: "joker"; size: "big" | "little" }
  | { kind: "fruit"; fruit: string | null; face: number | string };

const SUIT_PLACE: Record<string, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };
const FRUIT_PLACE: Record<string, number> = { cherry: 0, lemon: 1, pear: 2, grape: 3 };
const FRUIT_FACE: Record<string, number> = { hop: 10, turn: 11, plus2: 12, salad: 13, salad4: 14 };

/** A plain reading of any card: jokers lead the suits and top the ranks; wild fruit goes last. */
export function cardKey(card: AnyCard): SortKey {
  if (card.kind === "joker") return { suit: -1, rank: card.size === "big" ? 100 : 99 };
  if (card.kind === "fruit") return { suit: card.fruit ? (FRUIT_PLACE[card.fruit] ?? 4) : 5, rank: typeof card.face === "number" ? card.face : (FRUIT_FACE[card.face] ?? 15) };
  return { suit: SUIT_PLACE[card.suit] ?? 4, rank: card.rank };
}

/** The hand in the chosen order. Cards that tie keep the order they came in. */
export function orderHand<C>(cards: readonly C[], keyOf: (card: C) => SortKey, sort: HandSort): C[] {
  if (sort.group === "game") return [...cards];
  const up = sort.dir === "low" ? 1 : -1;
  return cards
    .map((card) => ({ card, key: keyOf(card) }))
    .sort((a, b) => (sort.group === "suit" ? a.key.suit - b.key.suit || up * (a.key.rank - b.key.rank) : up * (a.key.rank - b.key.rank) || a.key.suit - b.key.suit))
    .map((x) => x.card);
}

/** Your own order, kept up: cards you've played drop out, and new ones join at the right-hand end. */
export function keepOrder(custom: readonly string[], now: readonly string[]): string[] {
  const held = new Set(now);
  const known = new Set(custom);
  return [...custom.filter((k) => held.has(k)), ...now.filter((k) => !known.has(k))];
}

/** Take the card at `from` out and put it in at `to`. */
export function moveCard<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  const [card] = out.splice(from, 1);
  out.splice(to, 0, card!);
  return out;
}

/** A name for each card that's unique in the hand, even with two decks ("7♥", "7♥#1"). */
export function uniqueKeys(ids: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n ? `${id}#${n}` : id;
  });
}

// ---- Remembered on this device, per game --------------------------------------------------------

const key = (game: string) => `cardroom:handSort:${game}`;

export function loadHandSort(game: string, fallback: HandSort, groups: readonly SortGroup[]): HandSort {
  try {
    const saved = JSON.parse(localStorage.getItem(key(game)) ?? "null") as Partial<HandSort> | null;
    return {
      group: saved?.group && groups.includes(saved.group) ? saved.group : fallback.group,
      dir: saved?.dir === "low" || saved?.dir === "high" ? saved.dir : fallback.dir,
    };
  } catch {
    return fallback;
  }
}

export function saveHandSort(game: string, sort: HandSort) {
  try {
    localStorage.setItem(key(game), JSON.stringify(sort));
  } catch {
    /* private mode: it still holds for this game */
  }
}
