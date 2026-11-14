// One table for every game on the table-sports kit, as KitTable is for the card games and
// BoardTable for the board games. The engine's view says everything: the physics world and how
// to draw it, whose shot it is, what this seat may strike, and the last shot taken. This draws it
// on a canvas fitted to the screen, lets you aim, and plays each shot.
//
// Aiming is a slingshot: press anywhere on the table, pull back, let go. The ball goes the
// opposite way to the pull, harder the further you pulled; pull back to where you started (or
// press Escape) to call it off. It doesn't matter where the thumb goes down, so the ball is never
// under it. The same aim can be set with the arrow keys or the buttons under the table, and it is
// read out as it changes. However it was aimed, what is sent is a whole-number angle and power:
// the pointer maths is free to be approximate because the shot isn't.
//
// A shot is played by stepping the same simulation the server ran (see roll.ts), with sounds from
// its events as they happen. While it rolls, the scores, the story and the sheets stay as they
// were: nobody is told the putt dropped before they have watched it drop. When it stops the
// screen shows the server's table, and a check confirms that is where the roll ended.
import { angleTo, kitGame, UNITS_PER_METRE, type SportBody, type SportCard, type SportView } from "@cardroom/games";
import { type TableSettings } from "@spades/rules";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bubble, TableChat, useBubbles, type ChatProps } from "../Chat";
import { Confetti } from "../Confetti";
import { loadFeedbackSettings, play, saveFeedbackSettings } from "../feedback/sounds";
import { named, ResultTable, sideName } from "../kit/KitTable";
import { reducedMotion } from "../motion";
import { TableSettingsButton } from "../TableSettings";
import { drawScene, fitFrame, powerColour, toneColour, type Aim, type Disc, type Fit, type Scene } from "./draw";
import { advanceRoll, beginRoll, finishRoll, landed, type Roll } from "./roll";

export interface SportTableProps {
  view: SportView;
  names: string[];
  /** Resolves to an error message when the move is refused. */
  act: (move: Record<string, unknown>) => Promise<string | null>;
  onLeave: () => void;
  banner?: React.ReactNode;
  chat?: ChatProps;
  settings?: {
    value: TableSettings;
    change: (next: TableSettings) => Promise<void> | void;
  };
}

/** An aim, in the numbers that are sent: hundredths of a degree and a power within the view's range. */
interface AimAt {
  angle: number;
  power: number;
}
/** A finger down on the table, pulling. */
interface Pull {
  pointer: number;
  x: number;
  y: number;
  /** The aim before the pull began, to go back to if it is called off. */
  before: AimAt;
  cancel: boolean;
}

/** A pull shorter than this (CSS pixels) is no pull: letting go there does nothing. */
const CANCEL_ZONE = 16;
const wrap = (angle: number) => ((Math.round(angle) % 36000) + 36000) % 36000;
const GHOST_MS = 320;

/** The body a view lets you strike, where it lies. */
const strikable = (v: SportView) => (v.shoot ? (v.table.world.bodies.find((b) => b.id === v.shoot!.body) ?? null) : null);

/** The nearest pocket to a point: what "straight at the cup" means. */
function nearestPocket(v: SportView, from: { x: number; y: number }) {
  let best: { x: number; y: number } | null = null;
  let least = Infinity;
  for (const p of v.table.world.pockets) {
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < least) [best, least] = [p, d];
  }
  return best ? { ...best, far: least } : null;
}

const metres = (units: number) => {
  const m = units / UNITS_PER_METRE;
  return m < 1 ? `${Math.round(m * 100)} centimetres` : `${m.toFixed(1)} metres`;
};

/** An aim in words, for a screen reader and the line under the table: where it points relative to the hole, and how hard. */
function aimWords(v: SportView, aim: AimAt): { short: string; long: string } {
  const ball = strikable(v);
  const shoot = v.shoot;
  if (!ball || !shoot) return { short: "", long: "" };
  const hole = v.table.look.pockets === "cup" ? "the cup" : "the nearest pocket";
  const pocket = nearestPocket(v, ball);
  const percent = Math.round((aim.power / 1000) * 100);
  if (!pocket) return { short: `${(aim.angle / 100).toFixed(1)}° · ${percent}%`, long: `Aim ${(aim.angle / 100).toFixed(1)} degrees, power ${percent} percent.` };
  // Left and right as the player sees them, looking along the aim.
  const off = ((aim.angle - angleTo(ball, pocket) + 54000) % 36000) - 18000;
  const by = Math.abs(off) / 100;
  const where = Math.abs(off) < 5 ? `Straight at ${hole}` : `${by < 10 ? by.toFixed(1) : Math.round(by)}° ${off < 0 ? "left" : "right"} of ${hole}`;
  return { short: `${where} · ${percent}%`, long: `${where.replace("°", " degrees")}, power ${percent} percent. ${hole[0]!.toUpperCase()}${hole.slice(1)} is ${metres(pocket.far)} away.` };
}

export function SportTable({ view, names, act, onLeave, banner, chat, settings }: SportTableProps) {
  const game = kitGame(view.game)!;
  const me = view.me;
  const pace = settings?.value.pace;

  // ---- What is on screen ------------------------------------------------------------------------
  // `shown` is the view the screen presents: the latest one, except while a shot is rolling,
  // when it stays the view from before the shot until the ball has stopped.
  const [shown, setShownState] = useState(view);
  const [rolling, setRolling] = useState(false);
  const shownRef = useRef(view);
  const roll = useRef<Roll | null>(null);
  /** Views that arrived while a shot was rolling, oldest first. */
  const waiting = useRef<SportView[]>([]);
  /** The number of the last shot already played or shown. */
  const seen = useRef(view.last?.n ?? 0);
  /** Other players' balls sliding to where they now lie: where each came from and when it set off. */
  const slides = useRef(new Map<string, { x: number; y: number; at: number }>());
  const paceRef = useRef(pace);
  paceRef.current = pace;

  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [soundOn, setSoundOn] = useState(() => loadFeedbackSettings().sound);
  const [cardOpen, setCardOpen] = useState(false);
  const bubbles = useBubbles(chat?.messages ?? []);

  // ---- The aim ----------------------------------------------------------------------------------
  const [aim, setAimState] = useState<AimAt>({ angle: 27000, power: 400 });
  const aimRef = useRef(aim);
  const pull = useRef<Pull | null>(null);
  const [pulling, setPulling] = useState(false);
  const setAim = (next: AimAt) => {
    aimRef.current = next;
    setAimState(next);
  };

  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef({ w: 0, h: 0, dpr: 1 });
  const fit = useRef<Fit>({ scale: 1, ox: 0, oy: 0 });
  const frame = useRef(0);
  const lastFrame = useRef(0);
  const sendingRef = useRef(false);

  const canShoot = !!shown.shoot && !rolling && !sending && !shown.over;
  const canShootRef = useRef(canShoot);
  canShootRef.current = canShoot;

  // ---- Drawing ----------------------------------------------------------------------------------
  const paint = useCallback((now: number) => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    const { w, h, dpr } = box.current;
    if (!el || !ctx || w === 0 || h === 0) return;
    const r = roll.current;
    const v = shownRef.current;
    const table = r ? r.target.table : v.table;
    fit.current = fitFrame(table.look.frame, w, h);
    const looks = new Map<string, SportBody>(table.bodies.map((b) => [b.id, b]));
    // What lies still: the bodies and ghosts of the view on screen (of the shot's own table, if
    // the shot is on a different one), except whatever the roll is moving.
    const still = r && v.table.key !== r.target.table.key ? r.target : v;
    const discs: Disc[] = [];
    for (const b of still.table.world.bodies) {
      if (r?.at.has(b.id) || b.pocketed !== undefined || b.out !== undefined) continue;
      discs.push({ id: b.id, x: b.x, y: b.y, r: b.r, look: looks.get(b.id), mine: canShootRef.current && b.id === v.shoot?.body });
    }
    for (const g of still.table.ghosts) {
      if (r?.at.has(g.id)) continue;
      const slide = slides.current.get(g.id);
      const t = slide ? Math.min(1, (now - slide.at) / GHOST_MS) : 1;
      if (slide && t >= 1) slides.current.delete(g.id);
      const ease = 1 - (1 - t) * (1 - t);
      discs.push({ id: g.id, x: slide ? slide.x + (g.x - slide.x) * ease : g.x, y: slide ? slide.y + (g.y - slide.y) * ease : g.y, r: g.r, look: g, ghost: true });
    }
    const splashes: Scene["splashes"] = [];
    if (r) {
      for (const [id, at] of r.at) {
        const dropped = r.sunk.get(id);
        if (!at.live && dropped === undefined) continue;
        discs.push({ id, x: at.x, y: at.y, r: at.r, look: looks.get(id), sunk: dropped === undefined ? 0 : Math.min(1, (r.clock - dropped) / 220) });
      }
      for (const s of r.splashes) if (r.clock - s.at < 600) splashes.push({ x: s.x, y: s.y, t: (r.clock - s.at) / 600 });
    }
    let aiming: Aim | null = null;
    const ball = strikable(v);
    if (canShootRef.current && ball && v.shoot) {
      const a = aimRef.current;
      aiming = { x: ball.x, y: ball.y, r: ball.r, angle: (a.angle * Math.PI) / 18000, power: a.power / 1000, pulling: !!pull.current, cancel: !!pull.current?.cancel };
    }
    drawScene(ctx, w, h, dpr, fit.current, { table, discs, aim: aiming, trace: r?.jump && r.rested !== null ? r.trace : null, splashes });
  }, []);

  /** Draw now, and keep drawing while anything is moving. */
  const wake = useCallback(() => {
    if (frame.current) return;
    lastFrame.current = performance.now();
    const loop = (now: number) => {
      frame.current = 0;
      // A tab that was hidden comes back with one huge gap: treat it as a tenth of a second.
      const ms = Math.min(100, Math.max(0, now - lastFrame.current));
      lastFrame.current = now;
      const r = roll.current;
      if (r) {
        // Catching up on shots that arrived while this one rolled: play faster the further behind.
        const behind = waiting.current.filter((v) => v.last && v.last.n > r.record.n).length;
        const speed = (paceRef.current === "fast" ? 1.5 : 1) * (behind >= 3 ? 4 : behind >= 1 ? 2 : 1);
        hear(advanceRoll(r, ms, speed));
        if (r.over) settle();
      }
      paint(now);
      if (roll.current || slides.current.size) frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
  }, [paint]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // ---- Sounds, from what the simulation says happened -------------------------------------------
  const lastKnock = useRef(0);
  function hear(events: ReturnType<typeof advanceRoll>) {
    for (const e of events) {
      if (e.type === "pocket") play("cup");
      else if (e.type === "out") play(shownRef.current.table.look.regions.some((g) => g.id === e.region && g.surface === "water") ? "splash" : "nope");
      else if (e.type === "skip") play("knock");
      else if ((e.type === "wall" || e.type === "hit") && e.speed > 500) {
        // A ball rattling in a corner is one knock, not a drum roll.
        const now = performance.now();
        if (now - lastKnock.current > 70) play("knock");
        lastKnock.current = now;
      }
    }
  }

  // ---- Shots, one after another -----------------------------------------------------------------
  function show(v: SportView) {
    const before = shownRef.current;
    // The other players' balls slide to where they are now; on a new table they are simply there.
    slides.current.clear();
    if (before.table.key === v.table.key && !reducedMotion()) {
      const was = new Map(before.table.ghosts.map((g) => [g.id, g]));
      const at = performance.now();
      for (const g of v.table.ghosts) {
        const from = was.get(g.id);
        if (from && (from.x !== g.x || from.y !== g.y) && roll.current?.record.shot.body !== g.id) slides.current.set(g.id, { x: from.x, y: from.y, at });
      }
    }
    shownRef.current = v;
    seen.current = v.last?.n ?? 0;
    setShownState(v);
  }

  function begin(v: SportView) {
    // The roll itself isn't shown to someone who asked for less motion, or at the instant pace:
    // they get where it went, with the path drawn for a moment.
    roll.current = beginRoll(v, reducedMotion() || paceRef.current === "instant");
    seen.current = v.last!.n;
    setRolling(true);
    play("putt");
    wake();
  }

  /** A view to deal with: play its shot if it has a new one, else just show it. */
  function take(v: SportView) {
    if (v.last && v.last.n > seen.current) begin(v);
    else show(v);
  }

  /** The roll is over: check it, show the table it led to, and go on to whatever arrived meanwhile. */
  function settle() {
    const r = roll.current;
    if (!r) return;
    if (!landed(r)) {
      // This should never happen: the physics core is deterministic by construction. If it does,
      // the screen is put right by showing the server's table below; say so where a developer will see.
      console.warn(`Card Room: shot ${r.record.n} rolled to a different place here than on the server. Showing the server's table.`, { shot: r.record.shot, server: r.record.rest, here: [...r.at] });
      if (import.meta.env.DEV) console.assert(false, "a locally stepped shot must end exactly where the server's did");
    }
    show(r.target);
    roll.current = null;
    while (waiting.current.length) {
      const next = waiting.current.shift()!;
      if (next.last && next.last.n > seen.current) return begin(next);
      show(next);
    }
    setRolling(false);
  }

  /** Stop watching: the rest of this roll, and any that are queued, happen at once. */
  function skip() {
    const r = roll.current;
    if (!r) return;
    const events = finishRoll(r);
    hear(events.filter((e) => e.type === "pocket" || e.type === "out"));
    r.hold = 0;
    r.over = true;
    const latest = waiting.current.pop();
    waiting.current = [];
    settle();
    if (latest) show(latest);
    wake();
  }

  useEffect(() => {
    if (view === shownRef.current) return;
    if (roll.current) {
      waiting.current.push(view);
      // Far behind (a phone that slept through several putts): drop the oldest and catch up.
      if (waiting.current.length > 6) waiting.current.splice(0, waiting.current.length - 6);
      return;
    }
    take(view);
    wake();
  }, [view]);

  // ---- The canvas follows its box ---------------------------------------------------------------
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      box.current = { w, h, dpr };
      const c = canvas.current;
      if (c && (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr))) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      paint(performance.now());
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [paint]);
  // Anything React knows changed is drawn straight away; motion is drawn by the loop.
  useEffect(() => {
    paint(performance.now());
    if (slides.current.size) wake();
  });

  // ---- Aiming -----------------------------------------------------------------------------------
  // A fresh shot starts aimed at the hole, which is where most putts go.
  const ball = strikable(shown);
  const ballKey = shown.shoot && ball ? `${shown.table.key}/${ball.id}/${ball.x}/${ball.y}` : "";
  useEffect(() => {
    if (!ball || !shown.shoot) return;
    const pocket = nearestPocket(shown, ball);
    setAim({ angle: pocket ? angleTo(ball, pocket) : 27000, power: Math.min(shown.shoot.maxPower, Math.max(shown.shoot.minPower, 400)) });
  }, [ballKey]);

  const clampPower = (power: number) => (shown.shoot ? Math.min(shown.shoot.maxPower, Math.max(shown.shoot.minPower, Math.round(power))) : power);
  const turn = (by: number) => canShoot && setAim({ ...aimRef.current, angle: wrap(aimRef.current.angle + by) });
  const push = (by: number) => canShoot && setAim({ ...aimRef.current, power: clampPower(aimRef.current.power + by) });

  async function shoot() {
    const v = shownRef.current;
    if (!canShootRef.current || !v.shoot || sendingRef.current) return;
    const a = aimRef.current;
    sendingRef.current = true;
    setSending(true);
    // Whole numbers, whatever the pointer maths made of them.
    const refused = await act({ type: "shot", body: v.shoot.body, angle: wrap(a.angle), power: clampPower(a.power) });
    sendingRef.current = false;
    setSending(false);
    if (refused) {
      setError(refused);
      play("nope");
    }
  }

  /** How long a pull is full power: most of the way across a phone, and no more on a big screen. */
  const fullPull = () => Math.min(230, Math.max(110, Math.min(box.current.w, box.current.h) * 0.42));

  function onPointerDown(e: React.PointerEvent) {
    if (!canShoot || !shown.shoot || (e.pointerType === "mouse" && e.button !== 0)) return;
    // A second finger calls the pull off.
    if (pull.current) return cancelPull();
    pull.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, before: aimRef.current, cancel: true };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* a pointer that can't be captured still sends its moves while it is over the table */
    }
    setPulling(true);
    e.preventDefault();
  }
  function onPointerMove(e: React.PointerEvent) {
    const p = pull.current;
    if (!p || p.pointer !== e.pointerId || !shown.shoot) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    const far = Math.hypot(dx, dy);
    p.cancel = far < CANCEL_ZONE;
    if (p.cancel) return setAim(p.before);
    // The ball goes the opposite way to the pull. Any maths will do here: what is kept is rounded.
    const angle = wrap((Math.atan2(-dy, -dx) * 18000) / Math.PI);
    const share = Math.min(1, (far - CANCEL_ZONE) / (fullPull() - CANCEL_ZONE));
    setAim({ angle, power: clampPower(shown.shoot.minPower + share * (shown.shoot.maxPower - shown.shoot.minPower)) });
  }
  function onPointerUp(e: React.PointerEvent) {
    const p = pull.current;
    if (!p || p.pointer !== e.pointerId) return;
    pull.current = null;
    setPulling(false);
    if (p.cancel) return setAim(p.before);
    void shoot();
  }
  function cancelPull() {
    const p = pull.current;
    if (!p) return;
    pull.current = null;
    setPulling(false);
    setAim(p.before);
  }
  // The shot went, or the turn passed, with a finger still down: let go of it.
  useEffect(() => {
    if (!canShoot) cancelPull();
  }, [canShoot]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (pull.current) cancelPull();
      else if (cardOpen) setCardOpen(false);
      return;
    }
    if (!canShoot || e.target !== e.currentTarget) return;
    const fine = e.altKey ? 10 : e.shiftKey ? 500 : 100;
    const step = e.shiftKey ? 100 : 20;
    if (e.key === "ArrowLeft") turn(-fine);
    else if (e.key === "ArrowRight") turn(fine);
    else if (e.key === "ArrowUp") push(step);
    else if (e.key === "ArrowDown") push(-step);
    else if (e.key === "Home" && ball) {
      const pocket = nearestPocket(shown, ball);
      if (pocket) setAim({ ...aimRef.current, angle: angleTo(ball, pocket) });
    } else if (e.key === "Enter" || e.key === " ") void shoot();
    else return;
    e.preventDefault();
  }

  // What the aim is, said aloud a moment after it stops changing.
  const words = canShoot ? aimWords(shown, aim) : { short: "", long: "" };
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSpoken(words.long), 450);
    return () => clearTimeout(t);
  }, [words.long]);

  // ---- The rest of the table --------------------------------------------------------------------
  const others = Array.from({ length: shown.seats - 1 }, (_, i) => (me + 1 + i) % shown.seats);
  const tie = !!shown.over && shown.over.winners.length === shown.seats && shown.seats > 1;
  const won = !!shown.over && !tie && shown.seats > 1 && shown.over.winners.includes(me);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(t);
  }, [error]);
  const turnSeen = useRef(false);
  useEffect(() => {
    // Alone on the course it is always your shot: no need to say so every time.
    if (canShoot && !turnSeen.current && shown.seats > 1 && shown.turn !== null) play("yourTurn");
    turnSeen.current = canShoot;
  }, [canShoot]);
  const overSeen = useRef(!!shown.over);
  useEffect(() => {
    if (shown.over && !overSeen.current) play(tie || shown.seats === 1 ? "handDone" : won ? "won" : "lost");
    overSeen.current = !!shown.over;
  }, [shown.over]);
  const resultSeen = useRef(shown.result?.key ?? null);
  useEffect(() => {
    if (shown.result && !shown.over && resultSeen.current !== shown.result.key) play("handDone");
    resultSeen.current = shown.result?.key ?? null;
  }, [shown.result?.key]);

  const send = async (move: Record<string, unknown>) => {
    const refused = await act(move);
    if (refused) {
      setError(refused);
      play("nope");
    }
  };
  function toggleSound() {
    const next = { ...loadFeedbackSettings(), sound: !soundOn };
    saveFeedbackSettings(next);
    setSoundOn(next.sound);
  }

  const shooter = rolling && roll.current ? roll.current.record.seat : null;
  const status = error ? (
    <span className="error">{error}</span>
  ) : shooter !== null ? (
    shooter === me ? "There it goes…" : `${names[shooter] ?? "Someone"} putts…`
  ) : shown.over || shown.result ? null : canShoot ? (
    <span className="mine">{shown.seats > 1 ? "Your shot" : "Pull back and let go"}</span>
  ) : sending ? (
    "…"
  ) : shown.turn !== null ? (
    `${names[shown.turn] ?? "Someone"} is lining it up…`
  ) : shown.players[me]?.done ? (
    "You're in. Waiting for the others…"
  ) : (
    "Waiting for everyone…"
  );

  const mine = strikable(shown) ?? shown.table.world.bodies[0];
  const pocket = mine && mine.pocketed === undefined ? nearestPocket(shown, mine) : null;
  const picture = `${shown.table.name}. ${shown.info.join(". ")}.${pocket ? ` Your ball is ${metres(pocket.far)} from ${shown.table.look.pockets === "cup" ? "the cup" : "the nearest pocket"}.` : ""}`;
  const percent = Math.round(aim.power / 10);

  return (
    <main className={`table kit sport sport-${shown.game}`} onKeyDown={(e) => e.key === "Escape" && onKeyDown(e)}>
      <header className="palace-bar kit-bar">
        <button type="button" className="leave" aria-label="Leave game" onClick={() => (shown.over || confirm("Leave this game?")) && onLeave()}>
          ←
        </button>
        <div className="kit-scores" aria-label="Scores">
          {shown.scores.map((s, i) => (
            <span key={i} className={`kit-score${s.seats.includes(me) ? " us" : ""}`}>
              <small>{sideName(s.seats, names)}</small>
              <strong>{s.value}</strong>
            </span>
          ))}
        </div>
        <span className="bar-buttons">
          {shown.card && (
            <button type="button" className="sound-toggle inline" onClick={() => setCardOpen(true)} aria-label="Scorecard" aria-haspopup="dialog">
              📋
            </button>
          )}
          {settings && <TableSettingsButton settings={settings.value} onChange={settings.change} />}
          <button type="button" className="sound-toggle inline" onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? "Turn sounds off" : "Turn sounds on"}>
            {soundOn ? "🔊" : "🔇"}
          </button>
        </span>
      </header>
      {banner}

      <div className="felt sport-felt">
        <div className="sport-top">
          <h2 className="sport-name">{shown.table.name}</h2>
          {shown.info.length > 0 && (
            <ul className="kit-info">
              {shown.info.slice(1).map((line, i) => (
                <li key={i}>{named(line, names)}</li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <div className="sport-others">
              {others.map((seat) => (
                <div key={seat} className="opp top" data-seat={seat}>
                  <SportSeat view={shown} seat={seat} name={names[seat] ?? `Seat ${seat + 1}`} active={shooter === seat || (shooter === null && shown.turn === seat)} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          ref={stage}
          className={`sport-stage${canShoot ? " can" : ""}${pulling ? " pulling" : ""}`}
          tabIndex={0}
          role="group"
          aria-label={`${picture}${canShoot ? " Arrow keys aim, up and down set the power, Enter putts." : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelPull}
          onKeyDown={onKeyDown}
        >
          <canvas ref={canvas} aria-hidden />
          {pulling && (
            <div className="sport-meter" aria-hidden>
              <span style={{ height: `${percent}%`, background: powerColour(aim.power / 1000) }} />
            </div>
          )}
          {rolling && (
            <button type="button" className="sport-skip" onClick={skip} onPointerDown={(e) => e.stopPropagation()}>
              Skip ⏭
            </button>
          )}
        </div>

        <div className="center-info">
          <p className="narration" aria-live="polite">
            {shown.narration ? named(shown.narration, names) : null}
          </p>
          <div className="status" role="status">
            {status}
          </div>
          {/* Kept in place (hidden) while a shot rolls or someone else plays, so the table doesn't change size between shots. */}
          {!shown.over && !shown.result && !shown.players[me]?.done && (
            <div className={`sport-controls${canShoot ? "" : " idle"}`} role="group" aria-label="Aim and power" aria-hidden={!canShoot} inert={!canShoot}>
              <div className="sport-row">
                <button type="button" aria-label="Aim 5 degrees left" onClick={() => turn(-500)}>
                  ⟲
                </button>
                <button type="button" aria-label="Aim half a degree left" onClick={() => turn(-50)}>
                  ‹
                </button>
                <output className="sport-aim">{pulling && pull.current?.cancel ? "Let go to cancel" : words.short}</output>
                <button type="button" aria-label="Aim half a degree right" onClick={() => turn(50)}>
                  ›
                </button>
                <button type="button" aria-label="Aim 5 degrees right" onClick={() => turn(500)}>
                  ⟳
                </button>
              </div>
              <div className="sport-row">
                <button type="button" aria-label="Less power" onClick={() => push(-20)}>
                  −
                </button>
                <input
                  type="range"
                  aria-label="Power"
                  aria-valuetext={`${percent} percent`}
                  min={shown.shoot?.minPower ?? 0}
                  max={shown.shoot?.maxPower ?? 1000}
                  step={10}
                  value={aim.power}
                  style={{ accentColor: powerColour(aim.power / 1000) }}
                  onChange={(e) => setAim({ ...aimRef.current, power: clampPower(Number(e.target.value)) })}
                />
                <button type="button" aria-label="More power" onClick={() => push(20)}>
                  +
                </button>
                <button type="button" className="primary sport-go" onClick={() => void shoot()}>
                  Putt
                </button>
              </div>
            </div>
          )}
          <p className="sr-only" aria-live="polite">
            {spoken}
          </p>
        </div>
      </div>

      <section className="me" data-seat={me}>
        {chat && <TableChat {...chat} />}
        <div className="me-badge">
          <SportSeat view={shown} seat={me} name={names[me] ?? "You"} active={shooter === me || (shooter === null && shown.turn === me)} row />
        </div>
      </section>

      <div className="bubble-layer" aria-live="polite">
        {[...bubbles.entries()].map(([s, m]) => (
          <Bubble key={`${s}-${m.at}`} message={m} seat={s} />
        ))}
      </div>

      {cardOpen && shown.card && (
        <>
          <div className="sheet-backdrop" onClick={() => setCardOpen(false)} />
          <div className="sheet sport-card-sheet" role="dialog" aria-label="Scorecard">
            <Scorecard card={shown.card} names={names} me={me} />
            <button type="button" className="primary" autoFocus onClick={() => setCardOpen(false)}>
              Back to the game
            </button>
          </div>
        </>
      )}
      {shown.result && !shown.over && (
        <div className="sheet sport-sheet">
          <ResultTable result={shown.result} names={names} me={me} />
          {shown.choices ? (
            shown.choices.options.map((o, i) => (
              <button key={i} type="button" className={o.primary ? "primary" : "secondary"} onClick={() => void send(o.move)}>
                {named(o.label, names)}
              </button>
            ))
          ) : (
            <p className="fine">Waiting for everyone…</p>
          )}
        </div>
      )}
      {won && <Confetti />}
      {shown.over && (
        <div className="sheet won-sheet sport-sheet sport-over">
          <h2>{won ? "You won! 🏆" : named(shown.over.title, names)}</h2>
          {won && !shown.over.title.includes(`{${me}}`) && <p className="won-line">{named(shown.over.title, names)}</p>}
          {shown.card ? <Scorecard card={shown.card} names={names} me={me} /> : shown.result && <ResultTable result={shown.result} names={names} me={me} untitled />}
          <button type="button" className="primary" onClick={onLeave}>
            Play again
          </button>
        </div>
      )}
      <p className="sr-only">{game.name}</p>
    </main>
  );
}

/** A player at the table: their ball's colour, name, how they stand on this hole, and whether it's their shot. */
function SportSeat({ view, seat, name, active, row }: { view: SportView; seat: number; name: string; active: boolean; row?: boolean }) {
  const p = view.players[seat]!;
  const on = active && !view.over;
  return (
    <div className={`kit-seat sport-seat${on ? " active" : ""}${p.done ? " done" : ""}${row ? " row" : ""}`} aria-current={on ? "true" : undefined}>
      <strong>
        {p.body && <span className="sport-dot" style={{ background: toneColour(p.body.tone) }} aria-hidden />}
        {name}
        {p.body && <span className="sr-only"> plays the {p.body.tone} ball</span>}
      </strong>
      {p.line && <span>{named(p.line, [])}</span>}
      {p.badge && <em>{p.badge}</em>}
    </div>
  );
}

/** The score sheet: a column per hole with its par, a row per player, the totals at the end. */
function Scorecard({ card, names, me }: { card: SportCard; names: string[]; me: number }) {
  return (
    <div className="sport-card">
      <table className="summary">
        <caption>{card.title}</caption>
        <thead>
          <tr>
            <th scope="col">Hole</th>
            {card.columns.map((c, i) => (
              <th key={i} scope="col" className={card.current === i ? "now" : ""} aria-current={card.current === i ? "true" : undefined}>
                {c.label}
              </th>
            ))}
            <th scope="col">{card.totalLabel}</th>
            {card.noteLabel && <th scope="col">{card.noteLabel}</th>}
          </tr>
          {card.columns.some((c) => c.sub) && (
            <tr className="par">
              <th scope="row">Par</th>
              {card.columns.map((c, i) => (
                <td key={i}>{c.sub}</td>
              ))}
              <td>{card.columns.reduce((n, c) => n + (Number(c.sub) || 0), 0) || ""}</td>
              {card.noteLabel && <td />}
            </tr>
          )}
        </thead>
        <tbody>
          {card.rows.map((r) => (
            <tr key={r.seat} className={r.seat === me ? "mine" : ""}>
              <th scope="row">{names[r.seat] ?? `Seat ${r.seat + 1}`}</th>
              {r.cells.map((c, i) => (
                <td key={i} className={card.current === i ? "now" : ""}>
                  {c}
                </td>
              ))}
              <td className="sum">{r.total}</td>
              {card.noteLabel && <td>{r.note}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
