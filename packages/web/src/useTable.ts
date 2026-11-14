import { canBidBlindNil, type Action, type GameState, type HandRecord, type Seat, type SeatView } from "@spades/rules";
import { useEffect, useRef, useState } from "react";

/** A move as the table sends it: the seat is filled in by whoever decides it (the local game or the server). */
export type Move = Action extends infer A ? (A extends { seat: Seat } ? Omit<A, "seat"> : never) : never;

/** Where a table's game comes from: a local game with bots, or a room on the server. */
export interface TableSource {
  view: SeatView | null;
  seat: Seat;
  /** Resolves to an error message when the move is refused. */
  act: (move: Move) => Promise<string | null>;
  /** Nobody's playing this seat from here: the table is being watched. */
  watching?: boolean;
}

export const TRICK_HOLD_MS = 1200;

/** Whether this seat could still bid blind nil (the view has the scores and the rules it needs). */
export const blindNilAllowed = (view: SeatView, seat: Seat) => canBidBlindNil(view as unknown as GameState, seat);

/** Pacing shared by every table: hold each finished trick a moment, show each hand's score, and keep cards face down until you look. */
export function useTable(source: TableSource) {
  const { view, seat } = source;
  const [heldTrick, setHeldTrick] = useState<SeatView["lastTrick"]>(null);
  const [summary, setSummary] = useState<HandRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookedAtHand, setLookedAtHand] = useState<number | null>(null);

  // Hold each finished trick so people see who took it. Keyed by the trick's contents: a view from
  // the server is a fresh object on every update, and re-running on each one would cancel the
  // timer that ends the hold.
  const trickKey = view?.lastTrick ? JSON.stringify(view.lastTrick) : null;
  const seenTrick = useRef<string | null>(null);
  useEffect(() => {
    if (!trickKey || trickKey === seenTrick.current) return;
    seenTrick.current = trickKey;
    setHeldTrick(JSON.parse(trickKey));
    const t = setTimeout(() => setHeldTrick(null), TRICK_HOLD_MS);
    return () => clearTimeout(t);
  }, [trickKey]);

  // When a hand is scored, show the summary.
  const historyLen = useRef<number | null>(null);
  useEffect(() => {
    if (!view) return;
    if (historyLen.current !== null && view.history.length > historyLen.current) setSummary(view.history[view.history.length - 1]!);
    historyLen.current = view.history.length;
  }, [view?.history.length]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(t);
  }, [error]);

  const paused = heldTrick !== null || summary !== null || view?.phase === "finished";
  // Cards stay face down while blind nil is still possible, until you choose to look.
  const hidden =
    !source.watching &&
    !!view && view.phase === "bidding" && view.bids[seat] === null && lookedAtHand !== view.handNumber && blindNilAllowed(view, seat);

  return {
    view,
    seat,
    watching: !!source.watching,
    hand: view && !hidden ? view.hand : null,
    trickOnTable: heldTrick?.plays ?? view?.trick ?? [],
    trickWinner: heldTrick?.winner ?? null,
    paused,
    look: () => view && setLookedAtHand(view.handNumber),
    summary,
    dismissSummary: () => setSummary(null),
    error,
    /** Resolves to the reason when the move is refused (it's shown as the error too), else null. */
    act: async (move: Move): Promise<string | null> => {
      if (paused) return "Wait a moment.";
      const refused = await source.act(move);
      if (refused) setError(refused);
      return refused;
    },
  };
}

export type TableState = ReturnType<typeof useTable>;
