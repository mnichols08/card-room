import { describe, expect, it } from "vitest";
import { friendlyHoldem, holdem, newHoldem, pot, preflopStrength, type HoldemState, type KCard } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => ids.split(" ").map(card);
const go = (s: HoldemState, type: "fold" | "check" | "call" | "raise") => holdem.apply(s, s.betting.turn, { type });

describe("Texas Hold'em", () => {
  it("blinds from the two after the dealer; first to act is after the big blind", () => {
    const s = newHoldem(friendlyHoldem, 4, 0); // dealer 0
    expect(s.dealer).toBe(0);
    expect(s.blinds).toEqual([1, 2]);
    expect(s.betting.committed).toEqual([0, 5, 10, 0]);
    expect(s.betting.turn).toBe(3);
    expect(s.hole.every((h) => h.length === 2)).toBe(true);
  });

  it("heads up, the dealer is the small blind and acts first before the flop, last after", () => {
    let s = newHoldem(friendlyHoldem, 2, 0);
    expect(s.blinds).toEqual([0, 1]);
    expect(s.betting.turn).toBe(0);
    s = go(s, "call");
    expect(s.phase).toBe("preflop"); // the big blind still has the option
    s = go(s, "check");
    expect(s.phase).toBe("flop");
    expect(s.board).toHaveLength(3);
    expect(s.betting.turn).toBe(1);
  });

  it("the big blind can raise when everyone just calls", () => {
    let s = newHoldem(friendlyHoldem, 3, 0); // blinds 1 and 2, seat 0 first
    s = go(s, "call");
    s = go(s, "call");
    expect(s.betting.turn).toBe(2);
    s = go(s, "raise");
    expect(s.betting.toMatch).toBe(20);
    expect(s.phase).toBe("preflop");
  });

  it("the flop, the turn and the river, then the showdown; chips add up", () => {
    let s = newHoldem(friendlyHoldem, 3, 2);
    for (let i = 0; i < 40 && s.phase !== "scored" && s.phase !== "finished"; i++) s = go(s, s.betting.toMatch > s.betting.roundBet[s.betting.turn]! ? "call" : "check");
    expect(s.board).toHaveLength(5);
    expect(s.phase).toBe("scored");
    expect(s.betting.stacks.reduce((a, b) => a + b, 0)).toBe(1500);
    expect(s.showdown!.names.filter(Boolean)).toHaveLength(3);
  });

  it("bets double on the turn", () => {
    let s = newHoldem(friendlyHoldem, 2, 0);
    s = go(s, "call");
    s = go(s, "check");
    s = go(s, "check");
    s = go(s, "check");
    expect(s.phase).toBe("turn");
    expect(s.betting.size).toBe(20);
  });

  it("all in before the river: the rest of the board comes out on its own", () => {
    let s = newHoldem({ ...friendlyHoldem, startChips: 30 }, 2, 0);
    // Raise while that's allowed (until someone's all in or the cap), then call.
    for (let i = 0; i < 20 && s.phase === "preflop"; i++) {
      try {
        s = go(s, "raise");
      } catch {
        s = go(s, s.betting.toMatch > s.betting.roundBet[s.betting.turn]! ? "call" : "check");
      }
    }
    expect(["scored", "finished"]).toContain(s.phase);
    expect(s.board).toHaveLength(5);
  });

  it("you never see another player's hole cards until the showdown", () => {
    const s = newHoldem(friendlyHoldem, 4, 8);
    const v = JSON.stringify(holdem.view(s, 0));
    for (const c of [...s.hole[1]!, ...s.hole[2]!, ...s.hole[3]!]) expect(v).not.toContain(c.id);
    expect(pot(s.betting)).toBe(15);
  });

  it("before the flop, pairs and high suited cards are stronger", () => {
    expect(preflopStrength(cards("A♠ A♥"))).toBeGreaterThan(preflopStrength(cards("A♠ K♠")));
    expect(preflopStrength(cards("A♠ K♠"))).toBeGreaterThan(preflopStrength(cards("7♣ 2♦")));
  });
});
