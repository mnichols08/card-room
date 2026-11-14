// One table for every game on the card kit. The engine's view says everything: your hand and what
// a tap does, cards to pick, buttons to press, the trick or the piles in the middle, the melds on
// the table, the scores. This only lays it out: others around you, the middle, your hand below.
import {
  kitGame,
  type Center,
  type KCard,
  type KitView,
  type Meld,
} from "@cardroom/games";
import { type TableSettings } from "@spades/rules";
import PlayingCard from "../PlayingCard";
import { useEffect, useRef, useState } from "react";
import { Bubble, TableChat, useBubbles, type ChatProps } from "../Chat";
import { Confetti } from "../Confetti";
import {
  loadFeedbackSettings,
  play,
  saveFeedbackSettings,
} from "../feedback/sounds";
import { lift, motionScale, useCardFlip, useFlash } from "../motion";
import { seatAround } from "../palace/PalaceTable";
import { TableSettingsButton } from "../TableSettings";

export interface KitTableProps {
  view: KitView;
  names: string[];
  /** Resolves to an error message when the move is refused. */
  act: (move: Record<string, unknown>) => Promise<string | null>;
  onLeave: () => void;
  banner?: React.ReactNode;
  chat?: ChatProps;
  settings?: {
    value: TableSettings;
    change: (next: TableSettings) => Promise<void> | void;
  };
  /** Nobody's playing `view.me` from here: the table is being watched. */
  watching?: boolean;
}

/** Engines name seats as {0}, {1}…: put the players' names in. */
/** After "You", the verb agrees: "You win", not "You wins". */
const YOU_VERBS: Record<string, string> = {
  wins: "win",
  takes: "take",
  has: "have",
  is: "are",
  gets: "get",
  pegs: "peg",
  leads: "lead",
  bids: "bid",
  loses: "lose",
  flips: "flip",
  draws: "draw",
  melds: "meld",
  discards: "discard",
  throws: "throw",
  puts: "put",
  keeps: "keep",
  gives: "give",
  swaps: "swap",
  checks: "check",
  calls: "call",
  raises: "raise",
  bets: "bet",
  folds: "fold",
  stands: "stand",
  plays: "play",
  passes: "pass",
  goes: "go",
  makes: "make",
  picks: "pick",
  drinks: "drink",
  says: "say",
  was: "were",
};

export const named = (text: string, names: string[]) =>
  text.replace(
    /\{(\d+)\}('s)?( (\w+))?/g,
    (
      _,
      n: string,
      owns: string | undefined,
      gap: string | undefined,
      word: string | undefined,
      at: number,
    ) => {
      const name = names[Number(n)] ?? `Seat ${Number(n) + 1}`;
      const rest = gap ?? "";
      // "You" mid-sentence reads as "you" ("two cards to you"), and "You's" as "Your" ("your crib").
      const before = text.slice(0, at).trimEnd();
      const start = !before || /[.!?:]$/.test(before);
      if (name !== "You") return `${owns ? `${name}'s` : name}${rest}`;
      if (owns) return `${start ? "Your" : "your"}${rest}`;
      const verb = word && YOU_VERBS[word] ? ` ${YOU_VERBS[word]}` : rest;
      return `${start ? "You" : "you"}${verb}`;
    },
  );

/** "Ann & Cy" for a side of the table. */
const sideName = (seats: number[], names: string[]) =>
  seats.map((s) => names[s] ?? `Seat ${s + 1}`).join(" & ");

export function KitTable({
  view,
  names,
  act,
  onLeave,
  banner,
  chat,
  settings,
  watching,
}: KitTableProps) {
  const game = kitGame(view.game)!;
  const me = view.me;
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [soundOn, setSoundOn] = useState(() => loadFeedbackSettings().sound);
  const bubbles = useBubbles(chat?.messages ?? []);
  const root = useRef<HTMLElement>(null);
  const scale = motionScale(settings?.value.pace);
  useCardFlip(root, scale);
  const others = Array.from(
    { length: view.seats - 1 },
    (_, i) => (me + 1 + i) % view.seats,
  );
  const spots = seatAround(others);
  const myTurn =
    view.turn === me || (view.turn === null && (!!view.pick || !!view.choices || !!view.tap));
  const breathe = useFlash(view.turn === me, 700, false) && view.turn === me;

  // A pick starts empty whenever what's being picked changes.
  const pickKey = view.pick
    ? `${view.phase}:${view.pick.prompt}:${view.pick.cards.join(",")}`
    : "";
  useEffect(() => setPicked([]), [pickKey]);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(t);
  }, [error]);

  // Sounds: a card landing, your turn, the end.
  const centerKey = JSON.stringify(
    view.center.kind === "trick"
      ? view.center.plays.map((p) => p.card.id)
      : view.center.kind === "piles"
        ? [view.center.discardCount, view.center.stock]
        : view.center.kind === "fan"
          ? [view.center.from, view.center.count]
          : [],
  );
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (seen.current !== null && seen.current !== centerKey) play("card");
    seen.current = centerKey;
  }, [centerKey]);
  const turnSeen = useRef(false);
  useEffect(() => {
    if (view.turn === me && !turnSeen.current) play("yourTurn");
    turnSeen.current = view.turn === me;
  }, [view.turn, me]);
  const overSeen = useRef(!!view.over);
  useEffect(() => {
    if (view.over && !overSeen.current)
      play(view.over.winners.includes(me) ? "won" : "lost");
    overSeen.current = !!view.over;
  }, [view.over, me]);

  const send = async (move: Record<string, unknown>, cards: string[] = []) => {
    const putBack = cards.length ? lift(root.current, cards) : () => {};
    const refused = await act(move);
    if (refused) {
      putBack();
      setError(refused);
      play("nope");
    }
  };

  function tapCard(card: KCard) {
    if (view.pick?.cards.includes(card.id)) {
      setPicked((p) =>
        p.includes(card.id)
          ? p.filter((x) => x !== card.id)
          : p.length < view.pick!.max
            ? [...p, card.id]
            : view.pick!.max === 1
              ? [card.id]
              : p,
      );
      return;
    }
    if (view.tap?.cards.includes(card.id))
      void send({ type: view.tap.type, card: card.id }, [card.id]);
    else if (view.tap) {
      setError("You can't play that one now.");
      play("nope");
    }
  }

  function toggleSound() {
    const next = { ...loadFeedbackSettings(), sound: !soundOn };
    saveFeedbackSettings(next);
    setSoundOn(next.sound);
  }

  const status = error ? (
    <span className="error">{error}</span>
  ) : view.over || view.seats === 1 ? null : view.turn === me && !watching ? (
    <span className="mine">
      {view.pick?.prompt || view.gridTap?.prompt || "Your turn"}
    </span>
  ) : view.turn === null && (view.pick || view.gridTap) ? (
    <span className="mine">{view.pick?.prompt ?? view.gridTap?.prompt}</span>
  ) : view.turn === null && view.tap ? (
    <span className="mine">Play, quick!</span>
  ) : view.turn !== null ? (
    `${names[view.turn] ?? "Someone"} is thinking…`
  ) : view.result ? null : (
    "Waiting for everyone…"
  );

  const tappable = new Set([
    ...(view.tap?.cards ?? []),
    ...(view.pick?.cards ?? []),
  ]);
  const pickReady =
    view.pick &&
    picked.length >= view.pick.min &&
    picked.length <= view.pick.max;
  const meldsOf = (seat: number) =>
    view.melds.filter((m) => !m.byTeam && m.owner === seat);
  const gridOf = (seat: number) => view.grids?.find((g) => g.owner === seat);
  const teamMelds = view.melds.filter((m) => m.byTeam);

  return (
    <main className={`table kit kit-${view.game}`} ref={root}>
      <header className="palace-bar kit-bar">
        <button
          type="button"
          className="leave"
          aria-label="Leave game"
          onClick={() =>
            (view.over || confirm("Leave this game?")) && onLeave()
          }
        >
          ←
        </button>
        <div className="kit-scores" aria-label="Scores">
          {view.scores.map((s, i) => (
            <span
              key={i}
              className={`kit-score${s.seats.includes(me) ? " us" : ""}`}
            >
              <small>{sideName(s.seats, names)}</small>
              <strong>{s.value}</strong>
            </span>
          ))}
        </div>
        <span className="bar-buttons">
          {settings && (
            <TableSettingsButton
              settings={settings.value}
              onChange={settings.change}
            />
          )}
          <button
            type="button"
            className="sound-toggle inline"
            onClick={toggleSound}
            aria-pressed={soundOn}
            aria-label={soundOn ? "Turn sounds off" : "Turn sounds on"}
          >
            {soundOn ? "🔊" : "🔇"}
          </button>
        </span>
      </header>
      {banner}

      <div
        className={`felt palace-felt kit-felt${view.seats === 1 ? " solo" : ""}`}
      >
        {(["top", "left", "right"] as const).map((area) => (
          <div key={area} className={`opp-area ${area}`}>
            {spots
              .filter((s) => s.area === area)
              .map(({ seat }) => (
                <div key={seat} className={`opp ${area}`} data-seat={seat}>
                  <KitSeat
                    view={view}
                    seat={seat}
                    name={names[seat] ?? `Seat ${seat + 1}`}
                  />
                  {meldsOf(seat).length > 0 && (
                    <MeldRow melds={meldsOf(seat)} size="mini" names={names} />
                  )}
                  {gridOf(seat) && (
                    <CardGrid grid={gridOf(seat)!} size="mini" />
                  )}
                </div>
              ))}
          </div>
        ))}

        <div className="center">
          <CenterArea
            center={view.center}
            view={view}
            names={names}
            send={send}
          />
          <div className="center-info">
            {view.track && (
              <ScoreTrack track={view.track} view={view} names={names} />
            )}
            {view.info.length > 0 && (
              <ul className="kit-info">
                {view.info.map((line, i) => (
                  <li key={i}>{named(line, names)}</li>
                ))}
              </ul>
            )}
            <p className="narration" aria-live="polite">
              {view.narration ? named(view.narration, names) : null}
            </p>
            <div className="status" role="status">
              {status}
            </div>
            {view.choices && !view.result && (
              <div
                className={`felt-actions kit-choices ${view.choices.layout ?? ""}`}
              >
                {view.choices.prompt && (
                  <p>{named(view.choices.prompt, names)}</p>
                )}
                {view.choices.options.map((o, i) => (
                  <button
                    key={i}
                    type="button"
                    className={o.primary ? "primary" : "secondary"}
                    title={o.hint}
                    onClick={() => void send(o.move)}
                  >
                    {named(o.label, names)}
                  </button>
                ))}
              </div>
            )}
            {view.pick && (
              <div className="felt-actions">
                {view.pick.actions.map((a) => (
                  <button
                    key={`${a.label}-${JSON.stringify(a.extra ?? {})}`}
                    type="button"
                    className={a.primary ? "primary" : "secondary"}
                    disabled={!pickReady}
                    onClick={() => {
                      void send(
                        { type: a.type, ...(a.extra ?? {}), cards: picked },
                        picked,
                      );
                      setPicked([]);
                    }}
                  >
                    {named(a.label, names)}
                    {view.pick!.max > 1 ? ` (${picked.length})` : ""}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {teamMelds.length > 0 && (
          <div className="mine-on-table team-row">
            <TeamMelds melds={teamMelds} view={view} names={names} />
          </div>
        )}
        {gridOf(me) && (
          <div className="mine-on-table">
            <CardGrid
              grid={gridOf(me)!}
              size="table"
              tap={view.gridTap ?? null}
              send={send}
            />
          </div>
        )}
        {meldsOf(me).length > 0 && (
          <div className="mine-on-table">
            <MeldRow melds={meldsOf(me)} size="table" names={names} />
          </div>
        )}
      </div>

      <section className="me" data-seat={me}>
        {chat && <TableChat {...chat} />}
        <div className="me-badge">
          <KitSeat view={view} seat={me} name={names[me] ?? "You"} row />
        </div>
        {view.handHidden === "none" ? null : view.handHidden ? (
          <div
            className="my-pile"
            aria-label={`Your pile: ${view.players[me]?.cards ?? 0} cards, face down`}
          >
            {(view.players[me]?.cards ?? 0) > 0 ? (
              <PlayingCard
                back
                size="table"
                style={
                  {
                    "--depth": Math.min(
                      6,
                      Math.ceil((view.players[me]?.cards ?? 0) / 8),
                    ),
                  } as React.CSSProperties
                }
              />
            ) : view.grids || view.seats === 1 ? null : (
              <div className="empty-slot">Out</div>
            )}
          </div>
        ) : (
          <div
            className={`hand ${breathe ? "breathe" : ""}`}
            role="group"
            aria-label="Your hand"
            style={{ "--n": view.hand.length } as React.CSSProperties}
          >
            {view.hand.map((card, i) => (
              <PlayingCard
                key={card.id}
                data-flip={card.id}
                data-from={
                  view.center.kind === "piles" ? ".kit-stock" : undefined
                }
                style={{ "--i": i } as React.CSSProperties}
                card={card}
                playable={myTurn && tappable.has(card.id)}
                dim={!!view.tap && view.turn === me && !tappable.has(card.id)}
                selected={picked.includes(card.id)}
                onPick={() => tapCard(card)}
              />
            ))}
          </div>
        )}
      </section>

      <div className="bubble-layer" aria-live="polite">
        {[...bubbles.entries()].map(([s, m]) => (
          <Bubble
            key={`${s}-${m.at}`}
            message={m}
            side={
              s === me
                ? "bottom"
                : (spots.find((x) => x.seat === s)?.area ?? "top")
            }
          />
        ))}
      </div>

      {view.result && !view.over && (
        <div className="sheet">
          <ResultTable result={view.result} names={names} me={me} />
          {view.choices ? (
            view.choices.options.map((o, i) => (
              <button
                key={i}
                type="button"
                className={o.primary ? "primary" : "secondary"}
                onClick={() => void send(o.move)}
              >
                {named(o.label, names)}
              </button>
            ))
          ) : (
            <p className="fine">Waiting for everyone…</p>
          )}
        </div>
      )}
      {view.over && view.over.winners.includes(me) && <Confetti />}
      {view.over && (
        <div className="sheet won-sheet">
          <h2>
            {view.over.winners.includes(me)
              ? view.teams
                ? "You won! 🎉"
                : "You won! 🏆"
              : named(view.over.title, names)}
          </h2>
          {view.over.winners.includes(me) &&
            !view.result &&
            !view.over.title.includes(`{${me}}`) && (
              <p className="won-line">{named(view.over.title, names)}</p>
            )}
          {view.result && (
            <ResultTable result={view.result} names={names} me={me} untitled />
          )}
          <button type="button" className="primary" onClick={onLeave}>
            Play again
          </button>
        </div>
      )}
      <p className="sr-only">{game.name}</p>
    </main>
  );
}

/** A player at the table: name, their line ("Bid 3 · Took 1"), cards held, dealer and turn. */
function KitSeat({
  view,
  seat,
  name,
  row,
}: {
  view: KitView;
  seat: number;
  name: string;
  row?: boolean;
}) {
  const p = view.players[seat]!;
  const active = view.turn === seat && !view.over;
  const team = view.teams ? (seat % 2 === view.me % 2 ? "us" : "them") : "";
  return (
    <div
      className={`kit-seat ${team}${active ? " active" : ""}${p.out ? " out" : ""}${row ? " row" : ""}`}
      aria-current={active ? "true" : undefined}
    >
      <strong>
        {name}
        {p.dealer && (
          <span className="dealer" title="Dealer">
            D
          </span>
        )}
      </strong>
      {p.line && <span>{named(p.line, [])}</span>}
      {!row && !view.grids && p.cards > 0 && (
        <small>
          {p.cards} card{p.cards === 1 ? "" : "s"}
        </small>
      )}
      {p.badge && <em>{p.badge}</em>}
    </div>
  );
}

/** The middle of the table: a trick laid toward each player, or the stock and discard piles. */
function CenterArea({
  center,
  view,
  names,
  send,
}: {
  center: Center;
  view: KitView;
  names: string[];
  send: (move: Record<string, unknown>) => void;
}) {
  if (center.kind === "trick") {
    // Nothing played yet and melds on show (Pinochle's meld): leave the room to the melds.
    if (!center.plays.length && view.melds.length) return null;
    const n = view.seats;
    return (
      <div className="kit-trick" aria-label="Cards on the table">
        {center.plays.map((p) => {
          // Each card sits toward the player who played it: you at the bottom, then round to your left.
          const k = (p.seat - view.me + n) % n;
          const angle = (k * 2 * Math.PI) / n;
          return (
            <div
              key={p.card.id}
              className="kit-played"
              style={
                {
                  "--x": (-Math.sin(angle)).toFixed(3),
                  "--y": Math.cos(angle).toFixed(3),
                  "--tilt": `${((k * 7) % 11) - 5}deg`,
                } as React.CSSProperties
              }
            >
              <PlayingCard
                card={p.card}
                size="table"
                won={center.winner === p.seat}
                data-flip={p.card.id}
                data-from={`[data-seat="${p.seat}"]`}
              />
            </div>
          );
        })}
        {center.winner !== null && (
          <div className="took">
            {center.winner === view.me
              ? "You take it"
              : `${names[center.winner]} takes it`}
          </div>
        )}
        {center.lead && <div className="kit-lead">{center.lead}</div>}
      </div>
    );
  }
  if (center.kind === "solitaire")
    return <SolitaireArea center={center} send={send} />;
  if (center.kind === "cross") return <CrossArea center={center} send={send} />;
  if (center.kind === "board")
    return (
      <div className="board-area" style={{ "--cols": center.cols } as React.CSSProperties}>
        <CardGrid grid={{ cols: center.cols, cards: center.cards, empty: center.empty }} size="table" tap={center.tap} send={send} />
      </div>
    );
  if (center.kind === "pairs") {
    return (
      <div className="pairs-area">
        <div className="pairs-stock" aria-label={`${center.stock} to draw, ${center.trumpLabel}`}>
          {center.trumpCard && (
            <span className="pairs-trump">
              <PlayingCard card={center.trumpCard} size="table" />
            </span>
          )}
          {center.stock > (center.trumpCard ? 1 : 0) && (
            <span className="pairs-deck">
              <PlayingCard back size="table" />
            </span>
          )}
          <small>{center.stock ? `${center.stock} to draw · ${center.trumpLabel}` : center.trumpLabel}</small>
        </div>
        <div className="pairs" aria-label="The attack">
          {center.pairs.length ? (
            center.pairs.map((p) => (
              <div key={p.attack.id} className={`pair${p.defense ? " beaten" : ""}`}>
                <PlayingCard card={p.attack} size="table" data-flip={p.attack.id} />
                {p.defense && (
                  <span className="pair-defense">
                    <PlayingCard card={p.defense} size="table" data-flip={p.defense.id} />
                  </span>
                )}
              </div>
            ))
          ) : (
            <div className="empty-slot">{center.discards ? `${center.discards} beaten off` : ""}</div>
          )}
        </div>
      </div>
    );
  }
  if (center.kind === "fan") {
    // Their hand, face down and fanned: tap the card you want.
    const n = center.count;
    return (
      <div
        className="kit-fan-area"
        aria-label={center.label ? named(center.label, names) : "Their cards"}
      >
        <div
          className="kit-fan"
          data-from={`[data-seat="${center.from}"]`}
          style={{ "--n": n } as React.CSSProperties}
        >
          {Array.from({ length: n }, (_, i) => {
            const tilt = n > 1 ? (i / (n - 1) - 0.5) * Math.min(40, n * 4) : 0;
            const style = {
              "--tilt": `${tilt.toFixed(1)}deg`,
              "--lift": `${(Math.abs(tilt) * 0.35).toFixed(1)}px`,
            } as React.CSSProperties;
            return center.takeType ? (
              <button
                key={i}
                type="button"
                className="kit-fan-card pile-button"
                style={style}
                aria-label={`Take card ${i + 1} of ${n}`}
                onClick={() => send({ type: center.takeType!, index: i })}
              >
                <PlayingCard back size="table" />
              </button>
            ) : (
              <span key={i} className="kit-fan-card" style={style}>
                <PlayingCard back size="table" />
              </span>
            );
          })}
        </div>
        {center.label && <small>{named(center.label, names)}</small>}
      </div>
    );
  }
  if (center.kind === "piles") {
    const top = center.discard.slice(-3);
    return (
      <div className="pile-area kit-piles" aria-label="The piles">
        <div className="deck kit-stock">
          {center.stock === null ? null : center.stock > 0 ? (
            center.drawMove ? (
              <button
                type="button"
                className="pile-button"
                aria-label={`Draw a card (${center.stock} left)`}
                onClick={() => send(center.drawMove!)}
              >
                <PlayingCard
                  back
                  size="table"
                  style={
                    {
                      "--depth": Math.min(6, Math.ceil(center.stock / 8)),
                    } as React.CSSProperties
                  }
                />
              </button>
            ) : (
              <PlayingCard
                back
                size="table"
                style={
                  {
                    "--depth": Math.min(6, Math.ceil(center.stock / 8)),
                  } as React.CSSProperties
                }
              />
            )
          ) : (
            <div className="empty-slot">Empty</div>
          )}
          {center.stock !== null && (
            <small>{center.stockLabel ?? `${center.stock} to draw`}</small>
          )}
        </div>
        {center.held && (
          <div className="held-card">
            <PlayingCard
              card={center.held}
              size="table"
              won
              data-flip={center.held.id}
              data-from=".kit-stock"
            />
            <small>
              {center.heldLabel ? named(center.heldLabel, names) : "Drawn"}
            </small>
          </div>
        )}
        {center.spread && (
          <div className="pile pile-spread-area">
            {center.discard.length + (center.spreadHidden ?? 0) ? (
              <div
                className="pile-spread"
                style={{ "--n": center.discard.length } as React.CSSProperties}
              >
                {center.discard.map((c) =>
                  center.spread!.cards.includes(c.id) ? (
                    <button
                      key={c.id}
                      type="button"
                      className="spread-card pile-button"
                      aria-label={`Take the pile from here`}
                      onClick={() =>
                        send({ type: center.spread!.type, card: c.id })
                      }
                    >
                      <PlayingCard card={c} size="table" data-flip={c.id} />
                    </button>
                  ) : (
                    <span key={c.id} className="spread-card">
                      <PlayingCard card={c} size="table" data-flip={c.id} />
                    </span>
                  ),
                )}
                {Array.from({ length: center.spreadHidden ?? 0 }, (_, i) => (
                  <span key={`hidden-${i}`} className="spread-card">
                    <PlayingCard back size="table" />
                  </span>
                ))}
              </div>
            ) : (
              <div className="empty-slot">
                {center.discardLabel ? "" : "Discards"}
              </div>
            )}
            <small>
              {center.discardLabel
                ? named(center.discardLabel, names)
                : `${center.discardCount} in the pile`}
            </small>
          </div>
        )}
        {center.faceDown && (
          <div className="pile">
            {center.discardCount ? (
              <div className="pile-stack">
                {Array.from(
                  { length: Math.min(3, center.discardCount) },
                  (_, i) => (
                    <div
                      key={`${center.discardCount}-${i}`}
                      className="pile-card"
                      style={{ "--i": i } as React.CSSProperties}
                    >
                      <PlayingCard back size="table" />
                    </div>
                  ),
                )}
              </div>
            ) : (
              <div className="empty-slot">Pile</div>
            )}
            <small>
              {center.discardLabel
                ? named(center.discardLabel, names)
                : `${center.discardCount} in the pile`}
            </small>
          </div>
        )}
        {!center.noDiscard && !center.spread && !center.faceDown && (
          <div className="pile">
            {top.length ? (
              <div className="pile-stack">
                {top.map((c, i) => {
                  const isTop = i === top.length - 1;
                  const card = (
                    <PlayingCard card={c} size="table" data-flip={c.id} />
                  );
                  return (
                    <div
                      key={c.id}
                      className="pile-card"
                      style={{ "--i": i } as React.CSSProperties}
                    >
                      {isTop && center.takeMove ? (
                        <button
                          type="button"
                          className="pile-button"
                          aria-label={`Take the discard pile (${center.discardCount})`}
                          onClick={() => send(center.takeMove!)}
                        >
                          {card}
                        </button>
                      ) : (
                        card
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="empty-slot">
                {center.discardLabel ? "" : "Discards"}
              </div>
            )}
            <small>
              {center.discardLabel
                ? named(center.discardLabel, names)
                : `${center.discardCount} in the pile`}
              {center.note ? ` · ${named(center.note, names)}` : ""}
            </small>
          </div>
        )}
      </div>
    );
  }
  return null;
}

/** A solitaire layout: stock, turned cards, free cells, foundations, then the columns. Tap a card to move it. */
function SolitaireArea({
  center,
  send,
}: {
  center: Extract<Center, { kind: "solitaire" }>;
  send: (move: Record<string, unknown>) => void;
}) {
  const can = new Set(center.tap?.cards ?? []);
  const cols = center.columns.length;
  const tapCard = (c: KCard, last: boolean, i: number) =>
    can.has(c.id) ? (
      <button
        key={c.id}
        type="button"
        className={`sol-card${last ? " last" : ""}`}
        style={{ "--i": i } as React.CSSProperties}
        aria-label={`Move the ${c.kind === "pip" ? c.rank : "card"}`}
        onClick={() => send({ type: center.tap!.type, card: c.id })}
      >
        <PlayingCard card={c} size="table" data-flip={c.id} />
      </button>
    ) : (
      <span
        key={c.id}
        className={`sol-card${last ? " last" : ""}`}
        style={{ "--i": i } as React.CSSProperties}
      >
        <PlayingCard card={c} size="table" data-flip={c.id} />
      </span>
    );
  const slot = (label: string, key: string) => (
    <div key={key} className="sol-slot" aria-label={label}>
      <span>{label}</span>
    </div>
  );
  const SUIT_MARKS = ["♠", "♥", "♦", "♣"];
  return (
    <div className="sol" style={{ "--cols": cols } as React.CSSProperties}>
      <div className="sol-top">
        {center.stock !== null && (
          <div className="sol-stock">
            {center.stock > 0 ? (
              center.drawMove ? (
                <button
                  type="button"
                  className="sol-card"
                  aria-label={`Turn the stock (${center.stock} left)`}
                  onClick={() => send(center.drawMove!)}
                >
                  <PlayingCard back size="table" />
                </button>
              ) : (
                <PlayingCard back size="table" />
              )
            ) : center.drawMove ? (
              <button
                type="button"
                className="sol-slot again"
                aria-label="Turn the pile over"
                onClick={() => send(center.drawMove!)}
              >
                <span>↻</span>
              </button>
            ) : (
              slot("", "stock-empty")
            )}
            {center.stockLabel && <small>{center.stockLabel}</small>}
          </div>
        )}
        {center.stock !== null && (
          <div className="sol-waste">
            {center.waste.map((c, i) =>
              tapCard(c, i === center.waste.length - 1, i),
            )}
          </div>
        )}
        {center.cells && (
          <div className="sol-cells">
            {center.cells.map((c, i) =>
              c ? tapCard(c, true, 0) : slot("", `cell-${i}`),
            )}
          </div>
        )}
        <div className="sol-found">
          {center.foundations.map((c, i) =>
            c ? (
              <span key={i} className="sol-card">
                <PlayingCard card={c} size="table" data-flip={c.id} />
              </span>
            ) : (
              slot(center.foundationLabels?.[i] ?? SUIT_MARKS[i] ?? "", `f-${i}`)
            ),
          )}
        </div>
      </div>
      <div className="sol-cols">
        {center.columns.map((col, ci) => (
          <div key={ci} className="sol-col" aria-label={`Column ${ci + 1}`}>
            {col.down === 0 && col.up.length === 0 && slot("", `col-${ci}`)}
            {Array.from({ length: col.down }, (_, i) => (
              <span key={`d${i}`} className="sol-card down">
                <PlayingCard back size="table" />
              </span>
            ))}
            {col.up.map((c, i) => tapCard(c, i === col.up.length - 1, i))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Piles in a cross round the stock, corners on the diagonals (Kings in the Corner). */
function CrossArea({
  center,
  send,
}: {
  center: Extract<Center, { kind: "cross" }>;
  send: (move: Record<string, unknown>) => void;
}) {
  const AREAS = ["n", "e", "s", "w", "nw", "ne", "se", "sw"];
  return (
    <div className={`cross${center.layout === "row" ? " row" : ""}`}>
      <div className="cross-stock" aria-label={`${center.stock} to draw`}>
        {center.stock > 0 ? <PlayingCard back size="table" /> : <div className="sol-slot" />}
        <small>{center.stock ? `${center.stock} to draw` : "None to draw"}</small>
      </div>
      {center.piles.map((p, i) => {
        const top = p.cards[p.cards.length - 1];
        const bottom = p.cards.length > 1 ? p.cards[0] : null;
        const body = top ? (
          <>
            {bottom && (
              <span className="cross-under">
                <PlayingCard card={bottom} size="table" />
              </span>
            )}
            <span className="cross-top">
              <PlayingCard card={top} size="table" data-flip={top.id} />
            </span>
            {p.cards.length > 2 && <small className="cross-count">{p.cards.length}</small>}
            {p.note && <small className="cross-count">{p.note}</small>}
          </>
        ) : (
          <div className="sol-slot">
            <span>{p.empty ?? ""}</span>
          </div>
        );
        return p.move ? (
          <button
            key={i}
            type="button"
            className={`cross-pile can${bottom ? " deep" : ""}`}
            style={center.layout === "row" ? undefined : { gridArea: AREAS[i] }}
            aria-label={p.label}
            onClick={() => send(p.move!)}
          >
            {body}
          </button>
        ) : (
          <div key={i} className={`cross-pile${bottom ? " deep" : ""}`} style={center.layout === "row" ? undefined : { gridArea: AREAS[i] }} aria-label={p.label}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** A pegging track: a lane per side, holes every five, the back peg and the front peg. */
function ScoreTrack({
  track,
  view,
  names,
}: {
  track: NonNullable<KitView["track"]>;
  view: KitView;
  names: string[];
}) {
  const at = (n: number) => `${(Math.min(n, track.to) / track.to) * 100}%`;
  return (
    <div className="score-track" aria-label="The board">
      {track.pegs.map((p, i) => (
        <div
          key={i}
          className={`track-lane${p.seats.includes(view.me) ? " us" : ""}`}
        >
          <span className="track-name">{sideName(p.seats, names)}</span>
          <div
            className="track-bar"
            style={{ "--holes": track.to / 5 } as React.CSSProperties}
          >
            <span className="peg back" style={{ left: at(p.back) }} />
            <span className="peg front" style={{ left: at(p.value) }} />
          </div>
          <strong>{p.value}</strong>
        </div>
      ))}
    </div>
  );
}

/** Cards laid out in rows and columns in front of a player (Golf); null is face down. */
function CardGrid({
  grid,
  size,
  tap,
  send,
}: {
  grid: { cols: number; cards: (KCard | null)[]; empty?: number[] };
  size: "mini" | "table";
  tap?: { type: string; cells: number[] } | null;
  send?: (move: Record<string, unknown>) => void;
}) {
  return (
    <div
      className={`card-grid ${size}`}
      style={{ "--cols": grid.cols } as React.CSSProperties}
      aria-label="Cards on the table"
    >
      {grid.cards.map((c, i) => {
        const blank = grid.empty?.includes(i);
        const face = blank ? (
          <span className={`grid-empty ${size}`} />
        ) : c ? (
          <PlayingCard card={c} size={size} data-flip={c.id} />
        ) : (
          <PlayingCard back size={size} />
        );
        return tap?.cells.includes(i) && send ? (
          <button
            key={i}
            type="button"
            className="grid-cell pile-button"
            aria-label={
              blank ? `Empty space ${i + 1}` : c ? `Your card ${i + 1}` : `Your face-down card ${i + 1}`
            }
            onClick={() => send({ type: tap.type, index: i })}
          >
            {face}
          </button>
        ) : (
          <span key={i} className="grid-cell">
            {face}
          </span>
        );
      })}
    </div>
  );
}

/** Melds in a row: each meld a little fan of cards with its label. */
function MeldRow({
  melds,
  size,
  names,
}: {
  melds: Meld[];
  size: "mini" | "table";
  names: string[];
}) {
  return (
    <div className={`kit-melds ${size}`}>
      {melds.map((m, i) => (
        <div key={i} className="kit-meld" aria-label={m.label ?? "Meld"}>
          <div className="kit-meld-cards">
            {m.cards.map((c) => (
              <PlayingCard key={c.id} card={c} size={size} data-flip={c.id} />
            ))}
          </div>
          {m.label && <small>{named(m.label, names)}</small>}
        </div>
      ))}
    </div>
  );
}

/** Partnership melds (Canasta): yours and theirs, each under the team's names. */
function TeamMelds({
  melds,
  view,
  names,
}: {
  melds: Meld[];
  view: KitView;
  names: string[];
}) {
  const mine = (view.me % 2) as 0 | 1;
  return (
    <div className="kit-team-melds">
      {([mine, (1 - mine) as 0 | 1] as const).map((team) => {
        const list = melds.filter((m) => m.owner === team);
        return (
          <section key={team} className={team === mine ? "us" : "them"}>
            <h3>{sideName([team, team + 2], names)}</h3>
            {list.length ? (
              <MeldRow melds={list} size="mini" names={names} />
            ) : (
              <p className="fine">No melds yet</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ResultTable({
  result,
  names,
  me,
  untitled,
}: {
  result: NonNullable<KitView["result"]>;
  names: string[];
  me: number;
  untitled?: boolean;
}) {
  return (
    <>
      {!untitled && <h2>{named(result.title, names)}</h2>}
      <table className="summary">
        <thead>
          <tr>
            <th scope="col" />
            {result.sides.map((seats, i) => (
              <th
                key={i}
                scope="col"
                className={seats.includes(me) ? "us" : ""}
              >
                {sideName(seats, names)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row) => (
            <tr key={row.label} className={row.tone === "total" ? "total" : ""}>
              <th scope="row">{row.label}</th>
              {row.values.map((v, i) => (
                <td
                  key={i}
                  className={
                    row.tone === "score"
                      ? v.startsWith("-") || v.startsWith("−")
                        ? "neg"
                        : "pos"
                      : ""
                  }
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
