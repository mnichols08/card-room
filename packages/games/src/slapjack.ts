// Slapjack: the whole deck is dealt face down. Take turns flipping your top card onto the middle.
// When a jack shows, everybody races to slap it: the first slap takes the whole pile. Slap anything
// else and you lose a card to the pile. Run out of cards and you can still slap your way back in on
// the next jack (miss it and you're out). Whoever ends up with every card wins.
import type { PlayStyle } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  nextRandom,
  rankLabel,
  rankSeats,
  shuffled,
  SYMBOL,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
} from "./kit.js";

export interface SlapjackRules extends BaseRules {
  /** How quickly the computer players slap. */
  speed: "relaxed" | "quick" | "lightning";
  /** Two of the same rank in a row can be slapped too. */
  doubles: boolean;
  /** Flips before the game ends (most cards wins); 0 plays until someone has every card. */
  limit: number;
}

export const classicSlap: SlapjackRules = { id: "slap-classic", name: "Slapjack", speed: "quick", doubles: false, limit: 150 };
export const easySlap: SlapjackRules = { ...classicSlap, id: "slap-easy", name: "Relaxed (slower slappers)", speed: "relaxed" };
export const doublesSlap: SlapjackRules = { ...classicSlap, id: "slap-doubles", name: "Jacks and doubles", doubles: true };

export interface SlapjackState {
  game: "slapjack";
  rules: SlapjackRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  decks: KCard[][];
  pile: KCard[];
  turn: number;
  phase: "flipping" | "slap" | "finished";
  /** Players who ran out: they get one more chance, on the next jack. */
  hanging: boolean[];
  /** Players who are out for good. */
  out: boolean[];
  flips: number;
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const label = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[(c as { suit: keyof typeof SYMBOL }).suit]}`;

/** Can the pile be slapped now? A jack on top, or (with doubles) two of a rank in a row. */
export function slappable(s: SlapjackState): boolean {
  const t = s.pile.at(-1);
  if (!t) return false;
  if (rank(t) === 11) return true;
  return s.rules.doubles && s.pile.length >= 2 && rank(s.pile.at(-2)!) === rank(t);
}

const inGame = (s: SlapjackState, seat: number) => !s.out[seat];
function nextFlipper(s: SlapjackState, from: number): number {
  for (let k = 1; k <= s.seats; k++) {
    const n = (from + k) % s.seats;
    if (s.decks[n]!.length) return n;
  }
  return from;
}

export function newSlapjack(rules: SlapjackRules, seats: number, seed: number): SlapjackState {
  const s = { game: "slapjack", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, pile: [], flips: 0, phase: "flipping", narration: null } as unknown as SlapjackState;
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.decks = Array.from({ length: seats }, () => []);
  deck.forEach((c, i) => s.decks[i % seats]!.push(c));
  s.hanging = Array(seats).fill(false);
  s.out = Array(seats).fill(false);
  s.turn = (s.dealer + 1) % seats;
  return s;
}

/** Out of cards: hang on for the next jack. */
function settleHanging(s: SlapjackState) {
  for (let i = 0; i < s.seats; i++) if (!s.out[i] && !s.decks[i]!.length && !s.hanging[i]) s.hanging[i] = true;
}

function checkEnd(s: SlapjackState) {
  settleHanging(s);
  const alive = s.decks.map((_, i) => i).filter((i) => !s.out[i]);
  if (alive.length <= 1) {
    s.phase = "finished";
    return;
  }
  if (s.rules.limit && s.flips >= s.rules.limit && s.phase !== "slap") s.phase = "finished";
}

type Move = { type: "flip" } | { type: "slap" };

function apply(state: SlapjackState, seat: number, move: Move): SlapjackState {
  const s = clone(state);
  if (s.phase === "finished") throw new GameError("The game is over.");
  if (move.type === "flip") {
    if (s.phase !== "flipping" || s.turn !== seat) throw new GameError("It's not your turn to flip.");
    const card = s.decks[seat]!.shift();
    if (!card) throw new GameError("You have no cards to flip.");
    s.pile.push(card);
    s.flips += 1;
    if (slappable(s)) {
      s.phase = "slap";
      s.narration = rank(card) === 11 ? `A jack! Slap it!` : `Doubles! Slap it!`;
    } else {
      s.narration = null;
      s.turn = nextFlipper(s, seat);
      checkEnd(s);
      // Nobody left to flip (everyone else is hanging on): the pile goes to the last flipper.
      if (s.phase === "flipping" && !s.decks[s.turn]!.length) {
        s.decks[seat]!.push(...s.pile);
        s.pile = [];
        checkEnd(s);
      }
    }
    return s;
  }
  if (move.type !== "slap") throw new GameError("That's not a move in Slapjack.");
  if (!inGame(s, seat)) throw new GameError("You're out of the game.");
  if (s.phase === "slap") {
    const n = s.pile.length;
    s.decks[seat]!.push(...s.pile);
    s.pile = [];
    s.narration = `${who(seat)} slapped first and takes ${n} card${n === 1 ? "" : "s"}! 👋`;
    // Anyone else hanging on missed their chance: they're out.
    const gone = s.hanging.flatMap((h, i) => (h && i !== seat ? [i] : []));
    for (const i of gone) s.out[i] = true;
    s.hanging = Array(s.seats).fill(false);
    if (gone.length) s.narration += ` ${gone.map(who).join(" and ")} ${gone.length > 1 ? "are" : "is"} out`;
    s.phase = "flipping";
    s.turn = seat;
    checkEnd(s);
    return s;
  }
  // A slap at nothing: lose a card to the bottom of the pile.
  const lost = s.decks[seat]!.shift();
  if (!lost) throw new GameError("No jack there!");
  s.pile.unshift(lost);
  s.narration = `${who(seat)} slapped a ${label(s.pile.at(-1)!)}: no jack! A card goes to the pile`;
  if (!s.decks[seat]!.length && s.turn === seat) s.turn = nextFlipper(s, seat);
  checkEnd(s);
  return s;
}

function winners(s: SlapjackState): number[] {
  const most = Math.max(...s.decks.map((d) => d.length));
  return s.decks.flatMap((d, i) => (d.length === most ? [i] : []));
}

function view(s: SlapjackState, seat: number): KitView {
  const over = s.phase === "finished";
  const myTurn = s.phase === "flipping" && s.turn === seat && s.decks[seat]!.length > 0;
  const canSlap = !over && inGame(s, seat) && s.pile.length > 0;
  const options = [];
  if (myTurn) options.push({ label: "Flip", move: { type: "flip" }, primary: true });
  if (canSlap) options.push({ label: "👋 Slap!", move: { type: "slap" }, primary: s.phase === "slap" });
  const w = over ? winners(s) : [];
  return {
    game: "slapjack",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "flipping" ? s.turn : null,
    dealer: s.dealer,
    hand: [],
    handHidden: true,
    tap: null,
    pick: null,
    choices: options.length ? { prompt: "", options, layout: "row" } : null,
    players: s.decks.map((d, i) => ({ cards: d.length, line: s.out[i] ? "Out" : d.length ? "" : "No cards: slap the next jack!", out: s.out[i] })),
    center: {
      kind: "piles",
      stock: null,
      discard: s.pile.slice(-3),
      discardCount: s.pile.length,
      drawMove: null,
      takeMove: null,
      discardLabel: s.pile.length ? `${s.pile.length} in the pile` : "Flip to start the pile",
    },
    melds: [],
    info: [s.rules.doubles ? "Slap jacks and doubles" : "Slap the jacks!", ...(s.rules.limit ? [`Flip ${Math.min(s.flips, s.rules.limit)} of ${s.rules.limit}`] : [])],
    narration: s.narration,
    scores: s.decks.map((d, i) => ({ seats: [i], value: d.length })),
    result: null,
    over: over ? { winners: w, title: w.length > 1 ? "It's a tie!" : s.decks[w[0]!]!.length === 52 ? `${who(w[0]!)} won every card!` : `${who(w[0]!)} wins with ${s.decks[w[0]!]!.length} cards` } : null,
  };
}

function bot(s: SlapjackState, seat: number, _style: PlayStyle): Move | null {
  if (s.phase === "slap") return inGame(s, seat) ? { type: "slap" } : null;
  if (s.phase === "flipping" && s.turn === seat && s.decks[seat]!.length) return { type: "flip" };
  return null;
}

const REACTION: Record<SlapjackRules["speed"], number> = { relaxed: 1500, quick: 950, lightning: 620 };

export const slapjack: CardGame<SlapjackRules, SlapjackState, Move> = {
  id: "slapjack",
  name: "Slapjack",
  emoji: "👋",
  blurb: "Flip, and slap the jacks first",
  tagline: "Take turns flipping cards into the middle. See a jack? Slap it first and the pile is yours!",
  seats: { min: 2, max: 6, default: 3 },
  teams: false,
  presets: [classicSlap, easySlap, doublesSlap],
  fields: [
    { key: "speed", label: "Computer slappers", kind: "choice", options: [["relaxed", "Relaxed"], ["quick", "Quick"], ["lightning", "Lightning fast"]] },
    { key: "doubles", label: "Slap doubles too", hint: "Two of the same rank in a row (two 7s, say).", kind: "toggle" },
    { key: "limit", label: "Game ends", kind: "choice", options: [[100, "After 100 flips"], [150, "After 150 flips"], [300, "After 300 flips"], [0, "When someone has every card"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SlapjackRules>;
    const base = [classicSlap, easySlap, doublesSlap].find((p) => p.id === given.id) ?? classicSlap;
    const r = { ...base, ...given };
    return { ...r, limit: Math.max(0, Math.round(Number(r.limit) || 0)), speed: (["relaxed", "quick", "lightning"] as const).includes(r.speed) ? r.speed : "quick" };
  },
  validate: (r) => (r.limit < 0 || r.limit > 1000 ? ["Flips between 1 and 1,000 (or no limit)."] : []),
  describe(r) {
    return [
      "The whole deck is dealt face down. Nobody looks.",
      "Take turns flipping your top card onto the pile in the middle.",
      `When a jack shows${r.doubles ? " (or two of the same rank in a row)" : ""}, everybody races to slap it. The first slap takes the whole pile, and goes next.`,
      "Slap anything else and a card from your pile goes under the middle pile.",
      "Out of cards? Slap the next jack to get back in; miss it and you're out.",
      r.limit ? `After ${r.limit} flips (or when someone has every card), the most cards wins.` : "Whoever ends up with every card wins.",
    ];
  },
  newGame: newSlapjack,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "slap" ? REACTION[s.rules.speed] : 600),
  reactionTime(s, _seat, style) {
    if (s.phase !== "slap") return null;
    const sharp = style.skill ?? 1;
    return Math.round(REACTION[s.rules.speed] * (0.8 + Math.random() * 0.6) * (1.25 - sharp * 0.25));
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "slapjack",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.decks.map((d) => d.length).join(" · ") + " cards",
      order: over ? rankSeats(s.decks.map((d, i) => ({ seats: [i], score: d.length }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
