import { KIT_GAMES } from "@cardroom/games";
import { arranged } from "./catalogue";
import type { GameId } from "./storage";

export const GAME_LIST: { id: GameId; name: string; emoji: string; blurb: string }[] = [
  { id: "spades", name: "Spades", emoji: "♠\uFE0E", blurb: "Partners, bids and nils" },
  { id: "palace", name: "Palace", emoji: "🏰", blurb: "First to shed every card wins" },
  ...KIT_GAMES.map((g) => ({ id: g.id, name: g.name, emoji: g.emoji, blurb: g.blurb })),
];

/** Which game: a row of big, plain buttons. */
export function GamePicker({ game, onPick }: { game: GameId; onPick: (game: GameId) => void }) {
  return (
    <nav className="game-picker" aria-label="Game">
      {arranged(GAME_LIST).map((g) => (
        <button key={g.id} type="button" className={g.id === game ? "picked" : ""} aria-pressed={g.id === game} onClick={() => onPick(g.id)}>
          <span aria-hidden>{g.emoji}</span> {g.name}
          <small>{g.blurb}</small>
        </button>
      ))}
    </nav>
  );
}

/** On a game's setup screen: back to the front page with every game. */
export function AllGames({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="link all-games" onClick={onClick}>
      ← All games
    </button>
  );
}
