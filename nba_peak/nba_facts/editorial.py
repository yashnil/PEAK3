"""The curated half of the bank, and the gate it has to pass to get in.

WHY A COMMITTED FILE RATHER THAN A GENERATOR
============================================
Every category the brief asks for — rule changes, the Olympics, EuroLeague, the
WNBA, a draft nobody has stopped arguing about, why the shot clock is 24
seconds — is outside what any generator over a per-season totals table could
ever emit. The old bank was not badly written; it was written against data that
can only describe tenure, workload and roster churn, which is why it produced
sentences like "played exactly one season for each of four franchises".

WHY A COMMITTED FILE RATHER THAN A MODEL AT BUILD TIME
======================================================
An entry here is authored and CHECKED before it reaches the repository. A model
may help draft or rank candidates during that authoring — the brief permits it
— but nothing in this pipeline calls one, at build time or at request time, so:

  * the build is a pure function of committed inputs and is byte-reproducible;
  * a fact cannot change because a model changed;
  * "where did this come from" has an answer that is a citation rather than a
    generation.

THE GATE, AND WHY IT IS A HARD FAILURE
=======================================
`load_editorial` REFUSES the whole build on an entry that is unverified, has no
`source_detail`, has an unknown category, or is perishable with no expiry. Not a
warning, not a skip: a bank that silently drops the one fact somebody forgot to
source is a bank whose sourcing rule is decorative. The build stops and names
the entry.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from .schema import (
    CATEGORIES,
    GEOGRAPHIES,
    NbaFact,
    PERISHABLE_CATEGORIES,
    QualityScores,
    fact_id,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
EDITORIAL_PATH = _REPO_ROOT / "data" / "facts" / "editorial_facts.json"


class EditorialFactError(ValueError):
    """An entry that must not be published, and exactly why."""


def load_editorial(path: Optional[Path] = None) -> list[NbaFact]:
    source = path or EDITORIAL_PATH
    if not source.exists():
        # RAISES RATHER THAN RETURNING NOTHING, and the difference is a release
        # blocker's worth of diagnosis.
        #
        # This used to `return []`, which reads as tolerant and is not: the
        # curated half is not optional, and a build that cannot find it has a
        # broken input rather than a smaller bank. What actually happened is
        # that the Docker image never copied `data/facts/`, so the whole
        # editorial half vanished, and the FIRST thing to notice was
        # `build_nba_facts.py` four steps later reporting
        #
        #     ERROR: only 113 facts published, expected at least 180
        #
        # which names a symptom. Worse, 113 is not "228 minus the 91 editorial
        # facts": the rotation-group ceiling is a SHARE of the provisional bank
        # (`quality.MAX_ROTATION_GROUP_SHARE`), so removing 91 candidates
        # shrank the denominator and evicted 24 DERIVED facts as well. A count
        # that moves for two reasons at once is a count nobody can work
        # backwards from.
        #
        # `awards.load_context` has raised on its missing input from the start,
        # and `derived.load_rows` raises through `read_text`. This is the third
        # input behaving like the other two.
        raise EditorialFactError(
            f"Editorial facts missing at {source}. They are committed; a "
            "checkout or an image without them is broken rather than "
            "un-built. If this is a container build, `data/facts/` is not "
            "being copied in."
        )
    payload = json.loads(source.read_text())
    facts: list[NbaFact] = []
    for entry in payload.get("facts", []):
        facts.append(_build(entry, source))
    return facts


def _require(entry: dict, field: str, source: Path) -> str:
    value = str(entry.get(field) or "").strip()
    if not value:
        raise EditorialFactError(
            f"{source.name}: entry {entry.get('key', '<no key>')!r} has no {field}."
        )
    return value


def _build(entry: dict, source: Path) -> NbaFact:
    key = _require(entry, "key", source)
    category = _require(entry, "category", source)
    if category not in CATEGORIES:
        raise EditorialFactError(
            f"{source.name}: entry {key!r} has unknown category {category!r}. "
            f"Known categories: {', '.join(CATEGORIES)}"
        )

    if not entry.get("verified", False):
        # THE WHOLE POINT OF THE FIELD. An unverified entry is a draft, and a
        # draft on a homepage is indistinguishable from a checked fact.
        raise EditorialFactError(
            f"{source.name}: entry {key!r} is not marked verified. Every "
            "published fact must be checked against its named source first."
        )
    source_detail = _require(entry, "source_detail", source)

    valid_until = entry.get("valid_until")
    if category in PERISHABLE_CATEGORIES and not valid_until:
        # "LeBron James is the league's all-time leading scorer" is true until
        # it is not, and a bank with no expiry eventually publishes something
        # false with full confidence.
        raise EditorialFactError(
            f"{source.name}: entry {key!r} is in the perishable category "
            f"{category!r} and carries no `valid_until`. A fact about the "
            "present needs a date after which it stops being served."
        )

    geography = str(entry.get("geography") or "usa")
    if geography not in GEOGRAPHIES:
        raise EditorialFactError(
            f"{source.name}: entry {key!r} has unknown geography {geography!r}."
        )

    quality = entry.get("quality")
    if not quality:
        raise EditorialFactError(
            f"{source.name}: entry {key!r} carries no quality scores. Every "
            "candidate is scored before the filter can reject it."
        )

    return NbaFact(
        # The id is derived from the STABLE KEY, not from the wording, so an
        # edited sentence keeps its place in the calendar and a new fact takes
        # a new one.
        fact_id=fact_id(category, key),
        headline=_require(entry, "headline", source),
        body=str(entry.get("body") or "").strip(),
        category=category,
        era=str(entry.get("era") or ""),
        provenance="editorial",
        source_label=_require(entry, "source_label", source),
        source_detail=source_detail,
        verified=True,
        geography=geography,
        quality=QualityScores.from_dict(quality),
        valid_until=valid_until,
        feature=entry.get("feature"),
        feature_label=entry.get("feature_label"),
        evidence=(),
        player_slug=entry.get("player_slug"),
        team_code=entry.get("team_code"),
    )
