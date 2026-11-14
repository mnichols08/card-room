import { describe, expect, it } from "vitest";
import { newSpider, spider, spiderOne, spiderTwo, type KCard, type SpiderState } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}·t${n++}` } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const cols = (...c: string[]) => Array.from({ length: 10 }, (_, i) => ({ down: [] as KCard[], up: cards(c[i] ?? "") }));

describe("Spider", () => {
  it("deals 54 cards into ten columns and leaves five deals", () => {
    const s = newSpider(spiderTwo, 1, 3);
    expect(s.columns.reduce((t, c) => t + c.down.length + c.up.length, 0)).toBe(54);
    expect(s.stock).toHaveLength(50);
    expect(s.columns.every((c) => c.up.length === 1)).toBe(true);
  });

  it("builds down in any suit, but only one-suit runs move together", () => {
    let s = { ...newSpider(spiderOne, 1, 1), columns: cols("8♥", "9♠ 7♥ 6♥", "10♣ 9♠", "K♠") } as SpiderState;
    // 7♥ 6♥ can't move as a run? They're one suit: they go onto the 8♥.
    s = spider.apply(s, 0, { type: "auto", card: s.columns[1]!.up[1]!.id });
    expect(s.columns[0]!.up).toHaveLength(3);
    // 10♣ 9♠ is not one suit: the 10 can't take the 9 with it.
    expect(() => spider.apply(s, 0, { type: "auto", card: s.columns[2]!.up[0]!.id })).toThrow("one suit");
  });

  it("a full king-to-ace run of one suit goes home; eight runs win", () => {
    const run = "K♠ Q♠ J♠ 10♠ 9♠ 8♠ 7♠ 6♠ 5♠ 4♠ 3♠ 2♠";
    let s = { ...newSpider(spiderOne, 1, 1), columns: cols(run, "A♠"), home: Array(7).fill("spades"), stock: [] } as SpiderState;
    s = spider.apply(s, 0, { type: "auto", card: s.columns[1]!.up[0]!.id });
    expect(s.home).toHaveLength(8);
    expect(s.phase).toBe("finished");
    expect(spider.view(s, 0).over?.winners).toEqual([0]);
  });

  it("dealing needs every column filled; undo puts it back", () => {
    let s = { ...newSpider(spiderOne, 1, 1), columns: cols("8♥", "9♠", "", "K♠") } as SpiderState;
    expect(() => spider.apply(s, 0, { type: "deal" })).toThrow("empty column");
    s = { ...newSpider(spiderOne, 1, 2) } as SpiderState;
    const before = s.columns.map((c) => c.up.length);
    s = spider.apply(s, 0, { type: "deal" });
    expect(s.stock).toHaveLength(40);
    s = spider.apply(s, 0, { type: "undo" });
    expect(s.columns.map((c) => c.up.length)).toEqual(before);
  });
});
