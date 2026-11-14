// The Card Room's start page: the Vue game chooser, mounted inside the React app.
import { isBoardGame, KIT_GAMES } from "@cardroom/games";
import { createApp, h, reactive } from "vue";
import { useEffect, useRef } from "react";
import { GAME_LIST } from "../GamePicker";
import { lobby, whoIsThere, type OpenTable } from "../lobbyApi";
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
  spider: [card(13, "spades"), card(12, "spades"), card(11, "spades")],
  pyramid: [card(6, "hearts"), card(7, "clubs"), card(13, "diamonds")],
  ridethebus: [card(5, "hearts"), card(9, "spades"), card(12, "clubs")],
  kingscup: [card(13, "hearts"), card(13, "spades"), card(13, "diamonds")],
  horserace: [card(14, "hearts"), card(14, "spades"), card(14, "clubs")],
  drinkingpyramid: [card(9, "hearts"), card(9, "clubs"), card(4, "spades")],
};

/** A board game's tile shows a little board instead: a position that says what the game is about. */
type MiniBoard = { cols: number; cells: ({ glyph: string; tone: string; shade?: "dark" } | null)[]; shade?: "green" };
const X = { glyph: "✕", tone: "red" };
const O = { glyph: "◯", tone: "blue" };
const DARK = { glyph: "●", tone: "dark" };
const LIGHT = { glyph: "●", tone: "light" };
const SHIP = { glyph: "■", tone: "dark" };
const HIT = { glyph: "✕", tone: "red" };
const MISS = { glyph: "•", tone: "blue" };
const RED = { glyph: "●", tone: "red" };
const YEL = { glyph: "●", tone: "gold" };
// Checkers: a corner of the board, played on the dark squares.
const SQUARE = { glyph: "", tone: "none", shade: "dark" as const };
const MAN_DARK = { ...SQUARE, glyph: "●", tone: "dark" };
const MAN_LIGHT = { ...SQUARE, glyph: "●", tone: "light" };
const KING_DARK = { ...SQUARE, glyph: "♛", tone: "dark" };
const BOARDS: Record<string, MiniBoard> = {
  tictactoe: { cols: 3, cells: [X, O, null, null, X, O, O, null, X] },
  // The bottom of a rack: red about to make four on the slant.
  dropfour: { cols: 4, cells: [null, null, null, null, null, null, RED, YEL, null, RED, YEL, RED, RED, YEL, YEL, RED] },
  combat: { cols: 4, cells: [SHIP, SHIP, SHIP, null, null, null, MISS, null, MISS, null, HIT, null, null, null, HIT, null] },
  // Light to move: c1 traps the dark disc beside it.
  reversi: { cols: 4, shade: "green", cells: [null, null, null, null, null, DARK, LIGHT, null, DARK, DARK, DARK, null, null, null, LIGHT, null] },
  checkers: { cols: 4, cells: [null, MAN_LIGHT, null, MAN_LIGHT, SQUARE, null, KING_DARK, null, null, MAN_LIGHT, null, SQUARE, MAN_DARK, null, MAN_DARK, null] },
};
const EMPTY_BOARD: MiniBoard = { cols: 3, cells: Array(9).fill(null) };

const SEATS: Record<string, { seats: [number, number]; teams: boolean }> = {
  spades: { seats: [4, 4], teams: true },
  palace: { seats: [2, 6], teams: false },
  ...Object.fromEntries(KIT_GAMES.map((g) => [g.id, { seats: [g.seats.min, g.seats.max] as [number, number], teams: g.teams }])),
};

/** An open table as the front page shows it: one line. */
const brief = (t: OpenTable) => ({ id: t.id, game: t.game, who: whoIsThere(t), free: t.free });

export function Home({ last, onPick, onOpenHouse, onLobby }: { last: GameId | null; onPick: (game: GameId) => void; onOpenHouse: (slug: string) => void; onLobby: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onPick, onOpenHouse, onLobby });
  handlers.current = { onPick, onOpenHouse, onLobby };

  useEffect(() => {
    const props = reactive({
      games: GAME_LIST.map((g) => ({ ...g, ...(SEATS[g.id] ?? { seats: [2, 6], teams: false }), fan: FANS[g.id] ?? FANS.spades!, board: isBoardGame(g.id) ? (BOARDS[g.id] ?? EMPTY_BOARD) : undefined })),
      houses: loadMyHouses(),
      last,
      name: loadName(),
      onPick: (id: string) => handlers.current.onPick(id as GameId),
      onHouse: (slug: string) => handlers.current.onOpenHouse(slug),
      // Tables waiting for players, kept fresh while the page is in front.
      open: [] as ReturnType<typeof brief>[],
      onLobby: () => handlers.current.onLobby(),
    });
    // Rendered from the reactive props, so the chooser follows them when the open tables change.
    const app = createApp({ render: () => h(GameChooser, { ...props }) });
    app.mount(el.current!);
    const load = () => {
      if (document.visibilityState === "hidden") return;
      lobby.list().then((tables) => (props.open = tables.map(brief)), () => undefined);
    };
    load();
    const timer = setInterval(load, 8000);
    document.addEventListener("visibilitychange", load);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
      app.unmount();
    };
  }, []);

  return <main className="home" ref={el} />;
}
