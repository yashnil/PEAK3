"""Regression tests: verify exported dataset matches canonical leaderboard CSVs."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent.parent
DATA_WEB = ROOT / "data" / "web" / "leaderboards.json"
LEADERBOARDS_DIR = ROOT / "leaderboards"


@pytest.fixture(scope="module")
def web_data():
    if not DATA_WEB.exists():
        pytest.skip("data/web/leaderboards.json not yet generated — run scripts/build_web_dataset.py")
    with open(DATA_WEB) as f:
        return json.load(f)


def _csv_rank1(filename: str) -> tuple[str, float, float]:
    """Return (player_name, prime_raw, prime_display) for rank 1 in a CSV."""
    import csv
    path = LEADERBOARDS_DIR / filename
    if not path.exists():
        pytest.skip(f"Leaderboard file not found: {path}")
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            return (
                row["Player"].strip(),
                float(row["Prime raw"]),
                float(row["Prime display"]),
            )
    pytest.skip("Empty CSV")


def test_1yr_rank1_matches_canonical(web_data):
    player, raw, display = _csv_rank1("top_250_1_year_prime.csv")
    rows = web_data["1"]
    rank1 = next(r for r in rows if r["rank"] == 1)
    assert rank1["player_name"] == player, f"1yr rank 1 mismatch: {rank1['player_name']} vs {player}"
    assert abs(rank1["prime_index"] - raw) < 0.01, f"prime_index mismatch: {rank1['prime_index']} vs {raw}"
    assert abs(rank1["prime_score"] - display) < 0.01, f"prime_score mismatch: {rank1['prime_score']} vs {display}"


def test_5yr_rank1_matches_canonical(web_data):
    player, raw, display = _csv_rank1("top_250_5_year_prime.csv")
    rows = web_data["5"]
    rank1 = next(r for r in rows if r["rank"] == 1)
    assert rank1["player_name"] == player
    assert abs(rank1["prime_index"] - raw) < 0.01
    assert abs(rank1["prime_score"] - display) < 0.01


def test_1yr_top10_order_matches_canonical(web_data):
    import csv
    path = LEADERBOARDS_DIR / "top_250_1_year_prime.csv"
    if not path.exists():
        pytest.skip()
    canonical = []
    with open(path, newline="", encoding="utf-8") as f:
        for i, row in enumerate(csv.DictReader(f)):
            if i >= 10:
                break
            canonical.append(row["Player"].strip())

    web_rows = sorted(web_data["1"], key=lambda r: r["rank"])[:10]
    web_names = [r["player_name"] for r in web_rows]
    assert web_names == canonical, f"Top-10 order mismatch:\nweb:  {web_names}\ncsv: {canonical}"


def test_component_contributions_are_finite(web_data):
    import math
    for dur, rows in web_data.items():
        for row in rows:
            for comp_key, val in row["components"].items():
                assert math.isfinite(val), f"NaN/Inf in {row['player_name']} {dur}yr {comp_key}: {val}"


def test_no_duplicate_ids(web_data):
    all_ids = []
    for rows in web_data.values():
        all_ids.extend(r["id"] for r in rows)
    assert len(all_ids) == len(set(all_ids)), "Duplicate window IDs found"


def test_ranks_are_sequential(web_data):
    for dur, rows in web_data.items():
        ranks = sorted(r["rank"] for r in rows)
        assert ranks == list(range(1, len(ranks) + 1)), f"Non-sequential ranks in {dur}yr"


def test_michael_jordan_is_rank1_1yr(web_data):
    rank1 = next(r for r in web_data["1"] if r["rank"] == 1)
    assert "jordan" in rank1["player_name"].lower()


def test_michael_jordan_is_rank1_5yr(web_data):
    rank1 = next(r for r in web_data["5"] if r["rank"] == 1)
    assert "jordan" in rank1["player_name"].lower()
