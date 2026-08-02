"""Card pool for RUN THE TABLE.

Joins two committed, already-consistent PEAK3 artifacts:

* ``data/game/profiles/card_profiles.v3.json`` — role eligibility, produced by
  ``scripts/build_card_profiles.py``. This is the same pool Peak Draft uses.
* ``data/web/peak_windows.json`` — canonical component contributions, produced
  by ``scripts/build_web_dataset.py``.

Nothing here recomputes a PEAK3 score. The join is verified card-for-card at
load time and raises rather than silently dropping or fabricating a card.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional

from nba_peak.run_the_table.config import (
    DURATION_YEARS,
    LANE_FIELDS,
    PRICE_BASE,
    PRICE_EXPONENT,
    PRICE_MAX,
    PRICE_MIN,
    PRICE_SPAN,
)
from nba_peak.run_the_table.schemas import PoolStats, RunCard


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent


def default_profiles_path() -> Path:
    return _repo_root() / "data" / "game" / "profiles" / "card_profiles.v3.json"


def default_windows_path() -> Path:
    return _repo_root() / "data" / "web" / "peak_windows.json"


class CardPoolUnavailable(RuntimeError):
    """Raised when a required generated artifact is missing.

    Callers surface this as a retryable, clearly-labelled data error rather
    than degrading into fabricated cards.
    """


def base_cost_for_percentile(percentile: float) -> int:
    """Monotonic non-decreasing price curve.

    ``4 + round(26 * p**2)`` clamped to [PRICE_MIN, PRICE_MAX]. Quadratic so
    the bottom half of the board stays genuinely cheap (a real budget team is
    possible) while the top decile is expensive enough that a GOAT costs most
    of a run's credits.
    """
    p = min(1.0, max(0.0, percentile))
    raw = PRICE_BASE + round(PRICE_SPAN * (p ** PRICE_EXPONENT))
    return int(min(PRICE_MAX, max(PRICE_MIN, raw)))


def _percentile_ranks(values: list[float]) -> list[float]:
    """Rank percentile in [0, 1] for each value, ties sharing the mean rank.

    Deterministic and independent of input order.
    """
    n = len(values)
    if n == 0:
        return []
    if n == 1:
        return [1.0]
    order = sorted(range(n), key=lambda i: (values[i], i))
    out = [0.0] * n
    i = 0
    while i < n:
        j = i
        while j + 1 < n and values[order[j + 1]] == values[order[i]]:
            j += 1
        # mean 0-based rank of the tied block
        mean_rank = (i + j) / 2.0
        pct = mean_rank / (n - 1)
        for k in range(i, j + 1):
            out[order[k]] = pct
        i = j + 1
    return out


class CardPool:
    """Immutable, deterministic view of the eligible cards for one duration."""

    def __init__(self, cards: list[RunCard], stats: PoolStats) -> None:
        # Canonical ordering: by peak_window_id. Every downstream shuffle
        # starts from this order so generation cannot depend on file order.
        self._cards: tuple[RunCard, ...] = tuple(sorted(cards, key=lambda c: c.peak_window_id))
        self._by_id: dict[str, RunCard] = {c.peak_window_id: c for c in self._cards}
        self.stats = stats

    # -- access -----------------------------------------------------------
    def __len__(self) -> int:
        return len(self._cards)

    def __iter__(self):
        return iter(self._cards)

    @property
    def cards(self) -> tuple[RunCard, ...]:
        return self._cards

    def get(self, card_id: str) -> RunCard:
        try:
            return self._by_id[card_id]
        except KeyError:
            raise KeyError(f"Card '{card_id}' is not in the eligible {DURATION_YEARS}Y pool")

    def has(self, card_id: str) -> bool:
        return card_id in self._by_id

    def by_percentile_band(self, lo: float, hi: float) -> list[RunCard]:
        """Cards whose overall percentile falls in [lo, hi], in canonical order."""
        return [c for c in self._cards if lo <= c.overall_percentile <= hi]

    def eligible_for_role(self, role: str) -> list[RunCard]:
        return [c for c in self._cards if role in c.eligible_roles]

    def role_counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for c in self._cards:
            for r in c.eligible_roles:
                out[r] = out.get(r, 0) + 1
        return out


def _load_json(path: Path, what: str) -> object:
    if not path.exists():
        raise CardPoolUnavailable(
            f"{what} not found at {path}. Run `make build-game-data` to generate it."
        )
    with path.open() as f:
        return json.load(f)


def build_pool(
    duration_years: int = DURATION_YEARS,
    profiles_path: Optional[Path] = None,
    windows_path: Optional[Path] = None,
) -> CardPool:
    """Build the eligible card pool for one duration.

    A card is eligible when its card profile is not ``excluded`` (i.e. it has
    at least one eligible role) and it has a matching canonical peak window.
    """
    profiles_raw = _load_json(
        profiles_path or default_profiles_path(), "Card profiles"
    )
    windows_raw = _load_json(
        windows_path or default_windows_path(), "Peak windows dataset"
    )
    assert isinstance(profiles_raw, list) and isinstance(windows_raw, list)

    windows = {w["id"]: w for w in windows_raw}

    selected: list[dict] = []
    excluded = 0
    for p in profiles_raw:
        if p.get("duration_years") != duration_years:
            continue
        if p.get("profile_status") == "excluded" or not p.get("eligible_roles"):
            excluded += 1
            continue
        wid = p["peak_window_id"]
        if wid not in windows:
            raise CardPoolUnavailable(
                f"Card profile '{wid}' has no matching window in peak_windows.json. "
                "The generated artifacts are out of sync — run `make build-game-data`."
            )
        selected.append(p)

    if not selected:
        raise CardPoolUnavailable(
            f"No eligible {duration_years}-year cards found in the card pool."
        )

    # Lane normalisation constants, computed over the eligible pool only.
    lane_min: dict[str, float] = {}
    lane_max: dict[str, float] = {}
    for lane in LANE_FIELDS:
        vals = [float(windows[p["peak_window_id"]]["components"][lane]) for p in selected]
        lane_min[lane] = min(vals)
        lane_max[lane] = max(vals)

    lane_pcts: dict[str, list[float]] = {}
    for lane in LANE_FIELDS:
        lane_pcts[lane] = _percentile_ranks(
            [float(windows[p["peak_window_id"]]["components"][lane]) for p in selected]
        )

    prime_scores = [float(p["individual_peak_score"]) for p in selected]
    overall_pcts = _percentile_ranks(prime_scores)

    cards: list[RunCard] = []
    for idx, p in enumerate(selected):
        w = windows[p["peak_window_id"]]
        comps = w["components"]
        values = {lane: float(comps[lane]) for lane in LANE_FIELDS}
        index = {}
        for lane in LANE_FIELDS:
            span = lane_max[lane] - lane_min[lane]
            index[lane] = (
                round(100.0 * (values[lane] - lane_min[lane]) / span, 4) if span > 0 else 50.0
            )
        pct = overall_pcts[idx]
        cards.append(
            RunCard(
                peak_window_id=p["peak_window_id"],
                player_id=p["player_id"],
                player_slug=p["player_slug"],
                player_name=p["player_name"],
                duration_years=duration_years,
                start_season=p["start_season"],
                end_season=p["end_season"],
                anchor_season=p["anchor_season"],
                prime_score=float(p["individual_peak_score"]),
                prime_index=float(p.get("prime_index", 0.0)),
                overall_percentile=round(pct, 6),
                eligible_roles=tuple(p["eligible_roles"]),
                primary_role=p.get("primary_role"),
                lane_values={k: round(v, 4) for k, v in values.items()},
                lane_index=index,
                lane_percentiles={
                    lane: round(100.0 * lane_pcts[lane][idx], 2) for lane in LANE_FIELDS
                },
                base_cost=base_cost_for_percentile(pct),
                data_completeness=p.get("data_completeness", "unknown"),
            )
        )

    stats = PoolStats(
        duration_years=duration_years,
        card_count=len(cards),
        excluded_count=excluded,
        lane_min={k: round(v, 4) for k, v in lane_min.items()},
        lane_max={k: round(v, 4) for k, v in lane_max.items()},
        prime_score_min=round(min(prime_scores), 2),
        prime_score_max=round(max(prime_scores), 2),
    )
    return CardPool(cards, stats)


@lru_cache(maxsize=4)
def get_pool(duration_years: int = DURATION_YEARS) -> CardPool:
    """Process-wide cached pool. Deterministic; safe to share across requests."""
    return build_pool(duration_years)


def clear_pool_cache() -> None:
    """Test hook — drops the cached pool."""
    get_pool.cache_clear()
