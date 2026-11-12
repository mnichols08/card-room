import { cardPower, effectiveSuit, isTrump } from "./cards.js";
import type { Card, RulePreset, Seat } from "./types.js";

export interface Play {
  seat: Seat;
  card: Card;
}

/** Cards in `hand` that may be played onto `trick`. */
export function legalPlays(
  hand: readonly Card[],
  trick: readonly Play[],
  spadesBroken: boolean,
  preset: RulePreset,
): Card[] {
  if (trick.length === 0) {
    if (preset.spadesMustBeBroken && !spadesBroken) {
      const nonTrump = hand.filter((c) => !isTrump(c, preset));
      if (nonTrump.length > 0) return nonTrump;
    }
    return [...hand];
  }
  const led = effectiveSuit(trick[0]!.card, preset);
  const following = hand.filter((c) => effectiveSuit(c, preset) === led);
  return following.length > 0 ? following : [...hand];
}

/** Seat that wins a completed (or partial) trick. */
export function trickWinner(trick: readonly Play[], preset: RulePreset): Seat {
  if (trick.length === 0) throw new Error("Empty trick has no winner.");
  const led = effectiveSuit(trick[0]!.card, preset);
  let best = trick[0]!;
  for (const play of trick.slice(1)) {
    const bestTrump = isTrump(best.card, preset);
    const playTrump = isTrump(play.card, preset);
    if (playTrump && !bestTrump) best = play;
    else if (playTrump === bestTrump) {
      const sameSuit = effectiveSuit(play.card, preset) === (bestTrump ? "spades" : led);
      if (sameSuit && cardPower(play.card, preset) > cardPower(best.card, preset)) best = play;
    }
  }
  return best.seat;
}
