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
    BATTLES,
    BENCH_SLOTS,
    CREDIT_SINKS,
    DECISION_NODES,
    EMERGENCY_RECOVERY_COST,
    EMERGENCY_RECOVERY_MAX_PER_RUN,
    MARKET_REFRESH_COST,
    MAX_LIVES,
    RESERVE_CARD_COST,
    ROLE_FOCUS_COST,
    ROLES,
    ROSTER_SIZE,
    SCOUT_CHOICES,
    SCOUT_PREP_LANE_BONUS,
    STAGES_PER_ACT,
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

# The keys rtt_ruleset_v3 ADDS. Asserted separately from STATE_KEYS so a v3
# regression names itself instead of hiding inside a generic subset failure.
V3_STATE_KEYS = {"reveal", "armed", "credit_sinks", "roster_size", "lanes_to_win"}

# A stage-1 pairing always contains a Draft Room (`_stage_node_types`), so these
# three seeds put the OTHER node type on the board at act 1 stage 1 — which is
# what lets a sink test reach its node in two actions instead of walking a run.
SEED_TRADE_AT_A1S1 = 1
SEED_REST_AT_A1S1 = 2
SEED_SCOUT_AT_A1S1 = 5


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
            # v3: "take_credits" no longer exists at a Scout & Prepare. The only
            # FREE branch is `scout_boss`, which is deliberately the one that can
            # never dead-end a player who has spent everything — so it is also
            # the only one a passive walk can always take.
            return {
                "action_type": "film_room",
                "choice": "scout_boss",
                "lane": "statistical_impact",
            }
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


def _try_act(client: TestClient, run_id: str, **body):
    """An action that is EXPECTED to be refused. Returns the raw response."""
    return client.post(f"{RUNS_URL}/{run_id}/actions", json=body)


def _stored(run_id: str):
    """The persisted row, so a test can pose a state a happy path cannot.

    Used only to set up a precondition (a spent-out purse, a lost life) that
    would otherwise take a whole scripted run to arrive at. Never used to assert
    an outcome: every assertion below reads the HTTP response.
    """
    from app.core.dependencies import _memory_run_the_table_run_repo as repo

    return repo._runs[run_id]


def _open_node_of_type(
    client: TestClient, state: dict, node_type: str, max_steps: int = 40
) -> dict:
    """Walk the run until a node of `node_type` is the OPEN node.

    Prefers that type at every fork and otherwise takes the passive action, so
    it reaches the node without making a single decision the test then has to
    reason about.
    """
    for _ in range(max_steps):
        if state["status"] in TERMINAL_STATUSES:
            break
        if (
            state["status"] == "node_active"
            and state["active_node"]["node_type"] == node_type
        ):
            return state
        if state["status"] == "node_select":
            match = next(
                (o for o in state["stage_options"] if o["node_type"] == node_type), None
            )
            if match:
                state = _act(
                    client, state["run_id"],
                    action_type="choose_node", node_id=match["node_id"],
                )
                continue
        state = _act(client, state["run_id"], **_next_action(state))
    raise AssertionError(f"No {node_type!r} node reachable in this run")


def _greedy_action(state: dict) -> dict:
    """A competent, entirely mechanical policy.

    Buys the highest-rated selectable offer, prepares the lane the engine's own
    scout report says would FLIP, and only rests when a life is actually
    missing. It hardcodes no player and picks no winner — every choice reads a
    field the server sent. This is what carries a run past act 3, which the
    passive walk in `_next_action` deliberately cannot do.
    """
    status = state["status"]
    if status == "system_select":
        return {"action_type": "select_system",
                "system_id": state["pending_system_offer"][0]["id"]}
    if status == "node_select":
        option = next(
            (o for o in state["stage_options"] if o["node_type"] == "draft_room"),
            state["stage_options"][0],
        )
        return {"action_type": "choose_node", "node_id": option["node_id"]}
    if status == "node_active":
        node = state["active_node"]
        if node["node_type"] == "draft_room":
            selectable = [o for o in node["offers"] if o["selectable"]]
            if not selectable:
                return {"action_type": "draft_pass"}
            best = max(selectable, key=lambda o: o["prime_score"])
            return {
                "action_type": "draft_buy",
                "card_id": best["card_id"],
                "slot_id": best["legal_slots"][0],
                "use_veteran_minimum": best["veteran_minimum_eligible"],
            }
        if node["node_type"] == "trade_desk":
            return {"action_type": "decline_trade"}
        if node["node_type"] == "film_room":
            report = next(
                c for c in node["scout"]["choices"] if c["id"] == "scout_boss"
            )["report"]
            lane = next(
                (p["lane"] for p in report["preparations"] if p["would_flip"]),
                report["preparations"][0]["lane"],
            )
            return {"action_type": "film_room", "choice": "scout_boss", "lane": lane}
        return {
            "action_type": "rest_bank",
            "choice": "recover_life" if state["lives"] < state["max_lives"] else "take_credits",
        }
    if status == "boss_ready":
        return {"action_type": "resolve_boss"}
    if status == "boss_resolved":
        return {"action_type": "advance"}
    raise AssertionError(f"No action for status {status!r}")


def _play_greedily(client: TestClient, state: dict, max_steps: int = 90) -> dict:
    for _ in range(max_steps):
        if state["status"] in TERMINAL_STATUSES:
            return state
        state = _act(client, state["run_id"], **_greedy_action(state))
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
    # v3 is FIVE acts. Pinned to the literal as well as to `ACTS` on purpose:
    # `== ACTS` alone would pass for any run shape, and the number of acts a
    # player is promised is exactly the kind of thing that must not move
    # silently.
    assert receipt["acts_total"] == ACTS == 5
    # A PASSIVE walk never upgrades anything, and v3's boss ramp is five bands
    # wide, so this run spends its three lives and ends at the act-4 boss: 6
    # decision nodes x 2 + 2 Systems + 3 x resolve + 3 x advance + the act-4
    # nodes and resolve = 25 actions. `test_a_full_five_act_run_reaches_a_receipt`
    # is the one that plays the offers and reaches act 5.
    assert state["action_count"] == 25
    assert state["status"] == "failed"
    assert receipt["ended_in_act"] == 4
    assert receipt["outcome"] == "ended_in_act"

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


# ===========================================================================
# rtt_ruleset_v3
# ===========================================================================
# Everything below is new in v3: the five-act shape, the server-side reveals,
# the four published credit sinks, Scout & Prepare, and the two ways an old run
# retires. Each test drives the HTTP surface, because what this layer can get
# wrong is losing a field, saving the wrong state, or accepting an action the
# engine would refuse.


# ---------------------------------------------------------------------------
# Shape
# ---------------------------------------------------------------------------

def test_v3_shape_is_five_acts_ten_nodes_five_bosses(client: TestClient):
    state = _create(client, seed=30001)

    assert state["acts_total"] == ACTS == 5
    assert state["stages_per_act"] == STAGES_PER_ACT
    assert state["final_boss_act"] == ACTS
    assert state["lives"] == STARTING_LIVES == 3
    assert state["credits"] == STARTING_CREDITS == 50
    assert state["versions"]["ruleset_version"] == "rtt_ruleset_v3"

    # The map is the run: five acts, two stages each, one boss each.
    assert len(state["map"]) == ACTS
    assert [a["act"] for a in state["map"]] == list(range(1, ACTS + 1))
    assert sum(len(a["stages"]) for a in state["map"]) == DECISION_NODES == 10
    assert len([a["boss"] for a in state["map"]]) == BATTLES == 5
    assert state["map"][-1]["boss"]["is_final"] is True
    assert [a["boss"]["is_final"] for a in state["map"][:-1]] == [False] * (ACTS - 1)

    # Every boss id is distinct — a five-act ladder that repeats a boss is a
    # four-act ladder with a rerun.
    boss_ids = [a["boss"]["boss_id"] for a in state["map"]]
    assert len(set(boss_ids)) == ACTS


def test_v3_payload_carries_the_new_blocks(client: TestClient):
    """`STATE_KEYS` is asserted as a SUBSET so added fields flow through; this
    is the other half — that they actually arrive."""
    state = _create(client, seed=30002)
    assert STATE_KEYS <= set(state)
    assert V3_STATE_KEYS <= set(state)
    assert state["roster_size"] == ROSTER_SIZE == 7


def test_meta_publishes_the_v3_run_shape_and_every_sink_price(client: TestClient):
    body = client.get(META_URL).json()

    shape = body["run_shape"]
    assert shape["acts"] == ACTS
    assert shape["decision_nodes"] == DECISION_NODES
    assert shape["battles"] == BATTLES
    assert shape["final_boss_act"] == ACTS
    assert shape["roster_size"] == ROSTER_SIZE

    # The price list is the config's, restated nowhere.
    by_id = {s["id"]: s for s in body["credit_sinks"]}
    assert set(by_id) == set(CREDIT_SINKS)
    for sink_id, sink in CREDIT_SINKS.items():
        assert by_id[sink_id]["cost"] == sink["cost"]
        assert by_id[sink_id]["name"] == sink["name"]
        assert by_id[sink_id]["limit"] == sink["limit"]
        assert by_id[sink_id]["offered_at"] == list(sink["offered_at"])

    assert body["scout_and_prepare"]["choices"] == list(SCOUT_CHOICES)
    assert body["scout_and_prepare"]["prep_bonus"] == SCOUT_PREP_LANE_BONUS
    assert body["economy"]["market_refresh_cost"] == MARKET_REFRESH_COST
    assert body["economy"]["emergency_recovery_cost"] == EMERGENCY_RECOVERY_COST


def test_a_full_five_act_run_reaches_a_receipt(client: TestClient):
    """The passive walk in `_next_action` never upgrades, so v3's five-band boss
    ramp ends it in act 4. This one plays the offers the server sends and gets
    all the way to the Final Boss."""
    state = _play_greedily(client, _create(client, seed=12345))

    assert state["status"] == "complete"
    assert state["act"] == ACTS == 5
    assert len(state["battles"]) == BATTLES == 5
    assert [b["act"] for b in state["battles"]] == list(range(1, ACTS + 1))

    receipt = state["receipt"]
    assert receipt["acts_total"] == ACTS
    assert receipt["outcome"] in {"table_cleared", "ended_at_final_boss"}
    # 10 decision nodes x 2 actions + 2 Systems + 5 resolves + 5 advances.
    assert state["action_count"] == 32


def test_beating_earlier_bosses_does_not_clear_the_table(client: TestClient):
    """THE FINAL BOSS IS THE CLEAR CONDITION. A run that reaches act 5, wins
    earlier battles and does not win the last one is `ended_at_final_boss`, and
    `table_cleared` stays false."""
    state = _play_greedily(client, _create(client, seed=12345))
    receipt = state["receipt"]

    final_battle = state["battles"][-1]
    assert final_battle["act"] == ACTS
    assert final_battle["outcome"] != "win"
    assert receipt["bosses_defeated"] >= 1
    assert receipt["table_cleared"] is False
    assert receipt["ran_the_table"] is False
    assert receipt["outcome"] == "ended_at_final_boss"
    assert receipt["verdict"] != "RUN COMPLETE"


def test_a_run_ends_the_instant_lives_hit_zero(client: TestClient):
    """No acknowledgement action, no extra act. The battle that took the last
    life is already in `battles` and the receipt is already there."""
    state = _create(client, seed=999)
    _stored(state["run_id"]).snapshot["lives"] = 1

    while state["status"] != "boss_ready":
        state = _act(client, state["run_id"], **_next_action(state))
    assert state["lives"] == 1

    state = _act(client, state["run_id"], action_type="resolve_boss")
    assert state["battles"][-1]["outcome"] == "loss"
    assert state["lives"] == 0
    assert state["status"] == "failed"
    assert state["receipt"] is not None
    assert state["act"] == 1

    refused = _try_act(client, state["run_id"], action_type="advance")
    assert refused.status_code == 409
    assert refused.json()["detail"]["error_code"] == "run_finished"


# ---------------------------------------------------------------------------
# The opening reveal (spec §3)
# ---------------------------------------------------------------------------

def test_the_opening_reveal_starts_closed_and_preselects_the_next_card(
    client: TestClient,
):
    reveal = _create(client, seed=30010)["reveal"]["roster"]

    assert reveal["revealed"] == 0
    assert reveal["total"] == ROSTER_SIZE == 7
    assert reveal["complete"] is False
    assert reveal["revealed_slots"] == []
    # Skip-all only AFTER the first reveal: a player has to have seen what a
    # reveal is before they can dismiss the rest of them.
    assert reveal["can_skip"] is False
    assert reveal["remaining"] == ROSTER_SIZE

    # The published slot order, cards withheld.
    assert [s["slot_id"] for s in reveal["order"]] == [
        *ROLES, "bench_1", "bench_2",
    ]
    assert [s["label"] for s in reveal["order"]] == [
        "Lead Creator", "Guard/Wing", "Wing/Forward", "Forward/Big",
        "Anchor", "Bench 1", "Bench 2",
    ]
    assert all("card_id" not in s for s in reveal["order"])

    # THE SERVER PRESELECTS THE CARD. The client animates to this, it never
    # rolls one.
    assert reveal["next_slot"]["slot_id"] == "lead_creator"
    assert reveal["next_slot"]["card_id"]
    assert reveal["next_slot"]["player_name"]


def test_revealing_advances_one_slot_at_a_time(client: TestClient):
    state = _create(client, seed=30011)
    expected = [s["slot_id"] for s in state["reveal"]["roster"]["order"]]

    seen = []
    for index in range(ROSTER_SIZE):
        seen.append(state["reveal"]["roster"]["next_slot"]["card_id"])
        state = _act(client, state["run_id"], action_type="reveal")
        roster = state["reveal"]["roster"]
        assert roster["revealed"] == index + 1
        assert [s["slot_id"] for s in roster["revealed_slots"]] == expected[: index + 1]
        assert roster["can_skip"] is (index + 1 < ROSTER_SIZE)

    assert state["reveal"]["roster"]["complete"] is True
    assert state["reveal"]["roster"]["next_slot"] is None
    assert state["reveal"]["roster"]["can_skip"] is False
    # Every card the reveal landed on is a card on the roster it revealed.
    on_roster = [s["card"]["card_id"] for s in state["starters"] + state["bench"]]
    assert seen == on_roster


def test_the_same_seed_reveals_the_same_roster_in_the_same_order(client: TestClient):
    a = _create(client, seed=30012)
    b = _create(client, seed=30012)
    assert a["run_id"] != b["run_id"]

    def order(state: dict) -> list[tuple[str, str]]:
        state = _act(client, state["run_id"], action_type="reveal", count=ROSTER_SIZE)
        return [
            (s["slot_id"], s["card_id"])
            for s in state["reveal"]["roster"]["revealed_slots"]
        ]

    assert order(a) == order(b)


def test_reveal_progress_survives_a_reload(client: TestClient):
    """Spec §3: a refresh mid-reveal RESUMES. Progress is run state, which is
    exactly why it cannot live in the browser."""
    state = _create(client, seed=30013)
    state = _act(client, state["run_id"], action_type="reveal", count=3)
    assert state["reveal"]["roster"]["revealed"] == 3

    reloaded = client.get(f"{RUNS_URL}/{state['run_id']}").json()
    assert reloaded["reveal"]["roster"]["revealed"] == 3
    assert reloaded["reveal"]["roster"]["complete"] is False
    assert reloaded["reveal"] == state["reveal"]


def test_skip_all_is_a_single_call_and_saturates(client: TestClient):
    state = _create(client, seed=30014)
    state = _act(client, state["run_id"], action_type="reveal")
    assert state["reveal"]["roster"]["can_skip"] is True

    # Deliberately more than there are slots: skip-all is one call, and asking
    # for too many saturates rather than erroring.
    state = _act(client, state["run_id"], action_type="reveal", count=64)
    roster = state["reveal"]["roster"]
    assert roster["revealed"] == ROSTER_SIZE
    assert roster["complete"] is True
    assert len(roster["revealed_slots"]) == ROSTER_SIZE
    assert roster["next_slot"] is None


def test_the_reveal_is_not_a_gate(client: TestClient):
    """A client that never reveals anything must still be able to play — an
    older client is degraded, never broken."""
    state = _create(client, seed=30015)
    assert state["reveal"]["roster"]["revealed"] == 0
    state = _act(client, state["run_id"], **_next_action(state))
    assert state["status"] == "node_select"
    assert state["reveal"]["roster"]["revealed"] == 0


def test_reveal_rejects_an_unknown_target(client: TestClient):
    state = _create(client, seed=30016)
    resp = _try_act(client, state["run_id"], action_type="reveal", target="everything")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "unknown_reveal_target"


def test_reveal_is_idempotent_by_key(client: TestClient):
    state = _create(client, seed=30017)
    first = _act(client, state["run_id"], action_type="reveal", idempotency_key="r1")
    second = _act(client, state["run_id"], action_type="reveal", idempotency_key="r1")
    assert second["reveal"]["roster"]["revealed"] == first["reveal"]["roster"]["revealed"] == 1
    assert second["action_count"] == first["action_count"]


# ---------------------------------------------------------------------------
# The boss reveal (spec §3)
# ---------------------------------------------------------------------------

def test_the_boss_reveal_appears_only_once_the_boss_is_revealed(client: TestClient):
    state = _create(client, seed=30020)
    # Before the boss: nothing at all. Not an empty lineup — no block.
    assert state["reveal"]["boss"] is None

    while state["status"] != "boss_ready":
        state = _act(client, state["run_id"], **_next_action(state))

    boss = state["reveal"]["boss"]
    assert boss is not None
    assert boss["act"] == 1
    assert boss["revealed"] == 0
    assert boss["total"] == ROSTER_SIZE
    assert boss["next_slot"]["slot_id"] == "lead_creator"
    assert boss["next_slot"]["card_id"]
    assert boss["revealed_slots"] == []
    # SEED AND RULE GENERATED, and it says so. The reveal must not be able to
    # imply an opponent assembled live.
    assert boss["deterministic"] is True
    assert boss["source"] in {"curated", "generated_fallback"}
    assert state["next_boss"]["deterministic"] is True


def test_the_boss_reveal_advances_and_resumes(client: TestClient):
    state = _create(client, seed=30021)
    while state["status"] != "boss_ready":
        state = _act(client, state["run_id"], **_next_action(state))

    state = _act(client, state["run_id"], action_type="reveal", target="boss", count=2)
    assert state["reveal"]["boss"]["revealed"] == 2
    assert len(state["reveal"]["boss"]["revealed_slots"]) == 2
    assert state["reveal"]["boss"]["can_skip"] is True

    reloaded = client.get(f"{RUNS_URL}/{state['run_id']}").json()
    assert reloaded["reveal"]["boss"]["revealed"] == 2

    state = _act(
        client, state["run_id"], action_type="reveal", target="boss", count=ROSTER_SIZE
    )
    assert state["reveal"]["boss"]["complete"] is True
    assert state["reveal"]["boss"]["next_slot"] is None
    # The revealed lineup is the lineup the battle is about to use.
    assert [s["card_id"] for s in state["reveal"]["boss"]["revealed_slots"]] == [
        c["card_id"] for c in state["next_boss"]["starters"] + state["next_boss"]["bench"]
    ]


def test_the_same_seed_reveals_the_same_boss(client: TestClient):
    def lineup(seed: int) -> list[str]:
        state = _create(client, seed=seed)
        while state["status"] != "boss_ready":
            state = _act(client, state["run_id"], **_next_action(state))
        state = _act(
            client, state["run_id"], action_type="reveal", target="boss", count=ROSTER_SIZE
        )
        return [s["card_id"] for s in state["reveal"]["boss"]["revealed_slots"]]

    assert lineup(30022) == lineup(30022)


# ---------------------------------------------------------------------------
# Credit sinks (spec §4) — Market Refresh
# ---------------------------------------------------------------------------

def test_a_market_node_offers_market_refresh_at_its_published_price(
    client: TestClient,
):
    state = _create(client, seed=30030)
    state = _open_node_of_type(client, state, "draft_room")

    sinks = {s["id"]: s for s in state["active_node"]["credit_sinks"]}
    assert set(sinks) == {"market_refresh"}
    refresh = sinks["market_refresh"]
    assert refresh["cost"] == MARKET_REFRESH_COST == 7
    assert refresh["available"] is True
    assert refresh["affordable"] is True
    assert refresh["selectable"] is True
    assert refresh["unavailable_reason"] is None
    assert refresh["used"] == 0
    assert refresh["remaining"] == 1
    assert refresh["summary"] == CREDIT_SINKS["market_refresh"]["summary"]


def test_market_refresh_charges_once_and_replaces_the_board(client: TestClient):
    state = _create(client, seed=30031)
    state = _open_node_of_type(client, state, "draft_room")
    before_credits = state["credits"]
    before = [o["card_id"] for o in state["active_node"]["offers"]]

    state = _act(client, state["run_id"], action_type="market_refresh")

    assert state["credits"] == before_credits - MARKET_REFRESH_COST
    after = [o["card_id"] for o in state["active_node"]["offers"]]
    assert after != before
    assert not (set(after) & set(before)), "a paid refresh must be a genuinely new board"
    # The node stays OPEN: a refresh buys a different board, it is not the move.
    assert state["status"] == "node_active"
    assert state["active_node"]["refreshes_used"] == 1

    ledger = state["armed"]["sink_spend"]
    assert [row["sink_id"] for row in ledger] == ["market_refresh"]
    assert ledger[0]["cost"] == MARKET_REFRESH_COST
    assert state["armed"]["sink_spend_total"] == MARKET_REFRESH_COST


def test_a_refreshed_board_is_the_board_the_engine_will_sell_from(client: TestClient):
    """Rendering the blueprint's original offers after a paid refresh would show
    a board the engine refuses to sell from — the exact drift `node_offers`
    exists to prevent."""
    state = _create(client, seed=30032)
    state = _open_node_of_type(client, state, "draft_room")
    stale = state["active_node"]["offers"][0]["card_id"]

    state = _act(client, state["run_id"], action_type="market_refresh")
    fresh = next(o for o in state["active_node"]["offers"] if o["selectable"])

    refused = _try_act(
        client, state["run_id"], action_type="draft_buy",
        card_id=stale, slot_id=fresh["legal_slots"][0],
    )
    assert refused.status_code == 409
    assert refused.json()["detail"]["error_code"] == "card_not_offered"

    bought = _act(
        client, state["run_id"], action_type="draft_buy",
        card_id=fresh["card_id"], slot_id=fresh["legal_slots"][0],
    )
    assert any(
        s["card"]["card_id"] == fresh["card_id"]
        for s in bought["starters"] + bought["bench"]
    )


def test_market_refresh_is_capped_at_one_per_node(client: TestClient):
    state = _create(client, seed=30033)
    state = _open_node_of_type(client, state, "draft_room")
    state = _act(client, state["run_id"], action_type="market_refresh")

    sink = next(
        s for s in state["active_node"]["credit_sinks"] if s["id"] == "market_refresh"
    )
    assert sink["available"] is False
    assert sink["selectable"] is False
    assert sink["unavailable_reason"] == "refresh_limit"
    assert sink["remaining"] == 0

    resp = _try_act(client, state["run_id"], action_type="market_refresh")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "refresh_limit"


def test_market_refresh_is_refused_and_shown_locked_when_unaffordable(
    client: TestClient,
):
    state = _create(client, seed=30034)
    state = _open_node_of_type(client, state, "draft_room")
    _stored(state["run_id"]).snapshot["credits"] = MARKET_REFRESH_COST - 1

    state = client.get(f"{RUNS_URL}/{state['run_id']}").json()
    sink = next(
        s for s in state["active_node"]["credit_sinks"] if s["id"] == "market_refresh"
    )
    # Shown WITH its reason, not hidden — that is how a player learns it exists.
    assert sink["available"] is True
    assert sink["affordable"] is False
    assert sink["selectable"] is False
    assert sink["unavailable_reason"] == "insufficient_credits"

    resp = _try_act(client, state["run_id"], action_type="market_refresh")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "insufficient_credits"


def test_market_refresh_is_refused_away_from_a_market(client: TestClient):
    state = _create(client, seed=SEED_REST_AT_A1S1)
    state = _open_node_of_type(client, state, "rest_bank")
    assert not any(
        s["id"] == "market_refresh" for s in state["active_node"]["credit_sinks"]
    )
    resp = _try_act(client, state["run_id"], action_type="market_refresh")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "wrong_node_type"


def test_a_trade_desk_also_refreshes(client: TestClient):
    state = _create(client, seed=SEED_TRADE_AT_A1S1)
    state = _open_node_of_type(client, state, "trade_desk")
    before = [c["card_id"] for c in state["active_node"]["incoming"]]
    credits = state["credits"]

    state = _act(client, state["run_id"], action_type="market_refresh")
    after = [c["card_id"] for c in state["active_node"]["incoming"]]
    assert state["credits"] == credits - MARKET_REFRESH_COST
    assert not (set(after) & set(before))


# ---------------------------------------------------------------------------
# Credit sinks — Emergency Recovery
# ---------------------------------------------------------------------------

def test_emergency_recovery_is_offered_only_at_a_rest_bank(client: TestClient):
    state = _create(client, seed=SEED_REST_AT_A1S1)
    state = _open_node_of_type(client, state, "rest_bank")
    sink = next(
        s for s in state["active_node"]["credit_sinks"] if s["id"] == "emergency_recovery"
    )
    assert sink["cost"] == EMERGENCY_RECOVERY_COST == 20
    assert sink["limit_total"] == EMERGENCY_RECOVERY_MAX_PER_RUN == 1
    # At full lives there is nothing to buy, and it says which reason applies.
    assert state["lives"] == MAX_LIVES
    assert sink["available"] is False
    assert sink["unavailable_reason"] == "lives_full"


def test_emergency_recovery_buys_one_life_once_per_run(client: TestClient):
    state = _create(client, seed=SEED_REST_AT_A1S1)
    state = _open_node_of_type(client, state, "rest_bank")
    _stored(state["run_id"]).snapshot["lives"] = 1
    state = client.get(f"{RUNS_URL}/{state['run_id']}").json()

    sink = next(
        s for s in state["active_node"]["credit_sinks"] if s["id"] == "emergency_recovery"
    )
    assert sink["available"] is True and sink["selectable"] is True
    credits = state["credits"]

    state = _act(client, state["run_id"], action_type="emergency_recovery")
    assert state["lives"] == 2
    assert state["credits"] == credits - EMERGENCY_RECOVERY_COST
    assert state["armed"]["emergency_recoveries_used"] == 1
    # It is additive to the node's free choice, so the node stays open.
    assert state["status"] == "node_active"
    assert [row["sink_id"] for row in state["armed"]["sink_spend"]] == [
        "emergency_recovery"
    ]

    # ...and it is the run's one purchase, not the node's.
    resp = _try_act(client, state["run_id"], action_type="emergency_recovery")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "recovery_limit"

    state = _act(client, state["run_id"], action_type="rest_bank", choice="recover_life")
    assert state["lives"] == MAX_LIVES

    later = _open_node_of_type(client, state, "rest_bank")
    _stored(later["run_id"]).snapshot["lives"] = 1
    later = client.get(f"{RUNS_URL}/{later['run_id']}").json()
    sink = next(
        s for s in later["active_node"]["credit_sinks"] if s["id"] == "emergency_recovery"
    )
    assert sink["available"] is False
    assert sink["unavailable_reason"] == "recovery_limit"
    assert sink["remaining"] == 0


def test_emergency_recovery_is_refused_when_unaffordable(client: TestClient):
    state = _create(client, seed=SEED_REST_AT_A1S1)
    state = _open_node_of_type(client, state, "rest_bank")
    snapshot = _stored(state["run_id"]).snapshot
    snapshot["lives"] = 1
    snapshot["credits"] = EMERGENCY_RECOVERY_COST - 1

    state = client.get(f"{RUNS_URL}/{state['run_id']}").json()
    sink = next(
        s for s in state["active_node"]["credit_sinks"] if s["id"] == "emergency_recovery"
    )
    assert sink["affordable"] is False
    assert sink["selectable"] is False
    assert sink["unavailable_reason"] == "insufficient_credits"

    resp = _try_act(client, state["run_id"], action_type="emergency_recovery")
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "insufficient_credits"
    assert client.get(f"{RUNS_URL}/{state['run_id']}").json()["lives"] == 1


# ---------------------------------------------------------------------------
# Scout & Prepare (spec §5)
# ---------------------------------------------------------------------------

def _open_scout(client: TestClient, seed: int = SEED_SCOUT_AT_A1S1) -> dict:
    return _open_node_of_type(client, _create(client, seed=seed), "film_room")


def test_scout_and_prepare_offers_three_actionable_choices(client: TestClient):
    state = _open_scout(client)
    node = state["active_node"]

    assert node["node_type"] == "film_room"
    assert node["title"] == "Scout & Prepare"
    assert [c["id"] for c in node["scout"]["choices"]] == list(SCOUT_CHOICES)
    assert [c["id"] for c in node["choices"]] == list(SCOUT_CHOICES)
    # v2's ATM is gone, not zeroed.
    assert "take_credits" not in {c["id"] for c in node["choices"]}
    assert "scout_offers" not in {c["id"] for c in node["choices"]}

    # The two priced choices surface as sinks with their published prices.
    sinks = {s["id"]: s for s in node["credit_sinks"]}
    assert set(sinks) == {"role_focus", "reserve_card"}
    assert sinks["role_focus"]["cost"] == ROLE_FOCUS_COST == 6
    assert sinks["reserve_card"]["cost"] == RESERVE_CARD_COST == 5


def test_scout_the_boss_is_free_and_reports_the_matchup(client: TestClient):
    state = _open_scout(client)
    scout = next(
        c for c in state["active_node"]["scout"]["choices"] if c["id"] == "scout_boss"
    )
    assert scout["cost"] == 0
    assert scout["available"] is True, "the free branch must never dead-end a player"

    report = scout["report"]
    assert {
        "boss_id", "rule", "lanes", "strongest_lanes", "weakest_lane",
        "projection", "projected_summed_margin", "preparations", "lanes_to_win",
    } <= set(report)
    assert len(report["strongest_lanes"]) == 2
    assert report["weakest_lane"] not in report["strongest_lanes"]
    assert len(report["lanes"]) == 5
    assert len(report["preparations"]) == 5
    assert all(p["bonus"] == SCOUT_PREP_LANE_BONUS for p in report["preparations"])
    assert report["projection"] in {
        "win", "loss", "win_on_margin", "loss_on_margin", "draw"
    }
    # The capped preparation options the client renders.
    assert [lane["lane"] for lane in state["active_node"]["scout"]["lanes"]] == [
        p["lane"] for p in report["preparations"]
    ]


def test_scouting_arms_one_capped_lane_preparation_that_reaches_the_battle(
    client: TestClient,
):
    state = _open_scout(client)
    lane = state["active_node"]["scout"]["lanes"][0]["lane"]
    credits = state["credits"]

    state = _act(
        client, state["run_id"], action_type="film_room", choice="scout_boss", lane=lane
    )
    assert state["credits"] == credits, "Scout the Boss is free"
    prep = state["armed"]["prep"]
    assert prep["lane"] == lane
    assert prep["bonus"] == SCOUT_PREP_LANE_BONUS
    assert prep["act"] == 1
    assert state["armed"]["scouted_boss_acts"] == [1]
    # Scouting the boss reveals it — that is the information half of the choice.
    assert state["next_boss"]["revealed"] is True

    while state["status"] != "boss_ready":
        state = _act(client, state["run_id"], **_next_action(state))
    state = _act(client, state["run_id"], action_type="resolve_boss")

    battle = state["battles"][-1]
    assert battle["lane_bonuses"] == {lane: SCOUT_PREP_LANE_BONUS}
    prepared = next(l for l in battle["lanes"] if l["lane"] == lane)
    assert prepared["player_prep_bonus"] == SCOUT_PREP_LANE_BONUS
    assert all(
        l["player_prep_bonus"] == 0.0 for l in battle["lanes"] if l["lane"] != lane
    )
    # Spent on this act's boss whether or not it helped.
    assert state["armed"]["prep"] is None


def test_scouting_without_a_lane_is_409_not_a_silent_no_op(client: TestClient):
    state = _open_scout(client)
    resp = _try_act(
        client, state["run_id"], action_type="film_room", choice="scout_boss"
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "unknown_lane"

    resp = _try_act(
        client, state["run_id"], action_type="film_room",
        choice="scout_boss", lane="vibes",
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "unknown_lane"


def test_a_stale_v2_scout_choice_fails_loudly(client: TestClient):
    """`take_credits` was 89% of every v2 Film Room visit. A client that still
    sends it must be told, not quietly given something else."""
    state = _open_scout(client)
    resp = _try_act(
        client, state["run_id"], action_type="film_room", choice="take_credits"
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "unknown_choice"


def test_shape_the_market_charges_six_and_guarantees_the_role(client: TestClient):
    state = _open_scout(client)
    role = state["active_node"]["scout"]["roles"][0]
    credits = state["credits"]

    state = _act(
        client, state["run_id"], action_type="film_room",
        choice="shape_market", role=role,
    )
    assert state["credits"] == credits - ROLE_FOCUS_COST
    assert state["armed"]["role_focus"]["role"] == role
    assert [row["sink_id"] for row in state["armed"]["sink_spend"]] == ["role_focus"]
    # Market control includes seeing what you are shaping.
    assert any(stage["scouted"] for act in state["map"] for stage in act["stages"])

    state = _open_node_of_type(client, state, "draft_room")
    assert state["active_node"]["role_focus"] == role
    offers = state["active_node"]["offers"]
    assert any(role in o["eligible_roles"] for o in offers), (
        "the guarantee the player paid for must be on the board"
    )


def test_only_one_role_focus_can_be_live(client: TestClient):
    state = _open_scout(client)
    role = state["active_node"]["scout"]["roles"][0]
    state = _act(
        client, state["run_id"], action_type="film_room",
        choice="shape_market", role=role,
    )

    later = _open_node_of_type(client, state, "film_room")
    sink = next(
        s for s in later["active_node"]["credit_sinks"] if s["id"] == "role_focus"
    )
    assert sink["available"] is False
    assert sink["unavailable_reason"] == "role_focus_active"
    resp = _try_act(
        client, later["run_id"], action_type="film_room",
        choice="shape_market", role=role,
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "role_focus_active"


def test_shape_the_market_is_refused_when_unaffordable(client: TestClient):
    state = _open_scout(client)
    _stored(state["run_id"]).snapshot["credits"] = ROLE_FOCUS_COST - 1
    state = client.get(f"{RUNS_URL}/{state['run_id']}").json()

    sink = next(
        s for s in state["active_node"]["credit_sinks"] if s["id"] == "role_focus"
    )
    assert sink["affordable"] is False
    assert sink["selectable"] is False
    assert sink["unavailable_reason"] == "insufficient_credits"
    choice = next(c for c in state["active_node"]["choices"] if c["id"] == "shape_market")
    assert choice["disabled"] is True

    resp = _try_act(
        client, state["run_id"], action_type="film_room",
        choice="shape_market", role=ROLES[0],
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "insufficient_credits"


def test_reserve_a_card_locks_todays_price_into_the_next_draft_room(
    client: TestClient,
):
    state = _open_scout(client)
    reserve = next(
        c for c in state["active_node"]["scout"]["choices"] if c["id"] == "reserve_card"
    )
    assert len(reserve["candidates"]) == 3
    candidate = next(c for c in reserve["candidates"] if c["legal_slots"])
    credits = state["credits"]

    state = _act(
        client, state["run_id"], action_type="film_room",
        choice="reserve_card", card_id=candidate["card_id"],
    )
    assert state["credits"] == credits - RESERVE_CARD_COST
    reserved = state["armed"]["reserved_card"]
    assert reserved["card_id"] == candidate["card_id"]
    assert reserved["locked_cost"] == candidate["locked_cost"]
    assert reserved["status"] == "live"

    state = _open_node_of_type(client, state, "draft_room")
    offered = next(
        o for o in state["active_node"]["offers"] if o["card_id"] == candidate["card_id"]
    )
    assert offered["reserved"] is True
    assert offered["cost"] == candidate["locked_cost"]
    assert state["armed"]["reserved_card"]["status"] == "offered"


def test_only_one_reservation_can_be_live(client: TestClient):
    state = _open_scout(client)
    reserve = next(
        c for c in state["active_node"]["scout"]["choices"] if c["id"] == "reserve_card"
    )
    first = next(c for c in reserve["candidates"] if c["legal_slots"])
    state = _act(
        client, state["run_id"], action_type="film_room",
        choice="reserve_card", card_id=first["card_id"],
    )

    later = _open_node_of_type(client, state, "film_room")
    sink = next(
        s for s in later["active_node"]["credit_sinks"] if s["id"] == "reserve_card"
    )
    assert sink["available"] is False
    assert sink["unavailable_reason"] == "reservation_active"
    other = next(
        c for c in later["active_node"]["scout"]["choices"]
        if c["id"] == "reserve_card"
    )["candidates"][0]
    resp = _try_act(
        client, later["run_id"], action_type="film_room",
        choice="reserve_card", card_id=other["card_id"],
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "reservation_active"


def test_reserving_a_card_that_was_never_offered_is_refused(client: TestClient):
    state = _open_scout(client)
    resp = _try_act(
        client, state["run_id"], action_type="film_room",
        choice="reserve_card", card_id="michael-jordan-3yr-199091",
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "card_not_offered"


def test_reserve_a_card_is_refused_when_unaffordable(client: TestClient):
    state = _open_scout(client)
    candidate = next(
        c for c in next(
            c for c in state["active_node"]["scout"]["choices"]
            if c["id"] == "reserve_card"
        )["candidates"] if c["legal_slots"]
    )
    _stored(state["run_id"]).snapshot["credits"] = RESERVE_CARD_COST - 1
    state = client.get(f"{RUNS_URL}/{state['run_id']}").json()

    sink = next(
        s for s in state["active_node"]["credit_sinks"] if s["id"] == "reserve_card"
    )
    assert sink["affordable"] is False
    assert sink["unavailable_reason"] == "insufficient_credits"

    resp = _try_act(
        client, state["run_id"], action_type="film_room",
        choice="reserve_card", card_id=candidate["card_id"],
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["error_code"] == "insufficient_credits"


# ---------------------------------------------------------------------------
# The snapshot round-trips every v3 field
# ---------------------------------------------------------------------------

def test_the_snapshot_round_trips_the_whole_v3_state():
    """Every field below is something the player PAID for or progress they made.
    A serialiser that dropped one would silently hand back a run that never
    happened, and the run would still look valid."""
    from app.services.run_the_table.serialization import state_from_dict, state_to_dict
    from nba_peak.run_the_table.cards import get_pool
    from nba_peak.run_the_table.generation import generate_blueprint
    from nba_peak.run_the_table.state import create_run

    pool = get_pool()
    blueprint = generate_blueprint(4242, "standard", None, pool)
    state = create_run(blueprint, "rtt-round-trip", owner_sub="sub-1")

    state.scouted_boss_acts = [1, 2]
    state.pending_prep = {
        "lane": "statistical_impact", "label": "Statistical Impact",
        "bonus": SCOUT_PREP_LANE_BONUS, "act": 2,
    }
    state.role_focus = {
        "role": "anchor", "acquired_act": 1, "acquired_stage": 2,
        "consumed_node_id": "a2s1o0",
    }
    state.reserved_card = {
        "card_id": "x-3yr-199091", "locked_cost": 11, "locked_modifiers": [],
        "reserved_act": 1, "reserved_stage": 1,
        "offered_node_id": "a2s1o0", "status": "offered",
    }
    state.node_refreshes = {"a1s1o0": 1, "a2s1o0": 1}
    state.emergency_recoveries_used = 1
    state.sink_spend = [{"sink_id": "market_refresh", "cost": 7, "act": 1, "stage": 1}]
    state.reveal_index = 4
    state.boss_reveal_index = {1: 7, 2: 3}

    round_tripped = state_from_dict(state_to_dict(state))

    assert round_tripped.scouted_boss_acts == [1, 2]
    assert round_tripped.pending_prep == state.pending_prep
    assert round_tripped.role_focus == state.role_focus
    assert round_tripped.reserved_card == state.reserved_card
    assert round_tripped.node_refreshes == {"a1s1o0": 1, "a2s1o0": 1}
    assert round_tripped.emergency_recoveries_used == 1
    assert round_tripped.sink_spend == state.sink_spend
    assert round_tripped.reveal_index == 4
    # Keyed by act. JSON object keys are strings, so this is the assertion that
    # catches a serialiser that stringified them and never converted back.
    assert round_tripped.boss_reveal_index == {1: 7, 2: 3}
    assert all(isinstance(k, int) for k in round_tripped.boss_reveal_index)


def test_a_battle_round_trips_its_prep_bonus_and_lane_requirement(client: TestClient):
    """`lanes_to_win`, `lane_bonuses` and `player_prep_bonus` all have dataclass
    defaults, so a serialiser that omitted them would silently reset a resolved
    battle to "no preparation, three lanes" on the next load."""
    state = _open_scout(client)
    lane = state["active_node"]["scout"]["lanes"][1]["lane"]
    state = _act(
        client, state["run_id"], action_type="film_room", choice="scout_boss", lane=lane
    )
    while state["status"] != "boss_ready":
        state = _act(client, state["run_id"], **_next_action(state))
    state = _act(client, state["run_id"], action_type="resolve_boss")

    reloaded = client.get(f"{RUNS_URL}/{state['run_id']}").json()
    assert reloaded["battles"] == state["battles"]
    assert reloaded["battles"][-1]["lane_bonuses"] == {lane: SCOUT_PREP_LANE_BONUS}
    assert reloaded["battles"][-1]["lanes_to_win"] >= 3


# ---------------------------------------------------------------------------
# v2 retires gracefully — both the saved run and the challenge link (spec §4)
# ---------------------------------------------------------------------------

def test_a_saved_v2_run_is_409_with_a_message_that_explains_what_happened(
    client: TestClient,
):
    state = _create(client, seed=30090)
    _stored(state["run_id"]).snapshot["versions"] = {
        **_stored(state["run_id"]).snapshot["versions"],
        "ruleset_version": "rtt_ruleset_v2",
    }

    for resp in (
        client.get(f"{RUNS_URL}/{state['run_id']}"),
        client.post(
            f"{RUNS_URL}/{state['run_id']}/actions", json={"action_type": "advance"}
        ),
    ):
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["error_code"] == "version_mismatch"
        message = detail["message"]
        # It has to say WHICH rules it was under, WHICH rules are current, and
        # what the player can do about it. "A different ruleset" is not an
        # answer a player can act on.
        assert "rtt_ruleset_v2" in message
        assert "rtt_ruleset_v3" in message
        assert "previous ruleset" in message
        assert "start a new run" in message.lower()
        assert "Traceback" not in message


def test_a_v2_snapshot_schema_is_409_not_500(client: TestClient):
    """The snapshot SHAPE changed with v3 too: `state_from_dict` refuses schema
    1, and it must arrive as the same 409 rather than as a server crash."""
    from app.services.run_the_table.serialization import SNAPSHOT_SCHEMA_VERSION

    assert SNAPSHOT_SCHEMA_VERSION == 2

    state = _create(client, seed=30091)
    _stored(state["run_id"]).snapshot["schema_version"] = 1

    resp = client.get(f"{RUNS_URL}/{state['run_id']}")
    assert resp.status_code == 409
    detail = resp.json()["detail"]
    assert detail["error_code"] == "version_mismatch"
    assert "older format" in detail["message"]
    assert "start a new run" in detail["message"].lower()


def test_a_v2_challenge_link_retires_with_a_message_naming_both_rulesets(
    client: TestClient,
):
    from app.core.config import settings
    from app.core.security import create_session_token

    v2_token = create_session_token(
        {
            "kind": "run_the_table", "seed": 4242, "run_type": "standard",
            "date": None, "ruleset": "rtt_ruleset_v2", "nonce": "n",
        },
        settings.SIGNING_SECRET,
        ttl_seconds=3600,
    )

    # The landing page is told the truth up front rather than at create time.
    descriptor = client.get(f"{BASE}/challenges/{v2_token}").json()
    assert descriptor["ruleset_version"] == "rtt_ruleset_v2"
    assert descriptor["versions"]["ruleset_version"] == "rtt_ruleset_v2"
    assert descriptor["playable"] is False

    # And starting it is refused rather than silently handing over a v3 board
    # generated from the same seed.
    resp = client.post(
        RUNS_URL, json={"run_type": "challenge", "challenge_token": v2_token}
    )
    assert resp.status_code == 409
    message = resp.json()["detail"]["message"]
    assert "rtt_ruleset_v2" in message
    assert "rtt_ruleset_v3" in message
    assert "new link" in message
    assert "Traceback" not in message


def test_a_current_challenge_link_still_reproduces_the_board(client: TestClient):
    origin = _create(client, seed=30092)
    token = client.post(f"{RUNS_URL}/{origin['run_id']}/challenge").json()[
        "challenge_token"
    ]
    assert client.get(f"{BASE}/challenges/{token}").json()["playable"] is True

    with TestClient(app) as recipient:
        replayed = _create(recipient, run_type="challenge", challenge_token=token)
    assert replayed["seed"] == origin["seed"]
    assert [s["slot_id"] for s in replayed["reveal"]["roster"]["order"]] == [
        s["slot_id"] for s in origin["reveal"]["roster"]["order"]
    ]
    assert replayed["reveal"]["roster"]["next_slot"]["card_id"] == (
        origin["reveal"]["roster"]["next_slot"]["card_id"]
    )


# ---------------------------------------------------------------------------
# Hidden-information discipline still holds
# ---------------------------------------------------------------------------

def test_no_future_offer_or_unrevealed_lineup_leaks(client: TestClient):
    state = _create(client, seed=30095)

    # No boss lineup before the boss.
    assert state["next_boss"] is not None
    assert state["next_boss"]["revealed"] is False
    for forbidden in ("starters", "bench", "lane_profile", "roster_total"):
        assert forbidden not in state["next_boss"]
    assert state["reveal"]["boss"] is None

    # No node content anywhere on the map — only shape.
    for act in state["map"]:
        for stage in act["stages"]:
            assert set(stage) == {
                "act", "stage", "state", "chosen_node_id", "chosen_node_type",
                "option_types", "scouted",
            }

    # And no unrevealed opening card in the reveal block.
    assert state["reveal"]["roster"]["revealed_slots"] == []
    assert all("player_name" not in s for s in state["reveal"]["roster"]["order"])
