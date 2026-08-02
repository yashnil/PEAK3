/**
 * The words the rankings page uses to name each board.
 *
 * WHY THIS IS ITS OWN MODULE. The page used to hold a static `blurb` per board
 * plus a separately-derived header string, and the two contradicted each other:
 * the header rendered "1-Year Peak Windows" beside a tab named "Single
 * Seasons" — two names for one concept, presented as a choice — while the blurb
 * described a one-season window as "their single best consecutive stretch".
 *
 * The contradiction is real, not stylistic. At n=1 a peak window IS a single
 * season, and the two generated artifacts prove it: the 1-Year Peak Windows
 * board and the Single Seasons board return the same rank-1 and rank-2 rows,
 * with byte-identical row_ids (`michael-jordan-1yr-199091` at 97.53,
 * `lebron-james-1yr-200809` at 95.85). The ONLY difference is that the peaks
 * board keeps one row per player and the seasons board does not.
 *
 * Pulling the copy out of the component makes that claim testable as data
 * (`rankings-provenance.test.ts`) rather than as rendered markup, and stops the
 * heading and the explainer from being able to drift apart again — they are now
 * derived from the same two arguments.
 *
 * The API-side counterpart is
 * apps/api/tests/test_regression.py::test_the_two_boards_differ_only_by_deduplication_at_one_year,
 * which holds the underlying artifacts to the same claim.
 */

import type { RankingBoardId } from "@/types";

export type PeakWindowId = "1y" | "2y" | "3y" | "5y";

/** Window id -> the number of consecutive seasons it spans, written out. */
const WINDOW_YEARS_WORD: Record<Exclude<PeakWindowId, "1y">, string> = {
  "2y": "two",
  "3y": "three",
  "5y": "five",
};

/** Window id -> the digit used in short headings. */
const WINDOW_YEARS_DIGIT: Record<Exclude<PeakWindowId, "1y">, string> = {
  "2y": "2",
  "3y": "3",
  "5y": "5",
};

/**
 * What this board is showing, said the same way the board is built.
 *
 * Window-aware on purpose: the honest description of Peak Windows at 1-Year is
 * not the honest description at 5-Year, and using one blurb for both is exactly
 * how the contradiction got in.
 */
export function explainerFor(board: RankingBoardId, window: PeakWindowId): string {
  if (board === "seasons") {
    return (
      "Every qualifying season, ranked on its own — so a player can appear many times. " +
      "The same rows as the 1-Year board, without the one-per-player limit."
    );
  }
  if (window === "1y") {
    return (
      "Best single season, one row per player. A one-year peak window is a single season, " +
      "so this is the Single Seasons board with each player kept only once — " +
      "de-duplication is the only difference between the two at this setting."
    );
  }
  const years = WINDOW_YEARS_WORD[window];
  return (
    `Best ${years} consecutive seasons, one row per player. Sustained level rather than a ` +
    "single year, so a career peak here can sit at a different season than on the 1-Year board."
  );
}

/** The heading a reader sees for the board they are actually looking at. */
export function boardHeadingFor(board: RankingBoardId, window: PeakWindowId): string {
  if (board === "seasons") return "Every qualifying season";
  if (window === "1y") return "Best single season (one row per player)";
  return `Best ${WINDOW_YEARS_DIGIT[window]}-season stretch (one row per player)`;
}

/**
 * The same board, named short enough to sit inside a sentence.
 *
 * The explainability modal writes "#1 on the {label} board", so the
 * parenthetical form above would read as a stutter there. Same concept, same
 * words, fewer of them — never a second name for the board, which is the
 * failure being fixed.
 */
export function boardShortLabelFor(board: RankingBoardId, window: PeakWindowId): string {
  if (board === "seasons") return "Every Qualifying Season";
  if (window === "1y") return "Best Single Season";
  return `Best ${WINDOW_YEARS_DIGIT[window]}-Season Stretch`;
}
