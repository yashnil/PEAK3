"""Six-player adapter over the authoritative Peak Season lineup evaluator.

WHAT THIS IS
------------
`nba_peak.perfect_season.simulation.simulate_exact_season` (simulation.py:1134)
is the authoritative evaluator and is NOT modified here. This module adapts a
six-slot Three-Man Weave roster into the exact shape that function expects,
calls it, and re-presents the result with the adapter's own version stamped
alongside -- never replacing -- the evaluator's.

`simulate_exact_season` is the right entry point (not `simulate_season`):
`COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED` defaults True
(apps/api/app/core/config.py:198), so the exact-season path is the live one.
The comment at simulation.py:288-291 claiming otherwise is stale.

WHY SIX AND NOT FIVE
--------------------
The evaluator is N-agnostic -- it slices `cards[:5]` as starters and
`cards[5:]` as bench and weights whatever it finds. But `_avg([])` returns 0.0
(simulation.py:72-73), so a five-card benchless roster reports
`bench_strength == 0.0` rather than "no bench", and the `(bench_strength -
50.0) * 0.12` term silently removes about six expected wins. Six slots (five
starters + one bench) is therefore a contract, enforced here: this module
refuses to evaluate a roster that is not exactly `config.SLOT_TYPES`.

WHAT DECIDES THE MATCH: `lineup_quality`, AND WHY NOT THE OTHER TWO
--------------------------------------------------------------------
The comparator is `SimulationResult.lineup_quality` -- the weighted fit
combination the 82-0 model builds its record projection from, before the win
floor, the 82-win cap and the seeded noise. It is the model's own judgement of
lineup quality, published by the evaluator rather than recomputed here.

  * NOT `wins`, and not `expected_wins`. Both saturate: the cap is 82 and the
    generational floor is 81, so two genuinely different elite rosters tie on
    both, and `wins` additionally carries seeded noise that would let the same
    roster win or lose the same match on the board seed.

  * NOT `lineup_peak_score`. That field is a RAW MEAN of the six cards' season
    scores. It was the comparator in v1 of this adapter and it was the wrong
    one: a mean knows nothing about bench strength, positional fit, creation
    or scoring coverage or postseason pedigree, so it scored a roster with a
    centre at point guard exactly as highly as the same six men placed
    correctly. Ranking a DRAFT -- a game whose entire strategy is roster
    construction -- on a number blind to roster construction made the position
    rules decorative. It is retained on the receipt as a labelled secondary
    figure ("mean season PEAK3"), because it is true and readable, but it does
    not decide anything.

NO PROJECTED RECORD IS REPORTED
-------------------------------
`wins`/`losses`/`expected_wins` are deliberately NOT carried out of this
module. The 82-0 record projection is calibrated and presented for an
eight-card CourtBuilder roster; running it over six cards produces a number
whose relationship to that model is not something this adapter can vouch for,
and a "68-14 projected" line beside a result reads as a claim whether or not
it is labelled. The lineup-quality index it is derived FROM is reported
instead, named as an index.

UNSCORED CARDS: PREVENTED AT THE SOURCE, SURFACED AT THE BOUNDARY
------------------------------------------------------------------
`simulate_exact_season` returns `lineup_peak_score == 0.0` -- not None --
unless EVERY card is `exact_season_scored`. A 0.0 presented as a score is a
lie about a real roster, so this module never does that:

  * Prevention: `eligibility` only ever offers identities with a real scored
    season in the drafted decade, so in normal play every card is scored.
  * Surfacing: if an unscored card reaches here anyway, `score_status` is
    reported as "incomplete", `lineup_peak_score` is passed through as None
    rather than 0.0, `unscored_slots` names exactly which slots caused it,
    and `ranking_score` is None so the roster cannot be silently ranked
    against fully-scored ones. No score is ever fabricated or substituted.

A traded-season card is NOT an unscored card. It carries a real whole-season
aggregate score and reports `score_source == "exact_season_aggregate"`, which
is surfaced per card so a receipt can label it.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping, Optional, Sequence

from nba_peak.perfect_season.exact_season import PlayerSeasonCard, resolve_player_season_card
from nba_peak.perfect_season.simulation import simulate_exact_season
from nba_peak.three_man_weave.config import (
    FORMULA_VERSION,
    ROSTER_SIZE,
    SLOT_TYPES,
    STARTER_SLOT_TYPES,
    TMW_ADAPTER_VERSION,
)
from nba_peak.three_man_weave.eligibility import EligibilityIndex
from nba_peak.three_man_weave.positions import canonical_positions, validate_roster
from nba_peak.three_man_weave.schemas import DraftPick

SCORE_STATUS_COMPLETE = "complete"
SCORE_STATUS_INCOMPLETE = "incomplete"


class EvaluationError(ValueError):
    """A roster that cannot be evaluated. `code` is machine-readable."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class EvaluatedCard:
    """One placed card, as it went into the evaluator."""

    slot_type: str
    is_starter: bool
    player_slug: str
    player_name: str
    drafted_franchise_id: str
    drafted_decade: str
    season: str
    team_id: str
    team_name: str
    listed_position: Optional[str]
    canonical_positions: tuple[str, ...]
    season_score: Optional[float]
    score_status: str
    score_source: str

    def as_dict(self) -> dict:
        return {
            "slot_type": self.slot_type,
            "is_starter": self.is_starter,
            "player_slug": self.player_slug,
            "player_name": self.player_name,
            "drafted_franchise_id": self.drafted_franchise_id,
            "drafted_decade": self.drafted_decade,
            "season": self.season,
            "team_id": self.team_id,
            "team_name": self.team_name,
            "listed_position": self.listed_position,
            "canonical_positions": list(self.canonical_positions),
            "season_score": self.season_score,
            "score_status": self.score_status,
            "score_source": self.score_source,
        }


@dataclass(frozen=True)
class RosterEvaluation:
    """The full receipt for one six-player roster.

    Carries THREE version strings, deliberately: this adapter's, and both of
    the evaluator's own. A reader must be able to tell which evaluator
    produced the numbers and which adapter shaped the roster that went in --
    collapsing them would make a future change to either untraceable.
    """

    tmw_adapter_version: str
    lineup_model_version: str
    simulator_version: str
    formula_version: str

    # The comparator. None when the roster is not fully scored -- never 0.0.
    ranking_score: Optional[float]
    #: The evaluator's lineup-quality index. Identical to `ranking_score` when
    #: the roster is scoreable; named separately so a receipt can say what the
    #: number IS rather than only what it is used for.
    lineup_score: Optional[float]
    #: The mean of the six cards' season scores. SECONDARY AND LABELLED -- see
    #: the module docstring for why it is not the comparator.
    mean_season_score: Optional[float]
    score_status: str
    unscored_slots: tuple[str, ...]

    fit_components: dict[str, float]
    best_pick: Optional[str]
    #: The pick whose removal costs this roster the most lineup quality --
    #: computed by leave-one-out over the same evaluator, not asserted.
    decisive_pick: Optional[dict]
    experimental_notice: str
    cards: tuple[EvaluatedCard, ...]

    def as_dict(self) -> dict:
        return {
            "tmw_adapter_version": self.tmw_adapter_version,
            "lineup_model_version": self.lineup_model_version,
            "simulator_version": self.simulator_version,
            "formula_version": self.formula_version,
            "ranking_score": self.ranking_score,
            "lineup_score": self.lineup_score,
            "mean_season_score": self.mean_season_score,
            "score_status": self.score_status,
            "unscored_slots": list(self.unscored_slots),
            "fit_components": dict(self.fit_components),
            "best_pick": self.best_pick,
            "decisive_pick": dict(self.decisive_pick) if self.decisive_pick else None,
            "experimental_notice": self.experimental_notice,
            "cards": [card.as_dict() for card in self.cards],
        }


def resolve_scoring_season_card(
    pick: DraftPick,
    index: EligibilityIndex,
) -> PlayerSeasonCard:
    """The exact `PlayerSeasonCard` a pick is scored on.

    Two lookups, both from committed data: the eligibility index says WHICH
    season (the identity's best FOR THE DRAFTED FRANCHISE in the drafted
    decade), and `exact_season.resolve_player_season_card` produces the real
    card for it. Never a career-peak substitute -- that substitution is the
    exact bug `exact_season` was written to prevent -- and, since the ruleset
    correction, never another franchise's season either.

    THE FRANCHISE IS PASSED, NOT INFERRED. `pick.franchise_id` is the roll the
    player was taken on, so the card that comes back is the one the pick
    claimed to be. A lookup by decade alone is what let a Cleveland x 2010s
    Wade be scored on 2010-11 Miami.
    """
    scoring = index.scoring_card(pick.player_slug, pick.franchise_id, pick.decade)
    if scoring is None:
        raise EvaluationError(
            "no_scoring_card",
            f"'{pick.player_slug}' has no scored season for "
            f"{pick.franchise_id} in the {pick.decade}",
        )
    card = resolve_player_season_card(
        scoring.player_slug, scoring.resolve_team_id, scoring.season
    )
    if card is None:
        raise EvaluationError(
            "card_not_resolvable",
            f"'{scoring.player_slug}' has no real roster record for "
            f"{scoring.resolve_team_id} {scoring.season}",
        )
    return card


def _assert_evaluable(roster: Mapping[str, Optional[DraftPick]]) -> None:
    """Reject anything that is not exactly a full, legal six-slot roster."""
    unknown = [slot for slot in roster if slot not in SLOT_TYPES]
    if unknown:
        raise EvaluationError("unknown_slot", f"not roster slots: {sorted(unknown)}")

    missing = [slot for slot in SLOT_TYPES if roster.get(slot) is None]
    if missing:
        raise EvaluationError(
            "incomplete_roster",
            f"{len(missing)} slot(s) still empty: {missing}",
        )
    if len(SLOT_TYPES) != ROSTER_SIZE:  # pragma: no cover - config invariant
        raise EvaluationError("bad_config", "SLOT_TYPES and ROSTER_SIZE disagree")

    check = validate_roster({slot: pick.player_slug for slot, pick in roster.items()})
    if not check.ok:
        raise EvaluationError(check.code or "illegal_roster", check.message or "illegal roster")


def evaluate_roster(
    roster: Mapping[str, Optional[DraftPick]],
    index: EligibilityIndex,
    board_seed: int,
) -> RosterEvaluation:
    """Score one completed six-player roster.

    Deterministic: `simulate_exact_season` seeds its RNG from
    `f"{board_seed}:{card_key}"` where `card_key` is the sorted card
    identities, so the same roster and seed always produce the same result.
    """
    _assert_evaluable(roster)

    picks: list[DraftPick] = [roster[slot] for slot in SLOT_TYPES]  # type: ignore[misc]
    cards: list[PlayerSeasonCard] = [resolve_scoring_season_card(pick, index) for pick in picks]

    # `slot_types` must be index-aligned with `cards` -- that alignment is the
    # ONLY thing telling the evaluator who plays where.
    result = simulate_exact_season(cards, board_seed, list(SLOT_TYPES))

    unscored = tuple(
        slot
        for slot, card in zip(SLOT_TYPES, cards)
        if card.score_status != "exact_season_scored"
    )
    complete = not unscored

    evaluated_cards = tuple(
        EvaluatedCard(
            slot_type=slot,
            is_starter=slot in STARTER_SLOT_TYPES,
            player_slug=card.player_slug,
            player_name=card.player_name,
            drafted_franchise_id=pick.franchise_id,
            drafted_decade=pick.decade,
            season=card.season,
            team_id=card.team_id,
            team_name=card.team_name,
            listed_position=card.position,
            canonical_positions=tuple(sorted(canonical_positions(card.player_slug))),
            season_score=card.season_score,
            score_status=card.score_status,
            score_source=card.score_source,
        )
        for slot, pick, card in zip(SLOT_TYPES, picks, cards)
    )

    # `simulate_exact_season` returns 0.0, not None, for an incomplete roster.
    # Pass None through instead so a caller cannot mistake "we could not score
    # this" for "this roster scored zero".
    lineup_score = round(result.lineup_quality, 2) if complete else None
    mean_season = result.lineup_peak_score if complete else None

    return RosterEvaluation(
        tmw_adapter_version=TMW_ADAPTER_VERSION,
        lineup_model_version=result.lineup_model_version,
        simulator_version=result.simulator_version,
        formula_version=FORMULA_VERSION,
        ranking_score=lineup_score,
        lineup_score=lineup_score,
        mean_season_score=mean_season,
        score_status=SCORE_STATUS_COMPLETE if complete else SCORE_STATUS_INCOMPLETE,
        unscored_slots=unscored,
        fit_components=result.fit_components.as_dict(),
        best_pick=result.best_pick,
        decisive_pick=(
            _decisive_pick(picks, cards, board_seed) if complete else None
        ),
        experimental_notice=result.experimental_notice,
        cards=evaluated_cards,
    )


def _decisive_pick(
    picks: Sequence[DraftPick],
    cards: Sequence[PlayerSeasonCard],
    board_seed: int,
) -> Optional[dict]:
    """The pick this roster could least afford to lose, by leave-one-out.

    COMPUTED, NOT ASSERTED. For each slot, the same evaluator is re-run over
    the other five cards and the drop in `lineup_quality` is recorded; the
    largest drop wins. That makes "decisive" a measured marginal contribution
    against the model that decided the match, rather than "whoever scored
    highest" (which `best_pick` already reports and which is a different
    claim -- the best card and the load-bearing one are often not the same
    player, because fit and scarcity are part of the index and not part of a
    season score).

    Six extra evaluator calls, run once when a match settles. Never on a poll.
    """
    if len(cards) != len(SLOT_TYPES):  # pragma: no cover - caller guarantees
        return None

    full = simulate_exact_season(list(cards), board_seed, list(SLOT_TYPES)).lineup_quality

    best: Optional[dict] = None
    for index_ in range(len(cards)):
        remaining_cards = [c for i, c in enumerate(cards) if i != index_]
        remaining_slots = [s for i, s in enumerate(SLOT_TYPES) if i != index_]
        without = simulate_exact_season(
            remaining_cards, board_seed, remaining_slots
        ).lineup_quality
        drop = round(full - without, 2)
        if best is None or drop > best["lineup_quality_drop"]:
            best = {
                "slot_type": SLOT_TYPES[index_],
                "player_slug": cards[index_].player_slug,
                "player_name": cards[index_].player_name,
                "season": cards[index_].season,
                "team_id": cards[index_].team_id,
                "round_number": picks[index_].round_number,
                "lineup_quality_drop": drop,
            }
    return best


# ---------------------------------------------------------------------------
# The live edge: an ORDINAL reading of an unfinished draft
# ---------------------------------------------------------------------------

EDGE_LEADING = "leading"
EDGE_CLOSE_BEHIND = "close_behind"
EDGE_NEEDS_RESPONSE = "needs_a_response"
EDGE_LEVEL = "level"

#: How far behind the leader still counts as "close behind", in lineup-quality
#: index points. Chosen against the same scale the final score uses, so the
#: band means the same thing at every depth.
EDGE_CLOSE_MARGIN = 2.5


def partial_lineup_score(
    picks: Sequence[DraftPick],
    index: EligibilityIndex,
    board_seed: int,
) -> Optional[float]:
    """The lineup-quality index of an UNFINISHED roster.

    The same evaluator, over the cards a seat actually holds. Cards are ordered
    by canonical slot so the bench slot -- which the evaluator identifies
    POSITIONALLY as everything after the fifth card -- stays the bench.

    NOT COMPARABLE TO A FINAL SCORE, and not published as a number anywhere.
    An unfinished roster scores an empty bench as 0.0 rather than as absent
    (`simulation._avg([]) == 0.0`), so the value is systematically depressed
    while slots are open. It is used only to ORDER seats against each other at
    equal depth, which that bias does not affect because it applies equally.
    """
    placed = [pick for pick in picks if pick is not None]
    if not placed:
        return None
    ordered = sorted(placed, key=lambda pick: SLOT_TYPES.index(pick.slot_type))
    cards = [resolve_scoring_season_card(pick, index) for pick in ordered]
    result = simulate_exact_season(
        cards, board_seed, [pick.slot_type for pick in ordered]
    )
    return round(result.lineup_quality, 3)


def current_edges(
    rosters_picks: Mapping[int, Sequence[DraftPick]],
    index: EligibilityIndex,
    board_seed: int,
) -> dict[int, str]:
    """seat_index -> one of the four ordinal edge bands. No numbers.

    COMPARED AT EQUAL DEPTH. Every seat is scored on its first `k` picks,
    where `k` is the smallest roster in the match. Mid-round, the snake has
    given one or two seats an extra pick; ranking on whole rosters would show
    a seat "Leading" purely for having picked more recently, which is a
    statement about turn order rather than about roster quality.

    Returns `EDGE_LEVEL` for everyone when no seat has picked yet, or when
    every seat's partial score is identical.
    """
    depth = min((len(list(picks)) for picks in rosters_picks.values()), default=0)
    if depth <= 0:
        return {seat: EDGE_LEVEL for seat in rosters_picks}

    scores: dict[int, float] = {}
    for seat_index, picks in rosters_picks.items():
        # Chronological order, so "first k picks" means the first k the seat
        # actually made rather than the first k slots it happens to occupy.
        chronological = sorted(picks, key=lambda pick: (pick.round_number, pick.slot_type))
        value = partial_lineup_score(chronological[:depth], index, board_seed)
        if value is None:  # pragma: no cover - depth >= 1 guarantees a pick
            return {seat: EDGE_LEVEL for seat in rosters_picks}
        scores[seat_index] = value

    leader = max(scores.values())
    if all(abs(value - leader) < 1e-9 for value in scores.values()):
        return {seat: EDGE_LEVEL for seat in scores}

    out: dict[int, str] = {}
    for seat_index, value in scores.items():
        if abs(value - leader) < 1e-9:
            out[seat_index] = EDGE_LEADING
        elif leader - value <= EDGE_CLOSE_MARGIN:
            out[seat_index] = EDGE_CLOSE_BEHIND
        else:
            out[seat_index] = EDGE_NEEDS_RESPONSE
    return out


def rank_rosters(
    evaluations: Sequence[tuple[int, RosterEvaluation]],
) -> tuple[tuple[int, RosterEvaluation], ...]:
    """Order (seat_index, evaluation) pairs best-first.

    Ranking rules, in order:
      1. A fully-scored roster always outranks an incomplete one. An
         incomplete roster has no comparable number, so it is not ranked
         against complete ones on a fabricated basis -- it sorts last.
      2. Higher `ranking_score` (`lineup_peak_score`) first.
      3. Ties broken by seat_index, purely so the order is stable and
         reproducible. A genuine tie stays a genuine tie -- callers that need
         to declare a single winner must check for equal `ranking_score`
         themselves rather than reading position 0 as "the winner".
    """
    return tuple(
        sorted(
            evaluations,
            key=lambda item: (
                0 if item[1].ranking_score is not None else 1,
                -(item[1].ranking_score or 0.0),
                item[0],
            ),
        )
    )


# Outcome vocabulary, fixed by the foundation:
# `arena_match_results.outcome CHECK (outcome IN ('win', 'loss', 'draw'))`
# -- supabase/migrations/20260804100000_arena_foundation.sql:521.
OUTCOME_WIN = "win"
OUTCOME_LOSS = "loss"
OUTCOME_DRAW = "draw"


def placements(
    evaluations: Sequence[tuple[int, RosterEvaluation]],
) -> dict[int, tuple[int, str]]:
    """seat_index -> (placement, outcome), in the foundation's own convention.

    STANDARD COMPETITION RANKING, TIES SHARING A PLACEMENT: a three-way draw
    is 1/1/1 and the next seat would be 4. That convention is stated on the
    column itself (`arena_match_results.placement`,
    20260804100000_arena_foundation.sql:511-514) because a rating pass
    consumes it and must not have to guess. Computed here rather than
    invented, so the three-player-to-pairwise conversion reads what it expects.

    Outcome mapping, given that column's `('win','loss','draw')` CHECK:
      * alone in first -> "win"
      * tied for first -> "draw", for every seat tied there
      * anything else  -> "loss"
    A tie for SECOND is still a loss on both sides: `outcome` records how the
    match ended for that seat, and neither of them won it.

    A roster with no comparable score (`ranking_score is None`) places last.
    It is not scored as zero -- see this module's docstring.
    """
    ranked = rank_rosters(evaluations)
    out: dict[int, tuple[int, str]] = {}

    # Group by exact comparison value, preserving ranked order. `None` groups
    # with `None` (they are equally unranked) and never with a real 0.0.
    groups: list[tuple[Optional[float], list[int]]] = []
    for seat_index, evaluation in ranked:
        key = evaluation.ranking_score
        if groups and groups[-1][0] == key:
            groups[-1][1].append(seat_index)
        else:
            groups.append((key, [seat_index]))

    position = 1
    for group_index, (_score, seat_indexes) in enumerate(groups):
        outcome = OUTCOME_LOSS
        if group_index == 0:
            outcome = OUTCOME_DRAW if len(seat_indexes) > 1 else OUTCOME_WIN
        for seat_index in seat_indexes:
            out[seat_index] = (position, outcome)
        # Advance by the size of the group -- this is what makes 1/1/1 be
        # followed by 4 rather than by 2.
        position += len(seat_indexes)
    return out


def is_tied(evaluations: Sequence[tuple[int, RosterEvaluation]]) -> bool:
    """Do the top two ranked rosters share an identical `ranking_score`?"""
    ranked = rank_rosters(evaluations)
    if len(ranked) < 2:
        return False
    top, second = ranked[0][1], ranked[1][1]
    if top.ranking_score is None or second.ranking_score is None:
        return False
    return top.ranking_score == second.ranking_score


__all__ = [
    "EDGE_CLOSE_BEHIND",
    "EDGE_CLOSE_MARGIN",
    "EDGE_LEADING",
    "EDGE_LEVEL",
    "EDGE_NEEDS_RESPONSE",
    "OUTCOME_DRAW",
    "OUTCOME_LOSS",
    "OUTCOME_WIN",
    "SCORE_STATUS_COMPLETE",
    "SCORE_STATUS_INCOMPLETE",
    "EvaluatedCard",
    "EvaluationError",
    "RosterEvaluation",
    "current_edges",
    "evaluate_roster",
    "is_tied",
    "partial_lineup_score",
    "placements",
    "rank_rosters",
    "resolve_scoring_season_card",
]
