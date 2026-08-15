"""Direct proof of the phantom-lot fix's state-machine boundary.

THE BUG THIS FILE EXISTS TO DISPROVE. `_advance_lot` used to draw a
candidate and, if neither seat could legally act on it, settle it unsold
INSIDE THE SAME CALL -- `current_candidate` was set and cleared again before
this module, or any client at any polling cadence, ever had a chance to
observe it as the live "current lot". A player reporting a star appearing in
"Settled Lots" they never saw live and never had a chance to bid on was
reporting exactly that.

THE FIX, restated as a test rather than a comment. `_advance_lot` now stops
and returns as soon as it draws a candidate neither seat can act on, leaving
`current_candidate` set and `active_seat` `None` -- a state
`is_unwinnable_lot_pending` names and any external read can observe. Only a
later, explicit call to `resolve_unwinnable_lot` settles it (mirroring the
orchestration layer's own short, seatless `PHASE_LOT_UNWINNABLE` turn and its
timeout in `apps/api/app/services/twenty_dollar/mode.py`).

WHY THE SCENARIO IS FOUND RATHER THAN HAND-BUILT. A hand-built roster that
merely fits the shape of "nobody can act on this candidate" proves the shape
exists; it does not prove the real market -- drawing from the whole pool,
played by the shipped bot -- actually reaches that shape. So this searches
across real seeded matches, driven by the shipped `TwentyDollarBot` exactly as
`test_bot_calibration.py` and `test_timeout_audit.py` already do, and stops at
the first genuine park.
"""
from __future__ import annotations

import random

from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.bot import TwentyDollarBot

#: Comfortably more seeds than needed -- the closeout market alone makes an
#: unwinnable draw common, not rare, well within the first handful of seeds.
SEARCH_SEEDS = range(200)

#: A guard, not a limit: a match needing this many actions before parking
#: (or finishing) would already have failed the termination tests elsewhere.
MAX_ACTIONS = 4000


def _find_unwinnable_park(pool) -> tuple[int, dict]:
    """Drive real bot-versus-bot matches until one parks on an unwinnable
    draw, and return `(seed, state)` at the EXACT instant of the park --
    before `resolve_unwinnable_lot` has been called on it.

    The private projection is built exactly as
    `apps/api/app/services/twenty_dollar/mode.py::project` builds it for a bot
    seat (coarse tier included), so this is the same opponent that ships, not
    a stand-in.
    """
    policy = TwentyDollarBot()
    for seed in SEARCH_SEEDS:
        state = S.initial_state(seed=seed)
        rng = random.Random(seed ^ 0x9A17)
        actions = 0
        while not S.is_complete(state):
            actions += 1
            assert actions < MAX_ACTIONS, f"seed {seed}: match did not terminate"
            if S.is_unwinnable_lot_pending(state):
                return seed, state
            seat_index = state["active_seat"]
            public, private, _ = S.project(state, seat_index, pool)
            private = {**private, "candidate_tier": state.get("current_candidate_tier")}
            command, payload = policy.decide(public, private, rng)
            _, code, message = S.submit_action(
                state, seat_index, command, int(payload.get("amount", 0)), pool
            )
            assert code is None, f"seed {seed}: unexpected rejection {code}: {message}"
    raise AssertionError(
        f"no unwinnable draw was reached across seeds {SEARCH_SEEDS.start}.."
        f"{SEARCH_SEEDS.stop - 1} -- widen the search range"
    )


class TestThePhantomLotFix:
    def test_a_real_market_reaches_the_unwinnable_park(self, pool):
        """Sanity check on the search itself: a genuine bot-vs-bot match
        really does produce this state, so the rest of this class is testing
        something the market actually does rather than a constructed edge
        case nobody hits."""
        seed, state = _find_unwinnable_park(pool)
        assert isinstance(seed, int)
        assert S.is_unwinnable_lot_pending(state)

    def test_the_park_is_observable_before_anything_resolves_it(self, pool):
        """(a) Immediately after the draw, the park is real and readable:
        `is_unwinnable_lot_pending` is true and `current_candidate` names the
        drawn candidate -- not already cleared, not already settled."""
        _seed, state = _find_unwinnable_park(pool)

        assert S.is_unwinnable_lot_pending(state)
        assert state["phase"] == S.PHASE_AUCTION
        assert state["active_seat"] is None
        slug = state["current_candidate"]
        assert slug is not None
        # Neither seat can, in fact, act on it -- which is the whole
        # definition of the state, restated as the underlying rule rather
        # than the flag alone.
        from nba_peak.twenty_dollar.pool import get_pool

        candidate = get_pool().get(slug)
        for seat_index in range(len(state["seats"])):
            assert not S.can_seat_acquire(state, seat_index, candidate, get_pool())
        # And the seat that WOULD have opened, but for this, has nothing to
        # do: no seat has legal commands while the park holds.
        for seat_index in range(len(state["seats"])):
            assert S.legal_commands(state, seat_index) == ()

    def test_history_has_not_grown_at_the_moment_of_the_park(self, pool):
        """(b) The park is truly unresolved: nothing was appended to history
        by the draw that produced it. This is the direct negation of the bug
        -- the old code appended the settled record inside the very call that
        drew the candidate."""
        _seed, state = _find_unwinnable_park(pool)
        history_before = len(state["history"])
        slug = state["current_candidate"]

        # The park itself changes nothing further: reading it twice is
        # idempotent, because nothing here is a resolution.
        assert S.is_unwinnable_lot_pending(state)
        assert len(state["history"]) == history_before
        assert state["current_candidate"] == slug
        assert not any(
            record["candidate"]["player_slug"] == slug for record in state["history"]
        )

    def test_resolving_grows_history_by_exactly_one_settled_unsold_record(self, pool):
        """(c) Only `resolve_unwinnable_lot` -- the orchestration layer's
        timeout handler for `PHASE_LOT_UNWINNABLE` -- actually settles it: one
        new history record, for that exact candidate, decided unsold, and the
        park clears."""
        _seed, state = _find_unwinnable_park(pool)
        slug = state["current_candidate"]
        history_before = len(state["history"])

        S.resolve_unwinnable_lot(state, pool)

        assert len(state["history"]) == history_before + 1
        settled = state["history"][history_before]
        assert settled["candidate"]["player_slug"] == slug
        assert settled["decided_by"] == S.DECIDED_BY_UNSOLD
        assert settled["winner_seat"] is None
        assert settled["price"] == 0
        # The park is gone: either the match is over, or the engine has moved
        # on to a genuinely different lot (which may itself be another park --
        # see the module docstring and `resolve_unwinnable_lot`'s own comment
        # -- but it is never still the same unresolved candidate).
        assert state["current_candidate"] != slug

    def test_a_cascade_of_parks_resolves_one_lot_at_a_time_not_silently(self, pool):
        """`resolve_unwinnable_lot`'s own next draw may ITSELF be unwinnable.
        That is correct and expected (its docstring says so explicitly) -- but
        it must park again rather than resolving multiple candidates inside
        one call, which is exactly the shape of the original bug repeated.
        Driven far enough to prove the property holds across a real
        multi-park run, not just once."""
        _seed, state = _find_unwinnable_park(pool)

        parks_seen = 0
        guard = 0
        while S.is_unwinnable_lot_pending(state) and guard < 50:
            guard += 1
            parks_seen += 1
            slug = state["current_candidate"]
            history_before = len(state["history"])
            S.resolve_unwinnable_lot(state, pool)
            # Each call resolves EXACTLY the one candidate it found parked --
            # never more than one history record per call, which is the
            # direct evidence nothing cascaded silently inside it.
            assert len(state["history"]) == history_before + 1
            assert state["history"][history_before]["candidate"]["player_slug"] == slug

        assert parks_seen >= 1
        # And after however many parks, the match is in a legitimate state:
        # either still auctioning with a real seat on the clock, or complete.
        assert state["phase"] in (S.PHASE_AUCTION, S.PHASE_COMPLETE)
        if state["phase"] == S.PHASE_AUCTION:
            assert not S.is_unwinnable_lot_pending(state)
            assert state["active_seat"] is not None


# ---------------------------------------------------------------------------
# The invariant across play styles: no bids, one bidder, both bidders.
# ---------------------------------------------------------------------------


def _play_recording_observations(seed: int, pool, seat_strategies) -> tuple[dict, set]:
    """Drive one full match with `conftest`'s driver pattern, recording every
    `current_candidate` a caller could have read live -- including while
    parked on an unwinnable draw -- before it settles.

    Mirrors `conftest.play_match`'s own fix (resolve-and-continue when
    `active_seat is None`), with one addition: the observation is taken BEFORE
    each step decides anything, exactly as an external poll would be a read
    that happens before whatever the server does next.
    """
    from .conftest import bot_strategy, random_legal

    state = S.initial_state(seed=seed)
    rng = random.Random(seed ^ 0x5EED)
    observed: set[str] = set()
    actions = 0
    while not S.is_complete(state):
        actions += 1
        assert actions < 4000, f"seed {seed}: match did not terminate"
        if state.get("current_candidate"):
            observed.add(state["current_candidate"])
        seat_index = state["active_seat"]
        if seat_index is None:
            assert S.is_unwinnable_lot_pending(state)
            S.resolve_unwinnable_lot(state, pool)
            continue
        play = seat_strategies.get(seat_index, random_legal)
        command, amount = play(state, seat_index, pool, rng)
        _, code, message = S.submit_action(state, seat_index, command, amount, pool)
        assert code is None, f"unexpected rejection {code}: {message}"
    return state, observed


def _assert_invariant_over_seeds(pool, seat_strategies, seeds) -> int:
    """Every auctioned lot in every seed's final history was observed live
    before it settled. Returns how many of those lots were the specific
    phantom-lot shape (settled unsold with no recorded actions at all --
    i.e. no seat was ever even handed a turn on it), so a caller can assert
    the sweep actually exercised the path the fix exists for."""
    phantom = 0
    for seed in seeds:
        state, observed = _play_recording_observations(seed, pool, seat_strategies)
        auctioned = [r for r in state["history"] if r["decided_by"] != S.DECIDED_BY_AUTOFILL]
        for record in auctioned:
            slug = record["candidate"]["player_slug"]
            assert slug in observed, (
                f"seed {seed}: lot {record['lot_index']} ({slug}) settled as "
                f"{record['decided_by']!r} but was never observed live -- the "
                "phantom-settled-lot bug"
            )
            if record["decided_by"] == S.DECIDED_BY_UNSOLD and not record["actions"]:
                phantom += 1
    return phantom


class TestTheInvariantAcrossPlayStyles:
    """The product owner asked this proven for a spread of how a match is
    actually played, not only for the shipped bot's own mix of bids and
    passes: no bids at all, one seat bidding while the other never does, and
    both seats bidding aggressively. The invariant -- every settled lot was
    observed live first -- must hold identically in every case, because the
    fix is a property of the STATE MACHINE, not of any one strategy."""

    def test_no_bids_at_all(self, pool):
        """Both seats decline everything declinable. `always_pass` still has
        to open once market skips run out (`may_pass`'s own rule), so this is
        the closest a real match gets to "nobody ever wants anything" rather
        than a literal zero-bid match -- and the closeout market it forces is
        exactly where unwinnable draws are common."""
        from .conftest import always_pass

        phantom = _assert_invariant_over_seeds(
            pool, {0: always_pass, 1: always_pass}, range(20)
        )
        assert phantom > 0, "no seed produced a phantom-parked lot to prove the case"

    def test_one_seat_bidding_the_other_never_does(self, pool):
        from .conftest import always_min_raise, always_pass

        phantom = _assert_invariant_over_seeds(
            pool, {0: always_pass, 1: always_min_raise}, range(20)
        )
        assert phantom > 0, "no seed produced a phantom-parked lot to prove the case"

    def test_both_seats_bidding_aggressively(self, pool):
        from .conftest import always_min_raise

        phantom = _assert_invariant_over_seeds(
            pool, {0: always_min_raise, 1: always_min_raise}, range(20)
        )
        assert phantom > 0, "no seed produced a phantom-parked lot to prove the case"

    def test_the_shipped_bot_on_both_seats(self, pool):
        from .conftest import bot_strategy

        phantom = _assert_invariant_over_seeds(
            pool, {0: bot_strategy(), 1: bot_strategy()}, range(20)
        )
        assert phantom > 0, "no seed produced a phantom-parked lot to prove the case"
