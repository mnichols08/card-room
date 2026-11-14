import { describe, expect, it } from "vitest";
import { freeCell, freeCellNew, maxRun, newFreeCell, type FreeCellState, type KCard } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const named = (cs: (KCard | null)[]) => cs.map((c) => (c ? c.id.split("#")[0] : null));

function table(columns: string[], over: Partial<FreeCellState> = {}): FreeCellState {
  return { ...newFreeCell(freeCellNew, 1, 1), columns: [...columns, ...Array(8 - columns.length).fill("")].map(cards), cells: [null, null, null, null], foundations: [[], [], [], []], history: [], ...over };
}

describe("FreeCell", () => {
  it("deals all 52 face up into eight columns of seven and six", () => {
    const s = newFreeCell(freeCellNew, 1, 9);
    expect(s.columns.map((c) => c.length)).toEqual([7, 7, 7, 7, 6, 6, 6, 6]);
  });

  it("the same deal number always deals the same game", () => {
    const a = newFreeCell({ ...freeCellNew, deal: 617 }, 1, 1);
    const b = newFreeCell({ ...freeCellNew, deal: 617 }, 1, 999);
    expect(a.dealNumber).toBe(617);
    expect(JSON.stringify(a.columns)).toBe(JSON.stringify(b.columns));
    expect(JSON.stringify(newFreeCell({ ...freeCellNew, deal: 618 }, 1, 1).columns)).not.toBe(JSON.stringify(a.columns));
  });

  it("a tapped card goes home, onto a column, into an empty column, or into a free cell", () => {
    let s = table(["5♠ A♥", "9♣ 8♦", "K♠ Q♥", "3♦ J♣"]);
    s = freeCell.apply(s, 0, { type: "auto", card: s.columns[0]![1]!.id });
    expect(named(s.foundations[1]!)).toEqual(["A♥"]);
    s = freeCell.apply(s, 0, { type: "auto", card: s.columns[3]![1]!.id });
    expect(named(s.columns[2]!)).toEqual(["K♠", "Q♥", "J♣"]);
    s = freeCell.apply(s, 0, { type: "auto", card: s.columns[1]![1]!.id });
    // The 8♦ has no column to go on: an empty one.
    expect(named(s.columns[4]!)).toEqual(["8♦"]);
    const full = table(["9♣ 8♦", "2♠ 7♥"], { columns: [cards("9♣ 8♦"), cards("2♠ 7♥"), cards("3♠"), cards("4♠"), cards("5♠"), cards("6♠"), cards("10♠"), cards("J♠")] });
    const parked = freeCell.apply(full, 0, { type: "auto", card: full.columns[1]![1]!.id });
    expect(named(parked.cells)).toEqual(["7♥", null, null, null]);
  });

  it("runs move together only with room: (free cells + 1) × 2 per empty column", () => {
    const s = table(["10♠ 9♥ 8♠ 7♥ 6♠", "J♥", "2♣", "3♣", "4♣", "5♣", "6♣", "7♣"], { cells: cards("A♦ 2♦ 3♦").concat([null]) as (KCard | null)[] });
    expect(maxRun(s, false)).toBe(2);
    expect(() => freeCell.apply(s, 0, { type: "auto", card: s.columns[0]![0]!.id })).toThrow("Not enough room");
    const roomy = { ...s, cells: [null, null, null, null] };
    expect(maxRun(roomy, false)).toBe(5);
    const moved = freeCell.apply(roomy, 0, { type: "auto", card: roomy.columns[0]![0]!.id });
    expect(named(moved.columns[1]!)).toEqual(["J♥", "10♠", "9♥", "8♠", "7♥", "6♠"]);
  });

  it("only a run moves together", () => {
    const s = table(["9♥ 8♠ 5♦", "10♣"]);
    expect(() => freeCell.apply(s, 0, { type: "auto", card: s.columns[0]![0]!.id })).toThrow("Only a run");
  });

  it("undo, finish once everything is in order, and giving up", () => {
    let s = table(["5♠ A♥"]);
    s = freeCell.apply(s, 0, { type: "auto", card: s.columns[0]![1]!.id });
    s = freeCell.apply(s, 0, { type: "undo" });
    expect(named(s.columns[0]!)).toEqual(["5♠", "A♥"]);
    const suit = (x: string) => "A 2 3 4 5 6 7 8 9 10 J".split(" ").map((r) => `${r}${x}`).join(" ");
    const ready = table(["K♠ Q♥", "K♥ Q♠", "K♦ Q♣", "K♣ Q♦"], { foundations: [cards(suit("♠")), cards(suit("♥")), cards(suit("♦")), cards(suit("♣"))] });
    const done = freeCell.apply(ready, 0, { type: "finish" });
    expect(done.won).toBe(true);
    expect(freeCell.summary(freeCell.apply(table(["5♠"]), 0, { type: "resign" }))).toMatchObject({ over: true, winners: [] });
  });

  it("a dragged card goes to the column, free cell or foundation you choose", () => {
    let s = table(["9♠ 5♥", "6♠", "6♣", ""]);
    const five = s.columns[0]![1]!.id;
    // A tap would take the first black 6; dragged, the 5♥ goes on the second.
    s = freeCell.apply(s, 0, { type: "move", card: five, to: "column", index: 2 });
    expect(named(s.columns[2]!)).toEqual(["6♣", "5♥"]);
    // Into the free cell you pick, and not one that's taken.
    s = freeCell.apply(s, 0, { type: "move", card: five, to: "cell", index: 3 });
    expect(named(s.cells)).toEqual([null, null, null, "5♥"]);
    const six = s.columns[1]![0]!.id;
    expect(() => freeCell.apply(s, 0, { type: "move", card: six, to: "cell", index: 3 })).toThrow("taken");
    expect(() => freeCell.apply(s, 0, { type: "move", card: six, to: "foundation" })).toThrow("can't go home yet");
    expect(() => freeCell.apply(s, 0, { type: "move", card: six, to: "column", index: 0 })).toThrow("doesn't go on the 9♠");
    // From a cell to an empty column.
    s = freeCell.apply(s, 0, { type: "move", card: five, to: "column", index: 3 });
    expect(named(s.columns[3]!)).toEqual(["5♥"]);
    expect(named(s.cells)).toEqual([null, null, null, null]);
  });

  it("a dragged run needs the same room a tapped one does", () => {
    const s = table(["9♠ 8♥ 7♠ 6♥", "10♦", "K♣", "K♠", "K♥", "K♦", "Q♣", "8♦"], { cells: [...cards("2♣ 3♣ 4♣"), null] });
    const nine = s.columns[0]![0]!.id;
    // One free cell and no empty column: two cards at most.
    expect(() => freeCell.apply(s, 0, { type: "move", card: nine, to: "column", index: 1 })).toThrow("Not enough room");
    expect(() => freeCell.apply(s, 0, { type: "move", card: nine, to: "cell", index: 3 })).toThrow("Only one card");
    const moved = freeCell.apply(s, 0, { type: "move", card: s.columns[0]![2]!.id, to: "column", index: 7 });
    expect(named(moved.columns[7]!)).toEqual(["8♦", "7♠", "6♥"]);
  });
});
