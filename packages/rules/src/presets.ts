import type { RulePreset } from "./types.js";

export const classic: RulePreset = {
  id: "classic",
  name: "Classic",
  trump: "ace-high",
  spadesMustBeBroken: true,
  nil: { enabled: true, value: 100 },
  nilTricksCountTowardBid: false,
  blindNil: { enabled: false, value: 200, onlyWhenDownBy: null, passCards: 0 },
  bags: { limit: 10, penalty: 100 },
  playTo: 500,
  loseAt: -200,
  minTeamBid: null,
};

export const jokersAndDeuces: RulePreset = {
  ...classic,
  id: "jokers-and-deuces",
  name: "Jokers & Deuces",
  trump: "jokers-and-deuces",
};

export const quick250: RulePreset = {
  ...classic,
  id: "quick-250",
  name: "Quick Game to 250",
  playTo: 250,
  loseAt: -150,
};

/** The starting rules: Classic with blind nil on. A house can tune them from there. */
export const familyTable: RulePreset = {
  ...classic,
  // The id predates the name: saved rules and tables refer to it, so it stays.
  id: "brokennils-table",
  name: "Family Table",
  blindNil: { enabled: true, value: 200, onlyWhenDownBy: null, passCards: 0 },
};

export const builtInPresets: readonly RulePreset[] = [classic, jokersAndDeuces, quick250];

/** What the family rules were called before; copies saved under that name show the new one. */
const OLD_FAMILY_NAME = "brokennil's Table";
/** Saved rules, with the family rules' old default name updated (a name someone chose stays). */
export const renamedPreset = <T extends { id: string; name: string }>(p: T): T => (p.id === familyTable.id && p.name === OLD_FAMILY_NAME ? { ...p, name: familyTable.name } : p);

/** Make a house-owned copy of a preset with overrides. */
export function derivePreset(
  base: RulePreset,
  id: string,
  name: string,
  overrides: Partial<Omit<RulePreset, "id" | "name">> = {},
): RulePreset {
  return { ...base, ...overrides, id, name };
}

/** Returns a list of problems; empty means the preset is usable. */
export function validatePreset(p: RulePreset): string[] {
  const errors: string[] = [];
  if (!p.name.trim()) errors.push("Preset needs a name.");
  if (p.playTo <= 0) errors.push("Play-to score must be positive.");
  if (p.loseAt !== null && p.loseAt >= p.playTo) errors.push("Lose-at must be below play-to.");
  if (p.nil.value < 0) errors.push("Nil value can't be negative.");
  if (p.blindNil.value < 0) errors.push("Blind nil value can't be negative.");
  if (p.blindNil.passCards < 0 || p.blindNil.passCards > 4) errors.push("Blind nil pass must be 0–4 cards.");
  if (p.bags && (p.bags.limit <= 0 || p.bags.penalty < 0)) errors.push("Bag limit must be positive and penalty non-negative.");
  if (p.minTeamBid !== null && (p.minTeamBid < 0 || p.minTeamBid > 13)) errors.push("Minimum team bid must be 0–13.");
  return errors;
}
