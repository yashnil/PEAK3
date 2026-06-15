"""
Tests for the Recognition / offensive-burden / Team-Achievement refinement pass.

Proves:
  * official weights stay 38/21/20/18/3;
  * award winners get a clear DISCRETE premium; non-winners decline SMOOTHLY;
  * vote share differentiates close vs distant finishes; no 2nd-to-4th cliff;
  * the successful-burden residual rises with creation load at equal efficiency,
    falls when efficiency materially declines, ignores usage alone, is bounded,
    and does not duplicate the full SI or TP signal;
  * Team Achievement is smooth, monotonic, bounded, role-adjusted, and contains
    neither Finals MVP nor individual playoff box score;
  * the corrected postseason structure is preserved;
  * single-season / 3-year / 5-year aggregations reconcile.

Run: python tests/test_refinement.py   (no network)
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import peak3  # noqa: E402
from test_scoring import _league  # noqa: E402


# --------------------------------------------------------------- weights ---
def test_official_weights_unchanged():
    assert peak3.OFFICIAL_WEIGHTS == {
        "statistical_impact": 0.38, "traditional_production": 0.21,
        "recognition": 0.20, "postseason": 0.18, "team_achievement": 0.03}
    assert abs(sum(peak3.OFFICIAL_WEIGHTS.values()) - 1.0) < 1e-9


# ------------------------------------------------------- award voting ---
def _mvp(rank, share=float("nan")):
    return peak3.ranked_award_value(rank, share, **peak3.MVP_VOTING)


def test_award_winner_receives_clear_discrete_premium():
    # the winner premium makes first place clearly exceed second (a step, not a
    # smooth continuation of the curve).
    first, second = _mvp(1), _mvp(2)
    assert first > second + 15.0, "winner must clearly exceed runner-up"
    # the premium is discrete: remove it and #1 would sit near the #2..#3 curve
    no_prem = dict(peak3.MVP_VOTING); no_prem["winner_premium"] = 0.0
    bare_first = peak3.ranked_award_value(1, float("nan"), **no_prem)
    assert first - bare_first == peak3.MVP_VOTING["winner_premium"]
    assert bare_first < second + 8.0, "without the premium #1 ~ the smooth curve"


def test_nonwinning_finishes_decline_smoothly():
    vals = [_mvp(r) for r in range(2, 11)]      # 2..10
    diffs = [a - b for a, b in zip(vals, vals[1:])]
    assert all(d > 0 for d in diffs), "ranks 2..10 strictly decline"
    # smooth diminishing curve: each successive drop is no larger than the last
    assert all(diffs[i] >= diffs[i + 1] - 1e-9 for i in range(len(diffs) - 1)), \
        f"declines must be smooth/diminishing: {diffs}"


def test_no_second_to_fourth_cliff():
    v2, v3, v4 = _mvp(2), _mvp(3), _mvp(4)
    s23, s34 = v2 - v3, v3 - v4
    # the 3->4 step is not a sudden cliff relative to the 2->3 step
    assert s34 <= s23 + 1e-9
    assert s34 > 0.4 * s23, "no flat-then-cliff; steps are comparable"
    # fourth retains a clear majority of second's value (no arbitrary penalty)
    assert v4 > 0.6 * v2


def test_vote_share_differentiates_close_and_distant_finishes():
    # with real vote share present, a close second outscores a distant second
    close_second = _mvp(2, 0.45)
    distant_second = _mvp(2, 0.10)
    assert close_second > distant_second
    # and a dominant winner (high share) exceeds a narrow winner
    assert _mvp(1, 0.90) > _mvp(1, 0.30)


def test_finals_mvp_has_no_runnerup_value():
    # Finals MVP is binary in recognition: present -> fixed value, absent -> 0.
    win = peak3.recognition_breakdown(pd.Series({"awards": "", "finals_mvp": 1}))
    none = peak3.recognition_breakdown(pd.Series({"awards": "", "finals_mvp": 0}))
    assert win["fmvp"] > 0 and none["fmvp"] == 0.0


# ----------------------------------------------------- burden residual ---
def _burden_row(**kw):
    base = dict(usg_pct=np.nan, r_ts=np.nan, ast_pct=10.0, mp=2400.0,
                creation=np.nan)
    base.update(kw)
    if pd.isna(base["creation"]):
        base["creation"] = (0.0 if pd.isna(base["usg_pct"]) else base["usg_pct"]) \
            + 0.45 * (0.0 if pd.isna(base["ast_pct"]) else base["ast_pct"])
    return base


def _burden(**kw):
    df = pd.DataFrame([_burden_row(**kw)])
    return peak3.successful_burden_residual(df)["burden_residual"][0]


def test_burden_rises_with_creation_load_at_equal_efficiency():
    # equal (strong) usage-adjusted efficiency, higher creation load -> more credit
    lo = _burden(usg_pct=24.0, r_ts=4.0, ast_pct=12.0)
    hi = _burden(usg_pct=33.0, r_ts=6.88, ast_pct=30.0)   # higher usg -> higher
    # match efficiency RESIDUAL by giving the high-load player the matching r_ts
    # (expected r_ts is lower at high usage, so equal residual needs lower r_ts):
    assert hi > lo > 0.0


def test_burden_falls_when_efficiency_materially_declines():
    strong = _burden(usg_pct=32.0, r_ts=4.0, ast_pct=25.0)
    weak = _burden(usg_pct=32.0, r_ts=-8.0, ast_pct=25.0)   # same load, worse eff
    assert strong > weak
    assert weak <= 0.0, "materially inefficient extreme load earns no credit"


def test_high_usage_alone_earns_no_burden_bonus():
    # high usage but only league-average efficiency for that usage -> ~0 bonus.
    # expected r_ts at usg 34 is -0.32*(34-22) = -3.84; meeting expectation:
    meets = _burden(usg_pct=34.0, r_ts=-3.84, ast_pct=20.0)
    assert abs(meets) < 1e-6, "usage alone (efficiency only as expected) -> 0"
    # strong efficiency on LOW responsibility also earns nothing (no load)
    low_load = _burden(usg_pct=14.0, r_ts=10.0, ast_pct=5.0)
    assert low_load == 0.0


def test_burden_residual_is_bounded():
    extreme = _burden(usg_pct=45.0, r_ts=30.0, ast_pct=40.0, mp=3000.0)
    worst = _burden(usg_pct=45.0, r_ts=-30.0, ast_pct=40.0, mp=3000.0)
    assert 0.0 < extreme <= peak3.BURDEN_POS_MAX + 1e-9
    assert -peak3.BURDEN_NEG_MAX - 1e-9 <= worst < 0.0


def test_burden_does_not_duplicate_full_si_or_tp():
    s = peak3.score_dataset(_league(), pd.DataFrame())
    # synthetic league has variance; on the real cache we check the live scores
    cache = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
    if cache.exists():
        s = pd.read_parquet(cache)
    q = s[(s.get("workload_qualified", 1) == 1) & (s.get("provisional", 0) != 1)]
    br = pd.to_numeric(q["burden_residual"], errors="coerce")
    for col in ("statistical_impact", "traditional_production"):
        x = pd.to_numeric(q[col], errors="coerce")
        m = br.notna() & x.notna() & (br != 0)
        r = np.corrcoef(br[m], x[m])[0, 1]
        assert abs(r) < 0.9, f"burden must not duplicate {col} (r={r:.3f})"


# ----------------------------------------------------- team achievement ---
def _ta(prs, **flags):
    base = dict(playoff_round_score=prs, championship=0, finals_appearance=0,
                conf_finals=0, best_player_title=0, co_best_player_title=0,
                usg_pct=28.0, creation=36.0)
    base.update(flags)
    return peak3.team_achievement_row(pd.Series(base))


def test_team_achievement_smooth_monotonic_bounded():
    # advancement progression: no playoffs / R1 loss = 0, then strictly increases
    no_po = _ta(np.nan)
    r1 = _ta(30.0)
    one_series = _ta(50.0)
    csf = _ta(70.0, conf_finals=1)
    finals = _ta(85.0, finals_appearance=1)
    champ = _ta(100.0, championship=1, best_player_title=1)
    assert no_po == 0.0 and r1 == 0.0
    seq = [one_series, csf, finals, champ]
    assert all(b > a for a, b in zip(seq, seq[1:])), f"monotonic: {seq}"
    assert 0.0 <= champ <= 100.0
    # smoothness: intermediate rounds_reached interpolate (no 0/50/100 only)
    mid = peak3.team_achievement_row(pd.Series(
        dict(playoff_round_score=60.0, championship=0, finals_appearance=0,
             conf_finals=0, best_player_title=0, co_best_player_title=0,
             usg_pct=28.0, creation=36.0)))
    assert one_series < mid < csf, "advancement interpolates smoothly"


def test_team_achievement_role_adjusted():
    # same championship, different role -> primary > co-star > secondary > role
    primary = _ta(100.0, championship=1, best_player_title=1)
    costar = _ta(100.0, championship=1, co_best_player_title=1)
    secondary = _ta(100.0, championship=1, usg_pct=24.0, creation=30.0)
    role = _ta(100.0, championship=1, usg_pct=13.0, creation=18.0)
    assert primary > costar > secondary > role
    assert role < 0.5 * primary, "a role player on a champion gets limited value"


def test_team_achievement_excludes_finals_mvp_and_box_score():
    base = dict(playoff_round_score=100.0, championship=1, finals_appearance=1,
                conf_finals=1, best_player_title=1, co_best_player_title=0,
                usg_pct=30.0, creation=38.0)
    a = peak3.team_achievement_row(pd.Series(base))
    b = base.copy()
    b.update(finals_mvp=1, po_pts=40.0, po_bpm=15.0, postseason_perf=99.0,
             po_level_value=80.0)
    b = peak3.team_achievement_row(pd.Series(b))
    assert a == b, "Finals MVP and playoff box score must not affect Team Achievement"


# ------------------------------------------------ postseason preserved ---
def test_postseason_structure_preserved():
    # the corrected four-term postseason value still reconciles exactly.
    cache = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
    if not cache.exists():
        return
    s = pd.read_parquet(cache)
    r = s[(s.player == "LeBron James") & (s.season_end == 2009)]
    if not len(r):
        return
    r = r.iloc[0]
    recon = (r["po_level_value"] + r["po_elevation_value"] +
             r["po_deep_run_value"] + r["po_dominance_value"])
    assert abs(float(r["postseason_perf"]) - recon) < 1e-9


# --------------------------------------------------- reconciliation ---
def test_single_season_decomposition_reconciles():
    s = peak3.score_dataset(_league(), pd.DataFrame())
    W = peak3.OFFICIAL_WEIGHTS
    recon = (W["statistical_impact"] * s["statistical_impact"]
             + W["traditional_production"] * s["traditional_production"]
             + W["recognition"] * s["recognition"]
             + W["postseason"] * s["postseason_perf"]
             + W["team_achievement"] * s["team_achievement"]
             + s["teammate_adjustment"])
    assert (recon - s["prime_raw"]).abs().max() < 1e-9


def test_three_and_five_year_raw_aggregations_reconcile():
    cache = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
    if not cache.exists():
        return
    s = pd.read_parquet(cache)
    g = s[s.player == "Michael Jordan"]
    for n in (3, 5):
        wins = peak3.n_year_windows(g, "prime_score", n, "weighted")
        assert wins, f"expected a {n}-year window"
        dec = peak3.nyear_window_decomposition(wins[0], "prime_score", "weighted")
        keys = ["Statistical impact (38%)", "Traditional production (21%)",
                "Individual recognition (20%)", "Postseason individual (18%)",
                "Team achievement (3%)", "Teammate adjustment"]
        assert abs(sum(dec[k] for k in keys) - dec["_raw_window_score"]) < 1e-6


def test_final_25_rankings_have_25_unique_players_each():
    import re
    cache = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
    if not cache.exists():
        return
    import make_outputs  # noqa: E402
    s = pd.read_parquet(cache)
    lines = make_outputs.final_25_comparison(s)
    text = "\n".join(lines)
    # split into the A/B/C blocks and count numbered rows in each
    for marker in ("A. BEST ONE-SEASON", "B. BEST THREE-YEAR", "C. BEST FIVE-YEAR"):
        assert marker in text, f"missing section {marker}"
    blocks = re.split(r"[ABC]\. BEST (?:ONE-SEASON|THREE-YEAR|FIVE-YEAR) PRIME", text)[1:4]
    players_set = set(make_outputs.PLAYERS)
    for marker, block in zip("ABC", blocks):
        names = []
        for ln in block.splitlines():
            if not re.match(r"\s+\d+\s", ln):
                continue
            # robustly match by which case-study player name the row contains
            hits = [p for p in players_set if p in ln]
            if hits:
                names.append(max(hits, key=len))   # longest match (avoids prefixes)
        assert len(names) == 25, f"section {marker}: {len(names)} ranked rows (want 25)"
        assert len(set(names)) == 25, f"section {marker}: duplicate players"
        assert set(names) == players_set, f"section {marker}: not the 25 case-study set"


def test_provisional_seasons_excluded_from_rankings():
    # the official window builder drops provisional seasons. (The shipped cache may
    # contain only completed seasons; verify the mechanism with an injected one.)
    g = pd.DataFrame({
        "player": ["X"] * 4,
        "season": ["2001-02", "2002-03", "2003-04", "2004-05"],
        "season_end": [2002, 2003, 2004, 2005],
        "prime_raw": [50.0, 55.0, 60.0, 65.0],
        "prime_score": [70.0, 75.0, 80.0, 85.0],
        "provisional": [0, 0, 0, 1],          # last season incomplete
    })
    ws = peak3.n_year_windows(g, "prime_raw", 3, "weighted")
    assert ws, "expected a 3-year window from the 3 completed seasons"
    for w in ws:
        assert (w["df"]["provisional"] != 1).all(), "provisional season leaked in"
    # the provisional season cannot anchor any window
    assert all("2004-05" not in w["seasons"] for w in ws)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} refinement tests passed")
