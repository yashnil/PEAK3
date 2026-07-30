"""Phase 10D: candidate-universe inclusion criteria.

Guards `scripts/audit_player_pool_expansion.py` and the manifest it writes
(`data/game/experimental/player_pool_1500/candidate_identity_manifest.v1.json`).
Before this pass the whole path had no test coverage at all: nothing asserted
what the gate's semantics were, whether the manifest's self-reported counts
agreed with its own per-identity tags, or whether a criterion named for a
per-game scoring average actually measured one.

The two real defects these tests lock down:

  1. `15_ppg` compared a per-POSSESSION rate against a per-GAME threshold.
     `pts_per75` is exactly `pts_per100 * 0.75`, so the v0 -> v1 "fix" only
     rescaled the same rate. Efficient bench scorers were admitted under a
     criterion named for a starter's volume (Luka Garza, 16.2 MPG, entered on
     `["15_ppg"]` alone).

  2. The manifest tagged `25_mpg_fallback` on every identity whose 25-MPG flag
     was true (1,206 of 1,510) while simultaneously reporting
     `fallback_25mpg_count: 0` -- the tags and the count contradicted.

Deliberately NOT asserted here: that the primary gate is an AND.
docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md Sec 2.0 says "matches
at least one of" and lists "averaged 30+ MPG in any season" as one of those
routes. The OR is the specification. See test_primary_gate_is_an_or_chain.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from scripts.audit_player_pool_expansion import (  # noqa: E402
    CRITERIA_LOGIC,
    CRITERION_LABELS,
    MIN_MPG_FALLBACK,
    MIN_MPG_PRIMARY,
    MIN_PPG,
    PPG_EST_ACCURACY,
    SCORED_PATH,
    compute_criteria,
)

MANIFEST_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
    / "candidate_identity_manifest.v1.json"
)

# Real per-game scoring averages, hand-verified, spanning 1980-2026 and every
# role tier from a 37-PPG scoring title to a 7-PPG defensive specialist. These
# are the ground truth the estimator is measured against -- the point of the
# sample is its SPREAD (eras, paces, minutes loads), not its size.
KNOWN_REAL_PPG = [
    ("Stephen Curry", "2015-16", 30.1), ("Michael Jordan", "1986-87", 37.1),
    ("Michael Jordan", "1990-91", 31.5), ("Kobe Bryant", "2005-06", 35.4),
    ("Kobe Bryant", "2007-08", 28.3), ("LeBron James", "2012-13", 26.8),
    ("Shaquille O'Neal", "1999-00", 29.7), ("Hakeem Olajuwon", "1993-94", 27.3),
    ("David Robinson", "1994-95", 27.6), ("Larry Bird", "1987-88", 29.9),
    ("Magic Johnson", "1986-87", 23.9), ("Joel Embiid", "2022-23", 33.1),
    ("Dwight Howard", "2008-09", 20.6), ("Jaylen Brown", "2023-24", 23.0),
    ("Deandre Ayton", "2020-21", 14.4), ("Gary Payton II", "2021-22", 7.1),
    ("Isaiah Hartenstein", "2023-24", 7.8), ("Joe Dumars", "1992-93", 23.5),
    ("Zach LaVine", "2020-21", 27.4), ("Dennis Rodman", "1991-92", 9.8),
    ("Karl Malone", "1996-97", 27.4), ("Allen Iverson", "2005-06", 33.0),
    ("Tim Duncan", "2001-02", 25.5), ("Kevin Durant", "2013-14", 32.0),
    ("Steve Nash", "2004-05", 15.5), ("Ben Wallace", "2003-04", 9.5),
    ("Manu Ginobili", "2006-07", 16.5), ("Rudy Gobert", "2018-19", 15.9),
    ("Draymond Green", "2015-16", 14.0), ("Nikola Jokic", "2021-22", 27.1),
]

pytestmark = pytest.mark.skipif(
    not SCORED_PATH.exists() or not MANIFEST_PATH.exists(),
    reason="requires cache/processed/scored_1980_2026.parquet and the generated manifest",
)


@pytest.fixture(scope="module")
def scored() -> pd.DataFrame:
    return pd.read_parquet(SCORED_PATH)


@pytest.fixture(scope="module")
def manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text())


# ---------------------------------------------------------------------------
# The PPG criterion -- rate vs volume
# ---------------------------------------------------------------------------

def test_pts_per75_is_only_a_rescale_of_pts_per100(scored):
    """The premise of the whole fix. `pts_per75` carries no information that
    `pts_per100` does not, so switching between them (the v0 -> v1 "PPG
    criterion fixed" change) could not possibly have corrected a
    rate-vs-volume confusion -- it only moved the effective threshold."""
    ratio = (scored["pts_per100"] / scored["pts_per75"]).dropna()
    assert len(ratio) > 10_000
    assert np.allclose(ratio, 4.0 / 3.0), (
        "pts_per75 is expected to be exactly 0.75 * pts_per100; if this ever "
        "becomes a genuinely independent per-75 statistic, the PPG criterion "
        "should be revisited"
    )


def test_ppg_estimator_accuracy_on_known_seasons(scored):
    """The estimated-PPG conversion is only defensible if its error is
    MEASURED. This re-derives the figures published in the manifest's
    `ppg_estimator_accuracy` block, so those numbers cannot silently rot."""
    errors = []
    for player, season, real_ppg in KNOWN_REAL_PPG:
        row = scored[(scored["player"] == player) & (scored["season"] == season)]
        assert not row.empty, f"{player} {season} missing from the scored parquet"
        est = float(row.iloc[0]["pts_per100"]) * float(row.iloc[0]["mpg"]) / 48.0
        errors.append(est - real_ppg)
    errors = np.array(errors)

    assert len(errors) == PPG_EST_ACCURACY["validation_sample_size"]
    assert np.abs(errors).mean() == pytest.approx(
        PPG_EST_ACCURACY["mean_absolute_error_ppg"], abs=0.05)
    assert errors.mean() == pytest.approx(PPG_EST_ACCURACY["mean_bias_ppg"], abs=0.05)
    # The published claim is that the residual is small and biased PERMISSIVE
    # (over-admitting at the margin beats silently dropping a real scorer).
    assert np.abs(errors).mean() < 2.0
    assert (errors > 0).mean() >= 0.85


def test_ppg_criterion_measures_volume_not_rate(scored):
    """A rate criterion admits efficient bench players; a volume criterion
    cannot. Nobody averages 15 points a game on a bench workload."""
    scored = scored.copy()
    scored["ppg_est"] = scored["pts_per100"] * scored["mpg"] / 48.0

    by_rate = scored[scored["pts_per75"] >= MIN_PPG]
    by_volume = scored[scored["ppg_est"] >= MIN_PPG]

    # The old rate gate let sub-25-MPG seasons through in bulk.
    assert len(by_rate[by_rate["mpg"] < 25.0]) > 1000
    # The corrected gate cannot: 15 PPG implies a real workload, as an
    # arithmetic consequence rather than an added minutes filter.
    assert by_volume["mpg"].min() >= 20.0
    assert len(by_volume) < len(by_rate)


def test_luka_garza_no_longer_qualifies_on_scoring(scored):
    """The canonical case. Garza's 2025-26 was the manifest's clean proof of
    the defect: `qualifying_criteria: ["15_ppg"]` on a 16.2 MPG bench season
    with no awards. His estimated scoring is nowhere near 15 PPG."""
    row = scored[(scored["player"] == "Luka Garza") & (scored["season"] == "2025-26")]
    assert not row.empty
    r = row.iloc[0]
    assert r["mpg"] < 20.0
    assert r["pts_per75"] >= MIN_PPG, "the OLD rate criterion did admit him"
    ppg_est = float(r["pts_per100"]) * float(r["mpg"]) / 48.0
    assert ppg_est < 10.0, "the CORRECTED volume criterion must not"


# ---------------------------------------------------------------------------
# Gate semantics
# ---------------------------------------------------------------------------

def test_primary_gate_is_an_or_chain(scored):
    """Regression guard on the OR/AND question, in the direction the
    specification actually points.

    PHASE_9B_RANKINGS_AUDIT.md Sec 4 called the OR a bug and proposed
    `(award | ppg) & (mpg_30 | mpg_25)`. That contradicts
    PHASE_5X_PLAYER_EXPANSION_STRATEGY.md Sec 2.0 ("matches at least one of",
    with 30+ MPG listed as one of the routes). This test pins the OR so that
    changing it to an AND is a deliberate, spec-changing act rather than a
    drive-by "fix" -- an AND would eject All-Stars and MVP vote-getters whose
    award season fell below 30 MPG, which is not what anyone wants.
    """
    assert CRITERIA_LOGIC["primary"] == "OR"
    assert "30_mpg" in CRITERIA_LOGIC["primary_routes"]

    sample = scored[scored["player"].isin(scored["player"].unique()[:400])]
    criteria = compute_criteria(sample, sample)  # `regular` is unused, see compute_criteria
    award_only = criteria[
        criteria["crit_all_star"] & ~criteria["crit_30_mpg"] & ~criteria["crit_15_ppg"]
    ]
    if len(award_only):
        assert award_only["qualifies_primary"].all(), (
            "an All-Star must qualify on the award alone, without also having to "
            "clear a minutes bar"
        )


def test_zero_fallback_count_is_not_evidence_of_a_bug():
    """`fallback_25mpg_count == 0` means the primary routes cleared the
    target. Phase 9B read that zero as the manifest's own proof of a bug; it
    is the documented behaviour of a tiered fallback."""
    assert "only applied" in CRITERIA_LOGIC["fallback_condition"].lower() or \
           "only when" in CRITERIA_LOGIC["fallback_condition"].lower()
    assert MIN_MPG_FALLBACK < MIN_MPG_PRIMARY


def test_ranking_universe_is_documented_as_separate_from_this_pool():
    """A CourtBuilder candidate is not a ranked PEAK Index entry. The manifest
    must say so, because that distinction is what makes it correct for Gary
    Payton II to be in the pool and absent from the rankings."""
    scope = CRITERIA_LOGIC["scope"]
    assert "MIN_SERVED_ANCHOR_MPG" in scope
    assert "MIN_SERVED_SEASON_MPG" in scope


# ---------------------------------------------------------------------------
# Manifest internal consistency
# ---------------------------------------------------------------------------

def test_manifest_counts_reconcile(manifest):
    ids = manifest["identities"]
    assert manifest["final_identity_count"] == len(ids)
    assert (manifest["primary_criteria_count"] + manifest["fallback_25mpg_count"]
            == manifest["final_identity_count"])
    assert manifest["reached_target_identities"] == (
        manifest["final_identity_count"] >= manifest["target_identities"])


def test_every_identity_has_at_least_one_criterion(manifest):
    """No identity may sit in the pool without a stated admission route."""
    orphans = [i["player_slug"] for i in manifest["identities"]
               if not i["qualifying_criteria"]]
    assert orphans == [], f"identities with no qualifying criterion: {orphans[:10]}"


def test_fallback_tag_matches_fallback_count(manifest):
    """THE regression test for defect 2. Previously 1,206 identities carried
    the `25_mpg_fallback` tag while the manifest reported
    `fallback_25mpg_count: 0`."""
    tagged = [i for i in manifest["identities"]
              if "25_mpg_fallback" in i["qualifying_criteria"]]
    assert len(tagged) == manifest["fallback_25mpg_count"]
    for i in tagged:
        assert i["admitted_via"] == "25_mpg_fallback"
        assert i["qualifying_criteria"] == ["25_mpg_fallback"], (
            f"{i['player_slug']} was admitted via the fallback tier but also "
            "lists primary criteria -- the fallback is for identities NO "
            "primary route admitted"
        )


def test_manifest_uses_the_corrected_criterion_name(manifest):
    """`15_ppg` promised a per-game average and delivered a rate. The name
    must not reappear."""
    assert "15_ppg_est" in CRITERION_LABELS
    assert "15_ppg" not in CRITERION_LABELS
    used = {c for i in manifest["identities"] for c in i["qualifying_criteria"]}
    assert "15_ppg" not in used
    assert "15_ppg_est" in used
    for i in manifest["identities"]:
        for season_hits in i["season_criteria"].values():
            assert "15_ppg" not in season_hits


def test_manifest_criteria_are_all_declared(manifest):
    """Every criterion a player is admitted on must have a published
    definition -- no undocumented admission routes."""
    used = {c for i in manifest["identities"] for c in i["qualifying_criteria"]}
    assert used <= set(CRITERION_LABELS), f"undeclared criteria: {used - set(CRITERION_LABELS)}"
    assert used <= set(CRITERIA_LOGIC["primary_routes"]) | {CRITERIA_LOGIC["fallback_route"]}


def test_manifest_publishes_the_ppg_estimator_and_its_error(manifest):
    """The estimate is only acceptable BECAUSE it ships with its error bars.
    If a future revision drops them, the criterion stops being defensible."""
    assert "pts_per100" in manifest["ppg_estimator"]
    acc = manifest["ppg_estimator_accuracy"]
    assert acc["mean_absolute_error_ppg"] < 2.0
    assert acc["validation_sample_size"] >= 25
    assert "NOT a measured value" in manifest["ppg_caveat"]


def test_known_role_players_are_admitted_honestly_or_not_at_all(manifest):
    """Bench players may legitimately be CourtBuilder candidates via the
    championship/Finals rotation routes -- that is Sec 2.0's Cohort B, and
    82-0 needs them for historically accurate rosters. What they must never
    do is enter through a SCORING criterion."""
    by_slug = {i["player_slug"]: i for i in manifest["identities"]}

    assert "luka-garza" not in by_slug, (
        "Garza's only route was the broken rate criterion; with it corrected "
        "he satisfies no documented criterion"
    )
    for slug in ("gary-payton-ii", "isaiah-hartenstein", "daniel-gafford"):
        entry = by_slug.get(slug)
        assert entry is not None, f"{slug} should remain a roster-eligible candidate"
        assert "15_ppg_est" not in entry["qualifying_criteria"], (
            f"{slug} must not be admitted as a 15-PPG scorer"
        )
        assert any(c.endswith("_starter_approx") for c in entry["qualifying_criteria"]), (
            f"{slug} should be admitted through the championship/Finals rotation route"
        )
