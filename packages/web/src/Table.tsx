import { type TableSettings, cardId, passingSeats, sameCard, teamOf, type Bid, type Card, type GameState, type HandRecord, type Seat, type SeatView, type Team } from "@spades/rules";
import BidPad from "@spades/ui/bid-pad.zb";
import HandSummary from "@spades/ui/hand-summary.zb";
import PlayingCard from "./PlayingCard";
import ScoreBoard from "@spades/ui/score-board.zb";
import SeatBadge from "@spades/ui/seat-badge.zb";
import { useEffect, useRef, useState } from "react";
import { Confetti } from "./Confetti";
import { collect, lift, motionScale, rectOf, useCardFlip, useFlash } from "./motion";
import { loadFeedbackSettings, play, saveFeedbackSettings } from "./feedback/sounds";
import { useTableSounds } from "./feedback/useTableSounds";
import { Bubble, TableChat, useBubbles, type ChatProps } from "./Chat";
import { TRICK_HOLD_MS, type TableState } from "./useTable";
import { TableSettingsButton } from "./TableSettings";

interface Props {
  table: TableState;
  names: Record<Seat, string>;
  onLeave: () => void;
  /** Shown under the scoreboard: the table code, who's here. */
  banner?: React.ReactNode;
  /** Table talk, at family tables. */
  chat?: ChatProps;
  /** Opponents and speed, changeable mid-game. */
  settings?: { value: TableSettings; change: (next: TableSettings) => Promise<void> | void };
}

const SIDES = ["bottom", "left", "top", "right"] as const;

export function Table({ table: t, names, onLeave, banner, chat, settings }: Props) {
  const view = t.view!;
  const me = t.seat;
  const preset = view.preset;
  const side = (s: Seat) => SIDES[(s - me + 4) % 4]!;
  const partner = ((me + 2) % 4) as Seat;
  const left = ((me + 1) % 4) as Seat;
  const right = ((me + 3) % 4) as Seat;
  const myTeam = teamOf(me);
  const [selected, setSelected] = useState<Card[]>([]);
  const [soundOn, setSoundOn] = useState(() => loadFeedbackSettings().sound);
  useTableSounds(t);
  const bubbles = useBubbles(chat?.messages ?? []);
  const root = useRef<HTMLElement>(null);
  const scale = motionScale(settings?.value.pace);
  useCardFlip(root, scale);

  function toggleSound() {
    const next = { ...loadFeedbackSettings(), sound: !soundOn };
    saveFeedbackSettings(next);
    setSoundOn(next.sound);
    if (next.sound) play("bid");
  }

  const myTurnToBid = view.phase === "bidding" && view.turn === me && !t.paused && !t.watching;
  const myTurnToPlay = view.phase === "playing" && view.turn === me && !t.paused && !t.watching;
  const iPass = view.phase === "passing" && passingSeats(view as unknown as GameState).includes(me) && !view.myPass && !t.watching;
  const passCount = preset.blindNil.passCards;

  // A new hand deals in; a hand looked at after a blind-nil chance turns over instead.
  const blindHand = useRef<number | null>(null);
  if (t.hand === null) blindHand.current = view.handNumber;
  const dealing = useFlash(`${view.handNumber}-${t.hand === null}`, 1100);
  const handMotion = dealing ? (blindHand.current === view.handNumber && t.hand !== null ? "reveal" : `dealing${settings?.value.pace === "instant" ? " quick" : ""}`) : "";
  const breathe = useFlash(myTurnToPlay, 700, false) && myTurnToPlay;

  // A won trick: the winning card pops, then the cards sweep to the winner just before they go.
  useEffect(() => {
    if (t.trickWinner === null) return;
    const winner = t.trickWinner;
    const timer = setTimeout(() => {
      const cards = [...(root.current?.querySelectorAll<HTMLElement>(".trick [data-flip]") ?? [])];
      const first = cards[0]?.getBoundingClientRect();
      const to = first && rectOf(`[data-seat="${winner}"]`, first, 0.4);
      if (to) collect(cards, to, scale);
    }, TRICK_HOLD_MS - 380);
    return () => clearTimeout(timer);
  }, [t.trickWinner]);

  function pick(card: Card) {
    if (iPass) {
      setSelected((sel) =>
        sel.some((c) => sameCard(c, card))
          ? sel.filter((c) => !sameCard(c, card))
          : sel.length < passCount
            ? [...sel, card]
            : sel,
      );
      return;
    }
    if (myTurnToPlay) {
      const putBack = lift(root.current, [cardId(card)]);
      void t.act({ type: "play", card }).then((refused) => refused && putBack());
    }
  }

  function bid(detail: number | "nil" | "blind-nil") {
    const choice: Bid = typeof detail === "number" ? { kind: "tricks", count: detail } : { kind: detail };
    void t.act({ type: "bid", bid: choice });
  }

  const seat = (s: Seat, layout: "row" | "column" = "column") => (
    <SeatBadge
      data-seat={s}
      name={names[s]}
      bid={bidLabel(view.bids[s] ?? null)}
      tricks={view.tricksWon[s]}
      team={teamOf(s) === myTeam ? "us" : "them"}
      active={view.phase !== "finished" && (s === me ? myTurnToBid || myTurnToPlay : view.turn === s)}
      layout={layout}
    />
  );

  return (
    <main className="table" ref={root}>
      <ScoreBoard
        us={{ name: `${names[me]} & ${names[partner]}`, ...view.scores[myTeam] }}
        them={{ name: `${names[left]} & ${names[right]}`, ...view.scores[(1 - myTeam) as Team] }}
        hand={view.handNumber + 1}
        playTo={preset.playTo}
        onLeave={() => confirm("Leave this game?") && onLeave()}
      />
      {banner}

      <div className="felt">
        <button type="button" className="sound-toggle" onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? "Turn sounds off" : "Turn sounds on"}>
          {soundOn ? "🔊" : "🔇"}
        </button>
        {settings && <TableSettingsButton settings={settings.value} onChange={settings.change} />}
        {[left, partner, right].map((s) => (
          <div key={s} className={`seat-slot ${side(s)}`}>
            {seat(s)}
          </div>
        ))}

        <div className="trick" aria-label="Cards on the table">
          {t.trickOnTable.map((play) => (
            <div key={cardId(play.card)} className={`played ${side(play.seat)}`}>
              <PlayingCard card={play.card} size="table" won={t.trickWinner === play.seat} data-flip={cardId(play.card)} data-from={`[data-seat="${play.seat}"]`} />
            </div>
          ))}
          {t.trickWinner !== null && <div className="took">{t.trickWinner === t.seat && !t.watching ? "You take it" : `${names[t.trickWinner]} takes it`}</div>}
        </div>

        <div className="status" role="status">
          {t.error ? (
            <span className="error">{t.error}</span>
          ) : myTurnToPlay ? (
            <span className="mine">Your play</span>
          ) : myTurnToBid ? (
            <span className="mine">Your bid</span>
          ) : iPass ? (
            `Pick ${passCount} card${passCount === 1 ? "" : "s"} to pass to ${names[partner]}`
          ) : view.phase === "passing" ? (
            "Swapping cards…"
          ) : view.phase !== "finished" && !t.paused ? (
            `${names[view.turn]} is thinking…`
          ) : null}
        </div>
      </div>

      <section className="me">
        {chat && <TableChat {...chat} />}
        <div className="me-badge">{seat(me, "row")}</div>
        <div
          className={`hand ${handMotion} ${breathe && !dealing ? "breathe" : ""}`}
          role="group"
          aria-label="Your hand"
          style={{ "--n": t.hand?.length ?? view.handCounts[me] ?? 13 } as React.CSSProperties}
        >
          {t.hand === null
            ? Array.from({ length: view.handCounts[me] ?? 13 }, (_, i) => <PlayingCard key={i} back style={{ "--i": i } as React.CSSProperties} />)
            : t.hand.map((card, i) => (
                <PlayingCard
                  key={cardId(card)}
                  data-flip={cardId(card)}
                  style={{ "--i": i } as React.CSSProperties}
                  card={card}
                  playable={myTurnToPlay || iPass}
                  dim={myTurnToPlay && !view.legal.some((c) => sameCard(c, card))}
                  selected={selected.some((c) => sameCard(c, card))}
                  onPick={() => pick(card)}
                />
              ))}
        </div>
      </section>

      {/* Bubbles float above everything, beside the seat that spoke. */}
      <div className="bubble-layer" aria-live="polite">
        {[...bubbles.entries()].map(([s, m]) => (
          <Bubble key={`${s}-${m.at}`} message={m} seat={s} />
        ))}
      </div>

      {myTurnToBid && (
        <div className="sheet">
          <BidPad
            blind={t.hand === null}
            nil={preset.nil.enabled}
            sofar={[left, partner, right].flatMap((s) => (view.bids[s] ? [`${names[s]} ${bidLabel(view.bids[s]!)}`] : [])).join(" · ")}
            onBid={(event) => bid(event.detail as number | "nil" | "blind-nil")}
            onLook={t.look}
          />
        </div>
      )}

      {t.hand === null && view.phase === "bidding" && !myTurnToBid && !t.paused && (
        <div className="peek">
          <button type="button" className="secondary" onClick={t.look}>
            Look at my cards
          </button>
          <span>Don't look yet if you might go blind nil.</span>
        </div>
      )}

      {iPass && (
        <div className="sheet compact">
          <button
            type="button"
            className="primary"
            disabled={selected.length !== passCount}
            onClick={() => {
              void t.act({ type: "pass", cards: selected });
              setSelected([]);
            }}
          >
            Pass {selected.length}/{passCount} to {names[partner]}
          </button>
        </div>
      )}

      {t.summary && view.phase !== "finished" && (
        <div className="sheet">
          <HandSummary heading={`Hand ${t.summary.handNumber + 1}`} rows={summaryRows(t.summary, view, myTeam)} action="Deal the next hand" onNext={t.dismissSummary} />
        </div>
      )}

      {view.phase === "finished" && view.winner === myTeam && <Confetti />}
      {view.phase === "finished" && (
        <div className="sheet won-sheet">
          <h2>{view.winner === myTeam ? "You won!" : `${names[left]} & ${names[right]} won`}</h2>
          <p className="final">
            {view.scores[myTeam].points} – {view.scores[(1 - myTeam) as Team].points} after {view.history.length} hands
          </p>
          <button type="button" className="primary" onClick={onLeave}>
            Play again
          </button>
        </div>
      )}
    </main>
  );
}

function bidLabel(bid: Bid | null) {
  if (!bid) return "—";
  if (bid.kind === "nil") return "Nil";
  if (bid.kind === "blind-nil") return "Blind nil";
  return String(bid.count);
}

const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");

function summaryRows(record: HandRecord, view: SeatView, myTeam: Team) {
  const us = record.results[myTeam];
  const them = record.results[(1 - myTeam) as Team];
  const both = (f: (r: typeof us) => string) => ({ us: f(us), them: f(them) });
  return [
    { label: "Bid / took", ...both((r) => `${r.bid} / ${r.tricks}`) },
    { label: "Nil", ...both((r) => (r.nilPoints === 0 ? "—" : signed(r.nilPoints))) },
    { label: "Bags", ...both((r) => `+${r.bagsTaken}${r.bagPenalty > 0 ? ` (−${r.bagPenalty})` : ""}`) },
    { label: "This hand", tone: "score", ...both((r) => signed(r.delta)) },
    { label: "Score", tone: "total", us: String(view.scores[myTeam].points), them: String(view.scores[(1 - myTeam) as Team].points) },
  ];
}
