import { validatePreset, type RulePreset } from "@spades/rules";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { HouseAiBlock } from "./HouseAi";
import { useCallback, useEffect, useState } from "react";
import { validatePalaceRules, type PalaceRules } from "@cardroom/palace";
import { GamePicker } from "./GamePicker";
import { HouseError, houses, inviteLink, type House, type HouseTable, type PalaceStandings, type Standings } from "./housesApi";
import { PalaceRulesFields, palaceSummary } from "./palace/PalaceRules";
import { NotifyButton } from "./NotifyButton";
import { NewTournament } from "./TournamentPage";
import { isKitGame } from "@cardroom/games";
import { GAME_LIST } from "./GamePicker";
import { KitHouseRules, KitStartTable } from "./kit/KitHouse";
import { describe, RulesFields } from "./RulesEditor";
import { Choice } from "./RulesEditor";
import { forgetHouse, loadGame, loadTableSettings, loadPalaceSeats, loadSavedName, rememberHouse, saveGame, saveName, savePalaceSeats, type GameId } from "./storage";

interface Props {
  slug: string;
  /** The invite code, when the page was opened from an invite link. */
  code: string | null;
  onOpenTable: (id: string) => void;
  onOpenTournament: (id: string) => void;
  onLeave: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "invited"; name: string }
  | { kind: "member"; house: House }
  | { kind: "closed"; message: string };

/** A family's own corner: their tables, their people, their rules. */
export function HousePage({ slug, code, onOpenTable, onOpenTournament, onLeave }: Props) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [problem, setProblem] = useState<string | null>(null);

  const show = useCallback((house: House) => {
    rememberHouse({ slug: house.slug, name: house.name });
    setState({ kind: "member", house });
  }, []);

  const load = useCallback(async () => {
    try {
      const found = await houses.get(slug, code);
      if ("member" in found) setState({ kind: "invited", name: found.name });
      else show(found);
    } catch (e) {
      if (e instanceof HouseError && e.status === 404) forgetHouse(slug);
      setState({ kind: "closed", message: e instanceof Error ? e.message : String(e) });
    }
  }, [slug, code, show]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the tables fresh while the page is open.
  useEffect(() => {
    if (state.kind !== "member") return;
    const tick = setInterval(() => document.visibilityState === "visible" && void load(), 8000);
    return () => clearInterval(tick);
  }, [state.kind, load]);

  const attempt = async (work: () => Promise<House | void>) => {
    setProblem(null);
    try {
      const house = await work();
      if (house) show(house);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  if (state.kind === "loading") return <main className="setup house"><p>Opening the house…</p></main>;

  if (state.kind === "closed") {
    return (
      <main className="setup house">
        <h1>Can't open this house</h1>
        <p>{state.message}</p>
        <button type="button" className="primary" onClick={onLeave}>
          Back
        </button>
      </main>
    );
  }

  if (state.kind === "invited") return <Invited houseName={state.name} onJoin={(name) => attempt(() => houses.join(slug, code!, name))} problem={problem} />;

  const { house } = state;
  return <MemberView house={house} attempt={attempt} problem={problem} onOpenTable={onOpenTable} onOpenTournament={onOpenTournament} onLeave={onLeave} />;
}

function Invited({ houseName, onJoin, problem }: { houseName: string; onJoin: (name: string) => void; problem: string | null }) {
  const [name, setName] = useState(loadSavedName);
  return (
    <main className="setup house">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          ♠ ♥ ♣ ♦
        </div>
        <p>You're invited to</p>
        <h1>{houseName}</h1>
      </header>
      <TextField label="Your spades name" required value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
      <button
        type="button"
        className="primary deal"
        disabled={!name.trim()}
        onClick={() => {
          saveName(name.trim());
          onJoin(name.trim());
        }}
      >
        Come on in
      </button>
      {problem && <p className="error">{problem}</p>}
    </main>
  );
}

function MemberView(props: {
  house: House;
  attempt: (work: () => Promise<House | void>) => Promise<void>;
  problem: string | null;
  onOpenTable: (id: string) => void;
  onOpenTournament: (id: string) => void;
  onLeave: () => void;
}) {
  const { house, attempt } = props;
  const [makingTournament, setMakingTournament] = useState(false);
  const canManage = house.me.role === "owner" || house.me.role === "admin";
  const [presetId, setPresetId] = useState(house.defaultPreset);
  // Follow the house default when it changes, or when the chosen rules are deleted.
  useEffect(() => setPresetId(house.defaultPreset), [house.defaultPreset]);
  useEffect(() => {
    if (!house.presets.some((p) => p.id === presetId)) setPresetId(house.defaultPreset);
  }, [house.presets, presetId, house.defaultPreset]);
  const [editing, setEditing] = useState<RulePreset | null>(null);
  const [editingPalace, setEditingPalace] = useState<PalaceRules | null>(null);
  const [game, setGame] = useState<GameId>(loadGame);
  const [palaceId, setPalaceId] = useState(house.palaceDefault);
  const [seats, setSeats] = useState(loadPalaceSeats);
  useEffect(() => setPalaceId(house.palaceDefault), [house.palaceDefault]);
  const palaceRules = house.palacePresets.find((p) => p.id === palaceId) ?? house.palacePresets[0]!;
  const [copied, setCopied] = useState(false);
  const defaultRules = house.presets.find((p) => p.id === house.defaultPreset);

  async function invite() {
    const url = inviteLink(house);
    try {
      if (navigator.share) await navigator.share({ title: house.name, text: `Pull up a chair at ${house.name}.`, url });
      else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      /* closed the share sheet */
    }
  }

  return (
    <main className="setup house">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          ♠ ♥ ♣ ♦
        </div>
        <h1>{house.name}</h1>
        <p>Welcome back, {house.me.name}.</p>
      </header>
      <GamePicker
        game={game}
        onPick={(g) => {
          saveGame(g);
          setGame(g);
        }}
      />

      {isKitGame(game) ? (
        <KitStartTable house={house} game={game} attempt={attempt} onOpenTable={props.onOpenTable} />
      ) : game === "palace" ? (
        <section className="house-block" aria-label="Start a table">
          {house.palacePresets.length > 1 && (
            <label className="field-inline">
              <span>Rules</span>
              <select value={palaceId} onChange={(e) => setPalaceId(e.target.value)}>
                {house.palacePresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === house.palaceDefault ? " (house default)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Choice label="Players" value={seats} options={[2, 3, 4, 5, 6].map((n) => [String(n), `${n} players`])} onChange={(v) => setSeats(Number(v))} />
          <button
            type="button"
            className="primary deal"
            onClick={() =>
              attempt(async () => {
                savePalaceSeats(seats);
                props.onOpenTable((await houses.openTable(house.slug, palaceRules.id, "palace", seats, loadTableSettings())).id);
              })
            }
          >
            Start a Palace table
          </button>
          <p className="rules-summary">{palaceSummary(palaceRules)}</p>
        </section>
      ) : (
      <section className="house-block" aria-label="Start a table">
        {house.presets.length > 1 && (
          <label className="field-inline">
            <span>Rules</span>
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {house.presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === house.defaultPreset ? " (house default)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className="primary deal" onClick={() => attempt(async () => props.onOpenTable((await houses.openTable(house.slug, presetId, "spades", undefined, loadTableSettings())).id))}>
          Start a table
        </button>
        <p className="rules-summary">{describe(house.presets.find((p) => p.id === presetId) ?? defaultRules ?? house.presets[0]!)}</p>
      </section>
      )}

      <section className="house-block" aria-label="Tables">
        <h2>Tables</h2>
        {house.tables.length === 0 && <p className="fine">No tables yet. Start one, then share it.</p>}
        <ul className="house-list">
          {house.tables.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{tableTitle(t)}</strong>
                <small>
                  {t.rules} · {t.seats.map((s) => s.name ?? "open").join(", ")}
                </small>
              </div>
              <button type="button" className="secondary small" onClick={() => props.onOpenTable(t.id)}>
                {t.summary?.phase === "finished" ? "See it" : t.seats.some((s) => s.name) && !t.started ? "Sit down" : "Open"}
              </button>
            </li>
          ))}
        </ul>
        <NotifyButton what="someone opens a table here" />
      </section>

      <section className="house-block" aria-label="Tournaments">
        <h2>Tournaments</h2>
        {house.tournaments.length === 0 && <p className="fine">{canManage ? "Run a bracket: everyone signs up, plays their match when they can, and one of you takes the crown." : "No tournaments yet."}</p>}
        <ul className="house-list">
          {house.tournaments.map((t) => (
            <li key={t.id}>
              <div>
                <strong>
                  {GAME_LIST.find((g) => g.id === t.game)?.emoji ?? "♠️"} {t.name}
                </strong>
                <small>
                  {t.status === "signup"
                    ? `Signing up · ${t.entrants} ${t.game === "spades" ? "team" : "player"}${t.entrants === 1 ? "" : "s"} so far`
                    : t.status === "playing"
                      ? `Playing · ${t.round}`
                      : `🏆 ${t.champion}`}
                </small>
              </div>
              <button type="button" className="secondary small" onClick={() => props.onOpenTournament(t.id)}>
                {t.status === "signup" ? "Sign up" : "Bracket"}
              </button>
            </li>
          ))}
        </ul>
        {canManage && (
          <button type="button" className="secondary" onClick={() => setMakingTournament(true)}>
            Start a {game === "spades" ? "spades" : (GAME_LIST.find((g) => g.id === game)?.name ?? "")} tournament
          </button>
        )}
      </section>

      {game === "spades" ? <LeaderboardBlock house={house} /> : <PalaceLeaderboardBlock house={house} game={game} />}

      <section className="house-block" aria-label="Family">
        <h2>Family</h2>
        <ul className="house-list">
          {house.members.map((m) => (
            <li key={m.id}>
              <div>
                <strong>{m.name}</strong>
                <small>{m.id === house.me.id ? `you · ${m.role}` : m.role}</small>
              </div>
              {house.me.role === "owner" && m.role !== "owner" && (
                <span className="row-actions">
                  <button type="button" className="link" onClick={() => attempt(() => houses.setRole(house.slug, m.id, m.role === "admin" ? "member" : "admin"))}>
                    {m.role === "admin" ? "Make member" : "Make admin"}
                  </button>
                  <button type="button" className="link danger" onClick={() => confirm(`Remove ${m.name} from ${house.name}?`) && attempt(() => houses.remove(house.slug, m.id))}>
                    Remove
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
        <button type="button" className="secondary" onClick={invite}>
          {copied ? "Link copied" : "Invite family"}
        </button>
        {canManage && (
          <button type="button" className="link" onClick={() => confirm("Make a new invite link? The old one will stop working.") && attempt(() => houses.newLink(house.slug))}>
            Make a new invite link
          </button>
        )}
      </section>

      <HouseAiBlock house={house} onChange={(h) => void attempt(async () => h)} />

      {isKitGame(game) && <KitHouseRules house={house} game={game} attempt={attempt} canManage={canManage} />}

      {game === "palace" && (
        <section className="house-block" aria-label="Palace house rules">
          <h2>Palace house rules</h2>
          <ul className="house-list">
            {house.palacePresets.map((p) => (
              <li key={p.id}>
                <div>
                  <strong>
                    {p.name}
                    {p.id === house.palaceDefault && <em> house default</em>}
                  </strong>
                  <small>{palaceSummary(p)}</small>
                </div>
                {canManage && (
                  <button type="button" className="link" onClick={() => setEditingPalace(structuredClone(p))}>
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <button type="button" className="link" onClick={() => setEditingPalace({ ...structuredClone(palaceRules), id: "", name: "New rules" })}>
              Add another set of rules
            </button>
          )}
        </section>
      )}

      {game === "spades" && (
      <section className="house-block" aria-label="House rules">
        <h2>House rules</h2>
        <ul className="house-list">
          {house.presets.map((p) => (
            <li key={p.id}>
              <div>
                <strong>
                  {p.name}
                  {p.id === house.defaultPreset && <em> house default</em>}
                </strong>
                <small>{describe(p)}</small>
              </div>
              {canManage && (
                <button type="button" className="link" onClick={() => setEditing(structuredClone(p))}>
                  Edit
                </button>
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          <button type="button" className="link" onClick={() => setEditing({ ...structuredClone(defaultRules ?? house.presets[0]!), id: "", name: "New rules" })}>
            Add another set of rules
          </button>
        )}
        {!canManage && <p className="fine">Ask {house.members.find((m) => m.role === "owner")?.name ?? "the owner"} to change the house rules.</p>}
      </section>
      )}

      {props.problem && <p className="error">{props.problem}</p>}
      <button type="button" className="link" onClick={props.onLeave}>
        Back to the start
      </button>

      {makingTournament && (
        <NewTournament
          house={house}
          game={game}
          presetId={isKitGame(game) ? (house.kitRules[game]?.default ?? "") : game === "palace" ? palaceId : presetId}
          settings={loadTableSettings()}
          onClose={() => setMakingTournament(false)}
          onMade={(id) => {
            setMakingTournament(false);
            props.onOpenTournament(id);
          }}
        />
      )}
      {editingPalace && (
        <PalaceRulesEditor
          rules={editingPalace}
          isDefault={editingPalace.id === house.palaceDefault}
          canDelete={!!editingPalace.id && house.palacePresets.length > 1}
          onClose={() => setEditingPalace(null)}
          onSave={(rules, makeDefault) =>
            attempt(async () => {
              const { id, ...rest } = rules;
              const saved = await houses.savePalace(house.slug, (id ? rules : rest) as PalaceRules, makeDefault);
              setEditingPalace(null);
              return saved;
            })
          }
          onDelete={() =>
            attempt(async () => {
              const saved = await houses.deletePalace(house.slug, editingPalace.id);
              setEditingPalace(null);
              return saved;
            })
          }
        />
      )}
      {editing && (
        <RulesSheet
          rules={editing}
          isDefault={editing.id === house.defaultPreset}
          canDelete={!!editing.id && house.presets.length > 1}
          onClose={() => setEditing(null)}
          onSave={(rules, makeDefault) =>
            attempt(async () => {
              const saved = await houses.savePreset(house.slug, rules, makeDefault);
              setEditing(null);
              return saved;
            })
          }
          onDelete={() =>
            attempt(async () => {
              const saved = await houses.deletePreset(house.slug, editing.id);
              setEditing(null);
              return saved;
            })
          }
        />
      )}
    </main>
  );
}

function RulesSheet(props: {
  rules: RulePreset;
  isDefault: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSave: (rules: RulePreset, makeDefault: boolean) => void;
  onDelete: () => void;
}) {
  const [rules, setRules] = useState(props.rules);
  const [makeDefault, setMakeDefault] = useState(props.isDefault);
  const errors = validatePreset(rules);
  return (
    <div className="rules-sheet" role="dialog" aria-label="Edit house rules">
      <div className="rules-sheet-body setup">
        <TextField label="Name of these rules" value={rules.name} maxlength={30} onValueChange={(e: CustomEvent<string>) => setRules((r) => ({ ...r, name: e.detail }))} />
        <section className="rules">
          <RulesFields rules={rules} onChange={(patch) => setRules((r) => ({ ...r, ...patch }))} />
        </section>
        {!props.isDefault && (
          <label className="check">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> Make these the house default
          </label>
        )}
        {errors.length > 0 && <p className="error">{errors.join(" ")}</p>}
        <button type="button" className="primary" disabled={errors.length > 0} onClick={() => props.onSave(rules, makeDefault)}>
          Save
        </button>
        <div className="rule-actions">
          <button type="button" className="link" onClick={props.onClose}>
            Cancel
          </button>
          {props.canDelete && (
            <button type="button" className="link danger" onClick={() => confirm(`Delete "${rules.name}"?`) && props.onDelete()}>
              Delete these rules
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function PalaceRulesEditor(props: {
  rules: PalaceRules;
  isDefault: boolean;
  canDelete: boolean;
  onClose: () => void;
  onSave: (rules: PalaceRules, makeDefault: boolean) => void;
  onDelete: () => void;
}) {
  const [rules, setRules] = useState(props.rules);
  const [makeDefault, setMakeDefault] = useState(props.isDefault);
  const errors = validatePalaceRules(rules);
  return (
    <div className="rules-sheet" role="dialog" aria-label="Edit Palace house rules">
      <div className="rules-sheet-body setup">
        <TextField label="Name of these rules" value={rules.name} maxlength={30} onValueChange={(e: CustomEvent<string>) => setRules((r) => ({ ...r, name: e.detail }))} />
        <section className="rules">
          <PalaceRulesFields rules={rules} onChange={(patch) => setRules((r) => ({ ...r, ...patch }))} />
        </section>
        {!props.isDefault && (
          <label className="check">
            <input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)} /> Make these the house default
          </label>
        )}
        {errors.length > 0 && <p className="error">{errors.join(" ")}</p>}
        <button type="button" className="primary" disabled={errors.length > 0} onClick={() => props.onSave(rules, makeDefault)}>
          Save
        </button>
        <div className="rule-actions">
          <button type="button" className="link" onClick={props.onClose}>
            Cancel
          </button>
          {props.canDelete && (
            <button type="button" className="link danger" onClick={() => confirm(`Delete "${rules.name}"?`) && props.onDelete()}>
              Delete these rules
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function tableTitle(t: HouseTable): string {
  if (isKitGame(t.game)) {
    const emoji = GAME_LIST.find((g) => g.id === t.game)?.emoji ?? "🃏";
    const s = t.summary as { over?: boolean; scoreLine?: string; hand?: number } | null;
    if (s?.over) return `${emoji} Finished · ${s.scoreLine}`;
    if (t.started) return `${emoji} Hand ${s?.hand ?? 1} · ${s?.scoreLine ?? ""}`;
    const seated = t.seats.filter((x) => x.name).length;
    return seated === 0 ? `${emoji} Waiting for players` : `${emoji} ${seated} of ${t.seats.length} seated`;
  }
  if (t.game === "palace") {
    const s = t.summary;
    if (s?.phase === "finished") return `🏰 Finished · ${t.seats[s.finished?.[0] ?? 0]?.name ?? "Someone"} went out first`;
    if (t.started) return `🏰 Playing · ${s?.finished?.length ?? 0} out so far`;
    const seated = t.seats.filter((x) => x.name).length;
    return seated === 0 ? "🏰 Waiting for players" : `🏰 ${seated} of ${t.seats.length} seated`;
  }
  if (t.summary?.phase === "finished" && t.summary.scores) {
    const [a, b] = t.summary.scores;
    return `Finished · ${a?.points} to ${b?.points}`;
  }
  if (t.started && t.summary?.scores) {
    const [a, b] = t.summary.scores;
    return `Hand ${t.summary.hand} · ${a?.points} to ${b?.points}`;
  }
  const seated = t.seats.filter((s) => s.name).length;
  return seated === 0 ? "Waiting for players" : `${seated} of 4 seated`;
}

/** Palace standings: first out counts as a win, and being left holding the cards is remembered too. */
function PalaceLeaderboardBlock({ house, game }: { house: House; game: GameId }) {
  const [board, setBoard] = useState<PalaceStandings | null>(null);
  const name = GAME_LIST.find((g) => g.id === game)?.name ?? "Palace";
  const finished = house.tables.filter((t) => t.game === game && (t.summary?.phase === "finished" || (t.summary as { over?: boolean } | null)?.over)).length;
  useEffect(() => {
    houses.placesLeaderboard(house.slug, game).then(setBoard, () => setBoard(null));
  }, [house.slug, finished, game]);
  if (!board) return null;
  const ranked = board.players.filter((p) => p.played > 0);
  return (
    <section className="house-block" aria-label={`${name} leaderboard`}>
      <h2>{name} leaderboard</h2>
      {board.games === 0 ? (
        <p className="fine">Standings start after the first finished {name} game.</p>
      ) : (
        <>
          <table className="standings">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Player</th>
                <th scope="col">Won</th>
                {!board.teams && <th scope="col">Last</th>}
                <th scope="col">Played</th>
                <th scope="col">Avg place</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p, i) => (
                <tr key={p.id} className={p.id === house.me.id ? "me" : ""}>
                  <td>{i === 0 && p.won > 0 ? "👑" : i + 1}</td>
                  <th scope="row">{p.name}</th>
                  <td>{p.won}</td>
                  {!board.teams && <td>{p.last}</td>}
                  <td>{p.played}</td>
                  <td>{p.avgPlace}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="fine">
            {board.games} finished game{board.games === 1 ? "" : "s"}. {game === "palace" ? "Won is first out; Last is left holding the cards." : board.teams ? "Won counts your team's wins." : "Won is first place; Last is last place."}
          </p>
        </>
      )}
    </section>
  );
}

/** Standings from the house's finished games. Refreshes when a game finishes. */
function LeaderboardBlock({ house }: { house: House }) {
  const [board, setBoard] = useState<Standings | null>(null);
  const finished = house.tables.filter((t) => t.game !== "palace" && t.summary?.phase === "finished").length;
  useEffect(() => {
    houses.leaderboard(house.slug).then(setBoard, () => setBoard(null));
  }, [house.slug, finished]);
  if (!board) return null;
  const ranked = board.players.filter((p) => p.played > 0);
  const me = house.me.id;

  return (
    <section className="house-block" aria-label="Leaderboard">
      <h2>Leaderboard</h2>
      {board.games === 0 ? (
        <p className="fine">Standings start after the first finished game.</p>
      ) : (
        <>
          <table className="standings">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Player</th>
                <th scope="col">Won</th>
                <th scope="col">Played</th>
                <th scope="col">Win %</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((p) => {
                // Ties share a place: one more than the number of players strictly ahead.
                const place = 1 + ranked.filter((q) => q.won > p.won || (q.won === p.won && (q.winPct ?? 0) > (p.winPct ?? 0))).length;
                return (
                <tr key={p.id} className={p.id === me ? "me" : ""}>
                  <td>{place === 1 && p.won > 0 ? "♠" : place}</td>
                  <th scope="row">{p.name}</th>
                  <td>{p.won}</td>
                  <td>{p.played}</td>
                  <td>{p.winPct}%</td>
                </tr>
                );
              })}
            </tbody>
          </table>
          <p className="fine">
            {board.games} finished game{board.games === 1 ? "" : "s"}. Games with bots count; bots don't rank.
          </p>

          {board.partners.length > 0 && (
            <>
              <h3>Best partners</h3>
              <ul className="house-list">
                {board.partners.slice(0, 3).map((p) => (
                  <li key={p.ids.join("+")}>
                    <div>
                      <strong>
                        {p.names[0]} &amp; {p.names[1]}
                      </strong>
                      <small>
                        {p.won}–{p.played - p.won} together
                      </small>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(board.highlights.biggestComeback || board.highlights.mostNils) && (
            <ul className="highlights">
              {board.highlights.biggestComeback && (
                <li>
                  <strong>Biggest comeback:</strong> {board.highlights.biggestComeback.names.join(" & ")} came back from {board.highlights.biggestComeback.behindBy} behind to win{" "}
                  {board.highlights.biggestComeback.final[0]}–{board.highlights.biggestComeback.final[1]}.
                </li>
              )}
              {board.highlights.mostNils && (
                <li>
                  <strong>Nil queen or king:</strong> {board.highlights.mostNils.name}, with {board.highlights.mostNils.made} made.
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
