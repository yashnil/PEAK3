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

THE POLICY
----------
Best available, feasibility-first:

  1. Consider only legal picks for this seat (on the roll, undrafted, fitting
     an open slot) -- `draft.legal_picks` already applies the identity lock.
  2. Prefer picks that leave every roster in the match still completable. A
     timed-out player must not be handed a choice that strands the match; if
     no pick preserves completability the constraint is dropped rather than
     failing to pick at all, because refusing to act would stall the match
     outright.
  3. Rank by the identity's scoring card for the drafted decade, highest
     first. This is the number the roster is actually scored on, so "best
     available" means best by the game's own measure rather than by a
     separate heuristic.
  4. Break exact ties with the seeded RNG, then by slug for total order.
  5. Choose the slot the same way: among that identity's legal open slots,
     prefer ones that keep the match completable, then take the first in
     canonical `SLOT_TYPES` order.
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
    return can_fill_open_slots(open_slots, pool)


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

    options = legal_picks(state, seat)
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

    ranked = sorted(
        options,
        key=lambda slug: (-score_of(slug), jitter[slug], slug),
    )

    fallback: Optional[AutoPick] = None
    for slug in ranked:
        slots = sorted(options[slug], key=SLOT_TYPES.index)
        for slot in slots:
            if _still_completable(state, index, seat, slug, slot):
                return AutoPick(
                    autopick_version=AUTOPICK_VERSION,
                    seat_index=seat,
                    round_number=round_number,
                    player_slug=slug,
                    slot_type=slot,
                    scoring_score=score_of(slug),
                    preserved_completability=True,
                )
        if fallback is None and slots:
            # Remember the best-ranked pick even though it strands someone, so
            # a match that has already painted itself into a corner still
            # advances instead of stalling on the timeout.
            fallback = AutoPick(
                autopick_version=AUTOPICK_VERSION,
                seat_index=seat,
                round_number=round_number,
                player_slug=slug,
                slot_type=slots[0],
                scoring_score=score_of(slug),
                preserved_completability=False,
            )
    return fallback


__all__ = ["AutoPick", "auto_pick"]
