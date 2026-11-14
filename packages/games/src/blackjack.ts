// Blackjack (Twenty-One), for chips only: everyone plays against the dealer. Bet, then take cards
// ("hit") until you're happy ("stand"), without going over 21. Aces count 1 or 11, faces 10. Double
// your bet on your first two cards for exactly one more card; split a pair into two hands. The dealer
// draws to 17. Beat the dealer's total and you win your bet; a blackjack (an ace and a ten-card on
// the deal) pays 3 to 2. Most chips after the last round wins.
import type { PlayStyle } from "@spades/rules";
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
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type Choice,
  type KCard,
  type KitView,
  type Meld,
} from "./kit.js";

export interface BlackjackRules extends BaseRules {
  decks: number;
  /** The dealer hits a soft 17 (an ace counted as 11 making 17). */
  hitSoft17: boolean;
  /** Rounds in the game. */
  rounds: number;
  chips: number;
}

export const classicBlackjack: BlackjackRules = { id: "bj-classic", name: "Blackjack (10 rounds)", decks: 2, hitSoft17: false, rounds: 10, chips: 200 };
export const longBlackjack: BlackjackRules = { ...classicBlackjack, id: "bj-long", name: "Long game (20 rounds)", rounds: 20, chips: 500 };
export const vegasBlackjack: BlackjackRules = { ...classicBlackjack, id: "bj-vegas", name: "Six decks, dealer hits soft 17", decks: 6, hitSoft17: true };

export const BETS = [10, 20, 50, 100];

export interface BjHand {
  cards: KCard[];
  bet: number;
  done: boolean;
  doubled: boolean;
  split: boolean;
}

export interface BlackjackState {
  game: "blackjack";
  rules: BlackjackRules;
  seats: number;
  rng: number;
  hand: number;
  dealerSeat: number;
  shoe: KCard[];
  chips: number[];
  /** Each seat's hands this round (two after a split); empty while betting or sitting out. */
  hands: BjHand[][];
  /** Which of the current seat's hands is being played. */
  active: number;
  dealer: KCard[];
  revealed: boolean;
  turn: number;
  phase: "bet" | "play" | "settled" | "finished";
  /** Chips won or lost by each seat this round. */
  net: number[];
  ready: boolean[];
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const cardValue = (c: KCard) => (rank(c) === 14 ? 11 : Math.min(rank(c), 10));

/** The best total, and whether an ace still counts 11 ("soft"). */
export function total(cards: KCard[]): { value: number; soft: boolean } {
  let value = 0;
  let aces = 0;
  for (const c of cards) {
    value += cardValue(c);
    if (rank(c) === 14) aces++;
  }
  while (value > 21 && aces) {
    value -= 10;
    aces--;
  }
  return { value, soft: aces > 0 };
}
const natural = (h: { cards: KCard[]; split?: boolean }) => h.cards.length === 2 && !h.split && total(h.cards).value === 21;
const label = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[(c as { suit: keyof typeof SYMBOL }).suit]}`;
const describeTotal = (cards: KCard[]) => {
  const t = total(cards);
  if (t.value > 21) return `${t.value}, bust`;
  if (cards.length === 2 && t.value === 21) return "Blackjack";
  return t.soft && t.value < 21 ? `soft ${t.value}` : String(t.value);
};

function draw(s: BlackjackState): KCard {
  if (!s.shoe.length) s.shoe = shuffled(makeDeck({ ranks: FULL, copies: s.rules.decks }), nextRandom(s));
  return s.shoe.pop()!;
}

const playing = (s: BlackjackState) => s.chips.flatMap((c, i) => (c > 0 ? [i] : []));
const minBet = (s: BlackjackState, seat: number) => Math.min(BETS[0]!, s.chips[seat]!);

function startBetting(s: BlackjackState) {
  // Reshuffle when a quarter of the shoe is left.
  if (s.shoe.length < s.rules.decks * 13) s.shoe = shuffled(makeDeck({ ranks: FULL, copies: s.rules.decks }), nextRandom(s));
  s.hands = Array.from({ length: s.seats }, () => []);
  s.dealer = [];
  s.revealed = false;
  s.net = Array(s.seats).fill(0);
  s.ready = s.chips.map((c) => c <= 0);
  s.phase = "bet";
  s.narration = null;
}

export function newBlackjack(rules: BlackjackRules, seats: number, seed: number): BlackjackState {
  const s = { game: "blackjack", rules, seats, rng: seed >>> 0, hand: 0, dealerSeat: seed % seats, shoe: [], active: 0, turn: 0 } as unknown as BlackjackState;
  s.chips = Array(seats).fill(rules.chips);
  startBetting(s);
  return s;
}

function deal(s: BlackjackState) {
  const order = playing(s).filter((i) => s.hands[i]!.length);
  for (let round = 0; round < 2; round++) {
    for (const i of order) s.hands[i]![0]!.cards.push(draw(s));
    s.dealer.push(draw(s));
  }
  for (const i of order) if (natural(s.hands[i]![0]!)) s.hands[i]![0]!.done = true;
  // The dealer checks for blackjack under an ace or a ten.
  if (natural({ cards: s.dealer })) {
    s.narration = "The dealer has blackjack";
    return settle(s);
  }
  s.phase = "play";
  s.turn = order[0]!;
  s.active = 0;
  advance(s, true);
}

/** Move on to the next hand that still needs playing; when none is left, the dealer plays. */
function advance(s: BlackjackState, fromHere = false) {
  const order = playing(s).filter((i) => s.hands[i]!.length);
  let seatIdx = order.indexOf(s.turn);
  let handIdx = fromHere ? s.active : s.active + 1;
  while (seatIdx < order.length) {
    const hands = s.hands[order[seatIdx]!]!;
    while (handIdx < hands.length) {
      if (!hands[handIdx]!.done) {
        s.turn = order[seatIdx]!;
        s.active = handIdx;
        return;
      }
      handIdx++;
    }
    seatIdx++;
    handIdx = 0;
  }
  dealerPlays(s);
}

function dealerPlays(s: BlackjackState) {
  s.revealed = true;
  const live = s.hands.flat().some((h) => total(h.cards).value <= 21 && !natural(h));
  if (live) {
    for (;;) {
      const t = total(s.dealer);
      if (t.value < 17 || (t.value === 17 && t.soft && s.rules.hitSoft17)) s.dealer.push(draw(s));
      else break;
    }
  }
  settle(s);
}

function settle(s: BlackjackState) {
  s.revealed = true;
  const d = total(s.dealer).value;
  const dealerNatural = natural({ cards: s.dealer });
  for (let i = 0; i < s.seats; i++) {
    let net = 0;
    for (const h of s.hands[i]!) {
      const v = total(h.cards).value;
      if (natural(h)) net += dealerNatural ? 0 : Math.floor((h.bet * 3) / 2);
      else if (dealerNatural) net -= h.bet;
      else if (v > 21) net -= h.bet;
      else if (d > 21 || v > d) net += h.bet;
      else if (v < d) net -= h.bet;
    }
    s.net[i] = net;
    s.chips[i] = s.chips[i]! + net;
  }
  const dealerLine = d > 21 ? `The dealer busts with ${d}` : dealerNatural ? "The dealer has blackjack" : `The dealer stands on ${d}`;
  s.narration = dealerLine;
  s.ready = s.chips.map((c, i) => c <= 0 && !s.hands[i]!.length);
  const last = s.hand + 1 >= s.rules.rounds || playing(s).length === 0;
  s.phase = last ? "finished" : "settled";
}

type Move = { type: "bet"; amount: number } | { type: "hit" } | { type: "stand" } | { type: "double" } | { type: "split" } | { type: "next" };

function current(s: BlackjackState): BjHand {
  return s.hands[s.turn]![s.active]!;
}
function staked(s: BlackjackState, seat: number) {
  return s.hands[seat]!.reduce((n, h) => n + h.bet, 0);
}
const canDouble = (s: BlackjackState, seat: number) => {
  const h = current(s);
  return h.cards.length === 2 && s.chips[seat]! - staked(s, seat) >= h.bet && !(h.split && rank(h.cards[0]!) === 14);
};
const canSplit = (s: BlackjackState, seat: number) => {
  const h = current(s);
  return s.hands[seat]!.length === 1 && h.cards.length === 2 && cardValue(h.cards[0]!) === cardValue(h.cards[1]!) && s.chips[seat]! - staked(s, seat) >= h.bet;
};

function apply(state: BlackjackState, seat: number, move: Move): BlackjackState {
  const s = clone(state);
  switch (move.type) {
    case "bet": {
      if (s.phase !== "bet") throw new GameError("Bets are in.");
      if (s.ready[seat]) throw new GameError(s.chips[seat]! <= 0 ? "You're out of chips." : "You've bet already.");
      const amount = Number(move.amount);
      if (!(amount >= minBet(s, seat) && amount <= s.chips[seat]!)) throw new GameError(`Bet between ${minBet(s, seat)} and ${s.chips[seat]}.`);
      s.hands[seat] = [{ cards: [], bet: amount, done: false, doubled: false, split: false }];
      s.ready[seat] = true;
      if (s.ready.every(Boolean)) deal(s);
      return s;
    }
    case "next": {
      if (s.phase !== "settled") throw new GameError("The round isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        startBetting(s);
      }
      return s;
    }
  }
  if (s.phase !== "play" || s.turn !== seat) throw new GameError("It's not your turn.");
  const h = current(s);
  switch (move.type) {
    case "hit": {
      const c = draw(s);
      h.cards.push(c);
      const t = total(h.cards).value;
      s.narration = `${who(seat)} drew the ${label(c)}: ${describeTotal(h.cards)}`;
      if (t >= 21) {
        h.done = true;
        advance(s);
      }
      return s;
    }
    case "stand": {
      h.done = true;
      s.narration = `${who(seat)} stands on ${total(h.cards).value}`;
      advance(s);
      return s;
    }
    case "double": {
      if (!canDouble(s, seat)) throw new GameError(h.cards.length !== 2 ? "Double on your first two cards." : "You don't have the chips to double.");
      h.bet *= 2;
      h.doubled = true;
      const c = draw(s);
      h.cards.push(c);
      h.done = true;
      s.narration = `${who(seat)} doubled and drew the ${label(c)}: ${describeTotal(h.cards)}`;
      advance(s);
      return s;
    }
    case "split": {
      if (!canSplit(s, seat)) throw new GameError(h.cards.length === 2 && cardValue(h.cards[0]!) === cardValue(h.cards[1]!) ? "You don't have the chips to split." : "Split a pair on your first two cards.");
      const [a, b] = h.cards as [KCard, KCard];
      const aces = rank(a) === 14;
      s.hands[seat] = [
        { cards: [a, draw(s)], bet: h.bet, done: aces, doubled: false, split: true },
        { cards: [b, draw(s)], bet: h.bet, done: aces, doubled: false, split: true },
      ];
      for (const x of s.hands[seat]!) if (total(x.cards).value === 21) x.done = true;
      s.narration = `${who(seat)} split the ${rankLabel(rank(a))}s${aces ? " (one card each on aces)" : ""}`;
      s.active = 0;
      advance(s, true);
      return s;
    }
    default:
      throw new GameError("That's not a move in Blackjack.");
  }
}

function view(s: BlackjackState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.phase === "play" && s.turn === seat;
  const myHands = s.hands[seat]!;
  const activeIdx = s.phase === "play" && s.turn === seat ? s.active : 0;
  const shownHand = myHands[activeIdx]?.cards ?? [];
  const melds: Meld[] = [];
  s.hands.forEach((hands, i) =>
    hands.forEach((h, k) => {
      if (i === seat && k === activeIdx) return;
      if (!h.cards.length) return;
      melds.push({ owner: i, label: `${describeTotal(h.cards)} · bet ${h.bet}`, cards: h.cards });
    }),
  );
  let choices: KitView["choices"] = null;
  if (s.phase === "bet" && !s.ready[seat]) {
    const options: Choice[] = BETS.filter((b) => b <= s.chips[seat]!).map((b) => ({ label: `Bet ${b}`, move: { type: "bet", amount: b } }));
    if (!options.length) options.push({ label: `Bet ${s.chips[seat]}`, move: { type: "bet", amount: s.chips[seat]! } });
    choices = { prompt: `You have ${s.chips[seat]} chips. Place your bet.`, options, layout: "row" };
  } else if (mine) {
    const options: Choice[] = [
      { label: "Hit", move: { type: "hit" }, primary: true },
      { label: "Stand", move: { type: "stand" } },
    ];
    if (canDouble(s, seat)) options.push({ label: "Double", move: { type: "double" }, hint: `Bet ${current(s).bet} more, take one card` });
    if (canSplit(s, seat)) options.push({ label: "Split", move: { type: "split" }, hint: "Two hands, a bet on each" });
    choices = { prompt: myHands.length > 1 ? `Hand ${activeIdx + 1} of 2: ${describeTotal(shownHand)}` : `You have ${describeTotal(shownHand)}`, options, layout: "row" };
  } else if (s.phase === "settled" && !s.ready[seat]) choices = { prompt: "", options: [{ label: "Next round", move: { type: "next" }, primary: true }] };
  const dealerShown = s.revealed ? s.dealer : s.dealer.slice(0, 1);
  const net = (n: number) => (n > 0 ? `won ${n}` : n < 0 ? `lost ${-n}` : "even");
  return {
    game: "blackjack",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "play" ? s.turn : null,
    dealer: s.dealerSeat,
    hand: shownHand,
    pick: null,
    tap: null,
    choices,
    players: s.chips.map((c, i) => ({
      cards: i === seat ? shownHand.length : s.hands[i]!.reduce((n, h) => n + h.cards.length, 0),
      line: c <= 0 && !s.hands[i]!.length ? "Out of chips" : `${c} chips${s.hands[i]!.length && s.phase !== "settled" && !over ? ` · bet ${staked(s, i)}` : ""}`,
      out: c <= 0 && !s.hands[i]!.length,
      badge: s.phase === "settled" || over ? (s.hands[i]!.length ? net(s.net[i]!) : undefined) : undefined,
    })),
    center: {
      kind: "piles",
      stock: null,
      discard: dealerShown,
      discardCount: s.dealer.length,
      drawMove: null,
      takeMove: null,
      spread: { type: "none", cards: [] },
      spreadHidden: s.revealed ? 0 : s.dealer.length - 1,
      discardLabel: !s.dealer.length ? "The dealer deals when every bet is in" : s.revealed ? `Dealer: ${describeTotal(s.dealer)}` : `Dealer shows ${label(s.dealer[0]!)}`,
    },
    melds,
    info: [
      `Round ${Math.min(s.hand + 1, s.rules.rounds)} of ${s.rules.rounds}`,
      ...(shownHand.length && !mine ? [`You: ${describeTotal(shownHand)}`] : []),
      `Dealer stands on ${s.rules.hitSoft17 ? "hard " : ""}17`,
      "Chips only",
    ],
    narration: s.narration,
    scores: s.chips.map((value, i) => ({ seats: [i], value })),
    result:
      s.phase === "settled" || over
        ? {
            key: `bj-${s.hand}`,
            title: s.narration ?? "The round",
            sides: s.chips.map((_, i) => [i]),
            rows: [
              { label: "This round", values: s.net.map((n, i) => (s.hands[i]!.length ? (n > 0 ? `+${n}` : String(n)) : "—")) },
              { label: "Chips", values: s.chips.map(String), tone: "total" as const },
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: s.seats === 1 ? `You finished with ${s.chips[0]} chips` : `${who(winners(s)[0]!)} wins with ${Math.max(...s.chips)} chips!` } : null,
  };
}

function winners(s: BlackjackState): number[] {
  if (s.seats === 1) return s.chips[0]! > s.rules.chips ? [0] : [];
  const best = Math.max(...s.chips);
  return s.chips.flatMap((c, i) => (c === best ? [i] : []));
}

// ---- Computer players --------------------------------------------------------------------------

/** Basic strategy, a little simplified: what a careful player does with this hand against that up card. */
export function basic(cards: KCard[], up: KCard, canDbl: boolean, canSpl: boolean): "hit" | "stand" | "double" | "split" {
  const d = cardValue(up);
  const t = total(cards);
  if (canSpl) {
    const r = cardValue(cards[0]!);
    if (r === 11 || r === 8) return "split";
    if ((r === 9 && d !== 7 && d < 10) || ((r === 2 || r === 3 || r === 7) && d <= 7) || (r === 6 && d <= 6)) return "split";
  }
  if (t.soft) {
    if (t.value >= 19) return "stand";
    if (t.value === 18) return canDbl && d >= 3 && d <= 6 ? "double" : d >= 9 ? "hit" : "stand";
    if (canDbl && d >= 4 && d <= 6 && t.value >= 15) return "double";
    return "hit";
  }
  if (t.value >= 17) return "stand";
  if (t.value >= 13) return d <= 6 ? "stand" : "hit";
  if (t.value === 12) return d >= 4 && d <= 6 ? "stand" : "hit";
  if (t.value === 11) return canDbl ? "double" : "hit";
  if (t.value === 10) return canDbl && d <= 9 ? "double" : "hit";
  if (t.value === 9) return canDbl && d >= 3 && d <= 6 ? "double" : "hit";
  return "hit";
}

function bot(s: BlackjackState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "bet") {
    if (s.ready[seat]) return null;
    const bold = style.bold ?? 0.3;
    const can = BETS.filter((b) => b <= s.chips[seat]! && b <= s.chips[seat]! * (0.15 + bold * 0.3));
    return { type: "bet", amount: can.length ? can[Math.min(can.length - 1, Math.floor(Math.random() * 2 + bold * 2))]! : minBet(s, seat) };
  }
  if (s.phase === "settled") return s.ready[seat] ? null : { type: "next" };
  if (s.phase !== "play" || s.turn !== seat) return null;
  const h = current(s);
  if (Math.random() < (style.sloppy ?? 0) * 0.5) return { type: total(h.cards).value < 15 ? "hit" : "stand" };
  const pick = basic(h.cards, s.dealer[0]!, canDouble(s, seat), canSplit(s, seat));
  return { type: pick };
}

export const blackjack: CardGame<BlackjackRules, BlackjackState, Move> = {
  id: "blackjack",
  name: "Blackjack",
  emoji: "🃏",
  blurb: "Get closer to 21 than the dealer (chips only)",
  tagline: "Everyone against the dealer. Hit, stand, double or split, and don't go over 21. Chips only.",
  seats: { min: 1, max: 5, default: 3 },
  teams: false,
  presets: [classicBlackjack, longBlackjack, vegasBlackjack],
  fields: [
    { key: "rounds", label: "Rounds", kind: "choice", options: [[5, "5"], [10, "10"], [20, "20"], [30, "30"]] },
    { key: "chips", label: "Starting chips", kind: "choice", options: [[100, "100"], [200, "200"], [500, "500"]] },
    { key: "decks", label: "Decks in the shoe", kind: "choice", options: [[1, "1"], [2, "2"], [6, "6"]] },
    { key: "hitSoft17", label: "Dealer hits soft 17", hint: "An ace counted as 11 making 17: the dealer draws again.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<BlackjackRules>;
    const base = [classicBlackjack, longBlackjack, vegasBlackjack].find((p) => p.id === given.id) ?? classicBlackjack;
    const r = { ...base, ...given };
    return { ...r, rounds: Number(r.rounds), chips: Number(r.chips), decks: Number(r.decks) };
  },
  validate(r) {
    const errors: string[] = [];
    if (!(r.rounds >= 1 && r.rounds <= 100)) errors.push("Play between 1 and 100 rounds.");
    if (!(r.chips >= 50 && r.chips <= 10000)) errors.push("Start with between 50 and 10,000 chips.");
    if (!(r.decks >= 1 && r.decks <= 8)) errors.push("Use between 1 and 8 decks.");
    return errors;
  },
  describe(r) {
    return [
      `Chips only. Everyone starts with ${r.chips} and plays against the dealer for ${r.rounds} rounds.`,
      "Bet, then you and the dealer get two cards (one of the dealer's face down). Aces count 1 or 11, faces 10.",
      "Hit to take a card, stand when you're happy. Over 21 and you bust: you lose your bet.",
      "Double: on your first two cards, double your bet and take exactly one more card. Split: two cards of the same value become two hands, a bet on each (split aces get one card each).",
      `Then the dealer draws to 17${r.hitSoft17 ? ", and hits a soft 17" : ""}. Beat the dealer (or the dealer busts) and you win your bet; tie and you keep it. A blackjack on the deal pays 3 to 2.`,
      "Most chips at the end wins.",
    ];
  },
  newGame: newBlackjack,
  apply,
  view,
  bot,
  thinkingTime(s) {
    if (s.phase === "bet") return 900;
    if (s.phase === "settled") return 2200;
    return thinkFor(3, 0.9);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "blackjack",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.chips.join(" · ") + " chips",
      order: over ? rankSeats(s.chips.map((score, i) => ({ seats: [i], score }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
