/**
 * English ordinals, in one place.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * A correct ordinal helper already lived, unexported, inside
 * `lib/rankings-receipts.ts`. Because it was private, three other surfaces
 * grew their own version and all three were wrong:
 *
 *   * `run-the-table-state.ts::percentileSentence` appended `"th"`
 *     unconditionally, so EVERY card in the Draft Room and both Trade Desk
 *     columns rendered `75.1th`, `21.0th`, `1.0th`.
 *   * `RunCard.tsx` hard-coded the same `th` as a literal JSX text node.
 *   * `run-the-table-state.ts::decisiveLane` used
 *     `lanesToWin === 3 ? "rd" : "th"`, which is correct only for the single
 *     value the ruleset happens to ship today and prints "1th lane" / "2th
 *     lane" for anything else.
 *
 * So the rule lives here once, with the full st/nd/rd/th ladder AND the teens
 * exception (11th, 12th, 13th — not 11st/12nd/13rd), and every caller reuses
 * it. Nothing in this module is game-, model- or locale-specific.
 */

/**
 * The two-letter suffix for a whole number: `1 → "st"`, `2 → "nd"`,
 * `3 → "rd"`, `4 → "th"`, and `11/12/13 → "th"` (the teens exception, which is
 * the half every hand-rolled copy of this function forgets).
 *
 * Negative and non-integer inputs are reduced to `|trunc(n)|` first, so the
 * function is total: it never throws and never returns an empty string.
 */
export function ordinalSuffix(n: number): string {
  if (!Number.isFinite(n)) return "th";
  const abs = Math.abs(Math.trunc(n));
  const lastTwo = abs % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return "th";
  switch (abs % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

/** `1 → "1st"`, `13 → "13th"`, `21 → "21st"`. */
export function ordinal(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  return `${n}${ordinalSuffix(n)}`;
}

/**
 * An ordinal for a value printed to a fixed number of decimals:
 * `ordinalFixed(75.1, 1) === "75.1st"`.
 *
 * The suffix follows the LAST PRINTED DIGIT, because that is the digit a
 * reader voices last — "seventy-five point one**st** percentile". The teens
 * exception cannot apply across a decimal point (there is no tens digit
 * adjacent to the final one), so it is deliberately not consulted when
 * `digits > 0`; with `digits === 0` this is exactly `ordinal(Math.round(v))`.
 *
 * Rounding is done by `toFixed` and then read back off the STRING rather than
 * off the input, so `ordinalFixed(0.96, 1)` is `"1.0th"` and not `"1.0nd"`.
 */
export function ordinalFixed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return String(value);
  if (digits <= 0) return ordinal(Math.round(value));
  const fixed = value.toFixed(digits);
  const lastDigit = Number(fixed[fixed.length - 1]);
  return `${fixed}${ordinalSuffix(Number.isFinite(lastDigit) ? lastDigit : 0)}`;
}
