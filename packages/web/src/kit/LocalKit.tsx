// A kit game in this browser: you in seat 0 and computer players from the roster, who play in
// their own styles, at the table's speed, and chat a little.
import { GameError, kitGame, kitGreet, reactToKit, type KitGameId, type KitRemark } from "@cardroom/games";
import { palaceReplyTo } from "@cardroom/palace";
import type { ChatMessage } from "@spades/rooms/client";
import { mulberry32, paceDelay, personaFor, pickPersonas, styleFor } from "@spades/rules";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadTableSettings, saveTableSettings } from "../storage";
import { KitTable } from "./KitTable";

export function LocalKit({ game: id, name, rules, seats, seed, onLeave }: { game: KitGameId; name: string; rules: unknown; seats: number; seed: number; onLeave: () => void }) {
  const game = kitGame(id)!;
  const bots = useMemo(() => pickPersonas(seats - 1, mulberry32(seed)).map((p) => p.name), [seats, seed]);
  const names = useMemo(() => [name, ...bots], [name, bots]);
  const cast = useMemo(() => ({ bots: bots.map((n, i) => ({ seat: i + 1, name: n })) }), [bots]);
  const [state, setState] = useState(() => game.newGame(game.normalize(rules), seats, seed));
  const [settings, setSettings] = useState(loadTableSettings);
  const latest = useRef(state);
  latest.current = state;

  const act = useCallback(async (move: Record<string, unknown>) => {
    try {
      const next = game.apply(latest.current, 0, move);
      latest.current = next;
      setState(next);
      return null;
    } catch (e) {
      if (e instanceof GameError) return e.message;
      throw e;
    }
  }, []);

  // A computer player moves after a humanlike pause: the first one with something to do.
  useEffect(() => {
    if (game.summary(state).over) return;
    const seat = bots.map((_, i) => i + 1).find((s) => game.bot(state, s, styleFor(personaFor(bots[s - 1]!).style, settings.skill)) !== null);
    if (seat === undefined) return;
    const t = setTimeout(() => {
      setState((prev: unknown) => {
        const move = game.bot(prev, seat, styleFor(personaFor(bots[seat - 1]!).style, settings.skill));
        if (!move) return prev;
        try {
          return game.apply(prev, seat, move);
        } catch {
          return prev;
        }
      });
    }, paceDelay(settings.pace, () => Math.round(game.thinkingTime(state, seat) * personaFor(bots[seat - 1]!).pace * (0.8 + Math.random() * 0.5))));
    return () => clearTimeout(t);
  }, [state, bots, settings]);

  // Table talk.
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const lastWord = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const speak = useCallback(
    (remarks: KitRemark[], always = false) => {
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
  const before = useRef<unknown>(null);
  useEffect(() => {
    if (!before.current) speak(kitGreet(cast));
    else if (before.current !== state) speak(reactToKit(game.summary(before.current), game.summary(state), cast), true);
    before.current = state;
  }, [state, cast, speak]);

  const send = async (text: string) => {
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 280);
    if (!clean) return "Say something first.";
    setMessages((m) => [...m, { seat: 0, name, text: clean, at: Date.now(), bot: false }]);
    speak(palaceReplyTo(clean, cast), true);
    return null;
  };

  const view = useMemo(() => game.view(state, 0), [state]);
  return (
    <KitTable
      view={view}
      names={names}
      act={act}
      onLeave={onLeave}
      chat={{ messages, mySeat: 0, send }}
      settings={{
        value: settings,
        change: (next) => {
          saveTableSettings(next);
          setSettings(next);
        },
      }}
    />
  );
}
