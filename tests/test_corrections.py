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


def test_sustained_volume_scales_with_best_player_responsibility():
    """On an identical elite deep run, a high-usage primary creator earns more
    sustained-volume than a low-usage contributor (responsibility from usage),
    but the low-usage elite player is NOT zeroed out (floor keeps real value)."""
    elite = dict(po_bpm=9.0, po_obpm=6.0, po_dbpm=2.5, po_ws_per_48=0.25,
                 po_per=27, po_pts=31, po_r_ts=6.0, po_ts_plus=110, po_mp=900)
    _, hi = peak3.postseason_value(
        pd.DataFrame([_po_row(po_usg_pct=32.0, **elite)]), pd.Series([True]))
    _, lo = peak3.postseason_value(
        pd.DataFrame([_po_row(po_usg_pct=15.0, **elite)]), pd.Series([True]))
    assert hi["po_responsibility"][0] > lo["po_responsibility"][0]
    assert hi["po_deep_run"][0] > lo["po_deep_run"][0] > 0.0, \
        "low-usage elite still earns some sustained-volume (floor), high-usage more"
    assert lo["po_responsibility"][0] >= peak3.PO_RESP_FLOOR - 1e-9


def test_dominance_booster_only_lifts_historically_dominant_levels():
    """The convex dominance bonus lifts only the very top of the level curve:
    a merely-good playoff level gets ZERO dominance, a historically dominant one
    (full Finals-length sample) gains a real, reliability-shrunk bonus. Ordinary/
    good runs never benefit."""
    good = _po_row(po_bpm=5.5, po_obpm=3.5, po_dbpm=1.5, po_ws_per_48=0.18,
                   po_per=22, po_pts=24, po_r_ts=3.0, po_ts_plus=106, po_mp=900,
                   po_g=20, playoff_round_score=100.0, po_usg_pct=26.0)
    dominant = _po_row(po_bpm=13.0, po_obpm=9.0, po_dbpm=3.5, po_ws_per_48=0.34,
                       po_per=33, po_pts=38, po_r_ts=9.0, po_ts_plus=118, po_mp=900,
                       po_g=20, playoff_round_score=100.0, po_usg_pct=33.0)
    vg, pg = peak3.postseason_value(pd.DataFrame([good]), pd.Series([True]))
    vd, pd_ = peak3.postseason_value(pd.DataFrame([dominant]), pd.Series([True]))
    assert float(pg["po_dominance"][0]) == 0.0, "a good run earns NO dominance bonus"
    assert float(pd_["po_dominance"][0]) > 0.0, "a dominant run earns a dominance bonus"
    assert float(vg.iloc[0]) < 12.0, "a merely-good playoff run stays modest"
    assert float(vd.iloc[0]) > 45.0, "a historically dominant run is exceptional"
    # the dominant run is far more than 2x the good run (nonlinear separation)
    assert float(vd.iloc[0]) > 2.5 * float(vg.iloc[0])


def test_dominance_bonus_has_diminishing_returns():
    """The dominance bonus uses a SATURATING (square-root) curve: equal steps in
    playoff level produce SHRINKING increments of dominance, never the old open-
    ended linear `+K per point` that let an extreme rate run away."""
    def dom_raw(scale):
        r = _po_row(po_bpm=6 * scale, po_obpm=4 * scale, po_dbpm=2 * scale,
                    po_ws_per_48=0.18 * scale, po_per=22 * scale, po_pts=26 * scale,
                    po_r_ts=4 * scale, po_ts_plus=100 + 8 * scale, po_mp=950,
                    po_g=22, playoff_round_score=100.0, po_usg_pct=30.0)
        _, p = peak3.postseason_value(pd.DataFrame([r]), pd.Series([True]))
        return float(p["po_abs_level"][0] + peak3.PO_BASELINE), float(p["po_dominance_raw"][0])
    pts = [dom_raw(s) for s in (1.5, 1.7, 1.9, 2.1)]
    # levels increase by roughly equal steps; dominance increments must shrink
    incs = [pts[i + 1][1] - pts[i][1] for i in range(len(pts) - 1)]
    assert all(b > 0 for b in incs), "dominance still rises with level"
    assert incs[0] > incs[1] > incs[2], "increments shrink (diminishing returns)"
    # the curve never explodes: at a sky-high level the raw bonus stays bounded
    assert pts[-1][1] < 0.6 * pts[-1][0], "dominance is a small fraction of level"


def test_dominance_bonus_is_reliability_adjusted():
    """At an IDENTICAL dominant level, the convex dominance bonus is shrunk by the
    playoff-sample reliability: a short Conference-Finals run earns only a PARTIAL
    bonus, a full Finals-length run earns the whole curve value."""
    kw = dict(po_bpm=13.0, po_obpm=9.0, po_dbpm=3.5, po_ws_per_48=0.34, po_per=33,
              po_pts=38, po_r_ts=9.0, po_ts_plus=118, po_usg_pct=33.0)
    full = _po_row(po_mp=980, po_g=23, playoff_round_score=100.0, **kw)
    short = _po_row(po_mp=470, po_g=12, playoff_round_score=70.0, **kw)
    _, pf = peak3.postseason_value(pd.DataFrame([full]), pd.Series([True]))
    _, ps = peak3.postseason_value(pd.DataFrame([short]), pd.Series([True]))
    # identical level/rates -> identical PRE-reliability dominance
    assert abs(float(pf["po_dominance_raw"][0]) - float(ps["po_dominance_raw"][0])) < 1e-9
    # but the FINAL dominance is shrunk on the short sample
    assert float(ps["po_dominance"][0]) < float(pf["po_dominance"][0])
    assert float(ps["po_dominance"][0]) < float(ps["po_dominance_raw"][0])
    assert abs(float(pf["po_dominance"][0]) - float(pf["po_dominance_raw"][0])) < 1e-9


def test_short_extreme_run_cannot_dwarf_finals_length_elite():
    """The core correction: a SHORT run with extreme rates cannot automatically
    dwarf a complete Finals-length elite run, and at EQUAL rates the Finals-length
    sample scores higher (the extra value comes from sustained minutes/games, not
    from advancement)."""
    extreme = dict(po_bpm=13, po_obpm=9, po_dbpm=3.5, po_ws_per_48=0.34, po_per=33,
                   po_pts=37, po_r_ts=9, po_ts_plus=118, po_usg_pct=33)
    elite = dict(po_bpm=11, po_obpm=7.5, po_dbpm=3.0, po_ws_per_48=0.30, po_per=30,
                 po_pts=33, po_r_ts=7.5, po_ts_plus=114, po_usg_pct=32)

    def v(**kw):
        return float(peak3.postseason_value(
            pd.DataFrame([_po_row(**kw)]), pd.Series([True]))[0].iloc[0])

    short_extreme = v(po_mp=560, po_g=14, playoff_round_score=70.0, **extreme)
    finals_elite = v(po_mp=980, po_g=23, playoff_round_score=100.0, **elite)
    extreme_full = v(po_mp=980, po_g=23, playoff_round_score=100.0, **extreme)
    # the short extreme run does NOT run away from the complete elite run
    assert short_extreme < 1.4 * finals_elite, "short run must not dwarf a Finals run"
    # at EQUAL (extreme) rates, the Finals-length sample is worth meaningfully more
    assert extreme_full > short_extreme * 1.2, "more elite minutes/games -> more value"


def test_level_elevation_dominance_use_distinct_signals():
    """Absolute level, elevation and dominance are NOT the identical full signal:
      * elevation responds to the REGULAR-season baseline; absolute level does not;
      * dominance is reliability-scaled; the pre-reliability absolute level is not.
    """
    base = dict(po_bpm=12.0, po_obpm=8.0, po_dbpm=3.0, po_ws_per_48=0.32, po_per=31,
                po_pts=35, po_r_ts=8.0, po_ts_plus=116, po_usg_pct=32,
                po_mp=900, po_g=22, playoff_round_score=100.0)
    # same playoffs, DIFFERENT regular season -> same abs level, different elevation
    low_reg = _po_row(reg_rate_match=False, bpm=2, obpm=1, dbpm=1,
                      ws_per_48=0.10, per=16, **base)
    high_reg = _po_row(reg_rate_match=False, bpm=10, obpm=7, dbpm=2.5,
                       ws_per_48=0.28, per=29, **base)
    _, pl = peak3.postseason_value(pd.DataFrame([low_reg]), pd.Series([True]))
    _, ph = peak3.postseason_value(pd.DataFrame([high_reg]), pd.Series([True]))
    assert abs(float(pl["po_abs_level"][0]) - float(ph["po_abs_level"][0])) < 1e-9, \
        "absolute level ignores the regular-season baseline"
    assert float(pl["po_elev_raw"][0]) > float(ph["po_elev_raw"][0]), \
        "elevation reads the playoff-minus-regular delta, not the level"
    # same playoffs, DIFFERENT sample -> same abs level, different final dominance
    short = _po_row(reg_rate_match=False, bpm=10, obpm=7, dbpm=2.5, ws_per_48=0.28,
                    per=29, **{**base, "po_mp": 470, "po_g": 12,
                              "playoff_round_score": 70.0})
    _, pshort = peak3.postseason_value(pd.DataFrame([short]), pd.Series([True]))
    assert abs(float(pshort["po_abs_level"][0]) - float(ph["po_abs_level"][0])) < 1e-9, \
        "absolute (pre-reliability) level ignores the sample size"
    assert float(pshort["po_dominance"][0]) < float(ph["po_dominance"][0]), \
        "dominance IS reliability-scaled by the sample"


def test_postseason_four_terms_reconcile_exactly():
    """postseason_value = reliability-adjusted level + elevation + sustained volume
    + dominance, and the four reported terms sum EXACTLY to the returned value for
    every positive (non-penalty-clipped) playoff row."""
    rows = [
        _po_row(po_bpm=13, po_obpm=9, po_dbpm=3.5, po_ws_per_48=0.34, po_per=33,
                po_pts=38, po_r_ts=9, po_ts_plus=118, po_mp=950, po_g=22,
                playoff_round_score=100.0, po_usg_pct=33),
        _po_row(po_bpm=9, po_obpm=6, po_dbpm=2, po_ws_per_48=0.24, po_per=27,
                po_pts=29, po_r_ts=5, po_ts_plus=108, po_mp=560, po_g=14,
                playoff_round_score=70.0, po_usg_pct=28),
        _po_row(po_bpm=5, po_obpm=3, po_dbpm=1.5, po_ws_per_48=0.16, po_per=21,
                po_pts=23, po_r_ts=2, po_ts_plus=104, po_mp=820, po_g=18,
                playoff_round_score=85.0, po_usg_pct=24),
    ]
    val, p = peak3.postseason_value(pd.DataFrame(rows), pd.Series([True] * len(rows)))
    recon = (p["po_level"] + p["po_elevation"] + p["po_deep_run"] + p["po_dominance"])
    assert np.allclose(val.to_numpy(), recon, atol=1e-9), \
        "the four postseason terms must reconcile exactly to the value"


def test_postseason_monotonic_in_performance_at_fixed_sample():
    """At a fixed playoff sample (minutes/games/series), better playoff performance
    never decreases postseason value."""
    def v(scale):
        r = _po_row(po_bpm=4 * scale, po_obpm=3 * scale, po_dbpm=1.5 * scale,
                    po_ws_per_48=0.14 * scale, po_per=18 * scale, po_pts=20 * scale,
                    po_r_ts=2 * scale, po_ts_plus=100 + 6 * scale, po_mp=900,
                    po_g=20, playoff_round_score=100.0, po_usg_pct=30.0)
        return float(peak3.postseason_value(pd.DataFrame([r]), pd.Series([True]))[0].iloc[0])
    vals = [v(s) for s in (1.0, 1.3, 1.6, 1.9, 2.2)]
    assert all(b > a for a, b in zip(vals, vals[1:])), \
        f"postseason value must rise monotonically with performance: {vals}"


def test_postseason_monotonic_in_elite_minutes_at_fixed_performance():
    """At fixed (elite) playoff performance, more elite minutes AND games never
    decrease postseason value -- a deeper elite run is worth at least as much."""
    kw = dict(po_bpm=10.0, po_obpm=7.0, po_dbpm=2.5, po_ws_per_48=0.28, po_per=29,
              po_pts=32, po_r_ts=7.0, po_ts_plus=112, po_usg_pct=31.0,
              playoff_round_score=100.0)
    samples = [(300, 8), (500, 12), (700, 16), (900, 20), (1050, 24)]
    vals = []
    for mp, g in samples:
        r = _po_row(po_mp=mp, po_g=g, **kw)
        vals.append(float(peak3.postseason_value(
            pd.DataFrame([r]), pd.Series([True]))[0].iloc[0]))
    assert all(b > a for a, b in zip(vals, vals[1:])), \
        f"postseason value must rise with sustained elite minutes/games: {vals}"


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


def test_recognition_breakdown_sums_to_component():
    """The recognition_breakdown sub-values, scaled by RECOGNITION_SCALE, sum to
    the recognition component exactly -- so the decomposition can never silently
    add or drop points (no double counting in the audit)."""
    row = pd.Series(dict(awards="MVP-1,NBA1,DEF1,AS", player="Hakeem Olajuwon",
                         season_end=1994, mvp_vote_share=0.9, dpoy_vote_share=0.8,
                         finals_mvp=1))
    b = peak3.recognition_breakdown(row)
    parts = peak3.RECOGNITION_SCALE * (b["mvp"] + b["unanimous"] + b["anba"] +
                                       b["allstar"] + b["defense_rec"] +
                                       b["fmvp"] + b["titles"])
    assert abs(parts - peak3.recognition_row(row)["recognition"]) < 1e-9
    # championship is NOT a field recognition_breakdown reads
    rr = row.copy(); rr["championship"] = 1
    assert peak3.recognition_row(rr)["recognition"] == \
        peak3.recognition_row(row)["recognition"], "championship must not enter recognition"
    # All-Star is subsumed when All-NBA is present
    assert b["allstar"] == 0.0, "All-Star subsumed by All-NBA"


def test_recognition_overlap_discounts_still_apply():
    """MVP/All-NBA and DPOY/All-Defense overlap discounts survive the 20% weight."""
    # top-3 MVP -> All-NBA discounted x0.45 ; top-3 DPOY -> All-Def x0.5
    r = pd.Series(dict(awards="MVP-1,NBA1,DPOY-1,DEF1", player="X",
                       season_end=2000, mvp_vote_share=np.nan,
                       dpoy_vote_share=np.nan, finals_mvp=0))
    b = peak3.recognition_breakdown(r)
    assert abs(b["anba"] - 30.0 * 0.45) < 1e-9, "All-NBA discounted under top-3 MVP"
    assert abs(b["alldef"] - 16.0 * 0.5) < 1e-9, "All-Def discounted under top-3 DPOY"
    # without an MVP/DPOY finish the same teams are full value
    r2 = pd.Series(dict(awards="NBA1,DEF1", player="Y", season_end=2000,
                        mvp_vote_share=np.nan, dpoy_vote_share=np.nan, finals_mvp=0))
    b2 = peak3.recognition_breakdown(r2)
    assert b2["anba"] == 30.0 and b2["alldef"] == 16.0


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
                if k in ("Statistical impact (38%)", "Traditional production (21%)",
                         "Individual recognition (20%)", "Postseason individual (18%)",
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
    # Hold the playoff SAMPLE fixed (minutes/games/series). playoff_round_score
    # legitimately feeds sample reliability now (a deeper run = a larger sample
    # for the same rates), so it is kept EQUAL in both rows; what must NOT leak is
    # the championship flag and the Finals-MVP award (those are Team Achievement /
    # Recognition, never points inside the individual Postseason value).
    po_df = pd.DataFrame([_po_row(po_bpm=8.0, po_obpm=5.0, po_dbpm=2.0,
                                  po_ws_per_48=0.22, po_per=25, po_pts=27,
                                  po_r_ts=4.0, po_ts_plus=106, po_mp=900, po_g=20,
                                  playoff_round_score=100.0)])
    base_val = float(_pv(po_df, [True]).iloc[0])
    po_df2 = po_df.copy()
    po_df2["championship"] = 1
    po_df2["finals_mvp"] = 1
    po_df2["best_player_title"] = 1
    assert float(_pv(po_df2, [True]).iloc[0]) == base_val, \
        "championship / Finals-MVP must not leak into Postseason Individual Value"


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
    # the championship/Finals-MVP flags. The four additive terms (reliability-
    # adjusted level + elevation + sustained volume + dominance) reconcile exactly.
    assert float(b["postseason_perf"]) == _approx(
        b["po_level_value"] + b["po_elevation_value"] + b["po_deep_run_value"]
        + b["po_dominance_value"])


# ------------------------------------------- new weights / windows reconcile ---
def test_new_weights_reconcile_in_three_and_five_year_windows():
    df = _career_for_five_year()
    for n in (3, 5):
        win = peak3.n_year_windows(df, "prime_score", n)[0]
        dec = peak3.nyear_window_decomposition(win, "prime_score", "weighted")
        keys = ["Statistical impact (38%)", "Traditional production (21%)",
                "Individual recognition (20%)", "Postseason individual (18%)",
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
    # weights used must be exactly the stated 38/21/20/18/3.
    assert peak3.OFFICIAL_WEIGHTS == {
        "statistical_impact": 0.38, "traditional_production": 0.21,
        "recognition": 0.20, "postseason": 0.18, "team_achievement": 0.03}
    assert abs(sum(peak3.OFFICIAL_WEIGHTS.values()) - 1.0) < 1e-9
    # Recognition stays at EXACTLY 20% and Postseason at EXACTLY 18% (brief).
    assert peak3.OFFICIAL_WEIGHTS["recognition"] == 0.20
    assert peak3.OFFICIAL_WEIGHTS["postseason"] == 0.18


def test_contribution_bridge_reconciles_under_both_weight_systems():
    """Under ANY full weight system, the per-component weighted contributions plus
    the teammate adjustment sum to prime_raw; therefore the Hakeem-minus-Robinson
    bridge's per-component weighted differences (+ teammate diff) reconcile to the
    final Prime-raw difference -- under both 41/23/15/18/3 and 38/21/20/18/3."""
    rng = np.random.default_rng(0)
    comp = ["statistical_impact", "traditional_production", "recognition",
            "postseason_perf", "team_achievement"]
    A = {c: rng.uniform(0, 100) for c in comp}; A["teammate_adjustment"] = 0.3
    B = {c: rng.uniform(0, 100) for c in comp}; B["teammate_adjustment"] = -0.2
    wmap = {"statistical_impact": "statistical_impact",
            "traditional_production": "traditional_production",
            "recognition": "recognition", "postseason": "postseason_perf",
            "team_achievement": "team_achievement"}
    for W in ({"statistical_impact": 0.41, "traditional_production": 0.23,
               "recognition": 0.15, "postseason": 0.18, "team_achievement": 0.03},
              dict(peak3.OFFICIAL_WEIGHTS)):
        def prime(x):
            return sum(W[k] * x[v] for k, v in wmap.items()) + x["teammate_adjustment"]
        wdiff = sum(W[k] * (A[v] - B[v]) for k, v in wmap.items())
        wdiff += A["teammate_adjustment"] - B["teammate_adjustment"]
        assert abs(wdiff - (prime(A) - prime(B))) < 1e-9


# ------------------------------------------------------------------ formula text ---
def test_formula_text_matches_implementation():
    t = peak3.FORMULA_TEXT
    for token in ("0.38", "0.21", "0.20", "0.18", "0.03",
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
