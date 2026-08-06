"""Pydantic request/response models for the 82-0 Peak Season / CourtBuilder API.

ADR-005 Decision 6, enforced at the type level too: PublicCourtStateResponse
never carries a score/rank field for the current round's candidates -- only
`current_spin.candidates` (name only) and `slots[].individual_peak_score`
(only present once a slot is filled/locked).
"""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CreatePerfectSeasonGameRequest(BaseModel):
    mode: str = Field(..., description="apex_1y | prime_3y | foundation_5y")
    seed: Optional[int] = Field(None, description="explicit seed; random if omitted")
    # Phase 9A: "free_play" (default) | "daily". For a daily attempt the seed
    # is ALWAYS derived server-side from (challenge_date, mode) and any
    # client-supplied `seed` is ignored -- otherwise a client could request a
    # run labeled as today's shared challenge that nobody else could
    # reproduce (see state.py::create_perfect_season_game).
    challenge_kind: str = Field("free_play", description="free_play | daily")
    challenge_date: Optional[str] = Field(
        None, description="YYYY-MM-DD; daily only. Defaults to today (UTC)."
    )


class SelectPlayerRequest(BaseModel):
    game_id: str
    player_slug: str = Field(..., description="candidate player_slug from the current spin")
    idempotency_key: Optional[str] = Field(None)


class CancelSelectionRequest(BaseModel):
    game_id: str


class RespinRequest(BaseModel):
    """Phase 6G Part C: body for both /respin-team and /respin-season --
    identical shape to CancelSelectionRequest (just a game_id confirmation),
    kept as its own type so the two respin kinds don't share a request
    model by coincidence.

    W5 (UX polish pass): `idempotency_key` is optional and per USER GESTURE,
    not per HTTP attempt. The respin handler used to be an unguarded
    read-modify-write, so a double-click could consume two of the three
    respins for one intended reroll. The client derives a stable key from
    (game_id, round, kind, respins already used), which means both clicks of
    a double-click produce the SAME key and the second is recognised as a
    replay. Omitting the key preserves the old behaviour exactly, so no
    existing caller breaks.
    """
    game_id: str
    # Bounded, matching run_the_table.py's `_MAX_ID_LENGTH`. Unbounded, this is
    # attacker-controlled data that gets PERSISTED: the key is written into
    # `last_respin_keys`, serialised into the game's JSONB payload, and then
    # re-read and re-written on every subsequent request for the life of the
    # game. A megabyte-long key would ride along forever.
    idempotency_key: Optional[str] = Field(None, max_length=128)


class PlaceCardRequest(BaseModel):
    game_id: str
    slot_type: str = Field(..., description="PG | SG | SF | PF | C | bench_1 | bench_2 | bench_3")
    idempotency_key: Optional[str] = Field(None)


class SwapSlotsRequest(BaseModel):
    """Phase 9B: move/swap two already-placed cards to optimize position fit.

    Deliberately NOT a respin -- it consumes no respin budget, never touches
    the board or any spin, and can never add or remove a card. Rejected once
    the run is simulated (status == "result_ready"), since that result is the
    saved/shared artifact.
    """
    game_id: str
    slot_a: str = Field(..., description="PG | SG | SF | PF | C | bench_1 | bench_2 | bench_3")
    slot_b: str = Field(..., description="the destination slot; must differ from slot_a")


class CompleteGameRequest(BaseModel):
    game_id: str


class UndoRequest(BaseModel):
    """launch-polish IMPLEMENTATION_CONTRACT.md §5. No reversal details of
    any kind -- not a slot, not a card, not "place" vs "swap". The client
    sends its intent (undo the last thing) and its belief about the
    current state (expected_state_version, from the last
    PublicCourtStateResponse it received); the server decides, from ITS
    OWN stored `undo_snapshot`, what that means and whether it is still
    valid. This is the same asymmetry `PlaceCardRequest`/`SwapSlotsRequest`
    already have (a slot_type or two slot_types, never a card) taken one
    step further: here the client does not even name what it wants undone,
    only that it wants the last thing undone.
    """
    game_id: str
    expected_state_version: int = Field(
        ..., description="The state_version from the last state this client received."
    )
    # Same bound and same reasoning as RespinRequest.idempotency_key: a
    # stable, client-derived key (e.g. from game_id + the state_version
    # being undone) so a double-click or a retried request replays the
    # prior result instead of double-undoing.
    idempotency_key: Optional[str] = Field(None, max_length=128)


class SubmitRunRequest(BaseModel):
    """Phase 6G Part E: the ONLY client-controlled input to a leaderboard
    submission is which completed game to submit -- every scored/roster
    field is recomputed server-side from the saved game state, never taken
    from the request body (Part E: 'Client must never submit arbitrary
    wins/score')."""
    game_id: str


class SetRunVisibilityRequest(BaseModel):
    """SCORE_RECONCILIATION.md gap #3: the one mutation a submitted run may
    ever undergo. `is_public` only -- every scored/roster field remains the
    immutable record of what was submitted."""
    is_public: bool


class PerfectSeasonRunPublic(BaseModel):
    id: str
    display_name: str
    mode: str
    game_type: str
    # THE PUBLIC RECEIPT. A board row asserts a record and a score; without
    # this there is no way from the assertion to the roster behind it, which
    # made "82-0, 91.4" a number a reader had to take on trust.
    #
    # SAFE TO PUBLISH, and not a new decision: `game_id` is already the share
    # link every player sends (`/arena/court/results/{game_id}`), and
    # `GET /perfect-season/games/{game_id}/shared-result` deliberately takes no
    # identity because there is nothing there for ownership to protect -- it
    # 404s anything not `result_ready` and strips every owner-scoped key by
    # name. Every row on this board is `is_public = TRUE`, so its owner has
    # already published the result; this publishes the way to check it.
    game_id: str
    seed: int
    wins: int
    losses: int
    lineup_score: float
    score_status: str
    exact_cards_scored: int
    total_cards: int
    team_respins_used: int
    season_respins_used: int
    data_version: Optional[str] = None
    formula_version: Optional[str] = None
    simulation_version: Optional[str] = None
    created_at: str


class LeaderboardResponse(BaseModel):
    leaderboard_enabled: bool
    runs: list[PerfectSeasonRunPublic] = []
    next_cursor: Optional[str] = None
    # Echoes the request's own `daily` flag/resolved date, so a client never
    # has to infer from the row contents alone whether it is looking at the
    # all-time or the daily board.
    daily: bool = False
    daily_key: Optional[str] = None


class MyRunsResponse(BaseModel):
    runs: list[PerfectSeasonRunPublic] = []


class PersonalPlacementResponse(BaseModel):
    """SCORE_RECONCILIATION.md gap #2: where the caller stands on the public
    leaderboard, not merely their own submitted runs. `rank`/`run` are both
    `None` together -- never one without the other -- when the caller has no
    public run in `mode`."""
    leaderboard_enabled: bool
    mode: Optional[str] = None
    rank: Optional[int] = None
    run: Optional[PerfectSeasonRunPublic] = None


# ---------------------------------------------------------------------------
# Phase 9A: saved runs (private personal history), personal bests, and the
# daily challenge descriptor.
# ---------------------------------------------------------------------------

class SavedRunPublic(BaseModel):
    """One completed run in the owner's own history. Private -- only ever
    returned to the authenticated owner. `game_id` doubles as the share/open
    link target (/arena/court/results/{game_id}); it is the same already-
    public game id, never a signed token or credential."""
    id: str
    game_id: str
    mode: str
    seed: int
    wins: int
    losses: int
    lineup_score: float
    score_status: str
    exact_cards_scored: int
    total_cards: int
    leaderboard_eligible: bool
    challenge_kind: str
    challenge_date: Optional[str] = None
    is_perfect_season: bool
    team_respins_used: int = 0
    season_respins_used: int = 0
    roster: list[dict] = []
    spin_history: list[dict] = []
    peak_picks_matched: Optional[int] = None
    peak_picks_total: Optional[int] = None
    data_version: Optional[str] = None
    formula_version: Optional[str] = None
    simulation_version: Optional[str] = None
    created_at: str


class SaveRunRequest(BaseModel):
    """The ONLY client-controlled input to a save is which completed game to
    save -- every scored/roster field is recomputed server-side from the
    saved game state (same discipline as SubmitRunRequest)."""
    game_id: str


class PersonalBestsPublic(BaseModel):
    total_runs: int = 0
    best_run: Optional[SavedRunPublic] = None
    best_wins: Optional[int] = None
    # Best OFFICIAL lineup score -- only ever set from a fully-scored run, so
    # a provisional run's honest 0.0 never becomes a "personal best score".
    best_lineup_score: Optional[float] = None
    best_lineup_score_run: Optional[SavedRunPublic] = None
    best_daily_run: Optional[SavedRunPublic] = None
    perfect_season_count: int = 0
    recent_runs: list[SavedRunPublic] = []


class SaveRunResponse(BaseModel):
    """The save result plus how it compared to the user's PREVIOUS bests --
    so the UI can say "New personal best" / "Tied your best" / "Below your
    best" without recomputing the tiebreaker rules client-side."""
    saved_run: SavedRunPublic
    # "first_run" | "new_personal_best" | "tied_personal_best" | "below_personal_best"
    comparison: str
    # True when this exact game was already in history (a retry/double-click)
    # -- the response is still the real saved run, just not a new one.
    already_saved: bool = False
    personal_bests: PersonalBestsPublic


class SavedRunsResponse(BaseModel):
    runs: list[SavedRunPublic] = []
    personal_bests: PersonalBestsPublic


class DailyChallengeResponse(BaseModel):
    """Today's (or a given date's) shared PEAK Season challenge. `seed` is
    deliberately public -- it is the very thing that must be identical for
    every player on this date, and the client already passes an explicit seed
    for a replayable free-play board."""
    challenge_date: str
    mode: str
    seed: int
    challenge_id: str
    board_type: str
    daily_challenge_version: str
    # How many times the authenticated user has already SAVED a run for this
    # exact daily (date, mode). 0 for an anonymous caller -- attempts are
    # tracked per account, and Phase 9A surfaces the count rather than
    # hard-blocking a replay (see the route's own comment).
    attempts_used: int = 0
    already_played: bool = False


class SpinCandidate(BaseModel):
    player_slug: str
    player_name: str
    # v1 archetype-approximated position eligibility (never a score) --
    # shown during selection so a player can see "allowed positions" before
    # picking, per docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md Sec 6.4b.
    # For team_year candidates, this is the player's REAL per-season
    # position (nba_peak.perfect_season.positions.parse_real_position), not
    # an archetype approximation.
    primary_position: Optional[str] = None
    secondary_positions: list[str] = []
    # Phase 6C: exact team-season identity fields. None for team_decade/
    # exact_team_season/open_pool candidates (those resolve via the legacy
    # peak-window card path); always set for team_year candidates.
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    season: Optional[str] = None
    # canonical_250 | qualifies_1500 | team_year_roster_only | unresolved
    identity_pool_status: Optional[str] = None
    # exact_season_scored | exact_season_unscored | score_unavailable --
    # never a score/rank itself (ADR-005 Decision 6), only whether one
    # exists.
    score_status: Optional[str] = None
    # Phase 7A Part A: exact_team_stint | exact_season_aggregate | roster_only_unscored
    score_source: Optional[str] = None
    # Phase 6F/7A: populated from data/game/assets/player_assets.v3.json
    # (ESPN + NBA_CDN providers) ONLY when Settings.ENABLE_EXTERNAL_ASSET_URLS
    # is true (default off) -- None otherwise, and the frontend falls back
    # to initials for a None/missing URL either way (PlayerAvatar's
    # imageUrl prop).
    headshot_url: Optional[str] = None


class CurrentSpinPublic(BaseModel):
    round_number: int
    spin_type: str
    franchise_display_name: Optional[str] = None
    era_label: Optional[str] = None
    candidates: list[SpinCandidate]
    # Phase 6C team_year fields -- None for team_decade/exact_team_season/
    # open_pool spins.
    team_id: Optional[str] = None
    candidate_source: Optional[str] = None  # "exact_team_season" for team_year spins
    data_version: Optional[str] = None
    coverage_mode: Optional[str] = None
    # Phase 6F Part C: only populated when Settings.ENABLE_EXTERNAL_ASSET_URLS
    # is true (default off).
    team_logo_url: Optional[str] = None
    # Phase 7A Part C: RUN-LEVEL respin budget (never resets per round --
    # 3 team + 3 season for the whole 8-round attempt) -- only populated
    # for team_year spins, since respins reroll the team+season reel that
    # only team_year mode has. None for team_decade/exact_team_season/
    # open_pool spins, which don't support respins at all.
    team_respins_used: Optional[int] = None
    team_respins_max: Optional[int] = None
    season_respins_used: Optional[int] = None
    season_respins_max: Optional[int] = None


class PendingSelectionPublic(BaseModel):
    # Exactly one of peak_window_id / exact_player_season_key is set,
    # matching which card type this pending selection resolved to.
    peak_window_id: Optional[str] = None
    exact_player_season_key: Optional[str] = None
    player_name: str
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    season: Optional[str] = None
    identity_pool_status: Optional[str] = None
    score_status: Optional[str] = None
    # Phase 7A Part A: exact_team_stint | exact_season_aggregate | roster_only_unscored
    score_source: Optional[str] = None
    primary_position: Optional[str] = None
    secondary_positions: list[str] = []
    # slot_type -> {"role_fit": ..., "role_fit_severity": ...} for every
    # currently open slot -- lets the UI show whether the pending pick fits
    # each open court/bench spot before it's placed (never blocking).
    #
    # Phase 9B: widened from a bare label string to the (label, severity)
    # pair. Off-position placements cost 0.0 / -5.0 / -14.0 depending on
    # severity, and without it the preview had to show one alarming
    # "off-slot" warning for all three. Widened on the SAME key rather than
    # added as a sibling because pending_selection's exact key set is
    # contract-tested (see tests/test_perfect_season.py's allowed-key sets).
    fit_by_open_slot: dict[str, dict[str, Optional[str]]] = {}
    # Phase 6F Part C: only populated when Settings.ENABLE_EXTERNAL_ASSET_URLS
    # is true (default off).
    headshot_url: Optional[str] = None


class CourtSlotPublic(BaseModel):
    slot_type: str
    filled: bool
    peak_window_id: Optional[str] = None
    exact_player_season_key: Optional[str] = None
    player_name: Optional[str] = None
    anchor_season: Optional[str] = None
    team_id: Optional[str] = None
    team_name: Optional[str] = None
    season: Optional[str] = None
    identity_pool_status: Optional[str] = None
    score_status: Optional[str] = None
    # Phase 7A Part A: exact_team_stint | exact_season_aggregate | roster_only_unscored
    score_source: Optional[str] = None
    # "primary" | "natural" | "off_position" | "bench" -- display-only
    # position/role fit note (nba_peak.perfect_season.positions.classify_fit
    # / classify_fit_from_position), set once the slot is filled; never
    # gates placement legality. Already-persisted runs may carry the older
    # "secondary"/"flexible" tokens, which remain valid on the wire.
    role_fit: Optional[str] = None
    # Phase 9B: "mild" | "moderate" | "severe" -- only ever set alongside
    # role_fit == "off_position". Optional with a None default so committed
    # saved runs (which predate this field) still validate.
    role_fit_severity: Optional[str] = None
    # The placed player's own position(s) -- v1 archetype-approximated for
    # peak-window cards, real per-season position for team_year cards. Lets
    # the UI explain an off-position placement ("plays SF") rather than
    # just flagging it, never a score.
    primary_position: Optional[str] = None
    secondary_positions: list[str] = []
    # Withheld until the roster is fully locked and simulated (status ==
    # "result_ready") -- see app/services/perfect_season/state.py::
    # get_public_state's "Deferred reveal" docstring. Always None before
    # that, even for an already-filled slot.
    individual_peak_score: Optional[float] = None
    individual_peak_rank: Optional[int] = None
    # Team_year mode's reveal-only score -- the real, official per-season
    # PEAK3 prime_score, never a career-peak substitute. None if score_status
    # != "exact_season_scored" (not fabricated).
    season_score: Optional[float] = None
    resolved_via_spin_id: Optional[str] = None
    # Phase 6F Part C: only populated when Settings.ENABLE_EXTERNAL_ASSET_URLS
    # is true (default off).
    headshot_url: Optional[str] = None
    # Phase 8F: the placed card's real team logo (team_year/exact-season
    # slots only -- peak-window slots have no single team attached). Same
    # ENABLE_EXTERNAL_ASSET_URLS gate as headshot_url.
    team_logo_url: Optional[str] = None


class SimulationResultPublic(BaseModel):
    lineup_model_version: str
    simulator_version: str
    fit_components: dict
    wins: int
    losses: int
    expected_wins: float
    expected_wins_low: float
    expected_wins_high: float
    decisive_factors: list[str]
    is_perfect_season: bool
    experimental_notice: str
    lineup_peak_score: float = 0.0
    # "complete" | "incomplete" -- team_year boards only ("complete" always
    # for legacy peak-window boards, whose cards are always scored). The UI
    # must show "Prototype score incomplete" instead of lineup_peak_score
    # when this is "incomplete" (score_substitution_allowed=false: an
    # incomplete score is reported as incomplete, never backfilled with a
    # career-peak or approximate value).
    lineup_score_status: str = "complete"
    # Phase 6F Part F: server-computed result explanation -- best_pick is the
    # highest real-score contributor; structural_weakness prioritizes roster
    # CONSTRUCTION issues (named off-position starters, missing wing/big
    # coverage, thin bench) over "whichever legend scored lowest". Phase 8H:
    # now computed for BOTH the exact-season and legacy career-peak-window
    # paths (nba_peak.perfect_season.simulation._structural_weakness is the
    # legacy-path counterpart of _structural_weakness_exact) -- previously
    # only the exact-season path had this depth.
    best_pick: Optional[str] = None
    structural_weakness: Optional[str] = None
    # Phase 8 pre-loop polish: one-sentence explainer for structural_weakness
    # (see nba_peak.perfect_season.simulation._COMPONENT_EXPLAINERS) -- e.g.
    # clarifies that "thin bench depth" is relative to the starters' own
    # 0-100 all-time-peak scores, not a real-world judgment on the players.
    # None when the weakness text is already self-explanatory or for legacy
    # peak-window boards (same scope as structural_weakness itself).
    structural_weakness_detail: Optional[str] = None
    # Phase 7A Part F: "weakness" | "ceiling_limiter" -- drives whether the
    # UI prefixes structural_weakness with "Weakness:" or "Ceiling limiter:".
    weakness_framing: Optional[str] = None
    # Phase 8H: "what PEAK3 would have picked" post-run recap -- see
    # nba_peak.perfect_season.schemas.SimulationResult.peak_picks_recap and
    # state.py::_compute_peak_picks_recap for the full contract. Only ever
    # populated once result_ready (the same reveal gate as every other
    # score-bearing field here).
    peak_picks_recap: Optional[list[dict]] = None


class ProvisionalRecordRange(BaseModel):
    low_wins: int
    high_wins: int


class LiveBuildPublic(BaseModel):
    """Phase 6E Part D: compact mid-run feedback. Never includes a hidden
    score, never names which open-round candidate to pick."""
    placed_count: int
    total_rounds: int
    scored_count: int
    unscored_count: int
    identity_tags: list[str] = []
    needs: list[str] = []
    provisional_record_range: Optional[ProvisionalRecordRange] = None
    # Phase 7A Part E: "early_projection" | "narrowing_projection" |
    # "ready_to_simulate" -- drives the UI copy so a wide early-round
    # range never reads as a confident prediction.
    projection_confidence: str = "early_projection"


class RunEligibilityPublic(BaseModel):
    """Phase 9A: whether a completed run can go on the official leaderboard,
    and why not when it can't. `savable` is deliberately independent --
    a provisional (unscored-card) run is always savable to personal history
    and always shareable/downloadable; only the ranked leaderboard requires
    a fully-scored roster. See
    app/services/perfect_season/state.py::compute_eligibility."""
    leaderboard_eligible: bool
    reason: str
    reason_detail: str
    savable: bool


class UndoAvailabilityPublic(BaseModel):
    """launch-polish IMPLEMENTATION_CONTRACT.md §5. Computed the same way
    `action_undo_last_placement` itself validates
    (app/services/perfect_season/state.py::_undo_availability_public), so
    this can never claim Undo is available when the action would actually
    reject it. No slot identity is exposed -- the client sends only the
    intent to undo (POST .../undo with no body beyond game_id/
    expected_state_version/idempotency_key), never a reconstructed
    reversal of its own."""
    available: bool
    kind: Optional[str] = None  # "place" | "swap" | None
    expires_at: Optional[str] = None


class PublicCourtStateResponse(BaseModel):
    game_id: str
    status: str
    mode: str
    current_round: int
    total_rounds: int
    current_spin: Optional[CurrentSpinPublic] = None
    pending_selection: Optional[PendingSelectionPublic] = None
    slots: list[CourtSlotPublic]
    board_seed: int
    card_pool_version: str
    board_generator_version: str
    interim_team_data_version: Optional[str] = None
    # Phase 6A receipt fields -- populated only for generate_team_year_board()
    # boards (team+YEAR engine); None for team_decade/open_pool boards.
    experimental_team_year_data_version: Optional[str] = None
    formula_version: Optional[str] = None
    coverage_mode: Optional[str] = None
    # Phase 6C: true only if this board actually contains an open_pool spin
    # (legacy team_decade path only, when the interim dataset can't fill all
    # rounds) -- always false for team_year boards, which never produce
    # open_pool spins. Named to match the readiness endpoint's
    # open_pool_enabled for consistency.
    open_pool_enabled: bool = False
    simulation_result: Optional[SimulationResultPublic] = None
    live_build: Optional[LiveBuildPublic] = None
    # Phase 6G Part C: every respin this attempt has used, across all
    # rounds -- {"round": int, "kind": "team"|"season", "from_team": str,
    # "from_season": str, "to_team": str, "to_season": str}. Part of the
    # data receipt; also read by the leaderboard submission path (Part E).
    respin_history: list[dict] = []
    # Phase 7A Part C: explicit run-level counters for the data receipt --
    # always present (unlike current_spin.team_respins_used, which is only
    # set while a team_year spin is active).
    team_respins_used_total: int = 0
    team_respins_remaining_total: int = 3
    season_respins_used_total: int = 0
    season_respins_remaining_total: int = 3
    # W5: distance-aware respin policy receipt. `respin_policy_version`
    # identifies the exclusion ladder in force; `respin_policy_debug` carries
    # one entry per applied respin (relaxation_tier, exclusion_radius,
    # history_depth, allowed_pool_size). Debug/audit surface only -- the
    # normal UI must not render pool sizes at the player.
    respin_policy_version: Optional[str] = None
    respin_policy_debug: list[dict] = []
    # Phase 9A: which retention loop this attempt belongs to, and (for a
    # daily attempt) the UTC date whose shared seed it uses.
    challenge_kind: str = "free_play"
    challenge_date: Optional[str] = None
    board_type: str = "practice"
    # Phase 9A: server-computed leaderboard eligibility -- see
    # app/services/perfect_season/state.py::compute_eligibility, the single
    # source of truth the /submit route enforces too.
    eligibility: Optional[RunEligibilityPublic] = None
    # launch-polish IMPLEMENTATION_CONTRACT.md §5: optimistic-concurrency
    # counter, echoed back as `expected_state_version` on an undo request.
    # See state.py::_touch for the one place it changes.
    state_version: int = 0
    undo: UndoAvailabilityPublic = UndoAvailabilityPublic(available=False)


class SharedCourtResultResponse(BaseModel):
    """The read-only scorecard behind a shared `/arena/court/results/{id}` link.

    A DELIBERATELY NARROWER MODEL, not `PublicCourtStateResponse` with some
    fields left null. The withheld fields (`current_spin`,
    `pending_selection`, `live_build`, `eligibility`, `respin_policy_debug` --
    see `state.py::SHARED_RESULT_WITHHELD_KEYS` for why each one) are absent
    from this schema entirely, so they are *unrepresentable* on this route
    rather than merely unset by the current projection. If a later change to
    `get_shared_result_state` stopped stripping one, this model would still
    refuse to emit it.

    Every field here is a property of a FINISHED run: the eight resolved
    cards, the simulation result, and the data receipt. Nothing on it is an
    action, which is what makes serving it unauthenticated correct while
    `GET /perfect-season/games/{game_id}` stays owner-only.
    """

    model_config = {"extra": "ignore"}

    game_id: str
    status: str
    mode: str
    current_round: int
    total_rounds: int
    slots: list[CourtSlotPublic]
    board_seed: int
    card_pool_version: str
    board_generator_version: str
    interim_team_data_version: Optional[str] = None
    experimental_team_year_data_version: Optional[str] = None
    formula_version: Optional[str] = None
    coverage_mode: Optional[str] = None
    open_pool_enabled: bool = False
    simulation_result: Optional[SimulationResultPublic] = None
    respin_history: list[dict] = []
    team_respins_used_total: int = 0
    team_respins_remaining_total: int = 3
    season_respins_used_total: int = 0
    season_respins_remaining_total: int = 3
    respin_policy_version: Optional[str] = None
    challenge_kind: str = "free_play"
    challenge_date: Optional[str] = None
    board_type: str = "practice"


class CourtBuilderCoverageSummary(BaseModel):
    """Per-mode (duration-aware) audit of interim-dataset candidate depth --
    see nba_peak.perfect_season.board.coverage_summary's docstring. Exists
    so coverage gaps are an inspectable API response, not something only
    discoverable by reading the interim dataset or board generator source."""
    available: bool
    mode: Optional[str] = None
    duration_years: Optional[int] = None
    total_combinations: int = 0
    playable_combinations: int = 0
    sparse_combinations: int = 0
    excluded_zero_candidate_combinations: int = 0
    per_era: dict[str, dict[str, int]] = {}
    per_team: dict[str, dict[str, int]] = {}


class CourtBuilderReadinessResponse(BaseModel):
    readiness_level: str
    courtbuilder_enabled: bool
    team_spin_enabled: bool
    interim_team_data_version: str
    interim_team_franchise_count: int
    # The actual resolvable team-wheel pool -- the frontend spin ceremony
    # cycles through exactly this list, never a broader decorative list that
    # includes franchises no spin could ever land on.
    interim_team_franchise_names: list[str] = []
    # Coverage audit for the requested mode (defaults to apex_1y) -- total/
    # playable/sparse/excluded combination counts plus per-era and per-team
    # breakdowns. See CourtBuilderCoverageSummary.
    coverage: CourtBuilderCoverageSummary
    # Phase 6D: experimental team+YEAR (exact season) engine, independent of
    # the team+decade fields above. Broad coverage as of v2 (1,310 rollable
    # team-seasons, 40 franchises, 1979-80..2025-26 -- see
    # data/game/experimental/player_pool_1500/
    # courtbuilder_team_year.experimental.v3.json's own coverage_note) --
    # still labeled experimental, not the canonical/official CourtBuilder mode.
    team_year_enabled: bool = False
    experimental_team_year_data_version: str = "unavailable"
    experimental_team_year_franchise_count: int = 0
    experimental_team_year_franchise_names: list[str] = []
    experimental_team_year_season_count: int = 0
    experimental_team_year_season_labels: list[str] = []

    # Phase 6C: exact-season-card-required contract + team-season coverage
    # visibility -- see nba_peak.perfect_season.board.experimental_team_year_summary.
    supported_start_season: str = "1979-80"
    supported_end_season: str = "2025-26"
    target_end_season: str = "2025-26"
    total_team_season_count: int = 0
    rollable_team_season_count: int = 0
    min_candidates_per_team_season: int = 0
    max_candidates_per_team_season: int = 0
    median_candidates_per_team_season: float = 0.0
    open_pool_enabled: bool = False
    exact_season_card_required: bool = True
    score_substitution_allowed: bool = False
    peak_card_substitution_allowed: bool = False
    sample_supported_team_seasons: list[str] = []
    low_coverage_team_seasons: list[str] = []
    season_2025_26_coverage_status: str = "not_covered"
    warnings: list[str] = []
    # Phase 6D: explicit spinner coverage lists -- teams_represented_in_spinner
    # is the franchise_ids_represented from the v2 dataset (identical set to
    # experimental_team_year_franchise_names above, different key name to
    # match the Phase 6D task's exact field naming); seasons_represented_in_
    # spinner is every season_label with at least one rollable team-season.
    supported_franchise_count: int = 0
    teams_represented_in_spinner: list[str] = []
    seasons_represented_in_spinner: list[str] = []

    # Phase 8I: franchise_display_name -> resolved logo URL, for every name
    # in interim_team_franchise_names / experimental_team_year_franchise_names
    # that actually has one -- lets the spin ceremony's reel show a real team
    # logo on EVERY visible item while it's ticking, not just the one team
    # that ends up landed (see SpinStage.tsx's ReelStrip). Same resolved-only,
    # never-fabricated contract as the existing per-spin team_logo_url, and
    # empty whenever Settings.ENABLE_EXTERNAL_ASSET_URLS is off -- names with
    # no resolved entry are simply absent from this map, never given a
    # placeholder/broken URL (the frontend already has a premium initials
    # fallback for exactly this case).
    team_logo_urls: dict[str, str] = {}
