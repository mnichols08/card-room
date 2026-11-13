// Palace house rules, as presets a house can save (like spades). Everything that families argue
// about is a setting; the defaults are how Grammi's family plays.

export interface PalaceRules {
  id: string;
  name: string;
  /** A 2 goes on anything, and anything goes on a 2. */
  twoResets: boolean;
  /** A 10 goes on anything and burns the pile; the same player goes again. */
  tenBurns: boolean;
  /** Four of the same rank on top of the pile burns it; whoever finished the four goes again. */
  fourBurns: boolean;
  /** After a 7, the next card must be a 7 or lower (2s and 10s still count when they're on). */
  sevenLower: boolean;
  /** Cards in hand, face-up and face-down. Classic is 3 each. */
  handSize: number;
  tableCards: number;
  /** Deal the face-up cards into the hand too, and each player picks which go face-up (so 6 in hand, keep 3). */
  choose: boolean;
  /** Players may swap hand cards with their face-up cards before play starts. */
  swap: boolean;
  /** Players may pick up the pile even when they could play. */
  pickUpAnytime: boolean;
}

export const familyPalace: PalaceRules = {
  id: "family-palace",
  name: "Family Palace",
  twoResets: true,
  tenBurns: true,
  fourBurns: true,
  sevenLower: false,
  handSize: 3,
  tableCards: 3,
  choose: true,
  swap: false,
  pickUpAnytime: true,
};

export const classicPalace: PalaceRules = {
  ...familyPalace,
  id: "classic-palace",
  name: "Classic Palace",
  sevenLower: true,
  choose: false,
  swap: true,
  pickUpAnytime: false,
};

export const quickPalace: PalaceRules = {
  ...familyPalace,
  id: "quick-palace",
  name: "Quick Palace",
  handSize: 3,
  tableCards: 2,
};

export const PALACE_PRESETS: readonly PalaceRules[] = [familyPalace, classicPalace, quickPalace];

/**
 * Rules from storage or a page, filled in. A built-in preset takes its current settings for anything
 * missing; saved rules from before a setting existed keep the meaning they had (`choose` was off).
 */
export function normalizePalaceRules(value: Partial<PalaceRules> | null | undefined): PalaceRules {
  const given = value && typeof value === "object" ? value : {};
  const builtIn = PALACE_PRESETS.find((p) => p.id === given.id);
  return { ...(builtIn ?? { ...familyPalace, choose: false, swap: true, pickUpAnytime: false }), ...given } as PalaceRules;
}

/** What is wrong with a preset, in words, or nothing. */
export function validatePalaceRules(r: PalaceRules): string[] {
  const problems: string[] = [];
  if (!r.name?.trim()) problems.push("Give the rules a name.");
  if (!Number.isInteger(r.handSize) || r.handSize < 1 || r.handSize > 5) problems.push("Hand size must be 1 to 5.");
  if (!Number.isInteger(r.tableCards) || r.tableCards < 1 || r.tableCards > 4) problems.push("Table cards must be 1 to 4.");
  for (const key of ["twoResets", "tenBurns", "fourBurns", "sevenLower", "choose", "swap", "pickUpAnytime"] as const) {
    if (typeof r[key] !== "boolean") problems.push(`${key} must be on or off.`);
  }
  return problems;
}

/** The rules in plain words, for a rules sheet. */
export function describePalace(r: PalaceRules): string[] {
  return [
    r.choose
      ? `${r.tableCards} face-down, and ${r.handSize + r.tableCards} in hand: pick ${r.tableCards} to lay face-up on top. Draw back up to ${r.handSize} while the deck lasts.`
      : `${r.tableCards} face-down, ${r.tableCards} face-up, ${r.handSize} in hand. Draw back up to ${r.handSize} while the deck lasts.`,
    "Play one or more cards of the same rank, equal to or higher than the top of the pile. Aces are high.",
    r.twoResets ? "2 resets: it goes on anything, and anything goes on it." : null,
    r.tenBurns ? "10 burns the pile, and you go again." : null,
    r.fourBurns ? "Four of a kind on top of the pile burns it, and you go again." : null,
    r.sevenLower ? "After a 7, the next card must be 7 or lower." : null,
    r.swap && !r.choose ? "Before play, swap any hand cards with your face-up cards." : null,
    r.pickUpAnytime ? "Can't play? Pick up the whole pile. You can also pick it up on purpose, even when you could play." : "Can't play? Pick up the whole pile.",
    "Hand empty and deck gone: play your face-up cards, then flip face-down ones blind.",
    "First out wins. The last one holding cards is the loser.",
  ].filter((x): x is string => x !== null);
}
