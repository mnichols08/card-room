import { describe, expect, it } from "vitest";
import { buildDeck, cardId, deal, effectiveSuit, isTrump, pip, shuffle } from "../src/cards.js";
import { classic, jokersAndDeuces } from "../src/presets.js";

describe("deck", () => {
  it("classic has 52 unique cards", () => {
    const deck = buildDeck(classic);
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(cardId)).size).toBe(52);
  });

  it("jokers & deuces swaps 2♣ and 2♥ for the jokers", () => {
    const ids = buildDeck(jokersAndDeuces).map(cardId);
    expect(ids).toHaveLength(52);
    expect(ids).toContain("BJ");
    expect(ids).toContain("LJ");
    expect(ids).not.toContain("2♣");
    expect(ids).not.toContain("2♥");
  });

  it("2♦ and jokers are trump only in jokers & deuces", () => {
    expect(isTrump(pip("diamonds", 2), classic)).toBe(false);
    expect(isTrump(pip("diamonds", 2), jokersAndDeuces)).toBe(true);
    expect(effectiveSuit(pip("diamonds", 2), jokersAndDeuces)).toBe("spades");
    expect(isTrump({ kind: "joker", size: "little" }, jokersAndDeuces)).toBe(true);
  });
});

describe("shuffle and deal", () => {
  it("is reproducible from a seed", () => {
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 42)).toEqual(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 42));
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 42)).not.toEqual(shuffle([1, 2, 3, 4, 5, 6, 7, 8], 43));
  });

  it("deals 13 cards to each seat with no duplicates", () => {
    const hands = deal(classic, 7, 0);
    expect(hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(new Set(hands.flat().map(cardId)).size).toBe(52);
  });
});
