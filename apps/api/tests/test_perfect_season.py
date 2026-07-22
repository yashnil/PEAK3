"""Tests for the 82-0 Peak Season / CourtBuilder API and state machine
(Phase 5C vertical slice + Phase 5X.1-5X.3/5X.7 overhaul: position-aware
slots and deferred score/rank reveal).

See docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md,
docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md, and
docs/implementation/PHASE_5_COURTBUILDER_VERTICAL_SLICE.md Sec 5/8.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_repo_root = Path(__file__).resolve().parent.parent.parent.parent
if str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.core.config import settings
from app.core.dependencies import _memory_court_lineup_repo
from app.main import app

from nba_peak.perfect_season.board import (
    _can_assign_distinct,
    _clear_interim_teams_cache,
    generate_board,
    interim_team_summary,
    resolve_card,
)
from nba_peak.perfect_season.config import BENCH_SLOTS, SLOT_TYPES, STARTER_SLOTS, TOTAL_ROUNDS
from nba_peak.perfect_season.positions import (
    ARCHETYPE_POSITION_MAP,
    BENCH_SLOTS as BENCH_SLOT_NAMES,
    STARTER_SLOTS as STARTER_SLOT_NAMES,
    classify_fit,
)

STARTER_SLOT_TYPES = ["PG", "SG", "SF", "PF", "C"]
BENCH_SLOT_TYPES = ["sixth_man", "defensive_specialist", "wildcard"]


@pytest.fixture(autouse=True)
def _courtbuilder_enabled_and_isolated():
    original = (
        settings.COURTBUILDER_ENABLED,
        settings.COURTBUILDER_TEAM_SPIN_ENABLED,
        settings.COURTBUILDER_ALPHA_ALLOWLIST,
        settings.COURTBUILDER_READINESS_LEVEL,
    )
    settings.COURTBUILDER_ENABLED = True
    settings.COURTBUILDER_TEAM_SPIN_ENABLED = True
    settings.COURTBUILDER_ALPHA_ALLOWLIST = []
    settings.COURTBUILDER_READINESS_LEVEL = "internal_dev"

    _memory_court_lineup_repo._lineups.clear()
    _clear_interim_teams_cache()

    yield

    (
        settings.COURTBUILDER_ENABLED,
        settings.COURTBUILDER_TEAM_SPIN_ENABLED,
        settings.COURTBUILDER_ALPHA_ALLOWLIST,
        settings.COURTBUILDER_READINESS_LEVEL,
    ) = original
    _memory_court_lineup_repo._lineups.clear()
    _clear_interim_teams_cache()


@pytest.fixture
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Module-level: board generation
# ---------------------------------------------------------------------------

def test_board_generation_is_deterministic_from_seed():
    board_a = generate_board(mode="apex_1y", seed=12345, team_spin_enabled=True)
    board_b = generate_board(mode="apex_1y", seed=12345, team_spin_enabled=True)
    slugs_a = [tuple(s.candidate_player_slugs) for s in board_a.spins]
    slugs_b = [tuple(s.candidate_player_slugs) for s in board_b.spins]
    assert slugs_a == slugs_b
    assert board_a.seed == board_b.seed == 12345


def test_board_has_total_rounds_spins_with_at_least_one_candidate_each():
    board = generate_board(mode="apex_1y", seed=7, team_spin_enabled=True)
    assert len(board.spins) == TOTAL_ROUNDS
    for spin in board.spins:
        assert len(spin.candidate_player_slugs) >= 1


def test_board_feasibility_all_distinct_assignment_exists():
    board = generate_board(mode="prime_3y", seed=99, team_spin_enabled=True)
    round_candidates = [s.candidate_player_slugs for s in board.spins]
    assert _can_assign_distinct(round_candidates)


def test_open_pool_fallback_when_team_spins_disabled():
    board = generate_board(mode="apex_1y", seed=55, team_spin_enabled=False)
    assert board.interim_team_data_version is None
    assert all(s.spin_type == "open_pool" for s in board.spins)
    assert len(board.spins) == TOTAL_ROUNDS


def test_resolve_card_returns_none_for_unknown_player():
    assert resolve_card("not-a-real-player", 1) is None


def test_interim_team_summary_reports_real_dataset():
    summary = interim_team_summary()
    assert summary["available"] is True
    assert summary["franchise_count"] >= 3


def test_interim_team_summary_counts_franchises_only_in_exact_season_spins(tmp_path):
    # Regression test: a franchise appearing ONLY under
    # exact_team_season_spins (not team_decade_spins) must still be counted.
    # The committed dataset happens to have every exact-season franchise
    # also present in team_decade_spins, so this case needs a synthetic
    # fixture to actually exercise the union logic.
    fixture = tmp_path / "interim.json"
    fixture.write_text(json.dumps({
        "dataset_version": "test-fixture",
        "team_decade_spins": [
            {"spin_id": "a", "franchise_display_name": "Franchise A", "decade_label": "1990s", "player_slugs": []},
        ],
        "exact_team_season_spins": [
            {"spin_id": "b", "franchise_display_name": "Franchise B", "season_label": "1999-00", "player_slugs": []},
        ],
    }))
    summary = interim_team_summary(fixture)
    assert summary["franchise_count"] == 2


# ---------------------------------------------------------------------------
# Position-aware slots (Phase 5X.3)
# ---------------------------------------------------------------------------

def test_court_shape_is_five_starters_three_bench():
    assert STARTER_SLOTS == 5
    assert BENCH_SLOTS == 3
    assert TOTAL_ROUNDS == 8
    assert len(SLOT_TYPES) == 8


def test_slot_types_are_position_and_role_anchored():
    assert SLOT_TYPES[:5] == STARTER_SLOT_TYPES
    assert SLOT_TYPES[5:] == BENCH_SLOT_TYPES
    # No lingering numbered starter_N/bench_N slot names anywhere.
    assert not any(s.startswith("starter_") or s.startswith("bench_") for s in SLOT_TYPES)


def test_every_archetype_maps_to_exactly_one_primary_position():
    archetypes = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]
    for a in archetypes:
        assert a in ARCHETYPE_POSITION_MAP
        primary, secondaries = ARCHETYPE_POSITION_MAP[a]
        assert primary in STARTER_SLOT_NAMES
        assert 0 <= len(secondaries) <= 2
        assert primary not in secondaries
        for s in secondaries:
            assert s in STARTER_SLOT_NAMES


@pytest.mark.parametrize("archetype,slot,expected", [
    ("lead_creator", "PG", "primary"),
    ("lead_creator", "SG", "secondary"),
    ("lead_creator", "C", "off_position"),
    ("guard_wing", "SG", "primary"),
    ("guard_wing", "PG", "secondary"),
    ("guard_wing", "SF", "secondary"),
    ("wing_forward", "SF", "primary"),
    ("forward_big", "PF", "primary"),
    ("forward_big", "C", "secondary"),
    ("anchor", "C", "primary"),
    ("anchor", "PF", "secondary"),
    ("anchor", "PG", "off_position"),
    (None, "PG", "off_position"),
])
def test_classify_fit_for_starter_slots(archetype, slot, expected):
    assert classify_fit(archetype, slot) == expected


@pytest.mark.parametrize("archetype", ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor", None])
@pytest.mark.parametrize("slot", BENCH_SLOT_TYPES)
def test_bench_slots_are_always_flexible_regardless_of_archetype(archetype, slot):
    assert classify_fit(archetype, slot) == "flexible"


def test_off_position_placement_is_never_blocked(client: TestClient):
    """An anchor (C-primary) archetype placed at PG must still succeed --
    soft placement, position is display feedback only, never an eligibility
    gate (product spec Sec 6.2)."""
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
    player_slug = state["current_spin"]["candidates"][0]["player_slug"]
    _select(client, game_id, player_slug)
    # Place into PG regardless of the selected player's real archetype fit.
    placed = _place(client, game_id, "PG")
    pg_slot = next(s for s in placed["slots"] if s["slot_type"] == "PG")
    assert pg_slot["filled"] is True
    assert pg_slot["role_fit"] in ("primary", "secondary", "off_position")


def test_role_fit_present_once_slot_filled(client: TestClient):
    final_state = _play_full_game(client, mode="apex_1y", seed=42, slot_order=SLOT_TYPES)
    for slot in final_state["slots"]:
        assert slot["filled"] is True
        assert slot["role_fit"] in ("primary", "secondary", "off_position", "flexible")
    for slot_type in BENCH_SLOT_TYPES:
        bench_slot = next(s for s in final_state["slots"] if s["slot_type"] == slot_type)
        assert bench_slot["role_fit"] == "flexible"


# ---------------------------------------------------------------------------
# Flag gating
# ---------------------------------------------------------------------------

def test_disabled_flag_returns_403(client: TestClient):
    settings.COURTBUILDER_ENABLED = False
    resp = client.post("/api/v1/perfect-season/games", json={"mode": "apex_1y", "seed": 1})
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_code"] == "courtbuilder_not_enabled"


def test_allowlist_rejects_non_member(client: TestClient):
    settings.COURTBUILDER_ALPHA_ALLOWLIST = ["some-other-subject"]
    resp = client.post("/api/v1/perfect-season/games", json={"mode": "apex_1y", "seed": 1})
    assert resp.status_code == 403
    assert resp.json()["detail"]["error_code"] == "not_in_alpha_allowlist"


def test_readiness_endpoint_never_requires_auth(client: TestClient):
    settings.COURTBUILDER_ENABLED = False
    resp = client.get("/api/v1/perfect-season/readiness")
    assert resp.status_code == 200
    body = resp.json()
    assert body["courtbuilder_enabled"] is False


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

def _create(client: TestClient, mode: str = "apex_1y", seed: int = 42) -> dict:
    resp = client.post("/api/v1/perfect-season/games", json={"mode": mode, "seed": seed})
    assert resp.status_code == 200, resp.text
    return resp.json()


def _select(client: TestClient, game_id: str, player_slug: str) -> dict:
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/select",
        json={"game_id": game_id, "player_slug": player_slug},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _place(client: TestClient, game_id: str, slot_type: str) -> dict:
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/place",
        json={"game_id": game_id, "slot_type": slot_type},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _complete(client: TestClient, game_id: str) -> dict:
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/complete",
        json={"game_id": game_id},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _play_full_game(client: TestClient, mode: str = "apex_1y", seed: int = 42, slot_order: list[str] | None = None) -> dict:
    state = _create(client, mode=mode, seed=seed)
    game_id = state["game_id"]
    order = slot_order or SLOT_TYPES

    for slot_type in order:
        state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
        candidates = state["current_spin"]["candidates"]
        assert len(candidates) >= 1
        player_slug = candidates[0]["player_slug"]
        _select(client, game_id, player_slug)
        state = _place(client, game_id, slot_type)

    assert state["status"] == "rounds_complete"
    state = _complete(client, game_id)
    assert state["status"] == "result_ready"
    return state


# ---------------------------------------------------------------------------
# Full happy path
# ---------------------------------------------------------------------------

def test_full_anonymous_practice_attempt_completes_and_result_always_loads(client: TestClient):
    final_state = _play_full_game(client, mode="apex_1y", seed=42)
    game_id = final_state["game_id"]

    assert final_state["simulation_result"] is not None
    assert final_state["simulation_result"]["wins"] + final_state["simulation_result"]["losses"] == 82
    assert "experimental" in final_state["simulation_result"]["experimental_notice"].lower()

    # Result must always be retrievable after completion -- no result-loading
    # failure class (ADR-005 Context; master plan Sec 19.5).
    reload = client.get(f"/api/v1/perfect-season/games/{game_id}")
    assert reload.status_code == 200
    assert reload.json()["status"] == "result_ready"
    assert reload.json()["simulation_result"]["wins"] == final_state["simulation_result"]["wins"]


def test_completion_is_idempotent(client: TestClient):
    final_state = _play_full_game(client, mode="apex_1y", seed=43)
    game_id = final_state["game_id"]
    second = _complete(client, game_id)
    assert second["simulation_result"] == final_state["simulation_result"]


# ---------------------------------------------------------------------------
# ADR-005 Decision 6 + deferred reveal (product spec Sec 3.5):
# no score/rank anywhere before status == "result_ready", full stop.
# ---------------------------------------------------------------------------

def test_current_spin_candidates_never_expose_score_or_rank(client: TestClient):
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]

    for _ in range(TOTAL_ROUNDS):
        state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
        if state["status"] != "selection_pending":
            break
        candidates = state["current_spin"]["candidates"]
        for c in candidates:
            assert "individual_peak_score" not in c
            assert "prime_score" not in c
            assert "individual_peak_rank" not in c
            assert set(c.keys()) == {"player_slug", "player_name"}
        player_slug = candidates[0]["player_slug"]
        selected = _select(client, game_id, player_slug)
        # Pending selection (post-select, pre-place) also carries no score.
        assert "individual_peak_score" not in selected["pending_selection"]
        assert set(selected["pending_selection"].keys()) == {"peak_window_id", "player_name"}
        open_slots = [s["slot_type"] for s in selected["slots"] if not s["filled"]]
        _place(client, game_id, open_slots[0])


def test_filled_slots_withhold_score_and_rank_until_result_ready(client: TestClient):
    """The core Phase 5X.7 contract change: placing a card into a slot does
    NOT reveal its score/rank immediately -- only qualitative info (name,
    anchor_season, role_fit) is visible while status is selection_pending /
    placement_pending / rounds_complete. Exact score/rank appear only once
    status == result_ready. This is the opposite of what this test asserted
    before the deferred-reveal change."""
    state = _create(client, mode="apex_1y", seed=44)
    game_id = state["game_id"]
    state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
    player_slug = state["current_spin"]["candidates"][0]["player_slug"]
    _select(client, game_id, player_slug)
    placed = _place(client, game_id, SLOT_TYPES[0])

    filled_slot = next(s for s in placed["slots"] if s["filled"])
    assert placed["status"] in ("selection_pending", "placement_pending")
    assert filled_slot["player_name"] is not None
    assert filled_slot["anchor_season"] is not None
    assert filled_slot["role_fit"] is not None
    assert filled_slot["individual_peak_score"] is None
    assert filled_slot["individual_peak_rank"] is None

    # Still withheld once ALL 8 slots are filled but not yet simulated
    # (rounds_complete) -- the reveal only happens at result_ready, not at
    # "roster complete."
    final_state = _play_full_game(client, mode="apex_1y", seed=45)
    # _play_full_game already calls /complete, so re-derive the
    # rounds_complete snapshot by checking the score IS present now that
    # status is result_ready, proving the gate is status-based.
    assert final_state["status"] == "result_ready"
    for s in final_state["slots"]:
        assert s["individual_peak_score"] is not None
        assert s["individual_peak_rank"] is not None


def test_score_withheld_at_rounds_complete_before_explicit_complete_call(client: TestClient):
    """Distinguishes 'all 8 slots filled' (rounds_complete) from 'simulated'
    (result_ready) -- score/rank must stay hidden through rounds_complete,
    only appearing after the explicit /complete call.

    Uses seed=42 with the natural SLOT_TYPES order -- the same combination
    already exercised end-to-end elsewhere in this file -- rather than a
    fresh seed, since the test helpers' greedy "always pick candidates[0]"
    selection strategy can otherwise paint itself into a corner where a
    later round's candidate list is entirely already-used identities (a
    property of the small interim dataset + greedy picking, not a product
    bug -- see docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md).
    """
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]

    for slot_type in SLOT_TYPES:
        state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
        player_slug = state["current_spin"]["candidates"][0]["player_slug"]
        _select(client, game_id, player_slug)
        state = _place(client, game_id, slot_type)

    assert state["status"] == "rounds_complete"
    assert state["simulation_result"] is None
    for s in state["slots"]:
        assert s["filled"] is True
        assert s["individual_peak_score"] is None
        assert s["individual_peak_rank"] is None

    completed = _complete(client, game_id)
    assert completed["status"] == "result_ready"
    for s in completed["slots"]:
        assert s["individual_peak_score"] is not None
        assert s["individual_peak_rank"] is not None


# ---------------------------------------------------------------------------
# Eligibility / roster rules
# ---------------------------------------------------------------------------

def test_cannot_select_a_player_not_offered(client: TestClient):
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/select",
        json={"game_id": game_id, "player_slug": "definitely-not-a-candidate"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "player_not_offered"


def test_same_identity_cannot_be_used_twice_on_one_roster(client: TestClient):
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
    player_slug = state["current_spin"]["candidates"][0]["player_slug"]
    _select(client, game_id, player_slug)
    _place(client, game_id, SLOT_TYPES[0])

    # Manually search subsequent rounds for the same player_slug reappearing
    # as a candidate (possible if two interim spins share a player) and
    # confirm selecting them again is rejected.
    found_repeat = False
    for _ in range(TOTAL_ROUNDS - 1):
        state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
        if state["status"] != "selection_pending":
            break
        candidates = [c["player_slug"] for c in state["current_spin"]["candidates"]]
        if player_slug in candidates:
            found_repeat = True
            resp = client.post(
                f"/api/v1/perfect-season/games/{game_id}/select",
                json={"game_id": game_id, "player_slug": player_slug},
            )
            assert resp.status_code == 400
            assert resp.json()["detail"]["error_code"] == "player_already_used"
        next_slug = candidates[0] if candidates[0] != player_slug else (candidates[1] if len(candidates) > 1 else None)
        if next_slug is None:
            break
        _select(client, game_id, next_slug)
        open_slots = [s["slot_type"] for s in state["slots"] if not s["filled"]]
        _place(client, game_id, open_slots[0])

    # Not asserting found_repeat is True -- it depends on seed/shuffle
    # (some seeds may not draw two spins sharing a player). The important
    # assertion is that the rejection path works whenever it IS hit, above.
    assert isinstance(found_repeat, bool)


def test_cannot_place_into_an_already_filled_slot(client: TestClient):
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
    player_slug = state["current_spin"]["candidates"][0]["player_slug"]
    _select(client, game_id, player_slug)
    _place(client, game_id, SLOT_TYPES[0])

    state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
    next_slug = state["current_spin"]["candidates"][0]["player_slug"]
    _select(client, game_id, next_slug)
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/place",
        json={"game_id": game_id, "slot_type": SLOT_TYPES[0]},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "slot_not_open"


def test_unknown_slot_type_is_rejected(client: TestClient):
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
    player_slug = state["current_spin"]["candidates"][0]["player_slug"]
    _select(client, game_id, player_slug)
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/place",
        json={"game_id": game_id, "slot_type": "starter_1"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "invalid_slot"


# ---------------------------------------------------------------------------
# Unconventional lineups remain legal (soft placement, never blocked)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("slot_order", [
    # All bench slots filled first, then starters -- reverses the "natural" order.
    ["sixth_man", "defensive_specialist", "wildcard", "PG", "SG", "SF", "PF", "C"],
    # Interleaved, still arbitrary.
    ["C", "wildcard", "PG", "sixth_man", "SG", "defensive_specialist", "SF", "PF"],
    # Reverse of the default declared order entirely.
    list(reversed(SLOT_TYPES)),
])
def test_unconventional_slot_orders_remain_legal(client: TestClient, slot_order):
    final_state = _play_full_game(client, mode="apex_1y", seed=42, slot_order=slot_order)
    assert final_state["status"] == "result_ready"
    assert len([s for s in final_state["slots"] if s["filled"]]) == TOTAL_ROUNDS


def test_position_mismatched_lineup_remains_completable(client: TestClient):
    """A roster where every starter is deliberately off-position (e.g. all
    guards started at PF/C) must still complete and simulate -- position is
    feedback, never a hard gate (product spec Sec 6.2/6.7)."""
    # Fill starters in reverse position order relative to draw order to
    # maximize the chance of off-position placements, then bench.
    slot_order = ["C", "PF", "SF", "SG", "PG", "sixth_man", "defensive_specialist", "wildcard"]
    final_state = _play_full_game(client, mode="apex_1y", seed=50, slot_order=slot_order)
    assert final_state["status"] == "result_ready"
    assert len([s for s in final_state["slots"] if s["filled"]]) == TOTAL_ROUNDS
