// A kit game in a house: open a table with the house's rules, and keep those rules.
import { kitGame, type KitGameId } from "@cardroom/games";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useEffect, useState } from "react";
import { houses, type House, type KitRules } from "../housesApi";
import { Choice } from "../RulesEditor";
import { loadKitSeats, loadTableSettings, saveKitSeats } from "../storage";
import { KitRulesFields } from "./KitRules";

type Attempt = (work: () => Promise<House | void>) => Promise<void>;

export function KitStartTable({ house, game: id, attempt, onOpenTable }: { house: House; game: KitGameId; attempt: Attempt; onOpenTable: (id: string) => void }) {
  const game = kitGame(id)!;
  const rules = house.kitRules[id] ?? { presets: game.presets, default: game.presets[0].id };
  const [presetId, setPresetId] = useState(rules.default);
  const [seats, setSeats] = useState(() => loadKitSeats(id));
  useEffect(() => setPresetId(rules.default), [rules.default, id]);
  const chosen = rules.presets.find((p) => p.id === presetId) ?? rules.presets[0]!;
  const seatChoices: [string, string][] = [];
  for (let n = game.seats.min; n <= game.seats.max; n++) seatChoices.push([String(n), `${n} players`]);
  return (
    <section className="house-block" aria-label="Start a table">
      {rules.presets.length > 1 && (
        <label className="field-inline">
          <span>Rules</span>
          <select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {rules.presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === rules.default ? " (house default)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {!game.teams && seatChoices.length > 1 && <Choice label="Players" value={seats} options={seatChoices} onChange={(v) => setSeats(Number(v))} />}
      <button
        type="button"
        className="primary deal"
        onClick={() =>
          attempt(async () => {
            saveKitSeats(id, seats);
            onOpenTable((await houses.openTable(house.slug, chosen.id, id, game.teams ? 4 : seats, loadTableSettings())).id);
          })
        }
      >
        Start a {game.name} table
      </button>
      <p className="rules-summary">{game.describe(chosen).slice(0, 2).join(" ")}</p>
    </section>
  );
}

export function KitHouseRules({ house, game: id, attempt, canManage }: { house: House; game: KitGameId; attempt: Attempt; canManage: boolean }) {
  const game = kitGame(id)!;
  const rules = house.kitRules[id] ?? { presets: game.presets, default: game.presets[0].id };
  const [editing, setEditing] = useState<KitRules | null>(null);
  return (
    <section className="house-block" aria-label={`${game.name} house rules`}>
      <h2>{game.name} house rules</h2>
      <ul className="house-list">
        {rules.presets.map((p) => (
          <li key={p.id}>
            <div>
              <strong>
                {p.name}
                {p.id === rules.default && <em> house default</em>}
              </strong>
              <small>{game.describe(p)[1]}</small>
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
        <button type="button" className="link" onClick={() => setEditing({ ...structuredClone(rules.presets[0]!), id: "", name: "New rules" })}>
          Add another set of rules
        </button>
      )}
      {editing && (
        <KitRulesEditor
          game={id}
          rules={editing}
          isDefault={editing.id === rules.default}
          canDelete={!!editing.id && rules.presets.length > 1}
          onClose={() => setEditing(null)}
          onSave={(r, makeDefault) =>
            attempt(async () => {
              const saved = await houses.saveKit(house.slug, id, r, makeDefault);
              setEditing(null);
              return saved;
            })
          }
          onDelete={() =>
            attempt(async () => {
              const saved = await houses.deleteKit(house.slug, id, editing.id);
              setEditing(null);
              return saved;
            })
          }
        />
      )}
    </section>
  );
}

function KitRulesEditor(props: { game: KitGameId; rules: KitRules; isDefault: boolean; canDelete: boolean; onClose: () => void; onSave: (rules: KitRules, makeDefault: boolean) => void; onDelete: () => void }) {
  const game = kitGame(props.game)!;
  const [rules, setRules] = useState(props.rules);
  const [makeDefault, setMakeDefault] = useState(props.isDefault);
  const errors: string[] = game.validate(rules);
  return (
    <div className="rules-sheet" role="dialog" aria-label={`Edit ${game.name} house rules`}>
      <div className="rules-sheet-body setup">
        <TextField label="Name of these rules" value={rules.name} maxlength={30} onValueChange={(e: CustomEvent<string>) => setRules((r) => ({ ...r, name: e.detail }))} />
        <section className="rules">
          <KitRulesFields game={game} rules={rules} onChange={(patch) => setRules((r) => ({ ...r, ...patch }))} />
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
