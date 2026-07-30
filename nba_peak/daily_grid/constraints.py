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
  award      MVP / DPOY / Finals MVP / All-NBA / All-Defense / All-Star,
             from the scored table's own award columns.
  era        decade of the season's start year.
  position   the position the player logged THAT season.
  peak       PEAK3 prime_score thresholds.
  component  top-decile seasons in one of the five PEAK3 components.
  outcome    how far that season's team actually went in the playoffs.

EXCLUSIVE GROUPS
Two constraints sharing an `exclusive_group` must never appear on opposite
axes of the same board, for one of two reasons:
  - MUTUALLY EXCLUSIVE: a player-season has exactly one team, one decade,
    one position. "Lakers x Celtics" has no answers, ever.
  - NESTED: "85+ PEAK" is a strict subset of "80+ PEAK", so crossing them
    makes the outer constraint decoration rather than a real second
    condition. Same for MVP inside MVP-top-5, All-NBA 1st inside All-NBA,
    and the champion/finals/conference-finals ladder.
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

from nba_peak.daily_grid.pool import GridPool, load_pool

CONSTRAINTS_VERSION = "daily_grid_constraints.v1"

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

    def matches(self, frame: pd.DataFrame) -> np.ndarray:
        return np.asarray(self.mask(frame), dtype=bool)

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

# Current franchise -> every Basketball-Reference team code that franchise has
# played under since 1979-80. Real, publicly documented franchise history:
# relocations and renames only, never a merger of distinct franchises. The
# 1988-2002 Charlotte Hornets (CHH) are grouped with today's Charlotte
# Hornets/Bobcats (CHO/CHA) because the current franchise holds that history
# and records; the 2002+ New Orleans franchise (NOH/NOK/NOP) is its own entry.
FRANCHISES: dict[str, tuple[str, tuple[str, ...]]] = {
    "ATL": ("Atlanta Hawks", ("ATL",)),
    "BOS": ("Boston Celtics", ("BOS",)),
    "BRK": ("Brooklyn Nets", ("BRK", "NJN")),
    "CHA": ("Charlotte Hornets", ("CHO", "CHA", "CHH")),
    "CHI": ("Chicago Bulls", ("CHI",)),
    "CLE": ("Cleveland Cavaliers", ("CLE",)),
    "DAL": ("Dallas Mavericks", ("DAL",)),
    "DEN": ("Denver Nuggets", ("DEN",)),
    "DET": ("Detroit Pistons", ("DET",)),
    "GSW": ("Golden State Warriors", ("GSW",)),
    "HOU": ("Houston Rockets", ("HOU",)),
    "IND": ("Indiana Pacers", ("IND",)),
    "LAC": ("Los Angeles Clippers", ("LAC", "SDC")),
    "LAL": ("Los Angeles Lakers", ("LAL",)),
    "MEM": ("Memphis Grizzlies", ("MEM", "VAN")),
    "MIA": ("Miami Heat", ("MIA",)),
    "MIL": ("Milwaukee Bucks", ("MIL",)),
    "MIN": ("Minnesota Timberwolves", ("MIN",)),
    "NOP": ("New Orleans Pelicans", ("NOP", "NOH", "NOK")),
    "NYK": ("New York Knicks", ("NYK",)),
    "OKC": ("Oklahoma City Thunder", ("OKC", "SEA")),
    "ORL": ("Orlando Magic", ("ORL",)),
    "PHI": ("Philadelphia 76ers", ("PHI",)),
    "PHO": ("Phoenix Suns", ("PHO",)),
    "POR": ("Portland Trail Blazers", ("POR",)),
    "SAC": ("Sacramento Kings", ("SAC", "KCK")),
    "SAS": ("San Antonio Spurs", ("SAS",)),
    "TOR": ("Toronto Raptors", ("TOR",)),
    "UTA": ("Utah Jazz", ("UTA",)),
    "WAS": ("Washington Wizards", ("WAS", "WSB")),
}


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
        ),
        Constraint(
            id="award_dpoy_votes",
            label="DPOY Votes",
            short_label="DPOY Votes",
            category="award",
            exclusive_group="dpoy",
            description="Received Defensive Player of the Year votes that season.",
            mask=lambda f: f["dpoy_rank"].notna().to_numpy(),
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
        "Elite Postseason Value",
        "Top 10% Postseason",
        "Postseason Value",
    ),
    (
        "comp_team_achievement",
        "team_achievement",
        "Elite Team Achievement",
        "Top 10% Team",
        "Team Achievement",
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
        + _peak_constraints()
        + _component_constraints(pool)
        + _outcome_constraints()
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
