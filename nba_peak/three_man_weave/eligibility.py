"""Franchise x decade eligibility, and the scoring card that eligibility earns.

TWO SEPARATE CONCEPTS, BOTH BOUND TO THE ROLLED FRANCHISE AND DECADE
--------------------------------------------------------------------
1. ELIGIBILITY EVIDENCE -- "did this player appear for franchise F during
   decade D?" Tenure length is irrelevant: one real season for the Raptors in
   the 2010s makes Kawhi Leonard a legal Raptors x 2010s pick, exactly as a
   nine-year run would. Eligibility is a membership fact.

2. SCORING CARD -- "what is this player's best single-season PEAK3 score
   FOR THAT FRANCHISE, IN THAT DECADE?" The card is franchise-restricted, and
   that restriction is the rule rather than a refinement of one.

WHY THE CARD IS FRANCHISE-RESTRICTED (this changed, deliberately)
------------------------------------------------------------------
An earlier ruleset scored a pick on their best season ANYWHERE in the decade.
It produced a class of results that read as a bug however carefully they were
labelled: a Cleveland x 2010s Dwyane Wade was drafted on the evidence of his
real 2017-18 Cavaliers stint and then scored on 2010-11 MIAMI (76.5), because
that was his best season of the decade. The drafted card said Cleveland and
the number came from Miami. Whatever the surface printed beside it, the roster
that went into the evaluator was not the one the roll described.

So both questions now share the same two constraints. A card must belong to
the ROLLED franchise and the ROLLED decade:

  * Cleveland x 2010s Wade scores on 2017-18 CLE, not 2010-11 MIA.
  * Atlanta x 1990s Dominique Wilkins scores on an Atlanta season of the 1990s.
  * Sacramento x 2020s Tyrese Haliburton scores on a Sacramento season, never
    on a later Indiana one.

The eligibility SEASON and the scoring SEASON may still differ -- a player with
six Hawks seasons in the 1990s is scored on the best of them -- but both are
now Hawks seasons of the 1990s. Nothing is fabricated to make this work: a
franchise-decade with no scored season for a player simply makes that player
ineligible there (see "unscored identities" below).

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
number would not correspond to the team shown. That hazard is handled here
rather than avoided, because refusing stints outright would tell a player that
someone who demonstrably suited up for the Cavaliers did not:

  * The STINT is what establishes the franchise, so a traded season's card
    resolves to the ROLLED FRANCHISE'S OWN team code -- Wade's 2017-18 card on
    a Cleveland roll resolves to CLE. The card never carries another team's
    code, which is the specific failure this ruleset exists to close.

  * The SCORE for such a season exists only at whole-season aggregate grain,
    because PEAK3 computes one `prime_score` per player-season and not a
    fractional per-stint one. That number is real and complete -- the
    aggregate IS the season -- but it is not a Cleveland-only figure, so it is
    surfaced as `score_source="exact_season_aggregate"` and the surface labels
    it rather than presenting it as a single-team number.

Order of preference is therefore: a real single-team scored row for the rolled
franchise beats a traded season's aggregate, because the first is unambiguous.
An aggregate is used only when the franchise's own seasons offer nothing
better, and never in place of a different franchise's card. Nothing is
invented: if neither exists for a franchise-decade, the player is not eligible
there at all.

UNSCORED IDENTITIES
-------------------
An identity with no scored season FOR THAT FRANCHISE IN THAT DECADE has NO
scoring card there and is therefore NOT eligible there, however many games
they played. This is prevention at the source rather than a fabricated number
downstream: a player with nothing to score has nothing to draft. `evaluation`
still handles an unscored card defensively if one ever reaches it, and
surfaces the status instead of presenting 0.0 as a real result.

The rule bites in exactly the place it should. A ten-game cameo that never
cleared the model's minutes threshold no longer makes someone drafted off that
franchise and then scored on a different team's MVP season; it makes them
ineligible for that roll, which is the honest answer.
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
    season FOR THE ROLLED FRANCHISE, IN THE ROLLED DECADE.

    `franchise_id` is carried on the card rather than left to the caller to
    remember, because it is the constraint the card was chosen under. A card
    that could be read without knowing which franchise produced it is exactly
    the shape that let a Miami season be presented on a Cleveland roll.

    `resolve_team_id` is the single real team code to hand
    `exact_season.resolve_player_season_card`, and it always belongs to
    `franchise_id`. It differs from `team_code` only for a traded season, where
    `team_code` is the aggregate token the SCORE is recorded under while
    `resolve_team_id` is the rolled franchise's own code.
    """

    player_slug: str
    player_name: str
    franchise_id: str
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
            "franchise_id": self.franchise_id,
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
    # (player_slug, franchise_id, decade) -> best PEAK3 season FOR that
    # franchise in that decade. Keyed on the same triple as `_evidence`,
    # because the card answers a question about the same three things.
    _scoring: dict[tuple[str, str, str], ScoringCard]
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
    def scoring_card(
        self, player_slug: str, franchise_id: str, decade: str
    ) -> Optional[ScoringCard]:
        """This identity's best PEAK3 season FOR this franchise in this decade.

        None when they have no scored season for that franchise-decade --
        which, by construction, also means they are not eligible for that roll.

        The `franchise_id` argument is REQUIRED and has no default on purpose.
        A defaulted or optional franchise would let a caller silently ask the
        decade-wide question this ruleset no longer answers, which is how a
        Miami card ended up on a Cleveland roll.
        """
        return self._scoring.get((player_slug, franchise_id, decade))

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


def _scores_by_player_season(
    identity_slugs: set[str],
    scored_path: Path | None = None,
) -> dict[tuple[str, str], dict[str, float]]:
    """(player_slug, season) -> {team_code: prime_score} straight off PEAK3.

    Nested by team code rather than flattened to one number per season,
    because a season can be recorded under a real team code, under a
    multi-team aggregate token, or (in principle) both, and which one applies
    depends on the franchise being asked about. Collapsing them here would
    throw away exactly the distinction `_build_scoring_cards` needs.

    No score is computed, adjusted or approximated -- these are numbers PEAK3
    already produced, read from the committed scored table.
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

    out: dict[tuple[str, str], dict[str, float]] = {}
    for record in frame.itertuples(index=False):
        key = (record.player_slug, record.season)
        team_code = str(record.team).strip().upper()
        bucket = out.setdefault(key, {})
        score = float(record.prime_score)
        # `max` rather than overwrite: a duplicated row must not make the
        # answer depend on file order.
        if score > bucket.get(team_code, float("-inf")):
            bucket[team_code] = score
    return out


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
    appearances: list[Appearance],
    names: dict[str, str],
    scored_path: Path | None = None,
) -> dict[tuple[str, str, str], ScoringCard]:
    """(player_slug, franchise_id, decade) -> best PEAK3 season for that roll.

    DRIVEN BY THE APPEARANCES, NOT BY THE SCORED TABLE. That inversion is the
    whole correction. The old form asked the scored table for a player's best
    season of a decade and then attached whatever franchise came back, which
    is how a Miami row became a Cleveland card. This form starts from a real
    (player, franchise, season) membership fact and asks the scored table only
    what THAT season scored, so a card cannot name a franchise the player did
    not play for that year.

    Candidate order within a franchise-decade, best first:

      1. A real single-team scored row for the appearance's own team code --
         unambiguous, `score_source == "exact_team_stint"`.
      2. The season's multi-team aggregate, for a traded season where PEAK3
         only ever computed one whole-season number. Real and complete, but
         not a single-team figure, so it is marked
         `is_multi_team_season=True` and resolves to the ROLLED franchise's
         team code rather than to any other stint.

    A tie between two seasons is broken by the earlier season, so the choice
    is a rule rather than an artifact of row order. A single-team row always
    beats an aggregate of equal value, because the first is the more precise
    claim about the same thing.
    """
    scores = _scores_by_player_season(set(names), scored_path)

    #: (slug, franchise, decade) -> (sort key, card). The sort key orders on
    #: score first, then prefers an unambiguous single-team row, then the
    #: earlier season.
    best: dict[tuple[str, str, str], tuple[tuple, ScoringCard]] = {}

    for appearance in appearances:
        bucket = scores.get((appearance.player_slug, appearance.season))
        if not bucket:
            continue

        direct = bucket.get(appearance.team_code)
        if direct is not None:
            score, is_multi, recorded_team = direct, False, appearance.team_code
        else:
            aggregate = [
                (value, code)
                for code, value in bucket.items()
                if code in MULTI_TEAM_CODES
            ]
            if not aggregate:
                # A scored row exists for this player-season but under some
                # other team code and with no aggregate: that score belongs to
                # a different team, so it is not this franchise's to use.
                continue
            score, recorded_team = max(aggregate)
            is_multi = True

        key = (appearance.player_slug, appearance.franchise_id, appearance.decade)
        rank = (-float(score), 1 if is_multi else 0, appearance.season)
        existing = best.get(key)
        if existing is not None and existing[0] <= rank:
            continue

        best[key] = (
            rank,
            ScoringCard(
                player_slug=appearance.player_slug,
                player_name=names.get(appearance.player_slug, appearance.player_name),
                franchise_id=appearance.franchise_id,
                season=appearance.season,
                season_start=appearance.season_start,
                decade=appearance.decade,
                team_code=recorded_team,
                # ALWAYS the rolled franchise's own code. This is the line
                # that makes a Cleveland card resolve to CLE.
                resolve_team_id=appearance.team_code,
                prime_score=float(score),
                is_multi_team_season=is_multi,
                formula_version=FORMULA_VERSION,
            ),
        )

    return {key: card for key, (_rank, card) in best.items()}


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
        appearances=appearances,
        names=names,
        scored_path=scored_path,
    )

    by_roll: dict[tuple[str, str], set[str]] = {}
    evidence: dict[tuple[str, str, str], list[Appearance]] = {}
    for appearance in appearances:
        # Eligibility requires a scoring card for the SAME franchise and the
        # SAME decade -- an identity with nothing to score there has nothing
        # to draft there. See the module docstring's "unscored identities"
        # note; this is the exact condition that stops a roll offering someone
        # who could only be scored on another team's season.
        key = (appearance.player_slug, appearance.franchise_id, appearance.decade)
        if key not in scoring:
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
