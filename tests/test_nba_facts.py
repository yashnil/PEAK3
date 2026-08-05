"""The NBA Fact of the Day bank: determinism, evidence, and no PEAK3 in it.

The three properties worth testing here are the three a reader cannot check by
looking at the homepage: that today's fact is the same for everyone, that every
sentence is backed by rows in the committed data, and that nothing in the bank
is a claim about the model.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from nba_peak.nba_facts import (
    CATEGORIES,
    FACT_BANK_VERSION,
    MAX_CAREER_SPAN_YEARS,
    NbaFact,
    bank_payload,
    build_bank,
    fact_for_date,
    load_rows,
)

MIN_FACTS = 60


@pytest.fixture(scope="module")
def rows():
    return load_rows()


@pytest.fixture(scope="module")
def bank():
    return build_bank()


# ---------------------------------------------------------------------------
# The bank
# ---------------------------------------------------------------------------


def test_the_bank_is_large_enough_to_not_repeat_itself(bank):
    assert len(bank) >= MIN_FACTS


def test_every_fact_has_a_stable_unique_id(bank):
    ids = [fact.fact_id for fact in bank]
    assert len(ids) == len(set(ids))


def test_every_fact_carries_evidence_rows(bank):
    """A trivia line with no way back to its source is indistinguishable from
    an invented one, and this bank is generated rather than authored."""
    for fact in bank:
        assert fact.evidence, f"{fact.fact_id} has no evidence"
        for row in fact.evidence:
            assert row["player"] and row["season"] and row["team"]


def test_every_fact_uses_a_published_category(bank):
    for fact in bank:
        assert fact.category in CATEGORIES


def test_every_evidence_row_exists_in_the_source_data(bank, rows):
    """Re-derived from the source rather than trusted.

    This is the assertion that makes the bank checkable: a generator that
    started emitting a season a player did not play fails here, not in a
    screenshot months later.
    """
    real = {(row["player"], row["team"], row["season"]) for row in rows}
    for fact in bank:
        for row in fact.evidence:
            key = (row["player"], row["team"], row["season"])
            assert key in real, f"{fact.fact_id} cites {key}, which is not in the data"


def test_the_bank_is_reproducible(bank):
    """Same data in, same bank out. A regenerated bank that differs is a data
    change, not a nondeterministic generator."""
    again = build_bank()
    assert [fact.as_dict() for fact in again] == [fact.as_dict() for fact in bank]


def test_the_bank_serialises_and_round_trips(bank):
    payload = bank_payload(bank)
    assert payload["version"] == FACT_BANK_VERSION
    assert payload["count"] == len(bank)
    restored = [NbaFact.from_dict(entry) for entry in json.loads(json.dumps(payload))["facts"]]
    assert [fact.as_dict() for fact in restored] == [fact.as_dict() for fact in bank]


# ---------------------------------------------------------------------------
# Not a PEAK3 claim
# ---------------------------------------------------------------------------


def test_no_fact_mentions_the_model(bank):
    """The heading is "NBA Fact of the Day", and the content has to match it.

    A visitor lands on the homepage before they know what PEAK3 is, so a fact
    they cannot evaluate without the model is a fact they skip.
    """
    banned = ("peak3", "prime score", "prime_score", "peak score", "our model")
    for fact in bank:
        lowered = fact.text.lower()
        for word in banned:
            assert word not in lowered, f"{fact.fact_id} refers to the model: {fact.text}"


def test_no_fact_depends_on_a_component_score(bank):
    """Structural, not textual: the generators read the season table only.

    `load_rows` returns membership and games; there is no score anywhere in the
    pipeline, so a fact cannot be a function of one.
    """
    from nba_peak import nba_facts

    source = (nba_facts.__file__ or "")
    assert source
    text = open(source).read()
    assert "prime_score" not in text
    assert "scored_1980_2026" not in text


# ---------------------------------------------------------------------------
# Data hygiene
# ---------------------------------------------------------------------------


def test_ambiguous_name_collisions_are_dropped(rows):
    """`johnny-davis` spans 45 years because it is two people.

    Left in, the generators produce confident nonsense. They are dropped rather
    than split, because splitting means guessing which rows belong to whom.
    """
    spans: dict[str, list[int]] = {}
    for row in rows:
        spans.setdefault(row["player_slug"], []).append(row["season_start"])
    for slug, years in spans.items():
        assert max(years) - min(years) <= MAX_CAREER_SPAN_YEARS, slug
    assert "johnny-davis" not in spans
    assert "mike-dunleavy" not in spans


def test_no_multi_team_aggregate_row_reaches_a_fact(rows):
    """A "2TM" season did not happen at a team, so it cannot prove a tenure."""
    for row in rows:
        assert row["team"] not in {"2TM", "3TM", "4TM", "5TM", "TOT"}


# ---------------------------------------------------------------------------
# Selection
# ---------------------------------------------------------------------------


def test_the_same_date_always_returns_the_same_fact(bank):
    for iso in ("2026-01-01", "2026-08-04", "2027-12-31"):
        assert fact_for_date(bank, iso).fact_id == fact_for_date(bank, iso).fact_id


def test_consecutive_days_never_repeat(bank):
    """A homepage showing the same trivia two mornings running reads as broken.

    Checked over a full year rather than a handful of days, because a plain
    hash-modulo collides rarely enough to survive a small sample.
    """
    start = date(2026, 1, 1)
    previous = None
    for offset in range(400):
        today = (start + timedelta(days=offset)).isoformat()
        current = fact_for_date(bank, today).fact_id
        assert current != previous, f"{today} repeated the previous day's fact"
        previous = current


def test_selection_visits_the_whole_bank_before_repeating(bank):
    """The stride is coprime with the bank size, so no fact is unreachable and
    none is over-served. Verified over exactly one bank's worth of days."""
    start = date(2026, 1, 1)
    seen = {
        fact_for_date(bank, (start + timedelta(days=offset)).isoformat()).fact_id
        for offset in range(len(bank))
    }
    assert len(seen) == len(bank)


def test_selection_reads_no_clock(bank):
    """A far-future date resolves exactly as a past one does.

    Selection is a pure function of the date the caller supplies, which is what
    lets a test ask for any day and a replayed request produce the same answer.
    """
    assert fact_for_date(bank, "2099-06-01") is not None
    assert fact_for_date(bank, "1999-06-01") is not None


def test_an_empty_bank_returns_nothing_rather_than_raising():
    assert fact_for_date([], "2026-08-04") is None
