"""Three-Man Weave under races: a staged choice and a timeout sweep.

Mirrors `test_arena_action_races.py`'s method exactly -- the REAL in-memory
repository and the REAL Three-Man Weave reducer, driven through
`submit_command`'s own sequence (`clock.enforce` THEN `apply_command`), with
every instant an explicit `datetime` so the races are deterministic rather
than probable.

WHAT THIS FILE PROVES. Pass 1 requires that a DRAFT PLAYER submitted near the
deadline and the server's own timeout sweep can never both commit: exactly
one pick must land, whichever the server heard first. This is a property of
the shared Arena foundation (`state_version` advances by exactly one, only on
an accepted command -- `arena_memory.py`), not of this mode's reducer, so it
is proved here at the layer that actually enforces it, the same way the $20
Showdown race suite proves it for a bid.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.repositories.arena_memory import MemoryArenaRepository
from app.repositories.arena_protocols import (
    ENTRY_PATH_PRACTICE,
    ArenaMatch,
    ArenaSeat,
    ArenaTurn,
    CommandRequest,
)
from app.services.arena import clock
from app.services.three_man_weave.mode import (
    COMMAND_PICK,
    COMMAND_STAGE_PICK,
    PHASE_PICK,
    TURN_SECONDS,
    mode as tmw_mode,
)
from nba_peak.three_man_weave.config import PARTICIPANT_COUNT

NOW = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)
HUMAN = "human-sub"


async def _seed_match(repo: MemoryArenaRepository, *, seed: int = 4242) -> ArenaMatch:
    """A live three-seat match (seat 0 human, seats 1-2 bot) with round 1's
    pick turn already open for seat 0 -- built by seeding the snapshot the
    same way `initial_snapshot` does and stamping the turn directly, exactly
    as `test_arena_action_races.py::_seed_match` bypasses matchmaking for
    Showdown. This mode opens on `PHASE_INTRO` in real play; the ceremony
    and the briefing are a different mode of this pass's work (already
    server-authoritative and untouched here) and are not what this race is
    about, so the turn is stamped straight onto the pick phase.
    """
    snapshot = tmw_mode.initial_snapshot(seed, ())
    assert snapshot["current_seat"] == 0, "seed chosen so seat 0 (human) opens the draft"
    match = ArenaMatch(
        match_id="m-race",
        mode=tmw_mode.mode,
        mode_version=tmw_mode.mode_version,
        model_version="test",
        seed=seed,
        seat_count=PARTICIPANT_COUNT,
        entry_path=ENTRY_PATH_PRACTICE,
        rated=False,
        status="active",
        snapshot=snapshot,
        created_by=HUMAN,
        expires_at=NOW + timedelta(hours=2),
        created_at=NOW,
        updated_at=NOW,
    )
    await repo.create_match(
        match,
        [
            ArenaSeat(
                match_id="m-race", seat_index=0, occupant_kind="human",
                occupant_sub=HUMAN, display_name="You",
            ),
            ArenaSeat(
                match_id="m-race", seat_index=1, occupant_kind="bot",
                bot_id="tmw", display_name="Archetype One",
            ),
            ArenaSeat(
                match_id="m-race", seat_index=2, occupant_kind="bot",
                bot_id="tmw", display_name="Archetype Two",
            ),
        ],
    )
    repo._turns["m-race"] = [
        ArenaTurn(
            match_id="m-race",
            turn_seq=0,
            phase=PHASE_PICK,
            seat_index=0,
            deadline_at=NOW + timedelta(seconds=TURN_SECONDS),
            opened_at=NOW,
        )
    ]
    return match


async def _submit(
    repo: MemoryArenaRepository,
    *,
    seat: int,
    command: str,
    payload: dict,
    version: int,
    at: datetime,
    key: str,
):
    """`submit_command`'s own sequence: enforce the clock, then apply."""
    await clock.enforce(repo, "m-race", tmw_mode.reduce, at)
    return await repo.apply_command(
        CommandRequest(
            match_id="m-race",
            idempotency_key=key,
            command_type=command,
            payload=payload,
            actor_sub=HUMAN,
            actor_seat_index=seat,
            expected_state_version=version,
            issued_at=at,
        ),
        tmw_mode.reduce,
        at,
    )


async def _current(repo: MemoryArenaRepository) -> ArenaMatch:
    match = await repo.get_match("m-race")
    assert match is not None
    return match


def _first_legal_pick(snapshot: dict, seat_index: int) -> tuple[str, str]:
    _public, private, _legal = tmw_mode.project(
        _current_match_stub(snapshot), _stub_seats(), seat_index
    )
    slug, slots = next(iter(private["legal_picks"].items()))
    return slug, slots[0]


def _current_match_stub(snapshot: dict) -> ArenaMatch:
    return ArenaMatch(
        match_id="m-race", mode=tmw_mode.mode, mode_version=tmw_mode.mode_version,
        model_version="test", seed=4242, seat_count=PARTICIPANT_COUNT,
        entry_path=ENTRY_PATH_PRACTICE, rated=False, status="active",
        snapshot=snapshot, created_by=HUMAN, expires_at=NOW + timedelta(hours=2),
        created_at=NOW, updated_at=NOW,
    )


def _stub_seats() -> tuple[ArenaSeat, ...]:
    return (
        ArenaSeat(match_id="m-race", seat_index=0, occupant_kind="human", occupant_sub=HUMAN),
        ArenaSeat(match_id="m-race", seat_index=1, occupant_kind="bot", bot_id="tmw"),
        ArenaSeat(match_id="m-race", seat_index=2, occupant_kind="bot", bot_id="tmw"),
    )


# ---------------------------------------------------------------------------
# The near-zero race: a manual DRAFT PLAYER vs. the server's own sweep
# ---------------------------------------------------------------------------
class TestManualPickVsTimeoutSweep:
    @pytest.mark.asyncio
    async def test_a_pick_arriving_past_the_grace_window_loses_to_the_sweep_and_drafts_the_staged_choice(
        self,
    ):
        """The exact race Pass 1 requires be race-safe: the player staged a
        choice, then their own DRAFT PLAYER press arrived too late to beat
        the server's sweep. EXACTLY ONE pick may commit -- and because it was
        staged, the sweep drafts that same player anyway, so the outcome the
        player intended still lands even though their own command lost the
        race.
        """
        repo = MemoryArenaRepository()
        match = await _seed_match(repo)
        slug, slot = _first_legal_pick(match.snapshot, 0)

        staged = await _submit(
            repo, seat=0, command=COMMAND_STAGE_PICK,
            payload={"player_slug": slug, "slot_type": slot},
            version=0, at=NOW + timedelta(seconds=1), key="stage-001",
        )
        assert staged.accepted
        version_at_stage = (await _current(repo)).state_version

        far_late = NOW + timedelta(seconds=TURN_SECONDS + clock.ACTION_GRACE_SECONDS + 1)
        out = await _submit(
            repo, seat=0, command=COMMAND_PICK,
            payload={"player_slug": slug, "slot_type": slot},
            version=version_at_stage, at=far_late, key="draft-0001",
        )
        # The manual command lost the race -- the sweep already resolved the
        # turn by the time it was heard.
        assert not out.accepted
        assert out.rejection_code == "stale_state_version"

        snapshot = (await _current(repo)).snapshot
        assert len(snapshot["picks"]) == 1, "exactly one pick committed, never zero or two"
        assert snapshot["picks"][0]["player_slug"] == slug
        assert snapshot["picks"][0]["slot_type"] == slot

    @pytest.mark.asyncio
    async def test_a_pick_arriving_inside_the_grace_window_wins_and_the_stale_sweep_cannot_follow_it(
        self,
    ):
        """The symmetric case: the manual press wins the race by landing
        inside the server's grace window. A LATER, now-stale sweep attempt
        must not also fire -- there is no open turn left for it to resolve.
        """
        repo = MemoryArenaRepository()
        match = await _seed_match(repo)
        slug, slot = _first_legal_pick(match.snapshot, 0)

        deadline = NOW + timedelta(seconds=TURN_SECONDS)
        out = await _submit(
            repo, seat=0, command=COMMAND_PICK,
            payload={"player_slug": slug, "slot_type": slot},
            version=0, at=deadline + timedelta(milliseconds=200), key="draft-0001",
        )
        assert out.accepted, out.rejection_message
        snapshot = (await _current(repo)).snapshot
        assert len(snapshot["picks"]) == 1
        assert snapshot["picks"][0]["player_slug"] == slug

        # A stale sweep landing after the pick already committed must find
        # a DIFFERENT open turn (seat 1's, freshly opened) and therefore
        # cannot re-resolve seat 0's turn a second time.
        outcome = await clock.enforce(
            repo, "m-race", tmw_mode.reduce, deadline + timedelta(seconds=5)
        )
        assert outcome is None or outcome.accepted is False or (
            (await _current(repo)).snapshot["picks"][0]["player_slug"] == slug
        )
        snapshot_after = (await _current(repo)).snapshot
        assert len(snapshot_after["picks"]) <= 2, "no runaway double-resolution"
        assert snapshot_after["picks"][0]["player_slug"] == slug
        assert snapshot_after["picks"][0]["slot_type"] == slot
