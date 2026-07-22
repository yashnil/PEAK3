"""Deterministic spin/board generator for 82-0 Peak Season / CourtBuilder.

A board contains TOTAL_ROUNDS (8) spin prompts, each resolving to a small
list of candidate player_slugs. Every board is fully reproducible from its
seed, mirroring nba_peak.lineup.board.generate_board's contract for Peak
Draft (ADR-001's "board snapshot, not live regeneration" principle).

Team+decade/exact-team-season spins (COURTBUILDER_TEAM_SPIN_ENABLED=True)
draw from the small, explicitly interim dataset in
data/game/interim/courtbuilder_team_seasons.v0.json -- see that file's own
`coverage_note` and docs/architecture/PHASE_5_DATA_MODEL.md Sec 0 for why this
is not the real team-season schema. When team spins are disabled, an
"open_pool" fallback spin type draws from a shuffled, duration-filtered
subset of the full existing card pool instead.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from nba_peak.lineup.board import _load_profiles
from nba_peak.lineup.config import CARD_PROFILE_VERSION
from nba_peak.lineup.schemas import CardProfile
from nba_peak.perfect_season.config import (
    BOARD_GENERATOR_VERSION,
    ELIGIBILITY_RULESET_VERSION,
    FALLBACK_CANDIDATES_PER_ROUND,
    INTERIM_TEAM_DATA_VERSION,
    MODE_TO_YEARS,
    SUPPORTED_MODES,
    TOTAL_ROUNDS,
)
from nba_peak.perfect_season.schemas import PerfectSeasonBoard, SpinPrompt

MAX_BOARD_ATTEMPTS = 50

_INTERIM_TEAMS_CACHE: dict | None = None


def _default_interim_teams_path() -> Path:
    repo_root = Path(__file__).resolve().parent.parent.parent
    return repo_root / "data" / "game" / "interim" / "courtbuilder_team_seasons.v0.json"


def _load_interim_teams(path: Path | None = None) -> dict:
    """Load (and cache) the interim team-season dataset.

    Raises FileNotFoundError with a clear message if missing -- this dataset
    is committed, not generated, so a missing file means a broken checkout,
    not a build step that needs to run.
    """
    global _INTERIM_TEAMS_CACHE
    if path is None and _INTERIM_TEAMS_CACHE is not None:
        return _INTERIM_TEAMS_CACHE

    load_path = path or _default_interim_teams_path()
    if not load_path.exists():
        raise FileNotFoundError(
            f"Interim CourtBuilder team dataset not found at {load_path}. "
            "This file is committed; a missing file indicates a broken checkout."
        )
    with load_path.open() as f:
        data = json.load(f)

    if path is None:
        _INTERIM_TEAMS_CACHE = data
    return data


def _clear_interim_teams_cache() -> None:
    """Clear the cached interim dataset (used in tests)."""
    global _INTERIM_TEAMS_CACHE
    _INTERIM_TEAMS_CACHE = None


def interim_team_summary(path: Path | None = None) -> dict:
    """Public summary of the interim dataset, for the readiness endpoint.

    Returns {"available": False} rather than raising if the file is
    missing -- readiness is a safe diagnostic, never a 500.
    """
    try:
        data = _load_interim_teams(path)
    except FileNotFoundError:
        return {"available": False, "franchise_count": 0, "dataset_version": None}
    franchises = {e["franchise_display_name"] for e in data.get("team_decade_spins", [])}
    return {
        "available": True,
        "franchise_count": len(franchises),
        "dataset_version": data.get("dataset_version"),
    }


def _all_interim_spin_entries(data: dict) -> list[dict]:
    """Flatten team_decade_spins + exact_team_season_spins into one list,
    each entry tagged with its spin_type."""
    entries: list[dict] = []
    for e in data.get("team_decade_spins", []):
        entries.append({**e, "spin_type": "team_decade", "era_label": e.get("decade_label")})
    for e in data.get("exact_team_season_spins", []):
        entries.append({**e, "spin_type": "exact_team_season", "era_label": e.get("season_label")})
    return entries


def _candidates_for_entry(entry: dict, duration_pool: list[CardProfile]) -> list[str]:
    """Intersect an interim spin entry's player_slugs with the duration's
    resolvable card pool. A player_slug with no card at this duration is
    silently dropped -- this can legitimately shrink a round's candidate
    list to fewer than the entry's full player_slugs list.
    """
    pool_slugs = {c.player_slug for c in duration_pool}
    return [slug for slug in entry.get("player_slugs", []) if slug in pool_slugs]


def _can_assign_distinct(round_candidates: list[list[str]]) -> bool:
    """Backtracking feasibility check: does some assignment of one distinct
    player_slug per round exist? Mirrors nba_peak.lineup.board's
    _can_fill_all_roles feasibility check, adapted for "no repeated identity
    across rounds" (master plan Sec 5.1) instead of "all 5 roles filled".
    """
    n = len(round_candidates)

    def search(idx: int, used: frozenset[str]) -> bool:
        if idx == n:
            return True
        for slug in round_candidates[idx]:
            if slug not in used:
                if search(idx + 1, used | {slug}):
                    return True
        return False

    return search(0, frozenset())


def _make_board_id(mode: str, board_type: str, seed: int) -> str:
    return f"{board_type}-{mode}-perfect_season-{seed}"


def generate_board(
    mode: str,
    seed: int,
    board_type: str = "practice",
    team_spin_enabled: bool = True,
    profiles_path: Path | None = None,
    interim_teams_path: Path | None = None,
) -> PerfectSeasonBoard:
    """Generate a deterministic CourtBuilder board.

    Raises:
        ValueError: Invalid mode.
        RuntimeError: Could not find a feasible (all-distinct-assignable)
            board after MAX_BOARD_ATTEMPTS -- should not happen with the
            committed interim dataset and card pool, but is a real,
            surfaced error rather than a silent degraded board if it does.
    """
    if mode not in SUPPORTED_MODES:
        raise ValueError(f"Unsupported mode '{mode}'. Use one of {SUPPORTED_MODES}")

    duration = MODE_TO_YEARS[mode]
    by_dur = _load_profiles(profiles_path)
    duration_pool = by_dur.get(duration, [])
    if not duration_pool:
        raise RuntimeError(f"No card pool available for duration {duration}yr")

    interim_data = _load_interim_teams(interim_teams_path) if team_spin_enabled else None
    interim_entries = _all_interim_spin_entries(interim_data) if interim_data else []

    for attempt in range(MAX_BOARD_ATTEMPTS):
        rng = random.Random(seed + attempt * 997)

        spins: list[SpinPrompt] = []
        round_candidates: list[list[str]] = []

        if team_spin_enabled and len(interim_entries) >= 1:
            shuffled_entries = interim_entries.copy()
            rng.shuffle(shuffled_entries)
            # Use as many distinct interim spins as available, up to
            # TOTAL_ROUNDS; fall back to open_pool for any remaining rounds
            # if the interim dataset has fewer than TOTAL_ROUNDS entries.
            chosen = shuffled_entries[:TOTAL_ROUNDS]
            for i, entry in enumerate(chosen, start=1):
                candidates = _candidates_for_entry(entry, duration_pool)
                spins.append(SpinPrompt(
                    round_number=i,
                    spin_type=entry["spin_type"],
                    spin_id=entry["spin_id"],
                    franchise_display_name=entry.get("franchise_display_name"),
                    era_label=entry.get("era_label"),
                    candidate_player_slugs=candidates,
                ))
                round_candidates.append(candidates)

        remaining_rounds = TOTAL_ROUNDS - len(spins)
        if remaining_rounds > 0:
            shuffled_pool = duration_pool.copy()
            rng.shuffle(shuffled_pool)
            pool_slugs = [c.player_slug for c in shuffled_pool]
            chunk_size = FALLBACK_CANDIDATES_PER_ROUND
            for j in range(remaining_rounds):
                round_num = len(spins) + 1
                start = (j * chunk_size) % max(len(pool_slugs), 1)
                chunk = pool_slugs[start:start + chunk_size]
                if len(chunk) < chunk_size:
                    chunk += pool_slugs[: chunk_size - len(chunk)]
                spins.append(SpinPrompt(
                    round_number=round_num,
                    spin_type="open_pool",
                    spin_id=None,
                    franchise_display_name=None,
                    era_label=None,
                    candidate_player_slugs=chunk,
                ))
                round_candidates.append(chunk)

        # Every round must have at least one candidate at all.
        if any(len(c) == 0 for c in round_candidates):
            continue

        if not _can_assign_distinct(round_candidates):
            continue

        board_id = _make_board_id(mode, board_type, seed)
        return PerfectSeasonBoard(
            board_id=board_id,
            mode=mode,
            duration_years=duration,
            board_type=board_type,
            seed=seed,
            spins=spins,
            card_pool_version=CARD_PROFILE_VERSION,
            eligibility_ruleset_version=ELIGIBILITY_RULESET_VERSION,
            board_generator_version=BOARD_GENERATOR_VERSION,
            interim_team_data_version=INTERIM_TEAM_DATA_VERSION if team_spin_enabled else None,
            metadata={
                "attempts": attempt + 1,
                "team_spin_enabled": team_spin_enabled,
                "duration_years": duration,
                "card_pool_size": len(duration_pool),
            },
        )

    raise RuntimeError(
        f"Could not generate a feasible CourtBuilder board after "
        f"{MAX_BOARD_ATTEMPTS} attempts (mode={mode}, seed={seed})"
    )


def resolve_card(player_slug: str, duration_years: int, profiles_path: Path | None = None) -> CardProfile | None:
    """Resolve a player_slug's existing best-available peak_card at the given
    duration. Does NOT attempt team-specific score attribution -- the
    current card pool has no team dimension (PHASE_5_DATA_MODEL.md Sec 0);
    this returns the player's one existing card at this duration, whichever
    team-decade/exact-team-season spin surfaced them.
    """
    by_dur = _load_profiles(profiles_path)
    for card in by_dur.get(duration_years, []):
        if card.player_slug == player_slug:
            return card
    return None


def find_spin(board: PerfectSeasonBoard, round_number: int) -> SpinPrompt | None:
    for s in board.spins:
        if s.round_number == round_number:
            return s
    return None
