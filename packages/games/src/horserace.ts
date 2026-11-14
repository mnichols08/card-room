// Horse Race, a drinking game. The four aces are the horses, lined up at the start, with a row of
// face-down cards beside the track. Everyone bets sips on a horse. Then cards are turned from the
// deck: each one moves its suit's horse a step forward. When every horse has passed a track card, it's
// turned over and that suit's horse steps back. First horse past the finish wins: its backers hand out
// twice what they bet; everyone else drinks what they bet.
import type { PlayStyle, Suit } from "@spades/rules";
import { botGiveTarget, drink, DRINK_NOTE, giveChoices, giveTo, newTally, type Tally } from "./drinks.js";
import { clone, FULL, GameError, makeDeck, nextRandom, rankSeats, shuffled, SUITS, SYMBOL, who, type BaseRules, type CardGame, type KCard, type KitView } from "./kit.js";

export interface HorseRules extends BaseRules {
  track: number;
}

export const classicHorse: HorseRules = { id: "horse-classic", name: "Horse Race", track: 7 };
export const shortHorse: HorseRules = { ...classicHorse, id: "horse-short", name: "Sprint (5 lengths)", track: 5 };

export interface HorseState {
  game: "horserace";
  rules: HorseRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: "bet" | "race" | "payout" | "finished";
  deck: KCard[];
  trackCards: KCard[];
  /** How many track cards are turned over. */
  turned: number;
  /** Each horse's position, in SUITS order: 0 at the start, track+1 past the finish. */
  pos: number[];
  bets: ({ suit: Suit; sips: number } | null)[];
  /** A bet in progress: the horse picked, the sips still to choose. */
  picking: (Suit | null)[];
  turn: number;
  last: KCard | null;
  winner: Suit | null;
  tally: Tally;
  narration: string | null;
}

const suitOf = (c: KCard) => (c as { suit: Suit }).suit;
const NAMES: Record<Suit, string> = { spades: "♠ Spades", hearts: "♥ Hearts", diamonds: "♦ Diamonds", clubs: "♣ Clubs" };

export function newHorseRace(rules: HorseRules, seats: number, seed: number): HorseState {
  const s = { game: "horserace", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, phase: "bet", turned: 0, last: null, winner: null, narration: "Place your bets!" } as unknown as HorseState;
  const deck = shuffled(makeDeck({ ranks: FULL.filter((r) => r !== 14) }), nextRandom(s));
  s.trackCards = deck.slice(0, rules.track);
  s.deck = deck.slice(rules.track);
  s.pos = [0, 0, 0, 0];
  s.bets = Array(seats).fill(null);
  s.picking = Array(seats).fill(null);
  s.tally = newTally(seats);
  s.turn = s.dealer;
  return s;
}

type Move = { type: "horse"; suit: Suit } | { type: "sips"; sips: number } | { type: "flip" } | { type: "give"; to: number };

function finish(s: HorseState, suit: Suit) {
  s.winner = suit;
  const backers = s.bets.flatMap((b, i) => (b && b.suit === suit ? [i] : []));
  const losers = s.bets.flatMap((b, i) => (b && b.suit !== suit ? [i] : []));
  const parts = [`${NAMES[suit]} wins! 🏇`];
  for (const i of losers) parts.push(drink(s.tally, [i], s.bets[i]!.sips));
  for (const i of backers) s.tally.give.push({ from: i, n: s.bets[i]!.sips * 2, why: `${NAMES[suit]} won` });
  s.narration = parts.join(" · ");
  s.phase = s.tally.give.length ? "payout" : "finished";
}

function apply(state: HorseState, seat: number, move: Move): HorseState {
  const s = clone(state);
  if (s.phase === "finished") throw new GameError("The race is over.");
  switch (move.type) {
    case "horse": {
      if (s.phase !== "bet" || s.bets[seat]) throw new GameError("Bets are in.");
      if (!SUITS.includes(move.suit)) throw new GameError("Pick a horse.");
      s.picking[seat] = move.suit;
      return s;
    }
    case "sips": {
      if (s.phase !== "bet" || s.bets[seat] || !s.picking[seat]) throw new GameError("Pick a horse first.");
      const sips = Number(move.sips);
      if (!(sips >= 1 && sips <= 5)) throw new GameError("Bet 1 to 5 sips.");
      s.bets[seat] = { suit: s.picking[seat]!, sips };
      s.narration = `${who(seat)} bets ${sips} on ${NAMES[s.picking[seat]!]}`;
      if (s.bets.every(Boolean)) {
        s.phase = "race";
        s.narration = "And they're off!";
      }
      return s;
    }
    case "flip": {
      if (s.phase !== "race" || s.turn !== seat) throw new GameError("It's not your turn to flip.");
      if (!s.deck.length) s.deck = shuffled(makeDeck({ ranks: FULL.filter((r) => r !== 14) }).filter((c) => !s.trackCards.some((t) => t.id === c.id)), nextRandom(s));
      const c = s.deck.pop()!;
      s.last = c;
      const h = SUITS.indexOf(suitOf(c));
      s.pos[h]! += 1;
      s.narration = `${NAMES[suitOf(c)]} moves up!`;
      if (s.pos[h]! > s.rules.track) {
        finish(s, suitOf(c));
        return s;
      }
      // Every horse past the next track card: turn it, and its horse steps back.
      while (s.turned < s.rules.track && s.pos.every((p) => p > s.turned)) {
        const t = s.trackCards[s.turned]!;
        s.turned += 1;
        const back = SUITS.indexOf(suitOf(t));
        s.pos[back] = Math.max(0, s.pos[back]! - 1);
        s.narration += ` · Track card: ${NAMES[suitOf(t)]} steps back`;
      }
      return s;
    }
    case "give": {
      if (s.phase !== "payout") throw new GameError("Not yet.");
      try {
        s.narration = giveTo(s.tally, seat, Number(move.to), s.seats);
      } catch {
        throw new GameError("Pick someone else to drink.");
      }
      if (!s.tally.give.length) s.phase = "finished";
      return s;
    }
    default:
      throw new GameError("That's not a move in Horse Race.");
  }
}

function view(s: HorseState, seat: number): KitView {
  const over = s.phase === "finished";
  let choices: KitView["choices"] = null;
  if (s.phase === "bet" && !s.bets[seat]) {
    choices = s.picking[seat]
      ? { prompt: `How many sips on ${NAMES[s.picking[seat]!]}?`, options: [1, 2, 3, 4, 5].map((n) => ({ label: String(n), move: { type: "sips", sips: n } })), layout: "row" }
      : { prompt: "Pick your horse", options: SUITS.map((x) => ({ label: NAMES[x], move: { type: "horse", suit: x } })), layout: "grid" };
  } else if (s.phase === "race" && s.turn === seat) choices = { prompt: "", options: [{ label: "Turn a card", move: { type: "flip" }, primary: true }] };
  else if (s.phase === "payout") choices = giveChoices(s.tally, s.seats, seat);
  // The board: the track cards on top, then a row for each horse. Columns: start, the track, the finish.
  const cols = s.rules.track + 2;
  const cards: (KCard | null)[] = [];
  const empty: number[] = [];
  for (let col = 0; col < cols; col++) {
    const k = col - 1;
    if (k < 0 || k >= s.rules.track) {
      empty.push(cards.length);
      cards.push(null);
    } else cards.push(k < s.turned ? s.trackCards[k]! : null);
  }
  SUITS.forEach((x, h) => {
    for (let col = 0; col < cols; col++) {
      if (s.pos[h] === col) cards.push({ kind: "pip", suit: x, rank: 14, id: `horse-${x}` } as KCard);
      else {
        empty.push(cards.length);
        cards.push(null);
      }
    }
  });
  const turn = s.phase === "race" ? s.turn : s.phase === "payout" ? (s.tally.give[0]?.from ?? null) : null;
  return {
    game: "horserace",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn,
    dealer: s.dealer,
    hand: [],
    handHidden: "none",
    tap: null,
    pick: null,
    choices,
    players: s.bets.map((b, i) => ({ cards: 0, line: `${b ? `🏇 ${SYMBOL[b.suit]} · ${b.sips}` : s.phase === "bet" ? "Betting…" : ""}${s.tally.drank[i] ? ` · 🍺 ${s.tally.drank[i]}` : ""}`, dealer: i === s.dealer })),
    center: { kind: "board", cols, cards, empty, tap: null },
    melds: [],
    info: [s.phase === "bet" ? "Bet sips on a horse" : s.last ? `Last card: ${SYMBOL[suitOf(s.last)]}` : "First past the finish wins", DRINK_NOTE],
    narration: s.narration,
    scores: s.tally.drank.map((value, i) => ({ seats: [i], value })),
    result: null,
    over: over && s.winner ? { winners: s.bets.flatMap((b, i) => (b?.suit === s.winner ? [i] : [])).concat(s.bets.every((b) => b?.suit !== s.winner) ? s.bets.map((_, i) => i) : []), title: `${NAMES[s.winner]} wins the race!` } : null,
  };
}

function bot(s: HorseState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "bet") {
    if (s.bets[seat]) return null;
    if (!s.picking[seat]) return { type: "horse", suit: SUITS[Math.floor(Math.random() * 4)]! };
    return { type: "sips", sips: Math.max(1, Math.min(5, Math.round(1 + (style.bold ?? 0.3) * 4 * Math.random() + Math.random()))) };
  }
  if (s.phase === "race") return s.turn === seat ? { type: "flip" } : null;
  if (s.phase === "payout") return s.tally.give[0]?.from === seat ? { type: "give", to: botGiveTarget(s.tally, seat, s.seats) } : null;
  return null;
}

export const horseRace: CardGame<HorseRules, HorseState, Move> = {
  id: "horserace",
  name: "Horse Race",
  emoji: "🏇",
  blurb: "Drinking game: bet sips on an ace and watch them run",
  tagline: "A drinking game. Bet sips on an ace, then turn cards to move the horses. Backers of the winner hand out drinks.",
  seats: { min: 2, max: 10, default: 5 },
  teams: false,
  presets: [classicHorse, shortHorse],
  fields: [{ key: "track", label: "Track", kind: "choice", options: [[5, "5 lengths"], [7, "7 lengths"], [9, "9 lengths"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<HorseRules>;
    const base = [classicHorse, shortHorse].find((p) => p.id === given.id) ?? classicHorse;
    const r = { ...base, ...given };
    return { ...r, track: Math.min(9, Math.max(3, Number(r.track) || 7)) };
  },
  validate: () => [],
  describe: (r) => [
    `${DRINK_NOTE} Adults only.`,
    `The four aces are the horses. ${r.track} cards go face down beside the track.`,
    "Everyone picks a horse and bets 1 to 5 sips on it.",
    "The dealer turns cards from the deck: each one moves its suit's horse a step forward. When every horse has passed a track card, it's turned over and that suit's horse steps back.",
    "First horse past the finish wins. Its backers hand out twice what they bet; everyone else drinks what they bet.",
  ],
  newGame: newHorseRace,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "race" ? 1100 : 1400),
  summary(s) {
    const over = s.phase === "finished";
    const w = s.bets.flatMap((b, i) => (b?.suit === s.winner ? [i] : []));
    return { game: "horserace", rules: s.rules.name, phase: s.phase, over, hand: 1, scoreLine: s.tally.drank.join(" · ") + " drinks", order: over ? rankSeats(s.tally.drank.map((score, i) => ({ seats: [i], score })), true) : null, winners: over ? (w.length ? w : s.bets.map((_, i) => i)) : null, teams: false, seats: s.seats };
  },
};
