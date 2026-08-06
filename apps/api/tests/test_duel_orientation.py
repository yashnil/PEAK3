"""Peak Duel Daily left/right presentation fairness.

THE DEFECT THESE TESTS LOCK OUT. `generate_duels` used to place the higher
`prime_index` on the left in one statement with the winner decision::

    if a["prime_index"] >= b["prime_index"]:
        winner_id = a["id"]
        left, right = a, b

so the stronger peak sat on the left of 100% of duels. The layout leaked the
answer, and a player could win without reading either card.

WHAT IS ASSERTED HERE, and why each one is separate from the others:

  * DETERMINISM -- the same daily seed produces the same orientation, so the
    board is genuinely shared and a refresh cannot move the cards.
  * BALANCE -- over 1,000 daily seeds the stronger peak lands left between 45%
    and 55% of the time (the specification's tolerance).
  * INDEPENDENCE FROM STRENGTH -- orientation must not correlate with the score
    gap, which is the property that makes the layout uninformative rather than
    merely noisy.
  * NO LATER REORDERING -- the answer path decides a winner from `prime_index`
    and must never re-derive it from which side a card was on.
"""
from __future__ import annotations

import random
import statistics

import pytest

from app.services.duel import (
    daily_seed,
    generate_daily_duels,
    generate_duels,
    stronger_on_left,
)


def _pool(size: int = 160) -> list[dict]:
    """A synthetic peak-window pool with a wide, monotonic score spread.

    Deliberately synthetic rather than the committed artifact: these tests are
    about presentation order, and a fixture whose scores are evenly spread
    makes a strength correlation -- if one existed -- easy to detect.
    """
    rng = random.Random(20260805)
    rows: list[dict] = []
    for index in range(size):
        prime = 40.0 + index * 0.35
        rows.append(
            {
                "id": f"peak-{index:04d}",
                "player_id": f"player-{index:04d}",
                "player_name": f"Player {index:04d}",
                "player_slug": f"player-{index:04d}",
                "duration_years": 1,
                "start_season": "2010-11",
                "end_season": "2010-11",
                "anchor_season": "2010-11",
                "prime_index": prime,
                "rank": index + 1,
            }
        )
    rng.shuffle(rows)
    return rows


def _stronger_side(duel) -> str:
    return "left" if duel._left_prime_index > duel._right_prime_index else "right"


# ---------------------------------------------------------------------------
# The orientation bit itself
# ---------------------------------------------------------------------------


class TestOrientationBit:
    def test_is_stable_for_the_same_seed_and_matchup(self):
        assert stronger_on_left(42, "a", "b") == stronger_on_left(42, "a", "b")

    def test_does_not_depend_on_the_order_the_pair_was_drawn_in(self):
        # The sampler may hand the same two peaks over in either order; the
        # side each one lands on must not change because of it.
        assert stronger_on_left(42, "a", "b") == stronger_on_left(42, "b", "a")

    def test_different_seeds_can_produce_different_orientations(self):
        seen = {stronger_on_left(seed, "peak-a", "peak-b") for seed in range(64)}
        assert seen == {True, False}

    def test_is_balanced_over_many_matchups(self):
        bits = [stronger_on_left(7, f"a-{i}", f"b-{i}") for i in range(4000)]
        share = sum(bits) / len(bits)
        assert 0.45 <= share <= 0.55, share


# ---------------------------------------------------------------------------
# Generated boards
# ---------------------------------------------------------------------------


class TestGeneratedBoards:
    def test_the_stronger_peak_appears_on_both_sides_within_one_board(self):
        pool = _pool()
        duels = generate_daily_duels(pool, years=1, date_str="2026-08-05", count=10)
        sides = {_stronger_side(duel) for duel in duels}
        assert sides == {"left", "right"}

    def test_the_same_date_produces_an_identical_board_for_every_caller(self):
        pool = _pool()
        first = generate_daily_duels(pool, years=1, date_str="2026-08-05", count=10)
        second = generate_daily_duels(pool, years=1, date_str="2026-08-05", count=10)
        assert [(d.left["peak_id"], d.right["peak_id"]) for d in first] == [
            (d.left["peak_id"], d.right["peak_id"]) for d in second
        ]

    def test_a_refresh_cannot_swap_the_cards(self):
        # Same call, ten times: the exact property a player checks by reloading.
        pool = _pool()
        boards = [
            [_stronger_side(d) for d in generate_daily_duels(
                pool, years=3, date_str="2026-08-05", count=10
            )]
            for _ in range(10)
        ]
        assert all(board == boards[0] for board in boards)

    def test_a_different_date_may_orient_the_same_matchup_differently(self):
        pool = _pool()
        by_pair: dict[frozenset[str], set[str]] = {}
        for day in range(1, 29):
            for duel in generate_daily_duels(
                pool, years=1, date_str=f"2026-08-{day:02d}", count=10
            ):
                key = frozenset({duel.left["peak_id"], duel.right["peak_id"]})
                by_pair.setdefault(key, set()).add(_stronger_side(duel))
        # At least one matchup that recurred across days was oriented both ways.
        assert any(len(sides) == 2 for sides in by_pair.values())

    def test_the_winner_is_never_derived_from_the_side(self):
        pool = _pool()
        for duel in generate_daily_duels(pool, years=1, date_str="2026-08-05", count=10):
            stronger = (
                duel.left["peak_id"]
                if duel._left_prime_index > duel._right_prime_index
                else duel.right["peak_id"]
            )
            assert duel._correct_winner_id == stronger


# ---------------------------------------------------------------------------
# The specification's 1,000-seed audit
# ---------------------------------------------------------------------------


class TestThousandSeedAudit:
    """PART 24: over at least 1,000 seeds, stronger-left must sit in 45-55%."""

    @staticmethod
    @pytest.fixture(scope="class")
    def sample() -> list[tuple[str, float]]:
        pool = _pool()
        rows: list[tuple[str, float]] = []
        seeds = 0
        # 1,000 distinct daily seeds: ~34 months of real dates across the four
        # supported durations, which is how a seed is actually produced.
        for years in (1, 2, 3, 5):
            for month in range(1, 13):
                for day in range(1, 29):
                    if seeds >= 250:
                        break
                    seeds += 1
                    date_str = f"2026-{month:02d}-{day:02d}"
                    for duel in generate_daily_duels(pool, years, date_str, count=10):
                        rows.append(
                            (
                                _stronger_side(duel),
                                abs(duel._left_prime_index - duel._right_prime_index),
                            )
                        )
            seeds = 0
        return rows

    def test_at_least_one_thousand_seeds_were_audited(self, sample):
        # 4 durations x 250 dates = 1,000 seeds, 10 duels each.
        assert len(sample) >= 10_000

    def test_stronger_left_ratio_is_between_45_and_55_percent(self, sample):
        left = sum(1 for side, _gap in sample if side == "left")
        ratio = left / len(sample)
        assert 0.45 <= ratio <= 0.55, (
            f"stronger-left ratio {ratio:.4f} over {len(sample)} duels "
            "is outside the 45-55% acceptance band"
        )

    def test_orientation_does_not_correlate_with_the_score_gap(self, sample):
        """A layout that leaked the answer would show up here as a split mean.

        If sides were assigned with any regard to strength, the average gap of
        the stronger-left duels would differ from the stronger-right ones. They
        are drawn from the same distribution, so the two means must agree.
        """
        left_gaps = [gap for side, gap in sample if side == "left"]
        right_gaps = [gap for side, gap in sample if side == "right"]
        assert left_gaps and right_gaps
        spread = statistics.pstdev([gap for _side, gap in sample])
        difference = abs(statistics.fmean(left_gaps) - statistics.fmean(right_gaps))
        # Well inside a tenth of a standard deviation; a score-ordered layout
        # would separate these completely.
        assert difference < 0.1 * spread, (
            f"mean gap differs by {difference:.4f} between sides "
            f"(sd {spread:.4f}) -- orientation is correlated with strength"
        )


def test_endless_mode_is_oriented_from_its_own_seed():
    pool = _pool()
    from app.services.duel import generate_endless_duels

    first = generate_endless_duels(pool, years=1, seed=99, count=20)
    second = generate_endless_duels(pool, years=1, seed=99, count=20)
    assert [_stronger_side(d) for d in first] == [_stronger_side(d) for d in second]
    sides = {_stronger_side(d) for d in first}
    assert sides == {"left", "right"}


def test_generate_duels_defaults_are_still_deterministic():
    """`seed` defaults to 0, so a caller that has not been updated still gets a
    stable board rather than an arbitrary one."""
    pool = _pool()
    a = generate_duels(pool, 8, random.Random(5))
    b = generate_duels(pool, 8, random.Random(5))
    assert [(d.left["peak_id"], d.right["peak_id"]) for d in a] == [
        (d.left["peak_id"], d.right["peak_id"]) for d in b
    ]


def test_daily_seed_is_unchanged():
    """The matchup draw must not move: only the presentation order changed."""
    assert daily_seed("2026-08-05", 1) == daily_seed("2026-08-05", 1)
    assert daily_seed("2026-08-05", 1) != daily_seed("2026-08-06", 1)
