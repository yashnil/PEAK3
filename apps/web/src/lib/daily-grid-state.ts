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
  DailyGridBoard,
  DailyGridProgress,
  FilledCell,
  GRID_SIZE,
  GridConstraint,
  RarityBucket,
  dailyGridProgressKey,
} from "@/types/daily-grid";

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

export function clearProgress(boardId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(dailyGridProgressKey(boardId));
  } catch {
    // ignore
  }
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

/** Adds (or replaces) one square. Returns a new progress object. */
export function withFilledCell(progress: DailyGridProgress, cell: FilledCell): DailyGridProgress {
  const filled = [...progress.filled.filter((c) => !(c.row === cell.row && c.col === cell.col)), cell];
  const complete = filled.length >= TOTAL_CELLS;
  return {
    ...progress,
    filled,
    completed_at: complete ? (progress.completed_at ?? new Date().toISOString()) : null,
  };
}

export function withoutCell(progress: DailyGridProgress, row: number, col: number): DailyGridProgress {
  return {
    ...progress,
    filled: progress.filled.filter((c) => !(c.row === row && c.col === col)),
    completed_at: null,
  };
}

export function withIncorrectAttempt(progress: DailyGridProgress): DailyGridProgress {
  return { ...progress, incorrect_attempts: progress.incorrect_attempts + 1 };
}

/** Highest arena_points. Ties break on the season's own prime_score, then
 *  reading order, so the recap is stable across renders. */
export function bestCell(filled: FilledCell[]): FilledCell | null {
  if (filled.length === 0) return null;
  return [...filled].sort(
    (a, b) =>
      b.cell_score.arena_points - a.cell_score.arena_points ||
      b.player_season.prime_score - a.player_season.prime_score ||
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

/**
 * The share payload. No emojis, no grid-of-squares glyphs -- the house style
 * for this mode is a plain readable summary (a coloured square grid would also
 * leak which squares are hard, and the difficulty of a square is the puzzle).
 */
export function buildDailyGridShareText(board: DailyGridBoard, progress: DailyGridProgress): string {
  const lines: string[] = [
    `PEAK3 Daily Grid — ${board.date}`,
    `Solved ${progress.filled.length}/${TOTAL_CELLS}`,
    `Score: ${totalArenaPoints(progress)}`,
  ];
  const best = bestCell(progress.filled);
  if (best) lines.push(`Best cell: ${best.player_season.label}`);
  const hardest = hardestCell(progress.filled);
  if (hardest) lines.push(`Hardest cell: ${cellShortTitle(board, hardest.row, hardest.col)}`);
  lines.push(SHARE_URL);
  return lines.join("\n");
}
