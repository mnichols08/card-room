import { describe, expect, it } from "vitest";
import { cardTargets, classicKings, kingsCorner, newKings, pileTargets, type KCard, type KingsState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const at = (extra: Partial<KingsState>): KingsState =>
  ({ ...newKings(classicKings, 2, 1), turn: 0, held: null, heldPile: null, played: false, idle: 0, ...extra }) as KingsState;
const piles = (...p: string[]) => [...p, "", "", "", ""].slice(0, 8).map(cards);

describe("Kings in the Corner", () => {
  it("deals seven each, four side cards, no kings on the sides, and the first player draws", () => {
    for (let seed = 0; seed < 30; seed++) {
      const s = newKings(classicKings, 3, seed);
      expect(s.piles.slice(0, 4).every((p) => p.length === 1 && (p[0] as { rank: number }).rank !== 13)).toBe(true);
      expect(s.hands[s.turn]).toHaveLength(8);
      expect(s.hands.reduce((n, h) => n + h.length, 0) + s.stock.length + s.piles.flat().length).toBe(52);
    }
  });

  it("build down in the other colour; kings go to a corner", () => {
    let s = at({ piles: piles("7♠", "9♥", "2♣", "J♦"), hands: [cards("6♥ 6♠ K♣ 3♦"), cards("5♣")], stock: cards("4♠") });
    expect(cardTargets(s, card("6♥"))).toEqual([0]);
    expect(cardTargets(s, card("6♠"))).toEqual([]);
    expect(cardTargets(s, card("K♣"))).toEqual([4]);
    s = kingsCorner.apply(s, 0, { type: "play", card: "6♥" });
    expect(s.piles[0]!.map((c) => c.id)).toEqual(["7♠", "6♥"]);
    s = kingsCorner.apply(s, 0, { type: "play", card: "K♣" });
    expect(s.piles[4]!.map((c) => c.id)).toEqual(["K♣"]);
    expect(() => kingsCorner.apply(s, 0, { type: "play", card: "6♠" })).toThrow("needs a 7");
  });

  it("move a whole pile onto another, then fill the space with anything", () => {
    let s = at({ piles: piles("8♠ 7♥", "9♥", "2♣", "J♦"), hands: [cards("4♠ 5♦"), cards("5♣")], stock: cards("4♣") });
    expect(pileTargets(s, 0)).toEqual([1]);
    s = kingsCorner.apply(s, 0, { type: "pile", card: "8♠" });
    expect(s.piles[1]!.map((c) => c.id)).toEqual(["9♥", "8♠", "7♥"]);
    expect(s.piles[0]).toEqual([]);
    expect(cardTargets(s, card("5♦"))).toEqual([0]);
  });

  it("a card that fits two places asks where", () => {
    let s = at({ piles: piles("7♠", "7♣", "2♣", "J♦"), hands: [cards("6♥ 3♦"), cards("5♣")], stock: cards("4♣") });
    s = kingsCorner.apply(s, 0, { type: "play", card: "6♥" });
    expect(s.held).toBe("6♥");
    expect(kingsCorner.view(s, 0).choices?.options.map((o) => o.label)).toEqual(["On the 7♠", "On the 7♣", "Cancel"]);
    s = kingsCorner.apply(s, 0, { type: "to", pile: 1 });
    expect(s.piles[1]!.map((c) => c.id)).toEqual(["7♣", "6♥"]);
  });

  it("ending the turn: the next player draws; first out wins", () => {
    let s = at({ piles: piles("7♠", "9♥", "2♣", "J♦"), hands: [cards("6♥ 3♦"), cards("5♣")], stock: cards("4♣") });
    s = kingsCorner.apply(s, 0, { type: "end" });
    expect(s.turn).toBe(1);
    expect(s.hands[1]!.map((c) => c.id).sort()).toEqual(["4♣", "5♣"]);
    s = { ...s, turn: 0, hands: [cards("6♥"), s.hands[1]!] };
    s = kingsCorner.apply(s, 0, { type: "play", card: "6♥" });
    expect(s.phase).toBe("finished");
    expect(kingsCorner.view(s, 1).over?.winners).toEqual([0]);
  });

  it("nobody can play and nothing to draw: the fewest points wins", () => {
    let s = at({ piles: piles("7♠", "9♥", "2♣", "J♦", "K♣", "K♠", "K♥", "K♦"), hands: [cards("3♥ 4♥"), cards("8♣")], stock: [] });
    s = kingsCorner.apply(s, 0, { type: "end" });
    s = kingsCorner.apply(s, 1, { type: "end" });
    expect(s.phase).toBe("finished");
    expect(s.lastHand!.winner).toBe(1);
  });
});
