import { describe, expect, it } from "vitest";
import { classicGolf, golf, gridScore, newGolf, plainGolf, type GolfState, type KCard } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => ids.split(" ").map(card);
const all = (s: GolfState, seat: number) => s.up[seat]!.map(() => true);

/** Two players, both flipped in, seat 0 to play. */
function table(over: Partial<GolfState> = {}): GolfState {
  const s = newGolf(classicGolf, 2, 1);
  return { ...s, phase: "draw", turn: 0, up: [[true, true, false, false, false, false], [true, true, false, false, false, false]], ...over };
}

describe("Golf", () => {
  it("deals six each, face down, and everyone flips two to start", () => {
    let s = newGolf(classicGolf, 3, 4);
    expect(s.grids.map((g) => g.length)).toEqual([6, 6, 6]);
    expect(s.phase).toBe("flipping");
    for (const seat of [0, 1, 2]) for (const i of [0, 4]) s = golf.apply(s, seat, { type: "flip", index: i });
    expect(s.phase).toBe("draw");
    expect(() => golf.apply(newGolf(classicGolf, 2, 4), 0, { type: "draw" })).toThrow("Flip two");
  });

  it("scores: ace 1, two −2, king 0, faces 10, and a pair in a column is nothing", () => {
    expect(gridScore(cards("A♠ 2♥ K♦ 5♣ 7♠ Q♥"), classicGolf)).toBe(1 + 5 + -2 + 7 + 0 + 10);
    expect(gridScore(cards("9♠ 2♥ 4♦ 9♣ 3♠ 4♥"), classicGolf)).toBe(0 + (-2 + 3) + 0);
    expect(gridScore(cards("A♠ 2♥ K♦ 5♣ 7♠ Q♥"), plainGolf)).toBe(1 + 5 + 2 + 7 + 10 + 10);
  });

  it("take the top discard and swap it in; the old card goes on the pile face up", () => {
    const s = table({ pile: cards("3♦") });
    let t = golf.apply(s, 0, { type: "take" });
    expect(() => golf.apply(t, 0, { type: "discard" })).toThrow("has to go in your grid");
    const old = t.grids[0]![4]!;
    t = golf.apply(t, 0, { type: "swap", index: 4 });
    expect(t.grids[0]![4]!.id.split("#")[0]).toBe("3♦");
    expect(t.up[0]![4]).toBe(true);
    expect(t.pile.at(-1)!.id).toBe(old.id);
    expect(t.turn).toBe(1);
  });

  it("a stock card can be thrown away, and then you flip one of yours", () => {
    let t = golf.apply(table(), 0, { type: "draw" });
    t = golf.apply(t, 0, { type: "discard" });
    expect(t.phase).toBe("flip");
    expect(() => golf.apply(t, 0, { type: "flip", index: 0 })).toThrow("face-down");
    t = golf.apply(t, 0, { type: "flip", index: 5 });
    expect(t.up[0]![5]).toBe(true);
    expect(t.turn).toBe(1);
  });

  it("all six up ends the hole after everyone else has one more turn", () => {
    const s = table({ up: [[true, true, true, true, true, false], [true, true, false, false, false, false]], scores: [0, 0] });
    let t = golf.apply(s, 0, { type: "draw" });
    t = golf.apply(t, 0, { type: "swap", index: 5 });
    expect(t.closer).toBe(0);
    expect(t.phase).toBe("draw");
    t = golf.apply(t, 1, { type: "draw" });
    t = golf.apply(t, 1, { type: "swap", index: 2 });
    expect(t.phase).toBe("scored");
    expect(t.up.every((u) => u.every(Boolean))).toBe(true);
    expect(t.scores).toEqual(t.grids.map((g) => gridScore(g, classicGolf)));
  });

  it("after the last hole the lowest total wins", () => {
    const s = table({ hand: 8, up: [[true, true, true, true, true, false], all(table(), 1)], scores: [100, -50], closer: null });
    let t = golf.apply(s, 0, { type: "draw" });
    t = golf.apply(t, 0, { type: "swap", index: 5 });
    // Seat 1 still gets their last turn.
    expect(t.phase).toBe("draw");
    t = golf.apply(t, 1, { type: "draw" });
    t = golf.apply(t, 1, { type: "swap", index: 0 });
    expect(t.phase).toBe("finished");
    expect(golf.view(t, 0).over?.winners).toEqual([1]);
  });
});
