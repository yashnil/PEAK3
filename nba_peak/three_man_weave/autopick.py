"""Deterministic auto-pick for a timed-out turn.

A PURE FUNCTION OF (state, seed)
---------------------------------
`auto_pick` reads only the state it is given and a named RNG stream derived
from the match seed. It performs no I/O, consults no clock, and touches no
global. That is the property the platform layer needs to resolve a
timeout/action race safely: when a timer fires at the same moment a player
submits, the platform can compute the auto-pick, compare it against the
submitted action, and commit EXACTLY ONE of them -- and any node in the system
that recomputes the auto-pick later gets the same answer, so the decision is
auditable rather than whichever-worker-won.

The RNG is used ONLY to break an exact tie between equally-scored identities.
It is drawn from `config.stream_rng(seed, "autopick:<turn_index>")`, a named
stream per turn, so adding a future stream cannot shift the auto-picks a
recorded match already made.

THE POLICY, AND WHY IT IS NOT "BEST AVAILABLE"
-----------------------------------------------
It used to be best available: rank every legal pick by its scoring card and
take the top one. The surface said so in as many words -- "Timeout drafts the
best available player for you" -- and that sentence is an instruction, not a
warning. A player who knows nothing about the 1994 Spurs got the highest-rated
Spur on the board by doing nothing at all, while a player who knew the roster
had to find that same player inside 45 seconds and could only match it. Doing
nothing was never worse and was sometimes better, which makes the timer a
strategy rather than a penalty.

The replacement is a LEGAL FALLBACK, deliberately below what an engaged player
would take:

  1. Consider only legal picks for this seat (on the roll, undrafted, fitting
     an open slot) -- `draft.legal_picks` already applies the identity lock,
     and its slots are season-anchored, so a fallback can never place someone
     where their card does not support it.
  2. Split them into picks that leave EVERY roster in the match still
     completable and picks that do not. A timeout must not strand the match.
  3. Among the completability-preserving picks, rank by scoring card and keep
     only the LOWER-VALUE HALF -- `ceil(n/2)` of them, so a two-option pool
     still has one to draw from and a one-option pool still resolves.
  4. Draw from that half with the turn's seeded RNG. Deterministic from
     (match seed, turn index), so a refresh, a retry or a second sweep
     recomputes the identical answer and cannot reroll it.
  5. If nothing preserves completability, take the LOWEST-valued legal option
     rather than the highest. The match still advances -- refusing to act
     would stall it outright -- and the seat that stopped playing still does
     not profit from it.
  6. Choose the slot the same way as before: among that identity's legal open
     slots, prefer ones that keep the match completable, then take the first
     in canonical `SLOT_TYPES` order.

WHAT THIS GUARANTEES. Expected lineup value from timing out is bounded above
by the median of the legal pool, while active play and the practice bots both
select from the top of it. `tests/three_man_weave/test_autopick.py` asserts the
gap over thousands of seeded states rather than trusting the argument.

The scoring card is still read here, because "the lower-value half" has to be
measured against something and the roster is graded on exactly that number.
Nothing about the ordering is published before the timeout fires.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from nba_peak.three_man_weave.config import AUTOPICK_VERSION, SLOT_TYPES, stream_rng
from nba_peak.three_man_weave.draft import DraftState, legal_picks, undrafted_pool
from nba_peak.three_man_weave.eligibility import EligibilityIndex
from nba_peak.three_man_weave.feasibility import can_fill_open_slots


@dataclass(frozen=True)
class AutoPick:
    """The selection a timeout would commit, plus why."""

    autopick_version: str
    seat_index: int
    round_number: int
    player_slug: str
    slot_type: str
    scoring_score: Optional[float]
    preserved_completability: bool

    def as_dict(self) -> dict:
        return {
            "autopick_version": self.autopick_version,
            "seat_index": self.seat_index,
            "round_number": self.round_number,
            "player_slug": self.player_slug,
            "slot_type": self.slot_type,
            "scoring_score": self.scoring_score,
            "preserved_completability": self.preserved_completability,
        }


def _still_completable(
    state: DraftState,
    index: EligibilityIndex,
    seat_index: int,
    player_slug: str,
    slot_type: str,
) -> bool:
    """Would every seat still be able to finish, if this pick were made?"""
    open_slots = {
        roster.seat_index: tuple(
            slot
            for slot in roster.open_slots()
            if not (roster.seat_index == seat_index and slot == slot_type)
        )
        for roster in state.rosters
    }
    pool = [slug for slug in undrafted_pool(state, index) if slug != player_slug]
    return can_fill_open_slots(open_slots, pool, state.slot_rights(index, include_pool=True))


def auto_pick(
    state: DraftState,
    index: EligibilityIndex,
    seed: Optional[int] = None,
) -> Optional[AutoPick]:
    """The pick a timeout should commit for the current seat, or None.

    None means there is genuinely nothing legal to take -- the platform layer
    must treat that as an error condition in its own right, never as "skip
    the turn silently", because roll feasibility is supposed to have made it
    impossible.
    """
    seat = state.current_seat
    round_number = state.current_round
    if seat is None or round_number is None or state.current_roll is None:
        return None

    options = legal_picks(state, index, seat)
    if not options:
        return None

    match_seed = state.match_seed if seed is None else seed
    rng = stream_rng(match_seed, f"autopick:{state.turn_index}")
    decade = state.current_roll.decade
    franchise_id = state.current_roll.franchise_id

    def score_of(slug: str) -> float:
        # The card for THIS roll's franchise and decade -- the same card the
        # roster will actually be graded on. Ranking on a decade-wide best
        # would rank a candidate on a season they will never be scored for.
        card = index.scoring_card(slug, franchise_id, decade)
        return card.prime_score if card is not None else float("-inf")

    # One RNG draw per candidate, consumed in sorted order so the sequence
    # depends only on (state, seed) -- never on dict iteration order.
    jitter = {slug: rng.random() for slug in sorted(options)}

    # ASCENDING. The fallback is drawn from the bottom of the board, so the
    # total order is built bottom-first and every tie is still broken by the
    # seeded jitter and then by slug.
    ranked = sorted(options, key=lambda slug: (score_of(slug), jitter[slug], slug))

    # Which options keep every roster completable, and at which slot. Computed
    # once here rather than inside the ranking, because it is the expensive
    # part and the ranking has to see the whole pool either way.
    preserving: list[tuple[str, str]] = []
    for slug in ranked:
        for slot in sorted(options[slug], key=SLOT_TYPES.index):
            if _still_completable(state, index, seat, slug, slot):
                preserving.append((slug, slot))
                break

    def built(slug: str, slot: str, preserved: bool) -> AutoPick:
        return AutoPick(
            autopick_version=AUTOPICK_VERSION,
            seat_index=seat,
            round_number=round_number,
            player_slug=slug,
            slot_type=slot,
            scoring_score=score_of(slug),
            preserved_completability=preserved,
        )

    if preserving:
        # THE LOWER-VALUE HALF, rounded UP so a pool of one or two still has
        # something to draw from. `preserving` is already ascending, so this is
        # a prefix rather than a re-sort.
        half = max(1, (len(preserving) + 1) // 2)
        slug, slot = preserving[rng.randrange(half)]
        return built(slug, slot, True)

    # Nothing preserves completability: the match is already cornered. Take the
    # LOWEST legal option so a seat that stopped playing still gains nothing,
    # and let the match advance rather than stall.
    for slug in ranked:
        slots = sorted(options[slug], key=SLOT_TYPES.index)
        if slots:
            return built(slug, slots[0], False)
    return None


__all__ = ["AutoPick", "auto_pick"]
