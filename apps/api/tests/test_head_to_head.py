"""Head-to-Head RUN THE TABLE — API and rules tests (pass spec §6).

This file is written the way `test_ownership_idor.py` is written: from the
attacker's side first. Asynchronous PvP was explicitly gated on the four P0
IDORs this pass closed, so the adversarial cases here are not an appendix, they
are the reason the feature was allowed to ship.

MODELLING TWO PLAYERS ON ONE TestClient
---------------------------------------
Head-to-head requires two AUTHENTICATED accounts, so identity here is swapped
by re-pointing `get_optional_auth` / `get_required_auth` on the shared session
client rather than by building a second `TestClient`. The reason is the one
`test_ownership_idor.py:36-52` documents at length and it applies unchanged:

* `with TestClient(app)` fires the app's lifespan a second time; the session
  fixture has already opened the asyncpg pool, so the nested lifespan opens
  another and closes the shared one on exit -- `InterfaceError: pool is closed`
  for every test after it.
* a bare, un-entered `TestClient(app)` drives its requests on its own event
  loop while the pool's connections belong to the session client's --
  `RuntimeError: got Future attached to a different loop`.

One app, one loop, one pool. `_as` below swaps the verified subject, which is a
faithful model of the threat: identity here *is* the JWT `sub`.

WHERE EACH RULE IS TESTED
-------------------------
The eight winner-order levels are tested against `services.head_to_head.compare`
directly, one test per level, each varying exactly one field and holding the
seven others equal. Driving eight full runs to differ at precisely one level
and nowhere else is not achievable through the engine, and a test that could
not isolate the level would not be testing the ORDER -- which is the property
spec §6 actually specifies.

Everything else -- creation, fairness, invites, spoiler safety, submission,
settlement, rematch, history, daily separation -- is driven end to end through
real HTTP, because those are the failures the HTTP layer can have.
"""
from __future__ import annotations

import base64
import json
import sys
import uuid
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import settings
from app.core.security import create_session_token
from app.main import app
from app.services import head_to_head as h2h
from nba_peak.run_the_table.config import ROSTER_SIZE, TERMINAL_STATUSES
from nba_peak.run_the_table.daily import daily_seed, today_utc_date

RTT = "/api/v1/run-the-table"
RUNS = f"{RTT}/runs"
H2H = f"{RTT}/h2h"

# A fixed past date for the daily-separation test. Well inside the 366-day
# archive window and never in the future, so the assertion is about one
# reproducible run rather than about whatever today generates.
ARCHIVE_DATE = "2026-03-14"


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

@contextmanager
def _as(sub: str):
    """Run the enclosed requests as an authenticated account. See the header."""
    subject = AuthSubject(
        sub=sub, email=f"{sub}@example.com", is_anonymous=False, raw_claims={}
    )
    app.dependency_overrides[get_optional_auth] = lambda: subject
    app.dependency_overrides[get_required_auth] = lambda: subject
    try:
        yield subject
    finally:
        app.dependency_overrides.pop(get_optional_auth, None)
        app.dependency_overrides.pop(get_required_auth, None)


def _sub(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


@pytest.fixture(autouse=True)
def _no_leaked_overrides():
    """A leaked auth override would silently authenticate every later test."""
    yield
    app.dependency_overrides.pop(get_optional_auth, None)
    app.dependency_overrides.pop(get_required_auth, None)


# ---------------------------------------------------------------------------
# Driving a RUN THE TABLE run through the EXISTING routes
# ---------------------------------------------------------------------------

def _create_run(client: TestClient, **body) -> dict:
    body.setdefault("run_type", "standard")
    resp = client.post(RUNS, json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _act(client: TestClient, run_id: str, **body) -> dict:
    resp = client.post(f"{RUNS}/{run_id}/actions", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _passive_action(state: dict) -> dict:
    """The lowest-risk legal action for the current status.

    Deliberately passive everywhere (pass / decline / bank / scout), mirroring
    `test_run_the_table.py::_next_action`, so a walk depends on nothing but the
    state machine.
    """
    status = state["status"]
    if status == "system_select":
        return {
            "action_type": "select_system",
            "system_id": state["pending_system_offer"][0]["id"],
        }
    if status == "node_select":
        return {"action_type": "choose_node", "node_id": state["stage_options"][0]["node_id"]}
    if status == "node_active":
        node_type = state["active_node"]["node_type"]
        if node_type == "draft_room":
            return {"action_type": "draft_pass"}
        if node_type == "trade_desk":
            return {"action_type": "decline_trade"}
        if node_type == "film_room":
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


def _second_option_action(state: dict) -> dict:
    """A DIFFERENT but equally mechanical policy.

    Takes the other node at every fork and buys the first affordable offer at a
    Draft Room. It hardcodes no player and picks no winner -- it simply differs
    from `_passive_action`, which is what makes it useful for proving that
    divergent choices stay deterministic.
    """
    status = state["status"]
    if status == "node_select":
        options = state["stage_options"]
        return {
            "action_type": "choose_node",
            "node_id": options[-1]["node_id"],
        }
    if status == "system_select":
        offer = state["pending_system_offer"]
        return {"action_type": "select_system", "system_id": offer[-1]["id"]}
    if status == "node_active" and state["active_node"]["node_type"] == "draft_room":
        for offer in state["active_node"].get("offers", []):
            slots = offer.get("legal_slots") or []
            if offer.get("affordable") and slots:
                return {
                    "action_type": "draft_buy",
                    "card_id": offer["card_id"],
                    "slot_id": slots[0],
                }
        return {"action_type": "draft_pass"}
    return _passive_action(state)


def _play(client: TestClient, state: dict, policy=_passive_action, max_steps: int = 80) -> dict:
    actions: list[dict] = []
    for _ in range(max_steps):
        if state["status"] in TERMINAL_STATUSES:
            return state
        action = policy(state)
        actions.append(action)
        state = _act(client, state["run_id"], **action)
    raise AssertionError(f"Run did not terminate; stuck at {state['status']!r}")


def _replay(client: TestClient, run_id: str, actions: list[dict]) -> dict:
    state = {}
    for action in actions:
        state = _act(client, run_id, **action)
    return state


def _record_actions(client: TestClient, state: dict, policy, max_steps: int = 80):
    """Play a run and return `(final_state, the exact action list applied)`."""
    actions: list[dict] = []
    for _ in range(max_steps):
        if state["status"] in TERMINAL_STATUSES:
            return state, actions
        action = policy(state)
        actions.append(action)
        state = _act(client, state["run_id"], **action)
    raise AssertionError(f"Run did not terminate; stuck at {state['status']!r}")


# ---------------------------------------------------------------------------
# Head-to-head helpers
# ---------------------------------------------------------------------------

def _create_match(client: TestClient, sub: str, seed: int = 20260801) -> tuple[dict, dict]:
    """As `sub`: start a run and mint a head-to-head from it."""
    with _as(sub):
        run = _create_run(client, seed=seed)
        resp = client.post(H2H, json={"run_id": run["run_id"]})
        assert resp.status_code == 200, resp.text
    return resp.json(), run


def _accept(client: TestClient, sub: str, token: str) -> dict:
    with _as(sub):
        resp = client.post(f"{H2H}/invite/{token}/accept", json={})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _token_payload(token: str) -> dict:
    """Decode a token's payload WITHOUT verifying -- for building attacks."""
    encoded = token.split(".")[0]
    padding = 4 - len(encoded) % 4
    if padding != 4:
        encoded += "=" * padding
    return json.loads(base64.urlsafe_b64decode(encoded))


# ---------------------------------------------------------------------------
# Published rules
# ---------------------------------------------------------------------------

def test_winner_order_is_published_in_spec_order(client: TestClient):
    """The route must publish spec §6's eight levels, in exactly that order."""
    resp = client.get(f"{H2H}/rules")
    assert resp.status_code == 200, resp.text
    order = [row["level"] for row in resp.json()["winner_order"]]
    assert order == [
        "table_cleared",
        "bosses_defeated",
        "final_act_reached",
        "lives_remaining",
        "lane_differential",
        "roster_peak3_total",
        "credit_efficiency",
        "active_play_time",
    ]
    # Level 8 is the only one where lower wins, and it is last.
    assert resp.json()["winner_order"][-1]["higher_wins"] is False
    assert all(row["higher_wins"] for row in resp.json()["winner_order"][:-1])


def test_credit_efficiency_rule_is_published_not_implied(client: TestClient):
    rule = client.get(f"{H2H}/rules").json()["credit_efficiency_rule"]
    assert rule["id"] == "roster_total_per_net_credit_v1"
    assert "credits_spent - credits_refunded" in rule["formula"]
    assert rule["higher_is_better"] is True
    assert rule["rounding_decimals"] == 6


def test_published_rules_state_that_h2h_does_not_consume_a_daily(client: TestClient):
    assert "daily" in client.get(f"{H2H}/rules").json()["daily_attempts"].lower()


# ---------------------------------------------------------------------------
# Winner ordering — one test per tie-breaker level, each isolating that level
# ---------------------------------------------------------------------------

def _metrics(**overrides) -> h2h.ComparisonMetrics:
    """A neutral baseline. Every level equal unless a test changes one."""
    base = dict(
        table_cleared=False,
        bosses_defeated=3,
        final_act_reached=4,
        lives_remaining=2,
        lane_differential=4,
        roster_peak3_total=310.5,
        credits_spent=40,
        credits_refunded=0,
        net_credits_committed=40,
        credit_efficiency=h2h.credit_efficiency(310.5, 40),
        active_play_seconds=600,
        outcome="ended_in_act",
        run_id="run-x",
        completed_at="2026-08-01T00:00:00+00:00",
    )
    base.update(overrides)
    return h2h.ComparisonMetrics(**base)  # type: ignore[arg-type]


def test_level_1_table_cleared_decides():
    result = h2h.compare(_metrics(table_cleared=True), _metrics(table_cleared=False))
    assert result["winner"] == "creator"
    assert result["decided_by"] == "table_cleared"


def test_level_1_outranks_every_level_below_it():
    """A clear beats a better line on all seven remaining levels.

    This is the ordering property itself: level 1 is not a factor among eight,
    it is decisive.
    """
    winner = _metrics(table_cleared=True, bosses_defeated=1, final_act_reached=1,
                      lives_remaining=0, lane_differential=-9,
                      roster_peak3_total=100.0, credit_efficiency=0.1,
                      active_play_seconds=99999)
    loser = _metrics(table_cleared=False, bosses_defeated=5, final_act_reached=5,
                     lives_remaining=3, lane_differential=25,
                     roster_peak3_total=999.0, credit_efficiency=99.0,
                     active_play_seconds=1)
    result = h2h.compare(winner, loser)
    assert result["winner"] == "creator"
    assert result["decided_by"] == "table_cleared"
    # And nothing below it was consulted.
    below = [lv for lv in result["levels"] if lv["level"] != "table_cleared"]
    assert all(lv["verdict"] == "not_consulted" for lv in below)


def test_level_2_bosses_defeated_decides_when_level_1_ties():
    result = h2h.compare(_metrics(bosses_defeated=4), _metrics(bosses_defeated=3))
    assert result["winner"] == "creator"
    assert result["decided_by"] == "bosses_defeated"
    assert result["levels"][0]["verdict"] == "tied"


def test_level_3_final_act_reached_decides_when_1_and_2_tie():
    result = h2h.compare(_metrics(final_act_reached=3), _metrics(final_act_reached=5))
    assert result["winner"] == "opponent"
    assert result["decided_by"] == "final_act_reached"
    assert [lv["verdict"] for lv in result["levels"][:2]] == ["tied", "tied"]


def test_level_4_lives_remaining_decides_when_1_to_3_tie():
    result = h2h.compare(_metrics(lives_remaining=3), _metrics(lives_remaining=1))
    assert result["winner"] == "creator"
    assert result["decided_by"] == "lives_remaining"
    assert [lv["verdict"] for lv in result["levels"][:3]] == ["tied"] * 3


def test_level_5_lane_differential_decides_when_1_to_4_tie():
    result = h2h.compare(_metrics(lane_differential=-2), _metrics(lane_differential=7))
    assert result["winner"] == "opponent"
    assert result["decided_by"] == "lane_differential"
    assert [lv["verdict"] for lv in result["levels"][:4]] == ["tied"] * 4


def test_level_6_roster_peak3_total_decides_when_1_to_5_tie():
    """Note both sides keep the SAME credit efficiency, so level 7 is not the
    cause. Without holding it fixed this test would pass for the wrong reason.
    """
    a = _metrics(roster_peak3_total=340.0, credit_efficiency=8.0)
    b = _metrics(roster_peak3_total=300.0, credit_efficiency=8.0)
    result = h2h.compare(a, b)
    assert result["winner"] == "creator"
    assert result["decided_by"] == "roster_peak3_total"
    assert [lv["verdict"] for lv in result["levels"][:5]] == ["tied"] * 5


def test_level_7_credit_efficiency_decides_when_1_to_6_tie():
    """Same roster total, different net credits committed. The published rule.

    Both sides finished with a 310.5 roster; one bought it for 40 net credits
    and the other for 60. Level 7 says the cheaper line wins.
    """
    thrifty = _metrics(
        credits_spent=40, credits_refunded=0, net_credits_committed=40,
        credit_efficiency=h2h.credit_efficiency(310.5, 40),
    )
    spendy = _metrics(
        credits_spent=60, credits_refunded=0, net_credits_committed=60,
        credit_efficiency=h2h.credit_efficiency(310.5, 60),
    )
    result = h2h.compare(thrifty, spendy)
    assert result["winner"] == "creator"
    assert result["decided_by"] == "credit_efficiency"
    assert [lv["verdict"] for lv in result["levels"][:6]] == ["tied"] * 6


def test_credit_efficiency_formula_matches_the_published_rule():
    assert h2h.credit_efficiency(310.5, 40) == round(310.5 / 40, 6)
    # A refunded credit was never committed.
    assert h2h.credit_efficiency(100.0, 30 - 10) == round(100.0 / 20, 6)
    # Zero spend scores best, and never divides by zero.
    assert h2h.credit_efficiency(100.0, 0) == 100.0


def test_level_8_active_play_time_decides_only_at_the_very_end():
    """Lower wins, and only when all seven levels above are exactly equal."""
    fast = _metrics(active_play_seconds=400)
    slow = _metrics(active_play_seconds=900)
    result = h2h.compare(fast, slow)
    assert result["winner"] == "creator"
    assert result["decided_by"] == "active_play_time"
    assert [lv["verdict"] for lv in result["levels"][:7]] == ["tied"] * 7


def test_level_8_will_not_decide_inside_the_published_latency_margin():
    """Network latency must never count (spec §6).

    It cannot be subtracted, so it is made unable to reach the threshold: a gap
    smaller than the published margin is a draw, not a win.
    """
    assert h2h.ACTIVE_TIME_MIN_MARGIN_SECONDS == 2
    near = h2h.compare(_metrics(active_play_seconds=600), _metrics(active_play_seconds=601))
    assert near["winner"] == "draw"
    assert near["decided_by"] is None
    assert near["levels"][-1]["verdict"] == "tied_within_margin"

    clear = h2h.compare(_metrics(active_play_seconds=600), _metrics(active_play_seconds=602))
    assert clear["winner"] == "creator"
    assert clear["decided_by"] == "active_play_time"


def test_all_eight_levels_equal_is_a_draw():
    result = h2h.compare(_metrics(), _metrics())
    assert result["winner"] == "draw"
    assert result["decided_by"] is None


# ---------------------------------------------------------------------------
# Fairness — same seed inputs produce identical roster / nodes / bosses
# ---------------------------------------------------------------------------

def test_both_players_get_identical_roster_nodes_and_bosses(client: TestClient):
    """Spec §6's fairness clause, asserted field by field on both live runs."""
    creator, opponent = _sub("creator"), _sub("opponent")
    created, creator_run = _create_match(client, creator, seed=777001)
    accepted = _accept(client, opponent, created["invite_token"])

    # The opening roster is concealed until each player reveals it (P1-E) --
    # reveal both, each under its own account, before comparing card ids.
    # This is a STRONGER fairness assertion than reading the raw payload
    # would have been: it proves the same seed reveals the same roster in the
    # same order for both players, not merely that the same ids were assigned
    # server-side.
    with _as(opponent):
        opp_state = client.post(
            f"{RUNS}/{accepted['you']['run_id']}/actions",
            json={"action_type": "reveal", "target": "roster", "count": ROSTER_SIZE},
        ).json()
    with _as(creator):
        cre_state = client.post(
            f"{RUNS}/{creator_run['run_id']}/actions",
            json={"action_type": "reveal", "target": "roster", "count": ROSTER_SIZE},
        ).json()

    def roster(state: dict, key: str) -> list:
        return [
            (slot["slot_id"], slot["role"], (slot["card"] or {}).get("card_id"))
            for slot in state[key]
        ]

    assert cre_state["seed"] == opp_state["seed"] == created["seed"]
    # same starting roster, slot for slot
    assert roster(cre_state, "starters") == roster(opp_state, "starters")
    assert roster(opp_state, "starters")[0][2], "the roster must not be empty"
    assert roster(cre_state, "bench") == roster(opp_state, "bench")
    # same initial perk (System) offers
    assert [o["id"] for o in cre_state["pending_system_offer"]] == [
        o["id"] for o in opp_state["pending_system_offer"]
    ]
    # same node structure
    assert cre_state["map"] == opp_state["map"]
    # same bosses, in the same order
    assert cre_state["next_boss"] == opp_state["next_boss"]
    # same ruleset
    assert cre_state["versions"] == opp_state["versions"]


def test_the_pinned_fairness_digest_covers_the_six_spec_inputs(client: TestClient):
    created, _run = _create_match(client, _sub("creator"), seed=777002)
    fairness = created["fairness"]
    for field in (
        "ruleset_version",
        "starting_starters",
        "starting_bench",
        "system_offers",
        "boss_ids",
        "node_signature",
        "digest",
    ):
        assert field in fairness, field
    assert len(fairness["boss_ids"]) >= 1
    # Both System offers, not just the first.
    assert len(fairness["system_offers"]) == 2


def test_a_tampered_pin_is_refused_rather_than_silently_compared():
    """`assert_fairness` must fail closed, and must name the field.

    Driven at the service level because producing a genuinely different
    blueprint for the same seed requires changing the engine, which is frozen.
    """
    from app.services.run_the_table import runs as run_service

    blueprint = run_service.blueprint_for(
        _FakeStored(seed=777003), run_service.card_pool()
    )
    pinned = h2h.fairness_digest(blueprint)
    tampered = {**pinned, "boss_ids": ["not-the-real-boss"], "digest": "nope"}
    with pytest.raises(h2h.FairnessMismatch) as exc:
        h2h.assert_fairness(tampered, blueprint)
    assert exc.value.field == "boss_ids"
    # And the untampered pin passes.
    h2h.assert_fairness(pinned, blueprint)


class _FakeStored:
    """The three fields `blueprint_for` reads. Not a repository row."""

    def __init__(self, seed: int) -> None:
        self.seed = seed
        self.run_type = "challenge"
        self.run_date = None


# ---------------------------------------------------------------------------
# Divergent choices stay deterministic
# ---------------------------------------------------------------------------

def test_divergent_choices_diverge_and_stay_deterministic(client: TestClient):
    """Two different policies on one board produce different runs; replaying
    either produces the same run again.

    Both halves matter. Divergence alone would be satisfied by randomness;
    determinism alone would be satisfied by the two policies being identical.
    """
    player = _sub("determinism")
    seed = 777004
    with _as(player):
        a = _create_run(client, seed=seed)
        a_final, a_actions = _record_actions(client, a, _passive_action)

        b = _create_run(client, seed=seed)
        b_final, b_actions = _record_actions(client, b, _second_option_action)

        # A third run on the same seed, replaying A's exact action list.
        c = _create_run(client, seed=seed)
        c_final = _replay(client, c["run_id"], a_actions)

    def signature(state: dict) -> tuple:
        receipt = state["receipt"]
        return (
            receipt["table_cleared"],
            receipt["bosses_defeated"],
            receipt["lives_remaining"],
            round(receipt["roster_total"], 6),
            receipt["credits_spent"],
            tuple(sorted(s["card_id"] for s in receipt["starters"])),
            tuple(
                (b["act"], b["boss_id"], b["outcome"], b["player_lanes_won"])
                for b in receipt["battles"]
            ),
        )

    assert a_actions != b_actions, "the two policies must actually differ"
    assert signature(a_final) != signature(b_final), (
        "divergent choices produced an identical run -- choices are not affecting "
        "the outcome"
    )
    assert signature(a_final) == signature(c_final), (
        "the same seed and the same actions produced a different run -- the "
        "engine is not deterministic"
    )


def test_market_refresh_stream_is_keyed_not_sequential(client: TestClient):
    """Spec §6: randomness derives from stable event keys.

    A refreshed market must be a pure function of
    (seed, act, stage, node_type, refresh_index) -- so two runs on the same seed
    that both refresh the same node's market see the SAME second board, even
    though one of them took different actions before arriving.
    """
    from app.services.run_the_table import runs as run_service
    from nba_peak.run_the_table.generation import refreshed_offers

    pool = run_service.card_pool()
    a = run_service.blueprint_for(_FakeStored(seed=777005), pool)
    # A SECOND, independently generated blueprint from the same seed -- the two
    # players' boards.
    b = run_service.blueprint_for(_FakeStored(seed=777005), pool)

    option = next(
        o for plan in a.stages for o in plan.options if o.node_type == "draft_room"
    )
    first_a = refreshed_offers(pool, a, option.node_id, refresh_index=1)
    first_b = refreshed_offers(pool, b, option.node_id, refresh_index=1)
    later_a = refreshed_offers(pool, a, option.node_id, refresh_index=2)

    assert first_a == first_b, (
        "the same node refreshed the same number of times must give both "
        "players the same board"
    )
    assert first_a != later_a, (
        "refresh_index must be part of the stream key, or a market could be "
        "re-rolled for free"
    )
    # And it is genuinely a different board from the un-refreshed one.
    plan = next(p for p in a.stages if option.node_id in p.payloads)
    assert first_a != plan.payloads[option.node_id]["offer_ids"]


# ---------------------------------------------------------------------------
# Invite token security
# ---------------------------------------------------------------------------

def test_a_forged_invite_token_is_rejected(client: TestClient):
    with _as(_sub("attacker")):
        resp = client.get(f"{H2H}/invite/not-a-real-token")
    assert resp.status_code == 404, resp.text
    assert resp.json()["detail"]["error_code"] == "invalid_invite"


def test_an_invite_with_a_broken_signature_is_rejected(client: TestClient):
    created, _run = _create_match(client, _sub("creator"), seed=777006)
    payload, sig = created["invite_token"].split(".")
    forged = f"{payload}.{'A' * len(sig)}"
    resp = client.get(f"{H2H}/invite/{forged}")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error_code"] == "invalid_invite"


def test_a_wrong_kind_token_carrying_a_REAL_invite_id_is_rejected(client: TestClient):
    """The cross-mode confusion attack the `kind` discriminator exists for.

    Peak Draft's challenge tokens, RUN THE TABLE's challenge tokens and this
    invite are all HMAC'd with the same `PEAK3_SIGNING_SECRET`. This test signs
    a token that is valid in every way EXCEPT its `kind`, and carries a real,
    live invite id -- so the only thing that can refuse it is the kind check.
    """
    created, _run = _create_match(client, _sub("creator"), seed=777007)
    real_invite_id = _token_payload(created["invite_token"])["inv"]

    for wrong_kind in ("run_the_table", "peak_duel_challenge", None):
        claims = {"inv": real_invite_id, "ruleset": "rtt_ruleset_v3", "nonce": "x"}
        if wrong_kind is not None:
            claims["kind"] = wrong_kind
        token = create_session_token(claims, settings.SIGNING_SECRET, ttl_seconds=3600)
        resp = client.get(f"{H2H}/invite/{token}")
        assert resp.status_code == 404, (wrong_kind, resp.text)
        assert resp.json()["detail"]["error_code"] == "invalid_invite"

    # The genuine token, same invite id, still resolves. Without this the test
    # above would pass even if the route were simply broken.
    assert client.get(f"{H2H}/invite/{created['invite_token']}").status_code == 200


def test_an_expired_invite_token_is_rejected(client: TestClient):
    created, _run = _create_match(client, _sub("creator"), seed=777008)
    real_invite_id = _token_payload(created["invite_token"])["inv"]
    expired = create_session_token(
        {
            "inv": real_invite_id,
            "ruleset": "rtt_ruleset_v3",
            "nonce": "x",
            "kind": h2h.H2H_INVITE_TOKEN_KIND,
        },
        settings.SIGNING_SECRET,
        ttl_seconds=-10,
    )
    resp = client.get(f"{H2H}/invite/{expired}")
    assert resp.status_code == 404
    assert resp.json()["detail"]["error_code"] == "invalid_invite"

    with _as(_sub("late")):
        accept = client.post(f"{H2H}/invite/{expired}/accept", json={})
    assert accept.status_code == 404
    assert accept.json()["detail"]["error_code"] == "invalid_invite"


def test_the_invite_token_does_not_contain_a_mutable_resource_id(client: TestClient):
    """Spec §6: "the invite must not expose mutable resource IDs"."""
    created, creator_run = _create_match(client, _sub("creator"), seed=777009)
    claims = _token_payload(created["invite_token"])
    blob = json.dumps(claims)
    assert created["match_id"] not in blob
    assert creator_run["run_id"] not in blob
    assert set(claims) == {"inv", "ruleset", "nonce", "kind", "exp"}
    # And what it does carry is high-entropy.
    assert len(claims["inv"]) >= 24


def test_invite_lookups_are_rate_limited(client: TestClient):
    """The one route here that takes no account is the one a stranger can loop.

    Not what stops an invite being found -- that is a 128-bit `inv` under an
    HMAC -- but the second layer, in the spirit of `core/rate_limit.py`'s own
    docstring. The limit is high enough that no legitimate flow reaches it,
    which is exactly why the test has to exceed it deliberately.
    """
    from app.api.v1.head_to_head import _INVITE_READ_RULE

    last = None
    for _ in range(_INVITE_READ_RULE.limit + 2):
        last = client.get(f"{H2H}/invite/still-not-a-real-token")
    assert last is not None
    assert last.status_code == 429, last.text
    assert last.json()["detail"]["error_code"] == "rate_limited"
    assert int(last.headers["Retry-After"]) >= 1


def test_the_invite_descriptor_is_spoiler_safe(client: TestClient):
    creator = _sub("creator")
    created, creator_run = _create_match(client, creator, seed=777010)
    with _as(creator):
        state = _play(client, client.get(f"{RUNS}/{creator_run['run_id']}").json())
        client.post(f"{H2H}/{created['match_id']}/result", json={})
    assert state["status"] in TERMINAL_STATUSES

    body = client.get(f"{H2H}/invite/{created['invite_token']}").json()
    blob = json.dumps(body)
    assert "result" not in body
    assert "seed" not in body
    for key in ("starters", "bench", "bosses", "roster_total", "table_cleared"):
        assert key not in blob, key
    assert body["creator_display_name"]
    assert body["status"] in ("open", "in_progress", "complete")


# ---------------------------------------------------------------------------
# Creation ownership — the S4 shape, not repeated
# ---------------------------------------------------------------------------

def test_a_stranger_cannot_mint_a_head_to_head_from_your_run(client: TestClient):
    """`POST /draft/challenges` let anyone mint from a stranger's game (S4).

    The same shape here would pin a stranger's board and name them creator.
    """
    victim = _sub("victim")
    with _as(victim):
        run = _create_run(client, seed=777011)
    with _as(_sub("attacker")):
        resp = client.post(H2H, json={"run_id": run["run_id"]})
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"]["error_code"] == "not_your_run"


def test_an_anonymous_caller_cannot_create_a_head_to_head(client: TestClient):
    """Spec §6: an AUTHENTICATED user creates.

    No auth override is installed, so the session client presents only its
    anonymous cookie.
    """
    resp = client.post(H2H, json={"run_id": "rtt-whatever"})
    assert resp.status_code == 401, resp.text


def test_creating_from_a_run_that_does_not_exist_is_404(client: TestClient):
    with _as(_sub("creator")):
        resp = client.post(H2H, json={"run_id": "rtt-does-not-exist"})
    assert resp.status_code == 404
    assert resp.json()["detail"]["error_code"] == "run_not_found"


# ---------------------------------------------------------------------------
# Participation — a match id is worth a 403
# ---------------------------------------------------------------------------

def test_a_non_participant_cannot_read_the_match(client: TestClient):
    created, _run = _create_match(client, _sub("creator"), seed=777012)
    with _as(_sub("stranger")):
        resp = client.get(f"{H2H}/{created['match_id']}")
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"]["error_code"] == "not_a_participant"


def test_a_non_participant_cannot_submit_a_result(client: TestClient):
    created, _run = _create_match(client, _sub("creator"), seed=777013)
    with _as(_sub("stranger")):
        resp = client.post(f"{H2H}/{created['match_id']}/result", json={})
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_code"] == "not_a_participant"


def test_a_non_participant_cannot_read_the_receipt_or_offer_a_rematch(
    client: TestClient,
):
    created, _run = _create_match(client, _sub("creator"), seed=777014)
    with _as(_sub("stranger")) :
        receipt = client.get(f"{H2H}/{created['match_id']}/receipt")
        rematch = client.post(f"{H2H}/{created['match_id']}/rematch", json={})
    for resp in (receipt, rematch):
        assert resp.status_code == 403, resp.text
        assert resp.json()["detail"]["error_code"] == "not_a_participant"


def test_a_participant_cannot_submit_on_the_other_participants_behalf(
    client: TestClient,
):
    """There is no request field that names a run, a participant or a result.

    The API surface itself is the defence, so this asserts the surface: every
    attempt to smuggle the opponent's run id or a forged metric into the
    submission is rejected at the schema boundary (422), and the honest
    submission still resolves through the SERVER's record of which run is the
    caller's.
    """
    creator, opponent = _sub("creator"), _sub("opponent")
    created, creator_run = _create_match(client, creator, seed=777015)
    accepted = _accept(client, opponent, created["invite_token"])
    opponent_run_id = accepted["you"]["run_id"]

    with _as(creator):
        for forged in (
            {"run_id": opponent_run_id},
            {"participant_sub": opponent},
            {"result": {"table_cleared": True}},
            {"table_cleared": True},
        ):
            resp = client.post(f"{H2H}/{created['match_id']}/result", json=forged)
            assert resp.status_code == 422, (forged, resp.text)

        # And the honest submission uses the creator's OWN run, not the one
        # named above.
        state = _play(client, client.get(f"{RUNS}/{creator_run['run_id']}").json())
        assert state["status"] in TERMINAL_STATUSES
        ok = client.post(f"{H2H}/{created['match_id']}/result", json={})
    assert ok.status_code == 200, ok.text
    assert ok.json()["you"]["run_id"] == creator_run["run_id"]
    assert ok.json()["you"]["run_id"] != opponent_run_id


def test_the_creator_cannot_accept_their_own_invite(client: TestClient):
    creator = _sub("creator")
    created, _run = _create_match(client, creator, seed=777016)
    with _as(creator):
        resp = client.post(f"{H2H}/invite/{created['invite_token']}/accept", json={})
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["error_code"] == "cannot_play_yourself"


def test_a_third_player_cannot_join(client: TestClient):
    created, _run = _create_match(client, _sub("creator"), seed=777017)
    _accept(client, _sub("opponent"), created["invite_token"])
    with _as(_sub("gatecrasher")):
        resp = client.post(f"{H2H}/invite/{created['invite_token']}/accept", json={})
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["error_code"] == "match_full"


def test_the_invite_grants_only_seating_yourself_not_touching_the_other_run(
    client: TestClient,
):
    """A challenge token permits only the intended read/play behaviour (§7)."""
    creator, opponent = _sub("creator"), _sub("opponent")
    created, creator_run = _create_match(client, creator, seed=777018)
    _accept(client, opponent, created["invite_token"])

    with _as(opponent):
        # The creator's run is not reachable, even holding the invite.
        read = client.get(f"{RUNS}/{creator_run['run_id']}")
        act = client.post(
            f"{RUNS}/{creator_run['run_id']}/actions",
            json={"action_type": "draft_pass"},
        )
    assert read.status_code == 403, read.text
    assert read.json()["detail"]["error_code"] == "run_not_owned"
    assert act.status_code == 403, act.text


def test_accept_is_idempotent_across_two_tabs(client: TestClient):
    """Two tabs on the invite page must not produce two boards."""
    created, _run = _create_match(client, _sub("creator"), seed=777019)
    opponent = _sub("opponent")
    first = _accept(client, opponent, created["invite_token"])
    second = _accept(client, opponent, created["invite_token"])
    assert first["you"]["run_id"] == second["you"]["run_id"]
    assert first["match_id"] == second["match_id"]


# ---------------------------------------------------------------------------
# Spoiler safety
# ---------------------------------------------------------------------------

def test_neither_side_sees_the_others_result_until_both_complete(client: TestClient):
    creator, opponent = _sub("creator"), _sub("opponent")
    created, creator_run = _create_match(client, creator, seed=777020)
    accepted = _accept(client, opponent, created["invite_token"])
    opponent_run_id = accepted["you"]["run_id"]

    # Creator finishes and submits first.
    with _as(creator):
        _play(client, client.get(f"{RUNS}/{creator_run['run_id']}").json())
        submitted = client.post(f"{H2H}/{created['match_id']}/result", json={})
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["both_complete"] is False
    assert submitted.json()["opponent_status"] == "hidden"
    assert submitted.json()["opponent"]["result"] is None

    # The opponent, still mid-run, must not be able to read the creator's.
    with _as(opponent):
        view = client.get(f"{H2H}/{created['match_id']}").json()
        receipt = client.get(f"{H2H}/{created['match_id']}/receipt")
    assert view["opponent_status"] == "hidden"
    assert view["opponent"]["result"] is None
    assert view["settlement"] is None
    assert "table_cleared" not in json.dumps(view["opponent"])
    assert receipt.status_code == 409
    assert receipt.json()["detail"]["error_code"] == "awaiting_opponent"

    # Opponent finishes -> both sides open at once, and only then.
    with _as(opponent):
        _play(client, client.get(f"{RUNS}/{opponent_run_id}").json())
        settled = client.post(f"{H2H}/{created['match_id']}/result", json={})
    assert settled.status_code == 200, settled.text
    assert settled.json()["both_complete"] is True
    assert settled.json()["opponent"]["result"] is not None
    assert settled.json()["settlement"]["winner"] in ("creator", "opponent", "draw")

    with _as(creator):
        after = client.get(f"{H2H}/{created['match_id']}").json()
    assert after["both_complete"] is True
    assert after["opponent"]["result"] is not None


def test_the_opponents_run_id_is_never_exposed(client: TestClient):
    """Even after settlement. It is someone else's resource id."""
    creator, opponent = _sub("creator"), _sub("opponent")
    created, creator_run = _create_match(client, creator, seed=777021)
    accepted = _accept(client, opponent, created["invite_token"])
    opponent_run_id = accepted["you"]["run_id"]

    with _as(creator):
        _play(client, client.get(f"{RUNS}/{creator_run['run_id']}").json())
        client.post(f"{H2H}/{created['match_id']}/result", json={})
    with _as(opponent):
        _play(client, client.get(f"{RUNS}/{opponent_run_id}").json())
        client.post(f"{H2H}/{created['match_id']}/result", json={})

    with _as(creator):
        view = client.get(f"{H2H}/{created['match_id']}").json()
        receipt = client.get(f"{H2H}/{created['match_id']}/receipt").json()
    assert view["opponent"]["run_id"] is None
    assert opponent_run_id not in json.dumps(view)
    assert opponent_run_id not in json.dumps(receipt["opponent"])


# ---------------------------------------------------------------------------
# Submission, settlement and the side-by-side receipt
# ---------------------------------------------------------------------------

def test_you_cannot_submit_an_unfinished_run(client: TestClient):
    creator = _sub("creator")
    created, _run = _create_match(client, creator, seed=777022)
    with _as(creator):
        resp = client.post(f"{H2H}/{created['match_id']}/result", json={})
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"]["error_code"] == "run_not_finished"


def test_submission_is_idempotent_and_the_first_write_wins(client: TestClient):
    creator = _sub("creator")
    created, creator_run = _create_match(client, creator, seed=777023)
    with _as(creator):
        _play(client, client.get(f"{RUNS}/{creator_run['run_id']}").json())
        first = client.post(f"{H2H}/{created['match_id']}/result", json={}).json()
        second = client.post(f"{H2H}/{created['match_id']}/result", json={}).json()
    assert first["you"]["result"] == second["you"]["result"]
    assert first["you"]["result"]["run_id"] == creator_run["run_id"]


def test_the_settlement_is_written_by_the_second_submission_not_by_a_read(
    client: TestClient,
):
    """Public result viewing never implies mutation (spec §7).

    Peak Draft's `/comparison` settled on a GET; that shape is not repeated.
    Here the receipt is fetched repeatedly before and after settlement and the
    settlement never changes as a result of being read.
    """
    creator, opponent = _sub("creator"), _sub("opponent")
    created, creator_run = _create_match(client, creator, seed=777024)
    accepted = _accept(client, opponent, created["invite_token"])

    with _as(creator):
        _play(client, client.get(f"{RUNS}/{creator_run['run_id']}").json())
        client.post(f"{H2H}/{created['match_id']}/result", json={})
        # Reading before the opponent is in must not settle anything.
        for _ in range(3):
            assert client.get(f"{H2H}/{created['match_id']}/receipt").status_code == 409
        assert client.get(f"{H2H}/{created['match_id']}").json()["settlement"] is None

    with _as(opponent):
        _play(client, client.get(f"{RUNS}/{accepted['you']['run_id']}").json())
        client.post(f"{H2H}/{created['match_id']}/result", json={})

    with _as(creator):
        one = client.get(f"{H2H}/{created['match_id']}/receipt").json()
        two = client.get(f"{H2H}/{created['match_id']}/receipt").json()
    assert one["settlement"] == two["settlement"]
    assert one["your_role"] == "creator"
    assert one["your_outcome"] in ("won", "lost", "draw")
    # The side-by-side really is side by side.
    assert one["creator"]["result"] is not None
    assert one["opponent"]["result"] is not None
    assert one["settlement"]["levels"][0]["level"] == "table_cleared"


def test_the_settlement_agrees_with_the_published_comparison(client: TestClient):
    """The stored verdict must be exactly what `compare()` says about the two
    stored metric sets -- not a second, independently-computed answer.
    """
    creator, opponent = _sub("creator"), _sub("opponent")
    created, creator_run = _create_match(client, creator, seed=777025)
    accepted = _accept(client, opponent, created["invite_token"])
    with _as(creator):
        _play(client, client.get(f"{RUNS}/{creator_run['run_id']}").json())
        client.post(f"{H2H}/{created['match_id']}/result", json={})
    with _as(opponent):
        _play(client, client.get(f"{RUNS}/{accepted['you']['run_id']}").json())
        client.post(f"{H2H}/{created['match_id']}/result", json={})
        receipt = client.get(f"{H2H}/{created['match_id']}/receipt").json()

    recomputed = h2h.compare(
        h2h.ComparisonMetrics.from_dict(receipt["creator"]["result"]),
        h2h.ComparisonMetrics.from_dict(receipt["opponent"]["result"]),
    )
    assert receipt["settlement"]["winner"] == recomputed["winner"]
    assert receipt["settlement"]["decided_by"] == recomputed["decided_by"]


# ---------------------------------------------------------------------------
# Rematch
# ---------------------------------------------------------------------------

def test_a_participant_can_offer_a_rematch_on_a_new_board(client: TestClient):
    creator, opponent = _sub("creator"), _sub("opponent")
    created, _run = _create_match(client, creator, seed=777026)
    _accept(client, opponent, created["invite_token"])

    with _as(opponent):
        resp = client.post(f"{H2H}/{created['match_id']}/rematch", json={})
    assert resp.status_code == 200, resp.text
    rematch = resp.json()
    assert rematch["match_id"] != created["match_id"]
    assert rematch["seed"] != created["seed"], "a rematch must be a NEW board"
    assert rematch["invite_url_path"].startswith("/arena/run-the-table/h2h/invite/")

    # And the original creator can accept it, getting the same new board.
    joined = _accept(client, creator, rematch["invite_token"])
    with _as(creator):
        state = client.get(f"{RUNS}/{joined['you']['run_id']}").json()
    assert state["seed"] == rematch["seed"]


def test_rematch_is_idempotent_across_two_tabs(client: TestClient):
    creator = _sub("creator")
    created, _run = _create_match(client, creator, seed=777027)
    _accept(client, _sub("opponent"), created["invite_token"])
    with _as(creator):
        first = client.post(f"{H2H}/{created['match_id']}/rematch", json={})
        second = client.post(f"{H2H}/{created['match_id']}/rematch", json={})
    assert first.status_code == 200, first.text
    assert second.status_code == 409, second.text
    assert second.json()["detail"]["error_code"] == "rematch_already_offered"


# ---------------------------------------------------------------------------
# History
# ---------------------------------------------------------------------------

def test_history_lists_your_matches_and_hides_unsettled_outcomes(
    client: TestClient,
):
    creator, opponent = _sub("creator"), _sub("opponent")
    created, creator_run = _create_match(client, creator, seed=777028)
    accepted = _accept(client, opponent, created["invite_token"])

    with _as(creator):
        history = client.get(f"{H2H}/history").json()["matches"]
    mine = next(m for m in history if m["match_id"] == created["match_id"])
    assert mine["your_role"] == "creator"
    assert mine["opponent_display_name"]
    assert mine["your_outcome"] is None, "an unsettled match must not leak an outcome"

    with _as(creator):
        _play(client, client.get(f"{RUNS}/{creator_run['run_id']}").json())
        client.post(f"{H2H}/{created['match_id']}/result", json={})
    with _as(opponent):
        _play(client, client.get(f"{RUNS}/{accepted['you']['run_id']}").json())
        client.post(f"{H2H}/{created['match_id']}/result", json={})

        opp_history = client.get(f"{H2H}/history").json()["matches"]
    theirs = next(m for m in opp_history if m["match_id"] == created["match_id"])
    assert theirs["your_role"] == "opponent"
    assert theirs["your_outcome"] in ("won", "lost", "draw")
    assert theirs["decided_by"] is not None or theirs["your_outcome"] == "draw"


def test_history_never_shows_someone_elses_match(client: TestClient):
    created, _run = _create_match(client, _sub("creator"), seed=777029)
    with _as(_sub("stranger")):
        history = client.get(f"{H2H}/history").json()["matches"]
    assert all(m["match_id"] != created["match_id"] for m in history)


def test_history_requires_an_account(client: TestClient):
    assert client.get(f"{H2H}/history").status_code == 401


# ---------------------------------------------------------------------------
# Daily separation
# ---------------------------------------------------------------------------

def test_head_to_head_play_does_not_consume_a_daily_attempt(client: TestClient):
    """Spec §6's last line, and the most damaging thing to get wrong.

    The creator plays their DAILY and mints a head-to-head from it. The
    opponent accepts. The opponent's daily for that date must still be
    untouched, and their run must be a `challenge`, not a `daily`.
    """
    creator, opponent = _sub("creator"), _sub("opponent")
    date = today_utc_date()

    with _as(creator):
        daily = client.post(RUNS, json={"run_type": "daily", "date": date})
        assert daily.status_code == 200, daily.text
        daily_state = daily.json()
        assert daily_state["run_type"] == "daily"
        assert daily_state["seed"] == daily_seed(date)
        created = client.post(H2H, json={"run_id": daily_state["run_id"]})
    assert created.status_code == 200, created.text
    created = created.json()

    with _as(opponent):
        before = client.get(f"{RTT}/daily?date={date}").json()
        assert before.get("already_played") is False
    accepted = _accept(client, opponent, created["invite_token"])
    with _as(opponent):
        after = client.get(f"{RTT}/daily?date={date}").json()
        run = client.get(f"{RUNS}/{accepted['you']['run_id']}").json()

    assert after.get("already_played") is False, (
        "accepting a head-to-head minted from a daily burned the recipient's "
        "daily attempt"
    )
    assert after.get("existing_run_id") is None
    assert run["run_type"] == "challenge"
    assert run["seed"] == daily_state["seed"], "but it IS the same board"

    # And the opponent's own daily is still available to them afterwards.
    with _as(opponent):
        own_daily = client.post(RUNS, json={"run_type": "daily", "date": date})
    assert own_daily.status_code == 200, own_daily.text
    assert own_daily.json()["run_id"] != accepted["you"]["run_id"]


# ---------------------------------------------------------------------------
# Metric extraction
# ---------------------------------------------------------------------------

def test_metrics_are_recomputed_server_side_from_the_engines_own_receipt(
    client: TestClient,
):
    """Every number in a stored result must trace to the engine's receipt."""
    creator = _sub("creator")
    created, creator_run = _create_match(client, creator, seed=777030)
    with _as(creator):
        final = _play(client, client.get(f"{RUNS}/{creator_run['run_id']}").json())
        view = client.post(f"{H2H}/{created['match_id']}/result", json={}).json()

    receipt = final["receipt"]
    result = view["you"]["result"]
    assert result["table_cleared"] == receipt["table_cleared"]
    assert result["bosses_defeated"] == receipt["bosses_defeated"]
    assert result["lives_remaining"] == receipt["lives_remaining"]
    assert result["credits_spent"] == receipt["credits_spent"]
    assert result["credits_refunded"] == receipt["credits_refunded"]
    assert result["roster_peak3_total"] == round(receipt["roster_total"], 6)
    assert result["net_credits_committed"] == (
        receipt["credits_spent"] - receipt["credits_refunded"]
    )
    assert result["credit_efficiency"] == h2h.credit_efficiency(
        receipt["roster_total"], result["net_credits_committed"]
    )
    # Aggregate lane differential is the sum over battles, not a battle's own.
    assert result["lane_differential"] == sum(
        b["player_lanes_won"] - b["opponent_lanes_won"] for b in receipt["battles"]
    )
    assert result["active_play_seconds"] >= 0


def test_active_play_time_is_server_measured_and_starts_at_run_creation():
    """Tutorial time cannot be inside the window, because the window starts at
    the run's own `created_at` -- which is written by the server when the run is
    created, after every landing, rules and onboarding screen.
    """
    from nba_peak.run_the_table.schemas import RunState

    state = _bare_state(
        created_at="2026-08-01T10:00:00+00:00",
        last_action_at="2026-08-01T10:07:30+00:00",
    )
    assert isinstance(state, RunState)
    assert h2h.active_play_seconds(state) == 450
    # Never negative, whatever the clocks say.
    backwards = replace(
        state,
        created_at="2026-08-01T10:07:30+00:00",
        last_action_at="2026-08-01T10:00:00+00:00",
    )
    assert h2h.active_play_seconds(backwards) == 0


def _bare_state(*, created_at: str, last_action_at: str):
    from nba_peak.run_the_table.schemas import RunState

    return RunState(
        run_id="r", seed=1, run_type="challenge", date=None, status="complete",
        act=5, stage=1, credits=0, lives=1, starters=[], bench=[], systems=[],
        veteran_minimum_used_in_act={}, pending_system_offer=None,
        active_node_id=None, scouted_stage_keys=[], resolved_node_ids=[],
        battles=[], action_log=[], acquisitions=[], trades=[],
        created_at=created_at, last_action_at=last_action_at,
    )
