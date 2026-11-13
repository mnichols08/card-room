// Whist, Spades' grandparent: four players, partners across. Thirteen cards each; the dealer's last
// card is turned up and sets trump. Follow suit if you can. Each trick a side takes over six scores
// a point; first side to the target wins (5 for short whist, 7 for long). Honours are optional.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  markReady,
  nextHandChoices,
  nextRandom,
  rankLabel,
  rankSeats,
  shuffled,
  sortCards,
  SYMBOL,
  teamOfSeat,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type PipCard,
} from "./kit.js";
import { bestLoser, cheapestWinner, following, trickWinner, type Play } from "./tricks.js";

export interface WhistRules extends BaseRules {
  playTo: number;
  /** A side holding all four honours (A K Q J of trump) scores 4; three of them, 2. */
  honours: boolean;
}

export const shortWhist: WhistRules = { id: "whist-short", name: "Short Whist (to 5)", playTo: 5, honours: false };
export const longWhist: WhistRules = { id: "whist-long", name: "Long Whist (to 7)", playTo: 7, honours: false };
export const honoursWhist: WhistRules = { id: "whist-honours", name: "With honours (to 5)", playTo: 5, honours: true };

type Phase = "playing" | "scored" | "finished";

export interface WhistState {
  game: "whist";
  rules: WhistRules;
  seats: 4;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  trump: Suit;
  /** The card turned up for trump: the dealer's, back in their hand once the first trick is played. */
  turned: KCard;
  trick: Play[];
  lastTrick: { plays: Play[]; winner: number } | null;
  turn: number;
  tricks: [number, number];
  /** Honours (A K Q J of trump) each side was dealt. */
  honoursHeld: [number, number];
  scores: [number, number];
  lastHand: { tricks: [number, number]; odd: [number, number]; honours: [number, number] } | null;
  ready: boolean[];
  narration: string | null;
}

const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const power = (c: KCard) => (c as PipCard).rank;
const isHonour = (c: KCard, trump: Suit) => suitOf(c) === trump && power(c) >= 11;

function deal(s: WhistState) {
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  // Dealt one at a time from the dealer's left; the last card (the dealer's) is turned for trump.
  s.hands = [[], [], [], []];
  deck.forEach((c, i) => s.hands[(s.dealer + 1 + i) % 4]!.push(c));
  s.turned = deck.at(-1)!;
  s.trump = suitOf(s.turned);
  s.honoursHeld = [0, 0];
  s.hands.forEach((h, seat) => (s.honoursHeld[teamOfSeat(seat)] += h.filter((c) => isHonour(c, s.trump)).length));
  s.hands = s.hands.map((h) => sortCards(h));
  s.trick = [];
  s.lastTrick = null;
  s.tricks = [0, 0];
  s.ready = [false, false, false, false];
  s.turn = (s.dealer + 1) % 4;
  s.phase = "playing";
  s.narration = `${SYMBOL[s.trump]} is trump: ${who(s.dealer)} turned up the ${rankLabel(power(s.turned))}${SYMBOL[s.trump]}`;
}

export function newWhist(rules: WhistRules, _seats: number, seed: number): WhistState {
  const s = { game: "whist", rules, seats: 4, rng: seed >>> 0, hand: 0, dealer: seed % 4, scores: [0, 0], lastHand: null } as unknown as WhistState;
  deal(s);
  return s;
}

export const whistLegal = (s: WhistState, seat: number) => (s.phase === "playing" && s.turn === seat ? following(s.hands[seat]!, s.trick, suitOf) : []);

type Move = { type: "play"; card: string } | { type: "next" };

function apply(state: WhistState, seat: number, move: Move): WhistState {
  const s = clone(state);
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The hand isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = (s.dealer + 1) % 4;
      deal(s);
    }
    return s;
  }
  if (move.type !== "play") throw new GameError("That's not a move in Whist.");
  if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
  const card = s.hands[seat]!.find((c) => c.id === move.card);
  if (!card) throw new GameError("You don't have that card.");
  if (!whistLegal(s, seat).some((c) => c.id === card.id)) throw new GameError(`Follow ${SYMBOL[suitOf(s.trick[0]!.card)]} if you can.`);
  if (!s.trick.length) s.lastTrick = null;
  s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
  s.trick.push({ seat, card });
  s.narration = null;
  if (s.trick.length < 4) {
    s.turn = (seat + 1) % 4;
    return s;
  }
  const win = trickWinner(s.trick, s.trump, suitOf, power);
  s.tricks[teamOfSeat(win.seat)] += 1;
  s.lastTrick = { plays: s.trick, winner: win.seat };
  s.trick = [];
  s.turn = win.seat;
  if (s.hands.every((h) => !h.length)) scoreHand(s);
  return s;
}

function scoreHand(s: WhistState) {
  const odd = s.tricks.map((t) => Math.max(0, t - 6)) as [number, number];
  const honours: [number, number] = [0, 0];
  if (s.rules.honours) {
    const held = s.honoursHeld;
    for (const t of [0, 1] as const) {
      // Honours can't take a side to game from one point short (the old rule): they stop at one under.
      const points = held[t] === 4 ? 4 : held[t] === 3 ? 2 : 0;
      honours[t] = Math.max(0, Math.min(points, s.rules.playTo - 1 - s.scores[t] - odd[t]));
    }
  }
  s.scores = [s.scores[0] + odd[0] + honours[0], s.scores[1] + odd[1] + honours[1]];
  s.lastHand = { tricks: [...s.tricks] as [number, number], odd, honours };
  const side = odd[0] > 0 ? 0 : 1;
  s.narration = `${who(side)} & ${who(side + 2)} took ${s.tricks[side]} tricks: ${odd[side]} over six`;
  s.ready = [false, false, false, false];
  s.phase = s.scores.some((n) => n >= s.rules.playTo) ? "finished" : "scored";
}

const winner = (s: WhistState): 0 | 1 => (s.scores[0] >= s.scores[1] ? 0 : 1);

function view(s: WhistState, seat: number): KitView {
  const over = s.phase === "finished";
  const w = over ? winner(s) : null;
  const legal = whistLegal(s, seat);
  const firstTrick = s.hands.reduce((n, h) => n + h.length, 0) + s.trick.length === 52;
  return {
    game: "whist",
    seats: 4,
    me: seat,
    teams: true,
    phase: s.phase,
    turn: s.phase === "playing" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: legal.length ? { type: "play", cards: legal.map((c) => c.id) } : null,
    pick: null,
    choices: s.phase === "scored" ? nextHandChoices(s.ready, seat, false) : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: "", team: teamOfSeat(i), dealer: i === s.dealer, badge: i === s.dealer && firstTrick ? `Turned ${rankLabel(power(s.turned))}${SYMBOL[s.trump]}` : undefined })),
    center: { kind: "trick", plays: s.trick.length ? s.trick : (s.lastTrick?.plays ?? []), winner: s.trick.length ? null : (s.lastTrick?.winner ?? null) },
    melds: [],
    info: [`Trump ${SYMBOL[s.trump]}`, `Tricks ${s.tricks[teamOfSeat(seat)]} to ${s.tricks[1 - teamOfSeat(seat)]}`, `To ${s.rules.playTo}`],
    narration: s.narration,
    scores: [
      { seats: [0, 2], value: s.scores[0] },
      { seats: [1, 3], value: s.scores[1] },
    ],
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `whist-${s.hand}`,
            title: "Hand over",
            sides: [
              [0, 2],
              [1, 3],
            ],
            rows: [
              { label: "Tricks", values: s.lastHand.tricks.map(String) },
              ...(s.rules.honours ? [{ label: "Honours", values: s.lastHand.honours.map((n) => (n ? `+${n}` : "0")) }] : []),
              { label: "This hand", values: s.lastHand.odd.map((n, t) => n + s.lastHand!.honours[t]!).map((n) => (n ? `+${n}` : "0")), tone: "score" as const },
              { label: "Score", values: s.scores.map(String), tone: "total" as const },
            ],
          }
        : null,
    over: w !== null ? { winners: [w, w + 2], title: `${who(w)} & ${who(w + 2)} win ${s.scores[w]} to ${s.scores[1 - w]}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: WhistState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const legal = whistLegal(s, seat);
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  if (legal.length === 1 || sloppy) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  const hand = s.hands[seat]!;
  const low = (cards: KCard[]) => [...cards].sort((a, b) => power(a) - power(b))[0]!;
  if (!s.trick.length) {
    // Lead an ace, else from the longest plain suit (keep trumps), low.
    const aces = legal.filter((c) => power(c) === 14 && suitOf(c) !== s.trump);
    if (aces.length) return { type: "play", card: aces[0]!.id };
    const plain = legal.filter((c) => suitOf(c) !== s.trump);
    const pool = plain.length ? plain : legal;
    const len = (c: KCard) => hand.filter((x) => suitOf(x) === suitOf(c)).length;
    return { type: "play", card: [...pool].sort((a, b) => len(b) - len(a) || power(a) - power(b))[0]!.id };
  }
  const winning = trickWinner(s.trick, s.trump, suitOf, power);
  const partner = teamOfSeat(winning.seat) === teamOfSeat(seat);
  const last = s.trick.length === 3;
  // Second hand low; partner winning: play low; otherwise win as cheaply as you can.
  if (partner && (last || power(winning.card) >= 13 || suitOf(winning.card) === s.trump)) return { type: "play", card: bestLoser(legal, seat, s.trick, s.trump, suitOf, power).id };
  if (s.trick.length === 1 && suitOf(legal[0]!) === suitOf(s.trick[0]!.card) && !legal.some((c) => power(c) === 14)) return { type: "play", card: low(legal).id };
  const win = cheapestWinner(legal, seat, s.trick, s.trump, suitOf, power);
  return { type: "play", card: (win ?? bestLoser(legal, seat, s.trick, s.trump, suitOf, power)).id };
}

export const whist: CardGame<WhistRules, WhistState, Move> = {
  id: "whist",
  name: "Whist",
  emoji: "🎩",
  blurb: "Spades' grandparent: partners and tricks",
  tagline: "The old parlour game: trump is turned up, partners sit across, and every trick over six counts.",
  seats: { min: 4, max: 4, default: 4 },
  teams: true,
  presets: [shortWhist, longWhist, honoursWhist],
  fields: [
    { key: "playTo", label: "Game to", kind: "choice", options: [[5, "5 (short whist)"], [7, "7 (long whist)"], [10, "10"]] },
    { key: "honours", label: "Honours", hint: "A side dealt all four of A K Q J of trump scores 4; three of them, 2.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<WhistRules>;
    const base = [shortWhist, longWhist, honoursWhist].find((p) => p.id === given.id) ?? shortWhist;
    return { ...base, ...given };
  },
  validate: (r) => (r.playTo >= 1 && r.playTo <= 20 ? [] : ["Play to between 1 and 20."]),
  describe(r) {
    return [
      "Partners across. Thirteen cards each. The dealer's last card is turned face up: its suit is trump for the hand.",
      "The player left of the dealer leads. Follow suit if you can; if you can't, play anything (a trump wins it). Highest trump, or highest card of the suit led, takes the trick.",
      `Each trick your side takes over six scores a point.${r.honours ? " Honours: a side dealt all four of the ace, king, queen and jack of trump scores 4 more; three of them, 2 (but honours alone can't win the game)." : ""}`,
      `First side to ${r.playTo} wins.`,
    ];
  },
  newGame: newWhist,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => (s.phase === "scored" ? 1400 : thinkFor(whistLegal(s, seat).length)),
  summary(s) {
    const over = s.phase === "finished";
    const w = winner(s);
    return {
      game: "whist",
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
