// 82-0 Peak Season / CourtBuilder TypeScript types (Phase 5C vertical slice
// + Phase 5X.4 team/era wheels, real position court, PEAK-based scoring).
// The simulator is EXPERIMENTAL (v0, uncalibrated) -- never a prediction of
// real NBA outcomes. See docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md.
//
// IMPORTANT: SpinCandidate and PendingSelection intentionally have NO score
// or rank field -- the backend never sends one before a pick is locked
// (ADR-005 Decision 6). Do not add one here "for convenience."

export type CourtMode = "apex_1y" | "prime_3y" | "foundation_5y";

export type CourtStatus =
  | "selection_pending"
  | "placement_pending"
  | "rounds_complete"
  | "result_ready";

// 5 position-anchored starter slots (v1 archetype approximation -- see
// nba_peak/perfect_season/positions.py; NOT real NBA position data) + 3
// plain, unrestricted bench slots (Bench 1/2/3 -- deliberately not
// role-flavored labels like "6th Man"/"Wildcard"). Order matters: starters
// first, then bench (mirrors the backend's SLOT_TYPES order in
// nba_peak/perfect_season/config.py).
export const SLOT_TYPES = [
  "PG", "SG", "SF", "PF", "C",
  "bench_1", "bench_2", "bench_3",
] as const;
export type SlotType = (typeof SLOT_TYPES)[number];

export const STARTER_SLOT_TYPES: SlotType[] = ["PG", "SG", "SF", "PF", "C"];
export const BENCH_SLOT_TYPES: SlotType[] = ["bench_1", "bench_2", "bench_3"];

// The 5 decades the era wheel spins across -- fixed by product decision, not
// derived from data coverage (docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md).
export const ERA_LABELS = ["1980s", "1990s", "2000s", "2010s", "2020s"] as const;

// Display-only fit note (nba_peak/perfect_season/positions.py::classify_fit /
// classify_fit_from_position) -- never gates whether a placement is legal.
//
//   primary      -- the slot IS the player's listed/primary position
//   natural      -- they really logged career minutes at this position
//                   (nba_peak/perfect_season/career_positions.py)
//   off_position  -- they didn't; grade it with `role_fit_severity`, NOT with
//                   one blanket warning (see FitSeverity below)
//   bench         -- a bench slot, which has no position restriction at all
//
// "secondary" and "flexible" are DEPRECATED aliases kept only so runs already
// saved to history/shared scorecards still render (fitLabel maps "secondary"
// to the same wording as "natural", and "flexible" to ""). Never emit them for
// new placements, and never reuse "flexible" for the mild off-position tier --
// it means "bench slot", not "this shift is fine".
export type RoleFit = "primary" | "natural" | "off_position" | "bench" | "secondary" | "flexible";

/** How big a real basketball problem an off-position placement is
 * (nba_peak/perfect_season/positions.py::position_fit_severity). Only ever
 * set alongside role_fit === "off_position". The three tiers are not cosmetic
 * -- they cost 0.0 / -5.0 / -14.0 simulation points respectively, so a "mild"
 * placement was scored as completely FREE by the model and must never be
 * painted with the same warning color as a "severe" one. */
export type FitSeverity = "mild" | "moderate" | "severe";

/** Fit label + severity for one slot, as sent by
 * PendingSelection.fit_by_open_slot. */
export interface SlotFitInfo {
  role_fit: RoleFit;
  role_fit_severity?: FitSeverity | null;
}

/** The plain-language fit label. Mirrors -- and must stay in sync with --
 * `fit_label()` in nba_peak/perfect_season/positions.py, which is the
 * server-side source of truth for this wording. */
export function fitLabel(roleFit: RoleFit | null | undefined, severity?: FitSeverity | null): string {
  if (!roleFit) return "";
  if (roleFit === "off_position") {
    if (severity === "mild") return "Flex fit";
    if (severity === "moderate") return "Role stretch";
    // Unknown severity falls back to the same conservative default the
    // simulator uses (see simulation.py::_fit_points) -- never silently
    // downgraded to the free tier.
    return "Structural mismatch";
  }
  if (roleFit === "primary") return "Primary fit";
  // "secondary" is the deprecated alias for the same idea as "natural".
  if (roleFit === "natural" || roleFit === "secondary") return "Natural fit";
  return ""; // "bench" / "flexible" -- no position restriction to report.
}

export const TOTAL_ROUNDS = 8;

// identity_pool_status: canonical_250 | qualifies_1500 | team_year_roster_only | unresolved
// score_status: exact_season_scored | exact_season_unscored | score_unavailable
export type IdentityPoolStatus = "canonical_250" | "qualifies_1500" | "team_year_roster_only" | "unresolved";
export type ScoreStatus = "exact_season_scored" | "exact_season_unscored" | "score_unavailable";
// Phase 7A Part A: exact_team_stint (normal case) | exact_season_aggregate
// (traded player -- real team-stint membership, but the score shown is the
// whole season's aggregate, not team-specific) | roster_only_unscored (team
// stint known, no score exists at all).
export type ScoreSource = "exact_team_stint" | "exact_season_aggregate" | "roster_only_unscored";

export interface SpinCandidate {
  player_slug: string;
  player_name: string;
  // For legacy peak-window candidates this is the v1 archetype-approximated
  // position; for team_year candidates it is the player's REAL per-season
  // position. Never a score either way. Shown during selection so a player
  // can see "allowed positions" before picking.
  primary_position: SlotType | null;
  secondary_positions: SlotType[];
  // Phase 6C exact-season fields -- present only for team_year candidates.
  team_id?: string | null;
  team_name?: string | null;
  season?: string | null;
  identity_pool_status?: IdentityPoolStatus | null;
  score_status?: ScoreStatus | null;
  score_source?: ScoreSource | null;
  // Phase 6E Part B: asset-manifest schema readiness -- always null today
  // (no image URLs are populated anywhere yet), rendered only if a caller
  // ever supplies a value (see PlayerAvatar's imageUrl prop / fallback
  // discipline). Never fabricated, never a scraped binary committed here.
  headshot_url?: string | null;
}

export interface CurrentSpin {
  round_number: number;
  // "team_year": exact-season spins, e.g. era_label="2015-16" -- never mixed
  // with "team_decade"'s ERA_LABELS decade strings on the same board, and
  // (Phase 6C) never "open_pool" either -- team_year boards only ever
  // produce team_year spins now.
  spin_type: "team_decade" | "exact_team_season" | "team_year" | "open_pool";
  franchise_display_name: string | null;
  era_label: string | null;
  candidates: SpinCandidate[];
  // Phase 6C team_year fields.
  team_id?: string | null;
  candidate_source?: string | null; // "exact_team_season" for team_year spins
  data_version?: string | null;
  coverage_mode?: string | null;
  // Phase 6F Part C: only populated when the backend has
  // ENABLE_EXTERNAL_ASSET_URLS on (default off).
  team_logo_url?: string | null;
  // Phase 6G Part C: respin budget for THIS round (resets every round).
  // Only populated for team_year spins -- respins reroll the team+season
  // reel, which only team_year mode has.
  team_respins_used?: number | null;
  team_respins_max?: number | null;
  season_respins_used?: number | null;
  season_respins_max?: number | null;
}

// Phase 6G Part C: one entry in the full respin receipt.
export interface RespinHistoryEntry {
  round: number;
  kind: "team" | "season";
  from_team: string | null;
  from_season: string | null;
  to_team: string | null;
  to_season: string | null;
}

/** W5: one entry in the distance-aware respin policy's audit trail, parallel
 * to `RespinHistoryEntry`. Debug/support surface -- deliberately not rendered
 * in the normal UI (see UX_ORGANIZATION_POLISH_PLAN.md Sec 5.5 step 6). */
export interface RespinPolicyDebugEntry {
  policy_version: string;
  kind: "team" | "season";
  round?: number;
  /**
   * The four policy fields below are OPTIONAL, and that is not defensive
   * padding. On the documented rollback path -- RESPIN_SEASON_EXCLUSION_RADIUS
   * and RESPIN_TEAM_HISTORY_DEPTH both 0 -- the server emits exactly
   * `{policy_version: "legacy_pre_policy", kind}` and nothing else, and the
   * wire field is typed `list[dict]` so nothing coerces the gap.
   *
   * Declaring them required would be the same defect this pass exists to fix:
   * `cost_modifiers: string[]` was a lie about a `list[dict]`, tsc believed it,
   * and `.join()` printed "[object Object]" in production. A type must be able
   * to hold everything the server can send.
   */
  /** Which rung of the exclusion ladder actually fired, e.g.
   * "same_team_radius_2" or "any_season_depth_1". */
  relaxation_tier?: string;
  tier_index?: number;
  /** Seasons within this many INDICES of the current one were excluded. */
  exclusion_radius?: number;
  /** How many recently-seen teams were excluded on top of the current one. */
  history_depth?: number;
  /** Size of the allowed pool the result was drawn uniformly from. */
  allowed_pool_size?: number;
  min_respin_pool?: number;
  relaxed?: boolean;
  below_min_pool?: boolean;
  from_team?: string | null;
  to_team?: string | null;
  from_season?: string | null;
  to_season?: string | null;
}

// Matches an exact-season era_label ("2015-16"), never a decade string.
export const EXACT_SEASON_RE = /^\d{4}-\d{2}$/;

export interface PendingSelection {
  // Exactly one of these two is set, matching which card type this pending
  // selection resolved to -- a PeakWindowCard (peak_window_id) or an exact
  // PlayerSeasonCard (exact_player_season_key). Never both.
  peak_window_id?: string | null;
  exact_player_season_key?: string | null;
  player_name: string;
  team_id?: string | null;
  team_name?: string | null;
  season?: string | null;
  identity_pool_status?: IdentityPoolStatus | null;
  score_status?: ScoreStatus | null;
  score_source?: ScoreSource | null;
  primary_position: SlotType | null;
  secondary_positions: SlotType[];
  // slot_type -> fit note + severity, for every currently open slot -- lets
  // the UI show whether the pending pick fits each open spot before it's
  // placed. Phase 9B widened the value from a bare RoleFit string to the
  // (role_fit, role_fit_severity) pair.
  fit_by_open_slot: Record<string, SlotFitInfo>;
  // Phase 6F Part C: only populated when the backend has
  // ENABLE_EXTERNAL_ASSET_URLS on (default off).
  headshot_url?: string | null;
}

export interface CourtSlotPublic {
  slot_type: SlotType;
  filled: boolean;
  peak_window_id?: string | null;
  exact_player_season_key?: string | null;
  player_name?: string | null;
  anchor_season?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  season?: string | null;
  identity_pool_status?: IdentityPoolStatus | null;
  score_status?: ScoreStatus | null;
  score_source?: ScoreSource | null;
  role_fit?: RoleFit | null;
  /** Phase 9B: only set alongside role_fit === "off_position". Required to
   * label the placement by its real cost -- see FitSeverity. */
  role_fit_severity?: FitSeverity | null;
  // The placed player's own position(s) -- v1 archetype-approximated for
  // peak-window cards, real per-season position for team_year cards. Used
  // to explain an off-position placement ("plays SF"), not just flag it.
  primary_position?: SlotType | null;
  // Phase 9B: the OTHER positions this player really played across their
  // career (career_positions.py). Previously always [] -- parse_real_position
  // never yields secondaries for the committed data -- so a multi-position
  // player rendered a bare "SF" instead of "SF / SG / PF".
  secondary_positions?: SlotType[];
  // Withheld by the server until status === "result_ready" -- always null
  // for a filled slot before then. See ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 3.5.
  individual_peak_score?: number | null;
  individual_peak_rank?: number | null;
  // Team-year mode's reveal-only score -- the real, official per-season
  // PEAK3 prime_score. Null whenever score_status !== "exact_season_scored"
  // (never fabricated, never a career-peak substitute).
  season_score?: number | null;
  resolved_via_spin_id?: string | null;
  // Phase 6F Part C: only populated when the backend has
  // ENABLE_EXTERNAL_ASSET_URLS on (default off).
  headshot_url?: string | null;
  // Phase 8F: the placed card's real team logo -- exact-season slots only
  // (peak-window slots have no single team attached). Same asset-flag gate.
  team_logo_url?: string | null;
}

export interface SimulationResultPublic {
  lineup_model_version: string;
  simulator_version: string;
  fit_components: Record<string, number>;
  wins: number;
  losses: number;
  expected_wins: number;
  expected_wins_low: number;
  expected_wins_high: number;
  decisive_factors: string[];
  is_perfect_season: boolean;
  experimental_notice: string;
  // The durable, comparable score (0-100) -- a real mean of the 8 placed
  // cards' own individual_peak_score/season_score values, distinct from the
  // noisier 82-0 record.
  lineup_peak_score: number;
  // "complete" | "incomplete" -- team_year boards only. When "incomplete",
  // at least one placed card has no exact-season score (score_status !==
  // "exact_season_scored"); the UI MUST show "Prototype score incomplete"
  // instead of lineup_peak_score in that case (score substitution/
  // backfilling with a career-peak value is forbidden).
  lineup_score_status: "complete" | "incomplete";
  // Phase 6F Part F: server-computed result explanation (see
  // nba_peak/perfect_season/simulation.py's _best_pick_exact/
  // _structural_weakness_exact, and (Phase 8H) their legacy-engine
  // counterparts _best_pick/_structural_weakness) -- structural_weakness
  // prioritizes roster CONSTRUCTION problems (named off-position starters,
  // missing wing/big coverage, thin bench) over "whichever legend scored
  // lowest". Computed for both engines since Phase 8H.
  best_pick?: string | null;
  structural_weakness?: string | null;
  // Phase 8 pre-loop polish: one-sentence explainer for structural_weakness
  // (e.g. clarifies that "thin bench depth" is relative to the starters'
  // own 0-100 all-time-peak scores, not a real-world judgment). Null when
  // the weakness text is already self-explanatory.
  structural_weakness_detail?: string | null;
  // Phase 7A Part F: "weakness" | "ceiling_limiter"
  weakness_framing?: string | null;
  // Phase 8H: "what PEAK3 would have picked" post-run recap -- one entry
  // per round, computed only once the roster is complete (never leaks
  // scores before a pick is made -- see state.py::_compute_peak_picks_recap
  // for the full contract). Null until then.
  peak_picks_recap?: PeakPickRecapEntry[] | null;
}

export interface PeakPickRecapEntry {
  round_number: number;
  slot_type: string;
  picked_player_name: string | null;
  picked_score: number | null;
  peak_pick_player_name: string | null;
  peak_pick_score: number | null;
  matched: boolean;
}

export interface ProvisionalRecordRange {
  low_wins: number;
  high_wins: number;
}

// Phase 6E Part D: compact mid-run feedback -- never a hidden score, never a
// "pick this candidate" recommendation. Present only once >=1 slot is
// filled, on team_year boards, before the roster is fully revealed.
export interface LiveBuild {
  placed_count: number;
  total_rounds: number;
  scored_count: number;
  unscored_count: number;
  identity_tags: string[];
  needs: string[];
  provisional_record_range: ProvisionalRecordRange | null;
  // Phase 7A Part E: "early_projection" | "narrowing_projection" | "ready_to_simulate"
  projection_confidence: "early_projection" | "narrowing_projection" | "ready_to_simulate";
}

export interface CourtLineupPublicState {
  game_id: string;
  status: CourtStatus;
  mode: CourtMode;
  current_round: number;
  total_rounds: number;
  current_spin: CurrentSpin | null;
  pending_selection: PendingSelection | null;
  slots: CourtSlotPublic[];
  board_seed: number;
  card_pool_version: string;
  board_generator_version: string;
  interim_team_data_version: string | null;
  // Phase 6A receipt fields -- populated only for team+year (generate_team_
  // year_board) boards; null for team_decade/open_pool boards.
  experimental_team_year_data_version?: string | null;
  formula_version?: string | null;
  coverage_mode?: string | null;
  // True only if this board contains a legacy open_pool spin (never true for
  // team_year boards, which never produce one).
  open_pool_enabled: boolean;
  simulation_result: SimulationResultPublic | null;
  live_build: LiveBuild | null;
  // Phase 6G Part C: every respin used this attempt, across all rounds.
  respin_history: RespinHistoryEntry[];
  // Phase 7A Part C: explicit run-level respin counters -- always present,
  // never reset per round.
  team_respins_used_total: number;
  team_respins_remaining_total: number;
  season_respins_used_total: number;
  season_respins_remaining_total: number;
  // W5: which distance-aware respin policy produced this run's rerolls, plus
  // the per-respin debug trail (exclusion radius, recent-team depth, which
  // relaxation rung fired, allowed pool size). DEBUG SURFACE ONLY -- never
  // rendered in the normal UI; the player should feel the reroll travel, not
  // read a pool-size number.
  respin_policy_version?: string | null;
  respin_policy_debug?: RespinPolicyDebugEntry[];
  // Phase 9A: which retention loop this attempt belongs to, and (for a daily
  // attempt) the UTC date whose shared seed it uses -- used to label the
  // scorecard rather than re-deriving the date from the seed.
  challenge_kind?: "free_play" | "daily";
  challenge_date?: string | null;
  board_type?: string;
  // Phase 9A: server-computed leaderboard eligibility -- the same helper the
  // /submit route enforces, so the UI can never disagree with it.
  eligibility?: RunEligibility | null;
  // Launch-polish LP2-2: optimistic-concurrency counter, bumped by exactly 1
  // on every state-mutating action (state.py::_touch). Echoed back as
  // `expected_state_version` on an undo request -- never computed or
  // incremented client-side.
  state_version: number;
  // Whether POST .../undo would currently succeed, computed the same way the
  // action itself validates -- this can never claim Undo is available when
  // the server would actually reject it. No slot identity is exposed; the
  // client sends only the intent to undo, never a reconstructed reversal.
  undo: UndoAvailability;
}

export interface UndoAvailability {
  available: boolean;
  kind: "place" | "swap" | null;
  expires_at: string | null;
}

/**
 * What a SHARED results link is allowed to know about a finished run.
 *
 * Mirrors `SharedCourtResultResponse` in apps/api/app/models/perfect_season.py
 * and, through it, `SHARED_RESULT_WITHHELD_KEYS` in the state machine. The
 * live-board keys (`current_spin`, `pending_selection`, `live_build`) plus
 * the debug trail are omitted from the Python model's own field list, so
 * `model_config = {"extra": "ignore"}` drops them from the response even
 * though `get_shared_result_state` never explicitly strips them; the same is
 * true of `state_version`/`undo` (LP2-2) -- a finished, shared result has no
 * action left to take on it, so there is nothing to stay in sync with or
 * undo. `eligibility` stays in the type because it is already optional and
 * the read-only scorecard has to compile against a state that simply does
 * not carry it.
 *
 * A full `CourtLineupPublicState` is structurally assignable to this, so the
 * components below take the NARROW type and serve both the owner's live
 * result screen and a shared link with one code path.
 */
export type SharedCourtResult = Omit<
  CourtLineupPublicState,
  "current_spin" | "pending_selection" | "live_build" | "respin_policy_debug" | "state_version" | "undo"
>;

// Duration-aware coverage audit of the interim dataset -- see
// nba_peak/perfect_season/board.py::coverage_summary. Mainly a diagnostic
// (dev script / manual review), not currently rendered in the play UI.
export interface CourtBuilderCoverageBreakdown {
  combinations: number;
  playable: number;
  sparse: number;
  excluded_zero_candidate: number;
}

export interface CourtBuilderCoverageSummary {
  available: boolean;
  mode?: string;
  duration_years?: number;
  total_combinations: number;
  playable_combinations: number;
  sparse_combinations: number;
  excluded_zero_candidate_combinations: number;
  per_era: Record<string, CourtBuilderCoverageBreakdown>;
  per_team: Record<string, CourtBuilderCoverageBreakdown>;
}

export interface CourtBuilderReadiness {
  readiness_level: string;
  courtbuilder_enabled: boolean;
  team_spin_enabled: boolean;
  interim_team_data_version: string;
  interim_team_franchise_count: number;
  // The actual resolvable team-wheel pool -- the spin ceremony cycles
  // through exactly this list, never a broader decorative/fake list.
  interim_team_franchise_names: string[];
  coverage: CourtBuilderCoverageSummary;
  // Phase 6A: experimental team+YEAR engine, independent of the team+decade
  // fields above. season_count is deliberately small in this pass -- see
  // data/game/experimental/player_pool_1500/courtbuilder_team_year.
  // experimental.v0.json's own coverage_note.
  team_year_enabled: boolean;
  experimental_team_year_data_version: string;
  experimental_team_year_franchise_count: number;
  experimental_team_year_franchise_names: string[];
  experimental_team_year_season_count: number;
  experimental_team_year_season_labels: string[];
  // Phase 6C: exact-season-card-required contract + coverage visibility.
  supported_start_season: string;
  supported_end_season: string;
  target_end_season: string;
  total_team_season_count: number;
  rollable_team_season_count: number;
  min_candidates_per_team_season: number;
  max_candidates_per_team_season: number;
  median_candidates_per_team_season: number;
  open_pool_enabled: boolean;
  exact_season_card_required: boolean;
  score_substitution_allowed: boolean;
  peak_card_substitution_allowed: boolean;
  sample_supported_team_seasons: string[];
  low_coverage_team_seasons: string[];
  season_2025_26_coverage_status: string;
  warnings: string[];
  // Phase 8I: franchise_display_name -> resolved logo URL, empty whenever
  // the asset gate is off. Not every rollable name is guaranteed a key --
  // the spin reel falls back to the initials badge for names not present.
  team_logo_urls: Record<string, string>;
}

// Phase 6G Part E: authenticated global leaderboard for PEAK Season.
export interface PerfectSeasonRunPublic {
  id: string;
  display_name: string;
  mode: CourtMode;
  game_type: string;
  seed: number;
  wins: number;
  losses: number;
  lineup_score: number;
  score_status: "complete" | "incomplete";
  exact_cards_scored: number;
  total_cards: number;
  team_respins_used: number;
  season_respins_used: number;
  data_version: string | null;
  formula_version: string | null;
  simulation_version: string | null;
  created_at: string;
}

export interface LeaderboardResponse {
  leaderboard_enabled: boolean;
  runs: PerfectSeasonRunPublic[];
  next_cursor: string | null;
}

export interface MyRunsResponse {
  runs: PerfectSeasonRunPublic[];
}

// ---------------------------------------------------------------------------
// Phase 9A: saved runs (private personal history), personal bests, daily
// challenge, and leaderboard eligibility.
// ---------------------------------------------------------------------------

/** Server-computed leaderboard eligibility (state.py::compute_eligibility).
 * `savable` is deliberately independent of `leaderboard_eligible`: a
 * provisional (unscored-card) run is always savable/shareable/downloadable,
 * it just can never be ranked. The UI must never re-derive this rule. */
export interface RunEligibility {
  leaderboard_eligible: boolean;
  reason: "eligible" | "incomplete_score" | "game_not_complete" | string;
  reason_detail: string;
  savable: boolean;
}

/** One card in a saved run's durable roster snapshot. Stored at save time
 * rather than re-resolved on read, so a saved scorecard can never silently
 * change later. */
export interface SavedRunRosterCard {
  slot_type: string;
  role_fit?: RoleFit | string | null;
  /** Phase 9B: snapshotted alongside role_fit so a saved scorecard can label
   * the three off-position tiers by their real cost. Absent on runs saved
   * before 9B -- fitLabel() then falls back to the conservative "severe"
   * wording rather than inventing a friendlier one. */
  role_fit_severity?: FitSeverity | null;
  player_name?: string;
  player_slug?: string;
  team_name?: string;
  team_id?: string;
  season?: string;
  score?: number | null;
  score_status?: string;
  position?: string | null;
}

export interface SavedRun {
  id: string;
  /** Also the share/open target: /arena/court/results/{game_id}. */
  game_id: string;
  mode: CourtMode;
  seed: number;
  wins: number;
  losses: number;
  lineup_score: number;
  score_status: "complete" | "incomplete";
  exact_cards_scored: number;
  total_cards: number;
  leaderboard_eligible: boolean;
  challenge_kind: "free_play" | "daily";
  challenge_date: string | null;
  is_perfect_season: boolean;
  team_respins_used: number;
  season_respins_used: number;
  roster: SavedRunRosterCard[];
  spin_history: Record<string, unknown>[];
  peak_picks_matched: number | null;
  peak_picks_total: number | null;
  data_version: string | null;
  formula_version: string | null;
  simulation_version: string | null;
  created_at: string;
}

export interface PersonalBests {
  total_runs: number;
  best_run: SavedRun | null;
  best_wins: number | null;
  /** Best OFFICIAL lineup score -- null when every saved run is provisional
   * (a provisional run's 0.0 is never treated as a personal best). */
  best_lineup_score: number | null;
  best_lineup_score_run: SavedRun | null;
  best_daily_run: SavedRun | null;
  perfect_season_count: number;
  recent_runs: SavedRun[];
}

export type RunComparison =
  | "first_run"
  | "new_personal_best"
  | "tied_personal_best"
  | "below_personal_best";

export interface SaveRunResponse {
  saved_run: SavedRun;
  comparison: RunComparison;
  /** True when this game was already in history (a retry/double-click). */
  already_saved: boolean;
  personal_bests: PersonalBests;
}

export interface SavedRunsResponse {
  runs: SavedRun[];
  personal_bests: PersonalBests;
}

export interface DailyChallenge {
  challenge_date: string;
  mode: CourtMode;
  /** Public by design -- this is the value that must be identical for every
   * player on this date. */
  seed: number;
  challenge_id: string;
  board_type: string;
  daily_challenge_version: string;
  attempts_used: number;
  already_played: boolean;
}

/**
 * User-facing labels for the flagship 82-0 surfaces (run history + the 82-0
 * leaderboard's board filter). Every consumer of this map is an 82-0 surface;
 * the legacy Peak Draft and Ranked screens have their own label maps
 * (`MODE_LABELS` in types/draft, `RANKED_MODE_LABELS` in types/ranked) and are
 * unaffected by this vocabulary.
 *
 * Phase 10C: these used to read "1Y Apex" / "3Y Prime" / "5Y Foundation",
 * inherited wholesale from the legacy 1Y/3Y/5Y draft modes when CourtBuilder
 * reused their ids as its board-variant ids. That was doubly wrong on the
 * flagship path:
 *
 *  1. It re-exposed retired game-mode branding in the one mode that IS the
 *     product, implying the old modes were still selectable here.
 *  2. It was inaccurate. On the exact-team-season path a mode's duration is
 *     only recorded as the board's `duration_years` metadata -- see
 *     `generate_team_year_board`, where the candidate pool comes from the real
 *     rostermates of the rolled team-season and the RNG is seeded from `seed`
 *     alone. The duration does not filter candidates, so cards are always
 *     exact single seasons regardless of mode. A card labeled "3Y" would have
 *     described a 3-year window that the board never builds.
 *
 * So the labels now name what actually differs -- which board variant a saved
 * run came from -- and mark the two the main product no longer creates as
 * legacy. The ids themselves are deliberately unchanged: saved runs, the
 * leaderboard, and run history all group by them.
 */
export const COURT_MODE_LABELS: Record<CourtMode, string> = {
  apex_1y: "Standard 82-0",
  prime_3y: "Legacy board (3Y)",
  foundation_5y: "Legacy board (5Y)",
};

export const SLOT_LABELS: Record<SlotType, string> = {
  PG: "Point Guard",
  SG: "Shooting Guard",
  SF: "Small Forward",
  PF: "Power Forward",
  C: "Center",
  bench_1: "Bench 1",
  bench_2: "Bench 2",
  bench_3: "Bench 3",
};

/**
 * @deprecated Phase 9B: use `fitLabel(roleFit, severity)` instead. A label
 * keyed on role_fit ALONE cannot be correct: it collapsed all three
 * off-position severities into one "Off-slot" pill, including the "mild" tier
 * the simulator scores at exactly 0.0 points -- which is how a completely
 * free placement ended up flagged as a problem. Kept only so any remaining
 * caller keeps compiling; every value here is superseded by fitLabel's.
 */
export const ROLE_FIT_LABELS: Record<RoleFit, string> = {
  primary: "Primary fit",
  natural: "Natural fit",
  secondary: "Natural fit",
  off_position: "Off-slot",
  bench: "",
  flexible: "",
};
