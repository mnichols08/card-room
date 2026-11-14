import { describe, expect, it } from "vitest";
import { classicKingsCup, kingsCup, newKingsCup, type KCard, type KingsCupState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const at = (deck: string, extra: Partial<KingsCupState> = {}): KingsCupState => ({ ...newKingsCup(classicKingsCup, 3, 1), turn: 0, deck: deck.split(" ").map(card).reverse(), ...extra }) as KingsCupState;

describe("Kings Cup", () => {
  it("Me, Social and Waterfall drink at once", () => {
    let s = at("3♠ 6♥ A♣");
    s = kingsCup.apply(s, 0, { type: "draw" });
    expect(s.tally.drank).toEqual([2, 0, 0]);
    s = kingsCup.apply(s, 1, { type: "draw" });
    expect(s.tally.drank).toEqual([3, 1, 1]);
    s = kingsCup.apply(s, 2, { type: "draw" });
    expect(s.tally.drank).toEqual([6, 4, 4]);
  });

  it("You: pick someone; Mate: they drink with you", () => {
    let s = at("8♠ 2♥ 3♣");
    s = kingsCup.apply(s, 0, { type: "draw" });
    expect(() => kingsCup.apply(s, 0, { type: "pick", to: 0 })).toThrow();
    s = kingsCup.apply(s, 0, { type: "pick", to: 2 });
    expect(s.mates).toEqual([2, null, 0]);
    s = kingsCup.apply(s, 1, { type: "draw" });
    s = kingsCup.apply(s, 1, { type: "pick", to: 0 });
    expect(s.tally.drank).toEqual([2, 0, 2]);
  });

  it("the fourth king drinks the cup and ends it", () => {
    let s = at("K♠ K♥ K♦ K♣");
    for (let i = 0; i < 4; i++) s = kingsCup.apply(s, s.turn, { type: "draw" });
    expect(s.phase).toBe("finished");
    expect(s.loser).toBe(0);
    expect(kingsCup.view(s, 1).over?.winners).toEqual([1, 2]);
  });
});
