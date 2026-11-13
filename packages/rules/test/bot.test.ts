import { describe, expect, it } from "vitest";
import { pip } from "../src/cards.js";
import { botAction, chooseCard, estimateTricks } from "../src/bot.js";
import { applyAction, newGame, type GameState } from "../src/game.js";
import { familyTable, classic, derivePreset, jokersAndDeuces } from "../src/presets.js";
import type { Seat } from "../src/types.js";

function botGame(state: GameState, maxSteps = 5000): GameState {
  let s = state;
  for (let i = 0; i < maxSteps && s.phase !== "finished"; i++) {
    const seat = ([0, 1, 2, 3] as Seat[]).find((x) => botAction(s, x));
    s = applyAction(s, botAction(s, seat!)!);
  }
  return s;
}

describe("bots", () => {
  for (const preset of [classic, jokersAndDeuces, familyTable]) {
    it(`four bots finish a whole game legally (${preset.name})`, () => {
      for (const seed of [1, 2, 3]) {
        const s = botGame(newGame(preset, seed));
        expect(s.phase).toBe("finished");
        expect(s.winner).not.toBeNull();
      }
    });
  }

  it("handles the blind nil pass phase", () => {
    const passTwo = derivePreset(familyTable, "p", "Pass 2", {
      blindNil: { ...familyTable.blindNil, passCards: 2 },
    });
    let s = newGame(passTwo, 4);
    s = applyAction(s, { type: "bid", seat: 1, bid: { kind: "blind-nil" } });
    while (s.phase === "bidding") s = applyAction(s, botAction(s, s.turn)!);
    expect(s.phase).toBe("passing");
    s = applyAction(s, botAction(s, 1)!);
    s = applyAction(s, botAction(s, 3)!);
    expect(s.phase).toBe("playing");
  });

  it("values a strong hand above a weak one", () => {
    const strong = [pip("spades", 14), pip("spades", 13), pip("spades", 12), pip("spades", 9), pip("spades", 8), pip("hearts", 14), pip("clubs", 14)];
    const weak = [pip("hearts", 3), pip("hearts", 5), pip("clubs", 4), pip("diamonds", 6), pip("diamonds", 7)];
    expect(estimateTricks(strong, classic)).toBeGreaterThan(5);
    expect(estimateTricks(weak, classic)).toBeLessThan(1);
  });

  it("a nil bot ducks under the winning card", () => {
    let s = newGame(classic, 1);
    s = {
      ...s,
      phase: "playing",
      bids: [{ kind: "tricks", count: 4 }, { kind: "nil" }, { kind: "tricks", count: 4 }, { kind: "tricks", count: 4 }],
      hands: [[], [pip("hearts", 14), pip("hearts", 9), pip("hearts", 3)], [], []],
      trick: [{ seat: 0, card: pip("hearts", 10) }],
      turn: 1,
    };
    expect(chooseCard(s, 1)).toEqual(pip("hearts", 9));
  });
});
