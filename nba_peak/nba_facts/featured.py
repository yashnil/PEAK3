"""The homepage tier: which facts are good enough to be the thing on the page.

WHY BANK MEMBERSHIP WAS NEVER A HOMEPAGE STANDARD
=================================================
`quality.py` decides what may be PUBLISHED. That gate is real — it rejects 578
of 800-odd candidates — and it was still not a homepage standard, for one
structural reason that its own docstring admits:

    "within a generator every fact scores identically, so the survivors are the
     first eight by id"

A derived fact's seven axes come from `_QUALITY[profile]` or from a literal in
the generator's `_fact(...)` call. They are per-GENERATOR constants. So the
moment one generator's profile clears the floor, every fact it will ever emit
clears the floor, forever, in a block. The gate cannot separate

    "Moses Malone led the NBA in rebounding for 5 seasons in a row"

from the same sentence about a three-year run, because it never sees the number.
It bounds a family with `MAX_PER_DERIVED_PATTERN` and then takes the first eight
by hash, which is a cap, not a judgment. Eight-at-a-time admission of an
unranked family is exactly how a homepage ends up with a shape rather than a
fact.

WHAT THIS MODULE ADDS, AND THE THREE THINGS IT DOES DIFFERENTLY
==============================================================
1. HIGHER FLOORS ON THE AXES THAT NAME THE BRIEF'S CRITERIA. HOME-02 asks for
   factual certainty, surprise/interest, educational value, clarity,
   non-subjectivity and category diversity, and five of those are axes that
   already exist and were being asked for a bare pass. `FEATURED_MIN_AXIS`
   raises each to the value that actually means it.

2. A HIGHER BAR FOR DERIVED FACTS THAN FOR EDITORIAL ONES. Not a prejudice
   about provenance — a correction for what the score MEASURES. An editorial
   entry's seven numbers were assigned to that entry, by somebody who had read
   it. A derived fact's seven numbers were assigned to its TEMPLATE, by somebody
   who had read one example of it. The second is a weaker signal about any
   individual fact, so it has to clear more to carry the same confidence:
   `FEATURED_MIN_TOTAL` is 30 for derived and 28 for editorial.

3. A PER-FACT ORDERING WITHIN A TEMPLATE, WHERE THE DATA SUPPORTS ONE. This is
   the part that fixes the underlying defect rather than working around it. Most
   generators put their subject's number in `feature` — `5` straight rebounding
   titles, `13` straight All-Defense teams — and that number is per-fact, is
   already computed, and is exactly what makes one instance of a template more
   remarkable than another. `_extremity` reads it, and admission within a
   pattern runs in descending order of it. Where a generator's feature is not a
   number (`DPOY`, `50/40/90`, `MVP`) the template genuinely has no internal
   ranking, and the tie falls to `fact_id`; `featured_report` names those
   patterns rather than hiding them.

   AND A SECOND, INDEPENDENT PER-FACT CONSTRAINT: no two featured facts from one
   template may share an era group. A template's three slots therefore have to
   be spent on three different periods of the league, which turns "the first
   three by id" into a choice with a reason and makes the sequence a reader sees
   less repetitive in the one way the numbers cannot describe.

4. AND A MUCH TIGHTER CAP. `MAX_PER_DERIVED_PATTERN` is 8 in the bank;
   `MAX_FEATURED_PER_PATTERN` is 3. A featured set of ~95 with 3 per template
   means no template is more than ~3% of what the homepage serves, and the
   fifteen-odd templates cannot between them crowd out the curated half.

PREFER A SMALLER EXCELLENT SET. HOME-02 says so outright, and the floors here
were set by writing them down first and counting afterwards. The result is under
a hundred facts. That is the answer, not a shortfall: `MIN_FEATURED_FACTS`
records the size the tier actually reaches, and nothing here is loosened to
reach a number. The wider bank still exists — it is what any non-homepage
surface draws on, and it is what the report audits — but it is not what the
homepage rotates.

NOTHING HERE IS A HAND-LIST. Every function below is a pure function of the
facts and their committed scores. Running it twice gives the same tier, and a
new editorial entry joins or does not join by the same rules as every other.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Sequence

from .rotation import category_group, era_group
from .schema import PERISHABLE_CATEGORIES, NbaFact

#: THE SIX HOME-02 CRITERIA, AS FLOORS ON THE AXES THAT CARRY THEM.
#:
#:   surprise 4              "surprising / interesting". A 3 is a fact that is
#:                           fine to know and not one anybody repeats.
#:   significance 3          paired with novelty below — see `MIN_EDUCATIONAL`.
#:   clarity 4               "understandable without knowing PEAK3's formula",
#:                           and concise. A homepage card is read in one pass.
#:   broad_interest 4        "the homepage is where a visitor arrives before
#:                           they know what PEAK3 is" — the bank asks 3 here and
#:                           the featured tier cannot.
#:   novelty 3               see `MIN_EDUCATIONAL`.
#:   source_confidence 5     "factual certainty", and the only axis pinned to the
#:                           top. The bank asks 4, which is "checked and I would
#:                           not stake the homepage on it". This tier is the
#:                           homepage.
#:   homepage_suitability 4  the axis that exists for this question, asked at the
#:                           level it was written for.
FEATURED_MIN_AXIS: dict[str, int] = {
    "surprise": 4,
    "significance": 3,
    "clarity": 4,
    "broad_interest": 4,
    "novelty": 3,
    "source_confidence": 5,
    "homepage_suitability": 4,
}

#: EDUCATIONAL VALUE, WHICH IS NOT ONE AXIS. A fact teaches either by mattering
#: (`significance` — the shot clock, the merger) or by being something the reader
#: did not know (`novelty`). Requiring 4 on both would reject half of each kind;
#: requiring 3 on each and 7 across the pair keeps facts that are strong on one
#: and rejects the ones that are merely adequate on both.
MIN_EDUCATIONAL = 7

#: THE TOTAL FLOOR, BY PROVENANCE. Derived facts clear more because their scores
#: describe a template rather than themselves. See the module docstring.
FEATURED_MIN_TOTAL: dict[str, int] = {
    "editorial": 28,
    "derived": 30,
}

#: How many featured facts one generator may contribute. The bank allows eight.
#:
#: THREE, AND THE NUMBER IS THE POINT OF THE TIER. A template is one sentence
#: with the nouns swapped, and the homepage's whole failure mode is serving the
#: same sentence often enough that a reader notices the sentence instead of the
#: fact. Eight of ~95 is 8%; three is 3%, which is roughly one appearance a
#: quarter for any one shape.
MAX_FEATURED_PER_PATTERN = 3

#: And no two of a template's slots may go to the same era group, so three slots
#: buy three different periods of the league rather than three players from the
#: same decade. Applies only to derived facts: an editorial entry is not a
#: template and two curated facts about the 1980s are two facts.
ONE_ERA_PER_PATTERN = True

#: CATEGORY DIVERSITY, the sixth HOME-02 criterion, as a ceiling on the rotation
#: group rather than on the category. `rotation.py` interleaves by GROUP, so a
#: group holding more than a third of the tier is a group the daily sequence
#: cannot alternate away from however even the categories look.
MAX_FEATURED_GROUP_SHARE = 1 / 3

#: A ceiling below which the share is not applied, so a small tier does not
#: collapse to a handful of groups of eight.
MIN_FEATURED_GROUP_CEILING = 10

#: CLARITY HAS A LENGTH, and a headline that needs two lines at homepage size is
#: not a headline. Measured on the headline alone; the body may be longer.
MAX_FEATURED_HEADLINE_CHARS = 120

#: NON-SUBJECTIVITY, AS TEXT RATHER THAN AS A SCORE.
#:
#: This is the criterion no axis covers, and the one the deleted award pair got
#: past: `gen_finals_mvp_not_best_player` scored 31/35 and every axis at 4 or 5,
#: because the person scoring the template was scoring how INTERESTING it was.
#: "He was not the best player on that team" is not a weak fact — it is a
#: judgment wearing a fact's clothes, and no axis asks whether a sentence is the
#: kind of thing that can be checked at all.
#:
#: THE PATTERNS ARE NARROW ON PURPOSE, matching claim shapes rather than words.
#: "Leading a category usually means carrying a volume the best teams do not need
#: from one player" contains "the best" and ranks nobody; `\bbest player\b` does
#: not match it, and `\bthe best\b` would have matched thirty perfectly good
#: facts. Each entry below is a construction that asserts somebody's standing
#: without a record to cite it against.
SUBJECTIVE_CLAIMS: tuple[tuple[str, str], ...] = (
    (r"\bbest player\b", "ranks players by an unstated standard"),
    (r"\bgreatest\b", "an unattributed superlative"),
    (r"\bmost talented\b", "an unattributed superlative"),
    (r"\bbetter than\b", "compares two players by an unstated standard"),
    (r"\barguably\b", "hedged opinion"),
    (r"\bunquestionably\b", "asserted opinion"),
    (r"\b(over|under)rated\b", "an opinion about consensus"),
    (r"\bshould have (won|been|gone)\b", "second-guesses a result"),
    (r"\bdeserved\b", "second-guesses a result"),
    (r"\bsnubbed\b", "second-guesses a result"),
    (r"\bwidely (considered|regarded)\b", "cites a consensus with no source"),
    (r"\bmany (consider|believe|think)\b", "cites a consensus with no source"),
    # RANKS A PERSON, RATHER THAN NAMING A STANDING. "Before 1985 the worst
    # record got the first pick" is a rule and a fact; "was never the worst
    # defender on the floor" is an opinion, and a bare `\bworst\b` could not
    # tell them apart — it rejected the draft-lottery fact, which is one of the
    # strongest entries in the bank. The noun is what makes it a judgment.
    (
        r"\b(best|worst) (player|defender|shooter|passer|scorer|athlete|coach)\b",
        "ranks a person by an unstated standard",
    ),
)

_SUBJECTIVE = tuple(
    (re.compile(pattern, re.IGNORECASE), reason)
    for pattern, reason in SUBJECTIVE_CLAIMS
)

#: The floor on the tier itself, and it is a MEASUREMENT rather than a target.
#:
#: The featured set is what the daily rotation cycles through, so its size IS the
#: no-repeat guarantee: `schedule()` has a period of exactly `len(featured)`
#: days. `bank.MIN_FACTS` used to carry that meaning and no longer does — the
#: bank is now a reservoir, and the homepage does not rotate through it.
#:
#: NINETY, BECAUSE THAT IS WHERE THE FLOORS LAND. The criteria above were
#: written down first and counted afterwards, and they admit ~95 facts. This
#: floor sits just under that so a build that loses a few facts still ships and
#: a build that loses twenty stops. It is deliberately NOT set to a number the
#: gates would have to be loosened to reach: HOME-02 asks for "a smaller
#: excellent featured set over hundreds of filler facts", and three months of
#: distinct daily facts is the product promise this size actually keeps.
MIN_FEATURED_FACTS = 90


@dataclass(frozen=True)
class FeaturedRejection:
    fact_id: str
    headline: str
    category: str
    reason: str
    detail: str


def _leading_number(text: Optional[str]) -> Optional[int]:
    if not text:
        return None
    match = re.match(r"\s*(\d+)", text)
    return int(match.group(1)) if match else None


#: Word forms the aggregating generators use instead of a digit.
_WORD_NUMBERS = {
    "once": 1, "twice": 2, "three times": 3, "four times": 4,
    "five times": 5, "six times": 6,
}


def extremity(fact: NbaFact) -> int:
    """How far out on its own template's distribution this fact sits.

    THE ONE PER-FACT SIGNAL THE PIPELINE ALREADY COMPUTES AND NEVER READ. The
    card's `feature` is the number the fact is about — 5 straight rebounding
    titles, 13 straight All-Defense teams, 21 straight All-NBA teams — and it is
    the difference between the fact a reader repeats and the third-best example
    of the same sentence. The seven quality axes cannot see it, because they were
    assigned to the template.

    Returns 0 where the feature is not a magnitude (`DPOY`, `50/40/90`, `MVP`,
    `2nd`, `Both`). That is not a low score, it is an ABSENT one: those templates
    have no internal ordering, every instance is equally extreme, and admission
    falls through to `fact_id`. `featured_report` lists which patterns those are
    so the arbitrariness is visible rather than implied.
    """
    number = _leading_number(fact.feature)
    if number is not None:
        # `2nd` and `50/40/90` lead with digits and are not magnitudes.
        if re.fullmatch(r"\s*\d+(st|nd|rd|th)\s*", fact.feature or ""):
            return 0
        if "/" in (fact.feature or ""):
            return 0
        return number
    return _WORD_NUMBERS.get((fact.feature or "").strip().lower(), 0)


def subjective_claim(fact: NbaFact) -> Optional[tuple[str, str]]:
    """The first unattributed judgment in this fact, or `None`.

    Read over headline AND body, because the body is where the framing sentence
    lives and a card shows both.
    """
    text = f"{fact.headline} {fact.body}"
    for pattern, reason in _SUBJECTIVE:
        found = pattern.search(text)
        if found:
            return found.group(0), reason
    return None


def featured_failures(fact: NbaFact, *, today: Optional[str] = None) -> list[str]:
    """Every homepage criterion this fact fails, named. Empty means eligible.

    Named rather than boolean so `featured_report` can say WHY the tier is the
    size it is, and so a curator who wants an entry featured can read what it
    would take rather than guess.
    """
    failures: list[str] = []
    if fact.quality is None:
        return ["unscored"]

    for axis, floor in FEATURED_MIN_AXIS.items():
        if getattr(fact.quality, axis) < floor:
            failures.append(f"{axis}<{floor}")

    educational = fact.quality.significance + fact.quality.novelty
    if educational < MIN_EDUCATIONAL:
        failures.append(f"significance+novelty<{MIN_EDUCATIONAL}")

    floor = FEATURED_MIN_TOTAL.get(fact.provenance, max(FEATURED_MIN_TOTAL.values()))
    if fact.quality.total < floor:
        failures.append(f"total<{floor}")

    if len(fact.headline) > MAX_FEATURED_HEADLINE_CHARS:
        failures.append(f"headline>{MAX_FEATURED_HEADLINE_CHARS}chars")

    judgment = subjective_claim(fact)
    if judgment is not None:
        failures.append(f"subjective:{judgment[0].lower()}")

    # FACTUAL CERTAINTY, AS STRUCTURE RATHER THAN AS A SELF-REPORTED SCORE. A
    # derived fact is checkable because it carries the rows it was computed
    # from; an editorial one because it names a record a person read. A fact
    # with neither is not certain however it scored itself.
    if not fact.verified:
        failures.append("unverified")
    if fact.provenance == "derived" and not fact.evidence:
        failures.append("no_evidence_rows")
    if fact.provenance == "editorial" and len(fact.source_detail.strip()) <= 25:
        failures.append("no_named_source")

    # EXPIRY, CHECKED HERE AND NOT ONLY AT THE EDITORIAL GATE. `load_editorial`
    # refuses a perishable entry with no `valid_until`, which covers the curated
    # half and would not cover a future generator that emitted one.
    if fact.category in PERISHABLE_CATEGORIES and not fact.valid_until:
        failures.append("perishable_without_expiry")
    if today is not None and fact.valid_until and fact.valid_until[:10] < today[:10]:
        failures.append("expired")

    return failures


def _admit(
    eligible: Sequence[NbaFact],
    *,
    group_ceiling: Optional[int],
) -> tuple[list[NbaFact], list[FeaturedRejection]]:
    """One admission pass: the template cap, the era spread, the group ceiling."""
    kept: list[NbaFact] = []
    rejections: list[FeaturedRejection] = []
    pattern_counts: dict[str, int] = {}
    pattern_eras: dict[str, set[str]] = {}
    group_counts: dict[str, int] = {}

    for fact in eligible:
        if fact.provenance == "derived":
            key = fact.pattern or f"derived:{fact.category}"
            if pattern_counts.get(key, 0) >= MAX_FEATURED_PER_PATTERN:
                rejections.append(
                    FeaturedRejection(
                        fact.fact_id, fact.headline, fact.category,
                        "featured_pattern_cap",
                        f"template {key!r} already holds "
                        f"{MAX_FEATURED_PER_PATTERN} featured slots; this one is "
                        "a less extreme instance of the same sentence",
                    )
                )
                continue
            era = era_group(fact.era)
            if ONE_ERA_PER_PATTERN and era in pattern_eras.get(key, set()):
                rejections.append(
                    FeaturedRejection(
                        fact.fact_id, fact.headline, fact.category,
                        "featured_pattern_era",
                        f"template {key!r} already features a {era!r} fact; a "
                        "template's slots buy different periods of the league",
                    )
                )
                continue

        group = category_group(fact.category)
        if group_ceiling is not None and group_counts.get(group, 0) >= group_ceiling:
            rejections.append(
                FeaturedRejection(
                    fact.fact_id, fact.headline, fact.category,
                    "featured_group_cap",
                    f"rotation group {group!r} already holds {group_ceiling} "
                    "featured facts, the ceiling that keeps the daily sequence "
                    "able to alternate",
                )
            )
            continue

        if fact.provenance == "derived":
            key = fact.pattern or f"derived:{fact.category}"
            pattern_counts[key] = pattern_counts.get(key, 0) + 1
            pattern_eras.setdefault(key, set()).add(era_group(fact.era))
        group_counts[group] = group_counts.get(group, 0) + 1
        kept.append(fact)

    return kept, rejections


def _rank(fact: NbaFact) -> tuple:
    """Strongest first, and within a template most extreme first.

    Deterministic to the last key: two facts with the same score and the same
    magnitude are separated by `fact_id`, which is a hash of the fact's identity
    and never of its wording.
    """
    total = fact.quality.total if fact.quality else 0
    return (-total, -extremity(fact), fact.fact_id)


def select_featured(
    bank: Sequence[NbaFact],
) -> tuple[list[NbaFact], list[FeaturedRejection]]:
    """The homepage tier, and everything that did not reach it and why.

    TWO ADMISSION PASSES, for the reason `quality.filter_and_dedupe` has two: the
    group ceiling is a SHARE and a share needs a denominator, and the denominator
    is the size of the tier — which is not known until the template caps have
    been applied. The first pass runs with no group ceiling purely to size the
    tier; the second admits for real. Both are pure functions of the same sorted
    input.
    """
    eligible = sorted(
        (fact for fact in bank if not featured_failures(fact)), key=_rank
    )
    provisional, _ = _admit(eligible, group_ceiling=None)
    ceiling = max(
        MIN_FEATURED_GROUP_CEILING,
        int(len(provisional) * MAX_FEATURED_GROUP_SHARE),
    )
    kept, rejections = _admit(eligible, group_ceiling=ceiling)
    kept.sort(key=lambda f: f.fact_id)
    return kept, rejections


#: SELECTED TIERS, KEYED BY EXACTLY WHICH FACTS WENT INTO THEM.
#:
#: `select_featured` is a pure function of the bank and `rotation.fact_for_date`
#: calls it on every request. Keyed by the tuple of fact ids, so a rebuilt bank
#: is a different key rather than an invalidation somebody has to remember.
_FEATURED_CACHE: dict[tuple[str, ...], tuple[NbaFact, ...]] = {}
_FEATURED_CACHE_MAX = 8


def featured_facts(bank: Sequence[NbaFact]) -> list[NbaFact]:
    """The tier the homepage rotates through. Memoised on the bank's contents.

    EXPIRY IS NOT APPLIED HERE, deliberately. The tier is a property of the bank
    and must not change shape on the day a perishable fact lapses — otherwise an
    expiry would free a template slot and silently promote a different fact.
    `rotation.fact_for_date` applies `is_live` to this tier per day, which drops
    the expired fact and promotes nothing.
    """
    signature = tuple(fact.fact_id for fact in bank)
    cached = _FEATURED_CACHE.get(signature)
    if cached is not None:
        return list(cached)
    kept, _ = select_featured(bank)
    if len(_FEATURED_CACHE) >= _FEATURED_CACHE_MAX:
        _FEATURED_CACHE.clear()
    _FEATURED_CACHE[signature] = tuple(kept)
    return list(kept)


def clear_featured_cache() -> None:
    _FEATURED_CACHE.clear()


def is_featured(fact: NbaFact, bank: Sequence[NbaFact]) -> bool:
    return any(f.fact_id == fact.fact_id for f in featured_facts(bank))


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def featured_report(bank: Sequence[NbaFact]) -> dict:
    """Everything the build report says about the tier. Data, not prose."""
    featured, rejections = select_featured(bank)
    featured_ids = {fact.fact_id for fact in featured}

    by_category: dict[str, int] = {}
    by_era: dict[str, int] = {}
    by_era_group: dict[str, int] = {}
    by_group: dict[str, int] = {}
    by_provenance: dict[str, int] = {}
    by_pattern: dict[str, int] = {}
    for fact in featured:
        by_category[fact.category] = by_category.get(fact.category, 0) + 1
        by_era[fact.era or "unknown"] = by_era.get(fact.era or "unknown", 0) + 1
        by_era_group[era_group(fact.era)] = by_era_group.get(era_group(fact.era), 0) + 1
        group = category_group(fact.category)
        by_group[group] = by_group.get(group, 0) + 1
        by_provenance[fact.provenance] = by_provenance.get(fact.provenance, 0) + 1
        key = fact.pattern or "editorial"
        by_pattern[key] = by_pattern.get(key, 0) + 1

    ineligible: dict[str, int] = {}
    for fact in bank:
        if fact.fact_id in featured_ids:
            continue
        for failure in featured_failures(fact) or ["capped"]:
            ineligible[failure] = ineligible.get(failure, 0) + 1

    capped: dict[str, int] = {}
    for rejection in rejections:
        capped[rejection.reason] = capped.get(rejection.reason, 0) + 1

    unranked = sorted(
        {
            fact.pattern
            for fact in featured
            if fact.provenance == "derived" and extremity(fact) == 0 and fact.pattern
        }
    )

    return {
        "featured": len(featured),
        "bank": len(bank),
        "share_of_bank": round(len(featured) / max(len(bank), 1), 3),
        "rotation_cycle_days": len(featured),
        "by_provenance": dict(sorted(by_provenance.items())),
        "by_category": dict(sorted(by_category.items())),
        "by_era": dict(sorted(by_era.items())),
        "by_era_group": dict(sorted(by_era_group.items())),
        "by_rotation_group": dict(sorted(by_group.items())),
        "by_pattern": dict(sorted(by_pattern.items(), key=lambda kv: (-kv[1], kv[0]))),
        "not_eligible_reasons": dict(
            sorted(ineligible.items(), key=lambda kv: (-kv[1], kv[0]))
        ),
        "capped_reasons": dict(sorted(capped.items())),
        "templates_with_no_internal_ranking": unranked,
        "perishable": [
            {
                "headline": fact.headline,
                "category": fact.category,
                "valid_until": fact.valid_until,
            }
            for fact in featured
            if fact.valid_until
        ],
        "distinct_subjects": len(
            {fact.player_slug for fact in featured if fact.player_slug}
        ),
    }


def featured_markdown(bank: Sequence[NbaFact]) -> str:
    """The featured-tier section of `docs/implementation/NBA_FACT_BANK_REPORT.md`.

    Lives here rather than in `scripts/build_nba_facts.py` so the tables and the
    selection are the same code: a report that describes a tier a different
    function produced is a report that can be wrong.
    """
    report = featured_report(bank)

    def table(title: str, mapping: dict, header: str) -> list[str]:
        rows = [f"| {k} | {v} |" for k, v in mapping.items()]
        return [f"### {title}", "", f"| {header} | Facts |", "|---|---|", *rows, ""]

    lines = [
        "## The homepage featured tier",
        "",
        "Bank membership is what may be published. It is not a homepage",
        "standard, because a derived fact's seven axes are assigned to its",
        "TEMPLATE — so the moment one generator's profile clears the floor,",
        "every fact it will ever emit clears it, in a block of eight. The",
        "featured tier is the second gate: `nba_peak/nba_facts/featured.py`.",
        "",
        "**Only the featured tier rotates onto the homepage.**",
        "`rotation.fact_for_date` selects from it, so the daily cycle length is",
        "the size of this tier and not the size of the bank.",
        "",
        "| | |",
        "|---|---|",
        f"| Bank | {report['bank']} |",
        f"| **Featured** | **{report['featured']}** |",
        f"| Share of the bank | {round(100 * report['share_of_bank'])}% |",
        f"| Rotation cycle | **{report['rotation_cycle_days']} days** |",
        f"| Distinct player subjects | {report['distinct_subjects']} |",
        f"| Featured facts with an expiry | {len(report['perishable'])} |",
        "",
        *table("Featured by provenance", report["by_provenance"], "Provenance"),
        *table("Featured by category", report["by_category"], "Category"),
        *table("Featured by era", report["by_era"], "Era"),
        *table("Featured by era group", report["by_era_group"], "Era group"),
        *table(
            "Featured by rotation group", report["by_rotation_group"], "Rotation group"
        ),
        *table("Featured per template", report["by_pattern"], "Template"),
        "### Why bank facts did not reach the tier",
        "",
        "| Criterion failed | Facts |",
        "|---|---|",
    ]
    for reason, count in report["not_eligible_reasons"].items():
        lines.append(f"| `{reason}` | {count} |")
    lines += [
        "",
        "`capped` means the fact cleared every criterion and lost a slot to a",
        "ceiling — the three-per-template cap, the one-era-per-template rule, or",
        "the rotation-group share. Those are not quality judgements:",
        "",
        "| Ceiling | Facts |",
        "|---|---|",
    ]
    for reason, count in report["capped_reasons"].items():
        lines.append(f"| `{reason}` | {count} |")
    lines += [
        "",
        "### Templates with no internal ranking",
        "",
        "Most generators put their subject's number in `feature`, and admission",
        "within a template runs in descending order of it — so the featured",
        "slots go to the five-year streak rather than to whichever three-year",
        "streak hashed first. These templates emit a constant feature",
        "(`DPOY`, `50/40/90`, `MVP`), have no internal ordering, and fall",
        "through to `fact_id`. Named rather than hidden:",
        "",
    ]
    if report["templates_with_no_internal_ranking"]:
        lines += [
            f"- `{pattern}`" for pattern in report["templates_with_no_internal_ranking"]
        ]
    else:
        lines.append("None — every featured template ranks its own output.")
    lines += [
        "",
        "### Featured facts that expire",
        "",
    ]
    if report["perishable"]:
        lines += ["| Fact | Category | Serves until |", "|---|---|---|"]
        for entry in report["perishable"]:
            lines.append(
                f"| {entry['headline']} | `{entry['category']}` | "
                f"{entry['valid_until']} |"
            )
    else:
        lines.append("None.")
    lines.append("")
    return "\n".join(lines)


__all__ = [
    "FEATURED_MIN_AXIS",
    "FEATURED_MIN_TOTAL",
    "MAX_FEATURED_GROUP_SHARE",
    "MAX_FEATURED_HEADLINE_CHARS",
    "MAX_FEATURED_PER_PATTERN",
    "MIN_EDUCATIONAL",
    "MIN_FEATURED_FACTS",
    "SUBJECTIVE_CLAIMS",
    "FeaturedRejection",
    "clear_featured_cache",
    "extremity",
    "featured_facts",
    "featured_failures",
    "featured_markdown",
    "featured_report",
    "is_featured",
    "select_featured",
    "subjective_claim",
]
