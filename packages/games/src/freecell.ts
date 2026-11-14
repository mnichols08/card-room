// FreeCell: every card dealt face up into eight columns, four free cells to park single cards in,
// and four foundations to build each suit up from the ace. Build columns down in alternating
// colours; a run moves together if there's room (free cells and empty columns) to have moved it a
// card at a time. Nearly every deal can be won. Deals are numbered, so the family can try the same one.
import type { PlayStyle, Suit } from "@spades/rules";
import { clone, FULL, GameError, makeDeck, nextRandom, rankLabel, shuffled, SUITS, SYMBOL, type BaseRules, type CardGame, type KCard, type KitView, type PipCard } from "./kit.js";

export interface FreeCellRules extends BaseRules {
  /** A deal number to play (the same number always deals the same game); 0 deals a new one. */
  deal: number;
}

export const freeCellNew: FreeCellRules = { id: "freecell", name: "FreeCell", deal: 0 };

type Phase = "playing" | "finished";

export interface FreeCellState {
  game: "freecell";
  rules: FreeCellRules;
  seats: 1;
  rng: number;
  hand: number;
  dealer: 0;
  phase: Phase;
  /** The deal's number: play it again with the same number. */
  dealNumber: number;
  cells: (KCard | null)[];
  foundations: KCard[][];
  columns: KCard[][];
  moves: number;
  /** Moves since a card last went home: a computer player that's going nowhere gives up. */
  idle: number;
  won: boolean;
  history: string[];
  narration: string | null;
}

const rankOf = (c: KCard) => ((c as PipCard).rank === 14 ? 1 : (c as PipCard).rank);
const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const red = (c: KCard) => suitOf(c) === "hearts" || suitOf(c) === "diamonds";
const name = (c: KCard) => `${rankLabel(rankOf(c) === 1 ? 14 : rankOf(c))}${SYMBOL[suitOf(c)]}`;
const UNDO_LIMIT = 100;
export const MAX_DEAL = 1_000_000;

export function newFreeCell(rules: FreeCellRules, _seats: number, seed: number): FreeCellState {
  const dealNumber = rules.deal > 0 ? Math.min(MAX_DEAL, Math.round(rules.deal)) : (seed % MAX_DEAL) + 1;
  const s = { game: "freecell", rules, seats: 1, rng: dealNumber, hand: 0, dealer: 0, phase: "playing", dealNumber, moves: 0, idle: 0, won: false, history: [], narration: `Deal #${dealNumber}` } as unknown as FreeCellState;
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.columns = Array.from({ length: 8 }, () => []);
  deck.forEach((c, i) => s.columns[i % 8]!.push(c));
  s.cells = [null, null, null, null];
  s.foundations = SUITS.map(() => []);
  return s;
}

const foundationOf = (s: FreeCellState, card: KCard) => s.foundations[SUITS.indexOf(suitOf(card))]!;
const fitsFoundation = (s: FreeCellState, card: KCard) => foundationOf(s, card).length === rankOf(card) - 1;
const fitsOn = (card: KCard, top: KCard | undefined) => !top || (red(top) !== red(card) && rankOf(top) === rankOf(card) + 1);
/** Is cards[at..] a run (each card one lower and the other colour)? */
const isRun = (cards: KCard[], at: number) => cards.slice(at).every((c, i, run) => i === 0 || fitsOn(c, run[i - 1]));
/** How many cards can move at once, counting the free cells and empty columns (not the one moved into). */
export function maxRun(s: FreeCellState, toEmpty: boolean): number {
  const free = s.cells.filter((c) => !c).length;
  const empty = s.columns.filter((c) => !c.length).length - (toEmpty ? 1 : 0);
  return (free + 1) * 2 ** Math.max(0, empty);
}

type Where = { from: "column"; index: number; at: number } | { from: "cell"; index: number };
type Target = { to: "foundation" } | { to: "column"; index: number } | { to: "cell"; index: number };

function locate(s: FreeCellState, id: string): Where | null {
  const cell = s.cells.findIndex((c) => c?.id === id);
  if (cell >= 0) return { from: "cell", index: cell };
  for (let i = 0; i < 8; i++) {
    const at = s.columns[i]!.findIndex((c) => c.id === id);
    if (at >= 0) return { from: "column", index: i, at };
  }
  return null;
}

/** The best place for this card (and anything on it): home, onto a column, an empty column, a free cell. */
function bestTarget(s: FreeCellState, where: Where): Target | null {
  const cards = where.from === "cell" ? [s.cells[where.index]!] : s.columns[where.index]!.slice(where.at);
  const first = cards[0]!;
  if (cards.length === 1 && fitsFoundation(s, first)) return { to: "foundation" };
  const others = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => !(where.from === "column" && where.index === i));
  const onCards = others.find((i) => s.columns[i]!.length && fitsOn(first, s.columns[i]!.at(-1)) && cards.length <= maxRun(s, false));
  if (onCards !== undefined) return { to: "column", index: onCards };
  // An empty column, unless the run already starts its own column.
  const wholeColumn = where.from === "column" && where.at === 0;
  const empty = others.find((i) => !s.columns[i]!.length);
  if (empty !== undefined && !wholeColumn && cards.length <= maxRun(s, true)) return { to: "column", index: empty };
  const cell = s.cells.findIndex((c) => !c);
  if (cards.length === 1 && where.from === "column" && cell >= 0) return { to: "cell", index: cell };
  return null;
}

function move(s: FreeCellState, where: Where, target: Target) {
  let cards: KCard[];
  if (where.from === "cell") {
    cards = [s.cells[where.index]!];
    s.cells[where.index] = null;
  } else cards = s.columns[where.index]!.splice(where.at);
  if (target.to === "foundation") foundationOf(s, cards[0]!).push(cards[0]!);
  else if (target.to === "cell") s.cells[target.index] = cards[0]!;
  else s.columns[target.index]!.push(...cards);
  s.moves += 1;
  s.idle = target.to === "foundation" ? 0 : s.idle + 1;
  if (s.foundations.every((f) => f.length === 13)) {
    s.won = true;
    s.phase = "finished";
    s.narration = `Deal #${s.dealNumber} solved in ${s.moves} moves! 🎉`;
  }
}

/** Everything left is in order (each column runs down), so it can all go home on its own. */
const canFinish = (s: FreeCellState) => !s.won && s.columns.every((col) => col.every((c, i) => i === 0 || rankOf(c) < rankOf(col[i - 1]!)));

function snapshot(s: FreeCellState): string {
  const ids = (cards: (KCard | null)[]) => cards.map((c) => c?.id ?? "").join(",");
  return JSON.stringify({ c: ids(s.cells), f: s.foundations.map(ids), k: s.columns.map(ids), m: s.moves, i: s.idle });
}

function restore(s: FreeCellState, snap: string): FreeCellState {
  const all = new Map([...s.cells.filter((c): c is KCard => !!c), ...s.foundations.flat(), ...s.columns.flat()].map((c) => [c.id, c]));
  const list = (text: string) => (text ? text.split(",").map((id) => all.get(id)!) : []);
  const x = JSON.parse(snap) as { c: string; f: string[]; k: string[]; m: number; i: number };
  return { ...s, cells: x.c.split(",").map((id) => (id ? all.get(id)! : null)), foundations: x.f.map(list), columns: x.k.map(list), moves: x.m, idle: x.i };
}

type Move =
  | { type: "auto"; card: string }
  /** The card (and the run on it) to a place you choose: a column or a free cell by its index, or home. */
  | { type: "move"; card: string; to: "foundation" | "column" | "cell"; index?: number }
  | { type: "undo" }
  | { type: "finish" }
  | { type: "resign" };

function apply(state: FreeCellState, seat: number, mv: Move): FreeCellState {
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
    case "auto": {
      const where = locate(s, mv.card);
      if (!where) throw new GameError("You can't move that card now.");
      if (where.from === "column" && !isRun(s.columns[where.index]!, where.at)) throw new GameError("Only a run moves together: each card one lower and the other colour.");
      const target = bestTarget(s, where);
      if (!target) {
        const n = where.from === "column" ? s.columns[where.index]!.length - where.at : 1;
        const card = where.from === "cell" ? s.cells[where.index]! : s.columns[where.index]![where.at]!;
        throw new GameError(n > maxRun(s, false) ? `Not enough room to move ${n} cards: free a cell or empty a column.` : `The ${name(card)} has nowhere to go.`);
      }
      move(s, where, target);
      return s;
    }
    case "move": {
      const where = locate(s, mv.card);
      if (!where) throw new GameError("You can't move that card now.");
      if (where.from === "column" && !isRun(s.columns[where.index]!, where.at)) throw new GameError("Only a run moves together: each card one lower and the other colour.");
      const cards = where.from === "cell" ? [s.cells[where.index]!] : s.columns[where.index]!.slice(where.at);
      const first = cards[0]!;
      const index = Number(mv.index);
      if (mv.to === "foundation") {
        if (cards.length > 1) throw new GameError("Only one card goes home at a time.");
        if (!fitsFoundation(s, first)) throw new GameError(`The ${name(first)} can't go home yet.`);
        move(s, where, { to: "foundation" });
        return s;
      }
      if (mv.to === "cell") {
        if (!(index in s.cells)) throw new GameError("That's not a place for a card.");
        if (where.from === "cell" && where.index === index) throw new GameError(`The ${name(first)} is already there.`);
        if (cards.length > 1) throw new GameError("Only one card fits in a free cell.");
        if (s.cells[index]) throw new GameError("That cell is taken.");
        move(s, where, { to: "cell", index });
        return s;
      }
      const col = mv.to === "column" ? s.columns[index] : undefined;
      if (!col) throw new GameError("That's not a place for a card.");
      if (where.from === "column" && where.index === index) throw new GameError(`The ${name(first)} is already there.`);
      if (!fitsOn(first, col.at(-1))) throw new GameError(`The ${name(first)} doesn't go on the ${name(col.at(-1)!)}.`);
      if (cards.length > maxRun(s, !col.length)) throw new GameError(`Not enough room to move ${cards.length} cards: free a cell or empty a column.`);
      move(s, where, { to: "column", index });
      return s;
    }
    case "finish": {
      if (!canFinish(s)) throw new GameError("Not everything is in order yet.");
      for (let guard = 0; guard < 60 && !s.won; guard++) {
        const cell = s.cells.findIndex((c) => c && fitsFoundation(s, c));
        if (cell >= 0) {
          move(s, { from: "cell", index: cell }, { to: "foundation" });
          continue;
        }
        const col = s.columns.findIndex((c) => c.length && fitsFoundation(s, c.at(-1)!));
        if (col < 0) break;
        move(s, { from: "column", index: col, at: s.columns[col]!.length - 1 }, { to: "foundation" });
      }
      return s;
    }
    case "resign": {
      s.phase = "finished";
      s.narration = `Stuck on deal #${s.dealNumber} after ${s.moves} moves.`;
      return s;
    }
    default:
      throw new GameError("That's not a move in FreeCell.");
  }
}

function view(s: FreeCellState, seat: number): KitView {
  const over = s.phase === "finished";
  const home = s.foundations.reduce((n, f) => n + f.length, 0);
  const tappable = over ? [] : [...s.cells.filter((c): c is KCard => !!c).map((c) => c.id), ...s.columns.flatMap((col) => col.filter((_, at) => isRun(col, at)).map((c) => c.id))];
  return {
    game: "freecell",
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
      stock: null,
      waste: [],
      foundations: s.foundations.map((f) => f.at(-1) ?? null),
      cells: s.cells,
      columns: s.columns.map((c) => ({ down: 0, up: c })),
      tap: over ? null : { type: "auto", cards: tappable },
      drop: over ? null : { type: "move", foundations: true },
      drawMove: null,
    },
    melds: [],
    info: [`Deal #${s.dealNumber}`, `${home} of 52 home`],
    narration: s.narration,
    scores: [{ seats: [0], value: home }],
    result: null,
    over: over ? { winners: s.won ? [0] : [], title: s.won ? `Deal #${s.dealNumber} solved in ${s.moves} moves!` : `${home} cards home on deal #${s.dealNumber}` } : null,
  };
}

// ---- A computer player (for the tests' games) --------------------------------------------------

function bot(s: FreeCellState, seat: number, _style: PlayStyle): Move | null {
  if (s.phase !== "playing" || seat !== 0) return null;
  if (canFinish(s)) return { type: "finish" };
  if (s.idle > 120 || s.moves > 1500) return { type: "resign" };
  // Home first, from the cells or the columns.
  for (const c of s.cells) if (c && fitsFoundation(s, c)) return { type: "auto", card: c.id };
  for (const col of s.columns) if (col.length && fitsFoundation(s, col.at(-1)!)) return { type: "auto", card: col.at(-1)!.id };
  // A parked card back onto a column.
  for (let i = 0; i < 4; i++) {
    const c = s.cells[i];
    if (c && s.columns.some((col) => col.length && fitsOn(c, col.at(-1)))) return { type: "auto", card: c.id };
  }
  // A run onto another column, longest first, if it uncovers something.
  for (let i = 0; i < 8; i++) {
    const col = s.columns[i]!;
    for (let at = 0; at < col.length; at++) {
      if (!isRun(col, at) || at === 0) continue;
      const t = bestTarget(s, { from: "column", index: i, at });
      if (t && t.to === "column" && s.columns[t.index]!.length) return { type: "auto", card: col[at]!.id };
    }
  }
  // Park a card that's covering a low one.
  const low = s.columns
    .map((col, i) => ({ i, depth: col.length - 1 - col.findIndex((c) => fitsFoundation(s, c) || rankOf(c) <= 2) }))
    .filter((x) => s.columns[x.i]!.length && x.depth > 0 && x.depth < 50)
    .sort((a, b) => a.depth - b.depth)[0];
  if (low && s.cells.some((c) => !c)) return { type: "auto", card: s.columns[low.i]!.at(-1)!.id };
  return { type: "resign" };
}

export const freeCell: CardGame<FreeCellRules, FreeCellState, Move> = {
  id: "freecell",
  name: "FreeCell",
  emoji: "🗝️",
  blurb: "Solitaire where every card is face up",
  tagline: "Every card face up, four free cells to park in, and nearly every deal can be won.",
  seats: { min: 1, max: 1, default: 1 },
  teams: false,
  presets: [freeCellNew],
  fields: [{ key: "deal", label: "Deal number", hint: "Play a numbered deal (the same number deals the same game for everyone), or 0 for a new one.", kind: "number", min: 0, max: MAX_DEAL }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<FreeCellRules>;
    const deal = Math.max(0, Math.min(MAX_DEAL, Math.round(Number(given.deal) || 0)));
    return { ...freeCellNew, ...given, deal };
  },
  validate: (r) => (r.deal >= 0 && r.deal <= MAX_DEAL ? [] : [`Deal numbers go from 1 to ${MAX_DEAL.toLocaleString("en-US")}.`]),
  describe() {
    return [
      "Every card is dealt face up into eight columns. Four free cells hold a card each, and four foundations build each suit up from the ace.",
      "Build the columns down in alternating colours. Any card can go into an empty column or a free cell.",
      "A run moves together when there's room to have moved it a card at a time: more free cells and empty columns, longer runs.",
      "Tap a card and it goes to its best place, or drag it where you want it. Undo takes back a move; Finish sends everything home once it's all in order.",
      "Every deal has a number. Put a number in the rules to play that deal, so the family can all try the same one.",
    ];
  },
  newGame: newFreeCell,
  apply,
  view,
  bot,
  thinkingTime: () => 120,
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "freecell",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: `Deal #${s.dealNumber}: ${s.foundations.reduce((n, f) => n + f.length, 0)} of 52 home in ${s.moves} moves`,
      order: over ? [0] : null,
      winners: over ? (s.won ? [0] : []) : null,
      teams: false,
      seats: 1,
    };
  },
};
