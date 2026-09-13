"""Runtime reader for `career_windows.v1.json`.

PURE JSON. No pandas, no `peak3`: the API warms this at import (a reducer runs
inside a row lock and must never pay for a file read), and the model stack is
not something a request path should import.

The artifact is IMMUTABLE BY VERSION. A model change produces
`career_windows.v2.json` beside this one; a match pins the version it was
dealt from in its snapshot, so a historical match never re-reads a number that
moved.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_VERSION = "career_windows.v1"
ARTIFACT_PATH = REPO_ROOT / "data" / "game" / "prime_modes" / f"{ARTIFACT_VERSION}.json"

#: The durations both modes play. 1Y is a single season (not a stretch) and 4Y
#: is not a canonical PEAK3 board, so neither is offered.
DURATIONS: tuple[int, ...] = (2, 3, 5)

#: How a multi-team season is labelled in the canonical data, and what a screen
#: should say instead. The scored table has no per-team split for these rows.
MULTI_TEAM_LABELS = frozenset({"2TM", "3TM", "4TM", "TOT"})


@dataclass(frozen=True)
class CareerSeason:
    season: str
    season_end: int
    team: str

    @property
    def multi_team(self) -> bool:
        return self.team in MULTI_TEAM_LABELS


@dataclass(frozen=True)
class CareerWindow:
    """One contiguous N-season window of one career, canonically scored."""

    window_id: str
    player_slug: str
    duration: int
    start_season: str
    end_season: str
    start_season_end: int
    end_season_end: int
    #: Calibrated 0-100 display score (the leaderboard's `Prime display`).
    prime_score: float
    #: Raw rank-weighted window score before calibration (`Prime raw`).
    prime_index: float
    completeness: str
    is_best: bool


@dataclass(frozen=True)
class PlayerCareer:
    player_slug: str
    player_name: str
    #: False when the player's career began before the scored data does, so a
    #: real prime may lie outside every window we can evaluate.
    career_fully_covered: bool
    career_year_min: int
    seasons: tuple[CareerSeason, ...]
    windows: dict[int, tuple[CareerWindow, ...]]
    #: duration -> canonical top-250 rank of this player's best window.
    canonical_rank: dict[int, int]
    #: duration -> the data/web window id of the canonical best window.
    canonical_window_id: dict[int, str]

    def best(self, duration: int) -> Optional[CareerWindow]:
        for window in self.windows.get(duration, ()):
            if window.is_best:
                return window
        return None

    def window(self, duration: int, window_id: str) -> Optional[CareerWindow]:
        for window in self.windows.get(duration, ()):
            if window.window_id == window_id:
                return window
        return None


@dataclass(frozen=True)
class CareerWindowArtifact:
    version: str
    model_version: str
    formula_version_id: str
    metadata: dict
    players: dict[str, PlayerCareer]

    def player(self, slug: str) -> PlayerCareer:
        return self.players[slug]


def _parse(payload: dict) -> CareerWindowArtifact:
    players: dict[str, PlayerCareer] = {}
    for row in payload["players"]:
        slug = row["player_slug"]
        windows: dict[int, tuple[CareerWindow, ...]] = {}
        for key, items in row["windows"].items():
            n = int(key)
            windows[n] = tuple(
                CareerWindow(
                    window_id=w["window_id"],
                    player_slug=slug,
                    duration=n,
                    start_season=w["start_season"],
                    end_season=w["end_season"],
                    start_season_end=int(w["start_season_end"]),
                    end_season_end=int(w["end_season_end"]),
                    prime_score=float(w["prime_score"]),
                    prime_index=float(w["prime_index"]),
                    completeness=w["completeness"],
                    is_best=bool(w["is_best"]),
                )
                for w in items
            )
        players[slug] = PlayerCareer(
            player_slug=slug,
            player_name=row["player_name"],
            career_fully_covered=bool(row["career_fully_covered"]),
            career_year_min=int(row["career_year_min"]),
            seasons=tuple(
                CareerSeason(season=s["season"], season_end=int(s["season_end"]), team=s["team"])
                for s in row["seasons"]
            ),
            windows=windows,
            canonical_rank={int(k): int(v) for k, v in row["canonical_rank"].items()},
            canonical_window_id={int(k): v for k, v in row["canonical_window_id"].items()},
        )
    meta = payload["metadata"]
    return CareerWindowArtifact(
        version=meta["artifact_version"],
        model_version=meta["model_version"],
        formula_version_id=meta["formula_version_id"],
        metadata=meta,
        players=players,
    )


@lru_cache(maxsize=4)
def load_artifact(path: Optional[str] = None) -> CareerWindowArtifact:
    """The committed artifact, parsed once per process."""
    target = Path(path) if path else ARTIFACT_PATH
    if not target.exists():
        raise FileNotFoundError(
            f"{target} missing -- broken checkout (this file is committed; "
            "regenerate with scripts/build_prime_windows.py)."
        )
    with target.open("r", encoding="utf-8") as handle:
        return _parse(json.load(handle))


def team_label(team: str) -> str:
    """What a season's team reads as on screen. Never an invented split."""
    return "Multiple teams" if team in MULTI_TEAM_LABELS else team
