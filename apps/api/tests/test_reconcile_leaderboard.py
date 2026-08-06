"""The 82-0 leaderboard reconciliation: what it derives, and what it refuses.

WHY RECONCILIATION EXISTS AT ALL. `perfect_season_runs` — the leaderboard table
— has never held a row, and not because submission is broken.
`POST /perfect-season/games/{id}/submit` begins with
`_require_leaderboard_enabled()`, and `PEAK3_COURTBUILDER_LEADERBOARD_ENABLED`
has never been set in any environment, so every submission any player attempted
returned 403 `leaderboard_not_enabled`. Saving a run is deliberately NOT behind
that flag, so `perfect_season_saved_runs` filled up while the board stayed
empty. Turning the flag on fixes every future run and nothing that came before.

THE FIXTURE IS A REAL RECORD, WITH THE OWNER REMOVED. `perfect_season_81_1_game.json`
is a byte-for-byte snapshot of the canonical `games` row behind a genuine 81-1
apex_1y run, with `owner_sub` replaced. Testing this against a constructed
payload would test the constructor: the whole question is whether a real stored
game still deserializes into something the eligibility rules accept, which only
a real stored game can answer.

THE REFUSALS ARE THE POINT. A backfill that writes on thin evidence is worse
than no backfill, because a fabricated #1 is indistinguishable from a real one
once it is on the board.
"""
from __future__ import annotations

import copy
import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURE = Path(__file__).parent / "fixtures" / "perfect_season_81_1_game.json"


def _load_script():
    """Import the script by path — it is a `scripts/` tool, not a package."""
    path = REPO_ROOT / "scripts" / "reconcile_perfect_season_leaderboard.py"
    spec = importlib.util.spec_from_file_location("reconcile_leaderboard", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["reconcile_leaderboard"] = module
    spec.loader.exec_module(module)
    return module


reconcile = _load_script()


@pytest.fixture
def game_row() -> dict:
    raw = json.loads(FIXTURE.read_text())
    return {
        "owner_sub": raw["owner_sub"],
        "status": raw["status"],
        "payload": copy.deepcopy(raw["payload"]),
        "updated_at": raw["updated_at"],
    }


GAME_ID = "e564b8d3-4c1f-4d09-8f8c-16e83ecd1104"


# ---------------------------------------------------------------------------
# What it derives
# ---------------------------------------------------------------------------


def test_a_real_completed_run_is_reconcilable(game_row):
    verdict, state = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    assert verdict.action == "would_reconcile", verdict.detail
    assert (verdict.wins, verdict.losses) == (81, 1)
    assert verdict.lineup_score == pytest.approx(77.3, abs=0.01)
    assert verdict.display_name == "peakfan"
    assert state is not None


def test_the_record_comes_from_the_simulation_not_from_a_saved_copy(game_row):
    """A saved run is a snapshot the client's save wrote. If reconciliation read
    it, a corrupted or stale snapshot would become a leaderboard entry. This
    reads `simulation_result` off the canonical game and nothing else."""
    game_row["payload"]["simulation_result"]["wins"] = 66
    game_row["payload"]["simulation_result"]["losses"] = 16
    verdict, _ = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    assert (verdict.wins, verdict.losses) == (66, 16)


def test_the_written_row_matches_what_submit_run_would_have_written(game_row):
    verdict, state = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    run = reconcile.build_run(verdict, state)
    assert run.game_id == GAME_ID
    assert run.owner_sub == game_row["owner_sub"]
    assert run.display_name == "peakfan"
    assert (run.wins, run.losses) == (81, 1)
    assert run.score_status == "complete"
    assert run.total_cards == len(state.slots)
    assert run.exact_cards_scored == run.total_cards
    assert run.seed == state.board.seed
    assert run.simulation_version == state.simulation_result.simulator_version
    # The id is assigned by the database, never by this tool.
    assert run.id == ""


# ---------------------------------------------------------------------------
# What it refuses
# ---------------------------------------------------------------------------


def test_no_canonical_game_is_refused_rather_than_fabricated():
    verdict, state = reconcile.decide(
        GAME_ID, game_row=None, existing_run=None, handle="peakfan"
    )
    assert verdict.action == "refused"
    assert verdict.reason == "no_canonical_game"
    assert "games row" in verdict.missing
    assert state is None


@pytest.mark.parametrize("status", ["placement_pending", "rounds_complete", "hold_pending"])
def test_an_unfinished_run_cannot_be_reconciled(game_row, status):
    game_row["status"] = status
    verdict, _ = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    assert verdict.action == "refused"
    assert verdict.reason == "game_not_complete"


def test_a_result_ready_game_with_no_simulation_is_refused(game_row):
    """`status` alone is not proof. The two are checked together because a row
    could be marked ready by a migration or a partial write."""
    game_row["payload"]["simulation_result"] = None
    verdict, _ = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    assert verdict.action == "refused"
    assert verdict.reason == "game_not_complete"


def test_an_ineligible_roster_is_refused_with_the_servers_own_reason(game_row):
    """Eligibility is `state_machine.compute_eligibility`, the same helper the
    HTTP route uses, so this tool can never accept a run the API would call
    ineligible."""
    for slot in game_row["payload"]["slots"]:
        slot["exact_player_season_key"] = None
    verdict, _ = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    assert verdict.action == "refused"
    assert verdict.reason != "ready"
    assert verdict.detail


def test_an_account_with_no_handle_is_refused_rather_than_named(game_row):
    """THE REAL BLOCKER on the run this pass audited. The board displays public
    handles and only handles; a generated one would publish an identity its
    owner never chose, which is exactly why `submit_run` requires a handle
    instead of defaulting one."""
    for handle in (None, ""):
        verdict, _ = reconcile.decide(
            GAME_ID, game_row=game_row, existing_run=None, handle=handle
        )
        assert verdict.action == "refused"
        assert verdict.reason == "handle_required"
        assert "profiles.handle" in verdict.missing
        assert verdict.display_name is None
        # It still REPORTS what it found, so the missing piece is actionable
        # rather than the whole answer being "no".
        assert (verdict.wins, verdict.losses) == (81, 1)


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


def test_a_run_already_on_the_board_is_left_alone(game_row):
    verdict, _ = reconcile.decide(
        GAME_ID,
        game_row=game_row,
        existing_run={"id": "abc-123", "wins": 81, "losses": 1},
        handle="peakfan",
    )
    assert verdict.action == "already_present"
    assert verdict.run_id == "abc-123"


def test_reconciling_twice_is_the_same_as_reconciling_once(game_row):
    """Idempotency is the schema's, not a check's: `perfect_season_runs.game_id`
    is UNIQUE. This asserts the tool's own behaviour matches that guarantee."""
    first, _ = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    assert first.action == "would_reconcile"
    second, _ = reconcile.decide(
        GAME_ID,
        game_row=game_row,
        existing_run={"id": "written-once", "wins": first.wins, "losses": first.losses},
        handle="peakfan",
    )
    assert second.action == "already_present"


def test_the_report_is_auditable(game_row):
    """Every verdict serialises to a dict that names the game, the owner, the
    outcome and the reason — so a reconciliation run leaves a record of what it
    did and did not touch, rather than a count."""
    verdict, _ = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    payload = verdict.as_dict()
    for key in ("game_id", "owner_sub", "action", "reason", "wins", "losses"):
        assert key in payload, key
    json.dumps(payload, default=str)


def test_the_row_carries_the_completion_time_not_the_backfill_time(game_row):
    """The board's tiebreak is `created_at`, so a reconciled row must not claim
    to have happened on the day the backfill ran.

    `list_runs` orders by (wins DESC, lineup_score DESC, respins ASC,
    created_at ASC) and pages on that tuple. `PerfectSeasonRun.created_at`
    defaults to `datetime.now(timezone.utc)` — correct for a live submission,
    where the run WAS just completed, and wrong for every row this tool writes.
    """
    from datetime import datetime, timezone

    verdict, state = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    run = reconcile.build_run(verdict, state)

    expected = reconcile._as_utc(game_row["updated_at"])
    assert expected is not None, "the fixture must carry a completion timestamp"
    assert run.created_at == expected
    assert run.created_at.tzinfo is not None, "TIMESTAMPTZ, never a naive clock"
    assert run.created_at < datetime.now(timezone.utc)


def test_a_game_with_no_timestamp_still_reconciles(game_row):
    """Falling back to now is the only honest option when the row carries
    nothing — but it must be a fallback, not the normal path."""
    from datetime import datetime, timezone

    game_row["updated_at"] = None
    verdict, state = reconcile.decide(
        GAME_ID, game_row=game_row, existing_run=None, handle="peakfan"
    )
    assert verdict.action == "would_reconcile"
    run = reconcile.build_run(verdict, state)
    assert run.created_at.tzinfo is not None
    assert (datetime.now(timezone.utc) - run.created_at).total_seconds() < 60
