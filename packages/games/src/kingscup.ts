// Kings Cup (Ring of Fire), a drinking game: take turns drawing a card, and each rank has a rule.
// The app deals, keeps the drinks and remembers who's thumb master, question master and whose mate
// is whose; for the rules played out at the table (last to touch the floor, the rhyme that fails),
// whoever drew picks who lost. The fourth king drinks the King's Cup and ends the game.
import type { PlayStyle } from "@spades/rules";
import { botGiveTarget, drink, DRINK_NOTE, newTally, type Tally } from "./drinks.js";
import { clone, FULL, GameError, makeDeck, nextRandom, rankLabel, rankSeats, shuffled, SYMBOL, who, type BaseRules, type CardGame, type Choice, type KCard, type KitView } from "./kit.js";

export interface KingsCupRules extends BaseRules {
  /** Sips for the rules that hand out drinks. */
  sips: number;
}

export const classicKingsCup: KingsCupRules = { id: "kingscup-classic", name: "Kings Cup", sips: 2 };
export const gentleKingsCup: KingsCupRules = { ...classicKingsCup, id: "kingscup-gentle", name: "Gentle (one sip)", sips: 1 };

/** Each rank's rule: its name, what to do, and whether whoever drew picks someone. */
export const KINGS_RULES: Record<number, { name: string; text: string; pick?: string }> = {
  14: { name: "Waterfall", text: "Everyone drinks, starting with whoever drew; nobody stops until the person before them does." },
  2: { name: "You", text: "Pick someone to drink.", pick: "Who drinks?" },
  3: { name: "Me", text: "Whoever drew drinks." },
  4: { name: "Floor", text: "Everyone touch the floor! Last one drinks.", pick: "Who was last to touch the floor?" },
  5: { name: "Thumb master", text: "Whoever drew is thumb master: put your thumb on the table any time, and the last to copy drinks." },
  6: { name: "Social", text: "Everyone drinks!" },
  7: { name: "Heaven", text: "Everyone point up! Last one drinks.", pick: "Who was last to point up?" },
  8: { name: "Mate", text: "Pick a mate: whenever you drink, they drink too.", pick: "Who's your mate?" },
  9: { name: "Rhyme", text: "Say a word; round the table, everyone rhymes with it. Whoever can't, drinks.", pick: "Who couldn't rhyme?" },
  10: { name: "Categories", text: "Name a category; round the table, everyone names one thing in it. Whoever can't, drinks.", pick: "Who ran out?" },
  11: { name: "Make a rule", text: "Make a rule everyone has to follow (no saying 'drink', left hands only…). Break it, drink." },
  12: { name: "Question master", text: "Whoever drew is question master: answer any question they ask with a question… or drink." },
  13: { name: "King's Cup", text: "Pour some of your drink into the King's Cup. Whoever draws the fourth king drinks the cup!" },
};

export interface KingsCupState {
  game: "kingscup";
  rules: KingsCupRules;
  seats: number;
  rng: number;
  hand: number;
  dealer: number;
  phase: "draw" | "pick" | "finished";
  deck: KCard[];
  last: KCard | null;
  turn: number;
  kings: number;
  thumb: number | null;
  question: number | null;
  rule: number | null;
  /** Mates: each seat's mate, if they have one. */
  mates: (number | null)[];
  loser: number | null;
  tally: Tally;
  narration: string | null;
}

const rank = (c: KCard) => (c as { rank: number }).rank;
const label = (c: KCard) => `${rankLabel(rank(c))}${SYMBOL[(c as { suit: keyof typeof SYMBOL }).suit]}`;

export function newKingsCup(rules: KingsCupRules, seats: number, seed: number): KingsCupState {
  const s = { game: "kingscup", rules, seats, rng: seed >>> 0, hand: 0, dealer: seed % seats, phase: "draw", last: null, kings: 0, thumb: null, question: null, rule: null, loser: null, narration: null } as unknown as KingsCupState;
  s.deck = shuffled(makeDeck({ ranks: FULL }), nextRandom(s));
  s.mates = Array(seats).fill(null);
  s.tally = newTally(seats);
  s.turn = (s.dealer + 1) % seats;
  return s;
}

/** Drink, and take your mates along. */
function drinkWithMates(s: KingsCupState, seats: number[], n: number): string {
  const all = new Set(seats);
  for (const x of seats) if (s.mates[x] !== null) all.add(s.mates[x]!);
  return drink(s.tally, [...all], n);
}

type Move = { type: "draw" } | { type: "pick"; to: number };

function apply(state: KingsCupState, seat: number, move: Move): KingsCupState {
  const s = clone(state);
  if (s.phase === "finished") throw new GameError("The game is over.");
  if (s.turn !== seat) throw new GameError("It's not your turn.");
  const everyone = Array.from({ length: s.seats }, (_, i) => i);
  if (move.type === "pick") {
    if (s.phase !== "pick" || !s.last) throw new GameError("Draw a card first.");
    const to = Number(move.to);
    const r = rank(s.last);
    if (!(to >= 0 && to < s.seats) || (to === seat && (r === 2 || r === 8))) throw new GameError("Pick someone else.");
    if (r === 8) {
      for (const x of [seat, to]) if (s.mates[x] !== null) s.mates[s.mates[x]!] = null;
      s.mates[seat] = to;
      s.mates[to] = seat;
      s.narration = `${who(seat)} and ${who(to)} are mates 🤝`;
    } else s.narration = `${KINGS_RULES[r]!.name}: ${drinkWithMates(s, [to], s.rules.sips)}`;
    s.phase = "draw";
    s.turn = (seat + 1) % s.seats;
    return s;
  }
  if (move.type !== "draw" || s.phase !== "draw") throw new GameError("Pick someone first.");
  const c = s.deck.pop()!;
  s.last = c;
  const r = rank(c);
  const rule = KINGS_RULES[r]!;
  let line = "";
  if (r === 14) line = drinkWithMates(s, everyone, s.rules.sips + 1);
  else if (r === 3) line = drinkWithMates(s, [seat], s.rules.sips);
  else if (r === 6) line = drinkWithMates(s, everyone, 1);
  else if (r === 5) s.thumb = seat;
  else if (r === 12) s.question = seat;
  else if (r === 11) s.rule = seat;
  else if (r === 13) {
    s.kings += 1;
    if (s.kings === 4) {
      s.loser = seat;
      s.phase = "finished";
      s.narration = `${who(seat)} drew the fourth king: ${drinkWithMates(s, [seat], 99)} (the King's Cup!) 👑`;
      return s;
    }
  }
  s.narration = `${who(seat)} drew the ${label(c)}: ${rule.name}${line ? ` · ${line}` : ""}${r === 13 ? ` (${s.kings} of 4)` : ""}`;
  if (rule.pick) {
    s.phase = "pick";
    return s;
  }
  s.turn = (seat + 1) % s.seats;
  if (!s.deck.length) {
    s.phase = "finished";
    s.narration += " · That's the deck!";
  }
  return s;
}

function view(s: KingsCupState, seat: number): KitView {
  const over = s.phase === "finished";
  const mine = !over && s.turn === seat;
  let choices: KitView["choices"] = null;
  if (mine && s.phase === "draw") choices = { prompt: "", options: [{ label: "Draw a card", move: { type: "draw" }, primary: true }] };
  if (mine && s.phase === "pick" && s.last) {
    const r = rank(s.last);
    const options: Choice[] = Array.from({ length: s.seats }, (_, i) => i)
      .filter((i) => !((r === 2 || r === 8) && i === seat))
      .map((i) => ({ label: i === seat ? "Me" : who(i), move: { type: "pick", to: i } }));
    choices = { prompt: KINGS_RULES[r]!.pick!, options, layout: "list" };
  }
  const roles = (i: number) => [i === s.thumb ? "👍 Thumb master" : "", i === s.question ? "❓ Question master" : "", i === s.rule ? "📜 Rule maker" : "", s.mates[i] !== null ? "🤝 Has a mate" : ""].filter(Boolean).join(" · ");
  const rule = s.last ? KINGS_RULES[rank(s.last)]! : null;
  return {
    game: "kingscup",
    seats: s.seats,
    me: seat,
    teams: false,
    phase: s.phase,
    turn: over ? null : s.turn,
    dealer: s.dealer,
    hand: [],
    handHidden: "none",
    tap: null,
    pick: null,
    choices,
    players: s.tally.drank.map((d, i) => ({ cards: 0, line: [`🍺 ${d}`, roles(i)].filter(Boolean).join(" · "), dealer: i === s.dealer })),
    center: { kind: "piles", stock: s.deck.length, discard: s.last ? [s.last] : [], discardCount: s.last ? 52 - s.deck.length : 0, drawMove: mine && s.phase === "draw" ? { type: "draw" } : null, takeMove: null, stockLabel: `👑 ${s.kings} of 4 kings`, discardLabel: rule ? rule.name : "Draw to start" },
    melds: [],
    info: [...(rule ? [rule.text] : ["Draw a card and do what it says."]), DRINK_NOTE],
    narration: s.narration,
    scores: s.tally.drank.map((value, i) => ({ seats: [i], value })),
    result: null,
    over: over ? { winners: Array.from({ length: s.seats }, (_, i) => i).filter((i) => i !== s.loser), title: s.loser !== null ? `${who(s.loser)} drinks the King's Cup!` : "That's the deck!" } : null,
  };
}

function bot(s: KingsCupState, seat: number, _style: PlayStyle): Move | null {
  if (s.phase === "finished" || s.turn !== seat) return null;
  if (s.phase === "draw") return { type: "draw" };
  return { type: "pick", to: botGiveTarget(s.tally, seat, s.seats) };
}

export const kingsCup: CardGame<KingsCupRules, KingsCupState, Move> = {
  id: "kingscup",
  name: "Kings Cup",
  emoji: "👑",
  blurb: "Drinking game: every card has a rule",
  tagline: "A drinking game. Draw a card and follow its rule. Whoever draws the fourth king drinks the King's Cup!",
  seats: { min: 2, max: 10, default: 5 },
  teams: false,
  presets: [classicKingsCup, gentleKingsCup],
  fields: [{ key: "sips", label: "Sips for You, Me and the rest", kind: "choice", options: [[1, "1"], [2, "2"], [3, "3"]] }],
  normalize(rules) {
    const given = (rules && typeof rules === "object" ? rules : {}) as Partial<KingsCupRules>;
    const base = [classicKingsCup, gentleKingsCup].find((p) => p.id === given.id) ?? classicKingsCup;
    const r = { ...base, ...given };
    return { ...r, sips: Math.min(5, Math.max(1, Number(r.sips) || 2)) };
  },
  validate: () => [],
  describe: () => [
    `${DRINK_NOTE} Adults only.`,
    "Take turns drawing a card. Each rank has a rule:",
    ...[14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((r) => `${rankLabel(r)} · ${KINGS_RULES[r]!.name}: ${KINGS_RULES[r]!.text}`),
    "For the rules played out at the table, whoever drew picks who drinks.",
  ],
  newGame: newKingsCup,
  apply,
  view,
  bot,
  thinkingTime: (s) => (s.phase === "pick" ? 2200 : 1600),
  summary(s) {
    const over = s.phase === "finished";
    return { game: "kingscup", rules: s.rules.name, phase: s.phase, over, hand: 1, scoreLine: s.tally.drank.join(" · ") + " drinks", order: over ? rankSeats(s.tally.drank.map((score, i) => ({ seats: [i], score })), true) : null, winners: over ? Array.from({ length: s.seats }, (_, i) => i).filter((i) => i !== s.loser) : null, teams: false, seats: s.seats };
  },
};
