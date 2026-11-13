import type { ChatMessage } from "@spades/rooms/client";
import { greet, reactToMove, replyTo, type GameState, type Remark, type RulePreset, type Seat, type TableCast } from "@spades/rules";
import { useCallback, useEffect, useRef, useState } from "react";
import { Table } from "./Table";
import { useLocalGame } from "./useLocalGame";
import { useTable } from "./useTable";

const BOTS: Record<number, string> = { 1: "Hank", 2: "Dot", 3: "Lou" };
const CAST: TableCast = { bots: [1, 2, 3].map((seat) => ({ seat: seat as Seat, name: BOTS[seat]! })) };

/** A game in this browser against three bots, who chat as they would at a family table. */
export function LocalTable({ name, preset, seed, onLeave }: { name: string; preset: RulePreset; seed: number; onLeave: () => void }) {
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
  }, []);

  // Hello at the start, and reactions to every move after.
  const before = useRef<GameState | null>(null);
  useEffect(() => {
    if (!before.current) speak(greet(CAST));
    else if (before.current !== source.game) speak(reactToMove(before.current, source.game, CAST), source.game.phase === "finished");
    before.current = source.game;
  }, [source.game, speak]);

  const send = async (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 280);
    if (!clean) return "Say something first.";
    setMessages((m) => [...m, { seat: 0, name, text: clean, at: Date.now(), bot: false }]);
    speak(replyTo(clean, 0, CAST), true); // an answer to a person always comes through
    return null;
  };

  return <Table table={table} names={{ 0: name, ...BOTS } as Record<Seat, string>} onLeave={onLeave} chat={{ messages, mySeat: 0, send }} />;
}
