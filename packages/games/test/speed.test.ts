import { describe, expect, it } from "vitest";
import { classicSpeed, newSpeed, nextTo, speed, speedTargets, type KCard, type SpeedState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const at = (extra: Partial<SpeedState>): SpeedState => ({ ...newSpeed(classicSpeed, 2, 1), stuck: [false, false], idle: 0, ...extra }) as SpeedState;

describe("Speed", () => {
  it("deals 20 to draw, 5 in hand, 5 spares beside each middle pile", () => {
    const s = newSpeed(classicSpeed, 2, 3);
    expect(s.hands.map((h) => h.length)).toEqual([5, 5]);
    expect(s.draws.map((d) => d.length)).toEqual([15, 15]);
    expect(s.spares.map((d) => d.length)).toEqual([5, 5]);
    expect(s.piles.map((p) => p.length)).toEqual([1, 1]);
  });

  it("one higher or one lower; aces go next to kings and 2s", () => {
    expect(nextTo(card("7♠"), card("8♥"), true)).toBe(true);
    expect(nextTo(card("7♠"), card("9♥"), true)).toBe(false);
    expect(nextTo(card("A♠"), card("2♥"), true)).toBe(true);
    expect(nextTo(card("A♠"), card("K♥"), true)).toBe(true);
    expect(nextTo(card("A♠"), card("2♥"), false)).toBe(false);
  });

  it("no turns: either player plays, and the hand fills back to five", () => {
    let s = at({ piles: [cards("8♥"), cards("3♣")], hands: [cards("7♠ 9♦ K♠ K♣ K♥"), cards("2♦ 4♠ Q♣ Q♦ Q♥")], draws: [cards("5♠"), cards("6♠")] });
    expect(speedTargets(s, card("7♠"))).toEqual([0]);
    s = speed.apply(s, 1, { type: "play", card: "4♠" });
    s = speed.apply(s, 0, { type: "play", card: "9♦" });
    expect(s.piles.map((p) => p.at(-1)!.id)).toEqual(["9♦", "4♠"]);
    expect(s.hands[0]).toHaveLength(5);
    expect(() => speed.apply(s, 0, { type: "play", card: "K♠" })).toThrow("doesn't go");
  });

  it("both stuck: a spare goes onto each middle pile", () => {
    let s = at({ piles: [cards("8♥"), cards("3♣")], hands: [cards("K♠"), cards("Q♣")], draws: [[], []], spares: [cards("5♠"), cards("6♠")] });
    expect(() => speed.apply(s, 0, { type: "play", card: "K♠" })).toThrow();
    s = speed.apply(s, 0, { type: "stuck" });
    expect(s.piles[0]).toHaveLength(1);
    s = speed.apply(s, 1, { type: "stuck" });
    expect(s.piles.map((p) => p.at(-1)!.id)).toEqual(["5♠", "6♠"]);
  });

  it("first to play every card wins", () => {
    let s = at({ piles: [cards("8♥"), cards("3♣")], hands: [cards("7♠"), cards("Q♣")], draws: [[], cards("2♠")] });
    s = speed.apply(s, 0, { type: "play", card: "7♠" });
    expect(s.phase).toBe("finished");
    expect(speed.view(s, 1).over?.winners).toEqual([0]);
  });
});
