import { describe, expect, it } from "vitest";
import { canasta, canastaValue, classicCanasta, easyCanasta, meldPlan, newCanasta, takePlan, type CanastaState, type KCard } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  if (id === "JK") return { kind: "joker", size: "big", id: `JK#${n++}` } as KCard;
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const hand = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const ids = (cards: KCard[]) => cards.map((c) => c.id);

/** A table where seat 0 is about to play, with this hand, pile and melds. */
function table(over: Partial<CanastaState> & { mine?: string; pileOf?: string }): CanastaState {
  const s = newCanasta(classicCanasta, 4, 7);
  return {
    ...s,
    turn: 0,
    phase: "draw",
    hands: [hand(over.mine ?? "4♠ 9♥"), hand("5♠ 5♥ 6♦"), hand("7♠ 7♥ 8♦"), hand("9♠ 9♦ 10♣")],
    pile: hand(over.pileOf ?? "6♣"),
    melds: [[], []],
    red3s: [[], []],
    opened: [false, false],
    laid: [],
    ...over,
  };
}

describe("Canasta", () => {
  it("deals 11 each from two decks and four jokers, with red threes laid out", () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = newCanasta(classicCanasta, 4, seed);
      const all = [...s.hands.flat(), ...s.stock, ...s.pile, ...s.red3s.flat()];
      expect(all).toHaveLength(108);
      expect(new Set(all.map((c) => c.id)).size).toBe(108);
      expect(s.hands.every((h) => h.length === 11)).toBe(true);
      expect(s.hands.flat().some((c) => c.kind === "pip" && c.rank === 3 && (c.suit === "hearts" || c.suit === "diamonds"))).toBe(false);
    }
  });

  it("counts jokers 50, aces and twos 20, eights to kings 10, the rest 5", () => {
    expect(hand("JK A♠ 2♦ K♥ 8♣ 7♠ 4♦ 3♣").map(canastaValue)).toEqual([50, 20, 20, 10, 10, 5, 5, 5]);
  });

  it("melds: two naturals at least, three wild cards at most, wilds with one rank at a time", () => {
    const s = table({ phase: "meld", opened: [true, false], mine: "K♠ K♥ 2♣ 2♦ JK 2♠ Q♠ Q♦ 5♣ 6♣" });
    const h = s.hands[0]!;
    expect(meldPlan(s, 0, ids([h[0]!, h[2]!, h[3]!]))).toEqual({ error: expect.stringContaining("two natural") });
    expect(meldPlan(s, 0, ids(h.slice(0, 6)))).toEqual({ error: expect.stringContaining("three wild cards at most") });
    expect(meldPlan(s, 0, ids([h[0]!, h[1]!, h[6]!, h[7]!, h[2]!]))).toEqual({ error: expect.stringContaining("one rank at a time") });
    expect(meldPlan(s, 0, ids([h[0]!, h[1]!, h[2]!]))).toHaveProperty("groups");
  });

  it("you need a canasta to go out, or to meld down to your last card", () => {
    const s = table({ phase: "meld", opened: [true, false], mine: "K♠ K♥ K♦ 5♣" });
    expect(meldPlan(s, 0, ids(s.hands[0]!.slice(0, 3)))).toEqual({ error: expect.stringContaining("no canasta") });
    const withCanasta = { ...s, melds: [[{ rank: 9, cards: hand("9♠ 9♥ 9♦ 9♣ 9♠ 9♥ 9♦") }], []] as CanastaState["melds"] };
    expect(meldPlan(withCanasta, 0, ids(s.hands[0]!.slice(0, 3)))).toHaveProperty("groups");
  });

  it("the pile: frozen until you meld (a natural pair needed), blocked by a black three, never a wild on top", () => {
    expect(takePlan(table({ mine: "6♠ 2♦ 9♥ 9♦", pileOf: "4♦ 6♣" }), 0)).toEqual({ error: expect.stringContaining("frozen") });
    expect(takePlan(table({ mine: "6♠ 6♥ 9♥ 9♦", pileOf: "3♣" }), 0)).toEqual({ error: expect.stringContaining("black three") });
    expect(takePlan(table({ mine: "6♠ 6♥ 9♥ 9♦", pileOf: "2♣" }), 0)).toEqual({ error: expect.stringContaining("wild") });
    // Opened, nothing wild in the pile: one natural and a wild will do, or adding to our meld.
    const open = { opened: [true, false] as [boolean, boolean] };
    expect(takePlan(table({ ...open, mine: "6♠ 2♦ 9♥ 9♦", pileOf: "4♦ 6♣" }), 0)).toHaveProperty("groups");
    expect(takePlan(table({ ...open, mine: "4♠ 9♥ 9♦", pileOf: "4♦ 6♣", melds: [[{ rank: 6, cards: hand("6♥ 6♦ 6♠") }], []] }), 0)).toHaveProperty("groups");
    // A wild card in the pile freezes it for everyone.
    expect(takePlan(table({ ...open, mine: "6♠ 2♦ 9♥ 9♦", pileOf: "2♥ 6♣" }), 0)).toEqual({ error: expect.stringContaining("frozen") });
  });

  it("opening needs 50: taking the pile counts its top card and your melds", () => {
    // Three sixes are 15: not enough. With a joker on them (65) it is; the kings stay in hand.
    expect(takePlan(table({ mine: "6♠ 6♥ 9♥ 9♦", pileOf: "4♦ 6♣" }), 0)).toEqual({ error: expect.stringContaining("needs 50") });
    const s = table({ mine: "6♠ 6♥ K♠ K♥ K♦ JK 9♦ 4♣", pileOf: "4♦ 6♣" });
    expect(takePlan(s, 0)).toHaveProperty("groups");
    const after = canasta.apply(s, 0, { type: "take" });
    expect(after.opened[0]).toBe(true);
    expect(after.melds[0].map((m) => [m.rank, m.cards.length])).toEqual([[6, 4]]);
    expect(after.hands[0].map((c) => c.id.split("#")[0]).sort()).toEqual(["4♣", "4♦", "9♦", "K♠", "K♥", "K♦"]);
  });

  it("first melds under the minimum can't be discarded on; they can be taken back", () => {
    let s = table({ phase: "meld", mine: "6♠ 6♥ 6♦ 9♥ 9♦" });
    s = canasta.apply(s, 0, { type: "meld", cards: ids(s.hands[0]!.slice(0, 3)) });
    expect(() => canasta.apply(s, 0, { type: "discard", cards: [s.hands[0]![0]!.id] })).toThrow("need 50");
    s = canasta.apply(s, 0, { type: "takeback" });
    expect(s.hands[0]).toHaveLength(5);
    expect(s.melds[0]).toEqual([]);
    expect(canasta.apply(s, 0, { type: "discard", cards: [s.hands[0]![0]!.id] }).turn).toBe(1);
    // With no minimums, any meld opens.
    let e = { ...table({ phase: "meld", mine: "6♠ 6♥ 6♦ 9♥ 9♦" }), rules: easyCanasta };
    e = canasta.apply(e, 0, { type: "meld", cards: ids(e.hands[0]!.slice(0, 3)) });
    expect(canasta.apply(e, 0, { type: "discard", cards: [e.hands[0]![0]!.id] }).opened[0]).toBe(true);
  });

  it("scores canastas, red threes, going out, melds and what's left in hand", () => {
    const s = table({
      phase: "meld",
      opened: [true, true],
      mine: "4♣",
      melds: [[{ rank: 9, cards: hand("9♠ 9♥ 9♦ 9♣ 9♠ 9♥ 9♦") }, { rank: 13, cards: hand("K♠ K♥ K♦ K♣ K♠ 2♦ JK") }], [{ rank: 5, cards: hand("5♣ 5♦ 5♥") }]],
      red3s: [hand("3♥"), hand("3♦ 3♥")],
    });
    const done = canasta.apply(s, 0, { type: "discard", cards: [s.hands[0]![0]!.id] });
    expect(done.phase).toBe("scored");
    const rows = done.lastHand!.rows;
    expect(rows.Canastas).toEqual([800, 0]);
    expect(rows["Red threes"]).toEqual([100, 200]);
    expect(rows["Going out"]).toEqual([100, 0]);
    // Nines 70; kings 50 + a two 20 + a joker 50. Theirs: three fives.
    expect(rows["Melded cards"]).toEqual([190, 15]);
    // Partner holds 7♠ 7♥ 8♦ (20); they hold 5♠ 5♥ 6♦ and 9♠ 9♦ 10♣ (15 + 30).
    expect(rows["Left in hand"]).toEqual([-20, -45]);
    expect(done.scores).toEqual([1170, 170]);
  });
});
