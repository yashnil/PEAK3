"""Shared fixtures for the THREE-MAN WEAVE engine tests.

The real committed data is used throughout -- there is no fixture that fakes
the eligibility universe, because the properties worth testing here (Kawhi is
a legal Raptors x 2010s pick, Shaq cannot play small forward) are claims about
that data and are worthless against a synthetic stand-in. Synthetic inputs
appear only where a hand-computed expected value is needed, in which case they
are built inline in the test that needs them.
"""
from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest

_repo_root = Path(__file__).resolve().parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak.three_man_weave import draft as D  # noqa: E402
from nba_peak.three_man_weave import feasibility as F  # noqa: E402
from nba_peak.three_man_weave.autopick import auto_pick  # noqa: E402
from nba_peak.three_man_weave.config import stream_rng  # noqa: E402
from nba_peak.three_man_weave.eligibility import get_index  # noqa: E402


@pytest.fixture(scope="session")
def index():
    """The real franchise x decade eligibility index. Process-cached, cheap."""
    return get_index()


@pytest.fixture
def rng():
    return random.Random(20260803)


def play_match(index, seed: int):
    """Drive a whole match to completion under the deterministic auto-pick.

    Returns the final `DraftState`. Every roll is drawn through the real
    feasibility gate, so a match that completes is also evidence that the
    gate never painted itself into a corner.
    """
    state = D.create_match(seed)
    roll_rng = stream_rng(seed, "rolls")
    while not state.is_complete:
        if state.current_roll is None or state.current_roll.round_number != state.current_round:
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
        pick = auto_pick(state, index)
        assert pick is not None, f"no legal auto-pick at turn {state.turn_index}"
        state = D.apply_pick(state, pick.player_slug, pick.slot_type)
    return state


@pytest.fixture(scope="session")
def match_driver():
    return play_match


@pytest.fixture(scope="session")
def completed_match(index):
    """One fully-drafted match, reused by the tests that only need a result."""
    return play_match(index, 20260803)
