// Shared pieces for the drinking games (Ride the Bus, Kings Cup, Horse Race, Drinking Pyramid):
// a tally of drinks taken, and handing drinks out ("give 2 to someone").
import { drinkLine, who, type Choice } from "./kit.js";

export interface Tally {
  /** Drinks each seat has taken (99 means a whole drink: counted as 5). */
  drank: number[];
  /** Drinks waiting to be handed out: each giver picks who. */
  give: { from: number; n: number; why: string }[];
}

export const newTally = (seats: number): Tally => ({ drank: Array(seats).fill(0), give: [] });

/** Seats drink n each; returns the line for the table. */
export function drink(t: Tally, seats: number[], n: number): string {
  for (const s of seats) t.drank[s]! += n === 99 ? 5 : n;
  return drinkLine(seats, n);
}

/** The choices for whoever is handing out drinks. */
export function giveChoices(t: Tally, seats: number, seat: number): { prompt: string; options: Choice[]; layout: "list" } | null {
  const g = t.give[0];
  if (!g || g.from !== seat) return null;
  return {
    prompt: `${g.why}: give ${g.n} drink${g.n === 1 ? "" : "s"} to…`,
    options: Array.from({ length: seats }, (_, i) => i).filter((i) => i !== seat).map((i) => ({ label: who(i), move: { type: "give", to: i } })),
    layout: "list",
  };
}

/** Hand out the first waiting drinks to `to`. */
export function giveTo(t: Tally, seat: number, to: number, seats: number): string {
  const g = t.give[0];
  if (!g || g.from !== seat) throw new Error("not yours");
  if (!(to >= 0 && to < seats) || to === seat) throw new Error("bad target");
  t.give.shift();
  return `${who(seat)} gives ${g.n} to ${who(to)} · ${drink(t, [to], g.n)}`;
}

/** A computer player hands drinks to whoever has had the fewest (or, if cheeky, anyone). */
export function botGiveTarget(t: Tally, seat: number, seats: number): number {
  const others = Array.from({ length: seats }, (_, i) => i).filter((i) => i !== seat);
  if (Math.random() < 0.4) return others[Math.floor(Math.random() * others.length)]!;
  return others.sort((a, b) => t.drank[a]! - t.drank[b]!)[0]!;
}

export const DRINK_NOTE = "A drinking game: sips of anything you like (water counts).";
