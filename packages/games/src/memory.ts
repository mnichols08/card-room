// Memory (Concentration): pairs of cards laid face down in a grid. On your turn turn over two. A
// pair (same number, same colour) is yours and you go again; otherwise they stay up until the next
// player turns a card, then go back face down. Most pairs wins; alone, clear the board in as few
// turns as you can.
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

export interface MemoryRules extends BaseRules {
  pairs: number;
}

export const smallMemory: MemoryRules = { id: "memory-12", name: "12 pairs", pairs: 12 };
export const mediumMemory: MemoryRules = { id: "memory-18", name: "18 pairs", pairs: 18 };
export const bigMemory: MemoryRules = { id: "memory-26", name: "The whole deck (26 pairs)", pairs: 26 };

export interface MemoryState {
  game: "memory";
  rules: MemoryRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  cells: (KCard | null)[];
  /** Cards turned up right now (one or two). */
  up: number[];
  /** A pair that didn't match, left showing until the next card is turned. */
  peek: number[];
  turn: number;
  turns: number;
  pairs: number[];
  /** When each card was last seen (by turn count), for the computer players' memories. */
  seen: Record<number, number>;
  phase: "playing" | "finished";
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const red = (c: KCard) => ["hearts", "diamonds"].includes((c as { suit: string }).suit);
const label = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[(c as { suit: keyof typeof SYMBOL }).suit]}`;
export const isPair = (a: KCard, b: KCard) => rank(a) === rank(b) && red(a) === red(b);

export function newMemory(rules: MemoryRules, seats: number, seed: number): MemoryState {
  const s = { game: "memory", rules, seats, rng: seed >>> 0, hand: 0, dealer: 0, up: [], peek: [], turn: 0, turns: 0, seen: {}, phase: "playing", narration: null } as unknown as MemoryState;
  // A pair is two cards of the same number and colour: 26 of them in a deck.
  const deck = makeDeck({ ranks: FULL });
  const groups = new Map<string, KCard[]>();
  for (const c of deck) {
    const k = `${rank(c)}-${red(c)}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const chosen = shuffled([...groups.values()], nextRandom(s)).slice(0, Math.min(26, rules.pairs));
  s.cells = shuffled(chosen.flat(), nextRandom(s));
  s.pairs = Array(seats).fill(0);
  return s;
}

export const memoryCols = (n: number) => (n <= 24 ? 6 : n <= 36 ? 6 : 8);

type Move = { type: "flip"; index: number };

function apply(state: MemoryState, seat: number, move: Move): MemoryState {
  const s = clone(state);
  if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
  if (move.type !== "flip") throw new GameError("That's not a move in Memory.");
  const i = Number(move.index);
  if (!s.cells[i]) throw new GameError("There's no card there.");
  if (s.up.includes(i)) throw new GameError("That card is already up.");
  s.peek = [];
  s.up.push(i);
  s.seen[i] = s.turns;
  if (s.up.length < 2) {
    s.narration = null;
    return s;
  }
  const [a, b] = s.up as [number, number];
  s.turns += 1;
  const ca = s.cells[a]!;
  const cb = s.cells[b]!;
  if (isPair(ca, cb)) {
    s.pairs[seat]! += 1;
    s.cells[a] = null;
    s.cells[b] = null;
    s.up = [];
    s.narration = `${who(seat)} found a pair: ${label(ca)} and ${label(cb)}! Go again`;
    if (s.cells.every((c) => !c)) {
      s.phase = "finished";
      s.narration = s.seats === 1 ? `Cleared in ${s.turns} turns!` : `${who(seat)} found the last pair!`;
    }
    return s;
  }
  s.peek = s.up;
  s.up = [];
  s.narration = `${label(ca)} and ${label(cb)}: no match`;
  s.turn = (seat + 1) % s.seats;
  return s;
}

function winners(s: MemoryState): number[] {
  if (s.seats === 1) return [0];
  const best = Math.max(...s.pairs);
  return s.pairs.flatMap((p, i) => (p === best ? [i] : []));
}

function view(s: MemoryState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  const shown = new Set([...s.up, ...s.peek]);
  const w = over ? winners(s) : [];
  return {
    game: "memory",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    dealer: s.dealer,
    hand: [],
    handHidden: "none",
    tap: null,
    pick: null,
    choices: null,
    players: s.pairs.map((p, i) => ({ cards: 0, line: `${p} pair${p === 1 ? "" : "s"}` })),
    center: {
      kind: "board",
      cols: memoryCols(s.cells.length),
      cards: s.cells.map((c, i) => (c && shown.has(i) ? c : null)),
      empty: s.cells.flatMap((c, i) => (c ? [] : [i])),
      tap: mine ? { type: "flip", cells: s.cells.flatMap((c, i) => (c && !s.up.includes(i) ? [i] : [])) } : null,
    },
    melds: [],
    info: [`${s.cells.filter(Boolean).length / 2} pairs left`, ...(s.seats === 1 ? [`Turn ${s.turns + 1}`] : []), "Pairs: same number, same colour"],
    narration: s.narration ?? (mine ? (s.up.length ? "Now turn another" : "Turn over two cards") : null),
    scores: s.pairs.map((value, i) => ({ seats: [i], value })),
    result: null,
    over: over ? { winners: w, title: s.seats === 1 ? `Cleared in ${s.turns} turns!` : w.length > 1 ? "It's a tie!" : `${who(w[0]!)} wins with ${s.pairs[w[0]!]} pairs!` } : null,
  };
}

// ---- Computer players: they remember what they've seen, some better than others ---------------

function bot(s: MemoryState, seat: number, style: PlayStyle): Move | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const sharp = style.skill ?? 1;
  // Remembered cards: seen recently, and forgotten more quickly by less careful players.
  const remembers = (i: number) => {
    const at = s.seen[i];
    if (at === undefined || !s.cells[i]) return false;
    const age = s.turns - at;
    return Math.random() < Math.max(0, (0.55 + sharp * 0.4) - age * (0.12 - sharp * 0.08));
  };
  const known = s.cells.flatMap((c, i) => (c && !s.up.includes(i) && remembers(i) ? [i] : []));
  const unknown = s.cells.flatMap((c, i) => (c && !s.up.includes(i) && s.seen[i] === undefined ? [i] : []));
  const any = s.cells.flatMap((c, i) => (c && !s.up.includes(i) ? [i] : []));
  const pick = (list: number[]) => list[Math.floor(Math.random() * list.length)]!;
  if (s.up.length === 1) {
    const first = s.cells[s.up[0]!]!;
    const match = known.find((i) => isPair(s.cells[i]!, first));
    if (match !== undefined) return { type: "flip", index: match };
    return { type: "flip", index: pick(unknown.length ? unknown : any) };
  }
  // A known pair? Take it.
  for (const i of known) for (const j of known) if (i < j && isPair(s.cells[i]!, s.cells[j]!)) return { type: "flip", index: i };
  return { type: "flip", index: pick(unknown.length ? unknown : any) };
}

export const memory: CardGame<MemoryRules, MemoryState, Move> = {
  id: "memory",
  name: "Memory",
  emoji: "🧠",
  blurb: "Find the pairs (great for grandkids)",
  tagline: "Turn over two cards: find a pair and go again. Remember where everything is!",
  seats: { min: 1, max: 6, default: 2 },
  teams: false,
  presets: [smallMemory, mediumMemory, bigMemory],
  fields: [{ key: "pairs", label: "Pairs", kind: "choice", options: [[8, "8 (little ones)"], [12, "12"], [18, "18"], [26, "26 (the whole deck)"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<MemoryRules>;
    const base = [smallMemory, mediumMemory, bigMemory].find((p) => p.id === given.id) ?? smallMemory;
    const r = { ...base, ...given };
    return { ...r, pairs: Math.min(26, Math.max(4, Number(r.pairs) || 12)) };
  },
  validate: () => [],
  describe(r) {
    return [
      `${r.pairs} pairs of cards go face down in a grid. A pair is two cards with the same number and the same colour (two red 7s, two black kings).`,
      "On your turn, turn over two cards. A pair? It's yours, and you go again.",
      "No match? Everyone gets a look, then they turn back over and the next player goes. Remember where they were!",
      "Most pairs wins. Playing alone: clear the board in as few turns as you can.",
    ];
  },
  newGame: newMemory,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.up.length ? 1100 : 1400),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "memory",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.pairs.join(" · ") + " pairs",
      order: over ? rankSeats(s.pairs.map((score, i) => ({ seats: [i], score }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
