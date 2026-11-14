import { describe, expect, it } from "vitest";
import { isPair, memory, newMemory, smallMemory, type KCard, type MemoryState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const at = (cells: string[], seats = 2): MemoryState => ({ ...newMemory(smallMemory, seats, 1), cells: cells.map(card) }) as MemoryState;

describe("Memory", () => {
  it("lays out pairs: same number, same colour", () => {
    const s = newMemory(smallMemory, 2, 3);
    expect(s.cells).toHaveLength(24);
    for (const c of s.cells) expect(s.cells.filter((d) => d && isPair(c!, d)).length).toBe(2);
    expect(isPair(card("7♥"), card("7♦"))).toBe(true);
    expect(isPair(card("7♥"), card("7♠"))).toBe(false);
  });

  it("a pair is yours and you go again; a miss stays showing until the next card", () => {
    let s = at(["7♥", "7♦", "K♠", "2♣"]);
    s = memory.apply(s, 0, { type: "flip", index: 0 });
    s = memory.apply(s, 0, { type: "flip", index: 1 });
    expect(s.pairs).toEqual([1, 0]);
    expect(s.turn).toBe(0);
    s = memory.apply(s, 0, { type: "flip", index: 2 });
    s = memory.apply(s, 0, { type: "flip", index: 3 });
    expect(s.turn).toBe(1);
    const cards = (memory.view(s, 1).center as { cards: (KCard | null)[] }).cards;
    expect(cards[2]?.id).toBe("K♠");
    s = memory.apply(s, 1, { type: "flip", index: 3 });
    expect((memory.view(s, 1).center as { cards: (KCard | null)[] }).cards[2]).toBeNull();
    expect(() => memory.apply(s, 1, { type: "flip", index: 3 })).toThrow("already");
    expect(() => memory.apply(s, 1, { type: "flip", index: 0 })).toThrow("no card");
  });

  it("the last pair ends it; most pairs wins", () => {
    let s = at(["7♥", "7♦"]);
    s = memory.apply(s, 0, { type: "flip", index: 1 });
    s = memory.apply(s, 0, { type: "flip", index: 0 });
    expect(s.phase).toBe("finished");
    expect(memory.view(s, 1).over?.winners).toEqual([0]);
  });
});
