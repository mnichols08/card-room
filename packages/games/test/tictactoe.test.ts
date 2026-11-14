import { describe, expect, it } from "vitest";
import { mulberry32 } from "@spades/rules";
import { bestClassicMoves, blockOf, cellIn, classicTicTacToe, fourTicTacToe, GameError, gomoku, movesOffered, newTicTacToe, openCells, spotOf, ticTacToe, ultimateTicTacToe, type TicTacToeMove, type TicTacToeRules, type TicTacToeState } from "../src/index.js";

const t = ticTacToe;
const SHARP = { skill: 1, sloppy: 0 };
const EASY = { skill: 0.25, sloppy: 0.3 };
/** A game with the first seat as X, unless the rules name the second (the presets leave it to luck). */
const start = (rules: Partial<TicTacToeRules> = {}, seed = 1) => newTicTacToe(t.normalize({ ...classicTicTacToe, ...rules, first: rules.first === "seat2" ? "seat2" : "seat1" }), 2, seed);
const lucky = (seed: number) => newTicTacToe(classicTicTacToe, 2, seed);
const mark = (cell: number): TicTacToeMove => ({ type: "mark", cell });
/** Play cells in turn, whoever's turn it is. */
const play = (s: TicTacToeState, ...cells: number[]) => cells.reduce((state, cell) => t.apply(state, state.turn, mark(cell)), s);

describe("classic 3×3", () => {
  it("X goes first, and three in a row wins", () => {
    let s = start();
    expect(s.turn).toBe(0);
    expect(t.view(s, 0).grids[0]!.tap!.cells).toHaveLength(9);
    expect(t.view(s, 1).grids[0]!.tap).toBeNull();
    s = play(s, 0, 3, 1, 4);
    expect(t.summary(s).over).toBe(false);
    s = play(s, 2);
    expect(t.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: "1 to 0" });
    const v = t.view(s, 1);
    expect(v.over).toEqual({ winners: [0], title: "{0} wins!" });
    expect(v.grids[0]!.marks!.filter((m) => m.mark === "win").map((m) => m.cell)).toEqual([0, 1, 2]);
    expect(v.grids[0]!.cells[0]).toMatchObject({ owner: 0, kind: "x", label: "X" });
    expect(v.grids[0]!.cells[3]).toMatchObject({ owner: 1, kind: "o", label: "O" });
  });

  it("wins down and on both slants", () => {
    expect(t.summary(play(start(), 1, 0, 4, 2, 7)).winners).toEqual([0]);
    expect(t.summary(play(start(), 0, 1, 4, 2, 8)).winners).toEqual([0]);
    expect(t.summary(play(start(), 0, 2, 1, 4, 8, 6)).winners).toEqual([1]);
  });

  it("a full board with no line is a draw, and both are named", () => {
    const s = play(start(), 0, 1, 2, 4, 3, 5, 7, 6, 8);
    expect(t.summary(s)).toMatchObject({ over: true, winners: [0, 1], scoreLine: "0 to 0 · 1 drawn" });
    // Holding X to a draw is the better result: the second player is listed first.
    expect(t.summary(s).order).toEqual([1, 0]);
    expect(t.view(s, 0).over!.title).toBe("It's a draw!");
  });

  it("refuses a taken square, a move out of turn, a square off the board and a move after the end", () => {
    const s = play(start(), 4);
    expect(() => t.apply(s, 1, mark(4))).toThrow("taken");
    expect(() => t.apply(s, 0, mark(0))).toThrow("not your turn");
    expect(() => t.apply(s, 1, mark(9))).toThrow(GameError);
    expect(() => t.apply(s, 1, mark(1.5))).toThrow(GameError);
    expect(() => t.apply(s, 1, { type: "next" })).toThrow(GameError);
    const done = play(start(), 0, 3, 1, 4, 2);
    expect(() => t.apply(done, 1, mark(8))).toThrow("over");
  });

  it("says what happened, and names the squares for a screen reader", () => {
    const s = play(start(), 4, 0);
    expect(s.narration).toBe("{1} plays O in the top left");
    expect(t.view(s, 0).grids[0]!.names![4]).toBe("centre");
    expect(t.view(start(), 0).narration).toBe("You're X: you go first");
    expect(t.view(start(), 1).narration).toBeNull();
  });
});

describe("who goes first", () => {
  it("is the seat the rules name, or the luck of the seed", () => {
    expect(start({ first: "seat1" }).turn).toBe(0);
    expect(start({ first: "seat2" }).turn).toBe(1);
    const firsts = new Set(Array.from({ length: 20 }, (_, seed) => lucky(seed).turn));
    expect(firsts.size).toBe(2);
    expect(lucky(5).turn).toBe(lucky(5).turn);
    // Whoever goes first is X.
    const s = play(start({ first: "seat2" }), 4);
    expect(t.view(s, 0).grids[0]!.cells[4]).toMatchObject({ owner: 1, kind: "x" });
    expect(t.view(s, 0).players.map((p) => p.piece!.kind)).toEqual(["o", "x"]);
  });
});

describe("a match", () => {
  const xWins = [0, 3, 1, 4, 2];
  it("takes turns going first, and most wins takes it", () => {
    let s = play(start({ games: 3 }), ...xWins);
    expect(s.phase).toBe("scored");
    expect(t.view(s, 0).result!.title).toBe("{0} wins game 1");
    expect(t.view(s, 0).choices!.options[0]).toMatchObject({ label: "Next game", move: { type: "next" } });
    expect(() => t.apply(s, 0, mark(8))).toThrow(GameError);
    s = t.apply(s, 0, { type: "next" });
    expect(t.view(s, 0).choices).toBeNull();
    expect(() => t.apply(s, 0, { type: "next" })).toThrow(GameError);
    expect(t.bot(s, 1, SHARP)).toEqual({ type: "next" });
    s = t.apply(s, 1, { type: "next" });
    expect([s.phase, s.round, s.turn, s.first]).toEqual(["playing", 2, 1, 1]);
    expect(s.cells.every((m) => m === null)).toBe(true);
    // Seat 1 is X now and wins: one each, so the third game decides.
    s = play(s, ...xWins);
    expect([s.phase, s.wins]).toEqual(["scored", [1, 1]]);
    s = t.apply(t.apply(s, 0, { type: "next" }), 1, { type: "next" });
    s = play(s, ...xWins);
    expect(t.summary(s)).toMatchObject({ over: true, winners: [0], hand: 3, scoreLine: "2 to 1" });
    expect(t.view(s, 1).over!.title).toBe("{0} wins 2 to 1!");
  });

  it("stops as soon as one player can't be caught", () => {
    let s = play(start({ games: 3 }), ...xWins);
    s = t.apply(t.apply(s, 0, { type: "next" }), 1, { type: "next" });
    // Seat 1 goes first as X; seat 0 (O) wins again.
    s = play(s, 0, 3, 1, 4, 8, 5);
    expect(t.summary(s)).toMatchObject({ over: true, winners: [0], scoreLine: "2 to 0" });
  });
});

describe("bigger boards", () => {
  it("needs the number in a row the rules say, and more than that wins too", () => {
    let s = start(fourTicTacToe);
    expect(s.cells).toHaveLength(36);
    // X along the top row, O along the second.
    s = play(s, 0, 6, 1, 7, 2, 8);
    expect(t.summary(s).over).toBe(false);
    expect(t.summary(play(s, 3)).winners).toEqual([0]);
    // Filling the gap in X . X X X makes five: still a win.
    s = play(start(fourTicTacToe), 0, 6, 1, 7, 3, 9, 4, 10, 2);
    expect(t.summary(s).winners).toEqual([0]);
    expect(t.view(s, 0).grids[0]!.marks!.filter((m) => m.mark === "win")).toHaveLength(5);
  });

  it("finds a line on a slant on a Gomoku board", () => {
    const s = play(start(gomoku), 0, 1, 16, 2, 32, 3, 48, 4, 64);
    expect(t.summary(s).winners).toEqual([0]);
    expect(t.view(s, 0).grids[0]!.coords!.cols[14]).toBe("o");
    expect(s.narration).toBe("{0} wins!");
  });

  it("checks the rules fit the board", () => {
    expect(t.validate(t.normalize({ ...classicTicTacToe, size: 3, line: 4 }))[0]).toMatch(/doesn't fit/);
    expect(t.normalize({ id: "x", name: "Mine", size: 99, line: 1, games: 4, first: "me" })).toEqual({ id: "x", name: "Mine", board: "single", size: 15, line: 3, first: "random", games: 1 });
    // Ultimate is always small boards of 3×3.
    expect(t.normalize({ ...ultimateTicTacToe, size: 9, line: 5 })).toMatchObject({ board: "ultimate", size: 3, line: 3 });
    expect(t.validate(t.normalize({ ...ultimateTicTacToe, size: 3, line: 5 }))).toEqual([]);
  });
});

describe("ultimate", () => {
  const u = (seed = 1) => start(ultimateTicTacToe, seed);
  it("maps squares to small boards", () => {
    expect([blockOf(0), spotOf(0), blockOf(40), spotOf(40), blockOf(80), spotOf(80), blockOf(5), spotOf(5)]).toEqual([0, 0, 4, 4, 8, 8, 1, 2]);
    for (let b = 0; b < 9; b++) for (let i = 0; i < 9; i++) expect([blockOf(cellIn(b, i)), spotOf(cellIn(b, i))]).toEqual([b, i]);
  });

  it("the square you play sends the other player to that small board", () => {
    let s = u();
    expect(openCells(s)).toHaveLength(81);
    s = play(s, cellIn(4, 2));
    expect(s.forced).toBe(2);
    expect(openCells(s).every((c) => blockOf(c) === 2)).toBe(true);
    expect(() => t.apply(s, 1, mark(cellIn(4, 0)))).toThrow("lit-up board");
    const v = t.view(s, 1);
    expect(v.grids[0]!.blocks!.states.map((b) => !!b.active)).toEqual([false, false, true, false, false, false, false, false, false]);
    expect(v.info).toContain("Play in the top right board");
    expect(v.grids[0]!.names![cellIn(2, 4)]).toBe("centre of the top right board");
  });

  it("three in a row takes a small board; a finished board sends you anywhere", () => {
    // X takes the top-left board with its top row, O answering in the boards it's sent to.
    let s = u();
    s = play(s, cellIn(0, 0), cellIn(0, 4), cellIn(4, 0), cellIn(0, 8), cellIn(8, 0), cellIn(0, 3));
    s = play(s, cellIn(3, 0), cellIn(0, 5));
    expect(s.blocks![0]).toBe(1);
    // O was sent... X is sent to board 5 by O's last square.
    expect(s.forced).toBe(5);
    s = play(s, cellIn(5, 0));
    // Sent to board 0, which O has taken: O may play in any open board.
    expect(s.forced).toBeNull();
    expect(openCells(s).some((c) => blockOf(c) === 0)).toBe(false);
    expect(new Set(openCells(s).map(blockOf)).size).toBe(8);
    expect(() => t.apply(s, 1, mark(cellIn(0, 1)))).toThrow("finished");
    const state = t.view(s, 0).grids[0]!.blocks!.states[0]!;
    expect(state).toMatchObject({ owner: 1, glyph: "◯", label: "won by O", closed: true, active: false });
  });

  it("three small boards in a row win the game", () => {
    const s = u();
    // Give X boards 0 and 1 and two squares of board 2 directly, then play the winning square.
    for (const b of [0, 1]) {
      for (const i of [0, 1, 2]) s.cells[cellIn(b, i)] = 0;
      s.blocks![b] = 0;
    }
    s.cells[cellIn(2, 0)] = 0;
    s.cells[cellIn(2, 1)] = 0;
    s.forced = 2;
    expect(t.bot(s, 0, SHARP)).toEqual(mark(cellIn(2, 2)));
    const done = t.apply(s, 0, mark(cellIn(2, 2)));
    expect(t.summary(done)).toMatchObject({ over: true, winners: [0] });
    expect(t.view(done, 0).grids[0]!.marks!.filter((m) => m.mark === "win")).toHaveLength(27);
    expect(openCells(done)).toEqual([]);
  });

  it("a full small board nobody took is closed, and all boards closed with no line is a draw", () => {
    const s = u();
    const drawn = [0, 1, 0, 0, 1, 1, 1, 0, 0];
    for (let b = 0; b < 9; b++) {
      if (b === 8) continue;
      drawn.forEach((m, i) => (s.cells[cellIn(b, i)] = m));
      s.blocks![b] = "draw";
    }
    drawn.forEach((m, i) => (s.cells[cellIn(8, i)] = i === 8 ? null : m));
    s.forced = 8;
    const done = t.apply(s, 0, mark(cellIn(8, 8)));
    expect(done.blocks![8]).toBe("draw");
    expect(t.summary(done)).toMatchObject({ over: true, winners: [0, 1] });
  });
});

describe("the computer player", () => {
  it("never loses at 3×3 at full skill, whatever the other player does", () => {
    // Every line of play: each of the other player's moves against each of the bot's best moves.
    let games = 0;
    const explore = (s: TicTacToeState, botSeat: number) => {
      if (t.summary(s).over) {
        games++;
        expect(t.summary(s).winners).toContain(botSeat);
        return;
      }
      const cells = s.turn === botSeat ? bestClassicMoves(s.cells, botSeat) : openCells(s);
      for (const cell of cells) explore(t.apply(s, s.turn, mark(cell)), botSeat);
    };
    explore(start({ first: "seat1" }), 0);
    explore(start({ first: "seat1" }), 1);
    expect(games).toBeGreaterThan(100);
    // And the bot only ever picks from those moves.
    const rand = mulberry32(3);
    for (let i = 0; i < 200; i++) {
      let s = start({ first: i % 2 ? "seat1" : "seat2" });
      while (!t.summary(s).over) {
        const move = s.turn === 0 ? (t.bot as any)(s, 0, SHARP, rand) : mark(openCells(s)[Math.floor(rand() * openCells(s).length)]!);
        if (s.turn === 0) expect(bestClassicMoves(s.cells, 0)).toContain(move.cell);
        s = t.apply(s, s.turn, move);
      }
      expect(t.summary(s).winners).toContain(0);
    }
  }, 60_000);

  it("takes a win, and blocks one", () => {
    const win = play(start(), 0, 3, 1, 4);
    expect(t.bot(win, 0, SHARP)).toEqual(mark(2));
    const block = play(start(), 0, 4, 1);
    expect(t.bot(block, 1, SHARP)).toEqual(mark(2));
  });

  it("makes mistakes at lower skill: a perfect player beats it sometimes", () => {
    const rand = mulberry32(8);
    let lost = 0;
    for (let i = 0; i < 100; i++) {
      let s = start({ first: i % 2 ? "seat1" : "seat2" });
      while (!t.summary(s).over) s = t.apply(s, s.turn, (t.bot as any)(s, s.turn, s.turn === 0 ? EASY : SHARP, rand));
      if (!t.summary(s).winners!.includes(0)) lost++;
    }
    expect(lost).toBeGreaterThan(10);
    expect(lost).toBeLessThan(100);
  });

  it("on a big board: finishes its own line, stops the other player's, and doesn't dawdle", () => {
    // X has four in a row along the middle with both ends open: O to move must stop one end.
    const row = 7 * 15;
    const four = play(start(gomoku), row + 7, 0, row + 8, 1, row + 9, 2, row + 10);
    expect([row + 6, row + 11]).toContain((t.bot(four, 1, SHARP) as { cell: number }).cell);
    // Left alone, X finishes it.
    expect([row + 6, row + 11]).toContain((t.bot(play(four, 40), 0, SHARP) as { cell: number }).cell);
    // O's own four comes before stopping X's: winning beats blocking.
    const race = play(start(gomoku), row + 7, 0, row + 8, 1, row + 9, 2, row + 10, 3, 200);
    expect(t.bot(race, 1, SHARP)).toEqual(mark(4));

    // A whole game between two sharp players, timed: every move comes back quickly.
    let g = start(gomoku, 3);
    let slowest = 0;
    while (!t.summary(g).over) {
      const at = performance.now();
      const move = t.bot(g, g.turn, SHARP)!;
      slowest = Math.max(slowest, performance.now() - at);
      g = t.apply(g, g.turn, move);
    }
    // Typically a few milliseconds; the bound is loose so a busy machine doesn't fail it.
    expect(slowest).toBeLessThan(2000);
  }, 60_000);

  it("a sharp player beats a careless one at Gomoku and at Ultimate more often than not", () => {
    for (const rules of [gomoku, ultimateTicTacToe]) {
      const rand = mulberry32(21);
      let sharp = 0;
      let easy = 0;
      for (let i = 0; i < 10; i++) {
        let s = start({ ...rules, first: i % 2 ? "seat1" : "seat2" });
        while (!t.summary(s).over) s = t.apply(s, s.turn, (t.bot as any)(s, s.turn, s.turn === 0 ? SHARP : EASY, rand));
        const w = t.summary(s).winners!;
        if (w.length === 1) w[0] === 0 ? sharp++ : easy++;
      }
      expect(sharp, rules.name).toBeGreaterThan(easy);
    }
  }, 60_000);

  it("answers quickly at Ultimate, even with every board open", () => {
    const s = start(ultimateTicTacToe);
    const at = performance.now();
    const move = t.bot(s, 0, SHARP) as { cell: number };
    expect(performance.now() - at).toBeLessThan(3000);
    expect(movesOffered(t.view(s, 0))).toContainEqual(move);
  });
});

describe("table talk at a board", () => {
  it("never mentions cards", async () => {
    const { kitGreet, reactToKit } = await import("../src/index.js");
    const { PERSONAS } = await import("@spades/rules");
    const cast = { bots: Object.keys(PERSONAS).map((name, seat) => ({ seat, name })) };
    const playing = t.summary(start());
    const said: string[] = [];
    for (let i = 0; i < 200; i++) {
      const rand = mulberry32(i);
      said.push(...kitGreet(cast, rand, "tictactoe").map((r) => r.text));
      said.push(...reactToKit(playing, { ...playing, over: true, winners: [i % 2], order: [i % 2, 1 - (i % 2)] }, cast, rand).map((r) => r.text));
    }
    expect(said.length).toBeGreaterThan(50);
    expect(said.filter((text) => /card|deal/i.test(text))).toEqual([]);
  });
});
