import type { ChatMessage } from "@spades/rooms/client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { play } from "./feedback/sounds";

export const QUICK_EMOJI = ["👍", "😂", "🔥", "😬", "😭", "🙄", "🎉", "♠️", "❤️", "🤞"];
/** How long a bubble stays up: time to read it, more for a longer line, and never in the way for long. */
export const bubbleMs = (text: string) => Math.min(6000, 2500 + 60 * text.length);

export interface ChatProps {
  messages: ChatMessage[];
  mySeat: number | null;
  /** Resolves to an error message, or null when sent. */
  send: (text: string) => Promise<string | null>;
}

const keyOf = (m: ChatMessage) => `${m.seat}:${m.at}:${m.text}`;

/**
 * The latest message from each seat, while it's fresh enough to show as a bubble.
 *
 * A bubble is timed from when this device first saw the message. A message's `at` is the server's
 * clock, and a phone that runs behind it would otherwise keep a bubble up for as long as it's behind.
 * Whatever was said before the table opened is history, and gets no bubble.
 */
export function useBubbles(messages: ChatMessage[]): Map<number, ChatMessage> {
  const firstSeen = useRef<Map<string, number> | null>(null);
  const [, redraw] = useState(0);
  const now = Date.now();
  firstSeen.current ??= new Map(messages.map((m) => [keyOf(m), -Infinity]));
  const latest = new Map<number, ChatMessage>();
  let next = Infinity;
  for (const m of messages) {
    const key = keyOf(m);
    let seen = firstSeen.current.get(key);
    if (seen === undefined) firstSeen.current.set(key, (seen = now));
    const until = seen + bubbleMs(m.text);
    if (until > now) latest.set(m.seat, m);
    else latest.delete(m.seat); // a seat's newer line has gone: don't fall back to an older one
  }
  for (const m of latest.values()) next = Math.min(next, firstSeen.current.get(keyOf(m))! + bubbleMs(m.text));
  useEffect(() => {
    if (next === Infinity) return;
    const t = setTimeout(() => redraw((n) => n + 1), Math.max(next - Date.now(), 0) + 20);
    return () => clearTimeout(t);
  }, [next]);
  return latest;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** What a bubble shouldn't sit on: anything to press, cards, the seats, sheets and other bubbles. Anything with words on it counts too. */
const IN_THE_WAY = 'button, a[href], input, select, [role="dialog"], .sheet, [data-seat], [data-flip], playing-card, .bubble';
const GAP = 6;
const EDGE = 8;

/**
 * Where a bubble of this size goes: beside the seat that spoke, on whichever side covers the least
 * of the table. Sides facing the middle of the table are tried first, so ties stay near the felt; at
 * a crowded table the last resort is over the speaker's own nameplate.
 */
function spotFor(el: HTMLElement, seat: number): { left: number; top: number; cost: number; costAt: (left: number, top: number) => number } {
  const table = el.closest(".table") ?? document.body;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const speaker = table.querySelector(`[data-seat="${seat}"]`);
  const anchor = speaker?.getBoundingClientRect();
  const inTheWay = new Set<Element>(table.querySelectorAll(IN_THE_WAY));
  const words = document.createTreeWalker(table, NodeFilter.SHOW_TEXT);
  while (words.nextNode()) if (words.currentNode.nodeValue?.trim() && words.currentNode.parentElement) inTheWay.add(words.currentNode.parentElement);
  // The speaker's own nameplate is the cheapest thing to cover: the bubble says who they are.
  const things: { box: Box; weight: number }[] = [];
  for (const other of inTheWay) {
    if (el.contains(other) || other.contains(el)) continue;
    const r = other.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) things.push({ box: r, weight: speaker?.contains(other) ? 0.25 : 1 });
  }
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), Math.max(vw - w - EDGE, EDGE));
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), Math.max(vh - h - EDGE, EDGE));
  const costAt = (left: number, top: number) => {
    const box = { left, top, right: left + w, bottom: top + h };
    return things.reduce((sum, t) => sum + overlap(box, t.box) * t.weight, 0);
  };
  if (!anchor) {
    const left = clampX((vw - w) / 2);
    const top = clampY(vh * 0.3);
    return { left, top, cost: costAt(left, top), costAt };
  }
  const midX = anchor.left + anchor.width / 2 - w / 2;
  const midY = anchor.top + anchor.height / 2 - h / 2;
  const below = [midX, anchor.bottom + GAP] as const;
  const above = [midX, anchor.top - GAP - h] as const;
  const toRight = [anchor.right + GAP, midY] as const;
  const toLeft = [anchor.left - GAP - w, midY] as const;
  const upper = anchor.top + anchor.height / 2 < vh / 2;
  const onLeft = anchor.left + anchor.width / 2 < vw / 2;
  const sides = onLeft ? [toRight, toLeft] : [toLeft, toRight];
  // Each try is a spot and how far it has strayed from the seat: a clear spot a little way off
  // beats covering something, but not by much, so a bubble stays with whoever said it.
  const tries: (readonly [number, number, number])[] = [...(upper ? [below, ...sides, above] : [above, ...sides, below]), [midX, midY] as const].map(([x, y]) => [x, y, 0] as const);
  for (let away = 40; away <= 240; away += 40) tries.push([midX, upper ? below[1] + away : above[1] - away, away]);
  let best: { left: number; top: number; cost: number } | null = null;
  for (const [x, y, away] of tries) {
    const left = clampX(x);
    const top = clampY(y);
    const cost = costAt(left, top) + away * 3;
    if (!best || cost < best.cost) best = { left, top, cost };
    if (cost === 0) break;
  }
  return { ...best!, costAt };
}

/** A speech bubble beside the seat that spoke. It finds its own room, and moves if something opens under it. */
export function Bubble({ message, seat }: { message: ChatMessage; seat: number }) {
  const short = message.text.length > 60 ? `${message.text.slice(0, 57)}…` : message.text;
  const onlyEmoji = /^\p{Extended_Pictographic}[\p{Extended_Pictographic}️‍\s]*$/u.test(message.text);
  const el = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const placed = useRef<{ left: number; top: number } | null>(null);
  const [moved, setMoved] = useState(false);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const settle = (force: boolean) => {
      const spot = spotFor(node, seat);
      const now = placed.current;
      // Stay put unless something sizeable has come to sit under the bubble (a sheet, a played card).
      if (!force && now && spot.costAt(now.left, now.top) - spot.cost < 400) return;
      if (now) setMoved(true); // glide to a new spot, but appear in the first one
      placed.current = { left: spot.left, top: spot.top };
      setAt(placed.current);
    };
    settle(true);
    const again = () => settle(true);
    window.addEventListener("resize", again);
    const watch = setInterval(() => settle(false), 400);
    return () => {
      window.removeEventListener("resize", again);
      clearInterval(watch);
    };
  }, [seat]);

  return (
    <div
      ref={el}
      className={`bubble ${onlyEmoji ? "emoji" : ""}`}
      role="status"
      aria-label={`${message.name} says ${message.text}`}
      style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? "visible" : "hidden", transition: moved ? undefined : "none", "--life": `${bubbleMs(message.text)}ms` } as React.CSSProperties}
    >
      <span className="said-by">{message.name}</span>
      <span>{short}</span>
    </div>
  );
}

/** The chat button and its sheet. Others' messages make a soft pop and count as unread. */
export function TableChat({ messages, mySeat, send }: ChatProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [readUpTo, setReadUpTo] = useState(messages.length);
  const list = useRef<HTMLOListElement>(null);
  const seen = useRef(messages.length);

  // A pop for each new message from someone else.
  useEffect(() => {
    const fresh = messages.slice(seen.current);
    seen.current = messages.length;
    if (fresh.some((m) => m.seat !== mySeat)) play("message");
  }, [messages, mySeat]);

  useEffect(() => {
    if (open) {
      setReadUpTo(messages.length);
      list.current?.lastElementChild?.scrollIntoView({ block: "end" });
    }
  }, [open, messages.length]);

  const unread = messages.slice(readUpTo).filter((m) => m.seat !== mySeat).length;

  async function submit(text: string) {
    if (!text.trim()) return;
    const refused = await send(text);
    if (refused) setProblem(refused);
    else {
      setProblem(null);
      setDraft("");
    }
  }

  return (
    <>
      <button type="button" className="chat-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={unread ? `Chat, ${unread} new` : "Chat"}>
        💬{unread > 0 && <span className="badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="chat-sheet" role="dialog" aria-label="Table chat">
          <div className="chat-head">
            <strong>Table talk</strong>
            <button type="button" className="link" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <ol className="chat-list" ref={list}>
            {messages.length === 0 && <li className="empty">Say hi to the table.</li>}
            {messages.map((m, i) => (
              <li key={`${m.at}-${i}`} className={`${m.seat === mySeat ? "mine" : ""} ${m.seat % 2 === (mySeat ?? 0) % 2 ? "us" : "them"}`}>
                <span className="who">
                  {m.name}
                  {m.bot ? " 🤖" : ""}
                </span>
                <span className="text">{m.text}</span>
              </li>
            ))}
          </ol>
          {mySeat !== null ? (
            <>
              <div className="emoji-row" role="group" aria-label="Quick emoji">
                {QUICK_EMOJI.map((e) => (
                  <button key={e} type="button" onClick={() => void submit(e)}>
                    {e}
                  </button>
                ))}
              </div>
              <form
                className="chat-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit(draft);
                }}
              >
                <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={280} placeholder="Say something…" enterKeyHint="send" aria-label="Message" />
                <button type="submit" className="primary small" disabled={!draft.trim()}>
                  Send
                </button>
              </form>
            </>
          ) : (
            <p className="fine">Take a seat to chat.</p>
          )}
          {problem && <p className="error">{problem}</p>}
        </div>
      )}
    </>
  );
}
