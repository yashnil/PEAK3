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
#:
#: v3 CLOSED THE PASS EXPLOIT AND BOUNDED THE MARKET. In v2 a participant could
#: pass on an unbid candidate forever at no cost, so the dominant strategy was
#: to let the opponent fill their roster and then skip until five elite players
#: happened along and buy each for $1. v3 gives every seat FIVE market-skip
#: tokens, ends the standard market at 24 lots, and runs a bounded Closeout
#: Market after it. An in-flight v2 snapshot has no skip counters and no market
#: phase, so it is refused rather than reinterpreted.
RULESET_VERSION: Final[str] = "twenty_dollar_v3"

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
#: v3 values a candidate by MARGINAL ROSTER IMPROVEMENT rather than by an
#: undifferentiated fair share, so a redundant or modest player is discounted
#: and a scarce upgrade earns a premium. See `bot.py`.
BOT_POLICY_VERSION: Final[str] = "twenty_dollar_bot_v3"

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

#: How many lots the STANDARD market runs for.
#:
#: Ten acquisitions fill both rosters, so 24 lots is well over double what a
#: decisive match needs -- long enough that reaching the end means both seats
#: genuinely declined a lot of players, short enough that a match is a session
#: rather than an evening. Candidate generation in this phase is INDEPENDENT of
#: either roster's missing positions (see `state._available_candidates`).
STANDARD_MARKET_LOTS: Final[int] = 24

#: The hard ceiling on total lots, standard plus closeout.
#:
#: This is what makes termination a PROOF rather than a hope. Reaching it
#: auto-fills whatever remains, so no sequence of passes can walk the pool, and
#: the calibration suite asserts no seeded match ever gets here.
HARD_MAX_LOTS: Final[int] = 36

#: Kept under its old names so a caller that talks about "rounds" still reads.
#: One lot is one candidate put up for auction.
MAX_ROUNDS: Final[int] = HARD_MAX_LOTS
MAX_LOTS: Final[int] = HARD_MAX_LOTS

#: The two market phases. Named rather than inferred from `lot_index`, because
#: the UI must be able to say which one it is in and a test must be able to
#: assert on it.
MARKET_STANDARD: Final[str] = "standard"
MARKET_CLOSEOUT: Final[str] = "closeout"


# ---------------------------------------------------------------------------
# The skip economy
# ---------------------------------------------------------------------------

#: How many VOLUNTARY passes on an unbid, legally-fitting candidate a seat gets
#: for the whole match.
#:
#: THE EXPLOIT THIS CLOSES. Without a cost, passing on an unbid candidate is
#: free and unlimited, so the optimal line is: never open, let the opponent
#: spend, and keep skipping until five elite players appear -- each of which
#: you then take for $1 because nobody is left to bid. That is not a
#: judgement, it is a wait, and it beat every honest strategy.
#:
#: Five is deliberately generous relative to the five slots a roster needs: a
#: player can decline one candidate per slot they still have to fill and still
#: never be forced. Running out means you declined more players than you have
#: roster spots, which is the behaviour the cost is aimed at.
MARKET_SKIPS_PER_SEAT: Final[int] = 5

#: Skips do NOT replenish, in either market phase. Stated as a constant so the
#: rule is greppable rather than an absence of code.
MARKET_SKIPS_REPLENISH: Final[bool] = False

#: Within how many closeout lots an incomplete roster is GUARANTEED at least
#: one legally fitting candidate. See `state._closeout_priority_seat`: the
#: guarantee is met by redrawing for the seat that has waited longest, never by
#: making every closeout candidate match a missing position.
CLOSEOUT_FIT_GUARANTEE_LOTS: Final[int] = 3

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
