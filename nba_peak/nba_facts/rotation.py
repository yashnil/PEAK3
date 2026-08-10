"""Which fact today gets, and why it is never the one it got last week.

THREE PROPERTIES, AND THEY PULL AGAINST EACH OTHER
==================================================
1. DETERMINISTIC. Everyone sees the same fact on the same day, a refresh does
   not change it, and tomorrow's is already decided. No state is stored.
2. NO RECENT REPEATS. Not merely "not the same as yesterday" — the old rotation
   guaranteed that and nothing more, so a 60-fact bank could revisit a fact
   inside a fortnight and a reader would notice.
3. BALANCED. A hash over a bank that is 70% roster-churn facts produces a
   homepage that is 70% roster-churn facts. Category and era have to be part of
   the selection, not left to the shape of the bank.

The old rotation delivered (1) and a weak (2) and nothing of (3):

    bank[(day * stride) % size]

A coprime stride walks the whole bank before repeating, which sounds like it
solves (2) — and does, for the bank's full period. But the walk is blind to
what it lands on, so a run of consecutive days can be all-tenure, all-1990s, or
five different players' one-season-per-franchise counts in a row. That is the
mechanism behind "the generated fact is often too dull": each fact cleared its
own bar and the SEQUENCE cleared nothing.

HOW THIS WORKS
==============
The bank is partitioned into buckets of (category-group, era-group), and those
buckets are INTERLEAVED into a single schedule: one fact from each bucket in
turn, round-robin, until every bucket is empty. The day indexes that schedule
directly.

That one construction delivers both remaining properties. Consecutive entries
come from different buckets, so a run of days cannot be five variations of one
pattern; and every fact appears exactly once per period, so a repeat is
impossible inside `len(bank)` days.

An earlier attempt used two nested coprime walks — pick a bucket, then a fact
within it. It balanced the kind of fact correctly and still repeated five facts
inside thirty days, because a bucket holding one fact comes round every time its
bucket does. Balanced and repetitive is not an improvement on unbalanced and
repetitive.

Everything here is a pure function of the date and the bank's contents. No clock
is read; the caller supplies the day, which is what makes every selection
replayable.

WHAT IS ROTATED IS THE FEATURED TIER, NOT THE BANK
==================================================
`fact_for_date` selects from `featured.featured_facts(bank)`. Callers still hand
it the whole bank — the route does, the build report does — and the tier is
applied inside, so there is one answer to "what may the homepage serve" rather
than one per call site. The consequences are worth stating plainly because two
of them used to be facts about the bank:

  * the schedule's PERIOD is `len(featured)`, not `len(bank)`, so the no-repeat
    guarantee is `featured.MIN_FEATURED_FACTS` days and `bank.MIN_FACTS` no
    longer carries that meaning;
  * every property below — interleaving, subject spacing, the repair pass — is
    now computed over a smaller and stronger set, which makes them easier to
    satisfy rather than harder.

THE DAY IS PACIFIC, NOT UTC. `nba_peak.daily_key` is the one place this
application's day boundary is defined — midnight America/Los_Angeles, shared by
every daily mode. The fact route used to default to the server's UTC date, so
the homepage fact changed at 4pm or 5pm Pacific while every other daily surface
rolled over at midnight. Same product, two different days.
"""
from __future__ import annotations

from datetime import date
from typing import Optional, Sequence

from .schema import NbaFact

#: Categories collapsed into the groups a READER would notice repeating. Two
#: facts about the Finals and about a historic game are both "the postseason and
#: big nights" as far as a homepage sequence is concerned, and separating them
#: would let the rotation serve six of them in a row while technically
#: alternating categories.
CATEGORY_GROUPS: dict[str, str] = {
    "nba_history": "history",
    "obscure_history": "history",
    "historic_games": "history",
    "playoffs_finals": "history",
    "current_nba": "modern",
    "tactics": "modern",
    "draft": "modern",
    "player_story": "people",
    "role_players": "people",
    "connections": "people",
    "culture": "culture",
    "franchise": "culture",
    "rules": "culture",
    "records": "numbers",
    "statistical_oddity": "numbers",
    "streaks": "numbers",
    "global": "world",
    "olympics_fiba": "world",
    "international_leagues": "world",
    "womens": "world",
}


def category_group(category: str) -> str:
    return CATEGORY_GROUPS.get(category, "history")


def era_group(era: str) -> str:
    """Four eras rather than eleven decades.

    Decade buckets would split the bank so finely that most buckets held one
    fact, and a bucket of one is a fact that comes round every time its bucket
    does.
    """
    digits = "".join(c for c in (era or "") if c.isdigit())
    if not digits:
        return "timeless"
    start = int(digits[:4]) if len(digits) >= 4 else int(digits) * 10
    if start < 1970:
        return "early"
    if start < 1995:
        return "classic"
    if start < 2015:
        return "modern"
    return "current"


def day_number(iso_date: str) -> int:
    """Days since year 1, from an ISO date. No clock is read."""
    return date.fromisoformat(iso_date[:10]).toordinal()


def is_live(fact: NbaFact, iso_date: str) -> bool:
    """Whether this fact may be served on this day.

    A perishable fact past its window is not served, ever, rather than served
    with a caveat: "LeBron James is the league's all-time leading scorer" has
    exactly one correct treatment once it stops being true, and it is not
    a footnote.
    """
    if not fact.valid_until:
        return True
    return iso_date[:10] <= fact.valid_until[:10]


def buckets(bank: Sequence[NbaFact]) -> list[tuple[str, list[NbaFact]]]:
    """The bank, partitioned and ordered deterministically."""
    grouped: dict[str, list[NbaFact]] = {}
    for fact in bank:
        key = f"{category_group(fact.category)}|{era_group(fact.era)}"
        grouped.setdefault(key, []).append(fact)
    for facts in grouped.values():
        facts.sort(key=lambda f: f.fact_id)
    return sorted(grouped.items())


#: How many days must pass before the same player or team may headline again.
#:
#: A bank with 154 generated facts in it names some players many times — Michael
#: Jordan, LeBron James and Kareem Abdul-Jabbar each turn up in several
#: patterns. Round-robin over (category-group, era) buckets alternates the KIND
#: of fact and is entirely blind to WHO it is about, so it will happily serve
#: three Jordan facts in a week from three different buckets. A reader notices
#: the name long before they notice the category.
SUBJECT_SPACING_DAYS = 14


def _subject(fact: NbaFact) -> Optional[str]:
    if fact.player_slug:
        return f"player:{fact.player_slug}"
    if fact.team_code:
        return f"team:{fact.team_code}"
    return None


def _pick(facts: Sequence[NbaFact], window: set) -> int:
    """Which fact to take out of this lane, given who has headlined lately.

    THE HEAD OF A LANE IS NOT SACRED. Lanes are consumed head-first, and for a
    long time that was the whole of it: a lane offered `facts[0]` and the
    ranking either took the lane or did not. So when the head named somebody
    who had headlined inside the fortnight, the only two moves available were
    "serve the clash" and "leave the lane alone" — and late in a period, when
    the clashing lane is the only one with anything in it, the second is not a
    move.

    A sibling one place behind it usually names somebody else entirely. Taking
    that sibling honours the spacing rule and disturbs the category interleave
    not at all, because everything in a lane is the same kind of fact by
    construction. Falls back to the head when the whole lane clashes, which is
    what happens when one player owns a bucket.

    Deterministic: lanes are sorted by `fact_id`, so this scan always finds the
    same fact for the same bank and the same window.
    """
    for index, fact in enumerate(facts):
        subject = _subject(fact)
        if subject is None or subject not in window:
            return index
    return 0


def _subject_clashes_at(seq: Sequence[NbaFact], index: int) -> int:
    """How many other facts inside the spacing window name the same subject.

    Looks BOTH WAYS. The greedy pass only ever looks backwards, because when it
    places a fact it does not yet know what comes after; the repair pass is
    moving facts around a finished sequence, and a swap that fixes a clash
    behind while creating one ahead has not fixed anything.
    """
    subject = _subject(seq[index])
    if subject is None:
        return 0
    low = max(0, index - SUBJECT_SPACING_DAYS)
    high = min(len(seq), index + SUBJECT_SPACING_DAYS + 1)
    return sum(
        1
        for other in range(low, high)
        if other != index and _subject(seq[other]) == subject
    )


def _group_clashes_at(seq: Sequence[NbaFact], index: int) -> int:
    """How many of this fact's immediate neighbours are the same kind of fact."""
    group = category_group(seq[index].category)
    clashes = 0
    if index > 0 and category_group(seq[index - 1].category) == group:
        clashes += 1
    if index + 1 < len(seq) and category_group(seq[index + 1].category) == group:
        clashes += 1
    return clashes


#: A repeated NAME costs three times a repeated KIND, for the reason
#: `SUBJECT_SPACING_DAYS` exists at all: a reader notices "LeBron again" long
#: before they notice "another Finals fact". The ratio only ever decides which
#: of two imperfect arrangements to prefer — it never licenses a swap that makes
#: the total worse.
_SUBJECT_WEIGHT = 3
_GROUP_WEIGHT = 1
#: The repair pass stops when a whole sweep changes nothing; this only bounds
#: the pathological case. Two sweeps have been enough for every bank so far.
_MAX_REPAIR_SWEEPS = 4


def _cost(seq: Sequence[NbaFact], indices: Sequence[int]) -> int:
    return sum(
        _SUBJECT_WEIGHT * _subject_clashes_at(seq, index)
        + _GROUP_WEIGHT * _group_clashes_at(seq, index)
        for index in indices
    )


def _repair(seq: list[NbaFact]) -> list[NbaFact]:
    """Swap out the clashes the greedy pass could not avoid.

    WHY A SECOND PASS EXISTS. The greedy pass places facts left to right and
    can only choose among the lanes that still have something in them. Near the
    end of a period that is one or two lanes, and if what is left in them is
    three facts about the same player then the spacing rule is unsatisfiable
    AT THAT MOMENT — not unsatisfiable for the period. The sequence has 228
    other positions in it, most of them nowhere near a fact about that player.

    So this pass takes the finished sequence and, for every position that still
    clashes, looks for a swap that lowers the total cost in the neighbourhood
    of BOTH positions. It is a strict-improvement hill climb: a swap is kept
    only when it makes things better, never when it merely moves the problem,
    so it cannot cycle and it cannot make the schedule worse than the greedy
    pass left it.

    DETERMINISTIC. Every loop runs over a fixed range in order and the first
    improving swap wins, so the same bank always produces the same schedule —
    which is what lets `fact_for_date` be a pure function of the date.

    IT IS STILL A PREFERENCE. A bank where one player genuinely owns more facts
    than the window has room for cannot be fixed by rearrangement, and the
    build report keeps measuring the result rather than asserting it.
    """
    seq = list(seq)
    span = SUBJECT_SPACING_DAYS + 2
    for _ in range(_MAX_REPAIR_SWEEPS):
        improved = False
        for index in range(len(seq)):
            if _subject_clashes_at(seq, index) == 0:
                continue
            for other in range(len(seq)):
                if other == index:
                    continue
                touched = sorted(
                    set(range(max(0, index - span), min(len(seq), index + span)))
                    | set(range(max(0, other - span), min(len(seq), other + span)))
                )
                before = _cost(seq, touched)
                seq[index], seq[other] = seq[other], seq[index]
                if _cost(seq, touched) < before:
                    improved = True
                    break
                seq[index], seq[other] = seq[other], seq[index]
        if not improved:
            break
    return seq


#: BUILT SCHEDULES, KEYED BY EXACTLY WHICH FACTS WENT INTO THEM.
#:
#: `schedule` is a pure function of the set of live facts, and `fact_for_date`
#: calls it on every request — so does every day of `recent_window`, which the
#: build report walks 233 times. Greedy alone was cheap enough to ignore that;
#: the repair pass is not, and a 10ms rebuild on every homepage request to
#: recompute a sequence that cannot have changed is not a trade worth making.
#:
#: KEYED BY CONTENT, SO IT CANNOT SERVE A STALE ANSWER. The key is the tuple of
#: fact ids: a rebuilt bank, or a day on which a perishable fact drops out, is
#: a different key rather than an invalidation somebody has to remember to do.
#: The live set changes only when something expires, so a handful of entries
#: covers every schedule a process will ever need.
_SCHEDULE_CACHE: dict[tuple[str, ...], list[NbaFact]] = {}
_SCHEDULE_CACHE_MAX = 8


def schedule(live: Sequence[NbaFact]) -> list[NbaFact]:
    """The whole bank as ONE ordered sequence, satisfying three constraints.

    WHY A SCHEDULE RATHER THAN A WALK. An earlier version picked a bucket by a
    coprime walk and then a fact within it by a second walk. That balanced the
    KIND of fact from day to day — the point — but a bucket holding a single
    fact came round every `len(buckets)` days, so a 46-fact bank still repeated
    five facts inside thirty days.

    THE THREE CONSTRAINTS, in the order they are enforced:

      1. EVERY FACT APPEARS EXACTLY ONCE per period, so no repeat is possible
         inside `len(bank)` days. Guaranteed by construction: this consumes
         every lane until all are empty.
      2. CONSECUTIVE DAYS DIFFER IN CATEGORY GROUP, so a reader never gets two
         arithmetic facts or two Finals facts back to back.
      3. NO PLAYER OR TEAM HEADLINES TWICE inside `SUBJECT_SPACING_DAYS`.

    GREEDY, WITH THE CONSTRAINTS AS PREFERENCES RATHER THAN AS REQUIREMENTS.
    Late in a period only one lane has anything left, and at that point (2) is
    arithmetically impossible — a schedule that refused to place a fact there
    would either drop it or loop forever. So each step takes the best available
    lane and the audit in the build report measures how often the preference
    could not be honoured, rather than a test asserting a guarantee the
    inventory cannot give.

    TWO DEGREES OF FREEDOM, NOT ONE: which lane, and which fact within it. See
    `_pick`. Choosing only the lane meant (3) could be satisfied only by
    skipping the lane entirely, which is unavailable exactly when it is needed
    most; letting the lane offer the first of its facts that does not clash
    costs nothing, because a lane holds one kind of fact throughout.

    AND THEN A REPAIR PASS, because greed is left-to-right and (3) is not. See
    `_repair`. What the greedy pass cannot do is notice that a clash it is
    about to create at day 225 could be dissolved by moving something at day
    140, where nothing about that player is anywhere near.

    DETERMINISTIC THROUGHOUT. `buckets` sorts its keys and each bucket's facts
    by `fact_id`, and every tie here breaks on the lane key, so the same bank
    always produces the same schedule.
    """
    signature = tuple(fact.fact_id for fact in live)
    cached = _SCHEDULE_CACHE.get(signature)
    if cached is not None:
        return list(cached)

    lanes: dict[str, list[NbaFact]] = {
        key: list(facts) for key, facts in buckets(live)
    }
    out: list[NbaFact] = []
    recent_subjects: list[Optional[str]] = []

    while any(lanes.values()):
        previous_group = category_group(out[-1].category) if out else None
        window = set(recent_subjects[-SUBJECT_SPACING_DAYS:])

        def rank(item: tuple[str, list[NbaFact]]) -> tuple:
            key, facts = item
            offered = facts[_pick(facts, window)]
            group_clash = category_group(offered.category) == previous_group
            subject_clash = (
                _subject(offered) is not None and _subject(offered) in window
            )
            # Fewest violations first; then the fullest lane, so no lane is left
            # to run alone at the end; then the lane key, for determinism.
            return (group_clash + subject_clash, -len(facts), key)

        available = [(k, v) for k, v in sorted(lanes.items()) if v]
        key, facts = min(available, key=rank)
        chosen = facts.pop(_pick(facts, window))
        out.append(chosen)
        recent_subjects.append(_subject(chosen))

    # The greedy pass is left-to-right and cannot see what it will need later;
    # `_repair` is allowed to look at the whole sequence.
    ordered = _repair(out)
    if len(_SCHEDULE_CACHE) >= _SCHEDULE_CACHE_MAX:
        _SCHEDULE_CACHE.clear()
    _SCHEDULE_CACHE[signature] = ordered
    return list(ordered)


def schedule_audit(live: Sequence[NbaFact]) -> dict:
    """How well the schedule honoured its preferences. Measured, not asserted.

    Reported in the build so "consecutive days differ in kind" is a number a
    reader of the report can check, rather than a claim the code makes about
    itself.
    """
    ordered = schedule(live)
    group_repeats = sum(
        1
        for a, b in zip(ordered, ordered[1:])
        if category_group(a.category) == category_group(b.category)
    )
    subject_clashes = 0
    for index, fact in enumerate(ordered):
        subject = _subject(fact)
        if subject is None:
            continue
        window = ordered[max(0, index - SUBJECT_SPACING_DAYS): index]
        if any(_subject(other) == subject for other in window):
            subject_clashes += 1
    return {
        "period_days": len(ordered),
        "distinct_facts": len({f.fact_id for f in ordered}),
        "consecutive_group_repeats": group_repeats,
        "subject_repeats_within_window": subject_clashes,
        "subject_window_days": SUBJECT_SPACING_DAYS,
    }


def fact_for_date(bank: Sequence[NbaFact], iso_date: str) -> Optional[NbaFact]:
    """The fact for one calendar date. Pure, balanced, and repeat-averse.

    THE DAY INDEXES THE SCHEDULE DIRECTLY — no stride, no hash. A stride over
    an already-interleaved sequence would destroy the very adjacency the
    interleave exists to create. The bank version still participates, through
    the schedule's contents, so a rebuilt bank reshuffles rather than silently
    swapping today's fact under the same id.

    IT ROTATES THE FEATURED TIER, NOT THE BANK, AND THAT IS THE WHOLE POINT OF
    THE TIER. Callers hand this the bank — the route does, the report does — and
    for a long time every one of those ~190 facts was a homepage candidate,
    because clearing the publication gate was the only standard there was. It is
    the wrong standard for this surface, for the reason `featured.py` opens with:
    a derived fact's quality axes are constants of its TEMPLATE, so a generator
    whose profile clears the floor puts its whole family on the homepage in a
    block. `featured.featured_facts` is the second gate, and applying it HERE
    rather than at each call site means there is one answer to "what can the
    homepage serve" instead of one per caller.

    ORDER: TIER FIRST, THEN EXPIRY. The tier is a property of the bank and does
    not change shape on the day a perishable fact lapses — an expiry drops that
    fact and promotes nothing, rather than freeing a template slot and silently
    letting a different fact in. An expired fact can therefore never be served:
    it is filtered here, on the way into the schedule, on every date.

    Returns `None` for an empty bank and for a bank whose featured tier is empty,
    which is what lets the route report an unbuilt bank rather than fabricate.
    """
    from .featured import featured_facts

    live = [fact for fact in featured_facts(bank) if is_live(fact, iso_date)]
    if not live:
        return None
    ordered = schedule(live)
    return ordered[day_number(iso_date) % len(ordered)]


def recent_window(bank: Sequence[NbaFact], iso_date: str, days: int) -> list[NbaFact]:
    """What the last `days` days served, ending on `iso_date`. For tests and
    for the report, so "no recent repeats" is measured rather than asserted."""
    start = day_number(iso_date) - days + 1
    out: list[NbaFact] = []
    for offset in range(days):
        served = fact_for_date(
            bank, date.fromordinal(start + offset).isoformat()
        )
        if served is not None:
            out.append(served)
    return out
