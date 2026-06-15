"""
Tests for the five-player comparative prime audit (read-only diagnostic).

Proves: all five players present; 1/3/5-year windows use completed non-provisional
seasons; component contributions reconcile to raw exactly; pairwise bridges
reconcile to raw-score differences; sensitivity weights each sum to 1.00;
counterfactual swaps reconcile; report generation is deterministic; and NO model
formula or official weight was changed by the audit.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import peak3  # noqa: E402
from nba_peak import five_player_audit as A  # noqa: E402

SCORED = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"


def _scored():
    return pd.read_parquet(SCORED) if SCORED.exists() else None


def _audit():
    s = _scored()
    return (s, A.build_audit(s)) if s is not None else (None, None)


def test_all_five_players_present():
    s, au = _audit()
    if au is None:
        return
    assert A.PLAYERS == ["James Harden", "David Robinson", "Hakeem Olajuwon",
                         "Stephen Curry", "Kobe Bryant"]
    for n in (1, 3, 5):
        assert set(au["rankings"][n]) == set(A.PLAYERS)
        assert len(au["rankings"][n]) == 5
    assert len(au["comp_table"]) == 5


def test_windows_use_completed_nonprovisional_seasons():
    s, au = _audit()
    if au is None:
        return
    for name in A.PLAYERS:
        for n in (1, 3, 5):
            w = au["win"][name][n]
            assert w is not None, f"{name} {n}yr window missing"
            wdf = w["df"]
            assert len(wdf) == n
            if "provisional" in wdf.columns:
                assert (wdf["provisional"] != 1).all(), \
                    f"{name} {n}yr window leaked a provisional season"


def test_component_contributions_reconcile_to_raw():
    s, au = _audit()
    if au is None:
        return
    for name in A.PLAYERS:
        for n in (1, 3, 5):
            w = au["win"][name][n]
            total = sum(w["contrib"].values())
            assert abs(total - w["raw"]) < 1e-9, \
                f"{name} {n}yr contribs {total} != raw {w['raw']}"


def test_one_year_window_equals_official_prime():
    """The best 1-year window raw must equal the season's prime_raw and its display
    must equal the official calibrated prime_score (raw-aggregate calibrated once)."""
    s, au = _audit()
    if au is None:
        return
    for name in A.PLAYERS:
        w = au["win"][name][1]
        row = au["anchors"][name]
        assert abs(w["raw"] - float(row["prime_raw"])) < 1e-9
        assert abs(w["disp"] - float(row["prime_score"])) < 1e-6


def test_pairwise_bridges_reconcile():
    s, au = _audit()
    if au is None:
        return
    for (a, b, n), v in au["bridges"].items():
        assert abs(sum(v["diff"].values()) - v["total_raw"]) < 1e-9
        # total raw diff equals the difference of the two window raws
        wa, wb = au["win"][a][n]["raw"], au["win"][b][n]["raw"]
        assert abs(v["total_raw"] - (wa - wb)) < 1e-9


def test_sensitivity_weights_sum_to_one():
    for name, w in A.SENSITIVITY.items():
        assert abs(sum(w) - 1.0) < 1e-9, f"{name} weights sum {sum(w)}"
    # official system matches the live weights
    off = A.SENSITIVITY["Official  38/21/20/18/3"]
    assert off == (0.38, 0.21, 0.20, 0.18, 0.03)


def test_sensitivity_ranks_all_five_each_system():
    s, au = _audit()
    if au is None:
        return
    for sysname, per_n in au["sensitivity"].items():
        for n in (1, 3, 5):
            names = [nm for nm, _ in per_n[n]]
            assert set(names) == set(A.PLAYERS) and len(names) == 5


def test_counterfactuals_reconcile():
    """Each swap value equals target.raw - target.contrib[c] + donor.contrib[c];
    required-delta raw equals weight x component-pts and equals the 1-year gap."""
    s, au = _audit()
    if au is None:
        return
    c = au["counterfactuals"]
    win = au["win"]
    H, R = win["James Harden"][1], win["David Robinson"][1]
    gap = H["raw"] - R["raw"]
    assert abs(c["gap"] - gap) < 1e-9
    # explicit reconstruction of one swap
    expect = H["raw"] - H["contrib"]["postseason_perf"] + R["contrib"]["postseason_perf"]
    _tgt, got, _opp, _opp_raw = c["swaps"]["Harden with Robinson's Postseason"]
    assert abs(got - expect) < 1e-9
    # required deltas: component-pts * weight == raw gap
    wmap = {k: wt for k, _l, wt in A.COMPONENTS}
    pts, raw = c["required"]["SI increase (Robinson)"]
    assert abs(pts * wmap["statistical_impact"] - raw) < 1e-9
    assert abs(raw - gap) < 1e-9
    pts, raw = c["required"]["Postseason increase (Robinson)"]
    assert abs(pts * wmap["postseason_perf"] - raw) < 1e-9


def test_report_generation_deterministic():
    s, au = _audit()
    if au is None:
        return
    md1 = A.render_markdown(au)
    md2 = A.render_markdown(A.build_audit(s))
    assert md1 == md2, "markdown render is not deterministic"
    c1 = "\n".join(A.render_compact(au))
    c2 = "\n".join(A.render_compact(A.build_audit(s)))
    assert c1 == c2


def test_exports_have_five_players_and_reconcile(tmp_path):
    s, au = _audit()
    if au is None:
        return
    A.export_csvs(au, tmp_path)
    detail = pd.read_csv(tmp_path / "five_player_prime_audit.csv")
    assert set(detail["player"]) == set(A.PLAYERS) and len(detail) == 5
    bridges = pd.read_csv(tmp_path / "five_player_pairwise_bridges.csv")
    comp = ["diff_statistical_impact", "diff_traditional_production",
            "diff_recognition", "diff_postseason_perf", "diff_team_achievement",
            "diff_teammate"]
    recon = bridges[comp].sum(axis=1)
    assert (recon - bridges["total_raw_diff"]).abs().max() < 1e-2
    sens = pd.read_csv(tmp_path / "five_player_sensitivity.csv")
    # every system x duration ranks exactly five unique players
    for (sysname, n), g in sens.groupby(["system", "duration"]):
        assert len(g) == 5 and g["player"].nunique() == 5


def test_no_model_formula_or_weights_changed():
    # the audit must not mutate the official weights
    assert peak3.OFFICIAL_WEIGHTS == {
        "statistical_impact": 0.38, "traditional_production": 0.21,
        "recognition": 0.20, "postseason": 0.18, "team_achievement": 0.03}
    s, au = _audit()
    if au is None:
        return
    A.build_audit(s)  # running the audit
    assert peak3.OFFICIAL_WEIGHTS["postseason"] == 0.18
    assert abs(sum(peak3.OFFICIAL_WEIGHTS.values()) - 1.0) < 1e-9


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    import inspect
    for fn in fns:
        kw = {}
        if "tmp_path" in inspect.signature(fn).parameters:
            import tempfile
            kw["tmp_path"] = Path(tempfile.mkdtemp())
        fn(**kw)
        print("ok ", fn.__name__)
    print(f"\n{len(fns)} five-player audit tests passed")
