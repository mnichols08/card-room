import { OpponentSettings } from "../TableSettings";
import { familyPalace, PALACE_PRESETS, validatePalaceRules, type PalaceRules } from "@cardroom/palace";
import SelectField from "@spades/ui/zubra-ui/select-field.zb";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useMemo, useState } from "react";
import { ChallengeLink } from "../ChallengeLink";
import { GamePicker } from "../GamePicker";
import { Choice } from "../RulesEditor";
import { deletePalacePreset, loadMyHouses, loadName, loadPalaceRules, loadPalaceSeats, loadSavedPalace, savePalacePreset, savePalaceRules, savePalaceSeats, saveName, type GameId } from "../storage";
import { PalaceRulesFields, PalaceRulesSheet } from "./PalaceRules";

interface Props {
  onPickGame: (game: GameId) => void;
  onPractice: (name: string, rules: PalaceRules, seats: number) => void;
  onFamilyTable: (rules: PalaceRules, seats: number) => Promise<void>;
  onOpenHouse: (slug: string) => void;
}

export function PalaceSetup({ onPickGame, onPractice, onFamilyTable, onOpenHouse }: Props) {
  const [name, setName] = useState(loadName);
  const [rules, setRules] = useState<PalaceRules>(loadPalaceRules);
  const [seats, setSeats] = useState(loadPalaceSeats);
  const [saved, setSaved] = useState(loadSavedPalace);
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const myHouses = loadMyHouses();
  const all = useMemo(() => [...PALACE_PRESETS, ...saved], [saved]);
  const options = all.some((p) => p.id === rules.id) ? all : [rules, ...all];
  const errors = validatePalaceRules(rules);
  const isSaved = saved.some((p) => p.id === rules.id);
  const remember = () => {
    saveName(name.trim() || "You");
    savePalaceRules(rules);
    savePalaceSeats(seats);
  };

  function saveAs() {
    const label = window.prompt("Name these rules", PALACE_PRESETS.some((p) => p.id === rules.id) ? `${name}'s Palace` : rules.name);
    if (!label?.trim()) return;
    const id = isSaved && label.trim() === rules.name ? rules.id : `palace-${Date.now()}`;
    const next = { ...rules, id, name: label.trim().slice(0, 30) };
    savePalacePreset(next);
    setSaved(loadSavedPalace());
    setRules(next);
  }

  return (
    <main className="setup">
      <header className="setup-head">
        <div className="suits" aria-hidden>
          🏰
        </div>
        <h1>Palace</h1>
        <p>Get rid of every card. Don't be the last one holding them.</p>
      </header>
      <GamePicker game="palace" onPick={onPickGame} />

      {myHouses.length > 0 && (
        <section className="house-block" aria-label="Your houses">
          <h2>Your houses</h2>
          <ul className="house-list">
            {myHouses.map((h) => (
              <li key={h.slug}>
                <strong>{h.name}</strong>
                <button type="button" className="primary small" onClick={() => onOpenHouse(h.slug)}>
                  Go in
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <TextField label="Your name" value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
      <SelectField
        label="House rules"
        value={rules.id}
        options={options.map((p) => ({ value: p.id, label: p.name }))}
        onValueChange={(e: CustomEvent<string>) => {
          const next = all.find((p) => p.id === e.detail);
          if (next) setRules(next);
        }}
      />
      <Choice label="Players" value={seats} options={[2, 3, 4, 5, 6].map((n) => [String(n), `${n} players`])} onChange={(v) => setSeats(Number(v))} />
      <OpponentSettings />
      <PalaceRulesSheet rules={rules} />

      <button type="button" className="link" onClick={() => setShowRules((v) => !v)}>
        {showRules ? "Hide the rules" : "Change the rules"}
      </button>
      {showRules && (
        <section className="rules" aria-label="Rules">
          <PalaceRulesFields rules={rules} onChange={(patch) => setRules((r) => ({ ...r, ...patch }))} />
          <div className="rule-actions">
            <button type="button" className="secondary" onClick={saveAs} disabled={errors.length > 0}>
              Save these rules
            </button>
            {isSaved && (
              <button
                type="button"
                className="link danger"
                onClick={() => {
                  deletePalacePreset(rules.id);
                  setSaved(loadSavedPalace());
                  setRules(familyPalace);
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
          remember();
          try {
            await onFamilyTable(rules, seats);
          } catch {
            setProblem("Couldn't reach the card room. Try again in a minute.");
            setBusy(false);
          }
        }}
      >
        Start a family table
      </button>
      <button
        type="button"
        className="secondary"
        disabled={errors.length > 0}
        onClick={() => {
          remember();
          onPractice(name.trim() || "You", rules, seats);
        }}
      >
        Practice against the computer
      </button>
      {problem && <p className="error">{problem}</p>}
      <ChallengeLink name={name} palaceRules={rules} />
      <p className="fine">Houses keep Palace rules, tables and a Palace leaderboard too. Make one from the Spades screen.</p>
    </main>
  );
}
