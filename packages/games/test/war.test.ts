import { describe, expect, it } from "vitest";
import { littleWar, newWar, quickWar, war, longWar, type KCard, type WarState } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const pile = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const flipAll = (s: WarState) => s.decks.reduce((t, d, i) => (d.length && !t.ready[i] ? war.apply(t, i, { type: "flip" }) : t), s);

function table(decks: string[], over: Partial<WarState> = {}): WarState {
  const s = newWar(quickWar, decks.length, 1);
  return { ...s, decks: decks.map(pile), ready: decks.map((d) => !d), ...over };
}

describe("War", () => {
  it("deals the whole deck: 26 each for two, 17 or 18 for three", () => {
    expect(newWar(quickWar, 2, 4).decks.map((d) => d.length)).toEqual([26, 26]);
    expect(newWar(quickWar, 3, 4).decks.map((d) => d.length).sort()).toEqual([17, 17, 18]);
  });

  it("the battle waits until everyone has flipped, then the highest card takes them all", () => {
    const s = table(["K♠ 2♠", "9♥ 3♥"]);
    const one = war.apply(s, 0, { type: "flip" });
    expect(one.battles).toBe(0);
    expect(() => war.apply(one, 0, { type: "flip" })).toThrow("Waiting");
    const done = war.apply(one, 1, { type: "flip" });
    expect(done.decks.map((d) => d.length)).toEqual([3, 1]);
    expect(done.last!.winner).toBe(0);
    expect(done.narration).toBe("The K beats the 9: two cards to {0}");
  });

  it("a tie is war: three down, one up, and the winner takes all ten", () => {
    const s = table(["7♠ 2♠ 3♠ 4♠ A♠ 5♠", "7♥ 2♥ 3♥ 4♥ K♥ 6♥"]);
    const done = flipAll(s);
    expect(done.last).toMatchObject({ winner: 0, wars: 1, pot: 10 });
    expect(done.decks.map((d) => d.length)).toEqual([11, 1]);
  });

  it("short of cards in a war: you put down what you can and keep one to flip", () => {
    const s = table(["7♠ 2♠ 3♠ 4♠ 2♦ 5♠", "7♥ 9♥"]);
    const done = flipAll(s);
    // Seat 1 had only the 9 left after the tie: no cards down, the 9 flipped, against the 2♦ under three
    // cards down. Two sevens, three down, the 2♦ and the 9: seven cards.
    expect(done.last).toMatchObject({ winner: 1, wars: 1, pot: 7 });
    expect(done.decks.map((d) => d.length)).toEqual([1, 7]);
  });

  it("one card down on the Little war preset", () => {
    const s = { ...table(["7♠ 2♠ A♠", "7♥ 2♥ K♥"]), rules: littleWar };
    expect(flipAll(s).last).toMatchObject({ winner: 0, pot: 6 });
  });

  it("ends when someone has every card, or after the flip limit with the most cards", () => {
    const all = flipAll(table(["A♠", "2♥"]));
    expect(all.phase).toBe("finished");
    expect(war.view(all, 1).over?.winners).toEqual([0]);
    const limited = flipAll(table(["A♠ 2♠ 3♠", "2♥ 3♥ 4♥"], { battles: 49 }));
    expect(limited.phase).toBe("finished");
    expect(war.view(limited, 0).over?.winners).toEqual([0]);
    const open = flipAll({ ...table(["A♠ 2♠ 3♠", "2♥ 3♥ 4♥"], { battles: 49 }), rules: longWar });
    expect(open.phase).toBe("flipping");
  });
});
