"""The action contract under races: an accepted human action may never vanish.

WHAT THIS FILE IS FOR. The reported failure was a `$2` bid on Stephen Curry
being refused with a generic message while the lot settled to the bot for `$1`.
Reproducing it required no concurrency at all -- only a request that arrived a
fraction of a second after its deadline, because `submit_command` enforces the
clock BEFORE applying a command, and the enforcement had a zero-width window.

That ordering is correct and is kept: a genuinely late action must lose to the
timeout rather than beat it by being the request that triggered the sweep. What
was wrong was the width. `clock.ACTION_GRACE_SECONDS` now covers the two delays
between a player deciding and the server hearing about it -- the age of the poll
their countdown was seeded from, and the request's own flight time.

Every test below drives the REAL in-memory repository and the REAL Showdown
reducer through `submit_command`'s own sequence. Nothing is mocked, no sleeps
are used, and every instant is an explicit `datetime` so the races are
deterministic rather than probable.
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
from app.services.twenty_dollar.mode import mode as td_mode
from nba_peak.twenty_dollar import state as rules
from nba_peak.twenty_dollar.config import TURN_SECONDS

NOW = datetime(2026, 8, 5, 12, 0, 0, tzinfo=timezone.utc)
HUMAN = "human-sub"


async def _seed_match(repo: MemoryArenaRepository, *, bot_opens: bool) -> tuple[ArenaMatch, dict]:
    """A live two-seat match with seat 0 human, seat 1 bot, turn 0 open.

    `bot_opens` picks a seed whose opening seat is the bot, which is the shape
    of the reported failure: the bot opens at `$1` and the human is the raiser.
    """
    wanted = 1 if bot_opens else 0
    seed = next(s for s in range(1, 2000) if rules.opening_seat_for(s) == wanted)
    snapshot = td_mode.initial_snapshot(seed, ())
    match = ArenaMatch(
        match_id="m-race",
        mode=td_mode.mode,
        mode_version=td_mode.mode_version,
        model_version="test",
        seed=seed,
        seat_count=2,
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
                bot_id="td", display_name="Floor General",
            ),
        ],
    )
    repo._turns["m-race"] = [
        ArenaTurn(
            match_id="m-race",
            turn_seq=0,
            phase=rules.PHASE_AUCTION,
            seat_index=snapshot["active_seat"],
            deadline_at=NOW + timedelta(seconds=TURN_SECONDS),
            opened_at=NOW,
        )
    ]
    return match, snapshot


async def _submit(
    repo: MemoryArenaRepository,
    *,
    seat: int,
    command: str,
    amount: int,
    version: int,
    at: datetime,
    key: str,
    sub: str | None = HUMAN,
):
    """`submit_command`'s own sequence: enforce the clock, then apply.

    Deliberately reproduced here rather than calling the route, so the test
    exercises the ORDERING that caused the defect without needing auth, a
    profile repository or a rating repository in the way.
    """
    await clock.enforce(repo, "m-race", td_mode.reduce, at)
    return await repo.apply_command(
        CommandRequest(
            match_id="m-race",
            idempotency_key=key,
            command_type=command,
            payload={"amount": amount} if command == "bid" else {},
            actor_sub=sub,
            actor_seat_index=seat,
            expected_state_version=version,
            issued_at=at,
        ),
        td_mode.reduce,
        at,
    )


async def _current(repo: MemoryArenaRepository) -> ArenaMatch:
    match = await repo.get_match("m-race")
    assert match is not None
    return match


# ---------------------------------------------------------------------------
# The reported failure
# ---------------------------------------------------------------------------


class TestTheCurryBid:
    """PART 14. A `$2` raise arriving just past the deadline must survive."""

    @pytest.mark.asyncio
    async def test_a_bid_500ms_before_the_deadline_is_accepted(self):
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=True)
        deadline = NOW + timedelta(seconds=TURN_SECONDS)

        # The bot opens at $1.
        await _submit(
            repo, seat=1, command="bid", amount=1, version=0,
            at=NOW + timedelta(seconds=1.2), key="bot-open-0001", sub=None,
        )
        turn = await repo.get_open_turn("m-race")
        assert turn is not None and turn.seat_index == 0
        deadline = turn.deadline_at

        out = await _submit(
            repo, seat=0, command="bid", amount=2,
            version=(await _current(repo)).state_version,
            at=deadline - timedelta(milliseconds=500), key="human-bid-0001",
        )
        assert out.accepted, out.rejection_message
        assert (await _current(repo)).snapshot["current_bid"] == 2

    @pytest.mark.asyncio
    @pytest.mark.parametrize("late_ms", [0, 50, 120, 900, 1900])
    async def test_a_bid_inside_the_grace_window_survives(self, late_ms):
        """THE EXACT REPRODUCED FAILURE, parameterised over how late it was.

        120 ms was the delay in the scripted reproduction that destroyed the
        real `$2` bid. Every value here used to be swept.
        """
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=True)
        await _submit(
            repo, seat=1, command="bid", amount=1, version=0,
            at=NOW + timedelta(seconds=1.2), key="bot-open-0001", sub=None,
        )
        turn = await repo.get_open_turn("m-race")
        assert turn is not None
        deadline = turn.deadline_at
        version = (await _current(repo)).state_version

        out = await _submit(
            repo, seat=0, command="bid", amount=2, version=version,
            at=deadline + timedelta(milliseconds=late_ms), key="human-bid-0001",
        )
        assert out.accepted, (
            f"a bid {late_ms} ms past the deadline was destroyed; "
            f"code={out.rejection_code} message={out.rejection_message!r}"
        )
        snapshot = (await _current(repo)).snapshot
        assert snapshot["current_bid"] == 2
        assert snapshot["high_bidder"] == 0
        # And the lot did NOT settle to the bot at $1.
        assert snapshot["history"] == []

    @pytest.mark.asyncio
    async def test_a_bid_past_the_grace_window_still_loses_to_the_timeout(self):
        """The grace is a window, not an amnesty.

        An abandoned turn must still resolve, or the opponent waits forever for
        a player who is not there.
        """
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=True)
        await _submit(
            repo, seat=1, command="bid", amount=1, version=0,
            at=NOW + timedelta(seconds=1.2), key="bot-open-0001", sub=None,
        )
        turn = await repo.get_open_turn("m-race")
        assert turn is not None
        version = (await _current(repo)).state_version
        far_late = turn.deadline_at + timedelta(
            seconds=clock.ACTION_GRACE_SECONDS + 1
        )

        out = await _submit(
            repo, seat=0, command="bid", amount=2, version=version,
            at=far_late, key="human-bid-0001",
        )
        assert not out.accepted
        assert out.rejection_code == "stale_state_version"
        # The lot resolved to the standing bidder, which is the correct outcome
        # for an abandoned turn -- and the client now EXPLAINS it rather than
        # showing "That move was not accepted".
        history = (await _current(repo)).snapshot["history"]
        assert len(history) == 1
        assert history[0]["winner_seat"] == 1
        assert history[0]["price"] == 1

    @pytest.mark.asyncio
    async def test_the_visible_clock_does_not_include_the_grace(self):
        """A player must never be shown a number that includes the allowance.

        `seconds_remaining` is measured to `deadline_at`; the grace lives only
        in `is_overdue_at`.
        """
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=False)
        turn = await repo.get_open_turn("m-race")
        assert turn is not None
        at_deadline = turn.deadline_at
        assert not turn.is_overdue_at(at_deadline - timedelta(milliseconds=1))
        # WITH the grace -- the enforcement path.
        assert not turn.is_overdue_at(
            at_deadline + timedelta(seconds=clock.ACTION_GRACE_SECONDS - 0.1),
            clock.ACTION_GRACE_SECONDS,
        )
        assert turn.is_overdue_at(
            at_deadline + timedelta(seconds=clock.ACTION_GRACE_SECONDS + 0.1),
            clock.ACTION_GRACE_SECONDS,
        )
        # WITHOUT it -- the default, and what every display path uses -- the
        # boundary is the deadline itself. A player is never shown a number
        # that includes the allowance.
        assert turn.is_overdue_at(at_deadline + timedelta(milliseconds=1))


# ---------------------------------------------------------------------------
# Duplicates, stale versions and out-of-order arrivals
# ---------------------------------------------------------------------------


class TestIdempotencyAndVersions:
    @pytest.mark.asyncio
    async def test_a_duplicate_click_is_a_replay_and_bids_once(self):
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=False)
        version = (await _current(repo)).state_version

        first = await _submit(
            repo, seat=0, command="bid", amount=3, version=version,
            at=NOW + timedelta(seconds=1), key="human-bid-0001",
        )
        second = await _submit(
            repo, seat=0, command="bid", amount=3, version=version,
            at=NOW + timedelta(seconds=1.1), key="human-bid-0001",
        )
        assert first.accepted and not first.replayed
        assert second.accepted and second.replayed
        # ONE bid, not two: the state version advanced exactly once.
        assert (await _current(repo)).state_version == version + 1
        assert (await _current(repo)).snapshot["current_bid"] == 3

    @pytest.mark.asyncio
    async def test_a_bid_against_a_stale_version_is_refused_with_a_precise_code(self):
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=False)
        stale = (await _current(repo)).state_version

        await _submit(
            repo, seat=0, command="bid", amount=2, version=stale,
            at=NOW + timedelta(seconds=1), key="human-bid-0001",
        )
        out = await _submit(
            repo, seat=0, command="bid", amount=5, version=stale,
            at=NOW + timedelta(seconds=2), key="human-bid-0002",
        )
        assert not out.accepted
        assert out.rejection_code == "stale_state_version"
        assert out.rejection_message

    @pytest.mark.asyncio
    async def test_state_versions_are_monotonic_across_a_whole_lot(self):
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=False)
        seen = [(await _current(repo)).state_version]
        for index, (seat, amount) in enumerate([(0, 1), (1, 2), (0, 3), (1, 4)]):
            out = await _submit(
                repo, seat=seat, command="bid", amount=amount,
                version=(await _current(repo)).state_version,
                at=NOW + timedelta(seconds=index + 1),
                key=f"step-{index:04d}",
                sub=HUMAN if seat == 0 else None,
            )
            if not out.accepted:
                break
            seen.append((await _current(repo)).state_version)
        assert seen == sorted(seen)
        assert len(set(seen)) == len(seen)

    @pytest.mark.asyncio
    async def test_a_rejected_command_does_not_advance_the_version(self):
        """One client's bad bid must not invalidate the other's cached view."""
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=False)
        before = (await _current(repo)).state_version
        out = await _submit(
            repo, seat=0, command="bid", amount=0, version=before,
            at=NOW + timedelta(seconds=1), key="human-bad-0001",
        )
        assert not out.accepted
        assert out.rejection_code == rules.REJECT_BID_TOO_LOW
        assert (await _current(repo)).state_version == before


# ---------------------------------------------------------------------------
# Human versus bot
# ---------------------------------------------------------------------------


class TestBotHumanRace:
    @pytest.mark.asyncio
    async def test_the_bot_cannot_act_from_the_state_the_human_just_changed(self):
        """A bot command carries `expected_state_version` like any other.

        If the human's raise lands first, the bot's command built against the
        previous version is refused rather than applied on top -- which is the
        structural reason "the bot received Curry for $1 after an accepted human
        $2 bid" is impossible rather than merely unlikely.
        """
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=False)
        version = (await _current(repo)).state_version

        # The human opens; the bot had already read `version`.
        human = await _submit(
            repo, seat=0, command="bid", amount=2, version=version,
            at=NOW + timedelta(seconds=1), key="human-bid-0001",
        )
        assert human.accepted

        stale_bot = await _submit(
            repo, seat=1, command="bid", amount=1, version=version,
            at=NOW + timedelta(seconds=1.05), key="bot-stale-0001", sub=None,
        )
        assert not stale_bot.accepted
        assert stale_bot.rejection_code == "stale_state_version"
        assert (await _current(repo)).snapshot["current_bid"] == 2
        assert (await _current(repo)).snapshot["high_bidder"] == 0

    @pytest.mark.asyncio
    async def test_a_timeout_cannot_resolve_a_turn_a_play_already_closed(self):
        """`guard_timeout` refuses a sweep for a turn that is no longer open.

        Without it, a timeout that lost the race would still be a well-formed
        command and would forfeit the turn the player had just legitimately
        played -- the single worst bug this subsystem could have.
        """
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=False)
        first_turn = await repo.get_open_turn("m-race")
        assert first_turn is not None

        await _submit(
            repo, seat=0, command="bid", amount=2,
            version=(await _current(repo)).state_version,
            at=NOW + timedelta(seconds=1), key="human-bid-0001",
        )
        snapshot_before = dict((await _current(repo)).snapshot)

        # A sweep for the ALREADY RESOLVED turn 0 arrives late.
        late = await repo.apply_command(
            CommandRequest(
                match_id="m-race",
                idempotency_key=clock.timeout_idempotency_key("m-race", first_turn.turn_seq),
                command_type="__timeout__",
                payload={"turn_seq": first_turn.turn_seq},
                actor_sub=None,
                actor_seat_index=first_turn.seat_index,
                expected_state_version=None,
                issued_at=NOW + timedelta(seconds=60),
            ),
            clock.guard_timeout(td_mode.reduce, first_turn.turn_seq),
            NOW + timedelta(seconds=60),
        )
        assert not late.accepted
        assert late.rejection_code == clock.REJECT_TURN_ALREADY_RESOLVED
        assert (await _current(repo)).snapshot["current_bid"] == snapshot_before["current_bid"]

    @pytest.mark.asyncio
    async def test_two_concurrent_sweeps_resolve_a_turn_once(self):
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=False)
        turn = await repo.get_open_turn("m-race")
        assert turn is not None
        far_late = turn.deadline_at + timedelta(
            seconds=clock.ACTION_GRACE_SECONDS + 5
        )
        first = await clock.enforce(repo, "m-race", td_mode.reduce, far_late)
        version_after_first = (await _current(repo)).state_version
        second = await clock.enforce(repo, "m-race", td_mode.reduce, far_late)
        assert first is not None and first.accepted and not first.replayed
        # The second sweep is a REPLAY at the storage layer (deterministic key),
        # or a no-op because the turn it would target is different.
        assert second is None or second.replayed or not second.accepted
        assert (await _current(repo)).state_version == version_after_first


# ---------------------------------------------------------------------------
# Timeout consequences (PART 16)
# ---------------------------------------------------------------------------


class TestTimeoutConsequences:
    @pytest.mark.asyncio
    async def test_an_expired_clock_with_nothing_bid_spends_a_skip(self):
        repo = MemoryArenaRepository()
        _match, snapshot = await _seed_match(repo, bot_opens=False)
        opener = snapshot["active_seat"]
        before = rules.market_skips(snapshot, opener)
        turn = await repo.get_open_turn("m-race")
        assert turn is not None

        await clock.enforce(
            repo, "m-race", td_mode.reduce,
            turn.deadline_at + timedelta(seconds=clock.ACTION_GRACE_SECONDS + 1),
        )
        after = (await _current(repo)).snapshot
        # Either the skip was charged on this seat, or the candidate did not fit
        # it -- both are defined outcomes, and the action records which.
        action = after["lot_actions"][0] if after["lot_actions"] else after["history"][0]["actions"][0]
        assert action["timed_out"] is True
        if action.get("consumed_skip"):
            assert rules.market_skips(after, opener) == before - 1
        else:
            assert rules.market_skips(after, opener) == before

    @pytest.mark.asyncio
    async def test_an_expired_clock_during_a_live_auction_costs_no_skip(self):
        repo = MemoryArenaRepository()
        await _seed_match(repo, bot_opens=True)
        await _submit(
            repo, seat=1, command="bid", amount=1, version=0,
            at=NOW + timedelta(seconds=1.2), key="bot-open-0001", sub=None,
        )
        snapshot = (await _current(repo)).snapshot
        responder = snapshot["active_seat"]
        before = rules.market_skips(snapshot, responder)
        turn = await repo.get_open_turn("m-race")
        assert turn is not None

        await clock.enforce(
            repo, "m-race", td_mode.reduce,
            turn.deadline_at + timedelta(seconds=clock.ACTION_GRACE_SECONDS + 1),
        )
        after = (await _current(repo)).snapshot
        assert rules.market_skips(after, responder) == before
        assert after["history"][0]["winner_seat"] == 1
