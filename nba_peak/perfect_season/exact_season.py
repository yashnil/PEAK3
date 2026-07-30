"""Exact player-season card resolution for PEAK Season / CourtBuilder team-year mode.

Phase 6C fix: team-year ("82-0") mode rolls an exact team + exact season and
must resolve a selected candidate to that EXACT player-season -- never to the
player's career-best peak window (that substitution was the root cause of the
"2017-18 Warriors KD resolves to 2013-14 KD" bug). This module is intentionally
independent of nba_peak.lineup.board.resolve_card()/card_profiles.v3.json,
which store one row per (player_slug, duration_years) -- the player's single
best career peak window, not a per-season record. Nothing here is used by
Peak Draft or the team+decade/exact_team_season legacy CourtBuilder path.

Data sources (both already local/committed, no network access -- see
docs/implementation/CI_DATA_CONTRACT.md):
  cache/processed/regular_1980_2026.parquet  raw per-team-season roster
                                              membership + games/minutes/
                                              position, 1979-80..2025-26.
  cache/processed/scored_1980_2026.parquet   official PEAK3 per-season score
                                              (prime_score) for player-seasons
                                              that clear the model's minutes
                                              threshold (peak3.py
                                              regular_minutes_threshold). A
                                              real rostermate below that
                                              threshold has NO score here --
                                              reported honestly via
                                              score_status, never fabricated
                                              or substituted with a career
                                              peak value.

Phase 7A Part A fix: regular_1980_2026.parquet records a single aggregate
"2TM"/"3TM" row for a player traded mid-season, without a per-team split of
games/minutes -- resolve_player_season_card() cannot resolve such a player
to a single exact team from that table alone. This is now closed with a
real, live-fetched supplementary source:
  data/game/experimental/player_pool_1500/traded_player_team_stints.v1.json
    (scripts/backfill_traded_player_team_stints.py) -- individual per-team
    rows parsed directly off basketball-reference.com's leaguewide
    per-game table (which lists both the aggregate AND the per-team splits
    for a traded player), never fabricated.
When a (player, team, season) resolves via this supplementary source
instead of a direct regular_1980_2026.parquet row, the season SCORE is
still only available at the season-aggregate grain (PEAK3's scoring
pipeline computes one prime_score per player-season, not a fractional
team-stint score) -- `score_source` on the resulting card tells the
caller which case applies:
  exact_team_stint        -- normal case, a real single-team row exists.
  exact_season_aggregate   -- real team-stint membership (traded-player
                              backfill), but the score shown is the whole
                              season's aggregate score, not team-specific.
  roster_only_unscored     -- team-stint membership known, but no score
                              exists at all (below the model's minutes
                              threshold even in aggregate).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

REGULAR_PATH = REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet"
SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
FINAL_250_PATH = REPO_ROOT / "data" / "generated" / "final_250_candidates.csv"
MANIFEST_1500_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "candidate_identity_manifest.v1.json"
)
TRADED_STINTS_PATH = (
    REPO_ROOT / "data" / "game" / "experimental" / "player_pool_1500" / "traded_player_team_stints.v1.json"
)

EXACT_SEASON_ROSTER_SOURCE = "cache/processed/regular_1980_2026.parquet"
EXACT_SEASON_SCORE_SOURCE = "cache/processed/scored_1980_2026.parquet (prime_score, official PEAK3 formula)"

# Real, publicly documented NBA franchise names for every Basketball-Reference
# team code that appears in regular_1980_2026.parquet (1979-80..2025-26),
# including relocated/renamed franchises. Naming only -- no stats, rosters,
# or scores are represented here.
TEAM_ID_TO_NAME: dict[str, str] = {
    "ATL": "Atlanta Hawks",
    "BOS": "Boston Celtics",
    "BRK": "Brooklyn Nets",
    "CHA": "Charlotte Bobcats",
    "CHH": "Charlotte Hornets",
    "CHI": "Chicago Bulls",
    "CHO": "Charlotte Hornets",
    "CLE": "Cleveland Cavaliers",
    "DAL": "Dallas Mavericks",
    "DEN": "Denver Nuggets",
    "DET": "Detroit Pistons",
    "GSW": "Golden State Warriors",
    "HOU": "Houston Rockets",
    "IND": "Indiana Pacers",
    "KCK": "Kansas City Kings",
    "LAC": "Los Angeles Clippers",
    "LAL": "Los Angeles Lakers",
    "MEM": "Memphis Grizzlies",
    "MIA": "Miami Heat",
    "MIL": "Milwaukee Bucks",
    "MIN": "Minnesota Timberwolves",
    "NJN": "New Jersey Nets",
    "NOH": "New Orleans Hornets",
    "NOK": "New Orleans/Oklahoma City Hornets",
    "NOP": "New Orleans Pelicans",
    "NYK": "New York Knicks",
    "OKC": "Oklahoma City Thunder",
    "ORL": "Orlando Magic",
    "PHI": "Philadelphia 76ers",
    "PHO": "Phoenix Suns",
    "POR": "Portland Trail Blazers",
    "SAC": "Sacramento Kings",
    "SAS": "San Antonio Spurs",
    "SDC": "San Diego Clippers",
    "SEA": "Seattle SuperSonics",
    "TOR": "Toronto Raptors",
    "UTA": "Utah Jazz",
    "VAN": "Vancouver Grizzlies",
    "WAS": "Washington Wizards",
    "WSB": "Washington Bullets",
}

# Rows with these team codes are multi-team aggregates (a player traded
# mid-season), not a real single-team-season membership -- never resolvable
# to one exact team via this table. See module docstring's "known limitation".
_MULTI_TEAM_CODES = {"2TM", "3TM", "4TM", "5TM", "TOT"}


def slug(name: str) -> str:
    """ASCII-folded, hyphenated player slug -- same convention as
    scripts/build_web_dataset.py::slug and scripts/audit_player_pool_expansion.py::_slug."""
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


_REGULAR_CACHE: Optional[pd.DataFrame] = None
_SCORED_CACHE: Optional[pd.DataFrame] = None
_CANONICAL_250_CACHE: Optional[set[str]] = None
_MANIFEST_1500_CACHE: Optional[set[str]] = None
_SCORED_AGGREGATE_CACHE: Optional[pd.DataFrame] = None
_TRADED_STINTS_CACHE: Optional[dict[tuple[str, str, str], dict]] = None


def _load_regular(path: Path | None = None) -> pd.DataFrame:
    global _REGULAR_CACHE
    if path is None and _REGULAR_CACHE is not None:
        return _REGULAR_CACHE
    load_path = path or REGULAR_PATH
    if not load_path.exists():
        raise FileNotFoundError(f"{load_path} missing -- broken checkout (this file is committed).")
    df = pd.read_parquet(load_path)
    df = df[~df["team"].isin(_MULTI_TEAM_CODES)].copy()
    df["player_slug"] = df["player"].map(slug)
    if path is None:
        _REGULAR_CACHE = df
    return df


def _load_scored(path: Path | None = None) -> pd.DataFrame:
    global _SCORED_CACHE
    if path is None and _SCORED_CACHE is not None:
        return _SCORED_CACHE
    load_path = path or SCORED_PATH
    if not load_path.exists():
        raise FileNotFoundError(f"{load_path} missing -- broken checkout (this file is committed).")
    df = pd.read_parquet(load_path)
    df = df[~df["team"].isin(_MULTI_TEAM_CODES)].copy()
    df["player_slug"] = df["player"].map(slug)
    if path is None:
        _SCORED_CACHE = df
    return df


def _load_scored_aggregate(path: Path | None = None) -> pd.DataFrame:
    """The OPPOSITE filter from _load_scored(): keeps ONLY the multi-team
    aggregate rows -- used exclusively as the score fallback for a traded
    player resolved via the traded-stints supplement (see module docstring's
    score_source taxonomy). Never used for a normal single-team lookup."""
    global _SCORED_AGGREGATE_CACHE
    if path is None and _SCORED_AGGREGATE_CACHE is not None:
        return _SCORED_AGGREGATE_CACHE
    load_path = path or SCORED_PATH
    if not load_path.exists():
        raise FileNotFoundError(f"{load_path} missing -- broken checkout (this file is committed).")
    df = pd.read_parquet(load_path)
    df = df[df["team"].isin(_MULTI_TEAM_CODES)].copy()
    df["player_slug"] = df["player"].map(slug)
    if path is None:
        _SCORED_AGGREGATE_CACHE = df
    return df


def _load_traded_stints(path: Path | None = None) -> dict[tuple[str, str, str], dict]:
    """(player_slug, team_id, season) -> real per-team stint dict, from
    scripts/backfill_traded_player_team_stints.py's output. Empty dict
    (not an error) if the file hasn't been generated yet -- traded-player
    resolution simply falls back to the pre-existing None-for-unresolvable
    behavior in that case."""
    global _TRADED_STINTS_CACHE
    if path is None and _TRADED_STINTS_CACHE is not None:
        return _TRADED_STINTS_CACHE
    load_path = path or TRADED_STINTS_PATH
    result: dict[tuple[str, str, str], dict] = {}
    if load_path.exists():
        data = json.loads(load_path.read_text())
        for stints in data.get("stints_by_player_season", {}).values():
            for s in stints:
                key = (s["player_slug"], s["team_id"], s["season"])
                result[key] = s
    if path is None:
        _TRADED_STINTS_CACHE = result
    return result


def _load_canonical_250_slugs(path: Path | None = None) -> set[str]:
    global _CANONICAL_250_CACHE
    if path is None and _CANONICAL_250_CACHE is not None:
        return _CANONICAL_250_CACHE
    load_path = path or FINAL_250_PATH
    if not load_path.exists():
        result: set[str] = set()
    else:
        names = pd.read_csv(load_path)["player"].astype(str)
        result = {slug(n) for n in names}
    if path is None:
        _CANONICAL_250_CACHE = result
    return result


def _load_1500_pool_slugs(path: Path | None = None) -> set[str]:
    """Reads the experimental 1500-identity manifest if present. Purely
    read-only classification input -- never mutated, never treated as a
    canonical replacement (manifest's own `status` field says so)."""
    global _MANIFEST_1500_CACHE
    if path is None and _MANIFEST_1500_CACHE is not None:
        return _MANIFEST_1500_CACHE
    load_path = path or MANIFEST_1500_PATH
    if not load_path.exists():
        result: set[str] = set()
    else:
        data = json.loads(load_path.read_text())
        result = {i["player_slug"] for i in data.get("identities", [])}
    if path is None:
        _MANIFEST_1500_CACHE = result
    return result


def clear_caches() -> None:
    """Clear all module-level caches (used in tests)."""
    global _REGULAR_CACHE, _SCORED_CACHE, _CANONICAL_250_CACHE, _MANIFEST_1500_CACHE
    global _SCORED_AGGREGATE_CACHE, _TRADED_STINTS_CACHE
    _REGULAR_CACHE = None
    _SCORED_CACHE = None
    _CANONICAL_250_CACHE = None
    _MANIFEST_1500_CACHE = None
    _SCORED_AGGREGATE_CACHE = None
    _TRADED_STINTS_CACHE = None


@dataclass(frozen=True)
class PlayerSeasonCard:
    """A player on one specific team in one specific season -- e.g. Kevin
    Durant, Golden State Warriors, 2017-18. Distinct from
    nba_peak.lineup.schemas.CardProfile (a player's best career PEAK WINDOW
    for a given duration, e.g. "Kevin Durant 2013-14 1Y peak"). A
    PeakWindowCard is never substituted for a PlayerSeasonCard in team-year
    mode -- see nba_peak/perfect_season/board.py's generate_team_year_board.
    """

    exact_player_season_key: str  # {player_slug}-{team_id_lower}-{season_nodash}
    player_slug: str
    player_name: str
    team_id: str
    team_name: str
    season: str
    season_label: str
    games_played: Optional[float]
    minutes_per_game: Optional[float]
    # Phase 8K: games started, direct-row resolution only ("GS" column in
    # regular_1980_2026.parquet) -- None for the traded-stint fallback path
    # (traded_player_team_stints.v1.json carries no starts field). Used only
    # to grade PROVISIONAL simulation impact for unscored cards (never the
    # official score) -- a 6-game, 0-start card is real roster-only depth,
    # not a rotation player, and simulate_exact_season should not treat it
    # as a neutral unknown.
    games_started: Optional[float]
    position: Optional[str]
    identity_pool_status: str  # canonical_250 | qualifies_1500 | team_year_roster_only
    score_status: str  # exact_season_scored | exact_season_unscored
    season_score: Optional[float]
    source_provenance: str
    # Phase 7A Part A: exact_team_stint | exact_season_aggregate |
    # roster_only_unscored -- see module docstring's taxonomy. Always
    # "exact_team_stint" for every card resolved before this field existed
    # (the normal, non-traded case).
    score_source: str = "exact_team_stint"


def resolve_player_season_card(
    player_slug_value: str,
    team_id: str,
    season: str,
    regular_path: Path | None = None,
    scored_path: Path | None = None,
    canonical_250_path: Path | None = None,
    manifest_1500_path: Path | None = None,
) -> Optional[PlayerSeasonCard]:
    """Resolve an EXACT player-season -- never a different season, never a
    different team, never a career-peak substitute.

    Returns None if no real roster row exists for (player_slug_value,
    team_id, season) in EITHER regular_1980_2026.parquet OR the traded-
    player team-stints supplement -- callers must treat this as "not a
    real candidate for this exact team-season", never fall back to a
    different season/team/peak-window card.

    Two resolution paths (see PlayerSeasonCard.score_source and the module
    docstring's taxonomy):
      1. A direct regular_1980_2026.parquet row exists (the normal,
         non-traded case) -- score_source="exact_team_stint".
      2. No direct row, but the player has a real per-team stint for this
         exact team-season in traded_player_team_stints.v1.json (Phase 7A
         Part A) -- the season SCORE (if any) comes from the multi-team
         aggregate row instead, since PEAK3 only computes one score per
         player-season -- score_source="exact_season_aggregate" or
         "roster_only_unscored" if even the aggregate has no score.
    """
    regular = _load_regular(regular_path)
    rows = regular[
        (regular["player_slug"] == player_slug_value)
        & (regular["team"] == team_id)
        & (regular["season"] == season)
    ]

    if not rows.empty:
        row = rows.iloc[0]
        games_played = float(row["g"]) if pd.notna(row["g"]) else None
        minutes_total = float(row["mp"]) if pd.notna(row["mp"]) else None
        minutes_per_game = (minutes_total / games_played) if (games_played and minutes_total is not None) else None
        games_started = float(row["GS"]) if pd.notna(row.get("GS")) else None
        position = str(row["pos"]) if pd.notna(row.get("pos")) else None
        player_name = str(row["player"])
        score_source = "exact_team_stint"

        scored = _load_scored(scored_path)
        srows = scored[
            (scored["player_slug"] == player_slug_value)
            & (scored["team"] == team_id)
            & (scored["season"] == season)
        ]
        if not srows.empty:
            srow = srows.iloc[0]
            score_status = "exact_season_scored"
            season_score = float(srow["prime_score"])
            if pd.notna(srow.get("mpg")):
                minutes_per_game = float(srow["mpg"])
            source_provenance = f"{EXACT_SEASON_ROSTER_SOURCE}; {EXACT_SEASON_SCORE_SOURCE}"
        else:
            score_status = "exact_season_unscored"
            season_score = None
            source_provenance = (
                f"{EXACT_SEASON_ROSTER_SOURCE} only -- below the PEAK3 model's minutes "
                "threshold for this season, so no official score exists (not fabricated, "
                "not substituted with a career-peak value)."
            )
    else:
        stints = _load_traded_stints()
        stint = stints.get((player_slug_value, team_id, season))
        if stint is None:
            return None

        games_played = stint.get("games")
        minutes_total = stint.get("minutes_total_estimate")
        minutes_per_game = (minutes_total / games_played) if (games_played and minutes_total) else None
        # No starts field in the traded-stint supplement -- honestly unknown,
        # never guessed.
        games_started = None
        position = stint.get("position")
        player_name = stint["player_name"]
        score_source = "roster_only_unscored"

        agg_scored = _load_scored_aggregate(scored_path)
        arows = agg_scored[
            (agg_scored["player_slug"] == player_slug_value) & (agg_scored["season"] == season)
        ]
        if not arows.empty:
            arow = arows.iloc[0]
            score_status = "exact_season_scored"
            season_score = float(arow["prime_score"])
            score_source = "exact_season_aggregate"
            source_provenance = (
                f"traded_player_team_stints.v1.json (real {team_id} stint, {games_played:.0f} games, "
                f"fetched live from basketball-reference.com's leaguewide per-game table); score is "
                f"the {season} SEASON AGGREGATE (PEAK3 computes one score per player-season, not a "
                f"team-specific fraction) -- not {team_id}-specific."
            )
        else:
            score_status = "exact_season_unscored"
            season_score = None
            source_provenance = (
                f"traded_player_team_stints.v1.json (real {team_id} stint, {games_played:.0f} games) -- "
                "no aggregate season score exists either (below the PEAK3 model's minutes threshold "
                "even combined across teams)."
            )

    canon = _load_canonical_250_slugs(canonical_250_path)
    pool1500 = _load_1500_pool_slugs(manifest_1500_path)
    if player_slug_value in canon:
        identity_pool_status = "canonical_250"
    elif player_slug_value in pool1500:
        identity_pool_status = "qualifies_1500"
    else:
        identity_pool_status = "team_year_roster_only"

    season_nodash = season.replace("-", "")
    exact_key = f"{player_slug_value}-{team_id.lower()}-{season_nodash}"

    return PlayerSeasonCard(
        exact_player_season_key=exact_key,
        player_slug=player_slug_value,
        player_name=str(player_name),
        team_id=team_id,
        team_name=TEAM_ID_TO_NAME.get(team_id, team_id),
        season=season,
        season_label=season,
        games_played=games_played,
        minutes_per_game=round(minutes_per_game, 1) if minutes_per_game is not None else None,
        games_started=games_started,
        position=position,
        identity_pool_status=identity_pool_status,
        score_status=score_status,
        season_score=season_score,
        source_provenance=source_provenance,
        score_source=score_source,
    )


def resolve_exact_card_by_key(
    exact_player_season_key: str,
    regular_path: Path | None = None,
    scored_path: Path | None = None,
    canonical_250_path: Path | None = None,
    manifest_1500_path: Path | None = None,
) -> Optional[PlayerSeasonCard]:
    """Re-resolve a PlayerSeasonCard from its own key
    ({player_slug}-{team_id_lower}-{season_nodash}), e.g. for re-fetching an
    already-placed slot's card. Parses from the right: team_id is always
    alphabetic (no digits, no hyphens) and season_nodash is always exactly 6
    digits, so `key.rsplit("-", 2)` unambiguously recovers
    (player_slug, team_id, season) even though player_slug itself may
    contain hyphens."""
    parts = exact_player_season_key.rsplit("-", 2)
    if len(parts) != 3:
        return None
    player_slug_value, team_lower, season_nodash = parts
    if len(season_nodash) != 6 or not season_nodash.isdigit():
        return None
    season = f"{season_nodash[:4]}-{season_nodash[4:]}"
    return resolve_player_season_card(
        player_slug_value,
        team_lower.upper(),
        season,
        regular_path=regular_path,
        scored_path=scored_path,
        canonical_250_path=canonical_250_path,
        manifest_1500_path=manifest_1500_path,
    )


_CONTRIB_PERCENTILE_CACHE: dict[str, pd.Series] = {}

_CONTRIB_COLUMNS = (
    "contrib_statistical_impact",
    "contrib_traditional_production",
    "contrib_recognition",
    "contrib_postseason",
    "contrib_team_achievement",
)


def component_percentile(player_slug_value: str, team_id: str, season: str, column: str) -> Optional[float]:
    """0-100 percentile rank of one player-season's real PEAK3 component
    contribution (`column`, one of _CONTRIB_COLUMNS -- official per-season
    values already computed by peak3.py's formula, never recomputed here)
    against the full scored_1980_2026.parquet distribution for that column.

    This is a real, reproducible statistic over real data -- used as an
    honestly-labeled prototype substitute for the calibrated LineupDNA scale
    Peak Draft's card_profiles.v3.json uses (which is fit at the career-
    peak-window grain, not available per single season). Returns None if the
    player-season is unscored or the column is unavailable.
    """
    if column not in _CONTRIB_COLUMNS:
        raise ValueError(f"Unknown component column '{column}'")
    scored = _load_scored()
    if column not in scored.columns:
        return None
    if column not in _CONTRIB_PERCENTILE_CACHE:
        # Ranked against BOTH individual-team rows and multi-team aggregate
        # rows together (one shared distribution) -- a traded player's
        # aggregate-row percentile must be comparable to a non-traded
        # player's individual-row percentile, not ranked against a
        # different population (Phase 7A Part A).
        agg_all = _load_scored_aggregate()
        combined = pd.concat([scored, agg_all]) if column in agg_all.columns else scored
        ranked = combined[column].rank(pct=True) * 100.0
        _CONTRIB_PERCENTILE_CACHE[column] = ranked
    rows = scored[
        (scored["player_slug"] == player_slug_value)
        & (scored["team"] == team_id)
        & (scored["season"] == season)
    ]
    if rows.empty:
        # Phase 7A Part A: a traded player's card resolves with
        # score_source="exact_season_aggregate" (see resolve_player_season_card)
        # -- its component percentiles come from that same aggregate row
        # instead of silently dropping out of the lineup-fit average.
        agg = _load_scored_aggregate()
        rows = agg[
            (agg["player_slug"] == player_slug_value)
            & (agg["season"] == season)
        ]
        if rows.empty:
            return None
    idx = rows.index[0]
    pct = _CONTRIB_PERCENTILE_CACHE[column].get(idx)
    return float(pct) if pct is not None and pd.notna(pct) else None


def team_season_roster_slugs(
    team_id: str,
    season: str,
    meaningful_minutes_floor: float = 50.0,
    regular_path: Path | None = None,
) -> list[str]:
    """Every real rostermate's player_slug for an exact team-season, sorted
    by minutes played descending. Used to build/validate the team-year spin
    dataset -- never filtered by canonical-250/1500-pool membership (a real
    rostermate is a real candidate regardless of whether they qualify for
    those separate pools; see identity_pool_status on the resolved card)."""
    regular = _load_regular(regular_path)
    rows = regular[
        (regular["team"] == team_id)
        & (regular["season"] == season)
        & (regular["mp"] >= meaningful_minutes_floor)
    ].sort_values("mp", ascending=False)
    return rows["player_slug"].tolist()
