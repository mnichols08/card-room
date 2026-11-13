import type { GameId } from "./storage";

export const GAME_LIST: { id: GameId; name: string; emoji: string; blurb: string }[] = [
  { id: "spades", name: "Spades", emoji: "♠️", blurb: "Partners, bids and nils" },
  { id: "palace", name: "Palace", emoji: "🏰", blurb: "First to shed every card wins" },
];

/** Which game: a row of big, plain buttons. */
export function GamePicker({ game, onPick }: { game: GameId; onPick: (game: GameId) => void }) {
  return (
    <nav className="game-picker" aria-label="Game">
      {GAME_LIST.map((g) => (
        <button key={g.id} type="button" className={g.id === game ? "picked" : ""} aria-pressed={g.id === game} onClick={() => onPick(g.id)}>
          <span aria-hidden>{g.emoji}</span> {g.name}
          <small>{g.blurb}</small>
        </button>
      ))}
    </nav>
  );
}
