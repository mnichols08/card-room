import { describe, expect, it } from "vitest";
import { mulberry32 } from "@spades/rules";
import { bestReversiMove, bigReversi, classicReversi, discCount, flipsFor, GameError, legalMoves, movesOffered, newReversi, reversi, smallReversi, type ReversiMove, type ReversiRules, type ReversiState } from "../src/index.js";

const t = reversi;
const SHARP = { skill: 1, sloppy: 0 };
const EASY = { skill: 0.25, sloppy: 0.3 };
/** A game with the first seat as dark, unless the rules name the second (the presets leave it to luck). */
const start = (rules: Partial<ReversiRules> = {}, seed = 1) => newReversi(t.normalize({ ...classicReversi, ...rules, first: rules.first === "seat2" ? "seat2" : "seat1" }), 2, seed);
/** A cell by its name: "d3" is column d, row 3 from the top. */
const at = (n: number, name: string) => (Number(name.slice(1)) - 1) * n + (name.charCodeAt(0) - 97);
const place = (cell: number): ReversiMove => ({ type: "place", cell });
/** Play cells by name in turn, whoever's turn it is. */
const play = (s: ReversiState, ...names: string[]) => names.reduce((state, name) => t.apply(state, state.turn, place(at(state.rules.size, name))), s);
/** A board drawn out: D for dark, L for light, a dot for empty. Dark (the first seat, unless a state is given) is to move. */
function drawn(rows: string[], rules: Partial<ReversiRules> = {}, from?: ReversiState): ReversiState {
  const s = from ?? start({ ...rules, size: rows.length });
  const cells = rows.flatMap((row) => [...row.replace(/ /g, "")].map((ch) => (ch === "D" ? s.first : ch === "L" ? 1 - s.first : null)));
  expect(cells).toHaveLength(s.rules.size ** 2);
  return { ...s, cells, turn: s.first };
}
const marked = (s: ReversiState, seat: number, mark: string) => t.view(s, seat).grids[0]!.marks!.filter((m) => m.mark === mark).map((m) => m.cell);
const names = (n: number, cells: number[]) => cells.map((c) => `${String.fromCharCode(97 + (c % n))}${Math.floor(c / n) + 1}`).sort();

/** The shortest game there is: dark takes every disc in nine moves. */
const WIPEOUT = ["e6", "f4", "e3", "f6", "g5", "d6", "e7", "f5", "c5"];

describe("the start", () => {
  it("is four discs in the middle with dark to move", () => {
    const s = start();
    expect(s.turn).toBe(0);
    expect(discCount(s.cells)).toEqual([2, 2]);
    const v = t.view(s, 0);
    expect(v.grids[0]).toMatchObject({ rows: 8, cols: 8, tap: { type: "place" } });
    expect(v.grids[0]!.cells[at(8, "e4")]).toMatchObject({ owner: 0, kind: "disc", label: "dark", tone: "dark" });
    expect(v.grids[0]!.cells[at(8, "d4")]).toMatchObject({ owner: 1, kind: "disc", label: "light", tone: "light" });
    expect(names(8, v.grids[0]!.tap!.cells)).toEqual(["c4", "d3", "e6", "f5"]);
    expect(v.grids[0]!.coords).toEqual({ cols: ["a", "b", "c", "d", "e", "f", "g", "h"], rows: ["1", "2", "3", "4", "5", "6", "7", "8"] });
    expect(v.narration).toBe("You're dark: you go first");
    expect(v.players.map((p) => [p.line, p.piece!.label, p.badge])).toEqual([["2 discs", "dark", "Goes first"], ["2 discs", "light", undefined]]);
    // The other seat waits, and is shown nowhere to go.
    const waiting = t.view(s, 1);
    expect(waiting.grids[0]!.tap).toBeNull();
    expect(waiting.grids[0]!.marks).toEqual([]);
    expect(waiting.narration).toBeNull();
  });

  it("is the same on every size of board", () => {
    for (const preset of [smallReversi, classicReversi, bigReversi]) {
      const s = start(preset);
      expect(s.cells).toHaveLength(preset.size ** 2);
      expect(discCount(s.cells)).toEqual([2, 2]);
      expect(legalMoves(s.cells, preset.size, 0)).toHaveLength(4);
      expect(legalMoves(s.cells, preset.size, 1)).toHaveLength(4);
    }
  });

  it("dark is the seat the rules name, or the luck of the seed", () => {
    expect(start({ first: "seat2" }).turn).toBe(1);
    const firsts = new Set(Array.from({ length: 20 }, (_, seed) => newReversi(classicReversi, 2, seed).turn));
    expect(firsts.size).toBe(2);
    const s = play(start({ first: "seat2" }), "d3");
    expect(t.view(s, 0).grids[0]!.cells[at(8, "d3")]).toMatchObject({ owner: 1, label: "dark" });
    expect(t.view(s, 0).players.map((p) => p.piece!.label)).toEqual(["light", "dark"]);
  });
});

describe("flipping", () => {
  const STEPS = [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]] as const;
  const n = 8;
  const origin = 3 * n + 3;
  const along = (dr: number, dc: number, k: number) => origin + dr * k * n + dc * k;

  it("traps a line in each of the eight directions", () => {
    for (const [dr, dc] of STEPS) {
      // Two of theirs and then one of mine, out from the empty cell.
      const cells = Array<number | null>(n * n).fill(null);
      cells[along(dr, dc, 1)] = cells[along(dr, dc, 2)] = 1;
      cells[along(dr, dc, 3)] = 0;
      expect(flipsFor(cells, n, origin, 0)).toEqual([along(dr, dc, 1), along(dr, dc, 2)]);
      expect(legalMoves(cells, n, 0)).toEqual([origin]);
      // Light can't play there: nothing of dark's would be trapped.
      expect(flipsFor(cells, n, origin, 1)).toEqual([]);
      const s = t.apply({ ...start(), cells }, 0, place(origin));
      expect(discCount(s.cells)).toEqual([4, 0]);
      expect(s.flipped).toEqual([along(dr, dc, 1), along(dr, dc, 2)]);
    }
  });

  it("flips every direction at once, and nothing else", () => {
    const cells = Array<number | null>(n * n).fill(null);
    for (const [dr, dc] of STEPS) {
      cells[along(dr, dc, 1)] = 1;
      cells[along(dr, dc, 2)] = 0;
    }
    // A light disc a knight's move away isn't on any line.
    cells[along(1, 0, 2) + 1] = 1;
    const s = t.apply({ ...start(), cells, turn: 0 }, 0, place(origin));
    expect(s.flipped).toHaveLength(8);
    expect(discCount(s.cells)).toEqual([17, 1]);
    expect(marked(s, 1, "flipped").sort()).toEqual([...s.flipped].sort());
    expect(marked(s, 1, "last")).toEqual([origin]);
    expect(s.narration).toBe("{0} plays d4, flipping 8");
  });

  it("needs one of your own at the far end: not a gap, and not the edge", () => {
    const s = drawn(["LLLD....", "........", "LL.D....", "........", "DLLL....", "........", "........", "........"]);
    const n8 = (name: string) => at(8, name);
    // Row 3: a gap between the light discs and the dark one.
    expect(flipsFor(s.cells, 8, n8("c3"), 0)).toEqual([]);
    // Row 5: dark, three light, then an empty cell: dark can close it, and flips all three.
    expect(flipsFor(s.cells, 8, n8("e5"), 0)).toEqual([n8("d5"), n8("c5"), n8("b5")]);
    // Row 1 runs into the edge: there is nowhere to close it from.
    expect(legalMoves(s.cells, 8, 0)).toEqual([n8("e5")]);
    // Lines don't wrap round the edge of the board onto the next row.
    const wrap = drawn(["......LL", "D.......", "........", "........", "........", "........", "........", "........"]);
    expect(legalMoves(wrap.cells, 8, 0)).toEqual([]);
  });

  it("only flips the discs between: ones beyond your own stay put", () => {
    const s = t.apply(drawn([".LDLD...", "........", "........", "........", "........", "........", "........", "..DL...."]), 0, place(0));
    expect(s.cells.slice(0, 5)).toEqual([0, 0, 0, 1, 0]);
  });
});

describe("moves the rules refuse", () => {
  it("a taken cell, a move that flips nothing, out of turn, off the board", () => {
    const s = start();
    expect(() => t.apply(s, 0, place(at(8, "d4")))).toThrow("disc there already");
    expect(() => t.apply(s, 0, place(at(8, "a1")))).toThrow("wouldn't flip anything");
    expect(() => t.apply(s, 1, place(at(8, "d3")))).toThrow("not your turn");
    expect(() => t.apply(s, 0, place(64))).toThrow(GameError);
    expect(() => t.apply(s, 0, place(1.5))).toThrow(GameError);
    expect(() => t.apply(s, 0, { type: "next" })).toThrow(GameError);
    expect(() => t.apply(s, 0, { type: "pass" } as never)).toThrow("not a move in Reversi");
    const done = play(start(), ...WIPEOUT);
    expect(() => t.apply(done, 1, place(0))).toThrow("over");
  });

  it("never changes the state it was given", () => {
    const s = start();
    const before = JSON.stringify(s);
    t.apply(s, 0, place(at(8, "d3")));
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("passing", () => {
  const stuck = () => drawn([".LD...", "......", "......", "......", "......", "....LD"]);

  it("a player with no move sits the turn out, and it says so", () => {
    const s = play(stuck(), "a1");
    // Light's one disc can't trap anything; dark still has d6.
    expect(legalMoves(s.cells, 6, 1)).toEqual([]);
    expect([s.phase, s.turn, s.passed]).toEqual(["playing", 0, 1]);
    expect(s.narration).toBe("{0} plays a1, flipping 1. {1} has no move and must pass, so {0} goes again");
    const v = t.view(s, 0);
    expect(v.turn).toBe(0);
    expect(names(6, v.grids[0]!.tap!.cells)).toEqual(["d6"]);
    expect(v.players[1]!.badge).toBe("No move");
    expect(t.view(s, 1).grids[0]!.tap).toBeNull();
    expect(t.bot(s, 1, SHARP)).toBeNull();
    expect(() => t.apply(s, 1, place(at(6, "d6")))).toThrow("not your turn");
  });

  it("when neither can move the game ends, with squares still empty", () => {
    const s = play(stuck(), "a1", "d6");
    expect(t.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: "6 to 0" });
    expect(s.narration).toBe("Nobody can move. {0} wins 6 to 0");
    expect(t.view(s, 1).over).toEqual({ winners: [0], title: "{0} wins 6 to 0!" });
    expect(movesOffered(t.view(s, 0))).toEqual([]);
  });

  it("an ordinary move hands the turn across and clears the pass", () => {
    const s = play(start(), "d3");
    expect([s.turn, s.passed, s.narration]).toEqual([1, null, "{0} plays d3, flipping 1"]);
    expect(t.view(s, 1).players.map((p) => p.badge)).toEqual([undefined, undefined]);
  });
});

describe("a whole game", () => {
  it("plays the nine-move wipeout move for move", () => {
    let s = start();
    const counts: [number, number][] = [];
    for (const name of WIPEOUT) {
      expect(names(8, t.view(s, s.turn).grids[0]!.tap!.cells)).toContain(name);
      s = play(s, name);
      counts.push(discCount(s.cells));
    }
    expect(counts).toEqual([[4, 1], [3, 3], [5, 2], [4, 4], [6, 3], [4, 6], [8, 3], [7, 5], [13, 0]]);
    expect(t.summary(s)).toMatchObject({ game: "reversi", over: true, winners: [0], scoreLine: "13 to 0", hand: 1 });
    const v = t.view(s, 1);
    expect(v.over!.title).toBe("{0} wins 13 to 0!");
    expect(v.scores).toEqual([{ seats: [0], value: 13 }, { seats: [1], value: 0 }]);
    expect(v.players.map((p) => p.line)).toEqual(["13 discs", "0 discs"]);
    expect(v.result).toBeNull();
  });

  it("the running count follows every move", () => {
    const s = play(start(), "d3", "c5");
    const v = t.view(s, 0);
    expect(v.players.map((p) => p.line)).toEqual(["3 discs", "3 discs"]);
    expect(v.scores.map((x) => x.value)).toEqual([3, 3]);
    expect(marked(s, 0, "last")).toEqual([at(8, "c5")]);
    expect(marked(s, 0, "flipped")).toEqual([at(8, "d5")]);
    expect(t.summary(s)).toMatchObject({ over: false, scoreLine: "3 to 3", winners: null });
  });

  it("most discs wins on a full board, either colour", () => {
    const rows = [".LDDDD", "DDDDDD", "DDDDDD", "DDDDDD", "LLLLLL", "LLLLLL"];
    const dark = play(drawn(rows), "a1");
    expect(dark.narration).toBe("The board is full. {0} wins 24 to 12");
    expect(t.summary(dark)).toMatchObject({ over: true, winners: [0], scoreLine: "24 to 12" });
    // The same board with the second seat as dark: now the second seat has the 24.
    const light = play(drawn(rows, {}, start({ size: 6, first: "seat2" })), "a1");
    expect(t.summary(light)).toMatchObject({ winners: [1], order: [1, 0], scoreLine: "12 to 24" });
    expect(t.view(light, 0).over!.title).toBe("{1} wins 24 to 12!");
  });

  it("the same number of discs is a draw, and both are named", () => {
    const s = play(drawn([".LDDDD", "DDDDDD", "DDDDDD", "LLLLLL", "LLLLLL", "LLLLLL"]), "a1");
    expect(discCount(s.cells)).toEqual([18, 18]);
    expect(t.summary(s)).toMatchObject({ over: true, winners: [0, 1], scoreLine: "18 to 18" });
    // As at Tic-Tac-Toe, the player who went second is listed first.
    expect(t.summary(s).order).toEqual([1, 0]);
    expect(t.view(s, 0).over).toEqual({ winners: [0, 1], title: "It's a draw: 18 all!" });
    expect(s.narration).toBe("The board is full. It's a draw, 18 all");
  });
});

describe("showing where you can move", () => {
  it("marks the legal cells for the player to move, and only for them", () => {
    const s = play(start(), "d3");
    expect(names(8, marked(s, 1, "hint"))).toEqual(["c3", "c5", "e3"]);
    expect(names(8, t.view(s, 1).grids[0]!.tap!.cells)).toEqual(["c3", "c5", "e3"]);
    expect(marked(s, 0, "hint")).toEqual([]);
  });

  it("the purist's game: every empty cell can be tried, nothing is marked, and a bad one is refused", () => {
    const s = start({ hints: false });
    const v = t.view(s, 0);
    expect(v.grids[0]!.tap!.cells).toHaveLength(60);
    expect(marked(s, 0, "hint")).toEqual([]);
    expect(v.info).toContain("Find your own moves: a disc must flip at least one");
    expect(() => t.apply(s, 0, place(at(8, "a1")))).toThrow("A disc there wouldn't flip anything: it has to trap at least one of theirs in a line.");
    expect(t.apply(s, 0, place(at(8, "d3"))).turn).toBe(1);
    expect(t.describe(s.rules).join(" ")).toMatch(/aren't marked/);
    // The computer player still only plays real moves.
    for (let i = 0; i < 20; i++) expect(legalMoves(s.cells, 8, 0)).toContain((t.bot(s, 0, i % 2 ? SHARP : EASY) as { cell: number }).cell);
  });
});

describe("a match", () => {
  it("takes turns playing dark, and most wins takes it", () => {
    let s = play(start({ games: 3 }), ...WIPEOUT);
    expect(s.phase).toBe("scored");
    expect(s.narration).toBe("Nobody can move. {0} wins game 1 13 to 0");
    const v = t.view(s, 0);
    expect(v.result).toMatchObject({ key: "game-1", title: "{0} wins game 1", rows: [{ label: "Discs", values: ["13", "0"] }, { label: "Wins", values: ["1", "0"] }] });
    expect(v.choices!.options[0]).toMatchObject({ label: "Next game", move: { type: "next" } });
    expect(v.scores.map((x) => x.value)).toEqual([1, 0]);
    expect(v.players.map((p) => p.line)).toEqual(["13 discs · 1 win", "0 discs · 0 wins"]);
    expect(v.info).toContain("Game 1 of 3");
    expect(() => t.apply(s, 0, place(0))).toThrow(GameError);
    s = t.apply(s, 0, { type: "next" });
    expect(t.view(s, 0).choices).toBeNull();
    expect(() => t.apply(s, 0, { type: "next" })).toThrow(GameError);
    expect(t.bot(s, 1, SHARP)).toEqual({ type: "next" });
    s = t.apply(s, 1, { type: "next" });
    expect([s.phase, s.round, s.turn, s.first, discCount(s.cells)]).toEqual(["playing", 2, 1, 1, [2, 2]]);
    // The second seat is dark now and wins the same way: one each, so the third game decides.
    s = play(s, ...WIPEOUT);
    expect([s.phase, s.wins]).toEqual(["scored", [1, 1]]);
    s = t.apply(t.apply(s, 0, { type: "next" }), 1, { type: "next" });
    s = play(s, ...WIPEOUT);
    expect(t.summary(s)).toMatchObject({ over: true, winners: [0], hand: 3, scoreLine: "2 to 1" });
    expect(t.view(s, 1).over!.title).toBe("{0} wins 2 to 1!");
  });

  it("stops as soon as one player can't be caught", () => {
    let s = play(start({ games: 3 }), ...WIPEOUT);
    s = t.apply(t.apply(s, 0, { type: "next" }), 1, { type: "next" });
    // The second seat is dark; the first seat, as light, takes the last square and the game.
    s = { ...drawn([".DLLLL", "LLLLLL", "LLLLLL", "LLLLLL", "DDDDDD", "DDDDDD"].map((r) => r.padEnd(8, "L")).concat(["LLLLLLLL", "LLLLLLLL"]), {}, s), turn: 0 };
    s = play(s, "a1");
    expect(t.summary(s)).toMatchObject({ over: true, winners: [0], scoreLine: "2 to 0" });
  });

  it("a drawn game counts for nobody", () => {
    let s = drawn([".LDDDD", "DDDDDD", "DDDDDD", "LLLLLL", "LLLLLL", "LLLLLL"], { games: 3 });
    s = play(s, "a1");
    expect([s.phase, s.wins, s.draws, s.narration]).toEqual(["scored", [0, 0], 1, "The board is full. Game 1 is a draw, 18 all"]);
    expect(t.view(s, 0).result).toMatchObject({ title: "Game 1 is a draw", rows: [{ label: "Discs" }, { label: "Wins", values: ["0", "0"] }, { label: "Draws", values: ["1", "1"] }] });
    expect(t.summary(s).scoreLine).toBe("0 to 0 · 1 drawn");
  });
});

describe("rules from anywhere", () => {
  it("come out as rules", () => {
    expect(t.normalize({ id: "x", name: "Mine", size: 7, games: 4, first: "me", hints: "no" })).toEqual({ id: "x", name: "Mine", size: 8, first: "random", hints: true, games: 1 });
    expect(t.normalize({ ...bigReversi, hints: false, games: 5, first: "seat2" })).toEqual({ ...bigReversi, hints: false, games: 5, first: "seat2" });
    expect(t.presets.map((p) => [p.name, p.size])).toEqual([["Classic 8×8", 8], ["Small 6×6", 6], ["Big 10×10", 10]]);
    expect(t.describe(t.normalize({ ...classicReversi, games: 3, first: "seat2" })).join(" ")).toMatch(/second seat is dark.*match is 3 games/);
    // The name people know it by elsewhere is somebody's trademark.
    expect(JSON.stringify([t.name, t.blurb, t.tagline, t.presets, t.fields, t.describe(classicReversi)])).not.toMatch(/othello/i);
  });
});

describe("the computer player", () => {
  /** The best result `seat` can force, in discs ahead, by trying everything. */
  function solve(cells: (number | null)[], n: number, seat: number, passed = false): number {
    const moves = legalMoves(cells, n, seat);
    if (!moves.length) {
      if (passed) return discCount(cells)[seat]! - discCount(cells)[1 - seat]!;
      return -solve(cells, n, 1 - seat, true);
    }
    let best = -Infinity;
    for (const cell of moves) {
      const next = [...cells];
      next[cell] = seat;
      for (const f of flipsFor(cells, n, cell, seat)) next[f] = seat;
      best = Math.max(best, -solve(next, n, 1 - seat));
    }
    return best;
  }

  it("takes a corner when one is going", () => {
    const s = drawn([".LD.....", "........", "...LD...", "...DL...", "........", "........", "........", "........"]);
    expect(t.bot(s, 0, SHARP)).toEqual(place(0));
  });

  it("doesn't hand over a corner when it has anything else", () => {
    // b2 is the square on the slant from the empty corner: playing it (it flips b3) lets light into a1.
    const s = drawn(["........", "........", ".LL.....", ".D.LD...", "...DL...", "........", "........", "........"]);
    expect(flipsFor(t.apply(s, 0, place(at(8, "b2"))).cells, 8, 0, 1)).toEqual([at(8, "b2")]);
    expect(legalMoves(s.cells, 8, 0)).toContain(at(8, "b2"));
    for (let i = 0; i < 10; i++) expect(t.bot(s, 0, SHARP)).not.toEqual(place(at(8, "b2")));
  });

  it("plays the end of the game out exactly", () => {
    const rand = mulberry32(5);
    let checked = 0;
    for (let seed = 0; seed < 40 && checked < 12; seed++) {
      let s = start({ size: 6 }, seed);
      while (!t.summary(s).over && s.cells.filter((d) => d === null).length > 7) s = t.apply(s, s.turn, place(legalMoves(s.cells, 6, s.turn)[Math.floor(rand() * legalMoves(s.cells, 6, s.turn).length)]!));
      if (t.summary(s).over || legalMoves(s.cells, 6, s.turn).length < 2) continue;
      const cell = bestReversiMove(s.cells, 6, s.turn, { depth: 1, exact: 12, limit: 1e9 }, rand)!;
      const next = t.apply(s, s.turn, place(cell));
      const got = t.summary(next).over ? discCount(next.cells)[s.turn]! - discCount(next.cells)[1 - s.turn]! : next.turn === s.turn ? solve(next.cells, 6, s.turn) : -solve(next.cells, 6, next.turn);
      expect(got, `seed ${seed}`).toBe(solve(s.cells, 6, s.turn));
      checked++;
    }
    expect(checked).toBe(12);
  }, 60_000);

  it("a sharp player beats a careless one over a series, on every board, quickly", () => {
    for (const rules of [smallReversi, classicReversi, bigReversi]) {
      const rand = mulberry32(21);
      let sharp = 0;
      let easy = 0;
      let slowest = 0;
      for (let i = 0; i < 10; i++) {
        let s = start({ ...rules, first: i % 2 ? "seat1" : "seat2" }, i);
        while (!t.summary(s).over) {
          const began = performance.now();
          const move = (t.bot as any)(s, s.turn, s.turn === 0 ? SHARP : EASY, rand);
          if (s.turn === 0) slowest = Math.max(slowest, performance.now() - began);
          s = t.apply(s, s.turn, move);
        }
        const w = t.summary(s).winners!;
        if (w.length === 1) w[0] === 0 ? sharp++ : easy++;
      }
      expect(sharp, rules.name).toBeGreaterThanOrEqual(8);
      expect(sharp, rules.name).toBeGreaterThan(easy);
      // Typically a few milliseconds, a few dozen at worst; the bound is loose so a busy machine doesn't fail it.
      expect(slowest, rules.name).toBeLessThan(1500);
    }
  }, 120_000);

  it("makes mistakes at lower skill: it doesn't always find the corner", () => {
    const s = drawn([".LD.....", "........", "...LD...", "...DL...", "........", "........", "........", "........"]);
    const rand = mulberry32(3);
    const picks = new Set(Array.from({ length: 60 }, () => ((t.bot as any)(s, 0, EASY, rand) as { cell: number }).cell));
    expect(picks.size).toBeGreaterThan(1);
    for (const cell of picks) expect(legalMoves(s.cells, 8, 0)).toContain(cell);
  });

  it("two sharp players don't play the same game twice", () => {
    const games = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const rand = mulberry32(i);
      let s = start();
      for (let k = 0; k < 8; k++) s = t.apply(s, s.turn, (t.bot as any)(s, s.turn, SHARP, rand));
      games.add(s.cells.join());
    }
    expect(games.size).toBeGreaterThan(2);
  });

  it("gives up looking when the work runs out, and still answers with a real move", () => {
    const s = play(start({ size: 10 }), "e4");
    const cell = bestReversiMove(s.cells, 10, s.turn, { depth: 30, exact: 0, limit: 500 })!;
    expect(legalMoves(s.cells, 10, s.turn)).toContain(cell);
    expect(bestReversiMove(drawn(["LLLLLL", "LLLLLL", "LLLLLL", "LLLLLL", "LLLLLL", "LLLLL."]).cells, 6, 0, { depth: 3, exact: 6, limit: 500 })).toBeNull();
  });
});

describe("table talk at the board", () => {
  it("never mentions cards", async () => {
    const { kitGreet } = await import("../src/index.js");
    const { PERSONAS } = await import("@spades/rules");
    const cast = { bots: Object.keys(PERSONAS).map((name, seat) => ({ seat, name })) };
    const said: string[] = [];
    for (let i = 0; i < 100; i++) said.push(...kitGreet(cast, mulberry32(i), "reversi").map((r) => r.text));
    expect(said.length).toBeGreaterThan(20);
    expect(said.filter((text) => /card|deal/i.test(text))).toEqual([]);
  });
});
