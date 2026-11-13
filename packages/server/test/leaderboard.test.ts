import type { Bid, HandRecord } from "@spades/rules";
import { describe, expect, it } from "vitest";
import { leaderboard, type FinishedGame } from "../src/leaderboard.js";

const t = (count: number): Bid => ({ kind: "tricks", count });
const nil: Bid = { kind: "nil" };
const blind: Bid = { kind: "blind-nil" };

/** A hand: bids, tricks, and both teams' scores after it. */
function hand(bids: Bid[], tricksWon: number[], scores: [number, number]): HandRecord {
  const result = (team: 0 | 1) => ({ team, after: { points: scores[team], bags: 0 } }) as HandRecord["results"][0];
  return { handNumber: 0, dealer: 0, bids, tricksWon, results: [result(0), result(1)] };
}

const grammi = { kind: "member" as const, id: "g", name: "brokennil" };
const rick = { kind: "member" as const, id: "r", name: "Rick" };
const jimmy = { kind: "member" as const, id: "j", name: "Jimmy" };
const bot = (name: string) => ({ kind: "bot" as const, name });
const members = [
  { id: "g", name: "brokennil" },
  { id: "r", name: "Rick" },
  { id: "j", name: "Jimmy" },
  { id: "x", name: "Hasn't played" },
];

describe("leaderboard", () => {
  const games: FinishedGame[] = [
    // Grammi & Rick win from 150 behind; Grammi makes a nil, Rick misses a blind nil.
    {
      id: "a",
      seats: [grammi, bot("Hank"), rick, bot("Lou")],
      winner: 0,
      history: [hand([nil, t(4), blind, t(3)], [0, 6, 2, 5], [-50, 100]), hand([t(3), t(4), t(4), t(2)], [4, 3, 5, 1], [30, 0]), hand([t(5), t(2), t(4), t(2)], [6, 2, 4, 1], [510, 20])],
    },
    // Jimmy & a bot beat Grammi & Rick.
    { id: "b", seats: [grammi, jimmy, rick, bot("Dot")], winner: 1, history: [hand([t(3), t(4), t(3), t(3)], [3, 5, 2, 3], [-60, 520])] },
    // Grammi & Rick again, a win; Grammi makes a blind nil.
    { id: "c", seats: [grammi, bot("Hank"), rick, bot("Lou")], winner: 0, history: [hand([blind, t(3), t(5), t(4)], [0, 4, 6, 3], [510, 70])] },
  ];
  const board = leaderboard(games, members);

  it("counts games, wins and win rate per member, best first", () => {
    expect(board.games).toBe(3);
    expect(board.players.map((p) => [p.name, p.played, p.won, p.winPct])).toEqual([
      ["brokennil", 3, 2, 67],
      ["Rick", 3, 2, 67],
      ["Jimmy", 1, 1, 100],
      ["Hasn't played", 0, 0, null],
    ]);
  });

  it("counts nils and blind nils bid and made", () => {
    const g = board.players.find((p) => p.id === "g")!;
    const r = board.players.find((p) => p.id === "r")!;
    expect(g.nil).toEqual({ bid: 1, made: 1 });
    expect(g.blindNil).toEqual({ bid: 1, made: 1 });
    expect(r.blindNil).toEqual({ bid: 1, made: 0 });
    expect(board.highlights.mostNils).toEqual({ name: "brokennil", made: 2 });
  });

  it("tracks partners who are both members, and leaves bots out", () => {
    expect(board.partners).toEqual([{ ids: ["g", "r"], names: ["brokennil", "Rick"], played: 3, won: 2 }]);
  });

  it("finds the biggest comeback", () => {
    expect(board.highlights.biggestComeback).toEqual({ names: ["brokennil", "Rick"], behindBy: 150, final: [510, 20], game: "a" });
  });

  it("is empty but well-formed before any game", () => {
    const none = leaderboard([], members);
    expect(none.games).toBe(0);
    expect(none.players.every((p) => p.played === 0 && p.winPct === null)).toBe(true);
    expect(none.highlights).toEqual({ biggestComeback: null, mostNils: null });
  });
});
