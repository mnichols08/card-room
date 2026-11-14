import { describe, expect, it } from "vitest";
import { ANGLE_UNITS, direction } from "../src/index.js";

describe("direction", () => {
  it("gives the compass points exactly", () => {
    expect(direction(0)).toEqual([1, 0]);
    expect(direction(9000)).toEqual([0, 1]);
    expect(direction(18000)).toEqual([-1, 0]);
    expect(direction(27000)).toEqual([0, -1]);
  });

  it("agrees with the built-in sine and cosine to within a few last-place digits, all the way round", () => {
    let worst = 0;
    for (let a = 0; a < ANGLE_UNITS; a++) {
      const [x, y] = direction(a);
      const rad = (a * Math.PI) / 18000;
      worst = Math.max(worst, Math.abs(x - Math.cos(rad)), Math.abs(y - Math.sin(rad)), Math.abs(x * x + y * y - 1));
    }
    expect(worst).toBeLessThan(2e-15);
  });

  it("is symmetric to the bit: a quarter turn swaps the parts and nothing else", () => {
    for (const a of [1, 137, 4499, 4501, 8999]) {
      const [x, y] = direction(a);
      expect(direction(a + 9000)).toEqual([0 - y, x]);
      expect(direction(a + 18000)).toEqual([0 - x, 0 - y]);
      expect(direction(9000 - a)).toEqual([y, x]);
    }
  });

  it("wraps angles outside the circle and refuses fractions", () => {
    expect(direction(36000 + 1234)).toEqual(direction(1234));
    expect(direction(-9000)).toEqual(direction(27000));
    expect(() => direction(0.5)).toThrow(RangeError);
  });
});
