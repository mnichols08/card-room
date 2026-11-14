import { describe, expect, it } from "vitest";
import { mulberry32 } from "@spades/rules";
import { bestDropFourMove, bigDropFour, cellAt, classicDropFour, dropFour, drinkingDropFour, fiveDropFour, GameError, landing, moveLimit, movesOffered, newDropFour, openColumns, popOutDropFour, poppable, SHOT_CLOCK_MS, type DropFourMove, type DropFourRules, type DropFourState } from "../src/index.js";

const g = dropFour;
const SHARP = { skill: 1, sloppy: 0 };
const EASY = { skill: 0.25, sloppy: 0.3 };
/** A game with the first seat as red, unless the rules name the second (the presets leave it to luck). */
const start = (rules: Partial<DropFourRules> = {}, seed = 1) => newDropFour(g.normalize({ ...classicDropFour, ...rules, first: rules.first === "seat2" ? "seat2" : "seat1" }), 2, seed);
const drop = (col: number): DropFourMove => ({ type: "drop", col });
/** Drop into columns in turn, whoever's turn it is. */
const play = (s: DropFourState, ...cols: number[]) => cols.reduce((state, col) => g.apply(state, state.turn, drop(col)), s);
/** The cell `up` places above the bottom of a column on the classic rack. */
const at = (col: number, up = 0, rules: DropFourRules = classicDropFour) => cellAt(rules.cols, rules.rows - 1 - up, col);
const wonCells = (s: DropFourState) => g.view(s, 0).grids[0]!.marks!.filter((m) => m.mark === "win").map((m) => m.cell);
/** A full 7×6 rack with no four in a row, and a full 4×4 one. */
const DRAWN = [5, 1, 0, 4, 3, 4, 1, 3, 3, 3, 3, 4, 2, 1, 5, 5, 2, 1, 4, 6, 6, 5, 3, 0, 2, 5, 1, 4, 1, 0, 4, 6, 0, 0, 5, 2, 0, 6, 2, 2, 6, 6];
const DRAWN_SMALL = [2, 1, 1, 2, 3, 2, 1, 1, 3, 0, 3, 0, 2, 3, 0, 0];

describe("dropping discs", () => {
  it("red goes first, and a disc falls to the lowest free place in its column", () => {
    let s = start();
    expect(s.turn).toBe(0);
    const first = g.view(s, 0);
    // Every column is a target, and the cells named are where each disc would land: the bottom row.
    expect(first.grids[0]!.tap).toEqual({ type: "drop", by: "col", cells: [0, 1, 2, 3, 4, 5, 6].map((c) => at(c)) });
    expect(first.grids[0]!.gravity).toBe(true);
    expect(movesOffered(first)).toEqual([0, 1, 2, 3, 4, 5, 6].map((col) => ({ type: "drop", col })));
    expect(g.view(s, 1).grids[0]!.tap).toBeNull();
    expect(first.players.map((p) => p.badge)).toEqual(["Goes first", undefined]);
    expect(first.narration).toBe("You're red: you go first");

    s = play(s, 3, 3, 3);
    expect([s.cells[at(3)], s.cells[at(3, 1)], s.cells[at(3, 2)], s.cells[at(3, 3)]]).toEqual([0, 1, 0, null]);
    expect(landing(s, 3)).toBe(at(3, 3));
    expect(s.last).toBe(at(3, 2));
    const v = g.view(s, 1);
    expect(v.grids[0]!.marks).toEqual([{ cell: at(3, 2), mark: "last" }]);
    expect(v.grids[0]!.cells[at(3)]).toMatchObject({ owner: 0, kind: "disc", label: "red", tone: "red" });
    expect(v.grids[0]!.cells[at(3, 1)]).toMatchObject({ owner: 1, kind: "disc", label: "yellow", tone: "gold" });
    expect(v.grids[0]!.tap!.cells).toContain(at(3, 3));
    expect(s.narration).toBe("{0} drops red in column 4");
  });

  it("a full column takes no more, and is no longer offered", () => {
    const s = play(start(), 2, 2, 2, 2, 2, 2);
    expect(openColumns(s)).toEqual([0, 1, 3, 4, 5, 6]);
    expect(landing(s, 2)).toBeNull();
    expect(movesOffered(g.view(s, s.turn)).map((m) => m.col)).toEqual([0, 1, 3, 4, 5, 6]);
    expect(() => g.apply(s, s.turn, drop(2))).toThrow("full");
  });

  it("refuses a move out of turn, a column that isn't there, a pop without Pop Out, and anything after the end", () => {
    const s = play(start(), 3);
    const before = JSON.stringify(s);
    expect(() => g.apply(s, 0, drop(0))).toThrow("not your turn");
    expect(() => g.apply(s, 1, drop(7))).toThrow(GameError);
    expect(() => g.apply(s, 1, drop(-1))).toThrow(GameError);
    expect(() => g.apply(s, 1, drop(1.5))).toThrow(GameError);
    expect(() => g.apply(s, 1, { type: "pop", from: at(3) })).toThrow("isn't in these rules");
    expect(() => g.apply(s, 1, { type: "next" })).toThrow(GameError);
    expect(() => g.apply(s, 1, { type: "timeout" })).toThrow("no clock");
    expect(JSON.stringify(s)).toBe(before);
    const done = play(start(), 0, 1, 0, 1, 0, 1, 0);
    expect(() => g.apply(done, 1, drop(4))).toThrow("over");
  });
});

describe("four in a row", () => {
  it("wins across", () => {
    const s = play(start(), 0, 0, 1, 1, 2, 2, 3);
    expect(g.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: "1 to 0" });
    expect(wonCells(s)).toEqual([at(0), at(1), at(2), at(3)]);
    expect(g.view(s, 1).over).toEqual({ winners: [0], title: "{0} wins!" });
    expect(movesOffered(g.view(s, 1))).toEqual([]);
  });

  it("wins up and down", () => {
    const s = play(start(), 6, 0, 6, 0, 6, 0, 5, 0);
    expect(g.summary(s).winners).toEqual([1]);
    expect(wonCells(s).sort((a, b) => a - b)).toEqual([at(0, 3), at(0, 2), at(0, 1), at(0)]);
  });

  it("wins on a slant up to the right", () => {
    // Red builds a staircase: (0,0) (1,1) (2,2) (3,3).
    const s = play(start(), 0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3);
    expect(g.summary(s).winners).toEqual([0]);
    expect(wonCells(s).sort((a, b) => a - b)).toEqual([at(3, 3), at(2, 2), at(1, 1), at(0)]);
  });

  it("wins on a slant up to the left", () => {
    const s = play(start(), 6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3);
    expect(g.summary(s).winners).toEqual([0]);
    expect(wonCells(s).sort((a, b) => a - b)).toEqual([at(3, 3), at(4, 2), at(5, 1), at(6)]);
  });

  it("more than four in a row wins too, and the whole line is marked", () => {
    // Red has 0, 1, 2 and 4, 5; the disc in column 3 joins them into six.
    const s = play(start(), 0, 0, 1, 1, 2, 2, 4, 4, 5, 5, 3);
    expect(g.summary(s).winners).toEqual([0]);
    expect(wonCells(s)).toHaveLength(6);
  });

  it("three isn't enough, and the game goes on", () => {
    const s = play(start(), 0, 0, 1, 1, 2, 3);
    expect(g.summary(s).over).toBe(false);
    expect(wonCells(s)).toEqual([]);
  });

  it("a full rack with no line is a draw, and both are named", () => {
    const s = play(start(), ...DRAWN);
    expect(s.cells.every((m) => m !== null)).toBe(true);
    expect(g.summary(s)).toMatchObject({ over: true, winners: [0, 1], scoreLine: "0 to 0 · 1 drawn" });
    // Holding red to a draw is the better result: the second player is listed first.
    expect(g.summary(s).order).toEqual([1, 0]);
    expect(g.view(s, 0).over!.title).toBe("It's a draw!");
  });

  it("house rules: another size of rack and another number in a row", () => {
    const five = start(fiveDropFour);
    expect([five.rules.cols, five.rules.rows, five.rules.line]).toEqual([9, 6, 5]);
    expect(g.view(five, 0).info[0]).toBe("Five in a row wins");
    const four = play(five, 0, 0, 1, 1, 2, 2, 3, 3);
    expect(g.summary(four).over).toBe(false);
    expect(g.summary(play(four, 4)).winners).toEqual([0]);
    const big = start(bigDropFour);
    expect(g.view(big, 0).grids[0]).toMatchObject({ rows: 7, cols: 9 });
    expect(g.view(big, 0).grids[0]!.tap!.cells).toHaveLength(9);
    // Three in a row on a small rack.
    expect(g.summary(play(start({ cols: 4, rows: 4, line: 3 }), 0, 0, 1, 1, 2)).winners).toEqual([0]);
    // Rules that can't be won are refused; rules from anywhere come out in range.
    expect(g.validate(g.normalize({ cols: 4, rows: 4, line: 6 }))).toHaveLength(1);
    expect(g.normalize({ cols: 99, rows: 1, line: "x", games: 4, popOut: 1, drinking: "yes" })).toMatchObject({ cols: 10, rows: 4, line: 4, games: 1, popOut: true, drinking: true });
  });
});

describe("Pop Out", () => {
  const pop = (col: number, rules: DropFourRules = classicDropFour): DropFourMove => ({ type: "pop", from: at(col, 0, rules), to: at(col, 0, rules) });

  it("offers your own discs in the bottom row, and popping one drops everything above it", () => {
    let s = play(start(popOutDropFour), 3, 3, 3, 4);
    // Column 4 from the bottom: red, yellow, red. Column 5: yellow. It's red's turn.
    expect(poppable(s, 0)).toEqual([3]);
    expect(poppable(s, 1)).toEqual([4]);
    const v = g.view(s, 0);
    expect(v.grids[0]!.select).toEqual({ type: "pop", sources: [{ from: at(3), to: [at(3)] }] });
    expect(movesOffered(v)).toContainEqual({ type: "pop", from: at(3), to: at(3) });
    expect(g.view(s, 1).grids[0]!.select).toBeNull();

    s = g.apply(s, 0, pop(3));
    expect([s.cells[at(3)], s.cells[at(3, 1)], s.cells[at(3, 2)]]).toEqual([1, 0, null]);
    expect(s.turn).toBe(1);
    expect(s.narration).toBe("{0} pops a disc out of column 4");
    expect(g.view(s, 1).grids[0]!.marks).toEqual([{ cell: at(3), mark: "from" }]);
    // Yellow's disc is at the bottom of column 4 now, so yellow can pop there too.
    expect(poppable(s, 1)).toEqual([3, 4]);
  });

  it("refuses a disc that isn't yours, one that isn't in the bottom row, and an empty place", () => {
    const s = play(start(popOutDropFour), 3, 3, 3, 4);
    expect(() => g.apply(s, 0, pop(4))).toThrow("your own");
    expect(() => g.apply(s, 0, { type: "pop", from: at(3, 2) })).toThrow("bottom row");
    expect(() => g.apply(s, 0, { type: "pop", from: at(3), to: at(4) })).toThrow("bottom row");
    expect(() => g.apply(s, 0, pop(0))).toThrow("your own");
    expect(() => g.apply(s, 0, { type: "pop", from: 999 })).toThrow(GameError);
    expect(() => g.apply(s, 1, pop(4))).toThrow("not your turn");
  });

  it("a pop that lines up four wins, for whoever's line it is", () => {
    // Bottom row: red, red, red, yellow, with a red disc on the yellow one. Yellow pops its own disc
    // out and hands red the line.
    let s = play(start(popOutDropFour), 0, 3, 1, 6, 2, 6, 3);
    expect(s.turn).toBe(1);
    s = g.apply(s, 1, pop(3));
    expect(g.summary(s)).toMatchObject({ over: true, winners: [0] });
    expect(wonCells(s)).toEqual([at(0), at(1), at(2), at(3)]);
  });

  it("when a pop lines up four for both, whoever popped wins", () => {
    // From the bottom, columns 4 to 6 hold yellow then red, and column 7 holds red, yellow, red.
    // Red pops column 7: the bottom row becomes four yellows and the row above it four reds.
    const s = start(popOutDropFour);
    const set = (col: number, up: number, who: number) => (s.cells[at(col, up)] = who);
    for (const col of [3, 4, 5]) {
      set(col, 0, 1);
      set(col, 1, 0);
    }
    [0, 1, 0].forEach((who, up) => set(6, up, who));
    const both = g.apply(s, 0, pop(6));
    expect([3, 4, 5, 6].map((col) => [both.cells[at(col)], both.cells[at(col, 1)]])).toEqual([[1, 0], [1, 0], [1, 0], [1, 0]]);
    expect(g.summary(both)).toMatchObject({ over: true, winners: [0] });
    expect(wonCells(both)).toEqual([3, 4, 5, 6].map((col) => at(col, 1)));
    // With yellow on top instead, the pop only finishes yellow's line: yellow wins, on red's move.
    set(6, 2, 1);
    const theirs = g.apply(s, 0, pop(6));
    expect(g.summary(theirs)).toMatchObject({ over: true, winners: [1] });
    expect(wonCells(theirs)).toEqual([3, 4, 5, 6].map((col) => at(col)));
  });

  it("a full rack isn't the end while the next player can pop; with nothing to pop it's a draw", () => {
    const rules = { ...popOutDropFour, cols: 4, rows: 4 };
    let s = play(start(rules), ...DRAWN_SMALL.slice(0, -1));
    const lastCol = DRAWN_SMALL.at(-1)!;
    s = g.apply(s, s.turn, drop(lastCol));
    expect(s.cells.every((m) => m !== null)).toBe(true);
    // Somebody's disc is at the bottom of every column, so whoever is next has one to pop.
    expect(g.summary(s).over).toBe(false);
    const v = g.view(s, s.turn);
    expect(v.grids[0]!.tap).toBeNull();
    expect(movesOffered(v).every((m) => m.type === "pop")).toBe(true);
    expect(movesOffered(v).length).toBeGreaterThan(0);
    // Give the whole bottom row to the player who just moved: the next one is stuck, and it's a draw.
    const stuck = play(start(rules), ...DRAWN_SMALL.slice(0, -1));
    const mover = stuck.turn;
    for (let c = 0; c < 4; c++) stuck.cells[cellAt(4, 3, c)] = mover;
    // (That makes a line of four along the bottom, but only the disc just dropped is checked, and it isn't part of it.)
    const end = g.apply(stuck, mover, drop(lastCol));
    expect(g.summary(end)).toMatchObject({ over: true, winners: [0, 1] });
  });

  it("a game that goes round and round is a draw at the move limit", () => {
    let s = start(popOutDropFour);
    expect(moveLimit(s.rules)).toBe(168);
    // Each drops in their own column, then they pop and drop for ever.
    s = play(s, 0, 6);
    for (let i = 0; i < 400 && !g.summary(s).over; i++) {
      const col = s.turn === 0 ? 0 : 6;
      s = g.apply(s, s.turn, s.cells[at(col)] === s.turn ? pop(col) : drop(col));
    }
    expect(s.moves).toBe(168);
    expect(g.summary(s)).toMatchObject({ over: true, winners: [0, 1] });
  });
});

describe("a match", () => {
  it("is the most wins of its games, taking turns to go first, and stops when it's decided", () => {
    let s = start({ games: 3 });
    expect(g.view(s, 0).info).toContain("Game 1 of 3");
    s = play(s, 0, 1, 0, 1, 0, 1, 0);
    expect(s.phase).toBe("scored");
    expect(g.summary(s)).toMatchObject({ over: false, hand: 1, scoreLine: "1 to 0" });
    const v = g.view(s, 1);
    expect(v.result).toMatchObject({ title: "{0} wins game 1", rows: [{ label: "Wins", values: ["1", "0"], tone: "total" }] });
    expect(movesOffered(v)).toEqual([{ type: "next" }]);
    expect(() => g.apply(s, 0, drop(0))).toThrow("over");
    // Both move on; the second seat is red in game two.
    s = g.apply(s, 0, { type: "next" });
    expect(() => g.apply(s, 0, { type: "next" })).toThrow("Waiting");
    expect(s.round).toBe(1);
    s = g.apply(s, 1, { type: "next" });
    expect([s.round, s.first, s.turn, s.moves]).toEqual([2, 1, 1, 0]);
    expect(s.cells.every((m) => m === null)).toBe(true);
    expect(g.view(s, 1).grids[0]!.cells.every((c) => c === null)).toBe(true);
    expect(g.view(s, 1).players[1]!.piece).toMatchObject({ label: "red" });
    // Seat 0 wins again, as yellow: two of three decides it with a game to spare.
    s = play(s, 6, 0, 6, 0, 6, 0, 5, 0);
    expect(g.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: "2 to 0", hand: 2 });
    expect(g.view(s, 0).over!.title).toBe("{0} wins 2 to 0!");
  });

  it("a drawn game counts for nobody", () => {
    let s = play(start({ games: 3, cols: 4, rows: 4 }), ...DRAWN_SMALL);
    expect(s.phase).toBe("scored");
    expect(g.view(s, 0).result!.rows).toContainEqual({ label: "Draws", values: ["1", "1"] });
    s = g.apply(g.apply(s, 0, { type: "next" }), 1, { type: "next" });
    expect(s.round).toBe(2);
    expect(g.summary(s).scoreLine).toBe("0 to 0 · 1 drawn");
  });
});

describe("drinking mode's shot clock", () => {
  const TIMEOUT: DropFourMove = { type: "timeout" };

  it("without drinking mode there is never a clock", () => {
    let s = start();
    expect(g.deadline!(s)).toBeNull();
    s = play(s, 3, 3, 2);
    expect(g.deadline!(s)).toBeNull();
    expect(s.clock).toBe(false);
    expect(() => g.apply(s, s.turn, TIMEOUT)).toThrow("no clock");
    expect(g.view(s, 0).players.map((p) => p.line)).toEqual(["", ""]);
  });

  it("starts when the other player's disc lands: not on the first move of a game", () => {
    let s = start(drinkingDropFour);
    expect(s.rules.drinking).toBe(true);
    expect(g.deadline!(s)).toBeNull();
    expect(() => g.apply(s, 0, TIMEOUT)).toThrow("no clock");
    s = play(s, 3);
    expect(g.deadline!(s)).toEqual({ after: SHOT_CLOCK_MS, seat: 1, move: { type: "timeout" } });
    expect(SHOT_CLOCK_MS).toBe(3000);
    s = play(s, 3);
    expect(g.deadline!(s)).toEqual({ after: 3000, seat: 0, move: { type: "timeout" } });
    expect(g.view(s, 0).info).toContain("🍺 3 seconds to drop, or drink and lose your turn");
  });

  it("too slow: you drink, lose your turn, and the tally shows it; the other player then has no clock", () => {
    let s = play(start(drinkingDropFour), 3);
    const before = JSON.stringify(s);
    // Only the seat on the clock can run out of time.
    expect(() => g.apply(s, 0, TIMEOUT)).toThrow("not your turn");
    const late = g.apply(s, 1, TIMEOUT);
    expect(JSON.stringify(s)).toBe(before);
    s = late;
    expect(s.tally.drank).toEqual([0, 1]);
    expect(s.turn).toBe(0);
    expect(s.narration).toBe("{1} was too slow · 🍺 {1} drinks 1");
    // Nothing was dropped: the rack is as it was, and the same disc is still the last one.
    expect(s.cells.filter((m) => m !== null)).toHaveLength(1);
    expect(s.last).toBe(at(3));
    // The clock doesn't pass back and forth between two people who have both gone.
    expect(g.deadline!(s)).toBeNull();
    expect(() => g.apply(s, 0, TIMEOUT)).toThrow("no clock");
    const v = g.view(s, 0);
    expect(v.players.map((p) => p.line)).toEqual(["🍺 0", "🍺 1"]);
    expect(v.turn).toBe(0);
    expect(g.summary(s).scoreLine).toBe("0 to 0 · 🍺 0 and 1");
    // Red drops again, and the clock is back on yellow.
    s = play(s, 4);
    expect(g.deadline!(s)).toMatchObject({ seat: 1 });
    s = g.apply(s, 1, TIMEOUT);
    expect(s.tally.drank).toEqual([0, 2]);
    // A missed turn can cost the game: red has three along the bottom and drops the fourth.
    s = play(s, 5);
    s = g.apply(s, 1, TIMEOUT);
    s = play(s, 2);
    expect(g.summary(s)).toMatchObject({ over: true, winners: [0] });
    expect(g.deadline!(s)).toBeNull();
    expect(s.tally.drank).toEqual([0, 3]);
  });

  it("the clock stops at the end of a game and starts again in the next, and the drinks carry over a match", () => {
    let s = play(start({ ...drinkingDropFour, games: 3 }), 0);
    s = g.apply(s, 1, TIMEOUT);
    s = play(s, 0, 1, 0, 1, 0);
    expect(s.phase).toBe("scored");
    expect(g.deadline!(s)).toBeNull();
    expect(g.view(s, 0).result!.rows).toContainEqual({ label: "Drinks 🍺", values: ["0", "1"] });
    s = g.apply(g.apply(s, 0, { type: "next" }), 1, { type: "next" });
    expect(g.deadline!(s)).toBeNull();
    expect(s.tally.drank).toEqual([0, 1]);
    s = play(s, 2);
    expect(g.deadline!(s)).toMatchObject({ seat: 0, after: 3000 });
  });

  it("a computer player thinks for less time than the clock allows", () => {
    const s = play(start(drinkingDropFour), 3);
    // The slowest persona takes 1.35 of this, and up to 1.3 of that again.
    expect(g.thinkingTime(s, 1) * 1.35 * 1.3).toBeLessThan(SHOT_CLOCK_MS);
  });
});

describe("the computer player", () => {
  /** A position some random moves in, with nobody having won yet. */
  function scramble(rules: DropFourRules, seed: number, moves: number): DropFourState {
    const rand = mulberry32(seed);
    let s = newDropFour(rules, 2, seed);
    for (let i = 0; i < moves; i++) {
      const open = openColumns(s);
      const next = g.apply(s, s.turn, drop(open[Math.floor(rand() * open.length)]!));
      if (next.phase !== "playing") break;
      s = next;
    }
    return s;
  }
  /** The columns where a disc from `seat` would win at once. */
  const winsFor = (s: DropFourState, seat: number) => openColumns(s).filter((col) => g.apply({ ...s, turn: seat }, seat, drop(col)).roundWinner === seat);

  it("at its sharpest never misses a win in one, and always blocks one", () => {
    let wins = 0;
    let blocks = 0;
    for (const rules of [classicDropFour, bigDropFour, fiveDropFour]) {
      for (let seed = 1; seed <= 150; seed++) {
        const s = scramble(rules, seed, 8 + (seed % 18));
        const seat = s.turn;
        const mine = winsFor(s, seat);
        const theirs = winsFor(s, 1 - seat);
        const move = g.bot(s, seat, SHARP, mulberry32(seed)) as { type: "drop"; col: number };
        if (mine.length) {
          expect(mine, `seed ${seed}: a win in one was there`).toContain(move.col);
          wins++;
        } else if (theirs.length) {
          // With two ways for them to win there's no saving it, but it still stops one of them
          // (the other player may not have seen both).
          expect(theirs, `seed ${seed}: a line needed stopping`).toContain(move.col);
          blocks++;
        }
      }
    }
    // The positions really did ask both questions.
    expect(wins).toBeGreaterThan(20);
    expect(blocks).toBeGreaterThan(20);
  });

  it("doesn't pop the other player into a line", () => {
    // Bottom row: red, red, red, yellow, with a red disc on the yellow one. Yellow popping it out loses at once.
    const s = play(start(popOutDropFour), 0, 3, 1, 6, 2, 6, 3);
    expect(movesOffered(g.view(s, 1))).toContainEqual({ type: "pop", from: at(3), to: at(3) });
    for (let seed = 1; seed <= 5; seed++) expect(g.bot(s, 1, SHARP, mulberry32(seed))).not.toMatchObject({ type: "pop", from: at(3) });
  });

  it("pops to win when no drop does", () => {
    // The second row has red in columns 4, 5 and 7, and column 6 is red, yellow, red from the bottom:
    // popping red's own bottom disc there drops the top one into the gap.
    const t = start(popOutDropFour);
    [[3, 0, 1], [4, 0, 0], [6, 0, 1], [3, 1, 0], [4, 1, 0], [6, 1, 0], [5, 0, 0], [5, 1, 1], [5, 2, 0]].forEach(([c, u, w]) => (t.cells[at(c!, u)] = w!));
    expect(winsFor(t, 0)).toEqual([]);
    expect(g.bot(t, 0, SHARP, mulberry32(3))).toEqual({ type: "pop", from: at(5), to: at(5) });
    expect(g.summary(g.apply(t, 0, { type: "pop", from: at(5) })).winners).toEqual([0]);
  });

  it("opens in the middle, and plays the same move from the same position", () => {
    for (const rules of [classicDropFour, bigDropFour]) {
      const s = start(rules);
      expect(g.bot(s, 0, SHARP, mulberry32(1))).toEqual({ type: "drop", col: (rules.cols - 1) / 2 });
    }
    const s = scramble(classicDropFour, 9, 10);
    expect(g.bot(s, s.turn, SHARP, mulberry32(4))).toEqual(g.bot(s, s.turn, SHARP, mulberry32(4)));
  });

  it("the sharp player beats the easy one far more often than not", () => {
    let sharp = 0;
    let easy = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const rand = mulberry32(seed);
      let s = newDropFour(classicDropFour, 2, seed);
      const sharpSeat = seed % 2;
      while (!g.summary(s).over) s = g.apply(s, s.turn, g.bot(s, s.turn, s.turn === sharpSeat ? SHARP : EASY, rand)!);
      const w = g.summary(s).winners!;
      if (w.length === 1) w[0] === sharpSeat ? sharp++ : easy++;
    }
    expect(sharp).toBeGreaterThanOrEqual(13);
    expect(easy).toBeLessThanOrEqual(1);
  });

  it("looks ahead by counting positions, so it answers quickly on any rack", () => {
    for (const rules of [classicDropFour, bigDropFour, popOutDropFour, fiveDropFour, g.normalize({ cols: 10, rows: 8, popOut: true })]) {
      let slowest = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const s = scramble(rules, seed, 4 + seed * 3);
        const found = bestDropFourMove(s, s.turn, 12, 20_000, mulberry32(seed));
        // It never looks at more than its allowance, and unless it can win at once it has looked at the answers to its move.
        expect(found.nodes).toBeLessThanOrEqual(20_000);
        if (found.value < 900_000) expect(found.depth).toBeGreaterThanOrEqual(2);
        const t0 = performance.now();
        g.bot(s, s.turn, SHARP, mulberry32(seed));
        slowest = Math.max(slowest, performance.now() - t0);
      }
      // Measured at 40–80 ms for the slowest move on a busy laptop; this only catches it getting badly slower.
      expect(slowest, rules.name).toBeLessThan(1000);
    }
  });

  it("moves on after a game, and has nothing to do out of turn", () => {
    let s = play(start({ games: 3 }), 0, 1, 0, 1, 0, 1);
    expect(g.bot(s, 1, SHARP)).toBeNull();
    s = play(s, 0);
    expect(g.bot(s, 0, SHARP)).toEqual({ type: "next" });
    s = g.apply(s, 0, { type: "next" });
    expect(g.bot(s, 0, SHARP)).toBeNull();
    expect(g.bot(s, 1, EASY)).toEqual({ type: "next" });
  });
});
