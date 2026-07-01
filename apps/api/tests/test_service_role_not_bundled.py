"""Service-role key must never be bundled into frontend output (spec section A).

Unlike the rest of the Supabase integration suite, this check needs no live
Supabase project — it is a static scan of the already-built Next.js output
and does not touch the `supabase_integration` marker, so it always runs.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
NEXT_BUILD_DIR = REPO_ROOT / "apps" / "web" / ".next"

# A real Supabase service-role key is itself a JWT (three base64url segments)
# whose payload contains `"role":"service_role"`. Rather than search for one
# literal secret value, decode every JWT-shaped string found in the bundle
# and check its role claim — this catches the key regardless of which
# project it came from.
JWT_SHAPE = re.compile(rb"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


def _decode_jwt_payload(token: bytes) -> dict | None:
    import base64
    import json

    try:
        parts = token.split(b".")
        if len(parts) != 3:
            return None
        payload_b64 = parts[1] + b"=" * (-len(parts[1]) % 4)
        return json.loads(base64.urlsafe_b64decode(payload_b64))
    except Exception:
        return None


def test_service_role_key_never_appears_in_built_frontend_output() -> None:
    if not NEXT_BUILD_DIR.exists():
        pytest.skip(
            f"No Next.js build output at {NEXT_BUILD_DIR} — run `cd apps/web && npm run build` first. "
            "This is a 'not built yet' skip, distinct from the Supabase-integration 'not configured' skip."
        )

    offenders: list[str] = []
    for path in NEXT_BUILD_DIR.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix not in (".js", ".mjs", ".json", ".txt", ""):
            continue
        try:
            data = path.read_bytes()
        except OSError:
            continue
        for match in JWT_SHAPE.finditer(data):
            payload = _decode_jwt_payload(match.group(0))
            if payload and payload.get("role") == "service_role":
                offenders.append(str(path.relative_to(NEXT_BUILD_DIR)))

    assert not offenders, f"service_role JWT found bundled in frontend output: {offenders}"


def test_frontend_env_example_never_declares_a_public_service_role_var() -> None:
    """A NEXT_PUBLIC_-prefixed env var is inlined into the client bundle by
    Next.js at build time — a service-role key must never be declared under
    that prefix in .env.example, since that would guarantee bundling.
    """
    env_example = REPO_ROOT / "apps" / "web" / ".env.example"
    if not env_example.exists():
        pytest.skip(f"{env_example} not found")
    content = env_example.read_text()
    for line in content.splitlines():
        if line.strip().startswith("NEXT_PUBLIC_") and "SERVICE_ROLE" in line.upper():
            pytest.fail(f"service-role key declared under a NEXT_PUBLIC_ prefix: {line!r}")
