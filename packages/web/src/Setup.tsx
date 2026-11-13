import { validatePreset, type RulePreset } from "@spades/rules";
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
}

export function Setup({ onStart }: Props) {
  const [name, setName] = useState(loadName);
  const [saved, setSaved] = useState(loadSavedPresets);
  const [rules, setRules] = useState<RulePreset>(loadLastPreset);
  const [showRules, setShowRules] = useState(false);
  const all = useMemo(() => [...starterPresets, ...saved], [saved]);
  const errors = validatePreset(rules);
  const isSaved = saved.some((p) => p.id === rules.id);
  const isStarter = starterPresets.some((p) => p.id === rules.id);
  const matchesStored = JSON.stringify(all.find((p) => p.id === rules.id)) === JSON.stringify(rules);

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
        <div className="suits" aria-hidden>♠ ♥ ♣ ♦</div>
        <h1>Spades</h1>
        <p>Pull up a chair.</p>
      </header>

      <label className="field">
        <span>Your spades name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="nickname" />
      </label>

      <label className="field">
        <span>House rules</span>
        <select value={rules.id} onChange={(e) => setRules(all.find((p) => p.id === e.target.value)!)}>
          {!all.some((p) => p.id === rules.id) && <option value={rules.id}>{rules.name}</option>}
          {all.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <p className="rules-summary">{describe(rules)}</p>

      <button type="button" className="link" onClick={() => setShowRules((v) => !v)}>
        {showRules ? "Hide the rules" : "Change the rules"}
      </button>

      {showRules && (
        <section className="rules" aria-label="Rules">
          <Row label="Trump">
            <select value={rules.trump} onChange={(e) => set({ trump: e.target.value as RulePreset["trump"] })}>
              <option value="ace-high">Spades, ace high</option>
              <option value="jokers-and-deuces">Jokers &amp; deuces</option>
            </select>
          </Row>
          <Toggle label="Spades must be broken before they're led" checked={rules.spadesMustBeBroken} onChange={(v) => set({ spadesMustBeBroken: v })} />

          <h3>Nil</h3>
          <Toggle label="Allow nil" checked={rules.nil.enabled} onChange={(v) => set({ nil: { ...rules.nil, enabled: v } })} />
          {rules.nil.enabled && (
            <>
              <NumberRow label="Nil is worth" value={rules.nil.value} step={50} onChange={(v) => set({ nil: { ...rules.nil, value: v } })} />
              <Toggle label="Nil bidder's tricks count toward partner's bid" checked={rules.nilTricksCountTowardBid} onChange={(v) => set({ nilTricksCountTowardBid: v })} />
            </>
          )}

          <h3>Blind nil</h3>
          <Toggle label="Allow blind nil" checked={rules.blindNil.enabled} onChange={(v) => set({ blindNil: { ...rules.blindNil, enabled: v } })} />
          {rules.blindNil.enabled && (
            <>
              <NumberRow label="Blind nil is worth" value={rules.blindNil.value} step={50} onChange={(v) => set({ blindNil: { ...rules.blindNil, value: v } })} />
              <Row label="Only when behind by">
                <select
                  value={rules.blindNil.onlyWhenDownBy ?? "any"}
                  onChange={(e) => set({ blindNil: { ...rules.blindNil, onlyWhenDownBy: e.target.value === "any" ? null : Number(e.target.value) } })}
                >
                  <option value="any">Any time</option>
                  <option value="100">100 or more</option>
                  <option value="200">200 or more</option>
                </select>
              </Row>
              <Row label="Swap with partner">
                <select value={rules.blindNil.passCards} onChange={(e) => set({ blindNil: { ...rules.blindNil, passCards: Number(e.target.value) } })}>
                  <option value={0}>No swap</option>
                  <option value={1}>1 card</option>
                  <option value={2}>2 cards</option>
                  <option value={3}>3 cards</option>
                </select>
              </Row>
            </>
          )}

          <h3>Bags</h3>
          <Toggle label="Bag penalty" checked={rules.bags !== null} onChange={(v) => set({ bags: v ? { limit: 10, penalty: 100 } : null })} />
          {rules.bags && (
            <>
              <NumberRow label="Every this many bags" value={rules.bags.limit} step={1} onChange={(v) => set({ bags: { ...rules.bags!, limit: v } })} />
              <NumberRow label="costs" value={rules.bags.penalty} step={50} onChange={(v) => set({ bags: { ...rules.bags!, penalty: v } })} />
            </>
          )}

          <h3>Game</h3>
          <NumberRow label="Play to" value={rules.playTo} step={50} onChange={(v) => set({ playTo: v })} />
          <Row label="Lose at">
            <select value={rules.loseAt ?? "none"} onChange={(e) => set({ loseAt: e.target.value === "none" ? null : Number(e.target.value) })}>
              <option value="none">No floor</option>
              <option value="-100">-100</option>
              <option value="-150">-150</option>
              <option value="-200">-200</option>
              <option value="-300">-300</option>
            </select>
          </Row>
          <Row label="Team must bid at least">
            <select value={rules.minTeamBid ?? "none"} onChange={(e) => set({ minTeamBid: e.target.value === "none" ? null : Number(e.target.value) })}>
              <option value="none">No minimum</option>
              {[2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Row>

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

      <button type="button" className="primary deal" onClick={start} disabled={errors.length > 0}>
        Deal me in
      </button>
      <p className="fine">You'll play with three computer players for now. Family tables are coming.</p>
    </main>
  );
}

function describe(r: RulePreset): string {
  const parts = [
    r.trump === "jokers-and-deuces" ? "Jokers & deuces" : "Spades ace-high",
    r.nil.enabled ? `nil ${r.nil.value}` : "no nil",
    r.blindNil.enabled ? `blind nil ${r.blindNil.value}` : "no blind nil",
    r.bags ? `${r.bags.limit} bags = −${r.bags.penalty}` : "no bag penalty",
    `play to ${r.playTo}`,
  ];
  return parts.join(" · ");
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="row">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="row toggle">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function NumberRow({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <Row label={label}>
      <input type="number" inputMode="numeric" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </Row>
  );
}
