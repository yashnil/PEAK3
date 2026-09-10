"""The Daily Grid answer universe: one record per exact NBA player-SEASON.

A grid answer is a player-SEASON, never a player identity -- "1999-00
Shaquille O'Neal", not "Shaquille O'Neal". That distinction drives every
choice here: the pool is keyed on (player, season, team), and every field a
constraint can test is read at that same grain.

Data sources -- all committed, all local, no network access at any point
(same contract as nba_peak/perfect_season/exact_season.py, see
docs/implementation/CI_DATA_CONTRACT.md):

  cache/processed/scored_1980_2026.parquet
      Official PEAK3 per-season output (prime_score + the five weighted
      components) plus the real award/postseason context columns the model
      already consumes: mvp_rank, dpoy_rank, all_nba_team, all_defense_team,
      all_star, championship, finals_mvp, finals_appearance, playoff_round.
      Phase 11C also reads the season-shape and league-leader columns already
      present on the same table: mpg, g, made_playoffs, and the five
      *_title flags (scoring/rebound/assist/blocks/steals). Nothing in this
      module derives, imputes, or back-fills any of them -- a season either
      has the field in this table or it is not eligible for the constraint
      that needs it.

      `smoy_rank`, `mip_rank` and `roy_rank` (Sixth Man of the Year / Most Improved
      Player) are the one exception to "already a column": the table carries
      no pre-parsed rank column for either award the way it does for
      mvp_rank/dpoy_rank, but it DOES carry the same raw `awards` string
      those were themselves parsed from (Basketball-Reference's Awards
      column, e.g. "MVP-13,MIP-1,6MOY-7"). `_award_rank()` below applies the
      identical `"{CODE}-(\\d+)"` ordinal-rank regex
      nba_peak.context.awards._rank uses for mvp_rank/dpoy_rank, read
      directly against that same committed column -- so this is the same
      data, sourced the same way, not a new pipeline or a fabricated field.

  cache/processed/regular_1980_2026.parquet
      Per-team-season roster rows; read for `pos`, the position the
      player actually logged that season, and for `age`, the player's age in
      that season. Season-grain position is the right source for a
      season-grain game -- deliberately NOT
      nba_peak/perfect_season/positions.py, whose three-tier model answers a
      different question ("what position is this player, career-wide") for
      CourtBuilder's lineup slots. `age` is the same shape of fact, read the
      same way, and is what the career-stage constraints test.

WHAT THE v4 TAXONOMY ADDED, AND WHY IT IS THE SAME DATA
The style/production constraints (nba_peak/daily_grid/constraints.py) read
`pts_per75`, `ast_per75`, `trb_per100`, `stl_per100`, `blk_per100`, `usg_pct`
and `ts_plus` -- all already columns on the scored table PEAK3 itself
consumes, none of them derived or estimated here. The per-100 columns are
converted to per-75 IN THE FRAME (a multiplication by 0.75 -- an exact unit
change on the same rate, not a re-estimate) so every rate constraint states
the same denominator and a player reading two of them is comparing like with
like.

`ts_plus` is used rather than raw `ts_pct` deliberately: true shooting
percentage rose league-wide by roughly ten points between 1979-80 and today,
so a fixed `ts_pct` threshold is a decade filter wearing an efficiency label.
`ts_plus` is already relative to the season's own league, which is the only
honest way to ask "was this an efficient season" across a 46-season window.

  data/reference/player_season_box.v1.parquet
  data/reference/player_bio.v1.json
      THE BASKETBALL-FACT LAYER (v5). PEAK3's own tables answer "how good was
      this season" extremely well and answer almost nothing about the PLAYER:
      they carry no height, no draft slot, no birth country, no franchise
      history, and rates per 100 possessions rather than the per-GAME line a
      fan actually quotes. The v5 Daily Grid taxonomy is built out of exactly
      those facts, so they are read from a committed reference dataset built by
      scripts/build_player_reference_dataset.py from Basketball-Reference --
      the same source the committed parquets above were themselves scraped
      from. See docs/model/DAILY_GRID_TAXONOMY.md for every field's definition
      and data/reference/player_reference_manifest.v1.json for its provenance.

      The season file joins on the exact (player_slug, season, team) key the
      rest of this module already uses and supplies the per-game box line
      (points/rebounds/assists/steals/blocks per game, three-pointers made) plus
      the Basketball-Reference player id for that row. The bio file is keyed on
      that id -- never on a name -- and supplies listed height, draft round and
      overall pick, birth country, and how many franchises and seasons the
      player's career ran to.

      NOTHING HERE IS INFERRED. A field the reference dataset does not have for
      a player is None, and every v5 constraint that reads it rejects the
      season rather than guessing: a null height fails "7'0\" or Taller", a
      null birth country fails "International Player", and a career that began
      before the 1979-80 window fails the career-shape constraints outright
      (see `career_fully_in_window`).

  data/game/experimental/player_pool_1500/candidate_identity_manifest.v1.json
      The 1,390 real, criteria-admitted player identities (All-Star / MVP or
      DPOY votes / All-Defense / championship-or-finals starter / minutes
      routes). Used as a RECOGNIZABILITY filter only: it decides who can
      appear as an answer, never what any of their numbers are. Without it
      the pool is 10.4k seasons of mostly deep-bench players, which makes a
      grid unguessable rather than hard.

Multi-team ("2TM"/"3TM"/"TOT") rows are dropped outright. Those are
season aggregates for a traded player, not a real single-team-season, and a
team constraint cannot be honestly evaluated against them. The traded-player
per-team-stint backfill that CourtBuilder uses is intentionally NOT pulled
in here: it resolves team membership but leaves the SCORE at season-aggregate
grain, and a grid cell displays a PEAK3 score next to a team badge. Rather
than show a score that does not correspond to the team shown, those stints
are simply absent from the answer universe. Documented as a known limitation
rather than papered over.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent.parent

SCORED_PATH = REPO_ROOT / "cache" / "processed" / "scored_1980_2026.parquet"
REGULAR_PATH = REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet"
REFERENCE_DIR = REPO_ROOT / "data" / "reference"
REFERENCE_SEASON_BOX_PATH = REFERENCE_DIR / "player_season_box.v1.parquet"
REFERENCE_BIO_PATH = REFERENCE_DIR / "player_bio.v1.json"

MANIFEST_PATH = (
    REPO_ROOT
    / "data"
    / "game"
    / "experimental"
    / "player_pool_1500"
    / "candidate_identity_manifest.v1.json"
)

# v4: carries the season-grain age, rate (per-75) and efficiency/usage columns
# the v4 constraint families read. Purely additive -- every column the v3 pool
# published is still here, unchanged, so a v2/v3 board generates identically.
# v5: carries the per-GAME box line and the career-identity columns (height,
# draft slot, birth country, franchise/season counts) the v5 basketball-native
# taxonomy reads. Purely additive -- every column the v4 pool published is
# still here, unchanged, so a v2/v3/v4 board generates identically.
POOL_VERSION = "daily_grid_pool.v5"

# The reference columns joined onto every pool row at SEASON grain, straight
# from data/reference/player_season_box.v1.parquet. Per-game, because that is
# the line a fan quotes -- "he averaged 25 a game" -- where the scored table
# carries only rates per 100 possessions.
_REFERENCE_SEASON_COLUMNS: tuple[str, ...] = (
    "bbref_id",
    "pts_pg",
    "trb_pg",
    "ast_pg",
    "stl_pg",
    "blk_pg",
    "fg3m",
)

# The reference columns joined at CAREER grain, from
# data/reference/player_bio.v1.json, keyed on the Basketball-Reference player
# id the season join above supplies. Career facts repeat on every one of a
# player's season rows: a Lakers season by a top-10 pick answers
# "Lakers x Top-10 Pick", which is how a grid game has always read.
#
# Stored as float rather than bool so a MISSING value stays missing. A boolean
# column has no room for "unknown", and NumPy would coerce it to False -- which
# is the difference between "we know he was not born abroad" and "we do not
# know where he was born", and only the first may reject an answer silently.
_REFERENCE_BIO_COLUMNS: tuple[str, ...] = (
    "height_in",
    "draft_round",
    "draft_pick_overall",
    "international",
    "undrafted",
    "franchise_count",
    "seasons_played",
    "career_fully_in_window",
)

# The league-leader flags on the scored table, in the order their labels are
# read out in a rejection sentence. Each is a real 0/1 column: the player led
# the league in that category that season.
STAT_TITLE_COLUMNS: tuple[tuple[str, str], ...] = (
    ("scoring_title", "scoring"),
    ("rebound_title", "rebounding"),
    ("assist_title", "assists"),
    ("blocks_title", "blocks"),
    ("steals_title", "steals"),
)

# The scored table's per-100 rate columns, and the per-75 name each becomes in
# the pool frame. x0.75 is an exact unit conversion on the same rate; see the
# module docstring. Points and assists are already published per 75 and are
# therefore absent from this table.
_PER_100_TO_PER_75: tuple[tuple[str, str], ...] = (
    ("trb_per100", "trb_per75"),
    ("stl_per100", "stl_per75"),
    ("blk_per100", "blk_per75"),
)

# See module docstring -- season aggregates for a traded player, never a real
# single-team-season.
_MULTI_TEAM_CODES = frozenset({"2TM", "3TM", "4TM", "5TM", "TOT"})

# Real franchise names for every Basketball-Reference team code present in the
# 1979-80..2025-26 window. Naming only; no stats or rosters are encoded here.
# Kept in sync with nba_peak/perfect_season/exact_season.py::TEAM_ID_TO_NAME.
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


def slug(name: str) -> str:
    """ASCII-folded, hyphenated player slug -- same convention as
    scripts/build_web_dataset.py::slug and
    nba_peak/perfect_season/exact_season.py::slug."""
    return re.sub(r"[^a-z0-9]+", "-", str(name).lower()).strip("-")


def season_nodash(season: str) -> str:
    """'1990-91' -> '199091'. Matches the window-id convention in CLAUDE.md."""
    return str(season).replace("-", "")


def answer_id(player_slug: str, season: str, team: str) -> str:
    """Stable id for one player-season answer, e.g.
    'michael-jordan-199091-chi'.

    Includes the team even though (player, season) is already unique in the
    pool: it makes the id self-describing in logs and share text, and keeps
    it correct if a future revision admits per-team stints for traded
    players (see module docstring).
    """
    return f"{player_slug}-{season_nodash(season)}-{team.lower()}"


@dataclass(frozen=True)
class PlayerSeason:
    """One exact player-season -- the unit a grid cell is filled with."""

    id: str
    player_slug: str
    player_name: str
    season: str
    season_start_year: int
    team: str
    team_name: str
    position: str
    prime_score: float
    # Raw (pre-weighting) PEAK3 component values for this season.
    statistical_impact: float
    traditional_production: float
    recognition: float
    postseason_value: float
    team_achievement: float
    # Real recognition/outcome context, straight from the scored table.
    mvp_rank: Optional[int]
    dpoy_rank: Optional[int]
    # Parsed from the same `awards` string as mvp_rank/dpoy_rank -- see
    # _award_rank() and the module docstring's note on this column.
    smoy_rank: Optional[int]
    mip_rank: Optional[int]
    roy_rank: Optional[int]
    all_nba_team: Optional[int]
    all_defense_team: Optional[int]
    all_star: bool
    champion: bool
    finals_mvp: bool
    finals_appearance: bool
    conf_finals: bool
    made_playoffs: bool
    playoff_round: str
    # Real season-shape facts, straight from the scored table. Used by the
    # Phase 11C season-context constraints and by the rejection sentences that
    # explain them ("logged 24.1 MPG, not 30+"). None where the table has no
    # value -- never back-filled, and every context predicate rejects a season
    # whose value is missing rather than guessing one.
    minutes_per_game: Optional[float]
    games_played: Optional[int]
    # Categories this season led the league in, e.g. ("scoring",). Empty tuple
    # for the overwhelming majority of seasons.
    stat_titles: tuple[str, ...]
    # --- v5 basketball-fact layer (data/reference/, see module docstring) ---
    # SEASON grain: the per-game box line. Defaulted to None so the several
    # hand-built PlayerSeasons in tests keep constructing, and so a season the
    # reference dataset has no row for is honestly blank rather than zeroed.
    points_per_game: Optional[float] = None
    rebounds_per_game: Optional[float] = None
    assists_per_game: Optional[float] = None
    steals_per_game: Optional[float] = None
    blocks_per_game: Optional[float] = None
    three_pointers_made: Optional[int] = None
    # CAREER grain: facts about the player, repeated on each of their seasons.
    # These are what make "Top-10 Pick", "International Player", "7'0\" or
    # Taller" and "Played for 5+ Franchises" answerable, and they are the
    # numbers the rejection sentences quote back when an answer misses.
    height_inches: Optional[int] = None
    draft_round: Optional[int] = None
    draft_pick_overall: Optional[int] = None
    international: Optional[bool] = None
    undrafted: Optional[bool] = None
    franchise_count: Optional[int] = None
    career_seasons: Optional[int] = None

    @property
    def label(self) -> str:
        """'1990-91 Michael Jordan' -- season first, the way a season is
        referred to in basketball writing and in the share text."""
        return f"{self.season} {self.player_name}"

    def as_search_dict(self) -> dict:
        """Identity only -- NO score. The shape a candidate takes before the
        player commits to it.

        Phase 11B: the Daily Grid's objective is to maximise total PEAK3
        score, so showing `prime_score` on a search result hands over the
        answer to the optimisation. A player could type a name, read the
        numbers, and click the biggest one without knowing anything about
        basketball. Everything here is identity a player already knows from
        the name they typed (which team, which season, which position) --
        nothing that ranks the options against each other.

        See as_dict() for the post-lock shape.
        """
        return {
            "id": self.id,
            "player_slug": self.player_slug,
            "player_name": self.player_name,
            "season": self.season,
            "team": self.team,
            "team_name": self.team_name,
            "position": self.position,
            "label": self.label,
        }

    def as_dict(self) -> dict:
        """Full card, score included -- same convention as
        LineupFitComponents.as_dict().

        REVEALED SHAPE. Only ever sent for a season the player has already
        locked in (a valid submission) or for a square in the post-completion
        comparison. Never for a search candidate: use as_search_dict().
        """
        return {
            **self.as_search_dict(),
            "prime_score": round(self.prime_score, 2),
        }


@dataclass
class GridPool:
    """The answer universe plus the frames constraints are evaluated over.

    `frame` is kept alongside `seasons` because constraint predicates are
    vectorized over it (a boolean mask per constraint), which is what makes
    board generation -- thousands of candidate cell intersections -- fast
    enough to run per request without a precomputed answer-key file.
    """

    seasons: list[PlayerSeason]
    frame: pd.DataFrame
    by_id: dict[str, PlayerSeason] = field(default_factory=dict)
    version: str = POOL_VERSION

    def __post_init__(self) -> None:
        if not self.by_id:
            self.by_id = {ps.id: ps for ps in self.seasons}

    def get(self, answer_id_: str) -> Optional[PlayerSeason]:
        return self.by_id.get(answer_id_)

    def __len__(self) -> int:
        return len(self.seasons)


_POOL_CACHE: Optional[GridPool] = None


def _load_manifest_slugs(path: Path | None = None) -> set[str]:
    load_path = path or MANIFEST_PATH
    if not load_path.exists():
        raise FileNotFoundError(
            f"{load_path} missing -- broken checkout (this file is committed)."
        )
    manifest = json.loads(load_path.read_text())
    return {entry["player_slug"] for entry in manifest["identities"]}


def _award_rank(awards, code: str) -> Optional[int]:
    """Ordinal finish for `code` in the raw Awards string, e.g. `_award_rank(
    "MVP-13,MIP-1,6MOY-7", "MIP")` -> 1.

    Same regex convention as nba_peak.context.awards._rank, which is what
    mvp_rank/dpoy_rank on the scored table were themselves built from -- read
    here directly (rather than imported) so this module keeps reading a
    single committed column without a cross-package private import, exactly
    the same way mvp_rank/dpoy_rank are already read as plain columns below.
    """
    if pd.isna(awards):
        return None
    match = re.search(rf"{code}-(\d+)", str(awards))
    return int(match.group(1)) if match else None


def _optional_int(value) -> Optional[int]:
    """NaN -> None, else int. Award rank columns are float64 with NaN meaning
    'did not receive votes / was not selected' -- which is information, not a
    hole to fill."""
    if value is None or pd.isna(value):
        return None
    return int(value)


def _optional_bool(value) -> Optional[bool]:
    """NaN -> None, else bool. The three-state contract the v5 reference
    columns are stored as float to preserve: False and "we do not know" are
    different answers and only one of them is a fact about the player."""
    if value is None or pd.isna(value):
        return None
    return bool(value)


def _optional_float(value) -> Optional[float]:
    """NaN -> None, else float. Same contract as _optional_int: a missing
    minutes/games value is a hole in the source table, not a zero."""
    if value is None or pd.isna(value):
        return None
    return float(value)


# The five values `playoff_round` may take, deepest first. Used to rebuild the
# label from the authoritative flags -- see canonical_playoff_round().
PLAYOFF_ROUND_CHAMPION = "Champion"
PLAYOFF_ROUND_FINALS = "Finals"
PLAYOFF_ROUND_CONF_FINALS = "Conference Finals"
PLAYOFF_ROUND_MISSED = "Missed playoffs"

# `playoff_round_score` -> label, for the rounds no boolean flag covers.
# Mirrors nba_peak/context/postseason.py's own ROUND_LOSS_SCORE mapping.
_ROUND_SCORE_LABELS: tuple[tuple[float, str], ...] = (
    (100.0, PLAYOFF_ROUND_CHAMPION),
    (85.0, PLAYOFF_ROUND_FINALS),
    (70.0, PLAYOFF_ROUND_CONF_FINALS),
    (50.0, "Conference Semifinals"),
    (30.0, "First Round"),
)


def canonical_playoff_round(row) -> str:
    """The round label implied by the AUTHORITATIVE flags, not the stored string.

    WHY THIS EXISTS. `playoff_round` is a human-readable label written from the
    parsed bracket, while PEAK3 scores team achievement from the numeric flags
    (`championship`, `finals_appearance`, `conf_finals`, `playoff_round_score`).
    In the committed scored table those two disagree for the 2025-26 season and
    only that season: nine champion rows and nine Finals rows carry the label
    "Conference Finals", because the string was captured from a bracket state
    before the Finals resolved while the flags carry the final outcome. Every
    other season from 1979-80 on is consistent. See
    docs/model/POSTSEASON_TEAM_AUDIT.md section 4.

    The symptom was user-visible and wrong: the Daily Grid's rejection sentence
    reads this label, so submitting a 2025-26 champion produced "that team
    finished at conference finals" -- a false claim about a real team, printed
    to the player as a teaching sentence.

    Deriving the label here rather than repairing the parquet keeps the fix
    inside the consumer that shows it, changes no PEAK3 score (the model never
    reads this string), and cannot drift: flags and label now come from the same
    place by construction.
    """
    if not bool(row.get("made_playoffs")):
        return PLAYOFF_ROUND_MISSED
    if float(row.get("championship") or 0) == 1:
        return PLAYOFF_ROUND_CHAMPION
    if float(row.get("finals_appearance") or 0) == 1:
        return PLAYOFF_ROUND_FINALS
    if float(row.get("conf_finals") or 0) == 1:
        return PLAYOFF_ROUND_CONF_FINALS
    score = pd.to_numeric(row.get("playoff_round_score"), errors="coerce")
    if pd.notna(score):
        for threshold, label in _ROUND_SCORE_LABELS:
            if float(score) >= threshold:
                return label
    # Made the playoffs with no flag and no usable score: fall back to the
    # stored label rather than inventing a round.
    stored = row.get("playoff_round")
    return str(stored) if stored else PLAYOFF_ROUND_MISSED


def _join_reference(
    scored: pd.DataFrame,
    season_box_path: Path | None = None,
    bio_path: Path | None = None,
) -> pd.DataFrame:
    """Attach the committed basketball-fact layer to the scored frame.

    TWO GRAINS, ONE JOIN PATH. The season file is joined on the exact
    (player_slug, season, team) key the position and age joins above already
    use, and it carries the Basketball-Reference player id for that row; the
    career file is then looked up BY THAT ID, so a career fact lands on the
    right person even where two players share a slug. The league has had two
    Charles Joneses on one roster and two Mike Dunleavys in one era, and a
    slug-keyed career join would have quietly merged them.

    `slug_primary` is the reference dataset's own resolution of the one
    (slug, season, team) collision in the window -- see
    scripts/build_player_reference_dataset.py::_mark_slug_primary.

    Every column added here is nullable and stays null when the reference
    dataset has no value. `.astype(float)` on the boolean-shaped columns is
    deliberate and is why: a NumPy bool column cannot hold "unknown", so a
    player whose birth country the source does not record would arrive as
    False -- indistinguishable from a player known to be American -- and an
    International Player square would reject a correct answer with no way to
    tell that had happened.
    """
    box_load = season_box_path or REFERENCE_SEASON_BOX_PATH
    bio_load = bio_path or REFERENCE_BIO_PATH
    for required in (box_load, bio_load):
        if not required.exists():
            raise FileNotFoundError(
                f"{required} missing -- broken checkout (this file is committed). "
                "Rebuild with scripts/build_player_reference_dataset.py."
            )

    box = pd.read_parquet(box_load)
    box = box[box["slug_primary"].to_numpy(dtype=bool)]
    keyed_box = box.set_index(["player_slug", "season", "team"])
    key = scored.set_index(["player_slug", "season", "team"]).index
    for column in _REFERENCE_SEASON_COLUMNS:
        scored[column] = key.map(keyed_box[column])

    bio = json.loads(bio_load.read_text())["players"]
    for column in _REFERENCE_BIO_COLUMNS:
        scored[column] = [
            (bio.get(player_id) or {}).get(column) if isinstance(player_id, str) else None
            for player_id in scored["bbref_id"]
        ]
        scored[column] = pd.to_numeric(scored[column], errors="coerce").astype(float)
    return scored


def build_pool(
    scored_path: Path | None = None,
    regular_path: Path | None = None,
    manifest_path: Path | None = None,
    season_box_path: Path | None = None,
    bio_path: Path | None = None,
) -> GridPool:
    """Build the answer universe from committed local data. No network."""
    scored_load = scored_path or SCORED_PATH
    regular_load = regular_path or REGULAR_PATH
    for required in (scored_load, regular_load):
        if not required.exists():
            raise FileNotFoundError(
                f"{required} missing -- run the model pipeline or restore cache/processed/."
            )

    scored = pd.read_parquet(scored_load)
    scored = scored[~scored["team"].isin(_MULTI_TEAM_CODES)].copy()
    scored["player_slug"] = scored["player"].map(slug)
    # Sixth Man of the Year / Most Improved Player: not pre-parsed columns on
    # this table the way mvp_rank/dpoy_rank are, but the raw `awards` string
    # they were parsed from IS on the table -- see the module docstring and
    # _award_rank().
    scored["smoy_rank"] = scored["awards"].map(lambda a: _award_rank(a, "6MOY"))
    scored["mip_rank"] = scored["awards"].map(lambda a: _award_rank(a, "MIP"))
    # v5: Rookie of the Year, read the identical way from the identical column.
    scored["roy_rank"] = scored["awards"].map(lambda a: _award_rank(a, "ROY"))

    eligible = _load_manifest_slugs(manifest_path)
    scored = scored[scored["player_slug"].isin(eligible)].copy()

    # Season-grain position, joined on the exact (player, season, team) key so
    # a player who changed team between seasons gets that season's position.
    regular = pd.read_parquet(regular_load)
    regular = regular[~regular["team"].isin(_MULTI_TEAM_CODES)].copy()
    regular["player_slug"] = regular["player"].map(slug)
    position_by_key = (
        regular.groupby(["player_slug", "season", "team"])["pos"].first()
    )
    # AGE, on the same exact key. Basketball-Reference publishes it per
    # roster row, so it is a season fact like the position beside it -- never
    # derived from a birth date this repository does not hold.
    age_by_key = regular.groupby(["player_slug", "season", "team"])["age"].first()
    threepar_by_key = regular.groupby(["player_slug", "season", "team"])["threepar"].first()
    scored["position"] = scored.set_index(
        ["player_slug", "season", "team"]
    ).index.map(position_by_key)
    # A scored season with no roster row has no honest position; it stays in
    # the pool (it can still answer non-position constraints) with an explicit
    # empty position, and every position predicate rejects it.
    scored["position"] = scored["position"].fillna("")

    keyed = scored.set_index(["player_slug", "season", "team"]).index
    scored["age"] = keyed.map(age_by_key)
    scored["threepar"] = keyed.map(threepar_by_key)

    # PER-75, ONE DENOMINATOR FOR EVERY RATE CONSTRAINT. The scored table
    # already publishes points and assists per 75 possessions and rebounds,
    # steals and blocks per 100; x0.75 is an exact unit conversion on the same
    # rate, so this restates a committed number rather than estimating one.
    for source, target in _PER_100_TO_PER_75:
        scored[target] = pd.to_numeric(scored[source], errors="coerce") * 0.75

    # The committed basketball-fact layer -- per-game box line at season grain,
    # height/draft/birth country/career shape at career grain. See
    # _join_reference() and the module docstring.
    scored = _join_reference(scored, season_box_path, bio_path)

    scored["season_start_year"] = scored["season"].str[:4].astype(int)
    # Rebuild the round label from the flags PEAK3 actually scores from, so the
    # label the player is shown can never contradict the constraint that
    # accepted or rejected their answer. See canonical_playoff_round().
    scored["playoff_round"] = scored.apply(canonical_playoff_round, axis=1)
    scored["answer_id"] = [
        answer_id(s, se, t)
        for s, se, t in zip(scored["player_slug"], scored["season"], scored["team"])
    ]
    scored = scored.sort_values("answer_id").reset_index(drop=True)

    seasons = [
        PlayerSeason(
            id=row.answer_id,
            player_slug=row.player_slug,
            player_name=row.player,
            season=row.season,
            season_start_year=int(row.season_start_year),
            team=row.team,
            team_name=TEAM_ID_TO_NAME.get(row.team, row.team),
            position=row.position,
            prime_score=float(row.prime_score),
            statistical_impact=float(row.statistical_impact),
            traditional_production=float(row.traditional_production),
            recognition=float(row.recognition),
            postseason_value=float(row.contrib_postseason),
            team_achievement=float(row.team_achievement),
            mvp_rank=_optional_int(row.mvp_rank),
            dpoy_rank=_optional_int(row.dpoy_rank),
            smoy_rank=_optional_int(row.smoy_rank),
            mip_rank=_optional_int(row.mip_rank),
            roy_rank=_optional_int(row.roy_rank),
            all_nba_team=_optional_int(row.all_nba_team),
            all_defense_team=_optional_int(row.all_defense_team),
            all_star=bool(row.all_star == 1),
            champion=bool(row.championship == 1),
            finals_mvp=bool(row.finals_mvp == 1),
            finals_appearance=bool(row.finals_appearance == 1),
            conf_finals=bool(row.conf_finals == 1),
            made_playoffs=bool(row.made_playoffs),
            playoff_round=str(row.playoff_round),
            minutes_per_game=_optional_float(row.mpg),
            games_played=_optional_int(row.g),
            stat_titles=tuple(
                name
                for column, name in STAT_TITLE_COLUMNS
                if int(getattr(row, column)) == 1
            ),
            points_per_game=_optional_float(row.pts_pg),
            rebounds_per_game=_optional_float(row.trb_pg),
            assists_per_game=_optional_float(row.ast_pg),
            steals_per_game=_optional_float(row.stl_pg),
            blocks_per_game=_optional_float(row.blk_pg),
            three_pointers_made=_optional_int(row.fg3m),
            height_inches=_optional_int(row.height_in),
            draft_round=_optional_int(row.draft_round),
            draft_pick_overall=_optional_int(row.draft_pick_overall),
            international=_optional_bool(row.international),
            undrafted=_optional_bool(row.undrafted),
            franchise_count=_optional_int(row.franchise_count),
            career_seasons=_optional_int(row.seasons_played),
        )
        for row in scored.itertuples(index=False)
    ]

    frame = scored[
        [
            "answer_id",
            "player_slug",
            "player",
            "season",
            "season_start_year",
            "team",
            "position",
            "prime_score",
            "statistical_impact",
            "traditional_production",
            "recognition",
            "contrib_postseason",
            "team_achievement",
            "mvp_rank",
            "dpoy_rank",
            "smoy_rank",
            "mip_rank",
            "roy_rank",
            "all_nba_team",
            "all_defense_team",
            "all_star",
            "championship",
            "finals_mvp",
            "finals_appearance",
            "conf_finals",
            "made_playoffs",
            "playoff_round",
            "mpg",
            "g",
            # v4 style/career columns. See the module docstring for where each
            # comes from and why the rates share one denominator.
            "age",
            "pts_per75",
            "ast_per75",
            "trb_per75",
            "stl_per75",
            "blk_per75",
            "usg_pct",
            "ts_plus",
            "threepar",
            # v5 basketball-fact columns. See _join_reference().
            *_REFERENCE_SEASON_COLUMNS,
            *_REFERENCE_BIO_COLUMNS,
            *[column for column, _ in STAT_TITLE_COLUMNS],
        ]
    ].reset_index(drop=True)

    return GridPool(seasons=seasons, frame=frame)


def load_pool(force_reload: bool = False) -> GridPool:
    """Process-cached pool. Built once, then reused -- the parquet read and
    the position join are the expensive part of every grid request."""
    global _POOL_CACHE
    if _POOL_CACHE is None or force_reload:
        _POOL_CACHE = build_pool()
    return _POOL_CACHE
