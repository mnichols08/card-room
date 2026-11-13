import type { RulePreset } from "@spades/rules";
import SelectField from "@spades/ui/zubra-ui/select-field.zb";
import ToggleSwitch from "@spades/ui/zubra-ui/toggle-switch.zb";

/** Every house rule as a form. Used on the setup screen and in a house's rules. */
export function RulesFields({ rules, onChange: set }: { rules: RulePreset; onChange: (patch: Partial<RulePreset>) => void }) {
  return (
    <>
    <Choice
      label="Trump"
      value={rules.trump}
      options={[
        ["ace-high", "Spades, ace high"],
        ["jokers-and-deuces", "Jokers & deuces"],
      ]}
      onChange={(v) => set({ trump: v as RulePreset["trump"] })}
    />
    <Toggle label="Spades must be broken" description="Nobody leads a spade until one has been played." checked={rules.spadesMustBeBroken} onChange={(v) => set({ spadesMustBeBroken: v })} />

    <h3>Nil</h3>
    <Toggle label="Allow nil" checked={rules.nil.enabled} onChange={(v) => set({ nil: { ...rules.nil, enabled: v } })} />
    {rules.nil.enabled && (
      <>
        <Choice label="Nil is worth" value={rules.nil.value} options={points([50, 100, 150, 200], rules.nil.value)} onChange={(v) => set({ nil: { ...rules.nil, value: Number(v) } })} />
        <Toggle
          label="Nil tricks help partner"
          description="Tricks the nil bidder takes count toward the partner's bid instead of as bags."
          checked={rules.nilTricksCountTowardBid}
          onChange={(v) => set({ nilTricksCountTowardBid: v })}
        />
      </>
    )}

    <h3>Blind nil</h3>
    <Toggle label="Allow blind nil" checked={rules.blindNil.enabled} onChange={(v) => set({ blindNil: { ...rules.blindNil, enabled: v } })} />
    {rules.blindNil.enabled && (
      <>
        <Choice label="Blind nil is worth" value={rules.blindNil.value} options={points([100, 200, 300, 400], rules.blindNil.value)} onChange={(v) => set({ blindNil: { ...rules.blindNil, value: Number(v) } })} />
        <Choice
          label="Only when behind by"
          value={rules.blindNil.onlyWhenDownBy ?? "any"}
          options={[
            ["any", "Any time"],
            ["100", "100 or more"],
            ["200", "200 or more"],
          ]}
          onChange={(v) => set({ blindNil: { ...rules.blindNil, onlyWhenDownBy: v === "any" ? null : Number(v) } })}
        />
        <Choice
          label="Swap with partner"
          value={rules.blindNil.passCards}
          options={[
            ["0", "No swap"],
            ["1", "1 card"],
            ["2", "2 cards"],
            ["3", "3 cards"],
          ]}
          onChange={(v) => set({ blindNil: { ...rules.blindNil, passCards: Number(v) } })}
        />
      </>
    )}

    <h3>Bags</h3>
    <Toggle label="Bag penalty" checked={rules.bags !== null} onChange={(v) => set({ bags: v ? { limit: 10, penalty: 100 } : null })} />
    {rules.bags && (
      <>
        <Choice label="Every this many bags" value={rules.bags.limit} options={points([5, 8, 10, 15], rules.bags.limit)} onChange={(v) => set({ bags: { ...rules.bags!, limit: Number(v) } })} />
        <Choice label="costs" value={rules.bags.penalty} options={points([50, 100, 150, 200], rules.bags.penalty)} onChange={(v) => set({ bags: { ...rules.bags!, penalty: Number(v) } })} />
      </>
    )}

    <h3>Game</h3>
    <Choice label="Play to" value={rules.playTo} options={points([200, 250, 300, 400, 500, 600], rules.playTo)} onChange={(v) => set({ playTo: Number(v) })} />
    <Choice
      label="Lose at"
      value={rules.loseAt ?? "none"}
      options={[["none", "No floor"], ...points([-100, -150, -200, -300], rules.loseAt ?? -200)]}
      onChange={(v) => set({ loseAt: v === "none" ? null : Number(v) })}
    />
    <Choice
      label="Team must bid at least"
      value={rules.minTeamBid ?? "none"}
      options={[["none", "No minimum"], ...points([2, 3, 4, 5], rules.minTeamBid ?? 4)]}
      onChange={(v) => set({ minTeamBid: v === "none" ? null : Number(v) })}
    />
    </>
  );
}

export function describe(r: RulePreset): string {
  return [
    r.trump === "jokers-and-deuces" ? "Jokers & deuces" : "Spades ace-high",
    r.nil.enabled ? `nil ${r.nil.value}` : "no nil",
    r.blindNil.enabled ? `blind nil ${r.blindNil.value}` : "no blind nil",
    r.bags ? `${r.bags.limit} bags = −${r.bags.penalty}` : "no bag penalty",
    `play to ${r.playTo}`,
  ].join(" · ");
}

/** The rules in a few plain sentences, for the setup screen. */
export function explain(r: RulePreset): string[] {
  const lines = [
    "Partners across. Thirteen cards each: bid how many tricks you'll take, and your bid adds to your partner's.",
    r.trump === "jokers-and-deuces"
      ? "Jokers and deuces: the 2♣ and 2♥ come out, and the top trumps are the Big Joker, Little Joker, 2♦ and 2♠, then the A♠ on down."
      : "Spades are always trump, ace high.",
    `Follow suit if you can; the highest card of the suit led wins, unless someone trumps.${r.spadesMustBeBroken ? " Spades can't be led until one has been played (unless that's all you have)." : ""}`,
    `Make your team's bid for 10 a trick, plus 1 for each extra trick (a bag). Fall short and you lose 10 a trick.${r.bags ? ` Every ${r.bags.limit} bags costs ${r.bags.penalty}.` : ""}`,
  ];
  if (r.minTeamBid !== null) lines.push(`Each team bids at least ${r.minTeamBid} between the two of you.`);
  if (r.nil.enabled)
    lines.push(`Nil: bid to take no tricks at all, for ${r.nil.value} (or −${r.nil.value} if you take one). ${r.nilTricksCountTowardBid ? "A nil bidder's tricks still count toward the partner's bid." : "A nil bidder's tricks only count as bags."}`);
  if (r.blindNil.enabled)
    lines.push(
      `Blind nil: bid nil before you look at your cards, for ${r.blindNil.value}${r.blindNil.onlyWhenDownBy !== null ? `, only when your team is down by ${r.blindNil.onlyWhenDownBy} or more` : ""}${r.blindNil.passCards ? `; then you and your partner swap ${r.blindNil.passCards} cards` : ""}.`,
    );
  lines.push(`First team to ${r.playTo} wins${r.loseAt !== null ? `; a team at ${r.loseAt} or below loses` : ""}.`);
  return lines;
}

/** Number choices as select options, keeping the current value even if it isn't one of them. */
export function points(choices: number[], current: number): [string, string][] {
  const all = choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
  return all.map((n) => [String(n), String(n)]);
}

export function Toggle(props: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <ToggleSwitch
      label={props.label}
      description={props.description ?? ""}
      checked={props.checked}
      onCheckedChange={(e: CustomEvent<boolean>) => props.onChange(e.detail)}
    />
  );
}

export function Choice(props: { label: string; value: string | number; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <SelectField
      label={props.label}
      value={String(props.value)}
      options={props.options.map(([value, label]) => ({ value, label }))}
      onValueChange={(e: CustomEvent<string>) => props.onChange(e.detail)}
    />
  );
}
