import { describe, expect, it } from "vitest";
import { classicFruit, fruitDeck, fruitLegal, fruitSalad, newFruitSalad, stackFruit, type FruitState, type KCard } from "../src/index.js";

let n = 0;
const fc = (fruit: string | null, face: number | string): KCard => ({ kind: "fruit", fruit, face, id: `${fruit ?? "wild"}-${face}-t${n++}` }) as KCard;
const at = (extra: Partial<FruitState>, rules = classicFruit): FruitState => ({ ...newFruitSalad(rules, 3, 1), turn: 0, direction: 1, owed: 0, drew: false, ...extra }) as FruitState;
const id = (s: FruitState, seat: number, fruit: string | null, face: number | string) => s.hands[seat]!.find((c) => (c as { fruit: string | null }).fruit === fruit && (c as { face: unknown }).face === face)!.id;

describe("Fruit Salad", () => {
  it("has 108 cards and deals seven each, starting on a number", () => {
    expect(fruitDeck()).toHaveLength(108);
    for (let seed = 0; seed < 20; seed++) {
      const s = newFruitSalad(classicFruit, 4, seed);
      expect(s.hands.every((h) => h.length === 7)).toBe(true);
      expect(typeof (s.discard[0] as { face: unknown }).face).toBe("number");
    }
  });

  it("match the fruit or the face; salads are wild and name the next fruit", () => {
    let s = at({ discard: [fc("cherry", 5)], fruit: "cherry", hands: [[fc("cherry", 2), fc("lemon", 5), fc("pear", 7), fc(null, "salad")], [fc("grape", 1), fc("grape", 3)], [fc("pear", 1)]], stock: [fc("pear", 9)] });
    expect(fruitLegal(s, 0).map((c) => (c as { face: unknown }).face).sort()).toEqual([2, 5, "salad"].sort());
    s = fruitSalad.apply(s, 0, { type: "play", card: id(s, 0, null, "salad") });
    expect(s.phase).toBe("fruit");
    s = fruitSalad.apply(s, 0, { type: "fruit", fruit: "grape" });
    expect(s.turn).toBe(1);
    expect(fruitLegal(s, 1)).toHaveLength(2);
  });

  it("Hop skips, Turn reverses, +2 makes the next player pick up and miss a go", () => {
    let s = at({ discard: [fc("cherry", 5)], fruit: "cherry", hands: [[fc("cherry", "hop"), fc("cherry", "turn"), fc("cherry", "plus2"), fc("pear", 1)], [fc("grape", 1)], [fc("pear", 2)]], stock: [fc("pear", 9), fc("pear", 8)] });
    s = fruitSalad.apply(s, 0, { type: "play", card: id(s, 0, "cherry", "hop") });
    expect(s.turn).toBe(2);
    s = { ...s, turn: 0 };
    s = fruitSalad.apply(s, 0, { type: "play", card: id(s, 0, "cherry", "turn") });
    expect(s.direction).toBe(-1);
    expect(s.turn).toBe(2);
    s = { ...s, turn: 0, direction: 1 };
    s = fruitSalad.apply(s, 0, { type: "play", card: id(s, 0, "cherry", "plus2") });
    expect(s.hands[1]).toHaveLength(3);
    expect(s.turn).toBe(2);
  });

  it("stacking passes the pick-up on", () => {
    let s = at({ discard: [fc("cherry", 5)], fruit: "cherry", hands: [[fc("cherry", "plus2"), fc("pear", 1), fc("pear", 3)], [fc("lemon", "plus2"), fc("grape", 1)], [fc("pear", 2)]], stock: [fc("pear", 9), fc("pear", 8), fc("pear", 7), fc("pear", 6)] }, stackFruit);
    s = fruitSalad.apply(s, 0, { type: "play", card: id(s, 0, "cherry", "plus2") });
    expect(s.turn).toBe(1);
    expect(fruitLegal(s, 1)).toHaveLength(1);
    s = fruitSalad.apply(s, 1, { type: "play", card: id(s, 1, "lemon", "plus2") });
    expect(s.owed).toBe(4);
    s = fruitSalad.apply(s, 2, { type: "draw" });
    expect(s.hands[2]).toHaveLength(5);
    expect(s.turn).toBe(0);
  });

  it("forget \"Last bite!\" and pick up two; first out wins", () => {
    const base = { discard: [fc("cherry", 5)], fruit: "cherry" as const, stock: [fc("pear", 9), fc("pear", 8), fc("pear", 7)] };
    let s = at({ ...base, hands: [[fc("cherry", 2), fc("cherry", 3)], [fc("grape", 1)], [fc("pear", 2)]] });
    s = fruitSalad.apply(s, 0, { type: "play", card: id(s, 0, "cherry", 2) });
    expect(s.hands[0]).toHaveLength(3);
    s = at({ ...base, hands: [[fc("cherry", 2), fc("cherry", 3)], [fc("grape", 1)], [fc("pear", 2)]] });
    s = fruitSalad.apply(s, 0, { type: "bite" });
    s = fruitSalad.apply(s, 0, { type: "play", card: id(s, 0, "cherry", 2) });
    expect(s.hands[0]).toHaveLength(1);
    s = { ...s, turn: 0 };
    s = fruitSalad.apply(s, 0, { type: "play", card: id(s, 0, "cherry", 3) });
    expect(s.phase).toBe("finished");
    expect(fruitSalad.view(s, 1).over?.winners).toEqual([0]);
  });

  it("can't play: draw one, and the go passes if it doesn't fit", () => {
    let s = at({ discard: [fc("cherry", 5)], fruit: "cherry", hands: [[fc("pear", 1), fc("pear", 2)], [fc("grape", 1)], [fc("pear", 3)]], stock: [fc("grape", 9)] });
    s = fruitSalad.apply(s, 0, { type: "draw" });
    expect(s.hands[0]).toHaveLength(3);
    expect(s.turn).toBe(1);
  });
});
