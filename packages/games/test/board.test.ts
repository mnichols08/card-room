// Every board game on the kit, the way kit.test.ts checks every card game: computer players finish
// whole games at every table size with every preset, a game can be played from nothing but what
// its views offer, every view is consistent with itself, the same seed always starts the same
// game, and refused moves don't change anything.
import { mulberry32 } from "@spades/rules";
import { describe, expect, it } from "vitest";
import { BOARD_GAMES, GameError, KIT_GAMES, cellAt, cellName, chessCoords, colOf, isBoardGame, isCardGame, isKitGame, kitGame, lineThrough, movesOffered, rowOf, type BoardGame, type BoardView } from "../src/index.js";

const STYLES = [{}, { skill: 0.3, sloppy: 0.3 }, { skill: 1, sloppy: 0 }];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A view makes sense on its own: everything it points at is on its boards. */
export function checkBoardView(v: BoardView, seat: number) {
  expect(v.me).toBe(seat);
  expect(v.players).toHaveLength(v.seats);
  expect(v.grids.length).toBeGreaterThan(0);
  expect(new Set(v.grids.map((g) => g.id)).size).toBe(v.grids.length);
  for (const g of v.grids) {
    const size = g.rows * g.cols;
    const on = (cell: number) => Number.isInteger(cell) && cell >= 0 && cell < size;
    expect(g.cells).toHaveLength(size);
    if (Array.isArray(g.shade)) expect(g.shade).toHaveLength(size);
    if (g.names) expect(g.names).toHaveLength(size);
    if (g.coords) expect([g.coords.rows.length, g.coords.cols.length]).toEqual([g.rows, g.cols]);
    if (g.blocks) {
      expect([g.rows % g.blocks.rows, g.cols % g.blocks.cols]).toEqual([0, 0]);
      expect(g.blocks.states).toHaveLength(g.blocks.rows * g.blocks.cols);
    }
    for (const m of g.marks ?? []) expect(on(m.cell)).toBe(true);
    for (const cell of g.tap?.cells ?? []) expect(on(cell)).toBe(true);
    expect(new Set(g.tap?.cells).size).toBe(g.tap?.cells.length ?? 0);
    const reserve = new Set(v.reserves.filter((r) => r.owner === seat).flatMap((r) => r.pieces.map((p) => p.piece.kind)));
    for (const s of g.select?.sources ?? []) {
      // You pick up a piece that's there, or one from your own reserve.
      if (typeof s.from === "number") expect(g.cells[s.from]).toBeTruthy();
      else expect(reserve.has(s.from)).toBe(true);
      expect(s.to.length).toBeGreaterThan(0);
      for (const to of s.to) expect(on(to)).toBe(true);
    }
    for (const piece of g.cells) if (piece) expect(piece.glyph && piece.label && piece.kind).toBeTruthy();
  }
  for (const r of v.reserves) for (const p of r.pieces) expect(p.count).toBeGreaterThanOrEqual(0);
  if (v.over) expect(v.over.winners.length).toBeGreaterThan(0);
}

/** Bots play until it's over. Along the way every view is checked, and every move a view offers is one the engine takes. */
export function playOut(game: BoardGame<any, any, any>, rules: unknown, seats: number, seed: number, limit = 5000) {
  let s = game.newGame(game.normalize(rules), seats, seed);
  let moves = 0;
  while (!game.summary(s).over) {
    let moved = false;
    for (let seat = 0; seat < seats; seat++) {
      const move = game.bot(s, seat, STYLES[(seat + moves) % STYLES.length]!);
      if (!move) continue;
      const v = game.view(s, seat);
      checkBoardView(v, seat);
      const offered = movesOffered(v);
      expect(offered.some((m) => same(m, move)), `${game.id}: the bot's move ${JSON.stringify(move)} isn't one the view offers`).toBe(true);
      const before = JSON.stringify(s);
      for (const m of offered) game.apply(s, seat, m);
      const next = game.apply(s, seat, move);
      // Trying moves never changes the state it was given.
      expect(JSON.stringify(s)).toBe(before);
      s = next;
      moved = true;
      moves++;
      break;
    }
    if (!moved) throw new Error(`nobody can move in ${game.id} (phase ${game.summary(s).phase})`);
    if (moves > limit) throw new Error(`${game.id} went on too long`);
  }
  return { state: s, moves };
}

describe("the board kit's helpers", () => {
  const piece = { owner: 0, kind: "man", glyph: "●", label: "red man" };
  const base = { game: "tictactoe" as const, seats: 2, me: 0, teams: false, phase: "playing", turn: 0, reserves: [], choices: null, players: [{ line: "" }, { line: "" }], info: [], narration: null, scores: [], result: null, over: null };

  it("lists the moves a view offers: taps, whole columns, pieces to pick up, reserve pieces, buttons", () => {
    const grid = { id: "board", label: "Board", rows: 2, cols: 3, cells: [piece, null, null, null, null, null] };
    expect(movesOffered({ ...base, grids: [{ ...grid, tap: { type: "mark", cells: [1, 2] } }] })).toEqual([{ type: "mark", cell: 1 }, { type: "mark", cell: 2 }]);
    // A drop game: any cell of a column means the column, once.
    expect(movesOffered({ ...base, grids: [{ ...grid, tap: { type: "drop", cells: [1, 4, 5], by: "col" } }] })).toEqual([{ type: "drop", col: 1 }, { type: "drop", col: 2 }]);
    const view: BoardView = {
      ...base,
      grids: [{ ...grid, select: { type: "move", sources: [{ from: 0, to: [1, 4] }, { from: "ship", to: [5] }] } }],
      reserves: [{ owner: 0, label: "To place", pieces: [{ piece: { ...piece, kind: "ship" }, count: 2 }] }],
      choices: { prompt: "", options: [{ label: "Pass", move: { type: "pass" } }] },
    };
    checkBoardView(view, 0);
    expect(movesOffered(view)).toEqual([{ type: "move", from: 0, to: 1 }, { type: "move", from: 0, to: 4 }, { type: "move", from: "ship", to: 5 }, { type: "pass" }]);
    // With two boards, a move says which one it's on.
    const two = { ...base, grids: [{ ...grid, id: "theirs", tap: { type: "shoot", cells: [3] } }, { ...grid, id: "mine", owner: 0 }] };
    checkBoardView(two, 0);
    expect(movesOffered(two)).toEqual([{ type: "shoot", cell: 3, grid: "theirs" }]);
  });

  it("names cells and finds lines", () => {
    expect(cellName({ cols: 3 }, 5)).toBe("row 2, column 3");
    expect(cellName({ cols: 8, coords: chessCoords(8, 8) }, 0)).toBe("a8");
    expect(cellName({ cols: 8, coords: chessCoords(8, 8) }, 63)).toBe("h1");
    expect(cellName({ cols: 3, names: ["a", "b", "c", "d", "the middle"] }, 4)).toBe("the middle");
    expect([cellAt(5, 2, 3), rowOf(5, 13), colOf(5, 13)]).toEqual([13, 2, 3]);
    // A 4×5 board with a slanting line of three and a row of two.
    const marked = new Set([cellAt(5, 0, 0), cellAt(5, 1, 1), cellAt(5, 2, 2), cellAt(5, 3, 0), cellAt(5, 3, 1)]);
    const has = (c: number) => marked.has(c);
    expect(lineThrough(4, 5, cellAt(5, 1, 1), 3, has)).toEqual([0, 6, 12]);
    expect(lineThrough(4, 5, cellAt(5, 1, 1), 4, has)).toBeNull();
    expect(lineThrough(4, 5, cellAt(5, 3, 1), 2, has)).toEqual([15, 16]);
    // Lines stop at the edge: they never wrap onto the next row.
    const edge = new Set([3, 4, 5, 6]);
    expect(lineThrough(4, 5, 4, 3, (c) => edge.has(c))).toBeNull();
  });
});

describe("the registry", () => {
  it("lists every game once, as a card game or a board game", () => {
    const ids = KIT_GAMES.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(isKitGame(id)).toBe(true);
      expect(isCardGame(id)).not.toBe(isBoardGame(id));
      expect(kitGame(id)!.id).toBe(id);
    }
    expect(isKitGame("spades")).toBe(false);
    expect(BOARD_GAMES.length).toBeGreaterThan(0);
  });
});

for (const game of BOARD_GAMES) {
  describe(game.id, () => {
    it("has valid presets that describe themselves", () => {
      expect(new Set(game.presets.map((p) => p.id)).size).toBe(game.presets.length);
      for (const p of game.presets) {
        expect(game.validate(game.normalize(p))).toEqual([]);
        expect(game.normalize(p)).toEqual(p);
        expect(game.describe(p).length).toBeGreaterThan(1);
        // A table's rules name is cut at 30 characters on the server: say it in fewer.
        expect(p.name.length).toBeLessThanOrEqual(30);
      }
      // Rules from anywhere come out as rules.
      for (const junk of [null, 7, "x", {}, { id: "nope", size: "big" }]) expect(game.validate(game.normalize(junk))).toEqual([]);
    });

    const sizes = [...new Set([game.seats.min, game.seats.default, game.seats.max])];
    for (const seats of sizes) {
      it(`bots play whole games with ${seats} players`, () => {
        for (const seed of [1, 7, 42]) {
          for (const preset of game.presets) {
            const { state } = playOut(game, preset, seats, seed);
            const summary = game.summary(state);
            expect(summary.over).toBe(true);
            expect(summary.winners!.length).toBeGreaterThan(0);
            expect([...summary.order!].sort()).toEqual(Array.from({ length: seats }, (_, i) => i));
            for (let seat = 0; seat < seats; seat++) {
              const v = game.view(state, seat);
              checkBoardView(v, seat);
              expect(v.over!.winners).toEqual(summary.winners);
              // Nothing left to do on a finished board.
              expect(movesOffered(v)).toEqual([]);
            }
          }
        }
      }, 60_000);

      it(`plays from nothing but the views with ${seats} players`, () => {
        for (const preset of game.presets) {
          const rand = mulberry32(seats * 1000 + 3);
          let s = game.newGame(game.normalize(preset), seats, 11);
          for (let moves = 0; !game.summary(s).over; moves++) {
            if (moves > 5000) throw new Error(`${game.id} went on too long`);
            const options = Array.from({ length: seats }, (_, seat) => movesOffered(game.view(s, seat)).map((move) => ({ seat, move }))).flat();
            expect(options.length, `${game.id}: nobody is offered a move`).toBeGreaterThan(0);
            const { seat, move } = options[Math.floor(rand() * options.length)]!;
            s = game.apply(s, seat, move);
          }
        }
      });
    }

    it("starts the same game from the same seed", () => {
      for (const preset of game.presets) {
        const a = game.newGame(preset, game.seats.default, 99);
        const b = game.newGame(preset, game.seats.default, 99);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        for (let seat = 0; seat < game.seats.default; seat++) expect(game.view(a, seat)).toEqual(game.view(b, seat));
        // And the same moves from there give the same game.
        const move = movesOffered(game.view(a, game.view(a, 0).turn ?? 0))[0]!;
        const seat = game.view(a, 0).turn ?? 0;
        expect(JSON.stringify(game.apply(a, seat, move))).toBe(JSON.stringify(game.apply(b, seat, move)));
      }
    });

    it("says the same things to every seat", () => {
      const s = game.newGame(game.presets[0], game.seats.default, 5);
      const views = Array.from({ length: game.seats.default }, (_, seat) => game.view(s, seat));
      for (const v of views) {
        expect(v.game).toBe(game.id);
        expect(v.seats).toBe(game.seats.default);
        expect([v.turn, v.phase, v.scores, v.over]).toEqual([views[0]!.turn, views[0]!.phase, views[0]!.scores, views[0]!.over]);
      }
      // When it's one seat's turn, nobody else is offered a move on the board.
      const turn = views[0]!.turn;
      if (turn !== null) for (const v of views) if (v.me !== turn) expect(v.grids.every((g) => !g.tap?.cells.length && !g.select?.sources.length)).toBe(true);
    });

    it("refuses moves out of turn and leaves the state alone", () => {
      const s = game.newGame(game.presets[0], game.seats.default, 5);
      const before = JSON.stringify(s);
      const turn = game.view(s, 0).turn;
      const mover = turn ?? 0;
      const move = movesOffered(game.view(s, mover))[0]!;
      const idle = Array.from({ length: game.seats.default }, (_, i) => i).find((seat) => !game.bot(s, seat, {}));
      if (idle !== undefined) expect(() => game.apply(s, idle, move)).toThrow(GameError);
      for (const junk of [{ type: "nonsense" }, {}, null, { type: move.type }, { ...move, cell: -1, from: -1, to: 1e9, col: 99 }, { ...move, cell: "x", from: "x", to: "x", col: "x" }]) {
        expect(() => game.apply(s, mover, junk), JSON.stringify(junk)).toThrow(GameError);
      }
      expect(JSON.stringify(s)).toBe(before);
      game.apply(s, mover, move);
      expect(JSON.stringify(s)).toBe(before);
    });
  });
}
