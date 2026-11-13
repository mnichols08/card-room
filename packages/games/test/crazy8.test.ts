import { describe, expect, it } from "vitest";
import { classicEights, crazy8, crazy8Legal, newCrazy8, partyEights, pointsEights, type Crazy8State, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const hand = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const at = (rules = classicEights, extra: Partial<Crazy8State>): Crazy8State => ({ ...newCrazy8(rules, 3, 1), turn: 0, ...extra }) as Crazy8State;

describe("Crazy Eights", () => {
  it("deals 7 each for two players and 5 for more, never starting on an eight", () => {
    expect(newCrazy8(classicEights, 2, 1).hands.map((h) => h.length)).toEqual([7, 7]);
    for (let seed = 0; seed < 30; seed++) {
      const s = newCrazy8(classicEights, 4, seed);
      expect(s.hands.map((h) => h.length)).toEqual([5, 5, 5, 5]);
      expect((s.discard[0] as { rank: number }).rank).not.toBe(8);
    }
  });

  it("match the suit or the rank, or play an eight and name the suit", () => {
    let s = at(classicEights, { discard: [card("7♥")], suit: "hearts", hands: [hand("3♥ 7♠ 8♣ K♦"), hand("2♦ 3♦"), hand("4♣ 5♣")], stock: hand("9♠ 9♦") });
    expect(crazy8Legal(s, 0).map((c) => c.id).sort()).toEqual(["3♥", "7♠", "8♣"].sort());
    expect(() => crazy8.apply(s, 0, { type: "play", card: "K♦" })).toThrow("Match");
    s = crazy8.apply(s, 0, { type: "play", card: "8♣" });
    expect(s.phase).toBe("suit");
    s = crazy8.apply(s, 0, { type: "suit", suit: "diamonds" });
    expect(s.suit).toBe("diamonds");
    expect(s.turn).toBe(1);
    expect(crazy8Legal(s, 1).map((c) => c.id)).toEqual(["2♦", "3♦"].filter((id) => s.hands[1]!.some((c) => c.id === id)));
  });

  it("can't play: draw (until you can, or one then pass)", () => {
    let s = at(classicEights, { discard: [card("7♥")], suit: "hearts", hands: [hand("2♠"), hand("3♦"), hand("4♣")], stock: hand("9♥ 5♣") });
    expect(() => crazy8.apply(s, 0, { type: "pass" })).toThrow();
    s = crazy8.apply(s, 0, { type: "draw" }); // 5♣: still nothing
    expect(s.turn).toBe(0);
    s = crazy8.apply(s, 0, { type: "draw" }); // 9♥ plays
    expect(crazy8Legal(s, 0).map((c) => c.id)).toEqual(["9♥"]);

    let one = at(partyEights, { discard: [card("7♥")], suit: "hearts", hands: [hand("2♠"), hand("3♦"), hand("4♣")], stock: hand("9♥ 5♣") });
    one = crazy8.apply(one, 0, { type: "draw" });
    expect(() => crazy8.apply(one, 0, { type: "draw" })).toThrow();
    one = crazy8.apply(one, 0, { type: "pass" });
    expect(one.turn).toBe(1);
  });

  it("party cards: a 2 makes the next player draw two, a queen skips, an ace reverses", () => {
    let s = at(partyEights, { discard: [card("7♥")], suit: "hearts", hands: [hand("2♥ Q♥ A♥ 4♠"), hand("3♦ 5♦"), hand("4♣ 6♣")], stock: hand("9♠ 9♦ 10♦ J♦") });
    s = crazy8.apply(s, 0, { type: "play", card: "2♥" });
    expect(s.owed).toBe(2);
    expect(() => crazy8.apply(s, 1, { type: "play", card: "3♦" })).toThrow("Draw 2");
    s = crazy8.apply(s, 1, { type: "draw" });
    expect(s.hands[1]).toHaveLength(4);
    expect(s.turn).toBe(2);
    s = { ...s, turn: 0 };
    s = crazy8.apply(s, 0, { type: "play", card: "Q♥" });
    expect(s.turn).toBe(2);
    s = { ...s, turn: 0, suit: "hearts", discard: [card("5♥")] };
    s = crazy8.apply(s, 0, { type: "play", card: "A♥" });
    expect(s.direction).toBe(-1);
    expect(s.turn).toBe(2);
  });

  it("going out wins; in a points game the winner scores what's left", () => {
    let s = at(pointsEights, { discard: [card("7♥")], suit: "hearts", hands: [hand("3♥"), hand("8♦ K♦"), hand("4♣ A♣")] });
    s = crazy8.apply(s, 0, { type: "play", card: "3♥" });
    expect(s.lastHand).toEqual({ winner: 0, points: 50 + 10 + 4 + 1, left: [0, 60, 5] });
    expect(s.scores[0]).toBe(65);
    expect(s.phase).toBe("scored");
    const single = crazy8.apply(at(classicEights, { discard: [card("7♥")], suit: "hearts", hands: [hand("3♥"), hand("8♦ K♦"), hand("4♣ A♣")] }), 0, { type: "play", card: "3♥" });
    expect(crazy8.summary(single)).toMatchObject({ over: true, winners: [0], order: [0, 2, 1] });
  });

  it("nobody can play and nothing to draw: after a full round the lowest hand wins", () => {
    let s = at(classicEights, { discard: [card("7♥")], suit: "hearts", hands: [hand("K♠"), hand("2♦"), hand("Q♣")], stock: [] });
    expect(() => crazy8.apply(s, 0, { type: "draw" })).toThrow();
    for (const seat of [0, 1, 2]) s = crazy8.apply(s, seat, { type: "pass" });
    expect(s.phase).toBe("finished");
    expect(crazy8.summary(s).winners).toEqual([1]);
  });

  it("only eights going round can't go on forever: the discards are shuffled back twice a hand at most", () => {
    // Everyone's stuck with cards that don't match; the only cards to draw are eights.
    let s = at(classicEights, { discard: [card("8♥"), card("8♠"), card("8♦"), card("8♣")], suit: "hearts", hands: [hand("K♠"), hand("2♦"), hand("Q♣")], stock: [] });
    for (let i = 0; i < 200 && s.phase === "playing"; i++) {
      const move = crazy8.bot(s, s.turn, { skill: 1, sloppy: 0 })!;
      s = crazy8.apply(s, s.turn, move);
      if (s.phase === "suit") s = crazy8.apply(s, s.turn, { type: "suit", suit: "hearts" });
    }
    expect(s.phase).toBe("finished");
    expect(s.reshuffles).toBe(2);
  });
});
