"""The career-window artifact is canonical PEAK3 data, and stays that way.

Three guarantees, each with its own test:

  1. PARITY. Every best window in the committed JSON equals the committed
     top-250 leaderboard CSV row (window, raw score, display score, rank). The
     artifact is a projection of the model's published output, not a second
     opinion about it.
  2. SHAPE. Every window is exactly N consecutive completed seasons, unique,
     finite, and ordered; exactly one best window per (player, duration).
  3. REPRODUCIBILITY. A fresh build of a deterministic subset of players
     produces byte-identical rows, and the recorded source digests match the
     files on disk -- so the JSON cannot silently outlive the inputs it was
     built from.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math

import pandas as pd
import pytest

from nba_peak.prime_modes.artifact import ARTIFACT_PATH, DURATIONS, REPO_ROOT, load_artifact


@pytest.fixture(scope="module")
def raw() -> dict:
    return json.loads(ARTIFACT_PATH.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def artifact():
    return load_artifact()


def _web_slug():
    spec = importlib.util.spec_from_file_location("bwd", REPO_ROOT / "scripts" / "build_web_dataset.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.slug


def test_metadata_pins_versions(artifact):
    assert artifact.version == "career_windows.v1"
    assert artifact.model_version == "peak3-v1"
    assert artifact.formula_version_id == "peak3_v1"
    assert tuple(artifact.metadata["durations"]) == DURATIONS
    assert artifact.metadata["player_count"] == len(artifact.players) == 250


def test_source_digests_match_the_files_on_disk(raw):
    for rel, digest in raw["metadata"]["source_inputs"].items():
        h = hashlib.sha256((REPO_ROOT / rel).read_bytes()).hexdigest()
        assert h == digest, f"{rel} changed since the artifact was built; rebuild it"


@pytest.mark.parametrize("n", DURATIONS)
def test_best_windows_equal_the_committed_leaderboard(artifact, n):
    board = pd.read_csv(REPO_ROOT / "leaderboards" / f"top_250_{n}_year_prime.csv")
    by_name = {p.player_name: p for p in artifact.players.values()}
    checked = 0
    for _, row in board.iterrows():
        career = by_name[row["Player"]]
        best = career.best(n)
        assert best is not None
        assert f"{best.start_season}-{best.end_season}" == row["Best window"]
        assert best.prime_score == pytest.approx(float(row["Prime display"]), abs=1e-9)
        assert best.prime_index == pytest.approx(float(row["Prime raw"]), abs=1e-9)
        assert career.canonical_rank[n] == int(row["Rank"])
        # The best window is the maximum of the career, never merely listed.
        assert best.prime_score == max(w.prime_score for w in career.windows[n])
        checked += 1
    assert checked == len(board)


def test_windows_are_contiguous_unique_and_finite(artifact):
    seen: set[str] = set()
    for career in artifact.players.values():
        season_ends = {s.season_end for s in career.seasons}
        for n, windows in career.windows.items():
            assert n in DURATIONS
            assert sum(1 for w in windows if w.is_best) == 1
            starts = [w.start_season_end for w in windows]
            assert starts == sorted(starts)
            for w in windows:
                assert w.window_id not in seen
                seen.add(w.window_id)
                assert w.end_season_end - w.start_season_end == n - 1
                assert all(y in season_ends for y in range(w.start_season_end, w.end_season_end + 1))
                assert math.isfinite(w.prime_score) and math.isfinite(w.prime_index)
                assert 0.0 <= w.prime_score <= 100.0
                assert w.window_id == f"{career.player_slug}-{n}yr-from-{w.start_season.replace('-', '')}"


def test_slugs_follow_the_published_data_web_convention(artifact):
    slug = _web_slug()
    for career in artifact.players.values():
        assert career.player_slug == slug(career.player_name)
    assert "shaquille-oneal" in artifact.players


def test_truncated_careers_are_flagged(artifact):
    # Careers that began before 1979-80 cannot have every prime window scored.
    assert not artifact.player("kareem-abdul-jabbar").career_fully_covered
    assert not artifact.player("julius-erving").career_fully_covered
    # Rookies of 1979-80 are fully inside the data.
    assert artifact.player("magic-johnson").career_fully_covered
    assert artifact.player("larry-bird").career_fully_covered


def test_a_fresh_build_reproduces_a_subset_exactly(raw):
    from nba_peak.prime_modes.build import build_payload

    subset = ["michael-jordan", "lebron-james", "shaquille-oneal", "tim-duncan", "stephen-curry", "magic-johnson"]
    fresh = build_payload(only_players=subset)
    committed = {p["player_slug"]: p for p in raw["players"]}
    assert [p["player_slug"] for p in fresh["players"]] == sorted(subset)
    for player in fresh["players"]:
        assert player == committed[player["player_slug"]]
