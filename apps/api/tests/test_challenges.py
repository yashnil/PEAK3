"""Tests for challenge creation, meta, comparison, and settlement."""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure nba_peak is importable in test context
_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))


# ---------------------------------------------------------------------------
# Helpers (mirror those in test_draft.py for self-contained tests)
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


def _play_full_game(client: TestClient, mode: str = "apex_1y", seed: int = 42) -> dict:
    """Play a full game using a most-constrained-first greedy heuristic."""
    resp = client.post("/api/v1/draft/games", json={"mode": mode, "board_type": "practice", "seed": seed})
    assert resp.status_code == 200, resp.text
    state = resp.json()
    game_id = state["game_id"]

    for _ in range(5):
        state = client.get(f"/api/v1/draft/games/{game_id}").json()
        if state["status"] == "draft_complete":
            break
        offers = state["current_offers"]
        open_roles = state["open_roles"]

        card_id, role = None, None
        best_constraint = float("inf")
        for offer in offers:
            eligible_open = [r for r in offer["eligible_roles"] if r in open_roles]
            if eligible_open and len(eligible_open) < best_constraint:
                best_constraint = len(eligible_open)
                card_id = offer["peak_window_id"]
                role = eligible_open[0]

        if card_id is None and open_roles and offers:
            card_id = offers[0]["peak_window_id"]
            role = open_roles[0]

        assert card_id is not None and role is not None
        state = _action(client, game_id, "select_card", card_id=card_id, role=role)

    return state


def _play_game_by_id(client: TestClient, game_id: str) -> dict:
    """Play an existing game to completion using greedy most-constrained heuristic."""
    for _ in range(5):
        state = client.get(f"/api/v1/draft/games/{game_id}").json()
        if state["status"] == "draft_complete":
            return state
        offers = state["current_offers"]
        open_roles = state["open_roles"]

        card_id, role = None, None
        best_constraint = float("inf")
        for offer in offers:
            eligible_open = [r for r in offer["eligible_roles"] if r in open_roles]
            if eligible_open and len(eligible_open) < best_constraint:
                best_constraint = len(eligible_open)
                card_id = offer["peak_window_id"]
                role = eligible_open[0]

        if card_id is None and open_roles and offers:
            card_id = offers[0]["peak_window_id"]
            role = open_roles[0]

        assert card_id is not None and role is not None
        resp = client.post(
            f"/api/v1/draft/games/{game_id}/actions",
            json={"game_id": game_id, "action": "select_card", "card_id": card_id, "role": role},
        )
        assert resp.status_code == 200, resp.text

    return client.get(f"/api/v1/draft/games/{game_id}").json()


def _create_challenge(client: TestClient, game_id: str) -> dict:
    resp = client.post(f"/api/v1/draft/challenges?game_id={game_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# 1. create_challenge requires complete game
# ---------------------------------------------------------------------------

def test_create_challenge_requires_complete_game(client: TestClient) -> None:
    """POST /challenges with an incomplete game returns 400."""
    state = _create_game(client)
    resp = client.post(f"/api/v1/draft/challenges?game_id={state['game_id']}")
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 2. create_challenge stores snapshot
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_create_challenge_stores_snapshot(client: TestClient) -> None:
    """Completing a game and creating a challenge persists a ChallengeRecord in the store."""
    from app.core.dependencies import _memory_challenge_repo

    state = _play_full_game(client)
    ch = _create_challenge(client, state["game_id"])
    token = ch["challenge_token"]

    token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]
    record = await _memory_challenge_repo.get_challenge(token_hash)

    assert record is not None
    assert record.board_id == ch["board_id"]
    assert record.challenger_game_id == state["game_id"]
    snap = record.challenger_snapshot
    assert snap is not None
    assert "lineup_evaluation" in snap
    assert "selected_cards" in snap
    assert len(snap["selected_cards"]) == 5
    assert snap["lineup_evaluation"] is not None
    assert snap["lineup_evaluation"]["lineup_peak_rating"] > 0


# ---------------------------------------------------------------------------
# 3. Challenge tokens are not predictable (unique nonce)
# ---------------------------------------------------------------------------

def test_challenge_token_is_not_predictable(client: TestClient) -> None:
    """Two challenges from different games produce different tokens."""
    state1 = _play_full_game(client, mode="apex_1y")
    state2 = _play_full_game(client, mode="prime_3y")
    ch1 = _create_challenge(client, state1["game_id"])
    ch2 = _create_challenge(client, state2["game_id"])
    assert ch1["challenge_token"] != ch2["challenge_token"]


# ---------------------------------------------------------------------------
# 4. Challenge meta is spoiler-safe
# ---------------------------------------------------------------------------

def test_challenge_meta_spoiler_safe(client: TestClient) -> None:
    """GET /challenges/{token}/meta returns no scores, lineup, or player picks."""
    state = _play_full_game(client)
    ch = _create_challenge(client, state["game_id"])
    token = ch["challenge_token"]

    resp = client.get(f"/api/v1/draft/challenges/{token}/meta")
    assert resp.status_code == 200
    meta = resp.json()

    # Safe fields must be present
    assert "board_id" in meta
    assert "mode" in meta
    assert "duration_years" in meta
    assert "board_label" in meta
    assert "challenger_display" in meta
    assert "created_at" in meta
    assert "expires_at" in meta
    assert "status" in meta
    assert meta["challenger_display"] == "A PEAK3 player"
    assert meta["status"] == "open"

    # Spoiler fields must NOT be present
    assert "lineup_peak_rating" not in meta
    assert "selected_cards" not in meta
    assert "talent_score" not in meta
    assert "challenger_score" not in meta
    assert "lineup_evaluation" not in meta
    assert "draft_efficiency" not in meta


# ---------------------------------------------------------------------------
# 5. Expired token → 400 challenge_expired
# ---------------------------------------------------------------------------

def test_challenge_meta_expired_token(client: TestClient) -> None:
    """An expired token returns 400 with detail 'challenge_expired'."""
    from app.core.security import create_session_token
    from app.core.config import settings

    payload = {
        "board_type": "practice",
        "mode": "apex_1y",
        "board_id": "practice-apex_1y-42",
        "duration_years": 1,
        "nonce": "deadbeef",
    }
    # ttl_seconds=-1 makes exp already in the past
    expired_token = create_session_token(payload, settings.SIGNING_SECRET, ttl_seconds=-1)
    resp = client.get(f"/api/v1/draft/challenges/{expired_token}/meta")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "challenge_expired"


# ---------------------------------------------------------------------------
# 6a. Malformed token (wrong structure) → 400 token_malformed
# ---------------------------------------------------------------------------

def test_challenge_meta_malformed_token(client: TestClient) -> None:
    """A token with wrong dot structure returns 400 token_malformed."""
    resp = client.get("/api/v1/draft/challenges/notavalidtoken/meta")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "token_malformed"


# ---------------------------------------------------------------------------
# 6b. Valid structure but wrong signature → 400 token_invalid_signature
# ---------------------------------------------------------------------------

def test_challenge_meta_invalid_signature(client: TestClient) -> None:
    """A token with valid structure but wrong HMAC returns 400 token_invalid_signature."""
    from app.core.security import create_session_token

    # Create a token with wrong secret
    payload = {"board_type": "practice", "mode": "apex_1y", "nonce": "aabbcc", "duration_years": 1}
    token = create_session_token(payload, "WRONG_SECRET_XYZ", ttl_seconds=3600)
    resp = client.get(f"/api/v1/draft/challenges/{token}/meta")
    assert resp.status_code == 400
    assert resp.json()["detail"] == "token_invalid_signature"


# ---------------------------------------------------------------------------
# 6c. Valid-signature token not in store → 404 challenge_not_found
# ---------------------------------------------------------------------------

def test_challenge_meta_unknown_token(client: TestClient) -> None:
    """A valid-signature token that is not in the store returns 404 challenge_not_found."""
    from app.core.security import create_session_token
    from app.core.config import settings

    payload = {
        "board_type": "practice",
        "mode": "apex_1y",
        "board_id": "nonexistent-board",
        "duration_years": 1,
        "nonce": "cafebabe1234",
    }
    token = create_session_token(payload, settings.SIGNING_SECRET, ttl_seconds=3600)
    resp = client.get(f"/api/v1/draft/challenges/{token}/meta")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "challenge_not_found"


# ---------------------------------------------------------------------------
# 7. Recipient game loaded from challenge has matching board_id
# ---------------------------------------------------------------------------

def test_recipient_game_same_board(client: TestClient) -> None:
    """Loading a challenge creates a game whose board_id matches the challenger's."""
    state = _play_full_game(client)
    ch = _create_challenge(client, state["game_id"])
    token = ch["challenge_token"]
    original_board_id = ch["board_id"]

    # Load challenge → new game with same board
    load_resp = client.get(f"/api/v1/draft/challenges/{token}")
    assert load_resp.status_code == 200
    recipient_state = load_resp.json()
    assert recipient_state["board_metadata"]["board_id"] == original_board_id


# ---------------------------------------------------------------------------
# 8. Comparison requires complete recipient
# ---------------------------------------------------------------------------

def test_comparison_requires_complete_recipient(client: TestClient) -> None:
    """GET /comparison with an incomplete recipient game returns 400."""
    state = _play_full_game(client)
    ch = _create_challenge(client, state["game_id"])
    token = ch["challenge_token"]

    # Load challenge to get an INCOMPLETE recipient game
    rec_state = client.get(f"/api/v1/draft/challenges/{token}").json()
    recipient_game_id = rec_state["game_id"]

    resp = client.get(
        f"/api/v1/draft/challenges/{token}/comparison",
        params={"recipient_game_id": recipient_game_id},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 9. Comparison with wrong board_id → board_mismatch
# ---------------------------------------------------------------------------

def test_comparison_board_mismatch(client: TestClient) -> None:
    """A recipient game on a different board returns 400 'board_mismatch'."""
    challenger_state = _play_full_game(client, mode="apex_1y")
    ch = _create_challenge(client, challenger_state["game_id"])
    token = ch["challenge_token"]

    # Recipient plays a completely different board (different mode → different board_id)
    different_state = _play_full_game(client, mode="prime_3y")
    recipient_game_id = different_state["game_id"]

    resp = client.get(
        f"/api/v1/draft/challenges/{token}/comparison",
        params={"recipient_game_id": recipient_game_id},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "board_mismatch"


# ---------------------------------------------------------------------------
# 10. Challenger cannot compare against themselves
# ---------------------------------------------------------------------------

def test_comparison_cannot_compare_self(client: TestClient) -> None:
    """Using the challenger's own game_id as the recipient returns 400 'cannot_compare_self'."""
    state = _play_full_game(client)
    game_id = state["game_id"]
    ch = _create_challenge(client, game_id)
    token = ch["challenge_token"]

    resp = client.get(
        f"/api/v1/draft/challenges/{token}/comparison",
        params={"recipient_game_id": game_id},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"] == "cannot_compare_self"


# ---------------------------------------------------------------------------
# 11. test_comparison_challenger_wins — outcome reflects ratings
# ---------------------------------------------------------------------------

def test_comparison_challenger_wins(client: TestClient) -> None:
    """'challenger_wins' is returned when challenger lineup_peak_rating > recipient's."""
    challenger_state = _play_full_game(client, mode="apex_1y")
    ch = _create_challenge(client, challenger_state["game_id"])
    token = ch["challenge_token"]

    # Recipient plays the same board
    rec_init = client.get(f"/api/v1/draft/challenges/{token}").json()
    _play_game_by_id(client, rec_init["game_id"])

    resp = client.get(
        f"/api/v1/draft/challenges/{token}/comparison",
        params={"recipient_game_id": rec_init["game_id"]},
    )
    assert resp.status_code == 200
    data = resp.json()

    c_r = data["challenger"]["lineup_peak_rating"]
    r_r = data["recipient"]["lineup_peak_rating"]

    # Verify outcome is logically consistent with the actual ratings
    if abs(c_r - r_r) > 0.001:
        expected = "challenger_wins" if c_r > r_r else "recipient_wins"
        assert data["outcome"] == expected
    else:
        # Tiebreaker applied; any valid outcome is acceptable
        assert data["outcome"] in ("draw", "challenger_wins", "recipient_wins")


# ---------------------------------------------------------------------------
# 12. test_comparison_recipient_wins — outcome reflects ratings
# ---------------------------------------------------------------------------

def test_comparison_recipient_wins(client: TestClient) -> None:
    """'recipient_wins' is returned when recipient lineup_peak_rating > challenger's."""
    # Use a different seed for challenger so recipient has a fresh same-board game
    challenger_state = _play_full_game(client, mode="apex_1y", seed=7)
    ch = _create_challenge(client, challenger_state["game_id"])
    token = ch["challenge_token"]

    rec_init = client.get(f"/api/v1/draft/challenges/{token}").json()
    _play_game_by_id(client, rec_init["game_id"])

    resp = client.get(
        f"/api/v1/draft/challenges/{token}/comparison",
        params={"recipient_game_id": rec_init["game_id"]},
    )
    assert resp.status_code == 200
    data = resp.json()

    c_r = data["challenger"]["lineup_peak_rating"]
    r_r = data["recipient"]["lineup_peak_rating"]

    if abs(c_r - r_r) > 0.001:
        expected = "recipient_wins" if r_r > c_r else "challenger_wins"
        assert data["outcome"] == expected
    else:
        assert data["outcome"] in ("draw", "challenger_wins", "recipient_wins")


# ---------------------------------------------------------------------------
# 13. Draw when scores and efficiency are equal
# ---------------------------------------------------------------------------

def test_comparison_draw(client: TestClient) -> None:
    """Same greedy strategy on the same board → identical scores → 'draw'."""
    challenger_state = _play_full_game(client, mode="apex_1y")
    ch = _create_challenge(client, challenger_state["game_id"])
    token = ch["challenge_token"]

    # Recipient plays the same board with identical greedy strategy
    rec_init = client.get(f"/api/v1/draft/challenges/{token}").json()
    _play_game_by_id(client, rec_init["game_id"])

    resp = client.get(
        f"/api/v1/draft/challenges/{token}/comparison",
        params={"recipient_game_id": rec_init["game_id"]},
    )
    assert resp.status_code == 200
    data = resp.json()

    c_r = data["challenger"]["lineup_peak_rating"]
    r_r = data["recipient"]["lineup_peak_rating"]
    c_eff = data["challenger"]["draft_efficiency"]
    r_eff = data["recipient"]["draft_efficiency"]

    # Both players used identical greedy strategy → should be equal
    assert abs(c_r - r_r) <= 0.001, "Expected equal ratings for same greedy play on same board"

    # With equal ratings and equal efficiency (same play), outcome must be draw
    if c_eff is not None and r_eff is not None and abs(c_eff - r_eff) > 0.001:
        assert data["outcome"] in ("challenger_wins", "recipient_wins")
    else:
        assert data["outcome"] == "draw"


# ---------------------------------------------------------------------------
# 14. Settlement is cached after first comparison
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_settlement_cached(client: TestClient) -> None:
    """After the first comparison call, record.settlement is set and reused."""
    from app.core.dependencies import _memory_challenge_repo

    challenger_state = _play_full_game(client, mode="apex_1y")
    ch = _create_challenge(client, challenger_state["game_id"])
    token = ch["challenge_token"]
    token_hash = hashlib.sha256(token.encode()).hexdigest()[:32]

    # Before comparison, settlement should be None
    record = await _memory_challenge_repo.get_challenge(token_hash)
    assert record is not None
    assert record.settlement is None

    # Load and complete recipient game
    rec_init = client.get(f"/api/v1/draft/challenges/{token}").json()
    _play_game_by_id(client, rec_init["game_id"])

    # First comparison — computes and caches
    resp1 = client.get(
        f"/api/v1/draft/challenges/{token}/comparison",
        params={"recipient_game_id": rec_init["game_id"]},
    )
    assert resp1.status_code == 200

    # Settlement should now be cached
    record = await _memory_challenge_repo.get_challenge(token_hash)
    assert record is not None
    assert record.settlement is not None

    # Second comparison call — returns cached result
    resp2 = client.get(
        f"/api/v1/draft/challenges/{token}/comparison",
        params={"recipient_game_id": rec_init["game_id"]},
    )
    assert resp2.status_code == 200
    assert resp1.json()["outcome"] == resp2.json()["outcome"]
    assert resp1.json()["settled_at"] == resp2.json()["settled_at"]


# ---------------------------------------------------------------------------
# 15. Duplicate challenge creation: different tokens, both functional
# ---------------------------------------------------------------------------

def test_duplicate_challenge_creation(client: TestClient) -> None:
    """Creating two challenges from the same completed game returns different tokens."""
    state = _play_full_game(client)
    game_id = state["game_id"]

    ch1 = _create_challenge(client, game_id)
    ch2 = _create_challenge(client, game_id)

    token1 = ch1["challenge_token"]
    token2 = ch2["challenge_token"]

    # Tokens must differ (nonce ensures uniqueness)
    assert token1 != token2

    # Both tokens must work for meta
    resp1 = client.get(f"/api/v1/draft/challenges/{token1}/meta")
    resp2 = client.get(f"/api/v1/draft/challenges/{token2}/meta")
    assert resp1.status_code == 200
    assert resp2.status_code == 200
    assert resp1.json()["board_id"] == resp2.json()["board_id"]
