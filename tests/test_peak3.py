"""
Unit tests for peak3.py - pure-logic tests (no network required).

Run:
    python -m pytest tests/ -q          # if pytest installed
    python tests/test_peak3.py          # plain-stdlib fallback runner
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import peak3  # noqa: E402


# ---------------------------------------------------------------- matching ---

def _scored_stub(players):
    return pd.DataFrame({"player": players})


def test_match_exact_and_case_insensitive():
    s = _scored_stub(["LeBron James", "Kobe Bryant"])
    assert peak3.match_player(s, "LeBron James") == "LeBron James"
    assert peak3.match_player(s, "lebron james") == "LeBron James"
    assert peak3.match_player(s, "LEBRON JAMES") == "LeBron James"


def test_match_accents_and_punctuation():
    s = _scored_stub(["Nikola Jokic", "Shaquille O'Neal"])
    assert peak3.match_player(s, "Nikola Jokić") == "Nikola Jokic"
    assert peak3.match_player(s, "shaquille oneal") == "Shaquille O'Neal"


def test_match_nickname_and_fuzzy():
    s = _scored_stub(["LeBron James", "Kevin Garnett", "Dwyane Wade"])
    assert peak3.match_player(s, "kg") == "Kevin Garnett"
    assert peak3.match_player(s, "Dwane Wade") == "Dwyane Wade"  # typo


# ----------------------------------------------------------- traded players ---

def test_collapse_traded_prefers_total_row():
    df = pd.DataFrame({
        "player": ["Traded Guy", "Traded Guy", "Traded Guy"],
        "team": ["TOT", "LAL", "BOS"],
        "mp": [2000, 1200, 800],
        "bpm": [5.0, 4.0, 6.0],
    })
    out = peak3.collapse_traded(df)
    assert len(out) == 1
    assert out.iloc[0]["team"] == "TOT"


def test_collapse_traded_max_minutes_when_no_total():
    df = pd.DataFrame({
        "player": ["No Total", "No Total"],
        "team": ["LAL", "BOS"],
        "mp": [1200, 800],
    })
    out = peak3.collapse_traded(df)
    assert len(out) == 1
    assert out.iloc[0]["team"] == "LAL"


# --------------------------------------------------- weighted-available core ---

def test_wavail_skips_missing_and_renormalizes():
    df = pd.DataFrame({"a_pct": [80.0], "b_pct": [np.nan]})
    # b missing -> should equal a's value, not be dragged toward 0
    val = peak3.wavail(df, {"a_pct": 0.5, "b_pct": 0.5}).iloc[0]
    assert abs(val - 80.0) < 1e-9


def test_wavail_neutral_when_all_missing():
    df = pd.DataFrame({"a_pct": [np.nan]})
    val = peak3.wavail(df, {"a_pct": 1.0}).iloc[0]
    assert val == 50.0


# -------------------------------------------------------- percentile engine ---

def test_add_percentiles_basic_ordering():
    df = pd.DataFrame({
        "season_end": [2000, 2000, 2000, 2000],
        "mp": [2000, 2000, 2000, 2000],
        "bpm": [1.0, 2.0, 3.0, 4.0],
    })
    qual = pd.Series([True] * 4)
    out = peak3.add_percentiles(df, ["bpm"], qualifier=qual, mode="percentile")
    pct = out["bpm_pct"].tolist()
    assert pct[0] < pct[-1]            # higher BPM -> higher percentile
    assert pct[-1] == 100.0
    # hybrid mode preserves ordering and stays bounded
    outh = peak3.add_percentiles(df, ["bpm"], qualifier=qual, mode="hybrid")
    h = outh["bpm_pct"].tolist()
    assert h[0] < h[-1] and 0 <= h[-1] <= 100


def test_add_percentiles_inverse_metric():
    df = pd.DataFrame({
        "season_end": [2000, 2000, 2000],
        "tov": [1.0, 2.0, 3.0],
    })
    qual = pd.Series([True] * 3)
    out = peak3.add_percentiles(df, ["tov"], qualifier=qual, inverse=["tov"])
    # fewer turnovers should score higher
    assert out["tov_pct"].iloc[0] > out["tov_pct"].iloc[2]


# ------------------------------------------------------------- 3yr windows ---

def _player_df(scores):
    n = len(scores)
    return pd.DataFrame({
        "player": ["X"] * n,
        "team": ["AAA"] * n,
        "season_end": list(range(2001, 2001 + n)),
        "season": [f"{y-1}-{str(y)[-2:]}" for y in range(2001, 2001 + n)],
        "stat_total": scores,
        "legacy_total": scores,
        "regular": scores,
        "playoff": scores,
        "team_score": [50.0] * n,
        "durability": [100.0] * n,
        "made_playoffs": [True] * n,
    })


def test_window_picks_highest_weighted_trio():
    # best three consecutive should be the last three (highest)
    pdf = _player_df([40, 50, 60, 90, 95, 99])
    bw = peak3.best_window(pdf, "stat_total")
    assert bw["seasons"] == ["2003-04", "2004-05", "2005-06"]


def test_window_weighting_orders_best_first():
    pdf = _player_df([100, 50, 50])  # one elite + two mid
    bw = peak3.best_window(pdf, "stat_total")
    expected = 0.40 * 100 + 0.35 * 50 + 0.25 * 50
    assert abs(bw["peak_score"] - expected) < 1e-9


def test_window_requires_consecutive_years():
    pdf = _player_df([90, 90, 90])
    pdf.loc[1, "season_end"] = 2010  # break consecutiveness
    pdf.loc[1, "season"] = "2009-10"
    assert peak3.best_window(pdf, "stat_total") is None


# ------------------------------------------------------------- durability ---

def test_durability_full_vs_partial_and_short_season():
    df = pd.DataFrame({
        "g": [82, 41, 50],
        "season_end": [2019, 2019, 1999],  # 1999 had 50 team games
    })
    dur = peak3.durability_series(df)
    assert dur.iloc[0] == 100.0          # full season
    assert dur.iloc[1] < 100.0           # half season
    assert dur.iloc[2] == 100.0          # 50/50 in shortened 1999


# --------------------------------------------------------------- accolades ---

def test_accolade_mvp_and_allnba_from_awards():
    row = pd.Series({"awards": "MVP-1, NBA1, DEF1, AS"})
    out = peak3.accolade_row(row)
    assert out["mvp_component"] == 100.0
    assert out["all_nba_component"] == 100.0
    assert out["defense_component"] == 100.0
    assert out["accolade"] > 0


def test_accolade_zero_when_no_awards():
    row = pd.Series({"awards": np.nan})
    out = peak3.accolade_row(row)
    assert out["mvp_component"] == 0.0
    assert out["accolade"] == 0.0


# ------------------------------------------------- missing playoff handling ---

def test_score_dataset_handles_no_playoffs_without_crashing():
    # two qualifying players, three seasons each, no playoff data at all
    rows = []
    for p in ["Alpha Beta", "Gamma Delta"]:
        for se in (2001, 2002, 2003):
            rows.append({
                "player": p, "team": "AAA", "season_end": se,
                "season_start": se - 1, "season": f"{se-1}-{str(se)[-2:]}",
                "is_playoffs": False, "mp": 2000, "g": 80,
                "bpm": 5.0, "vorp": 4.0, "ws_per_48": 0.20, "per": 25.0,
                "ts_pct": 0.60, "usg_pct": 28.0,
                "pts": 30.0, "trb": 8.0, "ast": 6.0, "stl": 1.5, "blk": 0.8,
                "tov": 3.0, "ftr": 0.4, "ft_pct": 0.85, "threepar": 0.3,
                "ast_pct": 25.0, "trb_pct": 10.0, "stl_pct": 2.0, "blk_pct": 2.0,
                "obpm": 4.0, "dbpm": 1.0, "awards": "",
            })
    regular = pd.DataFrame(rows)
    for c in peak3.OPTIONAL_CONTEXT_COLS + peak3.OPTIONAL_IMPACT_COLS + peak3.OPTIONAL_TITLE_COLS:
        regular[c] = np.nan
    for c in ("team_wins", "team_srs", "team_net_rtg"):
        regular[c] = np.nan
    scored = peak3.score_dataset(regular, pd.DataFrame())
    assert len(scored) == 6
    # zero-baseline: no playoffs -> postseason value (and its display) is 0,
    # never a positive default (was 15.0 before the correction pass).
    assert (scored["playoff"] == 0.0).all()
    assert (scored["postseason_perf"] == 0.0).all()
    assert scored["stat_total"].notna().all()
    bw = peak3.best_window(scored[scored["player"] == "Alpha Beta"], "stat_total")
    assert bw is not None


# ----------------------------------------------------------------- runner ---

def _run_all():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  ok  {fn.__name__}")
    print(f"\n{passed}/{len(fns)} tests passed.")


if __name__ == "__main__":
    _run_all()
