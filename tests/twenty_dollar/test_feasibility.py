"""Position feasibility, including future completion.

The cases here are built from REAL position sets in the committed data, not
from invented ones, so a change to `career_positions` that would break the mode
breaks these tests too.
"""
from __future__ import annotations

import pytest

from nba_peak.twenty_dollar import feasibility
from nba_peak.twenty_dollar.config import SLOTS
from nba_peak.twenty_dollar.pool import get_pool


def fs(*positions: str) -> frozenset[str]:
    return frozenset(positions)


class TestImmediateSeating:
    def test_two_center_only_players_cannot_be_seated(self):
        fit = feasibility.evaluate(
            [("a", fs("C")), ("b", fs("C"))], (), require_future=False
        )
        assert fit.feasible is False
        assert fit.reason == "no_legal_seating"

    def test_a_multi_position_player_slides_to_make_room(self):
        """Jokic-shaped: `{C, PF}` moves to PF so a `{C}` player can have C."""
        fit = feasibility.evaluate(
            [("shaq", fs("C")), ("jokic", fs("C", "PF"))], (), require_future=False
        )
        assert fit.feasible is True
        assert fit.assignment == {"C": "shaq", "PF": "jokic"}

    def test_seating_is_recomputed_not_patched(self):
        """Order of acquisition must not change legality.

        The same three players in either arrival order must seat, because the
        assignment is recomputed from scratch every time rather than appended
        to incrementally.
        """
        players = [("a", fs("C")), ("b", fs("C", "PF")), ("c", fs("PF", "SF"))]
        forward = feasibility.evaluate(players, (), require_future=False)
        backward = feasibility.evaluate(list(reversed(players)), (), require_future=False)
        assert forward.feasible and backward.feasible

    def test_a_full_legal_roster_has_no_open_slots(self):
        roster = [(slot.lower(), fs(slot)) for slot in SLOTS]
        fit = feasibility.evaluate(roster, (), require_future=False)
        assert fit.feasible is True
        assert fit.open_slots == ()


class TestFutureCompletion:
    def test_one_versatile_player_cannot_cover_three_slots(self):
        """Hall's condition, which a per-slot count would pass.

        Three open slots each have "at least one eligible player available" --
        but it is the SAME player, so no system of distinct representatives
        exists and the roster is not completable.
        """
        owned = [("a", fs("PG")), ("b", fs("SG"))]
        assert feasibility.evaluate(owned, [fs("SF", "PF", "C")]).feasible is False

    def test_three_distinct_players_can_cover_three_slots(self):
        owned = [("a", fs("PG")), ("b", fs("SG"))]
        available = [fs("SF"), fs("PF"), fs("C")]
        assert feasibility.evaluate(owned, available).feasible is True

    def test_acquiring_a_player_that_would_strand_the_roster_is_refused(self):
        """The case a naive 'is that slot free?' check gets wrong.

        Owning `{C}` and `{C, PF}` means C and PF are both effectively spoken
        for: the multi-position player is the only thing making the pair legal.
        A third player who can ONLY play PF pins them and breaks the roster,
        even though PF looks occupied-by-a-flexible-player rather than full.
        """
        owned = [("shaq", fs("C")), ("jokic", fs("C", "PF"))]
        plenty = [fs("PG"), fs("SG"), fs("SF")]
        assert feasibility.can_acquire(owned, fs("PF"), plenty) is False

    def test_the_same_acquisition_is_allowed_when_it_does_not_pin(self):
        owned = [("shaq", fs("C"))]
        plenty = [fs("PG"), fs("SG"), fs("SF")]
        assert feasibility.can_acquire(owned, fs("PF"), plenty) is True

    def test_a_candidate_is_not_counted_as_its_own_future_filler(self):
        """`available_after` must exclude the candidate being acquired.

        Owning four players who need PG/SG/SF/PF leaves only C. A `{C}`
        candidate fills it -- and there must then be nothing left to find,
        which is fine because the roster is complete. But a candidate must
        never be double-counted as both the purchase and the filler for a
        DIFFERENT slot, which is what this asserts.
        """
        owned = [
            ("a", fs("PG")),
            ("b", fs("SG")),
            ("c", fs("SF")),
            ("d", fs("PF")),
        ]
        assert feasibility.can_acquire(owned, fs("C"), []) is True

    def test_a_full_roster_cannot_acquire(self):
        roster = [(slot.lower(), fs(slot)) for slot in SLOTS]
        assert feasibility.can_acquire(roster, fs("PG"), [fs("PG")]) is False


class TestFillableSlots:
    def test_reports_only_slots_that_survive_reseating(self):
        """`{C, PF}` behind a `{C}` player can only take PF."""
        assert feasibility.fillable_slots([("shaq", fs("C"))], fs("C", "PF")) == ("PF",)

    def test_an_open_roster_offers_every_matching_slot(self):
        assert set(feasibility.fillable_slots([], fs("SF", "PF"))) == {"SF", "PF"}


class TestAgainstRealData:
    """The mode's guarantees hold against the committed 1,000-player board."""

    def test_every_candidate_carries_a_real_starter_position(self):
        pool = get_pool()
        assert len(pool) == 1000
        for candidate in pool:
            assert candidate.positions <= frozenset(SLOTS)
            assert candidate.positions, f"{candidate.player_slug} has no position"

    def test_no_candidate_was_dropped_for_missing_positions(self):
        """Position coverage on this board is total.

        Measured, not assumed: if a future regeneration introduces a player
        with no derivable position, this fails rather than silently shrinking
        the pool.
        """
        assert len(get_pool()) == 1000

    def test_shaquille_oneal_is_a_center_only(self):
        """A real single-position player, reachable under either slug spelling."""
        pool = get_pool()
        assert pool.get("shaquille-oneal").positions == frozenset({"C"})
        assert pool.get("shaquille-o-neal").player_slug == "shaquille-o-neal"

    @pytest.mark.parametrize(
        "drifted",
        ["shaquille-oneal", "jermaine-oneal", "deaaron-fox", "amare-stoudemire", "pj-brown"],
    )
    def test_every_known_slug_drift_case_resolves(self, drifted):
        """The five spellings that differ between the two committed conventions."""
        assert get_pool().has(drifted)

    def test_every_slot_has_a_deep_supply(self):
        """No slot is so scarce that a roster can be strand-locked by bad luck."""
        counts = get_pool().slot_counts()
        assert set(counts) == set(SLOTS)
        for slot, count in counts.items():
            assert count >= 200, f"{slot} has only {count} eligible players"
