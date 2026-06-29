"""Duel generation service for PEAK3 Arena.

Produces deterministic lists of DuelPair objects from a seeded random generator.
"""
from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field


DIFFICULTY_LABELS = {
    # percentile thresholds for |prime_index gap|
    # computed at generation time from the full pool
    "comfortable": "Comfortable",
    "tricky": "Tricky",
    "brutal": "Brutal",
    "photo_finish": "Photo Finish",
}

VALID_YEARS = [1, 2, 3, 5]


@dataclass
class DuelPair:
    id: str
    left: dict          # public fields only
    right: dict         # public fields only
    difficulty: str
    # Private — never serialised to the client
    _correct_winner_id: str = field(repr=False)
    _left_prime_index: float = field(repr=False)
    _right_prime_index: float = field(repr=False)


def _peak_public(record: dict) -> dict:
    """Return only the public fields of a peak window record (no rank/score)."""
    return {
        "peak_id": record["id"],
        "player_name": record["player_name"],
        "player_slug": record["player_slug"],
        "duration_years": record["duration_years"],
        "start_season": record["start_season"],
        "end_season": record["end_season"],
        "anchor_season": record["anchor_season"],
    }


def _duel_id(left_id: str, right_id: str) -> str:
    raw = f"{left_id}|{right_id}"
    return "duel-" + hashlib.sha1(raw.encode()).hexdigest()[:8]


def _assign_difficulty(gap: float, sorted_gaps: list[float]) -> str:
    """Assign difficulty label based on the percentile of this gap in sorted_gaps.

    Lower gap == harder.
    """
    n = len(sorted_gaps)
    if n == 0:
        return "Tricky"
    # Find rank of gap among sorted_gaps (ascending)
    rank = sum(1 for g in sorted_gaps if g < gap)
    pct = rank / n * 100.0  # 0 = smallest gap (hardest), 100 = largest gap (easiest)

    if pct >= 75:
        return "Comfortable"
    elif pct >= 50:
        return "Tricky"
    elif pct >= 25:
        return "Brutal"
    else:
        return "Photo Finish"


def generate_duels(
    pool: list[dict],
    count: int,
    rng: random.Random,
) -> list[DuelPair]:
    """Generate `count` duel pairs from `pool` using the provided seeded RNG.

    Pool entries are peak window records (all for the same duration_years).
    Constraints:
    - No self-matchups (same player_id)
    - No exact same prime_index
    - No duplicate pairs in a session
    - Avoid consecutive same player
    - Prefer records from ranks 1–150
    """
    # Prefer ranks 1-150 to ensure variety
    preferred = [r for r in pool if r.get("rank", 9999) <= 150]
    candidates = preferred if len(preferred) >= 20 else pool

    seen_pairs: set[frozenset[str]] = set()
    last_player_ids: set[str] = set()  # track players from last duel
    duels: list[DuelPair] = []

    # Pre-compute all possible gaps for difficulty assignment
    # Sample up to 200 pairs for the gap distribution
    sample_size = min(len(candidates), 50)
    sample = rng.sample(candidates, k=sample_size)
    gap_samples: list[float] = []
    for i in range(len(sample)):
        for j in range(i + 1, len(sample)):
            a, b = sample[i], sample[j]
            if a["player_id"] != b["player_id"] and a["prime_index"] != b["prime_index"]:
                gap_samples.append(abs(a["prime_index"] - b["prime_index"]))
    gap_samples.sort()

    max_attempts = count * 200
    attempts = 0

    while len(duels) < count and attempts < max_attempts:
        attempts += 1
        a, b = rng.sample(candidates, k=2)

        # Skip self-matchups
        if a["player_id"] == b["player_id"]:
            continue
        # Skip identical prime_index
        if a["prime_index"] == b["prime_index"]:
            continue

        pair_key = frozenset([a["id"], b["id"]])
        if pair_key in seen_pairs:
            continue

        # Avoid consecutive same player — soft constraint, skip if possible
        if last_player_ids and {a["player_id"], b["player_id"]} & last_player_ids:
            # Allow if we're stuck (> 50 attempts per duel)
            if attempts % 50 != 0:
                continue

        gap = abs(a["prime_index"] - b["prime_index"])
        difficulty = _assign_difficulty(gap, gap_samples)

        # Determine winner: higher prime_index wins
        if a["prime_index"] >= b["prime_index"]:
            winner_id = a["id"]
            left, right = a, b
        else:
            winner_id = b["id"]
            left, right = b, a

        duel = DuelPair(
            id=_duel_id(left["id"], right["id"]),
            left=_peak_public(left),
            right=_peak_public(right),
            difficulty=difficulty,
            _correct_winner_id=winner_id,
            _left_prime_index=left["prime_index"],
            _right_prime_index=right["prime_index"],
        )
        duels.append(duel)
        seen_pairs.add(pair_key)
        last_player_ids = {a["player_id"], b["player_id"]}

    return duels


def daily_seed(date_str: str, years: int) -> int:
    """Deterministic integer seed from a date string and duration."""
    raw = f"{date_str}-{years}"
    return int(hashlib.sha256(raw.encode()).hexdigest(), 16) % (2 ** 31)


def generate_daily_duels(
    pool: list[dict],
    years: int,
    date_str: str,
    count: int = 10,
) -> list[DuelPair]:
    seed = daily_seed(date_str, years)
    rng = random.Random(seed)
    return generate_duels(pool, count, rng)


def generate_endless_duels(
    pool: list[dict],
    years: int,
    seed: int,
    count: int = 20,
) -> list[DuelPair]:
    rng = random.Random(seed)
    return generate_duels(pool, count, rng)
