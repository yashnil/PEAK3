"""Build `career_windows.v1.json` from the canonical PEAK3 model.

WHAT THIS IS. For every player in the canonical 250-player universe and every
duration in (2, 3, 5), EVERY contiguous window of completed seasons that
`peak3.n_year_windows` can evaluate, each scored exactly the way
`nba_peak/leaderboards.py::best_window` scores the committed top-250 boards:
rank-weighted RAW aggregation, then `calibrate_score` once.

WHY A NEW ARTIFACT. `data/web/peak_windows.json` carries only each player's
BEST window, and FIND THE PRIME needs every window of a career to score a pick
that is not the best one. Recomputing windows anywhere else -- the API, the
browser -- would be a second implementation of the model.

THE PARITY GUARANTEE. `build_payload` refuses to produce an artifact whose best
window for any (player, duration) disagrees with the committed leaderboard CSV
on window, raw score or display score. The model tests re-assert it from the
committed JSON alone.

DETERMINISTIC. No timestamps, no git state, sorted keys, fixed rounding: the
same inputs produce the same bytes, which is what lets `--check` detect drift.
"""
from __future__ import annotations

import hashlib
import json
import unicodedata
from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import pandas as pd

import peak3 as P
from nba_peak import leaderboards as L
from nba_peak.prime_modes.artifact import ARTIFACT_VERSION, DURATIONS, REPO_ROOT

SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
UNIVERSE_PATH = REPO_ROOT / "data" / "generated" / "final_250_candidates.csv"
BIO_PATH = REPO_ROOT / "data" / "reference" / "player_bio.v1.json"
LEADERBOARD_CSV = {n: REPO_ROOT / "leaderboards" / f"top_250_{n}_year_prime.csv" for n in DURATIONS}

#: The published wire model version, identical to data/web/metadata.json.
MODEL_VERSION = "peak3-v1"
FORMULA_VERSION_ID = "peak3_v1"

SCORE_DECIMALS = 2   # the leaderboard's `Prime display` precision
INDEX_DECIMALS = 4   # the leaderboard's `Prime raw` precision


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _no_dash(season: str) -> str:
    return season.replace("-", "")


def career_window_id(player_slug: str, n: int, start_season: str) -> str:
    """`{slug}-{n}yr-from-{start_nodash}`.

    Distinct from the data/web id (`{slug}-{n}yr-{anchor_nodash}`) on purpose:
    two different windows of one career can share an anchor season, so an
    anchor-keyed id is not unique across ALL windows. The canonical best
    window's data/web id is carried alongside as `canonical_window_id`.
    """
    return f"{player_slug}-{n}yr-from-{_no_dash(start_season)}"


def _web_slug():
    """`scripts/build_web_dataset.py::slug`, the ONE slug implementation.

    The universe CSV's `player_id` is not the published slug for every player
    (`shaquille-o-neal` vs data/web's `shaquille-oneal`), and a second copy of
    the slug rules would drift from the first. Loaded by path because it lives
    in a script, not a package.
    """
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "_peak3_build_web_dataset", REPO_ROOT / "scripts" / "build_web_dataset.py"
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module.slug


def _norm_name(name: str) -> str:
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return folded.lower().replace(".", "").replace("'", "").strip()


def _bio_for(player: str, first_season_end: int, bio: dict) -> Optional[dict]:
    """The reference-bio row for a universe player.

    The reference dataset is keyed by Basketball-Reference id and the universe
    by display name, so this is a NAME join -- used for ONE thing, the
    career-coverage flag, never for a score. The two duplicate names in the
    universe (Patrick Ewing, Bobby Jones) are resolved by requiring the bio's
    career span to contain the player's first scored season; an unresolvable
    match returns None and the player is treated as not fully covered.
    """
    target = _norm_name(player)
    matches = [
        row for row in bio.values()
        if _norm_name(row["name"]) == target
        and int(row["career_year_min"]) <= first_season_end <= int(row["career_year_max"])
    ]
    return matches[0] if len(matches) == 1 else None


def _window_rows(scored: pd.DataFrame, player: str, slug: str, player_id: str, n: int) -> list[dict]:
    g = L.completed_seasons(scored, player)
    windows = P.n_year_windows(g, "prime_raw", n, "weighted")
    if not windows:
        return []
    best = L.best_window(scored, player, n, player_id)
    rows = []
    for w in windows:
        dec = P.nyear_window_decomposition(w, "prime_raw", "weighted")
        raw = float(dec["_raw_window_score"])
        display = float(P.calibrate_score(pd.Series([raw])).iloc[0])
        wdf = w["df"].sort_values("season_end")
        start_end = int(wdf["season_end"].iloc[0])
        rows.append(
            {
                "window_id": career_window_id(slug, n, str(w["start_season"])),
                "start_season": str(w["start_season"]),
                "end_season": str(w["end_season"]),
                "start_season_end": start_end,
                "end_season_end": int(wdf["season_end"].iloc[-1]),
                "prime_score": round(display, SCORE_DECIMALS),
                "prime_index": round(raw, INDEX_DECIMALS),
                "completeness": L._completeness_status(wdf),
                "is_best": best is not None and str(w["start_season"]) == best["start_season"],
            }
        )
    rows.sort(key=lambda r: r["start_season_end"])
    if sum(1 for r in rows if r["is_best"]) != 1:
        raise ValueError(f"{player} {n}Y: expected exactly one canonical best window")
    return rows


def _quantiles(values: Iterable[float], qs=(10, 25, 50, 75, 90)) -> dict[str, float]:
    arr = np.asarray(list(values), dtype=float)
    if arr.size == 0:
        return {}
    return {f"p{q}": round(float(np.percentile(arr, q)), 4) for q in qs}


def build_payload(
    scored: Optional[pd.DataFrame] = None,
    only_players: Optional[Iterable[str]] = None,
) -> dict:
    scored = scored if scored is not None else pd.read_parquet(SCORED_PATH)
    universe = L.load_universe()
    bio = json.loads(BIO_PATH.read_text(encoding="utf-8"))["players"]
    boards = {n: pd.read_csv(LEADERBOARD_CSV[n]) for n in DURATIONS}
    wanted = set(only_players) if only_players is not None else None
    slugify = _web_slug()

    players = []
    for _, u in universe.iterrows():
        name = str(u["player"])
        slug = slugify(name)
        if wanted is not None and slug not in wanted:
            continue
        g = L.completed_seasons(scored, name).sort_values("season_end")
        if g.empty:
            continue
        first_end = int(g["season_end"].iloc[0])
        bio_row = _bio_for(name, first_end, bio)
        covered = bool(bio_row and bio_row.get("career_fully_in_window"))
        windows: dict[str, list[dict]] = {}
        ranks: dict[str, int] = {}
        canonical_ids: dict[str, str] = {}
        for n in DURATIONS:
            rows = _window_rows(scored, name, slug, str(u["canonical_player_id"]), n)
            if not rows:
                continue
            board = boards[n]
            hit = board[board["Player"] == name]
            best = next(r for r in rows if r["is_best"])
            if not hit.empty:
                csv = hit.iloc[0]
                expected_window = f"{csv['Best window']}"
                got_window = f"{best['start_season']}-{best['end_season']}"
                if (
                    got_window != expected_window
                    or abs(best["prime_score"] - float(csv["Prime display"])) > 1e-9
                    or abs(best["prime_index"] - float(csv["Prime raw"])) > 1e-9
                ):
                    raise ValueError(
                        f"{name} {n}Y best window {got_window} "
                        f"{best['prime_score']}/{best['prime_index']} disagrees with "
                        f"{LEADERBOARD_CSV[n].name}: {expected_window} "
                        f"{csv['Prime display']}/{csv['Prime raw']}"
                    )
                ranks[str(n)] = int(csv["Rank"])
                anchor = str(csv["Anchor season"])
                canonical_ids[str(n)] = f"{slug}-{n}yr-{_no_dash(anchor)}"
            windows[str(n)] = rows
        players.append(
            {
                "player_slug": slug,
                "player_name": name,
                "career_fully_covered": covered,
                "career_year_min": int(bio_row["career_year_min"]) if bio_row else first_end,
                "seasons": [
                    {"season": str(r["season"]), "season_end": int(r["season_end"]), "team": str(r["team"])}
                    for _, r in g.iterrows()
                ],
                "windows": windows,
                "canonical_rank": ranks,
                "canonical_window_id": canonical_ids,
            }
        )
    players.sort(key=lambda p: p["player_slug"])

    # DISTRIBUTION STATS, recorded so every gameplay threshold that is derived
    # from the real score distribution can cite the numbers it came from.
    distribution: dict[str, dict] = {}
    for n in DURATIONS:
        board_scores = np.sort(boards[n]["Prime display"].astype(float).to_numpy())
        adjacent = np.abs(np.diff(board_scores))
        spreads, top_gaps, counts = [], [], []
        for p in players:
            scores = sorted((w["prime_score"] for w in p["windows"].get(str(n), [])), reverse=True)
            counts.append(len(scores))
            if len(scores) >= 2:
                spreads.append(scores[0] - scores[-1])
                top_gaps.append(scores[0] - scores[1])
        distribution[str(n)] = {
            "board_adjacent_gap": _quantiles(adjacent),
            "board_score": _quantiles(board_scores, (0, 10, 25, 50, 75, 90, 100)),
            "career_best_to_worst_spread": _quantiles(spreads),
            "career_top_two_gap": _quantiles(top_gaps),
            "career_window_count": _quantiles(counts),
        }

    sources = [SCORED_PATH, UNIVERSE_PATH, BIO_PATH, *LEADERBOARD_CSV.values()]
    metadata = {
        "artifact_version": ARTIFACT_VERSION,
        "model_version": MODEL_VERSION,
        "formula_version_id": FORMULA_VERSION_ID,
        "durations": list(DURATIONS),
        "generator": "scripts/build_prime_windows.py",
        "aggregation": "peak3.n_year_windows(weighted) -> nyear_window_decomposition raw -> calibrate_score",
        "window_id_format": "{player_slug}-{n}yr-from-{start_season_nodash}",
        "coverage_rule": (
            "career_fully_covered is player_bio.v1 career_fully_in_window, joined by name and "
            "disambiguated by career span; false means the career began before the scored data"
        ),
        "score_decimals": SCORE_DECIMALS,
        "index_decimals": INDEX_DECIMALS,
        "player_count": len(players),
        "window_count": sum(len(ws) for p in players for ws in p["windows"].values()),
        "source_inputs": {str(p.relative_to(REPO_ROOT)): _sha256(p) for p in sources},
        "distribution": distribution,
    }
    return {"metadata": metadata, "players": players}


def dumps(payload: dict) -> str:
    return json.dumps(payload, indent=1, sort_keys=True, ensure_ascii=True) + "\n"
