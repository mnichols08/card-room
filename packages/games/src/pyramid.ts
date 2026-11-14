// Pyramid solitaire: 28 cards in a pyramid of seven rows, the rest in the stock. Clear away pairs
// that add up to 13 (aces 1, jacks 11, queens 12; a king is 13 on its own). A card can be used once
// nothing covers it. Turn the stock one at a time; its top card can pair too. Clear the pyramid to win.
import type { PlayStyle } from "@spades/rules";
import { clone, FULL, GameError, makeDeck, nextRandom, rankLabel, shuffled, SYMBOL, type BaseRules, type CardGame, type KCard, type KitView, type PipCard } from "./kit.js";

export interface PyramidRules extends BaseRules {
  /** Times through the stock. */
  passes: number;
}

export const pyramidClassic: PyramidRules = { id: "pyramid-classic", name: "Pyramid (3 times through)", passes: 3 };
export const pyramidHard: PyramidRules = { id: "pyramid-hard", name: "Once through (hard)", passes: 1 };

export interface PyramidState {
  game: "pyramid";
  rules: PyramidRules;
  seats: 1;
  rng: number;
  hand: number;
  dealer: 0;
  phase: "playing" | "finished";
  /** Row r has r+1 places; null once cleared. */
  rows: (KCard | null)[][];
  stock: KCard[];
  waste: KCard[];
  pass: number;
  held: string | null;
  moves: number;
  won: boolean;
  narration: string | null;
}

export const pyramidValue = (c: KCard) => ((c as PipCard).rank === 14 ? 1 : (c as PipCard).rank);
const name = (c: KCard) => `${rankLabel((c as PipCard).rank)}${SYMBOL[(c as PipCard).suit]}`;

export function newPyramid(rules: PyramidRules, _seats: number, seed: number): PyramidState {
  const s = { game: "pyramid", rules, seats: 1, rng: seed >>> 0, hand: 0, dealer: 0, phase: "playing", pass: 1, held: null, moves: 0, won: false, narration: null } as unknown as PyramidState;
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  let at = 0;
  s.rows = Array.from({ length: 7 }, (_, r) => {
    const row = deck.slice(at, at + r + 1);
    at += r + 1;
    return row;
  });
  s.stock = deck.slice(at);
  s.waste = [];
  return s;
}

/** Is the card at row r, place i free (nothing in the row below covers it)? */
const free = (s: PyramidState, r: number, i: number) => r === 6 || (!s.rows[r + 1]![i] && !s.rows[r + 1]![i + 1]);

/** The cards that can be used now: uncovered pyramid cards and the top of the waste. */
export function available(s: PyramidState): KCard[] {
  const out: KCard[] = [];
  s.rows.forEach((row, r) => row.forEach((c, i) => c && free(s, r, i) && out.push(c)));
  if (s.waste.length) out.push(s.waste.at(-1)!);
  return out;
}

function remove(s: PyramidState, ids: string[]) {
  for (const id of ids) {
    if (s.waste.at(-1)?.id === id) s.waste.pop();
    else for (const row of s.rows) {
      const i = row.findIndex((c) => c?.id === id);
      if (i >= 0) row[i] = null;
    }
  }
  s.moves += 1;
  s.held = null;
  if (s.rows.every((row) => row.every((c) => !c))) {
    s.won = true;
    s.phase = "finished";
    s.narration = `Pyramid cleared in ${s.moves} moves! 🔺`;
  }
}

type Move = { type: "pick"; card: string } | { type: "draw" } | { type: "resign" };

function apply(state: PyramidState, seat: number, mv: Move): PyramidState {
  if (seat !== 0) throw new GameError("This is a game for one.");
  if (state.phase !== "playing") throw new GameError("The game is over.");
  const s = clone(state);
  s.narration = null;
  switch (mv.type) {
    case "draw": {
      s.held = null;
      if (s.stock.length) s.waste.push(s.stock.pop()!);
      else if (s.waste.length && s.pass < s.rules.passes) {
        s.stock = [...s.waste].reverse();
        s.waste = [];
        s.pass += 1;
        s.narration = `Through the stock again (${s.pass} of ${s.rules.passes})`;
      } else throw new GameError("No more passes through the stock.");
      return s;
    }
    case "pick": {
      const card = available(s).find((c) => c.id === mv.card);
      if (!card) throw new GameError("That card is covered.");
      if (pyramidValue(card) === 13) {
        remove(s, [card.id]);
        s.narration ??= `The ${name(card)} goes on its own`;
        return s;
      }
      if (!s.held || s.held === card.id) {
        s.held = s.held === card.id ? null : card.id;
        return s;
      }
      const other = available(s).find((c) => c.id === s.held);
      if (!other) {
        s.held = card.id;
        return s;
      }
      if (pyramidValue(other) + pyramidValue(card) !== 13) {
        s.held = card.id;
        s.narration = `${name(other)} and ${name(card)} make ${pyramidValue(other) + pyramidValue(card)}, not 13`;
        return s;
      }
      remove(s, [other.id, card.id]);
      s.narration ??= `${name(other)} + ${name(card)} = 13`;
      return s;
    }
    case "resign": {
      s.phase = "finished";
      const left = s.rows.flat().filter(Boolean).length;
      s.narration = `${28 - left} of 28 cleared`;
      return s;
    }
    default:
      throw new GameError("That's not a move in Pyramid.");
  }
}

function view(s: PyramidState, seat: number): KitView {
  const over = s.phase === "finished";
  const left = s.rows.flat().filter(Boolean).length;
  const canDraw = !over && (s.stock.length > 0 || (s.waste.length > 0 && s.pass < s.rules.passes));
  return {
    game: "pyramid",
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
    choices: over ? null : { prompt: "", options: [{ label: "Give up", move: { type: "resign" } }], layout: "row" },
    players: [{ cards: 0, line: `${28 - left} of 28 cleared` }],
    center: {
      kind: "pyramid",
      rows: s.rows,
      tap: over ? null : { type: "pick", cards: available(s).map((c) => c.id) },
      held: s.held,
      stock: s.stock.length,
      waste: s.waste.at(-1) ?? null,
      drawMove: canDraw ? { type: "draw" } : null,
      stockLabel: s.stock.length ? `${s.stock.length} left` : canDraw ? "Turn over" : "",
    },
    melds: [],
    info: ["Pairs that make 13 · A 1, J 11, Q 12, K 13 alone", `Pass ${s.pass} of ${s.rules.passes}`],
    narration: s.narration ?? (s.held ? "Now tap a card that makes 13 with it" : null),
    scores: [{ seats: [0], value: 28 - left }],
    result: null,
    over: over ? { winners: s.won ? [0] : [], title: s.won ? `Cleared in ${s.moves} moves!` : `${28 - left} of 28 cleared: not this time` } : null,
  };
}

// ---- A computer player (it plays the tests' games) ---------------------------------------------

function bot(s: PyramidState, seat: number, _style: PlayStyle): Move | null {
  if (s.phase !== "playing" || seat !== 0) return null;
  const av = available(s);
  if (s.held) {
    const h = av.find((c) => c.id === s.held);
    const mate = h && av.find((c) => c.id !== h.id && pyramidValue(c) + pyramidValue(h) === 13);
    if (mate) return { type: "pick", card: mate.id };
  }
  const king = av.find((c) => pyramidValue(c) === 13);
  if (king) return { type: "pick", card: king.id };
  for (const a of av) for (const b of av) if (a.id !== b.id && pyramidValue(a) + pyramidValue(b) === 13) return { type: "pick", card: a.id };
  if (s.stock.length || (s.waste.length && s.pass < s.rules.passes)) return { type: "draw" };
  return { type: "resign" };
}

export const pyramid: CardGame<PyramidRules, PyramidState, Move> = {
  id: "pyramid",
  name: "Pyramid",
  emoji: "🔺",
  blurb: "Solitaire: clear pairs that make 13",
  tagline: "Clear the pyramid two cards at a time: pairs that add up to 13. Kings go on their own.",
  seats: { min: 1, max: 1, default: 1 },
  teams: false,
  presets: [pyramidClassic, pyramidHard],
  fields: [{ key: "passes", label: "Times through the stock", kind: "choice", options: [[1, "Once (hard)"], [2, "Twice"], [3, "Three times"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<PyramidRules>;
    const base = [pyramidClassic, pyramidHard].find((p) => p.id === given.id) ?? pyramidClassic;
    const r = { ...base, ...given };
    return { ...r, passes: Math.min(3, Math.max(1, Number(r.passes) || 3)) };
  },
  validate: () => [],
  describe(r) {
    return [
      "28 cards in a pyramid of seven rows; the rest are the stock.",
      "Clear away two cards that add up to 13: aces count 1, jacks 11, queens 12. A king is 13 on its own. Tap one card, then its partner.",
      "A pyramid card can be used once both cards over it are gone. The top card of the turned-up pile can be used too.",
      `Turn the stock one card at a time${r.passes > 1 ? `, and go through it up to ${r.passes} times` : ", just once"}. Clear the whole pyramid to win.`,
    ];
  },
  newGame: newPyramid,
  apply,
  view,
  bot,
  thinkingTime: () => 400,
  summary(s) {
    const over = s.phase === "finished";
    return { game: "pyramid", rules: s.rules.name, phase: s.phase, over, hand: 1, scoreLine: `${28 - s.rows.flat().filter(Boolean).length} of 28`, order: over ? [0] : null, winners: over ? (s.won ? [0] : []) : null, teams: false, seats: 1 };
  },
};
