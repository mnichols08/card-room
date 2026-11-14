import { describe, expect, it } from "vitest";
import { basic, blackjack, classicBlackjack, newBlackjack, total, type BlackjackState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
/** A table of two, both bets placed, with a stacked shoe (drawn from the end). */
function table(shoe: string, bets = [10, 10]): BlackjackState {
  let s = { ...newBlackjack(classicBlackjack, 2, 1), shoe: cards(shoe).reverse() } as BlackjackState;
  s = blackjack.apply(s, 0, { type: "bet", amount: bets[0] });
  return blackjack.apply(s, 1, { type: "bet", amount: bets[1] });
}

describe("Blackjack", () => {
  it("counts aces as 1 or 11", () => {
    expect(total(cards("A♠ K♥"))).toEqual({ value: 21, soft: true });
    expect(total(cards("A♠ 6♥"))).toEqual({ value: 17, soft: true });
    expect(total(cards("A♠ 6♥ 9♣"))).toEqual({ value: 16, soft: false });
    expect(total(cards("A♠ A♥ 9♣"))).toEqual({ value: 21, soft: true });
  });

  it("deals two each, the dealer's second face down; hit, stand, bust", () => {
    // Deal order: P0, P1, dealer, P0, P1, dealer.
    let s = table("10♠ 9♥ 10♦ 6♣ 9♠ 7♦ 8♥ 2♣");
    expect(s.phase).toBe("play");
    expect(blackjack.view(s, 0).center).toMatchObject({ discard: [card("10♦")], spreadHidden: 1 });
    s = blackjack.apply(s, 0, { type: "hit" }); // 16 + 8 = bust
    expect(s.turn).toBe(1);
    s = blackjack.apply(s, 1, { type: "stand" }); // 18 against 17
    expect(s.phase).toBe("settled");
    expect(s.net).toEqual([-10, 10]);
    expect(s.chips).toEqual([190, 210]);
  });

  it("the dealer draws to 17", () => {
    let s = table("10♠ 10♥ 5♦ 8♣ 9♠ 6♦ 2♥ 3♣ 9♣");
    s = blackjack.apply(s, 0, { type: "stand" });
    s = blackjack.apply(s, 1, { type: "stand" });
    expect(s.dealer.map((c) => c.id)).toEqual(["5♦", "6♦", "2♥", "3♣", "9♣"]);
    expect(s.net).toEqual([10, 10]);
  });

  it("blackjack pays 3 to 2; the dealer's blackjack ends the round at once", () => {
    let s = table("A♠ 10♥ 9♦ K♠ 8♣ 7♦ 2♥");
    expect(s.hands[0]![0]!.done).toBe(true);
    s = blackjack.apply(s, 1, { type: "stand" });
    expect(s.net[0]).toBe(15);
    s = table("9♠ 10♥ A♦ 8♠ 8♣ K♦");
    expect(s.phase).toBe("settled");
    expect(s.net).toEqual([-10, -10]);
  });

  it("double: twice the bet, one card", () => {
    let s = table("6♠ 10♥ 10♦ 5♣ 9♠ 7♦ 9♥");
    s = blackjack.apply(s, 0, { type: "double" });
    expect(s.hands[0]![0]).toMatchObject({ bet: 20, doubled: true, done: true });
    expect(s.hands[0]![0]!.cards).toHaveLength(3);
    s = blackjack.apply(s, 1, { type: "stand" });
    expect(s.net[0]).toBe(20); // 20 beats 17
  });

  it("split a pair into two hands", () => {
    let s = table("8♠ 10♥ 10♦ 8♣ 9♠ 7♦ 3♥ 2♦ 10♣ 9♣");
    s = blackjack.apply(s, 0, { type: "split" });
    expect(s.hands[0]!.map((h) => h.cards.map((c) => c.id))).toEqual([["8♠", "3♥"], ["8♣", "2♦"]]);
    expect(() => blackjack.apply(s, 0, { type: "split" })).toThrow();
    s = blackjack.apply(s, 0, { type: "hit" }); // 11 + 10 = 21: done
    expect(s.active).toBe(1);
    s = blackjack.apply(s, 0, { type: "hit" }); // 10 + 9 = 19
    s = blackjack.apply(s, 0, { type: "stand" });
    s = blackjack.apply(s, 1, { type: "stand" });
    expect(s.net[0]).toBe(20);
  });

  it("basic strategy: stand on 17, hit 16 against a 10, split eights, double 11", () => {
    expect(basic(cards("10♠ 7♥"), card("10♦"), true, false)).toBe("stand");
    expect(basic(cards("10♠ 6♥"), card("10♦"), true, false)).toBe("hit");
    expect(basic(cards("8♠ 8♥"), card("10♦"), true, true)).toBe("split");
    expect(basic(cards("6♠ 5♥"), card("10♦"), true, false)).toBe("double");
  });

  it("most chips after the last round wins", () => {
    let s = { ...newBlackjack({ ...classicBlackjack, rounds: 1 }, 2, 1), shoe: cards("10♠ 9♥ 10♦ 6♣ 9♠ 7♦").reverse() } as BlackjackState;
    s = blackjack.apply(s, 0, { type: "bet", amount: 10 });
    s = blackjack.apply(s, 1, { type: "bet", amount: 10 });
    s = blackjack.apply(s, 0, { type: "stand" });
    s = blackjack.apply(s, 1, { type: "stand" });
    expect(s.phase).toBe("finished");
    expect(blackjack.view(s, 0).over?.winners).toEqual([1]);
  });
});
