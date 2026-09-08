"""The shipped Daily Grid constraint taxonomy.

Every constraint here is a predicate over a real column of the answer pool
(nba_peak/daily_grid/pool.py). The gate for shipping one is simple and
deliberately strict: if the fact cannot be read out of committed data at
player-SEASON grain, the constraint does not exist. Nothing is inferred,
estimated, or approximated -- a smaller reliable taxonomy beats a broad
shaky one, because a grid is only fun if "that answer should have counted"
is never true.

CATEGORIES
  team       one franchise, relocations folded in (Sonics seasons answer
             "Thunder", Bullets answer "Wizards") -- franchise continuity is
             how fans actually think about team history.
  award      MVP / DPOY / Sixth Man of the Year / Most Improved Player /
             Finals MVP / All-NBA / All-Defense / All-Star and the
             league-leader titles, from the scored table's own columns.
  era        decade of the season's start year.
  position   the position the player logged THAT season.
  context    season shape: minutes per game, games played.
  outcome    how far that season's team actually went in the playoffs.
  peak       PEAK3 prime_score thresholds.
  component  top-decile seasons in one of the five PEAK3 components.
  career     the player's AGE that season -- early, veteran, late career.
  production per-75-possession scoring, rebounding, playmaking and defensive
             rate bands: what kind of season this was, not how good it was.
  shooting   era-relative shooting efficiency (TS+) and three-point volume.
  usage      share of the team's possessions the player used.

SEASON VALIDITY (`Constraint.valid_from`)
Some awards did not exist for the whole 1979-80..2025-26 data window: DPOY
and Sixth Man of the Year were both introduced for the 1982-83 season, and
Most Improved Player for 1985-86. Earlier seasons' `awards` string simply
cannot contain those tokens, so those seasons already fail the constraint's
mask honestly -- but `valid_from` makes that fact an explicit, readable
property of the constraint itself (a `season_start_year` floor that
`Constraint.matches()` ANDs into every mask) rather than something provable
only by noticing a column is null. A constraint with `valid_from=None` is
valid for the whole window.

PHASE 11C: PEAK3-NATIVE CONSTRAINTS ARE NO LONGER STANDARD
`peak` and `component` are still shipped -- they are honest, well-defined
predicates -- but the generator now keeps them off almost every board. The
reason is game design rather than data quality: the Daily Grid's objective is
to MAXIMISE total PEAK3 score, so an axis that reads "60+ PEAK" or "Top 10%
Statistical Impact" is asking the player to do the thing the scoring already
rewards. Those squares have one obvious answer (the biggest all-time name who
clears the bar) and teach nothing. The interesting version of this game hides
PEAK3 in the SCORING and puts basketball facts on the AXES -- so the standard
board is franchises, awards, eras, playoff runs and season context, and PEAK3
only shows up when a pick locks. See generator._native_allowance().

EXCLUSIVE GROUPS
Two constraints sharing an `exclusive_group` must never appear on opposite
axes of the same board, for one of two reasons:
  - MUTUALLY EXCLUSIVE: a player-season has exactly one team, one decade,
    one position. "Lakers x Celtics" has no answers, ever.
  - NESTED: "85+ PEAK" is a strict subset of "80+ PEAK", so crossing them
    makes the outer constraint decoration rather than a real second
    condition. Same for MVP inside MVP-top-5, All-NBA 1st inside All-NBA,
    Scoring Champion inside League Leader, 36+ MPG inside 30+ MPG, and the
    champion/finals/conference-finals/made-the-playoffs ladder.
The empirical answer-count gate in generator.py would already reject the
mutually-exclusive pairs (zero answers), but nested pairs pass it while
still making a bad board -- so the grouping is enforced explicitly and the
mutually-exclusive cases get a second, cheaper line of defence.

DELIBERATELY NOT SHIPPED
  `role` ("Primary scorer", "Defensive anchor", ...) exists in the scored
  table but its classes are far too thin (54 defensive-anchor seasons in the
  whole 1979-80..2025-26 window) to intersect with a team or an award and
  still leave a solvable cell. Position + component constraints cover the
  same "what kind of player" intent with real coverage.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

import numpy as np
import pandas as pd

from nba_peak.daily_grid.pool import STAT_TITLE_COLUMNS, GridPool, load_pool
from nba_peak.franchises import FRANCHISES

# v3: adds Sixth Man of the Year / Most Improved Player and the explicit
# `Constraint.valid_from` season-gating field. See generator.py's
# NOVELTY_CUTOVER_DATE for why a date before that cutover still generates
# from the frozen v2 subset of this taxonomy rather than the whole thing.
CONSTRAINTS_VERSION = "daily_grid_constraints.v4"

# Constraint ids that did not exist in v2. generator.py filters these back out
# to reconstruct the EXACT v2 taxonomy (same members, same order) for any
# board date at or before the cutover -- see
# generator._legacy_v2_taxonomy(). Frozen here, next to the ids it names,
# rather than re-derived, so it can never silently drift if this module is
# edited again.
V3_ADDED_CONSTRAINT_IDS = frozenset({"award_smoy", "award_smoy_votes", "award_mip"})

# Constraint ids that did not exist in v3 -- the four style/career families
# below. Filtered back out the same way V3_ADDED_CONSTRAINT_IDS is, and for
# the same reason: generation samples this list BY INDEX against a date-seeded
# RNG, so a date that resolves under an older version must see that version's
# population, in that version's order, or every past board silently changes.
V4_ADDED_CONSTRAINT_IDS = frozenset(
    {
        "career_age_23_under",
        "career_age_30_over",
        "career_age_34_over",
        "prod_scoring",
        "prod_rebounding",
        "prod_playmaking",
        "prod_rim_protection",
        "prod_perimeter_defense",
        "shoot_efficiency",
        "shoot_three_volume",
        "usage_high",
        "usage_primary",
    }
)

# Top-decile cut for the component constraints. One shared value so "top 10%"
# means the same thing in every component label.
COMPONENT_PERCENTILE = 0.90


@dataclass(frozen=True)
class Constraint:
    """One row or column condition.

    `mask` is vectorized over the pool frame rather than being a per-record
    predicate: board generation evaluates thousands of cell intersections,
    and boolean-array AND is what keeps that inside a request budget.
    """

    id: str
    label: str
    short_label: str
    category: str
    exclusive_group: Optional[str]
    description: str
    mask: Callable[[pd.DataFrame], np.ndarray]
    # Season-grain validity floor -- see the module docstring's SEASON
    # VALIDITY section. None means "valid for the whole data window"; every
    # constraint whose real-world award predates 1979-80 (or has no season
    # concept at all, e.g. team/era/position) leaves this at the default.
    valid_from: Optional[int] = None

    def matches(self, frame: pd.DataFrame) -> np.ndarray:
        mask = np.asarray(self.mask(frame), dtype=bool)
        if self.valid_from is not None:
            in_window = frame["season_start_year"].to_numpy() >= self.valid_from
            mask = mask & in_window
        return mask

    def as_dict(self) -> dict:
        """Public shape. Deliberately excludes `mask` and any answer
        information -- see generator.GridBoard.as_public_dict()."""
        return {
            "id": self.id,
            "label": self.label,
            "short_label": self.short_label,
            "category": self.category,
            "description": self.description,
        }


# ---------------------------------------------------------------------------
# Team constraints
# ---------------------------------------------------------------------------

# FRANCHISES -- current franchise -> every Basketball-Reference team code that
# franchise has played under since 1979-80 -- now lives in
# `nba_peak.franchises`, because more than one game asks "did this player play
# for franchise F" and no game should have to import another game's package to
# find out. Imported at the top of this module and re-exported below, so every
# existing `from nba_peak.daily_grid.constraints import FRANCHISES` keeps
# working. The table itself and its documented editorial choices (CHH grouped
# with today's Charlotte franchise; the 2002+ New Orleans franchise separate)
# moved verbatim -- this was a relocation, not a revision.


def _team_constraints() -> list[Constraint]:
    out: list[Constraint] = []
    for franchise_id, (name, codes) in FRANCHISES.items():
        code_set = set(codes)
        historical = tuple(c for c in codes if c != franchise_id)
        description = f"Played for the {name} that season."
        if historical:
            description += (
                " Includes seasons under the franchise's earlier names/cities: "
                + ", ".join(sorted(historical))
                + "."
            )
        out.append(
            Constraint(
                id=f"team_{franchise_id.lower()}",
                label=name,
                short_label=name.rsplit(" ", 1)[-1],
                category="team",
                exclusive_group="team",
                description=description,
                mask=lambda f, cs=code_set: f["team"].isin(cs).to_numpy(),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Award / recognition constraints
# ---------------------------------------------------------------------------

# Real award introduction seasons (season_start_year of the first year each
# award was actually given), used as `valid_from` below so a season before
# the award existed can never satisfy it -- see the module docstring's
# SEASON VALIDITY section. Not derived from the data: these are historical
# facts about the NBA's own awards, the same way DECADES below is a fact
# about the calendar.
DPOY_SEASON_START = 1982   # Defensive Player of the Year, first awarded 1982-83.
SMOY_SEASON_START = 1982   # Sixth Man of the Year, first awarded 1982-83.
MIP_SEASON_START = 1985    # Most Improved Player, first awarded 1985-86.


def _award_constraints() -> list[Constraint]:
    return [
        Constraint(
            id="award_mvp",
            label="MVP",
            short_label="MVP",
            category="award",
            exclusive_group="mvp",
            description="Won regular-season MVP that season.",
            mask=lambda f: (f["mvp_rank"] == 1).to_numpy(),
        ),
        Constraint(
            id="award_mvp_top5",
            label="Top-5 MVP Finish",
            short_label="Top-5 MVP",
            category="award",
            exclusive_group="mvp",
            description="Finished top 5 in regular-season MVP voting that season.",
            mask=lambda f: (f["mvp_rank"] <= 5).to_numpy(),
        ),
        Constraint(
            id="award_dpoy",
            label="Defensive Player of the Year",
            short_label="DPOY",
            category="award",
            exclusive_group="dpoy",
            description="Won Defensive Player of the Year that season.",
            mask=lambda f: (f["dpoy_rank"] == 1).to_numpy(),
            valid_from=DPOY_SEASON_START,
        ),
        Constraint(
            id="award_dpoy_votes",
            label="DPOY Votes",
            short_label="DPOY Votes",
            category="award",
            exclusive_group="dpoy",
            description="Received Defensive Player of the Year votes that season.",
            mask=lambda f: f["dpoy_rank"].notna().to_numpy(),
            valid_from=DPOY_SEASON_START,
        ),
        Constraint(
            id="award_finals_mvp",
            label="Finals MVP",
            short_label="Finals MVP",
            category="award",
            exclusive_group="finals_mvp",
            description="Won Finals MVP that season.",
            mask=lambda f: (f["finals_mvp"] == 1).to_numpy(),
        ),
        Constraint(
            id="award_all_nba",
            label="All-NBA",
            short_label="All-NBA",
            category="award",
            exclusive_group="all_nba",
            description="Named to an All-NBA team (1st, 2nd, or 3rd) that season.",
            mask=lambda f: f["all_nba_team"].notna().to_numpy(),
        ),
        Constraint(
            id="award_all_nba_first",
            label="All-NBA First Team",
            short_label="All-NBA 1st",
            category="award",
            exclusive_group="all_nba",
            description="Named to the All-NBA First Team that season.",
            mask=lambda f: (f["all_nba_team"] == 1).to_numpy(),
        ),
        Constraint(
            id="award_all_defense",
            label="All-Defensive Team",
            short_label="All-Defense",
            category="award",
            exclusive_group="all_defense",
            description="Named to an All-Defensive team (1st or 2nd) that season.",
            mask=lambda f: f["all_defense_team"].notna().to_numpy(),
        ),
        Constraint(
            id="award_all_defense_first",
            label="All-Defensive First Team",
            short_label="All-Def 1st",
            category="award",
            exclusive_group="all_defense",
            description="Named to the All-Defensive First Team that season.",
            mask=lambda f: (f["all_defense_team"] == 1).to_numpy(),
        ),
        Constraint(
            id="award_all_star",
            label="All-Star",
            short_label="All-Star",
            category="award",
            exclusive_group="all_star",
            description="Selected to the All-Star Game that season.",
            mask=lambda f: (f["all_star"] == 1).to_numpy(),
        ),
        # League-leader titles. Real per-season flags on the scored table, and
        # exactly the kind of fact this game should be asking about: "who led
        # the league in rebounding for the Spurs?" is basketball knowledge,
        # where "who had a 75+ PEAK season for the Spurs?" is the scoring
        # formula asked backwards.
        Constraint(
            id="award_scoring_title",
            label="Scoring Champion",
            short_label="Scoring Title",
            category="award",
            exclusive_group="stat_title",
            description="Led the league in points per game that season.",
            mask=lambda f: (f["scoring_title"] == 1).to_numpy(),
        ),
        Constraint(
            id="award_stat_leader",
            label="Led the League in a Major Category",
            short_label="League Leader",
            category="award",
            exclusive_group="stat_title",
            description=(
                "Led the league that season in points, rebounds, assists, "
                "blocks or steals per game."
            ),
            mask=lambda f: (
                sum(f[column] == 1 for column, _ in STAT_TITLE_COLUMNS) > 0
            ).to_numpy(),
        ),
        # Sixth Man of the Year and Most Improved Player -- read off the same
        # `awards` string MVP/DPOY already come from (see pool.py::_award_rank
        # for the shared ordinal-rank parsing), never a separate or fabricated
        # source. Appended at the end of the award block (not interspersed
        # among the pre-existing ids) so their addition cannot shift where any
        # earlier constraint sits in the taxonomy list -- see build_constraints
        # below on why that ordering matters.
        Constraint(
            id="award_smoy",
            label="Sixth Man of the Year",
            short_label="6MOY",
            category="award",
            exclusive_group="smoy",
            description="Won Sixth Man of the Year that season.",
            mask=lambda f: (f["smoy_rank"] == 1).to_numpy(),
            valid_from=SMOY_SEASON_START,
        ),
        Constraint(
            id="award_smoy_votes",
            label="Sixth Man of the Year Votes",
            short_label="6MOY Votes",
            category="award",
            exclusive_group="smoy",
            description="Received Sixth Man of the Year votes that season.",
            mask=lambda f: f["smoy_rank"].notna().to_numpy(),
            valid_from=SMOY_SEASON_START,
        ),
        # No "MIP votes" counterpart: unlike MVP/DPOY/6MOY, the source awards
        # string only ever encodes MIP-1 (the winner) -- there is no runner-up
        # rank to read, so a second MIP constraint would just duplicate this
        # one rather than add real information. See pool.py's build_pool
        # docstring note on this column.
        Constraint(
            id="award_mip",
            label="Most Improved Player",
            short_label="MIP",
            category="award",
            exclusive_group="mip",
            description="Won Most Improved Player that season.",
            mask=lambda f: (f["mip_rank"] == 1).to_numpy(),
            valid_from=MIP_SEASON_START,
        ),
    ]


# ---------------------------------------------------------------------------
# Era constraints
# ---------------------------------------------------------------------------

# 1970s is absent on purpose: the data window opens at 1979-80, so a "1970s"
# constraint would be exactly one season pretending to be a decade.
DECADES: tuple[int, ...] = (1980, 1990, 2000, 2010, 2020)


def _era_constraints() -> list[Constraint]:
    return [
        Constraint(
            id=f"era_{decade}s",
            label=f"{decade}s",
            short_label=f"{decade}s",
            category="era",
            exclusive_group="era",
            description=(
                f"Season began in the {decade}s "
                f"({decade}-{str(decade + 9)[-2:]} season starts)."
            ),
            mask=lambda f, d=decade: (
                (f["season_start_year"] >= d) & (f["season_start_year"] <= d + 9)
            ).to_numpy(),
        )
        for decade in DECADES
    ]


# ---------------------------------------------------------------------------
# Position constraints
# ---------------------------------------------------------------------------

POSITION_GROUPS: dict[str, tuple[str, tuple[str, ...]]] = {
    "guard": ("Guard", ("PG", "SG", "G")),
    "forward": ("Forward", ("SF", "PF", "F")),
    "center": ("Center", ("C",)),
}


def _position_constraints() -> list[Constraint]:
    out: list[Constraint] = []
    for group_id, (label, codes) in POSITION_GROUPS.items():
        code_set = set(codes)
        out.append(
            Constraint(
                id=f"pos_{group_id}",
                label=label,
                short_label=label,
                category="position",
                exclusive_group="position",
                description=(
                    f"Listed as a {label.lower()} ({', '.join(codes)}) that season. "
                    "Position is read per season, not per career."
                ),
                # A hyphenated listing ("PG-SG") counts for its PRIMARY position
                # only -- the first token -- so the three groups stay mutually
                # exclusive and a board can never cross two of them.
                mask=lambda f, cs=code_set: (
                    f["position"].str.split("-").str[0].isin(cs).to_numpy()
                ),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Season-context constraints
# ---------------------------------------------------------------------------

# Minutes-per-game cuts. Real `mpg` on the scored table, no derivation. Two
# rungs only: 30+ is "a starter's season", 36+ is "a workhorse season", and a
# third cut in between would be a distinction no fan draws. A season with no
# recorded mpg fails both -- NaN >= x is False, which is the honest answer.
MPG_THRESHOLDS: tuple[tuple[int, str], ...] = (
    (30, "Played 30+ minutes per game that season."),
    (36, "Played 36+ minutes per game that season."),
)

# Games-played cut. 70 of 82 is the recognisable "played essentially the whole
# season" line, and it is the one that makes an availability square meaningful
# without turning into a trivia question about lockout years.
GAMES_THRESHOLD = 70


def _context_constraints() -> list[Constraint]:
    out: list[Constraint] = [
        Constraint(
            id=f"context_mpg_{threshold}",
            label=f"{threshold}+ Minutes Per Game",
            short_label=f"{threshold}+ MPG",
            category="context",
            # Nested: 36+ is a strict subset of 30+, so crossing them makes the
            # looser one decoration rather than a second condition.
            exclusive_group="minutes",
            description=description,
            mask=lambda f, t=threshold: (f["mpg"] >= t).to_numpy(),
        )
        for threshold, description in MPG_THRESHOLDS
    ]
    out.append(
        Constraint(
            id=f"context_games_{GAMES_THRESHOLD}",
            label=f"Played {GAMES_THRESHOLD}+ Games",
            short_label=f"{GAMES_THRESHOLD}+ Games",
            category="context",
            exclusive_group="games_played",
            description=(
                f"Appeared in {GAMES_THRESHOLD} or more games that season "
                "for this team."
            ),
            mask=lambda f: (f["g"] >= GAMES_THRESHOLD).to_numpy(),
        )
    )
    return out


# ---------------------------------------------------------------------------
# PEAK3 score-threshold constraints
# ---------------------------------------------------------------------------

PEAK_THRESHOLDS: tuple[int, ...] = (60, 70, 75, 80, 85)


def _peak_constraints() -> list[Constraint]:
    return [
        Constraint(
            id=f"peak_{threshold}_plus",
            label=f"{threshold}+ PEAK Season",
            short_label=f"{threshold}+ PEAK",
            category="peak",
            exclusive_group="peak_threshold",
            description=(
                f"PEAK3 rates this season at {threshold}.0 or higher on the "
                "calibrated 0-100 single-season scale."
            ),
            mask=lambda f, t=threshold: (f["prime_score"] >= t).to_numpy(),
        )
        for threshold in PEAK_THRESHOLDS
    ]


# ---------------------------------------------------------------------------
# PEAK3 component constraints
# ---------------------------------------------------------------------------

# (constraint id, frame column, label, short label, description tail).
# Labels name the component exactly as METHODOLOGY.md and the rankings UI do.
COMPONENT_SPECS: tuple[tuple[str, str, str, str, str], ...] = (
    (
        "comp_statistical_impact",
        "statistical_impact",
        "Elite Statistical Impact",
        "Top 10% SI",
        "Statistical Impact",
    ),
    (
        "comp_traditional_production",
        "traditional_production",
        "Elite Traditional Production",
        "Top 10% TP",
        "Traditional Production",
    ),
    (
        "comp_recognition",
        "recognition",
        "Elite Individual Recognition",
        "Top 10% REC",
        "Individual Recognition",
    ),
    (
        "comp_postseason",
        "contrib_postseason",
        "Elite Playoff Rate Impact",
        "Top 10% Postseason",
        "Playoff Rate Impact",
    ),
    (
        "comp_team_achievement",
        "team_achievement",
        "Elite Team Result",
        "Top 10% Team",
        "Team Result",
    ),
)


def _component_constraints(pool: GridPool) -> list[Constraint]:
    """Component cutoffs are the pool's own top decile.

    Computed from the committed data rather than hardcoded so the label
    ("top 10%") and the predicate can never disagree; the value is frozen
    into each constraint at build time so a single board's cells are all
    judged against the same number.
    """
    out: list[Constraint] = []
    for cid, column, label, short_label, component_name in COMPONENT_SPECS:
        cutoff = float(pool.frame[column].quantile(COMPONENT_PERCENTILE))
        out.append(
            Constraint(
                id=cid,
                label=label,
                short_label=short_label,
                category="component",
                exclusive_group=None,
                description=(
                    f"Top 10% of all qualifying seasons in PEAK3's {component_name} "
                    f"component (>= {cutoff:.1f})."
                ),
                mask=lambda f, col=column, c=cutoff: (f[col] >= c).to_numpy(),
            )
        )
    return out


# ---------------------------------------------------------------------------
# Playoff-outcome constraints
# ---------------------------------------------------------------------------

# playoff_round is a real column on the scored table with exactly these
# values: Missed playoffs / First Round / Conference Semifinals /
# Conference Finals / Finals / Champion.
def _outcome_constraints() -> list[Constraint]:
    return [
        Constraint(
            id="outcome_champion",
            label="NBA Champion",
            short_label="Champion",
            category="outcome",
            exclusive_group="playoff_depth",
            description="Won the NBA title that season.",
            mask=lambda f: (f["championship"] == 1).to_numpy(),
        ),
        Constraint(
            id="outcome_finals",
            label="Reached the Finals",
            short_label="Finals Run",
            category="outcome",
            exclusive_group="playoff_depth",
            description="Team reached the NBA Finals that season.",
            mask=lambda f: (f["finals_appearance"] == 1).to_numpy(),
        ),
        Constraint(
            id="outcome_conf_finals",
            label="Reached the Conference Finals",
            short_label="Conf Finals",
            category="outcome",
            exclusive_group="playoff_depth",
            description="Team reached at least the conference finals that season.",
            mask=lambda f: (f["conf_finals"] == 1).to_numpy(),
        ),
        Constraint(
            id="outcome_made_playoffs",
            label="Made the Playoffs",
            short_label="Playoffs",
            category="outcome",
            exclusive_group="playoff_depth",
            description="Team reached the playoffs that season.",
            mask=lambda f: f["made_playoffs"].to_numpy(dtype=bool),
        ),
        Constraint(
            id="outcome_missed_playoffs",
            label="Missed the Playoffs",
            short_label="No Playoffs",
            category="outcome",
            exclusive_group="playoff_depth",
            description="Team did not make the playoffs that season.",
            mask=lambda f: (f["playoff_round"] == "Missed playoffs").to_numpy(),
        ),
    ]


# ---------------------------------------------------------------------------
# Career-stage constraints (v4)
# ---------------------------------------------------------------------------

# `age` is Basketball-Reference's own per-roster-row age, joined onto the pool
# on the exact (player, season, team) key -- a season fact like the position
# beside it, never derived from a birth date this repository does not hold.
#
# THREE RUNGS, ONE EXCLUSIVE GROUP. "Age 23 or younger" and "Age 30 or older"
# are disjoint rather than nested, so crossing them has ZERO answers for ever;
# 34+ is a strict subset of 30+, so crossing those makes the outer one
# decoration. Both failures are what `exclusive_group` exists to stop, so all
# three share one group and no board can put two of them on opposite axes.
AGE_YOUNG_MAX = 23
AGE_VETERAN_MIN = 30
AGE_LATE_MIN = 34


def _career_constraints() -> list[Constraint]:
    return [
        Constraint(
            id="career_age_23_under",
            label=f"Age {AGE_YOUNG_MAX} or Younger",
            short_label=f"{AGE_YOUNG_MAX} & Under",
            category="career",
            exclusive_group="age",
            description=(
                f"The player was {AGE_YOUNG_MAX} or younger that season, as "
                "listed on the season's own roster row."
            ),
            mask=lambda f: (f["age"] <= AGE_YOUNG_MAX).to_numpy(),
        ),
        Constraint(
            id="career_age_30_over",
            label=f"Age {AGE_VETERAN_MIN} or Older",
            short_label=f"{AGE_VETERAN_MIN}+",
            category="career",
            exclusive_group="age",
            description=(
                f"The player was {AGE_VETERAN_MIN} or older that season, as "
                "listed on the season's own roster row."
            ),
            mask=lambda f: (f["age"] >= AGE_VETERAN_MIN).to_numpy(),
        ),
        Constraint(
            id="career_age_34_over",
            label=f"Age {AGE_LATE_MIN} or Older",
            short_label=f"{AGE_LATE_MIN}+",
            category="career",
            exclusive_group="age",
            description=(
                f"The player was {AGE_LATE_MIN} or older that season -- a late-"
                "career season, as listed on the season's own roster row."
            ),
            mask=lambda f: (f["age"] >= AGE_LATE_MIN).to_numpy(),
        ),
    ]


# ---------------------------------------------------------------------------
# Production constraints (v4) -- WHAT KIND of season, not how good
# ---------------------------------------------------------------------------

# EVERY RATE IS PER 75 POSSESSIONS, and they all say so. The scored table
# publishes points and assists per 75 and rebounds, steals and blocks per 100;
# pool.py converts the latter with an exact x0.75, so a board can cross two of
# these and the player is comparing like with like.
#
# WHY A RATE AND NOT A PER-GAME AVERAGE. This repository's committed tables
# carry rate columns, not season totals, and pace has moved enough across the
# 1979-80..2025-26 window (roughly 100 to 104 possessions per 48, with a
# mid-1990s trough near 90) that a per-game line is a different question in
# 1985 than in 2025. Inventing per-game numbers from a rate would need a pace
# estimate this module does not have and must not guess -- so the axis asks
# the question the data can actually answer, and the description states the
# denominator plainly rather than hiding it behind a familiar-looking number.
#
# THESE ARE NOT PEAK3-NATIVE AXES. A rate band says what a player DID; the
# `peak` and `component` families say how highly PEAK3 rates it, which is the
# objective the game already scores (see the module docstring's Phase 11C
# note). "10+ rebounds per 75" has hundreds of plausible answers across every
# decade; "80+ PEAK" has one obvious one.
PRODUCTION_SPECS: tuple[tuple[str, str, str, str, float, str], ...] = (
    (
        "prod_scoring",
        "pts_per75",
        "High-Volume Scorer",
        "22+ PTS/75",
        22.0,
        "Scored 22 or more points per 75 possessions that season.",
    ),
    (
        "prod_rebounding",
        "trb_per75",
        "Dominant Rebounder",
        "10+ REB/75",
        10.0,
        "Grabbed 10 or more rebounds per 75 possessions that season.",
    ),
    (
        "prod_playmaking",
        "ast_per75",
        "Primary Playmaker",
        "7+ AST/75",
        7.0,
        "Recorded 7 or more assists per 75 possessions that season.",
    ),
    (
        "prod_rim_protection",
        "blk_per75",
        "Rim Protector",
        "2+ BLK/75",
        2.0,
        "Blocked 2 or more shots per 75 possessions that season.",
    ),
    (
        "prod_perimeter_defense",
        "stl_per75",
        "Ball Hawk",
        "1.8+ STL/75",
        1.8,
        "Recorded 1.8 or more steals per 75 possessions that season.",
    ),
)


def _production_constraints() -> list[Constraint]:
    return [
        Constraint(
            id=cid,
            label=label,
            short_label=short_label,
            category="production",
            # Each measures a different act, so two of them crossing is a real
            # two-condition square ("Dominant Rebounder x Primary Playmaker"
            # is a genuine and interesting ask). No nesting, no exclusivity.
            exclusive_group=None,
            description=description,
            mask=lambda f, col=column, t=threshold: (f[col] >= t).to_numpy(),
        )
        for cid, column, label, short_label, threshold, description in PRODUCTION_SPECS
    ]


# ---------------------------------------------------------------------------
# Shooting constraints (v4)
# ---------------------------------------------------------------------------

# TS+ RATHER THAN RAW TRUE SHOOTING, deliberately. League-average true
# shooting rose by roughly ten points between 1979-80 and today, so a fixed
# `ts_pct` cut is a decade filter wearing an efficiency label -- it would
# accept ordinary 2020s seasons and reject excellent 1980s ones. `ts_plus` is
# already relative to the season's own league on the scored table, which is
# the only honest way to ask this question across a 46-season window.
TS_PLUS_ELITE = 110.0

# Three-point RATE, not makes: "how much of this player's shot diet was from
# three". A real per-season column, and deliberately NOT era-adjusted, because
# the era skew IS the fact -- the three-pointer arrived in 1979-80 and stayed
# rare for a decade, so this axis genuinely has almost no 1980s answers and
# the description says so rather than pretending otherwise. A board that
# crossed it with "1980s" would simply fail the answer floors and never
# publish.
THREE_POINT_RATE = 0.35


def _shooting_constraints() -> list[Constraint]:
    return [
        Constraint(
            id="shoot_efficiency",
            label="Elite Shooting Efficiency",
            short_label="Elite TS+",
            category="shooting",
            exclusive_group="shooting_efficiency",
            description=(
                f"True shooting at least {TS_PLUS_ELITE:.0f}% of the league "
                "average that season (TS+), so an efficient 1980s season "
                "counts the same as an efficient 2020s one."
            ),
            mask=lambda f: (f["ts_plus"] >= TS_PLUS_ELITE).to_numpy(),
        ),
        Constraint(
            id="shoot_three_volume",
            label="High Three-Point Volume",
            short_label="3PT Volume",
            category="shooting",
            exclusive_group="three_point_rate",
            description=(
                f"At least {THREE_POINT_RATE:.0%} of the player's field-goal "
                "attempts came from three that season. The three-pointer was "
                "rare before the 1990s, so early seasons rarely qualify."
            ),
            mask=lambda f: (f["threepar"] >= THREE_POINT_RATE).to_numpy(),
        ),
    ]


# ---------------------------------------------------------------------------
# Usage constraints (v4)
# ---------------------------------------------------------------------------

# Share of the team's possessions the player finished while on the floor. A
# real column on the scored table, and the cleanest single statement of "was
# this player the offence" that does not restate the PEAK3 objective. Nested,
# so the two share an exclusive group.
USAGE_HIGH = 25.0
USAGE_PRIMARY = 28.0


def _usage_constraints() -> list[Constraint]:
    return [
        Constraint(
            id="usage_high",
            label=f"{USAGE_HIGH:.0f}%+ Usage Rate",
            short_label=f"{USAGE_HIGH:.0f}%+ USG",
            category="usage",
            exclusive_group="usage",
            description=(
                f"Used at least {USAGE_HIGH:.0f}% of the team's possessions "
                "while on the floor that season."
            ),
            mask=lambda f: (f["usg_pct"] >= USAGE_HIGH).to_numpy(),
        ),
        Constraint(
            id="usage_primary",
            label="First Option",
            short_label=f"{USAGE_PRIMARY:.0f}%+ USG",
            category="usage",
            exclusive_group="usage",
            description=(
                f"Used at least {USAGE_PRIMARY:.0f}% of the team's possessions "
                "while on the floor -- a genuine first option."
            ),
            mask=lambda f: (f["usg_pct"] >= USAGE_PRIMARY).to_numpy(),
        ),
    ]


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_CONSTRAINTS_CACHE: Optional[list[Constraint]] = None


def build_constraints(pool: GridPool) -> list[Constraint]:
    """The full shipped taxonomy, in a stable order.

    Order matters: generator.py samples from this list by index against a
    date-seeded RNG, so reordering it would change every future board. Append
    new constraints at the end of their category block rather than inserting.
    """
    constraints = (
        _team_constraints()
        + _award_constraints()
        + _era_constraints()
        + _position_constraints()
        + _context_constraints()
        + _peak_constraints()
        + _component_constraints(pool)
        + _outcome_constraints()
        # v4 families, APPENDED. Every earlier constraint keeps its index in
        # this list, which is what lets `_legacy_v3_taxonomy` reconstruct v3's
        # population exactly by filtering these ids back out.
        + _career_constraints()
        + _production_constraints()
        + _shooting_constraints()
        + _usage_constraints()
    )
    seen: set[str] = set()
    for constraint in constraints:
        if constraint.id in seen:
            raise ValueError(f"duplicate constraint id: {constraint.id}")
        seen.add(constraint.id)
    return constraints


def all_constraints(pool: GridPool | None = None) -> list[Constraint]:
    """Process-cached taxonomy for the default pool."""
    global _CONSTRAINTS_CACHE
    if pool is not None:
        return build_constraints(pool)
    if _CONSTRAINTS_CACHE is None:
        _CONSTRAINTS_CACHE = build_constraints(load_pool())
    return _CONSTRAINTS_CACHE


def constraint_by_id(constraint_id: str, pool: GridPool | None = None) -> Constraint:
    for constraint in all_constraints(pool):
        if constraint.id == constraint_id:
            return constraint
    raise KeyError(f"unknown constraint id: {constraint_id}")


class _LazyConstraintList:
    """`ALL_CONSTRAINTS` as a lazily-materialized sequence.

    Exported as a module-level name for ergonomics, but the taxonomy needs
    the pool (component cutoffs are data-derived), and reading a parquet at
    import time would make merely importing this package expensive. This
    defers that to first use while still supporting len()/iteration/indexing.
    """

    def _resolve(self) -> list[Constraint]:
        return all_constraints()

    def __iter__(self):
        return iter(self._resolve())

    def __len__(self) -> int:
        return len(self._resolve())

    def __getitem__(self, index):
        return self._resolve()[index]

    def __repr__(self) -> str:
        return f"<ALL_CONSTRAINTS lazy: {len(self._resolve())} constraints>"


ALL_CONSTRAINTS = _LazyConstraintList()
