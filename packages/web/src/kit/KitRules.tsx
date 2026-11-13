// House rules for a kit game, drawn from the fields the game lists: toggles, choices and numbers.
import { type CardGame } from "@cardroom/games";
import { Choice, Toggle } from "../RulesEditor";

type Rules = { id: string; name: string } & Record<string, unknown>;

export function KitRulesFields({ game, rules, onChange }: { game: CardGame<any, any, any>; rules: Rules; onChange: (patch: Partial<Rules>) => void }) {
  return (
    <>
      {game.fields.map((f) => {
        if (f.kind === "toggle") return <Toggle key={f.key} label={f.label} description={f.hint} checked={!!rules[f.key]} onChange={(v) => onChange({ [f.key]: v })} />;
        if (f.kind === "choice") {
          const numeric = typeof f.options[0]?.[0] === "number";
          return (
            <Choice
              key={f.key}
              label={f.label}
              value={String(rules[f.key])}
              options={f.options.map(([v, l]) => [String(v), l])}
              onChange={(v) => onChange({ [f.key]: numeric ? Number(v) : v })}
            />
          );
        }
        const options: [string, string][] = [];
        for (let n = f.min; n <= f.max; n += f.step ?? 1) options.push([String(n), String(n)]);
        return <Choice key={f.key} label={f.label} value={String(rules[f.key])} options={options} onChange={(v) => onChange({ [f.key]: Number(v) })} />;
      })}
    </>
  );
}

/** The rules in plain sentences. */
export function KitRulesSheet({ game, rules }: { game: CardGame<any, any, any>; rules: Rules }) {
  return (
    <ul className="rules-lines">
      {game.describe(rules).map((line: string, i: number) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}
