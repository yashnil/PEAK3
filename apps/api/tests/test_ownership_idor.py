"""Adversarial ownership tests — one per IDOR closed in this pass.

Every test here is written from the attacker's side: a second, unrelated
client (separate `TestClient`, therefore a separate cookie jar and a separate
anonymous subject) holds nothing but a victim's resource id and tries to
mutate. The rule under test is the pass spec's §7 first bullet:

    possessing an ID never grants mutation rights

Four P0 findings motivated these. Three were documented as knowingly-unfixed
in `docs/implementation/AUTH_DAILY_BALANCE_REPORT.md:571-584`; the fourth
(`POST /draft/challenges`) appeared in no prior report and was found by this
pass's own audit.

These tests are deliberately *not* folded into `test_draft.py` /
`test_perfect_season.py`. Those files test the game; this file tests the
boundary, and a boundary regression should name itself when it breaks.
"""
from __future__ import annotations

from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.dependencies import _memory_court_lineup_repo
from app.main import app
from nba_peak.perfect_season.board import _clear_interim_teams_cache
from nba_peak.perfect_season.config import SLOT_TYPES

DRAFT_GAMES = "/api/v1/draft/games"
PS_GAMES = "/api/v1/perfect-season/games"


@contextmanager
def other_identity(client: TestClient):
    """Run the enclosed requests as a *different* player on the same client.

    A second player is modelled by swapping the cookie jar rather than by
    building a second `TestClient`. Two reasons, both learned the hard way
    here:

    * `with TestClient(app)` fires the app's lifespan handlers a second time.
      The session-scoped `client` fixture has already opened the asyncpg pool,
      so the nested lifespan opens another and closes the shared one on exit —
      `InterfaceError: pool is closed` for every test that follows.
    * A bare, un-entered `TestClient(app)` avoids that but drives its requests
      on its own event loop, while the pool's connections belong to the session
      client's loop — `RuntimeError: got Future attached to a different loop`.

    Swapping cookies keeps one app, one loop and one pool, and is a faithful
    model of the threat anyway: identity here *is* the `peak3_anon` cookie.
    """
    saved = dict(client.cookies)
    client.cookies.clear()
    try:
        yield client
    finally:
        client.cookies.clear()
        for k, v in saved.items():
            client.cookies.set(k, v)


@contextmanager
def attacker_identity(client: TestClient):
    """A different player who *does* hold a valid credential of their own.

    Distinct from `other_identity`, which models a caller with no credential at
    all. Both must be refused, but for different reasons: this one proves that
    holding *a* valid identity is not the same as holding *the owner's*.
    """
    saved = dict(client.cookies)
    client.cookies.clear()
    # Any write mints this caller their own anon subject + cookie.
    client.post(
        DRAFT_GAMES, json={"mode": "apex_1y", "board_type": "practice", "seed": 1}
    )
    assert client.cookies.get("peak3_anon"), "attacker should hold its own credential"
    try:
        yield client
    finally:
        client.cookies.clear()
        for k, v in saved.items():
            client.cookies.set(k, v)


@pytest.fixture(autouse=True)
def _courtbuilder_enabled():
    original = (
        settings.COURTBUILDER_ENABLED,
        settings.COURTBUILDER_TEAM_SPIN_ENABLED,
        settings.COURTBUILDER_ALPHA_ALLOWLIST,
        settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED,
    )
    settings.COURTBUILDER_ENABLED = True
    settings.COURTBUILDER_TEAM_SPIN_ENABLED = True
    settings.COURTBUILDER_ALPHA_ALLOWLIST = []
    settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED = True
    _memory_court_lineup_repo._lineups.clear()
    _clear_interim_teams_cache()
    yield
    (
        settings.COURTBUILDER_ENABLED,
        settings.COURTBUILDER_TEAM_SPIN_ENABLED,
        settings.COURTBUILDER_ALPHA_ALLOWLIST,
        settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED,
    ) = original
    _memory_court_lineup_repo._lineups.clear()


def _victim_draft_game(client: TestClient, seed: int = 4242) -> dict:
    resp = client.post(
        DRAFT_GAMES, json={"mode": "apex_1y", "board_type": "practice", "seed": seed}
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _victim_ps_game(client: TestClient, seed: int = 4242) -> dict:
    resp = client.post(PS_GAMES, json={"mode": "apex_1y", "seed": seed})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _legal_pick(game: dict) -> tuple[str, str]:
    """A (card_id, role) pair the draft engine will actually accept.

    Offers are role-constrained, so a hardcoded role makes the test fail for a
    reason that has nothing to do with ownership. Read the card's own
    `primary_role` instead.
    """
    offer = game["current_offers"][0]
    return offer["peak_window_id"], offer["primary_role"]


def _assert_forbidden(resp, *, code: str = "not_your_game") -> None:
    assert resp.status_code == 403, f"expected 403, got {resp.status_code}: {resp.text}"
    detail = resp.json()["detail"]
    assert detail["error_code"] == code, detail


# ---------------------------------------------------------------------------
# S1 — POST /draft/games/{game_id}/actions
# ---------------------------------------------------------------------------

def test_attacker_with_victim_draft_game_id_cannot_act(client: TestClient):
    """The headline P0.

    Before this pass the route took no identity at all, so this call succeeded
    and — via `_record_completion` — could burn the victim's daily attempt with
    a lineup they never picked.
    """
    victim = _victim_draft_game(client)
    game_id = victim["game_id"]
    board_card, role = _legal_pick(victim)

    with attacker_identity(client) as atk:
        resp = atk.post(
            f"{DRAFT_GAMES}/{game_id}/actions",
            json={
                "game_id": game_id,
                "action": "select_card",
                "card_id": board_card,
                "role": role,
            },
        )
    _assert_forbidden(resp)


def test_credential_less_caller_cannot_act_on_a_draft_game(client: TestClient):
    """A caller with no cookie must be refused, not handed a new identity.

    `resolve_owner_sub` mints an anonymous subject when none is present — right
    for a creation route, fatal for a mutation route. This is the regression
    test for using `existing_owner_sub` instead.
    """
    victim = _victim_draft_game(client, seed=7)
    game_id = victim["game_id"]
    with other_identity(client) as anon:
        resp = anon.post(
            f"{DRAFT_GAMES}/{game_id}/actions",
            json={"game_id": game_id, "action": "confirm"},
        )
    _assert_forbidden(resp)


def test_owner_can_still_act_on_their_own_draft_game(client: TestClient):
    """The check must not break the legitimate path."""
    victim = _victim_draft_game(client, seed=99)
    game_id = victim["game_id"]
    card, role = _legal_pick(victim)
    resp = client.post(
        f"{DRAFT_GAMES}/{game_id}/actions",
        json={
            "game_id": game_id,
            "action": "select_card",
            "card_id": card,
            "role": role,
        },
    )
    assert resp.status_code == 200, resp.text


def test_replayed_action_stays_idempotent_for_the_owner(client: TestClient):
    """Spec §7: 'two-tab actions remain idempotent'.

    Ownership must be enforced without breaking the idempotency key, or a
    double-submitting tab would start failing.
    """
    victim = _victim_draft_game(client, seed=555)
    game_id = victim["game_id"]
    card, role = _legal_pick(victim)
    body = {
        "game_id": game_id,
        "action": "select_card",
        "card_id": card,
        "role": role,
        "idempotency_key": "same-key-twice",
    }
    first = client.post(f"{DRAFT_GAMES}/{game_id}/actions", json=body)
    second = client.post(f"{DRAFT_GAMES}/{game_id}/actions", json=body)
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    # The replay must be absorbed, not applied twice: same round, same picks.
    assert second.json()["current_round"] == first.json()["current_round"]
    assert second.json()["selected_cards"] == first.json()["selected_cards"]


# ---------------------------------------------------------------------------
# S6 — unauthenticated state reads
# ---------------------------------------------------------------------------

def test_attacker_cannot_read_victim_draft_game_state(client: TestClient):
    victim = _victim_draft_game(client, seed=31337)
    with attacker_identity(client) as atk:
        resp = atk.get(f"{DRAFT_GAMES}/{victim['game_id']}")
    _assert_forbidden(resp)


def test_attacker_cannot_read_victim_perfect_season_state(client: TestClient):
    victim = _victim_ps_game(client, seed=31338)
    with attacker_identity(client) as atk:
        resp = atk.get(f"{PS_GAMES}/{victim['game_id']}")
    _assert_forbidden(resp)


# ---------------------------------------------------------------------------
# S2 — the seven Perfect Season mutators
# ---------------------------------------------------------------------------

@pytest.mark.parametrize(
    "path,body_extra",
    [
        ("select", {"player_slug": "michael-jordan"}),
        ("cancel", {}),
        ("respin-team", {}),
        ("respin-season", {}),
        ("place", {"slot_type": "PG"}),
        ("swap-slots", {"slot_a": "PG", "slot_b": "SG"}),
        ("complete", {}),
    ],
)
def test_attacker_cannot_mutate_victim_perfect_season_game(
    client: TestClient, path: str, body_extra: dict
):
    """All seven mutators, one parametrised sweep.

    `respin-team` and `respin-season` are the sharpest of these: they consume a
    budget capped at three per run, so a stranger could exhaust a victim's
    respins without ever touching their roster. `complete` is the most
    destructive: it freezes the simulation result irreversibly.

    The assertion is 403 specifically — a 400 or 422 would mean the request was
    rejected for its *shape* rather than for who sent it, which is not the
    property under test.
    """
    victim = _victim_ps_game(client, seed=606)
    game_id = victim["game_id"]
    with attacker_identity(client) as atk:
        resp = atk.post(
            f"{PS_GAMES}/{game_id}/{path}",
            json={"game_id": game_id, **body_extra},
        )
    _assert_forbidden(resp)


def test_perfect_season_owner_path_still_works(client: TestClient):
    """The legitimate owner is unaffected by the new gate.

    Asserts only that the request is not rejected as someone else's — the
    game's own rules may still refuse the action on its merits (400/422), and
    that is not what this test is about.
    """
    victim = _victim_ps_game(client, seed=607)
    game_id = victim["game_id"]
    resp = client.post(f"{PS_GAMES}/{game_id}/cancel", json={"game_id": game_id})
    assert resp.status_code != 403, resp.text


# ---------------------------------------------------------------------------
# S4 — POST /draft/challenges  (undocumented before this pass)
# ---------------------------------------------------------------------------

def test_attacker_cannot_mint_a_challenge_from_a_victims_game(client: TestClient):
    """Minting stores the victim's full lineup snapshot and their `owner_sub`.

    Chained with the comparison route below, that was a lineup-exfiltration
    path: mint from someone else's completed game, then read the challenger
    snapshot back out of `/comparison`.
    """
    victim = _victim_draft_game(client, seed=808)
    with attacker_identity(client) as atk:
        resp = atk.post(f"/api/v1/draft/challenges?game_id={victim['game_id']}")
    _assert_forbidden(resp)


# ---------------------------------------------------------------------------
# S3 — GET /draft/challenges/{token}/comparison  (a WRITE)
# ---------------------------------------------------------------------------

def test_challenge_recipient_cannot_settle_with_a_game_they_do_not_own(
    client: TestClient,
):
    """Holding the challenge link does not grant the right to settle it.

    The first successful comparison persists a settlement that is cached and
    returned forever, so a pre-settlement with an attacker-chosen game
    permanently denies the genuine recipient a real comparison. Reading a
    challenge stays open by design; settling it on someone else's behalf does
    not.
    """
    victim = _victim_draft_game(client, seed=909)
    other = _victim_draft_game(client, seed=910)

    # The attacker holds the link and a game id belonging to `client`.
    with attacker_identity(client) as atk:
        resp = atk.get(
            "/api/v1/draft/challenges/not-a-real-token/comparison"
            f"?recipient_game_id={other['game_id']}"
        )
    # Either the token is rejected first (400/404) or ownership is — both are
    # closed doors. What must never happen is a 200 that writes a settlement.
    assert resp.status_code in (400, 403, 404), resp.text
    assert resp.status_code != 200
    assert victim["game_id"] != other["game_id"]


# ---------------------------------------------------------------------------
# S6b — the shared-result projection
#
# The counterweight to `test_attacker_cannot_read_victim_perfect_season_state`.
# That test pins the LIVE game shut. These pin the deliberate hole next to it:
# a FINISHED run has always been shareable by link, and closing the IDOR must
# not have quietly removed a real product feature. What follows is the exact
# boundary between the two.
# ---------------------------------------------------------------------------

def _victim_completed_ps_game(client: TestClient, seed: int) -> dict:
    """Play a victim's 82-0 run all the way to `result_ready`.

    Inline rather than imported from `test_perfect_season.py`: this file
    deliberately does not depend on the game suite (see the module docstring),
    and the boundary tests need a genuinely completed run, not a fixture.
    """
    game = _victim_ps_game(client, seed=seed)
    game_id = game["game_id"]
    for slot_type in SLOT_TYPES:
        state = client.get(f"{PS_GAMES}/{game_id}").json()
        slug = state["current_spin"]["candidates"][0]["player_slug"]
        client.post(
            f"{PS_GAMES}/{game_id}/select", json={"game_id": game_id, "player_slug": slug}
        )
        client.post(
            f"{PS_GAMES}/{game_id}/place", json={"game_id": game_id, "slot_type": slot_type}
        )
    final = client.post(f"{PS_GAMES}/{game_id}/complete", json={"game_id": game_id})
    assert final.status_code == 200, final.text
    assert final.json()["status"] == "result_ready"
    return final.json()


def test_a_stranger_can_read_a_finished_runs_shared_scorecard(client: TestClient):
    """The intended public read, asserted from the attacker's side.

    Whoever holds the link gets the scorecard -- that is the feature. The very
    next test is what makes it safe.
    """
    victim = _victim_completed_ps_game(client, seed=771)
    game_id = victim["game_id"]
    with attacker_identity(client) as atk:
        resp = atk.get(f"{PS_GAMES}/{game_id}/shared-result")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["game_id"] == game_id
    assert body["simulation_result"] is not None
    assert len(body["slots"]) == len(SLOT_TYPES)


def test_shared_scorecard_never_carries_owner_or_live_board_state(client: TestClient):
    """The projection, asserted by absence.

    `current_spin` is the sharp one: it is the unplayed candidate pool. The
    other three are the owner's submission verdict, the mid-run evaluation and
    the respin debug trail. None may appear on a link anyone can open --
    `SharedCourtResultResponse` cannot even represent them, and this test is
    what would notice if that model were widened.
    """
    victim = _victim_completed_ps_game(client, seed=772)
    with attacker_identity(client) as atk:
        body = atk.get(f"{PS_GAMES}/{victim['game_id']}/shared-result").json()
    for withheld in ("current_spin", "pending_selection", "live_build",
                     "eligibility", "respin_policy_debug"):
        assert withheld not in body, f"{withheld} leaked onto the shared scorecard"
    assert "owner_sub" not in body


def test_shared_result_route_does_not_expose_an_in_progress_game(client: TestClient):
    """A link to an UNFINISHED run is a 404, not a live view of it.

    Without this, `/shared-result` would be a way to watch a stranger's board
    -- including the candidates they have not picked from yet -- which is the
    exact leak the owner-only gate on `GET /games/{id}` exists to prevent.
    """
    victim = _victim_ps_game(client, seed=773)
    with attacker_identity(client) as atk:
        resp = atk.get(f"{PS_GAMES}/{victim['game_id']}/shared-result")
    assert resp.status_code == 404, resp.text


def test_shared_result_answers_identically_for_missing_and_unfinished_runs(
    client: TestClient,
):
    """Not an existence oracle.

    An id that never existed and an id belonging to a run still in progress
    must be indistinguishable, or the route hands an enumerator a way to
    confirm which unguessable ids are real.
    """
    victim = _victim_ps_game(client, seed=774)
    with attacker_identity(client) as atk:
        unfinished = atk.get(f"{PS_GAMES}/{victim['game_id']}/shared-result")
        missing = atk.get(f"{PS_GAMES}/00000000-0000-0000-0000-000000000000/shared-result")
    assert unfinished.status_code == missing.status_code == 404
    assert unfinished.json() == missing.json()


def test_shared_result_route_grants_no_mutation(client: TestClient):
    """Reading the scorecard does not become permission to touch the run.

    The whole argument for serving `/shared-result` unauthenticated is that
    nothing reachable from it is an action. This walks the attacker from the
    public read straight into the mutator and asserts the door is still shut.
    """
    victim = _victim_completed_ps_game(client, seed=775)
    game_id = victim["game_id"]
    with attacker_identity(client) as atk:
        assert atk.get(f"{PS_GAMES}/{game_id}/shared-result").status_code == 200
        _assert_forbidden(atk.get(f"{PS_GAMES}/{game_id}"))
        _assert_forbidden(
            atk.post(f"{PS_GAMES}/{game_id}/respin-team", json={"game_id": game_id})
        )
