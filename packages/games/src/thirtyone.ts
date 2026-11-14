// Thirty-One (also Scat, or Blitz): three cards each. On your turn draw from the stock or take the top
// discard, then throw one away. You're after the highest total in one suit: aces 11, faces 10, the
// rest face value, 31 at best. Happy with your hand? Knock instead of drawing: everyone else gets one
// more turn, then the lowest hand loses a life. Hit 31 and everyone else loses one at once. Lose all
// your lives and you're out; the last one left wins.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  markReady,
  nextRandom,
  rankSeats,
  shuffled,
  sortCards,
  SUITS,
  SYMBOL,
  thinkFor,
  who,
  withDrinking,
  withDrinks,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type Meld,
} from "./kit.js";

export interface ThirtyOneRules extends BaseRules {
  lives: number;
  /** Three of a kind counts 30½. */
  trips: boolean;
  /** A knocker with the lowest hand loses two lives. */
  knockerPays: boolean;
  /** Drinking mode, a house rule: see the game's describe(). */
  drinking?: boolean;
}

export const classicThirtyOne: ThirtyOneRules = { id: "31-classic", name: "Thirty-One (3 lives)", lives: 3, trips: true, knockerPays: true };
export const longThirtyOne: ThirtyOneRules = { ...classicThirtyOne, id: "31-long", name: "Longer (4 lives)", lives: 4 };
export const plainThirtyOne: ThirtyOneRules = { ...classicThirtyOne, id: "31-plain", name: "Suits only", trips: false, knockerPays: false };

export interface ThirtyOneState {
  game: "thirtyone";
  rules: ThirtyOneRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  lives: number[];
  /** The hand number each seat went out on, for the final order. */
  outAt: (number | null)[];
  hands: KCard[][];
  stock: KCard[];
  discard: KCard[];
  turn: number;
  phase: "draw" | "discard" | "reveal" | "finished";
  /** The card just taken from the discards: it can't go straight back. */
  taken: string | null;
  knocker: number | null;
  /** Turns played this round, so computer players knock sooner as it drags on. */
  turns: number;
  /** Who lost lives at the last showdown, and how many. */
  lost: number[];
  ready: boolean[];
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const suitOf = (c: KCard) => (c as { suit: Suit }).suit;
const value = (c: KCard) => (rank(c) === 14 ? 11 : Math.min(rank(c), 10));

/** The hand's score: the best suit total, or 30½ for three of a kind. */
export function score31(cards: KCard[], trips = true): number {
  let best = 0;
  for (const suit of SUITS) best = Math.max(best, cards.filter((c) => suitOf(c) === suit).reduce((n, c) => n + value(c), 0));
  if (trips && cards.length === 3 && cards.every((c) => rank(c) === rank(cards[0]!))) best = Math.max(best, 30.5);
  return best;
}
const show = (n: number) => (n === 30.5 ? "30½" : String(n));

/** The best three of four cards: the score and the card to throw away. */
function bestDiscard(cards: KCard[], trips: boolean, keep: string | null): { score: number; card: KCard } {
  let best = { score: -1, card: cards[0]! };
  for (const c of cards) {
    if (c.id === keep) continue;
    const sc = score31(cards.filter((x) => x.id !== c.id), trips) - value(c) / 100; // on a tie, throw the lower card
    if (sc > best.score) best = { score: sc, card: c };
  }
  return { score: Math.round(best.score * 2) / 2, card: best.card };
}

const alive = (s: ThirtyOneState) => s.lives.flatMap((l, i) => (l > 0 ? [i] : []));
const nextAlive = (s: ThirtyOneState, from: number) => {
  for (let i = 1; i <= s.seats; i++) if (s.lives[(from + i) % s.seats]! > 0) return (from + i) % s.seats;
  return from;
};

function deal(s: ThirtyOneState) {
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  let k = 0;
  s.hands = s.lives.map((l) => (l > 0 ? sortCards(deck.slice(k, (k += 3))) : []));
  s.discard = [deck[k]!];
  s.stock = deck.slice(k + 1);
  s.turn = nextAlive(s, s.dealer);
  s.phase = "draw";
  s.taken = null;
  s.knocker = null;
  s.turns = 0;
  s.lost = Array(s.seats).fill(0);
  s.ready = s.lives.map((l) => l <= 0);
  s.narration = null;
  // Dealt 31: show it at once.
  const blitz = alive(s).find((i) => score31(s.hands[i]!, s.rules.trips) === 31);
  if (blitz !== undefined) showdown(s, blitz);
}

export function newThirtyOne(rules: ThirtyOneRules, seats: number, seed: number): ThirtyOneState {
  const s = { game: "thirtyone", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats } as unknown as ThirtyOneState;
  s.lives = Array(seats).fill(rules.lives);
  s.outAt = Array(seats).fill(null);
  deal(s);
  return s;
}

/** Everyone shows. With `blitz`, that seat has 31 and everyone else loses a life. */
function showdown(s: ThirtyOneState, blitz?: number) {
  const living = alive(s);
  const scores = s.hands.map((h) => score31(h, s.rules.trips));
  const lost = Array(s.seats).fill(0) as number[];
  if (blitz !== undefined) {
    for (const i of living) if (i !== blitz) lost[i] = 1;
    s.narration = `${who(blitz)} has 31! Everyone else loses a life`;
  } else {
    const low = Math.min(...living.map((i) => scores[i]!));
    const lowest = living.filter((i) => scores[i] === low);
    const k = s.knocker;
    if (k !== null && lowest.includes(k) && lowest.length === 1) {
      lost[k] = s.rules.knockerPays ? 2 : 1;
      s.narration = `${who(k)} knocked but has the lowest hand (${show(low)})${s.rules.knockerPays ? ": two lives" : ""}`;
    } else {
      const losers = lowest.filter((i) => i !== k);
      for (const i of losers) lost[i] = 1;
      s.narration = `${losers.map(who).join(" and ")} ${losers.length > 1 ? "tie" : "has"} the lowest hand (${show(low)}) and lose${losers.length > 1 ? "" : "s"} a life`;
      if (k !== null && lowest.includes(k)) s.narration += ` (${who(k)} knocked, so a tie is safe)`;
    }
  }
  // Nobody left standing? Then nobody loses: deal again.
  if (living.every((i) => s.lives[i]! - lost[i]! <= 0)) {
    s.lost = Array(s.seats).fill(0);
    s.narration = "Everyone would be out: nobody loses, deal again";
  } else {
    s.lost = lost;
    for (const i of living) {
      s.lives[i] = Math.max(0, s.lives[i]! - lost[i]!);
      if (s.lives[i] === 0) s.outAt[i] = s.hand;
    }
    const out = living.filter((i) => s.lives[i] === 0);
    if (out.length) s.narration += `. ${out.map(who).join(" and ")} ${out.length > 1 ? "are" : "is"} out`;
    if (s.rules.drinking) {
      for (const n of [1, 2]) s.narration = withDrinks(true, s.narration, living.filter((i) => lost[i] === n && s.lives[i]! > 0), n * 2);
      s.narration = withDrinks(true, s.narration, out, 99);
    }
  }
  s.ready = s.lives.map((l, i) => l <= 0 && !lost[i]);
  s.phase = alive(s).length <= 1 ? "finished" : "reveal";
}

function refill(s: ThirtyOneState) {
  if (s.stock.length || s.discard.length <= 1) return;
  const top = s.discard.pop()!;
  s.stock = shuffled(s.discard, nextRandom(s));
  s.discard = [top];
}

function endTurn(s: ThirtyOneState) {
  s.turns += 1;
  s.taken = null;
  s.turn = nextAlive(s, s.turn);
  s.phase = "draw";
  if (s.turn === s.knocker) showdown(s);
}

type Move = { type: "draw" } | { type: "take" } | { type: "knock" } | { type: "discard"; card: string } | { type: "next" };

function apply(state: ThirtyOneState, seat: number, move: Move): ThirtyOneState {
  const s = clone(state);
  const myTurn = () => {
    if (s.turn !== seat || (s.phase !== "draw" && s.phase !== "discard")) throw new GameError("It's not your turn.");
  };
  switch (move.type) {
    case "draw":
    case "take": {
      myTurn();
      if (s.phase !== "draw") throw new GameError("Throw a card away first.");
      let card: KCard | undefined;
      if (move.type === "take") {
        card = s.discard.pop();
        if (!card) throw new GameError("There's no discard to take.");
        s.taken = card.id;
        s.narration = `${who(seat)} took the ${label(card)}`;
      } else {
        refill(s);
        card = s.stock.pop();
        if (!card) throw new GameError("There's nothing left to draw.");
        s.narration = `${who(seat)} drew a card`;
      }
      s.hands[seat] = sortCards([...s.hands[seat]!, card]);
      s.phase = "discard";
      return s;
    }
    case "knock": {
      myTurn();
      if (s.phase !== "draw") throw new GameError("Knock instead of drawing, at the start of your turn.");
      if (s.knocker !== null) throw new GameError("Someone has already knocked.");
      s.knocker = seat;
      s.narration = `${who(seat)} knocked: one more turn each`;
      endTurn(s);
      return s;
    }
    case "discard": {
      myTurn();
      if (s.phase !== "discard") throw new GameError("Draw or take a card first.");
      const card = s.hands[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      if (card.id === s.taken) throw new GameError("You can't throw back the card you just took.");
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.discard.push(card);
      if (score31(s.hands[seat]!, s.rules.trips) === 31) {
        showdown(s, seat);
        return s;
      }
      endTurn(s);
      return s;
    }
    case "next": {
      if (s.phase !== "reveal") throw new GameError("The round isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        s.dealer = nextAlive(s, s.dealer);
        deal(s);
      }
      return s;
    }
    default:
      throw new GameError("That's not a move in Thirty-One.");
  }
}

const label = (c: KCard) => `${({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[rank(c)] ?? rank(c)}${SYMBOL[suitOf(c)]}`;

function view(s: ThirtyOneState, seat: number): KitView {
  const over = s.phase === "finished";
  const shown = s.phase === "reveal" || over;
  const mine = s.turn === seat && !shown;
  const hearts = (n: number) => (n > 0 ? "♥".repeat(n) : "Out");
  const melds: Meld[] = shown
    ? s.hands.flatMap((h, i) => (h.length && i !== seat ? [{ owner: i, label: `${show(score31(h, s.rules.trips))}${s.lost[i] ? ` · −${s.lost[i] > 1 ? "2 lives" : "1 life"}` : ""}`, cards: h }] : []))
    : [];
  const myScore = s.hands[seat]!.length ? score31(s.hands[seat]!.length === 4 ? s.hands[seat]!.filter((c) => c.id !== bestDiscard(s.hands[seat]!, s.rules.trips, s.taken).card.id) : s.hands[seat]!, s.rules.trips) : 0;
  let choices: KitView["choices"] = null;
  if (mine && s.phase === "draw" && s.knocker === null) choices = { prompt: "", options: [{ label: "Knock", move: { type: "knock" } }] };
  if (s.phase === "reveal" && !s.ready[seat]) choices = { prompt: "", options: [{ label: "Next round", move: { type: "next" }, primary: true }] };
  return {
    game: "thirtyone",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: shown ? null : s.turn,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: mine && s.phase === "discard" ? { type: "discard", cards: s.hands[seat]!.filter((c) => c.id !== s.taken).map((c) => c.id) } : null,
    pick: null,
    choices,
    players: s.hands.map((h, i) => ({
      cards: h.length,
      line: hearts(s.lives[i]!),
      out: s.lives[i]! <= 0,
      dealer: i === s.dealer,
      badge: s.knocker === i ? "Knocked" : undefined,
    })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.discard.slice(-3),
      discardCount: s.discard.length,
      drawMove: mine && s.phase === "draw" && (s.stock.length || s.discard.length > 1) ? { type: "draw" } : null,
      takeMove: mine && s.phase === "draw" && s.discard.length ? { type: "take" } : null,
    },
    melds,
    info: [
      ...(s.hands[seat]!.length ? [`Your hand: ${show(myScore)}`] : []),
      ...(s.knocker !== null && !shown ? [`${who(s.knocker)} knocked`] : []),
    ],
    narration: s.narration ?? (mine ? (s.phase === "draw" ? "Draw, take the discard, or knock" : "Throw one card away") : null),
    scores: s.lives.map((l, i) => ({ seats: [i], value: l })),
    result: null,
    over: over ? { winners: alive(s), title: `${who(alive(s)[0]!)} is the last one standing!` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: ThirtyOneState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "reveal") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const hand = s.hands[seat]!;
  const trips = s.rules.trips;
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.25;
  if (s.phase === "discard") {
    if (sloppy) {
      const can = hand.filter((c) => c.id !== s.taken);
      return { type: "discard", card: can[Math.floor(Math.random() * can.length)]!.id };
    }
    return { type: "discard", card: bestDiscard(hand, trips, s.taken).card.id };
  }
  if (s.phase !== "draw") return null;
  const now = score31(hand, trips);
  // Knock sooner as the round drags on, and later in a big game where somebody always beats you.
  const round = s.turns / Math.max(1, alive(s).length);
  const bar = 27 + Math.min(2, alive(s).length / 3) - round * 1.2 - (style.bold ?? 0.3) * 2;
  if (s.knocker === null && round >= 1 && now >= bar) return { type: "knock" };
  const top = s.discard[s.discard.length - 1];
  if (top) {
    const withTop = bestDiscard([...hand, top], trips, top.id).score;
    if (withTop >= now + 4 || (withTop > now && withTop >= 25)) return { type: "take" };
  }
  if (!s.stock.length && s.discard.length <= 1) return { type: "take" };
  return { type: "draw" };
}

const thirtyOneGame: CardGame<ThirtyOneRules, ThirtyOneState, Move> = {
  id: "thirtyone",
  name: "Thirty-One",
  emoji: "🎯",
  blurb: "Three cards, one suit, as close to 31 as you dare",
  tagline: "Draw and throw away to build the best suit. Knock when you're happy; the lowest hand loses a life.",
  seats: { min: 2, max: 8, default: 4 },
  teams: false,
  presets: [classicThirtyOne, longThirtyOne, plainThirtyOne],
  fields: [
    { key: "lives", label: "Lives", kind: "choice", options: [[2, "2"], [3, "3"], [4, "4"], [5, "5"]] },
    { key: "trips", label: "Three of a kind counts 30½", kind: "toggle" },
    { key: "knockerPays", label: "Knocker pays double", hint: "Knock and finish lowest: lose two lives.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<ThirtyOneRules>;
    const base = [classicThirtyOne, longThirtyOne, plainThirtyOne].find((p) => p.id === given.id) ?? classicThirtyOne;
    const r = { ...base, ...given };
    return { ...r, lives: Number(r.lives) };
  },
  validate(r) {
    return r.lives >= 1 && r.lives <= 9 ? [] : ["Pick between 1 and 9 lives."];
  },
  describe(r) {
    return [
      "Three cards each. Your hand is worth the total of its best suit: aces 11, faces 10, the rest face value. 31 is perfect.",
      ...(r.trips ? ["Three of a kind is worth 30½."] : []),
      "On your turn draw from the stock or take the top discard, then throw one card away (not the one you just took).",
      `Happy with your hand? Knock instead of drawing. Everyone else gets one more turn, then all hands show and the lowest loses a life. A knocker who ties for lowest is safe${r.knockerPays ? "; a knocker who is lowest alone loses two" : ""}.`,
      "Get 31 and show it at once: everyone else loses a life.",
      `Everyone starts with ${r.lives} lives. Lose them all and you're out; the last one left wins.`,
    ];
  },
  newGame: newThirtyOne,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "reveal" ? 2400 : s.phase === "discard" ? thinkFor(4, 0.8) : thinkFor(2, 0.9)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "thirtyone",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.lives.join(" · ") + " lives",
      order: over ? rankSeats(s.lives.map((l, i) => ({ seats: [i], score: l * 1000 + (s.outAt[i] ?? 999) }))) : null,
      winners: over ? alive(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};

export const thirtyOne = withDrinking(thirtyOneGame, "Adults only. Two sips for every life lost; out and you finish your drink (or sip water).", "two sips for every life you lose; lose your last and finish your drink.");
