"""TMW-03: the franchise x decade candidate pool is complete and explained.

WHAT THESE TESTS PROTECT
------------------------
`scripts/audit_three_man_weave_pool.py` sweeps all 30 franchises x 5 decades and
compares the identities the canonical season records place on each roll against
the identities `EligibilityIndex` actually offers there. These tests pin the
result of that sweep, so a data or logic regression that silently drops
identities fails here instead of being discovered by a player who cannot find
someone they watched play.

WHY A PINNED NUMBER RATHER THAN A THRESHOLD
--------------------------------------------
`missing` is pinned exactly, not bounded. A bound ("no more than N missing")
tolerates drift in both directions and would have let the original defect
through. The pinned number is a measurement of a fixed, committed dataset, and
if that dataset changes the pin should change with it -- deliberately, in a
commit that says so, with the audit re-run.

RUNTIME
-------
The audit reads two parquets and a 13.6k-row JSON. Both are loaded ONCE per
module (`report` is module-scoped and takes the session-scoped `index`
fixture), so the whole file runs in a couple of seconds rather than rebuilding
a 150-combination sweep per test.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from nba_peak.franchises import team_codes_for_franchise  # noqa: E402
from nba_peak.three_man_weave.config import DECADES, decade_label  # noqa: E402
from scripts.audit_three_man_weave_pool import (  # noqa: E402
    REASON_BELOW_QUALIFIER,
    all_combinations,
    build_expected,
    build_report,
    load_canonical_seasons,
    load_traded_stints,
)

# ---------------------------------------------------------------------------
# The pinned measurement.
#
# Measured against the committed sources on 2026-08-06:
#   data/game/experimental/player_pool_1500/all_seasons_for_identities.v1.json
#   data/game/experimental/player_pool_1500/traded_player_team_stints.v1.json
#   cache/processed/scored_1980_2026.parquet
#
# EVERY ONE of the 1,905 missing identity x combination pairs is missing for a
# single evidenced reason: `below_peak3_minutes_qualifier`. The season exists in
# the raw per-season table but its minutes fall under
# `peak3.regular_minutes_threshold(season_end)` (1,000 minutes over an 82-game
# season), so PEAK3 produced no `prime_score` for it FOR ANY TEAM. An identity
# with nothing to score has nothing to draft -- see eligibility.py's "UNSCORED
# IDENTITIES" note. The other four reason categories the audit checks for
# (`season_scored_only_under_another_team_code`,
# `season_absent_from_regular_source`, `season_outside_scored_window`,
# `unscored_season`) are all ZERO, and a non-zero count in any of them is a real
# finding rather than a number to re-pin.
#
# If a pin below moves, do not adjust it to make the suite green. Re-run
#   python scripts/audit_three_man_weave_pool.py --write
# read what changed, and update the pin and the committed report together.
# ---------------------------------------------------------------------------
EXPECTED_COMBINATIONS = 150
EXPECTED_IDENTITY_PAIRS = 6656
ACTUAL_IDENTITY_PAIRS = 4751
MISSING_PAIRS = 1905
EXTRA_PAIRS = 0


@pytest.fixture(scope="module")
def report(index):
    """One audit sweep, shared by every test in this file."""
    return build_report(index=index)


@pytest.fixture(scope="module")
def expected_pool():
    """The audit's independently-derived expected pool, without the index."""
    return build_expected(load_canonical_seasons(), load_traded_stints())


# ---------------------------------------------------------------------------
# The named regression
# ---------------------------------------------------------------------------
def test_dennis_rodman_is_discoverable_for_the_spurs_in_the_1990s(index):
    """The spec's named regression, asserted at the grain the game rolls at.

    Both halves matter and were separately broken-able: being ON the SAS x 1990s
    board is one claim, and being SCORED on a Spurs season of that decade is
    another. A pool that offered him but scored him on a 1995-96 Bulls season
    would pass a naive membership check and still be the bug this ruleset
    exists to close.
    """
    assert index.is_eligible("dennis-rodman", "SAS", "1990s"), (
        "Dennis Rodman is absent from the San Antonio Spurs x 1990s pool. He played "
        "1993-94 and 1994-95 for the Spurs; the canonical season records say so."
    )

    card = index.scoring_card("dennis-rodman", "SAS", "1990s")
    assert card is not None, "eligible with no scoring card -- the two must never disagree"
    assert card.season in {"1993-94", "1994-95"}
    assert card.resolve_team_id in team_codes_for_franchise("SAS")
    assert card.franchise_id == "SAS"
    assert decade_label(card.season_start) == "1990s"
    assert card.prime_score > 0.0
    # A real single-team Spurs row, not a traded-season aggregate borrowed from
    # elsewhere: the number and the badge describe the same team.
    assert card.is_multi_team_season is False
    assert card.score_source == "exact_team_stint"


def test_rodmans_eligibility_evidence_is_real_spurs_seasons(index):
    evidence = index.evidence("dennis-rodman", "SAS", "1990s")
    assert evidence, "no evidence behind an eligibility claim"
    for appearance in evidence:
        assert appearance.franchise_id == "SAS"
        assert appearance.team_code in team_codes_for_franchise("SAS")
        assert appearance.decade == "1990s"


def test_rodman_is_only_offered_on_franchises_he_actually_played_for(index):
    """The mirror of the regression: he must not leak onto other rolls.

    Fixing a missing identity by loosening the franchise constraint would make
    this fail, which is why it is asserted next to the one above.
    """
    rolls = {(f, d) for f, d in index.rolls() if index.is_eligible("dennis-rodman", f, d)}
    assert rolls == {
        ("DET", "1980s"),
        ("DET", "1990s"),
        ("SAS", "1990s"),
        ("CHI", "1990s"),
        ("LAL", "1990s"),
    }


# ---------------------------------------------------------------------------
# The sweep
# ---------------------------------------------------------------------------
def test_every_franchise_decade_combination_is_audited(report):
    totals = report["totals"]
    assert totals["franchises"] == 30
    assert totals["decades"] == len(DECADES) == 5
    assert totals["combinations"] == EXPECTED_COMBINATIONS == len(all_combinations())
    # Enumerated from the franchise table, NOT from the index's own rolls(): a
    # combination the index dropped entirely must still be audited, or the hole
    # hides itself.
    assert totals["combinations_with_pool_members"] == 146
    assert len(report["empty_combinations"]) == 4


def test_the_four_empty_combinations_are_franchises_that_did_not_exist(report):
    empty = {(c["franchise_id"], c["decade"]) for c in report["empty_combinations"]}
    assert empty == {
        ("MEM", "1980s"),  # Vancouver Grizzlies' first season was 1995-96
        ("NOP", "1980s"),  # the New Orleans franchise begins 2002-03
        ("NOP", "1990s"),
        ("TOR", "1980s"),  # Raptors' first season was 1995-96
    }


def test_no_extra_identities_anywhere(report):
    """Zero identities offered that the canonical record does not support.

    A LOUDER FAILURE THAN A MISSING ONE. A missing identity is an incomplete
    board; an extra identity is the game asserting someone played for a team
    the source does not place them on.
    """
    assert report["totals"]["extra_pairs"] == EXTRA_PAIRS
    assert report["extra_pairs_detail"] == []
    assert all(combination["extra"] == 0 for combination in report["per_combination"])


def test_missing_identities_are_pinned_and_every_one_is_explained(report):
    totals = report["totals"]
    assert totals["expected_identity_pairs"] == EXPECTED_IDENTITY_PAIRS
    assert totals["actual_identity_pairs"] == ACTUAL_IDENTITY_PAIRS
    # See the module-level pin comment: all 1,905 fall in one evidenced
    # category, and a change here is a data regression to investigate rather
    # than a number to re-pin.
    assert totals["missing_pairs"] == MISSING_PAIRS
    assert report["missing_by_reason"] == {REASON_BELOW_QUALIFIER: MISSING_PAIRS}
    assert report["unexplained_missing"] == []


def test_the_audit_ran_with_the_fine_grained_reason_evidence_available(report):
    """The precise reason requires `cache/processed/regular_1980_2026.parquet`.

    Without it the audit degrades honestly to the coarse `unscored_season`
    label -- which would make the pin above meaningless, so the pinned run is
    asserted to be the precise one.
    """
    assert report["reason_evidence_available"] is True
    assert report["sources"]["regular"] == "cache/processed/regular_1980_2026.parquet"


def test_every_missing_identity_carries_its_own_evidence(report):
    """Not just a count: each missing pair names the seasons behind the verdict."""
    reasons = {r["reason"] for r in report["missing_examples_by_reason"][REASON_BELOW_QUALIFIER]}
    assert reasons == {REASON_BELOW_QUALIFIER}
    for record in report["missing_examples_by_reason"][REASON_BELOW_QUALIFIER]:
        assert record["seasons"], "a missing verdict with no seasons behind it"
        assert record["player_name"]
        assert record["franchise_id"] and record["decade"]


def test_missing_seasons_are_not_all_cameos(report):
    """The category is honestly characterised, including its uncomfortable part.

    Most missing pairs are short stints, but not all: some played a full season
    under the minutes bar. The audit reports that split rather than letting
    "they barely played" stand for the whole category.
    """
    buckets = report["missing_by_season_completeness"]
    assert sum(buckets.values()) == MISSING_PAIRS
    assert buckets["70_or_more_games"] > 0
    assert buckets["under_20_games"] > buckets["70_or_more_games"]


def test_every_pool_identity_has_a_card_for_the_roll_it_appears_on(index):
    """Eligibility and a scoring card are the same fact, per roll.

    An identity on the board with no card would reach the evaluator with
    nothing to score; the check is cheap enough to run over the whole pool.
    """
    for franchise_id, decade in index.rolls():
        for player_slug in index.eligible_slugs(franchise_id, decade):
            card = index.scoring_card(player_slug, franchise_id, decade)
            assert card is not None, f"{player_slug} on {franchise_id} x {decade} has no card"
            assert card.franchise_id == franchise_id
            assert card.decade == decade
            assert card.resolve_team_id in team_codes_for_franchise(franchise_id)


# ---------------------------------------------------------------------------
# Franchise canonicalisation / relocation
# ---------------------------------------------------------------------------
@pytest.mark.parametrize(
    "historical_code, franchise_id, sample_slug, decade",
    [
        ("SEA", "OKC", "gary-payton", "1990s"),
        ("VAN", "MEM", "shareef-abdur-rahim", "1990s"),
        ("NOH", "NOP", "chris-paul", "2000s"),
        ("NOK", "NOP", "bobby-jackson", "2000s"),
        ("CHH", "CHA", "alonzo-mourning", "1990s"),
        ("NJN", "BRK", "jason-kidd", "2000s"),
        ("WSB", "WAS", "bernard-king", "1990s"),
        ("SDC", "LAC", "bill-walton", "1980s"),
        ("KCK", "SAC", "reggie-theus", "1980s"),
    ],
)
def test_relocations_fold_into_the_modern_franchise_in_the_expected_set(
    expected_pool, index, historical_code, franchise_id, sample_slug, decade
):
    """Relocation folding is reflected in EXPECTED, not only in the pool.

    Asserted on the audit's independently-built expected set as well as on the
    index. If only the index folded relocations, `expected` would under-count
    and `missing` would look artificially clean -- the audit would be grading
    itself on the wrong answer key.
    """
    assert sample_slug in expected_pool.by_roll[(franchise_id, decade)]
    assert index.is_eligible(sample_slug, franchise_id, decade)
    appearances = expected_pool.appearances[(sample_slug, franchise_id, decade)]
    assert any(a.team_code == historical_code for a in appearances), (
        f"{sample_slug} has no {historical_code} appearance folded into {franchise_id}"
    )


def test_new_orleans_and_charlotte_are_distinct_franchises(expected_pool, index):
    """NOH/NOK -> NOP must never be conflated with CHH/CHO -> CHA.

    These two share a city's worth of history in fan memory and none in the
    franchise table: the 1988-2002 Charlotte Hornets belong to today's
    Charlotte franchise, and the 2002+ New Orleans franchise is its own entry.
    Folding them together would put Chris Paul on a Charlotte roll.
    """
    assert "chris-paul" in expected_pool.by_roll[("NOP", "2000s")]
    assert "chris-paul" not in expected_pool.by_roll.get(("CHA", "2000s"), frozenset())
    assert index.is_eligible("chris-paul", "NOP", "2000s")
    assert not index.is_eligible("chris-paul", "CHA", "2000s")

    # The reverse direction: the 1990s Charlotte Hornets belong to CHA, and
    # New Orleans has no pool at all before 2002-03.
    assert "alonzo-mourning" in expected_pool.by_roll[("CHA", "1990s")]
    assert ("NOP", "1990s") not in expected_pool.by_roll
    assert index.eligible_slugs("NOP", "1990s") == frozenset()


def test_no_historical_team_code_fails_to_fold(report):
    """Every alias with canonical rows produces a discoverable identity."""
    surface = report["relocation_surface"]
    assert surface["unfolded"] == []
    for entry in surface["entries"]:
        if entry["canonical_rows"]:
            assert entry["discoverable_example"] is not None, entry["historical_team_code"]


# ---------------------------------------------------------------------------
# Mid-season trades
# ---------------------------------------------------------------------------
def test_a_traded_player_is_discoverable_for_both_franchises(expected_pool, index):
    """Pau Gasol's 2007-08 season: 39 games Memphis, 27 games LA, one decade.

    The canonical source records that season as a `2TM` aggregate row, so it
    names NEITHER team. The stints file is what resolves it, and if that
    expansion were dropped the season would establish nothing for either
    franchise -- a real Grizzlies-to-Lakers trade would leave both boards
    unaware it happened.
    """
    memphis = expected_pool.appearances[("pau-gasol", "MEM", "2000s")]
    lakers = expected_pool.appearances[("pau-gasol", "LAL", "2000s")]

    assert any(a.season == "2007-08" and a.via_traded_stint for a in memphis)
    assert any(a.season == "2007-08" and a.via_traded_stint for a in lakers)
    # The row that carried it really was an aggregate token, which is exactly
    # what makes the stint expansion load-bearing rather than decorative.
    assert {a.recorded_team for a in memphis if a.season == "2007-08"} == {"2TM"}

    assert index.is_eligible("pau-gasol", "MEM", "2000s")
    assert index.is_eligible("pau-gasol", "LAL", "2000s")

    # Both sides score on their OWN franchise's season -- never each other's.
    for franchise_id in ("MEM", "LAL"):
        card = index.scoring_card("pau-gasol", franchise_id, "2000s")
        assert card is not None
        assert card.franchise_id == franchise_id
        assert card.resolve_team_id in team_codes_for_franchise(franchise_id)
        assert decade_label(card.season_start) == "2000s"


def test_a_traded_season_card_resolves_to_the_rolled_franchise(index):
    """Clyde Drexler's 1994-95 was 41 Portland games and 35 Houston games.

    Houston's card for him IS that traded season, so it is the case where the
    score is only available at whole-season aggregate grain. The number must
    still resolve to Houston's own team code and be labelled as an aggregate
    rather than presented as a single-team figure.
    """
    card = index.scoring_card("clyde-drexler", "HOU", "1990s")
    assert card is not None
    assert card.season == "1994-95"
    assert card.is_multi_team_season is True
    assert card.score_source == "exact_season_aggregate"
    assert card.resolve_team_id == "HOU"
    assert card.team_code not in team_codes_for_franchise("POR")


def test_the_stint_expansion_carries_real_weight(report):
    """Quantifies what would be lost if aggregate rows were simply dropped."""
    traded = report["traded_surface"]
    assert traded["pairs_established_only_by_a_traded_stint"] > 500
    assert traded["of_those_eligible"] > 0
    assert traded["split_seasons_eligible_on_every_side"] > 0


# ---------------------------------------------------------------------------
# Search / normalisation surface
# ---------------------------------------------------------------------------
def test_suffix_punctuation_and_diacritic_identities_are_all_discoverable(report):
    """Every name-shaped edge case in the pool round-trips to its slug.

    A slug that its own display name does not fold to is unreachable by
    anything a player can type, which is the same class of defect as being
    missing from the pool -- it is just invisible from the counts.
    """
    surface = report["search_surface"]
    for group in ("suffix", "punctuation_derived", "apostrophe_o_prefix"):
        assert surface[group]["count"] > 0, f"{group} has no members -- check the detector"
        assert surface[group]["undiscoverable"] == [], surface[group]["undiscoverable"]
    assert surface["diacritics_in_display_name"]["undiscoverable"] == []


def test_the_apostrophe_derived_forms_include_the_obvious_ones(report):
    slugs = {entry["player_slug"] for entry in report["search_surface"]["apostrophe_o_prefix"]["examples"]}
    assert {"shaquille-o-neal", "jermaine-o-neal"} <= slugs


# ---------------------------------------------------------------------------
# The audit script's own contract
# ---------------------------------------------------------------------------
def test_the_report_names_the_command_that_regenerates_it(report):
    assert report["regenerate_command"] == (
        "python scripts/audit_three_man_weave_pool.py --write"
    )
    assert report["sources"]["canonical_seasons"].endswith("all_seasons_for_identities.v1.json")
    assert report["sources"]["traded_stints"].endswith("traded_player_team_stints.v1.json")


def test_the_expected_set_drops_nothing_silently(expected_pool):
    """Every unplaceable row is both counted and listed.

    A dropped row is a claim about the source's completeness; a claim a reader
    cannot check is not evidence.
    """
    dropped_total = sum(
        count
        for key, count in expected_pool.dropped.items()
        if key != "season_before_min_season_start"
    )
    assert dropped_total == len(expected_pool.unresolved_rows)
    for row in expected_pool.unresolved_rows:
        assert row["player_slug"] and row["season"] and row["why"]
