import { describePalace, type PalaceRules } from "@cardroom/palace";
import { Choice, Toggle } from "../RulesEditor";

/** The Palace house rules as switches, in the words families use. */
export function PalaceRulesFields({ rules, onChange }: { rules: PalaceRules; onChange: (patch: Partial<PalaceRules>) => void }) {
  return (
    <>
      <Toggle label="2 resets" description="A 2 goes on anything, and anything goes on it." checked={rules.twoResets} onChange={(v) => onChange({ twoResets: v })} />
      <Toggle label="10 burns" description="A 10 goes on anything and burns the pile. You go again." checked={rules.tenBurns} onChange={(v) => onChange({ tenBurns: v })} />
      <Toggle label="Four of a kind burns" description="Four of the same rank on top burns the pile. You go again." checked={rules.fourBurns} onChange={(v) => onChange({ fourBurns: v })} />
      <Toggle label="7 means lower" description="After a 7, the next card must be 7 or lower." checked={rules.sevenLower} onChange={(v) => onChange({ sevenLower: v })} />
      <Toggle label="Swap before play" description="Trade hand cards for face-up cards before the first turn." checked={rules.swap} onChange={(v) => onChange({ swap: v })} />
      <Toggle label="Pick up anytime" description="Take the pile even when you could play." checked={rules.pickUpAnytime} onChange={(v) => onChange({ pickUpAnytime: v })} />
      <Choice label="Cards in hand" value={rules.handSize} options={[["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]]} onChange={(v) => onChange({ handSize: Number(v) })} />
      <Choice label="Face-up and face-down cards" value={rules.tableCards} options={[["2", "2 each"], ["3", "3 each"], ["4", "4 each"]]} onChange={(v) => onChange({ tableCards: Number(v) })} />
    </>
  );
}

/** One line about the rules for a picker. */
export const palaceSummary = (r: PalaceRules) =>
  [r.twoResets && "2 resets", r.tenBurns && "10 burns", r.fourBurns && "four burns", r.sevenLower && "7 lower", `${r.handSize} in hand`].filter(Boolean).join(" · ");

export function PalaceRulesSheet({ rules }: { rules: PalaceRules }) {
  return (
    <ul className="rules-lines">
      {describePalace(rules).map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
