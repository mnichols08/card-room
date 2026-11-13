import { cardId, PERSONAS } from "@spades/rules";
import { describe, expect, it } from "vitest";
import {
  applyPalace,
  canPlayOn,
  classicPalace,
  familyPalace,
  newPalace,
  options,
  PALACE_PRESETS,
  palaceBot,
  palaceThinkingTime,
  reactToPalace,
  normalizePalaceRules,
  validatePalaceRules,
  viewPalace,
  type PalaceAction,
  type PalaceState,
  type PCard,
} from "../src/index.js";

/** The rules these tests were written for: dealt face-up, swap before play, pick up only when stuck. */
const swapping = { ...familyPalace, choose: false, swap: true, pickUpAnytime: false };
const c = (rank: number, suit: PCard["suit"] = "hearts"): PCard => ({ kind: "pip", suit, rank: rank as PCard["rank"] });
const total = (s: PalaceState) => s.deck.length + s.pile.length + s.burned + s.players.reduce((n, p) => n + p.hand.length + p.up.length + p.down.length, 0);

/** A game already playing, with chosen cards. */
function table(rules = swapping, hands: PCard[][], pile: PCard[] = [], deck: PCard[] = []): PalaceState {
  const s = newPalace({ ...rules, swap: false, choose: false }, hands.length, 1);
  s.players = hands.map((hand) => ({ hand, up: [c(14, "spades")], down: [c(13, "spades")], ready: true, place: null }));
  s.pile = pile;
  s.deck = deck;
  s.turn = 0;
  return s;
}

describe("dealing", () => {
  it("gives each player face-down, face-up and a hand, and uses two decks for six", () => {
    const s = newPalace(swapping, 4, 42);
    for (const p of s.players) expect([p.down.length, p.up.length, p.hand.length]).toEqual([3, 3, 3]);
    expect(s.deck.length).toBe(52 - 36);
    expect(s.phase).toBe("swapping");
    expect(newPalace(swapping, 6, 1).deck.length).toBe(104 - 54);
    expect(() => newPalace(swapping, 7, 1)).toThrow();
  });

  it("swaps, then the lowest ordinary card in hand starts", () => {
    let s = newPalace(swapping, 2, 7);
    const [h, u] = [s.players[0]!.hand[0]!, s.players[0]!.up[0]!];
    s = applyPalace(s, { type: "swap", seat: 0, hand: cardId(h), up: cardId(u) });
    expect(s.players[0]!.up.map(cardId)).toContain(cardId(h));
    s = applyPalace(s, { type: "ready", seat: 0 });
    expect(() => applyPalace(s, { type: "swap", seat: 0, hand: "x", up: "y" })).toThrow();
    s = applyPalace(s, { type: "ready", seat: 1 });
    expect(s.phase).toBe("playing");
    const lowest = (seat: number) => Math.min(...s.players[seat]!.hand.filter((x) => x.rank !== 2 && x.rank !== 10).map((x) => x.rank));
    expect(lowest(s.turn)).toBeLessThanOrEqual(lowest(1 - s.turn));
  });
});

describe("what goes on the pile", () => {
  it("equal or higher, 2 resets, 10 anytime, 7 lower when that rule is on", () => {
    expect(canPlayOn(5, [c(5)], swapping)).toBe(true);
    expect(canPlayOn(4, [c(5)], swapping)).toBe(false);
    expect(canPlayOn(2, [c(14)], swapping)).toBe(true);
    expect(canPlayOn(3, [c(2)], swapping)).toBe(true);
    expect(canPlayOn(10, [c(14)], swapping)).toBe(true);
    expect(canPlayOn(9, [c(7)], swapping)).toBe(true);
    expect(canPlayOn(9, [c(7)], classicPalace)).toBe(false);
    expect(canPlayOn(6, [c(7)], classicPalace)).toBe(true);
    expect(canPlayOn(2, [c(14)], { ...swapping, twoResets: false })).toBe(false);
  });
});

describe("a turn", () => {
  it("plays a set, draws back up, and passes", () => {
    const s = table(swapping, [[c(5), c(5, "spades"), c(9)], [c(3), c(4), c(6)]], [c(4)], [c(8), c(12)]);
    const after = applyPalace(s, { type: "play", seat: 0, cards: ["5♥", "5♠"] });
    expect(after.pile.map(cardId)).toEqual(["4♥", "5♥", "5♠"]);
    expect(after.players[0]!.hand.map((x) => x.rank)).toEqual([8, 9, 12]);
    expect(after.turn).toBe(1);
    expect(() => applyPalace(after, { type: "play", seat: 1, cards: ["3♥"] })).toThrow(/lower/);
    expect(() => applyPalace(s, { type: "play", seat: 0, cards: ["5♥", "9♥"] })).toThrow(/one rank/);
    expect(() => applyPalace(s, { type: "play", seat: 1, cards: ["6♥"] })).toThrow(/turn/);
  });

  it("10 burns and you go again; four of a kind burns too", () => {
    let s = table(swapping, [[c(10), c(3)], [c(4)]], [c(13), c(14)]);
    s = applyPalace(s, { type: "play", seat: 0, cards: ["10♥"] });
    expect(s.pile).toEqual([]);
    expect(s.burned).toBe(3);
    expect(s.last).toMatchObject({ burned: true, again: true });
    expect(s.turn).toBe(0);

    s = table(swapping, [[c(6, "clubs"), c(6, "diamonds"), c(3)], [c(4)]], [c(6, "spades"), c(6, "hearts")]);
    s = applyPalace(s, { type: "play", seat: 0, cards: ["6♣", "6♦"] });
    expect(s.pile).toEqual([]);
    expect(s.turn).toBe(0);
    s = table({ ...swapping, fourBurns: false }, [[c(6, "clubs"), c(6, "diamonds"), c(3)], [c(4)]], [c(6, "spades"), c(6, "hearts")]);
    expect(applyPalace(s, { type: "play", seat: 0, cards: ["6♣", "6♦"] }).pile).toHaveLength(4);
  });

  it("can't play: pick up the pile (and only then, unless the house allows it)", () => {
    const s = table(swapping, [[c(3), c(4)], [c(5)]], [c(9), c(12)]);
    expect(options(s, 0)).toEqual([]);
    const after = applyPalace(s, { type: "pickup", seat: 0 });
    expect(after.players[0]!.hand.map((x) => x.rank)).toEqual([3, 4, 9, 12]);
    expect(after.pile).toEqual([]);
    expect(after.turn).toBe(1);
    const could = table(swapping, [[c(13)], [c(5)]], [c(9)]);
    expect(() => applyPalace(could, { type: "pickup", seat: 0 })).toThrow(/can play/);
    expect(applyPalace(table({ ...swapping, pickUpAnytime: true }, [[c(13)], [c(5)]], [c(9)]), { type: "pickup", seat: 0 }).players[0]!.hand).toHaveLength(2);
  });

  it("then face-up cards, then blind flips; a missed flip picks up the pile", () => {
    let s = table(swapping, [[], [c(3)]], [c(8)]);
    s.players[0]!.up = [c(9), c(4)];
    s.players[0]!.down = [c(3, "clubs"), c(12, "clubs")];
    expect(() => applyPalace(s, { type: "flip", seat: 0, index: 0 })).toThrow(/first/);
    s = applyPalace(s, { type: "play", seat: 0, cards: ["9♥"] });
    expect(s.players[0]!.up.map(cardId)).toEqual(["4♥"]);
    s.turn = 0;
    s.players[0]!.up = [];
    s.pile = [c(8)];
    const miss = applyPalace(s, { type: "flip", seat: 0, index: 0 });
    expect(miss.players[0]!.hand.map(cardId).sort()).toEqual(["3♣", "8♥"].sort());
    expect(miss.last).toMatchObject({ kind: "flip", pickedUp: 2 });
    const hit = applyPalace(s, { type: "flip", seat: 0, index: 1 });
    expect(hit.pile.map(cardId)).toEqual(["8♥", "Q♣"]);
  });

  it("first out wins and the last one holding cards loses", () => {
    let s = table(swapping, [[c(9)], [c(3)], [c(4)]], []);
    for (const p of s.players) {
      p.up = [];
      p.down = [];
    }
    s = applyPalace(s, { type: "play", seat: 0, cards: ["9♥"] });
    expect(s.finished).toEqual([0]);
    expect(s.turn).toBe(1);
    s = applyPalace(s, { type: "pickup", seat: 1 });
    expect(s.players[1]!.hand.map((x) => x.rank)).toEqual([3, 9]);
    s = applyPalace(s, { type: "play", seat: 2, cards: ["4♥"] });
    expect(s.phase).toBe("finished");
    expect(s.finished).toEqual([0, 2]);
    expect(s.loser).toBe(1);
    expect(s.players.map((p) => p.place)).toEqual([1, 3, 2]);
  });
});

describe("choosing your face-up cards (the family deal)", () => {
  it("deals the face-up cards into the hand; each player picks which to lay down", () => {
    let s = newPalace(familyPalace, 3, 11);
    for (const p of s.players) expect([p.down.length, p.up.length, p.hand.length]).toEqual([3, 0, 6]);
    expect(s.deck.length).toBe(52 - 27);
    const pick = s.players[0]!.hand.slice(3).map(cardId);
    expect(() => applyPalace(s, { type: "ready", seat: 0 })).toThrow(/Pick 3/);
    expect(() => applyPalace(s, { type: "choose", seat: 0, cards: pick.slice(0, 2) })).toThrow(/Pick 3/);
    expect(() => applyPalace(s, { type: "swap", seat: 0, hand: pick[0]!, up: pick[1]! })).toThrow();
    expect(viewPalace(s, 0).can?.choose).toBe(3);
    s = applyPalace(s, { type: "choose", seat: 0, cards: pick });
    expect(s.players[0]!.up.map(cardId).sort()).toEqual([...pick].sort());
    expect(s.players[0]!.hand).toHaveLength(3);
    expect(s.players[0]!.ready).toBe(true);
    expect(viewPalace(s, 0).can?.choose).toBe(0);
    expect(() => applyPalace(s, { type: "choose", seat: 0, cards: pick })).toThrow();
    for (const seat of [1, 2]) s = applyPalace(s, palaceBot(s, seat)!);
    expect(s.phase).toBe("playing");
    for (const p of s.players) expect([p.up.length, p.hand.length]).toEqual([3, 3]);
  });

  it("bots lay their strongest cards face-up", () => {
    const s = newPalace(familyPalace, 2, 4);
    s.players[1]!.hand = [c(3), c(10), c(14), c(5), c(2, "clubs"), c(8)];
    const action = palaceBot(s, 1)!;
    expect(action.type).toBe("choose");
    expect((action as { cards: string[] }).cards.sort()).toEqual(["10♥", "2♣", "A♥"].sort());
  });

  it("rules saved before choosing existed keep their old deal", () => {
    expect(normalizePalaceRules({ id: "house-abc", name: "Ours" } as never)).toMatchObject({ choose: false, swap: true, pickUpAnytime: false });
    expect(normalizePalaceRules({ id: "family-palace", name: "Family Palace" } as never)).toMatchObject({ choose: true, pickUpAnytime: true });
  });
});

describe("picking up on purpose", () => {
  it("a good player takes a short pile with a prize in it rather than spend a strong card", () => {
    // Pile: 4, A. To beat it they'd have to spend a 2 or a 10; the pile has an ace worth having.
    const s = table(familyPalace, [[c(2), c(10), c(3)], [c(4)]], [c(4, "clubs"), c(14, "clubs")], [c(6), c(7)]);
    expect(palaceBot(s, 0, { skill: 1 })).toEqual({ type: "pickup", seat: 0 });
    // A careless player, or one who can beat it cheaply, or with no deck left, just plays.
    expect(palaceBot(s, 0, { skill: 0.3 })?.type).not.toBe("pickup");
    const cheap = table(familyPalace, [[c(2), c(5), c(3)], [c(4)]], [c(4, "clubs"), c(2, "clubs")], [c(6)]);
    expect(palaceBot(cheap, 0, { skill: 1 })).toMatchObject({ type: "play", cards: ["3♥"] });
    const noDeck = table(familyPalace, [[c(2), c(10), c(3)], [c(4)]], [c(4, "clubs"), c(14, "clubs")], []);
    expect(palaceBot(noDeck, 0, { skill: 1 })?.type).toBe("play");
    // Without the house rule, it isn't allowed.
    expect(() => applyPalace(table(swapping, [[c(13)], [c(5)]], [c(9)]), { type: "pickup", seat: 0 })).toThrow(/can play/);
    expect(applyPalace(table(familyPalace, [[c(13)], [c(5)]], [c(9)]), { type: "pickup", seat: 0 }).players[0]!.hand).toHaveLength(2);
  });
});

describe("views", () => {
  it("show your own hand and everyone's face-up cards, never anyone's hand or face-down cards", () => {
    const s = newPalace(swapping, 3, 9);
    const v = viewPalace(s, 1);
    expect(v.hand).toEqual(s.players[1]!.hand);
    expect(v.players[0]).toEqual({ up: s.players[0]!.up, down: 3, hand: 3, ready: false, place: null });
    const text = JSON.stringify(viewPalace(s, null));
    for (const p of s.players) for (const card of [...p.hand, ...p.down]) expect(text).not.toContain(JSON.stringify(card));
  });
});

describe("the presets", () => {
  it("are valid and bad ones say why", () => {
    for (const p of PALACE_PRESETS) expect(validatePalaceRules(p)).toEqual([]);
    expect(validatePalaceRules({ ...swapping, name: "", handSize: 9 })).toHaveLength(2);
  });
});

describe("bots", () => {
  const styles = Object.values(PERSONAS).map((p) => p.style);
  const play = (rules = swapping, seats = 4, seed = 1) => {
    let s = newPalace(rules, seats, seed);
    const cards = total(s);
    let steps = 0;
    while (s.phase !== "finished") {
      const actor = s.phase === "swapping" ? s.players.findIndex((p) => !p.ready) : s.turn;
      const action = palaceBot(s, actor, styles[(actor + seed) % styles.length]) as PalaceAction;
      expect(action, `seat ${actor} has a move`).not.toBeNull();
      s = applyPalace(s, action);
      expect(total(s)).toBe(cards);
      if (++steps > 5000) throw new Error("game didn't end");
    }
    return { s, steps };
  };

  it("finish every game, for every preset and table size, without losing a card", () => {
    let games = 0;
    for (const rules of PALACE_PRESETS) {
      for (let seats = 2; seats <= 6; seats++) {
        for (let seed = 1; seed <= 12; seed++) {
          const { s } = play(rules, seats, seed);
          expect(s.finished).toHaveLength(seats - 1);
          expect(s.loser).not.toBeNull();
          expect(new Set([...s.finished, s.loser]).size).toBe(seats);
          games++;
        }
      }
    }
    expect(games).toBe(180);
  });

  it("put strong cards face-up before play, and save 10s for a big pile", () => {
    let s = newPalace(swapping, 2, 3);
    s.players[0]!.hand = [c(10), c(14), c(3)];
    s.players[0]!.up = [c(4), c(5), c(6)];
    while (!s.players[0]!.ready) s = applyPalace(s, palaceBot(s, 0)!);
    expect(s.players[0]!.up.map((x) => x.rank).sort((a, b) => a - b)).toEqual([6, 10, 14]);

    const small = table(swapping, [[c(10), c(9)], [c(3)]], [c(5)]);
    expect(palaceBot(small, 0)).toMatchObject({ cards: ["9♥"] });
    const big = table(swapping, [[c(10), c(13)], [c(3)]], [c(5), c(6), c(7), c(8), c(9), c(11), c(12), c(12, "clubs")]);
    expect(palaceBot(big, 0)).toMatchObject({ cards: ["10♥"] });
  });

  it("finish a four of a kind when they can", () => {
    const s = table(swapping, [[c(8, "clubs"), c(9)], [c(3)]], [c(8, "spades"), c(8, "hearts"), c(8, "diamonds")]);
    expect(palaceBot(s, 0)).toEqual({ type: "play", seat: 0, cards: ["8♣"] });
  });

  it("think for a humanlike moment and talk about burns", () => {
    const s = newPalace(swapping, 3, 5);
    const t = palaceThinkingTime(s, 0, "Hank");
    expect(t).toBeGreaterThan(300);
    expect(t).toBeLessThan(6000);
    const before = table(swapping, [[c(10), c(3)], [c(4)]], [c(13), c(14)]);
    const after = applyPalace(before, { type: "play", seat: 0, cards: ["10♥"] });
    const said = reactToPalace(before, after, { bots: [{ seat: 0, name: "Skeeter" }] }, () => 0);
    expect(said[0]).toMatchObject({ seat: 0 });
    expect(said[0]!.text).toMatch(/🔥/);
  });
});

describe("Grammi's house rules: 2s and face-up cards", () => {
  const c = (id: string) => {
    const rank = ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[id.slice(0, -1)] ?? Number(id.slice(0, -1));
    const suit = ({ "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" } as Record<string, string>)[id.slice(-1)]!;
    return { kind: "pip", rank, suit } as const;
  };
  const playingWith = (rules: typeof familyPalace, p0: { hand: string[]; up: string[] }) => {
    const s = newPalace(rules, 2, 1, 0);
    s.phase = "playing";
    s.turn = 0;
    s.deck = [];
    s.pile = [c("9♦") as never];
    s.players[0]!.hand = p0.hand.map(c) as never;
    s.players[0]!.up = p0.up.map(c) as never;
    s.players[0]!.down = [c("3♣") as never];
    s.players[1]!.hand = [c("4♠") as never];
    return s;
  };

  it("after a 2 you play again, on top of it", () => {
    let s = playingWith(familyPalace, { hand: ["2♥", "5♠"], up: [] });
    s = applyPalace(s, { type: "play", seat: 0, cards: ["2♥"] });
    expect(s.turn).toBe(0);
    expect(s.last!.again).toBe(true);
    s = applyPalace(s, { type: "play", seat: 0, cards: ["5♠"] });
    expect(s.turn).toBe(1);
    // Without the house rule, a 2 passes the turn like any card.
    let t = playingWith({ ...familyPalace, twoAgain: false }, { hand: ["2♥", "5♠"], up: [] });
    t = applyPalace(t, { type: "play", seat: 0, cards: ["2♥"] });
    expect(t.turn).toBe(1);
  });

  it("face-up cards go down one at a time, and the bots know it", () => {
    const s = playingWith(familyPalace, { hand: [], up: ["J♠", "J♥", "J♦"] });
    expect(() => applyPalace(s, { type: "play", seat: 0, cards: ["J♠", "J♥"] })).toThrow("one at a time");
    expect(applyPalace(s, { type: "play", seat: 0, cards: ["J♠"] }).players[0]!.up).toHaveLength(2);
    const move = palaceBot(s, 0, { skill: 1, sloppy: 0 }) as { type: string; cards: string[] };
    expect(move.cards).toHaveLength(1);
    // From the hand, a set still goes down together.
    const h = playingWith(familyPalace, { hand: ["J♠", "J♥"], up: [] });
    expect(applyPalace(h, { type: "play", seat: 0, cards: ["J♠", "J♥"] }).pile).toHaveLength(3);
  });

  it("rules saved before these settings keep their old meaning; the built-in family rules get the new ones", () => {
    const { twoAgain, upOneAtATime, ...older } = familyPalace;
    void twoAgain;
    void upOneAtATime;
    expect(normalizePalaceRules({ ...older, id: "my-rules" })).toMatchObject({ twoAgain: false, upOneAtATime: false });
    expect(normalizePalaceRules({ ...older })).toMatchObject({ twoAgain: true, upOneAtATime: true });
  });
});
