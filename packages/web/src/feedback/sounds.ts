// Every sound at the table, made with the Web Audio API: no files to download or license.
// Each sound is a function of (context, output, start time), so the same code plays live and
// renders offline (scripts/render-sounds) for listening to them all at once.

export type SoundName =
  | "deal"
  | "card"
  | "piece"
  | "bid"
  | "yourTurn"
  | "trickUs"
  | "trickThem"
  | "spadesBroken"
  | "nilMade"
  | "set"
  | "handDone"
  | "won"
  | "lost"
  | "nope"
  | "message"
  | "hurry";

type Ctx = BaseAudioContext;
type Play = (ctx: Ctx, out: AudioNode, t: number) => void;

// Notes in Hz.
const N = { C4: 261.63, E4: 329.63, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.0, C6: 1046.5, E6: 1318.5 };

/** A short burst of white noise, shared by every sound that needs one. */
const noiseCache = new WeakMap<Ctx, AudioBuffer>();
function noise(ctx: Ctx): AudioBuffer {
  let buffer = noiseCache.get(ctx);
  if (!buffer) {
    buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buffer);
  }
  return buffer;
}

/** A gain that rises quickly and decays: the shape of a plucked or struck sound. */
function envelope(ctx: Ctx, out: AudioNode, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(out);
  return g;
}

/** A soft bell: a sine with a quieter octave above it, like a struck glass. */
function bell(ctx: Ctx, out: AudioNode, t: number, freq: number, { peak = 0.22, decay = 0.6 } = {}) {
  const g = envelope(ctx, out, t, peak, 0.008, decay);
  for (const [mult, level] of [
    [1, 1],
    [2, 0.25],
    [3.01, 0.08],
  ] as const) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    const mix = ctx.createGain();
    mix.gain.value = level;
    osc.connect(mix).connect(g);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
}

/** A filtered noise burst: paper and felt sounds. */
function swish(ctx: Ctx, out: AudioNode, t: number, { freq = 2500, q = 0.8, peak = 0.35, decay = 0.07, type = "bandpass" as BiquadFilterType } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = envelope(ctx, out, t, peak, 0.004, decay);
  src.connect(filter).connect(g);
  src.start(t, Math.random() * 0.3);
  src.stop(t + decay + 0.05);
}

/** A tone that slides in pitch: thunks and sighs. */
function glide(ctx: Ctx, out: AudioNode, t: number, from: number, to: number, { peak = 0.3, decay = 0.25, type = "sine" as OscillatorType } = {}) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + decay);
  const g = envelope(ctx, out, t, peak, 0.005, decay);
  osc.connect(g);
  osc.start(t);
  osc.stop(t + decay + 0.05);
}

export const SOUNDS: Record<SoundName, Play> = {
  /** Shuffling the deck: a quick riffle of thirteen soft flicks. */
  deal: (ctx, out, t) => {
    for (let i = 0; i < 13; i++) swish(ctx, out, t + i * 0.045 + Math.random() * 0.01, { freq: 3000 + Math.random() * 1500, peak: 0.14, decay: 0.04 });
  },
  /** A card landing on felt: a soft paper snap with a little body under it. */
  card: (ctx, out, t) => {
    swish(ctx, out, t, { freq: 2200 + Math.random() * 600, q: 0.9, peak: 0.5, decay: 0.06 });
    swish(ctx, out, t + 0.005, { freq: 400, q: 0.7, peak: 0.25, decay: 0.08, type: "lowpass" });
  },
  /** A piece set down on a board: a short wooden click. */
  piece: (ctx, out, t) => {
    glide(ctx, out, t, 620 + Math.random() * 60, 300, { peak: 0.32, decay: 0.05, type: "triangle" });
    swish(ctx, out, t, { freq: 1700, q: 1.2, peak: 0.16, decay: 0.03 });
  },
  /** A bid placed: a wooden tap. */
  bid: (ctx, out, t) => glide(ctx, out, t, 900, 600, { peak: 0.25, decay: 0.07, type: "triangle" }),
  /** Your turn: two gentle rising notes. */
  yourTurn: (ctx, out, t) => {
    bell(ctx, out, t, N.E5, { peak: 0.14, decay: 0.35 });
    bell(ctx, out, t + 0.11, N.A5, { peak: 0.14, decay: 0.5 });
  },
  /** Your team took the trick: a bright rising triad. */
  trickUs: (ctx, out, t) => {
    bell(ctx, out, t, N.C5, { peak: 0.12, decay: 0.4 });
    bell(ctx, out, t + 0.07, N.E5, { peak: 0.12, decay: 0.4 });
    bell(ctx, out, t + 0.14, N.G5, { peak: 0.14, decay: 0.6 });
  },
  /** The other team took it: two soft falling notes, not a scolding. */
  trickThem: (ctx, out, t) => {
    bell(ctx, out, t, N.G4, { peak: 0.09, decay: 0.3 });
    bell(ctx, out, t + 0.09, N.E4, { peak: 0.09, decay: 0.45 });
  },
  /** Spades are broken: a low thunk, like a fist on the table. */
  spadesBroken: (ctx, out, t) => {
    glide(ctx, out, t, 150, 55, { peak: 0.5, decay: 0.28 });
    swish(ctx, out, t, { freq: 300, q: 0.6, peak: 0.25, decay: 0.12, type: "lowpass" });
  },
  /** A nil made: a sparkle climbing up. */
  nilMade: (ctx, out, t) => {
    [N.C5, N.E5, N.G5, N.C6, N.E6].forEach((f, i) => bell(ctx, out, t + i * 0.06, f, { peak: 0.1, decay: 0.5 }));
  },
  /** A team was set: a falling minor sigh. */
  set: (ctx, out, t) => {
    glide(ctx, out, t, 440, 330, { peak: 0.12, decay: 0.35, type: "triangle" });
    glide(ctx, out, t + 0.3, 392, 262, { peak: 0.12, decay: 0.55, type: "triangle" });
  },
  /** A hand is over: one warm chord. */
  handDone: (ctx, out, t) => {
    for (const f of [N.C4, N.E4, N.G4, N.C5]) bell(ctx, out, t, f, { peak: 0.07, decay: 1.1 });
  },
  /** You won the game: a little fanfare. */
  won: (ctx, out, t) => {
    [N.C5, N.E5, N.G5].forEach((f, i) => bell(ctx, out, t + i * 0.12, f, { peak: 0.13, decay: 0.4 }));
    for (const f of [N.C5, N.E5, N.G5, N.C6]) bell(ctx, out, t + 0.4, f, { peak: 0.09, decay: 1.4 });
  },
  /** They won: a kind, quiet resolve. */
  lost: (ctx, out, t) => {
    [N.G4, N.E4, N.C4].forEach((f, i) => bell(ctx, out, t + i * 0.18, f, { peak: 0.1, decay: 0.7 }));
  },
  /** Someone said something at the table: a soft, round pop. */
  message: (ctx, out, t) => glide(ctx, out, t, 520, 780, { peak: 0.16, decay: 0.09, type: "sine" }),
  /** Your time is nearly up: two soft ticks, a clock on the mantelpiece and not an alarm. */
  hurry: (ctx, out, t) => {
    glide(ctx, out, t, 1100, 900, { peak: 0.12, decay: 0.05, type: "triangle" });
    glide(ctx, out, t + 0.22, 1100, 900, { peak: 0.12, decay: 0.05, type: "triangle" });
  },
  /** That move isn't allowed: a short low buzz. */
  nope: (ctx, out, t) => {
    glide(ctx, out, t, 180, 140, { peak: 0.1, decay: 0.12, type: "square" });
    glide(ctx, out, t + 0.13, 170, 130, { peak: 0.1, decay: 0.12, type: "square" });
  },
};

/** Vibration patterns (ms), for phones that support the Vibration API (Android). */
export const BUZZES: Partial<Record<SoundName, number | number[]>> = {
  yourTurn: [18, 60, 18],
  trickUs: 25,
  spadesBroken: 45,
  nilMade: [20, 40, 20, 40, 20],
  set: 60,
  won: [30, 60, 30, 60, 80],
  nope: [15, 30, 15],
  hurry: [12, 200, 12],
};

/** How long each sound runs, for rendering them offline. */
export const LENGTHS: Record<SoundName, number> = {
  deal: 0.8, card: 0.2, piece: 0.15, bid: 0.15, yourTurn: 0.7, trickUs: 0.85, trickThem: 0.65, spadesBroken: 0.4,
  nilMade: 0.9, set: 1.0, handDone: 1.3, won: 2.0, lost: 1.3, nope: 0.35, message: 0.15, hurry: 0.35,
};

/** Overall level, into a limiter. Phone speakers are small: the loudest sound peaks near -3 dB. */
export const MASTER_GAIN = 2.2;

/** The chain every sound goes through: a gain, then a limiter so overlapping sounds never clip. */
export function output(ctx: BaseAudioContext): GainNode {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6;
  comp.knee.value = 6;
  comp.ratio.value = 12;
  comp.attack.value = 0.002;
  comp.release.value = 0.1;
  comp.connect(ctx.destination);
  const out = ctx.createGain();
  out.gain.value = MASTER_GAIN;
  out.connect(comp);
  return out;
}

// ---------- Playing them live ----------

const SETTINGS_KEY = "spades:feedback";
interface Settings {
  sound: boolean;
  vibrate: boolean;
}
export function loadFeedbackSettings(): Settings {
  try {
    return { sound: true, vibrate: true, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { sound: true, vibrate: true };
  }
}
export function saveFeedbackSettings(settings: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: the setting lasts for this visit */
  }
  current = settings;
}
let current: Settings | null = null;

let live: { ctx: AudioContext; out: GainNode } | null = null;
function audio() {
  if (!live) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    live = { ctx, out: output(ctx) };
  }
  return live;
}

/**
 * Browsers start audio suspended until the page is tapped. Call once at startup: the first tap
 * anywhere wakes the audio, so sounds after that play straight away.
 */
export function unlockAudioOnFirstTap() {
  const wake = () => {
    const a = audio();
    void a?.ctx.resume();
    if (a?.ctx.state === "running") {
      removeEventListener("pointerdown", wake);
      removeEventListener("keydown", wake);
    }
  };
  addEventListener("pointerdown", wake);
  addEventListener("keydown", wake);
}

export function play(name: SoundName) {
  const settings = (current ??= loadFeedbackSettings());
  if (settings.sound) {
    const a = audio();
    if (a && a.ctx.state === "running") SOUNDS[name](a.ctx, a.out, a.ctx.currentTime + 0.01);
  }
  const buzz = BUZZES[name];
  if (settings.vibrate && buzz !== undefined && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(buzz);
    } catch {
      /* not allowed here */
    }
  }
}
