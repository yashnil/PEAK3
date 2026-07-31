/**
 * Daily Grid local archive and streak (Phase 11D).
 *
 * The retention layer for anonymous players: what you have finished, how you
 * did, and how many days in a row you have shown up. Local-only, and labelled
 * that way everywhere it surfaces — nothing here is server-verified, and none
 * of it is eligible for a leaderboard (CLAUDE.md § Security).
 *
 * THE STREAK RULE, AND WHY IT IS THE STRICT ONE
 * Only a board played on its OWN UTC date counts. Finishing today's grid
 * continues the streak; finishing an archive board through `?date=` is
 * recorded in history and shown, but never touches `current_streak`.
 *
 * The looser rule — let any completion extend the streak — is unshippable
 * here, because every past board is permanently available at a guessable URL.
 * A "streak" that can be reconstructed in an afternoon by walking the calendar
 * measures nothing, and the number would be a lie told to the only person it
 * matters to. The strict rule costs a genuine case (you played, the browser
 * lost the write, you want it back) and that is the right trade: a streak is
 * only worth showing if missing a day actually breaks it.
 *
 * DERIVED, NOT ACCUMULATED. `current_streak` and friends are recomputed from
 * the stored entries on every write rather than incremented in place. A
 * counter that is only ever `+= 1` cannot recover from a bad write, a clock
 * change, or a hand-edited localStorage value; a derivation can, and it also
 * means the invariant "the number matches the entries" is enforced by
 * construction rather than by remembering to keep them in step.
 */
import {
  DAILY_GRID_ARCHIVE_KEY,
  DAILY_GRID_ARCHIVE_MAX,
  DAILY_GRID_ARCHIVE_SCHEMA_VERSION,
  DailyGridArchive,
  DailyGridArchiveEntry,
  DailyGridBoard,
  DailyGridProgress,
  GridResultResponse,
} from "@/types/daily-grid";
import { elapsedMs, resultGrade, totalArenaPoints } from "@/lib/daily-grid-state";

export function emptyArchive(): DailyGridArchive {
  return {
    schema_version: DAILY_GRID_ARCHIVE_SCHEMA_VERSION,
    entries: [],
    current_streak: 0,
    longest_streak: 0,
    total_completed: 0,
    last_streak_date: null,
    best_percent_of_max: null,
    best_score: null,
  };
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today in UTC as YYYY-MM-DD — the same clock the server generates boards on
 *  (nba_peak/daily_grid/generator.py::today_utc_date). Using the browser's
 *  local date instead would put a player in UTC+13 on "tomorrow's" streak day
 *  while the API is still serving today's board. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative if `to` is
 *  earlier. Parsed as UTC midnight, so DST cannot make a day 23 or 25 hours. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/** Is `date` the board the player is meant to be playing right now? */
export function isCanonicalToday(date: string, now: Date = new Date()): boolean {
  return DATE_PATTERN.test(date) && date === todayUtc(now);
}

/** Milliseconds until the next UTC midnight, when a new board appears. */
export function msUntilNextBoard(now: Date = new Date()): number {
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return Math.max(0, next - now.getTime());
}

/** The API's own bound on a reported duration (`OfficialResultRequest`).
 *  Restated rather than imported because it is a wire contract, not a shared
 *  constant — if the server relaxes it, this must be changed deliberately. */
const MAX_REPORTABLE_ELAPSED_SECONDS = 86_400;

/**
 * The elapsed time to send with an official result, or null.
 *
 * Returns null rather than clamping when the clock reads longer than a day.
 * The timer is a persisted START TIMESTAMP, so it keeps running while the tab
 * is closed (see § Timer in the docs) — a board opened on Monday and finished
 * on Wednesday genuinely reads 48 hours, and the server rejects that. Clamping
 * to exactly 86,400 would assert a duration nobody believes; sending null says
 * the honest thing, which is that this board's time is not meaningful.
 *
 * The important part is that either way the RESULT still saves: an unusable
 * clock must not cost a player their durable record.
 */
export function reportableElapsedSeconds(
  progress: DailyGridProgress,
  now: Date = new Date(),
): number | null {
  const ms = elapsedMs(progress, now);
  if (ms === null) return null;
  const seconds = Math.round(ms / 1000);
  return seconds > MAX_REPORTABLE_ELAPSED_SECONDS ? null : seconds;
}

/** "6h 41m", or "48s" in the last minute. Coarse on purpose: a second-by-second
 *  countdown to a board 14 hours away is noise, not information. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

// ---------------------------------------------------------------------------
// Streak derivation
// ---------------------------------------------------------------------------

/** Dates that count toward a streak, newest first, de-duplicated. */
function streakDates(entries: DailyGridArchiveEntry[]): string[] {
  const dates = new Set<string>();
  for (const entry of entries) {
    if (entry.counted_for_streak && DATE_PATTERN.test(entry.date)) dates.add(entry.date);
  }
  return [...dates].sort().reverse();
}

/**
 * The streak as of `asOf`: consecutive counted days ending today or yesterday.
 *
 * Yesterday still counts as live, because a player who finished last night and
 * opens the page this morning has not broken anything — they simply have not
 * played yet. Anything older is a broken streak and reads as 0.
 */
export function currentStreak(
  entries: DailyGridArchiveEntry[],
  asOf: string = todayUtc(),
): number {
  const dates = streakDates(entries);
  if (dates.length === 0) return 0;

  const gap = daysBetween(dates[0], asOf);
  if (Number.isNaN(gap) || gap < 0 || gap > 1) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i += 1) {
    if (daysBetween(dates[i], dates[i - 1]) !== 1) break;
    streak += 1;
  }
  return streak;
}

/** The longest run of consecutive counted days ever recorded. */
export function longestStreak(entries: DailyGridArchiveEntry[]): number {
  const dates = streakDates(entries);
  if (dates.length === 0) return 0;
  let best = 1;
  let run = 1;
  for (let i = 1; i < dates.length; i += 1) {
    if (daysBetween(dates[i], dates[i - 1]) === 1) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }
  return best;
}

/** Recompute every derived field from `entries`. The single place the
 *  archive's invariants are established. */
function derive(entries: DailyGridArchiveEntry[], asOf: string): DailyGridArchive {
  const counted = entries.filter((e) => e.counted_for_streak);
  const percents = entries.map((e) => e.percent_of_max).filter((p): p is number => p !== null);
  return {
    schema_version: DAILY_GRID_ARCHIVE_SCHEMA_VERSION,
    entries,
    current_streak: currentStreak(entries, asOf),
    longest_streak: longestStreak(entries),
    total_completed: entries.length,
    last_streak_date: counted.length > 0 ? streakDates(entries)[0] : null,
    best_percent_of_max: percents.length > 0 ? Math.max(...percents) : null,
    best_score: entries.length > 0 ? Math.max(...entries.map((e) => e.score)) : null,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function isValidEntry(value: unknown): value is DailyGridArchiveEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<DailyGridArchiveEntry>;
  return (
    typeof e.board_id === "string" &&
    typeof e.date === "string" &&
    DATE_PATTERN.test(e.date) &&
    typeof e.score === "number" &&
    Number.isFinite(e.score) &&
    typeof e.completed_at === "string" &&
    typeof e.counted_for_streak === "boolean"
  );
}

/**
 * Read the archive. Returns an empty archive — never throws, never null — for
 * a missing key, unparseable JSON, an older schema, or a payload that is not
 * the right shape. Individual malformed entries are dropped and the rest kept,
 * so one bad row cannot cost a player their whole history.
 *
 * Derived fields are recomputed on read as well as on write: a value that was
 * hand-edited to claim a 900-day streak is corrected the moment it is loaded,
 * rather than being displayed once and fixed later.
 */
export function loadArchive(asOf: string = todayUtc()): DailyGridArchive {
  if (typeof window === "undefined") return emptyArchive();
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DAILY_GRID_ARCHIVE_KEY);
  } catch {
    return emptyArchive(); // storage blocked (private mode, disabled cookies)
  }
  if (!raw) return emptyArchive();
  try {
    const parsed = JSON.parse(raw) as Partial<DailyGridArchive>;
    if (!parsed || typeof parsed !== "object") return emptyArchive();
    if (parsed.schema_version !== DAILY_GRID_ARCHIVE_SCHEMA_VERSION) return emptyArchive();
    if (!Array.isArray(parsed.entries)) return emptyArchive();
    const entries = parsed.entries.filter(isValidEntry).slice(0, DAILY_GRID_ARCHIVE_MAX);
    return derive(sortEntries(entries), asOf);
  } catch {
    return emptyArchive();
  }
}

export function saveArchive(archive: DailyGridArchive): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DAILY_GRID_ARCHIVE_KEY, JSON.stringify(archive));
  } catch {
    // Quota exceeded or storage blocked. The board still plays and the result
    // still shows; only the history does not survive. Never break the game.
  }
}

export function clearArchive(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(DAILY_GRID_ARCHIVE_KEY);
  } catch {
    // ignore
  }
}

/** Newest board date first; completion timestamp breaks a tie. */
function sortEntries(entries: DailyGridArchiveEntry[]): DailyGridArchiveEntry[] {
  return [...entries].sort(
    (a, b) => b.date.localeCompare(a.date) || b.completed_at.localeCompare(a.completed_at),
  );
}

// ---------------------------------------------------------------------------
// Recording a completed board
// ---------------------------------------------------------------------------

/** Build the archive row for a finished board. Exported for tests and for the
 *  share text; `record` is what actually persists it. */
export function buildArchiveEntry(
  board: DailyGridBoard,
  progress: DailyGridProgress,
  result: GridResultResponse | null,
  now: Date = new Date(),
): DailyGridArchiveEntry {
  const ms = elapsedMs(progress, now);
  const percent = result ? result.percent_of_best : null;
  return {
    board_id: board.board_id,
    date: board.date,
    theme: board.theme,
    difficulty: board.difficulty,
    started_at: progress.started_at,
    completed_at: progress.completed_at ?? now.toISOString(),
    elapsed_seconds: ms === null ? null : Math.round(ms / 1000),
    score: result ? result.user_total : totalArenaPoints(progress),
    today_max: result ? result.optimal_total : null,
    percent_of_max: percent,
    grade: percent === null ? null : resultGrade(percent).headline,
    misses: progress.incorrect_attempts,
    filled_count: progress.filled.length,
    counted_for_streak: isCanonicalToday(board.date, now),
    // Labels only — never answer ids. See the type's doc comment.
    picks: [...progress.filled]
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((c) => c.player_season.label),
  };
}

/**
 * Record a completed board, returning the updated archive.
 *
 * IDEMPOTENT PER BOARD. A board already in the archive is REPLACED, not
 * appended — the completion effect fires again on every mount of a finished
 * board (and again when the result comparison arrives a moment later), so
 * appending would inflate `total_completed` once per page load. Replacing also
 * means the row is upgraded in place when the comparison finally lands, rather
 * than the history keeping the momentary version that had no percentage.
 *
 * Because streak fields are derived rather than incremented, replaying the
 * same day cannot double-count it: the same date contributes one entry to the
 * streak-date set however many times it is recorded.
 */
export function recordCompletedBoard(
  archive: DailyGridArchive,
  entry: DailyGridArchiveEntry,
  asOf: string = todayUtc(),
): DailyGridArchive {
  const others = archive.entries.filter((e) => e.board_id !== entry.board_id);
  const entries = sortEntries([entry, ...others]).slice(0, DAILY_GRID_ARCHIVE_MAX);
  return derive(entries, asOf);
}

/** Has the player already finished the board for `date`? */
export function hasCompleted(archive: DailyGridArchive, date: string): boolean {
  return archive.entries.some((e) => e.date === date);
}

/** The `limit` most recent completed boards, newest first. */
export function recentEntries(
  archive: DailyGridArchive,
  limit: number = 5,
): DailyGridArchiveEntry[] {
  return archive.entries.slice(0, limit);
}
