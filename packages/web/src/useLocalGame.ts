import { applyAction, botAction, newGame, paceDelay, personaFor, RuleError, smartAction, styleFor, thinkingTime, viewFor, type GameState, type RulePreset, type Seat, type TableSettings } from "@spades/rules";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Move, TableSource } from "./useTable";

export const HUMAN: Seat = 0;
/** A game in this browser: you in seat 0, bots everywhere else. Bots wait while the table is paused. */
export function useLocalGame(preset: RulePreset, seed: number, paused: boolean, botNames: Record<number, string> = {}, settings?: TableSettings): TableSource & { game: GameState } {
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
        // Thinking bots in their persona's style; fewer deals than on the server, since phones are slower.
        const style = styleFor(personaFor(botNames[seat] ?? "").style, settings?.skill);
        const skill = style.skill ?? 1;
        const action = smartAction(prev, seat, { style, deals: Math.max(2, Math.round(2 + 22 * skill * skill)) });
        return action ? applyAction(prev, action) : prev;
      });
    }, paceDelay(settings?.pace ?? "natural", () => thinkingTime(game, seat, botNames[seat] ?? "")));
    return () => clearTimeout(t);
  }, [game, paused, settings?.skill, settings?.pace]);

  const view = useMemo(() => viewFor(game, HUMAN), [game]);
  return { view, seat: HUMAN, act, game };
}
