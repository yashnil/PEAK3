"""In-memory ArenaStandingsRepository -- dev/tests when DATABASE_URL is unset.

Composed from the two memory repositories that own the underlying data, through
their PUBLIC methods only, so this can never see a rating or a handle the real
owners would not return. The conformance suite runs the same assertions against
the Postgres join, which is what keeps the two answers identical.
"""
from __future__ import annotations

from typing import Any, Optional

from app.repositories.arena_standings_protocols import (
    ArenaRatingPopulation,
    ArenaStanding,
    ArenaStandingRow,
    ArenaStandingsRepository,
)

#: Large enough to read a whole mode. The memory backend is a dev/test fallback
#: whose populations are tiny; the Postgres implementation never does this.
_ALL = 10**9


class MemoryArenaStandingsRepository:
    def __init__(self, rating_repo: Any, profile_repo: Any) -> None:
        self._ratings = rating_repo
        self._profiles = profile_repo

    async def _board(self, mode: str) -> list[ArenaStandingRow]:
        rows = await self._ratings.get_leaderboard_page(mode, limit=_ALL, offset=0)
        board: list[ArenaStandingRow] = []
        for index, row in enumerate(rows):
            profile = await self._profiles.get_profile_by_auth_sub(row.owner_sub)
            handle = getattr(profile, "handle", None) if profile else None
            board.append(
                ArenaStandingRow(
                    owner_sub=row.owner_sub,
                    mode=row.mode,
                    rank=index + 1,
                    rating=row.rating,
                    rd=row.rd,
                    rated_matches=row.rated_matches,
                    handle=handle or None,
                    last_rated_match_at=row.last_rated_match_at,
                )
            )
        return board

    async def get_population(
        self, mode: str, established_min_matches: int
    ) -> ArenaRatingPopulation:
        board = await self._board(mode)
        return ArenaRatingPopulation(
            rated_players=len(board),
            listed_players=sum(1 for r in board if r.handle),
            established_players=sum(
                1 for r in board if r.rated_matches >= established_min_matches
            ),
        )

    async def list_top(
        self, mode: str, limit: int = 50, offset: int = 0
    ) -> list[ArenaStandingRow]:
        listed = [r for r in await self._board(mode) if r.handle]
        return listed[offset : offset + limit]

    async def get_standing(self, mode: str, owner_sub: str) -> Optional[ArenaStanding]:
        board = await self._board(mode)
        me = next((r for r in board if r.owner_sub == owner_sub), None)
        if me is None:
            return None
        return ArenaStanding(
            row=me, players_below=sum(1 for r in board if r.rating < me.rating)
        )

    async def list_neighbours(
        self, mode: str, owner_sub: str, above: int, below: int
    ) -> tuple[list[ArenaStandingRow], list[ArenaStandingRow]]:
        board = await self._board(mode)
        index = next((i for i, r in enumerate(board) if r.owner_sub == owner_sub), None)
        if index is None:
            return [], []
        ahead = [r for r in board[:index] if r.handle]
        behind = [r for r in board[index + 1 :] if r.handle]
        return (ahead[-above:] if above > 0 else []), behind[: max(0, below)]


assert isinstance(MemoryArenaStandingsRepository(None, None), ArenaStandingsRepository)
