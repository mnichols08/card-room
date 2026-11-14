// Table talk for the kit games: the same cast, in their own voices, saying hello and reacting
// when a game ends. (Answers to people's chat come from the shared reply lines.)
import { personaFor, type Voice } from "@spades/rules";
import type { KitGameId, KitSummary } from "./kit.js";
import { isBoardGame } from "./registry.js";

type Event = "hello" | "won" | "lost" | "someoneWon";

const LINES: Record<Voice, Partial<Record<Event, string[]>>> = {
  warm: { hello: ["Hi everybody! Good luck 🍀", "Ooh, a new game. Be nice to me 😊"], won: ["I won?! Good game everybody ❤️"], lost: ["Good game! I'll get you next time 😅"], someoneWon: ["Congrats! 🎉", "Well played 👏"] },
  dry: { hello: ["Deal 'em.", "Let's go."], won: ["GG.", "That's how it's done."], lost: ["Yeah, yeah. GG."], someoneWon: ["GG.", "Not bad."] },
  goofy: { hello: ["Card party! 🎉", "Who's ready to lose to me? 😂"], won: ["WINNER WINNER 🍗😂", "Woohoo! 🎉🤪"], lost: ["I meant to do that 😂"], someoneWon: ["🎉🎉", "Bow down! 👑😂"] },
  sharp: { hello: ["Good luck. You'll need it 😏"], won: ["As expected 😏", "🏆"], lost: ["Rematch. Now. 😤"], someoneWon: ["Well played. Rematch?"] },
  quiet: { hello: ["👋"], won: ["GG 🙂"], lost: ["GG"], someoneWon: ["👏"] },
  nervous: { hello: ["Oh gosh, okay, here we go 😬"], won: ["Wait, I won?? 😳🎉"], lost: ["I knew it 😩"], someoneWon: ["Congrats! You earned it 👏"] },
  dramatic: { hello: ["Let the games BEGIN 🎭"], won: ["VICTORY IS MINE 🏆✨"], lost: ["Betrayed by the cards 😩"], someoneWon: ["A worthy champion 👑"] },
};

/** At a board there are no cards to deal or blame: these stand in for the lines that mention them. */
const BOARD_LINES: Partial<Record<Voice, Partial<Record<Event, string[]>>>> = {
  dry: { hello: ["Your move.", "Let's go."] },
  goofy: { hello: ["Game time! 🎉", "Who's ready to lose to me? 😂"] },
  dramatic: { lost: ["Outplayed. For now 😩"] },
};

export interface KitRemark {
  seat: number;
  text: string;
  delay: number;
}
type Cast = { bots: { seat: number; name: string }[] };
type Rand = () => number;

function line(seat: number, name: string, event: Event, weight: number, rand: Rand, delay: [number, number], game?: KitGameId): KitRemark | null {
  const persona = personaFor(name);
  const voice = persona.voice ?? "warm";
  const options = (isBoardGame(game) ? BOARD_LINES[voice]?.[event] : undefined) ?? LINES[voice][event] ?? LINES.warm[event];
  if (!options?.length || rand() > persona.chatty * weight) return null;
  return { seat, text: options[Math.floor(rand() * options.length)]!, delay: delay[0] + rand() * (delay[1] - delay[0]) };
}

export function kitGreet(cast: Cast, rand: Rand = Math.random, game?: KitGameId): KitRemark[] {
  return cast.bots
    .map((b) => line(b.seat, b.name, "hello", 0.8, rand, [800, 2500], game))
    .filter((r): r is KitRemark => r !== null)
    .slice(0, 2)
    .map((r, i) => ({ ...r, delay: r.delay + i * 1100 }));
}

/** When a game has just ended: the winners cheer, the rest congratulate. */
export function reactToKit(before: KitSummary, after: KitSummary, cast: Cast, rand: Rand = Math.random): KitRemark[] {
  if (!after.over || before.over) return [];
  const out = cast.bots
    .map((b) => line(b.seat, b.name, after.winners?.includes(b.seat) ? "won" : after.order?.at(-1) === b.seat ? "lost" : "someoneWon", 2, rand, [500, 2400], after.game))
    .filter((r): r is KitRemark => r !== null);
  return out.slice(0, 3).map((r, i) => ({ ...r, delay: r.delay + i * 900 }));
}
