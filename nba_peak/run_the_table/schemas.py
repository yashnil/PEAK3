"""Plain dataclasses for RUN THE TABLE.

Follows the repository convention established by ``nba_peak/lineup/schemas.py``
and ``nba_peak/perfect_season/schemas.py``: the domain layer uses stdlib
dataclasses with no Pydantic dependency, and the FastAPI layer
(``apps/api/app/models/run_the_table.py``) wraps them only at the HTTP
boundary.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class RunCard:
    """One canonical exact 3-year prime window, priced for the run.

    Every field is copied from a committed PEAK3 artifact. ``lane_values`` are
    the raw canonical component contributions from
    ``data/web/peak_windows.json``; ``lane_index`` are those same values
    linearly rescaled to 0-100 across the eligible pool so five lanes on wildly
    different natural scales (team_achievement spans 0-3, statistical_impact
    spans ~13-37) can be read side by side. The rescale is published in
    :class:`PoolStats` and is monotonic, so it never changes any ordering.
    """

    peak_window_id: str
    player_id: str
    player_slug: str
    player_name: str
    duration_years: int
    start_season: str
    end_season: str
    anchor_season: str

    prime_score: float          # calibrated 0-100 display value
    prime_index: float          # raw ordering index
    overall_percentile: float   # rank percentile in the eligible pool, [0, 1]

    eligible_roles: tuple[str, ...]
    primary_role: Optional[str]

    lane_values: dict[str, float]        # canonical component contributions
    lane_index: dict[str, float]         # 0-100 rescaled, for lane comparison
    lane_percentiles: dict[str, float]   # 0-100 percentile within the pool

    base_cost: int
    data_completeness: str

    def is_eligible_for(self, role: str) -> bool:
        return role in self.eligible_roles


@dataclass(frozen=True)
class PoolStats:
    """Published normalisation constants for the eligible card pool.

    Surfaced through the API so the client can reproduce every lane index it
    is shown without recomputing PEAK3.
    """

    duration_years: int
    card_count: int
    excluded_count: int
    lane_min: dict[str, float]
    lane_max: dict[str, float]
    prime_score_min: float
    prime_score_max: float


@dataclass
class RosterSlot:
    """One roster position. ``card_id`` is None only for an empty bench slot."""

    slot_id: str            # one of ROLES, or "bench_1" / "bench_2"
    is_starter: bool
    role: Optional[str]     # the role this slot must satisfy (None for bench)
    card_id: Optional[str]


@dataclass
class Opponent:
    """A boss lineup. Curated from canonical cards, or deterministically generated."""

    boss_id: str
    name: str
    tagline: str
    act: int
    rule_id: Optional[str]
    starter_ids: tuple[str, ...]
    bench_ids: tuple[str, ...]
    source: str             # "curated" | "generated_fallback"


@dataclass
class NodeOption:
    """One of the branching choices offered at a stage."""

    node_id: str
    node_type: str
    title: str
    summary: str


@dataclass
class StagePlan:
    """The pre-generated content for one stage of the run.

    Generated up front from the seed and never mutated, so a run's graph is
    byte-identical for a given (seed, versions) tuple. Future stages are never
    included in a client payload unless the player has scouted them.
    """

    act: int
    stage: int
    options: tuple[NodeOption, ...]
    # node_id -> payload. Draft nodes carry offer card ids; trade nodes carry
    # the incoming card ids; film/rest carry nothing extra.
    payloads: dict[str, dict]


@dataclass
class RunBlueprint:
    """The complete deterministic content of a run, derived from the seed alone."""

    seed: int
    run_type: str
    date: Optional[str]
    starting_starters: tuple[str, ...]   # role-ordered, len == STARTER_SLOTS
    starting_bench: tuple[str, ...]
    system_offers: tuple[tuple[str, ...], ...]   # act-1 offer, post-boss-1 offer
    stages: tuple[StagePlan, ...]
    bosses: tuple[Opponent, ...]
    metadata: dict


@dataclass
class LaneResult:
    """One resolved lane of a battle."""

    lane: str
    label: str
    player_score: float
    opponent_score: float
    winner: str                     # "player" | "opponent" | "tie"
    margin: float
    tie_broken_by_rule: bool
    player_top_card_id: Optional[str]
    opponent_top_card_id: Optional[str]


@dataclass
class BattleResult:
    """A fully resolved boss battle."""

    boss_id: str
    act: int
    lanes: tuple[LaneResult, ...]
    player_lanes_won: int
    opponent_lanes_won: int
    ties: int
    outcome: str                    # "win" | "loss" | "draw"
    decided_by: str                 # "lanes" | "summed_margin" | "roster_total" | "exact_draw"
    summed_margin: float
    player_roster_total: float
    opponent_roster_total: float
    bench_weight: float
    rule_id: Optional[str]
    lives_after: int
    credits_awarded: int


@dataclass
class RunAction:
    """A recorded, replayable action."""

    action_type: str
    act: int
    stage: int
    payload: dict = field(default_factory=dict)
    idempotency_key: Optional[str] = None


@dataclass
class RunState:
    """Authoritative server-side run state.

    ``action_log`` is sufficient to replay the run from its blueprint, which is
    what ``nba_peak.run_the_table.state.replay`` and the audit script use to
    prove determinism.
    """

    run_id: str
    seed: int
    run_type: str
    date: Optional[str]

    status: str
    act: int                       # 1-3
    stage: int                     # 1-2 within the act; 3 == boss
    credits: int
    lives: int

    starters: list[RosterSlot]
    bench: list[RosterSlot]
    systems: list[str]
    veteran_minimum_used_in_act: dict[int, bool]

    pending_system_offer: Optional[tuple[str, ...]]
    active_node_id: Optional[str]
    scouted_stage_keys: list[str]
    resolved_node_ids: list[str]

    battles: list[BattleResult]
    action_log: list[RunAction]
    acquisitions: list[dict]
    trades: list[dict]

    created_at: str
    last_action_at: str
    owner_sub: Optional[str] = None
    versions: dict = field(default_factory=dict)

    def all_card_ids(self) -> list[str]:
        out = [s.card_id for s in self.starters if s.card_id]
        out += [s.card_id for s in self.bench if s.card_id]
        return out
