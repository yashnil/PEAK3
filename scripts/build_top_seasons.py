#!/usr/bin/env python3
"""Phase 9B: Top individual SEASONS, plus the per-row explainability payload.

Answers "what are the best single seasons ever, according to PEAK3?" -- which
neither existing rankings board can, because both are one-row-per-player
(each player's single best window). This is the same 1-year PEAK3 math with
the per-player dedup REMOVED, so a player can legitimately appear many times
(Jordan holds 9 of the top 50).

CHANGES NO SCORING LOGIC. Every number here is read straight out of the
already-committed cache/processed/scored_1980_2026.parquet, which holds the
official per-season `prime_raw`/`prime_score` produced by peak3.py's own
calibrate_score() plus the official weighted component contributions. This
script only SORTS and PROJECTS existing columns -- it never recomputes,
approximates, or fabricates a score (CLAUDE.md: never calculate PEAK3 scores
outside the model; never replace missing data with fabricated values).

Sort order mirrors the canonical leaderboards' own tiebreak
(nba_peak.leaderboards._tiebreak_sort) so a season's position here is
consistent with how it would rank inside a canonical board:
  prime_raw desc, prime_score desc, statistical-impact contribution desc,
  postseason contribution desc, season_end asc, player_slug asc.

Two blocks are written into one file, deliberately:
  rows    -- lean fields for the ranked table (fast first paint)
  explain -- the heavy per-season breakdown, keyed by season_id, for the
             click-to-explain modal (fetched per row, not with the table)
This keeps the table payload small while still shipping one reproducible
artifact.

Output (this directory is git-tracked, unlike the gitignored data/web/, so
no CI build step or Makefile assertion needs to change):
  data/game/experimental/player_pool_1500/top_1000_seasons.v1.json

Usage:
    python scripts/build_top_seasons.py
"""
from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import peak3 as P  # noqa: E402

SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
OUT_DIR = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
OUT_PATH = OUT_DIR / "top_1000_seasons.v1.json"

DATASET_VERSION = "top_1000_seasons.v1"
TOP_N = 1000

# ---------------------------------------------------------------------------
# Phase 9B: minimum minutes-per-game for a season to be SERVED on this board.
#
# Identical floor, and identical reasoning, to
# scripts/build_top_peaks.py::MIN_SERVED_ANCHOR_MPG -- applied here to the
# season's OWN mpg, because on this board a row IS a single season (there is no
# window, so there is no separate anchor).
#
# Root cause it closes: the only minutes gate anywhere upstream is
# peak3.regular_minutes_threshold (1000 minutes over 82 games, ~12.2 MPG), so
# without this floor a board built straight off the scored parquet republishes
# the exact low-minute leakage the sibling board was just fixed for (Luka Garza
# on a 16.2 MPG season, Gary Payton II on 17.6, Isaiah Hartenstein -- who is a
# hardcoded negative control in tests/test_validation.py::ROLE_CONTROLS).
#
# This is a SERVING/display gate, not a scoring change. It never touches
# peak3.py, OFFICIAL_WEIGHTS, calibrate_score(), or any stored value, and it
# never reorders the rows it keeps -- it only declines to publish a season whose
# sample is too thin for a peak-value ranking to mean anything. Every excluded
# season is still fully scored and still reachable everywhere else.
#
# A season with NO mpg value is not admitted: an unknown sample is exactly the
# case this gate exists to exclude.
#
# 25.0 is the documented FALLBACK tier of the project's own intended inclusion
# criteria (30+ MPG primary, 25+ MPG fallback), i.e. the most permissive gate
# consistent with the stated design rather than a new editorial threshold.
# ---------------------------------------------------------------------------
MIN_SERVED_SEASON_MPG = 25.0

# Below this raw prime_index gap, two seasons are not meaningfully ordered by
# the model -- the UI is instructed to present them as effectively tied rather
# than as a confident ranking. Sized off the audited near-ties (Embiid 2022-23
# vs Howard 2008-09 are 0.03 raw points apart; Jaylen Brown vs Deandre Ayton
# 0.02), which the ordering treats as decided but a reader should not.
EFFECTIVE_TIE_THRESHOLD = 0.5

SUPPORTED_START_SEASON = "1979-80"
SUPPORTED_END_SEASON = "2025-26"
FORMULA_VERSION = (
    "peak3_official_weights_v1 (statistical_impact=0.38, traditional_production=0.21, "
    "recognition=0.20, postseason=0.18, team_achievement=0.03)"
)

# The five official weighted contributions, mapped from the parquet's own
# column names to the web contract's names (already used by
# data/web/leaderboards.json and the TS PeakWindowComponents interface) so the
# frontend needs no third naming convention.
_COMPONENT_COLUMNS: dict[str, str] = {
    "statistical_impact": "contrib_statistical_impact",
    "traditional_production": "contrib_traditional_production",
    "individual_recognition": "contrib_recognition",
    "postseason_individual_value": "contrib_postseason",
    "team_achievement": "contrib_team_achievement",
}
_TEAMMATE_ADJ_COLUMN = "teammate_adjustment"

# peak3.OFFICIAL_WEIGHTS keys its five weights with the MODEL's names, two of
# which differ from the web contract's names above. Mapped explicitly so the
# published weight is read out of OFFICIAL_WEIGHTS itself (never re-typed as a
# literal) and never silently comes back None.
_OFFICIAL_WEIGHT_KEYS: dict[str, str] = {
    "statistical_impact": "statistical_impact",
    "traditional_production": "traditional_production",
    "individual_recognition": "recognition",
    "postseason_individual_value": "postseason",
    "team_achievement": "team_achievement",
}

# Which side of the formula each official component sits on. Used only to SUM
# already-official contributions into the regular-season / postseason /
# recognition / team-context split the explain modal shows -- the audited
# controversies (Kobe 2007-08 over 2005-06, Embiid 2022-23 over Howard
# 2008-09, Hakeem 1993-94 over Robinson 1994-95) are all decided by the same
# mechanism: a regular-season deficit overturned by the non-regular-season
# 41% of the weight vector. Grouping the real numbers makes that legible; it
# invents nothing.
_REGULAR_SEASON_COMPONENTS = ("statistical_impact", "traditional_production")

# Multi-team aggregate rows: a player traded mid-season has one combined row,
# never a per-team split (see nba_peak/perfect_season/exact_season.py's own
# documented limitation). Surfaced honestly in the row rather than hidden.
_MULTI_TEAM_CODES = {"2TM", "3TM", "4TM", "5TM", "TOT"}

# Columns whose "observed" vs derived status decides the row's completeness
# label; same set nba_peak.leaderboards._completeness_status uses, so this
# board's plain-string `data_completeness` means exactly what the sibling PEAK
# Index board's does.
_FALLBACK_STATUS_COLUMNS: dict[str, str] = {
    "burden": "burden_data_status",
    "team_share": "team_share_data_status",
    "mvp_vote": "mvp_vote_data_status",
    "dpoy_vote": "dpoy_vote_data_status",
}

# Deterministic caps for the comparison rails in the explain payload.
_MAX_SAME_PLAYER = 5
_MAX_SIMILAR_SCORES = 6
_MAX_SEASON_PEERS = 5

# The scored parquet stores rate stats per-75/per-100, not per-game. ppg/rpg/apg
# are therefore published as null rather than back-solved from a rate: CLAUDE.md
# forbids replacing missing data with fabricated values.
_PER_GAME_NOTE = (
    "The scored dataset stores rate statistics per-75 and per-100 possessions, not per game. "
    "ppg/rpg/apg are published as null rather than reconstructed, and the real per-75/per-100 "
    "values are provided instead."
)

# The most recent season in the committed parquet is still IN PROGRESS
# (season_progress_pct < 1.0). Those rows are real and officially scored, so
# they are NOT excluded -- excluding them would be a silent editorial choice --
# but each is flagged so the table and modal can label it instead of quietly
# ranking a partial season against 45 completed ones.
_IN_PROGRESS_SEASON = "2025-26"


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def _season_id(player_slug: str, season: str) -> str:
    """Same convention as scripts/build_web_dataset.py::window_id -- a single
    season IS a 1-year window, so `michael-jordan-1yr-199091` intentionally
    matches the canonical 1Y window id for the same player-season. (player,
    season) is unique in the parquet, so no team segment is needed."""
    return f"{player_slug}-1yr-{season.replace('-', '')}"


def _num(row, column: str):
    """A float from the row, or None -- never NaN/Inf in the output (the web
    dataset exporter enforces the same rule)."""
    if column not in row.index:
        return None
    value = row[column]
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    if pd.isna(value):
        return None
    return float(value)


def _text(row, column: str):
    if column not in row.index:
        return None
    value = row[column]
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


def _percentile_frames(scored: pd.DataFrame) -> dict[str, pd.Series]:
    """0-100 percentile rank of each component contribution against the FULL
    scored population. Same method as
    nba_peak.perfect_season.exact_season.component_percentile -- a real,
    reproducible statistic over real data, used so the modal can say "top 2%
    of all scored seasons on postseason value" instead of showing a bare
    weighted number the reader has no scale for."""
    out: dict[str, pd.Series] = {}
    for web_name, column in _COMPONENT_COLUMNS.items():
        if column in scored.columns:
            out[web_name] = scored[column].rank(pct=True) * 100.0
    return out


def _served_percentiles(served: list) -> dict[str, list]:
    """0-100 percentile rank of each component contribution -- and of the total
    ordering index -- against the SERVED population of this board.

    Same method as _percentile_frames and as
    nba_peak.perfect_season.exact_season.component_percentile
    (`df.rank(pct=True) * 100`), but over the 1000 published rows rather than all
    ~11k scored seasons, and this is the scale the table and modal display.

    Why within-board: every row here is already a top-1000 season, so a
    full-population percentile saturates near 100 for the volume components and
    separates nothing. The full-population number is still published alongside
    it as `population_percentile`, so no information is lost.
    """
    out: dict[str, list] = {}
    for web_name, column in _COMPONENT_COLUMNS.items():
        values = [_num(r, column) for r in served]
        ranked = pd.Series(values, dtype="float64").rank(pct=True) * 100.0
        out[web_name] = [
            round(float(v), 1) if pd.notna(v) else None for v in ranked
        ]
    totals = [_num(r, "prime_raw") for r in served]
    ranked_total = pd.Series(totals, dtype="float64").rank(pct=True) * 100.0
    out["total"] = [round(float(v), 1) if pd.notna(v) else None for v in ranked_total]
    return out


def _completeness_label(row) -> str:
    """"complete" / "complete*", identical in meaning to
    nba_peak.leaderboards._completeness_status, so this board's plain-string
    data_completeness is directly comparable to the PEAK Index board's."""
    for column in _FALLBACK_STATUS_COLUMNS.values():
        status = _text(row, column)
        if status is not None and status.lower() != "observed":
            return "complete*"
    return "complete"


def _components_block(
    row,
    pct: dict[str, pd.Series],
    served_pct: dict[str, list],
    i: int,
) -> list[dict]:
    """Per-component contribution + official weight + percentile.

    `percentile` is the within-board rank (the displayed scale, shared with the
    PEAK Index board); `population_percentile` is the rank against all scored
    seasons, kept so the modal can still say "top 2% of every scored season".
    """
    block: list[dict] = []
    for web_name, column in _COMPONENT_COLUMNS.items():
        contribution = _num(row, column)
        population_percentile = None
        if web_name in pct:
            raw = pct[web_name].get(row.name)
            if raw is not None and pd.notna(raw):
                population_percentile = round(float(raw), 1)
        weight = P.OFFICIAL_WEIGHTS[_OFFICIAL_WEIGHT_KEYS[web_name]]
        block.append({
            "component": web_name,
            "contribution": round(contribution, 4) if contribution is not None else None,
            "weight": weight,
            "percentile": served_pct[web_name][i],
            "population_percentile": population_percentile,
        })
    return block


def _comparison_rails(rows: list[dict]) -> dict[str, dict]:
    """Deterministic comparison rails, keyed by row_id. Identical rules to
    scripts/build_top_peaks.py::_comparison_rails:

    same_player       -- other served rows for the same player, nearest by
                         |prime_score delta|, capped at 5, then sorted by
                         prime_score desc. This is the rail that makes "Kobe
                         2007-08 vs 2005-06" explorable, and it is only possible
                         on this board because this board allows repeats.
    similar_scores    -- nearest rows by |prime_index delta| excluding the same
                         player, capped at 6, tie-broken by rank asc so the
                         output is byte-stable across runs.
    same_season_peers -- rows sharing the same NBA season, nearest by score,
                         capped at 5, excluding self.

    Every entry carries a row_id so the modal can pivot straight to it.
    """
    by_player: dict[str, list[dict]] = {}
    by_season: dict[str, list[dict]] = {}
    for row in rows:
        by_player.setdefault(row["player_slug"], []).append(row)
        by_season.setdefault(row["season"], []).append(row)

    out: dict[str, dict] = {}
    for row in rows:
        row_id = row["row_id"]
        score = row["prime_score"] or 0.0
        index = row["prime_index"] or 0.0

        same_player = [o for o in by_player[row["player_slug"]] if o["row_id"] != row_id]
        same_player.sort(key=lambda o: (abs((o["prime_score"] or 0.0) - score), o["rank"]))
        same_player = sorted(
            same_player[:_MAX_SAME_PLAYER], key=lambda o: -(o["prime_score"] or 0.0)
        )

        similar = [o for o in rows if o["player_slug"] != row["player_slug"]]
        similar.sort(key=lambda o: (abs((o["prime_index"] or 0.0) - index), o["rank"]))
        similar = similar[:_MAX_SIMILAR_SCORES]

        peers = [o for o in by_season[row["season"]] if o["row_id"] != row_id]
        peers.sort(key=lambda o: (abs((o["prime_score"] or 0.0) - score), o["rank"]))
        peers = peers[:_MAX_SEASON_PEERS]

        out[row_id] = {
            "same_player": [
                {
                    "row_id": o["row_id"],
                    "label": o["label"],
                    "prime_score": o["prime_score"],
                    "rank": o["rank"],
                    "delta": round((o["prime_score"] or 0.0) - score, 2),
                }
                for o in same_player
            ],
            "similar_scores": [
                {
                    "row_id": o["row_id"],
                    "player_name": o["player_name"],
                    "label": o["label"],
                    "prime_score": o["prime_score"],
                    "rank": o["rank"],
                    "delta": round((o["prime_score"] or 0.0) - score, 2),
                    # The rail's actual sort key, published so the ordering is
                    # auditable rather than something a reader has to trust.
                    # `delta` is the calibrated-score gap the UI displays; the
                    # ordering is by the RAW index, which is what the board is
                    # ranked on, and the two are monotone but not identical.
                    "index_delta": round((o["prime_index"] or 0.0) - index, 2),
                }
                for o in similar
            ],
            "same_season_peers": [
                {
                    "row_id": o["row_id"],
                    "player_name": o["player_name"],
                    "label": o["label"],
                    "prime_score": o["prime_score"],
                    "rank": o["rank"],
                }
                for o in peers
            ],
        }
    return out


def main() -> int:
    if not SCORED_PATH.exists():
        print(f"ERROR: {SCORED_PATH} missing -- broken checkout (this file is committed).")
        return 1

    scored = pd.read_parquet(SCORED_PATH)
    required = ["player", "season", "prime_raw", "prime_score"]
    missing = [c for c in required if c not in scored.columns]
    if missing:
        print(f"ERROR: scored parquet is missing required column(s): {missing}")
        return 1

    scored = scored.copy()
    scored["player_slug"] = scored["player"].map(_slug)
    if "season_end" not in scored.columns:
        scored["season_end"] = scored["season"].str.slice(0, 4).astype(int) + 1

    pct = _percentile_frames(scored)

    ranked = scored.sort_values(
        by=[
            "prime_raw",
            "prime_score",
            _COMPONENT_COLUMNS["statistical_impact"],
            _COMPONENT_COLUMNS["postseason_individual_value"],
            "season_end",
            "player_slug",
        ],
        ascending=[False, False, False, False, True, True],
        kind="mergesort",  # stable, so equal keys keep a reproducible order
    )

    # Phase 9B serving gate. Applied by walking the FULL sorted population and
    # skipping thin-sample seasons, rather than capping at TOP_N first --
    # capping first would let excluded rows consume published slots and silently
    # shrink the board below TOP_N. Ranks are assigned AFTER filtering, so the
    # served list is a dense 1..N with no gaps.
    served: list = []
    excluded_low_minute_seasons = 0
    for _, candidate in ranked.iterrows():
        season_mpg = _num(candidate, "mpg")
        if season_mpg is None or season_mpg < MIN_SERVED_SEASON_MPG:
            excluded_low_minute_seasons += 1
            continue
        served.append(candidate)
        if len(served) >= TOP_N:
            break

    # Percentiles against the served board -- computable only once the gate has
    # decided the population, so this sits between the two loops.
    served_pct = _served_percentiles(served)

    rows: list[dict] = []
    explain: dict[str, dict] = {}

    for i, r in enumerate(served):
        rank = i + 1
        player_slug = str(r["player_slug"])
        season = str(r["season"])
        season_id = _season_id(player_slug, season)
        team = _text(r, "team")
        is_multi_team = team in _MULTI_TEAM_CODES if team else False
        prime_score = _num(r, "prime_score")
        components = _components_block(r, pct, served_pct, i)
        season_mpg = _num(r, "mpg")
        completeness = _completeness_label(r)

        by_name = {c["component"]: (c["contribution"] or 0.0) for c in components}
        # Flat {component: weighted contribution} and {component|total:
        # percentile} dicts -- the shared rankings contract both boards publish,
        # on the ROW as well as in the explain block, so one normalizer reads
        # either identically.
        component_values = {c["component"]: c["contribution"] for c in components}
        percentiles = {web: served_pct[web][i] for web in _COMPONENT_COLUMNS}
        percentiles["total"] = served_pct["total"][i]

        rows.append({
            "rank": rank,
            # Both ids on purpose: `season_id` is the pre-9C name existing
            # clients read, `row_id` is the shared two-board contract. Same
            # value, so either can key the explain route.
            "season_id": season_id,
            "row_id": season_id,
            "player_slug": player_slug,
            "player_name": str(r["player"]),
            "season": season,
            # The shared contract's human label. On this board a row IS a
            # season, so the label is the season.
            "label": season,
            "team": team,
            "is_multi_team_season": is_multi_team,
            "prime_score": round(prime_score, 2) if prime_score is not None else None,
            "prime_index": round(_num(r, "prime_raw") or 0.0, 2),
            "components": component_values,
            "percentiles": percentiles,
            # Per-row so the serving-gate invariant is directly assertable and
            # the UI can show the sample it is ranking. `mpg` is the shared
            # contract's name for the same number.
            "season_mpg": round(season_mpg, 1) if season_mpg is not None else None,
            "mpg": round(season_mpg, 1) if season_mpg is not None else None,
            "data_completeness": completeness,
            "season_in_progress": season == _IN_PROGRESS_SEASON,
        })

        regular_season_total = sum(by_name.get(k, 0.0) for k in _REGULAR_SEASON_COMPONENTS)

        # Strongest/weakest components BY PERCENTILE, not by raw contribution:
        # team_achievement is capped at a 3% weight, so it is almost always the
        # numerically smallest contribution and would otherwise be named "the
        # weakness" for literally every season on the board.
        ranked_components = [c for c in components if c["percentile"] is not None]
        ranked_components.sort(key=lambda c: (-c["percentile"], c["component"]))

        explain[season_id] = {
            "season_id": season_id,
            "row_id": season_id,
            "player_slug": player_slug,
            "player_name": str(r["player"]),
            "season": season,
            "label": season,
            "seasons_in_window": [season],
            "team": team,
            "is_multi_team_season": is_multi_team,
            "window_type": "single_season",
            "rank": rank,
            "prime_score": round(prime_score, 2) if prime_score is not None else None,
            "prime_index": round(_num(r, "prime_raw") or 0.0, 2),
            # Same flat dict as the row (the shared contract); the per-component
            # list with weights and percentiles sits next to it as
            # `component_detail` for the bar chart.
            "components": component_values,
            "component_detail": components,
            "percentiles": percentiles,
            "percentile_population": f"served Single Seasons board ({len(served)} rows)",
            "weights": {
                web: P.OFFICIAL_WEIGHTS[key] for web, key in _OFFICIAL_WEIGHT_KEYS.items()
            },
            "mpg": round(season_mpg, 1) if season_mpg is not None else None,
            "season_in_progress": season == _IN_PROGRESS_SEASON,
            "season_stats": {
                "season": season,
                "is_anchor_season_only": False,
                "games": _num(r, "g"),
                "minutes_total": _num(r, "mp"),
                "mpg": round(season_mpg, 1) if season_mpg is not None else None,
                # Never back-solved from a rate -- see _PER_GAME_NOTE.
                "ppg": None,
                "rpg": None,
                "apg": None,
                "pts_per_75": _num(r, "pts_per75"),
                "ast_per_75": _num(r, "ast_per75"),
                "pts_per_100": _num(r, "pts_per100"),
                "trb_per_100": _num(r, "trb_per100"),
                "ast_per_100": _num(r, "ast_per100"),
                "ts_pct": _num(r, "ts_pct"),
                "ts_plus": _num(r, "ts_plus"),
                "usg_pct": _num(r, "usg_pct"),
                "per": _num(r, "per"),
                "bpm": _num(r, "bpm"),
                "obpm": _num(r, "obpm"),
                "dbpm": _num(r, "dbpm"),
                "vorp": _num(r, "vorp"),
                "ws": _num(r, "total_ws"),
                "ws_per_48": _num(r, "ws_per_48"),
            },
            # Sums of the SAME official contributions listed above, grouped so a
            # reader can see the regular-season half against the postseason /
            # recognition / team-context half that decides the close calls.
            "score_split": {
                "regular_season": round(regular_season_total, 4),
                "regular_season_components": list(_REGULAR_SEASON_COMPONENTS),
                "postseason": by_name.get("postseason_individual_value"),
                "recognition": by_name.get("individual_recognition"),
                # Both names on purpose: `team` is the shared rankings contract,
                # `team_achievement` matches the component key.
                "team": by_name.get("team_achievement"),
                "team_achievement": by_name.get("team_achievement"),
                "non_regular_season": round(
                    by_name.get("postseason_individual_value", 0.0)
                    + by_name.get("individual_recognition", 0.0)
                    + by_name.get("team_achievement", 0.0),
                    4,
                ),
            },
            "season_mpg": round(season_mpg, 1) if season_mpg is not None else None,
            "teammate_adjustment": (
                round(_num(r, _TEAMMATE_ADJ_COLUMN), 4)
                if _num(r, _TEAMMATE_ADJ_COLUMN) is not None else None
            ),
            "strongest_components": [c["component"] for c in ranked_components[:2]],
            "weakest_components": [c["component"] for c in ranked_components[-2:]][::-1],
            # Real context fields, straight from the parquet -- never invented.
            "recognition": {
                "awards": _text(r, "awards"),
                "mvp_vote_share": _num(r, "mvp_vote_share"),
                "dpoy_vote_share": _num(r, "dpoy_vote_share"),
            },
            "team_context": {
                "championship": _num(r, "championship"),
                "finals_appearance": _num(r, "finals_appearance"),
                "made_playoffs": _num(r, "made_playoffs"),
                "n_teams": _num(r, "n_teams"),
            },
            "postseason": {
                "games": _num(r, "po_g"),
                "minutes": _num(r, "po_mp"),
                "series_count": _num(r, "po_series_n"),
                "availability": _text(r, "postseason_availability"),
            },
            "role_and_sample": {
                "games_played": _num(r, "g"),
                "minutes_total": _num(r, "mp"),
                "minutes_per_game": round(season_mpg, 1) if season_mpg is not None else None,
                "role": _text(r, "role"),
                "season_complete": _num(r, "season_complete"),
                "season_progress_pct": _num(r, "season_progress_pct"),
            },
            # The shared contract's `data_completeness` is a plain string, same
            # vocabulary as the PEAK Index board ("complete" / "complete*"); the
            # per-input statuses that produced it sit alongside it.
            "data_completeness": completeness,
            "data_completeness_detail": {
                "burden": _text(r, "burden_data_status"),
                "team_share": _text(r, "team_share_data_status"),
                "mvp_vote": _text(r, "mvp_vote_data_status"),
                "dpoy_vote": _text(r, "dpoy_vote_data_status"),
            },
            # Honest, non-fabricated caveats the UI must surface rather than
            # silently absorb.
            "caveats": [
                caveat for caveat in (
                    (
                        "This season is still in progress in the committed dataset "
                        f"({round((_num(r, 'season_progress_pct') or 0) * 100)}% elapsed) -- it is ranked "
                        "against completed seasons."
                    ) if season == _IN_PROGRESS_SEASON else None,
                    (
                        "PEAK3 scores one row per player-season, so this traded season is a "
                        "combined multi-team total, not a single-team split."
                    ) if is_multi_team else None,
                    (
                        "Availability flag: this player did not reach ~92% of the team's games, "
                        "which is a durability signal, not missing data."
                    ) if _num(r, "season_complete") == 0 else None,
                    (
                        "One or more inputs for this season are model-derived rather than directly "
                        "observed (data completeness 'complete*')."
                    ) if completeness.endswith("*") else None,
                ) if caveat
            ],
        }

    # Second pass: adjacent-rank margins. The audited near-ties are decided by
    # hundredths of a raw point, so every explain block carries the real gap to
    # the rows immediately above and below it plus an explicit
    # `effectively_tied` flag, letting the UI present a coin-flip as a coin-flip
    # instead of as a confident ordering.
    rails = _comparison_rails(rows)
    for i, row in enumerate(rows):
        block = explain[row["season_id"]]
        block["comparisons"] = rails[row["row_id"]]
        margins: dict[str, dict | None] = {"above": None, "below": None}
        for key, j in (("above", i - 1), ("below", i + 1)):
            if 0 <= j < len(rows):
                other = rows[j]
                gap = abs(row["prime_index"] - other["prime_index"])
                margins[key] = {
                    "rank": other["rank"],
                    "player_name": other["player_name"],
                    "season": other["season"],
                    "prime_index": other["prime_index"],
                    "gap": round(gap, 2),
                    "effectively_tied": gap < EFFECTIVE_TIE_THRESHOLD,
                }
        block["margins"] = margins
        block["effective_tie_threshold"] = EFFECTIVE_TIE_THRESHOLD
        block["min_season_mpg"] = MIN_SERVED_SEASON_MPG

    payload = {
        "dataset_version": DATASET_VERSION,
        "generation_command": "python scripts/build_top_seasons.py",
        "source_provenance": {
            "scored": str(SCORED_PATH.relative_to(REPO_ROOT)),
            "method": (
                "Pure sort/projection of already-official per-season prime_raw/prime_score and "
                "weighted component contributions from peak3.py's own calibrate_score output. No "
                "score is recomputed, approximated, or fabricated here."
            ),
            "sort_order": (
                "prime_raw desc, prime_score desc, statistical_impact contribution desc, "
                "postseason contribution desc, season_end asc, player_slug asc"
            ),
        },
        "formula_version": FORMULA_VERSION,
        "official_weights": P.OFFICIAL_WEIGHTS,
        "supported_start_season": SUPPORTED_START_SEASON,
        "supported_end_season": SUPPORTED_END_SEASON,
        "universe_identity_count": int(scored["player"].nunique()),
        "total_scored_seasons": int(len(scored)),
        "top_n": TOP_N,
        "allows_repeated_players": True,
        "min_season_mpg": MIN_SERVED_SEASON_MPG,
        "excluded_low_minute_seasons": excluded_low_minute_seasons,
        "effective_tie_threshold": EFFECTIVE_TIE_THRESHOLD,
        "serving_gate_note": (
            f"Seasons under {MIN_SERVED_SEASON_MPG} minutes per game are not published on this "
            "board. They are still fully scored -- this is a display gate on sample size, not a "
            "scoring change, and it never reorders the seasons it keeps."
        ),
        "row_count": len(rows),
        "row_id_convention": "{player_slug}-1yr-{season_no_dashes}",
        "percentile_method": (
            "df.rank(pct=True) * 100 over the served rows of this board (`population_percentile` "
            "in component_detail is the same rank over all scored seasons). A percentile is a rank "
            "of already-official contributions, never a new score."
        ),
        "per_game_stats_note": _PER_GAME_NOTE,
        "explain_note": (
            "Served ONLY by GET /api/v1/seasons/{row_id}/explain, never with the table, so the "
            "rankings page does not pay for a modal most visitors never open."
        ),
        "rows": rows,
        "explain": explain,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Phase 10B: compact separators. These artifacts carry a per-row `explain`
    # block, which took the peaks file from 886 KB to 23 MB at indent=2 -- and
    # the API json.loads the whole thing into a module cache on the first
    # request, so the indentation was pure resident-memory and repo cost.
    # Nothing reads this file as text (it is parsed as JSON everywhere), and a
    # multi-megabyte JSON diff is not human-reviewable line-by-line either way,
    # so the readability that indent=2 buys here is theoretical.
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":"), sort_keys=False))

    distinct = len({r["player_slug"] for r in rows[:50]})
    print(f"Universe: {payload['universe_identity_count']} identities, {payload['total_scored_seasons']} scored seasons")
    print(
        f"Serving gate: season MPG >= {MIN_SERVED_SEASON_MPG} "
        f"({excluded_low_minute_seasons} seasons skipped while filling the board)"
    )
    print(f"Top {len(rows)} seasons written; top-50 contains {distinct} distinct players (repeats allowed by design)")
    for r in rows[:5]:
        print(f"  #{r['rank']} {r['player_name']} {r['season']} ({r['team']}) -- {r['prime_score']}")
    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)} ({OUT_PATH.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
