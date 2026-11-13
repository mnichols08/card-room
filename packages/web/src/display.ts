// How the table looks on this device: how much things move, and the suit colours. Kept in this
// browser and put on <html> as data attributes, so the CSS (and the card motion) follow them.

export type Motion = "on" | "calm" | "off";
export interface DisplaySettings {
  motion: Motion;
  /** 4: diamonds blue and clubs green, so every suit has its own colour. */
  suits: 2 | 4;
}

const KEY = "cardroom:display";
export const DEFAULT_DISPLAY: DisplaySettings = { motion: "on", suits: 2 };

export const MOTIONS: { id: Motion; label: string; hint: string }[] = [
  { id: "on", label: "On", hint: "Cards glide, tricks sweep, burns flare, winners get confetti." },
  { id: "calm", label: "Calm", hint: "Quicker, smaller movements. No confetti or pulsing." },
  { id: "off", label: "Off", hint: "Cards just appear where they go." },
];

export function loadDisplay(): DisplaySettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<DisplaySettings>;
    return {
      motion: saved.motion === "calm" || saved.motion === "off" ? saved.motion : "on",
      suits: saved.suits === 4 ? 4 : 2,
    };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

/** Put the settings on the page: <html data-motion="calm" data-suits="4">. */
export function applyDisplay(settings: DisplaySettings = loadDisplay()) {
  const html = document.documentElement;
  html.dataset.motion = settings.motion;
  html.dataset.suits = String(settings.suits);
}

export function saveDisplay(settings: DisplaySettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* private mode: it still applies for now */
  }
  applyDisplay(settings);
}

/** The motion setting as it stands on the page. */
export const motionSetting = (): Motion => {
  const m = typeof document === "undefined" ? undefined : document.documentElement.dataset.motion;
  return m === "calm" || m === "off" ? m : "on";
};
