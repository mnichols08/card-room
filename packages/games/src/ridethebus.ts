// Ride the Bus, a drinking game. Round one: everyone guesses their way to four cards (red or black;
// higher or lower; inside or outside; which suit). Right, hand out drinks; wrong, drink. Round two:
// a pyramid of ten cards is turned over, row by row; match a card in your hand and hand out drinks
// (more the higher the row), and the card goes on the pyramid. Whoever has the most cards left rides
// the bus: the four guesses again, drinking and starting over at every wrong one, until they get all
// four in a row.
import type { PlayStyle, Suit } from "@spades/rules";
import { botGiveTarget, drink, DRINK_NOTE, giveChoices, giveTo, newTally, type Tally } from "./drinks.js";
import { clone, FULL, GameError, makeDeck, nextRandom, rankLabel, rankSeats, shuffled, SUITS, SYMBOL, who, type BaseRules, type CardGame, type Choice, type KCard, type KitView } from "./kit.js";

export interface BusRules extends BaseRules {
  /** Wrong guesses on the bus before it lets you off anyway. */
  busLimit: number;
}

export const classicBus: BusRules = { id: "bus-classic", name: "Ride the Bus", busLimit: 8 };
export const longBus: BusRules = { ...classicBus, id: "bus-long", name: "No mercy (the bus doesn't stop)", busLimit: 30 };

export interface BusState {
  game: "ridethebus";
  rules: BusRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: "guess" | "pyramid" | "bus" | "finished";
  hands: KCard[][];
  deck: KCard[];
  /** Round one: which question (0–3) everyone is on. */
  question: number;
  turn: number;
  /** The pyramid: 4, 3, 2, 1 cards from the bottom; null not turned yet. */
  pyramid: (KCard | null)[];
  hidden: KCard[];
  flipped: number;
  rider: number | null;
  /** The bus: the cards so far this try, and wrong guesses. */
  bus: KCard[];
  wrongs: number;
  tally: Tally;
  last: KCard | null;
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const suitOf = (c: KCard) => (c as { suit: Suit }).suit;
const red = (c: KCard) => suitOf(c) === "hearts" || suitOf(c) === "diamonds";
const label = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[suitOf(c)]}`;
const ROW = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4];
export const QUESTIONS = ["Red or black?", "Higher or lower?", "Inside or outside?", "Which suit?"];

function draw(s: BusState): KCard {
  if (!s.deck.length) {
    const held = new Set([...s.hands.flat(), ...s.bus, ...s.pyramid.filter(Boolean), ...s.hidden].map((c) => c!.id));
    s.deck = shuffled(makeDeck({ ranks: FULL }).filter((c) => !held.has(c.id)), nextRandom(s));
  }
  return s.deck.pop()!;
}

export function newBus(rules: BusRules, seats: number, seed: number): BusState {
  const s = { game: "ridethebus", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, phase: "guess", question: 0, pyramid: Array(10).fill(null), hidden: [], flipped: 0, rider: null, bus: [], wrongs: 0, last: null, narration: null } as unknown as BusState;
  s.deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hands = Array.from({ length: seats }, () => []);
  s.tally = newTally(seats);
  s.turn = (s.dealer + 1) % seats;
  s.narration = `Round one: ${QUESTIONS[0]}`;
  return s;
}

/** Is the guess right for the next card, given the cards so far? */
export function guessRight(so: KCard[], guess: string, c: KCard): boolean {
  switch (so.length) {
    case 0:
      return guess === (red(c) ? "red" : "black");
    case 1:
      return guess === "higher" ? rank(c) > rank(so[0]!) : rank(c) < rank(so[0]!);
    case 2: {
      const lo = Math.min(rank(so[0]!), rank(so[1]!));
      const hi = Math.max(rank(so[0]!), rank(so[1]!));
      return guess === "inside" ? rank(c) > lo && rank(c) < hi : rank(c) < lo || rank(c) > hi;
    }
    default:
      return guess === suitOf(c);
  }
}

const optionsFor = (n: number): Choice[] =>
  n === 0
    ? [{ label: "Red", move: { type: "guess", guess: "red" } }, { label: "Black", move: { type: "guess", guess: "black" } }]
    : n === 1
      ? [{ label: "Higher", move: { type: "guess", guess: "higher" } }, { label: "Lower", move: { type: "guess", guess: "lower" } }]
      : n === 2
        ? [{ label: "Inside", move: { type: "guess", guess: "inside" } }, { label: "Outside", move: { type: "guess", guess: "outside" } }]
        : SUITS.map((x) => ({ label: SYMBOL[x], move: { type: "guess", guess: x } }));

function startPyramid(s: BusState) {
  s.phase = "pyramid";
  s.hidden = Array.from({ length: 10 }, () => draw(s));
  s.turn = s.dealer;
  s.narration = "Round two: the pyramid. Match a card and hand out drinks";
}

function startBus(s: BusState) {
  const most = Math.max(...s.hands.map((h) => h.length));
  const riders = s.hands.flatMap((h, i) => (h.length === most ? [i] : []));
  s.rider = riders[nextRandom(s)() * riders.length | 0]!;
  s.phase = "bus";
  s.turn = s.rider;
  s.bus = [];
  s.wrongs = 0;
  s.narration = `${who(s.rider)} has the most cards left and rides the bus! 🚌`;
}

type Move = { type: "guess"; guess: string } | { type: "flip" } | { type: "give"; to: number };

function apply(state: BusState, seat: number, move: Move): BusState {
  const s = clone(state);
  if (s.phase === "finished") throw new GameError("The game is over.");
  if (move.type === "give") {
    if (!s.tally.give.length || s.tally.give[0]!.from !== seat) throw new GameError("You have no drinks to hand out.");
    try {
      s.narration = giveTo(s.tally, seat, Number(move.to), s.seats);
    } catch {
      throw new GameError("Pick someone else to drink.");
    }
    if (s.phase === "pyramid" && !s.tally.give.length && s.flipped === 10) startBus(s);
    return s;
  }
  if (s.tally.give.length) throw new GameError(`Waiting for ${who(s.tally.give[0]!.from)} to hand out drinks.`);
  if (s.turn !== seat) throw new GameError("It's not your turn.");
  if (move.type === "guess") {
    if (s.phase === "guess") {
      const so = s.hands[seat]!;
      const c = draw(s);
      const right = guessRight(so, String(move.guess), c);
      so.push(c);
      s.last = c;
      const n = s.question + 1;
      if (right) {
        s.tally.give.push({ from: seat, n, why: `Right (${label(c)})` });
        s.narration = `${who(seat)} called it: the ${label(c)}!`;
      } else s.narration = `${who(seat)} guessed wrong: the ${label(c)} · ${drink(s.tally, [seat], n)}`;
      // Next player; after everyone, the next question.
      s.turn = (seat + 1) % s.seats;
      if (s.turn === (s.dealer + 1) % s.seats) {
        s.question += 1;
        if (s.question === 4) startPyramid(s);
        else s.narration += ` · Next: ${QUESTIONS[s.question]}`;
      }
      return s;
    }
    if (s.phase === "bus") {
      const c = draw(s);
      const right = guessRight(s.bus, String(move.guess), c);
      s.last = c;
      if (right) {
        s.bus.push(c);
        if (s.bus.length === 4) {
          s.phase = "finished";
          s.narration = `${who(seat)} got off the bus! 🎉`;
        } else s.narration = `Right: the ${label(c)}. ${QUESTIONS[s.bus.length]}`;
      } else {
        const n = s.bus.length + 1;
        s.wrongs += 1;
        s.bus = [];
        s.narration = `Wrong: the ${label(c)} · ${drink(s.tally, [seat], n)} · back to the start`;
        if (s.wrongs >= s.rules.busLimit) {
          s.phase = "finished";
          s.narration += `. That's ${s.wrongs} wrong: the driver lets ${who(seat)} off 😅`;
        }
      }
      return s;
    }
    throw new GameError("It's not time to guess.");
  }
  if (move.type === "flip") {
    if (s.phase !== "pyramid") throw new GameError("It's not time to turn the pyramid.");
    const k = s.flipped;
    const c = s.hidden[k]!;
    s.pyramid[k] = c;
    s.flipped += 1;
    s.last = c;
    const n = ROW[k]!;
    const parts: string[] = [];
    for (let i = 0; i < s.seats; i++) {
      const matches = s.hands[i]!.filter((x) => rank(x) === rank(c));
      if (!matches.length) continue;
      s.hands[i] = s.hands[i]!.filter((x) => rank(x) !== rank(c));
      s.tally.give.push({ from: i, n: n * matches.length, why: `Matched the ${rankLabel(rank(c))}` });
      parts.push(who(i));
    }
    s.narration = `Row ${n}: the ${label(c)}${parts.length ? ` · ${parts.join(" and ")} hand${parts.length === 1 ? "s" : ""} out drinks` : " · no matches"}`;
    if (s.flipped === 10 && !s.tally.give.length) startBus(s);
    return s;
  }
  throw new GameError("That's not a move in Ride the Bus.");
}

function view(s: BusState, seat: number): KitView {
  const over = s.phase === "finished";
  const give = giveChoices(s.tally, s.seats, seat);
  const waiting = s.tally.give.length > 0;
  let choices: KitView["choices"] = give;
  if (!waiting && !over && s.turn === seat) {
    if (s.phase === "guess") choices = { prompt: QUESTIONS[s.question]!, options: optionsFor(s.question), layout: "row" };
    else if (s.phase === "bus") choices = { prompt: `On the bus: ${QUESTIONS[s.bus.length]}`, options: optionsFor(s.bus.length), layout: "row" };
    else if (s.phase === "pyramid") choices = { prompt: "", options: [{ label: "Turn the next card", move: { type: "flip" }, primary: true }] };
  }
  // The pyramid, top row first: 1, 2, 3, 4 cards.
  const rows = [[9], [7, 8], [4, 5, 6], [0, 1, 2, 3]].map((row) => row.map((pos) => s.pyramid[pos] ?? ("back" as const)));
  const nobody = s.phase !== "pyramid" && s.flipped === 0;
  return {
    game: "ridethebus",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : waiting ? s.tally.give[0]!.from : s.turn,
    dealer: s.dealer,
    hand: seat === s.rider && s.phase === "bus" ? s.bus : s.hands[seat]!,
    tap: null,
    pick: null,
    choices,
    players: s.hands.map((h, i) => ({ cards: i === seat ? (seat === s.rider && s.phase === "bus" ? s.bus.length : h.length) : h.length, line: `🍺 ${s.tally.drank[i]}${i === s.rider ? " · on the bus 🚌" : ""}`, dealer: i === s.dealer })),
    center: nobody
      ? { kind: "piles", stock: s.deck.length, discard: s.last ? [s.last] : [], discardCount: s.last ? 1 : 0, drawMove: null, takeMove: null, discardLabel: s.last ? "Last card" : "" }
      : { kind: "pyramid", rows, tap: null, held: null, stock: 0, waste: null, drawMove: null, stockLabel: "", noStock: true },
    melds: s.phase === "guess" ? s.hands.flatMap((h, i) => (i !== seat && h.length ? [{ owner: i, label: "", cards: h }] : [])) : s.phase === "bus" && seat !== s.rider ? [{ owner: s.rider!, label: "On the bus", cards: s.bus }] : [],
    info: [s.phase === "guess" ? `Round one, question ${s.question + 1} of 4` : s.phase === "pyramid" ? `The pyramid: ${s.flipped} of 10 turned` : s.phase === "bus" ? `${who(s.rider!)} is on the bus: ${s.bus.length} of 4 right` : "Done!", DRINK_NOTE],
    narration: s.narration,
    scores: s.tally.drank.map((value, i) => ({ seats: [i], value })),
    result: null,
    over: over ? { winners: s.hands.map((_, i) => i).filter((i) => i !== s.rider), title: `${who(s.rider!)} rode the bus. Everyone else wins!` } : null,
  };
}

function bot(s: BusState, seat: number, _style: PlayStyle): Move | null {
  if (s.phase === "finished") return null;
  if (s.tally.give.length) return s.tally.give[0]!.from === seat ? { type: "give", to: botGiveTarget(s.tally, seat, s.seats) } : null;
  if (s.turn !== seat) return null;
  if (s.phase === "pyramid") return { type: "flip" };
  const so = s.phase === "bus" ? s.bus : s.hands[seat]!;
  const n = so.length;
  if (n === 0) return { type: "guess", guess: Math.random() < 0.5 ? "red" : "black" };
  if (n === 1) return { type: "guess", guess: rank(so[0]!) >= 8 ? "lower" : "higher" };
  if (n === 2) return { type: "guess", guess: Math.abs(rank(so[0]!) - rank(so[1]!)) >= 7 ? "inside" : "outside" };
  const counts = SUITS.map((x) => ({ x, n: so.filter((c) => suitOf(c) === x).length }));
  return { type: "guess", guess: counts.sort((a, b) => a.n - b.n)[0]!.x };
}

export const rideTheBus: CardGame<BusRules, BusState, Move> = {
  id: "ridethebus",
  name: "Ride the Bus",
  emoji: "🚌",
  blurb: "Drinking game: guess, match, and don't ride the bus",
  tagline: "A drinking game. Guess your four cards, match the pyramid, and whoever's left holding the most rides the bus.",
  seats: { min: 2, max: 8, default: 4 },
  teams: false,
  presets: [classicBus, longBus],
  fields: [{ key: "busLimit", label: "The bus lets you off after", kind: "choice", options: [[5, "5 wrong guesses"], [8, "8 wrong guesses"], [30, "Never (no mercy)"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<BusRules>;
    const base = [classicBus, longBus].find((p) => p.id === given.id) ?? classicBus;
    const r = { ...base, ...given };
    return { ...r, busLimit: Math.max(1, Number(r.busLimit) || 8) };
  },
  validate: () => [],
  describe: (r) => [
    `${DRINK_NOTE} Adults only.`,
    "Round one, four times round the table: red or black? Higher or lower than your first card? Inside or outside your first two? Which suit? Right: hand out that many drinks (1, 2, 3, 4). Wrong: drink them.",
    "Round two: a pyramid of ten cards is turned over, bottom row first. Hold a card of the same rank? Hand out drinks: 1 a card on the bottom row, up to 4 at the top. The card goes on the pyramid.",
    `Whoever has the most cards left rides the bus: the four guesses again with new cards. Every wrong guess, drink and start over, until all four in a row are right${r.busLimit < 30 ? ` (or ${r.busLimit} wrong guesses, when the driver takes pity)` : ""}.`,
  ],
  newGame: newBus,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.tally.give.length ? 1200 : s.phase === "pyramid" ? 1500 : 1300),
  summary(s) {
    const over = s.phase === "finished";
    return { game: "ridethebus", rules: s.rules.name, phase: s.phase, over, hand: 1, scoreLine: s.tally.drank.join(" · ") + " drinks", order: over ? rankSeats(s.tally.drank.map((score, i) => ({ seats: [i], score })), true) : null, winners: over ? s.hands.map((_, i) => i).filter((i) => i !== s.rider) : null, teams: false, seats: s.seats };
  },
};
