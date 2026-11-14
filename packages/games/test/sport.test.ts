// Every table sport on the kit, the way board.test.ts checks every board game: computer players
// finish whole games with every preset at every table size, the same seed always starts the same
// game, every view is consistent with itself and with the physics (the shot a view carries really
// does end where the view says it did), a seat is offered a shot exactly when the engine will take
// one from it, and refused moves change nothing.
import { simulate, validateShot, validateWorld } from "@cardroom/physics";
import { mulberry32 } from "@spades/rules";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameError, SPORT_GAMES, angleTo, isSportGame, restOf, sameRest, sportMovesOffered, worldBefore, type SportGame, type SportView } from "../src/index.js";

const STYLES = [{}, { skill: 0.3, sloppy: 0.3 }, { skill: 1, sloppy: 0 }];
afterEach(() => vi.restoreAllMocks());
/** Computer players roll dice for their aim; the tests give them the same dice every time. */
const seededDice = (seed: number) => vi.spyOn(Math, "random").mockImplementation(mulberry32(seed));

/** A view makes sense on its own: its world can be simulated, and everything it points at is there. */
export function checkSportView(v: SportView, seat: number) {
  expect(v.me).toBe(seat);
  expect(v.players).toHaveLength(v.seats);
  expect(validateWorld(v.table.world)).toEqual([]);
  expect(v.table.key && v.table.name).toBeTruthy();
  const bodies = new Set(v.table.world.bodies.map((b) => b.id));
  const looks = new Set(v.table.bodies.map((b) => b.id));
  // Everything on the table has a look, and a ghost is never also a body.
  for (const id of bodies) expect(looks.has(id)).toBe(true);
  for (const g of v.table.ghosts) {
    expect(bodies.has(g.id)).toBe(false);
    expect(g.r).toBeGreaterThan(0);
    expect(g.label && g.tone).toBeTruthy();
  }
  const regions = new Set(v.table.world.regions.map((r) => r.id));
  for (const r of v.table.look.regions) expect(regions.has(r.id)).toBe(true);
  const walls = new Set(v.table.world.walls.map((w) => w.id));
  for (const id of v.table.look.blocks) expect(walls.has(id)).toBe(true);
  const f = v.table.look.frame;
  expect(f.w > 0 && f.h > 0).toBe(true);
  if (v.shoot) {
    // What you may strike is on the table and in play, at any strength in the range.
    for (const power of [v.shoot.minPower, v.shoot.maxPower]) expect(validateShot(v.table.world, { body: v.shoot.body, angle: 0, power })).toEqual([]);
    expect(v.shoot.minPower).toBeLessThanOrEqual(v.shoot.maxPower);
    if (v.turn !== null) expect(v.turn).toBe(seat);
    expect(v.over).toBeNull();
  }
  if (v.last) {
    // The heart of the kit: the shot a view carries, played from where the view says it started,
    // ends exactly where the view says it ended. This is what every browser's animation does.
    const before = worldBefore(v)!;
    expect(validateWorld(before)).toEqual([]);
    const played = simulate(before, v.last.shot);
    expect(sameRest(played.world, v.last.rest)).toBe(true);
    expect(played.ticks).toBe(v.last.ticks);
    expect(v.last.n).toBeGreaterThan(0);
    for (const b of v.last.from) expect(looks.has(b.id)).toBe(true);
  }
  if (v.card) {
    for (const row of v.card.rows) expect(row.cells).toHaveLength(v.card.columns.length);
    expect(v.card.rows.map((r) => r.seat)).toEqual(Array.from({ length: v.seats }, (_, i) => i));
  }
  if (v.over) expect(v.over.winners.length).toBeGreaterThan(0);
}

/** Bots play until it's over. Along the way every seat's view is checked, and a seat can shoot exactly when its view says so. */
export function playOut(game: SportGame<any, any, any>, rules: unknown, seats: number, seed: number, limit = 3000) {
  seededDice(seed);
  let s = game.newGame(game.normalize(rules), seats, seed);
  let moves = 0;
  while (!game.summary(s).over) {
    let moved = false;
    for (let seat = 0; seat < seats; seat++) {
      const v = game.view(s, seat);
      checkSportView(v, seat);
      const before = JSON.stringify(s);
      const tries = sportMovesOffered(v);
      for (const m of tries) game.apply(s, seat, m);
      if (!v.shoot) expect(() => game.apply(s, seat, { type: "shot", body: v.table.bodies.find((b) => b.owner === seat)?.id ?? "ball", angle: 0, power: 500 }), `${game.id}: seat ${seat} isn't offered a shot but may take one`).toThrow(GameError);
      // Trying moves never changes the state it was given.
      expect(JSON.stringify(s)).toBe(before);
      if (moved) continue;
      const move = game.bot(s, seat, STYLES[(seat + moves) % STYLES.length]!);
      if (!move) continue;
      // The computer player only does what its view offers.
      if (move.type === "shot") expect(v.shoot && move.body === v.shoot.body && move.power >= v.shoot.minPower && move.power <= v.shoot.maxPower, `${game.id}: the bot's shot isn't one the view offers`).toBeTruthy();
      else expect(v.choices?.options.some((o) => JSON.stringify(o.move) === JSON.stringify(move))).toBe(true);
      s = game.apply(s, seat, move);
      moved = true;
      moves++;
    }
    if (!moved) throw new Error(`nobody can move in ${game.id} (phase ${game.summary(s).phase})`);
    if (moves > limit) throw new Error(`${game.id} went on too long`);
  }
  return { state: s, moves };
}

describe("the table-sports kit's helpers", () => {
  it("aims in the physics core's whole hundredths of a degree: 0 along +x, 9000 down the screen", () => {
    const o = { x: 100, y: 100 };
    expect([angleTo(o, { x: 200, y: 100 }), angleTo(o, { x: 100, y: 200 }), angleTo(o, { x: 0, y: 100 }), angleTo(o, { x: 100, y: 0 }), angleTo(o, { x: 200, y: 0 })]).toEqual([0, 9000, 18000, 27000, 31500]);
    for (let i = 0; i < 200; i++) {
      const a = angleTo(o, { x: 100 + Math.cos(i) * 50, y: 100 + Math.sin(i * 1.7) * 50 });
      expect(Number.isInteger(a) && a >= 0 && a < 36000).toBe(true);
    }
  });

  it("lists a spread of the shots a view offers, and its buttons", () => {
    const game = SPORT_GAMES[0]!;
    const v = game.view(game.newGame(game.presets[0], 1, 3), 0);
    const offered = sportMovesOffered(v);
    expect(offered.length).toBeGreaterThan(10);
    expect(offered.every((m) => m.type === "shot" && m.body === v.shoot!.body)).toBe(true);
    expect(sportMovesOffered({ ...v, shoot: null, choices: { prompt: "", options: [{ label: "Next hole", move: { type: "next" } }] } })).toEqual([{ type: "next" }]);
  });

  it("compares a stepped world with a stored rest exactly", () => {
    const game = SPORT_GAMES[0]!;
    const v = game.view(game.newGame(game.presets[0], 1, 3), 0);
    const rest = restOf(v.table.world);
    expect(sameRest(v.table.world, rest)).toBe(true);
    expect(sameRest(v.table.world, [{ ...rest[0]!, x: rest[0]!.x + 1 }])).toBe(false);
    expect(sameRest(v.table.world, [{ ...rest[0]!, pocketed: "cup" }])).toBe(false);
    expect(sameRest(v.table.world, [])).toBe(false);
  });
});

for (const game of SPORT_GAMES) {
  describe(game.id, () => {
    it("is a table sport with valid presets that describe themselves", () => {
      expect(isSportGame(game.id)).toBe(true);
      expect(new Set(game.presets.map((p) => p.id)).size).toBe(game.presets.length);
      for (const p of game.presets) {
        expect(game.validate(game.normalize(p))).toEqual([]);
        expect(game.normalize(p)).toEqual(p);
        expect(game.describe(p).length).toBeGreaterThan(1);
        // A table's rules name is cut at 30 characters on the server: say it in fewer.
        expect(p.name.length).toBeLessThanOrEqual(30);
      }
      // Rules from anywhere come out as rules.
      for (const junk of [null, 7, "x", {}, { id: "nope", holes: "lots", limit: -3, order: 5 }]) expect(game.validate(game.normalize(junk))).toEqual([]);
    });

    const sizes = [...new Set([game.seats.min, game.seats.default, game.seats.max])];
    for (const seats of sizes) {
      it(`bots play whole games with ${seats} player${seats === 1 ? "" : "s"}, every preset`, () => {
        for (const [i, preset] of game.presets.entries()) {
          const { state } = playOut(game, preset, seats, 7 + i * 35 + seats);
          const summary = game.summary(state);
          expect(summary.over).toBe(true);
          expect(summary.winners!.length).toBeGreaterThan(0);
          expect([...summary.order!].sort()).toEqual(Array.from({ length: seats }, (_, s) => s));
          for (let seat = 0; seat < seats; seat++) {
            const v = game.view(state, seat);
            checkSportView(v, seat);
            expect(v.over!.winners).toEqual(summary.winners);
            // Nothing left to do on a finished table.
            expect(sportMovesOffered(v)).toEqual([]);
          }
        }
      }, 120_000);
    }

    it("plays the same game from the same seed and the same dice", () => {
      for (const preset of game.presets.slice(0, 2)) {
        const a = playOut(game, { ...preset, holes: 2 }, game.seats.default, 99);
        vi.restoreAllMocks();
        const b = playOut(game, { ...preset, holes: 2 }, game.seats.default, 99);
        expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
        expect(a.moves).toBe(b.moves);
      }
      const a = game.newGame(game.presets[0], game.seats.max, 5);
      const b = game.newGame(game.presets[0], game.seats.max, 5);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (let seat = 0; seat < game.seats.max; seat++) expect(game.view(a, seat)).toEqual(game.view(b, seat));
    }, 60_000);

    it("says the same things to every seat, and offers a shot only to a seat that may shoot", () => {
      for (const preset of game.presets) {
        const s = game.newGame(preset, game.seats.max, 5);
        const views = Array.from({ length: game.seats.max }, (_, seat) => game.view(s, seat));
        for (const v of views) {
          expect(v.game).toBe(game.id);
          expect(v.seats).toBe(game.seats.max);
          expect([v.turn, v.phase, v.scores, v.over, v.card]).toEqual([views[0]!.turn, views[0]!.phase, views[0]!.scores, views[0]!.over, views[0]!.card]);
        }
        const turn = views[0]!.turn;
        // In turn, one seat is offered the shot. With no turns, everyone still playing is.
        if (turn !== null) expect(views.filter((v) => v.shoot).map((v) => v.me)).toEqual([turn]);
        else expect(views.every((v) => v.shoot)).toBe(true);
      }
    });

    it("refuses bad shots and moves out of turn, and leaves the state alone", () => {
      const s = game.newGame(game.presets[0], game.seats.max, 5);
      const before = JSON.stringify(s);
      const mover = game.view(s, 0).turn ?? 0;
      const shoot = game.view(s, mover).shoot!;
      const good = { type: "shot", body: shoot.body, angle: 27000, power: 400 };
      const idle = Array.from({ length: game.seats.max }, (_, i) => i).find((seat) => !game.view(s, seat).shoot);
      if (idle !== undefined) expect(() => game.apply(s, idle, { ...good, body: game.view(s, idle).table.world.bodies[0]?.id ?? good.body })).toThrow(GameError);
      const junk = [
        { type: "nonsense" },
        {},
        null,
        { type: "shot" },
        { ...good, body: "someone-else" },
        { ...good, angle: 36000 },
        { ...good, angle: -1 },
        { ...good, angle: 12.5 },
        { ...good, angle: "90" },
        { ...good, power: shoot.maxPower + 1 },
        { ...good, power: shoot.minPower - 1 },
        { ...good, power: 300.5 },
        { ...good, power: NaN },
        { type: "next" },
      ];
      for (const move of junk) expect(() => game.apply(s, mover, move), JSON.stringify(move)).toThrow(GameError);
      expect(() => game.apply(s, 99, good)).toThrow(GameError);
      expect(JSON.stringify(s)).toBe(before);
      game.apply(s, mover, good);
      expect(JSON.stringify(s)).toBe(before);
    });
  });
}
