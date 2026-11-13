import { describe, expect, it } from "vitest";
import { classicHearts, hearts, heartsLegal, newHearts, passOffset, type HeartsState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const hand = (ids: string) => ids.split(" ").map(card);

/** A game at the start of play with these hands (4 players, clubs 2 with seat 0). */
function playing(hands: string[], extra: Partial<HeartsState> = {}): HeartsState {
  const s = newHearts({ ...classicHearts, passing: "none" }, 4, 1);
  return { ...s, hands: hands.map(hand), phase: "playing", turn: 0, ...extra };
}

describe("Hearts", () => {
  it("passes left, right, across, then keeps; three and five players skip across", () => {
    expect([0, 1, 2, 3, 4].map((h) => passOffset(classicHearts, 4, h))).toEqual([1, 3, 2, 0, 1]);
    expect([0, 1, 2].map((h) => passOffset(classicHearts, 3, h))).toEqual([1, 2, 0]);
  });

  it("deals evenly: 17 each for three players, 10 for five", () => {
    expect(newHearts(classicHearts, 3, 1).hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(newHearts(classicHearts, 5, 1).hands.map((h) => h.length)).toEqual([10, 10, 10, 10, 10]);
  });

  it("passing: three cards go to the left, and play starts with the 2♣", () => {
    let s = newHearts(classicHearts, 4, 3);
    const passed = s.hands.map((h) => h.slice(0, 3).map((c) => c.id));
    for (let seat = 0; seat < 4; seat++) s = hearts.apply(s, seat, { type: "pass", cards: passed[seat]! });
    expect(s.phase).toBe("playing");
    for (let seat = 0; seat < 4; seat++) for (const id of passed[seat]!) expect(s.hands[(seat + 1) % 4]!.some((c) => c.id === id)).toBe(true);
    expect(s.hands[s.turn]!.some((c) => c.id === "2♣")).toBe(true);
    expect(heartsLegal(s, s.turn).map((c) => c.id)).toEqual(["2♣"]);
  });

  it("no points on the first trick, and hearts can't be led until broken", () => {
    let s = playing(["2♣ 3♥ 4♥", "Q♠ 5♥ 6♦", "7♣ 8♥ 9♦", "10♣ J♥ K♦"]);
    s = hearts.apply(s, 0, { type: "play", card: "2♣" });
    // Seat 1 has no clubs: the queen and the heart are points, so it must play the diamond.
    expect(heartsLegal(s, 1).map((c) => c.id)).toEqual(["6♦"]);
    expect(() => hearts.apply(s, 1, { type: "play", card: "Q♠" })).toThrow("No points on the first trick.");
    s = hearts.apply(s, 1, { type: "play", card: "6♦" });
    s = hearts.apply(s, 2, { type: "play", card: "7♣" });
    s = hearts.apply(s, 3, { type: "play", card: "10♣" });
    expect(s.turn).toBe(3);
    // Seat 3 leads: hearts aren't broken, so the diamond.
    expect(heartsLegal(s, 3).map((c) => c.id)).toEqual(["K♦"]);
  });

  it("scores the hearts and the queen, and shooting the moon gives everyone else 26", () => {
    const s0 = newHearts(classicHearts, 4, 1);
    const s = { ...s0, phase: "playing" as const, hands: [[], [], [], []] as KCard[][], taken: [hand("Q♠ 2♥ 3♥"), hand("4♥"), [], []] as KCard[][] };
    // Score through the engine: the last trick of a hand.
    const one = { ...s, hands: [hand("5♣"), hand("6♣"), hand("7♣"), hand("8♣")], turn: 0, firstTrick: false };
    let t = hearts.apply(one, 0, { type: "play", card: "5♣" });
    t = hearts.apply(t, 1, { type: "play", card: "6♣" });
    t = hearts.apply(t, 2, { type: "play", card: "7♣" });
    t = hearts.apply(t, 3, { type: "play", card: "8♣" });
    expect(t.lastHand!.points).toEqual([15, 1, 0, 0]);
    expect(t.phase).toBe("scored");

    const allHearts = hand("2♥ 3♥ 4♥ 5♥ 6♥ 7♥ 8♥ 9♥ 10♥ J♥ Q♥ K♥ A♥ Q♠");
    const moon = { ...one, taken: [allHearts, [], [], []] as KCard[][] };
    let m = hearts.apply(moon, 0, { type: "play", card: "5♣" });
    for (const [seat, id] of [[1, "6♣"], [2, "7♣"], [3, "8♣"]] as const) m = hearts.apply(m, seat, { type: "play", card: id });
    expect(m.lastHand).toEqual({ points: [0, 26, 26, 26], moon: 0 });
  });

  it("the game ends when someone reaches the limit; lowest wins", () => {
    const s0 = newHearts({ ...classicHearts, playTo: 10 }, 4, 1);
    const s = { ...s0, phase: "playing" as const, firstTrick: false, turn: 0, hands: [hand("5♣"), hand("6♣"), hand("7♣"), hand("8♣")], taken: [hand("Q♠"), [], [], []] as KCard[][] };
    let t = hearts.apply(s, 0, { type: "play", card: "5♣" });
    for (const [seat, id] of [[1, "6♣"], [2, "7♣"], [3, "8♣"]] as const) t = hearts.apply(t, seat, { type: "play", card: id });
    expect(t.phase).toBe("finished");
    expect(hearts.summary(t).winners).toEqual([1, 2, 3]);
    expect(hearts.summary(t).order![3]).toBe(0);
  });

  it("good bots pass the queen of spades when it's unguarded", () => {
    const s = { ...newHearts(classicHearts, 4, 1), hands: [hand("Q♠ 3♠ 2♣ 3♣ 4♣ 5♣ 6♦ 7♦ 8♦ 2♥ 3♥ 4♥ 5♥"), ...newHearts(classicHearts, 4, 1).hands.slice(1)] };
    const move = hearts.bot(s, 0, { skill: 1, sloppy: 0 }) as { type: string; cards: string[] };
    expect(move.cards).toContain("Q♠");
  });
});
