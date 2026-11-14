// The games on the card kit, in the card room: one room definition serves them all. A room's
// options say which game, its house rules and how many seats.
import { kitGame, type CardGame, type KitGameId, type KitSummary, type KitView } from "@cardroom/games";
import { paceDelay, personaFor, styleFor, type TableSettings } from "@spades/rules";
import type { RoomDefinition } from "@spades/rooms/server";

export interface KitOptions {
  game: KitGameId;
  rules: { id: string; name: string } & Record<string, unknown>;
  seats: number;
}

/** Options from a page or a house: rules checked (else the game's first preset), seats in range. */
export function kitOptions(game: CardGame<any, any, any>, rules: unknown, seats: unknown): KitOptions {
  const given = game.normalize(rules);
  const clean = game.validate(given).length === 0 ? given : game.presets[0];
  const n = Number(seats);
  const fits = Number.isInteger(n) && n >= game.seats.min && n <= game.seats.max;
  return {
    game: game.id,
    rules: { ...clean, name: String(clean.name ?? "").trim().slice(0, 30) || game.presets[0].name },
    seats: game.teams ? 4 : fits ? n : game.seats.default,
  };
}

const gameFor = (id: unknown) => {
  const game = kitGame(id);
  if (!game) throw new Error(`No such game: ${String(id)}`);
  return game;
};

export const kitRoom: RoomDefinition<{ game: KitGameId } & Record<string, unknown>, Record<string, unknown>, KitView, KitOptions, KitSummary> = {
  seats: (options) => kitOptions(gameFor(options.game), options.rules, options.seats).seats,
  setup: (options, seed) => {
    const game = gameFor(options.game);
    const o = kitOptions(game, options.rules, options.seats);
    return game.newGame(o.rules, o.seats, seed);
  },
  act: (state, seat, move) => gameFor(state.game).apply(state, seat, move),
  view: (state, seat) => gameFor(state.game).view(state, seat),
  summary: (state) => gameFor(state.game).summary(state),
  finished: (state) => gameFor(state.game).summary(state).over,
  botDelay: (state, seat, name, settings?: TableSettings) =>
    gameFor(state.game).reactionTime?.(state, seat, styleFor(personaFor(name).style, settings?.skill)) ??
    paceDelay(settings?.pace ?? "natural", () => Math.round(gameFor(state.game).thinkingTime(state, seat) * personaFor(name).pace * (0.8 + Math.random() * 0.5))),
  bot: (state, seat, name, settings?: TableSettings) => gameFor(state.game).bot(state, seat, styleFor(personaFor(name).style, settings?.skill)),
};
