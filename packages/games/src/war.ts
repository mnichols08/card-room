// War for 2 to 4: the whole deck is dealt face down. Everyone flips their top card at once and the
// highest takes them all. A tie for highest is a war: three cards down, one up, between the tied
// players, until somebody wins the lot. No decisions, so it's about the flip; games end when one
// player has every card, or after a set number of flips (most cards wins).
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
  who,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type PipCard,
} from "./kit.js";

export interface WarRules extends BaseRules {
  /** Flips before the game ends and the most cards wins; 0 = until someone has them all. */
  limit: number;
  /** Cards each player puts face down in a war (then one face up). */
  warDown: number;
}

export const quickWar: WarRules = { id: "war-quick", name: "Quick War (50 flips)", limit: 50, warDown: 3 };
export const longWar: WarRules = { ...quickWar, id: "war-classic", name: "Classic (until someone has them all)", limit: 0 };
export const littleWar: WarRules = { ...quickWar, id: "war-little", name: "Little war (one card down)", warDown: 1 };

/** Even "until someone has them all" stops here, and the most cards wins. */
export const WAR_SAFETY_LIMIT = 2000;

type Phase = "flipping" | "finished";

export interface WarState {
  game: "war";
  rules: WarRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  /** Each player's face-down pile, top card first. */
  decks: KCard[][];
  /** Who has pressed Flip for the next battle. */
  ready: boolean[];
  battles: number;
  /** The last battle: the face-up cards, who won, how many wars it took and how many cards were won. */
  last: { plays: { seat: number; card: KCard }[]; winner: number | null; wars: number; pot: number } | null;
  narration: string | null;
}

const rankOf = (c: KCard) => (c as PipCard).rank;
const name = (c: KCard) => rankLabel(rankOf(c));
const alive = (s: WarState) => s.decks.map((d, i) => i).filter((i) => s.decks[i]!.length > 0);

export function newWar(rules: WarRules, seats: number, seed: number): WarState {
  const s = { game: "war", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, battles: 0, last: null, narration: null } as unknown as WarState;
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.decks = Array.from({ length: seats }, () => []);
  deck.forEach((c, i) => s.decks[(s.dealer + 1 + i) % seats]!.push(c));
  s.ready = Array.from({ length: seats }, () => false);
  s.phase = "flipping";
  return s;
}

/** One battle, wars and all. Everyone still holding cards has flipped. */
function battle(s: WarState) {
  const rand = nextRandom(s);
  const pot: KCard[] = [];
  const shown = new Map<number, KCard>();
  let contenders = alive(s);
  let wars = 0;
  let winner: number | null = null;
  for (let round = 0; round < 60 && contenders.length; round++) {
    const flips = new Map<number, KCard>();
    for (const seat of contenders) {
      const card = s.decks[seat]!.shift();
      if (!card) continue;
      pot.push(card);
      flips.set(seat, card);
      shown.set(seat, card);
    }
    if (!flips.size) break;
    const best = Math.max(...[...flips.values()].map(rankOf));
    const tied = [...flips.keys()].filter((seat) => rankOf(flips.get(seat)!) === best);
    if (tied.length === 1) {
      winner = tied[0]!;
      break;
    }
    // War: the tied players put cards face down, keeping one to flip. Someone with nothing left to flip drops out.
    wars++;
    for (const seat of tied) pot.push(...s.decks[seat]!.splice(0, Math.min(s.rules.warDown, Math.max(0, s.decks[seat]!.length - 1))));
    const able = tied.filter((seat) => s.decks[seat]!.length > 0);
    if (able.length === 1) {
      winner = able[0]!;
      break;
    }
    if (!able.length) break;
    contenders = able;
  }
  if (winner !== null) {
    // The winnings go under the winner's pile, mixed up (always the same order could loop forever).
    s.decks[winner]!.push(...shuffled(pot, rand));
  } else {
    // Everyone in the war ran out at once: the cards go back around, one each.
    const back = alive(s).length ? alive(s) : [...shown.keys()];
    shuffled(pot, rand).forEach((c, i) => s.decks[back[i % back.length]!]!.push(c));
  }
  s.battles += 1;
  s.last = { plays: [...shown].map(([seat, card]) => ({ seat, card })), winner, wars, pot: pot.length };
  const plays = [...shown];
  if (winner === null) s.narration = "Nobody could finish the war: the cards went back around.";
  else if (wars) s.narration = `${wars > 1 ? `${wars} wars! ` : "War! "}The ${name(shown.get(winner)!)} wins it: ${pot.length} cards to ${who(winner)}`;
  else if (plays.length === 2) s.narration = `The ${name(shown.get(winner)!)} beats the ${name(plays.find(([seat]) => seat !== winner)![1])}: two cards to ${who(winner)}`;
  else s.narration = `The ${name(shown.get(winner)!)} is highest: ${plays.length} cards to ${who(winner)}`;
  const limit = s.rules.limit || WAR_SAFETY_LIMIT;
  if (alive(s).length <= 1 || s.battles >= limit) s.phase = "finished";
  s.ready = s.decks.map((d) => d.length === 0);
}

type Move = { type: "flip" };

function apply(state: WarState, seat: number, move: Move): WarState {
  const s = clone(state);
  if (move.type !== "flip") throw new GameError("That's not a move in War.");
  if (s.phase !== "flipping") throw new GameError("The game is over.");
  if (!s.decks[seat]!.length) throw new GameError("You're out of cards.");
  if (markReady(s.ready, seat)) battle(s);
  return s;
}

function winners(s: WarState): number[] {
  const counts = s.decks.map((d) => d.length);
  const best = Math.max(...counts);
  return counts.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
}

function view(s: WarState, seat: number): KitView {
  const over = s.phase === "finished";
  const w = over ? winners(s) : [];
  const waiting = !over && s.decks[seat]!.length > 0 && !s.ready[seat];
  const limit = s.rules.limit;
  return {
    game: "war",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: null,
    dealer: s.dealer,
    hand: [],
    handHidden: true,
    tap: null,
    pick: null,
    choices: waiting ? { prompt: "", options: [{ label: "Flip!", move: { type: "flip" }, primary: true }] } : null,
    players: s.decks.map((d) => ({ cards: d.length, line: d.length ? "" : "Out", out: d.length === 0 })),
    center: {
      kind: "trick",
      plays: s.last?.plays ?? [],
      winner: s.last?.winner ?? null,
      lead: s.last?.wars ? `War${s.last.wars > 1 ? ` ×${s.last.wars}` : ""}! ${s.last.pot} cards` : null,
    },
    melds: [],
    info: [limit ? `Flip ${Math.min(s.battles + (over ? 0 : 1), limit)} of ${limit}` : `Flip ${s.battles + (over ? 0 : 1)}`],
    narration: s.narration,
    scores: s.decks.map((d, i) => ({ seats: [i], value: d.length })),
    result: null,
    over: over ? { winners: w, title: w.length > 1 ? "It's a tie!" : s.decks[w[0]!]!.length === 52 ? `${who(w[0]!)} won every card!` : `${who(w[0]!)} wins with ${s.decks[w[0]!]!.length} cards` } : null,
  };
}

function bot(s: WarState, seat: number, _style: PlayStyle): Move | null {
  return s.phase === "flipping" && s.decks[seat]!.length > 0 && !s.ready[seat] ? { type: "flip" } : null;
}

export const war: CardGame<WarRules, WarState, Move> = {
  id: "war",
  name: "War",
  emoji: "⚔️",
  blurb: "Flip, and the highest card takes all",
  tagline: "Everybody flips, the highest card takes them all, and a tie means war.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: [quickWar, longWar, littleWar],
  fields: [
    { key: "limit", label: "Game ends", kind: "choice", options: [[25, "After 25 flips"], [50, "After 50 flips"], [100, "After 100 flips"], [0, "When someone has every card"]] },
    { key: "warDown", label: "Cards down in a war", kind: "choice", options: [[1, "One"], [2, "Two"], [3, "Three"]] },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<WarRules>;
    const base = [quickWar, longWar, littleWar].find((p) => p.id === given.id) ?? quickWar;
    const merged = { ...base, ...given };
    return { ...merged, limit: Math.max(0, Math.round(Number(merged.limit) || 0)), warDown: Math.min(3, Math.max(1, Math.round(Number(merged.warDown) || 3))) };
  },
  validate: (r) => (r.limit < 0 || r.limit > 1000 ? ["Flips between 1 and 1,000 (or no limit)."] : []),
  describe(r) {
    return [
      "The whole deck is dealt face down. Nobody looks.",
      "Everybody flips their top card at once. Highest card takes them all (aces are high), under your pile.",
      `A tie for highest is war: the tied players put ${r.warDown === 1 ? "a card" : `${r.warDown} cards`} face down and flip one more. Highest takes everything on the table. Run short of cards and you go to war with what you have.`,
      r.limit ? `After ${r.limit} flips, whoever has the most cards wins.` : "Play until someone has every card.",
    ];
  },
  newGame: newWar,
  apply,
  view,
  bot,
  thinkingTime: () => 500,
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "war",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.battles,
      scoreLine: s.decks.map((d) => d.length).join(" · ") + " cards",
      order: over ? rankSeats(s.decks.map((d, i) => ({ seats: [i], score: d.length }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};
