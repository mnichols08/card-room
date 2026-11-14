// The table for any game on the kit: the card table for a card game's view, the board table for a
// board game's, the canvas table for a table sport's. Family tables and practice games both come through here, so neither needs to know
// which kind of game it is running.
import { isBoardGame, isSportGame, type BoardView, type KitView, type SportView } from "@cardroom/games";
import { BoardTable } from "../board/BoardTable";
import { SportTable } from "../sport/SportTable";
import { KitTable, type KitTableProps } from "./KitTable";

export function GameTable({ view, ...rest }: Omit<KitTableProps, "view"> & { view: KitView | BoardView | SportView }) {
  if (isSportGame(view.game)) return <SportTable view={view as SportView} {...rest} />;
  return isBoardGame(view.game) ? <BoardTable view={view as BoardView} {...rest} /> : <KitTable view={view as KitView} {...rest} />;
}
