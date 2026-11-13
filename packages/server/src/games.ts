// The games the card room plays, and one room definition that hands each table to its game.
//
// A room's options say which game it is. Spades rooms keep the options they always had (the house
// rules themselves), so tables and logs from before there were other games still work; any other
// game's options carry `game`.
import { palaceGreet, palaceReplyTo, reactToPalace, type PalaceState } from "@cardroom/palace";
import type { RoomDefinition } from "@spades/rooms/server";
import { cleanSettings, greet, reactToMove, replyTo, type GameState, type RulePreset, type Seat } from "@spades/rules";
import { palaceOptions, palaceRoom, type PalaceOptions } from "./palace.js";
import { spadesRoom } from "./spades.js";

export type GameId = "spades" | "palace";
export const GAMES: { id: GameId; name: string; emoji: string; seats: [number, number] }[] = [
  { id: "spades", name: "Spades", emoji: "♠️", seats: [4, 4] },
  { id: "palace", name: "Palace", emoji: "🏰", seats: [2, 6] },
];
export const gameName = (id: GameId) => GAMES.find((g) => g.id === id)?.name ?? "Spades";

export type TableOptions = RulePreset | PalaceOptions;
type AnyState = GameState | PalaceState;

export const gameOfOptions = (o: unknown): GameId => ((o as { game?: string } | null)?.game === "palace" ? "palace" : "spades");
export const gameOfState = (s: unknown): GameId => ((s as { game?: string } | null)?.game === "palace" ? "palace" : "spades");

const rooms: Record<GameId, RoomDefinition<any, any, any, any, any>> = { spades: spadesRoom, palace: palaceRoom };
const byState = (s: AnyState) => rooms[gameOfState(s)];

export const tableRoom: RoomDefinition<AnyState, unknown, unknown, TableOptions, unknown> = {
  seats: (o) => {
    const room = rooms[gameOfOptions(o)];
    return typeof room.seats === "function" ? room.seats(o) : room.seats;
  },
  setup: (o, seed) => rooms[gameOfOptions(o)].setup(o, seed),
  info: (o) => (gameOfOptions(o) === "palace" ? { game: "palace", rules: palaceOptions((o as PalaceOptions).rules, (o as PalaceOptions).seats).rules.name } : { game: "spades", rules: (o as RulePreset).name }),
  act: (s, seat, move) => byState(s).act(s, seat, move),
  view: (s, seat) => byState(s).view(s, seat),
  // Every summary says its game, so a lobby or a blog embed can tell tables apart.
  summary: (s) => ({ game: gameOfState(s), ...(byState(s).summary?.(s) as object) }),
  finished: (s) => byState(s).finished?.(s) ?? false,
  // How well and how fast the computer players play, for every game.
  settings: cleanSettings,
  botDelay: (s, seat, name, settings) => byState(s).botDelay?.(s, seat, name, settings) ?? 700,
  bot: (s, seat, name, settings) => byState(s).bot?.(s, seat, name, settings) ?? null,
};

export interface Remark {
  seat: number;
  text: string;
  delay: number;
}
type Cast = { bots: { seat: number; name: string }[] };

/** Table talk, in each game's own words. */
export const talk = {
  greet: (s: AnyState, cast: Cast): Remark[] => (gameOfState(s) === "palace" ? palaceGreet(cast) : greet(cast as { bots: { seat: Seat; name: string }[] })),
  react: (before: AnyState, after: AnyState, cast: Cast): Remark[] =>
    gameOfState(after) === "palace"
      ? reactToPalace(before as PalaceState, after as PalaceState, cast)
      : reactToMove(before as GameState, after as GameState, cast as { bots: { seat: Seat; name: string }[] }),
  reply: (game: GameId, text: string, seat: number, cast: Cast): Remark[] =>
    game === "palace" ? palaceReplyTo(text, cast) : replyTo(text, seat as Seat, cast as { bots: { seat: Seat; name: string }[] }),
  finished: (s: AnyState) => (s as { phase?: string }).phase === "finished",
};
