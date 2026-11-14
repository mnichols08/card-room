// Spider solitaire: two decks, ten columns. Build down in any suit, but only a run of one suit moves
// together. A full run of one suit from king down to ace goes home on its own. Stuck? Deal a new card
// onto every column (there are five deals). Get all eight runs home to win. One suit is gentle; four
// is hard.
import type { PlayStyle, Suit } from "@spades/rules";
import { clone, FULL, GameError, nextRandom, rankLabel, shuffled, SYMBOL, type BaseRules, type CardGame, type KCard, type KitView, type PipCard } from "./kit.js";

export interface SpiderRules extends BaseRules {
  suits: 1 | 2 | 4;
}

export const spiderOne: SpiderRules = { id: "spider-1", name: "One suit (gentle)", suits: 1 };
export const spiderTwo: SpiderRules = { id: "spider-2", name: "Two suits", suits: 2 };
export const spiderFour: SpiderRules = { id: "spider-4", name: "Four suits (hard)", suits: 4 };

export interface SpiderColumn {
  down: KCard[];
  up: KCard[];
}

export interface SpiderState {
  game: "spider";
  rules: SpiderRules;
  seats: 1;
  rng: number;
  hand: number;
  dealer: 0;
  phase: "playing" | "finished";
  stock: KCard[];
  columns: SpiderColumn[];
  /** Runs sent home, by their suit. */
  home: Suit[];
  moves: number;
  won: boolean;
  history: string[];
  /** Moves since a card was turned up or a run went home: a stuck computer player gives up. */
  idle: number;
  narration: string | null;
}

const rankOf = (c: KCard) => ((c as PipCard).rank === 14 ? 1 : (c as PipCard).rank);
const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const name = (c: KCard) => `${rankLabel(rankOf(c) === 1 ? 14 : rankOf(c))}${SYMBOL[suitOf(c)]}`;
const UNDO_LIMIT = 100;

export function newSpider(rules: SpiderRules, _seats: number, seed: number): SpiderState {
  const s = { game: "spider", rules, seats: 1, rng: seed >>> 0, hand: 0, dealer: 0, phase: "playing", home: [], moves: 0, won: false, history: [], idle: 0, narration: null } as unknown as SpiderState;
  // 104 cards: eight full runs, in one, two or four suits.
  const suits: Suit[] = rules.suits === 1 ? ["spades"] : rules.suits === 2 ? ["spades", "hearts"] : ["spades", "hearts", "diamonds", "clubs"];
  const cards: KCard[] = [];
  for (let k = 0; k < 8; k++) {
    const suit = suits[k % suits.length]!;
    for (const r of FULL) cards.push({ kind: "pip", suit, rank: r, id: `${rankLabel(r)}${SYMBOL[suit]}·${k + 1}` } as KCard);
  }
  const deck = shuffled(cards, nextRandom(s));
  let at = 0;
  s.columns = Array.from({ length: 10 }, (_, i) => {
    const n = i < 4 ? 6 : 5;
    const col = deck.slice(at, at + n);
    at += n;
    return { down: col.slice(0, -1), up: col.slice(-1) };
  });
  s.stock = deck.slice(at);
  return s;
}

/** Is this stretch a run of one suit going down by one? */
const sameSuitRun = (cards: KCard[]) => cards.every((c, i) => i === 0 || (suitOf(c) === suitOf(cards[i - 1]!) && rankOf(c) === rankOf(cards[i - 1]!) - 1));

/** The best column for a run starting with this card: same suit one higher, any suit one higher, then an empty column. */
function bestColumn(s: SpiderState, card: KCard, from: number, at: number): number | null {
  const others = s.columns.map((_, i) => i).filter((i) => i !== from);
  const fit = (i: number) => s.columns[i]!.up.length && rankOf(s.columns[i]!.up.at(-1)!) === rankOf(card) + 1;
  const same = others.find((i) => fit(i) && suitOf(s.columns[i]!.up.at(-1)!) === suitOf(card));
  if (same !== undefined) return same;
  const any = others.find(fit);
  if (any !== undefined) return any;
  // An empty column, unless the run already fills its own column.
  const whole = at === 0 && !s.columns[from]!.down.length;
  const empty = others.find((i) => !s.columns[i]!.up.length && !s.columns[i]!.down.length);
  return empty !== undefined && !whole ? empty : null;
}

function locate(s: SpiderState, id: string): { col: number; at: number } | null {
  for (let i = 0; i < 10; i++) {
    const at = s.columns[i]!.up.findIndex((c) => c.id === id);
    if (at >= 0) return { col: i, at };
  }
  return null;
}

/** Turn up a bare column's next card, and send home any full king-to-ace run. */
function tidy(s: SpiderState, i: number) {
  const col = s.columns[i]!;
  if (col.up.length >= 13) {
    const last = col.up.slice(-13);
    if (rankOf(last[0]!) === 13 && sameSuitRun(last)) {
      col.up.splice(-13);
      s.home.push(suitOf(last[0]!));
      s.idle = 0;
      s.narration = `A full run of ${SYMBOL[suitOf(last[0]!)]} goes home!`;
    }
  }
  if (!col.up.length && col.down.length) {
    col.up.push(col.down.pop()!);
    s.idle = 0;
  }
  if (s.home.length === 8) {
    s.won = true;
    s.phase = "finished";
    s.narration = `Solved in ${s.moves} moves! 🕷️`;
  }
}

function snapshot(s: SpiderState): string {
  const ids = (cards: KCard[]) => cards.map((c) => c.id).join(",");
  return JSON.stringify({ st: ids(s.stock), c: s.columns.map((c) => [ids(c.down), ids(c.up)]), h: s.home, m: s.moves, i: s.idle });
}
function restore(s: SpiderState, snap: string, all: Map<string, KCard>): SpiderState {
  const cards = (list: string) => (list ? list.split(",").map((id) => all.get(id)!) : []);
  const x = JSON.parse(snap) as { st: string; c: [string, string][]; h: Suit[]; m: number; i: number };
  return { ...s, stock: cards(x.st), columns: x.c.map(([d, u]) => ({ down: cards(d), up: cards(u) })), home: x.h, moves: x.m, idle: x.i };
}
/** Every card that has ever been in this game: the ones in play, plus the runs home (rebuilt from their suits). */
function allCards(s: SpiderState): Map<string, KCard> {
  const map = new Map<string, KCard>();
  for (const c of [...s.stock, ...s.columns.flatMap((c) => [...c.down, ...c.up])]) map.set(c.id, c);
  for (let k = 1; k <= 8; k++) for (const suit of ["spades", "hearts", "diamonds", "clubs"] as Suit[]) for (const r of FULL) {
    const id = `${rankLabel(r)}${SYMBOL[suit]}·${k}`;
    if (!map.has(id)) map.set(id, { kind: "pip", suit, rank: r, id } as KCard);
  }
  return map;
}

type Move = { type: "auto"; card: string } | { type: "deal" } | { type: "undo" } | { type: "resign" };

function apply(state: SpiderState, seat: number, mv: Move): SpiderState {
  if (seat !== 0) throw new GameError("This is a game for one.");
  if (state.phase !== "playing") throw new GameError("The game is over.");
  if (mv.type === "undo") {
    if (!state.history.length) throw new GameError("Nothing to undo.");
    const back = restore(clone(state), state.history.at(-1)!, allCards(state));
    back.history = state.history.slice(0, -1);
    back.narration = "Undone";
    return back;
  }
  const s = clone(state);
  s.history = [...state.history.slice(-(UNDO_LIMIT - 1)), snapshot(state)];
  s.narration = null;
  switch (mv.type) {
    case "deal": {
      if (!s.stock.length) throw new GameError("No deals left.");
      if (s.columns.some((c) => !c.up.length && !c.down.length)) throw new GameError("Fill every empty column before dealing.");
      for (let i = 0; i < 10; i++) s.columns[i]!.up.push(s.stock.pop()!);
      for (let i = 0; i < 10; i++) tidy(s, i);
      s.idle = 0;
      return s;
    }
    case "auto": {
      const where = locate(s, mv.card);
      if (!where) throw new GameError("You can't move that card.");
      const col = s.columns[where.col]!;
      const run = col.up.slice(where.at);
      if (!sameSuitRun(run)) throw new GameError("Only a run of one suit moves together.");
      const to = bestColumn(s, run[0]!, where.col, where.at);
      if (to === null) throw new GameError(`The ${name(run[0]!)} has nowhere to go.`);
      col.up.splice(where.at);
      s.columns[to]!.up.push(...run);
      s.moves += 1;
      s.idle += 1;
      tidy(s, where.col);
      tidy(s, to);
      return s;
    }
    case "resign": {
      s.phase = "finished";
      s.narration = `Out of moves after ${s.moves}. ${s.home.length} of 8 runs made it home.`;
      return s;
    }
    default:
      throw new GameError("That's not a move in Spider.");
  }
}

function view(s: SpiderState, seat: number): KitView {
  const over = s.phase === "finished";
  const movable = over ? [] : s.columns.flatMap((c) => c.up.filter((_, k) => sameSuitRun(c.up.slice(k))).map((x) => x.id));
  const deals = s.stock.length / 10;
  return {
    game: "spider",
    seats: 1,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : 0,
    dealer: 0,
    hand: [],
    handHidden: "none",
    tap: null,
    pick: null,
    choices: over ? null : { prompt: "", options: [...(s.history.length ? [{ label: "Undo", move: { type: "undo" } }] : []), { label: "Give up", move: { type: "resign" } }], layout: "row" },
    players: [{ cards: 0, line: `${s.moves} move${s.moves === 1 ? "" : "s"}` }],
    center: {
      kind: "solitaire",
      stock: s.stock.length,
      waste: [],
      foundations: Array.from({ length: 8 }, (_, k) => (s.home[k] ? ({ kind: "pip", suit: s.home[k]!, rank: 13, id: `home-${k}` } as KCard) : null)),
      foundationLabels: Array(8).fill("K"),
      columns: s.columns.map((c) => ({ down: c.down.length, up: c.up })),
      cells: null,
      tap: over ? null : { type: "auto", cards: movable },
      drawMove: over || !s.stock.length ? null : { type: "deal" },
      stockLabel: deals ? `${deals} deal${deals === 1 ? "" : "s"} left` : "",
    },
    melds: [],
    info: [`${s.rules.suits === 1 ? "One suit" : s.rules.suits === 2 ? "Two suits" : "Four suits"}`, `${s.home.length} of 8 runs home`, "Tap a card to move it (and what's on it)"],
    narration: s.narration,
    scores: [{ seats: [0], value: s.home.length }],
    result: null,
    over: over ? { winners: s.won ? [0] : [], title: s.won ? `Solved in ${s.moves} moves!` : `${s.home.length} of 8 runs home: not this time` } : null,
  };
}

// ---- A computer player (it plays the tests' games) ---------------------------------------------

function bot(s: SpiderState, seat: number, _style: PlayStyle): Move | null {
  if (s.phase !== "playing" || seat !== 0) return null;
  if (s.idle > 80) return { type: "resign" };
  // Every movable run, scored: turning a card up is best, then building in suit, then freeing a column.
  let best: { card: string; score: number } | null = null;
  for (let i = 0; i < 10; i++) {
    const c = s.columns[i]!;
    for (let k = c.up.length - 1; k >= 0; k--) {
      if (!sameSuitRun(c.up.slice(k))) break;
      const card = c.up[k]!;
      const to = bestColumn(s, card, i, k);
      if (to === null) continue;
      const dest = s.columns[to]!.up.at(-1);
      const parent = k > 0 ? c.up[k - 1]! : null;
      const sitsWell = parent && rankOf(parent) === rankOf(card) + 1;
      const sameDest = dest && suitOf(dest) === suitOf(card);
      // Pointless: off a card it already fits, onto one that's no better.
      if (sitsWell && !(sameDest && suitOf(parent!) !== suitOf(card))) continue;
      let score = 0;
      if (k === 0 && c.down.length) score += 10;
      if (k === 0 && !c.down.length && dest) score += 6;
      if (sameDest) score += 5;
      if (!dest) {
        // Into an empty column: only if what's underneath can then go somewhere useful.
        let p = k - 1;
        while (p > 0 && sameSuitRun(c.up.slice(p - 1, k))) p--;
        const under = p >= 0 ? c.up[p] : undefined;
        const then = under ? bestColumn(s, under, i, p) : null;
        score += then !== null && then !== to && s.columns[then]!.up.length ? 4 : -3;
      }
      if (dest && !sameDest) score += 1;
      score += (c.up.length - k) * 0.1;
      if (score > 0 && (!best || score > best.score)) best = { card: card.id, score };
    }
  }
  if (best) return { type: "auto", card: best.card };
  if (s.stock.length && s.columns.every((c) => c.up.length || c.down.length)) return { type: "deal" };
  // An empty column blocks the deal: put something there.
  for (let i = 0; i < 10; i++) {
    const c = s.columns[i]!;
    if (c.up.length + c.down.length > 1) {
      const card = c.up.at(-1)!;
      if (bestColumn(s, card, i, c.up.length - 1) !== null) return { type: "auto", card: card.id };
    }
  }
  return { type: "resign" };
}

export const spider: CardGame<SpiderRules, SpiderState, Move> = {
  id: "spider",
  name: "Spider",
  emoji: "🕷️",
  blurb: "Two-deck solitaire: build runs from king to ace",
  tagline: "Ten columns, two decks. Build runs of one suit from king down to ace and they go home.",
  seats: { min: 1, max: 1, default: 1 },
  teams: false,
  presets: [spiderOne, spiderTwo, spiderFour],
  fields: [{ key: "suits", label: "Suits", kind: "choice", options: [[1, "One (gentle)"], [2, "Two"], [4, "Four (hard)"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SpiderRules>;
    const base = [spiderOne, spiderTwo, spiderFour].find((p) => p.id === given.id) ?? spiderOne;
    const r = { ...base, ...given };
    const n = Number(r.suits);
    return { ...r, suits: n === 2 ? 2 : n === 4 ? 4 : 1 };
  },
  validate: () => [],
  describe(r) {
    return [
      `Two decks' worth of cards in ${r.suits === 1 ? "one suit" : r.suits === 2 ? "two suits" : "four suits"}, dealt into ten columns with the last card of each face up; the rest are the stock.`,
      "Build down by one in any suit (a 6 on any 7). But only a run of one suit moves together; tap a card to move it and everything on it.",
      "Any card or run can go into an empty column. A full run of one suit from king down to ace goes home on its own.",
      "Stuck? Deal from the stock: one card onto every column (every column needs a card first). Five deals in all.",
      "Get all eight runs home to win.",
    ];
  },
  newGame: newSpider,
  apply,
  view,
  bot,
  thinkingTime: () => 400,
  summary(s) {
    const over = s.phase === "finished";
    return { game: "spider", rules: s.rules.name, phase: s.phase, over, hand: 1, scoreLine: `${s.home.length} of 8 home`, order: over ? [0] : null, winners: over ? (s.won ? [0] : []) : null, teams: false, seats: 1 };
  },
};
