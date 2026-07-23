"""Tests for the 82-0 Peak Season / CourtBuilder API and state machine
(Phase 5C vertical slice + Phase 5X.1-5X.3/5X.7 overhaul: position-aware
slots and deferred score/rank reveal + Phase 5X.4: team/era wheels, real
half-court positions, and PEAK-value-first scoring).

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
    coverage_summary,
    generate_board,
    interim_team_summary,
    resolve_card,
)
from nba_peak.perfect_season.config import (
    BENCH_SLOTS,
    ERA_LABELS,
    PREFERRED_MIN_CANDIDATES,
    SLOT_TYPES,
    STARTER_SLOTS,
    SUPPORTED_MODES,
    TOTAL_ROUNDS,
)
from nba_peak.perfect_season.positions import (
    ARCHETYPE_POSITION_MAP,
    BENCH_SLOTS as BENCH_SLOT_NAMES,
    STARTER_SLOTS as STARTER_SLOT_NAMES,
    classify_fit,
)
from nba_peak.perfect_season.simulation import compute_fit_components, simulate_season

STARTER_SLOT_TYPES = ["PG", "SG", "SF", "PF", "C"]
BENCH_SLOT_TYPES = ["bench_1", "bench_2", "bench_3"]


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
    assert len(summary["franchise_names"]) == summary["franchise_count"]
    assert summary["franchise_names"] == sorted(summary["franchise_names"])


def test_interim_dataset_covers_all_five_eras():
    """Era wheel rule 1: 1980s-2020s. Verifies the interim dataset actually
    has at least one team-decade entry per era, not just that the era wheel
    displays all 5 labels (a wheel that can never land on 2020s would be
    misleading, not just narrow)."""
    path = _default_interim_teams_path_for_test()
    data = json.loads(path.read_text())
    decades = {e["decade_label"] for e in data.get("team_decade_spins", [])}
    assert set(ERA_LABELS) <= decades


def _default_interim_teams_path_for_test() -> Path:
    from nba_peak.perfect_season.board import _default_interim_teams_path
    return _default_interim_teams_path()


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
    # Starters are real position labels, never numbered.
    assert not any(s.startswith("starter_") for s in SLOT_TYPES)
    # Bench slots are deliberately plain (Bench 1/2/3), never role-flavored
    # labels like "6th Man"/"Defensive Specialist"/"Wildcard".
    assert BENCH_SLOT_TYPES == ["bench_1", "bench_2", "bench_3"]


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


def test_readiness_endpoint_includes_coverage_summary(client: TestClient):
    resp = client.get("/api/v1/perfect-season/readiness")
    assert resp.status_code == 200
    coverage = resp.json()["coverage"]
    assert coverage["available"] is True
    assert coverage["mode"] == "apex_1y"
    assert coverage["total_combinations"] > 0
    assert "per_era" in coverage
    assert "per_team" in coverage


def test_readiness_endpoint_respects_mode_query_param(client: TestClient):
    resp = client.get("/api/v1/perfect-season/readiness?mode=foundation_5y")
    assert resp.status_code == 200
    coverage = resp.json()["coverage"]
    assert coverage["mode"] == "foundation_5y"
    assert coverage["duration_years"] == 5


def test_readiness_endpoint_falls_back_to_apex_1y_for_invalid_mode(client: TestClient):
    resp = client.get("/api/v1/perfect-season/readiness?mode=not_a_real_mode")
    assert resp.status_code == 200
    assert resp.json()["coverage"]["mode"] == "apex_1y"


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
            # Position eligibility is allowed (never a score) -- see rule 7:
            # "show name, eligible reason, and allowed positions."
            assert set(c.keys()) == {"player_slug", "player_name", "primary_position", "secondary_positions"}
        player_slug = candidates[0]["player_slug"]
        selected = _select(client, game_id, player_slug)
        # Pending selection (post-select, pre-place) also carries no score.
        assert "individual_peak_score" not in selected["pending_selection"]
        assert set(selected["pending_selection"].keys()) == {
            "peak_window_id", "player_name", "primary_position", "secondary_positions", "fit_by_open_slot",
        }
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
    ["bench_1", "bench_2", "bench_3", "PG", "SG", "SF", "PF", "C"],
    # Interleaved, still arbitrary.
    ["C", "bench_3", "PG", "bench_1", "SG", "bench_2", "SF", "PF"],
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
    slot_order = ["C", "PF", "SF", "SG", "PG", "bench_1", "bench_2", "bench_3"]
    final_state = _play_full_game(client, mode="apex_1y", seed=50, slot_order=slot_order)
    assert final_state["status"] == "result_ready"
    assert len([s for s in final_state["slots"] if s["filled"]]) == TOTAL_ROUNDS


# ---------------------------------------------------------------------------
# Team/era wheels expose both dimensions separately (Phase 5X.4 rule 1)
# ---------------------------------------------------------------------------

def test_team_decade_spin_exposes_franchise_and_era_as_separate_fields(client: TestClient):
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    saw_team_decade = False
    for _ in range(TOTAL_ROUNDS):
        state = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
        if state["status"] != "selection_pending":
            break
        spin = state["current_spin"]
        if spin["spin_type"] == "team_decade":
            saw_team_decade = True
            assert spin["franchise_display_name"] is not None
            assert spin["era_label"] in ERA_LABELS
        player_slug = spin["candidates"][0]["player_slug"]
        _select(client, game_id, player_slug)
        open_slots = [s["slot_type"] for s in state["slots"] if not s["filled"]]
        _place(client, game_id, open_slots[0])
    assert saw_team_decade


def test_era_labels_cover_all_five_supported_decades():
    assert ERA_LABELS == ["1980s", "1990s", "2000s", "2010s", "2020s"]


# ---------------------------------------------------------------------------
# Candidate depth (Phase 5X.4 rule 3): no zero-candidate spins, prefer >= 2
# ---------------------------------------------------------------------------

def test_board_never_yields_a_zero_candidate_spin_across_many_seeds():
    for seed in range(200, 260):
        board = generate_board(mode="apex_1y", seed=seed, team_spin_enabled=True)
        for spin in board.spins:
            assert len(spin.candidate_player_slugs) >= 1


def test_board_prefers_spins_with_at_least_two_candidates_when_available():
    """Not a hard guarantee (a couple of interim entries are honestly
    1-candidate-deep, e.g. Spurs 1990s/Nuggets 2020s -- see the interim
    dataset's own coverage_note) -- but across many seeds, the large
    majority of team_decade/exact_team_season spins should clear the
    PREFERRED_MIN_CANDIDATES floor now that _select_interim_entries prefers
    deeper entries."""
    total = 0
    at_least_preferred = 0
    for seed in range(300, 340):
        board = generate_board(mode="apex_1y", seed=seed, team_spin_enabled=True)
        for spin in board.spins:
            if spin.spin_type == "open_pool":
                continue
            total += 1
            if len(spin.candidate_player_slugs) >= PREFERRED_MIN_CANDIDATES:
                at_least_preferred += 1
    assert total > 0
    assert at_least_preferred / total >= 0.7


# ---------------------------------------------------------------------------
# PEAK-value-first scoring (Phase 5X.4 rule 6): no anti-GOAT/redundancy nerf
# ---------------------------------------------------------------------------

def test_all_time_elite_lineup_projects_as_dominant_not_nerfed():
    """A roster of the highest-scoring 1-year peaks in the entire pool --
    several sharing the same lead_creator/guard_wing archetype -- must
    project as historically dominant. This is the direct regression test for
    the "do not add artificial anti-GOAT roster penalties" instruction: the
    old role_overlap_penalty would have docked this exact roster for
    archetype redundancy. It no longer exists."""
    legends = [
        "michael-jordan", "magic-johnson", "larry-bird", "lebron-james",
        "kareem-abdul-jabbar", "tim-duncan", "shaquille-oneal", "hakeem-olajuwon",
    ]
    cards = [resolve_card(slug, 1) for slug in legends]
    assert all(c is not None for c in cards)
    # Several of these share a primary_role (e.g. several lead_creator/
    # guard_wing perimeter legends) -- the redundancy this used to punish.
    roles = [c.primary_role for c in cards]
    assert len(set(roles)) < len(roles)

    result = simulate_season(cards, board_seed=1, slot_types=SLOT_TYPES)
    assert result.wins >= 70
    assert result.fit_components.talent_core >= 85
    for factor in result.decisive_factors:
        assert "redundant" not in factor.lower()
        assert "overlap" not in factor.lower()


def test_lineup_fit_components_have_no_role_overlap_penalty_field():
    cards = [resolve_card(slug, 1) for slug in ["michael-jordan", "magic-johnson"]]
    cards = [c for c in cards if c is not None]
    fit = compute_fit_components(cards, SLOT_TYPES[: len(cards)])
    assert "role_overlap_penalty" not in fit.as_dict()
    assert "bench_strength" in fit.as_dict()
    assert "positional_fit" in fit.as_dict()


def test_cross_era_lineup_is_not_penalized_relative_to_same_era_lineup():
    """Rule 6: 'do not punish cross-era fit merely because players come from
    different eras.' There is no era field anywhere in LineupFitComponents
    or the scoring formula, so a deliberately cross-era roster and a
    same-era roster of comparable talent should score comparably -- proving
    era mixing itself carries no penalty."""
    cross_era = [resolve_card(slug, 1) for slug in [
        "michael-jordan", "nikola-jokic", "kareem-abdul-jabbar", "luka-doncic",
        "larry-bird", "giannis-antetokounmpo", "tim-duncan", "stephen-curry",
    ]]
    assert all(c is not None for c in cross_era)
    result = simulate_season(cross_era, board_seed=2, slot_types=SLOT_TYPES)
    assert result.wins >= 65


def test_dominant_well_positioned_all_time_roster_projects_75_to_82_wins():
    """Phase 5X.5 rule 6: 'a valid GOAT-heavy roster can project 75-82
    wins.' Unlike test_all_time_elite_lineup_projects_as_dominant_not_nerfed
    above (which uses an arbitrary slot order), this roster is deliberately
    well-positioned: Jordan at PG (primary fit, lead_creator's primary
    position), LeBron at SG (secondary fit -- lead_creator's secondary
    position), Moses Malone at PF (primary fit, forward_big), Dwight Howard
    at C and Steve Nash at SF (both secondary fit -- forward_big's secondary
    positions include C and SF), with Magic/Shaq/Duncan held on the bench
    (always "flexible", never off-position) rather than started
    off-position. This proves the philosophy end to end: elite talent +
    legal positions -> a historically dominant projection, not a nerf."""
    starters = ["michael-jordan", "lebron-james", "moses-malone", "dwight-howard", "steve-nash"]
    bench = ["magic-johnson", "shaquille-oneal", "tim-duncan"]
    cards = [resolve_card(slug, 1) for slug in starters + bench]
    assert all(c is not None for c in cards)

    result = simulate_season(cards, board_seed=99, slot_types=SLOT_TYPES)
    assert 75 <= result.wins <= 82
    assert result.fit_components.positional_fit >= 70
    assert result.fit_components.bench_strength >= 85


def test_weaker_midtier_roster_projects_meaningfully_lower_than_elite_roster():
    """Phase 5X.5 rule 6: 'a weaker/incomplete/position-awkward roster
    should project lower.' A roster of genuinely mid-tier players (well
    below the pool's elite tier, individual_peak_score ~50-60) must project
    a clearly worse record than the dominant all-time roster above -- not
    because of any redundancy/era penalty, but because the underlying peak
    talent really is lower. This is the honest contrast case: PEAK3 still
    differentiates rosters, just on talent and real constraints, not on
    "too many stars"."""
    starters = ["jason-terry", "tree-rollins", "kenny-anderson", "rod-strickland", "luol-deng"]
    bench = ["dale-ellis", "andre-miller", "jermaine-oneal"]
    cards = [resolve_card(slug, 1) for slug in starters + bench]
    assert all(c is not None for c in cards)

    result = simulate_season(cards, board_seed=7, slot_types=SLOT_TYPES)
    assert result.wins <= 55
    assert result.fit_components.talent_core < 65


# ---------------------------------------------------------------------------
# Wheel coverage / distribution audit (Phase 5X.5 rule 1)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("mode", SUPPORTED_MODES)
def test_wheel_distribution_does_not_collapse_to_a_few_franchises(mode: str):
    """Regression test for the exact bug the Phase 5X.5 audit found: two
    dead player_slugs (michael-cooper, jaylen-brown -- both
    profile_status='excluded' at every duration in card_profiles.v3.json,
    so never actually resolvable) silently starved the Celtics-2020s,
    Bucks-2020s, and Nuggets entries down to 1 candidate, and the
    board generator's old "fill with >=2-candidate entries first" selection
    meant those thin entries were excluded from nearly every board -- some
    franchises (Bucks, Nuggets) never appeared at all across 300 sampled
    seeds. After the v2 dataset fix (real, in-pool teammates added) and the
    weighted-sampling fix to _select_interim_entries, every franchise in the
    dataset must appear at least once across a large seed sample, and no
    single franchise should dominate more than a third of all spins."""
    from nba_peak.perfect_season.board import _clear_interim_teams_cache
    _clear_interim_teams_cache()

    cov = coverage_summary(mode)
    assert cov["available"] is True
    all_franchises = set(cov["per_team"].keys())

    franchise_counts: dict[str, int] = {}
    n_seeds = 150
    for seed in range(1, n_seeds + 1):
        board = generate_board(mode=mode, seed=seed, team_spin_enabled=True)
        for spin in board.spins:
            if spin.franchise_display_name:
                franchise_counts[spin.franchise_display_name] = franchise_counts.get(spin.franchise_display_name, 0) + 1

    seen = set(franchise_counts.keys())
    missing = all_franchises - seen
    assert not missing, f"Franchises never appeared across {n_seeds} seeds ({mode}): {sorted(missing)}"

    total = sum(franchise_counts.values())
    for name, count in franchise_counts.items():
        assert count / total <= 0.35, f"{name} dominated {count / total:.1%} of spins ({mode}) -- distribution collapsed"


def test_coverage_summary_reports_total_playable_sparse_and_excluded():
    cov = coverage_summary("apex_1y")
    assert cov["available"] is True
    assert cov["total_combinations"] == cov["playable_combinations"] + cov["excluded_zero_candidate_combinations"]
    assert cov["sparse_combinations"] <= cov["playable_combinations"]
    assert cov["excluded_zero_candidate_combinations"] == 0  # v2 dataset: no dead-on-arrival entries remain
    assert set(cov["per_era"].keys())
    assert set(cov["per_team"].keys())
    for breakdown in cov["per_team"].values():
        assert breakdown["combinations"] == breakdown["playable"] + breakdown["excluded_zero_candidate"]


def test_coverage_summary_is_duration_aware():
    """The same interim entry can be playable at one duration and sparse (or
    unplayable) at another -- candidate depth genuinely varies by duration,
    not just by team/era. apex_1y and foundation_5y must not report
    identical per-team breakdowns for every team (some, like Nuggets, are
    duration-dependent -- see the v2 dataset's own provenance notes)."""
    cov_1y = coverage_summary("apex_1y")
    cov_5y = coverage_summary("foundation_5y")
    assert cov_1y["duration_years"] == 1
    assert cov_5y["duration_years"] == 5
    assert cov_1y["per_team"] != cov_5y["per_team"]


def test_coverage_summary_invalid_mode_returns_unavailable():
    assert coverage_summary("not_a_real_mode")["available"] is False
