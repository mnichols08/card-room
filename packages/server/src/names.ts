// Names on public tables. A family table is among people who know each other; an open table's
// names are shown to everyone in the card room, so the crudest ones are turned away.
//
// This is a short list on purpose: it stops the obvious, not the determined. Whoever runs the card
// room can add words of their own with CARDROOM_BLOCKED_NAMES (comma-separated).

/** Blocked wherever they appear, spelled with look-alike characters or dots between the letters too. */
const ANYWHERE = ["fuck", "shit", "cunt", "bitch", "whore", "slut", "porn", "nazi", "hitler", "retard", "nigger", "nigga", "faggot", "rapist", "pedo"];
/** Blocked only as a whole word: they sit inside ordinary names and words (Hancock, grape). */
const WHOLE = ["cock", "pussy", "rape", "fag", "kike", "spic", "chink", "kys", "admin", "moderator"];

const LOOKALIKE: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s", "!": "i" };

const plain = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[013457@$!]/g, (c) => LOOKALIKE[c] ?? c);
/** "fuuuck" → "fuck". */
const squeezed = (text: string) => text.replace(/(.)\1+/g, "$1");

/** Whether a name may be shown on a public table. `extra` words are blocked wherever they appear. */
export function nameOk(name: string, extra: string[] = []): boolean {
  const text = plain(name);
  const letters = text.replace(/[^a-z]/g, "");
  const anywhere = [...ANYWHERE, ...extra.map((w) => plain(w).replace(/[^a-z]/g, "")).filter((w) => w.length > 1)];
  if (anywhere.some((w) => letters.includes(w))) return false;
  // Stretched-out spellings, for the words that have no doubled letter of their own to lose.
  const tight = squeezed(letters);
  if (anywhere.some((w) => squeezed(w) === w && tight.includes(w))) return false;
  const words = text.split(/[^a-z]+/).filter(Boolean);
  return !words.some((w) => WHOLE.includes(w) || WHOLE.includes(squeezed(w)));
}
