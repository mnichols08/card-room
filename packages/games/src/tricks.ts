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
