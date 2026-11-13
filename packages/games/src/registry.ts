// Every game on the kit, by id. Adding a game: write its engine and list it here.
import { hearts } from "./hearts.js";
import type { CardGame, KitGameId } from "./kit.js";

export const KIT_GAMES: CardGame<any, any, any>[] = [hearts];

export const kitGame = (id: unknown): CardGame<any, any, any> | undefined => KIT_GAMES.find((g) => g.id === id);
export const isKitGame = (id: unknown): id is KitGameId => KIT_GAMES.some((g) => g.id === id);
