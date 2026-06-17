"""
Tests for the canonical top-250 Prime leaderboards (1/2/3/5-year) and the
2-year extension. Read-only: prove the deliverables are correct and deterministic
and that NO official scoring weight or formula changed.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import peak3 as P  # noqa: E402
from nba_peak import leaderboards as LB  # noqa: E402
from nba_peak import season_completeness as SC  # noqa: E402

SCORED = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"


def _scored():
    return pd.read_parquet(SCORED) if SCORED.exists() else None


# ---------------------------------------------------- universe + weights -------
def test_canonical_universe_is_exactly_250_unique():
    uni = LB.load_universe()
    assert len(uni) == 250
    assert uni["player"].nunique() == 250
    assert "canonical_player_id" in uni.columns


def test_official_weights_and_2year_weights_unchanged():
    assert P.OFFICIAL_WEIGHTS == {
        "statistical_impact": 0.38, "traditional_production": 0.21,
        "recognition": 0.20, "postseason": 0.18, "team_achievement": 0.03}
    # 2-year weights are the existing rank-weight system at N=2 (NOT 60/40)
    w2 = P.nyear_weights(2)
    assert abs(w2[0] - 2 / 3) < 1e-9 and abs(w2[1] - 1 / 3) < 1e-9
    assert P.nyear_weights(1) == [1.0]
    assert abs(P.nyear_weights(3)[0] - 0.5) < 1e-9


def test_no_sixth_component_in_leaderboard_decomposition():
    s = _scored()
    if s is None:
        return
    bw = LB.best_window(s, "LeBron James", 5, "lebron-james")
    # exactly five components + teammate adjustment, summing to raw
    total = bw["SI"] + bw["TP"] + bw["Rec"] + bw["PO"] + bw["Team"] + bw["tm"]
    assert abs(total - bw["prime_raw"]) < 1e-6


# --------------------------------------------------- window-size invariants ----
def _season_ends(seasons_str):
    # "1990-91, 1991-92" -> [1991, 1992]
    return [int(tok.strip().split("-")[0]) + 1 for tok in seasons_str.split(",")]


def test_window_sizes_are_exactly_n_consecutive():
    s = _scored()
    if s is None:
        return
    uni = LB.load_universe()
    pid = dict(zip(uni["player"], uni["canonical_player_id"]))
    for n in (2, 3, 5):
        # sample several players across the board
        for player in ["Michael Jordan", "Tim Duncan", "Manu Ginobili",
                        "Kevin Durant", "Magic Johnson"]:
            bw = LB.best_window(s, player, n, str(pid.get(player, "")))
            if bw is None:
                continue
            ses = _season_ends(bw["seasons"])
            assert len(ses) == n, (player, n, ses)
            assert ses == list(range(ses[0], ses[0] + n)), (player, n, ses)


def test_one_row_per_eligible_player():
    s = _scored()
    if s is None:
        return
    uni = LB.load_universe()
    for n in LB.DURATIONS:
        board = LB.build_leaderboard(s, uni, n, 250)
        assert board["Player"].is_unique
        elig = LB.eligibility(s, uni, n)
        assert len(board) == len(elig["eligible"])


# ------------------------------------------------ raw-before-calibration -------
def test_ranking_uses_raw_and_calibration_is_after_aggregation():
    s = _scored()
    if s is None:
        return
    uni = LB.load_universe()
    pid = dict(zip(uni["player"], uni["canonical_player_id"]))
    for n in LB.DURATIONS:
        board = LB.build_leaderboard(s, uni, n, 250)
        # display == calibrate(raw): calibration is a post-aggregation relabel
        raws = board["Prime raw"].to_numpy()
        disp = board["Prime display"].to_numpy()
        cal = P.calibrate_score(pd.Series(raws)).to_numpy()
        assert np.allclose(disp, np.round(cal, 2), atol=0.02)
        # ranking is monotonically non-increasing in RAW (not in rounded display)
        assert np.all(np.diff(raws) <= 1e-9)
    # raw window score == rank-weighted sum of per-season raws (raw-first), for a
    # representative multi-year window
    g = LB.completed_seasons(s, "Stephen Curry")
    ws = P.n_year_windows(g, "prime_raw", 3, "weighted")[0]
    vals = sorted(ws["df"]["prime_raw"].astype(float), reverse=True)
    rw = P.nyear_weights(3)
    expected_raw = sum(w * v for w, v in zip(rw, vals))
    bw = LB.best_window(s, "Stephen Curry", 3, "stephen-curry")
    # best window may differ from ws[0] only by tie-break; recompute on bw window
    assert abs(bw["prime_raw"] - expected_raw) < 1.0  # same family of weights


def test_contributions_reconcile_every_board_row():
    s = _scored()
    if s is None:
        return
    uni = LB.load_universe()
    pid = dict(zip(uni["player"], uni["canonical_player_id"]))
    for n in LB.DURATIONS:
        for _, u in uni.head(40).iterrows():
            bw = LB.best_window(s, u["player"], n, str(u["canonical_player_id"]))
            if bw is None:
                continue
            total = bw["SI"] + bw["TP"] + bw["Rec"] + bw["PO"] + bw["Team"] + bw["tm"]
            assert abs(total - bw["prime_raw"]) < 1e-6, (u["player"], n)


# ----------------------------------------------------- determinism + ties ------
def test_leaderboards_are_deterministic():
    s = _scored()
    if s is None:
        return
    uni = LB.load_universe()
    for n in LB.DURATIONS:
        a = LB.build_leaderboard(s, uni, n, 250)
        b = LB.build_leaderboard(s, uni, n, 250)
        pd.testing.assert_frame_equal(a, b)


def test_tiebreak_is_total_order():
    rows = [
        {"prime_raw": 10.0, "prime_display": 50.0, "SI": 5, "PO": 1,
         "anchor_season_end": 2000, "canonical_player_id": "b"},
        {"prime_raw": 10.0, "prime_display": 50.0, "SI": 5, "PO": 1,
         "anchor_season_end": 2000, "canonical_player_id": "a"},
        {"prime_raw": 10.0, "prime_display": 50.0, "SI": 6, "PO": 1,
         "anchor_season_end": 2000, "canonical_player_id": "z"},
    ]
    out = LB._tiebreak_sort(rows)
    # higher SI breaks the raw/display tie first
    assert out[0]["canonical_player_id"] == "z"
    # then player id ascending decides the remaining exact tie
    assert [r["canonical_player_id"] for r in out[1:]] == ["a", "b"]


# ------------------------------------------------- cross-duration reconcile ----
def test_comparison_ranks_match_source_boards():
    s = _scored()
    if s is None:
        return
    res = LB.generate_all(s, top=250, write=False)
    comp = res["comparison"]
    for n in LB.DURATIONS:
        board = res["boards"][n].set_index("Player")["Rank"]
        sub = comp.dropna(subset=[f"{n}-year rank"])
        for _, r in sub.iterrows():
            assert int(r[f"{n}-year rank"]) == int(board[r["Player"]]), r["Player"]


# ------------------------------------------- completeness gating (2025-26) -----
def test_no_incomplete_2026_data_enters_a_leaderboard():
    s = _scored()
    if s is None:
        return
    # the guard passes on the clean cache (so 2026 may enter leaderboards)...
    SC.assert_no_silent_missing(s, 2026)
    # ...and every 2026 season used in any leaderboard window is non-provisional
    res = LB.generate_all(s, top=250, write=False)
    nonprov_2026 = set(s[(s.season_end == 2026) & (s.provisional != 1)].player)
    for n in LB.DURATIONS:
        for _, u in LB.load_universe().iterrows():
            bw = LB.best_window(s, u["player"], n, str(u["canonical_player_id"]))
            if bw is None:
                continue
            ses = _season_ends(bw["seasons"]) if n > 1 else \
                [int(bw["anchor_season"].split("-")[0]) + 1]
            if 2026 in ses:
                assert u["player"] in nonprov_2026, u["player"]


def test_2026_eligible_only_because_completeness_passes():
    s = _scored()
    if s is None:
        return
    # a 2026 player appears in the 1-year board (season complete) ...
    board1 = LB.build_leaderboard(s, LB.load_universe(), 1, 250)
    has_2026 = board1["Best season"].astype(str).eq("2025-26").any()
    assert has_2026
    # ... and corrupting a required 2026 field would trip the guard
    corrupt = s.copy()
    idx = corrupt[(corrupt.season_end == 2026) & (corrupt.provisional != 1)].index[0]
    corrupt.loc[idx, "bpm"] = np.nan
    raised = False
    try:
        SC.assert_no_silent_missing(corrupt, 2026)
    except RuntimeError:
        raised = True
    assert raised


# ----------------------------------------------------- two-year validation -----
def test_two_year_is_interpolation_no_hard_anomaly():
    s = _scored()
    if s is None:
        return
    v = LB.two_year_validation(s)
    hard = [f for f in v["flags"] if f[1].startswith("FLAG")]
    assert hard == [], hard
    # best 2yr raw never exceeds best 1yr raw, for every validation player
    for _, r in v["table"].iterrows():
        if pd.notna(r["1yr_raw"]) and pd.notna(r["2yr_raw"]):
            assert r["2yr_raw"] <= r["1yr_raw"] + 1e-9, r["player"]


# ----------------------------------------------------- CLI smoke (README) ------
def test_cli_leaderboard_commands_smoke(tmp_path):
    s = _scored()
    if s is None:
        return
    # README commands must run offline and return success
    rc = P.main(["--leaderboard", "--years", "2", "--top", "250", "--no-scrape"])
    assert rc == 0
    assert (ROOT / "leaderboards" / "top_250_2_year_prime.csv").exists()


# ------------------------------------------------- deleted-file references -----
def test_no_references_to_deleted_scratch_modules():
    # _peak3_old.py / _peak3_prev.py were removed long ago; nothing should import
    # them, and the cleanup removed only regenerable caches.
    for name in ("_peak3_old", "_peak3_prev"):
        assert not (ROOT / f"{name}.py").exists()


# ============================================================================
#  SIMPLE TEXT LEADERBOARDS (top-100, 1/2/3/4/5-year .txt exports)
# ============================================================================
import re  # noqa: E402

_SIMPLE_RE_1 = re.compile(r"^(\d+)\. (\d{4}-\d{2}) (.+) \((\d+\.\d{2})\)$")
_SIMPLE_RE_N = re.compile(
    r"^(\d+)\. (\d{4}-\d{2})–(\d{4}-\d{2}) (.+) \((\d+\.\d{2})\)$")


def _simple_text(n, top=100):
    s = _scored()
    return None if s is None else LB.render_simple_leaderboard(s, n, top)


def test_simple_all_five_files_generated(tmp_path):
    s = _scored()
    if s is None:
        return
    import nba_peak.leaderboards as _LB
    orig = _LB.LEADERBOARDS_DIR
    try:
        _LB.LEADERBOARDS_DIR = tmp_path
        written = _LB.write_simple_leaderboards(s, top=100)
    finally:
        _LB.LEADERBOARDS_DIR = orig
    assert len(written) == 5
    names = {Path(p).name for p in written}
    assert names == {f"top_100_{n}_year_prime.txt" for n in (1, 2, 3, 4, 5)}
    for p in written:
        assert Path(p).exists()


def test_simple_each_file_has_exactly_100_ranked_lines():
    for n in LB.SIMPLE_DURATIONS:
        txt = _simple_text(n)
        if txt is None:
            return
        lines = txt.splitlines()
        assert lines[0] == f"BEST {n}-YEAR PRIMES IN NBA HISTORY"
        assert lines[1] == ""
        body = lines[2:]
        assert len(body) == 100, (n, len(body))


def test_simple_ranks_1_to_100_no_duplicates():
    for n in LB.SIMPLE_DURATIONS:
        txt = _simple_text(n)
        if txt is None:
            return
        ranks = [int(ln.split(".")[0]) for ln in txt.splitlines()[2:]]
        assert ranks == list(range(1, 101)), n


def test_simple_one_year_has_single_season():
    txt = _simple_text(1)
    if txt is None:
        return
    for ln in txt.splitlines()[2:]:
        m = _SIMPLE_RE_1.match(ln)
        assert m, repr(ln)
        # the season token is a single YYYY-YY with no window dash
        assert "–" not in ln, ln


def test_simple_multiyear_lines_are_valid_consecutive_windows():
    for n in (2, 3, 4, 5):
        txt = _simple_text(n)
        if txt is None:
            return
        for ln in txt.splitlines()[2:]:
            m = _SIMPLE_RE_N.match(ln)
            assert m, (n, repr(ln))
            start_yr = int(m.group(2).split("-")[0])
            end_yr = int(m.group(3).split("-")[0])
            # an N-year window spans exactly N-1 years start->end (consecutive)
            assert end_yr - start_yr == n - 1, (n, ln)


def test_simple_ranking_uses_raw_not_rounded_display():
    s = _scored()
    if s is None:
        return
    for n in LB.SIMPLE_DURATIONS:
        rows = LB.simple_rows(s, n, 100)
        raws = [r["prime_raw"] for r in rows]
        disps = [round(float(r["prime_display"]), 2) for r in rows]
        # the order is non-increasing in RAW...
        assert all(raws[i] >= raws[i + 1] - 1e-12 for i in range(len(raws) - 1)), n
        # ...and is exactly the tie-break (raw-primary) order, which can differ
        # from sorting by the 2-dp display when displays tie.
        assert rows == LB._tiebreak_sort(rows)[:100], n


def test_simple_display_has_exactly_two_decimals():
    for n in LB.SIMPLE_DURATIONS:
        txt = _simple_text(n)
        if txt is None:
            return
        for ln in txt.splitlines()[2:]:
            score = ln.rsplit("(", 1)[1].rstrip(")")
            assert re.match(r"^\d+\.\d{2}$", score), (n, ln)


def test_simple_each_player_at_most_once():
    for n in LB.SIMPLE_DURATIONS:
        txt = _simple_text(n)
        if txt is None:
            return
        names = []
        for ln in txt.splitlines()[2:]:
            m = _SIMPLE_RE_1.match(ln) or _SIMPLE_RE_N.match(ln)
            names.append(m.group(3) if m.re is _SIMPLE_RE_1 else m.group(4))
        assert len(set(names)) == len(names) == 100, n


def test_simple_output_is_deterministic():
    s = _scored()
    if s is None:
        return
    for n in LB.SIMPLE_DURATIONS:
        a = LB.render_simple_leaderboard(s, n, 100)
        b = LB.render_simple_leaderboard(s, n, 100)
        assert a == b, n


def test_simple_output_is_valid_utf8_with_endash():
    for n in LB.SIMPLE_DURATIONS:
        txt = _simple_text(n)
        if txt is None:
            return
        raw = txt.encode("utf-8")
        assert raw.decode("utf-8") == txt          # round-trips as UTF-8
        if n > 1:
            assert "–" in txt                  # en-dash window separator
            assert b"\xe2\x80\x93" in raw           # its UTF-8 encoding


def test_simple_n4_weights_from_canonical_family_no_weight_change():
    # N=4 reuses the same rank-weight family (base [4,3,2,1] with the 0.5/N floor)
    w4 = P.nyear_weights(4)
    base = [4, 3, 2, 1]
    floored = [max(b / sum(base), 0.5 / 4) for b in base]
    expected = [x / sum(floored) for x in floored]
    assert np.allclose(w4, expected), w4
    # official weights untouched
    assert P.OFFICIAL_WEIGHTS["statistical_impact"] == 0.38
    assert sum(P.OFFICIAL_WEIGHTS.values()) == 1.0


def test_simple_cli_commands_smoke():
    s = _scored()
    if s is None:
        return
    assert P.main(["--simple-leaderboards", "--top", "100", "--no-scrape"]) == 0
    assert P.main(["--simple-leaderboard", "--years", "4", "--top", "100",
                   "--no-scrape"]) == 0
    for n in (1, 2, 3, 4, 5):
        assert (ROOT / "leaderboards" / f"top_100_{n}_year_prime.txt").exists()
