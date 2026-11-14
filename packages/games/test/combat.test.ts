import { describe, expect, it } from "vitest";
import { mulberry32 } from "@spades/rules";
import { admiralsCombat, classicCombat, combat, fleetIsLegal, fleetSizes, GameError, movesOffered, newCombat, quickCombat, randomFleet, salvoCombat, shipCells, type BoardView, type CombatMove, type CombatRules, type CombatState } from "../src/index.js";

const g = combat;
const SHARP = { skill: 1, sloppy: 0 };
const EASY = { skill: 0.25, sloppy: 0.3 };
const PRESETS = [classicCombat, admiralsCombat, salvoCombat, quickCombat];
const other = (seat: number) => 1 - seat;
/** A game where the first seat shoots first, unless the rules name the second (the presets leave it to luck). */
const start = (rules: Partial<CombatRules> = {}, seed = 1) => newCombat(g.normalize({ ...classicCombat, ...rules, first: rules.first === "seat2" ? "seat2" : "seat1" }), 2, seed);
const cell = (name: string) => (Number(name.slice(1)) - 1) * 10 + (name.charCodeAt(0) - 65);

/** Put a ship from a seat's hand on its grid: turn first if it has to lie the other way. */
function lay(s: CombatState, seat: number, kind: string, at: number, across = true): CombatState {
  if (s.across[seat] !== across) s = g.apply(s, seat, { type: "turn" });
  return g.apply(s, seat, { type: "place", from: kind, to: at });
}
/** The classic fleet in rows down the left side: carrier on row 1, cruiser row 3, destroyer row 5, submarine row 7, patrol boat row 9. */
const ROWS: [string, string][] = [["carrier", "A1"], ["cruiser", "A3"], ["destroyer", "A5"], ["submarine", "A7"], ["patrol", "A9"]];
const layRows = (s: CombatState, seat: number) => ROWS.reduce((state, [kind, at]) => lay(state, seat, kind, cell(at)), s);
/** Both fleets down in rows, both ready: the shooting has started. */
const ready = (rules: Partial<CombatRules> = {}) => [0, 1].reduce((s, seat) => g.apply(layRows(s, seat), seat, { type: "ready" }), start(rules));
const shoot = (s: CombatState, seat: number, at: string) => g.apply(s, seat, { type: "shoot", cell: cell(at), grid: "theirs" });
const aim = (s: CombatState, seat: number, at: string) => g.apply(s, seat, { type: "aim", cell: cell(at), grid: "theirs" });
const grid = (v: BoardView, id: string) => v.grids.find((x) => x.id === id)!;

/** Both seats have a random fleet down and are ready. */
function placed(rules: CombatRules, seed: number): CombatState {
  let s = newCombat(rules, 2, seed);
  for (const seat of [0, 1]) s = g.apply(g.apply(s, seat, { type: "auto" }), seat, { type: "ready" });
  return s;
}

describe("placing the fleet", () => {
  it("starts with every ship in hand, an empty grid, and the first ship picked up for you", () => {
    const v = g.view(start(), 0);
    expect(v.phase).toBe("placing");
    // Everyone moves at once.
    expect(v.turn).toBeNull();
    expect(v.grids.map((x) => x.id)).toEqual(["mine"]);
    expect(v.grids[0]!.owner).toBe(0);
    expect(v.grids[0]!.cells.every((c) => c === null)).toBe(true);
    expect(v.reserves).toHaveLength(1);
    expect(v.reserves[0]!.pieces.map((p) => [p.piece.kind, p.piece.glyph.length, p.count])).toEqual([["carrier", 5, 1], ["cruiser", 4, 1], ["destroyer", 3, 1], ["submarine", 3, 1], ["patrol", 2, 1]]);
    expect(v.grids[0]!.select!.suggest).toBe("carrier");
    // A carrier lying across fits with its bow in the first six columns of any row.
    expect(v.grids[0]!.select!.sources.find((s) => s.from === "carrier")!.to).toHaveLength(60);
    expect(v.choices!.options.map((o) => o.move.type)).toEqual(["turn", "auto"]);
    // Ships of a kind are counted together.
    const admirals = g.view(newCombat(admiralsCombat, 2, 1), 0);
    expect(admirals.reserves[0]!.pieces.map((p) => [p.piece.kind, p.count])).toEqual([["cruiser", 1], ["destroyer", 2], ["patrol", 3], ["scout", 4]]);
  });

  it("puts a ship down bow first, across or down, and draws it as one hull", () => {
    let s = lay(start(), 0, "carrier", cell("B2"));
    expect(s.fleets[0]![0]).toMatchObject({ kind: "carrier", at: cell("B2"), across: true });
    s = lay(s, 0, "cruiser", cell("H4"), false);
    const v = g.view(s, 0);
    const cells = v.grids[0]!.cells;
    expect(["B2", "C2", "D2", "E2", "F2"].map((c) => cells[cell(c)]!.span)).toEqual(Array(5).fill("ship-0"));
    expect(["H4", "H5", "H6", "H7"].map((c) => cells[cell(c)]!.label)).toEqual(Array(4).fill("Cruiser"));
    expect(cells.filter(Boolean)).toHaveLength(9);
    expect(v.reserves[0]!.pieces.map((p) => p.piece.kind)).toEqual(["destroyer", "submarine", "patrol"]);
    expect(v.grids[0]!.select!.suggest).toBe("destroyer");
  });

  it("refuses a ship off the board, on another ship, or one you don't have", () => {
    const s = lay(start(), 0, "carrier", cell("B2"));
    expect(() => g.apply(s, 0, { type: "place", from: "cruiser", to: cell("H1") })).toThrow("run off the board");
    expect(() => g.apply(s, 0, { type: "place", from: "cruiser", to: cell("C2") })).toThrow("in the way");
    expect(() => g.apply(s, 0, { type: "place", from: "carrier", to: cell("A5") })).toThrow("no ship like that");
    expect(() => g.apply(s, 0, { type: "place", from: "dreadnought", to: cell("A5") })).toThrow(GameError);
    expect(() => g.apply(s, 0, { type: "place", from: cell("J10"), to: cell("A5") })).toThrow("no ship there");
    expect(() => g.apply(s, 0, { type: "place", from: "cruiser", to: 100 })).toThrow("not on the board");
    expect(() => g.apply(s, 0, { type: "place", from: "cruiser", to: cell("A5"), grid: "theirs" })).toThrow("wrong board");
    // Down from row 8, a cruiser runs off the bottom.
    expect(() => lay(s, 0, "cruiser", cell("A8"), false)).toThrow("run off the board");
    // Classic ships may lie side by side.
    expect(lay(s, 0, "cruiser", cell("B3")).fleets[0]![1]!.at).toBe(cell("B3"));
  });

  it("Admirals: ships can't touch, even at a corner", () => {
    const s = lay(newCombat(admiralsCombat, 2, 1), 0, "cruiser", cell("C3"));
    for (const at of ["C2", "C4", "G3", "G2", "G4", "A2"]) expect(() => lay(s, 0, "destroyer", cell(at)), at).toThrow("can't touch");
    expect(() => lay(s, 0, "scout", cell("B2")), "corner").toThrow("can't touch");
    expect(() => lay(s, 0, "destroyer", cell("D3")), "on top").toThrow("in the way");
    // One clear square between them is enough.
    expect(lay(s, 0, "destroyer", cell("C5")).fleets[0]![1]!.at).toBe(cell("C5"));
    expect(lay(s, 0, "scout", cell("H3")).fleets[0]![6]!.at).toBe(cell("H3"));
    // And the view never offers a square that would touch.
    const to = g.view(s, 0).grids[0]!.select!.sources.find((x) => x.from === "destroyer")!.to;
    expect(to).not.toContain(cell("C4"));
    expect(to).not.toContain(cell("G4"));
    expect(to).toContain(cell("C5"));
  });

  it("picks a placed ship back up by any square of it, and turns it", () => {
    let s = lay(start(), 0, "carrier", cell("B2"));
    // The view offers it by its bow; the table picks it up from any of its squares.
    const source = g.view(s, 0).grids[0]!.select!.sources.find((x) => x.from === cell("B2"))!;
    expect(source.to).not.toContain(cell("B2"));
    expect(source.to).toContain(cell("C2"));
    s = g.apply(s, 0, { type: "place", from: cell("D2"), to: cell("A6") });
    expect(s.fleets[0]![0]).toMatchObject({ at: cell("A6"), across: true });
    expect(() => g.apply(s, 0, { type: "place", from: cell("A6"), to: cell("A6") })).toThrow("already there");
    // Turned, it can go down from where its bow already is.
    s = g.apply(s, 0, { type: "turn" });
    expect(g.view(s, 0).choices!.options[0]!.label).toContain("now down");
    s = g.apply(s, 0, { type: "place", from: cell("A6"), to: cell("A6") });
    expect(s.fleets[0]![0]).toMatchObject({ at: cell("A6"), across: false });
    expect(g.view(s, 0).grids[0]!.cells[cell("A10")]!.label).toBe("Carrier");
  });

  it("“Place them for me” lays out a legal fleet for every preset, the same one from the same seed", () => {
    for (const preset of PRESETS) {
      for (let seed = 0; seed < 40; seed++) {
        const s = g.apply(newCombat(preset, 2, seed), 0, { type: "auto" });
        expect(fleetIsLegal(preset, s.fleets[0]!), `${preset.id} ${seed}`).toBe(true);
        expect(s.fleets[0]!.map((ship) => ship.size)).toEqual(fleetSizes(preset.fleet));
        expect(s.fleets[1]!.every((ship) => ship.at === null)).toBe(true);
        expect(g.apply(newCombat(preset, 2, seed), 0, { type: "auto" })).toEqual(s);
        // Asking again shuffles them.
        expect(g.view(s, 0).choices!.options.map((o) => o.label)).toEqual(expect.arrayContaining(["Shuffle them for me", "Ready"]));
        expect(g.apply(s, 0, { type: "auto" }).fleets[0]).not.toEqual(s.fleets[0]);
      }
    }
    // The helper says when a fleet is laid out by the rules and when it isn't.
    const fleet = randomFleet(admiralsCombat, mulberry32(3))!;
    expect(fleetIsLegal(admiralsCombat, fleet)).toBe(true);
    const cruiser = fleet[0]!;
    const squares = shipCells(10, cruiser.size, cruiser.at!, cruiser.across)!;
    expect(fleetIsLegal(admiralsCombat, [...fleet.slice(0, 9), { ...fleet[9]!, at: squares[0]! }])).toBe(false);
  });

  it("only takes “Ready” with every ship down, and then the fleet is fixed", () => {
    let s = layRows(start(), 0);
    expect(g.view(lay(start(), 0, "carrier", 0), 0).choices!.options.some((o) => o.move.type === "ready")).toBe(false);
    expect(() => g.apply(lay(start(), 0, "carrier", 0), 0, { type: "ready" })).toThrow("all your ships");
    s = g.apply(s, 0, { type: "ready" });
    expect(s.phase).toBe("placing");
    const v = g.view(s, 0);
    expect(movesOffered(v)).toEqual([]);
    expect(v.narration).toContain("Waiting for {1}");
    for (const move of [{ type: "turn" }, { type: "auto" }, { type: "ready" }, { type: "place", from: 0, to: cell("A2") }] as CombatMove[]) expect(() => g.apply(s, 0, move)).toThrow("ready");
    // Nobody shoots until both are ready.
    expect(() => shoot(s, 0, "A1")).toThrow("both fleets");
  });

  it("both ready starts the shooting, with the seat the rules name", () => {
    expect(ready()).toMatchObject({ phase: "shooting", turn: 0 });
    expect(ready({ first: "seat2" })).toMatchObject({ phase: "shooting", turn: 1 });
    // It doesn't matter who was ready first.
    const late = [1, 0].reduce((s, seat) => g.apply(layRows(s, seat), seat, { type: "ready" }), start());
    expect(late).toMatchObject({ phase: "shooting", turn: 0 });
    const firsts = new Set(Array.from({ length: 20 }, (_, seed) => placed(classicCombat, seed).turn));
    expect(firsts.size).toBe(2);
    const v = g.view(ready(), 0);
    expect(v.turn).toBe(0);
    expect(v.grids.map((x) => [x.id, x.owner])).toEqual([["theirs", undefined], ["mine", 0]]);
    expect(grid(v, "theirs").tap).toMatchObject({ type: "shoot" });
    expect(grid(v, "theirs").tap!.cells).toHaveLength(100);
    expect(grid(g.view(ready(), 1), "theirs").tap ?? null).toBeNull();
    expect(v.players.map((p) => p.badge)).toEqual(["Shoots first", undefined]);
    expect(() => g.apply(ready(), 0, { type: "place", from: 0, to: 50 })).toThrow("already placed");
  });

  it("tells the other player nothing but “placing” or “ready”", () => {
    let s = start();
    const before = JSON.stringify(g.view(s, 1));
    // Seat 0 turns, places, moves, shuffles: seat 1's view doesn't change by a character.
    for (const move of [{ type: "turn" }, { type: "place", from: "carrier", to: 3 }, { type: "turn" }, { type: "place", from: 3, to: 40 }, { type: "auto" }] as CombatMove[]) {
      s = g.apply(s, 0, move);
      expect(JSON.stringify(g.view(s, 1))).toBe(before);
      expect(JSON.stringify(g.summary(s))).toBe(JSON.stringify(g.summary(start())));
    }
    s = g.apply(s, 0, { type: "ready" });
    const after = g.view(s, 1);
    expect(after.players.map((p) => p.line)).toEqual(["Ready", "Placing ships"]);
    expect(JSON.stringify({ ...after, players: null })).toBe(JSON.stringify({ ...JSON.parse(before), players: null }));
  });
});

describe("shooting", () => {
  it("a miss, a hit, and the turn passing", () => {
    let s = shoot(ready(), 0, "A2");
    expect(s.narration).toBe("{0} fires at A2: miss");
    expect(s.turn).toBe(1);
    expect(grid(g.view(s, 0), "theirs").cells[cell("A2")]).toMatchObject({ kind: "miss", owner: null });
    expect(grid(g.view(s, 0), "theirs").marks).toEqual([{ cell: cell("A2"), mark: "last" }]);
    // The other player sees the splash on their own grid.
    expect(grid(g.view(s, 1), "mine").cells[cell("A2")]).toMatchObject({ kind: "miss" });
    expect(grid(g.view(s, 1), "mine").marks).toEqual([{ cell: cell("A2"), mark: "last" }]);
    s = shoot(s, 1, "C1");
    expect(s.narration).toBe("{1} fires at C1: hit!");
    expect(s.turn).toBe(0);
    expect(grid(g.view(s, 1), "theirs").cells[cell("C1")]).toMatchObject({ kind: "hit", owner: null, label: "hit" });
    // The one who was hit sees which ship.
    expect(grid(g.view(s, 0), "mine").cells[cell("C1")]).toMatchObject({ kind: "hit", owner: 0, label: "Carrier, hit", span: "ship-0" });
    expect(grid(g.view(s, 0), "mine").cells[cell("B1")]).toMatchObject({ kind: "ship", label: "Carrier", span: "ship-0" });
  });

  it("refuses the same square twice, a shot out of turn, off the board or at your own grid", () => {
    const s = shoot(shoot(ready(), 0, "A2"), 1, "J10");
    expect(() => shoot(s, 0, "A2")).toThrow("already shot there");
    expect(() => shoot(s, 1, "A2")).toThrow("not your turn");
    expect(() => g.apply(s, 0, { type: "shoot", cell: 100 })).toThrow("not on the board");
    expect(() => g.apply(s, 0, { type: "shoot", cell: 2.5 })).toThrow(GameError);
    expect(() => g.apply(s, 0, { type: "shoot", cell: 5, grid: "mine" })).toThrow("wrong board");
    expect(() => g.apply(s, 0, { type: "aim", cell: 5 })).toThrow(GameError);
    expect(() => g.apply(s, 0, { type: "fire" })).toThrow(GameError);
    // A square already shot isn't offered again.
    expect(grid(g.view(s, 0), "theirs").tap!.cells).not.toContain(cell("A2"));
    expect(grid(g.view(s, 0), "theirs").tap!.cells).toHaveLength(99);
  });

  it("“You sank my patrol boat!”: a ship goes down when its last square is hit", () => {
    let s = shoot(shoot(shoot(ready(), 0, "A9"), 1, "J10"), 0, "B9");
    expect(s.narration).toBe("{0} fires at B9: hit! {1} says: “You sank my Patrol boat!”");
    const v = g.view(s, 0);
    // Outlined on the target grid as one hull, and off the list of what's afloat.
    expect([cell("A9"), cell("B9")].map((c) => grid(v, "theirs").cells[c])).toEqual(Array(2).fill({ owner: 1, kind: "sunk", glyph: "✕", label: "sunk Patrol boat", tone: "red", span: `theirs-${cell("A9")}` }));
    expect(v.reserves.find((r) => r.owner === 1)).toMatchObject({ label: "Afloat" });
    expect(v.reserves.find((r) => r.owner === 1)!.pieces.map((p) => p.piece.kind)).toEqual(["carrier", "cruiser", "destroyer", "submarine"]);
    expect(g.view(s, 1).reserves.find((r) => r.owner === 1)!.pieces.map((p) => p.piece.kind)).toEqual(["carrier", "cruiser", "destroyer", "submarine"]);
    expect(grid(g.view(s, 1), "mine").cells[cell("A9")]).toMatchObject({ kind: "sunk", label: "sunk Patrol boat" });
    s = shoot(s, 1, "J9");
    expect(s.phase).toBe("shooting");
  });

  it("the first to sink the whole fleet wins, and both fleets are shown", () => {
    let s = ready();
    const targets = ROWS.flatMap(([kind, at]) => shipCells(10, { carrier: 5, cruiser: 4, destroyer: 3, submarine: 3, patrol: 2 }[kind]!, cell(at), true)!);
    targets.forEach((c, i) => {
      s = g.apply(s, 0, { type: "shoot", cell: c });
      // Seat 1 misses every time, down the right-hand side.
      if (i < targets.length - 1) s = g.apply(s, 1, { type: "shoot", cell: 9 + 10 * (i % 10) - (i >= 10 ? 1 : 0) });
    });
    expect(g.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: "1 to 0", phase: "finished" });
    expect(s.narration).toBe("{0} sinks the last of {1}'s fleet!");
    const loser = g.view(s, 1);
    expect(loser.over).toEqual({ winners: [0], title: "{0} wins!" });
    // The loser now sees where the winner's ships were all along.
    const shown = grid(loser, "theirs").cells;
    expect(shown[cell("A1")]).toMatchObject({ owner: 0, kind: "ship", label: "Carrier", faded: true });
    expect(shown.filter((c) => c?.kind === "ship")).toHaveLength(17);
    expect(movesOffered(loser)).toEqual([]);
    expect(() => shoot(s, 1, "A1")).toThrow("over");
  });

  it("without the announce rule a sinking is only ever a hit", () => {
    let s = shoot(shoot(shoot(ready({ announce: false }), 0, "A9"), 1, "J10"), 0, "B9");
    expect(s.narration).toBe("{0} fires at B9: hit!");
    const v = g.view(s, 0);
    expect(grid(v, "theirs").cells[cell("B9")]).toEqual({ owner: null, kind: "hit", glyph: "✕", label: "hit", tone: "red" });
    // The whole fleet is still listed: nobody has said what's gone.
    expect(v.reserves.find((r) => r.owner === 1)).toMatchObject({ label: "Fleet" });
    expect(v.reserves.find((r) => r.owner === 1)!.pieces).toHaveLength(5);
    // Its owner knows, of course.
    expect(g.view(s, 1).reserves.find((r) => r.owner === 1)!.pieces.map((p) => p.piece.kind)).not.toContain("patrol");
  });

  it("a hit earns another shot when the rules say so", () => {
    let s = shoot(ready({ again: true }), 0, "A1");
    expect(s.turn).toBe(0);
    expect(g.view(s, 0).info).toContain("A hit earns another shot");
    s = shoot(s, 0, "B1");
    expect(s.turn).toBe(0);
    s = shoot(s, 0, "A2");
    expect(s.turn).toBe(1);
    // Without the rule, a hit passes the turn like a miss.
    expect(shoot(ready(), 0, "A1").turn).toBe(1);
  });

  it("Admirals: the water round a sunk ship is ruled out", () => {
    let s = newCombat({ ...admiralsCombat, first: "seat1", again: false }, 2, 1);
    for (const seat of [0, 1]) {
      const spots: [string, string][] = [["cruiser", "A1"], ["destroyer", "A3"], ["destroyer", "A5"], ["patrol", "A7"], ["patrol", "A9"], ["patrol", "F1"], ["scout", "F3"], ["scout", "F5"], ["scout", "F7"], ["scout", "F9"]];
      for (const [kind, at] of spots) s = lay(s, seat, kind, cell(at));
      s = g.apply(s, seat, { type: "ready" });
    }
    s = shoot(s, 0, "F5");
    expect(s.narration).toContain("“You sank my Scout!”");
    const v = g.view(s, 0);
    const theirs = grid(v, "theirs");
    for (const at of ["E4", "F4", "G4", "E5", "G5", "E6", "F6", "G6"]) {
      expect(theirs.cells[cell(at)], at).toMatchObject({ kind: "clear" });
      expect(() => shoot(shoot(s, 1, "J10"), 0, at)).toThrow("ships never touch");
    }
    expect(theirs.cells.filter((c) => c?.kind === "clear")).toHaveLength(8);
    // The other player isn't shown my working.
    expect(grid(g.view(s, 1), "mine").cells.filter((c) => c?.kind === "clear")).toHaveLength(0);
    s = shoot(s, 1, "J10");
    expect(grid(g.view(s, 0), "theirs").tap!.cells).toHaveLength(91);
  });
});

describe("Salvo", () => {
  const salvo = () => ready({ salvo: true });

  it("is a shot per ship afloat, all marked before any lands", () => {
    let s = salvo();
    expect(g.view(s, 0).narration).toContain("mark 5 squares");
    expect(grid(g.view(s, 0), "theirs").tap).toMatchObject({ type: "aim" });
    const quiet = JSON.stringify(g.view(s, 1));
    for (const at of ["A1", "B1", "J5", "J6"]) {
      s = aim(s, 0, at);
      // Nothing has been fired: the other player sees nothing, and I'm told nothing.
      expect(JSON.stringify(g.view(s, 1))).toBe(quiet);
      expect(grid(g.view(s, 0), "theirs").cells[cell(at)]).toMatchObject({ kind: "aim" });
    }
    expect(s.shots[0]!.some(Boolean)).toBe(false);
    expect(g.view(s, 0).info).toContain("Shots marked: 4 of 5");
    expect(g.view(s, 0).choices).toBeNull();
    expect(() => g.apply(s, 0, { type: "fire" })).toThrow("Mark 5 squares");
    expect(() => shoot(s, 0, "A1")).toThrow("fire them together");
    // Tapping a marked square takes the mark off.
    s = aim(s, 0, "J6");
    expect(s.aims[0]).toEqual([cell("A1"), cell("B1"), cell("J5")]);
    s = aim(aim(s, 0, "J7"), 0, "J8");
    const full = g.view(s, 0);
    expect(full.choices!.options).toEqual([{ label: "Fire all 5!", move: { type: "fire" }, primary: true }]);
    // With every shot marked, the only squares to tap are the marked ones.
    expect([...grid(full, "theirs").tap!.cells].sort((a, b) => a - b)).toEqual([...s.aims[0]!].sort((a, b) => a - b));
    expect(() => aim(s, 0, "J9")).toThrow("all your shots");
    s = g.apply(s, 0, { type: "fire" });
    expect(s.narration).toBe("{0} fires 5 shots: 2 hits!");
    expect(s.turn).toBe(1);
    expect(s.aims[0]).toEqual([]);
    expect(grid(g.view(s, 1), "mine").marks).toHaveLength(5);
    expect(grid(g.view(s, 0), "theirs").cells[cell("A1")]).toMatchObject({ kind: "hit" });
    expect(grid(g.view(s, 0), "theirs").cells[cell("J5")]).toMatchObject({ kind: "miss" });
  });

  it("gives fewer shots as your ships go down", () => {
    let s = salvo();
    const volley = (seat: number, ...at: string[]) => {
      for (const a of at) s = aim(s, seat, a);
      s = g.apply(s, seat, { type: "fire" });
    };
    volley(0, "A9", "B9", "A7", "B7", "C7");
    expect(s.narration).toBe("{0} fires 5 shots: 5 hits! {1} says: “You sank my Submarine and Patrol boat!”");
    // Seat 1 has three ships left, so three shots.
    expect(g.view(s, 1).narration).toContain("5 hits");
    for (const at of ["J1", "J2", "J3"]) s = aim(s, 1, at);
    expect(() => aim(s, 1, "J4")).toThrow("all your shots");
    expect(g.view(s, 1).choices!.options[0]!.label).toBe("Fire all 3!");
    s = g.apply(s, 1, { type: "fire" });
    expect(s.narration).toBe("{1} fires 3 shots: all miss");
    // A hit doesn't earn more in Salvo, whatever was asked for.
    expect(g.normalize({ ...salvoCombat, again: true }).again).toBe(false);
  });
});

describe("a match", () => {
  it("is most wins, taking turns to shoot first, with fresh fleets each game", () => {
    let s = ready({ games: 3 });
    const sink = (seat: number) => {
      for (const c of s.fleets[other(seat)]!.flatMap((ship) => shipCells(10, ship.size, ship.at!, ship.across)!)) {
        if (s.phase !== "shooting") break;
        if (s.turn !== seat) s = g.apply(s, other(seat), { type: "shoot", cell: s.shots[other(seat)]!.indexOf(false, 50) });
        s = g.apply(s, seat, { type: "shoot", cell: c });
      }
    };
    sink(0);
    expect(s).toMatchObject({ phase: "scored", wins: [1, 0], roundWinner: 0 });
    expect(s.narration).toBe("{0} sinks the last of {1}'s fleet and wins game 1!");
    const v = g.view(s, 1);
    expect(v.result).toMatchObject({ key: "game-1", title: "{0} wins game 1" });
    expect(v.over).toBeNull();
    expect(v.choices!.options[0]).toMatchObject({ label: "Next game", move: { type: "next" } });
    // Between games both fleets are shown.
    expect(grid(v, "theirs").cells.filter((c) => c?.owner === 0)).toHaveLength(17);
    s = g.apply(s, 0, { type: "next" });
    expect(() => g.apply(s, 0, { type: "next" })).toThrow("Waiting");
    s = g.apply(s, 1, { type: "next" });
    expect(s).toMatchObject({ phase: "placing", round: 2, first: 1, set: [false, false] });
    expect(s.fleets.flat().every((ship) => ship.at === null)).toBe(true);
    expect(s.shots.flat().some(Boolean)).toBe(false);
    for (const seat of [0, 1]) s = g.apply(layRows(s, seat), seat, { type: "ready" });
    expect(s.turn).toBe(1);
    sink(0);
    // Two of three: the third game isn't played.
    expect(g.summary(s)).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: "2 to 0", hand: 2 });
    expect(g.view(s, 0).over).toEqual({ winners: [0], title: "{0} wins 2 to 0!" });
  });
});

describe("the rules", () => {
  it("come out whole from anything, and a fleet has to fit its board", () => {
    expect(g.normalize({ id: "combat-quick" })).toEqual(quickCombat);
    expect(g.normalize({ size: 99, fleet: "armada", games: 4, first: "me" })).toMatchObject({ size: 12, fleet: "classic", games: 1, first: "random" });
    expect(g.validate(g.normalize({ ...admiralsCombat, size: 6 }))[0]).toContain("doesn't fit on a 6×6 board without ships touching");
    expect(g.validate(g.normalize({ ...classicCombat, size: 7 }))).toEqual([]);
    expect(g.describe(admiralsCombat).join(" ")).toContain("a cruiser (4), two destroyers (3), three patrol boats (2) and four scouts (1)");
    // Nobody says the trademarked name.
    for (const preset of PRESETS) expect(JSON.stringify([g.name, g.blurb, g.tagline, g.describe(preset), g.fields, preset]).toLowerCase()).not.toContain("battleship");
  });
});

// ---- What can't be seen ---------------------------------------------------------------------------

/**
 * The same game with one of the other seat's ships somewhere else, where `seat` couldn't know the
 * difference: a ship not yet sunk, moved so that it still lies under exactly the same shots (the
 * hits on it are still hits on it, and it's under no miss) and the fleet is still legal. Null when
 * no ship can be moved like that.
 */
function disguised(s: CombatState, seat: number, rand: () => number): CombatState | null {
  const n = s.rules.size;
  const them = other(seat);
  const shots = s.shots[seat]!;
  const fleet = s.fleets[them]!;
  const order = fleet.map((_, i) => i).sort(() => rand() - 0.5);
  for (const i of order) {
    const ship = fleet[i]!;
    if (ship.at === null) continue;
    const squares = shipCells(n, ship.size, ship.at, ship.across)!;
    if (squares.every((c) => shots[c])) continue;
    const hits = squares.filter((c) => shots[c]).sort().join();
    // Every other place it could lie, tried in a random order: the first that fits is the disguise.
    const spots = [true, false].flatMap((across) => Array.from({ length: n * n }, (_, at) => ({ at, across }))).sort(() => rand() - 0.5);
    for (const { at, across } of spots) {
      const cells = shipCells(n, ship.size, at, across);
      if (!cells || (at === ship.at && (across === ship.across || ship.size === 1))) continue;
      if (cells.filter((c) => shots[c]).sort().join() !== hits) continue;
      if (!fleetIsLegal(s.rules, fleet.map((sh, j) => (j === i ? { ...sh, at, across } : sh)))) continue;
      const next = structuredClone(s);
      Object.assign(next.fleets[them]![i]!, { at, across });
      return next;
    }
  }
  return null;
}

describe("hidden information", () => {
  const VARIANTS: CombatRules[] = [...PRESETS, { ...classicCombat, announce: false }, { ...admiralsCombat, announce: false }, { ...salvoCombat, announce: false, games: 3 }];

  it("no seat's view, and no computer player's move, depends on where the other fleet's unsunk ships are", () => {
    let steps = 0;
    let swaps = 0;
    for (const [v, rules] of VARIANTS.entries()) {
      for (let seed = 1; seed <= 3; seed++) {
        const rand = mulberry32(seed * 100 + v);
        let s = newCombat(rules, 2, seed);
        for (let moves = 0; !g.summary(s).over; moves++) {
          if (moves > 3000) throw new Error("went on too long");
          for (const seat of [0, 1]) {
            const view = g.view(s, seat);
            const text = JSON.stringify(view);
            const playing = s.phase === "placing" || s.phase === "shooting";
            const theirs = s.fleets[other(seat)]!;
            if (s.phase === "placing") {
              // While placing there is no second grid at all, and nothing of the other seat's but one word.
              expect(view.grids.map((x) => x.id)).toEqual(["mine"]);
              expect(view.reserves.every((r) => r.owner === seat)).toBe(true);
              const blank = structuredClone(s);
              blank.fleets[other(seat)] = blank.fleets[other(seat)]!.map((ship) => ({ ...ship, at: null, across: true }));
              blank.across[other(seat)] = true;
              expect(JSON.stringify(g.view(blank, seat))).toBe(text);
            }
            if (s.phase === "shooting") {
              // On the target grid, a square I haven't shot is water whether a ship is under it or not:
              // empty, or marked with my own working (a shot I've aimed, water I've ruled out).
              const target = grid(view, "theirs");
              const under = new Set(theirs.flatMap((ship) => shipCells(rules.size, ship.size, ship.at!, ship.across)!));
              target.cells.forEach((piece, c) => {
                if (s.shots[seat]![c]) return;
                if (under.has(c)) expect(piece === null || piece.kind === "aim", `${rules.id} seed ${seed}: an unshot ship square shows ${JSON.stringify(piece)}`).toBe(true);
                else expect(piece === null || piece.kind === "aim" || piece.kind === "clear").toBe(true);
              });
              // Nothing but hulls I've been told are sunk is joined into a ship.
              for (const piece of target.cells) if (piece?.span) expect(piece.kind).toBe("sunk");
              if (!rules.announce) expect(target.cells.some((piece) => piece?.span || piece?.kind === "sunk")).toBe(false);
            }
            if (!playing) continue;
            // The real test: move an unsunk ship to anywhere else that fits what this seat has seen, and
            // everything it is sent (cells, ids, labels, marks, narration, reserves, buttons) is the same
            // to the character. So is the public summary, and so is what a computer player would do.
            const twin = disguised(s, seat, rand);
            steps++;
            if (!twin) continue;
            swaps++;
            expect(JSON.stringify(twin.fleets)).not.toBe(JSON.stringify(s.fleets));
            expect(JSON.stringify(g.view(twin, seat)), `${rules.id} seed ${seed} move ${moves}`).toBe(text);
            expect(JSON.stringify(g.summary(twin))).toBe(JSON.stringify(g.summary(s)));
            const style = moves % 3 ? SHARP : EASY;
            expect(g.bot(twin, seat, style, mulberry32(moves))).toEqual(g.bot(s, seat, style, mulberry32(moves)));
          }
          const seat = [0, 1].find((x) => g.bot(s, x, SHARP, mulberry32(moves)) !== null)!;
          s = g.apply(s, seat, g.bot(s, seat, (seed + seat) % 2 ? SHARP : EASY, rand)!);
        }
        // Once it's over, both fleets are on the table.
        for (const seat of [0, 1]) expect(grid(g.view(s, seat), "theirs").cells.filter((c) => c?.span)).toHaveLength(fleetSizes(rules.fleet).reduce((a, b) => a + b, 0));
      }
    }
    // The test only means something if ships really were moved, most of the time.
    expect(steps).toBeGreaterThan(1500);
    expect(swaps / steps).toBeGreaterThan(0.8);
  }, 120_000);

  it("the summary anyone can read says nothing of ships", () => {
    let s = shoot(shoot(shoot(ready(), 0, "A9"), 1, "J10"), 0, "B9");
    expect(g.summary(s)).toEqual({ game: "combat", rules: "Classic", phase: "shooting", over: false, hand: 1, scoreLine: "0 to 0", order: null, winners: null, teams: false, seats: 2 });
    s = shoot(s, 1, "A1");
    expect(g.summary(s).scoreLine).toBe("0 to 0");
  });
});

// ---- Computer players -----------------------------------------------------------------------------

describe("computer players", () => {
  /** Squares of other ships each ship lies against, summed over a fleet a computer player placed. */
  function crowding(style: object, seed: number): number {
    const rand = mulberry32(seed);
    let s = start({}, seed);
    while (!s.set[0]) s = g.apply(s, 0, g.bot(s, 0, style, rand)!);
    expect(fleetIsLegal(s.rules, s.fleets[0]!)).toBe(true);
    const squares = s.fleets[0]!.map((ship) => shipCells(10, ship.size, ship.at!, ship.across)!);
    let touching = 0;
    squares.forEach((a, i) => squares.forEach((b, j) => i !== j && a.forEach((x) => b.forEach((y) => Math.abs((x % 10) - (y % 10)) <= 1 && Math.abs(Math.floor(x / 10) - Math.floor(y / 10)) <= 1 && touching++))));
    return touching;
  }

  it("place a legal fleet a ship at a time, both ways round, and the careful ones keep their ships apart", () => {
    const seeds = Array.from({ length: 40 }, (_, i) => i + 1);
    const sharp = seeds.reduce((sum, seed) => sum + crowding(SHARP, seed), 0);
    const easy = seeds.reduce((sum, seed) => sum + crowding({ skill: 0, sloppy: 1 }, seed), 0);
    expect(sharp).toBe(0);
    expect(easy).toBeGreaterThan(20);
    // Fleets don't all lie the same way.
    const ways = new Set(seeds.flatMap((seed) => {
      let s = start({}, seed);
      const rand = mulberry32(seed);
      while (!s.set[1]) s = g.apply(s, 1, g.bot(s, 1, SHARP, rand)!);
      return s.fleets[1]!.map((ship) => ship.across);
    }));
    expect(ways.size).toBe(2);
    // Ready, a computer player has nothing more to do until the shooting starts.
    let s = start();
    while (!s.set[0]) s = g.apply(s, 0, g.bot(s, 0, SHARP)!);
    expect(g.bot(s, 0, SHARP)).toBeNull();
  });

  /** How many shots a computer player needs to sink a fleet it can't see. The other seat only ever shoots water (the test looks; the player doesn't). */
  function shotsToSink(rules: CombatRules, style: object, seed: number): number {
    const rand = mulberry32(seed);
    let s = placed({ ...rules, first: "seat1" }, seed);
    let shots = 0;
    while (!g.summary(s).over) {
      if (s.turn === 0) {
        const move = g.bot(s, 0, style, rand)!;
        if (move.type !== "fire") shots++;
        s = g.apply(s, 0, move);
        continue;
      }
      const mine = new Set(s.fleets[0]!.flatMap((ship) => shipCells(rules.size, ship.size, ship.at!, ship.across)!));
      const open = s.shots[1]!.flatMap((shot, c) => (shot ? [] : [c]));
      const water = open.filter((c) => !mine.has(c));
      const targets = water.length ? water : open;
      // A volley is as many marks as it takes for the view to offer "Fire".
      for (let i = 0; rules.salvo && !g.view(s, 1).choices; i++) s = g.apply(s, 1, { type: "aim", cell: targets[i]! });
      s = g.apply(s, 1, rules.salvo ? { type: "fire" } : { type: "shoot", cell: targets[0]! });
    }
    expect(g.summary(s).winners).toEqual([0]);
    return shots;
  }
  const average = (rules: CombatRules, style: object, games = 40) => Array.from({ length: games }, (_, i) => shotsToSink(rules, style, i + 1)).reduce((a, b) => a + b, 0) / games;

  it("the sharp one needs far fewer shots than the careless one, and thinking beats a checkerboard", () => {
    const sharp = average(classicCombat, SHARP);
    const middling = average(classicCombat, { skill: 0.7, sloppy: 0 });
    const easy = average(classicCombat, EASY);
    const wild = average(classicCombat, { skill: 0, sloppy: 1 });
    // Shooting at random takes nearly the whole board.
    expect(wild).toBeGreaterThan(90);
    expect(easy).toBeLessThan(wild - 5);
    expect(middling).toBeLessThan(easy - 8);
    expect(sharp).toBeLessThan(middling);
    expect(sharp).toBeLessThan(52);
  }, 60_000);

  it("hunts well with every preset, and when nobody says what's sunk", () => {
    expect(average(admiralsCombat, SHARP, 20)).toBeLessThan(average(admiralsCombat, EASY, 20) - 5);
    expect(average(quickCombat, SHARP, 20)).toBeLessThan(average(quickCombat, EASY, 20) - 3);
    expect(average(salvoCombat, SHARP, 20)).toBeLessThan(average(salvoCombat, EASY, 20) - 8);
    expect(average({ ...classicCombat, announce: false }, SHARP, 20)).toBeLessThan(66);
  }, 60_000);

  it("after a hit, works along the line until the ship is sunk", () => {
    // Two hits in a row on the carrier: the next shot is at one end of them.
    let s = shoot(shoot(shoot(ready(), 0, "B1"), 1, "J10"), 0, "C1");
    s = shoot(s, 1, "J9");
    for (let i = 0; i < 20; i++) expect([cell("A1"), cell("D1")]).toContain((g.bot(s, 0, SHARP, mulberry32(i)) as { cell: number }).cell);
    // Blocked at one end, it goes to the other.
    s = shoot(shoot(s, 0, "A1"), 1, "J8");
    for (let i = 0; i < 20; i++) expect((g.bot(s, 0, SHARP, mulberry32(i)) as { cell: number }).cell).toBe(cell("D1"));
  });

  it("in Salvo, spreads a volley instead of piling it on one square", () => {
    let s = ready({ salvo: true });
    const rand = mulberry32(4);
    for (let i = 0; i < 5; i++) s = g.apply(s, 0, g.bot(s, 0, SHARP, rand)!);
    expect(new Set(s.aims[0]).size).toBe(5);
    expect(g.bot(s, 0, SHARP, rand)).toEqual({ type: "fire" });
    // Hunting shots of one volley aren't side by side.
    const near = s.aims[0]!.filter((a) => s.aims[0]!.some((b) => a !== b && Math.abs((a % 10) - (b % 10)) + Math.abs(Math.floor(a / 10) - Math.floor(b / 10)) === 1));
    expect(near).toEqual([]);
  });
});
