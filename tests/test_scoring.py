"""
Tests for the OFFICIAL five-component open weighted index (replaces the old
pathway model):
  STATISTICAL IMPACT 45 | TRADITIONAL PRODUCTION 25 | RECOGNITION 20 |
  POSTSEASON INDIVIDUAL 7 | TEAM ACHIEVEMENT 3.

Each component is built from RAW metric values via metric-specific continuous
formulas (no percentiles / z-scores / landmark caps / 100-clips). The index is
open; calibration is a separate monotonic relabel.

Run: python tests/test_scoring.py   (no network)
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import peak3  # noqa: E402
from nba_peak.context.teammates import derive_teammates  # noqa: E402


# ---- synthetic league: 1 superstar scorer, 1 efficient role big, 1 filler ----
def _league(season_end=2015, n_filler=30):
    rows = []
    rows.append(dict(player="Volume Star", season_end=season_end, team="AAA",
                     g=80, mp=2900, usg_pct=31, pts=34, ast=6, trb=6, stl=1.4,
                     blk=0.4, tov=3, bpm=7.0, obpm=6.0, dbpm=1.0, vorp=6.5,
                     WS=14, ws_per_48=0.22, per=26, ts_pct=0.60,
                     ast_pct=28, trb_pct=9, stl_pct=1.8, blk_pct=1.0,
                     ftr=0.45, threepar=0.3, awards="NBA1, AS"))
    rows.append(dict(player="Role Big", season_end=season_end, team="BBB",
                     g=80, mp=1700, usg_pct=22, pts=24, ast=2, trb=9, stl=0.8,
                     blk=1.4, tov=2, bpm=3.2, obpm=2.0, dbpm=1.2, vorp=2.2,
                     WS=7, ws_per_48=0.19, per=22, ts_pct=0.64,
                     ast_pct=10, trb_pct=16, stl_pct=1.3, blk_pct=3.2,
                     ftr=0.4, threepar=0.05, awards=""))
    for i in range(n_filler):
        rows.append(dict(player=f"Filler {i}", season_end=season_end,
                         team=f"T{i%10}", g=78 + (i % 5), mp=1500 + i * 10,
                         usg_pct=15 + i % 8, pts=12 + i % 6, ast=3, trb=5,
                         stl=0.7, blk=0.4, tov=2, bpm=-1 + i * 0.1,
                         obpm=-0.5, dbpm=-0.3, vorp=0.5 + i * 0.05,
                         WS=3, ws_per_48=0.10, per=13, ts_pct=0.53,
                         ast_pct=12, trb_pct=8, stl_pct=1.0, blk_pct=0.8,
                         ftr=0.25, threepar=0.3, awards=""))
    df = pd.DataFrame(rows)
    df["season_start"] = season_end - 1
    df["season"] = f"{season_end-1}-{str(season_end)[-2:]}"
    df["is_playoffs"] = False
    for c in peak3.OPTIONAL_CONTEXT_COLS + peak3.OPTIONAL_IMPACT_COLS + peak3.OPTIONAL_TITLE_COLS:
        df[c] = np.nan
    for c in ("team_wins", "team_srs", "team_net_rtg", "team_drtg"):
        df[c] = np.nan
    return df


def _score():
    return peak3.score_dataset(_league(), pd.DataFrame())


# ---------- continuous raw-value formulas (no caps / no percentiles) ----------

def test_impact_value_continuous_monotonic_uncapped():
    # plus/minus -> points: monotone, and NEVER flattens to a 100-cap
    xs = np.array([0.0, 3.0, 6.0, 9.0, 12.0, 15.0, 18.0])
    ys = peak3._impact_value(xs, -2.0, 8.0)
    assert all(ys[i] < ys[i + 1] for i in range(len(ys) - 1))
    # beyond the knee, 12 vs 15 vs 18 must still separate (no hard clip at 100)
    assert ys[-1] > ys[-2] > ys[-3]
    assert ys[-1] > 100.0          # genuinely open above 100


def test_hinge_value_zero_below_threshold():
    # average/irrelevant production contributes ~0 (it never lowers the score)
    below = peak3._hinge_value(np.array([0.0, 3.4]), 3.5, 6.0)
    assert np.allclose(below, 0.0)
    above = peak3._hinge_value(np.array([6.0, 11.0]), 3.5, 6.0)
    assert above[0] < above[1]
    assert (above > 0).all()


def test_statistical_impact_uses_raw_metric_magnitude():
    # higher raw BPM/VORP/WS48/PER -> higher statistical-impact component
    df = _league(n_filler=10)
    base = df[df.player == "Volume Star"].iloc[0].to_dict()
    hi = dict(base); hi.update(player="Hi", bpm=11.9, vorp=9.5, ws_per_48=0.318,
                               per=31.5, obpm=10.3, WS=18)
    lo = dict(base); lo.update(player="Lo", bpm=9.9, vorp=7.9, ws_per_48=0.288,
                               per=28.0, obpm=8.2, WS=15)
    df2 = pd.concat([df, pd.DataFrame([hi, lo])], ignore_index=True)
    sc = peak3.score_dataset(df2, pd.DataFrame())
    h = sc[sc.player == "Hi"].iloc[0]
    l = sc[sc.player == "Lo"].iloc[0]
    assert h["statistical_impact"] > l["statistical_impact"] + 2.0
    assert h["prime_raw"] > l["prime_raw"]


def test_missing_modern_metric_does_not_penalize():
    # no EPM/LEBRON supplied: classic statistical impact carries full 45% weight
    s = _score()
    assert s["statistical_impact"].notna().all()
    assert s["prime_raw"].notna().all()
    # adding a strong modern metric should never LOWER the score
    df = _league(n_filler=10)
    df.loc[df.player == "Volume Star", "epm"] = 6.0
    sc = peak3.score_dataset(df, pd.DataFrame())
    star = sc[sc.player == "Volume Star"].iloc[0]
    plain = _score()
    pstar = plain[plain.player == "Volume Star"].iloc[0]
    assert star["statistical_impact"] >= pstar["statistical_impact"] - 1e-6


# ---------------- traditional production (nonlinear scoring) ------------------

def test_volume_star_outscores_role_big_on_scoring_and_index():
    s = _score()
    star = s[s.player == "Volume Star"].iloc[0]
    big = s[s.player == "Role Big"].iloc[0]
    # nonlinear scoring value: high volume + good efficiency beats efficient
    # low-volume finishing by a wide margin
    assert star["scoring_dominance"] > big["scoring_dominance"] + 10
    # and the open index clearly separates them
    assert star["prime_raw"] > big["prime_raw"] + 5


def test_average_offrole_skill_contributes_about_zero():
    # the Role Big's ordinary playmaking must not drag his production negative
    s = _score()
    big = s[s.player == "Role Big"].iloc[0]
    assert big["playmaking"] >= 0.0
    assert big["traditional_production"] > 0.0


# ----------------------- recognition (additive, grouped) ---------------------

def test_recognition_additive_and_grouped():
    # MVP + All-NBA1 must NOT count as two independent full bonuses
    mvp_an = peak3.recognition_row(pd.Series({"awards": "MVP-1, NBA1, AS"}))
    plain_an = peak3.recognition_row(pd.Series({"awards": "NBA1, AS"}))
    # the All-NBA increment on top of MVP is discounted (grouped)
    only_mvp = peak3.recognition_row(pd.Series({"awards": "MVP-1, AS"}))
    an_increment = mvp_an["recognition"] - only_mvp["recognition"]
    assert 0 < an_increment < plain_an["recognition"]


def test_championship_not_in_recognition():
    # a championship/team result must not appear in individual recognition
    r = peak3.recognition_row(pd.Series({"awards": "NBA2, AS",
                                         "championship": 1,
                                         "best_player_title": 1}))
    r_noring = peak3.recognition_row(pd.Series({"awards": "NBA2, AS"}))
    assert r["recognition"] == r_noring["recognition"]


def test_finals_mvp_adds_individual_recognition():
    a = peak3.recognition_row(pd.Series({"awards": "NBA1", "finals_mvp": 1}))
    b = peak3.recognition_row(pd.Series({"awards": "NBA1", "finals_mvp": 0}))
    assert a["recognition"] > b["recognition"]


def test_statistical_award_excluded_from_performance():
    # awards move PRIME (recognition) but NOT performance_only
    df = _league()
    df2 = df.copy()
    df2.loc[df2.player == "Role Big", "awards"] = "MVP-1, NBA1, AS"
    s_plain = peak3.score_dataset(df, pd.DataFrame())
    s_awarded = peak3.score_dataset(df2, pd.DataFrame())
    a = s_plain[s_plain.player == "Role Big"].iloc[0]
    b = s_awarded[s_awarded.player == "Role Big"].iloc[0]
    assert abs(a["performance_only"] - b["performance_only"]) < 1e-6
    assert b["prime_score"] > a["prime_score"]


# ---------------------- the open weighted index reconciles --------------------

def test_official_weights_sum_to_one():
    assert abs(sum(peak3.OFFICIAL_WEIGHTS.values()) - 1.0) < 1e-9


def test_prime_index_reconciles_to_component_contributions():
    s = _score()
    r = s[s.player == "Volume Star"].iloc[0]
    recon = (r["contrib_statistical_impact"] + r["contrib_traditional_production"]
             + r["contrib_recognition"] + r["contrib_postseason"]
             + r["contrib_team_achievement"] + r["teammate_adjustment"])
    assert abs(recon - r["prime_raw"]) < 1e-6


def test_index_is_open_not_hard_clipped_at_100():
    # no intermediate component nor the index is clipped to 100 mid-computation
    s = _score()
    assert s["prime_raw"].max() < 130          # open, but realistic inputs
    # statistical impact for an apex profile genuinely exceeds 100
    df = _league(n_filler=10)
    base = df[df.player == "Volume Star"].iloc[0].to_dict()
    goat = dict(base); goat.update(player="Goat", bpm=13.0, obpm=10.0, dbpm=3.0,
                                   vorp=11.0, WS=20, ws_per_48=0.33, per=32)
    df2 = pd.concat([df, pd.DataFrame([goat])], ignore_index=True)
    sc = peak3.score_dataset(df2, pd.DataFrame())
    assert sc[sc.player == "Goat"].iloc[0]["statistical_impact"] > 100.0


def test_higher_raw_metric_scores_higher_when_others_equal():
    df = _league(n_filler=40)
    base = df[df.player == "Volume Star"].iloc[0].to_dict()
    hi = dict(base); hi.update(player="Hi Star", bpm=11.9, vorp=9.5,
                               ws_per_48=0.318, per=31.5, pts=42, obpm=10.3, WS=18)
    lo = dict(base); lo.update(player="Lo Star", bpm=9.9, vorp=7.9,
                               ws_per_48=0.288, per=28.0, pts=35, obpm=8.2, WS=15)
    df2 = pd.concat([df, pd.DataFrame([hi, lo])], ignore_index=True)
    sc = peak3.score_dataset(df2, pd.DataFrame())
    h = sc[sc.player == "Hi Star"].iloc[0]
    l = sc[sc.player == "Lo Star"].iloc[0]
    assert h["statistical_impact"] > l["statistical_impact"] + 2.0
    assert h["scoring_dominance"] > l["scoring_dominance"] + 1.0
    assert h["prime_raw"] > l["prime_raw"] + 1.0


# -------------------------- workload / role flags ----------------------------

def test_role_player_not_classified_primary():
    s = _score()
    big = s[s.player == "Role Big"].iloc[0]
    assert big["role"] in ("High-impact role player", "Defensive anchor",
                            "Secondary star", "Low-minute specialist")
    star = s[s.player == "Volume Star"].iloc[0]
    assert "Primary" in star["role"] or star["role"] == "Two-way engine"


def test_provisional_flag_on_incomplete_season():
    df = _league(season_end=2026)
    df["g"] = 40
    s = peak3.score_dataset(df, pd.DataFrame())
    assert (s["provisional"] == 1).all()
    full = _score()
    assert (full["provisional"] == 0).all()


# ------------------------------ teammate sign --------------------------------

def test_teammate_adjustment_sign():
    reg = pd.DataFrame({
        "player": ["Weak Help Star", "Mate1",
                   "Strong Help Star", "Mate2", "Mate3"],
        "season_end": [2010] * 5,
        "team": ["AAA", "AAA", "BBB", "BBB", "BBB"],
        "mp": [2800, 1200, 2800, 2600, 2400],
        "bpm": [8, -1, 8, 6, 5],
        "vorp": [7, 0.1, 7, 5, 4],
        "WS": [12, 1, 12, 10, 9],
        "awards": ["NBA1, AS", "", "NBA1, AS", "NBA2, AS", "AS"],
    })
    tm = derive_teammates(reg)
    weak = tm[tm.player == "Weak Help Star"].iloc[0]
    strong = tm[tm.player == "Strong Help Star"].iloc[0]
    assert weak["teammate_adjustment"] >= 0
    assert strong["teammate_adjustment"] <= 0
    assert weak["teammate_strength_score"] < strong["teammate_strength_score"]


def _run_all():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  ok  {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} scoring tests passed.")


if __name__ == "__main__":
    _run_all()
