import { cardId, passingSeats, sameCard, type Bid, type Card, type HandRecord, type RulePreset, type Seat } from "@spades/rules";
import BidPad from "@spades/ui/bid-pad.zb";
import HandSummary from "@spades/ui/hand-summary.zb";
import PlayingCard from "@spades/ui/playing-card.zb";
import ScoreBoard from "@spades/ui/score-board.zb";
import SeatBadge from "@spades/ui/seat-badge.zb";
import { useState } from "react";
import { HUMAN, useLocalGame } from "./useLocalGame";

interface Props {
  name: string;
  preset: RulePreset;
  seed: number;
  onLeave: () => void;
}

type Game = ReturnType<typeof useLocalGame>["game"];

const POSITION: Record<Seat, "bottom" | "left" | "top" | "right"> = { 0: "bottom", 1: "left", 2: "top", 3: "right" };

export function Table({ name, preset, seed, onLeave }: Props) {
  const g = useLocalGame(preset, seed);
  const { game, view } = g;
  const names: Record<Seat, string> = { 0: name, 1: "Hank", 2: "Dot", 3: "Lou" };
  const [selected, setSelected] = useState<Card[]>([]);

  const myTurnToBid = game.phase === "bidding" && game.turn === HUMAN && !g.paused;
  const myTurnToPlay = game.phase === "playing" && game.turn === HUMAN && !g.paused;
  const iPass = game.phase === "passing" && passingSeats(game).includes(HUMAN) && !game.passes[HUMAN];
  const passCount = preset.blindNil.passCards;

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
    if (myTurnToPlay) g.act({ type: "play", seat: HUMAN, card });
  }

  function bid(detail: number | "nil" | "blind-nil") {
    const choice: Bid = typeof detail === "number" ? { kind: "tricks", count: detail } : { kind: detail };
    g.act({ type: "bid", seat: HUMAN, bid: choice });
  }

  const seat = (s: Seat, layout: "row" | "column" = "column") => (
    <SeatBadge
      name={names[s]}
      bid={bidLabel(game.bids[s] ?? null)}
      tricks={game.tricksWon[s]}
      team={s % 2 === 0 ? "us" : "them"}
      active={game.phase !== "finished" && (s === HUMAN ? myTurnToBid || myTurnToPlay : game.turn === s)}
      layout={layout}
    />
  );

  return (
    <main className="table">
      <ScoreBoard
        us={{ name: `${names[0]} & ${names[2]}`, ...game.scores[0] }}
        them={{ name: `${names[1]} & ${names[3]}`, ...game.scores[1] }}
        hand={game.handNumber + 1}
        playTo={game.preset.playTo}
        onLeave={() => confirm("Leave this game?") && onLeave()}
      />

      <div className="felt">
        {([1, 2, 3] as Seat[]).map((s) => (
          <div key={s} className={`seat-slot ${POSITION[s]}`}>
            {seat(s)}
          </div>
        ))}

        <div className="trick" aria-label="Cards on the table">
          {g.trickOnTable.map((play) => (
            <div key={cardId(play.card)} className={`played ${POSITION[play.seat]}`}>
              <PlayingCard card={play.card} size="table" won={g.trickWinner === play.seat} />
            </div>
          ))}
          {g.trickWinner !== null && <div className="took">{names[g.trickWinner]} takes it</div>}
        </div>

        <div className="status" role="status">
          {g.error ? (
            <span className="error">{g.error}</span>
          ) : myTurnToPlay ? (
            "Your play"
          ) : myTurnToBid ? (
            "Your bid"
          ) : iPass ? (
            `Pick ${passCount} card${passCount === 1 ? "" : "s"} to pass to ${names[2]}`
          ) : game.phase === "passing" ? (
            "Swapping cards…"
          ) : game.phase !== "finished" && !g.paused ? (
            `${names[game.turn]} is thinking…`
          ) : null}
        </div>
      </div>

      <section className="me">
        <div className="me-badge">{seat(HUMAN, "row")}</div>
        <div className="hand" role="group" aria-label="Your hand">
          {view.hand === null
            ? Array.from({ length: 13 }, (_, i) => <PlayingCard key={i} back />)
            : view.hand.map((card) => (
                <PlayingCard
                  key={cardId(card)}
                  card={card}
                  playable={myTurnToPlay || iPass}
                  dim={myTurnToPlay && !view.legal.some((c) => sameCard(c, card))}
                  selected={selected.some((c) => sameCard(c, card))}
                  onPick={() => pick(card)}
                />
              ))}
        </div>
      </section>

      {myTurnToBid && (
        <div className="sheet">
          <BidPad
            blind={view.hand === null}
            nil={preset.nil.enabled}
            sofar={([1, 2, 3] as Seat[]).flatMap((s) => (game.bids[s] ? [`${names[s]} ${bidLabel(game.bids[s]!)}`] : [])).join(" · ")}
            onBid={(event: CustomEvent<number | "nil" | "blind-nil">) => bid(event.detail)}
            onLook={g.look}
          />
        </div>
      )}

      {view.hand === null && game.phase === "bidding" && !myTurnToBid && !g.paused && (
        <div className="peek">
          <button type="button" className="secondary" onClick={g.look}>
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
              g.act({ type: "pass", seat: HUMAN, cards: selected });
              setSelected([]);
            }}
          >
            Pass {selected.length}/{passCount} to {names[2]}
          </button>
        </div>
      )}

      {g.summary && game.phase !== "finished" && (
        <div className="sheet">
          <HandSummary heading={`Hand ${g.summary.handNumber + 1}`} rows={summaryRows(g.summary, game)} action="Deal the next hand" onNext={g.dismissSummary} />
        </div>
      )}

      {game.phase === "finished" && (
        <div className="sheet">
          <h2>{game.winner === 0 ? "You won!" : `${names[1]} & ${names[3]} won`}</h2>
          <p className="final">
            {game.scores[0].points} – {game.scores[1].points} after {game.history.length} hands
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

function summaryRows(record: HandRecord, game: Game) {
  const [us, them] = record.results;
  const both = (f: (r: typeof us) => string) => ({ us: f(us), them: f(them) });
  return [
    { label: "Bid / took", ...both((r) => `${r.bid} / ${r.tricks}`) },
    { label: "Nil", ...both((r) => (r.nilPoints === 0 ? "—" : signed(r.nilPoints))) },
    { label: "Bags", ...both((r) => `+${r.bagsTaken}${r.bagPenalty > 0 ? ` (−${r.bagPenalty})` : ""}`) },
    { label: "This hand", tone: "score", ...both((r) => signed(r.delta)) },
    { label: "Score", tone: "total", us: String(game.scores[0].points), them: String(game.scores[1].points) },
  ];
}
