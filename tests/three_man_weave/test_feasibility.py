"""Roll feasibility: the five checks, and the matching that makes them real."""
from __future__ import annotations

import pytest

from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import feasibility as F
from nba_peak.three_man_weave.config import MIN_ELIGIBLE_FOR_ROLL, ROUNDS, stream_rng
from nba_peak.three_man_weave.schemas import DraftPick, Roster


def _roster_with(seat_index: int, filled: dict[str, str]) -> Roster:
    roster = Roster(seat_index=seat_index)
    for slot, slug in filled.items():
        roster.slots[slot] = DraftPick(
            seat_index=seat_index,
            round_number=1,
            slot_type=slot,
            player_slug=slug,
            franchise_id="LAL",
            decade="1980s",
        )
    return roster


@pytest.fixture
def fresh_rosters():
    return tuple(Roster(seat_index=index) for index in range(3))


# ---------------------------------------------------------------------------
# Check 1: the franchise existed in that decade
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "franchise_id,decade",
    [("TOR", "1980s"), ("MEM", "1980s"), ("NOP", "1980s"), ("NOP", "1990s")],
)
def test_a_franchise_absent_in_a_decade_is_rejected(index, fresh_rosters, franchise_id, decade):
    result = F.evaluate_roll(franchise_id, decade, index, fresh_rosters, frozenset())
    assert not result.ok
    assert result.reason == F.REJECT_NO_SUCH_ROLL


def test_a_real_combination_is_accepted_at_match_start(index, fresh_rosters):
    result = F.evaluate_roll("CHI", "1990s", index, fresh_rosters, frozenset())
    assert result.ok
    assert result.reason is None
    assert len(result.undrafted_eligible) >= MIN_ELIGIBLE_FOR_ROLL
    assert result.witness is not None and len(set(result.witness.values())) == 3


# ---------------------------------------------------------------------------
# Check 2: enough undrafted identities remain
# ---------------------------------------------------------------------------
def test_a_roll_drained_below_three_identities_is_rejected(index, fresh_rosters):
    eligible = index.eligible_slugs("MIA", "1980s")
    keep = sorted(eligible)[:2]
    drafted = frozenset(eligible) - frozenset(keep)
    result = F.evaluate_roll("MIA", "1980s", index, fresh_rosters, drafted)
    assert not result.ok
    assert result.reason == F.REJECT_TOO_FEW_ELIGIBLE
    assert len(result.undrafted_eligible) == 2


def test_the_identity_lock_is_applied_across_every_roll(index, fresh_rosters):
    """Drafting a player anywhere removes them from every other franchise x
    decade they were eligible for."""
    before = index.eligible_slugs("CHI", "1990s")
    assert "michael-jordan" in before
    result = F.evaluate_roll(
        "CHI", "1990s", index, fresh_rosters, frozenset({"michael-jordan"})
    )
    assert "michael-jordan" not in result.undrafted_eligible


# ---------------------------------------------------------------------------
# Check 3: every seat has a legal pick
# ---------------------------------------------------------------------------
def test_a_seat_with_no_legal_pick_rejects_the_roll(index):
    """A seat holding only C open cannot play a roll of pure guards, however
    many of them there are. This is the case a candidate count gets wrong."""
    guards = [
        slug
        for slug in sorted(index.eligible_slugs("UTA", "1990s"))
        if F.is_legal(slug, "PG") and not F.is_legal(slug, "C")
    ]
    assert len(guards) >= 3, "fixture assumption: enough pure guards exist"

    # Seat 2 has only C open; seats 0 and 1 are wide open.
    seat_two = _roster_with(
        2,
        {
            "PG": "john-stockton",
            "SG": "michael-jordan",
            "SF": "larry-bird",
            "PF": "tim-duncan",
            "bench_1": "scottie-pippen",
        },
    )
    rosters = (Roster(seat_index=0), Roster(seat_index=1), seat_two)
    assert seat_two.open_slots() == ("C",)
    assert F.legal_choices_for_seat(seat_two, guards) == ()

    drafted = frozenset(index.eligible_slugs("UTA", "1990s")) - frozenset(guards)
    result = F.evaluate_roll("UTA", "1990s", index, rosters, drafted)
    assert not result.ok
    assert result.reason == F.REJECT_SEAT_HAS_NO_LEGAL_PICK


def test_legal_choices_are_relative_to_that_seats_open_slots():
    """Only C is left open, so a pure point guard is not a legal choice for
    this seat however available he is."""
    seat = _roster_with(
        0,
        {
            "PG": "magic-johnson",
            "SG": "michael-jordan",
            "SF": "larry-bird",
            "PF": "karl-malone",
            "bench_1": "scottie-pippen",
        },
    )
    assert seat.open_slots() == ("C",)
    assert F.legal_choices_for_seat(seat, ["john-stockton"]) == ()
    assert F.legal_choices_for_seat(seat, ["hakeem-olajuwon"]) == ("hakeem-olajuwon",)


# ---------------------------------------------------------------------------
# Check 4: three DISTINCT legal selections can be assigned
# ---------------------------------------------------------------------------
def test_three_seats_needing_the_same_single_player_cannot_be_dealt(index):
    """Three centre-only seats and exactly one available centre: each seat
    has a legal pick, but they cannot all have a DISTINCT one."""
    rosters = tuple(
        _roster_with(
            seat,
            {
                "PG": slug_set[0],
                "SG": slug_set[1],
                "SF": slug_set[2],
                "PF": slug_set[3],
                "bench_1": slug_set[4],
            },
        )
        for seat, slug_set in enumerate(
            [
                ["john-stockton", "michael-jordan", "larry-bird", "tim-duncan", "scottie-pippen"],
                ["magic-johnson", "clyde-drexler", "james-worthy", "karl-malone", "dennis-rodman"],
                ["isiah-thomas", "joe-dumars", "julius-erving", "charles-barkley", "horace-grant"],
            ]
        )
    )
    for roster in rosters:
        assert roster.open_slots() == ("C",)

    centres = [
        slug for slug in sorted(index.eligible_slugs("HOU", "1990s")) if F.is_legal(slug, "C")
    ]
    assert centres
    keep = centres[:1] + [
        slug for slug in sorted(index.eligible_slugs("HOU", "1990s")) if not F.is_legal(slug, "C")
    ][:4]
    drafted = frozenset(index.eligible_slugs("HOU", "1990s")) - frozenset(keep)

    result = F.evaluate_roll("HOU", "1990s", index, rosters, drafted)
    assert not result.ok
    assert result.reason in (
        F.REJECT_NO_DISTINCT_ASSIGNMENT,
        F.REJECT_SEAT_HAS_NO_LEGAL_PICK,
    )


# ---------------------------------------------------------------------------
# Check 5: the match can still complete
# ---------------------------------------------------------------------------
def test_can_fill_open_slots_is_global_not_per_seat():
    """Two seats each needing the only remaining centre both pass in
    isolation and must fail together."""
    single_centre = ["shaquille-o-neal"]
    assert F.can_fill_open_slots({0: ("C",)}, single_centre)
    assert F.can_fill_open_slots({1: ("C",)}, single_centre)
    assert not F.can_fill_open_slots({0: ("C",), 1: ("C",)}, single_centre)


def test_can_fill_open_slots_is_trivially_true_with_nothing_open():
    assert F.can_fill_open_slots({}, [])
    assert F.can_fill_open_slots({0: ()}, [])


def test_can_complete_all_rosters_wraps_real_rosters(index, fresh_rosters):
    pool = D.undrafted_pool(D.create_match(1), index)
    assert F.can_complete_all_rosters(fresh_rosters, pool)
    assert not F.can_complete_all_rosters(fresh_rosters, pool[:5])


# ---------------------------------------------------------------------------
# Roll drawing
# ---------------------------------------------------------------------------
def test_the_whole_roll_space_is_playable_at_match_start(index, fresh_rosters):
    """146 real franchise x decade cells, all of them feasible before any
    pick has been made."""
    feasible = F.feasible_rolls(index, fresh_rosters, frozenset())
    assert len(feasible) == len(index.rolls()) == 146


def test_roll_next_never_returns_an_infeasible_roll(index, fresh_rosters, rng):
    for _ in range(25):
        roll = F.roll_next(index, fresh_rosters, frozenset(), 1, rng)
        assert roll is not None
        check = F.evaluate_roll(
            roll.franchise_id, roll.decade, index, fresh_rosters, frozenset()
        )
        assert check.ok


def test_an_already_used_roll_is_skipped(index, fresh_rosters, rng):
    used = frozenset({"chi-1990s"})
    result = F.evaluate_roll("CHI", "1990s", index, fresh_rosters, frozenset(), used)
    assert not result.ok
    assert result.reason == F.REJECT_ALREADY_USED

    for _ in range(25):
        roll = F.roll_next(index, fresh_rosters, frozenset(), 1, rng, used)
        assert roll is not None and roll.roll_id not in used


def test_a_match_never_repeats_a_roll_while_the_space_allows(index, match_driver):
    """Six rounds against a 146-roll space: every roll must be distinct."""
    state = match_driver(index, 4242)
    assert len(state.used_roll_ids) == ROUNDS
    assert len(set(state.used_roll_ids)) == ROUNDS


def test_roll_next_is_deterministic_for_a_given_seed(index, fresh_rosters):
    first = F.roll_next(index, fresh_rosters, frozenset(), 1, stream_rng(77, "rolls"))
    second = F.roll_next(index, fresh_rosters, frozenset(), 1, stream_rng(77, "rolls"))
    assert first is not None
    assert (first.franchise_id, first.decade) == (second.franchise_id, second.decade)


def test_a_revealed_roll_snapshots_its_candidates(index, fresh_rosters, rng):
    """The candidate list is resolved once and never re-resolved, so a player
    mid-decision cannot have their options change underneath them."""
    roll = F.roll_next(index, fresh_rosters, frozenset(), 1, rng)
    assert roll is not None
    assert isinstance(roll.eligible_slugs, tuple)
    assert list(roll.eligible_slugs) == sorted(roll.eligible_slugs)
    assert roll.roll_id == f"{roll.franchise_id.lower()}-{roll.decade}"
