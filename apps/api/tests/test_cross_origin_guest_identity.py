"""The guest-identity cookie must survive a split-origin deployment.

WHAT BROKE. `resolve_owner_sub` issued the `peak3_anon` cookie with
`SameSite=Lax`. On staging the web app is served from `*.vercel.app` and the
API from `*.up.railway.app`, which are different registrable domains, so every
API call is CROSS-SITE — and a browser does not send a `SameSite=Lax` cookie on
a cross-site `fetch` at all. The cookie the API had just issued never came
back, so each request minted a fresh `anon:` subject.

The symptom looked like an ownership bug and was not one:

    POST /perfect-season/games            -> 200   (owner: anon:A)
    GET  /perfect-season/games/{id}       -> 403   not_your_game (caller: anon:B)

Reproduced against hosted staging before the fix. Nothing was wrong with the
ownership check; the identity was being discarded between requests.

These tests pin the cookie ATTRIBUTES rather than the behaviour of any one
route, because the attributes are the whole bug and they are invisible in every
same-origin test — the local suite and local development are both same-site, so
`Lax` works perfectly there and would keep working forever.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.core.auth import anon_cookie_attributes
from app.core.config import settings


@pytest.fixture(autouse=True)
def _courtbuilder_enabled():
    """82-0 is flag-gated and off by default in this suite."""
    original = (settings.COURTBUILDER_ENABLED, settings.COURTBUILDER_READINESS_LEVEL)
    settings.COURTBUILDER_ENABLED = True
    settings.COURTBUILDER_READINESS_LEVEL = "internal_dev"
    yield
    settings.COURTBUILDER_ENABLED, settings.COURTBUILDER_READINESS_LEVEL = original


def _anon_set_cookie_header(client: TestClient) -> str:
    """Issue a NEW guest identity and return the raw Set-Cookie header.

    Must be a cookie-less client. `resolve_owner_sub` only sets a cookie when
    it has to mint a subject, so a client that already carries a valid
    `peak3_anon` (the session-scoped `client` fixture does, once any earlier
    test has touched it) correctly reuses it and sets no header at all.
    """
    resp = client.post(
        "/api/v1/perfect-season/games",
        json={"mode": "apex_1y", "challenge_kind": "free_play"},
    )
    assert resp.status_code == 200, resp.text
    raw = resp.headers.get("set-cookie", "")
    assert "peak3_anon=" in raw, f"no guest cookie issued: {raw!r}"
    return raw


class TestCookieAttributesFollowTheDeployment:
    def test_deployed_cookie_is_samesite_none_and_secure(self, monkeypatch):
        """Cross-site delivery is opt-in and browsers demand Secure with it."""
        from app.core import config as config_module

        monkeypatch.setattr(config_module.settings, "DEBUG", False)
        attrs = anon_cookie_attributes()
        assert attrs["samesite"] == "none", (
            "a Lax cookie is never sent from the web origin to a different-site "
            "API origin, which silently destroys guest identity"
        )
        assert attrs["secure"] is True, "SameSite=None without Secure is rejected by browsers"

    def test_local_cookie_stays_lax_and_insecure(self, monkeypatch):
        """Local dev is same-site and plain HTTP, where None+Secure is refused."""
        from app.core import config as config_module

        monkeypatch.setattr(config_module.settings, "DEBUG", True)
        attrs = anon_cookie_attributes()
        assert attrs["samesite"] == "lax"
        assert attrs["secure"] is False

    def test_the_issued_cookie_uses_those_attributes(self, client: TestClient):
        """The helper is not decorative — the real Set-Cookie must reflect it.

        Asserted against `anon_cookie_attributes()` rather than against a
        hardcoded mode: flipping `settings.DEBUG` at runtime also flips the
        repository layer into production, where it refuses to hand out
        in-memory repos, so the request cannot be made under a forced mode.
        Agreement is the property that matters — a future edit that changes one
        without the other is what this catches.
        """
        expected = anon_cookie_attributes()
        with TestClient(client.app) as fresh:
            raw = _anon_set_cookie_header(fresh).lower()
        assert f"samesite={expected['samesite']}" in raw, raw
        if expected["secure"]:
            assert "secure" in raw, raw
        # Never readable from JavaScript, cross-site or not.
        assert "httponly" in raw, raw


class TestGuestIdentityIsContinuous:
    def test_a_guest_keeps_one_identity_across_requests(self, client: TestClient):
        """The property the cookie exists to provide, stated end to end.

        `TestClient` carries cookies like a same-site browser, so this passes
        both before and after the fix — it is here to catch a regression that
        drops the cookie entirely, which the attribute tests above cannot see.
        """
        created = client.post(
            "/api/v1/perfect-season/games",
            json={"mode": "apex_1y", "challenge_kind": "free_play"},
        )
        assert created.status_code == 200, created.text
        game_id = created.json()["game_id"]

        again = client.get(f"/api/v1/perfect-season/games/{game_id}")
        assert again.status_code == 200, (
            "the creator could not read back its own run — the guest identity "
            f"was not carried: {again.text}"
        )

    def test_a_different_guest_is_still_refused(self, client: TestClient):
        """Continuity must not become permissiveness.

        Widening a cookie to `SameSite=None` makes it travel further, so the
        ownership check has to stay exactly as strict.
        """
        created = client.post(
            "/api/v1/perfect-season/games",
            json={"mode": "apex_1y", "challenge_kind": "free_play"},
        )
        game_id = created.json()["game_id"]

        # A caller presenting no cookie at all is a different (new) guest.
        with TestClient(client.app) as stranger:
            resp = stranger.get(f"/api/v1/perfect-season/games/{game_id}")
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["error_code"] == "not_your_game"


class TestSignedInCreationIsOwnedByTheAccount:
    """The other half of the staging failure.

    The browser client sent no `Authorization` on create/load/respin/select, so
    a signed-in player's run was filed under a guest subject even when the
    cookie worked. The API side was always correct — `resolve_owner_sub`
    prefers a verified `sub` over any cookie — so this pins the contract the
    frontend fix now depends on.
    """

    def test_a_verified_subject_beats_any_guest_cookie(self, client: TestClient, monkeypatch):
        from app.core.auth import AuthSubject, resolve_owner_sub
        from fastapi import Response

        real = AuthSubject(sub="user-123", email="a@example.com", is_anonymous=False, raw_claims={})
        # A guest cookie is present AND valid; the account must still win.
        from app.core.security import create_session_token

        guest_cookie = create_session_token({"sub": "anon:someone-else"}, "secret", ttl_seconds=999)
        owner = resolve_owner_sub(real, guest_cookie, Response(), "secret")
        assert owner == "user-123", "an authenticated request must never be filed as a guest"

    def test_owner_is_never_taken_from_the_request_body(self, client: TestClient):
        """A client-supplied owner must be ignored, not honoured."""
        created = client.post(
            "/api/v1/perfect-season/games",
            json={
                "mode": "apex_1y",
                "challenge_kind": "free_play",
                # Not part of the schema; if it were ever honoured this would
                # let anyone create a run owned by somebody else.
                "owner_sub": "user-victim",
            },
        )
        assert created.status_code == 200, created.text
        game_id = created.json()["game_id"]
        # The creator (a guest) still owns it, so the creator can still read it.
        assert client.get(f"/api/v1/perfect-season/games/{game_id}").status_code == 200
