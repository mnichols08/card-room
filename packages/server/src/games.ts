// The games the card room plays, and one room definition that hands each table to its game.
//
// A room's options say which game it is. Spades rooms keep the options they always had (the house
// rules themselves), so tables and logs from before there were other games still work; any other
// game's options carry `game`.
import { KIT_GAMES, isBoardGame, isKitGame, isSportGame, kitGame, kitGreet, reactToKit, type KitGameId } from "@cardroom/games";
import { palaceGreet, palaceReplyTo, reactToPalace, type PalaceState } from "@cardroom/palace";
import { sharedView, type RoomDefinition } from "@spades/rooms/server";
import { cleanSettings, greet, reactToMove, replyTo, type GameState, type RulePreset, type Seat } from "@spades/rules";
import { palaceOptions, palaceRoom, type PalaceOptions } from "./palace.js";
import { spadesRoom } from "./spades.js";
import { kitOptions, kitRoom, type KitOptions } from "./kit.js";
import { sooner, turnDeadline } from "./timer.js";

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
  watch: (s, views) => watchView(gameOfState(s), views),
  // Every summary says its game, so a lobby or a blog embed can tell tables apart.
  summary: (s) => ({ game: gameOfState(s), ...(byState(s).summary?.(s) as object) }),
  finished: (s) => byState(s).finished?.(s) ?? false,
  // How well and how fast the computer players play, for every game.
  settings: cleanSettings,
  botDelay: (s, seat, name, settings) => byState(s).botDelay?.(s, seat, name, settings) ?? 700,
  bot: (s, seat, name, settings) => byState(s).bot?.(s, seat, name, settings) ?? null,
  // Two clocks can be running: the game's own (a shot clock, which makes the game's timeout move) and
  // the turn timer (a table setting: the game's computer player moves for a person who runs out of
  // time). Whichever runs out first is the room's deadline.
  deadline: (s, table) => sooner(byState(s).deadline?.(s, table) ?? null, turnDeadline(s, table, (seat, name) => byState(s).bot?.(s, seat, name, table.settings) ?? null)),
};

/**
 * What someone watching a table sees: the table as every seat sees it, with nobody's hand and
 * nobody's moves, looking on from the first seat's side (a page can turn it to any side).
 * Each kind of game names its private parts; `sharedView` then drops anything else the seats
 * don't all see alike.
 */
export function watchView(game: GameId, views: unknown[]): unknown {
  type Any = Record<string, unknown>;
  const seats = views as Any[];
  if (game === "spades") return sharedView(seats, { blank: { hand: [], legal: [], myPass: null }, from: { seat: 0, keys: ["seat", "team", "partner", "teamSeats"] } });
  if (game === "palace") return sharedView(seats, { blank: { hand: [], can: null }, from: { seat: 0, keys: ["you"] } });
  // A table sport hides nothing, but each seat's table is its own: its world holds that seat's ball
  // and the others are drawn around it, and the shot it replays may be its own. Compared part by
  // part those come out as a world with nothing in it, which no table can draw. So the watcher is
  // given the first seat's table and shot whole, and nothing to strike.
  if (isSportGame(game)) return sharedView(seats, { blank: { shoot: null, choices: null }, from: { seat: 0, keys: ["me", "table", "last"] } });
  // A board that belongs to one seat (a fleet in Combat) is nobody else's, and neither is what that
  // seat holds off the board. Left in, two fleets that happened to overlap would show where: the
  // seats' views are compared part by part, and a watcher can be someone sitting at the table.
  // Only on a board: a card game's grids (Golf's cards in front of each player) have an owner too,
  // and those are for everyone to see.
  const open = !isBoardGame(game) ? seats : seats.map((v) => (Array.isArray(v.grids) && v.grids.some((g) => (g as Any).owner !== undefined) ? { ...v, grids: v.grids.filter((g) => (g as Any).owner === undefined), reserves: [] } : v));
  const view = sharedView(open, { blank: { hand: [], tap: null, pick: null, choices: null, gridTap: null }, from: { seat: 0, keys: ["me"] } });
  // A line of table talk only one seat was shown ("You were passed…") is nobody else's.
  if (Array.isArray(view.info)) view.info = view.info.filter((line) => typeof line === "string");
  return view;
}

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
    return kitGreet(cast, undefined, game);
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
