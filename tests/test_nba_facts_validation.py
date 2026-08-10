"""The claim gate: required citation metadata, and the language it refuses.

WHY THIS SUITE EXISTS SEPARATELY FROM `test_nba_facts.py`
========================================================
That suite tests the bank as a data structure — determinism, evidence rows,
category vocabulary, rotation. Every one of its assertions passed on a bank
containing this sentence:

    "Europe's most successful basketball club has more continental titles than
     any NBA franchise has championships."

Real Madrid have eleven European crowns; the Boston Celtics have eighteen NBA
championships. The entry was `verified: true`, named two publications, scored
5/5 for `source_confidence`, and was false. Nothing in the pipeline could have
noticed, because nothing in the pipeline was reading the CLAIM.

So the tests here are about the claim rather than the record: does an entry
carry an address a reviewer can open, does it say what kind of assertion it is
making, and does its prose stay inside what a source can settle. The last two
tests are the ones that matter in six months — one runs the whole validator over
the committed bank, and one asserts that the specific false comparison above is
not in it, keyed on the CLAIM rather than on the entry key, so a reworded
re-addition is caught too.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from nba_peak.nba_facts.editorial import EDITORIAL_PATH, EditorialFactError, load_editorial
from nba_peak.nba_facts.validation import (
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

SOURCE = Path("editorial_facts.json")


def _entry(**overrides) -> dict:
    """A synthetic entry that passes everything, before overrides.

    Written out in full rather than loaded from the committed file on purpose:
    a fixture that reads the real bank would start failing for reasons that have
    nothing to do with the rule under test, and the point of these cases is to
    isolate one rule at a time.
    """
    base = {
        "key": "synthetic-entry",
        "headline": "Boston built its court from red oak offcuts in 1946.",
        "body": (
            "Timber was short after the war, so the Celtics bolted 247 panels "
            "together and played on them until 1999."
        ),
        "category": "nba_history",
        "era": "1940s",
        "geography": "usa",
        "source_label": "Editorial — checked against a named published source",
        "source_detail": "NBC Sports Boston on the Boston Garden parquet floor",
        "source_url": "https://www.nbcsportsboston.com/nba/boston-celtics/parquet",
        "checked_on": "2026-08-07",
        "claim_type": "event",
        "verified": True,
        "valid_until": None,
        "quality": {
            "surprise": 4,
            "significance": 3,
            "clarity": 5,
            "broad_interest": 5,
            "novelty": 4,
            "source_confidence": 5,
            "homepage_suitability": 5,
        },
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# The baseline: a clean entry is not rejected
# ---------------------------------------------------------------------------


def test_a_clean_entry_passes():
    """The gate has to have an inside.

    A rule set that rejects everything is indistinguishable from a rule set that
    is broken, and every other test in this file is worthless without this one:
    they all assert that a MUTATION of this entry fails.
    """
    validate_entry(_entry(), SOURCE)


@pytest.mark.parametrize("claim_type", sorted(CLAIM_TYPES))
def test_every_claim_type_in_the_vocabulary_is_accepted(claim_type):
    validate_entry(_entry(claim_type=claim_type), SOURCE)


# ---------------------------------------------------------------------------
# Required metadata
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "   ",
        # A citation string is not an address. This is exactly what
        # `source_detail` already holds, and the whole reason the URL field was
        # added is that prose cannot be dereferenced.
        "NBA.com, 'This Week in History'",
        # A scheme nobody can open from a review tab.
        "ftp://nba.com/history",
        "file:///Users/someone/notes.txt",
        # A bare domain: no scheme, so `urlparse` puts it in `path` and there is
        # nothing to fetch.
        "nba.com/history",
        # Two URLs in one field. `source_detail` is where secondary citations go.
        "https://nba.com/a https://nba.com/b",
        # The template, left in.
        "https://example.com/",
    ],
)
def test_source_url_must_be_an_absolute_http_url(value):
    with pytest.raises(FactValidationError) as excinfo:
        validate_entry(_entry(source_url=value), SOURCE)
    message = str(excinfo.value)
    assert "synthetic-entry" in message, message
    assert "source_url" in message, message


@pytest.mark.parametrize(
    "value",
    [
        None,
        "",
        "   ",
        "7 August 2026",      # human-readable, not sortable against `valid_until`
        "2026/08/07",         # right order, wrong separator
        "08-07-2026",         # American order
        "2026-08",            # a month is not a day
        "2026-13-01",         # ISO-shaped and not a real date
        "2026-02-30",         # ISO-shaped and not a real date
        "1899-01-01",         # a typo rather than a review date
    ],
)
def test_checked_on_must_be_a_real_iso_date(value):
    with pytest.raises(FactValidationError) as excinfo:
        validate_entry(_entry(checked_on=value), SOURCE)
    message = str(excinfo.value)
    assert "synthetic-entry" in message, message
    assert "checked_on" in message, message


def test_checked_on_is_not_compared_against_the_clock():
    """SHAPE, NOT FRESHNESS, and that is a deliberate limit on this gate.

    `scripts/build_nba_facts.py` promises a build that is offline and
    deterministic. A staleness rule here would make the build a function of the
    date it ran on, so a bank that was green in CI on Friday would be red on
    Monday with no input changed. Staleness is reviewed in
    `docs/implementation/NBA_FACT_BANK_AUDIT.md` instead.
    """
    validate_entry(_entry(checked_on="2003-04-05"), SOURCE)
    validate_entry(_entry(checked_on="2099-12-31"), SOURCE)


@pytest.mark.parametrize("value", [None, "", "   ", "fact", "trivia", "RECORD", "records"])
def test_claim_type_must_come_from_the_closed_vocabulary(value):
    with pytest.raises(FactValidationError) as excinfo:
        validate_entry(_entry(claim_type=value), SOURCE)
    message = str(excinfo.value)
    assert "synthetic-entry" in message, message
    assert "claim_type" in message, message


def test_the_unknown_claim_type_message_lists_the_vocabulary():
    """A closed vocabulary is only usable if the error prints it.

    "unknown claim_type 'fact'" sends a curator to grep for the list. The
    message carries the list.
    """
    with pytest.raises(FactValidationError) as excinfo:
        validate_entry(_entry(claim_type="fact"), SOURCE)
    message = str(excinfo.value)
    for name in CLAIM_TYPES:
        assert name in message, (name, message)


# ---------------------------------------------------------------------------
# Banned phrases, family by family
# ---------------------------------------------------------------------------


def _phrase_ids(phrases) -> list[str]:
    return [phrase.phrase for phrase in phrases]


@pytest.mark.parametrize(
    "phrase", SUBJECTIVE_PHRASES, ids=_phrase_ids(SUBJECTIVE_PHRASES)
)
def test_every_subjective_phrase_is_rejected(phrase: BannedPhrase):
    """Opinion is refused in EVERY claim type, `record` included.

    A record claim is allowed to say "the only"; it is not allowed to say "the
    greatest", because no source settles the second one however carefully the
    bound on the first was checked.
    """
    for claim_type in CLAIM_TYPES:
        with pytest.raises(FactValidationError) as excinfo:
            validate_entry(
                _entry(
                    body=f"Boston built the floor and it was {phrase.phrase} of them.",
                    claim_type=claim_type,
                ),
                SOURCE,
            )
        message = str(excinfo.value)
        assert "synthetic-entry" in message, message
        assert "subjective" in message, message


@pytest.mark.parametrize("phrase", HEDGE_PHRASES, ids=_phrase_ids(HEDGE_PHRASES))
def test_every_hedge_is_rejected(phrase: BannedPhrase):
    for claim_type in CLAIM_TYPES:
        with pytest.raises(FactValidationError) as excinfo:
            validate_entry(
                _entry(
                    body=f"The floor was {phrase.phrase} made of red oak offcuts.",
                    claim_type=claim_type,
                ),
                SOURCE,
            )
        assert "hedging" in str(excinfo.value)


@pytest.mark.parametrize(
    "phrase", MODEL_VOICE_PHRASES, ids=_phrase_ids(MODEL_VOICE_PHRASES)
)
def test_every_model_voice_phrase_is_rejected(phrase: BannedPhrase):
    """This panel is general basketball trivia and never a model output.

    `apps/web/src/components/home/NbaFactOfTheDay.tsx` states the rule in its
    own docstring; this is the build-time half of it.
    """
    for claim_type in CLAIM_TYPES:
        with pytest.raises(FactValidationError) as excinfo:
            validate_entry(
                _entry(
                    body=f"For context, {phrase.phrase} is relevant here.",
                    claim_type=claim_type,
                ),
                SOURCE,
            )
        assert "model-voice" in str(excinfo.value)


@pytest.mark.parametrize(
    "phrase", SUPERLATIVE_PHRASES, ids=_phrase_ids(SUPERLATIVE_PHRASES)
)
def test_superlatives_are_rejected_outside_record_claims(phrase: BannedPhrase):
    for claim_type in sorted(set(CLAIM_TYPES) - {SUPERLATIVE_CLAIM_TYPE}):
        with pytest.raises(FactValidationError) as excinfo:
            validate_entry(
                _entry(
                    body=f"Boston played on it, and {phrase.phrase} floor was like it.",
                    claim_type=claim_type,
                ),
                SOURCE,
            )
        message = str(excinfo.value)
        assert "superlative" in message, message
        assert SUPERLATIVE_CLAIM_TYPE in message, message


@pytest.mark.parametrize(
    "phrase", SUPERLATIVE_PHRASES, ids=_phrase_ids(SUPERLATIVE_PHRASES)
)
def test_superlatives_are_allowed_in_record_claims(phrase: BannedPhrase):
    """THE POINT IS NOT TO DELETE SUPERLATIVES.

    Half of what makes a fact worth reading is that it is the first, the most or
    the only one. The rule is that a superlative is a claim somebody bounded, so
    saying it puts the entry in the one claim type whose reviewer is on notice.
    """
    validate_entry(
        _entry(
            body=f"Boston played on it, and {phrase.phrase} floor was like it.",
            claim_type=SUPERLATIVE_CLAIM_TYPE,
        ),
        SOURCE,
    )


def test_the_headline_is_screened_as_well_as_the_body():
    """One card, one claim. A superlative parked in the headline is not safer."""
    with pytest.raises(FactValidationError):
        validate_entry(
            _entry(headline="The only floor in the NBA made of offcuts.", claim_type="event"),
            SOURCE,
        )


# ---------------------------------------------------------------------------
# Matching precision
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "The NBA threw the first-ever three-pointer out of the rulebook.",
        "The NBA threw the first—ever three-pointer out of the rulebook.",
        "the FIRST EVER of its kind",
    ],
)
def test_hyphen_and_case_variants_are_caught(text):
    """A rule a hyphen defeats teaches curators to type hyphens."""
    with pytest.raises(FactValidationError):
        validate_entry(_entry(body=text, claim_type="event"), SOURCE)


@pytest.mark.parametrize(
    "text",
    [
        # `record` must not reach "recorded"; the phrase list has no bare
        # "record", but the boundary design is what guarantees that class of
        # miss, so it is asserted rather than assumed.
        "The game was recorded on a rigged aerial by a college student.",
        # "never" must not reach "nevertheless".
        "The vote failed; nevertheless the professionals arrived three years later.",
        # A series is "best-of-seven" and a season high is a "career-best".
        "Miami won the best-of-seven series after a career-best season.",
        # "the most" must not fire on "the mostly white shoe" — which is the
        # NBA's own 1984 uniform rule, and is in this bank.
        "The rule required the mostly white shoe to match a player's teammates.",
        # `only one` is banned; `only` on its own is ordinary English.
        "He played only in Serbia before the draft.",
    ],
)
def test_ordinary_words_containing_banned_stems_are_not_flagged(text):
    validate_entry(_entry(body=text, claim_type="event"), SOURCE)


def test_the_failure_message_names_the_entry_the_phrase_and_the_fix():
    """A gate is only as good as the sentence it prints when it fires.

    The existing gate in `editorial.py` names the file and the key; this one
    additionally has to name WHICH WORDS tripped it, because a curator reading
    "entry 'boston-parquet' uses banned language" has to re-read a paragraph to
    find out which four words.
    """
    with pytest.raises(FactValidationError) as excinfo:
        validate_entry(
            _entry(key="boston-parquet", body="It was the greatest floor.", claim_type="event"),
            SOURCE,
        )
    message = str(excinfo.value)
    assert "editorial_facts.json" in message, message
    assert "boston-parquet" in message, message
    assert "greatest" in message, message
    # The remedy, not just the complaint.
    assert "Fix:" in message, message


# ---------------------------------------------------------------------------
# The gate is wired into the build
# ---------------------------------------------------------------------------


def test_load_editorial_refuses_an_invalid_entry(tmp_path):
    """THE REGRESSION THAT MATTERS IS THE WIRING, not the rule.

    A validator nobody calls is documentation. This writes a file the build
    would load and asserts the build stops, as `EditorialFactError` — the type
    `scripts/build_nba_facts.py` catches — rather than as something that escapes
    to a traceback.
    """
    payload = {"version": "editorial_v1", "facts": [_entry(source_url="")]}
    path = tmp_path / "editorial_facts.json"
    path.write_text(json.dumps(payload))

    with pytest.raises(EditorialFactError) as excinfo:
        load_editorial(path)
    assert "source_url" in str(excinfo.value)


def test_structural_failures_are_reported_before_language_failures(tmp_path):
    """Order the diagnostics so the first complaint is the first thing to fix.

    An entry with no category is not a fact with a wording problem; it is a
    fact nobody finished. Reporting "uses the superlative phrase 'the only'"
    about a draft sends the curator to the wrong sentence.
    """
    broken = _entry(category="", headline="The only floor of its kind.", claim_type="event")
    payload = {"version": "editorial_v1", "facts": [broken]}
    path = tmp_path / "editorial_facts.json"
    path.write_text(json.dumps(payload))

    with pytest.raises(EditorialFactError) as excinfo:
        load_editorial(path)
    message = str(excinfo.value)
    assert "category" in message, message
    assert "superlative" not in message, message


# ---------------------------------------------------------------------------
# The committed bank
# ---------------------------------------------------------------------------


def _committed_entries() -> list[dict]:
    return json.loads(EDITORIAL_PATH.read_text())["facts"]


def test_the_committed_bank_has_zero_violations():
    """THE GUARD THAT STOPS A BAD FACT SHIPPING.

    Every other test in this file describes the rules. This one is the only
    thing standing between a rule and a homepage: it runs the real validator
    over the real committed file and reports EVERY entry that fails rather than
    stopping at the first, because a curator fixing a batch of entries wants the
    batch.
    """
    failures: list[str] = []
    for entry in _committed_entries():
        try:
            validate_entry(entry, EDITORIAL_PATH)
        except FactValidationError as exc:
            failures.append(str(exc))
    assert not failures, "\n".join(failures)


def test_every_committed_entry_carries_the_new_metadata():
    """Stated separately from the validator run so a REMOVAL is also caught.

    If `validate_entry` ever stopped requiring `source_url` — by refactor, by a
    typo in a field name — the test above would keep passing on a bank with no
    URLs in it at all.
    """
    for entry in _committed_entries():
        key = entry.get("key")
        assert entry.get("source_url", "").startswith(("http://", "https://")), key
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry.get("checked_on", "")), key
        assert entry.get("claim_type") in CLAIM_TYPES, key


def test_superlative_entries_are_declared_as_record_claims():
    """The rule, restated over the committed file as a positive assertion.

    `test_the_committed_bank_has_zero_violations` proves nothing is rejected.
    This proves the reason: every entry whose prose uses a superlative is
    actually declared `record`, rather than the phrase list having quietly
    stopped matching.
    """
    for entry in _committed_entries():
        text = f"{entry.get('headline', '')} {entry.get('body', '')}"
        hits = [
            phrase.phrase
            for phrase in SUPERLATIVE_PHRASES
            if phrase.pattern.search(text)
        ]
        if hits:
            assert entry.get("claim_type") == SUPERLATIVE_CLAIM_TYPE, (
                entry.get("key"),
                hits,
            )


def test_the_bank_carries_no_banned_phrase_at_all_outside_record_claims():
    """A belt-and-braces sweep, phrased as the reader's question.

    "Is there anything on this homepage I cannot check?" — answered by running
    every phrase in every family over every entry, rather than by trusting that
    `validate_entry` calls all four lists.
    """
    for entry in _committed_entries():
        text = f"{entry.get('headline', '')} {entry.get('body', '')}"
        for phrase in banned_phrases():
            match = phrase.pattern.search(text)
            if match is None:
                continue
            assert phrase in SUPERLATIVE_PHRASES, (entry.get("key"), match.group(0))
            assert entry.get("claim_type") == SUPERLATIVE_CLAIM_TYPE, entry.get("key")


# ---------------------------------------------------------------------------
# The specific false claim that started all of this
# ---------------------------------------------------------------------------

#: The claim, reduced to the three things that make it false, so a REWORDING is
#: caught as well as a re-addition of the original sentence. Keyed on the CLAIM
#: rather than on `key: euroleague-titles`, because the entry key is the one
#: part of a fact a curator changes freely.
#:
#: What was wrong: Real Madrid have eleven European titles and the Boston
#: Celtics have eighteen NBA championships, so "more continental titles than any
#: NBA franchise has championships" is false by seven. The surviving entry makes
#: the true half of the claim — Real Madrid have won more European titles than
#: any other club — and drops the cross-competition comparison entirely.
_FALSE_CROSS_LEAGUE_COMPARISON = re.compile(
    r"(continental|european)\s+(titles?|crowns?|championships?)"
    r"[^.]*\b(than|versus|vs\.?)\b[^.]*\bnba\b",
    re.IGNORECASE,
)


def test_the_false_euroleague_versus_nba_comparison_is_not_in_the_bank():
    for entry in _committed_entries():
        text = f"{entry.get('headline', '')} {entry.get('body', '')}"
        assert not _FALSE_CROSS_LEAGUE_COMPARISON.search(text), entry.get("key")


def test_the_false_comparison_pattern_would_catch_the_original_wording():
    """A negative assertion is worthless if the pattern matches nothing.

    The sentence below is the one that shipped. If a refactor ever broke the
    regex, the test above would pass on a bank that had the claim back.
    """
    original = (
        "Europe's most successful basketball club has more continental titles "
        "than any NBA franchise has championships."
    )
    assert _FALSE_CROSS_LEAGUE_COMPARISON.search(original)


def test_no_published_fact_repeats_the_real_madrid_comparison():
    """The same assertion one layer down, over the BUILT facts.

    `load_editorial` is what the build calls; running the check against its
    output means a future entry that reaches the bank through some other path
    is caught too.
    """
    for fact in load_editorial():
        assert not _FALSE_CROSS_LEAGUE_COMPARISON.search(fact.text), fact.fact_id
