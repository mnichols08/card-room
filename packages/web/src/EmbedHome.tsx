import { PALACE_PRESETS, type PalaceRules } from "@cardroom/palace";
import { isBoardGame, isKitGame, kitGame } from "@cardroom/games";
import type { RulePreset } from "@spades/rules";
import TextField from "@spades/ui/zubra-ui/text-field.zb";
import { useState } from "react";
import { Choice } from "./RulesEditor";
import { OpponentSettings } from "./TableSettings";
import { loadKitRules, loadKitSeats, loadLastPreset, loadName, loadPalaceRules, loadPalaceSeats, saveKitSeats, saveName, savePalaceSeats, starterPresets, type GameId } from "./storage";

/**
 * The card room inside someone's page (the <card-room> embed frames `?embed=1`): just enough to deal
 * a practice game. Anything that needs signing in (family tables, challenges) opens the card room
 * in its own tab, where the browser keeps you signed in.
 */
export function EmbedHome({ game, onPractice }: { game: GameId; onPractice: (name: string, rules: unknown, seats: number) => void }) {
  const kit = isKitGame(game) ? kitGame(game)! : null;
  const [name, setName] = useState(loadName);
  const [seats, setSeats] = useState(() => (kit && isKitGame(game) ? loadKitSeats(game) : loadPalaceSeats()));
  const [ruleId, setRuleId] = useState(() => (isKitGame(game) ? loadKitRules(game).id : game === "palace" ? loadPalaceRules().id : loadLastPreset().id));
  const list: { id: string; name: string }[] = kit ? kit.presets : game === "palace" ? [...PALACE_PRESETS] : starterPresets;
  const seatRange: number[] = kit ? (kit.teams ? [] : Array.from({ length: kit.seats.max - kit.seats.min + 1 }, (_, i) => kit.seats.min + i)) : game === "palace" ? [2, 3, 4, 5, 6] : [];
  return (
    <main className="setup embedded">
      <TextField label="Your name" value={name} maxlength={20} autocomplete="nickname" onValueChange={(e: CustomEvent<string>) => setName(e.detail)} />
      <Choice label="Rules" value={ruleId} options={list.map((p) => [p.id, p.name])} onChange={setRuleId} />
      {seatRange.length > 1 && <Choice label="Players" value={seats} options={seatRange.map((n) => [String(n), `${n} players`])} onChange={(v) => setSeats(Number(v))} />}
      <OpponentSettings />
      <button
        type="button"
        className="primary deal"
        onClick={() => {
          const you = name.trim() || "You";
          saveName(name);
          if (kit && isKitGame(game)) {
            saveKitSeats(game, seats);
            return onPractice(you, kit.presets.find((p: { id: string }) => p.id === ruleId) ?? kit.presets[0], kit.teams ? 4 : seats);
          }
          savePalaceSeats(seats);
          const rules = game === "palace" ? (PALACE_PRESETS.find((p) => p.id === ruleId) ?? PALACE_PRESETS[0]!) : (starterPresets.find((p) => p.id === ruleId) ?? starterPresets[0]!);
          onPractice(you, rules, game === "palace" ? seats : 4);
        }}
      >
        {isBoardGame(game) ? "Play" : "Deal me in"}
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
