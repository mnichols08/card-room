// President for 3 to 7: every card is dealt. Lead one to four cards of a rank; each player beats it
// with the same number of a higher rank, or passes (and sits out until the pile clears). When
// everyone else has passed, the last player to play clears it and leads. Finishing order sets the
// ranks for the next hand, President down to Scum, and the Scum hands the President their best two
// cards for two the President chooses. Points by place over a set number of hands.
import type { PlayStyle } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  markReady,
  nextHandChoices,
  nextRandom,
  rankLabel,
  rankSeats,
  shuffled,
  SUITS,
  thinkFor,
  who,
  withDrinking,
  withDrinks,
  type BaseRules,
  type CardGame,
  type KCard,
  type KitView,
  type PipCard,
} from "./kit.js";

export interface PresidentRules extends BaseRules {
  hands: number;
  /** Twos are the highest cards (otherwise aces are, and twos are lowest). */
  twosHigh: boolean;
  /** The Scum and Vice Scum give their best cards to the President and Vice President. */
  swap: boolean;
  /** Drinking mode, a house rule: see the game's describe(). */
  drinking?: boolean;
}

export const classicPresident: PresidentRules = { id: "president-classic", name: "President (5 hands)", hands: 5, twosHigh: true, swap: true };
export const quickPresident: PresidentRules = { ...classicPresident, id: "president-quick", name: "Quick (3 hands)", hands: 3 };
export const gentlePresident: PresidentRules = { ...classicPresident, id: "president-gentle", name: "No card swap", swap: false };

type Phase = "swap" | "playing" | "scored" | "finished";

export interface PresidentState {
  game: "president";
  rules: PresidentRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: Phase;
  hands: KCard[][];
  /** The cards on the pile now (the last play), who played them, and how many each play must be. */
  pile: KCard[];
  lastPlayer: number | null;
  count: number;
  passed: boolean[];
  turn: number;
  /** Seats in the order they went out this hand. */
  finished: number[];
  /** Last hand's titles by seat: 0 President, 1 Vice President, … */
  places: number[] | null;
  /** In the swap: how many cards each seat still has to give back, and what they were handed. */
  owes: number[];
  received: KCard[][];
  scores: number[];
  ready: boolean[];
  narration: string | null;
}

const rankOf = (c: KCard) => (c as PipCard).rank;
const powerFor = (r: PresidentRules) => (c: KCard) => (r.twosHigh ? (rankOf(c) === 2 ? 15 : rankOf(c)) : rankOf(c) === 14 ? 14 : rankOf(c));
const sortFor = (r: PresidentRules) => (cards: KCard[]) => [...cards].sort((a, b) => powerFor(r)(a) - powerFor(r)(b) || SUITS.indexOf((a as PipCard).suit) - SUITS.indexOf((b as PipCard).suit));
const plural = (r: number, n: number) => (n === 1 ? `a ${rankLabel(r)}` : `${["", "", "two", "three", "four"][n]} ${r === 14 ? "aces" : r === 13 ? "kings" : r === 12 ? "queens" : r === 11 ? "jacks" : `${rankLabel(r)}s`}`);

/** The title for a finishing place among this many players. */
export function title(place: number, seats: number): string {
  if (place === 0) return "President";
  if (place === seats - 1) return "Scum";
  if (seats >= 4 && place === 1) return "Vice President";
  if (seats >= 4 && place === seats - 2) return "Vice Scum";
  return "Citizen";
}

const active = (s: PresidentState) => s.hands.map((h, i) => i).filter((i) => s.hands[i]!.length > 0);

function deal(s: PresidentState) {
  const deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.hands = Array.from({ length: s.seats }, () => []);
  deck.forEach((c, i) => s.hands[(s.dealer + 1 + i) % s.seats]!.push(c));
  const sort = sortFor(s.rules);
  s.hands = s.hands.map(sort);
  s.pile = [];
  s.lastPlayer = null;
  s.count = 0;
  s.passed = Array.from({ length: s.seats }, () => false);
  s.finished = [];
  s.owes = Array.from({ length: s.seats }, () => 0);
  s.received = Array.from({ length: s.seats }, () => []);
  s.ready = Array.from({ length: s.seats }, () => false);
  // The first hand: whoever holds the 3♣ leads. Afterwards, the Scum leads.
  const lowest = s.hands.findIndex((h) => h.some((c) => rankOf(c) === 3 && (c as PipCard).suit === "clubs"));
  s.turn = s.places ? s.places.indexOf(s.seats - 1) : lowest;
  s.phase = "playing";
  s.narration = s.places ? null : `Whoever has the 3♣ leads: that's ${who(s.turn)}`;
  if (s.places && s.rules.swap) {
    // The Scum hands the President their best two; the Vice Scum, the Vice President their best one.
    const seatAt = (place: number) => s.places!.indexOf(place);
    const give = (from: number, to: number, n: number) => {
      const best = s.hands[from]!.slice(-n);
      s.hands[from] = s.hands[from]!.slice(0, -n);
      s.hands[to] = sort([...s.hands[to]!, ...best]);
      s.received[to] = best;
      s.owes[to] = n;
    };
    give(seatAt(s.seats - 1), seatAt(0), 2);
    if (s.seats >= 4) give(seatAt(s.seats - 2), seatAt(1), 1);
    s.phase = "swap";
    s.narration = "The Scum hands the President their best two cards; the President gives two back.";
  }
}

export function newPresident(rules: PresidentRules, seats: number, seed: number): PresidentState {
  const s = { game: "president", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, places: null } as unknown as PresidentState;
  s.scores = Array.from({ length: seats }, () => 0);
  deal(s);
  return s;
}

/** Whether these cards (all one rank) beat the pile. */
function beats(s: PresidentState, cards: KCard[]): boolean {
  if (!s.pile.length) return true;
  return cards.length === s.count && powerFor(s.rules)(cards[0]!) > powerFor(s.rules)(s.pile[0]!);
}

/**
 * Move the turn on. The pile clears once nobody but the last player is still in it (everyone else
 * has passed or gone out); otherwise the next player still in it plays.
 */
function advance(s: PresidentState, from: number) {
  if (active(s).length <= 1) {
    endHand(s);
    return;
  }
  const still = active(s).filter((i) => !s.passed[i] && i !== s.lastPlayer);
  if (!still.length) {
    clearPile(s);
    return;
  }
  for (let k = 1; k <= s.seats; k++) {
    const seat = (from + k) % s.seats;
    if (still.includes(seat)) {
      s.turn = seat;
      return;
    }
  }
}

function clearPile(s: PresidentState) {
  const leader = s.lastPlayer !== null && s.hands[s.lastPlayer]!.length ? s.lastPlayer : (() => {
    for (let i = 1; i <= s.seats; i++) {
      const seat = ((s.lastPlayer ?? s.turn) + i) % s.seats;
      if (s.hands[seat]!.length) return seat;
    }
    return s.turn;
  })();
  s.pile = [];
  s.count = 0;
  s.lastPlayer = null;
  s.passed = s.passed.map(() => false);
  s.turn = leader;
  s.narration = `${s.narration ? s.narration + ". " : ""}The pile clears: ${who(leader)} leads`;
}

function endHand(s: PresidentState) {
  // The last one holding cards finishes last.
  for (const seat of active(s)) s.finished.push(seat);
  for (let i = 0; i < s.seats; i++) if (!s.finished.includes(i)) s.finished.push(i);
  s.places = Array.from({ length: s.seats }, (_, seat) => s.finished.indexOf(seat));
  s.scores = s.scores.map((n, seat) => n + (s.seats - 1 - s.places![seat]!));
  s.ready = Array.from({ length: s.seats }, () => false);
  s.narration = `${who(s.finished[0]!)} is President; ${who(s.finished.at(-1)!)} is Scum`;
  s.narration = withDrinks(!!s.rules.drinking, s.narration, [s.finished.at(-1)!], 3);
  if (s.seats >= 4) s.narration = withDrinks(!!s.rules.drinking, s.narration, [s.finished.at(-2)!], 1);
  s.phase = s.hand + 1 >= s.rules.hands ? "finished" : "scored";
}

type Move = { type: "play"; cards: string[] } | { type: "pass" } | { type: "give"; cards: string[] } | { type: "next" };

function apply(state: PresidentState, seat: number, move: Move): PresidentState {
  const s = clone(state);
  const sort = sortFor(s.rules);
  if (move.type === "next") {
    if (s.phase !== "scored") throw new GameError("The hand isn't over.");
    if (markReady(s.ready, seat)) {
      s.hand += 1;
      s.dealer = (s.dealer + 1) % s.seats;
      deal(s);
    }
    return s;
  }
  if (move.type === "give") {
    if (s.phase !== "swap" || !s.owes[seat]) throw new GameError("You don't owe any cards.");
    const ids = move.cards ?? [];
    const cards = ids.map((id) => s.hands[seat]!.find((c) => c.id === id));
    if (cards.length !== s.owes[seat] || cards.some((c) => !c) || new Set(ids).size !== ids.length) throw new GameError(`Pick ${s.owes[seat]} card${s.owes[seat] === 1 ? "" : "s"} to give back.`);
    const place = s.places![seat]!;
    const to = s.places!.indexOf(place === 0 ? s.seats - 1 : s.seats - 2);
    s.hands[seat] = s.hands[seat]!.filter((c) => !ids.includes(c.id));
    s.hands[to] = sort([...s.hands[to]!, ...(cards as KCard[])]);
    s.owes[seat] = 0;
    if (s.owes.every((n) => n === 0)) {
      s.phase = "playing";
      s.narration = `Cards swapped. ${who(s.turn)}, the Scum, leads`;
    }
    return s;
  }
  if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
  if (move.type === "pass") {
    if (!s.pile.length) throw new GameError("You're leading: play something.");
    s.passed[seat] = true;
    s.narration = `${who(seat)} passed`;
    advance(s, seat);
    return s;
  }
  if (move.type !== "play") throw new GameError("That's not a move in President.");
  const ids = move.cards ?? [];
  const cards = ids.map((id) => s.hands[seat]!.find((c) => c.id === id));
  if (!cards.length || cards.some((c) => !c) || new Set(ids).size !== ids.length) throw new GameError("Pick cards from your hand to play.");
  const played = cards as KCard[];
  if (new Set(played.map(rankOf)).size !== 1) throw new GameError("Play cards of one rank: a single, a pair, three or four of a kind.");
  if (!beats(s, played)) throw new GameError(s.count === played.length ? `Beat ${plural(rankOf(s.pile[0]!), s.count)} with something higher.` : `Play ${s.count === 1 ? "one card" : `${s.count} cards`} of a higher rank, or pass.`);
  s.hands[seat] = s.hands[seat]!.filter((c) => !ids.includes(c.id));
  s.pile = played;
  s.count = played.length;
  s.lastPlayer = seat;
  s.narration = `${who(seat)} played ${plural(rankOf(played[0]!), played.length)}`;
  if (!s.hands[seat]!.length) {
    s.finished.push(seat);
    s.narration += `, and is out ${["first", "second", "third", "fourth", "fifth", "sixth"][s.finished.length - 1]}!`;
  }
  // Nobody can beat the top cards (four of a kind, or the highest rank): the pile clears at once.
  const top = s.rules.twosHigh ? 2 : 14;
  if (played.length === 4 || rankOf(played[0]!) === top) {
    if (active(s).length <= 1) {
      endHand(s);
      return s;
    }
    clearPile(s);
    return s;
  }
  advance(s, seat);
  return s;
}

function view(s: PresidentState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.phase === "playing" && s.turn === seat && s.hands[seat]!.length > 0;
  const giving = s.phase === "swap" && s.owes[seat]! > 0;
  const top = s.pile[0];
  const placeOf = (i: number) => (s.places ? title(s.places[i]!, s.seats) : null);
  return {
    game: "president",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: s.phase === "playing" ? s.turn : null,
    dealer: s.dealer,
    hand: s.hands[seat]!,
    tap: null,
    pick: giving
      ? { min: s.owes[seat]!, max: s.owes[seat]!, prompt: `You got ${s.received[seat]!.map((c) => rankLabel(rankOf(c))).join(" and ")}: pick ${s.owes[seat]} to give back`, cards: s.hands[seat]!.map((c) => c.id), actions: [{ label: "Give back", type: "give", primary: true }] }
      : mine
        ? {
            min: s.pile.length ? s.count : 1,
            max: s.pile.length ? s.count : 4,
            prompt: s.pile.length ? `Beat ${plural(rankOf(top!), s.count)}, or pass` : "Your lead: play a single, a pair, three or four of a kind",
            cards: s.hands[seat]!.map((c) => c.id),
            actions: [{ label: "Play", type: "play", primary: true }],
          }
        : null,
    choices: mine && s.pile.length ? { prompt: "", options: [{ label: "Pass", move: { type: "pass" } }] } : s.phase === "scored" ? nextHandChoices(s.ready, seat, false) : null,
    players: s.hands.map((h, i) => ({
      cards: h.length,
      line: s.finished.includes(i) && s.phase === "playing" ? `Out ${["1st", "2nd", "3rd", "4th", "5th", "6th"][s.finished.indexOf(i)]}` : s.passed[i] && s.phase === "playing" ? "Passed" : "",
      dealer: i === s.dealer,
      badge: placeOf(i) ?? undefined,
      out: s.phase === "playing" && !h.length,
    })),
    center: { kind: "piles", stock: null, discard: s.pile, discardCount: s.pile.length, drawMove: null, takeMove: null, spread: { type: "none", cards: [] }, discardLabel: top && s.lastPlayer !== null ? `${who(s.lastPlayer)}: ${plural(rankOf(top), s.count)}` : "Empty: lead anything" },
    melds: [],
    info: [`Hand ${s.hand + 1} of ${s.rules.hands}`, s.rules.twosHigh ? "Twos are high" : "Aces are high"],
    narration: s.narration,
    scores: s.scores.map((n, i) => ({ seats: [i], value: n })),
    result:
      s.places && (s.phase === "scored" || over)
        ? {
            key: `president-${s.hand}`,
            title: `Hand ${s.hand + 1}`,
            sides: s.scores.map((_, i) => [i]),
            rows: [
              { label: "Place", values: s.places.map((p) => title(p, s.seats)) },
              { label: "This hand", values: s.places.map((p) => `+${s.seats - 1 - p}`), tone: "score" as const },
              { label: "Total", values: s.scores.map(String), tone: "total" as const },
            ],
          }
        : null,
    over: over ? { winners: winners(s), title: winners(s).length === 1 ? `${who(winners(s)[0]!)} wins with ${s.scores[winners(s)[0]!]}` : `A tie at ${Math.max(...s.scores)}` } : null,
  };
}

function winners(s: PresidentState): number[] {
  const best = Math.max(...s.scores);
  return s.scores.map((n, i) => (n === best ? i : -1)).filter((i) => i >= 0);
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: PresidentState, seat: number, style: PlayStyle): Move | null {
  if (s.phase === "scored") return s.ready[seat] ? null : { type: "next" };
  const hand = s.hands[seat]!;
  if (s.phase === "swap") return s.owes[seat] ? { type: "give", cards: hand.slice(0, s.owes[seat]).map((c) => c.id) } : null;
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const sloppy = Math.random() < (style.sloppy ?? 0) + (1 - (style.skill ?? 1)) * 0.3;
  const power = powerFor(s.rules);
  const groups = new Map<number, KCard[]>();
  for (const c of hand) groups.set(rankOf(c), [...(groups.get(rankOf(c)) ?? []), c]);
  const byPower = [...groups.values()].sort((a, b) => power(a[0]!) - power(b[0]!));
  if (!s.pile.length) {
    // Lead the lowest rank, all of it.
    const g = sloppy ? byPower[Math.floor(Math.random() * byPower.length)]! : byPower[0]!;
    return { type: "play", cards: g.map((c) => c.id) };
  }
  const need = s.count;
  const floor = power(s.pile[0]!);
  // Beat it as cheaply as possible, preferring a group of exactly the right size (don't break pairs).
  const options = byPower.filter((g) => g.length >= need && power(g[0]!) > floor);
  const exact = options.find((g) => g.length === need);
  const choice = exact ?? options[0];
  // Hold the top cards back early on, unless it's nearly over.
  const precious = choice && power(choice[0]!) >= (s.rules.twosHigh ? 15 : 14) && hand.length > 4;
  if (!choice || (precious && !sloppy && Math.random() < 0.6)) return { type: "pass" };
  return { type: "play", cards: choice.slice(0, need).map((c) => c.id) };
}

const presidentGame: CardGame<PresidentRules, PresidentState, Move> = {
  id: "president",
  name: "President",
  emoji: "🎖️",
  blurb: "Climb from Scum to President",
  tagline: "Beat the last play or pass, get rid of your cards first, and climb from Scum to President.",
  seats: { min: 3, max: 7, default: 5 },
  teams: false,
  presets: [classicPresident, quickPresident, gentlePresident],
  fields: [
    { key: "hands", label: "Hands", kind: "choice", options: [[3, "3"], [5, "5"], [8, "8"]] },
    { key: "twosHigh", label: "Twos are high", hint: "Twos beat everything (otherwise aces are top and twos are low).", kind: "toggle" },
    { key: "swap", label: "Card swap", hint: "Before each hand after the first, the Scum gives the President their two best cards for two the President chooses.", kind: "toggle" },
  ],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<PresidentRules>;
    const base = [classicPresident, quickPresident, gentlePresident].find((p) => p.id === given.id) ?? classicPresident;
    return { ...base, ...given };
  },
  validate: (r) => (r.hands >= 1 && r.hands <= 20 ? [] : ["Between 1 and 20 hands."]),
  describe(r) {
    return [
      `Also called Scum (and a ruder name). Every card is dealt. ${r.twosHigh ? "Threes are low and twos are high." : "Twos are low and aces are high."} The player with the 3♣ leads the first hand; after that, the Scum leads.`,
      "Lead a single, a pair, three or four of a kind. Each player in turn plays the same number of cards of a higher rank, or passes; once you pass you sit out until the pile clears.",
      `When everyone else has passed, the last player to play clears the pile and leads again. ${r.twosHigh ? "Twos" : "Aces"}, or four of a kind, clear it at once.`,
      `Go out first to be President, then Vice President, Citizens, Vice Scum and, last, Scum.${r.swap ? " Next hand, the Scum gives the President their two best cards and gets two back; the Vice Scum and Vice President swap one." : ""} You score a point for each player you beat; after ${r.hands} hands the most points wins.`,
    ];
  },
  newGame: newPresident,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "scored" ? 1400 : s.phase === "swap" ? 1200 : thinkFor(4, 0.9)),
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "president",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.scores.join(" · "),
      order: over ? rankSeats(s.scores.map((n, i) => ({ seats: [i], score: n }))) : null,
      winners: over ? winners(s) : null,
      teams: false,
      seats: s.seats,
    };
  },
};

export const president = withDrinking(presidentGame, "Adults only. The Scum drinks 3 and the Vice Scum 1 (or sips of water).", "at the end of each hand the Scum drinks 3 and the Vice Scum drinks 1.");
