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
#:
#: v2 RETIRED THE SEALED-BID AUCTION. v1 resolved a lot from two simultaneous
#: hidden bids and broke ties with a one-shot priority token. v2 is a
#: turn-based ascending auction: one seat acts at a time, every bid is public
#: the moment it is made, and sequential bidding makes a tie impossible -- so
#: the token has no job and no longer exists. The version bump is what stops an
#: in-flight v1 snapshot being reinterpreted under rules it was not played
#: under; `state.assert_supported_version` refuses it rather than guessing.
RULESET_VERSION: Final[str] = "twenty_dollar_v2"

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
BOT_POLICY_VERSION: Final[str] = "twenty_dollar_bot_v2"

#: What the product calls the house opponent. USER-FACING, and the only string
#: any surface may show. `bot_id` / `policy_version` are implementation labels
#: and leaked into the lobby once ("PEAK3 bot (random_legal_v1)"); the fix is
#: that the display name is authored here rather than derived from an id.
BOT_DISPLAY_NAME: Final[str] = "PEAK3 Bot"

#: The one difficulty this mode ships. Shown beside the name, never an id.
BOT_DIFFICULTY_LABEL: Final[str] = "Standard"


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

#: The smallest opening bid on a lot with no live bid.
MIN_OPENING_BID: Final[int] = 1

#: The smallest legal increment over a live bid. Whole dollars, so
#: `current_bid + MIN_RAISE` is the floor for the next bid.
MIN_RAISE: Final[int] = 1


# ---------------------------------------------------------------------------
# Clock
# ---------------------------------------------------------------------------

#: How long ONE SEAT's decision gets, measured from the instant the server
#: opened that seat's turn.
#:
#: PER-SEAT, NOT SHARED. v1 opened a single simultaneous turn with one deadline
#: for both seats, which is what let a lot advance while a player was still
#: reading it: the deadline had been running since before their client
#: rendered, and a seat that had never been given an actionable turn could
#: still be swept. An ascending auction has exactly one player to act at any
#: moment, so the turn names that seat and its clock starts when the turn is
#: created. The foundation stores it on `arena_turns.deadline_at` and enforces
#: it; this mode never computes a deadline itself.
TURN_SECONDS: Final[float] = 25.0

#: What an expired turn does: the ACTIVE seat passes, and nothing else moves.
#: Never a forfeit, and never applied to the seat that was not on the clock --
#: an auction where timing out cost more than passing would make latency part
#: of the strategy, and one where it passed both seats would resolve lots
#: nobody declined.
TIMEOUT_IS_PASS: Final[bool] = True


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

#: Alias kept for readability at the call sites that talk about lots rather
#: than rounds. One lot is one candidate put up for auction.
MAX_LOTS: Final[int] = MAX_ROUNDS

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

#: How deep the QUALIFIED pool goes, by published career-best 1Y rank.
#:
#: The artifact carries 1,000 players and the mode used to draw uniformly from
#: all of them, which is why a real match could turn into Greivis Vásquez
#: followed by James Donaldson: past about rank 500 the board is made of
#: players whose peak seasons most people cannot price, and a game about
#: judging peaks stops being a judgement when the names are unfamiliar. The
#: cut is a DISPLAY gate on an already-published ordering -- no score is
#: recomputed, nothing is reweighted, and the excluded rows are still in the
#: artifact.
QUALIFIED_POOL_SIZE: Final[int] = 500

#: How a lot is drawn from the qualified pool: `(first_rank, last_rank, weight)`,
#: inclusive on both ends, weights summing to 1.
#:
#: Uniform-over-500 would still have put four candidates in five outside the
#: top hundred, so the tiers exist to make stars COMMON without making the
#: board only stars: 40% of lots come from the top 100, and the bottom tier is
#: still a quarter of them so the pool stays varied across a match. Adjusted
#: only for legality -- see `state._draw_candidate`, which falls back to an
#: adjacent tier when a tier has no candidate either seat could legally win.
POOL_TIERS: Final[tuple[tuple[int, int, float], ...]] = (
    (1, 100, 0.40),
    (101, 250, 0.35),
    (251, 500, 0.25),
)

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
