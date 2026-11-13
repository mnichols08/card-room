// Rummy 500 for 2 to 6. Draw from the stock, or take any card from the spread-out discard pile
// together with every card above it (a card taken from below the top must be melded that turn).
// Meld sets (three or four of a rank) and runs (three or more in a suit), and lay off on anyone's
// melds; you score the cards you put down, less what's left in your hand. First to 500 wins.
import type { PlayStyle, Suit } from "@spades/rules";
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
  SUITS,
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type Meld,
  type PipCard,
} from "./kit.js";

export interface Rummy500Rules extends BaseRules {
  playTo: number;
  /** Taking only the top card of the pile still means melding it this turn. */
  topMustMeld: boolean;
}

export const classicRummy500: Rummy500Rules = { id: "rummy500-classic", name: "Rummy 500", playTo: 500, topMustMeld: false };
export const quickRummy500: Rummy500Rules = { ...classicRummy500, id: "rummy500-quick", name: "Quick (to 250)", playTo: 250 };
export const strictRummy500: Rummy500Rules = { ...classicRummy500, id: "rummy500-strict", name: "Strict (any card taken must be melded)", topMustMeld: true };

type Phase = "draw" | "meld" | "scored" | "finished";

/** A meld on the table, with who put each card down (they score it). */
export interface TableMeld {
  kind: "set" | "run";
  owner: number;
  cards: { card: KCard; by: number }[];
}

export interface Rummy500State {
  game: "rummy500";
  rules: Rummy500Rules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  stock: KCard[];
  /** The discard pile, oldest first: it's spread out so every card shows. */
  pile: KCard[];
  melds: TableMeld[];
  turn: number;
  /** A card taken from the pile that must be melded this turn, and how to put things back. */
  mustUse: string | null;
  undo: { pile: KCard[]; hand: KCard[] } | null;
  /** A pile card put back this turn: it isn't taken again until the turn is over. */
  declined: string | null;
  scores: number[];
  lastHand: { melded: number[]; inHand: number[]; out: number | null } | null;
  ready: boolean[];
  narration: string | null;
}

const rankOf = (c: KCard) => (c as PipCard).rank;
const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const name = (c: KCard) => `${rankLabel(rankOf(c))}${SYMBOL[suitOf(c)]}`;
const sortHand = (cards: KCard[]) => [...cards].sort((a, b) => SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || rankOf(a) - rankOf(b));

/** A run's ranks in order, with the ace low (A 2 3) or high (Q K A); null if these cards aren't a run. */
function runOrder(cards: KCard[]): number[] | null {
  if (cards.length < 3 || new Set(cards.map(suitOf)).size !== 1) return null;
  for (const aceLow of [false, true]) {
    const ranks = cards.map((c) => (aceLow && rankOf(c) === 14 ? 1 : rankOf(c))).sort((a, b) => a - b);
    if (ranks.every((r, i) => i === 0 || r === ranks[i - 1]! + 1)) return ranks;
  }
  return null;
}

export function meldKind(cards: KCard[]): "set" | "run" | null {
  if (cards.length >= 3 && new Set(cards.map(rankOf)).size === 1) return "set";
  return runOrder(cards) ? "run" : null;
}

/** Points for a card: aces 15 (but 1 at the bottom of a run, A 2 3), faces 10, the rest face value. */
function value(c: KCard, lowAce = false): number {
  const r = rankOf(c);
  if (r === 14) return lowAce ? 1 : 15;
  return r >= 10 ? 10 : r;
}
const lowAceIn = (m: TableMeld) => m.kind === "run" && m.cards.some((x) => rankOf(x.card) === 2);
const handValue = (cards: KCard[]) => cards.reduce((n, c) => n + value(c), 0);

function meldLabel(m: TableMeld): string {
  const cards = m.cards.map((x) => x.card);
  if (m.kind === "set") return `${rankLabel(rankOf(cards[0]!))}s`;
  const order = runOrder(cards)!;
  const label = (r: number) => (r === 1 ? "A" : rankLabel(r));
  return `${label(order[0]!)}–${label(order.at(-1)!)}${SYMBOL[suitOf(cards[0]!)]}`;
}

function deal(s: Rummy500State) {
  const deck = shuffled(makeDeck({ ranks: FULL, copies: s.seats >= 5 ? 2 : 1 }), nextRandom(s));
  const n = s.seats === 2 ? 13 : 7;
  s.hands = Array.from({ length: s.seats }, (_, i) => sortHand(deck.slice(i * n, i * n + n)));
  s.stock = deck.slice(s.seats * n);
  s.pile = [s.stock.pop()!];
  s.melds = [];
  s.mustUse = null;
  s.undo = null;
  s.declined = null;
  s.ready = Array.from({ length: s.seats }, () => false);
  s.turn = (s.dealer + 1) % s.seats;
  s.phase = "draw";
  s.narration = null;
}

export function newRummy500(rules: Rummy500Rules, seats: number, seed: number): Rummy500State {
  const s = { game: "rummy500", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, lastHand: null } as unknown as Rummy500State;
  s.scores = Array.from({ length: seats }, () => 0);
  deal(s);
  return s;
}

/** Where these cards can go: a new meld, or onto a meld on the table (its index). */
export function placement(s: Rummy500State, cards: KCard[]): { kind: "set" | "run"; onto: number } | null {
  const fresh = meldKind(cards);
  if (fresh) return { kind: fresh, onto: -1 };
  for (let i = 0; i < s.melds.length; i++) {
    const m = s.melds[i]!;
    const together = [...m.cards.map((x) => x.card), ...cards];
    if (m.kind === "set" ? meldKind(together) === "set" : runOrder(together) !== null) return { kind: m.kind, onto: i };
  }
  return null;
}

type Move = { type: "draw" } | { type: "take"; card?: string } | { type: "meld"; cards: string[] } | { type: "discard"; cards?: string[]; card?: string } | { type: "putback" } | { type: "next" };

function apply(state: Rummy500State, seat: number, move: Move): Rummy500State {
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
  if (s.turn !== seat || (s.phase !== "draw" && s.phase !== "meld")) throw new GameError("It's not your turn.");
  const hand = () => s.hands[seat]!;
  switch (move.type) {
    case "draw": {
      if (s.phase !== "draw") throw new GameError("You've already drawn.");
      if (!s.stock.length) throw new GameError("The stock is empty.");
      const card = s.stock.pop()!;
      s.hands[seat] = sortHand([...hand(), card]);
      s.phase = "meld";
      s.narration = null;
      return s;
    }
    case "take": {
      if (s.phase !== "draw") throw new GameError("You've already drawn.");
      if (!s.pile.length) throw new GameError("The discard pile is empty.");
      const at = move.card ? s.pile.findIndex((c) => c.id === move.card) : s.pile.length - 1;
      if (at < 0) throw new GameError("That card isn't in the pile.");
      if (s.pile[at]!.id === s.declined) throw new GameError("You put that one back this turn: draw from the stock, or take another.");
      s.undo = { pile: [...s.pile], hand: [...hand()] };
      const taken = s.pile.slice(at);
      s.pile = s.pile.slice(0, at);
      const deep = at < s.undo.pile.length - 1;
      s.mustUse = deep || s.rules.topMustMeld ? taken[0]!.id : null;
      s.hands[seat] = sortHand([...hand(), ...taken]);
      s.phase = "meld";
      s.narration = `${who(seat)} took ${taken.length === 1 ? `the ${name(taken[0]!)}` : `${taken.length} cards from the ${name(taken[0]!)} up`}`;
      return s;
    }
    case "putback": {
      if (s.phase !== "meld" || !s.undo) throw new GameError("There's nothing to put back.");
      s.declined = s.undo.pile[s.pile.length]?.id ?? null;
      s.pile = s.undo.pile;
      s.hands[seat] = s.undo.hand;
      s.undo = null;
      s.mustUse = null;
      s.phase = "draw";
      s.narration = null;
      return s;
    }
    case "meld": {
      if (s.phase !== "meld") throw new GameError("Draw first: tap the stock, or a card in the pile.");
      const ids = move.cards ?? [];
      const cards = ids.map((id) => hand().find((c) => c.id === id));
      if (!cards.length || cards.some((c) => !c) || new Set(ids).size !== ids.length) throw new GameError("Pick cards from your hand to meld.");
      const where = placement(s, cards as KCard[]);
      if (!where) throw new GameError("Those don't make a set or a run, or fit on a meld on the table.");
      const placed = (cards as KCard[]).map((card) => ({ card, by: seat }));
      if (where.onto >= 0) s.melds[where.onto]!.cards.push(...placed);
      else s.melds.push({ kind: where.kind, owner: seat, cards: placed });
      s.hands[seat] = hand().filter((c) => !ids.includes(c.id));
      if (s.mustUse && ids.includes(s.mustUse)) s.mustUse = null;
      s.undo = null;
      s.narration = where.onto >= 0 ? `${who(seat)} laid off on ${meldLabel(s.melds[where.onto]!)}` : `${who(seat)} melded ${meldLabel(s.melds.at(-1)!)}`;
      if (!hand().length) scoreHand(s, seat);
      return s;
    }
    case "discard": {
      if (s.phase !== "meld") throw new GameError("Draw first: tap the stock, or a card in the pile.");
      const ids = move.cards ?? (move.card ? [move.card] : []);
      if (ids.length !== 1) throw new GameError("Pick one card to discard.");
      const card = hand().find((c) => c.id === ids[0]);
      if (!card) throw new GameError("You don't have that card.");
      if (s.mustUse) {
        const owed = hand().find((c) => c.id === s.mustUse);
        throw new GameError(`You took the ${owed ? name(owed) : "card"} from the pile: meld it this turn, or put the cards back.`);
      }
      s.hands[seat] = hand().filter((c) => c.id !== card.id);
      s.pile.push(card);
      s.undo = null;
      s.declined = null;
      s.narration = `${who(seat)} discarded the ${name(card)}`;
      if (!hand().length) {
        scoreHand(s, seat);
        return s;
      }
      s.turn = (seat + 1) % s.seats;
      s.phase = "draw";
      // The stock has run out: the hand is over.
      if (!s.stock.length) scoreHand(s, null);
      return s;
    }
    default:
      throw new GameError("That's not a move in Rummy 500.");
  }
}

function scoreHand(s: Rummy500State, out: number | null) {
  const melded = Array.from({ length: s.seats }, () => 0);
  for (const m of s.melds) for (const x of m.cards) melded[x.by]! += value(x.card, lowAceIn(m));
  const inHand = s.hands.map(handValue);
  s.scores = s.scores.map((n, i) => n + melded[i]! - inHand[i]!);
  s.lastHand = { melded, inHand, out };
  s.ready = Array.from({ length: s.seats }, () => false);
  s.narration = out !== null ? `${who(out)} went out!` : "The stock ran out.";
  const top = Math.max(...s.scores);
  s.phase = top >= s.rules.playTo ? "finished" : "scored";
}

function winners(s: Rummy500State): number[] {
  const best = Math.max(...s.scores);
  return s.scores.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
}

function view(s: Rummy500State, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.turn === seat && (s.phase === "draw" || s.phase === "meld");
  const owed = s.mustUse ? s.hands[seat]!.find((c) => c.id === s.mustUse) : undefined;
  const melds: Meld[] = s.melds.map((m) => ({ owner: m.owner, label: meldLabel(m), cards: m.cards.map((x) => x.card) }));
  const w = over ? winners(s) : [];
  return {
    game: "rummy500",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "draw" || s.phase === "meld" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: null,
    pick:
      mine && s.phase === "meld"
        ? {
            min: 1,
            max: s.hands[seat]!.length,
            prompt: owed ? `Meld the ${name(owed)} this turn` : "Pick cards to meld, or one to discard.",
            cards: s.hands[seat]!.map((c) => c.id),
            actions: [
              { label: "Meld", type: "meld" },
              { label: "Discard", type: "discard", primary: true },
            ],
          }
        : null,
    choices: mine && s.undo && s.phase === "meld" ? { prompt: "", options: [{ label: "Put them back", move: { type: "putback" } }] } : s.phase === "scored" ? nextHandChoices(s.ready, seat, false) : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: "", dealer: i === s.dealer })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.pile,
      discardCount: s.pile.length,
      drawMove: mine && s.phase === "draw" && s.stock.length ? { type: "draw" } : null,
      takeMove: null,
      spread: { type: "take", cards: mine && s.phase === "draw" ? s.pile.map((c) => c.id) : [] },
      discardLabel: mine && s.phase === "draw" ? "Tap a card to take it and everything above it" : `${s.pile.length} in the pile`,
    },
    melds,
    info: [`To ${s.rules.playTo}`],
    narration: s.narration,
    scores: s.scores.map((n, i) => ({ seats: [i], value: n })),
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `rummy500-${s.hand}`,
            title: s.lastHand.out !== null ? `${who(s.lastHand.out)} went out` : "The stock ran out",
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "Melded", values: s.lastHand.melded.map((n) => (n ? `+${n}` : "0")) },
              { label: "In hand", values: s.lastHand.inHand.map((n) => (n ? `−${n}` : "0")) },
              { label: "This hand", values: s.lastHand.melded.map((n, i) => n - s.lastHand!.inHand[i]!).map((n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0")), tone: "score" as const },
              { label: "Total", values: s.scores.map(String), tone: "total" as const },
            ],
          }
        : null,
    over: over ? { winners: w, title: w.length === 1 ? `${who(w[0]!)} wins with ${s.scores[w[0]!]}` : `A tie at ${s.scores[w[0]!]}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** Melds that can be made from these cards: sets, and the longest runs. */
function meldsIn(cards: KCard[]): KCard[][] {
  const out: KCard[][] = [];
  const byRank = new Map<number, KCard[]>();
  for (const c of cards) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  for (const group of byRank.values()) if (group.length >= 3) out.push(group);
  for (const suit of SUITS) {
    const same = cards.filter((c) => suitOf(c) === suit);
    const uniq = [...new Map(same.map((c) => [rankOf(c), c])).values()];
    for (const aceLow of [false, true]) {
      const r = (c: KCard) => (aceLow && rankOf(c) === 14 ? 1 : rankOf(c));
      const sorted = [...uniq].sort((a, b) => r(a) - r(b));
      let run: KCard[] = [];
      for (const c of sorted) {
        if (run.length && r(c) === r(run.at(-1)!) + 1) run.push(c);
        else {
          if (run.length >= 3) out.push(run);
          run = [c];
        }
      }
      if (run.length >= 3) out.push(run);
    }
  }
  return out;
}

/** A way to use this card now: a new meld with hand cards, or a lay-off. */
function useFor(s: Rummy500State, hand: KCard[], card: KCard): KCard[] | null {
  for (const m of meldsIn(hand)) if (m.some((c) => c.id === card.id)) return m;
  if (placement(s, [card])) return [card];
  return null;
}

function bot(s: Rummy500State, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const hand = s.hands[seat]!;
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  if (s.phase === "draw") {
    // Take the deepest card we can use at once, if it doesn't saddle us with too much.
    if (!sloppy)
      for (let at = 0; at < s.pile.length; at++) {
        const taken = s.pile.slice(at);
        if (taken.length > 5) continue;
        const card = taken[0]!;
        if (card.id === s.declined) continue;
        const withIt = [...hand, ...taken];
        if (useFor(s, withIt, card) && (at === s.pile.length - 1 || withIt.length > 2)) return { type: "take", card: card.id };
      }
    return s.stock.length ? { type: "draw" } : { type: "take" };
  }
  // A card owed from the pile comes first.
  if (s.mustUse) {
    const owed = hand.find((c) => c.id === s.mustUse)!;
    const use = useFor(s, hand, owed);
    if (use) return { type: "meld", cards: use.map((c) => c.id) };
    return { type: "putback" };
  }
  // Meld what we can, keeping a card to discard unless the meld takes the whole hand.
  const best = meldsIn(hand).sort((a, b) => b.length - a.length)[0];
  if (best) return { type: "meld", cards: best.map((c) => c.id) };
  for (const c of hand) if (hand.length > 1 && placement(s, [c])) return { type: "meld", cards: [c.id] };
  // Discard the card least likely to help: no partner of its rank, no near neighbour in its suit, highest value.
  const potential = (c: KCard) => hand.filter((x) => x.id !== c.id && (rankOf(x) === rankOf(c) || (suitOf(x) === suitOf(c) && Math.abs(rankOf(x) - rankOf(c)) <= 2))).length;
  const pick = sloppy ? hand[Math.floor(Math.random() * hand.length)]! : [...hand].sort((a, b) => potential(a) - potential(b) || value(b) - value(a))[0]!;
  return { type: "discard", cards: [pick.id] };
}

export const rummy500: CardGame<Rummy500Rules, Rummy500State, Move> = {
  id: "rummy500",
  name: "Rummy 500",
  emoji: "🃏",
  blurb: "Melds, lay-offs and a pile to dig into",
  tagline: "Dig into the discard pile, meld sets and runs, lay off on anyone's, and race to 500.",
  seats: { min: 2, max: 6, default: 3 },
  teams: false,
  presets: [classicRummy500, quickRummy500, strictRummy500],
  fields: [
    { key: "playTo", label: "Game to", kind: "choice", options: [[250, "250"], [500, "500"], [1000, "1,000"]] },
    { key: "topMustMeld", label: "Top card must be melded too", hint: "Any card you take from the pile, even the top one, has to go into a meld that turn.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<Rummy500Rules>;
    const base = [classicRummy500, quickRummy500, strictRummy500].find((p) => p.id === given.id) ?? classicRummy500;
    return { ...base, ...given };
  },
  validate: (r) => (r.playTo >= 50 && r.playTo <= 5000 ? [] : ["Play to between 50 and 5,000."]),
  describe(r) {
    return [
      "Thirteen cards each for two players, seven for three or more (two decks for five or six). The discard pile is spread out so every card shows.",
      `On your turn, draw from the stock, or take any card from the pile along with every card above it. A card taken from below the top has to go into a meld that turn${r.topMustMeld ? " (the top card too)" : ""}; if you change your mind, put them back.`,
      "Meld sets (three or four of a rank) and runs (three or more in a suit; ace low in A 2 3 or high in Q K A), and lay off on anyone's melds. Then discard one.",
      `Go out by melding or discarding your last card; the hand also ends when the stock runs out. You score the cards you put down (aces 15, or 1 in A 2 3; faces and tens 10; the rest face value) less what's in your hand. First to ${r.playTo} wins.`,
    ];
  },
  newGame: newRummy500,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => (s.phase === "scored" ? 1400 : s.phase === "draw" ? 1200 : thinkFor(Math.min(8, s.hands[seat]?.length ?? 1), 0.8)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "rummy500",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats(s.scores.map((n, i) => ({ seats: [i], score: n }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
