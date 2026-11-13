import { cardPower, effectiveSuit, isTrump } from "./cards.js";
import { passingSeats, type Action, type GameState } from "./game.js";
import { partnerOf, seatsOf, teamOf } from "./scoring.js";
import { legalPlays, trickWinner } from "./tricks.js";
import type { Bid, Card, RulePreset, Seat, Suit } from "./types.js";

/** Single number ordering for any card: all trump above all non-trump. */
const strength = (c: Card, p: RulePreset) => (isTrump(c, p) ? 100 : 0) + cardPower(c, p);
const lowest = (cards: Card[], p: RulePreset) => [...cards].sort((a, b) => strength(a, p) - strength(b, p))[0]!;
const highest = (cards: Card[], p: RulePreset) => [...cards].sort((a, b) => strength(b, p) - strength(a, p))[0]!;

/** Rough count of tricks a hand should take. Simple, readable, good enough to fill a seat. */
export function estimateTricks(hand: readonly Card[], p: RulePreset): number {
  const bySuit = new Map<Suit, Card[]>();
  for (const c of hand) {
    const s = effectiveSuit(c, p);
    bySuit.set(s, [...(bySuit.get(s) ?? []), c]);
  }
  let tricks = 0;
  const trump = bySuit.get("spades") ?? [];
  for (const [suit, cards] of bySuit) {
    if (suit === "spades") continue;
    for (const c of cards) {
      const power = cardPower(c, p);
      if (power === 14) tricks += cards.length <= 5 ? 1 : 0.6;
      else if (power === 13 && cards.length >= 2 && cards.length <= 4) tricks += 0.6;
    }
  }
  for (const c of trump) if (cardPower(c, p) >= 13) tricks += 1;
  if (trump.length > 3) tricks += (trump.length - 3) * 0.8;
  // Short side suits let small trump ruff.
  const smallTrump = trump.filter((c) => cardPower(c, p) < 13).length;
  for (const suit of ["hearts", "diamonds", "clubs"] as Suit[]) {
    const n = bySuit.get(suit)?.length ?? 0;
    if (n <= 1 && smallTrump > 1) tricks += n === 0 ? 1 : 0.5;
  }
  return tricks;
}

export function chooseBid(s: GameState, seat: Seat): Bid {
  const p = s.preset;
  const hand = s.hands[seat]!;
  const estimate = estimateTricks(hand, p);
  const partnerBid = s.bids[partnerOf(seat)];
  const partnerIsNil = partnerBid?.kind === "nil" || partnerBid?.kind === "blind-nil";

  const highCards = hand.filter((c) => cardPower(c, p) >= 12 || (isTrump(c, p) && cardPower(c, p) >= 10));
  if (p.nil.enabled && !partnerIsNil && estimate < 1 && highCards.length === 0) return { kind: "nil" };

  let count = Math.max(1, Math.min(13, Math.round(estimate)));
  if (partnerIsNil) count = Math.min(13, count + 1); // cover for a nil partner
  if (p.minTeamBid !== null && partnerBid?.kind === "tricks" && partnerBid.count + count < p.minTeamBid)
    count = p.minTeamBid - partnerBid.count;
  return { kind: "tricks", count };
}

export function chooseCard(s: GameState, seat: Seat): Card {
  const p = s.preset;
  const legal = legalPlays(s.hands[seat]!, s.trick, s.spadesBroken, p);
  if (legal.length === 1) return legal[0]!;

  const myBid = s.bids[seat]!;
  const partner = partnerOf(seat);
  const partnerBid = s.bids[partner]!;
  const isNil = (b: Bid) => b.kind !== "tricks";
  const wins = (c: Card) => trickWinner([...s.trick, { seat, card: c }], p) === seat;

  // Going nil: never win if it can be helped; shed the highest card that still loses.
  if (isNil(myBid)) {
    const losers = legal.filter((c) => !wins(c));
    return losers.length > 0 ? highest(losers, p) : lowest(legal, p);
  }

  // Have we already made our team's bid? Then avoid bags.
  const [a, b] = seatsOf(teamOf(seat));
  const teamBid = [a, b].reduce<number>((n, x) => {
    const bid = s.bids[x]!;
    return n + (bid.kind === "tricks" ? bid.count : 0);
  }, 0);
  const teamTricks = s.tricksWon[a]! + s.tricksWon[b]!;
  const covering = isNil(partnerBid) && s.tricksWon[partner] === 0;
  const avoidBags = teamTricks >= teamBid && !covering;

  if (s.trick.length === 0) {
    if (avoidBags) return lowest(legal, p);
    const side = legal.filter((c) => !isTrump(c, p));
    const sideAce = side.find((c) => cardPower(c, p) === 14);
    return sideAce ?? lowest(side.length > 0 ? side : legal, p);
  }

  const currentWinner = trickWinner(s.trick, p);
  const partnerWinning = currentWinner === partner;
  const winners = legal.filter(wins);

  if (covering && partnerWinning) {
    // Take it away from the nil partner if we can.
    return winners.length > 0 ? highest(winners, p) : lowest(legal, p);
  }
  if (avoidBags || partnerWinning || winners.length === 0) {
    const losers = legal.filter((c) => !wins(c));
    return lowest(losers.length > 0 ? losers : legal, p);
  }
  return lowest(winners, p);
}

export function choosePass(s: GameState, seat: Seat): Card[] {
  const n = s.preset.blindNil.passCards;
  const hand = [...s.hands[seat]!].sort((x, y) => strength(y, s.preset) - strength(x, s.preset));
  // The blind nil bidder hands off their biggest cards; the partner sends back small ones.
  return s.bids[seat]!.kind === "blind-nil" ? hand.slice(0, n) : hand.slice(-n);
}

/** The next action a bot in `seat` would take, or null if it isn't the bot's move. */
export function botAction(s: GameState, seat: Seat): Action | null {
  if (s.phase === "bidding" && s.turn === seat) return { type: "bid", seat, bid: chooseBid(s, seat) };
  if (s.phase === "passing" && passingSeats(s).includes(seat) && !s.passes[seat])
    return { type: "pass", seat, cards: choosePass(s, seat) };
  if (s.phase === "playing" && s.turn === seat) return { type: "play", seat, card: chooseCard(s, seat) };
  return null;
}
