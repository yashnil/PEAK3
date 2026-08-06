"""Assembling, writing, reading and reporting on the bank.

BUILD ORDER, AND WHY IT IS THIS ORDER
=====================================
    candidates = editorial + derived      both scored, neither trusted
    kept, rejected = quality.filter_and_dedupe(candidates)
    assert every kept fact is publishable

Editorial facts come first in the candidate list so that when an editorial fact
and a derived fact are near-duplicates of one another and score equally, the
one with a named human-checked source survives. (`filter_and_dedupe` sorts by
score and breaks ties on id, so this only decides genuine ties — it is a
tie-break, not a thumb on the scale.)

THE BUILD FAILS RATHER THAN SHIPS A THIN BANK. `MIN_FACTS` is a floor on what
the homepage can rotate through without repeating itself inside a season, and a
bank under it is a broken build rather than a small one.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Optional, Sequence

from . import awards as awards_module
from . import coverage
from . import derived as derived_module
from .editorial import EDITORIAL_PATH, load_editorial
from .quality import (
    Rejection,
    category_counts,
    era_counts,
    filter_and_dedupe,
    mean_scores,
)
from .rotation import fact_for_date, recent_window, schedule_audit
from .schema import CATEGORIES, FACT_BANK_VERSION, NbaFact

_REPO_ROOT = Path(__file__).resolve().parents[2]
BANK_PATH = _REPO_ROOT / "data" / "web" / "nba_facts.v1.json"

SOURCE_LABEL = derived_module.SOURCE_LABEL

#: A bank smaller than this is a broken build.
#:
#: RAISED FROM 40 TO 180, and the number is the product requirement rather than
#: a comfortable margin: a daily feature must not cycle its whole inventory
#: inside seven weeks. `schedule()` gives a period of exactly `len(bank)` days,
#: so this floor IS the no-repeat guarantee — 180 facts is 180 days before any
#: fact can come round again.
MIN_FACTS = 180


def build_candidates(
    rows: Optional[list[dict]] = None,
    editorial_path: Optional[Path] = None,
) -> list[NbaFact]:
    """Everything either half proposes, before anything is judged."""
    candidates: list[NbaFact] = list(load_editorial(editorial_path))
    source = rows if rows is not None else derived_module.load_rows()
    seen: set[str] = {fact.fact_id for fact in candidates}

    def collect(generators, generator_rows) -> None:
        for generator in generators:
            for fact in generator(generator_rows):
                if fact.fact_id in seen:
                    continue
                seen.add(fact.fact_id)
                candidates.append(fact)

    collect(derived_module.GENERATORS, source)
    # THE AWARD HALF. Season rows joined to the committed context table, so
    # these are still recomputed at build time and still carry the rows they
    # were computed from — a different KIND of fact, not a different standard.
    collect(awards_module.AWARD_GENERATORS, awards_module.load_context())
    return candidates


def build_bank(
    rows: Optional[list[dict]] = None,
    editorial_path: Optional[Path] = None,
) -> tuple[list[NbaFact], list[Rejection]]:
    """The published bank, and everything that did not make it."""
    return filter_and_dedupe(build_candidates(rows, editorial_path))


def bank_payload(bank: Sequence[NbaFact]) -> dict:
    return {
        "version": FACT_BANK_VERSION,
        "source_label": SOURCE_LABEL,
        "count": len(bank),
        "facts": [fact.as_dict() for fact in bank],
    }


def load_bank(path: Optional[Path] = None) -> list[NbaFact]:
    """Read the built bank. Empty when it has not been built.

    Empty rather than raising: a missing or unreadable bank must not turn every
    request into a 500. What it MUST do is stay visible, which is why
    `bank_status` exists and why `/health/readiness` reports it — an empty bank
    that nothing surfaced is exactly how a deployed staging API served 503 from
    /api/v1/nba-facts/today while reporting itself ready.
    """
    load_path = path or BANK_PATH
    if not load_path.exists():
        return []
    try:
        payload = json.loads(load_path.read_text())
    except (OSError, ValueError):
        return []
    return [NbaFact.from_dict(entry) for entry in payload.get("facts", [])]


@lru_cache(maxsize=1)
def cached_bank() -> tuple[NbaFact, ...]:
    """The process-wide bank. Read once, shared by every caller.

    ONE CACHE, so the route and the readiness probe can never disagree about
    whether the bank is present. Two independent caches would let readiness
    report "ready" from a warm copy while the route rebuilt and found nothing —
    which is the shape of the defect this function was added during.
    """
    return tuple(load_bank())


def clear_bank_cache() -> None:
    """Drop the process-wide bank — for tests that write a different one."""
    cached_bank.cache_clear()


def bank_status(path: Optional[Path] = None) -> dict:
    load_path = path or BANK_PATH
    facts = list(cached_bank()) if path is None else load_bank(path)
    return {
        "loaded": bool(facts),
        "fact_count": len(facts),
        "bank_version": FACT_BANK_VERSION,
        "path": str(load_path),
        "exists": load_path.exists(),
    }


# ---------------------------------------------------------------------------
# The generation report
# ---------------------------------------------------------------------------


def build_report(
    bank: Sequence[NbaFact],
    rejected: Sequence[Rejection],
    candidates: Sequence[NbaFact],
    sample_date: str,
) -> dict:
    """Everything the review asked the pipeline to be able to say about itself.

    Written as data rather than as prose so the markdown report is generated
    from the same run that produced the bank, and cannot describe a different
    one."""
    by_provenance: dict[str, int] = {}
    for fact in bank:
        by_provenance[fact.provenance] = by_provenance.get(fact.provenance, 0) + 1

    geography: dict[str, int] = {}
    for fact in bank:
        geography[fact.geography] = geography.get(fact.geography, 0) + 1

    reject_reasons: dict[str, int] = {}
    for rejection in rejected:
        reject_reasons[rejection.reason] = reject_reasons.get(rejection.reason, 0) + 1

    by_pattern: dict[str, int] = {}
    for fact in bank:
        key = fact.pattern or "editorial"
        by_pattern[key] = by_pattern.get(key, 0) + 1

    candidates_by_pattern: dict[str, int] = {}
    for fact in candidates:
        key = fact.pattern or "editorial"
        candidates_by_pattern[key] = candidates_by_pattern.get(key, 0) + 1

    scored = sorted(
        (f for f in bank if f.quality is not None),
        key=lambda f: (-(f.quality.total), f.fact_id),
    )

    # WOMEN'S BASKETBALL IS COUNTED SEPARATELY FROM GEOGRAPHY, because it is a
    # different question. A WNBA fact is domestic and a EuroLeague fact is
    # international; both are asked about, and one field cannot answer both.
    womens = sum(1 for f in bank if f.category == "womens")
    global_facts = sum(1 for f in bank if f.geography in ("global", "international"))

    semantic = coverage.coverage_counts(bank)

    return {
        "bank_version": FACT_BANK_VERSION,
        "total": len(bank),
        "candidates": len(candidates),
        "rejected": len(rejected),
        "duplicates": reject_reasons.get("near_duplicate", 0)
        + reject_reasons.get("duplicate_id", 0),
        "reject_reasons": dict(sorted(reject_reasons.items())),
        "by_provenance": dict(sorted(by_provenance.items())),
        "by_category": category_counts(bank),
        "by_era": era_counts(bank),
        "by_geography": dict(sorted(geography.items())),
        "distribution": {
            "nba_domestic": len(bank) - global_facts,
            "global_or_international": global_facts,
            "womens_basketball": womens,
        },
        "by_pattern": dict(sorted(by_pattern.items(), key=lambda kv: (-kv[1], kv[0]))),
        "candidates_by_pattern": dict(sorted(candidates_by_pattern.items())),
        "perishable": [
            {"headline": f.headline, "category": f.category,
             "valid_until": f.valid_until}
            for f in bank
            if f.valid_until
        ],
        "unused_categories": sorted(set(CATEGORIES) - {f.category for f in bank}),
        "mean_scores": mean_scores(bank),
        "strongest": [
            {"headline": f.headline, "category": f.category,
             "provenance": f.provenance, "total": f.quality.total}
            for f in scored[:20]
        ],
        "weakest": [
            {"headline": f.headline, "category": f.category,
             "provenance": f.provenance, "total": f.quality.total}
            for f in scored[-5:]
        ],
        # WHAT THE BANK IS ABOUT, as opposed to how it is filed. `by_category`
        # above cannot answer "does this cover the Olympics": a fact has one
        # category and can be about several things, and the category counter
        # reported four women's-basketball facts for a bank that had ten.
        "semantic_coverage": [
            {
                "group": group,
                "label": coverage.GROUP_LABELS[group],
                "count": semantic.get(group, 0),
                "target": coverage.COVERAGE_TARGETS.get(group),
            }
            for group in coverage.SEMANTIC_GROUPS
        ],
        "coverage_shortfalls": coverage.shortfalls(bank),
        "rotation": schedule_audit(bank),
        "repeat_window": _repeat_window_audit(bank, sample_date),
        "rejected_examples": [
            {"headline": r.headline, "category": r.category,
             "reason": r.reason, "detail": r.detail}
            for r in list(rejected)[:8]
        ],
    }


def _repeat_window_audit(bank: Sequence[NbaFact], sample_date: str) -> dict:
    """How many days a reader can watch before seeing anything twice.

    Measured by actually serving the days rather than by reasoning about the
    schedule's period, so a change to selection that broke the guarantee would
    show up here rather than in the comment above it.
    """
    days = max(len(bank) + 5, 200)
    served = recent_window(bank, sample_date, days)
    first_repeat = None
    seen: dict[str, int] = {}
    for index, fact in enumerate(served):
        if fact.fact_id in seen and first_repeat is None:
            first_repeat = index - seen[fact.fact_id]
        seen.setdefault(fact.fact_id, index)
    return {
        "days_examined": days,
        "distinct_facts_served": len(seen),
        "first_repeat_after_days": first_repeat,
        "subject_window_days": schedule_audit(bank)["subject_window_days"],
    }


__all__ = [
    "BANK_PATH",
    "EDITORIAL_PATH",
    "MIN_FACTS",
    "SOURCE_LABEL",
    "bank_payload",
    "bank_status",
    "build_bank",
    "build_candidates",
    "build_report",
    "cached_bank",
    "clear_bank_cache",
    "fact_for_date",
    "load_bank",
]
