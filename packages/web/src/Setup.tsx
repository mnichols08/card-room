import { validatePreset, type RulePreset } from "@spades/rules";
import SelectField from "@spades/ui/zubra-ui/select-field.zb";
import { describe, RulesFields, Toggle } from "./RulesEditor";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { ChallengeLink } from "./ChallengeLink";
import { useMemo, useState } from "react";
import { loadFeedbackSettings, play, saveFeedbackSettings, type SoundName } from "./feedback/sounds";
import {
  deleteSavedPreset,
  loadMyHouses,
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
  onOpenHouse: (slug: string) => void;
  /** Make a house with these rules as its first house rules. */
  onMakeHouse: (houseName: string, you: string, preset: RulePreset) => Promise<void>;
}

export function Setup({ onStart, onFamilyTable, onOpenHouse, onMakeHouse }: Props) {
  const [name, setName] = useState(loadName);
  const [saved, setSaved] = useState(loadSavedPresets);
  const [rules, setRules] = useState<RulePreset>(loadLastPreset);
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const myHouses = loadMyHouses();
  const [making, setMaking] = useState(false);
  const [houseName, setHouseName] = useState("");
  const [feedback, setFeedback] = useState(loadFeedbackSettings);
  const canVibrate = typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  const setFeedbackSetting = (patch: Partial<typeof feedback>) => {
    const next = { ...feedback, ...patch };
    saveFeedbackSettings(next);
    setFeedback(next);
  };
  function sample() {
    const tour: SoundName[] = ["deal", "card", "card", "yourTurn", "trickUs", "spadesBroken", "trickThem", "nilMade"];
    let at = 0;
    for (const name of tour) {
      setTimeout(() => play(name), at);
      at += name === "deal" ? 900 : name === "card" ? 300 : 800;
    }
  }
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

      <section className="feedback" aria-label="Sound and vibration">
        <Toggle label="Sounds" description="Cards, your turn, tricks and nils." checked={feedback.sound} onChange={(v) => setFeedbackSetting({ sound: v })} />
        {canVibrate && <Toggle label="Vibration" description="A buzz on your turn and when your team takes a trick." checked={feedback.vibrate} onChange={(v) => setFeedbackSetting({ vibrate: v })} />}
        {feedback.sound && (
          <button type="button" className="link" onClick={sample}>
            Hear the sounds
          </button>
        )}
      </section>

      <button type="button" className="link" onClick={() => setShowRules((v) => !v)}>
        {showRules ? "Hide the rules" : "Change the rules"}
      </button>

      {showRules && (
        <section className="rules" aria-label="Rules">
          <RulesFields rules={rules} onChange={set} />


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

      {!making ? (
        <button type="button" className="link" onClick={() => setMaking(true)}>
          Make a house for your family
        </button>
      ) : (
        <section className="house-block" aria-label="Make a house">
          <h2>Make a house</h2>
          <p className="fine">A house keeps your family's rules and tables in one place, with one invite link that keeps working.</p>
          <TextField label="House name" value={houseName} placeholder={`${name.trim() || "Our"}'s House`} maxlength={30} onValueChange={(e: CustomEvent<string>) => setHouseName(e.detail)} />
          <button
            type="button"
            className="primary"
            disabled={busy || errors.length > 0}
            onClick={async () => {
              setBusy(true);
              setProblem(null);
              const you = name.trim() || "Host";
              saveName(you);
              try {
                await onMakeHouse(houseName.trim() || `${you}'s House`, you, rules);
              } catch {
                setProblem("Couldn't reach the card room. Try again in a minute.");
                setBusy(false);
              }
            }}
          >
            Make the house
          </button>
          <p className="fine">It starts with the house rules chosen above. You can change them, or add more, from the house.</p>
        </section>
      )}
      {problem && <p className="error">{problem}</p>}
      <ChallengeLink name={name} rules={rules} />
      <p className="fine">A family table gets a link to send to everyone. Empty seats can be filled with computer players.</p>
    </main>
  );
}
