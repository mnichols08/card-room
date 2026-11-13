import { PALACE_PRESETS, type PalaceRules } from "@cardroom/palace";
import type { RulePreset } from "@spades/rules";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useState } from "react";
import { Choice } from "./RulesEditor";
import { OpponentSettings } from "./TableSettings";
import { loadLastPreset, loadName, loadPalaceRules, loadPalaceSeats, saveName, savePalaceSeats, starterPresets, type GameId } from "./storage";

/**
 * The card room inside someone's page (the <card-room> embed frames `?embed=1`): just enough to deal
 * a practice game. Anything that needs signing in (family tables, challenges) opens the card room
 * in its own tab, where the browser keeps you signed in.
 */
export function EmbedHome({ game, onPractice }: { game: GameId; onPractice: (name: string, rules: RulePreset | PalaceRules, seats: number) => void }) {
  const [name, setName] = useState(loadName);
  const [seats, setSeats] = useState(loadPalaceSeats);
  const [ruleId, setRuleId] = useState(() => (game === "palace" ? loadPalaceRules().id : loadLastPreset().id));
  const list: { id: string; name: string }[] = game === "palace" ? [...PALACE_PRESETS] : starterPresets;
  return (
    <main className="setup embedded">
      <TextField label="Your name" value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
      <Choice label="Rules" value={ruleId} options={list.map((p) => [p.id, p.name])} onChange={setRuleId} />
      {game === "palace" && <Choice label="Players" value={seats} options={[2, 3, 4, 5, 6].map((n) => [String(n), `${n} players`])} onChange={(v) => setSeats(Number(v))} />}
      <OpponentSettings />
      <button
        type="button"
        className="primary deal"
        onClick={() => {
          const you = name.trim() || "You";
          saveName(you);
          savePalaceSeats(seats);
          const rules = game === "palace" ? (PALACE_PRESETS.find((p) => p.id === ruleId) ?? PALACE_PRESETS[0]!) : (starterPresets.find((p) => p.id === ruleId) ?? starterPresets[0]!);
          onPractice(you, rules, game === "palace" ? seats : 4);
        }}
      >
        Deal me in
      </button>
      <p className="fine">
        You'll play against the computer right here.{" "}
        <a href={`${location.origin}${location.pathname}?game=${game}`} target="_blank" rel="noopener">
          Family tables are in the card room ↗
        </a>
      </p>
    </main>
  );
}
