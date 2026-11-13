// Hearts: no partners, no trump. Every heart you take is a point and the queen of spades is 13;
// lowest score wins when someone reaches the limit. Take every point and you "shoot the moon":
// everyone else gets them instead.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  isPip,
  makeDeck,
  markReady,
  nextRandom,
  rankSeats,
  shuffled,
  sortCards,
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type PipCard,
} from "./kit.js";
import { following, trickWinner, type Play } from "./tricks.js";

export interface HeartsRules extends BaseRules {
  playTo: number;
  /** Which way to pass each hand: rotating (left, right, across, keep), always left, or no passing. */
  passing: "rotate" | "left" | "none";
  /** No hearts or queen of spades on the first trick (unless that's all you have). */
  cleanFirstTrick: boolean;
  /** The jack of diamonds takes 10 points off. */
  jackOfDiamonds: boolean;
  /** Shooting the moon: everyone else gets 26, or the shooter takes 26 off their own score. */
  moon: "others" | "minus";
}

export const classicHearts: HeartsRules = { id: "hearts-classic", name: "Classic Hearts", playTo: 100, passing: "rotate", cleanFirstTrick: true, jackOfDiamonds: false, moon: "others" };
export const quickHearts: HeartsRules = { ...classicHearts, id: "hearts-quick", name: "Quick Hearts (to 50)", playTo: 50 };
export const omnibusHearts: HeartsRules = { ...classicHearts, id: "hearts-omnibus", name: "Omnibus (J♦ is −10)", jackOfDiamonds: true };

type Phase = "passing" | "playing" | "scored" | "finished";

export interface HeartsState {
  game: "hearts";
  rules: HeartsRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  /** Cards each seat chose to pass, until everyone has. */
  passing: (string[] | null)[];
  /** What each seat was passed this hand, to show them. */
  received: KCard[][];
  trick: Play[];
  lastTrick: { plays: Play[]; winner: number } | null;
  turn: number;
  taken: KCard[][];
  tricksWon: number[];
  heartsBroken: boolean;
  firstTrick: boolean;
  scores: number[];
  /** The last hand's points per seat, and who shot the moon. */
  lastHand: { points: number[]; moon: number | null } | null;
  ready: boolean[];
  narration: string | null;
}

const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const power = (c: KCard) => (c as PipCard).rank;
const isQueen = (c: KCard) => isPip(c) && c.suit === "spades" && c.rank === 12;
const isJack = (c: KCard) => isPip(c) && c.suit === "diamonds" && c.rank === 11;
const isPoint = (c: KCard) => (isPip(c) && c.suit === "hearts") || isQueen(c);
const pointsOf = (cards: KCard[], rules: HeartsRules) =>
  cards.reduce((n, c) => n + (isPip(c) && c.suit === "hearts" ? 1 : 0) + (isQueen(c) ? 13 : 0) + (rules.jackOfDiamonds && isJack(c) ? -10 : 0), 0);
const sortHand = (cards: KCard[]) => sortCards(cards);

/** Who you pass to this hand, as a number of seats to your left; 0 is no passing. */
export function passOffset(rules: HeartsRules, seats: number, hand: number): number {
  if (rules.passing === "none") return 0;
  if (rules.passing === "left") return 1;
  const cycle = seats === 4 ? [1, 3, 2, 0] : [1, seats - 1, 0];
  return cycle[hand % cycle.length]!;
}
const passWords = (offset: number, seats: number) => (offset === 1 ? "left" : offset === seats - 1 ? "right" : "across");

function deal(s: HeartsState) {
  const rand = nextRandom(s);
  // Everyone gets the same number of cards: three players lose the 2♦, five lose the 2♦ and 2♠.
  const drop = s.seats === 3 ? ["2♦"] : s.seats === 5 ? ["2♦", "2♠"] : [];
  const deck = shuffled(makeDeck({ ranks: FULL }).filter((c) => !drop.includes(c.id)), rand);
  const per = deck.length / s.seats;
  s.hands = Array.from({ length: s.seats }, (_, i) => sortHand(deck.slice(i * per, (i + 1) * per)));
  s.taken = s.hands.map(() => []);
  s.tricksWon = s.hands.map(() => 0);
  s.received = s.hands.map(() => []);
  s.passing = s.hands.map(() => null);
  s.trick = [];
  s.lastTrick = null;
  s.heartsBroken = false;
  s.firstTrick = true;
  s.ready = s.hands.map(() => false);
  if (passOffset(s.rules, s.seats, s.hand) === 0) startPlay(s);
  else s.phase = "passing";
}

function startPlay(s: HeartsState) {
  s.phase = "playing";
  s.turn = s.hands.findIndex((h) => h.some((c) => c.id === "2♣"));
}

export function newHearts(rules: HeartsRules, seats: number, seed: number): HeartsState {
  const s: HeartsState = {
    game: "hearts",
    rules,
    seats,
    rng: seed >>> 0,
    hand: 0,
    dealer: seed % seats,
    phase: "passing",
    hands: [],
    passing: [],
    received: [],
    trick: [],
    lastTrick: null,
    turn: 0,
    taken: [],
    tricksWon: [],
    heartsBroken: false,
    firstTrick: true,
    scores: Array(seats).fill(0),
    lastHand: null,
    ready: [],
    narration: null,
  };
  deal(s);
  return s;
}

/** The cards this seat may play now. */
export function heartsLegal(s: HeartsState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  const hand = s.hands[seat]!;
  if (s.firstTrick && !s.trick.length) return hand.filter((c) => c.id === "2♣");
  let options = following(hand, s.trick, suitOf);
  if (!s.trick.length && !s.heartsBroken) {
    const safe = options.filter((c) => suitOf(c) !== "hearts");
    if (safe.length) options = safe;
  }
  if (s.firstTrick && s.rules.cleanFirstTrick) {
    const clean = options.filter((c) => !isPoint(c));
    if (clean.length) options = clean;
  }
  return options;
}

type HeartsMove = { type: "pass"; cards: string[] } | { type: "play"; card: string } | { type: "next" };

function apply(state: HeartsState, seat: number, move: HeartsMove): HeartsState {
  const s = clone(state);
  if (move.type === "pass") {
    if (s.phase !== "passing") throw new GameError("It's not time to pass.");
    if (s.passing[seat]) throw new GameError("You've already passed.");
    if (!Array.isArray(move.cards) || move.cards.length !== 3) throw new GameError("Pass three cards.");
    for (const id of move.cards) if (!s.hands[seat]!.some((c) => c.id === id)) throw new GameError("You don't have that card.");
    if (new Set(move.cards).size !== 3) throw new GameError("Pick three different cards.");
    s.passing[seat] = move.cards;
    if (s.passing.every(Boolean)) {
      const offset = passOffset(s.rules, s.seats, s.hand);
      const outgoing = s.passing.map((ids, i) => s.hands[i]!.filter((c) => ids!.includes(c.id)));
      s.hands = s.hands.map((h, i) => h.filter((c) => !s.passing[i]!.includes(c.id)));
      outgoing.forEach((cards, from) => {
        const to = (from + offset) % s.seats;
        s.hands[to] = sortHand([...s.hands[to]!, ...cards]);
        s.received[to] = cards;
      });
      s.narration = "Cards passed.";
      startPlay(s);
    }
    return s;
  }
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The hand isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = (s.dealer + 1) % s.seats;
      s.narration = null;
      deal(s);
    }
    return s;
  }
  if (move.type !== "play") throw new GameError("That's not a move in Hearts.");
  if (s.phase !== "playing") throw new GameError("It's not time to play.");
  if (s.turn !== seat) throw new GameError("It's not your turn.");
  const card = s.hands[seat]!.find((c) => c.id === move.card);
  if (!card) throw new GameError("You don't have that card.");
  if (!heartsLegal(s, seat).some((c) => c.id === card.id)) {
    const hand = s.hands[seat]!;
    if (s.firstTrick && !s.trick.length) throw new GameError("The 2♣ leads the first trick.");
    if (s.trick.length && hand.some((c) => suitOf(c) === suitOf(s.trick[0]!.card))) throw new GameError(`Follow suit: play a ${SYMBOL[suitOf(s.trick[0]!.card)]} if you have one.`);
    if (!s.trick.length && suitOf(card) === "hearts") throw new GameError("Hearts aren't broken yet.");
    throw new GameError("No points on the first trick.");
  }
  if (s.lastTrick && !s.trick.length) s.lastTrick = null;
  s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
  s.trick.push({ seat, card });
  if (suitOf(card) === "hearts" && !s.heartsBroken) {
    s.heartsBroken = true;
    s.narration = `${who(seat)} broke hearts 💔`;
  } else if (isQueen(card)) s.narration = `${who(seat)} played the queen of spades 😬`;
  else s.narration = null;
  if (s.trick.length < s.seats) {
    s.turn = (seat + 1) % s.seats;
    return s;
  }
  const win = trickWinner(s.trick, null, suitOf, power);
  s.taken[win.seat]!.push(...s.trick.map((p) => p.card));
  s.tricksWon[win.seat]! += 1;
  s.lastTrick = { plays: s.trick, winner: win.seat };
  const points = pointsOf(s.trick.map((p) => p.card), s.rules);
  if (!s.narration && points > 0) s.narration = `${who(win.seat)} takes ${points} point${points === 1 ? "" : "s"}`;
  s.trick = [];
  s.firstTrick = false;
  s.turn = win.seat;
  if (s.hands[0]!.length === 0) scoreHand(s);
  return s;
}

function scoreHand(s: HeartsState) {
  const points = s.taken.map((cards) => pointsOf(cards, s.rules));
  // The moon: one seat took every heart and the queen.
  const moonSeat = s.taken.findIndex((cards) => cards.filter((c) => isPip(c) && c.suit === "hearts").length === 13 && cards.some(isQueen));
  let moon: number | null = null;
  if (moonSeat >= 0) {
    moon = moonSeat;
    const jack = s.rules.jackOfDiamonds && s.taken[moonSeat]!.some(isJack) ? -10 : 0;
    for (let i = 0; i < s.seats; i++) {
      if (s.rules.moon === "others") points[i] = i === moonSeat ? jack : 26 + (s.rules.jackOfDiamonds && s.taken[i]!.some(isJack) ? -10 : 0);
      else points[i] = i === moonSeat ? -26 + jack : pointsOf(s.taken[i]!, s.rules);
    }
    s.narration = `${who(moonSeat)} shot the moon! 🌙`;
  }
  s.scores = s.scores.map((n, i) => n + points[i]!);
  s.lastHand = { points, moon };
  s.ready = s.hands.map(() => false);
  s.phase = s.scores.some((n) => n >= s.rules.playTo) ? "finished" : "scored";
}

function winners(s: HeartsState): number[] {
  const low = Math.min(...s.scores);
  return s.scores.flatMap((n, i) => (n === low ? [i] : []));
}

function view(s: HeartsState, seat: number): KitView {
  const offset = passOffset(s.rules, s.seats, s.hand);
  const legal = heartsLegal(s, seat).map((c) => c.id);
  const over = s.phase === "finished";
  const passingNow = s.phase === "passing" && !s.passing[seat];
  return {
    game: "hearts",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: s.phase === "playing" && s.turn === seat ? { type: "play", cards: legal } : null,
    pick: passingNow
      ? { min: 3, max: 3, prompt: `Pick 3 cards to pass ${passWords(offset, s.seats)}`, cards: s.hands[seat]!.map((c) => c.id), actions: [{ label: `Pass ${passWords(offset, s.seats)}`, type: "pass", primary: true }] }
      : null,
    choices: (s.phase === "scored" || s.phase === "finished") && !s.ready[seat] && !over ? { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] } : null,
    players: s.hands.map((h, i) => ({
      cards: h.length,
      line: s.phase === "passing" ? (s.passing[i] ? "Passed" : "Choosing…") : `Took ${pointsOf(s.taken[i]!, s.rules)}`,
      dealer: i === s.dealer,
    })),
    center: { kind: "trick", plays: s.trick.length ? s.trick : (s.lastTrick?.plays ?? []), winner: s.trick.length ? null : (s.lastTrick?.winner ?? null) },
    melds: [],
    info: [
      ...(s.phase === "passing" ? [`Passing ${passWords(offset, s.seats)}`] : []),
      ...(s.phase === "playing" && s.received[seat]!.length ? [`You got ${s.received[seat]!.map((c) => c.id).join(" ")}`] : []),
      ...(s.heartsBroken ? ["Hearts broken 💔"] : []),
      `Hand ${s.hand + 1} · to ${s.rules.playTo}, low wins`,
    ],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result:
      s.lastHand && (s.phase === "scored" || s.phase === "finished")
        ? {
            key: `hearts-${s.hand}`,
            title: s.lastHand.moon !== null ? `${who(s.lastHand.moon)} shot the moon! 🌙` : `Hand ${s.hand + 1}`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "This hand", values: s.lastHand.points.map((n) => (n > 0 ? `+${n}` : String(n))), tone: "score" },
              { label: "Total", values: s.scores.map(String), tone: "total" },
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: winners(s).length > 1 ? "A tie for the lowest score" : `${who(winners(s)[0]!)} wins with ${Math.min(...s.scores)}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** How much a card is worth getting rid of: the queen and her escorts, high hearts, then high cards. */
function danger(c: KCard, hand: KCard[]): number {
  const p = c as PipCard;
  const spades = hand.filter((x) => suitOf(x) === "spades").length;
  if (isQueen(c)) return spades >= 5 ? 20 : 100;
  if (p.suit === "spades" && p.rank > 12) return hand.some(isQueen) || spades >= 5 ? 30 : 80;
  if (p.suit === "hearts") return 40 + p.rank * 3;
  const sameSuit = hand.filter((x) => suitOf(x) === p.suit).length;
  return p.rank * 3 + (sameSuit <= 2 ? 25 : 0);
}

function bot(s: HeartsState, seat: number, style: PlayStyle): HeartsMove | null {
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  if (s.phase === "passing") {
    if (s.passing[seat]) return null;
    const hand = s.hands[seat]!;
    const ranked = sloppy ? shuffled(hand, Math.random) : [...hand].sort((a, b) => danger(b, hand) - danger(a, hand));
    return { type: "pass", cards: ranked.slice(0, 3).map((c) => c.id) };
  }
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const legal = heartsLegal(s, seat);
  if (legal.length === 1 || sloppy) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  return { type: "play", card: bestPlay(s, seat, legal).id };
}

function bestPlay(s: HeartsState, seat: number, legal: KCard[]): KCard {
  const hand = s.hands[seat]!;
  const low = (cards: KCard[]) => [...cards].sort((a, b) => power(a) - power(b))[0]!;
  const high = (cards: KCard[]) => [...cards].sort((a, b) => power(b) - power(a))[0]!;
  const queenOut = !s.taken.some((t) => t.some(isQueen)) && !hand.some(isQueen) && !s.trick.some((p) => isQueen(p.card));
  if (!s.trick.length) {
    // Lead low from a long, safe suit; keep high spades off the table while the queen's out.
    const safe = legal.filter((c) => !(suitOf(c) === "spades" && power(c) >= 12 && queenOut) && !isQueen(c));
    const pool = safe.length ? safe : legal;
    const bySuit = (c: KCard) => hand.filter((x) => suitOf(x) === suitOf(c)).length;
    return [...pool].sort((a, b) => power(a) - power(b) || bySuit(b) - bySuit(a))[0]!;
  }
  const led = suitOf(s.trick[0]!.card);
  const following = legal.every((c) => suitOf(c) === led) && hand.some((c) => suitOf(c) === led);
  const winning = trickWinner(s.trick, null, suitOf, power);
  const last = s.trick.length === s.seats - 1;
  const trickPoints = s.trick.reduce((n, p) => n + (isPoint(p.card) ? (isQueen(p.card) ? 13 : 1) : 0), 0);
  if (following) {
    // Dump the queen under a higher spade.
    const queen = legal.find(isQueen);
    if (queen && led === "spades" && power(winning.card) > 12) return queen;
    const under = legal.filter((c) => power(c) < power(winning.card));
    if (under.length) return high(under);
    // Must win it: last with no points, win with the highest; otherwise as cheaply as possible.
    if (last && trickPoints === 0) return high(legal.filter((c) => !isQueen(c)).length ? legal.filter((c) => !isQueen(c)) : legal);
    return low(legal);
  }
  // Can't follow: unload the worst card.
  return [...legal].sort((a, b) => danger(b, hand) - danger(a, hand))[0]!;
}

export const hearts: CardGame<HeartsRules, HeartsState, HeartsMove> = {
  id: "hearts",
  name: "Hearts",
  emoji: "♥︎",
  blurb: "Dodge the hearts and the queen",
  tagline: "Every heart is a point and the queen of spades is 13. Lowest score wins.",
  seats: { min: 3, max: 5, default: 4 },
  teams: false,
  presets: [classicHearts, quickHearts, omnibusHearts],
  fields: [
    { key: "playTo", label: "Game ends at", kind: "choice", options: [[50, "50 points"], [75, "75 points"], [100, "100 points"]] },
    { key: "passing", label: "Passing", kind: "choice", options: [["rotate", "Left, right, across, keep"], ["left", "Always left"], ["none", "No passing"]] },
    { key: "cleanFirstTrick", label: "No points on the first trick", kind: "toggle" },
    { key: "jackOfDiamonds", label: "Jack of diamonds is −10", kind: "toggle" },
    { key: "moon", label: "Shooting the moon", kind: "choice", options: [["others", "Everyone else gets 26"], ["minus", "Take 26 off your score"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<HeartsRules>;
    const base = [classicHearts, quickHearts, omnibusHearts].find((p) => p.id === given.id) ?? classicHearts;
    return { ...base, ...given };
  },
  validate(r) {
    const errors: string[] = [];
    if (!(r.playTo >= 25 && r.playTo <= 500)) errors.push("Play to between 25 and 500.");
    if (!["rotate", "left", "none"].includes(r.passing)) errors.push("Pick a way to pass.");
    if (!["others", "minus"].includes(r.moon)) errors.push("Pick how shooting the moon scores.");
    return errors;
  },
  describe(r) {
    return [
      "Follow suit if you can; there's no trump. Highest card of the suit led takes the trick.",
      `Each heart is 1 point and the Q♠ is 13${r.jackOfDiamonds ? "; the J♦ takes 10 off" : ""}. Lowest score wins when someone reaches ${r.playTo}.`,
      r.passing === "none" ? "No passing." : r.passing === "left" ? "Pass 3 cards to your left each hand." : "Pass 3 cards: left, then right, then across, then keep your cards.",
      "The 2♣ leads the first trick. Hearts can't be led until one has been played.",
      ...(r.cleanFirstTrick ? ["No hearts or Q♠ on the first trick (unless that's all you have)."] : []),
      r.moon === "others" ? "Take every heart and the Q♠ to shoot the moon: everyone else gets 26." : "Take every heart and the Q♠ to shoot the moon: take 26 off your score.",
    ];
  },
  newGame: newHearts,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "passing") return 2400;
    if (s.phase === "scored") return 900;
    return thinkFor(heartsLegal(s, seat).length, s.trick.length === s.seats - 1 ? 0.8 : 1);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "hearts",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats(s.scores.map((score, i) => ({ seats: [i], score })), true) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
