// Card motion. Cards glide from where they were to where they are now (FLIP, with the Web
// Animations API): your card from your hand to the trick, an opponent's from their seat, the rest of
// your hand closing up. Nothing ever waits for an animation: the game moves on at once, taps stay
// live, and a new animation on a card finishes the old one first, so nothing queues up at the
// "instant" pace.
//
// Mark a card's wrapper with data-flip="<card id>". A card that's new gets data-from="<selector>"
// to come in from somewhere (a seat, the deck); without it, a new card just appears.
import type { Pace } from "@spades/rules";
import { motionSetting } from "./display";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";
export const EASE_IN = "cubic-bezier(.5,0,.75,0)";
export const EASE_BACK = "cubic-bezier(.34,1.4,.64,1)";

/** The device asks for less motion, or the player turned animations off. */
export const reducedMotion = () => motionSetting() === "off" || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);

/**
 * How much cards travel: 1 for full motion, less at the fast pace or with calm animations, and 0
 * (a quick fade instead) for reduced motion, animations off, or the instant pace.
 */
export const motionScale = (pace?: Pace) => {
  if (reducedMotion() || pace === "instant") return 0;
  return (pace === "fast" ? 0.75 : 1) * (motionSetting() === "calm" ? 0.6 : 1);
};

export interface Seen {
  rect: DOMRect;
  el: HTMLElement;
}

/** A selector's element, as a card-sized box at its centre (half size, for cards arriving from a seat). */
export function rectOf(selector: string | undefined, card: DOMRect, shrink = 0.5): DOMRect | null {
  const r = selector ? document.querySelector(selector)?.getBoundingClientRect() : null;
  if (!r) return null;
  const w = card.width * shrink;
  const h = card.height * shrink;
  return new DOMRect(r.left + r.width / 2 - w / 2, r.top + r.height / 2 - h / 2, w, h);
}

/**
 * After every render, glide each data-flip card inside `root` from its last position (or from its
 * data-from) to where it is now. Returns the cards that were there last time and are gone now,
 * with where they were: for effects like a burn, where cards leave the table.
 */
const droppedAt = new Map<string, DOMRect>();
/**
 * A card was let go here after being dragged: its next glide starts from this spot, not from where
 * it sat before the drag. (If the move is refused, that same glide carries it back.)
 */
export function glideFrom(id: string, rect: DOMRect) {
  droppedAt.set(id, rect);
}

export function useCardFlip(root: RefObject<HTMLElement | null>, scale: number) {
  const last = useRef(new Map<string, Seen>());
  const departed = useRef(new Map<string, Seen>());
  useLayoutEffect(() => {
    const now = new Map<string, Seen>();
    root.current?.querySelectorAll<HTMLElement>("[data-flip]").forEach((el) => {
      const id = el.dataset.flip!;
      if (now.has(id)) return;
      // Measure without any animation still running on it.
      el.getAnimations().forEach((a) => a.finish());
      const rect = el.getBoundingClientRect();
      now.set(id, { rect, el });
      // A card the player just dragged into place (data-settled) is already where it belongs.
      if (el.dataset.settled !== undefined) return;
      const before = last.current.get(id);
      const dropped = droppedAt.get(id);
      droppedAt.delete(id);
      const from = dropped ?? before?.rect ?? rectOf(el.dataset.from, rect);
      if (!from) return;
      const dx = from.left + from.width / 2 - (rect.left + rect.width / 2);
      const dy = from.top + from.height / 2 - (rect.top + rect.height / 2);
      const s = rect.width ? from.width / rect.width : 1;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.02) return;
      const isNew = !before;
      if (scale === 0) {
        // Instant pace or reduced motion: a quick fade. Animations turned off: nothing at all.
        if (isNew && motionSetting() !== "off") el.animate({ opacity: [0, 1] }, { duration: 90 });
        return;
      }
      const spin = isNew ? (dx < 0 ? 10 : -10) : 0;
      el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${s}) rotate(${spin}deg)`, zIndex: 5 }, { transform: "none", zIndex: 5 }], {
        duration: (isNew ? 300 : 280) * scale,
        easing: EASE_OUT,
      });
    });
    departed.current = new Map([...last.current].filter(([id]) => !now.has(id)));
    last.current = now;
  });
  return departed;
}

/**
 * Lift the cards you just played straight away, before the table answers (a shared table takes a
 * moment). Returns a function that puts them back, for when the move is refused.
 */
export function lift(root: HTMLElement | null, ids: string[]): () => void {
  const hosts = ids.flatMap((id) => [...(root?.querySelectorAll<HTMLElement>(`.me [data-flip="${CSS.escape(id)}"]`) ?? [])]);
  hosts.forEach((h) => h.classList.add("sent"));
  return () => hosts.forEach((h) => h.classList.remove("sent"));
}

/** True for `ms` after `key` changes (and on the first render, if `initial`). */
export function useFlash(key: unknown, ms: number, initial = true): boolean {
  const [on, setOn] = useState(initial);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!initial) return;
    } else setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [key]);
  return on;
}

/** Send a group of cards to a place (a trick to its winner): they shrink and fade on the way, and stay gone. */
export function collect(cards: HTMLElement[], to: DOMRect, scale: number) {
  if (scale === 0) return;
  for (const el of cards) {
    const r = el.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (r.left + r.width / 2);
    const dy = to.top + to.height / 2 - (r.top + r.height / 2);
    el.getAnimations().forEach((a) => a.finish());
    el.animate(
      [
        { transform: "none", opacity: 1 },
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(.6)`, opacity: 1, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) scale(.4)`, opacity: 0 },
      ],
      { duration: 340 * scale, easing: EASE_IN, fill: "forwards" },
    );
  }
}
