import type { PalaceRules } from "@cardroom/palace";
import type { RulePreset } from "@spades/rules";
import { GAME_LIST } from "./GamePicker";
import { useEffect, useState } from "react";
import { challenges, challengeUrl, type MyLink } from "./challengesApi";
import { NotifyButton } from "./NotifyButton";

/** Your challenge link: put it on your blog, send it around; anyone with it can challenge you. */
export function ChallengeLink({ name, rules, palaceRules, kitRules }: { name: string; rules?: RulePreset; palaceRules?: PalaceRules; kitRules?: Record<string, unknown> }) {
  const [link, setLink] = useState<MyLink | null>(null);
  const [noServer, setNoServer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    // No card room behind this copy of the app (the GitHub Pages one): no challenge links.
    challenges.mine().then(setLink, () => setNoServer(true));
  }, []);
  if (!link || noServer) return null;

  const change = async (c: Parameters<typeof challenges.update>[0]) => {
    setBusy(true);
    setNote(null);
    try {
      setLink(await challenges.update(c));
    } catch (e) {
      setNote((e as Error).message);
    }
    setBusy(false);
  };
  const who = name.trim() || "you";
  // The rules on the screen this card sits on: spades rules from the spades screen, Palace from Palace.
  const these = { ...(rules ? { rules } : {}), ...(palaceRules ? { palaceRules } : {}), ...(kitRules ? { kitRules } : {}) };

  if (!link.code) {
    return (
      <section className="house-block" aria-label="Challenge link">
        <h2>Take on challengers</h2>
        <p className="fine">Get a link anyone can use to challenge {who} to a game. Put it on a blog or send it around.</p>
        <button type="button" className="secondary" disabled={busy} onClick={() => change({ name: who, ...these })}>
          Make my challenge link
        </button>
        {note && <p className="error">{note}</p>}
      </section>
    );
  }

  const url = challengeUrl(link.code);
  const share = async () => {
    try {
      if (navigator.share) return void (await navigator.share({ title: `Challenge ${link.name} to a game`, url }));
      await navigator.clipboard.writeText(url);
      setNote("Copied!");
    } catch {
      /* they closed the share sheet */
    }
  };

  return (
    <section className="house-block" aria-label="Challenge link">
      <h2>Your challenge link</h2>
      <p className="challenge-url">{url}</p>
      <div className="row-actions">
        <button type="button" className="primary small" onClick={share}>
          Share
        </button>
        <button type="button" className="link" disabled={busy} onClick={() => change({ enabled: !link.enabled })}>
          {link.enabled ? "Pause challenges" : "Take challenges again"}
        </button>
      </div>
      <p className="fine">
        {link.enabled ? `On: anyone with it can challenge ${link.name}` : "Paused: nobody can challenge you right now"} · {(link.games ?? []).map((g) => `${g.name}: ${g.rules}`).join(" · ")}.{" "}
        <button type="button" className="link" disabled={busy} onClick={() => change({ name: who, ...these })}>
          Use the name and rules above
        </button>{" "}
        ·{" "}
        <button
          type="button"
          className="link danger"
          disabled={busy}
          onClick={() => window.confirm("Make a new link? The old one will stop working.") && change({ newLink: true, enabled: true })}
        >
          New link
        </button>
      </p>
      <fieldset className="game-checks">
        <legend>Challenge me to</legend>
        {GAME_LIST.map((g) => {
          const on = (link.games ?? []).some((x) => x.id === g.id);
          return (
            <label key={g.id}>
              <input
                type="checkbox"
                checked={on}
                disabled={busy || (on && (link.games ?? []).length === 1)}
                onChange={() => change({ games: on ? (link.games ?? []).filter((x) => x.id !== g.id).map((x) => x.id) : [...(link.games ?? []).map((x) => x.id), g.id] })}
              />{" "}
              {g.emoji} {g.name}
            </label>
          );
        })}
      </fieldset>
      {note && <p className="fine">{note}</p>}
      <NotifyButton what="someone challenges you" />
    </section>
  );
}
