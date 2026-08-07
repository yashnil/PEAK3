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

AND THEN THE HOMEPAGE TIER ARRIVED, AND FOUR ASSERTIONS HAD TO MOVE. The daily
rotation no longer walks the bank; it walks `featured.featured_facts(bank)`. So
every property that used to be stated about the BANK — the period, the
no-repeat window, "selection reaches every fact", the subject spacing — is now
stated about the TIER, because the tier is what gets served and asserting them
about a set nothing serves would be asserting nothing. Each of those tests says
so in place. Two assertions were REPLACED BY STRICTLY STRONGER ONES rather than
moved, and both are called out where they sit:

  * the model-independence check used to grep one file for two strings. It now
    scans every module in the package for four dependencies, and it is the test
    that would have caught `title_team_role` reaching a homepage card.
  * "at least 80 distinct players in the bank" could pass while one generator's
    eight published facts were all about the same person. The primary assertion
    is now that no template repeats a subject at all, which the count could not
    express.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from nba_peak.nba_facts import (
    CATEGORIES,
    FACT_BANK_VERSION,
    MIN_FACTS,
    MIN_FEATURED_FACTS,
    NbaFact,
    PERISHABLE_CATEGORIES,
    bank_payload,
    build_bank,
    build_candidates,
    fact_for_date,
    featured_facts,
    featured_failures,
    is_live,
    load_rows,
    recent_window,
    select_featured,
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
def featured(bank):
    """The tier the homepage actually rotates through."""
    return featured_facts(bank)


@pytest.fixture(scope="module")
def derived_facts(bank):
    return [fact for fact in bank if fact.provenance == "derived"]


@pytest.fixture(scope="module")
def editorial_facts(bank):
    return [fact for fact in bank if fact.provenance == "editorial"]


# ---------------------------------------------------------------------------
# The bank
# ---------------------------------------------------------------------------


def test_the_bank_is_large_enough_to_select_a_homepage_tier_from(bank):
    """The RESERVOIR floor. The no-repeat guarantee moved to the featured tier
    (`test_the_featured_tier_is_large_enough_for_a_daily_feature`); this number
    is what a container build with a missing input trips."""
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


#: Every value this REPOSITORY computes rather than records. A fact may not be a
#: function of one, because a claim derived from one cannot be attributed to
#: Basketball-Reference and cannot be checked by a reader who does not have this
#: codebase.
#:
#: `title_team_role` IS THE ENTRY THAT MATTERS, and it is here because it got
#: past. `nba_peak/context/title_role.py` computes it — a weighted z-score
#: composite with `CO_BEST_GAP = 0.60` deciding where "co-best" ends — and two
#: award generators branched on it to publish
#:
#:     "JaVale McGee won 3 championships without ever being the best player on
#:      the team."
#:
#: as an unqualified fact, sourced to Basketball-Reference, on the surface whose
#: whole premise is that a visitor can evaluate it without knowing what PEAK3 is.
#: Both generators are deleted.
REPO_COMPUTED_JUDGMENTS = (
    "title_team_role",
    "title_team_role_score",
    "best_player_title",
    "co_best_player_title",
    "secondary_star_title",
    "prime_score",
    "prime_index",
    "scored_1980_2026",
    "teammate_adjustment",
    "context_confidence",
)

#: And the modules that produce them. An import is as much a dependency as a
#: column read, and a generator that called `title_role.classify(...)` directly
#: would name none of the strings above.
REPO_JUDGMENT_MODULES = (
    "nba_peak.context.title_role",
    "nba_peak.context",
    "peak3",
    "nba_peak.scoring",
)


def test_no_fact_depends_on_a_judgment_this_repository_computes():
    """THE TEST THAT SHOULD HAVE CAUGHT `title_team_role`, AND DID NOT.

    WHAT THIS REPLACES, AND WHY THE REPLACEMENT IS STRICTLY STRONGER. The old
    version opened `nba_peak/nba_facts/__init__.py` — the package's re-export
    list, which contains no generator — and asserted two literal strings were
    absent from it:

        text = open(nba_facts.__file__).read()
        assert "prime_score" not in text
        assert "scored_1980_2026" not in text

    Both assertions passed for the whole life of the defect. `awards.py`,
    `derived.py` and every other module in the package were never opened, so a
    generator reading a PEAK3-computed column was invisible to the one test
    written to forbid exactly that. The docstring even claimed the property was
    structural — "there is no score anywhere in the pipeline" — which was a
    statement about a file nobody was checking.

    This version reads EVERY module in the package, checks ten repo-computed
    values rather than two, and checks imports as well as identifiers. It is a
    superset of the old test in every dimension: same two strings, more strings,
    more files, plus the import check the old one had no notion of.
    """
    import re
    from pathlib import Path

    from nba_peak import nba_facts

    package = Path(nba_facts.__file__).parent
    modules = sorted(package.glob("*.py"))
    assert len(modules) >= 8, f"only found {len(modules)} modules to scan"

    offences: list[str] = []
    for module in modules:
        text = module.read_text()
        # Comments and docstrings NAME these deliberately — this codebase
        # explains its deletions rather than hiding them — so the scan looks at
        # code only. Stripping is crude on purpose: a false positive here costs
        # a comment reword, and a false negative costs a wrong fact on a
        # homepage.
        code = _strip_prose(text)
        for judgment in REPO_COMPUTED_JUDGMENTS:
            if re.search(rf"\b{re.escape(judgment)}\b", code):
                offences.append(f"{module.name} reads {judgment!r}")
        for dotted in REPO_JUDGMENT_MODULES:
            if re.search(rf"^\s*(from|import)\s+{re.escape(dotted)}\b", code, re.M):
                offences.append(f"{module.name} imports {dotted!r}")

    assert offences == [], (
        "A fact generator depends on a value this repository computes. Such a "
        "claim cannot be sourced to Basketball-Reference and must not be "
        "published as fact: " + "; ".join(offences)
    )


def _strip_prose(text: str) -> str:
    """Source with comments and string literals removed, for the scan above."""
    import io
    import tokenize

    kept: list[str] = []
    try:
        for token in tokenize.generate_tokens(io.StringIO(text).readline):
            if token.type in (tokenize.COMMENT, tokenize.STRING):
                continue
            kept.append(token.string)
    except tokenize.TokenError:  # pragma: no cover - only on unparseable source
        return text
    return "\n".join(kept)


def test_the_two_model_dependent_generators_are_gone():
    """Deleted, not reworded, and not merely absent from the registry.

    "X was not the best player on that team" has no external record to cite, so
    there is no wording that makes it sourceable. A generator left in the module
    but out of `AWARD_GENERATORS` would be one import away from shipping again.
    """
    from nba_peak.nba_facts import awards

    for name in ("gen_finals_mvp_not_best_player", "gen_champion_role_players"):
        assert not hasattr(awards, name), f"{name} is still defined"
    registered = {generator.__name__ for generator in awards.AWARD_GENERATORS}
    assert "gen_finals_mvp_not_best_player" not in registered
    assert "gen_champion_role_players" not in registered


def test_no_published_fact_ranks_a_player_by_an_unstated_standard(bank):
    """The textual half of the same rule, over the WHOLE bank.

    The structural test above forbids reading a computed column. This forbids
    the sentence, whatever produced it — an editorial entry could make the same
    claim from no data at all, and did: one curated fact called a player "its
    best player" and another called somebody "never the worst defender on the
    floor". Both were rewritten to say what happened instead.
    """
    import re

    from nba_peak.nba_facts.featured import SUBJECTIVE_CLAIMS

    forbidden = re.compile(
        r"\bbest player\b|\b(best|worst) (defender|shooter|passer|scorer)\b",
        re.IGNORECASE,
    )
    for fact in bank:
        assert not forbidden.search(f"{fact.headline} {fact.body}"), (
            f"{fact.fact_id} ranks a player: {fact.headline}"
        )
    # And the featured gate knows the same shapes, so a new one cannot reach the
    # homepage even if it reaches the bank.
    assert any("best player" in pattern for pattern, _ in SUBJECTIVE_CLAIMS)


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


def test_selection_reaches_every_featured_fact(bank, featured):
    """No featured fact is unreachable, and none is over-served.

    STATED ABOUT THE TIER, WHICH IS WHAT MOVED. This used to read
    `seen == {fact.fact_id for fact in bank}` over `len(bank)` days, and that
    was the right assertion when the rotation walked the bank. It now walks
    `featured_facts(bank)`, so asserting the old form would assert that the
    homepage serves facts it is specifically gated against serving. The
    property — every member of the rotated set appears exactly once per period,
    none is unreachable — is unchanged and is asserted over the set that is
    actually rotated.
    """
    period = len(featured)
    start = date(2026, 1, 1)
    seen = {
        fact_for_date(bank, (start + timedelta(days=offset)).isoformat()).fact_id
        for offset in range(period)
    }
    assert seen == {fact.fact_id for fact in featured}


def test_the_homepage_never_serves_a_fact_outside_the_featured_tier(bank, featured):
    """The tier is a gate, not a preference.

    A year of days, every one of them checked against the tier, because "only
    high-tier facts rotate onto the homepage" is the whole of HOME-02 and a
    rotation that leaked one fact in fifty would look correct in a sample.
    """
    ids = {fact.fact_id for fact in featured}
    start = date(2026, 1, 1)
    for offset in range(400):
        served = fact_for_date(bank, (start + timedelta(days=offset)).isoformat())
        assert served is not None
        assert served.fact_id in ids, f"{served.fact_id} is in the bank, not the tier"


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


def test_every_expired_featured_fact_is_dropped_on_the_day_it_lapses(bank, featured):
    """EVERY dated fact in the tier, on its last day and its first dead one.

    The test above checks one fact. This checks all of them, and it checks the
    boundary in both directions — a fact must still be served ON `valid_until`
    and must be unreachable the morning after, for a whole rotation period
    rather than for sixty days. An expiry that is honoured for two months and
    then forgotten is the same defect arriving later.
    """
    dated = [f for f in featured if f.valid_until]
    assert dated, "no featured fact carries an expiry, so this guard is untested"
    for fact in dated:
        assert is_live(fact, fact.valid_until), fact.fact_id
        dead = date.fromisoformat(fact.valid_until[:10]) + timedelta(days=1)
        assert not is_live(fact, dead.isoformat())
        for offset in range(len(featured) + 5):
            served = fact_for_date(bank, (dead + timedelta(days=offset)).isoformat())
            assert served is None or served.fact_id != fact.fact_id, (
                f"{fact.fact_id} expired on {fact.valid_until} and was served "
                f"on {(dead + timedelta(days=offset)).isoformat()}"
            )


def test_the_rotation_still_has_something_to_serve_after_everything_expires(bank):
    """A tier that empties is a homepage that goes blank.

    Every perishable fact in the tier is a `current_nba` entry dated to the end
    of a season. This walks past the latest of them and asserts the rotation
    keeps answering — the tier shrinks by the ten that lapsed and does not
    promote anything to replace them, which is the intended behaviour and worth
    stating.
    """
    dated = [f.valid_until[:10] for f in featured_facts(bank) if f.valid_until]
    assert dated
    after = (date.fromisoformat(max(dated)) + timedelta(days=1)).isoformat()
    surviving = [f for f in featured_facts(bank) if is_live(f, after)]
    assert len(surviving) == len(featured_facts(bank)) - len(dated)
    assert len(surviving) >= MIN_FEATURED_FACTS - len(dated)
    for offset in range(30):
        served = fact_for_date(
            bank, (date.fromisoformat(after) + timedelta(days=offset)).isoformat()
        )
        assert served is not None
        assert served.valid_until is None or served.valid_until[:10] >= after


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
    """The other half of the same rule, asserted directly — and asserted better.

    THE OLD FORM WAS `len(distinct players) >= 80`, WHICH COULD NOT SEE THE
    DEFECT IT WAS WRITTEN FOR. If the duplicate check treated shared phrasing as
    sameness it would keep ONE PLAYER PER TEMPLATE and drop the other seven, and
    a bank with twenty templates plus ninety curated facts would still have
    reported well over eighty distinct players. The count was a proxy for the
    property and a loose one.

    The primary assertion is now the property itself: within every generated
    template, no two published facts name the same player. That is strictly
    stronger — it fails on a template collapsed to a single subject, which the
    count passes.

    The bank-wide count is kept as a second, weaker check and its number moved
    from 80 to 75, because 41 facts were removed from the bank on purpose (two
    model-dependent award generators, two roster-tenure profiles re-scored below
    the floor) and 78 is what the smaller bank honestly holds. The number was
    never the point; the injectivity above is.
    """
    from collections import defaultdict

    by_pattern: dict[str, list[str]] = defaultdict(list)
    for fact in bank:
        if fact.provenance == "derived" and fact.player_slug:
            by_pattern[fact.pattern or "unpatterned"].append(fact.player_slug)
    assert by_pattern, "no derived fact names a player"
    for pattern, slugs in sorted(by_pattern.items()):
        assert len(slugs) == len(set(slugs)), (
            f"{pattern} published {len(slugs)} facts about "
            f"{len(set(slugs))} people — the duplicate check collapsed a template"
        )

    subjects = {fact.player_slug for fact in bank if fact.player_slug}
    assert len(subjects) >= 75, f"only {len(subjects)} distinct players in the bank"


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


def test_the_bank_is_large_enough_to_select_a_tier_from(bank):
    """180 IS STILL THE FLOOR, and it now means something narrower.

    It used to be the no-repeat guarantee: `schedule()` had a period of exactly
    `len(bank)` days. The rotation walks the featured tier now, so that meaning
    moved to `MIN_FEATURED_FACTS` and this number is the RESERVOIR floor — the
    thing that failed when a Docker image shipped without `data/facts/` and
    produced 113 facts. The number is unchanged; only its justification is.
    """
    assert len(bank) >= MIN_FACTS, len(bank)


def test_the_featured_tier_is_large_enough_for_a_daily_feature(featured):
    """AND THIS IS THE NO-REPEAT GUARANTEE NOW.

    `schedule()` has a period of exactly `len(featured)` days, so the size of
    the tier is how long a reader can watch before anything comes round again.
    Ninety is a smaller promise than the bank's old 180 and an honest one:
    HOME-02 asks for "a smaller excellent featured set over hundreds of filler
    facts", and the alternative to three months of distinct strong facts is six
    months of which the second half is padding.
    """
    assert len(featured) >= MIN_FEATURED_FACTS, len(featured)


def test_no_fact_repeats_inside_a_full_rotation(bank, featured):
    """A whole period, served day by day, with nothing seen twice.

    The window is `len(featured)` rather than the old fixed 180 because the
    period IS `len(featured)`; asking for 180 distinct facts from a 93-fact
    rotation would assert something arithmetically impossible rather than
    something desirable.
    """
    period = len(featured)
    served = recent_window(bank, "2026-03-01", period)
    ids = [fact.fact_id for fact in served]
    assert len(ids) == period
    assert len(set(ids)) == period, f"a fact came round inside {period} days"


def test_no_player_or_team_headlines_twice_in_a_fortnight(featured):
    """A reader notices a name long before they notice a category.

    Round-robin over (category-group, era) buckets alternates the KIND of fact
    and is entirely blind to WHO it is about, so it would happily serve three
    Michael Jordan facts in a week from three different buckets. Asserted over
    the tier, because the tier is the sequence a reader sees.
    """
    from nba_peak.nba_facts import SUBJECT_SPACING_DAYS
    from nba_peak.nba_facts.rotation import _subject, schedule

    ordered = schedule(featured)
    for index, fact in enumerate(ordered):
        subject = _subject(fact)
        if subject is None:
            continue
        window = ordered[max(0, index - SUBJECT_SPACING_DAYS): index]
        assert all(_subject(other) != subject for other in window), (
            f"{subject} headlined twice inside {SUBJECT_SPACING_DAYS} days"
        )


def test_consecutive_days_almost_never_share_a_category_group(featured):
    """"Almost" is the honest word and the reason is arithmetic.

    Near the end of a period only one lane has anything left in it, so a
    schedule that REFUSED to place a fact there would have to drop it. The
    guarantee is that this is rare, and the build report publishes the number.
    """
    from nba_peak.nba_facts import schedule_audit

    audit = schedule_audit(featured)
    assert audit["consecutive_group_repeats"] <= len(featured) * 0.05, audit


def test_no_generator_template_dominates(bank):
    """Two hundred facts that are individually distinct and identically phrased
    is a real defect, and one generator is one template."""
    from collections import Counter

    from nba_peak.nba_facts import MAX_PER_DERIVED_PATTERN

    counts = Counter(fact.pattern for fact in bank if fact.provenance == "derived")
    assert counts, "no derived facts carry a pattern"
    assert max(counts.values()) <= MAX_PER_DERIVED_PATTERN, counts.most_common(3)


# ---------------------------------------------------------------------------
# The homepage featured tier
#
# HOME-02: "Create a clear homepage suitability gate or tier … only high-tier
# facts rotate onto the homepage … prefer a smaller excellent featured set over
# hundreds of filler facts."
#
# The tier exists because bank membership could not be that gate. A derived
# fact's seven quality axes are constants of its TEMPLATE — every fact one
# generator emits scores identically — so the publication floor admits or
# rejects whole families and can never separate the best instance of a pattern
# from the eighth. These tests hold the second gate to the criteria HOME-02
# names, and hold it to being COMPUTED rather than curated by hand.
# ---------------------------------------------------------------------------


def test_the_featured_tier_is_a_computed_property_and_not_a_hand_list(bank):
    """Membership follows from the scores, for facts that do not exist yet.

    A hand-list would pass every other test in this section and would be a
    different thing: it could not tell a curator why an entry was excluded, and
    a new editorial fact would join only if somebody remembered to add it. This
    builds two synthetic facts that are identical except in their scores and
    asserts the gate separates them.
    """
    from nba_peak.nba_facts import NbaFact, QualityScores
    from nba_peak.nba_facts.featured import featured_failures

    def synthetic(**scores) -> NbaFact:
        return NbaFact(
            fact_id="rules-synthetic",
            headline="A synthetic fact used to exercise the gate.",
            body="It names a source and expires never.",
            category="rules",
            era="1950s",
            provenance="editorial",
            source_label="Editorial — checked against a named published source",
            source_detail="A named published source, long enough to be a citation",
            verified=True,
            quality=QualityScores(**scores),
        )

    strong = synthetic(
        surprise=5, significance=5, clarity=5, broad_interest=5, novelty=5,
        source_confidence=5, homepage_suitability=5,
    )
    weak = synthetic(
        surprise=3, significance=4, clarity=5, broad_interest=5, novelty=4,
        source_confidence=5, homepage_suitability=5,
    )
    assert featured_failures(strong) == []
    assert "surprise<4" in featured_failures(weak)

    # And the gate is what decides the tier: everything in it passes, and
    # nothing that fails is in it.
    ids = {fact.fact_id for fact in featured_facts(bank)}
    for fact in bank:
        if featured_failures(fact):
            assert fact.fact_id not in ids, f"{fact.fact_id} is featured and fails"


def test_every_featured_fact_clears_every_homepage_criterion(featured):
    for fact in featured:
        assert featured_failures(fact) == [], (
            f"{fact.fact_id}: {featured_failures(fact)}"
        )


def test_the_featured_tier_holds_a_higher_bar_than_the_bank(bank, featured):
    """A gate that admits everything is not a gate.

    Two things asserted together, because either alone is satisfiable trivially:
    the tier is a strict subset of the bank, and it is a small enough one that
    it represents a decision. HOME-02's instruction was to prefer a smaller
    excellent set, so the ceiling here is as much the point as the floor.
    """
    bank_ids = {fact.fact_id for fact in bank}
    featured_ids = {fact.fact_id for fact in featured}
    assert featured_ids < bank_ids
    assert len(featured) <= len(bank) * 0.7, (len(featured), len(bank))


def test_derived_facts_clear_a_higher_bar_than_editorial_ones(featured):
    """Not a prejudice about provenance — a correction for what the score
    measures.

    An editorial entry's seven numbers were assigned to that entry by somebody
    who read it. A derived fact's were assigned to its TEMPLATE by somebody who
    read one example. The second is a weaker signal about any individual fact,
    so it has to clear more to carry the same confidence.
    """
    from nba_peak.nba_facts.featured import FEATURED_MIN_TOTAL

    assert FEATURED_MIN_TOTAL["derived"] > FEATURED_MIN_TOTAL["editorial"]
    for fact in featured:
        assert fact.quality.total >= FEATURED_MIN_TOTAL[fact.provenance], fact.fact_id


def test_no_template_can_carry_a_family_onto_the_homepage(featured):
    """THE DEFECT THE TIER EXISTS FOR, ASSERTED DIRECTLY.

    The publication gate caps a generator at eight and takes the first eight by
    hash, because within a generator every fact scores identically and there is
    nothing to rank. Eight of a ninety-fact rotation is 9% — a reader meets the
    same sentence roughly monthly. The tier caps at three AND requires the three
    to come from three different eras, so a template's slots buy three different
    periods of the league rather than three players from one decade.
    """
    from collections import Counter, defaultdict

    from nba_peak.nba_facts import MAX_FEATURED_PER_PATTERN, MAX_PER_DERIVED_PATTERN
    from nba_peak.nba_facts.rotation import era_group

    assert MAX_FEATURED_PER_PATTERN < MAX_PER_DERIVED_PATTERN

    counts = Counter(
        fact.pattern for fact in featured if fact.provenance == "derived"
    )
    assert counts, "no derived fact reached the tier, so this guard is untested"
    assert max(counts.values()) <= MAX_FEATURED_PER_PATTERN, counts.most_common(3)

    eras: dict[str, list[str]] = defaultdict(list)
    for fact in featured:
        if fact.provenance == "derived":
            eras[fact.pattern].append(era_group(fact.era))
    for pattern, groups in sorted(eras.items()):
        assert len(groups) == len(set(groups)), (
            f"{pattern} features {len(groups)} facts from {len(set(groups))} eras"
        )


def test_the_tier_ranks_within_a_template_rather_than_taking_the_first_by_hash(bank):
    """The per-fact signal the publication gate never read.

    Most generators put their subject's number in `feature` — five straight
    rebounding titles, thirteen straight All-Defense teams — and that number is
    per-fact, already computed, and exactly what makes one instance of a
    template more remarkable than another. Where it exists, the featured slots
    must go to the largest, not to whichever id sorted first.
    """
    from collections import defaultdict

    from nba_peak.nba_facts.featured import extremity, featured_failures

    eligible: dict[str, list] = defaultdict(list)
    for fact in bank:
        if fact.provenance == "derived" and not featured_failures(fact):
            eligible[fact.pattern].append(fact)

    chosen = {fact.fact_id for fact in featured_facts(bank)}
    ranked = 0
    for pattern, facts in sorted(eligible.items()):
        magnitudes = {extremity(f) for f in facts}
        if len(magnitudes) <= 1:
            continue  # the template has no internal ordering; see featured.py
        ranked += 1
        taken = [f for f in facts if f.fact_id in chosen]
        if not taken:
            continue
        best = max(extremity(f) for f in facts)
        assert max(extremity(f) for f in taken) == best, (
            f"{pattern} featured a weaker instance than the one it had: "
            f"{[(f.headline, extremity(f)) for f in taken]}"
        )
    assert ranked, "no featured template has a rankable feature"


def test_no_featured_fact_makes_a_claim_nobody_can_check(featured):
    """NON-SUBJECTIVITY, the HOME-02 criterion no quality axis covers.

    `gen_finals_mvp_not_best_player` scored 31/35 with every axis at 4 or 5,
    because the person scoring the template was scoring how INTERESTING it was.
    No axis asks whether a sentence is the kind of thing that can be checked at
    all, so the gate asks it separately.
    """
    from nba_peak.nba_facts.featured import subjective_claim

    for fact in featured:
        found = subjective_claim(fact)
        assert found is None, f"{fact.fact_id}: {found} in {fact.headline!r}"


def test_the_tier_spreads_across_categories_and_eras(featured):
    """CATEGORY DIVERSITY, the sixth criterion, measured on what is served.

    A tier of ninety strong facts that were all Finals history would satisfy
    every other test here and would be a worse homepage than the bank it
    replaced.
    """
    from collections import Counter

    from nba_peak.nba_facts.featured import MAX_FEATURED_GROUP_SHARE
    from nba_peak.nba_facts.rotation import category_group, era_group

    groups = Counter(category_group(fact.category) for fact in featured)
    assert len(groups) >= 5, groups
    assert max(groups.values()) <= len(featured) * (MAX_FEATURED_GROUP_SHARE + 0.05), (
        groups
    )

    eras = Counter(era_group(fact.era) for fact in featured)
    assert set(eras) == {"early", "classic", "modern", "current"}, eras
    assert min(eras.values()) >= len(featured) * 0.1, eras

    categories = {fact.category for fact in featured}
    for required in (
        "rules", "olympics_fiba", "womens", "draft", "global", "records",
        "culture", "current_nba", "nba_history",
    ):
        assert required in categories, f"the tier has nothing filed {required}"


def test_every_featured_fact_about_the_present_carries_an_expiry(featured):
    """Read SEMANTICALLY, so a fact filed `global` that makes a claim about this
    season is held to the same rule as one filed `current_nba`."""
    from nba_peak.nba_facts import coverage

    for fact in coverage.facts_in_group(featured, "current_nba"):
        assert fact.valid_until, f"{fact.fact_id}: {fact.headline}"
    for fact in featured:
        if fact.category in PERISHABLE_CATEGORIES:
            assert fact.valid_until, fact.fact_id


def test_every_featured_fact_is_still_sourceable(featured):
    """The tier is stricter about sourcing than the bank, not looser.

    A derived fact carries the rows it was computed from; a curated one names
    the record a person read. HOME-02: "every published fact remains sourceable
    in data/tests even if sources are not shown in the homepage UI."
    """
    for fact in featured:
        assert fact.verified, fact.fact_id
        assert fact.quality.source_confidence == 5, fact.fact_id
        if fact.provenance == "derived":
            assert fact.evidence, fact.fact_id
        else:
            assert len(fact.source_detail.strip()) > 25, fact.fact_id


def test_the_featured_tier_is_reproducible(bank, featured):
    """Same bank in, same tier out — and independent of the order it arrives in.

    Selection sorts by (total, magnitude, fact_id) and every ceiling is applied
    in that order, so there is no iteration-order dependence to leak.
    """
    again, _ = select_featured(bank)
    assert [f.fact_id for f in again] == [f.fact_id for f in featured]
    backwards, _ = select_featured(list(reversed(bank)))
    assert [f.fact_id for f in backwards] == [f.fact_id for f in featured]


def test_the_written_payload_records_the_tier_the_rotation_serves(bank, featured):
    """The JSON names the featured ids so the artifact is self-describing.

    Nothing reads them back — `fact_for_date` recomputes the tier from the same
    committed scores — so this is the assertion that stops the record and the
    computation drifting into disagreement.
    """
    payload = bank_payload(bank)
    assert payload["featured_count"] == len(featured)
    assert payload["featured"] == [fact.fact_id for fact in featured]
    assert set(payload["featured"]) <= {entry["fact_id"] for entry in payload["facts"]}


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
        # AND THE TWO SHAPES THE HOMEPAGE AUDIT ADDED, which are the same
        # objection one step further on. HOME-01's reject list names "mundane
        # roster-tenure counting", and the last two derived profiles scoring a
        # bare pass were counting rows in a tenure table:
        #
        #   "Udonis Haslem played all 20 of his recorded seasons for one
        #    franchise (MIA)."
        #   "Chris Paul was still on an NBA roster in his 21st recorded season."
        #
        # Both are re-scored below the publication floor, and this is what keeps
        # them there.
        or "of his recorded seasons for one franchise" in fact.headline.lower()
        or "was still on an nba roster" in fact.headline.lower()
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


def test_the_repair_pass_only_ever_improves(featured):
    """`_repair` is a strict-improvement hill climb over a finished schedule.

    It exists because the greedy pass places facts left to right: near the end
    of a period only one or two lanes still hold anything, and if what is left
    in them names the same player twice then the spacing rule is unsatisfiable
    at that moment — though not for the period, which has two hundred other
    positions in it. This asserts the two properties that make the second pass
    safe: it moves nothing else, and it never makes the sequence worse.
    """
    from nba_peak.nba_facts.rotation import _repair, _cost, schedule

    ordered = schedule(featured)
    repaired = _repair(list(ordered))
    everywhere = range(len(ordered))
    assert {f.fact_id for f in repaired} == {f.fact_id for f in ordered}
    assert len(repaired) == len(ordered)
    assert _cost(repaired, everywhere) <= _cost(ordered, everywhere)


def test_the_schedule_depends_on_the_bank_and_not_on_its_order(featured):
    """The schedule is cached by the tuple of fact ids it was built from, so a
    caller handing the same facts in a different order must still get the same
    sequence — otherwise the cache key and the function disagree about what the
    input is."""
    from nba_peak.nba_facts.rotation import schedule

    forwards = schedule(featured)
    backwards = schedule(list(reversed(featured)))
    assert [f.fact_id for f in forwards] == [f.fact_id for f in backwards]
