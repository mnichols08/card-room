// The table-sports kit: what one seat sees of any game played by striking a ball across a table,
// in one shared shape, the way KitView is for cards and BoardView is for boards. One table screen
// (SportTable in the web app) draws every such game from it on a canvas, and the same room on the
// server runs them.
//
// These games stay turn-based. A move is a shot in the physics core's whole numbers (which body,
// an angle in hundredths of a degree, a power from 0 to 1000). The engine plays the shot to rest
// with `simulate` and keeps where everything stopped; the view carries that shot and the bodies it
// started from, and each browser steps the very same simulation to animate it, landing on the
// table the server already decided. The physics core gives bit-identical results everywhere, so
// the animation is a replay and never a guess.
//
// It is shaped for more than the first game. A view is a physics world (walls, pockets, regions
// and any number of bodies of any size) with a separate description of how each part is drawn,
// and what a seat may do is one line: which body it may strike and how hard. Mini golf has one
// ball a player; eight-ball has sixteen bodies and you strike the cue ball; Carrom's striker and
// a bowling ball are bigger, heavier bodies in the same list.
import type { Body, Point, Shot, World } from "@cardroom/physics";
import type { BaseRules, Choices, GameOver, RoundResult, Scores, SportGameId, TableGame } from "./table.js";

/**
 * Lengths in a sport's world are tenths of a millimetre, as in the physics core's examples, so a
 * table can say "1.2 m from the cup" to someone who can't see it.
 */
export const UNITS_PER_METRE = 10000;

/** What a patch of the table is, for drawing: the table screen decides what each looks like. */
export type SportSurface = "green" | "rough" | "sand" | "water" | "slope" | "felt" | "wood" | "lane";

/** The colours a ball can take. */
export type SportTone = "white" | "red" | "blue" | "gold" | "green" | "purple" | "orange" | "pink" | "maroon" | "black";

/** How one body is drawn and who it belongs to. Bodies without an entry are drawn plain. */
export interface SportBody {
  /** The body's id in the world (or a ghost's own id). */
  id: string;
  /** Whose it is (a seat), or null for something that is nobody's: an object ball, a pin, a bumper. */
  owner: number | null;
  /** What it is, in the game's own words: "ball", "cue", "striker", "pin", "bumper". */
  kind: string;
  tone: SportTone;
  /** What a screen reader says: "your ball", "the 8 ball". */
  label: string;
  /** Drawn on it: a pool ball's number, a player's initial. */
  mark?: string;
  /** A striped pool ball. */
  striped?: boolean;
}

/**
 * Something drawn on the table that the physics of this view knows nothing about: in mini golf,
 * the other players' balls (which never collide with yours). It can't be struck or hit.
 */
export interface SportGhost extends SportBody {
  x: number;
  y: number;
  r: number;
}

/** Scenery, in world units. None of it touches the ball. */
export interface SportDecor {
  kind: "tee" | "flag" | "bush" | "flowers" | "rock" | "tree";
  x: number;
  y: number;
  /** Size, for the things that have one. */
  r?: number;
}

/** How the world is drawn. The world says where things are; this says what they are. */
export interface SportLook {
  /** The rectangle the screen fits and centres: the table and a margin round it. */
  frame: { x: number; y: number; w: number; h: number };
  /** The playing surface, filled in order: the green of a hole, the cloth of a pool table. */
  ground: { points: Point[]; surface: SportSurface }[];
  /** What each region of the world is drawn as, in drawing order. A region left out is not drawn. */
  regions: { id: string; surface: SportSurface }[];
  /** Closed walls that are solid things standing on the table (a block, a planter), filled in. */
  blocks: string[];
  /** Pockets are drawn as golf cups (with a flag) or as the pockets of a pool table. */
  pockets: "cup" | "pocket";
  decor: SportDecor[];
}

/** What a seat may strike now. Later additions sit beside these: `place` for a ball in hand, `spin`. */
export interface SportShoot {
  /** The body to strike. */
  body: string;
  /** The power may be anything from here… */
  minPower: number;
  /** …to here (1000 is the world's full shot speed). */
  maxPower: number;
}

/** Where one body stopped when the physics came to rest, before the game's rules moved anything. */
export interface SportRest {
  id: string;
  x: number;
  y: number;
  pocketed?: string;
  out?: string;
}

/**
 * The shot just taken, enough for a browser to play it again: put `from` in place of the bodies
 * of the view's world (see `worldBefore`), run the shot, and it ends at `rest`. After that the
 * screen shows the view's world as it is, which is `rest` with the game's rules applied (in mini
 * golf, a ball that went in the water is back where it was struck from).
 */
export interface SportShot {
  /** Counts the shots of a game from 1, so each is animated once. */
  n: number;
  seat: number;
  shot: Shot;
  /** The bodies as they were when the shot was struck. */
  from: Body[];
  rest: SportRest[];
  /** How many steps of the world's tick the shot took. */
  ticks: number;
  /** The PHYSICS_VERSION that played it. A browser on another version shows the result without stepping. */
  physics: number;
}

/** A score sheet with a column per hole (or frame, or rack) and a row per player. */
export interface SportCard {
  title: string;
  /** `sub` is a second line under the label: a hole's par. */
  columns: { label: string; sub?: string }[];
  /** The column being played, if any. */
  current: number | null;
  rows: { seat: number; cells: string[]; total: string; note?: string }[];
  /** What `total` and `note` are, for the headings: "Total", "To par". */
  totalLabel: string;
  noteLabel?: string;
}

export interface SportSeat {
  /** A short line under the name: "2 strokes", "Holed in 3". */
  line: string;
  /** What this seat plays with, shown beside the name. */
  body?: SportBody;
  /** Partners: 0 or 1 (seats 0 and 2 are team 0). */
  team?: 0 | 1;
  /** Finished with this table for now: holed out, or picked up. */
  done?: boolean;
  badge?: string;
}

export interface SportView {
  game: SportGameId;
  seats: number;
  me: number;
  teams: boolean;
  phase: string;
  /** Whose shot it is, or null when everyone may shoot (each at their own ball) or nobody may. */
  turn: number | null;
  table: {
    /** Changes when the table is a different one (the next hole), so the screen fits it afresh. */
    key: string;
    /** "Hole 3: The Elbow". */
    name: string;
    /** The table at rest, as this seat's next shot would find it. */
    world: World;
    look: SportLook;
    /** How the world's bodies are drawn, by id. */
    bodies: SportBody[];
    ghosts: SportGhost[];
  };
  /** What this seat may strike now, or null. */
  shoot: SportShoot | null;
  /** The last shot on this table that this seat should see played, or null. */
  last: SportShot | null;
  card: SportCard | null;
  /** Buttons: "Next hole", "Rack them up". */
  choices: Choices | null;
  players: SportSeat[];
  /** Small facts for the table: "Par 3", "Stroke 2". */
  info: string[];
  /** What just happened, in words. */
  narration: string | null;
  scores: Scores;
  /** After a hole or a frame, until everyone moves on; and with `over`, the final summary. */
  result: RoundResult | null;
  /** `winners` is every seat when it's a tie. */
  over: GameOver | null;
}

/** A table sport: an engine whose seats see a `SportView`, and whose moves are shots and buttons. */
export interface SportGame<R extends BaseRules = BaseRules, S = unknown, M = Record<string, unknown>> extends TableGame<R, S, M, SportView> {
  id: SportGameId;
  /**
   * Work worth doing once before the first table opens. A JavaScript engine runs the simulation
   * slowly until it has seen it a few hundred times, and a game may keep maps of its tables; a
   * server calls this as it starts, so the first shot of the day isn't the slow one.
   */
  warmUp?(): void;
}

/** A shot as a move. The numbers are the physics core's: whole, and checked again by the engine. */
export interface ShotMove {
  type: "shot";
  body: string;
  /** Whole hundredths of a degree, 0 to 35999. 0 is along +x, 9000 along +y (down the screen). */
  angle: number;
  /** A whole number within the view's `shoot` range. */
  power: number;
}

// ---- Helpers for engines, tables and tests ------------------------------------------------------

/** The world as it was when the view's last shot was struck: what a browser simulates from. */
export function worldBefore(view: Pick<SportView, "table" | "last">): World | null {
  return view.last ? { ...view.table.world, bodies: view.last.from } : null;
}

/** Where the bodies of a resting world are, in the short form a view carries. */
export function restOf(world: World): SportRest[] {
  return world.bodies.map((b) => ({ id: b.id, x: b.x, y: b.y, ...(b.pocketed !== undefined ? { pocketed: b.pocketed } : {}), ...(b.out !== undefined ? { out: b.out } : {}) }));
}

/** Whether a locally stepped world ended exactly where the server said it would. */
export function sameRest(world: World, rest: SportRest[]): boolean {
  if (world.bodies.length !== rest.length) return false;
  return world.bodies.every((b, i) => {
    const r = rest[i]!;
    return b.id === r.id && b.x === r.x && b.y === r.y && b.pocketed === r.pocketed && b.out === r.out;
  });
}

/** The angle (in the physics core's hundredths of a degree) from one point towards another. */
export function angleTo(from: { x: number; y: number }, to: { x: number; y: number }): number {
  // Aiming is free to use any maths: only the rounded whole number is ever sent or simulated.
  const a = Math.round((Math.atan2(to.y - from.y, to.x - from.x) * 18000) / Math.PI);
  return ((a % 36000) + 36000) % 36000;
}

/**
 * Some of what a seat can send from a view, as moves: every button, and when it may shoot, a
 * spread of shots across the range it is offered. (There are 36 million shots; the shared tests
 * play from these.)
 */
export function sportMovesOffered(view: SportView): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (view.shoot) {
    const { body, minPower, maxPower } = view.shoot;
    const mid = Math.round((minPower + maxPower) / 2);
    for (const angle of [0, 4500, 9000, 13500, 18000, 22500, 27000, 31500, 35999]) for (const power of [minPower, mid, maxPower]) out.push({ type: "shot", body, angle, power });
  }
  for (const o of view.choices?.options ?? []) out.push(o.move);
  return out;
}
