import { validatePreset, type RulePreset } from "@spades/rules";
import SelectField from "@spades/ui/zubra-ui/select-field.zb";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import ToggleSwitch from "@spades/ui/zubra-ui/toggle-switch.zb";
import { useMemo, useState } from "react";
import {
  deleteSavedPreset,
  loadLastPreset,
  loadName,
  loadSavedPresets,
  saveLastPreset,
  saveName,
  savePreset,
  starterPresets,
} from "./storage";

interface Props {
  onStart: (name: string, preset: RulePreset) => void;
  /** Start a table on the server with these rules. Rejects when the server can't be reached. */
  onFamilyTable: (preset: RulePreset) => Promise<void>;
}

export function Setup({ onStart, onFamilyTable }: Props) {
  const [name, setName] = useState(loadName);
  const [saved, setSaved] = useState(loadSavedPresets);
  const [rules, setRules] = useState<RulePreset>(loadLastPreset);
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const all = useMemo(() => [...starterPresets, ...saved], [saved]);
  const errors = validatePreset(rules);
  const isSaved = saved.some((p) => p.id === rules.id);
  const isStarter = starterPresets.some((p) => p.id === rules.id);
  const matchesStored = JSON.stringify(all.find((p) => p.id === rules.id)) === JSON.stringify(rules);
  const presetOptions = all.some((p) => p.id === rules.id) ? all : [rules, ...all];

  const set = (patch: Partial<RulePreset>) => setRules((r) => ({ ...r, ...patch }));

  function saveAs() {
    const label = window.prompt("Name these rules", isStarter ? `${name}'s rules` : rules.name);
    if (!label?.trim()) return;
    const id = isSaved && label.trim() === rules.name ? rules.id : `custom-${Date.now()}`;
    const preset = { ...rules, id, name: label.trim() };
    savePreset(preset);
    setSaved(loadSavedPresets());
    setRules(preset);
  }

  function start() {
    const trimmed = name.trim() || "You";
    saveName(trimmed);
    saveLastPreset(rules);
    onStart(trimmed, rules);
  }

  return (
    <main className="setup">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          ♠ ♥ ♣ ♦
        </div>
        <h1>Spades</h1>
        <p>Pull up a chair.</p>
      </header>

      <TextField label="Your spades name" value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />

      <SelectField
        label="House rules"
        value={rules.id}
        options={presetOptions.map((p) => ({ value: p.id, label: p.name }))}
        onValueChange={(e: CustomEvent<string>) => {
          const next = all.find((p) => p.id === e.detail);
          if (next) setRules(next);
        }}
      />

      <p className="rules-summary">{describe(rules)}</p>

      <button type="button" className="link" onClick={() => setShowRules((v) => !v)}>
        {showRules ? "Hide the rules" : "Change the rules"}
      </button>

      {showRules && (
        <section className="rules" aria-label="Rules">
          <Choice
            label="Trump"
            value={rules.trump}
            options={[
              ["ace-high", "Spades, ace high"],
              ["jokers-and-deuces", "Jokers & deuces"],
            ]}
            onChange={(v) => set({ trump: v as RulePreset["trump"] })}
          />
          <Toggle label="Spades must be broken" description="Nobody leads a spade until one has been played." checked={rules.spadesMustBeBroken} onChange={(v) => set({ spadesMustBeBroken: v })} />

          <h3>Nil</h3>
          <Toggle label="Allow nil" checked={rules.nil.enabled} onChange={(v) => set({ nil: { ...rules.nil, enabled: v } })} />
          {rules.nil.enabled && (
            <>
              <Choice label="Nil is worth" value={rules.nil.value} options={points([50, 100, 150, 200], rules.nil.value)} onChange={(v) => set({ nil: { ...rules.nil, value: Number(v) } })} />
              <Toggle
                label="Nil tricks help partner"
                description="Tricks the nil bidder takes count toward the partner's bid instead of as bags."
                checked={rules.nilTricksCountTowardBid}
                onChange={(v) => set({ nilTricksCountTowardBid: v })}
              />
            </>
          )}

          <h3>Blind nil</h3>
          <Toggle label="Allow blind nil" checked={rules.blindNil.enabled} onChange={(v) => set({ blindNil: { ...rules.blindNil, enabled: v } })} />
          {rules.blindNil.enabled && (
            <>
              <Choice label="Blind nil is worth" value={rules.blindNil.value} options={points([100, 200, 300, 400], rules.blindNil.value)} onChange={(v) => set({ blindNil: { ...rules.blindNil, value: Number(v) } })} />
              <Choice
                label="Only when behind by"
                value={rules.blindNil.onlyWhenDownBy ?? "any"}
                options={[
                  ["any", "Any time"],
                  ["100", "100 or more"],
                  ["200", "200 or more"],
                ]}
                onChange={(v) => set({ blindNil: { ...rules.blindNil, onlyWhenDownBy: v === "any" ? null : Number(v) } })}
              />
              <Choice
                label="Swap with partner"
                value={rules.blindNil.passCards}
                options={[
                  ["0", "No swap"],
                  ["1", "1 card"],
                  ["2", "2 cards"],
                  ["3", "3 cards"],
                ]}
                onChange={(v) => set({ blindNil: { ...rules.blindNil, passCards: Number(v) } })}
              />
            </>
          )}

          <h3>Bags</h3>
          <Toggle label="Bag penalty" checked={rules.bags !== null} onChange={(v) => set({ bags: v ? { limit: 10, penalty: 100 } : null })} />
          {rules.bags && (
            <>
              <Choice label="Every this many bags" value={rules.bags.limit} options={points([5, 8, 10, 15], rules.bags.limit)} onChange={(v) => set({ bags: { ...rules.bags!, limit: Number(v) } })} />
              <Choice label="costs" value={rules.bags.penalty} options={points([50, 100, 150, 200], rules.bags.penalty)} onChange={(v) => set({ bags: { ...rules.bags!, penalty: Number(v) } })} />
            </>
          )}

          <h3>Game</h3>
          <Choice label="Play to" value={rules.playTo} options={points([200, 250, 300, 400, 500, 600], rules.playTo)} onChange={(v) => set({ playTo: Number(v) })} />
          <Choice
            label="Lose at"
            value={rules.loseAt ?? "none"}
            options={[["none", "No floor"], ...points([-100, -150, -200, -300], rules.loseAt ?? -200)]}
            onChange={(v) => set({ loseAt: v === "none" ? null : Number(v) })}
          />
          <Choice
            label="Team must bid at least"
            value={rules.minTeamBid ?? "none"}
            options={[["none", "No minimum"], ...points([2, 3, 4, 5], rules.minTeamBid ?? 4)]}
            onChange={(v) => set({ minTeamBid: v === "none" ? null : Number(v) })}
          />

          <div className="rule-actions">
            <button type="button" className="secondary" onClick={saveAs} disabled={errors.length > 0}>
              {matchesStored ? "Save a copy" : "Save these rules"}
            </button>
            {isSaved && (
              <button
                type="button"
                className="link danger"
                onClick={() => {
                  deleteSavedPreset(rules.id);
                  setSaved(loadSavedPresets());
                  setRules(starterPresets[0]!);
                }}
              >
                Delete
              </button>
            )}
          </div>
          {errors.length > 0 && <p className="error">{errors.join(" ")}</p>}
        </section>
      )}

      <button
        type="button"
        className="primary deal"
        disabled={errors.length > 0 || busy}
        onClick={async () => {
          setBusy(true);
          setProblem(null);
          saveName(name.trim() || "You");
          saveLastPreset(rules);
          try {
            await onFamilyTable(rules);
          } catch {
            setProblem("Couldn't reach the card room. Try again in a minute.");
            setBusy(false);
          }
        }}
      >
        Start a family table
      </button>
      <button type="button" className="secondary" onClick={start} disabled={errors.length > 0}>
        Practice against the computer
      </button>
      {problem && <p className="error">{problem}</p>}
      <p className="fine">A family table gets a link to send to everyone. Empty seats can be filled with computer players.</p>
    </main>
  );
}

function describe(r: RulePreset): string {
  return [
    r.trump === "jokers-and-deuces" ? "Jokers & deuces" : "Spades ace-high",
    r.nil.enabled ? `nil ${r.nil.value}` : "no nil",
    r.blindNil.enabled ? `blind nil ${r.blindNil.value}` : "no blind nil",
    r.bags ? `${r.bags.limit} bags = −${r.bags.penalty}` : "no bag penalty",
    `play to ${r.playTo}`,
  ].join(" · ");
}

/** Number choices as select options, keeping the current value even if it isn't one of them. */
function points(choices: number[], current: number): [string, string][] {
  const all = choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
  return all.map((n) => [String(n), String(n)]);
}

function Toggle(props: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <ToggleSwitch
      label={props.label}
      description={props.description ?? ""}
      checked={props.checked}
      onCheckedChange={(e: CustomEvent<boolean>) => props.onChange(e.detail)}
    />
  );
}

function Choice(props: { label: string; value: string | number; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <SelectField
      label={props.label}
      value={String(props.value)}
      options={props.options.map(([value, label]) => ({ value, label }))}
      onValueChange={(e: CustomEvent<string>) => props.onChange(e.detail)}
    />
  );
}
