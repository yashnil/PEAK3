"""The candidate's PEAK3 score must not reach a bidder before the lot resolves.

THIS IS THE CHEATING TEST for the ascending auction. v1's secret was a sealed
bid; v2 has no sealed bid -- every amount is public the moment it is named, and
that is a rule rather than an oversight. What IS secret is the one thing being
bid on: the exact career-best 1Y `prime_score`, the published rank, and the
component breakdown (brief rules 14 and 15).

Written to FAIL LOUDLY and to keep failing as the state grows: the central test
walks the projected structure recursively looking for the true score anywhere in
it, rather than asserting the absence of the one key we happened to think of.
"""
from __future__ import annotations

import json

import pytest

from nba_peak.twenty_dollar import state as S


def _values(node):
    """Every scalar anywhere in a nested structure."""
    if isinstance(node, dict):
        for value in node.values():
            yield from _values(value)
    elif isinstance(node, (list, tuple)):
        for value in node:
            yield from _values(value)
    else:
        yield node


@pytest.fixture()
def live_lot(pool):
    """A lot mid-auction: one bid standing, the other seat on the clock."""
    state = S.initial_state(seed=4242)
    opener = state["active_seat"]
    S.submit_action(state, opener, S.COMMAND_BID, 4, pool)
    return state


class TestScoreIsHiddenWhileTheLotIsLive:
    def test_the_candidate_block_carries_identity_only(self, live_lot, pool):
        public, _, _ = S.project(live_lot, 0, pool)
        candidate = public["candidate"]
        assert candidate is not None
        assert set(candidate) == {
            "player_slug",
            "player_name",
            "anchor_season",
            "team",
            "positions",
        }

    @pytest.mark.parametrize("seat_index", [0, 1])
    def test_the_true_score_appears_nowhere_in_either_projection(
        self, live_lot, pool, seat_index
    ):
        card = pool.get(live_lot["current_candidate"])
        public, private, _ = S.project(live_lot, seat_index, pool)
        assert card.prime_score not in list(_values(public))
        assert card.prime_score not in list(_values(private))

    @pytest.mark.parametrize("seat_index", [0, 1])
    def test_the_published_rank_is_not_leaked_either(self, live_lot, pool, seat_index):
        # Rank is an ordering over the same score. Publishing it would make the
        # score inferable to within a band, which is most of the information.
        card = pool.get(live_lot["current_candidate"])
        public, private, _ = S.project(live_lot, seat_index, pool)
        assert card.rank not in list(_values(public))
        assert card.rank not in list(_values(private))

    def test_the_projection_is_json_serialisable(self, live_lot, pool):
        """It crosses the wire, so it must survive the trip without a custom
        encoder that could re-introduce a stripped field."""
        public, private, commands = S.project(live_lot, 0, pool)
        json.dumps({"public": public, "private": private, "legal": list(commands)})


class TestRevealHappensOnResolution:
    def test_everything_is_revealed_once_the_lot_resolves(self, live_lot, pool):
        card = pool.get(live_lot["current_candidate"])
        other = 1 - live_lot["active_seat"]
        S.submit_action(live_lot, live_lot["active_seat"], S.COMMAND_PASS, 0, pool)
        public, _, _ = S.project(live_lot, 0, pool)
        record = public["history"][0]
        assert record["candidate"]["prime_score"] == card.prime_score
        assert record["candidate"]["rank"] == card.rank
        assert set(record["candidate"]["components"]) == {
            "statistical_impact",
            "traditional_production",
            "individual_recognition",
            "postseason_individual_value",
            "team_achievement",
        }
        assert record["winner_seat"] == other
        assert record["price"] == 4

    def test_a_rostered_player_carries_their_revealed_score(self, live_lot, pool):
        card = pool.get(live_lot["current_candidate"])
        S.submit_action(live_lot, live_lot["active_seat"], S.COMMAND_PASS, 0, pool)
        public, _, _ = S.project(live_lot, 0, pool)
        owned = [e for seat in public["seats"] for e in seat["roster"]]
        assert any(e["prime_score"] == card.prime_score for e in owned)


class TestWhatIsDeliberatelyPublic:
    """An open outcry auction that hid the standing bid would be a different
    game. These assertions are the record that the disclosure is a decision."""

    def test_the_standing_bid_and_its_owner_are_public_to_both_seats(self, live_lot, pool):
        high = live_lot["high_bidder"]
        for seat_index in (0, 1):
            public, _, _ = S.project(live_lot, seat_index, pool)
            assert public["current_bid"] == 4
            assert public["high_bidder"] == high

    def test_both_budgets_and_both_rosters_are_public(self, live_lot, pool):
        public, _, _ = S.project(live_lot, 0, pool)
        assert [s["budget"] for s in public["seats"]] == [20, 20]
        assert all("roster" in s for s in public["seats"])

    def test_the_seat_on_the_clock_is_public(self, live_lot, pool):
        public, _, _ = S.project(live_lot, 1, pool)
        assert public["active_seat"] == live_lot["active_seat"]


class TestLegalCommands:
    def test_only_the_seat_on_the_clock_has_a_move(self, pool):
        state = S.initial_state(seed=7)
        active = state["active_seat"]
        assert S.legal_commands(state, active) == ("bid", "pass")
        assert S.legal_commands(state, 1 - active) == ()

    def test_pass_is_always_offered_beside_bid(self, pool):
        """So the foundation's payload-free baseline bot degrades to a legal
        move rather than a guaranteed rejection (`bots.py:75-83`)."""
        state = S.initial_state(seed=7)
        assert "pass" in S.legal_commands(state, state["active_seat"])

    def test_a_completed_match_offers_nothing(self, pool):
        state = S.initial_state(seed=7)
        state["phase"] = S.PHASE_COMPLETE
        assert S.legal_commands(state, 0) == ()


class TestBlockedReasonIsExplained:
    """A disabled control must say why (brief section 7). The reason is a
    machine-readable string so the UI renders copy rather than parsing prose."""

    def test_the_seat_off_the_clock_is_told_so(self, live_lot, pool):
        active = live_lot["active_seat"]
        _, private, _ = S.project(live_lot, 1 - active, pool)
        assert private["bid_blocked_reason"] == "not_your_turn"

    def test_the_seat_on_the_clock_has_no_blocker(self, live_lot, pool):
        active = live_lot["active_seat"]
        _, private, _ = S.project(live_lot, active, pool)
        assert private["bid_blocked_reason"] is None

    def test_an_unaffordable_lot_names_the_reserve(self, pool):
        state = S.initial_state(seed=11)
        active = state["active_seat"]
        state["seats"][active]["budget"] = 4  # ceiling 0 with five slots open
        _, private, _ = S.project(state, active, pool)
        assert private["bid_blocked_reason"] == "insufficient_reserve"
        assert S.legal_commands(state, active) == ("pass",)

    def test_a_completed_match_says_so(self, pool):
        state = S.initial_state(seed=11)
        state["phase"] = S.PHASE_COMPLETE
        state["current_candidate"] = None
        _, private, _ = S.project(state, 0, pool)
        assert private["bid_blocked_reason"] == "match_complete"
