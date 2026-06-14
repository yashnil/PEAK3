"""
Unit tests for the context-enrichment pipeline (no network required).

Run:
    python tests/test_context.py
    # or: python -m pytest tests/ -q
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import peak3  # noqa: E402
from nba_peak.context import postseason as ps  # noqa: E402
from nba_peak.context import stat_titles as st  # noqa: E402
from nba_peak.context import teammates as tm  # noqa: E402
from nba_peak.context import title_role as tr  # noqa: E402
from nba_peak.context.awards import parse_awards_row  # noqa: E402
from nba_peak import candidates as cand  # noqa: E402


# ----------------------------------------------------------- bracket parsing ---

class _FakeEl:
    """Minimal stand-in not needed; we build series dicts directly below."""


def _series(rnd, w, l, ws, ls):
    return {"round": rnd, "round_depth": ps.ROUND_DEPTH[rnd],
            "winner": w, "loser": l, "w": ws, "l": ls}


def _teams_df(season, rows):
    return pd.DataFrame([{"season_end": season, "team": t, "team_wins": w,
                          "team_losses": 82 - w, "team_srs": s,
                          "team_net_rtg": s, "team_drtg": 108}
                         for t, w, s in rows])


def test_postseason_champion_and_finals_flags():
    series = [
        _series("Finals", "AAA", "BBB", 4, 2),
        _series("Conference Finals", "AAA", "CCC", 4, 1),
        _series("Conference Finals", "BBB", "DDD", 4, 3),
        _series("Conference Semifinals", "AAA", "EEE", 4, 0),
    ]
    teams = _teams_df(2000, [("AAA", 60, 6), ("BBB", 55, 4), ("CCC", 50, 2),
                             ("DDD", 48, 1), ("EEE", 45, 0)])
    out = ps.derive_team_postseason(series, teams, 2000)
    aaa = out[out["team"] == "AAA"].iloc[0]
    assert aaa["championship"] == 1
    assert aaa["finals_appearance"] == 1
    assert aaa["conf_finals"] == 1
    assert aaa["playoff_round_score"] == 100.0
    bbb = out[out["team"] == "BBB"].iloc[0]
    assert bbb["championship"] == 0
    assert bbb["finals_appearance"] == 1
    assert bbb["playoff_round_score"] == 85.0       # finals loss
    ccc = out[out["team"] == "CCC"].iloc[0]
    assert ccc["conf_finals"] == 1 and ccc["finals_appearance"] == 0
    assert ccc["playoff_round_score"] == 70.0       # conf finals loss


def test_postseason_round_score_first_round():
    series = [_series("Finals", "AAA", "BBB", 4, 0),
              _series("First Round", "AAA", "ZZZ", 4, 1)]
    teams = _teams_df(2001, [("AAA", 60, 6), ("BBB", 55, 4), ("ZZZ", 30, -3)])
    out = ps.derive_team_postseason(series, teams, 2001)
    zzz = out[out["team"] == "ZZZ"].iloc[0]
    assert zzz["playoff_round_score"] == 30.0       # first-round loss


def test_canonical_round_handles_prefixes():
    assert ps._canonical_round("Eastern Conference Finals") == "Conference Finals"
    assert ps._canonical_round("Western Conference Semifinals") == "Conference Semifinals"
    assert ps._canonical_round("Eastern Conference First Round") == "First Round"
    assert ps._canonical_round("Finals") == "Finals"


# ------------------------------------------------------------- stat titles ---

def test_stat_titles_scoring_leader_and_5040_90():
    pg = pd.DataFrame({
        "player": ["Scorer", "Shooter", "Bench"],
        "g": [80, 78, 12],
        "pts": [30.0, 20.0, 25.0],   # Bench has high ppg but too few games
        "ast": [5, 9, 1], "trb": [6, 5, 2], "stl": [1, 2, 0], "blk": [1, 0, 0],
        "fg_pct": [0.50, 0.52, 0.60], "threep_pct": [0.30, 0.45, 0.40],
        "ft_pct": [0.80, 0.92, 0.95],
        "fg": [10, 7, 9], "threep": [1, 3, 2], "ft": [6, 4, 5],
    })
    out = st.derive_stat_titles(pg, 2015)
    scorer = out[out["player"] == "Scorer"].iloc[0]
    assert scorer["scoring_title"] == 1            # qualified leader, not Bench
    shooter = out[out["player"] == "Shooter"].iloc[0]
    assert shooter["fifty_forty_ninety"] == 1      # .52/.45/.92 with volume
    assert scorer["fifty_forty_ninety"] == 0


# -------------------------------------------------------------- teammates ---

def test_teammate_strength_excludes_self_and_caps_adjustment():
    reg = pd.DataFrame({
        "player": ["Star", "Helper", "Scrub", "Solo"],
        "season_end": [2010, 2010, 2010, 2010],
        "team": ["AAA", "AAA", "AAA", "BBB"],
        "mp": [2800, 2400, 1500, 2800],
        "bpm": [9.0, 3.0, -1.0, 8.0],
        "vorp": [7.0, 3.0, 0.2, 6.5],
        "WS": [13.0, 6.0, 1.0, 12.0],
        "awards": ["MVP-1, NBA1, AS", "AS", "", "NBA2, AS"],
    })
    out = tm.derive_teammates(reg)
    star = out[out["player"] == "Star"].iloc[0]
    solo = out[out["player"] == "Solo"].iloc[0]
    # Star has real teammates -> higher supporting cast than Solo (no teammates).
    assert star["top_teammate_value"] > 0
    assert abs(star["teammate_adjustment"]) <= 5.0
    assert solo["teammate_adjustment"] == 0.0       # no teammates -> neutral


# ------------------------------------------------------------- title role ---

def test_title_role_best_and_secondary():
    roster = pd.DataFrame({
        "player": ["Engine", "Big", "Role1", "DNP"],
        "reg_bpm": [8.0, 4.0, 0.0, -1.0],
        "po_bpm": [9.0, 3.0, -0.5, 0.0],
        "po_mp": [800, 700, 400, 10],
        "po_pts": [30, 18, 8, 2],
        "finals_mvp": [1, 0, 0, 0],
        "mvp_rank": [2, np.nan, np.nan, np.nan],
        "all_nba_team": [1, 2, np.nan, np.nan],
    })
    out = tr.classify_title_team(roster)
    eng = out[out["player"] == "Engine"].iloc[0]
    dnp = out[out["player"] == "DNP"].iloc[0]
    assert eng["best_player_title"] == 1
    assert eng["title_team_role"] in ("Clear best player", "Co-best / ambiguous")
    assert dnp["title_team_role"] == "Did not play meaningful postseason minutes"


# ------------------------------------------------------------- awards ---

def test_parse_awards_row():
    r = parse_awards_row("MVP-1, NBA1, DEF1, AS")
    assert r["mvp_rank"] == 1 and r["all_nba_team"] == 1
    assert r["all_defense_team"] == 1 and r["all_star"] == 1
    assert r["mvp_score"] == 100.0
    assert parse_awards_row(np.nan)["mvp_rank"] is None


# ------------------------------------------------------------- candidates ---

def _mini_scored():
    rows = []
    profiles = {
        "Star A": (90, "MVP-1, NBA1, AS"),
        "Star B": (85, "NBA2, AS"),         # All-NBA 2nd -> mandatory
        "Defense Star": (70, "DEF1, DPOY-1"),  # weaker box, strong D, no All-NBA
        "Role Guy": (76, ""),               # high stat, NO All-NBA -> excluded
        "Journeyman": (55, ""),
    }
    for p, (base, aw) in profiles.items():
        for k, se in enumerate((2001, 2002, 2003)):
            rows.append({"player": p, "season": f"{se-1}-{str(se)[-2:]}",
                         "season_end": se, "stat_total": base + k,
                         "awards": aw, "mp": 2000, "mpg": 32, "usg_pct": 24,
                         "vorp": 4.0, "role": "Secondary star",
                         "workload_qualified": 1})
    return pd.DataFrame(rows)


def test_candidate_mandatory_all_nba_inclusion():
    scored = _mini_scored()
    cands, excl = cand.build_candidates(scored, stat_count=1)
    players = set(cands["player"])
    # All-NBA players (any team) are mandatory regardless of the stat cutoff
    assert "Star A" in players and "Star B" in players
    # Star B made only All-NBA 2nd team but is still mandatory
    assert cands[cands.player == "Star B"].iloc[0]["mandatory_all_nba_qualifier"]


def test_candidate_count_cutoff_cannot_drop_mandatory():
    scored = _mini_scored()
    cands, _ = cand.build_candidates(scored, stat_count=0)  # zero discretionary
    # mandatory accolade qualifiers must survive a 0 statistical cutoff
    assert "Star A" in set(cands["player"])
    assert "Defense Star" in set(cands["player"])  # DPOY route


def test_candidate_defense_first_star_via_dpoy():
    scored = _mini_scored()
    cands, _ = cand.build_candidates(scored, stat_count=2)
    row = cands[cands["player"] == "Defense Star"]
    assert len(row) == 1
    assert "DPOY" in row.iloc[0]["selection_reasons"]


def test_role_player_without_all_nba_excluded():
    scored = _mini_scored()
    cands, excl = cand.build_candidates(scored, stat_count=2)
    # "Role Guy": high stat but no accolade and outside small stat pool
    assert "Role Guy" not in set(cands["player"])
    assert "Role Guy" in set(excl["player"])


# --------------------------------------------------- override precedence ---

def test_apply_override_manual_wins_and_reports(capsys=None):
    base = pd.DataFrame({
        "player": ["A B", "C D"], "season_end": [2006, 2010],
        "championship": [0.0, 1.0],         # auto-derived values
        "finals_mvp": [0.0, 0.0],
    })
    override = pd.DataFrame({
        "player": ["A B"], "season_end": [2006],
        "championship": [1.0], "finals_mvp": [1.0],  # manual correction
    })
    out = peak3._apply_override(base, override,
                               ["championship", "finals_mvp"], "manual")
    a = out[out["player"] == "A B"].iloc[0]
    c = out[out["player"] == "C D"].iloc[0]
    assert a["championship"] == 1.0 and a["finals_mvp"] == 1.0   # manual wins
    assert c["championship"] == 1.0                              # untouched auto value


def test_apply_override_absent_keeps_auto():
    base = pd.DataFrame({"player": ["A B"], "season_end": [2006],
                         "championship": [1.0]})
    override = pd.DataFrame({"player": ["Z Z"], "season_end": [1999],
                             "championship": [1.0]})
    out = peak3._apply_override(base, override, ["championship"], "manual")
    assert out[out["player"] == "A B"].iloc[0]["championship"] == 1.0


# ------------------------------------------------------ coverage breakdown ---

def test_coverage_breakdown_sums_to_100():
    df = pd.DataFrame({
        "championship": [1, 0, 0], "finals_appearance": [1, 0, 0],
        "conf_finals": [1, 0, 0], "finals_mvp": [1, 0, 0],
        "playoff_round_score": [100.0, 30.0, 10.0], "all_star": [1, 1, 0],
        "made_playoffs": [True, True, False],
        "opponent_quality_score": [80.0, np.nan, np.nan],
        "series_success_score": [90.0, 40.0, np.nan],
        "playoff_path_difficulty": [70.0, 50.0, np.nan],
        "teammate_strength_score": [40.0, np.nan, 60.0],
    })
    obs, est, mis = peak3.coverage_breakdown(df)
    assert abs(obs + est + mis - 100.0) < 1e-6
    assert obs > 0 and est > 0


# ----------------------------------------------- decomposition additivity ---

def test_window_buckets_sum_to_raw_legacy_window_score():
    # Buckets reconcile to the RAW (pre-calibration) season-weighted legacy
    # window score. Calibration is a separate monotonic final rescale.
    n = 3
    W = peak3.OFFICIAL_WEIGHTS
    si = [90.0, 95.0, 88.0]; tp = [70.0, 75.0, 60.0]
    recog = [80.0, 60.0, 40.0]; po = [70.0, 65.0, 55.0]; team = [80.0, 60.0, 40.0]
    tmadj = [0.4, -0.4, 0.0]
    # per-season open-index contributions, exactly as score_dataset builds them
    c_si = [W["statistical_impact"] * si[i] for i in range(n)]
    c_tp = [W["traditional_production"] * tp[i] for i in range(n)]
    c_rec = [W["recognition"] * recog[i] for i in range(n)]
    c_po = [W["postseason"] * po[i] for i in range(n)]
    c_team = [W["team_achievement"] * team[i] for i in range(n)]
    legacy_raw = [c_si[i] + c_tp[i] + c_rec[i] + c_po[i] + c_team[i] + tmadj[i]
                  for i in range(n)]
    legacy_total = [peak3.calibrate_score(pd.Series([v])).iloc[0] for v in legacy_raw]
    df = pd.DataFrame({
        "player": ["X"] * n, "team": ["AAA"] * n,
        "season_end": [2011, 2012, 2013],
        "season": ["2010-11", "2011-12", "2012-13"],
        "legacy_total": legacy_total, "legacy_raw": legacy_raw,
        "contrib_statistical_impact": c_si,
        "contrib_traditional_production": c_tp,
        "contrib_recognition": c_rec,
        "contrib_postseason": c_po,
        "contrib_team_achievement": c_team,
        "teammate_adjustment": tmadj,
        "made_playoffs": [True, True, True],
    })
    w = peak3.best_window(df, "legacy_total", "weighted")
    # raw window score with the same season weights the buckets use
    trio = w["df"]
    weights, _ = peak3._season_weights(trio, "legacy_total", "weighted")
    raw_window = sum(wt * lr for wt, lr in zip(weights, trio["legacy_raw"]))
    buckets = peak3.window_buckets(w, "weighted")
    assert abs(sum(buckets.values()) - raw_window) < 1e-6


# ----------------------------------------------------------------- runner ---

def _run_all():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"  ok  {fn.__name__}")
    print(f"\n{len(fns)}/{len(fns)} context tests passed.")


if __name__ == "__main__":
    _run_all()
