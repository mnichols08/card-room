import { describe, expect, it } from "vitest";
import { bluff, classicBluff, claimable, looseBluff, newBluff, type BluffState, type KCard } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const ids = (s: BluffState, seat: number, want: string) => want.split(" ").map((w) => s.hands[seat]!.find((c) => c.id.startsWith(w + "#"))!.id);

function table(hands: string[], over: Partial<BluffState> = {}): BluffState {
  return { ...newBluff(classicBluff, hands.length, 1), hands: hands.map(cards), pile: [], turn: 0, rank: 14, phase: "play", claim: null, out: [], ...over };
}

describe("Bluff", () => {
  it("deals every card, and aces come first", () => {
    const s = newBluff(classicBluff, 3, 2);
    expect(s.hands.flat()).toHaveLength(52);
    expect(claimable(s)).toEqual([14]);
    expect(newBluff(classicBluff, 2, 2).hands.map((h) => h.length)).toEqual([16, 16]);
  });

  it("an honest play called as a bluff: the caller picks up the pile", () => {
    let s = table(["A♠ A♥ 5♦", "9♣ 2♥", "K♠"], { pile: cards("3♣ 4♣") });
    s = bluff.apply(s, 0, { type: "play", cards: ids(s, 0, "A♠ A♥") });
    expect(s.phase).toBe("doubt");
    s = bluff.apply(s, 1, { type: "doubt" });
    expect(s.reveal).toMatchObject({ honest: true, caller: 1 });
    expect(s.hands[1]).toHaveLength(6);
    expect(s.pile).toEqual([]);
    expect(s.rank).toBe(2);
    expect(s.turn).toBe(1);
  });

  it("a lie called as a bluff: the liar picks up the pile", () => {
    let s = table(["5♦ 9♠", "9♣ 2♥", "K♠"]);
    s = bluff.apply(s, 0, { type: "play", cards: ids(s, 0, "5♦") });
    s = bluff.apply(s, 2, { type: "doubt" });
    expect(s.reveal).toMatchObject({ honest: false, caller: 2 });
    expect(s.hands[0]!.map((c) => c.id.split("#")[0]).sort()).toEqual(["5♦", "9♠"]);
  });

  it("when everyone believes it, the play stands and the next rank is due", () => {
    let s = table(["5♦ 9♠", "9♣ 2♥", "K♠"]);
    s = bluff.apply(s, 0, { type: "play", cards: ids(s, 0, "5♦") });
    s = bluff.apply(s, 1, { type: "believe" });
    s = bluff.apply(s, 2, { type: "believe" });
    expect(s.phase).toBe("play");
    expect(s.pile).toHaveLength(1);
    expect(claimable(s)).toEqual([2]);
    expect(s.turn).toBe(1);
  });

  it("the pile is face down: nobody's view holds its cards", () => {
    let s = table(["5♦ 9♠", "9♣ 2♥", "K♠"]);
    s = bluff.apply(s, 0, { type: "play", cards: ids(s, 0, "5♦") });
    const v = JSON.stringify(bluff.view(s, 1));
    expect(v).not.toContain(s.pile[0]!.id);
    expect(bluff.view(s, 1).center).toMatchObject({ discard: [], discardCount: 1, faceDown: true });
  });

  it("getting away with your last card wins", () => {
    let s = table(["A♠", "9♣ 2♥", "K♠"]);
    s = bluff.apply(s, 0, { type: "play", cards: ids(s, 0, "A♠") });
    s = bluff.apply(s, 1, { type: "doubt" });
    expect(s.phase).toBe("finished");
    expect(bluff.view(s, 2).over?.winners).toEqual([0]);
  });

  it("loose rules: the same rank, one up or one down", () => {
    let s = { ...table(["7♦ 9♠", "9♣ 2♥"]), rules: looseBluff };
    s = bluff.apply(s, 0, { type: "play", cards: ids(s, 0, "7♦"), rank: 14 });
    s = bluff.apply(s, 1, { type: "believe" });
    expect(claimable(s).sort((a, b) => a - b)).toEqual([2, 13, 14]);
    expect(() => bluff.apply(s, 1, { type: "play", cards: ids(s, 1, "9♣"), rank: 9 })).toThrow("Say");
  });
});
