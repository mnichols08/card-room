// Table talk for bots: who they are, what they say, and how long they think.
//
// Pure: the server and the practice table both call these with the game before and after a move
// (or a chat message), and get back what each bot says and when. Bots are always gracious about
// a human's play: they cheer for a partner, tease the other side a little, and never scold.
import { cardPower, isTrump, mulberry32 } from "./cards.js";
import type { GameState } from "./game.js";
import { partnerOf, teamOf } from "./scoring.js";
import { thinkCard, type PlayStyle } from "./smart.js";
import { legalPlays } from "./tricks.js";
import type { Seat, Team } from "./types.js";

export interface Persona {
  name: string;
  /** Their way of talking. Other games give each voice their own lines. */
  voice: Voice;
  /** One line about them, for the lobby. */
  blurb: string;
  /** How often they speak up (0–1), scaled per event. */
  chatty: number;
  /** How quickly they play: 1 is average, below 1 is quicker. */
  pace: number;
  /** How they play: some are sharp, some careless, some bold, some nil-crazy. */
  style: PlayStyle;
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

type Lines = Partial<Record<TalkEvent, string[]>>;
type Rand = () => number;

/** Shared voices. A persona takes one and adds lines of its own. */
export type Voice = "warm" | "dry" | "goofy" | "sharp" | "quiet" | "nervous" | "dramatic";

const VOICES: Record<Voice, Lines> = {
  warm: {
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
  dry: {
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
  goofy: {
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
  sharp: {
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
  quiet: {
    hello: ["👋"],
    partnerNilMade: ["👏"],
    ourNilMade: ["😌"],
    theirNilSet: ["🙂"],
    ourNilSet: ["😑"],
    weGotSet: ["Hm."],
    weSetThem: ["👍"],
    weWon: ["Good game. 🙂"],
    theyWon: ["Good game."],
    replyLaugh: ["🙂"],
    replyLuck: ["You too."],
    replyThanks: ["🙂"],
    replyHeart: ["🙂"],
    replyOops: ["👍"],
  },
  nervous: {
    hello: ["Hi! Go easy on me 😅", "I'm still learning, be nice 🙈"],
    partnerNilMade: ["Wow!! You're so good 🤩", "Teach me that 🤩"],
    ourNilMade: ["Wait, it worked?! 😲", "I did it?! 🥹"],
    theirNilSet: ["Oh! Sorry! 😬", "Was that me? 😬"],
    ourNilSet: ["Sorry partner 😭", "I panicked 😰"],
    weGotSet: ["That was my fault, sorry 😣", "Oops, sorry partner 🙈"],
    weSetThem: ["Did we do that? 😲", "Yay?? 🥹"],
    bigTrick: ["Oh! I won one 😲"],
    gotTrumped: ["Ah! 😰", "I didn't see that coming 😵"],
    goingNil: ["Trying a nil... 😬", "Nil? Is that right? 😅"],
    goingBlindNil: ["Blind nil?! Why did I do that 😱"],
    weWon: ["WE WON?! 🥹🎉", "Best partner ever 🥹"],
    theyWon: ["Good game! I learned a lot 😅", "GG! Sorry partner 🙈"],
    replyLaugh: ["😅", "Hehe 😅"],
    replyLuck: ["I'll need it 😅", "Thanks!! 🍀"],
    replyThanks: ["Really?! Thank you 🥹", "🥹"],
    replyHeart: ["🥹❤️"],
    replyOops: ["Phew, it's not just me 😅", "We're even 😅"],
  },
  dramatic: {
    hello: ["Darlings, let's play 💅", "The queen of cards has arrived 👑"],
    partnerNilMade: ["ICONIC 💅✨", "A masterpiece 😭✨"],
    ourNilMade: ["Flawless. 💅", "As if there was doubt ✨"],
    theirNilSet: ["Tragic for you 💅", "Oh honey 😘"],
    ourNilSet: ["Betrayed by the cards 😩", "I'll never recover 😭"],
    weGotSet: ["The DRAMA 😩", "I need a moment 😭"],
    weSetThem: ["Delicious 😈", "As foretold 🔮"],
    bigTrick: ["✨", "Gorgeous ✨"],
    gotTrumped: ["How DARE you 😱", "The audacity 😤"],
    spadesBroken: ["Chaos has begun 😈", "Here comes trouble ♠️"],
    goingNil: ["Nil. Watch and learn 💅"],
    goingBlindNil: ["BLIND NIL. Gasp all you want 😱"],
    weWon: ["We're legends 👑✨", "Bow down 💅🏆"],
    theyWon: ["I'm devastated. Good game 😭", "This isn't over 😤 GG"],
    replyLaugh: ["😂💅", "Stop it 😂"],
    replyLuck: ["Luck is for amateurs 💅", "Thank you, darling 😘"],
    replyThanks: ["I know 💅", "Thank you, darling 😘"],
    replyHeart: ["😘", "💖"],
    replyOops: ["It's giving chaos 😂", "Forgiven, darling 😘"],
  },
};

const persona = (
  name: string,
  blurb: string,
  voice: keyof typeof VOICES,
  chatty: number,
  pace: number,
  style: PlayStyle,
  extra: Lines = {},
): Persona => {
  const lines: Lines = { ...VOICES[voice] };
  for (const [event, more] of Object.entries(extra) as [TalkEvent, string[]][]) lines[event] = [...more, ...(lines[event] ?? [])];
  return { name, blurb, voice, chatty, pace, style, lines };
};

/** Everyone who can take a seat. Some are sharp, some are careless; all are good company. */
export const PERSONAS: Record<string, Persona> = Object.fromEntries(
  [
    persona("Dot", "Warm and steady; she'll cover your nil", "warm", 0.75, 1.1, { skill: 0.9 }),
    persona("Hank", "Grumbles, plays fast, plays well", "dry", 0.45, 0.8, { skill: 1, bold: -0.2 }),
    persona("Lou", "Jokes around and overbids a little", "goofy", 0.7, 0.95, { skill: 0.7, bold: 0.3, sloppy: 0.05 }),
    persona("Bea", "Competitive; thinks every card through", "sharp", 0.55, 1.2, { skill: 1 }),
    persona("Maggie", "Counts every card. Says little.", "sharp", 0.35, 1.15, { skill: 1, bold: -0.1 }, { hello: ["I'm counting. 🧮"] }),
    persona("Earl", "Old school; bids low and hates nil", "dry", 0.4, 1.3, { skill: 0.75, bold: -0.8, nilLove: 0.1 }, { weGotSet: ["Told you to bid low."], hello: ["Bid what you've got. That's all."] }),
    persona("Tammy", "Never met a nil she didn't like", "warm", 0.8, 1.0, { skill: 0.6, nilLove: 0.9 }, { goingNil: ["Nil again! You know me 😜"], hello: ["Who's ready for some nils? 😜"] }),
    persona("Junior", "Still learning; makes mistakes, means well", "nervous", 0.7, 1.35, { skill: 0.2, sloppy: 0.45, bold: 0.2 }),
    persona("Pearl", "Sweet as pie and sharp as a tack", "warm", 0.5, 1.25, { skill: 0.85 }, { hello: ["Hello, dears 🥰"], weWon: ["Well isn't that nice 🥰"] }),
    persona("Duke", "Bids big, goes blind, lives loud", "goofy", 0.75, 0.85, { skill: 0.45, bold: 1, nilLove: 0.85, sloppy: 0.15 }, { hello: ["Go big or go home 🤠"], weGotSet: ["Worth it 🤠"] }),
    persona("Ruthie", "Hates bags; plays tight and tidy", "sharp", 0.45, 1.1, { skill: 0.85, bold: -0.3 }, { weSetThem: ["No bags, no mercy 😏"], hello: ["No bags today, please."] }),
    persona("Skeeter", "Goofball; plays fast and loose", "goofy", 0.85, 0.75, { skill: 0.3, sloppy: 0.3, bold: 0.5 }, { hello: ["Skeeter's here! 🦟"], gotTrumped: ["Ow! 🦟"] }),
    persona("Vern", "Quiet. Very good. Very quiet.", "quiet", 0.15, 1.0, { skill: 1 }),
    persona("Gigi", "Dramatic; plays by feel", "dramatic", 0.8, 1.05, { skill: 0.5, sloppy: 0.12, nilLove: 0.6 }),
  ].map((p) => [p.name, p]),
);

/** Pick `n` different personas at random, for empty seats. */
export function pickPersonas(n: number, rand: Rand = Math.random, exclude: string[] = []): Persona[] {
  const pool = Object.values(PERSONAS).filter((p) => !exclude.includes(p.name));
  const chosen: Persona[] = [];
  while (chosen.length < n && pool.length) chosen.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]!);
  return chosen;
}

/** The persona for a bot's name, or a pleasant default for any other name. */
export function personaFor(name: string): Persona {
  return PERSONAS[name] ?? { ...PERSONAS.Dot!, name, blurb: "", chatty: 0.5 };
}

export interface Remark {
  seat: Seat;
  text: string;
  /** Wait this long (ms) after the event before saying it, as a person would. */
  delay: number;
}

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
