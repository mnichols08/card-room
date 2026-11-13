import {
  applyPalace,
  familyPalace,
  MAX_SEATS,
  MIN_SEATS,
  newPalace,
  palaceBot,
  palaceThinkingTime,
  normalizePalaceRules,
  BEFORE_SETTINGS,
  validatePalaceRules,
  viewPalace,
  type PalaceAction,
  type PalaceMove,
  type PalaceRules,
  type PalaceState,
  type PalaceView,
} from "@cardroom/palace";
import { paceDelay, personaFor, styleFor, type TableSettings } from "@spades/rules";
import type { RoomDefinition } from "@spades/rooms/server";

/** A Palace room's options: which game, the house rules, and how many seats. */
export interface PalaceOptions {
  game: "palace";
  rules: PalaceRules;
  seats: number;
}


export interface PalaceSummary {
  game: "palace";
  rules: string;
  phase: PalaceState["phase"];
  seats: number;
  /** Seats in the order they went out, and the one left holding cards. */
  finished: number[];
  loser: number | null;
  left: number[];
}

/**
 * Rules from a page or from storage. A whole set saved before `choose` existed (a room's options, a
 * house's rules) has `swap` but no `choose`: it meant the old deal, and a game being replayed from its
 * moves must be dealt exactly as it was. Anything else is filled in from its built-in preset.
 */
export function palaceRulesFrom(rules: unknown): PalaceRules {
  if (!rules || typeof rules !== "object") return familyPalace;
  const given = rules as Partial<PalaceRules>;
  // A whole set (it has `swap`): any setting it doesn't mention didn't exist yet, so it keeps the meaning it had.
  if ("swap" in given) return { ...familyPalace, ...BEFORE_SETTINGS, ...given } as PalaceRules;
  return normalizePalaceRules(given);
}

/** Rules and a seat count from a page: checked, falling back to the family rules and four seats. */
export function palaceOptions(rules: unknown, seats: unknown): PalaceOptions {
  const given = palaceRulesFrom(rules);
  const clean = validatePalaceRules(given).length === 0 ? given : familyPalace;
  const n = Number(seats);
  return { game: "palace", rules: { ...clean, name: String(clean.name).trim().slice(0, 30) || familyPalace.name }, seats: Number.isInteger(n) && n >= MIN_SEATS && n <= MAX_SEATS ? n : 4 };
}

export const palaceRoom: RoomDefinition<PalaceState, PalaceMove, PalaceView, PalaceOptions, PalaceSummary> = {
  seats: (options) => palaceOptions(options.rules, options.seats).seats,
  setup: (options, seed) => {
    const o = palaceOptions(options.rules, options.seats);
    return newPalace(o.rules, o.seats, seed, seed % o.seats);
  },
  act: (state, seat, move) => applyPalace(state, { ...(move as object), seat } as PalaceAction),
  view: (state, seat) => viewPalace(state, seat),
  summary: (state) => ({
    game: "palace",
    rules: state.rules.name,
    phase: state.phase,
    seats: state.seats,
    finished: state.finished,
    loser: state.loser,
    left: state.players.map((p) => p.hand.length + p.up.length + p.down.length),
  }),
  finished: (state) => state.phase === "finished",
  botDelay: (state, seat, name, settings?: TableSettings) => paceDelay(settings?.pace ?? "natural", () => palaceThinkingTime(state, seat, name)),
  bot(state, seat, name, settings?: TableSettings) {
    const action = palaceBot(state, seat, styleFor(personaFor(name).style, settings?.skill));
    if (!action) return null;
    const { seat: _seat, ...move } = action;
    return move as PalaceMove;
  },
};
