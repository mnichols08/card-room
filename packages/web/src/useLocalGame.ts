import { applyAction, botAction, newGame, RuleError, viewFor, type GameState, type RulePreset, type Seat } from "@spades/rules";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Move, TableSource } from "./useTable";

export const HUMAN: Seat = 0;
const BOT_DELAY_MS = 650;

/** A game in this browser: you in seat 0, bots everywhere else. Bots wait while the table is paused. */
export function useLocalGame(preset: RulePreset, seed: number, paused: boolean): TableSource {
  const [game, setGame] = useState<GameState>(() => newGame(preset, seed));
  const latest = useRef(game);
  latest.current = game;

  const act = useCallback(async (move: Move): Promise<string | null> => {
    try {
      const next = applyAction(latest.current, { ...move, seat: HUMAN } as Parameters<typeof applyAction>[1]);
      latest.current = next;
      setGame(next);
      return null;
    } catch (e) {
      if (e instanceof RuleError) return e.message;
      throw e;
    }
  }, []);

  useEffect(() => {
    if (paused || game.phase === "finished") return;
    const seat = ([1, 2, 3] as Seat[]).find((s) => botAction(game, s));
    if (seat === undefined) return;
    const t = setTimeout(() => {
      setGame((prev) => {
        const action = botAction(prev, seat);
        return action ? applyAction(prev, action) : prev;
      });
    }, BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [game, paused]);

  const view = useMemo(() => viewFor(game, HUMAN), [game]);
  return { view, seat: HUMAN, act };
}
