"""Tests for HMAC session token security."""
from __future__ import annotations

import time

from app.core.security import create_session_token, verify_session_token

SECRET = "test-signing-secret-abc123"
OTHER_SECRET = "different-secret-xyz"


def _make_payload(mode: str = "daily") -> dict:
    return {
        "mode": mode,
        "years": 3,
        "date": "2026-06-28",
        "duels": [
            {"id": "duel-aabbccdd", "left_id": "player-001-3yr-200001", "right_id": "player-002-3yr-200102"},
        ],
    }


def test_create_and_verify_roundtrip() -> None:
    payload = _make_payload()
    token = create_session_token(payload, SECRET, ttl_seconds=3600)
    result = verify_session_token(token, SECRET)

    assert result is not None
    assert result["mode"] == "daily"
    assert result["years"] == 3
    assert len(result["duels"]) == 1
    assert "exp" in result


def test_expired_token_returns_none() -> None:
    payload = _make_payload()
    token = create_session_token(payload, SECRET, ttl_seconds=-1)  # already expired
    result = verify_session_token(token, SECRET)
    assert result is None


def test_tampered_payload_returns_none() -> None:
    payload = _make_payload()
    token = create_session_token(payload, SECRET, ttl_seconds=3600)

    # Flip one character in the payload portion
    parts = token.split(".")
    tampered_payload = parts[0][:-1] + ("A" if parts[0][-1] != "A" else "B")
    tampered_token = f"{tampered_payload}.{parts[1]}"

    result = verify_session_token(tampered_token, SECRET)
    assert result is None


def test_tampered_signature_returns_none() -> None:
    payload = _make_payload()
    token = create_session_token(payload, SECRET, ttl_seconds=3600)

    parts = token.split(".")
    tampered_sig = parts[1][:-4] + "XXXX"
    tampered_token = f"{parts[0]}.{tampered_sig}"

    result = verify_session_token(tampered_token, SECRET)
    assert result is None


def test_different_secret_returns_none() -> None:
    payload = _make_payload()
    token = create_session_token(payload, SECRET, ttl_seconds=3600)
    result = verify_session_token(token, OTHER_SECRET)
    assert result is None


def test_malformed_token_returns_none() -> None:
    for bad_token in ("", "notavalidtoken", "a.b.c", "onlyonepart"):
        result = verify_session_token(bad_token, SECRET)
        assert result is None, f"Expected None for token: {bad_token!r}"


def test_token_exp_is_in_future() -> None:
    payload = _make_payload()
    token = create_session_token(payload, SECRET, ttl_seconds=3600)
    decoded = verify_session_token(token, SECRET)
    assert decoded is not None
    assert decoded["exp"] > int(time.time())


def test_endless_mode_token_roundtrip() -> None:
    payload = {
        "mode": "endless",
        "years": 1,
        "seed": 42,
        "duels": [
            {"id": "duel-aabb", "left_id": "player-005-1yr-200506", "right_id": "player-010-1yr-200506"},
        ],
    }
    token = create_session_token(payload, SECRET, ttl_seconds=86400)
    result = verify_session_token(token, SECRET)
    assert result is not None
    assert result["mode"] == "endless"
    assert result["seed"] == 42
