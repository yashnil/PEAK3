"""Season-anchored position legality -- the rule, and the two named failures.

WHAT THIS FILE PROTECTS
------------------------
A screenshot showed a practice bot starting Russell Westbrook at small
forward. Nothing in the draft was broken: `positions.validate_roster` did
exactly what it was asked, and `arrangement` produced a legal matching. The
INPUT was wrong. `career_positions` unions every position a player logged
gated minutes at across their whole career, so Westbrook's single 2025-26
Sacramento season -- the only one of eighteen listed `SF` -- made small
forward legal for him on a 2010s Thunder roster.

That is a class of defect, not one player: any player whose late career was
relabelled carried the new position backwards over every season they ever
played. So the fix is the grain of the rule, and the tests here are about the
grain rather than about Westbrook.

`test_positions.py` covers the matching machinery at career grain, where the
season is irrelevant. This file covers the rule the live game enforces,
against the real committed cards.
"""
from __future__ import annotations

import pytest

from nba_peak.perfect_season.career_positions import career_positions, listed_position
from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import positions as P
from nba_peak.three_man_weave.config import STARTER_SLOT_TYPES


# ---------------------------------------------------------------------------
# The band
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "position,expected",
    [
        ("PG", {"PG", "SG"}),
        ("SG", {"PG", "SG", "SF"}),
        ("SF", {"SG", "SF", "PF"}),
        ("PF", {"SF", "PF", "C"}),
        ("C", {"PF", "C"}),
    ],
)
def test_a_band_is_one_step_along_the_floor(position, expected):
    """One step, never two. This is the single property that stops a point
    guard reaching small forward however versatile the career was."""
    assert P.position_band(position) == frozenset(expected)


def test_a_band_of_a_non_position_is_empty():
    """The source's era-specific bare "F" and its nulls are not positions and
    are never guessed into SF or PF."""
    for token in ("F", "G", "", None, "PG-SG"):
        assert P.position_band(token) == frozenset()


def test_the_band_never_spans_the_whole_floor():
    for position in STARTER_SLOT_TYPES:
        assert len(P.position_band(position)) <= 3


# ---------------------------------------------------------------------------
# The named failure: Westbrook at SF
# ---------------------------------------------------------------------------
def test_russell_westbrook_is_a_point_guard_on_every_card_but_one():
    """THE REPORTED DEFECT. The career union says {PG, SF}; the cards say PG
    everywhere except the one season the source itself lists as SF."""
    assert career_positions("russell-westbrook") >= {"PG", "SF"}

    for season in ("2008-09", "2016-17", "2019-20", "2021-22", "2024-25"):
        assert listed_position("russell-westbrook", season) == "PG"
        assert P.season_starter_positions("russell-westbrook", season) == frozenset({"PG"})
        assert not P.is_legal(
            "russell-westbrook",
            "SF",
            {"russell-westbrook": P.season_slot_rights("russell-westbrook", season)},
        )

    # The one season that genuinely is SF stays SF -- the rule follows the
    # source rather than overriding it in either direction.
    assert listed_position("russell-westbrook", "2025-26") == "SF"
    assert P.season_starter_positions("russell-westbrook", "2025-26") == frozenset({"SF"})


def test_westbrook_cannot_reach_small_forward_on_a_thunder_card(index):
    """The same claim through the object the game actually asks."""
    rights = index.card_slot_rights("russell-westbrook", "OKC", "2010s")
    assert "SF" not in rights
    assert "PG" in rights


def test_the_career_union_alone_would_still_permit_the_defect(index):
    """A guard against "fixed" meaning "the symptom moved".

    If someone reverts legality to the career grain, THIS assertion is the one
    that starts failing -- it states plainly that the old input still contains
    the position that produced the bug.
    """
    assert "SF" in P.career_slot_rights("russell-westbrook")
    assert "SF" not in index.card_slot_rights("russell-westbrook", "OKC", "2010s")


# ---------------------------------------------------------------------------
# The rule does not over-correct
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "slug,franchise,decade,expected",
    [
        # A genuine multi-position forward keeps every position he played.
        ("dennis-rodman", "SAS", "1990s", {"SF", "PF", "C"}),
        ("dennis-rodman", "CHI", "1990s", {"SF", "PF", "C"}),
        # A true centre reaches exactly one starting slot.
        ("shaquille-o-neal", "LAL", "2000s", {"C"}),
        # A combo guard keeps both guard slots.
        ("michael-jordan", "CHI", "1990s", {"PG", "SG", "SF"}),
        # A modern big who really did play the three.
        ("giannis-antetokounmpo", "MIL", "2010s", {"SF", "PF", "C"}),
    ],
)
def test_real_cards_keep_the_positions_a_fan_would_expect(
    index, slug, franchise, decade, expected
):
    starters = {
        slot
        for slot in index.card_slot_rights(slug, franchise, decade)
        if slot in STARTER_SLOT_TYPES
    }
    assert starters == expected


def test_every_card_in_the_index_has_at_least_one_starting_slot(index):
    """An identity the index offers must be placeable, or it strands a roster.

    Season anchoring made this stricter than the career-grain version: it is
    now asserted per CARD rather than per identity.
    """
    for (slug, franchise_id, decade) in index._scoring:
        rights = index.card_slot_rights(slug, franchise_id, decade)
        assert rights & frozenset(STARTER_SLOT_TYPES), (
            f"{slug} has no starting slot on {franchise_id} x {decade}"
        )


def test_the_bare_F_fallback_stays_a_rounding_error(index):
    """The one documented gap, pinned to its measured size.

    `card_starter_positions` falls back to the career grain when the source
    labels a season with the era's bare "F". That is a deliberate, narrow
    exception; if a data change ever widens it, this test fails rather than
    the career grain quietly returning for hundreds of cards.
    """
    without_season_grain = [
        (slug, franchise_id, decade)
        for (slug, franchise_id, decade), card in index._scoring.items()
        if not P.season_starter_positions(slug, card.season)
    ]
    assert len(index._scoring) > 4_000, "fixture assumption: the real index"
    assert len(without_season_grain) <= 5, without_season_grain
    # Every one of them is still placeable through the documented fallback.
    for slug, franchise_id, decade in without_season_grain:
        assert index.card_slot_rights(slug, franchise_id, decade)


# ---------------------------------------------------------------------------
# The property: nothing a finished match displays can be illegal
# ---------------------------------------------------------------------------
def test_every_starter_in_a_played_match_stands_where_their_card_allows(
    index, match_driver
):
    """The end-to-end guarantee, over several independently seeded matches.

    This is the assertion that would have caught the reported screenshot: it
    checks the FINAL roster, at the season grain, for every seat.
    """
    for seed in (11, 4242, 20260803):
        state = match_driver(index, seed)
        for roster in state.rosters:
            for slot, pick in roster.slots.items():
                assert pick is not None
                card = index.scoring_card(
                    pick.player_slug, pick.franchise_id, pick.decade
                )
                assert card is not None
                allowed = P.season_slot_rights(pick.player_slug, card.season)
                assert slot in allowed, (
                    f"seed {seed}: {pick.player_slug} ({card.season}) at {slot}, "
                    f"but that card allows {sorted(allowed)}"
                )


def test_a_rearrangement_cannot_smuggle_a_player_into_an_illegal_slot(index):
    """The transitive case: a chain that would be legal at career grain and is
    not legal at season grain must be refused, not quietly committed."""
    state = D.create_match(7)
    state = D.set_roll(state, _okc_roll())
    state = D.apply_pick(state, index, "russell-westbrook", "PG")
    with pytest.raises(D.IllegalPlacement):
        D.reposition(state, index, 0, "PG", "SF")


def _okc_roll():
    from nba_peak.three_man_weave.schemas import Roll

    return Roll(
        round_number=1,
        franchise_id="OKC",
        franchise_display_name="Oklahoma City Thunder",
        decade="2010s",
        eligible_slugs=("russell-westbrook", "kevin-durant", "serge-ibaka"),
    )
