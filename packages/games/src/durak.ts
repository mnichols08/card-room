// Durak ("the fool"): a 36-card deck (6s up), six cards each, and the bottom card turned up for trump.
// The attacker plays a card; the defender must beat it with a higher card of the same suit, or any
// trump (a higher trump beats a lower one). The others may throw in more cards of a rank already on
// the table. Beat everything and the cards are discarded; can't (or won't), and you pick them all up.
// Everyone draws back up to six. Once the stock is gone, empty your hand and you're safe. The last
// player holding cards is the durak.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  nextRandom,
  rankLabel,
  shuffled,
  sortCards,
  SYMBOL,
  thinkFor,
  who,
  withDrinking,
  withDrinks,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
} from "./kit.js";

export interface DurakRules extends BaseRules {
  /** 36 cards (6s up) or the full 52. */
  deck: 36 | 52;
  /** No more than five cards in the very first attack. */
  firstFive: boolean;
  /** Drinking mode, a house rule: see the game's describe(). */
  drinking?: boolean;
}

export const classicDurak: DurakRules = { id: "durak-classic", name: "Durak (36 cards)", deck: 36, firstFive: true };
export const bigDurak: DurakRules = { ...classicDurak, id: "durak-52", name: "Full deck (52 cards)", deck: 52 };

export interface DurakState {
  game: "durak";
  rules: DurakRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  hands: KCard[][];
  stock: KCard[];
  trumpCard: KCard;
  trump: Suit;
  discards: number;
  table: { attack: KCard; defense: KCard | null }[];
  attacker: number;
  defender: number;
  /** Whose move: the defender, or the attacker (or another player) adding to the attack. */
  turn: number;
  /** Players who've said they're done adding this round. */
  done: boolean[];
  /** How many cards the attack may hold this round. */
  limit: number;
  firstRound: boolean;
  /** The order players emptied their hands (safe), first first. */
  out: number[];
  durak: number | null;
  phase: "playing" | "finished";
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const suitOf = (c: KCard) => (c as { suit: Suit }).suit;
const label = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[suitOf(c)]}`;
const HAND = 6;

/** Does `card` beat `attack`? Same suit and higher, or a trump on a non-trump. */
export function beats(card: KCard, attack: KCard, trump: Suit): boolean {
  if (suitOf(card) === suitOf(attack)) return rank(card) > rank(attack);
  return suitOf(card) === trump;
}

const active = (s: DurakState) => s.hands.map((h, i) => i).filter((i) => !s.out.includes(i));
function nextActive(s: DurakState, from: number): number {
  for (let k = 1; k <= s.seats; k++) {
    const n = (from + k) % s.seats;
    if (!s.out.includes(n)) return n;
  }
  return from;
}

function sortFor(cards: KCard[], trump: Suit) {
  return sortCards(cards, (c) => rank(c) + (suitOf(c) === trump ? 100 : 0), (c) => suitOf(c));
}

export function newDurak(rules: DurakRules, seats: number, seed: number): DurakState {
  const s = { game: "durak", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, discards: 0, out: [], durak: null, firstRound: true, phase: "playing", narration: null } as unknown as DurakState;
  const ranks = rules.deck === 36 ? FULL.filter((r) => r >= 6) : FULL;
  const deck = shuffled(makeDeck({ ranks }), nextRandom(s));
  s.trumpCard = deck[deck.length - 1]!;
  s.trump = suitOf(s.trumpCard);
  s.hands = Array.from({ length: seats }, (_, i) => sortFor(deck.slice(i * HAND, (i + 1) * HAND), s.trump));
  // The stock is drawn from the front; the turned-up trump is its last card.
  s.stock = deck.slice(seats * HAND);
  // Lowest trump leads first.
  let first = (s.dealer + 1) % seats;
  let low = 99;
  s.hands.forEach((h, i) => {
    for (const c of h) if (suitOf(c) === s.trump && rank(c) < low) {
      low = rank(c);
      first = i;
    }
  });
  startRound(s, first);
  s.narration = low < 99 ? `${who(first)} has the lowest trump and attacks first` : `${who(first)} attacks first`;
  return s;
}

function startRound(s: DurakState, attacker: number) {
  s.attacker = attacker;
  s.defender = nextActive(s, attacker);
  s.table = [];
  s.done = Array(s.seats).fill(false);
  s.limit = Math.min(s.firstRound && s.rules.firstFive ? 5 : HAND, s.hands[s.defender]!.length);
  s.turn = attacker;
}

/** Ranks on the table: what may be thrown in. */
const ranksOnTable = (s: DurakState) => new Set(s.table.flatMap((p) => [p.attack, ...(p.defense ? [p.defense] : [])]).map(rank));
const unbeaten = (s: DurakState) => s.table.find((p) => !p.defense) ?? null;

/** Cards this seat may play now. */
export function durakLegal(s: DurakState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  const hand = s.hands[seat]!;
  if (seat === s.defender) {
    const open = unbeaten(s);
    return open ? hand.filter((c) => beats(c, open.attack, s.trump)) : [];
  }
  if (!s.table.length) return hand;
  if (s.table.length >= s.limit || unbeaten(s)) return [];
  const ranks = ranksOnTable(s);
  return hand.filter((c) => ranks.has(rank(c)));
}

/** The next player (not the defender) who may still add to the attack, or null. */
function nextAdder(s: DurakState, from: number): number | null {
  let n = from;
  for (let k = 0; k < s.seats; k++) {
    n = nextActive(s, n);
    if (n !== s.defender && !s.done[n] && !s.out.includes(n) && s.hands[n]!.length) return n;
    if (n === from) break;
  }
  return null;
}

/** Draw back up to six: the attacker first, round the table, the defender last. */
function refill(s: DurakState) {
  const order: number[] = [];
  let n = s.attacker;
  for (let k = 0; k < s.seats; k++) {
    if (n !== s.defender && !s.out.includes(n)) order.push(n);
    n = (n + 1) % s.seats;
  }
  if (!s.out.includes(s.defender)) order.push(s.defender);
  for (const i of order) {
    while (s.hands[i]!.length < HAND && s.stock.length) s.hands[i]!.push(s.stock.shift()!);
    s.hands[i] = sortFor(s.hands[i]!, s.trump);
  }
}

/** Anyone with no cards once the stock is gone is safe. Returns true when the game is over. */
function settleOuts(s: DurakState): boolean {
  if (s.stock.length) return false;
  for (let i = 0; i < s.seats; i++) if (!s.hands[i]!.length && !s.out.includes(i)) s.out.push(i);
  const left = active(s);
  if (left.length <= 1) {
    s.durak = left[0] ?? null;
    s.phase = "finished";
    s.narration = s.durak === null ? "Everyone got out together: no durak this time!" : withDrinks(!!s.rules.drinking, `${who(s.durak)} is the durak! 🤡`, [s.durak], 99);
    return true;
  }
  return false;
}

function endRound(s: DurakState, took: boolean) {
  const defender = s.defender;
  if (took) {
    s.hands[defender] = sortFor([...s.hands[defender]!, ...s.table.flatMap((p) => [p.attack, ...(p.defense ? [p.defense] : [])])], s.trump);
  } else s.discards += s.table.reduce((n, p) => n + 1 + (p.defense ? 1 : 0), 0);
  s.table = [];
  refill(s);
  s.firstRound = false;
  if (settleOuts(s)) return;
  // Beaten off: the defender attacks next. Took them: the player after the defender does.
  const next = took ? nextActive(s, defender) : s.out.includes(defender) ? nextActive(s, defender) : defender;
  startRound(s, next);
}

type Move = { type: "play"; card: string } | { type: "take" } | { type: "done" };

function apply(state: DurakState, seat: number, move: Move): DurakState {
  const s = clone(state);
  if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
  switch (move.type) {
    case "play": {
      const card = s.hands[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      if (!durakLegal(s, seat).some((c) => c.id === card.id)) {
        if (seat === s.defender) throw new GameError(`That doesn't beat the ${label(unbeaten(s)!.attack)}: play a higher ${SYMBOL[suitOf(unbeaten(s)!.attack)]} or a trump.`);
        if (s.table.length >= s.limit) throw new GameError("That's as many cards as this attack can hold.");
        throw new GameError("Throw in only a rank that's already on the table.");
      }
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      if (seat === s.defender) {
        unbeaten(s)!.defense = card;
        s.narration = `${who(seat)} beat it with the ${label(card)}`;
        // All beaten: the attackers may add more, starting with the main attacker.
        s.done = Array(s.seats).fill(false);
        if (s.table.length >= s.limit || !s.hands[seat]!.length) return (endRound(s, false), s);
        const adder = s.hands[s.attacker]!.length && !s.out.includes(s.attacker) ? s.attacker : nextAdder(s, s.attacker);
        if (adder === null) return (endRound(s, false), s);
        s.turn = adder;
      } else {
        s.table.push({ attack: card, defense: null });
        s.narration = `${who(seat)} ${s.table.length === 1 ? "attacks with" : "throws in"} the ${label(card)}`;
        s.turn = s.defender;
      }
      return s;
    }
    case "take": {
      if (seat !== s.defender || !unbeaten(s)) throw new GameError("Only the defender can pick up, with a card still to beat.");
      s.narration = withDrinks(!!s.rules.drinking, `${who(seat)} picks up ${s.table.reduce((n, p) => n + 1 + (p.defense ? 1 : 0), 0)} cards`, [seat], 1);
      endRound(s, true);
      return s;
    }
    case "done": {
      if (seat === s.defender) throw new GameError("Beat the card or pick them up.");
      if (!s.table.length) throw new GameError("Start the attack with a card.");
      if (unbeaten(s)) throw new GameError("Wait for the defender.");
      s.done[seat] = true;
      const adder = nextAdder(s, seat);
      if (adder === null) {
        s.narration = `Beaten off! ${who(s.defender)} attacks next`;
        endRound(s, false);
        return s;
      }
      s.turn = adder;
      s.narration = `${who(seat)} is done adding`;
      return s;
    }
    default:
      throw new GameError("That's not a move in Durak.");
  }
}

function view(s: DurakState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.phase === "playing" && s.turn === seat;
  const legal = durakLegal(s, seat);
  let choices: KitView["choices"] = null;
  if (mine && seat === s.defender) choices = { prompt: legal.length ? "Beat it, or pick them all up." : "Nothing beats it: pick them up.", options: [{ label: "Pick them up", move: { type: "take" }, primary: !legal.length }] };
  else if (mine && s.table.length) choices = { prompt: legal.length ? "Throw in a card of a rank on the table, or you're done." : "", options: [{ label: s.attacker === seat ? "Done: beaten off" : "Done", move: { type: "done" }, primary: !legal.length }] };
  const role = (i: number) => (s.out.includes(i) ? "Safe" : i === s.defender ? "Defending" : i === s.attacker ? "Attacking" : "");
  return {
    game: "durak",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: mine && legal.length ? { type: "play", cards: legal.map((c) => c.id) } : null,
    pick: null,
    choices,
    players: s.hands.map((h, i) => ({
      cards: h.length,
      line: over ? (i === s.durak ? "Durak!" : "Safe") : role(i),
      out: s.out.includes(i),
      badge: over && i === s.durak ? "🤡" : undefined,
    })),
    center: {
      kind: "pairs",
      stock: s.stock.length,
      trumpCard: s.stock.length ? s.trumpCard : null,
      trumpLabel: `Trump ${SYMBOL[s.trump]}`,
      pairs: s.table,
      discards: s.discards,
    },
    melds: [],
    info: [...(s.stock.length ? [] : [`Trump ${SYMBOL[s.trump]}`]), ...(s.table.length && !over ? [`${s.table.length} of ${s.limit} cards in this attack`] : [])],
    narration: s.narration,
    scores: s.hands.map((h, i) => ({ seats: [i], value: h.length })),
    result: null,
    over: over ? { winners: s.hands.map((_, i) => i).filter((i) => i !== s.durak), title: s.durak === null ? "No durak this time!" : `${who(s.durak)} is the durak!` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: DurakState, seat: number, style: PlayStyle): Move | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const legal = durakLegal(s, seat);
  const cost = (c: KCard) => rank(c) + (suitOf(c) === s.trump ? 20 : 0);
  const cheapest = [...legal].sort((a, b) => cost(a) - cost(b))[0];
  const sloppy = Math.random() < (style.sloppy ?? 0) * 0.5;
  if (seat === s.defender) {
    if (!cheapest) return { type: "take" };
    // Early on, don't spend a high trump to beat off a small card: take it instead.
    const open = unbeaten(s)!;
    const pricey = suitOf(cheapest) === s.trump && rank(cheapest) >= 12 && suitOf(open.attack) !== s.trump && s.stock.length > 8;
    if (pricey && !sloppy && s.table.length <= 2) return { type: "take" };
    return { type: "play", card: cheapest.id };
  }
  if (!s.table.length) {
    // Lead the lowest non-trump (pairs are good: they can be thrown in later).
    const plain = s.hands[seat]!.filter((c) => suitOf(c) !== s.trump);
    const pool = plain.length ? plain : s.hands[seat]!;
    return { type: "play", card: [...pool].sort((a, b) => cost(a) - cost(b))[0]!.id };
  }
  // Throw in cheap cards; keep trumps and high cards unless the stock is nearly gone.
  if (cheapest && (cost(cheapest) <= 11 || !s.stock.length || sloppy)) return { type: "play", card: cheapest.id };
  return { type: "done" };
}

const durakGame: CardGame<DurakRules, DurakState, Move> = {
  id: "durak",
  name: "Durak",
  emoji: "🤡",
  blurb: "Attack, defend, and don't be the fool",
  tagline: "Beat off every attack with higher cards or trumps. Don't be the last one holding cards!",
  seats: { min: 2, max: 6, default: 3 },
  teams: false,
  presets: [classicDurak, bigDurak],
  fields: [
    { key: "deck", label: "Deck", kind: "choice", options: [[36, "36 cards (6s up)"], [52, "52 cards"]] },
    { key: "firstFive", label: "First attack: five cards at most", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<DurakRules>;
    const base = [classicDurak, bigDurak].find((p) => p.id === given.id) ?? classicDurak;
    const r = { ...base, ...given };
    return { ...r, deck: Number(r.deck) === 52 ? 52 : 36 };
  },
  validate() {
    return [];
  },
  describe(r) {
    return [
      `${r.deck === 36 ? "A 36-card deck, 6s up to aces" : "A full 52-card deck"}. Six cards each; the bottom card is turned up and its suit is trump.`,
      "The lowest trump attacks first with a card. The defender must beat it: a higher card of the same suit, or any trump (a higher trump beats a lower one).",
      `Then anyone but the defender may throw in another card of a rank already on the table, one at a time, up to six (or the defender's hand)${r.firstFive ? "; the very first attack holds five at most" : ""}.`,
      "Beat everything and the cards go away; the defender attacks next. Can't (or won't)? Pick them all up, and the next player attacks.",
      "Everyone draws back up to six, the attacker first and the defender last. When the stock is gone, empty your hand and you're safe.",
      "The last player holding cards is the durak: the fool.",
    ];
  },
  newGame: newDurak,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    return thinkFor(durakLegal(s, seat).length + 1, 0.8);
  },
  summary(s) {
    const over = s.phase === "finished";
    const order = over ? [...s.out, ...active(s).filter((i) => !s.out.includes(i))] : null;
    return {
      game: "durak",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.hands.map((h) => h.length).join(" · ") + " cards",
      order,
      winners: over ? s.hands.map((_, i) => i).filter((i) => i !== s.durak) : null,
      teams: false,
      seats: s.seats,
    };
  },
};

export const durak = withDrinking(durakGame, "Adults only. Pick up and drink 1; the durak finishes their drink (or sips of water).", "pick up the attack and drink 1; the durak finishes their drink.");
