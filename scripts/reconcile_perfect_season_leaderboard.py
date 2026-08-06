#!/usr/bin/env python3
"""Reconcile completed 82-0 runs onto the PEAK Season leaderboard.

WHY THIS EXISTS
===============
The 82-0 global leaderboard has never had a row in it, and not because
submission is broken. `POST /perfect-season/games/{id}/submit` begins with
`_require_leaderboard_enabled()`, and `PEAK3_COURTBUILDER_LEADERBOARD_ENABLED`
has never been set anywhere -- so every submission any player ever attempted
returned 403 `leaderboard_not_enabled`, and `GET /perfect-season/leaderboard`
answered `leaderboard_enabled: false`, which the UI rendered as "The global
leaderboard isn't enabled yet."

Saving a run is deliberately NOT behind that flag (a completed run belongs in
its owner's history whether or not a competitive board exists), so
`perfect_season_saved_runs` filled up while `perfect_season_runs` stayed empty.
Turning the flag on fixes every FUTURE run and does nothing for the ones played
while it was off. This is the one-time, idempotent, auditable path for those.

WHAT IT WILL AND WILL NOT DO
============================
It derives a leaderboard entry from the CANONICAL COMPLETED GAME -- the same
`games` row `submit_run` reads -- through the same helpers, in the same order:

    game.status == "result_ready" and game.simulation_result is not None
    state_machine.compute_eligibility(game)["leaderboard_eligible"]
    wins/losses/lineup_score   <- game.simulation_result, never a saved copy
    display_name               <- profiles.handle, never derived from an email
    idempotency                <- perfect_season_runs.game_id UNIQUE

Nothing is read from `perfect_season_saved_runs`. That table is a snapshot the
client's save wrote; using it here would mean reconciling the board from a copy
rather than from the record, which is exactly the thing this script exists to
avoid. The saved run is used for ONE thing only: as a way to find candidate
game ids, and every candidate is then re-derived from the game itself.

IT REFUSES, LOUDLY, RATHER THAN FABRICATING:

  * no `games` row              -> refuse. There is no authoritative record.
  * status is not result_ready  -> refuse. The run was never completed.
  * not leaderboard-eligible    -> refuse, quoting the server's own reason.
  * owner has no public handle  -> refuse. The board shows handles and only
                                   handles; inventing one would publish an
                                   identity its owner never chose, which is
                                   precisely the reason `submit_run` requires
                                   one instead of defaulting it.
  * already on the board        -> report it and change nothing.

DRY RUN BY DEFAULT. `--apply` is required to write, and every write goes
through the same repository method the HTTP route uses, so the row this
produces is byte-for-byte the row a successful submission would have produced.

    python scripts/reconcile_perfect_season_leaderboard.py --owner <sub>
    python scripts/reconcile_perfect_season_leaderboard.py --game <game_id> --apply
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "apps" / "api"))


@dataclass
class Verdict:
    """One candidate game, and exactly what is true about it."""

    game_id: str
    owner_sub: Optional[str] = None
    action: str = "refused"  # reconciled | already_present | refused
    reason: str = ""
    detail: str = ""
    wins: Optional[int] = None
    losses: Optional[int] = None
    lineup_score: Optional[float] = None
    display_name: Optional[str] = None
    #: When the RUN was completed (`games.updated_at`), tz-aware UTC. This
    #: becomes the leaderboard row's `created_at` — see `build_run`.
    completed_at: Optional[datetime] = None
    run_id: Optional[str] = None
    missing: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {k: v for k, v in self.__dict__.items() if v not in (None, "", [])}


def _as_utc(value: Any) -> Optional[datetime]:
    """`games.updated_at` as a tz-aware UTC datetime, whatever shape it arrives in.

    asyncpg hands back a `datetime`; the test fixture is a JSON string, because
    it is a byte-for-byte snapshot of a stored row. Both have to reach
    `build_run` as the same thing, since this value becomes a TIMESTAMPTZ.
    """
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


async def _candidates(conn, owner: Optional[str], game: Optional[str]) -> list[str]:
    """Game ids worth examining. A saved run is a HINT, never evidence."""
    if game:
        return [game]
    rows = await conn.fetch(
        """
        SELECT DISTINCT g.id::text AS game_id
        FROM games g
        WHERE g.status = 'result_ready'
          AND ($1::text IS NULL OR g.owner_sub = $1)
        ORDER BY 1
        """,
        owner,
    )
    return [r["game_id"] for r in rows]


def decide(
    game_id: str,
    *,
    game_row: Optional[dict],
    existing_run: Optional[dict],
    handle: Optional[str],
) -> tuple[Verdict, Optional[Any]]:
    """The whole decision, as a pure function of three lookups.

    SEPARATED FROM THE DATABASE ON PURPOSE. Every refusal below is a rule about
    evidence -- "no canonical record", "never completed", "not eligible", "no
    name to publish" -- and a rule about evidence should be testable without a
    Postgres instance to hold the evidence in. `test_reconcile_leaderboard.py`
    drives this with fixtures; the async wrapper below does the three lookups
    and nothing else.

    Returns the verdict and, when one can be written, the deserialized state it
    would be written from -- so the caller never re-derives it from a second
    reading of the payload.
    """
    from app.services.perfect_season import state as state_machine
    from app.services.perfect_season.serialization import court_state_from_dict

    verdict = Verdict(game_id=game_id)

    if game_row is None:
        verdict.reason = "no_canonical_game"
        verdict.detail = (
            "No `games` row with this id. There is no authoritative record to "
            "derive an entry from, and this script will not invent one."
        )
        verdict.missing = ["games row"]
        return verdict, None

    verdict.owner_sub = game_row["owner_sub"]
    payload = game_row["payload"]
    if isinstance(payload, str):
        payload = json.loads(payload)

    if game_row["status"] != "result_ready" or not payload.get("simulation_result"):
        verdict.reason = "game_not_complete"
        verdict.detail = (
            f"status={game_row['status']!r} and simulation_result="
            f"{'present' if payload.get('simulation_result') else 'absent'}. "
            "A run that was never simulated has no record to reconcile."
        )
        verdict.missing = ["completed simulation"]
        return verdict, None

    # THE SAME DESERIALIZER `CourtLineupRepository.get_lineup` uses, so the
    # object this reasons about is the object the HTTP route would have.
    state = court_state_from_dict(payload)
    eligibility = state_machine.compute_eligibility(state)
    if not eligibility["leaderboard_eligible"]:
        verdict.reason = eligibility["reason"]
        verdict.detail = eligibility["reason_detail"]
        verdict.missing = ["leaderboard eligibility"]
        return verdict, None

    result = state.simulation_result
    verdict.wins = result.wins
    verdict.losses = result.losses
    verdict.lineup_score = float(result.lineup_peak_score)
    verdict.completed_at = _as_utc(game_row.get("updated_at"))

    if existing_run is not None:
        verdict.action = "already_present"
        verdict.reason = "already_on_the_board"
        verdict.run_id = str(existing_run["id"])
        verdict.detail = (
            f"Already leaderboard row {existing_run['id']} at "
            f"{existing_run['wins']}-{existing_run['losses']}. `game_id` is "
            "UNIQUE, so this script is idempotent by the schema rather than by "
            "a check."
        )
        return verdict, state

    if not handle:
        verdict.reason = "handle_required"
        verdict.detail = (
            "This account has no public handle, so there is no name to publish "
            "on the board. `submit_run` refuses for the same reason and this "
            "refuses for the same reason: a generated public identity is one "
            "its owner never chose. Set a handle at /profile, then re-run."
        )
        verdict.missing = ["profiles.handle"]
        return verdict, state

    verdict.display_name = handle
    verdict.action = "would_reconcile"
    verdict.reason = "ready"
    verdict.detail = "Every check passed."
    return verdict, state


def build_run(verdict: Verdict, state: Any):
    """The leaderboard row, derived from the canonical state exactly as
    `submit_run` derives it. Kept next to `decide` so the two cannot drift."""
    from app.services.perfect_season import state as state_machine
    from app.repositories.leaderboard_protocols import PerfectSeasonRun

    result = state.simulation_result
    board = state.board
    return PerfectSeasonRun(
        id="",
        owner_sub=verdict.owner_sub,
        display_name=verdict.display_name,
        mode=state.mode,
        game_id=verdict.game_id,
        seed=board.seed,
        wins=result.wins,
        losses=result.losses,
        lineup_score=float(result.lineup_peak_score),
        score_status=(
            "complete" if state_machine.placed_cards_all_scored(state) else "incomplete"
        ),
        exact_cards_scored=sum(1 for s in state.slots if s.exact_player_season_key),
        total_cards=len(state.slots),
        team_respins_used=sum(
            1 for h in state.respin_history if h.get("kind") == "team"
        ),
        season_respins_used=sum(
            1 for h in state.respin_history if h.get("kind") == "season"
        ),
        roster_card_keys=[
            s.exact_player_season_key or s.peak_window_id or "" for s in state.slots
        ],
        data_version=board.experimental_team_year_data_version,
        formula_version=board.metadata.get("formula_version"),
        simulation_version=result.simulator_version,
        # WHEN THE RUN WAS PLAYED, NOT WHEN THIS SCRIPT RAN.
        #
        # `PerfectSeasonRun.created_at` defaults to `datetime.now(timezone.utc)`,
        # which is right for a live submission — the run was just completed —
        # and wrong for every row this tool writes. The board orders by
        # `(wins DESC, lineup_score DESC, respins ASC, created_at ASC)` and
        # pages on that tuple, so `created_at` is not decoration: it is the
        # tiebreak between two identical runs, and it is the ONLY field on the
        # row that says when any of this happened. Stamping a months-old 81-1
        # with today's clock would place it behind every tie it actually won,
        # and would tell anyone reading the board that the run happened on the
        # day of the backfill.
        #
        # `games.updated_at` is the completion timestamp, because
        # `action_complete_game` is the write that produced the
        # `simulation_result` this row is derived from. Falls back to now only
        # when the row somehow carries no timestamp at all.
        created_at=verdict.completed_at or datetime.now(timezone.utc),
    )


async def _reconcile_one(conn, game_id: str, apply: bool) -> Verdict:
    game_row = await conn.fetchrow(
        "SELECT owner_sub, status, payload, updated_at FROM games WHERE id = $1::uuid",
        game_id,
    )
    existing = await conn.fetchrow(
        "SELECT id::text AS id, wins, losses FROM perfect_season_runs WHERE game_id = $1",
        game_id,
    )
    handle = None
    if game_row is not None:
        handle = await conn.fetchval(
            "SELECT handle FROM profiles WHERE id = $1::uuid", game_row["owner_sub"]
        )

    verdict, state = decide(
        game_id,
        game_row=dict(game_row) if game_row is not None else None,
        existing_run=dict(existing) if existing is not None else None,
        handle=handle,
    )
    if verdict.action != "would_reconcile":
        return verdict
    if not apply:
        verdict.reason = "dry_run"
        verdict.detail = "Every check passed. Re-run with --apply to write."
        return verdict

    from app.repositories.leaderboard_postgres import (
        PostgresPerfectSeasonLeaderboardRepository,
    )

    repo = PostgresPerfectSeasonLeaderboardRepository()
    saved = await repo.submit_run(build_run(verdict, state))
    verdict.action = "reconciled"
    verdict.reason = "written"
    verdict.run_id = saved.id
    return verdict


async def _run(args) -> int:
    import asyncpg

    url = args.database_url or os.environ.get("PEAK3_DATABASE_URL")
    if not url:
        print(
            "ERROR: no database URL. Pass --database-url or set PEAK3_DATABASE_URL.",
            file=sys.stderr,
        )
        return 2

    conn = await asyncpg.connect(url, timeout=20)
    try:
        ids = await _candidates(conn, args.owner, args.game)
        verdicts = [await _reconcile_one(conn, gid, args.apply) for gid in ids]
    finally:
        await conn.close()

    interesting = [
        v
        for v in verdicts
        if v.action != "refused" or v.reason not in {"game_not_complete"}
    ]
    report = {
        "mode": "apply" if args.apply else "dry-run",
        "candidates": len(verdicts),
        "reconciled": sum(1 for v in verdicts if v.action == "reconciled"),
        "would_reconcile": sum(1 for v in verdicts if v.action == "would_reconcile"),
        "already_present": sum(1 for v in verdicts if v.action == "already_present"),
        "refused": sum(1 for v in verdicts if v.action == "refused"),
        "verdicts": [v.as_dict() for v in interesting],
    }
    print(json.dumps(report, indent=2, sort_keys=True, default=str))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", help="owner_sub to reconcile (all their completed games)")
    parser.add_argument("--game", help="a single game id")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually write. Without it this reports and changes nothing.",
    )
    parser.add_argument("--database-url", help="defaults to $PEAK3_DATABASE_URL")
    args = parser.parse_args()
    if not args.owner and not args.game:
        parser.error("one of --owner or --game is required")
    return asyncio.run(_run(args))


if __name__ == "__main__":
    raise SystemExit(main())
