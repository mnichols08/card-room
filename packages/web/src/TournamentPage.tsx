import { useCallback, useEffect, useState } from "react";
import { houses, type House, type Side, type Tournament } from "./housesApi";
import { NotifyButton } from "./NotifyButton";
import { Choice } from "./RulesEditor";
import { isKitGame, kitGame } from "@cardroom/games";
import { GAME_LIST } from "./GamePicker";
import type { GameId } from "./storage";

/** Partners (spades, Euchre…): entrants are teams of two. */
const teamGame = (game: string) => game === "spades" || (isKitGame(game) && kitGame(game)!.teams);

interface Props {
  slug: string;
  id: string;
  onOpenTable: (id: string) => void;
  onBack: () => void;
}

/** A house tournament: signup, then the bracket, then the champion. */
export function TournamentPage({ slug, id, onOpenTable, onBack }: Props) {
  const [t, setT] = useState<Tournament | null>(null);
  const [house, setHouse] = useState<House | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [tour, h] = await Promise.all([houses.tournament(slug, id), houses.get(slug)]);
      setT(tour);
      if ("me" in h) setHouse(h);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  }, [slug, id]);
  useEffect(() => {
    void load();
    const tick = setInterval(() => document.visibilityState === "visible" && void load(), 8000);
    return () => clearInterval(tick);
  }, [load]);

  const act = async (action: string, body: Record<string, unknown> = {}) => {
    setProblem(null);
    try {
      if (action === "cancel") {
        await houses.tournamentAction(slug, id, action, body);
        onBack();
        return;
      }
      setT(await houses.tournamentAction(slug, id, action, body));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  if (!t || !house) {
    return (
      <main className="setup house">
        <p>{problem ?? "Opening the tournament…"}</p>
        <button type="button" className="link" onClick={onBack}>
          Back to the house
        </button>
      </main>
    );
  }

  const canManage = house.me.role === "owner" || house.me.role === "admin";
  const emoji = GAME_LIST.find((g) => g.id === t.game)?.emoji ?? "♠️";
  const name = (side: Side) => (typeof side === "number" ? (t.entrants[side]?.name ?? "?") : side === "bye" ? "Bye" : "To be decided");

  return (
    <main className="setup house tournament">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          {emoji} 🏆
        </div>
        <h1>{t.name}</h1>
        <p>
          {GAME_LIST.find((g) => g.id === t.game)?.name ?? "Spades"}, {teamGame(t.game) ? "teams of two" : "one against one"} · {t.rules}
        </p>
      </header>

      {t.status === "finished" && t.champion !== null && (
        <section className="champion" aria-label="Champion">
          <span aria-hidden>🏆</span>
          <strong>{t.entrants[t.champion]?.name}</strong>
          <small>{t.mine === t.champion ? "That's you! Congratulations." : "Champions!"}</small>
        </section>
      )}

      {t.status === "signup" ? (
        <Signup t={t} house={house} canManage={canManage} act={act} />
      ) : (
        <section className="house-block bracket" aria-label="Bracket">
          {t.rounds.map((round, r) => (
            <div key={r} className="round">
              <h2>{round.name}</h2>
              <ul className="matches">
                {round.matches.map((m, i) => {
                  const mine = t.mine !== null && (m.a === t.mine || m.b === t.mine);
                  const ready = !!m.table && m.winner === null;
                  return (
                    <li key={i} className={`match${mine ? " mine" : ""}`}>
                      {[m.a, m.b].map((side, s) => (
                        <div key={s} className={`side${m.winner === s ? " won" : m.winner !== null ? " lost" : ""}`}>
                          <span>{name(side)}</span>
                          {m.winner === s && <span aria-label="went through">✓</span>}
                        </div>
                      ))}
                      <div className="match-foot">
                        <small>{matchLine(m)}</small>
                        {ready && (
                          <button type="button" className={mine ? "primary small" : "secondary small"} onClick={() => onOpenTable(m.table!)}>
                            {mine ? (m.playing ? "Back to your table" : "Go to your table") : "Watch"}
                          </button>
                        )}
                        {!ready && m.table && m.how === "played" && (
                          <button type="button" className="link" onClick={() => onOpenTable(m.table!)}>
                            See the game
                          </button>
                        )}
                      </div>
                      {canManage && m.winner === null && typeof m.a === "number" && typeof m.b === "number" && (
                        <CallMatch a={name(m.a)} b={name(m.b)} onCall={(winner) => act("call", { round: r, match: i, winner })} />
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      {t.status !== "finished" && <NotifyButton what="your match is ready" />}
      {problem && <p className="error">{problem}</p>}
      {canManage && t.status !== "finished" && (
        <button type="button" className="link danger" onClick={() => confirm(`Call off ${t.name}? Its tables stay, but the bracket is gone.`) && act("cancel")}>
          Call off the tournament
        </button>
      )}
      <button type="button" className="link" onClick={onBack}>
        Back to the house
      </button>
    </main>
  );
}

function matchLine(m: Tournament["rounds"][number]["matches"][number]): string {
  if (m.how === "bye") return "A bye: straight through";
  if (m.how === "called") return "Called by the organizer";
  if (m.how === "played") return m.score ? `Final: ${m.score}` : "Played";
  if (m.playing) return m.score ? `Playing · ${m.score}` : "Playing now";
  if (m.table) return "Ready to play";
  return "Waiting for the round before";
}

/** For the organizer: send one side through without playing (someone can't make it). */
function CallMatch({ a, b, onCall }: { a: string; b: string; onCall: (winner: 0 | 1) => void }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        Call this match…
      </button>
    );
  return (
    <div className="call">
      <small>Who goes through?</small>
      <button type="button" className="secondary small" onClick={() => onCall(0)}>
        {a}
      </button>
      <button type="button" className="secondary small" onClick={() => onCall(1)}>
        {b}
      </button>
      <button type="button" className="link" onClick={() => setOpen(false)}>
        Cancel
      </button>
    </div>
  );
}

function Signup({ t, house, canManage, act }: { t: Tournament; house: House; canManage: boolean; act: (action: string, body?: Record<string, unknown>) => Promise<void> }) {
  const spades = teamGame(t.game);
  const playing = new Set(t.entrants.flatMap((e) => e.players.flatMap((p) => (p.bot ? [] : [p.id]))));
  const free = house.members.filter((m) => !playing.has(m.id));
  const meIn = playing.has(house.me.id);
  const [partner, setPartner] = useState("computer");
  const [adding, setAdding] = useState<string[]>(["", ""]);
  const partners = free.filter((m) => m.id !== house.me.id);
  // Keep the partner choice to someone still free.
  useEffect(() => {
    if (partner !== "computer" && !partners.some((m) => m.id === partner)) setPartner("computer");
  }, [partners, partner]);
  const pickable = (other: string): [string, string][] => [
    ["", "Pick someone"],
    ["computer", "The computer"],
    ...free.filter((m) => m.id !== other).map((m): [string, string] => [m.id, m.name]),
  ];
  const addPlayers = spades ? adding : adding.slice(0, 1);

  return (
    <>
      <section className="house-block" aria-label="Who's playing">
        <h2>
          {spades ? "Teams" : "Players"} ({t.entrants.length})
        </h2>
        {t.entrants.length === 0 && <p className="fine">Nobody yet. Be the first!</p>}
        <ul className="house-list">
          {t.entrants.map((e) => (
            <li key={e.id}>
              <div>
                <strong>{e.name}</strong>
                {e.players.some((p) => p.bot) && <small>{e.players.every((p) => p.bot) ? "the computer" : "with a computer partner"}</small>}
              </div>
              {canManage && (
                <button type="button" className="link danger" onClick={() => act("remove", { entrant: e.id })}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {meIn ? (
          <button type="button" className="link" onClick={() => act("leave")}>
            Take {spades ? "our team" : "me"} out
          </button>
        ) : (
          <>
            {spades && <Choice label="Your partner" value={partner} options={[["computer", "The computer"], ...partners.map((m): [string, string] => [m.id, m.name])]} onChange={setPartner} />}
            <button type="button" className="primary deal" onClick={() => act("enter", spades ? { partner } : {})}>
              Sign me up
            </button>
          </>
        )}
        <p className="fine">
          {spades ? "Partners stay together the whole way. " : ""}Each match gets its own table; you'll get a buzz when yours is ready, and you play it when you can.
        </p>
      </section>

      {canManage && (
        <section className="house-block" aria-label="Organizer">
          <h2>Organizer</h2>
          <div className="add-entrant">
            {addPlayers.map((value, i) => (
              <Choice
                key={i}
                label={spades ? `Player ${i + 1}` : "Player"}
                value={value}
                options={pickable(adding[1 - i] ?? "")}
                onChange={(v) => setAdding((a) => a.map((x, j) => (j === i ? v : x)))}
              />
            ))}
            <button
              type="button"
              className="secondary"
              disabled={addPlayers.some((v) => !v)}
              onClick={async () => {
                await act("add", { players: addPlayers });
                setAdding(["", ""]);
              }}
            >
              Add {spades ? "this team" : "them"}
            </button>
          </div>
          <button type="button" className="primary deal" disabled={t.entrants.length < 2} onClick={() => confirm("Close signup and draw the bracket?") && act("start")}>
            Start the bracket
          </button>
          <p className="fine">
            {t.entrants.length < 2
              ? `It needs at least two ${spades ? "teams" : "players"}.`
              : `Odd numbers are fine: some ${spades ? "teams" : "players"} get a bye into the next round. The draw is random.`}
          </p>
        </section>
      )}
    </>
  );
}

/** For the house page: start a tournament (owners and admins). */
export function NewTournament(props: {
  house: House;
  game: GameId;
  presetId: string;
  settings: import("@spades/rules").TableSettings;
  onMade: (id: string) => void;
  onClose: () => void;
}) {
  const { house, game } = props;
  const gameName = GAME_LIST.find((g) => g.id === game)?.name ?? "Spades";
  const [name, setName] = useState(`${house.name} ${gameName} Cup`);
  const [problem, setProblem] = useState<string | null>(null);
  const rules: { id: string; name: string }[] = isKitGame(game) ? (house.kitRules[game]?.presets ?? []) : game === "palace" ? house.palacePresets : house.presets;
  const [presetId, setPresetId] = useState(props.presetId);
  return (
    <div className="sheet" role="dialog" aria-label="New tournament">
      <h2>New {gameName} tournament</h2>
      <label className="field-inline">
        <span>Name</span>
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
      </label>
      {rules.length > 1 && <Choice label="Rules" value={presetId} options={rules.map((p): [string, string] => [p.id, p.name])} onChange={setPresetId} />}
      <p>{teamGame(game) ? "Single elimination, fixed teams of two." : "Single elimination, one against one."} Everyone in the house gets a buzz to sign up.</p>
      {problem && <p className="error">{problem}</p>}
      <div className="sheet-actions">
        <button
          type="button"
          className="primary"
          onClick={async () => {
            try {
              props.onMade((await houses.newTournament(house.slug, name, game, presetId, props.settings)).id);
            } catch (e) {
              setProblem(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Open signup
        </button>
        <button type="button" className="secondary" onClick={props.onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
