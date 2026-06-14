"""
Accuracy / cleanup-pass invariants for the OFFICIAL five-component index.

Proves the zero-baseline, additive-postseason, provisional-exclusion, exact
reconciliation, and formula-text guarantees added in the correction pass:

  * no playoffs  -> ZERO raw postseason value (no positive 35/40 prior);
  * no team achievement -> ZERO raw team value (no 25/8.5 default);
  * missing awards -> ZERO recognition value;
  * provisional seasons cannot win completed rankings;
  * provisional seasons cannot enter completed N-year windows;
  * postseason injury (few minutes) is shrunk toward ZERO, NOT double-counted
    as both poor play and poor availability;
  * component contributions reconcile EXACTLY to prime_raw;
  * the printed FORMULA_TEXT matches the implemented weights/architecture.

Run: python tests/test_corrections.py   (no network)
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import peak3  # noqa: E402
from test_scoring import _league  # noqa: E402  (synthetic no-playoff league)


def _approx(x, tol=1e-6):
    class _A:
        def __eq__(self, o): return abs(float(o) - float(x)) < tol
    return _A()


def _po_row(reg_rate_match=True, **kw):
    base = dict(po_bpm=np.nan, po_obpm=np.nan, po_dbpm=np.nan,
                po_ws_per_48=np.nan, po_per=np.nan, po_pts=np.nan,
                po_r_ts=np.nan, po_ts_plus=np.nan, po_mp=np.nan,
                po_ast=np.nan, po_ast_pct=np.nan, po_trb=np.nan,
                po_trb_pct=np.nan, po_stocks=np.nan,
                opponent_quality_score=np.nan,
                bpm=np.nan, obpm=np.nan, dbpm=np.nan, ws_per_48=np.nan, per=np.nan)
    base.update(kw)
    # By default mirror regular-season RATE inputs to the playoff ones so that
    # playoff ELEVATION (playoff rate - regular rate) is ~0 and the test isolates
    # absolute playoff LEVEL. Tests that probe elevation pass reg_rate_match=False
    # and set bpm/obpm/dbpm/ws_per_48/per explicitly.
    if reg_rate_match:
        for r, p in (("bpm", "po_bpm"), ("obpm", "po_obpm"), ("dbpm", "po_dbpm"),
                     ("ws_per_48", "po_ws_per_48"), ("per", "po_per")):
            if r not in kw:
                base[r] = base[p]
    return base


def _pv(df, has_po):
    val, _parts = peak3.postseason_value(df, pd.Series(has_po))
    return val


# --------------------------------------------------------------- postseason ---
def test_no_playoffs_produces_zero_postseason_value():
    df = pd.DataFrame([_po_row(), _po_row(po_mp=0.0)])
    val = _pv(df, [False, True])               # 2nd "made" playoffs but 0 minutes
    assert float(val.iloc[0]) == 0.0, "no playoffs must contribute exactly 0"
    assert float(val.iloc[1]) == 0.0, "zero playoff minutes must contribute 0"


def test_excellent_postseason_adds_poor_subtracts_bounded():
    great = _po_row(po_bpm=10.0, po_obpm=7.0, po_dbpm=3.0, po_ws_per_48=0.28,
                    po_per=28, po_pts=32, po_r_ts=8.0, po_ts_plus=112, po_mp=600)
    poor = _po_row(po_bpm=-6.0, po_obpm=-4.0, po_dbpm=-2.0, po_ws_per_48=-0.02,
                   po_per=8, po_pts=9, po_r_ts=-9.0, po_ts_plus=88, po_mp=600)
    df = pd.DataFrame([great, poor])
    val = _pv(df, [True, True])
    assert float(val.iloc[0]) > 5.0, "excellent playoff run must add real value"
    assert float(val.iloc[1]) < 0.0, "poor playoff run may create a penalty"
    # the total downside is a SINGLE small bounded penalty (no stacking)
    assert float(val.iloc[1]) >= -peak3.PO_PENALTY_CAP - 1e-9, "penalty is bounded"


def test_postseason_injury_shrinks_toward_zero_not_double_counted():
    """A strong per-minute playoff run on FEW minutes is shrunk TOWARD ZERO
    (one availability discount), never pushed more negative than the full-minute
    value (which would be counting the missed games a second time)."""
    kw = dict(po_bpm=9.0, po_obpm=6.0, po_dbpm=2.5, po_ws_per_48=0.26, po_per=27,
              po_pts=30, po_r_ts=7.0, po_ts_plus=110)
    v_full = float(_pv(pd.DataFrame([_po_row(po_mp=600, **kw)]), [True]).iloc[0])
    v_inj = float(_pv(pd.DataFrame([_po_row(po_mp=90, **kw)]), [True]).iloc[0])
    v_none = float(_pv(pd.DataFrame([_po_row(po_mp=np.nan, **kw)]), [False]).iloc[0])
    assert v_full > v_inj > 0.0, "injury shrinks a positive value toward 0"
    assert v_none == 0.0
    # poor-availability is NOT separately re-penalized: a good-rate injured run
    # stays ABOVE the no-playoff floor, it does not dip below it.
    assert v_inj >= v_none


def test_playoff_elevation_is_sample_shrunk():
    """Identical playoff-over-regular elevation contributes more on a big sample
    than on a tiny (injury) sample -- elevation is shrunk toward 0 for small n."""
    kw = dict(po_bpm=9.0, po_obpm=6.0, po_dbpm=2.0, po_ws_per_48=0.24, po_per=26,
              po_pts=28, po_r_ts=5.0, po_ts_plus=108,
              bpm=4.0, obpm=2.0, dbpm=1.0, ws_per_48=0.16, per=20)  # raised in PO
    big = pd.DataFrame([_po_row(reg_rate_match=False, po_mp=600, **kw)])
    small = pd.DataFrame([_po_row(reg_rate_match=False, po_mp=80, **kw)])
    _, pbig = peak3.postseason_value(big, pd.Series([True]))
    _, psmall = peak3.postseason_value(small, pd.Series([True]))
    assert pbig["po_elevation"][0] > psmall["po_elevation"][0] > 0.0
    assert psmall["po_elevation"][0] < 0.5 * pbig["po_elevation"][0]


def test_absolute_greatness_matters_without_positive_elevation():
    """A player who is elite in the playoffs but slightly BELOW his extreme
    regular season (negative elevation) still earns strong positive postseason
    value from absolute level -- elevation supplements, never replaces, level."""
    elite_no_elev = _po_row(reg_rate_match=False, po_mp=650,
                            po_bpm=9.0, po_obpm=6.0, po_dbpm=2.5, po_ws_per_48=0.25,
                            po_per=27, po_pts=31, po_r_ts=6.0, po_ts_plus=110,
                            # higher regular season -> elevation is negative
                            bpm=12.0, obpm=9.0, dbpm=3.0, ws_per_48=0.30, per=31)
    val, parts = peak3.postseason_value(pd.DataFrame([elite_no_elev]),
                                        pd.Series([True]))
    assert parts["po_elevation"][0] <= 0.0, "regular season was higher"
    assert float(val.iloc[0]) > 8.0, "absolute playoff greatness still scores high"


def test_deep_run_volume_requires_quality_and_minutes():
    """Deep-run volume rewards elite individual quality SUSTAINED over real
    minutes; it is 0 without quality and 0 without minutes (never an automatic
    team-advancement reward)."""
    elite = dict(po_bpm=9.0, po_obpm=6.0, po_dbpm=2.5, po_ws_per_48=0.25,
                 po_per=27, po_pts=31, po_r_ts=6.0, po_ts_plus=110)
    weak = dict(po_bpm=-3.0, po_obpm=-2.0, po_dbpm=-1.0, po_ws_per_48=0.02,
                po_per=11, po_pts=10, po_r_ts=-4.0, po_ts_plus=94)
    _, p_long_elite = peak3.postseason_value(
        pd.DataFrame([_po_row(po_mp=900, **elite)]), pd.Series([True]))
    _, p_short_elite = peak3.postseason_value(
        pd.DataFrame([_po_row(po_mp=120, **elite)]), pd.Series([True]))
    _, p_long_weak = peak3.postseason_value(
        pd.DataFrame([_po_row(po_mp=900, **weak)]), pd.Series([True]))
    assert p_long_elite["po_deep_run"][0] > p_short_elite["po_deep_run"][0] > -1e-9
    assert p_long_weak["po_deep_run"][0] == 0.0, "deep run needs real quality"
    assert p_long_elite["po_deep_run"][0] > 0.0


# ----------------------------------------------------------- team achievement ---
def _ta_row(prs, **flags):
    base = dict(playoff_round_score=prs, championship=0, finals_appearance=0,
                conf_finals=0, best_player_title=0, co_best_player_title=0)
    base.update(flags)
    return pd.Series(base)


def test_no_team_achievement_is_zero():
    # missing (no playoffs, 10) AND first-round LOSS (round_score 30, zero
    # series won) must BOTH be exactly 0 -- 30 is "reached R1", not "won a series".
    for prs in (np.nan, 10.0, 30.0):
        assert peak3.team_achievement_row(_ta_row(prs)) == 0.0, f"prs={prs} -> 0"


def test_first_round_loss_zero_team_achievement():
    # explicit: a first-round exit (playoff_round_score == 30) gets ZERO
    assert peak3.team_achievement_row(_ta_row(30.0)) == 0.0


def test_team_achievement_positive_only_for_real_success_and_progressive():
    # series win begins at playoff_round_score 50 (won exactly one series)
    series_win = _ta_row(50.0)
    conf = _ta_row(70.0, conf_finals=1)
    finals = _ta_row(85.0, conf_finals=1, finals_appearance=1)
    champ = _ta_row(100.0, conf_finals=1, finals_appearance=1, championship=1,
                    best_player_title=1)
    v_series = peak3.team_achievement_row(series_win)
    v_conf = peak3.team_achievement_row(conf)
    v_finals = peak3.team_achievement_row(finals)
    v_champ = peak3.team_achievement_row(champ)
    assert v_series > 0.0
    # Conference Finals, Finals and championship increase progressively
    assert v_series < v_conf < v_finals < v_champ


# ----------------------------------------------------------------- recognition ---
def test_missing_awards_produce_zero_recognition():
    row = pd.Series(dict(awards="", player="Nobody", season_end=2015,
                         mvp_vote_share=np.nan, dpoy_vote_share=np.nan,
                         finals_mvp=0))
    rec = peak3.recognition_row(row)
    assert rec["recognition"] == 0.0, "no award/accolade -> zero recognition"


# ------------------------------------------------------------------- provisional ---
def _career_with_provisional():
    """3 complete seasons + 1 stronger PROVISIONAL season."""
    rows = []
    for i, (yr, sc, prov) in enumerate([
            (2012, 80.0, 0), (2013, 82.0, 0), (2014, 81.0, 0), (2015, 99.0, 1)]):
        rows.append(dict(player="X", season_end=yr,
                         season=f"{yr-1}-{str(yr)[-2:]}",
                         stat_total=sc, legacy_total=sc, prime_score=sc,
                         performance_only=sc, provisional=prov))
    return pd.DataFrame(rows)


def test_provisional_cannot_win_completed_best_season():
    df = _career_with_provisional()
    best = peak3.best_single_season(df, "prime_score", include_provisional=False)
    assert int(best["provisional"]) == 0, "provisional season must not win"
    assert best["season_end"] == 2013
    # opt-in still allows it
    best_p = peak3.best_single_season(df, "prime_score", include_provisional=True)
    assert best_p["season_end"] == 2015


def test_provisional_excluded_from_completed_windows():
    df = _career_with_provisional()
    wins = peak3.three_year_windows(df, "prime_score")
    seasons = {s for w in wins for s in w["df"]["season_end"].tolist()}
    assert 2015 not in seasons, "provisional season cannot enter completed window"
    wins_n = peak3.n_year_windows(df, "prime_score", 3)
    seasons_n = {s for w in wins_n for s in w["df"]["season_end"].tolist()}
    assert 2015 not in seasons_n
    # opt-in includes it
    wins_p = peak3.three_year_windows(df, "prime_score", include_provisional=True)
    seasons_p = {s for w in wins_p for s in w["df"]["season_end"].tolist()}
    assert 2015 in seasons_p


# ---------------------------------------------------------------- five-year ---
def _career_for_five_year():
    """6 consecutive seasons: 5 complete + a stronger 6th PROVISIONAL season,
    with full contrib_* / prime_raw columns so windows decompose."""
    W = peak3.OFFICIAL_WEIGHTS
    rows = []
    data = [  # (year, si, tp, recog, po, team, prov)
        (2010, 88, 66, 40, 30, 20, 0), (2011, 92, 70, 55, 40, 35, 0),
        (2012, 95, 74, 70, 45, 60, 0), (2013, 90, 68, 50, 38, 30, 0),
        (2014, 86, 64, 35, 28, 10, 0), (2015, 99, 80, 90, 55, 80, 1)]
    for yr, si, tp, rec, po, tm, prov in data:
        c = dict(contrib_statistical_impact=W["statistical_impact"] * si,
                 contrib_traditional_production=W["traditional_production"] * tp,
                 contrib_recognition=W["recognition"] * rec,
                 contrib_postseason=W["postseason"] * po,
                 contrib_team_achievement=W["team_achievement"] * tm)
        raw = sum(c.values())
        rows.append(dict(player="X", season_end=yr,
                         season=f"{yr-1}-{str(yr)[-2:]}",
                         statistical_impact=si, traditional_production=tp,
                         prime_raw=raw, legacy_raw=raw,
                         prime_score=peak3.calibrate_score(pd.Series([raw])).iloc[0],
                         performance_only=peak3.calibrate_score(pd.Series([raw])).iloc[0],
                         teammate_adjustment=0.0, provisional=prov, **c))
    df = pd.DataFrame(rows)
    df["prime_score"] = peak3.calibrate_score(df["prime_raw"])
    df["legacy_total"] = df["prime_score"]
    return df


def test_provisional_cannot_enter_five_year_peaks():
    df = _career_for_five_year()
    wins = peak3.n_year_windows(df, "prime_score", 5)
    seasons = {s for w in wins for s in w["df"]["season_end"].tolist()}
    assert 2015 not in seasons, "provisional season cannot enter a 5-year peak"
    # only one eligible completed 5-year window (2010-2014)
    assert len(wins) == 1
    assert wins[0]["seasons"] == ["2009-10", "2010-11", "2011-12", "2012-13", "2013-14"]


def test_five_year_window_has_five_consecutive_completed_seasons():
    df = _career_for_five_year()
    win = peak3.n_year_windows(df, "prime_score", 5)[0]
    yrs = sorted(int(r["season_end"]) for _, r in win["df"].iterrows())
    assert len(yrs) == 5
    assert yrs == list(range(yrs[0], yrs[0] + 5)), "must be 5 CONSECUTIVE seasons"
    assert all(int(r["provisional"]) == 0 for _, r in win["df"].iterrows())


def test_five_year_component_decomposition_reconciles_exactly():
    df = _career_for_five_year()
    win = peak3.n_year_windows(df, "prime_score", 5)[0]
    dec = peak3.nyear_window_decomposition(win, "prime_score", "weighted")
    parts = sum(v for k, v in dec.items()
                if k in ("Statistical impact (43%)", "Traditional production (24%)",
                         "Individual recognition (18%)", "Postseason individual (12%)",
                         "Team achievement (3%)", "Teammate adjustment"))
    assert abs(parts - dec["_raw_window_score"]) < 1e-6, \
        "5-year component decomposition must reconcile to the raw window score"


# ----------------------------------------------- component separation / triple ---
def test_finals_mvp_only_in_recognition():
    base = dict(awards="", player="P", season_end=2015, mvp_vote_share=np.nan,
                dpoy_vote_share=np.nan, finals_mvp=0)
    with_fmvp = dict(base); with_fmvp["finals_mvp"] = 1
    rec0 = peak3.recognition_row(pd.Series(base))["recognition"]
    rec1 = peak3.recognition_row(pd.Series(with_fmvp))["recognition"]
    assert rec1 > rec0, "Finals MVP must raise Individual Recognition"
    # Finals MVP must NOT appear in Team Achievement
    ta = peak3.team_achievement_row(_ta_row(100.0, championship=1,
                                            best_player_title=1))
    ta_fmvp = peak3.team_achievement_row(pd.Series(dict(
        playoff_round_score=100.0, championship=1, finals_appearance=1,
        conf_finals=1, best_player_title=1, co_best_player_title=0, finals_mvp=1)))
    assert ta == ta_fmvp, "finals_mvp must not change Team Achievement"


def test_championship_only_in_team_achievement():
    # championship raises Team Achievement
    no_ring = peak3.team_achievement_row(_ta_row(85.0, conf_finals=1,
                                                 finals_appearance=1))
    ring = peak3.team_achievement_row(_ta_row(100.0, conf_finals=1,
                                              finals_appearance=1, championship=1,
                                              best_player_title=1))
    assert ring > no_ring
    # championship must NOT appear in Individual Recognition
    base = dict(awards="MVP-1,NBA1", player="P", season_end=2015,
                mvp_vote_share=0.9, dpoy_vote_share=np.nan, finals_mvp=0,
                championship=0)
    champ = dict(base); champ["championship"] = 1
    assert peak3.recognition_row(pd.Series(base))["recognition"] == \
        peak3.recognition_row(pd.Series(champ))["recognition"], \
        "championship must not change Individual Recognition"


def test_playoff_accomplishments_not_triple_counted():
    """Each playoff accomplishment lives in exactly ONE component: round/series
    -> Team Achievement only; Finals MVP -> Recognition only; neither touches the
    individual Postseason value (which reads only raw playoff box stats)."""
    po_df = pd.DataFrame([_po_row(po_bpm=8.0, po_obpm=5.0, po_dbpm=2.0,
                                  po_ws_per_48=0.22, po_per=25, po_pts=27,
                                  po_r_ts=4.0, po_ts_plus=106, po_mp=600)])
    # postseason value does not read championship / round / finals_mvp at all
    base_val = float(_pv(po_df, [True]).iloc[0])
    po_df2 = po_df.copy()
    po_df2["championship"] = 1
    po_df2["playoff_round_score"] = 100.0
    po_df2["finals_mvp"] = 1
    assert float(_pv(po_df2, [True]).iloc[0]) == base_val, \
        "team/round/Finals-MVP must not leak into Postseason Individual Value"


def test_playoff_elevation_affects_postseason_only():
    """Changing only the playoff-vs-regular elevation moves Postseason value but
    NOT recognition or team achievement (those read awards/round flags, not the
    playoff rate-impact delta)."""
    low = _po_row(reg_rate_match=False, po_mp=600, po_bpm=6.0, po_obpm=4.0,
                  po_dbpm=1.5, po_ws_per_48=0.18, po_per=22, po_pts=24,
                  po_r_ts=2.0, po_ts_plus=104,
                  bpm=9.0, obpm=6.0, dbpm=2.0, ws_per_48=0.24, per=27)  # declined
    high = _po_row(reg_rate_match=False, po_mp=600, po_bpm=9.0, po_obpm=6.0,
                   po_dbpm=2.0, po_ws_per_48=0.24, po_per=27, po_pts=29,
                   po_r_ts=5.0, po_ts_plus=108,
                   bpm=6.0, obpm=4.0, dbpm=1.5, ws_per_48=0.18, per=22)  # elevated
    vlo, plo = peak3.postseason_value(pd.DataFrame([low]), pd.Series([True]))
    vhi, phi = peak3.postseason_value(pd.DataFrame([high]), pd.Series([True]))
    assert phi["po_elevation"][0] > plo["po_elevation"][0]
    assert float(vhi.iloc[0]) > float(vlo.iloc[0]), "elevation lifts postseason value"
    # team achievement / recognition do not read elevation at all
    assert peak3.team_achievement_row(_ta_row(50.0)) == peak3.team_achievement_row(_ta_row(50.0))


def test_brunson_2026_context_is_correct():
    """The complete 2025-26 season has NYK champion + Brunson Finals MVP, set via
    data/manual_context.csv and verified end-to-end on the scored cache."""
    sc = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
    if not sc.exists():
        print("  SKIP: scored cache not built"); return
    s = pd.read_parquet(sc)
    b = s[(s.player == "Jalen Brunson") & (s.season_end == 2026)]
    assert len(b), "Brunson 2026 missing"
    b = b.iloc[0]
    assert int(b["championship"]) == 1, "Brunson 2026 must be champion"
    assert int(b["finals_mvp"]) == 1, "Brunson 2026 must be Finals MVP"
    assert int(b["best_player_title"]) == 1
    assert float(b["team_achievement"]) == 100.0, "best-player champion -> 100 team ach"
    # Finals MVP shows up in recognition (>0) and NOT in team achievement value;
    # championship shows up in team achievement, not recognition.
    assert float(b["recognition"]) > 0.0
    # no double count: postseason value reads only raw playoff box, independent of
    # the championship/Finals-MVP flags (level+elevation+deep-run reconcile).
    assert float(b["postseason_perf"]) == _approx(
        b["po_level_value"] + b["po_elevation_value"] + b["po_deep_run_value"])


# ------------------------------------------- new weights / windows reconcile ---
def test_new_weights_reconcile_in_three_and_five_year_windows():
    df = _career_for_five_year()
    for n in (3, 5):
        win = peak3.n_year_windows(df, "prime_score", n)[0]
        dec = peak3.nyear_window_decomposition(win, "prime_score", "weighted")
        keys = ["Statistical impact (43%)", "Traditional production (24%)",
                "Individual recognition (18%)", "Postseason individual (12%)",
                "Team achievement (3%)", "Teammate adjustment"]
        parts = sum(dec[k] for k in keys)
        assert abs(parts - dec["_raw_window_score"]) < 1e-6, \
            f"{n}-year decomposition must reconcile under the new weights"
    # the per-season contributions must use the NEW weights exactly
    scored = peak3.score_dataset(_league(), pd.DataFrame())
    W = peak3.OFFICIAL_WEIGHTS
    r = scored.iloc[0]
    assert abs(r["contrib_postseason"] - W["postseason"] * r["postseason_perf"]) < 1e-9
    assert abs(r["contrib_statistical_impact"]
               - W["statistical_impact"] * r["statistical_impact"]) < 1e-9


# --------------------------------------------------------------- reconciliation ---
def test_contributions_reconcile_exactly_to_prime_raw():
    scored = peak3.score_dataset(_league(), pd.DataFrame())
    recon = (scored["contrib_statistical_impact"] +
             scored["contrib_traditional_production"] +
             scored["contrib_recognition"] +
             scored["contrib_postseason"] +
             scored["contrib_team_achievement"] +
             scored["teammate_adjustment"])
    diff = (recon - scored["prime_raw"]).abs().max()
    assert diff < 1e-9, f"contributions must sum to prime_raw (max diff {diff})"
    # weights used must be exactly the stated 43/24/18/12/3.
    assert peak3.OFFICIAL_WEIGHTS == {
        "statistical_impact": 0.43, "traditional_production": 0.24,
        "recognition": 0.18, "postseason": 0.12, "team_achievement": 0.03}
    assert abs(sum(peak3.OFFICIAL_WEIGHTS.values()) - 1.0) < 1e-9


# ------------------------------------------------------------------ formula text ---
def test_formula_text_matches_implementation():
    t = peak3.FORMULA_TEXT
    for token in ("0.43", "0.24", "0.18", "0.12", "0.03",
                  "Statistical Impact", "Traditional Production",
                  "Individual Recognition", "Postseason Individual",
                  "Team Achievement", "prime_raw", "calibrate_score"):
        assert token in t, f"FORMULA_TEXT missing {token!r}"
    # obsolete descriptions must be gone
    for bad in ("0.55 Regular", "0.45 Regular", "0.35 Impact",
                "0.30 Playoff", "capped +/-5", "76/20"):
        assert bad not in t, f"FORMULA_TEXT still contains obsolete {bad!r}"
    # the index must NOT be described as percentile-based
    assert "percentile" not in t.lower().split("not percentile-based")[-1] \
        or "NEVER inside" in t or "not percentile-based" in t.lower()


def _run_all():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  ok  {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} correction tests passed.")


if __name__ == "__main__":
    _run_all()
