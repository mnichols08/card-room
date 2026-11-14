import { describe, expect, it } from "vitest";
import { classicContract, contractRummy, findContract, isRun, isSet, newContractRummy, splitContract, type ContractState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  if (id === "JK") return { kind: "joker", size: "big", id: `JK${Math.random()}` } as KCard;
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);

describe("Contract Rummy", () => {
  it("sets and runs, with 2s and jokers wild", () => {
    expect(isSet(cards("9♠ 9♥ 9♣"))).toBe(true);
    expect(isSet(cards("9♠ 9♥ 2♣"))).toBe(true);
    expect(isSet(cards("9♠ 2♥ JK"))).toBe(false);
    expect(isRun(cards("4♥ 5♥ 6♥ 7♥"))).toBe(true);
    expect(isRun(cards("4♥ 6♥ 7♥ 2♠"))).toBe(true);
    expect(isRun(cards("A♥ 3♥ 4♥ 2♠"))).toBe(true);
    expect(isRun(cards("J♥ Q♥ K♥ A♥"))).toBe(true);
    expect(isRun(cards("4♥ 5♥ 6♠ 7♥"))).toBe(false);
    expect(isRun(cards("4♥ 5♥ 6♥"))).toBe(false);
  });

  it("splits a contract and finds one in a hand", () => {
    expect(splitContract(cards("9♠ 9♥ 9♣ 4♥ 5♥ 6♥ 7♥"), 1, 1)).not.toBeNull();
    expect(splitContract(cards("9♠ 9♥ 9♣ 4♥ 5♥ 6♥ 8♥"), 1, 1)).toBeNull();
    const found = findContract(cards("9♠ 9♥ 2♣ 4♥ 5♥ 6♥ 7♥ K♠"), 1, 1);
    expect(found).toHaveLength(7);
  });

  it("deal, draw, lay down, lay off, discard, go out", () => {
    let s = { ...newContractRummy(classicContract, 3, 1), turn: 0, phase: "draw", hands: [cards("9♠ 9♥ 9♣ 5♦ 5♣ 5♥ K♠"), cards("3♠"), cards("4♠")], discard: cards("9♦"), stock: cards("Q♣ Q♦") } as ContractState;
    s = contractRummy.apply(s, 0, { type: "take" });
    expect(() => contractRummy.apply(s, 0, { type: "discard", cards: ["9♦"] })).toThrow("just took");
    s = contractRummy.apply(s, 0, { type: "layDown", cards: ["9♠", "9♥", "9♣", "5♦", "5♣", "5♥"] });
    expect(s.down[0]).toBe(true);
    expect(s.melds).toHaveLength(2);
    s = contractRummy.apply(s, 0, { type: "layOff", cards: ["9♦"] });
    expect(s.melds.map((m) => m.cards.length).sort()).toEqual([3, 4]);
    s = contractRummy.apply(s, 0, { type: "discard", cards: ["K♠"] });
    expect(s.phase).toBe("scored");
    expect(s.lastHand!.winner).toBe(0);
    expect(s.scores).toEqual([0, 5, 5]);
  });

  it("refuses a lay-down that doesn't make the contract", () => {
    const s = { ...newContractRummy(classicContract, 3, 1), turn: 0, phase: "play", hands: [cards("9♠ 9♥ 8♣ 5♦ 5♣ 5♥ K♠"), cards("3♠"), cards("4♠")] } as ContractState;
    expect(() => contractRummy.apply(s, 0, { type: "layDown", cards: ["9♠", "9♥", "8♣", "5♦", "5♣", "5♥"] })).toThrow("don't make");
  });
});
