// Daily Grid Challenge (Phase 11A) TypeScript types.
//
// THIS FILE IS THE CONTRACT. The API layer (apps/api/app/api/v1/daily_grid.py)
// and the UI are written against these shapes; every field here mirrors a
// serializer in nba_peak/daily_grid/. If a shape needs to change, change it
// here first, then both sides.
//
// IMPORTANT: there is deliberately NO field anywhere in this file carrying a
// cell's valid answers or its raw answer count. The board response is public
// and the answer key stays server-side (see generator.GridBoard.as_public_dict);
// a cell exposes only `rarity_bucket`, which is coarse enough to be safe and
// is what the scoring explanation needs. Do not add an `answers` or
// `answer_count` field "for convenience" -- that is the whole game.
//
// Grid scoring is `arena_points`, never `peak_score` (CLAUDE.md naming).
// `prime_score` is the model's own calibrated 0-100 season value.

export const GRID_SIZE = 3;

export type ConstraintCategory =
  | "team"
  | "award"
  | "era"
  | "position"
  | "peak"
  | "component"
  | "outcome";

export type RarityBucket =
  | "very_rare"
  | "rare"
  | "uncommon"
  | "common"
  | "very_common";

export type GridDifficulty = "easy" | "medium" | "hard";

/** One row or column condition. */
export interface GridConstraint {
  id: string;
  label: string;
  /** Compact form for the grid header, where space is tight. */
  short_label: string;
  category: ConstraintCategory;
  /** Full sentence explaining exactly what qualifies. Shown in the cell panel. */
  description: string;
}

/** One square's public facts. No answers, no answer count. */
export interface GridCellSpec {
  row: number;
  col: number;
  row_constraint_id: string;
  col_constraint_id: string;
  rarity_bucket: RarityBucket;
}

export interface GridRules {
  /** Phase 11A product decision: no player identity twice on one board. */
  unique_player_identity: boolean;
  grid_size: number;
}

/** GET /api/v1/daily-grid/board */
export interface DailyGridBoard {
  board_id: string;
  /** YYYY-MM-DD, UTC. */
  date: string;
  version: string;
  difficulty: GridDifficulty;
  rows: GridConstraint[];
  cols: GridConstraint[];
  cells: GridCellSpec[];
  rules: GridRules;
}

/** An exact NBA player-season -- the unit a cell is filled with. */
export interface PlayerSeasonCard {
  id: string;
  player_slug: string;
  player_name: string;
  /** "1990-91" */
  season: string;
  /** Basketball-Reference code, e.g. "CHI". */
  team: string;
  /** "Chicago Bulls" */
  team_name: string;
  /** Position listed for that season, e.g. "SG". May be "" if unlisted. */
  position: string;
  /** PEAK3 calibrated 0-100 single-season score. */
  prime_score: number;
  /** "1990-91 Michael Jordan" */
  label: string;
}

/** A search result: a player-season plus, when the server chose to say,
 *  whether it fits the selected cell.
 *
 *  `eligible` is null unless BOTH of these hold:
 *    - the search was scoped to a cell (row + col supplied), AND
 *    - the query narrowed to a specific player (few distinct identities).
 *
 *  That second condition is the game's skill split. "Who played for the
 *  Nuggets and was top-10% in Traditional Production?" is the actual puzzle
 *  and the search box must not answer it -- so a broad substring ("an", "er")
 *  comes back entirely unflagged, and cannot be used to harvest a cell's
 *  answer set. "Which of Alex English's seasons is the one?" is pure friction
 *  -- there is no attempt limit, so withholding it would only make the player
 *  submit the same name repeatedly -- so once they have named a player, the
 *  server marks which of that player's seasons qualify.
 *
 *  Ineligible results are still returned for a narrow query: hiding them
 *  would leak the answer set by omission. Render `eligible` when it is
 *  non-null; do not re-sort or filter on it. */
export interface PlayerSeasonSearchHit extends PlayerSeasonCard {
  eligible: boolean | null;
}

/** GET /api/v1/daily-grid/search */
export interface DailyGridSearchResponse {
  query: string;
  results: PlayerSeasonSearchHit[];
}

/** How one filled cell scored, broken into its terms. */
export interface CellScore {
  arena_points: number;
  /** The season's own prime_score, before the rarity multiplier. */
  quality_points: number;
  rarity_bucket: RarityBucket;
  /** Human-readable, e.g. "Rare square". */
  rarity_label: string;
  rarity_multiplier: number;
  /** arena_points minus quality_points, rounded -- what rarity added. */
  rarity_bonus: number;
}

export type ValidationReasonCode =
  | "unknown_answer"
  | "player_already_used"
  | "constraint_failed"
  | "cell_filled";

/** POST /api/v1/daily-grid/answer request. */
export interface SubmitAnswerRequest {
  date: string;
  row: number;
  col: number;
  answer_id: string;
  /** Identities already placed on this board, for the unique-player rule. */
  used_player_slugs: string[];
  /** [row, col] pairs already filled. */
  filled_cells: [number, number][];
}

/** POST /api/v1/daily-grid/answer response. */
export interface SubmitAnswerResponse {
  valid: boolean;
  /** Present only when invalid. A specific, teachable sentence. */
  reason?: string;
  reason_code?: ValidationReasonCode;
  /** Present whenever the id resolved, valid or not. */
  player_season?: PlayerSeasonCard;
  /** Present only when valid. */
  cell_score?: CellScore;
}

// ---------------------------------------------------------------------------
// Client-side state (localStorage). Not an API shape.
// ---------------------------------------------------------------------------

/** One filled square as persisted locally. */
export interface FilledCell {
  row: number;
  col: number;
  player_season: PlayerSeasonCard;
  cell_score: CellScore;
}

/** Everything the client persists for one day's board.
 *  Keyed by board_id, so a new date starts clean on its own. */
export interface DailyGridProgress {
  board_id: string;
  date: string;
  /** Schema version, so a future shape change can discard stale saves
   *  instead of crashing on them. */
  schema_version: number;
  filled: FilledCell[];
  /** Wrong submissions, for the completion recap. */
  incorrect_attempts: number;
  completed_at: string | null;
}

export const DAILY_GRID_PROGRESS_SCHEMA_VERSION = 1;

/** localStorage key for one board's progress. */
export function dailyGridProgressKey(boardId: string): string {
  return `peak3.daily-grid.${boardId}`;
}
