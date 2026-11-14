// Speed: two players, no turns. Each has a draw pile and a hand of five; in the middle, two piles
// to play on, with a spare pile beside each. Play any card one higher or one lower than either middle
// card (aces go next to kings and 2s), as fast as you can, and draw back up to five. Nobody can
// play? Both say "stuck", and a spare card is flipped onto each middle pile. First to run out of
// cards wins.
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
  sortCards,
  SYMBOL,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
} from "./kit.js";

export interface SpeedRules extends BaseRules {
  /** How quickly the computer player plays. */
  speed: "relaxed" | "quick" | "lightning";
  /** Aces go next to both kings and 2s. */
  wrap: boolean;
}

export const classicSpeed: SpeedRules = { id: "speed-classic", name: "Speed", speed: "quick", wrap: true };
export const easySpeed: SpeedRules = { ...classicSpeed, id: "speed-easy", name: "Relaxed", speed: "relaxed" };
export const fastSpeed: SpeedRules = { ...classicSpeed, id: "speed-fast", name: "Lightning", speed: "lightning" };

export interface SpeedState {
  game: "speed";
  rules: SpeedRules;
  seats: 2;
  rng: number;
  hand: number;
  dealer: number;
  hands: KCard[][];
  draws: KCard[][];
  /** The two middle piles (top last). */
  piles: KCard[][];
  /** The spare piles, one beside each middle pile. */
  spares: KCard[][];
  stuck: boolean[];
  /** Flips in a row with no card played in between: a long run means nobody can ever play. */
  idle: number;
  phase: "playing" | "finished";
  winner: number | null;
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const label = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[(c as { suit: keyof typeof SYMBOL }).suit]}`;
const HAND = 5;

/** Does a card go on a pile with this top card: one higher or one lower? */
export function nextTo(a: KCard, b: KCard, wrap: boolean): boolean {
  const d = Math.abs(rank(a) - rank(b));
  return d === 1 || (wrap && d === 12);
}

/** Which middle piles a card can go on. */
export function speedTargets(s: SpeedState, card: KCard): number[] {
  return [0, 1].filter((p) => {
    const top = s.piles[p]!.at(-1);
    return !!top && nextTo(card, top, s.rules.wrap);
  });
}

const playable = (s: SpeedState, seat: number) => s.hands[seat]!.filter((c) => speedTargets(s, c).length);

function fill(s: SpeedState, seat: number) {
  while (s.hands[seat]!.length < HAND && s.draws[seat]!.length) s.hands[seat]!.push(s.draws[seat]!.shift()!);
  s.hands[seat] = sortCards(s.hands[seat]!);
}

export function newSpeed(rules: SpeedRules, _seats: number, seed: number): SpeedState {
  const s = { game: "speed", rules, seats: 2, rng: seed >>> 0, hand: 0, dealer: seed % 2, winner: null, phase: "playing" } as unknown as SpeedState;
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  // 20 to each draw pile and 5 to each hand; 5 to each spare pile; 1 to each middle pile.
  s.draws = [deck.slice(0, 20), deck.slice(20, 40)];
  s.hands = [[], []];
  s.spares = [deck.slice(40, 45), deck.slice(45, 50)];
  s.piles = [[deck[50]!], [deck[51]!]];
  s.stuck = [false, false];
  s.idle = 0;
  fill(s, 0);
  fill(s, 1);
  s.narration = "Go!";
  return s;
}

/** Both stuck: flip a spare onto each middle pile (reshuffling the middle when the spares run out). */
function flip(s: SpeedState) {
  s.stuck = [false, false];
  s.idle += 1;
  if (!s.spares[0]!.length && !s.spares[1]!.length) {
    // The middle piles, all but their top cards, become new spares.
    const under = [...s.piles[0]!.slice(0, -1), ...s.piles[1]!.slice(0, -1)];
    if (!under.length || s.idle > 40) {
      // Nothing left to flip at all: fewest cards left wins.
      const left = [0, 1].map((i) => s.hands[i]!.length + s.draws[i]!.length);
      s.winner = left[0]! === left[1]! ? null : left[0]! < left[1]! ? 0 : 1;
      s.phase = "finished";
      s.narration = s.winner === null ? "Nobody can play and nothing's left to flip: a tie!" : `Nobody can play: ${who(s.winner)} has fewer cards left and wins`;
      return;
    }
    s.piles = [[s.piles[0]!.at(-1)!], [s.piles[1]!.at(-1)!]];
    const mixed = shuffled(under, nextRandom(s));
    const half = Math.ceil(mixed.length / 2);
    s.spares = [mixed.slice(0, half), mixed.slice(half)];
  }
  for (const p of [0, 1]) {
    const c = s.spares[p]!.pop() ?? s.spares[1 - p]!.pop();
    if (c) s.piles[p]!.push(c);
  }
  s.narration = `Both stuck: new cards in the middle (${s.piles.map((p) => label(p.at(-1)!)).join(", ")})`;
}

type Move = { type: "play"; card: string; pile?: number } | { type: "stuck" };

function apply(state: SpeedState, seat: number, move: Move): SpeedState {
  const s = clone(state);
  if (s.phase !== "playing") throw new GameError("The game is over.");
  if (seat !== 0 && seat !== 1) throw new GameError("Speed is for two.");
  if (move.type === "stuck") {
    if (playable(s, seat).length) throw new GameError("You've got a card that plays!");
    s.stuck[seat] = true;
    s.narration = `${who(seat)} is stuck`;
    if (s.stuck[0] && s.stuck[1]) flip(s);
    return s;
  }
  if (move.type !== "play") throw new GameError("That's not a move in Speed.");
  const card = s.hands[seat]!.find((c) => c.id === move.card);
  if (!card) throw new GameError("You don't have that card.");
  const to = speedTargets(s, card);
  if (!to.length) throw new GameError(`The ${label(card)} doesn't go on either pile: one higher or one lower.`);
  const pile = move.pile !== undefined && to.includes(Number(move.pile)) ? Number(move.pile) : to[0]!;
  s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
  s.piles[pile]!.push(card);
  // A new card in the middle: nobody's stuck any more.
  s.stuck = [false, false];
  s.idle = 0;
  fill(s, seat);
  s.narration = `${who(seat)} played the ${label(card)}`;
  if (!s.hands[seat]!.length && !s.draws[seat]!.length) {
    s.winner = seat;
    s.phase = "finished";
    s.narration = `${who(seat)} played the last card! ⚡`;
  }
  return s;
}

function view(s: SpeedState, seat: number): KitView {
  const over = s.phase === "finished";
  const legal = playable(s, seat);
  const canStuck = !over && !legal.length && !s.stuck[seat];
  return {
    game: "speed",
    seats: 2,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: !over && legal.length ? { type: "play", cards: legal.map((c) => c.id) } : null,
    pick: null,
    choices: canStuck ? { prompt: "Nothing plays?", options: [{ label: "I'm stuck", move: { type: "stuck" }, primary: true }] } : null,
    players: [0, 1].map((i) => ({ cards: s.hands[i]!.length, line: `${s.draws[i]!.length} to draw${s.stuck[i] ? " · stuck" : ""}`, badge: s.stuck[i] ? "Stuck" : undefined })),
    center: {
      kind: "cross",
      stock: s.spares[0]!.length + s.spares[1]!.length,
      piles: [0, 1].map((p) => ({ cards: s.piles[p]!.slice(-1), empty: "", move: null, label: `Middle pile ${p + 1}: ${label(s.piles[p]!.at(-1)!)}` })),
      layout: "row",
    },
    melds: [],
    info: [`One higher or one lower${s.rules.wrap ? " · aces next to kings and 2s" : ""}`, ...(s.stuck[1 - seat] && !s.stuck[seat] ? [`${who(1 - seat)} is stuck`] : [])],
    narration: s.narration,
    scores: [0, 1].map((i) => ({ seats: [i], value: s.hands[i]!.length + s.draws[i]!.length })),
    result: null,
    over: over ? { winners: s.winner === null ? [0, 1] : [s.winner], title: s.winner === null ? "A tie!" : `${who(s.winner)} wins!` } : null,
  };
}

function bot(s: SpeedState, seat: number, _style: PlayStyle): Move | null {
  if (s.phase !== "playing") return null;
  const legal = playable(s, seat);
  if (legal.length) return { type: "play", card: legal[0]!.id };
  return s.stuck[seat] ? null : { type: "stuck" };
}

const PACE: Record<SpeedRules["speed"], number> = { relaxed: 2400, quick: 1500, lightning: 950 };

export const speed: CardGame<SpeedRules, SpeedState, Move> = {
  id: "speed",
  name: "Speed",
  emoji: "⚡",
  blurb: "No turns: play faster than the other player",
  tagline: "No turns, no waiting: play one higher or one lower on the middle piles, faster than your opponent.",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: [classicSpeed, easySpeed, fastSpeed],
  fields: [
    { key: "speed", label: "Computer player", kind: "choice", options: [["relaxed", "Relaxed"], ["quick", "Quick"], ["lightning", "Lightning fast"]] },
    { key: "wrap", label: "Aces go next to kings and 2s", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SpeedRules>;
    const base = [classicSpeed, easySpeed, fastSpeed].find((p) => p.id === given.id) ?? classicSpeed;
    const r = { ...base, ...given };
    return { ...r, speed: (["relaxed", "quick", "lightning"] as const).includes(r.speed) ? r.speed : "quick" };
  },
  validate: () => [],
  describe(r) {
    return [
      "Two players. Each gets a draw pile of 20 and a hand of five; two cards start the middle piles, with a spare pile of five beside each.",
      `There are no turns: both play at once. Tap a card one higher or one lower than either middle card${r.wrap ? " (aces go next to kings and 2s)" : ""}, and your hand fills back up to five from your draw pile.`,
      "Nobody can play? Both tap \"I'm stuck\" and a spare card is flipped onto each middle pile. When the spares run out, the middle piles are shuffled into new ones.",
      "First to play every card in their hand and draw pile wins.",
    ];
  },
  newGame: newSpeed,
  apply,
  view,
  bot,
  thinkingTime: (s) => PACE[s.rules.speed],
  reactionTime(s, _seat, style) {
    if (s.phase !== "playing") return null;
    const sharp = style.skill ?? 1;
    return Math.round(PACE[s.rules.speed] * (0.7 + Math.random() * 0.6) * (1.25 - sharp * 0.25));
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "speed",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: [0, 1].map((i) => s.hands[i]!.length + s.draws[i]!.length).join(" · ") + " left",
      order: over ? rankSeats([0, 1].map((i) => ({ seats: [i], score: s.hands[i]!.length + s.draws[i]!.length })), true) : null,
      winners: over ? (s.winner === null ? [0, 1] : [s.winner]) : null,
      teams: false,
      seats: 2,
    };
  },
};
