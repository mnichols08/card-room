// Tricks, for the trick-taking games: who wins one, and what may be played to it.
import type { Suit } from "@spades/rules";
import type { KCard } from "./kit.js";

export interface Play {
  seat: number;
  card: KCard;
}

/**
 * The winning play: the highest trump if any was played, else the highest card of the suit led.
 * `suitOf` says which suit a card counts as (Euchre's left bower is a trump), `power` how high it is.
 */
export function trickWinner(plays: Play[], trump: Suit | null, suitOf: (c: KCard) => Suit, power: (c: KCard) => number): Play {
  const led = suitOf(plays[0]!.card);
  let best = plays[0]!;
  for (const p of plays.slice(1)) {
    const s = suitOf(p.card);
    const b = suitOf(best.card);
    if (trump && s === trump && b !== trump) best = p;
    else if (s === b && power(p.card) > power(best.card)) best = p;
    else if (!trump && s === led && b !== led) best = p;
  }
  return best;
}

/** Cards that follow the suit led, or every card when you have none of it. */
export function following(hand: KCard[], plays: Play[], suitOf: (c: KCard) => Suit): KCard[] {
  if (!plays.length) return hand;
  const led = suitOf(plays[0]!.card);
  const same = hand.filter((c) => suitOf(c) === led);
  return same.length ? same : hand;
}

/** Would this card win the trick if played now? */
export function wouldWin(card: KCard, seat: number, plays: Play[], trump: Suit | null, suitOf: (c: KCard) => Suit, power: (c: KCard) => number): boolean {
  if (!plays.length) return true;
  return trickWinner([...plays, { seat, card }], trump, suitOf, power).seat === seat;
}

/** For a player who wants this trick: the cheapest card that wins it now, or null. */
export function cheapestWinner(legal: KCard[], seat: number, plays: Play[], trump: Suit | null, suitOf: (c: KCard) => Suit, power: (c: KCard) => number): KCard | null {
  const winners = legal.filter((c) => wouldWin(c, seat, plays, trump, suitOf, power));
  return winners.sort((a, b) => strength(a, trump, suitOf, power) - strength(b, trump, suitOf, power))[0] ?? null;
}

/** For a player who doesn't want it: the strongest card that still loses, else the weakest card. */
export function bestLoser(legal: KCard[], seat: number, plays: Play[], trump: Suit | null, suitOf: (c: KCard) => Suit, power: (c: KCard) => number): KCard {
  const losers = legal.filter((c) => plays.length && !wouldWin(c, seat, plays, trump, suitOf, power));
  if (losers.length) return losers.sort((a, b) => strength(b, trump, suitOf, power) - strength(a, trump, suitOf, power))[0]!;
  return [...legal].sort((a, b) => strength(a, trump, suitOf, power) - strength(b, trump, suitOf, power))[0]!;
}

/** One number for how strong a card is overall: trumps above everything else. */
export const strength = (c: KCard, trump: Suit | null, suitOf: (c: KCard) => Suit, power: (c: KCard) => number) => power(c) + (trump && suitOf(c) === trump ? 100 : 0);
