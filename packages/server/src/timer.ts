// The turn timer, for every game: a table setting (off unless someone turns it on) that gives each
// person so long for a move. When it runs out the game's own computer player makes the move for
// them, so a phone left on the sofa doesn't stop the game for everyone else. It's a room deadline
// (see @spades/rooms): the server keeps the time, and the timeout move goes into the move log like
// any other.
import { kitGame, type KitGameId } from "@cardroom/games";
import type { PalaceState } from "@cardroom/palace";
import type { Deadline, TableInfo } from "@spades/rooms/server";
import { turnTimerMs, type GameState, type TableSettings } from "@spades/rules";

type KitState = { game: KitGameId } & Record<string, unknown>;
type AnyState = GameState | PalaceState | KitState;
/** A game's computer player, asked for a seat's move: null when it has none. */
type Bot = (seat: number, name: string) => unknown | null;

/**
 * The seat the table is waiting on, or null when it isn't waiting on anyone in particular.
 *
 * Usually that's whose turn it is. When everyone moves at once (passing cards, Palace's swap, "Deal
 * the next hand" after a hand) one person who has walked away holds the game up just the same, so the
 * clock goes on the first person who still owes a move: the first one the computer player would move
 * for. A race (Speed, a slap in Slapjack) is the exception: nobody owes a move there, and playing for
 * a person would be playing the game for them.
 */
function waitingOn(state: AnyState, table: TableInfo, bot: Bot): number | null {
  const game = (state as { game?: string }).game;
  const kit = kitGame(game);
  let turn: number | null;
  if (game === "palace") {
    const s = state as PalaceState;
    if (s.phase === "finished") return null;
    turn = s.phase === "playing" ? s.turn : null;
  } else if (kit) {
    const view = kit.view(state, 0);
    if (view.over) return null;
    turn = view.turn;
    if (turn === null && kit.reactionTime) return null;
  } else {
    const s = state as GameState;
    if (s.phase === "finished") return null;
    turn = s.phase === "bidding" || s.phase === "playing" ? s.turn : null;
  }
  if (turn !== null) return turn;
  const late = table.seats.findIndex((s, seat) => !s.bot && bot(seat, s.name ?? "") !== null);
  return late >= 0 ? late : null;
}

/** The table's deadline: the turn timer on the person it's waiting for, if the timer is on. */
export function turnDeadline(state: AnyState, table: TableInfo, bot: Bot): Deadline<unknown> | null {
  const ms = turnTimerMs(table.settings as TableSettings | null);
  // Alone at a table (solitaire), nobody is kept waiting.
  if (ms === null || table.seats.length < 2) return null;
  const seat = waitingOn(state, table, bot);
  // A computer player keeps its own time.
  if (seat === null || !table.seats[seat] || table.seats[seat].bot) return null;
  const name = table.seats[seat].name ?? "";
  // The move is only worked out if the time really runs out: a bot's think can be a long one.
  return { after: ms, seat, move: () => bot(seat, name) };
}
