// Kings in the Corner: seven cards each, four cards face up beside the stock, the four corners empty.
// Start your turn by drawing a card. Then play as many cards as you like: on any pile, a card one
// lower in the other colour (a red 6 on a black 7). Kings only go in the corners. You can move a whole
// pile onto another when its bottom card fits, and fill an empty side space with any card. First one
// out wins.
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
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type Choice,
  type KCard,
  type KitView,
} from "./kit.js";

export interface KingsRules extends BaseRules {
  /** One hand, or points: cards left count against you (kings 10, the rest 1), lowest when someone reaches the limit wins. */
  scoring: "single" | "points";
  limit: number;
}

export const classicKings: KingsRules = { id: "kings-classic", name: "Kings in the Corner", scoring: "single", limit: 25 };
export const pointsKings: KingsRules = { ...classicKings, id: "kings-points", name: "Points (to 15)", scoring: "points", limit: 15 };

/** Piles 0–3 are the sides (any card may start one), 4–7 the corners (kings only). */
export interface KingsState {
  game: "kingscorner";
  rules: KingsRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  hands: KCard[][];
  stock: KCard[];
  piles: KCard[][];
  turn: number;
  phase: "playing" | "scored" | "finished";
  /** A card picked up that fits more than one pile: where does it go? */
  held: string | null;
  /** A pile picked up that fits more than one place. */
  heldPile: number | null;
  /** Turns in a row with nothing played and nothing to draw. */
  idle: number;
  played: boolean;
  scores: number[];
  lastHand: { winner: number; left: number[] } | null;
  ready: boolean[];
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const suitOf = (c: KCard) => (c as { suit: Suit }).suit;
/** Aces are low here: A 1 … K 13. */
const low = (c: KCard) => (rank(c) === 14 ? 1 : rank(c));
const red = (c: KCard) => suitOf(c) === "hearts" || suitOf(c) === "diamonds";
const name = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[suitOf(c)]}`;
const penalty = (c: KCard) => (low(c) === 13 ? 10 : 1);
const SIDE = [0, 1, 2, 3];
const CORNER = [4, 5, 6, 7];

/** Can this card (or a pile starting with it) go on that pile's top card? */
function fits(s: KingsState, card: KCard, pile: number): boolean {
  const top = s.piles[pile]![s.piles[pile]!.length - 1];
  return !!top && low(card) === low(top) - 1 && red(card) !== red(top);
}

/** Where a card from the hand can go. Kings go to one corner (the first empty one). */
export function cardTargets(s: KingsState, card: KCard): number[] {
  if (low(card) === 13) {
    // Four kings, four corners: there's always room.
    const corner = CORNER.find((i) => !s.piles[i]!.length);
    return corner === undefined ? [] : [corner];
  }
  const out = [...SIDE, ...CORNER].filter((i) => fits(s, card, i));
  // One empty side space is enough to offer.
  const empty = SIDE.find((i) => !s.piles[i]!.length);
  if (empty !== undefined) out.push(empty);
  return out;
}

/** Where a whole side pile can move: its bottom card onto another pile's top (or a king pile into a corner). */
export function pileTargets(s: KingsState, from: number): number[] {
  if (!SIDE.includes(from)) return [];
  const bottom = s.piles[from]![0];
  if (!bottom) return [];
  if (low(bottom) === 13) {
    const corner = CORNER.find((i) => !s.piles[i]!.length);
    return corner === undefined ? [] : [corner];
  }
  return [...SIDE, ...CORNER].filter((i) => i !== from && fits(s, bottom, i));
}

function where(s: KingsState, pile: number): string {
  const top = s.piles[pile]![s.piles[pile]!.length - 1];
  if (top) return `on the ${name(top)}`;
  return CORNER.includes(pile) ? "in a corner" : "in the empty space";
}

function draw(s: KingsState, seat: number) {
  const c = s.stock.pop();
  if (c) s.hands[seat] = sortCards([...s.hands[seat]!, c]);
  return c;
}

function deal(s: KingsState) {
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  let k = 0;
  s.hands = Array.from({ length: s.seats }, () => sortCards(deck.slice(k, (k += 7))));
  let rest = deck.slice(k);
  s.piles = Array.from({ length: 8 }, () => []);
  // The four side cards; a king goes straight to a corner and another card takes its place.
  for (const i of SIDE) {
    let c = rest.shift()!;
    while (low(c) === 13) {
      s.piles[CORNER.find((j) => !s.piles[j]!.length)!]!.push(c);
      c = rest.shift()!;
    }
    s.piles[i]!.push(c);
  }
  s.stock = rest;
  s.turn = (s.dealer + 1) % s.seats;
  s.held = null;
  s.heldPile = null;
  s.idle = 0;
  s.played = false;
  s.ready = Array(s.seats).fill(false);
  s.phase = "playing";
  s.narration = null;
  draw(s, s.turn);
}

export function newKings(rules: KingsRules, seats: number, seed: number): KingsState {
  const s = { game: "kingscorner", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, scores: Array(seats).fill(0), lastHand: null } as unknown as KingsState;
  deal(s);
  return s;
}

function place(s: KingsState, seat: number, card: KCard, pile: number) {
  s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
  s.piles[pile]!.push(card);
  s.held = null;
  s.heldPile = null;
  s.played = true;
  s.narration = `${who(seat)} played the ${name(card)}`;
  if (!s.hands[seat]!.length) scoreHand(s, seat);
}

function movePile(s: KingsState, seat: number, from: number, to: number) {
  const moved = s.piles[from]!;
  s.narration = `${who(seat)} moved the ${name(moved[0]!)} pile ${where(s, to)}`;
  s.piles[to]!.push(...moved);
  s.piles[from] = [];
  s.held = null;
  s.heldPile = null;
  s.played = true;
}

function scoreHand(s: KingsState, winner: number) {
  const left = s.hands.map((h) => h.reduce((n, c) => n + penalty(c), 0));
  s.lastHand = { winner, left };
  if (s.rules.scoring === "points") left.forEach((n, i) => (s.scores[i]! += n));
  else s.scores[winner]! += 1;
  s.narration = winner >= 0 ? `${who(winner)} went out! 🎉` : "Nobody can play: the fewest points left wins";
  s.ready = Array(s.seats).fill(false);
  const done = s.rules.scoring === "single" || s.scores.some((n) => n >= s.rules.limit);
  s.phase = done ? "finished" : "scored";
}

function anyMove(s: KingsState, seat: number) {
  return s.hands[seat]!.some((c) => cardTargets(s, c).length) || SIDE.some((i) => pileTargets(s, i).length);
}

type Move = { type: "play"; card: string } | { type: "pile"; card: string } | { type: "to"; pile: number } | { type: "cancel" } | { type: "end" } | { type: "next" };

function apply(state: KingsState, seat: number, move: Move): KingsState {
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
  if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
  switch (move.type) {
    case "play": {
      const card = s.hands[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      const to = cardTargets(s, card);
      if (!to.length) throw new GameError(`The ${name(card)} needs a ${rankLabel(low(card) + 1)} of the other colour.`);
      if (to.length === 1) place(s, seat, card, to[0]!);
      else {
        s.held = card.id;
        s.heldPile = null;
      }
      return s;
    }
    case "pile": {
      const from = s.piles.findIndex((p, i) => SIDE.includes(i) && p[0]?.id === move.card);
      if (from < 0) throw new GameError("Pick a pile by its bottom card.");
      const to = pileTargets(s, from);
      if (!to.length) throw new GameError("That pile doesn't fit anywhere.");
      if (to.length === 1) movePile(s, seat, from, to[0]!);
      else {
        s.heldPile = from;
        s.held = null;
      }
      return s;
    }
    case "to": {
      const pile = Number(move.pile);
      if (s.held) {
        const card = s.hands[seat]!.find((c) => c.id === s.held)!;
        if (!cardTargets(s, card).includes(pile)) throw new GameError("It doesn't go there.");
        place(s, seat, card, pile);
        return s;
      }
      if (s.heldPile !== null) {
        if (!pileTargets(s, s.heldPile).includes(pile)) throw new GameError("It doesn't go there.");
        movePile(s, seat, s.heldPile, pile);
        return s;
      }
      throw new GameError("Pick a card first.");
    }
    case "cancel": {
      s.held = null;
      s.heldPile = null;
      return s;
    }
    case "end": {
      s.held = null;
      s.heldPile = null;
      // Nothing played and nothing left to draw: after a full round of that, the game is blocked.
      s.idle = !s.played && !s.stock.length ? s.idle + 1 : 0;
      if (s.idle >= s.seats) {
        const left = s.hands.map((h) => h.reduce((n, c) => n + penalty(c), 0));
        scoreHand(s, left.indexOf(Math.min(...left)));
        s.narration = `Nobody can play: ${who(s.lastHand!.winner)} has the fewest points left and wins the hand`;
        return s;
      }
      s.narration = s.played ? null : `${who(seat)} passed`;
      s.played = false;
      s.turn = (s.turn + 1) % s.seats;
      draw(s, s.turn);
      return s;
    }
    default:
      throw new GameError("That's not a move in Kings in the Corner.");
  }
}

function view(s: KingsState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.phase === "playing" && s.turn === seat;
  const hand = s.hands[seat]!;
  let choices: KitView["choices"] = null;
  const held = mine && (s.held !== null || s.heldPile !== null);
  const targets = !held ? [] : s.held ? cardTargets(s, hand.find((c) => c.id === s.held)!) : pileTargets(s, s.heldPile!);
  const label = (pile: number) => where(s, pile).replace(/^./, (x) => x.toUpperCase());
  if (held) {
    const what = s.held ? `the ${name(hand.find((c) => c.id === s.held)!)}` : `the ${name(s.piles[s.heldPile!]![0]!)} pile`;
    const options: Choice[] = targets.map((p) => ({ label: label(p), move: { type: "to", pile: p } }));
    options.push({ label: "Cancel", move: { type: "cancel" } });
    choices = { prompt: `Where does ${what} go?`, options, layout: "list" };
  } else if (mine) {
    choices = { prompt: "", options: [{ label: "End my turn", move: { type: "end" }, primary: !anyMove(s, seat) }] };
  } else if (s.phase === "scored" && !s.ready[seat]) choices = { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] };
  const playable = mine && !s.held && s.heldPile === null ? hand.filter((c) => cardTargets(s, c).length).map((c) => c.id) : [];
  return {
    game: "kingscorner",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" ? s.turn : null,
    dealer: s.dealer,
    hand,
    tap: mine && playable.length ? { type: "play", cards: playable } : null,
    pick: null,
    choices,
    players: s.hands.map((h, i) => ({ cards: h.length, line: h.length === 1 ? "One card left!" : "", dealer: i === s.dealer })),
    center: {
      kind: "cross",
      stock: s.stock.length,
      piles: s.piles.map((p, i) => ({
        cards: p,
        empty: CORNER.includes(i) ? "K" : "",
        move: !mine ? null : held ? (targets.includes(i) ? { type: "to", pile: i } : null) : SIDE.includes(i) && pileTargets(s, i).length ? { type: "pile", card: p[0]!.id } : null,
        label: p.length ? `A pile from the ${name(p[0]!)} down to the ${name(p[p.length - 1]!)}` : CORNER.includes(i) ? "An empty corner" : "An empty space",
      })),
    },
    melds: [],
    info: ["Build down, red on black · kings in the corners", ...(mine && !held && SIDE.some((i) => pileTargets(s, i).length) ? ["Tap a glowing pile to move it all"] : []), ...(s.rules.scoring === "points" ? [`Lowest wins when someone reaches ${s.rules.limit}`] : [])],
    narration: held ? "Tap where it goes" : s.narration ?? (mine ? "Play what you can, then end your turn" : null),
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `kings-${s.hand}`,
            title: `${who(s.lastHand.winner)} went out!`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "Points left", values: s.lastHand.left.map(String) },
              ...(s.rules.scoring === "points" ? [{ label: "Total", values: s.scores.map(String), tone: "total" as const }] : []),
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: `${who(winners(s)[0]!)} wins!` } : null,
  };
}

function winners(s: KingsState): number[] {
  if (s.rules.scoring === "single") return s.lastHand ? [s.lastHand.winner] : [];
  const best = Math.min(...s.scores);
  return s.scores.flatMap((n, i) => (n === best ? [i] : []));
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: KingsState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const hand = s.hands[seat]!;
  if (s.held) {
    const card = hand.find((c) => c.id === s.held)!;
    const to = cardTargets(s, card);
    // Prefer building on a pile to using up an empty space.
    return { type: "to", pile: to.find((p) => s.piles[p]!.length) ?? to[0]! };
  }
  if (s.heldPile !== null) return { type: "to", pile: pileTargets(s, s.heldPile)[0]! };
  // Careless players sometimes stop early.
  if (Math.random() < (style.sloppy ?? 0) * 0.3) return { type: "end" };
  // Kings first (they open corners), then moving piles to free spaces, then cards onto piles, then
  // the highest card that only fits an empty space.
  const king = hand.find((c) => low(c) === 13 && cardTargets(s, c).some((p) => CORNER.includes(p)));
  if (king) return { type: "play", card: king.id };
  const pile = SIDE.find((i) => pileTargets(s, i).length);
  if (pile !== undefined) return { type: "pile", card: s.piles[pile]![0]!.id };
  const onPile = [...hand].sort((a, b) => low(b) - low(a)).find((c) => cardTargets(s, c).some((p) => s.piles[p]!.length));
  if (onPile) return { type: "play", card: onPile.id };
  const any = [...hand].sort((a, b) => low(b) - low(a)).find((c) => cardTargets(s, c).length);
  if (any) return { type: "play", card: any.id };
  return { type: "end" };
}

export const kingsCorner: CardGame<KingsRules, KingsState, Move> = {
  id: "kingscorner",
  name: "Kings in the Corner",
  emoji: "👑",
  blurb: "Solitaire for the whole table",
  tagline: "Build down in alternating colours, kings in the corners. First one out wins.",
  seats: { min: 2, max: 4, default: 4 },
  teams: false,
  presets: [classicKings, pointsKings],
  fields: [
    { key: "scoring", label: "Scoring", kind: "choice", options: [["single", "One hand: first out wins"], ["points", "Points: cards left count against you"]] },
    { key: "limit", label: "Points game ends at", kind: "choice", options: [[10, "10"], [15, "15"], [25, "25"], [50, "50"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<KingsRules>;
    const base = [classicKings, pointsKings].find((p) => p.id === given.id) ?? classicKings;
    const r = { ...base, ...given };
    return { ...r, limit: Number(r.limit) };
  },
  validate(r) {
    const errors: string[] = [];
    if (!["single", "points"].includes(r.scoring)) errors.push("Pick a way to score.");
    if (!(r.limit >= 10 && r.limit <= 500)) errors.push("End the points game between 10 and 500.");
    return errors;
  },
  describe(r) {
    return [
      "Seven cards each. Four cards go face up beside the stock; the four corners start empty.",
      "Start your turn by drawing a card. Then play as many as you like: on any pile, a card one lower in the other colour (a red 6 on a black 7). Aces are low.",
      "Kings only go in the corners. Move a whole pile onto another when its bottom card fits, and start an empty space with any card.",
      "End your turn when you're done.",
      r.scoring === "single" ? "First one out wins." : `Cards left count against you: kings 10, the rest 1. When someone reaches ${r.limit}, the lowest total wins.`,
    ];
  },
  newGame: newKings,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "scored") return 900;
    if (s.held || s.heldPile !== null) return 600;
    return thinkFor(s.hands[seat]?.length ?? 1, 0.7);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "kingscorner",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.rules.scoring === "points" ? s.scores.join(" · ") : s.hands.map((h) => h.length).join(" · ") + " cards",
      order: over ? (s.rules.scoring === "points" ? rankSeats(s.scores.map((score, i) => ({ seats: [i], score })), true) : rankSeats(s.lastHand!.left.map((score, i) => ({ seats: [i], score: i === s.lastHand!.winner ? -1 : score })), true)) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
