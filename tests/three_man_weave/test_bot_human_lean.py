"""The Three-Man Weave bot's game-feel pass 5 additions.

  * DELIBERATION -- how hard a decision LOOKS, which shapes how long a bot seat
    appears to think. Presentation only: it must never change what is picked.
  * THE ONE-CONSTRAINT DRAFTER'S LEAN -- in a Franchise or Decade Draft the bot
    weighs roster construction (no third big on a close call). (Recognition
    moved to every draft's taste in tmw_bot_v4: see `test_bot_style.py`.)

No player is named in the policy, and none is named here: the slugs these
tests need are found from the committed index by position.
"""
from __future__ import annotations

import random
from collections import Counter

import pytest

from nba_peak.three_man_weave import bot as B
from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import variants as V
from nba_peak.three_man_weave.bot import ThreeManWeaveBot, natural_group
from nba_peak.three_man_weave.recognition import recognition


def _projection(state: D.DraftState, index, seat: int) -> tuple[dict, dict]:
    """The fields `ThreeManWeaveBot.options` reads, as the mode projects them."""
    roll = state.current_roll
    assert roll is not None
    drafted = state.drafted_identities()
    fits = D.candidate_fits(state, index, seat)
    roster = state.roster(seat)
    public = {
        "current_roll": {
            **roll.as_dict(),
            "candidates": [{"player_slug": slug} for slug in roll.eligible_slugs if slug not in drafted],
        },
        "constraint": state.constraint.public_dict() if state.constraint is not None else None,
    }
    private = {
        "open_slots": list(roster.open_slots()),
        "assignment": {slot: (pick.player_slug if pick else None) for slot, pick in roster.slots.items()},
        "candidate_fits": {slug: fit.as_dict() for slug, fit in fits.items()},
    }
    return public, private


def _drive_variant(index, kind: str, seed: int, bot: ThreeManWeaveBot, on_turn=None) -> D.DraftState:
    state = D.create_match(seed, constraint=V.choose_constraint(kind, seed))
    while not state.is_complete:
        if state.current_roll is None:
            state = D.set_roll(
                state, V.constraint_roll(state.constraint, state.current_round, state.drafted_identities())
            )
        seat = state.current_seat
        public, private = _projection(state, index, seat)
        decision = bot.decide(public, private, random.Random(f"lean:{seed}:{state.turn_index}"))
        assert decision is not None, f"{kind} seed {seed}: the bot had no legal move"
        _command, payload = decision
        if on_turn is not None:
            on_turn(public, private, payload)
        state = D.apply_pick(
            state,
            index,
            payload["player_slug"],
            payload["slot_type"],
            seat_index=seat,
            placements=payload.get("placements"),
        )
    return state


class _Scripted(ThreeManWeaveBot):
    """A bot whose ranked options are given, for exercising `deliberation`."""

    def __init__(self, options: list[dict]) -> None:
        super().__init__()
        self._scripted = options

    def options(self, public: dict, private: dict) -> list[dict]:  # noqa: ARG002
        return sorted(self._scripted, key=lambda o: -o["utility"])


def _option(slug: str, slot: str, utility: float, score: float = 80.0) -> dict:
    return {"player_slug": slug, "slot_type": slot, "utility": utility, "score": score, "state": "fits_now"}


# ---------------------------------------------------------------------------
# Deliberation
# ---------------------------------------------------------------------------


def test_a_pick_the_quality_gate_forces_looks_obvious():
    # One star, everyone else more than the gate behind: nothing to weigh.
    bot = _Scripted([_option("star", "PG", 1.4, 95.0), _option("role", "PG", 0.5, 60.0)])
    assert bot.deliberation({}, {}) == pytest.approx(0.05)


def test_a_close_call_looks_harder_than_a_clear_one():
    clear = _Scripted([_option("a", "PG", 1.00), _option("b", "SG", 0.70), _option("c", "SF", 0.60)])
    close = _Scripted([_option("a", "PG", 1.00), _option("b", "SG", 0.99), _option("c", "SF", 0.97)])
    assert close.deliberation({}, {}) > clear.deliberation({}, {}) + 0.4
    assert 0.0 <= clear.deliberation({}, {}) <= 1.0
    assert 0.0 <= close.deliberation({}, {}) <= 1.0


def test_contenders_spread_across_slots_look_harder_than_one_slot():
    one_slot = _Scripted([_option("a", "C", 1.00), _option("b", "C", 0.98), _option("c", "C", 0.97)])
    many_slots = _Scripted([_option("a", "C", 1.00), _option("b", "PG", 0.98), _option("c", "SF", 0.97)])
    assert many_slots.deliberation({}, {}) > one_slot.deliberation({}, {})


def test_deliberation_never_changes_the_decision(index):
    """Presentation only: asking how hard a board looks consumes no randomness
    and leaves the pick exactly as it was."""
    kind = V.VARIANT_DECADE
    state = D.create_match(11, constraint=V.choose_constraint(kind, 11))
    state = D.set_roll(state, V.constraint_roll(state.constraint, 1, frozenset()))
    public, private = _projection(state, index, state.current_seat)
    bot = ThreeManWeaveBot()
    before = bot.decide(public, private, random.Random("same"))
    bot.deliberation(public, private)
    after = bot.decide(public, private, random.Random("same"))
    assert before == after


# ---------------------------------------------------------------------------
# The one-constraint drafter's lean
# ---------------------------------------------------------------------------


def _slug_in_group(index, group: str) -> str:
    for slug in sorted(index._names):  # noqa: SLF001 - read-only lookup for a test subject
        if natural_group(slug) == group and recognition(slug) == 0.0:
            return slug
    raise AssertionError(f"no {group} in the index")


def test_natural_groups_are_derived_from_positions_not_names(index):
    big = _slug_in_group(index, "big")
    guard = _slug_in_group(index, "guard")
    assert natural_group(big) == "big"
    assert natural_group(guard) == "guard"
    assert natural_group(None) is None


def test_a_third_big_is_marked_down_and_a_missing_group_marked_up(index):
    big = _slug_in_group(index, "big")
    guard = _slug_in_group(index, "guard")
    two_bigs = Counter({"big": 2})
    assert ThreeManWeaveBot._drafter_lean(big, two_bigs, 2) < ThreeManWeaveBot._drafter_lean(big, Counter(), 2)
    assert ThreeManWeaveBot._drafter_lean(guard, two_bigs, 2) > ThreeManWeaveBot._drafter_lean(guard, Counter({"guard": 1}), 2)
    # Small on purpose: every term is a fraction of the roll's quality scale.
    assert abs(ThreeManWeaveBot._drafter_lean(big, Counter({"big": 3}), 3)) < 0.25


def test_recognition_is_bounded_and_unknown_players_read_zero(index):
    ids = {slug for (slug, _f, _d) in index._scoring}  # noqa: SLF001 - read-only
    values = [recognition(slug) for slug in ids]
    assert all(0.0 <= value < 1.0 for value in values)
    assert max(values) > 0.95
    assert recognition("not-a-player") == 0.0
    assert recognition(None) == 0.0


def test_the_lean_applies_only_to_a_one_constraint_draft(index, monkeypatch):
    """With the lean switched off, a variant's utilities move and a standard
    roll's do not -- the standard game's utility is untouched by it. Captured
    after the drafter has two picks, when the roster-construction lean speaks."""
    from nba_peak.three_man_weave import feasibility as F
    from nba_peak.three_man_weave.config import stream_rng

    def utilities(public, private):
        return {(o["player_slug"], o["slot_type"]): o["utility"] for o in ThreeManWeaveBot().options(public, private)}

    views: list = []

    def capture(public, private, _payload):
        if len([s for s in (private.get("assignment") or {}).values() if s]) >= 2:
            views.append((public, private))

    _drive_variant(index, V.VARIANT_DECADE, 5, ThreeManWeaveBot(), on_turn=capture)
    assert views

    standard = D.create_match(5)
    roll = F.roll_next(index, standard.rosters, frozenset(), 1, stream_rng(5, "rolls"), frozenset())
    standard = D.set_roll(standard, roll)
    standard_view = _projection(standard, index, standard.current_seat)

    leaning = [utilities(*view) for view in views]
    leaning_standard = utilities(*standard_view)
    monkeypatch.setattr(ThreeManWeaveBot, "_drafter_lean", staticmethod(lambda *_args: 0.0))
    plain = [utilities(*view) for view in views]
    plain_standard = utilities(*standard_view)

    assert any(
        abs(lean[key] - flat[key]) > 1e-9 for lean, flat in zip(leaning, plain) for key in lean
    )
    assert leaning_standard == plain_standard and leaning_standard


@pytest.mark.parametrize("kind", [V.VARIANT_FRANCHISE, V.VARIANT_DECADE])
def test_a_leaning_variant_bot_is_still_never_a_catastrophe(index, kind):
    """The quality gate runs on raw scores before any lean: no variant pick is
    ever more than `_MAX_QUALITY_REGRET_POINTS` behind the best legal player,
    and the bot still takes its top option most of the time."""
    bot = ThreeManWeaveBot()
    top, turns, worst = 0, 0, 0.0

    def check(public, private, payload):
        nonlocal top, turns, worst
        options = bot.options(public, private)
        chosen = next(
            o for o in options if o["player_slug"] == payload["player_slug"] and o["slot_type"] == payload["slot_type"]
        )
        worst = max(worst, max(o["score"] for o in options) - chosen["score"])
        turns += 1
        top += chosen is ThreeManWeaveBot.viable_options(options)[0]

    for seed in range(3):
        state = _drive_variant(index, kind, seed, bot, on_turn=check)
        assert all(roster.is_complete() for roster in state.rosters)
    assert worst <= B._MAX_QUALITY_REGRET_POINTS + 1e-9, worst
    # v4 (deliberately less predictable): the best option is still the single
    # most likely pick, now ~0.6-0.7 of variant turns rather than ~0.85.
    assert 0.5 <= top / turns <= 0.9, top / turns


def test_the_lean_builds_fewer_stacked_frontcourts_in_a_decade_draft(index, monkeypatch):
    """Measured, not asserted into existence: across the same seeded drafts, the
    leaning bot finishes with no more three-big rosters than the plain one.
    (Offline over 12 seeds: 6/36 with the lean, 13/36 without.)"""

    def stacked(bot_cls_patch: bool) -> int:
        if not bot_cls_patch:
            monkeypatch.setattr(ThreeManWeaveBot, "_drafter_lean", staticmethod(lambda *_args: 0.0))
        count = 0
        for seed in range(4):
            state = _drive_variant(index, V.VARIANT_DECADE, seed, ThreeManWeaveBot())
            for roster in state.rosters:
                groups = Counter(natural_group(pick.player_slug) for pick in roster.picks())
                count += groups.get("big", 0) >= 3
        monkeypatch.undo()
        return count

    with_lean = stacked(True)
    without_lean = stacked(False)
    assert with_lean <= without_lean, (with_lean, without_lean)
