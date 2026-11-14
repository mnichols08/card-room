import { describe, expect, it } from "vitest";
import { classicSlap, doublesSlap, newSlapjack, slapjack, slappable, type KCard, type SlapjackState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const at = (decks: string[], extra: Partial<SlapjackState> = {}, rules = classicSlap): SlapjackState =>
  ({ ...newSlapjack(rules, decks.length, 1), decks: decks.map(cards), pile: [], turn: 0, phase: "flipping", hanging: decks.map(() => false), out: decks.map(() => false), flips: 0, ...extra }) as SlapjackState;

describe("Slapjack", () => {
  it("deals the whole deck face down", () => {
    const s = newSlapjack(classicSlap, 3, 2);
    expect(s.decks.map((d) => d.length)).toEqual([18, 17, 17]);
    expect(slapjack.view(s, 0).handHidden).toBe(true);
  });

  it("flip in turn; a jack opens the race, and the first slap takes the pile", () => {
    let s = at(["4♠ 9♣", "J♥ 2♦", "5♣ 6♣"]);
    s = slapjack.apply(s, 0, { type: "flip" });
    expect(s.turn).toBe(1);
    s = slapjack.apply(s, 1, { type: "flip" });
    expect(s.phase).toBe("slap");
    expect(slapjack.view(s, 2).choices?.options[0]!.label).toContain("Slap");
    s = slapjack.apply(s, 2, { type: "slap" });
    expect(s.decks[2]!.map((c) => c.id)).toEqual(["5♣", "6♣", "4♠", "J♥"]);
    expect(s.pile).toEqual([]);
    expect(s.turn).toBe(2);
    expect(() => slapjack.apply(s, 0, { type: "flip" })).toThrow();
  });

  it("slap at nothing and lose a card under the pile", () => {
    let s = at(["4♠ 9♣", "8♥ 2♦"]);
    s = slapjack.apply(s, 0, { type: "flip" });
    s = slapjack.apply(s, 1, { type: "slap" });
    expect(s.decks[1]!.map((c) => c.id)).toEqual(["2♦"]);
    expect(s.pile.map((c) => c.id)).toEqual(["8♥", "4♠"]);
  });

  it("doubles can be slapped as a house rule", () => {
    const s = at(["4♠", "4♣"], { pile: cards("9♦ 4♥ 4♠") }, doublesSlap);
    expect(slappable(s)).toBe(true);
    expect(slappable({ ...s, rules: classicSlap })).toBe(false);
  });

  it("out of cards: slap the next jack to get back in, or you're out", () => {
    let s = at(["4♠", "J♥ 2♦", "5♣ 6♣"]);
    s = slapjack.apply(s, 0, { type: "flip" });
    expect(s.hanging[0]).toBe(true);
    s = slapjack.apply(s, 1, { type: "flip" });
    s = slapjack.apply(s, 0, { type: "slap" });
    expect(s.decks[0]).toHaveLength(2);
    expect(s.hanging[0]).toBe(false);

    let t = at(["4♠", "J♥ 2♦", "5♣ 6♣"]);
    t = slapjack.apply(t, 0, { type: "flip" });
    t = slapjack.apply(t, 1, { type: "flip" });
    t = slapjack.apply(t, 2, { type: "slap" });
    expect(t.out[0]).toBe(true);
  });

  it("computer slappers react at the table's speed, whatever the pace", () => {
    const s = at(["4♠", "J♥"], { phase: "slap", pile: cards("J♥") });
    const ms = slapjack.reactionTime!(s, 1, { skill: 1 });
    expect(ms).toBeGreaterThan(600);
    expect(slapjack.reactionTime!({ ...s, phase: "flipping" }, 1, {})).toBeNull();
  });
});
