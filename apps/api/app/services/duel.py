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


#: Namespaced so the orientation stream can never collide with another hash in
#: this module and so a future keying change is a visible, greppable edit.
_ORIENTATION_NAMESPACE = "peak3:duel-orientation:v1"


def stronger_on_left(seed: int, first_id: str, second_id: str) -> bool:
    """Does the stronger peak of this matchup sit on the LEFT?

    THE DEFECT THIS FUNCTION EXISTS TO FIX. `generate_duels` used to assign
    sides directly from the comparison it had just made::

        if a["prime_index"] >= b["prime_index"]:
            left, right = a, b
        else:
            left, right = b, a

    so the higher-scoring peak was placed on the left **unconditionally**. The
    bias was not merely systematic, it was total: 100% of duels, every day, for
    every player. A reader who noticed could win the game from the layout
    without reading either card, which makes the comparison the mode is built
    around worth nothing.

    WHAT REPLACES IT, and the four properties it has to have at once:

      * DETERMINISTIC PER (seed, matchup). The daily board is shared -- every
        player on a given date must see the same two peaks on the same two
        sides, or a shared result is not comparable and a share link lies.
      * STABLE ACROSS REFRESHES. It is a pure function of stored inputs, so
        re-requesting the same board re-derives the same answer. There is no
        per-request randomness and no client shuffle anywhere in the path.
      * ORDER-INDEPENDENT. The ids are sorted before hashing, so the bit
        depends on WHICH TWO PEAKS are matched and not on the order the
        sampler happened to draw them in. Without this, a future change to the
        draw loop would silently re-orient every existing board.
      * UNCORRELATED WITH STRENGTH. The input is the pair's identity, never a
        score, a rank or a winner flag -- so there is nothing for the
        orientation to correlate with. Ties are not a special case for the same
        reason: an exact tie is oriented by the same bit as everything else.

    SHA-256's low bit over a namespaced key is used rather than
    `random.Random(...)`: it needs no generator state, cannot be perturbed by a
    caller consuming the shared RNG differently, and is uniform enough that the
    1,000-seed audit lands inside the specification's 45-55% band with room to
    spare.
    """
    low, high = sorted((first_id, second_id))
    digest = hashlib.sha256(
        f"{_ORIENTATION_NAMESPACE}:{seed}:{low}:{high}".encode()
    ).digest()
    return bool(digest[0] & 1)


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
    seed: int = 0,
) -> list[DuelPair]:
    """Generate `count` duel pairs from `pool` using the provided seeded RNG.

    Pool entries are peak window records (all for the same duration_years).
    Constraints:
    - No self-matchups (same player_id)
    - No exact same prime_index
    - No duplicate pairs in a session
    - Avoid consecutive same player
    - Prefer records from ranks 1–150

    `seed` keys the LEFT/RIGHT ORIENTATION ONLY. It is threaded in separately
    from `rng` rather than read off the generator, because orientation must not
    depend on how much of the shared stream the sampling loop happened to
    consume -- a retry inside the `while` above would otherwise re-orient the
    board. See `stronger_on_left`.
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

        # THE WINNER IS DECIDED BY THE SCORE. THE SIDE IS NOT.
        #
        # These used to be one statement, which is what put the stronger peak
        # on the left of every duel ever generated. They are now two
        # independent facts: `winner_id` still comes from `prime_index`, and
        # the presentation order comes from an unbiased bit keyed on the daily
        # seed and the pair's identity. Nothing downstream re-derives a side
        # from a score -- `/game/answer` compares the two stored peaks by
        # `prime_index` and never looks at which one was `left`.
        stronger, weaker = (a, b) if a["prime_index"] >= b["prime_index"] else (b, a)
        winner_id = stronger["id"]
        if stronger_on_left(seed, a["id"], b["id"]):
            left, right = stronger, weaker
        else:
            left, right = weaker, stronger

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
    # The SAME seed drives both the matchup draw and the orientation bit, so a
    # date and a duration together fix the whole board -- which two peaks, and
    # which side each one is on -- for every player who opens it.
    return generate_duels(pool, count, rng, seed=seed)


def generate_endless_duels(
    pool: list[dict],
    years: int,
    seed: int,
    count: int = 20,
) -> list[DuelPair]:
    rng = random.Random(seed)
    return generate_duels(pool, count, rng, seed=seed)
