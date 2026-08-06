"""NBA Fact of the Day: a deterministic, evidence-carrying trivia bank.

WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
----------------------------------------------
Facts about NBA HISTORY -- tenures, age seasons, role players, streaks, unusual
career arcs, rare statistical thresholds -- derived from the committed
per-season data this repository already carries. They are not PEAK3 insights and
must never be branded as any: nothing in a fact's text depends on the model's
weights, its calibration or its component scores, and a reader who has never
heard of PEAK3 should find every one of them complete.

That separation is a product rule with a practical edge. "PEAK3 rates Jordan's
1990-91 as the best season ever" is a claim about a model; "Dennis Rodman led
the league in rebounding for seven straight seasons across three franchises" is
a claim about basketball. Only the second belongs on a homepage that a visitor
lands on before they know what the model is.

NO LLM, AND NOTHING GENERATED AT REQUEST TIME
----------------------------------------------
Every fact is produced by a GENERATOR here -- a function that queries the
committed season table, finds every row matching a pattern, and emits one fact
per match with the rows that prove it attached. Three consequences, all
deliberate:

  * A fact cannot be wrong in a way nobody can check. `evidence` names the exact
    (player, team, season) rows it was computed from, and
    `tests/test_nba_facts.py` re-derives a sample straight from the parquet.
  * The bank is a build artifact. `scripts/build_nba_facts.py` writes it once;
    the API serves a small precomputed payload and does no analysis per request.
  * It is reproducible. Same data in, same bank out, byte for byte -- so a
    regenerated bank that differs is a data change, not a nondeterministic
    generator.

SELECTION IS BY CALENDAR DATE, AND IS A PURE FUNCTION
------------------------------------------------------
`fact_for_date` hashes the ISO date against the bank version and indexes the
sorted bank. Every visitor sees the same fact on the same day, tomorrow's is
already determined, and no state is stored anywhere. Consecutive dates are
guaranteed not to repeat -- see `fact_for_date` for why a plain hash is not
enough on its own.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Optional

from .schema import NbaFact, QualityScores, fact_id as _hash_id

_REPO_ROOT = Path(__file__).resolve().parents[2]

#: The per-season source. Committed, and the same file the eligibility index
#: reads -- so a fact and a draft card cannot disagree about who played where.
SEASONS_PATH = (
    _REPO_ROOT
    / "data"
    / "game"
    / "experimental"
    / "player_pool_1500"
    / "all_seasons_for_identities.v1.json"
)

SOURCE_LABEL = "Basketball-Reference per-season totals (1979-80 onward)"

#: A career span, in years, past which a slug is almost certainly TWO PEOPLE.
#:
#: THIS IS A REAL CORRECTION, NOT A SAFETY MARGIN. Slugs are derived from names,
#: so a father and son -- or any two namesakes -- collapse into one identity:
#: `johnny-davis` spans 45 years, `mike-dunleavy` 36, `bobby-jones` 27. Left in,
#: the generators produce confident nonsense ("Bobby Jones left PHI after
#: 1985-86 and returned 21 years later"), which is exactly the class of
#: plausible-and-wrong trivia a fact bank exists to prevent.
#:
#: 23 clears the longest genuine NBA careers with room to spare (Vince Carter's
#: 22 seasons is the record) and catches all six colliding slugs in the current
#: source. Those identities are DROPPED rather than split: splitting them would
#: mean guessing which rows belong to whom, and a guess is what this constant
#: exists to refuse.
MAX_CAREER_SPAN_YEARS = 23

#: Multi-team aggregate rows. A "team" for one of these is not a team.
MULTI_TEAM_CODES = frozenset({"2TM", "3TM", "4TM", "5TM", "TOT"})

# ---------------------------------------------------------------------------
# Source rows
# ---------------------------------------------------------------------------


def _season_start(season: str) -> int:
    return int(str(season)[:4])


def _era(season_start: int) -> str:
    return f"{(season_start // 10) * 10}s"


def load_rows(path: Path | None = None) -> list[dict]:
    """Every real single-team player-season, normalised and sorted.

    Aggregate rows are dropped rather than attributed: a "2TM" season did not
    happen at a team, so a fact about a tenure or a franchise streak cannot be
    built from one. They still exist in the source; they are simply not a
    membership fact, which is the same call `three_man_weave.eligibility` makes
    for the same reason.
    """
    load_path = path or SEASONS_PATH
    payload = json.loads(load_path.read_text())
    rows: list[dict] = []
    for row in payload.get("rows", []):
        team = str(row.get("team") or "").strip().upper()
        season = row.get("season")
        slug = row.get("player_slug")
        if not team or not season or not slug or team in MULTI_TEAM_CODES:
            continue
        rows.append(
            {
                "player_slug": slug,
                "player": row.get("player") or slug,
                "team": team,
                "season": season,
                "season_start": _season_start(season),
                "games_played": _number(row.get("games_played")),
                "minutes": _number(row.get("minutes_played") or row.get("mp")),
                "position": (row.get("position") or row.get("pos") or "").strip(),
            }
        )
    rows.sort(key=lambda row: (row["player_slug"], row["season_start"], row["team"]))
    return _drop_ambiguous_identities(rows)


def _drop_ambiguous_identities(rows: list[dict]) -> list[dict]:
    """Remove slugs whose span makes them two people. See `MAX_CAREER_SPAN_YEARS`."""
    spans: dict[str, list[int]] = {}
    for row in rows:
        spans.setdefault(row["player_slug"], []).append(row["season_start"])
    ambiguous = {
        slug
        for slug, years in spans.items()
        if max(years) - min(years) > MAX_CAREER_SPAN_YEARS
    }
    return [row for row in rows if row["player_slug"] not in ambiguous]


def _number(value) -> Optional[float]:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _evidence(rows: Iterable[dict]) -> tuple[dict, ...]:
    """The proving rows, trimmed to the fields a reader can check."""
    return tuple(
        {
            "player": row["player"],
            "team": row["team"],
            "season": row["season"],
            "games_played": row["games_played"],
        }
        for row in rows
    )


def _fact_id(category: str, *parts: str) -> str:
    """The shared id hasher, kept under the old name so every generator below
    reads unchanged."""
    return _hash_id(category, *parts)


def _by_player(rows: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["player_slug"], []).append(row)
    return grouped



# ---------------------------------------------------------------------------
# From a generator's output to a publishable fact
# ---------------------------------------------------------------------------

#: WHERE EACH GENERATOR'S OUTPUT BELONGS IN THE NEW VOCABULARY. The seven
#: original categories were named after the SQL that produced them; these are
#: named after what a reader would say the fact is about.
_CATEGORY_MAP = {
    "franchise_tenure": "franchise",
    "age_season": "player_story",
    "role_player": "role_players",
    "career_arc": "player_story",
    "streak": "streaks",
    "rare_threshold": "statistical_oddity",
    "era_anomaly": "connections",
}

#: QUALITY, SCORED PER GENERATOR AND SCORED HONESTLY.
#:
#: This is the part of the pass that had to be written down rather than felt.
#: The old bank published everything a generator produced, and the review named
#: the result exactly: "Ricky Pierce played exactly one season for each of four
#: franchises" — true, checkable, and not worth a homepage. A generator finds a
#: PATTERN; whether the pattern is interesting is a separate question, and it
#: had never been asked.
#:
#: So each generator's output is scored on the seven axes, and three of the nine
#: score below the floor on purpose:
#:
#:   one-and-done stints        broad_interest 2 — the fact the review quoted
#:   heavy-minute role players  broad_interest 2, homepage 2
#:   franchise era anchors      total 22, under the 23 floor
#:
#: They are still GENERATED, still counted in the report, and still rejected by
#: name, which is more useful than deleting the generator: the report says how
#: many candidates each produced and why none of them shipped.
#:
#: TWO MORE WERE RE-SCORED DOWN AFTER READING THE CARDS. The first sheet of
#: frames put this on a homepage:
#:
#:     "A.C. Green left LAL after 1992-93 and returned 7 years later, in
#:      1999-00. Two separate stints at the same franchise."
#:
#: which is precisely what the brief asks the bank not to be dominated by —
#: "players switching teams", "dull bookkeeping", and a supporting sentence that
#: restates the headline. `franchise_return` and `many_franchise` are both that
#: shape, and both now score `broad_interest: 2`, under the floor. Scoring them
#: honestly rather than deleting them keeps the count visible in the report.
_QUALITY = {
    "franchise_tenure": dict(surprise=3, significance=3, clarity=4, broad_interest=3,
                             novelty=3, source_confidence=5, homepage_suitability=3),
    "many_franchise": dict(surprise=3, significance=2, clarity=4, broad_interest=2,
                           novelty=3, source_confidence=5, homepage_suitability=2),
    "late_career": dict(surprise=3, significance=3, clarity=4, broad_interest=3,
                        novelty=3, source_confidence=5, homepage_suitability=3),
    "iron_man": dict(surprise=4, significance=3, clarity=4, broad_interest=3,
                     novelty=4, source_confidence=5, homepage_suitability=3),
    "era_anchor": dict(surprise=2, significance=3, clarity=4, broad_interest=3,
                       novelty=2, source_confidence=5, homepage_suitability=3),
    "one_and_done": dict(surprise=2, significance=2, clarity=4, broad_interest=2,
                         novelty=2, source_confidence=5, homepage_suitability=2),
    "heavy_minutes": dict(surprise=3, significance=2, clarity=3, broad_interest=2,
                          novelty=3, source_confidence=5, homepage_suitability=2),
    "cross_decade": dict(surprise=4, significance=3, clarity=4, broad_interest=4,
                         novelty=3, source_confidence=5, homepage_suitability=4),
    "franchise_return": dict(surprise=3, significance=2, clarity=4, broad_interest=2,
                             novelty=3, source_confidence=5, homepage_suitability=2),
}

#: Which score profile a fact gets, from the id prefix its generator used.
#: Keyed on the id rather than on the category because several generators share
#: a category and they are not equally interesting.
_PROFILE_BY_PREFIX = (
    ("franchise_tenure", "franchise_tenure"),
    ("career_arc", "many_franchise"),
    ("age_season", "late_career"),
    ("streak", "iron_man"),
    ("rare_threshold", "heavy_minutes"),
    ("role_player", "one_and_done"),
    ("era_anomaly", "cross_decade"),
)

#: Generators that share a legacy category, disambiguated by the extra token
#: their `_fact_id` call passes. Set by `_derived`'s `profile=` argument.
_DEFAULT_PROFILE = "franchise_tenure"


def _ordinal(n: int) -> str:
    """`23rd`, not `23th`.

    FOUND BY READING A REVIEW FRAME, not by a test. The longevity generator
    wrote `f"{len(seasons)}th"` and had done since it was written, so the
    homepage published "his 23th recorded season" — correct arithmetic in
    incorrect English, on the surface a visitor sees first. 11/12/13 take
    `th` despite ending in 1/2/3, which is the whole reason this is a function
    rather than a lookup on the last digit.
    """
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }".replace(" ", "")


def _split(text: str) -> tuple[str, str]:
    """A generated sentence, as a headline and a body.

    The generators write one long sentence with an em-dash before the payoff,
    which is exactly where a card wants to break: the claim, then why it is
    worth reading."""
    for separator in (" \u2014 ", " -- "):
        head, sep, rest = text.partition(separator)
        if sep:
            return head.strip() + ".", rest.strip()[:1].upper() + rest.strip()[1:]
    head, sep, rest = text.partition(". ")
    return (head + ".") if sep else text, rest


def _derived(*, fact_id: str, text: str, category: str, era: str,
             source_label: str, evidence=(), player_slug=None, team_code=None,
             profile: Optional[str] = None, feature: Optional[str] = None,
             feature_label: Optional[str] = None) -> NbaFact:
    """One generated fact.

    `feature` IS NOT OPTIONAL IN PRACTICE, whatever the signature says. The
    card sets it large against a court motif, and a fact without one collapses
    to a headline and a thin line — which is exactly how the first sheet of
    frames came back for every derived fact while the curated ones looked
    finished. Every generator passes one; the default exists so a new generator
    fails visibly rather than at import.
    """
    headline, body = _split(text)
    key = profile or _DEFAULT_PROFILE
    scores = _QUALITY[key]
    return NbaFact(
        fact_id=fact_id,
        # `profile` already names the generator one-for-one, so it is the
        # pattern the cap counts. One identifier, not two that can disagree.
        pattern=f"derived:{key}",
        headline=headline,
        body=body,
        category=_CATEGORY_MAP.get(category, category),
        era=era,
        provenance="derived",
        source_label=source_label,
        source_detail=(
            "Recomputed at build time from the committed per-season table; the "
            "exact rows are carried on the fact."
        ),
        verified=True,
        geography="usa",
        quality=QualityScores.from_dict(scores),
        feature=feature,
        feature_label=feature_label,
        evidence=tuple(evidence),
        player_slug=player_slug,
        team_code=team_code,
    )


def gen_long_single_franchise_tenures(rows: list[dict], minimum: int = 15) -> list[NbaFact]:
    """A career spent almost entirely at one franchise -- rarer than it sounds."""
    out: list[NbaFact] = []
    for slug, seasons in sorted(_by_player(rows).items()):
        teams = {row["team"] for row in seasons}
        if len(teams) != 1 or len(seasons) < minimum:
            continue
        team = next(iter(teams))
        first, last = seasons[0], seasons[-1]
        out.append(
            _derived(
                profile="franchise_tenure",
                feature=str(len(seasons)),
                feature_label="seasons, one team",
                fact_id=_fact_id("franchise_tenure", slug, team),
                text=(
                    f"{first['player']} played all {len(seasons)} of his recorded "
                    f"seasons for one franchise ({team}), from {first['season']} to "
                    f"{last['season']} — a one-team career of a length the modern "
                    "league almost never produces."
                ),
                category="franchise_tenure",
                era=_era(first["season_start"]),
                source_label=SOURCE_LABEL,
                evidence=_evidence([first, last]),
                player_slug=slug,
                team_code=team,
            )
        )
    return out


def gen_many_franchise_journeymen(rows: list[dict], minimum: int = 8) -> list[NbaFact]:
    """The opposite shape: a career spread across many franchises."""
    out: list[NbaFact] = []
    for slug, seasons in sorted(_by_player(rows).items()):
        teams = sorted({row["team"] for row in seasons})
        if len(teams) < minimum:
            continue
        first = seasons[0]
        out.append(
            _derived(
                profile="many_franchise",
                feature=str(len(teams)),
                feature_label="franchises",
                fact_id=_fact_id("career_arc", slug, "journeyman"),
                text=(
                    f"{first['player']} suited up for {len(teams)} different "
                    f"franchises — {', '.join(teams)} — across {len(seasons)} "
                    "recorded seasons."
                ),
                category="career_arc",
                era=_era(first["season_start"]),
                source_label=SOURCE_LABEL,
                evidence=_evidence(seasons[:4]),
                player_slug=slug,
            )
        )
    return out


def gen_late_career_workloads(rows: list[dict], minimum_season: int = 20) -> list[NbaFact]:
    """A twentieth season, or beyond. The list is short and gets shorter."""
    out: list[NbaFact] = []
    for slug, seasons in sorted(_by_player(rows).items()):
        if len(seasons) < minimum_season:
            continue
        first, last = seasons[0], seasons[-1]
        out.append(
            _derived(
                profile="late_career",
                feature=_ordinal(len(seasons)),
                feature_label="season",
                fact_id=_fact_id("age_season", slug, "longevity"),
                text=(
                    f"{first['player']} was still on an NBA roster in his "
                    f"{_ordinal(len(seasons))} recorded season, {last['season']} with "
                    f"{last['team']} — {last['season_start'] - first['season_start']} "
                    f"years after his first, in {first['season']}."
                ),
                category="age_season",
                era=_era(last["season_start"]),
                source_label=SOURCE_LABEL,
                evidence=_evidence([first, last]),
                player_slug=slug,
            )
        )
    return out


def gen_iron_man_seasons(rows: list[dict], streak: int = 6) -> list[NbaFact]:
    """Consecutive seasons of 80+ games. A durability fact, not a quality one."""
    out: list[NbaFact] = []
    for slug, seasons in sorted(_by_player(rows).items()):
        run: list[dict] = []
        best: list[dict] = []
        previous: Optional[int] = None
        for row in seasons:
            heavy = (row["games_played"] or 0) >= 80
            contiguous = previous is None or row["season_start"] == previous + 1
            if heavy and contiguous:
                run.append(row)
            elif heavy:
                run = [row]
            else:
                run = []
            previous = row["season_start"]
            if len(run) > len(best):
                best = list(run)
        if len(best) < streak:
            continue
        out.append(
            _derived(
                profile="iron_man",
                feature=str(len(best)),
                feature_label="straight seasons",
                fact_id=_fact_id("streak", slug, "iron_man"),
                text=(
                    f"{best[0]['player']} played at least 80 games in "
                    f"{len(best)} straight seasons, {best[0]['season']} through "
                    f"{best[-1]['season']} — an availability run most careers "
                    "never string together once."
                ),
                category="streak",
                era=_era(best[0]["season_start"]),
                source_label=SOURCE_LABEL,
                evidence=_evidence([best[0], best[-1]]),
                player_slug=slug,
            )
        )
    return out


def gen_franchise_era_anchors(rows: list[dict], minimum: int = 10) -> list[NbaFact]:
    """A decade or more at one franchise, inside a longer career elsewhere."""
    out: list[NbaFact] = []
    for slug, seasons in sorted(_by_player(rows).items()):
        by_team: dict[str, list[dict]] = {}
        for row in seasons:
            by_team.setdefault(row["team"], []).append(row)
        if len(by_team) < 2:
            continue  # covered by the one-team generator
        for team, stint in sorted(by_team.items()):
            if len(stint) < minimum:
                continue
            out.append(
                _derived(
                    profile="era_anchor",
                    feature=str(len(stint)),
                    feature_label="seasons there",
                fact_id=_fact_id("franchise_tenure", slug, team, "anchor"),
                    text=(
                        f"{stint[0]['player']} spent {len(stint)} seasons with "
                        f"{team} ({stint[0]['season']}–{stint[-1]['season']}) and "
                        f"still finished his career somewhere else — he appeared "
                        f"for {len(by_team)} franchises in all."
                    ),
                    category="franchise_tenure",
                    era=_era(stint[0]["season_start"]),
                    source_label=SOURCE_LABEL,
                    evidence=_evidence([stint[0], stint[-1]]),
                    player_slug=slug,
                    team_code=team,
                )
            )
    return out


def gen_one_and_done_stints(rows: list[dict]) -> list[NbaFact]:
    """A single season at a franchise, inside a long career. The forgotten stint."""
    out: list[NbaFact] = []
    for slug, seasons in sorted(_by_player(rows).items()):
        if len(seasons) < 12:
            continue
        by_team: dict[str, list[dict]] = {}
        for row in seasons:
            by_team.setdefault(row["team"], []).append(row)
        singles = sorted(team for team, stint in by_team.items() if len(stint) == 1)
        if len(singles) < 2 or len(by_team) < 4:
            continue
        stints = [by_team[team][0] for team in singles]
        out.append(
            _derived(
                profile="one_and_done",
                feature=str(len(singles)),
                feature_label="one-season stops",
                fact_id=_fact_id("career_arc", slug, "single_seasons"),
                text=(
                    f"{seasons[0]['player']} played exactly one season for each of "
                    f"{len(singles)} different franchises — "
                    + ", ".join(
                        f"{row['team']} in {row['season']}" for row in stints[:3]
                    )
                    + " — inside a career that ran to "
                    f"{len(seasons)} recorded seasons."
                ),
                category="career_arc",
                era=_era(seasons[0]["season_start"]),
                source_label=SOURCE_LABEL,
                evidence=_evidence(stints[:3]),
                player_slug=slug,
            )
        )
    return out


def gen_heavy_minute_role_players(rows: list[dict], minimum: int = 5) -> list[NbaFact]:
    """Seasons of 82 games played -- the whole schedule, never a night off."""
    out: list[NbaFact] = []
    for slug, seasons in sorted(_by_player(rows).items()):
        perfect = [row for row in seasons if (row["games_played"] or 0) >= 82]
        if len(perfect) < minimum:
            continue
        teams = sorted({row["team"] for row in perfect})
        out.append(
            _derived(
                profile="heavy_minutes",
                feature=str(len(perfect)),
                feature_label="full seasons",
                fact_id=_fact_id("rare_threshold", slug, "all_82"),
                text=(
                    f"{perfect[0]['player']} played all 82 games in "
                    f"{len(perfect)} different seasons"
                    + (
                        f", across {len(teams)} franchises"
                        if len(teams) > 1
                        else f" for {teams[0]}"
                    )
                    + " — a full-schedule season is rarer than a scoring title."
                ),
                category="rare_threshold",
                era=_era(perfect[0]["season_start"]),
                source_label=SOURCE_LABEL,
                evidence=_evidence(perfect[:3]),
                player_slug=slug,
            )
        )
    return out


def gen_cross_decade_careers(rows: list[dict], decades: int = 4) -> list[NbaFact]:
    """A career that touched four calendar decades."""
    out: list[NbaFact] = []
    for slug, seasons in sorted(_by_player(rows).items()):
        touched = sorted({_era(row["season_start"]) for row in seasons})
        if len(touched) < decades:
            continue
        out.append(
            _derived(
                profile="cross_decade",
                feature=str(len(touched)),
                feature_label="decades",
                fact_id=_fact_id("era_anomaly", slug, "decades"),
                text=(
                    f"{seasons[0]['player']} appeared in NBA games across "
                    f"{len(touched)} different decades ({', '.join(touched)}) — "
                    f"from {seasons[0]['season']} to {seasons[-1]['season']}."
                ),
                category="era_anomaly",
                era=touched[0],
                source_label=SOURCE_LABEL,
                evidence=_evidence([seasons[0], seasons[-1]]),
                player_slug=slug,
            )
        )
    return out


def gen_franchise_returns(rows: list[dict]) -> list[NbaFact]:
    """A player who left a franchise and came back years later."""
    out: list[NbaFact] = []
    for slug, seasons in sorted(_by_player(rows).items()):
        by_team: dict[str, list[dict]] = {}
        for row in seasons:
            by_team.setdefault(row["team"], []).append(row)
        for team, stint in sorted(by_team.items()):
            years = [row["season_start"] for row in stint]
            # A gap of 4+ seasons is a genuine departure and return. Below that
            # it is usually a mid-career injury year or a single season away,
            # which is not the story. The upper bound is the same
            # identity-collision guard `load_rows` applies, restated here
            # because this generator is the one that surfaced the defect.
            gaps = [
                (before, after)
                for before, after in zip(years, years[1:])
                if 4 <= after - before <= MAX_CAREER_SPAN_YEARS
            ]
            # And the stint has to amount to something at each end: two lone
            # seasons a decade apart is a transaction, not a tenure.
            if not gaps or len(stint) < 4:
                continue
            before, after = gaps[0]
            out.append(
                _derived(
                    profile="franchise_return",
                    feature=f"{after - before} yrs",
                    feature_label="away",
                    fact_id=_fact_id("career_arc", slug, team, "return"),
                    text=(
                        f"{stint[0]['player']} left {team} after "
                        f"{before}-{str(before + 1)[-2:]} and returned "
                        f"{after - before} years later, in "
                        f"{after}-{str(after + 1)[-2:]} — two separate stints at "
                        "the same franchise."
                    ),
                    category="career_arc",
                    era=_era(before),
                    source_label=SOURCE_LABEL,
                    evidence=_evidence(
                        [row for row in stint if row["season_start"] in (before, after)]
                    ),
                    player_slug=slug,
                    team_code=team,
                )
            )
    return out


#: Every generator, in a fixed order. The order affects nothing about selection
#: (the bank is sorted by `fact_id` before it is written) and exists so a
#: regenerated bank is byte-identical.
GENERATORS = (
    gen_long_single_franchise_tenures,
    gen_many_franchise_journeymen,
    gen_late_career_workloads,
    gen_iron_man_seasons,
    gen_franchise_era_anchors,
    gen_one_and_done_stints,
    gen_heavy_minute_role_players,
    gen_cross_decade_careers,
    gen_franchise_returns,
)
