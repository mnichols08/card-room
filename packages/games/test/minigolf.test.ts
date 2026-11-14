// Mini Golf's own rules: counting strokes, the stroke limit, water and the drop, holing out (and a
// ball too fast to drop), both ways of taking turns, the scorecard, ties, and the promise the
// whole kit rests on: stepping a recorded shot ends exactly where the engine stored it.
import { PHYSICS_VERSION, frames, simulate, start, step, result } from "@cardroom/physics";
import { mulberry32 } from "@spades/rules";
import { describe, expect, it } from "vitest";
import { AIM_SLIP, GameError, MAX_POWER, MIN_POWER, POWER_SLIP, backGarden, ballId, bestPutt, distanceToCup, miniGolf, newMiniGolf, nineHoles, nineTogether, quickThree, sameRest, scoreName, worldBefore, type MiniGolfMove, type MiniGolfRules, type MiniGolfState } from "../src/index.js";

const UP = 27000;
const shot = (seat: number, angle: number, power: number): MiniGolfMove => ({ type: "shot", body: ballId(seat), angle, power });
const play = (s: MiniGolfState, seat: number, angle: number, power: number) => miniGolf.apply(s, seat, shot(seat, angle, power));
const holeIndex = (id: string) => backGarden.holes.findIndex((h) => h.id === id);

/** A fresh table already standing on a later hole (tests may build the state they need). */
function onHole(id: string, seats = 1, rules: MiniGolfRules = nineHoles): MiniGolfState {
  let s = newMiniGolf({ ...rules, holes: 9 }, seats, 1);
  // Everyone picks up on each hole before it: the plain way to walk a table forward.
  while (s.hole < holeIndex(id)) {
    for (let seat = 0; seat < seats; seat++) while (!s.balls[seat]!.done) s = play(s, s.turn ?? seat, 0, MIN_POWER);
    for (let seat = 0; seat < seats; seat++) s = miniGolf.apply(s, seat, { type: "next" });
  }
  return s;
}
/** The putt that holes out from the tee of Welcome Mat. */
const ACE = [UP, 550] as const;

describe("strokes", () => {
  it("counts each putt, moves the ball to where it stopped, and says whose ball is where", () => {
    let s = newMiniGolf(nineHoles, 1, 1);
    const tee = backGarden.holes[0]!.tee;
    expect([s.balls[0]!.x, s.balls[0]!.y, s.balls[0]!.strokes]).toEqual([...tee, 0]);
    expect(miniGolf.view(s, 0).info).toEqual(["Hole 1 of 9", "Par 2", "Stroke 1 of 6"]);
    expect(miniGolf.view(s, 0).narration).toBe(backGarden.holes[0]!.tip);
    s = play(s, 0, UP, 300);
    const ball = s.balls[0]!;
    expect(ball.strokes).toBe(1);
    expect(ball.x).toBe(tee[0]);
    expect(ball.y).toBeLessThan(tee[1]);
    expect(ball.y).toBeGreaterThan(3200);
    const v = miniGolf.view(s, 0);
    expect(v.table.world.bodies).toEqual([{ id: "ball-0", x: ball.x, y: ball.y, r: 240 }]);
    expect(v.players[0]!.line).toBe("1 stroke");
    expect(v.info[2]).toBe("Stroke 2 of 6");
    expect(v.scores).toEqual([{ seats: [0], value: 1 }]);
    expect(v.narration).toBe("{0} putts");
    expect(v.last).toMatchObject({ n: 1, seat: 0, shot: { body: "ball-0", angle: UP, power: 300 }, from: [{ id: "ball-0", x: tee[0], y: tee[1], r: 240 }], rest: [{ id: "ball-0", x: ball.x, y: ball.y }], physics: PHYSICS_VERSION });
  });

  it("holes out when the ball drops, and names the score", () => {
    let s = newMiniGolf(nineHoles, 1, 1);
    s = play(s, 0, ...ACE);
    expect(s.balls[0]).toMatchObject({ done: "holed", strokes: 1, x: 5000, y: 3200 });
    expect(s.card[0]![0]).toBe(1);
    expect(s.phase).toBe("holed");
    expect(s.narration).toBe("{0} makes a hole in one!");
    const v = miniGolf.view(s, 0);
    expect(v.shoot).toBeNull();
    expect(v.table.world.bodies[0]).toMatchObject({ pocketed: "cup" });
    expect(v.last!.rest[0]).toMatchObject({ pocketed: "cup" });
    expect(v.players[0]).toMatchObject({ line: "In the cup in 1", done: true });
    expect([scoreName(1, 3), scoreName(2, 4), scoreName(2, 3), scoreName(3, 3), scoreName(4, 3), scoreName(5, 3), scoreName(7, 3)]).toEqual(["a hole in one", "an eagle", "a birdie", "par", "a bogey", "a double bogey", "7"]);
    // Two putts on a par two.
    let t = play(newMiniGolf(nineHoles, 1, 1), 0, UP, 300);
    const putt = bestPutt(backGarden.holes[0]!, t.balls[0]!.x, t.balls[0]!.y);
    t = play(t, 0, putt.angle, putt.power);
    expect(t.narration).toBe("{0} holes out in 2: par");
  });

  it("lets a ball that is going too fast skip over the cup", () => {
    const s = play(newMiniGolf(nineHoles, 1, 1), 0, UP, MAX_POWER);
    expect(s.balls[0]!.done).toBeNull();
    expect(s.narration).toBe("{0} runs it over the cup: too fast to drop");
    // The same line, gently, drops; and the physics said why the hard one didn't.
    const v = miniGolf.view(s, 0);
    const again = simulate(worldBefore(v)!, v.last!.shot);
    expect(again.events.some((e) => e.type === "skip")).toBe(true);
    expect(again.events.some((e) => e.type === "pocket")).toBe(false);
  });

  it("makes a player pick up at the stroke limit and write down one more", () => {
    let s = newMiniGolf({ ...nineHoles, limit: 4 }, 1, 1);
    for (let i = 0; i < 3; i++) s = play(s, 0, 0, MIN_POWER);
    expect(s.balls[0]).toMatchObject({ strokes: 3, done: null });
    s = play(s, 0, 0, MIN_POWER);
    expect(s.balls[0]).toMatchObject({ strokes: 4, done: "pickup" });
    expect(s.card[0]![0]).toBe(5);
    expect(s.narration).toBe("{0} picks up after 4 and writes down 5");
    expect(s.phase).toBe("holed");
    const v = miniGolf.view(s, 0);
    expect(v.players[0]!.line).toBe("Picked up: 5");
    expect(v.scores[0]!.value).toBe(5);
    // Its ball is off the green: nothing to strike.
    expect(v.table.world.bodies[0]!.pocketed).toBeDefined();
    expect(() => play(s, 0, 0, 500)).toThrow(GameError);
    // Holing out with the last stroke allowed still counts as that many.
    let t = newMiniGolf({ ...nineHoles, limit: 3 }, 1, 1);
    t = play(play(t, 0, 0, MIN_POWER), 0, 0, MIN_POWER);
    const putt = bestPutt(backGarden.holes[0]!, t.balls[0]!.x, t.balls[0]!.y);
    t = play(t, 0, putt.angle, putt.power);
    expect(t.balls[0]).toMatchObject({ strokes: 3, done: "holed" });
    expect(t.card[0]![0]).toBe(3);
  });
});

describe("water", () => {
  it("costs a penalty stroke and puts the ball back where it was struck from", () => {
    let s = onHole("koi-pond");
    const tee = backGarden.holes[holeIndex("koi-pond")]!.tee;
    s = play(s, 0, UP, 600);
    expect(s.balls[0]).toMatchObject({ x: tee[0], y: tee[1], strokes: 2, done: null, teed: true });
    expect(s.narration).toBe("{0} finds the water: back where it was, plus 1 stroke");
    const v = miniGolf.view(s, 0);
    // The shot ended in the pond; the table shows the ball dropped back on the tee.
    expect(v.last!.rest[0]!.out).toBe("water-1");
    expect(v.table.world.bodies[0]).toEqual({ id: "ball-0", x: tee[0], y: tee[1], r: 240 });
    // From further up the green, the drop is there and not on the tee.
    let t = play(onHole("koi-pond"), 0, 22500, 500);
    const lie = [t.balls[0]!.x, t.balls[0]!.y];
    expect(lie).not.toEqual(tee);
    const pond = { x: 5000, y: 8200 };
    const aim = Math.round((Math.atan2(pond.y - lie[1]!, pond.x - lie[0]!) * 18000) / Math.PI + 36000) % 36000;
    t = play(t, 0, aim, 500);
    expect(t.lasts[0]!.rest[0]!.out).toBe("water-1");
    expect([t.balls[0]!.x, t.balls[0]!.y, t.balls[0]!.strokes]).toEqual([...lie, 3]);
  });

  it("charges what the table's rules say: nothing, or two", () => {
    const free = play(onHole("koi-pond", 1, { ...nineHoles, penalty: 0 }), 0, UP, 600);
    expect(free.balls[0]!.strokes).toBe(1);
    expect(free.narration).toBe("{0} finds the water: back where it was");
    const dear = play(onHole("koi-pond", 1, { ...nineHoles, penalty: 2 }), 0, UP, 600);
    expect(dear.balls[0]!.strokes).toBe(3);
  });

  it("counts penalty strokes towards the limit", () => {
    let s = onHole("koi-pond", 1, { ...nineHoles, limit: 4 });
    s = play(play(s, 0, UP, 600), 0, UP, 600);
    expect(s.balls[0]).toMatchObject({ strokes: 4, done: "pickup" });
    expect(s.card[0]![holeIndex("koi-pond")]).toBe(5);
  });
});

describe("in turn", () => {
  it("has everyone tee off in order, then plays whoever is furthest from the cup", () => {
    let s = newMiniGolf(nineHoles, 3, 4);
    const first = s.first;
    expect(s.turn).toBe(first);
    expect(miniGolf.view(s, 0).players[first]!.badge).toBe("Tees off first");
    const order = [first, (first + 1) % 3, (first + 2) % 3];
    // Out of turn is refused.
    expect(() => play(s, order[1]!, UP, 300)).toThrow("It's not your shot.");
    // Three tee shots of different lengths: the middle seat goes furthest, the last one barely moves.
    s = play(s, order[0]!, UP, 300);
    expect(s.turn).toBe(order[1]);
    s = play(s, order[1]!, UP, 450);
    expect(s.turn).toBe(order[2]);
    s = play(s, order[2]!, UP, 100);
    const h = backGarden.holes[0]!;
    const far = order.map((seat) => distanceToCup(h, s.balls[seat]!.x, s.balls[seat]!.y));
    expect(far[2]).toBeGreaterThan(far[0]!);
    expect(far[0]).toBeGreaterThan(far[1]!);
    // Furthest plays: the short one, and again while it is still the furthest.
    expect(s.turn).toBe(order[2]);
    s = play(s, order[2]!, UP, 100);
    expect(s.turn).toBe(order[2]);
    // Every seat sees the same last shot, and only the seat whose turn it is may shoot.
    const views = [0, 1, 2].map((seat) => miniGolf.view(s, seat));
    expect(new Set(views.map((v) => v.last!.n)).size).toBe(1);
    expect(views.map((v) => !!v.shoot)).toEqual([0, 1, 2].map((seat) => seat === order[2]));
    expect(views[0]!.turn).toBe(order[2]);
  });

  it("skips a player who is in, and moves the honour round a seat for the next hole", () => {
    let s = newMiniGolf(nineHoles, 2, 4);
    const first = s.first;
    s = play(s, first, ...ACE);
    expect(s.turn).toBe(1 - first);
    expect(() => play(s, first, UP, 300)).toThrow("You've holed out");
    s = play(s, 1 - first, ...ACE);
    expect(s.phase).toBe("holed");
    expect(s.turn).toBeNull();
    // Both press "Next hole"; pressing twice is refused.
    s = miniGolf.apply(s, 0, { type: "next" });
    expect(() => miniGolf.apply(s, 0, { type: "next" })).toThrow(GameError);
    expect(s.hole).toBe(0);
    s = miniGolf.apply(s, 1, { type: "next" });
    expect([s.hole, s.phase, s.first, s.turn]).toEqual([1, "playing", 1 - first, 1 - first]);
    expect(s.lasts).toEqual([null, null]);
    expect(miniGolf.view(s, 0).last).toBeNull();
    expect(miniGolf.view(s, 0).table.key).not.toBe(miniGolf.view(newMiniGolf(nineHoles, 2, 4), 0).table.key);
  });

  it("draws the other balls as ghosts once they have left the tee: they are not in your world", () => {
    let s = newMiniGolf(nineHoles, 3, 4);
    const a = s.turn!;
    expect(miniGolf.view(s, a).table.ghosts).toEqual([]);
    s = play(s, a, UP, 300);
    const b = s.turn!;
    const v = miniGolf.view(s, b);
    expect(v.table.ghosts.map((g) => [g.id, g.owner, g.x, g.y])).toEqual([[ballId(a), a, s.balls[a]!.x, s.balls[a]!.y]]);
    expect(v.table.world.bodies.map((x) => x.id)).toEqual([ballId(b)]);
    // A second ball struck along the very same line passes straight through the first.
    const through = play(s, b, UP, 300);
    expect([through.balls[b]!.x, through.balls[b]!.y]).toEqual([s.balls[a]!.x, s.balls[a]!.y]);
  });
});

describe("everyone at once", () => {
  it("has no turns: anyone still playing may putt, and each seat watches its own shots", () => {
    let s = newMiniGolf(nineTogether, 3, 4);
    expect(s.turn).toBeNull();
    expect([0, 1, 2].map((seat) => !!miniGolf.view(s, seat).shoot)).toEqual([true, true, true]);
    s = play(s, 2, UP, 300);
    s = play(s, 2, UP, 200);
    s = play(s, 0, UP, 250);
    expect(s.balls.map((b) => b.strokes)).toEqual([1, 0, 2]);
    expect(miniGolf.view(s, 0).turn).toBeNull();
    expect(miniGolf.view(s, 0).last!.seat).toBe(0);
    expect(miniGolf.view(s, 2).last).toMatchObject({ seat: 2, shot: { power: 200 } });
    expect(miniGolf.view(s, 1).last).toBeNull();
    // Seat 1, still on the tee, sees the two balls that are out.
    expect(miniGolf.view(s, 1).table.ghosts.map((g) => g.owner)).toEqual([0, 2]);
  });

  it("moves on when the last player is in or has picked up", () => {
    let s = newMiniGolf({ ...nineTogether, limit: 3 }, 3, 4);
    s = play(s, 1, ...ACE);
    expect(miniGolf.view(s, 1).shoot).toBeNull();
    expect(() => play(s, 1, UP, 300)).toThrow(GameError);
    expect(s.phase).toBe("playing");
    s = play(s, 0, ...ACE);
    for (let i = 0; i < 2; i++) s = play(s, 2, 0, MIN_POWER);
    expect(s.phase).toBe("playing");
    s = play(s, 2, 0, MIN_POWER);
    expect(s.phase).toBe("holed");
    expect(s.card.map((c) => c[0])).toEqual([1, 1, 4]);
    const v = miniGolf.view(s, 2);
    expect(v.result).toMatchObject({ key: "hole-0", title: "Hole 1: Welcome Mat (par 2)", sides: [[0], [1], [2]] });
    expect(v.result!.rows).toEqual([
      { label: "This hole", values: ["1", "1", "4"], tone: "score" },
      { label: "Total", values: ["1", "1", "4"], tone: "total" },
      { label: "To par", values: ["−1", "−1", "+2"] },
    ]);
    expect(v.choices!.options.map((o) => o.label)).toEqual(["Next hole"]);
    // The computer players press on by themselves.
    expect(miniGolf.bot(s, 0, {})).toEqual({ type: "next" });
  });
});

describe("the card and the end of the round", () => {
  /** Two players through three holes: seat 0 aces the first and both pick up the rest. */
  function round(rules: MiniGolfRules, firstHole: [number, number][][]) {
    let s = newMiniGolf(rules, 2, 9);
    const drive = (seat: number, putts: [number, number][]) => {
      for (const [angle, power] of putts) s = play(s, seat, angle, power);
    };
    firstHole.forEach((putts, seat) => drive(seat, putts));
    while (s.phase !== "finished") {
      if (s.phase === "holed") s = miniGolf.apply(miniGolf.apply(s, 0, { type: "next" }), 1, { type: "next" });
      else for (const seat of [0, 1]) while (s.phase === "playing" && !s.balls[seat]!.done) s = play(s, seat, 0, MIN_POWER);
    }
    return s;
  }
  const quick = { ...quickThree, order: "together" as const, limit: 3 };

  it("keeps a scorecard: strokes on each hole, the hole in play, totals and how they stand against par", () => {
    let s = newMiniGolf(quick, 2, 9);
    s = play(s, 0, ...ACE);
    s = play(s, 1, UP, 300);
    const card = miniGolf.view(s, 1).card!;
    expect(card.title).toBe("The Back Garden");
    expect(card.columns).toEqual([{ label: "1", sub: "2" }, { label: "2", sub: "3" }, { label: "3", sub: "3" }]);
    expect(card.current).toBe(0);
    expect(card.rows).toEqual([
      { seat: 0, cells: ["1", "", ""], total: "1", note: "−1" },
      // Still out on the first: the strokes so far show, and par waits for the hole to finish.
      { seat: 1, cells: ["1", "", ""], total: "1", note: "Level" },
    ]);
    expect(miniGolf.summary(s)).toMatchObject({ game: "minigolf", over: false, hand: 1, scoreLine: "1 · 1", winners: null, order: null, seats: 2 });
  });

  it("gives the round to the lowest total", () => {
    const s = round(quick, [[[...ACE]], []]);
    expect(s.card).toEqual([[1, 4, 4], [4, 4, 4]]);
    const sum = miniGolf.summary(s);
    expect(sum).toMatchObject({ over: true, winners: [0], order: [0, 1], scoreLine: "9 · 12", hand: 3 });
    const v = miniGolf.view(s, 1);
    expect(v.over).toEqual({ winners: [0], title: "{0} wins with 9 (1 over par)!" });
    expect(v.result!.rows.at(-2)).toEqual({ label: "Total", values: ["9", "12"], tone: "total" });
    expect(v.result!.rows.at(-1)).toEqual({ label: "To par", values: ["+1", "+4"] });
    expect(v.card!.current).toBeNull();
    expect(v.shoot).toBeNull();
    expect(v.choices).toBeNull();
    expect(miniGolf.bot(s, 0, {})).toBeNull();
    expect(() => play(s, 0, UP, 300)).toThrow("This round is over.");
  });

  it("shares a tie", () => {
    const s = round(quick, [[[...ACE]], [[...ACE]]]);
    expect(miniGolf.summary(s).winners).toEqual([0, 1]);
    expect(miniGolf.view(s, 0).over).toEqual({ winners: [0, 1], title: "It's a tie at 9!" });
  });

  it("tells a player on their own how the round went", () => {
    let s = newMiniGolf({ ...quickThree, holes: 1 }, 1, 2);
    s = play(s, 0, ...ACE);
    expect(s.phase).toBe("finished");
    expect(miniGolf.view(s, 0).over).toEqual({ winners: [0], title: "Round finished: 1 stroke, 1 under par" });
    expect(miniGolf.summary(s).scoreLine).toBe("1 strokes");
  });
});

describe("determinism", () => {
  it("stepping a recorded shot frame by frame ends in exactly the state the engine stored", () => {
    // A table of shots that bank, climb, splash and drop, on several holes.
    const shots: [string, number, number][] = [["welcome-mat", UP, 550], ["welcome-mat", 30100, 1000], ["elbow", 26337, 730], ["off-the-fence", 31140, 780], ["ramp", UP, 480], ["sandbox", 28000, 900], ["koi-pond", UP, 700], ["molehill", 26500, 520], ["whole-yard", 24058, 830]];
    for (const [hole, angle, power] of shots) {
      const s = play(onHole(hole), 0, angle, power);
      const v = miniGolf.view(s, 0);
      const before = worldBefore(v)!;
      // The generator a canvas uses…
      const run = frames(before, v.last!.shot);
      let frame = run.next();
      let count = 0;
      let lastFrame = null;
      while (!frame.done) {
        lastFrame = frame.value;
        count++;
        frame = run.next();
      }
      expect(count).toBe(v.last!.ticks);
      expect(sameRest(frame.value.world, v.last!.rest), `${hole} ${angle}/${power}`).toBe(true);
      expect(lastFrame!.done).toBe(true);
      expect(lastFrame!.bodies.map((b) => [b.id, b.x, b.y])).toEqual(v.last!.rest.map((r) => [r.id, r.x, r.y]));
      // …and the start/step pair an animation loop uses, a few steps at a time as frames come.
      const loop = start(before, v.last!.shot);
      while (!loop.done) for (let i = 0; i < 3 && !loop.done; i++) step(loop);
      expect(sameRest(result(loop).world, v.last!.rest)).toBe(true);
      // What the table then shows is that rest with the rules applied: here, only water changes it.
      const at = v.last!.rest[0]!;
      if (at.out === undefined && at.pocketed === undefined) expect([s.balls[0]!.x, s.balls[0]!.y]).toEqual([at.x, at.y]);
    }
  });

  it("replays a whole logged round to the same state, as a restarted room does", () => {
    const dice = mulberry32(12);
    const log: { seat: number; move: MiniGolfMove }[] = [];
    let s = newMiniGolf(quickThree, 3, 77);
    while (s.phase !== "finished") {
      const seat = [0, 1, 2].find((i) => miniGolf.bot(s, i, { skill: 0.5 }, dice) !== null)!;
      const move = miniGolf.bot(s, seat, { skill: 0.5 }, dice)!;
      log.push({ seat, move });
      s = miniGolf.apply(s, seat, move);
    }
    let again = newMiniGolf(quickThree, 3, 77);
    for (const { seat, move } of log) again = miniGolf.apply(again, seat, JSON.parse(JSON.stringify(move)));
    expect(JSON.stringify(again)).toBe(JSON.stringify(s));
    expect(s.physics).toBe(PHYSICS_VERSION);
  });
});

describe("computer players", () => {
  it("find a putt with a bounded amount of thinking, and remember it", () => {
    for (const h of backGarden.holes) {
      const putt = bestPutt(h, h.tee[0], h.tee[1]);
      expect(putt.tried).toBeLessThanOrEqual(286);
      expect(bestPutt(h, h.tee[0], h.tee[1])).toBe(putt);
      expect(Number.isInteger(putt.angle) && Number.isInteger(putt.power)).toBe(true);
    }
  });

  it("hit it nearly as planned at full skill and all over the place at none", () => {
    const s = newMiniGolf(nineHoles, 1, 1);
    const ideal = bestPutt(backGarden.holes[0]!, 5000, 13500);
    const spread = (skill: number) => {
      const dice = mulberry32(3);
      const putts = Array.from({ length: 200 }, () => miniGolf.bot(s, 0, { skill, sloppy: 0 }, dice) as Extract<MiniGolfMove, { type: "shot" }>);
      return { aim: Math.max(...putts.map((p) => Math.abs(p.angle - ideal.angle))), power: Math.max(...putts.map((p) => Math.abs(p.power - ideal.power))) };
    };
    const sharp = spread(1);
    const wild = spread(0);
    expect(sharp.aim).toBeLessThanOrEqual(AIM_SLIP[0]);
    expect(sharp.power).toBeLessThanOrEqual(Math.ceil(ideal.power * POWER_SLIP[0]));
    expect(wild.aim).toBeGreaterThan(sharp.aim * 2);
    // A careless moment is twice the usual slip.
    expect(wild.aim).toBeLessThanOrEqual((AIM_SLIP[0] + AIM_SLIP[1]) * 2);
    expect(wild.power).toBeGreaterThan(sharp.power * 2);
    // Whatever the dice, a computer player's putt is one the table accepts.
    const dice = mulberry32(8);
    for (let i = 0; i < 300; i++) expect(() => miniGolf.apply(s, 0, miniGolf.bot(s, 0, { skill: 0, sloppy: 1 }, dice)!)).not.toThrow();
  });

  it("only move when they owe one", () => {
    let s = newMiniGolf(nineHoles, 2, 4);
    expect(miniGolf.bot(s, 1 - s.turn!, {})).toBeNull();
    expect(miniGolf.bot(s, s.turn!, {})).toMatchObject({ type: "shot", body: ballId(s.turn!) });
    s = newMiniGolf(nineTogether, 2, 4);
    expect([miniGolf.bot(s, 0, {}), miniGolf.bot(s, 1, {})].every((m) => m?.type === "shot")).toBe(true);
    // Thinking time covers the putt before it rolling to a stop.
    const t0 = miniGolf.thinkingTime(newMiniGolf(nineHoles, 2, 4), 0);
    const after = play(newMiniGolf(nineHoles, 2, 4), newMiniGolf(nineHoles, 2, 4).turn!, UP, 900);
    expect(miniGolf.thinkingTime(after, after.turn!)).toBeGreaterThan(t0 + 1000);
  });
});
