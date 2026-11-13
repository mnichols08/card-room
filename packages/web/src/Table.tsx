import { cardId, passingSeats, sameCard, type Bid, type Card, type HandRecord, type RulePreset, type Seat } from "@spades/rules";
import { useState } from "react";
import { CardBack, CardView } from "./CardView";
import { HUMAN, useLocalGame } from "./useLocalGame";

interface Props {
  name: string;
  preset: RulePreset;
  seed: number;
  onLeave: () => void;
}

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

  function tapCard(card: Card) {
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

  return (
    <main className="table">
      <Scoreboard game={game} names={names} onLeave={onLeave} />

      <div className="felt">
        {([1, 2, 3] as Seat[]).map((seat) => (
          <SeatBadge key={seat} seat={seat} name={names[seat]} bid={game.bids[seat] ?? null} tricks={game.tricksWon[seat]!} active={game.turn === seat && game.phase !== "finished"} cards={view.handCounts[seat]!} />
        ))}

        <div className="trick" aria-label="Cards on the table">
          {g.trickOnTable.map((play) => (
            <div key={cardId(play.card)} className={`played ${POSITION[play.seat]} ${g.trickWinner === play.seat ? "won" : ""}`}>
              <CardView card={play.card} size="table" />
            </div>
          ))}
          {g.trickWinner !== null && <div className="took">{names[g.trickWinner]} takes it</div>}
        </div>

        <div className="status">
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
        <SeatBadge seat={HUMAN} name={names[HUMAN]} bid={game.bids[HUMAN] ?? null} tricks={game.tricksWon[HUMAN]!} active={myTurnToBid || myTurnToPlay} />
        <div className="hand" role="group" aria-label="Your hand">
          {view.hand === null
            ? Array.from({ length: 13 }, (_, i) => <CardBack key={i} />)
            : view.hand.map((card) => {
                const legal = !myTurnToPlay || view.legal.some((c) => sameCard(c, card));
                return (
                  <CardView
                    key={cardId(card)}
                    card={card}
                    disabled={myTurnToPlay && !legal}
                    selected={selected.some((c) => sameCard(c, card))}
                    onClick={myTurnToPlay || iPass ? () => tapCard(card) : undefined}
                  />
                );
              })}
        </div>
      </section>

      {myTurnToBid && (
        <BidPanel
          hidden={view.hand === null}
          preset={preset}
          bidsSoFar={([1, 2, 3] as Seat[]).flatMap((seat) => (game.bids[seat] ? [`${names[seat]} ${bidLabel(game.bids[seat]!)}`] : []))}
          onLook={g.look}
          onBid={(bid) => g.act({ type: "bid", seat: HUMAN, bid })}
        />
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

      {g.summary && game.phase !== "finished" && <HandSummary record={g.summary} game={game} onNext={g.dismissSummary} />}
      {game.phase === "finished" && <GameOver game={game} names={names} onAgain={onLeave} />}
    </main>
  );
}

function bidLabel(bid: Bid | null) {
  if (!bid) return "—";
  if (bid.kind === "nil") return "Nil";
  if (bid.kind === "blind-nil") return "Blind nil";
  return String(bid.count);
}

function SeatBadge(props: { seat: Seat; name: string; bid: Bid | null; tricks: number; active: boolean; cards?: number }) {
  return (
    <div className={`seat ${POSITION[props.seat]} ${props.active ? "active" : ""} ${props.seat % 2 === 0 ? "us" : "them"}`}>
      <strong>{props.name}</strong>
      <span>
        Bid {bidLabel(props.bid)} · Took {props.tricks}
      </span>
    </div>
  );
}

function Scoreboard({ game, names, onLeave }: { game: ReturnType<typeof useLocalGame>["game"]; names: Record<Seat, string>; onLeave: () => void }) {
  return (
    <header className="scoreboard">
      <button type="button" className="link leave" onClick={() => confirm("Leave this game?") && onLeave()} aria-label="Leave game">
        ←
      </button>
      <div className="team us">
        <span>
          {names[0]} &amp; {names[2]}
        </span>
        <strong>{game.scores[0].points}</strong>
        <small>{bags(game.scores[0].bags)}</small>
      </div>
      <div className="target">
        <small>Hand {game.handNumber + 1}</small>
        <small>to {game.preset.playTo}</small>
      </div>
      <div className="team them">
        <span>
          {names[1]} &amp; {names[3]}
        </span>
        <strong>{game.scores[1].points}</strong>
        <small>{bags(game.scores[1].bags)}</small>
      </div>
    </header>
  );
}

function BidPanel(props: {
  hidden: boolean;
  preset: RulePreset;
  bidsSoFar: string[];
  onLook: () => void;
  onBid: (bid: Bid) => void;
}) {
  if (props.hidden) {
    return (
      <div className="sheet">
        <h2>Your bid</h2>
        <p>You haven't looked at your cards. You can bid blind nil now, or look first.</p>
        <div className="sheet-actions">
          <button type="button" className="primary" onClick={() => props.onBid({ kind: "blind-nil" })}>
            Blind nil
          </button>
          <button type="button" className="secondary" onClick={props.onLook}>
            Look at my cards
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="sheet">
      <h2>Your bid</h2>
      {props.bidsSoFar.length > 0 && <p>So far: {props.bidsSoFar.join(" · ")}</p>}
      <div className="bids">
        {Array.from({ length: 13 }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" onClick={() => props.onBid({ kind: "tricks", count: n })}>
            {n}
          </button>
        ))}
        {props.preset.nil.enabled && (
          <button type="button" className="nil" onClick={() => props.onBid({ kind: "nil" })}>
            Nil
          </button>
        )}
      </div>
    </div>
  );
}

function HandSummary({ record, game, onNext }: { record: HandRecord; game: ReturnType<typeof useLocalGame>["game"]; onNext: () => void }) {
  return (
    <div className="sheet">
      <h2>Hand {record.handNumber + 1}</h2>
      <table className="summary">
        <thead>
          <tr>
            <th />
            <th>Us</th>
            <th>Them</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Bid / took</th>
            {record.results.map((r) => (
              <td key={r.team}>
                {r.bid} / {r.tricks}
              </td>
            ))}
          </tr>
          <tr>
            <th>Nil</th>
            {record.results.map((r) => (
              <td key={r.team}>{r.nilPoints === 0 ? "—" : signed(r.nilPoints)}</td>
            ))}
          </tr>
          <tr>
            <th>Bags</th>
            {record.results.map((r) => (
              <td key={r.team}>
                +{r.bagsTaken}
                {r.bagPenalty > 0 && <em> (−{r.bagPenalty})</em>}
              </td>
            ))}
          </tr>
          <tr>
            <th>This hand</th>
            {record.results.map((r) => (
              <td key={r.team} className={r.delta < 0 ? "neg" : "pos"}>
                {signed(r.delta)}
              </td>
            ))}
          </tr>
          <tr className="total">
            <th>Score</th>
            {game.scores.map((s, i) => (
              <td key={i}>{s.points}</td>
            ))}
          </tr>
        </tbody>
      </table>
      <button type="button" className="primary" onClick={onNext}>
        Deal the next hand
      </button>
    </div>
  );
}

function GameOver({ game, names, onAgain }: { game: ReturnType<typeof useLocalGame>["game"]; names: Record<Seat, string>; onAgain: () => void }) {
  const won = game.winner === 0;
  return (
    <div className="sheet">
      <h2>{won ? "You won!" : `${names[1]} & ${names[3]} won`}</h2>
      <p className="final">
        {game.scores[0].points} – {game.scores[1].points} after {game.history.length} hands
      </p>
      <button type="button" className="primary" onClick={onAgain}>
        Play again
      </button>
    </div>
  );
}

const bags = (n: number) => `${n} bag${n === 1 ? "" : "s"}`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
