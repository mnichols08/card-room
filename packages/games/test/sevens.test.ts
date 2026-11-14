import { describe, expect, it } from "vitest";
import { classicSevens, drinkingSevens, newSevens, sevens, sevensLegal, type KCard, type SevensState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const at = (hands: string[], rows: Partial<SevensState["rows"]>, rules = classicSevens): SevensState =>
  ({ ...newSevens(rules, hands.length, 1), hands: hands.map(cards), rows: { clubs: null, diamonds: null, hearts: null, spades: null, ...rows }, turn: 0 }) as SevensState;

describe("Sevens", () => {
  it("deals the whole deck; the 7♦ starts", () => {
    const s = newSevens(classicSevens, 4, 2);
    expect(s.hands.flat()).toHaveLength(52);
    expect(sevensLegal(s, s.turn).map((c) => c.id)).toEqual(["7♦"]);
  });

  it("build out from each 7, both ways; must play if able", () => {
    let s = at(["6♦ 9♦ 7♠ A♣", "K♣ 2♣"], { diamonds: { low: 7, high: 8 } });
    expect(sevensLegal(s, 0).map((c) => c.id).sort()).toEqual(["6♦", "7♠", "9♦"].sort());
    expect(() => sevens.apply(s, 0, { type: "pass" })).toThrow("have to");
    s = sevens.apply(s, 0, { type: "play", card: "6♦" });
    expect(s.rows.diamonds).toEqual({ low: 6, high: 8 });
    expect(() => sevens.apply(s, 1, { type: "play", card: "K♣" })).toThrow();
    s = sevens.apply(s, 1, { type: "pass" });
    expect(s.turn).toBe(0);
  });

  it("the ace is low: it goes after the 2", () => {
    const s = at(["A♣"], { clubs: { low: 2, high: 7 } });
    expect(sevensLegal({ ...s, seats: 1 } as SevensState, 0)).toHaveLength(1);
  });

  it("first out wins; drinking mode hands out drinks", () => {
    let s = at(["8♦", "K♣ 2♣ 3♣"], { diamonds: { low: 7, high: 7 } }, drinkingSevens);
    s = sevens.apply(s, 0, { type: "play", card: "8♦" });
    expect(s.phase).toBe("finished");
    expect(s.narration).toContain("drinks 3");
    let p = at(["K♣", "8♦ 2♣"], { diamonds: { low: 7, high: 7 } }, drinkingSevens);
    p = sevens.apply(p, 0, { type: "pass" });
    expect(p.narration).toContain("drinks 1");
  });
});
