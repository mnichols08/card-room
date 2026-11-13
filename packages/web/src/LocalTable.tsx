import type { ChatMessage } from "@spades/rooms/client";
import { greet, mulberry32, pickPersonas, reactToMove, replyTo, type GameState, type Remark, type RulePreset, type Seat, type TableCast } from "@spades/rules";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Table } from "./Table";
import { useLocalGame } from "./useLocalGame";
import { useTable } from "./useTable";

/** A game in this browser against three bots, picked at random from the roster, who chat as they would at a family table. */
export function LocalTable({ name, preset, seed, onLeave }: { name: string; preset: RulePreset; seed: number; onLeave: () => void }) {
  const BOTS = useMemo(() => {
    const [a, b, c] = pickPersonas(3, mulberry32(seed));
    return { 1: a!.name, 2: b!.name, 3: c!.name } as Record<number, string>;
  }, [seed]);
  const CAST: TableCast = useMemo(() => ({ bots: [1, 2, 3].map((seat) => ({ seat: seat as Seat, name: BOTS[seat]! })) }), [BOTS]);
  const [paused, setPaused] = useState(false);
  const source = useLocalGame(preset, seed, paused, BOTS);
  const table = useTable(source);
  useEffect(() => setPaused(table.paused), [table.paused]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const lastWord = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const speak = useCallback((remarks: Remark[], always = false) => {
    for (const r of remarks) {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        if (!always && Date.now() - lastWord.current < 1200) return;
        lastWord.current = Date.now();
        setMessages((m) => [...m, { seat: r.seat, name: BOTS[r.seat]!, text: r.text, at: Date.now(), bot: true }]);
      }, r.delay);
      timers.current.add(timer);
    }
  }, [BOTS]);

  // Hello at the start, and reactions to every move after.
  const before = useRef<GameState | null>(null);
  useEffect(() => {
    if (!before.current) speak(greet(CAST));
    else if (before.current !== source.game) speak(reactToMove(before.current, source.game, CAST), source.game.phase === "finished");
    before.current = source.game;
  }, [source.game, speak, CAST]);

  const send = async (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 280);
    if (!clean) return "Say something first.";
    setMessages((m) => [...m, { seat: 0, name, text: clean, at: Date.now(), bot: false }]);
    speak(replyTo(clean, 0, CAST), true); // an answer to a person always comes through
    return null;
  };

  return <Table table={table} names={{ 0: name, ...BOTS } as Record<Seat, string>} onLeave={onLeave} chat={{ messages, mySeat: 0, send }} />;
}
