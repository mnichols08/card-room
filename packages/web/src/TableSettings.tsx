import { PACES, SKILLS, type TableSettings } from "@spades/rules";
import { useState } from "react";
import { Choice } from "./RulesEditor";
import { loadTableSettings, saveTableSettings } from "./storage";
import { loadDisplay, MOTIONS, saveDisplay, type DisplaySettings } from "./display";

/** Opponents and speed, as two plain pickers. */
export function TableSettingsFields({ settings, onChange }: { settings: TableSettings; onChange: (next: TableSettings) => void }) {
  return (
    <>
      <Choice label="Computer opponents" value={settings.skill} options={SKILLS.map((s) => [s.id, s.label])} onChange={(v) => onChange({ ...settings, skill: v as TableSettings["skill"] })} />
      <p className="fine">{SKILLS.find((s) => s.id === settings.skill)?.hint}</p>
      <Choice label="How fast they play" value={settings.pace} options={PACES.map((p) => [p.id, p.label])} onChange={(v) => onChange({ ...settings, pace: v as TableSettings["pace"] })} />
    </>
  );
}

/** This device's own look: animations and suit colours. Saved at once. */
export function DisplayFields() {
  const [display, setDisplay] = useState(loadDisplay);
  const change = (patch: Partial<DisplaySettings>) => {
    const next = { ...display, ...patch };
    saveDisplay(next);
    setDisplay(next);
  };
  return (
    <>
      <Choice label="Animations" value={display.motion} options={MOTIONS.map((m) => [m.id, m.label])} onChange={(v) => change({ motion: v as DisplaySettings["motion"] })} />
      <p className="fine">{MOTIONS.find((m) => m.id === display.motion)?.hint}</p>
      <Choice
        label="Suit colours"
        value={display.suits}
        options={[
          ["2", "Red and black"],
          ["4", "Four colours: ♦ blue, ♣ green"],
        ]}
        onChange={(v) => change({ suits: v === "4" ? 4 : 2 })}
      />
    </>
  );
}

/** The ⚙︎ at the table: change opponents and speed mid-game. */
export function TableSettingsButton({ settings, onChange }: { settings: TableSettings; onChange: (next: TableSettings) => Promise<void> | void }) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <button type="button" className="settings-toggle" aria-label="Table settings: opponents, speed and animations" aria-expanded={open} onClick={() => setOpen(true)}>
        ⚙︎
      </button>
      {open && (
        <div className="sheet table-settings" role="dialog" aria-label="Table settings">
          <h2>Table settings</h2>
          <TableSettingsFields
            settings={settings}
            onChange={async (next) => {
              setProblem(null);
              try {
                await onChange(next);
              } catch (e) {
                setProblem((e as Error).message);
              }
            }}
          />
          {problem && <p className="error">{problem}</p>}
          <h3>On this device</h3>
          <DisplayFields />
          <button type="button" className="primary" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      )}
    </>
  );
}

/** On a setup screen: the opponents and speed new tables start with, remembered in this browser. */
export function OpponentSettings() {
  const [settings, setSettings] = useState(loadTableSettings);
  return (
    <section className="feedback" aria-label="Computer players and the look of the table">
      <TableSettingsFields
        settings={settings}
        onChange={(next) => {
          saveTableSettings(next);
          setSettings(next);
        }}
      />
      <DisplayFields />
    </section>
  );
}
