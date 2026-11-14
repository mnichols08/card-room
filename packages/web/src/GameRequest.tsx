// "Ask for a game": a line in the front page's footer opens this sheet. A game's name and, if they
// like, a note; the card room files the request on GitHub for them (see the server's bugs.ts).
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useEffect, useState } from "react";
import { ASK_EVENT, askForGame, type SentReport } from "./bugReport";
import { arranged } from "./catalogue";
import { GAME_LIST } from "./GamePicker";

const NOTE_LIMIT = 600;
/** A game's name with only its letters and digits, so "Gin rummy" finds "Gin Rummy". */
const plainName = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export function GameRequest() {
  const [open, setOpen] = useState(false);
  const [game, setGame] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<(SentReport & { again: boolean; game: string }) | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    const ask = () => {
      setSent(null);
      setProblem(null);
      setOpen(true);
    };
    addEventListener(ASK_EVENT, ask);
    return () => removeEventListener(ASK_EVENT, ask);
  }, []);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [open]);

  if (!open) return null;

  // A game the card room already has needs no request.
  const have = game.trim() ? arranged(GAME_LIST).find((g) => plainName(g.name) === plainName(game)) : undefined;
  const send = async () => {
    setProblem(null);
    setSending(true);
    try {
      setSent({ ...(await askForGame(game.trim(), note.trim())), game: game.trim() });
      setGame("");
      setNote("");
    } catch (e) {
      setProblem((e as Error).message);
    }
    setSending(false);
  };

  return (
    <div data-no-screenshot>
      <div className="sheet-backdrop report-backdrop" onClick={sending ? undefined : () => setOpen(false)} />
      <div className="sheet report-sheet" role="dialog" aria-modal="true" aria-labelledby="ask-title">
        {sent ? (
          <>
            <h2 id="ask-title">{sent.again ? "You're not the only one!" : "Asked!"}</h2>
            <p>
              {sent.again ? `Someone has already asked for ${sent.game}, so your voice was added to theirs.` : `Your request for ${sent.game} is in.`} It's number {sent.number}.
              {sent.url && (
                <>
                  {" "}
                  If you're curious, you can{" "}
                  <a href={sent.url} target="_blank" rel="noreferrer">
                    follow it on GitHub
                  </a>
                  .
                </>
              )}
            </p>
            <button type="button" className="primary" onClick={() => setOpen(false)}>
              Back to the games
            </button>
          </>
        ) : (
          <form
            className="report-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (game.trim() && !have) void send();
            }}
          >
            <h2 id="ask-title">Ask for a game</h2>
            <TextField label="Which game?" required maxlength={60} value={game} placeholder="Backgammon, Skat, Mexican Train…" onValueChange={(e: CustomEvent<string>) => setGame(e.detail)} />
            {have && (
              <p>
                Good news: {have.emoji} {have.name} is already here. It's on the front page.
              </p>
            )}
            <label className="report-words">
              <span>
                Anything we should know? <small>(you can leave this empty)</small>
              </span>
              <textarea rows={3} maxLength={NOTE_LIMIT} value={note} placeholder="How your family plays it, how many players, a rule you can't do without…" onChange={(e) => setNote(e.target.value)} />
            </label>
            <p className="fine">Requests are posted where anyone can read them, so the people who work on Card Room can see what to build next. Yours never includes your name.</p>
            {problem && (
              <p className="error" role="alert">
                {problem}
              </p>
            )}
            <div className="report-actions">
              <button type="button" className="secondary" onClick={() => setOpen(false)} disabled={sending}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={sending || !game.trim() || !!have}>
                {sending ? "Sending…" : "Send request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
