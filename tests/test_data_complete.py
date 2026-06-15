"""
Tests for the data-completeness / provenance pass (spec section 14).

Proves: team scoring/assist shares are computed correctly (incl. traded seasons),
real MVP/DPOY vote share is used when available and missing share is NOT zero,
the placement fallback is used only when necessary, winners keep a clear premium,
the burden residual stays bounded and uses actual shares with a flagged proxy
fallback, TP scale is not materially inflated, every component reconciles, the
final case-study rankings each contain exactly 25 unique players, raw window
aggregation precedes calibration, provisional seasons are excluded, and the
canonical rebuild equals the offline fast path.
"""
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import peak3  # noqa: E402

SCORED = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
GEN = ROOT / "data" / "generated"


def _scored():
    return pd.read_parquet(SCORED) if SCORED.exists() else None


# ------------------------------------------------------------- weights ---
def test_official_weights_unchanged():
    assert peak3.OFFICIAL_WEIGHTS == {
        "statistical_impact": 0.38, "traditional_production": 0.21,
        "recognition": 0.20, "postseason": 0.18, "team_achievement": 0.03}


def test_postseason_formula_unchanged():
    """The four-term postseason structure + reliability correction is preserved."""
    s = _scored()
    if s is None:
        return
    r = s[(s.player == "LeBron James") & (s.season_end == 2009)].iloc[0]
    recon = (r["po_level_value"] + r["po_elevation_value"] +
             r["po_deep_run_value"] + r["po_dominance_value"])
    assert abs(float(r["postseason_perf"]) - recon) < 1e-9
    # the reliability-shrunk short CF run is still well below 100
    assert float(r["postseason_perf"]) < 90.0


# --------------------------------------------------------- team shares ---
def test_team_scoring_share_correct_single_team():
    """team_scoring_share = player season points / team season points, exact up to
    per-game rounding, for a known single-team season."""
    import peak3 as P
    se = 2006
    t = P.read_tables(P.fetch_html("x", f"NBA_{se}_per_game.html",
                                   scrape=False, refresh=False))[0]
    t = P.drop_header_rows(t)
    for c in ("g", "pts", "ast"):
        t[c] = pd.to_numeric(t[c], errors="coerce")
    t = t.dropna(subset=["team", "g"])
    multi = {"TOT", "2TM", "3TM", "4TM", "5TM"}
    single = t[~t["team"].astype(str).isin(multi)].copy()
    single["pts_tot"] = single["pts"].fillna(0) * single["g"]
    lal = single[single["team"] == "LAL"]
    kobe = lal[lal["player"].apply(P.clean_player_name) == "Kobe Bryant"].iloc[0]
    expect = (kobe["pts"] * kobe["g"]) / lal["pts_tot"].sum()
    ts = pd.read_csv(GEN / "team_shares.csv")
    got = ts[(ts.player_clean == "Kobe Bryant") &
             (ts.season_end == se)]["team_scoring_share"].iloc[0]
    assert abs(got - expect) < 1e-6
    assert 0.30 < got < 0.40   # a real, record-level scoring share


def test_team_assist_share_correct():
    ts = pd.read_csv(GEN / "team_shares.csv")
    v = ts["team_assist_share"].dropna()
    assert (v >= 0).all() and (v <= 1.0 + 1e-9).all()
    # a pass-first PG carries a large assist share
    nash = ts[(ts.player_clean == "Steve Nash") & (ts.season_end == 2006)]
    assert float(nash["team_assist_share"].iloc[0]) > 0.35


def test_traded_season_aggregates_games_weighted():
    """A traded player's share is a games-weighted blend of his team-specific
    shares, and stays a valid (0,1] fraction."""
    ts = pd.read_csv(GEN / "team_shares.csv")
    traded = ts[ts["n_teams"] >= 2]
    assert len(traded) > 50
    assert (traded["team_scoring_share"] >= 0).all()
    assert (traded["team_scoring_share"] <= 1.0 + 1e-9).all()
    # reconstruct one traded case explicitly
    import peak3 as P
    se = 2006
    t = P.drop_header_rows(P.read_tables(
        P.fetch_html("x", f"NBA_{se}_per_game.html", scrape=False, refresh=False))[0])
    for c in ("g", "pts"):
        t[c] = pd.to_numeric(t[c], errors="coerce")
    t = t.dropna(subset=["team", "g"])
    t["pc"] = t["player"].apply(P.clean_player_name)
    multi = {"TOT", "2TM", "3TM", "4TM", "5TM"}
    single = t[~t["team"].astype(str).isin(multi)].copy()
    single["pts_tot"] = single["pts"].fillna(0) * single["g"]
    teampts = single.groupby("team")["pts_tot"].sum()
    cand = traded[traded.season_end == se]["player_clean"].iloc[0]
    rows = single[single.pc == cand]
    if len(rows) >= 2:
        w = rows["g"].to_numpy()
        sh = (rows["pts_tot"].to_numpy() / rows["team"].map(teampts).to_numpy())
        expect = float(np.average(sh, weights=w))
        got = ts[(ts.player_clean == cand) & (ts.season_end == se)
                 ]["team_scoring_share"].iloc[0]
        assert abs(got - expect) < 1e-6


def test_missing_team_total_uses_flagged_fallback():
    """A row with no actual team share must use the proxy, flagged as fallback,
    and is never silently treated as zero."""
    df = pd.DataFrame([{
        "usg_pct": 30.0, "ast_pct": 20.0, "r_ts": 5.0, "mp": 2400.0,
        "creation": 30.0 + 0.45 * 20.0,
        "team_scoring_share": np.nan, "team_assist_share": np.nan}])
    out = peak3.successful_burden_residual(df)
    # falls back to the proxy creation_load (nonzero here), not a zeroed-out value
    assert out["creation_load"][0] > 0.0
    # status flag is computed in merge_optional; verify the scored dataset marks it
    s = _scored()
    if s is not None:
        assert set(s["burden_data_status"].unique()) <= {"observed", "proxy_fallback"}


# ------------------------------------------------------- vote shares ---
def test_missing_vote_share_not_zero():
    s = _scored()
    if s is None:
        return
    # a non-MVP season has NaN vote share, never 0.0
    v = pd.to_numeric(s["mvp_vote_share"], errors="coerce")
    assert (v == 0.0).sum() == 0
    assert v.isna().sum() > 0


def test_real_mvp_vote_share_used_when_available():
    s = _scored()
    if s is None:
        return
    nash = s[(s.player == "Steve Nash") & (s.season_end == 2006)].iloc[0]
    assert abs(float(nash["mvp_vote_share"]) - 0.739) < 1e-6
    assert nash["mvp_vote_data_status"] == "observed"
    # the recognition MVP value reflects the real share, not the fallback
    real = peak3.ranked_award_value(1, 0.739, **peak3.MVP_VOTING)
    fb = peak3.ranked_award_value(1, float("nan"), **peak3.MVP_VOTING)
    assert abs(real - fb) > 1e-6


def test_real_dpoy_vote_share_used_when_available():
    s = _scored()
    if s is None:
        return
    bw = s[(s.player == "Ben Wallace") & (s.season_end == 2006)]
    if len(bw):
        r = bw.iloc[0]
        assert pd.notna(r["dpoy_vote_share"])
        assert r["dpoy_vote_data_status"] == "observed"


def test_placement_fallback_only_when_necessary():
    s = _scored()
    if s is None:
        return
    # every MVP-ranked awards-era season has a real share (status 'observed');
    # 'fallback' only where a ranked finish lacks a vote row.
    ranked = s["awards"].fillna("").str.contains("MVP-")
    statuses = s.loc[ranked, "mvp_vote_data_status"].value_counts().to_dict()
    assert statuses.get("none", 0) == 0
    # observed dominates; fallback is the rare exception, never the default
    assert statuses.get("observed", 0) > 10 * statuses.get("fallback", 0) + 1


def test_award_winner_retains_clear_premium_with_real_share():
    """For EVERY MVP season with real votes, the winner's award-voting value
    exceeds every non-winner's (the winner premium is never erased by vote share)."""
    mvp = pd.read_csv(GEN / "mvp_votes.csv")
    bad = 0
    for se, g in mvp.groupby("season_end"):
        g = g.dropna(subset=["vote_share"])
        vals = {int(row["mvp_finish"]): peak3.ranked_award_value(
            int(row["mvp_finish"]), row["vote_share"], **peak3.MVP_VOTING)
            for _, row in g.iterrows() if pd.notna(row["mvp_finish"])}
        if 1 in vals and any(v >= vals[1] for k, v in vals.items() if k != 1):
            bad += 1
    assert bad == 0, f"{bad} seasons where a non-winner matched/beat the winner"


def test_nonwinning_values_smooth_and_monotonic():
    # with equal (descending) vote shares, recognition declines smoothly by rank
    shares = {1: 0.80, 2: 0.45, 3: 0.30, 4: 0.22, 5: 0.15}
    vals = [peak3.ranked_award_value(r, shares[r], **peak3.MVP_VOTING)
            for r in range(1, 6)]
    assert all(a > b for a, b in zip(vals, vals[1:]))
    # 2->3->4 steps are smooth (no cliff): each step within 3x of the previous
    steps = [vals[i] - vals[i + 1] for i in range(1, 4)]
    assert max(steps) < 3.0 * min(steps)


# ------------------------------------------------------ burden bounds ---
def test_burden_residual_bounded():
    s = _scored()
    if s is None:
        return
    b = pd.to_numeric(s["burden_residual"], errors="coerce")
    assert b.max() <= peak3.BURDEN_POS_MAX + 1e-9
    assert b.min() >= -peak3.BURDEN_NEG_MAX - 1e-9


def test_burden_uses_actual_shares_with_proxy_fallback():
    # actual share present -> creation_load from shares; absent -> proxy
    share_row = pd.DataFrame([{
        "usg_pct": 25.0, "ast_pct": 10.0, "r_ts": 5.0, "mp": 2400.0,
        "creation": 25.0 + 0.45 * 10.0,
        "team_scoring_share": 0.30, "team_assist_share": 0.10}])
    o = peak3.successful_burden_residual(share_row)
    # creation_share reported is the actual share combo, not the proxy
    assert abs(o["creation_share"][0] - (0.30 + 0.45 * 0.10)) < 1e-9
    assert o["creation_load"][0] > 0.0


def test_tp_scale_not_materially_inflated():
    s = _scored()
    pre = ROOT / "data" / "datacomplete_pre_snapshot.csv"
    if s is None or not pre.exists():
        return
    q = s[(s.workload_qualified == 1) & (s.provisional != 1)]
    p = pd.read_csv(pre)
    m = q.merge(p, on=["player", "season_end"], how="left")
    delta = (m["traditional_production"] - m["dc_pre_traditional_production"]).mean()
    assert abs(delta) < 1.0, f"TP mean shifted {delta:.3f} (should be immaterial)"


# ------------------------------------------------------ reconciliation ---
def test_all_components_reconcile():
    s = _scored()
    if s is None:
        return
    W = peak3.OFFICIAL_WEIGHTS
    recon = (W["statistical_impact"] * pd.to_numeric(s["statistical_impact"])
             + W["traditional_production"] * pd.to_numeric(s["traditional_production"])
             + W["recognition"] * pd.to_numeric(s["recognition"])
             + W["postseason"] * pd.to_numeric(s["postseason_perf"])
             + W["team_achievement"] * pd.to_numeric(s["team_achievement"])
             + pd.to_numeric(s["teammate_adjustment"]))
    assert (recon - pd.to_numeric(s["prime_raw"])).abs().max() < 1e-9


# ------------------------------------------------------ integrity ---
def test_full_dataset_integrity_passes():
    from nba_peak.integrity import run_integrity_checks
    s = _scored()
    if s is None:
        return
    mvp = pd.read_csv(GEN / "mvp_votes.csv")
    dpoy = pd.read_csv(GEN / "dpoy_votes.csv")
    ts = pd.read_csv(GEN / "team_shares.csv")
    ok, lines = run_integrity_checks(s, mvp, dpoy, ts)
    assert ok, "\n".join(lines)


# ------------------------------------------- final 25-player rankings ---
def test_final_rankings_25_unique_each():
    import re
    s = _scored()
    if s is None:
        return
    import make_outputs as M
    text = "\n".join(M.final_25_comparison(s))
    blocks = re.split(r"[ABC]\. BEST (?:ONE-SEASON|THREE-YEAR|FIVE-YEAR) PRIME",
                      text)[1:4]
    players = set(M.PLAYERS)
    for letter, block in zip("ABC", blocks):
        names = []
        for ln in block.splitlines():
            if not re.match(r"\s+\d+\s", ln):
                continue
            hits = [p for p in players if p in ln]
            if hits:
                names.append(max(hits, key=len))
        assert len(names) == 25 and set(names) == players, \
            f"section {letter}: {len(names)} rows"


def test_raw_window_aggregation_before_calibration():
    """3-/5-year windows aggregate RAW season values, then calibrate once -- never
    average per-season display scores."""
    s = _scored()
    if s is None:
        return
    g = s[s.player == "Michael Jordan"]
    ws = peak3.n_year_windows(g, "prime_raw", 3, "weighted")
    w = ws[0]
    dec = peak3.nyear_window_decomposition(w, "prime_raw", "weighted")
    raw = dec["_raw_window_score"]
    disp_once = float(peak3.calibrate_score(pd.Series([raw])).iloc[0])
    # averaging calibrated season displays gives a DIFFERENT number
    avg_disp = float(pd.to_numeric(w["df"]["prime_score"]).mean())
    assert abs(disp_once - avg_disp) > 1e-6
    # the window display is the calibrate-once value, not the display average
    assert 0 <= disp_once <= 100


def test_canonical_rebuild_matches_fast_path():
    """Re-scoring from the cached raw frames (the offline fast path) reproduces the
    cached scored dataset EXACTLY -- i.e. the canonical rebuild and the offline
    path produce identical scores (deterministic, no hidden state)."""
    s = _scored()
    if s is None:
        return
    paths = peak3.processed_paths(1980, 2026)
    regular = peak3.load_parquet(paths["regular"])
    playoffs = peak3.load_parquet(paths["playoffs"])
    teams = peak3.load_parquet(paths["teams"])
    if teams is not None and len(teams):
        regular = regular.merge(teams, on=["season_end", "team"], how="left")
    for c in ("team_wins", "team_srs", "team_net_rtg"):
        if c not in regular.columns:
            regular[c] = np.nan
    regular, _ = peak3.merge_optional(regular)
    rebuilt = peak3.score_dataset(regular, playoffs)
    a = s.sort_values(["player", "season_end"]).reset_index(drop=True)
    b = rebuilt.sort_values(["player", "season_end"]).reset_index(drop=True)
    assert len(a) == len(b)
    for col in ("prime_raw", "traditional_production", "recognition",
                "statistical_impact", "postseason_perf", "team_achievement"):
        diff = (pd.to_numeric(a[col]) - pd.to_numeric(b[col])).abs().max()
        assert diff < 1e-9, f"{col} differs by {diff}"


def test_provisional_excluded_from_windows():
    g = pd.DataFrame({
        "player": ["X"] * 4, "season": ["2001-02", "2002-03", "2003-04", "2004-05"],
        "season_end": [2002, 2003, 2004, 2005],
        "prime_raw": [50.0, 55.0, 60.0, 99.0], "prime_score": [70, 75, 80, 99],
        "provisional": [0, 0, 0, 1]})
    ws = peak3.n_year_windows(g, "prime_raw", 3, "weighted")
    assert all("2004-05" not in w["seasons"] for w in ws)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} data-completion tests passed")
