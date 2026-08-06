"""Semantic coverage: what the bank is ABOUT, as opposed to how it is filed.

WHY A SECOND CLASSIFICATION EXISTS
==================================
`category` is one label per fact, chosen by whichever generator or curator
produced it, and it is the field the rotation buckets by. It is a poor answer to
"does this bank cover the Olympics", for two reasons:

  * A fact has ONE category and can be about several things. "The Dream Team
    exists because of a vote the United States lost" is filed `olympics_fiba`
    and is equally a piece of foundational NBA history, a rule change, and a
    global-basketball fact. Counting it once, under one heading, understates
    every other heading it belongs to.
  * A category can under-report a subject it does not name. Six facts are filed
    `olympics_fiba`, but the bank's coverage of international basketball also
    includes Sabonis's nine-year wait (filed `draft`), Oscar Schmidt (filed
    `global`), and Petrović (filed `player_story`).

So the audit that decides whether an area is genuinely thin has to read what a
fact is about rather than which drawer it went in. Reporting `womens: 4` from
the category counter and concluding the bank has four women's-basketball facts
is only correct if no fact outside that category is about women's basketball —
which is a claim, not a definition.

HOW A FACT LANDS IN A GROUP
===========================
Two routes, and both are deliberate:

  1. ITS CATEGORY. Each group names the categories that always count. This is
     the strong signal and does most of the work.
  2. ITS TEXT, against an explicit lexicon. A fact from any category joins a
     group when its headline or body actually names that subject. This is what
     catches the Sabonis and Petrović cases.

Geography and expiry are read directly, because they are already structured
answers to two of the questions.

A FACT MAY BELONG TO SEVERAL GROUPS, and the counts therefore sum to more than
the size of the bank. That is the point: "how many facts touch the Olympics"
and "how many facts are filed under the Olympics" are different questions and
the second one is not the one being asked.

THE LEXICONS ARE NARROW ON PURPOSE. A generous matcher would make coverage look
solved by definition, which is exactly the failure mode a coverage goal invites.
Each list below is proper nouns and terms of art — things a fact cannot mention
in passing without being at least partly about them.
"""
from __future__ import annotations

import re
from typing import Iterable, Sequence

from .schema import NbaFact

#: The fifteen areas the product brief asks the bank to cover, in its order.
SEMANTIC_GROUPS: tuple[str, ...] = (
    "foundational_history",
    "obscure_history",
    "current_nba",
    "playoffs_finals",
    "records_oddities",
    "draft",
    "tactics",
    "rules",
    "global_international",
    "fiba_olympics",
    "international_leagues",
    "womens",
    "culture",
    "geographic",
    "connections",
)

GROUP_LABELS: dict[str, str] = {
    "foundational_history": "Foundational and iconic NBA history",
    "obscure_history": "Obscure but meaningful NBA history",
    "current_nba": "Active / current NBA",
    "playoffs_finals": "Playoffs and Finals",
    "records_oddities": "Records and statistical oddities",
    "draft": "Draft history",
    "tactics": "Tactical evolution",
    "rules": "Rule evolution",
    "global_international": "Global and international basketball",
    "fiba_olympics": "FIBA and the Olympics",
    "international_leagues": "International leagues",
    "womens": "Women's basketball and the WNBA",
    "culture": "Basketball culture",
    "geographic": "Geographic basketball stories",
    "connections": "Surprising player and team connections",
}

#: Categories that place a fact in a group outright.
_BY_CATEGORY: dict[str, tuple[str, ...]] = {
    "foundational_history": ("nba_history", "historic_games"),
    "obscure_history": ("obscure_history",),
    "current_nba": ("current_nba",),
    "playoffs_finals": ("playoffs_finals",),
    "records_oddities": ("records", "statistical_oddity", "streaks"),
    "draft": ("draft",),
    "tactics": ("tactics",),
    "rules": ("rules",),
    "global_international": ("global", "international_leagues", "olympics_fiba"),
    "fiba_olympics": ("olympics_fiba",),
    "international_leagues": ("international_leagues",),
    "womens": ("womens",),
    "culture": ("culture",),
    "geographic": ("franchise",),
    "connections": ("connections",),
}

#: Terms of art and proper nouns. A fact cannot mention these in passing
#: without being at least partly about the subject.
_LEXICON: dict[str, tuple[str, ...]] = {
    "foundational_history": (
        "naismith", "peach basket", "aba", "merger", "shot clock",
        "first olympic", "1936", "invented",
    ),
    "obscure_history": ("almost called", "nearly called", "before it was", "until 19"),
    "playoffs_finals": (
        "finals", "conference finals", "championship", "title in the same season",
        "won the title", "game 7", "game 6", "playoff",
    ),
    "draft": ("draft", "drafted", "lottery", "overall pick", "second round"),
    "tactics": (
        "three-point line", "three-pointer", "zone defence", "zone defense",
        "hand-check", "hand checking", "spacing", "pace", "defensive three",
        "illegal defense", "how the game", "tactic",
    ),
    "rules": (
        "rule", "outlawed", "banned", "legalised", "legalized", "violation",
        "shot clock", "24-second", "uniform rule", "goaltending",
    ),
    "global_international": (
        "fiba", "olympic", "euroleague", "eurobasket", "world cup",
        "lithuania", "serbia", "yugoslavia", "spain", "argentina", "brazil",
        "greece", "australia", "canada", "france", "germany", "china",
        "philippines", "africa", "nigeria", "cameroon", "slovenia", "croatia",
        "international", "abroad", "overseas", "national team", "angola",
        "rwanda", "kigali", "barangay", "cba", "nbl",
    ),
    "fiba_olympics": (
        "olympic", "olympics", "fiba", "world cup", "national team", "dream team",
    ),
    "international_leagues": (
        "euroleague", "cba ", "nbl", "basketball africa league", "aba liga",
        "chinese basketball association", "shanghai sharks", "panathinaikos",
        "real madrid", "national league",
    ),
    "womens": (
        "wnba", "women", "women's", "comets", "taurasi", "swoopes", "mercury",
        "liberty", "sparks", "fever",
    ),
    "culture": (
        "sneaker", "shoe", "converse", "chuck taylor", "air jordan", "nba jam",
        "arcade", "commercial", "advertis", "tie-dye", "grateful dead",
        "second religion", "obsession", "culture",
    ),
    "geographic": (
        "relocat", "moved to", "named after", "expansion", "vancouver",
        "seattle", "minneapolis", "new orleans", "salt lake", "memphis",
        "toronto", "city of", "land of",
    ),
    "connections": (
        "years later", "decades later", "the same man", "years apart",
        "went on to",
    ),
}


def _bounded(term: str) -> str:
    """One lexicon term as a regex that matches the WORD and not a substring.

    THIS WAS A REAL SOURCE OF INFLATION, and inflation is the exact failure a
    coverage target invites. Without boundaries `pace` matched "space",
    `rule` matched "ruled", and `later` matched any sentence with the word in
    it — so `playoffs_finals` reported 83 facts where 42 are actually about the
    postseason, and the audit was congratulating itself on prose.

    THE TRAILING BOUNDARY IS SKIPPED AFTER A DIGIT, on purpose. `until 19` and
    `1936` are era prefixes meant to match "until 1976" and "1936 Berlin"; a
    `\\b` after `9` or `6` would require the next character to be a non-word
    one, which is precisely the case these terms exist to catch. Letters get
    the boundary; digits do not.
    """
    pattern = re.escape(term)
    prefix = r"\b" if term[0].isalnum() else ""
    suffix = r"\b" if term[-1].isalpha() else ""
    return f"{prefix}{pattern}{suffix}"


_COMPILED: dict[str, re.Pattern] = {
    group: re.compile("|".join(_bounded(term) for term in terms), re.IGNORECASE)
    for group, terms in _LEXICON.items()
}


def semantic_groups(fact: NbaFact) -> set[str]:
    """Every semantic area this fact belongs to. Usually more than one."""
    groups: set[str] = set()
    text = f"{fact.headline} {fact.body}"

    for group, categories in _BY_CATEGORY.items():
        if fact.category in categories:
            groups.add(group)

    for group, pattern in _COMPILED.items():
        if pattern.search(text):
            groups.add(group)

    # STRUCTURED FIELDS BEAT KEYWORDS where a structured field exists.
    if fact.geography in ("global", "international"):
        groups.add("global_international")
    # "Current" means the fact makes a claim about the present, and the honest
    # marker for that is the expiry it is required to carry — not its era, and
    # not whether a player happens to still be active.
    if fact.valid_until or fact.category == "current_nba":
        groups.add("current_nba")

    return groups


def coverage_counts(bank: Sequence[NbaFact]) -> dict[str, int]:
    counts = {group: 0 for group in SEMANTIC_GROUPS}
    for fact in bank:
        for group in semantic_groups(fact):
            counts[group] = counts.get(group, 0) + 1
    return counts


def facts_in_group(bank: Iterable[NbaFact], group: str) -> list[NbaFact]:
    return [fact for fact in bank if group in semantic_groups(fact)]


def uncovered(bank: Sequence[NbaFact]) -> list[str]:
    """Groups with nothing in them at all."""
    counts = coverage_counts(bank)
    return sorted(group for group, count in counts.items() if count == 0)


#: The brief's preferred minima. Stated here rather than in the report writer so
#: a test and the report read the same numbers.
COVERAGE_TARGETS: dict[str, int] = {
    "global_international": 25,
    "womens": 10,
    "current_nba": 10,
    "tactics": 5,
    "rules": 5,
    "foundational_history": 25,
}

#: `tactics` and `rules` are asked for as a combined floor of ten, because a
#: rule change and the tactic it produced are usually the same story told from
#: two ends. Split evenly above, checked together here.
COMBINED_TARGETS: dict[tuple[str, ...], int] = {
    ("tactics", "rules"): 10,
}


def shortfalls(bank: Sequence[NbaFact]) -> dict[str, tuple[int, int]]:
    """Every target that is not met, as {group: (have, want)}."""
    counts = coverage_counts(bank)
    out: dict[str, tuple[int, int]] = {}
    for group, want in COVERAGE_TARGETS.items():
        have = counts.get(group, 0)
        if have < want:
            out[group] = (have, want)
    for groups, want in COMBINED_TARGETS.items():
        have = len(
            {
                fact.fact_id
                for group in groups
                for fact in facts_in_group(bank, group)
            }
        )
        if have < want:
            out[" + ".join(groups)] = (have, want)
    return out
