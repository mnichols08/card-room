// Card designs: what a deck looks like. A design is plain data (colours, a back pattern, an emblem,
// lettering), never CSS or markup from a page, so one person's design is safe to show to everyone.
// `deckVars` turns a design into the CSS variables `<playing-card>` reads; set them on any element
// and every card inside it wears the design.

export const BACK_PATTERNS = ["lattice", "stripes", "dots", "argyle", "plaid", "rays", "plain"] as const;
export type BackPattern = (typeof BACK_PATTERNS)[number];

/** What sits in the middle of the back. "none" leaves the pattern alone. */
export const EMBLEMS = ["♠", "♥", "♦", "♣", "★", "✦", "❄", "✿", "☘", "♛", "☾", "☀", "none"] as const;
export type Emblem = (typeof EMBLEMS)[number];

export const FACE_FONTS = ["classic", "serif", "rounded", "slab", "mono"] as const;
export type FaceFont = (typeof FACE_FONTS)[number];

export const CORNERS = ["sharp", "soft", "round"] as const;
export type Corners = (typeof CORNERS)[number];

export interface CardDesign {
  name: string;
  back: {
    pattern: BackPattern;
    /** The back's main colour. */
    color: string;
    /** The pattern's lines and the medallion. */
    accent: string;
    /** The frame around the back. */
    border: string;
    emblem: Emblem;
  };
  face: {
    paper: string;
    /** Spades and clubs. */
    black: string;
    /** Hearts and diamonds. */
    red: string;
    /** A four-colour deck: clubs and diamonds get colours of their own, so suits are easier to tell apart. */
    fourColor: boolean;
    clubs: string;
    diamonds: string;
    font: FaceFont;
  };
  corners: Corners;
}

export const NAME_LIMIT = 30;

/** The card room's own deck: burgundy lattice, cream paper. */
export const CLASSIC: CardDesign = {
  name: "Classic",
  back: { pattern: "lattice", color: "#7a1f2b", accent: "#e8c46a", border: "#fffdf8", emblem: "♠" },
  face: { paper: "#fbf7ee", black: "#1d1a16", red: "#b3261e", fourColor: false, clubs: "#1b6e3c", diamonds: "#1d5fb8", font: "classic" },
  corners: "soft",
};

/** Designs to start from. */
export const STARTERS: CardDesign[] = [
  CLASSIC,
  {
    name: "Midnight",
    back: { pattern: "dots", color: "#16233f", accent: "#c9d3e6", border: "#f4f6fb", emblem: "☾" },
    face: { paper: "#f6f8fc", black: "#141a2b", red: "#a8243a", fourColor: false, clubs: "#1b6e3c", diamonds: "#1d5fb8", font: "serif" },
    corners: "soft",
  },
  {
    name: "Four colours",
    back: { pattern: "argyle", color: "#1f4d3a", accent: "#e8c46a", border: "#fffdf8", emblem: "✦" },
    face: { paper: "#fffdf8", black: "#1d1a16", red: "#b3261e", fourColor: true, clubs: "#1b6e3c", diamonds: "#1d5fb8", font: "rounded" },
    corners: "round",
  },
  {
    name: "Holly",
    back: { pattern: "plaid", color: "#1e5a34", accent: "#f0d58c", border: "#fff8e7", emblem: "❄" },
    face: { paper: "#fff8e7", black: "#1c2a20", red: "#b01224", fourColor: false, clubs: "#1b6e3c", diamonds: "#1d5fb8", font: "slab" },
    corners: "soft",
  },
  {
    name: "Sunday paper",
    back: { pattern: "stripes", color: "#2b2b2b", accent: "#f2efe6", border: "#f2efe6", emblem: "none" },
    face: { paper: "#f2efe6", black: "#111111", red: "#9b1c1c", fourColor: false, clubs: "#1b6e3c", diamonds: "#1d5fb8", font: "mono" },
    corners: "sharp",
  },
];

const HEX = /^#[0-9a-f]{6}$/;
const isHex = (value: unknown): value is string => typeof value === "string" && HEX.test(value);
const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T => (list.includes(value as T) ? (value as T) : fallback);
const hex = (value: unknown, fallback: string) => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  // #abc is #aabbcc.
  const long = /^#[0-9a-f]{3}$/.test(text) ? `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}` : text;
  return isHex(long) ? long : fallback;
};
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/** A design's name, tidied: one line, no longer than NAME_LIMIT. */
export const cleanName = (value: unknown, fallback = "My deck") =>
  String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_LIMIT)
    .trim() || fallback;

/**
 * A design from anything (a page's form, a saved file, another server): every part is checked and
 * anything missing or not understood becomes the Classic deck's. The result holds nothing else.
 */
export function normalizeDesign(given: unknown): CardDesign {
  const g = record(given);
  const back = record(g.back);
  const face = record(g.face);
  return {
    name: cleanName(g.name),
    back: {
      pattern: oneOf(BACK_PATTERNS, back.pattern, CLASSIC.back.pattern),
      color: hex(back.color, CLASSIC.back.color),
      accent: hex(back.accent, CLASSIC.back.accent),
      border: hex(back.border, CLASSIC.back.border),
      emblem: oneOf(EMBLEMS, back.emblem, CLASSIC.back.emblem),
    },
    face: {
      paper: hex(face.paper, CLASSIC.face.paper),
      black: hex(face.black, CLASSIC.face.black),
      red: hex(face.red, CLASSIC.face.red),
      fourColor: face.fourColor === true,
      clubs: hex(face.clubs, CLASSIC.face.clubs),
      diamonds: hex(face.diamonds, CLASSIC.face.diamonds),
      font: oneOf(FACE_FONTS, face.font, CLASSIC.face.font),
    },
    corners: oneOf(CORNERS, g.corners, CLASSIC.corners),
  };
}

/** A colour's relative luminance (WCAG 2), 0 to 1. */
function luminance(color: string): number {
  const channel = (at: number) => {
    const c = parseInt(color.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The contrast between two colours (WCAG 2), 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** A card has to be readable across a table: the least an ink may stand out from the paper. */
export const MIN_INK_CONTRAST = 3;

/**
 * What's wrong with a (normalized) design, in words for the person designing it. Empty when it's
 * fine. Colours and choices are already valid after `normalizeDesign`; this is about playability.
 */
export function validateDesign(design: CardDesign): string[] {
  const problems: string[] = [];
  const { face, back } = design;
  const inks: [string, string][] = [
    ["black suits", face.black],
    ["red suits", face.red],
    ...(face.fourColor ? ([["clubs", face.clubs], ["diamonds", face.diamonds]] as [string, string][]) : []),
  ];
  for (const [what, ink] of inks)
    if (contrast(ink, face.paper) < MIN_INK_CONTRAST) problems.push(`The ${what} are too faint on this paper to read across a table. Pick a darker ink or a lighter paper.`);
  // Two suits in the same ink can't be told apart at a glance.
  if (face.black === face.red) problems.push("The black and red suits need different inks.");
  if (face.fourColor) {
    const seen = new Set([face.black, face.red, face.clubs, face.diamonds]);
    if (seen.size < 4) problems.push("A four-colour deck needs four different inks.");
  }
  if (back.emblem !== "none" && contrast(back.color, back.accent) < 1.5) problems.push("The emblem disappears into the back. Pick an accent that stands out from the back's colour.");
  return problems;
}

const FONT_STACKS: Record<FaceFont, string> = {
  classic: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: 'ui-rounded, "Nunito", "Arial Rounded MT Bold", "Varela Round", system-ui, sans-serif',
  slab: 'Rockwell, "Roboto Slab", "Courier New", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};
const CORNER_FACTORS: Record<Corners, string> = { sharp: "0.04", soft: "0.1", round: "0.17" };

/** The back's pattern as CSS background layers. Lengths are in `cqw`: hundredths of the card's width. */
function patternLayers(pattern: BackPattern, accent: string): string[] {
  const line = `color-mix(in srgb, ${accent} 30%, transparent)`;
  const fill = `color-mix(in srgb, ${accent} 22%, transparent)`;
  switch (pattern) {
    case "lattice":
      return [`repeating-linear-gradient(45deg, ${line} 0 1px, transparent 1px 7cqw)`, `repeating-linear-gradient(-45deg, ${line} 0 1px, transparent 1px 7cqw)`];
    case "stripes":
      return [`repeating-linear-gradient(90deg, ${fill} 0 3cqw, transparent 3cqw 9cqw)`];
    case "dots":
      return [`radial-gradient(circle, ${line} 0 1.6cqw, transparent 1.9cqw) 0 0 / 9cqw 9cqw`, `radial-gradient(circle, ${line} 0 1.6cqw, transparent 1.9cqw) 4.5cqw 4.5cqw / 9cqw 9cqw`];
    case "argyle":
      return [
        `linear-gradient(135deg, ${fill} 25%, transparent 25%) -6cqw 0 / 12cqw 12cqw`,
        `linear-gradient(225deg, ${fill} 25%, transparent 25%) -6cqw 0 / 12cqw 12cqw`,
        `linear-gradient(315deg, ${fill} 25%, transparent 25%) 0 0 / 12cqw 12cqw`,
        `linear-gradient(45deg, ${fill} 25%, transparent 25%) 0 0 / 12cqw 12cqw`,
      ];
    case "plaid":
      return [
        `repeating-linear-gradient(0deg, ${fill} 0 4cqw, transparent 4cqw 13cqw)`,
        `repeating-linear-gradient(90deg, ${fill} 0 4cqw, transparent 4cqw 13cqw)`,
        `repeating-linear-gradient(0deg, transparent 0 8cqw, ${line} 8cqw 8.6cqw, transparent 8.6cqw 13cqw)`,
        `repeating-linear-gradient(90deg, transparent 0 8cqw, ${line} 8cqw 8.6cqw, transparent 8.6cqw 13cqw)`,
      ];
    case "rays":
      return [`repeating-conic-gradient(from 0deg at 50% 50%, ${fill} 0 6deg, transparent 6deg 18deg)`];
    case "plain":
      return [];
  }
}

/**
 * The CSS variables that dress `<playing-card>` in a design. Set them on the card or on anything
 * around it (they inherit): `Object.assign(element.style, …)` won't do for custom properties, so
 * use `applyDeck`, `deckStyle`, or `style.setProperty` for each.
 */
export function deckVars(given: CardDesign): Record<string, string> {
  const d = normalizeDesign(given);
  const { back, face } = d;
  const deep = `color-mix(in oklab, ${back.color} 82%, black)`;
  const lit = `color-mix(in oklab, ${back.color} 88%, white)`;
  const medallion = back.emblem === "none" ? [] : [`radial-gradient(circle at 50% 50%, ${back.accent} 0 9cqw, transparent 9.5cqw)`, `radial-gradient(circle at 50% 50%, ${deep} 0 13cqw, transparent 13.5cqw)`];
  return {
    "--deck-back-image": [...medallion, ...patternLayers(back.pattern, back.accent), `linear-gradient(160deg, ${lit}, ${deep})`].join(", "),
    "--deck-back-frame": `inset 0 0 0 4cqw ${back.border}, inset 0 0 0 5cqw color-mix(in srgb, ${back.accent} 70%, transparent)`,
    // U+FE0E asks for the text glyph, so phones don't draw the suits as emoji (which ignore colour).
    "--deck-emblem": back.emblem === "none" ? '""' : `"${back.emblem}︎"`,
    "--deck-emblem-ink": deep,
    "--deck-paper-image": `linear-gradient(170deg, color-mix(in oklab, ${face.paper} 55%, white) 0%, ${face.paper} 60%, color-mix(in oklab, ${face.paper} 94%, black) 100%)`,
    "--deck-black": face.black,
    "--deck-red": face.red,
    "--deck-clubs": face.fourColor ? face.clubs : face.black,
    "--deck-diamonds": face.fourColor ? face.diamonds : face.red,
    "--deck-font": FONT_STACKS[face.font],
    "--deck-corner": CORNER_FACTORS[d.corners],
  };
}

/** The same variables as one `style` attribute value. */
export const deckStyle = (design: CardDesign): string =>
  Object.entries(deckVars(design))
    .map(([name, value]) => `${name}: ${value}`)
    .join("; ");

/** Dress everything inside an element in a design; `null` takes it off again. */
export function applyDeck(element: { style: { setProperty(name: string, value: string): void; removeProperty(name: string): void } }, design: CardDesign | null): void {
  for (const [name, value] of Object.entries(deckVars(design ?? CLASSIC))) {
    if (design) element.style.setProperty(name, value);
    else element.style.removeProperty(name);
  }
}

/** Where the browser keeps the deck this person plays with (the card room and the designer share it). */
export const DECK_KEY = "cardroom.deck";

/** The deck this browser plays with, or null for the card room's own. */
export function savedDeck(storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage): CardDesign | null {
  try {
    const raw = storage?.getItem(DECK_KEY);
    return raw ? normalizeDesign(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Choose the deck this browser plays with; `null` goes back to the card room's own. */
export function saveDeck(design: CardDesign | null, storage: Pick<Storage, "setItem" | "removeItem"> | undefined = globalThis.localStorage): void {
  try {
    if (design) storage?.setItem(DECK_KEY, JSON.stringify(normalizeDesign(design)));
    else storage?.removeItem(DECK_KEY);
  } catch {
    // Private browsing, or storage is full: the deck just isn't remembered.
  }
}
