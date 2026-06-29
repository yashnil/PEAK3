"""Tests for the experimental lineup model.

Tests cover:
- Talent monotonicity and dominance
- Diminishing contributions
- Coverage saturation
- Catastrophic-hole behavior
- Synergy bounds and receipt generation
- Role assignment
- Five-card requirements
- Same-duration requirements
- Board generation determinism
- Board feasibility
- Solver accuracy
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

_repo_root = Path(__file__).resolve().parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from nba_peak.lineup.schemas import CardProfile, LineupDNA
from nba_peak.lineup.talent import compute_talent_score
from nba_peak.lineup.coverage import compute_coverage_score
from nba_peak.lineup.synergy import compute_synergy
from nba_peak.lineup.scoring import evaluate_lineup
from nba_peak.lineup.board import generate_board, BoardConfig, _can_fill_all_roles, _clear_profile_cache
from nba_peak.lineup.solver import solve_board, board_percentile, _assign_roles
from nba_peak.lineup.config import (
    TALENT_CARD_WEIGHTS, TALENT_WEIGHT, COVERAGE_WEIGHT, SYNERGY_WEIGHT,
    SYNERGY_MAX, SYNERGY_MIN, BOARD_ROUNDS, OFFERS_PER_ROUND, LINEUP_MODEL_VERSION,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

def _make_dna(**kwargs) -> LineupDNA:
    defaults = {
        "primary_creation": 50.0,
        "scoring_pressure": 50.0,
        "individual_validation": 50.0,
        "postseason_translation": 50.0,
        "team_context": 50.0,
        "context_completeness": 100.0,
    }
    defaults.update(kwargs)
    return LineupDNA(**defaults)


def _make_card(
    score: float = 80.0,
    rank: int = 10,
    roles: list[str] | None = None,
    dur: int = 1,
    player: str = "Test Player",
    pid: str = "test-player",
    pwid: str | None = None,
    dna_kwargs: dict | None = None,
) -> CardProfile:
    if roles is None:
        roles = ["lead_creator", "guard_wing"]
    dna = _make_dna(**(dna_kwargs or {}))
    if pwid is None:
        pwid = f"{pid}-{dur}yr-202425"
    return CardProfile(
        peak_window_id=pwid,
        profile_version="v0",
        player_id=pid,
        player_slug=pid,
        player_name=player,
        duration_years=dur,
        start_season="2024-25",
        end_season="2024-25",
        anchor_season="2024-25",
        individual_peak_score=score,
        individual_peak_rank=rank,
        prime_index=score * 0.9,
        eligible_roles=roles,
        primary_role=roles[0] if roles else None,
        lineup_dna=dna,
        data_completeness="complete",
        profile_status="verified_data_derived",
    )


def _five_cards(scores=(90, 80, 70, 60, 50)) -> list[CardProfile]:
    role_sets = [
        ["lead_creator"],
        ["guard_wing"],
        ["wing_forward"],
        ["forward_big"],
        ["anchor"],
    ]
    return [
        _make_card(score=s, rank=i + 1, roles=role_sets[i],
                   pid=f"player-{i}", pwid=f"player-{i}-1yr-202425")
        for i, s in enumerate(scores)
    ]


# ---------------------------------------------------------------------------
# Talent tests
# ---------------------------------------------------------------------------

def test_talent_weights_sum_to_one():
    assert abs(sum(TALENT_CARD_WEIGHTS) - 1.0) < 1e-9


def test_talent_requires_exactly_five_cards():
    cards = _five_cards()
    with pytest.raises(ValueError, match="exactly 5"):
        compute_talent_score(cards[:4])


def test_talent_score_in_range():
    cards = _five_cards()
    score = compute_talent_score(cards)
    assert 0.0 <= score <= 100.0


def test_talent_monotone_adding_better_card():
    cards1 = _five_cards((90, 80, 70, 60, 50))
    cards2 = _five_cards((95, 80, 70, 60, 50))  # better top card
    assert compute_talent_score(cards2) > compute_talent_score(cards1)


def test_talent_order_independent():
    """Order of cards should not matter (sorted internally)."""
    import random
    cards = _five_cards((90, 80, 70, 60, 50))
    shuffled = cards.copy()
    random.shuffle(shuffled)
    assert abs(compute_talent_score(cards) - compute_talent_score(shuffled)) < 1e-9


def test_talent_diminishing_contributions():
    """The best card's weight (0.35) > second card's weight (0.27) > etc."""
    # A lineup where only the top card is great should outscore one where benefits are shared
    concentrated = _five_cards((100, 40, 40, 40, 40))
    distributed = _five_cards((70, 70, 70, 70, 70))
    # concentrated has higher top score → 100*0.35 + 40*0.79 = 35 + 31.6 = 66.6
    # distributed: 70*1.0 = 70 (but weighted sum = 70*0.35 + 70*0.27 + ... = 70*1.0 = 70)
    # distributed should win here (equal star power but more depth)
    t1 = compute_talent_score(concentrated)
    t2 = compute_talent_score(distributed)
    # Verify both in range and values make sense
    assert 0 <= t1 <= 100
    assert 0 <= t2 <= 100
    # All 70s with weight sum 1.0 = 70; concentrated gives 35 + 40*0.65 = 61 → distributed wins
    assert t2 > t1


def test_talent_all_same_score():
    cards = _five_cards((80, 80, 80, 80, 80))
    # With equal scores and weights summing to 1.0, result = 80
    assert abs(compute_talent_score(cards) - 80.0) < 1e-6


# ---------------------------------------------------------------------------
# Coverage tests
# ---------------------------------------------------------------------------

def test_coverage_score_in_range():
    cards = _five_cards()
    score, dna = compute_coverage_score(cards)
    assert 0.0 <= score <= 100.0


def test_coverage_saturation_diminishing():
    """Adding a 5th card that perfectly duplicates strengths should barely help."""
    card_a = _make_card(dna_kwargs={"primary_creation": 90.0}, roles=["lead_creator"], pid="a", pwid="a-1yr-202425")
    card_b = _make_card(dna_kwargs={"primary_creation": 90.0}, roles=["guard_wing"], pid="b", pwid="b-1yr-202425")
    card_c = _make_card(dna_kwargs={"primary_creation": 90.0}, roles=["wing_forward"], pid="c", pwid="c-1yr-202425")
    card_d = _make_card(dna_kwargs={"primary_creation": 90.0}, roles=["forward_big"], pid="d", pwid="d-1yr-202425")
    card_e = _make_card(dna_kwargs={"primary_creation": 90.0}, roles=["anchor"], pid="e", pwid="e-1yr-202425")
    score5, _ = compute_coverage_score([card_a, card_b, card_c, card_d, card_e])
    # Vs a lineup with 4 of these + one with diverse DNA (should score higher or equal)
    card_f = _make_card(
        dna_kwargs={"primary_creation": 10.0, "scoring_pressure": 90.0, "individual_validation": 90.0,
                    "postseason_translation": 90.0, "team_context": 90.0},
        roles=["anchor"], pid="f", pwid="f-1yr-202425"
    )
    score_diverse, _ = compute_coverage_score([card_a, card_b, card_c, card_d, card_f])
    # Diverse lineup should have better coverage
    assert score_diverse > score5


def test_coverage_catastrophic_hole():
    """A lineup with a very weak dimension gets penalised."""
    strong_cards = [
        _make_card(
            dna_kwargs={dim: 90.0 for dim in ["primary_creation","scoring_pressure","individual_validation",
                                               "postseason_translation","team_context"]},
            roles=[r], pid=f"s{i}", pwid=f"s{i}-1yr-202425"
        )
        for i, r in enumerate(["lead_creator","guard_wing","wing_forward","forward_big","anchor"])
    ]
    weak_cards = [
        _make_card(
            dna_kwargs={"postseason_translation": 0.0},  # catastrophic hole
            roles=[r], pid=f"w{i}", pwid=f"w{i}-1yr-202425"
        )
        for i, r in enumerate(["lead_creator","guard_wing","wing_forward","forward_big","anchor"])
    ]
    strong_score, _ = compute_coverage_score(strong_cards)
    weak_score, _ = compute_coverage_score(weak_cards)
    assert strong_score > weak_score


def test_coverage_requires_at_least_one_card():
    with pytest.raises(ValueError, match="at least 1"):
        compute_coverage_score([])


# ---------------------------------------------------------------------------
# Synergy tests
# ---------------------------------------------------------------------------

def test_synergy_bounded_positive():
    creator = _make_card(roles=["lead_creator"], pid="c1", pwid="c1-1yr-202425",
                         dna_kwargs={"primary_creation": 90.0})
    anchor = _make_card(roles=["anchor"], pid="a1", pwid="a1-1yr-202425",
                        dna_kwargs={"postseason_translation": 90.0})
    others = [
        _make_card(roles=["guard_wing"], pid="g1", pwid="g1-1yr-202425",
                   dna_kwargs={"individual_validation": 80.0, "scoring_pressure": 70.0}),
        _make_card(roles=["wing_forward"], pid="wf1", pwid="wf1-1yr-202425",
                   dna_kwargs={"individual_validation": 80.0, "scoring_pressure": 70.0}),
        _make_card(roles=["forward_big"], pid="fb1", pwid="fb1-1yr-202425",
                   dna_kwargs={"individual_validation": 80.0, "scoring_pressure": 70.0}),
    ]
    total, items = compute_synergy([creator, anchor] + others)
    assert total <= SYNERGY_MAX


def test_synergy_bounded_negative():
    # Lineup with no creator and no anchor should trigger both negative rules
    cards = [
        _make_card(roles=["wing_forward"], pid=f"wf{i}", pwid=f"wf{i}-1yr-202425",
                   dna_kwargs={"scoring_pressure": 20.0})  # scoring desert too
        for i in range(5)
    ]
    total, items = compute_synergy(cards)
    assert total >= SYNERGY_MIN


def test_synergy_no_creator_triggers_penalty():
    cards = [
        _make_card(roles=["guard_wing", "wing_forward", "forward_big", "anchor"][i % 4],
                   pid=f"p{i}", pwid=f"p{i}-1yr-202425")
        for i in range(5)
    ]
    total, items = compute_synergy(cards)
    penalty = next((s for s in items if s.rule_id == "no_lead_creator"), None)
    assert penalty is not None
    assert penalty.triggered


def test_synergy_receipt_items_have_ids():
    cards = _five_cards()
    _, items = compute_synergy(cards)
    for item in items:
        assert item.rule_id
        assert item.title
        assert isinstance(item.triggered, bool)


# ---------------------------------------------------------------------------
# Scoring integration
# ---------------------------------------------------------------------------

def test_evaluate_lineup_requires_five_cards():
    cards = _five_cards()
    with pytest.raises(ValueError, match="exactly 5"):
        evaluate_lineup(cards[:4], role_assignments={})


def test_evaluate_lineup_requires_same_duration():
    cards_1yr = _five_cards()
    cards_5yr = [
        _make_card(dur=5, roles=["lead_creator"], pid="p5-0", pwid="p5-0-5yr-202425"),
        *cards_1yr[1:]
    ]
    with pytest.raises(ValueError, match="same duration_years"):
        evaluate_lineup(cards_5yr, role_assignments={})


def test_evaluate_lineup_rating_in_range():
    cards = _five_cards()
    roles = {
        "lead_creator": "player-0-1yr-202425",
        "guard_wing": "player-1-1yr-202425",
        "wing_forward": "player-2-1yr-202425",
        "forward_big": "player-3-1yr-202425",
        "anchor": "player-4-1yr-202425",
    }
    ev = evaluate_lineup(cards, role_assignments=roles)
    assert 0.0 <= ev.lineup_peak_rating <= 100.0


def test_evaluate_lineup_talent_dominates():
    """Talent weight 0.78 should produce a score close to talent_score."""
    cards = _five_cards((90, 80, 70, 60, 50))
    roles = {
        "lead_creator": "player-0-1yr-202425",
        "guard_wing": "player-1-1yr-202425",
        "wing_forward": "player-2-1yr-202425",
        "forward_big": "player-3-1yr-202425",
        "anchor": "player-4-1yr-202425",
    }
    ev = evaluate_lineup(cards, role_assignments=roles)
    talent_share = ev.talent_score * TALENT_WEIGHT
    assert talent_share > ev.coverage_score * COVERAGE_WEIGHT  # talent dominates


def test_evaluate_lineup_versions_in_result():
    cards = _five_cards()
    roles = {r: f"player-{i}-1yr-202425" for i, r in enumerate(
        ["lead_creator","guard_wing","wing_forward","forward_big","anchor"])}
    ev = evaluate_lineup(cards, role_assignments=roles)
    assert ev.lineup_model_version == LINEUP_MODEL_VERSION
    assert ev.cards_evaluated == 5
    assert 0.0 <= ev.completeness <= 1.0


def test_evaluate_lineup_receipt_items_populated():
    cards = _five_cards()
    roles = {r: f"player-{i}-1yr-202425" for i, r in enumerate(
        ["lead_creator","guard_wing","wing_forward","forward_big","anchor"])}
    ev = evaluate_lineup(cards, role_assignments=roles)
    assert len(ev.receipt_items) >= 3
    types = {item.item_type for item in ev.receipt_items}
    assert "talent_core" in types
    assert "strength" in types
    assert "weakness" in types


def test_evaluate_lineup_draft_efficiency_with_context():
    cards = _five_cards((90, 80, 70, 60, 50))
    roles = {r: f"player-{i}-1yr-202425" for i, r in enumerate(
        ["lead_creator","guard_wing","wing_forward","forward_big","anchor"])}
    ev = evaluate_lineup(cards, role_assignments=roles, board_optimum=90.0, board_floor=50.0)
    assert ev.draft_efficiency is not None
    assert 0.0 <= ev.draft_efficiency


# ---------------------------------------------------------------------------
# Role assignment
# ---------------------------------------------------------------------------

def test_assign_roles_five_distinct_roles():
    cards = _five_cards()
    result = _assign_roles(cards)
    assert result is not None
    assert len(result) == 5
    assert set(result.keys()) == {"lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"}


def test_assign_roles_returns_none_when_infeasible():
    # All cards only have lead_creator → can't fill all 5 roles
    cards = [_make_card(roles=["lead_creator"], pid=f"p{i}", pwid=f"p{i}-1yr-202425") for i in range(5)]
    result = _assign_roles(cards)
    assert result is None


# ---------------------------------------------------------------------------
# Board generation
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def clear_cache():
    _clear_profile_cache()
    yield
    _clear_profile_cache()


def test_board_generation_apex_1y():
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=12345)
    board = generate_board(config, signing_secret="test-secret")
    assert board.duration_years == 1
    assert len(board.rounds) == BOARD_ROUNDS
    for rnd in board.rounds:
        assert len(rnd.offers) == OFFERS_PER_ROUND


def test_board_generation_prime_3y():
    config = BoardConfig(mode="prime_3y", board_type="practice", date=None, seed=99999)
    board = generate_board(config, signing_secret="test-secret")
    assert board.duration_years == 3


def test_board_generation_foundation_5y():
    config = BoardConfig(mode="foundation_5y", board_type="practice", date=None, seed=77777)
    board = generate_board(config, signing_secret="test-secret")
    assert board.duration_years == 5


def test_board_same_seed_deterministic():
    config1 = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    config2 = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board1 = generate_board(config1, signing_secret="test-secret")
    board2 = generate_board(config2, signing_secret="test-secret")
    ids1 = [c.peak_window_id for rnd in board1.rounds for c in rnd.offers]
    ids2 = [c.peak_window_id for rnd in board2.rounds for c in rnd.offers]
    assert ids1 == ids2


def test_board_different_seeds_differ():
    config1 = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=1)
    config2 = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=9999)
    board1 = generate_board(config1, signing_secret="test-secret")
    board2 = generate_board(config2, signing_secret="test-secret")
    ids1 = [c.peak_window_id for rnd in board1.rounds for c in rnd.offers]
    ids2 = [c.peak_window_id for rnd in board2.rounds for c in rnd.offers]
    assert ids1 != ids2


def test_board_no_duplicate_players():
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board = generate_board(config, signing_secret="test-secret")
    all_player_ids = [c.player_id for rnd in board.rounds for c in rnd.offers]
    assert len(all_player_ids) == len(set(all_player_ids))


def test_board_no_duplicate_peak_windows():
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board = generate_board(config, signing_secret="test-secret")
    all_ids = [c.peak_window_id for rnd in board.rounds for c in rnd.offers]
    assert len(all_ids) == len(set(all_ids))


def test_board_duration_consistent():
    config = BoardConfig(mode="prime_3y", board_type="practice", date=None, seed=55)
    board = generate_board(config, signing_secret="test-secret")
    for rnd in board.rounds:
        for card in rnd.offers:
            assert card.duration_years == 3


def test_board_feasible_role_path():
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board = generate_board(config, signing_secret="test-secret")
    round_offers = [rnd.offers for rnd in board.rounds]
    assert _can_fill_all_roles(round_offers)


def test_board_daily_deterministic():
    config1 = BoardConfig(mode="prime_3y", board_type="daily", date="2026-06-28", seed=None)
    config2 = BoardConfig(mode="prime_3y", board_type="daily", date="2026-06-28", seed=None)
    board1 = generate_board(config1, signing_secret="test-secret")
    board2 = generate_board(config2, signing_secret="test-secret")
    ids1 = [c.peak_window_id for rnd in board1.rounds for c in rnd.offers]
    ids2 = [c.peak_window_id for rnd in board2.rounds for c in rnd.offers]
    assert ids1 == ids2


def test_board_reframe_branches_present():
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board = generate_board(config, signing_secret="test-secret")
    for r in range(1, BOARD_ROUNDS + 1):
        assert r in board.reframe_branches
        assert len(board.reframe_branches[r]) == OFFERS_PER_ROUND


def test_board_reframe_no_overlap_with_main():
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board = generate_board(config, signing_secret="test-secret")
    main_player_ids = {c.player_id for rnd in board.rounds for c in rnd.offers}
    for branch in board.reframe_branches.values():
        for card in branch:
            assert card.player_id not in main_player_ids, \
                f"Reframe card {card.player_name} duplicates a main board player"


def test_board_invalid_mode():
    config = BoardConfig(mode="invalid_mode", board_type="practice", date=None, seed=42)
    with pytest.raises(ValueError, match="Unsupported mode"):
        generate_board(config, signing_secret="test-secret")


# ---------------------------------------------------------------------------
# Solver tests
# ---------------------------------------------------------------------------

def test_solver_apex_1y():
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board = generate_board(config, signing_secret="test-secret")
    result = solve_board(board)
    assert result["board_optimum"] > 0.0
    assert result["board_floor"] <= result["board_optimum"]
    assert result["exact"] is True
    assert len(result["all_ratings"]) > 0


def test_solver_optimum_is_max():
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board = generate_board(config, signing_secret="test-secret")
    result = solve_board(board)
    for r in result["all_ratings"]:
        assert r <= result["board_optimum"] + 1e-6


def test_solver_draft_efficiency_optimal():
    """The optimal lineup should achieve efficiency close to 1.0."""
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board = generate_board(config, signing_secret="test-secret")
    result = solve_board(board)
    best = result["optimal_cards"]
    roles = _assign_roles(best)
    ev = evaluate_lineup(best, role_assignments=roles,
                         board_optimum=result["board_optimum"],
                         board_floor=result["board_floor"])
    # Optimal lineup should have draft_efficiency >= 0.99
    assert ev.draft_efficiency is not None
    assert ev.draft_efficiency >= 0.99


def test_solver_board_percentile():
    config = BoardConfig(mode="apex_1y", board_type="practice", date=None, seed=42)
    board = generate_board(config, signing_secret="test-secret")
    result = solve_board(board)
    pct = board_percentile(result["board_optimum"], result["all_ratings"])
    # Optimum should be at very high percentile
    assert pct >= 90.0
