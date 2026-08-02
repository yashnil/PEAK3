"""In-memory HeadToHeadRepository -- dev/CI when DATABASE_URL is unset.

Enforces the SAME invariants the Postgres schema does, under the same lock, so
a behaviour that only the database has cannot exist:

* one row per (match, role) and one per (match, subject) -- the two together
  are what stop a third player joining and stop the creator accepting their own
  invite;
* first result write wins, first settlement write wins -- two tabs submitting
  simultaneously must not produce two different settled outcomes;
* one rematch per (source match, creator).

Deep-copies on the way in and out for the same reason
`run_the_table_memory.py` does: handing back the stored object would let a
caller mutate persisted state without calling a write method, which works in a
dict and does not work in Postgres.
"""
from __future__ import annotations

import asyncio
import copy
from dataclasses import replace
from datetime import datetime, timezone
from typing import Optional

from app.repositories.head_to_head_protocols import (
    MATCH_STATUS_COMPLETE,
    HeadToHeadMatch,
    HeadToHeadParticipant,
    HeadToHeadRepository,
    ParticipantSlotTaken,
)


def _clone_match(match: HeadToHeadMatch) -> HeadToHeadMatch:
    return replace(
        match,
        fairness=copy.deepcopy(match.fairness),
        settlement=copy.deepcopy(match.settlement),
    )


def _clone_participant(p: HeadToHeadParticipant) -> HeadToHeadParticipant:
    return replace(p, result=copy.deepcopy(p.result))


class MemoryHeadToHeadRepository:
    def __init__(self) -> None:
        self._matches: dict[str, HeadToHeadMatch] = {}
        self._participants: dict[str, list[HeadToHeadParticipant]] = {}
        # sha256(invite_id) -> match_id
        self._invite_index: dict[str, str] = {}
        # (rematch_of, creator_sub) -> match_id
        self._rematch_index: dict[tuple[str, str], str] = {}
        self._lock = asyncio.Lock()

    async def create_match(
        self, match: HeadToHeadMatch, creator: HeadToHeadParticipant
    ) -> HeadToHeadMatch:
        async with self._lock:
            if match.rematch_of:
                key = (match.rematch_of, match.creator_sub)
                existing_id = self._rematch_index.get(key)
                if existing_id is not None:
                    return _clone_match(self._matches[existing_id])
                self._rematch_index[key] = match.match_id
            self._matches[match.match_id] = _clone_match(match)
            self._participants[match.match_id] = [_clone_participant(creator)]
            self._invite_index[match.invite_hash] = match.match_id
            return _clone_match(match)

    async def get_match(self, match_id: str) -> Optional[HeadToHeadMatch]:
        found = self._matches.get(match_id)
        return _clone_match(found) if found is not None else None

    async def find_match_by_invite(self, invite_hash: str) -> Optional[HeadToHeadMatch]:
        match_id = self._invite_index.get(invite_hash)
        return await self.get_match(match_id) if match_id else None

    async def get_participant(
        self, match_id: str, participant_sub: str
    ) -> Optional[HeadToHeadParticipant]:
        for p in self._participants.get(match_id, []):
            if p.participant_sub == participant_sub:
                return _clone_participant(p)
        return None

    async def get_participants(self, match_id: str) -> list[HeadToHeadParticipant]:
        rows = list(self._participants.get(match_id, []))
        rows.sort(key=lambda p: (p.role != "creator", p.joined_at))
        return [_clone_participant(p) for p in rows]

    async def add_participant(
        self, participant: HeadToHeadParticipant
    ) -> HeadToHeadParticipant:
        async with self._lock:
            rows = self._participants.setdefault(participant.match_id, [])
            for existing in rows:
                if existing.participant_sub == participant.participant_sub:
                    raise ParticipantSlotTaken(
                        "This player is already in the match."
                    )
                if existing.role == participant.role:
                    raise ParticipantSlotTaken("This match already has two players.")
            rows.append(_clone_participant(participant))
            return _clone_participant(participant)

    async def set_participant_result(
        self, match_id: str, participant_sub: str, result: dict
    ) -> HeadToHeadParticipant:
        async with self._lock:
            for p in self._participants.get(match_id, []):
                if p.participant_sub != participant_sub:
                    continue
                if p.result is not None:
                    # First write wins. See the protocol docstring.
                    return _clone_participant(p)
                p.result = copy.deepcopy(result)
                p.status = "complete"
                p.submitted_at = datetime.now(timezone.utc)
                return _clone_participant(p)
        raise KeyError(f"No participant {participant_sub!r} in match {match_id!r}")

    async def set_match_status(self, match_id: str, status: str) -> None:
        async with self._lock:
            match = self._matches.get(match_id)
            if match is None or match.status == MATCH_STATUS_COMPLETE:
                # A complete match never regresses to in_progress.
                return
            match.status = status

    async def settle(self, match_id: str, settlement: dict) -> HeadToHeadMatch:
        async with self._lock:
            match = self._matches[match_id]
            if match.settlement is None:
                match.settlement = copy.deepcopy(settlement)
                match.settled_at = datetime.now(timezone.utc)
                match.status = MATCH_STATUS_COMPLETE
            return _clone_match(match)

    async def list_matches_for_sub(
        self, participant_sub: str, limit: int = 20
    ) -> list[HeadToHeadMatch]:
        ids = [
            match_id
            for match_id, rows in self._participants.items()
            if any(p.participant_sub == participant_sub for p in rows)
        ]
        rows = [self._matches[i] for i in ids if i in self._matches]
        rows.sort(key=lambda m: m.created_at, reverse=True)
        return [_clone_match(m) for m in rows[:limit]]

    async def find_rematch(
        self, rematch_of: str, creator_sub: str
    ) -> Optional[HeadToHeadMatch]:
        match_id = self._rematch_index.get((rematch_of, creator_sub))
        return await self.get_match(match_id) if match_id else None


# Structural conformance, asserted at import time exactly as the RUN THE TABLE
# and ranked memory repositories do.
assert isinstance(MemoryHeadToHeadRepository(), HeadToHeadRepository)
