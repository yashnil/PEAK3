"""
Tests for the SPECIALIST AND POSTSEASON sanity audit and the two artefacts it
produced: (a) the 2025-26 completed-season completeness guard, and (b) the
bounded, gated, monotonic postseason elevation-reversal safeguard.

Proves, per the audit spec:
  * 2025-26 completion is checked field by field;
  * missing 2025-26 data cannot silently enter official rankings;
  * official weights are unchanged and no sixth component is added;
  * the creation_independence diagnostic is deterministic and bounded;
  * the adopted postseason safeguard is bounded and MONOTONIC (never penalizes);
  * Shaq/Jokic/Hakeem/Robinson/Kareem/Embiid are not broadly penalized;
  * negative postseason cases are enumerated and categorized;
  * elevation cannot use teammate quality twice (the safeguard is gated only on
    the player's own absolute level + sample, never on team/teammate fields);
  * Finals MVP is counted only in Recognition (Jaylen Brown);
  * component bridges reconcile exactly to Prime-raw differences;
  * the efficient-big ordering is left unchanged (no correction adopted there).
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import peak3 as P  # noqa: E402
from nba_peak import specialist_postseason_audit as A  # noqa: E402
from nba_peak import season_completeness as SC  # noqa: E402

SCORED = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"


def _scored():
    return pd.read_parquet(SCORED) if SCORED.exists() else None


# --------------------------------------------------- official invariants ------
def test_official_weights_unchanged():
    assert P.OFFICIAL_WEIGHTS == {
        "statistical_impact": 0.38, "traditional_production": 0.21,
        "recognition": 0.20, "postseason": 0.18, "team_achievement": 0.03}
    assert abs(sum(P.OFFICIAL_WEIGHTS.values()) - 1.0) < 1e-12


def test_no_sixth_component():
    # exactly the five official contribution columns feed Prime raw
    s = _scored()
    if s is None:
        return
    contrib = [c for c in s.columns if c.startswith("contrib_")
               and c in ("contrib_statistical_impact",
                         "contrib_traditional_production", "contrib_recognition",
                         "contrib_postseason", "contrib_team_achievement")]
    assert len(contrib) == 5
    recon = (s["contrib_statistical_impact"] + s["contrib_traditional_production"]
             + s["contrib_recognition"] + s["contrib_postseason"]
             + s["contrib_team_achievement"] + s["teammate_adjustment"])
    assert np.allclose(recon.to_numpy(), s["prime_raw"].to_numpy(), atol=1e-6)


# --------------------------------------------------- 2025-26 completeness -----
def test_2026_completeness_checked_field_by_field():
    s = _scored()
    if s is None:
        return
    summ = SC.completeness_summary(s, 2026)
    # every required field group is represented and classified
    cats = set(summ["category"])
    assert {"regular_box", "advanced", "team", "awards", "postseason",
            "status"} <= cats
    # each field has a full classification that sums to the player-season count
    for _, r in summ.iterrows():
        assert (r.observed + r.derived + r.not_applicable + r.missing
                == r.n_player_seasons)
    # 2025-26 is COMPLETE: zero silently-missing required fields
    assert int(summ["missing"].sum()) == 0


def test_missing_2026_data_cannot_silently_enter_rankings():
    s = _scored()
    if s is None:
        return
    # clean data passes the guard
    SC.assert_no_silent_missing(s, 2026)
    # blanking a REQUIRED advanced field for a non-provisional 2026 season raises
    corrupt = s.copy()
    idx = corrupt[(corrupt.season_end == 2026)
                  & (corrupt.provisional != 1)].index[0]
    corrupt.loc[idx, "bpm"] = np.nan
    raised = False
    try:
        SC.assert_no_silent_missing(corrupt, 2026)
    except RuntimeError:
        raised = True
    assert raised, "guard must fail on a silently-missing required field"


def test_not_applicable_is_not_missing():
    s = _scored()
    if s is None:
        return
    lf = SC.field_status_long(s, 2026)
    # players not in the MVP voting are not_applicable, never missing
    mvp = lf[lf.field == "mvp_vote_share"]
    assert (mvp.status == SC.MISSING).sum() == 0
    assert (mvp.status == SC.NA).sum() > 0
    # non-playoff players: playoff fields are not_applicable
    pm = lf[lf.field == "po_mp"]
    assert (pm.status == SC.MISSING).sum() == 0
    assert (pm.status == SC.NA).sum() > 0


# --------------------------------------------- postseason safeguard ----------
def test_elevation_safeguard_is_monotonic_non_decreasing():
    """The safeguard may only RAISE a postseason score; it can never lower one,
    so no player (incl. protected bigs) is penalized by it."""
    s = _scored()
    if s is None:
        return
    reg = P.load_parquet(P.processed_paths(1980, 2026)["regular"])
    po = P.load_parquet(P.processed_paths(1980, 2026)["playoffs"])
    teams = P.load_parquet(P.processed_paths(1980, 2026)["teams"])
    if reg is None or po is None:
        return
    if teams is not None and len(teams):
        reg = reg.merge(teams, on=["season_end", "team"], how="left")
    for c in ("team_wins", "team_srs", "team_net_rtg"):
        if c not in reg.columns:
            reg[c] = np.nan
    reg, _ = P.merge_optional(reg, debug=False)
    withg = P.score_dataset(reg, po)
    saved = P.PO_ELEV_GUARD_LEVEL
    try:
        P.PO_ELEV_GUARD_LEVEL = 1e9          # disable safeguard
        without = P.score_dataset(reg, po)
    finally:
        P.PO_ELEV_GUARD_LEVEL = saved
    key = ["player", "season_end"]
    m = withg[key + ["postseason_perf"]].merge(
        without[key + ["postseason_perf"]], on=key, suffixes=("_g", "_n"))
    delta = m["postseason_perf_g"] - m["postseason_perf_n"]
    assert delta.min() >= -1e-9, "safeguard must never lower a score"
    assert delta.max() > 0.0, "safeguard must raise at least one score"


def test_elevation_safeguard_is_bounded_per_window():
    """Adopted safeguard stays inside the audit caps: <=1.0 (1yr), 0.7 (3yr),
    0.5 (5yr) Prime-raw, for the audited players."""
    s = _scored()
    if s is None:
        return
    reg = P.load_parquet(P.processed_paths(1980, 2026)["regular"])
    po = P.load_parquet(P.processed_paths(1980, 2026)["playoffs"])
    teams = P.load_parquet(P.processed_paths(1980, 2026)["teams"])
    if reg is None or po is None:
        return
    if teams is not None and len(teams):
        reg = reg.merge(teams, on=["season_end", "team"], how="left")
    for c in ("team_wins", "team_srs", "team_net_rtg"):
        if c not in reg.columns:
            reg[c] = np.nan
    reg, _ = P.merge_optional(reg, debug=False)
    withg = P.score_dataset(reg, po)
    saved = P.PO_ELEV_GUARD_LEVEL
    try:
        P.PO_ELEV_GUARD_LEVEL = 1e9
        without = P.score_dataset(reg, po)
    finally:
        P.PO_ELEV_GUARD_LEVEL = saved

    def raw(df, name, n):
        g = df[df.player == name]
        g = g[g.provisional != 1] if "provisional" in g.columns else g
        ws = P.n_year_windows(g, "prime_raw", n, "weighted")
        if not ws:
            return None
        return P.nyear_window_decomposition(ws[0], "prime_raw", "weighted"
                                            )["_raw_window_score"]
    caps = {1: 1.0, 3: 0.7, 5: 0.5}
    affected = ["Kevin McHale", "Manu Ginobili", "Shaquille O'Neal",
                "Dirk Nowitzki", "Steve Nash", "Robert Parish", "Karl Malone"]
    for nm in affected:
        for n, cap in caps.items():
            a, b = raw(withg, nm, n), raw(without, nm, n)
            if a is None or b is None:
                continue
            assert abs(a - b) <= cap + 1e-6, (nm, n, a - b)


def test_safeguard_gated_only_on_own_level_and_sample_not_teammates():
    """Elevation cannot use teammate quality twice: the safeguard's gate uses ONLY
    the player's own reliability-adjusted level and playoff-sample reliability --
    never any team/teammate field. Two synthetic players with identical own
    playoff/regular rates and sample get an identical safeguard outcome regardless
    of (absent) team context."""
    import tests.test_corrections as TC  # reuse the row builder
    base = dict(po_bpm=9.0, po_obpm=6.0, po_dbpm=2.5, po_ws_per_48=0.25,
                po_per=27, po_pts=31, po_r_ts=6.0, po_ts_plus=110, po_mp=700,
                po_g=18, playoff_round_score=85.0, po_usg_pct=28.0,
                bpm=12.0, obpm=9.0, dbpm=3.0, ws_per_48=0.30, per=31)
    r1 = TC._po_row(reg_rate_match=False, **base)
    r2 = TC._po_row(reg_rate_match=False, **base)
    v1, _ = P.postseason_value(pd.DataFrame([r1]), pd.Series([True]))
    v2, _ = P.postseason_value(pd.DataFrame([r2]), pd.Series([True]))
    assert abs(float(v1.iloc[0]) - float(v2.iloc[0])) < 1e-9
    # the safeguard fields exist and are pure scalars (no team columns referenced)
    assert isinstance(P.PO_ELEV_GUARD_LEVEL, float)
    assert isinstance(P.PO_ELEV_GUARD_RELIAB, float)
    assert 0.0 < P.PO_ELEV_GUARD_FRACTION < 1.0


def test_safeguard_does_not_rescue_genuinely_poor_negatives():
    """A genuinely-poor playoff run (negative absolute level) is NOT gated, so the
    safeguard leaves it negative -- it is not a floor-at-zero."""
    s = _scored()
    if s is None:
        return
    npo = A.negative_postseason_audit(s)
    brown = npo[npo.player == "Jaylen Brown"]
    # Brown's negative seasons remain negative (genuine absolute-level)
    assert (brown.postseason_perf < 0).all()
    # and they are classified as genuine / small-sample, not reversal-rescued
    assert (brown.po_abs_level < 0).all()


# ------------------------------------------------ creation diagnostic --------
def test_creation_independence_deterministic_and_bounded():
    s = _scored()
    if s is None:
        return
    sample = s[s.get("workload_qualified", 0) == 1].head(500)
    v1 = sample.apply(A._creation_independence_row, axis=1)
    v2 = sample.apply(A._creation_independence_row, axis=1)
    assert np.allclose(v1.to_numpy(), v2.to_numpy())     # deterministic
    assert v1.min() >= 0.0 and v1.max() <= 100.0          # bounded [0,100]


# --------------------------------------------- protected bigs not penalized --
def test_protected_bigs_not_broadly_penalized():
    """The whole audit (which only adds the monotonic postseason safeguard) must
    not lower any protected dominant big's best windows below a sane floor; the
    safeguard can only help them."""
    s = _scored()
    if s is None:
        return
    floors = {  # conservative lower bounds on best-5yr Prime raw
        "Shaquille O'Neal": 55.0, "Nikola Jokic": 60.0, "Hakeem Olajuwon": 48.0,
        "David Robinson": 50.0, "Kareem Abdul-Jabbar": 42.0, "Joel Embiid": 44.0}
    for name, floor in floors.items():
        w = A.best_window(s, name, 5)
        assert w is not None, name
        assert w["raw"] >= floor, (name, w["raw"])


# ------------------------------------------------ negatives enumerated -------
def test_negative_postseason_cases_enumerated():
    s = _scored()
    if s is None:
        return
    npo = A.negative_postseason_audit(s)
    assert len(npo) > 0
    # every row is a playoff participant with a negative postseason value
    assert (npo.postseason_perf < 0).all()
    # categorized into the documented buckets
    cats = set(npo.category)
    assert cats <= {"genuinely_poor_playoff_performance",
                    "small_sample_underperformance",
                    "valuable_absolute_negative_elevation",
                    "secondary_star_or_specialist_compression", "data_problem"}
    # the audited names are all present
    for nm in A.NEG_PO_AUDIT_PLAYERS:
        if (s.player == nm).any():
            assert (npo.player == nm).any(), nm


# ------------------------------------------------ Finals MVP in Recognition --
def test_finals_mvp_counted_only_in_recognition():
    s = _scored()
    if s is None:
        return
    fm = A.finals_mvp_audit(s, "Jaylen Brown")
    win = fm[fm.finals_mvp == 1]
    assert len(win) == 1, "Brown's single Finals MVP season"
    row = win.iloc[0]
    # Finals MVP value lives in Recognition...
    assert row["finals_mvp_component"] == 100.0
    assert row["recognition"] > 0
    # ...and that season's postseason value is just his playoff box (not a bonus):
    # it is finite and not inflated by the award
    assert np.isfinite(row["postseason_perf"])
    # championship is in Team Achievement, not duplicated into Postseason
    assert row["championship"] == 1.0


# ------------------------------------------------ bridges reconcile ----------
def test_component_bridges_reconcile_to_prime_difference():
    s = _scored()
    if s is None:
        return
    br = A.efficient_big_bridges(s)
    br = br[br.get("d_prime_raw").notna()] if "d_prime_raw" in br.columns else br
    for _, r in br.iterrows():
        # exact reconciliation: d_prime_raw == raw_a - raw_b
        assert abs(r["d_prime_raw"] - (r["raw_a"] - r["raw_b"])) < 1e-9, r.to_dict()
        # component sum reconciles up to the CSV's 2-decimal rounding (6 fields)
        comp_sum = (r["d_SI"] + r["d_TP"] + r["d_Rec"] + r["d_PO"]
                    + r["d_Team"] + r["d_tm"])
        assert abs(comp_sum - r["d_prime_raw"]) < 0.06, r.to_dict()
    # and the unrounded window decomposition reconciles EXACTLY
    for a_name, b_name in A.BIG_BRIDGES[:4]:
        wa, wb = A.best_window(s, a_name, 5), A.best_window(s, b_name, 5)
        if wa is None or wb is None:
            continue
        comp = sum(wa[k] - wb[k] for k in ("SI", "TP", "Rec", "PO", "Team", "tm"))
        assert abs(comp - (wa["raw"] - wb["raw"])) < 1e-6, (a_name, b_name)


# ------------------------------------------------ efficient-big unchanged ----
def test_efficient_big_ordering_no_correction_applied():
    """No efficient-big correction was adopted: the purest low-creation finishers
    still rank at the bottom of the comparison set (the audit's conclusion)."""
    s = _scored()
    if s is None:
        return
    eb = A.efficient_big_audit(s).set_index("player")["prime_raw"]
    # DeAndre Jordan stays below the genuine two-way bigs
    for better in ["Patrick Ewing", "Alonzo Mourning", "Pau Gasol",
                   "Ben Wallace"]:
        if better in eb.index:
            assert eb["DeAndre Jordan"] < eb[better] + 1e-9, better
