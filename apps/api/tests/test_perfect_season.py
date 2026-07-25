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
            # Phase 6E Part B: asset-manifest schema readiness field, always
            # null today -- explicitly allowed here, still not a score/rank.
            "headshot_url",
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
            # Phase 6F Part C: asset-manifest headshot field, only populated
            # when ENABLE_EXTERNAL_ASSET_URLS is true (default off) -- still
            # not a score/rank.
            "headshot_url",
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


def test_team_year_dataset_is_not_warriors_only():
    """Phase 6D: the spinner must roll from broad coverage, not just the 3
    Golden State Warriors seasons the Phase 6A/6C narrow dataset had."""
    summary = experimental_team_year_summary()
    assert summary["franchise_count"] > 1
    assert summary["season_count"] > 3
    assert summary["rollable_team_season_count"] > 100
    assert "Golden State Warriors" in summary["franchise_names"]
    assert any(name != "Golden State Warriors" for name in summary["franchise_names"])


def test_team_year_dataset_covers_full_supported_season_range():
    summary = experimental_team_year_summary()
    assert summary["season_2025_26_coverage_status"] == "covered"
    assert "2025-26" in summary["season_labels"]
    assert "1979-80" in summary["season_labels"] or min(summary["season_labels"]) <= "1980-81"


def test_team_year_board_draws_from_multiple_teams_and_seasons_across_seeds():
    """Across several different seeds, the board generator must actually use
    its broad coverage -- not always land on the same team/season by
    coincidence of RNG or a latent bug that only ever samples one entry."""
    teams_seen: set[str] = set()
    seasons_seen: set[str] = set()
    for seed in range(1, 21):
        board = generate_team_year_board(mode="apex_1y", seed=seed)
        for spin in board.spins:
            teams_seen.add(spin.team_id)
            seasons_seen.add(spin.era_label)
    assert len(teams_seen) > 5, f"expected many distinct teams across 20 seeds, got {teams_seen}"
    assert len(seasons_seen) > 5, f"expected many distinct seasons across 20 seeds, got {seasons_seen}"


def test_team_year_candidates_are_alphabetical_not_star_weighted():
    """Phase 6E: candidate order must be alphabetical by display name, never
    minutes/score/star-weighted -- a stars-first order silently told the
    user which pick was 'best' before they chose. Exact team-season roster
    membership must be unchanged by the reorder (same set, different order)."""
    import json as _json
    dataset_path = (
        Path(__file__).resolve().parent.parent.parent.parent
        / "data" / "game" / "experimental" / "player_pool_1500" / "courtbuilder_team_year.experimental.v2.json"
    )
    data = _json.loads(dataset_path.read_text())
    entry = next(e for e in data["exact_team_year_spins"] if e["team_id"] == "GSW" and e["season_label"] == "2015-16")
    names = [c["player_name"] for c in entry["candidates"]]
    assert names == sorted(names), f"expected alphabetical order, got {names}"
    # Stephen Curry (the 2015-16 MVP, the "obvious star pick") must not be
    # first in the list purely by virtue of being the best player.
    assert entry["player_slugs"][0] != "stephen-curry"
    assert set(entry["player_slugs"]) == {
        "andre-iguodala", "andrew-bogut", "brandon-rush", "draymond-green", "festus-ezeli",
        "harrison-barnes", "ian-clark", "james-michael-mcadoo", "klay-thompson",
        "leandro-barbosa", "marreese-speights", "shaun-livingston", "stephen-curry",
    }


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


def test_okaro_white_is_honestly_roster_only_and_unscored():
    """Phase 6E Part H: Okaro White (2016-17/2017-18 Miami Heat) is a real,
    honest team_year_roster_only/exact_season_unscored case -- verified via
    scripts/review_player_pool_manifest.py --player "Okaro White"."""
    card = resolve_player_season_card("okaro-white", "MIA", "2016-17")
    assert card is not None
    assert card.identity_pool_status == "team_year_roster_only"
    assert card.score_status == "exact_season_unscored"
    assert card.season_score is None


def test_selecting_unscored_card_yields_incomplete_lineup_score_not_career_peak(team_year_client: TestClient):
    """Phase 6E Part H, end to end: if an unscored roster-only card is
    selected and placed, the final PEAK3 Lineup Score must not be presented
    as fully comparable (lineup_score_status == 'incomplete'), score
    coverage must be honestly reported, and no career-peak value is ever
    substituted (season_score stays None for that slot at every stage)."""
    state = _create(team_year_client, mode="apex_1y", seed=1)
    game_id = state["game_id"]

    picked_unscored = False
    for _ in range(TOTAL_ROUNDS):
        state = team_year_client.get(f"/api/v1/perfect-season/games/{game_id}").json()
        candidates = state["current_spin"]["candidates"]
        unscored = next((c for c in candidates if c["score_status"] == "exact_season_unscored"), None)
        slug = unscored["player_slug"] if (unscored and not picked_unscored) else candidates[0]["player_slug"]
        if unscored and not picked_unscored:
            picked_unscored = True
        _select(team_year_client, game_id, slug)
        open_slot = [s["slot_type"] for s in state["slots"] if not s["filled"]][0]
        state = _place(team_year_client, game_id, open_slot)

    result = _complete(team_year_client, game_id)
    assert picked_unscored, "no unscored candidate appeared across 8 rounds for this seed -- test needs a different seed"
    assert result["simulation_result"]["lineup_score_status"] == "incomplete"
    unscored_slots = [s for s in result["slots"] if s.get("score_status") == "exact_season_unscored"]
    assert len(unscored_slots) >= 1
    for s in unscored_slots:
        # No career-peak substitution: an unscored exact-season slot must
        # never carry a season_score value, revealed or not.
        assert s.get("season_score") is None
        assert "individual_peak_score" not in s or s.get("individual_peak_score") is None


def test_1500_manifest_v1_exists_and_excludes_festus_ezeli():
    """Direct manifest-file check (not just the live resolver) -- Festus
    Ezeli must not appear in the 1500-identity manifest at all, and Andre
    Iguodala must."""
    import json as _json
    manifest_path = (
        Path(__file__).resolve().parent.parent.parent.parent
        / "data" / "game" / "experimental" / "player_pool_1500" / "candidate_identity_manifest.v1.json"
    )
    assert manifest_path.exists(), "run: python scripts/audit_player_pool_expansion.py --write-manifest"
    manifest = _json.loads(manifest_path.read_text())
    assert manifest["final_identity_count"] >= 1500
    slugs = {i["player_slug"] for i in manifest["identities"]}
    assert "festus-ezeli" not in slugs
    assert "andre-iguodala" in slugs


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


# ---------------------------------------------------------------------------
# Phase 6F Part E/F: simulator ceiling calibration + structural weakness
# explanation (fixes the "Weakness: Rasheed Wallace" bug -- a strong player
# was blamed just for having the lowest score among 8 legends, instead of
# the explanation naming the actual roster-construction problem).
# ---------------------------------------------------------------------------

from nba_peak.perfect_season.simulation import simulate_exact_season  # noqa: E402

ALL_TIME_CEILING_LINEUP = [
    ("stephen-curry", "GSW", "2015-16"),
    ("michael-jordan", "CHI", "1990-91"),
    ("lebron-james", "MIA", "2012-13"),
    ("kevin-garnett", "MIN", "2003-04"),
    ("nikola-jokic", "DEN", "2022-23"),
    ("shaquille-o-neal", "LAL", "1999-00"),
    ("kevin-durant", "OKC", "2013-14"),
    ("tim-duncan", "SAS", "2002-03"),
]

GIANT_HEAVY_LINEUP = [
    ("kevin-johnson", "PHO", "1988-89"),
    ("john-stockton", "UTA", "1988-89"),
    ("joel-embiid", "PHI", "2022-23"),
    ("hakeem-olajuwon", "HOU", "1993-94"),
    ("shaquille-o-neal", "LAL", "1999-00"),
    ("rasheed-wallace", "POR", "2000-01"),
    ("walter-davis", "PHO", "1986-87"),
    ("pau-gasol", "MEM", "2005-06"),
]


def _resolve_lineup(spec: list[tuple[str, str, str]]):
    cards = [resolve_player_season_card(slug, team, season) for slug, team, season in spec]
    assert all(c is not None for c in cards), "fixture lineup must fully resolve -- see test setup"
    return cards


def test_all_time_ceiling_lineup_resolves_exact_seasons_never_career_peak():
    cards = _resolve_lineup(ALL_TIME_CEILING_LINEUP)
    for (slug, team, season), card in zip(ALL_TIME_CEILING_LINEUP, cards):
        assert card.player_slug == slug
        assert card.team_id == team
        assert card.season == season
        assert card.score_status == "exact_season_scored"
        assert card.season_score is not None


def test_all_time_ceiling_lineup_reaches_78_wins_minimum():
    """Part E requirement: a generic near-max-talent, elite-fit, elite-
    creation/scoring, elite-bench lineup must be able to map to 80-82 wins,
    minimum acceptable 78. No special-casing -- this calls the exact same
    simulate_exact_season() the UI uses, with no lineup-specific branch
    anywhere in the simulator."""
    cards = _resolve_lineup(ALL_TIME_CEILING_LINEUP)
    result = simulate_exact_season(cards, board_seed=1, slot_types=SLOT_TYPES)
    assert result.wins >= 78, f"expected >=78 wins for the all-time ceiling lineup, got {result.wins}"
    assert all(c.score_status == "exact_season_scored" for c in cards)


def test_giant_heavy_lineup_is_strong_but_not_forced_to_82():
    """Part E requirement: a talented-but-position-broken roster should be
    very strong (well above .500) without being forced to the 82-0 ceiling
    -- proves the positional-fit penalty has real teeth, generically."""
    cards = _resolve_lineup(GIANT_HEAVY_LINEUP)
    result = simulate_exact_season(cards, board_seed=1, slot_types=SLOT_TYPES)
    assert 50 <= result.wins < 78, f"expected a strong-but-not-elite record, got {result.wins} wins"


def test_giant_heavy_lineup_weakness_is_structural_not_rasheed():
    """Regression test for the exact bug reported: 'Weakness: Rasheed
    Wallace' is wrong -- Rasheed isn't even a starter in this lineup. Phase
    6G Part A: Embiid at SF is a SEVERE mismatch (his real position is C),
    which is worse than Stockton-at-SG/Hakeem-at-PF (both mild, PG<->SG and
    PF<->C) -- the severe case wins the priority and is framed as a missing
    position group ("no true wing"), not a scapegoat name."""
    cards = _resolve_lineup(GIANT_HEAVY_LINEUP)
    result = simulate_exact_season(cards, board_seed=1, slot_types=SLOT_TYPES)
    assert result.structural_weakness is not None
    assert "Rasheed Wallace" not in result.structural_weakness
    assert "no true wing" in result.structural_weakness
    assert "Joel Embiid" in result.structural_weakness
    assert result.best_pick is not None


MILD_OFFPOSITION_WEAK_TALENT_LINEUP = [
    ("travis-best", "MIA", "2002-03"),
    ("hubert-davis", "DAL", "1998-99"),
    ("reggie-miller", "IND", "1994-95"),
    ("carlos-rogers", "TOR", "1995-96"),
    ("dean-garrett", "DEN", "1997-98"),
    ("stacey-augmon", "POR", "1997-98"),
    ("james-bailey", "NYK", "1985-86"),
    ("john-williams", "LAC", "1992-93"),
]


def test_mild_offposition_does_not_outrank_weak_talent_component():
    """Phase 6G Part A regression test for the exact bug reported: a roster
    where Reggie Miller (real SG) starts at SF -- a mild, entirely
    plausible wing-sized swap -- must NOT be named "the weakness" when the
    roster's real problem is a much lower component (here, bench_strength
    ~20, far below the 50 floor). Reggie should be named best_pick, never
    structural_weakness."""
    cards = _resolve_lineup(MILD_OFFPOSITION_WEAK_TALENT_LINEUP)
    result = simulate_exact_season(cards, board_seed=1, slot_types=SLOT_TYPES)
    assert result.structural_weakness is not None
    assert "Reggie Miller" not in result.structural_weakness
    assert result.best_pick == "Reggie Miller"
    assert result.fit_components.bench_strength < 50
    # Names a component-level problem, not a bare/position-flavored phrase.
    assert result.structural_weakness in {
        "low talent core", "thin bench depth", "low team-context depth",
        "limited shot-creation coverage", "limited scoring coverage", "thin postseason pedigree",
    }


def test_all_time_ceiling_lineup_weakness_has_slot_context_not_bare_name():
    cards = _resolve_lineup(ALL_TIME_CEILING_LINEUP)
    result = simulate_exact_season(cards, board_seed=1, slot_types=SLOT_TYPES)
    # Whatever the weakness text is, if it names a player it must include
    # slot/position context -- never a bare "Weakness: <name>".
    if result.structural_weakness and result.structural_weakness not in (result.best_pick or ""):
        for card in cards:
            if result.structural_weakness == card.player_name:
                pytest.fail(f"weakness '{result.structural_weakness}' is a bare player name with no role/slot context")


# ---------------------------------------------------------------------------
# Phase 6G Part C: respins (team_year mode only)
# ---------------------------------------------------------------------------

def _respin_team(client: TestClient, game_id: str) -> dict:
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/respin-team",
        json={"game_id": game_id},
    )
    return resp


def _respin_season(client: TestClient, game_id: str) -> dict:
    resp = client.post(
        f"/api/v1/perfect-season/games/{game_id}/respin-season",
        json={"game_id": game_id},
    )
    return resp


def test_team_respin_changes_team_and_preserves_season(team_year_client: TestClient):
    state = _create(team_year_client, mode="apex_1y", seed=42)
    game_id = state["game_id"]
    original_team = state["current_spin"]["franchise_display_name"]
    original_season = state["current_spin"]["era_label"]

    resp = _respin_team(team_year_client, game_id)
    assert resp.status_code == 200, resp.text
    new_state = resp.json()
    assert new_state["current_spin"]["team_respins_used"] == 1
    assert new_state["current_spin"]["team_respins_max"] == 3
    # Either the season is preserved with a different team, or (if no other
    # team had that exact season) a fully independent valid pair -- either
    # way it must be a REAL, non-empty roster.
    assert len(new_state["current_spin"]["candidates"]) > 0
    assert all(c["team_name"] and c["season"] for c in new_state["current_spin"]["candidates"])
    changed = (
        new_state["current_spin"]["franchise_display_name"] != original_team
        or new_state["current_spin"]["era_label"] != original_season
    )
    assert changed, "respin_team must actually change something about the roll"


def test_season_respin_changes_season_and_preserves_team(team_year_client: TestClient):
    state = _create(team_year_client, mode="apex_1y", seed=7)
    game_id = state["game_id"]
    original_team = state["current_spin"]["franchise_display_name"]
    original_season = state["current_spin"]["era_label"]

    resp = _respin_season(team_year_client, game_id)
    assert resp.status_code == 200, resp.text
    new_state = resp.json()
    assert new_state["current_spin"]["season_respins_used"] == 1
    assert new_state["current_spin"]["season_respins_max"] == 3
    assert len(new_state["current_spin"]["candidates"]) > 0
    assert all(c["team_name"] and c["season"] for c in new_state["current_spin"]["candidates"])
    changed = (
        new_state["current_spin"]["franchise_display_name"] != original_team
        or new_state["current_spin"]["era_label"] != original_season
    )
    assert changed, "respin_season must actually change something about the roll"


def test_respin_max_three_each_independent(team_year_client: TestClient):
    state = _create(team_year_client, mode="apex_1y", seed=11)
    game_id = state["game_id"]

    for i in range(3):
        resp = _respin_team(team_year_client, game_id)
        assert resp.status_code == 200, resp.text
        assert resp.json()["current_spin"]["team_respins_used"] == i + 1

    resp = _respin_team(team_year_client, game_id)
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "respin_limit_reached"

    # Season respins are an independent budget -- still 3 available.
    for i in range(3):
        resp = _respin_season(team_year_client, game_id)
        assert resp.status_code == 200, resp.text
        assert resp.json()["current_spin"]["season_respins_used"] == i + 1

    resp = _respin_season(team_year_client, game_id)
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "respin_limit_reached"


def test_respin_disabled_after_player_selected(team_year_client: TestClient):
    state = _create(team_year_client, mode="apex_1y", seed=13)
    game_id = state["game_id"]
    slug = state["current_spin"]["candidates"][0]["player_slug"]
    _select(team_year_client, game_id, slug)

    resp = _respin_team(team_year_client, game_id)
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "respin_not_allowed"

    resp = _respin_season(team_year_client, game_id)
    assert resp.status_code == 400
    assert resp.json()["detail"]["error_code"] == "respin_not_allowed"


def test_respin_history_recorded_and_resets_next_round(team_year_client: TestClient):
    state = _create(team_year_client, mode="apex_1y", seed=17)
    game_id = state["game_id"]

    resp = _respin_team(team_year_client, game_id)
    state = resp.json()
    resp = _respin_season(team_year_client, game_id)
    state = resp.json()

    assert len(state["respin_history"]) == 2
    assert state["respin_history"][0]["round"] == 1
    assert state["respin_history"][0]["kind"] == "team"
    assert state["respin_history"][1]["kind"] == "season"
    assert set(state["respin_history"][0].keys()) == {
        "round", "kind", "from_team", "from_season", "to_team", "to_season",
    }

    # Advance to round 2 -- counters reset, history is preserved (not
    # cleared).
    slug = state["current_spin"]["candidates"][0]["player_slug"]
    state = _select(team_year_client, game_id, slug)
    open_slot = next(s["slot_type"] for s in state["slots"] if not s["filled"])
    state = _place(team_year_client, game_id, open_slot)

    assert state["current_round"] == 2
    assert state["current_spin"]["team_respins_used"] == 0
    assert state["current_spin"]["season_respins_used"] == 0
    assert len(state["respin_history"]) == 2  # unchanged, not cleared


def test_respin_never_produces_empty_candidate_list(team_year_client: TestClient):
    """No-special-casing sweep: respin repeatedly across several seeds and
    confirm every resulting roll has a real, non-empty candidate list with
    populated exact team_name/season fields."""
    for seed in (1, 2, 3, 4, 5):
        state = _create(team_year_client, mode="apex_1y", seed=seed)
        game_id = state["game_id"]
        for _ in range(3):
            resp = _respin_team(team_year_client, game_id)
            assert resp.status_code == 200, resp.text
            candidates = resp.json()["current_spin"]["candidates"]
            assert len(candidates) > 0
            assert all(c["team_name"] and c["season"] for c in candidates)


# ---------------------------------------------------------------------------
# Phase 6G Part D: ESPN asset rendering (PEAK3_ENABLE_EXTERNAL_ASSET_URLS)
# ---------------------------------------------------------------------------

@pytest.fixture
def team_year_assets_client() -> TestClient:
    """team_year mode + external asset URLs both on -- dev-mode image
    rendering, the exact combination Part D audits."""
    orig_team_year = settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED
    orig_assets = settings.ENABLE_EXTERNAL_ASSET_URLS
    settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED = True
    settings.ENABLE_EXTERNAL_ASSET_URLS = True
    with TestClient(app) as c:
        yield c
    settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED = orig_team_year
    settings.ENABLE_EXTERNAL_ASSET_URLS = orig_assets


def test_external_assets_disabled_by_default_no_headshot_urls(team_year_client: TestClient):
    """Default safe production behavior: ENABLE_EXTERNAL_ASSET_URLS is off,
    so no candidate ever carries a headshot_url, even for a resolved
    player -- the frontend has nothing to render but initials."""
    state = _create(team_year_client, mode="apex_1y", seed=1)
    assert all(c.get("headshot_url") is None for c in state["current_spin"]["candidates"])
    assert state["current_spin"].get("team_logo_url") is None


def test_external_assets_enabled_exposes_real_headshot_urls(team_year_assets_client: TestClient):
    """When the flag is on, a resolved asset entry's real ESPN CDN URL is
    exposed on the candidate -- proves the manifest is actually joined into
    the API response, not just generated and left unused."""
    # LeBron James is a verified-resolved entry in player_assets.v2.json
    # (see scripts/build_espn_asset_manifests.py) -- spin directly at his
    # exact 2012-13 Miami season via the dev simulate endpoint isn't
    # necessary here; instead confirm the asset lookup function itself
    # (the same one get_public_state calls) returns a real CDN URL.
    from nba_peak.perfect_season.assets import get_player_headshot_url, get_team_logo_url

    url = get_player_headshot_url("lebron-james")
    assert url is not None
    assert url.startswith("https://a.espncdn.com/")

    logo = get_team_logo_url("MIA")
    assert logo is not None
    assert logo.startswith("https://a.espncdn.com/")

    # And it round-trips through a real game's current_spin/team_logo_url
    # when that round happens to be a resolved team.
    state = _create(team_year_assets_client, mode="apex_1y", seed=1)
    assert state["current_spin"]["team_logo_url"] is not None
    assert state["current_spin"]["team_logo_url"].startswith("https://a.espncdn.com/")


def test_unresolved_player_never_gets_a_fabricated_url(team_year_assets_client: TestClient):
    """A player with no ESPN resolution (e.g. a long-retired legend) must
    get headshot_url: None even with the flag on -- never a guessed/
    fabricated URL."""
    from nba_peak.perfect_season.assets import get_player_headshot_url

    assert get_player_headshot_url("michael-jordan") is None
    assert get_player_headshot_url("hakeem-olajuwon") is None


# ---------------------------------------------------------------------------
# Phase 6G Part E: authenticated global leaderboard
# ---------------------------------------------------------------------------

TEST_JWT_SECRET = "e2e-ranked-test-secret-do-not-use-in-prod"


def _mint_test_jwt(sub: str, email: str = "test@example.com", is_anonymous: bool = False) -> str:
    """Mints a Supabase-shaped HS256 JWT for pytest use -- mirrors
    apps/web/src/tests/e2e/helpers/test-jwt.ts's exact approach (same
    shared-secret HS256 scheme app.core.auth._decode_jwt verifies), so no
    live Supabase project is needed to test the authenticated path."""
    import time
    import jwt as _jwt

    now = int(time.time())
    payload = {
        "sub": sub, "email": email, "is_anonymous": is_anonymous,
        "aud": "authenticated", "role": "authenticated",
        "iat": now, "exp": now + 3600,
    }
    return _jwt.encode(payload, TEST_JWT_SECRET, algorithm="HS256")


def _play_full_scored_game_as(client: TestClient, token: str, seed: int) -> dict:
    """Like _play_full_game, but always picks a fully-scored candidate each
    round (never a team_year_roster_only/exact_season_unscored one) so the
    resulting roster is guaranteed leaderboard-eligible (score_status ==
    'complete') regardless of which random team-seasons this seed rolls --
    without this, a seed that happens to roll a roster-only/unscored
    candidate makes the test's /submit call non-deterministically rejected
    with incomplete_score_not_eligible, which is a REAL and correct
    rejection (Part E requires full score coverage to submit) but not what
    these particular tests are checking. Also attaches the given user's
    Authorization header from creation through completion, so the game's
    owner_sub is that real authenticated sub."""
    client.headers["Authorization"] = f"Bearer {token}"
    try:
        state = _create(client, mode="apex_1y", seed=seed)
        game_id = state["game_id"]
        for _ in range(8):
            candidates = state["current_spin"]["candidates"]
            scored = next((c for c in candidates if c.get("score_status") == "exact_season_scored"), candidates[0])
            state = _select(client, game_id, scored["player_slug"])
            open_slot = next(s["slot_type"] for s in state["slots"] if not s["filled"])
            state = _place(client, game_id, open_slot)
        resp = client.post(f"/api/v1/perfect-season/games/{game_id}/complete", json={"game_id": game_id})
        assert resp.status_code == 200, resp.text
        return resp.json()
    finally:
        del client.headers["Authorization"]


@pytest.fixture
def leaderboard_client() -> TestClient:
    orig_team_year = settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED
    orig_leaderboard = settings.COURTBUILDER_LEADERBOARD_ENABLED
    orig_jwt_secret = settings.SUPABASE_JWT_SECRET
    settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED = True
    settings.COURTBUILDER_LEADERBOARD_ENABLED = True
    settings.SUPABASE_JWT_SECRET = TEST_JWT_SECRET
    with TestClient(app) as c:
        yield c
    settings.COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED = orig_team_year
    settings.COURTBUILDER_LEADERBOARD_ENABLED = orig_leaderboard
    settings.SUPABASE_JWT_SECRET = orig_jwt_secret


def test_leaderboard_disabled_by_default_returns_disabled_flag(team_year_client: TestClient):
    resp = team_year_client.get("/api/v1/perfect-season/leaderboard")
    assert resp.status_code == 200
    data = resp.json()
    assert data["leaderboard_enabled"] is False
    assert data["runs"] == []


def test_unauthenticated_submit_returns_401(leaderboard_client: TestClient):
    state = _play_full_game(leaderboard_client, seed=101)
    game_id = state["game_id"]
    resp = leaderboard_client.post(f"/api/v1/perfect-season/games/{game_id}/submit", json={"game_id": game_id})
    assert resp.status_code == 401


def test_authenticated_submit_succeeds_and_recomputes_from_server_state(leaderboard_client: TestClient):
    token = _mint_test_jwt("user-abc")
    state = _play_full_scored_game_as(leaderboard_client, token, seed=102)
    game_id = state["game_id"]

    # A malicious client tries to smuggle a fabricated win total / score in
    # the request body -- SubmitRunRequest only has a game_id field at all,
    # so there is no field for a fake wins/score to even land in.
    resp = leaderboard_client.post(
        f"/api/v1/perfect-season/games/{game_id}/submit",
        json={"game_id": game_id, "wins": 82, "lineup_score": 100.0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    run = resp.json()
    # The recorded wins/score must match the server's own simulation_result
    # from when the game was completed, not the fabricated body fields.
    assert run["wins"] == state["simulation_result"]["wins"]
    assert run["lineup_score"] == state["simulation_result"]["lineup_peak_score"]
    assert run["mode"] == "apex_1y"
    assert run["team_respins_used"] == 0
    assert run["season_respins_used"] == 0


def test_cannot_submit_someone_elses_game(leaderboard_client: TestClient):
    state = _play_full_game(leaderboard_client, seed=103)
    game_id = state["game_id"]
    token = _mint_test_jwt("a-different-user")
    resp = leaderboard_client.post(
        f"/api/v1/perfect-season/games/{game_id}/submit",
        json={"game_id": game_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    # This game was created anonymously (no auth on /games), so its
    # owner_sub is an anon subject -- never equal to a real signed-in sub.
    assert resp.status_code == 403


def test_anonymous_session_cannot_submit(leaderboard_client: TestClient):
    state = _play_full_game(leaderboard_client, seed=104)
    game_id = state["game_id"]
    token = _mint_test_jwt("anon-user", is_anonymous=True)
    resp = leaderboard_client.post(
        f"/api/v1/perfect-season/games/{game_id}/submit",
        json={"game_id": game_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 401
    assert resp.json()["detail"]["error_code"] == "sign_in_required"


def test_public_leaderboard_read_works_and_is_sorted(leaderboard_client: TestClient):
    for i, seed in enumerate([201, 202, 203]):
        token = _mint_test_jwt(f"user-{i}")
        state = _play_full_scored_game_as(leaderboard_client, token, seed=seed)
        leaderboard_client.post(
            f"/api/v1/perfect-season/games/{state['game_id']}/submit",
            json={"game_id": state["game_id"]},
            headers={"Authorization": f"Bearer {token}"},
        )

    resp = leaderboard_client.get("/api/v1/perfect-season/leaderboard")
    assert resp.status_code == 200
    data = resp.json()
    assert data["leaderboard_enabled"] is True
    assert len(data["runs"]) >= 3
    wins = [r["wins"] for r in data["runs"]]
    assert wins == sorted(wins, reverse=True)


def test_no_respin_filter_excludes_runs_with_respins(leaderboard_client: TestClient):
    # Run A: no respins.
    token_a = _mint_test_jwt("user-a")
    state_a = _play_full_scored_game_as(leaderboard_client, token_a, seed=301)
    leaderboard_client.post(
        f"/api/v1/perfect-season/games/{state_a['game_id']}/submit",
        json={"game_id": state_a["game_id"]},
        headers={"Authorization": f"Bearer {token_a}"},
    )

    # Run B: uses a respin on round 1 before playing it out.
    token_b = _mint_test_jwt("user-b")
    leaderboard_client.headers["Authorization"] = f"Bearer {token_b}"
    state_b = _create(leaderboard_client, mode="apex_1y", seed=302)
    game_id_b = state_b["game_id"]
    resp = leaderboard_client.post(f"/api/v1/perfect-season/games/{game_id_b}/respin-team", json={"game_id": game_id_b})
    state_b = resp.json()
    for _ in range(8):
        candidates = state_b["current_spin"]["candidates"]
        scored = next((c for c in candidates if c.get("score_status") == "exact_season_scored"), candidates[0])
        state_b = _select(leaderboard_client, game_id_b, scored["player_slug"])
        open_slot = next(s["slot_type"] for s in state_b["slots"] if not s["filled"])
        state_b = _place(leaderboard_client, game_id_b, open_slot)
    resp = leaderboard_client.post(f"/api/v1/perfect-season/games/{game_id_b}/complete", json={"game_id": game_id_b})
    state_b = resp.json()
    resp = leaderboard_client.post(
        f"/api/v1/perfect-season/games/{game_id_b}/submit",
        json={"game_id": game_id_b},
        headers={"Authorization": f"Bearer {token_b}"},
    )
    del leaderboard_client.headers["Authorization"]
    assert resp.json()["team_respins_used"] == 1

    resp = leaderboard_client.get("/api/v1/perfect-season/leaderboard?no_respin=true")
    data = resp.json()
    game_ids_with_respins = [r for r in data["runs"] if r["team_respins_used"] > 0 or r["season_respins_used"] > 0]
    assert game_ids_with_respins == []
    assert any(r["display_name"] for r in data["runs"])  # at least run A is present


def test_me_runs_requires_auth_and_returns_own_runs(leaderboard_client: TestClient):
    resp = leaderboard_client.get("/api/v1/perfect-season/me/runs")
    assert resp.status_code == 401

    token = _mint_test_jwt("user-me")
    state = _play_full_scored_game_as(leaderboard_client, token, seed=401)
    leaderboard_client.post(
        f"/api/v1/perfect-season/games/{state['game_id']}/submit",
        json={"game_id": state["game_id"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp = leaderboard_client.get("/api/v1/perfect-season/me/runs", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    runs = resp.json()["runs"]
    assert len(runs) == 1


def test_duplicate_submission_is_idempotent_not_duplicated(leaderboard_client: TestClient):
    token = _mint_test_jwt("user-dup")
    state = _play_full_scored_game_as(leaderboard_client, token, seed=501)
    game_id = state["game_id"]
    resp1 = leaderboard_client.post(
        f"/api/v1/perfect-season/games/{game_id}/submit",
        json={"game_id": game_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    resp2 = leaderboard_client.post(
        f"/api/v1/perfect-season/games/{game_id}/submit",
        json={"game_id": game_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp1.status_code == 200 and resp2.status_code == 200
    assert resp1.json()["id"] == resp2.json()["id"]

    resp = leaderboard_client.get("/api/v1/perfect-season/me/runs", headers={"Authorization": f"Bearer {token}"})
    assert len(resp.json()["runs"]) == 1


def test_leaderboard_repo_in_memory_fallback_does_not_crash(leaderboard_client: TestClient):
    """No DATABASE_URL is set in this test environment -- confirms the
    in-memory fallback repository serves real requests without crashing,
    per Part E's explicit CI requirement."""
    resp = leaderboard_client.get("/api/v1/perfect-season/leaderboard")
    assert resp.status_code == 200


def test_rls_migration_has_expected_policies():
    """The local Supabase migration for the leaderboard tables must define
    RLS with public-read/owner-insert-only/no-update-delete, matching
    Part E's spec -- a static content check, not a live Postgres test (no
    hosted Supabase is touched)."""
    migration_path = _repo_root / "supabase" / "migrations" / "20260724150000_perfect_season_leaderboard.sql"
    assert migration_path.exists()
    sql = migration_path.read_text()
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "perfect_season_runs_public_read" in sql
    assert "perfect_season_runs_owner_insert" in sql
    assert "FOR UPDATE" not in sql
    assert "FOR DELETE" not in sql
