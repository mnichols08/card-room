// Your hand, your way: a small bar to sort it (by suit or by rank, high or low first), and dragging
// to put any card where you like. The table hands its cards to useHandOrder and draws them in the
// order it gives back, with `hand` spread on the .hand element.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { loadFeedbackSettings } from "./feedback/sounds";
import { keepOrder, loadHandSort, moveCard, orderHand, saveHandSort, uniqueKeys, type HandSort, type SortGroup, type SortKey } from "./handOrder";
import { EASE_OUT, reducedMotion } from "./motion";

export interface Held<C> {
  card: C;
  /** Unique in the hand: use it as the React key. */
  key: string;
}

interface Options {
  /** The orders on offer. Spades already deals by suit, so it leaves "game" out. */
  groups?: readonly SortGroup[];
  fallback?: HandSort;
}

const GROUPS: readonly SortGroup[] = ["game", "suit", "rank"];
const HOLD_MS = 240;
const SLOP = 7;

/**
 * The hand in the player's order. `game` names the saved choice ("spades", "palace", "hearts"…),
 * `idOf` a card, and `keyOf` reads its suit and rank for sorting.
 */
export function useHandOrder<C>(game: string, cards: readonly C[], idOf: (card: C) => string, keyOf: (card: C) => SortKey, options: Options = {}) {
  const groups = options.groups ?? GROUPS;
  const fallback = options.fallback ?? { group: groups[0]!, dir: "high" as const };
  const [sort, setSort] = useState(() => loadHandSort(game, fallback, groups));
  /** The player's own order (card keys), once they've dragged a card; null while a sort is on. */
  const [custom, setCustom] = useState<string[] | null>(null);

  const keys = useMemo(() => uniqueKeys(cards.map(idOf)), [cards]);
  const held: Held<C>[] = useMemo(() => {
    const all = cards.map((card, i) => ({ card, key: keys[i]! }));
    if (!custom) return orderHand(all, (h) => keyOf(h.card), sort);
    const by = new Map(all.map((h) => [h.key, h]));
    return keepOrder(custom, keys).map((k) => by.get(k)!);
  }, [cards, keys, custom, sort]);

  // Your own order lasts for the hand you made it in: a fresh deal goes back to the sort you chose.
  useEffect(() => {
    if (!custom) return;
    const mine = new Set(custom);
    if (!keys.some((k) => mine.has(k))) setCustom(null);
    else if (custom.length !== keys.length || keys.some((k) => !mine.has(k))) setCustom(keepOrder(custom, keys));
  }, [keys, custom]);

  function choose(next: HandSort) {
    setSort(next);
    saveHandSort(game, next);
    setCustom(null);
  }

  // ---- Dragging --------------------------------------------------------------------------------
  const order = useRef<string[]>([]);
  order.current = held.map((h) => h.key);
  const el = useRef<HTMLElement | null>(null);
  const drag = useRef<{ stop: (commit: boolean) => void } | null>(null);
  const draggedAt = useRef(0);

  // A hand too wide for the screen scrolls sideways under a finger, so there a card is picked up
  // by holding it; one that fits can be dragged straight away.
  useLayoutEffect(() => {
    const hand = el.current;
    if (!hand) return;
    if (hand.scrollWidth > hand.clientWidth + 1) hand.dataset.scrolls = "";
    else delete hand.dataset.scrolls;
  });
  // The hand changed under a drag (a card arrived): let go.
  useLayoutEffect(() => () => drag.current?.stop(false), [keys.join(" ")]);

  const cardsIn = (hand: HTMLElement) => [...hand.querySelectorAll<HTMLElement>(":scope > playing-card")];

  function commit(next: string[], settle: HTMLElement[]) {
    // The cards are already where they're going: tell the card motion not to glide them again.
    settle.forEach((c) => (c.dataset.settled = ""));
    flushSync(() => setCustom(next));
    settle.forEach((c) => delete c.dataset.settled);
  }

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0 || drag.current) return;
    const hand = e.currentTarget;
    const all = cardsIn(hand);
    const card = (e.target as HTMLElement).closest<HTMLElement>("playing-card");
    const from = card ? all.indexOf(card) : -1;
    if (!card || from < 0 || all.length < 2 || all.length !== order.current.length) return;

    const touch = e.pointerType === "touch";
    const scrolls = "scrolls" in hand.dataset;
    const { clientX: x0, clientY: y0, pointerId } = e;
    const rects = all.map((c) => c.getBoundingClientRect());
    const strip = (rects[all.length - 1]!.left - rects[0]!.left) / (all.length - 1) || rects[0]!.width;
    const scroll0 = hand.scrollLeft;
    let live = false;
    let to = from;
    let lastX = x0;

    const begin = () => {
      live = true;
      card.dataset.dragging = "";
      hand.dataset.rearranging = "";
      if (touch && loadFeedbackSettings().vibrate && typeof navigator.vibrate === "function") navigator.vibrate(8);
      place();
    };
    const hold = touch ? setTimeout(begin, HOLD_MS) : undefined;

    const place = () => {
      const dx = lastX - x0 + (hand.scrollLeft - scroll0);
      to = Math.max(0, Math.min(all.length - 1, Math.round(from + dx / strip)));
      card.style.translate = `${dx}px calc(var(--card-h) * -0.16)`;
      all.forEach((c, i) => {
        if (c === card) return;
        const shift = i > from && i <= to ? -strip : i < from && i >= to ? strip : 0;
        c.style.translate = shift ? `${shift}px 0` : "";
      });
    };

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - x0;
      const dy = ev.clientY - y0;
      if (!live) {
        const far = Math.hypot(dx, dy) > SLOP;
        if (touch && (scrolls || Math.abs(dy) > Math.abs(dx))) {
          // A swipe, not a hold: the page (or the hand) scrolls.
          if (far) stop(false);
          return;
        }
        if (!far) return;
        begin();
      }
      lastX = ev.clientX;
      // Near an edge of a scrolling hand, bring more of it into reach.
      const box = hand.getBoundingClientRect();
      if (scrolls && ev.clientX > box.right - 36) hand.scrollLeft += 10;
      else if (scrolls && ev.clientX < box.left + 36) hand.scrollLeft -= 10;
      place();
    };
    const up = (ev: PointerEvent) => ev.pointerId === pointerId && stop(ev.type === "pointerup");
    // Once a card is in the air, the finger moves the card, not the page.
    const hush = (ev: Event) => live && ev.cancelable && ev.preventDefault();

    const stop = (keep: boolean) => {
      clearTimeout(hold);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("touchmove", hush);
      window.removeEventListener("contextmenu", hush);
      drag.current = null;
      if (!live) return;
      draggedAt.current = performance.now();
      const was = card.getBoundingClientRect();
      delete card.dataset.dragging;
      delete hand.dataset.rearranging;
      all.forEach((c) => (c.style.translate = ""));
      if (keep && to !== from) commit(moveCard(order.current, from, to), all);
      // The card settles from where it was let go into its place.
      const now = card.getBoundingClientRect();
      if (!reducedMotion() && card.isConnected) {
        card.animate([{ translate: `${was.left - now.left}px ${was.top - now.top}px`, zIndex: 5 }, { translate: "0 0", zIndex: 5 }], { duration: 160, easing: EASE_OUT });
      }
    };

    drag.current = { stop };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("touchmove", hush, { passive: false });
    window.addEventListener("contextmenu", hush);
  }

  /** Letting go of a card isn't a tap on it. */
  function onClickCapture(e: React.MouseEvent) {
    if (performance.now() - draggedAt.current < 350) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  /** Alt + ← / → moves the card you're on, for hands held by keyboard. */
  function onKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const all = cardsIn(e.currentTarget);
    const from = all.indexOf((e.target as HTMLElement).closest<HTMLElement>("playing-card")!);
    const to = from + (e.key === "ArrowLeft" ? -1 : 1);
    if (from < 0 || to < 0 || to >= all.length || all.length !== order.current.length) return;
    e.preventDefault();
    setCustom(moveCard(order.current, from, to));
  }

  return {
    /** The cards to draw, in order. */
    held,
    /** Spread on the .hand element, and add `sortable` to its class. */
    hand: { ref: (node: HTMLElement | null) => void (el.current = node), onPointerDown, onClickCapture, onKeyDown },
    /** For <HandSortBar />. */
    bar: {
      groups,
      sort,
      mine: custom !== null,
      count: cards.length,
      onSort: choose,
      onMine: () => setCustom(order.current),
    },
  };
}

const GROUP_LABEL: Record<SortGroup, { text: string; title: string }> = {
  game: { text: "Auto", title: "The way this game deals them" },
  suit: { text: "Suits", title: "Grouped by suit" },
  rank: { text: "Ranks", title: "In a run by rank, suits mixed" },
};

interface BarProps {
  groups: readonly SortGroup[];
  sort: HandSort;
  mine: boolean;
  count: number;
  onSort: (next: HandSort) => void;
  onMine: () => void;
}

/** The sort bar above your hand: how to group it, which end is high, and "Mine" for your own order. */
export function HandSortBar({ groups, sort, mine, count, onSort, onMine }: BarProps) {
  if (count < 2) return null;
  const flippable = mine || sort.group !== "game";
  const flipped: HandSort = { group: sort.group === "game" ? (groups.find((g) => g !== "game") ?? "suit") : sort.group, dir: sort.dir === "high" ? "low" : "high" };
  return (
    <div className="hand-sort" role="group" aria-label="Sort your hand">
      <div className="hand-sort-group">
        {groups.map((g) => (
          <button key={g} type="button" aria-pressed={!mine && sort.group === g} title={GROUP_LABEL[g].title} onClick={() => onSort({ ...sort, group: g })}>
            {GROUP_LABEL[g].text}
          </button>
        ))}
        <button type="button" aria-pressed={mine} title="Your own order: drag a card to put it where you like" onClick={onMine}>
          Mine
        </button>
      </div>
      <button
        type="button"
        className="hand-sort-dir"
        disabled={!flippable}
        aria-label={sort.dir === "high" ? "High to low. Switch to low to high" : "Low to high. Switch to high to low"}
        title={!flippable ? "Auto keeps the game's own order" : sort.dir === "high" ? "High to low" : "Low to high"}
        onClick={() => onSort(flipped)}
      >
        {!flippable ? "A ⇅ 2" : sort.dir === "high" ? "A → 2" : "2 → A"}
      </button>
    </div>
  );
}
