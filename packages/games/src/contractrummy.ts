// Contract Rummy: seven rounds, each with its own contract to lay down: two sets, then a set and a
// run, two runs, three sets, two sets and a run, a set and two runs, and finally three runs. A set is
// three or more of a rank; a run is four or more in a row in one suit. 2s and jokers are wild. Draw,
// lay down your contract when you have it, then lay off onto any meld on the table, and discard.
// First out ends the round; cards left count against you. Lowest total after seven rounds wins.
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
  SUITS,
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type Meld,
} from "./kit.js";

export interface ContractRules extends BaseRules {
  /** Rounds to play (the first N contracts). */
  rounds: number;
}

export const classicContract: ContractRules = { id: "contract-classic", name: "Contract Rummy (7 rounds)", rounds: 7 };
export const shortContract: ContractRules = { ...classicContract, id: "contract-short", name: "Quick (4 rounds)", rounds: 4 };

export const CONTRACTS: { sets: number; runs: number; deal: number }[] = [
  { sets: 2, runs: 0, deal: 10 },
  { sets: 1, runs: 1, deal: 10 },
  { sets: 0, runs: 2, deal: 10 },
  { sets: 3, runs: 0, deal: 10 },
  { sets: 2, runs: 1, deal: 12 },
  { sets: 1, runs: 2, deal: 12 },
  { sets: 0, runs: 3, deal: 12 },
];
export const contractLabel = (c: { sets: number; runs: number }) =>
  [c.sets ? `${c.sets === 1 ? "a" : c.sets === 2 ? "two" : "three"} set${c.sets > 1 ? "s" : ""}` : "", c.runs ? `${c.runs === 1 ? "a" : c.runs === 2 ? "two" : "three"} run${c.runs > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ");

export interface ContractMeld {
  owner: number;
  kind: "set" | "run";
  cards: KCard[];
}

export interface ContractState {
  game: "contractrummy";
  rules: ContractRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: "draw" | "play" | "scored" | "finished";
  hands: KCard[][];
  stock: KCard[];
  discard: KCard[];
  melds: ContractMeld[];
  down: boolean[];
  /** The discard just taken: it can't go straight back. */
  taken: string | null;
  /** Times the stock ran out this round: on the third, the round ends with nobody out. */
  reshuffles: number;
  turn: number;
  scores: number[];
  lastHand: { winner: number; points: number[] } | null;
  ready: boolean[];
  narration: string | null;
}

const isWild = (c: KCard) => c.kind === "joker" || (c as { rank: number }).rank === 2;
const rank = (c: KCard) => (c as { rank: number }).rank;
const suitOf = (c: KCard) => (c as { suit: Suit }).suit;
const label = (c: KCard) => (c.kind === "joker" ? "joker" : `${rankLabel(rank(c))}${SYMBOL[suitOf(c)]}`);
export const contractPoints = (c: KCard) => (c.kind === "joker" ? 50 : rank(c) === 2 ? 20 : rank(c) === 14 ? 15 : rank(c) >= 10 ? 10 : 5);

/** Three or more of a rank: at least two real cards, the rest wild. */
export function isSet(cards: KCard[]): boolean {
  const real = cards.filter((c) => !isWild(c));
  return cards.length >= 3 && real.length >= 2 && real.every((c) => rank(c) === rank(real[0]!));
}

/** Four or more in a row in one suit (ace high or low), wilds filling gaps: at least two real cards. */
export function isRun(cards: KCard[]): boolean {
  if (cards.length < 4 || cards.length > 14) return false;
  const real = cards.filter((c) => !isWild(c));
  if (real.length < 2 || !real.every((c) => suitOf(c) === suitOf(real[0]!))) return false;
  // The run's cards cover some stretch a … a+len−1 inside A(1)…A(14) that holds every real card.
  const fits = (ranks: number[]) => {
    if (new Set(ranks).size !== ranks.length) return false;
    const lo = Math.min(...ranks);
    const hi = Math.max(...ranks);
    return Math.max(1, hi - cards.length + 1) <= Math.min(lo, 15 - cards.length);
  };
  const high = real.map(rank);
  const low = real.map((c) => (rank(c) === 14 ? 1 : rank(c)));
  return fits(high) || fits(low);
}

/** Can these cards be split into exactly `sets` sets and `runs` runs, using every card? */
export function splitContract(cards: KCard[], sets: number, runs: number): KCard[][] | null {
  const groups: { kind: "set" | "run"; cards: KCard[] }[] = [...Array(sets).fill(0).map(() => ({ kind: "set" as const, cards: [] as KCard[] })), ...Array(runs).fill(0).map(() => ({ kind: "run" as const, cards: [] as KCard[] }))];
  // Real cards first (they constrain the groups), wilds last.
  const order = [...cards].sort((a, b) => Number(isWild(a)) - Number(isWild(b)) || rank(a) - rank(b));
  const okSoFar = (g: { kind: "set" | "run"; cards: KCard[] }) => {
    const real = g.cards.filter((c) => !isWild(c));
    if (g.kind === "set") return real.every((c) => rank(c) === rank(real[0]!));
    return real.every((c) => suitOf(c) === suitOf(real[0]!)) && new Set(real.map(rank)).size === real.length;
  };
  const go = (i: number): boolean => {
    if (i === order.length) return groups.every((g) => (g.kind === "set" ? isSet(g.cards) : isRun(g.cards)));
    const seen = new Set<string>();
    for (const g of groups) {
      // Empty groups of a kind are interchangeable: try only the first.
      const key = g.cards.length ? "" : `empty-${g.kind}`;
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      g.cards.push(order[i]!);
      if (okSoFar(g) && go(i + 1)) return true;
      g.cards.pop();
    }
    return false;
  };
  return go(0) ? groups.map((g) => g.cards) : null;
}

/** Sort a run's cards into order for showing, wilds in the gaps. */
function arrangeRun(cards: KCard[]): KCard[] {
  const real = cards.filter((c) => !isWild(c));
  const wild = cards.filter(isWild);
  const lowAce = real.some((c) => rank(c) === 14) && real.some((c) => rank(c) <= 5);
  const v = (c: KCard) => (lowAce && rank(c) === 14 ? 1 : rank(c));
  const sorted = [...real].sort((a, b) => v(a) - v(b));
  const out: KCard[] = [];
  for (let k = 0; k < sorted.length; k++) {
    out.push(sorted[k]!);
    const gap = k + 1 < sorted.length ? v(sorted[k + 1]!) - v(sorted[k]!) - 1 : 0;
    for (let g = 0; g < gap; g++) out.push(wild.pop()!);
  }
  // Leftover wilds go on the end (or the front if the top is an ace).
  while (wild.length) {
    if (v(out.at(-1)!) >= 14) out.unshift(wild.pop()!);
    else out.push(wild.pop()!);
  }
  return out;
}

function deal(s: ContractState) {
  const c = CONTRACTS[s.hand]!;
  const decks = s.seats <= 4 ? 2 : 3;
  const deck = shuffled(makeDeck({ ranks: FULL, copies: decks, jokers: 2 }), nextRandom(s));
  s.hands = Array.from({ length: s.seats }, (_, i) => sortCards(deck.slice(i * c.deal, (i + 1) * c.deal)));
  s.discard = [deck[s.seats * c.deal]!];
  s.stock = deck.slice(s.seats * c.deal + 1);
  s.melds = [];
  s.down = Array(s.seats).fill(false);
  s.taken = null;
  s.reshuffles = 0;
  s.turn = (s.dealer + 1) % s.seats;
  s.phase = "draw";
  s.ready = Array(s.seats).fill(false);
  s.narration = `Round ${s.hand + 1}: ${contractLabel(c)}`;
}

export function newContractRummy(rules: ContractRules, seats: number, seed: number): ContractState {
  const s = { game: "contractrummy", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, scores: Array(seats).fill(0), lastHand: null } as unknown as ContractState;
  deal(s);
  return s;
}

/** Which table meld a card can be laid off on (the first that takes it). */
export function layOffTarget(s: ContractState, card: KCard): number {
  return s.melds.findIndex((m) => (m.kind === "set" ? isSet([...m.cards, card]) : isRun([...m.cards, card])));
}

function refill(s: ContractState) {
  if (s.stock.length || s.discard.length <= 1) return;
  s.reshuffles += 1;
  const top = s.discard.pop()!;
  s.stock = shuffled(s.discard, nextRandom(s));
  s.discard = [top];
}

function endRound(s: ContractState, winner: number | null) {
  const points = s.hands.map((h) => h.reduce((n, c) => n + contractPoints(c), 0));
  s.scores = s.scores.map((n, i) => n + points[i]!);
  s.lastHand = { winner: winner ?? -1, points };
  s.narration = winner === null ? "The stock ran out three times: the round ends with everyone counting their cards" : `${who(winner)} went out!`;
  s.ready = Array(s.seats).fill(false);
  s.phase = s.hand + 1 >= Math.min(s.rules.rounds, CONTRACTS.length) ? "finished" : "scored";
}

type Move = { type: "draw" } | { type: "take" } | { type: "layDown"; cards: string[] } | { type: "layOff"; cards: string[] } | { type: "discard"; cards: string[] } | { type: "next" };

function apply(state: ContractState, seat: number, move: Move): ContractState {
  const s = clone(state);
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The round isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = (s.dealer + 1) % s.seats;
      deal(s);
    }
    return s;
  }
  if ((s.phase !== "draw" && s.phase !== "play") || s.turn !== seat) throw new GameError("It's not your turn.");
  const hand = s.hands[seat]!;
  const picked = (ids: unknown): KCard[] => {
    if (!Array.isArray(ids) || !ids.length) throw new GameError("Pick some cards first.");
    const cards = ids.map((id) => hand.find((c) => c.id === id));
    if (cards.some((c) => !c) || new Set(ids).size !== ids.length) throw new GameError("You don't have those cards.");
    return cards as KCard[];
  };
  switch (move.type) {
    case "draw":
    case "take": {
      if (s.phase !== "draw") throw new GameError("You've drawn already.");
      let card: KCard | undefined;
      if (move.type === "take") card = s.discard.pop();
      else {
        refill(s);
        if (s.reshuffles >= 3) {
          endRound(s, null);
          return s;
        }
        card = s.stock.pop();
      }
      s.taken = move.type === "take" && card ? card.id : null;
      if (!card) throw new GameError(move.type === "take" ? "There's no discard to take." : "The stock is empty.");
      s.hands[seat] = sortCards([...hand, card]);
      s.phase = "play";
      s.narration = move.type === "take" ? `${who(seat)} took the ${label(card)}` : `${who(seat)} drew a card`;
      return s;
    }
    case "layDown": {
      if (s.phase !== "play") throw new GameError("Draw first.");
      if (s.down[seat]) throw new GameError("You've laid down your contract already.");
      const cards = picked(move.cards);
      const c = CONTRACTS[s.hand]!;
      const split = splitContract(cards, c.sets, c.runs);
      if (!split) throw new GameError(`Those don't make ${contractLabel(c)}. Sets: 3+ of a rank; runs: 4+ in a row in one suit; 2s and jokers are wild.`);
      split.forEach((g, k) => s.melds.push({ owner: seat, kind: k < c.sets ? "set" : "run", cards: k < c.sets ? g : arrangeRun(g) }));
      s.hands[seat] = hand.filter((x) => !cards.includes(x));
      s.down[seat] = true;
      s.narration = `${who(seat)} laid down ${contractLabel(c)}!`;
      if (!s.hands[seat]!.length) endRound(s, seat);
      return s;
    }
    case "layOff": {
      if (s.phase !== "play") throw new GameError("Draw first.");
      if (!s.down[seat]) throw new GameError("Lay down your contract before laying off.");
      const cards = picked(move.cards);
      for (const card of cards) {
        const target = layOffTarget(s, card);
        if (target < 0) throw new GameError(`The ${label(card)} doesn't fit on any meld.`);
        const m = s.melds[target]!;
        m.cards = m.kind === "run" ? arrangeRun([...m.cards, card]) : [...m.cards, card];
        s.hands[seat] = s.hands[seat]!.filter((x) => x.id !== card.id);
      }
      s.narration = `${who(seat)} laid off ${cards.length === 1 ? `the ${label(cards[0]!)}` : `${cards.length} cards`}`;
      if (!s.hands[seat]!.length) endRound(s, seat);
      return s;
    }
    case "discard": {
      if (s.phase !== "play") throw new GameError("Draw first.");
      const cards = picked(move.cards);
      if (cards.length !== 1) throw new GameError("Discard one card.");
      if (cards[0]!.id === s.taken && hand.length > 1) throw new GameError("You can't throw back the card you just took.");
      s.hands[seat] = hand.filter((x) => x.id !== cards[0]!.id);
      s.discard.push(cards[0]!);
      s.narration = `${who(seat)} discarded the ${label(cards[0]!)}`;
      if (!s.hands[seat]!.length) {
        endRound(s, seat);
        return s;
      }
      s.turn = (seat + 1) % s.seats;
      s.phase = "draw";
      return s;
    }
    default:
      throw new GameError("That's not a move in Contract Rummy.");
  }
}

function view(s: ContractState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.turn === seat && (s.phase === "draw" || s.phase === "play");
  const c = CONTRACTS[s.hand]!;
  const hand = s.hands[seat]!;
  const actions = mine && s.phase === "play"
    ? [
        ...(s.down[seat] ? [{ label: "Lay off", type: "layOff" }] : [{ label: `Lay down ${contractLabel(c)}`, type: "layDown" }]),
        { label: "Discard", type: "discard", primary: true },
      ]
    : [];
  const melds: Meld[] = s.melds.map((m) => ({ owner: m.owner, label: m.kind === "set" ? "Set" : "Run", cards: m.cards }));
  return {
    game: "contractrummy",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "draw" || s.phase === "play" ? s.turn : null,
    dealer: s.dealer,
    hand,
    tap: null,
    pick: actions.length ? { min: 1, max: hand.length, prompt: s.down[seat] ? "Pick cards to lay off, or one to discard" : `Pick the cards for ${contractLabel(c)}, or one to discard`, cards: hand.map((x) => x.id), actions } : null,
    choices: s.phase === "scored" && !s.ready[seat] ? { prompt: "", options: [{ label: "Deal the next round", move: { type: "next" }, primary: true }] } : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: s.down[i] ? "Down ✓" : "", dealer: i === s.dealer })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.discard.slice(-3),
      discardCount: s.discard.length,
      drawMove: mine && s.phase === "draw" ? { type: "draw" } : null,
      takeMove: mine && s.phase === "draw" && s.discard.length ? { type: "take" } : null,
    },
    melds,
    info: [`Round ${s.hand + 1} of ${Math.min(s.rules.rounds, CONTRACTS.length)}: ${contractLabel(c)}`, "Sets 3+ of a rank · runs 4+ in a suit · 2s and jokers wild"],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result: s.lastHand && (s.phase === "scored" || over) ? { key: `contract-${s.hand}`, title: s.lastHand.winner < 0 ? "Nobody went out" : `${who(s.lastHand.winner)} went out`, sides: s.scores.map((_, i) => [i]), rows: [{ label: "This round", values: s.lastHand.points.map(String) }, { label: "Total", values: s.scores.map(String), tone: "total" as const }] } : null,
    over: over ? { winners: winners(s), title: `${who(winners(s)[0]!)} wins with ${Math.min(...s.scores)}` } : null,
  };
}

function winners(s: ContractState): number[] {
  const best = Math.min(...s.scores);
  return s.scores.flatMap((n, i) => (n === best ? [i] : []));
}

// ---- Computer players --------------------------------------------------------------------------

/** Find cards in a hand that make the contract, or null. */
export function findContract(hand: KCard[], sets: number, runs: number): KCard[] | null {
  const wilds = hand.filter(isWild);
  const real = hand.filter((c) => !isWild(c));
  type Cand = { kind: "set" | "run"; real: KCard[]; wild: number };
  const cands: Cand[] = [];
  if (sets) {
    const byRank = new Map<number, KCard[]>();
    for (const c of real) byRank.set(rank(c), [...(byRank.get(rank(c)) ?? []), c]);
    for (const cs of byRank.values()) if (cs.length >= 2) cands.push({ kind: "set", real: cs, wild: Math.max(0, 3 - cs.length) });
  }
  if (runs) {
    for (const suit of SUITS) {
      const mine = real.filter((c) => suitOf(c) === suit);
      for (let start = 1; start <= 11; start++) {
        const used: KCard[] = [];
        let gaps = 0;
        for (let v = start; v < start + 4; v++) {
          const c = mine.find((x) => (v === 1 || v === 14 ? rank(x) === 14 : rank(x) === v) && !used.includes(x));
          if (c) used.push(c);
          else gaps++;
        }
        if (used.length >= 2 && gaps <= 2) cands.push({ kind: "run", real: used, wild: gaps });
      }
    }
  }
  cands.sort((a, b) => a.wild - b.wild);
  const pick = (needSets: number, needRuns: number, usedIds: Set<string>, wildLeft: number, acc: KCard[]): KCard[] | null => {
    if (!needSets && !needRuns) return acc;
    for (const c of cands) {
      if ((c.kind === "set" && !needSets) || (c.kind === "run" && !needRuns)) continue;
      if (c.wild > wildLeft || c.real.some((x) => usedIds.has(x.id))) continue;
      const next = new Set(usedIds);
      c.real.forEach((x) => next.add(x.id));
      const got = pick(needSets - (c.kind === "set" ? 1 : 0), needRuns - (c.kind === "run" ? 1 : 0), next, wildLeft - c.wild, [...acc, ...c.real, ...wilds.slice(wilds.length - wildLeft, wilds.length - wildLeft + c.wild)]);
      if (got) return got;
    }
    return null;
  };
  const found = pick(sets, runs, new Set(), wilds.length, []);
  return found && splitContract(found, sets, runs) ? found : null;
}

function bot(s: ContractState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const hand = s.hands[seat]!;
  const c = CONTRACTS[s.hand]!;
  if (s.phase === "draw") {
    const top = s.discard.at(-1);
    if (top) {
      const useful = isWild(top) || (s.down[seat] ? layOffTarget(s, top) >= 0 : (c.sets && hand.filter((x) => !isWild(x) && rank(x) === rank(top)).length >= 2) || (c.runs && hand.filter((x) => !isWild(x) && suitOf(x) === suitOf(top) && Math.abs(rank(x) - rank(top)) === 1).length >= 2));
      if (useful && Math.random() > (style.sloppy ?? 0)) return { type: "take" };
    }
    if (!s.stock.length && s.discard.length <= 1 && top) return { type: "take" };
    return { type: "draw" };
  }
  if (s.phase !== "play") return null;
  if (!s.down[seat]) {
    const found = findContract(hand, c.sets, c.runs);
    if (found) return { type: "layDown", cards: found.map((x) => x.id) };
  } else {
    const off = hand.find((x) => layOffTarget(s, x) >= 0);
    if (off) return { type: "layOff", cards: [off.id] };
  }
  // Discard: the card that helps least, highest points first. Keep wilds.
  const worth = (x: KCard) => {
    if (isWild(x)) return 1000;
    const same = hand.filter((y) => y.id !== x.id && !isWild(y) && rank(y) === rank(x)).length;
    const near = hand.filter((y) => y.id !== x.id && !isWild(y) && suitOf(y) === suitOf(x) && Math.abs(rank(y) - rank(x)) <= 2).length;
    return (c.sets ? same * 10 : 0) + (c.runs ? near * 6 : 0) - contractPoints(x) / 5;
  };
  const throwable = hand.filter((x) => x.id !== s.taken);
  return { type: "discard", cards: [[...(throwable.length ? throwable : hand)].sort((a, b) => worth(a) - worth(b))[0]!.id] };
}

export const contractRummy: CardGame<ContractRules, ContractState, Move> = {
  id: "contractrummy",
  name: "Contract Rummy",
  emoji: "📜",
  blurb: "Seven rounds, seven contracts to lay down",
  tagline: "Each round has a contract: sets, runs, or both. Lay it down, lay off the rest, and go out first.",
  seats: { min: 3, max: 8, default: 4 },
  teams: false,
  presets: [classicContract, shortContract],
  fields: [{ key: "rounds", label: "Rounds", kind: "choice", options: [[4, "4 (quick)"], [7, "All 7"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<ContractRules>;
    const base = [classicContract, shortContract].find((p) => p.id === given.id) ?? classicContract;
    const r = { ...base, ...given };
    return { ...r, rounds: Math.min(7, Math.max(1, Number(r.rounds) || 7)) };
  },
  validate: () => [],
  describe(r) {
    return [
      `${Math.min(7, r.rounds)} rounds, each with a contract: ${CONTRACTS.slice(0, r.rounds).map(contractLabel).join("; ")}. Ten cards for the first rounds, twelve later on.`,
      "A set is three or more of a rank. A run is four or more in a row in one suit (aces high or low). 2s and jokers are wild; a meld needs at least two real cards.",
      "On your turn draw from the stock or take the top discard. Once you hold the contract, pick its cards and lay them down. After that, lay off cards onto any meld on the table.",
      "End your turn with a discard. First to get rid of every card ends the round.",
      "Cards left count against you: 3–9 are 5, 10s to kings 10, aces 15, 2s 20, jokers 50. Lowest total wins.",
    ];
  },
  newGame: newContractRummy,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => (s.phase === "scored" ? 900 : s.phase === "draw" ? 1000 : thinkFor(s.hands[seat]!.length, 0.7)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "contractrummy",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats(s.scores.map((score, i) => ({ seats: [i], score })), true) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
