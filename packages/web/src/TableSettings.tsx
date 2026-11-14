import { PACES, SKILLS, TURN_TIMERS, type TableSettings } from "@spades/rules";
import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Choice } from "./RulesEditor";
import { ReportLink } from "./ReportProblem";
import { loadTableSettings, saveTableSettings } from "./storage";
import {
  loadDisplay,
  MOTIONS,
  saveDisplay,
  type DisplaySettings,
} from "./display";

/**
 * Whether these settings are a table's on the server. Only there is a turn timer offered: the server
 * keeps the time, and a game on this device alone has nobody waiting on you.
 */
export const OnlineTable = createContext(false);

/** One other seat at a table on the server, and what this device may do about it. */
export interface TablePlayer {
  seat: number;
  name: string;
  bot: boolean;
  /** Their chat is hidden on this device. */
  hidden: boolean;
  /** The host has muted them for everyone. */
  muted: boolean;
}
export interface TablePlayersValue {
  players: TablePlayer[];
  /** Hide or show someone's chat, on this device only. */
  hide: (seat: number, hidden: boolean) => void;
  /** For the table's host, at a table that is or was open to everyone. */
  mute?: (seat: number, muted: boolean) => Promise<unknown>;
  remove?: (seat: number) => Promise<unknown>;
}
/** The other players at a table on the server, for the ⚙︎ sheet. Null at a table on this device. */
export const TablePlayers = createContext<TablePlayersValue | null>(null);

/** The people (and bots) you're playing with: hide someone's chat; the host can mute or remove them. */
export function PlayersFields() {
  const table = useContext(TablePlayers);
  const [problem, setProblem] = useState<string | null>(null);
  if (!table || table.players.length === 0) return null;
  const attempt = (work: () => Promise<unknown>) => {
    setProblem(null);
    work().catch((e: Error) => setProblem(e.message));
  };
  return (
    <>
      <h3>Players</h3>
      <ul className="player-tools">
        {table.players.map((p) => (
          <li key={p.seat}>
            <strong>
              {p.name}
              {p.bot && <small> (bot)</small>}
              {p.muted && <small> · muted</small>}
            </strong>
            <span>
              <button type="button" className="link" onClick={() => table.hide(p.seat, !p.hidden)}>
                {p.hidden ? "Show chat" : "Hide chat"}
              </button>
              {!p.bot && table.mute && (
                <button type="button" className="link" onClick={() => attempt(() => table.mute!(p.seat, !p.muted))}>
                  {p.muted ? "Unmute" : "Mute"}
                </button>
              )}
              {!p.bot && table.remove && (
                <button
                  type="button"
                  className="link danger"
                  onClick={() => {
                    if (window.confirm(`Remove ${p.name} from the table? A computer player takes their seat, and they can't come back to this table.`)) attempt(() => table.remove!(p.seat));
                  }}
                >
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {problem && <p className="error">{problem}</p>}
    </>
  );
}

/** The turn timer: how long a person has for a move before the computer makes it for them. */
export function TurnTimerField({
  settings,
  onChange,
}: {
  settings: TableSettings;
  onChange: (next: TableSettings) => void;
}) {
  return (
    <>
      <Choice
        label="Time for each move"
        value={settings.timer ?? "off"}
        options={TURN_TIMERS.map((t) => [t.id, t.label])}
        onChange={(v) => {
          const { timer: _was, ...rest } = settings;
          onChange(v === "off" ? rest : { ...rest, timer: v as TableSettings["timer"] });
        }}
      />
      <p className="fine">
        {settings.timer
          ? "When someone's time runs out, the computer makes their move, so the game keeps going."
          : "The game waits for everyone, however long they take."}
      </p>
    </>
  );
}

/** Opponents and speed, as two plain pickers; at a table on the server, the turn timer too. */
export function TableSettingsFields({
  settings,
  onChange,
}: {
  settings: TableSettings;
  onChange: (next: TableSettings) => void;
}) {
  const online = useContext(OnlineTable);
  return (
    <>
      {online && <TurnTimerField settings={settings} onChange={onChange} />}
      <Choice
        label="Computer opponents"
        value={settings.skill}
        options={SKILLS.map((s) => [s.id, s.label])}
        onChange={(v) =>
          onChange({ ...settings, skill: v as TableSettings["skill"] })
        }
      />
      <p className="fine">
        {SKILLS.find((s) => s.id === settings.skill)?.hint}
      </p>
      <Choice
        label="How fast they play"
        value={settings.pace}
        options={PACES.map((p) => [p.id, p.label])}
        onChange={(v) =>
          onChange({ ...settings, pace: v as TableSettings["pace"] })
        }
      />
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
      <Choice
        label="Animations"
        value={display.motion}
        options={MOTIONS.map((m) => [m.id, m.label])}
        onChange={(v) => change({ motion: v as DisplaySettings["motion"] })}
      />
      <p className="fine">
        {MOTIONS.find((m) => m.id === display.motion)?.hint}
      </p>
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
export function TableSettingsButton({
  settings,
  onChange,
}: {
  settings: TableSettings;
  onChange: (next: TableSettings) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="settings-toggle"
        aria-label="Table settings: opponents, speed and animations"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        ⚙︎
      </button>
      {open &&
        createPortal(
          <>
            {/* On the page itself, above everything at the table (the bar it opens from is a layer of its own). */}
            <div className="sheet-backdrop" onClick={() => setOpen(false)} />
            <SettingsEscape onClose={() => setOpen(false)} />
            <div
              className="sheet table-settings"
              role="dialog"
              aria-modal="true"
              aria-label="Table settings"
            >
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
              <PlayersFields />
              <h3>On this device</h3>
              <DisplayFields />
              <ReportLink before={() => setOpen(false)} />
              <button
                type="button"
                className="primary"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

/** Escape closes the settings, as it would any dialog. */
function SettingsEscape({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return null;
}

/** On a setup screen: the opponents and speed new tables start with, remembered in this browser. */
export function OpponentSettings() {
  const [settings, setSettings] = useState(loadTableSettings);
  return (
    <section
      className="feedback"
      aria-label="Computer players and the look of the table"
    >
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
