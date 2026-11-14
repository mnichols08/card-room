// Bluff (also Cheat, or I Doubt It) for 2 to 6. Every card is dealt. On your turn you put one to four
// cards face down and say they're the rank that's due (aces, then twos, threes…, round and round), true
// or not. Anyone else can call "Bluff!": if you lied, you pick up the whole pile; if you didn't, they
// do. First to get rid of every card wins.
import type { PlayStyle } from "@spades/rules";
import { clone, FULL, GameError, makeDeck, nextRandom, rankLabel, rankSeats, shuffled, SUITS, thinkFor, who, withDrinking, withDrinks, type BaseRules, type CardGame, type KCard, type KitView, type Meld, type PipCard } from "./kit.js";

export interface BluffRules extends BaseRules {
  /** Ranks go in order (A, 2, 3 …); otherwise you may claim the same rank, one up or one down. */
  strictOrder: boolean;
  /** Drinking mode, a house rule: see the game's describe(). */
  drinking?: boolean;
}

export const classicBluff: BluffRules = { id: "bluff-classic", name: "Bluff (A, 2, 3…)", strictOrder: true };
export const looseBluff: BluffRules = { id: "bluff-loose", name: "Same, up or down", strictOrder: false };

type Phase = "play" | "doubt" | "finished";

export interface BluffState {
  game: "bluff";
  rules: BluffRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  pile: KCard[];
  /** The last play: who, how many, which rank they said, and the cards themselves (hidden). */
  claim: { seat: number; count: number; rank: number; cards: KCard[] } | null;
  /** The rank due next (in strict order), or the last one claimed (loose). */
  rank: number;
  turn: number;
  /** In the doubt window: who has decided, and who called. */
  decided: boolean[];
  callers: number[];
  /** The last reveal: whose claim, whether it was true, who picked up. */
  reveal: { seat: number; caller: number; cards: KCard[]; rank: number; honest: boolean } | null;
  /** Seats in the order they went out. */
  out: number[];
  narration: string | null;
}

const rankOf = (c: KCard) => (c as PipCard).rank;
/** A, 2 … K: the order ranks are called in (aces first). */
const ORDER = [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
const nextRank = (r: number) => ORDER[(ORDER.indexOf(r) + 1) % 13]!;
const prevRank = (r: number) => ORDER[(ORDER.indexOf(r) + 12) % 13]!;
export const plural = (r: number, n = 2) => (n === 1 ? `${r === 14 || r === 8 ? "an" : "a"} ${r === 14 ? "ace" : r === 13 ? "king" : r === 12 ? "queen" : r === 11 ? "jack" : rankLabel(r)}` : `${["", "", "two", "three", "four"][n] ?? n} ${r === 14 ? "aces" : r === 13 ? "kings" : r === 12 ? "queens" : r === 11 ? "jacks" : `${rankLabel(r)}s`}`);
const sortHand = (cards: KCard[]) => [...cards].sort((a, b) => ORDER.indexOf(rankOf(a)) - ORDER.indexOf(rankOf(b)) || SUITS.indexOf((a as PipCard).suit) - SUITS.indexOf((b as PipCard).suit));
const holding = (s: BluffState) => s.hands.map((h, i) => (h.length ? i : -1)).filter((i) => i >= 0);

/** The ranks you may claim now. */
export function claimable(s: BluffState): number[] {
  if (s.rules.strictOrder || !s.claim) return [s.rank];
  return [...new Set([s.rank, nextRank(s.rank), prevRank(s.rank)])];
}

export function newBluff(rules: BluffRules, seats: number, seed: number): BluffState {
  const s = { game: "bluff", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, phase: "play", pile: [], claim: null, rank: 14, decided: [], callers: [], reveal: null, out: [], narration: "Aces first" } as unknown as BluffState;
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hands = Array.from({ length: seats }, () => []);
  // Two players get sixteen each, and the rest stay out of play: with the whole deck dealt, you'd know
  // every card your opponent holds and no bluff could ever work.
  const dealt = seats === 2 ? deck.slice(0, 32) : deck;
  dealt.forEach((c, i) => s.hands[(s.dealer + 1 + i) % seats]!.push(c));
  s.hands = s.hands.map(sortHand);
  s.turn = (s.dealer + 1) % seats;
  return s;
}

function nextPlayer(s: BluffState, from: number): number {
  for (let i = 1; i <= s.seats; i++) if (s.hands[(from + i) % s.seats]!.length) return (from + i) % s.seats;
  return from;
}

/** The doubt window closes: anyone who called settles it, else the play stands. */
function settle(s: BluffState) {
  const claim = s.claim!;
  const caller = s.callers.sort((a, b) => ((a - claim.seat + s.seats) % s.seats) - ((b - claim.seat + s.seats) % s.seats))[0];
  if (caller !== undefined) {
    const honest = claim.cards.every((c) => rankOf(c) === claim.rank);
    const taker = honest ? caller : claim.seat;
    s.hands[taker] = sortHand([...s.hands[taker]!, ...s.pile]);
    s.reveal = { seat: claim.seat, caller, cards: claim.cards, rank: claim.rank, honest };
    const cardsWord = `${s.pile.length} card${s.pile.length === 1 ? "" : "s"}`;
    s.narration = honest ? `${who(caller)} called bluff, but it was true: ${who(caller)} picks up ${cardsWord}` : `${who(caller)} called bluff, and it was! ${who(claim.seat)} picks up ${cardsWord}`;
    s.narration = withDrinks(!!s.rules.drinking, s.narration, [taker], 2);
    s.pile = [];
  } else s.narration = `Nobody doubted ${who(claim.seat)}`;
  // Out of cards and believed (or proved honest): out.
  if (!s.hands[claim.seat]!.length && !s.out.includes(claim.seat)) {
    s.out.push(claim.seat);
    s.narration += `. ${who(claim.seat)} is out of cards!`;
  }
  s.rank = s.rules.strictOrder ? nextRank(claim.rank) : claim.rank;
  if (s.out.length >= 1 || holding(s).length <= 1) {
    s.phase = "finished";
    return;
  }
  s.phase = "play";
  s.turn = nextPlayer(s, claim.seat);
}

type Move = { type: "play"; cards: string[]; rank?: number } | { type: "doubt" } | { type: "believe" };

function apply(state: BluffState, seat: number, move: Move): BluffState {
  const s = clone(state);
  if (s.phase === "finished") throw new GameError("The game is over.");
  if (move.type === "play") {
    if (s.phase !== "play" || s.turn !== seat) throw new GameError("It's not your turn.");
    const ids = move.cards ?? [];
    const cards = ids.map((id) => s.hands[seat]!.find((c) => c.id === id));
    if (cards.length < 1 || cards.length > 4 || cards.some((c) => !c) || new Set(ids).size !== ids.length) throw new GameError("Put down one to four cards.");
    const rank = move.rank ?? s.rank;
    if (!claimable(s).includes(rank)) throw new GameError(`Say ${claimable(s).map((r) => plural(r)).join(" or ")}.`);
    s.hands[seat] = s.hands[seat]!.filter((c) => !ids.includes(c.id));
    s.pile.push(...(cards as KCard[]));
    s.claim = { seat, count: cards.length, rank, cards: cards as KCard[] };
    s.reveal = null;
    s.phase = "doubt";
    s.decided = s.hands.map((h, i) => i === seat || (!h.length && i !== seat) || s.out.includes(i));
    s.callers = [];
    s.narration = `${who(seat)} says ${plural(rank, cards.length)}`;
    if (s.decided.every(Boolean)) settle(s);
    return s;
  }
  if (move.type === "doubt" || move.type === "believe") {
    if (s.phase !== "doubt" || s.decided[seat]) throw new GameError("There's nothing to doubt right now.");
    s.decided[seat] = true;
    if (move.type === "doubt") s.callers.push(seat);
    if (s.decided.every(Boolean) || move.type === "doubt") settle(s);
    return s;
  }
  throw new GameError("That's not a move in Bluff.");
}

function view(s: BluffState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.phase === "play" && s.turn === seat;
  const doubting = s.phase === "doubt" && !s.decided[seat];
  const r = s.reveal;
  const melds: Meld[] = r ? [{ owner: r.seat, label: r.honest ? `It was ${plural(r.rank, r.cards.length)}` : `Bluff! Not ${plural(r.rank, r.cards.length)}`, cards: r.cards }] : [];
  const can = claimable(s);
  const winner = s.out[0];
  return {
    game: "bluff",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "play" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: null,
    pick: mine
      ? {
          min: 1,
          max: 4,
          prompt: can.length === 1 ? `Put down one to four cards and say ${plural(can[0]!)}` : "Put down one to four cards, then say what they are",
          cards: s.hands[seat]!.map((c) => c.id),
          actions: can.map((rank, i) => ({ label: `They're ${plural(rank)}`, type: "play", primary: i === 0, extra: { rank } })),
        }
      : null,
    choices: doubting
      ? { prompt: "Believe it?", options: [{ label: "Bluff!", move: { type: "doubt" }, primary: true }, { label: "Believe it", move: { type: "believe" } }], layout: "row" }
      : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: s.out.includes(i) ? "Out!" : "", dealer: i === s.dealer, badge: s.claim?.seat === i && s.phase === "doubt" ? `Says ${plural(s.claim.rank, s.claim.count)}` : undefined })),
    center: {
      kind: "piles",
      stock: null,
      // Face down: only how many, never the cards themselves.
      discard: [],
      discardCount: s.pile.length,
      drawMove: null,
      takeMove: null,
      faceDown: true,
      discardLabel: `${s.pile.length} in the pile`,
    },
    melds,
    info: s.phase === "play" ? [can.length === 1 ? `Next: ${plural(can[0]!)}` : `Next: ${can.map((x) => plural(x)).join(", ")}`] : [],
    narration: s.narration,
    scores: s.hands.map((h, i) => ({ seats: [i], value: h.length })),
    result: null,
    over: over && winner !== undefined ? { winners: [winner], title: `${who(winner)} got rid of every card!` } : over ? { winners: holding(s), title: "Game over" } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: BluffState, seat: number, style: PlayStyle): Move | null {
  const hand = s.hands[seat]!;
  const bold = style.bold ?? 0.3;
  if (s.phase === "doubt") {
    if (s.decided[seat]) return null;
    const c = s.claim!;
    const have = hand.filter((x) => rankOf(x) === c.rank).length;
    // Impossible claims are always called; a player about to go out is called more; big claims too.
    if (have + c.count > 4) return { type: "doubt" };
    let p = 0.08 + (c.count - 1) * 0.1 + have * 0.12;
    const left = s.hands[c.seat]!.length;
    if (!left) p += 0.45;
    else if (left <= 3) p += 0.25;
    else if (left <= 6) p += 0.1;
    if (s.pile.length > 12) p -= 0.05;
    return Math.random() < p ? { type: "doubt" } : { type: "believe" };
  }
  if (s.phase !== "play" || s.turn !== seat) return null;
  // Honest if we can: all we hold of a claimable rank. Otherwise lie with one (or, if bold, two) of our worst cards.
  const can = claimable(s);
  const best = can.map((rank) => ({ rank, cards: hand.filter((x) => rankOf(x) === rank) })).sort((a, b) => b.cards.length - a.cards.length)[0]!;
  if (best.cards.length) {
    const extra = Math.random() < bold * 0.4 && hand.length > best.cards.length + 1 ? hand.filter((x) => rankOf(x) !== best.rank).slice(0, 1) : [];
    return { type: "play", cards: [...best.cards, ...extra].slice(0, 4).map((c) => c.id), rank: best.rank };
  }
  // Lie with cards whose rank comes up last.
  const far = (x: KCard) => (ORDER.indexOf(rankOf(x)) - ORDER.indexOf(s.rank) + 13) % 13;
  const liars = [...hand].sort((a, b) => far(b) - far(a)).slice(0, Math.random() < bold ? 2 : 1);
  return { type: "play", cards: liars.map((c) => c.id), rank: can[0]! };
}

const bluffGame: CardGame<BluffRules, BluffState, Move> = {
  id: "bluff",
  name: "Bluff",
  emoji: "🤥",
  blurb: "Say what you're putting down, true or not",
  tagline: "Also called Cheat or I Doubt It: put your cards down face down, say what they are, and hope nobody calls your bluff.",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [classicBluff, looseBluff],
  fields: [{ key: "strictOrder", label: "Ranks in order", hint: "Aces, then twos, threes … Off: say the same rank, one up or one down.", kind: "toggle" }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<BluffRules>;
    const base = [classicBluff, looseBluff].find((p) => p.id === given.id) ?? classicBluff;
    return { ...base, ...given };
  },
  validate: () => [],
  describe(r) {
    return [
      "Every card is dealt (with two players, sixteen each and the rest stay out of play, so there's room to bluff). Get rid of all of yours to win.",
      r.strictOrder
        ? "On your turn, put one to four cards face down on the pile and say they're the rank that's due: aces first, then twos, threes and so on up to kings, then aces again."
        : "On your turn, put one to four cards face down on the pile and say they're the same rank as the last play, one higher or one lower (aces first).",
      "They don't have to be what you say. Anyone else can call \"Bluff!\": the cards are turned over. If you lied, you pick up the whole pile; if you told the truth, whoever called picks it up.",
      "Play your last card and get away with it, and you win.",
    ];
  },
  newGame: newBluff,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "doubt" ? 1600 : thinkFor(4)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "bluff",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: 1,
      scoreLine: s.hands.map((h) => h.length).join(" · ") + " cards",
      order: over ? rankSeats(s.hands.map((h, i) => ({ seats: [i], score: h.length })), true) : null,
      winners: over ? (s.out.length ? [s.out[0]!] : holding(s)) : null,
      teams: false,
      seats: s.seats,
    };
  },
};

export const bluff = withDrinking(bluffGame, "Adults only. Whoever picks up the pile drinks 2 (or sips of water).", "whoever picks up the pile drinks 2.");
