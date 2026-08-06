"""The Three-Man Weave bot: competent, imperfect, and never illegal.

WHY THE CALIBRATION IS TESTED AS A DISTRIBUTION. "The bot is not always
optimal" is not a property of any single pick -- taking the best available
player is the right move most of the time, and a test that forbade it would be
testing a worse bot. It is a property of a thousand picks, and it is only
falsifiable at that scale.

THE CALIBRATION IS MEASURED IN REGRET, NOT IN RANK, and that is the correction
this file records. It used to bucket every pick by its ORDINAL position in the
bot's own ranked list -- top 20% "strong", to 55% "defensible", to 80%
"mistake". Those buckets cannot distinguish "the second-best wing, a hair
behind" from "a role player, a chasm behind", because both can be rank 12. The
policy they were describing produced "Carl Landry over peak Stephen Curry"
about three times in ten, and these tests passed the whole time.

Regret is the unit a spectator judges in, so it is the unit asserted here:
how much lineup utility the pick gave up against the best legal option, and how
much QUALITY it gave up against the best player on the board. The second is
what makes a catastrophe distinguishable from a difference of opinion.
"""
from __future__ import annotations

import random


import pytest

from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import feasibility as F
from nba_peak.three_man_weave.bot import (
    BOT_ARCHETYPE_NAMES,
    ThreeManWeaveBot,
    archetype_names,
)
from nba_peak.three_man_weave.config import stream_rng

#: Enough matches for the bands to be stable, few enough to stay a fast test.
SEEDS = 60


def _projection(state: D.DraftState, seat: int) -> tuple[dict, dict]:
    """The two dicts the mode's own `project` produces, built from the state."""
    roll = state.current_roll
    assert roll is not None
    fits = D.candidate_fits(state, seat)
    public = {
        "current_roll": {
            **roll.as_dict(),
            "candidates": [{"player_slug": slug} for slug in roll.eligible_slugs],
        }
    }
    private = {
        "open_slots": list(state.roster(seat).open_slots()),
        "candidate_fits": {slug: fit.as_dict() for slug, fit in fits.items()},
    }
    return public, private


def _regret_of(options: list[dict], payload: dict) -> dict:
    """What one pick gave up, on the two scales that matter.

    `utility_regret` is the drop against the best legal option, in the units
    `_utility` returns. `quality_regret` is the drop against the best PLAYER on
    the board, ignoring where they would slot -- the scale on which "passed
    over a superstar" is a different event from "took the other wing".
    """
    chosen = next(
        option
        for option in options
        if option["player_slug"] == payload["player_slug"]
        and option["slot_type"] == payload["slot_type"]
    )
    # REGRET IS MEASURED AGAINST THE BEST OPTION THE POLICY MAY TAKE, which is
    # the best VIABLE one. The quality gate can exclude the utility leader --
    # that is the whole point of it -- so measuring against `options[0]` would
    # score the policy against a pick it is forbidden to make.
    viable = ThreeManWeaveBot.viable_options(options)
    best_utility = max(option["utility"] for option in viable)
    best_score = max(option["score"] for option in options)
    forced = ThreeManWeaveBot.dominant_option(options)
    return {
        "utility_regret": best_utility - chosen["utility"],
        # IN PEAK3 POINTS, the absolute scale the guards are measured in. A
        # roll-normalised regret would read 1.0 for a half-point difference on
        # a two-candidate roll and could not tell a catastrophe from a
        # close call.
        "quality_regret": best_score - chosen["score"],
        "optimal": chosen is viable[0],
        "dominant_roll": forced is not None,
        # DOMINANCE IS ABOUT THE PLAYER, not the slot. When one candidate is
        # the only viable one, WHICH of their slots to use is still an ordinary
        # judgement the bands may decide.
        "took_dominant": forced is None
        or chosen["player_slug"] == forced["player_slug"],
    }


def _play(index, seed: int, record: list | None = None) -> D.DraftState:
    state = D.create_match(seed)
    roll_rng = stream_rng(seed, "rolls")
    while not state.is_complete:
        if (
            state.current_roll is None
            or state.current_roll.round_number != state.current_round
        ):
            roll = F.roll_next(
                index,
                state.rosters,
                state.drafted_identities(),
                state.current_round,
                roll_rng,
                frozenset(state.used_roll_ids),
            )
            assert roll is not None, f"no feasible roll at round {state.current_round}"
            state = D.set_roll(state, roll)

        seat = state.current_seat
        assert seat is not None
        public, private = _projection(state, seat)
        bot = ThreeManWeaveBot()
        options = bot.options(public, private)
        decision = bot.decide(public, private, random.Random(f"tmw:{seed}:{state.turn_index}"))
        assert decision is not None, f"seed {seed}: the bot had no legal move"
        _command, payload = decision

        if record is not None and options:
            record.append(_regret_of(options, payload))

        state = D.apply_pick(
            state,
            payload["player_slug"],
            payload.get("slot_type"),
            seat_index=seat,
            placements=payload.get("placements"),
        )
    return state


@pytest.fixture(scope="module")
def calibration(index) -> list[dict]:
    record: list[dict] = []
    for seed in range(SEEDS):
        _play(index, seed, record)
    return record


def test_every_bot_pick_is_legal_and_every_match_completes(index):
    for seed in range(12):
        state = _play(index, seed)
        assert state.is_complete
        for roster in state.rosters:
            assert roster.is_complete()
        # And the identity lock held throughout.
        slugs = [pick.player_slug for pick in state.picks]
        assert len(slugs) == len(set(slugs))


def test_the_bot_takes_the_best_legal_option_about_ninety_percent_of_the_time(
    calibration,
):
    """PART 10's first calibration target.

    The band is wide on the upper side because the dominance guard removes
    randomness whenever the top option is decisive, and many rolls are decisive
    -- an early roll with one clear star in it should not be a coin flip.
    """
    assert len(calibration) > 500
    optimal = sum(1 for pick in calibration if pick["optimal"]) / len(calibration)
    assert 0.88 <= optimal <= 0.99, optimal


def test_the_bot_still_deviates(calibration):
    """It must not collapse into a maximiser. A bot that always took the top
    option would be an oracle and the mode would be a game against arithmetic
    -- the failure in the OTHER direction from the one being fixed."""
    deviations = sum(1 for pick in calibration if not pick["optimal"])
    assert deviations > 0, "the bot never once deviated across the whole sample"


def test_every_deviation_is_bounded_in_utility(calibration):
    """A deviation is a judgement call, so it has a ceiling.

    `_MILD_DEVIATION_REGRET` is the policy's own bound; asserting it here is
    what stops a future widening of the bands from silently reintroducing the
    ordinal behaviour.
    """
    from nba_peak.three_man_weave.bot import _MILD_DEVIATION_REGRET

    worst = max(pick["utility_regret"] for pick in calibration)
    assert worst <= _MILD_DEVIATION_REGRET + 1e-9, worst


def test_no_deviation_is_a_catastrophic_quality_miss(calibration):
    """THE CARL LANDRY TEST, at distribution scale.

    Whenever the bot did not take its top option, the player it took must be
    within the quality floor of the best player on the board. A pick that IS
    the top option is exempt: taking the only centre over a deeper wing is a
    legitimate basketball answer and stays available.
    """
    from nba_peak.three_man_weave.bot import _MAX_QUALITY_REGRET_POINTS

    offenders = [
        pick
        for pick in calibration
        if not pick["optimal"]
        and pick["quality_regret"] > _MAX_QUALITY_REGRET_POINTS + 1e-9
    ]
    assert not offenders, (
        f"{len(offenders)} deviations passed over a materially better player; "
        f"worst quality regret {max((p['quality_regret'] for p in offenders), default=0):.2f} "
        "PEAK3 points"
    )


def test_the_dominance_guard_is_never_violated(calibration):
    """When a roll is decisive, randomness is off. No exceptions, no rate."""
    violations = [
        pick for pick in calibration if pick["dominant_roll"] and not pick["took_dominant"]
    ]
    assert not violations, f"{len(violations)} dominance violations"


def test_the_bot_never_simply_takes_the_highest_scoring_candidate(index):
    """The v1 policy, asserted against.

    v1 ranked by scoring card and took the maximum, so it agreed with the
    auto-pick on every single turn. If that were still true, the bot would be
    an oracle and the mode would be a game against arithmetic.
    """
    from nba_peak.three_man_weave.autopick import auto_pick

    agreements = 0
    turns = 0
    for seed in range(8):
        state = D.create_match(seed)
        roll_rng = stream_rng(seed, "rolls")
        while not state.is_complete:
            if (
                state.current_roll is None
                or state.current_roll.round_number != state.current_round
            ):
                roll = F.roll_next(
                    index,
                    state.rosters,
                    state.drafted_identities(),
                    state.current_round,
                    roll_rng,
                    frozenset(state.used_roll_ids),
                )
                assert roll is not None
                state = D.set_roll(state, roll)
            seat = state.current_seat
            public, private = _projection(state, seat)
            decision = ThreeManWeaveBot().decide(
                public, private, random.Random(f"tmw:{seed}:{state.turn_index}")
            )
            assert decision is not None
            _command, payload = decision
            greedy = auto_pick(state, index)
            turns += 1
            if greedy and greedy.player_slug == payload["player_slug"]:
                agreements += 1
            state = D.apply_pick(
                state,
                payload["player_slug"],
                payload.get("slot_type"),
                seat_index=seat,
                placements=payload.get("placements"),
            )
    assert agreements < turns, "the bot agreed with best-available on every turn"


def test_the_bot_is_deterministic_from_the_same_inputs(index):
    first = _play(index, 4242)
    second = _play(index, 4242)
    assert [pick.as_dict() for pick in first.picks] == [
        pick.as_dict() for pick in second.picks
    ]


def test_bot_names_are_unique_thematic_and_never_a_real_player(index):
    for seed in range(40):
        names = archetype_names(seed, 2)
        assert len(set(names)) == 2
        for name in names:
            assert name in BOT_ARCHETYPE_NAMES
            assert "PEAK3" not in name
            assert not any(char.isdigit() for char in name)
    # Drafted player names must stay unambiguous, so no archetype may collide
    # with an identity the game can offer.
    everyone = set()
    for roll in index.rolls():
        everyone |= index.eligible_slugs(*roll)
    real = {index.player_name(slug) for slug in everyone}
    assert not (set(BOT_ARCHETYPE_NAMES) & real)


# ---------------------------------------------------------------------------
# The named superstar regressions (PART 10)
# ---------------------------------------------------------------------------
#
# These are ISOLATED POLICY TESTS, not full matches, and deliberately so. The
# reported failure was "a bot passed over available 2010s Stephen Curry for
# Carl Landry", which is a statement about one decision on one roll. Driving a
# whole draft to reach that decision would make the test slow, seed-dependent,
# and silent about which of the two candidates was even offered. Here the roll
# is stated outright, the quality comes from the real committed eligibility
# index for the SAME franchise and decade the pick would be scored on, and the
# only thing under test is the choice.


def _roll_projection(
    franchise: str,
    decade: str,
    slugs: dict[str, list[str]],
    open_slots: list[str] | None = None,
) -> tuple[dict, dict]:
    """A projection offering exactly `slugs`, each fitting the slots named.

    `slugs` maps player_slug -> the slot types that player may occupy directly.
    """
    from nba_peak.three_man_weave.arrangement import FITS_NOW

    public = {
        "current_roll": {
            "franchise_id": franchise,
            "decade": decade,
            "candidates": [{"player_slug": slug} for slug in slugs],
        }
    }
    private = {
        "open_slots": open_slots
        if open_slots is not None
        else ["PG", "SG", "SF", "PF", "C", "bench_1"],
        "candidate_fits": {
            slug: {
                "player_slug": slug,
                "state": FITS_NOW,
                "direct_slots": slot_types,
            }
            for slug, slot_types in slugs.items()
        },
    }
    return public, private


def _always_picks(public: dict, private: dict, trials: int = 400) -> set[str]:
    """Every player the bot chooses across `trials` independent draws."""
    bot = ThreeManWeaveBot()
    return {
        bot.decide(public, private, random.Random(f"regression:{n}"))[1]["player_slug"]
        for n in range(trials)
    }


@pytest.mark.parametrize(
    "franchise,decade,star,replacements,slot_types",
    [
        # THE REPORTED FAILURE, exactly. 2015-16 Curry (93.9) against the GSW
        # 2010s role players he was actually passed over for.
        ("GSW", "2010s", "stephen-curry", ["carl-landry"], ["PG", "SG"]),
        ("CLE", "2010s", "lebron-james", ["anderson-varejao"], ["SF", "PF"]),
        ("CHI", "1990s", "michael-jordan", ["bill-wennington"], ["SG", "SF"]),
        ("LAL", "1980s", "kareem-abdul-jabbar", ["mike-mcgee"], ["C", "PF"]),
    ],
)
def test_a_superstar_is_never_passed_over_for_a_replacement_player(
    index, franchise, decade, star, replacements, slot_types
):
    eligible = index.eligible_slugs(franchise, decade)
    assert star in eligible, f"{star} is not eligible for {franchise} {decade}"
    offered = {star: slot_types}
    for slug in replacements:
        assert slug in eligible, f"{slug} is not eligible for {franchise} {decade}"
        # Given the SAME slots, so positional need cannot excuse the choice.
        offered[slug] = slot_types

    public, private = _roll_projection(franchise, decade, offered)
    chosen = _always_picks(public, private)
    assert chosen == {star}, (
        f"{franchise} {decade}: the bot took {chosen - {star}} over {star} "
        "on a roll where they compete for the identical slots"
    )


def test_the_dominance_guard_fires_on_the_curry_landry_roll(index):
    """The guard is asserted directly, not only through its consequences.

    A future retune that widened the bands would still pass the test above by
    luck if the guard had quietly stopped firing; this one says the roll IS
    decisive, which is the reason no randomness may be spent on it.
    """
    public, private = _roll_projection(
        "GSW", "2010s", {"stephen-curry": ["PG", "SG"], "carl-landry": ["PG", "SG"]}
    )
    options = ThreeManWeaveBot().options(public, private)
    assert options, "the roll produced no legal option"
    assert options[0]["player_slug"] == "stephen-curry"
    assert ThreeManWeaveBot.is_dominant(options)


def test_a_star_who_cannot_legally_be_taken_is_not_forced(index):
    """The one carve-out PART 10 states: 'unless Curry would make legal
    completion impossible.'

    Here Curry fits no open slot at all, so he produces no option and the bot
    takes the only candidate it legally can -- without the guard turning an
    illegal pick into a requirement.
    """
    public, private = _roll_projection(
        "GSW",
        "2010s",
        {"stephen-curry": [], "carl-landry": ["PF"]},
        open_slots=["PF"],
    )
    options = ThreeManWeaveBot().options(public, private)
    assert {option["player_slug"] for option in options} == {"carl-landry"}
    assert _always_picks(public, private, trials=40) == {"carl-landry"}


def test_near_equivalent_candidates_are_genuinely_both_reachable(index):
    """The bot must still have an opinion rather than be a lookup table.

    Andrew Bogut (49.87) and David Lee (49.33) on the GSW 2010s roll are half a
    point apart. Choosing between them IS a judgement call, so the guard must
    NOT fire and both must appear across many draws. This is the failure mode
    in the other direction from the Landry one: a policy tightened until it
    became a maximiser would make the mode a game against arithmetic, and this
    test is what stops the fix overshooting.
    """
    public, private = _roll_projection(
        "GSW",
        "2010s",
        {"andrew-bogut": ["C"], "david-lee": ["PF"]},
        open_slots=["C", "PF"],
    )
    options = ThreeManWeaveBot().options(public, private)
    assert len(options) == 2
    assert ThreeManWeaveBot.dominant_option(options) is None, (
        "half a PEAK3 point apart is not a decisive gap; the guard must leave "
        "this one to the bands"
    )
    assert _always_picks(public, private, trials=600) == {"andrew-bogut", "david-lee"}
