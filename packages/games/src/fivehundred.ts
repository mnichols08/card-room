// Five Hundred: partners across the table, a 43-card deck (5s up, the red 4s, and a joker), ten cards
// each and a kitty of three. Bid how many tricks your side will take (6 to 10) and in what: spades,
// clubs, diamonds, hearts or no trumps; or Misère, to lose every trick alone. The joker is the top
// trump, then the jack of trumps (right bower) and the other jack of its colour (left bower). Make
// your bid and score it; fail and lose it. The other side scores 10 a trick. First to 500 wins.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
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
  teamOfSeat,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type Choice,
  type KCard,
  type KitView,
} from "./kit.js";
import { bestLoser, cheapestWinner, trickWinner, type Play } from "./tricks.js";

export interface FiveHundredRules extends BaseRules {
  /** Misère (lose every trick, alone) can be bid, worth 250. */
  misere: boolean;
  /** Taking all ten tricks scores at least 250. */
  slam: boolean;
}

export const classic500: FiveHundredRules = { id: "500-classic", name: "Five Hundred", misere: true, slam: true };
export const plain500: FiveHundredRules = { ...classic500, id: "500-plain", name: "No misère", misere: false };

export type Denom = Suit | "nt" | "misere";
export interface Bid500 {
  tricks: number;
  denom: Denom;
}
const DENOMS: Denom[] = ["spades", "clubs", "diamonds", "hearts", "nt"];
const BASE: Record<Denom, number> = { spades: 40, clubs: 60, diamonds: 80, hearts: 100, nt: 120, misere: 250 };
export const bidValue = (b: Bid500) => (b.denom === "misere" ? 250 : BASE[b.denom] + (b.tricks - 6) * 100);
export const bidName500 = (b: Bid500) => (b.denom === "misere" ? "Misère" : `${b.tricks}${b.denom === "nt" ? " no trumps" : SYMBOL[b.denom]}`);
const shortBid = (b: Bid500) => (b.denom === "misere" ? "Misère" : `${b.tricks}${b.denom === "nt" ? "NT" : SYMBOL[b.denom]}`);

/** Every bid there is, cheapest first. */
export function allBids(rules: FiveHundredRules): Bid500[] {
  const out: Bid500[] = [];
  for (let t = 6; t <= 10; t++) for (const d of DENOMS) out.push({ tricks: t, denom: d });
  if (rules.misere) out.push({ tricks: 0, denom: "misere" });
  return out.sort((a, b) => bidValue(a) - bidValue(b));
}

export interface FiveHundredState {
  game: "fivehundred";
  rules: FiveHundredRules;
  seats: 4;
  rng: number;
  hand: number;
  dealer: number;
  phase: "bidding" | "kitty" | "playing" | "nominate" | "scored" | "finished";
  hands: KCard[][];
  kitty: KCard[];
  bids: (Bid500 | null)[];
  passed: boolean[];
  high: { seat: number; bid: Bid500 } | null;
  trick: Play[];
  /** The suit the joker stands for when it's led in no trumps or misère. */
  jokerSuit: Suit | null;
  lastTrick: { plays: Play[]; winner: number } | null;
  turn: number;
  tricksWon: number[];
  scores: [number, number];
  lastHand: { seat: number; bid: Bid500; tricks: [number, number]; points: [number, number]; made: boolean } | null;
  ready: boolean[];
  narration: string | null;
}

const RED: Suit[] = ["hearts", "diamonds"];
const isJoker = (c: KCard) => c.kind === "joker";
const rank = (c: KCard) => (c as { rank: number }).rank;
const rawSuit = (c: KCard) => (c as { suit: Suit }).suit;
const trumpOf = (s: FiveHundredState): Suit | null => (s.high && s.high.bid.denom !== "nt" && s.high.bid.denom !== "misere" ? s.high.bid.denom : null);
const isRight = (c: KCard, trump: Suit | null) => !!trump && !isJoker(c) && rank(c) === 11 && rawSuit(c) === trump;
const isLeft = (c: KCard, trump: Suit | null) => !!trump && !isJoker(c) && rank(c) === 11 && rawSuit(c) !== trump && RED.includes(rawSuit(c)) === RED.includes(trump);
/** The suit a card counts as. The joker is a trump; with no trumps it's the suit it was led as (or none). */
const suitFor = (trump: Suit | null, jokerSuit: Suit | null) => (c: KCard): Suit => (isJoker(c) ? (trump ?? jokerSuit ?? ("joker" as Suit)) : isLeft(c, trump) ? trump! : rawSuit(c));
const powerFor = (trump: Suit | null) => (c: KCard): number => (isJoker(c) ? 1000 : isRight(c, trump) ? 100 : isLeft(c, trump) ? 99 : rank(c));
const label = (c: KCard) => (isJoker(c) ? "joker" : `${rankLabel(rank(c))}${SYMBOL[rawSuit(c)]}`);
const partnerOf = (seat: number) => (seat + 2) % 4;
const sitter = (s: FiveHundredState) => (s.high?.bid.denom === "misere" ? partnerOf(s.high.seat) : null);
const inHand = (s: FiveHundredState) => (sitter(s) === null ? 4 : 3);
const nextSeat = (s: FiveHundredState, seat: number) => {
  let n = (seat + 1) % 4;
  if (n === sitter(s)) n = (n + 1) % 4;
  return n;
};
const sortFor = (cards: KCard[], trump: Suit | null) => sortCards(cards, powerFor(trump), (c) => (isJoker(c) ? (trump ?? "joker") : suitFor(trump, null)(c)));

/** The 43-card deck: 5 to ace, the red 4s, and a joker. */
export function deck500(): KCard[] {
  const deck = makeDeck({ ranks: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14], jokers: 1 });
  return [...deck, ...makeDeck({ ranks: [4] }).filter((c) => RED.includes(rawSuit(c)))];
}

function deal(s: FiveHundredState) {
  const deck = shuffled(deck500(), nextRandom(s));
  s.hands = [0, 1, 2, 3].map((i) => sortFor(deck.slice(i * 10, i * 10 + 10), null));
  s.kitty = deck.slice(40);
  s.bids = [null, null, null, null];
  s.passed = [false, false, false, false];
  s.high = null;
  s.trick = [];
  s.jokerSuit = null;
  s.lastTrick = null;
  s.tricksWon = [0, 0, 0, 0];
  s.ready = [false, false, false, false];
  s.phase = "bidding";
  s.turn = (s.dealer + 1) % 4;
}

export function newFiveHundred(rules: FiveHundredRules, _seats: number, seed: number): FiveHundredState {
  const s = { game: "fivehundred", rules, seats: 4, rng: seed >>> 0, hand: 0, dealer: seed % 4, scores: [0, 0], lastHand: null, narration: null } as unknown as FiveHundredState;
  deal(s);
  return s;
}

/** The bids this seat may make now (passing is always allowed). */
export function bidsFor(s: FiveHundredState, seat: number): Bid500[] {
  if (s.phase !== "bidding" || s.turn !== seat) return [];
  const floor = s.high ? bidValue(s.high.bid) : 0;
  return allBids(s.rules).filter((b) => bidValue(b) > floor);
}

export function legal500(s: FiveHundredState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  const hand = s.hands[seat]!;
  if (!s.trick.length) return hand;
  const trump = trumpOf(s);
  const suitOf = suitFor(trump, s.jokerSuit);
  const led = suitOf(s.trick[0]!.card);
  const same = hand.filter((c) => !isJoker(c) && suitOf(c) === led);
  // With trumps the joker is a trump and follows trump leads; without, it's played when you're out of the suit led.
  if (trump) {
    const follow = hand.filter((c) => suitOf(c) === led);
    return follow.length ? follow : hand;
  }
  return same.length ? same : hand;
}

type Move =
  | { type: "bid"; tricks: number; denom: Denom }
  | { type: "pass" }
  | { type: "discard"; cards: string[] }
  | { type: "play"; card: string }
  | { type: "nominate"; suit: Suit }
  | { type: "next" };

function nextBidder(s: FiveHundredState, from: number): number | null {
  for (let i = 1; i <= 4; i++) {
    const n = (from + i) % 4;
    if (!s.passed[n]) return n;
  }
  return null;
}

function apply(state: FiveHundredState, seat: number, move: Move): FiveHundredState {
  const s = clone(state);
  switch (move.type) {
    case "next": {
      if (s.phase !== "scored") throw new GameError("The hand isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        s.dealer = (s.dealer + 1) % 4;
        s.narration = null;
        deal(s);
      }
      return s;
    }
    case "pass":
    case "bid": {
      if (s.phase !== "bidding" || s.turn !== seat) throw new GameError("It's not your turn to bid.");
      if (move.type === "bid") {
        const bid: Bid500 = { tricks: Number(move.tricks), denom: move.denom };
        if (!bidsFor(s, seat).some((b) => b.tricks === bid.tricks && b.denom === bid.denom)) throw new GameError(s.high ? `Bid more than ${bidName500(s.high.bid)} (${bidValue(s.high.bid)}).` : "That's not a bid.");
        s.bids[seat] = bid;
        s.high = { seat, bid };
        s.narration = `${who(seat)} bid ${bidName500(bid)}`;
      } else {
        s.passed[seat] = true;
        s.narration = `${who(seat)} passed`;
      }
      const left = s.passed.filter((p) => !p).length;
      if (left === 0) {
        s.narration = "Everyone passed: new deal";
        s.dealer = (s.dealer + 1) % 4;
        deal(s);
        return s;
      }
      if (left === 1 && s.high && !s.passed[s.high.seat]) {
        // The auction is won: the kitty goes to the bidder.
        const w = s.high.seat;
        s.hands[w] = sortFor([...s.hands[w]!, ...s.kitty], trumpOf(s));
        s.kitty = [];
        s.phase = "kitty";
        s.turn = w;
        s.narration = `${who(w)} won the bid: ${bidName500(s.high.bid)}${s.high.bid.denom === "misere" ? `, and ${who(partnerOf(w))} sits out` : ""}`;
        return s;
      }
      s.turn = nextBidder(s, seat)!;
      return s;
    }
    case "discard": {
      if (s.phase !== "kitty" || s.turn !== seat) throw new GameError("It's not time to discard.");
      if (!Array.isArray(move.cards) || new Set(move.cards).size !== 3) throw new GameError("Put three cards back.");
      const hand = s.hands[seat]!;
      if (!move.cards.every((id) => hand.some((c) => c.id === id))) throw new GameError("You don't have those cards.");
      s.kitty = hand.filter((c) => move.cards.includes(c.id));
      s.hands[seat] = hand.filter((c) => !move.cards.includes(c.id));
      const trump = trumpOf(s);
      s.hands = s.hands.map((h) => sortFor(h, trump));
      s.phase = "playing";
      s.turn = seat;
      s.narration = `${who(seat)} leads`;
      return s;
    }
    case "nominate": {
      if (s.phase !== "nominate" || s.turn !== seat) throw new GameError("It's not time to name a suit.");
      if (!SUITS.includes(move.suit)) throw new GameError("That's not a suit.");
      s.jokerSuit = move.suit;
      s.phase = "playing";
      s.narration = `${who(seat)} led the joker as ${SYMBOL[move.suit]}`;
      s.turn = nextSeat(s, seat);
      return s;
    }
    case "play": {
      if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
      const card = s.hands[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      if (!legal500(s, seat).some((c) => c.id === card.id)) throw new GameError("Follow the suit led if you can (the joker and the left bower are trumps).");
      if (!s.trick.length) {
        s.lastTrick = null;
        s.jokerSuit = null;
      }
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.trick.push({ seat, card });
      s.narration = null;
      // The joker led with no trumps: its leader says which suit it is.
      if (s.trick.length === 1 && isJoker(card) && !trumpOf(s)) {
        s.phase = "nominate";
        return s;
      }
      if (s.trick.length < inHand(s)) {
        s.turn = nextSeat(s, seat);
        return s;
      }
      const trump = trumpOf(s);
      const joker = s.trick.find((p) => isJoker(p.card));
      const win = joker ?? trickWinner(s.trick, trump, suitFor(trump, s.jokerSuit), powerFor(trump));
      s.tricksWon[win.seat]! += 1;
      s.lastTrick = { plays: s.trick, winner: win.seat };
      s.trick = [];
      s.turn = win.seat;
      // Misère is lost the moment the bidder takes a trick.
      const misereLost = s.high!.bid.denom === "misere" && win.seat === s.high!.seat;
      if (misereLost || s.hands[win.seat]!.length === 0) scoreHand(s);
      return s;
    }
    default:
      throw new GameError("That's not a move in Five Hundred.");
  }
}

/** What each side scores for a hand. */
export function score500(rules: FiveHundredRules, bid: Bid500, bidderTricks: number, otherTricks: number): { bidders: number; others: number; made: boolean } {
  if (bid.denom === "misere") {
    const made = bidderTricks === 0;
    return { bidders: made ? 250 : -250, others: 0, made };
  }
  const made = bidderTricks >= bid.tricks;
  const value = bidValue(bid);
  const bidders = made ? (rules.slam && bidderTricks === 10 ? Math.max(value, 250) : value) : -value;
  return { bidders, others: otherTricks * 10, made };
}

function scoreHand(s: FiveHundredState) {
  const { seat, bid } = s.high!;
  const team = teamOfSeat(seat);
  const tricks: [number, number] = [s.tricksWon[0]! + s.tricksWon[2]!, s.tricksWon[1]! + s.tricksWon[3]!];
  const bidderTricks = bid.denom === "misere" ? s.tricksWon[seat]! : tricks[team];
  const { bidders, others, made } = score500(s.rules, bid, bidderTricks, tricks[1 - team]!);
  const points: [number, number] = [0, 0];
  points[team] = bidders;
  // The other side can't go out on 10s: they stop at 490.
  const otherTeam = (1 - team) as 0 | 1;
  points[otherTeam] = Math.max(0, Math.min(others, 490 - s.scores[otherTeam]));
  s.scores = [s.scores[0] + points[0], s.scores[1] + points[1]];
  s.lastHand = { seat, bid, tricks, points, made };
  s.narration = made ? `${who(seat)} made ${bidName500(bid)}: +${bidders}` : `${who(seat)} went down in ${bidName500(bid)}: ${bidders}`;
  s.ready = [false, false, false, false];
  const won = s.scores[team] >= 500 && made;
  const lost = s.scores.some((n) => n <= -500);
  s.phase = won || lost ? "finished" : "scored";
}

function winningTeam(s: FiveHundredState): 0 | 1 {
  if (s.scores[0] <= -500) return 1;
  if (s.scores[1] <= -500) return 0;
  return s.scores[0] >= 500 ? 0 : 1;
}

function view(s: FiveHundredState, seat: number): KitView {
  const over = s.phase === "finished";
  const trump = trumpOf(s);
  const sits = sitter(s);
  let choices: KitView["choices"] = null;
  const bids = bidsFor(s, seat);
  if (s.phase === "bidding" && s.turn === seat) {
    // The next two levels up (and misère), not all 26 bids at once.
    const lowest = Math.min(...bids.filter((b) => b.denom !== "misere").map((b) => b.tricks));
    const shown = bids.filter((b) => b.denom === "misere" || b.tricks <= lowest + 1);
    const options: Choice[] = [{ label: "Pass", move: { type: "pass" } }, ...shown.map((b) => ({ label: shortBid(b), move: { type: "bid", tricks: b.tricks, denom: b.denom }, hint: String(bidValue(b)) }))];
    const beat = s.high ? `${bidName500(s.high.bid)} (${bidValue(s.high.bid)}) to beat. ` : "";
    choices = { prompt: `${beat}Bid tricks for your side, or pass. Six: ♠40 ♣60 ♦80 ♥100 NT120, +100 a trick.`, options, layout: "grid" };
  } else if (s.phase === "nominate" && s.turn === seat) {
    choices = { prompt: "You led the joker: which suit is it?", options: SUITS.map((suit) => ({ label: SYMBOL[suit], move: { type: "nominate", suit } })), layout: "row" };
  } else if (s.phase === "scored" && !s.ready[seat]) choices = { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] };
  const bidding = s.phase === "bidding";
  const winner = over ? winningTeam(s) : null;
  const sides = [
    [0, 2],
    [1, 3],
  ];
  return {
    game: "fivehundred",
    seats: 4,
    me: seat,
    teams: true,
    phase: s.phase,
    turn: s.phase === "scored" || over ? null : s.turn,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: s.phase === "playing" && s.turn === seat ? { type: "play", cards: legal500(s, seat).map((c) => c.id) } : null,
    pick:
      s.phase === "kitty" && s.turn === seat
        ? { min: 3, max: 3, prompt: "You took the kitty: pick three cards to put back", cards: s.hands[seat]!.map((c) => c.id), actions: [{ label: "Put back", type: "discard", primary: true }] }
        : null,
    choices,
    players: s.hands.map((h, i) => ({
      cards: h.length,
      line: bidding ? (s.passed[i] ? "Passed" : s.bids[i] ? `Bid ${shortBid(s.bids[i]!)}` : "") : `Took ${s.tricksWon[i]}`,
      team: teamOfSeat(i),
      dealer: i === s.dealer,
      out: i === sits,
      badge: !bidding && s.high?.seat === i ? shortBid(s.high.bid) : i === sits ? "Sitting out" : undefined,
    })),
    center: bidding
      ? { kind: "piles", stock: 3, discard: [], discardCount: 0, drawMove: null, takeMove: null, noDiscard: true, stockLabel: "The kitty" }
      : { kind: "trick", plays: s.trick.length ? s.trick : (s.lastTrick?.plays ?? []), winner: s.trick.length ? null : (s.lastTrick?.winner ?? null) },
    melds: [],
    info: [
      ...(s.high && !bidding ? [s.high.bid.denom === "misere" ? `${who(s.high.seat)} must lose every trick` : `${who(s.high.seat)} & ${who(partnerOf(s.high.seat))} need ${s.high.bid.tricks}`] : []),
      ...(bidding ? [] : trump ? [`Trump ${SYMBOL[trump]} · joker high`] : s.high ? ["No trumps · the joker is top"] : []),
      ...(s.jokerSuit && s.trick.length ? [`Joker led as ${SYMBOL[s.jokerSuit]}`] : []),
      "To 500",
    ],
    narration: s.narration,
    scores: [
      { seats: [0, 2], value: s.scores[0] },
      { seats: [1, 3], value: s.scores[1] },
    ],
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `500-${s.hand}`,
            title: s.lastHand.made ? `${who(s.lastHand.seat)} made ${bidName500(s.lastHand.bid)}` : `${who(s.lastHand.seat)} went down`,
            sides,
            rows: [
              { label: "Tricks", values: s.lastHand.tricks.map(String) },
              { label: "This hand", values: s.lastHand.points.map((p) => (p > 0 ? `+${p}` : String(p))), tone: "score" },
              { label: "Score", values: s.scores.map(String), tone: "total" },
            ],
          }
        : null,
    over: winner !== null ? { winners: [winner, winner + 2], title: `${who(winner)} & ${who(winner + 2)} win ${s.scores[winner]} to ${s.scores[1 - winner]}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** Tricks a hand should take with this denomination, counting on a trick or so from partner. */
export function estimate500(hand: KCard[], denom: Denom): number {
  if (denom === "misere") return 0;
  const trump = denom === "nt" ? null : denom;
  const suitOf = suitFor(trump, null);
  let est = 0;
  const trumps = trump ? hand.filter((c) => suitOf(c) === trump) : [];
  for (const c of hand) {
    if (isJoker(c)) est += 1;
    else if (trump && suitOf(c) === trump) est += isRight(c, trump) ? 1 : isLeft(c, trump) ? 0.9 : rank(c) === 14 ? 0.85 : rank(c) === 13 ? 0.65 : rank(c) >= 10 ? 0.45 : 0.35;
    else if (rank(c) === 14) est += trump ? 0.8 : 0.9;
    else if (rank(c) === 13 && hand.filter((x) => !isJoker(x) && rawSuit(x) === rawSuit(c)).length >= 2) est += trump ? 0.35 : 0.5;
  }
  if (trump) est += Math.max(0, trumps.length - 4) * 0.4; // long trumps take extra tricks
  else est -= 0.6; // no trumps is hard to hold
  return est + 2.3; // partner
}

/** A hand fit for misère: no joker, nothing above a 9, or very little. */
const misereFit = (hand: KCard[]) => !hand.some(isJoker) && hand.filter((c) => rank(c) >= 11).length === 0 && hand.filter((c) => rank(c) >= 9).length <= 2;

function bot(s: FiveHundredState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const hand = s.hands[seat]!;
  const careless = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.25;
  if (s.phase === "bidding") {
    const options = bidsFor(s, seat);
    // Don't outbid partner just to bid.
    if (s.high && teamOfSeat(s.high.seat) === teamOfSeat(seat) && Math.random() > 0.15) return { type: "pass" };
    const nerve = (style.bold ?? 0.3) * 0.6;
    // The denomination the hand is worth most in; bid the cheapest level of it that beats the table.
    let best: Bid500 | null = null;
    let bestWorth = 0;
    for (const denom of DENOMS) {
      const t = Math.min(10, Math.floor(estimate500(hand, denom) + nerve));
      if (t < 6) continue;
      const pick = options.find((o) => o.denom === denom && o.tricks <= t);
      const worth = bidValue({ tricks: t, denom });
      if (pick && worth > bestWorth) {
        best = pick;
        bestWorth = worth;
      }
    }
    if (s.rules.misere && misereFit(hand) && options.some((o) => o.denom === "misere")) return { type: "bid", tricks: 0, denom: "misere" };
    return best ? { type: "bid", tricks: best.tricks, denom: best.denom } : { type: "pass" };
  }
  const trump = trumpOf(s);
  const power = powerFor(trump);
  const suitOf = suitFor(trump, s.jokerSuit);
  const strength = (c: KCard) => power(c) + (trump && suitOf(c) === trump ? 200 : 0);
  if (s.phase === "kitty") {
    // Throw the weakest side cards, shortest suits first.
    const misere = s.high!.bid.denom === "misere";
    const side = hand.filter((c) => !isJoker(c) && (misere || suitOf(c) !== trump));
    const len = (c: KCard) => hand.filter((x) => !isJoker(x) && suitOf(x) === suitOf(c)).length;
    const order = misere ? [...hand].sort((a, b) => strength(b) - strength(a)) : [...side].sort((a, b) => len(a) - len(b) || rank(a) - rank(b));
    const keep = order.length >= 3 ? order : [...order, ...[...hand].sort((a, b) => strength(a) - strength(b))];
    return { type: "discard", cards: [...new Set(keep.map((c) => c.id))].slice(0, 3) };
  }
  if (s.phase === "nominate") {
    const counts = SUITS.map((x) => ({ x, n: hand.filter((c) => !isJoker(c) && rawSuit(c) === x).length }));
    return { type: "nominate", suit: counts.sort((a, b) => a.n - b.n)[0]!.x };
  }
  if (s.phase !== "playing") return null;
  const legal = legal500(s, seat);
  if (legal.length === 1 || careless) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  const misere = s.high!.bid.denom === "misere";
  const bidder = s.high!.seat;
  // Misère: the bidder ducks everything; the others try to make the bidder win.
  if (misere) {
    if (seat === bidder) {
      if (!s.trick.length) return { type: "play", card: [...legal].sort((a, b) => strength(a) - strength(b))[0]!.id };
      return { type: "play", card: bestLoser(legal.filter((c) => !isJoker(c)).length ? legal.filter((c) => !isJoker(c)) : legal, seat, s.trick, trump, suitOf, power).id };
    }
    return { type: "play", card: [...legal].sort((a, b) => strength(a) - strength(b))[0]!.id };
  }
  const ours = teamOfSeat(bidder) === teamOfSeat(seat);
  if (!s.trick.length) {
    const trumps = legal.filter((c) => trump && suitOf(c) === trump).sort((a, b) => strength(b) - strength(a));
    if (ours && trumps.length >= 2) return { type: "play", card: trumps[0]!.id };
    const ace = legal.find((c) => !isJoker(c) && suitOf(c) !== trump && rank(c) === 14);
    if (ace) return { type: "play", card: ace.id };
    return { type: "play", card: [...legal].filter((c) => !isJoker(c)).sort((a, b) => strength(a) - strength(b))[0]?.id ?? legal[0]!.id };
  }
  const joker = s.trick.find((p) => isJoker(p.card));
  const winning = joker ?? trickWinner(s.trick, trump, suitOf, power);
  if (teamOfSeat(winning.seat) === teamOfSeat(seat)) return { type: "play", card: [...legal].sort((a, b) => strength(a) - strength(b))[0]!.id };
  if (!joker) {
    const win = cheapestWinner(legal, seat, s.trick, trump, suitOf, (c) => (isJoker(c) ? 1000 : power(c)));
    if (win) return { type: "play", card: win.id };
  }
  return { type: "play", card: [...legal].filter((c) => !isJoker(c)).sort((a, b) => strength(a) - strength(b))[0]?.id ?? legal[0]!.id };
}

export const fiveHundred: CardGame<FiveHundredRules, FiveHundredState, Move> = {
  id: "fivehundred",
  name: "Five Hundred",
  emoji: "💯",
  blurb: "Partners bid tricks; the joker is boss",
  tagline: "Partners bid how many tricks they'll take, and in what. The joker is the best card. First to 500.",
  seats: { min: 4, max: 4, default: 4 },
  teams: true,
  presets: [classic500, plain500],
  fields: [
    { key: "misere", label: "Misère", hint: "Bid to lose every trick, alone (250).", kind: "toggle" },
    { key: "slam", label: "Slam", hint: "Taking all ten tricks scores at least 250.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<FiveHundredRules>;
    const base = [classic500, plain500].find((p) => p.id === given.id) ?? classic500;
    return { ...base, ...given };
  },
  validate() {
    return [];
  },
  describe(r) {
    return [
      "Partners sit across. A 43-card deck: 5s up to aces, the red 4s, and a joker. Ten cards each and three in the kitty.",
      `Bid how many tricks your side will take (6 to 10) and in what: ♠ 40, ♣ 60, ♦ 80, ♥ 100, no trumps 120 for six, and 100 more for each trick above six.${r.misere ? " Misère (250): play alone, partner sitting out, and lose every trick." : ""} Each bid must be worth more; once you pass you're out of the auction.`,
      "The winner takes the kitty and puts three cards back.",
      "The joker is the top trump, then the jack of trumps and the other jack of the same colour. With no trumps the joker beats everything; lead it and you say which suit it is.",
      `Make your bid and score its value${r.slam ? " (all ten tricks score at least 250)" : ""}; fall short and lose it. The other side scores 10 a trick, but can't go out that way.`,
      "First side to 500 by making a bid wins; a side at −500 loses.",
    ];
  },
  newGame: newFiveHundred,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "bidding") return 1800;
    if (s.phase === "kitty") return 2000;
    if (s.phase === "scored") return 900;
    return thinkFor(legal500(s, seat).length);
  },
  summary(s) {
    const over = s.phase === "finished";
    const w = over ? winningTeam(s) : 0;
    return {
      game: "fivehundred",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats([{ seats: [w, w + 2], score: 1 }, { seats: [1 - w, 3 - w], score: 0 }]) : null,
      winners: over ? [w, w + 2] : null,
      teams: true,
      seats: 4,
    };
  },
};
