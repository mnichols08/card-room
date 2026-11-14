// Fruit Salad: our own colour-card game. Four fruits (cherry, lemon, pear, grape), each with cards
// 0 to 9 and three action cards: Hop (the next player misses a go), Turn (play changes direction)
// and +2 (the next player picks up two and misses a go). Salad cards are wild: name the next fruit.
// Big Salad is wild too, and the next player picks up four. Match the top card's fruit or face, call
// "Last bite!" before your last card, and be the first to clear your hand.
import type { PlayStyle } from "@spades/rules";
import {
  clone,
  GameError,
  markReady,
  nextRandom,
  rankSeats,
  shuffled,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type Fruit,
  type FruitCard,
  type FruitFace,
  type KCard,
  type KitView,
} from "./kit.js";

export interface FruitRules extends BaseRules {
  /** One hand (first out wins) or points to a target: the winner scores what's left in the other hands. */
  scoring: "single" | "points";
  playTo: number;
  /** A +2 can be answered with a +2 (and Big Salad with Big Salad), passing the lot on. */
  stack: boolean;
  /** Call "Last bite!" before playing down to one card, or pick up two. */
  lastBite: boolean;
}

export const classicFruit: FruitRules = { id: "fruit-classic", name: "Fruit Salad", scoring: "single", playTo: 300, stack: false, lastBite: true };
export const stackFruit: FruitRules = { ...classicFruit, id: "fruit-stack", name: "Stacking +2s", stack: true };
export const pointsFruit: FruitRules = { ...classicFruit, id: "fruit-points", name: "Points to 300", scoring: "points" };

export const FRUITS: Fruit[] = ["cherry", "lemon", "pear", "grape"];
export const FRUIT_EMOJI: Record<Fruit, string> = { cherry: "🍒", lemon: "🍋", pear: "🍐", grape: "🍇" };
const FRUIT_NAME: Record<Fruit, string> = { cherry: "cherry", lemon: "lemon", pear: "pear", grape: "grape" };
type FCard = FruitCard & { id: string };

export interface FruitState {
  game: "fruitsalad";
  rules: FruitRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: "playing" | "fruit" | "scored" | "finished";
  hands: KCard[][];
  stock: KCard[];
  discard: KCard[];
  /** The fruit to match: the top card's, or the one named with a salad. */
  fruit: Fruit;
  turn: number;
  direction: 1 | -1;
  /** Cards the player on turn must pick up (from +2s and Big Salads). */
  owed: number;
  drew: boolean;
  called: boolean[];
  /** Turns in a row where nobody could play or draw: a full round ends the hand. */
  stuck: number;
  scores: number[];
  lastHand: { winner: number; points: number; left: number[] } | null;
  ready: boolean[];
  narration: string | null;
}

const f = (c: KCard) => c as FCard;
const wild = (c: KCard) => f(c).fruit === null;
const top = (s: FruitState) => f(s.discard[s.discard.length - 1]!);
const step = (s: FruitState, from: number, by = 1) => (((from + s.direction * by) % s.seats) + s.seats) % s.seats;
export const fruitPoints = (c: KCard) => (wild(c) ? 50 : typeof f(c).face === "number" ? (f(c).face as number) : 20);
const FACE_NAME: Record<string, string> = { hop: "Hop", turn: "Turn", plus2: "+2", salad: "Salad", salad4: "Big Salad" };
export const fruitName = (c: KCard) => (wild(c) ? FACE_NAME[f(c).face as string]! : `${FRUIT_NAME[f(c).fruit!]} ${typeof f(c).face === "number" ? f(c).face : FACE_NAME[f(c).face as string]}`);

/** The 108-card deck: per fruit a 0, two each of 1–9, Hop, Turn and +2; four Salads and four Big Salads. */
export function fruitDeck(): KCard[] {
  const out: KCard[] = [];
  const add = (fruit: Fruit | null, face: FruitFace, n: number) => {
    for (let k = 1; k <= n; k++) out.push({ kind: "fruit", fruit, face, id: `${fruit ?? "wild"}-${face}-${k}` } as KCard);
  };
  for (const fruit of FRUITS) {
    add(fruit, 0, 1);
    for (let v = 1; v <= 9; v++) add(fruit, v as FruitFace, 2);
    add(fruit, "hop", 2);
    add(fruit, "turn", 2);
    add(fruit, "plus2", 2);
  }
  add(null, "salad", 4);
  add(null, "salad4", 4);
  return out;
}

const ORDER: Record<string, number> = { hop: 10, turn: 11, plus2: 12, salad: 13, salad4: 14 };
const sortHand = (cards: KCard[]) =>
  [...cards].sort((a, b) => {
    const fa = f(a).fruit === null ? 9 : FRUITS.indexOf(f(a).fruit!);
    const fb = f(b).fruit === null ? 9 : FRUITS.indexOf(f(b).fruit!);
    const va = typeof f(a).face === "number" ? (f(a).face as number) : ORDER[f(a).face as string]!;
    const vb = typeof f(b).face === "number" ? (f(b).face as number) : ORDER[f(b).face as string]!;
    return fa - fb || va - vb;
  });

function refill(s: FruitState) {
  if (s.stock.length || s.discard.length <= 1) return;
  const keep = s.discard.pop()!;
  s.stock = shuffled(s.discard, nextRandom(s));
  s.discard = [keep];
}

function deal(s: FruitState) {
  const deck = shuffled(fruitDeck(), nextRandom(s));
  s.hands = Array.from({ length: s.seats }, (_, i) => sortHand(deck.slice(i * 7, i * 7 + 7)));
  let rest = deck.slice(s.seats * 7);
  // Start on a plain number card.
  while (typeof f(rest[0]!).face !== "number") rest = [...rest.slice(1), rest[0]!];
  s.discard = [rest[0]!];
  s.stock = rest.slice(1);
  s.fruit = f(rest[0]!).fruit!;
  s.direction = 1;
  s.turn = (s.dealer + 1) % s.seats;
  s.owed = 0;
  s.drew = false;
  s.called = Array(s.seats).fill(false);
  s.stuck = 0;
  s.ready = Array(s.seats).fill(false);
  s.phase = "playing";
  s.narration = null;
}

export function newFruitSalad(rules: FruitRules, seats: number, seed: number): FruitState {
  const s = { game: "fruitsalad", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, scores: Array(seats).fill(0), lastHand: null } as unknown as FruitState;
  deal(s);
  return s;
}

/** What this seat may play now. Owing a pick-up, only a card that passes it on (when stacking). */
export function fruitLegal(s: FruitState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  const hand = s.hands[seat]!;
  const t = top(s);
  if (s.owed > 0) return s.rules.stack ? hand.filter((c) => f(c).face === t.face) : [];
  return hand.filter((c) => wild(c) || f(c).fruit === s.fruit || f(c).face === t.face);
}

const dry = (s: FruitState) => !s.stock.length && s.discard.length <= 1;

function endTurn(s: FruitState, skip = 0) {
  s.drew = false;
  s.turn = step(s, s.turn, 1 + skip);
}

type Move = { type: "play"; card: string } | { type: "fruit"; fruit: Fruit } | { type: "draw" } | { type: "pass" } | { type: "bite" } | { type: "next" };

function drawCards(s: FruitState, seat: number, n: number): number {
  let got = 0;
  for (let i = 0; i < n; i++) {
    refill(s);
    const c = s.stock.pop();
    if (!c) break;
    s.hands[seat]!.push(c);
    got++;
  }
  s.hands[seat] = sortHand(s.hands[seat]!);
  if (s.hands[seat]!.length > 2) s.called[seat] = false;
  return got;
}

function apply(state: FruitState, seat: number, move: Move): FruitState {
  const s = clone(state);
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The hand isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = (s.dealer + 1) % s.seats;
      deal(s);
    }
    return s;
  }
  if (move.type === "fruit") {
    if (s.phase !== "fruit" || s.turn !== seat) throw new GameError("It's not time to name a fruit.");
    if (!FRUITS.includes(move.fruit)) throw new GameError("That's not a fruit.");
    s.fruit = move.fruit;
    s.phase = "playing";
    const big = top(s).face === "salad4";
    s.narration = `${who(seat)} made it ${FRUIT_EMOJI[move.fruit]} ${FRUIT_NAME[move.fruit]}`;
    if (big) {
      s.owed += 4;
      if (!s.rules.stack) return pickUp(s, step(s, seat), `${who(seat)} played Big Salad for ${FRUIT_EMOJI[move.fruit]}`);
      s.narration += `: ${who(step(s, seat))} picks up ${s.owed}, or passes it on`;
    }
    endTurn(s);
    return s;
  }
  if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
  switch (move.type) {
    case "bite": {
      if (!s.rules.lastBite || s.hands[seat]!.length !== 2) throw new GameError("Call it when you're about to play your second-last card.");
      s.called[seat] = true;
      s.narration = `${who(seat)}: "Last bite!"`;
      return s;
    }
    case "draw": {
      if (s.owed > 0) return pickUp(s, seat);
      if (fruitLegal(s, seat).length) throw new GameError("You have a card that plays.");
      if (s.drew) throw new GameError("You've drawn: play it if you can, or pass.");
      const got = drawCards(s, seat, 1);
      s.drew = true;
      s.narration = `${who(seat)} drew a card`;
      if (!got && !fruitLegal(s, seat).length) return blocked(s);
      if (!fruitLegal(s, seat).length) {
        endTurn(s);
        s.narration = `${who(seat)} drew and passed`;
      }
      return s;
    }
    case "pass": {
      if (s.owed > 0) throw new GameError(`Pick up ${s.owed} first.`);
      if (!s.drew && !dry(s)) throw new GameError("Draw a card first.");
      s.narration = `${who(seat)} passed`;
      if (dry(s) && !fruitLegal(s, seat).length) return blocked(s);
      endTurn(s);
      return s;
    }
    case "play": {
      const card = s.hands[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      if (!fruitLegal(s, seat).some((c) => c.id === card.id)) {
        throw new GameError(s.owed > 0 ? `Pick up ${s.owed}${s.rules.stack ? `, or pass it on with a ${FACE_NAME[top(s).face as string]}` : ""}.` : `Match the ${FRUIT_EMOJI[s.fruit]} or the ${typeof top(s).face === "number" ? top(s).face : FACE_NAME[top(s).face as string]}, or play a salad.`);
      }
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.discard.push(card);
      s.stuck = 0;
      if (!wild(card)) s.fruit = f(card).fruit!;
      if (!s.hands[seat]!.length) {
        scoreHand(s, seat);
        return s;
      }
      let penalty = "";
      if (s.rules.lastBite && s.hands[seat]!.length === 1 && !s.called[seat]) {
        drawCards(s, seat, 2);
        penalty = ` (and forgot "Last bite!": picks up two)`;
      }
      s.narration = `${who(seat)} played ${fruitName(card)}${penalty}`;
      const face = f(card).face;
      if (wild(card)) {
        s.phase = "fruit";
        return s;
      }
      if (face === "hop") {
        s.narration = `${who(seat)} hopped over ${who(step(s, seat))}${penalty}`;
        endTurn(s, 1);
      } else if (face === "turn") {
        if (s.seats === 2) endTurn(s, 1);
        else {
          s.direction = s.direction === 1 ? -1 : 1;
          endTurn(s);
        }
        s.narration = `${who(seat)} turned the play around${penalty}`;
      } else if (face === "plus2") {
        s.owed += 2;
        if (!s.rules.stack) return pickUp(s, step(s, seat), `${who(seat)} played +2${penalty}`);
        s.narration = `${who(seat)} played +2: ${who(step(s, seat))} picks up ${s.owed}, or passes it on${penalty}`;
        endTurn(s);
      } else endTurn(s);
      return s;
    }
    default:
      throw new GameError("That's not a move in Fruit Salad.");
  }
}

/** The seat picks up what it owes and misses its go. `lead` says what made it happen. */
function pickUp(s: FruitState, seat: number, lead?: string): FruitState {
  const got = drawCards(s, seat, s.owed);
  s.owed = 0;
  s.narration = `${lead ? `${lead}: ` : ""}${who(seat)} picks up ${got} (missing a go)`;
  s.turn = step(s, seat);
  s.drew = false;
  return s;
}

function blocked(s: FruitState): FruitState {
  s.stuck += 1;
  if (s.stuck < s.seats) {
    endTurn(s);
    return s;
  }
  const left = s.hands.map((h) => h.reduce((n, c) => n + fruitPoints(c), 0));
  scoreHand(s, left.indexOf(Math.min(...left)));
  s.narration = `Nobody can play: ${who(s.lastHand!.winner)} has the fewest points and wins the hand`;
  return s;
}

function scoreHand(s: FruitState, winner: number) {
  const left = s.hands.map((h) => h.reduce((n, c) => n + fruitPoints(c), 0));
  const points = left.reduce((a, b) => a + b, 0);
  s.scores[winner]! += s.rules.scoring === "points" ? points : 1;
  s.lastHand = { winner, points, left };
  s.narration = `${who(winner)} cleared the bowl! 🥗`;
  s.ready = Array(s.seats).fill(false);
  s.phase = s.rules.scoring === "single" || s.scores.some((n) => n >= s.rules.playTo) ? "finished" : "scored";
}

function winners(s: FruitState): number[] {
  if (s.rules.scoring === "single") return s.lastHand ? [s.lastHand.winner] : [];
  const best = Math.max(...s.scores);
  return s.scores.flatMap((n, i) => (n === best ? [i] : []));
}

function view(s: FruitState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.turn === seat && (s.phase === "playing" || s.phase === "fruit");
  const legal = fruitLegal(s, seat);
  const options: { label: string; move: Record<string, unknown>; primary?: boolean }[] = [];
  if (s.phase === "fruit" && s.turn === seat) for (const x of FRUITS) options.push({ label: `${FRUIT_EMOJI[x]} ${FRUIT_NAME[x][0]!.toUpperCase()}${FRUIT_NAME[x].slice(1)}`, move: { type: "fruit", fruit: x } });
  if (mine && s.phase === "playing") {
    if (s.rules.lastBite && s.hands[seat]!.length === 2 && !s.called[seat] && legal.length) options.push({ label: "Last bite!", move: { type: "bite" } });
    if (s.owed > 0) options.push({ label: `Pick up ${s.owed}`, move: { type: "draw" }, primary: !legal.length });
    else if (s.drew || (dry(s) && !legal.length)) options.push({ label: "Pass", move: { type: "pass" } });
  }
  const t = top(s);
  return {
    game: "fruitsalad",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" || s.phase === "fruit" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: s.phase === "playing" && s.turn === seat && legal.length ? { type: "play", cards: legal.map((c) => c.id) } : null,
    pick: null,
    choices: options.length
      ? { prompt: s.phase === "fruit" ? "Your salad: which fruit is next?" : "", options, layout: s.phase === "fruit" ? "grid" : undefined }
      : s.phase === "scored" && !s.ready[seat]
        ? { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] }
        : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: h.length === 1 ? "Last bite!" : "", dealer: i === s.dealer })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.discard.slice(-3),
      discardCount: s.discard.length,
      drawMove: mine && s.phase === "playing" && ((s.owed > 0) || (!legal.length && !s.drew && !dry(s))) ? { type: "draw" } : null,
      takeMove: null,
      note: wild(t) ? `Now: ${FRUIT_EMOJI[s.fruit]} ${FRUIT_NAME[s.fruit]}` : null,
    },
    melds: [],
    info: [
      s.owed > 0 ? `${who(s.turn)} picks up ${s.owed}${s.rules.stack ? " (or passes it on)" : ""}` : `Match ${FRUIT_EMOJI[s.fruit]} or the ${typeof t.face === "number" ? t.face : FACE_NAME[t.face as string]} · salads are wild`,
      ...(s.seats > 2 ? [s.direction === 1 ? "Play goes left ↻" : "Play goes right ↺"] : []),
      ...(s.rules.scoring === "points" ? [`To ${s.rules.playTo}`] : []),
    ],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `fruit-${s.hand}`,
            title: `${who(s.lastHand.winner)} cleared the bowl!`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "Left in hand", values: s.lastHand.left.map((n, i) => (i === s.lastHand!.winner ? "—" : String(n))) },
              ...(s.rules.scoring === "points" ? [{ label: "Score", values: s.scores.map(String), tone: "total" as const }] : []),
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: `${who(winners(s)[0]!)} wins!` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: FruitState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const hand = s.hands[seat]!;
  const count = (x: Fruit) => hand.filter((c) => f(c).fruit === x).length;
  if (s.phase === "fruit") return { type: "fruit", fruit: [...FRUITS].sort((a, b) => count(b) - count(a))[0]! };
  if (s.phase !== "playing") return null;
  const legal = fruitLegal(s, seat);
  if (s.owed > 0) return legal.length ? { type: "play", card: legal[0]!.id } : { type: "draw" };
  if (!legal.length) return s.drew || dry(s) ? { type: "pass" } : { type: "draw" };
  if (s.rules.lastBite && hand.length === 2 && !s.called[seat] && Math.random() > (style.sloppy ?? 0) * 0.5) return { type: "bite" };
  if (Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  const next = step(s, seat);
  const nextLow = s.hands[next]!.length <= 2;
  const value = (c: KCard) => {
    if (wild(c)) return hand.length === 1 ? 100 : f(c).face === "salad4" && nextLow ? 40 : -50; // save salads for when nothing else plays
    let v = count(f(c).fruit!) * 3 + fruitPoints(c) / 10;
    if (nextLow && (f(c).face === "plus2" || f(c).face === "hop")) v += 25;
    return v;
  };
  return { type: "play", card: [...legal].sort((a, b) => value(b) - value(a))[0]!.id };
}

export const fruitSalad: CardGame<FruitRules, FruitState, Move> = {
  id: "fruitsalad",
  name: "Fruit Salad",
  emoji: "🥗",
  blurb: "Our own colour-card game: match the fruit",
  tagline: "Match the fruit or the face. Hop, Turn, +2 and wild Salads. Call \"Last bite!\" and clear the bowl first.",
  seats: { min: 2, max: 8, default: 4 },
  teams: false,
  presets: [classicFruit, stackFruit, pointsFruit],
  fields: [
    { key: "scoring", label: "Scoring", kind: "choice", options: [["single", "One hand: first out wins"], ["points", "Points: winner scores what's left"]] },
    { key: "playTo", label: "Points game to", kind: "choice", options: [[200, "200"], [300, "300"], [500, "500"]] },
    { key: "stack", label: "Stack +2s", hint: "Answer a +2 with a +2 (or Big Salad with Big Salad) to pass the pick-up on.", kind: "toggle" },
    { key: "lastBite", label: "Call \"Last bite!\"", hint: "Before your second-last card, or pick up two.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<FruitRules>;
    const base = [classicFruit, stackFruit, pointsFruit].find((p) => p.id === given.id) ?? classicFruit;
    const r = { ...base, ...given };
    return { ...r, playTo: Number(r.playTo) };
  },
  validate(r) {
    const errors: string[] = [];
    if (!["single", "points"].includes(r.scoring)) errors.push("Pick a way to score.");
    if (!(r.playTo >= 50 && r.playTo <= 1000)) errors.push("Play to between 50 and 1000.");
    return errors;
  },
  describe(r) {
    return [
      "Four fruits (🍒 cherry, 🍋 lemon, 🍐 pear, 🍇 grape), each with cards 0 to 9, Hop, Turn and +2; plus wild Salad and Big Salad cards. Seven cards each.",
      "Match the top card's fruit or face (the number, or the same action). A Salad is wild: play it any time and name the next fruit.",
      `Hop: the next player misses a go. Turn: play changes direction. +2: the next player picks up two and misses a go. Big Salad: name the fruit, and the next player picks up four.${r.stack ? " Stacking: answer a +2 with a +2 (or Big Salad with Big Salad) to pass the whole pick-up on." : ""}`,
      "Can't play? Draw one; play it if you can, otherwise your go passes.",
      ...(r.lastBite ? ["About to play your second-last card? Call \"Last bite!\" first, or pick up two."] : []),
      r.scoring === "single" ? "First to clear their hand wins." : `The first out scores the cards left in the other hands (numbers face value, actions 20, salads 50). First to ${r.playTo} wins.`,
    ];
  },
  newGame: newFruitSalad,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "scored") return 900;
    if (s.phase === "fruit") return 1000;
    return thinkFor(fruitLegal(s, seat).length, 0.8);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "fruitsalad",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.rules.scoring === "points" ? s.scores.join(" · ") : s.hands.map((h) => h.length).join(" · ") + " cards",
      order: over ? (s.rules.scoring === "points" ? rankSeats(s.scores.map((score, i) => ({ seats: [i], score }))) : [s.lastHand!.winner, ...rankSeats(s.lastHand!.left.map((score, i) => ({ seats: [i], score })).filter((x) => x.seats[0] !== s.lastHand!.winner), true)]) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
