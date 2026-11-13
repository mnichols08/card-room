// Partnership Pinochle: partners across, a 48-card deck (two each of 9, J, Q, K, 10, A in every
// suit; the 10 ranks just under the ace). An auction for the right to name trump, then meld (shown
// for everyone; the engine finds each hand's best), then twelve tricks. Aces, tens and kings are
// worth 10 each, and the last trick 10 more: 250 in a hand. Make your bid with meld plus tricks, or
// lose the bid.
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
  type Meld,
  type PipCard,
} from "./kit.js";
import { trickWinner, type Play } from "./tricks.js";

export interface PinochleRules extends BaseRules {
  playTo: number;
  minBid: number;
  /** When following suit, you must beat the card that's winning if you can (and trump over a trump). */
  mustBeat: boolean;
  /** If everyone passes, the dealer must take the bid at the minimum (otherwise the hand is thrown in). */
  dealerStuck: boolean;
  /** A side's meld only counts if it takes at least one point in tricks. */
  saveMeld: boolean;
}

export const classicPinochle: PinochleRules = { id: "pinochle-classic", name: "Partnership Pinochle", playTo: 1500, minBid: 200, mustBeat: true, dealerStuck: true, saveMeld: true };
export const quickPinochle: PinochleRules = { ...classicPinochle, id: "pinochle-quick", name: "Quick Pinochle (to 1000)", playTo: 1000 };
export const easyPinochle: PinochleRules = { ...classicPinochle, id: "pinochle-easy", name: "Easygoing (no must-beat)", mustBeat: false };
export const toughPinochle: PinochleRules = { ...classicPinochle, id: "pinochle-tough", name: "Tough table (250 to bid)", minBid: 250 };

type Phase = "bidding" | "trump" | "meld" | "playing" | "scored" | "finished";

export interface PinochleState {
  game: "pinochle";
  rules: PinochleRules;
  seats: 4;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  /** The current high bid, its bidder, and who has passed. */
  bid: number;
  bidder: number | null;
  passed: boolean[];
  trump: Suit | null;
  meld: { points: number; cards: KCard[]; parts: string[] }[];
  trick: Play[];
  lastTrick: { plays: Play[]; winner: number } | null;
  turn: number;
  /** Points each side took in tricks this hand. */
  taken: [number, number];
  tricks: [number, number];
  scores: [number, number];
  lastHand: { bidder: number; bid: number; meld: [number, number]; tricks: [number, number]; points: [number, number]; set: boolean } | null;
  ready: boolean[];
  narration: string | null;
}

const ORDER = [9, 11, 12, 13, 10, 14];
const rank = (c: KCard) => (c as PipCard).rank;
const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
/** A, 10, K, Q, J, 9. */
export const pinochlePower = (c: KCard) => ORDER.indexOf(rank(c));
const counter = (c: KCard) => rank(c) === 14 || rank(c) === 10 || rank(c) === 13;
const pointsOf = (cards: KCard[]) => cards.filter(counter).length * 10;
const sortHand = (cards: KCard[], trump: Suit | null) => sortCards(cards, pinochlePower, (c) => (trump && suitOf(c) === trump ? "spades" : suitOf(c) === "spades" && trump ? (trump as Suit) : suitOf(c)));

// ---- Meld ---------------------------------------------------------------------------------------

/**
 * A hand's meld with this trump. A card can count once in each kind of meld (kings around and a
 * marriage, say), but not twice in the same kind. Values are the usual "×10" scale.
 */
export function meldOf(hand: KCard[], trump: Suit): { points: number; cards: KCard[]; parts: string[] } {
  const count = (r: number, s: Suit) => hand.filter((c) => rank(c) === r && suitOf(c) === s).length;
  const parts: string[] = [];
  const used = new Set<string>();
  const take = (r: number, s: Suit, n: number) => {
    let left = n;
    for (const c of hand) if (left > 0 && rank(c) === r && suitOf(c) === s) (used.add(c.id), left--);
  };
  let points = 0;
  // Arounds: one of a rank in every suit (double: two of each).
  for (const [r, single, double, label] of [
    [14, 100, 1000, "aces"],
    [13, 80, 800, "kings"],
    [12, 60, 600, "queens"],
    [11, 40, 400, "jacks"],
  ] as const) {
    const n = Math.min(...SUITS.map((s) => count(r, s)));
    if (n >= 1) {
      points += n === 2 ? double : single;
      parts.push(n === 2 ? `Double ${label} around` : `${label[0]!.toUpperCase()}${label.slice(1)} around`);
      for (const s of SUITS) take(r, s, n);
    }
  }
  // Runs in trump: A 10 K Q J; then marriages (K Q); then the dix (9 of trump).
  const runs = Math.min(...[14, 10, 13, 12, 11].map((r) => count(r, trump)));
  if (runs >= 1) {
    points += runs === 2 ? 1500 : 150;
    parts.push(runs === 2 ? "Double run" : "Run");
    for (const r of [14, 10, 13, 12, 11]) take(r, trump, runs);
  }
  for (const s of SUITS) {
    const pairs = Math.min(count(13, s), count(12, s)) - (s === trump ? runs : 0);
    if (pairs > 0) {
      points += pairs * (s === trump ? 40 : 20);
      parts.push(`${pairs === 2 ? "Two " : ""}${s === trump ? "royal marriage" : "marriage"}${pairs === 2 ? "s" : ""} ${SYMBOL[s]}`);
      take(13, s, pairs + (s === trump ? runs : 0));
      take(12, s, pairs + (s === trump ? runs : 0));
    }
  }
  const dix = count(9, trump);
  if (dix) {
    points += dix * 10;
    parts.push(dix === 2 ? "Two dix" : "Dix");
    take(9, trump, dix);
  }
  // Pinochle: Q♠ J♦.
  const pin = Math.min(count(12, "spades"), count(11, "diamonds"));
  if (pin) {
    points += pin === 2 ? 300 : 40;
    parts.push(pin === 2 ? "Double pinochle" : "Pinochle");
    take(12, "spades", pin);
    take(11, "diamonds", pin);
  }
  return { points, cards: hand.filter((c) => used.has(c.id)), parts };
}

// ---- The game -----------------------------------------------------------------------------------

function deal(s: PinochleState) {
  const rand = nextRandom(s);
  const deck = shuffled(makeDeck({ ranks: ORDER, copies: 2 }), rand);
  s.hands = [0, 1, 2, 3].map((i) => sortHand(deck.slice(i * 12, i * 12 + 12), null));
  s.bid = 0;
  s.bidder = null;
  s.passed = [false, false, false, false];
  s.trump = null;
  s.meld = [];
  s.trick = [];
  s.lastTrick = null;
  s.taken = [0, 0];
  s.tricks = [0, 0];
  s.ready = [false, false, false, false];
  s.phase = "bidding";
  s.turn = (s.dealer + 1) % 4;
  s.narration = null;
}

export function newPinochle(rules: PinochleRules, _seats: number, seed: number): PinochleState {
  const s = { game: "pinochle", rules, seats: 4, rng: seed >>> 0, hand: 0, dealer: seed % 4, scores: [0, 0], lastHand: null } as unknown as PinochleState;
  deal(s);
  return s;
}

const nextBidder = (s: PinochleState, from: number) => {
  for (let i = 1; i <= 4; i++) if (!s.passed[(from + i) % 4]) return (from + i) % 4;
  return from;
};

/** The cards this seat may play: follow suit (beating if you must), else trump (over a trump), else anything. */
export function pinochleLegal(s: PinochleState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  const hand = s.hands[seat]!;
  if (!s.trick.length) return hand;
  const led = suitOf(s.trick[0]!.card);
  const trump = s.trump!;
  const winning = trickWinner(s.trick, trump, suitOf, pinochlePower);
  const beats = (c: KCard) => trickWinner([...s.trick, { seat, card: c }], trump, suitOf, pinochlePower).seat === seat;
  const follow = hand.filter((c) => suitOf(c) === led);
  if (follow.length) {
    if (!s.rules.mustBeat || (suitOf(winning.card) === trump && led !== trump)) return follow;
    const over = follow.filter(beats);
    return over.length ? over : follow;
  }
  const trumps = hand.filter((c) => suitOf(c) === trump);
  if (trumps.length) {
    if (!s.rules.mustBeat) return trumps;
    const over = trumps.filter(beats);
    return over.length ? over : trumps;
  }
  return hand;
}

type Move = { type: "bid"; bid: number } | { type: "pass" } | { type: "trump"; suit: Suit } | { type: "next" } | { type: "play"; card: string };

function apply(state: PinochleState, seat: number, move: Move): PinochleState {
  const s = clone(state);
  switch (move.type) {
    case "next": {
      if (s.phase === "meld") {
        if (markReady(s.ready, seat)) {
          s.phase = "playing";
          s.turn = s.bidder!;
          s.ready = [false, false, false, false];
          s.narration = `${who(s.bidder!)} leads`;
        }
        return s;
      }
      if (s.phase !== "scored") throw new GameError("The hand isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        s.dealer = (s.dealer + 1) % 4;
        deal(s);
      }
      return s;
    }
    case "bid":
    case "pass": {
      if (s.phase !== "bidding" || s.turn !== seat) throw new GameError("It's not your turn to bid.");
      if (move.type === "bid") {
        const least = s.bid ? s.bid + 10 : s.rules.minBid;
        if (!Number.isInteger(move.bid) || move.bid < least || move.bid % 10 !== 0) throw new GameError(`Bid at least ${least}, in tens.`);
        s.bid = move.bid;
        s.bidder = seat;
        s.narration = `${who(seat)} bid ${move.bid}`;
      } else {
        // Everyone else passed and nobody bid: the dealer is stuck with the minimum.
        if (s.rules.dealerStuck && s.bidder === null && seat === s.dealer && s.passed.filter(Boolean).length === 3) throw new GameError(`Everyone passed: the dealer takes it at ${s.rules.minBid}.`);
        s.passed[seat] = true;
        s.narration = `${who(seat)} passed`;
      }
      const left = s.passed.filter((p) => !p).length;
      if (left === 0) {
        // Four passes with the dealer not stuck: throw the hand in.
        s.dealer = (s.dealer + 1) % 4;
        deal(s);
        s.narration = "Everyone passed: the cards were dealt again.";
        return s;
      }
      if (left === 1 && s.bidder !== null) {
        s.phase = "trump";
        s.turn = s.bidder;
        s.narration = `${who(s.bidder)} won the bid at ${s.bid}`;
        return s;
      }
      s.turn = nextBidder(s, seat);
      return s;
    }
    case "trump": {
      if (s.phase !== "trump" || seat !== s.bidder) throw new GameError("It's not time to name trump.");
      if (!SUITS.includes(move.suit)) throw new GameError("That's not a suit.");
      s.trump = move.suit;
      s.hands = s.hands.map((h) => sortHand(h, s.trump));
      s.meld = s.hands.map((h) => meldOf(h, s.trump!));
      s.phase = "meld";
      s.ready = [false, false, false, false];
      s.narration = `${SYMBOL[move.suit]} is trump. Here's everyone's meld.`;
      return s;
    }
    case "play": {
      if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
      const card = s.hands[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      if (!pinochleLegal(s, seat).some((c) => c.id === card.id)) {
        const led = suitOf(s.trick[0]!.card);
        const has = s.hands[seat]!.some((c) => suitOf(c) === led);
        throw new GameError(has ? (s.rules.mustBeat ? `Follow ${SYMBOL[led]}, and beat the winning card if you can.` : `Follow ${SYMBOL[led]}.`) : `No ${SYMBOL[led]}: you have to trump${s.rules.mustBeat ? ", and beat a trump if you can" : ""}.`);
      }
      if (!s.trick.length) s.lastTrick = null;
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.trick.push({ seat, card });
      s.narration = null;
      if (s.trick.length < 4) {
        s.turn = (seat + 1) % 4;
        return s;
      }
      const win = trickWinner(s.trick, s.trump, suitOf, pinochlePower);
      const team = teamOfSeat(win.seat);
      s.taken[team] += pointsOf(s.trick.map((p) => p.card));
      s.tricks[team] += 1;
      s.lastTrick = { plays: s.trick, winner: win.seat };
      s.trick = [];
      s.turn = win.seat;
      if (s.hands.every((h) => h.length === 0)) {
        s.taken[team] += 10; // the last trick
        scoreHand(s);
      }
      return s;
    }
    default:
      throw new GameError("That's not a move in Pinochle.");
  }
}

function scoreHand(s: PinochleState) {
  const team = teamOfSeat(s.bidder!);
  const meld: [number, number] = [s.meld[0]!.points + s.meld[2]!.points, s.meld[1]!.points + s.meld[3]!.points];
  // Meld only counts for a side that took something in tricks (when that rule's on).
  const counted = meld.map((m, t) => (s.rules.saveMeld && s.taken[t] === 0 ? 0 : m)) as [number, number];
  const totals = counted.map((m, t) => m + s.taken[t]!) as [number, number];
  const set = totals[team] < s.bid;
  const points: [number, number] = [0, 0];
  points[team] = set ? -s.bid : totals[team];
  points[(1 - team) as 0 | 1] = totals[1 - team]!;
  s.scores = [s.scores[0] + points[0], s.scores[1] + points[1]];
  s.lastHand = { bidder: s.bidder!, bid: s.bid, meld: counted, tricks: [...s.taken] as [number, number], points, set };
  s.narration = set ? `Set! ${who(s.bidder!)} & ${who((s.bidder! + 2) % 4)} lose ${s.bid}` : `${who(s.bidder!)} & ${who((s.bidder! + 2) % 4)} made it with ${totals[team]}`;
  s.ready = [false, false, false, false];
  const reached = s.scores.map((n) => n >= s.rules.playTo);
  s.phase = reached.some(Boolean) ? "finished" : "scored";
}

/** The winners: the bidders if they reached the target, else whoever's ahead. */
function winningTeam(s: PinochleState): 0 | 1 {
  const team = s.lastHand ? teamOfSeat(s.lastHand.bidder) : 0;
  if (s.scores[team] >= s.rules.playTo) return team;
  return s.scores[0] >= s.scores[1] ? 0 : 1;
}

function view(s: PinochleState, seat: number): KitView {
  const over = s.phase === "finished";
  const choices: Choice[] = [];
  if (s.phase === "bidding" && s.turn === seat) {
    const least = s.bid ? s.bid + 10 : s.rules.minBid;
    for (const b of [least, least + 10, least + 20, least + 50]) choices.push({ label: String(b), move: { type: "bid", bid: b }, primary: b === least });
    const stuck = s.rules.dealerStuck && s.bidder === null && seat === s.dealer && s.passed.filter(Boolean).length === 3;
    if (!stuck) choices.push({ label: "Pass", move: { type: "pass" } });
  }
  if (s.phase === "trump" && seat === s.bidder) for (const suit of SUITS) choices.push({ label: `${SYMBOL[suit]} (meld ${meldOf(s.hands[seat]!, suit).points})`, move: { type: "trump", suit } });
  const nextReady = (s.phase === "meld" || s.phase === "scored") && !s.ready[seat];
  const melds: Meld[] = s.phase === "meld" ? s.meld.map((m, i) => ({ owner: teamOfSeat(i), byTeam: true, label: m.points ? `${who(i)} ${m.points}: ${m.parts.join(", ")}` : `${who(i)}: no meld`, cards: m.cards })) : [];
  const sides: [number[], number[]] = [
    [0, 2],
    [1, 3],
  ];
  const winner = over ? winningTeam(s) : null;
  return {
    game: "pinochle",
    seats: 4,
    me: seat,
    teams: true,
    phase: s.phase,
    turn: s.phase === "bidding" || s.phase === "trump" || s.phase === "playing" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: s.phase === "playing" && s.turn === seat ? { type: "play", cards: pinochleLegal(s, seat).map((c) => c.id) } : null,
    pick: null,
    choices: choices.length
      ? { prompt: s.phase === "trump" ? "You won the bid: name trump." : s.bid ? `High bid ${s.bid} by ${who(s.bidder!)}. Raise, or pass?` : `Open the bidding (at least ${s.rules.minBid}), or pass.`, options: choices, layout: s.phase === "bidding" ? "grid" : "row" }
      : nextReady
        ? { prompt: "", options: [{ label: s.phase === "meld" ? "Play the hand" : "Deal the next hand", move: { type: "next" }, primary: true }] }
        : null,
    players: s.hands.map((h, i) => ({
      cards: h.length,
      line: s.phase === "bidding" ? (s.passed[i] ? "Passed" : i === s.bidder ? `Bid ${s.bid}` : "") : s.meld[i] ? `Meld ${s.meld[i]!.points}` : "",
      team: teamOfSeat(i),
      dealer: i === s.dealer,
      badge: i === s.bidder && s.phase !== "bidding" ? `Bid ${s.bid}${s.trump ? ` · ${SYMBOL[s.trump]}` : ""}` : undefined,
    })),
    center: { kind: "trick", plays: s.trick.length ? s.trick : (s.lastTrick?.plays ?? []), winner: s.trick.length ? null : (s.lastTrick?.winner ?? null) },
    melds,
    info: [
      ...(s.trump ? [`Trump ${SYMBOL[s.trump]}`] : []),
      ...(s.phase === "playing" && s.bidder !== null ? [`Bid ${s.bid} · in tricks: ${s.taken[0]} to ${s.taken[1]}`] : []),
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
            key: `pinochle-${s.hand}`,
            title: s.lastHand.set ? "Set! 😬" : `${who(s.lastHand.bidder)} made the bid`,
            sides,
            rows: [
              { label: "Meld", values: s.lastHand.meld.map(String) },
              { label: "Tricks", values: s.lastHand.tricks.map(String) },
              { label: "This hand", values: s.lastHand.points.map((p) => (p > 0 ? `+${p}` : p < 0 ? `−${-p}` : "0")), tone: "score" },
              { label: "Score", values: s.scores.map(String), tone: "total" },
            ],
          }
        : null,
    over: winner !== null ? { winners: [winner, winner + 2], title: `${who(winner)} & ${who(winner + 2)} win ${s.scores[winner]} to ${s.scores[1 - winner]}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** About how many points this hand is worth with the best trump: meld, plus what it should take. */
export function handWorth(hand: KCard[]): { suit: Suit; meld: number; worth: number } {
  return SUITS.map((suit) => {
    const meld = meldOf(hand, suit).points;
    const trumps = hand.filter((c) => suitOf(c) === suit).length;
    const aces = hand.filter((c) => rank(c) === 14).length;
    // Measured over bot games: a partner brings about 27 meld, and the bidders take about
    // 70 + 11 a trump + 11 an ace in tricks.
    return { suit, meld, worth: meld + 27 + 70 + trumps * 11 + aces * 11 };
  }).sort((a, b) => b.worth - a.worth)[0]!;
}

function bot(s: PinochleState, seat: number, style: PlayStyle): Move | null {
  if ((s.phase === "meld" || s.phase === "scored") && !s.ready[seat]) return { type: "next" };
  if (s.turn !== seat) return null;
  const careless = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  const hand = s.hands[seat]!;
  if (s.phase === "bidding") {
    const least = s.bid ? s.bid + 10 : s.rules.minBid;
    const stuck = s.rules.dealerStuck && s.bidder === null && seat === s.dealer && s.passed.filter(Boolean).length === 3;
    if (stuck) return { type: "bid", bid: s.rules.minBid };
    // Don't outbid your partner without a reason.
    if (s.bidder === (seat + 2) % 4) return { type: "pass" };
    // A little under the estimate (hands vary), more for the bold.
    const limit = Math.floor((handWorth(hand).worth - 15 + (style.bold ?? 0) * 30) / 10) * 10;
    return least <= limit && !careless ? { type: "bid", bid: least } : { type: "pass" };
  }
  if (s.phase === "trump") return { type: "trump", suit: handWorth(hand).suit };
  if (s.phase !== "playing") return null;
  const legal = pinochleLegal(s, seat);
  if (legal.length === 1 || careless) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  const trump = s.trump!;
  const strength = (c: KCard) => pinochlePower(c) + (suitOf(c) === trump ? 10 : 0);
  if (!s.trick.length) {
    // Lead aces off-suit; otherwise low.
    const ace = legal.find((c) => rank(c) === 14 && suitOf(c) !== trump);
    return { type: "play", card: (ace ?? [...legal].sort((a, b) => strength(a) - strength(b))[0]!).id };
  }
  const winning = trickWinner(s.trick, trump, suitOf, pinochlePower);
  const partnerHasIt = teamOfSeat(winning.seat) === teamOfSeat(seat);
  const wins = legal.filter((c) => trickWinner([...s.trick, { seat, card: c }], trump, suitOf, pinochlePower).seat === seat);
  // Partner winning (and last, or with a strong card): give them points. Otherwise win cheaply, or throw low.
  if (partnerHasIt) {
    const points = legal.filter((c) => counter(c) && !wins.includes(c));
    return { type: "play", card: (points.sort((a, b) => strength(a) - strength(b))[0] ?? [...legal].sort((a, b) => strength(a) - strength(b))[0]!).id };
  }
  if (wins.length) return { type: "play", card: [...wins].sort((a, b) => strength(a) - strength(b))[0]!.id };
  const plain = legal.filter((c) => !counter(c));
  return { type: "play", card: [...(plain.length ? plain : legal)].sort((a, b) => strength(a) - strength(b))[0]!.id };
}

export const pinochle: CardGame<PinochleRules, PinochleState, Move> = {
  id: "pinochle",
  name: "Pinochle",
  emoji: "👑",
  blurb: "Partners, bidding, meld and tricks",
  tagline: "Bid, name trump, meld, then take the aces, tens and kings. Partners across.",
  seats: { min: 4, max: 4, default: 4 },
  teams: true,
  presets: [classicPinochle, quickPinochle, easyPinochle, toughPinochle],
  fields: [
    { key: "playTo", label: "Game to", kind: "choice", options: [[1000, "1,000"], [1500, "1,500"], [2000, "2,000"]] },
    { key: "minBid", label: "Lowest bid", kind: "choice", options: [[200, "200"], [250, "250"], [300, "300"]] },
    { key: "mustBeat", label: "Must beat the trick", hint: "When you follow suit or trump, play higher than the winning card if you can.", kind: "toggle" },
    { key: "dealerStuck", label: "Dealer stuck", hint: "If everyone passes, the dealer takes the lowest bid.", kind: "toggle" },
    { key: "saveMeld", label: "Take a trick to save your meld", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<PinochleRules>;
    const base = [classicPinochle, quickPinochle, easyPinochle, toughPinochle].find((p) => p.id === given.id) ?? classicPinochle;
    return { ...base, ...given };
  },
  validate(r) {
    const errors: string[] = [];
    if (!(r.playTo >= 500 && r.playTo <= 5000)) errors.push("Play to between 500 and 5,000.");
    if (!(r.minBid >= 100 && r.minBid <= 400 && r.minBid % 10 === 0)) errors.push("The lowest bid is 100 to 400, in tens.");
    return errors;
  },
  describe(r) {
    return [
      "Partners across. A 48-card deck: two each of A, 10, K, Q, J, 9 in every suit (the 10 is just under the ace). Twelve cards each.",
      `Bid for the right to name trump, from ${r.minBid} up in tens. ${r.dealerStuck ? "If everyone passes, the dealer takes it at the lowest bid." : "If everyone passes, the cards are dealt again."}`,
      "Meld is found for you and shown on the table: a run in trump (A 10 K Q J) 150, royal marriage 40, marriage 20, dix (9 of trump) 10, aces around 100, kings 80, queens 60, jacks 40, pinochle (Q♠ J♦) 40. Doubles are worth much more.",
      `Then twelve tricks: follow suit${r.mustBeat ? " and beat the winning card if you can" : ""}; with none, trump. Aces, tens and kings are 10 each, and the last trick 10.`,
      `The bidders need meld plus tricks to reach their bid, or they lose the bid.${r.saveMeld ? " A side's meld only counts if it takes a point in tricks." : ""} First to ${r.playTo} wins.`,
    ];
  },
  newGame: newPinochle,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "bidding") return 1700;
    if (s.phase === "trump") return 1500;
    if (s.phase === "meld" || s.phase === "scored") return 1400;
    return thinkFor(pinochleLegal(s, seat).length);
  },
  summary(s) {
    const over = s.phase === "finished";
    const w = winningTeam(s);
    return {
      game: "pinochle",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: `${s.scores[0]} to ${s.scores[1]}`,
      order: over ? rankSeats(w === 0 ? [{ seats: [0, 2], score: 1 }, { seats: [1, 3], score: 0 }] : [{ seats: [1, 3], score: 1 }, { seats: [0, 2], score: 0 }]) : null,
      winners: over ? [w, w + 2] : null,
      teams: true,
      seats: 4,
    };
  },
};
