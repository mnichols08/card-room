import { describe, expect, it } from "vitest";
import { brokennilsTable, classic, derivePreset } from "../src/presets.js";
import { gameWinner, scoreTeamHand } from "../src/scoring.js";
import type { Bid } from "../src/types.js";

const t = (count: number): Bid => ({ kind: "tricks", count });
const nil: Bid = { kind: "nil" };
const blind: Bid = { kind: "blind-nil" };
const zero = { points: 0, bags: 0 };

describe("scoreTeamHand", () => {
  it("made bid: 10 per trick bid plus 1 per bag", () => {
    // Team 0 = seats 0 & 2, bid 3 + 2 = 5, took 4 + 3 = 7.
    const r = scoreTeamHand(0, [t(3), t(1), t(2), t(1)], [4, 2, 3, 4], zero, classic);
    expect(r.made).toBe(true);
    expect(r.delta).toBe(52);
    expect(r.after).toEqual({ points: 52, bags: 2 });
  });

  it("set: lose 10 per trick bid, no bags", () => {
    const r = scoreTeamHand(0, [t(4), t(1), t(4), t(1)], [3, 3, 4, 3], zero, classic);
    expect(r.made).toBe(false);
    expect(r.after).toEqual({ points: -80, bags: 0 });
  });

  it("bag penalty when bags reach the limit", () => {
    const r = scoreTeamHand(0, [t(2), t(1), t(2), t(1)], [4, 2, 3, 4], { points: 100, bags: 7 }, classic);
    // bid 4, took 7 → 40 + 3 bags = 143, bags 10 → -100 and reset to 0.
    expect(r.bagPenalty).toBe(100);
    expect(r.after).toEqual({ points: 43, bags: 0 });
  });

  it("no bag penalty when the preset turns bags off", () => {
    const noBags = derivePreset(classic, "nb", "No bags", { bags: null });
    const r = scoreTeamHand(0, [t(2), t(1), t(2), t(1)], [4, 2, 3, 4], { points: 0, bags: 9 }, noBags);
    expect(r.bagPenalty).toBe(0);
    expect(r.after.bags).toBe(12);
  });

  it("successful nil scores the nil value; partner scored separately", () => {
    const r = scoreTeamHand(0, [nil, t(1), t(4), t(1)], [0, 4, 5, 4], zero, classic);
    expect(r.nilPoints).toBe(100);
    expect(r.after.points).toBe(100 + 40 + 1);
  });

  it("failed nil loses the nil value and its tricks are bags by default", () => {
    const r = scoreTeamHand(0, [nil, t(1), t(4), t(1)], [2, 3, 4, 4], zero, classic);
    expect(r.nilPoints).toBe(-100);
    expect(r.made).toBe(true);
    expect(r.after).toEqual({ points: -100 + 40 + 2, bags: 2 });
  });

  it("nil tricks can count toward partner's bid if the preset says so", () => {
    const helps = derivePreset(classic, "h", "Helps", { nilTricksCountTowardBid: true });
    const r = scoreTeamHand(0, [nil, t(1), t(4), t(1)], [1, 4, 3, 5], zero, helps);
    expect(r.made).toBe(true);
    expect(r.after).toEqual({ points: -100 + 40, bags: 0 });
  });

  it("blind nil uses the blind nil value", () => {
    const made = scoreTeamHand(0, [blind, t(1), t(5), t(1)], [0, 4, 5, 4], zero, brokennilsTable);
    expect(made.nilPoints).toBe(200);
    const missed = scoreTeamHand(0, [blind, t(1), t(5), t(1)], [1, 4, 4, 4], zero, brokennilsTable);
    expect(missed.nilPoints).toBe(-200);
  });
});

describe("gameWinner", () => {
  it("keeps playing until someone reaches play-to", () => {
    expect(gameWinner([{ points: 480, bags: 0 }, { points: 300, bags: 0 }], classic)).toBeNull();
    expect(gameWinner([{ points: 510, bags: 0 }, { points: 300, bags: 0 }], classic)).toBe(0);
  });

  it("higher score wins if both cross; a tie keeps playing", () => {
    expect(gameWinner([{ points: 510, bags: 0 }, { points: 530, bags: 0 }], classic)).toBe(1);
    expect(gameWinner([{ points: 520, bags: 0 }, { points: 520, bags: 0 }], classic)).toBeNull();
  });

  it("falling to the lose-at floor ends the game", () => {
    expect(gameWinner([{ points: -200, bags: 0 }, { points: 50, bags: 0 }], classic)).toBe(1);
  });
});
