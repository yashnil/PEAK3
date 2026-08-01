"""RUN THE TABLE — API-layer tests.

The engine itself is covered by tests/run_the_table/ at the repo root
(determinism, roster legality, pricing, battle resolution, replay). These tests
cover only what the HTTP layer adds:

  1. the routes are wired and return the shapes the client contract declares
  2. ANONYMOUS PLAY WORKS END TO END -- a caller with no account and no cookie
     can create a run, play it to a terminal status, and get a receipt
  3. the error vocabulary is stable: 404 for an unknown run, 409 with the
     ENGINE'S OWN error code for an illegal move, 409 version_mismatch for a
     stale snapshot, 403 for someone else's run
  4. the two properties that make a run trustworthy rather than merely working:
     an idempotent retry is a genuine no-op, and a daily is not re-rollable

WHY THE HAPPY PATH IS DRIVEN THROUGH THE API. `_play_to_terminal` below makes
real HTTP requests for every action of a full three-act run rather than calling
the engine directly. A test that drove the engine would prove the engine works
(which tests/run_the_table/ already does) and would not notice a router that
saved the wrong state, dropped a field, or lost the run between actions. Those
are precisely the failures this layer can have.

COOKIES ARE THE IDENTITY. The `client` fixture is session-scoped, so it carries
one anon subject across every test here -- which is what makes the daily
re-entry assertions meaningful. Tests that need a DIFFERENT player build their
own TestClient, which gets its own cookie jar.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.main import app
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_SLOTS,
    ROLES,
    STARTER_SLOTS,
    STARTING_CREDITS,
    STARTING_LIVES,
    TERMINAL_STATUSES,
    version_tuple,
)
from nba_peak.run_the_table.daily import daily_seed, today_utc_date

BASE = "/api/v1/run-the-table"
READINESS_URL = f"{BASE}/readiness"
META_URL = f"{BASE}/meta"
DAILY_URL = f"{BASE}/daily"
RUNS_URL = f"{BASE}/runs"

# A fixed past date, so the daily assertions are about one specific
# reproducible run rather than about whatever today happens to generate.
FIXED_DATE = "2026-03-14"

# Exactly the top-level keys services/run_the_table/public.py's public_state()
# emits. Asserted as a subset (not equality) because the response model is
# extra="allow" on purpose -- an added field must flow through, and this
# assertion is about nothing being LOST.
STATE_KEYS = {
    "run_id", "seed", "run_type", "date", "status", "act", "stage",
    "acts_total", "stages_per_act", "credits", "lives", "max_lives",
    "starting_credits", "starters", "bench", "systems", "pending_system_offer",
    "stage_options", "active_node", "next_boss", "map", "battles",
    "lane_profile", "roster_total", "bench_weight",
    "veteran_minimum_used_this_act", "action_count", "receipt", "versions",
    "created_at", "last_action_at",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _create(client: TestClient, **body) -> dict:
    body.setdefault("run_type", "standard")
    resp = client.post(RUNS_URL, json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _act(client: TestClient, run_id: str, **body) -> dict:
    resp = client.post(f"{RUNS_URL}/{run_id}/actions", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _next_action(state: dict) -> dict:
    """The lowest-risk legal action for the current status.

    Deliberately passive at every decision node (pass / decline / bank) so the
    walk depends on nothing but the state machine: it never has to reason about
    affordability, slot legality or which card is better. Buying is exercised
    by the engine tests; what this proves is that the SEQUENCE survives the
    HTTP round trip.
    """
    status = state["status"]
    if status == "system_select":
        return {"action_type": "select_system",
                "system_id": state["pending_system_offer"][0]["id"]}
    if status == "node_select":
        return {"action_type": "choose_node",
                "node_id": state["stage_options"][0]["node_id"]}
    if status == "node_active":
        node_type = state["active_node"]["node_type"]
        if node_type == "draft_room":
            return {"action_type": "draft_pass"}
        if node_type == "trade_desk":
            return {"action_type": "decline_trade"}
        if node_type == "film_room":
            return {"action_type": "film_room", "choice": "take_credits"}
        return {"action_type": "rest_bank", "choice": "take_credits"}
    if status == "boss_ready":
        return {"action_type": "resolve_boss"}
    if status == "boss_resolved":
        return {"action_type": "advance"}
    raise AssertionError(f"No action for status {status!r}")


def _play_to_terminal(client: TestClient, state: dict, max_steps: int = 60) -> dict:
    for _ in range(max_steps):
        if state["status"] in TERMINAL_STATUSES:
            return state
        state = _act(client, state["run_id"], **_next_action(state))
    raise AssertionError(f"Run did not terminate; stuck at {state['status']!r}")


@pytest.fixture
def other_client() -> TestClient:
    """A second player: separate TestClient, therefore a separate cookie jar
    and a separate anon subject."""
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------

def test_readiness_reports_flags_versions_and_pool(client: TestClient):
    resp = client.get(READINESS_URL)
    assert resp.status_code == 200
    body = resp.json()

    assert set(body) == {
        "enabled", "daily_enabled", "readiness_level", "versions", "card_pool"
    }
    assert body["enabled"] is True
    assert body["daily_enabled"] is True
    assert body["readiness_level"] == "public_beta"
    assert body["versions"] == version_tuple()

    pool = body["card_pool"]
    assert pool["available"] is True
    assert pool["duration_years"] == 3
    assert pool["card_count"] > 0
    assert pool["prime_score_min"] <= pool["prime_score_max"]


def test_readiness_needs_no_auth_and_leaks_no_run_state(client: TestClient):
    """It is how the web app fails closed, so it must always answer -- and it
    must answer with nothing owned by anybody."""
    body = client.get(READINESS_URL).json()
    for forbidden in ("run_id", "seed", "starters", "bosses", "owner_sub"):
        assert forbidden not in body


def test_readiness_still_answers_when_the_mode_is_disabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """THE FAIL-CLOSED CONTRACT. Everything else 403s, but readiness answers
    200 with `enabled: false` -- otherwise the web app could not tell "turned
    off" from "broken" from "not deployed", and would have to guess."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "RUN_THE_TABLE_ENABLED", False)
    monkeypatch.setattr(settings, "RUN_THE_TABLE_DAILY_ENABLED", False)

    resp = client.get(READINESS_URL)
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False

    for method, url in (
        (client.get, META_URL),
        (client.get, DAILY_URL),
        (client.get, f"{RUNS_URL}/anything"),
    ):
        assert method(url).status_code == 403
    created = client.post(RUNS_URL, json={"run_type": "standard"})
    assert created.status_code == 403
    assert created.json()["detail"]["error_code"] == "run_the_table_not_enabled"


def test_daily_can_be_paused_without_taking_standard_runs_down(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
):
    """The two flags are independent on purpose: a ruleset change moves every
    daily seed, so the daily must be pausable on its own."""
    from app.core.config import settings

    monkeypatch.setattr(settings, "RUN_THE_TABLE_DAILY_ENABLED", False)

    assert client.get(DAILY_URL).status_code == 403
    daily_create = client.post(RUNS_URL, json={"run_type": "daily", "date": FIXED_DATE})
    assert daily_create.status_code == 403
    assert daily_create.json()["detail"]["error_code"] == "run_the_table_daily_not_enabled"

    assert client.post(RUNS_URL, json={"run_type": "standard"}).status_code == 200


# ---------------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------------

def test_meta_returns_the_whole_ruleset(client: TestClient):
    body = client.get(META_URL).json()
    assert {
        "versions", "lanes", "systems", "boss_rules", "roster", "economy",
        "battle", "card_pool",
    } <= set(body)

    assert len(body["lanes"]) == 5
    assert {lane["lane"] for lane in body["lanes"]} == {
        "statistical_impact", "traditional_production", "individual_recognition",
        "postseason_individual_value", "team_achievement",
    }
    # The rules screen renders from these constants, so displayed rules cannot
    # drift from applied rules.
    assert body["roster"] == {
        "starters": STARTER_SLOTS, "bench": BENCH_SLOTS, "roles": list(ROLES)
    }
    assert body["economy"]["starting_credits"] == STARTING_CREDITS
    assert body["economy"]["starting_lives"] == STARTING_LIVES
    assert len(body["systems"]) == 6


def test_meta_publishes_every_threshold_the_systems_apply(client: TestClient):
    """The rules screen renders from this response, so it is the surface where
    an unpublished threshold actually harms a player.

    `SYSTEM_PUBLISHED_THRESHOLDS` is the engine's declaration of which config
    constants each System's rule reads; the engine test suite proves the
    declaration is complete. This proves the text that reaches the browser
    still carries all of them -- a serializer that trimmed or rewrote `summary`
    would silently reintroduce the Two-Way Value defect at the API boundary.
    """
    from nba_peak.run_the_table.config import SYSTEM_PUBLISHED_THRESHOLDS

    by_id = {s["id"]: s for s in client.get(META_URL).json()["systems"]}
    assert set(by_id) == set(SYSTEM_PUBLISHED_THRESHOLDS)

    for system_id, thresholds in SYSTEM_PUBLISHED_THRESHOLDS.items():
        summary = by_id[system_id]["summary"]
        for constant_name, rendering in thresholds.items():
            assert rendering in summary, (
                f"{system_id} applies {constant_name} but the summary the API "
                f"serves does not state it: {summary!r}"
            )


def test_meta_carries_no_run_state(client: TestClient):
    """Cacheable means it must be identical for every caller."""
    first = client.get(META_URL).json()
    second = client.get(META_URL).json()
    assert first == second
    assert "run_id" not in first and "seed" not in first


# ---------------------------------------------------------------------------
# Creating a run
# ---------------------------------------------------------------------------

def test_create_standard_run_anonymously(client: TestClient):
    """No account, no prior cookie needed -- the whole point of the mode."""
    with TestClient(app) as fresh:
        state = _create(fresh)

    assert STATE_KEYS <= set(state)
    assert state["status"] == "system_select"
    assert state["run_type"] == "standard"
    assert state["credits"] == STARTING_CREDITS
    assert state["lives"] == STARTING_LIVES
    assert state["acts_total"] == ACTS
    assert state["action_count"] == 0

    assert len(state["starters"]) == STARTER_SLOTS
    assert len(state["bench"]) == BENCH_SLOTS
    assert [s["slot_id"] for s in state["starters"]] == list(ROLES)
    assert all(s["card"] is not None for s in state["starters"])
    assert all(s["card"] is not None for s in state["bench"])

    # Three Systems are offered and at most one is held, so a legal choice
    # always exists.
    assert len(state["pending_system_offer"]) == 3
    assert state["versions"] == version_tuple()


def test_create_honours_an_explicit_seed(client: TestClient):
    state = _create(client, seed=987654)
    assert state["seed"] == 987654


def test_same_seed_produces_the_same_opening_position(client: TestClient):
    a = _create(client, seed=4242)
    b = _create(client, seed=4242)
    assert a["run_id"] != b["run_id"]
    assert [s["card"]["card_id"] for s in a["starters"]] == [
        s["card"]["card_id"] for s in b["starters"]
    ]
    assert [s["id"] for s in a["pending_system_offer"]] == [
        s["id"] for s in b["pending_system_offer"]
    ]


def test_run_refetches_to_identical_public_state(client: TestClient):
    """A resumed run must be byte-identical to the one just created -- the
    blueprint is regenerated from the seed rather than stored, so this is the
    assertion that catches a regeneration that does not match."""
    created = _create(client, seed=777)
    fetched = client.get(f"{RUNS_URL}/{created['run_id']}")
    assert fetched.status_code == 200
    assert fetched.json() == created


def test_state_survives_an_action_and_a_refetch(client: TestClient):
    state = _create(client, seed=31337)
    after = _act(client, state["run_id"], **_next_action(state))
    refetched = client.get(f"{RUNS_URL}/{state['run_id']}").json()
    assert refetched == after
    assert refetched["action_count"] == 1
    assert len(refetched["systems"]) == 1


# ---------------------------------------------------------------------------
# Full happy path
# ---------------------------------------------------------------------------

def test_full_run_through_the_api_reaches_a_receipt(client: TestClient):
    state = _play_to_terminal(client, _create(client, seed=12345))

    assert state["status"] in TERMINAL_STATUSES
    receipt = state["receipt"]
    assert receipt is not None, "a terminal run must carry a receipt"
    assert {
        "verdict", "outcome", "headline", "table_cleared", "ran_the_table",
        "bosses_defeated", "battles_lost", "record", "lane_profile", "items",
        "reasons", "final_boss", "ended_in_act", "acts_total",
    } <= set(receipt)
    assert len(state["battles"]) >= 1
    assert receipt["bosses_defeated"] + receipt["battles_lost"] <= ACTS
    assert receipt["outcome"] in {
        "table_cleared", "ended_at_final_boss", "ended_in_act"
    }
    assert receipt["verdict"] != "RUN COMPLETE"
    assert receipt["acts_total"] == ACTS == 4
    # The engine's action log is what the count reports; a passive walk of a
    # 4-act run that reaches the Final Boss is 25 actions (8 decision nodes x 2
    # + 1 System + 4 x resolve + 3 x advance).
    assert state["action_count"] == 25

    # Terminal means terminal: no further action is accepted.
    resp = client.post(
        f"{RUNS_URL}/{state['run_id']}/actions", json={"action_type": "advance"}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "run_finished"


def test_completed_run_is_still_resumable_as_a_result_screen(client: TestClient):
    state = _play_to_terminal(client, _create(client, seed=555))
    refetched = client.get(f"{RUNS_URL}/{state['run_id']}").json()
    assert refetched["status"] == state["status"]
    assert refetched["receipt"] == state["receipt"]


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

def test_unknown_run_id_is_404(client: TestClient):
    resp = client.get(f"{RUNS_URL}/rtt-does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error_code"] == "run_not_found"


def test_action_on_unknown_run_id_is_404(client: TestClient):
    resp = client.post(
        f"{RUNS_URL}/rtt-does-not-exist/actions", json={"action_type": "advance"}
    )
    assert resp.status_code == 404


def test_illegal_action_is_409_with_the_engines_error_code(client: TestClient):
    """A fresh run is at system_select, so choosing a node is out of order.

    The code comes from the engine, not from the router: the UI renders it as
    plain language, so it must stay stable across layers.
    """
    state = _create(client, seed=2024)
    resp = client.post(
        f"{RUNS_URL}/{state['run_id']}/actions",
        json={"action_type": "choose_node", "node_id": "a1s1o0"},
    )
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error_code"] == "wrong_status"
    assert detail["message"]


def test_unoffered_system_is_409(client: TestClient):
    state = _create(client, seed=99)
    offered = {s["id"] for s in state["pending_system_offer"]}
    not_offered = next(
        s for s in (
            "moneyball", "deep_rotation", "no_hardware", "two_way_value",
            "trade_machine", "veteran_minimum",
        ) if s not in offered
    )
    resp = client.post(
        f"{RUNS_URL}/{state['run_id']}/actions",
        json={"action_type": "select_system", "system_id": not_offered},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "system_not_offered"


def test_unknown_node_id_is_404(client: TestClient):
    """The engine raises a bare KeyError for an id it has never generated."""
    state = _create(client, seed=606)
    state = _act(client, state["run_id"], **_next_action(state))
    resp = client.post(
        f"{RUNS_URL}/{state['run_id']}/actions",
        json={"action_type": "choose_node", "node_id": "a9s9o9"},
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["error_code"] == "unknown_id"


def test_action_missing_a_required_field_is_422(client: TestClient):
    """A request that never described a move is a request-shape problem, not a
    rules problem -- so it must not be confused with a 409."""
    state = _create(client, seed=808)
    resp = client.post(
        f"{RUNS_URL}/{state['run_id']}/actions", json={"action_type": "select_system"}
    )
    assert resp.status_code == 422
    assert resp.json()["detail"]["error_code"] == "missing_field"


def test_unknown_action_type_is_rejected_by_the_schema(client: TestClient):
    state = _create(client, seed=909)
    resp = client.post(
        f"{RUNS_URL}/{state['run_id']}/actions", json={"action_type": "steal_credits"}
    )
    assert resp.status_code == 422


def test_another_players_run_is_403_not_404(client: TestClient, other_client: TestClient):
    """Distinguished on purpose: 'this link is broken' and 'you are not the
    player who started this' are different problems with different fixes."""
    mine = _create(client, seed=1212)
    resp = other_client.get(f"{RUNS_URL}/{mine['run_id']}")
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_code"] == "run_not_owned"


def test_version_mismatch_is_409(client: TestClient):
    """A snapshot written under a different ruleset is refused, never silently
    reinterpreted -- replaying under changed rules would produce a result that
    never actually happened."""
    from app.core.dependencies import _memory_run_the_table_run_repo as repo

    state = _create(client, seed=13131)
    stored = repo._runs[state["run_id"]]
    stored.snapshot["versions"] = {
        **stored.snapshot["versions"], "ruleset_version": "rtt_ruleset_v0_ancient",
    }

    resp = client.get(f"{RUNS_URL}/{state['run_id']}")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "version_mismatch"

    resp = client.post(
        f"{RUNS_URL}/{state['run_id']}/actions", json={"action_type": "advance"}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "version_mismatch"


def test_a_v1_run_retires_gracefully_with_a_specific_human_message(client: TestClient):
    """Plan §2.4. v1 answered 409 with "created under a different ruleset" for
    any of four different version fields, which told a player nothing about
    whether the rules, the card pool or the model had moved."""
    from app.core.dependencies import _memory_run_the_table_run_repo as repo

    state = _create(client, seed=131313)
    stored = repo._runs[state["run_id"]]
    stored.snapshot["versions"] = {
        **stored.snapshot["versions"], "ruleset_version": "rtt_ruleset_v1",
    }

    resp = client.get(f"{RUNS_URL}/{state['run_id']}")
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error_code"] == "version_mismatch"
    message = detail["message"]
    assert "previous ruleset" in message
    assert "rtt_ruleset_v1" in message
    assert version_tuple()["ruleset_version"] in message
    assert "start a new run" in message.lower()
    # It must never crash, and it must never read as a server fault.
    assert "Traceback" not in message


def test_an_unsupported_snapshot_schema_is_409_not_500(client: TestClient):
    """`serialization.state_from_dict` raised a bare ValueError, which is not in
    the router's error ladder, so a row the server itself wrote surfaced as an
    unhandled HTTP 500."""
    from app.core.dependencies import _memory_run_the_table_run_repo as repo
    from app.services.run_the_table.serialization import (
        SNAPSHOT_SCHEMA_VERSION,
        SnapshotSchemaMismatch,
    )
    from nba_peak.run_the_table.state import VersionMismatch

    assert issubclass(SnapshotSchemaMismatch, VersionMismatch)

    state = _create(client, seed=141414)
    stored = repo._runs[state["run_id"]]
    stored.snapshot["schema_version"] = SNAPSHOT_SCHEMA_VERSION + 99

    resp = client.get(f"{RUNS_URL}/{state['run_id']}")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "version_mismatch"
    assert "older format" in resp.json()["detail"]["message"]

    resp = client.post(
        f"{RUNS_URL}/{state['run_id']}/actions", json={"action_type": "advance"}
    )
    assert resp.status_code == 409


# ---------------------------------------------------------------------------
# Challenge tokens carry the ruleset they were minted under (plan §2.4)
# ---------------------------------------------------------------------------
# These exercise `services/run_the_table/runs.py` directly. The router owns
# minting and decoding (it holds the signing secret) and is another track's
# file; what this track owns and therefore tests is the claim SHAPE and the
# reader, so the router change is a two-line substitution.

def test_challenge_claims_carry_the_current_ruleset():
    from app.services.run_the_table import runs as run_service

    claims = run_service.challenge_claims(
        seed=42, run_type="standard", date=None, nonce="abcd"
    )
    assert claims[run_service.CHALLENGE_RULESET_CLAIM] == (
        version_tuple()["ruleset_version"]
    )
    assert claims["seed"] == 42
    assert claims["nonce"] == "abcd"


def test_a_token_with_no_ruleset_claim_is_read_as_v1_not_as_today():
    """Only v1 predates the claim, so "unversioned" and "v1" are the same
    statement. v1 reported the SERVER's current versions for any token, so a
    week-old link confidently described a board it would never produce."""
    from app.services.run_the_table import runs as run_service

    legacy = {"kind": "rtt_challenge", "seed": 7, "run_type": "standard", "date": None}
    assert run_service.challenge_ruleset(legacy) == "rtt_ruleset_v1"

    descriptor = run_service.challenge_descriptor(legacy)
    assert descriptor["ruleset_version"] == "rtt_ruleset_v1"
    assert descriptor["versions"]["ruleset_version"] == "rtt_ruleset_v1"
    assert descriptor["versions"]["ruleset_version"] != version_tuple()["ruleset_version"]
    assert descriptor["playable"] is False
    # Still spoiler-safe: seed, type, date and versions only.
    assert set(descriptor) == {
        "seed", "run_type", "date", "versions", "ruleset_version", "playable"
    }


def test_a_current_token_is_playable_and_reports_the_current_ruleset():
    from app.services.run_the_table import runs as run_service

    payload = run_service.challenge_claims(9, "standard", None, "n")
    descriptor = run_service.challenge_descriptor(payload)
    assert descriptor["ruleset_version"] == version_tuple()["ruleset_version"]
    assert descriptor["playable"] is True
    run_service.assert_challenge_playable(payload)  # does not raise


def test_starting_a_run_from_a_stale_challenge_token_is_refused():
    from app.services.run_the_table import runs as run_service
    from nba_peak.run_the_table.state import VersionMismatch

    legacy = {"kind": "rtt_challenge", "seed": 7, "run_type": "standard", "date": None}
    with pytest.raises(VersionMismatch) as exc:
        run_service.assert_challenge_playable(legacy)
    assert "previous ruleset" in str(exc.value)
    assert "rtt_ruleset_v1" in str(exc.value)
    assert "new link" in str(exc.value)


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------

def test_duplicate_idempotency_key_is_a_no_op(client: TestClient):
    """A retry after a dropped connection must not apply the action twice."""
    state = _create(client, seed=246)
    first = _act(
        client, state["run_id"],
        idempotency_key="retry-me", **_next_action(state),
    )
    assert first["action_count"] == 1

    second = _act(
        client, state["run_id"],
        idempotency_key="retry-me", **_next_action(state),
    )
    assert second["action_count"] == 1
    assert second["systems"] == first["systems"]
    assert second["credits"] == first["credits"]
    assert second["status"] == first["status"]


def test_idempotent_boss_resolution_does_not_double_resolve(client: TestClient):
    """The action that changes lives and credits is the one where a duplicate
    would hurt most, so it is asserted specifically."""
    state = _create(client, seed=369)
    while state["status"] != "boss_ready":
        state = _act(client, state["run_id"], **_next_action(state))

    first = _act(client, state["run_id"],
                 action_type="resolve_boss", idempotency_key="boss-1")
    second = _act(client, state["run_id"],
                  action_type="resolve_boss", idempotency_key="boss-1")
    assert len(second["battles"]) == len(first["battles"]) == 1
    assert second["lives"] == first["lives"]
    assert second["credits"] == first["credits"]
    assert second["action_count"] == first["action_count"]


# ---------------------------------------------------------------------------
# Daily
# ---------------------------------------------------------------------------

def test_daily_descriptor_is_stable_for_a_fixed_date(client: TestClient):
    body = client.get(DAILY_URL, params={"date": FIXED_DATE}).json()
    assert body["date"] == FIXED_DATE
    assert body["seed"] == daily_seed(FIXED_DATE)
    assert body["run_id"] == f"rtt-daily-{FIXED_DATE}"
    assert body["ruleset_version"] == version_tuple()["ruleset_version"]

    # Same date, same seed, for everyone -- true by construction, not by
    # synchronisation.
    again = client.get(DAILY_URL, params={"date": FIXED_DATE}).json()
    assert again["seed"] == body["seed"]


def test_daily_descriptor_defaults_to_today(client: TestClient):
    body = client.get(DAILY_URL).json()
    assert body["date"] == today_utc_date()
    assert body["seed"] == daily_seed(today_utc_date())


def test_daily_descriptor_leaks_no_content(client: TestClient):
    body = client.get(DAILY_URL, params={"date": FIXED_DATE}).json()
    for forbidden in ("starters", "bench", "bosses", "stages", "offers", "map"):
        assert forbidden not in body


def test_future_daily_date_is_422(client: TestClient):
    resp = client.get(DAILY_URL, params={"date": "2099-01-01"})
    assert resp.status_code == 422
    assert resp.json()["detail"]["error_code"] == "invalid_run_date"


def test_daily_run_uses_the_dates_seed_and_ignores_a_client_seed(client: TestClient):
    with TestClient(app) as fresh:
        state = _create(fresh, run_type="daily", date=FIXED_DATE, seed=1)
    assert state["run_type"] == "daily"
    assert state["date"] == FIXED_DATE
    assert state["seed"] == daily_seed(FIXED_DATE)


def test_two_daily_creates_for_the_same_owner_return_the_same_run(client: TestClient):
    """A daily happens once. A reload must re-enter the run in progress, not
    re-roll the shared board."""
    with TestClient(app) as fresh:
        first = _create(fresh, run_type="daily", date=FIXED_DATE)
        first = _act(fresh, first["run_id"], **_next_action(first))

        second = _create(fresh, run_type="daily", date=FIXED_DATE)
        assert second["run_id"] == first["run_id"]
        assert second["action_count"] == first["action_count"] == 1
        assert second["systems"] == first["systems"]


def test_different_owners_get_distinct_daily_runs_of_the_same_board(client: TestClient):
    with TestClient(app) as a, TestClient(app) as b:
        run_a = _create(a, run_type="daily", date=FIXED_DATE)
        run_b = _create(b, run_type="daily", date=FIXED_DATE)

    assert run_a["run_id"] != run_b["run_id"], "one run row per player"
    assert run_a["seed"] == run_b["seed"], "but the same board"
    assert [s["card"]["card_id"] for s in run_a["starters"]] == [
        s["card"]["card_id"] for s in run_b["starters"]
    ]


def test_daily_reports_already_played_for_a_known_caller(client: TestClient):
    with TestClient(app) as fresh:
        # No cookie yet -- the server does not know, and says so rather than
        # guessing "false".
        assert fresh.get(DAILY_URL, params={"date": FIXED_DATE}).json()[
            "already_played"
        ] is None

        run = _create(fresh, run_type="daily", date=FIXED_DATE)
        body = fresh.get(DAILY_URL, params={"date": FIXED_DATE}).json()
        assert body["already_played"] is True
        assert body["existing_run_id"] == run["run_id"]


def test_daily_descriptor_does_not_mint_an_identity_cookie(client: TestClient):
    """Looking at today's date must not hand a visitor a 30-day credential."""
    with TestClient(app) as fresh:
        resp = fresh.get(DAILY_URL, params={"date": FIXED_DATE})
        assert resp.status_code == 200
        assert "peak3_anon" not in fresh.cookies


# ---------------------------------------------------------------------------
# Challenge links
# ---------------------------------------------------------------------------

def test_challenge_token_round_trips_to_the_same_seed(client: TestClient):
    origin = _create(client, seed=525252)
    minted = client.post(f"{RUNS_URL}/{origin['run_id']}/challenge")
    assert minted.status_code == 200
    body = minted.json()
    token = body["challenge_token"]
    assert body["public_url_path"] == f"/arena/run-the-table?c={token}"

    descriptor = client.get(f"{BASE}/challenges/{token}")
    assert descriptor.status_code == 200
    assert descriptor.json()["seed"] == origin["seed"]

    with TestClient(app) as recipient:
        replayed = _create(recipient, run_type="challenge", challenge_token=token)
    assert replayed["seed"] == origin["seed"]
    assert replayed["run_id"] != origin["run_id"]
    assert [s["card"]["card_id"] for s in replayed["starters"]] == [
        s["card"]["card_id"] for s in origin["starters"]
    ]


def test_challenge_link_points_at_the_route_that_can_actually_open_it(
    client: TestClient,
):
    """The shipped bug: `public_url_path` was `/c/{token}`.

    `/c/[token]` is PEAK DRAFT's challenge page -- it resolves the token
    against `/api/v1/draft/challenges/{token}/meta`, which has never heard of a
    RUN THE TABLE token, so every link this endpoint minted showed the
    recipient a not-found screen. The RUN THE TABLE route reads its token from
    `?c=` on `/arena/run-the-table`.

    Asserted structurally (path + query parameter name), not as a formatted
    string, so this fails if the path drifts back OR if the parameter is
    renamed to something the page does not read.
    """
    from urllib.parse import parse_qs, urlparse

    origin = _create(client, seed=717171)
    body = client.post(f"{RUNS_URL}/{origin['run_id']}/challenge").json()
    parsed = urlparse(body["public_url_path"])

    assert parsed.path == "/arena/run-the-table"
    assert not parsed.path.startswith("/c/")
    assert parse_qs(parsed.query)["c"] == [body["challenge_token"]]

    # And the token in that link really does open the sender's board.
    with TestClient(app) as recipient:
        replayed = _create(
            recipient,
            run_type="challenge",
            challenge_token=parse_qs(parsed.query)["c"][0],
        )
    assert replayed["seed"] == origin["seed"]


def test_challenge_descriptor_is_spoiler_safe(client: TestClient):
    """It says which board to play, never what is on it."""
    origin = _create(client, seed=616161)
    token = client.post(f"{RUNS_URL}/{origin['run_id']}/challenge").json()[
        "challenge_token"
    ]
    body = client.get(f"{BASE}/challenges/{token}").json()

    # `ruleset_version` and `playable` are the §2.4 fix: a token carries the
    # rules it was minted under, so a link cannot silently claim the server's
    # current ones. Neither reveals anything about the sender's run.
    assert set(body) == {
        "seed", "run_type", "date", "versions", "ruleset_version", "playable"
    }
    for forbidden in (
        "starters", "bench", "bosses", "next_boss", "stages", "stage_options",
        "map", "active_node", "receipt", "battles", "run_id", "owner_sub",
    ):
        assert forbidden not in body


def test_challenge_token_from_a_different_secret_is_rejected(client: TestClient):
    """The token is HMAC-signed so a seed cannot be smuggled in from outside --
    which matters the moment two players compare results on a shared board."""
    from app.core.security import create_session_token

    forged = create_session_token(
        {"kind": "run_the_table", "seed": 5, "run_type": "standard", "date": None},
        "not-the-servers-secret",
        ttl_seconds=3600,
    )
    assert client.get(f"{BASE}/challenges/{forged}").status_code == 404
    assert client.post(
        RUNS_URL, json={"run_type": "challenge", "challenge_token": forged}
    ).status_code == 404


def test_challenge_token_of_the_wrong_kind_is_rejected(client: TestClient):
    """A validly-signed token minted for a different feature must not open a
    run -- `kind` is what keeps the signing secret from being a skeleton key."""
    from app.core.config import settings
    from app.core.security import create_session_token

    other_feature = create_session_token(
        {"kind": "peak_duel", "seed": 5}, settings.SIGNING_SECRET, ttl_seconds=3600
    )
    assert client.get(f"{BASE}/challenges/{other_feature}").status_code == 404


def test_challenge_for_unknown_run_is_404(client: TestClient):
    assert client.post(f"{RUNS_URL}/rtt-nope/challenge").status_code == 404


def test_challenge_requires_a_token(client: TestClient):
    resp = client.post(RUNS_URL, json={"run_type": "challenge"})
    assert resp.status_code == 422
    assert resp.json()["detail"]["error_code"] == "missing_challenge_token"


# ---------------------------------------------------------------------------
# Wiring
# ---------------------------------------------------------------------------

def test_repository_domain_is_registered():
    """A durable domain missing from the registry passes production startup
    while silently running on memory -- exactly what the registry exists to
    prevent."""
    from app.core.repository_registry import REPOSITORY_DOMAINS, build_repository_registry

    assert "run_the_table_run" in REPOSITORY_DOMAINS
    assert build_repository_registry(True)["run_the_table_run"] == "postgres"
    assert build_repository_registry(False)["run_the_table_run"] == "memory"


def test_both_repository_implementations_satisfy_the_protocol():
    from app.repositories.run_the_table_memory import MemoryRunTheTableRunRepository
    from app.repositories.run_the_table_postgres import PostgresRunTheTableRunRepository
    from app.repositories.run_the_table_protocols import RunTheTableRunRepository

    assert isinstance(MemoryRunTheTableRunRepository(), RunTheTableRunRepository)
    # Structural check only -- constructing the Postgres repo needs a pool.
    for method in (
        "create_run", "get_run", "save_run", "get_daily_run", "list_runs_for_owner"
    ):
        assert hasattr(PostgresRunTheTableRunRepository, method)


# ---------------------------------------------------------------------------
# The router actually uses the versioned descriptor (lead integration)
#
# `challenge_descriptor` / `assert_challenge_playable` existing in the service
# proves nothing on their own: the whole defect was that the ROUTER ignored the
# token and reported the server's current ruleset. These two tests drive the
# HTTP surface, so re-inlining the old behaviour fails here.
# ---------------------------------------------------------------------------


def _mint_legacy_challenge_token() -> str:
    """A v1-shaped token: no `ruleset` claim, exactly as v1 minted them."""
    from app.core.config import settings
    from app.core.security import create_session_token

    return create_session_token(
        {"kind": "run_the_table", "seed": 4242, "run_type": "standard", "date": None},
        settings.SIGNING_SECRET,
        ttl_seconds=3600,
    )


def test_the_challenge_route_reports_the_tokens_ruleset_not_the_servers(client):
    resp = client.get(f"/api/v1/run-the-table/challenges/{_mint_legacy_challenge_token()}")

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["ruleset_version"] == "rtt_ruleset_v1"
    assert body["versions"]["ruleset_version"] == "rtt_ruleset_v1"
    assert body["ruleset_version"] != version_tuple()["ruleset_version"]
    assert body["playable"] is False


def test_creating_a_run_from_an_old_challenge_link_is_409_not_a_different_board(client):
    """The seed alone would happily generate a v2 board and present it as the
    sender's — a silently different game, not an error. 409 with a readable
    message is the honest outcome."""
    resp = client.post(
        "/api/v1/run-the-table/runs",
        json={"run_type": "challenge", "challenge_token": _mint_legacy_challenge_token()},
    )

    assert resp.status_code == 409, resp.text
    detail = resp.json()["detail"]
    message = detail["message"] if isinstance(detail, dict) else str(detail)
    assert "rtt_ruleset_v1" in message or "ruleset" in message.lower()
