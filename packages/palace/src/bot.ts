// Palace bots. A good player dumps low cards, saves 2s and 10s for when they're stuck, burns a big
// pile, finishes a four-of-a-kind, and puts strong cards face-up for the endgame. A careless one
// doesn't. The same personas as spades play here, each in their own style.
import { cardId, mulberry32, personaFor, type PlayStyle } from "@spades/rules";
import { canPickUp, options, sourceOf, type PCard, type PalaceAction, type PalaceState } from "./game.js";

/** How much a card is worth keeping: specials most, then aces down. */
export function keepValue(rank: number, s: PalaceState): number {
  if (s.rules.tenBurns && rank === 10) return 20;
  if (s.rules.twoResets && rank === 2) return 19;
  return rank;
}

const rand = (s: PalaceState, seat: number) => mulberry32((s.seed ^ (s.moves * 7919) ^ (seat << 12)) >>> 0);

/** Before play: one swap at a time toward strong cards face-up, then ready. */
function swapStep(s: PalaceState, seat: number, style: PlayStyle): PalaceAction {
  const p = s.players[seat]!;
  const r = rand(s, seat);
  if (r() < (style.sloppy ?? 0) * 2) return { type: "ready", seat };
  const bestHand = [...p.hand].sort((a, b) => keepValue(b.rank, s) - keepValue(a.rank, s))[0];
  const worstUp = [...p.up].sort((a, b) => keepValue(a.rank, s) - keepValue(b.rank, s))[0];
  if (bestHand && worstUp && keepValue(bestHand.rank, s) > keepValue(worstUp.rank, s)) {
    return { type: "swap", seat, hand: cardId(bestHand), up: cardId(worstUp) };
  }
  return { type: "ready", seat };
}

/** The action a bot takes now, or null when it isn't this seat's turn to act. */
export function palaceBot(s: PalaceState, seat: number, style: PlayStyle = {}): PalaceAction | null {
  const p = s.players[seat];
  if (!p || p.place !== null || s.phase === "finished") return null;
  if (s.phase === "swapping") return p.ready ? null : swapStep(s, seat, style);
  if (s.turn !== seat) return null;
  const r = rand(s, seat);
  const from = sourceOf(p);
  if (from === "down") return { type: "flip", seat, index: Math.floor(r() * p.down.length) };
  const opts = options(s, seat);
  if (!opts.length) return canPickUp(s, seat) ? { type: "pickup", seat } : null;
  const cards = p[from!];
  const play = (rank: number) => ({ type: "play" as const, seat, cards: cards.filter((c: PCard) => c.rank === rank).map(cardId) });

  // A careless or green player plays whatever comes to hand.
  const skill = style.skill ?? 1;
  if (r() < (style.sloppy ?? 0) + (1 - skill) * 0.35) return play(opts[Math.floor(r() * opts.length)]!.rank);

  const top = s.pile[s.pile.length - 1];
  const run = top ? s.pile.slice().reverse().findIndex((c) => c.rank !== top.rank) : 0;
  const onTop = top ? (run === -1 ? s.pile.length : run) : 0;
  // Finishing four of a kind burns the pile and keeps the turn.
  if (s.rules.fourBurns && top) {
    const four = opts.find((o) => o.rank === top.rank && onTop + o.count >= 4);
    if (four) return play(four.rank);
  }
  const plainOpts = opts.filter((o) => keepValue(o.rank, s) === o.rank);
  // A big pile is worth burning, if we can.
  const ten = opts.find((o) => s.rules.tenBurns && o.rank === 10);
  const bold = style.bold ?? 0;
  if (ten && s.pile.length >= 6 - Math.round(bold * 2) && (!plainOpts.length || s.pile.length >= 8)) return play(10);
  // Otherwise the lowest ordinary card; specials only when there's nothing else.
  if (plainOpts.length) return play(plainOpts[0]!.rank);
  const special = [...opts].sort((a, b) => keepValue(a.rank, s) - keepValue(b.rank, s))[0]!;
  // With pickUpAnytime, a patient player takes a tiny pile rather than spend a 10.
  if (s.rules.pickUpAnytime && s.pile.length <= 2 && bold < 0.5 && canPickUp(s, seat)) return { type: "pickup", seat };
  return play(special.rank);
}

/** How long a bot takes, like a person: a forced move is quick, a choice takes a beat. */
export function palaceThinkingTime(s: PalaceState, seat: number, name: string): number {
  const r = rand(s, seat);
  const pace = personaFor(name).pace;
  const jitter = 0.8 + r() * 0.5;
  if (s.phase === "swapping") return Math.round((900 + r() * 1400) * pace * jitter);
  const p = s.players[seat]!;
  if (sourceOf(p) === "down") return Math.round((1100 + r() * 900) * pace * jitter);
  const n = options(s, seat).length;
  if (n <= 1) return Math.round((650 + r() * 500) * pace);
  return Math.round((900 + Math.min(n, 4) * 350) * pace * jitter);
}
