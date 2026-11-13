import { validatePreset, type RulePreset } from "@spades/rules";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useCallback, useEffect, useState } from "react";
import { HouseError, houses, inviteLink, type House, type HouseTable } from "./housesApi";
import { describe, RulesFields } from "./RulesEditor";
import { forgetHouse, loadSavedName, rememberHouse, saveName } from "./storage";

interface Props {
  slug: string;
  /** The invite code, when the page was opened from an invite link. */
  code: string | null;
  onOpenTable: (id: string) => void;
  onLeave: () => void;
}

type State =
  | { kind: "loading" }
  | { kind: "invited"; name: string }
  | { kind: "member"; house: House }
  | { kind: "closed"; message: string };

/** A family's own corner: their tables, their people, their rules. */
export function HousePage({ slug, code, onOpenTable, onLeave }: Props) {
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
  return <MemberView house={house} attempt={attempt} problem={problem} onOpenTable={onOpenTable} onLeave={onLeave} />;
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
  onLeave: () => void;
}) {
  const { house, attempt } = props;
  const canManage = house.me.role === "owner" || house.me.role === "admin";
  const [presetId, setPresetId] = useState(house.defaultPreset);
  // Follow the house default when it changes, or when the chosen rules are deleted.
  useEffect(() => setPresetId(house.defaultPreset), [house.defaultPreset]);
  useEffect(() => {
    if (!house.presets.some((p) => p.id === presetId)) setPresetId(house.defaultPreset);
  }, [house.presets, presetId, house.defaultPreset]);
  const [editing, setEditing] = useState<RulePreset | null>(null);
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
        <button type="button" className="primary deal" onClick={() => attempt(async () => props.onOpenTable((await houses.openTable(house.slug, presetId)).id))}>
          Start a table
        </button>
        <p className="rules-summary">{describe(house.presets.find((p) => p.id === presetId) ?? defaultRules ?? house.presets[0]!)}</p>
      </section>

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
      </section>

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

      {props.problem && <p className="error">{props.problem}</p>}
      <button type="button" className="link" onClick={props.onLeave}>
        Back to the start
      </button>

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

function tableTitle(t: HouseTable): string {
  if (t.summary?.phase === "finished") {
    const [a, b] = t.summary.scores;
    return `Finished · ${a?.points} to ${b?.points}`;
  }
  if (t.started && t.summary) {
    const [a, b] = t.summary.scores;
    return `Hand ${t.summary.hand} · ${a?.points} to ${b?.points}`;
  }
  const seated = t.seats.filter((s) => s.name).length;
  return seated === 0 ? "Waiting for players" : `${seated} of 4 seated`;
}
