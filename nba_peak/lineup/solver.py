"""Board solver for Peak Draft.

Finds the optimal lineup achievable from a given board using exact search
(the state space is bounded: 3^5 = 243 combinations × Hold/Reframe branches).

Also simulates several policies to compute board floor and result distribution.
"""
from __future__ import annotations

import random
from itertools import product

from nba_peak.lineup.config import (
    BOARD_ROUNDS,
    FLOOR_PERCENTILE,
    SIMULATION_N,
    SIMULATION_POLICIES,
)
from nba_peak.lineup.schemas import Board, CardProfile
from nba_peak.lineup.scoring import evaluate_lineup

ROLES_LIST = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]

# ---------------------------------------------------------------------------
# Role assignment
# ---------------------------------------------------------------------------

def _assign_roles(cards: list[CardProfile]) -> dict[str, str] | None:
    """Try to assign each of 5 cards to a distinct role.

    Returns role→peak_window_id mapping or None if not possible.
    Uses greedy matching (sorted by fewest eligible roles first for stability).
    """
    if len(cards) != 5:
        return None

    sorted_cards = sorted(cards, key=lambda c: (len(c.eligible_roles), c.peak_window_id))
    assignment: dict[str, str] = {}

    def backtrack(idx: int, used_roles: set[str]) -> bool:
        if idx == 5:
            return len(used_roles) == 5
        card = sorted_cards[idx]
        for role in ROLES_LIST:
            if role in card.eligible_roles and role not in used_roles:
                assignment[role] = card.peak_window_id
                if backtrack(idx + 1, used_roles | {role}):
                    return True
                del assignment[role]
        return False

    if backtrack(0, set()):
        return dict(assignment)
    return None


# ---------------------------------------------------------------------------
# Enumerate valid lineups (no Hold/Reframe)
# ---------------------------------------------------------------------------

def _enumerate_all_selections(board: Board) -> list[list[CardProfile]]:
    """Enumerate all possible 1-card-per-round selections (3^5 = 243 max)."""
    round_offers = [r.offers for r in board.rounds]
    all_combos = []
    for combo in product(*round_offers):
        cards = list(combo)
        # Must be able to assign all 5 roles
        if _assign_roles(cards) is not None:
            all_combos.append(cards)
    return all_combos


# ---------------------------------------------------------------------------
# Evaluate a card list quickly (no receipt generation needed)
# ---------------------------------------------------------------------------

def _quick_rating(cards: list[CardProfile]) -> float:
    assignment = _assign_roles(cards)
    if assignment is None:
        return 0.0
    try:
        ev = evaluate_lineup(cards, role_assignments=assignment)
        return ev.lineup_peak_rating
    except Exception:
        return 0.0


# ---------------------------------------------------------------------------
# Exact solver
# ---------------------------------------------------------------------------

def solve_board(board: Board) -> dict:
    """Find the optimal lineup rating for a board without Hold/Reframe.

    Returns a dict with:
      board_optimum, board_floor, optimal_cards, all_ratings, solver_version, exact
    """
    combos = _enumerate_all_selections(board)
    if not combos:
        # Fallback: no feasible lineup exists (shouldn't happen after board gen check)
        return {
            "board_optimum": 0.0,
            "board_floor": 0.0,
            "optimal_cards": [],
            "all_ratings": [],
            "solver_version": "solver_v0",
            "exact": False,
        }

    ratings: list[float] = []
    best_rating = -1.0
    best_cards: list[CardProfile] = []

    for cards in combos:
        r = _quick_rating(cards)
        ratings.append(r)
        if r > best_rating:
            best_rating = r
            best_cards = cards

    # Floor = FLOOR_PERCENTILE of the rating distribution
    sorted_ratings = sorted(ratings)
    floor_idx = max(0, int(len(sorted_ratings) * FLOOR_PERCENTILE / 100.0) - 1)
    board_floor = sorted_ratings[floor_idx]

    return {
        "board_optimum": round(best_rating, 4),
        "board_floor": round(board_floor, 4),
        "optimal_cards": best_cards,
        "all_ratings": sorted_ratings,
        "solver_version": "solver_v0_exact",
        "exact": True,
    }


# ---------------------------------------------------------------------------
# Percentile of a rating in the board distribution
# ---------------------------------------------------------------------------

def board_percentile(rating: float, all_ratings: list[float]) -> float:
    """Return the percentile (0-100) of rating within the solved board distribution."""
    if not all_ratings:
        return 50.0
    n = len(all_ratings)
    below = sum(1 for r in all_ratings if r < rating)
    return round(below / n * 100.0, 1)
