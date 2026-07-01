"""Tests for Peak Draft API endpoints and state machine."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure nba_peak is importable in test context
_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create_game(client: TestClient, mode: str = "apex_1y", board_type: str = "practice") -> dict:
    resp = client.post("/api/v1/draft/games", json={"mode": mode, "board_type": board_type, "seed": 42})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _action(client: TestClient, game_id: str, action: str, **kwargs) -> dict:
    body = {"game_id": game_id, "action": action, **kwargs}
    resp = client.post(f"/api/v1/draft/games/{game_id}/actions", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


ALL_ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]


def _play_full_game(client: TestClient, mode: str = "apex_1y") -> dict:
    """Play a full game using a most-constrained-card-first heuristic.

    In each round, picks the card with the fewest eligible open roles (most
    constrained). This avoids dead-ends caused by saving rare roles too late.
    On a valid board, this always finds a feasible 5-round assignment.
    """
    state = _create_game(client, mode=mode)
    game_id = state["game_id"]

    for rnd in range(5):
        state = client.get(f"/api/v1/draft/games/{game_id}").json()
        offers = state["current_offers"]
        open_roles = state["open_roles"]

        card_id, role = None, None
        best_constraint = float("inf")

        # Pick the most constrained card (fewest eligible open roles)
        for offer in offers:
            eligible_open = [r for r in offer["eligible_roles"] if r in open_roles]
            if eligible_open and len(eligible_open) < best_constraint:
                best_constraint = len(eligible_open)
                card_id = offer["peak_window_id"]
                role = eligible_open[0]

        # Fallback: first open role with any offer (shouldn't happen on valid boards)
        if card_id is None and open_roles and offers:
            card_id = offers[0]["peak_window_id"]
            role = open_roles[0]

        assert card_id is not None and role is not None, (
            f"No valid move in round {rnd+1}: open_roles={open_roles}, "
            f"offers={[(o['peak_window_id'], o['eligible_roles']) for o in offers]}"
        )
        state = _action(client, game_id, "select_card", card_id=card_id, role=role)

    return state


# ---------------------------------------------------------------------------
# Meta endpoint
# ---------------------------------------------------------------------------

def test_draft_meta_returns_expected_fields(client: TestClient) -> None:
    resp = client.get("/api/v1/draft/meta")
    assert resp.status_code == 200
    data = resp.json()
    assert "supported_modes" in data
    assert "apex_1y" in data["supported_modes"]
    assert "prime_3y" in data["supported_modes"]
    assert "foundation_5y" in data["supported_modes"]
    assert "lineup_model_version" in data
    assert "experimental" in data["experimental_notice"].lower()


# ---------------------------------------------------------------------------
# Create game
# ---------------------------------------------------------------------------

def test_create_practice_game_apex_1y(client: TestClient) -> None:
    state = _create_game(client, mode="apex_1y")
    assert state["mode"] == "apex_1y"
    assert state["duration_years"] == 1
    assert state["status"] == "round_active"
    assert state["current_round"] == 1
    assert state["total_rounds"] == 5
    assert len(state["current_offers"]) == 3


def test_create_practice_game_prime_3y(client: TestClient) -> None:
    state = _create_game(client, mode="prime_3y")
    assert state["duration_years"] == 3
    assert len(state["current_offers"]) == 3


def test_create_practice_game_foundation_5y(client: TestClient) -> None:
    state = _create_game(client, mode="foundation_5y")
    assert state["duration_years"] == 5
    assert len(state["current_offers"]) == 3


def test_create_daily_game(client: TestClient) -> None:
    resp = client.post(
        "/api/v1/draft/games",
        json={"mode": "prime_3y", "board_type": "daily", "date": "2026-06-28"},
    )
    assert resp.status_code == 200
    state = resp.json()
    assert state["board_type"] == "daily"


def test_create_game_invalid_mode(client: TestClient) -> None:
    resp = client.post("/api/v1/draft/games", json={"mode": "bad_mode", "board_type": "practice"})
    assert resp.status_code == 400


def test_daily_shortcut_endpoint(client: TestClient) -> None:
    resp = client.get("/api/v1/draft/daily?mode=apex_1y&date=2026-06-28")
    assert resp.status_code == 200
    data = resp.json()
    assert data["board_type"] == "daily"
    assert data["mode"] == "apex_1y"


def test_daily_deterministic(client: TestClient) -> None:
    """Same date + mode → same offers."""
    resp1 = client.get("/api/v1/draft/daily?mode=apex_1y&date=2026-06-28")
    resp2 = client.get("/api/v1/draft/daily?mode=apex_1y&date=2026-06-28")
    offers1 = [o["peak_window_id"] for o in resp1.json()["current_offers"]]
    offers2 = [o["peak_window_id"] for o in resp2.json()["current_offers"]]
    assert offers1 == offers2


# ---------------------------------------------------------------------------
# Public state — no private data in payload
# ---------------------------------------------------------------------------

def test_no_future_offers_in_initial_state(client: TestClient) -> None:
    state = _create_game(client)
    # Only current round offers visible — no way to know rounds 2-5
    assert len(state["current_offers"]) == 3
    assert "all_rounds" not in state
    assert "reframe_branches" not in state
    assert "board_seed" not in state


def test_no_prime_index_in_offers(client: TestClient) -> None:
    state = _create_game(client)
    for offer in state["current_offers"]:
        assert "prime_index" not in offer


def test_no_solver_output_before_completion(client: TestClient) -> None:
    state = _create_game(client)
    assert "lineup_evaluation" not in state or state.get("lineup_evaluation") is None


# ---------------------------------------------------------------------------
# Select card
# ---------------------------------------------------------------------------

def test_select_card_advances_round(client: TestClient) -> None:
    state = _create_game(client)
    game_id = state["game_id"]
    offers = state["current_offers"]
    offer = offers[0]
    role = offer["eligible_roles"][0]
    state2 = _action(client, game_id, "select_card", card_id=offer["peak_window_id"], role=role)
    assert state2["current_round"] == 2
    assert len(state2["selected_cards"]) == 1


def test_select_wrong_card_id_returns_400(client: TestClient) -> None:
    state = _create_game(client)
    resp = client.post(
        f"/api/v1/draft/games/{state['game_id']}/actions",
        json={"game_id": state["game_id"], "action": "select_card", "card_id": "fake-id", "role": "lead_creator"},
    )
    assert resp.status_code == 400


def test_select_ineligible_role_returns_400(client: TestClient) -> None:
    """Verify the API rejects selecting a card for a role it is not eligible for.

    Searches practice seeds 1-10 to find an offer with at least one ineligible
    role, avoiding a spurious skip when seed 42 happens to offer a card eligible
    for all roles.
    """
    game_id = None
    offer = None
    ineligible_role = None

    all_roles = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]
    for seed in range(1, 11):
        resp = client.post("/api/v1/draft/games", json={"mode": "apex_1y", "board_type": "practice", "seed": seed})
        assert resp.status_code == 200, resp.text
        state = resp.json()
        for o in state["current_offers"]:
            ineligible = [r for r in all_roles if r not in o["eligible_roles"]]
            if ineligible:
                game_id = state["game_id"]
                offer = o
                ineligible_role = ineligible[0]
                break
        if ineligible_role:
            break

    assert ineligible_role is not None, (
        "Could not find an offer with any ineligible role across seeds 1-10. "
        "All cards in the pool may be eligible for all 5 roles — check role eligibility rules."
    )
    resp = client.post(
        f"/api/v1/draft/games/{game_id}/actions",
        json={"game_id": game_id, "action": "select_card",
              "card_id": offer["peak_window_id"], "role": ineligible_role},
    )
    assert resp.status_code == 400


def test_selected_card_appears_in_selected_list(client: TestClient) -> None:
    state = _create_game(client)
    offer = state["current_offers"][0]
    role = offer["eligible_roles"][0]
    state2 = _action(client, game_id := state["game_id"], "select_card",
                     card_id=offer["peak_window_id"], role=role)
    assert any(s["card"]["peak_window_id"] == offer["peak_window_id"] for s in state2["selected_cards"])


# ---------------------------------------------------------------------------
# Hold
# ---------------------------------------------------------------------------

def test_use_hold(client: TestClient) -> None:
    state = _create_game(client)
    game_id = state["game_id"]
    card_to_hold = state["current_offers"][0]["peak_window_id"]
    state2 = _action(client, game_id, "use_hold", card_id=card_to_hold)
    assert state2["hold_used"] is True
    assert state2["held_card"] is not None
    assert state2["held_card"]["peak_window_id"] == card_to_hold
    assert state2["hold_available"] is False


def test_hold_twice_returns_400(client: TestClient) -> None:
    state = _create_game(client)
    game_id = state["game_id"]
    card_id = state["current_offers"][0]["peak_window_id"]
    _action(client, game_id, "use_hold", card_id=card_id)
    # Then select a card to advance round
    state2 = client.get(f"/api/v1/draft/games/{game_id}").json()
    offers = state2["current_offers"]
    role = offers[0]["eligible_roles"][0]
    _action(client, game_id, "select_card", card_id=offers[0]["peak_window_id"], role=role)
    # Try hold again in round 2
    state3 = client.get(f"/api/v1/draft/games/{game_id}").json()
    resp = client.post(
        f"/api/v1/draft/games/{game_id}/actions",
        json={"game_id": game_id, "action": "use_hold",
              "card_id": state3["current_offers"][0]["peak_window_id"]},
    )
    assert resp.status_code == 400


def test_held_card_appears_in_next_round_offers(client: TestClient) -> None:
    state = _create_game(client)
    game_id = state["game_id"]
    card_to_hold = state["current_offers"][1]["peak_window_id"]
    _action(client, game_id, "use_hold", card_id=card_to_hold)
    # Select any card from round 1
    state2 = client.get(f"/api/v1/draft/games/{game_id}").json()
    offers = state2["current_offers"]
    selected_id = next(o["peak_window_id"] for o in offers if o["peak_window_id"] != card_to_hold)
    role = next(o["eligible_roles"][0] for o in offers if o["peak_window_id"] == selected_id)
    state3 = _action(client, game_id, "select_card", card_id=selected_id, role=role)
    # Round 2 offers should include the held card
    round2_ids = [o["peak_window_id"] for o in state3["current_offers"]]
    assert card_to_hold in round2_ids


# ---------------------------------------------------------------------------
# Reframe
# ---------------------------------------------------------------------------

def test_use_reframe_changes_offers(client: TestClient) -> None:
    state = _create_game(client)
    game_id = state["game_id"]
    original_ids = {o["peak_window_id"] for o in state["current_offers"]}
    state2 = _action(client, game_id, "use_reframe")
    assert state2["reframe_used"] is True
    assert state2["reframe_available"] is False
    new_ids = {o["peak_window_id"] for o in state2["current_offers"]}
    assert new_ids != original_ids


def test_reframe_twice_returns_400(client: TestClient) -> None:
    state = _create_game(client)
    game_id = state["game_id"]
    _action(client, game_id, "use_reframe")
    resp = client.post(
        f"/api/v1/draft/games/{game_id}/actions",
        json={"game_id": game_id, "action": "use_reframe"},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Complete game
# ---------------------------------------------------------------------------

def test_complete_game_has_evaluation(client: TestClient) -> None:
    state = _play_full_game(client)
    assert state["status"] == "draft_complete"
    assert state["lineup_evaluation"] is not None
    ev = state["lineup_evaluation"]
    assert "lineup_peak_rating" in ev
    assert "talent_score" in ev
    assert "coverage_score" in ev
    assert "draft_efficiency" in ev
    assert "receipt_items" in ev
    assert len(ev["receipt_items"]) >= 3


def test_completed_game_lineup_peak_rating_range(client: TestClient) -> None:
    state = _play_full_game(client)
    rating = state["lineup_evaluation"]["lineup_peak_rating"]
    assert 0.0 <= rating <= 100.0


def test_completed_game_draft_efficiency_range(client: TestClient) -> None:
    state = _play_full_game(client, mode="apex_1y")  # use apex_1y (always feasible with greedy)
    ev = state["lineup_evaluation"]
    assert ev["draft_efficiency"] is not None
    assert ev["draft_efficiency"] >= 0.0


def test_completed_game_has_all_roles(client: TestClient) -> None:
    state = _play_full_game(client)
    assert len(state["selected_cards"]) == 5
    filled_roles = {s["role"] for s in state["selected_cards"]}
    assert filled_roles == {"lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"}


def test_mutate_completed_game_returns_400(client: TestClient) -> None:
    state = _play_full_game(client)
    game_id = state["game_id"]
    resp = client.post(
        f"/api/v1/draft/games/{game_id}/actions",
        json={"game_id": game_id, "action": "select_card", "card_id": "any", "role": "lead_creator"},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Get game by ID
# ---------------------------------------------------------------------------

def test_get_game_returns_state(client: TestClient) -> None:
    state = _create_game(client)
    resp = client.get(f"/api/v1/draft/games/{state['game_id']}")
    assert resp.status_code == 200
    assert resp.json()["game_id"] == state["game_id"]


def test_get_nonexistent_game_returns_404(client: TestClient) -> None:
    resp = client.get("/api/v1/draft/games/doesnotexist")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

def test_duplicate_action_idempotent(client: TestClient) -> None:
    state = _create_game(client)
    game_id = state["game_id"]
    offer = state["current_offers"][0]
    role = offer["eligible_roles"][0]
    body = {"game_id": game_id, "action": "select_card",
            "card_id": offer["peak_window_id"], "role": role, "idempotency_key": "key-1"}
    r1 = client.post(f"/api/v1/draft/games/{game_id}/actions", json=body)
    r2 = client.post(f"/api/v1/draft/games/{game_id}/actions", json=body)
    # Both should succeed; state should be the same after both
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r1.json()["current_round"] == r2.json()["current_round"]


# ---------------------------------------------------------------------------
# Challenge links
# ---------------------------------------------------------------------------

def test_challenge_link_reproduces_board(client: TestClient) -> None:
    """Complete a practice game and create a challenge; loading it should give round 1 same offers."""
    # Complete the game first — challenges now require status == "draft_complete"
    completed_state = _play_full_game(client, mode="apex_1y")
    game_id = completed_state["game_id"]

    # Capture round 1 offers from the completed game's round history
    round1 = next(h for h in completed_state["round_history"] if h["round"] == 1)
    original_offers = sorted(o["peak_window_id"] for o in round1["offers"])

    # Create challenge
    resp = client.post(f"/api/v1/draft/challenges?game_id={game_id}")
    assert resp.status_code == 200
    token = resp.json()["challenge_token"]

    # Load challenge — starts a fresh game from the same board (round 1)
    chal_state = client.get(f"/api/v1/draft/challenges/{token}").json()
    chal_offers = sorted(o["peak_window_id"] for o in chal_state["current_offers"])

    assert original_offers == chal_offers, "Challenge link should reproduce the exact same board"


def test_invalid_challenge_token_returns_400(client: TestClient) -> None:
    resp = client.get("/api/v1/draft/challenges/invalid-token")
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# foundation_5y full game
# ---------------------------------------------------------------------------

def test_full_game_foundation_5y(client: TestClient) -> None:
    state = _play_full_game(client, mode="foundation_5y")
    assert state["status"] == "draft_complete"
    ev = state["lineup_evaluation"]
    assert ev["lineup_peak_rating"] > 0


# ---------------------------------------------------------------------------
# No board seed or private data in any response
# ---------------------------------------------------------------------------

def test_game_state_has_no_private_board_data(client: TestClient) -> None:
    state = _create_game(client)
    assert "seed" not in state
    assert "board_seed" not in state
    assert "reframe_branches" not in state
    assert "rounds" not in state   # private board structure
    # board_metadata is allowed (public version info)
    assert "board_metadata" in state


# ---------------------------------------------------------------------------
# Decision replay (round_history)
# ---------------------------------------------------------------------------

def test_initial_state_has_empty_round_history(client: TestClient) -> None:
    state = _create_game(client)
    assert state["round_history"] == []


def test_round_history_records_each_round(client: TestClient) -> None:
    state = _play_full_game(client)
    history = state["round_history"]
    assert len(history) == 5
    rounds_seen = [h["round"] for h in history]
    assert rounds_seen == [1, 2, 3, 4, 5]
    for h in history:
        # Each completed round shows the offers and the chosen card + role.
        assert len(h["offers"]) >= 2
        assert h["selected_card_id"] in [o["peak_window_id"] for o in h["offers"]]
        assert h["role"] in ALL_ROLES


def test_round_history_offers_have_no_prime_index(client: TestClient) -> None:
    state = _play_full_game(client)
    for h in state["round_history"]:
        for offer in h["offers"]:
            assert "prime_index" not in offer


# ---------------------------------------------------------------------------
# Idempotency on the finalizing action
# ---------------------------------------------------------------------------

def test_duplicate_final_selection_is_idempotent(client: TestClient) -> None:
    """Replaying the round-5 selection (with an idempotency key) returns the
    completed state instead of a 'game already complete' error."""
    state = _create_game(client, mode="apex_1y")
    game_id = state["game_id"]
    body = None
    for rnd in range(5):
        state = client.get(f"/api/v1/draft/games/{game_id}").json()
        offers, open_roles = state["current_offers"], state["open_roles"]
        card_id, role = None, None
        for offer in offers:
            for r in offer["eligible_roles"]:
                if r in open_roles:
                    card_id, role = offer["peak_window_id"], r
                    break
            if card_id:
                break
        assert card_id
        body = {"game_id": game_id, "action": "select_card", "card_id": card_id,
                "role": role, "idempotency_key": f"final-{rnd}"}
        r1 = client.post(f"/api/v1/draft/games/{game_id}/actions", json=body)
        assert r1.status_code == 200
    # Replay the last action: must be idempotent, not 400.
    r2 = client.post(f"/api/v1/draft/games/{game_id}/actions", json=body)
    assert r2.status_code == 200
    assert r2.json()["status"] == "draft_complete"


# ---------------------------------------------------------------------------
# Structured error codes
# ---------------------------------------------------------------------------

def test_error_response_has_stable_error_code(client: TestClient) -> None:
    state = _create_game(client)
    resp = client.post(
        f"/api/v1/draft/games/{state['game_id']}/actions",
        json={"game_id": state["game_id"], "action": "select_card",
              "card_id": "fake-id", "role": "lead_creator"},
    )
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert isinstance(detail, dict)
    assert detail["error_code"] == "card_not_offered"
    assert "message" in detail


def test_mutate_completed_game_has_error_code(client: TestClient) -> None:
    state = _play_full_game(client)
    game_id = state["game_id"]
    resp = client.post(
        f"/api/v1/draft/games/{game_id}/actions",
        json={"game_id": game_id, "action": "select_card", "card_id": "any", "role": "lead_creator"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "game_complete"


# ---------------------------------------------------------------------------
# Missing-data transparency in board metadata
# ---------------------------------------------------------------------------

def test_board_metadata_exposes_pool_counts(client: TestClient) -> None:
    state = _create_game(client)
    meta = state["board_metadata"]
    assert meta["card_pool_size"] and meta["card_pool_size"] > 0
    assert meta["cards_placed"] == 15  # 5 rounds x 3 offers
    assert meta["excluded_profiles"] is not None and meta["excluded_profiles"] >= 0
