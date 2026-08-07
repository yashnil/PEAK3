"""Facts about what happened, from the committed award and postseason context.

WHY THIS FILE EXISTS
====================
`derived.py` reads a table of per-season totals — player, team, season, games.
Those four columns can describe tenure, workload and roster churn, and the first
bank was made almost entirely of that, which is why the manual review's verdict
was that the facts were "too dull to deserve homepage prominence".

`data/generated/player_season_context.parquet` is committed, covers 1980-2026,
and holds what actually happened: MVP and DPOY vote ranks, All-NBA and
All-Defense selections, All-Star nods, the five statistical titles, 50/40/90
seasons, championships, Finals MVPs and how deep a team went. 20,573 rows,
joining at 100% onto the season table.

That is a different KIND of fact, and it is still verified by construction: the
build recomputes every one of these, and `tests/test_nba_facts.py` re-derives a
sample straight from the parquet. Nothing here is authored.

NOT EVERY COLUMN IN THAT TABLE IS A FACT ABOUT BASKETBALL
=========================================================
The context table also carries columns this repository COMPUTES rather than
records, and two generators used to read one of them. Both are gone, and the
deletion is a correctness fix rather than a change of taste:

    gen_finals_mvp_not_best_player   "X won Finals MVP on a team he was not the
                                      best player on."
    gen_champion_role_players        "X won 3 championships without ever being
                                      the best player on the team."

Both branched on the table's role column, which is not a Basketball-Reference
observation at all: it is produced inside this repository by
`nba_peak/context/title_role.py`, a weighted z-score composite with a tunable
gap constant deciding where "co-best" ends. So each card printed a PEAK3 model
judgment as an unqualified fact and attributed it to Basketball-Reference, on
the one surface whose whole premise is that a visitor can evaluate it without
knowing what PEAK3 is.

Rewording would not have fixed it. "Who was the best player on that team" has
no external record to cite, so there is no sentence that makes the claim
sourceable; the only honest move is not to publish it. THE RULE THIS FILE NOW
RUNS UNDER: a generator may read a column only if the column records something
that happened. `tests/test_nba_facts.py::test_no_fact_depends_on_a_judgment_this_repository_computes`
scans every module in this package and fails if one of those columns comes back.

THE RULE THIS FILE IS WRITTEN UNDER
===================================
A single award is bookkeeping. "Bob McAdoo led the league in scoring in 1975-76"
is a row in a table, and the brief rules it out twice over — "dull bookkeeping",
"repetitive first/only player to… templates".

So almost every generator here emits a CONJUNCTION: two things that happened to
the same player in the same season and are surprising TOGETHER. A scoring title
and a lottery finish. An MVP and no Finals. An All-NBA First Team in a year the
team went home. Those are facts somebody repeats.

The exceptions are the ones where a single fact is genuinely rare: 50/40/90 (13
seasons in 47 years) and multi-season title streaks (Rodman's seven straight
rebounding titles), where the number IS the surprise.

WHAT THE COPY MAY NOT DO
========================
No generator here writes "the only player to". The data covers 1980 onward, so
"only" would be a claim about a window the reader is not told about — the exact
"plausible and wrong" shape the identity-collision guard in `derived.py` exists
to refuse. Where a count matters it is stated with its window.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Optional

from .derived import MULTI_TEAM_CODES, SEASONS_PATH, _era, _evidence, load_rows
from .schema import NbaFact, QualityScores, fact_id as _hash_id

_REPO_ROOT = Path(__file__).resolve().parents[2]

#: The committed context table. Same directory as the candidate universe and
#: the leaderboard CSVs, and covered by the same provenance file
#: (`data/generated/provenance.csv`) naming Basketball-Reference as the source
#: of every column used here.
CONTEXT_PATH = _REPO_ROOT / "data" / "generated" / "player_season_context.parquet"

SOURCE_LABEL = (
    "Basketball-Reference award voting, All-NBA/All-Defense selections and "
    "playoff brackets (1979-80 onward)"
)

SOURCE_DETAIL = (
    "Recomputed at build time from data/generated/player_season_context.parquet, "
    "whose per-column sourcing is recorded in data/generated/provenance.csv; the "
    "exact season rows are carried on the fact."
)

#: The five league-leader columns. Ordered so a season with more than one reads
#: in a stable order rather than in whatever order pandas returns.
TITLES: tuple[tuple[str, str], ...] = (
    ("scoring_title", "scoring"),
    ("rebound_title", "rebounding"),
    ("assist_title", "assists"),
    ("steals_title", "steals"),
    ("blocks_title", "blocks"),
)

TITLE_NOUN = dict(TITLES)


@lru_cache(maxsize=1)
def load_context() -> list[dict]:
    """Season rows joined to their award context, multi-team rows dropped.

    A `2TM` row is a season split across franchises, so "he led the league in
    steals for CHI" would name a team he only played half a year for. The same
    exclusion `derived.py` applies, for the same reason.
    """
    import pandas as pd

    if not CONTEXT_PATH.exists():
        raise FileNotFoundError(
            f"Award context missing at {CONTEXT_PATH}. It is committed; a "
            "checkout without it is broken rather than un-built."
        )
    rows = load_rows()
    seasons = pd.DataFrame(rows)
    # `load_rows` publishes `season_start` (the calendar year a season opens
    # in); the context table is keyed on `season_end`. One `+ 1` rather than a
    # second loader, so both halves of the bank read the same normalised,
    # identity-deduplicated rows — including the ambiguous-namesake drop that
    # `load_rows` applies and a raw read of the JSON would not.
    seasons["season_end"] = seasons["season_start"] + 1
    context = pd.read_parquet(CONTEXT_PATH)
    merged = seasons.merge(context, on=["player", "season_end"], how="inner")
    merged = merged[~merged["team"].isin(MULTI_TEAM_CODES)]
    return merged.to_dict("records")


def _num(row: dict, key: str) -> float:
    value = row.get(key)
    try:
        if value is None:
            return 0.0
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return 0.0 if number != number else number  # NaN


def _titles_for(row: dict) -> list[str]:
    return [noun for column, noun in TITLES if _num(row, column) > 0]


def _row_evidence(row: dict) -> tuple[dict, ...]:
    return _evidence(
        [
            {
                "player": row["player"],
                "team": row["team"],
                "season": row["season"],
                "games_played": row.get("games_played"),
            }
        ]
    )


def _fact(
    *,
    key: str,
    pattern: str,
    headline: str,
    body: str,
    category: str,
    row: dict,
    feature: str,
    feature_label: str,
    quality: dict,
    rows: Optional[Iterable[dict]] = None,
) -> NbaFact:
    return NbaFact(
        pattern=pattern,
        fact_id=_hash_id(category, key),
        headline=headline,
        body=body,
        category=category,
        era=_era(int(row["season_start"])),
        provenance="derived",
        source_label=SOURCE_LABEL,
        source_detail=SOURCE_DETAIL,
        verified=True,
        geography="usa",
        quality=QualityScores.from_dict(quality),
        feature=feature,
        feature_label=feature_label,
        evidence=(
            _evidence(rows) if rows is not None else _row_evidence(row)
        ),
        player_slug=row.get("player_slug"),
        team_code=row.get("team"),
    )


def _and_list(items: list[str]) -> str:
    if len(items) == 1:
        return items[0]
    return f"{', '.join(items[:-1])} and {items[-1]}"


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------


def _by_player(rows: list[dict], predicate) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        if predicate(row):
            grouped.setdefault(row["player_slug"], []).append(row)
    for seasons in grouped.values():
        seasons.sort(key=lambda r: r["season_end"])
    return dict(sorted(grouped.items()))


def _times(n: int) -> str:
    return {1: "once", 2: "twice", 3: "three times", 4: "four times",
            5: "five times", 6: "six times"}.get(n, f"{n} times")


def gen_fifty_forty_ninety(rows: list[dict]) -> list[NbaFact]:
    """A 50/40/90 season. Thirteen of them in forty-seven years.

    AGGREGATED PER PLAYER, not per season, and the duplicate check is what
    forced the question. Steve Nash has four of these; four cards reading
    "Steve Nash shot 50/40/90 in 2005-06 / 2007-08 / 2008-09 / 2009-10" is the
    same fact printed four times, which is precisely the repetitive-template
    shape the brief rules out. One card saying he did it four times is both
    shorter and more surprising.
    """
    out: list[NbaFact] = []
    for slug, seasons in _by_player(
        rows, lambda r: _num(r, "fifty_forty_ninety") > 0
    ).items():
        last = seasons[-1]
        if len(seasons) == 1:
            headline = (
                f"{last['player']} shot 50/40/90 in {last['season']} — a line "
                "the league produces about once every four years."
            )
            feature = "50/40/90"
            label = "one season"
        else:
            years = f"{seasons[0]['season']} to {last['season']}"
            headline = (
                f"{last['player']} put together a 50/40/90 season "
                f"{_times(len(seasons))}."
            )
            feature = _times(len(seasons)).title()
            label = years
        out.append(
            _fact(
                pattern="gen_fifty_forty_ninety",
                key=f"{slug}-504090",
                headline=headline,
                body=(
                    "Fifty per cent from the floor, forty from three and ninety "
                    "from the line, across a full season. Thirteen seasons since "
                    "1979-80 have cleared all three at once."
                ),
                category="records",
                row=last,
                feature=feature,
                feature_label=label,
                quality=dict(surprise=4, significance=4, clarity=5, broad_interest=4,
                             novelty=4, source_confidence=5, homepage_suitability=5),
                rows=seasons[:3],
            )
        )
    return out


def gen_multiple_titles_one_season(rows: list[dict]) -> list[NbaFact]:
    """Two league-leading categories in the same year."""
    out: list[NbaFact] = []
    for row in rows:
        titles = _titles_for(row)
        if len(titles) < 2:
            continue
        out.append(
            _fact(
                pattern="gen_multiple_titles_one_season",
                key=f"{row['player_slug']}-{row['season']}",
                headline=(
                    f"{row['player']} led the league in "
                    f"{_and_list(titles)} in the same season."
                ),
                body=(
                    f"{row['season']}, with {row['team']}. Leading two categories "
                    "at once usually means being the best at two jobs most players "
                    "only have one of."
                ),
                category="statistical_oddity",
                row=row,
                feature=str(len(titles)),
                feature_label="categories led",
                quality=dict(surprise=4, significance=4, clarity=5, broad_interest=4,
                             novelty=4, source_confidence=5, homepage_suitability=4),
            )
        )
    return out


def gen_title_without_playoffs(rows: list[dict]) -> list[NbaFact]:
    """Best in the league at something, and home in April."""
    out: list[NbaFact] = []
    for row in rows:
        titles = _titles_for(row)
        if not titles or _num(row, "made_playoffs") > 0:
            continue
        noun = titles[0]
        out.append(
            _fact(
                pattern="gen_title_without_playoffs",
                key=f"{row['player_slug']}-{row['season']}-{noun}",
                headline=(
                    f"{row['player']} led the NBA in {noun} and his team "
                    "missed the playoffs."
                ),
                body=(
                    f"{row['season']} with {row['team']}. Leading the league in "
                    "anything is a season most players never have; doing it on a "
                    "team that goes home in April is a different kind of season "
                    "entirely."
                ),
                category="statistical_oddity",
                row=row,
                feature=noun.title(),
                feature_label="led the league",
                quality=dict(surprise=4, significance=3, clarity=5, broad_interest=4,
                             novelty=4, source_confidence=5, homepage_suitability=4),
            )
        )
    return out


def gen_mvp_without_finals(rows: list[dict]) -> list[NbaFact]:
    """The league's best player, eliminated before the last series."""
    out: list[NbaFact] = []
    for row in rows:
        if _num(row, "mvp_rank") != 1 or _num(row, "finals_appearance") > 0:
            continue
        stage = str(row.get("playoff_round") or "").strip() or "the postseason"
        stage_text = (
            "his team missed the playoffs entirely"
            if _num(row, "made_playoffs") <= 0
            else f"his team went out in the {stage.lower()}"
        )
        out.append(
            _fact(
                pattern="gen_mvp_without_finals",
                key=f"{row['player_slug']}-{row['season']}",
                headline=(
                    f"{row['player']} was the league's MVP in {row['season']} "
                    "and never reached the Finals that year."
                ),
                body=(
                    f"With {row['team']}, {stage_text}. The award is voted on the "
                    "regular season, which is why the two things come apart more "
                    "often than the arguments about them suggest."
                ),
                category="records",
                row=row,
                feature="MVP",
                feature_label="no Finals",
                quality=dict(surprise=3, significance=4, clarity=5, broad_interest=5,
                             novelty=3, source_confidence=5, homepage_suitability=4),
            )
        )
    return out


def gen_mvp_and_dpoy(rows: list[dict]) -> list[NbaFact]:
    """Both awards, one season."""
    out: list[NbaFact] = []
    for row in rows:
        if _num(row, "mvp_rank") != 1 or _num(row, "dpoy_rank") != 1:
            continue
        out.append(
            _fact(
                pattern="gen_mvp_and_dpoy",
                key=f"{row['player_slug']}-{row['season']}",
                headline=(
                    f"{row['player']} won MVP and Defensive Player of the Year "
                    "in the same season."
                ),
                body=(
                    f"{row['season']}, with {row['team']}. The two awards have "
                    "gone to the same player in the same year three times since "
                    "the defensive award began."
                ),
                category="records",
                row=row,
                feature="MVP + DPOY",
                feature_label="one season",
                quality=dict(surprise=5, significance=5, clarity=5, broad_interest=5,
                             novelty=4, source_confidence=5, homepage_suitability=5),
            )
        )
    return out


def gen_dpoy_with_a_title(rows: list[dict]) -> list[NbaFact]:
    """The best defender in the league, also leading a counting category."""
    out: list[NbaFact] = []
    for row in rows:
        if _num(row, "dpoy_rank") != 1:
            continue
        titles = _titles_for(row)
        if not titles:
            continue
        out.append(
            _fact(
                pattern="gen_dpoy_with_a_title",
                key=f"{row['player_slug']}-{row['season']}",
                headline=(
                    f"{row['player']} was Defensive Player of the Year and led "
                    f"the league in {_and_list(titles)}."
                ),
                body=(
                    f"{row['season']}, with {row['team']}. The award is a vote; "
                    "the category lead is a count, and a season that wins both is "
                    "one nobody has to argue about."
                ),
                category="records",
                row=row,
                feature="DPOY",
                feature_label=f"and {titles[0]}",
                quality=dict(surprise=4, significance=4, clarity=5, broad_interest=4,
                             novelty=4, source_confidence=5, homepage_suitability=4),
            )
        )
    return out


# `gen_finals_mvp_not_best_player` STOOD HERE and is deleted rather than
# reworded. See the module docstring: it branched on the context table's role
# column, which this repository computes in `nba_peak/context/title_role.py`
# rather than reads from a record, so every card was a model judgment printed as
# a Basketball-Reference fact. There is no wording that makes "he was not the
# best player on that team" sourceable, so the fact does not exist.


def gen_champion_with_a_title(rows: list[dict]) -> list[NbaFact]:
    """A ring and a league-leading category in the same year.

    AGGREGATED PER PLAYER. Michael Jordan did this six times, and six cards
    saying so in six different years is one fact printed six times — the
    duplicate check caught it, and the answer to being caught is a better fact
    rather than five silent drops. "Six times" is also simply the more
    surprising sentence.
    """
    out: list[NbaFact] = []
    for slug, seasons in _by_player(
        rows,
        lambda r: _num(r, "championship") > 0 and bool(_titles_for(r)),
    ).items():
        last = seasons[-1]
        titles = sorted({noun for row in seasons for noun in _titles_for(row)})
        if len(seasons) == 1:
            headline = (
                f"{last['player']} led the NBA in {_and_list(titles)} and won "
                f"the title in the same season, in {last['season']}."
            )
            feature = "Both"
            label = f"{titles[0]} title + ring"
        else:
            headline = (
                f"{last['player']} led the NBA in {_and_list(titles)} and won "
                f"the title in the same season {_times(len(seasons))}."
            )
            feature = _times(len(seasons)).title()
            label = "led the league and won it"
        out.append(
            _fact(
                pattern="gen_champion_with_a_title",
                key=f"{slug}-champion-and-title",
                headline=headline,
                body=(
                    f"With {last['team']}, {seasons[0]['season']}"
                    + (f" to {last['season']}" if len(seasons) > 1 else "")
                    + ". Leading a category usually means carrying a volume the "
                    "best teams do not need from one player — which is why the "
                    "two rarely arrive together."
                ),
                category="playoffs_finals",
                row=last,
                feature=feature,
                feature_label=label,
                quality=dict(surprise=4, significance=4, clarity=4, broad_interest=4,
                             novelty=4, source_confidence=5, homepage_suitability=4),
                rows=seasons[:3],
            )
        )
    return out


def gen_all_nba_first_no_playoffs(rows: list[dict]) -> list[NbaFact]:
    """One of the five best players in the league, and no postseason.

    Aggregated per player for the same reason `gen_fifty_forty_ninety` is: two
    cards differing only in a season are one fact printed twice.
    """
    out: list[NbaFact] = []
    for slug, seasons in _by_player(
        rows,
        lambda r: _num(r, "all_nba_team") == 1 and _num(r, "made_playoffs") <= 0,
    ).items():
        last = seasons[-1]
        when = (
            f"in {last['season']}"
            if len(seasons) == 1
            else f"{_times(len(seasons))}, from {seasons[0]['season']}"
        )
        out.append(
            _fact(
                pattern="gen_all_nba_first_no_playoffs",
                key=f"{slug}-all-nba-no-playoffs",
                headline=(
                    f"{last['player']} made All-NBA First Team {when} in a season "
                    "his team missed the playoffs."
                ),
                body=(
                    f"With {last['team']}. Voters put him among the five best "
                    "players in the league; his team still finished outside the "
                    "bracket."
                ),
                category="statistical_oddity",
                row=last,
                feature="All-NBA 1st",
                feature_label="no playoffs",
                quality=dict(surprise=4, significance=4, clarity=5, broad_interest=4,
                             novelty=4, source_confidence=5, homepage_suitability=4),
                rows=seasons[:3],
            )
        )
    return out


def gen_title_streaks(rows: list[dict], minimum: int = 3) -> list[NbaFact]:
    """Leading the league in one category for consecutive seasons."""
    out: list[NbaFact] = []
    for column, noun in TITLES:
        by_player: dict[str, list[dict]] = {}
        for row in rows:
            if _num(row, column) > 0:
                by_player.setdefault(row["player_slug"], []).append(row)
        for slug, seasons in sorted(by_player.items()):
            seasons.sort(key=lambda r: r["season_end"])
            run: list[dict] = []
            best: list[dict] = []
            for row in seasons:
                if run and row["season_end"] == run[-1]["season_end"] + 1:
                    run.append(row)
                else:
                    run = [row]
                if len(run) > len(best):
                    best = list(run)
            if len(best) < minimum:
                continue
            first, last = best[0], best[-1]
            out.append(
                _fact(
                    pattern="gen_title_streaks",
                    key=f"{slug}-{noun}-streak",
                    headline=(
                        f"{first['player']} led the NBA in {noun} for "
                        f"{len(best)} seasons in a row."
                    ),
                    body=(
                        f"{first['season']} through {last['season']}. A category "
                        "lead is one season of being the best at something; a run "
                        "of them is a whole era of it."
                    ),
                    category="streaks",
                    row=last,
                    feature=str(len(best)),
                    feature_label=f"straight {noun} titles",
                    quality=dict(surprise=4, significance=4, clarity=5, broad_interest=5,
                                 novelty=4, source_confidence=5, homepage_suitability=5),
                    rows=[first, last],
                )
            )
    return out


def _selection_streaks(
    rows: list[dict],
    predicate,
    minimum: int,
    pattern: str,
    key_suffix: str,
    headline: str,
    body: str,
    feature_label: str,
    category: str,
    quality: dict,
) -> list[NbaFact]:
    by_player: dict[str, list[dict]] = {}
    for row in rows:
        if predicate(row):
            by_player.setdefault(row["player_slug"], []).append(row)
    out: list[NbaFact] = []
    for slug, seasons in sorted(by_player.items()):
        seasons.sort(key=lambda r: r["season_end"])
        run: list[dict] = []
        best: list[dict] = []
        for row in seasons:
            if run and row["season_end"] == run[-1]["season_end"] + 1:
                run.append(row)
            else:
                run = [row]
            if len(run) > len(best):
                best = list(run)
        if len(best) < minimum:
            continue
        first, last = best[0], best[-1]
        out.append(
            _fact(
                pattern=pattern,
                key=f"{slug}-{key_suffix}",
                headline=headline.format(
                    player=first["player"], n=len(best)
                ),
                body=body.format(
                    first=first["season"], last=last["season"], n=len(best)
                ),
                category=category,
                row=last,
                feature=str(len(best)),
                feature_label=feature_label,
                quality=quality,
                rows=[first, last],
            )
        )
    return out


def gen_all_star_streaks(rows: list[dict], minimum: int = 10) -> list[NbaFact]:
    return _selection_streaks(
        rows,
        lambda r: _num(r, "all_star") > 0,
        minimum,
        "gen_all_star_streaks",
        "all-star-streak",
        "{player} was an All-Star {n} years running.",
        "{first} through {last}. Ten straight is roughly a decade of being, "
        "every single year, one of the two dozen players the league puts on that "
        "floor.",
        "straight All-Star years",
        "streaks",
        dict(surprise=3, significance=4, clarity=5, broad_interest=4,
             novelty=3, source_confidence=5, homepage_suitability=4),
    )


def gen_all_nba_streaks(rows: list[dict], minimum: int = 8) -> list[NbaFact]:
    return _selection_streaks(
        rows,
        lambda r: r.get("all_nba_team") is not None and _num(r, "all_nba_team") > 0,
        minimum,
        "gen_all_nba_streaks",
        "all-nba-streak",
        "{player} made an All-NBA team {n} seasons in a row.",
        "{first} through {last}. Fifteen places exist each year across the three "
        "teams, and holding one of them for {n} consecutive seasons is a career "
        "most players would take whole.",
        "straight All-NBA teams",
        "streaks",
        dict(surprise=3, significance=4, clarity=5, broad_interest=4,
             novelty=3, source_confidence=5, homepage_suitability=4),
    )


def gen_all_defense_streaks(rows: list[dict], minimum: int = 6) -> list[NbaFact]:
    return _selection_streaks(
        rows,
        lambda r: r.get("all_defense_team") is not None
        and _num(r, "all_defense_team") > 0,
        minimum,
        "gen_all_defense_streaks",
        "all-defense-streak",
        "{player} was named All-Defense {n} seasons in a row.",
        "{first} through {last}. Defensive recognition is the least stable thing "
        "voters hand out, which is what makes a run of {n} unusual rather than "
        "merely long.",
        "straight All-Defense teams",
        "streaks",
        dict(surprise=4, significance=3, clarity=5, broad_interest=4,
             novelty=4, source_confidence=4, homepage_suitability=4),
    )


def gen_deep_runs_without_a_ring(rows: list[dict], minimum: int = 5) -> list[NbaFact]:
    """Conference finals, repeatedly, and never a title."""
    by_player: dict[str, list[dict]] = {}
    for row in rows:
        if _num(row, "conf_finals") > 0:
            by_player.setdefault(row["player_slug"], []).append(row)
    out: list[NbaFact] = []
    for slug, seasons in sorted(by_player.items()):
        if any(_num(row, "championship") > 0 for row in seasons):
            continue
        if len(seasons) < minimum:
            continue
        seasons.sort(key=lambda r: r["season_end"])
        first, last = seasons[0], seasons[-1]
        out.append(
            _fact(
                pattern="gen_deep_runs_without_a_ring",
                key=f"{slug}-conf-finals-no-ring",
                headline=(
                    f"{first['player']} reached the conference finals "
                    f"{len(seasons)} times and never won a title."
                ),
                body=(
                    f"{first['season']} through {last['season']}. The last round "
                    "before the last round, over and over — a career shape the "
                    "record book has no column for."
                ),
                category="playoffs_finals",
                row=last,
                feature=str(len(seasons)),
                feature_label="conference finals",
                quality=dict(surprise=4, significance=4, clarity=5, broad_interest=5,
                             novelty=4, source_confidence=4, homepage_suitability=5),
                rows=[first, last],
            )
        )
    return out


# `gen_champion_role_players` STOOD HERE and is deleted for the same reason.
# "JaVale McGee won 3 championships without ever being the best player on the
# team" reads as a record of three rings and is in fact a claim about a ranking
# this repository computed, with `CO_BEST_GAP = 0.60` deciding who counts as a
# secondary star. The ring count is checkable; the clause that makes it a story
# is not, and a fact is not the sum of a true half and an unsourceable one.


def gen_mvp_runners_up_who_never_won(rows: list[dict]) -> list[NbaFact]:
    """Second in the MVP vote, and never first."""
    by_player: dict[str, list[dict]] = {}
    for row in rows:
        if _num(row, "mvp_rank") > 0:
            by_player.setdefault(row["player_slug"], []).append(row)
    out: list[NbaFact] = []
    for slug, seasons in sorted(by_player.items()):
        if any(_num(row, "mvp_rank") == 1 for row in seasons):
            continue
        seconds = [row for row in seasons if _num(row, "mvp_rank") == 2]
        if not seconds:
            continue
        seconds.sort(key=lambda r: r["season_end"])
        first = seconds[0]
        times = (
            f"{len(seconds)} times" if len(seconds) > 1 else f"in {first['season']}"
        )
        out.append(
            _fact(
                pattern="gen_mvp_runners_up_who_never_won",
                key=f"{slug}-mvp-runner-up",
                headline=(
                    f"{first['player']} finished second in MVP voting {times}, "
                    "and never won it."
                ),
                body=(
                    f"First runner-up in {first['season']} with {first['team']}. "
                    "The award has one winner a year, which means the list of "
                    "players who were nearly the best in the league is longer "
                    "than the list of players who were."
                ),
                category="connections",
                row=first,
                feature="2nd",
                feature_label="never first",
                quality=dict(surprise=4, significance=3, clarity=5, broad_interest=4,
                             novelty=4, source_confidence=5, homepage_suitability=4),
            )
        )
    return out


def gen_all_star_no_playoffs_streak(rows: list[dict], minimum: int = 3) -> list[NbaFact]:
    """An All-Star, repeatedly, on teams that went home."""
    by_player: dict[str, list[dict]] = {}
    for row in rows:
        if _num(row, "all_star") > 0 and _num(row, "made_playoffs") <= 0:
            by_player.setdefault(row["player_slug"], []).append(row)
    out: list[NbaFact] = []
    for slug, seasons in sorted(by_player.items()):
        if len(seasons) < minimum:
            continue
        seasons.sort(key=lambda r: r["season_end"])
        first, last = seasons[0], seasons[-1]
        out.append(
            _fact(
                pattern="gen_all_star_no_playoffs_streak",
                key=f"{slug}-all-star-lottery",
                headline=(
                    f"{first['player']} was an All-Star {len(seasons)} times on "
                    "teams that missed the playoffs."
                ),
                body=(
                    f"{first['season']} through {last['season']}. Individual "
                    "recognition and team results are measured on different "
                    "scales, and some careers spend a decade in the gap."
                ),
                category="player_story",
                row=last,
                feature=str(len(seasons)),
                feature_label="All-Star lottery years",
                quality=dict(surprise=4, significance=3, clarity=5, broad_interest=4,
                             novelty=4, source_confidence=5, homepage_suitability=4),
                rows=[first, last],
            )
        )
    return out


#: Every generator, in a fixed order. Order affects nothing about selection —
#: the bank is sorted by `fact_id` before it is written — and exists so a
#: regenerated bank is byte-identical.
AWARD_GENERATORS = (
    gen_fifty_forty_ninety,
    gen_multiple_titles_one_season,
    gen_title_without_playoffs,
    gen_mvp_without_finals,
    gen_mvp_and_dpoy,
    gen_dpoy_with_a_title,
    gen_champion_with_a_title,
    gen_all_nba_first_no_playoffs,
    gen_title_streaks,
    gen_all_star_streaks,
    gen_all_nba_streaks,
    gen_all_defense_streaks,
    gen_deep_runs_without_a_ring,
    gen_mvp_runners_up_who_never_won,
    gen_all_star_no_playoffs_streak,
)


__all__ = [
    "AWARD_GENERATORS",
    "CONTEXT_PATH",
    "SOURCE_LABEL",
    "load_context",
]
