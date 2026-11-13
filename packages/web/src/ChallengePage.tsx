import { useEffect, useState } from "react";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { challenges } from "./challengesApi";
import { loadSavedName, saveName } from "./storage";

/** Where someone with a challenge link lands. */
export function ChallengePage({ code, onSent, onLeave }: { code: string; onSent: (table: string) => void; onLeave: () => void }) {
  const [them, setThem] = useState<{ name: string; enabled: boolean; rules: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState(loadSavedName);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    challenges.get(code).then(setThem, (e) => setProblem((e as Error).message));
  }, [code]);

  if (problem && !them) {
    return (
      <main className="setup">
        <p className="error">{problem}</p>
        <button type="button" className="link" onClick={onLeave}>
          Go to Spades
        </button>
      </main>
    );
  }
  if (!them) return <main className="setup" />;

  return (
    <main className="setup">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          ♠ ♥ ♣ ♦
        </div>
        <h1>Challenge {them.name}</h1>
        <p>{them.enabled ? `${them.rules}. You'll sit across from ${them.name}, each with a computer partner.` : `${them.name} isn't taking challenges right now.`}</p>
      </header>
      {them.enabled && (
        <>
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
                const { id } = await challenges.send(code, name.trim(), message.trim());
                onSent(id);
              } catch (e) {
                setProblem((e as Error).message);
                setBusy(false);
              }
            }}
          >
            Send the challenge ♠️
          </button>
          <p className="fine">We'll buzz {them.name}. Wait at the table and say hi in the chat; either of you can deal once you're both there.</p>
        </>
      )}
      {problem && <p className="error">{problem}</p>}
    </main>
  );
}
