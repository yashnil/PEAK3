"""Franchise x decade eligibility and the scoring card it earns."""
from __future__ import annotations

import pytest

from nba_peak.daily_grid.constraints import FRANCHISES as FRANCHISES_VIA_DAILY_GRID
from nba_peak.franchises import (
    FRANCHISES,
    TEAM_CODE_TO_FRANCHISE,
    franchise_for_team_code,
    team_codes_for_franchise,
)
from nba_peak.three_man_weave.config import DECADES, decade_label, season_start_year
from nba_peak.three_man_weave.eligibility import (
    APPEARANCE_DIRECT,
    APPEARANCE_TRADED_STINT,
    MULTI_TEAM_CODES,
)


# ---------------------------------------------------------------------------
# The FRANCHISES promotion
# ---------------------------------------------------------------------------
def test_franchises_promotion_is_identical_through_both_import_paths():
    """The move to nba_peak.franchises was a relocation, not a revision."""
    assert FRANCHISES_VIA_DAILY_GRID is FRANCHISES
    assert len(FRANCHISES) == 30


@pytest.mark.parametrize(
    "historical_code,current_franchise",
    [
        ("SEA", "OKC"),  # Seattle SuperSonics -> Oklahoma City Thunder
        ("NJN", "BRK"),  # New Jersey Nets -> Brooklyn Nets
        ("CHH", "CHA"),  # 1988-2002 Charlotte Hornets -> today's Charlotte
        ("VAN", "MEM"),  # Vancouver Grizzlies -> Memphis Grizzlies
        ("WSB", "WAS"),  # Washington Bullets -> Washington Wizards
        ("KCK", "SAC"),  # Kansas City Kings -> Sacramento Kings
        ("SDC", "LAC"),  # San Diego Clippers -> Los Angeles Clippers
        ("NOK", "NOP"),  # New Orleans/OKC Hornets -> Pelicans
    ],
)
def test_relocations_resolve_to_the_current_franchise(historical_code, current_franchise):
    assert franchise_for_team_code(historical_code) == current_franchise
    assert historical_code in team_codes_for_franchise(current_franchise)


def test_new_orleans_is_a_separate_franchise_from_charlotte():
    """The documented editorial choice: CHH's history belongs to Charlotte,
    and the 2002+ New Orleans franchise is its own entry."""
    assert franchise_for_team_code("CHH") == "CHA"
    assert franchise_for_team_code("NOH") == "NOP"
    assert "CHH" not in team_codes_for_franchise("NOP")


def test_multi_team_aggregate_codes_resolve_to_no_franchise():
    """A "2TM" row is a season aggregate, not a team. It must never be
    guessed into one."""
    for code in MULTI_TEAM_CODES:
        assert franchise_for_team_code(code) is None
    assert franchise_for_team_code(None) is None
    assert franchise_for_team_code("NOT_A_TEAM") is None


def test_reverse_index_is_consistent_with_the_forward_table():
    for franchise_id, (_name, codes) in FRANCHISES.items():
        for code in codes:
            assert TEAM_CODE_TO_FRANCHISE[code] == franchise_id


# ---------------------------------------------------------------------------
# Decade bucketing
# ---------------------------------------------------------------------------
def test_decades_are_the_five_supported_labels():
    assert DECADES == ("1980s", "1990s", "2000s", "2010s", "2020s")


def test_the_1970s_bucket_is_excluded_not_folded_in():
    """1979-80 is the only season that would land in a "1970s" bucket. It has
    no decade here rather than being silently attributed to the 1980s."""
    assert decade_label(1979) is None
    assert decade_label(1980) == "1980s"


@pytest.mark.parametrize(
    "season,expected",
    [("1990-91", "1990s"), ("1999-00", "1990s"), ("2000-01", "2000s"), ("2025-26", "2020s")],
)
def test_bucketing_is_by_season_start_year(season, expected):
    assert decade_label(season_start_year(season)) == expected


def test_index_contains_no_1970s_roll(index):
    assert [roll for roll in index.rolls() if roll[1] == "1970s"] == []


# ---------------------------------------------------------------------------
# The two spec examples
# ---------------------------------------------------------------------------
def test_kawhi_leonard_is_eligible_for_raptors_2010s(index):
    """Eligibility is a membership fact -- one Toronto season is enough."""
    assert index.is_eligible("kawhi-leonard", "TOR", "2010s")
    evidence = index.evidence("kawhi-leonard", "TOR", "2010s")
    assert [appearance.season for appearance in evidence] == ["2018-19"]
    assert evidence[0].via == APPEARANCE_DIRECT
    assert evidence[0].team_code == "TOR"


def test_kawhi_scoring_card_is_his_best_2010s_season_anywhere(index):
    """Drafted on Toronto's evidence, scored on San Antonio's season -- the
    scoring card is decade-wide, never franchise-restricted."""
    card = index.scoring_card("kawhi-leonard", "2010s")
    assert card is not None
    assert card.season == "2016-17"
    assert card.team_code == "SAS"
    assert card.prime_score == pytest.approx(87.839, abs=1e-3)
    assert card.decade == "2010s"


def test_isaiah_thomas_is_eligible_for_celtics_2010s(index):
    assert index.is_eligible("isaiah-thomas", "BOS", "2010s")
    seasons = [appearance.season for appearance in index.evidence("isaiah-thomas", "BOS", "2010s")]
    assert "2015-16" in seasons and "2016-17" in seasons


def test_isaiah_thomas_boston_eligibility_includes_a_traded_stint(index):
    """His 2014-15 season is a "2TM" aggregate row; the stint supplement is
    what proves he really did play for Boston in it."""
    evidence = index.evidence("isaiah-thomas", "BOS", "2010s")
    stints = [appearance for appearance in evidence if appearance.via == APPEARANCE_TRADED_STINT]
    assert [appearance.season for appearance in stints] == ["2014-15"]


def test_isiah_and_isaiah_thomas_are_distinct_identities(index):
    """Two different players, two different slugs. Conflating them would put
    a Pistons legend in a 2010s Celtics pool."""
    assert index.is_eligible("isiah-thomas", "DET", "1980s")
    assert not index.is_eligible("isiah-thomas", "BOS", "2010s")
    assert not index.is_eligible("isaiah-thomas", "DET", "1980s")


# ---------------------------------------------------------------------------
# Franchise continuity through the index
# ---------------------------------------------------------------------------
def test_sonics_players_are_eligible_under_the_thunder(index):
    """Gary Payton never played a game for a team called the Thunder."""
    assert index.is_eligible("gary-payton", "OKC", "1990s")
    codes = {appearance.team_code for appearance in index.evidence("gary-payton", "OKC", "1990s")}
    assert codes == {"SEA"}


def test_franchises_absent_in_a_decade_have_no_roll(index):
    """Expansion franchises did not exist in every decade, and the index says
    so by having no entry rather than by returning an empty-but-present one."""
    for franchise_id, decade in [("TOR", "1980s"), ("MEM", "1980s"), ("NOP", "1990s")]:
        assert index.eligible_slugs(franchise_id, decade) == frozenset()


def test_grizzlies_2000s_include_vancouver_era_players(index):
    """MEM covers VAN, but Vancouver only existed from 1995-96, so its
    players surface in the 1990s and 2000s and never in the 1980s."""
    assert index.eligible_slugs("MEM", "1990s")
    assert index.eligible_slugs("MEM", "2000s")


# ---------------------------------------------------------------------------
# Scoring cards
# ---------------------------------------------------------------------------
def test_every_eligible_identity_has_a_scoring_card_in_that_decade(index):
    """Eligibility requires something to score -- an identity with no scored
    season in a decade is excluded from it at index-build time rather than
    being offered and then reported as 0.0."""
    for franchise_id, decade in index.rolls():
        for slug in index.eligible_slugs(franchise_id, decade):
            assert index.scoring_card(slug, decade) is not None


def test_scoring_card_is_the_decade_maximum(index):
    """LeBron's 2010s card is his best 2010s season, not his best overall
    (which is 2008-09, a 2000s season)."""
    twenty_tens = index.scoring_card("lebron-james", "2010s")
    two_thousands = index.scoring_card("lebron-james", "2000s")
    assert twenty_tens.season == "2012-13"
    assert two_thousands.season == "2008-09"
    assert two_thousands.prime_score > twenty_tens.prime_score


def test_scoring_card_carries_the_formula_version_it_speaks(index):
    """peak3_v1, matching the evaluator. The rankings surfaces serve peak3_v2
    and the two disagree; a card must say which it is."""
    card = index.scoring_card("michael-jordan", "1990s")
    assert card.formula_version == "peak3_v1"
    assert card.prime_score == pytest.approx(97.533, abs=1e-3)


def test_traded_scoring_cards_resolve_to_a_real_single_team(index):
    """A scoring card that lands on a traded season must still name one real
    team, because `resolve_player_season_card` rejects aggregate codes."""
    multi = [card for card in index._scoring.values() if card.is_multi_team_season]
    assert multi, "expected some decade-best seasons to be traded seasons"
    for card in multi:
        assert card.team_code in MULTI_TEAM_CODES
        assert franchise_for_team_code(card.resolve_team_id) is not None
        assert card.score_source == "exact_season_aggregate"


def test_untraded_scoring_cards_report_a_single_team_stint(index):
    card = index.scoring_card("michael-jordan", "1990s")
    assert not card.is_multi_team_season
    assert card.score_source == "exact_team_stint"
    assert card.resolve_team_id == card.team_code


# ---------------------------------------------------------------------------
# Shape of the index
# ---------------------------------------------------------------------------
def test_roll_space_covers_every_franchise_that_existed(index):
    """146 of the 150 franchise x decade cells are real. The four that are
    not are exactly the expansion gaps."""
    rolls = set(index.rolls())
    assert len(rolls) == 146
    absent = {
        (franchise_id, decade)
        for franchise_id in FRANCHISES
        for decade in DECADES
        if (franchise_id, decade) not in rolls
    }
    assert absent == {("MEM", "1980s"), ("NOP", "1980s"), ("NOP", "1990s"), ("TOR", "1980s")}


def test_rolls_are_returned_in_a_stable_sorted_order(index):
    """A seeded roll must not depend on dict insertion order."""
    assert list(index.rolls()) == sorted(index.rolls())


def test_index_is_cached_and_immutable_between_callers(index):
    from nba_peak.three_man_weave.eligibility import get_index

    assert get_index() is index
