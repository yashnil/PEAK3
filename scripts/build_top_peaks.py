#!/usr/bin/env python3
"""Phase 6D Task D: Top-1000 individual 1Y/3Y/5Y PEAK3 peaks.

Read-only re-use of nba_peak.leaderboards.build_leaderboard/best_window,
which themselves only call peak3.n_year_windows/calibrate_score (the
official, unmodified formula -- CLAUDE.md: never calculate PEAK3 scores in
TypeScript, never change the formula). This script changes NO scoring
logic; it only runs the EXISTING window/calibration functions against a
BROADER universe than the canonical 250-pool leaderboards/*.csv use, so the
website's Peak section can show real top-1000 lists instead of being capped
at 250.

Universe: every player in cache/processed/scored_1980_2026.parquet (2,016
identities) -- not the 250-pool, and not the 1500-identity manifest (that
manifest is built from AWARD/role criteria, not peak score, so restricting
to it would risk excluding a real high-peak-score player who happens not to
clear an award-based criterion). This is a pure re-ranking of already-scored
data across a wider population, never a new score.

Phase 9C: the board now also carries the per-row EXPLAINABILITY payload.
build_leaderboard() already returns the official weighted component
contributions for every window it publishes ("SI contribution", "TP
contribution", ... / "Avg SI contribution" ... for multi-year windows) and this
script used to throw all of them away, which is why the rankings modal rendered
"Not available for this view" for the entire component breakdown. Nothing new is
computed here: the contributions are the ones peak3.nyear_window_decomposition
produced, and the only derived numbers are PERCENTILE RANKS of those real
contributions within the served board (a reproducible statistic over real data,
not a score).

Two blocks are written into one file, mirroring build_top_seasons.py:
  windows[n].rows -- lean fields for the ranked table (fast first paint)
  explain         -- the heavy per-window breakdown, keyed by row_id, for the
                     click-to-explain modal (served ONLY by
                     GET /api/v1/peaks/{row_id}/explain, never with the table)

Outputs:
  data/game/experimental/player_pool_1500/top_1000_peaks.v1.json

Usage:
    python scripts/build_top_peaks.py
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

import nba_peak.leaderboards as L  # noqa: E402
import peak3 as P  # noqa: E402
from nba_peak.season_status import in_progress_seasons  # noqa: E402

SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
OUT_DIR = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500"
OUT_PATH = OUT_DIR / "top_1000_peaks.v1.json"

DATASET_VERSION = "top_1000_peaks.v1"
TOP_N = 1000

# ---------------------------------------------------------------------------
# Phase 9B: minimum anchor-season minutes-per-game for a row to be SERVED.
#
# Root cause this closes (audited, with numbers): this script's universe is
# every identity in the scored parquet, and the ONLY minutes gate anywhere
# upstream is peak3.regular_minutes_threshold -- 1000 minutes over 82 games,
# i.e. ~12.2 MPG. The observed floor in the parquet is 12.24 MPG. That is far
# below what "PEAK Index" implies, and it showed: 269 of the 1000 served rows
# (26.9%) were sub-25-MPG seasons and 106 (10.6%) were sub-20-MPG, which is
# why perennial bench players surfaced in the rankings UI next to real
# starters (Luka Garza at rank 307 on a 16.2 MPG season; Gary Payton II at
# 194 on 17.6 MPG; a 21.5 MPG backup center out-indexing a 34 MPG All-NBA
# wing).
#
# This is a SERVING/display gate, not a scoring change. It never touches
# peak3.py, OFFICIAL_WEIGHTS, calibrate_score(), or any stored score, and it
# never reorders the rows it keeps -- it only declines to publish a
# player-season whose sample is too thin for a peak-value ranking to mean
# anything. Every excluded season is still fully scored and still reachable
# everywhere else (CourtBuilder, the canonical 250 board, the per-season
# data).
#
# Applied to the WINDOW'S ANCHOR SEASON rather than by pre-filtering rows,
# deliberately: pre-filtering would silently break the consecutive-season
# windowing that n_year_windows depends on for the 3Y/5Y boards. Post-
# filtering the finished board leaves the windowing math byte-identical and
# makes the invariant directly testable ("every served row's anchor season
# clears the gate").
#
# 25.0 is the documented FALLBACK tier of the project's own intended
# inclusion criteria (30+ MPG primary, 25+ MPG fallback), so this is the
# most permissive gate consistent with the stated design rather than a new
# editorial threshold.
# ---------------------------------------------------------------------------
MIN_SERVED_ANCHOR_MPG = 25.0
SUPPORTED_START_SEASON = "1979-80"
SUPPORTED_END_SEASON = "2025-26"
FORMULA_VERSION = (
    "peak3_official_weights_v1 (statistical_impact=0.38, traditional_production=0.21, "
    "recognition=0.20, postseason=0.18, team_achievement=0.03)"
)

# ---------------------------------------------------------------------------
# Phase 9C: the official weighted contributions, mapped from the column names
# nba_peak.leaderboards.build_leaderboard emits to the web contract's names
# (already used by data/web/leaderboards.json, the TS PeakWindowComponents
# interface, and build_top_seasons.py, so the frontend needs no third naming
# convention).
#
# build_leaderboard prefixes multi-year columns with "Avg " because a 3Y/5Y
# window's contribution is the window average -- resolved at read time by
# _contrib_columns(n) so the prefix can never silently drift out of sync.
# ---------------------------------------------------------------------------
_CONTRIB_SUFFIX: dict[str, str] = {
    "statistical_impact": "SI contribution",
    "traditional_production": "TP contribution",
    "individual_recognition": "Recognition contribution",
    "postseason_individual_value": "Postseason contribution",
    "team_achievement": "Team Achievement contribution",
}
_TEAMMATE_ADJ_SUFFIX = "Teammate adjustment"

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
# already-official contributions into the split the explain modal shows; it
# invents nothing.
_REGULAR_SEASON_COMPONENTS = ("statistical_impact", "traditional_production")

# Columns whose "observed" vs derived status decides the window's completeness
# label; same set nba_peak.leaderboards._completeness_status uses.
_FALLBACK_STATUS_COLUMNS = {
    "burden": "burden_data_status",
    "team_share": "team_share_data_status",
    "mvp_vote": "mvp_vote_data_status",
    "dpoy_vote": "dpoy_vote_data_status",
}

_MULTI_TEAM_CODES = {"2TM", "3TM", "4TM", "5TM", "TOT"}

# WHICH SEASONS ARE STILL BEING PLAYED is DERIVED, never hardcoded -- see
# nba_peak/season_status.py. This used to be `_IN_PROGRESS_SEASON = "2025-26"`,
# which went stale the moment that season concluded. A season is finished when
# the data says who won it: a champion and a Finals MVP.

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


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def _contrib_columns(n: int) -> dict[str, str]:
    pfx = "Avg " if n > 1 else ""
    return {web: f"{pfx}{suffix}" for web, suffix in _CONTRIB_SUFFIX.items()}


def _teammate_adj_column(n: int) -> str:
    return f"{'Avg ' if n > 1 else ''}{_TEAMMATE_ADJ_SUFFIX}"


def _num(row, column: str):
    """A float from the row, or None -- never NaN/Inf in the output (the web
    dataset exporter enforces the same rule)."""
    if row is None:
        return None
    if column not in row.index:
        return None
    value = row[column]
    if value is None or (isinstance(value, float) and not math.isfinite(value)):
        return None
    if pd.isna(value):
        return None
    return float(value)


def _text(row, column: str):
    if row is None or column not in row.index:
        return None
    value = row[column]
    if value is None or pd.isna(value):
        return None
    text = str(value).strip()
    return text or None


def _round(value, digits: int = 4):
    return round(value, digits) if value is not None else None


def _window_id(player_slug: str, n: int, anchor_season: str) -> str:
    """The project's existing window-id convention (scripts/build_web_dataset.py
    ::window_id, build_top_seasons.py::_season_id): `{slug}-{n}yr-{anchor}` with
    the dashes stripped from the season, e.g. michael-jordan-3yr-199091. Unique
    across the three duration boards because `n` is part of the id, and unique
    within a board because build_leaderboard publishes one window per player."""
    return f"{player_slug}-{n}yr-{anchor_season.replace('-', '')}"


def _percentile_map(values: list[float | None]) -> list[float | None]:
    """0-100 percentile rank of each value against the SERVED population of this
    board -- `df.rank(pct=True) * 100`, the same method
    nba_peak.perfect_season.exact_season.component_percentile uses.

    Ranked within the served board rather than the full scored population on
    purpose: every row here is already a top-1000 peak, so a full-population
    percentile saturates near 100 for the volume components and tells the reader
    nothing. Within-board is the scale that actually separates these rows."""
    series = pd.Series([v for v in values], dtype="float64")
    ranked = series.rank(pct=True) * 100.0
    return [
        round(float(value), 1) if pd.notna(value) else None
        for value in ranked
    ]


def _comparison_rails(
    rows: list[dict],
    *,
    peer_key: str,
    cross_board_rows: list[dict] | None = None,
) -> dict[str, dict]:
    """Deterministic comparison rails, keyed by row_id.

    same_player     -- other served rows for the same player, nearest by
                       |prime_score delta|, capped, then sorted by prime_score
                       desc. On the peaks boards a player holds at most ONE row
                       per duration (build_leaderboard is best-window-per-
                       player), so the population here is the whole artifact
                       across 1Y/3Y/5Y -- that is what makes "Kobe's best single
                       season vs his best three-year run" explorable at all.
    similar_scores  -- nearest rows by |prime_index delta| excluding the same
                       player, capped, tie-broken by rank asc so the output is
                       byte-stable across runs. Scoped to the SAME duration: a
                       1Y score and a 5Y score are not the same quantity.
    same_season_peers -- rows sharing the season (single seasons) or the anchor
                       season (windows), nearest by score, excluding self.

    Every entry carries a row_id so the modal can pivot to it.
    """
    by_player: dict[str, list[dict]] = {}
    for row in (cross_board_rows if cross_board_rows is not None else rows):
        by_player.setdefault(row["player_slug"], []).append(row)

    by_peer: dict[str, list[dict]] = {}
    for row in rows:
        by_peer.setdefault(str(row.get(peer_key)), []).append(row)

    out: dict[str, dict] = {}
    for row in rows:
        row_id = row["row_id"]
        score = row["prime_score"] or 0.0
        index = row["prime_index"] or 0.0

        same_player = [o for o in by_player.get(row["player_slug"], []) if o["row_id"] != row_id]
        same_player.sort(key=lambda o: (abs((o["prime_score"] or 0.0) - score), o["rank"]))
        same_player = sorted(
            same_player[:_MAX_SAME_PLAYER],
            key=lambda o: -(o["prime_score"] or 0.0),
        )

        similar = [
            o for o in rows
            if o["player_slug"] != row["player_slug"]
        ]
        similar.sort(key=lambda o: (abs((o["prime_index"] or 0.0) - index), o["rank"]))
        similar = similar[:_MAX_SIMILAR_SCORES]

        peers = [o for o in by_peer.get(str(row.get(peer_key)), []) if o["row_id"] != row_id]
        peers.sort(key=lambda o: (abs((o["prime_score"] or 0.0) - score), o["rank"]))
        peers = peers[:_MAX_SEASON_PEERS]

        out[row_id] = {
            "same_player": [
                {
                    "row_id": o["row_id"],
                    "label": o["label"],
                    "prime_score": o["prime_score"],
                    "rank": o["rank"],
                    "delta": _round((o["prime_score"] or 0.0) - score, 2),
                    "window": o.get("window"),
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
                    "delta": _round((o["prime_score"] or 0.0) - score, 2),
                    # The rail's actual sort key, published so the ordering is
                    # auditable rather than something a reader has to trust.
                    # `delta` is the calibrated-score gap the UI displays; the
                    # ordering is by the RAW index, which is what the board is
                    # ranked on, and the two are monotone but not identical.
                    "index_delta": _round((o["prime_index"] or 0.0) - index, 2),
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
        print(f"ERROR: {SCORED_PATH} missing -- broken checkout.")
        return 1

    scored = pd.read_parquet(SCORED_PATH)
    # Derived once and threaded through, so every row in one artifact agrees
    # about which seasons are finished.
    unfinished = in_progress_seasons(scored)
    print(f"seasons still in progress (derived): {sorted(unfinished) or 'none'}")
    universe = pd.DataFrame({"player": sorted(scored["player"].unique())})
    universe["canonical_player_id"] = universe["player"].map(_slug)

    print(f"Universe: {len(universe)} identities (full scored_1980_2026.parquet population)")
    print(f"Serving gate: anchor-season MPG >= {MIN_SERVED_ANCHOR_MPG} (see MIN_SERVED_ANCHOR_MPG)")

    payload = {
        "dataset_version": DATASET_VERSION,
        "generation_command": "python scripts/build_top_peaks.py",
        "source_provenance": {
            "scored": str(SCORED_PATH.relative_to(REPO_ROOT)),
            "windowing": "nba_peak.leaderboards.build_leaderboard -> peak3.n_year_windows/calibrate_score (unmodified official formula)",
        },
        "formula_version": FORMULA_VERSION,
        "official_weights": P.OFFICIAL_WEIGHTS,
        "supported_start_season": SUPPORTED_START_SEASON,
        "supported_end_season": SUPPORTED_END_SEASON,
        "universe_identity_count": len(universe),
        "top_n": TOP_N,
        "windows": {},
    }

    # Anchor-season parquet row lookup, built once; keyed by (player, season),
    # which is unique in the scored parquet (asserted below). Used both for the
    # serving gate's MPG and for the explain payload's real context columns --
    # the previous per-row boolean-mask filter was O(rows x parquet).
    anchor_rows: dict[tuple[str, str], pd.Series] = {}
    for _, srow in scored.iterrows():
        anchor_rows[(str(srow["player"]), str(srow["season"]))] = srow
    if len(anchor_rows) != len(scored):
        print("ERROR: (player, season) is not unique in the scored parquet.")
        return 1

    mpg_by_player_season: dict[tuple[str, str], float] = {
        key: float(row["mpg"])
        for key, row in anchor_rows.items()
        if "mpg" in row.index and pd.notna(row["mpg"])
    }

    # Collected across all three durations so the explain payload's same_player
    # rail can cross durations (see _comparison_rails).
    rows_by_window: dict[int, list[dict]] = {}
    material_by_row_id: dict[str, dict] = {}
    all_rows: list[dict] = []

    for n in (1, 3, 5):
        contrib_columns = _contrib_columns(n)
        teammate_column = _teammate_adj_column(n)

        # Build UNCAPPED (the universe is ~2,016 identities, so this is
        # bounded), then apply the serving gate, THEN take the top N and
        # re-number. Capping first would let filtered-out rows consume slots
        # and silently shrink the published board below TOP_N.
        board = L.build_leaderboard(scored, universe, n, top=len(universe) + 1)
        missing_columns = [c for c in contrib_columns.values() if c not in board.columns]
        if missing_columns:
            print(f"ERROR: build_leaderboard({n}) did not return {missing_columns}")
            return 1

        served: list[tuple] = []
        excluded_low_minutes = 0
        for _, r in board.iterrows():
            player = r["Player"]
            anchor_season = r["Anchor season"] if "Anchor season" in r else r.get("Best season")

            # Phase 9B serving gate -- see MIN_SERVED_ANCHOR_MPG. A season with
            # no mpg value at all is NOT admitted by default: an unknown sample
            # is exactly the case this gate exists to exclude.
            anchor_mpg = mpg_by_player_season.get((str(player), str(anchor_season)))
            if anchor_mpg is None or anchor_mpg < MIN_SERVED_ANCHOR_MPG:
                excluded_low_minutes += 1
                continue
            served.append((r, player, str(anchor_season), anchor_mpg))
            if len(served) >= TOP_N:
                break

        # Percentiles are ranked against THIS window's served population, so
        # they have to be computed after the gate has decided the population.
        percentile_columns: dict[str, list] = {
            web: _percentile_map([
                (float(r[column]) if pd.notna(r[column]) else None) for r, *_ in served
            ])
            for web, column in contrib_columns.items()
        }
        percentile_columns["total"] = _percentile_map([
            (float(r["Prime raw"]) if pd.notna(r["Prime raw"]) else None) for r, *_ in served
        ])

        rows: list[dict] = []
        for i, (r, player, anchor_season, anchor_mpg) in enumerate(served):
            slug = _slug(player)
            window_label = r["Best season"] if n == 1 else r["Best window"]
            anchor = anchor_rows.get((str(player), anchor_season))
            team = _text(anchor, "team")

            if n == 1:
                seasons_in_window = [anchor_season]
                label = anchor_season
            else:
                seasons_in_window = [
                    s.strip() for s in str(r.get("Seasons included", "")).split(",") if s.strip()
                ] or [anchor_season]
                label = f"{seasons_in_window[0]} to {seasons_in_window[-1]}"

            components = {
                web: _round(float(r[column]) if pd.notna(r[column]) else None)
                for web, column in contrib_columns.items()
            }
            percentiles = {web: percentile_columns[web][i] for web in contrib_columns}
            percentiles["total"] = percentile_columns["total"][i]

            row = {
                # Re-numbered AFTER filtering so the served list is a dense
                # 1..N with no gaps where an excluded row used to sit.
                "rank": i + 1,
                "row_id": _window_id(slug, n, anchor_season),
                "player_slug": slug,
                "player_name": player,
                # Shared with the Single Seasons board: `label` is the human
                # span ("1988-89 to 1990-91"), `window_label` is the generator's
                # original compact form, kept because existing clients read it.
                "label": label,
                "window": f"{n}y",
                "window_label": window_label,
                "anchor_season": anchor_season,
                "team": team,
                "anchor_season_mpg": round(anchor_mpg, 1),
                "mpg": round(anchor_mpg, 1),
                "prime_score": float(r["Prime display"]),
                "prime_index": _round(float(r["Prime raw"]), 2),
                "components": components,
                "percentiles": percentiles,
                "data_completeness": r["Data completeness status"],
                "season_in_progress": anchor_season in unfinished,
            }
            rows.append(row)
            all_rows.append(row)
            material_by_row_id[row["row_id"]] = {
                "n": n,
                "board_row": r,
                "anchor": anchor,
                "seasons_in_window": seasons_in_window,
                "teammate_adjustment": (
                    _round(float(r[teammate_column]))
                    if teammate_column in r.index and pd.notna(r[teammate_column]) else None
                ),
            }

        rows_by_window[n] = rows
        payload["windows"][f"{n}y"] = {
            "duration_years": n,
            "row_count": len(rows),
            "min_anchor_season_mpg": MIN_SERVED_ANCHOR_MPG,
            "excluded_low_minute_windows": excluded_low_minutes,
            "rows": rows,
        }
        print(
            f"  {n}y: {len(rows)} rows served, {excluded_low_minutes} windows excluded by the "
            f"{MIN_SERVED_ANCHOR_MPG} MPG gate (top score={rows[0]['prime_score'] if rows else None})"
        )

    # ---------------------------------------------------------------- explain --
    # One flat dict keyed by row_id across all three durations: row_ids embed
    # `n` ({slug}-3yr-...), so they never collide, and one dict means one
    # explain route rather than three.
    explain: dict[str, dict] = {}
    for n, rows in rows_by_window.items():
        rails = _comparison_rails(rows, peer_key="anchor_season", cross_board_rows=all_rows)
        for row in rows:
            row_id = row["row_id"]
            material = material_by_row_id[row_id]
            anchor = material["anchor"]
            components = row["components"]
            percentiles = row["percentiles"]

            component_block = [
                {
                    "component": web,
                    "contribution": components[web],
                    "weight": P.OFFICIAL_WEIGHTS[_OFFICIAL_WEIGHT_KEYS[web]],
                    "percentile": percentiles[web],
                }
                for web in _CONTRIB_SUFFIX
            ]

            # Strongest/weakest BY PERCENTILE, never by raw contribution:
            # team_achievement is capped at a 3% weight, so it is almost always
            # the numerically smallest contribution and would otherwise be
            # named "the weakness" for literally every row on the board.
            ranked_components = [c for c in component_block if c["percentile"] is not None]
            ranked_components.sort(key=lambda c: (-c["percentile"], c["component"]))

            regular_season_total = sum(
                components.get(k) or 0.0 for k in _REGULAR_SEASON_COMPONENTS
            )
            postseason_total = components.get("postseason_individual_value") or 0.0
            recognition_total = components.get("individual_recognition") or 0.0
            team_total = components.get("team_achievement") or 0.0

            statuses = {
                key: _text(anchor, column) for key, column in _FALLBACK_STATUS_COLUMNS.items()
            }
            team = row["team"]
            is_multi_team = team in _MULTI_TEAM_CODES if team else False
            in_progress = row["season_in_progress"]

            caveats = [
                caveat for caveat in (
                    (
                        "Context below (box score, awards, postseason, team, role) is the ANCHOR "
                        f"season {row['anchor_season']} only -- it is not a {n}-season average. "
                        "The component contributions and the score ARE the window's."
                    ) if n > 1 else None,
                    (
                        "This season is still in progress in the committed dataset -- it is ranked "
                        "against completed seasons."
                    ) if in_progress else None,
                    (
                        "PEAK3 scores one row per player-season, so this traded season is a "
                        "combined multi-team total, not a single-team split."
                    ) if is_multi_team else None,
                    (
                        "Availability flag: this player did not reach ~92% of the team's games in "
                        "the anchor season, which is a durability signal, not missing data."
                    ) if _num(anchor, "season_complete") == 0 else None,
                    (
                        "One or more inputs for this window are model-derived rather than directly "
                        "observed (data completeness 'complete*')."
                    ) if str(row["data_completeness"]).endswith("*") else None,
                ) if caveat
            ]

            season_mpg = _num(anchor, "mpg")
            explain[row_id] = {
                "row_id": row_id,
                "window": f"{n}y",
                "window_type": f"{n}Y",
                "duration_years": n,
                "rank": row["rank"],
                "player_slug": row["player_slug"],
                "player_name": row["player_name"],
                "label": row["label"],
                "window_label": row["window_label"],
                "anchor_season": row["anchor_season"],
                "seasons_in_window": material["seasons_in_window"],
                "team": team,
                "is_multi_team_season": is_multi_team,
                "prime_score": row["prime_score"],
                "prime_index": row["prime_index"],
                "season_in_progress": row["season_in_progress"],
                "mpg": row["mpg"],
                "anchor_season_mpg": row["anchor_season_mpg"],
                "min_anchor_season_mpg": MIN_SERVED_ANCHOR_MPG,
                # `components` is the SAME flat {key: weighted contribution}
                # dict the table row carries -- the shared rankings contract, so
                # one normalizer reads a row and an explain block identically.
                # `component_detail` is the same five numbers paired with their
                # official weight and percentile for the bar chart.
                "components": components,
                "component_detail": component_block,
                "percentiles": percentiles,
                "percentile_population": f"served {n}Y board ({len(rows)} rows)",
                "weights": {
                    web: P.OFFICIAL_WEIGHTS[key] for web, key in _OFFICIAL_WEIGHT_KEYS.items()
                },
                "teammate_adjustment": material["teammate_adjustment"],
                # Sums of the SAME official contributions listed above, grouped
                # so a reader can see the regular-season half against the
                # postseason / recognition / team-context half that decides the
                # close calls.
                "score_split": {
                    "regular_season": _round(regular_season_total),
                    "regular_season_components": list(_REGULAR_SEASON_COMPONENTS),
                    "postseason": _round(postseason_total),
                    "recognition": _round(recognition_total),
                    # Both names on purpose: `team` is the shared rankings
                    # contract, `team_achievement` matches the component key.
                    "team": _round(team_total),
                    "team_achievement": _round(team_total),
                    "non_regular_season": _round(
                        postseason_total + recognition_total + team_total
                    ),
                },
                "strongest_components": [c["component"] for c in ranked_components[:2]],
                "weakest_components": [c["component"] for c in ranked_components[-2:]][::-1],
                # Real anchor-season columns only -- never invented. See
                # _PER_GAME_NOTE for why ppg/rpg/apg are null.
                "season_stats": ({
                    "season": row["anchor_season"],
                    "is_anchor_season_only": n > 1,
                    "games": _num(anchor, "g"),
                    "minutes_total": _num(anchor, "mp"),
                    "mpg": round(season_mpg, 1) if season_mpg is not None else None,
                    "ppg": None,
                    "rpg": None,
                    "apg": None,
                    "pts_per_75": _num(anchor, "pts_per75"),
                    "ast_per_75": _num(anchor, "ast_per75"),
                    "pts_per_100": _num(anchor, "pts_per100"),
                    "trb_per_100": _num(anchor, "trb_per100"),
                    "ast_per_100": _num(anchor, "ast_per100"),
                    "ts_pct": _num(anchor, "ts_pct"),
                    "ts_plus": _num(anchor, "ts_plus"),
                    "usg_pct": _num(anchor, "usg_pct"),
                    "per": _num(anchor, "per"),
                    "bpm": _num(anchor, "bpm"),
                    "obpm": _num(anchor, "obpm"),
                    "dbpm": _num(anchor, "dbpm"),
                    "vorp": _num(anchor, "vorp"),
                    "ws": _num(anchor, "total_ws"),
                    "ws_per_48": _num(anchor, "ws_per_48"),
                } if anchor is not None else None),
                "recognition": ({
                    "season": row["anchor_season"],
                    "awards": _text(anchor, "awards"),
                    "mvp_vote_share": _num(anchor, "mvp_vote_share"),
                    "dpoy_vote_share": _num(anchor, "dpoy_vote_share"),
                } if anchor is not None else None),
                "postseason": ({
                    "season": row["anchor_season"],
                    "games": _num(anchor, "po_g"),
                    "minutes": _num(anchor, "po_mp"),
                    "series_count": _num(anchor, "po_series_n"),
                    "availability": _text(anchor, "postseason_availability"),
                } if anchor is not None else None),
                "team_context": ({
                    "season": row["anchor_season"],
                    "championship": _num(anchor, "championship"),
                    "finals_appearance": _num(anchor, "finals_appearance"),
                    "made_playoffs": _num(anchor, "made_playoffs"),
                    "n_teams": _num(anchor, "n_teams"),
                } if anchor is not None else None),
                "role_and_sample": ({
                    "season": row["anchor_season"],
                    "games_played": _num(anchor, "g"),
                    "minutes_total": _num(anchor, "mp"),
                    "minutes_per_game": round(season_mpg, 1) if season_mpg is not None else None,
                    "role": _text(anchor, "role"),
                    "season_complete": _num(anchor, "season_complete"),
                    "season_progress_pct": _num(anchor, "season_progress_pct"),
                } if anchor is not None else None),
                "comparisons": rails[row_id],
                "caveats": caveats,
                # The window-level label build_leaderboard published, kept as a
                # plain string per the shared rankings contract; the per-input
                # statuses that produced it are alongside it.
                "data_completeness": row["data_completeness"],
                "data_completeness_detail": statuses,
            }

    payload["row_id_convention"] = "{player_slug}-{n}yr-{anchor_season_no_dashes}"
    payload["min_anchor_season_mpg"] = MIN_SERVED_ANCHOR_MPG
    payload["serving_gate_note"] = (
        f"Windows whose anchor season is under {MIN_SERVED_ANCHOR_MPG} minutes per game are not "
        "published on this board. They are still fully scored -- this is a display gate on sample "
        "size, not a scoring change, and it never reorders the windows it keeps."
    )
    payload["percentile_method"] = (
        "df.rank(pct=True) * 100 over the served rows of the same duration board. A percentile is "
        "a rank of already-official contributions, never a new score."
    )
    payload["per_game_stats_note"] = _PER_GAME_NOTE
    payload["explain_note"] = (
        "Served ONLY by GET /api/v1/peaks/{row_id}/explain, never with the table, so the rankings "
        "page does not pay for a modal most visitors never open."
    )
    payload["explain"] = explain

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Phase 10B: compact separators. These artifacts carry a per-row `explain`
    # block, which took the peaks file from 886 KB to 23 MB at indent=2 -- and
    # the API json.loads the whole thing into a module cache on the first
    # request, so the indentation was pure resident-memory and repo cost.
    # Nothing reads this file as text (it is parsed as JSON everywhere), and a
    # multi-megabyte JSON diff is not human-reviewable line-by-line either way,
    # so the readability that indent=2 buys here is theoretical.
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":"), sort_keys=False))
    size = OUT_PATH.stat().st_size
    print(f"\nExplain blocks: {len(explain)} (keyed by row_id, across 1Y/3Y/5Y)")
    print(f"Wrote {OUT_PATH.relative_to(REPO_ROOT)} ({size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
