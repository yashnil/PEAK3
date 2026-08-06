"""The quality gate: what is allowed onto a homepage, and what is not.

THE COMPLAINT THIS EXISTS TO ANSWER. The first bank published everything a
generator produced. Generators find PATTERNS, and a pattern that is rare is not
the same as a pattern that is interesting:

    "Ricky Pierce played exactly one season for each of four franchises."

That is true, checkable, and nobody's favourite thing they learned today. The
bank had 60+ facts and no way to say so, because "is this worth reading" was
never a field.

SEVEN AXES, SCORED SEPARATELY, AND ONE OF THEM IS NOT AN AVERAGE. `surprise`,
`significance`, `clarity`, `broad_interest`, `novelty` and `source_confidence`
describe the fact. `homepage_suitability` describes whether it belongs on THIS
surface, and it is judged rather than computed — a genuinely surprising fact
that needs a paragraph of caveats scores high on surprise and low here, which
is exactly the case a blended score cannot reject.

THE THRESHOLDS ARE FLOORS ON THE AXES THAT MATTER, NOT ON THE TOTAL. A fact
with a perfect total but `clarity: 1` is a fact a reader will not follow, and
letting five strong axes carry a weak one is how "technically correct" gets
published.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from .schema import NbaFact, jaccard, normalise_for_dedupe

#: Per-axis floors. A candidate failing ANY of these is rejected, whatever its
#: total. Deliberately set where they are:
#:
#:   clarity 3           — a fact a reader has to re-read is not a fact they
#:                         will repeat.
#:   broad_interest 3    — the homepage is where a visitor arrives before they
#:                         know what PEAK3 is.
#:   source_confidence 4 — the one axis with a hard floor near the top. A fact
#:                         nobody has checked is not a fact, and this is the
#:                         axis that says so.
#:   homepage_suitability 3 — the judgment the other six cannot make.
MIN_AXIS = {
    "surprise": 2,
    "significance": 2,
    "clarity": 3,
    "broad_interest": 3,
    "novelty": 2,
    "source_confidence": 4,
    "homepage_suitability": 3,
}

#: And a floor on the sum, so a candidate that is a bare pass on every axis
#: does not ship simply by clearing seven low bars.
MIN_TOTAL = 23

#: Token-overlap above which two facts are the same fact wearing different
#: words.
#:
#: MEASURED ON THE HEADLINE, NOT ON THE WHOLE CARD, and that is a correction
#: rather than a tuning. Comparing headline + body counted the SHARED
#: EXPLANATORY BOILERPLATE — "the award is voted on the regular season, which is
#: why the two things come apart" — which every fact from one generator carries
#: verbatim. So two facts about two different players scored as duplicates of
#: each other purely because they were explained the same way, and expanding the
#: bank rejected 145 perfectly good facts on it.
#:
#: The headline carries the subject and the claim, which is what "is this the
#: same fact" actually means. Two players leading two different categories in a
#: lottery season land at ~0.5 (kept — different players are different facts);
#: a genuine restatement of one claim lands above 0.7.
#:
#: AND ONLY BETWEEN FACTS ABOUT THE SAME SUBJECT. This is the second half of
#: the same correction. With the headline alone, a short template leaves the
#: player's name as two tokens out of ten, so
#:
#:     "Tony Parker won Finals MVP on a team he was not the best player on."
#:     "Jaylen Brown won Finals MVP on a team he was not the best player on."
#:
#: scored 0.60 against each other and one of them was thrown away. They are two
#: different facts about two different people; no amount of shared phrasing
#: makes them one. So the overlap check runs only when the two facts name the
#: same player — or the same team, when neither names a player — and otherwise
#: they are simply different.
#:
#: TEMPLATE REPETITION IS A DIFFERENT PROBLEM AND HAS ITS OWN CONTROL. Two
#: hundred facts that are all individually distinct and all phrased identically
#: is a real defect, and the thing that binds it is `MAX_PER_DERIVED_PATTERN` —
#: one generator is one template, and no template may contribute more than
#: eight.
NEAR_DUPLICATE_THRESHOLD = 0.6


#: HOW MANY DERIVED FACTS ANY ONE GENERATOR MAY CONTRIBUTE.
#:
#: A generator that finds a pattern finds it once per player, so a single
#: pattern can produce hundreds of facts that are individually fine and
#: collectively a survey. The first run of this pipeline built a 153-fact bank
#: of which 106 came from one legacy category — the old defect wearing new
#: clothes, because the SEQUENCE a reader sees would still have been mostly the
#: same kind of thing.
#:
#: COUNTED PER GENERATOR, NOT PER CATEGORY. It was per (provenance, category),
#: which is a proxy that broke as soon as several generators shared a category:
#: capping `statistical_oddity` at six capped four different patterns
#: collectively, and the bank could not grow past about fifty however many good
#: candidates existed.
#:
#: EIGHT, AND THE NUMBER IS A RATIO RATHER THAN A TASTE. With ~26 generators a
#: cap of eight means no single pattern can be more than about 3.5% of a
#: 230-fact bank, which is the level at which a reader stops noticing a shape
#: and starts noticing individual facts.
#:
#: LOWERED FROM TWELVE WHEN THE CURATED HALF GREW. The cap is what decides how
#: much of the bank is SURVEY — the same sentence about a different player —
#: and the right size for it depends on how much else there is. Thirty-four new
#: sourced editorial facts, written to close the semantic-coverage gaps in
#: `coverage.py`, took the bank to 256 at a cap of twelve; the choice was
#: between publishing 256 facts of which the marginal 28 were another lap of an
#: existing template, and publishing 228 where the additions displaced them.
#: The brief asked for the second, and the coverage audit confirms nothing was
#: lost by it: every target in `COVERAGE_TARGETS` is still met at eight.
#:
#: THIS IS A CAP, NOT A FILTER, AND IT IS REPORTED. Facts dropped here are not
#: worse than the ones kept — within a generator every fact scores identically,
#: so the survivors are the first eight by id. The build report counts them
#: under `pattern_cap` precisely so this does not read as "the generator only
#: found eight".
MAX_PER_DERIVED_PATTERN = 8

#: AND NO ROTATION GROUP MAY EXCEED THIS SHARE OF THE BANK.
#:
#: The pattern cap binds one generator. It does not bind a FAMILY of them, and
#: expanding the bank showed why that matters: five separate streak generators
#: plus the record and oddity patterns put 130 of 255 facts — 51% — into the
#: single rotation group `numbers`. Every one had cleared the quality floor and
#: no single pattern was over 5%, and the homepage would still have served
#: something arithmetic every other day, because `rotation.py` interleaves by
#: GROUP and a group holding half the bank cannot be alternated away from.
#:
#: A THIRD, and the number is the rotation's arithmetic rather than a taste.
#: With six groups, an even bank would be a sixth each; a group at a third can
#: still be separated by another group on almost every day, and a group above a
#: third cannot. Facts dropped here are not worse than the ones kept — they are
#: the surplus of an over-served family, and the report counts them.
MAX_ROTATION_GROUP_SHARE = 1 / 3

@dataclass(frozen=True)
class Rejection:
    fact_id: str
    headline: str
    category: str
    reason: str
    detail: str


def _subject(fact: NbaFact) -> Optional[str]:
    """Who or what a fact is about, for the duplicate check.

    A player first, a team second, `None` when it names neither — an editorial
    fact about a rule change or a league has no subject in this sense, and two
    of those ARE compared, because that is where a genuine restatement hides.
    """
    if fact.player_slug:
        return f"player:{fact.player_slug}"
    if fact.team_code:
        return f"team:{fact.team_code}"
    return None


def _comparable(a: NbaFact, b: NbaFact) -> bool:
    """Whether these two are even candidates to be the same fact."""
    subject_a, subject_b = _subject(a), _subject(b)
    if subject_a is None and subject_b is None:
        return True
    return subject_a == subject_b


def score_failures(fact: NbaFact) -> list[str]:
    """Every axis this fact fails, named. Empty means it passes."""
    if fact.quality is None:
        return ["unscored"]
    failures = [
        f"{axis}<{floor}"
        for axis, floor in MIN_AXIS.items()
        if getattr(fact.quality, axis) < floor
    ]
    if fact.quality.total < MIN_TOTAL:
        failures.append(f"total<{MIN_TOTAL}")
    return failures


def filter_and_dedupe(
    candidates: Sequence[NbaFact],
) -> tuple[list[NbaFact], list[Rejection]]:
    """Apply the gate, then the caps and the duplicate check.

    ORDER MATTERS. Filtering on quality first means a near-duplicate pair is
    only ever resolved between facts that both deserve to ship, and a cap never
    spends a slot on something that was going to fail anyway. Within a pair the
    higher total wins, and ties break on `fact_id` so nothing depends on
    iteration order.

    TWO ADMISSION PASSES, because the group ceiling is a SHARE and a share needs
    a denominator. Computing it from everything that cleared the quality floor
    was wrong by a factor of about three: most of those are dropped by the
    pattern cap moments later, so the ceiling came out far above the size of the
    bank it was meant to bound and one group still took half. The first pass
    admits with no group ceiling purely to learn how big the bank is; the second
    admits for real. Both are pure functions of the same sorted input, so the
    result is deterministic.
    """
    rejections: list[Rejection] = []
    passing: list[NbaFact] = []

    for fact in candidates:
        failures = score_failures(fact)
        if failures:
            rejections.append(
                Rejection(
                    fact_id=fact.fact_id,
                    headline=fact.headline,
                    category=fact.category,
                    reason="below_quality_floor",
                    detail=", ".join(failures),
                )
            )
            continue
        passing.append(fact)

    # Strongest first, so the survivor of a near-duplicate pair — and the
    # occupant of the last slot under a cap — is the better fact rather than
    # whichever the loop reached first.
    passing.sort(key=lambda f: (-(f.quality.total if f.quality else 0), f.fact_id))

    provisional, _ = _admit(passing, group_ceiling=None)
    ceiling = max(12, int(len(provisional) * MAX_ROTATION_GROUP_SHARE))
    kept, cap_rejections = _admit(passing, group_ceiling=ceiling)

    rejections.extend(cap_rejections)
    kept.sort(key=lambda f: f.fact_id)
    return kept, rejections


def _admit(
    passing: Sequence[NbaFact],
    *,
    group_ceiling: Optional[int],
) -> tuple[list[NbaFact], list[Rejection]]:
    """One admission pass: the pattern cap, the group cap, the duplicate check."""
    from .rotation import category_group

    rejections: list[Rejection] = []
    kept: list[NbaFact] = []
    kept_tokens: list[tuple[NbaFact, frozenset[str]]] = []
    seen_ids: set[str] = set()
    #: Keyed on the generator, so the cap binds each pattern and never the
    #: curated half — an editorial category with a dozen strong facts is a dozen
    #: different facts, while a generator's output is one pattern repeated.
    pattern_counts: dict[str, int] = {}
    group_counts: dict[str, int] = {}

    for fact in passing:
        if fact.provenance == "derived":
            key = fact.pattern or f"{fact.provenance}:{fact.category}"
            if pattern_counts.get(key, 0) >= MAX_PER_DERIVED_PATTERN:
                rejections.append(
                    Rejection(
                        fact_id=fact.fact_id,
                        headline=fact.headline,
                        category=fact.category,
                        reason="pattern_cap",
                        detail=(
                            f"pattern {key!r} already contributed "
                            f"{MAX_PER_DERIVED_PATTERN} facts; this one is not "
                            "worse, it is one more of the same shape"
                        ),
                    )
                )
                continue
            pattern_counts[key] = pattern_counts.get(key, 0) + 1

        group = category_group(fact.category)
        if group_ceiling is not None and group_counts.get(group, 0) >= group_ceiling:
            rejections.append(
                Rejection(
                    fact_id=fact.fact_id,
                    headline=fact.headline,
                    category=fact.category,
                    reason="group_cap",
                    detail=(
                        f"rotation group {group!r} already holds {group_ceiling} "
                        "facts, the ceiling that keeps the daily sequence able to "
                        "alternate; this one is surplus, not weaker"
                    ),
                )
            )
            continue

        if fact.fact_id in seen_ids:
            rejections.append(
                Rejection(
                    fact_id=fact.fact_id,
                    headline=fact.headline,
                    category=fact.category,
                    reason="duplicate_id",
                    detail="a fact with this id is already in the bank",
                )
            )
            continue

        tokens = normalise_for_dedupe(fact.headline)
        collision = next(
            (
                (other.fact_id, jaccard(tokens, other_tokens))
                for other, other_tokens in kept_tokens
                if _comparable(fact, other)
                and jaccard(tokens, other_tokens) >= NEAR_DUPLICATE_THRESHOLD
            ),
            None,
        )
        if collision is not None:
            rejections.append(
                Rejection(
                    fact_id=fact.fact_id,
                    headline=fact.headline,
                    category=fact.category,
                    reason="near_duplicate",
                    detail=f"{collision[1]:.2f} token overlap with {collision[0]}",
                )
            )
            continue

        seen_ids.add(fact.fact_id)
        group_counts[group] = group_counts.get(group, 0) + 1
        kept_tokens.append((fact, tokens))
        kept.append(fact)

    return kept, rejections


def category_counts(facts: Iterable[NbaFact]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for fact in facts:
        counts[fact.category] = counts.get(fact.category, 0) + 1
    return dict(sorted(counts.items()))


def era_counts(facts: Iterable[NbaFact]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for fact in facts:
        counts[fact.era or "unknown"] = counts.get(fact.era or "unknown", 0) + 1
    return dict(sorted(counts.items()))


def mean_scores(facts: Sequence[NbaFact]) -> dict[str, float]:
    scored = [f for f in facts if f.quality is not None]
    if not scored:
        return {}
    axes = list(MIN_AXIS)
    return {
        axis: round(
            sum(getattr(f.quality, axis) for f in scored) / len(scored), 2
        )
        for axis in axes
    }
