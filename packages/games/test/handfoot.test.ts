import { describe, expect, it } from "vitest";
import { classicHandFoot, easyHandFoot, handFoot, hfValue, longHandFoot, meldPlanHF, newHandFoot, takePlanHF, type HandFootState, type KCard } from "../src/index.js";

let n = 0;
const card = (id: string): KCard => {
  if (id === "JK") return { kind: "joker", size: "big", id: `JK#${n++}` } as KCard;
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id: `${id}#${n++}` } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
const ids = (s: HandFootState, seat: number, want: string) => want.split(" ").map((w) => s.hands[seat]!.find((c) => c.id.startsWith(w + "#") && true)!.id);
const book = (rank: number, ids: string) => ({ rank, cards: cards(ids) });

function table(over: Partial<HandFootState> = {}): HandFootState {
  const s = newHandFoot({ ...classicHandFoot, minimums: false }, 4, 3);
  return { ...s, turn: 0, phase: "meld", hands: [cards("9♠ 9♥ 9♦ 4♣"), cards("5♠"), cards("6♠"), cards("7♠")], feet: [cards("K♠ K♥"), cards(""), cards(""), cards("")], inFoot: [false, false, false, false], melds: [[], []], opened: [true, true], laid: [], tookBack: false, pile: cards("8♦"), red3s: [0, 0], ...over };
}

describe("Hand and Foot", () => {
  it("deals each player a hand and a foot of eleven from five decks", () => {
    const s = newHandFoot(classicHandFoot, 4, 5);
    expect(s.feet.map((f) => f.length)).toEqual([11, 11, 11, 11]);
    const all = [...s.hands.flat(), ...s.feet.flat(), ...s.stock, ...s.pile];
    expect(all.length + s.red3s[0] + s.red3s[1]).toBe(270);
  });

  it("counts jokers 50, twos and aces 20, eights to kings 10, the rest 5", () => {
    expect(cards("JK 2♠ A♥ K♦ 8♣ 7♠ 4♦").map(hfValue)).toEqual([50, 20, 20, 10, 10, 5, 5]);
  });

  it("a meld never has more wild cards than natural ones, nor more than seven cards", () => {
    const s = table({ hands: [cards("9♠ 9♥ 2♦ JK 2♣ 4♣"), [], [], []] });
    expect(meldPlanHF(s, 0, ids(s, 0, "9♠ 9♥ 2♦"))).toHaveProperty("groups");
    expect(meldPlanHF(s, 0, ids(s, 0, "9♠ 9♥ 2♦ JK 2♣"))).toEqual({ error: expect.stringContaining("more wild cards than natural") });
    const full = table({ melds: [[book(9, "9♠ 9♥ 9♦ 9♣ 9♠ 9♥")], []], hands: [cards("9♦ 9♣ 4♣"), [], [], []] });
    expect(meldPlanHF(full, 0, ids(full, 0, "9♦ 9♣"))).toEqual({ error: expect.stringContaining("seven cards") });
  });

  it("seven cards close a book; closed books take no more", () => {
    let s = table({ melds: [[book(9, "9♠ 9♥ 9♦ 9♣ 9♠ 9♥")], []], hands: [cards("9♦ 9♣ 4♣ 5♣"), [], [], []] });
    s = handFoot.apply(s, 0, { type: "meld", cards: ids(s, 0, "9♦") });
    expect(s.melds[0][0]!.cards).toHaveLength(7);
    expect(s.narration).toContain("clean book");
    // A closed book takes no more: a lone 9 would have to start a new meld (two naturals at least).
    expect(meldPlanHF(s, 0, ids(s, 0, "9♣"))).toEqual({ error: expect.stringContaining("two natural") });
  });

  it("playing out your hand picks up your foot", () => {
    let s = table({ hands: [cards("9♠ 9♥ 9♦ 4♣"), cards("5♠"), cards("6♠"), cards("7♠")] });
    s = handFoot.apply(s, 0, { type: "meld", cards: ids(s, 0, "9♠ 9♥ 9♦") });
    s = handFoot.apply(s, 0, { type: "discard", cards: ids(s, 0, "4♣") });
    expect(s.inFoot[0]).toBe(true);
    expect(s.hands[0]!.map((c) => c.id.split("#")[0])).toEqual(["K♠", "K♥"]);
  });

  it("you can only go out from your foot once your side has its books", () => {
    const books1 = [book(9, "9♠ 9♥ 9♦ 9♣ 9♠ 9♥ 9♦"), book(10, "10♠ 10♥ 10♦ 10♣ 2♠ 2♥ JK")];
    const short = table({ inFoot: [true, false, false, false], feet: [[], [], [], []], hands: [cards("4♣"), cards("5♠"), cards("6♠"), cards("7♠")], melds: [[books1[0]!], []] });
    expect(() => handFoot.apply(short, 0, { type: "discard", cards: ids(short, 0, "4♣") })).toThrow("1 clean and 1 dirty");
    const ready = { ...short, melds: [books1, []] as HandFootState["melds"] };
    const done = handFoot.apply(ready, 0, { type: "discard", cards: ids(ready, 0, "4♣") });
    expect(done.phase).toBe("scored");
    expect(done.lastHand!.rows["Clean books"]).toEqual([500, 0]);
    expect(done.lastHand!.rows["Dirty books"]).toEqual([300, 0]);
    expect(done.lastHand!.rows["Going out"]).toEqual([100, 0]);
    // Seat 2 (partner) holds the 6♠: −5. The others: 5♠ and 7♠.
    expect(done.lastHand!.rows["Left in hand and foot"]).toEqual([-5, -10]);
    const two = { ...ready, rules: longHandFoot };
    expect(() => handFoot.apply(two, 0, { type: "discard", cards: ids(two, 0, "4♣") })).toThrow("2 clean and 2 dirty");
  });

  it("taking the pile needs two naturals of its top card", () => {
    const s = table({ phase: "draw", hands: [cards("8♠ 8♥ 4♣"), [], [], []], pile: cards("5♦ 6♦ 8♦") });
    expect(takePlanHF(s, 0)).toHaveProperty("group");
    const t = handFoot.apply(s, 0, { type: "take" });
    expect(t.melds[0][0]!.cards).toHaveLength(3);
    expect(t.hands[0]!.map((c) => c.id.split("#")[0]).sort()).toEqual(["4♣", "5♦", "6♦"]);
    expect(takePlanHF(table({ phase: "draw", hands: [cards("8♠ 4♣"), [], [], []] }), 0)).toEqual({ error: expect.stringContaining("two 8s") });
  });

  it("round minimums: 50 the first round; melds short of it can be taken back", () => {
    let s = { ...table({ opened: [false, false], hands: [cards("4♠ 4♥ 4♦ 9♣ 5♣"), [], [], []] }), rules: classicHandFoot };
    s = handFoot.apply(s, 0, { type: "meld", cards: ids(s, 0, "4♠ 4♥ 4♦") });
    expect(() => handFoot.apply(s, 0, { type: "discard", cards: ids(s, 0, "9♣") })).toThrow("need 50");
    s = handFoot.apply(s, 0, { type: "takeback" });
    expect(s.hands[0]).toHaveLength(5);
    expect(easyHandFoot.minimums).toBe(false);
  });
});
