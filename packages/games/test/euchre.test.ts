import { describe, expect, it } from "vitest";
import { classicEuchre, euchre, euchreLegal, euchrePoints, euchrePower, euchreSuit, newEuchre, type EuchreState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const hand = (ids: string) => ids.split(" ").map(card);

describe("Euchre", () => {
  it("deals five each from 24 cards, with one turned up", () => {
    const s = newEuchre(classicEuchre, 4, 3);
    expect(s.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
    expect(s.upcard).not.toBeNull();
    expect(s.kitty).toHaveLength(3);
    expect(s.hands.flat().every((c) => (c as { rank: number }).rank >= 9)).toBe(true);
    expect(s.turn).toBe((s.dealer + 1) % 4);
  });

  it("the bowers: J of trump is best, the other jack of its colour is next and counts as trump", () => {
    const suit = euchreSuit("hearts");
    const power = euchrePower("hearts");
    expect(suit(card("J♦"))).toBe("hearts");
    expect(suit(card("J♣"))).toBe("clubs");
    expect(power(card("J♥"))).toBeGreaterThan(power(card("J♦")));
    expect(power(card("J♦"))).toBeGreaterThan(power(card("A♥")));
  });

  it("ordering it up: the dealer picks up the card and discards; play starts left of the dealer", () => {
    let s: EuchreState = { ...newEuchre(classicEuchre, 4, 1), dealer: 3, turn: 0, upcard: card("9♠"), hands: [hand("A♠ K♠ J♠ J♣ 10♥"), hand("9♥ 10♦ Q♦ K♦ A♦"), hand("9♣ 10♣ Q♣ K♣ A♣"), hand("9♦ 10♠ Q♠ Q♥ K♥")] };
    s = euchre.apply(s, 0, { type: "order" });
    expect(s.phase).toBe("discard");
    expect(s.trump).toBe("spades");
    expect(s.hands[3]).toHaveLength(6);
    expect(() => euchre.apply(s, 0, { type: "discard", cards: ["A♠"] })).toThrow();
    s = euchre.apply(s, 3, { type: "discard", cards: ["9♦"] });
    expect(s.phase).toBe("playing");
    expect(s.hands[3]).toHaveLength(5);
    expect(s.turn).toBe(0);
    // The left bower (J♣) follows spades.
    s = euchre.apply(s, 0, { type: "play", card: "10♥" });
    expect(euchreLegal(s, 1).map((c) => c.id)).toEqual(["9♥"]);
  });

  it("everyone passes, the card is turned down, and the stuck dealer must name another suit", () => {
    let s: EuchreState = { ...newEuchre(classicEuchre, 4, 1), dealer: 3, turn: 0, upcard: card("9♠") };
    for (const seat of [0, 1, 2, 3]) s = euchre.apply(s, seat, { type: "pass" });
    expect(s.phase).toBe("bid2");
    for (const seat of [0, 1, 2]) s = euchre.apply(s, seat, { type: "pass" });
    expect(() => euchre.apply(s, 3, { type: "pass" })).toThrow("Stick the dealer");
    expect(() => euchre.apply(s, 3, { type: "name", suit: "spades" })).toThrow("turned down");
    s = euchre.apply(s, 3, { type: "name", suit: "hearts" });
    expect(s).toMatchObject({ phase: "playing", trump: "hearts", maker: 3 });
  });

  it("without stick the dealer, four more passes deal again", () => {
    let s: EuchreState = { ...newEuchre({ ...classicEuchre, stickTheDealer: false }, 4, 1), dealer: 3, turn: 0 };
    for (let i = 0; i < 8; i++) s = euchre.apply(s, (i % 4) as 0, { type: "pass" });
    expect(s.phase).toBe("bid1");
    expect(s.dealer).toBe(0);
  });

  it("going alone: the partner sits out and the trick has three cards", () => {
    let s: EuchreState = { ...newEuchre(classicEuchre, 4, 1), dealer: 3, turn: 0, upcard: card("9♠"), hands: [hand("A♠ K♠ J♠ J♣ 10♥"), hand("9♥ 10♦ Q♦ K♦ A♦"), hand("9♣ 10♣ Q♣ K♣ A♣"), hand("9♦ 10♠ Q♠ Q♥ K♥")] };
    s = euchre.apply(s, 0, { type: "order", alone: true });
    s = euchre.apply(s, 3, { type: "discard", cards: ["9♦"] });
    expect(s.alone).toBe(0);
    s = euchre.apply(s, 0, { type: "play", card: "J♠" });
    s = euchre.apply(s, 1, { type: "play", card: "9♥" });
    expect(s.turn).toBe(3);
    s = euchre.apply(s, 3, { type: "play", card: "10♠" });
    expect(s.lastTrick!.winner).toBe(0);
    expect(s.turn).toBe(0);
  });

  it("scores: 1 for three or four, 2 for a march, 4 alone, 2 to the defenders for a euchre", () => {
    expect(euchrePoints(3, false)).toEqual({ makers: 1, defenders: 0 });
    expect(euchrePoints(5, false)).toEqual({ makers: 2, defenders: 0 });
    expect(euchrePoints(5, true)).toEqual({ makers: 4, defenders: 0 });
    expect(euchrePoints(2, false)).toEqual({ makers: 0, defenders: 2 });
  });

  it("a strong hand orders it up; a bot partner who's winning stays low", () => {
    const s: EuchreState = { ...newEuchre(classicEuchre, 4, 1), dealer: 3, turn: 0, upcard: card("9♠"), hands: [hand("A♠ K♠ J♠ J♣ 10♥"), ...newEuchre(classicEuchre, 4, 1).hands.slice(1)] };
    expect(euchre.bot(s, 0, { skill: 1, sloppy: 0 })).toMatchObject({ type: "order" });
    const p: EuchreState = { ...s, phase: "playing", trump: "spades", maker: 0, turn: 2, hands: [hand("K♠"), hand("Q♦"), hand("9♥ A♥"), hand("Q♠")], trick: [{ seat: 0, card: card("A♥") }, { seat: 1, card: card("10♥") }] };
    expect(euchre.bot(p, 2, { skill: 1, sloppy: 0 })).toEqual({ type: "play", card: "9♥" });
  });
});
