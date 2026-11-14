// Palace's big moments, drawn over the table: the pile burning up (a 10, or four of a kind), and the
// pile flying to whoever picks it up. The game has already moved on underneath; these are copies
// of the cards that just left, where they were, animated away. They never take a tap.
import type { PalaceView } from "@cardroom/palace";
import { cardId, type Card } from "@spades/rules";
import PlayingCard from "@spades/ui/playing-card.zb";
import { useLayoutEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { EASE_BACK, EASE_IN, EASE_OUT, rectOf, reducedMotion, type Seen } from "../motion";

interface Ghost {
  key: string;
  card: Card;
  from: DOMRect;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
}
interface Glow {
  key: string;
  at: DOMRect;
}

const MAX = 6;

/**
 * Watches the last move. On a burn or a pickup, makes ghosts of the cards that left (their places
 * come from the card motion's `departed`) and animates them. Call it after useCardFlip, so the
 * departures are this render's.
 */
export function usePalaceFx(view: PalaceView, me: number, departed: MutableRefObject<Map<string, Seen>>, scale: number, root: RefObject<HTMLElement | null>) {
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [glows, setGlows] = useState<Glow[]>([]);
  const prevPile = useRef<Card[]>([]);
  const seenMove = useRef<string | null>(null);
  const moveKey = JSON.stringify(view.last);

  useLayoutEffect(() => {
    const before = prevPile.current;
    prevPile.current = view.pile.slice(-3);
    if (seenMove.current === null || seenMove.current === moveKey) {
      seenMove.current = moveKey;
      return;
    }
    seenMove.current = moveKey;
    const m = view.last;
    if (!m || reducedMotion()) return;
    const pileEl = root.current?.querySelector(".pile .pile-stack, .pile .empty-slot");
    const pile = pileEl?.getBoundingClientRect();
    if (!pile) return;
    const gone = departed.current;
    const placed = (c: Card) => gone.get(cardId(c))?.rect;
    const stamp = Date.now();
    const made: Ghost[] = [];

    if (m.burned) {
      // Phase 1 (240ms): the cards just played fly onto the pile. Phase 2 (380ms): everything flares and lifts away.
      const quick = scale === 0;
      const total = quick ? 240 : 620;
      const burnAt = quick ? 0 : 240 / 620;
      const burnOut: Keyframe = { transform: "translateY(-14px) scale(1.08)", filter: "brightness(1.8)", opacity: 0 };
      before.forEach((c, i) => {
        const from = placed(c);
        if (from) made.push({ key: `${stamp}-p${i}`, card: c, from, keyframes: [{ opacity: 1 }, { opacity: 1, filter: "brightness(1)", offset: burnAt }, burnOut], options: { duration: total, easing: EASE_IN, fill: "forwards" } });
      });
      m.cards.forEach((c, i) => {
        const card = c as Card;
        const from = placed(card) ?? (m.seat === me ? null : rectOf(`[data-seat="${m.seat}"]`, new DOMRect(0, 0, pile.height / 1.4, pile.height), 0.5));
        if (!from) return;
        const dx = pile.left + pile.width / 2 - (from.left + from.width / 2) + i * 6;
        const dy = pile.top + pile.height / 2 - (from.top + from.height / 2);
        const land = `translate(${dx}px, ${dy}px)`;
        made.push({
          key: `${stamp}-c${i}`,
          card,
          from,
          keyframes: quick
            ? [{ transform: land, opacity: 1 }, { ...burnOut, transform: `${land} translateY(-14px) scale(1.08)` }]
            : [{ transform: "none", opacity: 1, easing: EASE_OUT }, { transform: land, filter: "brightness(1)", opacity: 1, offset: burnAt, easing: EASE_IN }, { transform: `${land} translateY(-14px) scale(1.08)`, filter: "brightness(1.8)", opacity: 0 }],
          options: { duration: total, fill: "forwards" },
        });
      });
      setGlows((g) => [...g, { key: `${stamp}-g`, at: pile }].slice(-2));
    } else if (m.pickedUp && scale > 0) {
      // The pile flies to whoever picked it up: your hand, or their seat.
      const target = m.seat === me ? rectOf(".me .hand", pile, 0.5) : rectOf(`[data-seat="${m.seat}"]`, pile, 0.5);
      before.forEach((c, i) => {
        const from = placed(c);
        if (!from || !target) return;
        const dx = target.left + target.width / 2 - (from.left + from.width / 2);
        const dy = target.top + target.height / 2 - (from.top + from.height / 2);
        made.push({
          key: `${stamp}-u${i}`,
          card: c,
          from,
          keyframes: [{ transform: "none", opacity: 1 }, { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(.62)`, opacity: 1, offset: 0.7 }, { transform: `translate(${dx}px, ${dy}px) scale(.5)`, opacity: 0 }],
          options: { duration: 360 * scale, delay: i * 30, easing: EASE_IN, fill: "both" },
        });
      });
    }
    if (made.length) setGhosts((g) => [...g, ...made].slice(-MAX));
  }, [moveKey]);

  const drop = (key: string) => setGhosts((g) => g.filter((x) => x.key !== key));
  const dropGlow = (key: string) => setGlows((g) => g.filter((x) => x.key !== key));

  const layer =
    ghosts.length || glows.length ? (
      <div className="fx-layer" aria-hidden="true">
        {glows.map((g) => (
          <GlowFx key={g.key} at={g.at} quick={scale === 0} onDone={() => dropGlow(g.key)} />
        ))}
        {ghosts.map((g) => (
          <GhostCard key={g.key} ghost={g} onDone={() => drop(g.key)} />
        ))}
      </div>
    ) : null;
  return layer;
}

function GhostCard({ ghost, onDone }: { ghost: Ghost; onDone: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const a = el.current?.animate(ghost.keyframes, ghost.options);
    if (!a) return onDone();
    a.onfinish = onDone;
    a.oncancel = onDone;
  }, []);
  const { from } = ghost;
  return (
    <div
      ref={el}
      className="ghost"
      style={{ left: from.left, top: from.top, width: from.width, height: from.height, "--trick-w": `${from.width}px`, "--trick-h": `${from.height}px` } as React.CSSProperties}
    >
      <PlayingCard card={ghost.card} size="table" />
    </div>
  );
}

function GlowFx({ at, quick, onDone }: { at: DOMRect; quick: boolean; onDone: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const size = Math.max(at.width, at.height) * 1.4;
  useLayoutEffect(() => {
    const a = el.current?.animate(
      [
        { transform: "scale(.6)", opacity: 0.9 },
        { transform: "scale(1.7)", opacity: 0 },
      ],
      { duration: quick ? 240 : 380, delay: quick ? 0 : 240, easing: EASE_BACK, fill: "both" },
    );
    if (!a) return onDone();
    a.onfinish = onDone;
  }, []);
  return <div ref={el} className="glow" style={{ left: at.left + at.width / 2 - size / 2, top: at.top + at.height / 2 - size / 2, width: size, height: size }} />;
}
