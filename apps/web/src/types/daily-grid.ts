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

/** An exact NBA player-season, WITHOUT its score.
 *
 *  Phase 11B: the objective is to build the highest-scoring valid grid, so
 *  `prime_score` IS the answer to the puzzle and never appears before a pick
 *  is locked. This type deliberately has no score field rather than an
 *  optional one — an optional field is a field someone eventually populates
 *  by accident. Search results and submit responses use this shape. */
export interface PlayerSeasonIdentity {
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
  /** "1990-91 Michael Jordan" */
  label: string;
}

/** A player-season with its score revealed.
 *
 *  REVEALED SHAPE — only valid in the post-completion result comparison. A
 *  locked square learns its own score through `CellScore.quality_points`, not
 *  through this type. */
export interface PlayerSeasonCard extends PlayerSeasonIdentity {
  /** PEAK3 calibrated 0-100 single-season score. */
  prime_score: number;
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
export interface PlayerSeasonSearchHit extends PlayerSeasonIdentity {
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
  /** Present whenever the id resolved, valid or not. Identity only — a
   *  rejected answer never returns its score, or every square would be a free
   *  score oracle. */
  player_season?: PlayerSeasonIdentity;
  /** Present only when valid. `quality_points` is the locked season's
   *  prime_score — this is where a score is revealed. */
  cell_score?: CellScore;
}

// ---------------------------------------------------------------------------
// Result / today's maximum (Phase 11B)
// ---------------------------------------------------------------------------

/** POST /api/v1/daily-grid/result request.
 *
 *  The server RE-VALIDATES all nine squares before returning anything: this
 *  response contains today's maximum, so claiming a finished board must not be
 *  enough to unlock it. */
export interface GridResultRequest {
  date: string;
  filled: { row: number; col: number; answer_id: string }[];
  incorrect_attempts: number;
}

/** One square, side by side: what the player used vs. what the maximum used. */
export interface ResultCell {
  row: number;
  col: number;
  row_constraint_label: string;
  col_constraint_label: string;
  user_player_season: PlayerSeasonCard;
  user_points: number;
  optimal_player_season: PlayerSeasonCard;
  optimal_points: number;
  /** optimal_points - user_points, floored at 0. */
  points_left: number;
  matched_optimal: boolean;
}

/** POST /api/v1/daily-grid/result response.
 *
 *  `exact_optimal` is true when `optimal_total` is the PROVABLE maximum rather
 *  than the best found. The UI wording depends on it — say "today's maximum"
 *  only when it is true, "PEAK3's best known" otherwise. */
export interface GridResultResponse {
  board_id: string;
  date: string;
  user_total: number;
  optimal_total: number;
  percent_of_best: number;
  exact_optimal: boolean;
  incorrect_attempts: number;
  squares_matching_optimal: number;
  cells: ResultCell[];
  best_cell: ResultCell;
  /** Null when the player matched the maximum on every square. */
  biggest_miss: ResultCell | null;
}

// ---------------------------------------------------------------------------
// Client-side state (localStorage). Not an API shape.
// ---------------------------------------------------------------------------

/** One LOCKED square as persisted locally.
 *
 *  Phase 11B: a valid pick cannot be changed on the daily board, so this is
 *  final once written. `player_season` is the identity shape the submit
 *  response returned; the square's score lives in `cell_score`. */
export interface FilledCell {
  row: number;
  col: number;
  player_season: PlayerSeasonIdentity;
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

/** Bumped to 2 in Phase 11B: `FilledCell.player_season` lost `prime_score`,
 *  so a v1 save carries a field the current shape does not define. Stale saves
 *  are discarded rather than migrated — a board is one day old at most. */
export const DAILY_GRID_PROGRESS_SCHEMA_VERSION = 2;

/** localStorage key for one board's progress. */
export function dailyGridProgressKey(boardId: string): string {
  return `peak3.daily-grid.${boardId}`;
}

/** localStorage key for "this player has seen the rules".
 *
 *  Global, not per-board: the rules do not change daily, and re-explaining
 *  them every morning to a returning player is friction, not onboarding. The
 *  panel stays reachable from a "How to play" control regardless. */
export const DAILY_GRID_RULES_SEEN_KEY = "peak3.daily-grid.rules-seen";
