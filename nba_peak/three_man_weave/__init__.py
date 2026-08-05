"""THREE-MAN WEAVE — 3-player franchise x decade snake draft (game-logic core).

This package is a PURE, DETERMINISTIC, SERVER-SIDE LIBRARY. It has no database
access, no FastAPI, no client state and no I/O beyond reading committed data
files. Every function takes its inputs explicitly and returns a result; every
random choice comes from a `random.Random` the caller passes in. The
multiplayer platform layer (match/seat/turn/timer/idempotency) drives this
library -- it is never driven from here.

The three pieces the game is built out of:

* `eligibility`  -- who may be drafted for a given franchise x decade, and
                    which season of theirs is the SCORING CARD. Eligibility
                    evidence and scoring card are deliberately separate
                    concepts (see that module's docstring).
* `positions`    -- HARD PG/SG/SF/PF/C legality. New logic: CourtBuilder's
                    own `positions.classify_fit` is explicitly display-only
                    ("Placement legality is NOT determined here", see
                    nba_peak/perfect_season/positions.py:423-425).
* `evaluation`   -- a versioned six-player adapter over the authoritative
                    `simulate_exact_season`. The evaluator itself is never
                    modified.

Plus the draft mechanics: `feasibility` (is this roll actually playable?),
`draft` (snake order + global identity lock), and `autopick` (deterministic
timeout resolution).
"""
from nba_peak.three_man_weave.config import (
    AUTOPICK_VERSION,
    BENCH_SLOT_TYPES,
    DECADES,
    ELIGIBILITY_INDEX_VERSION,
    ENGINE_VERSION,
    PARTICIPANT_COUNT,
    POSITION_LEGALITY_VERSION,
    ROSTER_SIZE,
    ROUNDS,
    RULESET_VERSION,
    SLOT_TYPES,
    STARTER_SLOT_TYPES,
    TMW_ADAPTER_VERSION,
)

__all__ = [
    "AUTOPICK_VERSION",
    "BENCH_SLOT_TYPES",
    "DECADES",
    "ELIGIBILITY_INDEX_VERSION",
    "ENGINE_VERSION",
    "PARTICIPANT_COUNT",
    "POSITION_LEGALITY_VERSION",
    "ROSTER_SIZE",
    "ROUNDS",
    "RULESET_VERSION",
    "SLOT_TYPES",
    "STARTER_SLOT_TYPES",
    "TMW_ADAPTER_VERSION",
]
