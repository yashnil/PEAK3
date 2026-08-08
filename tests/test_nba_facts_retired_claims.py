"""The claims this bank has already published once and must never publish again.

WHY THIS FILE IS SEPARATE FROM `test_nba_facts_validation.py`, AND WHY IT HAD TO
EXIST AT ALL
=============================================================================
`validation.py` enforces STRUCTURE and VERIFIABILITY: that an entry names a
dereferenceable source, carries a review date, declares what kind of claim it is
making, and does not reach for language a source cannot settle. Those are real
gates and they caught real defects. What they cannot do — what no schema can do
— is tell you whether a sentence is TRUE.

That distinction is the whole lesson of the audit. The entry that shipped

    "Europe's most successful basketball club has more continental titles than
     any NBA franchise has championships."

was `verified: true`, scored 5/5 for `source_confidence`, named two
publications, and passed every gate the pipeline had. It was false by seven
championships. Every gate was asking whether the entry was FILLED IN.

So truth is established by human audit — `docs/implementation/
NBA_FACT_BANK_AUDIT.md`, one entry at a time, against a named published source —
and this file is the RATCHET on that audit. It does not attempt to prove any
fact true. It proves that twenty-three specific claims already found false or
expired cannot come back, by any route: a revert, a rebased branch, a
well-meaning rewrite that restores the punchier original sentence, or a
generator that happens to emit the same words.

HOW TO ADD TO IT. When an audit retires a claim, add the row here with a
pattern that matches the FALSE assertion and not its corrected replacement. The
test below proves both halves: that no published fact matches the pattern, and
(in `test_every_retired_claim_pattern_is_still_discriminating`) that the pattern
is specific enough to have caught the original — a pattern that matches nothing
because it is malformed would otherwise pass forever while guarding nothing.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from nba_peak.nba_facts import cached_bank  # noqa: E402


class RetiredClaim:
    """One assertion the bank has retired, and the shape of its return."""

    def __init__(self, key: str, was_wrong: str, pattern: str, original: str):
        self.key = key
        #: What the audit found, in one line. Read by a human, not by code.
        self.was_wrong = was_wrong
        #: Matches the FALSE claim. Must not match the corrected entry.
        self.pattern = re.compile(pattern, re.IGNORECASE)
        #: A verbatim-enough fragment of the sentence as it was published.
        #: Only used to prove `pattern` would actually have fired.
        self.original = original


# Every row here is section 4.1 of NBA_FACT_BANK_AUDIT.md — the claims that were
# false or had silently stopped being true, as opposed to the ones that were
# merely overstated (4.2) or editorialising (4.3).
RETIRED: tuple[RetiredClaim, ...] = (
    RetiredClaim(
        "euroleague-titles",
        "Real Madrid's 11 European titles vs Boston's 18 NBA championships — "
        "false by seven. Panathinaikos are third, not second.",
        r"than any NBA franchise|continental titles than any",
        "Europe's most successful basketball club has more continental titles "
        "than any NBA franchise has championships.",
    ),
    RetiredClaim(
        "kobe-81",
        "81 stopped being the highest post-merger single-game total outside "
        "Wilt's 100 on 10 March 2026, when Bam Adebayo scored 83.",
        r"post-merger",
        "the highest single-game total of the post-merger era outside Wilt "
        "Chamberlain's 100",
    ),
    RetiredClaim(
        "russell-first-black-coach",
        "Fritz Pollard co-coached the Akron Pros in 1921, 45 years earlier.",
        r"Black head coach in American professional",
        "the first Black head coach in American professional sport",
    ),
    RetiredClaim(
        "russell-wilt-142",
        "Basketball-Reference — the entry's own cited source — gives 143 "
        "meetings and 86 Russell wins, not 142 and 85.",
        r"142 times|each other 142",
        "Bill Russell and Wilt Chamberlain played each other 142 times.",
    ),
    RetiredClaim(
        "haywood-supreme-court",
        "401 U.S. 1204 was an in-chambers order by Justice Douglas as circuit "
        "justice, not a merits ruling of the Court.",
        r"[Tt]he Supreme Court ruled",
        "The Supreme Court ruled that the NBA could not make players wait.",
    ),
    RetiredClaim(
        "nba-logo-jerry-west",
        "Went stale on 12 June 2024 when Adam Silver confirmed it.",
        r"never officially said who is in its logo|has never said who",
        "The NBA has never officially said who is in its logo.",
    ),
    RetiredClaim(
        "magic-bird-1979-final",
        "1979 drew ~35.1M; Game 6 of the 1998 NBA Finals drew 35.89M. The "
        "RATING claim survives, the audience claim does not.",
        r"most[- ]watched basketball game",
        "The most-watched basketball game ever played was a college final.",
    ),
    RetiredClaim(
        "germany-2023-world-cup",
        "Germany won EuroBasket 1993, so 'never won anything' is false.",
        r"never won anything",
        "a team that had never won anything before",
    ),
    RetiredClaim(
        "petrovic-third-round",
        "Third round, 60th overall — not second round. He was never an "
        "All-Star (All-NBA Third Team, 1992-93).",
        r"Petrovi[cć][^.]{0,60}second[- ]round|second[- ]round pick who became an All-Star",
        "Dražen Petrović was a second-round pick who became an All-Star.",
    ),
    RetiredClaim(
        "oscar-schmidt-never-nba",
        "LeBron James passed 49,737 on 2 April 2024, so the present-tense "
        "superlative expired.",
        r"most prolific scorer in basketball history",
        "The most prolific scorer in basketball history never played in the NBA.",
    ),
    RetiredClaim(
        "draft-lottery-1985",
        "From 1966 to 1984 the first pick was a coin flip between the worst "
        "team in each conference, not an award to the worst record.",
        r"worst record got the first pick|worst record earned the first",
        "Before 1985 the team with the worst record got the first pick.",
    ),
    RetiredClaim(
        "olympics-1936-mud",
        "Olympic 3x3 was outdoors at Tokyo 2020 and Paris 2024. Bounded to "
        "five-on-five.",
        r"No Olympic basketball game has been played outdoors",
        "No Olympic basketball game has been played outdoors since.",
    ),
    RetiredClaim(
        "wnba-first-game",
        "The Lakers played at the Forum until May 1999, two years after the "
        "WNBA opener.",
        r"the Lakers had just left",
        "in a building the Lakers had just left",
    ),
    RetiredClaim(
        "swoopes-first-signing",
        "The two intervals were swapped: her son was born four days AFTER the "
        "opener; she returned six weeks later.",
        r"six weeks before the|born six weeks",
        "gave birth six weeks before the league's first game",
    ),
    RetiredClaim(
        "taurasi-record",
        "Tina Charles passed her career field-goals record on 4 September "
        "2025, and the scoring margin has eroded to ~2,250.",
        r"2,500 points clear",
        "and is 2,500 points clear of anyone else",
    ),
    RetiredClaim(
        "wnba-attendance-2024",
        "20,711 was superseded on 10 July 2026 (20,966). The 'largest jump in "
        "its history' clause is asserted by no source.",
        r"largest attendance jump",
        "the largest attendance jump in its history",
    ),
    RetiredClaim(
        "yao-shanghai",
        "Yao played eight seasons, not nine, and his CBA chairmanship ran "
        "seven years eight months — so 'longer than' was false either way.",
        r"longer than he played in the NBA|[Nn]ine seasons in Houston",
        "Yao Ming ran Chinese basketball for longer than he played in the NBA.",
    ),
    RetiredClaim(
        "jokic-41",
        "Jokić went 38 places after the first centre, not forty, and he had "
        "played the 2014 Nike Hoop Summit in Portland.",
        r"never played outside Serbia",
        "he had never played outside Serbia",
    ),
    RetiredClaim(
        "lakers-33",
        "The streak's 33rd win was 7 January 1972 at Atlanta; 9 January was "
        "the defeat at Milwaukee.",
        # NOT the bare date. 9 January 1972 is a real and correct date for this
        # story — it is the night Milwaukee ENDED the run — and two published
        # facts say so truthfully. What was false was placing the streak's last
        # WIN there, so the pattern has to match the preposition that does the
        # claiming ("ran until", "from 5 November TO 9 January") and not a fact
        # that says Kareem's Bucks won ON it. The first draft of this row
        # matched the date alone and failed against two correct entries, which
        # is the register working as intended rather than a bank defect.
        r"(?:until|to) 9 January",
        "the streak ran until 9 January 1972",
    ),
    RetiredClaim(
        "hand-check-2004",
        "Basketball-Reference gives 93.4 ppg for 2003-04, so the jump is "
        "+3.8, not +3.5.",
        r"93\.7 points|by 3\.5 points|\+3\.5",
        "scoring rose by 3.5 points a game",
    ),
    RetiredClaim(
        "nba-jam-1993",
        "Topps held an NBA card licence from 1969 and Lakers versus Celtics "
        "(1989) was the first NBA-endorsed game.",
        r"first mass-market NBA product",
        "the first mass-market NBA product that was not a broadcast",
    ),
    RetiredClaim(
        "chuck-taylor",
        "'108 years later' drifts annually with no expiry; 'the first "
        "basketball shoe' is not claimed by Converse's own cited history.",
        r"108 years later|the first basketball shoe",
        "the first basketball shoe, 108 years later",
    ),
    RetiredClaim(
        "valkyries-inaugural",
        "The 1998 Detroit Shock went 17-13 in their first season, so the "
        "winning-record half of 'either' is false.",
        r"expansion (side|team) to do either|to do either",
        "the first WNBA expansion side to do either",
    ),
)


def _published_text() -> list[tuple[str, str]]:
    """(fact_id, headline + body) for everything the bank would serve."""
    return [(f.fact_id, f"{f.headline} {f.body}") for f in cached_bank()]


def test_the_audit_and_this_register_cover_the_same_claims():
    """The register cannot silently fall behind the audit document.

    A row deleted here would remove a guard and break no test; this ties the
    count to the audit's own section 4.1 so the two move together.
    """
    audit = (
        Path(__file__).resolve().parent.parent
        / "docs"
        / "implementation"
        / "NBA_FACT_BANK_AUDIT.md"
    ).read_text()
    section = audit.split("### 4.1 The claim was false")[1].split("### 4.2")[0]
    documented = set(re.findall(r"^\| `([^`]+)` \|", section, re.M))
    registered = {claim.key for claim in RETIRED}
    assert documented == registered, (
        "The retired-claim register and NBA_FACT_BANK_AUDIT.md §4.1 disagree.\n"
        f"  documented but not registered: {sorted(documented - registered)}\n"
        f"  registered but not documented: {sorted(registered - documented)}"
    )


@pytest.mark.parametrize("claim", RETIRED, ids=lambda c: c.key)
def test_a_retired_claim_is_absent_from_every_published_fact(claim: RetiredClaim):
    """No fact the bank can serve today repeats a retired assertion.

    Scanned across the WHOLE bank rather than only the entry it came from: the
    point is that the sentence cannot return, and it does not become true again
    by being attached to a different key.
    """
    offenders = [
        fact_id for fact_id, text in _published_text() if claim.pattern.search(text)
    ]
    assert not offenders, (
        f"{claim.key}: a retired claim is publishable again.\n"
        f"  What the audit found: {claim.was_wrong}\n"
        f"  Matched in: {offenders}\n"
        f"  Pattern: {claim.pattern.pattern}"
    )


@pytest.mark.parametrize("claim", RETIRED, ids=lambda c: c.key)
def test_every_retired_claim_pattern_is_still_discriminating(claim: RetiredClaim):
    """The pattern would have caught the sentence it was written for.

    WITHOUT THIS, THE FILE ABOVE ROTS INTO DECORATION. A pattern with a typo, a
    stray escape or a regex that compiles and matches nothing passes
    `test_a_retired_claim_is_absent...` forever while guarding nothing at all —
    and it looks exactly like a working guard in the diff. Matching each
    pattern against the original wording is what makes a green run mean
    something.
    """
    assert claim.pattern.search(claim.original), (
        f"{claim.key}: the pattern does not match the sentence it retired, so "
        f"it is guarding nothing.\n  Pattern: {claim.pattern.pattern}\n"
        f"  Original: {claim.original}"
    )


def test_the_real_madrid_comparison_specifically_cannot_publish():
    """The claim that started the audit, asserted on its own terms.

    Named separately from the parametrised sweep because it is the one the
    brief calls out, and because the failure mode worth blocking is not only
    the exact old sentence: it is ANY entry that compares a European club's
    continental titles favourably against NBA championships. Real Madrid have
    eleven; the Celtics have eighteen.
    """
    forbidden = re.compile(
        r"(continental|European)[^.]{0,60}titles?[^.]{0,60}than any[^.]{0,40}NBA"
        r"|than any NBA franchise",
        re.IGNORECASE,
    )
    offenders = [fid for fid, text in _published_text() if forbidden.search(text)]
    assert not offenders, f"the Real Madrid comparison is publishable again: {offenders}"

    # And the corrected entry is still there, still bounded to its own
    # competition — the claim was fixed, not quietly dropped.
    euro = [t for _, t in _published_text() if "Real Madrid" in t]
    assert euro, "the corrected EuroLeague fact is missing from the bank entirely"
    assert any(
        "European club championship eleven times" in t for t in euro
    ), "the corrected EuroLeague claim is no longer what the bank publishes"
