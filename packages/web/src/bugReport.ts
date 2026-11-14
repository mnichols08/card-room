// "Report a problem": what the page gathers for a report, and sending it. The server turns a report
// into an issue on GitHub (see the server's bugs.ts), so nobody needs an account anywhere.
//
// Gathered without asking, because none of it says who you are: which screen and game you were on,
// when this copy of the page was built, and the last few errors the page logged. Gathered only if
// you say yes to each: a picture of the screen, and your browser's details.

declare const __BUILT__: string;

// ---- Where the player is -------------------------------------------------------------------------

export interface BugContext {
  /** The screen, in a word or two: "home", "table", "practice table"… */
  screen: string;
  game?: string;
  /** A table on the server. It stays between the page and the server; an issue never shows it. */
  table?: string;
}
let context: BugContext = { screen: "home" };
/** The app says where it is as it moves between screens. */
export const setBugContext = (next: BugContext) => void (context = next);

// ---- Errors the page logged ----------------------------------------------------------------------

const ERRORS_KEPT = 10;
const errors: string[] = [];
function note(kind: string, problem: unknown) {
  const e = problem as { message?: unknown; stack?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : String(problem);
  // A stack usually starts with the message; when it does, the stack alone says both.
  const stack = typeof e?.stack === "string" ? e.stack.split("\n").slice(0, 8).join("\n") : "";
  const text = stack.includes(message) ? stack : [message, stack].filter(Boolean).join("\n");
  const at = new Date().toISOString().slice(11, 19);
  errors.push(`${at} ${kind}: ${text}`.slice(0, 1200));
  if (errors.length > ERRORS_KEPT) errors.shift();
}

/** Remember the last few things that went wrong on this page, in case the player reports a problem. */
export function watchForErrors() {
  addEventListener("error", (e) => note("error", e.error ?? e.message));
  addEventListener("unhandledrejection", (e) => note("unhandled rejection", e.reason));
  const original = console.error;
  console.error = (...args: unknown[]) => {
    try {
      note("console.error", args.length === 1 ? args[0] : args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    } catch {
      /* something that can't be put into words */
    }
    original.apply(console, args);
  };
}
/** Note a problem by hand (the screen that crashed, say). */
export const noteError = note;

// ---- The browser's details ------------------------------------------------------------------------

export interface BrowserInfo {
  userAgent: string;
  platform: string;
  viewport: string;
  screen: string;
  language: string;
  installed: boolean;
  touch: boolean;
  online: boolean;
  reducedMotion: boolean;
}
export function browserInfo(): BrowserInfo {
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return {
    userAgent: navigator.userAgent,
    platform: uaData?.platform ?? navigator.platform ?? "",
    viewport: `${innerWidth}×${innerHeight} at ${devicePixelRatio}×`,
    screen: `${screen.width}×${screen.height}`,
    language: navigator.language,
    installed: matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true,
    touch: navigator.maxTouchPoints > 0,
    online: navigator.onLine,
    reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}
/** The same details as the lines a player is shown before agreeing to send them. */
export const browserLines = (info: BrowserInfo): [string, string][] => [
  ["Browser", info.userAgent],
  ["Device", info.platform],
  ["Window", info.viewport],
  ["Screen", info.screen],
  ["Language", info.language],
  ["Installed as an app", info.installed ? "yes" : "no"],
  ["Touch screen", info.touch ? "yes" : "no"],
];

// ---- A picture of the screen ----------------------------------------------------------------------

/** Wide enough to read a card's corner; small enough to send from a phone on a poor connection. */
const SHOT_WIDTH = 1100;
const SHOT_BYTES = 450_000;

/**
 * The page as a JPEG (a data: address), or null when this browser can't draw it. It's drawn from the
 * page's own elements, so the browser asks the player nothing, and nothing outside the page is in it.
 */
export async function takeScreenshot(): Promise<string | null> {
  try {
    const { domToCanvas } = await import("modern-screenshot");
    const page = document.documentElement;
    const width = page.clientWidth;
    const height = innerHeight;
    const drawn = await domToCanvas(document.body, {
      width,
      height,
      scale: Math.min(devicePixelRatio || 1, SHOT_WIDTH / width, 2),
      backgroundColor: getComputedStyle(document.body).backgroundColor || "#1f4d3a",
      // What's on screen now, not the top of a long page.
      style: { margin: "0", transform: `translate(${-scrollX}px, ${-scrollY}px)`, transformOrigin: "top left", width: `${page.scrollWidth}px`, height: `${page.scrollHeight}px` },
      // The report button itself isn't part of the problem.
      filter: (node) => !(node instanceof Element && node.hasAttribute("data-no-screenshot")),
      timeout: 4000,
    });
    for (const quality of [0.8, 0.6, 0.4]) {
      const jpeg = drawn.toDataURL("image/jpeg", quality);
      // Four characters of base64 carry three bytes.
      if (jpeg.startsWith("data:image/jpeg") && jpeg.length * 0.75 < SHOT_BYTES) return jpeg;
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Sending ---------------------------------------------------------------------------------------

export interface SentReport {
  number: number;
  url: string;
}

let asked: Promise<boolean> | null = null;
export const bugs = {
  /** Whether this card room takes reports: asked once. False on a copy of the app with no server. */
  enabled: () =>
    (asked ??= fetch("/bugs/config", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((c: { enabled?: boolean }) => c.enabled === true, () => false)),
  async send(report: { description: string; screenshot: string | null; browser: BrowserInfo | null }): Promise<SentReport> {
    let response: Response;
    try {
      response = await fetch("/bugs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...report, ...context, built: typeof __BUILT__ === "string" ? __BUILT__ : "", errors }),
      });
    } catch {
      throw new Error("Couldn't reach the card room. Check your connection and try again.");
    }
    const data = (await response.json().catch(() => ({}))) as Partial<SentReport> & { error?: string };
    if (!response.ok || typeof data.number !== "number") throw new Error(data.error ?? "The report couldn't be sent just now. Try again in a minute.");
    return { number: data.number, url: data.url ?? "" };
  },
};

/** Open the report sheet from anywhere (the screen shown when the app crashes, say). */
export const REPORT_EVENT = "cardroom:report-problem";
export const openReport = () => dispatchEvent(new Event(REPORT_EVENT));
