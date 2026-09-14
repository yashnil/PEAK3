"""Contact / feedback — API-layer tests (launch-polish IMPLEMENTATION_CONTRACT.md
§9).

Modeled on test_telemetry.py's structure. WHAT THIS FILE IS ACTUALLY
GUARDING, beyond "submission works":

  1. The category/relevant_area vocabularies are CLOSED -- an unreviewed
     value is a 422, not silently accepted.
  2. The raw subject is NEVER stored -- subject_hash is a 64-hex HMAC that
     does not equal (and cannot be reversed to) the account sub or the
     anon cookie token.
  3. The honeypot field silently drops a submission while still looking
     like success to whatever filled it.
  4. Storage failure surfaces as a real error (503), unlike telemetry's
     deliberately-swallowed failures -- this is the one place this
     codebase's two "what happens when the database write fails" postures
     diverge, and both need their own test.
  5. There is no GET route -- "never exposed through the client DB key"
     extends to there being no HTTP read path at all, not just an RLS-denied
     one.

The flag is ON for most of this file via an autouse fixture, same pattern
as test_telemetry.py -- the disabled path gets its own explicit test.
"""
from __future__ import annotations

import asyncio
import re
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.contact import CONTACT_CATEGORIES, CONTACT_RELEVANT_AREAS, hash_subject, subject_kind

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

CONTACT_URL = "/api/v1/contact"
_HEX64 = re.compile(r"^[0-9a-f]{64}$")


def test_rls_migration_denies_every_client_verb():
    """The local Supabase migration must enable RLS, deny every verb via an
    explicit policy, AND revoke the default anon/authenticated grant --
    matching telemetry_events' own "two layers, both must be undone
    deliberately" posture (20260801120000_telemetry_events.sql). A static
    content check, not a live Postgres test -- no hosted Supabase is
    touched."""
    migration_path = _repo_root / "supabase" / "migrations" / "20260803110000_contact_submissions.sql"
    assert migration_path.exists()
    sql = migration_path.read_text()
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "contact_submissions_no_client_access" in sql
    assert "FOR ALL USING (false) WITH CHECK (false)" in sql
    assert "REVOKE SELECT, INSERT, UPDATE, DELETE ON contact_submissions FROM anon, authenticated" in sql
    # No client-facing read/write policy of any kind.
    assert "FOR SELECT" not in sql
    assert "FOR INSERT" not in sql
    assert "FOR UPDATE" not in sql
    assert "FOR DELETE" not in sql


def _valid_body(**overrides) -> dict:
    body = {
        "category": "bug",
        "relevant_area": "peak_season_82_0",
        "subject": "Court floor renders black in light mode",
        "message": "The 82-0 court background stays dark even after switching to light theme.",
    }
    body.update(overrides)
    return body


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


#: Same shared-secret HS256 scheme test_perfect_season.py's
#: leaderboard_client fixture and apps/web/src/tests/e2e/helpers/test-jwt.ts
#: use, so no live Supabase project is needed to test the authenticated path.
TEST_JWT_SECRET = "e2e-ranked-test-secret-do-not-use-in-prod"


@pytest.fixture(autouse=True)
def _enable_contact(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "CONTACT_ENABLED", True, raising=False)
    monkeypatch.setattr(settings, "SUPABASE_JWT_SECRET", TEST_JWT_SECRET, raising=False)
    yield


@pytest.fixture(autouse=True)
def _clean_store():
    """Every test starts with an empty in-memory contact store -- it's a
    module-level singleton, same reasoning as telemetry's own fixture."""
    from app.api.v1.contact import _memory_contact_repo

    asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        _memory_contact_repo.clear()
    )
    yield


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


def _stored():
    from app.api.v1.contact import _memory_contact_repo

    return asyncio.get_event_loop_policy().new_event_loop().run_until_complete(
        _memory_contact_repo.list_recent(500)
    )


def _mint_test_jwt(sub: str, email: str = "test@example.com") -> str:
    import time

    import jwt as _jwt

    payload = {
        "sub": sub, "email": email, "is_anonymous": False,
        "aud": "authenticated", "role": "authenticated",
        "iat": int(time.time()), "exp": int(time.time()) + 3600,
    }
    return _jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


# ---------------------------------------------------------------------------
# Off by default
# ---------------------------------------------------------------------------


def test_disabled_by_default(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "CONTACT_ENABLED", False, raising=False)
    with TestClient(app) as c:
        resp = c.post(CONTACT_URL, json=_valid_body())
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_code"] == "contact_disabled"
    assert _stored() == []


# ---------------------------------------------------------------------------
# Happy path — anonymous and authenticated
# ---------------------------------------------------------------------------


def test_anonymous_submission_is_accepted_and_stored(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body())
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["accepted"] is True
    assert body["request_id"]

    rows = _stored()
    assert len(rows) == 1
    assert rows[0].subject_kind == "anon"
    assert rows[0].category == "bug"
    assert rows[0].message == _valid_body()["message"]


def test_authenticated_submission_is_accepted_and_hashes_the_real_sub(client: TestClient):
    from app.core.config import settings

    token = _mint_test_jwt("real-user-sub-12345")
    resp = client.post(
        CONTACT_URL, json=_valid_body(), headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 202, resp.text

    rows = _stored()
    assert len(rows) == 1
    assert rows[0].subject_kind == "user"
    expected_hash = hash_subject("real-user-sub-12345", settings.SIGNING_SECRET)
    assert rows[0].subject_hash == expected_hash


def test_reply_email_is_optional_and_stored_when_given(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(reply_email="player@example.com"))
    assert resp.status_code == 202, resp.text
    assert _stored()[0].reply_email == "player@example.com"

    resp2 = client.post(CONTACT_URL, json=_valid_body())
    assert resp2.status_code == 202, resp2.text
    assert _stored()[0].reply_email is None


# ---------------------------------------------------------------------------
# Closed vocabularies
# ---------------------------------------------------------------------------


def test_the_shipped_category_list_is_exactly_the_reviewed_set():
    assert set(CONTACT_CATEGORIES) == {
        "new_mode", "improve_mode", "bug", "question_ranking_or_data",
        "accessibility", "account_or_privacy", "partnership_or_press", "other",
        # Homepage feedback kinds (20260914100000_contact_feedback_categories.sql).
        "game_idea", "dislike", "weakness", "general_feedback", "question",
    }


def test_the_shipped_relevant_area_list_is_exactly_the_reviewed_set():
    assert set(CONTACT_RELEVANT_AREAS) == {
        "daily_grid", "peak_season_82_0", "run_the_table", "ranked",
        "rankings_model", "account", "other",
    }


def test_unknown_category_is_rejected(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(category="not_a_real_category"))
    assert resp.status_code == 422
    assert _stored() == []


def test_unknown_relevant_area_is_rejected(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(relevant_area="not_a_real_area"))
    assert resp.status_code == 422
    assert _stored() == []


def test_relevant_area_is_optional(client: TestClient):
    body = _valid_body()
    del body["relevant_area"]
    resp = client.post(CONTACT_URL, json=body)
    assert resp.status_code == 202, resp.text
    assert _stored()[0].relevant_area is None


# ---------------------------------------------------------------------------
# Length / content bounds
# ---------------------------------------------------------------------------


def test_blank_subject_is_rejected(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(subject="   "))
    assert resp.status_code == 422
    assert _stored() == []


def test_blank_message_is_rejected(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(message=""))
    assert resp.status_code == 422
    assert _stored() == []


def test_oversized_message_is_rejected(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(message="x" * 4001))
    assert resp.status_code == 422
    assert _stored() == []


def test_message_at_the_length_ceiling_is_accepted(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(message="x" * 4000))
    assert resp.status_code == 202, resp.text


def test_oversized_subject_is_rejected(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(subject="x" * 201))
    assert resp.status_code == 422
    assert _stored() == []


def test_malformed_reply_email_is_rejected(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(reply_email="not-an-email"))
    assert resp.status_code == 422
    assert _stored() == []


# ---------------------------------------------------------------------------
# Honeypot
# ---------------------------------------------------------------------------


def test_honeypot_field_filled_looks_like_success_but_stores_nothing(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(website="http://spam.example"))
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["accepted"] is True
    assert body["request_id"]  # still gets a request_id, indistinguishable from real success
    assert _stored() == [], "a filled honeypot must never reach storage"


def test_honeypot_field_empty_or_absent_does_not_block_submission(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(website=""))
    assert resp.status_code == 202, resp.text
    assert len(_stored()) == 1

    body = _valid_body()
    assert "website" not in body  # confirms omitting it entirely also works (default "")
    resp2 = client.post(CONTACT_URL, json=body)
    assert resp2.status_code == 202, resp2.text
    assert len(_stored()) == 2


# ---------------------------------------------------------------------------
# Never stores the raw subject
# ---------------------------------------------------------------------------


def test_subject_hash_is_never_the_raw_sub_or_anon_token(client: TestClient):
    token = _mint_test_jwt("a-very-identifiable-real-sub")
    client.post(CONTACT_URL, json=_valid_body(), headers={"Authorization": f"Bearer {token}"})
    row = _stored()[0]
    assert _HEX64.match(row.subject_hash)
    assert "a-very-identifiable-real-sub" not in row.subject_hash


def test_subject_kind_helper_classifies_anon_vs_user():
    assert subject_kind("anon:abc123") == "anon"
    assert subject_kind("00000000-0000-0000-0000-000000000000") == "user"


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------


def test_rate_limit_returns_429_with_retry_after(client: TestClient):
    from app.core.config import settings
    from app.core.rate_limit import limiter

    # Warm-up: the first call is the one that MINTS the anon cookie, and
    # `client_key` folds that cookie's subject into the bucket key -- so
    # without this the pre-cookie request and the post-cookie ones land in
    # two different buckets and the boundary below is off by one (see
    # test_telemetry.py::TestRateLimiting's identical warm-up).
    client.post(CONTACT_URL, json=_valid_body())
    limiter.reset()

    for _ in range(settings.CONTACT_RATE_LIMIT):
        resp = client.post(CONTACT_URL, json=_valid_body())
        assert resp.status_code == 202, resp.text

    limited = client.post(CONTACT_URL, json=_valid_body())
    assert limited.status_code == 429
    assert limited.json()["detail"]["error_code"] == "rate_limited"
    assert "Retry-After" in limited.headers
    # No remaining-budget number leaked in the body, matching telemetry's
    # own posture: a countdown is the calibration signal an abuser wants.
    assert not re.search(r"\d", limited.json()["detail"]["message"])


# ---------------------------------------------------------------------------
# Storage failure surfaces honestly (unlike telemetry's swallow-and-continue)
# ---------------------------------------------------------------------------


def test_storage_failure_returns_503_not_a_false_success(client: TestClient, monkeypatch):
    from app.repositories.contact_memory import MemoryContactRepository

    async def _boom(self, submission):
        raise RuntimeError("simulated storage outage")

    monkeypatch.setattr(MemoryContactRepository, "record", _boom)

    resp = client.post(CONTACT_URL, json=_valid_body())
    assert resp.status_code == 503
    assert resp.json()["detail"]["error_code"] == "storage_unavailable"


# ---------------------------------------------------------------------------
# No read path
# ---------------------------------------------------------------------------


def test_there_is_no_get_route(client: TestClient):
    resp = client.get(CONTACT_URL)
    assert resp.status_code in (404, 405)


# ---------------------------------------------------------------------------
# Homepage feedback kinds (20260914100000_contact_feedback_categories.sql)
# ---------------------------------------------------------------------------

#: The six kinds the homepage feedback section offers, each a real stored
#: category -- mirrors apps/web/src/lib/contact-api.ts's HOME_FEEDBACK_KINDS.
HOME_FEEDBACK_CATEGORIES = ("game_idea", "bug", "dislike", "weakness", "question", "general_feedback")

_FEEDBACK_MIGRATION = "20260914100000_contact_feedback_categories.sql"


def _sql_without_comments(sql: str) -> str:
    return "\n".join(line.split("--", 1)[0] for line in sql.splitlines())


def _category_check_values(sql: str) -> set[str]:
    match = re.search(r"category IN \((.*?)\)\s*\)", sql, re.DOTALL)
    assert match, "no category CHECK found"
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


def test_feedback_migration_check_matches_the_python_vocabulary_exactly():
    """The database's category CHECK and CONTACT_CATEGORIES must be the same
    set -- a value only one side knows is either a 422 the UI can't explain
    or a 503 on insert."""
    sql = _sql_without_comments(
        (_repo_root / "supabase" / "migrations" / _FEEDBACK_MIGRATION).read_text()
    )
    assert _category_check_values(sql) == set(CONTACT_CATEGORIES)


def test_feedback_migration_is_additive_and_leaves_access_control_alone():
    migrations = _repo_root / "supabase" / "migrations"
    original = _sql_without_comments((migrations / "20260803110000_contact_submissions.sql").read_text())
    new = _sql_without_comments((migrations / _FEEDBACK_MIGRATION).read_text())

    assert _category_check_values(original) <= _category_check_values(new), "a stored category value was removed"
    # Replaces exactly the category constraint, under its Postgres-derived name.
    assert "DROP CONSTRAINT IF EXISTS contact_submissions_category_check" in new
    assert "ADD CONSTRAINT contact_submissions_category_check" in new
    # Never loosens the table's write-only posture.
    for forbidden in ("POLICY", "GRANT", "REVOKE", "ROW LEVEL SECURITY", "DROP TABLE", "DROP COLUMN"):
        assert forbidden not in new.upper(), forbidden


@pytest.mark.parametrize("category", HOME_FEEDBACK_CATEGORIES)
def test_each_homepage_feedback_kind_is_accepted_and_stored_as_itself(client: TestClient, category: str):
    # The homepage form's shape: no relevant_area, no reply email.
    body = {
        "category": category,
        "subject": "The draft timer felt too short",
        "message": "The draft timer felt too short on mobile.",
    }
    resp = client.post(CONTACT_URL, json=body)
    assert resp.status_code == 202, resp.text
    rows = _stored()
    assert len(rows) == 1
    assert rows[0].category == category
    assert rows[0].relevant_area is None
    assert rows[0].reply_email is None


def test_accepted_response_never_echoes_the_submitted_text(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(category="question"))
    assert resp.status_code == 202, resp.text
    assert set(resp.json()) == {"request_id", "accepted"}
    assert _valid_body()["message"] not in resp.text


def test_whitespace_only_message_is_rejected(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(category="game_idea", message="  \n\t  "))
    assert resp.status_code == 422
    assert _stored() == []


def test_oversized_reply_email_is_rejected(client: TestClient):
    long_email = ("x" * 315) + "@a.com"  # 321 characters, well-shaped otherwise
    assert len(long_email) == 321
    resp = client.post(CONTACT_URL, json=_valid_body(category="dislike", reply_email=long_email))
    assert resp.status_code == 422
    assert _stored() == []


def test_oversized_honeypot_is_rejected_without_storing(client: TestClient):
    resp = client.post(CONTACT_URL, json=_valid_body(website="x" * 201))
    assert resp.status_code == 422
    assert _stored() == []


@pytest.mark.parametrize("category", HOME_FEEDBACK_CATEGORIES)
def test_honeypot_with_a_feedback_kind_looks_like_success_and_stores_nothing(client: TestClient, category: str):
    real = client.post(CONTACT_URL, json=_valid_body(category="weakness"))
    trapped = client.post(CONTACT_URL, json=_valid_body(category=category, website="https://spam.example"))
    assert trapped.status_code == real.status_code == 202
    assert set(trapped.json()) == set(real.json())
    assert len(_stored()) == 1, "only the real submission may reach storage"


def test_rate_limited_submission_writes_nothing(client: TestClient):
    from app.core.config import settings
    from app.core.rate_limit import limiter

    client.post(CONTACT_URL, json=_valid_body())  # warm-up mints the anon cookie (see above)
    limiter.reset()
    before = len(_stored())

    for _ in range(settings.CONTACT_RATE_LIMIT):
        assert client.post(CONTACT_URL, json=_valid_body(category="general_feedback")).status_code == 202

    limited = client.post(CONTACT_URL, json=_valid_body(category="general_feedback"))
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0
    assert len(_stored()) == before + settings.CONTACT_RATE_LIMIT


@pytest.mark.parametrize("category", HOME_FEEDBACK_CATEGORIES)
def test_disabled_flag_rejects_feedback_kinds_and_writes_nothing(monkeypatch, category: str):
    from app.core.config import settings

    monkeypatch.setattr(settings, "CONTACT_ENABLED", False, raising=False)
    with TestClient(app) as c:
        resp = c.post(CONTACT_URL, json=_valid_body(category=category))
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_code"] == "contact_disabled"
    assert _stored() == []


def test_contact_routes_are_write_only(client: TestClient):
    """Private storage: the stored row is reachable through the repository
    (the only reader) but no HTTP route under /api/v1/contact reads."""
    resp = client.post(CONTACT_URL, json=_valid_body(category="question"))
    assert resp.status_code == 202, resp.text
    request_id = resp.json()["request_id"]
    assert [r.id for r in _stored()] == [request_id]

    # The OpenAPI schema, not `app.routes`: included routers are registered
    # lazily in this FastAPI version, so a flat route walk sees none of them.
    contact_paths = {
        path: set(ops) for path, ops in app.openapi()["paths"].items() if path.startswith(CONTACT_URL)
    }
    assert contact_paths, "the contact route is not registered"
    for path, methods in contact_paths.items():
        assert methods == {"post"}, f"{path} exposes {methods}"

    assert client.get(f"{CONTACT_URL}/{request_id}").status_code in (404, 405)
