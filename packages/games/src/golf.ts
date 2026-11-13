// Six-card Golf for 2 to 6: two rows of three face down in front of you; flip two to start. On your
// turn draw from the stock or take the top discard, then swap it into your grid (the old card is
// discarded face up), or throw a stock card away and flip one of yours. A matching pair in a column
// scores nothing. When someone has all six face up, everyone else gets one more turn. Nine holes,
// and the lowest total wins.
import type { PlayStyle } from "@spades/rules";
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
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type PipCard,
} from "./kit.js";

export interface GolfRules extends BaseRules {
  holes: number;
  /** Twos count −2 (otherwise 2). */
  twosMinus: boolean;
  /** Kings count 0 (otherwise 10). */
  kingsZero: boolean;
}

export const classicGolf: GolfRules = { id: "golf-classic", name: "Six-card Golf (9 holes)", holes: 9, twosMinus: true, kingsZero: true };
export const quickGolf: GolfRules = { ...classicGolf, id: "golf-quick", name: "Quick round (5 holes)", holes: 5 };
export const plainGolf: GolfRules = { ...classicGolf, id: "golf-plain", name: "Plain values (no minus twos)", twosMinus: false, kingsZero: false };

type Phase = "flipping" | "draw" | "place" | "flip" | "scored" | "finished";

export interface GolfState {
  game: "golf";
  rules: GolfRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  /** Each player's six cards, row by row (0 1 2 over 3 4 5), and which are face up. */
  grids: KCard[][];
  up: boolean[][];
  stock: KCard[];
  pile: KCard[];
  /** The card the player on turn has drawn, and where from. */
  held: { card: KCard; from: "stock" | "pile" } | null;
  turn: number;
  /** Who turned their last card up first, ending the hole; the others get one more turn. */
  closer: number | null;
  /** Seats that have had their last turn after the closer. */
  finalTurns: number[];
  scores: number[];
  lastHand: { holeScores: number[]; closer: number | null } | null;
  ready: boolean[];
  narration: string | null;
}

const rankOf = (c: KCard) => (c as PipCard).rank;
export function golfValue(c: KCard, r: GolfRules): number {
  const k = rankOf(c);
  if (k === 14) return 1;
  if (k === 2) return r.twosMinus ? -2 : 2;
  if (k === 13) return r.kingsZero ? 0 : 10;
  if (k >= 11) return 10;
  return k;
}
const cardName = (c: KCard) => `${rankLabel(rankOf(c))}${SYMBOL[(c as PipCard).suit]}`;

/** A grid's score with every card counted: a matching pair in a column scores nothing. */
export function gridScore(cards: KCard[], r: GolfRules): number {
  let total = 0;
  for (let col = 0; col < 3; col++) {
    const a = cards[col]!,
      b = cards[col + 3]!;
    total += rankOf(a) === rankOf(b) ? 0 : golfValue(a, r) + golfValue(b, r);
  }
  return total;
}

/** What the face-up cards show: a pair face up scores nothing; face-down cards count as nothing yet. */
function shownScore(s: GolfState, seat: number): number {
  const g = s.grids[seat]!,
    up = s.up[seat]!;
  let total = 0;
  for (let col = 0; col < 3; col++) {
    const [a, b] = [col, col + 3];
    if (up[a] && up[b] && rankOf(g[a]!) === rankOf(g[b]!)) continue;
    if (up[a]) total += golfValue(g[a]!, s.rules);
    if (up[b]) total += golfValue(g[b]!, s.rules);
  }
  return total;
}

function deal(s: GolfState) {
  const deck = shuffled(makeDeck({ ranks: FULL, copies: s.seats >= 5 ? 2 : 1 }), nextRandom(s));
  s.grids = Array.from({ length: s.seats }, (_, i) => deck.slice(i * 6, i * 6 + 6));
  s.up = Array.from({ length: s.seats }, () => [false, false, false, false, false, false]);
  s.stock = deck.slice(s.seats * 6);
  s.pile = [s.stock.pop()!];
  s.held = null;
  s.closer = null;
  s.finalTurns = [];
  s.ready = Array.from({ length: s.seats }, () => false);
  s.turn = (s.dealer + 1) % s.seats;
  s.phase = "flipping";
  s.narration = "Everyone flips two of their cards to start.";
}

export function newGolf(rules: GolfRules, seats: number, seed: number): GolfState {
  const s = { game: "golf", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, lastHand: null } as unknown as GolfState;
  s.scores = Array.from({ length: seats }, () => 0);
  deal(s);
  return s;
}

const faceDown = (s: GolfState, seat: number) => s.up[seat]!.map((u, i) => (u ? -1 : i)).filter((i) => i >= 0);

function drawFromStock(s: GolfState): KCard {
  if (!s.stock.length) {
    // Shuffle the discards (all but the top) back in.
    const top = s.pile.pop()!;
    s.stock = shuffled(s.pile, nextRandom(s));
    s.pile = [top];
  }
  return s.stock.pop()!;
}

/** The turn is done: on to the next player, or the end of the hole. */
function endTurn(s: GolfState, seat: number) {
  s.held = null;
  if (s.closer === null && faceDown(s, seat).length === 0) {
    s.closer = seat;
    s.narration = `${s.narration ?? ""} ${who(seat)} is out: everyone else gets one more turn.`.trim();
  } else if (s.closer !== null) s.finalTurns.push(seat);
  const next = (seat + 1) % s.seats;
  if (s.closer !== null && (next === s.closer || s.finalTurns.length >= s.seats - 1)) {
    scoreHole(s);
    return;
  }
  s.turn = next;
  s.phase = "draw";
}

function scoreHole(s: GolfState) {
  s.up = s.up.map((u) => u.map(() => true));
  const holeScores = s.grids.map((g) => gridScore(g, s.rules));
  // The player who went out: if they don't have the lowest score, their hole doubles (a common
  // house rule is kinder: off by default, so it's just the scores).
  s.scores = s.scores.map((n, i) => n + holeScores[i]!);
  s.lastHand = { holeScores, closer: s.closer };
  s.ready = Array.from({ length: s.seats }, () => false);
  s.phase = s.hand + 1 >= s.rules.holes ? "finished" : "scored";
  const best = Math.min(...holeScores);
  const low = holeScores.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
  s.narration = low.length === 1 ? `${who(low[0]!)} had the low hole with ${best}` : `A tie for the low hole at ${best}`;
}

type Move = { type: "flip"; index: number } | { type: "draw" } | { type: "take" } | { type: "swap"; index: number } | { type: "discard" } | { type: "next" };

function apply(state: GolfState, seat: number, move: Move): GolfState {
  const s = clone(state);
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The hole isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = (s.dealer + 1) % s.seats;
      deal(s);
    }
    return s;
  }
  const index = Number((move as { index?: number }).index);
  if (s.phase === "flipping") {
    if (move.type !== "flip") throw new GameError("Flip two of your cards to start.");
    if (s.up[seat]!.filter(Boolean).length >= 2) throw new GameError("Waiting for the others to flip theirs.");
    if (!(index >= 0 && index < 6) || s.up[seat]![index]) throw new GameError("Pick one of your face-down cards.");
    s.up[seat]![index] = true;
    if (s.up.every((u) => u.filter(Boolean).length >= 2)) {
      s.phase = "draw";
      s.narration = `${who(s.turn)} tees off`;
    }
    return s;
  }
  if (s.turn !== seat || !["draw", "place", "flip"].includes(s.phase)) throw new GameError("It's not your turn.");
  switch (move.type) {
    case "draw":
    case "take": {
      if (s.phase !== "draw") throw new GameError("You've already drawn.");
      if (move.type === "take") {
        if (!s.pile.length) throw new GameError("The discard pile is empty.");
        s.held = { card: s.pile.pop()!, from: "pile" };
      } else s.held = { card: drawFromStock(s), from: "stock" };
      s.phase = "place";
      s.narration = null;
      return s;
    }
    case "swap": {
      if (s.phase !== "place" || !s.held) throw new GameError("Draw a card first.");
      if (!(index >= 0 && index < 6)) throw new GameError("Pick one of your six cards.");
      const old = s.grids[seat]![index]!;
      s.grids[seat]![index] = s.held.card;
      const wasUp = s.up[seat]![index];
      s.up[seat]![index] = true;
      s.pile.push(old);
      s.narration = `${who(seat)} put the ${cardName(s.held.card)} in and threw away ${wasUp ? "the" : "a face-down"} ${cardName(old)}`;
      endTurn(s, seat);
      return s;
    }
    case "discard": {
      if (s.phase !== "place" || !s.held) throw new GameError("Draw a card first.");
      if (s.held.from === "pile") throw new GameError("A card from the discard pile has to go in your grid.");
      s.pile.push(s.held.card);
      s.narration = `${who(seat)} threw away the ${cardName(s.held.card)}`;
      s.held = null;
      if (!faceDown(s, seat).length) {
        endTurn(s, seat);
        return s;
      }
      s.phase = "flip";
      return s;
    }
    case "flip": {
      if (s.phase !== "flip") throw new GameError("You can only flip after throwing away a card from the stock.");
      if (!(index >= 0 && index < 6) || s.up[seat]![index]) throw new GameError("Pick one of your face-down cards.");
      s.up[seat]![index] = true;
      s.narration = `${s.narration ?? ""} and flipped the ${cardName(s.grids[seat]![index]!)}`;
      endTurn(s, seat);
      return s;
    }
    default:
      throw new GameError("That's not a move in Golf.");
  }
}

function winners(s: GolfState): number[] {
  const best = Math.min(...s.scores);
  return s.scores.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
}

function view(s: GolfState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.turn === seat;
  const flipping = s.phase === "flipping" && s.up[seat]!.filter(Boolean).length < 2;
  let gridTap: KitView["gridTap"] = null;
  if (flipping) gridTap = { type: "flip", cells: faceDown(s, seat), prompt: `Flip ${2 - s.up[seat]!.filter(Boolean).length} of your cards` };
  else if (mine && s.phase === "place") gridTap = { type: "swap", cells: [0, 1, 2, 3, 4, 5], prompt: s.held!.from === "stock" ? "Tap a card to swap, or throw this one away" : "Tap the card to swap it with" };
  else if (mine && s.phase === "flip") gridTap = { type: "flip", cells: faceDown(s, seat), prompt: "Flip one of your face-down cards" };
  const final = s.closer !== null && !over && s.phase !== "scored";
  const w = over ? winners(s) : [];
  return {
    game: "golf",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: ["draw", "place", "flip"].includes(s.phase) ? s.turn : null,
    dealer: s.dealer,
    hand: [],
    handHidden: true,
    tap: null,
    pick: null,
    choices: mine && s.phase === "place" && s.held?.from === "stock" ? { prompt: "", options: [{ label: "Throw it away", move: { type: "discard" } }] } : s.phase === "scored" ? nextHandChoices(s.ready, seat, s.hand + 1 >= s.rules.holes) : null,
    players: s.grids.map((g, i) => ({ cards: 0, line: s.phase === "scored" || over ? `Hole: ${s.lastHand?.holeScores[i] ?? 0}` : `Showing ${shownScore(s, i)}`, badge: i === s.closer && !over ? "Out" : undefined })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.pile.slice(-3),
      discardCount: s.pile.length,
      drawMove: mine && s.phase === "draw" ? { type: "draw" } : null,
      takeMove: mine && s.phase === "draw" && s.pile.length ? { type: "take" } : null,
      held: s.held && (mine || s.held.from === "pile") ? s.held.card : null,
      heldLabel: s.held ? (mine ? "You drew" : `${who(s.turn)} drew`) : undefined,
    },
    melds: [],
    grids: s.grids.map((g, i) => ({ owner: i, cols: 3, cards: g.map((c, k) => (s.up[i]![k] ? c : null)) })),
    gridTap,
    info: [`Hole ${s.hand + 1} of ${s.rules.holes}`, ...(final ? ["Last turns!"] : []), "Low score wins"],
    narration: s.narration,
    scores: s.scores.map((n, i) => ({ seats: [i], value: n })),
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `golf-${s.hand}`,
            title: `Hole ${s.hand + 1}`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "This hole", values: s.lastHand.holeScores.map(String), tone: "score" as const },
              { label: "Total", values: s.scores.map(String), tone: "total" as const },
            ],
          }
        : null,
    over: over ? { winners: w, title: w.length === 1 ? `${who(w[0]!)} wins with ${s.scores[w[0]!]}` : `A tie at ${s.scores[w[0]!]}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** How much better the grid gets with this card at this spot (face-down cards guessed at 5). */
function gain(s: GolfState, seat: number, card: KCard, at: number): number {
  const g = s.grids[seat]!,
    up = s.up[seat]!,
    r = s.rules;
  const guess = (i: number) => (up[i] ? golfValue(g[i]!, r) : 5);
  const other = at < 3 ? at + 3 : at - 3;
  const pairNow = up[at] && up[other] && rankOf(g[at]!) === rankOf(g[other]!);
  const before = pairNow ? 0 : guess(at) + guess(other);
  const pairs = up[other] && rankOf(g[other]!) === rankOf(card);
  const after = pairs ? 0 : golfValue(card, r) + guess(other);
  return before - after;
}

function bot(s: GolfState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  const down = faceDown(s, seat);
  if (s.phase === "flipping") return s.up[seat]!.filter(Boolean).length < 2 ? { type: "flip", index: down[Math.floor(Math.random() * down.length)]! } : null;
  if (s.turn !== seat) return null;
  const best = (card: KCard) => [0, 1, 2, 3, 4, 5].map((i) => ({ i, g: gain(s, seat, card, i) })).sort((a, b) => b.g - a.g)[0]!;
  if (s.phase === "draw") {
    const top = s.pile.at(-1);
    return top && !sloppy && best(top).g >= 3 ? { type: "take" } : { type: "draw" };
  }
  if (s.phase === "place") {
    const held = s.held!.card;
    const b = best(held);
    if (s.held!.from === "pile" || (b.g >= 1 && !sloppy) || (sloppy && Math.random() < 0.5)) {
      return { type: "swap", index: sloppy ? Math.floor(Math.random() * 6) : b.i };
    }
    return { type: "discard" };
  }
  if (s.phase === "flip") {
    // Flip in a column whose other card is already up (so a pair could come), else anywhere.
    const pick = down.find((i) => s.up[seat]![i < 3 ? i + 3 : i - 3]) ?? down[0]!;
    return { type: "flip", index: sloppy ? down[Math.floor(Math.random() * down.length)]! : pick };
  }
  return null;
}

export const golf: CardGame<GolfRules, GolfState, Move> = {
  id: "golf",
  name: "Golf",
  emoji: "⛳",
  blurb: "Swap your way to the lowest score",
  tagline: "Six cards in front of you, most of them face down: swap your way to the lowest score over nine holes.",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [classicGolf, quickGolf, plainGolf],
  fields: [
    { key: "holes", label: "Holes", kind: "choice", options: [[5, "5"], [9, "9"], [18, "18"]] },
    { key: "twosMinus", label: "Twos are −2", kind: "toggle" },
    { key: "kingsZero", label: "Kings are 0", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<GolfRules>;
    const base = [classicGolf, quickGolf, plainGolf].find((p) => p.id === given.id) ?? classicGolf;
    const merged = { ...base, ...given };
    return { ...merged, holes: Math.max(1, Math.min(18, Math.round(Number(merged.holes) || 9))) };
  },
  validate: (r) => (r.holes >= 1 && r.holes <= 18 ? [] : ["Between 1 and 18 holes."]),
  describe(r) {
    return [
      "Six cards each, face down in two rows of three. Everyone flips two to start.",
      "On your turn, draw from the stock or take the top discard. Swap it for any of your six cards (the old one is discarded face up). A card from the stock can be thrown away instead, and then you flip one of your face-down cards.",
      `Aces are 1, ${r.twosMinus ? "twos −2" : "twos 2"}, three to ten face value, jacks and queens 10, ${r.kingsZero ? "kings 0" : "kings 10"}. A matching pair in a column scores nothing.`,
      `When someone has all six face up, everyone else gets one more turn, then every card is turned over and counted. ${r.holes} holes; the lowest total wins.`,
    ];
  },
  newGame: newGolf,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "scored" ? 1400 : s.phase === "flipping" ? 700 : thinkFor(4)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "golf",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats(s.scores.map((n, i) => ({ seats: [i], score: n })), true) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
