import { describe, expect, it } from "vitest";
import { available, newPyramid, pyramid, pyramidClassic, pyramidHard, type KCard, type PyramidState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};

describe("Pyramid", () => {
  it("deals 28 into seven rows; only the bottom row is free", () => {
    const s = newPyramid(pyramidClassic, 1, 2);
    expect(s.rows.flat()).toHaveLength(28);
    expect(s.stock).toHaveLength(24);
    expect(available(s)).toHaveLength(7);
  });

  it("pairs make 13; kings go alone; a cleared pair frees the card above", () => {
    const base = newPyramid(pyramidClassic, 1, 2);
    const rows = base.rows.map((r) => r.map(() => null as KCard | null));
    rows[5]![0] = card("5♠");
    rows[6]![0] = card("6♥");
    rows[6]![1] = card("7♣");
    rows[6]![2] = card("K♦");
    let s = { ...base, rows, stock: [card("8♥")], waste: [] } as PyramidState;
    expect(available(s).map((c) => c.id)).toEqual(["6♥", "7♣", "K♦"]);
    s = pyramid.apply(s, 0, { type: "pick", card: "K♦" });
    expect(s.rows[6]![2]).toBeNull();
    s = pyramid.apply(s, 0, { type: "pick", card: "6♥" });
    s = pyramid.apply(s, 0, { type: "pick", card: "7♣" });
    expect(available(s).map((c) => c.id)).toEqual(["5♠"]);
    s = pyramid.apply(s, 0, { type: "draw" });
    s = pyramid.apply(s, 0, { type: "pick", card: "5♠" });
    s = pyramid.apply(s, 0, { type: "pick", card: "8♥" });
    expect(s.phase).toBe("finished");
    expect(pyramid.view(s, 0).over?.winners).toEqual([0]);
  });

  it("only so many times through the stock", () => {
    let s = { ...newPyramid(pyramidHard, 1, 2), stock: [card("2♠")], waste: [] } as PyramidState;
    s = pyramid.apply(s, 0, { type: "draw" });
    expect(() => pyramid.apply(s, 0, { type: "draw" })).toThrow("No more");
  });
});
