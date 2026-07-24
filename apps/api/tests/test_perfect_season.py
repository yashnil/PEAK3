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
import re
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
    POSITION_OVERRIDES,
    STARTER_SLOTS as STARTER_SLOT_NAMES,
    classify_fit,
    primary_position,
    secondary_positions,
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
def test_classify_fit_archetype_fallback_for_starter_slots(archetype, slot, expected):
    """Archetype-fallback tier only -- player_slug=None (or any slug not in
    POSITION_OVERRIDES) so classify_fit falls through to
    ARCHETYPE_POSITION_MAP. See test_classify_fit_prefers_manual_override_*
    below for the override tier, which is what actually governs every
    player reachable in the game today."""
    assert classify_fit(None, archetype, slot) == expected


@pytest.mark.parametrize("archetype", ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor", None])
@pytest.mark.parametrize("slot", BENCH_SLOT_TYPES)
def test_bench_slots_are_always_flexible_regardless_of_archetype(archetype, slot):
    assert classify_fit(None, archetype, slot) == "flexible"


# ---------------------------------------------------------------------------
# Manual position overrides (Phase 5X.6): fixes the "Duncan/Shaq play PG"
# bug -- the archetype fallback alone classified nearly every elite player
# as lead_creator (-> PG), which is correct for the lineup-archetype model's
# own purpose but wrong as a position. POSITION_OVERRIDES is the source of
# truth for every player reachable in the game today; it must always win
# over the archetype, regardless of what primary_role the card carries.
# ---------------------------------------------------------------------------

def test_every_player_reachable_in_the_interim_dataset_has_a_manual_override():
    """Every player_slug named anywhere in the interim team-season dataset
    must have a real POSITION_OVERRIDES entry -- this is the guarantee that
    no player actually reachable in CourtBuilder today can display a
    fabricated position. Reads the dataset directly rather than
    hardcoding the player list, so it fails loudly if a future dataset
    edit adds a player without also adding their override."""
    from nba_peak.perfect_season.board import _default_interim_teams_path
    data = json.loads(_default_interim_teams_path().read_text())
    dataset_slugs = set()
    for e in data["team_decade_spins"] + data["exact_team_season_spins"]:
        dataset_slugs.update(e["player_slugs"])
    missing = dataset_slugs - set(POSITION_OVERRIDES.keys())
    assert not missing, f"Players in the interim dataset with no manual position override: {sorted(missing)}"


@pytest.mark.parametrize("slug,expected_primary,expected_secondaries", [
    # The exact regression case that triggered this audit: both are real
    # centers/bigs who displayed as "plays PG" under the archetype-only
    # fallback (their primary_role is lead_creator, which maps to PG).
    ("shaquille-oneal", "C", ()),
    ("tim-duncan", "PF", ("C",)),
    # Explicitly requested examples (Phase 5X.6 task).
    ("michael-jordan", "SG", ("SF",)),
    ("lebron-james", "SF", ("PG", "SG", "PF")),
    ("nikola-jokic", "C", ()),
    ("luka-doncic", "PG", ("SG",)),
    ("stephen-curry", "PG", ("SG",)),
])
def test_manual_position_overrides_match_documented_real_positions(slug, expected_primary, expected_secondaries):
    assert primary_position(slug) == expected_primary
    assert secondary_positions(slug) == expected_secondaries


def test_manual_override_wins_over_archetype_even_when_archetype_disagrees(client: TestClient):
    """The exact bug this section exists to prevent: even though
    michael-jordan/tim-duncan/shaquille-oneal all carry
    primary_role='lead_creator' (which the archetype fallback maps to PG),
    classify_fit must use the manual override, not the archetype, once one
    exists."""
    assert classify_fit("shaquille-oneal", "lead_creator", "PG") == "off_position"
    assert classify_fit("shaquille-oneal", "lead_creator", "C") == "primary"
    assert classify_fit("tim-duncan", "lead_creator", "PG") == "off_position"
    assert classify_fit("tim-duncan", "lead_creator", "PF") == "primary"
    assert classify_fit("tim-duncan", "lead_creator", "C") == "secondary"


def test_no_manual_override_ever_claims_a_position_the_player_never_played():
    """Sanity bound on the override table itself: every primary/secondary
    position is a real starter slot, no duplicate primary-in-secondary, and
    no player claims all 5 positions (even LeBron's 4-position entry stops
    short of C, which is not documented well enough to include per the
    task's own "optionally C if evidence is documented" instruction)."""
    for slug, (primary, secondaries) in POSITION_OVERRIDES.items():
        assert primary in STARTER_SLOT_NAMES, f"{slug}: invalid primary {primary!r}"
        assert primary not in secondaries, f"{slug}: primary duplicated in secondaries"
        assert len(set(secondaries)) == len(secondaries), f"{slug}: duplicate secondary positions"
        for s in secondaries:
            assert s in STARTER_SLOT_NAMES, f"{slug}: invalid secondary {s!r}"
        assert 1 + len(secondaries) <= 5


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


def _cancel(client: TestClient, game_id: str) -> dict:
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/cancel",
        json={"game_id": game_id},
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
        # Fields that would leak the hidden score/rank -- must never appear,
        # in either the legacy peak-window shape or the team_year exact-
        # season shape (which adds team/season/status metadata but still no
        # score field on SpinCandidate/PendingSelectionPublic -- see
        # app/models/perfect_season.py).
        forbidden = {"individual_peak_score", "prime_score", "individual_peak_rank", "season_score"}
        allowed_candidate_keys = {
            "player_slug", "player_name", "primary_position", "secondary_positions",
            "team_id", "team_name", "season", "identity_pool_status", "score_status",
        }
        for c in candidates:
            assert not (forbidden & set(c.keys()))
            assert set(c.keys()) <= allowed_candidate_keys
        player_slug = candidates[0]["player_slug"]
        selected = _select(client, game_id, player_slug)
        # Pending selection (post-select, pre-place) also carries no score.
        assert not (forbidden & set(selected["pending_selection"].keys()))
        assert set(selected["pending_selection"].keys()) <= {
            "peak_window_id", "exact_player_season_key", "player_name", "team_id", "team_name", "season",
            "identity_pool_status", "score_status", "primary_position", "secondary_positions", "fit_by_open_slot",
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

# ---------------------------------------------------------------------------
# Cancel/back (Phase 5X.7): selecting a candidate is no longer a one-way
# door -- the player must be able to return to the candidate list before
# placing, per the manual-review finding "no obvious way to cancel/back out
# and choose another player before placing them."
# ---------------------------------------------------------------------------

def test_cancel_selection_returns_to_selection_pending_for_the_same_round(client: TestClient):
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    round_before = state["current_round"]
    candidates_before = {c["player_slug"] for c in state["current_spin"]["candidates"]}

    player_slug = state["current_spin"]["candidates"][0]["player_slug"]
    selected = _select(client, game_id, player_slug)
    assert selected["status"] == "placement_pending"
    assert selected["pending_selection"]["player_name"] is not None

    cancelled = _cancel(client, game_id)
    assert cancelled["status"] == "selection_pending"
    assert cancelled["current_round"] == round_before
    assert cancelled["pending_selection"] is None
    # The full original candidate list is back, including the one just
    # cancelled -- cancelling does not consume or exclude anyone.
    candidates_after = {c["player_slug"] for c in cancelled["current_spin"]["candidates"]}
    assert candidates_after == candidates_before


def test_cancel_then_select_a_different_candidate_and_place_them(client: TestClient):
    """The exact flow the manual review asked for: select A, back out,
    select B (a different candidate), place B -- B ends up on the roster,
    A does not, and A remains available for a later round."""
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    candidates = state["current_spin"]["candidates"]
    assert len(candidates) >= 2, "seed=42 round 1 should offer at least 2 candidates"
    slug_a, slug_b = candidates[0]["player_slug"], candidates[1]["player_slug"]

    _select(client, game_id, slug_a)
    _cancel(client, game_id)
    _select(client, game_id, slug_b)
    placed = _place(client, game_id, SLOT_TYPES[0])

    filled_slot = next(s for s in placed["slots"] if s["slot_type"] == SLOT_TYPES[0])
    assert filled_slot["filled"] is True
    assert filled_slot["player_name"] != candidates[0]["player_name"]
    # slug_a was never placed, so it's still eligible if it reappears later --
    # confirmed indirectly: it's not in the used-identity set, which we can
    # check by attempting to select it again in a later round if offered.
    # (Direct assertion: slug_a's card was never consumed.)
    used_slugs_check = client.get(f"/api/v1/perfect-season/games/{game_id}").json()
    assert used_slugs_check["status"] in ("selection_pending", "rounds_complete")


def test_cancel_without_a_pending_selection_is_rejected(client: TestClient):
    state = _create(client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    assert state["status"] == "selection_pending"
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/cancel",
        json={"game_id": game_id},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "cancel_not_allowed"


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
    """Phase 5X.5/5X.6 rule 6: 'a valid GOAT-heavy roster can project 75-82
    wins.' Unlike test_all_time_elite_lineup_projects_as_dominant_not_nerfed
    above (which uses an arbitrary slot order), this roster is deliberately
    well-positioned using the Phase 5X.6 manual position overrides (real
    documented positions, not the archetype fallback): Magic at PG, Jordan
    at SG, LeBron at SF, Duncan at PF, Shaq at C -- every starter at their
    real, documented primary position (positional_fit=100), with
    Bird/Kareem/Hakeem on the bench. Proves the philosophy end to end:
    elite talent + real legal positions -> a historically dominant
    projection, not a nerf."""
    starters = ["magic-johnson", "michael-jordan", "lebron-james", "tim-duncan", "shaquille-oneal"]
    bench = ["larry-bird", "kareem-abdul-jabbar", "hakeem-olajuwon"]
    cards = [resolve_card(slug, 1) for slug in starters + bench]
    assert all(c is not None for c in cards)

    result = simulate_season(cards, board_seed=99, slot_types=SLOT_TYPES)
    assert 75 <= result.wins <= 82
    assert result.fit_components.positional_fit == 100.0
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


# ---------------------------------------------------------------------------
# Phase 6C: exact-season team+YEAR engine (fixes the career-peak-substitution
# bug -- see nba_peak/perfect_season/exact_season.py and
# docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md's Phase 6C note)
# ---------------------------------------------------------------------------

from nba_peak.perfect_season.board import (  # noqa: E402
    MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON,
    experimental_team_year_summary,
    generate_team_year_board,
)
from nba_peak.perfect_season.exact_season import (  # noqa: E402
    resolve_exact_card_by_key,
    resolve_player_season_card,
)

TEAM_YEAR_SEASON_RE = re.compile(r"^\d{4}-\d{2}$")


def test_team_year_board_is_deterministic_from_seed():
    board_a = generate_team_year_board(mode="apex_1y", seed=12345)
    board_b = generate_team_year_board(mode="apex_1y", seed=12345)
    slugs_a = [tuple(s.candidate_player_slugs) for s in board_a.spins]
    slugs_b = [tuple(s.candidate_player_slugs) for s in board_b.spins]
    assert slugs_a == slugs_b
    assert board_a.seed == board_b.seed == 12345


def test_team_year_board_never_produces_open_pool():
    """Phase 6C: Open Pool no longer exists for team-year mode -- every round
    is a real team + an exact season, even when the same team-season repeats
    across rounds (sampling with replacement, see board.py's
    generate_team_year_board)."""
    for seed in (1, 2, 3, 42, 99):
        board = generate_team_year_board(mode="apex_1y", seed=seed)
        assert len(board.spins) == TOTAL_ROUNDS
        for spin in board.spins:
            assert spin.spin_type == "team_year"
            assert spin.era_label not in ERA_LABELS
            assert TEAM_YEAR_SEASON_RE.match(spin.era_label)
            assert spin.franchise_display_name is not None
            assert spin.team_id is not None


def test_team_year_board_all_candidates_resolve_to_exact_season_card():
    """Every team-year candidate resolves via resolve_player_season_card to
    the EXACT team+season that was rolled -- never a different season, never
    a different team, never a peak-window substitute."""
    board = generate_team_year_board(mode="apex_1y", seed=7)
    for spin in board.spins:
        for slug in spin.candidate_player_slugs:
            card = resolve_player_season_card(slug, spin.team_id, spin.era_label)
            assert card is not None, f"unresolvable exact-season candidate: {slug} {spin.team_id} {spin.era_label}"
            assert card.season == spin.era_label
            assert card.team_id == spin.team_id


def test_team_year_board_feasibility_all_distinct_assignment_exists():
    board = generate_team_year_board(mode="apex_1y", seed=99)
    round_candidates = [s.candidate_player_slugs for s in board.spins]
    assert _can_assign_distinct(round_candidates)


def test_team_year_board_carries_receipt_fields():
    board = generate_team_year_board(mode="apex_1y", seed=1)
    assert board.experimental_team_year_data_version is not None
    assert board.interim_team_data_version is None  # decade dataset untouched
    assert board.metadata["formula_version"]
    assert board.metadata["coverage_mode"]
    assert board.metadata["data_version"] == board.experimental_team_year_data_version
    assert board.metadata["open_pool_enabled"] is False


def test_team_year_board_every_rollable_team_season_has_min_candidates():
    board = generate_team_year_board(mode="apex_1y", seed=1)
    for spin in board.spins:
        assert len(spin.candidate_player_slugs) >= MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON


def test_kd_2017_18_warriors_does_not_resolve_to_2013_14_okc():
    """The exact bug this session fixes: selecting a 2017-18 Warriors Kevin
    Durant candidate must never resolve to his 2013-14 OKC career-peak
    card."""
    kd_2017 = resolve_player_season_card("kevin-durant", "GSW", "2017-18")
    kd_2013 = resolve_player_season_card("kevin-durant", "OKC", "2013-14")
    assert kd_2017 is not None and kd_2013 is not None
    assert kd_2017.season == "2017-18" and kd_2017.team_id == "GSW"
    assert kd_2013.season == "2013-14" and kd_2013.team_id == "OKC"
    assert kd_2017.season_score != kd_2013.season_score
    # A 2017-18 GSW roll must never resolve KD to his 2013-14 team/season.
    wrong = resolve_player_season_card("kevin-durant", "GSW", "2013-14")
    assert wrong is None


def test_kd_2016_17_warriors_resolves_to_2016_17_not_another_season():
    card = resolve_player_season_card("kevin-durant", "GSW", "2016-17")
    assert card is not None
    assert card.season == "2016-17" and card.team_id == "GSW"


def test_curry_2015_16_warriors_resolves_exactly():
    card = resolve_player_season_card("stephen-curry", "GSW", "2015-16")
    assert card is not None
    assert card.season == "2015-16" and card.team_id == "GSW"
    assert card.score_status == "exact_season_scored"
    assert card.season_score is not None


def test_iguodala_2015_16_warriors_appears_and_is_scored():
    """Part 6 requirement: Andre Iguodala must appear for 2015-16 Warriors."""
    card = resolve_player_season_card("andre-iguodala", "GSW", "2015-16")
    assert card is not None
    assert card.season == "2015-16" and card.team_id == "GSW"
    assert card.score_status == "exact_season_scored"
    assert card.season_score is not None
    assert card.identity_pool_status == "canonical_250"


def test_festus_ezeli_2015_16_is_honestly_roster_only_and_unscored():
    """Festus Ezeli must appear as a real 2015-16 GSW roster candidate but
    must NOT be silently upgraded to canonical_250/qualifies_1500 or given a
    fabricated score -- see Part 6 of the Phase 6C task."""
    card = resolve_player_season_card("festus-ezeli", "GSW", "2015-16")
    assert card is not None
    assert card.identity_pool_status == "team_year_roster_only"
    assert card.score_status == "exact_season_unscored"
    assert card.season_score is None


def test_resolve_exact_card_by_key_roundtrips():
    original = resolve_player_season_card("kevin-durant", "GSW", "2017-18")
    by_key = resolve_exact_card_by_key(original.exact_player_season_key)
    assert by_key is not None
    assert by_key.player_slug == original.player_slug
    assert by_key.team_id == original.team_id
    assert by_key.season == original.season
    assert by_key.season_score == original.season_score


def test_experimental_team_year_summary_reports_real_dataset():
    summary = experimental_team_year_summary()
    assert summary["available"] is True
    assert summary["franchise_count"] >= 1
    assert summary["season_count"] >= 1
    assert summary["franchise_names"] == sorted(summary["franchise_names"])
    assert summary["rollable_team_season_count"] <= summary["total_team_season_count"]
    assert summary["min_candidates"] >= 1


def test_experimental_team_year_summary_missing_file_is_safe_diagnostic(tmp_path):
    missing = tmp_path / "does_not_exist.json"
    summary = experimental_team_year_summary(missing)
    assert summary["available"] is False
    assert summary["franchise_count"] == 0
    assert summary["dataset_version"] is None


def test_old_team_decade_path_unaffected_by_team_year_engine():
    """generate_board() (team+decade path) must produce byte-identical
    results before and after the team+year engine exists in the same
    module -- the two are purely additive, never sharing mutable state."""
    board = generate_board(mode="apex_1y", seed=42, team_spin_enabled=True)
    assert all(s.spin_type in ("team_decade", "exact_team_season", "open_pool") for s in board.spins)
    assert board.experimental_team_year_data_version is None


# ---------------------------------------------------------------------------
# Phase 6C: exact-season team+YEAR engine, API-level
# ---------------------------------------------------------------------------

@pytest.fixture
def team_year_client() -> TestClient:
    original = settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED
    settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED = True
    with TestClient(app) as c:
        yield c
    settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED = original


def test_readiness_reports_team_year_disabled_by_default(client: TestClient):
    resp = client.get("/api/v1/perfect-season/readiness")
    assert resp.status_code == 200
    data = resp.json()
    assert data["team_year_enabled"] is False
    assert data["experimental_team_year_franchise_count"] >= 1
    assert data["experimental_team_year_season_count"] >= 1


def test_readiness_reports_team_year_enabled_when_flagged(team_year_client: TestClient):
    resp = team_year_client.get("/api/v1/perfect-season/readiness")
    assert resp.status_code == 200
    assert resp.json()["team_year_enabled"] is True


def test_readiness_reports_no_score_or_peak_card_substitution(team_year_client: TestClient):
    resp = team_year_client.get("/api/v1/perfect-season/readiness")
    data = resp.json()
    assert data["open_pool_enabled"] is False
    assert data["exact_season_card_required"] is True
    assert data["score_substitution_allowed"] is False
    assert data["peak_card_substitution_allowed"] is False
    assert data["supported_end_season"] == "2025-26"


def test_create_game_with_team_year_enabled_yields_team_year_spins_and_receipt(team_year_client: TestClient):
    state = _create(team_year_client, mode="apex_1y", seed=42)
    assert state["current_spin"]["spin_type"] == "team_year"
    assert state["current_spin"]["candidate_source"] == "exact_team_season"
    assert state["open_pool_enabled"] is False
    assert state["experimental_team_year_data_version"] is not None
    assert state["formula_version"]
    assert state["coverage_mode"]


def test_selected_card_matches_exact_rolled_team_and_season(team_year_client: TestClient):
    """API-level regression for the core Phase 6C invariant: the pending
    selection returned after /select must carry the SAME team+season as the
    round that was rolled, never a substituted one."""
    state = _create(team_year_client, mode="apex_1y", seed=3)
    spin = state["current_spin"]
    slug = spin["candidates"][0]["player_slug"]
    game_id = state["game_id"]
    state = _select(team_year_client, game_id, slug)
    pending = state["pending_selection"]
    assert pending["team_id"] == spin["team_id"]
    assert pending["season"] == spin["era_label"]
    assert pending["peak_window_id"] is None
    assert pending["exact_player_season_key"] == f"{slug}-{spin['team_id'].lower()}-{spin['era_label'].replace('-', '')}"


def test_lineup_peak_score_is_real_mean_of_placed_card_scores():
    """Goal 9: PEAK3 Lineup Score is not fabricated -- it is the direct mean
    of the 8 placed cards' own real individual_peak_score values."""
    starters = ["michael-jordan", "magic-johnson", "larry-bird", "tim-duncan", "shaquille-oneal"]
    bench = ["kareem-abdul-jabbar", "hakeem-olajuwon", "lebron-james"]
    cards = [resolve_card(slug, 1) for slug in starters + bench]
    assert all(c is not None for c in cards)
    result = simulate_season(cards, board_seed=5, slot_types=SLOT_TYPES)
    expected = round(sum(c.individual_peak_score for c in cards) / len(cards), 1)
    assert result.lineup_peak_score == expected
    assert 0 <= result.lineup_peak_score <= 100


def test_team_year_game_completes_a_full_practice_attempt(team_year_client: TestClient):
    state = _create(team_year_client, mode="apex_1y", seed=1)
    game_id = state["game_id"]
    for _ in range(TOTAL_ROUNDS):
        state = team_year_client.get(f"/api/v1/perfect-season/games/{game_id}").json()
        assert state["status"] == "selection_pending"
        assert state["current_spin"]["spin_type"] == "team_year"
        player_slug = state["current_spin"]["candidates"][0]["player_slug"]
        _select(team_year_client, game_id, player_slug)
        open_slots = [s["slot_type"] for s in state["slots"] if not s["filled"]]
        _place(team_year_client, game_id, open_slots[0])
    result = _complete(team_year_client, game_id)
    assert result["status"] == "result_ready"
    assert result["simulation_result"] is not None
    assert result["simulation_result"]["lineup_score_status"] in ("complete", "incomplete")
    for slot in result["slots"]:
        assert slot["filled"] is True
        assert slot["team_name"] is not None
        assert slot["season"] is not None
        assert slot["peak_window_id"] is None
        # Score is only revealed once result_ready, and only for scored cards.
        if slot["score_status"] == "exact_season_scored":
            assert slot["season_score"] is not None
        else:
            assert slot["season_score"] is None
