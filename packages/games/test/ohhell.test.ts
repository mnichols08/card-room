import { describe, expect, it } from "vitest";
import { allowedBids, handPoints, newOhHell, ohHell, riverOhHell, riverPlan, type KCard, type OhHellState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const hand = (ids: string) => ids.split(" ").map(card);

describe("Oh Hell", () => {
  it("goes up and down the river, capped so everyone gets the same and a trump is left", () => {
    expect(riverPlan(riverOhHell, 4)).toEqual([1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1]);
    expect(riverPlan({ ...riverOhHell, maxCards: 13 }, 7)).toEqual([1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1]);
    expect(riverPlan({ ...riverOhHell, order: "down" }, 4)).toEqual([7, 6, 5, 4, 3, 2, 1]);
    const s = newOhHell(riverOhHell, 4, 3);
    expect(s.hands.map((h) => h.length)).toEqual([1, 1, 1, 1]);
    expect(s.trumpCard).not.toBeNull();
  });

  it("the dealer can't make the bids add up (the hook)", () => {
    let s: OhHellState = { ...newOhHell(riverOhHell, 3, 1), dealer: 2, turn: 0, plan: [3, 2, 1], hand: 0, hands: [hand("A♠ K♠ Q♠"), hand("2♥ 3♥ 4♥"), hand("5♦ 6♦ 7♦")] };
    s = ohHell.apply(s, 0, { type: "bid", bid: 2 });
    s = ohHell.apply(s, 1, { type: "bid", bid: 0 });
    expect(allowedBids(s, 2)).toEqual([0, 2, 3]);
    expect(() => ohHell.apply(s, 2, { type: "bid", bid: 1 })).toThrow("can't bid 1");
    s = ohHell.apply(s, 2, { type: "bid", bid: 0 });
    expect(s.phase).toBe("playing");
    expect(s.turn).toBe(0);
  });

  it("scores exact bids: 10 + bid, or a point a trick + 10, or −5 a trick off", () => {
    expect(handPoints(riverOhHell, 2, 2)).toBe(12);
    expect(handPoints(riverOhHell, 2, 3)).toBe(0);
    expect(handPoints({ ...riverOhHell, scoring: "tricks" }, 2, 3)).toBe(3);
    expect(handPoints({ ...riverOhHell, scoring: "tricks" }, 0, 0)).toBe(10);
    expect(handPoints({ ...riverOhHell, scoring: "penalty" }, 1, 3)).toBe(-10);
  });

  it("trump beats the suit led; following suit is enforced", () => {
    let s: OhHellState = {
      ...newOhHell(riverOhHell, 3, 1),
      phase: "playing",
      trumpCard: card("2♣"),
      turn: 0,
      bids: [1, 0, 0],
      hands: [hand("A♥ 3♠"), hand("K♥ 4♣"), hand("5♣ 6♠")],
    };
    s = ohHell.apply(s, 0, { type: "play", card: "A♥" });
    expect(() => ohHell.apply(s, 1, { type: "play", card: "4♣" })).toThrow("Follow suit");
    s = ohHell.apply(s, 1, { type: "play", card: "K♥" });
    s = ohHell.apply(s, 2, { type: "play", card: "5♣" });
    expect(s.lastTrick!.winner).toBe(2);
    expect(s.tricksWon).toEqual([0, 0, 1]);
  });

  it("a bot that has made its bid ducks under the winning card", () => {
    const s: OhHellState = { ...newOhHell(riverOhHell, 3, 1), phase: "playing", trumpCard: card("2♣"), turn: 1, bids: [1, 0, 1], tricksWon: [0, 0, 0], hands: [hand("3♠"), hand("A♥ 9♥ 2♥"), hand("4♠")], trick: [{ seat: 0, card: card("10♥") }] };
    expect(ohHell.bot(s, 1, { skill: 1, sloppy: 0 })).toEqual({ type: "play", card: "9♥" });
  });
});
