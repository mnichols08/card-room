// Euchre: partners across the table, a 24-card deck (9 to ace), five cards each. One card is turned
// up: anyone can order it up as trump (the dealer picks it up), or, once it's turned down, name another
// suit. The jack of trump is the right bower, the other jack of its colour the left bower; they're
// the two best trumps. The side that called trump needs three of the five tricks, or they're euchred.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  GameError,
  makeDeck,
  markReady,
  nextRandom,
  rankSeats,
  shuffled,
  sortCards,
  SUITS,
  SYMBOL,
  teamOfSeat,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type Choice,
  type KCard,
  type KitView,
  type PipCard,
} from "./kit.js";
import { bestLoser, cheapestWinner, following, trickWinner, type Play } from "./tricks.js";

export interface EuchreRules extends BaseRules {
  playTo: number;
  /** If everyone passes twice, the dealer must name trump (no redeal). */
  stickTheDealer: boolean;
  /** Whoever calls trump may play alone: their partner sits out, and all five tricks score 4. */
  goAlone: boolean;
}

export const classicEuchre: EuchreRules = { id: "euchre-classic", name: "Classic Euchre", playTo: 10, stickTheDealer: true, goAlone: true };
export const quickEuchre: EuchreRules = { ...classicEuchre, id: "euchre-quick", name: "Quick Euchre (to 5)", playTo: 5 };
export const redealEuchre: EuchreRules = { ...classicEuchre, id: "euchre-redeal", name: "Redeal on all passes", stickTheDealer: false };

type Phase = "bid1" | "bid2" | "discard" | "playing" | "scored" | "finished";

export interface EuchreState {
  game: "euchre";
  rules: EuchreRules;
  seats: 4;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  upcard: KCard | null;
  kitty: KCard[];
  trump: Suit | null;
  maker: number | null;
  alone: number | null;
  /** Bidding turns taken this round, so we know when everyone has passed. */
  passes: number;
  trick: Play[];
  lastTrick: { plays: Play[]; winner: number } | null;
  turn: number;
  tricksWon: number[];
  scores: [number, number];
  lastHand: { maker: number; alone: boolean; tricks: [number, number]; points: [number, number]; euchred: boolean } | null;
  ready: boolean[];
  narration: string | null;
}

const RED: Suit[] = ["hearts", "diamonds"];
const sameColour = (a: Suit, b: Suit) => RED.includes(a) === RED.includes(b);
const rank = (c: KCard) => (c as PipCard).rank;
const rawSuit = (c: KCard) => (c as PipCard).suit as Suit;
const isRight = (c: KCard, trump: Suit | null) => !!trump && rank(c) === 11 && rawSuit(c) === trump;
const isLeft = (c: KCard, trump: Suit | null) => !!trump && rank(c) === 11 && rawSuit(c) !== trump && sameColour(rawSuit(c), trump);
/** The suit a card counts as: the left bower is a trump. */
export const euchreSuit = (trump: Suit | null) => (c: KCard): Suit => (isLeft(c, trump) ? trump! : rawSuit(c));
/** How high a card is within its suit: the bowers above the ace. */
export const euchrePower = (trump: Suit | null) => (c: KCard): number => (isRight(c, trump) ? 100 : isLeft(c, trump) ? 99 : rank(c));

const partnerOf = (seat: number) => (seat + 2) % 4;
/** The next seat to play, skipping a partner who's sitting out. */
const nextSeat = (s: EuchreState, seat: number) => {
  let n = (seat + 1) % 4;
  if (s.alone !== null && n === partnerOf(s.alone)) n = (n + 1) % 4;
  return n;
};
const playersInHand = (s: EuchreState) => (s.alone === null ? 4 : 3);
const sortFor = (cards: KCard[], trump: Suit | null) => sortCards(cards, euchrePower(trump), (c) => (trump ? euchreSuit(trump)(c) : rawSuit(c)));

function deal(s: EuchreState) {
  const rand = nextRandom(s);
  const deck = shuffled(makeDeck({ ranks: [9, 10, 11, 12, 13, 14] }), rand);
  s.hands = [0, 1, 2, 3].map((i) => sortFor(deck.slice(i * 5, i * 5 + 5), null));
  s.upcard = deck[20]!;
  s.kitty = deck.slice(21);
  s.trump = null;
  s.maker = null;
  s.alone = null;
  s.passes = 0;
  s.trick = [];
  s.lastTrick = null;
  s.tricksWon = [0, 0, 0, 0];
  s.ready = [false, false, false, false];
  s.phase = "bid1";
  s.turn = (s.dealer + 1) % 4;
  s.narration = `${who(s.dealer)} turned up the ${cardName(s.upcard)}`;
}
const cardName = (c: KCard) => `${({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[rank(c)] ?? rank(c)}${SYMBOL[rawSuit(c)]}`;

export function newEuchre(rules: EuchreRules, _seats: number, seed: number): EuchreState {
  const s = {
    game: "euchre",
    rules,
    seats: 4,
    rng: seed >>> 0,
    hand: 0,
    dealer: seed % 4,
    scores: [0, 0],
    lastHand: null,
    narration: null,
  } as unknown as EuchreState;
  deal(s);
  return s;
}

function startPlay(s: EuchreState) {
  s.phase = "playing";
  s.hands = s.hands.map((h) => sortFor(h, s.trump));
  s.turn = nextSeat(s, s.dealer);
}

function callTrump(s: EuchreState, seat: number, suit: Suit, alone: boolean) {
  s.trump = suit;
  s.maker = seat;
  s.alone = alone && s.rules.goAlone ? seat : null;
  s.narration = `${who(seat)} called ${SYMBOL[suit]}${s.alone !== null ? " and is going alone!" : ""}`;
}

export function euchreLegal(s: EuchreState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  return following(s.hands[seat]!, s.trick, euchreSuit(s.trump));
}

type Move =
  | { type: "order"; alone?: boolean }
  | { type: "name"; suit: Suit; alone?: boolean }
  | { type: "pass" }
  | { type: "discard"; cards: string[] }
  | { type: "play"; card: string }
  | { type: "next" };

function apply(state: EuchreState, seat: number, move: Move): EuchreState {
  const s = clone(state);
  switch (move.type) {
    case "next": {
      if (s.phase !== "scored") throw new GameError("The hand isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        s.dealer = (s.dealer + 1) % 4;
        deal(s);
      }
      return s;
    }
    case "pass": {
      if (s.phase !== "bid1" && s.phase !== "bid2") throw new GameError("It's not time to bid.");
      if (s.turn !== seat) throw new GameError("It's not your turn.");
      if (s.phase === "bid2" && seat === s.dealer && s.rules.stickTheDealer) throw new GameError("Stick the dealer: you have to name trump.");
      s.passes += 1;
      s.narration = `${who(seat)} passed`;
      if (s.passes < 4) {
        s.turn = (seat + 1) % 4;
        return s;
      }
      if (s.phase === "bid1") {
        s.phase = "bid2";
        s.passes = 0;
        s.turn = (s.dealer + 1) % 4;
        s.narration = `Everyone passed: the ${cardName(s.upcard!)} is turned down. Name another suit, or pass.`;
        return s;
      }
      // Nobody named trump: throw the hand in and deal again.
      s.dealer = (s.dealer + 1) % 4;
      deal(s);
      s.narration = "Everyone passed twice, so the cards were thrown in and dealt again.";
      return s;
    }
    case "order": {
      if (s.phase !== "bid1") throw new GameError("You can only order it up in the first round.");
      if (s.turn !== seat) throw new GameError("It's not your turn.");
      callTrump(s, seat, rawSuit(s.upcard!), !!move.alone);
      // The dealer picks the card up and discards one (unless the dealer's partner went alone).
      if (s.alone !== null && partnerOf(s.alone) === s.dealer) {
        s.kitty.push(s.upcard!);
        startPlay(s);
      } else {
        s.hands[s.dealer] = sortFor([...s.hands[s.dealer]!, s.upcard!], s.trump);
        s.phase = "discard";
        s.turn = s.dealer;
      }
      return s;
    }
    case "name": {
      if (s.phase !== "bid2") throw new GameError("Trump is named in the second round.");
      if (s.turn !== seat) throw new GameError("It's not your turn.");
      if (!SUITS.includes(move.suit)) throw new GameError("That's not a suit.");
      if (move.suit === rawSuit(s.upcard!)) throw new GameError(`${SYMBOL[move.suit]} was turned down: pick another suit.`);
      callTrump(s, seat, move.suit, !!move.alone);
      s.kitty.push(s.upcard!);
      startPlay(s);
      return s;
    }
    case "discard": {
      if (s.phase !== "discard" || seat !== s.dealer) throw new GameError("It's not time to discard.");
      if (!Array.isArray(move.cards) || move.cards.length !== 1) throw new GameError("Discard one card.");
      const card = s.hands[seat]!.find((c) => c.id === move.cards[0]);
      if (!card) throw new GameError("You don't have that card.");
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.kitty.push(card);
      startPlay(s);
      return s;
    }
    case "play": {
      if (s.phase !== "playing") throw new GameError("It's not time to play.");
      if (s.turn !== seat) throw new GameError("It's not your turn.");
      const card = s.hands[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      if (!euchreLegal(s, seat).some((c) => c.id === card.id)) throw new GameError(`Follow suit: play a ${SYMBOL[euchreSuit(s.trump)(s.trick[0]!.card)]} if you have one (the left bower counts as trump).`);
      if (!s.trick.length) s.lastTrick = null;
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.trick.push({ seat, card });
      s.narration = null;
      if (s.trick.length < playersInHand(s)) {
        s.turn = nextSeat(s, seat);
        return s;
      }
      const win = trickWinner(s.trick, s.trump, euchreSuit(s.trump), euchrePower(s.trump));
      s.tricksWon[win.seat]! += 1;
      s.lastTrick = { plays: s.trick, winner: win.seat };
      s.trick = [];
      s.turn = win.seat;
      if (s.hands[win.seat]!.length === 0) scoreHand(s);
      return s;
    }
    default:
      throw new GameError("That's not a move in Euchre.");
  }
}

export function euchrePoints(makerTricks: number, alone: boolean): { makers: number; defenders: number } {
  if (makerTricks < 3) return { makers: 0, defenders: 2 };
  if (makerTricks === 5) return { makers: alone ? 4 : 2, defenders: 0 };
  return { makers: 1, defenders: 0 };
}

function scoreHand(s: EuchreState) {
  const team = teamOfSeat(s.maker!);
  const tricks: [number, number] = [s.tricksWon[0]! + s.tricksWon[2]!, s.tricksWon[1]! + s.tricksWon[3]!];
  const { makers, defenders } = euchrePoints(tricks[team], s.alone !== null);
  const points: [number, number] = [0, 0];
  points[team] = makers;
  points[(1 - team) as 0 | 1] = defenders;
  s.scores = [s.scores[0] + points[0], s.scores[1] + points[1]];
  const euchred = defenders > 0;
  s.lastHand = { maker: s.maker!, alone: s.alone !== null, tricks, points, euchred };
  s.narration = euchred ? `Euchred! ${who((s.maker! + 1) % 4)} & ${who((s.maker! + 3) % 4)} take 2` : tricks[team] === 5 ? `A march! All five tricks` : null;
  s.ready = [false, false, false, false];
  s.phase = s.scores.some((n) => n >= s.rules.playTo) ? "finished" : "scored";
}

const winningTeam = (s: EuchreState): 0 | 1 => (s.scores[0] >= s.scores[1] ? 0 : 1);

function bidChoices(s: EuchreState, seat: number): KitView["choices"] {
  if ((s.phase !== "bid1" && s.phase !== "bid2") || s.turn !== seat) return null;
  const options: Choice[] = [];
  const dealerIs = seat === s.dealer ? "Pick it up" : `Order it up`;
  if (s.phase === "bid1") {
    const suit = rawSuit(s.upcard!);
    options.push({ label: `${dealerIs} (${SYMBOL[suit]})`, move: { type: "order" }, primary: true });
    if (s.rules.goAlone) options.push({ label: `${dealerIs} and go alone`, move: { type: "order", alone: true } });
    options.push({ label: "Pass", move: { type: "pass" } });
    return { prompt: `Make ${SYMBOL[suit]} trump?${seat === s.dealer ? " You'd pick up the turned card and discard one." : ""}`, options };
  }
  const turnedDown = rawSuit(s.upcard!);
  for (const suit of SUITS.filter((x) => x !== turnedDown)) options.push({ label: `${SYMBOL[suit]} trump`, move: { type: "name", suit } });
  if (s.rules.goAlone) for (const suit of SUITS.filter((x) => x !== turnedDown)) options.push({ label: `${SYMBOL[suit]} alone`, move: { type: "name", suit, alone: true } });
  const stuck = seat === s.dealer && s.rules.stickTheDealer;
  if (!stuck) options.push({ label: "Pass", move: { type: "pass" } });
  return { prompt: stuck ? "Stick the dealer: you have to name trump." : `Name trump (not ${SYMBOL[turnedDown]}), or pass.`, options, layout: "grid" };
}

function view(s: EuchreState, seat: number): KitView {
  const over = s.phase === "finished";
  const bidding = s.phase === "bid1" || s.phase === "bid2";
  const sittingOut = s.alone !== null ? partnerOf(s.alone) : null;
  const winner = over ? winningTeam(s) : null;
  return {
    game: "euchre",
    seats: 4,
    me: seat,
    teams: true,
    phase: s.phase,
    turn: s.phase === "scored" || over ? null : s.turn,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: s.phase === "playing" && s.turn === seat ? { type: "play", cards: euchreLegal(s, seat).map((c) => c.id) } : null,
    pick:
      s.phase === "discard" && seat === s.dealer
        ? { min: 1, max: 1, prompt: "Pick a card to discard", cards: s.hands[seat]!.map((c) => c.id), actions: [{ label: "Discard", type: "discard", primary: true }] }
        : null,
    choices: bidChoices(s, seat) ?? (s.phase === "scored" && !s.ready[seat] ? { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] } : null),
    players: s.hands.map((h, i) => ({
      cards: h.length,
      line: bidding ? (i === s.dealer ? "Dealer" : "") : `Took ${s.tricksWon[i]}`,
      team: teamOfSeat(i),
      dealer: i === s.dealer,
      out: i === sittingOut,
      badge: i === s.maker ? (s.alone === i ? `Called ${SYMBOL[s.trump!]} · Alone` : `Called ${SYMBOL[s.trump!]}`) : i === sittingOut ? "Sitting out" : undefined,
    })),
    center: bidding
      ? {
          kind: "piles",
          stock: 3,
          discard: s.phase === "bid1" ? [s.upcard!] : [],
          discardCount: s.phase === "bid1" ? 1 : 0,
          drawMove: null,
          takeMove: null,
          stockLabel: "The kitty",
          discardLabel: s.phase === "bid1" ? "Turned up" : `${SYMBOL[rawSuit(s.upcard!)]} turned down`,
        }
      : { kind: "trick", plays: s.trick.length ? s.trick : (s.lastTrick?.plays ?? []), winner: s.trick.length ? null : (s.lastTrick?.winner ?? null) },
    melds: [],
    info: [
      ...(s.trump ? [`Trump ${SYMBOL[s.trump]}`] : []),
      ...(s.maker !== null && s.phase === "playing" ? [`${who(s.maker)} & ${who(partnerOf(s.maker))} need 3 tricks`] : []),
      `To ${s.rules.playTo}`,
    ],
    narration: s.narration,
    scores: [
      { seats: [0, 2], value: s.scores[0] },
      { seats: [1, 3], value: s.scores[1] },
    ],
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `euchre-${s.hand}`,
            title: s.lastHand.euchred ? "Euchred! 😱" : s.lastHand.tricks[teamOfSeat(s.lastHand.maker)] === 5 ? (s.lastHand.alone ? "Alone, all five! 🔥" : "All five tricks! 🎉") : `${who(s.lastHand.maker)} made it`,
            sides: [
              [0, 2],
              [1, 3],
            ],
            rows: [
              { label: "Tricks", values: s.lastHand.tricks.map(String) },
              { label: "This hand", values: s.lastHand.points.map((p) => (p > 0 ? `+${p}` : "0")), tone: "score" },
              { label: "Score", values: s.scores.map(String), tone: "total" },
            ],
          }
        : null,
    over: winner !== null ? { winners: [winner, winner + 2], title: `${who(winner)} & ${who(winner + 2)} win ${s.scores[winner]} to ${s.scores[1 - winner]}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** How strong a hand is with this suit as trump (about 7–8 is worth calling). */
export function trumpStrength(hand: KCard[], trump: Suit): number {
  let score = 0;
  const suitOf = euchreSuit(trump);
  for (const c of hand) {
    if (isRight(c, trump)) score += 3;
    else if (isLeft(c, trump)) score += 2.5;
    else if (suitOf(c) === trump) score += rank(c) === 14 ? 2 : rank(c) === 13 ? 1.5 : rank(c) === 12 ? 1.2 : 1;
    else if (rank(c) === 14) score += 1;
  }
  const offSuits = new Set(hand.filter((c) => suitOf(c) !== trump).map(suitOf));
  score += (3 - offSuits.size) * 0.5;
  return score;
}

function bot(s: EuchreState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  const careless = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  const nerve = 7.5 - (style.bold ?? 0) * 1.2;
  if (s.phase === "discard") {
    if (seat !== s.dealer) return null;
    const hand = s.hands[seat]!;
    const suitOf = euchreSuit(s.trump);
    const off = hand.filter((c) => suitOf(c) !== s.trump && rank(c) !== 14);
    // Throw a lone off-suit card to make a void, else the lowest off-suit card, else the lowest trump.
    const single = off.filter((c) => hand.filter((x) => suitOf(x) === suitOf(c)).length === 1).sort((a, b) => rank(a) - rank(b))[0];
    const pick = single ?? off.sort((a, b) => rank(a) - rank(b))[0] ?? [...hand].sort((a, b) => euchrePower(s.trump)(a) - euchrePower(s.trump)(b))[0]!;
    return { type: "discard", cards: [pick.id] };
  }
  if (s.phase === "bid1" || s.phase === "bid2") {
    if (s.turn !== seat) return null;
    const hand = s.hands[seat]!;
    if (s.phase === "bid1") {
      const suit = rawSuit(s.upcard!);
      // The dealer's side gets the upcard: a little better for us if it's our side, worse if theirs.
      const withUp = seat === s.dealer ? [...hand, s.upcard!] : hand;
      const sideBonus = teamOfSeat(seat) === teamOfSeat(s.dealer) ? (rank(s.upcard!) === 11 ? 1.5 : 0.7) : rank(s.upcard!) === 11 ? -1.5 : -0.5;
      const strength = trumpStrength(withUp, suit) + (seat === s.dealer ? 0 : sideBonus);
      if (careless ? Math.random() < 0.2 : strength >= nerve) return { type: "order", alone: s.rules.goAlone && strength >= nerve + 4.5 };
      return { type: "pass" };
    }
    const turnedDown = rawSuit(s.upcard!);
    const best = SUITS.filter((x) => x !== turnedDown)
      .map((suit) => ({ suit, strength: trumpStrength(hand, suit) }))
      .sort((a, b) => b.strength - a.strength)[0]!;
    const stuck = seat === s.dealer && s.rules.stickTheDealer;
    if (stuck || (careless ? Math.random() < 0.2 : best.strength >= nerve)) return { type: "name", suit: best.suit, alone: s.rules.goAlone && best.strength >= nerve + 4.5 };
    return { type: "pass" };
  }
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const legal = euchreLegal(s, seat);
  if (legal.length === 1 || careless) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  const trump = s.trump;
  const suitOf = euchreSuit(trump);
  const power = euchrePower(trump);
  const strength = (c: KCard) => power(c) + (suitOf(c) === trump ? 200 : 0);
  if (!s.trick.length) {
    const makers = s.maker !== null && teamOfSeat(s.maker) === teamOfSeat(seat);
    const trumps = legal.filter((c) => suitOf(c) === trump).sort((a, b) => strength(b) - strength(a));
    // Makers pull trump with their best; anyone leads an off-suit ace; otherwise lead low.
    if (makers && trumps.length && (isRight(trumps[0]!, trump) || trumps.length >= 2)) return { type: "play", card: trumps[0]!.id };
    const ace = legal.find((c) => suitOf(c) !== trump && rank(c) === 14);
    if (ace) return { type: "play", card: ace.id };
    return { type: "play", card: [...legal].sort((a, b) => strength(a) - strength(b))[0]!.id };
  }
  const winning = trickWinner(s.trick, trump, suitOf, power);
  // Partner has it: stay low.
  if (teamOfSeat(winning.seat) === teamOfSeat(seat)) return { type: "play", card: [...legal].sort((a, b) => strength(a) - strength(b))[0]!.id };
  const win = cheapestWinner(legal, seat, s.trick, trump, suitOf, power);
  return { type: "play", card: (win ?? bestLoser(legal, seat, s.trick, trump, suitOf, power)).id };
}

export const euchre: CardGame<EuchreRules, EuchreState, Move> = {
  id: "euchre",
  name: "Euchre",
  emoji: "🃏",
  blurb: "Partners, bowers and calling trump",
  tagline: "Partners call trump and take three of five tricks. Jacks are the best trumps.",
  seats: { min: 4, max: 4, default: 4 },
  teams: true,
  presets: [classicEuchre, quickEuchre, redealEuchre],
  fields: [
    { key: "playTo", label: "Game to", kind: "choice", options: [[5, "5 points"], [7, "7 points"], [10, "10 points"], [11, "11 points"]] },
    { key: "stickTheDealer", label: "Stick the dealer", hint: "If everyone passes twice, the dealer must name trump.", kind: "toggle" },
    { key: "goAlone", label: "Going alone", hint: "The caller can play without their partner; all five tricks scores 4.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<EuchreRules>;
    const base = [classicEuchre, quickEuchre, redealEuchre].find((p) => p.id === given.id) ?? classicEuchre;
    return { ...base, ...given };
  },
  validate(r) {
    return Number.isInteger(r.playTo) && r.playTo >= 3 && r.playTo <= 21 ? [] : ["Play to between 3 and 21."];
  },
  describe(r) {
    return [
      "Partners sit across. A 24-card deck, 9 to ace; five cards each, and one card turned up.",
      "First round: anyone can order the turned card up as trump, and the dealer picks it up and discards one. If everyone passes, it's turned down and anyone can name another suit.",
      r.stickTheDealer ? "If everyone passes twice, the dealer has to name trump." : "If everyone passes twice, the cards are thrown in and dealt again.",
      "The jack of trump (right bower) is the best card, then the other jack of the same colour (left bower), then ace, king, queen, 10, 9 of trump.",
      `The callers need 3 tricks for a point; all 5 is 2${r.goAlone ? " (4 alone)" : ""}. Fewer than 3 and they're euchred: the other side gets 2.`,
      `First side to ${r.playTo} wins.`,
    ];
  },
  newGame: newEuchre,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "bid1" || s.phase === "bid2") return 1700;
    if (s.phase === "discard") return 1500;
    if (s.phase === "scored") return 900;
    return thinkFor(euchreLegal(s, seat).length);
  },
  summary(s) {
    const over = s.phase === "finished";
    const w = winningTeam(s);
    return {
      game: "euchre",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: `${s.scores[0]} to ${s.scores[1]}`,
      order: over ? rankSeats([{ seats: [0, 2], score: s.scores[0] }, { seats: [1, 3], score: s.scores[1] }]) : null,
      winners: over ? [w, w + 2] : null,
      teams: true,
      seats: 4,
    };
  },
};
