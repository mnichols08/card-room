import { cardId, deal, isTrump, sameCard, sortHand } from "./cards.js";
import { gameWinner, partnerOf, scoreTeamHand, seatsOf, teamOf, type TeamHandResult } from "./scoring.js";
import { legalPlays, trickWinner, type Play } from "./tricks.js";
import type { Bid, Card, RulePreset, Seat, Team, TeamScore } from "./types.js";

export class RuleError extends Error {
  override name = "RuleError";
}

export type Phase = "bidding" | "passing" | "playing" | "finished";

export interface HandRecord {
  handNumber: number;
  dealer: Seat;
  bids: Bid[];
  tricksWon: number[];
  results: [TeamHandResult, TeamHandResult];
}

export interface GameState {
  /** Snapshotted at game start so editing the house preset never changes a game in progress. */
  preset: RulePreset;
  seed: number;
  handNumber: number;
  dealer: Seat;
  phase: Phase;
  hands: Card[][];
  bids: (Bid | null)[];
  /** Cards chosen to pass during the blind nil passing phase. */
  passes: (Card[] | null)[];
  turn: Seat;
  trick: Play[];
  lastTrick: { plays: Play[]; winner: Seat } | null;
  /** Every card played this hand, in order: completed tricks, then the trick in progress. Public. */
  played: Play[];
  tricksWon: number[];
  spadesBroken: boolean;
  scores: [TeamScore, TeamScore];
  history: HandRecord[];
  winner: Team | null;
}

export type Action =
  | { type: "bid"; seat: Seat; bid: Bid }
  | { type: "pass"; seat: Seat; cards: Card[] }
  | { type: "play"; seat: Seat; card: Card };

const next = (seat: Seat): Seat => ((seat + 1) % 4) as Seat;

export function newGame(preset: RulePreset, seed: number, dealer: Seat = 0): GameState {
  return startHand({
    preset,
    seed,
    handNumber: 0,
    dealer,
    phase: "bidding",
    hands: [],
    bids: [],
    passes: [],
    turn: next(dealer),
    trick: [],
    lastTrick: null,
    played: [],
    tricksWon: [0, 0, 0, 0],
    spadesBroken: false,
    scores: [
      { points: 0, bags: 0 },
      { points: 0, bags: 0 },
    ],
    history: [],
    winner: null,
  });
}

function startHand(s: GameState): GameState {
  return {
    ...s,
    phase: "bidding",
    // Mix the hand number into the seed so each hand is a fresh, reproducible shuffle.
    hands: deal(s.preset, (s.seed + s.handNumber * 0x9e3779b1) >>> 0, s.dealer),
    bids: [null, null, null, null],
    passes: [null, null, null, null],
    turn: next(s.dealer),
    trick: [],
    lastTrick: null,
    played: [],
    tricksWon: [0, 0, 0, 0],
    spadesBroken: false,
  };
}

/** Whether `seat` may bid blind nil right now. */
export function canBidBlindNil(s: GameState, seat: Seat): boolean {
  const rule = s.preset.blindNil;
  if (!rule.enabled) return false;
  if (rule.onlyWhenDownBy === null) return true;
  const mine = s.scores[teamOf(seat)].points;
  const theirs = s.scores[teamOf(next(seat))].points;
  return theirs - mine >= rule.onlyWhenDownBy;
}

function validateBid(s: GameState, seat: Seat, bid: Bid): void {
  if (bid.kind === "nil" && !s.preset.nil.enabled) throw new RuleError("Nil isn't allowed with these rules.");
  if (bid.kind === "blind-nil" && !canBidBlindNil(s, seat)) throw new RuleError("Blind nil isn't allowed right now.");
  if (bid.kind === "tricks") {
    if (!Number.isInteger(bid.count) || bid.count < 1 || bid.count > 13)
      throw new RuleError("Bid must be between 1 and 13 (or nil).");
    const partnerBid = s.bids[partnerOf(seat)];
    const min = s.preset.minTeamBid;
    if (min !== null && partnerBid?.kind === "tricks" && partnerBid.count + bid.count < min)
      throw new RuleError(`Your team has to bid at least ${min}.`);
  }
}

function needsPassing(s: GameState): boolean {
  return s.preset.blindNil.passCards > 0 && s.bids.some((b) => b?.kind === "blind-nil");
}

/** Seats that must choose cards to pass: each blind nil bidder and their partner. */
export function passingSeats(s: GameState): Seat[] {
  const seats = new Set<Seat>();
  s.bids.forEach((b, i) => {
    if (b?.kind === "blind-nil") {
      seats.add(i as Seat);
      seats.add(partnerOf(i as Seat));
    }
  });
  return [...seats].sort();
}

function removeCards(hand: Card[], cards: Card[]): Card[] {
  const out = [...hand];
  for (const c of cards) {
    const i = out.findIndex((h) => sameCard(h, c));
    if (i === -1) throw new RuleError(`You don't have ${cardId(c)}.`);
    out.splice(i, 1);
  }
  return out;
}

export function applyAction(s: GameState, action: Action): GameState {
  if (s.phase === "finished") throw new RuleError("The game is over.");

  switch (action.type) {
    case "bid": {
      if (s.phase !== "bidding") throw new RuleError("It isn't time to bid.");
      if (action.seat !== s.turn) throw new RuleError("It isn't your turn to bid.");
      validateBid(s, action.seat, action.bid);
      const bids = [...s.bids];
      bids[action.seat] = action.bid;
      const done = bids.every((b) => b !== null);
      const state: GameState = { ...s, bids, turn: next(action.seat) };
      if (!done) return state;
      return needsPassing(state)
        ? { ...state, phase: "passing" }
        : { ...state, phase: "playing", turn: next(s.dealer) };
    }

    case "pass": {
      if (s.phase !== "passing") throw new RuleError("It isn't time to pass.");
      const seats = passingSeats(s);
      if (!seats.includes(action.seat)) throw new RuleError("You don't pass this hand.");
      if (s.passes[action.seat]) throw new RuleError("You've already passed.");
      const n = s.preset.blindNil.passCards;
      if (action.cards.length !== n) throw new RuleError(`Pass exactly ${n} card${n === 1 ? "" : "s"}.`);
      removeCards(s.hands[action.seat]!, action.cards); // validates ownership
      const passes = [...s.passes];
      passes[action.seat] = action.cards;
      if (!seats.every((seat) => passes[seat])) return { ...s, passes };

      const hands = s.hands.map((h) => [...h]);
      for (const seat of seats) hands[seat] = removeCards(hands[seat]!, passes[seat]!);
      for (const seat of seats) hands[seat] = sortHand([...hands[seat]!, ...passes[partnerOf(seat)]!], s.preset);
      return { ...s, hands, passes, phase: "playing", turn: next(s.dealer) };
    }

    case "play": {
      if (s.phase !== "playing") throw new RuleError("It isn't time to play.");
      if (action.seat !== s.turn) throw new RuleError("It isn't your turn.");
      const hand = s.hands[action.seat]!;
      const legal = legalPlays(hand, s.trick, s.spadesBroken, s.preset);
      if (!legal.some((c) => sameCard(c, action.card))) {
        if (!hand.some((c) => sameCard(c, action.card))) throw new RuleError(`You don't have ${cardId(action.card)}.`);
        throw new RuleError(
          s.trick.length === 0 ? "Spades haven't been broken yet." : "You have to follow suit.",
        );
      }

      const hands = [...s.hands];
      hands[action.seat] = removeCards(hand, [action.card]);
      const trick = [...s.trick, { seat: action.seat, card: action.card }];
      const played = [...(s.played ?? []), { seat: action.seat, card: action.card }];
      const spadesBroken = s.spadesBroken || isTrump(action.card, s.preset);

      if (trick.length < 4) return { ...s, hands, trick, played, spadesBroken, turn: next(action.seat) };

      const winner = trickWinner(trick, s.preset);
      const tricksWon = [...s.tricksWon];
      tricksWon[winner] = tricksWon[winner]! + 1;
      const state: GameState = {
        ...s,
        hands,
        trick: [],
        lastTrick: { plays: trick, winner },
        played,
        tricksWon,
        spadesBroken,
        turn: winner,
      };
      return hands.every((h) => h.length === 0) ? finishHand(state) : state;
    }
  }
}

function finishHand(s: GameState): GameState {
  const bids = s.bids as Bid[];
  const results = [0, 1].map((t) =>
    scoreTeamHand(t as Team, bids, s.tricksWon, s.scores[t as Team], s.preset),
  ) as [TeamHandResult, TeamHandResult];
  const scores: [TeamScore, TeamScore] = [results[0].after, results[1].after];
  const history = [
    ...s.history,
    { handNumber: s.handNumber, dealer: s.dealer, bids, tricksWon: s.tricksWon, results },
  ];
  const winner = gameWinner(scores, s.preset);
  const scored = { ...s, scores, history, winner };
  if (winner !== null) return { ...scored, phase: "finished" };
  return startHand({ ...scored, handNumber: s.handNumber + 1, dealer: next(s.dealer) });
}

/**
 * What one seat is allowed to see. Other hands become card counts.
 * Pass `hideHand` while a player is still deciding whether to bid blind nil
 * (the server tracks whether they've chosen to look at their cards).
 */
export function viewFor(s: GameState, seat: Seat, opts: { hideHand?: boolean } = {}) {
  const { hands, passes, seed: _seed, ...rest } = s;
  const blind = opts.hideHand === true && s.phase === "bidding";
  return {
    ...rest,
    seat,
    team: teamOf(seat),
    partner: partnerOf(seat),
    hand: blind ? null : hands[seat]!,
    handCounts: hands.map((h) => h.length),
    myPass: passes[seat],
    legal:
      s.phase === "playing" && s.turn === seat ? legalPlays(hands[seat]!, s.trick, s.spadesBroken, s.preset) : [],
    teamSeats: seatsOf(teamOf(seat)),
  };
}

export type SeatView = ReturnType<typeof viewFor>;
