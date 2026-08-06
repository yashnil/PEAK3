"""NBA Fact of the Day.

WHAT CHANGED, AND WHY THIS IS A PACKAGE NOW
===========================================
The first version was one module and one idea: generators over the committed
per-season table, each fact carrying the rows it was computed from. The
verification story was excellent — a fact could not be wrong in a way nobody
could check — and the manual review's verdict on the output was still correct:

    "NBA Fact of the Day is visually weak and the generated fact is often too
     dull to deserve homepage prominence."

    "Ricky Pierce played exactly one season for each of four franchises."

The cause is structural, not editorial. A per-season totals table can express
tenure, workload and roster churn, and nothing else. Every category worth
reading — the rule changes, the Olympics, the EuroLeague, the WNBA, the drafts
nobody has stopped arguing about — is outside anything a generator over that
table could ever emit.

So the bank now has two halves, held to different but equally hard standards,
and three things that never existed:

    schema      what a fact is, including its provenance and its expiry
    derived     the original generators, now SCORED
    editorial   curated, human-checked entries, each naming its source
    quality     seven axes, per-axis floors, and near-duplicate detection
    rotation    balanced by category-group and era, not a blind walk
    bank        assembly, the build report, and the process-wide cache

NOTHING CALLS A LANGUAGE MODEL, at build time or at request time. A model may
help draft or rank candidates while `data/facts/editorial_facts.json` is being
written; what enters this repository is a committed file whose every entry names
a source somebody checked, and the build is a pure function of that file plus
the committed season table. Running it twice produces a byte-identical bank.

WHAT `evidence` IS FOR NOW. It is kept and it is no longer shown. The homepage
rendered a four-column "source rows" table behind a `<details>`, which made the
primary interaction on a trivia card an invitation to read a database. The rows
stay in the payload because they are what makes a derived fact checkable and
what the tests re-derive; the card shows a fact.
"""
from __future__ import annotations

from .bank import (
    BANK_PATH,
    MIN_FACTS,
    SOURCE_LABEL,
    bank_payload,
    bank_status,
    build_bank,
    build_candidates,
    build_report,
    cached_bank,
    clear_bank_cache,
    load_bank,
)
from .awards import AWARD_GENERATORS, load_context
from .derived import GENERATORS, load_rows
from .editorial import EDITORIAL_PATH, EditorialFactError, load_editorial
from .quality import (
    MAX_PER_DERIVED_PATTERN,
    MAX_ROTATION_GROUP_SHARE,
    MIN_AXIS,
    MIN_TOTAL,
    NEAR_DUPLICATE_THRESHOLD,
    filter_and_dedupe,
)
from .rotation import (
    SUBJECT_SPACING_DAYS,
    fact_for_date,
    is_live,
    recent_window,
    schedule,
    schedule_audit,
)
from .schema import (
    CATEGORIES,
    FACT_BANK_VERSION,
    PERISHABLE_CATEGORIES,
    NbaFact,
    QualityScores,
)

__all__ = [
    "BANK_PATH",
    "CATEGORIES",
    "EDITORIAL_PATH",
    "EditorialFactError",
    "FACT_BANK_VERSION",
    "AWARD_GENERATORS",
    "GENERATORS",
    "load_context",
    "MIN_AXIS",
    "MIN_FACTS",
    "MIN_TOTAL",
    "MAX_PER_DERIVED_PATTERN",
    "MAX_ROTATION_GROUP_SHARE",
    "NEAR_DUPLICATE_THRESHOLD",
    "SUBJECT_SPACING_DAYS",
    "PERISHABLE_CATEGORIES",
    "SOURCE_LABEL",
    "NbaFact",
    "QualityScores",
    "bank_payload",
    "bank_status",
    "build_bank",
    "build_candidates",
    "build_report",
    "cached_bank",
    "clear_bank_cache",
    "fact_for_date",
    "filter_and_dedupe",
    "is_live",
    "load_bank",
    "load_editorial",
    "load_rows",
    "recent_window",
    "schedule",
    "schedule_audit",
]
