"""The six-player adapter over the authoritative Peak Season evaluator."""
from __future__ import annotations

import dataclasses

import pytest

from nba_peak.perfect_season.config import (
    LINEUP_MODEL_VERSION,
    SIMULATOR_VERSION,
    STARTER_SLOTS,
)
from nba_peak.three_man_weave.config import ROSTER_SIZE, SLOT_TYPES, TMW_ADAPTER_VERSION
from nba_peak.three_man_weave.evaluation import (
    SCORE_STATUS_COMPLETE,
    SCORE_STATUS_INCOMPLETE,
    EvaluationError,
    RosterEvaluation,
    evaluate_roster,
    is_tied,
    placements,
    rank_rosters,
    resolve_scoring_season_card,
)
from nba_peak.three_man_weave.schemas import DraftPick


def _pick(slot: str, slug: str, franchise: str, decade: str, seat: int = 0) -> DraftPick:
    return DraftPick(
        seat_index=seat,
        round_number=SLOT_TYPES.index(slot) + 1,
        slot_type=slot,
        player_slug=slug,
        franchise_id=franchise,
        decade=decade,
    )


@pytest.fixture(scope="module")
def all_time_roster():
    """A known, hand-specified roster -- every placement at a real position."""
    return {
        "PG": _pick("PG", "magic-johnson", "LAL", "1980s"),
        "SG": _pick("SG", "michael-jordan", "CHI", "1990s"),
        "SF": _pick("SF", "larry-bird", "BOS", "1980s"),
        "PF": _pick("PF", "tim-duncan", "SAS", "2000s"),
        "C": _pick("C", "shaquille-o-neal", "LAL", "2000s"),
        "bench_1": _pick("bench_1", "scottie-pippen", "CHI", "1990s"),
    }


# ---------------------------------------------------------------------------
# Shape and versioning
# ---------------------------------------------------------------------------
def test_the_roster_contract_is_six_slots():
    """Five starters plus exactly one bench. See the adapter docstring: a
    benchless five-card roster reports bench_strength 0.0, not "absent"."""
    assert ROSTER_SIZE == 6
    assert len(SLOT_TYPES) == 6
    assert SLOT_TYPES[:STARTER_SLOTS] == ("PG", "SG", "SF", "PF", "C")
    assert SLOT_TYPES[STARTER_SLOTS:] == ("bench_1",)


def test_result_stamps_the_adapter_version_alongside_the_evaluators(index, all_time_roster):
    """Three versions, not one -- a reader must be able to tell which
    evaluator produced the numbers and which adapter shaped the input."""
    result = evaluate_roster(all_time_roster, index, board_seed=4242)
    assert result.tmw_adapter_version == TMW_ADAPTER_VERSION
    assert result.lineup_model_version == LINEUP_MODEL_VERSION
    assert result.simulator_version == SIMULATOR_VERSION
    assert result.formula_version == "peak3_v1"


def test_bench_is_populated_so_bench_strength_is_never_a_silent_zero(index, all_time_roster):
    result = evaluate_roster(all_time_roster, index, board_seed=4242)
    assert result.fit_components["bench_strength"] > 0.0
    assert len(result.cards) == ROSTER_SIZE
    assert [card.is_starter for card in result.cards] == [True] * 5 + [False]


# ---------------------------------------------------------------------------
# The scoring card actually used
# ---------------------------------------------------------------------------
def test_each_card_is_the_best_season_of_its_DRAFTED_decade(index, all_time_roster):
    """Shaq drafted on a 2000s roll is scored on 2000-01, not on his higher
    1999-00 season -- that one belongs to the 1990s."""
    result = evaluate_roster(all_time_roster, index, board_seed=4242)
    by_slot = {card.slot_type: card for card in result.cards}
    assert by_slot["C"].player_name == "Shaquille O'Neal"
    assert by_slot["C"].season == "2000-01"
    assert by_slot["SG"].season == "1990-91"
    assert by_slot["PG"].season == "1986-87"


def test_the_same_identity_scores_differently_in_different_decades(index):
    """The scoring card is a function of (identity, franchise, decade), which
    is why a DraftPick has to carry both the roll's franchise and its decade."""
    two_thousands = resolve_scoring_season_card(
        _pick("SF", "lebron-james", "CLE", "2000s"), index
    )
    twenty_tens = resolve_scoring_season_card(
        _pick("SF", "lebron-james", "MIA", "2010s"), index
    )
    assert two_thousands.season == "2008-09"
    assert two_thousands.team_id == "CLE"
    assert twenty_tens.season == "2012-13"
    assert twenty_tens.team_id == "MIA"
    assert two_thousands.season_score != twenty_tens.season_score


def test_the_drafted_franchise_decides_the_scoring_season(index):
    """Kawhi off a Raptors roll and off a Spurs roll score DIFFERENTLY.

    This is the reversal the ruleset correction made. The franchise is no
    longer provenance-only: it constrains which season may be used, so the
    card a Raptors roll produces is a Raptors season even though his best
    2010s season is a Spurs one.
    """
    via_toronto = resolve_scoring_season_card(
        _pick("SF", "kawhi-leonard", "TOR", "2010s"), index
    )
    via_san_antonio = resolve_scoring_season_card(
        _pick("SF", "kawhi-leonard", "SAS", "2010s"), index
    )
    assert via_toronto.team_id == "TOR"
    assert via_toronto.season == "2018-19"
    assert via_san_antonio.team_id == "SAS"
    assert via_san_antonio.season == "2016-17"
    assert via_toronto.exact_player_season_key != via_san_antonio.exact_player_season_key


def test_a_cleveland_wade_card_is_a_cleveland_card(index):
    """The named regression. Cleveland x 2010s Wade must not resolve to Miami."""
    card = resolve_scoring_season_card(
        _pick("SG", "dwyane-wade", "CLE", "2010s"), index
    )
    assert card.team_id == "CLE"
    assert card.season == "2017-18"
    assert card.score_status == "exact_season_scored"

    miami = resolve_scoring_season_card(_pick("SG", "dwyane-wade", "MIA", "2010s"), index)
    assert miami.team_id == "MIA"
    assert miami.season == "2010-11"
    assert card.season_score < miami.season_score


def test_no_evaluated_card_reports_a_team_outside_its_drafted_franchise(index):
    """Whole-roster form of the same invariant, through `evaluate_roster`.

    `EvaluatedCard` carries both the franchise it was drafted on and the team
    the season belongs to, so a cross-franchise card is detectable on the
    receipt rather than only in the index.
    """
    from nba_peak.franchises import franchise_for_team_code

    roster = {
        "PG": _pick("PG", "magic-johnson", "LAL", "1980s"),
        "SG": _pick("SG", "michael-jordan", "CHI", "1990s"),
        "SF": _pick("SF", "kawhi-leonard", "TOR", "2010s"),
        "PF": _pick("PF", "tim-duncan", "SAS", "2000s"),
        "C": _pick("C", "shaquille-o-neal", "LAL", "2000s"),
        "bench_1": _pick("bench_1", "dwyane-wade", "CLE", "2010s"),
    }
    evaluation = evaluate_roster(roster, index, board_seed=7)
    for card in evaluation.cards:
        assert franchise_for_team_code(card.team_id) == card.drafted_franchise_id, (
            f"{card.player_slug} drafted on {card.drafted_franchise_id} "
            f"but scored on {card.team_id} {card.season}"
        )


# ---------------------------------------------------------------------------
# Determinism
# ---------------------------------------------------------------------------
def test_evaluation_is_deterministic_for_the_same_roster_and_seed(index, all_time_roster):
    first = evaluate_roster(all_time_roster, index, board_seed=99)
    for _ in range(3):
        assert evaluate_roster(all_time_roster, index, board_seed=99).as_dict() == first.as_dict()


def test_a_different_seed_can_move_wins_but_not_the_ranking_score(index, all_time_roster):
    """`wins` carries seeded noise; `lineup_peak_score` is a mean of real
    PEAK3 numbers and has none."""
    a = evaluate_roster(all_time_roster, index, board_seed=1)
    b = evaluate_roster(all_time_roster, index, board_seed=2)
    assert a.ranking_score == b.ranking_score


# ---------------------------------------------------------------------------
# Rejections
# ---------------------------------------------------------------------------
def test_an_incomplete_roster_is_refused(index, all_time_roster):
    partial = dict(all_time_roster)
    partial["bench_1"] = None
    with pytest.raises(EvaluationError) as excinfo:
        evaluate_roster(partial, index, board_seed=1)
    assert excinfo.value.code == "incomplete_roster"


def test_an_illegal_roster_is_refused(index, all_time_roster):
    """Shaq at small forward never reaches the evaluator."""
    illegal = dict(all_time_roster)
    illegal["SF"] = _pick("SF", "shaquille-o-neal", "LAL", "2000s")
    illegal["C"] = _pick("C", "larry-bird", "BOS", "1980s")
    with pytest.raises(EvaluationError) as excinfo:
        evaluate_roster(illegal, index, board_seed=1)
    assert excinfo.value.code == "illegal_slot"


def test_a_duplicated_identity_is_refused(index, all_time_roster):
    duplicated = dict(all_time_roster)
    duplicated["bench_1"] = _pick("bench_1", "michael-jordan", "CHI", "1990s")
    with pytest.raises(EvaluationError) as excinfo:
        evaluate_roster(duplicated, index, board_seed=1)
    assert excinfo.value.code == "duplicate_player"


def test_a_pick_with_no_scoring_card_in_its_decade_is_refused(index):
    """Michael Jordan has no 2020s season, so a 2020s pick of him cannot be
    scored -- and is rejected rather than silently scored on another decade."""
    with pytest.raises(EvaluationError) as excinfo:
        resolve_scoring_season_card(_pick("SG", "michael-jordan", "CHI", "2020s"), index)
    assert excinfo.value.code == "no_scoring_card"


# ---------------------------------------------------------------------------
# The unscored policy
# ---------------------------------------------------------------------------
def test_unscored_cards_report_none_rather_than_a_zero_score(index, all_time_roster, monkeypatch):
    """`simulate_exact_season` returns 0.0, not None, when any card is
    unscored. Passing that through would state that a roster of legends
    scored zero, so the adapter converts it to None and names the slots."""
    from nba_peak.three_man_weave import evaluation as E

    real_resolve = E.resolve_player_season_card

    def fake_resolve(slug, team, season):
        card = real_resolve(slug, team, season)
        if card is not None and slug == "scottie-pippen":
            return dataclasses.replace(
                card, score_status="exact_season_unscored", season_score=None
            )
        return card

    monkeypatch.setattr(E, "resolve_player_season_card", fake_resolve)

    result = evaluate_roster(all_time_roster, index, board_seed=7)
    assert result.score_status == SCORE_STATUS_INCOMPLETE
    assert result.lineup_score is None
    assert result.mean_season_score is None
    assert result.ranking_score is None
    assert result.unscored_slots == ("bench_1",)
    # And nothing else is fabricated in its place: an unscoreable roster gets
    # no decisive pick either, because there is no lineup quality to attribute.
    assert result.decisive_pick is None


def test_a_fully_scored_roster_reports_complete(index, all_time_roster):
    result = evaluate_roster(all_time_roster, index, board_seed=7)
    assert result.score_status == SCORE_STATUS_COMPLETE
    assert result.unscored_slots == ()
    assert result.ranking_score == result.lineup_score
    assert result.ranking_score > 0


def test_no_evaluation_carries_a_projected_record(index, all_time_roster):
    """Part of the ruleset, not a presentation choice.

    The 82-0 record projection is calibrated for an eight-card roster; this
    adapter runs six. The record is therefore not carried out of the module at
    all, so no surface downstream can render one by accident.
    """
    result = evaluate_roster(all_time_roster, index, board_seed=7)
    payload = result.as_dict()
    for banned in ("wins", "losses", "expected_wins", "expected_wins_low",
                   "expected_wins_high", "is_perfect_season"):
        assert banned not in payload, f"{banned} leaked into the TMW receipt"
    for banned in ("structural_weakness", "weakness_framing", "decisive_factors"):
        assert banned not in payload, f"{banned} is unvalidated prose for six cards"


def test_the_comparator_is_the_lineup_quality_index_not_the_mean(index, all_time_roster):
    """The v1 defect, asserted against.

    `mean_season_score` is the raw mean of the six card scores and is still
    reported for reading; `ranking_score` must not be it, because a mean is
    blind to the roster construction the draft is about.
    """
    from nba_peak.perfect_season.exact_season import resolve_player_season_card
    from nba_peak.perfect_season.simulation import simulate_exact_season

    result = evaluate_roster(all_time_roster, index, board_seed=7)
    cards = [
        resolve_scoring_season_card(all_time_roster[slot], index) for slot in SLOT_TYPES
    ]
    authoritative = simulate_exact_season(cards, 7, list(SLOT_TYPES))

    assert result.ranking_score == pytest.approx(round(authoritative.lineup_quality, 2))
    assert result.mean_season_score == pytest.approx(authoritative.lineup_peak_score)
    assert result.ranking_score != pytest.approx(result.mean_season_score)
    assert resolve_player_season_card is not None  # the import is the point


def test_roster_construction_moves_the_comparator_but_not_the_mean(index, all_time_roster):
    """The concrete consequence of the comparator change.

    Benching the better small forward and starting the weaker one is a LEGAL
    rearrangement of the SAME six seasons, so the mean is identical to the
    decimal. The lineup is genuinely worse, and the comparator has to say so.
    Under v1 -- which ranked on that mean -- the two rosters tied exactly,
    which is what made the position rules decorative.
    """
    # Magic Johnson to SG and Michael Jordan to PG. Both placements are legal
    # under hard position legality (each has the other's slot in their
    # canonical set) and both are off their listed position, which is exactly
    # what `positional_fit` exists to price. The six SEASONS are untouched.
    swapped = dict(all_time_roster)
    swapped["PG"] = dataclasses.replace(all_time_roster["SG"], slot_type="PG")
    swapped["SG"] = dataclasses.replace(all_time_roster["PG"], slot_type="SG")

    straight = evaluate_roster(all_time_roster, index, board_seed=7)
    crossed = evaluate_roster(swapped, index, board_seed=7)

    # The mean cannot tell these two rosters apart. At all. That is the defect.
    assert crossed.mean_season_score == pytest.approx(straight.mean_season_score)
    # The comparator can, and prices the worse arrangement lower.
    assert straight.fit_components["positional_fit"] == 100.0
    assert crossed.fit_components["positional_fit"] < 100.0
    assert crossed.ranking_score < straight.ranking_score


def test_the_decisive_pick_is_a_measured_leave_one_out_drop(index, all_time_roster):
    result = evaluate_roster(all_time_roster, index, board_seed=7)
    decisive = result.decisive_pick
    assert decisive is not None
    assert decisive["slot_type"] in SLOT_TYPES
    assert decisive["lineup_quality_drop"] > 0

    # It really is the largest drop, recomputed independently.
    from nba_peak.perfect_season.simulation import simulate_exact_season

    cards = [
        resolve_scoring_season_card(all_time_roster[slot], index) for slot in SLOT_TYPES
    ]
    full = simulate_exact_season(cards, 7, list(SLOT_TYPES)).lineup_quality
    drops = {}
    for i, slot in enumerate(SLOT_TYPES):
        rest = [c for j, c in enumerate(cards) if j != i]
        rest_slots = [s for j, s in enumerate(SLOT_TYPES) if j != i]
        drops[slot] = full - simulate_exact_season(rest, 7, rest_slots).lineup_quality
    assert decisive["slot_type"] == max(drops, key=drops.get)


def test_a_traded_season_card_is_scored_not_treated_as_unscored(index):
    """An aggregate-grain score is a real score. It is labelled, not refused.

    The pick is built from the card's OWN franchise, because the franchise is
    now a scoring input rather than provenance: asking for that identity on
    some other franchise is a different question with a different answer (and
    often no answer at all).
    """
    multi = [card for card in index._scoring.values() if card.is_multi_team_season]
    sample = multi[0]
    card = resolve_scoring_season_card(
        _pick("bench_1", sample.player_slug, sample.franchise_id, sample.decade), index
    )
    assert card.score_status == "exact_season_scored"
    assert card.score_source == "exact_season_aggregate"
    assert card.season_score == pytest.approx(sample.prime_score)
    # The resolved card names the ROLLED franchise's team, never the other
    # stint's, even though the score is the whole season's.
    assert card.team_id == sample.resolve_team_id


# ---------------------------------------------------------------------------
# Ranking
# ---------------------------------------------------------------------------
def _evaluation(score, status=SCORE_STATUS_COMPLETE) -> RosterEvaluation:
    return RosterEvaluation(
        tmw_adapter_version=TMW_ADAPTER_VERSION,
        lineup_model_version="x",
        simulator_version="y",
        formula_version="peak3_v1",
        ranking_score=score,
        lineup_score=score,
        mean_season_score=score,
        score_status=status,
        unscored_slots=(),
        fit_components={},
        best_pick=None,
        decisive_pick=None,
        experimental_notice="",
        cards=(),
    )


def test_ranking_is_by_ranking_score_descending():
    ranked = rank_rosters([(0, _evaluation(61.0)), (1, _evaluation(74.5)), (2, _evaluation(68.2))])
    assert [seat for seat, _ in ranked] == [1, 2, 0]


def test_an_unscored_roster_sorts_last_and_is_never_ranked_on_a_zero():
    ranked = rank_rosters(
        [
            (0, _evaluation(None, SCORE_STATUS_INCOMPLETE)),
            (1, _evaluation(10.0)),
        ]
    )
    assert [seat for seat, _ in ranked] == [1, 0]


def test_ties_are_stable_and_reported_as_ties():
    pairs = [(0, _evaluation(70.0)), (1, _evaluation(70.0))]
    assert [seat for seat, _ in rank_rosters(pairs)] == [0, 1]
    assert is_tied(pairs)
    assert not is_tied([(0, _evaluation(70.0)), (1, _evaluation(69.9))])


def test_two_incomplete_rosters_are_not_reported_as_tied():
    """Neither has a comparable number, so "tied" would be a claim the data
    does not support."""
    pairs = [
        (0, _evaluation(None, SCORE_STATUS_INCOMPLETE)),
        (1, _evaluation(None, SCORE_STATUS_INCOMPLETE)),
    ]
    assert not is_tied(pairs)


# ---------------------------------------------------------------------------
# Placement -- the Arena foundation's own convention
# ---------------------------------------------------------------------------
def test_placements_use_standard_competition_ranking():
    table = placements([(0, _evaluation(61.0)), (1, _evaluation(74.5)), (2, _evaluation(68.2))])
    assert table == {1: (1, "win"), 2: (2, "loss"), 0: (3, "loss")}


def test_a_three_way_tie_is_one_one_one_not_one_two_three():
    """`arena_match_results.placement` documents 1/1/1 then 4. A rating pass
    consumes that column and must not have to guess."""
    table = placements([(0, _evaluation(70.0)), (1, _evaluation(70.0)), (2, _evaluation(70.0))])
    assert {seat: place for seat, (place, _outcome) in table.items()} == {0: 1, 1: 1, 2: 1}
    assert {outcome for _place, outcome in table.values()} == {"draw"}


def test_a_two_way_tie_for_first_is_followed_by_third_not_second():
    table = placements([(0, _evaluation(70.0)), (1, _evaluation(70.0)), (2, _evaluation(60.0))])
    assert table[0] == (1, "draw")
    assert table[1] == (1, "draw")
    assert table[2] == (3, "loss")


def test_a_tie_for_second_is_a_loss_on_both_sides():
    """`outcome` records how the match ended for that seat, and neither of
    them won it."""
    table = placements([(0, _evaluation(80.0)), (1, _evaluation(60.0)), (2, _evaluation(60.0))])
    assert table[0] == (1, "win")
    assert table[1] == (2, "loss")
    assert table[2] == (2, "loss")


def test_an_unscoreable_roster_places_last_and_is_not_grouped_with_a_real_zero():
    table = placements(
        [
            (0, _evaluation(None, SCORE_STATUS_INCOMPLETE)),
            (1, _evaluation(0.0)),
            (2, _evaluation(55.0)),
        ]
    )
    assert table[2] == (1, "win")
    assert table[1] == (2, "loss")
    assert table[0] == (3, "loss"), "None must not tie with a real 0.0"


def test_outcomes_stay_inside_the_columns_check_vocabulary(index):
    for scores in ([70.0, 70.0, 70.0], [80.0, 60.0, 60.0], [80.0, 70.0, 60.0]):
        table = placements([(index, _evaluation(s)) for index, s in enumerate(scores)])
        assert {outcome for _place, outcome in table.values()} <= {"win", "loss", "draw"}
