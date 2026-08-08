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
    featured    the HOMEPAGE tier — a second, stricter gate over the bank
    rotation    balanced by category-group and era, not a blind walk
    bank        assembly, the build report, and the process-wide cache

TWO GATES, AND THE SECOND ONE IS THE HOMEPAGE'S. `quality` decides what may be
PUBLISHED; `featured` decides what may be THE THING ON THE PAGE. They are
separate because the first cannot do the second's job: a derived fact's seven
axes are constants of its template, so one generator clearing the publication
floor puts its entire family through in a block, and the homepage ends up
serving a shape rather than a fact. `rotation.fact_for_date` draws from the
featured tier only; the wider bank remains the reservoir it is selected from.

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
    REQUIRED_INPUTS,
    SOURCE_LABEL,
    assert_inputs_present,
    bank_payload,
    bank_status,
    build_bank,
    build_candidates,
    build_report,
    cached_bank,
    clear_bank_cache,
    load_bank,
    missing_inputs,
)
from .awards import AWARD_GENERATORS, load_context
from .derived import GENERATORS, load_rows
from .editorial import EDITORIAL_PATH, EditorialFactError, load_editorial
from .featured import (
    FEATURED_MIN_AXIS,
    FEATURED_MIN_TOTAL,
    MAX_FEATURED_PER_PATTERN,
    MIN_FEATURED_FACTS,
    SUBJECTIVE_CLAIMS,
    clear_featured_cache,
    featured_facts,
    featured_failures,
    featured_markdown,
    featured_report,
    select_featured,
    subjective_claim,
)
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
from .validation import (
    CLAIM_TYPES,
    HEDGE_PHRASES,
    MODEL_VOICE_PHRASES,
    SUBJECTIVE_PHRASES,
    SUPERLATIVE_CLAIM_TYPE,
    SUPERLATIVE_PHRASES,
    BannedPhrase,
    FactValidationError,
    banned_phrases,
    validate_entry,
)

__all__ = [
    "BANK_PATH",
    "BannedPhrase",
    "CATEGORIES",
    "CLAIM_TYPES",
    "EDITORIAL_PATH",
    "EditorialFactError",
    "FactValidationError",
    "HEDGE_PHRASES",
    "MODEL_VOICE_PHRASES",
    "SUBJECTIVE_PHRASES",
    "SUPERLATIVE_CLAIM_TYPE",
    "SUPERLATIVE_PHRASES",
    "banned_phrases",
    "validate_entry",
    "FACT_BANK_VERSION",
    "AWARD_GENERATORS",
    "GENERATORS",
    "load_context",
    "FEATURED_MIN_AXIS",
    "FEATURED_MIN_TOTAL",
    "MIN_AXIS",
    "MIN_FACTS",
    "MIN_FEATURED_FACTS",
    "MIN_TOTAL",
    "REQUIRED_INPUTS",
    "MAX_FEATURED_PER_PATTERN",
    "MAX_PER_DERIVED_PATTERN",
    "MAX_ROTATION_GROUP_SHARE",
    "SUBJECTIVE_CLAIMS",
    "NEAR_DUPLICATE_THRESHOLD",
    "SUBJECT_SPACING_DAYS",
    "PERISHABLE_CATEGORIES",
    "SOURCE_LABEL",
    "NbaFact",
    "QualityScores",
    "assert_inputs_present",
    "bank_payload",
    "bank_status",
    "build_bank",
    "build_candidates",
    "build_report",
    "cached_bank",
    "clear_bank_cache",
    "clear_featured_cache",
    "fact_for_date",
    "featured_facts",
    "featured_failures",
    "featured_markdown",
    "featured_report",
    "filter_and_dedupe",
    "is_live",
    "load_bank",
    "select_featured",
    "subjective_claim",
    "load_editorial",
    "load_rows",
    "missing_inputs",
    "recent_window",
    "schedule",
    "schedule_audit",
]
