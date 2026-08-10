"""What an editorial entry has to survive before it is allowed to be a fact.

WHY THIS IS A SEPARATE GATE FROM THE ONE IN `editorial.py`
=========================================================
`editorial._build` already refuses an entry with no `source_detail`, no
`verified` flag, an unknown category, or a claim about the present with no
expiry. Those checks answer "is this entry FILLED IN". They cannot answer "is
this entry a CHECKED CLAIM", and the difference is the whole of this module.

An audit of the committed bank found three failures that every existing gate
waved through, because each one was a perfectly well-formed entry:

  * A comparative claim that was simply false. "Europe's most successful
    basketball club has more continental titles than any NBA franchise has
    championships" — Real Madrid have eleven European crowns and the Boston
    Celtics have eighteen NBA championships. It was `verified: true` and it
    named two publications, neither of which said that.
  * A claim that is marketing legend rather than record. "The NBA fined Michael
    Jordan for his shoes" is repeated everywhere and documented nowhere; the
    shoe the league actually wrote to Nike about was the Air Ship, and David
    Stern said afterwards that nothing was banned.
  * Decoration that reads as a claim. "The most famous floor in basketball",
    "the most impressive run", "arguably the finest" — sentences a reader
    cannot check, sitting in a panel whose entire promise is that everything on
    it was checked.

None of the three is fixable by a stricter `source_detail` string, because
`source_detail` is prose and prose cannot be dereferenced. So an entry now
carries three machine-checkable fields on top of the prose:

    source_url   an absolute http(s) URL to a named published source. A
                 reviewer can OPEN it. "Checked against a named published
                 source" is a sentence; a URL is an address.
    checked_on   the ISO date a person last held the claim against that URL.
                 Sourcing decays: a live-looking citation from 2019 attached to
                 a "still the record" claim is worse than no citation, because
                 it looks like diligence.
    claim_type   what KIND of assertion the entry makes, from a closed
                 vocabulary. This is what makes the superlative rule
                 enforceable: a superlative is either the claim being made — in
                 which case the entry is a `record` and somebody checked the
                 bound — or it is decoration, and decoration in a trivia panel
                 is the failure mode above.

WHY BANNED PHRASES RATHER THAN A SCORE
======================================
`featured.SUBJECTIVE_CLAIMS` already screens opinion vocabulary, and it is not
enough on its own for two reasons. It runs over the WHOLE bank at the point
where the homepage tier is selected, so its verdict is DEMOTION: a fact that
trips it stays published and simply stops being featured. And it runs after the
build, so an entry can sit in the committed file for months reading as checked.
The rules here run inside `load_editorial`, and their verdict is that the build
stops. A curated bank whose sourcing rule is advisory has no sourcing rule.

The lists below are deliberate rather than exhaustive, and every entry carries
the reason it is there. Two things they are NOT:

  * a style guide. "Vivid" is fine; the bank is meant to be read. What is
    banned is language that makes an UNCHECKABLE claim, or that hedges a claim
    the author could not stand behind.
  * a grep for bad words. Matching is word-boundary-aware precisely so that
    `record` does not fire on "recorded", `never` does not fire on
    "nevertheless", and `the first ever` still fires on "the first-ever".

WHY THE CLOCK IS NOT CONSULTED
==============================
`checked_on` is validated for SHAPE — a real calendar date in ISO form — and
never compared against today. `scripts/build_nba_facts.py` promises a build that
is "offline, deterministic, and no model is called", and a gate that fails on
Tuesday and passes on Monday would make the bank a function of when it was
built. Staleness is a review question, and the audit at
`docs/implementation/NBA_FACT_BANK_AUDIT.md` is where it is answered.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Iterable, Optional
from urllib.parse import urlparse


class FactValidationError(ValueError):
    """An entry that must not be published, and exactly what to do about it.

    Raised out of `validate_entry` and translated into
    `editorial.EditorialFactError` at the call site, so every existing caller —
    `scripts/build_nba_facts.py` included — keeps catching one exception type
    for "the curated file is not publishable".
    """


# ---------------------------------------------------------------------------
# The claim vocabulary
# ---------------------------------------------------------------------------

#: WHAT KIND OF ASSERTION THE ENTRY MAKES. Five values, closed, and small on
#: purpose: a vocabulary a curator has to think about is a vocabulary that gets
#: used, and a vocabulary of twenty is a dropdown nobody reads.
#:
#: The value describes the STRONGEST claim in the entry rather than its subject
#: matter. "Basketball invented the shot clock because one game finished 19-18"
#: is a fact about a rule, and the sentence after it says the game is "still the
#: lowest-scoring in league history" — that is a record, somebody had to check
#: the bound, and so the entry is a `record`. Filing it under `rule` because
#: rules are what it is about would put an unchecked superlative on a homepage,
#: which is the exact thing this field exists to stop.
CLAIM_TYPES: dict[str, str] = {
    "event": (
        "something that happened, on a date, to named people. Checkable "
        "against a box score, a report or a league record."
    ),
    "record": (
        "a superlative or a threshold — a first, a most, an only, a longest. "
        "THE ONLY CLAIM TYPE ALLOWED TO USE SUPERLATIVE LANGUAGE, because it "
        "is the only one whose bound somebody had to establish."
    ),
    "rule": (
        "a rule, a policy, a court dimension or a piece of league governance, "
        "and what it changed."
    ),
    "attribution": (
        "who did, said, decided or built a thing — provenance rather than "
        "outcome. The logo, the name, the shoe, the arithmetic behind 24 "
        "seconds."
    ),
    "context": (
        "background a reader needs and cannot infer: how a league is "
        "structured, what a country does with the game, why a franchise is "
        "named after a lake."
    ),
}

#: The one claim type permitted to carry superlative language.
SUPERLATIVE_CLAIM_TYPE = "record"


# ---------------------------------------------------------------------------
# Phrase matching
# ---------------------------------------------------------------------------

#: WHAT COUNTS AS A GAP BETWEEN THE WORDS OF A BANNED PHRASE. Whitespace, a
#: non-breaking space, or any of the dashes a copy editor might reach for. This
#: is why "the first ever" also catches "the first-ever" and "the first—ever":
#: a rule a hyphen defeats is a rule that teaches curators to type hyphens.
_GAP = r"[\s\u00a0\u2010-\u2015-]+"

#: THE LEFT EDGE. A letter or digit immediately before the phrase means we are
#: inside a longer word, and this is not a match.
_LEFT = r"(?<![A-Za-z0-9])"

#: THE RIGHT EDGE, with the two English inflections that are still the same
#: claim: a superlative `-est` ("best" → "bestest") and a plural `-s` ("no
#: other" → "no others").
#:
#: DELIBERATELY NOT `\w*`, and the suffix set is two items rather than a
#: generous handful because each extra one buys a false positive. `-ly` was in
#: an earlier draft and had to come out: it made `the most` match "the mostly
#: white shoe", which is the NBA's own uniform rule and appears in this bank. As
#: it stands, `never` cannot reach "nevertheless", `the most` cannot reach "the
#: mostly", and a stem like `record` could not reach "recorded" — which is the
#: failure mode a naive substring search has, and the reason this is a regex at
#: all.
_RIGHT = r"(?:est|s)?(?![A-Za-z0-9])"


@dataclass(frozen=True)
class BannedPhrase:
    """One phrase, why it is banned, and what a curator should do instead."""

    phrase: str
    why: str
    remedy: str

    @property
    def pattern(self) -> re.Pattern[str]:
        words = _GAP.join(re.escape(word) for word in self.phrase.split())
        return re.compile(_LEFT + words + _RIGHT, re.IGNORECASE)


def _compile(phrases: Iterable[BannedPhrase]) -> tuple[tuple[re.Pattern[str], BannedPhrase], ...]:
    return tuple((entry.pattern, entry) for entry in phrases)


# ---------------------------------------------------------------------------
# Family 1 — opinion presented as fact. Banned in every claim type.
# ---------------------------------------------------------------------------
#
# THE TEST FOR THIS LIST: could two well-informed readers disagree about the
# sentence without either of them being wrong about anything? If yes, it is not
# a fact, and a panel headed "NBA Fact of the Day" must not carry it. Every
# phrase below is a way of asserting a ranking, a reputation or an emotional
# response that no source can settle.

SUBJECTIVE_PHRASES: tuple[BannedPhrase, ...] = (
    BannedPhrase(
        "greatest",
        "ranks by a standard the entry does not state and no source settles",
        "name the record instead — 'won it eleven times' is checkable, "
        "'the greatest' is not",
    ),
    BannedPhrase(
        "best ever",
        "the same ranking claim wearing a different hat",
        "state the measure and the number",
    ),
    BannedPhrase(
        "best known",
        "a claim about what other people know, with no way to check it",
        "say what it actually did — sales, circulation, a survey with a source",
    ),
    BannedPhrase(
        "most famous",
        "reputation, not record. Fame has no unit and no source can bound it",
        "replace with the thing that made it famous, stated plainly",
    ),
    BannedPhrase(
        "most beautiful",
        "an aesthetic judgement",
        "delete, or attribute it to a named person who said it",
    ),
    BannedPhrase(
        "most impressive",
        "an aesthetic judgement dressed as a comparison",
        "give the comparison a unit",
    ),
    BannedPhrase(
        "most quoted",
        "asserts a frequency nobody counted",
        "give the number itself and let the reader judge",
    ),
    BannedPhrase(
        "arguably",
        "concedes the claim is arguable and makes it anyway",
        "make the claim or drop it",
    ),
    BannedPhrase(
        "undoubtedly",
        "asserts that no one doubts it, which is itself unsourced",
        "drop the adverb; if the claim stands it does not need it",
    ),
    BannedPhrase(
        "unquestionably",
        "as above — emphasis substituting for evidence",
        "drop the adverb",
    ),
    BannedPhrase(
        "iconic",
        "a reputation claim that carries no information",
        "say what happened",
    ),
    BannedPhrase(
        "legendary",
        "worse than 'iconic' here: in this bank several entries exist "
        "precisely because a legend turned out not to be true",
        "say what is documented",
    ),
    BannedPhrase(
        "incredible",
        "an emotional response, and literally a claim the thing is not credible",
        "give the number",
    ),
    BannedPhrase(
        "amazing",
        "an emotional response",
        "give the number",
    ),
    BannedPhrase(
        "insane",
        "an emotional response, in the register of a highlight caption",
        "give the number",
    ),
    BannedPhrase(
        "ridiculous",
        "an emotional response",
        "give the number",
    ),
    BannedPhrase(
        "unbelievable",
        "an emotional response",
        "give the number",
    ),
    BannedPhrase(
        "perhaps the",
        "hedges a superlative rather than checking it",
        "check the bound and state it, or cut the comparison",
    ),
    BannedPhrase(
        "some say",
        "attributes the claim to nobody",
        "name who said it, or drop it",
    ),
    BannedPhrase(
        "many believe",
        "attributes the claim to nobody",
        "name who said it, or drop it",
    ),
    BannedPhrase(
        "widely considered",
        "cites a consensus with no source",
        "cite the source that establishes the consensus, or drop the claim",
    ),
    BannedPhrase(
        "widely regarded",
        "cites a consensus with no source",
        "cite the source, or drop the claim",
    ),
    BannedPhrase(
        "overrated",
        "an opinion about other people's opinions",
        "drop it",
    ),
    BannedPhrase(
        "underrated",
        "an opinion about other people's opinions",
        "drop it",
    ),
    BannedPhrase(
        "should have won",
        "second-guesses a result the bank is supposed to report",
        "report the result",
    ),
    BannedPhrase(
        "snubbed",
        "second-guesses a vote",
        "report the vote",
    ),
)


# ---------------------------------------------------------------------------
# Family 2 — superlatives. Banned UNLESS the entry is a `record`.
# ---------------------------------------------------------------------------
#
# THE POINT IS NOT TO REMOVE SUPERLATIVES. Half of what makes a fact worth
# reading is that it is the most, the first or the only one. The point is that a
# superlative is a CLAIM WITH A BOUND — "the only Latin American team to win
# Olympic gold" is a statement about every other Latin American team that ever
# entered — and a bound is exactly the thing that quietly goes wrong. The false
# EuroLeague entry was a superlative comparison across two competitions nobody
# had actually compared.
#
# So: if the entry says "the only", the entry is a `record`, and `record` is the
# claim type whose reviewer is on notice that a bound had to be established. If
# the superlative is decoration on a fact that is really about a rule or an
# event, the remedy is to cut the decoration.

SUPERLATIVE_PHRASES: tuple[BannedPhrase, ...] = (
    BannedPhrase(
        "the only",
        "asserts that every other case was checked",
        "mark the entry `record` and name the source that establishes the "
        "bound, or cut the exclusivity",
    ),
    BannedPhrase(
        "only one",
        "the same exclusivity claim in the other word order",
        "mark the entry `record`, or cut the exclusivity",
    ),
    BannedPhrase(
        "first ever",
        "a priority claim over the whole history of the thing",
        "mark the entry `record`, or say 'the first in the NBA', which is a "
        "bound a source can carry",
    ),
    BannedPhrase(
        "more than any",
        "a comparison against a population the entry does not name",
        "mark the entry `record` and name the population",
    ),
    BannedPhrase(
        "never",
        "a claim about everything that did not happen",
        "mark the entry `record`, or bound it — 'has not since 1946' is "
        "checkable in a way 'never' is not",
    ),
    BannedPhrase(
        "always",
        "a claim about every case, including the ones nobody looked at",
        "mark the entry `record`, or bound it",
    ),
    BannedPhrase(
        "no one else",
        "an exclusivity claim",
        "mark the entry `record`, or cut it",
    ),
    BannedPhrase(
        "nobody else",
        "an exclusivity claim",
        "mark the entry `record`, or cut it",
    ),
    BannedPhrase(
        "no other",
        "an exclusivity claim",
        "mark the entry `record`, or cut it",
    ),
    BannedPhrase(
        "still the",
        "a superlative PLUS a claim about the present, which is the pairing "
        "that goes stale without anyone noticing",
        "mark the entry `record`, and give it a `valid_until` if the standing "
        "can change",
    ),
    BannedPhrase(
        "the most",
        "an unbounded superlative",
        "mark the entry `record`, or replace with the measurement",
    ),
    BannedPhrase(
        "the largest",
        "an unbounded superlative",
        "mark the entry `record`, or replace with the measurement",
    ),
    BannedPhrase(
        "the longest",
        "an unbounded superlative",
        "mark the entry `record`, or replace with the measurement",
    ),
    BannedPhrase(
        "the highest",
        "an unbounded superlative",
        "mark the entry `record`, or replace with the measurement",
    ),
    BannedPhrase(
        "the youngest",
        "an unbounded superlative",
        "mark the entry `record`, or replace with the measurement",
    ),
    BannedPhrase(
        "the biggest",
        "an unbounded superlative",
        "mark the entry `record`, or replace with the measurement",
    ),
    BannedPhrase(
        "the fewest",
        "an unbounded superlative",
        "mark the entry `record`, or replace with the measurement",
    ),
    BannedPhrase(
        "the shortest",
        "an unbounded superlative",
        "mark the entry `record`, or replace with the measurement",
    ),
    BannedPhrase(
        "the tallest",
        "an unbounded superlative",
        "mark the entry `record`, or replace with the measurement",
    ),
    BannedPhrase(
        "of all time",
        "the widest bound there is",
        "mark the entry `record`, or name the era",
    ),
)


# ---------------------------------------------------------------------------
# Family 3 — hedges. Banned in every claim type.
# ---------------------------------------------------------------------------
#
# EVERY ONE OF THESE IS THE AUTHOR TELLING YOU THEY DID NOT CHECK. That is
# useful information and it belongs in a review thread, not in a published
# fact. The bank has exactly two states — checked, or not in the bank — so a
# sentence that hedges its own claim has already answered the question of
# whether it should ship. Note that the FIX is never to delete the hedge and
# keep the sentence: an unhedged unchecked claim is strictly worse.

HEDGE_PHRASES: tuple[BannedPhrase, ...] = (
    BannedPhrase(
        "reportedly",
        "the author has a report and did not check it",
        "check it and cite the report by name, or drop the entry",
    ),
    BannedPhrase(
        "supposedly",
        "signals the author expects the claim to be wrong",
        "drop the entry",
    ),
    BannedPhrase(
        "it is said",
        "attributes the claim to nobody at all",
        "name who said it, or drop the entry",
    ),
    BannedPhrase(
        "rumored",
        "a rumour is the opposite of a sourced fact",
        "drop the entry",
    ),
    BannedPhrase(
        "rumoured",
        "as above, in the other spelling",
        "drop the entry",
    ),
    BannedPhrase(
        "allegedly",
        "a legal hedge, which in a trivia panel means unverified",
        "check it, or drop the entry",
    ),
    BannedPhrase(
        "some sources",
        "concedes that sources disagree without saying which won",
        "say which source the entry follows and why, in `source_detail`",
    ),
    BannedPhrase(
        "believed to be",
        "attributes a belief to nobody",
        "name who believes it, or drop the claim",
    ),
    BannedPhrase(
        "purportedly",
        "a hedge",
        "check it, or drop the entry",
    ),
    BannedPhrase(
        "apparently",
        "a hedge",
        "check it, or drop the entry",
    ),
)


# ---------------------------------------------------------------------------
# Family 4 — PEAK3 model voice. Banned in every claim type.
# ---------------------------------------------------------------------------
#
# THIS PANEL IS NOT A MODEL OUTPUT AND MUST NEVER READ AS ONE. The component
# that renders it says so in its own docstring:
#
#     "GENERAL BASKETBALL TRIVIA, AND NOT A PEAK3 CLAIM. The heading says 'NBA
#      Fact of the Day' and never 'PEAK3 Fact of the Day', and no fact's text
#      depends on the model's weights, calibration or component scores."
#     — apps/web/src/components/home/NbaFactOfTheDay.tsx
#
# The panel sits above the game catalogue, so most people who read it have not
# been told what PEAK3 is. A line they cannot evaluate is a line they skip — and
# worse, a model claim smuggled into a trivia card is the one place on the site
# where "PEAK3 rates..." would read as historical truth rather than as a rating.
# CLAUDE.md states the naming rule the other way round for the same reason: game
# scoring is `arena_points` and never `peak_score`.

MODEL_VOICE_PHRASES: tuple[BannedPhrase, ...] = (
    BannedPhrase(
        "peak3",
        "this card is general basketball trivia; naming the model turns a fact "
        "into a rating",
        "state the fact without the model. If the point is a PEAK3 result, it "
        "belongs on a rankings or profile surface, not here",
    ),
    BannedPhrase(
        "peak score",
        "a model output, and not even the right name for one",
        # DELIBERATELY DOES NOT SPELL THE COLUMN NAMES. The identifiers this
        # repository computes are banned from every module under
        # `nba_peak/nba_facts/` by
        # `test_no_fact_depends_on_a_judgment_this_repository_computes`, and
        # that guard reads ordinary string literals as well as code — correctly,
        # since the bug it exists for was a literal. Naming the columns in a
        # remediation hint would trip it, so the hint describes them instead.
        "remove; game scoring and the calibrated display value are both model "
        "outputs, and neither belongs in a trivia fact",
    ),
    BannedPhrase(
        "prime score",
        "a model output",
        "remove",
    ),
    BannedPhrase(
        "prime index",
        "a model output",
        "remove",
    ),
    BannedPhrase(
        "arena points",
        "a game-scoring term",
        "remove",
    ),
    BannedPhrase(
        "the model says",
        "attributes the fact to the model",
        "remove",
    ),
    BannedPhrase(
        "the model gives",
        "attributes the fact to the model",
        "remove",
    ),
    BannedPhrase(
        "the model rates",
        "attributes the fact to the model",
        "remove",
    ),
    BannedPhrase(
        "peak window",
        "a PEAK3 term of art",
        "remove, or say 'his best seasons' if the sentence needs it at all",
    ),
)


_SUBJECTIVE = _compile(SUBJECTIVE_PHRASES)
_SUPERLATIVE = _compile(SUPERLATIVE_PHRASES)
_HEDGE = _compile(HEDGE_PHRASES)
_MODEL_VOICE = _compile(MODEL_VOICE_PHRASES)


# ---------------------------------------------------------------------------
# Field checks
# ---------------------------------------------------------------------------

_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

#: Hosts that mean "somebody left the template in". A URL that parses is not a
#: citation, and these are the ways a non-citation still parses.
_PLACEHOLDER_HOSTS = frozenset(
    {"example.com", "www.example.com", "example.org", "localhost", "test.com"}
)


def _fail(source: Path, key: str, message: str) -> None:
    """Every failure names the file, the entry and the fix, in that order.

    The existing gate in `editorial.py` reads `"{source.name}: entry {key!r}
    ..."`, and a second gate that formatted its failures differently would make
    the build's output look like two tools arguing. It is one file's worth of
    problems.
    """
    raise FactValidationError(f"{source.name}: entry {key!r} {message}")


def _require_source_url(entry: dict, key: str, source: Path) -> str:
    """A URL a reviewer can open, rather than a sentence about a source.

    `source_detail` was always required and it is prose: "NBA.com and Naismith
    Basketball Hall of Fame accounts of the 24-second clock's adoption" names
    two institutions and points at nothing. Checking it means running the search
    again. This field is the address.
    """
    raw = str(entry.get("source_url") or "").strip()
    if not raw:
        _fail(
            source,
            key,
            "has no `source_url`. Every published fact needs an address a "
            "reviewer can open, not only a `source_detail` sentence naming a "
            "publication. Add an absolute http(s) URL to the specific page the "
            "claim was checked against.",
        )
    if any(char.isspace() for char in raw):
        _fail(
            source,
            key,
            f"has a `source_url` containing whitespace ({raw!r}). It is one "
            "URL, not a list — put any secondary citations in `source_detail`.",
        )
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        _fail(
            source,
            key,
            f"has a `source_url` with scheme {parsed.scheme or '<none>'!r} "
            f"({raw!r}). It must be an absolute http or https URL; a file "
            "path, a bare domain or a citation string cannot be dereferenced.",
        )
    if not parsed.netloc or "." not in parsed.netloc:
        _fail(
            source,
            key,
            f"has a `source_url` with no resolvable host ({raw!r}). Give the "
            "full URL of the page, including the domain.",
        )
    if parsed.netloc.lower() in _PLACEHOLDER_HOSTS:
        _fail(
            source,
            key,
            f"has a placeholder `source_url` ({raw!r}). This is the template, "
            "not a citation — replace it with the page the claim was actually "
            "checked against.",
        )
    return raw


def _require_checked_on(entry: dict, key: str, source: Path) -> str:
    """The day a person held this claim against that URL.

    SHAPE ONLY, AND NEVER COMPARED TO TODAY. See the module docstring: the build
    is deterministic and offline, and a gate that fails as the calendar moves
    would make the bank a function of when it was built rather than of what is
    committed. Whether a 2023 check is still good enough for a 2026 claim is a
    review question, answered in the audit document.
    """
    raw = str(entry.get("checked_on") or "").strip()
    if not raw:
        _fail(
            source,
            key,
            "has no `checked_on`. A citation with no date is a citation that "
            "cannot go stale, which is the problem rather than the solution. "
            "Record the ISO date (YYYY-MM-DD) somebody last held this claim "
            "against its `source_url`.",
        )
    if not _ISO_DATE.match(raw):
        _fail(
            source,
            key,
            f"has a `checked_on` of {raw!r}, which is not an ISO date. Use "
            "YYYY-MM-DD — the same format as `valid_until`, so the two sort "
            "against each other.",
        )
    try:
        parsed = date.fromisoformat(raw)
    except ValueError:
        _fail(
            source,
            key,
            f"has a `checked_on` of {raw!r}, which is ISO-shaped but not a "
            "real calendar date.",
        )
        raise  # unreachable; `_fail` always raises. Kept for the type checker.
    if parsed.year < 2000:
        _fail(
            source,
            key,
            f"has a `checked_on` of {raw!r}. That is a typo rather than a "
            "review date — nothing in this bank was checked before 2000.",
        )
    return raw


def _require_claim_type(entry: dict, key: str, source: Path) -> str:
    raw = str(entry.get("claim_type") or "").strip()
    if not raw:
        _fail(
            source,
            key,
            "has no `claim_type`. Declare what kind of assertion it makes so "
            "the superlative rule can be applied to it. Known types: "
            + ", ".join(f"`{name}`" for name in CLAIM_TYPES),
        )
    if raw not in CLAIM_TYPES:
        _fail(
            source,
            key,
            f"has unknown `claim_type` {raw!r}. Known types: "
            + "; ".join(f"`{name}` — {why}" for name, why in CLAIM_TYPES.items()),
        )
    return raw


def _reject_phrases(
    text: str,
    compiled: tuple[tuple[re.Pattern[str], BannedPhrase], ...],
    family: str,
    key: str,
    source: Path,
) -> None:
    for pattern, banned in compiled:
        found = pattern.search(text)
        if found is None:
            continue
        _fail(
            source,
            key,
            f"uses the {family} phrase {found.group(0)!r} (banned as "
            f"`{banned.phrase}`). It {banned.why}. Fix: {banned.remedy}.",
        )


def validate_entry(entry: dict, source: Path) -> None:
    """Refuse the entry, loudly, or return.

    Called from `editorial._build` once the cheap structural checks have passed,
    so a completely malformed entry still reports "has no category" rather than
    a banned-phrase complaint about a sentence that was never going to ship.
    """
    key = str(entry.get("key") or "<no key>").strip() or "<no key>"

    _require_source_url(entry, key, source)
    _require_checked_on(entry, key, source)
    claim_type = _require_claim_type(entry, key, source)

    # HEADLINE AND BODY TOGETHER, as one string. The card renders them as one
    # fact and a reader takes them as one claim, so a superlative parked in the
    # body is exactly as unchecked as one in the headline. The join is a space
    # so a phrase cannot be smuggled across the boundary by accident.
    text = f"{entry.get('headline') or ''} {entry.get('body') or ''}"

    _reject_phrases(text, _SUBJECTIVE, "subjective", key, source)
    _reject_phrases(text, _HEDGE, "hedging", key, source)
    _reject_phrases(text, _MODEL_VOICE, "model-voice", key, source)

    if claim_type != SUPERLATIVE_CLAIM_TYPE:
        _reject_phrases(
            text,
            _SUPERLATIVE,
            f"superlative (only permitted in `claim_type: "
            f"{SUPERLATIVE_CLAIM_TYPE}`, this entry is `{claim_type}`)",
            key,
            source,
        )


def banned_phrases() -> tuple[BannedPhrase, ...]:
    """Every banned phrase, for tests and for documentation."""
    return (
        *SUBJECTIVE_PHRASES,
        *SUPERLATIVE_PHRASES,
        *HEDGE_PHRASES,
        *MODEL_VOICE_PHRASES,
    )


def matched_phrase(text: str, phrase: BannedPhrase) -> Optional[str]:
    """The literal text a banned phrase matched, or None. Exposed for tests."""
    found = phrase.pattern.search(text)
    return found.group(0) if found else None


__all__ = [
    "BannedPhrase",
    "CLAIM_TYPES",
    "FactValidationError",
    "HEDGE_PHRASES",
    "MODEL_VOICE_PHRASES",
    "SUBJECTIVE_PHRASES",
    "SUPERLATIVE_CLAIM_TYPE",
    "SUPERLATIVE_PHRASES",
    "banned_phrases",
    "matched_phrase",
    "validate_entry",
]
