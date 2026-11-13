import {
  applyAction,
  smartAction,
  thinkingTime,
  personaFor,
  brokennilsTable,
  newGame,
  validatePreset,
  viewFor,
  type Action,
  type GameState,
  type RulePreset,
  type Seat,
  type SeatView,
} from "@spades/rules";
import type { RoomDefinition } from "@spades/rooms/server";

/** A move as a player sends it: an action without the seat, which the server knows from the cookie. */
export type Move = Action extends infer A ? (A extends { seat: Seat } ? Omit<A, "seat"> : never) : never;

export interface Summary {
  rules: string;
  phase: GameState["phase"];
  hand: number;
  playTo: number;
  scores: GameState["scores"];
  winner: GameState["winner"];
}

/** The room's options are the house rules. Anything invalid falls back to brokennil's Table. */
function rulesFrom(options: unknown): RulePreset {
  const preset = options as RulePreset | null;
  if (!preset || typeof preset !== "object" || typeof preset.name !== "string") return brokennilsTable;
  try {
    return validatePreset({ ...brokennilsTable, ...preset }).length === 0 ? { ...brokennilsTable, ...preset } : brokennilsTable;
  } catch {
    return brokennilsTable;
  }
}

export const spadesRoom: RoomDefinition<GameState, Move, SeatView, RulePreset, Summary> = {
  seats: 4,
  setup: (options, seed) => newGame(rulesFrom(options), seed),
  act: (state, seat, move) => applyAction(state, { ...(move as object), seat: seat as Seat } as Action),
  view: (state, seat) => viewFor(state, seat as Seat),
  summary: (state) => ({
    rules: state.preset.name,
    phase: state.phase,
    hand: state.handNumber + 1,
    playTo: state.preset.playTo,
    scores: state.scores,
    winner: state.winner,
  }),
  finished: (state) => state.phase === "finished",
  // Each bot takes its persona's time, longer on close calls: people don't play instantly.
  botDelay: (state, seat, name) => thinkingTime(state, seat as Seat, name),
  bot(state, seat, name) {
    // The thinking bot, playing in its persona's style: sharp, careless, bold or nil-crazy.
    const action = smartAction(state, seat as Seat, { style: personaFor(name).style });
    if (!action) return null;
    const { seat: _seat, ...move } = action;
    return move as Move;
  },
};
