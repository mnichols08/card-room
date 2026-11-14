// The Card Room's start page: the Vue game chooser, mounted inside the React app.
import { KIT_GAMES } from "@cardroom/games";
import { createApp, reactive } from "vue";
import { useEffect, useRef } from "react";
import { GAME_LIST } from "../GamePicker";
import { loadMyHouses, loadName, type GameId } from "../storage";
import GameChooser from "./GameChooser.vue";

const card = (rank: number, suit: string) => ({ kind: "pip" as const, rank, suit });

/** Each game's fan of cards on its tile: a hand that says what the game is about. */
const fruit = (fruit: string | null, face: number | string) => ({ kind: "fruit" as const, fruit, face });
const FANS: Record<string, object[]> = {
  spades: [card(12, "spades"), card(13, "spades"), card(14, "spades")],
  palace: [card(10, "clubs"), card(2, "hearts"), card(14, "diamonds")],
  hearts: [card(13, "hearts"), card(12, "spades"), card(14, "hearts")],
  ohhell: [card(7, "diamonds"), card(8, "diamonds"), card(9, "diamonds")],
  euchre: [card(11, "diamonds"), card(11, "hearts"), card(14, "hearts")],
  crazy8: [card(8, "spades"), card(8, "hearts"), card(8, "diamonds")],
  gin: [card(7, "clubs"), card(7, "diamonds"), card(7, "hearts")],
  pinochle: [card(12, "spades"), card(11, "diamonds"), card(14, "hearts")],
  canasta: [card(13, "hearts"), card(13, "clubs"), card(13, "spades")],
  gofish: [card(5, "hearts"), card(5, "spades"), card(5, "diamonds")],
  oldmaid: [card(9, "hearts"), card(9, "diamonds"), card(12, "spades")],
  war: [card(2, "clubs"), card(14, "spades"), card(10, "hearts")],
  whist: [card(14, "clubs"), card(13, "clubs"), card(12, "clubs")],
  golf: [card(13, "spades"), card(2, "hearts"), card(14, "diamonds")],
  rummy500: [card(5, "hearts"), card(6, "hearts"), card(7, "hearts")],
  president: [card(2, "spades"), card(2, "hearts"), card(3, "clubs")],
  klondike: [card(13, "spades"), card(12, "hearts"), card(11, "spades")],
  freecell: [card(14, "hearts"), card(14, "clubs"), card(14, "diamonds")],
  handfoot: [card(9, "spades"), card(9, "hearts"), card(9, "clubs")],
  cribbage: [card(5, "hearts"), card(5, "clubs"), card(11, "diamonds")],
  fivedraw: [card(14, "spades"), card(14, "hearts"), card(13, "clubs")],
  holdem: [card(14, "spades"), card(13, "spades"), card(10, "diamonds")],
  bluff: [card(7, "clubs"), card(7, "hearts"), card(2, "diamonds")],
  liarspoker: [card(13, "hearts"), card(13, "diamonds"), card(4, "spades")],
  switch: [card(2, "hearts"), card(8, "clubs"), card(14, "spades")],
  thirtyone: [card(14, "diamonds"), card(13, "diamonds"), card(10, "diamonds")],
  kingscorner: [card(13, "spades"), card(12, "hearts"), card(11, "clubs")],
  blackjack: [card(14, "spades"), card(13, "hearts")],
  spite: [card(14, "clubs"), card(2, "hearts"), card(13, "spades")],
  pitch: [card(14, "hearts"), card(11, "hearts"), card(2, "hearts")],
  fivehundred: [card(11, "hearts"), card(11, "diamonds"), card(14, "hearts")],
  durak: [card(6, "spades"), card(9, "spades"), card(7, "hearts")],
  bridge: [card(14, "spades"), card(13, "spades"), card(12, "spades")],
  fruitsalad: [fruit("cherry", 7), fruit("lemon", "plus2"), fruit(null, "salad")],
  slapjack: [card(4, "clubs"), card(9, "hearts"), card(11, "spades")],
  speed: [card(6, "hearts"), card(7, "clubs"), card(8, "diamonds")],
  memory: [card(7, "hearts"), card(7, "diamonds"), card(12, "spades")],
  sevens: [card(6, "hearts"), card(7, "hearts"), card(8, "hearts")],
  cuckoo: [card(13, "clubs"), card(14, "hearts")],
  contractrummy: [card(9, "spades"), card(9, "hearts"), card(9, "clubs")],
};

const SEATS: Record<string, { seats: [number, number]; teams: boolean }> = {
  spades: { seats: [4, 4], teams: true },
  palace: { seats: [2, 6], teams: false },
  ...Object.fromEntries(KIT_GAMES.map((g) => [g.id, { seats: [g.seats.min, g.seats.max] as [number, number], teams: g.teams }])),
};

export function Home({ last, onPick, onOpenHouse }: { last: GameId | null; onPick: (game: GameId) => void; onOpenHouse: (slug: string) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onPick, onOpenHouse });
  handlers.current = { onPick, onOpenHouse };

  useEffect(() => {
    const props = reactive({
      games: GAME_LIST.map((g) => ({ ...g, ...(SEATS[g.id] ?? { seats: [2, 6], teams: false }), fan: FANS[g.id] ?? FANS.spades! })),
      houses: loadMyHouses(),
      last,
      name: loadName(),
      onPick: (id: string) => handlers.current.onPick(id as GameId),
      onHouse: (slug: string) => handlers.current.onOpenHouse(slug),
    });
    const app = createApp(GameChooser, props);
    app.mount(el.current!);
    return () => app.unmount();
  }, []);

  return <main className="home" ref={el} />;
}
