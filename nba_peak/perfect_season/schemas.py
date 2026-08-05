"""Data schemas for the experimental 82-0 Peak Season / CourtBuilder model.

Plain dataclasses (no Pydantic), mirroring nba_peak/lineup/schemas.py's own
convention -- FastAPI Pydantic wrappers live in
apps/api/app/models/perfect_season.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from nba_peak.lineup.schemas import CardProfile


@dataclass
class SpinPrompt:
    """One round's spin prompt -- the team+decade/exact-team-season context
    (or the open-pool fallback when team spins are disabled).

    `candidate_player_slugs` is resolved once, at spin time, from the
    interim team dataset intersected with the current duration's card pool
    (or from a shuffled duration-filtered pool for the open-pool fallback).
    It is never re-resolved later -- the same discipline ADR-001/ADR-004 Sec 15
    already establish for board snapshots.
    """
    round_number: int  # 1..TOTAL_ROUNDS
    spin_type: str  # "team_decade" | "exact_team_season" | "team_year" | "open_pool"
    spin_id: Optional[str]  # interim dataset spin_id, or None for open_pool
    franchise_display_name: Optional[str]
    era_label: Optional[str]  # decade_label or season_label, or None for open_pool
    candidate_player_slugs: list[str]
    # Phase 6C: the exact team-season roll, required for team_year spins so
    # action_select_player can resolve an exact PlayerSeasonCard (never a
    # career-peak substitute) via nba_peak.perfect_season.exact_season.
    # None for team_decade/exact_team_season/open_pool spins (those still
    # resolve via the legacy CardProfile path).
    team_id: Optional[str] = None


@dataclass
class PerfectSeasonBoard:
    """A fully generated CourtBuilder board (private server-side structure).

    Mirrors nba_peak.lineup.schemas.Board's role in Peak Draft: immutable
    once created, referenced by every attempt against it. `card_pool_version`
    and `eligibility_ruleset_version` are pinned here at generation time
    (PHASE_5_DATA_MODEL.md entity 11's versioning requirement), never
    re-resolved from current defaults after creation.
    """
    board_id: str
    mode: str
    duration_years: int
    board_type: str  # "practice" only in Phase 5C -- see vertical slice doc Sec 0
    seed: int
    spins: list[SpinPrompt]  # exactly TOTAL_ROUNDS prompts
    card_pool_version: str
    eligibility_ruleset_version: str
    board_generator_version: str
    interim_team_data_version: Optional[str]  # None if team spins were disabled
    metadata: dict
    # Phase 6A: set only for boards built by generate_team_year_board() (the
    # experimental team+YEAR engine) -- None for every team+decade/open_pool
    # board from generate_board(). Kept as a distinct field from
    # interim_team_data_version rather than overloading it, since the two
    # engines read different, independently-versioned datasets.
    experimental_team_year_data_version: Optional[str] = None


@dataclass
class CourtSlot:
    """One roster position -- five position-anchored starters (PG/SG/SF/PF/C)
    + three plain, unrestricted bench slots (bench_1/bench_2/bench_3). Soft
    assignment, never a hard eligibility lock (master plan Sec 5.5) -- any
    player may be placed in any slot; `role_fit` records how well the v1
    archetype approximation says they fit, for display only.
    """
    slot_type: str  # e.g. "PG".."C", "bench_1", "bench_2", "bench_3"
    round_number: Optional[int] = None  # which round filled this slot
    peak_window_id: Optional[str] = None
    resolved_via_spin_id: Optional[str] = None
    # "primary" | "natural" | "off_position" | "bench" -- set at placement
    # time by nba_peak.perfect_season.positions.classify_fit_from_position()
    # (or classify_fit() on the legacy engine). Display-only; never gates
    # whether a placement is legal. Already-persisted runs may still carry
    # the older "secondary"/"flexible" tokens, which stay renderable.
    role_fit: Optional[str] = None
    # Phase 9B: "mild" | "moderate" | "severe", and only ever set alongside
    # role_fit == "off_position" (severity is meaningless otherwise -- see
    # positions.position_fit_severity).
    #
    # Why this has to be persisted rather than recomputed for display: the
    # three off-position tiers cost 0.0 / -5.0 / -14.0 simulation points
    # (simulation._OFF_POSITION_SEVERITY_POINTS), but severity was never
    # serialized, so the UI painted an alarming orange "Off-slot" pill on
    # placements the simulator had scored as completely free. Optional with a
    # None default so every already-committed saved run still validates.
    role_fit_severity: Optional[str] = None
    # Phase 6C: set instead of peak_window_id for team_year-mode boards --
    # an exact_season.PlayerSeasonCard.exact_player_season_key. The two
    # fields are mutually exclusive per slot (never both set), reflecting
    # the two entirely distinct card types (PeakWindowCard vs
    # PlayerSeasonCard) rather than overloading peak_window_id's meaning.
    exact_player_season_key: Optional[str] = None


@dataclass
class LineupFitComponents:
    """Lineup-fit dimensions (master plan Sec 5.6) -- explicitly separate from
    the canonical PEAK3 score (ADR-005 Decision 4). Components, never one
    unexplained number.

    PEAK3 product philosophy (see simulation.py's module docstring for the
    full rationale): a roster with several elite all-time peaks is NOT
    penalized just for having a lot of star talent -- there is no
    "too many stars"/"role redundancy" component here. `talent_core` and
    `bench_strength` are peak-value measures; `positional_fit` is the one
    component tied to a real board constraint (whether starters are placed
    at their eligible position), never to how much raw talent is on the
    roster.
    """
    talent_core: float
    bench_strength: float
    positional_fit: float  # 0-100; starters-only, real position constraint
    creation_coverage: float
    scoring_coverage: float
    postseason_pedigree: float
    team_context_depth: float

    def as_dict(self) -> dict[str, float]:
        return {
            "talent_core": self.talent_core,
            "bench_strength": self.bench_strength,
            "positional_fit": self.positional_fit,
            "creation_coverage": self.creation_coverage,
            "scoring_coverage": self.scoring_coverage,
            "postseason_pedigree": self.postseason_pedigree,
            "team_context_depth": self.team_context_depth,
        }


@dataclass
class SimulationResult:
    """The v0 simulation output -- frozen once at completion (mirrors
    PHASE_5_DATA_MODEL.md entity 10, lineup_score_snapshot).

    Explicitly labeled experimental everywhere it is surfaced
    (config.SIMULATOR_EXPERIMENTAL_NOTICE) -- never presented as a scientific
    prediction (ADR-005 Decision 4).
    """
    lineup_model_version: str
    simulator_version: str
    fit_components: LineupFitComponents
    wins: int
    losses: int
    expected_wins: float
    expected_wins_low: float
    expected_wins_high: float
    decisive_factors: list[str]
    is_perfect_season: bool
    experimental_notice: str
    # Phase 6A Goal 9: the durable, comparable score -- mean of the 8 placed
    # cards' real individual_peak_score values (0-100). See
    # simulation.py::simulate_season's own comment for why this, not the
    # noisy 82-0 record, is the "compare across runs" number.
    lineup_peak_score: float = 0.0
    # THE LINEUP-QUALITY INDEX: the weighted combination of the fit components
    # that this model's record projection is built from, BEFORE the win floor,
    # the 82-win cap and the seeded noise are applied.
    #
    # Surfaced rather than computed, and additive rather than a change: it is
    # the `base` value `simulate_exact_season` already computes on its way to
    # `expected_wins`. Nothing about `wins`, `expected_wins` or any 82-0
    # surface moves because this field exists.
    #
    # WHY IT IS PUBLISHED. `wins` and `expected_wins` both saturate -- the cap
    # is 82 and the generational floor is 81 -- so two genuinely different
    # elite rosters tie on both. `lineup_peak_score` does not saturate but is a
    # RAW MEAN of the cards' season scores, which knows nothing about bench,
    # position fit or coverage. A mode that has to rank rosters against each
    # other needs the model's actual lineup-quality judgement, unclamped and
    # unrounded to a win total: that is this number. Three-Man Weave ranks on
    # it (`nba_peak/three_man_weave/evaluation.py`).
    #
    # Not a win projection and must never be shown as one. It is an index on
    # roughly the same scale as expected wins by construction, but it is
    # deliberately not clamped to a legal record.
    lineup_quality: float = 0.0
    # Phase 6F Part F: structural result explanation, computed server-side
    # (single source of truth -- see simulation.py::_best_pick_exact /
    # _structural_weakness_exact) so the UI never has to re-derive "weakness"
    # from raw score alone. best_pick is the highest real-score contributor;
    # structural_weakness prioritizes ROSTER CONSTRUCTION issues (off-position
    # starters named with their real position, missing wing/big coverage,
    # thin bench) over "whichever legend happened to score lowest" -- see
    # module docstring's "never blame a strong player for a fit problem" rule.
    best_pick: str | None = None
    structural_weakness: str | None = None
    # Phase 8 pre-loop polish: one-sentence plain-English explainer for
    # structural_weakness -- see simulation.py::_COMPONENT_EXPLAINERS. Exists
    # because a bare label like "thin bench depth" reads as a real basketball
    # insult on its own; the detail clarifies it's relative to PEAK3's 0-100
    # all-time-peak scale, not an absolute real-world judgment. None when the
    # weakness text is already fully self-explanatory (a named off-position
    # starter, a data-coverage gap, or the below-contender bare-name
    # fallback) or for legacy peak-window boards (same scope as best_pick).
    structural_weakness_detail: str | None = None
    # Phase 7A Part F: "weakness" | "ceiling_limiter" -- for a contender/
    # dynasty-tier result (wins >= 65), the UI should frame
    # structural_weakness as what's capping the ceiling ("Ceiling limiter:
    # bench strength"), not as a fault ("Weakness: ..."), since at that win
    # level nothing about the roster is actually bad. None for legacy
    # peak-window boards (same scope as best_pick/structural_weakness).
    weakness_framing: str | None = None
    # Phase 8H: "what PEAK3 would have picked" recap -- one entry per round,
    # computed post-completion only (result_ready already reveals every
    # placed card's real score; this extends the same reveal to the
    # UNPICKED candidates from each round, which is new information but
    # never shown before the roster is locked -- see
    # state.py::_compute_peak_picks_recap). None for a game that hasn't
    # completed. Each entry is a plain dict (not a further-nested dataclass,
    # matching LineupFitComponents.as_dict()'s existing plain-dict-at-the-
    # API-boundary convention): round_number, slot_type, picked_player_name,
    # picked_score, peak_pick_player_name, peak_pick_score, matched (bool).
    peak_picks_recap: list[dict] | None = None


@dataclass
class UndoSnapshot:
    """Enough state to exactly reverse the single most recent placement or
    swap -- launch-polish IMPLEMENTATION_CONTRACT.md §5's authoritative
    Undo. Single-level, not a stack: the product surface is one "Undo"
    toast for the action you just took, not an undo history, so this is
    overwritten by the next placement/swap and consumed (cleared) by a
    successful undo -- never more than one of these live at a time.

    `kind == "swap"` needs no extra fields: a swap is its own inverse, so
    reversing it is re-swapping the same two slots (see
    state.py::action_undo_last_placement). `kind == "place"` needs the
    slot's identity plus everything action_place_card cleared/advanced, so
    undoing can put all of it back: the slot becomes empty again, the
    round and status roll back, and the same card becomes the pending
    selection again -- exactly as if placement had not happened.
    """
    kind: str  # "place" | "swap"
    # The exact state_version stamped by _touch() immediately after the
    # operation this reverses. Comparing this against the CURRENT
    # state.state_version at undo time is what "nothing has mutated the
    # state since" actually means -- any other mutating action bumps
    # state_version, which makes this comparison fail on its own, with no
    # separate invalidation step required.
    state_version_after: int = 0
    # Server-enforced bounded window (UNDO_WINDOW_SECONDS in state.py) --
    # ISO timestamp, checked regardless of reload; see that constant's own
    # comment for why the bound is time-based and reload-independent
    # rather than tied to a client session.
    expires_at: str = ""
    # "place" fields:
    slot_type: Optional[str] = None
    round_before: Optional[int] = None
    status_before: Optional[str] = None
    pending_selection_peak_window_id: Optional[str] = None
    pending_selection_exact_season_key: Optional[str] = None
    pending_selection_spin_id: Optional[str] = None
    # "swap" fields:
    slot_a: Optional[str] = None
    slot_b: Optional[str] = None


@dataclass
class CourtLineupState:
    """Complete CourtBuilder game state (server-side, includes private data).

    Mirrors nba_peak.lineup.schemas.DraftGameState's role for Peak Draft, but
    for the court-based game grammar -- deliberately a distinct type
    (PHASE_5_DATA_MODEL.md entity 8's open question, resolved: new narrow
    shape, not a DraftGameState subtype).
    """
    game_id: str
    board: PerfectSeasonBoard
    status: str
    # created -> prompt_active -> selection_locked -> placement_active ->
    # rounds_complete -> simulating -> result_ready
    # (master plan Sec 16.6's proposed 82-0 state machine)
    current_round: int  # 1..TOTAL_ROUNDS
    slots: list[CourtSlot]  # exactly TOTAL_ROUNDS slots, in SLOT_TYPES order
    # The candidate offered for the current round's selection step, before
    # being placed into a slot. Cleared once placed.
    pending_selection_peak_window_id: Optional[str] = None
    # Phase 6C: set instead of pending_selection_peak_window_id when the
    # current round is a team_year spin -- see CourtSlot.exact_player_season_key.
    pending_selection_exact_season_key: Optional[str] = None
    pending_selection_spin_id: Optional[str] = None
    simulation_result: Optional[SimulationResult] = None
    created_at: str = ""
    last_action_at: str = ""
    # launch-polish IMPLEMENTATION_CONTRACT.md §5's authoritative Undo:
    # incremented by exactly 1 on every state-mutating action (select,
    # cancel, place, swap, respin x2, complete -- see state.py's `_touch`,
    # the single place this happens). A dedicated integer counter rather
    # than reusing `last_action_at` for optimistic-concurrency purposes:
    # a wall-clock string conflates "when" with "which state", is not
    # guaranteed strictly monotonic in the presence of clock skew or
    # sub-resolution collisions, and is awkward to compare for equality
    # across a JSON round-trip. `state_version` exists for exactly one
    # job -- "is the client's idea of the current state still current" --
    # and does only that job. Starts at 0 for a freshly created game (no
    # mutating action has happened yet); the public state always echoes
    # the CURRENT value, never the version an action produced, so a client
    # comparing "what I was just shown" against "what I still see" is
    # comparing like with like.
    state_version: int = 0
    mode: str = ""
    duration_years: int = 1
    # Server-resolved only, never client-trusted (PHASE_5_DATA_MODEL.md
    # entity 8; same discipline as DraftGameState.owner_sub post-4.0A fix).
    owner_sub: Optional[str] = None
    # Phase 7A Part C: up to 3 team respins + 3 season respins for the
    # WHOLE 8-round run (never per-round -- Phase 6G's original per-round
    # reset was a bug), only usable while the current round's status is
    # "selection_pending" (locked the instant a player is selected -- see
    # action_select_player). NEVER reset by action_place_card -- once a
    # budget hits its max anywhere in the run, it stays disabled for every
    # remaining round. respin_history is a full receipt of every respin
    # this attempt has ever used, across all rounds -- never cleared, so
    # the final data receipt can show it.
    team_respins_used: int = 0
    season_respins_used: int = 0
    respin_history: list[dict] = field(default_factory=list)
    # W5 (UX polish pass): the distance-aware respin policy's own receipt --
    # one entry per applied respin, parallel to respin_history. Records which
    # exclusion tier actually fired, the exclusion radius / recent-team depth
    # it used, and how many entries the allowed post-exclusion pool held.
    #
    # This is DEBUG/AUDIT metadata, deliberately kept out of the normal UI
    # (docs/implementation/UX_ORGANIZATION_POLISH_PLAN.md Sec 5.5 step 6): the
    # player should feel the reroll travel, not read a pool-size number. It
    # exists so the relaxation ladder is provable in tests and in
    # scripts/audit_spinner_reroll_policy.py rather than merely asserted.
    respin_policy_debug: list[dict] = field(default_factory=list)
    # W5: APPLIED idempotency keys per respin kind ("team" / "season"), oldest
    # first, bounded to the whole run-level budget.
    #
    # A repeat of any remembered key is a replay (double-click, retried fetch,
    # refresh mid-animation, a second tab) and returns the current state
    # untouched instead of consuming another respin.
    #
    # This was a single string in the first cut, which only defended against
    # two ADJACENT duplicates: respin #2's key overwrote respin #1's, so a
    # delayed duplicate of #1 stopped being recognised, passed validation, and
    # both burned a respin and rerolled a board the player had already accepted.
    # `str` values are still read (see `_remembered_respin_keys`) so games
    # persisted under the old shape load without raising.
    last_respin_keys: dict[str, list[str]] = field(default_factory=dict)
    # Phase 9A: "free_play" | "daily". A daily attempt runs the exact same
    # engine on a date-derived seed (nba_peak.perfect_season.daily), so this
    # is NOT a game-mode switch -- it only records which loop the attempt
    # belongs to, so history/personal-bests can separate "my best daily" from
    # "my best free-play run" without inferring it from the seed value.
    challenge_kind: str = "free_play"
    # YYYY-MM-DD for a daily attempt, None for free play. Set server-side at
    # creation from the requested/derived UTC date -- never client-trusted as
    # a label for a seed that doesn't match it (see state.py's own check).
    challenge_date: Optional[str] = None
    # launch-polish IMPLEMENTATION_CONTRACT.md §5: the single most recent
    # undoable placement/swap, or None if there isn't one (never placed
    # anything yet, or the last undoable operation has already been
    # undone/superseded/expired). See UndoSnapshot's own docstring for why
    # this is one snapshot, not a stack.
    undo_snapshot: Optional[UndoSnapshot] = None
    # The idempotency key of the last SUCCESSFULLY APPLIED undo, so a
    # duplicate request (double-click, retried fetch) returns the same
    # result again instead of raising "nothing to undo" -- the same
    # replay-by-remembered-key shape as last_respin_keys, sized to 1
    # because undo has no multi-use budget to replay against; the moment a
    # new placement/swap happens, both this and undo_snapshot move on
    # together.
    last_undo_key: Optional[str] = None


# Re-exported so callers of this module do not need to import
# nba_peak.lineup.schemas directly just to type-hint a resolved card.
__all__ = [
    "CardProfile",
    "SpinPrompt",
    "PerfectSeasonBoard",
    "CourtSlot",
    "LineupFitComponents",
    "SimulationResult",
    "CourtLineupState",
]
