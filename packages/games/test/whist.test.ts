import { describe, expect, it } from "vitest";
import { honoursWhist, newWhist, shortWhist, whist, whistLegal, type KCard, type WhistState } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const hand = (ids: string) => (ids ? ids.split(" ").map(card) : []);

describe("Whist", () => {
  it("deals 13 each; the dealer's last card sets trump and the player on their left leads", () => {
    for (let seed = 1; seed < 10; seed++) {
      const s = newWhist(shortWhist, 4, seed);
      expect(s.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
      expect(s.hands[s.dealer]!.some((c) => c.id === s.turned.id)).toBe(true);
      expect(s.trump).toBe((s.turned as { suit: string }).suit);
      expect(s.turn).toBe((s.dealer + 1) % 4);
    }
  });

  it("follow suit if you can; otherwise anything, and the highest trump wins", () => {
    const s: WhistState = { ...newWhist(shortWhist, 4, 1), trump: "spades", turn: 1, hands: [hand("A♥"), hand("K♥ 2♠"), hand("3♠ 4♦"), hand("5♥")], trick: [{ seat: 0, card: card("Q♥") }] };
    expect(whistLegal(s, 1).map((c) => c.id.split("#")[0])).toEqual(["K♥"]);
    expect(() => whist.apply(s, 1, { type: "play", card: s.hands[1]![1]!.id })).toThrow("Follow");
    let t = whist.apply(s, 1, { type: "play", card: s.hands[1]![0]!.id });
    t = whist.apply(t, 2, { type: "play", card: t.hands[2]![0]!.id });
    t = whist.apply(t, 3, { type: "play", card: t.hands[3]![0]!.id });
    // The 3♠ trumped the K♥: seat 2's side takes it and seat 2 leads.
    expect(t.lastTrick!.winner).toBe(2);
    expect(t.tricks).toEqual([1, 0]);
    expect(t.turn).toBe(2);
  });

  it("scores one point per trick over six", () => {
    const s: WhistState = { ...newWhist(shortWhist, 4, 1), trump: "spades", turn: 0, hands: [hand("A♠"), hand("2♥"), hand("3♥"), hand("4♥")], trick: [], tricks: [8, 4] };
    let t = s;
    for (const seat of [0, 1, 2, 3]) t = whist.apply(t, seat, { type: "play", card: t.hands[seat]![0]!.id });
    expect(t.lastHand).toMatchObject({ tricks: [9, 4], odd: [3, 0] });
    expect(t.scores).toEqual([3, 0]);
    expect(t.phase).toBe("scored");
  });

  it("honours: four for all four, two for three, but never enough to reach game", () => {
    const base = { ...newWhist(honoursWhist, 4, 1), trump: "spades" as const, turn: 0, hands: [hand("A♠"), hand("2♥"), hand("3♥"), hand("4♥")], trick: [], tricks: [6, 6] as [number, number] };
    let t: WhistState = { ...base, honoursHeld: [4, 0] };
    for (const seat of [0, 1, 2, 3]) t = whist.apply(t, seat, { type: "play", card: t.hands[seat]![0]!.id });
    // 7 tricks: 1 over six, plus 4 for honours, capped at one under game (5): 1 + 3 = 4.
    expect(t.lastHand).toMatchObject({ odd: [1, 0], honours: [3, 0] });
    let u: WhistState = { ...base, honoursHeld: [1, 3] };
    for (const seat of [0, 1, 2, 3]) u = whist.apply(u, seat, { type: "play", card: u.hands[seat]![0]!.id });
    expect(u.lastHand).toMatchObject({ honours: [0, 2] });
  });

  it("first side to the target wins", () => {
    const s: WhistState = { ...newWhist(shortWhist, 4, 1), trump: "spades", turn: 0, hands: [hand("A♠"), hand("2♥"), hand("3♥"), hand("4♥")], trick: [], tricks: [7, 5], scores: [3, 2] };
    let t = s;
    for (const seat of [0, 1, 2, 3]) t = whist.apply(t, seat, { type: "play", card: t.hands[seat]![0]!.id });
    expect(t.phase).toBe("finished");
    expect(whist.view(t, 1).over?.winners).toEqual([0, 2]);
  });
});
