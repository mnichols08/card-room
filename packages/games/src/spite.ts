// Spite and Malice: race to empty your pay-off pile. In the middle, building piles go up from ace to
// queen in any suits; kings are wild. On your turn fill your hand to five, then play onto the building
// piles from your hand, the top of your pay-off pile, or the tops of your four discard piles. End your
// turn by putting a card from your hand on one of your discard piles. Use all five cards and you draw
// five more. First to play their whole pay-off pile wins.
import type { PlayStyle } from "@spades/rules";
import {
  clone,
  FULL,
  GameError,
  makeDeck,
  nextRandom,
  rankLabel,
  rankSeats,
  shuffled,
  sortCards,
  SYMBOL,
  thinkFor,
  who,
  type BaseRules,
  type CardGame,
  type Choice,
  type KCard,
  type KitView,
} from "./kit.js";

export interface SpiteRules extends BaseRules {
  /** Cards in each pay-off pile. */
  payoff: number;
}

export const classicSpite: SpiteRules = { id: "spite-classic", name: "Spite and Malice (20 cards)", payoff: 20 };
export const quickSpite: SpiteRules = { ...classicSpite, id: "spite-quick", name: "Quick (13 cards)", payoff: 13 };
export const longSpite: SpiteRules = { ...classicSpite, id: "spite-long", name: "Long (26 cards)", payoff: 26 };

/** Where a card comes from: the hand, the pay-off pile, or one of your discard piles (1–4). */
type Source = { from: "hand"; card: string } | { from: "payoff" } | { from: "discard"; pile: number };

export interface SpiteState {
  game: "spite";
  rules: SpiteRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  payoff: KCard[][];
  discards: KCard[][][];
  hands: KCard[][];
  builds: KCard[][];
  stock: KCard[];
  /** Finished building piles, shuffled back in when the stock runs out. */
  spent: KCard[];
  turn: number;
  phase: "playing" | "finished";
  /** Choosing a card to discard (ending the turn), then where it goes. */
  discarding: boolean;
  /** The hand card picked to discard. */
  toss: string | null;
  /** A king that fits more than one building pile: which one? */
  held: Source | null;
  /** Turns in a row where nothing reached the building piles: a stalemate ends the game. */
  idle: number;
  played: boolean;
  winner: number | null;
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const wild = (c: KCard) => rank(c) === 13;
/** Ace 1 … queen 12. */
const value = (c: KCard) => (rank(c) === 14 ? 1 : rank(c));
const name = (c: KCard) => (wild(c) ? "king" : `${rankLabel(rank(c))}${SYMBOL[(c as { suit: keyof typeof SYMBOL }).suit]}`);
const HAND = 5;

/** The building piles a card can go on: the next value up, or any pile for a king. */
export function buildTargets(s: SpiteState, card: KCard): number[] {
  return s.builds.flatMap((p, i) => (p.length < 12 && (wild(card) || value(card) === p.length + 1) ? [i] : []));
}

function sourceCard(s: SpiteState, seat: number, src: Source): KCard | undefined {
  if (src.from === "hand") return s.hands[seat]!.find((c) => c.id === src.card);
  if (src.from === "payoff") return s.payoff[seat]!.at(-1);
  return s.discards[seat]![src.pile]?.at(-1);
}

function refill(s: SpiteState) {
  if (s.stock.length || !s.spent.length) return;
  s.stock = shuffled(s.spent, nextRandom(s));
  s.spent = [];
}

function fillHand(s: SpiteState, seat: number) {
  while (s.hands[seat]!.length < HAND) {
    refill(s);
    const c = s.stock.pop();
    if (!c) break;
    s.hands[seat]!.push(c);
  }
  s.hands[seat] = sortCards(s.hands[seat]!);
}

/** Two decks, or three for more players or a long pay-off pile. */
export const decks = (rules: SpiteRules, seats: number) => (seats <= 2 && rules.payoff <= 20 ? 2 : 3);

export function newSpite(rules: SpiteRules, seats: number, seed: number): SpiteState {
  const s = { game: "spite", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats } as unknown as SpiteState;
  const deck = shuffled(makeDeck({ ranks: FULL, copies: decks(rules, seats) }), nextRandom(s));
  let k = 0;
  s.payoff = Array.from({ length: seats }, () => deck.slice(k, (k += rules.payoff)));
  s.hands = Array.from({ length: seats }, () => sortCards(deck.slice(k, (k += HAND))));
  s.stock = deck.slice(k);
  s.spent = [];
  s.discards = Array.from({ length: seats }, () => [[], [], [], []]);
  s.builds = [[], [], [], []];
  // Whoever's pay-off card is higher goes first.
  const tops = s.payoff.map((p) => (wild(p.at(-1)!) ? 13 : value(p.at(-1)!)));
  s.turn = tops.indexOf(Math.max(...tops));
  s.phase = "playing";
  s.discarding = false;
  s.toss = null;
  s.held = null;
  s.idle = 0;
  s.played = false;
  s.winner = null;
  s.narration = `${who(s.turn)} goes first (the higher pay-off card)`;
  return s;
}

function place(s: SpiteState, seat: number, src: Source, pile: number) {
  const card = sourceCard(s, seat, src)!;
  if (src.from === "hand") s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card.id);
  else if (src.from === "payoff") s.payoff[seat]!.pop();
  else s.discards[seat]![src.pile]!.pop();
  const build = s.builds[pile]!;
  build.push(card);
  s.held = null;
  s.played = true;
  const as = wild(card) ? ` as a ${rankLabel(build.length === 1 ? 14 : build.length)}` : "";
  s.narration = `${who(seat)} played ${src.from === "payoff" ? "from the pay-off pile: " : ""}the ${name(card)}${as}`;
  if (build.length === 12) {
    s.spent.push(...build);
    s.builds[pile] = [];
    s.narration += ", and the pile is done";
  }
  if (!s.payoff[seat]!.length) {
    s.winner = seat;
    s.phase = "finished";
    s.narration = `${who(seat)} played the last pay-off card! 🎉`;
    return;
  }
  // Used every card in hand: draw five more and keep going.
  if (!s.hands[seat]!.length) fillHand(s, seat);
}

function play(s: SpiteState, seat: number, src: Source) {
  const card = sourceCard(s, seat, src);
  if (!card) throw new GameError("There's no card there.");
  const to = buildTargets(s, card);
  if (!to.length) throw new GameError(`The ${name(card)} doesn't fit on any building pile.`);
  // Piles at the same height are all the same to a card: only a real choice asks.
  const heights = new Set(to.map((p) => s.builds[p]!.length));
  if (heights.size === 1) place(s, seat, src, to[0]!);
  else s.held = src;
}

type Move =
  | { type: "play"; card: string }
  | { type: "from"; index: number }
  | { type: "to"; pile: number }
  | { type: "cancel" }
  | { type: "discard" }
  | { type: "toss"; card: string }
  | { type: "onto"; index: number }
  | { type: "pass" };

function apply(state: SpiteState, seat: number, move: Move): SpiteState {
  const s = clone(state);
  if (s.phase !== "playing" || s.turn !== seat) throw new GameError("It's not your turn.");
  switch (move.type) {
    case "play": {
      if (s.discarding) throw new GameError("Pick the card to discard.");
      play(s, seat, { from: "hand", card: move.card });
      return s;
    }
    case "from": {
      if (s.discarding) throw new GameError("Pick the card to discard.");
      const i = Number(move.index);
      play(s, seat, i === 0 ? { from: "payoff" } : { from: "discard", pile: i - 1 });
      return s;
    }
    case "to": {
      if (!s.held) throw new GameError("Pick a card first.");
      const card = sourceCard(s, seat, s.held)!;
      const pile = Number(move.pile);
      if (!buildTargets(s, card).includes(pile)) throw new GameError("It doesn't go there.");
      place(s, seat, s.held, pile);
      return s;
    }
    case "cancel": {
      s.held = null;
      s.discarding = false;
      s.toss = null;
      return s;
    }
    case "discard": {
      if (!s.hands[seat]!.length) throw new GameError("You have nothing to discard.");
      s.held = null;
      s.discarding = true;
      s.toss = null;
      return s;
    }
    case "toss": {
      if (!s.discarding) throw new GameError("Play a card, or choose to discard.");
      if (!s.hands[seat]!.some((c) => c.id === move.card)) throw new GameError("You don't have that card.");
      s.toss = move.card;
      return s;
    }
    case "pass":
    case "onto": {
      let card: KCard | null = null;
      if (move.type === "pass") {
        if (s.hands[seat]!.length) throw new GameError("End your turn by discarding a card.");
      } else {
        if (!s.discarding || !s.toss) throw new GameError("Pick the card to discard first.");
        const i = Number(move.index);
        if (!(i >= 1 && i <= 4)) throw new GameError("Put it on one of your four discard piles.");
        card = s.hands[seat]!.find((c) => c.id === s.toss)!;
        s.hands[seat] = s.hands[seat]!.filter((c) => c.id !== card!.id);
        s.discards[seat]![i - 1]!.push(card);
      }
      s.discarding = false;
      s.toss = null;
      s.idle = s.played ? 0 : s.idle + 1;
      s.played = false;
      // Nobody has reached the building piles for a long while and nothing is left to draw: the
      // fewest pay-off cards left wins.
      if (s.idle >= s.seats * 6 && !s.stock.length && !s.spent.length) {
        const left = s.payoff.map((p) => p.length);
        s.winner = left.indexOf(Math.min(...left));
        s.phase = "finished";
        s.narration = `Nobody can get anywhere: ${who(s.winner)} has the fewest pay-off cards left and wins`;
        return s;
      }
      s.narration = card ? `${who(seat)} discarded the ${name(card)}` : `${who(seat)} has no cards and passes`;
      s.turn = (s.turn + 1) % s.seats;
      fillHand(s, s.turn);
      return s;
    }
    default:
      throw new GameError("That's not a move in Spite and Malice.");
  }
}

function view(s: SpiteState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = s.phase === "playing" && s.turn === seat;
  const hand = s.hands[seat]!;
  let choices: KitView["choices"] = null;
  let gridTap: KitView["gridTap"] = null;
  let tap: KitView["tap"] = null;
  if (mine && s.held) {
    const card = sourceCard(s, seat, s.held)!;
    const options: Choice[] = buildTargets(s, card).map((p) => ({ label: s.builds[p]!.length ? `Pile ${p + 1}: make it a ${rankLabel(s.builds[p]!.length + 1)}` : `Pile ${p + 1}: start it (as an ace)`, move: { type: "to", pile: p } }));
    options.push({ label: "Cancel", move: { type: "cancel" } });
    choices = { prompt: "Which pile does the king go on?", options, layout: "list" };
  } else if (mine && s.discarding) {
    if (s.toss) gridTap = { type: "onto", cells: [1, 2, 3, 4], prompt: "Tap a discard pile to put it on" };
    tap = { type: "toss", cards: hand.map((c) => c.id) };
    choices = { prompt: s.toss ? "" : "Tap the card to discard", options: [{ label: "Cancel", move: { type: "cancel" } }] };
  } else if (mine) {
    tap = { type: "play", cards: hand.filter((c) => buildTargets(s, c).length).map((c) => c.id) };
    const from = [0, 1, 2, 3, 4].filter((i) => {
      const c = sourceCard(s, seat, i === 0 ? { from: "payoff" } : { from: "discard", pile: i - 1 });
      return c && buildTargets(s, c).length;
    });
    if (from.length) gridTap = { type: "from", cells: from, prompt: "" };
    choices = { prompt: "", options: [hand.length ? { label: "Discard to end my turn", move: { type: "discard" }, primary: !tap.cards.length && !from.length } : { label: "End my turn", move: { type: "pass" }, primary: !from.length }] };
  }
  const tops = (i: number) => [s.payoff[i]!.at(-1) ?? null, ...s.discards[i]!.map((d) => d.at(-1) ?? null)];
  return {
    game: "spite",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    dealer: s.dealer,
    hand,
    tap: tap && tap.cards.length ? tap : null,
    pick: null,
    choices,
    players: s.payoff.map((p, i) => ({ cards: s.hands[i]!.length, line: `Pay-off: ${p.length} left`, badge: s.winner === i ? "Out!" : undefined })),
    center: {
      kind: "cross",
      stock: s.stock.length,
      piles: [0, 1, 2, 3].map((i) => ({
        cards: s.builds[i]!.length ? [s.builds[i]!.at(-1)!] : [],
        empty: "A",
        move: null,
        label: s.builds[i]!.length ? `Building pile ${i + 1}, up to ${rankLabel(s.builds[i]!.length === 1 ? 14 : s.builds[i]!.length)}` : `Building pile ${i + 1}, empty`,
        note: s.builds[i]!.length && wild(s.builds[i]!.at(-1)!) ? `= ${rankLabel(s.builds[i]!.length === 1 ? 14 : s.builds[i]!.length)}` : undefined,
      })),
      layout: "row",
    },
    grids: s.payoff.map((_, i) => ({ owner: i, cols: 5, cards: tops(i), empty: tops(i).flatMap((c, k) => (c ? [] : [k])) })),
    gridTap,
    melds: [],
    info: ["Build up from ace to queen · kings are wild", "Pay-off card on the left, then your discard piles"],
    narration: mine && s.discarding && s.toss ? "Now tap one of your four discard piles" : s.narration,
    scores: s.payoff.map((p, i) => ({ seats: [i], value: p.length })),
    result: null,
    over: over ? { winners: [s.winner!], title: `${who(s.winner!)} wins!` } : null,
  };
}

// ---- Computer players --------------------------------------------------------------------------

function bot(s: SpiteState, seat: number, style: PlayStyle): Move | null {
  if (s.phase !== "playing" || s.turn !== seat) return null;
  const hand = s.hands[seat]!;
  if (s.held) {
    const card = sourceCard(s, seat, s.held)!;
    const to = buildTargets(s, card);
    // A king goes where it brings the pile closest to my pay-off card.
    const want = s.payoff[seat]!.at(-1);
    const best = want && !wild(want) ? to.find((p) => s.builds[p]!.length + 2 === value(want)) : undefined;
    return { type: "to", pile: best ?? to[0]! };
  }
  if (s.discarding) {
    if (!s.toss) {
      // Throw the highest natural card, keeping kings.
      const keep = [...hand].sort((a, b) => (wild(a) ? 99 : value(a)) - (wild(b) ? 99 : value(b)));
      return { type: "toss", card: (keep.at(-1) && !wild(keep.at(-1)!) ? keep.at(-1)! : keep[0]!).id };
    }
    // Onto a pile with the same card on top, or an empty pile, or the pile whose top is one higher.
    const card = hand.find((c) => c.id === s.toss)!;
    const piles = s.discards[seat]!;
    const same = piles.findIndex((p) => p.at(-1) && value(p.at(-1)!) === value(card));
    const empty = piles.findIndex((p) => !p.length);
    const above = piles.findIndex((p) => p.at(-1) && value(p.at(-1)!) === value(card) + 1);
    const pick = same >= 0 ? same : above >= 0 ? above : empty >= 0 ? empty : Math.floor(Math.random() * 4);
    return { type: "onto", index: pick + 1 };
  }
  // 1. The pay-off card whenever it fits.
  const pay = s.payoff[seat]!.at(-1);
  if (pay && buildTargets(s, pay).length) return { type: "from", index: 0 };
  // 2. Natural cards from discard piles and hand (no kings yet), lowest first.
  const sloppy = Math.random() < (style.sloppy ?? 0) * 0.3;
  const options: { move: Move; v: number }[] = [];
  s.discards[seat]!.forEach((p, i) => {
    const c = p.at(-1);
    if (c && !wild(c) && buildTargets(s, c).length) options.push({ move: { type: "from", index: i + 1 }, v: value(c) - 0.5 });
  });
  for (const c of hand) if (!wild(c) && buildTargets(s, c).length) options.push({ move: { type: "play", card: c.id }, v: value(c) });
  // Don't feed the next player's pay-off card if a careful player can help it.
  const next = s.payoff[(seat + 1) % s.seats]!.at(-1);
  const feeds = (v: number) => next && !wild(next) && Math.floor(v) + 1 === value(next);
  const safe = options.filter((o) => !feeds(o.v) || sloppy);
  if (safe.length) return [...safe].sort((a, b) => a.v - b.v)[0]!.move;
  // 3. A king if it gets my pay-off card on.
  if (pay && !wild(pay)) {
    const king = hand.find(wild);
    if (king && s.builds.some((p) => p.length + 2 === value(pay))) return { type: "play", card: king.id };
  }
  if (options.length && Math.random() < 0.5) return options[0]!.move;
  return hand.length ? { type: "discard" } : { type: "pass" };
}

export const spite: CardGame<SpiteRules, SpiteState, Move> = {
  id: "spite",
  name: "Spite and Malice",
  emoji: "😈",
  blurb: "Race to play off your pile; kings are wild",
  tagline: "Build up from ace to queen, kings wild. First to play off their whole pay-off pile wins.",
  seats: { min: 2, max: 4, default: 2 },
  teams: false,
  presets: [classicSpite, quickSpite, longSpite],
  fields: [{ key: "payoff", label: "Pay-off pile", kind: "choice", options: [[13, "13 cards"], [20, "20 cards"], [26, "26 cards"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<SpiteRules>;
    const base = [classicSpite, quickSpite, longSpite].find((p) => p.id === given.id) ?? classicSpite;
    const r = { ...base, ...given };
    return { ...r, payoff: Number(r.payoff) };
  },
  validate(r) {
    return r.payoff >= 5 && r.payoff <= 30 ? [] : ["Use a pay-off pile of 5 to 30 cards."];
  },
  describe(r) {
    return [
      `Each player gets a pay-off pile of ${r.payoff} cards (only the top one shows) and a hand of five. Two decks (three for more than two players, or a pile of more than 20).`,
      "In the middle, up to four building piles go up from ace to queen, any suits. Kings are wild. A finished pile goes back into the stock.",
      "On your turn, fill your hand to five. Play onto the building piles from your hand, the top of your pay-off pile, or the tops of your four discard piles. Use all five and you draw five more.",
      "End your turn by putting a card from your hand on one of your discard piles.",
      "First to play their whole pay-off pile wins.",
    ];
  },
  newGame: newSpite,
  apply,
  view,
  bot,
  thinkingTime(s, seat) {
    if (s.held || s.toss) return 700;
    return thinkFor(s.hands[seat]!.length + 2, 0.8);
  },
  summary(s) {
    const over = s.phase === "finished";
    return {
      game: "spite",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.hand + 1,
      scoreLine: s.payoff.map((p) => p.length).join(" · ") + " left",
      order: over ? [s.winner!, ...rankSeats(s.payoff.map((p, i) => ({ seats: [i], score: p.length })).filter((x) => x.seats[0] !== s.winner), true)] : null,
      winners: over ? [s.winner!] : null,
      teams: false,
      seats: s.seats,
    };
  },
};
