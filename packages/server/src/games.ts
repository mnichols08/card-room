// The games the card room plays, and one room definition that hands each table to its game.
//
// A room's options say which game it is. Spades rooms keep the options they always had (the house
// rules themselves), so tables and logs from before there were other games still work; any other
// game's options carry `game`.
import { KIT_GAMES, isKitGame, kitGame, kitGreet, reactToKit, type KitGameId } from "@cardroom/games";
import { palaceGreet, palaceReplyTo, reactToPalace, type PalaceState } from "@cardroom/palace";
import type { RoomDefinition } from "@spades/rooms/server";
import { cleanSettings, greet, reactToMove, replyTo, type GameState, type RulePreset, type Seat } from "@spades/rules";
import { palaceOptions, palaceRoom, type PalaceOptions } from "./palace.js";
import { spadesRoom } from "./spades.js";
import { kitOptions, kitRoom, type KitOptions } from "./kit.js";
import { turnDeadline } from "./timer.js";

export type GameId = "spades" | "palace" | KitGameId;
export const GAMES: { id: GameId; name: string; emoji: string; seats: [number, number]; teams: boolean }[] = [
  { id: "spades", name: "Spades", emoji: "♠️", seats: [4, 4], teams: true },
  { id: "palace", name: "Palace", emoji: "🏰", seats: [2, 6], teams: false },
  ...KIT_GAMES.map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, seats: [g.seats.min, g.seats.max] as [number, number], teams: g.teams })),
];
export const gameName = (id: GameId) => GAMES.find((g) => g.id === id)?.name ?? "Spades";
export const gameEmoji = (id: GameId) => GAMES.find((g) => g.id === id)?.emoji ?? "🃏";
export const isGameId = (id: unknown): id is GameId => GAMES.some((g) => g.id === id);

export type TableOptions = RulePreset | PalaceOptions | KitOptions;
type AnyState = GameState | PalaceState | ({ game: KitGameId } & Record<string, unknown>);

/** A room's game, from its options or its state. Spades rooms have no `game` (they predate the others). */
const gameOf = (x: unknown): GameId => {
  const g = (x as { game?: string } | null)?.game;
  return g === "palace" || isKitGame(g) ? (g as GameId) : "spades";
};
export const gameOfOptions = gameOf;
export const gameOfState = gameOf;

const rooms: Record<GameId, RoomDefinition<any, any, any, any, any>> = {
  spades: spadesRoom,
  palace: palaceRoom,
  ...(Object.fromEntries(KIT_GAMES.map((g) => [g.id, kitRoom])) as Record<KitGameId, typeof kitRoom>),
};
const byState = (s: AnyState) => rooms[gameOfState(s)];

export const tableRoom: RoomDefinition<AnyState, unknown, unknown, TableOptions, unknown> = {
  seats: (o) => {
    const room = rooms[gameOfOptions(o)];
    return typeof room.seats === "function" ? room.seats(o) : room.seats;
  },
  setup: (o, seed) => rooms[gameOfOptions(o)].setup(o, seed),
  info: (o) => {
    const game = gameOfOptions(o);
    if (game === "palace") return { game, rules: palaceOptions((o as PalaceOptions).rules, (o as PalaceOptions).seats).rules.name };
    if (game === "spades") return { game, rules: (o as RulePreset).name };
    return { game, rules: kitOptions(kitGame(game)!, (o as KitOptions).rules, (o as KitOptions).seats).rules.name };
  },
  act: (s, seat, move, time) => byState(s).act(s, seat, move, time),
  view: (s, seat) => byState(s).view(s, seat),
  // Every summary says its game, so a lobby or a blog embed can tell tables apart.
  summary: (s) => ({ game: gameOfState(s), ...(byState(s).summary?.(s) as object) }),
  finished: (s) => byState(s).finished?.(s) ?? false,
  // How well and how fast the computer players play, for every game.
  settings: cleanSettings,
  botDelay: (s, seat, name, settings) => byState(s).botDelay?.(s, seat, name, settings) ?? 700,
  bot: (s, seat, name, settings) => byState(s).bot?.(s, seat, name, settings) ?? null,
  // The turn timer (a table setting): the game's computer player moves for a person who runs out of time.
  deadline: (s, table) => turnDeadline(s, table, (seat, name) => byState(s).bot?.(s, seat, name, table.settings) ?? null),
};

export interface Remark {
  seat: number;
  text: string;
  delay: number;
}
type Cast = { bots: { seat: number; name: string }[] };

/** Table talk, in each game's own words. */
export const talk = {
  greet: (s: AnyState, cast: Cast): Remark[] => {
    const game = gameOfState(s);
    if (game === "palace") return palaceGreet(cast);
    if (game === "spades") return greet(cast as { bots: { seat: Seat; name: string }[] });
    return kitGreet(cast);
  },
  react: (before: AnyState, after: AnyState, cast: Cast): Remark[] => {
    const game = gameOfState(after);
    if (game === "palace") return reactToPalace(before as PalaceState, after as PalaceState, cast);
    if (game === "spades") return reactToMove(before as GameState, after as GameState, cast as { bots: { seat: Seat; name: string }[] });
    const kit = kitGame(game)!;
    return reactToKit(kit.summary(before), kit.summary(after), cast);
  },
  // Anything but spades answers in the shared reply lines (they're the same cast).
  reply: (game: GameId, text: string, seat: number, cast: Cast): Remark[] =>
    game === "spades" ? replyTo(text, seat as Seat, cast as { bots: { seat: Seat; name: string }[] }) : palaceReplyTo(text, cast),
  finished: (s: AnyState) => {
    const game = gameOfState(s);
    return isKitGame(game) ? kitGame(game)!.summary(s).over : (s as { phase?: string }).phase === "finished";
  },
};
