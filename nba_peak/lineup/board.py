"""Deterministic board generator for Peak Draft.

A board contains 5 rounds with 3 offers each, plus pre-computed Reframe
branches for each round. Every board is fully reproducible from its seed.

The generator never places future round offers in any client-visible payload.
The Board object is a private server-side structure.
"""
from __future__ import annotations

import hashlib
import json
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from nba_peak.lineup.config import (
    BOARD_ROUNDS,
    MAX_BOARD_ATTEMPTS,
    MIN_SCORE_SPREAD_WITHIN_ROUND,
    MODE_TO_YEARS,
    OFFERS_PER_ROUND,
    REFRAME_POOL_MULTIPLIER,
    SUPPORTED_MODES,
)
from nba_peak.lineup.schemas import Board, CardProfile, RoundOffers

ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]


@dataclass
class BoardConfig:
    mode: str
    board_type: str    # daily | practice | challenge
    date: str | None   # YYYY-MM-DD for daily boards
    seed: int | None   # explicit seed for practice/challenge


# ---------------------------------------------------------------------------
# Card pool loading
# ---------------------------------------------------------------------------

_PROFILE_CACHE: dict[int, list[CardProfile]] | None = None
# Count of profiles excluded (e.g. no eligible role) during the last load.
# Surfaced in board metadata for missing-data transparency.
_EXCLUDED_COUNT: int = 0


def _load_profiles(profiles_path: Path | None = None) -> dict[int, list[CardProfile]]:
    global _PROFILE_CACHE
    if _PROFILE_CACHE is not None:
        return _PROFILE_CACHE

    if profiles_path is None:
        repo_root = Path(__file__).resolve().parent.parent.parent
        profiles_path = repo_root / "data" / "game" / "profiles" / "card_profiles.v3.json"

    if not profiles_path.exists():
        raise FileNotFoundError(
            f"Card profiles not found at {profiles_path}. "
            "Run `python scripts/build_card_profiles.py` first."
        )

    with profiles_path.open() as f:
        raw: list[dict] = json.load(f)

    by_dur: dict[int, list[CardProfile]] = {}
    excluded = 0
    for d in raw:
        if d.get("profile_status") == "excluded":
            excluded += 1
            continue
        card = CardProfile.from_dict(d)
        by_dur.setdefault(card.duration_years, []).append(card)

    global _EXCLUDED_COUNT
    _EXCLUDED_COUNT = excluded
    _PROFILE_CACHE = by_dur
    return by_dur


def _clear_profile_cache() -> None:
    """Clear the in-memory profile cache (used in tests)."""
    global _PROFILE_CACHE, _EXCLUDED_COUNT
    _PROFILE_CACHE = None
    _EXCLUDED_COUNT = 0


# ---------------------------------------------------------------------------
# Feasibility check
# ---------------------------------------------------------------------------

def _can_fill_all_roles(rounds: list[list[CardProfile]]) -> bool:
    """Check via backtracking that some 1-card-per-round selection fills all 5 roles."""
    def search(r_idx: int, filled: set[str]) -> bool:
        if r_idx == BOARD_ROUNDS:
            return set(ROLES) == filled
        for card in rounds[r_idx]:
            for role in card.eligible_roles:
                if role not in filled:
                    if search(r_idx + 1, filled | {role}):
                        return True
        return False

    return search(0, set())


# ---------------------------------------------------------------------------
# Board seed derivation
# ---------------------------------------------------------------------------

def _derive_board_seed(config: BoardConfig, signing_secret: str) -> int:
    """Derive the board seed from config parameters.

    For daily boards the seed is derived from HMAC(secret, date+mode) so it
    cannot be computed without the server's signing secret.
    For practice/challenge boards the explicit seed is used directly.
    """
    if config.board_type == "daily" and config.date:
        raw = f"{config.date}:{config.mode}"
        h = hashlib.sha256(f"{signing_secret}:{raw}".encode()).hexdigest()
        return int(h, 16) % (2 ** 31)
    elif config.seed is not None:
        return config.seed
    else:
        raise ValueError("Board config must have either a date (daily) or a seed (practice/challenge)")


# ---------------------------------------------------------------------------
# Board generation
# ---------------------------------------------------------------------------

def _score_spread(offers: list[CardProfile]) -> float:
    scores = [c.individual_peak_score for c in offers]
    return max(scores) - min(scores)


def generate_board(
    config: BoardConfig,
    signing_secret: str,
    profiles_path: Path | None = None,
) -> Board:
    """Generate a deterministic Peak Draft board.

    Args:
        config: BoardConfig with mode, board_type, date/seed.
        signing_secret: Server signing secret (used for daily seed derivation).
        profiles_path: Optional path override for card profiles JSON.

    Returns:
        Board object (private server-side structure).

    Raises:
        ValueError: Invalid mode or config.
        RuntimeError: Could not find a feasible board after MAX_BOARD_ATTEMPTS.
    """
    if config.mode not in SUPPORTED_MODES:
        raise ValueError(f"Unsupported mode '{config.mode}'. Use one of {SUPPORTED_MODES}")

    duration = MODE_TO_YEARS[config.mode]
    seed = _derive_board_seed(config, signing_secret)

    by_dur = _load_profiles(profiles_path)
    pool: list[CardProfile] = by_dur.get(duration, [])
    if len(pool) < BOARD_ROUNDS * OFFERS_PER_ROUND * 2:
        raise RuntimeError(
            f"Card pool too small for {duration}yr boards: {len(pool)} cards available"
        )

    rng = random.Random(seed)

    board_id = _make_board_id(config)
    now = datetime.now(timezone.utc).isoformat()

    # Sort pool for determinism before shuffling
    pool_sorted = sorted(pool, key=lambda c: c.peak_window_id)

    for attempt in range(MAX_BOARD_ATTEMPTS):
        # Each attempt gets a sub-seed derived from the main seed + attempt number
        attempt_rng = random.Random(seed + attempt * 997)

        # Shuffle pool for this attempt
        shuffled_pool = pool_sorted.copy()
        attempt_rng.shuffle(shuffled_pool)

        # Reserve extra cards for reframe branches (not used in main rounds)
        n_round_cards = BOARD_ROUNDS * OFFERS_PER_ROUND
        n_reframe_cards = BOARD_ROUNDS * OFFERS_PER_ROUND * REFRAME_POOL_MULTIPLIER
        if len(shuffled_pool) < n_round_cards + n_reframe_cards:
            n_reframe_cards = len(shuffled_pool) - n_round_cards

        round_cards = shuffled_pool[:n_round_cards]
        reframe_pool = shuffled_pool[n_round_cards: n_round_cards + n_reframe_cards]

        # Build rounds ensuring no duplicate players within any single round
        rounds_raw: list[list[CardProfile]] = []
        for r in range(BOARD_ROUNDS):
            start = r * OFFERS_PER_ROUND
            round_offers = round_cards[start: start + OFFERS_PER_ROUND]
            rounds_raw.append(list(round_offers))

        # Check no duplicate players across the entire board
        all_player_ids = [c.player_id for rnd in rounds_raw for c in rnd]
        if len(all_player_ids) != len(set(all_player_ids)):
            continue   # retry

        # Check no duplicate peak_window_ids
        all_peak_ids = [c.peak_window_id for rnd in rounds_raw for c in rnd]
        if len(all_peak_ids) != len(set(all_peak_ids)):
            continue

        # Check minimum score spread within rounds (avoid trivially similar offers)
        if any(_score_spread(rnd) < MIN_SCORE_SPREAD_WITHIN_ROUND for rnd in rounds_raw):
            continue

        # Check role feasibility: at least one valid 5-role completion
        if not _can_fill_all_roles(rounds_raw):
            continue

        # Build reframe branches
        reframe_branches: dict[int, list[CardProfile]] = {}
        board_player_ids = set(all_player_ids)
        eligible_reframe = [c for c in reframe_pool if c.player_id not in board_player_ids]
        attempt_rng.shuffle(eligible_reframe)

        # Pre-generate reframe offers for each round
        reframe_ok = True
        used_in_reframe: set[str] = set()
        for r_num in range(1, BOARD_ROUNDS + 1):
            branch_cards = [
                c for c in eligible_reframe
                if c.peak_window_id not in used_in_reframe
            ][:OFFERS_PER_ROUND]
            if len(branch_cards) < OFFERS_PER_ROUND:
                reframe_ok = False
                break
            reframe_branches[r_num] = branch_cards
            used_in_reframe.update(c.peak_window_id for c in branch_cards)

        if not reframe_ok:
            continue

        # Success
        rounds = [
            RoundOffers(round_number=r + 1, offers=list(rounds_raw[r]))
            for r in range(BOARD_ROUNDS)
        ]

        from nba_peak.lineup.config import CARD_PROFILE_VERSION, LINEUP_MODEL_VERSION, RULESET_VERSION
        CARD_POOL_VERSION = CARD_PROFILE_VERSION
        BOARD_GENERATION_ALGORITHM = "v1"
        version_key = make_board_version_key(
            board_id,
            LINEUP_MODEL_VERSION,
            RULESET_VERSION,
            CARD_POOL_VERSION,
            BOARD_GENERATION_ALGORITHM,
        )
        metadata = {
            "generated_at": now,
            "card_pool_version": CARD_POOL_VERSION,
            "lineup_model_version": LINEUP_MODEL_VERSION,
            "ruleset_version": RULESET_VERSION,
            "board_generation_algorithm": BOARD_GENERATION_ALGORITHM,
            # Full version key for database uniqueness (board_id + all versions)
            "board_version_key": version_key,
            "attempts": attempt + 1,
            "board_feasibility_verified": True,
            # Missing-data transparency: pool sizing for this board.
            "duration_years": duration,
            "card_pool_size": len(pool),          # eligible cards for this duration
            "cards_placed": n_round_cards,        # cards used across the 5 rounds
            "reframe_pool_size": len(reframe_pool),
            "excluded_profiles": _EXCLUDED_COUNT, # profiles excluded (no eligible role)
        }

        return Board(
            board_id=board_id,
            mode=config.mode,
            duration_years=duration,
            board_type=config.board_type,
            date=config.date,
            seed=seed,
            rounds=rounds,
            reframe_branches=reframe_branches,
            metadata=metadata,
        )

    raise RuntimeError(
        f"Could not generate a feasible board after {MAX_BOARD_ATTEMPTS} attempts "
        f"(mode={config.mode}, seed={seed})"
    )


def _make_board_id(config: BoardConfig) -> str:
    parts = [config.board_type, config.mode]
    if config.date:
        parts.append(config.date)
    if config.seed is not None:
        parts.append(str(config.seed))
    return "-".join(parts)


def make_board_version_key(
    board_id: str,
    lineup_model_version: str,
    ruleset_version: str,
    card_pool_version: str,
    board_generation_algorithm: str = "v1",
) -> str:
    """Return a stable, opaque key encoding the full version tuple.

    Used as the uniqueness key in the board_snapshots table.
    The public board_id remains compact; this key captures all version components
    required for the immutability contract.

    Format: {board_id}@{lmv}:{rv}:{cpv}:{bga}
    """
    return f"{board_id}@{lineup_model_version}:{ruleset_version}:{card_pool_version}:{board_generation_algorithm}"
