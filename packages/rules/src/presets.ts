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

/** Grammi's starting preset: Classic with blind nil on. She can tune it from there. */
export const brokennilsTable: RulePreset = {
  ...classic,
  id: "brokennils-table",
  name: "brokennil's Table",
  blindNil: { enabled: true, value: 200, onlyWhenDownBy: null, passCards: 0 },
};

export const builtInPresets: readonly RulePreset[] = [classic, jokersAndDeuces, quick250];

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
