"""Hard PG/SG/SF/PF/C legality, and the matching that backs roster completion."""
from __future__ import annotations

import pytest

from nba_peak.three_man_weave import positions as P
from nba_peak.three_man_weave.config import BENCH_SLOT_TYPES, SLOT_TYPES, STARTER_SLOT_TYPES
from nba_peak.three_man_weave.matching import (
    can_assign_distinct,
    find_assignment,
    has_perfect_matching,
    maximum_matching,
)


# ---------------------------------------------------------------------------
# The two named cases
# ---------------------------------------------------------------------------
def test_shaquille_oneal_cannot_play_small_forward():
    """A true centre is illegal at SF. CourtBuilder would merely dock fit
    points here; a draft has to refuse."""
    assert P.canonical_positions("shaquille-o-neal") == frozenset({"C"})
    assert not P.is_legal("shaquille-o-neal", "SF")
    assert not P.is_legal("shaquille-o-neal", "PF")
    assert P.is_legal("shaquille-o-neal", "C")


def test_lebron_james_can_play_point_guard():
    """Legality follows real logged minutes, and LeBron really did log PG
    seasons -- so PG is legal for him and SF is not the only answer."""
    assert "PG" in P.canonical_positions("lebron-james")
    assert P.is_legal("lebron-james", "PG")
    assert P.legal_slots("lebron-james") == frozenset(
        {"PG", "SG", "SF", "PF", "C"} | set(BENCH_SLOT_TYPES)
    )


# ---------------------------------------------------------------------------
# Slug variants
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "spelling_a,spelling_b",
    [
        ("shaquille-o-neal", "shaquille-oneal"),
        ("amar-e-stoudemire", "amare-stoudemire"),
        ("de-aaron-fox", "deaaron-fox"),
        ("p-j-brown", "pj-brown"),
    ],
)
def test_both_slug_spellings_resolve_to_the_same_positions(spelling_a, spelling_b):
    """Two slug conventions coexist in this repo. A lookup that skips the
    variant table returns "no positions" -- which makes the player illegal
    everywhere, a silent total exclusion rather than a visible error."""
    positions = P.canonical_positions(spelling_a)
    assert positions
    assert positions == P.canonical_positions(spelling_b)


def test_normalize_slug_bridges_to_a_known_key_set():
    known = {"shaquille-o-neal", "lebron-james"}
    assert P.normalize_slug("shaquille-oneal", known) == "shaquille-o-neal"
    assert P.normalize_slug("lebron-james", known) == "lebron-james"
    assert P.normalize_slug("nobody-at-all", known) is None


# ---------------------------------------------------------------------------
# Legality basics
# ---------------------------------------------------------------------------
def test_an_identity_with_no_position_data_is_illegal_everywhere():
    """Empty means "no information", never "plays anywhere" -- including the
    bench, which accepts any player who has a recognized position but is not
    a dumping ground for one we know nothing about."""
    assert P.canonical_positions("not-a-real-player") == frozenset()
    assert P.legal_slots("not-a-real-player") == frozenset()
    for slot in SLOT_TYPES:
        assert not P.is_legal("not-a-real-player", slot)


def test_bench_accepts_any_player_with_a_recognized_position():
    for slug in ("shaquille-o-neal", "lebron-james", "john-stockton"):
        for bench_slot in BENCH_SLOT_TYPES:
            assert P.is_legal(slug, bench_slot)


def test_every_eligible_identity_has_at_least_one_legal_slot(index):
    """A drafted identity with nowhere to go would strand a roster. The
    eligibility index must never offer one."""
    for franchise_id, decade in index.rolls():
        for slug in index.eligible_slugs(franchise_id, decade):
            assert P.legal_slots(slug), f"{slug} has no legal slot"


# ---------------------------------------------------------------------------
# Roster-level validation
# ---------------------------------------------------------------------------
def test_validate_roster_rejects_an_illegal_placement():
    roster = P.empty_roster()
    roster["SF"] = "shaquille-o-neal"
    check = P.validate_roster(roster)
    assert not check.ok
    assert check.code == "illegal_slot"


def test_validate_roster_rejects_the_same_identity_twice():
    roster = P.empty_roster()
    roster["PG"] = "lebron-james"
    roster["SG"] = "lebron-james"
    check = P.validate_roster(roster)
    assert not check.ok
    assert check.code == "duplicate_player"


def test_validate_roster_accepts_a_partial_roster():
    roster = P.empty_roster()
    roster["C"] = "shaquille-o-neal"
    assert P.validate_roster(roster).ok


# ---------------------------------------------------------------------------
# Repositioning
# ---------------------------------------------------------------------------
def test_reposition_that_would_be_illegal_raises_and_changes_nothing():
    """The outcome is computed and validated before anything is committed,
    so there is no window in which the caller holds an illegal roster --
    temporarily or finally."""
    roster = P.empty_roster()
    roster["C"] = "shaquille-o-neal"
    roster["SF"] = "lebron-james"
    before = dict(roster)

    with pytest.raises(P.IllegalPlacement) as excinfo:
        P.apply_reposition(roster, "C", "SF")
    assert excinfo.value.code == "illegal_slot"
    assert roster == before, "the input roster must not be mutated"


def test_reposition_returns_a_new_legal_roster():
    """Both directions of the swap must be legal, not just one: Bird can play
    SF and PF, LeBron can play both too, so PF<->SF is a legal exchange."""
    roster = P.empty_roster()
    roster["PF"] = "lebron-james"
    roster["SF"] = "larry-bird"
    moved = P.apply_reposition(roster, "PF", "SF")
    assert moved["PF"] == "larry-bird"
    assert moved["SF"] == "lebron-james"
    assert P.validate_roster(moved).ok
    assert roster["PF"] == "lebron-james", "input untouched"


def test_reposition_is_refused_when_only_one_direction_is_legal():
    """Bird cannot play point guard, so swapping him into PG is illegal even
    though LeBron could happily take SF."""
    roster = P.empty_roster()
    roster["PG"] = "lebron-james"
    roster["SF"] = "larry-bird"
    with pytest.raises(P.IllegalPlacement) as excinfo:
        P.apply_reposition(roster, "PG", "SF")
    assert excinfo.value.code == "illegal_slot"


def test_reposition_into_an_empty_slot_is_a_move():
    roster = P.empty_roster()
    roster["SG"] = "lebron-james"
    moved = P.apply_reposition(roster, "SG", "PG")
    assert moved["PG"] == "lebron-james"
    assert moved["SG"] is None


def test_reposition_rejects_an_unknown_slot():
    with pytest.raises(P.IllegalPlacement) as excinfo:
        P.apply_reposition(P.empty_roster(), "PG", "point_guard")
    assert excinfo.value.code == "unknown_slot"


# ---------------------------------------------------------------------------
# Completion is a matching question, not a counting one
# ---------------------------------------------------------------------------
def test_three_centres_cannot_fill_three_different_positions():
    """The single most important property in this file: a candidate COUNT
    says yes and basketball says no. Three eligible players, three slots to
    fill, and only a real matching reports the truth."""
    centres = ["shaquille-o-neal", "dikembe-mutombo", "patrick-ewing"]
    roster = P.empty_roster()
    # Everything filled except PG, SG and C, so exactly three slots remain
    # and exactly three centres are on offer.
    roster["SF"] = "larry-bird"
    roster["PF"] = "tim-duncan"
    roster["bench_1"] = "scottie-pippen"
    assert P.open_slots(roster) == ("PG", "SG", "C")
    assert len(centres) == 3
    assert not P.can_complete_roster(roster, centres)
    # Only the C slot is actually reachable from that pool.
    assert P.legal_players_for_slot("C", centres) == tuple(centres)
    assert P.legal_players_for_slot("PG", centres) == ()


def test_can_complete_roster_succeeds_with_a_genuinely_capable_pool():
    """A pool must cover the bench slot too -- `can_complete_roster` counts
    every slot in SLOT_TYPES that is not filled, bench included."""
    pool = [
        "john-stockton",
        "michael-jordan",
        "larry-bird",
        "tim-duncan",
        "shaquille-o-neal",
        "scottie-pippen",
    ]
    roster = P.empty_roster()
    assert P.open_slots(roster) == SLOT_TYPES
    assert P.can_complete_roster(roster, pool)

    witness = P.completion_witness(roster, pool)
    assert witness is not None
    assert set(witness) == set(SLOT_TYPES)
    assert len(set(witness.values())) == len(witness), "witness must use distinct identities"
    for slot, slug in witness.items():
        assert P.is_legal(slug, slot)


def test_can_complete_roster_counts_the_bench_slot(index):
    """Five capable players cannot complete a six-slot roster."""
    five = ["john-stockton", "michael-jordan", "larry-bird", "tim-duncan", "shaquille-o-neal"]
    assert not P.can_complete_roster(P.empty_roster(), five)
    assert P.can_complete_roster(P.empty_roster(), five + ["scottie-pippen"])
    assert STARTER_SLOT_TYPES == ("PG", "SG", "SF", "PF", "C")


def test_completion_witness_is_none_when_completion_is_impossible():
    assert P.completion_witness({"PG": None, "SG": None}, ["shaquille-o-neal"]) is None


def test_can_complete_roster_ignores_players_already_on_the_roster():
    """An identity already placed cannot also fill another slot."""
    roster = P.empty_roster()
    roster["C"] = "shaquille-o-neal"
    for slot in ("PG", "SG", "SF", "PF", "bench_1"):
        roster[slot] = None
    assert not P.can_complete_roster(roster, ["shaquille-o-neal"])


# ---------------------------------------------------------------------------
# The matching primitives themselves
# ---------------------------------------------------------------------------
def test_maximum_matching_finds_the_largest_matching():
    adjacency = {"a": ["x", "y"], "b": ["x"], "c": ["x"]}
    matching = maximum_matching(["a", "b", "c"], adjacency)
    assert len(matching) == 2
    assert not has_perfect_matching(["a", "b", "c"], adjacency)


def test_find_assignment_returns_a_valid_witness():
    adjacency = {"a": ["x", "y"], "b": ["y", "z"], "c": ["z"]}
    assignment = find_assignment(["a", "b", "c"], adjacency)
    assert assignment is not None
    assert len(set(assignment.values())) == 3
    for node, target in assignment.items():
        assert target in adjacency[node]


def test_can_assign_distinct_matches_the_backtracking_semantics():
    assert can_assign_distinct([["p", "q"], ["p"], ["q", "r"]])
    assert not can_assign_distinct([["p"], ["p"], ["p"]])


def test_matching_is_deterministic_for_a_deterministic_input():
    adjacency = {"a": ["x", "y"], "b": ["y", "z"], "c": ["z", "x"]}
    first = find_assignment(["a", "b", "c"], adjacency)
    for _ in range(5):
        assert find_assignment(["a", "b", "c"], adjacency) == first
