// Switch (also Last Card, or Mau-Mau): Uno's ancestor, with an ordinary deck. Match the top card by
// suit or rank. Aces are wild and change the suit; a two makes the next player pick up two (stack
// another two to pass it on); an eight skips the next player; a jack reverses the direction. Down to
// one card? Call "Last card!" first, or pick up two. First one out wins.
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
  type PipCard,
} from "./kit.js";

export interface SwitchRules extends BaseRules {
  /** Draw one and pass, or draw until you can play. */
  draw: "until" | "one";
  /** One hand (first out wins) or points: the winner scores what's left in everyone's hands. */
  scoring: "single" | "points";
  playTo: number;
  /** You must call "Last card!" before going down to one card, or pick up two. */
  lastCard: boolean;
}

export const classicSwitch: SwitchRules = { id: "switch-classic", name: "Switch", draw: "one", scoring: "single", playTo: 100, lastCard: true };
export const pointsSwitch: SwitchRules = { ...classicSwitch, id: "switch-points", name: "Points to 100", scoring: "points" };
export const easySwitch: SwitchRules = { ...classicSwitch, id: "switch-easy", name: "No last-card call", lastCard: false };
const POWER = { wild: 14, draw: 2, skip: 8, reverse: 11 };

type Phase = "playing" | "suit" | "scored" | "finished";

export interface SwitchState {
  game: "switch";
  rules: SwitchRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  stock: KCard[];
  discard: KCard[];
  /** The suit to match: the top card's, or the one named with an eight. */
  suit: Suit;
  turn: number;
  direction: 1 | -1;
  /** Cards the next player must draw (from 2s). */
  owed: number;
  /** This turn's player has drawn (under draw-one they may then pass). */
  drew: boolean;
  /** Turns in a row where nobody could play or draw anything: a full round ends the hand. */
  stuck: number;
  /** How often the discards have been shuffled into a new stock this hand (at most twice). */
  reshuffles: number;
  /** Who has called "Last card!" (and still holds two or fewer). */
  called: boolean[];
  scores: number[];
  lastHand: { winner: number; points: number; left: number[] } | null;
  ready: boolean[];
  narration: string | null;
}

const rank = (c: KCard) => (c as PipCard).rank;
const suitOf = (c: KCard) => (c as PipCard).suit as Suit;
const top = (s: SwitchState) => s.discard[s.discard.length - 1]!;
const cardPoints = (c: KCard) => (rank(c) === POWER.wild ? 50 : rank(c) === POWER.draw ? 20 : rank(c) >= 11 || rank(c) === 8 ? 10 : rank(c));
const step = (s: SwitchState, from: number, by = 1) => (((from + s.direction * by) % s.seats) + s.seats) % s.seats;

/** Twice a hand at most: without a limit, a hand where only eights are left going round never ends. */
const MAX_RESHUFFLES = 2;

function refill(s: SwitchState) {
  if (s.stock.length || s.discard.length <= 1 || s.reshuffles >= MAX_RESHUFFLES) return;
  s.reshuffles += 1;
  const keep = s.discard.pop()!;
  s.stock = shuffled(s.discard, nextRandom(s));
  s.discard = [keep];
}

function deal(s: SwitchState) {
  const rand = nextRandom(s);
  const deck = shuffled(makeDeck({ ranks: FULL }), rand);
  const n = s.seats === 2 ? 7 : 5;
  s.hands = Array.from({ length: s.seats }, (_, i) => sortCards(deck.slice(i * n, (i + 1) * n)));
  let rest = deck.slice(s.seats * n);
  // Don't start on a power card: bury it.
  while ([2, 8, 11, 14].includes(rank(rest[0]!))) rest = [...rest.slice(1), rest[0]!];
  s.discard = [rest[0]!];
  s.stock = rest.slice(1);
  s.suit = suitOf(rest[0]!);
  s.turn = (s.dealer + 1) % s.seats;
  s.direction = 1;
  s.owed = 0;
  s.drew = false;
  s.stuck = 0;
  s.reshuffles = 0;
  s.called = Array(s.seats).fill(false);
  s.ready = Array(s.seats).fill(false);
  s.phase = "playing";
  s.narration = null;
}

export function newSwitch(rules: SwitchRules, seats: number, seed: number): SwitchState {
  const s = { game: "switch", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, scores: Array(seats).fill(0), lastHand: null } as unknown as SwitchState;
  deal(s);
  return s;
}

/** Cards this seat may play now: matching suit or rank, or an ace. Facing twos, only another two. */
export function switchLegal(s: SwitchState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  if (s.owed > 0) return s.hands[seat]!.filter((c) => rank(c) === POWER.draw);
  const t = top(s);
  return s.hands[seat]!.filter((c) => rank(c) === POWER.wild || suitOf(c) === s.suit || rank(c) === rank(t));
}


/** Nothing to draw, now or after a reshuffle. */
const dry = (s: SwitchState) => s.stock.length === 0 && (s.discard.length <= 1 || s.reshuffles >= MAX_RESHUFFLES);
const canDraw = (s: SwitchState, seat: number) => s.phase === "playing" && s.turn === seat && (s.owed > 0 || (switchLegal(s, seat).length === 0 && !dry(s) && !(s.rules.draw === "one" && s.drew)));
const canPass = (s: SwitchState, seat: number) => s.phase === "playing" && s.turn === seat && s.owed === 0 && switchLegal(s, seat).length === 0 && ((s.rules.draw === "one" && s.drew) || dry(s));

function endTurn(s: SwitchState, skip = 0) {
  s.drew = false;
  s.turn = step(s, s.turn, 1 + skip);
}

type Move = { type: "play"; card: string } | { type: "suit"; suit: Suit } | { type: "draw" } | { type: "pass" } | { type: "last" } | { type: "next" };

function apply(state: SwitchState, seat: number, move: Move): SwitchState {
  const s = clone(state);
  switch (move.type) {
    case "next": {
      if (s.phase !== "scored") throw new GameError("The hand isn't over.");
      if (markReady(s.ready, seat)) {
        s.hand += 1;
        s.dealer = (s.dealer + 1) % s.seats;
        deal(s);
      }
      return s;
    }
    case "last": {
      if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
      if (!s.rules.lastCard || s.hands[seat]!.length !== 2) throw new GameError("Call it when you're about to play down to one card.");
      s.called[seat] = true;
      s.narration = `${who(seat)}: "Last card!"`;
      return s;
    }
    case "draw": {
      if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
      if (!canDraw(s, seat)) throw new GameError(switchLegal(s, seat).length ? "You have a card that plays: play it." : "You've drawn: play it if you can, or pass.");
      const n = s.owed > 0 ? s.owed : 1;
      let got = 0;
      for (let i = 0; i < n; i++) {
        refill(s);
        const card = s.stock.pop();
        if (!card) break;
        s.hands[seat] = sortCards([...s.hands[seat]!, card]);
        got++;
      }
      if (s.hands[seat]!.length > 2) s.called[seat] = false;
      if (s.owed > 0) {
        s.narration = `${who(seat)} picked up ${got}`;
        s.owed = 0;
        endTurn(s);
        return s;
      }
      s.drew = true;
      s.narration = `${who(seat)} drew a card`;
      // Nothing left to draw and nothing to play: the turn passes.
      if (got === 0 && switchLegal(s, seat).length === 0) return blocked(s);
      return s;
    }
    case "pass": {
      if (!canPass(s, seat)) throw new GameError(switchLegal(s, seat).length ? "You have a card that plays." : "Draw a card first.");
      s.narration = `${who(seat)} passed`;
      if (dry(s)) return blocked(s);
      endTurn(s);
      return s;
    }
    case "suit": {
      if (s.phase !== "suit" || s.turn !== seat) throw new GameError("It's not time to name a suit.");
      if (!SUITS.includes(move.suit)) throw new GameError("That's not a suit.");
      s.suit = move.suit;
      s.phase = "playing";
      s.narration = `${who(seat)} played an ace: ${SYMBOL[move.suit]} now`;
      endTurn(s);
      return s;
    }
    case "play": {
      if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
      const card = s.hands[seat]!.find((c) => c.id === move.card);
      if (!card) throw new GameError("You don't have that card.");
      if (!switchLegal(s, seat).some((c) => c.id === card.id)) throw new GameError(s.owed > 0 ? `Play a two to pass it on, or pick up ${s.owed}.` : `Match the ${SYMBOL[s.suit]} or a ${rankLabel(rank(top(s)))}, or play an ace.`);
      s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
      s.discard.push(card);
      s.stuck = 0;
      s.suit = suitOf(card);
      if (s.hands[seat]!.length === 0) {
        scoreHand(s, seat);
        return s;
      }
      // Down to one card without calling it: pick up two.
      let penalty = "";
      if (s.rules.lastCard && s.hands[seat]!.length === 1 && !s.called[seat]) {
        for (let i = 0; i < 2; i++) {
          refill(s);
          const c = s.stock.pop();
          if (c) s.hands[seat] = sortCards([...s.hands[seat]!, c]);
        }
        penalty = ` and forgot to call last card: ${who(seat)} picks up two`;
      }
      if (rank(card) === POWER.wild) {
        s.phase = "suit";
        s.narration = penalty ? `${who(seat)} played an ace${penalty}` : null;
        return s;
      }
      s.narration = penalty ? `${who(seat)} played${penalty}` : null;
      let skip = 0;
      if (rank(card) === POWER.draw) {
        s.owed += 2;
        s.narration = `${who(seat)} played a 2${penalty}`;
      } else if (rank(card) === POWER.skip) {
        skip = 1;
        s.narration = `${who(seat)} skipped ${who(step(s, seat))}${penalty}`;
      } else if (rank(card) === POWER.reverse) {
        if (s.seats === 2) skip = 1;
        else s.direction = s.direction === 1 ? -1 : 1;
        s.narration = `${who(seat)} reversed the direction${penalty}`;
      }
      endTurn(s, skip);
      return s;
    }
    default:
      throw new GameError("That's not a move in Switch.");
  }
}

/** Nobody can play and there's nothing to draw. After a full round of that, the lowest hand wins. */
function blocked(s: SwitchState): SwitchState {
  s.stuck += 1;
  if (s.stuck < s.seats) {
    endTurn(s);
    return s;
  }
  const left = s.hands.map((h) => h.reduce((n, c) => n + cardPoints(c), 0));
  const winner = left.indexOf(Math.min(...left));
  scoreHand(s, winner);
  s.narration = `Nobody can play: ${who(winner)} has the lowest hand and wins it`;
  return s;
}

function scoreHand(s: SwitchState, winner: number) {
  const left = s.hands.map((h) => h.reduce((n, c) => n + cardPoints(c), 0));
  const points = left.reduce((a, b) => a + b, 0);
  if (s.rules.scoring === "points") s.scores[winner]! += points;
  else s.scores[winner]! += 1;
  s.lastHand = { winner, points, left };
  s.narration = `${who(winner)} went out! 🎉`;
  s.ready = Array(s.seats).fill(false);
  const done = s.rules.scoring === "single" || s.scores.some((n) => n >= s.rules.playTo);
  s.phase = done ? "finished" : "scored";
}

function winners(s: SwitchState): number[] {
  if (s.rules.scoring === "single") return s.lastHand ? [s.lastHand.winner] : [];
  const best = Math.max(...s.scores);
  return s.scores.flatMap((n, i) => (n === best ? [i] : []));
}

function finishOrder(s: SwitchState): number[] {
  if (s.rules.scoring === "points") return rankSeats(s.scores.map((score, i) => ({ seats: [i], score })));
  // One hand: the winner, then whoever holds the fewest points.
  const w = s.lastHand!.winner;
  return [w, ...rankSeats(s.hands.map((h, i) => ({ seats: [i], score: s.lastHand!.left[i]! })).filter((x) => x.seats[0] !== w), true)];
}

function view(s: SwitchState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.turn === seat && (s.phase === "playing" || s.phase === "suit");
  const legal = switchLegal(s, seat).map((c) => c.id);
  const options = [];
  if (s.phase === "suit" && s.turn === seat) for (const suit of SUITS) options.push({ label: SYMBOL[suit], move: { type: "suit", suit } });
  if (s.rules.lastCard && s.phase === "playing" && s.turn === seat && s.hands[seat]!.length === 2 && !s.called[seat] && switchLegal(s, seat).length) options.push({ label: "Last card!", move: { type: "last" } });
  if (canPass(s, seat)) options.push({ label: "Pass", move: { type: "pass" } });
  return {
    game: "switch",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" || s.phase === "suit" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: s.phase === "playing" && s.turn === seat ? { type: "play", cards: legal } : null,
    pick: null,
    choices: options.length
      ? { prompt: s.phase === "suit" ? "Your ace: name the suit." : options.some((o) => o.move.type === "last") ? "" : "Nothing plays.", options, layout: s.phase === "suit" ? "row" : undefined }
      : s.phase === "scored" && !s.ready[seat]
        ? { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] }
        : null,
    players: s.hands.map((h, i) => ({ cards: h.length, line: h.length === 1 ? "Last card!" : "", dealer: i === s.dealer })),
    center: {
      kind: "piles",
      stock: s.stock.length,
      discard: s.discard.slice(-3),
      discardCount: s.discard.length,
      drawMove: mine && canDraw(s, seat) ? { type: "draw" } : null,
      takeMove: null,
      note: s.suit !== suitOf(top(s)) ? `Suit: ${SYMBOL[s.suit]}` : null,
      ...(dry(s) ? { stockLabel: "No more to draw" } : {}),
    },
    melds: [],
    info: [
      s.owed > 0 ? `Pick up ${s.owed}, or play a 2 to pass it on` : `Match ${SYMBOL[s.suit]}${rank(top(s)) === POWER.wild ? "" : ` or ${rankLabel(rank(top(s)))}`} · aces are wild`,
      ...(s.seats > 2 ? [s.direction === 1 ? "Play goes left ↻" : "Play goes right ↺"] : []),
      ...(s.rules.scoring === "points" ? [`To ${s.rules.playTo}`] : []),
    ],
    narration: s.narration,
    scores: s.scores.map((value, i) => ({ seats: [i], value })),
    result:
      s.lastHand && (s.phase === "scored" || over)
        ? {
            key: `switch-${s.hand}`,
            title: `${who(s.lastHand.winner)} went out!`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "Left in hand", values: s.lastHand.left.map((n, i) => (i === s.lastHand!.winner ? "—" : String(n))) },
              ...(s.rules.scoring === "points" ? [{ label: "Score", values: s.scores.map(String), tone: "total" as const }] : []),
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: `${who(winners(s)[0]!)} wins!` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: SwitchState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.turn !== seat) return null;
  const hand = s.hands[seat]!;
  const count = (suit: Suit) => hand.filter((c) => suitOf(c) === suit && rank(c) !== POWER.wild).length;
  if (s.phase === "suit") return { type: "suit", suit: [...SUITS].sort((a, b) => count(b) - count(a))[0]! };
  if (s.phase !== "playing") return null;
  const legal = switchLegal(s, seat);
  // Remember to call it (careless players sometimes forget).
  if (s.rules.lastCard && hand.length === 2 && !s.called[seat] && legal.length && Math.random() > (style.sloppy ?? 0) * 0.5) return { type: "last" };
  if (!legal.length) return canDraw(s, seat) ? { type: "draw" } : canPass(s, seat) ? { type: "pass" } : null;
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  if (sloppy) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  const next = step(s, seat);
  const nextLow = s.hands[next]!.length <= 2;
  const value = (c: KCard) => {
    if (rank(c) === POWER.wild) return hand.length === 1 ? 100 : -50; // keep aces for when nothing else plays
    let v = count(suitOf(c)) * 3 + rank(c) / 10; // play from your long suit, shed high cards first
    if (nextLow && [POWER.draw, POWER.skip].includes(rank(c))) v += 20;
    return v;
  };
  return { type: "play", card: [...legal].sort((a, b) => value(b) - value(a))[0]!.id };
}

export const switchGame: CardGame<SwitchRules, SwitchState, Move> = {
  id: "switch",
  name: "Switch",
  emoji: "🔀",
  blurb: "Uno's ancestor, with an ordinary deck",
  tagline: "Match the card, twos make them pick up, eights skip, jacks reverse, aces change the suit. Don't forget \"Last card!\"",
  seats: { min: 2, max: 6, default: 4 },
  teams: false,
  presets: [classicSwitch, pointsSwitch, easySwitch],
  fields: [
    { key: "draw", label: "When you can't play", kind: "choice", options: [["one", "Draw one, then pass"], ["until", "Draw until you can"]] },
    { key: "scoring", label: "Scoring", kind: "choice", options: [["single", "One hand: first out wins"], ["points", "Points: winner scores what's left"]] },
    { key: "playTo", label: "Points game to", kind: "choice", options: [[50, "50"], [100, "100"], [200, "200"]] },
    { key: "lastCard", label: "Call \"Last card!\"", hint: "Before you play down to one card, or pick up two.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SwitchRules>;
    const base = [classicSwitch, pointsSwitch, easySwitch].find((p) => p.id === given.id) ?? classicSwitch;
    return { ...base, ...given };
  },
  validate(r) {
    const errors: string[] = [];
    if (!["until", "one"].includes(r.draw)) errors.push("Pick a drawing rule.");
    if (!["single", "points"].includes(r.scoring)) errors.push("Pick a way to score.");
    if (!(r.playTo >= 25 && r.playTo <= 500)) errors.push("Play to between 25 and 500.");
    return errors;
  },
  describe(r) {
    return [
      "Seven cards each for two players, five for more. Match the top card by suit or by number.",
      "Aces are wild: play one any time and name the next suit. A 2 makes the next player pick up two, unless they play a 2 of their own, which passes on four (and so on). An 8 skips the next player. A jack reverses the direction.",
      r.draw === "until" ? "Can't play? Draw until you can." : "Can't play? Draw one; if it still doesn't play, pass.",
      ...(r.lastCard ? ["About to play down to one card? Call \"Last card!\" first, or pick up two."] : []),
      r.scoring === "single" ? "First to get rid of every card wins." : `The first one out scores the cards left in everyone's hands (aces 50, 2s 20, 8s and faces 10, others face value). First to ${r.playTo} wins.`,
    ];
  },
  newGame: newSwitch,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "scored") return 900;
    if (s.phase === "suit") return 1100;
    return thinkFor(switchLegal(s, seat).length, 0.8);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "switch",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.rules.scoring === "points" ? s.scores.join(" · ") : s.hands.map((h) => h.length).join(" · ") + " cards",
      order: over ? finishOrder(s) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
