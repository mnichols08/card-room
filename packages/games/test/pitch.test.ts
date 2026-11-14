import { describe, expect, it } from "vitest";
import { classicPitch, newPitch, pitch, pitchBids, pitchLegal, pitchPoints, setbackPitch, type KCard, type PitchState } from "../src/index.js";

const card = (id: string): KCard => {
  const rank = { J: 11, Q: 12, K: 13, A: 14 }[id.slice(0, -1)] ?? Number(id.slice(0, -1));
  const suit = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" }[id.slice(-1)]!;
  return { kind: "pip", rank, suit, id } as KCard;
};
const cards = (ids: string) => (ids ? ids.split(" ").map(card) : []);
function playing(hands: string[], rules = classicPitch, bidder = 0, bid = 2): PitchState {
  const s = newPitch(rules, hands.length, 1);
  return { ...s, hands: hands.map(cards), phase: "playing", bidder, bids: s.bids.map((_, i) => (i === bidder ? bid : 0)), turn: bidder, trump: null } as PitchState;
}
const play = (s: PitchState, ...ids: string[]) => ids.reduce((st, id) => pitch.apply(st, st.turn, { type: "play", card: id }), s);

describe("Pitch", () => {
  it("deals six each; bids go up from 2 to 4; the dealer is stuck if everyone passes", () => {
    let s = newPitch(classicPitch, 3, 2);
    expect(s.hands.every((h) => h.length === 6)).toBe(true);
    const first = s.turn;
    expect(pitchBids(s, first)).toEqual([0, 2, 3, 4]);
    s = pitch.apply(s, first, { type: "bid", bid: 3 });
    expect(pitchBids(s, s.turn)).toEqual([0, 4]);
    s = pitch.apply(s, s.turn, { type: "bid", bid: 0 });
    s = pitch.apply(s, s.turn, { type: "bid", bid: 0 });
    expect(s.phase).toBe("playing");
    expect(s.bidder).toBe(first);
    expect(s.turn).toBe(first);

    let p = newPitch(classicPitch, 3, 2);
    p = pitch.apply(p, p.turn, { type: "bid", bid: 0 });
    p = pitch.apply(p, p.turn, { type: "bid", bid: 0 });
    expect(p.turn).toBe(p.dealer);
    expect(pitchBids(p, p.dealer)).toEqual([2, 3, 4]);
  });

  it("the first card pitched sets trump; follow suit or trump; trump led must be followed", () => {
    let s = playing(["A♥ 3♠", "5♥ 9♠ K♣", "Q♠ 2♣ 4♥"]);
    s = play(s, "A♥");
    expect(s.trump).toBe("hearts");
    expect(pitchLegal(s, 1).map((c) => c.id)).toEqual(["5♥"]);
    s = play(s, "5♥", "4♥");
    s = { ...s, turn: 1 };
    s = play(s, "9♠");
    expect(pitchLegal(s, 2).map((c) => c.id)).toEqual(["Q♠"]);
    s = { ...playing(["A♥ 3♠", "5♥ 9♠ K♣", "Q♠ 2♣ 4♥"]), trump: "hearts", turn: 1 };
    s = play(s, "9♠");
    expect(pitchLegal(s, 2).map((c) => c.id).sort()).toEqual(["4♥", "Q♠"].sort());
  });

  it("scores High, Low, Jack and Game", () => {
    // Two players, three tricks shown: hearts trump.
    let s = playing(["A♥ 10♣ 3♥", "J♥ 2♣ 2♥"]);
    s = play(s, "A♥", "J♥"); // seat 0 takes A♥ J♥
    s = play(s, "10♣", "2♣"); // seat 0 takes the 10
    s = play(s, "3♥", "2♥"); // seat 0 takes 3♥ 2♥
    const { won } = pitchPoints(s);
    expect(won).toEqual({ high: 0, low: 1, jack: 0, game: 0 });
    expect(s.scores).toEqual([3, 1]);
  });

  it("low to the taker, as a house rule", () => {
    let s = playing(["A♥ 3♥", "J♥ 2♥"], setbackPitch);
    s = play(s, "A♥", "J♥", "3♥", "2♥");
    expect(pitchPoints(s).won.low).toBe(0);
  });

  it("the bidder who falls short is set back", () => {
    let s = playing(["2♠ 3♠", "A♠ K♠"], classicPitch, 0, 3);
    s = play(s, "2♠", "A♠", "K♠", "3♠");
    expect(s.lastHand!.made).toBe(false);
    expect(s.scores[0]).toBe(-3 + 0);
    expect(s.scores[1]).toBe(2); // High and Game; Low went to seat 0, who played it
  });
});
