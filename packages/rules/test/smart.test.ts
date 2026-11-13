import { describe, expect, it } from "vitest";
import { buildDeck, cardId, isTrump, mulberry32, pip, sameCard } from "../src/cards.js";
import { applyAction, newGame, type GameState } from "../src/game.js";
import { classic, jokersAndDeuces, familyTable } from "../src/presets.js";
import { knowledge, sampleDeal, smartAction, thinkBid, thinkCard } from "../src/smart.js";
import { estimateTricks } from "../src/bot.js";
import type { Bid, Card, Seat } from "../src/types.js";
import type { Play } from "../src/tricks.js";

const t = (count: number): Bid => ({ kind: "tricks", count });

/**
 * A first-trick position: seat 0 (the bot) holds `mine`; the trick so far is `trick`; everyone
 * else's cards are the rest of the deck. It's seat 0's turn.
 */
function firstTrick(mine: Card[], trick: Play[], bids: Bid[]): GameState {
  const base = newGame(classic, 7);
  const used = new Set([...mine, ...trick.map((p) => p.card)].map(cardId));
  const rest = buildDeck(classic).filter((c) => !used.has(cardId(c)));
  const hands: Card[][] = [mine, [], [], []];
  for (const seat of [1, 2, 3] as Seat[]) {
    const n = 13 - (trick.some((p) => p.seat === seat) ? 1 : 0);
    hands[seat] = rest.splice(0, n);
  }
  return { ...base, phase: "playing", bids, hands, trick, played: trick, turn: 0, spadesBroken: false };
}

const noHearts = [...[2, 3, 4, 5, 6, 7].map((r) => pip("spades", r as 2)), ...[2, 3, 4, 5].map((r) => pip("clubs", r as 2)), ...[2, 3, 4].map((r) => pip("diamonds", r as 2))];

describe("what a bot knows", () => {
  it("sees who is out of a suit, and counts what's unseen", () => {
    const s = firstTrick(noHearts, [{ seat: 1, card: pip("hearts", 4) }, { seat: 2, card: pip("clubs", 9) }], [t(3), t(3), t(3), t(3)]);
    const k = knowledge(s, 0);
    expect(k.voids[2]!.has("hearts")).toBe(true);
    expect(k.voids[1]!.size).toBe(0);
    expect(k.unseen).toHaveLength(52 - 13 - 2);
  });

  it("deals the unseen cards so nobody holds a suit they've shown they're out of", () => {
    const s = firstTrick(noHearts, [{ seat: 1, card: pip("hearts", 4) }, { seat: 2, card: pip("clubs", 9) }], [t(3), t(3), t(3), t(3)]);
    const k = knowledge(s, 0);
    const rand = mulberry32(1);
    for (let i = 0; i < 50; i++) {
      const hands = sampleDeal(s, 0, k, rand)!;
      expect(hands).not.toBeNull();
      expect(hands.map((h) => h.length)).toEqual([13, 12, 12, 13]);
      expect(hands[2]!.some((c) => c.kind === "pip" && c.suit === "hearts")).toBe(false);
    }
  });
});

describe("a thinking partner", () => {
  it("doesn't trump a trick its partner has already won", () => {
    // West leads a heart, partner (North) plays the ace, East follows; the bot is out of hearts.
    const trick: Play[] = [
      { seat: 1, card: pip("hearts", 4) },
      { seat: 2, card: pip("hearts", 14) },
      { seat: 3, card: pip("hearts", 6) },
    ];
    const card = thinkCard(firstTrick(noHearts, trick, [t(3), t(3), t(3), t(3)]), 0).card;
    expect(isTrump(card, classic)).toBe(false);
  });

  it("takes the trick to save its partner's nil", () => {
    // Partner bid nil and is stuck winning with the queen; the bot holds the ace over it.
    const mine = [pip("hearts", 14), pip("hearts", 2), ...noHearts.slice(0, 11)];
    const trick: Play[] = [
      { seat: 1, card: pip("hearts", 3) },
      { seat: 2, card: pip("hearts", 12) },
      { seat: 3, card: pip("hearts", 5) },
    ];
    const card = thinkCard(firstTrick(mine, trick, [t(4), t(3), { kind: "nil" }, t(3)]), 0).card;
    expect(sameCard(card, pip("hearts", 14))).toBe(true);
  });

  it("without a nil to protect, keeps the ace and lets partner's queen win", () => {
    const mine = [pip("hearts", 14), pip("hearts", 2), ...noHearts.slice(0, 11)];
    const trick: Play[] = [
      { seat: 1, card: pip("hearts", 3) },
      { seat: 2, card: pip("hearts", 12) },
      { seat: 3, card: pip("hearts", 5) },
    ];
    const card = thinkCard(firstTrick(mine, trick, [t(4), t(3), t(4), t(3)]), 0).card;
    expect(sameCard(card, pip("hearts", 2))).toBe(true);
  });

  it("reads bids: deals that fit a big bid give that seat a stronger hand", () => {
    // Weigh many deals by how well they fit the bids, as the bot does, and compare.
    const s = firstTrick(noHearts, [{ seat: 1, card: pip("diamonds", 9) }], [t(3), t(6), { kind: "nil" }, t(2)]);
    const k = knowledge(s, 0);
    const rand = mulberry32(3);
    let big = 0;
    let nil = 0;
    let weight = 0;
    let bigPlain = 0;
    let nilPlain = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      const hands = sampleDeal(s, 0, k, rand)!;
      const original1 = [...hands[1]!, pip("diamonds", 9)];
      const e1 = estimateTricks(original1, classic);
      const e2 = estimateTricks(hands[2]!, classic);
      const w = Math.exp(-0.55 * Math.abs(e1 - 6)) * Math.exp(-0.55 * e2);
      big += w * e1;
      nil += w * e2;
      weight += w;
      bigPlain += e1 / n;
      nilPlain += e2 / n;
    }
    // Unweighted, both seats look alike; weighted by their bids, they pull apart.
    expect(Math.abs(bigPlain - nilPlain)).toBeLessThan(0.5);
    expect(big / weight).toBeGreaterThan(bigPlain + 0.4);
    expect(nil / weight).toBeLessThan(nilPlain - 0.8);
  });
});

describe("thinking bids", () => {
  it("goes nil with a hand that can't take tricks", () => {
    const s = newGame(classic, 1);
    const weak = [pip("spades", 2), pip("spades", 3), pip("hearts", 2), pip("hearts", 3), pip("hearts", 4), pip("hearts", 6), pip("clubs", 2), pip("clubs", 4), pip("clubs", 5), pip("diamonds", 2), pip("diamonds", 3), pip("diamonds", 5), pip("diamonds", 7)];
    expect(thinkBid({ ...s, hands: [weak, ...s.hands.slice(1)] as Card[][] }, 0)).toEqual({ kind: "nil" });
  });

  it("doesn't push the table's bids past 13", () => {
    const s = newGame(classic, 1);
    const strong = [14, 13, 12, 11, 10, 9].map((r) => pip("spades", r as 2)).concat([pip("hearts", 14), pip("clubs", 14), pip("diamonds", 14), pip("hearts", 2), pip("clubs", 2), pip("diamonds", 2), pip("hearts", 3)]);
    const bid = thinkBid({ ...s, turn: 0, bids: [null, t(5), t(4), t(3)], hands: [strong, ...s.hands.slice(1)] as Card[][] }, 0);
    expect(bid).toEqual(t(1));
  });
});

describe("thinking bots play whole games", () => {
  for (const preset of [classic, jokersAndDeuces, familyTable]) {
    it(`legally, to the end (${preset.name})`, () => {
      let s = newGame(preset, 42);
      for (let i = 0; i < 4000 && s.phase !== "finished"; i++) {
        const seat = ([0, 1, 2, 3] as Seat[]).find((x) => smartAction(s, x, { deals: 8 }))!;
        s = applyAction(s, smartAction(s, seat, { deals: 8 })!);
      }
      expect(s.phase).toBe("finished");
    }, 60_000);
  }
});
