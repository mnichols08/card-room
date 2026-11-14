// The setup screen for any kit game: your name, house rules, how many players, then a family table
// or practice against the computer.
import { kitGame, type KitGameId } from "@cardroom/games";
import SelectField from "@spades/ui/zubra-ui/select-field.zb";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useMemo, useState } from "react";
import { ChallengeLink } from "../ChallengeLink";
import { Choice } from "../RulesEditor";
import { SetupLayout } from "../SetupLayout";
import {
  deleteKitPreset,
  loadKitRules,
  loadKitSeats,
  loadMyHouses,
  loadName,
  loadSavedKit,
  saveKitPreset,
  saveKitRules,
  saveKitSeats,
  saveName,
  type GameId,
} from "../storage";
import { OpponentSettings } from "../TableSettings";
import { KitRulesFields, KitRulesSheet } from "./KitRules";

type Rules = { id: string; name: string } & Record<string, unknown>;

interface Props {
  game: KitGameId;
  /** Back to the Card Room's front page, with every game. */
  onHome: () => void;
  onPractice: (name: string, rules: Rules, seats: number) => void;
  onFamilyTable: (rules: Rules, seats: number) => Promise<void>;
  onOpenHouse: (slug: string) => void;
}

export function KitSetup({
  game: id,
  onHome,
  onPractice,
  onFamilyTable,
  onOpenHouse,
}: Props) {
  const game = kitGame(id)!;
  const [name, setName] = useState(loadName);
  const [rules, setRules] = useState<Rules>(() => loadKitRules(id));
  const [seats, setSeats] = useState(() => loadKitSeats(id));
  const [saved, setSaved] = useState(() => loadSavedKit(id));
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const myHouses = loadMyHouses();
  const all: Rules[] = useMemo(() => [...game.presets, ...saved], [saved, id]);
  const options = all.some((p) => p.id === rules.id) ? all : [rules, ...all];
  const errors: string[] = game.validate(rules);
  const isSaved = saved.some((p) => p.id === rules.id);
  const remember = () => {
    saveName(name);
    saveKitRules(id, rules);
    saveKitSeats(id, seats);
  };

  function saveAs() {
    const label = window.prompt(
      "Name these rules",
      game.presets.some((p: Rules) => p.id === rules.id)
        ? `${name.trim() || "My"}'s ${game.name}`
        : rules.name,
    );
    if (!label?.trim()) return;
    const next = {
      ...rules,
      id:
        isSaved && label.trim() === rules.name
          ? rules.id
          : `${id}-${Date.now()}`,
      name: label.trim().slice(0, 30),
    };
    saveKitPreset(id, next);
    setSaved(loadSavedKit(id));
    setRules(next);
  }

  const seatChoices: [string, string][] = [];
  for (let n = game.seats.min; n <= game.seats.max; n++)
    seatChoices.push([String(n), `${n} players`]);

  const houses =
    myHouses.length > 0 ? (
      <section className="house-block" aria-label="Your houses">
        <h2>Your houses</h2>
        <ul className="house-list">
          {myHouses.map((h) => (
            <li key={h.slug}>
              <strong>{h.name}</strong>
              <button
                type="button"
                className="primary small"
                onClick={() => onOpenHouse(h.slug)}
              >
                Go in
              </button>
            </li>
          ))}
        </ul>
      </section>
    ) : null;

  return (
    <SetupLayout
      emoji={game.emoji}
      title={game.name}
      tagline={game.tagline}
      onHome={onHome}
      houses={houses}
      you={
        <>
          <TextField
            label="Your name"
            value={name}
            maxlength={20}
            autocomplete="nickname"
            onValueChange={(e: CustomEvent<string>) => setName(e.detail)}
          />
          <SelectField
            label="House rules"
            value={rules.id}
            options={options.map((p) => ({ value: p.id, label: p.name }))}
            onValueChange={(e: CustomEvent<string>) => {
              const next = all.find((p) => p.id === e.detail);
              if (next) setRules(next);
            }}
          />
          {game.teams ? (
            <p className="fine">
              Four players: you and your partner across the table against the
              other two.
            </p>
          ) : (
            seatChoices.length > 1 && (
              <Choice
                label="Players"
                value={seats}
                options={seatChoices}
                onChange={(v) => setSeats(Number(v))}
              />
            )
          )}
        </>
      }
      table={<OpponentSettings />}
      about={
        <>
          <KitRulesSheet game={game} rules={rules} />
          <button
            type="button"
            className="link"
            onClick={() => setShowRules((v) => !v)}
          >
            {showRules ? "Hide the rules" : "Change the rules"}
          </button>
          {showRules && (
            <section className="rules" aria-label="Rules">
              <KitRulesFields
                game={game}
                rules={rules}
                onChange={(patch) => setRules((r) => ({ ...r, ...patch }))}
              />
              <div className="rule-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={saveAs}
                  disabled={errors.length > 0}
                >
                  Save these rules
                </button>
                {isSaved && (
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => {
                      deleteKitPreset(id, rules.id);
                      setSaved(loadSavedKit(id));
                      setRules(game.presets[0]);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              {errors.length > 0 && <p className="error">{errors.join(" ")}</p>}
            </section>
          )}
        </>
      }
      actions={
        <>
          {game.seats.max > 1 && (
            <button
              type="button"
              className="primary deal"
              disabled={errors.length > 0 || busy}
              onClick={async () => {
                setBusy(true);
                setProblem(null);
                remember();
                try {
                  await onFamilyTable(rules, game.teams ? 4 : seats);
                } catch {
                  setProblem(
                    "Couldn't reach the card room. Try again in a minute.",
                  );
                  setBusy(false);
                }
              }}
            >
              Start a family table
            </button>
          )}
          <button
            type="button"
            className={game.seats.max > 1 ? "secondary" : "primary deal"}
            disabled={errors.length > 0}
            onClick={() => {
              remember();
              onPractice(name.trim() || "You", rules, game.teams ? 4 : seats);
            }}
          >
            {game.seats.max > 1 ? "Practice against the computer" : "Deal"}
          </button>
          {problem && <p className="error">{problem}</p>}
        </>
      }
      more={
        <>
          {game.seats.max > 1 && (
            <ChallengeLink name={name} kitRules={{ [id]: rules }} />
          )}
          {game.seats.max > 1 ? (
            <p className="fine">
              Houses keep {game.name} rules, tables and a leaderboard too. Make
              one from the Spades screen.
            </p>
          ) : (
            <p className="fine">A game just for you: nobody's waiting on you, so take your time.</p>
          )}
        </>
      }
    />
  );
}
