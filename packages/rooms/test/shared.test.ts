import { describe, expect, it } from "vitest";
import { sharedView } from "../src/server.js";

const card = (id: string) => ({ kind: "pip", id });

describe("a view for someone watching", () => {
  const seat = (me: number, hand: string[], moves: string[] | null) => ({
    me,
    turn: 1,
    hand: hand.map(card),
    moves,
    players: [{ cards: 2, line: "Bid 3" }, { cards: 1, line: "Bid 2" }],
    trick: [card("Q♠")],
    grid: [card("A♥"), me === 0 ? card("7♣") : null, null],
    note: me === 1 ? "You drew the 4♦" : null,
    scores: { us: 40, them: 25 },
  });
  const views = [seat(0, ["K♥", "2♣"], null), seat(1, ["9♦"], ["play", "pass"])];

  it("keeps what every seat sees alike and drops what any seat sees differently", () => {
    const watch = sharedView(views, { blank: { hand: [] }, from: { seat: 0, keys: ["me"] } });
    expect(watch).toEqual({
      me: 0,
      turn: 1,
      hand: [],
      moves: null,
      players: [{ cards: 2, line: "Bid 3" }, { cards: 1, line: "Bid 2" }],
      trick: [card("Q♠")],
      // The card only seat 0 has peeked at stays face down.
      grid: [card("A♥"), null, null],
      note: null,
      scores: { us: 40, them: 25 },
    });
    expect(JSON.stringify(watch)).not.toMatch(/K♥|2♣|9♦|7♣|4♦/);
  });

  it("shows nothing of a private part it wasn't told about, either", () => {
    const watch = sharedView(views) as unknown as { hand: unknown; me: unknown };
    expect(watch.hand).toEqual([]); // hands of different sizes: an empty list
    expect(watch.me).toBeNull();
    const sameSize = sharedView([seat(0, ["K♥"], null), seat(1, ["9♦"], null)]) as unknown as { hand: unknown };
    expect(JSON.stringify(sameSize.hand)).not.toMatch(/K♥|9♦/);
  });

  it("a table for one shows the whole game: there's nobody to keep it from", () => {
    const only = seat(0, ["K♥"], ["play"]);
    expect(sharedView([only])).toEqual(only);
  });

  it("looks on from whichever seat is asked for", () => {
    expect(sharedView(views, { from: { seat: 1, keys: ["me"] } }).me).toBe(1);
  });
});
