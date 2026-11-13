import { describe, expect, it } from "vitest";
import { classicPinochle, meldOf, newPinochle, pinochle, pinochleLegal, type KCard, type PinochleState } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const hand = (ids: string) => ids.split(" ").map(card);

describe("Pinochle", () => {
  it("deals twelve each from two of every 9-to-ace card", () => {
    const s = newPinochle(classicPinochle, 4, 3);
    expect(s.hands.map((h) => h.length)).toEqual([12, 12, 12, 12]);
    expect(new Set(s.hands.flat().map((c) => c.id)).size).toBe(48);
    expect(s.phase).toBe("bidding");
  });

  it("melds: a run with its marriage not counted twice, the dix, pinochle, arounds and marriages", () => {
    // Run in hearts (150) + a second K♥ Q♥ (royal marriage 40) + dix 10 + pinochle 40 + kings around 80,
    // and marriages in ♣ and ♠ (20 each: the Q♠ counts for pinochle and its marriage, different kinds of meld).
    const m = meldOf(hand("A♥ 10♥ K♥ Q♥ J♥ K♥ Q♥ 9♥ Q♠ J♦ K♠ K♦ K♣ Q♣"), "hearts");
    expect(m.points).toBe(150 + 40 + 10 + 40 + 80 + 20 + 20);
    expect(m.parts).toEqual(expect.arrayContaining(["Run", "Kings around", "Pinochle", "Dix"]));
    // Aces around, doubled.
    expect(meldOf(hand("A♠ A♠ A♥ A♥ A♦ A♦ A♣ A♣"), "spades").points).toBe(1000);
    // Nothing.
    expect(meldOf(hand("9♠ 10♣ J♥ Q♦"), "clubs").points).toBe(0);
  });

  it("bidding: raise in tens, pass, and the high bidder names trump; the dealer can be stuck", () => {
    let s: PinochleState = { ...newPinochle(classicPinochle, 4, 1), dealer: 3, turn: 0 };
    expect(() => pinochle.apply(s, 0, { type: "bid", bid: 190 })).toThrow("at least 200");
    s = pinochle.apply(s, 0, { type: "bid", bid: 200 });
    s = pinochle.apply(s, 1, { type: "bid", bid: 210 });
    s = pinochle.apply(s, 2, { type: "pass" });
    s = pinochle.apply(s, 3, { type: "pass" });
    s = pinochle.apply(s, 0, { type: "pass" });
    expect(s).toMatchObject({ phase: "trump", bidder: 1, bid: 210, turn: 1 });
    s = pinochle.apply(s, 1, { type: "trump", suit: "clubs" });
    expect(s.phase).toBe("meld");
    expect(s.meld).toHaveLength(4);

    let d: PinochleState = { ...newPinochle(classicPinochle, 4, 1), dealer: 3, turn: 0 };
    for (const seat of [0, 1, 2]) d = pinochle.apply(d, seat, { type: "pass" });
    expect(() => pinochle.apply(d, 3, { type: "pass" })).toThrow("dealer takes it");
  });

  it("you must follow suit and beat the winning card, or trump when you can't follow", () => {
    const s: PinochleState = {
      ...newPinochle(classicPinochle, 4, 1),
      phase: "playing",
      trump: "spades",
      bidder: 0,
      bid: 250,
      turn: 1,
      hands: [hand("9♣"), hand("J♥ A♥ 9♦"), hand("9♠ K♠"), hand("Q♦")],
      trick: [{ seat: 0, card: card("K♥") }],
    };
    expect(pinochleLegal(s, 1).map((c) => c.id.split("#")[0])).toEqual(["A♥"]);
    const void_ = { ...s, turn: 2 };
    expect(pinochleLegal(void_, 2).map((c) => c.id.split("#")[0]).sort()).toEqual(["9♠", "K♠"]);
  });

  it("scores: the bidders make it with meld plus tricks, or they're set for the bid", () => {
    const base: PinochleState = { ...newPinochle(classicPinochle, 4, 1), phase: "playing", trump: "spades", bidder: 0, bid: 300, turn: 0, taken: [0, 0], tricks: [11, 0] };
    const meld = (points: number) => ({ points, cards: [], parts: [] });
    let s: PinochleState = { ...base, meld: [meld(150), meld(0), meld(40), meld(20)], hands: [hand("A♠"), hand("9♣"), hand("9♦"), hand("9♥")], taken: [100, 20] };
    for (const [seat, c] of [[0, "A♠"], [1, "9♣"], [2, "9♦"], [3, "9♥"]] as const) s = pinochle.apply(s, seat, { type: "play", card: s.hands[seat]![0]!.id });
    // Bidders: meld 190 + tricks 100 + 10 (the ace) + 10 (last trick) = 310 ≥ 300.
    expect(s.lastHand).toMatchObject({ set: false, points: [310, 40] });
    let t: PinochleState = { ...base, bid: 400, meld: [meld(150), meld(0), meld(40), meld(20)], hands: [hand("A♠"), hand("9♣"), hand("9♦"), hand("9♥")], taken: [100, 20] };
    for (const seat of [0, 1, 2, 3]) t = pinochle.apply(t, seat, { type: "play", card: t.hands[seat]![0]!.id });
    expect(t.lastHand).toMatchObject({ set: true, points: [-400, 40] });
  });
});
