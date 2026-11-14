import { describe, expect, it } from "vitest";
import { bestHand, bet, compareScore, drawPlan, fiveDraw, friendlyDraw, handName, newDraw, newRound, options, pot, putIn, roundDone, score5, settle, type Betting, type DrawState, type KCard } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => ids.split(" ").map(card);
const name = (ids: string) => handName(bestHand(cards(ids)).score);
const beats = (a: string, b: string) => compareScore(score5(cards(a)), score5(cards(b))) > 0;

describe("Poker hands", () => {
  it("names every kind of hand", () => {
    expect(name("A♠ K♠ Q♠ J♠ 10♠")).toBe("a royal flush");
    expect(name("9♥ 8♥ 7♥ 6♥ 5♥")).toBe("a straight flush to the nine");
    expect(name("9♣ 9♦ 9♥ 9♠ 2♠")).toBe("four nines");
    expect(name("K♣ K♦ K♥ 7♠ 7♦")).toBe("a full house, kings full of sevens");
    expect(name("A♦ 9♦ 7♦ 4♦ 2♦")).toBe("a flush, ace high");
    expect(name("5♣ 4♦ 3♥ 2♠ A♠")).toBe("a straight to the five");
    expect(name("7♣ 7♦ 7♥ K♠ 2♦")).toBe("three sevens");
    expect(name("K♣ K♦ 7♥ 7♠ 2♦")).toBe("two pair, kings and sevens");
    expect(name("Q♣ Q♦ 7♥ 5♠ 2♦")).toBe("a pair of queens");
    expect(name("A♣ J♦ 7♥ 5♠ 2♦")).toBe("ace high");
  });

  it("ranks hands, kickers included", () => {
    expect(beats("2♣ 2♦ 3♥ 3♠ 4♦", "A♣ A♦ K♥ Q♠ J♦")).toBe(true);
    expect(beats("A♣ A♦ K♥ 4♠ 3♦", "A♥ A♠ Q♥ J♠ 10♦")).toBe(true);
    expect(beats("6♣ 5♦ 4♥ 3♠ 2♦", "5♣ 4♦ 3♥ 2♠ A♠")).toBe(true); // the wheel is the lowest straight
    expect(compareScore(score5(cards("K♣ Q♦ 9♥ 5♠ 3♦")), score5(cards("K♥ Q♠ 9♣ 5♦ 3♠")))).toBe(0);
  });

  it("finds the best five of seven", () => {
    expect(name("A♠ A♥ K♣ K♦ K♥ 2♣ 3♦")).toBe("a full house, kings full of aces");
    expect(name("2♥ 3♥ 9♥ J♥ 4♣ K♥ A♣")).toBe("a flush, king high");
  });
});

const fresh = (stacks: number[]): Betting => ({ stacks: [...stacks], live: stacks.map(() => true), committed: stacks.map(() => 0), roundBet: stacks.map(() => 0), toMatch: 0, size: 10, raises: 0, acted: stacks.map(() => false), turn: 0 });

describe("Fixed-limit betting", () => {
  it("check, bet, raise, call: the round ends when everyone has matched", () => {
    const b = fresh([100, 100, 100]);
    newRound(b, 10, 0);
    bet(b, 0, { type: "check" });
    bet(b, 1, { type: "raise" }); // bets 10
    expect(b.toMatch).toBe(10);
    expect(roundDone(b)).toBe(false);
    bet(b, 2, { type: "raise" }); // raises to 20
    bet(b, 0, { type: "call" });
    expect(roundDone(b)).toBe(false);
    bet(b, 1, { type: "call" });
    expect(roundDone(b)).toBe(true);
    expect(pot(b)).toBe(60);
  });

  it("caps at four bets a round, and a short stack calls all in", () => {
    const b = fresh([1000, 1000]);
    newRound(b, 10, 0);
    for (let i = 0; i < 4; i++) bet(b, i % 2, { type: "raise" });
    expect(options(b, 0).raise).toBeNull();
    const short = fresh([100, 15]);
    newRound(short, 10, 0);
    bet(short, 0, { type: "raise" });
    bet(short, 1, { type: "raise" });
    expect(short.stacks[1]).toBe(0);
    expect(short.roundBet[1]).toBe(15);
  });

  it("side pots: an all-in player can only win what they matched", () => {
    const b = fresh([0, 0, 0]);
    // Seat 0 is all in for 50; seats 1 and 2 put in 150 each.
    b.committed = [50, 150, 150];
    const scores = [score5(cards("A♣ A♦ A♥ K♠ Q♦")), score5(cards("K♣ K♦ 7♥ 5♠ 2♦")), score5(cards("Q♣ Q♦ 7♣ 5♦ 2♣"))];
    const won = settle(b, scores, 2);
    // Main pot 150 to seat 0's trips; the side pot of 200 to seat 1's kings.
    expect(won).toEqual([150, 200, 0]);
    expect(b.stacks).toEqual([150, 200, 0]);
  });

  it("a tie splits the pot", () => {
    const b = fresh([0, 0]);
    b.committed = [50, 50];
    const won = settle(b, [score5(cards("K♣ Q♦ 9♥ 5♠ 3♦")), score5(cards("K♥ Q♠ 9♣ 5♦ 3♠"))], 0);
    expect(won).toEqual([50, 50]);
  });
});

describe("Five Card Draw", () => {
  it("antes, deals five each, and bets before and after the draw", () => {
    let s = newDraw(friendlyDraw, 3, 4);
    expect(s.hands.map((h) => h.length)).toEqual([5, 5, 5]);
    expect(pot(s.betting)).toBe(15);
    expect(s.phase).toBe("bet1");
    for (let i = 0; i < 3; i++) s = fiveDraw.apply(s, s.betting.turn, { type: "check" });
    expect(s.phase).toBe("draw");
    s = fiveDraw.apply(s, 0, { type: "draw", cards: s.hands[0]!.slice(0, 3).map((c) => c.id) });
    expect(s.hands[0]).toHaveLength(5);
    expect(() => fiveDraw.apply(s, 1, { type: "draw", cards: s.hands[1]!.slice(0, 4).map((c) => c.id) })).toThrow("three");
    s = fiveDraw.apply(s, 1, { type: "draw", cards: [] });
    s = fiveDraw.apply(s, 2, { type: "draw", cards: [] });
    expect(s.phase).toBe("bet2");
    expect(s.betting.size).toBe(20);
    for (let i = 0; i < 3; i++) s = fiveDraw.apply(s, s.betting.turn, { type: "check" });
    expect(s.phase).toBe("scored");
    expect(s.betting.stacks.reduce((a, b) => a + b, 0)).toBe(1500);
  });

  it("everyone else folding takes the pot without a showdown, and hides the hand", () => {
    let s = newDraw(friendlyDraw, 2, 6);
    const first = s.betting.turn;
    s = fiveDraw.apply(s, first, { type: "raise" });
    s = fiveDraw.apply(s, 1 - first, { type: "fold" });
    expect(s.phase).toBe("scored");
    expect(s.showdown!.uncontested).toBe(true);
    expect(fiveDraw.view(s, 1 - first).melds).toEqual([]);
    // Anted 5 and bet 10; wins both antes and the bet back: 500 − 15 + 20.
    expect(s.betting.stacks[first]).toBe(505);
  });

  it("another player's cards are never in your view before the showdown", () => {
    const s = newDraw(friendlyDraw, 4, 8);
    const v = JSON.stringify(fiveDraw.view(s, 0));
    for (const c of s.hands[2]!) expect(v).not.toContain(c.id);
  });

  it("the draw keeps pairs and four-card flushes", () => {
    expect(drawPlan(cards("Q♣ Q♦ 7♥ 5♠ 2♦")).map((c) => c.id.split("#")[0])).toEqual(["7♥", "5♠", "2♦"]);
    expect(drawPlan(cards("2♥ 7♥ 9♥ K♥ 4♣")).map((c) => c.id.split("#")[0])).toEqual(["4♣"]);
    expect(drawPlan(cards("9♣ 9♦ 9♥ 9♠ 2♦"))).toEqual([]); // four of a kind stands pat
  });
});
