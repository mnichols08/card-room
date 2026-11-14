// Cuckoo (also Screw Your Neighbor, or Ranter-Go-Round): one card each, face down, and the lowest
// card loses a life. Starting left of the dealer, keep your card or swap it with the player on your
// left, who has to take it unless they hold a king (kings stop the swap). The dealer goes last and may
// swap with the top of the deck instead. Then everyone shows: the lowest card loses a life (aces are
// low). Last one with lives left wins.
import type { PlayStyle } from "@spades/rules";
import {
  clone,
  drinkingField,
  FULL,
  GameError,
  makeDeck,
  markReady,
  nextRandom,
  rankLabel,
  rankSeats,
  shuffled,
  SYMBOL,
  thinkFor,
  who,
  withDrinks,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type Meld,
} from "./kit.js";

export interface CuckooRules extends BaseRules {
  lives: number;
  /** Kings stop a swap. */
  kingsBlock: boolean;
  drinking: boolean;
}

export const classicCuckoo: CuckooRules = { id: "cuckoo-classic", name: "Cuckoo (3 lives)", lives: 3, kingsBlock: true, drinking: false };
export const longCuckoo: CuckooRules = { ...classicCuckoo, id: "cuckoo-long", name: "Longer (5 lives)", lives: 5 };
export const drinkingCuckoo: CuckooRules = { ...classicCuckoo, id: "cuckoo-drinking", name: "Drinking Cuckoo 🍺", drinking: true };

export interface CuckooState {
  game: "cuckoo";
  rules: CuckooRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  lives: number[];
  outAt: (number | null)[];
  cards: (KCard | null)[];
  deck: KCard[];
  turn: number;
  phase: "swapping" | "shown" | "finished";
  /** What happened to each seat this round, for the table. */
  notes: string[];
  lost: number[];
  ready: boolean[];
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
/** Aces low: A 1 … K 13. */
export const cuckooValue = (c: KCard) => (rank(c) === 14 ? 1 : rank(c));
const label = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[(c as { suit: keyof typeof SYMBOL }).suit]}`;
const alive = (s: CuckooState) => s.lives.flatMap((l, i) => (l > 0 ? [i] : []));
const nextAlive = (s: CuckooState, from: number) => {
  for (let k = 1; k <= s.seats; k++) if (s.lives[(from + k) % s.seats]! > 0) return (from + k) % s.seats;
  return from;
};

function deal(s: CuckooState) {
  s.deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.cards = s.lives.map((l) => (l > 0 ? s.deck.pop()! : null));
  s.turn = nextAlive(s, s.dealer);
  s.notes = Array(s.seats).fill("");
  s.lost = Array(s.seats).fill(0);
  s.ready = s.lives.map((l) => l <= 0);
  s.phase = "swapping";
  s.narration = null;
}

export function newCuckoo(rules: CuckooRules, seats: number, seed: number): CuckooState {
  const s = { game: "cuckoo", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats } as unknown as CuckooState;
  s.lives = Array(seats).fill(rules.lives);
  s.outAt = Array(seats).fill(null);
  deal(s);
  return s;
}

function show(s: CuckooState) {
  const living = alive(s);
  const lowest = Math.min(...living.map((i) => cuckooValue(s.cards[i]!)));
  const losers = living.filter((i) => cuckooValue(s.cards[i]!) === lowest);
  // Everyone tied: nobody loses.
  if (losers.length === living.length) {
    s.narration = "Everyone tied: nobody loses a life";
  } else {
    for (const i of losers) {
      s.lives[i]! -= 1;
      s.lost[i] = 1;
      if (s.lives[i] === 0) s.outAt[i] = s.hand;
    }
    const out = losers.filter((i) => s.lives[i] === 0);
    s.narration = `${losers.map(who).join(" and ")} ${losers.length > 1 ? "have" : "has"} the lowest card and lose${losers.length > 1 ? "" : "s"} a life${out.length ? `. ${out.map(who).join(" and ")} ${out.length > 1 ? "are" : "is"} out` : ""}`;
    // Drinking: the lowest drinks 2; knocked out, finish the drink.
    s.narration = withDrinks(s.rules.drinking, s.narration, losers.filter((i) => s.lives[i]! > 0), 2) ?? s.narration;
    s.narration = withDrinks(s.rules.drinking, s.narration, out, 99) ?? s.narration;
  }
  s.ready = s.lives.map((l, i) => l <= 0 && !s.lost[i]);
  s.phase = alive(s).length <= 1 ? "finished" : "shown";
}

type Move = { type: "keep" } | { type: "swap" } | { type: "cut" } | { type: "next" };

function apply(state: CuckooState, seat: number, move: Move): CuckooState {
  const s = clone(state);
  if (move.type === "next") {
    if (s.phase !== "shown") throw new GameError("The round isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = nextAlive(s, s.dealer);
      deal(s);
    }
    return s;
  }
  if (s.phase !== "swapping" || s.turn !== seat) throw new GameError("It's not your turn.");
  const dealer = seat === s.dealer;
  if (move.type === "keep") {
    s.notes[seat] = "Kept";
    s.narration = `${who(seat)} kept their card`;
  } else if (move.type === "swap") {
    if (dealer) throw new GameError("The dealer swaps with the deck: cut it.");
    const left = nextAlive(s, seat);
    if (s.rules.kingsBlock && rank(s.cards[left]!) === 13) {
      s.notes[seat] = "Stopped by a king";
      s.notes[left] = "Showed a king";
      s.narration = `${who(left)} has a king: no swap! ${who(seat)} keeps their card`;
    } else {
      [s.cards[seat], s.cards[left]] = [s.cards[left]!, s.cards[seat]!];
      s.notes[seat] = "Swapped";
      s.narration = `${who(seat)} swapped with ${who(left)}`;
    }
  } else if (move.type === "cut") {
    if (!dealer) throw new GameError("Only the dealer cuts the deck.");
    const c = s.deck.splice(Math.floor(s.deck.length / 2), 1)[0]!;
    s.deck.push(s.cards[seat]!);
    s.cards[seat] = c;
    s.notes[seat] = "Cut the deck";
    s.narration = `${who(seat)} cut the deck for a new card`;
  } else throw new GameError("That's not a move in Cuckoo.");
  if (dealer) show(s);
  else s.turn = nextAlive(s, seat);
  return s;
}

function view(s: CuckooState, seat: number): KitView {
  const over = s.phase === "finished";
  const shown = s.phase !== "swapping";
  const mine = s.phase === "swapping" && s.turn === seat;
  const dealer = seat === s.dealer;
  const mineCard = s.cards[seat];
  const melds: Meld[] = shown ? s.cards.flatMap((c, i) => (c && i !== seat ? [{ owner: i, label: s.lost[i] ? "Lowest!" : "", cards: [c] }] : [])) : [];
  let choices: KitView["choices"] = null;
  if (mine) {
    choices = {
      prompt: mineCard ? `You have the ${label(mineCard)}.` : "",
      options: [{ label: "Keep it", move: { type: "keep" } }, dealer ? { label: "Cut the deck", move: { type: "cut" } } : { label: `Swap with ${who(nextAlive(s, seat))}`, move: { type: "swap" } }],
      layout: "row",
    };
  } else if (s.phase === "shown" && !s.ready[seat]) choices = { prompt: "", options: [{ label: "Next round", move: { type: "next" }, primary: true }] };
  const hearts = (n: number) => (n > 0 ? "♥".repeat(n) : "Out");
  const w = alive(s);
  return {
    game: "cuckoo",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "swapping" ? s.turn : null,
    dealer: s.dealer,
    hand: mineCard ? [mineCard] : [],
    tap: null,
    pick: null,
    choices,
    players: s.cards.map((c, i) => ({ cards: c ? 1 : 0, line: `${hearts(s.lives[i]!)}${s.notes[i] ? ` · ${s.notes[i]}` : ""}`, out: s.lives[i]! <= 0 && !s.lost[i], dealer: i === s.dealer })),
    center: { kind: "piles", stock: s.deck.length, discard: [], discardCount: 0, drawMove: null, takeMove: null, noDiscard: true, stockLabel: "The deck" },
    melds,
    info: ["Lowest card loses a life · aces are low", ...(s.rules.kingsBlock ? ["Kings stop a swap"] : []), ...(s.rules.drinking ? ["🍺 Lowest drinks 2; out of lives, finish your drink"] : [])],
    narration: s.narration,
    scores: s.lives.map((value, i) => ({ seats: [i], value })),
    result: null,
    over: over ? { winners: w.length ? w : s.lives.map((_, i) => i), title: w.length === 1 ? `${who(w[0]!)} is the last one standing!` : "Nobody left standing!" } : null,
  };
}

function bot(s: CuckooState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "shown") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "swapping" || s.turn !== seat) return null;
  const v = cuckooValue(s.cards[seat]!);
  const players = alive(s).length;
  // Swap anything low; the more players, the higher a card has to be to feel safe.
  const safe = 6 + Math.min(2, (players - 3) / 2) - (style.bold ?? 0.3) * 2;
  const swap = v < safe || (Math.random() < (style.sloppy ?? 0) * 0.3);
  if (v === 13) return { type: "keep" };
  if (seat === s.dealer) return swap ? { type: "cut" } : { type: "keep" };
  return swap ? { type: "swap" } : { type: "keep" };
}

export const cuckoo: CardGame<CuckooRules, CuckooState, Move> = {
  id: "cuckoo",
  name: "Cuckoo",
  emoji: "🐦",
  blurb: "One card each; don't get stuck with the lowest",
  tagline: "Keep your card or swap it with your neighbour. Lowest card loses a life. Kings stop a swap!",
  seats: { min: 3, max: 10, default: 5 },
  teams: false,
  presets: [classicCuckoo, longCuckoo, drinkingCuckoo],
  fields: [
    { key: "lives", label: "Lives", kind: "choice", options: [[2, "2"], [3, "3"], [4, "4"], [5, "5"]] },
    { key: "kingsBlock", label: "Kings stop a swap", kind: "toggle" },
    drinkingField<CuckooRules>("Adults only. The lowest card drinks 2; lose your last life and finish your drink (or sip water)."),
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<CuckooRules>;
    const base = [classicCuckoo, longCuckoo, drinkingCuckoo].find((p) => p.id === given.id) ?? classicCuckoo;
    const r = { ...base, ...given };
    return { ...r, lives: Math.min(9, Math.max(1, Number(r.lives) || 3)), drinking: !!r.drinking };
  },
  validate: () => [],
  describe(r) {
    return [
      "One card each, face down; only you see yours. Aces are low, kings are high.",
      `Starting left of the dealer, keep your card or swap it with the player on your left.${r.kingsBlock ? " They have to take it, unless they hold a king: kings stop the swap." : ""}`,
      "The dealer goes last and may swap with a card from the middle of the deck instead.",
      `Then everyone shows. The lowest card loses a life (everyone tied: nobody does). Everyone starts with ${r.lives}; last one standing wins.`,
      ...(r.drinking ? ["🍺 Drinking mode: the lowest card drinks 2, and whoever loses their last life finishes their drink."] : []),
    ];
  },
  newGame: newCuckoo,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "shown" ? 2200 : thinkFor(2, 0.9)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "cuckoo",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.lives.join(" · ") + " lives",
      order: over ? rankSeats(s.lives.map((l, i) => ({ seats: [i], score: l * 1000 + (s.outAt[i] ?? 999) }))) : null,
      winners: over ? (alive(s).length ? alive(s) : s.lives.map((_, i) => i)) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
