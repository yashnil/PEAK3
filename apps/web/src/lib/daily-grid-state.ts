/**
 * Daily Grid Challenge client state: localStorage persistence plus the pure
 * derivations the completion panel and share text need.
 *
 * Everything in here is deliberately pure or trivially wrapped so it can be
 * unit tested without a DOM: the only impure functions are the three
 * localStorage wrappers, and each one guards `typeof window === "undefined"`
 * because this file is imported from components that render during SSR.
 *
 * NOTHING here recomputes a score. `arena_points` and `rarity_bucket` are
 * copied straight from the server's CellScore; the only arithmetic is summing
 * points the server already awarded.
 */
import {
  DAILY_GRID_PROGRESS_SCHEMA_VERSION,
  DAILY_GRID_RULES_SEEN_KEY,
  DailyGridBoard,
  DailyGridProgress,
  FilledCell,
  GRID_SIZE,
  GridConstraint,
  GridResultResponse,
  RarityBucket,
  ResultCell,
  dailyGridProgressKey,
} from "@/types/daily-grid";
import {
  DAILY_GRID_TOUR_ID,
  DAILY_GRID_TOUR_VERSION,
} from "@/components/ui/tour-steps";
import {
  markTourSeen,
  shouldAutoStartTour,
  type TourSeenStatus,
} from "@/lib/tour-state";

/** Rarest first. Index doubles as the "hardness" rank for the recap. */
const RARITY_ORDER: RarityBucket[] = ["very_rare", "rare", "uncommon", "common", "very_common"];

export function rarityRank(bucket: RarityBucket): number {
  const idx = RARITY_ORDER.indexOf(bucket);
  return idx === -1 ? RARITY_ORDER.length : idx;
}

export const RARITY_SHORT_LABEL: Record<RarityBucket, string> = {
  very_rare: "Very rare",
  rare: "Rare",
  uncommon: "Uncommon",
  common: "Common",
  very_common: "Very common",
};

/** Plain-English gloss of what a rarity bucket actually means.
 *
 * Phase 11B: an unexplained "RARE" chip on an empty square told the player
 * nothing — it reads as flavour, when it is really a hint about how much room
 * they have and a multiplier on what the square pays. These say the thing. */
export const RARITY_POOL_HINT: Record<RarityBucket, string> = {
  very_rare: "Very few player-seasons qualify here.",
  rare: "A small pool of player-seasons qualifies here.",
  uncommon: "A moderate pool of player-seasons qualifies here.",
  common: "Many player-seasons qualify here.",
  very_common: "A very large pool of player-seasons qualifies here.",
};

export const TOTAL_CELLS = GRID_SIZE * GRID_SIZE;

// ---------------------------------------------------------------------------
// Progress shape
// ---------------------------------------------------------------------------

export function emptyProgress(board: Pick<DailyGridBoard, "board_id" | "date">): DailyGridProgress {
  return {
    board_id: board.board_id,
    date: board.date,
    schema_version: DAILY_GRID_PROGRESS_SCHEMA_VERSION,
    filled: [],
    incorrect_attempts: 0,
    started_at: null,
    completed_at: null,
  };
}

function isValidFilledCell(value: unknown): value is FilledCell {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<FilledCell>;
  return (
    typeof c.row === "number" &&
    typeof c.col === "number" &&
    !!c.player_season &&
    typeof c.player_season.player_slug === "string" &&
    !!c.cell_score &&
    typeof c.cell_score.arena_points === "number"
  );
}

/**
 * Reads one board's saved progress. Returns null -- never throws -- for a
 * missing key, unparseable JSON, an older `schema_version`, or a payload that
 * belongs to a different board_id. Callers treat null as "start clean".
 */
export function loadProgress(boardId: string): DailyGridProgress | null {
  if (typeof window === "undefined") return null;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(dailyGridProgressKey(boardId));
  } catch {
    return null; // storage blocked (private mode, disabled cookies)
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DailyGridProgress>;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.schema_version !== DAILY_GRID_PROGRESS_SCHEMA_VERSION) return null;
    if (parsed.board_id !== boardId) return null;
    if (!Array.isArray(parsed.filled)) return null;
    const filled = parsed.filled.filter(isValidFilledCell);
    return {
      board_id: boardId,
      date: typeof parsed.date === "string" ? parsed.date : "",
      schema_version: DAILY_GRID_PROGRESS_SCHEMA_VERSION,
      filled,
      incorrect_attempts:
        typeof parsed.incorrect_attempts === "number" && parsed.incorrect_attempts >= 0
          ? parsed.incorrect_attempts
          : 0,
      started_at: typeof parsed.started_at === "string" ? parsed.started_at : null,
      completed_at: typeof parsed.completed_at === "string" ? parsed.completed_at : null,
    };
  } catch {
    return null;
  }
}

export function saveProgress(progress: DailyGridProgress): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(dailyGridProgressKey(progress.board_id), JSON.stringify(progress));
  } catch {
    // Quota exceeded or storage blocked -- the board still plays, it just
    // will not survive a refresh. Never break the game over this.
  }
}

/**
 * Removes one board's saved progress.
 *
 * Phase 11B: NOT wired to any UI control. The competitive daily board has no
 * reset — a valid pick is locked, and a "start over" button would make the
 * day's score meaningless and the comparison against today's maximum
 * unearned. Kept because tests need a clean slate between cases, and because
 * clearing storage is something a browser can do anyway; what matters is that
 * the product does not offer it as a move.
 */
export function clearProgress(boardId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(dailyGridProgressKey(boardId));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Rules acknowledgement
// ---------------------------------------------------------------------------

/**
 * The LEGACY unversioned flag, read only.
 *
 * Its whole job now is to stop the migration re-onboarding people who had
 * already dismissed the gate before the versioned store existed. Never
 * written — see `DAILY_GRID_RULES_SEEN_KEY`.
 */
function hasLegacyRulesFlag(): boolean {
  try {
    return window.localStorage.getItem(DAILY_GRID_RULES_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Has this player already been through Daily Grid onboarding?
 *
 * Backed by the versioned multi-tour store (`lib/tour-state.ts`) under the
 * `"daily-grid"` tour id, so bumping `DAILY_GRID_TOUR_VERSION` after a copy
 * change replays the gate and the walkthrough for everyone — which the old
 * bare `"1"` string could not express at all.
 *
 * Storage blocked, or a corrupt payload: `shouldAutoStartTour` degrades to
 * "not seen", so this returns false and the rules are shown. Explaining the
 * game twice is a much smaller cost than dropping someone onto a board with no
 * objective.
 */
export function hasSeenRules(): boolean {
  if (typeof window === "undefined") return false;
  if (!shouldAutoStartTour(DAILY_GRID_TOUR_ID, DAILY_GRID_TOUR_VERSION)) return true;
  return hasLegacyRulesFlag();
}

/**
 * Record that onboarding was completed or deliberately skipped.
 *
 * `status` is carried through to the tour store so "took the walkthrough" and
 * "pressed Skip Tour and Start" stay distinguishable; both suppress the gate.
 */
export function markRulesSeen(status: TourSeenStatus = "completed"): void {
  if (typeof window === "undefined") return;
  markTourSeen(DAILY_GRID_TOUR_ID, DAILY_GRID_TOUR_VERSION, status);
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

export function findFilled(progress: DailyGridProgress, row: number, col: number): FilledCell | null {
  return progress.filled.find((c) => c.row === row && c.col === col) ?? null;
}

export function usedPlayerSlugs(progress: DailyGridProgress): string[] {
  return progress.filled.map((c) => c.player_season.player_slug);
}

export function filledCoords(progress: DailyGridProgress): [number, number][] {
  return progress.filled.map((c) => [c.row, c.col] as [number, number]);
}

export function totalArenaPoints(progress: DailyGridProgress): number {
  return progress.filled.reduce((sum, c) => sum + c.cell_score.arena_points, 0);
}

export function isComplete(progress: DailyGridProgress): boolean {
  return progress.filled.length >= TOTAL_CELLS;
}

/**
 * Locks one square. Returns a new progress object.
 *
 * Phase 11B: a square that is already locked is returned UNCHANGED rather than
 * overwritten. On the competitive daily board a valid pick is final, so
 * "replace" is not a move the state layer should be able to express — the UI
 * never offers it, and this makes a stray double-submit a no-op instead of a
 * silent score change. There is deliberately no `withoutCell`.
 */
export function withFilledCell(progress: DailyGridProgress, cell: FilledCell): DailyGridProgress {
  if (progress.filled.some((c) => c.row === cell.row && c.col === cell.col)) {
    return progress;
  }
  const filled = [...progress.filled, cell];
  const complete = filled.length >= TOTAL_CELLS;
  return {
    ...progress,
    filled,
    completed_at: complete ? (progress.completed_at ?? new Date().toISOString()) : null,
  };
}

export function withIncorrectAttempt(progress: DailyGridProgress): DailyGridProgress {
  return { ...progress, incorrect_attempts: progress.incorrect_attempts + 1 };
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

/**
 * Starts the clock, once. Returns the progress unchanged if it is already
 * running or the board is already finished.
 *
 * The clock is stored as a START TIMESTAMP, not an accumulated duration: that
 * is what makes it survive a refresh without a tick loop writing to
 * localStorage, and it means a reload cannot quietly reset or double-count it.
 * The cost is that the timer keeps running while the tab is closed — which is
 * the honest reading of "how long did today's grid take you", and the number
 * is presentational either way (Phase 11C does not score it, rank it, or send
 * it anywhere).
 */
export function withTimerStarted(
  progress: DailyGridProgress,
  now: Date = new Date(),
): DailyGridProgress {
  if (progress.started_at || progress.completed_at) return progress;
  return { ...progress, started_at: now.toISOString() };
}

/**
 * Re-anchors the clock to the SERVER's elapsed time.
 *
 * `POST /daily-grid/{daily_key}/start` answers with `started_at`, `server_now`
 * and their difference as `elapsed_seconds`. Rather than storing the server's
 * absolute `started_at` — which would be measured against a browser clock that
 * may be minutes or days out — this rewrites `started_at` as
 * `now - elapsed_seconds`, so the number the player watches is the server's
 * duration counted on the local clock. Two devices whose clocks disagree by an
 * hour therefore both show the same elapsed time for the same attempt.
 *
 * Unlike `withTimerStarted` this OVERWRITES an existing `started_at`: the whole
 * point is that the server, not the tab, decides when the attempt began. A
 * finished board is still left alone — its time is already frozen and re-timing
 * it after the fact would rewrite a result the player has already been shown.
 *
 * A negative or non-finite `elapsed_seconds` is treated as 0; the value crosses
 * a network boundary, and a clock that runs backwards must not print "-3:12".
 */
export function withServerTimer(
  progress: DailyGridProgress,
  elapsedSeconds: number,
  now: Date = new Date(),
): DailyGridProgress {
  if (progress.completed_at) return progress;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
  const startedAt = new Date(now.getTime() - elapsed * 1000).toISOString();
  if (progress.started_at === startedAt) return progress;
  return { ...progress, started_at: startedAt };
}

/**
 * Milliseconds on the clock: frozen at `completed_at` once the board is done,
 * live against `now` while it is in play, and null before the first move.
 * Never negative — a clock skew between two sessions must not print "-3:12".
 */
export function elapsedMs(progress: DailyGridProgress, now: Date = new Date()): number | null {
  if (!progress.started_at) return null;
  const start = Date.parse(progress.started_at);
  if (Number.isNaN(start)) return null;
  const end = progress.completed_at ? Date.parse(progress.completed_at) : now.getTime();
  if (Number.isNaN(end)) return null;
  return Math.max(0, end - start);
}

/** "7:04", or "1:02:11" past an hour. Null in, "—" out. */
export function formatElapsed(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.floor(ms / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return `${hours > 0 ? `${hours}:` : ""}${mm}:${String(seconds).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Result grading
// ---------------------------------------------------------------------------

/** The headline a completed board earns, from percent of today's maximum.
 *
 *  Four bands, checked high to low. "Perfect Grid" is reserved for actually
 *  matching the maximum — with the score hidden until each pick locks, a 100%
 *  board is a genuine achievement and calling anything less by that name would
 *  cheapen it. */
export const RESULT_GRADES: { min: number; headline: string; blurb: string }[] = [
  {
    min: 100,
    headline: "Perfect Grid",
    blurb: "You matched today's maximum on every square.",
  },
  {
    min: 90,
    headline: "Near Perfect",
    blurb: "A few points short of the best grid available today.",
  },
  {
    min: 75,
    headline: "Strong Run",
    blurb: "A solid grid — there were better answers on a couple of squares.",
  },
  {
    min: 0,
    headline: "Room to Improve",
    blurb: "Plenty of points still on the board. Come back tomorrow.",
  },
];

export function resultGrade(percentOfBest: number): { headline: string; blurb: string } {
  const grade = RESULT_GRADES.find((g) => percentOfBest >= g.min);
  // The 0 band matches everything, so the fallback is unreachable; kept so a
  // future edit to RESULT_GRADES cannot make this return undefined.
  return grade ?? RESULT_GRADES[RESULT_GRADES.length - 1];
}

/** How well one square did against the best legal grid.
 *
 *  `beat` is its own grade rather than being folded into `best`: a square where
 *  the player outscored the optimal assignment is a genuinely different — and
 *  better — outcome than matching it, and calling it "best available" would
 *  repeat the false claim this grade exists to remove. See the `ResultCell`
 *  doc comment in types/daily-grid.ts. */
export type CellGrade = "beat" | "best" | "close" | "fair" | "weak";

export function cellGrade(cell: ResultCell): CellGrade {
  if (cell.beat_optimal) return "beat";
  if (cell.matched_optimal) return "best";
  const share = cell.optimal_points > 0 ? cell.user_points / cell.optimal_points : 0;
  if (share >= 0.9) return "close";
  if (share >= 0.75) return "fair";
  return "weak";
}

/** What one square of the OPTIMAL board should say about the player's answer.
 *
 *  A different question from `cellGrade`, which reads the player's board and
 *  asks how many points a square left behind. This reads the best legal grid
 *  and asks whether the player already put that player-season there.
 *
 *  WHY IT IS NOT `matched_optimal`, WHICH IS THE OBVIOUS THING TO USE AND IS
 *  WRONG HERE. `matched_optimal` is `points_left === 0`, and `points_left` is
 *  `max(0, optimal - user)` — so it means "scored at least as much", not
 *  "played the same person". Two consequences, both of which would put a wrong
 *  label under a player's face:
 *
 *    * A square the player BEAT has `points_left === 0` and therefore
 *      `matched_optimal === true`, while naming somebody else entirely.
 *      Labelling that square "Matched" next to a different name reads as a bug.
 *    * A square where a different player-season happened to score the same
 *      is also `matched_optimal === true`. It is a real swap and the optimal
 *      board really does use somebody else there.
 *
 *  So identity decides, and `beat_optimal` is checked first because it is the
 *  more specific claim — a beaten square is always a different identity (equal
 *  identities score equally, so `user_points > optimal_points` cannot hold).
 */
export type OptimalCellState = "matched" | "beat" | "replacement";

export function optimalCellState(cell: ResultCell): OptimalCellState {
  if (cell.beat_optimal) return "beat";
  if (cell.user_player_season.id === cell.optimal_player_season.id) return "matched";
  return "replacement";
}

/** Highest arena_points. Ties break on the square's `quality_points` (the
 *  locked season's own prime_score, which is where the score is revealed now
 *  that the card carries none), then reading order, so the recap is stable. */
export function bestCell(filled: FilledCell[]): FilledCell | null {
  if (filled.length === 0) return null;
  return [...filled].sort(
    (a, b) =>
      b.cell_score.arena_points - a.cell_score.arena_points ||
      b.cell_score.quality_points - a.cell_score.quality_points ||
      a.row - b.row ||
      a.col - b.col,
  )[0];
}

/** Rarest bucket wins. Ties break on arena_points (the harder square is the
 *  one the rarity multiplier paid more for), then reading order. */
export function hardestCell(filled: FilledCell[]): FilledCell | null {
  if (filled.length === 0) return null;
  return [...filled].sort(
    (a, b) =>
      rarityRank(a.cell_score.rarity_bucket) - rarityRank(b.cell_score.rarity_bucket) ||
      b.cell_score.arena_points - a.cell_score.arena_points ||
      a.row - b.row ||
      a.col - b.col,
  )[0];
}

// ---------------------------------------------------------------------------
// Board lookups
// ---------------------------------------------------------------------------

function constraintById(list: GridConstraint[], id: string, fallbackIndex: number): GridConstraint | null {
  return list.find((c) => c.id === id) ?? list[fallbackIndex] ?? null;
}

export function rowConstraint(board: DailyGridBoard, row: number): GridConstraint | null {
  const spec = board.cells.find((c) => c.row === row);
  if (!spec) return board.rows[row] ?? null;
  return constraintById(board.rows, spec.row_constraint_id, row);
}

export function colConstraint(board: DailyGridBoard, col: number): GridConstraint | null {
  const spec = board.cells.find((c) => c.col === col);
  if (!spec) return board.cols[col] ?? null;
  return constraintById(board.cols, spec.col_constraint_id, col);
}

export function cellSpec(board: DailyGridBoard, row: number, col: number) {
  return board.cells.find((c) => c.row === row && c.col === col) ?? null;
}

/** "DPOY x 85+ PEAK" -- short labels, because this is used in tight places
 *  (share text, recap lines). */
export function cellShortTitle(board: DailyGridBoard, row: number, col: number): string {
  const r = rowConstraint(board, row);
  const c = colConstraint(board, col);
  return [r?.short_label ?? `Row ${row + 1}`, c?.short_label ?? `Column ${col + 1}`].join(" x ");
}

/** Full labels, for the panel heading and aria labels. */
export function cellFullTitle(board: DailyGridBoard, row: number, col: number): string {
  const r = rowConstraint(board, row);
  const c = colConstraint(board, col);
  return [r?.label ?? `Row ${row + 1}`, c?.label ?? `Column ${col + 1}`].join(" x ");
}

// ---------------------------------------------------------------------------
// Share text
// ---------------------------------------------------------------------------

const SHARE_URL = "peak3.app/daily";

/** The glyph each cell grade takes in the shared 3x3 recap.
 *
 *  ASCII, not emoji: the rest of this product's share text has never used
 *  emoji, and a plain block reads the same in a terminal, a code block and a
 *  tweet. The scale is deliberately monotonic left to right, so the shape of a
 *  run is legible without the legend. */
const SHARE_GLYPH: Record<CellGrade, string> = {
  // `*` outranks `#`: beating the best legal grid on a square is rarer and
  // better than matching it, and the shared line has to be legible without
  // reading the legend.
  beat: "*",
  best: "#",
  close: "+",
  fair: "-",
  weak: ".",
};

/** The 3x3 performance recap, three lines of three glyphs.
 *
 *  Only available once the server has released the comparison — before that
 *  there is nothing to grade a square against, and a grid of how-many-points
 *  glyphs would just be a picture of PEAK3 scores. */
export function buildShareGrid(result: GridResultResponse): string[] {
  const rows: string[] = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    const cells = result.cells
      .filter((c) => c.row === row)
      .sort((a, b) => a.col - b.col)
      .map((c) => SHARE_GLYPH[cellGrade(c)]);
    rows.push(cells.join(" "));
  }
  return rows;
}

/**
 * The share payload: a compact scoreboard plus the 3x3 recap.
 *
 * Says nothing it cannot prove. There is no rank, no percentile and no
 * comparison to other players, because Phase 11C has no global leaderboard --
 * the only competitive fact available is the player's distance from today's
 * maximum, which the server computed and which every player's board shares.
 */
export function buildDailyGridShareText(
  board: DailyGridBoard,
  progress: DailyGridProgress,
  result?: GridResultResponse | null,
  now: Date = new Date(),
  /** The local archive, when one has been read. The streak line is included
   *  ONLY from a real local record and only when it is at least 2 — a "1 day
   *  streak" is just "I played", and a streak shared out of an empty archive
   *  would be a number the sharer cannot themselves see. */
  archive?: { current_streak: number } | null,
): string {
  const lines: string[] = [`PEAK3 Daily Grid — ${board.date}`];
  if (board.theme) lines.push(board.theme);

  // The competitive line, and the reason to come back: a bare score means
  // nothing without the ceiling it is measured against. Only present once the
  // board is complete, because that is the only time the server will release
  // today's maximum.
  if (result) {
    lines.push(
      `${result.user_total}/${result.optimal_total} — ${result.percent_of_best}% of ${
        result.exact_optimal ? "today's max" : "PEAK3's best known"
      }`,
    );
    lines.push(resultGrade(result.percent_of_best).headline);
  } else {
    lines.push(`Score: ${totalArenaPoints(progress)}`);
    lines.push(`Solved ${progress.filled.length}/${TOTAL_CELLS}`);
  }

  const elapsed = elapsedMs(progress, now);
  if (elapsed !== null) lines.push(`Time: ${formatElapsed(elapsed)}`);
  lines.push(`Misses: ${progress.incorrect_attempts}`);
  // Local, unverified, and never dressed up as anything else. No rank and no
  // percentile go in here for the same reason: there is no server-side record
  // to back either one.
  if (archive && archive.current_streak >= 2) {
    lines.push(`Streak: ${archive.current_streak} days`);
  }

  if (result) {
    lines.push("");
    lines.push(...buildShareGrid(result));
    lines.push("");
    lines.push(`* beat  # best  + close  - fair  . weak`);
  }

  lines.push(SHARE_URL);
  return lines.join("\n");
}
