import { describe, expect, it } from "vitest";
import { SUITS, classicHorse, horseRace, newHorseRace, shortHorse, type HorseState, type KCard } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => ids.split(" ").map(card);

describe("Horse Race", () => {
  it("everyone bets, then the race starts", () => {
    let s = newHorseRace(classicHorse, 2, 1);
    expect(() => horseRace.apply(s, 0, { type: "sips", sips: 2 })).toThrow("horse first");
    s = horseRace.apply(s, 0, { type: "horse", suit: "hearts" });
    s = horseRace.apply(s, 0, { type: "sips", sips: 3 });
    expect(s.phase).toBe("bet");
    s = horseRace.apply(s, 1, { type: "horse", suit: "spades" });
    s = horseRace.apply(s, 1, { type: "sips", sips: 2 });
    expect(s.phase).toBe("race");
  });

  it("cards move horses; a turned track card sends one back; first past the finish wins", () => {
    let s = { ...newHorseRace(shortHorse, 2, 1), phase: "race", turn: 0, bets: [{ suit: "hearts", sips: 3 }, { suit: "spades", sips: 2 }], trackCards: cards("5♣ 6♣ 7♣ 8♣ 9♣"), deck: cards("2♥ 2♥ 2♥ 2♥ 2♥ 2♥ 3♦ 3♠ 3♣ 3♥") } as HorseState;
    for (let i = 0; i < 4; i++) s = horseRace.apply(s, 0, { type: "flip" });
    // ♥ ♣ ♠ ♦ each moved once: track card 1 (♣) turns and clubs steps back.
    expect(SUITS.map((x, i) => [x, s.pos[i]])).toEqual(SUITS.map((x) => [x, x === "clubs" ? 0 : 1]));
    expect(s.turned).toBe(1);
    while (s.phase === "race") s = horseRace.apply(s, 0, { type: "flip" });
    expect(s.winner).toBe("hearts");
    expect(s.tally.drank[1]).toBe(2);
    expect(s.tally.give).toEqual([{ from: 0, n: 6, why: expect.any(String) }]);
    s = horseRace.apply(s, 0, { type: "give", to: 1 });
    expect(s.phase).toBe("finished");
    expect(horseRace.view(s, 1).over?.winners).toEqual([0]);
  });
});
