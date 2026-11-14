import { describe, expect, it } from "vitest";
import { classicThirtyOne, newThirtyOne, plainThirtyOne, score31, thirtyOne, type KCard, type ThirtyOneState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const hand = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const at = (extra: Partial<ThirtyOneState>, rules = classicThirtyOne): ThirtyOneState =>
  ({ ...newThirtyOne(rules, 3, 1), turn: 0, phase: "draw", knocker: null, taken: null, ...extra }) as ThirtyOneState;

describe("Thirty-One", () => {
  it("scores the best suit, aces 11 and faces 10, trips 30½", () => {
    expect(score31(hand("A♥ K♥ 10♥"))).toBe(31);
    expect(score31(hand("A♥ K♠ 9♠"))).toBe(19);
    expect(score31(hand("7♥ 7♠ 7♦"))).toBe(30.5);
    expect(score31(hand("7♥ 7♠ 7♦"), false)).toBe(7);
  });

  it("deals three each and turns one card up", () => {
    const s = newThirtyOne(classicThirtyOne, 4, 3);
    expect(s.hands.every((h) => h.length === 3)).toBe(true);
    expect(s.discard).toHaveLength(1);
    expect(s.stock).toHaveLength(52 - 13);
  });

  it("take the discard, but don't throw it straight back", () => {
    let s = at({ hands: [hand("2♥ 5♠ 9♦"), hand("3♣ 4♣ 6♣"), hand("8♥ 8♠ 2♦")], discard: [card("K♦")], stock: hand("3♥ 4♥") });
    s = thirtyOne.apply(s, 0, { type: "take" });
    expect(s.phase).toBe("discard");
    expect(() => thirtyOne.apply(s, 0, { type: "discard", card: "K♦" })).toThrow("just took");
    s = thirtyOne.apply(s, 0, { type: "discard", card: "5♠" });
    expect(s.turn).toBe(1);
    expect(s.discard.at(-1)!.id).toBe("5♠");
  });

  it("knock: one more turn each, then the lowest loses a life", () => {
    let s = at({ hands: [hand("A♥ K♥ 2♠"), hand("3♣ 4♣ 6♣"), hand("10♠ J♠ 2♦")], discard: [card("2♣")], stock: hand("3♥ 4♥ 5♥ 7♦") });
    s = thirtyOne.apply(s, 0, { type: "knock" });
    expect(s.knocker).toBe(0);
    expect(() => thirtyOne.apply(s, 1, { type: "knock" })).toThrow("already");
    s = thirtyOne.apply(s, 1, { type: "draw" });
    s = thirtyOne.apply(s, 1, { type: "discard", card: "7♦" });
    s = thirtyOne.apply(s, 2, { type: "draw" });
    s = thirtyOne.apply(s, 2, { type: "discard", card: "2♦" });
    expect(s.phase).toBe("reveal");
    expect(s.lives).toEqual([3, 2, 3]); // 13 loses to 21 and 20
  });

  it("a knocker who ends lowest pays two lives (if the house says so)", () => {
    const base = { hands: [hand("2♥ 3♥ 4♠"), hand("A♣ K♣ 6♦"), hand("10♠ J♠ 2♦")], discard: [card("2♣")], stock: hand("3♦ 4♦ 5♦ 7♦") };
    const play = (rules = classicThirtyOne) => {
      let s = at(base, rules);
      s = thirtyOne.apply(s, 0, { type: "knock" });
      s = thirtyOne.apply(s, 1, { type: "draw" });
      s = thirtyOne.apply(s, 1, { type: "discard", card: "7♦" });
      s = thirtyOne.apply(s, 2, { type: "draw" });
      return thirtyOne.apply(s, 2, { type: "discard", card: "5♦" });
    };
    expect(play().lives).toEqual([1, 3, 3]);
    expect(play(plainThirtyOne).lives).toEqual([2, 3, 3]);
  });

  it("31 ends the round at once: everyone else loses a life", () => {
    let s = at({ hands: [hand("A♥ K♥ 2♠"), hand("3♣ 4♣ 6♣"), hand("10♠ J♠ 2♦")], discard: [card("Q♥")], stock: hand("3♥") });
    s = thirtyOne.apply(s, 0, { type: "take" });
    s = thirtyOne.apply(s, 0, { type: "discard", card: "2♠" });
    expect(s.phase).toBe("reveal");
    expect(s.lives).toEqual([3, 2, 2]);
  });

  it("the last one with lives wins", () => {
    let s = at({ lives: [1, 1, 0], hands: [hand("A♥ K♥ 2♠"), hand("3♣ 4♣ 6♣"), []], discard: [card("Q♥")], stock: hand("3♥") });
    s = thirtyOne.apply(s, 0, { type: "take" });
    s = thirtyOne.apply(s, 0, { type: "discard", card: "2♠" });
    expect(s.phase).toBe("finished");
    expect(thirtyOne.view(s, 1).over?.winners).toEqual([0]);
  });
});
