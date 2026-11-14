// Contract Bridge, Chicago scoring: partners across the table, thirteen cards each. An auction
// decides the contract: how many tricks over six the declaring side will take, and the trump suit (or
// no trumps). The declarer's partner is dummy: their cards go face up and the declarer plays them.
// Make the contract to score it, with bonuses for games and slams; fall short and the defenders score.
// A Chicago is four deals with set vulnerability; highest total wins.
import type { PlayStyle, Suit } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  markReady,
  nextRandom,
  rankSeats,
  shuffled,
  sortCards,
  SYMBOL,
  teamOfSeat,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type Choice,
  type KCard,
  type KitView,
  type Meld,
} from "./kit.js";
import { bestLoser, cheapestWinner, following, trickWinner, type Play } from "./tricks.js";

export interface BridgeRules extends BaseRules {
  /** Rounds of four deals. */
  chukkers: number;
}

export const chicagoBridge: BridgeRules = { id: "bridge-chicago", name: "Chicago (4 deals)", chukkers: 1 };
export const longBridge: BridgeRules = { ...chicagoBridge, id: "bridge-8", name: "Two Chicagos (8 deals)", chukkers: 2 };

export type Strain = "clubs" | "diamonds" | "hearts" | "spades" | "nt";
const STRAINS: Strain[] = ["clubs", "diamonds", "hearts", "spades", "nt"];
export interface Contract {
  level: number;
  strain: Strain;
}
export type Call = { type: "bid"; level: number; strain: Strain } | { type: "pass" } | { type: "double" } | { type: "redouble" };

export interface BridgeState {
  game: "bridge";
  rules: BridgeRules;
  seats: 4;
  rng: number;
  /** Deals played so far. */
  hand: number;
  dealer: number;
  phase: "bidding" | "playing" | "scored" | "finished";
  hands: KCard[][];
  auction: { seat: number; call: Call }[];
  contract: (Contract & { by: number; doubled: 0 | 1 | 2 }) | null;
  declarer: number | null;
  trick: Play[];
  lastTrick: { plays: Play[]; winner: number } | null;
  turn: number;
  tricksWon: number[];
  scores: [number, number];
  lastHand: { contract: (Contract & { doubled: 0 | 1 | 2 }) | null; declarer: number | null; tricks: [number, number]; points: [number, number]; made: boolean } | null;
  ready: boolean[];
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const suitOf = (c: KCard) => (c as { suit: Suit }).suit;
const order = (c: Contract) => (c.level - 1) * 5 + STRAINS.indexOf(c.strain);
export const strainName = (s: Strain) => (s === "nt" ? "NT" : SYMBOL[s]);
export const contractName = (c: Contract & { doubled?: number }) => `${c.level}${strainName(c.strain)}${c.doubled === 2 ? " ×× " : c.doubled === 1 ? " ×" : ""}`.trim();
const callName = (c: Call) => (c.type === "bid" ? `${c.level}${strainName(c.strain)}` : c.type === "pass" ? "Pass" : c.type === "double" ? "Double" : "Redouble");
const trumpOf = (s: BridgeState): Suit | null => (s.contract && s.contract.strain !== "nt" ? s.contract.strain : null);
const partnerOf = (seat: number) => (seat + 2) % 4;
const dummyOf = (s: BridgeState) => (s.declarer === null ? null : partnerOf(s.declarer));
/** Who moves for the seat on turn: the declarer plays dummy's cards. */
const controller = (s: BridgeState, seat: number) => (s.phase === "playing" && seat === dummyOf(s) ? s.declarer! : seat);

/** Chicago vulnerability: none, dealer's side, dealer's side, both. */
export function vulnerable(s: BridgeState, team: 0 | 1): boolean {
  const k = s.hand % 4;
  if (k === 0) return false;
  if (k === 3) return true;
  return teamOfSeat(s.dealer) === team;
}

const sortHand = (cards: KCard[]) => sortCards(cards, rank, suitOf);

function deal(s: BridgeState) {
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hands = [0, 1, 2, 3].map((i) => sortHand(deck.slice(i * 13, i * 13 + 13)));
  s.auction = [];
  s.contract = null;
  s.declarer = null;
  s.trick = [];
  s.lastTrick = null;
  s.tricksWon = [0, 0, 0, 0];
  s.ready = [false, false, false, false];
  s.phase = "bidding";
  s.turn = s.dealer;
}

export function newBridge(rules: BridgeRules, _seats: number, seed: number): BridgeState {
  const s = { game: "bridge", rules, seats: 4, rng: seed >>> 0, hand: 0, dealer: seed % 4, scores: [0, 0], lastHand: null, narration: null } as unknown as BridgeState;
  deal(s);
  return s;
}

/** The calls this seat may make: pass, a higher bid, double their bid, redouble our doubled bid. */
export function callsFor(s: BridgeState, seat: number): Call[] {
  if (s.phase !== "bidding" || s.turn !== seat) return [];
  const out: Call[] = [{ type: "pass" }];
  const c = s.contract;
  if (c && c.doubled === 0 && teamOfSeat(c.by) !== teamOfSeat(seat)) out.push({ type: "double" });
  if (c && c.doubled === 1 && teamOfSeat(c.by) === teamOfSeat(seat)) out.push({ type: "redouble" });
  for (let level = 1; level <= 7; level++) for (const strain of STRAINS) if (!c || order({ level, strain }) > order(c)) out.push({ type: "bid", level, strain });
  return out;
}

export function bridgeLegal(s: BridgeState, seat: number): KCard[] {
  if (s.phase !== "playing" || s.turn !== seat) return [];
  return following(s.hands[seat]!, s.trick, suitOf);
}

type Move = Call | { type: "play"; card: string } | { type: "next" };

function apply(state: BridgeState, seat: number, move: Move): BridgeState {
  const s = clone(state);
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The hand isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = (s.dealer + 1) % 4;
      s.narration = null;
      deal(s);
    }
    return s;
  }
  if (move.type === "play") {
    if (s.phase !== "playing") throw new GameError("It's not time to play.");
    if (controller(s, s.turn) !== seat) throw new GameError("It's not your turn.");
    const from = s.turn;
    const card = s.hands[from]!.find((c) => c.id === move.card);
    if (!card) throw new GameError(from === seat ? "You don't have that card." : "Dummy doesn't have that card.");
    if (!bridgeLegal(s, from).some((c) => c.id === card.id)) throw new GameError(`Follow suit: play a ${SYMBOL[suitOf(s.trick[0]!.card)]} if you can.`);
    if (!s.trick.length) s.lastTrick = null;
    s.hands[from] = s.hands[from]!.filter((c) => c.id !== card.id);
    s.trick.push({ seat: from, card });
    s.narration = null;
    if (s.trick.length < 4) {
      s.turn = (from + 1) % 4;
      return s;
    }
    const win = trickWinner(s.trick, trumpOf(s), suitOf, rank);
    s.tricksWon[win.seat]! += 1;
    s.lastTrick = { plays: s.trick, winner: win.seat };
    s.trick = [];
    s.turn = win.seat;
    if (s.hands.every((h) => !h.length)) scoreHand(s);
    return s;
  }
  // A call in the auction.
  if (s.phase !== "bidding" || s.turn !== seat) throw new GameError("It's not your turn to bid.");
  const allowed = callsFor(s, seat);
  const ok = allowed.some((c) => c.type === move.type && (c.type !== "bid" || (move.type === "bid" && c.level === Number(move.level) && c.strain === move.strain)));
  if (!ok) throw new GameError(move.type === "bid" ? `Bid higher than ${contractName(s.contract!)}.` : move.type === "double" ? "You can double only the other side's bid." : move.type === "redouble" ? "You can redouble only your side's doubled bid." : "That's not a call.");
  const call: Call = move.type === "bid" ? { type: "bid", level: Number(move.level), strain: move.strain } : { type: move.type };
  s.auction.push({ seat, call });
  if (call.type === "bid") s.contract = { level: call.level, strain: call.strain, by: seat, doubled: 0 };
  else if (call.type === "double") s.contract!.doubled = 1;
  else if (call.type === "redouble") s.contract!.doubled = 2;
  s.narration = `${who(seat)}: ${callName(call)}`;
  // Three passes after a bid end it; four passes to start throw the deal in.
  const tail = s.auction.slice(-3);
  const passedOut = s.auction.length === 4 && s.auction.every((a) => a.call.type === "pass");
  if (passedOut) {
    s.lastHand = { contract: null, declarer: null, tricks: [0, 0], points: [0, 0], made: false };
    s.narration = "Passed out: everyone passed. New deal.";
    s.dealer = (s.dealer + 1) % 4;
    deal(s);
    return s;
  }
  if (s.contract && s.auction.length >= 4 && tail.length === 3 && tail.every((a) => a.call.type === "pass")) {
    // The declarer: the first of the winning side to name the final strain.
    const team = teamOfSeat(s.contract.by);
    const first = s.auction.find((a) => a.call.type === "bid" && a.call.strain === s.contract!.strain && teamOfSeat(a.seat) === team)!;
    s.declarer = first.seat;
    s.phase = "playing";
    s.turn = (s.declarer + 1) % 4;
    s.narration = `${who(s.declarer)} declares ${contractName(s.contract)}; ${who(partnerOf(s.declarer))} is dummy`;
    return s;
  }
  s.turn = (seat + 1) % 4;
  return s;
}

const TRICK_VALUE: Record<Strain, number> = { clubs: 20, diamonds: 20, hearts: 30, spades: 30, nt: 30 };

/** Points for the declaring side (positive) or the defenders (negative), Chicago style. */
export function bridgeScore(c: Contract & { doubled: 0 | 1 | 2 }, tricks: number, vul: boolean): number {
  const need = c.level + 6;
  const mult = c.doubled === 2 ? 4 : c.doubled === 1 ? 2 : 1;
  if (tricks >= need) {
    const contractPts = (TRICK_VALUE[c.strain] * c.level + (c.strain === "nt" ? 10 : 0)) * mult;
    let score = contractPts;
    score += contractPts >= 100 ? (vul ? 500 : 300) : 50;
    if (c.level === 6) score += vul ? 750 : 500;
    if (c.level === 7) score += vul ? 1500 : 1000;
    const over = tricks - need;
    score += over * (c.doubled ? (vul ? 200 : 100) * (c.doubled === 2 ? 2 : 1) : TRICK_VALUE[c.strain]);
    if (c.doubled) score += c.doubled === 2 ? 100 : 50;
    return score;
  }
  const down = need - tricks;
  if (!c.doubled) return -down * (vul ? 100 : 50);
  let pen = 0;
  for (let k = 1; k <= down; k++) pen += vul ? (k === 1 ? 200 : 300) : k === 1 ? 100 : k <= 3 ? 200 : 300;
  return -pen * (c.doubled === 2 ? 2 : 1);
}

function scoreHand(s: BridgeState) {
  const c = s.contract!;
  const team = teamOfSeat(s.declarer!);
  const tricks: [number, number] = [s.tricksWon[0]! + s.tricksWon[2]!, s.tricksWon[1]! + s.tricksWon[3]!];
  const result = bridgeScore(c, tricks[team], vulnerable(s, team));
  const points: [number, number] = [0, 0];
  if (result >= 0) points[team] = result;
  else points[(1 - team) as 0 | 1] = -result;
  s.scores = [s.scores[0] + points[0], s.scores[1] + points[1]];
  const made = result >= 0;
  s.lastHand = { contract: { level: c.level, strain: c.strain, doubled: c.doubled }, declarer: s.declarer, tricks, points, made };
  const need = c.level + 6;
  s.narration = made ? `${who(s.declarer!)} made ${contractName(c)}${tricks[team] > need ? ` with ${tricks[team] - need} over` : ""}` : `${who(s.declarer!)} went ${need - tricks[team]} down in ${contractName(c)}`;
  s.ready = [false, false, false, false];
  s.phase = s.hand + 1 >= s.rules.chukkers * 4 ? "finished" : "scored";
}

function winners(s: BridgeState): number[] {
  if (s.scores[0] === s.scores[1]) return [0, 1, 2, 3];
  return s.scores[0] > s.scores[1] ? [0, 2] : [1, 3];
}

/** The bids worth showing: the next few, the games, and the small slams. */
function shownCalls(calls: Call[]): Call[] {
  const bids = calls.filter((c): c is Extract<Call, { type: "bid" }> => c.type === "bid");
  const keep = new Set(bids.slice(0, 5));
  const game = (b: { level: number; strain: Strain }) => (b.level === 3 && b.strain === "nt") || (b.level === 4 && (b.strain === "hearts" || b.strain === "spades")) || (b.level === 5 && (b.strain === "clubs" || b.strain === "diamonds"));
  // Slams only come up once the bidding is already high.
  const high = (bids[0]?.level ?? 7) >= 4;
  for (const b of bids) if (game(b) || (high && b.level >= 6 && b.level === (bids[0]!.level >= 6 ? bids[0]!.level : 6))) keep.add(b);
  return [...calls.filter((c) => c.type !== "bid"), ...bids.filter((b) => keep.has(b))];
}

function view(s: BridgeState, seat: number): KitView {
  const over = s.phase === "finished";
  const playing = s.phase === "playing";
  const dummy = dummyOf(s);
  const ctrl = controller(s, s.turn);
  const fromDummy = playing && seat === s.declarer && s.turn === dummy;
  // The declarer plays dummy's cards from the hand area when it's dummy's turn.
  const hand = fromDummy ? s.hands[dummy!]! : s.hands[seat]!;
  const melds: Meld[] = [];
  if (playing && dummy !== null && s.trick.length + s.tricksWon.reduce((a, b) => a + b, 0) > 0) {
    if (fromDummy) melds.push({ owner: seat, label: "Your hand", cards: s.hands[seat]! });
    else melds.push({ owner: dummy, label: "Dummy", cards: s.hands[dummy]! });
  }
  let choices: KitView["choices"] = null;
  const calls = callsFor(s, seat);
  if (calls.length) {
    choices = {
      prompt: s.contract ? `${contractName(s.contract)} by ${who(s.contract.by)} to beat.` : "Open the bidding, or pass.",
      options: shownCalls(calls).map((c): Choice => ({ label: callName(c), move: c as Record<string, unknown> })),
      layout: "grid",
    };
  } else if (s.phase === "scored" && !s.ready[seat]) choices = { prompt: "", options: [{ label: "Deal the next hand", move: { type: "next" }, primary: true }] };
  const lastCall = (i: number) => [...s.auction].reverse().find((a) => a.seat === i)?.call;
  const team = s.declarer !== null ? teamOfSeat(s.declarer) : null;
  const tricksFor = (t: 0 | 1) => s.tricksWon[t]! + s.tricksWon[t + 2]!;
  return {
    game: "bridge",
    seats: 4,
    me: seat,
    teams: true,
    phase: s.phase,
    turn: s.phase === "scored" || over ? null : ctrl,
    dealer: s.dealer,
    hand,
    tap: playing && ctrl === seat ? { type: "play", cards: bridgeLegal(s, s.turn).map((c) => c.id) } : null,
    pick: null,
    choices,
    players: s.hands.map((h, i) => ({
      cards: i === seat ? hand.length : h.length,
      line: s.phase === "bidding" ? (lastCall(i) ? callName(lastCall(i)!) : "") : playing || s.phase === "scored" ? `Took ${s.tricksWon[i]}` : "",
      team: teamOfSeat(i),
      dealer: i === s.dealer,
      badge: playing ? (i === s.declarer ? `Declarer ${contractName(s.contract!)}` : i === dummy ? "Dummy" : undefined) : undefined,
    })),
    center: { kind: "trick", plays: s.trick.length ? s.trick : (s.lastTrick?.plays ?? []), winner: s.trick.length ? null : (s.lastTrick?.winner ?? null) },
    melds,
    info: [
      ...(playing && s.contract && team !== null ? [`${contractName(s.contract)}: ${who(s.declarer!)} & ${who(dummy!)} need ${s.contract.level + 6}, have ${tricksFor(team)}`] : []),
      ...(fromDummy ? ["You're playing dummy's cards"] : []),
      `Deal ${(s.hand % 4) + 1} of 4${s.rules.chukkers > 1 ? ` (Chicago ${Math.floor(s.hand / 4) + 1} of ${s.rules.chukkers})` : ""}`,
      vulLine(s),
    ],
    narration: s.narration,
    scores: [
      { seats: [0, 2], value: s.scores[0] },
      { seats: [1, 3], value: s.scores[1] },
    ],
    result:
      s.lastHand?.contract && (s.phase === "scored" || over)
        ? {
            key: `bridge-${s.hand}`,
            title: s.lastHand.made ? `${who(s.lastHand.declarer!)} made ${contractName(s.lastHand.contract)}` : `${contractName(s.lastHand.contract)} went down`,
            sides: [
              [0, 2],
              [1, 3],
            ],
            rows: [
              { label: "Tricks", values: s.lastHand.tricks.map(String) },
              { label: "This deal", values: s.lastHand.points.map((p) => (p ? `+${p}` : "0")), tone: "score" },
              { label: "Total", values: s.scores.map(String), tone: "total" },
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: winners(s).length === 4 ? "A tie!" : `${who(winners(s)[0]!)} & ${who(winners(s)[1]!)} win ${Math.max(...s.scores)} to ${Math.min(...s.scores)}` } : null,
  };
}

function vulLine(s: BridgeState): string {
  const a = vulnerable(s, 0);
  const b = vulnerable(s, 1);
  if (a && b) return "Both sides vulnerable";
  if (!a && !b) return "Nobody vulnerable";
  return a ? `${who(0)} & ${who(2)} vulnerable` : `${who(1)} & ${who(3)} vulnerable`;
}

// ---- Computer players --------------------------------------------------------------------------

export const hcp = (hand: KCard[]) => hand.reduce((n, c) => n + Math.max(0, rank(c) - 10), 0);
const SUIT_LIST: Suit[] = ["clubs", "diamonds", "hearts", "spades"];
const lengths = (hand: KCard[]) => Object.fromEntries(SUIT_LIST.map((x) => [x, hand.filter((c) => suitOf(c) === x).length])) as Record<Suit, number>;
const balanced = (hand: KCard[]) => {
  const l = Object.values(lengths(hand)).sort((a, b) => a - b);
  return l[0]! >= 2 && l[1]! >= 2 && l[3]! <= 5;
};

/** What partner's calls suggest: points, and length in each suit they bid. */
function partnerShows(s: BridgeState, seat: number): { pts: number; len: Record<Strain, number> } {
  const p = partnerOf(seat);
  const theirs = s.auction.filter((a) => a.seat === p);
  const len: Record<Strain, number> = { clubs: 2, diamonds: 2, hearts: 2, spades: 2, nt: 0 };
  let pts = 4;
  const bids = theirs.filter((a) => a.call.type === "bid").map((a) => a.call as Extract<Call, { type: "bid" }>);
  if (!bids.length) return { pts: theirs.length ? 5 : 8, len };
  // Did partner open, or answer us?
  const firstBid = s.auction.find((a) => a.call.type === "bid");
  const opened = firstBid?.seat === p;
  const b = bids[0]!;
  if (b.strain === "nt") pts = b.level === 1 && opened ? 16 : b.level === 2 && opened ? 20 : opened ? 22 : 9;
  else pts = opened ? 13 : 9;
  for (const x of bids) if (x.strain !== "nt") len[x.strain] = Math.max(len[x.strain], x.strain === "hearts" || x.strain === "spades" ? 5 : 4);
  if (b.strain === "nt") for (const x of SUIT_LIST) len[x] = 3;
  if (bids.length > 1) pts += 2;
  return { pts, len };
}

function chooseCall(s: BridgeState, seat: number, style: PlayStyle): Call {
  const hand = s.hands[seat]!;
  const mine = hcp(hand);
  const len = lengths(hand);
  const legal = callsFor(s, seat);
  const can = (level: number, strain: Strain) => legal.some((c) => c.type === "bid" && c.level === level && c.strain === strain);
  const bid = (level: number, strain: Strain): Call => ({ type: "bid", level, strain });
  const ourTeam = teamOfSeat(seat);
  const ourBids = s.auction.filter((a) => teamOfSeat(a.seat) === ourTeam && a.call.type === "bid");
  const theirBids = s.auction.filter((a) => teamOfSeat(a.seat) !== ourTeam && a.call.type === "bid");
  const longest = [...SUIT_LIST].sort((a, b) => len[b] - len[a] || SUIT_LIST.indexOf(b) - SUIT_LIST.indexOf(a))[0]!;
  const dist = Math.max(0, len[longest] - 4);
  const bold = (style.bold ?? 0.3) * 2;
  // Opening: nobody on our side has bid.
  if (!ourBids.length) {
    if (!theirBids.length) {
      if (mine >= 15 && mine <= 17 && balanced(hand) && can(1, "nt")) return bid(1, "nt");
      if (mine >= 20 && mine <= 21 && balanced(hand) && can(2, "nt")) return bid(2, "nt");
      if (mine + dist + bold >= 12.5) {
        const major = (["spades", "hearts"] as Suit[]).find((m) => len[m] >= 5);
        const suit = major ?? (len.diamonds > len.clubs ? "diamonds" : "clubs");
        for (let lv = 1; lv <= 2; lv++) if (can(lv, suit)) return bid(lv, suit);
      }
      return { type: "pass" };
    }
    // Overcall with a good five-card suit.
    if (mine + dist >= 10 && len[longest] >= 5) for (let lv = 1; lv <= 2; lv++) if (can(lv, longest)) return bid(lv, longest);
    if (mine >= 16 && balanced(hand) && can(1, "nt")) return bid(1, "nt");
    return { type: "pass" };
  }
  // Our side is bidding: aim for the right level in the best fit.
  const partner = partnerShows(s, seat);
  const combined = mine + dist + partner.pts + bold * 0.5;
  const fits = SUIT_LIST.map((x) => ({ x, n: len[x] + partner.len[x] })).filter((f) => f.n >= 8).sort((a, b) => b.n - a.n || (["hearts", "spades"].includes(b.x) ? 1 : 0) - (["hearts", "spades"].includes(a.x) ? 1 : 0));
  const strain: Strain = fits.length ? (fits.find((f) => f.x === "hearts" || f.x === "spades")?.x ?? (combined >= 25 && balanced(hand) ? "nt" : fits[0]!.x)) : balanced(hand) || mine >= 10 ? "nt" : longest;
  const game: Record<Strain, number> = { nt: 3, hearts: 4, spades: 4, clubs: 5, diamonds: 5 };
  let target = combined >= 37 ? 7 : combined >= 33 ? 6 : combined >= (strain === "clubs" || strain === "diamonds" ? 28 : 25.5) ? game[strain] : combined >= 22.5 ? (strain === "nt" ? 2 : 3) : combined >= 19 ? (strain === "nt" ? 1 : 2) : 1;
  // A weak hand with no fit stays out of it.
  if (mine < 6 && !fits.length && partner.pts < 15) target = 0;
  const current = s.contract;
  const ours = current && teamOfSeat(current.by) === ourTeam;
  if (target > 0 && can(target, strain)) {
    // Already at or past a sensible spot for our side: stop.
    if (ours && current!.strain === strain && current!.level >= target) return { type: "pass" };
    // Answer partner at the cheapest level when we're not sure of game yet.
    if (target < game[strain]) {
      for (let lv = 1; lv <= target; lv++) if (can(lv, strain)) return bid(lv, strain);
    }
    return bid(target, strain);
  }
  // The other side outbid us: double if we have the values and they're high.
  if (current && !ours && current.doubled === 0 && combined >= 24 && current.level >= 3) return { type: "double" };
  return { type: "pass" };
}

function bot(s: BridgeState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  if (s.phase === "bidding") return s.turn === seat ? chooseCall(s, seat, style) : null;
  if (s.phase !== "playing" || controller(s, s.turn) !== seat) return null;
  const from = s.turn;
  const legal = bridgeLegal(s, from);
  const careless = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.25;
  if (legal.length === 1 || careless) return { type: "play", card: legal[Math.floor(Math.random() * legal.length)]!.id };
  const trump = trumpOf(s);
  const strength = (c: KCard) => rank(c) + (trump && suitOf(c) === trump ? 100 : 0);
  if (!s.trick.length) {
    // Lead an ace, else the top of a sequence, else a low card from the longest suit.
    const ace = legal.find((c) => rank(c) === 14 && suitOf(c) !== trump);
    if (ace) return { type: "play", card: ace.id };
    const declaring = teamOfSeat(from) === teamOfSeat(s.declarer!);
    const trumps = legal.filter((c) => trump && suitOf(c) === trump);
    if (declaring && trumps.length >= 3) return { type: "play", card: [...trumps].sort((a, b) => rank(b) - rank(a))[0]!.id };
    const bySuit = SUIT_LIST.map((x) => legal.filter((c) => suitOf(c) === x && x !== trump)).filter((g) => g.length).sort((a, b) => b.length - a.length);
    const group = bySuit[0] ?? legal;
    const top = [...group].sort((a, b) => rank(b) - rank(a));
    if (top.length >= 2 && rank(top[0]!) >= 12 && rank(top[0]!) - rank(top[1]!) === 1) return { type: "play", card: top[0]!.id };
    return { type: "play", card: top.at(-1)!.id };
  }
  const winning = trickWinner(s.trick, trump, suitOf, rank);
  if (teamOfSeat(winning.seat) === teamOfSeat(from)) return { type: "play", card: [...legal].sort((a, b) => strength(a) - strength(b))[0]!.id };
  const win = cheapestWinner(legal, from, s.trick, trump, suitOf, rank);
  // Second hand low (unless it's cheap to win); third and fourth hand try to win.
  if (win && (s.trick.length >= 2 || rank(win) >= 13 || (trump && suitOf(win) === trump))) return { type: "play", card: win.id };
  return { type: "play", card: bestLoser(legal, from, s.trick, trump, suitOf, rank).id };
}

export const bridge: CardGame<BridgeRules, BridgeState, Move> = {
  id: "bridge",
  name: "Bridge",
  emoji: "🌉",
  blurb: "Contract bridge, Chicago scoring",
  tagline: "Bid a contract with your partner, then make it, with dummy's cards face up. Four deals a Chicago.",
  seats: { min: 4, max: 4, default: 4 },
  teams: true,
  presets: [chicagoBridge, longBridge],
  fields: [{ key: "chukkers", label: "Length", kind: "choice", options: [[1, "One Chicago (4 deals)"], [2, "Two Chicagos (8 deals)"], [3, "Three Chicagos (12 deals)"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<BridgeRules>;
    const base = [chicagoBridge, longBridge].find((p) => p.id === given.id) ?? chicagoBridge;
    const r = { ...base, ...given };
    return { ...r, chukkers: Number(r.chukkers) };
  },
  validate(r) {
    return r.chukkers >= 1 && r.chukkers <= 5 ? [] : ["Play 1 to 5 Chicagos."];
  },
  describe(r) {
    return [
      "Partners sit across. Thirteen cards each.",
      "The auction: starting with the dealer, bid how many tricks over six your side will take and in what (♣ ♦ ♥ ♠ or no trumps, in that order), pass, double the other side's bid, or redouble a double. Three passes after a bid end it; four passes and the cards are dealt again.",
      "The first player on the winning side to name the final suit is the declarer. The player on their left leads; then the declarer's partner, dummy, lays their cards face up, and the declarer plays them.",
      "Follow suit if you can. Make the contract to score it: ♣ ♦ 20 a trick, ♥ ♠ 30, no trumps 40 then 30, with a bonus for a game (100 or more), and big bonuses for slams. Fall short and the other side scores.",
      `Chicago scoring: four deals, with nobody vulnerable on the first, the dealer's side on the second and third, and both on the fourth. ${r.chukkers > 1 ? `${r.chukkers} Chicagos;` : ""} Highest total wins.`,
    ];
  },
  newGame: newBridge,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.phase === "bidding") return 1600;
    if (s.phase === "scored") return 900;
    return thinkFor(bridgeLegal(s, s.turn).length, seat === s.turn ? 1 : 1.1);
  },
  summary(s) {
    const over = s.phase === "finished";
    const w = winners(s);
    return {
      game: "bridge",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats([{ seats: [0, 2], score: s.scores[0] }, { seats: [1, 3], score: s.scores[1] }]) : null,
      winners: over ? w : null,
      teams: true,
      seats: 4,
    };
  },
};
