"""Persistence interface for Arena public ratings.

A SEPARATE PROTOCOL FROM `ArenaRepository`, and the split is the same one
ranked already makes (`ranked_matchmaking` / `ranked_rating` / `ranked_integrity`
are three protocols, not one). A match and a rating have different lifecycles: a
match is written constantly during play and read only by its seats, while a
rating is written once at settlement and read by anyone looking at a public
leaderboard. Folding them together would put a world-readable query behind the
same interface as live, seat-private game state.

WHAT IS NOT HERE: LEADERBOARD STATISTICS. Wins, placements, lineup scores and
human/bot composition are aggregates over `arena_match_results` joined to
`arena_match_seats` -- the ARENA repository's tables. `get_player_stats` lives
there rather than here, because a rating repository reaching into another
repository's tables is how two repositories end up owning one table between
them. This one owns exactly `arena_ratings` and `arena_rating_history`.

IDEMPOTENCY IS THE INDEX, NOT A CHECK. `record_match_rating` relies on
`arena_rating_history_one_per_player_match_idx` to refuse a second write for the
same (owner_sub, match_id). It does NOT read first to decide whether to write:
that check-then-write is the race two concurrent settlements both win, and the
failure it produces -- a rating change applied twice -- is the one players
notice and cannot be talked out of.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, Sequence, runtime_checkable


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class ArenaRating:
    """One player's current rating in one mode."""

    owner_sub: str
    mode: str
    rating: float
    rd: float
    volatility: float
    rated_matches: int
    algorithm_version: str
    last_rated_match_at: Optional[datetime] = None
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)


@dataclass
class ArenaRatingHistoryEntry:
    """One rating change, append-only.

    `opponents` is the pairwise decomposition the change was computed from --
    see `services/arena/rating.py`. It is stored so a change can be explained
    and re-derived without re-running the match.
    """

    owner_sub: str
    mode: str
    match_id: str
    pre_rating: float
    pre_rd: float
    pre_volatility: float
    post_rating: float
    post_rd: float
    post_volatility: float
    unbounded_post_rating: float
    bound_applied: bool
    placement: int
    had_bot_opponent: bool
    algorithm_version: str
    opponents: list[dict] = field(default_factory=list)
    bot_policy_version: Optional[str] = None
    entry_id: Optional[int] = None
    created_at: datetime = field(default_factory=_now)


@dataclass
class ArenaLeaderboardRow:
    """One public leaderboard row, as the repository returns it.

    Carries `owner_sub` because the API needs it to join a public handle; the
    ROUTE is what strips it before serialising. The database withholds the
    column from anon/authenticated separately (migration 20260804140000), so the
    two layers fail independently rather than both depending on this comment.
    """

    owner_sub: str
    mode: str
    rating: float
    rd: float
    rated_matches: int
    last_rated_match_at: Optional[datetime] = None


@dataclass
class ArenaPlayerStats:
    """Aggregates over one player's RATED results in one mode.

    Mode-agnostic on purpose. `score_avg`/`score_best` are the mode's own
    primary comparison value (`arena_match_results.score`), and
    `detail_averages` holds whatever numeric keys the caller asked for out of
    the result `detail` JSONB -- so this structure does not know what a "lineup
    rating" or a "remaining budget" is, and a third mode needs no change here.

    MATCH COMPOSITION IS FIRST-CLASS. `matches_with_bots` is not a footnote: a
    player must be able to tell a bot-filled rated win from an all-human one,
    and a leaderboard that hides it is claiming an achievement the player did
    not necessarily earn against people.
    """

    owner_sub: str
    rated_matches: int = 0
    wins: int = 0
    losses: int = 0
    draws: int = 0
    podiums: int = 0            # finishes in the top half of the table
    placement_sum: int = 0
    score_avg: Optional[float] = None
    score_best: Optional[float] = None
    matches_with_bots: int = 0
    matches_all_human: int = 0
    detail_averages: dict[str, float] = field(default_factory=dict)
    detail_bests: dict[str, float] = field(default_factory=dict)

    @property
    def average_placement(self) -> Optional[float]:
        if not self.rated_matches:
            return None
        return round(self.placement_sum / self.rated_matches, 4)

    @property
    def podium_rate(self) -> Optional[float]:
        if not self.rated_matches:
            return None
        return round(self.podiums / self.rated_matches, 4)


@runtime_checkable
class ArenaRatingRepository(Protocol):
    async def get_ratings_for_subs(
        self, owner_subs: Sequence[str], mode: str
    ) -> dict[str, ArenaRating]:
        """Current ratings for these subjects, keyed by sub.

        Subjects with no rating yet are ABSENT rather than defaulted, so the
        caller decides what an unrated player starts at -- `rating.py` uses
        `initial_rating()`. A repository inventing a starting rating would put
        that policy in two places.
        """
        ...

    async def record_match_rating(
        self,
        entries: Sequence[ArenaRatingHistoryEntry],
        now: Optional[datetime] = None,
    ) -> int:
        """Persist one match's rating changes. Returns rows actually written.

        Returns 0 when this match was already rated for these players -- a
        replayed settlement is a no-op, not an error and not a second
        application. Both the history INSERT and the `arena_ratings` update are
        skipped together, so a replay cannot advance a rating without leaving a
        ledger row explaining it.

        All-or-nothing across the entries of one match: either every seat's
        change lands or none does, so a partially-rated match cannot exist.
        """
        ...

    async def get_leaderboard_page(
        self, mode: str, limit: int = 50, offset: int = 0
    ) -> list[ArenaLeaderboardRow]:
        """Public board for one mode, best first.

        Ordered `rating DESC, rated_matches DESC, owner_sub` -- the tie-break on
        match count puts the better-established of two equal ratings first, and
        the final `owner_sub` makes the order total so paging cannot repeat or
        skip a row. Excludes players with no rated matches (they are placeholder
        rows at the provisional default, not competitors).
        """
        ...

    async def list_history(
        self, owner_sub: str, mode: Optional[str] = None, limit: int = 50
    ) -> list[ArenaRatingHistoryEntry]:
        """One player's own rating ledger, newest first."""
        ...
