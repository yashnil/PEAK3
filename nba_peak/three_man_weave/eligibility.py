"""Franchise x decade eligibility, and the scoring card that eligibility earns.

TWO SEPARATE CONCEPTS, DELIBERATELY NOT COLLAPSED
-------------------------------------------------
1. ELIGIBILITY EVIDENCE -- "did this player appear for franchise F during
   decade D?" Tenure length is irrelevant: one real season for the Raptors in
   the 2010s makes Kawhi Leonard a legal Raptors x 2010s pick, exactly as a
   nine-year run would. Eligibility is a membership fact.

2. SCORING CARD -- "what is this player's highest single-season PEAK3 score
   ANYWHERE IN THE NBA during that decade?" This is NOT franchise-restricted.
   Kawhi is drafted off a Raptors x 2010s roll on the evidence of 2018-19
   Toronto, but the card that goes into the lineup is 2016-17 San Antonio
   (87.84), because that is his best season of the decade.

Keeping them separate is what makes the game interesting -- the roll tells you
who you MAY take, the scoring card tells you what they are WORTH -- and it is
also what keeps the data honest, because the two questions have different
right answers from different tables.

SOURCES (all committed, no network access at any point)
--------------------------------------------------------
  data/game/experimental/player_pool_1500/all_seasons_for_identities.v1.json
      13,618 per-season rows for 1,390 criteria-admitted identities -- the
      recognizability filter. Carries team, position and games_played per
      season. 1,363 of its rows are multi-team aggregates ("2TM"/"3TM").

  data/game/experimental/player_pool_1500/traded_player_team_stints.v1.json
      4,801 real per-team stint rows covering 2,317 traded player-seasons.
      Resolves those aggregate rows to the actual teams played for.

  cache/processed/scored_1980_2026.parquet
      Official PEAK3 per-season `prime_score` (peak3_v1 -- see
      config.FORMULA_VERSION). Never recomputed or approximated here.

TRADED-PLAYER POLICY (stated explicitly, per the brief -- not left implicit)
----------------------------------------------------------------------------
Traded seasons are USED FOR ELIGIBILITY and are ALLOWED as scoring cards.

Daily Grid refuses traded stints outright (nba_peak/daily_grid/pool.py:41-51),
and it is right to: a grid cell shows a PEAK3 score next to a team badge, and
a traded season's score exists only at whole-season aggregate grain, so the
number would not correspond to the team shown. That specific hazard does not
exist here, for two independent reasons:

  * For ELIGIBILITY we use a stint only as a membership fact -- "Player X
    really did suit up for franchise F that season." No score is attached to
    that claim, so there is nothing to misattribute. Refusing stints would
    instead be the dishonest choice: it would tell a player that someone who
    demonstrably played for the Raptors did not.

  * For the SCORING CARD the season is explicitly decade-wide and carries its
    own season label and team, never the drafted franchise's badge. A traded
    season's aggregate score is the correct and complete answer to "what did
    this player score that season" -- the aggregate IS the season. It is
    surfaced as `score_source="exact_season_aggregate"` so the boundary can
    label it rather than silently presenting it as a single-team number.

When a traded season is chosen as the scoring card, it must still resolve to
ONE real team for `exact_season.resolve_player_season_card` (which rejects
aggregate codes outright). We pick the stint the player actually played the
most games for, ties broken by team code so the choice is deterministic and
reproducible rather than dependent on file ordering.

UNSCORED IDENTITIES
-------------------
An identity with no scored season in a decade has NO scoring card for that
decade and is therefore NOT eligible in it, however many games they played.
This is prevention at the source rather than a fabricated number downstream:
a player with nothing to score has nothing to draft. `evaluation` still
handles an unscored card defensively if one ever reaches it, and surfaces the
status instead of presenting 0.0 as a real result.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

from nba_peak.franchises import FRANCHISES, franchise_for_team_code
from nba_peak.three_man_weave.config import (
    DECADES,
    ELIGIBILITY_INDEX_VERSION,
    FORMULA_VERSION,
    MIN_SEASON_START,
    decade_label,
    season_start_year,
)

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent

ALL_SEASONS_PATH = (
    _REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "all_seasons_for_identities.v1.json"
)
TRADED_STINTS_PATH = (
    _REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "traded_player_team_stints.v1.json"
)
SCORED_PATH = _REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"

# Codes that are a whole-season aggregate for a traded player rather than a
# real single-team membership. Same set `exact_season._MULTI_TEAM_CODES`
# filters on; duplicated as a plain frozenset here so this module does not
# import a private name from another package.
MULTI_TEAM_CODES = frozenset({"2TM", "3TM", "4TM", "5TM", "TOT"})

# How an appearance was established. Part of the returned evidence so a
# receipt can say "via a mid-season trade" rather than asserting a clean
# single-team season that did not happen.
APPEARANCE_DIRECT = "direct_team_season"
APPEARANCE_TRADED_STINT = "traded_team_stint"


def slug(name: str) -> str:
    """ASCII-folded, hyphenated player slug -- the same convention as
    `nba_peak.perfect_season.exact_season.slug` and
    `scripts/build_web_dataset.py::slug`."""
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


@dataclass(frozen=True)
class Appearance:
    """One piece of eligibility evidence: this player, this franchise, this
    season. Never carries a score -- see the module docstring's two-concepts
    split."""

    player_slug: str
    player_name: str
    franchise_id: str
    team_code: str
    season: str
    season_start: int
    decade: str
    games_played: Optional[float]
    via: str  # APPEARANCE_DIRECT | APPEARANCE_TRADED_STINT

    def as_dict(self) -> dict:
        return {
            "player_slug": self.player_slug,
            "player_name": self.player_name,
            "franchise_id": self.franchise_id,
            "team_code": self.team_code,
            "season": self.season,
            "decade": self.decade,
            "games_played": self.games_played,
            "via": self.via,
        }


@dataclass(frozen=True)
class ScoringCard:
    """The season a drafted identity is actually SCORED on: their best PEAK3
    season anywhere in the NBA during the drafted decade.

    `resolve_team_id` is the single real team code to hand
    `exact_season.resolve_player_season_card`. It differs from `team_code`
    only for a traded season, where `team_code` is the aggregate token and
    `resolve_team_id` is the stint the player played the most games for.
    """

    player_slug: str
    player_name: str
    season: str
    season_start: int
    decade: str
    team_code: str
    resolve_team_id: str
    prime_score: float
    is_multi_team_season: bool
    formula_version: str

    @property
    def score_source(self) -> str:
        """Mirrors `exact_season.PlayerSeasonCard.score_source`'s taxonomy so
        a caller can label the number without a second lookup."""
        return "exact_season_aggregate" if self.is_multi_team_season else "exact_team_stint"

    def as_dict(self) -> dict:
        return {
            "player_slug": self.player_slug,
            "player_name": self.player_name,
            "season": self.season,
            "decade": self.decade,
            "team_code": self.team_code,
            "resolve_team_id": self.resolve_team_id,
            "prime_score": self.prime_score,
            "is_multi_team_season": self.is_multi_team_season,
            "score_source": self.score_source,
            "formula_version": self.formula_version,
        }


@dataclass(frozen=True)
class EligibilityIndex:
    """Immutable franchise x decade eligibility index.

    Built once per process (see `get_index`) and then read-only, so the
    platform layer can share one across every concurrent match without
    copying or locking.
    """

    index_version: str
    formula_version: str
    # (franchise_id, decade) -> the identities eligible for that roll.
    _by_roll: dict[tuple[str, str], frozenset[str]]
    # (player_slug, franchise_id, decade) -> the seasons that prove it.
    _evidence: dict[tuple[str, str, str], tuple[Appearance, ...]]
    # (player_slug, decade) -> best PEAK3 season of that decade.
    _scoring: dict[tuple[str, str], ScoringCard]
    _names: dict[str, str]

    # -- eligibility -------------------------------------------------------
    def eligible_slugs(self, franchise_id: str, decade: str) -> frozenset[str]:
        """Every identity eligible for this franchise x decade roll. Empty
        frozenset for a combination that never existed (e.g. Raptors x
        1980s) -- callers must treat empty as "not a rollable combination",
        never as an error."""
        return self._by_roll.get((franchise_id, decade), frozenset())

    def is_eligible(self, player_slug: str, franchise_id: str, decade: str) -> bool:
        return player_slug in self.eligible_slugs(franchise_id, decade)

    def evidence(self, player_slug: str, franchise_id: str, decade: str) -> tuple[Appearance, ...]:
        """The real seasons proving this eligibility, earliest first. Empty
        when not eligible."""
        return self._evidence.get((player_slug, franchise_id, decade), ())

    # -- scoring -----------------------------------------------------------
    def scoring_card(self, player_slug: str, decade: str) -> Optional[ScoringCard]:
        """This identity's best PEAK3 season of the decade, anywhere in the
        NBA. None when they have no scored season in it -- which, by
        construction, also means they are not eligible in it."""
        return self._scoring.get((player_slug, decade))

    def player_name(self, player_slug: str) -> Optional[str]:
        return self._names.get(player_slug)

    # -- roll space --------------------------------------------------------
    def rolls(self) -> tuple[tuple[str, str], ...]:
        """Every (franchise_id, decade) with at least one eligible identity,
        in a stable sorted order (never dict-insertion order, which would
        make a seeded roll depend on file layout)."""
        return tuple(sorted(self._by_roll))

    def roll_sizes(self) -> dict[tuple[str, str], int]:
        return {roll: len(slugs) for roll, slugs in self._by_roll.items()}


# ---------------------------------------------------------------------------
# Building the index
# ---------------------------------------------------------------------------

def _load_all_seasons(path: Path | None = None) -> list[dict]:
    load_path = path or ALL_SEASONS_PATH
    if not load_path.exists():
        raise FileNotFoundError(f"{load_path} missing -- broken checkout (this file is committed).")
    return json.loads(load_path.read_text()).get("rows", [])


def _load_traded_stints(path: Path | None = None) -> dict[str, list[dict]]:
    """`"{player_slug}|{season}"` -> that season's real per-team stints.

    A missing file degrades to an empty map rather than raising: every traded
    season then simply contributes no franchise evidence, which is a smaller,
    clearly-labelled gap than refusing to build the index at all.
    """
    load_path = path or TRADED_STINTS_PATH
    if not load_path.exists():
        return {}
    try:
        return json.loads(load_path.read_text()).get("stints_by_player_season", {}) or {}
    except (OSError, ValueError):
        return {}


def _best_stint_team(stints: list[dict]) -> Optional[str]:
    """The team the player played the most games for that season.

    Ties are broken by team code, so the choice is deterministic and
    reproducible instead of depending on the order rows happen to appear in
    the file. Returns None if no stint carries a usable team code.
    """
    best_games: float = -1.0
    best_team: Optional[str] = None
    for stint in stints:
        team = str(stint.get("team_id") or "").strip().upper()
        if not team or team in MULTI_TEAM_CODES:
            continue
        games = float(stint.get("games") or 0.0)
        if best_team is None or games > best_games or (games == best_games and team < best_team):
            best_games, best_team = games, team
    return best_team


def _build_appearances(
    all_seasons_path: Path | None = None,
    traded_stints_path: Path | None = None,
) -> list[Appearance]:
    """Every (identity, franchise, season) appearance in the supported window.

    Direct single-team rows contribute themselves; multi-team aggregate rows
    contribute one appearance per real stint. A row whose team code resolves
    to no franchise (an unknown code, or an aggregate with no stint data) is
    dropped rather than guessed at.
    """
    rows = _load_all_seasons(all_seasons_path)
    stints_by_key = _load_traded_stints(traded_stints_path)

    out: list[Appearance] = []
    for row in rows:
        player_slug = row.get("player_slug")
        season = row.get("season")
        if not player_slug or not season:
            continue
        start = season_start_year(season)
        if start < MIN_SEASON_START:
            continue
        decade = decade_label(start)
        if decade is None:
            continue
        name = row.get("player") or player_slug
        team = str(row.get("team") or "").strip().upper()

        if team in MULTI_TEAM_CODES:
            for stint in stints_by_key.get(f"{player_slug}|{season}", []):
                stint_team = str(stint.get("team_id") or "").strip().upper()
                franchise_id = franchise_for_team_code(stint_team)
                if franchise_id is None:
                    continue
                out.append(
                    Appearance(
                        player_slug=player_slug,
                        player_name=name,
                        franchise_id=franchise_id,
                        team_code=stint_team,
                        season=season,
                        season_start=start,
                        decade=decade,
                        games_played=(
                            float(stint["games"]) if stint.get("games") is not None else None
                        ),
                        via=APPEARANCE_TRADED_STINT,
                    )
                )
            continue

        franchise_id = franchise_for_team_code(team)
        if franchise_id is None:
            continue
        out.append(
            Appearance(
                player_slug=player_slug,
                player_name=name,
                franchise_id=franchise_id,
                team_code=team,
                season=season,
                season_start=start,
                decade=decade,
                games_played=(
                    float(row["games_played"]) if row.get("games_played") is not None else None
                ),
                via=APPEARANCE_DIRECT,
            )
        )
    return out


def _build_scoring_cards(
    identity_slugs: set[str],
    names: dict[str, str],
    traded_stints_path: Path | None = None,
    scored_path: Path | None = None,
) -> dict[tuple[str, str], ScoringCard]:
    """(player_slug, decade) -> best PEAK3 season of that decade.

    Reads `prime_score` straight off the official scored table. No score is
    computed, adjusted or approximated here -- this is `idxmax` over numbers
    PEAK3 already produced.
    """
    import pandas as pd  # local import: keeps `import nba_peak...` cheap

    load_path = scored_path or SCORED_PATH
    if not load_path.exists():
        raise FileNotFoundError(f"{load_path} missing -- broken checkout.")

    frame = pd.read_parquet(
        load_path, columns=["player", "team", "season", "season_start", "prime_score"]
    )
    frame = frame.assign(player_slug=frame["player"].map(slug))
    frame = frame[
        frame["player_slug"].isin(identity_slugs)
        & (frame["season_start"] >= MIN_SEASON_START)
        & frame["prime_score"].notna()
    ]
    if frame.empty:
        return {}

    frame = frame.assign(decade=frame["season_start"].map(lambda y: decade_label(int(y))))
    frame = frame[frame["decade"].notna()]
    if frame.empty:
        return {}

    stints_by_key = _load_traded_stints(traded_stints_path)

    # Sort so `drop_duplicates(keep="first")` picks the highest score, with
    # season as a deterministic tie-break -- `idxmax` alone would resolve an
    # exact tie by row order, which is file layout, not a rule.
    frame = frame.sort_values(
        ["player_slug", "decade", "prime_score", "season"], ascending=[True, True, False, True]
    )
    best = frame.drop_duplicates(subset=["player_slug", "decade"], keep="first")

    out: dict[tuple[str, str], ScoringCard] = {}
    for record in best.itertuples(index=False):
        team_code = str(record.team).strip().upper()
        is_multi = team_code in MULTI_TEAM_CODES
        if is_multi:
            resolve_team = _best_stint_team(
                stints_by_key.get(f"{record.player_slug}|{record.season}", [])
            )
            # A traded season we cannot pin to any real team cannot be turned
            # into a PlayerSeasonCard, so it cannot be a scoring card. Skipped
            # rather than resolved to the aggregate token, which
            # `resolve_player_season_card` would reject anyway.
            if resolve_team is None:
                continue
        else:
            resolve_team = team_code
            if franchise_for_team_code(resolve_team) is None:
                continue

        out[(record.player_slug, record.decade)] = ScoringCard(
            player_slug=record.player_slug,
            player_name=names.get(record.player_slug, record.player),
            season=record.season,
            season_start=int(record.season_start),
            decade=record.decade,
            team_code=team_code,
            resolve_team_id=resolve_team,
            prime_score=float(record.prime_score),
            is_multi_team_season=is_multi,
            formula_version=FORMULA_VERSION,
        )
    return out


def build_index(
    all_seasons_path: Path | None = None,
    traded_stints_path: Path | None = None,
    scored_path: Path | None = None,
) -> EligibilityIndex:
    """Build the full franchise x decade eligibility index from committed data.

    Path arguments exist for tests that want a small synthetic universe; the
    defaults are the real committed files and involve no network access.
    """
    appearances = _build_appearances(all_seasons_path, traded_stints_path)

    names: dict[str, str] = {}
    for appearance in appearances:
        names.setdefault(appearance.player_slug, appearance.player_name)

    scoring = _build_scoring_cards(
        identity_slugs=set(names),
        names=names,
        traded_stints_path=traded_stints_path,
        scored_path=scored_path,
    )

    by_roll: dict[tuple[str, str], set[str]] = {}
    evidence: dict[tuple[str, str, str], list[Appearance]] = {}
    for appearance in appearances:
        # Eligibility requires a scoring card in the SAME decade -- an
        # identity with nothing to score in that decade has nothing to draft.
        # See the module docstring's "unscored identities" note.
        if (appearance.player_slug, appearance.decade) not in scoring:
            continue
        roll = (appearance.franchise_id, appearance.decade)
        by_roll.setdefault(roll, set()).add(appearance.player_slug)
        evidence.setdefault(
            (appearance.player_slug, appearance.franchise_id, appearance.decade), []
        ).append(appearance)

    return EligibilityIndex(
        index_version=ELIGIBILITY_INDEX_VERSION,
        formula_version=FORMULA_VERSION,
        _by_roll={roll: frozenset(slugs) for roll, slugs in by_roll.items()},
        _evidence={
            key: tuple(sorted(items, key=lambda a: (a.season, a.team_code)))
            for key, items in evidence.items()
        },
        _scoring=scoring,
        _names=names,
    )


@lru_cache(maxsize=1)
def get_index() -> EligibilityIndex:
    """The process-wide index built from the real committed data.

    Cached because building it reads a 5MB parquet and a 13.6k-row JSON; the
    result is immutable, so one instance is safely shared by every match.
    Tests that need a different universe call `build_index` directly rather
    than mutating this one.
    """
    return build_index()


def clear_cache() -> None:
    """Drop the process-wide index -- for tests that patch the source paths."""
    get_index.cache_clear()


def all_franchise_ids() -> tuple[str, ...]:
    """Every franchise this game can roll, in stable sorted order."""
    return tuple(sorted(FRANCHISES))


def all_decades() -> tuple[str, ...]:
    return tuple(DECADES)


__all__ = [
    "ALL_SEASONS_PATH",
    "APPEARANCE_DIRECT",
    "APPEARANCE_TRADED_STINT",
    "Appearance",
    "EligibilityIndex",
    "MULTI_TEAM_CODES",
    "SCORED_PATH",
    "ScoringCard",
    "TRADED_STINTS_PATH",
    "all_decades",
    "all_franchise_ids",
    "build_index",
    "clear_cache",
    "get_index",
    "slug",
]
