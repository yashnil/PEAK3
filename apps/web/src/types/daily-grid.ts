// Daily Grid Challenge TypeScript types.
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
  /** Season shape: minutes per game, games played. */
  | "context"
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

/** Where THIS account's attempt on today's board stands, decided server-side.
 *
 *  - `not_started` — no timed attempt exists yet, so pressing Start is what
 *    writes the timestamp.
 *  - `in_progress` — a start timestamp exists; the clock is already running.
 *  - `completed`   — the board has an official, server-validated result.
 */
export type DailyGridAttemptStatus = "not_started" | "in_progress" | "completed";

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
  /** Product decision since 11A: no player identity twice on one board. */
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
  /** What the board is about, e.g. "Ring Chasers". Derived server-side from
   *  the axes the client already has, so it carries no answer information. An
   *  open string, not a union — nothing switches on it. */
  theme: string;
  rows: GridConstraint[];
  cols: GridConstraint[];
  cells: GridCellSpec[];
  rules: GridRules;

  // -------------------------------------------------------------------------
  // Freshness / attempt block (hardening pass).
  //
  // EVERY FIELD BELOW IS OPTIONAL, and that is deliberate rather than lazy: the
  // server change that adds them ships independently of this client, and a
  // board response that predates it must degrade to exactly the previous
  // behaviour instead of rendering `undefined` or throwing on a property read.
  // Nothing in the UI may become unreachable because one of these is missing.
  // -------------------------------------------------------------------------

  /** YYYY-MM-DD in `timezone` — the board's identity, promoted to the top level
   *  so a caller does not have to reach into the nested `daily` block. */
  daily_key?: string;
  /** IANA zone the daily key is computed in. "America/Los_Angeles" today. */
  timezone?: string;
  /** The generator seed for this key. Public: the board is already public and
   *  no answer is seed-derived. */
  seed?: number;
  /** Stable id for the theme label, e.g. "two-way-night". `theme` stays the
   *  human string; nothing switches on either. */
  theme_id?: string;
  /** Stable digest over the criteria signature. Two adjacent days having the
   *  same hash is a generator defect, which is why it is exposed. */
  board_hash?: string;
  /** ISO-8601 UTC instant the window opens (inclusive). */
  starts_at?: string;
  /** ISO-8601 UTC instant the window closes (exclusive). */
  ends_at?: string;
  /** Seconds from when the server answered until `ends_at`. Floored at 0. */
  seconds_remaining?: number;
  /** This account's standing on today's board. */
  attempt_status?: DailyGridAttemptStatus;
}

/** POST /api/v1/daily-grid/{daily_key}/start response.
 *
 *  Idempotent by contract: a second call returns the FIRST call's
 *  `started_at`, so a double-click, a refresh and a second tab all resume the
 *  same attempt rather than resetting the clock.
 *
 *  `server_now` is paired with `started_at` so the client can derive elapsed
 *  time from the server's clock instead of its own; `elapsed_seconds` is the
 *  same subtraction done server-side, and is what the client actually uses. */
export interface DailyGridStartResponse {
  daily_key: string;
  /** ISO-8601 UTC instant the attempt's clock started. Written once. */
  started_at: string;
  /** ISO-8601 UTC instant the server answered. */
  server_now: string;
  /** `server_now - started_at`, floored at 0. */
  elapsed_seconds: number;
  attempt_status: DailyGridAttemptStatus;
}

/** The error code the start route returns for a key that is not today's.
 *
 *  Archive and challenge views must never start today's timed attempt, so the
 *  client refuses to send the request at all; this exists so that a request
 *  that slips through is recognised and swallowed rather than surfaced as a
 *  failure the player can do nothing about. */
export const DAILY_GRID_NOT_TODAYS_KEY = "not_todays_key";

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
  /**
   * This player's photograph, from the committed asset manifest
   * (`data/game/assets/player_assets.v3.json`), resolved server-side through
   * the same lookup 82-0 uses and keyed on the same `player_slug`.
   *
   * Null for roughly four identities in five — resolution needs a current NBA
   * roster entry and a Daily Grid board is mostly historical — and null for
   * ALL of them unless the API is running with
   * `PEAK3_ENABLE_EXTERNAL_ASSET_URLS`, which is off by default as a licensing
   * decision. `PlayerAvatar` draws its medallion in the identical reserved
   * box, so null is a design state rather than a missing asset.
   */
  headshot_url?: string | null;
}

/** What the player can do with one search result.
 *
 *  - `available` — fits this square and the identity is unused: playable.
 *  - `used` — this player is already somewhere on the board, so the
 *    distinct-identity rule rules out every one of their seasons.
 *  - `no_fit` — does not satisfy this square's two constraints.
 *  - `unknown` — the server withheld a verdict for this query (see below).
 *    Still playable: the player is choosing to find out. */
export type SearchHitStatus = "available" | "used" | "no_fit" | "unknown";

/** A search result: a player-season plus what can be done with it here.
 *
 *  `eligible` is null unless the search was scoped to a cell AND the response
 *  would name at most a few distinct QUALIFYING players. That cap is the
 *  game's skill split: "who played for the Nuggets and led the league in
 *  rebounding?" is the actual puzzle and the search box must not answer it, so
 *  a query whose hits approach a square's answer set comes back entirely
 *  `unknown` and cannot be used to harvest the key. A query naming one player
 *  — "which of Alex English's seasons is the one?" — is pure friction, since
 *  there is no attempt limit, so it always earns a verdict.
 *
 *  Unusable results are still returned: hiding them would leak the answer set
 *  by omission. Render `status`, disable the row when `selectable` is false,
 *  and do not re-sort or filter — the server's order is authoritative. */
export interface PlayerSeasonSearchHit extends PlayerSeasonIdentity {
  eligible: boolean | null;
  status: SearchHitStatus;
  /** False for `used` and `no_fit`. The single boolean a button needs, so the
   *  client never re-derives the rule from `status` + used-slug bookkeeping. */
  selectable: boolean;
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

/** One square, side by side: what the player used vs. what the BEST LEGAL GRID
 *  used.
 *
 *  The comparison is grid-to-grid, not square-to-square. The optimal answer in
 *  a square comes from ONE nine-different-players assignment, so it depends on
 *  what that assignment needed elsewhere — which is why the last two fields
 *  exist. Without them the screen prints things that look like bugs: a square
 *  the player actually won reads as "no better answer existed", and a player
 *  the optimal grid reuses reads as a duplicate. */
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
  /** The player scored MORE here than the best legal grid did, because that
   *  grid traded this square away for a bigger total elsewhere. */
  beat_optimal: boolean;
  /** The square where the PLAYER used this same identity, when the best legal
   *  grid also wanted them. Null when there is no overlap. */
  optimal_player_user_square: string | null;
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
// Official account-backed result (Phase 11D)
// ---------------------------------------------------------------------------

/** POST /api/v1/daily-grid/official request.
 *
 *  The same nine squares the result comparison takes, plus two presentational
 *  fields. Deliberately carries NO score: the server recomputes every stored
 *  number from the board, so there is nothing here for a client to inflate. */
export interface OfficialResultRequest extends GridResultRequest {
  /** Client wall-clock seconds. Stored for display and NEVER scored or ranked
   *  — the server does not time attempts, so this value is not verified. */
  elapsed_seconds?: number | null;
  /** Echoed for display; re-derived server-side from the board. */
  theme?: string | null;
}

/** POST /api/v1/daily-grid/official response.
 *
 *  `official_saved` is true whenever the account now HAS a record for this
 *  board; `created` is false when an earlier submit already made one. A retry
 *  is a success, not a conflict. */
export interface OfficialResultResponse {
  official_saved: boolean;
  created: boolean;
  board_id: string;
  board_date: string;
  board_version: string;
  score: number;
  optimal_total: number;
  percent_of_best: number;
  squares_matching_optimal: number;
  /** False for an archive replay reached through ?date=. */
  played_on_board_date: boolean;
  saved_at: string;
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
  /** ISO timestamp of the player's FIRST move on this board, not of the page
   *  load. Null until they make one. Persisted so the clock survives a
   *  refresh — elapsed time is always (completed_at ?? now) − started_at,
   *  never an interval accumulated in memory. */
  started_at: string | null;
  completed_at: string | null;
}

/** Bumped to 3 in Phase 11C: `started_at` was added, and a v2 save has no
 *  start time, so its elapsed time would be unknowable. Stale saves are
 *  discarded rather than migrated — a board is one day old at most, and the
 *  board_id itself changed with the generator version anyway. */
export const DAILY_GRID_PROGRESS_SCHEMA_VERSION = 3;

/** localStorage key for one board's progress. */
export function dailyGridProgressKey(boardId: string): string {
  return `peak3.daily-grid.${boardId}`;
}

// ---------------------------------------------------------------------------
// Local archive + streak (Phase 11D). Also localStorage; also not an API shape.
// ---------------------------------------------------------------------------

/** One finished board, kept after its day is over.
 *
 *  A SNAPSHOT, not a pointer: it stores the numbers as they were at
 *  completion rather than re-deriving them later. Re-deriving would mean a
 *  taxonomy or model change could silently rewrite a player's own history,
 *  which is the opposite of what a personal record is for — the same reasoning
 *  as `SavedRun` on the 82-0 side (apps/api/app/repositories/saved_run_protocols.py).
 *
 *  Carries no answer key: the nine picks are stored as display labels only, so
 *  a completed archive cannot be read back as a solution to an unplayed board
 *  by someone else on the same browser. */
export interface DailyGridArchiveEntry {
  board_id: string;
  /** YYYY-MM-DD, UTC — the board's date, not the completion timestamp. */
  date: string;
  theme: string;
  difficulty: GridDifficulty;
  started_at: string | null;
  completed_at: string;
  elapsed_seconds: number | null;
  score: number;
  /** Null when the comparison never loaded (API down at completion). The row
   *  still belongs in history; it just cannot show a percentage. */
  today_max: number | null;
  percent_of_max: number | null;
  /** The headline this result earned, stored rather than recomputed so a
   *  future change to the grade bands cannot restate an old day's result. */
  grade: string | null;
  misses: number;
  filled_count: number;
  /** True only for a board played on its own UTC date. An archive/replay board
   *  is recorded but never counts toward the live streak — see
   *  `recordCompletedBoard`. */
  counted_for_streak: boolean;
  /** "1990-91 Michael Jordan" per square, reading order. Display only. */
  picks: string[];
}

/** The player's whole local Daily Grid record.
 *
 *  Streak fields are DERIVED on write from `entries`, not accumulated blindly,
 *  so a corrupted or hand-edited counter is corrected the next time a board is
 *  completed rather than persisting forever. */
export interface DailyGridArchive {
  schema_version: number;
  /** Newest first, capped at DAILY_GRID_ARCHIVE_MAX. */
  entries: DailyGridArchiveEntry[];
  current_streak: number;
  longest_streak: number;
  total_completed: number;
  /** YYYY-MM-DD of the most recent board that counted for the streak. */
  last_streak_date: string | null;
  best_percent_of_max: number | null;
  best_score: number | null;
}

export const DAILY_GRID_ARCHIVE_SCHEMA_VERSION = 1;

/** How many completed boards are kept. A year is far more than any surface
 *  shows and still bounds a localStorage value that only ever grows. */
export const DAILY_GRID_ARCHIVE_MAX = 365;

/** localStorage key for the whole archive. Not board-scoped — this is the one
 *  Daily Grid value that deliberately OUTLIVES a single day. */
export const DAILY_GRID_ARCHIVE_KEY = "peak3.daily-grid.archive";

/** LEGACY localStorage key for "this player has seen the rules".
 *
 *  Superseded by the versioned multi-tour store in `lib/tour-state.ts` under
 *  the `"daily-grid"` tour id. It was an unversioned bare `"1"`, so a copy
 *  change could never replay onboarding for anyone who had already dismissed
 *  it once — which is the whole reason the tour store is versioned.
 *
 *  STILL READ, NEVER WRITTEN. The migration is one-way: `hasSeenRules()`
 *  accepts this key as proof the gate was already dismissed, so an existing
 *  player is not shown onboarding again on the day this ships, and every new
 *  acknowledgement goes to the versioned store. Do not reintroduce a write. */
export const DAILY_GRID_RULES_SEEN_KEY = "peak3.daily-grid.rules-seen";
