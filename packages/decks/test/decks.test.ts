import { describe, expect, it } from "vitest";
import { CLASSIC, STARTERS, applyDeck, cleanName, contrast, deckStyle, deckVars, normalizeDesign, saveDeck, savedDeck, validateDesign } from "../src/index.js";

describe("card designs", () => {
  it("every starter is a playable design that normalizing leaves alone", () => {
    for (const design of STARTERS) {
      expect(normalizeDesign(design)).toEqual(design);
      expect(validateDesign(design)).toEqual([]);
    }
  });

  it("anything not understood becomes the Classic deck's", () => {
    expect(normalizeDesign(null)).toEqual({ ...CLASSIC, name: "My deck" });
    const odd = normalizeDesign({
      name: "  Grammi's\n deck  ",
      back: { pattern: "tartan", color: "red", accent: "#ABC", emblem: "<script>" },
      face: { paper: "url(x)", fourColor: "yes", font: "comic" },
      corners: 12,
      extra: "dropped",
    });
    expect(odd.name).toBe("Grammi's deck");
    expect(odd.back).toEqual({ ...CLASSIC.back, accent: "#aabbcc" });
    expect(odd.face).toEqual(CLASSIC.face);
    expect(odd.corners).toBe("soft");
    expect(odd).not.toHaveProperty("extra");
  });

  it("names are one short line", () => {
    expect(cleanName("x".repeat(80))).toHaveLength(30);
    expect(cleanName("   ")).toBe("My deck");
    expect(cleanName("a\u0000b\tc")).toBe("a b c");
  });

  it("measures contrast the way WCAG does", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBe(1);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(contrast("#ffffff", "#777777"), 10);
  });

  it("refuses decks you couldn't play with", () => {
    const faint = normalizeDesign({ ...CLASSIC, face: { ...CLASSIC.face, red: "#f6e9d8" } });
    expect(validateDesign(faint).join(" ")).toMatch(/red suits are too faint/);

    const same = normalizeDesign({ ...CLASSIC, face: { ...CLASSIC.face, red: CLASSIC.face.black } });
    expect(validateDesign(same)).toContain("The black and red suits need different inks.");

    const three = normalizeDesign({ ...CLASSIC, face: { ...CLASSIC.face, fourColor: true, clubs: CLASSIC.face.black } });
    expect(validateDesign(three)).toContain("A four-colour deck needs four different inks.");

    const lost = normalizeDesign({ ...CLASSIC, back: { ...CLASSIC.back, accent: CLASSIC.back.color } });
    expect(validateDesign(lost).join(" ")).toMatch(/emblem disappears/);
    // With no emblem there's nothing to lose.
    expect(validateDesign({ ...lost, back: { ...lost.back, emblem: "none" } })).toEqual([]);
  });

  it("turns a design into the variables the card reads", () => {
    const vars = deckVars(CLASSIC);
    expect(vars["--deck-black"]).toBe("#1d1a16");
    expect(vars["--deck-clubs"]).toBe("#1d1a16"); // two colours: clubs are black
    expect(vars["--deck-diamonds"]).toBe("#b3261e");
    expect(vars["--deck-emblem"]).toBe('"♠︎"');
    expect(vars["--deck-back-image"]).toContain("repeating-linear-gradient(45deg");
    expect(vars["--deck-corner"]).toBe("0.1");

    const four = deckVars({ ...CLASSIC, face: { ...CLASSIC.face, fourColor: true } });
    expect(four["--deck-clubs"]).toBe("#1b6e3c");
    expect(four["--deck-diamonds"]).toBe("#1d5fb8");

    const bare = deckVars({ ...CLASSIC, back: { ...CLASSIC.back, emblem: "none", pattern: "plain" } });
    expect(bare["--deck-emblem"]).toBe('""');
    expect(bare["--deck-back-image"]).toMatch(/^linear-gradient/);
  });

  it("never lets a page's text into the CSS", () => {
    const vars = deckVars({ name: "x", back: { pattern: "dots; } body { display: none", color: "#000000); background: url(evil", emblem: '"; content: "x' }, face: { font: "serif; }" } } as never);
    expect(vars).toEqual(deckVars({ ...CLASSIC, back: { ...CLASSIC.back } }));
    expect(deckStyle(CLASSIC)).not.toMatch(/[<>{}]/);
  });

  it("dresses an element and undresses it", () => {
    const set = new Map<string, string>();
    const element = { style: { setProperty: (n: string, v: string) => void set.set(n, v), removeProperty: (n: string) => void set.delete(n) } };
    applyDeck(element, STARTERS[1]!);
    expect(set.get("--deck-black")).toBe("#141a2b");
    applyDeck(element, null);
    expect(set.size).toBe(0);
  });

  it("remembers the deck this browser plays with", () => {
    const kept = new Map<string, string>();
    const storage = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
    expect(savedDeck(storage)).toBeNull();
    saveDeck(STARTERS[3]!, storage);
    expect(savedDeck(storage)).toEqual(STARTERS[3]);
    kept.set("cardroom.deck", "{not json");
    expect(savedDeck(storage)).toBeNull();
    saveDeck(null, storage);
    expect(kept.size).toBe(0);
  });
});
