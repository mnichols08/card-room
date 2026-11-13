import { describe, expect, it } from "vitest";
import { classicPresident, newPresident, president, title, type KCard, type PresidentState } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const ids = (s: PresidentState, seat: number, want: string) => want.split(" ").map((w) => s.hands[seat]!.find((c) => c.id.startsWith(w + "#"))!.id);
const names = (cs: KCard[]) => cs.map((c) => c.id.split("#")[0]);

function table(hands: string[], over: Partial<PresidentState> = {}): PresidentState {
  const s = newPresident(classicPresident, hands.length, 1);
  return { ...s, phase: "playing", hands: hands.map(cards), pile: [], lastPlayer: null, count: 0, passed: hands.map(() => false), finished: [], turn: 0, ...over };
}

describe("President", () => {
  it("deals every card, and the 3♣ leads the first hand", () => {
    const s = newPresident(classicPresident, 5, 3);
    expect(s.hands.flat()).toHaveLength(52);
    expect(names(s.hands[s.turn]!)).toContain("3♣");
  });

  it("titles: President, Vice President, Citizens, Vice Scum, Scum", () => {
    expect([0, 1, 2, 3, 4].map((p) => title(p, 5))).toEqual(["President", "Vice President", "Citizen", "Vice Scum", "Scum"]);
    expect([0, 1, 2].map((p) => title(p, 3))).toEqual(["President", "Citizen", "Scum"]);
  });

  it("each play beats the last with the same number of a higher rank", () => {
    let s = table(["9♠ 9♥ 4♦", "8♣ 8♦ J♣ J♥ 5♠", "Q♠ 3♦"]);
    s = president.apply(s, 0, { type: "play", cards: ids(s, 0, "9♠ 9♥") });
    expect(() => president.apply(s, 1, { type: "play", cards: ids(s, 1, "8♣ 8♦") })).toThrow("higher");
    expect(() => president.apply(s, 1, { type: "play", cards: ids(s, 1, "J♣") })).toThrow("2 cards");
    expect(() => president.apply(s, 1, { type: "play", cards: ids(s, 1, "J♣ 5♠") })).toThrow("one rank");
    s = president.apply(s, 1, { type: "play", cards: ids(s, 1, "J♣ J♥") });
    expect(s.lastPlayer).toBe(1);
    expect(s.turn).toBe(2);
  });

  it("a pass sits you out until the pile clears; then the last player leads", () => {
    let s = table(["9♠ 4♦ 5♦", "J♣ 5♠ 6♠", "Q♠ 3♦ 7♦"]);
    s = president.apply(s, 0, { type: "play", cards: ids(s, 0, "9♠") });
    s = president.apply(s, 1, { type: "play", cards: ids(s, 1, "J♣") });
    s = president.apply(s, 2, { type: "pass" });
    s = president.apply(s, 0, { type: "pass" });
    // Everyone else passed: seat 1 played last, so the pile clears and seat 1 leads.
    expect(s.pile).toEqual([]);
    expect(s.turn).toBe(1);
    expect(s.passed).toEqual([false, false, false]);
    expect(() => president.apply(s, 1, { type: "pass" })).toThrow("leading");
  });

  it("a two (the top card) clears the pile at once and the player leads again", () => {
    let s = table(["9♠ 4♦", "2♣ 5♠", "Q♠ 3♦"]);
    s = president.apply(s, 0, { type: "play", cards: ids(s, 0, "9♠") });
    s = president.apply(s, 1, { type: "play", cards: ids(s, 1, "2♣") });
    expect(s.pile).toEqual([]);
    expect(s.turn).toBe(1);
  });

  it("going out sets the places, and points go by place", () => {
    let s = table(["9♠", "J♣ 5♠", "Q♠ 3♦"]);
    s = president.apply(s, 0, { type: "play", cards: ids(s, 0, "9♠") });
    expect(s.finished).toEqual([0]);
    s = president.apply(s, 1, { type: "play", cards: ids(s, 1, "J♣") });
    s = president.apply(s, 2, { type: "play", cards: ids(s, 2, "Q♠") });
    s = president.apply(s, 1, { type: "pass" });
    // Seat 2 leads the cleared pile and goes out; seat 1 is left holding cards: Scum.
    s = president.apply(s, 2, { type: "play", cards: ids(s, 2, "3♦") });
    expect(s.phase).toBe("scored");
    expect(s.places).toEqual([0, 2, 1]);
    expect(s.scores).toEqual([2, 0, 1]);
  });

  it("the swap: the Scum's best two go to the President, who gives two back", () => {
    let s = newPresident(classicPresident, 4, 7);
    s = { ...s, phase: "scored", places: [3, 0, 1, 2], ready: [false, false, false, false] };
    for (const seat of [0, 1, 2, 3]) s = president.apply(s, seat, { type: "next" });
    expect(s.phase).toBe("swap");
    expect(s.owes).toEqual([0, 2, 1, 0]);
    // The Scum (seat 0) lost their two best cards to the President (seat 1).
    expect(s.hands[0]).toHaveLength(11);
    expect(s.hands[1]).toHaveLength(15);
    expect(s.turn).toBe(0);
    s = president.apply(s, 1, { type: "give", cards: s.hands[1]!.slice(0, 2).map((c) => c.id) });
    s = president.apply(s, 2, { type: "give", cards: s.hands[2]!.slice(0, 1).map((c) => c.id) });
    expect(s.phase).toBe("playing");
    expect(s.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
  });
});
