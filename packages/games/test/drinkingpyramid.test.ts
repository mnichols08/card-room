import { describe, expect, it } from "vitest";
import { classicDPyramid, drinkingPyramid, honestDPyramid, newDPyramid, type DPyramidState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => ids.split(" ").map(card);
const at = (rules = classicDPyramid): DPyramidState => {
  let s = { ...newDPyramid(rules, 2, 1), dealer: 0, hands: [cards("9♥ 2♠ 3♠ 4♠"), cards("5♦ 6♦ 7♦ 8♦")], cards: cards("9♣ 5♠ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦") } as DPyramidState;
  s = drinkingPyramid.apply(s, 0, { type: "ready" });
  return drinkingPyramid.apply(s, 1, { type: "ready" });
};

describe("Drinking Pyramid", () => {
  it("memorize, then the cards go face down", () => {
    const s = newDPyramid(classicDPyramid, 2, 1);
    expect(drinkingPyramid.view(s, 0).hand).toHaveLength(4);
    expect(drinkingPyramid.view(at(), 0).hand).toHaveLength(0);
  });

  it("a true claim stands when called; the caller drinks double", () => {
    let s = at();
    s = drinkingPyramid.apply(s, 0, { type: "flip" });
    s = drinkingPyramid.apply(s, 0, { type: "claim", yes: true });
    s = drinkingPyramid.apply(s, 1, { type: "claim", yes: false });
    s = drinkingPyramid.apply(s, 0, { type: "give", to: 1 });
    s = drinkingPyramid.apply(s, 1, { type: "call" });
    expect(s.tally.drank).toEqual([0, 2]);
    expect(s.phase).toBe("flip");
  });

  it("a bluff caught drinks double; taking it drinks the row's worth", () => {
    let s = at();
    s = drinkingPyramid.apply(s, 0, { type: "flip" });
    s = drinkingPyramid.apply(s, 0, { type: "claim", yes: false });
    s = drinkingPyramid.apply(s, 1, { type: "claim", yes: false });
    s = drinkingPyramid.apply(s, 0, { type: "flip" }); // 5♠: seat 1 has a 5
    s = drinkingPyramid.apply(s, 0, { type: "claim", yes: true });
    s = drinkingPyramid.apply(s, 1, { type: "claim", yes: true });
    s = drinkingPyramid.apply(s, 0, { type: "give", to: 1 });
    s = drinkingPyramid.apply(s, 1, { type: "call" });
    expect(s.tally.drank).toEqual([2, 0]);
    s = drinkingPyramid.apply(s, 1, { type: "give", to: 0 });
    s = drinkingPyramid.apply(s, 0, { type: "drink" });
    expect(s.tally.drank).toEqual([3, 0]);
  });

  it("no bluffing: you can only claim what you hold", () => {
    let s = at(honestDPyramid);
    s = drinkingPyramid.apply(s, 0, { type: "flip" });
    expect(() => drinkingPyramid.apply(s, 1, { type: "claim", yes: true })).toThrow("No bluffing");
  });
});
