// Table talk for bots: who they are, what they say, and how long they think.
//
// Pure: the server and the practice table both call these with the game before and after a move
// (or a chat message), and get back what each bot says and when. Bots are always gracious about
// a human's play: they cheer for a partner, tease the other side a little, and never scold.
import { cardPower, isTrump, mulberry32 } from "./cards.js";
import type { GameState } from "./game.js";
import { partnerOf, teamOf } from "./scoring.js";
import { thinkCard } from "./smart.js";
import { legalPlays } from "./tricks.js";
import type { Seat, Team } from "./types.js";

export interface Persona {
  name: string;
  /** How often they speak up (0–1), scaled per event. */
  chatty: number;
  /** How quickly they play: 1 is average, below 1 is quicker. */
  pace: number;
  lines: Partial<Record<TalkEvent, string[]>>;
}

export type TalkEvent =
  | "hello"
  | "partnerNilMade"
  | "ourNilMade"
  | "theirNilSet"
  | "ourNilSet"
  | "weGotSet"
  | "weSetThem"
  | "bigTrick"
  | "gotTrumped"
  | "spadesBroken"
  | "goingNil"
  | "goingBlindNil"
  | "weWon"
  | "theyWon"
  | "replyLaugh"
  | "replyLuck"
  | "replyThanks"
  | "replyHeart"
  | "replyOops";

export const PERSONAS: Record<string, Persona> = {
  Dot: {
    name: "Dot",
    chatty: 0.75,
    pace: 1.1,
    lines: {
      hello: ["Hi everybody! 👋", "Good luck, all! 🍀", "Let's have fun ❤️"],
      partnerNilMade: ["That's my partner! 🎉", "Beautiful nil 👏", "You did it!! 🎉"],
      ourNilMade: ["Nil made 😊", "Whew, nil made! 😅"],
      theirNilSet: ["Sorry, not sorry 😇", "Got that nil 😬"],
      ourNilSet: ["Oh no, my nil 😭", "So close 😅"],
      weGotSet: ["We'll get 'em next hand 💪", "That's okay, partner ❤️"],
      weSetThem: ["Teamwork! 🙌", "We got 'em 😊"],
      bigTrick: ["👏", "Nice one! 👏"],
      gotTrumped: ["Oh my 😮", "Well then 😅"],
      goingNil: ["Going nil 🤞", "Nil for me, cover me partner! 🙏"],
      goingBlindNil: ["Blind nil! Wish me luck 🙈"],
      weWon: ["We won!! 🎉🎉", "What a game, partner! ❤️🏆"],
      theyWon: ["Good game, everybody 🙂", "Well played! 👏"],
      replyLaugh: ["😂", "😄", "Hehe 😆"],
      replyLuck: ["You too! 🍀", "Good luck! 😊"],
      replyThanks: ["Aw, thank you! 😊", "❤️"],
      replyHeart: ["❤️", "🥰"],
      replyOops: ["It happens! ❤️", "No worries 😊"],
    },
  },
  Hank: {
    name: "Hank",
    chatty: 0.45,
    pace: 0.8,
    lines: {
      hello: ["Deal 'em.", "Let's go."],
      partnerNilMade: ["Nice nil. 👍", "Well I'll be. 👍"],
      ourNilMade: ["Told ya. 😎"],
      theirNilSet: ["Not today. 😏", "Nope. 😏"],
      ourNilSet: ["Figures. 🙄", "Ugh."],
      weGotSet: ["Ugh. 😤", "Shoulda bid less.", "😤"],
      weSetThem: ["That's how it's done. 😎", "Set. 😏"],
      bigTrick: ["😎"],
      gotTrumped: ["Really? 🙄", "Come on. 😤", "🙄"],
      spadesBroken: ["Here we go. 😑"],
      goingNil: ["Nil. Don't make it weird."],
      goingBlindNil: ["Blind nil. Yeah, I said it. 😤"],
      weWon: ["Good game. 😎", "Never in doubt."],
      theyWon: ["Good game. Rematch. 😤", "Lucky cards. 🙄 GG."],
      replyLaugh: ["Heh.", "😏"],
      replyLuck: ["Don't need it. 😎", "You too."],
      replyThanks: ["Yep. 👍"],
      replyHeart: ["👍"],
      replyOops: ["Happens. 🤷"],
    },
  },
  Lou: {
    name: "Lou",
    chatty: 0.7,
    pace: 0.95,
    lines: {
      hello: ["Who brought snacks? 🍿", "Cards, cards, cards! 🃏"],
      partnerNilMade: ["NIL BOSS 👑", "Big nil energy 🔥"],
      ourNilMade: ["Nothing to see here 😇", "Zero tricks, zero problems 😎"],
      theirNilSet: ["Oopsie 🤭", "Was that your nil? 😇"],
      ourNilSet: ["I meant to do that 🤡", "That trick jumped at me 😭"],
      weGotSet: ["Math is hard 😭", "We'll call that a warm-up 🤡"],
      weSetThem: ["Set! Set! Set! 🥳", "Spicy 🌶️"],
      bigTrick: ["🔥🔥", "Ooh 🔥"],
      gotTrumped: ["Rude 😤😂", "My poor ace 😭"],
      spadesBroken: ["Spades are out! 🎺", "♠️👀"],
      goingNil: ["Nil time 🙃", "I'll take none, thanks 😇"],
      goingBlindNil: ["Blind nil, YOLO 🙈"],
      weWon: ["Champions!! 🏆🥳", "Victory dance 💃"],
      theyWon: ["GG! I demand a rematch 😂", "Well played, you sharks 🦈"],
      replyLaugh: ["😂😂", "🤣", "LOL"],
      replyLuck: ["Luck is my middle name 🍀", "You'll need it 😜"],
      replyThanks: ["I'll be here all week 🎤", "😎"],
      replyHeart: ["❤️", "🫶"],
      replyOops: ["We've all been there 😂", "Classic 🤡"],
    },
  },
  Bea: {
    name: "Bea",
    chatty: 0.55,
    pace: 1.2,
    lines: {
      hello: ["Good luck. You'll need it 😏", "Let's play."],
      partnerNilMade: ["Yes! Great nil 👏", "Clutch 🔥"],
      ourNilMade: ["Nil made. ✅"],
      theirNilSet: ["Got it. 😈", "Nil denied. 😈"],
      ourNilSet: ["Argh. 😤", "That one hurt 😣"],
      weGotSet: ["Hmph. Next hand. 😤", "We'll make it up."],
      weSetThem: ["Set! 😈", "Exactly as planned 😏"],
      bigTrick: ["💪", "Mine 😏"],
      gotTrumped: ["Bold. 😒", "Noted. 😒"],
      spadesBroken: ["Finally. ♠️"],
      goingNil: ["Nil. Cover me. 🤞"],
      goingBlindNil: ["Blind nil. Let's go. 😤"],
      weWon: ["Yes! 🏆", "Good game. We earned that. 😎"],
      theyWon: ["Good game. Well played. 👏", "GG. Next time. 😤"],
      replyLaugh: ["😄", "Ha 😏"],
      replyLuck: ["Thanks, you too 🍀", "Luck has nothing to do with it 😏"],
      replyThanks: ["Thanks 😊"],
      replyHeart: ["😊"],
      replyOops: ["Shake it off 👍"],
    },
  },
};

/** The persona for a bot's name, or a pleasant default for any other name. */
export function personaFor(name: string): Persona {
  return PERSONAS[name] ?? { ...PERSONAS.Dot!, name, chatty: 0.5 };
}

export interface Remark {
  seat: Seat;
  text: string;
  /** Wait this long (ms) after the event before saying it, as a person would. */
  delay: number;
}

type Rand = () => number;
const pick = <T>(list: T[], rand: Rand): T => list[Math.floor(rand() * list.length)]!;

/** One bot says something about an event, if their mood (and the dice) say so. */
function line(seat: Seat, name: string, event: TalkEvent, weight: number, rand: Rand, delay: [number, number] = [700, 1800]): Remark | null {
  const persona = personaFor(name);
  const options = persona.lines[event];
  if (!options?.length || rand() > persona.chatty * weight) return null;
  return { seat, text: pick(options, rand), delay: delay[0] + rand() * (delay[1] - delay[0]) };
}

export interface TableCast {
  /** Bot seats and their names. Humans aren't listed: they speak for themselves. */
  bots: { seat: Seat; name: string }[];
}

/**
 * What the bots say about one move: `before` and `after` are the game around it. At most two bots
 * speak about one move, so a table never turns into a chorus.
 */
export function reactToMove(before: GameState, after: GameState, cast: TableCast, rand: Rand = Math.random): Remark[] {
  const remarks: Remark[] = [];
  const say = (seat: Seat, name: string, event: TalkEvent, weight: number, delay?: [number, number]) => {
    const r = line(seat, name, event, weight, rand, delay);
    if (r) remarks.push(r);
  };

  // A bot's own bid.
  if (after.handNumber === before.handNumber) {
    for (const bot of cast.bots) {
      const was = before.bids[bot.seat];
      const now = after.bids[bot.seat];
      if (!was && now?.kind === "nil") say(bot.seat, bot.name, "goingNil", 0.8, [300, 900]);
      if (!was && now?.kind === "blind-nil") say(bot.seat, bot.name, "goingBlindNil", 1.2, [300, 900]);
    }
  }

  // A trick was taken.
  const trickDone = after.lastTrick && JSON.stringify(after.lastTrick) !== JSON.stringify(before.lastTrick);
  if (trickDone && after.lastTrick) {
    const { plays, winner } = after.lastTrick;
    const led = plays[0]!.card;
    for (const bot of cast.bots) {
      const mine = plays.find((p) => p.seat === bot.seat);
      // Their ace (or king) of a side suit got trumped by the other side.
      const trumpedBy = isTrump(plays.find((p) => p.seat === winner)!.card, after.preset) && teamOf(winner) !== teamOf(bot.seat);
      if (mine && trumpedBy && !isTrump(mine.card, after.preset) && cardPower(mine.card, after.preset) >= 13) say(bot.seat, bot.name, "gotTrumped", 0.8);
    }
    // A bot taking a trick with something flashy now and then.
    const winningBot = cast.bots.find((b) => b.seat === winner);
    if (winningBot && remarks.length === 0) {
      const card = plays.find((p) => p.seat === winner)!.card;
      const flashy = isTrump(card, after.preset) && !isTrump(led, after.preset);
      if (flashy) say(winningBot.seat, winningBot.name, "bigTrick", 0.25);
    }
    // Spades broken for the first time.
    if (!before.spadesBroken && after.spadesBroken) {
      const b = cast.bots[Math.floor(rand() * cast.bots.length)];
      if (b && remarks.length === 0) say(b.seat, b.name, "spadesBroken", 0.3);
    }
  }

  // A hand was scored.
  if (after.history.length > before.history.length) {
    const record = after.history[after.history.length - 1]!;
    const nilOf = (seat: Seat) => {
      const bid = record.bids[seat];
      if (bid?.kind !== "nil" && bid?.kind !== "blind-nil") return null;
      return record.tricksWon[seat] === 0 ? "made" : "set";
    };
    for (const bot of cast.bots) {
      const us = teamOf(bot.seat);
      const partner = partnerOf(bot.seat);
      const result = record.results[us];
      const theirs = record.results[(1 - us) as Team];
      const opponents = ([0, 1, 2, 3] as Seat[]).filter((x) => teamOf(x) !== us);
      if (nilOf(partner) === "made") say(bot.seat, bot.name, "partnerNilMade", 1.3, [600, 1400]);
      else if (nilOf(bot.seat) === "made") say(bot.seat, bot.name, "ourNilMade", 1.0);
      else if (nilOf(bot.seat) === "set") say(bot.seat, bot.name, "ourNilSet", 1.0);
      else if (opponents.some((o) => nilOf(o) === "set")) say(bot.seat, bot.name, "theirNilSet", 0.7);
      else if (result.made === false) say(bot.seat, bot.name, "weGotSet", 0.8);
      else if (theirs.made === false) say(bot.seat, bot.name, "weSetThem", 0.8);
    }
  }

  // The game ended: everyone says something, winners first.
  if (after.phase === "finished" && before.phase !== "finished") {
    remarks.length = 0;
    for (const bot of cast.bots) {
      const won = teamOf(bot.seat) === after.winner;
      const r = line(bot.seat, bot.name, won ? "weWon" : "theyWon", 2, rand, won ? [500, 1200] : [1300, 2600]);
      if (r) remarks.push(r);
    }
    return remarks;
  }

  // Never more than two voices at once; stagger them.
  return remarks.slice(0, 2).map((r, i) => ({ ...r, delay: r.delay + i * 900 }));
}

/** What the bots say when the table starts: one hello, maybe two. */
export function greet(cast: TableCast, rand: Rand = Math.random): Remark[] {
  return cast.bots
    .map((b) => line(b.seat, b.name, "hello", 0.8, rand, [800, 2500]))
    .filter((r): r is Remark => r !== null)
    .slice(0, 2)
    .map((r, i) => ({ ...r, delay: r.delay + i * 1100 }));
}

/**
 * Bots answer a person's chat: laughter with laughter, luck with luck, thanks with warmth, a heart
 * with a heart. A bot named in the message is the one who answers. At most one bot replies.
 */
export function replyTo(text: string, fromSeat: Seat, cast: TableCast, rand: Rand = Math.random): Remark[] {
  const t = text.toLowerCase();
  const event: TalkEvent | null = /😂|🤣|😆|😄|\blol\b|\bhaha|\blmao\b/.test(t)
    ? "replyLaugh"
    : /good luck|\bgl\b|🍀|🤞/.test(t)
      ? "replyLuck"
      : /thank|nice|good job|great|👏|well played|\bgj\b/.test(t)
        ? "replyThanks"
        : /❤️|♥|🥰|😘|love/.test(t)
          ? "replyHeart"
          : /oops|sorry|my bad|😬|😭/.test(t)
            ? "replyOops"
            : null;
  if (!event) return [];
  const named = cast.bots.find((b) => t.includes(b.name.toLowerCase()));
  const partnerBot = cast.bots.find((b) => b.seat === partnerOf(fromSeat));
  const candidates = named ? [named] : partnerBot ? [partnerBot, ...cast.bots.filter((b) => b !== partnerBot)] : cast.bots;
  for (const bot of candidates) {
    const r = line(bot.seat, bot.name, event, named ? 3 : bot === partnerBot ? 1.3 : 0.8, rand, [900, 2200]);
    if (r) return [r];
  }
  return [];
}

/**
 * How long a bot takes over its move, in ms, like a person: a forced card is quick, a bid takes a
 * moment, and a close call takes longer. Persona sets the tempo. Seeded, so it's the same each time.
 */
export function thinkingTime(s: GameState, seat: Seat, name: string, rand: Rand = mulberry32((s.seed ^ (s.played?.length ?? 0) ^ (seat << 8)) >>> 0)): number {
  const pace = personaFor(name).pace;
  const jitter = 0.8 + rand() * 0.5;
  if (s.phase === "bidding") return Math.round((1800 + rand() * 2200) * pace * jitter);
  if (s.phase === "passing") return Math.round(2200 * pace * jitter);
  if (s.phase !== "playing") return 600;
  const legal = legalPlays(s.hands[seat]!, s.trick, s.spadesBroken, s.preset);
  if (legal.length === 1) return Math.round((550 + rand() * 450) * pace);
  // How close the decision was: the gap between the best and second-best option.
  const { scores } = thinkCard(s, seat, { deals: 12 });
  const sorted = scores.map((x) => x.score).sort((a, b) => b - a);
  const gap = sorted.length > 1 ? sorted[0]! - sorted[1]! : 99;
  const hard = gap < 3 ? 1 : gap < 10 ? 0.55 : 0.2;
  const leading = s.trick.length === 0 ? 400 : 0;
  return Math.round((900 + leading + hard * 2200) * pace * jitter);
}
