import { describe, expect, it } from "vitest";
import { classicOldMaid, drawsFrom, jokerOldMaid, newOldMaid, oldMaid, type KCard, type OldMaidState } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  if (id === "JK") return { kind: "joker", size: "big", id: `JK#${n++}` } as KCard;
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const hand = (ids: string) => (ids ? ids.split(" ").map(card) : []);

function table(hands: string[], over: Partial<OldMaidState> = {}): OldMaidState {
  const s = newOldMaid(classicOldMaid, hands.length, 1);
  return { ...s, hands: hands.map(hand), pairs: hands.map(() => 0), out: [], turn: 0, phase: "drawing", last: null, ...over };
}

describe("Old Maid", () => {
  it("deals 51 cards (no Q♣), and every hand starts with its pairs put down", () => {
    for (let seed = 1; seed < 20; seed++) {
      const s = newOldMaid(classicOldMaid, 4, seed);
      const all = s.hands.flat();
      expect(all.length + s.pairs.reduce((a, b) => a + b, 0) * 2).toBe(51);
      expect(all.some((c) => c.kind === "pip" && c.rank === 12 && c.suit === "clubs")).toBe(false);
      // No pairs left in any hand (the Q♠ never pairs: her partner is out of the deck).
      for (const h of s.hands) {
        const rest = h.filter((c) => !(c.kind === "pip" && c.rank === 12 && c.suit === "spades"));
        expect(new Set(rest.map((c) => (c.kind === "pip" ? c.rank : 0))).size).toBe(rest.length);
      }
    }
    const joker = newOldMaid(jokerOldMaid, 3, 5);
    expect(joker.hands.flat().filter((c) => c.kind === "joker")).toHaveLength(1);
  });

  it("you take from the next player still holding cards; a pair goes down", () => {
    const s = table(["7♠ 9♦", "", "7♥"]);
    expect(drawsFrom(s, 0)).toBe(2);
    const after = oldMaid.apply(s, 0, { type: "take", index: 0 });
    expect(after.hands[0]!.map((c) => c.id.split("#")[0])).toEqual(["9♦"]);
    expect(after.pairs[0]).toBe(1);
    expect(after.out).toContain(2);
  });

  it("only you see the card you took; the others see that you took one", () => {
    const s = table(["9♦", "Q♠ 5♣", "5♥ K♦"]);
    const after = oldMaid.apply(s, 0, { type: "take", index: 0 });
    const took = after.last!.card;
    expect(oldMaid.view(after, 0).narration).toContain(took.kind === "pip" && took.rank === 12 ? "Old Maid" : "You took");
    expect(oldMaid.view(after, 2).narration).toBe("{0} took a card from {1}");
  });

  it("the last one holding the Old Maid loses; everyone else wins", () => {
    const s = table(["Q♠ 9♦", "9♥", ""], { out: [2] });
    // Seat 0 takes seat 1's last card: a pair. Seat 1 is out; seat 0 holds only the Old Maid.
    const after = oldMaid.apply(s, 0, { type: "take", index: 0 });
    expect(after.phase).toBe("finished");
    expect(oldMaid.view(after, 1).over).toEqual({ winners: [1, 2], title: "{0} is left holding the Old Maid!" });
    expect(oldMaid.summary(after).order).toEqual([2, 1, 0]);
  });

  it("refuses a card that isn't there, or a turn that isn't yours", () => {
    const s = table(["9♦", "9♥ 5♣", "K♦"]);
    expect(() => oldMaid.apply(s, 0, { type: "take", index: 5 })).toThrow("Pick one");
    expect(() => oldMaid.apply(s, 1, { type: "take", index: 0 })).toThrow("not your turn");
  });
});
