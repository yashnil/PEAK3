"""postseason_value_v2 — the calibration contract.

These are written as PROPERTIES, not as per-player expected scores. That is
deliberate and it is the point: a test file full of "Klay Thompson 2014-15 must
equal 10.09" would BE the hidden player-specific exception rule G forbids --
the formula would then be whatever makes the famous names come out right.

So the named cases from the Phase 12B review are asserted only against
properties that follow from the design ("a full-minutes title run is not
negative", "a longer run at similar quality outscores a shorter one"), and the
aggregate targets are asserted as rates over the whole population.

See docs/model/PEAK3_V2_FORMULA_DESIGN.md and PEAK3_V2_BLAST_RADIUS.md.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import peak3 as P

REPO_ROOT = Path(__file__).resolve().parent.parent
V1_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
_MULTI_TEAM = {"2TM", "3TM", "4TM", "5TM", "TOT"}


@pytest.fixture(scope="module")
def playoffs() -> pd.DataFrame:
    """Every playoff player-season, with v1 and v2 postseason values side by
    side plus v2's component parts."""
    if not V1_PATH.exists():
        pytest.skip("scored dataset not generated")
    df = pd.read_parquet(V1_PATH)
    df = df[~df["team"].isin(_MULTI_TEAM)].copy()
    has_po = df["po_g"].fillna(0) > 0
    value, parts = P.postseason_value_v2(df, has_po)
    df["po_v2"] = value
    for name, arr in parts.items():
        df[name] = arr
    df = df[(df["po_g"].fillna(0) > 0) & (df["po_mp"].fillna(0) > 0)].copy()
    df["po_mpg"] = df["po_mp"] / df["po_g"]
    return df


def _row(df: pd.DataFrame, player: str, season: str) -> pd.Series:
    match = df[(df["player"] == player) & (df["season"] == season)]
    if match.empty:
        pytest.skip(f"{player} {season} not in the dataset")
    return match.iloc[0]


# ---------------------------------------------------------------------------
# The replacement level, which is the whole fix
# ---------------------------------------------------------------------------

class TestReplacementLevel:
    def test_the_frozen_constant_still_matches_the_data_it_was_derived_from(self, playoffs):
        """PO2_REPLACEMENT_LEVEL is the MINUTES-WEIGHTED 25th percentile of
        playoff level. It is frozen so scores stay reproducible as data is
        added -- and re-derived here so the freeze cannot quietly drift away
        from its own definition."""
        level = playoffs["po2_level_full"].to_numpy()
        minutes = playoffs["po_mp"].to_numpy()
        order = np.argsort(level)
        cumulative = np.cumsum(minutes[order]) / minutes.sum()
        derived = level[order][np.searchsorted(cumulative, 0.25)]
        assert derived == pytest.approx(P.PO2_REPLACEMENT_LEVEL, abs=0.35), (
            f"replacement level derived from the data is {derived:.4f}, but the "
            f"frozen constant is {P.PO2_REPLACEMENT_LEVEL}. If the data genuinely "
            f"moved, re-derive and document it; do not widen this tolerance."
        )

    def test_v1s_baseline_sat_near_the_80th_percentile(self, playoffs):
        """The bug, pinned. v1 called 25.0 'a routine playoff contributor'; it is
        actually the ~80th percentile of the level distribution."""
        level = playoffs["po2_level_full"]
        assert (level < P.PO_BASELINE).mean() > 0.75
        assert (level < P.PO2_REPLACEMENT_LEVEL).mean() < 0.45

    def test_replacement_is_far_below_v1s_baseline(self):
        assert P.PO2_REPLACEMENT_LEVEL < P.PO_BASELINE / 3


# ---------------------------------------------------------------------------
# The inversion is closed
# ---------------------------------------------------------------------------

class TestNegativeRate:
    def test_overall_negative_rate_collapses(self, playoffs):
        v1_rate = (playoffs["postseason_perf"] < 0).mean()
        v2_rate = (playoffs["po_v2"] < 0).mean()
        assert v1_rate > 0.60, "v1 baseline moved; re-derive the whole comparison"
        assert v2_rate < 0.05
        assert v2_rate < v1_rate / 10

    def test_high_load_runs_are_essentially_never_negative(self, playoffs):
        """The stated target is under 10% for >=30 MPG and >=10 games."""
        heavy = playoffs[(playoffs["po_mpg"] >= 30) & (playoffs["po_g"] >= 10)]
        assert len(heavy) > 500
        assert (heavy["postseason_perf"] < 0).mean() > 0.30
        assert (heavy["po_v2"] < 0).mean() < 0.10

    @pytest.mark.parametrize("flag", ["championship", "finals_appearance"])
    def test_deep_run_starters_are_not_negative(self, playoffs, flag):
        subset = playoffs[(playoffs[flag] == 1) & (playoffs["po_mpg"] >= 30)]
        assert len(subset) > 100
        assert (subset["postseason_perf"] < 0).mean() > 0.30
        assert (subset["po_v2"] < 0).mean() < 0.02

    def test_missing_the_playoffs_no_longer_beats_a_typical_playoff_run(self, playoffs):
        """A non-playoff season scores exactly 0. Under v1 that beat 68% of real
        playoff runs -- the inversion. Under v2 the median playoff run is above
        it."""
        assert playoffs["postseason_perf"].median() < 0
        assert playoffs["po_v2"].median() > 0

    def test_the_survivors_are_genuinely_bad_and_well_observed(self, playoffs):
        """'Rare and reserved for genuinely harmful, high-sample collapses' has
        to mean something measurable."""
        negative = playoffs[playoffs["po_v2"] < 0]
        assert len(negative) > 0
        assert negative["po_bpm"].median() < -4.0
        assert negative["po_bpm"].median() < playoffs["po_bpm"].median() - 5.0
        # Bounded: nothing like v1's -14 floor.
        assert negative["po_v2"].min() > -P.PO2_COLLAPSE_CAP

    def test_a_bad_cameo_is_neutral_rather_than_punished(self, playoffs):
        """Exposure gating: a poor run over very few minutes should not register
        as harm, because barely any harm reached the floor."""
        cameos = playoffs[(playoffs["po_g"] <= 3) & (playoffs["po_mpg"] < 12)]
        if len(cameos) < 20:
            pytest.skip("too few cameo rows to assert a rate")
        assert (cameos["po_v2"] < -0.5).mean() < 0.02


# ---------------------------------------------------------------------------
# Run length now counts -- but does not take over
# ---------------------------------------------------------------------------

class TestRunLength:
    def test_sensitivity_to_run_length_is_materially_higher(self, playoffs):
        v1 = np.corrcoef(playoffs["postseason_perf"], playoffs["po_g"])[0, 1]
        v2 = np.corrcoef(playoffs["po_v2"], playoffs["po_g"])[0, 1]
        assert v1 < 0.15
        assert v2 > 0.35

    def test_but_quality_still_leads(self, playoffs):
        """If run length outranked quality the component would have become a
        team-success proxy."""
        with_games = np.corrcoef(playoffs["po_v2"], playoffs["po_g"])[0, 1]
        with_quality = np.corrcoef(
            playoffs["po_v2"], playoffs["po_bpm"].fillna(0))[0, 1]
        assert with_quality > with_games

    def test_winning_the_title_is_not_what_drives_it(self, playoffs):
        assert np.corrcoef(playoffs["po_v2"], playoffs["championship"])[0, 1] < 0.45

    def test_rounds_reached_adds_little_once_level_and_games_are_known(self, playoffs):
        """Advancement is Team Result's job. It may enter here only as a sample
        signal, so its residual explanatory power must be small."""
        level = playoffs["po2_level_full"].to_numpy()
        games = playoffs["po_g"].to_numpy()
        rounds = playoffs["playoff_round_score"].fillna(0).to_numpy()
        value = playoffs["po_v2"].to_numpy()
        design = np.c_[np.ones(len(level)), level, games]

        def residual(y):
            return y - design @ np.linalg.lstsq(design, y, rcond=None)[0]

        partial = np.corrcoef(residual(value), residual(rounds))[0, 1]
        assert abs(partial) < 0.30


# ---------------------------------------------------------------------------
# Structure: signs, determinism, no fabrication
# ---------------------------------------------------------------------------

class TestStructure:
    def test_only_collapse_can_be_negative(self, playoffs):
        for term in ("po2_quality", "po2_elevation", "po2_carry", "po2_dominance"):
            assert (playoffs[term] >= -1e-9).all(), term
        assert (playoffs["po2_collapse"] <= 1e-9).all()

    def test_the_parts_reconcile_to_the_whole(self, playoffs):
        total = (playoffs["po2_quality"] + playoffs["po2_elevation"]
                 + playoffs["po2_carry"] + playoffs["po2_dominance"]
                 + playoffs["po2_collapse"])
        assert np.allclose(total, playoffs["po_v2"], atol=1e-9)

    def test_no_playoffs_is_exactly_zero_not_a_default(self):
        df = pd.DataFrame([{"po_mp": 0.0, "po_g": 0.0}])
        value, _ = P.postseason_value_v2(df, pd.Series([False]))
        assert value.iloc[0] == 0.0

    def test_output_is_finite_everywhere(self, playoffs):
        assert np.isfinite(playoffs["po_v2"]).all()

    def test_it_is_deterministic(self):
        df = pd.read_parquet(V1_PATH).head(400)
        has_po = df["po_g"].fillna(0) > 0
        first, _ = P.postseason_value_v2(df, has_po)
        second, _ = P.postseason_value_v2(df, has_po)
        pd.testing.assert_series_equal(first, second)

    def test_no_player_or_team_identity_reaches_the_scoring_code(self):
        """Rule G, enforced against the source rather than trusted.

        Checks the STRING LITERALS and NAMES the v2 scoring path actually
        executes -- docstrings and comments are excluded, since prose that says
        "a player" is not an exception, while a literal "LeBron James" would be.
        """
        import ast
        import inspect
        import textwrap

        offenders = []
        for fn in (P.postseason_value_v2, P._po_level_composite,
                   P._po_sample_reliability):
            tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
            docstrings = {
                node.body[0].value
                for node in ast.walk(tree)
                if isinstance(node, (ast.FunctionDef, ast.Module, ast.ClassDef))
                and node.body and isinstance(node.body[0], ast.Expr)
                and isinstance(node.body[0].value, ast.Constant)
            }
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    if node in docstrings:
                        continue
                    # Column names are fine; a person's or team's name is not.
                    if " " in node.value and node.value.strip():
                        offenders.append((fn.__name__, node.value))
        assert offenders == [], (
            f"identity-shaped string literals in the v2 scoring path: {offenders}")

    def test_the_v2_scoring_path_reads_only_declared_data_columns(self):
        """Every input must be a data field, so a score is explainable from the
        dataset alone."""
        import ast
        import inspect
        import textwrap

        columns = set()
        for fn in (P.postseason_value_v2, P._po_level_composite,
                   P._po_sample_reliability):
            tree = ast.parse(textwrap.dedent(inspect.getsource(fn)))
            for node in ast.walk(tree):
                if isinstance(node, ast.Constant) and isinstance(node.value, str):
                    columns.add(node.value)
        forbidden = {"player", "player_slug", "team", "season"}
        assert not (columns & forbidden), (
            f"v2 scoring reads identity columns: {sorted(columns & forbidden)}")

    def test_more_playoff_minutes_never_turns_a_good_run_negative(self, playoffs):
        """v1's core structural bug was that reliability multiplied a SIGNED
        value, so more minutes meant a bigger penalty. Above replacement, extra
        load can now only help."""
        above = playoffs[playoffs["po2_level_full"] > P.PO2_REPLACEMENT_LEVEL]
        assert len(above) > 1000
        assert (above["po_v2"] >= 0).all()


# ---------------------------------------------------------------------------
# The named review cases -- asserted as properties only
# ---------------------------------------------------------------------------

class TestNamedCases:
    def test_a_full_minutes_title_run_is_not_negative(self, playoffs):
        """Klay Thompson 2014-15 is the canonical instance: 21 games at 36 MPG
        on a champion, scored -8.09 by v1. Asserted as the general property so
        the fix cannot be a special case."""
        title_starters = playoffs[(playoffs["championship"] == 1)
                                  & (playoffs["po_mpg"] >= 34)
                                  & (playoffs["po_g"] >= 18)]
        assert len(title_starters) > 50
        assert (title_starters["po_v2"] >= 0).all()
        klay = _row(playoffs, "Klay Thompson", "2014-15")
        assert klay["postseason_perf"] < 0
        assert klay["po_v2"] > 0

    def test_a_heavy_carry_run_gains_relative_to_v1(self, playoffs):
        """Jimmy Butler 2022-23: 22 games, 39.7 MPG, high usage."""
        butler = _row(playoffs, "Jimmy Butler", "2022-23")
        assert butler["po_v2"] > butler["postseason_perf"]
        assert butler["po2_carry"] > 0

    def test_an_mvp_finals_run_is_not_scored_as_replacement_level(self, playoffs):
        """Karl Malone 1996-97 -- MVP, 20 games at 40.8 MPG -- scored +1.33
        under v1, indistinguishable from a marginal contributor."""
        malone = _row(playoffs, "Karl Malone", "1996-97")
        assert malone["postseason_perf"] < 2.0
        assert malone["po_v2"] > 10.0

    def test_a_short_extreme_run_is_shrunk_not_dominant(self, playoffs):
        """Principle D. Manu Ginobili 2004-05 stays strong -- the brief allows
        that -- but a 12-game extreme (Kawhi 2016-17) must not out-score the
        same player's 24-game run (2018-19)."""
        manu = _row(playoffs, "Manu Ginobili", "2004-05")
        assert manu["po_v2"] > 25.0, "a genuinely elite run must stay strong"

        short = _row(playoffs, "Kawhi Leonard", "2016-17")
        long_run = _row(playoffs, "Kawhi Leonard", "2018-19")
        assert short["po_g"] < long_run["po_g"]
        assert short["po_v2"] < long_run["po_v2"]
        assert short["po2_sample_reliab"] < long_run["po2_sample_reliab"]

    def test_a_short_poor_run_is_neutral_rather_than_punished(self, playoffs):
        """Joel Embiid 2022-23: 9 games. Under v1 a short run below the inflated
        baseline was penalised; under v2 it is shrunk toward replacement."""
        embiid = _row(playoffs, "Joel Embiid", "2022-23")
        assert embiid["postseason_perf"] < 0
        assert embiid["po_v2"] >= 0
        assert embiid["po2_sample_reliab"] < 0.6

    def test_the_same_player_is_ranked_by_run_quality_and_length(self, playoffs):
        """Giannis 2020-21 (21-game title run) over 2019-20 (9-game exit)."""
        long_run = _row(playoffs, "Giannis Antetokounmpo", "2020-21")
        short = _row(playoffs, "Giannis Antetokounmpo", "2019-20")
        assert long_run["po_v2"] > short["po_v2"]

    def test_no_named_case_is_special_cased(self, playoffs):
        """Every named case must sit on the same curve as everyone else: its
        value must equal its own parts, with no residual."""
        for player, season in [("Klay Thompson", "2014-15"), ("Karl Malone", "1996-97"),
                               ("Manu Ginobili", "2004-05"), ("Joel Embiid", "2022-23"),
                               ("Jimmy Butler", "2022-23")]:
            row = _row(playoffs, player, season)
            parts = (row["po2_quality"] + row["po2_elevation"] + row["po2_carry"]
                     + row["po2_dominance"] + row["po2_collapse"])
            assert parts == pytest.approx(row["po_v2"], abs=1e-9), f"{player} {season}"
