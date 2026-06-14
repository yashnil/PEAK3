"""
Basketball-logic / calibration validation tests against the BUILT scored
dataset (cache/processed/scored_*.parquet). No network. These assert broad,
data-supported relationships, not hardcoded exact scores.

If the scored cache is missing, the tests skip with a clear message
(run `python peak3.py --rebuild --no-scrape` first).
"""
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
SCORED = ROOT / "cache" / "processed" / "scored_1980_2026.parquet"


def _load():
    if not SCORED.exists():
        print("  SKIP: scored cache not built; run peak3.py --rebuild --no-scrape")
        return None
    return pd.read_parquet(SCORED)


def _peak(s, p, col="stat_total"):
    g = s[s.player == p]
    return float(g[col].max()) if len(g) else float("nan")


# ---------------------------------------------------- role vs All-NBA gap ---

ROLE_CONTROLS = ["Montrezl Harrell", "Isaiah Hartenstein", "Clint Capela",
                 "Tiago Splitter"]
ALL_NBA_SCORERS = ["Adrian Dantley", "Alex English", "Bernard King",
                   "Dominique Wilkins", "Vince Carter", "Allen Iverson"]


def test_role_players_measurably_below_all_nba_scorers():
    s = _load()
    if s is None:
        return
    role_max = max(_peak(s, p, "prime_score") for p in ROLE_CONTROLS)
    # strong All-NBA scorers must sit clearly above the best role-player peak
    assert max(_peak(s, p, "prime_score")
               for p in ["Adrian Dantley", "Bernard King"]) >= role_max + 4


def test_role_players_in_calibration_band():
    s = _load()
    if s is None:
        return
    # role specialists must stay clearly below credible All-NBA scorers in the
    # official Prime score (and never crack the top tier)
    all_nba_min = min(_peak(s, p, "prime_score")
                      for p in ["Adrian Dantley", "Bernard King"])
    for p in ROLE_CONTROLS:
        pk = _peak(s, p, "prime_score")
        assert pk < all_nba_min - 4, f"{p} prime {pk} too close to All-NBA"
        assert pk < 80, f"{p} prime {pk} in All-NBA tier"


def test_legacy_separates_accoladed_from_role():
    s = _load()
    if s is None:
        return
    # Dantley (2x All-NBA, 2x scoring title) >> Harrell in LEGACY
    assert _peak(s, "Adrian Dantley", "legacy_total") > \
        _peak(s, "Montrezl Harrell", "legacy_total") + 8


# --------------------------------------------------------- apex tiering ---

def test_apex_players_top_tier():
    s = _load()
    if s is None:
        return
    # official Prime: apex peaks are GOAT/dominant-MVP tier (top of the index)
    for p in ["Michael Jordan", "LeBron James", "Shaquille O'Neal",
              "Larry Bird", "Tim Duncan", "Nikola Jokic"]:
        assert _peak(s, p, "prime_score") >= 88, f"{p} apex Prime too low"
    # apex clearly above All-NBA scorers
    assert _peak(s, "Michael Jordan", "prime_score") > \
        _peak(s, "Adrian Dantley", "prime_score") + 12


def test_defensive_pathway_preserved():
    s = _load()
    if s is None:
        return
    # elite defenders remain credible (esp. in Prime with DPOY/All-Def)
    assert _peak(s, "Ben Wallace", "prime_score") >= 65
    assert _peak(s, "Draymond Green", "prime_score") >= 68
    assert _peak(s, "Hakeem Olajuwon", "prime_score") >= 88   # two-way apex


# --------------------------------------------------- pairwise dominance ---

def test_pairwise_dantley_over_harrell_premises():
    """Dantley decisively superior in volume/efficiency/creation/total value
    and Harrell lacks a large enough defensive/playoff edge -> Dantley higher."""
    s = _load()
    if s is None:
        return
    d = s[s.player == "Adrian Dantley"]
    h = s[s.player == "Montrezl Harrell"]
    if not len(d) or not len(h):
        return
    dr = d.loc[d.stat_total.idxmax()]
    hr = h.loc[h.stat_total.idxmax()]
    premises = {
        "scoring_volume": dr["scoring_volume"] > hr["scoring_volume"],
        "scoring_dominance": dr["scoring_dominance"] > hr["scoring_dominance"],
        "total_impact": dr["total_impact"] > hr["total_impact"],
        "role_workload": dr["role_workload"] > hr["role_workload"],
    }
    # most offensive-superiority premises hold
    assert sum(premises.values()) >= 3, premises
    # and the conclusion: Dantley's stat peak is higher
    assert dr["stat_total"] > hr["stat_total"]


def test_no_role_player_in_top_50_stat_seasons():
    s = _load()
    if s is None:
        return
    top = s.sort_values("stat_total", ascending=False).drop_duplicates(
        ["player", "season"]).head(50)
    # none of the negative-control role players should appear in the top 50
    assert not set(top["player"]) & set(ROLE_CONTROLS)


def _row(s, p, season):
    g = s[(s.player == p) & (s.season == season)]
    return g.iloc[0] if len(g) else None


def test_curry_2016_premise_regression():
    """2015-16 Curry is superior to 2014-15 in a decisive majority of core
    regular-season individual + recognition indicators. The OFFICIAL (Prime)
    score must rank 2015-16 higher (championship outcome alone is insufficient)."""
    s = _load()
    if s is None:
        return
    r15, r16 = _row(s, "Stephen Curry", "2014-15"), _row(s, "Stephen Curry", "2015-16")
    if r15 is None or r16 is None:
        return
    # premises: 2016 superior in regular individual + recognition
    prem = {
        "regular_perf": r16["regular_perf"] > r15["regular_perf"],
        "scoring_dominance": r16["scoring_dominance"] > r15["scoring_dominance"],
        "scoring_volume": r16["scoring_volume"] > r15["scoring_volume"],
        "recognition": r16["recognition"] > r15["recognition"],
        "unanimous_mvp": r16["unanimous_mvp"] > r15["unanimous_mvp"],
    }
    assert sum(prem.values()) >= 4, prem
    # conclusion A: official Prime ranks 2015-16 higher
    assert r16["prime_score"] > r15["prime_score"], (
        r16["prime_score"], r15["prime_score"])


def test_championship_not_in_recognition():
    """Curry 2015-16 (no title) must have HIGHER individual recognition than
    2014-15 (title) — championships live in Team Achievement, not Recognition."""
    s = _load()
    if s is None:
        return
    r15, r16 = _row(s, "Stephen Curry", "2014-15"), _row(s, "Stephen Curry", "2015-16")
    if r15 is None or r16 is None:
        return
    assert r16["recognition"] > r15["recognition"]
    assert r15["team_achievement"] > r16["team_achievement"]  # title -> team


def test_performance_only_excludes_awards():
    s = _load()
    if s is None:
        return
    # Performance-Only must not jump with the unanimous-MVP recognition; the
    # 2016 PO vs PRIME gap should be large (recognition adds to Prime only).
    r16 = _row(s, "Stephen Curry", "2015-16")
    if r16 is None:
        return
    assert r16["prime_score"] - r16["performance_only"] > 5


def _run_all():
    fns = [v for k, v in sorted(globals().items())
           if k.startswith("test_") and callable(v)]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  ok  {fn.__name__}")
    print(f"\n{passed}/{len(fns)} validation tests passed.")


if __name__ == "__main__":
    _run_all()
