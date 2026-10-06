"""Peak Duel Daily -- pairing v2: debatable matchups instead of random ones.

THE DEFECT. The v1 daily board (`duel.generate_duels`) drew both cards
uniformly from the top 150 of a duration. Nothing tied the two together, so a
board was mostly structurally unrelated comparisons -- Kevin Johnson against
Shaquille O'Neal: a point guard against a centre, a 20+ point gap, no shared
question a fan would actually argue about. The answer was trivial and the
comparison meant nothing.

WHAT v2 DOES. Every pair is chosen to be a real basketball argument. Three
structural signals, of which a pair must satisfy AT LEAST TWO:

  1. SCORE PROXIMITY -- the PEAK3 display-score gap lies inside the pair's
     difficulty band (every band is capped at `EASY_MAX_GAP`, so no v2 pair is
     a blowout).
  2. BASKETBALL SIMILARITY -- the two windows share a position group
     (guard / wing / big, from the window's own `window_positions` in
     `card_profiles.v3.json`) or the same `primary_role`.
  3. ERA PROXIMITY -- anchor seasons within `ERA_ANCHOR_YEARS`, or the two
     windows overlap in time.

The bands are measured on `prime_score` gaps over the top-150 pool of each
duration (see THRESHOLDS below). The winner is still decided by `prime_index`
exactly as in v1 -- `prime_score` is a monotone remap of it (`calibrate_score`)
and the committed pools have zero inversions, so the band a pair sits in can
never disagree with which card wins.

A board is 10 duels in a fixed progression: 2 easier-but-sensible (similarity
REQUIRED, so even the warm-up is a fair comparison), 5 medium, 3 close.

WHAT v2 DOES NOT DO. It does not change answer semantics, the response schema,
the orientation bit (`duel.stronger_on_left`, same seed), the duel id
(`duel._duel_id`) or anything about Endless. It exposes nothing new before an
answer: the payload's existing `difficulty` field is filled from the band,
which the client does not render until the reveal.

DETERMINISM. One `random.Random` keyed on `PAIRING_NAMESPACE` and the daily
seed. Every candidate list is sorted by id before a draw, so the board is a
pure function of (pool, seed) and independent of dict/set iteration order.
"""
from __future__ import annotations

import itertools
import json
import random
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Callable, Optional

PAIRING_VERSION = "v2"
#: Salts the v2 stream so it can never replay or perturb v1's draws.
PAIRING_NAMESPACE = "peak3:duel-pairing:v2"

# ---------------------------------------------------------------------------
# THRESHOLDS -- derived from the committed pools, not chosen from the brief.
#
# Pairwise |prime_score| gaps within the top 150 of data/web/leaderboards.json
# (11,175 pairs per duration), measured 2026-10-06:
#
#   duration  q10   q25   q50   q75    q90
#   1y        1.38  3.57  9.10  19.51  27.41
#   2y        1.42  3.73  8.62  20.11  28.05
#   3y        1.33  3.54  8.36  19.69  27.98
#   5y        1.35  3.48  8.32  19.44  28.52
#
# The four durations agree to within half a point, so one set of bands serves
# all of them:
#
#   HARD    (0.10, 3.0]  ~ the closest 20% of pairs: genuinely debatable
#   MEDIUM  (3.0,  7.5]  ~ the 20th-45th percentile
#   EASY    (7.5, 14.0]  ~ the 45th-65th percentile: a clear answer, still a
#                          real comparison. Nothing above ~q65 is ever dealt,
#                          which is what removes the 20-to-40-point blowouts.
#
# The 0.10 floor keeps two cards that DISPLAY the same score (a rounding tie
# over distinct prime_index values) off the board -- the reveal would show a
# "winner" by an invisible margin.
#
# Era: anchor-season gaps over the same pairs have quartiles 6-7 / 14 / 23-25
# years; 6 years (~q25) is "the same era" without collapsing to one decade.
# Position-group overlap holds for ~39-44% of pairs, so requiring it on the two
# warm-up duels still leaves hundreds of candidates.
# ---------------------------------------------------------------------------
MIN_GAP = 0.10
HARD_MAX_GAP = 3.0
MEDIUM_MAX_GAP = 7.5
EASY_MAX_GAP = 14.0
ERA_ANCHOR_YEARS = 6

BAND_EASY = "easy"
BAND_MEDIUM = "medium"
BAND_HARD = "hard"
BAND_RANGES: dict[str, tuple[float, float]] = {
    BAND_HARD: (MIN_GAP, HARD_MAX_GAP),
    BAND_MEDIUM: (HARD_MAX_GAP, MEDIUM_MAX_GAP),
    BAND_EASY: (MEDIUM_MAX_GAP, EASY_MAX_GAP),
}

#: The board's progression, in display order. Scaled proportionally when a
#: board is not ten long (`progression`).
PROGRESSION_10: tuple[str, ...] = (BAND_EASY,) * 2 + (BAND_MEDIUM,) * 5 + (BAND_HARD,) * 3
#: Bands are FILLED scarcest-first (close pairs are rarest), DISPLAYED in
#: progression order.
FILL_ORDER: tuple[str, ...] = (BAND_HARD, BAND_EASY, BAND_MEDIUM)

#: Variety guard. A "mirror" pair (identical window positions AND anchors within
#: `MIRROR_ANCHOR_YEARS`) satisfies all three signals at once; a board made of
#: nothing else reads as the same question ten times.
MIRROR_ANCHOR_YEARS = 3
MAX_MIRROR_PAIRS = 3

#: v1-compatible difficulty labels for the payload's existing `difficulty`
#: field (shown only at the reveal, never before an answer).
PHOTO_FINISH_GAP = 1.5

POSITION_GROUPS: dict[str, str] = {"PG": "guard", "SG": "guard", "SF": "wing", "PF": "big", "C": "big"}

_REPO_ROOT = Path(__file__).resolve().parents[4]
CARD_PROFILES_PATH = _REPO_ROOT / "data" / "game" / "profiles" / "card_profiles.v3.json"


@lru_cache(maxsize=1)
def _profiles() -> dict[str, dict]:
    """`peak_window_id` -> {positions, groups, role}. Offline, read once.

    A missing or unreadable file yields an empty map: every pair's similarity
    becomes UNKNOWN (it cannot count toward the two-of-three rule) rather than
    the board failing to generate.
    """
    try:
        rows = json.loads(CARD_PROFILES_PATH.read_text())
    except (OSError, ValueError):
        return {}
    out: dict[str, dict] = {}
    for row in rows if isinstance(rows, list) else []:
        window_id = row.get("peak_window_id")
        if not window_id:
            continue
        positions = frozenset(
            token
            for slot in (row.get("window_positions") or ())
            for token in str(slot).split("/")
            if token in POSITION_GROUPS
        )
        out[window_id] = {
            "positions": positions,
            "groups": frozenset(POSITION_GROUPS[p] for p in positions),
            "role": row.get("primary_role") or None,
        }
    return out


def _start_year(season: object) -> Optional[int]:
    try:
        return int(str(season)[:4])
    except (TypeError, ValueError):
        return None


def _complete(record: dict) -> bool:
    return (
        record.get("data_status", "complete") == "complete"
        and isinstance(record.get("prime_index"), (int, float))
        and isinstance(record.get("prime_score"), (int, float))
        and _start_year(record.get("anchor_season")) is not None
    )


@dataclass(frozen=True)
class PairFacts:
    """Everything the pairing rules know about one candidate pair."""

    a: dict
    b: dict
    gap: float
    #: None = unknown (a card has no profile), never a guess.
    similar: Optional[bool]
    era_close: bool
    mirror: bool
    key: tuple[str, str]
    players: frozenset[str]
    band_name: Optional[str]

    def band(self) -> Optional[str]:
        return self.band_name

    def criteria(self) -> int:
        """How many of the three signals hold. Score proximity holds whenever
        the gap is inside ANY band (all bands are capped at `EASY_MAX_GAP`)."""
        return int(self.band() is not None) + int(self.similar is True) + int(self.era_close)


def pair_facts(a: dict, b: dict) -> PairFacts:
    profiles = _profiles()
    pa, pb = profiles.get(a["id"]), profiles.get(b["id"])
    if pa is None or pb is None:
        similar: Optional[bool] = None
    else:
        similar = bool(pa["groups"] & pb["groups"]) or (
            pa["role"] is not None and pa["role"] == pb["role"]
        )
    anchor_a, anchor_b = _start_year(a["anchor_season"]), _start_year(b["anchor_season"])
    start_a = _start_year(a.get("start_season")) or anchor_a
    end_a = _start_year(a.get("end_season")) or anchor_a
    start_b = _start_year(b.get("start_season")) or anchor_b
    end_b = _start_year(b.get("end_season")) or anchor_b
    overlap = start_a <= end_b and start_b <= end_a
    era_close = abs(anchor_a - anchor_b) <= ERA_ANCHOR_YEARS or overlap
    mirror = bool(
        pa is not None
        and pb is not None
        and pa["positions"]
        and pa["positions"] == pb["positions"]
        and abs(anchor_a - anchor_b) <= MIRROR_ANCHOR_YEARS
    )
    gap = round(abs(float(a["prime_score"]) - float(b["prime_score"])), 4)
    return PairFacts(
        a=a,
        b=b,
        gap=gap,
        similar=similar,
        era_close=era_close,
        mirror=mirror,
        key=tuple(sorted((a["id"], b["id"]))),  # type: ignore[arg-type]
        players=frozenset((a["player_id"], b["player_id"])),
        band_name=band_of(gap),
    )


def band_of(gap: float) -> Optional[str]:
    """The difficulty band a display-score gap falls in; None = no band (a
    rounding tie below `MIN_GAP`, or a blowout above `EASY_MAX_GAP`)."""
    if MIN_GAP <= gap <= HARD_MAX_GAP:
        return BAND_HARD
    if HARD_MAX_GAP < gap <= MEDIUM_MAX_GAP:
        return BAND_MEDIUM
    if MEDIUM_MAX_GAP < gap <= EASY_MAX_GAP:
        return BAND_EASY
    return None


def progression(count: int) -> list[str]:
    """The band of each duel, in display order. Ten is the product's board;
    any other length keeps the same easy -> close shape proportionally."""
    if count == len(PROGRESSION_10):
        return list(PROGRESSION_10)
    easy = max(1, round(count * 0.2)) if count >= 3 else 0
    hard = max(1, round(count * 0.3)) if count >= 2 else 0
    medium = max(0, count - easy - hard)
    return [BAND_EASY] * easy + [BAND_MEDIUM] * medium + [BAND_HARD] * hard


# ---------------------------------------------------------------------------
# Slot rules and the deterministic relaxation ladder
# ---------------------------------------------------------------------------

Rule = Callable[[PairFacts, str], bool]


def _in_band(f: PairFacts, band: str) -> bool:
    return f.band() == band


def _strict(f: PairFacts, band: str) -> bool:
    if not _in_band(f, band):
        return False
    if band == BAND_EASY:
        # The warm-ups must be a FAIR comparison, not merely a clear one.
        return f.similar is True
    return f.similar is True or f.era_close


def _easy_by_era(f: PairFacts, band: str) -> bool:
    return _in_band(f, band) and (f.similar is True or f.era_close)


_NEIGHBOUR_BANDS: dict[str, tuple[str, ...]] = {
    BAND_EASY: (BAND_EASY, BAND_MEDIUM),
    BAND_MEDIUM: (BAND_MEDIUM, BAND_HARD, BAND_EASY),
    BAND_HARD: (BAND_HARD, BAND_MEDIUM),
}


def _neighbour_band(f: PairFacts, band: str) -> bool:
    return f.band() in _NEIGHBOUR_BANDS[band] and (f.similar is True or f.era_close)


def _score_only(f: PairFacts, band: str) -> bool:
    # Reached only when the structural data is missing (no card profiles AND no
    # era signal) -- e.g. a synthetic test pool. Still never a blowout.
    return f.band() in _NEIGHBOUR_BANDS[band]


#: (name, rule, enforce_mirror_cap). Tried in order per slot; the first rung
#: with any candidate wins. Every rung still forbids repeats and incomplete data.
RELAXATION: tuple[tuple[str, Rule, bool], ...] = (
    ("strict", _strict, True),
    ("no_mirror_cap", _strict, False),
    ("easy_by_era", _easy_by_era, False),
    ("neighbour_band", _neighbour_band, False),
    ("score_only", _score_only, False),
)


@dataclass(frozen=True)
class PlannedPair:
    facts: PairFacts
    band: str
    rung: str


#: Pair facts per candidate pool. The pool is the served leaderboard, which is
#: immutable for the life of the process, so ~11k pairs are classified once
#: per duration rather than on every daily request. Keyed on the values the
#: facts read, so a different pool can never be served a stale entry.
_FACTS_CACHE: dict[tuple, list[PairFacts]] = {}
_FACTS_CACHE_LIMIT = 16


def _facts_for(candidates: list[dict]) -> list[PairFacts]:
    key = tuple(
        (r["id"], r["player_id"], r["prime_index"], r["prime_score"], r.get("anchor_season"),
         r.get("start_season"), r.get("end_season"))
        for r in candidates
    )
    cached = _FACTS_CACHE.get(key)
    if cached is not None:
        return cached
    facts = [
        pair_facts(a, b)
        for a, b in itertools.combinations(candidates, 2)
        if a["player_id"] != b["player_id"] and a["prime_index"] != b["prime_index"]
    ]
    facts.sort(key=lambda f: f.key)
    if len(_FACTS_CACHE) >= _FACTS_CACHE_LIMIT:
        _FACTS_CACHE.clear()
    _FACTS_CACHE[key] = facts
    return facts


def plan_pairs(pool: list[dict], count: int, seed: int) -> list[PlannedPair]:
    """Choose up to `count` pairs in progression order. May return fewer when
    even the last rung is empty; the caller tops up with the v1 draw."""
    preferred = [r for r in pool if r.get("rank", 9999) <= 150]
    candidates = sorted(
        (r for r in (preferred if len(preferred) >= 20 else pool) if _complete(r)),
        key=lambda r: r["id"],
    )
    facts = _facts_for(candidates)

    rng = random.Random(f"{PAIRING_NAMESPACE}:{seed}")
    bands = progression(count)
    slots: dict[str, list[PlannedPair]] = {band: [] for band in BAND_RANGES}
    used_players: set[str] = set()
    used_pairs: set[tuple[str, str]] = set()
    mirrors = 0

    for band in FILL_ORDER:
        for _ in range(bands.count(band)):
            for rung, rule, cap_mirrors in RELAXATION:
                pickable = [
                    f
                    for f in facts
                    if f.key not in used_pairs
                    and not (f.players & used_players)
                    and not (cap_mirrors and f.mirror and mirrors >= MAX_MIRROR_PAIRS)
                    and rule(f, band)
                ]
                if pickable:
                    chosen = pickable[rng.randrange(len(pickable))]
                    slots[band].append(PlannedPair(chosen, band, rung))
                    used_pairs.add(chosen.key)
                    used_players |= chosen.players
                    mirrors += int(chosen.mirror)
                    break

    ordered: list[PlannedPair] = []
    cursor = {band: 0 for band in BAND_RANGES}
    for band in bands:
        if cursor[band] < len(slots[band]):
            ordered.append(slots[band][cursor[band]])
            cursor[band] += 1
    return ordered


def difficulty_label(band: str, gap: float) -> str:
    """The v1 label vocabulary, from the band (reveal-only on the client)."""
    if band == BAND_EASY:
        return "Comfortable"
    if band == BAND_MEDIUM:
        return "Tricky"
    return "Photo Finish" if gap <= PHOTO_FINISH_GAP else "Brutal"


__all__ = [
    "BAND_EASY",
    "BAND_HARD",
    "BAND_MEDIUM",
    "BAND_RANGES",
    "EASY_MAX_GAP",
    "ERA_ANCHOR_YEARS",
    "HARD_MAX_GAP",
    "MAX_MIRROR_PAIRS",
    "MEDIUM_MAX_GAP",
    "MIN_GAP",
    "PAIRING_NAMESPACE",
    "PAIRING_VERSION",
    "PROGRESSION_10",
    "PairFacts",
    "PlannedPair",
    "band_of",
    "difficulty_label",
    "pair_facts",
    "plan_pairs",
    "progression",
]
