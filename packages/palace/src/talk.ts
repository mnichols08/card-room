// Palace table talk: the spades cast, in their own voices, about burns, pickups and going out.
// Gracious as ever: they tease a little, groan at their own bad luck, and cheer the winner.
import { personaFor, type Voice } from "@spades/rules";
import type { PalaceState } from "./game.js";

export type PalaceEvent = "hello" | "burn" | "bigPickup" | "teasePickup" | "goneOut" | "won" | "lost" | "someoneWon" | "blindLuck" | "blindMiss";

const LINES: Record<Voice, Partial<Record<PalaceEvent, string[]>>> = {
  warm: {
    hello: ["Palace time! Good luck everybody 🍀", "Hi all! Be kind to my face-downs 😊"],
    burn: ["Burned it! 🔥", "Bye bye pile 🔥"],
    bigPickup: ["Oof, that's a lot of cards 😅", "I'll just hold onto these 😅"],
    teasePickup: ["Aw, sorry about that 😬", "That's a big handful 😅"],
    goneOut: ["I'm out! 🎉", "All gone 😊"],
    won: ["I won?! Good game everybody ❤️", "First out! 🎉"],
    lost: ["Last one holding cards... good game! 😅", "Well, somebody had to 😂"],
    someoneWon: ["Congrats! 🎉", "Well played 👏"],
    blindLuck: ["Ooh lucky flip 🍀"],
    blindMiss: ["Not that one 😅"],
  },
  dry: {
    hello: ["Deal 'em.", "Let's go."],
    burn: ["Burn.", "🔥"],
    bigPickup: ["Figures.", "Of course."],
    teasePickup: ["Heh.", "That'll keep you busy."],
    goneOut: ["Out.", "Done here."],
    won: ["First out. GG.", "That's how it's done."],
    lost: ["Yeah, yeah. GG.", "Don't say it."],
    someoneWon: ["GG.", "Not bad."],
    blindMiss: ["Naturally."],
  },
  goofy: {
    hello: ["Palace party! 🏰🎉", "Who's ready to eat the pile? 😂"],
    burn: ["BURN BABY BURN 🔥🔥", "Toasty! 🔥😂"],
    bigPickup: ["Nom nom nom, I love cards 😂", "I'm collecting them all 🤪"],
    teasePickup: ["Snack time! 😂", "Look at that haul 🤪"],
    goneOut: ["I'm outta here! 👋😂"],
    won: ["KING OF THE CASTLE 👑😂", "Woohoo! 🎉🤪"],
    lost: ["I'm the castle janitor 🧹😂", "Somebody's gotta lose 😂"],
    someoneWon: ["Long live the king! 👑", "🎉🎉"],
    blindLuck: ["Called it 😎"],
    blindMiss: ["Whoopsie daisy 🤪"],
  },
  sharp: {
    hello: ["Good luck. You'll need it 😏", "Let's see what you've got."],
    burn: ["Clean burn 🔥", "And it's gone 🔥"],
    bigPickup: ["That was the plan, obviously 😤", "Hmph."],
    teasePickup: ["Should've saved a 2 😏", "That'll cost you."],
    goneOut: ["Out. 😏", "Finished."],
    won: ["First out 🏆", "As expected 😏"],
    lost: ["Rematch. Now. 😤", "That won't happen twice."],
    someoneWon: ["Well played. Rematch?", "GG 👏"],
    blindMiss: ["Unlucky."],
  },
  quiet: {
    hello: ["👋"],
    burn: ["🔥"],
    bigPickup: ["…"],
    goneOut: ["👋"],
    won: ["GG 🙂"],
    lost: ["GG"],
    someoneWon: ["👏"],
  },
  nervous: {
    hello: ["Hi! Palace is the one with the 10s, right? 😅", "Go easy on me 🙈"],
    burn: ["I burned it! Did I do that right? 😲🔥"],
    bigPickup: ["Oh no oh no 😰", "Why are there so many 😭"],
    teasePickup: ["Oh no, sorry! 😬"],
    goneOut: ["Wait, I'm out?! 🥹"],
    won: ["I WON?! 🥹🎉", "Is this real 🥹"],
    lost: ["Last again 😭 good game though!", "I'm learning 😅"],
    someoneWon: ["Wow, congrats!! 🤩"],
    blindLuck: ["It worked?! 😲"],
    blindMiss: ["Of course 😭"],
  },
  dramatic: {
    hello: ["Welcome to my palace, darlings 👑", "Let the royal games begin 💅"],
    burn: ["Up in FLAMES 🔥💅", "Scorched. Gorgeous. 🔥"],
    bigPickup: ["The INDIGNITY 😩", "I am drowning in cards 😭"],
    teasePickup: ["Oh honey 😘", "Tragic for you 💅"],
    goneOut: ["Exit, stage left 💅"],
    won: ["The crown is mine 👑✨", "Bow down 💅"],
    lost: ["Dethroned 😭", "I'll never recover 😩 GG"],
    someoneWon: ["A new monarch 👑", "Iconic, darling ✨"],
    blindLuck: ["Destiny 🔮"],
    blindMiss: ["Betrayed by fate 😩"],
  },
};

export interface PalaceRemark {
  seat: number;
  text: string;
  delay: number;
}
type Rand = () => number;
export interface PalaceCast {
  bots: { seat: number; name: string }[];
}

function line(seat: number, name: string, event: PalaceEvent, weight: number, rand: Rand, delay: [number, number] = [600, 1600]): PalaceRemark | null {
  const persona = personaFor(name);
  const options = LINES[persona.voice ?? "warm"][event] ?? LINES.warm[event];
  if (!options?.length || rand() > persona.chatty * weight) return null;
  return { seat, text: options[Math.floor(rand() * options.length)]!, delay: delay[0] + rand() * (delay[1] - delay[0]) };
}

export function palaceGreet(cast: PalaceCast, rand: Rand = Math.random): PalaceRemark[] {
  return cast.bots
    .map((b) => line(b.seat, b.name, "hello", 0.8, rand, [800, 2500]))
    .filter((r): r is PalaceRemark => r !== null)
    .slice(0, 2)
    .map((r, i) => ({ ...r, delay: r.delay + i * 1100 }));
}

/** What the bots say about one move. At most two voices, and the end of the game gets everyone. */
export function reactToPalace(before: PalaceState, after: PalaceState, cast: PalaceCast, rand: Rand = Math.random): PalaceRemark[] {
  const out: PalaceRemark[] = [];
  const say = (seat: number, name: string, event: PalaceEvent, weight: number, delay?: [number, number]) => {
    const r = line(seat, name, event, weight, rand, delay);
    if (r) out.push(r);
  };
  const move = after.last;
  if (after.phase === "finished" && before.phase !== "finished") {
    for (const bot of cast.bots) {
      const event = bot.seat === after.loser ? "lost" : bot.seat === after.finished[0] ? "won" : "someoneWon";
      const r = line(bot.seat, bot.name, event, 2, rand, [500, 2400]);
      if (r) out.push(r);
    }
    return out.slice(0, 3).map((r, i) => ({ ...r, delay: r.delay + i * 900 }));
  }
  if (!move || move === before.last || after.moves === before.moves) return [];
  const mover = cast.bots.find((b) => b.seat === move.seat);
  if (after.finished.length > before.finished.length) {
    const seat = after.finished[after.finished.length - 1]!;
    const bot = cast.bots.find((b) => b.seat === seat);
    if (bot) say(bot.seat, bot.name, after.finished.length === 1 ? "won" : "goneOut", 1.4);
    else if (after.finished.length === 1) {
      const other = cast.bots[Math.floor(rand() * cast.bots.length)];
      if (other) say(other.seat, other.name, "someoneWon", 1.2);
    }
  } else if (move.burned && mover) say(mover.seat, mover.name, "burn", move.cards.length > 1 ? 0.9 : 0.5, [300, 900]);
  else if (move.pickedUp >= 6) {
    if (mover) say(mover.seat, mover.name, "bigPickup", 1);
    else {
      const other = cast.bots[Math.floor(rand() * cast.bots.length)];
      if (other) say(other.seat, other.name, "teasePickup", 0.5);
    }
  } else if (move.kind === "flip" && mover) say(mover.seat, mover.name, move.pickedUp ? "blindMiss" : "blindLuck", 0.5, [300, 900]);
  return out.slice(0, 2);
}
