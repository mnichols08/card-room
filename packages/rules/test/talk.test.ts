import { describe, expect, it } from "vitest";
import { pip } from "../src/cards.js";
import { applyAction, newGame, type GameState, type HandRecord } from "../src/game.js";
import { classic } from "../src/presets.js";
import { PERSONAS, greet, pickPersonas, reactToMove, replyTo, thinkingTime } from "../src/talk.js";
import { thinkBid, thinkCard } from "../src/smart.js";
import type { Bid, Seat } from "../src/types.js";

const always = () => 0; // dice that always say yes, and pick the first line
const cast = { bots: [{ seat: 1 as Seat, name: "Hank" }, { seat: 2 as Seat, name: "Dot" }, { seat: 3 as Seat, name: "Lou" }] };
const t = (count: number): Bid => ({ kind: "tricks", count });

/** A hand ending: who bid what and took how many, and whether each team made it. */
function handEnded(before: GameState, bids: Bid[], tricksWon: number[], made: [boolean | null, boolean | null]): GameState {
  const result = (team: 0 | 1) => ({ team, bid: 0, tricks: 0, made: made[team], contractPoints: 0, nilPoints: 0, bagsTaken: 0, bagPenalty: 0, delta: 0, after: { points: 0, bags: 0 } });
  const record: HandRecord = { handNumber: before.handNumber, dealer: 0, bids, tricksWon, results: [result(0), result(1)] };
  return { ...before, handNumber: before.handNumber + 1, history: [...before.history, record] };
}

describe("bots talking", () => {
  const start = newGame(classic, 3);

  it("cheer when their human partner makes a nil", () => {
    // Seat 0 is the person; Dot (seat 2) is her partner.
    const after = handEnded(start, [{ kind: "nil" }, t(4), t(5), t(4)], [0, 4, 5, 4], [true, true]);
    const remarks = reactToMove(start, after, cast, always);
    const dot = remarks.find((r) => r.seat === 2)!;
    expect(PERSONAS.Dot!.lines.partnerNilMade).toContain(dot.text);
  });

  it("grumble when their own team gets set, in character", () => {
    const after = handEnded(start, [t(3), t(6), t(3), t(5)], [3, 3, 4, 3], [true, false]);
    const hank = reactToMove(start, after, cast, always).find((r) => r.seat === 1)!;
    expect(PERSONAS.Hank!.lines.weGotSet).toContain(hank.text);
  });

  it("never more than two talk about one move, and they don't talk over each other", () => {
    const after = handEnded(start, [t(3), t(6), t(3), t(5)], [3, 3, 4, 3], [true, false]);
    const remarks = reactToMove(start, after, cast, always);
    expect(remarks.length).toBeLessThanOrEqual(2);
    if (remarks.length === 2) expect(remarks[1]!.delay).toBeGreaterThan(remarks[0]!.delay);
  });

  it("everyone says something at the end of the game, graciously", () => {
    const over: GameState = { ...start, phase: "finished", winner: 0 };
    const remarks = reactToMove(start, over, cast, always);
    expect(remarks.map((r) => r.seat).sort()).toEqual([1, 2, 3]);
    expect(PERSONAS.Dot!.lines.weWon).toContain(remarks.find((r) => r.seat === 2)!.text);
    expect(PERSONAS.Hank!.lines.theyWon).toContain(remarks.find((r) => r.seat === 1)!.text);
  });

  it("stay quiet when nothing happened", () => {
    expect(reactToMove(start, start, cast, always)).toEqual([]);
  });

  it("announce their own nil", () => {
    const bid = applyAction({ ...start, turn: 1 }, { type: "bid", seat: 1, bid: { kind: "nil" } });
    const remarks = reactToMove({ ...start, turn: 1 }, bid, cast, always);
    expect(remarks[0]).toMatchObject({ seat: 1 });
    expect(PERSONAS.Hank!.lines.goingNil).toContain(remarks[0]!.text);
  });

  it("say hello at the start, two at most", () => {
    expect(greet(cast, always).length).toBe(2);
  });
});

describe("bots answering chat", () => {
  it("the bot you name answers", () => {
    const [r] = replyTo("good luck Lou!", 0, cast, always);
    expect(r!.seat).toBe(3);
    expect(PERSONAS.Lou!.lines.replyLuck).toContain(r!.text);
  });

  it("otherwise your partner answers first, laughing with you", () => {
    const [r] = replyTo("😂😂", 0, cast, always);
    expect(r!.seat).toBe(2);
    expect(PERSONAS.Dot!.lines.replyLaugh).toContain(r!.text);
  });

  it("only one bot replies, and plain table talk needs no reply", () => {
    expect(replyTo("thanks everybody 👏", 0, cast, always)).toHaveLength(1);
    expect(replyTo("whose turn is it", 0, cast, always)).toEqual([]);
  });
});

describe("thinking time", () => {
  const forced: GameState = {
    ...newGame(classic, 1),
    phase: "playing",
    turn: 1,
    trick: [{ seat: 0, card: pip("hearts", 9) }],
    played: [{ seat: 0, card: pip("hearts", 9) }],
    hands: newGame(classic, 1).hands.map((h, i) => (i === 1 ? [pip("hearts", 4), ...h.filter((c) => c.kind === "pip" && c.suit !== "hearts").slice(0, 12)] : h)),
    bids: [t(3), t(3), t(3), t(3)],
  };

  it("is quick for a forced card and longer for a bid", () => {
    const quick = thinkingTime(forced, 1, "Dot", () => 0.5);
    const bid = thinkingTime({ ...newGame(classic, 1), turn: 1 }, 1, "Dot", () => 0.5);
    expect(quick).toBeLessThan(1200);
    expect(bid).toBeGreaterThan(1800);
    expect(bid).toBeLessThan(6000);
  });

  it("follows the persona's tempo", () => {
    const s = { ...newGame(classic, 1), turn: 1 as Seat };
    expect(thinkingTime(s, 1, "Hank", () => 0.5)).toBeLessThan(thinkingTime(s, 1, "Bea", () => 0.5));
  });
});

describe("the roster", () => {
  const roster = Object.values(PERSONAS);

  it("has fourteen partners, each with a blurb and something to say at every big moment", () => {
    expect(roster).toHaveLength(14);
    for (const p of roster) {
      expect(p.blurb.length, p.name).toBeGreaterThan(5);
      for (const event of ["hello", "weWon", "theyWon", "replyLaugh", "replyLuck"] as const) expect(p.lines[event]?.length, `${p.name} ${event}`).toBeGreaterThan(0);
    }
  });

  it("picks different partners for empty seats, skipping ones already seated", () => {
    const three = pickPersonas(3, () => 0.5, ["Dot"]);
    expect(new Set(three.map((p) => p.name)).size).toBe(3);
    expect(three.map((p) => p.name)).not.toContain("Dot");
  });
});

describe("play styles", () => {
  const hands = Array.from({ length: 120 }, (_, i) => newGame(classic, 500 + i));
  const bidsOf = (name: string) => hands.map((s) => thinkBid({ ...s, turn: 1 }, 1, PERSONAS[name]!.style));
  const total = (bids: Bid[]) => bids.reduce((n, b) => n + (b.kind === "tricks" ? b.count : 0), 0);
  const nils = (bids: Bid[]) => bids.filter((b) => b.kind !== "tricks").length;

  it("Duke bids bigger than Earl on the same hands", () => {
    expect(total(bidsOf("Duke"))).toBeGreaterThan(total(bidsOf("Earl")) + 60);
  });

  it("Tammy goes nil far more often than Earl", () => {
    expect(nils(bidsOf("Tammy"))).toBeGreaterThan(nils(bidsOf("Earl")) + 5);
  });

  it("a careless moment is still a legal card", () => {
    let s = newGame(classic, 9);
    for (let i = 0; i < 4; i++) s = applyAction(s, { type: "bid", seat: s.turn, bid: t(3) });
    for (let i = 0; i < 20; i++) {
      const card = thinkCard(s, s.turn, { style: { sloppy: 1 } }).card;
      s = applyAction(s, { type: "play", seat: s.turn, card }); // throws if it weren't legal
    }
    expect(s.played.length).toBe(20);
  });
});
