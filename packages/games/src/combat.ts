// Combat: the family's name for the old pencil-and-paper game of hidden fleets. Each player lays
// out ships on a grid the other can't see, then they take turns calling shots: hit or miss, and
// "you sank my destroyer!" when the last square of a ship goes. First to sink the whole fleet wins.
//
// It is the first board game here with something to hide, so the engine is built round one rule:
// everything a seat is shown, and everything a computer player decides, is worked out from `seen`,
// which is that seat's knowledge and nothing else. Nothing about a ship the other player still has
// afloat gets past it: not in a cell, a label, a mark or the narration.
//
// Placing is the one phase where both players move at once (`turn` is null): pick a ship, tap where
// its bow goes, turn it, pick it back up, or have them all placed for you, then say you're ready.
// All the other player ever sees of that is "placing" or "ready".
import type { PlayStyle } from "@spades/rules";
import { cellAt, cellName, colOf, rowOf, type BoardGame, type BoardGrid, type BoardPiece, type BoardReserve, type BoardView } from "./board.js";
import { careless, clone, GameError, markReady, nextHandChoices, nextRandom, pickRandom, thinkFor, who, type BaseRules, type Choice } from "./table.js";

export type FleetId = "classic" | "admirals" | "quick";

export interface CombatRules extends BaseRules {
  /** The grids are size × size. */
  size: number;
  fleet: FleetId;
  /** Ships may lie side by side. When false they can't touch, even at a corner. */
  touch: boolean;
  /** Each turn is one shot per ship you still have afloat, all marked before any of them lands. */
  salvo: boolean;
  /** A hit earns another shot (not in Salvo). */
  again: boolean;
  /** Say when a ship is sunk, and which. When false a hit is only ever "hit". */
  announce: boolean;
  /** Who shoots first in the first game. */
  first: "random" | "seat1" | "seat2";
  /** Games in a match: most wins takes it. */
  games: number;
}

export const classicCombat: CombatRules = { id: "combat-classic", name: "Classic", size: 10, fleet: "classic", touch: true, salvo: false, again: false, announce: true, first: "random", games: 1 };
export const admiralsCombat: CombatRules = { id: "combat-admirals", name: "Admirals (ten ships, apart)", size: 10, fleet: "admirals", touch: false, salvo: false, again: true, announce: true, first: "random", games: 1 };
export const salvoCombat: CombatRules = { id: "combat-salvo", name: "Salvo (a shot per ship)", size: 10, fleet: "classic", touch: true, salvo: true, again: false, announce: true, first: "random", games: 1 };
export const quickCombat: CombatRules = { id: "combat-quick", name: "Quick (7×7, three ships)", size: 7, fleet: "quick", touch: true, salvo: false, again: false, announce: true, first: "random", games: 1 };
const PRESETS = [classicCombat, admiralsCombat, salvoCombat, quickCombat];
const SIZES = [7, 8, 10, 12];

/** The ships of each fleet, biggest first: what it's called and how long it is. */
const SHIPS: Record<string, { name: string; size: number }> = {
  carrier: { name: "Carrier", size: 5 },
  cruiser: { name: "Cruiser", size: 4 },
  destroyer: { name: "Destroyer", size: 3 },
  submarine: { name: "Submarine", size: 3 },
  patrol: { name: "Patrol boat", size: 2 },
  scout: { name: "Scout", size: 1 },
};
const FLEETS: Record<FleetId, string[]> = {
  classic: ["carrier", "cruiser", "destroyer", "submarine", "patrol"],
  admirals: ["cruiser", "destroyer", "destroyer", "patrol", "patrol", "patrol", "scout", "scout", "scout", "scout"],
  quick: ["destroyer", "patrol", "patrol"],
};
/** The lengths of a fleet's ships, biggest first. */
export const fleetSizes = (fleet: FleetId) => FLEETS[fleet].map((k) => SHIPS[k]!.size);
const shipName = (kind: string) => SHIPS[kind]?.name ?? "Ship";

export interface Ship {
  kind: string;
  size: number;
  /** The cell its bow is on (its top or left end); null while it's still to be placed. */
  at: number | null;
  /** Lying across (bow at the left) or down (bow at the top). */
  across: boolean;
}

export interface CombatState {
  game: "combat";
  rules: CombatRules;
  seats: number;
  rng: number;
  /** Which game of the match, from 1. */
  round: number;
  /** Who shoots first in this game. */
  first: number;
  /** Each seat's ships. */
  fleets: Ship[][];
  /** Placing: which way each seat's next ship will lie. */
  across: boolean[];
  /** Placing: who has said they're ready. */
  set: boolean[];
  /** shots[seat][cell]: that seat has fired at that cell of the other's grid. */
  shots: boolean[][];
  /** Salvo: the cells a seat has marked for the volley it's about to fire. */
  aims: number[][];
  /** Where each seat's last shot (or volley) went. */
  lastShots: number[][];
  turn: number;
  roundWinner: number | null;
  wins: number[];
  phase: "placing" | "shooting" | "scored" | "finished";
  /** After a game of a match: who has moved on. */
  ready: boolean[];
  narration: string | null;
}

export type CombatMove =
  | { type: "place"; from: number | string; to: number; grid?: string }
  | { type: "turn" }
  | { type: "auto" }
  | { type: "ready" }
  | { type: "shoot"; cell: number; grid?: string }
  | { type: "aim"; cell: number; grid?: string }
  | { type: "fire" }
  | { type: "next" };

const other = (seat: number) => 1 - seat;

// ---- Ships on a grid ----------------------------------------------------------------------------

/** The cells a ship of `size` covers with its bow at `at`, or null if it runs off the grid. */
export function shipCells(n: number, size: number, at: number, across: boolean): number[] | null {
  const r = rowOf(n, at);
  const c = colOf(n, at);
  if (at < 0 || at >= n * n || (across ? c + size > n : r + size > n)) return null;
  return Array.from({ length: size }, (_, i) => (across ? at + i : at + i * n));
}
const cellsOf = (n: number, ship: Ship): number[] => (ship.at === null ? [] : shipCells(n, ship.size, ship.at, ship.across)!);

/** A cell and the (up to eight) cells round it. */
function around(n: number, cell: number): number[] {
  const r = rowOf(n, cell);
  const c = colOf(n, cell);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (r + dr >= 0 && r + dr < n && c + dc >= 0 && c + dc < n) out.push(cellAt(n, r + dr, c + dc));
  return out;
}
/** The (up to four) cells that share a side with a cell. */
function beside(n: number, cell: number): number[] {
  const r = rowOf(n, cell);
  const c = colOf(n, cell);
  const out: number[] = [];
  if (r > 0) out.push(cell - n);
  if (c > 0) out.push(cell - 1);
  if (c < n - 1) out.push(cell + 1);
  if (r < n - 1) out.push(cell + n);
  return out;
}

/** The cells a new ship can't cover: the other ships, and (when ships can't touch) the water round them. */
function blockedBy(n: number, ships: Ship[], touch: boolean, except?: Ship): Set<number> {
  const blocked = new Set<number>();
  for (const ship of ships) {
    if (ship === except) continue;
    for (const cell of cellsOf(n, ship)) for (const c of touch ? [cell] : around(n, cell)) blocked.add(c);
  }
  return blocked;
}

/** Every cell a ship's bow can go on, lying that way, among the ships already down. */
function bowsFor(n: number, size: number, across: boolean, blocked: Set<number>): number[] {
  const out: number[] = [];
  for (let at = 0; at < n * n; at++) {
    const cells = shipCells(n, size, at, across);
    if (cells && cells.every((c) => !blocked.has(c))) out.push(at);
  }
  return out;
}

/** Whether a whole fleet is laid out by the rules: every ship on the grid, none overlapping or (if not allowed) touching. */
export function fleetIsLegal(rules: Pick<CombatRules, "size" | "touch">, ships: Ship[]): boolean {
  return ships.every((ship) => {
    if (ship.at === null) return false;
    const cells = shipCells(rules.size, ship.size, ship.at, ship.across);
    const blocked = blockedBy(rules.size, ships, rules.touch, ship);
    return !!cells && cells.every((c) => !blocked.has(c));
  });
}

const emptyFleet = (fleet: FleetId): Ship[] => FLEETS[fleet].map((kind) => ({ kind, size: SHIPS[kind]!.size, at: null, across: true }));

/** A whole fleet laid out at random, by the rules; null if it couldn't be done (the fleet is too big for the grid). */
export function randomFleet(rules: Pick<CombatRules, "size" | "fleet" | "touch">, rand: () => number, tries = 200): Ship[] | null {
  const n = rules.size;
  for (let attempt = 0; attempt < tries; attempt++) {
    const ships = emptyFleet(rules.fleet);
    let ok = true;
    for (const ship of ships) {
      const blocked = blockedBy(n, ships, rules.touch);
      const spots = [true, false].flatMap((across) => bowsFor(n, ship.size, across, blocked).map((at) => ({ at, across })));
      if (!spots.length) {
        ok = false;
        break;
      }
      Object.assign(ship, pickRandom(spots, rand));
    }
    if (ok) return ships;
  }
  return null;
}

// ---- A game -------------------------------------------------------------------------------------

function startRound(s: CombatState) {
  const cells = s.rules.size * s.rules.size;
  s.fleets = [emptyFleet(s.rules.fleet), emptyFleet(s.rules.fleet)];
  s.across = [true, true];
  s.set = [false, false];
  s.shots = [Array<boolean>(cells).fill(false), Array<boolean>(cells).fill(false)];
  s.aims = [[], []];
  s.lastShots = [[], []];
  s.turn = s.first;
  s.roundWinner = null;
  s.phase = "placing";
  s.ready = [false, false];
  s.narration = null;
}

export function newCombat(rules: CombatRules, seats: number, seed: number): CombatState {
  const s = { game: "combat", rules, seats: 2, rng: seed >>> 0, round: 1, wins: [0, 0] } as CombatState;
  s.first = rules.first === "seat1" ? 0 : rules.first === "seat2" ? 1 : nextRandom(s)() < 0.5 ? 0 : 1;
  startRound(s);
  return s;
}

const sunk = (n: number, ship: Ship, shots: boolean[]) => cellsOf(n, ship).every((c) => shots[c]);
/** How many of a seat's ships are still afloat. */
const afloat = (s: Pick<CombatState, "rules" | "fleets" | "shots">, seat: number) => s.fleets[seat]!.filter((ship) => !sunk(s.rules.size, ship, s.shots[other(seat)]!)).length;

function matchOver(s: CombatState): boolean {
  const left = s.rules.games - s.round;
  return left <= 0 || Math.abs(s.wins[0]! - s.wins[1]!) > left;
}

const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const coordsFor = (n: number) => ({ cols: Array.from({ length: n }, (_, c) => COLS[c]!), rows: Array.from({ length: n }, (_, r) => String(r + 1)) });
const nameOf = (n: number, cell: number) => cellName({ cols: n, coords: coordsFor(n) }, cell);
const listed = (words: string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`);

// ---- What a seat knows --------------------------------------------------------------------------

/**
 * Everything one seat knows about the game, and nothing it doesn't. This is the only place that
 * looks at the other seat's ships; what it lets through is what a shot there told you (hit or
 * miss), the ships you've been told are sunk, and the whole fleet once the game is over.
 */
interface Seen {
  rules: CombatRules;
  me: number;
  phase: CombatState["phase"];
  round: number;
  first: number;
  turn: number;
  wins: number[];
  roundWinner: number | null;
  /** Placing: who is ready. */
  set: boolean[];
  ready: boolean[];
  narration: string | null;
  /** Which way my next ship will lie. */
  across: boolean;
  mine: Ship[];
  /** Where the other seat has shot at my grid, and their last shots. */
  incoming: boolean[];
  lastIn: number[];
  /** What each of my shots did; null where I haven't shot. */
  out: ("hit" | "miss" | null)[];
  lastOut: number[];
  aims: number[];
  /** Their ships I know the place of: the ones announced as sunk, and all of them once it's over. */
  known: { ship: Ship; sunk: boolean }[];
  /** Whether nothing has been fired yet in this game. */
  fresh: boolean;
}

function seen(s: CombatState, me: number): Seen {
  const n = s.rules.size;
  const them = other(me);
  const theirs = s.fleets[them]!;
  const fired = s.shots[me]!;
  const over = s.phase === "scored" || s.phase === "finished";
  const covered = new Set(theirs.flatMap((ship) => cellsOf(n, ship)));
  return {
    rules: s.rules,
    me,
    phase: s.phase,
    round: s.round,
    first: s.first,
    turn: s.turn,
    wins: s.wins,
    roundWinner: s.roundWinner,
    set: s.set,
    ready: s.ready,
    narration: s.narration,
    across: s.across[me]!,
    mine: s.fleets[me]!,
    incoming: s.shots[them]!,
    lastIn: s.lastShots[them]!,
    out: fired.map((shot, cell) => (!shot ? null : covered.has(cell) ? "hit" : "miss")),
    lastOut: s.lastShots[me]!,
    aims: s.aims[me]!,
    known: theirs.map((ship) => ({ ship, sunk: sunk(n, ship, fired) })).filter((k) => over || (s.rules.announce && k.sunk)),
    fresh: !s.shots.some((side) => side.some(Boolean)),
  };
}

/** Water that can't hold a ship: round a ship you know is sunk, when ships can't touch. */
function ruledOut(k: Seen): Set<number> {
  const out = new Set<number>();
  if (k.rules.touch) return out;
  for (const { ship, sunk: down } of k.known) if (down) for (const cell of cellsOf(k.rules.size, ship)) for (const c of around(k.rules.size, cell)) if (k.out[c] === null) out.add(c);
  return out;
}
/** The cells I can still shoot at. */
function openCells(k: Seen): number[] {
  const no = ruledOut(k);
  return k.out.flatMap((o, cell) => (o === null && !no.has(cell) ? [cell] : []));
}
const myAfloat = (k: Seen) => k.mine.filter((ship) => !sunk(k.rules.size, ship, k.incoming)).length;
/** Salvo: how many shots my volley is: one per ship I have afloat, or every cell that's left if that's fewer. */
const volley = (k: Seen) => Math.min(myAfloat(k), openCells(k).length);

/** Placing: where each of my ships can go now. Ships in hand by kind, ships on the grid by their bow. */
function placings(k: Seen): { from: number | string; to: number[] }[] {
  const n = k.rules.size;
  const sources: { from: number | string; to: number[] }[] = [];
  const kinds = new Set<string>();
  for (const ship of k.mine) {
    if (ship.at === null) {
      if (kinds.has(ship.kind)) continue;
      kinds.add(ship.kind);
      sources.push({ from: ship.kind, to: bowsFor(n, ship.size, k.across, blockedBy(n, k.mine, k.rules.touch)) });
    } else {
      // A ship already down can go anywhere it fits with itself out of the way, except just where it is.
      const to = bowsFor(n, ship.size, k.across, blockedBy(n, k.mine, k.rules.touch, ship)).filter((at) => at !== ship.at || k.across !== ship.across);
      sources.push({ from: ship.at, to });
    }
  }
  return sources.filter((s) => s.to.length > 0);
}

// ---- Moves --------------------------------------------------------------------------------------

function onGrid(move: { grid?: unknown }, id: string) {
  if (move.grid !== undefined && move.grid !== id) throw new GameError("That's the wrong board.");
}

function cellOf(s: CombatState, value: unknown): number {
  const cell = typeof value === "number" ? value : NaN;
  if (!Number.isInteger(cell) || cell < 0 || cell >= s.rules.size * s.rules.size) throw new GameError("That's not on the board.");
  return cell;
}

function place(state: CombatState, seat: number, move: CombatMove): CombatState {
  if (state.phase !== "placing") throw new GameError("The ships are already placed.");
  if (state.set[seat]) throw new GameError("You've said you're ready.");
  const s = clone(state);
  const n = s.rules.size;
  const fleet = s.fleets[seat]!;
  if (move.type === "turn") {
    s.across[seat] = !s.across[seat];
    return s;
  }
  if (move.type === "auto") {
    const laid = randomFleet(s.rules, nextRandom(s));
    if (!laid) throw new GameError("That fleet doesn't fit on this board.");
    s.fleets[seat] = laid;
    return s;
  }
  if (move.type === "ready") {
    if (fleet.some((ship) => ship.at === null)) throw new GameError("Place all your ships first.");
    // Each ship was checked as it went down; check the whole fleet once more before it's final.
    if (!fleetIsLegal(s.rules, fleet)) throw new GameError("Those ships aren't placed by the rules.");
    s.set[seat] = true;
    if (s.set.every(Boolean)) {
      s.phase = "shooting";
      s.turn = s.first;
    }
    return s;
  }
  if (move.type !== "place") throw new GameError("That's not a move in Combat.");
  onGrid(move, "mine");
  const to = cellOf(s, move.to);
  const ship = typeof move.from === "string" ? fleet.find((sh) => sh.at === null && sh.kind === move.from) : fleet.find((sh) => cellsOf(n, sh).includes(move.from as number));
  if (!ship) throw new GameError(typeof move.from === "string" ? "You have no ship like that left to place." : "There's no ship there.");
  const across = s.across[seat]!;
  if (ship.at === to && ship.across === across) throw new GameError("It's already there.");
  const cells = shipCells(n, ship.size, to, across);
  if (!cells) throw new GameError("It doesn't fit there: it would run off the board.");
  const blocked = blockedBy(n, fleet, true, ship);
  if (cells.some((c) => blocked.has(c))) throw new GameError("There's a ship in the way.");
  if (!s.rules.touch) {
    const near = blockedBy(n, fleet, false, ship);
    if (cells.some((c) => near.has(c))) throw new GameError("Ships can't touch, even at a corner.");
  }
  ship.at = to;
  ship.across = across;
  return s;
}

/** Land shots on the other seat's grid and say what they did. Changes `s`: callers pass a copy. */
function land(s: CombatState, seat: number, cells: number[]) {
  const n = s.rules.size;
  const them = other(seat);
  const theirs = s.fleets[them]!;
  const before = theirs.map((ship) => sunk(n, ship, s.shots[seat]!));
  for (const cell of cells) s.shots[seat]![cell] = true;
  s.lastShots[seat] = cells;
  s.aims[seat] = [];
  const hits = cells.filter((cell) => theirs.some((ship) => cellsOf(n, ship).includes(cell))).length;
  const down = theirs.filter((ship, i) => !before[i] && sunk(n, ship, s.shots[seat]!));
  const many = s.rules.games > 1;
  if (afloat(s, them) === 0) {
    s.wins[seat]! += 1;
    s.roundWinner = seat;
    s.narration = `${who(seat)} sinks the last of ${who(them)}'s fleet${many ? ` and wins game ${s.round}` : ""}!`;
    s.phase = matchOver(s) ? "finished" : "scored";
    return;
  }
  const what =
    cells.length === 1
      ? `${who(seat)} fires at ${nameOf(n, cells[0]!)}: ${hits ? "hit!" : "miss"}`
      : `${who(seat)} fires ${cells.length} shots: ${hits === 0 ? "all miss" : `${hits} hit${hits === 1 ? "" : "s"}!`}`;
  // The old cry, in the other player's mouth. Without the announce rule a sinking is only a hit.
  const cry = s.rules.announce && down.length ? ` ${who(them)} says: “You sank my ${listed(down.map((ship) => shipName(ship.kind)))}!”` : "";
  const again = s.rules.again && !s.rules.salvo && hits > 0;
  s.narration = what + cry;
  if (!again) s.turn = them;
}

function apply(state: CombatState, seat: number, move: CombatMove): CombatState {
  if (seat !== 0 && seat !== 1) throw new GameError("You're not in this game.");
  if (move?.type === "next") {
    if (state.phase !== "scored") throw new GameError("There's a game going on.");
    const s = clone(state);
    if (markReady(s.ready, seat)) {
      // Take turns shooting first.
      s.round += 1;
      s.first = other(s.first);
      startRound(s);
    }
    return s;
  }
  if (move?.type === "place" || move?.type === "turn" || move?.type === "auto" || move?.type === "ready") return place(state, seat, move);
  if (move?.type !== "shoot" && move?.type !== "aim" && move?.type !== "fire") throw new GameError("That's not a move in Combat.");
  if (state.phase === "placing") throw new GameError("Not until both fleets are placed.");
  if (state.phase !== "shooting") throw new GameError("This game is over.");
  if (state.turn !== seat) throw new GameError("It's not your turn.");
  const k = seen(state, seat);
  if (move.type === "fire") {
    if (!state.rules.salvo) throw new GameError("Tap a square to shoot.");
    const due = volley(k);
    if (state.aims[seat]!.length < due) throw new GameError(`Mark ${due} squares first.`);
    const s = clone(state);
    land(s, seat, [...s.aims[seat]!]);
    return s;
  }
  onGrid(move, "theirs");
  const cell = cellOf(state, move.cell);
  if (state.rules.salvo !== (move.type === "aim")) throw new GameError(state.rules.salvo ? "Mark your shots, then fire them together." : "Tap a square to shoot.");
  if (move.type === "aim" && state.aims[seat]!.includes(cell)) {
    // Tapping a marked square takes the mark off.
    const s = clone(state);
    s.aims[seat] = s.aims[seat]!.filter((c) => c !== cell);
    return s;
  }
  if (state.shots[seat]![cell]) throw new GameError("You've already shot there.");
  if (ruledOut(k).has(cell)) throw new GameError("No ship can be there: ships never touch.");
  const s = clone(state);
  if (move.type === "aim") {
    if (s.aims[seat]!.length >= volley(k)) throw new GameError("That's all your shots marked: fire, or take one back.");
    s.aims[seat]!.push(cell);
    return s;
  }
  land(s, seat, [cell]);
  return s;
}

const winners = (s: Pick<CombatState, "wins">) => [s.wins[0]! >= s.wins[1]! ? 0 : 1];

// ---- What a seat sees ---------------------------------------------------------------------------

const MISS: BoardPiece = { owner: null, kind: "miss", glyph: "●", label: "miss", tone: "light" };
const HIT: BoardPiece = { owner: null, kind: "hit", glyph: "✕", label: "hit", tone: "red" };
const AIM: BoardPiece = { owner: null, kind: "aim", glyph: "◎", label: "marked to fire", tone: "gold" };
const CLEAR: BoardPiece = { owner: null, kind: "clear", glyph: "·", label: "no ship can be here", tone: "dark", faded: true };

/** One square of a ship: whole, hit, or part of a sunk ship. The squares of one ship share a `span`, so the table joins them into a hull. */
function hull(owner: number, ship: Ship, span: string, shot: boolean, down: boolean): BoardPiece {
  const name = shipName(ship.kind);
  if (down) return { owner, kind: "sunk", glyph: "✕", label: `sunk ${name}`, tone: "red", span };
  if (shot) return { owner, kind: "hit", glyph: "✕", label: `${name}, hit`, tone: "red", span };
  return { owner, kind: "ship", glyph: "■", label: name, tone: "dark", span };
}

/** A ship off the board, for a reserve: a block per square of it. */
const inHand = (owner: number, kind: string): BoardPiece => ({ owner, kind, glyph: "■".repeat(SHIPS[kind]!.size), label: `${shipName(kind)}, ${SHIPS[kind]!.size} long`, tone: "dark" });

function reserve(owner: number, label: string, kinds: string[]): BoardReserve {
  const counts = new Map<string, number>();
  for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return { owner, label, pieces: [...counts].map(([kind, count]) => ({ piece: inHand(owner, kind), count })) };
}

function render(k: Seen): BoardView {
  const { rules, me } = k;
  const n = rules.size;
  const them = other(me);
  const many = rules.games > 1;
  const over = k.phase === "finished";
  const done = over || k.phase === "scored";
  const myTurn = k.phase === "shooting" && k.turn === me;
  const base = { rows: n, cols: n, coords: coordsFor(n), shade: Array<"water">(n * n).fill("water") };

  // My own grid: my ships, and where the other player has shot.
  const mine: BoardGrid = { id: "mine", label: "Your fleet", owner: me, ...base, cells: k.incoming.map((shot) => (shot ? MISS : null)), marks: k.lastIn.map((cell) => ({ cell, mark: "last" as const })) };
  k.mine.forEach((ship, i) => {
    const down = sunk(n, ship, k.incoming);
    for (const cell of cellsOf(n, ship)) mine.cells[cell] = hull(me, ship, `ship-${i}`, k.incoming[cell]!, down);
  });

  // Theirs: only what my shots have told me, until the game is over.
  const no = ruledOut(k);
  const theirs: BoardGrid = {
    id: "theirs",
    label: `${who(them)}'s waters`,
    ...base,
    cells: k.out.map((o, cell) => (o === "hit" ? HIT : o === "miss" ? MISS : k.aims.includes(cell) ? AIM : no.has(cell) && !done ? CLEAR : null)),
    marks: k.lastOut.map((cell) => ({ cell, mark: "last" as const })),
  };
  for (const { ship, sunk: down } of k.known) for (const cell of cellsOf(n, ship)) theirs.cells[cell] = { ...hull(them, ship, `theirs-${ship.at}`, k.out[cell] !== null, down), ...(k.out[cell] === null ? { faded: true } : {}) };

  const info = [...(rules.touch ? [] : ["Ships can't touch"]), ...(rules.salvo ? ["Salvo: a shot for each ship you have afloat"] : rules.again ? ["A hit earns another shot"] : []), ...(many ? [`Game ${k.round} of ${rules.games}`] : [])];
  const wins = (seat: number) => (many ? `${k.wins[seat]} win${k.wins[seat] === 1 ? "" : "s"}` : "");
  const scores = k.wins.map((value, i) => ({ seats: [i], value }));
  const common = { game: "combat" as const, seats: 2, me, teams: false, phase: k.phase, scores, info };

  if (k.phase === "placing") {
    const sources = k.set[me] ? [] : placings(k);
    const inMyHand = k.mine.filter((ship) => ship.at === null);
    // The next ship to place is picked up for you: the first in hand that has somewhere to go.
    const next = sources.find((s) => typeof s.from === "string");
    if (sources.length) mine.select = { type: "place", sources, ...(next ? { suggest: next.from } : {}) };
    const options: Choice[] = [
      { label: k.across ? "Turn ships ↕ (now across)" : "Turn ships ↔ (now down)", move: { type: "turn" }, hint: "Which way the next ship you put down will lie" },
      { label: inMyHand.length === k.mine.length ? "Place them for me" : "Shuffle them for me", move: { type: "auto" }, hint: "Lay the whole fleet out at random" },
      ...(inMyHand.length ? [] : [{ label: "Ready", move: { type: "ready" }, primary: true }]),
    ];
    const stuck = inMyHand.length > 0 && !next;
    return {
      ...common,
      turn: null,
      grids: [mine],
      reserves: inMyHand.length ? [reserve(me, "To place", inMyHand.map((ship) => ship.kind))] : [],
      choices: k.set[me] ? null : { prompt: "", layout: "row", options },
      // All anyone is told about the other player's grid: still placing, or ready.
      players: k.set.map((ready, i) => ({ line: ready ? "Ready" : "Placing ships", badge: wins(i) || undefined })),
      narration: k.set[me]
        ? `Your fleet is ready. Waiting for ${who(them)}…`
        : stuck
          ? "That ship doesn't fit lying this way: turn it, or move another ship"
          : inMyHand.length
            ? `Place your ${shipName(inMyHand[0]!.kind)} (${inMyHand[0]!.size} long): tap where its bow goes`
            : "Tap a ship to move it, or say you're ready",
      result: null,
      over: null,
    };
  }

  const due = rules.salvo && myTurn ? volley(k) : 0;
  const full = rules.salvo && myTurn && k.aims.length >= due;
  if (myTurn) theirs.tap = rules.salvo ? { type: "aim", cells: full ? [...k.aims] : openCells(k) } : { type: "shoot", cells: openCells(k) };
  // What's left of each fleet. Without the announce rule nobody is told what they've sunk, so the other fleet is listed whole.
  const left = (ships: Ship[], shots: boolean[]) => ships.filter((ship) => !sunk(n, ship, shots)).map((ship) => ship.kind);
  const sunkKinds = k.known.filter((x) => x.sunk).map((x) => x.ship.kind);
  const theirKinds = [...FLEETS[rules.fleet]];
  for (const kind of sunkKinds) theirKinds.splice(theirKinds.indexOf(kind), 1);
  const scoreTitle = k.roundWinner === null ? "" : `${who(k.roundWinner)} wins game ${k.round}`;
  const w = winners(k);
  return {
    ...common,
    turn: k.phase === "shooting" ? k.turn : null,
    grids: [theirs, mine],
    reserves: [reserve(them, rules.announce || done ? "Afloat" : "Fleet", theirKinds), reserve(me, "Afloat", left(k.mine, k.incoming))],
    choices: k.phase === "scored" ? nextHandChoices(k.ready, me, false, "Next game") : full ? { prompt: "", options: [{ label: due === 1 ? "Fire!" : `Fire all ${due}!`, move: { type: "fire" }, primary: true }] } : null,
    players: k.wins.map((_, i) => ({ line: wins(i), badge: k.phase === "shooting" && k.fresh && i === k.first ? "Shoots first" : undefined })),
    info: [...info, ...(rules.salvo && myTurn ? [`Shots marked: ${k.aims.length} of ${due}`] : [])],
    narration: k.narration ?? (myTurn ? (rules.salvo ? `You shoot first: mark ${due} squares, then fire` : "You shoot first: tap a square") : null),
    result: many && done ? { key: `game-${k.round}`, title: scoreTitle, sides: [[0], [1]], rows: [{ label: "Wins", values: k.wins.map(String), tone: "total" }] } : null,
    over: over ? { winners: w, title: `${who(w[0]!)} wins${many ? ` ${k.wins[w[0]!]} to ${k.wins[other(w[0]!)]}` : ""}!` } : null,
  };
}

const view = (s: CombatState, seat: number): BoardView => render(seen(s, seat));

// ---- Computer players ---------------------------------------------------------------------------
// A computer player is handed `seen` like the table is, so it can't know more than a person in
// its seat would.
//
// Placing: one ship at a time, like a person. A careless player drops them anywhere; a careful one
// keeps them apart, since ships side by side are found together.
//
// Shooting is hunt and target. With a hit on a ship that's still afloat, it targets: every way a
// ship that's left could lie through the hits is counted, and lines through two hits count for far
// more than lines through one, so it works along a ship until it's sunk. With nothing to chase, it
// hunts: at top skill by counting, for every open square, how many ways the ships that are left
// could still cover it; otherwise on a checkerboard as wide as the smallest ship left, which can't
// miss a ship. A careless shot (see `careless`) forgets all that and lands anywhere.

const skillOf = (style: PlayStyle) => style.skill ?? 1;

function botPlace(k: Seen, style: PlayStyle, rand: () => number): CombatMove | null {
  if (k.set[k.me]) return null;
  const n = k.rules.size;
  const next = k.mine.find((ship) => ship.at === null);
  if (!next) return { type: "ready" };
  const blocked = blockedBy(n, k.mine, k.rules.touch);
  const here = bowsFor(n, next.size, k.across, blocked);
  const turned = bowsFor(n, next.size, !k.across, blocked);
  // Boxed in: start again. Otherwise turn the ship about half the time, so fleets lie both ways.
  if (!here.length) return turned.length ? { type: "turn" } : { type: "auto" };
  if (turned.length && rand() < 0.4) return { type: "turn" };
  if (careless(style, rand)) return { type: "place", from: next.kind, to: pickRandom(here, rand) };
  // How many squares of other ships a ship here would lie against.
  const taken = new Set(k.mine.flatMap((ship) => cellsOf(n, ship)));
  const crowd = (at: number) => new Set(shipCells(n, next.size, at, k.across)!.flatMap((c) => around(n, c)).filter((c) => taken.has(c))).size;
  const least = Math.min(...here.map(crowd));
  return { type: "place", from: next.kind, to: pickRandom(here.filter((at) => crowd(at) === least), rand) };
}

/** The hits I'm still chasing: not part of a ship I know is sunk. */
function liveHits(k: Seen): number[] {
  const n = k.rules.size;
  const dead = new Set(k.known.filter((x) => x.sunk).flatMap((x) => cellsOf(n, x.ship)));
  const hits = k.out.flatMap((o, cell) => (o === "hit" && !dead.has(cell) ? [cell] : []));
  if (k.rules.announce) return hits;
  // Nobody says when a ship is sunk, so work it out as a person would: a straight run of hits with
  // no open water at either end, as long as some ship, is taken to be a ship that's gone.
  const sizes = new Set(fleetSizes(k.rules.fleet));
  const hit = (cell: number | null) => cell !== null && k.out[cell] === "hit";
  const open = (cell: number | null) => cell !== null && k.out[cell] === null;
  const step = (cell: number, dr: number, dc: number): number | null => {
    const r = rowOf(n, cell) + dr;
    const c = colOf(n, cell) + dc;
    return r >= 0 && r < n && c >= 0 && c < n ? cellAt(n, r, c) : null;
  };
  return hits.filter((cell) => {
    for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
      let a = cell;
      let b = cell;
      let length = 1;
      for (let p = step(a, -dr, -dc); hit(p); p = step(a, -dr, -dc)) [a, length] = [p!, length + 1];
      for (let p = step(b, dr, dc); hit(p); p = step(b, dr, dc)) [b, length] = [p!, length + 1];
      if (length > 1 && sizes.has(length) && !open(step(a, -dr, -dc)) && !open(step(b, dr, dc))) return false;
    }
    // A hit on its own is finished with once there's no open water beside it.
    return beside(n, cell).some((c) => k.out[c] === null);
  });
}

/** The best square to shoot next, counting `aims` (the rest of a volley) as already gone. */
function botShot(k: Seen, style: PlayStyle, rand: () => number): number | null {
  const n = k.rules.size;
  const open = openCells(k).filter((cell) => !k.aims.includes(cell));
  if (!open.length) return null;
  if (careless(style, rand)) return pickRandom(open, rand);
  const skill = skillOf(style);
  const canHold = new Set(open);
  const live = new Set(liveHits(k));
  if (!k.rules.touch) {
    // Ships never touch, so the squares at the corners of a hit are water.
    for (const cell of live) for (const c of around(n, cell)) if (rowOf(n, c) !== rowOf(n, cell) && colOf(n, c) !== colOf(n, cell)) canHold.delete(c);
  }
  // The ships still to find. When sinkings aren't announced, that's all of them, as far as I'm told.
  const sizes = fleetSizes(k.rules.fleet);
  for (const x of k.known) if (x.sunk) sizes.splice(sizes.indexOf(x.ship.size), 1);
  const best = (score: number[]) => {
    let top = -1;
    let cell: number | null = null;
    for (const c of canHold) {
      const value = score[c]! + rand() * 0.5;
      if (score[c]! > 0 && value > top) [top, cell] = [value, c];
    }
    return cell;
  };
  /** For every open square, the ways a ship that's left could cover it; `chasing` counts only ways through a live hit. */
  const count = (chasing: boolean) => {
    const score = Array<number>(n * n).fill(0);
    for (const size of sizes) {
      for (const across of size === 1 ? [true] : [true, false]) {
        for (let at = 0; at < n * n; at++) {
          const cells = shipCells(n, size, at, across);
          if (!cells || !cells.every((c) => canHold.has(c) || live.has(c))) continue;
          const through = cells.filter((c) => live.has(c)).length;
          if (chasing ? through === 0 : through > 0) continue;
          // Two hits in a line say far more about where a ship lies than one.
          const weight = 12 ** through;
          for (const c of cells) if (!live.has(c)) score[c]! += weight;
        }
      }
    }
    return score;
  };
  if (live.size) {
    const beside1 = [...new Set([...live].flatMap((cell) => beside(n, cell)))].filter((c) => canHold.has(c));
    // A middling player knows to shoot next to a hit, but not which side.
    const cell = skill >= 0.5 ? best(count(true)) : beside1.length ? pickRandom(beside1, rand) : null;
    if (cell !== null) return cell;
  }
  if (skill >= 0.9) {
    const cell = best(count(false));
    if (cell !== null) return cell;
  }
  // A checkerboard as wide as the smallest ship left. Keep to the colour already most shot at, so
  // the pattern holds from one turn to the next without having to remember it.
  const gap = Math.max(1, Math.min(...sizes, n));
  const lane = (cell: number) => (rowOf(n, cell) + colOf(n, cell)) % gap;
  const used = Array<number>(gap).fill(0);
  k.out.forEach((o, cell) => o !== null && used[lane(cell)]!++);
  for (const cell of k.aims) used[lane(cell)]!++;
  const lanes = [...used.keys()].sort((a, b) => used[b]! - used[a]!);
  const pool = [...canHold];
  for (const l of lanes) {
    const cells = pool.filter((cell) => lane(cell) === l);
    if (cells.length) return pickRandom(cells, rand);
  }
  return pickRandom(pool.length ? pool : open, rand);
}

function decide(k: Seen, style: PlayStyle, rand: () => number): CombatMove | null {
  if (k.phase === "scored") return k.ready[k.me] ? null : { type: "next" };
  if (k.phase === "placing") return botPlace(k, style, rand);
  if (k.phase !== "shooting" || k.turn !== k.me) return null;
  if (!k.rules.salvo) {
    const cell = botShot(k, style, rand);
    return cell === null ? null : { type: "shoot", cell, grid: "theirs" };
  }
  if (k.aims.length >= volley(k)) return { type: "fire" };
  // A volley is marked a square at a time; each mark counts as gone when choosing the next, which
  // spreads the shots: both ends of a ship being chased, then different parts of the sea.
  const cell = botShot(k, style, rand);
  return cell === null ? null : { type: "aim", cell, grid: "theirs" };
}

const bot = (s: CombatState, seat: number, style: PlayStyle, rand: () => number = Math.random): CombatMove | null => decide(seen(s, seat), style, rand);

// ---- The game -----------------------------------------------------------------------------------

function normalize(rules: unknown): CombatRules {
  const given = (rules && typeof rules === "object" ? rules : {}) as Partial<CombatRules>;
  const base = PRESETS.find((p) => p.id === given.id) ?? classicCombat;
  const r = { ...base, ...given };
  const salvo = !!r.salvo;
  return {
    id: String(r.id),
    name: String(r.name),
    size: Math.min(12, Math.max(6, Math.round(Number(r.size)) || 10)),
    fleet: r.fleet === "admirals" || r.fleet === "quick" ? r.fleet : "classic",
    touch: !!r.touch,
    salvo,
    // A volley is already several shots: a hit doesn't earn more.
    again: !salvo && !!r.again,
    announce: !!r.announce,
    first: r.first === "seat1" || r.first === "seat2" ? r.first : "random",
    games: [1, 3, 5, 7].includes(Number(r.games)) ? Number(r.games) : 1,
  };
}

const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function fleetWords(fleet: FleetId): string {
  const counts = new Map<string, number>();
  for (const kind of FLEETS[fleet]) counts.set(kind, (counts.get(kind) ?? 0) + 1);
  return listed([...counts].map(([kind, count]) => `${count === 1 ? "a" : NUMBER[count]} ${shipName(kind).toLowerCase()}${count === 1 ? "" : "s"} (${SHIPS[kind]!.size})`));
}

export const combat: BoardGame<CombatRules, CombatState, CombatMove> = {
  id: "combat",
  name: "Combat",
  emoji: "🚢",
  blurb: "Hide your fleet, hunt theirs",
  tagline: "Lay out your ships where nobody can see, then take turns calling shots. First to sink the other fleet wins.",
  seats: { min: 2, max: 2, default: 2 },
  teams: false,
  presets: PRESETS,
  fields: [
    { key: "size", label: "Board size", kind: "choice", options: SIZES.map((n) => [n, `${n}×${n}`]) },
    { key: "fleet", label: "Fleet", kind: "choice", options: [["classic", "Classic: 5, 4, 3, 3, 2"], ["admirals", "Admirals: 4, 3, 3, 2, 2, 2, 1, 1, 1, 1"], ["quick", "Quick: 3, 2, 2"]] },
    { key: "touch", label: "Ships may touch", hint: "When off, ships can't lie side by side or corner to corner", kind: "toggle" },
    { key: "salvo", label: "Salvo", hint: "Each turn, a shot for every ship you still have afloat, all marked before any lands", kind: "toggle" },
    { key: "again", label: "A hit earns another shot", hint: "Not in Salvo", kind: "toggle" },
    { key: "announce", label: "Say what was sunk", hint: "When off, a hit is only ever a hit: nobody is told when a ship goes down", kind: "toggle" },
    { key: "first", label: "Who shoots first", kind: "choice", options: [["random", "Luck of the draw"], ["seat1", "The first seat"], ["seat2", "The second seat"]] },
    { key: "games", label: "Games in a match", kind: "choice", options: [[1, "Just one"], [3, "Three"], [5, "Five"], [7, "Seven"]] },
  ],
  normalize,
  validate(r) {
    // Laying one out is the test (always the same way, so the same rules always give the same answer).
    return randomFleet(r, nextRandom({ rng: 1 }), 60) ? [] : [`That fleet doesn't fit on a ${r.size}×${r.size} board${r.touch ? "" : " without ships touching"}.`];
  },
  describe(r) {
    return [
      `Each player hides a fleet on their own ${r.size}×${r.size} grid: ${fleetWords(r.fleet)}. Ships lie in a straight line, across or down.`,
      r.touch ? "Ships may lie right next to each other, but never on top of one another." : "Ships can't touch each other, not even at a corner.",
      "Both players place their ships at the same time. Nobody sees the other's grid.",
      r.salvo
        ? "Then take turns firing a volley: one shot for every ship you still have afloat. Mark them all, then fire them together."
        : `Then take turns calling a shot at one square of the other grid: hit or miss.${r.again ? " A hit earns another shot." : ""}`,
      r.announce ? "A ship is sunk when every square of it has been hit, and its owner says which ship it was." : "A ship is sunk when every square of it has been hit, but nobody says so: a hit is only ever a hit.",
      "The first to sink the whole of the other fleet wins.",
      r.first === "random" ? "Who shoots first is the luck of the draw." : `The ${r.first === "seat1" ? "first" : "second"} seat shoots first.`,
      ...(r.games > 1 ? [`A match is ${r.games} games; most wins takes it. Players take turns shooting first.`] : []),
    ];
  },
  newGame: newCombat,
  apply,
  view,
  bot,
  // Placing is quick, quiet work; a shot gets a moment's thought, a volley's marks less each.
  thinkingTime: (s) => (s.phase === "placing" ? 350 : s.rules.salvo ? 450 : thinkFor(3)),
  summary(s) {
    const over = s.phase === "finished";
    const w = winners(s);
    return {
      game: "combat",
      rules: s.rules.name,
      phase: s.phase,
      over,
      hand: s.round,
      // Only the match score: how many ships each side has left isn't everyone's to know.
      scoreLine: `${s.wins[0]} to ${s.wins[1]}`,
      order: over ? [w[0]!, other(w[0]!)] : null,
      winners: over ? w : null,
      teams: false,
      seats: s.seats,
    };
  },
};
