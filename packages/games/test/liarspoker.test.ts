import { describe, expect, it } from "vitest";
import { bidName, bidThere, chance, classicLiars, LADDER, ladderIndex, liarsPoker, newLiars, type KCard, type LiarsState } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => ids.split(" ").map(card);
const at = (cat: number, rank: number) => ladderIndex({ cat, rank });

describe("Liar's Poker", () => {
  it("bids climb from a two up to a royal flush", () => {
    expect(bidName(LADDER[0]!)).toBe("a two");
    expect(bidName(LADDER.at(-1)!)).toBe("a royal flush");
    expect(at(1, 14)).toBeLessThan(at(2, 3));
    expect(bidName({ cat: 6, rank: 9 })).toBe("a full house, nines full");
  });

  it("knows whether a hand can be made from everyone's cards together", () => {
    const all = cards("K♠ K♥ 7♦ 7♣ 2♠ 3♥ 4♦ 5♣ A♥ 9♥ 6♥ 10♥");
    expect(bidThere({ cat: 1, rank: 13 }, all)).toBe(true);
    expect(bidThere({ cat: 2, rank: 13 }, all)).toBe(true); // kings and sevens
    expect(bidThere({ cat: 2, rank: 7 }, all)).toBe(false); // no pair below the sevens
    expect(bidThere({ cat: 4, rank: 5 }, all)).toBe(true); // A 2 3 4 5
    expect(bidThere({ cat: 4, rank: 7 }, all)).toBe(true); // 3 4 5 6 7
    expect(bidThere({ cat: 5, rank: 0 }, all)).toBe(true); // five hearts
    expect(bidThere({ cat: 3, rank: 13 }, all)).toBe(false);
    expect(bidThere({ cat: 6, rank: 13 }, cards("K♠ K♥ K♦ 7♣ 7♦"))).toBe(true);
  });

  it("each bid must be higher; liar can't be called before a bid", () => {
    let s = { ...newLiars(classicLiars, 2, 1), turn: 0 };
    expect(() => liarsPoker.apply(s, 0, { type: "liar" })).toThrow("Nobody has bid");
    s = liarsPoker.apply(s, 0, { type: "bid", at: at(1, 9) });
    expect(() => liarsPoker.apply(s, 1, { type: "bid", at: at(1, 8) })).toThrow("higher");
  });

  function called(hands: string[], bid: { cat: number; rank: number }): LiarsState {
    let s: LiarsState = { ...newLiars(classicLiars, 2, 1), hands: hands.map(cards), turn: 0 };
    s = liarsPoker.apply(s, 0, { type: "bid", at: ladderIndex(bid) });
    return liarsPoker.apply(s, 1, { type: "liar" });
  }

  it("calling liar when the hand is there costs the caller a life", () => {
    const s = called(["K♠ 2♦ 3♣ 9♥ J♣", "K♥ 5♦ 6♣ 8♥ Q♣"], { cat: 1, rank: 13 });
    expect(s.call).toMatchObject({ there: true, loser: 1 });
    expect(s.lives).toEqual([3, 2]);
  });

  it("calling liar when it isn't there costs the bidder a life; the loser bids first next round", () => {
    let s = called(["K♠ 2♦ 3♣ 9♥ J♣", "K♥ 5♦ 6♣ 8♥ Q♣"], { cat: 3, rank: 13 });
    expect(s.call).toMatchObject({ there: false, loser: 0 });
    expect(s.lives).toEqual([2, 3]);
    s = liarsPoker.apply(s, 0, { type: "next" });
    s = liarsPoker.apply(s, 1, { type: "next" });
    expect(s.phase).toBe("bidding");
    expect(s.turn).toBe(0);
  });

  it("lose your last life and you're out; the last one left wins", () => {
    let s: LiarsState = { ...newLiars(classicLiars, 2, 1), hands: [cards("K♠ 2♦ 3♣ 9♥ J♣"), cards("K♥ 5♦ 6♣ 8♥ Q♣")], lives: [1, 3], turn: 0 };
    s = liarsPoker.apply(s, 0, { type: "bid", at: at(7, 2) });
    s = liarsPoker.apply(s, 1, { type: "liar" });
    expect(s.phase).toBe("finished");
    expect(liarsPoker.view(s, 0).over?.winners).toEqual([1]);
  });

  it("you only see other players' cards after a call", () => {
    const s = newLiars(classicLiars, 3, 4);
    const v = JSON.stringify(liarsPoker.view(s, 0));
    for (const c of [...s.hands[1]!, ...s.hands[2]!]) expect(v).not.toContain(c.id);
  });

  it("estimates the odds: a hand already in yours is certain", () => {
    expect(chance({ cat: 1, rank: 9 }, cards("9♠ 9♥ 2♦ 3♣ 4♥"), 15)).toBe(1);
    expect(chance({ cat: 7, rank: 2 }, cards("9♠ 8♥ 7♦ 3♣ 4♥"), 5, 200)).toBeLessThan(0.05);
  });
});
