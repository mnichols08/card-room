// A thinking bot. It sees only what a player at the table sees: its own hand, every card played
// this hand, the bids and the score. From those it works out what it can't see (who is out of
// which suit, which cards are still out there), deals the unseen cards many ways that fit what it
// knows and what each player bid, plays each of its options out to the end of the hand in every
// deal, and plays the card that scores best for its team on average.
//
// Partnership comes out of the scoring: trumping a partner's winner, or letting a partner's nil
// get set, scores badly in most deals, so it isn't chosen.
import { chooseCard as rolloutCard, choosePass, estimateTricks } from "./bot.js";
import { buildDeck, cardId, cardPower, effectiveSuit, isTrump, mulberry32 } from "./cards.js";
import { applyAction, canBidBlindNil, passingSeats, type Action, type GameState } from "./game.js";
import { partnerOf, teamOf } from "./scoring.js";
import { legalPlays } from "./tricks.js";
import type { Bid, Card, Seat, Suit, Team } from "./types.js";

const SUITS: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
/** How strongly the bot believes bids: higher means it trusts them more. */
// Measured over 60 games against the simple bots: 85% wins without reading bids, 90% at 0.55.
const BID_READING = 0.55;
const SEATS: Seat[] = [0, 1, 2, 3];

export interface Knowledge {
  /** Cards this seat hasn't seen: not in its hand, not played. */
  unseen: Card[];
  /** How many cards each seat still holds. */
  counts: number[];
  /** voids[seat] = suits that seat has shown it's out of. */
  voids: Set<Suit>[];
}

/** What a seat knows about the hands it can't see, from the cards played so far. */
export function knowledge(s: GameState, seat: Seat): Knowledge {
  const p = s.preset;
  const played = s.played ?? [];
  const seen = new Set([...s.hands[seat]!.map(cardId), ...played.map((x) => cardId(x.card))]);
  const unseen = buildDeck(p).filter((c) => !seen.has(cardId(c)));
  const voids = SEATS.map(() => new Set<Suit>());

  let broken = false;
  for (let start = 0; start < played.length; start += 4) {
    const trick = played.slice(start, start + 4);
    const led = effectiveSuit(trick[0]!.card, p);
    // Leading trump before it was broken means holding nothing else.
    if (led === "spades" && !broken && p.spadesMustBeBroken) for (const suit of SUITS) if (suit !== "spades") voids[trick[0]!.seat]!.add(suit);
    for (const play of trick.slice(1)) if (effectiveSuit(play.card, p) !== led) voids[play.seat]!.add(led);
    if (trick.some((x) => isTrump(x.card, p))) broken = true;
  }
  return { unseen, counts: s.hands.map((h) => h.length), voids };
}

/**
 * Deal the unseen cards to the other seats in a way that fits what's known: each seat gets as
 * many cards as it holds, and nothing in a suit it has shown it's out of. Null if a try fails.
 */
export function sampleDeal(s: GameState, seat: Seat, k: Knowledge, rand: () => number): Card[][] | null {
  const others = SEATS.filter((x) => x !== seat);
  const room = k.counts.slice();
  room[seat] = 0;
  const hands: Card[][] = [[], [], [], []];
  hands[seat] = [...s.hands[seat]!];
  // Most constrained cards first: those only a few seats can hold.
  const cards = k.unseen
    .map((c) => ({ c, r: rand(), ok: others.filter((o) => !k.voids[o]!.has(effectiveSuit(c, s.preset))) }))
    .sort((a, b) => a.ok.length - b.ok.length || a.r - b.r);
  for (const { c, ok } of cards) {
    const open = ok.filter((o) => room[o]! > 0);
    if (open.length === 0) return null;
    // Prefer seats with more room, so late cards still have somewhere to go.
    const total = open.reduce<number>((n, o) => n + room[o]!, 0);
    let pick = rand() * total;
    let chosen = open[0]!;
    for (const o of open) {
      pick -= room[o]!;
      if (pick <= 0) {
        chosen = o;
        break;
      }
    }
    hands[chosen]!.push(c);
    room[chosen]! -= 1;
  }
  return hands;
}

/**
 * How well a deal fits what each player bid. A hand that bid six should look like six tricks; a
 * nil bidder should hold little. This is how the bot reads the table: big bids mean strength.
 */
function plausibility(s: GameState, seat: Seat, hands: Card[][]): number {
  let w = 1;
  for (const o of SEATS) {
    if (o === seat) continue;
    const bid = s.bids[o];
    if (!bid || bid.kind === "blind-nil") continue; // a blind bid says nothing about the cards
    // Judge the hand as it was when they bid: what they hold now plus what they've played.
    const original = [...hands[o]!, ...(s.played ?? []).filter((x) => x.seat === o).map((x) => x.card)];
    if (original.length !== 13) continue;
    const expected = estimateTricks(original, s.preset);
    const target = bid.kind === "nil" ? 0 : bid.count;
    w *= Math.exp(-BID_READING * Math.abs(expected - target));
  }
  return w;
}

/** Play a determinized deal to the end of the hand with the quick policy; score it for `team`. */
function rollout(start: GameState, team: Team): number {
  let s = start;
  const hand = s.handNumber;
  for (let guard = 0; guard < 60 && s.handNumber === hand && s.phase === "playing"; guard++) {
    const seat = s.turn;
    s = applyAction(s, { type: "play", seat, card: rolloutCard(s, seat) });
  }
  const record = s.history[s.history.length - 1];
  if (!record || record.handNumber !== hand) return 0;
  const ours = record.results[team];
  const theirs = record.results[(1 - team) as Team];
  // Points for us, minus points for them; a little extra weight on avoiding bag penalties.
  return ours.delta - theirs.delta - (ours.bagPenalty - theirs.bagPenalty) * 0.25;
}

/**
 * How a bot plays, as a person would: not every partner is a card shark.
 * All fields are optional; the defaults are the full-strength thinking bot.
 */
export interface PlayStyle {
  /** 0–1: how hard it thinks (how many hands it imagines). 1 is full strength. */
  skill?: number;
  /** 0–1: chance of a careless card instead of a thought-out one. */
  sloppy?: number;
  /** -1 to 1: underbids (negative) or overbids (positive), by up to about a trick. */
  bold?: number;
  /** 0–1: how readily it goes nil (0.5 is the default judgment). Above 0.8 it'll try blind nil. */
  nilLove?: number;
}

export interface ThinkOptions {
  /** Deals to try. More is stronger and slower. Default 40. */
  deals?: number;
  /** How this bot plays. */
  style?: PlayStyle;
  /** Seed for the deals, so a decision can be replayed. Default: from the game. */
  seed?: number;
}

const strength = (c: Card, s: GameState) => (isTrump(c, s.preset) ? 100 : 0) + cardPower(c, s.preset);

/** The card to play, with how each option scored (for tests and for a bot's mood). */
export function thinkCard(s: GameState, seat: Seat, opts: ThinkOptions = {}): { card: Card; scores: { card: Card; score: number }[] } {
  const legal = legalPlays(s.hands[seat]!, s.trick, s.spadesBroken, s.preset);
  if (legal.length === 1) return { card: legal[0]!, scores: [{ card: legal[0]!, score: 0 }] };

  const seed = opts.seed ?? (s.seed ^ (s.handNumber * 7919) ^ ((s.played?.length ?? 0) * 104729) ^ (seat * 15485863)) >>> 0;
  const rand = mulberry32(seed);
  const style = opts.style ?? {};
  // A careless moment: the first thing that comes to mind, or just any legal card.
  if (style.sloppy && rand() < style.sloppy) {
    const card = rand() < 0.5 ? rolloutCard(s, seat) : legal[Math.floor(rand() * legal.length)]!;
    return { card, scores: [] };
  }
  const k = knowledge(s, seat);
  const team = teamOf(seat);
  const skill = style.skill ?? 1;
  // Imagining fewer hands is thinking less: a skill of 0 still imagines a couple.
  const wanted = opts.deals ?? Math.max(2, Math.round(2 + 38 * skill * skill));

  // The same deals for every option, so differences come from the choice, not the luck.
  const deals: { hands: Card[][]; w: number }[] = [];
  for (let tries = 0; deals.length < wanted && tries < wanted * 4; tries++) {
    const hands = sampleDeal(s, seat, k, rand);
    if (hands) deals.push({ hands, w: plausibility(s, seat, hands) });
  }
  if (deals.length === 0) return { card: rolloutCard(s, seat), scores: [] };
  const totalW = deals.reduce((n, d) => n + d.w, 0) || 1;

  const scores = legal.map((card) => {
    let sum = 0;
    for (const d of deals) {
      const start = applyAction({ ...s, hands: d.hands }, { type: "play", seat, card });
      sum += d.w * rollout(start, team);
    }
    return { card, score: sum / totalW };
  });
  // Best score; among near-ties, keep the stronger card in hand.
  const best = Math.max(...scores.map((x) => x.score));
  const close = scores.filter((x) => x.score >= best - 0.5).sort((a, b) => strength(a.card, s) - strength(b.card, s));
  return { card: close[0]!.card, scores };
}

/** A bid from the hand, the partner's bid, what's left to bid, and the score. */
export function thinkBid(s: GameState, seat: Seat, style: PlayStyle = {}): Bid {
  const p = s.preset;
  const nilLove = style.nilLove ?? 0.5;
  const dice = mulberry32((s.seed ^ (s.handNumber * 2654435761) ^ (seat * 97)) >>> 0);
  const partner = partnerOf(seat);
  const partnerBid = s.bids[partner];
  const myTeam = teamOf(seat);
  const behind = s.scores[(1 - myTeam) as Team].points - s.scores[myTeam].points;

  // Blind nil is decided before looking, so it rests on the score alone: a long way behind,
  // with a partner who hasn't gone nil, it's worth the swing.
  const partnerNil = partnerBid?.kind === "nil" || partnerBid?.kind === "blind-nil";
  if (canBidBlindNil(s, seat) && behind >= 200 && !partnerNil && dice() < 0.4 * (nilLove / 0.5)) return { kind: "blind-nil" };
  // Daredevils go blind nil just for the thrill when they're behind at all.
  if (canBidBlindNil(s, seat) && nilLove > 0.8 && behind > 0 && !partnerNil && dice() < 0.12) return { kind: "blind-nil" };

  const hand = s.hands[seat]!;
  const spades = hand.filter((c) => isTrump(c, p));
  const high = hand.filter((c) => cardPower(c, p) >= 12);
  const estimate = estimateTricks(hand, p);
  const partnerIsNil = partnerBid?.kind === "nil" || partnerBid?.kind === "blind-nil";

  // Nil: few and low spades, almost no high cards, and a partner who can carry the bid.
  // Nil lovers stretch for it; nil haters need a hopeless hand.
  const spadeCap = nilLove > 0.7 ? 10 : nilLove < 0.3 ? 7 : 9;
  const lowSpades = spades.every((c) => cardPower(c, p) <= spadeCap) && spades.length <= (nilLove > 0.7 ? 4 : 3);
  const estimateCap = 0.6 + 1.4 * nilLove;
  if (p.nil.enabled && !partnerIsNil && lowSpades && high.length <= (nilLove > 0.7 ? 2 : 1) && estimate < estimateCap) return { kind: "nil" };

  // Boldness shades the bid by up to about a trick, rounding by chance.
  const shaded = estimate + (style.bold ?? 0) * 1.1;
  let count = Math.floor(shaded) + (dice() < shaded - Math.floor(shaded) ? 1 : 0);
  if (partnerIsNil) count += 1; // covering for a nil takes tricks of its own
  // Don't push the table past 13 when the others have spoken: someone is overbidding.
  const others = SEATS.filter((x) => x !== seat).reduce<number>((n, x) => n + (s.bids[x]?.kind === "tricks" ? (s.bids[x] as { count: number }).count : 0), 0);
  if (others + count > 13) count = Math.max(1, 13 - others);
  // Near the bag limit, bid a little fuller rather than sandbag.
  if (p.bags && s.scores[myTeam].bags >= p.bags.limit - 2 && estimate - count > 0.3) count += 1;
  count = Math.max(1, Math.min(13, count));
  if (p.minTeamBid !== null && partnerBid?.kind === "tricks" && partnerBid.count + count < p.minTeamBid) count = p.minTeamBid - partnerBid.count;
  return { kind: "tricks", count };
}

/** The next action for a thinking bot in `seat`, or null if it isn't the bot's move. */
export function smartAction(s: GameState, seat: Seat, opts: ThinkOptions = {}): Action | null {
  if (s.phase === "bidding" && s.turn === seat) return { type: "bid", seat, bid: thinkBid(s, seat, opts.style) };
  if (s.phase === "passing" && passingSeats(s).includes(seat) && !s.passes[seat]) return { type: "pass", seat, cards: choosePass(s, seat) };
  if (s.phase === "playing" && s.turn === seat) return { type: "play", seat, card: thinkCard(s, seat, opts).card };
  return null;
}


