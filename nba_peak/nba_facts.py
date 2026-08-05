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

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

_REPO_ROOT = Path(__file__).resolve().parent.parent

#: Bumped whenever a generator changes what it emits for unchanged data. Part of
#: the date hash, so a regenerated bank reshuffles the calendar rather than
#: silently swapping today's fact for a different one under the same id.
FACT_BANK_VERSION = "nba_facts_v1"

BANK_PATH = _REPO_ROOT / "data" / "web" / "nba_facts.v1.json"

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

CATEGORIES = (
    "franchise_tenure",
    "age_season",
    "role_player",
    "career_arc",
    "streak",
    "rare_threshold",
    "era_anomaly",
)


@dataclass(frozen=True)
class NbaFact:
    """One fact, with the rows that prove it.

    `evidence` is not decoration. A trivia line with no way back to its source
    is indistinguishable from an invented one, and this bank is generated code
    rather than authored prose -- so the rows are carried, the UI can disclose
    them, and a test can re-derive the claim.
    """

    fact_id: str
    text: str
    category: str
    era: str
    source_label: str
    evidence: tuple[dict, ...] = field(default_factory=tuple)
    player_slug: Optional[str] = None
    team_code: Optional[str] = None

    def as_dict(self) -> dict:
        return {
            "fact_id": self.fact_id,
            "text": self.text,
            "category": self.category,
            "era": self.era,
            "source_label": self.source_label,
            "evidence": [dict(row) for row in self.evidence],
            "player_slug": self.player_slug,
            "team_code": self.team_code,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "NbaFact":
        return cls(
            fact_id=str(data["fact_id"]),
            text=str(data["text"]),
            category=str(data["category"]),
            era=str(data.get("era") or ""),
            source_label=str(data.get("source_label") or SOURCE_LABEL),
            evidence=tuple(dict(row) for row in (data.get("evidence") or ())),
            player_slug=data.get("player_slug"),
            team_code=data.get("team_code"),
        )


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
    joined = ":".join(str(part) for part in parts)
    digest = hashlib.sha256(joined.encode("utf-8")).hexdigest()[:10]
    return f"{category}-{digest}"


# ---------------------------------------------------------------------------
# Generators
# ---------------------------------------------------------------------------
#
# Each returns facts for one PATTERN. Adding a generator is how the bank grows;
# none of them writes prose about a player, only about a shape in the data.


def _by_player(rows: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["player_slug"], []).append(row)
    return grouped


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
            NbaFact(
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
            NbaFact(
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
            NbaFact(
                fact_id=_fact_id("age_season", slug, "longevity"),
                text=(
                    f"{first['player']} was still on an NBA roster in his "
                    f"{len(seasons)}th recorded season, {last['season']} with "
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
            NbaFact(
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
                NbaFact(
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
            NbaFact(
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
            NbaFact(
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
            NbaFact(
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
                NbaFact(
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


def build_bank(rows: Optional[list[dict]] = None) -> list[NbaFact]:
    """Run every generator and return the deduplicated, sorted bank.

    Sorted by `fact_id`, which is a hash of the fact's own identity rather than
    of its text -- so rewording a generator's sentence does not reshuffle the
    calendar, while adding or removing a fact does.
    """
    source = rows if rows is not None else load_rows()
    seen: dict[str, NbaFact] = {}
    for generator in GENERATORS:
        for fact in generator(source):
            seen.setdefault(fact.fact_id, fact)
    return sorted(seen.values(), key=lambda fact: fact.fact_id)


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def fact_for_date(bank: list[NbaFact], iso_date: str) -> Optional[NbaFact]:
    """The fact for one calendar date. Pure, and never repeats day to day.

    A plain `hash(date) % len(bank)` is not enough on its own: it can land on
    the same index twice in a row, and a homepage that showed the same trivia
    two mornings running reads as broken rather than as unlucky. So the index
    is a hash-derived STEP through the bank rather than a hash-derived
    position -- the day number selects a start and the hash selects a stride
    coprime with the bank size, which visits every fact before repeating any
    and cannot produce two equal consecutive indices for a bank of size > 1.
    """
    if not bank:
        return None
    size = len(bank)
    if size == 1:
        return bank[0]

    day = _day_number(iso_date)
    digest = hashlib.sha256(f"{FACT_BANK_VERSION}:{size}".encode("utf-8")).digest()
    stride = int.from_bytes(digest[:8], "big") % size
    # A stride sharing a factor with `size` would cycle through a subset of the
    # bank forever, so it is walked up to the first coprime value.
    while stride < 2 or _gcd(stride, size) != 1:
        stride += 1
        if stride >= size:
            stride = 1
            break
    return bank[(day * stride) % size]


def _day_number(iso_date: str) -> int:
    """Days since 1970-01-01, from an ISO date, with no clock read.

    Parsed rather than passed through `datetime.now()` anywhere: selection is a
    function of the date the caller supplies, so a test can ask for any day and
    a replay of a request produces the same answer.
    """
    from datetime import date

    parsed = date.fromisoformat(iso_date[:10])
    return parsed.toordinal()


def _gcd(a: int, b: int) -> int:
    while b:
        a, b = b, a % b
    return a


# ---------------------------------------------------------------------------
# The serialised bank
# ---------------------------------------------------------------------------


def bank_payload(bank: list[NbaFact]) -> dict:
    return {
        "version": FACT_BANK_VERSION,
        "source_label": SOURCE_LABEL,
        "count": len(bank),
        "facts": [fact.as_dict() for fact in bank],
    }


def load_bank(path: Path | None = None) -> list[NbaFact]:
    """Read the built bank. Returns an empty list when it has not been built.

    Empty rather than raising: a deployment that has not run the exporter
    should render a homepage without the panel, not a 500.
    """
    load_path = path or BANK_PATH
    if not load_path.exists():
        return []
    try:
        payload = json.loads(load_path.read_text())
    except (OSError, ValueError):
        return []
    return [NbaFact.from_dict(entry) for entry in payload.get("facts", [])]


__all__ = [
    "BANK_PATH",
    "CATEGORIES",
    "FACT_BANK_VERSION",
    "GENERATORS",
    "SOURCE_LABEL",
    "NbaFact",
    "bank_payload",
    "build_bank",
    "fact_for_date",
    "load_bank",
    "load_rows",
]
