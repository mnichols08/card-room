import { describe, expect, it } from "vitest";
import { cardId, pip } from "../src/cards.js";
import { classic, derivePreset, jokersAndDeuces } from "../src/presets.js";
import { legalPlays, trickWinner, type Play } from "../src/tricks.js";

const ids = (cards: Parameters<typeof cardId>[0][]) => cards.map(cardId).sort();

describe("legalPlays", () => {
  const hand = [pip("spades", 14), pip("hearts", 5), pip("clubs", 9)];

  it("can't lead spades before they're broken", () => {
    expect(ids(legalPlays(hand, [], false, classic))).toEqual(["5♥", "9♣"]);
  });

  it("can lead spades once broken, or when only spades are left", () => {
    expect(legalPlays(hand, [], true, classic)).toHaveLength(3);
    expect(ids(legalPlays([pip("spades", 3)], [], false, classic))).toEqual(["3♠"]);
  });

  it("can lead spades any time if the preset allows it", () => {
    const open = derivePreset(classic, "open", "Open", { spadesMustBeBroken: false });
    expect(legalPlays(hand, [], false, open)).toHaveLength(3);
  });

  it("must follow suit when possible", () => {
    const trick: Play[] = [{ seat: 0, card: pip("hearts", 10) }];
    expect(ids(legalPlays(hand, trick, false, classic))).toEqual(["5♥"]);
  });

  it("can play anything when void in the led suit", () => {
    const trick: Play[] = [{ seat: 0, card: pip("diamonds", 10) }];
    expect(legalPlays(hand, trick, false, classic)).toHaveLength(3);
  });

  it("in jokers & deuces, 2♦ follows spades, not diamonds", () => {
    const h = [pip("diamonds", 2), pip("diamonds", 9)];
    const diamondLed: Play[] = [{ seat: 0, card: pip("diamonds", 4) }];
    const spadeLed: Play[] = [{ seat: 0, card: pip("spades", 4) }];
    expect(ids(legalPlays(h, diamondLed, true, jokersAndDeuces))).toEqual(["9♦"]);
    expect(ids(legalPlays(h, spadeLed, true, jokersAndDeuces))).toEqual(["2♦"]);
  });
});

describe("trickWinner", () => {
  it("highest of the led suit wins without trump", () => {
    const trick: Play[] = [
      { seat: 0, card: pip("hearts", 10) },
      { seat: 1, card: pip("hearts", 13) },
      { seat: 2, card: pip("clubs", 14) },
      { seat: 3, card: pip("hearts", 2) },
    ];
    expect(trickWinner(trick, classic)).toBe(1);
  });

  it("any spade beats the led suit; highest spade wins", () => {
    const trick: Play[] = [
      { seat: 0, card: pip("hearts", 14) },
      { seat: 1, card: pip("spades", 2) },
      { seat: 2, card: pip("spades", 5) },
      { seat: 3, card: pip("hearts", 13) },
    ];
    expect(trickWinner(trick, classic)).toBe(2);
  });

  it("jokers & deuces order: Big Joker > Little Joker > 2♦ > 2♠ > A♠", () => {
    const trick: Play[] = [
      { seat: 0, card: pip("spades", 14) },
      { seat: 1, card: pip("spades", 2) },
      { seat: 2, card: pip("diamonds", 2) },
      { seat: 3, card: { kind: "joker", size: "little" } },
    ];
    expect(trickWinner(trick, jokersAndDeuces)).toBe(3);
    expect(trickWinner([...trick.slice(0, 3)], jokersAndDeuces)).toBe(2);
    expect(trickWinner([...trick.slice(0, 2)], jokersAndDeuces)).toBe(1);
  });
});
