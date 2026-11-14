import { describe, expect, it } from "vitest";
import { classicSwitch, easySwitch, newSwitch, switchGame, switchLegal, type KCard, type SwitchState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const hand = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const at = (rules = classicSwitch, extra: Partial<SwitchState>): SwitchState => ({ ...newSwitch(rules, 3, 1), turn: 0, ...extra }) as SwitchState;

describe("Switch", () => {
  it("never starts on a power card", () => {
    for (let seed = 0; seed < 40; seed++) {
      const s = newSwitch(classicSwitch, 4, seed);
      expect([2, 8, 11, 14]).not.toContain((s.discard[0] as { rank: number }).rank);
    }
  });

  it("aces are wild and change the suit", () => {
    let s = at(easySwitch, { discard: [card("7♥")], suit: "hearts", hands: [hand("3♥ 7♠ A♣ K♦"), hand("2♦ 3♦"), hand("4♣ 5♣")], stock: hand("9♠ 9♦") });
    expect(switchLegal(s, 0).map((c) => c.id).sort()).toEqual(["3♥", "7♠", "A♣"].sort());
    s = switchGame.apply(s, 0, { type: "play", card: "A♣" });
    expect(s.phase).toBe("suit");
    s = switchGame.apply(s, 0, { type: "suit", suit: "diamonds" });
    expect(s.suit).toBe("diamonds");
    expect(s.turn).toBe(1);
  });

  it("twos stack: answer a two with a two, or pick up the lot", () => {
    let s = at(easySwitch, { discard: [card("7♥")], suit: "hearts", hands: [hand("2♥ 4♠ 5♠"), hand("2♠ 3♦ 6♦"), hand("4♣ 6♣")], stock: hand("9♠ 9♦ 10♦ J♦ 3♣ 4♦") });
    s = switchGame.apply(s, 0, { type: "play", card: "2♥" });
    expect(s.owed).toBe(2);
    expect(switchLegal(s, 1).map((c) => c.id)).toEqual(["2♠"]);
    expect(() => switchGame.apply(s, 1, { type: "play", card: "3♦" })).toThrow("pick up 2");
    s = switchGame.apply(s, 1, { type: "play", card: "2♠" });
    expect(s.owed).toBe(4);
    expect(s.turn).toBe(2);
    s = switchGame.apply(s, 2, { type: "draw" });
    expect(s.hands[2]).toHaveLength(6);
    expect(s.owed).toBe(0);
    expect(s.turn).toBe(0);
  });

  it("eights skip, jacks reverse", () => {
    let s = at(easySwitch, { discard: [card("7♥")], suit: "hearts", hands: [hand("8♥ J♥ 4♠"), hand("3♦ 5♦"), hand("4♣ 6♣")], stock: hand("9♠") });
    s = switchGame.apply(s, 0, { type: "play", card: "8♥" });
    expect(s.turn).toBe(2);
    s = { ...s, turn: 0 };
    s = switchGame.apply(s, 0, { type: "play", card: "J♥" });
    expect(s.direction).toBe(-1);
    expect(s.turn).toBe(2);
  });

  it("forget to call last card and you pick up two", () => {
    const base = { discard: [card("7♥")], suit: "hearts" as const, hands: [hand("3♥ 4♠"), hand("3♦ 5♦"), hand("4♣ 6♣")], stock: hand("9♠ 9♦ 10♦") };
    let s = switchGame.apply(at(classicSwitch, base), 0, { type: "play", card: "3♥" });
    expect(s.hands[0]).toHaveLength(3);
    expect(s.narration).toMatch(/forgot/);

    s = at(classicSwitch, base);
    expect(switchGame.view(s, 0).choices?.options.map((o) => o.label)).toContain("Last card!");
    s = switchGame.apply(s, 0, { type: "last" });
    s = switchGame.apply(s, 0, { type: "play", card: "3♥" });
    expect(s.hands[0]).toHaveLength(1);
    expect(() => switchGame.apply(at(classicSwitch, { ...base, hands: [hand("3♥ 4♠ 5♠"), hand("3♦"), hand("4♣")] }), 0, { type: "last" })).toThrow();
  });

  it("first out wins", () => {
    let s = at(classicSwitch, { discard: [card("7♥")], suit: "hearts", hands: [hand("3♥"), hand("3♦ K♦"), hand("4♣")], stock: hand("9♠") });
    s = switchGame.apply(s, 0, { type: "play", card: "3♥" });
    expect(s.phase).toBe("finished");
    expect(switchGame.view(s, 0).over?.winners).toEqual([0]);
  });
});
