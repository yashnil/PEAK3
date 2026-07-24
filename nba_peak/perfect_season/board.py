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
    EXPERIMENTAL_FORMULA_VERSION,
    EXPERIMENTAL_TEAM_YEAR_COVERAGE_MODE,
    EXPERIMENTAL_TEAM_YEAR_DATA_VERSION,
    FALLBACK_CANDIDATES_PER_ROUND,
    INTERIM_TEAM_DATA_VERSION,
    MODE_TO_YEARS,
    PREFERRED_MIN_CANDIDATES,
    SUPPORTED_MODES,
    TOTAL_ROUNDS,
)
from nba_peak.perfect_season.schemas import PerfectSeasonBoard, SpinPrompt

MAX_BOARD_ATTEMPTS = 50

_INTERIM_TEAMS_CACHE: dict | None = None
_EXPERIMENTAL_TEAM_YEAR_CACHE: dict | None = None
_EXPERIMENTAL_CARDS_CACHE: list[CardProfile] | None = None


def _default_interim_teams_path() -> Path:
    repo_root = Path(__file__).resolve().parent.parent.parent
    return repo_root / "data" / "game" / "interim" / "courtbuilder_team_seasons.v3.json"


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
    missing -- readiness is a safe diagnostic, never a 500. `franchise_names`
    is the actual resolvable team-wheel pool -- the frontend spin ceremony
    cycles through exactly this list (never a broader, partly-fake list of
    franchises that could never actually be landed on).
    """
    try:
        data = _load_interim_teams(path)
    except FileNotFoundError:
        return {"available": False, "franchise_count": 0, "dataset_version": None, "franchise_names": []}
    # Union across both spin types -- a franchise that only appears in
    # exact_team_season_spins (not team_decade_spins) must still be counted.
    franchises = {e["franchise_display_name"] for e in data.get("team_decade_spins", [])}
    franchises |= {e["franchise_display_name"] for e in data.get("exact_team_season_spins", [])}
    return {
        "available": True,
        "franchise_count": len(franchises),
        "dataset_version": data.get("dataset_version"),
        "franchise_names": sorted(franchises),
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


def coverage_summary(mode: str, profiles_path: Path | None = None, interim_teams_path: Path | None = None) -> dict:
    """Per-mode (duration-aware) coverage audit of the interim dataset.

    Candidate depth is duration-dependent -- the same team-decade entry can
    be "good" at one duration and "sparse" or entirely unplayable at
    another (a player's card may only exist for some durations). This makes
    coverage gaps visible and auditable rather than something only
    discoverable by reading source code, per the Phase 5X.5 wheel-coverage
    audit instruction. Used by the readiness endpoint and
    scripts/check_courtbuilder_wheel_coverage.py.

    Returns {"available": False} if the interim dataset or mode is invalid,
    rather than raising -- this is a diagnostic, never a 500.
    """
    if mode not in MODE_TO_YEARS:
        return {"available": False}
    duration = MODE_TO_YEARS[mode]
    try:
        data = _load_interim_teams(interim_teams_path)
    except FileNotFoundError:
        return {"available": False}

    by_dur = _load_profiles(profiles_path)
    duration_pool = by_dur.get(duration, [])
    entries = _all_interim_spin_entries(data)

    per_era: dict[str, dict[str, int]] = {}
    per_team: dict[str, dict[str, int]] = {}
    playable = 0
    sparse = 0
    excluded_zero = 0

    for entry in entries:
        candidates = _candidates_for_entry(entry, duration_pool)
        n = len(candidates)
        era = entry.get("era_label") or "unknown"
        team = entry.get("franchise_display_name") or "unknown"
        era_row = per_era.setdefault(era, {"combinations": 0, "playable": 0, "sparse": 0, "excluded_zero_candidate": 0})
        team_row = per_team.setdefault(team, {"combinations": 0, "playable": 0, "sparse": 0, "excluded_zero_candidate": 0})
        era_row["combinations"] += 1
        team_row["combinations"] += 1

        if n == 0:
            excluded_zero += 1
            era_row["excluded_zero_candidate"] += 1
            team_row["excluded_zero_candidate"] += 1
            continue
        playable += 1
        era_row["playable"] += 1
        team_row["playable"] += 1
        if n < PREFERRED_MIN_CANDIDATES:
            sparse += 1
            era_row["sparse"] += 1
            team_row["sparse"] += 1

    return {
        "available": True,
        "mode": mode,
        "duration_years": duration,
        "total_combinations": len(entries),
        "playable_combinations": playable,
        "sparse_combinations": sparse,
        "excluded_zero_candidate_combinations": excluded_zero,
        "per_era": per_era,
        "per_team": per_team,
    }


# Relative selection weight for "good" (>=PREFERRED_MIN_CANDIDATES) vs
# "sparse" (1 candidate) interim entries -- see _select_interim_entries.
# 3x, not infinite: a sparse entry should be uncommon, not impossible. An
# earlier version of this function used a hard good-then-sparse fill order
# (sparse entries used only as leftover filler), which -- audited this
# session across many seeds -- meant that any franchise whose ONLY entries
# were sparse (e.g. a team with just one resolvable player at a given
# duration) was excluded from essentially every board, even though its
# entries are legitimate, non-fabricated, playable spins. Weighted sampling
# without replacement keeps the same "prefer real choice over a 1-name
# formality" preference while guaranteeing every playable entry has a real,
# nonzero chance of appearing.
_GOOD_ENTRY_WEIGHT = 3.0
_SPARSE_ENTRY_WEIGHT = 1.0


def _select_interim_entries(
    entries: list[dict],
    duration_pool: list[CardProfile],
    rng: random.Random,
    limit: int,
) -> list[tuple[dict, list[str]]]:
    """Choose up to `limit` interim spin entries for this board, each paired
    with its resolved candidate list for this duration.

    Two rules, both from the "no fake candidate depth, but no bad spins
    either" instruction:
      1. Entries that resolve to 0 candidates at this duration are excluded
         outright -- never offered as a spin, not even as a last resort.
      2. Entries with >= PREFERRED_MIN_CANDIDATES candidates are weighted
         _GOOD_ENTRY_WEIGHT:_SPARSE_ENTRY_WEIGHT more likely to be chosen
         than thinner (1-candidate) entries, via weighted sampling without
         replacement (Efraimidis-Spirakis: each entry gets a random key
         `U ** (1/weight)`, sorted descending, top `limit` taken) -- not a
         hard "fill with good first, sparse only as leftover" split, which
         made every sparse-only franchise invisible in practice (see the
         module-level comment above `_GOOD_ENTRY_WEIGHT`).
    """
    resolved = [(e, _candidates_for_entry(e, duration_pool)) for e in entries]
    resolved = [(e, c) for e, c in resolved if len(c) > 0]

    def _weight(pair: tuple[dict, list[str]]) -> float:
        return _GOOD_ENTRY_WEIGHT if len(pair[1]) >= PREFERRED_MIN_CANDIDATES else _SPARSE_ENTRY_WEIGHT

    keyed = [(rng.random() ** (1.0 / _weight(pair)), pair) for pair in resolved]
    keyed.sort(key=lambda kp: kp[0], reverse=True)

    return [pair for _, pair in keyed[:limit]]


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
            # Use as many distinct interim spins as available, up to
            # TOTAL_ROUNDS, preferring entries with real candidate depth and
            # excluding zero-candidate entries outright (see
            # _select_interim_entries); fall back to open_pool for any
            # remaining rounds if there aren't enough usable interim entries.
            chosen = _select_interim_entries(interim_entries, duration_pool, rng, TOTAL_ROUNDS)
            for i, (entry, candidates) in enumerate(chosen, start=1):
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


# ---------------------------------------------------------------------------
# Phase 6A: experimental team+YEAR (exact season) engine
#
# Purely additive -- generate_board() and its team_decade/exact_team_season
# path above are completely untouched. This engine reads a separate,
# independently-versioned dataset (data/game/experimental/player_pool_1500/
# courtbuilder_team_year.experimental.v0.json) and is only reachable when
# COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=True. Every spin it produces is
# spin_type="team_year" with an exact-season era_label (e.g. "2015-16") --
# never mixed with a team_decade spin in the same board, per the product
# instruction that the wheel must not mix decade and exact-year labels.
# ---------------------------------------------------------------------------


def _default_experimental_team_year_path() -> Path:
    repo_root = Path(__file__).resolve().parent.parent.parent
    return repo_root / "data" / "game" / "experimental" / "player_pool_1500" / "courtbuilder_team_year.experimental.v0.json"


def _default_experimental_cards_path() -> Path:
    repo_root = Path(__file__).resolve().parent.parent.parent
    return repo_root / "data" / "game" / "experimental" / "player_pool_1500" / "card_profiles.experimental.json"


def _load_experimental_team_year_dataset(path: Path | None = None) -> dict:
    """Load (and cache) the experimental team+year dataset. Raises
    FileNotFoundError if missing -- callers must only reach this function
    when COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=True, at which point a
    missing file is a broken checkout, not a normal disabled state (mirrors
    _load_interim_teams' contract for the decade dataset)."""
    global _EXPERIMENTAL_TEAM_YEAR_CACHE
    if path is None and _EXPERIMENTAL_TEAM_YEAR_CACHE is not None:
        return _EXPERIMENTAL_TEAM_YEAR_CACHE

    load_path = path or _default_experimental_team_year_path()
    if not load_path.exists():
        raise FileNotFoundError(
            f"Experimental team+year dataset not found at {load_path}. Run "
            "`python scripts/build_experimental_team_year_dataset.py` first."
        )
    with load_path.open() as f:
        data = json.load(f)

    if path is None:
        _EXPERIMENTAL_TEAM_YEAR_CACHE = data
    return data


def _clear_experimental_team_year_cache() -> None:
    """Clear the cached experimental team+year dataset (used in tests)."""
    global _EXPERIMENTAL_TEAM_YEAR_CACHE
    _EXPERIMENTAL_TEAM_YEAR_CACHE = None


def _load_experimental_cards(path: Path | None = None) -> list[CardProfile]:
    """Load (and cache) the Phase 6A experimental card extension (1-year
    duration only, see scripts/build_experimental_card_extension.py). Reads
    the raw JSON directly -- deliberately does NOT touch
    nba_peak.lineup.board's `_load_profiles`/`_PROFILE_CACHE`, which is
    shared with Peak Draft and must not be perturbed by CourtBuilder-only
    experimental data. Returns [] if the file does not exist (experimental
    extension is optional; a missing file degrades to canonical-pool-only
    candidates, never a hard failure)."""
    global _EXPERIMENTAL_CARDS_CACHE
    if path is None and _EXPERIMENTAL_CARDS_CACHE is not None:
        return _EXPERIMENTAL_CARDS_CACHE

    load_path = path or _default_experimental_cards_path()
    if not load_path.exists():
        return []
    with load_path.open() as f:
        payload = json.load(f)
    cards = [CardProfile.from_dict(d) for d in payload.get("cards", []) if d.get("profile_status") != "excluded"]

    if path is None:
        _EXPERIMENTAL_CARDS_CACHE = cards
    return cards


def _clear_experimental_cards_cache() -> None:
    """Clear the cached experimental card extension (used in tests)."""
    global _EXPERIMENTAL_CARDS_CACHE
    _EXPERIMENTAL_CARDS_CACHE = None


def _merged_duration_pool(duration: int, profiles_path: Path | None, experimental_cards_path: Path | None) -> list[CardProfile]:
    """Canonical duration pool + experimental extension cards for the same
    duration, deduped by player_slug (canonical card wins on conflict -- an
    extension card only ever fills a gap, never shadows a real 250-pool
    entry, since build_experimental_card_extension.py already skips players
    who have a canonical entry)."""
    by_dur = _load_profiles(profiles_path)
    canonical = by_dur.get(duration, [])
    canonical_slugs = {c.player_slug for c in canonical}
    extension = [c for c in _load_experimental_cards(experimental_cards_path) if c.duration_years == duration]
    extension = [c for c in extension if c.player_slug not in canonical_slugs]
    return canonical + extension


def experimental_team_year_summary(path: Path | None = None) -> dict:
    """Public summary of the experimental team+year dataset, for the
    readiness endpoint. Mirrors interim_team_summary()'s contract exactly
    (safe diagnostic, never raises, {"available": False} if missing)."""
    try:
        data = _load_experimental_team_year_dataset(path)
    except FileNotFoundError:
        return {"available": False, "franchise_count": 0, "dataset_version": None, "franchise_names": [], "season_count": 0, "season_labels": []}
    entries = data.get("exact_team_year_spins", [])
    franchises = {e["franchise_display_name"] for e in entries}
    seasons = {e["season_label"] for e in entries}
    return {
        "available": True,
        "franchise_count": len(franchises),
        "dataset_version": data.get("dataset_version"),
        "franchise_names": sorted(franchises),
        "season_count": len(entries),
        "season_labels": sorted(seasons),
    }


def generate_team_year_board(
    mode: str,
    seed: int,
    board_type: str = "practice",
    profiles_path: Path | None = None,
    experimental_team_year_path: Path | None = None,
    experimental_cards_path: Path | None = None,
) -> PerfectSeasonBoard:
    """Generate a deterministic CourtBuilder board using exact team+season
    spins (Phase 6A Goal 5), rather than team+decade spins.

    Raises:
        ValueError: Invalid mode.
        FileNotFoundError: Experimental team+year dataset missing (only
            reachable when COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=True;
            a missing file at that point is a broken checkout).
        RuntimeError: Could not find a feasible (all-distinct-assignable)
            board after MAX_BOARD_ATTEMPTS.
    """
    if mode not in SUPPORTED_MODES:
        raise ValueError(f"Unsupported mode '{mode}'. Use one of {SUPPORTED_MODES}")

    duration = MODE_TO_YEARS[mode]
    duration_pool = _merged_duration_pool(duration, profiles_path, experimental_cards_path)
    if not duration_pool:
        raise RuntimeError(f"No card pool available for duration {duration}yr")

    data = _load_experimental_team_year_dataset(experimental_team_year_path)
    entries = [
        {**e, "spin_type": "team_year", "era_label": e["season_label"]}
        for e in data.get("exact_team_year_spins", [])
    ]

    for attempt in range(MAX_BOARD_ATTEMPTS):
        rng = random.Random(seed + attempt * 997)

        # Every playable team-year entry available (there are far fewer of
        # these than TOTAL_ROUNDS in this pass's narrow-coverage dataset),
        # weighted-sampled the same way the decade path prefers deeper
        # rosters over sparse ones -- reusing _select_interim_entries keeps
        # the selection rule identical across both engines rather than
        # forking a second copy of the same weighting logic.
        chosen = _select_interim_entries(entries, duration_pool, rng, TOTAL_ROUNDS)

        spins: list[SpinPrompt] = []
        round_candidates: list[list[str]] = []
        for i, (entry, candidates) in enumerate(chosen, start=1):
            spins.append(SpinPrompt(
                round_number=i,
                spin_type=entry["spin_type"],
                spin_id=entry["spin_id"],
                franchise_display_name=entry.get("franchise_display_name"),
                era_label=entry.get("era_label"),
                candidate_player_slugs=candidates,
            ))
            round_candidates.append(candidates)

        # Narrow coverage in this pass means there may be fewer team-year
        # entries than TOTAL_ROUNDS -- fill any remaining rounds from the
        # merged duration pool (canonical + experimental), same fallback
        # shape as generate_board()'s open_pool rounds, so a board is always
        # exactly TOTAL_ROUNDS long even while coverage is being built out.
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
            interim_team_data_version=None,
            experimental_team_year_data_version=EXPERIMENTAL_TEAM_YEAR_DATA_VERSION,
            metadata={
                "attempts": attempt + 1,
                "team_spin_enabled": True,
                "team_year_enabled": True,
                "duration_years": duration,
                "card_pool_size": len(duration_pool),
                # Receipt fields (Phase 6A Goal 5/9): seed, round-level team+
                # season are already on each SpinPrompt; these are the
                # board-level receipt fields.
                "formula_version": EXPERIMENTAL_FORMULA_VERSION,
                "coverage_mode": EXPERIMENTAL_TEAM_YEAR_COVERAGE_MODE,
                "data_version": EXPERIMENTAL_TEAM_YEAR_DATA_VERSION,
            },
        )

    raise RuntimeError(
        f"Could not generate a feasible CourtBuilder team-year board after "
        f"{MAX_BOARD_ATTEMPTS} attempts (mode={mode}, seed={seed})"
    )


def resolve_card(
    player_slug: str,
    duration_years: int,
    profiles_path: Path | None = None,
    experimental_cards_path: Path | None = None,
) -> CardProfile | None:
    """Resolve a player_slug's existing best-available peak_card at the given
    duration. Does NOT attempt team-specific score attribution -- the
    current card pool has no team dimension (PHASE_5_DATA_MODEL.md Sec 0);
    this returns the player's one existing card at this duration, whichever
    team-decade/exact-team-season/team-year spin surfaced them.

    Falls back to the Phase 6A experimental card extension (see
    _load_experimental_cards) if the slug has no canonical entry -- this is
    the only way a generate_team_year_board() candidate (e.g. a real GSW
    rostermate who exists only in the experimental extension) resolves to a
    real card. A no-op for every pre-Phase-6A board: generate_board() never
    offers a candidate slug that isn't already in the canonical pool, so the
    fallback branch is unreachable for those boards.
    """
    by_dur = _load_profiles(profiles_path)
    for card in by_dur.get(duration_years, []):
        if card.player_slug == player_slug:
            return card
    for card in _load_experimental_cards(experimental_cards_path):
        if card.player_slug == player_slug and card.duration_years == duration_years:
            return card
    return None


def find_spin(board: PerfectSeasonBoard, round_number: int) -> SpinPrompt | None:
    for s in board.spins:
        if s.round_number == round_number:
            return s
    return None
