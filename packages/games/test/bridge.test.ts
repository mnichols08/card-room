import { describe, expect, it } from "vitest";
import { bridge, bridgeScore, callsFor, chicagoBridge, hcp, newBridge, vulnerable, type BridgeState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const call = (s: BridgeState, c: Record<string, unknown>) => bridge.apply(s, s.turn, c as never);

describe("Bridge", () => {
  it("deals thirteen each; the dealer calls first", () => {
    const s = newBridge(chicagoBridge, 4, 2);
    expect(s.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(s.turn).toBe(s.dealer);
    expect(hcp(cards("A♠ K♠ Q♥ J♦ 2♣"))).toBe(10);
  });

  it("the auction: higher bids, double, redouble; three passes end it; the declarer named the strain first", () => {
    let s = { ...newBridge(chicagoBridge, 4, 2), dealer: 0, turn: 0 } as BridgeState;
    s = call(s, { type: "bid", level: 1, strain: "hearts" }); // 0
    expect(callsFor(s, 1).some((c) => c.type === "double")).toBe(true);
    expect(() => call(s, { type: "bid", level: 1, strain: "diamonds" })).toThrow("higher");
    s = call(s, { type: "pass" }); // 1
    s = call(s, { type: "bid", level: 3, strain: "hearts" }); // 2
    s = call(s, { type: "double" }); // 3
    expect(callsFor(s, 0).some((c) => c.type === "redouble")).toBe(true);
    s = call(s, { type: "bid", level: 4, strain: "hearts" }); // 0
    s = call(s, { type: "pass" });
    s = call(s, { type: "pass" });
    s = call(s, { type: "pass" });
    expect(s.phase).toBe("playing");
    expect(s.declarer).toBe(0);
    expect(s.contract).toMatchObject({ level: 4, strain: "hearts", doubled: 0 });
    expect(s.turn).toBe(1);
  });

  it("four passes throw the deal in", () => {
    let s = newBridge(chicagoBridge, 4, 2);
    for (let i = 0; i < 4; i++) s = call(s, { type: "pass" });
    expect(s.phase).toBe("bidding");
    expect(s.auction).toEqual([]);
    expect(s.hand).toBe(0);
  });

  it("the declarer plays dummy's cards", () => {
    let s = { ...newBridge(chicagoBridge, 4, 2), dealer: 0, turn: 0 } as BridgeState;
    s = call(s, { type: "bid", level: 1, strain: "nt" });
    for (let i = 0; i < 3; i++) s = call(s, { type: "pass" });
    s = { ...s, hands: [cards("A♠ 2♥"), cards("K♠ 3♥"), cards("Q♠ 4♥"), cards("J♠ 5♥")] };
    s = bridge.apply(s, 1, { type: "play", card: "K♠" });
    expect(s.turn).toBe(2);
    const v = bridge.view(s, 0);
    expect(v.turn).toBe(0);
    expect(v.hand.map((c) => c.id)).toEqual(["Q♠", "4♥"]);
    expect(() => bridge.apply(s, 2, { type: "play", card: "Q♠" })).toThrow("turn");
    s = bridge.apply(s, 0, { type: "play", card: "Q♠" });
    s = bridge.apply(s, 3, { type: "play", card: "J♠" });
    s = bridge.apply(s, 0, { type: "play", card: "A♠" });
    expect(s.lastTrick!.winner).toBe(0);
  });

  it("scores contracts, overtricks, slams and penalties", () => {
    expect(bridgeScore({ level: 4, strain: "spades", doubled: 0 }, 10, false)).toBe(420);
    expect(bridgeScore({ level: 3, strain: "nt", doubled: 0 }, 10, true)).toBe(630);
    expect(bridgeScore({ level: 2, strain: "hearts", doubled: 1 }, 8, false)).toBe(470);
    expect(bridgeScore({ level: 1, strain: "clubs", doubled: 0 }, 9, false)).toBe(110);
    expect(bridgeScore({ level: 6, strain: "clubs", doubled: 0 }, 12, false)).toBe(920);
    expect(bridgeScore({ level: 4, strain: "hearts", doubled: 0 }, 8, true)).toBe(-200);
    expect(bridgeScore({ level: 4, strain: "hearts", doubled: 1 }, 7, true)).toBe(-800);
    expect(bridgeScore({ level: 3, strain: "clubs", doubled: 2 }, 7, false)).toBe(-600);
  });

  it("Chicago vulnerability: none, dealer's side twice, then both", () => {
    const s = newBridge(chicagoBridge, 4, 0);
    const at = (hand: number, dealer: number) => [vulnerable({ ...s, hand, dealer }, 0), vulnerable({ ...s, hand, dealer }, 1)];
    expect(at(0, 0)).toEqual([false, false]);
    expect(at(1, 1)).toEqual([false, true]);
    expect(at(2, 2)).toEqual([true, false]);
    expect(at(3, 3)).toEqual([true, true]);
  });
});
