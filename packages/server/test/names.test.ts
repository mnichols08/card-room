import { describe, expect, it } from "vitest";
import { nameOk } from "../src/names.js";

describe("names on public tables", () => {
  it("lets ordinary names through, including ones with a rude word hiding inside", () => {
    for (const name of ["brokennil", "Rick", "Pappy", "Jimmy", "Jayanti", "Hancock", "Grape Ape", "Dick Van Dyke", "Cassie", "Niger", "José", "Player 2", "♠️ Ace ♠️"]) expect(nameOk(name), name).toBe(true);
  });
  it("turns away the crude ones, however they're dressed up", () => {
    for (const name of ["fuck you", "F.U.C.K", "sh1t head", "fuuuuck", "Biiitch", "n4zi", "xXcuntXx", "kys", "Admin", "the moderator", "c0ck"]) expect(nameOk(name), name).toBe(false);
  });
  it("blocks the words the card room's owner adds", () => {
    expect(nameOk("Grammi Sucks")).toBe(true);
    expect(nameOk("Grammi Sucks", ["sucks"])).toBe(false);
    expect(nameOk("Grammi", [" ", "x"])).toBe(true);
  });
});
