// Turning a whole-number angle into a direction without Math.sin or Math.cos. Those two are not
// pinned down by the language: an engine may return a last digit that differs from another's, and
// one differing digit in a break shot is a different table a second later. Addition, subtraction,
// multiplication, division and Math.sqrt are exactly specified (IEEE-754, correctly rounded), so a
// polynomial built from them, always evaluated in the same order, gives the same bits everywhere.

/** Angles are whole hundredths of a degree: 0 to 35999. 0 points along +x, 9000 along +y. */
export const ANGLE_UNITS = 36000;

const QUARTER = ANGLE_UNITS / 4;
const EIGHTH = ANGLE_UNITS / 8;
// Written out rather than Math.PI so that nothing here leans on the Math object at all.
const RADIANS_PER_UNIT = 3.141592653589793 / 18000;

// Taylor series on [0, π/4] only, where they converge fast: the first term left out is under
// 1e-16. Horner's form, with each coefficient an exact division of whole numbers, so the order of
// operations is fixed by the source and no long decimal literal has to be parsed.
function sinSmall(x: number): number {
  const x2 = x * x;
  return x * (1 - (x2 / 6) * (1 - (x2 / 20) * (1 - (x2 / 42) * (1 - (x2 / 72) * (1 - (x2 / 110) * (1 - (x2 / 156) * (1 - x2 / 210)))))));
}
function cosSmall(x: number): number {
  const x2 = x * x;
  return 1 - (x2 / 2) * (1 - (x2 / 12) * (1 - (x2 / 30) * (1 - (x2 / 56) * (1 - (x2 / 90) * (1 - (x2 / 132) * (1 - (x2 / 182) * (1 - x2 / 240)))))));
}

/**
 * The unit vector for a whole-number angle. The angle is folded into the first eighth of the
 * circle with integer arithmetic, so the four compass directions come out as exact 0s and 1s and
 * the eight symmetries of the circle hold to the bit.
 */
export function direction(angle: number): [number, number] {
  if (!Number.isInteger(angle)) throw new RangeError("An angle is a whole number of hundredths of a degree");
  const a = ((angle % ANGLE_UNITS) + ANGLE_UNITS) % ANGLE_UNITS;
  const quarter = (a - (a % QUARTER)) / QUARTER;
  const rest = a % QUARTER;
  let c: number;
  let s: number;
  if (rest <= EIGHTH) {
    c = cosSmall(rest * RADIANS_PER_UNIT);
    s = sinSmall(rest * RADIANS_PER_UNIT);
  } else {
    c = sinSmall((QUARTER - rest) * RADIANS_PER_UNIT);
    s = cosSmall((QUARTER - rest) * RADIANS_PER_UNIT);
  }
  if (quarter === 0) return [c, s];
  if (quarter === 1) return [0 - s, c];
  if (quarter === 2) return [0 - c, 0 - s];
  return [s, 0 - c];
}
