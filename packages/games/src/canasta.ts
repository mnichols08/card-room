// Partnership Canasta: two decks and four jokers, partners across. Meld three or more of a rank
// (twos and jokers are wild), build them up to seven for a canasta, and take the discard pile when
// you can use its top card. Red threes are bonuses; black threes block the pile. Your side needs a
// canasta to go out. First side to the target wins.
import type { PlayStyle } from "@spades/rules";
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
  teamOfSeat,
  thinkFor,
  who,
  careless,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type Meld,
  type PipCard,
} from "./kit.js";

export interface CanastaRules extends BaseRules {
  playTo: number;
  /** Draw two from the stock instead of one (the modern way). */
  drawTwo: boolean;
  /** A side's first melds must be worth 50 (more as the score grows); off: any meld opens. */
  minimums: boolean;
}

export const classicCanasta: CanastaRules = { id: "canasta-classic", name: "Classic Canasta", playTo: 5000, drawTwo: false, minimums: true };
export const modernCanasta: CanastaRules = { ...classicCanasta, id: "canasta-modern", name: "Draw two", drawTwo: true };
export const easyCanasta: CanastaRules = { ...classicCanasta, id: "canasta-easy", name: "Easygoing (no minimums, to 3,000)", playTo: 3000, minimums: false };

type Phase = "draw" | "meld" | "scored" | "finished";
type Team = 0 | 1;

export interface TeamMeld {
  rank: number;
  cards: KCard[];
}

export interface CanastaState {
  game: "canasta";
  rules: CanastaRules;
  seats: 4;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  stock: KCard[];
  pile: KCard[];
  melds: [TeamMeld[], TeamMeld[]];
  red3s: [KCard[], KCard[]];
  opened: [boolean, boolean];
  /** Cards laid this turn by a side that hasn't opened yet (they can still be taken back). */
  laid: string[];
  /** This turn's opening was taken back: don't try it again before discarding. */
  tookBack: boolean;
  turn: number;
  scores: [number, number];
  lastHand: { wentOut: number | null; rows: Record<string, [number, number]> } | null;
  ready: boolean[];
  narration: string | null;
}

// ---- Cards --------------------------------------------------------------------------------------

const pip = (c: KCard) => c as PipCard;
export const isWild = (c: KCard) => c.kind === "joker" || pip(c).rank === 2;
const isThree = (c: KCard) => c.kind === "pip" && pip(c).rank === 3;
export const isRedThree = (c: KCard) => isThree(c) && (pip(c).suit === "hearts" || pip(c).suit === "diamonds");
const isBlackThree = (c: KCard) => isThree(c) && !isRedThree(c);
const rankOf = (c: KCard) => (c.kind === "joker" ? 0 : pip(c).rank);
/** What a card counts in a meld (and against you, left in your hand). */
export function canastaValue(c: KCard): number {
  if (c.kind === "joker") return 50;
  const r = pip(c).rank;
  if (r === 2 || r === 14) return 20;
  if (r >= 8) return 10;
  return 5;
}
const total = (cards: KCard[]) => cards.reduce((n, c) => n + canastaValue(c), 0);
const rankName = (r: number) => (r === 14 ? "Aces" : r === 13 ? "Kings" : r === 12 ? "Queens" : r === 11 ? "Jacks" : `${rankLabel(r)}s`);
const wildsIn = (m: TeamMeld) => m.cards.filter(isWild).length;
export const isCanasta = (m: TeamMeld) => m.cards.length >= 7;
const natural = (m: TeamMeld) => wildsIn(m) === 0;
const sortHand = (cards: KCard[]) =>
  [...cards].sort((a, b) => key(a) - key(b));
const key = (c: KCard) => (c.kind === "joker" ? 1000 : pip(c).rank === 2 ? 900 : pip(c).rank * 10 + SUITS.indexOf(pip(c).suit));

/** The opening minimum for a side with this score. */
export function openingNeed(rules: CanastaRules, score: number): number {
  if (!rules.minimums) return 0;
  return score < 0 ? 15 : score < 1500 ? 50 : score < 3000 ? 90 : 120;
}

// ---- Dealing ------------------------------------------------------------------------------------

/** Lay out any red threes in this hand and draw replacements (which may be red threes too). */
function layRedThrees(s: CanastaState, seat: number) {
  const team = teamOfSeat(seat);
  for (let guard = 0; guard < 10; guard++) {
    const reds = s.hands[seat]!.filter(isRedThree);
    if (!reds.length) return;
    s.hands[seat] = s.hands[seat]!.filter((c) => !isRedThree(c));
    s.red3s[team].push(...reds);
    for (let i = 0; i < reds.length && s.stock.length; i++) s.hands[seat]!.push(s.stock.pop()!);
  }
}

function deal(s: CanastaState) {
  const rand = nextRandom(s);
  const deck = shuffled(makeDeck({ ranks: FULL, copies: 2, jokers: 2 }), rand);
  s.hands = [0, 1, 2, 3].map((i) => deck.slice(i * 11, i * 11 + 11));
  s.stock = deck.slice(44);
  s.melds = [[], []];
  s.red3s = [[], []];
  s.opened = [false, false];
  s.laid = [];
  s.tookBack = false;
  for (let seat = 0; seat < 4; seat++) layRedThrees(s, seat);
  for (let seat = 0; seat < 4; seat++) s.hands[seat] = sortHand(s.hands[seat]!);
  // Turn up the first discard; keep going past wild cards and threes (a red three goes back in the stock).
  s.pile = [];
  for (let guard = 0; guard < 20; guard++) {
    const top = s.stock.pop()!;
    if (isRedThree(top)) {
      s.stock.unshift(top);
      continue;
    }
    s.pile.push(top);
    if (!isWild(top) && !isThree(top)) break;
  }
  s.ready = [false, false, false, false];
  s.phase = "draw";
  s.turn = (s.dealer + 1) % 4;
  s.narration = null;
}

export function newCanasta(rules: CanastaRules, _seats: number, seed: number): CanastaState {
  const s = { game: "canasta", rules, seats: 4, rng: seed >>> 0, hand: 0, dealer: seed % 4, scores: [0, 0], lastHand: null } as unknown as CanastaState;
  deal(s);
  return s;
}

// ---- Melding ------------------------------------------------------------------------------------

interface Group {
  rank: number;
  naturals: KCard[];
  wilds: KCard[];
  /** Index of the side's meld this goes on, or -1 for a new meld. */
  onto: number;
}

/** The side would have a canasta once these groups are down. */
function canastaAfter(melds: TeamMeld[], groups: Group[]): boolean {
  if (melds.some(isCanasta)) return true;
  return groups.some((g) => (g.onto >= 0 ? melds[g.onto]!.cards.length : 0) + g.naturals.length + g.wilds.length >= 7);
}

/** Check a set of groups against the side's melds; returns a problem, or null. */
function groupProblem(melds: TeamMeld[], groups: Group[]): string | null {
  for (const g of groups) {
    const existing = g.onto >= 0 ? melds[g.onto]! : null;
    const naturals = g.naturals.length + (existing ? existing.cards.length - wildsIn(existing) : 0);
    const wilds = g.wilds.length + (existing ? wildsIn(existing) : 0);
    if (naturals < 2) return `A meld needs at least two natural ${rankName(g.rank).toLowerCase()}.`;
    if (naturals + wilds < 3) return "A meld is three cards or more.";
    if (wilds > 3) return "A meld can have three wild cards at most.";
  }
  return null;
}

/** How the chosen cards would go down, or why they can't. */
export function meldPlan(s: CanastaState, seat: number, ids: string[]): { groups: Group[] } | { error: string } {
  const team = teamOfSeat(seat);
  const hand = s.hands[seat]!;
  const cards = ids.map((id) => hand.find((c) => c.id === id));
  if (!cards.length || cards.some((c) => !c)) return { error: "Pick cards from your hand to meld." };
  if (new Set(ids).size !== ids.length) return { error: "Pick each card once." };
  const chosen = cards as KCard[];
  const wilds = chosen.filter(isWild);
  const byRank = new Map<number, KCard[]>();
  for (const c of chosen.filter((c) => !isWild(c))) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  if (byRank.size > 1 && wilds.length) return { error: "Meld wild cards with one rank at a time." };
  const melds = s.melds[team];
  const groups: Group[] = [];
  if (!byRank.size) {
    // Only wild cards: they go on the side's meld with the most cards that has room.
    const room = melds
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => m.rank !== 3 && wildsIn(m) + wilds.length <= 3)
      .sort((a, b) => Number(isCanasta(a.m)) - Number(isCanasta(b.m)) || b.m.cards.length - a.m.cards.length)[0];
    if (!room) return { error: melds.length ? "No meld has room for that many wild cards (three at most)." : "Wild cards need natural cards to meld with." };
    groups.push({ rank: room.m.rank, naturals: [], wilds, onto: room.i });
  } else {
    for (const [rank, naturals] of byRank) groups.push({ rank, naturals, wilds: byRank.size === 1 ? wilds : [], onto: melds.findIndex((m) => m.rank === rank) });
  }
  if (groups.some((g) => g.rank === 3)) {
    if (chosen.some(isRedThree)) return { error: "Red threes go down by themselves." };
    if (groups.some((g) => g.rank === 3 && g.wilds.length)) return { error: "Black threes can't meld with wild cards." };
    if (hand.length - chosen.length > 1) return { error: "Black threes only meld when you're going out." };
  }
  const problem = groupProblem(melds, groups);
  if (problem) return { error: problem };
  const left = hand.length - chosen.length;
  if (left <= 1 && !canastaAfter(melds, groups)) return { error: left === 0 ? "Your side needs a canasta before you can go out." : "That leaves one card to discard and go out, and your side has no canasta yet." };
  return { groups };
}

function layGroups(s: CanastaState, seat: number, groups: Group[]) {
  const team = teamOfSeat(seat);
  const used = new Set(groups.flatMap((g) => [...g.naturals, ...g.wilds].map((c) => c.id)));
  s.hands[seat] = s.hands[seat]!.filter((c) => !used.has(c.id));
  for (const g of groups) {
    const cards = [...g.naturals, ...g.wilds];
    if (g.onto >= 0) s.melds[team][g.onto]!.cards.push(...cards);
    else s.melds[team].push({ rank: g.rank, cards });
  }
  for (const m of s.melds[team]) m.cards = [...m.cards.filter((c) => !isWild(c)), ...m.cards.filter(isWild)];
}

/** Whether the top of the pile can be taken, and how. */
export function takePlan(s: CanastaState, seat: number): { groups: Group[] } | { error: string } {
  const team = teamOfSeat(seat);
  const top = s.pile.at(-1);
  if (!top) return { error: "The pile is empty." };
  if (isWild(top)) return { error: "You can't take a wild card off the pile." };
  if (isBlackThree(top)) return { error: "A black three blocks the pile: draw instead." };
  const rank = rankOf(top);
  const hand = s.hands[seat]!;
  const naturals = hand.filter((c) => !isWild(c) && rankOf(c) === rank);
  const wilds = hand.filter(isWild);
  const frozen = s.pile.some(isWild) || !s.opened[team];
  const melds = s.melds[team];
  const onto = melds.findIndex((m) => m.rank === rank);
  const name = rankName(rank).toLowerCase();
  let groups: Group[];
  // The top card is part of the first group (counted as a natural it brings).
  if (!frozen && onto >= 0) groups = [{ rank, naturals: [top], wilds: [], onto }];
  else if (naturals.length >= 2) groups = [{ rank, naturals: [top, ...naturals], wilds: [], onto }];
  else if (!frozen && naturals.length === 1 && wilds.length) groups = [{ rank, naturals: [top, naturals[0]!], wilds: [wilds[0]!], onto }];
  else return { error: frozen ? `The pile is frozen: you need two ${name} in your hand to take it.` : `You need two ${name}, or one and a wild card, to take the pile.` };
  if (!s.opened[team]) {
    const need = openingNeed(s.rules, s.scores[team]);
    const worth = () => groups.reduce((n, g) => n + total(g.naturals) + total(g.wilds), 0);
    // Not enough to open? Add wild cards to it, then any other melds in the hand.
    const spare = wilds.filter((w) => !groups[0]!.wilds.includes(w));
    while (worth() < need && spare.length && groups[0]!.wilds.length < 3) groups[0]!.wilds.push(spare.shift()!);
    const others = new Map<number, KCard[]>();
    for (const c of hand) if (!isWild(c) && !isThree(c) && rankOf(c) !== rank) others.set(rankOf(c), [...(others.get(rankOf(c)) ?? []), c]);
    for (const [r, cards] of [...others].sort((a, b) => total(b[1]) - total(a[1]))) {
      if (worth() >= need) break;
      if (cards.length >= 3) groups.push({ rank: r, naturals: cards, wilds: [], onto: -1 });
    }
    if (worth() < need) return { error: `To open your side needs ${need}: taking the pile only makes ${worth()}.` };
  }
  const problem = groupProblem(melds, groups);
  if (problem) return { error: problem };
  // You need cards left to play on (one to discard, and one more unless you can go out).
  const fromHand = groups.reduce((n, g) => n + g.naturals.length + g.wilds.length, 0) - 1;
  const left = hand.length - fromHand + s.pile.length - 1;
  if (left < 2 && !canastaAfter(melds, groups)) return { error: "Taking the pile would leave you too few cards to play on." };
  return { groups };
}

// ---- Moves --------------------------------------------------------------------------------------

type Move = { type: "draw" } | { type: "take" } | { type: "meld"; cards: string[] } | { type: "discard"; cards?: string[]; card?: string } | { type: "takeback" } | { type: "next" };

function laidWorth(s: CanastaState, team: Team): number {
  return total(s.melds[team].flatMap((m) => m.cards).filter((c) => s.laid.includes(c.id)));
}

function apply(state: CanastaState, seat: number, move: Move): CanastaState {
  const s = clone(state);
  const team = teamOfSeat(seat);
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The hand isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = (s.dealer + 1) % 4;
      deal(s);
    }
    return s;
  }
  if (s.turn !== seat || (s.phase !== "draw" && s.phase !== "meld")) throw new GameError("It's not your turn.");
  switch (move.type) {
    case "draw": {
      if (s.phase !== "draw") throw new GameError("You've already drawn.");
      if (!s.stock.length) {
        s.narration = "The stock ran out.";
        scoreHand(s, null);
        return s;
      }
      const n = s.rules.drawTwo ? 2 : 1;
      for (let i = 0; i < n && s.stock.length; i++) s.hands[seat]!.push(s.stock.pop()!);
      const reds = s.red3s[team].length;
      layRedThrees(s, seat);
      s.hands[seat] = sortHand(s.hands[seat]!);
      s.phase = "meld";
      s.narration = s.red3s[team].length > reds ? `${who(seat)} drew a red three` : null;
      return s;
    }
    case "take": {
      if (s.phase !== "draw") throw new GameError("You've already drawn.");
      const plan = takePlan(s, seat);
      if ("error" in plan) throw new GameError(plan.error);
      const top = s.pile.pop()!;
      const pile = s.pile;
      s.pile = [];
      // The top card isn't in the hand: lay it with the rest.
      s.hands[seat]!.push(top);
      layGroups(s, seat, plan.groups);
      s.red3s[team].push(...pile.filter(isRedThree));
      s.hands[seat] = sortHand([...s.hands[seat]!, ...pile.filter((c) => !isRedThree(c))]);
      s.opened[team] = true;
      s.laid = [];
      s.phase = "meld";
      s.narration = `${who(seat)} took the pile (${pile.length + 1} cards)`;
      if (!s.hands[seat]!.length) goOut(s, seat);
      return s;
    }
    case "meld": {
      if (s.phase !== "meld") throw new GameError("Draw first: tap the stock, or the pile to take it.");
      const plan = meldPlan(s, seat, move.cards ?? []);
      if ("error" in plan) throw new GameError(plan.error);
      if (!s.opened[team]) s.laid.push(...(move.cards ?? []));
      layGroups(s, seat, plan.groups);
      s.narration = null;
      if (!s.hands[seat]!.length) {
        const need = openingNeed(s.rules, s.scores[team]);
        if (!s.opened[team] && laidWorth(s, team) < need) throw new GameError(`Your side's first melds need ${need} to go out on.`);
        goOut(s, seat);
      }
      return s;
    }
    case "takeback": {
      if (s.phase !== "meld" || s.opened[team] || !s.laid.length) throw new GameError("There's nothing to take back.");
      const back = s.melds[team].flatMap((m) => m.cards).filter((c) => s.laid.includes(c.id));
      for (const m of s.melds[team]) m.cards = m.cards.filter((c) => !s.laid.includes(c.id));
      s.melds[team] = s.melds[team].filter((m) => m.cards.length);
      s.hands[seat] = sortHand([...s.hands[seat]!, ...back]);
      s.laid = [];
      s.tookBack = true;
      return s;
    }
    case "discard": {
      if (s.phase !== "meld") throw new GameError("Draw first: tap the stock, or the pile to take it.");
      const ids = move.cards ?? (move.card ? [move.card] : []);
      if (ids.length !== 1) throw new GameError("Pick one card to discard.");
      const card = s.hands[seat]!.find((c) => c.id === ids[0]);
      if (!card) throw new GameError("You don't have that card.");
      if (!s.opened[team] && s.laid.length) {
        const need = openingNeed(s.rules, s.scores[team]);
        const worth = laidWorth(s, team);
        if (worth < need) throw new GameError(`Your side's first melds need ${need}, and these make ${worth}. Meld more, or take them back.`);
        s.opened[team] = true;
      }
      if (s.hands[seat]!.length === 1 && !s.melds[team].some(isCanasta)) throw new GameError("Your side needs a canasta before you can go out.");
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.pile.push(card);
      s.laid = [];
      s.tookBack = false;
      s.narration = isWild(card) ? `${who(seat)} froze the pile` : null;
      if (!s.hands[seat]!.length) {
        goOut(s, seat);
        return s;
      }
      s.turn = (seat + 1) % 4;
      s.phase = "draw";
      return s;
    }
    default:
      throw new GameError("That's not a move in Canasta.");
  }
}

function goOut(s: CanastaState, seat: number) {
  const team = teamOfSeat(seat);
  if (!s.opened[team] && s.laid.length) s.opened[team] = true;
  s.narration = `${who(seat)} went out!`;
  scoreHand(s, seat);
}

function scoreHand(s: CanastaState, wentOut: number | null) {
  const rows: Record<string, [number, number]> = { Canastas: [0, 0], "Red threes": [0, 0], "Going out": [0, 0], "Melded cards": [0, 0], "Left in hand": [0, 0] };
  for (const t of [0, 1] as const) {
    const melds = s.melds[t];
    rows.Canastas![t] = melds.filter(isCanasta).reduce((n, m) => n + (natural(m) ? 500 : 300), 0);
    const reds = s.red3s[t].length === 4 ? 800 : s.red3s[t].length * 100;
    rows["Red threes"]![t] = melds.length ? reds : -reds;
    rows["Going out"]![t] = wentOut !== null && teamOfSeat(wentOut) === t ? 100 : 0;
    rows["Melded cards"]![t] = total(melds.flatMap((m) => m.cards));
    rows["Left in hand"]![t] = -total([...s.hands[t]!, ...s.hands[t + 2]!]);
  }
  const hand: [number, number] = [0, 1].map((t) => Object.values(rows).reduce((n, r) => n + r[t]!, 0)) as [number, number];
  s.scores = [s.scores[0] + hand[0], s.scores[1] + hand[1]];
  s.lastHand = { wentOut, rows: { ...rows, "This hand": hand } };
  s.ready = [false, false, false, false];
  s.phase = s.scores.some((n) => n >= s.rules.playTo) ? "finished" : "scored";
}

const winner = (s: CanastaState): Team => (s.scores[0] >= s.scores[1] ? 0 : 1);

// ---- What each player sees ---------------------------------------------------------------------

function meldsView(s: CanastaState): Meld[] {
  const out: Meld[] = [];
  for (const t of [0, 1] as const) {
    for (const m of [...s.melds[t]].sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank)) {
      const done = isCanasta(m);
      const wild = wildsIn(m);
      out.push({
        owner: t,
        byTeam: true,
        label: done ? `${rankName(m.rank)} ✓ ${natural(m) ? "natural" : "mixed"} canasta` : `${rankName(m.rank)} ×${m.cards.length}${wild ? ` (${wild} wild)` : ""}`,
        // Squared up, as at a real table: a canasta shows its top card; a meld, three at most.
        cards: done ? [m.cards[0]!] : m.cards.length <= 3 ? m.cards : [m.cards[0]!, m.cards[1]!, m.cards.at(-1)!],
      });
    }
    if (s.red3s[t].length) out.push({ owner: t, byTeam: true, label: `Red threes ×${s.red3s[t].length}`, cards: [s.red3s[t][0]!] });
  }
  return out;
}

function view(s: CanastaState, seat: number): KitView {
  const team = teamOfSeat(seat);
  const mine = s.turn === seat;
  const over = s.phase === "finished";
  const playing = s.phase === "draw" || s.phase === "meld";
  const need = openingNeed(s.rules, s.scores[team]);
  const takeback = s.phase === "meld" && mine && !s.opened[team] && s.laid.length > 0;
  const top = s.pile.at(-1);
  const frozen = s.pile.some(isWild);
  const w = over ? winner(s) : null;
  return {
    game: "canasta",
    seats: 4,
    me: seat,
    teams: true,
    phase: s.phase,
    turn: playing ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: null,
    pick:
      s.phase === "meld" && mine
        ? {
            min: 1,
            max: s.hands[seat]!.length,
            prompt: "Pick cards to meld, or one to discard.",
            cards: s.hands[seat]!.map((c) => c.id),
            actions: [
              { label: "Meld", type: "meld" },
              { label: "Discard", type: "discard", primary: true },
            ],
          }
        : null,
    choices: takeback
      ? { prompt: `Your side's first melds need ${need}: these make ${laidWorth(s, team)}.`, options: [{ label: "Take them back", move: { type: "takeback" } }] }
      : s.phase === "scored"
        ? nextHandChoices(s.ready, seat, false)
        : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: "", team: teamOfSeat(i), dealer: i === s.dealer })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.pile.slice(-3),
      discardCount: s.pile.length,
      drawMove: s.phase === "draw" && mine ? { type: "draw" } : null,
      takeMove: s.phase === "draw" && mine && top ? { type: "take" } : null,
      note: frozen ? "Frozen" : top && isBlackThree(top) ? "Blocked" : !s.opened[team] && s.pile.length ? "Frozen until your side melds" : null,
    },
    melds: meldsView(s),
    info: [
      ...(playing && !s.opened[team] && need ? [`Your side needs ${need} to open`] : []),
      ...(playing && s.phase === "draw" && mine ? ["Tap the stock to draw, or the pile to take it"] : []),
      `To ${s.rules.playTo.toLocaleString("en-US")}`,
    ],
    narration: s.narration,
    scores: [
      { seats: [0, 2], value: s.scores[0] },
      { seats: [1, 3], value: s.scores[1] },
    ],
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `canasta-${s.hand}`,
            title: s.lastHand.wentOut !== null ? `${who(s.lastHand.wentOut)} went out` : "The stock ran out",
            sides: [
              [0, 2],
              [1, 3],
            ],
            rows: [
              ...Object.entries(s.lastHand.rows).map(([label, values]) => ({
                label,
                values: values.map((v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0")),
                tone: label === "This hand" ? ("score" as const) : undefined,
              })),
              { label: "Score", values: s.scores.map(String), tone: "total" as const },
            ],
          }
        : null,
    over: w !== null ? { winners: [w, w + 2], title: `${who(w)} & ${who(w + 2)} win ${s.scores[w].toLocaleString("en-US")} to ${s.scores[1 - w]!.toLocaleString("en-US")}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

/** Natural groups in a hand, by rank (not threes). */
function naturalGroups(hand: KCard[]): Map<number, KCard[]> {
  const out = new Map<number, KCard[]>();
  for (const c of hand) if (!isWild(c) && !isThree(c)) out.set(rankOf(c), [...(out.get(rankOf(c)) ?? []), c]);
  return out;
}

function bot(s: CanastaState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const team = teamOfSeat(seat);
  const hand = s.hands[seat]!;
  const sloppy = careless(style);
  if (s.phase === "draw") {
    const take = takePlan(s, seat);
    return !("error" in take) && (s.pile.length >= 2 || !sloppy) ? { type: "take" } : { type: "draw" };
  }
  const melds = s.melds[team];
  const canasta = melds.some(isCanasta);
  const ok = (ids: string[]) => !("error" in meldPlan(s, seat, ids));
  // Keep two cards back unless the side can go out.
  const spare = (n: number) => canasta || hand.length - n >= 2;
  if (s.opened[team]) {
    // Naturals onto our melds, new natural melds, then wild cards to finish a canasta.
    for (const [rank, cards] of naturalGroups(hand)) {
      const ids = cards.map((c) => c.id);
      if ((melds.some((m) => m.rank === rank) || cards.length >= 3) && spare(ids.length) && ok(ids)) return { type: "meld", cards: ids };
    }
    const wilds = hand.filter(isWild);
    for (const m of melds) {
      const needed = 7 - m.cards.length;
      if (!isCanasta(m) && needed > 0 && needed <= wilds.length && wildsIn(m) + needed <= 3 && spare(needed)) {
        const ids = wilds.slice(0, needed).map((c) => c.id);
        if (ok(ids)) return { type: "meld", cards: ids };
      }
    }
    // Going out: everything left that melds.
    if (canasta && hand.length <= 3 && ok(hand.map((c) => c.id))) return { type: "meld", cards: hand.map((c) => c.id) };
  } else if (!s.laid.length && !s.tookBack && !sloppy) {
    // Open only with enough: natural groups of three or more, then pairs with a wild card.
    const need = openingNeed(s.rules, s.scores[team]);
    const plan: string[][] = [];
    let worth = 0;
    const wilds = hand.filter(isWild);
    for (const cards of [...naturalGroups(hand).values()].sort((a, b) => total(b) - total(a))) {
      if (cards.length >= 3) plan.push(cards.map((c) => c.id)), (worth += total(cards));
      else if (cards.length === 2 && wilds.length && worth < need) {
        const w = wilds.shift()!;
        plan.push([...cards, w].map((c) => c.id));
        worth += total(cards) + canastaValue(w);
      }
    }
    const used = plan.flat().length;
    if (plan.length && worth >= need && spare(used) && plan.every(ok)) return { type: "meld", cards: plan[0]! };
  } else if (s.laid.length) {
    // Mid-way through opening: lay the rest of the plan (groups of three, or pairs with a wild card).
    for (const [, cards] of naturalGroups(hand)) {
      const ids = cards.map((c) => c.id);
      if (cards.length >= 3 && spare(ids.length) && ok(ids)) return { type: "meld", cards: ids };
    }
    const wild = hand.find(isWild);
    for (const [, cards] of naturalGroups(hand)) {
      const ids = [...cards.map((c) => c.id), ...(wild ? [wild.id] : [])];
      if (cards.length === 2 && wild && spare(3) && ok(ids)) return { type: "meld", cards: ids };
    }
    const need = openingNeed(s.rules, s.scores[team]);
    if (laidWorth(s, team) < need) return { type: "takeback" };
  }
  // Discard: a black three; else a lone card the other side can't use, cheapest first; never a wild if avoidable.
  const theirs = new Set(s.melds[(1 - team) as Team].map((m) => m.rank));
  const ours = new Set(melds.map((m) => m.rank));
  const counts = naturalGroups(hand);
  const score = (c: KCard) => {
    if (isBlackThree(c)) return -100;
    if (isWild(c)) return 1000;
    const r = rankOf(c);
    return (counts.get(r)?.length ?? 0) * 30 + (ours.has(r) ? 60 : 0) + (theirs.has(r) ? 80 : 0) + canastaValue(c);
  };
  const pick = sloppy ? hand[Math.floor(Math.random() * hand.length)]! : [...hand].sort((a, b) => score(a) - score(b))[0]!;
  // Holding one card without a canasta can't happen (melds keep two back), so this discard is legal.
  return { type: "discard", cards: [pick.id] };
}

export const canasta: CardGame<CanastaRules, CanastaState, Move> = {
  id: "canasta",
  name: "Canasta",
  emoji: "🧺",
  blurb: "Partners, melds and canastas",
  tagline: "Meld sevens of a kind into canastas, grab the pile when you can, and go out together. Partners across.",
  seats: { min: 4, max: 4, default: 4 },
  teams: true,
  presets: [classicCanasta, modernCanasta, easyCanasta],
  fields: [
    { key: "playTo", label: "Game to", kind: "choice", options: [[3000, "3,000"], [5000, "5,000"], [7500, "7,500"]] },
    { key: "drawTwo", label: "Draw two", hint: "Take two cards from the stock each turn.", kind: "toggle" },
    { key: "minimums", label: "Opening minimums", hint: "A side's first melds must be worth 50 (90 from 1,500, 120 from 3,000).", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<CanastaRules>;
    const base = [classicCanasta, modernCanasta, easyCanasta].find((p) => p.id === given.id) ?? classicCanasta;
    return { ...base, ...given };
  },
  validate(r) {
    return r.playTo >= 1000 && r.playTo <= 10000 ? [] : ["Play to between 1,000 and 10,000."];
  },
  describe(r) {
    return [
      "Partners across. Two decks with four jokers; eleven cards each. Twos and jokers are wild.",
      `Each turn, draw ${r.drawTwo ? "two cards" : "a card"} from the stock, or take the whole discard pile if you can meld its top card: with two of that rank from your hand, or by adding it to your side's meld. Then meld if you like, and discard one.`,
      "A meld is three or more of a rank, at least two of them natural, with three wild cards at most. Seven cards make a canasta: 500 if natural, 300 with wild cards.",
      `${r.minimums ? "Your side's first melds must be worth 50 (90 from 1,500 points, 120 from 3,000). " : ""}Until your side has melded, or while a wild card is in it, the pile is frozen: you need a natural pair to take it. A black three on top blocks it.`,
      "Red threes go down at once for 100 each (800 for all four), but count against a side that hasn't melded. Jokers count 50, aces and twos 20, eights to kings 10, the rest 5.",
      `Your side needs a canasta to go out (100 more). Cards left in hand count against you. First to ${r.playTo.toLocaleString("en-US")} wins.`,
    ];
  },
  newGame: newCanasta,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "scored") return 1400;
    if (s.phase === "draw") return 1300;
    return thinkFor(Math.min(s.hands[seat]?.length ?? 1, 8), 0.8);
  },
  summary(s) {
    const over = s.phase === "finished";
    const w = winner(s);
    return {
      game: "canasta",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: `${s.scores[0]} to ${s.scores[1]}`,
      order: over ? rankSeats([{ seats: [0, 2], score: s.scores[0] }, { seats: [1, 3], score: s.scores[1] }]) : null,
      winners: over ? [w, w + 2] : null,
      teams: true,
      seats: 4,
    };
  },
};
