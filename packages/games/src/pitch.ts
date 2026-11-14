// Pitch (Auction Pitch, or Setback): six cards each, then an auction for the right to "pitch". The
// high bidder leads, and that first card's suit is trump. Four points are up for grabs: High (the
// highest trump played), Low (the lowest trump played), Jack (whoever takes the jack of trump) and
// Game (the most card points in your tricks: tens 10, aces 4, kings 3, queens 2, jacks 1). Make your
// bid and you score what you won; fall short and you're set back by your bid. First to 11 wins.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  markReady,
  nextRandom,
  rankLabel,
  rankSeats,
  shuffled,
  sortCards,
  SUITS,
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type Choice,
  type KCard,
  type KitView,
  type PipCard,
} from "./kit.js";
import { bestLoser, cheapestWinner, trickWinner, type Play } from "./tricks.js";

export interface PitchRules extends BaseRules {
  playTo: number;
  /** Low goes to whoever takes it in a trick, instead of whoever played it. */
  lowToTaker: boolean;
  /** Everyone passes: the dealer must bid 2 (else the hand is thrown in and redealt). */
  stickDealer: boolean;
}

export const classicPitch: PitchRules = { id: "pitch-classic", name: "Pitch (to 11)", playTo: 11, lowToTaker: false, stickDealer: true };
export const longPitch: PitchRules = { ...classicPitch, id: "pitch-long", name: "Long game (to 21)", playTo: 21 };
export const setbackPitch: PitchRules = { ...classicPitch, id: "pitch-setback", name: "Setback (low to the taker)", lowToTaker: true };

type Point = "high" | "low" | "jack" | "game";

export interface PitchState {
  game: "pitch";
  rules: PitchRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: "bidding" | "playing" | "scored" | "finished";
  hands: KCard[][];
  /** Each seat's bid this hand: null not yet, 0 passed. */
  bids: (number | null)[];
  bidder: number | null;
  trump: Suit | null;
  trick: Play[];
  lastTrick: { plays: Play[]; winner: number } | null;
  /** Cards each seat has taken in tricks. */
  taken: KCard[][];
  /** Every card played, and by whom (for High and Low). */
  played: Play[];
  turn: number;
  scores: number[];
  lastHand: { bidder: number; bid: number; won: Record<Point, number | null>; points: number[]; made: boolean; gamePoints: number[] } | null;
  ready: boolean[];
  narration: string | null;
}

const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const power = (c: KCard) => (c as PipCard).rank;
const label = (c: KCard) => `${rankLabel(power(c))}${SYMBOL[suitOf(c)]}`;
/** Points toward Game. */
export const gameValue = (c: KCard) => ({ 10: 10, 14: 4, 13: 3, 12: 2, 11: 1 } as Record<number, number>)[power(c)] ?? 0;
const POINT_NAMES: Record<Point, string> = { high: "High", low: "Low", jack: "Jack", game: "Game" };

function deal(s: PitchState) {
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hands = Array.from({ length: s.seats }, (_, i) => sortCards(deck.slice(i * 6, i * 6 + 6)));
  s.bids = Array(s.seats).fill(null);
  s.bidder = null;
  s.trump = null;
  s.trick = [];
  s.lastTrick = null;
  s.taken = Array.from({ length: s.seats }, () => []);
  s.played = [];
  s.turn = (s.dealer + 1) % s.seats;
  s.ready = Array(s.seats).fill(false);
  s.phase = "bidding";
}

export function newPitch(rules: PitchRules, seats: number, seed: number): PitchState {
  const s = { game: "pitch", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, scores: Array(seats).fill(0), lastHand: null, narration: null } as unknown as PitchState;
  deal(s);
  return s;
}

const highBid = (s: PitchState) => Math.max(0, ...s.bids.map((b) => b ?? 0));

/** The bids this seat may make: pass, or more than the high bid, up to 4. */
export function pitchBids(s: PitchState, seat: number): number[] {
  if (s.phase !== "bidding" || s.turn !== seat) return [];
  const out: number[] = [];
  for (let b = Math.max(2, highBid(s) + 1); b <= 4; b++) out.push(b);
  const everyonePassed = s.bids.every((b, i) => i === seat || b === 0);
  if (!(seat === s.dealer && everyonePassed && s.rules.stickDealer)) out.unshift(0);
  return out;
}

/** What may be played: anything to lead; after that the suit led or a trump; trumps led must be followed. */
export function pitchLegal(s: PitchState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  const hand = s.hands[seat]!;
  if (!s.trick.length) return hand;
  const led = suitOf(s.trick[0]!.card);
  const same = hand.filter((c) => suitOf(c) === led);
  if (!same.length) return hand;
  if (led === s.trump) return same;
  return hand.filter((c) => suitOf(c) === led || suitOf(c) === s.trump);
}

type Move = { type: "bid"; bid: number } | { type: "play"; card: string } | { type: "next" };

function apply(state: PitchState, seat: number, move: Move): PitchState {
  const s = clone(state);
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
  if (move.type === "bid") {
    if (s.phase !== "bidding" || s.turn !== seat) throw new GameError("It's not your turn to bid.");
    const bid = Number(move.bid);
    if (!pitchBids(s, seat).includes(bid)) throw new GameError(bid === 0 ? "Everyone passed: the dealer has to bid." : `Bid more than ${highBid(s)}, up to 4, or pass.`);
    s.bids[seat] = bid;
    s.narration = bid ? `${who(seat)} bid ${bid}` : `${who(seat)} passed`;
    if (seat === s.dealer) {
      const top = highBid(s);
      if (!top) {
        // Everyone passed and the dealer isn't stuck: throw the hand in.
        s.narration = "Everyone passed: new deal";
        s.dealer = (s.dealer + 1) % s.seats;
        deal(s);
        return s;
      }
      s.bidder = s.bids.findIndex((b) => b === top);
      s.phase = "playing";
      s.turn = s.bidder;
      s.narration = `${who(s.bidder)} won the bid at ${top} and pitches`;
    } else s.turn = (seat + 1) % s.seats;
    return s;
  }
  if (move.type !== "play") throw new GameError("That's not a move in Pitch.");
  if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
  const card = s.hands[seat]!.find((c) => c.id === move.card);
  if (!card) throw new GameError("You don't have that card.");
  if (!pitchLegal(s, seat).some((c) => c.id === card.id)) {
    const led = suitOf(s.trick[0]!.card);
    throw new GameError(led === s.trump ? `Trump was led: play a ${SYMBOL[led]}.` : `Follow suit (${SYMBOL[led]}) or play a trump.`);
  }
  if (!s.trump) {
    s.trump = suitOf(card);
    s.narration = `${who(seat)} pitched the ${label(card)}: ${SYMBOL[s.trump]} are trump`;
  } else s.narration = null;
  if (!s.trick.length) s.lastTrick = null;
  s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
  s.trick.push({ seat, card });
  s.played.push({ seat, card });
  if (s.trick.length < s.seats) {
    s.turn = (seat + 1) % s.seats;
    return s;
  }
  const win = trickWinner(s.trick, s.trump, suitOf, power);
  s.taken[win.seat]!.push(...s.trick.map((p) => p.card));
  s.lastTrick = { plays: s.trick, winner: win.seat };
  s.trick = [];
  s.turn = win.seat;
  if (s.hands.every((h) => !h.length)) scoreHand(s);
  return s;
}

/** Who wins each point: High, Low, Jack and Game (null when nobody does). */
export function pitchPoints(s: PitchState): { won: Record<Point, number | null>; gamePoints: number[] } {
  const trumps = s.played.filter((p) => suitOf(p.card) === s.trump);
  const takerOf = (id: string) => s.taken.findIndex((t) => t.some((c) => c.id === id));
  const high = trumps.reduce<Play | null>((b, p) => (!b || power(p.card) > power(b.card) ? p : b), null);
  const low = trumps.reduce<Play | null>((b, p) => (!b || power(p.card) < power(b.card) ? p : b), null);
  const jack = trumps.find((p) => power(p.card) === 11);
  const gamePoints = s.taken.map((t) => t.reduce((n, c) => n + gameValue(c), 0));
  const best = Math.max(...gamePoints);
  const leaders = gamePoints.flatMap((n, i) => (n === best ? [i] : []));
  return {
    won: {
      high: high ? high.seat : null,
      low: low ? (s.rules.lowToTaker ? takerOf(low.card.id) : low.seat) : null,
      jack: jack ? takerOf(jack.card.id) : null,
      game: leaders.length === 1 && best > 0 ? leaders[0]! : null,
    },
    gamePoints,
  };
}

function scoreHand(s: PitchState) {
  const { won, gamePoints } = pitchPoints(s);
  const bidder = s.bidder!;
  const bid = s.bids[bidder]!;
  const got = Array(s.seats).fill(0) as number[];
  for (const p of Object.values(won)) if (p !== null) got[p]! += 1;
  const made = got[bidder]! >= bid;
  const points = got.map((n, i) => (i === bidder && !made ? -bid : n));
  s.scores = s.scores.map((n, i) => n + points[i]!);
  s.lastHand = { bidder, bid, won, points, made, gamePoints };
  s.narration = made ? `${who(bidder)} made the bid of ${bid}` : `${who(bidder)} was set back ${bid}`;
  s.ready = Array(s.seats).fill(false);
  // The bidder goes out first; otherwise the highest score over the line.
  const over = s.scores.map((n, i) => (n >= s.rules.playTo ? i : -1)).filter((i) => i >= 0);
  const top = Math.max(...s.scores);
  const done = over.includes(bidder) || (over.length > 0 && s.scores.filter((n) => n === top).length === 1);
  s.phase = done ? "finished" : "scored";
}

function winners(s: PitchState): number[] {
  const bidder = s.lastHand?.bidder;
  if (bidder !== undefined && s.scores[bidder]! >= s.rules.playTo) return [bidder];
  const top = Math.max(...s.scores);
  return s.scores.flatMap((n, i) => (n === top ? [i] : []));
}

function view(s: PitchState, seat: number): KitView {
  const over = s.phase === "finished";
  const bids = pitchBids(s, seat);
  let choices: KitView["choices"] = null;
  if (bids.length) {
    const options: Choice[] = bids.map((b) => ({ label: b ? String(b) : "Pass", move: { type: "bid", bid: b } }));
    choices = { prompt: highBid(s) ? `The bid is ${highBid(s)}. Bid higher, or pass.` : bids.includes(0) ? "How many points will you take?" : "Everyone passed: you have to bid.", options, layout: "row" };
  } else if (s.phase === "scored" && !s.ready[seat]) choices = { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] };
  const lh = s.lastHand;
  const pointRow = (p: Point) => ({ label: POINT_NAMES[p], values: s.scores.map((_, i) => (lh?.won[p] === i ? "✓" : "")) });
  return {
    game: "pitch",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "bidding" || s.phase === "playing" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: s.phase === "playing" && s.turn === seat ? { type: "play", cards: pitchLegal(s, seat).map((c) => c.id) } : null,
    pick: null,
    choices,
    players: s.hands.map((h, i) => ({
      cards: h.length,
      line: s.phase === "bidding" ? (s.bids[i] === null ? "" : s.bids[i] ? `Bid ${s.bids[i]}` : "Passed") : i === s.bidder ? `Bid ${s.bids[i]}` : "",
      dealer: i === s.dealer,
      badge: i === s.bidder && s.phase === "playing" ? "Pitcher" : undefined,
    })),
    center: { kind: "trick", plays: s.trick.length ? s.trick : (s.lastTrick?.plays ?? []), winner: s.trick.length ? null : (s.lastTrick?.winner ?? null) },
    melds: [],
    info: [
      s.trump ? `Trump ${SYMBOL[s.trump]}` : s.phase === "playing" ? "The first card sets trump" : "High · Low · Jack · Game",
      ...(s.bidder !== null && s.phase === "playing" ? [`${who(s.bidder)} bid ${s.bids[s.bidder]}`] : []),
      `To ${s.rules.playTo}`,
    ],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result:
      lh && (s.phase === "scored" || over)
        ? {
            key: `pitch-${s.hand}`,
            title: lh.made ? `${who(lh.bidder)} made ${lh.bid}` : `${who(lh.bidder)} was set back ${lh.bid}`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              pointRow("high"),
              pointRow("low"),
              pointRow("jack"),
              { label: "Game", values: lh.gamePoints.map((n, i) => `${n}${lh.won.game === i ? " ✓" : ""}`) },
              { label: "This hand", values: lh.points.map((p) => (p > 0 ? `+${p}` : String(p))), tone: "score" },
              { label: "Total", values: s.scores.map(String), tone: "total" },
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: winners(s).length > 1 ? "A tie at the top" : `${who(winners(s)[0]!)} wins with ${s.scores[winners(s)[0]!]}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** The best suit to pitch and how many points it should bring. */
export function pitchEstimate(hand: KCard[], seats: number): { suit: Suit; points: number } {
  let best = { suit: SUITS[0]!, points: -1 };
  for (const suit of SUITS) {
    const cards = hand.filter((c) => suitOf(c) === suit);
    if (!cards.length) continue;
    const ranks = cards.map(power);
    const top = Math.max(...ranks);
    const bottom = Math.min(...ranks);
    let p = top === 14 ? 1 : top === 13 ? 0.65 : top === 12 ? 0.35 : 0.1;
    p += bottom === 2 ? 0.95 : bottom === 3 ? 0.65 : bottom <= 5 ? 0.35 : 0.1;
    if (ranks.includes(11)) p += cards.length >= 3 || ranks.includes(14) ? 0.75 : 0.45;
    p += Math.min(0.7, hand.filter((c) => power(c) === 10 || power(c) === 14).length * 0.15 + cards.length * 0.08);
    p *= seats <= 2 ? 1.1 : seats >= 5 ? 0.85 : 1;
    if (p > best.points) best = { suit, points: p };
  }
  return best;
}

function bot(s: PitchState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.25;
  if (s.phase === "bidding") {
    if (s.turn !== seat) return null;
    const bids = pitchBids(s, seat);
    const est = Math.floor(pitchEstimate(s.hands[seat]!, s.seats).points + (style.bold ?? 0.3) * 0.6);
    const pick = bids.filter((b) => b > 0 && b <= est).at(-1) ?? (bids.includes(0) ? 0 : bids[0]!);
    return { type: "bid", bid: pick };
  }
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const legal = pitchLegal(s, seat);
  if (legal.length === 1 || sloppy) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  // Pitching: lead the top of the best suit.
  if (!s.trump) {
    const suit = pitchEstimate(s.hands[seat]!, s.seats).suit;
    return { type: "play", card: [...legal].filter((c) => suitOf(c) === suit).sort((a, b) => power(b) - power(a))[0]!.id };
  }
  const trump = s.trump;
  if (!s.trick.length) {
    // Lead high trumps while they're boss, otherwise a low card that gives little away.
    const myTrumps = legal.filter((c) => suitOf(c) === trump).sort((a, b) => power(b) - power(a));
    // Trumps above my best that haven't shown up yet (somebody may hold them).
    const seen = new Set([...s.played, ...s.hands[seat]!.map((card) => ({ card }))].map((p) => p.card.id));
    const higher = makeDeck({ ranks: FULL }).filter((c) => suitOf(c) === trump && power(c) > power(myTrumps[0] ?? c) && !seen.has(c.id));
    if (myTrumps.length && !higher.length && seat === s.bidder) return { type: "play", card: myTrumps[0]!.id };
    const plain = legal.filter((c) => suitOf(c) !== trump).sort((a, b) => gameValue(a) - gameValue(b) || power(a) - power(b));
    return { type: "play", card: (plain[0] ?? legal.sort((a, b) => power(a) - power(b))[0]!).id };
  }
  const worth = s.trick.reduce((n, p) => n + gameValue(p.card) + (suitOf(p.card) === trump && power(p.card) === 11 ? 20 : 0), 0);
  const win = cheapestWinner(legal, seat, s.trick, trump, suitOf, power);
  // Take tricks with something in them, or protect a ten or the jack.
  const precious = legal.some((c) => power(c) === 10 || (suitOf(c) === trump && power(c) === 11));
  if (win && (worth >= 3 || precious || s.trick.length === s.seats - 1)) return { type: "play", card: win.id };
  // Losing anyway: don't throw points away.
  const losers = legal.filter((c) => !win || c.id !== win.id).sort((a, b) => gameValue(a) - gameValue(b) || power(a) - power(b));
  return { type: "play", card: (losers.find((c) => !(suitOf(c) === trump && power(c) === 11)) ?? bestLoser(legal, seat, s.trick, trump, suitOf, power)).id };
}

export const pitch: CardGame<PitchRules, PitchState, Move> = {
  id: "pitch",
  name: "Pitch",
  emoji: "⚾",
  blurb: "Bid for High, Low, Jack and Game",
  tagline: "Win the bid, pitch the first card to set trump, and take High, Low, Jack and Game.",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [classicPitch, longPitch, setbackPitch],
  fields: [
    { key: "playTo", label: "Play to", kind: "choice", options: [[7, "7"], [11, "11"], [15, "15"], [21, "21"]] },
    { key: "lowToTaker", label: "Low goes to whoever takes it", hint: "Instead of whoever played it.", kind: "toggle" },
    { key: "stickDealer", label: "Stick the dealer", hint: "If everyone passes, the dealer has to bid 2.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<PitchRules>;
    const base = [classicPitch, longPitch, setbackPitch].find((p) => p.id === given.id) ?? classicPitch;
    const r = { ...base, ...given };
    return { ...r, playTo: Number(r.playTo) };
  },
  validate(r) {
    return r.playTo >= 5 && r.playTo <= 52 ? [] : ["Play to between 5 and 52."];
  },
  describe(r) {
    return [
      "Six cards each. Bid how many of the four points you'll take (2 to 4), or pass; each bid must be higher.",
      `${r.stickDealer ? "If everyone passes, the dealer has to bid 2." : "If everyone passes, the hand is thrown in."} The high bidder pitches: the first card they lead sets trump.`,
      "Follow the suit led or play a trump; when trump is led, follow trump if you can.",
      `The points: High (the highest trump played), Low (the lowest trump played, to whoever ${r.lowToTaker ? "takes it" : "played it"}), Jack (whoever takes the jack of trump) and Game (the most card points in your tricks: tens 10, aces 4, kings 3, queens 2, jacks 1; a tie scores nobody).`,
      `Make your bid and score what you won; fall short and lose your bid. Everyone else scores what they won. First to ${r.playTo} wins, and the bidder goes out first.`,
    ];
  },
  newGame: newPitch,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "bidding") return 1500;
    if (s.phase === "scored") return 900;
    return thinkFor(pitchLegal(s, seat).length);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "pitch",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats(s.scores.map((score, i) => ({ seats: [i], score }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
