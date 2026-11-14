// A kit game in this browser: you in seat 0 and computer players from the roster, who play in
// their own styles, at the table's speed, and chat a little.
import { GameError, kitGame, kitGreet, reactToKit, type KitGameId, type KitRemark } from "@cardroom/games";
import { palaceReplyTo } from "@cardroom/palace";
import type { ChatMessage } from "@spades/rooms/client";
import { mulberry32, paceDelay, personaFor, pickPersonas, styleFor } from "@spades/rules";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadTableSettings, saveTableSettings } from "../storage";
import { TurnClock } from "../TurnClock";
import { GameTable } from "./GameTable";

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

  // A clock of the game's own (Drop Four's shot clock in drinking mode) runs here as it does at a
  // family table: on your seat only, from the moment the state changed, with the game's timeout move
  // when it runs out. There's no turn timer in practice (nobody is waiting on you), but a game that
  // is played against a clock isn't the same game without it. Computer players aren't held to it,
  // and move well inside it.
  const own = useMemo(() => game.deadline?.(state) ?? null, [state]);
  const insideTheClock = (seat: number, delay: number) => (own && own.seat === seat ? Math.min(delay, Math.round(own.after * 0.6)) : delay);
  const [deadline, setDeadline] = useState<{ at: number; seat: number } | null>(null);
  useEffect(() => {
    if (!own || own.seat !== 0) return setDeadline(null);
    setDeadline({ at: Date.now() + own.after, seat: 0 });
    const timer = setTimeout(() => {
      // Only if nothing has happened since: a move made as the clock ran out is the one that counts.
      if (latest.current === state) void act(own.move);
    }, own.after);
    return () => clearTimeout(timer);
  }, [own]);

  // A computer player moves after a humanlike pause: the first one with something to do. A pause
  // already running isn't restarted when someone else moves (in Speed, a quick person mustn't keep
  // resetting the computer's clock); when it ends, the move is worked out from the table as it is then.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (game.summary(state).over || pending.current) return;
    const seat = bots.map((_, i) => i + 1).find((s) => game.bot(state, s, styleFor(personaFor(bots[s - 1]!).style, settings.skill)) !== null);
    if (seat === undefined) return;
    pending.current = setTimeout(() => {
      pending.current = null;
      setState((prev: unknown) => {
        const move = game.bot(prev, seat, styleFor(personaFor(bots[seat - 1]!).style, settings.skill));
        if (!move) return prev;
        try {
          const next = game.apply(prev, seat, move);
          latest.current = next;
          return next;
        } catch {
          return prev;
        }
      });
      setTick((t) => t + 1);
    }, game.reactionTime?.(state, seat, styleFor(personaFor(bots[seat - 1]!).style, settings.skill)) ?? insideTheClock(seat, paceDelay(settings.pace, () => Math.round(game.thinkingTime(state, seat) * personaFor(bots[seat - 1]!).pace * (0.8 + Math.random() * 0.5)))));
  }, [state, bots, settings, tick]);
  useEffect(
    () => () => {
      // Forget the pause as well as stopping it: left set, it would look like one still running, and
      // no computer player would move again (React's StrictMode remounts every table once in dev).
      if (pending.current) clearTimeout(pending.current);
      pending.current = null;
    },
    [],
  );

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
    if (!before.current) speak(kitGreet(cast, undefined, id));
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
    <>
      <GameTable
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
      <TurnClock deadline={deadline} mySeat={0} now={Date.now} />
    </>
  );
}
