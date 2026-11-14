// Klondike, the classic solitaire. Seven columns, the first card of each face up; build down in
// alternating colours, kings into empty columns; build each suit up from the ace on the four
// foundations; turn the stock one or three at a time. Tap a card and it goes to its best place.
import type { PlayStyle, Suit } from "@spades/rules";
import { clone, FULL, GameError, makeDeck, nextRandom, rankLabel, shuffled, SUITS, SYMBOL, type BaseRules, type CardGame, type KCard, type KitView, type PipCard } from "./kit.js";

export interface KlondikeRules extends BaseRules {
  /** Cards turned from the stock at a time. */
  draw: 1 | 3;
}

export const klondikeOne: KlondikeRules = { id: "klondike-one", name: "Klondike (draw one)", draw: 1 };
export const klondikeThree: KlondikeRules = { id: "klondike-three", name: "Draw three", draw: 3 };

type Phase = "playing" | "finished";

export interface Column {
  down: KCard[];
  up: KCard[];
}

export interface KlondikeState {
  game: "klondike";
  rules: KlondikeRules;
  seats: 1;
  rng: number;
  hand: number;
  dealer: 0;
  phase: Phase;
  stock: KCard[];
  /** Turned cards, the playable one last. */
  waste: KCard[];
  /** One pile per suit, in SUITS order, ace first. */
  foundations: KCard[][];
  columns: Column[];
  moves: number;
  passes: number;
  /** Draws since anything else happened: a computer player who has gone all the way round gives up. */
  idle: number;
  won: boolean;
  /** Earlier positions for Undo (the most recent last). */
  history: string[];
  narration: string | null;
}

const rankOf = (c: KCard) => ((c as PipCard).rank === 14 ? 1 : (c as PipCard).rank);
const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const red = (c: KCard) => suitOf(c) === "hearts" || suitOf(c) === "diamonds";
const name = (c: KCard) => `${rankLabel(rankOf(c) === 1 ? 14 : rankOf(c))}${SYMBOL[suitOf(c)]}`;
const UNDO_LIMIT = 100;

export function newKlondike(rules: KlondikeRules, _seats: number, seed: number): KlondikeState {
  const s = { game: "klondike", rules, seats: 1, rng: seed >>> 0, hand: 0, dealer: 0, phase: "playing", moves: 0, passes: 0, idle: 0, won: false, history: [], narration: null } as unknown as KlondikeState;
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  let at = 0;
  s.columns = Array.from({ length: 7 }, (_, i) => {
    const cards = deck.slice(at, at + i + 1);
    at += i + 1;
    return { down: cards.slice(0, -1), up: cards.slice(-1) };
  });
  s.stock = deck.slice(at);
  s.waste = [];
  s.foundations = SUITS.map(() => []);
  return s;
}

/** Can this card go on top of that one in a column? */
const fitsColumn = (card: KCard, col: Column) => {
  const top = col.up.at(-1);
  if (!top) return col.down.length === 0 && rankOf(card) === 13;
  return red(top) !== red(card) && rankOf(top) === rankOf(card) + 1;
};
const foundationOf = (s: KlondikeState, card: KCard) => s.foundations[SUITS.indexOf(suitOf(card))]!;
const fitsFoundation = (s: KlondikeState, card: KCard) => foundationOf(s, card).length === rankOf(card) - 1;

type Where = { from: "waste" } | { from: "column"; index: number; at: number } | { from: "foundation"; suit: number };

/** Where a card is, if it's one you can pick up: the waste's top card, a face-up card in a column, a foundation's top. */
function locate(s: KlondikeState, id: string): Where | null {
  if (s.waste.at(-1)?.id === id) return { from: "waste" };
  for (let i = 0; i < 7; i++) {
    const at = s.columns[i]!.up.findIndex((c) => c.id === id);
    if (at >= 0) return { from: "column", index: i, at };
  }
  for (let f = 0; f < 4; f++) if (s.foundations[f]!.at(-1)?.id === id) return { from: "foundation", suit: f };
  return null;
}

type Target = { to: "foundation" } | { to: "column"; index: number };

/** The best place for this card (and anything on it): a foundation, then a column with cards, then an empty one. */
function bestTarget(s: KlondikeState, card: KCard, where: Where): Target | null {
  const stack = where.from === "column" ? s.columns[where.index]!.up.length - where.at : 1;
  if (stack === 1 && where.from !== "foundation" && fitsFoundation(s, card)) return { to: "foundation" };
  const others = [0, 1, 2, 3, 4, 5, 6].filter((i) => !(where.from === "column" && where.index === i));
  const onCards = others.find((i) => s.columns[i]!.up.length > 0 && fitsColumn(card, s.columns[i]!));
  if (onCards !== undefined) return { to: "column", index: onCards };
  // A king moves to an empty column only if that achieves something (it isn't already at the bottom of one).
  const alreadyBottom = where.from === "column" && where.at === 0 && s.columns[where.index]!.down.length === 0;
  const empty = others.find((i) => !s.columns[i]!.up.length && !s.columns[i]!.down.length);
  if (rankOf(card) === 13 && empty !== undefined && !alreadyBottom) return { to: "column", index: empty };
  return null;
}

/** A position for Undo, compactly: card ids only (a few hundred bytes), with the counters. */
function snapshot(s: KlondikeState): string {
  const ids = (cards: KCard[]) => cards.map((c) => c.id).join(",");
  return JSON.stringify({ st: ids(s.stock), w: ids(s.waste), f: s.foundations.map(ids), c: s.columns.map((c) => [ids(c.down), ids(c.up)]), m: s.moves, p: s.passes, i: s.idle });
}

function restore(s: KlondikeState, snap: string): KlondikeState {
  // Every card is somewhere in the game: look them up there.
  const deck = new Map([...s.stock, ...s.waste, ...s.foundations.flat(), ...s.columns.flatMap((c) => [...c.down, ...c.up])].map((c) => [c.id, c]));
  const cards = (list: string) => (list ? list.split(",").map((id) => deck.get(id)!) : []);
  const x = JSON.parse(snap) as { st: string; w: string; f: string[]; c: [string, string][]; m: number; p: number; i: number };
  return { ...s, stock: cards(x.st), waste: cards(x.w), foundations: x.f.map(cards), columns: x.c.map(([d, u]) => ({ down: cards(d), up: cards(u) })), moves: x.m, passes: x.p, idle: x.i };
}

function move(s: KlondikeState, where: Where, target: Target) {
  let cards: KCard[];
  if (where.from === "waste") cards = [s.waste.pop()!];
  else if (where.from === "foundation") cards = [s.foundations[where.suit]!.pop()!];
  else {
    const col = s.columns[where.index]!;
    cards = col.up.splice(where.at);
    // Turn the next card up.
    if (!col.up.length && col.down.length) col.up.push(col.down.pop()!);
  }
  if (target.to === "foundation") foundationOf(s, cards[0]!).push(cards[0]!);
  else s.columns[target.index]!.up.push(...cards);
  s.moves += 1;
  s.idle = 0;
  if (s.foundations.every((f) => f.length === 13)) {
    s.won = true;
    s.phase = "finished";
    s.narration = `Solved in ${s.moves} moves! 🎉`;
  }
}

/** Everything is face up and the stock is used up: the rest can go home on its own. */
const canFinish = (s: KlondikeState) => !s.stock.length && !s.waste.length && s.columns.every((c) => !c.down.length);

type Move = { type: "auto"; card: string } | { type: "draw" } | { type: "undo" } | { type: "finish" } | { type: "resign" };

function apply(state: KlondikeState, seat: number, mv: Move): KlondikeState {
  if (seat !== 0) throw new GameError("This is a game for one.");
  if (state.phase !== "playing") throw new GameError("The game is over.");
  if (mv.type === "undo") {
    if (!state.history.length) throw new GameError("Nothing to undo.");
    const back = restore(clone(state), state.history.at(-1)!);
    back.history = state.history.slice(0, -1);
    back.narration = "Undone";
    return back;
  }
  const s = clone(state);
  s.history = [...state.history.slice(-(UNDO_LIMIT - 1)), snapshot(state)];
  s.narration = null;
  switch (mv.type) {
    case "draw": {
      if (s.stock.length) {
        const n = Math.min(s.rules.draw, s.stock.length);
        for (let i = 0; i < n; i++) s.waste.push(s.stock.pop()!);
      } else if (s.waste.length) {
        s.stock = [...s.waste].reverse();
        s.waste = [];
        s.passes += 1;
      } else throw new GameError("The stock is empty.");
      s.idle += 1;
      return s;
    }
    case "auto": {
      const where = locate(s, mv.card);
      if (!where) throw new GameError("You can't move that card now.");
      const card = where.from === "waste" ? s.waste.at(-1)! : where.from === "foundation" ? s.foundations[where.suit]!.at(-1)! : s.columns[where.index]!.up[where.at]!;
      const target = bestTarget(s, card, where);
      if (!target) throw new GameError(`The ${name(card)} has nowhere to go.`);
      move(s, where, target);
      return s;
    }
    case "finish": {
      if (!canFinish(s)) throw new GameError("Not everything is face up yet.");
      for (let guard = 0; guard < 60 && !s.won; guard++) {
        const col = s.columns.findIndex((c) => c.up.length && fitsFoundation(s, c.up.at(-1)!));
        if (col < 0) break;
        move(s, { from: "column", index: col, at: s.columns[col]!.up.length - 1 }, { to: "foundation" });
      }
      return s;
    }
    case "resign": {
      s.phase = "finished";
      s.narration = `Out of moves after ${s.moves}. ${s.foundations.reduce((n, f) => n + f.length, 0)} cards made it home.`;
      return s;
    }
    default:
      throw new GameError("That's not a move in Klondike.");
  }
}

function view(s: KlondikeState, seat: number): KitView {
  const over = s.phase === "finished";
  const home = s.foundations.reduce((n, f) => n + f.length, 0);
  const tappable = over ? [] : [...(s.waste.length ? [s.waste.at(-1)!.id] : []), ...s.columns.flatMap((c) => c.up.map((x) => x.id))];
  return {
    game: "klondike",
    seats: 1,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : 0,
    dealer: 0,
    hand: [],
    handHidden: true,
    tap: null,
    pick: null,
    choices: over
      ? null
      : {
          prompt: "",
          options: [
            ...(canFinish(s) ? [{ label: "Finish", move: { type: "finish" }, primary: true }] : []),
            ...(s.history.length ? [{ label: "Undo", move: { type: "undo" } }] : []),
            { label: "Give up", move: { type: "resign" } },
          ],
          layout: "row",
        },
    players: [{ cards: 0, line: `${s.moves} move${s.moves === 1 ? "" : "s"}` }],
    center: {
      kind: "solitaire",
      stock: s.stock.length,
      waste: s.waste.slice(-s.rules.draw),
      foundations: s.foundations.map((f) => f.at(-1) ?? null),
      columns: s.columns.map((c) => ({ down: c.down.length, up: c.up })),
      cells: null,
      tap: over ? null : { type: "auto", cards: tappable },
      drawMove: over || (!s.stock.length && !s.waste.length) ? null : { type: "draw" },
      stockLabel: s.stock.length ? `${s.stock.length} left` : s.waste.length ? "Turn over" : "",
    },
    melds: [],
    info: [s.rules.draw === 3 ? "Draw three" : "Draw one", `${home} of 52 home`],
    narration: s.narration,
    scores: [{ seats: [0], value: home }],
    result: null,
    over: over ? { winners: s.won ? [0] : [], title: s.won ? `Solved in ${s.moves} moves!` : `${home} cards home: not this time` } : null,
  };
}

// ---- A computer player (it plays the tests' games; at the table it's just you) -----------------

function bot(s: KlondikeState, seat: number, _style: PlayStyle): Move | null {
  if (s.phase !== "playing" || seat !== 0) return null;
  if (canFinish(s)) return { type: "finish" };
  // Anything that can go home.
  const top = s.waste.at(-1);
  if (top && fitsFoundation(s, top)) return { type: "auto", card: top.id };
  for (const c of s.columns) if (c.up.length && fitsFoundation(s, c.up.at(-1)!)) return { type: "auto", card: c.up.at(-1)!.id };
  // Moves that turn a card over (the bottom face-up card of a column with cards under it).
  for (let i = 0; i < 7; i++) {
    const c = s.columns[i]!;
    if (c.up.length && c.down.length && bestTarget(s, c.up[0]!, { from: "column", index: i, at: 0 })) return { type: "auto", card: c.up[0]!.id };
  }
  // The waste card onto a column.
  if (top && bestTarget(s, top, { from: "waste" })) return { type: "auto", card: top.id };
  // Turn the stock; after going all the way round with nothing to do, give up.
  if (s.idle > s.stock.length + s.waste.length + 2 || (!s.stock.length && !s.waste.length)) return { type: "resign" };
  return { type: "draw" };
}

export const klondike: CardGame<KlondikeRules, KlondikeState, Move> = {
  id: "klondike",
  name: "Klondike Solitaire",
  emoji: "♦️",
  blurb: "The classic solitaire, just for you",
  tagline: "The classic solitaire: build down in alternating colours and get every suit home, ace to king.",
  seats: { min: 1, max: 1, default: 1 },
  teams: false,
  presets: [klondikeOne, klondikeThree],
  fields: [{ key: "draw", label: "Turn from the stock", kind: "choice", options: [[1, "One card"], [3, "Three cards"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<KlondikeRules>;
    const base = [klondikeOne, klondikeThree].find((p) => p.id === given.id) ?? klondikeOne;
    const merged = { ...base, ...given };
    return { ...merged, draw: Number(merged.draw) === 3 ? 3 : 1 };
  },
  validate: () => [],
  describe(r) {
    return [
      "Seven columns, one to seven cards, the top card of each face up. The rest is the stock.",
      "Build the columns down in alternating colours (a red 6 on a black 7). Move a run of face-up cards together. Only a king goes in an empty column.",
      "Build each suit up on its foundation, ace to king. Win by getting all 52 home.",
      `Turn the stock ${r.draw === 3 ? "three cards at a time (only the top one plays)" : "one card at a time"}, and turn the pile over to go round again as often as you like.`,
      "Tap a card and it goes to its best place. Undo takes back a move; Finish sends everything home once it's all face up.",
    ];
  },
  newGame: newKlondike,
  apply,
  view,
  bot,
  thinkingTime: () => 120,
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "klondike",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: `${s.foundations.reduce((n, f) => n + f.length, 0)} of 52 home in ${s.moves} moves`,
      order: over ? [0] : null,
      winners: over ? (s.won ? [0] : []) : null,
      teams: false,
      seats: 1,
    };
  },
};
