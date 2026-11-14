import { describe, expect, it } from "vitest";
import { klondike, klondikeOne, klondikeThree, newKlondike, type KCard, type KlondikeState } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const col = (down: string, up: string) => ({ down: cards(down), up: cards(up) });
const empty = () => col("", "");

function table(over: Partial<KlondikeState> = {}): KlondikeState {
  return { ...newKlondike(klondikeOne, 1, 1), columns: [empty(), empty(), empty(), empty(), empty(), empty(), empty()], stock: [], waste: [], foundations: [[], [], [], []], history: [], ...over };
}
const named = (cs: KCard[]) => cs.map((c) => c.id.split("#")[0]);

describe("Klondike", () => {
  it("deals seven columns of one to seven, the top of each face up, and 24 in the stock", () => {
    const s = newKlondike(klondikeOne, 1, 5);
    expect(s.columns.map((c) => c.down.length + c.up.length)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(s.columns.every((c) => c.up.length === 1)).toBe(true);
    expect(s.stock).toHaveLength(24);
  });

  it("turns one or three from the stock, and turns the pile over when it's empty", () => {
    let s = table({ stock: cards("2♠ 3♠ 4♠ 5♠") });
    s = klondike.apply(s, 0, { type: "draw" });
    expect(named(s.waste)).toEqual(["5♠"]);
    let t = { ...table({ stock: cards("2♠ 3♠ 4♠ 5♠") }), rules: klondikeThree };
    t = klondike.apply(t, 0, { type: "draw" });
    expect(named(t.waste)).toEqual(["5♠", "4♠", "3♠"]);
    t = klondike.apply(t, 0, { type: "draw" });
    t = klondike.apply(t, 0, { type: "draw" });
    expect(t.stock).toHaveLength(4);
    expect(t.passes).toBe(1);
  });

  it("a tapped card goes home first, then onto a column of the other colour one higher", () => {
    let s = table({ waste: cards("A♥"), columns: [col("", "8♠"), empty(), empty(), empty(), empty(), empty(), empty()] });
    s = klondike.apply(s, 0, { type: "auto", card: s.waste[0]!.id });
    expect(named(s.foundations[1]!)).toEqual(["A♥"]);
    s = { ...s, waste: cards("7♦") };
    s = klondike.apply(s, 0, { type: "auto", card: s.waste[0]!.id });
    expect(named(s.columns[0]!.up)).toEqual(["8♠", "7♦"]);
    s = { ...s, waste: cards("7♥ 7♣") };
    expect(() => klondike.apply(s, 0, { type: "auto", card: s.waste[1]!.id })).toThrow("nowhere to go");
  });

  it("a run moves together, and the card under it turns over", () => {
    let s = table({ columns: [col("2♣", "9♥ 8♠ 7♥"), col("", "10♣"), empty(), empty(), empty(), empty(), empty()] });
    s = klondike.apply(s, 0, { type: "auto", card: s.columns[0]!.up[0]!.id });
    expect(named(s.columns[1]!.up)).toEqual(["10♣", "9♥", "8♠", "7♥"]);
    expect(named(s.columns[0]!.up)).toEqual(["2♣"]);
  });

  it("only a king goes in an empty column", () => {
    let s = table({ columns: [col("3♦", "K♠"), col("", "Q♥"), empty(), empty(), empty(), empty(), empty()] });
    s = klondike.apply(s, 0, { type: "auto", card: s.columns[0]!.up[0]!.id });
    expect(named(s.columns[2]!.up)).toEqual(["K♠"]);
    expect(() => klondike.apply({ ...s, waste: cards("J♦") }, 0, { type: "auto", card: "x" })).toThrow("can't move");
  });

  it("undo takes a move back", () => {
    let s = table({ waste: cards("A♥"), stock: cards("5♣") });
    s = klondike.apply(s, 0, { type: "auto", card: s.waste[0]!.id });
    s = klondike.apply(s, 0, { type: "draw" });
    expect(s.history).toHaveLength(2);
    s = klondike.apply(s, 0, { type: "undo" });
    expect(named(s.stock)).toEqual(["5♣"]);
    s = klondike.apply(s, 0, { type: "undo" });
    expect(named(s.waste)).toEqual(["A♥"]);
    expect(s.foundations[1]).toHaveLength(0);
    expect(() => klondike.apply(s, 0, { type: "undo" })).toThrow("Nothing");
  });

  it("Finish sends everything home once it's all face up, and that's a win", () => {
    const suit = (s: string) => "A 2 3 4 5 6 7 8 9 10 J Q".split(" ").map((r) => `${r}${s}`).join(" ");
    const s = table({ foundations: [cards(suit("♠")), cards(suit("♥")), cards(suit("♦")), cards(suit("♣"))], columns: [col("", "K♠ K♥"), col("", "K♦ K♣"), empty(), empty(), empty(), empty(), empty()] });
    // Only the bottom card of each column can go first: K♥ then K♠, K♣ then K♦.
    const done = klondike.apply(s, 0, { type: "finish" });
    expect(done.won).toBe(true);
    expect(klondike.view(done, 0).over?.winners).toEqual([0]);
  });

  it("giving up ends the game with no winner", () => {
    const done = klondike.apply(newKlondike(klondikeOne, 1, 2), 0, { type: "resign" });
    expect(klondike.summary(done)).toMatchObject({ over: true, winners: [] });
  });

  it("a dragged card goes where you put it, not where a tap would send it", () => {
    // A tap would put the 7♦ on the first black 8; dragged, it goes on the second.
    let s = table({ waste: cards("7♦"), columns: [col("", "8♠"), col("", "8♣"), empty(), empty(), empty(), empty(), empty()] });
    s = klondike.apply(s, 0, { type: "move", card: s.waste[0]!.id, to: "column", index: 1 });
    expect(named(s.columns[1]!.up)).toEqual(["8♣", "7♦"]);
    expect(named(s.columns[0]!.up)).toEqual(["8♠"]);
    // An ace that could go home can be kept on a column instead... if it fits there.
    s = { ...s, waste: cards("A♥") };
    expect(() => klondike.apply(s, 0, { type: "move", card: s.waste[0]!.id, to: "column", index: 0 })).toThrow("doesn't go on the 8♠");
    expect(() => klondike.apply(s, 0, { type: "move", card: s.waste[0]!.id, to: "column", index: 4 })).toThrow("Only a king");
    expect(() => klondike.apply(s, 0, { type: "move", card: s.waste[0]!.id, to: "column", index: 9 })).toThrow("not a place");
    s = klondike.apply(s, 0, { type: "move", card: s.waste[0]!.id, to: "foundation" });
    expect(named(s.foundations[1]!)).toEqual(["A♥"]);
  });

  it("a dragged run moves together onto a column, but only one card goes home at a time", () => {
    let s = table({ columns: [col("2♣", "9♥ 8♠"), col("", "10♣"), col("", "10♠"), empty(), empty(), empty(), empty()] });
    const nine = s.columns[0]!.up[0]!.id;
    expect(() => klondike.apply(s, 0, { type: "move", card: nine, to: "foundation" })).toThrow("one card");
    expect(() => klondike.apply(s, 0, { type: "move", card: nine, to: "column", index: 0 })).toThrow("already there");
    s = klondike.apply(s, 0, { type: "move", card: nine, to: "column", index: 2 });
    expect(named(s.columns[2]!.up)).toEqual(["10♠", "9♥", "8♠"]);
    expect(named(s.columns[0]!.up)).toEqual(["2♣"]);
    expect(klondike.apply(s, 0, { type: "undo" }).columns[0]!.up).toHaveLength(2);
  });
});
