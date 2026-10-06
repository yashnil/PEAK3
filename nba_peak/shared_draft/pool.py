"""The SHARED DRAFT card pool: latest-season players, official cards.

WHO IS ELIGIBLE. A player with a row in the LATEST season the model has scored
(`latest_completed_season`) in the committed season-row artifact every game
mode's identities come from,
`data/game/experimental/player_pool_1500/all_seasons_for_identities.v1.json`.
Derived from the data, never a hand-kept list, so the next completed season
moves the line by itself.

WHAT THIS DOES NOT PROVE. "Played in the latest completed season" is not "on an
NBA roster today". The repository holds no current-roster source -- every
committed dataset (season rows, box scores, bios, the scored parquet) ends at
the latest completed season -- so a player who retired or went unsigned since
then is still eligible. Product copy therefore says "latest-season players",
never "current roster". Swap in a real roster source here if one is ever
committed; nothing else needs to change.

WHAT THEIR CARD IS. The player's career-best canonical 1-year PEAK3 window, read
from The $20 Showdown's pool (`twenty_dollar.pool.get_pool`, built from
`top_1000_peaks.v1.json`, 25 MPG anchor gate) -- an official, already
published value. An eligible player whose best season predates the latest one
plays on that older, completed season; nobody is ever scored on an incomplete
season. A row the artifact flags `season_in_progress` is refused outright.

READ ONCE AND CACHED: the API adapter warms this at import, so no reducer ever
does I/O.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

from nba_peak.perfect_season.career_positions import primary_position
from nba_peak.shared_draft import config as C
from nba_peak.twenty_dollar.pool import get_pool as get_showdown_pool

REPO_ROOT = Path(__file__).resolve().parents[2]
SEASONS_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "all_seasons_for_identities.v1.json"
)
TOP_PEAKS_PATH = REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "top_1000_peaks.v1.json"

#: The `score_status` values that mean "this season was scored by the model".
SCORED_STATUSES = frozenset({"exact_season_scored"})


@dataclass(frozen=True)
class PoolCard:
    player_slug: str
    player_name: str
    position: str
    peak_season: str
    team: Optional[str]
    row_id: str
    rank: int
    prime_score: float
    components: dict
    model_version: str


@dataclass(frozen=True)
class LatestSeasonPool:
    latest_season: str
    latest_season_end: int
    player_count: int
    by_position: dict  # slot -> tuple[PoolCard, ...], best first

    def depth(self, slot: str) -> tuple[PoolCard, ...]:
        return self.by_position.get(slot, ())


def _season_label(season_end: int) -> str:
    return f"{season_end - 1}-{str(season_end)[-2:]}"


@lru_cache(maxsize=1)
def _season_rows() -> tuple[dict, ...]:
    return tuple(json.loads(SEASONS_PATH.read_text())["rows"])


def latest_completed_season() -> int:
    """The newest season the model has scored any player in."""
    return max(int(r["season_end"]) for r in _season_rows() if r.get("score_status") in SCORED_STATUSES)


def latest_season_slugs() -> frozenset[str]:
    """Every identity with a row in the latest scored season. NOT a roster
    check -- see the module docstring."""
    latest = latest_completed_season()
    return frozenset(r["player_slug"] for r in _season_rows() if int(r["season_end"]) == latest)


@lru_cache(maxsize=1)
def _in_progress_row_ids() -> frozenset[str]:
    data = json.loads(TOP_PEAKS_PATH.read_text())
    rows = (data.get("windows") or {}).get("1y", {}).get("rows") or []
    return frozenset(r["row_id"] for r in rows if r.get("season_in_progress"))


@lru_cache(maxsize=1)
def get_latest_season_pool() -> LatestSeasonPool:
    latest = latest_completed_season()
    active = latest_season_slugs()
    in_progress = _in_progress_row_ids()
    by_position: dict[str, list[PoolCard]] = {slot: [] for slot in C.SLOTS}
    for candidate in get_showdown_pool().candidates:
        if candidate.player_slug not in active or candidate.row_id in in_progress:
            continue
        position = primary_position(candidate.player_slug)
        if position not in by_position:
            continue
        by_position[position].append(
            PoolCard(
                player_slug=candidate.player_slug,
                player_name=candidate.player_name,
                position=position,
                peak_season=candidate.anchor_season,
                team=candidate.team,
                row_id=candidate.row_id,
                rank=int(candidate.rank),
                prime_score=float(candidate.prime_score),
                components=dict(candidate.components),
                model_version=candidate.model_version,
            )
        )
    ordered = {
        slot: tuple(sorted(cards, key=lambda c: (-c.prime_score, c.player_slug)))
        for slot, cards in by_position.items()
    }
    for slot, cards in ordered.items():
        if len(cards) < C.CARDS_PER_POSITION + 1:
            raise RuntimeError(f"shared draft: only {len(cards)} latest-season {slot} cards")
    return LatestSeasonPool(
        latest_season=_season_label(latest),
        latest_season_end=latest,
        player_count=len(active),
        by_position=ordered,
    )


def warm_pool() -> LatestSeasonPool:
    return get_latest_season_pool()
