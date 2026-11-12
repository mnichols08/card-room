import { describe, expect, it } from "vitest";
import { cardId } from "../src/cards.js";
import { applyAction, canBidBlindNil, newGame, RuleError, viewFor, type GameState } from "../src/game.js";
import { legalPlays } from "../src/tricks.js";
import { brokennilsTable, classic, derivePreset, jokersAndDeuces, quick250 } from "../src/presets.js";
import type { RulePreset, Seat } from "../src/types.js";

/** Bid 3 each, then always play the first legal card. */
function playHand(s: GameState): GameState {
  for (let i = 0; i < 4; i++) s = applyAction(s, { type: "bid", seat: s.turn, bid: { kind: "tricks", count: 3 } });
  const hand = s.handNumber;
  while (s.phase === "playing" && s.handNumber === hand) {
    const card = legalPlays(s.hands[s.turn]!, s.trick, s.spadesBroken, s.preset)[0]!;
    s = applyAction(s, { type: "play", seat: s.turn, card });
  }
  return s;
}

describe("a full hand", () => {
  for (const preset of [classic, jokersAndDeuces]) {
    it(`plays 13 tricks and scores (${preset.name})`, () => {
      const s = playHand(newGame(preset, 123));
      expect(s.history).toHaveLength(1);
      const [rec] = s.history;
      expect(rec!.tricksWon.reduce((a, b) => a + b, 0)).toBe(13);
      expect(s.handNumber).toBe(1);
      expect(s.dealer).toBe(1);
      expect(s.phase).toBe("bidding");
      expect(s.hands.every((h) => h.length === 13)).toBe(true);
    });
  }

  it("plays until somebody wins", () => {
    let s = newGame(quick250, 99);
    let guard = 0;
    while (s.phase !== "finished" && guard++ < 200) s = playHand(s);
    expect(s.phase).toBe("finished");
    expect(s.winner).not.toBeNull();
  });

  it("is reproducible from the seed", () => {
    expect(playHand(newGame(classic, 5)).history).toEqual(playHand(newGame(classic, 5)).history);
  });
});

describe("turn and bid validation", () => {
  it("rejects bids out of turn", () => {
    const s = newGame(classic, 1);
    expect(() => applyAction(s, { type: "bid", seat: 3 as Seat, bid: { kind: "tricks", count: 2 } })).toThrow(RuleError);
  });

  it("rejects blind nil unless the preset allows it", () => {
    const s = newGame(classic, 1);
    expect(() => applyAction(s, { type: "bid", seat: s.turn, bid: { kind: "blind-nil" } })).toThrow(/Blind nil/);
    const b = newGame(brokennilsTable, 1);
    expect(() => applyAction(b, { type: "bid", seat: b.turn, bid: { kind: "blind-nil" } })).not.toThrow();
  });

  it("blind nil can be limited to teams that are behind", () => {
    const behind = derivePreset(brokennilsTable, "b", "Behind", {
      blindNil: { ...brokennilsTable.blindNil, onlyWhenDownBy: 100 },
    });
    const s = newGame(behind, 1);
    expect(canBidBlindNil(s, 1)).toBe(false);
    const down: GameState = { ...s, scores: [{ points: 200, bags: 0 }, { points: 50, bags: 0 }] };
    expect(canBidBlindNil(down, 1)).toBe(true);
    expect(canBidBlindNil(down, 0)).toBe(false);
  });

  it("enforces a minimum team bid", () => {
    const min4: RulePreset = derivePreset(classic, "m", "Min 4", { minTeamBid: 4 });
    let s = newGame(min4, 1); // dealer 0 → seat 1 bids first
    s = applyAction(s, { type: "bid", seat: 1, bid: { kind: "tricks", count: 1 } });
    s = applyAction(s, { type: "bid", seat: 2, bid: { kind: "tricks", count: 2 } });
    expect(() => applyAction(s, { type: "bid", seat: 3, bid: { kind: "tricks", count: 2 } })).toThrow(/at least 4/);
  });

  it("rejects illegal plays with a friendly message", () => {
    let s = newGame(classic, 3);
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: "bid", seat: s.turn, bid: { kind: "tricks", count: 3 } });
    const notMine = s.hands[(s.turn + 1) % 4]![0]!;
    expect(() => applyAction(s, { type: "play", seat: s.turn, card: notMine })).toThrow(/don't have/);
  });
});

describe("blind nil passing", () => {
  it("blind nil bidder and partner swap cards before play", () => {
    const passTwo = derivePreset(brokennilsTable, "p", "Pass 2", {
      blindNil: { ...brokennilsTable.blindNil, passCards: 2 },
    });
    let s = newGame(passTwo, 11); // seat 1 bids first; partner is seat 3
    s = applyAction(s, { type: "bid", seat: 1, bid: { kind: "blind-nil" } });
    for (const seat of [2, 3, 0] as Seat[]) s = applyAction(s, { type: "bid", seat, bid: { kind: "tricks", count: 4 } });
    expect(s.phase).toBe("passing");

    const fromBlind = s.hands[1]!.slice(0, 2);
    const fromPartner = s.hands[3]!.slice(0, 2);
    expect(() => applyAction(s, { type: "pass", seat: 0, cards: s.hands[0]!.slice(0, 2) })).toThrow(/don't pass/);
    s = applyAction(s, { type: "pass", seat: 1, cards: fromBlind });
    expect(s.phase).toBe("passing");
    s = applyAction(s, { type: "pass", seat: 3, cards: fromPartner });
    expect(s.phase).toBe("playing");

    const has = (seat: number, c: (typeof fromBlind)[number]) => s.hands[seat]!.map(cardId).includes(cardId(c));
    expect(fromPartner.every((c) => has(1, c))).toBe(true);
    expect(fromBlind.every((c) => has(3, c))).toBe(true);
    expect(s.hands.every((h) => h.length === 13)).toBe(true);
  });
});

describe("viewFor", () => {
  it("shows only your own hand and hides the seed", () => {
    const s = newGame(classic, 8);
    const v = viewFor(s, 2);
    expect(v.hand).toEqual(s.hands[2]);
    expect(v.handCounts).toEqual([13, 13, 13, 13]);
    expect(v).not.toHaveProperty("hands");
    expect(v).not.toHaveProperty("seed");
  });

  it("can hide the hand while a player decides on blind nil", () => {
    const s = newGame(brokennilsTable, 8);
    expect(viewFor(s, 1, { hideHand: true }).hand).toBeNull();
  });
});
