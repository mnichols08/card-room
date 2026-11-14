// Every game on the kit: computer players finish whole games at every table size, every view is
// consistent with the state, the same seed always deals the same game, and refused moves don't
// change anything.
import { describe, expect, it } from "vitest";
import { GameError, KIT_GAMES, type CardGame, type KitView } from "../src/index.js";

const STYLES = [{}, { skill: 0.3, sloppy: 0.3 }, { skill: 1, sloppy: 0 }];

/** Bots play until it's over; returns the final state and how many moves it took. */
export function playOut(game: CardGame<any, any, any>, rules: unknown, seats: number, seed: number, limit = 20000) {
  let s = game.newGame(game.normalize(rules), seats, seed);
  let moves = 0;
  while (!game.summary(s).over) {
    let moved = false;
    for (let seat = 0; seat < seats; seat++) {
      const move = game.bot(s, seat, STYLES[(seat + moves) % STYLES.length]!);
      if (!move) continue;
      checkView(game.view(s, seat), seat);
      s = game.apply(s, seat, move);
      moved = true;
      moves++;
      break;
    }
    if (!moved) throw new Error(`nobody can move in ${game.id} (phase ${game.summary(s).phase})`);
    if (moves > limit) throw new Error(`${game.id} went on too long`);
  }
  return { state: s, moves };
}

function checkView(v: KitView, seat: number) {
  expect(v.me).toBe(seat);
  const ids = new Set(v.hand.map((c) => c.id));
  expect(ids.size).toBe(v.hand.length);
  for (const id of v.tap?.cards ?? []) expect(ids.has(id)).toBe(true);
  for (const id of v.pick?.cards ?? []) expect(ids.has(id)).toBe(true);
  expect(v.players).toHaveLength(v.seats);
  if (v.handHidden) expect(v.hand).toEqual([]);
  else expect(v.players[seat]!.cards).toBe(v.hand.length);
}

for (const game of KIT_GAMES) {
  describe(game.id, () => {
    it("has valid presets that describe themselves", () => {
      for (const p of game.presets) {
        expect(game.validate(game.normalize(p))).toEqual([]);
        expect(game.describe(p).length).toBeGreaterThan(1);
      }
    });

    const sizes = [...new Set([game.seats.min, game.seats.default, game.seats.max])];
    for (const seats of sizes) {
      it(`bots play whole games with ${seats} players`, () => {
        for (const seed of [1, 7, 42]) {
          for (const preset of game.presets) {
            const { state } = playOut(game, preset, seats, seed);
            const summary = game.summary(state);
            expect(summary.over).toBe(true);
            if (seats > 1) expect(summary.winners!.length).toBeGreaterThan(0);
            expect([...summary.order!].sort()).toEqual(Array.from({ length: seats }, (_, i) => i));
            const v = game.view(state, 0);
            expect(v.over).not.toBeNull();
          }
        }
      });
    }

    it("deals the same game from the same seed", () => {
      const a = game.newGame(game.presets[0], game.seats.default, 99);
      const b = game.newGame(game.presets[0], game.seats.default, 99);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const c = game.newGame(game.presets[0], game.seats.default, 100);
      // Games that hide your cards, or deal only after bets (Blackjack), compare the whole state.
      if (game.view(a, 0).handHidden || !game.view(a, 0).hand.length) expect(JSON.stringify({ ...c, rng: 0, dealer: 0 })).not.toBe(JSON.stringify({ ...a, rng: 0, dealer: 0 }));
      else expect(JSON.stringify(game.view(c, 0).hand)).not.toBe(JSON.stringify(game.view(a, 0).hand));
    });

    it("refuses moves out of turn and leaves the state alone", () => {
      const s = game.newGame(game.presets[0], game.seats.default, 5);
      const before = JSON.stringify(s);
      const idle = Array.from({ length: game.seats.default }, (_, i) => i).find((seat) => !game.bot(s, seat, {}));
      if (idle !== undefined) expect(() => game.apply(s, idle, { type: "play", card: game.view(s, idle).hand[0]?.id ?? "x" })).toThrow(GameError);
      expect(() => game.apply(s, 0, { type: "nonsense" })).toThrow(GameError);
      expect(JSON.stringify(s)).toBe(before);
    });
  });
}
