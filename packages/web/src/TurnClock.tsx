// The countdown at an online table: the room publishes a deadline (whose clock, and when it runs out
// by the server's clock), and this shows the time left on that player's seat.
//
// It's drawn over the table rather than inside it: Spades, Palace and the kit's games each draw their
// seats their own way, but all of them mark a seat with data-seat, so one clock finds the seat and
// sits on its corner, and no table has to know about timers.
import type { DeadlineDoc } from "@spades/rooms/client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { play } from "./feedback/sounds";
import { reducedMotion } from "./motion";

/** When to nudge the player whose time is nearly gone, and when the clock turns red. */
const WARN_MS = 5_000;
const LOW_MS = 10_000;

/** "0:09", "1:30", "14m", "23h": short enough for a seat's corner. */
export function clockText(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  return `${Math.ceil(s / 3600)}h`;
}

/** The same, for a screen reader. */
export function clockWords(ms: number): string {
  const s = Math.ceil(ms / 1000);
  const say = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (s < 60) return say(s, "second");
  if (s < 3600) return say(Math.ceil(s / 60), "minute");
  return say(Math.ceil(s / 3600), "hour");
}

/**
 * The time left on a deadline, by the server's clock (`now`), ticking: four times a second in the
 * last minute, once a second before that. Null when no clock is running.
 */
export function useTimeLeft(deadline: DeadlineDoc | null | undefined, now: () => number): number | null {
  const at = deadline?.at ?? null;
  const [left, setLeft] = useState<number | null>(at === null ? null : Math.max(0, at - now()));
  useEffect(() => {
    if (at === null) return setLeft(null);
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const ms = Math.max(0, at - now());
      setLeft(ms);
      if (ms > 0) timer = setTimeout(tick, ms <= 60_000 ? 250 : 1000);
    };
    tick();
    return () => clearTimeout(timer);
  }, [at, now]);
  return left;
}

/** Where a seat is on the page: your own badge if the table has one, else whatever carries data-seat. */
function seatBox(seat: number, mine: boolean): DOMRect | null {
  const el = (mine ? document.querySelector(".table .me-badge > *") : null) ?? document.querySelector(`.table [data-seat="${seat}"]`);
  const box = el?.getBoundingClientRect();
  return box && box.width > 0 ? box : null;
}

export function TurnClock({ deadline, mySeat, now }: { deadline: DeadlineDoc | null | undefined; mySeat: number | null; now: () => number }) {
  const left = useTimeLeft(deadline, now);
  const mine = !!deadline && deadline.seat === mySeat;

  // A gentle nudge when your own time is nearly up: once for each deadline, and not for one that
  // was already that close when it arrived.
  const warned = useRef<number | null>(null);
  const roomy = useRef<number | null>(null);
  useEffect(() => {
    if (!deadline || left === null) return;
    if (left > WARN_MS) roomy.current = deadline.at;
    else if (mine && left > 0 && roomy.current === deadline.at && warned.current !== deadline.at) {
      warned.current = deadline.at;
      play("hurry");
    }
  }, [deadline, left, mine]);

  // Find the seat again on every tick, and when the page changes shape: seats move as hands grow.
  const [, setShape] = useState(0);
  useEffect(() => {
    const again = () => setShape((n) => n + 1);
    window.addEventListener("resize", again);
    window.addEventListener("scroll", again, true);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("scroll", again, true);
    };
  }, []);

  if (!deadline || left === null || typeof document === "undefined") return null;
  const box = seatBox(deadline.seat, mine);
  if (!box) return null;
  const low = left <= LOW_MS;
  return createPortal(
    <span
      // The seat's top right corner, kept on the screen.
      className={`turn-clock${mine ? " mine" : ""}${low ? " low" : ""}${low && left > 0 && !reducedMotion() ? " pulse" : ""}`}
      style={{ left: Math.min(box.right, window.innerWidth - 24), top: Math.max(box.top, 14) }}
      role="timer"
      aria-label={`${mine ? "Your time" : "Their time"}: ${clockWords(left)} left`}
    >
      {clockText(left)}
    </span>,
    document.body,
  );
}
