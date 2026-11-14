// Table settings, for every game: how well the computer players play, and how fast.
//
// Skill: "mixed" lets each persona play its own way (Junior's careless, Vern's sharp); the levels
// play everyone at that strength, keeping their personalities and chat. Pace: "natural" is a person's
// thinking time (quick when forced, longer on a close call); the others are fixed.
//
// Turn timer: off unless a table turns it on. With it, a person who doesn't move in time has the move
// made for them by the game's own computer player, so one phone left on a sofa doesn't stop the game.
import type { PlayStyle } from "./smart.js";

export type Skill = "mixed" | "easy" | "medium" | "hard";
export type Pace = "instant" | "fast" | "medium" | "slow" | "natural";

export type TurnTimer = "off" | "15s" | "30s" | "1m" | "2m" | "1d";

export interface TableSettings {
  skill: Skill;
  pace: Pace;
  /** How long a person has for a move. Left out when it's off, which it is unless a table sets it. */
  timer?: Exclude<TurnTimer, "off">;
}

export const DEFAULT_SETTINGS: TableSettings = { skill: "mixed", pace: "natural" };

export const SKILLS: { id: Skill; label: string; hint: string }[] = [
  { id: "mixed", label: "Their own way", hint: "Each computer player plays like themselves: some sharp, some careless." },
  { id: "easy", label: "Easy", hint: "Forgiving opponents who make mistakes." },
  { id: "medium", label: "Medium", hint: "Decent players who slip now and then." },
  { id: "hard", label: "Hard", hint: "Everyone plays their best." },
];

export const PACES: { id: Pace; label: string; ms: number | null }[] = [
  { id: "instant", label: "Instant", ms: 60 },
  { id: "fast", label: "Fast", ms: 350 },
  { id: "medium", label: "Medium", ms: 900 },
  { id: "slow", label: "Slow", ms: 2200 },
  { id: "natural", label: "Natural (like a person)", ms: null },
];

export const TURN_TIMERS: { id: TurnTimer; label: string; ms: number | null }[] = [
  { id: "off", label: "No limit", ms: null },
  { id: "15s", label: "15 seconds", ms: 15_000 },
  { id: "30s", label: "30 seconds", ms: 30_000 },
  { id: "1m", label: "1 minute", ms: 60_000 },
  { id: "2m", label: "2 minutes", ms: 120_000 },
  { id: "1d", label: "A day", ms: 86_400_000 },
];

/** How long a person has for a move at this table, in ms; null for as long as they like. */
export const turnTimerMs = (settings: Pick<TableSettings, "timer"> | null | undefined): number | null =>
  TURN_TIMERS.find((t) => t.id === settings?.timer)?.ms ?? null;

/** Settings from a page or storage, checked; anything unknown is the default. */
export function cleanSettings(value: unknown): TableSettings {
  const given = (value && typeof value === "object" ? value : {}) as Partial<TableSettings>;
  const timer = TURN_TIMERS.find((t) => t.id === given.timer && t.ms !== null)?.id as TableSettings["timer"];
  return {
    skill: SKILLS.some((s) => s.id === given.skill) ? given.skill! : DEFAULT_SETTINGS.skill,
    pace: PACES.some((p) => p.id === given.pace) ? given.pace! : DEFAULT_SETTINGS.pace,
    ...(timer ? { timer } : {}),
  };
}

/** How a bot plays at this table: its persona's style, or the table's level (keeping its boldness and nil habits). */
export function styleFor(persona: PlayStyle, skill: Skill = "mixed"): PlayStyle {
  switch (skill) {
    case "easy":
      return { ...persona, skill: 0.25, sloppy: 0.3 };
    case "medium":
      return { ...persona, skill: 0.65, sloppy: 0.06 };
    case "hard":
      return { ...persona, skill: 1, sloppy: 0 };
    default:
      return persona;
  }
}

/** How long a bot takes over a move at this pace; `natural` asks the game for a person's thinking time. */
export function paceDelay(pace: Pace, natural: () => number): number {
  return PACES.find((p) => p.id === pace)?.ms ?? natural();
}
