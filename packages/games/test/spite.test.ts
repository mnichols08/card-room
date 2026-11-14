import { describe, expect, it } from "vitest";
import { buildTargets, classicSpite, newSpite, spite, type KCard, type SpiteState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const at = (extra: Partial<SpiteState>): SpiteState =>
  ({ ...newSpite(classicSpite, 2, 1), turn: 0, discarding: false, toss: null, held: null, played: false, idle: 0, ...extra }) as SpiteState;
const empty4 = () => [[], [], [], []] as KCard[][];

describe("Spite and Malice", () => {
  it("deals a pay-off pile and five cards each", () => {
    const s = newSpite(classicSpite, 2, 3);
    expect(s.payoff.map((p) => p.length)).toEqual([20, 20]);
    expect(s.hands.map((h) => h.length)).toEqual([5, 5]);
    expect(s.stock).toHaveLength(104 - 50);
  });

  it("build up from ace; kings are wild", () => {
    const s = at({ builds: [cards("A♠ 2♥"), [], [], []] });
    expect(buildTargets(s, card("3♣"))).toEqual([0]);
    expect(buildTargets(s, card("A♦"))).toEqual([1, 2, 3]);
    expect(buildTargets(s, card("5♦"))).toEqual([]);
    expect(buildTargets(s, card("K♦"))).toEqual([0, 1, 2, 3]);
  });

  it("play from the hand, the pay-off pile and a discard pile", () => {
    let s = at({
      builds: [cards("A♠"), [], [], []],
      hands: [cards("2♥ 9♠ 9♦ 9♣ 9♥"), cards("5♣")],
      payoff: [cards("7♠ 3♦"), cards("8♣")],
      discards: [[cards("4♣"), [], [], []], empty4()],
    });
    s = spite.apply(s, 0, { type: "play", card: "2♥" });
    s = spite.apply(s, 0, { type: "from", index: 0 });
    s = spite.apply(s, 0, { type: "from", index: 1 });
    expect(s.builds[0]!.map((c) => c.id)).toEqual(["A♠", "2♥", "3♦", "4♣"]);
    expect(s.payoff[0]!.map((c) => c.id)).toEqual(["7♠"]);
    expect(() => spite.apply(s, 0, { type: "play", card: "9♠" })).toThrow("doesn't fit");
  });

  it("a king that fits piles of different heights asks which", () => {
    let s = at({ builds: [cards("A♠ 2♥"), [], [], []], hands: [cards("K♠ 9♠"), cards("5♣")] });
    s = spite.apply(s, 0, { type: "play", card: "K♠" });
    expect(s.held).toEqual({ from: "hand", card: "K♠" });
    s = spite.apply(s, 0, { type: "to", pile: 0 });
    expect(s.builds[0]).toHaveLength(3);
  });

  it("end the turn with a discard; the next player fills to five", () => {
    let s = at({ hands: [cards("9♠ 9♦"), cards("5♣")], stock: cards("2♠ 3♠ 4♠ 6♠ 7♠ 8♠") });
    s = spite.apply(s, 0, { type: "discard" });
    expect(() => spite.apply(s, 0, { type: "onto", index: 1 })).toThrow();
    s = spite.apply(s, 0, { type: "toss", card: "9♦" });
    s = spite.apply(s, 0, { type: "onto", index: 3 });
    expect(s.discards[0]![2]!.map((c) => c.id)).toEqual(["9♦"]);
    expect(s.turn).toBe(1);
    expect(s.hands[1]).toHaveLength(5);
  });

  it("a finished pile goes back into play; the last pay-off card wins", () => {
    let s = at({ builds: [cards("A♠ 2♥ 3♦ 4♣ 5♠ 6♥ 7♦ 8♣ 9♠ 10♥ J♦"), [], [], []], payoff: [cards("Q♣"), cards("8♣")], hands: [cards("9♠"), cards("5♣")] });
    s = spite.apply(s, 0, { type: "from", index: 0 });
    expect(s.builds[0]).toEqual([]);
    expect(s.spent).toHaveLength(12);
    expect(s.phase).toBe("finished");
    expect(spite.view(s, 1).over?.winners).toEqual([0]);
  });
});
