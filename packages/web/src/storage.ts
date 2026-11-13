import { brokennilsTable, builtInPresets, cleanSettings, DEFAULT_SETTINGS, type RulePreset, type TableSettings } from "@spades/rules";
import { familyPalace, normalizePalaceRules, type PalaceRules } from "@cardroom/palace";

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

export const loadName = () => read(NAME_KEY, "brokennil");
/** The name this browser has used before, or "" for someone arriving by an invite link. */
export const loadSavedName = () => read(NAME_KEY, "");
export const saveName = (name: string) => write(NAME_KEY, name);

export const loadSavedPresets = () => read<RulePreset[]>(PRESETS_KEY, []);
export function savePreset(preset: RulePreset) {
  const others = loadSavedPresets().filter((p) => p.id !== preset.id);
  write(PRESETS_KEY, [...others, preset]);
}
export function deleteSavedPreset(id: string) {
  write(PRESETS_KEY, loadSavedPresets().filter((p) => p.id !== id));
}

export const loadLastPreset = () => read<RulePreset>(LAST_PRESET_KEY, brokennilsTable);
export const saveLastPreset = (preset: RulePreset) => write(LAST_PRESET_KEY, preset);

export const starterPresets: RulePreset[] = [brokennilsTable, ...builtInPresets];

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

export type GameId = "spades" | "palace";
const GAME_KEY = "cardroom:game";
export const loadGame = () => read<GameId>(GAME_KEY, "spades");
export const saveGame = (game: GameId) => write(GAME_KEY, game);

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
