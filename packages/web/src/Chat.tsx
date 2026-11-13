import type { ChatMessage } from "@spades/rooms/client";
import { useEffect, useRef, useState } from "react";
import { play } from "./feedback/sounds";

export const QUICK_EMOJI = ["👍", "😂", "🔥", "😬", "😭", "🙄", "🎉", "♠️", "❤️", "🤞"];
const BUBBLE_MS = 4500;

export interface ChatProps {
  messages: ChatMessage[];
  mySeat: number | null;
  /** Resolves to an error message, or null when sent. */
  send: (text: string) => Promise<string | null>;
}

/** The most recent message from each seat, while it's fresh enough to show as a bubble. */
export function useBubbles(messages: ChatMessage[]): Map<number, ChatMessage> {
  const [now, setNow] = useState(() => Date.now());
  const latest = new Map<number, ChatMessage>();
  for (const m of messages) if (Date.now() - m.at < BUBBLE_MS) latest.set(m.seat, m);
  useEffect(() => {
    if (latest.size === 0) return;
    const t = setTimeout(() => setNow(Date.now()), 500);
    return () => clearTimeout(t);
  }, [messages, now, latest.size]);
  return latest;
}

/** A speech bubble over a seat. */
export function Bubble({ message, side }: { message: ChatMessage; side: string }) {
  const short = message.text.length > 60 ? `${message.text.slice(0, 57)}…` : message.text;
  const onlyEmoji = /^\p{Extended_Pictographic}[\p{Extended_Pictographic}️‍\s]*$/u.test(message.text);
  return (
    <div className={`bubble ${side} ${onlyEmoji ? "emoji" : ""}`} role="status" aria-label={`${message.name} says ${message.text}`}>
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
