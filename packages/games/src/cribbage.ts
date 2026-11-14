// Cribbage for two. Six cards each; both lay two away into the dealer's crib. A starter is cut (a
// jack is "his heels", 2 to the dealer). Then pegging: play in turn, keeping the count to 31, and
// score fifteens, thirty-ones, pairs and runs as they happen, a go when the other player can't
// play, and the last card. Then the show: each hand with the starter, the dealer's last, then the
// crib, counted out loud. First to 121 (or 61) wins, the moment they get there.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  markReady,
  nextRandom,
  rankLabel,
  shuffled,
  SUITS,
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type Meld,
  type PipCard,
} from "./kit.js";

export interface CribbageRules extends BaseRules {
  playTo: number;
}

export const classicCribbage: CribbageRules = { id: "cribbage-classic", name: "Cribbage (to 121)", playTo: 121 };
export const shortCribbage: CribbageRules = { id: "cribbage-short", name: "Short game (to 61)", playTo: 61 };

type Phase = "discard" | "pegging" | "show" | "finished";

export interface ShowCount {
  owner: number;
  crib: boolean;
  cards: KCard[];
  points: number;
  words: string;
}

export interface CribbageState {
  game: "cribbage";
  rules: CribbageRules;
  seats: 2;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  /** The four each player keeps (after laying away), for the show. */
  hands: KCard[][];
  /** What's still to be played in pegging. */
  peg: KCard[][];
  crib: KCard[];
  laidAway: boolean[];
  stock: KCard[];
  starter: KCard | null;
  /** Cards played since the count last went back to zero, and the count. */
  run: { seat: number; card: KCard }[];
  count: number;
  /** Who has said go in this count. */
  go: boolean[];
  lastPlayer: number | null;
  turn: number;
  show: ShowCount[];
  scores: [number, number];
  /** The front peg's last move, so the track can show both pegs. */
  back: [number, number];
  ready: boolean[];
  narration: string | null;
}

const rankOf = (c: KCard) => ((c as PipCard).rank === 14 ? 1 : (c as PipCard).rank);
const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
/** Counting value: aces 1, faces 10. */
export const cribValue = (c: KCard) => Math.min(10, rankOf(c));
const name = (c: KCard) => `${rankLabel(rankOf(c) === 1 ? 14 : rankOf(c))}${SYMBOL[suitOf(c)]}`;
const sortHand = (cards: KCard[]) => [...cards].sort((a, b) => rankOf(a) - rankOf(b) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)));

// ---- Counting a hand ----------------------------------------------------------------------------

/** A hand's points with the starter, and the words for counting them out loud. */
export function countHand(hand: KCard[], starter: KCard, crib = false): { points: number; words: string } {
  const all = [...hand, starter];
  const parts: string[] = [];
  let points = 0;
  const say = (n: number, text: string) => {
    points += n;
    parts.push(`${text} ${points}`);
  };
  // Fifteens: every combination that adds up to 15.
  for (let mask = 1; mask < 1 << all.length; mask++) {
    let sum = 0;
    for (let i = 0; i < all.length; i++) if (mask & (1 << i)) sum += cribValue(all[i]!);
    if (sum === 15) say(2, "fifteen");
  }
  // Pairs (three of a kind is three pairs, four is six).
  const byRank = new Map<number, number>();
  for (const c of all) byRank.set(rankOf(c), (byRank.get(rankOf(c)) ?? 0) + 1);
  for (const [, n] of byRank) {
    const pairs = (n * (n - 1)) / 2;
    if (pairs === 1) say(2, "a pair is");
    else if (pairs === 3) say(6, "three of a kind is");
    else if (pairs === 6) say(12, "four of a kind is");
  }
  // Runs: the longest run of ranks, counted once for each way of making it.
  let best = 0,
    ways = 0;
  for (let low = 1; low <= 11; low++) {
    let len = 0,
      mult = 1;
    while (byRank.get(low + len)) {
      mult *= byRank.get(low + len)!;
      len++;
    }
    if (len >= 3 && len > best) [best, ways] = [len, mult];
  }
  if (best) {
    const label = ways === 1 ? `a run of ${best} is` : ways === 2 ? `a double run of ${best} is` : ways === 3 ? `a triple run of ${best} is` : `${ways} runs of ${best} is`;
    say(best * ways, label);
  }
  // Flush: four in the hand (five with the starter); a crib only counts all five.
  const suits = new Set(hand.map(suitOf));
  if (suits.size === 1) {
    const five = suitOf(starter) === suitOf(hand[0]!);
    if (five) say(5, "a flush of five is");
    else if (!crib) say(4, "a flush is");
  }
  // Nobs: the jack of the starter's suit.
  if (hand.some((c) => rankOf(c) === 11 && suitOf(c) === suitOf(starter))) say(1, "and one for his nobs is");
  if (!parts.length) return { points: 0, words: "Nineteen (no points)" };
  const words = parts.join(", ");
  return { points, words: words[0]!.toUpperCase() + words.slice(1) };
}

/** Points for the card just played in pegging: fifteen, thirty-one, pairs, runs. */
export function pegPoints(run: KCard[], count: number): { points: number; words: string[] } {
  const words: string[] = [];
  let points = 0;
  if (count === 15) (points += 2), words.push("fifteen for 2");
  if (count === 31) (points += 2), words.push("thirty-one for 2");
  // Pairs: how many of the most recent cards share its rank.
  const last = run.at(-1)!;
  let same = 1;
  for (let i = run.length - 2; i >= 0 && rankOf(run[i]!) === rankOf(last); i--) same++;
  if (same === 2) (points += 2), words.push("a pair for 2");
  if (same === 3) (points += 6), words.push("three of a kind for 6");
  if (same === 4) (points += 12), words.push("four of a kind for 12");
  // Runs: the longest stretch of the most recent cards that makes a run, in any order.
  for (let len = run.length; len >= 3; len--) {
    const ranks = run.slice(-len).map(rankOf).sort((a, b) => a - b);
    if (ranks.every((r, i) => i === 0 || r === ranks[i - 1]! + 1)) {
      points += len;
      words.push(`a run of ${len} for ${len}`);
      break;
    }
  }
  return { points, words };
}

// ---- The game -----------------------------------------------------------------------------------

/** Pegging can end the game at any moment: read the phase fresh after a peg. */
const ended = (st: CribbageState) => (st.phase as Phase) === "finished";

function peg(s: CribbageState, seat: number, n: number) {
  if (!n || s.phase === "finished") return;
  const i = seat as 0 | 1;
  s.back[i] = s.scores[i];
  s.scores[i] = Math.min(s.rules.playTo, s.scores[i] + n);
  if (s.scores[i] >= s.rules.playTo) {
    s.phase = "finished";
    s.ready = [false, false];
  }
}

function deal(s: CribbageState) {
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  const non = 1 - s.dealer;
  s.hands = [[], []];
  for (let i = 0; i < 12; i++) s.hands[(non + i) % 2]!.push(deck[i]!);
  s.hands = s.hands.map(sortHand);
  s.stock = deck.slice(12);
  s.peg = [[], []];
  s.crib = [];
  s.laidAway = [false, false];
  s.starter = null;
  s.run = [];
  s.count = 0;
  s.go = [false, false];
  s.lastPlayer = null;
  s.show = [];
  s.ready = [false, false];
  s.phase = "discard";
  s.turn = non;
  s.narration = `${who(s.dealer)}'s crib: lay away two cards`;
}

export function newCribbage(rules: CribbageRules, _seats: number, seed: number): CribbageState {
  const s = { game: "cribbage", rules, seats: 2, rng: seed >>> 0, hand: 0, dealer: seed % 2, scores: [0, 0], back: [0, 0] } as unknown as CribbageState;
  deal(s);
  return s;
}

/** Cards this player can play without going over 31. */
export const playable = (s: CribbageState, seat: number) => s.peg[seat]!.filter((c) => s.count + cribValue(c) <= 31);

/** Pegging is over for this count: reset to zero; whoever didn't play last leads. */
function newCount(s: CribbageState) {
  const next = s.lastPlayer === null ? 1 - s.dealer : 1 - s.lastPlayer;
  s.run = [];
  s.count = 0;
  s.go = [false, false];
  s.turn = s.peg[next]!.length ? next : 1 - next;
}

/** After a play or a go: whose turn it is, a go point, a new count, or the show. */
function nextPlay(s: CribbageState, from: number) {
  if (s.phase === "finished") return;
  if (!s.peg[0]!.length && !s.peg[1]!.length) {
    // The last card: 1, unless it made 31.
    if (s.count !== 31 && s.lastPlayer !== null) {
      peg(s, s.lastPlayer, 1);
      s.narration = `${s.narration ? s.narration + "; " : ""}${who(s.lastPlayer)} gets 1 for the last card`;
    }
    if (!ended(s)) startShow(s);
    return;
  }
  if (s.count === 31) {
    newCount(s);
    return;
  }
  const other = 1 - from;
  if (playable(s, other).length) {
    s.turn = other;
    return;
  }
  if (playable(s, from).length) {
    // The other player can't go: this player keeps playing.
    s.turn = from;
    return;
  }
  // Nobody can play: a go to whoever played last.
  if (s.lastPlayer !== null) {
    peg(s, s.lastPlayer, 1);
    s.narration = `${s.narration ? s.narration + "; " : ""}a go: 1 for ${who(s.lastPlayer)}`;
  }
  if (!ended(s)) newCount(s);
}

function startShow(s: CribbageState) {
  const non = 1 - s.dealer;
  const st = s.starter!;
  s.show = [
    { owner: non, crib: false, cards: s.hands[non]!, ...countHand(s.hands[non]!, st) },
    { owner: s.dealer, crib: false, cards: s.hands[s.dealer]!, ...countHand(s.hands[s.dealer]!, st) },
    { owner: s.dealer, crib: true, cards: s.crib, ...countHand(s.crib, st, true) },
  ];
  // Pegged in that order, so a win on the first count stops the rest.
  for (const c of s.show) {
    peg(s, c.owner, c.points);
    if (ended(s)) break;
  }
  if (!ended(s)) {
    s.phase = "show";
    s.ready = [false, false];
  }
  s.narration = "The show";
}

type Move = { type: "crib"; cards: string[] } | { type: "play"; card: string } | { type: "go" } | { type: "next" };

function apply(state: CribbageState, seat: number, move: Move): CribbageState {
  const s = clone(state);
  if (s.phase === "finished") throw new GameError("The game is over.");
  switch (move.type) {
    case "crib": {
      if (s.phase !== "discard" || s.laidAway[seat]) throw new GameError("You've laid your cards away.");
      const ids = move.cards ?? [];
      const cards = ids.map((id) => s.hands[seat]!.find((c) => c.id === id));
      if (cards.length !== 2 || cards.some((c) => !c) || ids[0] === ids[1]) throw new GameError("Pick two cards for the crib.");
      s.hands[seat] = s.hands[seat]!.filter((c) => !ids.includes(c.id));
      s.crib.push(...(cards as KCard[]));
      s.laidAway[seat] = true;
      if (s.laidAway.every(Boolean)) {
        s.starter = s.stock[Math.floor(nextRandom(s)() * s.stock.length)]!;
        s.peg = s.hands.map((h) => [...h]);
        s.phase = "pegging";
        s.turn = 1 - s.dealer;
        s.narration = `The cut: the ${name(s.starter)}`;
        if (rankOf(s.starter) === 11) {
          s.narration += `: his heels, 2 for ${who(s.dealer)}`;
          peg(s, s.dealer, 2);
        }
      }
      return s;
    }
    case "play": {
      if (s.phase !== "pegging" || s.turn !== seat) throw new GameError("It's not your turn.");
      const card = s.peg[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      if (s.count + cribValue(card) > 31) throw new GameError(`That takes the count past 31: play something lower, or say go.`);
      s.peg[seat] = s.peg[seat]!.filter((c) => c.id !== card.id);
      s.run.push({ seat, card });
      s.count += cribValue(card);
      s.lastPlayer = seat;
      const got = pegPoints(
        s.run.map((p) => p.card),
        s.count,
      );
      s.narration = `${who(seat)}: ${s.count}${got.points ? `, ${got.words.join(" and ")}` : ""}`;
      peg(s, seat, got.points);
      nextPlay(s, seat);
      return s;
    }
    case "go": {
      if (s.phase !== "pegging" || s.turn !== seat) throw new GameError("It's not your turn.");
      if (playable(s, seat).length) throw new GameError("You can still play a card.");
      s.go[seat] = true;
      s.narration = `${who(seat)}: go`;
      nextPlay(s, seat);
      return s;
    }
    case "next": {
      if (s.phase !== "show") throw new GameError("The hand isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        s.dealer = 1 - s.dealer;
        deal(s);
      }
      return s;
    }
    default:
      throw new GameError("That's not a move in Cribbage.");
  }
}

function view(s: CribbageState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.turn === seat;
  const canPlay = s.phase === "pegging" && mine ? playable(s, seat) : [];
  const shown = s.phase === "show" || (over && s.show.length > 0);
  const melds: Meld[] = shown ? s.show.map((c) => ({ owner: c.owner, label: `${c.crib ? `${who(c.owner)}'s crib` : who(c.owner)}: ${c.words}`, cards: c.cards })) : [];
  const w = over ? (s.scores[0] >= s.scores[1] ? 0 : 1) : null;
  return {
    game: "cribbage",
    seats: 2,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "pegging" ? s.turn : null,
    dealer: s.dealer,
    hand: s.phase === "discard" ? s.hands[seat]! : s.phase === "pegging" ? s.peg[seat]! : [],
    tap: canPlay.length ? { type: "play", cards: canPlay.map((c) => c.id) } : null,
    pick:
      s.phase === "discard" && !s.laidAway[seat]
        ? { min: 2, max: 2, prompt: seat === s.dealer ? "Lay away two cards for your crib" : `Lay away two cards for ${who(s.dealer)}'s crib`, cards: s.hands[seat]!.map((c) => c.id), actions: [{ label: "To the crib", type: "crib", primary: true }] }
        : null,
    choices:
      s.phase === "pegging" && mine && !canPlay.length && s.peg[seat]!.length
        ? { prompt: "Nothing you hold keeps the count to 31.", options: [{ label: "Go", move: { type: "go" }, primary: true }] }
        : s.phase === "show" && !s.ready[seat]
          ? { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] }
          : null,
    players: [0, 1].map((i) => ({ cards: s.phase === "discard" ? s.hands[i]!.length : s.phase === "pegging" ? s.peg[i]!.length : 0, line: i === s.dealer ? "Dealer (the crib)" : "", dealer: i === s.dealer })),
    center: {
      kind: "piles",
      stock: null,
      discard: s.run.map((p) => p.card),
      discardCount: s.run.length,
      drawMove: null,
      takeMove: null,
      spread: { type: "none", cards: [] },
      discardLabel: s.phase === "pegging" ? `Count: ${s.count}` : "The play",
      held: s.starter,
      heldLabel: s.starter ? "Starter" : undefined,
    },
    melds,
    track: { to: s.rules.playTo, pegs: s.scores.map((n, i) => ({ seats: [i], value: n, back: s.back[i]! })) },
    info: [`To ${s.rules.playTo}`, ...(s.crib.length ? [`${who(s.dealer)}'s crib: ${s.crib.length} cards`] : [])],
    narration: s.narration,
    scores: s.scores.map((n, i) => ({ seats: [i], value: n })),
    result: null,
    over: w !== null ? { winners: [w], title: `${who(w)} pegs out, ${s.scores[w]} to ${s.scores[1 - w]}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** For laying away: what these four are worth on average over every starter, plus or minus the crib. */
function keepValue(keep: KCard[], away: KCard[], mine: boolean, deck: KCard[]): number {
  let sum = 0;
  for (const st of deck) sum += countHand(keep, st).points;
  const hand = sum / deck.length;
  // The two away, roughly: a pair or a fifteen in them helps whoever owns the crib.
  const a = away[0]!,
    b = away[1]!;
  const crib = (rankOf(a) === rankOf(b) ? 2 : 0) + (cribValue(a) + cribValue(b) === 15 ? 2 : 0) + (cribValue(a) === 5 ? 1 : 0) + (cribValue(b) === 5 ? 1 : 0);
  return hand + (mine ? crib : -crib);
}

function bot(s: CribbageState, seat: number, style: PlayStyle): Move | null {
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  if (s.phase === "show") return s.ready[seat] ? null : { type: "next" };
  if (s.phase === "discard") {
    if (s.laidAway[seat]) return null;
    const hand = s.hands[seat]!;
    if (sloppy) return { type: "crib", cards: hand.slice(-2).map((c) => c.id) };
    const seen = new Set(hand.map((c) => c.id));
    const deck = makeDeck({ ranks: FULL }).filter((c) => !seen.has(c.id));
    let best: { v: number; away: KCard[] } | null = null;
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++) {
        const away = [hand[i]!, hand[j]!];
        const keep = hand.filter((_, k) => k !== i && k !== j);
        const v = keepValue(keep, away, seat === s.dealer, deck);
        if (!best || v > best.v) best = { v, away };
      }
    return { type: "crib", cards: best!.away.map((c) => c.id) };
  }
  if (s.phase !== "pegging" || s.turn !== seat) return null;
  const can = playable(s, seat);
  if (!can.length) return { type: "go" };
  if (sloppy) return { type: "play", card: can[Math.floor(Math.random() * can.length)]!.id };
  const score = (c: KCard) => {
    const count = s.count + cribValue(c);
    let v = pegPoints([...s.run.map((p) => p.card), c], count).points * 10;
    if (count === 5 || count === 21) v -= 6; // easy fifteens and thirty-ones for the other player
    if (s.run.length === 0 && cribValue(c) === 5) v -= 5;
    return v - cribValue(c) * 0.1;
  };
  return { type: "play", card: [...can].sort((a, b) => score(b) - score(a))[0]!.id };
}

export const cribbage: CardGame<CribbageRules, CribbageState, Move> = {
  id: "cribbage",
  name: "Cribbage",
  emoji: "🪵",
  blurb: "Fifteen two, fifteen four, and a pair is six",
  tagline: "Lay two away for the crib, peg to 31, then count your hand: fifteen two, fifteen four…",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: [classicCribbage, shortCribbage],
  fields: [{ key: "playTo", label: "Game to", kind: "choice", options: [[61, "61"], [121, "121"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<CribbageRules>;
    const base = [classicCribbage, shortCribbage].find((p) => p.id === given.id) ?? classicCribbage;
    const merged = { ...base, ...given };
    return { ...merged, playTo: Number(merged.playTo) === 61 ? 61 : 121 };
  },
  validate: () => [],
  describe(r) {
    return [
      "Two players, six cards each. Both lay two away into the dealer's crib; then a starter card is cut (a jack is his heels: 2 for the dealer).",
      "Pegging: take turns playing a card, adding to the count, never past 31. Score 2 for making 15 or 31, 2 for a pair (6 for three, 12 for four), and a point a card for runs. If you can't play, say go: the last to play gets 1. The last card gets 1 too.",
      "The show, with the starter: 2 for every fifteen, 2 for each pair, a point a card for runs, 4 for a flush in the hand (5 with the starter; the crib needs all five), and 1 for the jack of the starter's suit (his nobs). The non-dealer counts first, then the dealer, then the dealer's crib.",
      `First to ${r.playTo} wins, the moment they peg there, even mid-hand.`,
    ];
  },
  newGame: newCribbage,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "show" ? 2600 : s.phase === "discard" ? 1600 : thinkFor(3)),
  summary(s) {
    const over = s.phase === "finished";
    const w = s.scores[0] >= s.scores[1] ? 0 : 1;
    return {
      game: "cribbage",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: `${s.scores[0]} to ${s.scores[1]}`,
      order: over ? [w, 1 - w] : null,
      winners: over ? [w] : null,
      teams: false,
      seats: 2,
    };
  },
};
