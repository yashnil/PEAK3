"""Real, source-derived career position sets for CourtBuilder fit labels.

WHY THIS EXISTS (Phase 9B position-fit audit)
---------------------------------------------
CourtBuilder was telling users "OFF-SLOT" for placements the player made
their living at. Four compounding causes, all of them data-plumbing rather
than product intent:

1. `COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED` is True, so the LIVE fit
   path is the exact-season one (`classify_fit_from_position`), not the
   legacy archetype path (`classify_fit`).
2. `POSITION_OVERRIDES` -- the human-verified table that Phase 8F carefully
   broadened (Durant +SG, Jordan +PG, LeBron +C) -- is only read by the
   LEGACY path, so none of that work reached a live game.
3. `positions.parse_real_position` was written for hyphenated
   Basketball-Reference `pos` strings ("PG-SG"). The committed data has no
   hyphenated values at all: `regular_1980_2026.parquet`'s `pos` column is
   only {C, F, PF, PG, SF, SG}. So `secondary` is ALWAYS empty and the live
   classifier collapsed to "the ONE position listed for that ONE season,
   or you're off-slot."
4. That single listed season is an accident of which slot a team happened to
   list a player at that year -- Jimmy Butler's SG seasons made his SF
   placements "off-slot", LeBron's PG-listed seasons made PF "off-slot".

This module supplies the missing input: the set of positions a player
actually logged real NBA minutes at ACROSS THEIR CAREER, derived from
committed data only (no network, no scraping, no hand-picking).

SOURCES (both committed)
------------------------
* `data/game/experimental/player_pool_1500/all_seasons_for_identities.v1.json`
  -- per-season `position` + `games_played` for every identity in the pool.
* `cache/processed/regular_1980_2026.parquet` -- joined on (player_slug,
  season) for `mp` (season total minutes).

THE MINUTES/GAMES GATE IS LOAD-BEARING, NOT DECORATION
------------------------------------------------------
A season's listed position only counts when `games_played >= 20` AND
(`mp` is unknown OR `mp >= 500`). Without that gate the derived sets are
actively wrong, because the upstream identity join folds some father/son
name pairs into one slug:

* `patrick-ewing` carries a 2010-11 New Orleans "SF" season at 7 games /
  19 total minutes. That is Patrick Ewing JR. Ungated, Patrick Ewing --
  a first-ballot center -- becomes a "natural fit" at small forward.
* A 1-game `isaiah-thomas` SG cameo behaves the same way.

Both are excluded by the gate, and the verified sets stay honest:
`patrick-ewing` -> {C, PF}, `isiah-thomas` -> {PG}, `shaquille-o-neal` ->
{C}, `isiah-thomas` (the Pistons one) -> {PG}.

RELATIONSHIP TO POSITION_OVERRIDES / FLEXIBLE_FORWARD_SLUGS
-----------------------------------------------------------
Neither is deleted. They remain the human-verified ADDITIVE supplement and
are unioned into every derived set, because a purely per-season-listing
derivation under-counts real, documented flexibility: `kawhi-leonard`
derives only {SF} and `julius-erving` only {SF, SG}, so dropping the union
would REGRESS the curated flexible-forward players this module is supposed
to help. The union direction is deliberately one-way -- curated data can
only ever ADD a position, never remove a derived one.

GRACEFUL DEGRADATION
--------------------
If the parquet is missing (a checkout without `cache/processed/`, e.g. CI),
the minutes gate degrades to "unknown mp" (games-played gate only) rather
than failing. If the JSON is missing too, every lookup returns an empty
frozenset and callers fall back to exactly the pre-existing behavior.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Optional

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

ALL_SEASONS_PATH = (
    _REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "all_seasons_for_identities.v1.json"
)
REGULAR_PARQUET_PATH = _REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet"

# Only real starter-position tokens count. The JSON/parquet also contain the
# era-specific bare "F" label and nulls -- never guessed into PF or SF.
_POSITION_TOKENS = frozenset({"PG", "SG", "SF", "PF", "C"})

# A season's listed position counts only if the player actually played there.
# See the module docstring -- these two numbers are what keep Patrick Ewing
# Jr.'s 7-game cameo out of Patrick Ewing's career position set.
MIN_GAMES_PLAYED = 20
MIN_SEASON_MINUTES = 500

# Slug-spelling drift between the two committed slug conventions in this
# repo. `exact_season.slug()` (used by the JSON/parquet) folds punctuation to
# hyphens, yielding "shaquille-o-neal"; POSITION_OVERRIDES was hand-written
# in the compact "shaquille-oneal" form. Both spellings must resolve to the
# same player, in BOTH directions -- a lookup may arrive in either form.
_SLUG_ALIASES: tuple[tuple[str, str], ...] = (
    ("-o-neal", "-oneal"),
    ("amar-e-", "amare-"),
    ("de-aaron-", "deaaron-"),
    ("p-j-", "pj-"),
)

_CACHE: Optional[dict[str, frozenset[str]]] = None


def _normalize_slug(player_slug: str) -> str:
    """Canonical lowercase-hyphen form of a slug, matching
    exact_season.slug()'s convention (which is what the committed JSON and
    parquet use)."""
    return re.sub(r"[^a-z0-9]+", "-", str(player_slug).lower()).strip("-")


def slug_variants(player_slug: str | None) -> tuple[str, ...]:
    """Every spelling this player could be stored under, normalized form
    first. Applies each alias pair in both directions so a lookup keyed on
    either convention finds data written in the other."""
    if not player_slug:
        return ()
    base = _normalize_slug(player_slug)
    variants = [base]
    for long_form, short_form in _SLUG_ALIASES:
        for candidate in list(variants):
            if long_form in candidate:
                variants.append(candidate.replace(long_form, short_form))
            elif short_form in candidate:
                variants.append(candidate.replace(short_form, long_form))
    # Deduplicate, preserving order.
    return tuple(dict.fromkeys(variants))


def _load_season_minutes() -> dict[tuple[str, str], float]:
    """(player_slug, season) -> that season's total minutes, taken as the MAX
    across the parquet's rows for that pair. Max (not sum) because a traded
    player has both per-team rows AND a "TOT" aggregate row -- the aggregate
    is the season total, and summing would double-count it. Empty dict when
    the parquet (gitignored `cache/processed/`) isn't present."""
    if not REGULAR_PARQUET_PATH.exists():
        return {}
    try:
        import pandas as pd

        df = pd.read_parquet(REGULAR_PARQUET_PATH, columns=["player", "season", "mp"])
    except Exception:
        # A missing/unreadable optional cache must never break fit labels --
        # the games-played gate alone still applies.
        return {}
    out: dict[tuple[str, str], float] = {}
    for player, season, mp in zip(df["player"], df["season"], df["mp"]):
        if mp is None or mp != mp:  # NaN check without importing numpy
            continue
        key = (_normalize_slug(player), str(season))
        value = float(mp)
        if value > out.get(key, -1.0):
            out[key] = value
    return out


def _build() -> dict[str, frozenset[str]]:
    """Derive the full slug -> positions index once. Deferred imports of
    POSITION_OVERRIDES/FLEXIBLE_FORWARD_SLUGS (rather than module-level) so
    positions.py can import THIS module at its own top level without a
    circular import -- by the time _build() runs, positions.py is loaded."""
    from nba_peak.perfect_season.positions import FLEXIBLE_FORWARD_SLUGS, POSITION_OVERRIDES

    derived: dict[str, set[str]] = {}

    if ALL_SEASONS_PATH.exists():
        try:
            rows = json.loads(ALL_SEASONS_PATH.read_text()).get("rows", [])
        except (OSError, ValueError):
            rows = []
        minutes = _load_season_minutes()
        for row in rows:
            position = row.get("position")
            if position not in _POSITION_TOKENS:
                continue
            games = row.get("games_played")
            if games is None or float(games) < MIN_GAMES_PLAYED:
                continue
            row_slug = _normalize_slug(row.get("player_slug") or "")
            if not row_slug:
                continue
            mp = minutes.get((row_slug, str(row.get("season"))))
            if mp is not None and mp < MIN_SEASON_MINUTES:
                continue
            derived.setdefault(row_slug, set()).add(position)

    # Curated, human-verified supplement -- additive only (see docstring).
    for slug, (primary, secondaries) in POSITION_OVERRIDES.items():
        target = derived.setdefault(_normalize_slug(slug), set())
        if primary in _POSITION_TOKENS:
            target.add(primary)
        target.update(p for p in secondaries if p in _POSITION_TOKENS)
    for slug in FLEXIBLE_FORWARD_SLUGS:
        derived.setdefault(_normalize_slug(slug), set()).update({"SF", "PF"})

    # Index under every alias spelling so a lookup in either convention hits
    # the same merged set (e.g. "shaquille-o-neal" and "shaquille-oneal").
    index: dict[str, set[str]] = {}
    for slug, positions in derived.items():
        for variant in slug_variants(slug):
            index.setdefault(variant, set()).update(positions)
    return {slug: frozenset(positions) for slug, positions in index.items()}


def career_positions(player_slug: str | None) -> frozenset[str]:
    """The positions this player logged real NBA minutes at across their
    career, unioned with the curated POSITION_OVERRIDES/
    FLEXIBLE_FORWARD_SLUGS supplement.

    Empty frozenset for an unknown slug, or when the committed source data
    is unavailable -- callers must treat "empty" as "no information", never
    as "played nowhere" (see positions.classify_fit's archetype fallback).
    """
    global _CACHE
    if _CACHE is None:
        _CACHE = _build()
    if not player_slug:
        return frozenset()
    for variant in slug_variants(player_slug):
        found = _CACHE.get(variant)
        if found:
            return found
    return frozenset()


def clear_cache() -> None:
    """Drop the module cache -- for tests that patch the source paths."""
    global _CACHE
    _CACHE = None


__all__ = [
    "ALL_SEASONS_PATH",
    "REGULAR_PARQUET_PATH",
    "MIN_GAMES_PLAYED",
    "MIN_SEASON_MINUTES",
    "career_positions",
    "clear_cache",
    "slug_variants",
]
