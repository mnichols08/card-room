// Open tables: every table that's waiting for players, whatever the game. See who's playing what
// and how long they've waited, and jump into a seat.
import SelectField from "@spades/ui/zubra-ui/select-field.zb";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useEffect, useState } from "react";
import { GAME_LIST } from "./GamePicker";
import { lobby, lobbyProblem, waited, whoIsThere, type OpenTable } from "./lobbyApi";
import { loadSavedName, saveName } from "./storage";

const REFRESH_MS = 4000;
const about = (id: string) => GAME_LIST.find((g) => g.id === id) ?? GAME_LIST[0]!;

export function LobbyPage({ onOpenTable, onLeave }: { onOpenTable: (id: string) => void; onLeave: () => void }) {
  const [tables, setTables] = useState<OpenTable[] | null>(null);
  const [name, setName] = useState(loadSavedName);
  const [game, setGame] = useState("all");
  const [problem, setProblem] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let loaded = false;
    const load = () => {
      if (document.visibilityState === "hidden") return;
      lobby.list().then(
        (next) => live && setTables(next),
        (e) => {
          // A missed refresh keeps the list that's showing; only a first load that fails says so.
          if (!live || loaded) return;
          setProblem(lobbyProblem(e));
          setTables([]);
        },
      ).finally(() => (loaded = true));
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  async function jump(table: OpenTable) {
    setProblem(null);
    setJoining(table.id);
    try {
      if (table.seat === null) {
        saveName(name.trim());
        await lobby.sit(table.id, name.trim());
      }
      onOpenTable(table.id);
    } catch (e) {
      setProblem(lobbyProblem(e));
      setJoining(null);
      lobby.list().then(setTables, () => undefined);
    }
  }

  const playing = [...new Set((tables ?? []).map((t) => t.game))];
  const filters = [{ value: "all", label: "Any game" }, ...GAME_LIST.filter((g) => playing.includes(g.id) || g.id === game).map((g) => ({ value: g.id, label: g.name }))];
  const shown = (tables ?? []).filter((t) => game === "all" || t.game === game);

  return (
    <main className="setup lobby open-tables">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          ♠ ♥ ♣ ♦
        </div>
        <h1>Open tables</h1>
        <p>People waiting for players right now. Jump into a seat; the game deals when the table fills.</p>
      </header>

      <TextField label="Your name" required value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
      {playing.length > 1 && <SelectField label="Game" value={game} options={filters} onValueChange={(e: CustomEvent<string>) => setGame(e.detail)} />}

      {tables === null ? (
        <p className="fine">Looking for open tables…</p>
      ) : shown.length === 0 ? (
        <p className="rules-summary open-none">Nobody's waiting right now. Pick a game and choose "Find players": you'll be first at the table, and it shows up here for everyone else.</p>
      ) : (
        <ul className="house-list open-list" aria-label="Open tables" aria-live="polite">
          {shown.map((t) => {
            const g = about(t.game);
            return (
              <li key={t.id}>
                <span className="open-emoji" aria-hidden>
                  {g.emoji}
                </span>
                <div>
                  <strong>
                    {g.name}
                    {t.seat !== null && <em>you're here</em>}
                  </strong>
                  <small>{whoIsThere(t)}</small>
                  <small>
                    {t.free} of {t.seats.length} seats open · {t.rules ? `${t.rules} · ` : ""}
                    {waited(t.created) === "just now" ? "opened just now" : `waiting ${waited(t.created)}`}
                  </small>
                </div>
                <button type="button" className="primary small" disabled={joining !== null || (t.seat === null && !name.trim())} onClick={() => void jump(t)}>
                  {t.seat !== null ? "Go back" : "Jump in"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {problem && <p className="error">{problem}</p>}
      <button type="button" className="link" onClick={onLeave}>
        ← All games
      </button>
    </main>
  );
}
