import { familyTable, renamedPreset, builtInPresets, cleanSettings, DEFAULT_SETTINGS, type RulePreset, type TableSettings } from "@spades/rules";
import { familyPalace, normalizePalaceRules, type PalaceRules } from "@cardroom/palace";
import { isKitGame, kitGame, type KitGameId } from "@cardroom/games";

const NAME_KEY = "spades:name";
const PRESETS_KEY = "spades:presets";
const LAST_PRESET_KEY = "spades:lastPreset";

// Browser storage can be missing or throw (private mode, embeds); treat it as a nice-to-have.
function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** The name this player has used before; empty for someone new (tables call them "You"). */
export const loadName = () => read(NAME_KEY, "");
/** The name this browser has used before, or "" for someone arriving by an invite link. */
export const loadSavedName = () => read(NAME_KEY, "");
/** Remember a name the player typed; a blank one isn't saved (so "You" never becomes their name). */
export const saveName = (name: string) => {
  if (name.trim()) write(NAME_KEY, name.trim());
};

export const loadSavedPresets = () => read<RulePreset[]>(PRESETS_KEY, []).map(renamedPreset);
export function savePreset(preset: RulePreset) {
  const others = loadSavedPresets().filter((p) => p.id !== preset.id);
  write(PRESETS_KEY, [...others, preset]);
}
export function deleteSavedPreset(id: string) {
  write(PRESETS_KEY, loadSavedPresets().filter((p) => p.id !== id));
}

export const loadLastPreset = () => renamedPreset(read<RulePreset>(LAST_PRESET_KEY, familyTable));
export const saveLastPreset = (preset: RulePreset) => write(LAST_PRESET_KEY, preset);

export const starterPresets: RulePreset[] = [familyTable, ...builtInPresets];

const HOUSES_KEY = "spades:houses";
/** The houses this browser belongs to, for the setup screen. The server is the source of truth. */
export const loadMyHouses = () => read<{ slug: string; name: string }[]>(HOUSES_KEY, []);
export function rememberHouse(house: { slug: string; name: string }) {
  write(HOUSES_KEY, [house, ...loadMyHouses().filter((h) => h.slug !== house.slug)].slice(0, 10));
}
export function forgetHouse(slug: string) {
  write(HOUSES_KEY, loadMyHouses().filter((h) => h.slug !== slug));
}

// ---- More than one game ----------------------------------------------------------------------

export type GameId = "spades" | "palace" | KitGameId;
const GAME_KEY = "cardroom:game";
export const loadGame = (): GameId => {
  const g = read<string>(GAME_KEY, "spades");
  return g === "palace" || isKitGame(g) ? g : "spades";
};
export const saveGame = (game: GameId) => write(GAME_KEY, game);
/** The game played last on this device, or null for someone new. */
export const loadLastGame = (): GameId | null => {
  const g = read<string | null>(GAME_KEY, null);
  return g === "spades" || g === "palace" || isKitGame(g) ? (g as GameId) : null;
};

const PALACE_LAST_KEY = "cardroom:palace:last";
const PALACE_SAVED_KEY = "cardroom:palace:presets";
const PALACE_SEATS_KEY = "cardroom:palace:seats";
export const loadPalaceRules = () => normalizePalaceRules(read<PalaceRules>(PALACE_LAST_KEY, familyPalace));
export const savePalaceRules = (rules: PalaceRules) => write(PALACE_LAST_KEY, rules);
export const loadPalaceSeats = () => read<number>(PALACE_SEATS_KEY, 4);
export const savePalaceSeats = (n: number) => write(PALACE_SEATS_KEY, n);
export const loadSavedPalace = () => read<PalaceRules[]>(PALACE_SAVED_KEY, []).map(normalizePalaceRules);
export function savePalacePreset(rules: PalaceRules) {
  write(PALACE_SAVED_KEY, [...loadSavedPalace().filter((p) => p.id !== rules.id), rules]);
}
export function deletePalacePreset(id: string) {
  write(PALACE_SAVED_KEY, loadSavedPalace().filter((p) => p.id !== id));
}

// ---- Table settings: how well and how fast the computer players play --------------------------
const SETTINGS_KEY = "cardroom:tableSettings";
export const loadTableSettings = () => cleanSettings(read<unknown>(SETTINGS_KEY, DEFAULT_SETTINGS));
export const saveTableSettings = (settings: TableSettings) => write(SETTINGS_KEY, settings);

// ---- The kit games: the last rules, saved rules and table size, per game ------------------------

type KitRules = { id: string; name: string } & Record<string, unknown>;
export const loadKitRules = (game: KitGameId): KitRules => kitGame(game)!.normalize(read<unknown>(`cardroom:${game}:last`, kitGame(game)!.presets[0]));
export const saveKitRules = (game: KitGameId, rules: KitRules) => write(`cardroom:${game}:last`, rules);
export const loadSavedKit = (game: KitGameId): KitRules[] => read<unknown[]>(`cardroom:${game}:presets`, []).map((r) => kitGame(game)!.normalize(r));
export function saveKitPreset(game: KitGameId, rules: KitRules) {
  write(`cardroom:${game}:presets`, [...loadSavedKit(game).filter((p) => p.id !== rules.id), rules]);
}
export function deleteKitPreset(game: KitGameId, id: string) {
  write(`cardroom:${game}:presets`, loadSavedKit(game).filter((p) => p.id !== id));
}
export const loadKitSeats = (game: KitGameId): number => {
  const g = kitGame(game)!;
  const n = read<number>(`cardroom:${game}:seats`, g.seats.default);
  return n >= g.seats.min && n <= g.seats.max ? n : g.seats.default;
};
export const saveKitSeats = (game: KitGameId, n: number) => write(`cardroom:${game}:seats`, n);

// ---- Find players: any table for the game, or only one with exactly your rules -----------------
const SAME_RULES_KEY = "cardroom:lobby:sameRules";
export const loadSameRules = () => read<boolean>(SAME_RULES_KEY, false) === true;
export const saveSameRules = (only: boolean) => write(SAME_RULES_KEY, only);
