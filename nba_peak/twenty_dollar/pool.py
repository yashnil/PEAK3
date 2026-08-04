"""The candidate pool: career-best 1Y PEAK3 cards, with real positions.

SOURCE, AND WHY THIS ONE
------------------------
`data/game/experimental/player_pool_1500/top_1000_peaks.v1.json`, block
`windows["1y"]`. Verified properties of the committed artifact:

  * 1000 rows, 1000 DISTINCT `player_slug` -- the generator has already
    reduced each player to their single best 1Y window, so "career-best 1Y
    card" is a row lookup rather than a computation.
  * Git-TRACKED. Unlike `data/web/`, which is gitignored at `.gitignore:63`,
    this needs no build step and no `make build-dataset`.
  * Produced by `scripts/build_top_peaks.py`, which re-runs the unmodified
    official `peak3.n_year_windows` / `calibrate_score` against a broader
    universe. NO PEAK3 SCORE IS COMPUTED HERE OR ANYWHERE IN THIS PACKAGE
    (CLAUDE.md); every number is read from the artifact.

The score field is `prime_score` -- the calibrated 0-100 display value.
`prime_index` is the raw ordering index and is deliberately NOT what a roster
sums, because the receipt shows the same number the rankings page shows.

Rows carry a 25.0 mpg serving gate applied by the generator. That is a display
gate on sample size, not a scoring change, and it is why a fringe season cannot
appear as a card.

SLUG DRIFT IS HANDLED AT THE BOUNDARY
--------------------------------------
Two committed slug conventions exist in this repo and they disagree for real
players: `shaquille-oneal` vs `shaquille-o-neal`, `jermaine-oneal`,
`deaaron-fox`, `amare-stoudemire`, `pj-brown`. Every lookup here routes through
`career_positions.slug_variants`, which applies the alias pairs in BOTH
directions, so a caller may pass either spelling. Resolving this at the pool
boundary means no downstream rule has to know the drift exists.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

from nba_peak.perfect_season.career_positions import career_positions, slug_variants
from nba_peak.twenty_dollar.config import (
    COMPONENT_FIELDS,
    MODEL_VERSION,
    POOL_WINDOW,
    SLOTS,
)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

DEFAULT_POOL_PATH = (
    _REPO_ROOT
    / "data"
    / "game"
    / "experimental"
    / "player_pool_1500"
    / "top_1000_peaks.v1.json"
)

_SLOT_SET = frozenset(SLOTS)


class PoolUnavailable(RuntimeError):
    """The committed artifact is missing or unusable.

    Surfaced as a clearly-labelled data error rather than degrading into
    fabricated cards -- the same call `run_the_table.cards.CardPoolUnavailable`
    makes.
    """


@dataclass(frozen=True)
class Candidate:
    """One player's career-best 1Y card.

    `positions` is the set of real starter slots this player logged qualifying
    NBA minutes at, from `career_positions` -- never an archetype guess. It is
    a frozenset because it is genuinely unordered: `career_positions` does not
    claim to know which of a player's real positions was their main one, and
    promoting a set membership to a ranking would invent an ordering the data
    does not have.
    """

    player_slug: str
    player_name: str
    row_id: str
    rank: int
    anchor_season: str
    team: Optional[str]
    prime_score: float
    positions: frozenset[str]
    components: dict[str, float]
    model_version: str
    #: 0-100 per component, normalised against the pool's own min/max.
    #:
    #: COMPUTED IN PYTHON ON PURPOSE. The component radar needs a 0-100 scale
    #: and the raw contributions are not one (statistical impact spans roughly
    #: 6.8-38.9, team achievement 0-3). Normalising in the frontend would mean
    #: hardcoding the model's ranges in TypeScript -- which CLAUDE.md forbids,
    #: and which would go stale silently the moment the artifact is
    #: regenerated. `run_the_table` already made exactly this call:
    #: `RunCard.lane_index` is server-computed and `LaneProfile.tsx` states it
    #: performs no client-side normalisation.
    #:
    #: A rescaling of published values, never a new score.
    component_index: dict[str, float] = field(default_factory=dict)

    def fits(self, slot: str) -> bool:
        return slot in self.positions

    def public_dict(self) -> dict:
        """What a bidder may see BEFORE the round resolves.

        Identity and position eligibility only. No `prime_score`, no `rank`, no
        components -- those are the thing being bid on, and revealing them
        would turn a judgement call into arithmetic. This is the positive
        allowlist, built by naming what goes in rather than by deleting what
        must stay out; the deletion form is what leaked an opponent's run id
        out of a settled head-to-head receipt
        (`api/v1/head_to_head.py:183-201`).
        """
        return {
            "player_slug": self.player_slug,
            "player_name": self.player_name,
            "anchor_season": self.anchor_season,
            "team": self.team,
            "positions": sorted(self.positions),
        }

    def revealed_dict(self) -> dict:
        """The full card, for a round that has already resolved."""
        return {
            **self.public_dict(),
            "row_id": self.row_id,
            "rank": self.rank,
            "prime_score": self.prime_score,
            "components": dict(self.components),
            "component_index": dict(self.component_index),
            "model_version": self.model_version,
        }


class CandidatePool:
    """Immutable, deterministically ordered view of the eligible cards."""

    def __init__(self, candidates: list[Candidate]) -> None:
        # Canonical ordering by rank, then slug to break any tie. Every
        # downstream draw starts from this order so a shuffle can never depend
        # on JSON file order.
        self._candidates: tuple[Candidate, ...] = tuple(
            sorted(candidates, key=lambda c: (c.rank, c.player_slug))
        )
        self._by_slug: dict[str, Candidate] = {}
        for candidate in self._candidates:
            for variant in slug_variants(candidate.player_slug):
                self._by_slug.setdefault(variant, candidate)

    def __len__(self) -> int:
        return len(self._candidates)

    def __iter__(self):
        return iter(self._candidates)

    @property
    def candidates(self) -> tuple[Candidate, ...]:
        return self._candidates

    def get(self, player_slug: str) -> Candidate:
        """Look up by any accepted spelling of the slug."""
        for variant in slug_variants(player_slug):
            found = self._by_slug.get(variant)
            if found is not None:
                return found
        raise KeyError(f"'{player_slug}' is not in the $20 Showdown candidate pool")

    def has(self, player_slug: str) -> bool:
        return any(v in self._by_slug for v in slug_variants(player_slug))

    def eligible_for(self, slot: str) -> tuple[Candidate, ...]:
        return tuple(c for c in self._candidates if slot in c.positions)

    def slot_counts(self) -> dict[str, int]:
        return {slot: len(self.eligible_for(slot)) for slot in SLOTS}


def _coerce_components(raw: object) -> dict[str, float]:
    """The five official contributions, or a hard failure.

    A missing component is never defaulted to zero. Zero is a real, meaningful
    value in this model -- `individual_recognition` is genuinely 0.0 for many
    players and `team_achievement` for many more -- so substituting it for
    "absent" would silently manufacture a data point, which CLAUDE.md forbids
    outright.
    """
    if not isinstance(raw, dict):
        raise PoolUnavailable(f"components block is {type(raw).__name__}, expected object")
    out: dict[str, float] = {}
    for field in COMPONENT_FIELDS:
        if field not in raw:
            raise PoolUnavailable(
                f"component {field!r} missing from a pool row. The artifact is not "
                "the expected top_1000_peaks.v1 shape."
            )
        value = raw[field]
        if not isinstance(value, (int, float)) or value != value:  # NaN check
            raise PoolUnavailable(f"component {field!r} is {value!r}, expected a real number")
        out[field] = float(value)
    return out


def build_pool(path: Optional[Path] = None) -> CandidatePool:
    """Load and validate the committed board.

    Rows with no known position set are DROPPED rather than assigned one. An
    empty `career_positions` result means "no information" and never "played
    nowhere" (that module's own contract), and a card whose slot eligibility
    had to be guessed would make position scarcity -- the central strategic
    lever of this mode -- a fiction. Measured rather than assumed: the drop
    count is 0 against the committed artifact, asserted in the tests.
    """
    load_path = path or DEFAULT_POOL_PATH
    if not load_path.exists():
        raise PoolUnavailable(
            f"Candidate pool not found at {load_path}. This artifact is committed; "
            "a missing file means the checkout is incomplete, not that a build step "
            "was skipped."
        )
    try:
        raw = json.loads(load_path.read_text())
    except (OSError, ValueError) as exc:
        raise PoolUnavailable(f"Could not read {load_path}: {exc}") from exc

    windows = raw.get("windows")
    if not isinstance(windows, dict) or POOL_WINDOW not in windows:
        raise PoolUnavailable(
            f"{load_path.name} has no windows[{POOL_WINDOW!r}] block"
        )
    rows = windows[POOL_WINDOW].get("rows")
    if not isinstance(rows, list) or not rows:
        raise PoolUnavailable(f"windows[{POOL_WINDOW!r}].rows is empty")

    # Pin the artifact's own declared model version against what this mode
    # expects. A board built under a different model must not be served under
    # this mode's label -- that is exactly the silent-rescore failure the
    # pinning decision exists to prevent.
    declared = raw.get("model_version")
    if declared is not None and declared != MODEL_VERSION:
        raise PoolUnavailable(
            f"{load_path.name} declares model_version {declared!r}, but this mode is "
            f"pinned to {MODEL_VERSION!r}. Refusing to serve a board under a label it "
            "was not built with."
        )

    # Per-component min/max across the eligible rows, for the 0-100 rescale.
    # Computed over the SERVED pool rather than over published constants, so it
    # cannot disagree with the cards actually in play.
    comp_bounds: dict[str, tuple[float, float]] = {}
    for field_name in COMPONENT_FIELDS:
        values = [
            float(r["components"][field_name])
            for r in rows
            if isinstance(r.get("components"), dict) and field_name in r["components"]
        ]
        comp_bounds[field_name] = (min(values), max(values)) if values else (0.0, 1.0)

    candidates: list[Candidate] = []
    seen: set[str] = set()
    for row in rows:
        slug = row.get("player_slug")
        if not slug:
            continue
        positions = frozenset(career_positions(slug)) & _SLOT_SET
        if not positions:
            continue
        if slug in seen:
            # The generator publishes one row per player; a duplicate means the
            # artifact is not what it claims, and silently keeping the first
            # would hide that.
            raise PoolUnavailable(f"duplicate player_slug {slug!r} in the pool artifact")
        seen.add(slug)
        comps = _coerce_components(row.get("components"))
        index = {}
        for field_name, (lo, hi) in comp_bounds.items():
            span = hi - lo
            index[field_name] = (
                round(100.0 * (comps[field_name] - lo) / span, 2) if span > 0 else 50.0
            )
        candidates.append(
            Candidate(
                player_slug=slug,
                player_name=row["player_name"],
                row_id=row["row_id"],
                rank=int(row["rank"]),
                anchor_season=row["anchor_season"],
                team=row.get("team"),
                prime_score=float(row["prime_score"]),
                positions=positions,
                components=comps,
                component_index=index,
                model_version=str(row.get("model_version", MODEL_VERSION)),
            )
        )

    if not candidates:
        raise PoolUnavailable("No candidate carried a known position set")
    return CandidatePool(candidates)


@lru_cache(maxsize=2)
def get_pool() -> CandidatePool:
    """Process-wide cached pool. Deterministic; safe to share across requests."""
    return build_pool()


def clear_pool_cache() -> None:
    """Test hook -- drops the cached pool."""
    get_pool.cache_clear()
