"""Persistence interface for asynchronous head-to-head RUN THE TABLE matches.

WHY THIS IS A NEW DOMAIN RATHER THAN A REUSE OF `challenge_participants`
------------------------------------------------------------------------
The pass plan (§4.4) suggested building on the already-migrated
`challenges` / `challenge_participants` / `challenge_settlements` trio, which
has RLS, a not-self trigger and zero application references. That was
evaluated against the real DDL
(`supabase/migrations/20260630124800_challenges.sql`) and rejected for four
concrete reasons, recorded here because the next person will ask:

1. `challenges` is Peak Duel-shaped. `board_id`, `mode`, `board_type` and
   `duration_years` are all NOT NULL and none of them has any RUN THE TABLE
   meaning. Filling them to satisfy the schema would be inventing data, which
   CLAUDE.md forbids outright.

2. `challenges.challenger_snapshot` is NOT NULL and documented as "immutable at
   creation". A head-to-head is created *before* the creator has finished --
   that is the entire point of an asynchronous invite -- so at creation there
   is no result to pin, and pinning one later would contradict the column's
   stated contract.

3. `challenges_public_meta` is `FOR SELECT USING (true)`
   (`20260630124900_rls.sql:76-79`). The whole row, `challenger_snapshot`
   included, is world-readable through PostgREST with the anon key that ships
   in the browser bundle. Storing a spoiler-safe feature's data in a table
   whose published policy is "everything here is public" would build the
   spoiler leak in at the storage layer, where no amount of application care
   could close it.

4. `challenge_participants` carries no status, no result, no submission time
   and no completion ordering, so a head-to-head would need all of them added
   -- an ALTER on a table two other modes may still adopt, to hold columns that
   only mean something for this one.

What IS reused from that migration is its reasoning: the participant-scoped
row, the not-self rule, and the one-settlement-per-pairing uniqueness. See
`supabase/migrations/20260801160000_head_to_head.sql`.

WHAT IS STORED, AND WHAT DELIBERATELY IS NOT
--------------------------------------------
Stored on the match: the invite's HASH (never the invite itself), the creator,
the seed, the three version strings, the pinned `fairness` digest, an
expiration, and -- once both sides have submitted -- the settlement.

NOT stored: the blueprint, and neither player's run state. Both are already
owned by `run_the_table_runs`, and the blueprint is a pure function of the seed
(`nba_peak/run_the_table/generation.py`), so a second copy here could only ever
drift from the first. A participant row holds a `run_id` and the metrics
extracted from that run's receipt at submission time -- the run itself stays
where it lives.

THE INVITE HASH IS THE LOOKUP KEY, NOT THE MATCH ID. `find_match_by_invite`
takes `sha256(invite_id)`. The match's own UUID never appears in a token, so
possessing an invite link does not hand anyone a mutable resource id -- which
is exactly the property spec §6 asks for ("the invite must not expose mutable
resource IDs") and the one the four P0 IDORs closed this pass came from
missing.

BOTH PARTICIPANTS ARE AUTHENTICATED. Unlike `run_the_table_runs`, whose owners
are usually anon-cookie subjects, `participant_sub` here is always a Supabase
`auth.uid()`: spec §6 says "an authenticated user creates", and a head-to-head
that one side could win by clearing their cookies is not a head-to-head. That
is why the RLS policies on these tables are the primary access control rather
than the second layer.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, runtime_checkable

# Match lifecycle. `open` means one participant; `in_progress` means two;
# `complete` means both have submitted and the settlement is written.
MATCH_STATUS_OPEN = "open"
MATCH_STATUS_IN_PROGRESS = "in_progress"
MATCH_STATUS_COMPLETE = "complete"

PARTICIPANT_ROLE_CREATOR = "creator"
PARTICIPANT_ROLE_OPPONENT = "opponent"

PARTICIPANT_STATUS_IN_PROGRESS = "in_progress"
PARTICIPANT_STATUS_COMPLETE = "complete"


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ParticipantSlotTaken(Exception):
    """A third player tried to join, or a player tried to join twice.

    Raised by the repository rather than checked-then-inserted by the caller,
    because "is there a free slot?" followed by "insert" is a race that two
    tabs can both win. The uniqueness lives in the storage layer in both
    implementations (`UNIQUE (match_id, role)` in Postgres, a lock in memory).
    """


@dataclass
class HeadToHeadMatch:
    """One asynchronous two-player RUN THE TABLE match."""

    match_id: str
    # sha256(invite_id). The invite itself is never stored -- a database read
    # must not yield a working invite link.
    invite_hash: str
    creator_sub: str
    seed: int
    # Provenance of the run the match was minted from ("standard" | "daily" |
    # "challenge") and, for a daily, its date. Neither affects generation
    # (`generate_blueprint` ignores both), so neither can make the two sides'
    # boards differ; they are carried so the receipt can say where the board
    # came from.
    source_run_type: str
    source_run_date: Optional[str]
    engine_version: str
    ruleset_version: str
    card_pool_version: str
    # The pinned fairness contract -- see services/head_to_head.fairness_digest.
    fairness: dict
    status: str
    expires_at: datetime
    settlement: Optional[dict] = None
    settled_at: Optional[datetime] = None
    # The match this one is a rematch of, if any.
    rematch_of: Optional[str] = None
    created_at: datetime = field(default_factory=_now)


@dataclass
class HeadToHeadParticipant:
    """One side of a match.

    `run_id` is written once, at join time, and never accepted from a client.
    Every play and every submission resolves through it, which is the
    `ranked.py:196-203` contract: the server decides which run a participant is
    allowed to act on.
    """

    match_id: str
    participant_sub: str
    role: str
    run_id: str
    status: str
    # `services.head_to_head.ComparisonMetrics.to_dict()` at submission time,
    # or None while the run is unfinished. Server-computed from the run's own
    # receipt; a client never supplies a single number here.
    result: Optional[dict] = None
    submitted_at: Optional[datetime] = None
    joined_at: datetime = field(default_factory=_now)


@runtime_checkable
class HeadToHeadRepository(Protocol):
    async def create_match(
        self, match: HeadToHeadMatch, creator: HeadToHeadParticipant
    ) -> HeadToHeadMatch:
        """Insert a match and its creator participant atomically.

        One call, not two, because a match with no participants is a row no
        route can ever reach: `_participant_or_403` would reject its own
        creator.
        """
        ...

    async def get_match(self, match_id: str) -> Optional[HeadToHeadMatch]:
        """One match by id, regardless of who is asking.

        Authorization is the caller's job, exactly as
        `RunTheTableRunRepository.get_run` documents, so a route can answer 404
        and 403 separately.
        """
        ...

    async def find_match_by_invite(self, invite_hash: str) -> Optional[HeadToHeadMatch]:
        """The match an invite hash resolves to, or None."""
        ...

    async def get_participant(
        self, match_id: str, participant_sub: str
    ) -> Optional[HeadToHeadParticipant]:
        """This caller's side of the match, or None if they are not in it."""
        ...

    async def get_participants(self, match_id: str) -> list[HeadToHeadParticipant]:
        """Both sides, creator first."""
        ...

    async def add_participant(
        self, participant: HeadToHeadParticipant
    ) -> HeadToHeadParticipant:
        """Seat the second player.

        Raises ParticipantSlotTaken if the role is filled or this subject is
        already seated.
        """
        ...

    async def set_participant_result(
        self, match_id: str, participant_sub: str, result: dict
    ) -> HeadToHeadParticipant:
        """Record one side's final metrics. First write wins.

        Idempotent by construction: a participant that already has a result
        keeps it, and the stored row is returned unchanged. A second submission
        from a second tab must not be able to overwrite a settled result with a
        different one.
        """
        ...

    async def set_match_status(self, match_id: str, status: str) -> None: ...

    async def settle(self, match_id: str, settlement: dict) -> HeadToHeadMatch:
        """Write the settlement and mark the match complete. First write wins."""
        ...

    async def list_matches_for_sub(
        self, participant_sub: str, limit: int = 20
    ) -> list[HeadToHeadMatch]:
        """Every match this subject is in, newest first."""
        ...

    async def find_rematch(
        self, rematch_of: str, creator_sub: str
    ) -> Optional[HeadToHeadMatch]:
        """This caller's existing rematch of that match, if they made one.

        The idempotency half of `POST /rematch`: a double-click must return the
        rematch already created rather than mint a second one.
        """
        ...
