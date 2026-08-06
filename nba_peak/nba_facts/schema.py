"""What a fact IS: its shape, its provenance, and what it must carry to ship.

WHY THIS FILE GREW A PROVENANCE MODEL
=====================================
The first bank had one kind of fact: something a generator computed from the
committed per-season table, carrying the rows it was computed from. That is an
excellent verification story — a fact cannot be wrong in a way nobody can check
— and it produced a bank that was, in the manual review's words, *technically
valid but not sufficiently compelling*:

    "Ricky Pierce played exactly one season for each of four franchises."

The reason is structural rather than editorial. That table holds per-season
totals and team codes, so the only patterns it can express are patterns about
tenure, workload and roster churn. It cannot know that the 1961-62 NBA had a
75-game schedule, that FIBA widened the three-point line in 2010, or that the
shot clock was invented because of a 19-18 game. Every interesting category the
brief asks for is outside what any generator over this table could ever emit.

So a fact now declares HOW IT IS KNOWN, and the two answers are held to
different — not weaker — standards:

    derived    computed by a generator from committed structured data in this
               repository. Verified by construction and re-derivable: the build
               recomputes it, and a changed value means the data changed.
               Carries `evidence` rows.

    editorial  a curated entry in `data/facts/editorial_facts.json`, reviewed
               by a person. Carries a NAMED SOURCE and a `verified` flag, and
               `build_bank` REFUSES to publish one without both. There is no
               "probably true" state: a fact either has a source somebody
               checked or it is not in the bank.

NO LLM RUNS AT REQUEST TIME, AND NONE IS REQUIRED AT BUILD TIME EITHER. A model
may help draft or rank candidates while the editorial file is being written —
that is authoring, and it happens before anything reaches this repository. What
enters the bank is a committed JSON file whose every entry names a source, and
the build is a pure function of that file plus the committed season table.
Running it twice produces a byte-identical bank.

WHAT `evidence` IS FOR NOW
==========================
It is kept, and it is no longer shown. The homepage rendered a four-column
"source rows" table behind a `<details>`, which made the primary interaction on
a trivia card an invitation to read a database. The rows stay in the payload
because they are what makes a derived fact checkable and what the tests
re-derive; the card shows a fact.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Optional

#: Bumped whenever the pipeline changes what it emits for unchanged inputs.
#: Part of the rotation hash, so a regenerated bank reshuffles the calendar
#: rather than silently swapping today's fact for a different one.
FACT_BANK_VERSION = "nba_facts_v2"

#: THE CATEGORY VOCABULARY, and it is the brief's list rather than the old
#: bank's. The seven categories the first bank had (`franchise_tenure`,
#: `age_season`, `role_player`, `career_arc`, `streak`, `rare_threshold`,
#: `era_anomaly`) were the seven things a per-season totals table can express,
#: which is why the bank read as a survey of roster churn. Every entry below is
#: something a reader might repeat to somebody.
CATEGORIES: tuple[str, ...] = (
    "nba_history",          # the canonical moments
    "obscure_history",      # real, meaningful, and not widely known
    "current_nba",          # active players and live milestones — EXPIRES
    "player_story",         # a person, not a stat line
    "connections",          # two things a reader would not have put together
    "records",              # the record itself, and what it cost
    "playoffs_finals",      # the postseason and the Finals
    "franchise",            # a team, a city, a relocation, an oddity
    "rules",                # a rule, and the game that caused it
    "tactics",              # how the game is actually played, and why it changed
    "draft",                # the draft, and what it got wrong
    "global",               # basketball outside the United States
    "olympics_fiba",        # national teams, the Olympics, the World Cup
    "womens",               # the WNBA and women's basketball
    "international_leagues",# EuroLeague, CBA, NBL, and the rest
    "culture",              # the game as a cultural object
    "statistical_oddity",   # a coincidence that survives being checked
    "streaks",              # a run, and what ended it
    "role_players",         # the overlooked
    "historic_games",       # one night, one season
    # Retained so an already-built v1 bank still loads rather than raising.
    # Nothing new is emitted under these.
    "franchise_tenure",
    "age_season",
    "role_player",
    "career_arc",
    "streak",
    "rare_threshold",
    "era_anomaly",
)

#: Categories whose facts are ABOUT THE PRESENT and go stale. Anything in one of
#: these must carry `valid_until`; `build_bank` refuses otherwise. "LeBron James
#: is the league's all-time leading scorer" is true until it is not, and a bank
#: with no expiry is a bank that eventually publishes something false.
PERISHABLE_CATEGORIES = frozenset({"current_nba"})

PROVENANCE = ("derived", "editorial")

GEOGRAPHIES = (
    "usa",
    "international",
    "global",
)


@dataclass(frozen=True)
class QualityScores:
    """Seven axes, each 0-5, scored per candidate before anything is published.

    THEY ARE SEPARATE ON PURPOSE. A fact can be surprising and unclear
    (a coincidence that needs three sentences of setup), or clear and
    uninteresting (a roster count), and one blended number cannot reject either.
    The homepage cares most about the last axis, which is why it is not an
    average of the others: a genuinely surprising fact that needs a paragraph of
    caveats is exactly the thing the review asked to stop publishing.
    """

    surprise: int
    significance: int
    clarity: int
    broad_interest: int
    novelty: int
    source_confidence: int
    homepage_suitability: int

    def as_dict(self) -> dict:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, data: dict) -> "QualityScores":
        return cls(**{k: int(data.get(k, 0)) for k in cls.__annotations__})

    @property
    def total(self) -> int:
        return sum(self.__dict__.values())


@dataclass(frozen=True)
class NbaFact:
    """One publishable fact.

    `headline` and `body` are separate because the card is: a compelling lead a
    reader takes in at a glance, then one or two sentences that make it hold up.
    The old bank had a single `text` field, so every fact was one long sentence
    and the card had one typographic register to work with.
    """

    fact_id: str
    headline: str
    body: str
    category: str
    era: str
    provenance: str
    source_label: str
    #: The specific record consulted, for an editorial fact. Kept internally and
    #: NOT rendered as a table on the homepage.
    source_detail: str = ""
    #: Whether a person checked this against the named source. An editorial
    #: fact with this False never reaches the bank.
    verified: bool = True
    geography: str = "usa"
    quality: Optional[QualityScores] = None
    #: ISO date after which this fact must not be served. Required for anything
    #: in `PERISHABLE_CATEGORIES`.
    valid_until: Optional[str] = None
    #: WHICH GENERATOR PRODUCED THIS, for derived facts. `None` for editorial.
    #:
    #: The per-pattern cap used to count by (provenance, category), which was a
    #: proxy that stopped working the moment several generators shared a
    #: category: capping `statistical_oddity` at six capped four different
    #: patterns collectively rather than each. Naming the pattern makes the cap
    #: exact and lets the build report say how many candidates each generator
    #: produced and how many shipped.
    pattern: Optional[str] = None
    #: The number, name or event the card can feature typographically.
    feature: Optional[str] = None
    feature_label: Optional[str] = None
    evidence: tuple[dict, ...] = field(default_factory=tuple)
    player_slug: Optional[str] = None
    team_code: Optional[str] = None

    # -- compatibility ------------------------------------------------------
    @property
    def text(self) -> str:
        """The v1 field name. One string, for anything still reading it."""
        return f"{self.headline} {self.body}".strip()

    def as_dict(self) -> dict:
        return {
            "fact_id": self.fact_id,
            "headline": self.headline,
            "body": self.body,
            # Retained so a client built against v1 keeps rendering.
            "text": self.text,
            "category": self.category,
            "era": self.era,
            "provenance": self.provenance,
            "source_label": self.source_label,
            "source_detail": self.source_detail,
            "verified": self.verified,
            "geography": self.geography,
            "quality": self.quality.as_dict() if self.quality else None,
            "valid_until": self.valid_until,
            "pattern": self.pattern,
            "feature": self.feature,
            "feature_label": self.feature_label,
            "evidence": [dict(row) for row in self.evidence],
            "player_slug": self.player_slug,
            "team_code": self.team_code,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "NbaFact":
        quality = data.get("quality")
        headline = data.get("headline")
        body = data.get("body")
        if headline is None:
            # A v1 entry: one `text` field, no split. Split it at the first
            # sentence boundary rather than dropping half of it.
            text = str(data.get("text") or "")
            head, _, rest = text.partition(". ")
            headline = (head + ".") if rest else text
            body = rest
        return cls(
            fact_id=str(data["fact_id"]),
            headline=str(headline),
            body=str(body or ""),
            category=str(data["category"]),
            era=str(data.get("era") or ""),
            provenance=str(data.get("provenance") or "derived"),
            source_label=str(data.get("source_label") or ""),
            source_detail=str(data.get("source_detail") or ""),
            verified=bool(data.get("verified", True)),
            geography=str(data.get("geography") or "usa"),
            quality=QualityScores.from_dict(quality) if quality else None,
            valid_until=data.get("valid_until"),
            pattern=data.get("pattern"),
            feature=data.get("feature"),
            feature_label=data.get("feature_label"),
            evidence=tuple(dict(row) for row in (data.get("evidence") or ())),
            player_slug=data.get("player_slug"),
            team_code=data.get("team_code"),
        )


def fact_id(category: str, *parts: str) -> str:
    """A stable id from the fact's IDENTITY, never from its wording.

    Rewording a fact must not move it in the calendar; adding or removing one
    should. Hashing the text would get that exactly backwards.
    """
    digest = hashlib.sha256("|".join((category, *parts)).encode("utf-8")).hexdigest()
    return f"{category}-{digest[:12]}"


_WORD = re.compile(r"[a-z0-9]+")


def normalise_for_dedupe(text: str) -> frozenset[str]:
    """The token set two facts are compared on.

    Lowercased words with the commonest English glue removed, as a SET rather
    than a sequence: two facts that say the same thing in a different order are
    the same fact, and the bank had no way to notice.
    """
    stop = {
        "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for",
        "with", "by", "from", "as", "is", "was", "were", "are", "be", "been",
        "has", "have", "had", "his", "her", "their", "its", "it", "that",
        "this", "than", "then", "but", "not", "no", "one", "two", "he", "she",
        "they", "who", "which", "when", "after", "before", "over", "into",
    }
    return frozenset(w for w in _WORD.findall(text.lower()) if w not in stop)


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)
