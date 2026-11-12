import type { Card, Rank, RulePreset, Seat, Suit } from "./types.js";

export const SUITS: readonly Suit[] = ["spades", "hearts", "diamonds", "clubs"];
export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function pip(suit: Suit, rank: Rank): Card {
  return { kind: "pip", suit, rank };
}

const SUIT_SYMBOL: Record<Suit, string> = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
const RANK_LABEL: Record<number, string> = { 11: "J", 12: "Q", 13: "K", 14: "A" };

/** Stable short id, e.g. "A♠", "10♥", "BJ", "LJ". */
export function cardId(card: Card): string {
  if (card.kind === "joker") return card.size === "big" ? "BJ" : "LJ";
  return `${RANK_LABEL[card.rank] ?? card.rank}${SUIT_SYMBOL[card.suit]}`;
}

export function sameCard(a: Card, b: Card): boolean {
  return cardId(a) === cardId(b);
}

/** 52 cards for the preset. Jokers & deuces swaps 2♣ and 2♥ for the two jokers. */
export function buildDeck(preset: RulePreset): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push(pip(suit, rank));
  if (preset.trump === "jokers-and-deuces") {
    const without = deck.filter(
      (c) => !(c.kind === "pip" && c.rank === 2 && (c.suit === "clubs" || c.suit === "hearts")),
    );
    return [...without, { kind: "joker", size: "big" }, { kind: "joker", size: "little" }];
  }
  return deck;
}

export function isTrump(card: Card, preset: RulePreset): boolean {
  if (card.kind === "joker") return true;
  if (card.suit === "spades") return true;
  return preset.trump === "jokers-and-deuces" && card.suit === "diamonds" && card.rank === 2;
}

/** The suit a card counts as for following suit. Jokers and 2♦ count as spades when they're trump. */
export function effectiveSuit(card: Card, preset: RulePreset): Suit {
  if (isTrump(card, preset)) return "spades";
  return (card as Extract<Card, { kind: "pip" }>).suit;
}

/** Higher beats lower within the same effective suit. */
export function cardPower(card: Card, preset: RulePreset): number {
  if (card.kind === "joker") return card.size === "big" ? 100 : 99;
  if (preset.trump === "jokers-and-deuces" && card.rank === 2) {
    if (card.suit === "diamonds") return 98;
    if (card.suit === "spades") return 97;
  }
  return card.rank;
}

/** Small, fast, seedable PRNG so games can be replayed from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const out = [...items];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Deal 13 cards to each seat, starting left of the dealer. */
export function deal(preset: RulePreset, seed: number, dealer: Seat): Card[][] {
  const deck = shuffle(buildDeck(preset), seed);
  const hands: Card[][] = [[], [], [], []];
  deck.forEach((card, i) => hands[(dealer + 1 + i) % 4]!.push(card));
  return hands.map((h) => sortHand(h, preset));
}

const SUIT_ORDER: Record<Suit, number> = { spades: 0, hearts: 1, clubs: 2, diamonds: 3 };

export function sortHand(hand: Card[], preset: RulePreset): Card[] {
  return [...hand].sort((a, b) => {
    const sa = SUIT_ORDER[effectiveSuit(a, preset)];
    const sb = SUIT_ORDER[effectiveSuit(b, preset)];
    return sa !== sb ? sa - sb : cardPower(b, preset) - cardPower(a, preset);
  });
}
