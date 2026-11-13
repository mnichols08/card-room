import {
  applyAction,
  botAction,
  canBidBlindNil,
  newGame,
  RuleError,
  viewFor,
  type Action,
  type GameState,
  type HandRecord,
  type RulePreset,
  type Seat,
} from "@spades/rules";
import { useCallback, useEffect, useRef, useState } from "react";

export const HUMAN: Seat = 0;
const BOT_DELAY_MS = 650;
const TRICK_HOLD_MS = 1200;

/** Drives a local game: you in seat 0, bots everywhere else. */
export function useLocalGame(preset: RulePreset, seed: number) {
  const [game, setGame] = useState<GameState>(() => newGame(preset, seed));
  const [looked, setLooked] = useState(() => !canBidBlindNil(game, HUMAN));
  const [heldTrick, setHeldTrick] = useState<GameState["lastTrick"]>(null);
  const [summary, setSummary] = useState<HandRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useCallback((action: Action) => {
    setGame((prev) => {
      try {
        return applyAction(prev, action);
      } catch (e) {
        if (e instanceof RuleError) {
          setError(e.message);
          return prev;
        }
        throw e;
      }
    });
  }, []);

  // Pause briefly on each finished trick so people can see who took it.
  const lastTrickRef = useRef(game.lastTrick);
  useEffect(() => {
    if (game.lastTrick && game.lastTrick !== lastTrickRef.current) {
      setHeldTrick(game.lastTrick);
      const t = setTimeout(() => setHeldTrick(null), TRICK_HOLD_MS);
      lastTrickRef.current = game.lastTrick;
      return () => clearTimeout(t);
    }
    lastTrickRef.current = game.lastTrick;
  }, [game.lastTrick]);

  // When a hand is scored, show the summary and reset the blind nil "peek".
  const historyLen = useRef(game.history.length);
  useEffect(() => {
    if (game.history.length > historyLen.current) {
      setSummary(game.history[game.history.length - 1]!);
      setLooked(!canBidBlindNil(game, HUMAN));
    }
    historyLen.current = game.history.length;
  }, [game]);

  const paused = heldTrick !== null || summary !== null || game.phase === "finished";

  // Let the bots take their turns.
  useEffect(() => {
    if (paused) return;
    const seat = ([1, 2, 3] as Seat[]).find((s) => botAction(game, s));
    if (seat === undefined) return;
    const t = setTimeout(() => {
      const action = botAction(game, seat);
      if (action) dispatch(action);
    }, BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [game, paused, dispatch]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(t);
  }, [error]);

  return {
    game,
    view: viewFor(game, HUMAN, { hideHand: !looked }),
    trickOnTable: heldTrick?.plays ?? game.trick,
    trickWinner: heldTrick?.winner ?? null,
    paused,
    looked,
    look: () => setLooked(true),
    summary,
    dismissSummary: () => setSummary(null),
    error,
    act: (action: Action) => {
      if (!paused) dispatch(action);
    },
  };
}
