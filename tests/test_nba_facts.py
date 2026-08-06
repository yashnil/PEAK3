"""The NBA Fact of the Day bank: sourcing, quality, rotation, and no PEAK3 in it.

The properties worth testing here are the ones a reader cannot check by looking
at the homepage: that today's fact is the same for everyone, that nothing is
published without a source somebody checked, that a fact about the present
stops being served when it stops being true, and that nothing in the bank is a
claim about the model.

WHAT CHANGED, AND WHY SOME ASSERTIONS RELAXED WHILE OTHERS TIGHTENED. The bank
used to be entirely generated from the committed per-season table, so "every
fact carries evidence rows" was both true and the whole verification story. It
is no longer true, on purpose: a curated half exists because a per-season totals
table cannot know why the shot clock is 24 seconds. So the evidence assertion
now applies to DERIVED facts, and a strictly harder one applies to the curated
half — an editorial fact with no named source, or marked unverified, fails the
BUILD, not just this file.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from nba_peak.nba_facts import (
    CATEGORIES,
    FACT_BANK_VERSION,
    MIN_FACTS,
    NbaFact,
    PERISHABLE_CATEGORIES,
    bank_payload,
    build_bank,
    build_candidates,
    fact_for_date,
    is_live,
    load_rows,
    recent_window,
)
from nba_peak.nba_facts.derived import MAX_CAREER_SPAN_YEARS


@pytest.fixture(scope="module")
def rows():
    return load_rows()


@pytest.fixture(scope="module")
def built():
    return build_bank()


@pytest.fixture(scope="module")
def bank(built):
    return built[0]


@pytest.fixture(scope="module")
def rejected(built):
    return built[1]


@pytest.fixture(scope="module")
def derived_facts(bank):
    return [fact for fact in bank if fact.provenance == "derived"]


@pytest.fixture(scope="module")
def editorial_facts(bank):
    return [fact for fact in bank if fact.provenance == "editorial"]


# ---------------------------------------------------------------------------
# The bank
# ---------------------------------------------------------------------------


def test_the_bank_is_large_enough_to_not_repeat_itself(bank):
    assert len(bank) >= MIN_FACTS


def test_every_fact_has_a_stable_unique_id(bank):
    ids = [fact.fact_id for fact in bank]
    assert len(ids) == len(set(ids))


def test_every_derived_fact_carries_evidence_rows(derived_facts):
    """A GENERATED line with no way back to its source is indistinguishable
    from an invented one. The curated half is held to the harder standard in
    `test_every_editorial_fact_names_a_source_it_was_checked_against`."""
    assert derived_facts, "the derived generators produced nothing"
    for fact in derived_facts:
        assert fact.evidence, f"{fact.fact_id} has no evidence"
        for row in fact.evidence:
            assert row["player"] and row["season"] and row["team"]


def test_every_fact_uses_a_published_category(bank):
    for fact in bank:
        assert fact.category in CATEGORIES


def test_every_evidence_row_exists_in_the_source_data(derived_facts, rows):
    """Re-derived from the source rather than trusted.

    This is the assertion that makes the bank checkable: a generator that
    started emitting a season a player did not play fails here, not in a
    screenshot months later.
    """
    real = {(row["player"], row["team"], row["season"]) for row in rows}
    for fact in derived_facts:
        for row in fact.evidence:
            key = (row["player"], row["team"], row["season"])
            assert key in real, f"{fact.fact_id} cites {key}, which is not in the data"


def test_the_bank_is_reproducible(bank):
    """Same inputs in, same bank out. A regenerated bank that differs is an
    input change, not a nondeterministic pipeline — and it is what makes "no
    model runs here" checkable rather than merely stated."""
    again, _ = build_bank()
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


def test_selection_reaches_every_fact(bank):
    """No fact is unreachable, and none is over-served.

    The period is still exactly one bank's worth of days, as it was under the
    old single-stride rotation. What changed is what happens INSIDE that period:
    the schedule is interleaved across (category-group, era-group) buckets, so
    consecutive days differ in kind rather than only in fact. The old walk was
    blind to what it landed on, which is how a run of days could be five
    variations of the same pattern, each of which passed its own quality bar
    while the sequence passed nothing.
    """
    period = len(bank)
    start = date(2026, 1, 1)
    seen = {
        fact_for_date(bank, (start + timedelta(days=offset)).isoformat()).fact_id
        for offset in range(period)
    }
    assert seen == {fact.fact_id for fact in bank}


def test_selection_reads_no_clock(bank):
    """A far-future date resolves exactly as a past one does.

    Selection is a pure function of the date the caller supplies, which is what
    lets a test ask for any day and a replayed request produce the same answer.
    """
    assert fact_for_date(bank, "2099-06-01") is not None
    assert fact_for_date(bank, "1999-06-01") is not None


def test_an_empty_bank_returns_nothing_rather_than_raising():
    assert fact_for_date([], "2026-08-04") is None


# ---------------------------------------------------------------------------
# Sourcing — the curated half
#
# THE HARD RULE OF THIS PASS. A derived fact is verified by construction: the
# build recomputes it, and the assertions above re-derive its evidence from the
# committed table. An editorial fact has no such guarantee, so it carries a
# named source and a `verified` flag, and the BUILD refuses to publish one
# without both. These tests are that refusal, exercised.
# ---------------------------------------------------------------------------


def test_every_editorial_fact_names_a_source_it_was_checked_against(editorial_facts):
    assert editorial_facts, "the curated half of the bank is empty"
    for fact in editorial_facts:
        assert fact.verified, f"{fact.fact_id} is not marked verified"
        assert fact.source_detail.strip(), f"{fact.fact_id} names no source"
        # A citation, not a shrug. "Basketball history" is not a source.
        assert len(fact.source_detail) > 25, fact.fact_id


def test_the_build_refuses_an_unverified_entry(tmp_path):
    from nba_peak.nba_facts import EditorialFactError, load_editorial

    path = tmp_path / "editorial.json"
    path.write_text(json.dumps({"facts": [{
        "key": "unchecked", "headline": "Something.", "body": "",
        "category": "nba_history", "era": "1990s",
        "source_label": "Editorial", "source_detail": "A source",
        "verified": False,
        "quality": {"surprise": 5, "significance": 5, "clarity": 5,
                    "broad_interest": 5, "novelty": 5, "source_confidence": 5,
                    "homepage_suitability": 5},
    }]}))
    with pytest.raises(EditorialFactError, match="not marked verified"):
        load_editorial(path)


def test_the_build_refuses_an_entry_with_no_source(tmp_path):
    from nba_peak.nba_facts import EditorialFactError, load_editorial

    path = tmp_path / "editorial.json"
    path.write_text(json.dumps({"facts": [{
        "key": "unsourced", "headline": "Something.", "body": "",
        "category": "nba_history", "era": "1990s",
        "source_label": "Editorial", "source_detail": "", "verified": True,
        "quality": {"surprise": 5, "significance": 5, "clarity": 5,
                    "broad_interest": 5, "novelty": 5, "source_confidence": 5,
                    "homepage_suitability": 5},
    }]}))
    with pytest.raises(EditorialFactError, match="source_detail"):
        load_editorial(path)


def test_the_build_refuses_a_fact_about_the_present_with_no_expiry(tmp_path):
    """"LeBron James is the league's all-time leading scorer" is true until it
    is not, and a bank with no expiry eventually publishes something false with
    full confidence."""
    from nba_peak.nba_facts import EditorialFactError, load_editorial

    path = tmp_path / "editorial.json"
    path.write_text(json.dumps({"facts": [{
        "key": "evergreen-current", "headline": "Something about right now.",
        "body": "", "category": sorted(PERISHABLE_CATEGORIES)[0], "era": "2020s",
        "source_label": "Editorial", "source_detail": "A named source, checked",
        "verified": True, "valid_until": None,
        "quality": {"surprise": 5, "significance": 5, "clarity": 5,
                    "broad_interest": 5, "novelty": 5, "source_confidence": 5,
                    "homepage_suitability": 5},
    }]}))
    with pytest.raises(EditorialFactError, match="valid_until"):
        load_editorial(path)


def test_every_perishable_fact_in_the_bank_carries_an_expiry(bank):
    for fact in bank:
        if fact.category in PERISHABLE_CATEGORIES:
            assert fact.valid_until, f"{fact.fact_id} is about the present and never expires"


def test_an_expired_fact_is_not_served(bank):
    perishable = [f for f in bank if f.valid_until]
    assert perishable, "the bank has no dated facts, so expiry is untested"
    fact = perishable[0]
    assert is_live(fact, fact.valid_until)
    day_after = (date.fromisoformat(fact.valid_until) + timedelta(days=1)).isoformat()
    assert not is_live(fact, day_after)
    # And rotation honours it: the fact cannot be selected on any later day.
    for offset in range(60):
        served = fact_for_date(
            bank, (date.fromisoformat(day_after) + timedelta(days=offset)).isoformat()
        )
        assert served is None or served.fact_id != fact.fact_id


# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------


def test_every_published_fact_cleared_every_floor(bank):
    from nba_peak.nba_facts.quality import score_failures

    for fact in bank:
        assert score_failures(fact) == [], f"{fact.fact_id}: {score_failures(fact)}"


def test_the_bank_rejected_the_exact_kind_of_fact_the_review_named(rejected):
    """The review's example was "Ricky Pierce played exactly one season for each
    of four franchises." That generator still RUNS — its output is counted in the
    build report — and none of it ships."""
    reasons = {r.reason for r in rejected}
    assert "below_quality_floor" in reasons
    one_and_done = [
        r for r in rejected
        if "one season" in r.headline.lower() or "single season" in r.headline.lower()
    ]
    assert one_and_done, "the one-season-per-franchise pattern was not rejected"


def test_no_published_fact_is_a_near_duplicate_of_another(bank):
    """WHAT "NEAR-DUPLICATE" MEANS, AND WHY THIS TEST CHANGED WITH IT.

    It used to compare headline + body across every pair in the bank, which was
    right for a 46-fact bank of one-off sentences and wrong for this one, in two
    separate ways:

      * The BODY carries shared explanatory boilerplate. Every fact from one
        generator ends with the same clause, so two facts about two different
        people looked like copies of each other purely because they were
        explained the same way. Expanding the bank rejected 145 good facts on
        it.
      * Two facts about DIFFERENT SUBJECTS are two facts. "Tony Parker won
        Finals MVP on a team he was not the best player on" and the same
        sentence about Jaylen Brown share nine words out of eleven and are not
        one fact.

    So the rule is: same subject, headline only. This asserts the rule the
    pipeline enforces, rather than a stricter one it deliberately does not.
    """
    from nba_peak.nba_facts.quality import NEAR_DUPLICATE_THRESHOLD, _comparable
    from nba_peak.nba_facts.schema import jaccard, normalise_for_dedupe

    tokens = [(fact, normalise_for_dedupe(fact.headline)) for fact in bank]
    for i, (fact_a, a) in enumerate(tokens):
        for fact_b, b in tokens[i + 1:]:
            if not _comparable(fact_a, fact_b):
                continue
            overlap = jaccard(a, b)
            assert overlap < NEAR_DUPLICATE_THRESHOLD, (
                f"{fact_a.fact_id} ~ {fact_b.fact_id} at {overlap:.2f}: "
                f"{fact_a.headline!r} / {fact_b.headline!r}"
            )


def test_two_facts_about_different_people_are_never_merged(bank):
    """The other half of the same rule, asserted directly.

    A bank of 154 generated facts uses each template many times; if the
    duplicate check treated shared phrasing as sameness it would silently keep
    one player per template and drop the rest.
    """
    from collections import Counter

    subjects = Counter(
        fact.player_slug for fact in bank if fact.player_slug
    )
    assert len(subjects) >= 80, f"only {len(subjects)} distinct players in the bank"


def test_the_pattern_cap_is_reported_rather_than_silent(rejected):
    """A bounded coverage that nothing records reads as "the generator only
    found six"."""
    capped = [r for r in rejected if r.reason == "pattern_cap"]
    assert capped, "no pattern was capped, so this guard is untested"
    for rejection in capped:
        assert "not worse" in rejection.detail


# ---------------------------------------------------------------------------
# Balance and rotation
# ---------------------------------------------------------------------------


def test_the_bank_spans_the_categories_the_brief_asked_for(bank):
    categories = {fact.category for fact in bank}
    for required in (
        "rules", "olympics_fiba", "womens", "draft", "playoffs_finals",
        "international_leagues", "global", "records", "culture",
    ):
        assert required in categories, f"nothing in the bank covers {required}"


def test_the_bank_spans_more_than_one_era(bank):
    eras = {fact.era for fact in bank if fact.era}
    assert len(eras) >= 6, sorted(eras)


def test_no_single_category_dominates(bank):
    from collections import Counter

    counts = Counter(fact.category for fact in bank)
    largest = counts.most_common(1)[0][1]
    # The first run of this pipeline produced 153 facts of which 106 shared one
    # legacy category. That is the shape being ruled out.
    assert largest <= len(bank) * 0.25, counts.most_common(5)


def test_no_rotation_group_dominates(bank):
    """The cap the category check cannot express.

    Five separate streak generators plus the record and oddity patterns are
    seven different categories and ONE rotation group, and a group holding half
    the bank cannot be alternated away from however well the categories are
    spread. Expanding the bank to 250 put 51% into `numbers` before this
    existed.
    """
    from collections import Counter

    from nba_peak.nba_facts.quality import MAX_ROTATION_GROUP_SHARE
    from nba_peak.nba_facts.rotation import category_group

    counts = Counter(category_group(fact.category) for fact in bank)
    largest = counts.most_common(1)[0][1]
    # A little headroom over the ceiling: it is computed against the provisional
    # bank, which is larger than the final one.
    assert largest <= len(bank) * (MAX_ROTATION_GROUP_SHARE + 0.10), counts


def test_the_bank_is_large_enough_for_a_daily_feature(bank):
    """180 IS THE PRODUCT REQUIREMENT, not a comfortable margin.

    `schedule()` has a period of exactly `len(bank)` days, so the size of the
    bank is the no-repeat guarantee. A 47-fact bank cycled its whole inventory
    every seven weeks.
    """
    assert len(bank) >= 180, len(bank)


def test_no_fact_repeats_inside_180_daily_keys(bank):
    served = recent_window(bank, "2026-03-01", 180)
    ids = [fact.fact_id for fact in served]
    assert len(ids) == 180
    assert len(set(ids)) == 180, "a fact came round inside 180 days"


def test_no_player_or_team_headlines_twice_in_a_fortnight(bank):
    """A reader notices a name long before they notice a category.

    Round-robin over (category-group, era) buckets alternates the KIND of fact
    and is entirely blind to WHO it is about, so it would happily serve three
    Michael Jordan facts in a week from three different buckets.
    """
    from nba_peak.nba_facts import SUBJECT_SPACING_DAYS
    from nba_peak.nba_facts.rotation import _subject, schedule

    ordered = schedule(bank)
    for index, fact in enumerate(ordered):
        subject = _subject(fact)
        if subject is None:
            continue
        window = ordered[max(0, index - SUBJECT_SPACING_DAYS): index]
        assert all(_subject(other) != subject for other in window), (
            f"{subject} headlined twice inside {SUBJECT_SPACING_DAYS} days"
        )


def test_consecutive_days_almost_never_share_a_category_group(bank):
    """"Almost" is the honest word and the reason is arithmetic.

    Near the end of a period only one lane has anything left in it, so a
    schedule that REFUSED to place a fact there would have to drop it. The
    guarantee is that this is rare, and the build report publishes the number.
    """
    from nba_peak.nba_facts import schedule_audit

    audit = schedule_audit(bank)
    assert audit["consecutive_group_repeats"] <= len(bank) * 0.05, audit


def test_no_generator_template_dominates(bank):
    """Two hundred facts that are individually distinct and identically phrased
    is a real defect, and one generator is one template."""
    from collections import Counter

    from nba_peak.nba_facts import MAX_PER_DERIVED_PATTERN

    counts = Counter(fact.pattern for fact in bank if fact.provenance == "derived")
    assert counts, "no derived facts carry a pattern"
    assert max(counts.values()) <= MAX_PER_DERIVED_PATTERN, counts.most_common(3)


def test_award_facts_are_re_derivable_from_the_committed_context(bank):
    """The award half is verified by construction, like the season half.

    Re-read from the parquet rather than trusted: a generator that started
    claiming an MVP season the data does not have fails here.
    """
    import pandas as pd

    from nba_peak.nba_facts.awards import CONTEXT_PATH

    context = pd.read_parquet(CONTEXT_PATH)
    real = {
        (str(row.player), int(row.season_end))
        for row in context.itertuples()
    }
    award_facts = [
        f for f in bank
        if f.provenance == "derived" and "Basketball-Reference award" in f.source_label
    ]
    assert award_facts, "no award facts in the bank"
    for fact in award_facts:
        for row in fact.evidence:
            season_end = int(str(row["season"])[:4]) + 1
            assert (row["player"], season_end) in real, (
                f"{fact.fact_id} cites {row['player']} {row['season']}, "
                "which is not in the context table"
            )


def test_no_fact_claims_to_be_the_only_one(bank):
    """The committed data starts at 1979-80, so "the only player to" would be a
    claim about a window the reader is never told about — the same
    plausible-and-wrong shape the namesake guard exists to refuse."""
    import re

    forbidden = re.compile(r"\bthe only (player|team|man)\b", re.I)
    for fact in bank:
        if fact.provenance != "derived":
            continue
        assert not forbidden.search(f"{fact.headline} {fact.body}"), fact.fact_id


def test_thirty_consecutive_days_never_repeat_a_fact(bank):
    """Not merely "not the same as yesterday", which is all the old rotation
    guaranteed. A reader notices a fact they saw last week."""
    window = recent_window(bank, "2026-03-01", 30)
    ids = [fact.fact_id for fact in window]
    assert len(ids) == len(set(ids)), "a fact repeated inside 30 days"


def test_consecutive_days_differ_in_kind_not_only_in_fact(bank):
    """The defect the balance exists for: a hash over an unbalanced bank can
    serve five variations of one pattern in a row, each of which passed its own
    quality bar while the SEQUENCE passed nothing."""
    from nba_peak.nba_facts.rotation import category_group, era_group

    window = recent_window(bank, "2026-03-01", 14)
    for previous, current in zip(window, window[1:]):
        assert (
            category_group(previous.category) != category_group(current.category)
            or era_group(previous.era) != era_group(current.era)
        ), f"{previous.fact_id} then {current.fact_id} are the same kind of fact"


def test_no_candidate_is_lost_without_a_reason(bank, rejected):
    """Every candidate is either published or rejected with a named reason.
    A candidate that vanished would be a fact quietly dropped."""
    candidates = build_candidates()
    assert len(candidates) == len(bank) + len(rejected)
    for rejection in rejected:
        assert rejection.reason and rejection.detail


def test_every_published_fact_carries_a_featured_value(bank):
    """THE CARD HAS A FOCAL POINT, whichever half the fact came from.

    The first sheet of review frames showed the curated facts looking finished
    and every derived one collapsing to a headline and a thin line, because only
    the curated half carried a `feature`. A card design that only half the bank
    can use is a card design the other half breaks.
    """
    for fact in bank:
        assert fact.feature, f"{fact.fact_id} has nothing to feature"
        assert fact.feature_label, f"{fact.fact_id} features a value with no label"
        # Short enough to set large. A featured value that wraps to three lines
        # is a paragraph in a big font.
        assert len(fact.feature) <= 16, f"{fact.fact_id}: {fact.feature!r}"


def test_the_bank_is_not_dominated_by_players_switching_teams(bank, rejected):
    """The brief names this pattern explicitly, twice: "players switching
    teams" and "trivial one-season franchise counts". The first sheet of frames
    put one on the homepage —

        "A.C. Green left LAL after 1992-93 and returned 7 years later."

    — so the two generators that produce that shape were re-scored below the
    floor rather than deleted, and this is the assertion that keeps them there.
    """
    switching = [
        fact for fact in bank
        if "returned" in fact.headline.lower()
        or "suited up for" in fact.headline.lower()
        or "one season for each" in fact.headline.lower()
    ]
    assert switching == [], [f.headline for f in switching]
    # And they were rejected rather than never generated, so the report can
    # still say how many there were.
    assert any(
        "returned" in r.headline.lower() or "suited up for" in r.headline.lower()
        for r in rejected
    )


@pytest.mark.parametrize(
    "n,expected",
    [(1, "1st"), (2, "2nd"), (3, "3rd"), (4, "4th"), (11, "11th"), (12, "12th"),
     (13, "13th"), (20, "20th"), (21, "21st"), (22, "22nd"), (23, "23rd"),
     (101, "101st"), (111, "111th")],
)
def test_ordinals_are_english(n, expected):
    """A review frame published "his 23th recorded season" — correct
    arithmetic in incorrect English, on the surface a visitor sees first."""
    from nba_peak.nba_facts.derived import _ordinal

    assert _ordinal(n) == expected


def test_no_published_fact_contains_a_malformed_ordinal(bank):
    import re

    bad = re.compile(r"\b\d*(?<!1)[123]th\b")
    for fact in bank:
        text = f"{fact.headline} {fact.body} {fact.feature or ''}"
        assert not bad.search(text), f"{fact.fact_id}: {text}"


# ---------------------------------------------------------------------------
# Semantic coverage
#
# `category` is one label per fact, chosen by whichever generator or curator
# produced it, and it is a poor answer to "does this bank cover the Olympics" —
# a fact has one category and can be about several things. `coverage.py` reads
# what a fact is ABOUT instead, and these tests hold the bank to the brief's
# preferred minima using that reading rather than the filing.
# ---------------------------------------------------------------------------


def test_every_semantic_area_has_something_in_it(bank):
    from nba_peak.nba_facts import coverage

    assert coverage.uncovered(bank) == []


def test_the_bank_meets_every_coverage_target(bank):
    """The four areas this was written for were 17/25 global, 5/10 women's,
    1/10 current and 12/25 foundational. Thirty-four sourced editorial facts
    closed them; this is what stops the next expansion reopening one."""
    from nba_peak.nba_facts import coverage

    assert coverage.shortfalls(bank) == {}


def test_semantic_coverage_reads_the_fact_not_the_filing(bank):
    """The point of the second classifier, stated as a test.

    Sabonis's nine-year wait is filed `draft` and Petrović is filed
    `player_story`; both are facts about international basketball, and a
    category counter reports neither.
    """
    from nba_peak.nba_facts import coverage

    by_category = sum(
        1
        for fact in bank
        if fact.category in ("global", "international_leagues", "olympics_fiba")
    )
    by_meaning = coverage.coverage_counts(bank)["global_international"]
    assert by_meaning > by_category, (by_meaning, by_category)


def test_every_fact_about_the_present_carries_an_expiry(bank):
    """The brief's phrasing: current NBA coverage, "all with appropriate expiry
    or validity data". Read semantically, so a fact filed `global` that makes a
    claim about this season is held to the same rule as one filed
    `current_nba`."""
    from nba_peak.nba_facts import coverage

    for fact in coverage.facts_in_group(bank, "current_nba"):
        assert fact.valid_until, f"{fact.fact_id}: {fact.headline}"


def test_the_repair_pass_only_ever_improves(bank):
    """`_repair` is a strict-improvement hill climb over a finished schedule.

    It exists because the greedy pass places facts left to right: near the end
    of a period only one or two lanes still hold anything, and if what is left
    in them names the same player twice then the spacing rule is unsatisfiable
    at that moment — though not for the period, which has two hundred other
    positions in it. This asserts the two properties that make the second pass
    safe: it moves nothing else, and it never makes the sequence worse.
    """
    from nba_peak.nba_facts.rotation import _repair, _cost, schedule

    ordered = schedule(bank)
    repaired = _repair(list(ordered))
    everywhere = range(len(ordered))
    assert {f.fact_id for f in repaired} == {f.fact_id for f in ordered}
    assert len(repaired) == len(ordered)
    assert _cost(repaired, everywhere) <= _cost(ordered, everywhere)


def test_the_schedule_depends_on_the_bank_and_not_on_its_order(bank):
    """The schedule is cached by the tuple of fact ids it was built from, so a
    caller handing the same facts in a different order must still get the same
    sequence — otherwise the cache key and the function disagree about what the
    input is."""
    from nba_peak.nba_facts.rotation import schedule

    forwards = schedule(bank)
    backwards = schedule(list(reversed(bank)))
    assert [f.fact_id for f in forwards] == [f.fact_id for f in backwards]
