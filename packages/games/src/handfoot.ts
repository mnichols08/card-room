// Hand and Foot: the family-table cousin of Canasta. Partners across, four decks with jokers. Each
// player gets two piles of eleven: the hand, and the foot (picked up once the hand is played out).
// Draw two, meld three or more of a rank, and close books of seven: clean (no wild cards) or dirty.
// Four rounds with rising opening minimums; to go out your side needs its books (one clean and one
// dirty, or two of each), and you must be in your foot.
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
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type Meld,
  type PipCard,
} from "./kit.js";

export interface HandFootRules extends BaseRules {
  /** Clean and dirty books each side needs before anyone can go out. */
  booksToGoOut: 1 | 2;
  /** Opening minimums rise each round (50, 90, 120, 150); off: any meld opens. */
  minimums: boolean;
  rounds: number;
}

export const classicHandFoot: HandFootRules = { id: "handfoot-classic", name: "Hand and Foot", booksToGoOut: 1, minimums: true, rounds: 4 };
export const longHandFoot: HandFootRules = { ...classicHandFoot, id: "handfoot-long", name: "Two clean, two dirty to go out", booksToGoOut: 2 };
export const easyHandFoot: HandFootRules = { ...classicHandFoot, id: "handfoot-easy", name: "Easygoing (no minimums, 2 rounds)", minimums: false, rounds: 2 };

type Phase = "draw" | "meld" | "scored" | "finished";
type Team = 0 | 1;

export interface Book {
  rank: number;
  cards: KCard[];
}

export interface HandFootState {
  game: "handfoot";
  rules: HandFootRules;
  seats: 4;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  feet: KCard[][];
  /** Whether each player has picked up their foot. */
  inFoot: boolean[];
  stock: KCard[];
  pile: KCard[];
  melds: [Book[], Book[]];
  red3s: [number, number];
  opened: [boolean, boolean];
  /** Cards laid this turn by a side that hasn't opened (so they can be taken back). */
  laid: string[];
  /** This turn's opening was taken back: don't try again before discarding. */
  tookBack: boolean;
  turn: number;
  scores: [number, number];
  lastHand: { wentOut: number | null; rows: Record<string, [number, number]> } | null;
  ready: boolean[];
  narration: string | null;
}

const pip = (c: KCard) => c as PipCard;
export const isWildHF = (c: KCard) => c.kind === "joker" || pip(c).rank === 2;
const isThree = (c: KCard) => c.kind === "pip" && pip(c).rank === 3;
const isRedThree = (c: KCard) => isThree(c) && (pip(c).suit === "hearts" || pip(c).suit === "diamonds");
const rankOf = (c: KCard) => (c.kind === "joker" ? 0 : pip(c).rank);
export function hfValue(c: KCard): number {
  if (c.kind === "joker") return 50;
  const r = pip(c).rank;
  if (r === 2 || r === 14) return 20;
  if (r >= 8) return 10;
  return 5;
}
const total = (cards: KCard[]) => cards.reduce((n, c) => n + hfValue(c), 0);
const rankName = (r: number) => (r === 14 ? "Aces" : r === 13 ? "Kings" : r === 12 ? "Queens" : r === 11 ? "Jacks" : `${rankLabel(r)}s`);
const wilds = (b: Book) => b.cards.filter(isWildHF).length;
export const isBook = (b: Book) => b.cards.length >= 7;
const clean = (b: Book) => wilds(b) === 0;
const key = (c: KCard) => (c.kind === "joker" ? 1000 : pip(c).rank === 2 ? 900 : pip(c).rank * 10 + SUITS.indexOf(pip(c).suit));
const sortHand = (cards: KCard[]) => [...cards].sort((a, b) => key(a) - key(b));
const ROUND_MIN = [50, 90, 120, 150];
export const openingNeedHF = (r: HandFootRules, round: number) => (r.minimums ? ROUND_MIN[Math.min(round, 3)]! : 0);

/** The cards a player is playing from now: their hand, or their foot once picked up. */
const live = (s: HandFootState, seat: number) => s.hands[seat]!;

function layRedThrees(s: HandFootState, seat: number) {
  for (let guard = 0; guard < 12; guard++) {
    const reds = s.hands[seat]!.filter(isRedThree);
    if (!reds.length) return;
    s.hands[seat] = s.hands[seat]!.filter((c) => !isRedThree(c));
    s.red3s[teamOfSeat(seat)] += reds.length;
    for (let i = 0; i < reds.length && s.stock.length; i++) s.hands[seat]!.push(s.stock.pop()!);
  }
}

function deal(s: HandFootState) {
  const deck = shuffled(makeDeck({ ranks: FULL, copies: 5, jokers: 2 }), nextRandom(s));
  s.hands = [0, 1, 2, 3].map((i) => deck.slice(i * 22, i * 22 + 11));
  s.feet = [0, 1, 2, 3].map((i) => deck.slice(i * 22 + 11, i * 22 + 22));
  s.stock = deck.slice(88);
  s.inFoot = [false, false, false, false];
  s.melds = [[], []];
  s.red3s = [0, 0];
  s.opened = [false, false];
  s.laid = [];
  s.tookBack = false;
  for (let seat = 0; seat < 4; seat++) layRedThrees(s, seat);
  // Red threes in a foot count when it's picked up.
  s.hands = s.hands.map(sortHand);
  s.pile = [];
  // Turn up a card that isn't wild or a three.
  for (let guard = 0; guard < 30; guard++) {
    const top = s.stock.pop()!;
    if (isWildHF(top) || isThree(top)) {
      s.stock.unshift(top);
      continue;
    }
    s.pile.push(top);
    break;
  }
  s.ready = [false, false, false, false];
  s.phase = "draw";
  s.turn = (s.dealer + 1) % 4;
  s.narration = s.rules.minimums ? `Round ${s.hand + 1}: opening melds need ${openingNeedHF(s.rules, s.hand)}` : null;
}

export function newHandFoot(rules: HandFootRules, _seats: number, seed: number): HandFootState {
  const s = { game: "handfoot", rules, seats: 4, rng: seed >>> 0, hand: 0, dealer: seed % 4, scores: [0, 0], lastHand: null } as unknown as HandFootState;
  deal(s);
  return s;
}

/** Books each side has. */
const books = (s: HandFootState, t: Team) => ({ clean: s.melds[t].filter((b) => isBook(b) && clean(b)).length, dirty: s.melds[t].filter((b) => isBook(b) && !clean(b)).length });
const canGoOut = (s: HandFootState, t: Team) => {
  const b = books(s, t);
  return b.clean >= s.rules.booksToGoOut && b.dirty >= s.rules.booksToGoOut;
};

/** Pick up the foot when the hand is played out (red threes in it go down). */
function toFoot(s: HandFootState, seat: number) {
  if (s.inFoot[seat] || s.hands[seat]!.length) return false;
  s.inFoot[seat] = true;
  s.hands[seat] = s.feet[seat]!;
  s.feet[seat] = [];
  layRedThrees(s, seat);
  s.hands[seat] = sortHand(s.hands[seat]!);
  return true;
}

// ---- Melding ------------------------------------------------------------------------------------

interface Group {
  rank: number;
  naturals: KCard[];
  wilds: KCard[];
  onto: number;
}

function groupProblem(melds: Book[], groups: Group[]): string | null {
  for (const g of groups) {
    const existing = g.onto >= 0 ? melds[g.onto]! : null;
    if (existing && isBook(existing)) return `The ${rankName(g.rank).toLowerCase()} book is closed.`;
    const naturals = g.naturals.length + (existing ? existing.cards.length - wilds(existing) : 0);
    const wild = g.wilds.length + (existing ? wilds(existing) : 0);
    if (naturals < 2) return `A meld needs at least two natural ${rankName(g.rank).toLowerCase()}.`;
    if (naturals + wild < 3) return "A meld is three cards or more.";
    if (wild > naturals) return "A meld can't have more wild cards than natural ones.";
    if (naturals + wild > 7) return "A book is seven cards: no more.";
  }
  return null;
}

export function meldPlanHF(s: HandFootState, seat: number, ids: string[]): { groups: Group[] } | { error: string } {
  const team = teamOfSeat(seat);
  const hand = live(s, seat);
  const cards = ids.map((id) => hand.find((c) => c.id === id));
  if (!cards.length || cards.some((c) => !c) || new Set(ids).size !== ids.length) return { error: "Pick cards from your hand to meld." };
  const chosen = cards as KCard[];
  if (chosen.some(isThree)) return { error: "Threes don't meld: discard them." };
  const wildCards = chosen.filter(isWildHF);
  const byRank = new Map<number, KCard[]>();
  for (const c of chosen.filter((c) => !isWildHF(c))) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  if (byRank.size > 1 && wildCards.length) return { error: "Meld wild cards with one rank at a time." };
  const melds = s.melds[team];
  const groups: Group[] = [];
  if (!byRank.size) {
    const room = melds.map((m, i) => ({ m, i })).filter(({ m }) => !isBook(m) && wilds(m) + wildCards.length <= m.cards.length - wilds(m) && m.cards.length + wildCards.length <= 7)[0];
    if (!room) return { error: melds.length ? "No open meld has room for those wild cards." : "Wild cards need natural cards to meld with." };
    groups.push({ rank: room.m.rank, naturals: [], wilds: wildCards, onto: room.i });
  } else for (const [rank, naturals] of byRank) groups.push({ rank, naturals, wilds: byRank.size === 1 ? wildCards : [], onto: melds.findIndex((m) => m.rank === rank && !isBook(m)) });
  const problem = groupProblem(melds, groups);
  if (problem) return { error: problem };
  // You can't play your last card from your foot unless your side can go out.
  const left = hand.length - chosen.length;
  if (s.inFoot[seat] && left <= 1) {
    const after = clone(s.melds[team]);
    for (const g of groups) (g.onto >= 0 ? after[g.onto]!.cards : (after.push({ rank: g.rank, cards: [] }), after.at(-1)!.cards)).push(...g.naturals, ...g.wilds);
    const b = { clean: after.filter((m) => isBook(m) && clean(m)).length, dirty: after.filter((m) => isBook(m) && !clean(m)).length };
    if (!(b.clean >= s.rules.booksToGoOut && b.dirty >= s.rules.booksToGoOut)) return { error: `Your side needs ${s.rules.booksToGoOut} clean and ${s.rules.booksToGoOut} dirty book${s.rules.booksToGoOut > 1 ? "s" : ""} before you go out.` };
  }
  return { groups };
}

function layGroups(s: HandFootState, seat: number, groups: Group[]) {
  const team = teamOfSeat(seat);
  const used = new Set(groups.flatMap((g) => [...g.naturals, ...g.wilds].map((c) => c.id)));
  s.hands[seat] = s.hands[seat]!.filter((c) => !used.has(c.id));
  for (const g of groups) {
    if (g.onto >= 0) s.melds[team][g.onto]!.cards.push(...g.naturals, ...g.wilds);
    else s.melds[team].push({ rank: g.rank, cards: [...g.naturals, ...g.wilds] });
  }
}

/** Take the pile: its top card with two naturals of that rank from your hand; you take the top seven. */
export function takePlanHF(s: HandFootState, seat: number): { group: Group } | { error: string } {
  const top = s.pile.at(-1);
  if (!top) return { error: "The pile is empty." };
  if (isWildHF(top) || isThree(top)) return { error: "You can't take a wild card or a three off the pile." };
  const team = teamOfSeat(seat);
  const pair = live(s, seat).filter((c) => !isWildHF(c) && rankOf(c) === rankOf(top)).slice(0, 2);
  if (pair.length < 2) return { error: `You need two ${rankName(rankOf(top)).toLowerCase()} in your hand to take the pile.` };
  const group: Group = { rank: rankOf(top), naturals: [top, ...pair], wilds: [], onto: s.melds[team].findIndex((m) => m.rank === rankOf(top) && !isBook(m)) };
  const problem = groupProblem(s.melds[team], [group]);
  if (problem) return { error: problem };
  if (!s.opened[team] && total(group.naturals) < openingNeedHF(s.rules, s.hand)) return { error: `To open your side needs ${openingNeedHF(s.rules, s.hand)}; meld from your hand first, or draw.` };
  return { group };
}

// ---- Moves --------------------------------------------------------------------------------------

type Move = { type: "draw" } | { type: "take" } | { type: "meld"; cards: string[] } | { type: "discard"; cards?: string[]; card?: string } | { type: "takeback" } | { type: "next" };

const laidWorth = (s: HandFootState, t: Team) => total(s.melds[t].flatMap((m) => m.cards).filter((c) => s.laid.includes(c.id)));

function apply(state: HandFootState, seat: number, move: Move): HandFootState {
  const s = clone(state);
  const team = teamOfSeat(seat);
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The round isn't over.");
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
      if (s.stock.length < 2) {
        s.narration = "The stock ran out.";
        scoreRound(s, null);
        return s;
      }
      s.hands[seat]!.push(s.stock.pop()!, s.stock.pop()!);
      layRedThrees(s, seat);
      s.hands[seat] = sortHand(s.hands[seat]!);
      s.phase = "meld";
      s.narration = null;
      return s;
    }
    case "take": {
      if (s.phase !== "draw") throw new GameError("You've already drawn.");
      const plan = takePlanHF(s, seat);
      if ("error" in plan) throw new GameError(plan.error);
      const top = s.pile.pop()!;
      s.hands[seat]!.push(top);
      layGroups(s, seat, [plan.group]);
      // The six under it come too.
      const rest = s.pile.splice(Math.max(0, s.pile.length - 6));
      s.hands[seat] = sortHand([...s.hands[seat]!, ...rest]);
      s.opened[team] = true;
      s.laid = [];
      s.phase = "meld";
      s.narration = `${who(seat)} took the pile`;
      return s;
    }
    case "meld": {
      if (s.phase !== "meld") throw new GameError("Draw first: tap the stock, or the pile to take it.");
      const plan = meldPlanHF(s, seat, move.cards ?? []);
      if ("error" in plan) throw new GameError(plan.error);
      if (!s.opened[team]) s.laid.push(...(move.cards ?? []));
      layGroups(s, seat, plan.groups);
      const closed = plan.groups.map((g) => (g.onto >= 0 ? s.melds[team][g.onto]! : s.melds[team].at(-1)!)).find(isBook);
      s.narration = closed ? `${who(seat)} closed a ${clean(closed) ? "clean" : "dirty"} book of ${rankName(closed.rank).toLowerCase()}!` : null;
      if (!s.hands[seat]!.length) {
        if (s.inFoot[seat]) {
          if (!s.opened[team] && laidWorth(s, team) < openingNeedHF(s.rules, s.hand)) throw new GameError(`Your side's first melds need ${openingNeedHF(s.rules, s.hand)}.`);
          goOut(s, seat);
        } else {
          if (!s.opened[team]) s.opened[team] = true;
          toFoot(s, seat);
          s.narration = `${s.narration ? s.narration + " " : ""}${who(seat)} played out their hand and picked up their foot`;
        }
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
        const need = openingNeedHF(s.rules, s.hand);
        if (laidWorth(s, team) < need) throw new GameError(`Your side's first melds need ${need}, and these make ${laidWorth(s, team)}. Meld more, or take them back.`);
        s.opened[team] = true;
      }
      if (s.hands[seat]!.length === 1 && s.inFoot[seat] && !canGoOut(s, team)) throw new GameError(`Your side needs ${s.rules.booksToGoOut} clean and ${s.rules.booksToGoOut} dirty book${s.rules.booksToGoOut > 1 ? "s" : ""} before you go out.`);
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.pile.push(card);
      s.laid = [];
      s.tookBack = false;
      s.narration = null;
      if (!s.hands[seat]!.length) {
        if (s.inFoot[seat]) {
          goOut(s, seat);
          return s;
        }
        toFoot(s, seat);
        s.narration = `${who(seat)} picked up their foot`;
      }
      s.turn = (seat + 1) % 4;
      s.phase = "draw";
      return s;
    }
    default:
      throw new GameError("That's not a move in Hand and Foot.");
  }
}

function goOut(s: HandFootState, seat: number) {
  s.narration = `${who(seat)} went out!`;
  scoreRound(s, seat);
}

function scoreRound(s: HandFootState, wentOut: number | null) {
  const rows: Record<string, [number, number]> = { "Clean books": [0, 0], "Dirty books": [0, 0], "Red threes": [0, 0], "Going out": [0, 0], "Melded cards": [0, 0], "Left in hand and foot": [0, 0] };
  for (const t of [0, 1] as const) {
    rows["Clean books"]![t] = books(s, t).clean * 500;
    rows["Dirty books"]![t] = books(s, t).dirty * 300;
    rows["Red threes"]![t] = s.red3s[t] * 100;
    rows["Going out"]![t] = wentOut !== null && teamOfSeat(wentOut) === t ? 100 : 0;
    rows["Melded cards"]![t] = total(s.melds[t].flatMap((m) => m.cards));
    rows["Left in hand and foot"]![t] = -total([t, t + 2].flatMap((p) => [...s.hands[p]!, ...s.feet[p]!]));
  }
  const round = [0, 1].map((t) => Object.values(rows).reduce((n, r) => n + r[t]!, 0)) as [number, number];
  s.scores = [s.scores[0] + round[0], s.scores[1] + round[1]];
  s.lastHand = { wentOut, rows: { ...rows, "This round": round } };
  s.ready = [false, false, false, false];
  s.phase = s.hand + 1 >= s.rules.rounds ? "finished" : "scored";
}

const winner = (s: HandFootState): Team => (s.scores[0] >= s.scores[1] ? 0 : 1);

function view(s: HandFootState, seat: number): KitView {
  const team = teamOfSeat(seat);
  const mine = s.turn === seat;
  const over = s.phase === "finished";
  const playing = s.phase === "draw" || s.phase === "meld";
  const need = openingNeedHF(s.rules, s.hand);
  const takeback = s.phase === "meld" && mine && !s.opened[team] && s.laid.length > 0;
  const melds: Meld[] = [];
  for (const t of [0, 1] as const) {
    for (const m of [...s.melds[t]].sort((a, b) => b.cards.length - a.cards.length || b.rank - a.rank)) {
      const done = isBook(m);
      melds.push({ owner: t, byTeam: true, label: done ? `${rankName(m.rank)} ✓ ${clean(m) ? "clean" : "dirty"} book` : `${rankName(m.rank)} ×${m.cards.length}${wilds(m) ? ` (${wilds(m)} wild)` : ""}`, cards: done ? [m.cards[0]!] : m.cards.length <= 3 ? m.cards : [m.cards[0]!, m.cards[1]!, m.cards.at(-1)!] });
    }
  }
  const b = books(s, team);
  const w = over ? winner(s) : null;
  return {
    game: "handfoot",
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
        ? { min: 1, max: s.hands[seat]!.length, prompt: "Pick cards to meld, or one to discard.", cards: s.hands[seat]!.map((c) => c.id), actions: [{ label: "Meld", type: "meld" }, { label: "Discard", type: "discard", primary: true }] }
        : null,
    choices: takeback ? { prompt: `Your side's first melds need ${need}: these make ${laidWorth(s, team)}.`, options: [{ label: "Take them back", move: { type: "takeback" } }] } : s.phase === "scored" ? nextHandChoices(s.ready, seat, false) : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: s.inFoot[i] ? "In the foot" : `Foot: ${s.feet[i]!.length}`, team: teamOfSeat(i), dealer: i === s.dealer })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.pile.slice(-3),
      discardCount: s.pile.length,
      drawMove: s.phase === "draw" && mine ? { type: "draw" } : null,
      takeMove: s.phase === "draw" && mine && s.pile.length ? { type: "take" } : null,
    },
    melds,
    info: [
      `Round ${s.hand + 1} of ${s.rules.rounds}`,
      ...(playing && !s.opened[team] && need ? [`Open with ${need}`] : []),
      `Books ${b.clean} clean · ${b.dirty} dirty`,
    ],
    narration: s.narration,
    scores: [
      { seats: [0, 2], value: s.scores[0] },
      { seats: [1, 3], value: s.scores[1] },
    ],
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `handfoot-${s.hand}`,
            title: s.lastHand.wentOut !== null ? `${who(s.lastHand.wentOut)} went out` : "The stock ran out",
            sides: [
              [0, 2],
              [1, 3],
            ],
            rows: [
              ...Object.entries(s.lastHand.rows).map(([label, values]) => ({ label, values: values.map((v) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0")), tone: label === "This round" ? ("score" as const) : undefined })),
              { label: "Score", values: s.scores.map(String), tone: "total" as const },
            ],
          }
        : null,
    over: w !== null ? { winners: [w, w + 2], title: `${who(w)} & ${who(w + 2)} win ${s.scores[w].toLocaleString("en-US")} to ${s.scores[1 - w]!.toLocaleString("en-US")}` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: HandFootState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const team = teamOfSeat(seat);
  const hand = s.hands[seat]!;
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.25;
  if (s.phase === "draw") return !("error" in takePlanHF(s, seat)) && !sloppy ? { type: "take" } : { type: "draw" };
  const ok = (ids: string[]) => !("error" in meldPlanHF(s, seat, ids));
  const groups = new Map<number, KCard[]>();
  for (const c of hand) if (!isWildHF(c) && !isThree(c)) groups.set(rankOf(c), [...(groups.get(rankOf(c)) ?? []), c]);
  const keep = (n: number) => hand.length - n >= 1;
  const wildsInHand = hand.filter(isWildHF);
  if (s.opened[team]) {
    for (const [rank, cards] of groups) {
      const open = s.melds[team].findIndex((m) => m.rank === rank && !isBook(m));
      const room = open >= 0 ? 7 - s.melds[team][open]!.cards.length : 7;
      const ids = cards.slice(0, room).map((c) => c.id);
      if ((open >= 0 || cards.length >= 3) && ids.length && keep(ids.length) && ok(ids)) return { type: "meld", cards: ids };
    }
    // A pair and a wild card start a meld.
    for (const [, cards] of groups) {
      if (cards.length === 2 && wildsInHand.length && keep(3) && !s.melds[team].some((m) => m.rank === rankOf(cards[0]!) && !isBook(m))) {
        const ids = [...cards.map((c) => c.id), wildsInHand[0]!.id];
        if (ok(ids)) return { type: "meld", cards: ids };
      }
    }
    // Wild cards to close a dirty book.
    for (const m of s.melds[team]) {
      const need = 7 - m.cards.length;
      if (!isBook(m) && need > 0 && need <= wildsInHand.length && keep(need)) {
        const ids = wildsInHand.slice(0, need).map((c) => c.id);
        if (ok(ids)) return { type: "meld", cards: ids };
      }
    }
    if (s.inFoot[seat] && hand.length <= 2 && ok(hand.map((c) => c.id))) return { type: "meld", cards: hand.map((c) => c.id) };
  } else if (!s.laid.length && !s.tookBack) {
    const need = openingNeedHF(s.rules, s.hand);
    const plan = [...groups.values()].filter((g) => g.length >= 3).map((g) => g.slice(0, 7));
    const worth = plan.reduce((n, g) => n + total(g), 0);
    if (plan.length && worth >= need && keep(plan[0]!.length) && ok(plan[0]!.map((c) => c.id))) return { type: "meld", cards: plan[0]!.map((c) => c.id) };
  } else if (s.laid.length) {
    for (const g of groups.values()) if (g.length >= 3 && keep(g.length) && ok(g.slice(0, 7).map((c) => c.id))) return { type: "meld", cards: g.slice(0, 7).map((c) => c.id) };
    if (laidWorth(s, team) < openingNeedHF(s.rules, s.hand)) return { type: "takeback" };
  }
  // Discard: a three; else a lone card, cheapest; never a wild if avoidable.
  const counts = (c: KCard) => (groups.get(rankOf(c))?.length ?? 0) + (s.melds[team].some((m) => m.rank === rankOf(c) && !isBook(m)) ? 3 : 0);
  const score = (c: KCard) => (isThree(c) ? -100 : isWildHF(c) ? 1000 : counts(c) * 30 + hfValue(c));
  const pick = sloppy ? hand[Math.floor(Math.random() * hand.length)]! : [...hand].sort((a, b) => score(a) - score(b))[0]!;
  return { type: "discard", cards: [pick.id] };
}

export const handFoot: CardGame<HandFootRules, HandFootState, Move> = {
  id: "handfoot",
  name: "Hand and Foot",
  emoji: "🦶",
  blurb: "Partners, books of seven, and a foot",
  tagline: "Play out your hand, pick up your foot, and close books of seven with your partner.",
  seats: { min: 4, max: 4, default: 4 },
  teams: true,
  presets: [classicHandFoot, longHandFoot, easyHandFoot],
  fields: [
    { key: "booksToGoOut", label: "Books to go out", kind: "choice", options: [[1, "One clean, one dirty"], [2, "Two clean, two dirty"]] },
    { key: "minimums", label: "Opening minimums", hint: "Round 1: 50, round 2: 90, round 3: 120, round 4: 150.", kind: "toggle" },
    { key: "rounds", label: "Rounds", kind: "choice", options: [[2, "2"], [4, "4"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<HandFootRules>;
    const base = [classicHandFoot, longHandFoot, easyHandFoot].find((p) => p.id === given.id) ?? classicHandFoot;
    const merged = { ...base, ...given };
    return { ...merged, booksToGoOut: Number(merged.booksToGoOut) === 2 ? 2 : 1, rounds: Math.max(1, Math.min(8, Math.round(Number(merged.rounds) || 4))) };
  },
  validate: (r) => (r.rounds >= 1 && r.rounds <= 8 ? [] : ["Between 1 and 8 rounds."]),
  describe(r) {
    return [
      "Partners across. Five decks with their jokers. Everyone gets two piles of eleven: a hand to play first, and a foot to pick up once the hand is played out.",
      `Each turn, draw two from the stock, or take the pile: its top card with two of that rank from your hand (you get the top seven cards). Then meld if you like, and discard one.${r.minimums ? " Your side's first melds each round must be worth 50, then 90, 120 and 150." : ""}`,
      "A meld is three or more of a rank, never more wild cards (twos and jokers) than natural ones. Seven cards close it into a book: clean (no wilds) 500, dirty 300. Red threes go down for 100; threes don't meld.",
      `To go out you must be in your foot, and your side needs ${r.booksToGoOut} clean and ${r.booksToGoOut} dirty book${r.booksToGoOut > 1 ? "s" : ""}. Going out scores 100, melded cards count for you, and cards left in hands and feet count against. ${r.rounds} rounds; the higher total wins.`,
    ];
  },
  newGame: newHandFoot,
  apply,
  view,
  bot,
  thinkingTime: (s, seat) => (s.phase === "scored" ? 1400 : s.phase === "draw" ? 1200 : thinkFor(Math.min(s.hands[seat]?.length ?? 1, 8), 0.8)),
  summary(s) {
    const over = s.phase === "finished";
    const w = winner(s);
    return {
      game: "handfoot",
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
