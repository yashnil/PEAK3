"""FRANCHISE DRAFT and DECADE DRAFT, through the Arena mode contract and routes.

The rules are pinned in `tests/three_man_weave/test_variants.py`. This file
pins the seam: the variants are registered as their own modes with the same
implementation and bot, a whole seeded match is deterministic through
`reduce`, the projection publishes the constraint but never a resolved card,
and a practice match of each finishes through the real HTTP routes.
"""
from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.auth import AuthSubject, get_optional_auth, get_required_auth
from app.core.config import settings
from app.core.dependencies import _memory_arena_repo
from app.main import app
from app.repositories.arena_protocols import (
    MATCH_STATUS_ACTIVE,
    MATCH_STATUS_COMPLETED,
    ArenaMatch,
    ArenaSeat,
    CommandRequest,
    ReducerInput,
)
from app.services.arena import bots as bot_service
from app.services.arena.modes import registry as mode_registry
from app.services.three_man_weave import mode as tmw
from app.services.twenty_dollar import mode as td_module

from nba_peak.three_man_weave.config import PARTICIPANT_COUNT, ROUNDS

NOW = datetime(2026, 9, 14, 12, 0, 0, tzinfo=timezone.utc)
VARIANT_MODES = [(tmw.franchise_mode, "franchise"), (tmw.decade_mode, "decade")]


def _seats() -> tuple[ArenaSeat, ...]:
    return tuple(
        ArenaSeat(match_id="m1", seat_index=i, occupant_kind="human", occupant_sub=f"user-{i}")
        for i in range(PARTICIPANT_COUNT)
    )


def _match(mode_obj, snapshot: dict, seed: int) -> ArenaMatch:
    return ArenaMatch(
        match_id="m1", mode=mode_obj.mode, mode_version=mode_obj.mode_version, model_version="peak3_v1",
        seat_count=PARTICIPANT_COUNT, entry_path="test", rated=False, seed=seed, created_by="user-0",
        expires_at=NOW + timedelta(hours=1), status=MATCH_STATUS_ACTIVE, snapshot=snapshot,
    )


def _pick_payload(private: dict) -> dict:
    legal = private.get("legal_picks") or {}
    if legal:
        slug = sorted(legal)[0]
        return {"player_slug": slug, "slot_type": legal[slug][0]}
    for slug, fit in sorted((private.get("candidate_fits") or {}).items()):
        if fit["state"] == "fits_after_rearrangement" and fit.get("plan"):
            landed = next(slot for slot, placed in fit["plan"].items() if placed == slug)
            return {"player_slug": slug, "slot_type": landed, "placements": fit["plan"]}
    raise AssertionError("no selectable candidate for the seat on the clock")


def _play_through_reduce(mode_obj, seed: int):
    snapshot = mode_obj.initial_snapshot(seed, _seats())
    snapshot.pop("arrival_open", None)
    snapshot.pop("arrived_seats", None)
    outputs = []
    for turn in range(ROUNDS * PARTICIPANT_COUNT):
        seat = snapshot["current_seat"]
        _public, private, legal = mode_obj.project(_match(mode_obj, snapshot, seed), _seats(), seat)
        assert "tmw_pick" in legal, (turn, legal)
        out = mode_obj.reduce(ReducerInput(
            match=_match(mode_obj, snapshot, seed), seats=_seats(), open_turn=None,
            command=CommandRequest(
                match_id="m1", idempotency_key=f"k-{turn:02d}", command_type="tmw_pick",
                payload=_pick_payload(private), actor_sub=f"user-{seat}", actor_seat_index=seat, issued_at=NOW,
            ),
            now=NOW,
        ))
        assert out.accepted, (turn, out.rejection_code, out.rejection_message)
        outputs.append(out)
        snapshot = out.snapshot
    return snapshot, outputs


def test_the_variants_are_their_own_modes_with_the_same_engine_and_bot():
    # Other suites clear the process-wide registries; register as the app does.
    mode_registry.clear()
    bot_service.registry.clear()
    tmw.register()
    tmw.register_bot()
    assert set(mode_registry.names()) >= {tmw.mode.mode, tmw.franchise_mode.mode, tmw.decade_mode.mode}
    assert tmw.franchise_mode.mode == "three_man_weave_franchise"
    assert tmw.decade_mode.mode == "three_man_weave_decade"
    assert type(tmw.franchise_mode) is type(tmw.mode) is type(tmw.decade_mode)
    for mode_obj in (tmw.mode, tmw.franchise_mode, tmw.decade_mode):
        assert mode_obj.seat_count == PARTICIPANT_COUNT
        assert mode_obj.mode_version == tmw.mode.mode_version
        assert bot_service.registry.default_for(mode_obj.mode) is tmw.bot


@pytest.mark.parametrize("mode_obj,kind", VARIANT_MODES)
def test_a_whole_variant_match_is_deterministic_and_stays_on_its_constraint(mode_obj, kind):
    first_snapshot, first = _play_through_reduce(mode_obj, 4242)
    second_snapshot, second = _play_through_reduce(mode_obj, 4242)
    assert first_snapshot == second_snapshot
    assert [o.results for o in first] == [o.results for o in second]

    final = first[-1]
    assert final.status == MATCH_STATUS_COMPLETED
    assert len(final.results) == PARTICIPANT_COUNT
    constraint = first_snapshot["constraint"]
    assert constraint["kind"] == kind
    for pick in first_snapshot["picks"]:
        if kind == "franchise":
            assert pick["franchise_id"] == constraint["value"]
        else:
            assert pick["decade"] == constraint["value"]
    # A variant spins ONCE: no later round opens a ceremony.
    reveals = [o for o in first[:-1] if o.open_turn is not None and o.open_turn.phase == tmw.PHASE_REVEAL]
    assert reveals == []


@pytest.mark.parametrize("mode_obj,kind", VARIANT_MODES)
def test_the_projection_names_the_constraint_but_never_a_resolved_card(mode_obj, kind):
    snapshot = mode_obj.initial_snapshot(77, _seats())
    snapshot.pop("arrival_open", None)
    snapshot.pop("arrived_seats", None)
    seat = snapshot["current_seat"]
    public, private, _legal = mode_obj.project(_match(mode_obj, snapshot, 77), _seats(), seat)
    assert public["variant"] == kind
    assert set(public["constraint"]) == {"kind", "value", "label"}
    assert public["constraint"]["kind"] == kind
    serialized = repr(public) + repr(private)
    assert "cards" not in public["constraint"]
    for candidate in public["current_roll"]["candidates"]:
        assert "scoring_card" not in candidate
        eligibility = candidate["eligibility"]
        if kind == "franchise":
            assert eligibility["franchise_id"] == public["constraint"]["value"]
            assert eligibility["decade"] == "any"
        else:
            assert eligibility["decade"] == public["constraint"]["value"]
            assert eligibility["franchise_id"] == "ANY"
        assert eligibility["seasons"], candidate["player_slug"]
    # The resolved card's season must not leak through the roll either.
    for slug, franchise_id, decade in snapshot["constraint"]["cards"][:25]:
        card = tmw.get_index().scoring_card(slug, franchise_id, decade)
        assert f"'prime_score': {round(card.prime_score, 1)}" not in serialized


# ---------------------------------------------------------------------------
# Through the real routes
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    original = (settings.ARENA_ENABLED, settings.ARENA_BOTS_ENABLED, settings.ARENA_ALPHA_ALLOWLIST)
    settings.ARENA_ENABLED = True
    settings.ARENA_BOTS_ENABLED = True
    settings.ARENA_ALPHA_ALLOWLIST = []
    mode_registry.clear()
    bot_service.registry.clear()
    tmw.register()
    tmw.register_bot()
    mode_registry.register(td_module.mode)
    bot_service.registry.register(td_module.bot, for_modes=("twenty_dollar",))
    subject = AuthSubject(sub="variant-user", email="v@test.com", is_anonymous=False, raw_claims={})
    app.dependency_overrides[get_required_auth] = lambda: subject
    app.dependency_overrides[get_optional_auth] = lambda: subject
    yield TestClient(app)
    (settings.ARENA_ENABLED, settings.ARENA_BOTS_ENABLED, settings.ARENA_ALPHA_ALLOWLIST) = original
    app.dependency_overrides.clear()


def _age(match_id: str) -> None:
    past = datetime.now(timezone.utc)
    for turn in _memory_arena_repo._turns.get(match_id, []):
        if turn.resolved_at is None:
            turn.opened_at = turn.opened_at - timedelta(seconds=10)
            if turn.seat_index is None:
                turn.deadline_at = past - timedelta(seconds=1)


def test_readiness_publishes_both_variants(client):
    modes = {m["id"]: m["seat_count"] for m in client.get("/api/v1/arena/readiness").json()["modes"]}
    assert modes["three_man_weave_franchise"] == PARTICIPANT_COUNT
    assert modes["three_man_weave_decade"] == PARTICIPANT_COUNT


@pytest.mark.parametrize("mode_id", ["three_man_weave_franchise", "three_man_weave_decade"])
def test_a_practice_variant_match_finishes_through_the_routes(client, mode_id):
    view = client.post("/api/v1/arena/matches/practice", json={"mode": mode_id}).json()
    match_id = view["match_id"]
    you = view["your_seat_index"]
    # Arrive, as the room does.
    arrived = client.post(f"/api/v1/arena/matches/{match_id}/commands", json={
        "command_type": "tmw_intro_seen", "payload": {},
        "expected_state_version": view["state_version"], "idempotency_key": "arrive-0001",
    }).json()
    assert arrived["accepted"], arrived
    view = arrived["match"]
    constraint = view["public_state"]["constraint"]
    assert constraint and constraint["label"]
    for step in range(600):
        if view["public_state"]["is_complete"]:
            break
        if view["current_turn_seat_index"] != you or view["turn_phase"] != "pick":
            _age(match_id)
            view = client.get(f"/api/v1/arena/matches/{match_id}").json()
            continue
        result = client.post(f"/api/v1/arena/matches/{match_id}/commands", json={
            "command_type": "tmw_pick", "payload": _pick_payload(view["private_state"]),
            "expected_state_version": view["state_version"], "idempotency_key": f"pick-{step:04d}",
        }).json()
        assert result["accepted"], result
        view = result["match"]
    assert view["public_state"]["is_complete"], f"{mode_id} did not finish"
    assert view["public_state"]["constraint"] == constraint
    rosters = view["public_state"]["rosters"]
    assert all(roster["complete"] for roster in rosters)
    results = client.get(f"/api/v1/arena/matches/{match_id}/results").json()["results"]
    assert len(results) == PARTICIPANT_COUNT
    assert copy.deepcopy(results) == results
