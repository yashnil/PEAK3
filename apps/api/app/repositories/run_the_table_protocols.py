"""Persistence interface for RUN THE TABLE runs.

WHAT IS STORED, AND WHAT DELIBERATELY IS NOT

Stored: `(run_id, owner_sub, seed, run_type, run_date, status, snapshot,
versions)`. That is all a run is.

NOT stored: the blueprint. The starting roster, every draft/trade board, the
node graph and all three bosses are a pure function of the seed
(`nba_peak.run_the_table.generation.generate_blueprint`), so persisting them
would create a second copy of the truth that could drift from the first. It is
regenerated on every load instead, and `assert_version_compatible` refuses a
snapshot whose engine/ruleset/card-pool versions have moved -- silently
replaying a run under changed rules would produce a result that never happened.

The version columns exist for exactly that check plus operational triage
("which ruleset were the runs that broke on?"). They are denormalised copies of
what is already inside `snapshot["versions"]`, which is intentional: an
operator answering that question should not have to open a JSONB blob, and a
snapshot whose versions disagree with its columns is a corruption signal.

ANONYMOUS-FIRST. `owner_sub` may be an anon-cookie subject (`anon:...`), not
only a Supabase `auth.uid()`. RUN THE TABLE requires no sign-in to play, so the
overwhelmingly common owner here is anonymous, and every query scopes on
`owner_sub` regardless of which kind it is.

ONE OFFICIAL DAILY. `get_daily_run` is the read half of the "first attempt is
the official one" rule; the Postgres unique index on
`(owner_sub, run_type, run_date) WHERE run_type = 'daily'` is the half that
holds under concurrency. Re-creating a daily returns the run already in
progress rather than a fresh one -- a daily happens once, and letting a reload
mint a new board would make the shared board meaningless.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Protocol, runtime_checkable


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class StoredRun:
    """One persisted run.

    `snapshot` is `app.services.run_the_table.serialization.state_to_dict`'s
    output and nothing else -- the repository never interprets it.
    """

    run_id: str
    owner_sub: str
    seed: int
    run_type: str
    # YYYY-MM-DD for daily runs (and for a challenge minted from one); None
    # otherwise. Kept as a string at this layer so memory and Postgres agree on
    # the type regardless of the column's SQL type.
    run_date: Optional[str]
    status: str
    snapshot: dict
    engine_version: str
    ruleset_version: str
    card_pool_version: str
    created_at: datetime = field(default_factory=_now)
    updated_at: datetime = field(default_factory=_now)


@runtime_checkable
class RunTheTableRunRepository(Protocol):
    async def create_run(self, run: StoredRun) -> tuple[StoredRun, bool]:
        """Insert a run.

        Returns `(record, created)`. For a daily run whose
        `(owner_sub, run_date)` already has one, the EXISTING record is
        returned with `created=False` and nothing is written -- see the module
        docstring for why a daily is not re-rollable.
        """
        ...

    async def get_run(self, run_id: str) -> Optional[StoredRun]:
        """One run by id, regardless of owner.

        Ownership is checked by the caller, not here, so the route can
        distinguish 404 (no such run) from 403 (someone else's run). Collapsing
        them at this layer would force one answer for both.
        """
        ...

    async def save_run(self, run: StoredRun) -> StoredRun:
        """Persist a mutated run. `updated_at` is refreshed on write."""
        ...

    async def get_daily_run(self, owner_sub: str, run_date: str) -> Optional[StoredRun]:
        """This owner's official daily run for that UTC date, if any."""
        ...

    async def list_runs_for_owner(self, owner_sub: str, limit: int = 20) -> list[StoredRun]:
        """Most recently created first."""
        ...

    async def transfer_owner(self, from_sub: str, to_sub: str) -> int:
        """Reassign every run owned by `from_sub` to `to_sub`. Returns the
        number of runs actually moved.

        THIS IS THE HIGHEST-IMPACT HALF OF THE GUEST CLAIM. RUN THE TABLE is
        anonymous-first by design, so the typical run here is owned by a signed
        anon-cookie subject; without this method, signing in permanently
        detached a guest from every run they had played.

        ONE DAILY STILL MEANS ONE DAILY. The partial unique index on
        `(owner_sub, run_type, run_date) WHERE run_type = 'daily'` survives the
        transfer: if the destination account already has its own official daily
        for a date the guest also played, the guest's row cannot move without
        creating a second official daily for that account. Those rows are
        dropped rather than moved, exactly as
        `DailyCompletionRepository.transfer_owner` resolves the same collision
        on `UNIQUE (owner_sub, board_id)` -- first attempt wins, and the count
        returned reports only what really moved. Standard and challenge runs
        are unconstrained and always move.
        """
        ...
