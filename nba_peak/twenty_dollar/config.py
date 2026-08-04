"""Constants and versions for The $20 Showdown.

Every number a rule depends on lives here, so a balance change is one diff in
one file rather than a hunt through the state machine. The three version
strings are pinned onto a match at creation and refused rather than
reinterpreted if they have moved -- the same discipline
`nba_peak/run_the_table/config.py` uses.
"""
from __future__ import annotations

from typing import Final

# ---------------------------------------------------------------------------
# Versions
# ---------------------------------------------------------------------------

#: The mode identifier. Lower snake_case, constrained by `arena_matches.mode`.
MODE_ID: Final[str] = "twenty_dollar"

#: Bumping this invalidates in-flight matches rather than reinterpreting them.
RULESET_VERSION: Final[str] = "twenty_dollar_v1"

#: Which PEAK3 scoring model the board speaks.
#:
#: peak3_v1, deliberately and not by default-inheritance. Two independent
#: reasons, both verified rather than assumed:
#:
#:   1. v1 and v2 disagree about the board. 24 of the 1000 published 1Y rows
#:      differ between them and Jokic moves from rank 5 to rank 6, so an
#:      unpinned regeneration would silently rescore an already-settled
#:      auction.
#:   2. v2 cannot be rebuilt from this repository. Its source parquet
#:      (`cache/processed/scored_1980_2026.v2.parquet`) is gitignored at
#:      `.gitignore:14`, while v1's is committed via the negation patterns at
#:      `.gitignore:15-18`. A competitive mode must not depend on an artifact
#:      no one can reproduce or audit.
#:
#: This is ALSO stamped into the match snapshot at creation, not merely read
#: from `ArenaMatch.model_version` at request time, so a settled match carries
#: its own provenance and a later default change cannot rewrite its history.
MODEL_VERSION: Final[str] = "peak3_v1"

#: The bot policy shipped with this mode. Pinned onto a seat so a later
#: recalibration cannot retroactively change what a settled rated match was
#: played against.
BOT_POLICY_VERSION: Final[str] = "twenty_dollar_bot_v1"


# ---------------------------------------------------------------------------
# Board shape
# ---------------------------------------------------------------------------

SEAT_COUNT: Final[int] = 2

#: The five position-anchored slots. Order is display order and is also the
#: order `feasibility` reports a stranding in, so it is stable on purpose.
SLOTS: Final[tuple[str, ...]] = ("PG", "SG", "SF", "PF", "C")

ROSTER_SIZE: Final[int] = len(SLOTS)

#: Whole dollars. Integer arithmetic throughout -- a sealed-bid auction
#: compared with floats would let two "equal" bids differ by 1e-16 and route to
#: the tie-break by accident.
STARTING_BUDGET: Final[int] = 20

#: Every unfilled slot must still be affordable after a purchase. See
#: `rules.max_legal_bid` for the exact statement and the worked example.
MIN_RESERVE_PER_SLOT: Final[int] = 1


# ---------------------------------------------------------------------------
# Clock
# ---------------------------------------------------------------------------

#: One shared deadline for both seats, because a sealed-bid round is
#: simultaneous. The foundation stores it on `arena_turns.deadline_at` and
#: enforces it; this mode never computes a deadline itself.
TURN_SECONDS: Final[float] = 30.0

#: A seat that reaches the deadline without locking is treated as having bid
#: zero -- i.e. passed. Never as a forfeit: a slow connection must not cost a
#: roster slot, and an auction where timing out is worse than passing would
#: make latency part of the strategy.
TIMEOUT_BID: Final[int] = 0


# ---------------------------------------------------------------------------
# Termination
# ---------------------------------------------------------------------------

#: Hard ceiling on candidates offered before the remaining slots are filled
#: deterministically. This is what makes termination a proof rather than a
#: hope: two participants who both pass forever would otherwise walk the pool.
#:
#: Generous relative to the 10 acquisitions a full match needs, so reaching it
#: means both seats were genuinely refusing to buy rather than that the cap was
#: tight.
MAX_ROUNDS: Final[int] = 60

#: What an auto-filled slot costs its owner. One dollar, which the reserve rule
#: guarantees is always available: a seat with `k` unfilled slots is holding at
#: least `k` dollars by construction (see `rules.max_legal_bid`).
AUTOFILL_PRICE: Final[int] = 1


# ---------------------------------------------------------------------------
# Candidate pool
# ---------------------------------------------------------------------------

#: Which published window the cards come from. One row per player, already
#: deduplicated to that player's best 1Y window by the generator.
POOL_WINDOW: Final[str] = "1y"

#: The five official weighted contributions carried by a published 1Y row.
#:
#: FIVE, NOT SIX. `top_1000_peaks.v1.json` does not carry
#: `teammate_adjustment`, which the canonical 250-pool `data/web` records do.
#: That is a real difference in the artifact, not an omission here, and the
#: receipt states it in words rather than silently rendering five where the
#: house convention shows six -- see `receipt.component_disclosure`.
#:
#: Long field names, deliberately: the components dict uses
#: `individual_recognition` / `postseason_individual_value`, while the WEIGHTS
#: dict in metadata.json uses the short forms `recognition` / `postseason`.
#: Crossing them yields a KeyError at best and a wrong number at worst.
COMPONENT_FIELDS: Final[tuple[str, ...]] = (
    "statistical_impact",
    "traditional_production",
    "individual_recognition",
    "postseason_individual_value",
    "team_achievement",
)

#: Present in the canonical 250-pool but absent from this board.
ABSENT_COMPONENT_FIELDS: Final[tuple[str, ...]] = ("teammate_adjustment",)


def version_tuple() -> dict[str, str]:
    """The three strings pinned onto every match at creation."""
    return {
        "ruleset_version": RULESET_VERSION,
        "model_version": MODEL_VERSION,
        "bot_policy_version": BOT_POLICY_VERSION,
    }
