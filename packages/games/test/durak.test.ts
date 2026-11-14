import { describe, expect, it } from "vitest";
import { beats, classicDurak, durak, durakLegal, newDurak, type DurakState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
/** Three players, hearts trump, seat 0 attacking seat 1. */
function table(hands: string[], stock = ""): DurakState {
  const s = newDurak(classicDurak, hands.length, 1);
  return { ...s, hands: hands.map(cards), stock: cards(stock), trump: "hearts", trumpCard: card("6♥"), attacker: 0, defender: 1, turn: 0, table: [], done: hands.map(() => false), limit: 6, out: [], firstRound: false, discards: 0 } as DurakState;
}

describe("Durak", () => {
  it("deals six each from 36 cards and turns up trump; the lowest trump attacks", () => {
    const s = newDurak(classicDurak, 3, 4);
    expect(s.hands.map((h) => h.length)).toEqual([6, 6, 6]);
    expect(s.stock).toHaveLength(18);
    expect(s.stock.at(-1)).toEqual(s.trumpCard);
    const lows = s.hands.map((h) => Math.min(99, ...h.filter((c) => (c as { suit: string }).suit === s.trump).map((c) => (c as { rank: number }).rank)));
    expect(s.attacker).toBe(lows.indexOf(Math.min(...lows)));
  });

  it("beat with a higher card of the suit, or a trump", () => {
    expect(beats(card("9♠"), card("7♠"), "hearts")).toBe(true);
    expect(beats(card("6♠"), card("7♠"), "hearts")).toBe(false);
    expect(beats(card("6♥"), card("A♠"), "hearts")).toBe(true);
    expect(beats(card("7♥"), card("8♥"), "hearts")).toBe(false);
    expect(beats(card("A♣"), card("7♠"), "hearts")).toBe(false);
  });

  it("beaten off: the attackers throw in matching ranks, then the defender attacks next", () => {
    let s = table(["7♠ 9♣ K♦", "9♠ 9♥ A♦", "7♣ Q♣ 8♦"], "6♣ 8♣ 10♣ J♣ 6♦ 7♦");
    s = durak.apply(s, 0, { type: "play", card: "7♠" });
    expect(durakLegal(s, 1).map((c) => c.id).sort()).toEqual(["9♠", "9♥"].sort());
    s = durak.apply(s, 1, { type: "play", card: "9♠" });
    expect(s.turn).toBe(0);
    expect(durakLegal(s, 0).map((c) => c.id)).toEqual(["9♣"]);
    s = durak.apply(s, 0, { type: "done" });
    expect(s.turn).toBe(2);
    expect(durakLegal(s, 2).map((c) => c.id)).toEqual(["7♣"]);
    s = durak.apply(s, 2, { type: "play", card: "7♣" });
    s = durak.apply(s, 1, { type: "play", card: "9♥" });
    s = durak.apply(s, 0, { type: "done" });
    s = durak.apply(s, 2, { type: "done" });
    expect(s.attacker).toBe(1);
    expect(s.discards).toBe(4);
    // Refill: the attacker first, round the table, the defender last (and the stock runs out).
    expect(s.hands.map((h) => h.length)).toEqual([6, 1, 4]);
  });

  it("can't beat it: pick them all up, and the next player attacks", () => {
    let s = table(["7♠ 9♣ K♦", "6♠ 8♣ A♦", "7♣ Q♣ 8♦"]);
    s = durak.apply(s, 0, { type: "play", card: "7♠" });
    expect(durakLegal(s, 1)).toEqual([]);
    s = durak.apply(s, 1, { type: "take" });
    expect(s.hands[1]!.map((c) => c.id).sort()).toEqual(["6♠", "7♠", "8♣", "A♦"].sort());
    expect(s.attacker).toBe(2);
    expect(s.defender).toBe(0);
  });

  it("only ranks already on the table can be thrown in, up to the limit", () => {
    let s = table(["7♠ 7♦ K♦", "9♠ 8♦ A♦", "7♣ Q♣ 8♣"]);
    s = { ...s, limit: 2 };
    s = durak.apply(s, 0, { type: "play", card: "7♠" });
    s = durak.apply(s, 1, { type: "play", card: "9♠" });
    expect(() => durak.apply(s, 0, { type: "play", card: "K♦" })).toThrow("rank");
    s = durak.apply(s, 0, { type: "play", card: "7♦" });
    s = durak.apply(s, 1, { type: "play", card: "8♦" });
    expect(s.discards).toBe(4);
  });

  it("with the stock gone, empty your hand and you're safe; the last one holding cards is the durak", () => {
    let s = table(["7♠", "9♠ 8♦", "7♣ Q♣"]);
    s = durak.apply(s, 0, { type: "play", card: "7♠" });
    s = durak.apply(s, 1, { type: "play", card: "9♠" });
    s = durak.apply(s, 2, { type: "done" });
    expect(s.out).toContain(0);
    // Seat 1 attacks seat 2 with the 8♦; seat 2 can't beat it and picks up; then seat 1 is out.
    s = durak.apply(s, 1, { type: "play", card: "8♦" });
    s = durak.apply(s, 2, { type: "take" });
    expect(s.phase).toBe("finished");
    expect(s.durak).toBe(2);
    expect(durak.view(s, 0).over?.winners).toEqual([0, 1]);
  });
});
