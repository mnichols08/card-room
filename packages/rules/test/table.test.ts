import { describe, expect, it } from "vitest";
import { cleanSettings, DEFAULT_SETTINGS, paceDelay, PERSONAS, styleFor, turnTimerMs } from "../src/index.js";

describe("table settings", () => {
  it("are checked, with the defaults for anything unknown", () => {
    expect(cleanSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ skill: "hard", pace: "instant", extra: 1 })).toEqual({ skill: "hard", pace: "instant" });
    expect(cleanSettings({ skill: "godlike", pace: "warp" })).toEqual(DEFAULT_SETTINGS);
  });

  it("a level plays every persona at that strength, keeping its boldness and nil habits", () => {
    const duke = PERSONAS.Duke!.style;
    expect(styleFor(duke, "mixed")).toBe(duke);
    expect(styleFor(duke, "hard")).toMatchObject({ skill: 1, sloppy: 0, bold: duke.bold, nilLove: duke.nilLove });
    expect(styleFor(PERSONAS.Vern!.style, "easy")).toMatchObject({ skill: 0.25, sloppy: 0.3 });
  });

  it("the turn timer is off unless a table sets it, and left out when it's off", () => {
    expect(cleanSettings({ timer: "30s" })).toEqual({ ...DEFAULT_SETTINGS, timer: "30s" });
    expect(cleanSettings({ timer: "off" })).toEqual(DEFAULT_SETTINGS);
    expect(cleanSettings({ timer: "5s" })).toEqual(DEFAULT_SETTINGS);
    expect(turnTimerMs(cleanSettings({ timer: "1d" }))).toBe(86_400_000);
    expect(turnTimerMs(DEFAULT_SETTINGS)).toBeNull();
    expect(turnTimerMs(undefined)).toBeNull();
  });

  it("a pace is a fixed wait, or a person's thinking time", () => {
    expect(paceDelay("instant", () => 5000)).toBe(60);
    expect(paceDelay("slow", () => 5000)).toBe(2200);
    expect(paceDelay("natural", () => 1234)).toBe(1234);
  });
});
