import { describe, expect, it } from "vitest";
import { allBids, bidsFor, bidValue, classic500, deck500, fiveHundred, legal500, newFiveHundred, score500, type FiveHundredState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  if (id === "JK") return { kind: "joker", size: "big", id: "BJ" } as KCard;
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
function playing(hands: string[], tricks: number, denom: "spades" | "hearts" | "nt" | "misere", seat = 0): FiveHundredState {
  const s = newFiveHundred(classic500, 4, 1);
  return { ...s, hands: hands.map(cards), phase: "playing", high: { seat, bid: { tricks, denom } }, turn: seat, trick: [], jokerSuit: null } as FiveHundredState;
}

describe("Five Hundred", () => {
  it("uses a 43-card deck: ten each and three in the kitty", () => {
    expect(deck500()).toHaveLength(43);
    const s = newFiveHundred(classic500, 4, 3);
    expect(s.hands.map((h) => h.length)).toEqual([10, 10, 10, 10]);
    expect(s.kitty).toHaveLength(3);
  });

  it("values bids from 6♠ 40 to 10 no trumps 520, misère 250", () => {
    expect(bidValue({ tricks: 6, denom: "spades" })).toBe(40);
    expect(bidValue({ tricks: 7, denom: "hearts" })).toBe(200);
    expect(bidValue({ tricks: 10, denom: "nt" })).toBe(520);
    expect(allBids(classic500).map((b) => bidValue(b)).indexOf(250)).toBeGreaterThan(0);
  });

  it("each bid must be worth more; passing drops you out; the winner takes the kitty", () => {
    let s = newFiveHundred(classic500, 4, 3);
    const first = s.turn;
    s = fiveHundred.apply(s, first, { type: "bid", tricks: 7, denom: "hearts" });
    expect(bidsFor(s, s.turn).every((b) => bidValue(b) > 200)).toBe(true);
    expect(() => fiveHundred.apply(s, s.turn, { type: "bid", tricks: 6, denom: "nt" })).toThrow();
    s = fiveHundred.apply(s, s.turn, { type: "pass" });
    s = fiveHundred.apply(s, s.turn, { type: "pass" });
    s = fiveHundred.apply(s, s.turn, { type: "pass" });
    expect(s.phase).toBe("kitty");
    expect(s.hands[first]).toHaveLength(13);
    s = fiveHundred.apply(s, first, { type: "discard", cards: s.hands[first]!.slice(0, 3).map((c) => c.id) });
    expect(s.phase).toBe("playing");
    expect(s.hands[first]).toHaveLength(10);
  });

  it("the joker and the bowers are the top trumps", () => {
    let s = playing(["5♥ 6♣", "J♦ 7♣", "J♥ 8♣", "JK 9♣"], 6, "hearts");
    for (const id of ["5♥", "J♦", "J♥", "BJ"]) s = fiveHundred.apply(s, s.turn, { type: "play", card: id });
    expect(s.lastTrick!.winner).toBe(3);
    s = playing(["5♥ 6♣", "J♦ 7♣", "J♥ 8♣", "A♥ 9♣"], 6, "hearts");
    for (const id of ["5♥", "J♦", "J♥", "A♥"]) s = fiveHundred.apply(s, s.turn, { type: "play", card: id });
    expect(s.lastTrick!.winner).toBe(2);
    // The left bower follows a trump lead.
    s = playing(["5♥ 6♣", "J♦ 7♣", "J♥ 8♣", "A♥ 9♣"], 6, "hearts");
    s = fiveHundred.apply(s, 0, { type: "play", card: "5♥" });
    expect(legal500(s, 1).map((c) => c.id)).toEqual(["J♦"]);
  });

  it("no trumps: lead the joker and name its suit", () => {
    let s = playing(["JK 6♣", "A♠ 7♣", "K♠ 8♣", "Q♠ 9♣"], 6, "nt");
    s = fiveHundred.apply(s, 0, { type: "play", card: "BJ" });
    expect(s.phase).toBe("nominate");
    s = fiveHundred.apply(s, 0, { type: "nominate", suit: "spades" });
    expect(legal500(s, 1).map((c) => c.id)).toEqual(["A♠"]);
    for (const id of ["A♠", "K♠", "Q♠"]) s = fiveHundred.apply(s, s.turn, { type: "play", card: id });
    expect(s.lastTrick!.winner).toBe(0);
  });

  it("scores: make it and score the bid, or lose it; slams; misère", () => {
    expect(score500(classic500, { tricks: 7, denom: "hearts" }, 8, 2)).toEqual({ bidders: 200, others: 20, made: true });
    expect(score500(classic500, { tricks: 7, denom: "hearts" }, 6, 4)).toEqual({ bidders: -200, others: 40, made: false });
    expect(score500(classic500, { tricks: 6, denom: "spades" }, 10, 0).bidders).toBe(250);
    expect(score500(classic500, { tricks: 0, denom: "misere" }, 0, 10)).toEqual({ bidders: 250, others: 0, made: true });
  });

  it("misère: partner sits out and the first trick taken loses it", () => {
    let s = playing(["A♠ 6♣", "5♠ 7♣", "K♠ 8♣", "Q♠ 9♣"], 0, "misere");
    expect(fiveHundred.view(s, 2).players[2]!.out).toBe(true);
    s = fiveHundred.apply(s, 0, { type: "play", card: "A♠" });
    s = fiveHundred.apply(s, s.turn, { type: "play", card: "5♠" });
    expect(s.turn).toBe(3);
    s = fiveHundred.apply(s, 3, { type: "play", card: "Q♠" });
    expect(s.phase).toBe("scored");
    expect(s.scores[0]).toBe(-250);
  });
});
