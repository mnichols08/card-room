// Every game on the kit, by id. Adding a game: write its engine and list it here.
import { hearts } from "./hearts.js";
import { ohHell } from "./ohhell.js";
import { euchre } from "./euchre.js";
import { crazy8 } from "./crazy8.js";
import { gin } from "./gin.js";
import { pinochle } from "./pinochle.js";
import { canasta } from "./canasta.js";
import { goFish } from "./gofish.js";
import { oldMaid } from "./oldmaid.js";
import { war } from "./war.js";
import { whist } from "./whist.js";
import { golf } from "./golf.js";
import { rummy500 } from "./rummy500.js";
import { president } from "./president.js";
import { klondike } from "./klondike.js";
import { freeCell } from "./freecell.js";
import { handFoot } from "./handfoot.js";
import { cribbage } from "./cribbage.js";
import type { CardGame, KitGameId } from "./kit.js";

export const KIT_GAMES: CardGame<any, any, any>[] = [hearts, ohHell, euchre, crazy8, gin, pinochle, canasta, goFish, oldMaid, war, whist, golf, rummy500, president, klondike, freeCell, handFoot, cribbage];

export const kitGame = (id: unknown): CardGame<any, any, any> | undefined => KIT_GAMES.find((g) => g.id === id);
export const isKitGame = (id: unknown): id is KitGameId => KIT_GAMES.some((g) => g.id === id);
