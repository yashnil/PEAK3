"""Persistence interface for SAVED PEAK Season runs + personal bests (Phase 9A).

Deliberately a THIRD, separate protocol alongside the two that already exist,
because all three store genuinely different things:

  CourtLineupRepository (protocols.py)
      In-progress and just-finished GAME STATE. Ephemeral by nature -- a
      board, its slots, and the pending selection. Anonymous-friendly.

  PerfectSeasonLeaderboardRepository (leaderboard_protocols.py)
      PUBLIC, immutable, competitive submissions. Gated behind
      COURTBUILDER_LEADERBOARD_ENABLED, requires a fully-scored roster, and
      exists to be ranked against other players.

  PerfectSeasonSavedRunRepository (this file)
      PRIVATE personal history. "What runs have I completed, and what's my
      best?" Never public, never ranked, and -- the key difference --
      deliberately accepts PROVISIONAL runs (rosters with unscored cards,
      see state.py::compute_eligibility). A provisional run is a real run
      that belongs in your own history even though it can never be ranked.

Merging any two of these would force a compromise: history would inherit the
leaderboard's fully-scored requirement (losing exactly the runs Phase 8K made
honest), or the leaderboard would inherit history's private-by-default
visibility. Keeping them separate is what lets each keep its own honest rule.

A saved run is a SNAPSHOT, not a live view: it stores the record, roster, and
recap as they were at completion. Re-deriving them later from the game state
would silently change history if the simulator or card data ever changes,
which is the opposite of what a personal best is for.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, runtime_checkable


@dataclass
class SavedRun:
    """One completed PEAK Season run saved to a signed-in user's history.

    Every scored/roster field is recomputed server-side from the saved
    CourtLineupState at save time -- never taken from the client (same
    discipline as PerfectSeasonRun; see the save route's own docstring).

    Deliberately stores NO secrets and NO tokens: `share_game_id` is the
    already-public game id that /arena/court/results/{id} accepts, not a
    signed share token or session credential.
    """
    id: str
    owner_sub: str
    game_id: str
    mode: str
    seed: int
    wins: int
    losses: int
    lineup_score: float
    # "complete" | "incomplete" -- mirrors SimulationResultPublic's own
    # lineup_score_status. An "incomplete" run stores its real
    # lineup_score (0.0, which simulate_exact_season reports rather than
    # fabricating a value) and is honestly excluded from best-lineup-score
    # comparisons rather than competing with a 0.0.
    score_status: str
    exact_cards_scored: int
    total_cards: int
    leaderboard_eligible: bool
    # "free_play" | "daily"
    challenge_kind: str = "free_play"
    # YYYY-MM-DD for a daily run, None for free play.
    challenge_date: Optional[str] = None
    is_perfect_season: bool = False
    team_respins_used: int = 0
    season_respins_used: int = 0
    # Snapshot of the 8 placed cards, in slot order -- plain dicts
    # (slot_type/player_name/season/team_name/score/score_status), enough to
    # render a history row or a full scorecard without re-resolving anything.
    roster: list[dict] = field(default_factory=list)
    # The attempt's full respin receipt, as stored on the game state.
    spin_history: list[dict] = field(default_factory=list)
    # Compact recap summary: how many rounds matched PEAK3's own top
    # available pick. The full per-round recap stays on the game state; this
    # is the durable at-a-glance number.
    peak_picks_matched: Optional[int] = None
    peak_picks_total: Optional[int] = None
    data_version: Optional[str] = None
    formula_version: Optional[str] = None
    simulation_version: Optional[str] = None
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class PersonalBests:
    """A user's PEAK Season personal bests, per the Phase 9A tiebreaker spec.

    `best_run` is the single best run overall by the ranked comparison in
    saved_run_ranking.py::personal_best_sort_key: wins, then official lineup
    score, then fewer provisional/unscored cards, then earliest timestamp
    (a tie broken toward whoever got there first).
    """
    total_runs: int = 0
    best_run: Optional[SavedRun] = None
    best_wins: Optional[int] = None
    # Best OFFICIAL lineup score -- only ever set from a fully-scored run,
    # never from a provisional one (whose lineup_score is honestly 0.0).
    best_lineup_score: Optional[float] = None
    best_lineup_score_run: Optional[SavedRun] = None
    # Best daily run, by the same comparison, restricted to challenge_kind
    # == "daily". None until the user has completed at least one daily.
    best_daily_run: Optional[SavedRun] = None
    perfect_season_count: int = 0
    recent_runs: list[SavedRun] = field(default_factory=list)


@runtime_checkable
class PerfectSeasonSavedRunRepository(Protocol):
    async def save_run(self, run: SavedRun) -> SavedRun:
        """Save a completed run to the owner's history.

        Idempotent by (owner_sub, game_id): saving the same completed game
        twice returns the ALREADY-SAVED record unchanged rather than
        creating a duplicate or overwriting it. A completed run's result is
        frozen (action_complete_game is itself idempotent), so a second save
        is always a retry/double-click, never new information.
        """
        ...

    async def get_run_by_game_id(self, owner_sub: str, game_id: str) -> Optional[SavedRun]: ...

    async def list_runs_for_owner(self, owner_sub: str, limit: int = 25) -> list[SavedRun]:
        """Most-recently-completed first."""
        ...

    async def get_personal_bests(self, owner_sub: str, recent_limit: int = 5) -> PersonalBests:
        """Aggregate personal bests for this owner. Returns an empty
        PersonalBests (never None) for a user with no saved runs, so callers
        never branch on a null."""
        ...

    async def count_daily_attempts(self, owner_sub: str, challenge_date: str, mode: str) -> int:
        """How many times this owner has already SAVED a run for one daily
        (date, mode). Phase 9A uses this to surface "you've already played
        today" rather than to hard-block a replay -- the attempt count is
        recorded honestly and the product decision about limiting is left to
        the next phase (see the daily route's own comment)."""
        ...
