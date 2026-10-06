"""tmw_bot_v4: a strong basketball opponent with opinions, not a PEAK3 argmax.

What these tests pin, each against the policy rather than a sample of luck:

  * SEEDED CONTRACT -- the same projection and the same rng seed always give
    the same pick; the same situation under different seeds can differ.
  * TASTE -- a recognised name beats a near-equal unrecognised one more often
    than not, and a "fan" leans on recognition harder than an "analyst".
  * BOUNDS -- recognition and style can never reach past the QUALITY GATE (raw
    PEAK3 points) or the utility REGRET CAP. A star is never passed over for a
    role player because the role player is famous, or the other way around.
  * ISOLATION -- recognition is a GAME-ONLY signal: only the TMW bot and its API
    adapter may import it. Rankings, scoring, the Showdown and every other
    surface must not.
"""
from __future__ import annotations

import random
import re
from collections import Counter
from pathlib import Path

import pytest

from nba_peak.three_man_weave import bot as B
from nba_peak.three_man_weave.bot import (
    BOT_STYLES,
    SEAT_STYLES,
    ThreeManWeaveBot,
    style_for_seat,
)
from nba_peak.three_man_weave.recognition import recognition

REPO = Path(__file__).resolve().parents[2]

#: Real slugs, chosen for their recognition, not their PEAK3 scores (the
#: options below are scripted with equal scores).
FAMOUS = "james-worthy"        # recognition ~0.68
LESS_FAMOUS = "marques-johnson"  # recognition ~0.37


class _Scripted(ThreeManWeaveBot):
    def __init__(self, options: list[dict]) -> None:
        super().__init__()
        self._scripted = options

    def options(self, public: dict, private: dict) -> list[dict]:  # noqa: ARG002
        return sorted(self._scripted, key=lambda o: (-o["utility"], o["player_slug"]))


def _option(slug: str, utility: float, score: float = 70.0, slot: str = "SF", need: float = 0.0) -> dict:
    return {
        "player_slug": slug, "slot_type": slot, "utility": utility,
        "score": score, "need": need, "state": "fits_now",
    }


def _counts(bot: ThreeManWeaveBot, style: str | None, trials: int = 3000) -> Counter:
    private = {} if style is None else {"bot_style": style}
    return Counter(
        bot.decide({}, private, random.Random(f"style:{style}:{k}"))[1]["player_slug"]
        for k in range(trials)
    )


def test_recognition_reads_honors_and_is_not_a_peak3_score():
    assert recognition(FAMOUS) > recognition(LESS_FAMOUS) > 0.0
    assert recognition("michael-jordan") > 0.99
    assert recognition("kareem-abdul-jabbar") > recognition("john-stockton") > 0.5
    assert recognition("carl-landry") == 0.0


def test_the_same_seed_always_gives_the_same_pick():
    bot = _Scripted([_option(FAMOUS, 1.0), _option(LESS_FAMOUS, 0.99), _option("carl-landry", 0.98)])
    picks = {bot.decide({}, {"bot_style": "fan"}, random.Random("same-seed"))[1]["player_slug"] for _ in range(20)}
    assert len(picks) == 1


def test_the_same_situation_under_different_seeds_is_not_one_pick():
    bot = _Scripted([_option("a-player", 1.0), _option("b-player", 0.99), _option("c-player", 0.97)])
    counts = _counts(bot, "balanced", trials=600)
    assert len(counts) == 3
    # Still an ordered opinion: the best option is the most likely one.
    assert counts.most_common(1)[0][0] == "a-player"


def test_a_recognised_name_wins_a_near_equal_call_more_often():
    bot = _Scripted([_option(LESS_FAMOUS, 1.0), _option(FAMOUS, 1.0)])
    for style in ("balanced", "fan", "builder"):
        counts = _counts(bot, style)
        assert counts[FAMOUS] > counts[LESS_FAMOUS], (style, counts)


def test_a_fan_leans_on_recognition_harder_than_an_analyst():
    bot = _Scripted([_option(LESS_FAMOUS, 1.0), _option(FAMOUS, 0.99)])
    assert _counts(bot, "fan")[FAMOUS] > _counts(bot, "analyst")[FAMOUS]


def test_a_builder_leans_on_roster_need_harder_than_an_analyst():
    bot = _Scripted([_option("a-player", 1.0, need=0.0), _option("b-player", 0.99, need=0.35, slot="C")])
    assert _counts(bot, "builder")["b-player"] > _counts(bot, "analyst")["b-player"]


def test_recognition_never_reaches_past_the_quality_gate():
    # Famous, but more than the gate's 12 PEAK3 points behind on this roll.
    gap = B._MAX_QUALITY_REGRET_POINTS + 1.0
    bot = _Scripted([_option("carl-landry", 1.0, score=80.0), _option("michael-jordan", 0.99, score=80.0 - gap)])
    for style in BOT_STYLES:
        assert set(_counts(bot, style, trials=400)) == {"carl-landry"}, style


def test_recognition_never_reaches_past_the_regret_cap():
    behind = B._MILD_DEVIATION_REGRET + 0.02
    bot = _Scripted([_option("carl-landry", 1.0), _option("michael-jordan", 1.0 - behind)])
    for style in BOT_STYLES:
        assert set(_counts(bot, style, trials=400)) == {"carl-landry"}, style


def test_a_forced_pick_consumes_no_randomness():
    bot = _Scripted([_option(FAMOUS, 1.0, score=90.0), _option(LESS_FAMOUS, 0.9, score=60.0)])

    class _NoRandom(random.Random):
        def random(self):  # pragma: no cover - must not be called
            raise AssertionError("a dominant pick drew a random number")

    assert bot.decide({}, {"bot_style": "fan"}, _NoRandom())[1]["player_slug"] == FAMOUS


def test_styles_are_seeded_per_seat_and_cover_all_three():
    assert style_for_seat(123, 1) == style_for_seat(123, 1)
    dealt = {style_for_seat(seed, seat) for seed in range(60) for seat in (1, 2)}
    assert dealt == set(SEAT_STYLES)


def test_style_never_changes_how_hard_a_decision_looks():
    bot = _Scripted([_option(FAMOUS, 1.0), _option(LESS_FAMOUS, 0.99), _option("carl-landry", 0.95)])
    looks = {bot.deliberation({}, {"bot_style": style}) for style in BOT_STYLES}
    assert len(looks) == 1


#: The ONLY modules allowed to import the game-only recognition layer.
_ALLOWED_IMPORTERS = {
    "nba_peak/three_man_weave/bot.py",
    "apps/api/app/services/three_man_weave/mode.py",
}


@pytest.mark.parametrize("root", ["nba_peak", "apps/api/app", "scripts", "peak3.py"])
def test_recognition_is_imported_only_by_the_tmw_bot(root):
    pattern = re.compile(r"three_man_weave(\.|\s+import\s+)recognition|from\s+\.recognition")
    base = REPO / root
    files = [base] if base.is_file() else list(base.rglob("*.py"))
    offenders = [
        str(path.relative_to(REPO))
        for path in files
        if pattern.search(path.read_text(errors="ignore"))
        and str(path.relative_to(REPO)) not in _ALLOWED_IMPORTERS
    ]
    assert offenders == []
