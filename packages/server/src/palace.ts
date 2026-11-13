import {
  applyPalace,
  familyPalace,
  MAX_SEATS,
  MIN_SEATS,
  newPalace,
  palaceBot,
  palaceThinkingTime,
  validatePalaceRules,
  viewPalace,
  type PalaceAction,
  type PalaceRules,
  type PalaceState,
  type PalaceView,
} from "@cardroom/palace";
import { personaFor } from "@spades/rules";
import type { RoomDefinition } from "@spades/rooms/server";

/** A Palace room's options: which game, the house rules, and how many seats. */
export interface PalaceOptions {
  game: "palace";
  rules: PalaceRules;
  seats: number;
}

export type PalaceMove = PalaceAction extends infer A ? (A extends { seat: number } ? Omit<A, "seat"> : never) : never;

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

/** Rules and a seat count from a page: checked, falling back to the family rules and four seats. */
export function palaceOptions(rules: unknown, seats: unknown): PalaceOptions {
  const given = rules && typeof rules === "object" ? { ...familyPalace, ...(rules as PalaceRules) } : familyPalace;
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
  botDelay: (state, seat, name) => palaceThinkingTime(state, seat, name),
  bot(state, seat, name) {
    const action = palaceBot(state, seat, personaFor(name).style);
    if (!action) return null;
    const { seat: _seat, ...move } = action;
    return move as PalaceMove;
  },
};
