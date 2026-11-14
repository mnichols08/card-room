import { describe, expect, it } from "vitest";
import { classicCuckoo, cuckoo, drinkingCuckoo, newCuckoo, type CuckooState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const at = (cards: string[], rules = classicCuckoo, extra: Partial<CuckooState> = {}): CuckooState =>
  ({ ...newCuckoo(rules, cards.length, 1), cards: cards.map(card), dealer: cards.length - 1, turn: 0, ...extra }) as CuckooState;

describe("Cuckoo", () => {
  it("deals one card each", () => {
    const s = newCuckoo(classicCuckoo, 5, 3);
    expect(s.cards.every(Boolean)).toBe(true);
    expect(s.lives).toEqual([3, 3, 3, 3, 3]);
  });

  it("swap with the left, unless they hold a king; the dealer cuts; the lowest loses a life", () => {
    let s = at(["2♠", "9♥", "K♣", "5♦"]);
    s = cuckoo.apply(s, 0, { type: "swap" });
    expect(s.cards.map((c) => c!.id)).toEqual(["9♥", "2♠", "K♣", "5♦"]);
    s = cuckoo.apply(s, 1, { type: "swap" });
    expect(s.cards[1]!.id).toBe("2♠");
    expect(s.narration).toContain("king");
    s = cuckoo.apply(s, 2, { type: "keep" });
    expect(() => cuckoo.apply(s, 3, { type: "swap" })).toThrow("cut");
    s = cuckoo.apply(s, 3, { type: "keep" });
    expect(s.phase).toBe("shown");
    expect(s.lives).toEqual([3, 2, 3, 3]);
  });

  it("aces are low; drinking mode: the lowest drinks", () => {
    let s = at(["A♠", "9♥", "K♣"], drinkingCuckoo);
    s = cuckoo.apply(s, 0, { type: "keep" });
    s = cuckoo.apply(s, 1, { type: "keep" });
    s = cuckoo.apply(s, 2, { type: "keep" });
    expect(s.lives[0]).toBe(2);
    expect(s.narration).toContain("drinks 2");
  });

  it("last one standing wins", () => {
    let s = at(["3♠", "9♥"], classicCuckoo, { lives: [1, 1], dealer: 1 });
    s = cuckoo.apply(s, 0, { type: "keep" });
    s = cuckoo.apply(s, 1, { type: "keep" });
    expect(s.phase).toBe("finished");
    expect(cuckoo.view(s, 0).over?.winners).toEqual([1]);
  });
});
