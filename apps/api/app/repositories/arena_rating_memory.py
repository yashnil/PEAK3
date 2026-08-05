"""In-memory ArenaRatingRepository -- dev/tests when DATABASE_URL is unset.

Async end to end even though nothing here awaits I/O, and deep-copying on the
way in AND out, for the same two reasons every other Memory* repository in this
package does it: the interface must be identical to the Postgres one so a test
that passes against this cannot fail against that, and a caller must never hold
a reference it can mutate behind the repository's back.

The idempotency rule is enforced here too, by an explicit key set standing in
for `arena_rating_history_one_per_player_match_idx`. It is not decoration: the
conformance suite runs the same assertions against both backends, so a memory
implementation that silently allowed a double rating would make the Postgres
guarantee untested rather than merely unimplemented here.
"""
from __future__ import annotations

import asyncio
import copy
from dataclasses import replace
from datetime import datetime, timezone
from typing import Optional, Sequence

from app.repositories.arena_rating_protocols import (
    ArenaLeaderboardRow,
    ArenaRating,
    ArenaRatingHistoryEntry,
    ArenaRatingRepository,
)


def _clone_rating(r: ArenaRating) -> ArenaRating:
    return replace(r)


def _clone_entry(e: ArenaRatingHistoryEntry) -> ArenaRatingHistoryEntry:
    return replace(e, opponents=copy.deepcopy(e.opponents))


class MemoryArenaRatingRepository:
    def __init__(self) -> None:
        self._ratings: dict[tuple[str, str], ArenaRating] = {}
        self._history: list[ArenaRatingHistoryEntry] = []
        self._rated_matches: set[tuple[str, str]] = set()  # (owner_sub, match_id)
        self._seq = 0
        self._lock = asyncio.Lock()

    async def get_ratings_for_subs(
        self, owner_subs: Sequence[str], mode: str
    ) -> dict[str, ArenaRating]:
        return {
            sub: _clone_rating(self._ratings[(sub, mode)])
            for sub in owner_subs
            if (sub, mode) in self._ratings
        }

    async def record_match_rating(
        self,
        entries: Sequence[ArenaRatingHistoryEntry],
        now: Optional[datetime] = None,
    ) -> int:
        if not entries:
            return 0
        now = now or datetime.now(timezone.utc)
        async with self._lock:
            # All-or-nothing: if ANY entry was already recorded this match has
            # already been rated, so nothing is written. Checked over the whole
            # batch before writing any of it, which is what makes a partially
            # rated match impossible rather than merely unlikely.
            keys = [(e.owner_sub, e.match_id) for e in entries]
            if any(k in self._rated_matches for k in keys):
                return 0

            written = 0
            for entry in entries:
                self._seq += 1
                stored = _clone_entry(entry)
                stored.entry_id = self._seq
                stored.created_at = now
                self._history.append(stored)
                self._rated_matches.add((entry.owner_sub, entry.match_id))

                key = (entry.owner_sub, entry.mode)
                existing = self._ratings.get(key)
                self._ratings[key] = ArenaRating(
                    owner_sub=entry.owner_sub,
                    mode=entry.mode,
                    rating=entry.post_rating,
                    rd=entry.post_rd,
                    volatility=entry.post_volatility,
                    rated_matches=(existing.rated_matches if existing else 0) + 1,
                    algorithm_version=entry.algorithm_version,
                    last_rated_match_at=now,
                    created_at=existing.created_at if existing else now,
                    updated_at=now,
                )
                written += 1
            return written

    async def get_leaderboard_page(
        self, mode: str, limit: int = 50, offset: int = 0
    ) -> list[ArenaLeaderboardRow]:
        rows = [
            r for (sub, m), r in self._ratings.items()
            if m == mode and r.rated_matches > 0
        ]
        # Same total order as the Postgres index: rating desc, matches desc,
        # then owner_sub so paging cannot repeat or skip a row.
        rows.sort(key=lambda r: (-r.rating, -r.rated_matches, r.owner_sub))
        return [
            ArenaLeaderboardRow(
                owner_sub=r.owner_sub,
                mode=r.mode,
                rating=r.rating,
                rd=r.rd,
                rated_matches=r.rated_matches,
                last_rated_match_at=r.last_rated_match_at,
            )
            for r in rows[offset : offset + limit]
        ]

    async def list_history(
        self, owner_sub: str, mode: Optional[str] = None, limit: int = 50
    ) -> list[ArenaRatingHistoryEntry]:
        rows = [
            e for e in self._history
            if e.owner_sub == owner_sub and (mode is None or e.mode == mode)
        ]
        rows.sort(key=lambda e: e.entry_id or 0, reverse=True)
        return [_clone_entry(e) for e in rows[:limit]]


assert isinstance(MemoryArenaRatingRepository(), ArenaRatingRepository)
