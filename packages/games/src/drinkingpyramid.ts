// Drinking Pyramid: everyone gets four cards to memorize, then they go face down. Fifteen cards make a
// face-down pyramid, turned over from the bottom row up. When a card is turned, anyone can claim to
// hold the same rank and hand out drinks: 1 on the bottom row, up to 5 at the top. But claims can be
// bluffs: whoever's given the drinks can call it. Caught bluffing, drink double; called wrongly, the
// caller drinks double. Fewest drinks at the end wins.
import type { PlayStyle } from "@spades/rules";
import { botGiveTarget, drink, DRINK_NOTE, newTally, type Tally } from "./drinks.js";
import { clone, FULL, GameError, makeDeck, markReady, nextRandom, rankLabel, rankSeats, shuffled, SYMBOL, who, type BaseRules, type CardGame, type Choice, type KCard, type KitView } from "./kit.js";

export interface DPyramidRules extends BaseRules {
  /** Bluffing allowed (and calling bluffs). */
  bluffs: boolean;
}

export const classicDPyramid: DPyramidRules = { id: "dpyramid-classic", name: "Pyramid (with bluffing)", bluffs: true };
export const honestDPyramid: DPyramidRules = { id: "dpyramid-honest", name: "No bluffing", bluffs: false };

export interface DPyramidState {
  game: "drinkingpyramid";
  rules: DPyramidRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: "memorize" | "flip" | "claims" | "give" | "respond" | "finished";
  hands: KCard[][];
  /** 15 cards: 5 on the bottom row (worth 1) up to 1 on top (worth 5). */
  cards: KCard[];
  flipped: number;
  ready: boolean[];
  claims: boolean[];
  /** Claims waiting to be handed out, in seat order. */
  queue: number[];
  /** The drinks handed out and waiting on an answer. */
  pending: { from: number; to: number; n: number } | null;
  /** When each player last saw their cards (for the computer players' memories). */
  tally: Tally;
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const label = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[(c as { suit: keyof typeof SYMBOL }).suit]}`;
/** Row worth of the k-th card turned: 5 on the bottom row (1 each), then 4 (2), 3 (3), 2 (4), 1 (5). */
export const ROW_WORTH = [1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 4, 4, 5];

export function newDPyramid(rules: DPyramidRules, seats: number, seed: number): DPyramidState {
  const s = { game: "drinkingpyramid", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, phase: "memorize", flipped: 0, queue: [], pending: null, narration: "Memorize your four cards!" } as unknown as DPyramidState;
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hands = Array.from({ length: seats }, (_, i) => deck.slice(i * 4, i * 4 + 4));
  s.cards = deck.slice(seats * 4, seats * 4 + 15);
  s.ready = Array(seats).fill(false);
  s.claims = Array(seats).fill(false);
  s.tally = newTally(seats);
  return s;
}

const top = (s: DPyramidState) => s.cards[s.flipped - 1]!;
const worth = (s: DPyramidState) => ROW_WORTH[s.flipped - 1]!;
const holds = (s: DPyramidState, seat: number) => s.hands[seat]!.some((c) => rank(c) === rank(top(s)));

function nextClaim(s: DPyramidState) {
  s.pending = null;
  if (s.queue.length) {
    s.phase = "give";
    return;
  }
  if (s.flipped === 15) {
    s.phase = "finished";
    s.narration = (s.narration ? s.narration + " · " : "") + "That's the pyramid!";
    return;
  }
  s.phase = "flip";
}

type Move = { type: "ready" } | { type: "flip" } | { type: "claim"; yes: boolean } | { type: "give"; to: number } | { type: "drink" } | { type: "call" };

function apply(state: DPyramidState, seat: number, move: Move): DPyramidState {
  const s = clone(state);
  switch (move.type) {
    case "ready": {
      if (s.phase !== "memorize") throw new GameError("Not now.");
      if (markReady(s.ready, seat)) {
        s.phase = "flip";
        s.narration = "Cards face down. No peeking!";
      }
      return s;
    }
    case "flip": {
      if (s.phase !== "flip" || seat !== s.dealer) throw new GameError("The dealer turns the cards.");
      s.flipped += 1;
      s.claims = Array(s.seats).fill(false);
      s.ready = Array(s.seats).fill(false);
      s.phase = "claims";
      s.narration = `Row ${worth(s)}: the ${label(top(s))}. Got one? It's worth ${worth(s)}`;
      return s;
    }
    case "claim": {
      if (s.phase !== "claims" || s.ready[seat]) throw new GameError("Not now.");
      const yes = !!move.yes;
      if (yes && !s.rules.bluffs && !holds(s, seat)) throw new GameError(`You don't have a ${rankLabel(rank(top(s)))}. (No bluffing at this table.)`);
      s.claims[seat] = yes;
      if (markReady(s.ready, seat)) {
        s.queue = s.claims.flatMap((c, i) => (c ? [i] : []));
        s.narration = s.queue.length ? `${s.queue.map(who).join(" and ")} say${s.queue.length === 1 ? "s" : ""} they have a ${rankLabel(rank(top(s)))}` : "Nobody has one";
        nextClaim(s);
      }
      return s;
    }
    case "give": {
      if (s.phase !== "give" || s.queue[0] !== seat) throw new GameError("It's not your turn to hand out drinks.");
      const to = Number(move.to);
      if (!(to >= 0 && to < s.seats) || to === seat) throw new GameError("Pick someone else.");
      s.queue.shift();
      s.pending = { from: seat, to, n: worth(s) };
      s.narration = `${who(seat)} gives ${worth(s)} to ${who(to)}`;
      if (!s.rules.bluffs) {
        s.narration += ` · ${drink(s.tally, [to], worth(s))}`;
        nextClaim(s);
      } else s.phase = "respond";
      return s;
    }
    case "drink":
    case "call": {
      if (s.phase !== "respond" || s.pending?.to !== seat) throw new GameError("Not now.");
      const { from, to, n } = s.pending;
      if (move.type === "drink") s.narration = `${who(to)} takes it · ${drink(s.tally, [to], n)}`;
      else if (holds(s, from)) s.narration = `${who(to)} called bluff, but ${who(from)} has it! · ${drink(s.tally, [to], n * 2)}`;
      else s.narration = `${who(to)} called bluff, and ${who(from)} was bluffing! · ${drink(s.tally, [from], n * 2)}`;
      nextClaim(s);
      return s;
    }
    default:
      throw new GameError("That's not a move in the Pyramid.");
  }
}

function view(s: DPyramidState, seat: number): KitView {
  const over = s.phase === "finished";
  let choices: KitView["choices"] = null;
  if (s.phase === "memorize" && !s.ready[seat]) choices = { prompt: "Remember them: they'll go face down.", options: [{ label: "Got them", move: { type: "ready" }, primary: true }] };
  else if (s.phase === "flip" && seat === s.dealer) choices = { prompt: "", options: [{ label: "Turn the next card", move: { type: "flip" }, primary: true }] };
  else if (s.phase === "claims" && !s.ready[seat]) choices = { prompt: `Do you have a ${rankLabel(rank(top(s)))}?`, options: [{ label: `I have one (give ${worth(s)})`, move: { type: "claim", yes: true } }, { label: "No", move: { type: "claim", yes: false } }], layout: "row" };
  else if (s.phase === "give" && s.queue[0] === seat) {
    const options: Choice[] = Array.from({ length: s.seats }, (_, i) => i).filter((i) => i !== seat).map((i) => ({ label: who(i), move: { type: "give", to: i } }));
    choices = { prompt: `Give ${worth(s)} to…`, options, layout: "list" };
  } else if (s.phase === "respond" && s.pending?.to === seat) choices = { prompt: `${who(s.pending.from)} gives you ${s.pending.n}. Believe them?`, options: [{ label: "Drink", move: { type: "drink" } }, { label: "Call bluff!", move: { type: "call" }, primary: true }], layout: "row" };
  const rows = [[14], [12, 13], [9, 10, 11], [5, 6, 7, 8], [0, 1, 2, 3, 4]].map((row) => row.map((k) => (k < s.flipped ? s.cards[k]! : ("back" as const))));
  const seeOwn = s.phase === "memorize" || over;
  const turn = s.phase === "flip" ? s.dealer : s.phase === "give" ? s.queue[0]! : s.phase === "respond" ? s.pending!.to : null;
  return {
    game: "drinkingpyramid",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : turn,
    dealer: s.dealer,
    hand: seeOwn ? s.hands[seat]! : [],
    handHidden: seeOwn ? undefined : true,
    tap: null,
    pick: null,
    choices,
    players: s.hands.map((h, i) => ({ cards: h.length, line: `🍺 ${s.tally.drank[i]}${s.phase === "claims" ? (s.ready[i] ? " · decided" : " · thinking") : ""}`, dealer: i === s.dealer })),
    center: { kind: "pyramid", rows, tap: null, held: null, stock: 0, waste: null, drawMove: null, stockLabel: "", noStock: true },
    melds: over ? s.hands.flatMap((h, i) => (i !== seat ? [{ owner: i, label: "", cards: h }] : [])) : [],
    info: [s.flipped ? `Card ${s.flipped} of 15 · worth ${worth(s)}` : "15 cards: the bottom row is worth 1, the top 5", ...(s.rules.bluffs ? ["Bluffing allowed"] : []), DRINK_NOTE],
    narration: s.narration,
    scores: s.tally.drank.map((value, i) => ({ seats: [i], value })),
    result: null,
    over: over ? { winners: winners(s), title: `${winners(s).map(who).join(" and ")} drank the least!` } : null,
  };
}

function winners(s: DPyramidState): number[] {
  const least = Math.min(...s.tally.drank);
  return s.tally.drank.flatMap((d, i) => (d === least ? [i] : []));
}

function bot(s: DPyramidState, seat: number, style: PlayStyle): Move | null {
  switch (s.phase) {
    case "memorize":
      return s.ready[seat] ? null : { type: "ready" };
    case "flip":
      return seat === s.dealer ? { type: "flip" } : null;
    case "claims": {
      if (s.ready[seat]) return null;
      // Remembers their cards well enough (careful players better); bluffs now and then.
      const remembers = Math.random() < 0.7 + (style.skill ?? 1) * 0.25;
      const has = holds(s, seat);
      if (has) return { type: "claim", yes: remembers };
      return { type: "claim", yes: s.rules.bluffs && Math.random() < 0.08 + (style.bold ?? 0.3) * 0.15 };
    }
    case "give":
      return s.queue[0] === seat ? { type: "give", to: botGiveTarget(s.tally, seat, s.seats) } : null;
    case "respond": {
      if (s.pending?.to !== seat) return null;
      // Call it more often when several people claimed the same rank, or the stakes are high.
      return Math.random() < 0.2 + worth(s) * 0.05 ? { type: "call" } : { type: "drink" };
    }
    default:
      return null;
  }
}

export const drinkingPyramid: CardGame<DPyramidRules, DPyramidState, Move> = {
  id: "drinkingpyramid",
  name: "Drinking Pyramid",
  emoji: "🍻",
  blurb: "Drinking game: remember your cards, match the pyramid, bluff",
  tagline: "A drinking game. Memorize four cards, then claim matches as the pyramid turns, and hand out drinks. Bluff if you dare.",
  seats: { min: 2, max: 8, default: 4 },
  teams: false,
  presets: [classicDPyramid, honestDPyramid],
  fields: [{ key: "bluffs", label: "Bluffing", hint: "Claim a card you don't have; get called on it and drink double.", kind: "toggle" }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<DPyramidRules>;
    const base = [classicDPyramid, honestDPyramid].find((p) => p.id === given.id) ?? classicDPyramid;
    return { ...base, ...given, bluffs: given.bluffs ?? base.bluffs };
  },
  validate: () => [],
  describe: (r) => [
    `${DRINK_NOTE} Adults only.`,
    "Everyone gets four cards: memorize them, then they go face down.",
    "Fifteen cards make a face-down pyramid, turned one at a time from the bottom row up. The bottom row is worth 1, the top card 5.",
    "When a card is turned, anyone who has the same rank says so and hands out that many drinks.",
    r.bluffs ? "You can bluff. Whoever gets the drinks can drink, or call bluff: if you were bluffing, you drink double; if you weren't, they do." : "No bluffing: you can only claim a card you really hold.",
    "Fewest drinks at the end wins.",
  ],
  newGame: newDPyramid,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "claims" ? 1600 : s.phase === "respond" ? 1500 : 1200),
  summary(s) {
    const over = s.phase === "finished";
    return { game: "drinkingpyramid", rules: s.rules.name, phase: s.phase, over, hand: 1, scoreLine: s.tally.drank.join(" · ") + " drinks", order: over ? rankSeats(s.tally.drank.map((score, i) => ({ seats: [i], score })), true) : null, winners: over ? winners(s) : null, teams: false, seats: s.seats };
  },
};
