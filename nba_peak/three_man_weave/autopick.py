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

from nba_peak.three_man_weave.arrangement import FITS_AFTER_REARRANGEMENT
from nba_peak.three_man_weave.config import AUTOPICK_VERSION, SLOT_TYPES, stream_rng
from nba_peak.three_man_weave.draft import DraftState, candidate_fits, legal_picks, undrafted_pool
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
    #: A COMPLETE arrangement when the pick only fits after the seat's own
    #: roster is rearranged (the server's own plan from `candidate_fits`), or
    #: None for a direct pick.
    placements: Optional[dict[str, str]] = None

    def as_dict(self) -> dict:
        return {
            "autopick_version": self.autopick_version,
            "seat_index": self.seat_index,
            "round_number": self.round_number,
            "player_slug": self.player_slug,
            "slot_type": self.slot_type,
            "scoring_score": self.scoring_score,
            "preserved_completability": self.preserved_completability,
            "placements": dict(self.placements) if self.placements else None,
        }


def _still_completable(
    state: DraftState,
    index: EligibilityIndex,
    seat_index: int,
    player_slug: str,
    slot_type: str,
    open_after: Optional[tuple[str, ...]] = None,
) -> bool:
    """Would every seat still be able to finish, if this pick were made?

    `open_after` is the seat's open slots after a REARRANGING pick, which is
    not simply "the same open slots minus one"."""
    open_slots = {
        roster.seat_index: tuple(
            slot
            for slot in roster.open_slots()
            if not (roster.seat_index == seat_index and slot == slot_type)
        )
        for roster in state.rosters
    }
    if open_after is not None:
        open_slots[seat_index] = open_after
    pool = [slug for slug in undrafted_pool(state, index) if slug != player_slug]
    return can_fill_open_slots(open_slots, pool, state.slot_rights(index, include_pool=True))


def auto_pick_options(
    state: DraftState,
    index: EligibilityIndex,
    seed: Optional[int] = None,
) -> tuple[AutoPick, ...]:
    """Every pick a timeout may commit for the current seat, in the order it
    should try them. The first is `auto_pick`'s answer.

    WHY AN ORDER AND NOT ONE ANSWER (tmw_autopick_v2). A committed pick can
    still be refused by the reducer -- the last pick of a round must leave a
    feasible roll for the next one -- and a timeout that tried exactly one
    choice and was refused was refused again on every read, forever. The
    reducer walks this list and commits the first choice the rules accept.

    WHY REARRANGEMENT FITS ARE INCLUDED. When no candidate fits an open slot
    directly, the seat can still legally take someone by rearranging its own
    roster; `draft.round_keepers` may guarantee a seat exactly that and nothing
    more. v1 only ever looked at direct fits and returned None there.

    The ranking, the lower-value half and the seeded draw are v1's, unchanged.
    """
    seat = state.current_seat
    round_number = state.current_round
    if seat is None or round_number is None or state.current_roll is None:
        return ()

    direct = legal_picks(state, index, seat)
    plans: dict[str, dict[str, str]] = {}
    if not direct:
        for slug, fit in candidate_fits(state, index, seat).items():
            if fit.state == FITS_AFTER_REARRANGEMENT and fit.plan:
                plans[slug] = dict(fit.plan)
        if not plans:
            return ()
    options = direct or plans

    match_seed = state.match_seed if seed is None else seed
    rng = stream_rng(match_seed, f"autopick:{state.turn_index}")
    def score_of(slug: str) -> float:
        # The card this candidate would be scored on -- the rolled cell in the
        # standard game, the constraint's resolved card in a variant
        # (`DraftState.card_key`). Ranking on any other season would rank a
        # candidate on a card they will never be scored for.
        franchise_id, decade = state.card_key(slug)
        card = index.scoring_card(slug, franchise_id, decade)
        return card.prime_score if card is not None else float("-inf")

    # One RNG draw per candidate, consumed in sorted order so the sequence
    # depends only on (state, seed) -- never on dict iteration order.
    jitter = {slug: rng.random() for slug in sorted(options)}

    # ASCENDING. The fallback is drawn from the bottom of the board, so the
    # total order is built bottom-first and every tie is still broken by the
    # seeded jitter and then by slug.
    ranked = sorted(options, key=lambda slug: (score_of(slug), jitter[slug], slug))

    def landing(slug: str) -> str:
        return next(slot for slot, placed in plans[slug].items() if placed == slug)

    # Which options keep every roster completable, and at which slot.
    preserving: list[tuple[str, str]] = []
    for slug in ranked:
        if direct:
            for slot in sorted(direct[slug], key=SLOT_TYPES.index):
                if _still_completable(state, index, seat, slug, slot):
                    preserving.append((slug, slot))
                    break
        else:
            open_after = tuple(slot for slot in SLOT_TYPES if slot not in plans[slug])
            slot = landing(slug)
            if _still_completable(state, index, seat, slug, slot, open_after=open_after):
                preserving.append((slug, slot))

    def built(slug: str, slot: str, preserved: bool) -> AutoPick:
        return AutoPick(
            autopick_version=AUTOPICK_VERSION,
            seat_index=seat,
            round_number=round_number,
            player_slug=slug,
            slot_type=slot,
            scoring_score=score_of(slug),
            preserved_completability=preserved,
            placements=None if direct else plans[slug],
        )

    ordered: list[AutoPick] = []
    if preserving:
        # THE LOWER-VALUE HALF, rounded UP so a pool of one or two still has
        # something to draw from. `preserving` is already ascending, so this is
        # a prefix rather than a re-sort.
        half = max(1, (len(preserving) + 1) // 2)
        chosen = preserving[rng.randrange(half)]
        ordered.append(built(*chosen, True))
        ordered.extend(built(slug, slot, True) for slug, slot in preserving if (slug, slot) != chosen)

    # Nothing (else) preserves completability: the match is already cornered.
    # The LOWEST legal options follow, so a seat that stopped playing still
    # gains nothing, and the match advances rather than stalls.
    taken = {pick.player_slug for pick in ordered}
    for slug in ranked:
        if slug in taken:
            continue
        slot = sorted(direct[slug], key=SLOT_TYPES.index)[0] if direct else landing(slug)
        ordered.append(built(slug, slot, False))
    return tuple(ordered)


def auto_pick(
    state: DraftState,
    index: EligibilityIndex,
    seed: Optional[int] = None,
) -> Optional[AutoPick]:
    """The pick a timeout should commit for the current seat, or None.

    None means there is genuinely nothing legal to take -- the platform layer
    must treat that as an error condition in its own right, never as "skip
    the turn silently", because roll feasibility and `draft.round_keepers`
    together make it unreachable.
    """
    options = auto_pick_options(state, index, seed)
    return options[0] if options else None


__all__ = ["AutoPick", "auto_pick", "auto_pick_options"]
