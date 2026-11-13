import {
  applyPalace,
  mulberry32,
  newPalace,
  palaceBot,
  palaceGreet,
  palaceReplyTo,
  palaceThinkingTime,
  PalaceError,
  reactToPalace,
  viewPalace,
  type PalaceMove,
  type PalaceRemark,
  type PalaceRules,
  type PalaceState,
} from "@cardroom/palace";
import type { ChatMessage } from "@spades/rooms/client";
import { personaFor, pickPersonas } from "@spades/rules";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PalaceTable } from "./PalaceTable";

/** Palace in this browser: you in seat 0 and bots from the roster, who play in their own styles and chat. */
export function LocalPalace({ name, rules, seats, seed, onLeave }: { name: string; rules: PalaceRules; seats: number; seed: number; onLeave: () => void }) {
  const bots = useMemo(() => pickPersonas(seats - 1, mulberry32(seed)).map((p) => p.name), [seats, seed]);
  const names = useMemo(() => [name, ...bots], [name, bots]);
  const cast = useMemo(() => ({ bots: bots.map((n, i) => ({ seat: i + 1, name: n })) }), [bots]);
  const [game, setGame] = useState<PalaceState>(() => newPalace(rules, seats, seed, seed % seats));
  const latest = useRef(game);
  latest.current = game;

  const act = useCallback(async (move: PalaceMove) => {
    try {
      const next = applyPalace(latest.current, { ...move, seat: 0 } as Parameters<typeof applyPalace>[1]);
      latest.current = next;
      setGame(next);
      return null;
    } catch (e) {
      if (e instanceof PalaceError) return e.message;
      throw e;
    }
  }, []);

  // A bot moves after a humanlike pause: whoever's turn it is, or anyone still swapping.
  useEffect(() => {
    if (game.phase === "finished") return;
    const seat = bots.map((_, i) => i + 1).find((s) => palaceBot(game, s) !== null);
    if (seat === undefined) return;
    const t = setTimeout(() => {
      setGame((prev) => {
        const action = palaceBot(prev, seat, personaFor(bots[seat - 1]!).style);
        return action ? applyPalace(prev, action) : prev;
      });
    }, palaceThinkingTime(game, seat, bots[seat - 1]!));
    return () => clearTimeout(t);
  }, [game, bots]);

  // Table talk.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const lastWord = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const speak = useCallback(
    (remarks: PalaceRemark[], always = false) => {
      for (const r of remarks) {
        const timer = setTimeout(() => {
          timers.current.delete(timer);
          if (!always && Date.now() - lastWord.current < 1200) return;
          lastWord.current = Date.now();
          setMessages((m) => [...m, { seat: r.seat, name: names[r.seat]!, text: r.text, at: Date.now(), bot: true }]);
        }, r.delay);
        timers.current.add(timer);
      }
    },
    [names],
  );
  const before = useRef<PalaceState | null>(null);
  useEffect(() => {
    if (!before.current) speak(palaceGreet(cast));
    else if (before.current !== game) speak(reactToPalace(before.current, game, cast), game.phase === "finished");
    before.current = game;
  }, [game, cast, speak]);

  const send = async (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 280);
    if (!clean) return "Say something first.";
    setMessages((m) => [...m, { seat: 0, name, text: clean, at: Date.now(), bot: false }]);
    speak(palaceReplyTo(clean, cast), true);
    return null;
  };

  const view = useMemo(() => viewPalace(game, 0), [game]);
  return <PalaceTable view={view} seat={0} names={names} act={act} onLeave={onLeave} chat={{ messages, mySeat: 0, send }} />;
}
