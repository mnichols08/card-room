import { describe, expect, it } from "vitest";
import { mulberry32 } from "@spades/rules";
import { americanCheckers, bestCheckersLine, checkers, checkersLines, friendlyCheckers, GameError, internationalCheckers, movesOffered, newCheckers, russianCheckers, type CheckersMove, type CheckersRules, type CheckersState } from "../src/index.js";

const c = checkers;
const SHARP = { skill: 1, sloppy: 0 };
const EASY = { skill: 0.25, sloppy: 0.3 };

/** A square by its name ("c3"): columns a… from the left, rows 1… from the bottom, where the side that opens starts. */
const sq = (name: string, n = 8) => (n - Number(name.slice(1))) * n + (name.charCodeAt(0) - 97);
const names = (cells: number[], n = 8) => cells.map((cell) => `${String.fromCharCode(97 + (cell % n))}${n - Math.floor(cell / n)}`).sort();

/**
 * A position: the first seat opened, so its men ("m") move up the board and its kings are "k";
 * the second seat's are "M" and "K". The first seat is to move unless `turn` says otherwise.
 */
function setup(rules: Partial<CheckersRules>, pieces: { m?: string; k?: string; M?: string; K?: string }, turn = 0): CheckersState {
  const r = c.normalize({ ...americanCheckers, ...rules, first: "seat1" });
  const s = newCheckers(r, 2, 1);
  s.cells = s.cells.map(() => null);
  let id = 0;
  for (const [kind, list] of Object.entries(pieces)) {
    for (const name of list.split(" ").filter(Boolean)) {
      const cell = sq(name, r.size);
      if ((Math.floor(cell / r.size) + (cell % r.size)) % 2 === 0) throw new Error(`${name} is a light square`);
      s.cells[cell] = { o: kind === "m" || kind === "k" ? 0 : 1, k: kind === "k" || kind === "K", id: id++ };
    }
  }
  s.turn = turn;
  s.seen = {};
  return s;
}
const move = (s: CheckersState, from: string, to: string): CheckersMove => ({ type: "move", from: sq(from, s.rules.size), to: sq(to, s.rules.size) });
/** Play squares in turn ("c3-d4", or "c3-e5-g7" for a run of jumps), whoever's turn it is. */
const play = (s: CheckersState, ...moves: string[]) =>
  moves.reduce((state, m) => {
    const stops = m.split("-");
    return stops.slice(1).reduce((st, to, i) => c.apply(st, st.turn, move(st, stops[i]!, to)), state);
  }, s);
/** What the seat to move is offered: each piece that can move, and where to. */
const offered = (s: CheckersState) => Object.fromEntries((c.view(s, s.turn).grids[0]!.select?.sources ?? []).map((src) => [names([src.from as number], s.rules.size)[0], names(src.to, s.rules.size)]));
const at = (s: CheckersState, name: string) => s.cells[sq(name, s.rules.size)];
const count = (s: CheckersState, seat: number) => s.cells.filter((p) => p?.o === seat).length;

describe("the opening", () => {
  it("American: twelve men each on the dark squares, dark moves first, seven ways to start", () => {
    const s = newCheckers({ ...americanCheckers, first: "seat1" }, 2, 1);
    expect([count(s, 0), count(s, 1)]).toEqual([12, 12]);
    expect(s.turn).toBe(0);
    expect(at(s, "a1")).toMatchObject({ o: 0, k: false });
    expect(at(s, "h8")).toMatchObject({ o: 1, k: false });
    expect(at(s, "a8")).toBeNull();
    const v = c.view(s, 0);
    expect(v.grids[0]).toMatchObject({ rows: 8, cols: 8, shade: "checker", flip: false });
    expect(v.grids[0]!.cells[sq("c3")]).toMatchObject({ owner: 0, kind: "man", label: "dark man", tone: "dark" });
    expect(v.players.map((p) => p.piece!.label)).toEqual(["dark man", "light man"]);
    expect(v.players[0]).toMatchObject({ line: "12 pieces", badge: "Goes first" });
    expect(movesOffered(v)).toHaveLength(7);
    expect(offered(s)).toEqual({ a3: ["b4"], c3: ["b4", "d4"], e3: ["d4", "f4"], g3: ["f4", "h4"] });
    // The other seat sees the same board from its own side, and has nothing to do yet.
    const theirs = c.view(s, 1);
    expect(theirs.grids[0]!.flip).toBe(true);
    expect(theirs.grids[0]!.cells).toEqual(v.grids[0]!.cells);
    expect(theirs.grids[0]!.select).toBeNull();
  });

  it("International: a 10×10 board, twenty men each, light moves first, nine ways to start", () => {
    const s = newCheckers({ ...internationalCheckers, first: "seat2" }, 2, 1);
    expect([count(s, 0), count(s, 1), s.cells.length]).toEqual([20, 20, 100]);
    expect(s.turn).toBe(1);
    const v = c.view(s, 1);
    // Whoever moves first is at the bottom of the board as it is kept, so they see it unturned.
    expect(v.grids[0]).toMatchObject({ rows: 10, cols: 10, flip: false });
    expect(v.players.map((p) => p.piece!.label)).toEqual(["dark man", "light man"]);
    expect(movesOffered(v)).toHaveLength(9);
    expect(c.view(s, 0).grids[0]!.flip).toBe(true);
  });

  it("who moves first is the luck of the draw unless the rules say", () => {
    const firsts = new Set(Array.from({ length: 20 }, (_, seed) => newCheckers(americanCheckers, 2, seed).first));
    expect(firsts).toEqual(new Set([0, 1]));
    expect(newCheckers({ ...americanCheckers, first: "seat2" }, 2, 3).first).toBe(1);
  });

  it("counts the moves from the opening as the books do (American)", () => {
    // A run of jumps is one move, however many taps it takes.
    const perft = (s: CheckersState, depth: number): number => {
      if (depth === 0) return 1;
      let n = 0;
      for (const m of movesOffered(c.view(s, s.turn))) {
        const next = c.apply(s, s.turn, m);
        n += perft(next, next.jump ? depth : depth - 1);
      }
      return n;
    };
    const s = newCheckers({ ...americanCheckers, first: "seat1" }, 2, 1);
    expect([1, 2, 3, 4, 5].map((d) => perft(s, d))).toEqual([7, 49, 302, 1469, 7361]);
    // And the big board, to the same published counts.
    const big = newCheckers({ ...internationalCheckers, first: "seat1" }, 2, 1);
    expect([1, 2, 3].map((d) => perft(big, d))).toEqual([9, 81, 658]);
  });
});

describe("moving and capturing", () => {
  it("men move one square forwards; a capture has to be taken when it's there", () => {
    const quiet = setup({}, { m: "c3", M: "f6" });
    expect(offered(quiet)).toEqual({ c3: ["b4", "d4"] });
    expect(() => c.apply(quiet, 0, move(quiet, "c3", "b2"))).toThrow("can't go there");
    expect(() => c.apply(quiet, 0, move(quiet, "f6", "e5"))).toThrow("not your piece");
    const s = setup({}, { m: "c3 g1", M: "d4 h8" });
    expect(offered(s)).toEqual({ c3: ["e5"] });
    expect(() => c.apply(s, 0, move(s, "g1", "h2"))).toThrow("have to capture");
    // The piece that has to capture is lit, for both players.
    for (const seat of [0, 1]) expect(c.view(s, seat).grids[0]!.marks).toContainEqual({ cell: sq("c3"), mark: "must" });
    expect(c.view(s, 0).info).toContain("A capture has to be taken");
    const after = play(s, "c3-e5");
    expect(at(after, "d4")).toBeNull();
    expect(at(after, "e5")).toMatchObject({ o: 0 });
    expect(after.turn).toBe(1);
    expect(after.narration).toBe("{0} jumps c3×e5");
    const v = c.view(after, 1);
    expect(v.reserves.find((r) => r.owner === 0)!.pieces).toEqual([
      { piece: expect.objectContaining({ owner: 1, kind: "man" }), count: 1 },
      { piece: expect.objectContaining({ owner: 1, kind: "king" }), count: 0 },
    ]);
    expect(v.grids[0]!.marks).toEqual(expect.arrayContaining([{ cell: sq("c3"), mark: "from" }, { cell: sq("e5"), mark: "last" }]));
  });

  it("Friendly: captures are there to take or leave", () => {
    const s = setup(friendlyCheckers, { m: "c3 g1", M: "d4" });
    expect(offered(s)).toEqual({ c3: ["b4", "e5"], g1: ["f2", "h2"] });
    expect(c.view(s, 0).grids[0]!.marks!.some((m) => m.mark === "must")).toBe(false);
    expect(play(s, "g1-h2").turn).toBe(1);
    expect(at(play(s, "c3-e5"), "d4")).toBeNull();
  });

  it("a run of jumps is made a hop at a time, and the turn stays until it's done", () => {
    const s = setup({}, { m: "a1 g1", M: "b2 d4 d6" });
    const hop = play(s, "a1-c3");
    // Still the same seat's move, with the piece in hand and only its next jump on offer.
    expect(hop.turn).toBe(0);
    expect(hop.jump).toMatchObject({ from: sq("a1"), at: sq("c3"), over: [sq("b2")] });
    const v = c.view(hop, 0);
    expect(v.grids[0]!.select).toEqual({ type: "move", sources: [{ from: sq("c3"), to: [sq("e5")] }], held: sq("c3") });
    expect(v.choices).toBeNull();
    // The piece jumped stays where it is, faded, until the move is over.
    expect(v.grids[0]!.cells[sq("b2")]).toMatchObject({ owner: 1, faded: true });
    expect(v.reserves.find((r) => r.owner === 0)!.pieces[0]!.count).toBe(0);
    expect(c.view(hop, 1).grids[0]!.select).toBeNull();
    expect(c.view(hop, 1).turn).toBe(0);
    expect(() => c.apply(hop, 0, move(hop, "g1", "h2"))).toThrow("Carry on");
    expect(() => c.apply(hop, 0, { type: "stop" })).toThrow("finish the capture");
    expect(() => c.apply(hop, 1, move(hop, "d6", "c5"))).toThrow("not your turn");
    expect(c.bot(hop, 0, EASY)).toEqual(move(hop, "c3", "e5"));
    expect(c.bot(hop, 1, SHARP)).toBeNull();
    const done = play(hop, "c3-e5", "e5-c7");
    expect(done.turn).toBe(1);
    expect(done.jump).toBeNull();
    expect([count(done, 0), count(done, 1)]).toEqual([2, 0]);
    expect(done.taken[0]).toEqual({ men: 3, kings: 0 });
    expect(done.last).toEqual(["a1", "c3", "e5", "c7"].map((n) => sq(n)));
    // Every square it stood on is marked.
    expect(c.view(done, 1).grids[0]!.marks!.filter((m) => m.mark === "from").map((m) => m.cell)).toEqual(["a1", "c3", "e5"].map((n) => sq(n)));
  });

  it("Friendly: a run of jumps can stop wherever you like", () => {
    const s = setup(friendlyCheckers, { m: "a1", M: "b2 d4 h8" });
    const hop = play(s, "a1-c3");
    expect(hop.turn).toBe(0);
    const v = c.view(hop, 0);
    expect(v.choices!.options.map((o) => [o.label, o.move])).toEqual([["Stop here", { type: "stop" }]]);
    expect(movesOffered(v)).toEqual([move(hop, "c3", "e5"), { type: "stop" }]);
    const stopped = c.apply(hop, 0, { type: "stop" });
    expect(stopped.turn).toBe(1);
    expect([at(stopped, "b2"), at(stopped, "d4")?.o, at(stopped, "c3")?.o]).toEqual([null, 1, 0]);
    expect(() => c.apply(s, 0, { type: "stop" })).toThrow("haven't moved");
  });

  it("men capture backwards only where the rules say", () => {
    const pieces = { m: "e5", M: "d4 h8" };
    expect(offered(setup({}, pieces))).toEqual({ e5: ["d6", "f6"] });
    expect(offered(setup(russianCheckers, pieces))).toEqual({ e5: ["c3"] });
    expect(offered(setup({ ...internationalCheckers, size: 8 }, pieces))).toEqual({ e5: ["c3"] });
    // They still only move forwards.
    expect(offered(setup(russianCheckers, { m: "e5", M: "h8" }))).toEqual({ e5: ["d6", "f6"] });
  });

  it("any capture will do in American and Russian; International insists on the biggest", () => {
    // c3 can take one piece; g3 can take two.
    const pieces = { m: "c3 g3", M: "b4 f4 d6 h8" };
    expect(offered(setup({}, pieces))).toEqual({ c3: ["a5"], g3: ["e5"] });
    expect(offered(setup(russianCheckers, pieces))).toEqual({ c3: ["a5"], g3: ["e5"] });
    const s = setup({ ...internationalCheckers, size: 8 }, pieces);
    expect(offered(s)).toEqual({ g3: ["e5"] });
    expect(() => c.apply(s, 0, move(s, "c3", "a5"))).toThrow("takes the most");
    expect(c.view(s, 0).info).toContain("The biggest capture has to be taken");
    expect(c.view(s, 0).grids[0]!.marks!.filter((m) => m.mark === "must")).toEqual([{ cell: sq("g3"), mark: "must" }]);
    expect(count(play(s, "g3-e5", "e5-c7"), 1)).toBe(2);
  });

  it("the biggest capture is counted to its end, not by its first hop", () => {
    // From e3 the left jump leads on to a second; the right one doesn't.
    const s = setup({ ...internationalCheckers, size: 8 }, { m: "e3", M: "d4 f4 b6 h8" });
    expect(offered(s)).toEqual({ e3: ["c5"] });
    expect(offered(setup(russianCheckers, { m: "e3", M: "d4 f4 b6 h8" }))).toEqual({ e3: ["c5", "g5"] });
  });
});

describe("kings", () => {
  it("a man that reaches the far row is crowned", () => {
    const s = play(setup({}, { m: "c7", M: "h8 h6" }), "c7-d8");
    expect(at(s, "d8")).toMatchObject({ o: 0, k: true });
    expect(s.narration).toBe("{0} moves c7 to d8 and is crowned");
    expect(c.view(s, 1).grids[0]!.cells[sq("d8")]).toMatchObject({ kind: "king", glyph: "♛", label: "dark king" });
  });

  it("American kings move and capture one square, any way", () => {
    expect(offered(setup({}, { k: "d4", M: "h8" }))).toEqual({ d4: ["c3", "c5", "e3", "e5"] });
    expect(offered(setup({}, { k: "d4", M: "c3 g7" }))).toEqual({ d4: ["b2"] });
    // Not from a distance.
    expect(offered(setup({}, { k: "a1", M: "c3 h8" }))).toEqual({ a1: ["b2"] });
  });

  it("flying kings move any distance, and capture from a distance landing anywhere beyond", () => {
    expect(offered(setup(russianCheckers, { k: "c1", M: "h8" }))).toEqual({ c1: ["a3", "b2", "d2", "e3", "f4", "g5", "h6"] });
    // Pieces in the way stop it: its own, or two of theirs in a row.
    expect(offered(setup(russianCheckers, { k: "a1", m: "c3", M: "h8" })).a1).toEqual(["b2"]);
    expect(offered(setup(russianCheckers, { k: "a1", M: "c3 d4 h8" }))).toEqual({ a1: ["b2"] });
    const s = setup(russianCheckers, { k: "a1", M: "c3 h8" });
    expect(offered(s)).toEqual({ a1: ["d4", "e5", "f6", "g7"] });
    const after = play(s, "a1-f6");
    expect([at(after, "c3"), at(after, "f6")?.k, after.turn]).toEqual([null, true, 1]);
    expect(after.taken[0]).toEqual({ men: 1, kings: 0 });
  });

  it("a flying king has to land where its capture carries on", () => {
    // Past c3 it could stop on d4, e5 or f6, but only from e5 is there another piece to take (g3).
    const s = setup(russianCheckers, { k: "a1", M: "c3 g3 h8" });
    expect(offered(s)).toEqual({ a1: ["e5"] });
    expect(offered(play(s, "a1-e5"))).toEqual({ e5: ["h2"] });
  });

  it("pieces jumped come off when the move is done, and can't be jumped or passed again", () => {
    // The king takes d4, g5 and g3, and ends on f2 looking back along a line through d4 at c5.
    // If d4 had come off when it was jumped, c5 would go as well.
    for (const rules of [russianCheckers, { ...internationalCheckers, size: 8 }]) {
      let s = setup(rules, { k: "b2", M: "d4 g5 g3 c5" });
      s = play(s, "b2-f6", "f6-h4");
      expect(s.turn).toBe(0);
      expect(c.view(s, 0).grids[0]!.cells.filter((p) => p?.faded)).toHaveLength(2);
      expect(offered(s)).toEqual({ h4: ["e1", "f2"] });
      s = play(s, "h4-f2");
      expect(s.turn).toBe(1);
      expect(s.taken[0]).toEqual({ men: 3, kings: 0 });
      expect(names(s.cells.flatMap((p, i) => (p?.o === 1 ? [i] : [])))).toEqual(["c5"]);
    }
  });

  it("a captured king is counted as a king", () => {
    const s = play(setup({}, { m: "c3", M: "h8", K: "d4" }), "c3-e5");
    expect(s.taken[0]).toEqual({ men: 0, kings: 1 });
    expect(c.view(s, 0).reserves.find((r) => r.owner === 0)!.pieces[1]).toMatchObject({ piece: { kind: "king", owner: 1 }, count: 1 });
  });
});

describe("reaching the far row in the middle of a capture", () => {
  // The man on b6 jumps c7 and lands on d8, where there is e7 still to take.
  const pieces = { m: "b6", M: "c7 e7 a3" };

  it("American: crowned, and the move ends there", () => {
    // (With American men, which never capture backwards, a man can't carry on anyway; this is the
    // rule for a house that lets them.)
    const s = play(setup({ backward: true }, pieces), "b6-d8");
    expect(s.turn).toBe(1);
    expect(at(s, "d8")).toMatchObject({ k: true });
    expect(at(s, "e7")).toMatchObject({ o: 1 });
    expect(s.narration).toBe("{0} jumps b6×d8 and is crowned");
  });

  it("Russian: crowned on the spot, and carries on as a king", () => {
    const s = play(setup(russianCheckers, pieces), "b6-d8");
    expect(s.turn).toBe(0);
    expect(at(s, "d8")).toMatchObject({ k: true });
    expect(c.view(s, 0).grids[0]!.cells[sq("d8")]).toMatchObject({ kind: "king" });
    // As a flying king it lands anywhere past e7.
    expect(offered(s)).toEqual({ d8: ["f6", "g5", "h4"] });
    const done = play(s, "d8-g5");
    expect([done.turn, at(done, "g5")?.k, count(done, 1)]).toEqual([1, true, 1]);
    expect(done.narration).toBe("{0} jumps b6×d8×g5, taking 2 and is crowned");
  });

  it("International: it carries on as a man, and is only crowned if it ends there", () => {
    const rules = { ...internationalCheckers, size: 8 };
    const s = play(setup(rules, pieces), "b6-d8");
    expect(s.turn).toBe(0);
    expect(at(s, "d8")).toMatchObject({ k: false });
    // As a man: one square past e7 and no further.
    expect(offered(s)).toEqual({ d8: ["f6"] });
    const done = play(s, "d8-f6");
    expect([done.turn, at(done, "f6")?.k, count(done, 1)]).toEqual([1, false, 1]);
    // Ending on the far row is another matter.
    const ends = play(setup(rules, { m: "b6", M: "c7 a3" }), "b6-d8");
    expect(at(ends, "d8")).toMatchObject({ k: true });
    // And the real thing, on the big board.
    const big = play(setup(internationalCheckers, { m: "b8", M: "c9 e9 a1" }), "b8-d10", "d10-f8");
    expect([big.turn, big.cells[sq("f8", 10)]?.k]).toEqual([1, false]);
  });
});

describe("how a game ends", () => {
  it("taking the last piece wins", () => {
    const s = play(setup({}, { m: "c3", M: "d4" }), "c3-e5");
    expect(c.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: "1 to 0" });
    expect(s.narration).toBe("{0} has taken every piece: {0} wins!");
    const v = c.view(s, 1);
    expect(v.over).toEqual({ winners: [0], title: "{0} wins!" });
    expect(movesOffered(v)).toEqual([]);
    expect(() => c.apply(s, 1, move(s, "e5", "f6"))).toThrow("over");
  });

  it("a player with pieces but no move loses", () => {
    // The light man on a5 is hemmed in once b4 is covered from behind.
    const s = play(setup({}, { m: "b4 d2", M: "a5" }), "d2-c3");
    expect(count(s, 1)).toBe(1);
    expect(c.summary(s)).toMatchObject({ over: true, winners: [0] });
    expect(s.narration).toBe("{1} has no move left: {0} wins!");
  });

  it("the same position three times is a draw", () => {
    let s = setup({}, { k: "a1", K: "h8" });
    for (let i = 0; i < 2; i++) {
      s = play(s, "a1-b2", "h8-g7", "b2-a1", "g7-h8");
      expect(c.summary(s).over).toBe(false);
    }
    // The position after this move has now been reached three times.
    s = play(s, "a1-b2");
    expect(c.summary(s)).toMatchObject({ over: true, winners: [0, 1], scoreLine: "0 to 0 · 1 drawn" });
    expect(s.narration).toBe("The same position three times: it's a draw");
    expect(c.view(s, 0).over!.title).toBe("It's a draw!");
  });

  it("so many moves each with no capture and no man moved is a draw", () => {
    // Kings wandering, never the same position three times: 10 moves each here.
    let s = setup({ quiet: 10 }, { k: "a1 c1", K: "h8 f8" });
    for (let ply = 0; ply < 20; ply++) {
      expect(c.summary(s).over, `ply ${ply}`).toBe(false);
      expect(s.quiet).toBe(ply);
      const fresh = movesOffered(c.view(s, s.turn))
        .map((m) => c.apply(s, s.turn, m as CheckersMove))
        .find((next) => Object.values(next.seen).every((n) => n === 1) && !checkersLines(next).some((l) => l.over.length) && next.taken.every((t) => t.kings === 0));
      s = fresh!;
    }
    expect(c.summary(s)).toMatchObject({ over: true, winners: [0, 1] });
    expect(s.narration).toBe("10 moves each with no capture and no man moved: it's a draw");
    // The table warns when it's getting close.
    const near = { ...setup({ quiet: 10 }, { k: "a1", K: "h8" }), quiet: 16 };
    expect(c.view(near, 0).info).toContain("A draw in 2 more moves each without a capture");
  });

  it("a capture or a man's move starts the count again", () => {
    let s = setup({}, { k: "a1", m: "g1", K: "h8" });
    s = play(s, "a1-b2", "h8-g7", "b2-a1");
    expect(s.quiet).toBe(3);
    expect(Object.keys(s.seen)).toHaveLength(3);
    s = play(s, "g7-h8", "g1-h2");
    expect(s.quiet).toBe(0);
    expect(Object.keys(s.seen)).toHaveLength(1);
  });

  it("a match: most wins takes it, and the players take turns moving first", () => {
    const rules = c.normalize({ ...americanCheckers, games: 3, first: "seat1" });
    let s = newCheckers(rules, 2, 1);
    // Game 1 to the first seat, the quick way.
    const win = (state: CheckersState, seat: number): CheckersState => {
      const t = { ...state, cells: state.cells.map(() => null) } as CheckersState;
      const [mine, theirs] = state.first === seat ? ["c3", "d4"] : ["f6", "e5"];
      t.cells[sq(mine)] = { o: seat, k: false, id: 0 };
      t.cells[sq(theirs)] = { o: 1 - seat, k: false, id: 1 };
      t.turn = seat;
      return c.apply(t, seat, move(t, mine, state.first === seat ? "e5" : "d4"));
    };
    s = win(s, 0);
    expect(s.phase).toBe("scored");
    expect(c.summary(s)).toMatchObject({ over: false, hand: 1, scoreLine: "1 to 0" });
    const v = c.view(s, 1);
    expect(v.result).toMatchObject({ title: "{0} wins game 1", rows: [{ label: "Wins", values: ["1", "0"] }] });
    expect(v.choices!.options[0]).toMatchObject({ label: "Next game", move: { type: "next" } });
    expect(c.bot(s, 1, SHARP)).toEqual({ type: "next" });
    s = c.apply(s, 0, { type: "next" });
    expect(() => c.apply(s, 0, { type: "next" })).toThrow(GameError);
    s = c.apply(s, 1, { type: "next" });
    // A fresh board, and the other seat has the first move (and the colour that opens).
    expect([s.phase, s.round, s.first, s.turn, count(s, 0), count(s, 1)]).toEqual(["playing", 2, 1, 1, 12, 12]);
    expect(c.view(s, 0).players.map((p) => p.piece!.label)).toEqual(["light man", "dark man"]);
    expect(c.view(s, 0).info).toContain("Game 2 of 3");
    expect(c.view(s, 0).grids[0]!.flip).toBe(true);
    s = win(s, 0);
    // Two up with one to play: it's over.
    expect(c.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: "2 to 0" });
    expect(c.view(s, 1).over).toEqual({ winners: [0], title: "{0} wins 2 to 0!" });
  });
});

describe("house rules", () => {
  it("come out as rules whatever goes in", () => {
    expect(c.normalize({ id: "x", name: "Ours", size: 9, crowning: "fly", opens: "red", quiet: 500, games: 4, most: true, forced: false })).toEqual({ ...americanCheckers, id: "x", name: "Ours", forced: false, most: false, quiet: 100 });
    expect(c.normalize({ id: "checkers-international", games: 3 })).toEqual({ ...internationalCheckers, games: 3 });
    expect(c.validate({ ...americanCheckers, forced: false, most: true })).toHaveLength(1);
    for (const p of c.presets) expect(c.validate(p)).toEqual([]);
  });

  it("say themselves in sentences", () => {
    expect(c.describe(americanCheckers).join(" ")).toMatch(/8×8 board, 12 men each.*forwards only.*one square at a time.*have to/);
    expect(c.describe(internationalCheckers).join(" ")).toMatch(/10×10 board, 20 men each.*Light moves first.*or backwards.*fly.*takes the most.*carries on as a man/);
    expect(c.describe(russianCheckers).join(" ")).toMatch(/whichever you like.*carries on as a king/);
    expect(c.describe(friendlyCheckers).join(" ")).toMatch(/never forced/);
  });
});

describe("the computer players", () => {
  it("take what's hanging, and don't hang their own", () => {
    // Friendly, so nothing is forced: it takes the free man because it's good, not because it must.
    const free = setup(friendlyCheckers, { m: "c3 a1 e1", M: "d4 h8 f8" });
    expect(c.bot(free, 0, SHARP)).toEqual(move(free, "c3", "e5"));
    // Moving to d4 would be jumped by e5 (c3 is empty behind it); b4 is safe.
    const careful = setup({}, { m: "c3", M: "e5 h8" });
    expect(c.bot(careful, 0, SHARP)).toEqual(move(careful, "c3", "b4"));
  });

  it("see a run of jumps as one move, and play it hop by hop", () => {
    // Two captures on offer: one piece, or three.
    let s = setup({}, { m: "a1 g1", M: "b2 d4 d6 h2 f8 h8" });
    expect(bestCheckersLine(s, 6, 50_000)).toMatchObject({ from: sq("a1"), steps: [sq("c3"), sq("e5"), sq("c7")] });
    for (let hop = 0; hop < 3; hop++) s = c.apply(s, 0, c.bot(s, 0, SHARP)!);
    expect([s.turn, s.taken[0]!.men]).toEqual([1, 3]);
  });

  it("stop a run of jumps that would cost more than it wins, where stopping is allowed", () => {
    // The king is safe on the edge at a3. Jumping on over b4 lands it on c5, where d6 takes it.
    const s = play(setup(friendlyCheckers, { k: "c1", m: "h2", M: "b2 b4 d6 e7 h8" }), "c1-a3");
    expect(s.turn).toBe(0);
    expect(bestCheckersLine(s, 6, 50_000)).toMatchObject({ from: sq("a3"), steps: [] });
    expect(c.bot(s, 0, SHARP)).toEqual({ type: "stop" });
    // Where captures are forced there is nothing to decide.
    const forced = play(setup({}, { k: "c1", m: "h2", M: "b2 b4 d6 e7 h8" }), "c1-a3");
    expect(c.bot(forced, 0, SHARP)).toEqual(move(forced, "a3", "c5"));
  });

  it("the sharp one beats the careless one over a series, on both boards", () => {
    for (const rules of [americanCheckers, internationalCheckers]) {
      const rand = mulberry32(21);
      let sharp = 0;
      let lost = 0;
      for (let game = 0; game < 6; game++) {
        // Taking turns to move first.
        let s = newCheckers({ ...rules, first: game % 2 ? "seat2" : "seat1" }, 2, game);
        while (!c.summary(s).over) s = c.apply(s, s.turn, (c.bot as any)(s, s.turn, s.turn === 0 ? SHARP : EASY, rand));
        if (s.roundWinner === 0) sharp++;
        if (s.roundWinner === 1) lost++;
      }
      expect(sharp, rules.name).toBeGreaterThanOrEqual(5);
      expect(lost, rules.name).toBe(0);
    }
  }, 60_000);

  it("think for less time in the middle of a run of jumps", () => {
    const s = setup({}, { m: "a1", M: "b2 d4 h8" });
    expect(c.thinkingTime(play(s, "a1-c3"), 0)).toBeLessThan(c.thinkingTime(s, 0));
  });
});
