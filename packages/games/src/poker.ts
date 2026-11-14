// Poker's shared parts, for chips only (points, never money): ranking hands, fixed-limit betting
// rounds, and settling the pot (side pots included) at the showdown. Five Card Draw and Texas
// Hold'em are built on these.
import { GameError, rankLabel, who, type KCard, type PipCard } from "./kit.js";

// ---- Ranking hands ------------------------------------------------------------------------------

const rankOf = (c: KCard) => (c as PipCard).rank;
const suitOf = (c: KCard) => (c as PipCard).suit;

export const CATEGORY = ["High card", "One pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"] as const;

/** A five-card hand's strength: its category, then the ranks that break ties. Compare with compareScore. */
export function score5(cards: KCard[]): number[] {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  // Ranks by how many there are, then how high.
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = new Set(cards.map(suitOf)).size === 1;
  const unique = [...counts.keys()].sort((a, b) => b - a);
  let straightHigh = 0;
  if (unique.length === 5) {
    if (unique[0]! - unique[4]! === 4) straightHigh = unique[0]!;
    else if (unique.join() === "14,5,4,3,2") straightHigh = 5; // the wheel: A 2 3 4 5
  }
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0]![1] === 4) return [7, groups[0]![0], groups[1]![0]];
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return [6, groups[0]![0], groups[1]![0]];
  if (flush) return [5, ...ranks];
  if (straightHigh) return [4, straightHigh];
  if (groups[0]![1] === 3) return [3, groups[0]![0], ...groups.slice(1).map((g) => g[0])];
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return [2, groups[0]![0], groups[1]![0], groups[2]![0]];
  if (groups[0]![1] === 2) return [1, groups[0]![0], ...groups.slice(1).map((g) => g[0])];
  return [0, ...ranks];
}

export function compareScore(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

/** The best five cards of five to seven, and their score. */
export function bestHand(cards: KCard[]): { score: number[]; cards: KCard[] } {
  let best: { score: number[]; cards: KCard[] } | null = null;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const five = [cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!];
            const score = score5(five);
            if (!best || compareScore(score, best.score) > 0) best = { score, cards: five };
          }
  return best!;
}

const plural = (r: number) => ({ 14: "aces", 13: "kings", 12: "queens", 11: "jacks", 10: "tens", 9: "nines", 8: "eights", 7: "sevens", 6: "sixes", 5: "fives", 4: "fours", 3: "threes", 2: "twos" })[r] ?? `${r}s`;
const single = (r: number) => ({ 14: "ace", 13: "king", 12: "queen", 11: "jack", 10: "ten", 9: "nine", 8: "eight", 7: "seven", 6: "six", 5: "five", 4: "four", 3: "three", 2: "two" })[r] ?? String(r);

/** A hand's name, as you'd say it at the table: "two pair, kings and sevens". */
export function handName(score: number[]): string {
  const [cat, a = 0, b = 0] = score;
  switch (cat) {
    case 8:
      return a === 14 ? "a royal flush" : `a straight flush to the ${single(a)}`;
    case 7:
      return `four ${plural(a)}`;
    case 6:
      return `a full house, ${plural(a)} full of ${plural(b)}`;
    case 5:
      return `a flush, ${single(a)} high`;
    case 4:
      return `a straight to the ${single(a)}`;
    case 3:
      return `three ${plural(a)}`;
    case 2:
      return `two pair, ${plural(a)} and ${plural(b)}`;
    case 1:
      return `a pair of ${plural(a)}`;
    default:
      return `${single(a)} high`;
  }
}

/** Roughly how strong a made hand is, 0 to 1, for the computer players. */
export function strengthOf(score: number[]): number {
  const [cat = 0, a = 2] = score;
  const base = [0.05, 0.3, 0.55, 0.68, 0.78, 0.84, 0.92, 0.97, 0.99][cat]!;
  const span = [0.2, 0.22, 0.1, 0.08, 0.05, 0.05, 0.04, 0.02, 0.01][cat]!;
  return Math.min(1, base + ((a - 2) / 12) * span);
}

// ---- Fixed-limit betting -------------------------------------------------------------------------

export interface Betting {
  /** Chips each player has behind (not yet in the pot). */
  stacks: number[];
  /** Still in this hand (dealt in and not folded). */
  live: boolean[];
  /** Chips each player has put in this hand, and this betting round. */
  committed: number[];
  roundBet: number[];
  /** The bet to match this round, the size of a bet or raise, and how many have been made. */
  toMatch: number;
  size: number;
  raises: number;
  /** Players who have acted since the last bet or raise. */
  acted: boolean[];
  turn: number;
}

export const MAX_RAISES = 4;
export const allIn = (b: Betting, seat: number) => b.live[seat]! && b.stacks[seat] === 0;
export const pot = (b: Betting) => b.committed.reduce((n, x) => n + x, 0);
/** Players who can still act this round: in the hand with chips behind. */
const canAct = (b: Betting, seat: number) => b.live[seat]! && b.stacks[seat]! > 0;

/** Put chips in (as many as the player has: short of that is all in). */
export function putIn(b: Betting, seat: number, chips: number) {
  const n = Math.min(chips, b.stacks[seat]!);
  b.stacks[seat]! -= n;
  b.committed[seat]! += n;
  b.roundBet[seat]! += n;
}

/** Start a betting round: no bets yet (blinds are put in by the caller), first to act given. */
export function newRound(b: Betting, size: number, first: number) {
  b.roundBet = b.roundBet.map(() => 0);
  b.toMatch = 0;
  b.size = size;
  b.raises = 0;
  b.acted = b.acted.map(() => false);
  b.turn = nextToAct(b, first - 1) ?? first;
}

/** The next player after `from` who can act, or null. */
export function nextToAct(b: Betting, from: number): number | null {
  const n = b.stacks.length;
  for (let i = 1; i <= n; i++) {
    const seat = (((from + i) % n) + n) % n;
    if (canAct(b, seat)) return seat;
  }
  return null;
}

/** The round is over: everyone who can act has, and has matched the bet. */
export function roundDone(b: Betting): boolean {
  if (b.live.filter(Boolean).length <= 1) return true;
  const actors = b.stacks.map((_, i) => i).filter((i) => canAct(b, i));
  if (actors.length === 0) return true;
  // One player left with chips and nothing to call: no one to bet against.
  if (actors.length === 1 && b.roundBet[actors[0]!]! >= b.toMatch) return true;
  return actors.every((i) => b.acted[i] && b.roundBet[i] === b.toMatch);
}

export type BetMove = { type: "fold" } | { type: "check" } | { type: "call" } | { type: "raise" };

/** What this player may do now, with the chips each costs. */
export function options(b: Betting, seat: number): { fold: boolean; check: boolean; call: number | null; raise: number | null } {
  const owe = b.toMatch - b.roundBet[seat]!;
  const stack = b.stacks[seat]!;
  const othersCanCall = b.stacks.some((s, i) => i !== seat && b.live[i] && s > 0);
  return {
    fold: owe > 0,
    check: owe === 0,
    call: owe > 0 ? Math.min(owe, stack) : null,
    raise: b.raises < MAX_RAISES && stack > owe && othersCanCall ? Math.min(owe + b.size, stack) : null,
  };
}

/** Apply a betting move. Returns a few words for the news. */
export function bet(b: Betting, seat: number, move: BetMove): string {
  if (b.turn !== seat) throw new GameError("It's not your turn to bet.");
  const opt = options(b, seat);
  let words: string;
  switch (move.type) {
    case "fold":
      if (!opt.fold) throw new GameError("There's nothing to call: check instead.");
      b.live[seat] = false;
      words = "folds";
      break;
    case "check":
      if (!opt.check) throw new GameError(`It's ${b.toMatch - b.roundBet[seat]!} to call.`);
      words = "checks";
      break;
    case "call":
      if (opt.call === null) throw new GameError("There's nothing to call.");
      putIn(b, seat, opt.call);
      words = b.stacks[seat] === 0 ? `calls ${opt.call}, all in` : `calls ${opt.call}`;
      break;
    case "raise": {
      if (opt.raise === null) throw new GameError(b.raises >= MAX_RAISES ? "The betting is capped this round." : "You can't raise now.");
      const was = b.toMatch;
      putIn(b, seat, opt.raise);
      b.toMatch = Math.max(b.toMatch, b.roundBet[seat]!);
      // A short all-in that doesn't make a full raise doesn't reopen the betting.
      if (b.toMatch - was >= b.size) {
        b.raises += 1;
        b.acted = b.acted.map(() => false);
      }
      words = was === 0 ? `bets ${b.roundBet[seat]}` : `raises to ${b.roundBet[seat]}`;
      if (b.stacks[seat] === 0) words += ", all in";
      break;
    }
    default:
      throw new GameError("That's not a betting move.");
  }
  b.acted[seat] = true;
  b.turn = nextToAct(b, seat) ?? seat;
  return words;
}

/**
 * Share out the pot at the showdown: main pot and side pots, each to the best hand among those who
 * paid into it (ties split; odd chips to the first winner after the dealer). Returns chips won.
 */
export function settle(b: Betting, scores: (number[] | null)[], dealer: number): number[] {
  const n = b.stacks.length;
  const won = Array.from({ length: n }, () => 0);
  const levels = [...new Set(b.committed.filter((c, i) => c > 0 && b.live[i]))].sort((x, y) => x - y);
  let prev = 0;
  let left = pot(b);
  for (const level of levels) {
    const slice = b.committed.reduce((sum, c) => sum + Math.max(0, Math.min(c, level) - prev), 0);
    const eligible = b.committed.map((c, i) => i).filter((i) => b.live[i] && b.committed[i]! >= level && scores[i]);
    if (eligible.length) {
      const top = eligible.reduce((best, i) => (compareScore(scores[i]!, scores[best]!) > 0 ? i : best), eligible[0]!);
      const winners = eligible.filter((i) => compareScore(scores[i]!, scores[top]!) === 0).sort((x, y) => ((x - dealer - 1 + n) % n) - ((y - dealer - 1 + n) % n));
      const share = Math.floor(slice / winners.length);
      winners.forEach((i, k) => (won[i]! += share + (k < slice - share * winners.length ? 1 : 0)));
      left -= slice;
    }
    prev = level;
  }
  // Anything left over (from folded players above every live player's level) goes to the best hand.
  if (left > 0) {
    const live = b.live.map((l, i) => (l ? i : -1)).filter((i) => i >= 0 && scores[i]);
    const top = live.reduce((best, i) => (compareScore(scores[i]!, scores[best]!) > 0 ? i : best), live[0]!);
    won[top]! += left;
  }
  for (let i = 0; i < n; i++) b.stacks[i]! += won[i]!;
  return won;
}

/** Everyone but one folded: they take it all without showing. */
export function lastStanding(b: Betting): number | null {
  const live = b.live.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
  return live.length === 1 ? live[0]! : null;
}

/** The betting buttons for whoever's turn it is. */
export function betChoices(b: Betting, seat: number, wording: { bet: string; raise: string } = { bet: "Bet", raise: "Raise to" }) {
  const o = options(b, seat);
  const out: { label: string; move: BetMove; primary?: boolean }[] = [];
  if (o.fold) out.push({ label: "Fold", move: { type: "fold" } });
  if (o.check) out.push({ label: "Check", move: { type: "check" }, primary: true });
  if (o.call !== null) out.push({ label: o.call === b.stacks[seat] ? `Call ${o.call} (all in)` : `Call ${o.call}`, move: { type: "call" }, primary: true });
  if (o.raise !== null) out.push({ label: b.toMatch === 0 ? `${wording.bet} ${o.raise}` : `${wording.raise} ${b.roundBet[seat]! + o.raise}`, move: { type: "raise" } });
  return out;
}

/** For a computer player: fold, check/call or raise, from how strong its hand is and its nerve. */
export function decide(b: Betting, seat: number, strength: number, bold: number, rand: () => number = Math.random): BetMove {
  const o = options(b, seat);
  const owe = o.call ?? 0;
  const potOdds = owe / (pot(b) + owe || 1);
  const bluff = rand() < 0.06 + bold * 0.1;
  if (o.raise !== null && (strength > 0.72 - bold * 0.08 || (bluff && strength > 0.15)) && rand() < 0.8) return { type: "raise" };
  if (o.check) return { type: "check" };
  if (strength > potOdds + 0.12 - bold * 0.06 || owe <= b.size / 2) return { type: "call" };
  return { type: "fold" };
}

export const chipsWord = (n: number) => `${n} chip${n === 1 ? "" : "s"}`;
export { rankLabel, who };
