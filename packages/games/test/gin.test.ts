import { describe, expect, it } from "vitest";
import { arrange, bestMelds, classicGin, gin, layOff, newGin, type GinState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const hand = (ids: string) => ids.split(" ").map(card);
const ids = (cards: KCard[]) => cards.map((c) => c.id);

describe("Gin rummy", () => {
  it("finds the melds that leave the least deadwood (sets, runs, ace low)", () => {
    const r = bestMelds(hand("A♠ 2♠ 3♠ 7♥ 7♦ 7♣ 9♣ K♦ Q♦ J♦"));
    expect(r.melds.map((m) => ids(m).sort())).toEqual(expect.arrayContaining([["2♠", "3♠", "A♠"].sort(), ["7♣", "7♦", "7♥"].sort(), ["J♦", "K♦", "Q♦"].sort()]));
    expect(r.deadwood).toBe(9);
    // A card can only be in one meld: the 7♠ fits the run or the set. The run 5-6-7-8♠ leaves 14;
    // the set 7-7-7 would leave 19.
    const tight = bestMelds(hand("5♠ 6♠ 7♠ 7♥ 7♦ 8♠"));
    expect(tight.deadwood).toBe(14);
    // Q K A isn't a run.
    expect(bestMelds(hand("Q♠ K♠ A♠")).deadwood).toBe(21);
  });

  it("lays off deadwood on the knocker's melds: runs at either end, sets to four", () => {
    const { laid, left } = layOff([hand("4♥ 5♥ 6♥"), hand("9♣ 9♦ 9♠")], hand("3♥ 7♥ 9♥ K♠"));
    expect(ids(laid).sort()).toEqual(["3♥", "7♥", "9♥"].sort());
    expect(ids(left)).toEqual(["K♠"]);
  });

  it("deals ten each with one card up; draw or take, then discard", () => {
    let s = newGin(classicGin, 2, 3);
    expect(s.hands.map((h) => h.length)).toEqual([10, 10]);
    expect(s.discard).toHaveLength(1);
    const p = s.turn;
    expect(() => gin.apply(s, p, { type: "discard", cards: [s.hands[p]![0]!.id] })).toThrow("discard");
    const top = s.discard[0]!.id;
    s = gin.apply(s, p, { type: "take" });
    expect(() => gin.apply(s, p, { type: "discard", cards: [top] })).toThrow("throw back");
    s = gin.apply(s, p, { type: "discard", cards: [s.hands[p]!.find((c) => c.id !== top)!.id] });
    expect(s.turn).toBe((p + 1) % 2);
  });

  it("knocking: the difference in deadwood; an undercut; gin with a bonus", () => {
    const base = (h0: string, h1: string): GinState => ({ ...newGin(classicGin, 2, 1), turn: 0, phase: "discard", taken: null, hands: [hand(h0), hand(h1)] });
    const loose = "J♥ Q♣ 8♠ 7♦ 5♣ 5♥ 4♠ K♥ 8♣ 10♦"; // no melds: 77 deadwood

    // Knock with 3 (the 3♥). The defender lays off the 7♦ (on 4-5-6♦) and the 4♠ (on A-2-3♠): 66 left.
    let s = gin.apply(base("A♠ 2♠ 3♠ 4♦ 5♦ 6♦ 9♥ 9♣ 9♠ 3♥ 2♣", loose), 0, { type: "knock", cards: ["2♣"] });
    expect(s.lastHand).toMatchObject({ knocker: 0, gin: false, undercut: false, deadwood: [3, 66], points: [63, 0], winner: 0 });
    expect(s.lastHand!.laidOff.map((c) => c.id).sort()).toEqual(["4♠", "7♦"]);

    // Too much deadwood to knock.
    expect(() => gin.apply(base("A♠ 2♠ 3♠ K♦ Q♣ J♥ 10♠ 9♦ 8♣ 7♥ 6♠", loose), 0, { type: "knock", cards: ["6♠"] })).toThrow("deadwood");

    // Undercut: the defender lays off the 3♦ and is left with A♥ 2♥ = 3, as little as the knocker.
    s = gin.apply(base("A♠ 2♠ 3♠ 4♦ 5♦ 6♦ 9♥ 9♣ 9♠ 3♥ K♣", "A♥ 2♥ 3♦ 5♣ 6♣ 7♣ 10♠ J♠ Q♠ K♠"), 0, { type: "knock", cards: ["K♣"] });
    expect(s.lastHand).toMatchObject({ undercut: true, winner: 1, deadwood: [3, 3], points: [0, 25] });

    // Gin: no deadwood, no laying off; 25 + the defender's 77.
    s = gin.apply(base("A♠ 2♠ 3♠ 4♦ 5♦ 6♦ 9♥ 9♣ 9♠ 9♦ K♣", loose), 0, { type: "knock", cards: ["K♣"] });
    expect(s.lastHand).toMatchObject({ gin: true, winner: 0, points: [102, 0], laidOff: [] });
  });

  it("sorts your hand with the melds together", () => {
    const sorted = ids(arrange(hand("K♦ 7♥ A♠ 9♣ 7♦ 2♠ 3♠ 7♣ Q♦ J♦")));
    expect(sorted.at(-1)).toBe("9♣");
    expect(sorted.slice(0, 9).sort()).toEqual(["A♠", "2♠", "3♠", "7♥", "7♦", "7♣", "J♦", "Q♦", "K♦"].sort());
  });

  it("bots go gin when they can", () => {
    const s: GinState = { ...newGin(classicGin, 2, 1), turn: 0, phase: "discard", taken: null, hands: [hand("A♠ 2♠ 3♠ 4♦ 5♦ 6♦ 9♥ 9♣ 9♠ 9♦ K♣"), hand("J♥ Q♣ 8♠ 7♦ 5♣ 5♥ 4♠ K♥ 8♣ 10♦")] };
    expect(gin.bot(s, 0, { skill: 1, sloppy: 0 })).toEqual({ type: "knock", cards: ["K♣"] });
  });
});
