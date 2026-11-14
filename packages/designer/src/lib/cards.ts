/** A card to show a deck with: what <playing-card> draws, without the game pieces the designer never deals. */
export type SampleCard = { kind: "pip"; suit: "spades" | "hearts" | "diamonds" | "clubs"; rank: number } | { kind: "joker"; size: "big" | "little" };
