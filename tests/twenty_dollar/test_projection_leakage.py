"""The sealed bid must not reach the other seat. This is the cheating test.

`project` is the only thing standing between a locked bid and its opponent, so
these tests are written to FAIL LOUDLY and to keep failing as the state grows:
the central one walks the projected structure recursively looking for the
opponent's actual amount anywhere in it, rather than asserting the absence of
the one key we happened to think of.
"""
from __future__ import annotations

import json

import pytest

from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.pool import get_pool


@pytest.fixture()
def pool():
    return get_pool()


@pytest.fixture()
def mid_round(pool):
    """A live round in which both seats have locked DIFFERENT, distinctive bids."""
    st = S.initial_state(seed=4242)
    S.submit_bid(st, 0, 13, pool)
    S.submit_bid(st, 1, 2, pool)
    return st


def _values(node) -> list:
    """Every scalar anywhere in a nested structure."""
    out: list = []
    if isinstance(node, dict):
        for value in node.values():
            out.extend(_values(value))
    elif isinstance(node, (list, tuple)):
        for value in node:
            out.extend(_values(value))
    else:
        out.append(node)
    return out


class TestSealedBidIsNotLeaked:
    def test_the_opponents_amount_appears_nowhere_in_the_projection(self, mid_round, pool):
        """The load-bearing assertion.

        Seat 0 bid 13 and seat 1 bid 2. Seat 1's projection must contain 2
        (their own bid) and must NOT contain 13 anywhere -- not under a key we
        anticipated, not nested in a seat block, not in history.

        Deliberately a search rather than a key check: a future field that
        carried the number would slip past `assert "bid" not in public`, and
        this is the one place in the mode where a miss is a cheating bug.
        """
        public, private, _ = S.project(mid_round, 1, pool)
        assert 13 not in _values(public)
        assert 13 not in _values(private)
        assert private["your_bid"] == 2

    def test_the_mirror_direction_also_holds(self, mid_round, pool):
        public, private, _ = S.project(mid_round, 0, pool)
        assert 2 not in _values(private)
        assert private["your_bid"] == 13
        # Seat 1's amount must not be reachable through the public block.
        opponent = next(s for s in public["seats"] if s["seat_index"] == 1)
        assert "bid" not in opponent

    def test_no_seat_block_carries_a_bid_key_at_all(self, mid_round, pool):
        for viewer in (0, 1):
            public, _, _ = S.project(mid_round, viewer, pool)
            for seat in public["seats"]:
                assert "bid" not in seat, "a bid amount reached the public block"

    def test_lock_status_is_public_but_the_amount_is_not(self, mid_round, pool):
        """The one deliberate disclosure, pinned so it stays deliberate."""
        public, _, _ = S.project(mid_round, 1, pool)
        opponent = next(s for s in public["seats"] if s["seat_index"] == 0)
        assert opponent["locked"] is True
        assert set(opponent) == {
            "seat_index",
            "budget",
            "filled_slots",
            "roster_full",
            "locked",
            "roster",
            "assignment",
            "open_slots",
        }

    def test_a_half_locked_round_does_not_leak_the_locked_side(self, pool):
        st = S.initial_state(seed=99)
        S.submit_bid(st, 0, 11, pool)
        public, private, _ = S.project(st, 1, pool)
        assert 11 not in _values(public)
        assert 11 not in _values(private)
        assert private["your_bid"] is None

    def test_the_projection_is_json_serialisable(self, mid_round, pool):
        """It crosses the wire, so it must survive the trip without a custom
        encoder that could re-introduce a stripped field."""
        public, private, commands = S.project(mid_round, 0, pool)
        json.dumps({"public": public, "private": private, "legal": list(commands)})


class TestRevealHappensOnlyAfterResolution:
    def test_the_score_is_hidden_while_the_round_is_live(self, pool):
        st = S.initial_state(seed=4242)
        public, private, _ = S.project(st, 0, pool)
        candidate = public["candidate"]
        assert candidate is not None
        # Identity and eligibility only: the score IS the thing being bid on.
        assert set(candidate) == {
            "player_slug",
            "player_name",
            "anchor_season",
            "team",
            "positions",
        }
        assert "prime_score" not in candidate
        assert "components" not in candidate
        assert "rank" not in candidate

    def test_the_true_score_is_not_hidden_elsewhere_in_the_projection(self, pool):
        """The score must not be inferable from any other published field."""
        st = S.initial_state(seed=4242)
        card = pool.get(st["current_candidate"])
        public, private, _ = S.project(st, 0, pool)
        assert card.prime_score not in _values(public)
        assert card.prime_score not in _values(private)
        assert card.rank not in _values(public)

    def test_everything_is_revealed_once_the_round_resolves(self, mid_round, pool):
        card = pool.get(mid_round["current_candidate"])
        resolved = S.resolve_round(mid_round, pool)
        public, _, _ = S.project(resolved, 1, pool)
        record = public["history"][0]
        assert record["candidate"]["prime_score"] == card.prime_score
        assert set(record["candidate"]["components"]) == {
            "statistical_impact",
            "traditional_production",
            "individual_recognition",
            "postseason_individual_value",
            "team_achievement",
        }
        # Both amounts are now public -- at this point they are the result.
        assert record["bids"] == [13, 2]

    def test_a_resolved_round_names_the_winner_and_the_price(self, mid_round, pool):
        resolved = S.resolve_round(mid_round, pool)
        record = resolved["history"][0]
        assert record["winner_seat"] == 0
        assert record["price"] == 13
        assert record["decided_by"] == "bid_amount"


class TestLegalCommands:
    def test_a_locked_seat_has_no_further_move(self, pool):
        st = S.initial_state(seed=7)
        assert S.legal_commands(st, 0) == ("bid", "pass")
        S.submit_bid(st, 0, 3, pool)
        assert S.legal_commands(st, 0) == ()
        assert S.legal_commands(st, 1) == ("bid", "pass")

    def test_pass_is_always_offered_beside_bid(self, pool):
        """So the foundation's payload-free baseline bot degrades to a legal
        move rather than a guaranteed rejection (`bots.py:75-83`)."""
        st = S.initial_state(seed=7)
        assert "pass" in S.legal_commands(st, 0)

    def test_a_completed_match_offers_nothing(self, pool):
        st = S.initial_state(seed=7)
        st["phase"] = S.PHASE_COMPLETE
        assert S.legal_commands(st, 0) == ()
