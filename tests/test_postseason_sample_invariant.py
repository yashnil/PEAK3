"""Phase 10D: the postseason sample-reliability invariant, as an executable contract.

`peak3.py`'s postseason section states its own design contract in prose
(around the PO_REL_* constants):

    "... toward the league and cannot dwarf a Finals-length elite run."

and `postseason_value()`'s docstring promises that "availability is counted
ONCE (minutes reliability)". This file turns that prose into an assertion.

**Status: the invariant is currently VIOLATED, and the violation is
deliberately left in place.** The test below is `xfail(strict=True)`, so:

  - it does not break the suite today, and
  - the day someone fixes the formula it will XPASS and fail the run, forcing
    whoever fixed it to flip this marker and record the change. A silently
    "fixed" invariant is how the last round of this drift went unnoticed.

Why it is not fixed here
------------------------
Changing it requires changing `OFFICIAL_WEIGHTS`-adjacent scoring constants,
which per CLAUDE.md means (a) explicit approval, (b) regression evidence, and
(c) regenerating `leaderboards/*.csv`. It would also require editing expected
values inside the 235-test model suite, which CLAUDE.md prohibits outright
("Never weaken assertions or change expected values"). This phase's mandate
was model/data CORRECTNESS AUDIT, and a score-moving change to every playoff
season since 1980 is not something to land in the same pass as a candidate-
universe correction.

The measured defect
-------------------
`abs_level` (peak3.py, `postseason_value`) is `level_full - PO_BASELINE`
clipped only on the DOWNSIDE. `level_full` is built from per-minute playoff
rates (BPM/WS48/PER), which are unbounded on a tiny sample. `sample_reliab`
then shrinks it MULTIPLICATIVELY -- and a multiplicative shrink cannot bound
an unbounded quantity. Observed:

    Aaron Holiday 2021-22:  20 playoff minutes, abs_level 121.9,
                            reliability 0.245  ->  postseason value 40.18
    Matt Bullard  1996-97:   7 playoff minutes  ->  28.58
    Phil Ford     1982-83:   5 playoff minutes  ->  28.17

versus a median of 4.68 across all 295 Finals-length (700+ minute) runs. A
five-minute sample outscores the typical full playoff run by 6x.

Compounding it, 60% of `sample_reliab` is team-determined rather than a
property of the player's own sample: `PO_REL_W_G` (0.35) is games, and
`PO_REL_W_S` (0.25) is rounds the TEAM reached. Measured effect: for runs
under 300 playoff minutes those two terms lift reliability from a
minutes-only 0.165 to 0.272, a +65% relative inflation exactly where the
sample is thinnest.

Scope of the user-facing harm (why deferral is tolerable, not free)
-------------------------------------------------------------------
Postseason carries 0.18 of the index, so a 40-point postseason component on a
player with weak other components still lands at a 37 prime_score. None of the
extreme cases above reach a served board or any `leaderboards/*.csv`. The
served rows that DO carry a short-run boost are real stars with early playoff
exits (Giannis 2019-20 at 277 playoff minutes, Lillard 2020-21 at 248), where
a 20-23 point postseason value is elevated but not absurd. The 25 MPG serving
gate plus the 0.18 weight together contain it -- they do not correct it.

The specific fix, when it is approved
-------------------------------------
1. Bound the upside of `abs_level` with the module's OWN existing idiom,
   `_soft_above(level, knee)` -- a never-flat log tail, already used for
   exactly this purpose on `_impact_value`. This keeps LeBron 2017-18
   (abs_level 53.2) essentially unchanged while collapsing the 90-122 tail.
2. Shift `PO_REL_W_*` toward the player's own sample, e.g. 0.70 minutes /
   0.20 games / 0.10 series, or multiply `s_frac` by the player's share of
   team playoff minutes.
3. Regenerate `cache/processed/scored_1980_2026.parquet`, then diff rank 1 of
   all four `leaderboards/top_250_*.csv` and re-run the full 235-test suite
   before touching any expected value.
4. Flip the marker below.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"

TINY_RUN_MINUTES = 100      # a sample nobody would call a playoff run
FULL_RUN_MINUTES = 700      # Finals-length

pytestmark = pytest.mark.skipif(
    not SCORED_PATH.exists(),
    reason="requires cache/processed/scored_1980_2026.parquet",
)


def _postseason_runs() -> pd.DataFrame:
    scored = pd.read_parquet(SCORED_PATH)
    played = scored[scored["po_mp"] > 0].copy()
    played["po_total"] = (
        played["po_level_value"] + played["po_elevation_value"]
        + played["po_deep_run_value"] + played["po_dominance_value"]
    )
    return played


@pytest.mark.xfail(
    strict=True,
    reason="KNOWN, DEFERRED: abs_level is unbounded above and reliability only "
           "shrinks it multiplicatively. See this module's docstring for the "
           "measurements and the fix plan. If this XPASSes, the formula was "
           "changed -- update the marker and the docstring.",
)
def test_a_tiny_playoff_sample_cannot_outscore_a_finals_length_run():
    """peak3.py's stated contract: an extreme rate over a SHORT run "cannot
    dwarf a Finals-length elite run"."""
    runs = _postseason_runs()
    tiny = runs[runs["po_mp"] < TINY_RUN_MINUTES]
    full = runs[runs["po_mp"] >= FULL_RUN_MINUTES]
    assert len(tiny) > 100 and len(full) > 100, "both populations must be substantial"

    worst = tiny.loc[tiny["po_total"].idxmax()]
    assert worst["po_total"] <= full["po_total"].median(), (
        f"{worst['player']} {worst['season']} produced a postseason value of "
        f"{worst['po_total']:.2f} on {worst['po_mp']:.0f} playoff minutes, "
        f"against a median of {full['po_total'].median():.2f} across "
        f"{len(full)} Finals-length runs"
    )


def test_the_violation_is_still_the_size_this_audit_measured():
    """Characterization test. Not an endorsement -- it pins the CURRENT
    magnitude so the defect cannot quietly get worse while it is deferred,
    and so the report's numbers stay checkable."""
    runs = _postseason_runs()
    tiny = runs[runs["po_mp"] < TINY_RUN_MINUTES]
    full = runs[runs["po_mp"] >= FULL_RUN_MINUTES]

    assert tiny["po_total"].max() == pytest.approx(40.18, abs=0.5)
    assert full["po_total"].median() == pytest.approx(4.68, abs=0.5)
    # Only a handful of tiny runs clear the full-run 75th percentile. If this
    # grows, the tail got worse.
    assert (tiny["po_total"] > full["po_total"].quantile(0.75)).sum() <= 10


def test_reliability_is_majority_team_determined():
    """`PO_REL_W_G` + `PO_REL_W_S` = 0.60 of the reliability weight, and both
    are properties of how far the TEAM advanced rather than of the player's
    own observed sample. Pinned so a future rebalance is a visible edit."""
    import peak3 as P

    assert P.PO_REL_W_MIN + P.PO_REL_W_G + P.PO_REL_W_S == pytest.approx(1.0)
    team_determined = P.PO_REL_W_G + P.PO_REL_W_S
    assert team_determined == pytest.approx(0.60)
    assert team_determined > P.PO_REL_W_MIN, (
        "documented as a known weakness; if this is ever rebalanced toward "
        "minutes, update tests/test_postseason_sample_invariant.py and "
        "docs/implementation/PHASE_9B_RANKINGS_AUDIT.md"
    )


def test_short_run_reliability_is_inflated_by_the_team_terms():
    """Quantifies the inflation rather than asserting it exists: for runs
    under 300 playoff minutes, the team-derived terms raise reliability well
    above what the player's own minutes support."""
    import numpy as np

    import peak3 as P

    runs = _postseason_runs()
    short = runs[runs["po_mp"] < 300]
    minutes_only = np.clip(short["po_mp"] / P.PO_REL_MIN_FULL, 0.0, 1.0)
    lift = (short["po_sample_reliab"] - minutes_only).mean()
    assert lift > 0.05, "the team terms should measurably lift short-run reliability"
    assert lift == pytest.approx(0.107, abs=0.02)


def test_the_extreme_cases_do_not_reach_a_served_board():
    """The reason this is deferrable rather than urgent. If a future change
    lets these seasons onto a ranked surface, the deferral stops being safe
    and this fails."""
    import json

    pool_dir = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
    seasons_path = pool_dir / "top_1000_seasons.v1.json"
    if not seasons_path.exists():
        pytest.skip("ranking artifacts not generated")

    runs = _postseason_runs()
    extreme = runs[(runs["po_mp"] < TINY_RUN_MINUTES) & (runs["po_total"] > 20)]
    assert len(extreme) > 0, "the characterization above says these exist"

    served = {
        (r["player_name"], r["season"])
        for r in json.loads(seasons_path.read_text())["rows"]
    }
    leaked = sorted(set(zip(extreme["player"], extreme["season"])) & served)
    assert leaked == [], f"tiny-sample postseason inflation reached the served board: {leaked}"
