import { describe, expect, it } from "vitest";
import { classicBus, guessRight, newBus, rideTheBus, type BusState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);

describe("Ride the Bus", () => {
  it("the four questions", () => {
    expect(guessRight([], "red", card("5♥"))).toBe(true);
    expect(guessRight(cards("5♥"), "higher", card("9♠"))).toBe(true);
    expect(guessRight(cards("5♥"), "higher", card("5♠"))).toBe(false);
    expect(guessRight(cards("5♥ Q♠"), "inside", card("9♠"))).toBe(true);
    expect(guessRight(cards("5♥ Q♠"), "outside", card("Q♦"))).toBe(false);
    expect(guessRight(cards("5♥ Q♠ 9♣"), "clubs", card("2♣"))).toBe(true);
  });

  it("right: hand out drinks; wrong: drink", () => {
    let s = { ...newBus(classicBus, 2, 1), dealer: 1, turn: 0, deck: cards("9♠ 4♥") } as BusState;
    s = rideTheBus.apply(s, 0, { type: "guess", guess: "red" }); // 4♥: right
    expect(s.tally.give).toEqual([{ from: 0, n: 1, why: expect.any(String) }]);
    expect(() => rideTheBus.apply(s, 1, { type: "guess", guess: "red" })).toThrow("Waiting");
    s = rideTheBus.apply(s, 0, { type: "give", to: 1 });
    expect(s.tally.drank).toEqual([0, 1]);
    s = rideTheBus.apply(s, 1, { type: "guess", guess: "red" }); // 9♠: wrong
    expect(s.tally.drank).toEqual([0, 2]);
    expect(s.question).toBe(1);
  });

  it("the pyramid: matches hand out drinks; the most cards left rides the bus, until four right", () => {
    let s = { ...newBus(classicBus, 2, 1), phase: "pyramid", hands: [cards("4♥ 9♠ 9♦ K♣"), cards("2♠ 3♠ 5♠ 6♠")], hidden: cards("9♥ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦ 2♦"), turn: 0, dealer: 0 } as BusState;
    s = rideTheBus.apply(s, 0, { type: "flip" });
    expect(s.tally.give).toEqual([{ from: 0, n: 2, why: expect.any(String) }]);
    expect(s.hands[0]).toHaveLength(2);
    s = rideTheBus.apply(s, 0, { type: "give", to: 1 });
    for (let k = 1; k < 10; k++) {
      s = rideTheBus.apply(s, 0, { type: "flip" });
      while (s.tally.give.length) s = rideTheBus.apply(s, s.tally.give[0]!.from, { type: "give", to: 1 - s.tally.give[0]!.from });
    }
    expect(s.phase).toBe("bus");
    expect(s.rider).toBe(1);
    s = { ...s, deck: cards("3♣ K♦ 5♠ 8♥") };
    for (const g of ["red", "lower", "outside", "clubs"]) s = rideTheBus.apply(s, 1, { type: "guess", guess: g });
    expect(s.phase).toBe("finished");
    expect(rideTheBus.view(s, 0).over?.winners).toEqual([0]);
  });
});
