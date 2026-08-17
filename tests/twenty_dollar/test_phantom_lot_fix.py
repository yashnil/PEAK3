"""Direct proof of the phantom-lot fix's state-machine boundary.

THE BUG THIS FILE ORIGINALLY EXISTED TO DISPROVE. `_advance_lot` used to draw
a candidate and, if neither seat could legally act on it, settle it unsold
INSIDE THE SAME CALL -- `current_candidate` was set and cleared again before
this module, or any client at any polling cadence, ever had a chance to
observe it as the live "current lot". A player reporting a star appearing in
"Settled Lots" they never saw live and never had a chance to bid on was
reporting exactly that.

THE FIX, restated as a test rather than a comment. `_advance_lot` stops and
returns as soon as it draws a candidate neither seat can act on, leaving
`current_candidate` set and `active_seat` `None` -- a state
`is_unwinnable_lot_pending` names and any external read can observe. Only a
later, explicit call to `resolve_unwinnable_lot` settles it (mirroring the
orchestration layer's own short, seatless `PHASE_LOT_UNWINNABLE` turn and its
timeout in `apps/api/app/services/twenty_dollar/mode.py`).

A SECOND, LATER PASS MADE THE PRECONDITION ITSELF UNREACHABLE, AND THAT IS WHY
THIS FILE NO LONGER SEARCHES FOR ONE. The reported failure was not this
module's original bug -- the park was always observable correctly, exactly as
these tests already proved -- it was that the DRAW ITSELF kept producing the
park in the first place: a market down to one seat with one open slot rolled
repeatedly-unusable players lot after lot, each one auto-passed by both sides
in a fraction of a second before the next equally unusable roll appeared. From
outside, that reads as the game malfunctioning, not as a market. The fix is
`state._eligible_candidates`: the standard AND closeout markets now draw only
from candidates at least one still-incomplete seat could legally win, so a
draw neither seat can act on cannot happen through ordinary play any more --
`test_a_real_market_never_parks_on_an_unwinnable_draw` below proves that
directly, across a wide seed sweep and several play styles.

`resolve_unwinnable_lot` and `is_unwinnable_lot_pending` remain real,
unremoved code -- `PHASE_LOT_UNWINNABLE` still exists in the orchestration
layer as the seatless-turn beat for this exact shape, precisely because
"cannot happen" is a claim about the ordinary draw, not a proof that binds
every future code path into it (`_advance_lot`'s own docstring makes the same
argument about `HARD_MAX_LOTS`). So the state-machine tests below still
exercise the real functions under test; they simply construct the precondition
directly -- a real mid-match state with a real pool candidate substituted onto
the live lot -- rather than searching for a natural occurrence that this same
pass made deliberately rare-to-impossible.
"""
from __future__ import annotations

import random
from typing import Optional

from nba_peak.twenty_dollar import feasibility
from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.bot import TwentyDollarBot
from nba_peak.twenty_dollar.config import ROSTER_SIZE

from .conftest import always_min_raise, always_pass, bot_strategy, random_legal

#: Comfortably more seeds than needed to prove the market NEVER parks now --
#: see `test_a_real_market_never_parks_on_an_unwinnable_draw`.
SEARCH_SEEDS = range(200)

#: A guard, not a limit: a match needing this many actions before parking
#: (or finishing) would already have failed the termination tests elsewhere.
MAX_ACTIONS = 4000


def _build_parked_state(pool, seed: int) -> tuple[dict, str]:
    """A REAL match state, walked forward with real bids until one seat's
    roster is full, then hand-parked: the live lot is swapped for a real pool
    candidate that fits none of the other seat's remaining open slots, and
    `active_seat`/`passed` are set to the shape `_advance_lot` used to leave
    behind on its own.

    WHY HAND-BUILT RATHER THAN FOUND, NOW. Before this pass's eligibility
    filter, this exact shape was common enough that a bot-versus-bot search
    hit it within the first few seeds. After it, the shape is what
    `_eligible_candidates` exists to prevent `_advance_lot` from ever
    producing -- so it is built directly, the same way a roster is hand-built
    to test a rule that a real draft would take dozens of picks to reach
    incidentally. `resolve_unwinnable_lot` does not care how its precondition
    arose; it only has to settle it correctly once it has.
    """
    # RETRIED ACROSS A FEW DETERMINISTIC SEED OFFSETS, NOT JUST THE ONE
    # PASSED IN. Intersection-drawn lots (PEAK3 Pass 1) converge a leading
    # roster faster than the old union draw did, so `always_min_raise`
    # (deliberately the most one-sided policy this file uses, chosen to reach
    # "one roster full" in as few actions as possible) can now leave the
    # OTHER seat with only zero or one players at that exact moment far more
    # often than before -- and a roster that sparse is so flexible that the
    # 500-player qualified pool sometimes contains no candidate that is BOTH
    # outside its naive open slots AND provably unacquirable once multi-
    # position reassignment is considered. That is a property of this one
    # aggressive test-only policy meeting a real, wide-open roster, not a
    # defect in `can_seat_acquire` or in the eligibility rule -- retrying a
    # few seeds away finds one where the split left enough commitment behind
    # to make a genuine outsider constructible, without weakening what the
    # outsider is actually proven against.
    last_error: Optional[AssertionError] = None
    for attempt in range(6):
        attempt_seed = seed + attempt * 100_000
        try:
            return _try_build_parked_state(pool, attempt_seed)
        except AssertionError as exc:
            last_error = exc
    assert last_error is not None
    raise last_error


#: THE MINIMUM COMMITMENT THE STILL-OPEN SEAT MUST HOLD before this helper
#: treats "one seat full" as the moment to stop and hand-park. `>= 1` alone
#: is not enough: intersection-drawn lots (PEAK3 Pass 1) can converge the
#: leading seat so fast against `always_min_raise` that the open seat is
#: still sitting on a COMPLETELY EMPTY roster the instant the other fills --
#: and no outsider is constructible against an empty roster at all, by
#: definition (every real qualified player fits at least one of five open
#: slots). Two players still leaves the open seat visibly incomplete while
#: giving `_try_build_parked_state` a roster with real position commitments
#: to search an outsider against.
_MIN_OPEN_SEAT_COMMITMENT = 2


def _try_build_parked_state(pool, seed: int) -> tuple[dict, str]:
    state = S.initial_state(seed=seed)
    rng = random.Random(seed ^ 0xF17)
    play = always_min_raise
    guard = 0

    def _ready() -> bool:
        sizes = sorted(len(seat["roster"]) for seat in state["seats"])
        return sizes[-1] >= ROSTER_SIZE and _MIN_OPEN_SEAT_COMMITMENT <= sizes[0] < ROSTER_SIZE

    while not _ready():
        guard += 1
        assert guard < MAX_ACTIONS, f"seed {seed}: no roster filled before the guard tripped"
        if S.is_complete(state):
            raise AssertionError(f"seed {seed}: match completed before any roster filled solo")
        seat_index = state["active_seat"]
        if seat_index is None:
            # A forced-fill park (PEAK3 Pass 1) shares this file's own
            # `current_candidate is not None, active_seat is None` shape --
            # resolving it via `resolve_unwinnable_lot` would settle it
            # `unsold`, DISCARDING the intended assignment rather than
            # awarding it, so it must be routed to its own resolver.
            if S.is_forced_fill_pending(state):
                S.resolve_forced_fill(state, pool)
            else:
                S.resolve_unwinnable_lot(state, pool)
            continue
        command, amount = play(state, seat_index, pool, rng)
        _, code, message = S.submit_action(state, seat_index, command, amount, pool)
        assert code is None, f"seed {seed}: unexpected rejection {code}: {message}"

    full_index = next(
        i for i, seat in enumerate(state["seats"]) if len(seat["roster"]) >= ROSTER_SIZE
    )
    open_index = 1 - full_index
    open_seat = state["seats"][open_index]
    owned = [
        (entry["player_slug"], pool.get(entry["player_slug"]).positions)
        for entry in open_seat["roster"]
    ]
    open_slots = set(feasibility.open_slots_for(owned))
    assert open_slots, f"seed {seed}: the still-incomplete seat has no legal open slot"
    # A COMPLETELY EMPTY ROSTER CANNOT CONSTRUCT AN OUTSIDER, EVER: every real
    # qualified player has at least one of the five canonical positions, so
    # with all five slots open there is no candidate outside them by
    # definition -- not a search that needs a wider retry, a structurally
    # impossible one. Signalled as a failed attempt so the caller retries a
    # different seed offset instead of asserting on an unsatisfiable search.
    assert len(open_slots) < ROSTER_SIZE, (
        f"seed {seed}: the still-incomplete seat owns nothing yet -- no outsider is "
        "constructible against a fully open roster"
    )

    gone = {
        entry["player_slug"] for seat in state["seats"] for entry in seat["roster"]
    } | set(state["offered"])
    # THE AUTHORITATIVE CHECK, NOT THE `open_slots_for(owned)` HEURISTIC. A
    # candidate whose positions miss the CURRENT naive assignment's open
    # slots can still be legally acquirable if adding them unlocks a BETTER
    # joint assignment -- a multi-position player already on the roster can
    # be reassigned to make room, exactly the "Brian Grant / Mike Bantom"
    # rearrangement `state.project`'s own docstring describes. That is a real
    # roster with only one or two flexible players still on it, which this
    # helper's setup can now reach (a forced-fill park can settle a roster's
    # OWN needs at any point, not just after the market has broadened it with
    # several players) -- so the outsider must be proven unacquirable by
    # `can_seat_acquire` itself, the same function the product rule actually
    # uses, not by a proxy that predates that case being reachable here.
    outsider = next(
        (
            c
            for c in pool.qualified
            if c.player_slug not in gone
            and not (set(c.positions) & open_slots)
            and not S.can_seat_acquire(state, open_index, c, pool)
        ),
        None,
    )
    assert outsider is not None, (
        f"seed {seed}: no qualified candidate is both outside {open_slots} and "
        "unacquirable by can_seat_acquire"
    )

    state["current_candidate"] = outsider.player_slug
    state["current_candidate_tier"] = "1-100"
    state["offered"].append(outsider.player_slug)
    state["active_seat"] = None
    state["current_bid"] = 0
    state["high_bidder"] = None
    state["lot_bids"] = [0] * len(state["seats"])
    state["lot_actions"] = []
    state["passed"] = [True] * len(state["seats"])
    return state, outsider.player_slug


class TestThePhantomLotFix:
    def test_the_park_is_observable_before_anything_resolves_it(self, pool):
        """(a) Immediately after the draw, the park is real and readable:
        `is_unwinnable_lot_pending` is true and `current_candidate` names the
        drawn candidate -- not already cleared, not already settled."""
        state, slug = _build_parked_state(pool, seed=0)

        assert S.is_unwinnable_lot_pending(state)
        assert state["phase"] == S.PHASE_AUCTION
        assert state["active_seat"] is None
        assert state["current_candidate"] == slug
        # Neither seat can, in fact, act on it -- which is the whole
        # definition of the state, restated as the underlying rule rather
        # than the flag alone.
        candidate = pool.get(slug)
        for seat_index in range(len(state["seats"])):
            assert not S.can_seat_acquire(state, seat_index, candidate, pool)
        # And the seat that WOULD have opened, but for this, has nothing to
        # do: no seat has legal commands while the park holds.
        for seat_index in range(len(state["seats"])):
            assert S.legal_commands(state, seat_index) == ()

    def test_history_has_not_grown_at_the_moment_of_the_park(self, pool):
        """(b) The park is truly unresolved: reading it twice is idempotent,
        because reading is not a resolution -- the direct negation of the
        original bug, which appended the settled record inside the very call
        that drew the candidate."""
        state, slug = _build_parked_state(pool, seed=1)
        history_before = len(state["history"])

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
        state, slug = _build_parked_state(pool, seed=2)
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
        # see `resolve_unwinnable_lot`'s own comment -- but it is never still
        # the same unresolved candidate).
        assert state["current_candidate"] != slug

    def test_resolving_never_reparks_now_that_the_next_draw_is_eligible(self, pool):
        """A cascade of parks was correct and expected before this pass's
        eligibility filter, because the NEXT draw could just as easily miss
        too. It cannot any more: `_eligible_candidates` gates every draw
        `_advance_lot` makes, including the one `resolve_unwinnable_lot`
        triggers, so resolving a hand-built park lands on a genuinely
        actionable state -- a real seat on the clock, or the match complete --
        in exactly one call."""
        state, _slug = _build_parked_state(pool, seed=3)

        S.resolve_unwinnable_lot(state, pool)

        assert not S.is_unwinnable_lot_pending(state)
        assert state["phase"] in (S.PHASE_AUCTION, S.PHASE_COMPLETE)
        if state["phase"] == S.PHASE_AUCTION:
            assert state["active_seat"] is not None


# ---------------------------------------------------------------------------
# The market itself: no seed, no play style, ever parks any more
# ---------------------------------------------------------------------------


def _play_recording_observations(seed: int, pool, seat_strategies) -> tuple[dict, set]:
    """Drive one full match, recording every `current_candidate` a caller
    could have read live -- including while parked on an unwinnable draw, if
    one ever occurred -- before it settles.

    Mirrors `conftest.play_match`'s own resolve-and-continue handling for
    `active_seat is None`, with one addition: the observation is taken BEFORE
    each step decides anything, exactly as an external poll would be a read
    that happens before whatever the server does next.
    """
    state = S.initial_state(seed=seed)
    rng = random.Random(seed ^ 0x5EED)
    observed: set[str] = set()
    actions = 0
    parks = 0
    while not S.is_complete(state):
        actions += 1
        assert actions < MAX_ACTIONS, f"seed {seed}: match did not terminate"
        if state.get("current_candidate"):
            observed.add(state["current_candidate"])
        seat_index = state["active_seat"]
        if seat_index is None:
            # A forced-fill park (PEAK3 Pass 1) is a DIFFERENT, expected beat
            # -- it settles a position no other still-competing seat could
            # ever have contested, not one nobody at all could act on -- so it
            # is resolved (and still counted as `observed` above, same as any
            # other park) without counting toward `parks`, which this file's
            # own invariant defines specifically as an UNWINNABLE draw.
            if S.is_forced_fill_pending(state):
                S.resolve_forced_fill(state, pool)
                continue
            assert S.is_unwinnable_lot_pending(state)
            parks += 1
            S.resolve_unwinnable_lot(state, pool)
            continue
        play = seat_strategies.get(seat_index, random_legal)
        command, amount = play(state, seat_index, pool, rng)
        _, code, message = S.submit_action(state, seat_index, command, amount, pool)
        assert code is None, f"unexpected rejection {code}: {message}"
    return state, observed, parks


def _assert_invariant_over_seeds(pool, seat_strategies, seeds) -> tuple[int, int]:
    """Every auctioned lot in every seed's final history was observed live
    before it settled -- the original phantom-lot invariant, held regardless
    of play style. Returns `(phantom, parks)`:

      * `phantom` -- lots settled unsold with NO recorded actions at all,
        i.e. no seat was ever even handed a turn on them. This IS the shape
        of an unwinnable draw settling, so it is the direct measurement of
        whether the market still produces one.
      * `parks` -- how many times `active_seat is None` was actually observed
        during the walk, i.e. how many times the shape this file used to
        search for was hit AT ALL, by any means.

    Both must be zero after this pass's fix: not merely "the phantom-settled
    lot is still observed correctly if it happens" (already proved above by
    direct construction), but "it does not happen".
    """
    phantom = 0
    parks = 0
    for seed in seeds:
        state, observed, seed_parks = _play_recording_observations(seed, pool, seat_strategies)
        parks += seed_parks
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
    return phantom, parks


class TestTheMarketNeverParksAnyMore:
    """The product-facing half of the fix, proved across a spread of how a
    match is actually played -- no bids at all, one seat bidding while the
    other never does, both seats bidding aggressively, and the shipped bot on
    both seats. Every style must show ZERO parks now, because the guarantee is
    a property of the STATE MACHINE (`_eligible_candidates` gates the draw
    itself), not of any one strategy avoiding the shape by luck."""

    def test_no_bids_at_all(self, pool):
        phantom, parks = _assert_invariant_over_seeds(
            pool, {0: always_pass, 1: always_pass}, range(20)
        )
        assert phantom == 0, "an unwinnable draw settled unsold with no seat ever on the clock"
        assert parks == 0, "the market still produced an unwinnable draw"

    def test_one_seat_bidding_the_other_never_does(self, pool):
        phantom, parks = _assert_invariant_over_seeds(
            pool, {0: always_pass, 1: always_min_raise}, range(20)
        )
        assert phantom == 0
        assert parks == 0

    def test_both_seats_bidding_aggressively(self, pool):
        phantom, parks = _assert_invariant_over_seeds(
            pool, {0: always_min_raise, 1: always_min_raise}, range(20)
        )
        assert phantom == 0
        assert parks == 0

    def test_the_shipped_bot_on_both_seats(self, pool):
        phantom, parks = _assert_invariant_over_seeds(
            pool, {0: bot_strategy(), 1: bot_strategy()}, range(20)
        )
        assert phantom == 0
        assert parks == 0


def test_a_real_market_never_parks_on_an_unwinnable_draw(pool):
    """THE DIRECT REPLACEMENT for this file's old sanity check, which used to
    prove the market really did reach the park (`_find_unwinnable_park`, now
    removed). It proves the opposite, which is now the true invariant: across
    a wide seed sweep, driven by the shipped bot exactly as
    `test_bot_calibration.py` drives it, `_advance_lot` never once leaves a
    candidate up that neither seat can act on.
    """
    policy = TwentyDollarBot()
    for seed in SEARCH_SEEDS:
        state = S.initial_state(seed=seed)
        rng = random.Random(seed ^ 0x9A17)
        actions = 0
        while not S.is_complete(state):
            actions += 1
            assert actions < MAX_ACTIONS, f"seed {seed}: match did not terminate"
            assert not S.is_unwinnable_lot_pending(state), (
                f"seed {seed}: the market drew a candidate neither seat could act on "
                "-- exactly the reported deadlock this pass fixes"
            )
            if S.is_forced_fill_pending(state):
                # A genuinely divergent-needs endgame (PEAK3 Pass 1): expected
                # here, unlike the unwinnable case above -- resolve the beat
                # and continue driving with the bot, same as `conftest.
                # play_match` does.
                S.resolve_forced_fill(state, pool)
                continue
            seat_index = state["active_seat"]
            public, private, _ = S.project(state, seat_index, pool)
            private = {**private, "candidate_tier": state.get("current_candidate_tier")}
            command, payload = policy.decide(public, private, rng)
            _, code, message = S.submit_action(
                state, seat_index, command, int(payload.get("amount", 0)), pool
            )
            assert code is None, f"seed {seed}: unexpected rejection {code}: {message}"
