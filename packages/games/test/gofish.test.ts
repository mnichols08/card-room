import { describe, expect, it } from "vitest";
import { classicGoFish, goFish, newGoFish, pairsGoFish, type GoFishState, type KCard } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const hand = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const names = (cards: KCard[]) => cards.map((c) => c.id.split("#")[0]);

function table(hands: string[], pond = "2♠ 3♠ 4♠", over: Partial<GoFishState> = {}): GoFishState {
  const s = newGoFish(classicGoFish, hands.length, 1);
  return { ...s, hands: hands.map(hand), pond: hand(pond), books: hands.map(() => []), known: hands.map(() => []), turn: 0, phase: "asking", ...over };
}

describe("Go Fish", () => {
  it("deals 7 each to two or three players, 5 to four or more", () => {
    const two = newGoFish(classicGoFish, 2, 3);
    expect(two.hands.every((h, i) => h.length + two.books[i]!.flat().length === 7)).toBe(true);
    const four = newGoFish(classicGoFish, 4, 3);
    expect(four.pond.length + four.hands.flat().length + four.books.flat(2).length).toBe(52);
    expect(four.hands.every((h, i) => h.length + four.books[i]!.flat().length === 5)).toBe(true);
  });

  it("asking: they hand over every card of the rank and you go again", () => {
    const s = table(["7♠ 9♦", "7♥ 7♣ K♠", "Q♦"]);
    const after = goFish.apply(s, 0, { type: "ask", cards: [s.hands[0]![0]!.id], target: 1 });
    expect(names(after.hands[0]!)).toEqual(["7♠", "7♥", "7♣", "9♦"]);
    expect(names(after.hands[1]!)).toEqual(["K♠"]);
    expect(after.turn).toBe(0);
    expect(after.known[0]).toContain(7);
  });

  it("go fish: draw from the pond and the turn passes, unless you fish up the rank you asked for", () => {
    const s = table(["7♠ 9♦", "K♠", "Q♦"], "2♠ 3♠");
    const after = goFish.apply(s, 0, { type: "ask", cards: [s.hands[0]![0]!.id], target: 1 });
    expect(names(after.hands[0]!)).toEqual(["3♠", "7♠", "9♦"]);
    expect(after.turn).toBe(1);
    const t = table(["7♠ 9♦", "K♠", "Q♦"], "2♠ 7♦");
    const lucky = goFish.apply(t, 0, { type: "ask", cards: [t.hands[0]![0]!.id], target: 1 });
    expect(lucky.turn).toBe(0);
  });

  it("you can only ask for a rank you hold, of someone who has cards", () => {
    const s = table(["7♠", "", "Q♦"]);
    expect(() => goFish.apply(s, 0, { type: "ask", cards: [s.hands[0]![0]!.id], target: 1 })).toThrow("still has cards");
    expect(() => goFish.apply(s, 0, { type: "ask", cards: ["nope"], target: 2 })).toThrow("Pick a card");
  });

  it("four of a kind make a book; pairs do for little ones", () => {
    const s = table(["7♠ 7♦ 7♥ 9♦", "7♣ K♠", "Q♦"]);
    const after = goFish.apply(s, 0, { type: "ask", cards: [s.hands[0]![0]!.id], target: 1 });
    expect(after.books[0]).toHaveLength(1);
    expect(names(after.hands[0]!)).toEqual(["9♦"]);
    const pairs = newGoFish(pairsGoFish, 3, 9);
    expect(pairs.hands.every((h) => new Set(h.map((c) => (c as { rank: number }).rank)).size === h.length)).toBe(true);
  });

  it("running out of cards: you draw from the pond on your turn; the game ends when every card is booked", () => {
    const s = table(["7♠ 7♦ 7♥", "7♣ K♠", "Q♦"], "9♣");
    const after = goFish.apply(s, 0, { type: "ask", cards: [s.hands[0]![0]!.id], target: 1 });
    // Booked her last cards and went again: drew the 9 from the pond to keep playing.
    expect(after.turn).toBe(0);
    expect(names(after.hands[0]!)).toEqual(["9♣"]);
    const last = table(["7♠ 7♦ 7♥", "7♣", ""], "", { books: [[], [], [hand("2♠ 2♥ 2♦ 2♣")]] });
    const done = goFish.apply(last, 0, { type: "ask", cards: [last.hands[0]![0]!.id], target: 1 });
    expect(done.phase).toBe("finished");
    expect(goFish.view(done, 0).over?.winners).toEqual([0, 2]);
  });
});
