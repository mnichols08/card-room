import { useEffect, useState } from "react";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { challenges, type OfferedGame } from "./challengesApi";
import { GAME_LIST } from "./GamePicker";
import { loadSavedName, saveName, type GameId } from "./storage";

/** Where someone with a challenge link lands. */
export function ChallengePage({ code, onSent, onLeave }: { code: string; onSent: (table: string) => void; onLeave: () => void }) {
  const [them, setThem] = useState<{ name: string; enabled: boolean; rules: string; games?: OfferedGame[] } | null>(null);
  const [game, setGame] = useState<GameId | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState(loadSavedName);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A link can name the game it's for (?game=palace, from a blog button); otherwise the first offered.
    const asked = new URLSearchParams(location.search).get("game");
    challenges.get(code).then((t) => {
      setThem(t);
      const offered = t.games ?? [{ id: "spades" as GameId, name: "Spades", rules: t.rules }];
      setGame(offered.find((g) => g.id === asked)?.id ?? offered[0]!.id);
    }, (e) => setProblem((e as Error).message));
  }, [code]);

  if (problem && !them) {
    return (
      <main className="setup">
        <p className="error">{problem}</p>
        <button type="button" className="link" onClick={onLeave}>
          Go to the card room
        </button>
      </main>
    );
  }
  if (!them) return <main className="setup" />;

  const offered = them.games ?? [{ id: "spades" as GameId, name: "Spades", rules: them.rules }];
  const chosen = offered.find((g) => g.id === game) ?? offered[0]!;
  const emoji = GAME_LIST.find((g) => g.id === chosen.id)?.emoji ?? "♠️";
  const how = chosen.id === "palace" ? `You'll play ${them.name} and two computer players.` : `You'll sit across from ${them.name}, each with a computer partner.`;

  return (
    <main className="setup">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          {emoji}
        </div>
        <h1>Challenge {them.name}</h1>
        <p>{them.enabled ? `${chosen.name}: ${chosen.rules}. ${how}` : `${them.name} isn't taking challenges right now.`}</p>
      </header>
      {them.enabled && (
        <>
          {offered.length > 1 && (
            <nav className="game-picker" aria-label="Game">
              {offered.map((g) => (
                <button key={g.id} type="button" className={g.id === chosen.id ? "picked" : ""} aria-pressed={g.id === chosen.id} onClick={() => setGame(g.id)}>
                  <span aria-hidden>{GAME_LIST.find((x) => x.id === g.id)?.emoji}</span> {g.name}
                  <small>{g.rules}</small>
                </button>
              ))}
            </nav>
          )}
          <TextField label="Your name" required value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
          <TextField
            label="Say something"
            rows={2}
            value={message}
            maxlength={140}
            placeholder="Think you can beat me? 😏"
            onValueChange={(e: CustomEvent<string>) => setMessage(e.detail)}
          />
          <button
            type="button"
            className="primary"
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              setProblem(null);
              saveName(name.trim());
              try {
                const { id } = await challenges.send(code, name.trim(), message.trim(), chosen.id);
                onSent(id);
              } catch (e) {
                setProblem((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Send the challenge {emoji}
          </button>
          <p className="fine">We'll buzz {them.name}. Wait at the table and say hi in the chat; either of you can deal once you're both there.</p>
        </>
      )}
      {problem && <p className="error">{problem}</p>}
    </main>
  );
}
