import { describe, expect, it } from "vitest";
import { classicCribbage, countHand, cribbage, newCribbage, pegPoints, playable, type CribbageState, type KCard } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const count = (hand: string, starter: string, crib = false) => countHand(cards(hand), card(starter), crib);

describe("Cribbage: counting a hand", () => {
  it("the perfect 29: three fives and the jack of the starter's suit, with the other five cut", () => {
    expect(count("5♠ 5♥ 5♦ J♣", "5♣").points).toBe(29);
  });
  it("fifteen two, fifteen four, and a pair is six", () => {
    expect(count("7♠ 8♥ 7♦ 2♣", "K♠")).toEqual({ points: 6, words: "Fifteen 2, fifteen 4, a pair is 6" });
  });
  it("a double run of three is eight", () => {
    // 3 4 4 5 with a K: the K and the 5 make fifteen (2), the fours a pair (2), two runs of three (6).
    expect(count("3♠ 4♥ 4♦ 5♣", "K♠").points).toBe(2 + 2 + 6);
    expect(count("3♠ 4♥ 4♦ 5♣", "K♠").words).toContain("a double run of 3 is");
  });
  it("flushes: four in the hand, five with the starter; a crib needs all five", () => {
    // No fifteens, pairs or runs in these: just the flush.
    expect(count("2♥ 4♥ 6♥ 8♥", "K♠").points).toBe(4);
    expect(count("2♥ 4♥ 6♥ 8♥", "K♥").points).toBe(5);
    expect(count("2♥ 4♥ 6♥ 8♥", "K♠", true).points).toBe(0);
    expect(count("2♥ 4♥ 6♥ 8♥", "K♥", true).points).toBe(5);
  });
  it("nobs, and nineteen", () => {
    expect(count("J♠ 2♥ 4♦ 6♣", "9♠").words).toContain("one for his nobs");
    expect(count("2♠ 4♥ 6♦ 8♣", "Q♠")).toEqual({ points: 0, words: "Nineteen (no points)" });
  });
});

describe("Cribbage: pegging", () => {
  it("scores fifteen, thirty-one, pairs and runs in any order", () => {
    expect(pegPoints(cards("7♠ 8♥"), 15).points).toBe(2);
    expect(pegPoints(cards("6♠ 6♥"), 12).points).toBe(2);
    expect(pegPoints(cards("6♠ 6♥ 6♦"), 18).points).toBe(6);
    expect(pegPoints(cards("4♠ 6♥ 5♦"), 15)).toEqual({ points: 5, words: ["fifteen for 2", "a run of 3 for 3"] });
    expect(pegPoints(cards("K♠ Q♥ A♦"), 21).points).toBe(0);
  });

  function pegging(over: Partial<CribbageState> = {}): CribbageState {
    const s = newCribbage(classicCribbage, 2, 1);
    return { ...s, phase: "pegging", dealer: 0, turn: 1, starter: card("9♣"), run: [], count: 0, go: [false, false], lastPlayer: null, scores: [0, 0], back: [0, 0], ...over };
  }

  it("you can't take the count past 31; when nobody can play, the last to play gets 1 for the go", () => {
    let s = pegging({ peg: [cards("2♠ K♦"), cards("K♠ Q♥ 3♣")], hands: [cards("2♠ K♦"), cards("K♠ Q♥ 3♣")], count: 0 });
    s = cribbage.apply(s, 1, { type: "play", card: s.peg[1]![0]!.id }); // 10
    s = cribbage.apply(s, 0, { type: "play", card: s.peg[0]![1]!.id }); // 20
    s = cribbage.apply(s, 1, { type: "play", card: s.peg[1]![0]!.id }); // 30
    // Neither can play without passing 31 (the 2 and the 3): the go is scored for seat 1 at once,
    // and the count starts again with seat 0.
    expect(s.narration).toContain("a go: 1 for {1}");
    expect(s.scores[1]).toBe(1);
    expect(s.count).toBe(0);
    expect(s.turn).toBe(0);
  });

  it("the last card gets 1, then the show counts each hand and the crib", () => {
    const hands = [cards("5♠ 5♥ 10♦ J♣"), cards("2♠ 3♥ 4♦ 6♣")];
    let s = pegging({ hands, peg: [cards("5♠"), []], crib: cards("A♠ A♥ 9♦ 8♣"), count: 0, lastPlayer: null });
    s = { ...s, turn: 0 };
    s = cribbage.apply(s, 0, { type: "play", card: s.peg[0]![0]!.id });
    expect(s.phase).toBe("show");
    expect(s.show.map((c) => [c.owner, c.crib])).toEqual([[1, false], [0, false], [0, true]]);
    // Seat 0: 1 for the last card, then their hand and crib.
    expect(s.scores[0]).toBe(1 + s.show[1]!.points + s.show[2]!.points);
    expect(s.scores[1]).toBe(s.show[0]!.points);
  });

  it("a card that takes the count past 31 is refused", () => {
    const s = pegging({ peg: [cards("K♦ 2♠"), cards("3♣")], hands: [cards("K♦ 2♠"), cards("3♣")], count: 25, turn: 0 });
    expect(playable(s, 0).map((c) => c.id.split("#")[0])).toEqual(["2♠"]);
    expect(() => cribbage.apply(s, 0, { type: "play", card: s.peg[0]![0]!.id })).toThrow("past 31");
  });

  it("the game ends the moment someone reaches 121", () => {
    let s = pegging({ peg: [cards("7♠"), cards("8♥ 9♠")], hands: [cards("7♠"), cards("8♥ 9♠")], scores: [100, 120], turn: 0 });
    s = cribbage.apply(s, 0, { type: "play", card: s.peg[0]![0]!.id });
    s = cribbage.apply(s, 1, { type: "play", card: s.peg[1]![0]!.id }); // 15 for 2: 122, capped at 121
    expect(s.phase).toBe("finished");
    expect(s.scores[1]).toBe(121);
    expect(cribbage.view(s, 0).over?.winners).toEqual([1]);
  });

  it("laying away: two each into the dealer's crib, then the cut", () => {
    let s = newCribbage(classicCribbage, 2, 4);
    s = cribbage.apply(s, 0, { type: "crib", cards: s.hands[0]!.slice(0, 2).map((c) => c.id) });
    expect(() => cribbage.apply(s, 0, { type: "crib", cards: s.hands[0]!.slice(0, 2).map((c) => c.id) })).toThrow("laid");
    s = cribbage.apply(s, 1, { type: "crib", cards: s.hands[1]!.slice(0, 2).map((c) => c.id) });
    expect(s.crib).toHaveLength(4);
    expect(s.starter).not.toBeNull();
    expect(s.phase).toBe("pegging");
    expect(s.turn).toBe(1 - s.dealer);
  });
});
