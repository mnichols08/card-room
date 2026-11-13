import { brokennilsTable, builtInPresets, type RulePreset } from "@spades/rules";

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
