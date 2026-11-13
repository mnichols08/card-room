import type { PalaceMove, PalaceView } from "@cardroom/palace";
import { cardId, type Card, type TableSettings } from "@spades/rules";
import { TableSettingsButton } from "../TableSettings";
import PalaceSeat from "@spades/ui/palace-seat.zb";
import PlayingCard from "@spades/ui/playing-card.zb";
import { useEffect, useRef, useState } from "react";
import { Bubble, TableChat, useBubbles, type ChatProps } from "../Chat";
import { loadFeedbackSettings, play, saveFeedbackSettings } from "../feedback/sounds";
import { Confetti } from "../Confetti";
import { motionScale, useCardFlip, useFlash } from "../motion";
import { usePalaceFx } from "./PalaceFx";

type PCard = Extract<Card, { kind: "pip" }>;
const WORD: Record<number, [string, string]> = { 11: ["jack", "jacks"], 12: ["queen", "queens"], 13: ["king", "kings"], 14: ["ace", "aces"] };
const COUNT = ["", "", "two", "three", "four", "five", "six", "seven", "eight"];
/** "an 8", "a jack", "two 7s", "three aces". */
export function cardsInWords(rank: number, n: number): string {
  const [one, many] = WORD[rank] ?? [String(rank), `${rank}s`];
  if (n > 1) return `${COUNT[n] ?? n} ${many}`;
  return `${rank === 8 || rank === 14 ? "an" : "a"} ${one}`;
}

export interface PalaceTableProps {
  view: PalaceView;
  seat: number;
  names: string[];
  /** Resolves to an error message when the move is refused. */
  act: (move: PalaceMove) => Promise<string | null>;
  onLeave: () => void;
  banner?: React.ReactNode;
  chat?: ChatProps;
  /** Opponents and speed, changeable mid-game. */
  settings?: { value: TableSettings; change: (next: TableSettings) => Promise<void> | void };
}

/** What just happened, in words: "Hank burned it 🔥", "Dot picked up 9". */
function narrate(view: PalaceView, names: string[]): string | null {
  const m = view.last;
  if (!m) return null;
  const who = names[m.seat] ?? "Someone";
  const card = m.cards[0];
  if (m.kind === "pickup") return `${who} picked up ${m.pickedUp}`;
  if (m.kind === "flip" && m.pickedUp) return `${who} flipped ${cardsInWords(card!.rank, 1)}… and picked up ${m.pickedUp}`;
  const what = card ? cardsInWords(card.rank, m.cards.length) : "";
  const blind = m.kind === "flip" ? " blind" : "";
  if (m.burned) return `${who} played ${what}${blind} and burned it 🔥`;
  return `${who} played ${what}${blind}`;
}

/** Palace at the table: the pile, everyone's face-up cards, your hand. Works for a practice game or a family table. */
export function PalaceTable({ view, seat: me, names, act, onLeave, banner, chat, settings }: PalaceTableProps) {
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<{ rank: number; ids: string[] } | null>(null);
  const [swapFrom, setSwapFrom] = useState<string | null>(null);
  const [faceUp, setFaceUp] = useState<string[]>([]);
  const [soundOn, setSoundOn] = useState(() => loadFeedbackSettings().sound);
  const bubbles = useBubbles(chat?.messages ?? []);
  const mine = view.players[me]!;
  const can = view.can;
  const myTurn = view.phase === "playing" && view.turn === me;
  /** How many cards to pick for face-up, in the family deal; 0 once they're down. */
  const toChoose = can?.choose ?? 0;
  const others = Array.from({ length: view.seats - 1 }, (_, i) => (me + 1 + i) % view.seats);
  const top = view.pile[view.pile.length - 1] ?? null;
  const root = useRef<HTMLElement>(null);
  const scale = motionScale(settings?.value.pace);
  const departed = useCardFlip(root, scale);
  const fx = usePalaceFx(view, me, departed, scale, root);
  const breathe = useFlash(myTurn, 700, false) && myTurn;
  const last = view.last;
  /** Where a card on the pile came from, if it was just played: someone's seat, or your own table. */
  const pileFrom = (c: Card) => {
    if (!last || !last.cards.some((x) => cardId(x as Card) === cardId(c))) return undefined;
    if (last.seat === me) return last.kind === "flip" ? ".me .my-table" : undefined;
    return `[data-seat="${last.seat}"]`;
  };
  /** New cards in your hand come from the deck, or from the pile when you picked it up. */
  const handFrom = last?.pickedUp && last.seat === me ? ".pile" : ".deck";

  // Sounds and a buzz: cards landing, burns, pickups, your turn.
  const lastKey = JSON.stringify([view.last, view.phase]);
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = lastKey;
      return;
    }
    if (seen.current === lastKey) return;
    seen.current = lastKey;
    const m = view.last;
    if (view.phase === "finished") play(view.finished[0] === me ? "won" : view.loser === me ? "lost" : "won");
    else if (m?.burned) play("spadesBroken");
    else if (m?.pickedUp) play(m.seat === me ? "set" : "trickThem");
    else if (m) play("card");
    if (view.phase === "playing" && view.turn === me && m?.seat !== me) {
      play("yourTurn");
    }
  }, [lastKey]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(t);
  }, [error]);
  useEffect(() => setChoosing(null), [view.turn, view.phase]);

  const send = async (move: PalaceMove) => {
    setChoosing(null);
    const refused = await act(move);
    if (refused) {
      setError(refused);
      play("nope");
    }
  };

  /** Tap a card in hand (or face-up, once the hand is gone): play it, or ask how many when you hold more. */
  function tap(card: PCard, from: "hand" | "up") {
    if (view.phase === "swapping" && toChoose && from === "hand") {
      const id = cardId(card);
      setFaceUp((picked) => (picked.includes(id) ? picked.filter((x) => x !== id) : picked.length < toChoose ? [...picked, id] : picked));
      return;
    }
    if (view.phase === "swapping") {
      if (!view.rules.swap || mine.ready) return;
      if (from === "hand") setSwapFrom(cardId(card) === swapFrom ? null : cardId(card));
      else if (swapFrom) {
        void send({ type: "swap", hand: swapFrom, up: cardId(card) });
        setSwapFrom(null);
      }
      return;
    }
    if (!myTurn || can?.source !== from) return;
    if (!can.ranks.includes(card.rank)) {
      setError(view.rules.sevenLower && top?.rank === 7 ? "After a 7, play 7 or lower." : "That's lower than the pile.");
      play("nope");
      return;
    }
    const pool = from === "hand" ? view.hand : mine.up;
    const same = pool.filter((c) => c.rank === card.rank).map(cardId);
    if (same.length === 1) void send({ type: "play", cards: same });
    else setChoosing({ rank: card.rank, ids: same });
  }

  function toggleSound() {
    const next = { ...loadFeedbackSettings(), sound: !soundOn };
    saveFeedbackSettings(next);
    setSoundOn(next.sound);
  }

  const status = error ? (
    <span className="error">{error}</span>
  ) : view.phase === "swapping" ? (
    mine.ready ? "Waiting for everyone to lay down their cards…" : toChoose ? `Pick ${toChoose} cards to lay face-up` : view.rules.swap ? (swapFrom ? "Now tap a face-up card to swap it in" : "Swap any hand card with a face-up card, then tap Ready") : null
  ) : view.phase === "finished" ? null : myTurn ? (
    <span className="mine">{can?.flip ? "Your turn: flip a face-down card" : can?.ranks.length ? "Your turn" : "Nothing plays. Pick up the pile."}</span>
  ) : (
    `${names[view.turn]} is thinking…`
  );

  const order = [...view.finished, ...(view.loser !== null ? [view.loser] : [])];

  return (
    <main className="table palace" ref={root}>
      <header className="palace-bar">
        <button type="button" className="leave" aria-label="Leave game" onClick={() => (view.phase === "finished" || confirm("Leave this game?")) && onLeave()}>
          ←
        </button>
        <strong>🏰 {view.rules.name}</strong>
        <span className="bar-buttons">
        {settings && <TableSettingsButton settings={settings.value} onChange={settings.change} />}
        <button type="button" className="sound-toggle inline" onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? "Turn sounds off" : "Turn sounds on"}>
          {soundOn ? "🔊" : "🔇"}
        </button>
        </span>
      </header>
      {banner}

      <div className="felt palace-felt">
        <div className="opponents" style={{ "--count": others.length } as React.CSSProperties}>
          {others.map((s) => {
            const p = view.players[s]!;
            return (
              <PalaceSeat
                key={s}
                data-seat={s}
                name={names[s] ?? `Seat ${s + 1}`}
                up={p.up}
                down={p.down}
                held={p.hand}
                active={view.phase === "playing" && view.turn === s}
                place={view.loser === s ? 0 : (p.place ?? 0)}
                last={view.loser === s}
              />
            );
          })}
        </div>

        <div className="pile-area" aria-label="The pile">
          <div className="deck" aria-label={`${view.deck} cards left to draw`}>
            {view.deck > 0 ? <PlayingCard back size="table" style={{ "--depth": Math.min(6, Math.ceil(view.deck / 8)) } as React.CSSProperties} /> : <div className="empty-slot">No deck</div>}
            <small>{view.deck} to draw</small>
          </div>
          <div className="pile">
            {view.pile.length ? (
              <div className="pile-stack">
                {view.pile.slice(-3).map((c, i, list) => (
                  <div key={`${cardId(c)}-${view.pileCount - list.length + i}`} className={`pile-card${last?.kind === "flip" && pileFrom(c) ? " flipped" : ""}`} style={{ "--i": i } as React.CSSProperties}>
                    <PlayingCard card={c} size="table" data-flip={cardId(c)} data-from={pileFrom(c)} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-slot">{view.last?.burned ? <span className="burnt">🔥</span> : "Empty pile"}</div>
            )}
            <small>
              {view.pileCount} in the pile{view.burned ? ` · ${view.burned} burned` : ""}
            </small>
          </div>
        </div>

        <p className="narration" aria-live="polite">
          {narrate(view, names)}
        </p>
        <div className="status" role="status">
          {status}
        </div>
        {view.phase === "swapping" && !mine.ready && toChoose > 0 && (
          <div className="felt-actions">
            <button
              type="button"
              className="primary"
              disabled={faceUp.length !== toChoose}
              onClick={() => {
                void send({ type: "choose", cards: faceUp });
                setFaceUp([]);
              }}
            >
              {faceUp.length === toChoose ? "Lay these face-up" : `Pick ${toChoose - faceUp.length} more`}
            </button>
          </div>
        )}
        {view.phase === "swapping" && !mine.ready && !toChoose && (
          <div className="felt-actions">
            <button type="button" className="primary" onClick={() => void send({ type: "ready" })}>
              Ready to play
            </button>
          </div>
        )}

        {myTurn && can?.pickUp && !choosing && (
          <div className="felt-actions">
            <button type="button" className={can.ranks.length ? "secondary" : "primary"} onClick={() => void send({ type: "pickup" })}>
              {can.ranks.length ? `Pick up the pile instead (${view.pileCount})` : `Pick up the pile (${view.pileCount})`}
            </button>
          </div>
        )}

        {choosing && (
          <div className="felt-actions">
            <p>You have {cardsInWords(choosing.rank, choosing.ids.length)}.</p>
            <div className="row-actions">
              <button type="button" className="primary" onClick={() => void send({ type: "play", cards: choosing.ids })}>
                Play all {choosing.ids.length}
              </button>
              <button type="button" className="secondary" onClick={() => void send({ type: "play", cards: choosing.ids.slice(0, 1) })}>
                Just one
              </button>
              <button type="button" className="link" onClick={() => setChoosing(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <section className="me">
        {chat && <TableChat {...chat} />}
        <div className="my-table" aria-label="Your table cards">
          {Array.from({ length: Math.max(mine.up.length, mine.down) }, (_, i) => {
            const up = mine.up[i] as PCard | undefined;
            const flippable = myTurn && can?.flip && i < mine.down;
            return (
              <div key={i} className="table-slot">
                {i < mine.down && (
                  <div className="down-card">
                    {flippable ? (
                      <button type="button" className="flip" aria-label={`Flip face-down card ${i + 1}`} onClick={() => void send({ type: "flip", index: i })}>
                        <PlayingCard back />
                      </button>
                    ) : (
                      <PlayingCard back />
                    )}
                  </div>
                )}
                {up && (
                  <div className="up-card">
                    <PlayingCard
                      card={up}
                      data-flip={cardId(up)}
                      playable={(view.phase === "swapping" && !!swapFrom) || (myTurn && can?.source === "up")}
                      dim={myTurn && can?.source === "up" && !can.ranks.includes(up.rank)}
                      onPick={() => tap(up, "up")}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div
          className={`hand ${breathe ? "breathe" : ""}`}
          role="group"
          aria-label="Your hand"
          style={{ "--n": view.hand.length, ...(view.hand.length <= 6 ? { "--strip-max": "calc(var(--card-w) + 8px)" } : {}) } as React.CSSProperties}
        >
          {view.hand.map((card, i) => (
            <PlayingCard
              key={`${cardId(card)}-${i}`}
              data-flip={cardId(card)}
              data-from={handFrom}
              style={{ "--i": i } as React.CSSProperties}
              card={card}
              playable={(view.phase === "swapping" && (view.rules.swap || toChoose > 0) && !mine.ready) || (myTurn && can?.source === "hand")}
              dim={myTurn && can?.source === "hand" && !can.ranks.includes(card.rank)}
              selected={swapFrom === cardId(card) || faceUp.includes(cardId(card)) || (choosing?.ids.includes(cardId(card)) ?? false)}
              onPick={() => tap(card as PCard, "hand")}
            />
          ))}
          {!view.hand.length && mine.place === null && view.phase !== "finished" && <p className="fine">Your hand is empty.</p>}
        </div>
      </section>

      <div className="bubble-layer" aria-live="polite">
        {[...bubbles.entries()].map(([s, m]) => (
          <Bubble key={`${s}-${m.at}`} message={m} side={s === me ? "bottom" : "palace"} />
        ))}
      </div>

      {fx}
      {view.phase === "finished" && view.finished[0] === me && <Confetti />}
      {view.phase === "finished" && (
        <div className="sheet won-sheet">
          <h2>{view.finished[0] === me ? "You won! 👑" : view.loser === me ? "Left holding the cards 😅" : `${names[view.finished[0]!]} won 👑`}</h2>
          <ol className="placings">
            {order.map((s, i) => (
              <li key={s} className={s === me ? "mine" : ""}>
                {i === 0 ? "🥇" : i === order.length - 1 ? "🃏" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`} {names[s]}
              </li>
            ))}
          </ol>
          <button type="button" className="primary" onClick={onLeave}>
            Play again
          </button>
        </div>
      )}
    </main>
  );
}
