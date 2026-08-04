"""Run lifecycle service for RUN THE TABLE: create, load, apply, save.

The thin seam between the HTTP router and the pure engine. It owns exactly four
things and no game rules whatsoever:

1. WHERE THE SEED COMES FROM. `standard` draws one from `secrets`; `daily`
   derives it from the UTC date (a published pure function, so every player
   gets the same run by construction rather than by synchronisation);
   `challenge` reads it out of an HMAC-signed token. A client-supplied seed is
   honoured only for `standard` -- accepting one for a daily would let a player
   re-roll the shared board.

2. THE BLUEPRINT IS NEVER PERSISTED. It is regenerated from the stored seed on
   every single load (`generate_blueprint`). Storing it would create a second
   copy of the truth that could drift from the first; regenerating it means a
   run's content is *proved* to still follow from its seed every time it is
   opened. `assert_version_compatible` runs immediately after deserialisation,
   so a snapshot written under a different ruleset is refused rather than
   silently reinterpreted -- replaying under changed rules would produce a
   result that never actually happened.

3. OWNERSHIP. `load_run` distinguishes "no such run" from "not yours" so the
   router can answer 404 and 403 separately. Owners are anon-cookie subjects
   far more often than they are signed-in users: RUN THE TABLE needs no account.

4. TRANSLATING ONE HTTP ACTION into one engine `action_*` call. The engine
   decides whether the action is legal; this layer only checks that the fields
   that action *requires* are present, which is a request-shape problem rather
   than a rules problem and so raises a different error type.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from typing import Any, Optional

from app.repositories.run_the_table_protocols import StoredRun
from app.services.run_the_table.public import public_state
from app.services.run_the_table.serialization import state_from_dict, state_to_dict
from nba_peak.run_the_table.cards import CardPool, CardPoolUnavailable, get_pool
from nba_peak.run_the_table.config import (
    CONCLUDED_STATUSES,
    LEGACY_RULESET_VERSION,
    RULESET_VERSION,
    STATUS_ABANDONED,
    version_tuple,
)
from nba_peak.run_the_table.daily import (
    InvalidRunDate,
    daily_run_id,
    daily_seed,
    today_utc_date,
    validate_run_date,
)
from nba_peak.run_the_table.generation import generate_blueprint
from nba_peak.run_the_table.schemas import RunBlueprint, RunState
from nba_peak.run_the_table.state import (
    RunActionError,
    VersionMismatch,
    action_advance,
    action_choose_node,
    action_decline_trade,
    action_draft_buy,
    action_draft_pass,
    action_emergency_recovery,
    action_film_room,
    action_market_refresh,
    action_rest_bank,
    action_resolve_boss,
    action_reveal,
    action_select_system,
    action_trade,
    abandon_run as engine_abandon,
    assert_version_compatible,
    create_run as engine_create_run,
)

# Re-exported so the router imports its whole error vocabulary from one place.
__all__ = [
    "CHALLENGE_RULESET_CLAIM",
    "CardPoolUnavailable",
    "DailyNotRestartable",
    "RestartStateConflict",
    "restart_run",
    "InvalidActionRequest",
    "InvalidRunDate",
    "RunActionError",
    "RunForbidden",
    "RunNotFound",
    "VersionMismatch",
    "apply_action",
    "assert_challenge_playable",
    "card_pool",
    "challenge_claims",
    "challenge_descriptor",
    "challenge_ruleset",
    "create_run",
    "load_run",
    "public_view",
    "resolve_seed",
    "save_run",
]


class RunNotFound(KeyError):
    """No run with that id. -> 404."""


class RunForbidden(PermissionError):
    """The run exists but belongs to a different owner. -> 403.

    Deliberately distinct from RunNotFound. A run id is a server-generated
    opaque token that is never enumerated, so distinguishing the two leaks
    nothing useful, and collapsing them would make "I lost my cookie" and "this
    link is broken" indistinguishable to a player who has hit exactly one of
    them.
    """


class InvalidActionRequest(ValueError):
    """A well-formed action that is missing a field that action needs. -> 422.

    Not a RunActionError: the engine's errors mean "the rules forbid this move"
    (409), while this means "this request never described a move at all".
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def card_pool() -> CardPool:
    """The process-cached eligible card pool.

    Raises CardPoolUnavailable when the committed artifacts are missing, which
    callers surface as a retryable 503 rather than degrading into fabricated
    cards (CLAUDE.md: never replace missing data with fabricated values).
    """
    return get_pool()


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------

def _owner_digest(owner_sub: str) -> str:
    """Short, stable, non-reversible tag for an owner.

    Used only to keep daily run ids distinct per player. Hashed rather than
    embedded because a run id appears in URLs and share text, and an anon
    subject is a credential.
    """
    return hashlib.sha256(owner_sub.encode()).hexdigest()[:12]


def new_run_id(run_type: str, run_date: Optional[str], owner_sub: str) -> str:
    """A run's id.

    Daily ids are DERIVED from (date, owner) rather than random, so the same
    player asking for the same day twice lands on the same id even if the
    repository's uniqueness check were somehow bypassed. Everything else is
    random: nothing about a standard run should be guessable from outside.
    """
    if run_type == "daily" and run_date:
        return f"{daily_run_id(run_date)}-{_owner_digest(owner_sub)}"
    return f"rtt-{uuid.uuid4().hex}"


# ---------------------------------------------------------------------------
# Seed resolution
# ---------------------------------------------------------------------------

def resolve_seed(
    run_type: str,
    seed: Optional[int] = None,
    date: Optional[str] = None,
) -> tuple[int, str, Optional[str]]:
    """Return `(seed, run_type, run_date)` for a new run.

    Raises InvalidRunDate for a malformed, future, or too-old daily date.
    """
    if run_type == "daily":
        run_date = validate_run_date(date or today_utc_date())
        return daily_seed(run_date), "daily", run_date
    if seed is None:
        # 2**31 matches the daily seed's modulus, so both run types draw from
        # the same space and a standard seed is always a legal challenge seed.
        seed = secrets.randbelow(2 ** 31)
    # A non-daily run rarely carries a date, but a challenge token minted from
    # one can. Validated anyway: `run_date` is a real DATE column, so an
    # unvalidated string would fail at the driver rather than at the boundary.
    run_date = validate_run_date(date) if date else None
    return int(seed), run_type, run_date


# ---------------------------------------------------------------------------
# Challenge tokens
# ---------------------------------------------------------------------------
# A challenge token carries the SEED. A seed alone is not a board: the same seed
# produces a completely different run under a different ruleset, because
# `generate_blueprint` is a function of (seed, versions) and v2 changed the
# number of acts, the number of stages, the starting budget and the bosses.
#
# v1 tokens carried no ruleset at all, and `GET /challenges/{token}` answered
# with the SERVER'S CURRENT versions -- so a link minted last week under v1 and
# opened today would confidently report v2 and then hand the recipient a board
# the sender never played. The claim below fixes that at the source: the token
# states which rules it was minted under, and a token whose rules no longer
# exist is refused rather than silently reinterpreted.

CHALLENGE_RULESET_CLAIM = "ruleset"


def challenge_claims(
    seed: int,
    run_type: str,
    date: Optional[str],
    nonce: str,
) -> dict:
    """The payload a challenge token must be signed over.

    The router owns minting (it holds the signing secret and the token `kind`
    constant); this owns the claim SHAPE, so what is signed cannot drift from
    what `challenge_descriptor` reads back. The router adds its own `kind`:

        create_session_token(
            {**run_service.challenge_claims(
                 stored.seed, stored.run_type, stored.run_date,
                 secrets.token_hex(8)),
             "kind": CHALLENGE_TOKEN_KIND},
            settings.SIGNING_SECRET, ttl_seconds=CHALLENGE_TTL_SECONDS,
        )
    """
    return {
        "seed": int(seed),
        "run_type": run_type,
        "date": date,
        CHALLENGE_RULESET_CLAIM: RULESET_VERSION,
        "nonce": nonce,
    }


def challenge_ruleset(payload: dict) -> str:
    """Which ruleset a decoded challenge token was minted under.

    Absent claim => v1. Only v1 predates the field, so the inference is exact,
    not a guess -- and it is what keeps an old link honest instead of having it
    inherit whatever the server is running today.
    """
    return str(payload.get(CHALLENGE_RULESET_CLAIM) or LEGACY_RULESET_VERSION)


def challenge_descriptor(payload: dict) -> dict:
    """Spoiler-safe descriptor for a decoded challenge token.

    `versions` reports the TOKEN's ruleset, not the server's, so the recipient's
    landing page can say "this link was made under an older ruleset" truthfully.
    """
    ruleset = challenge_ruleset(payload)
    versions = dict(version_tuple())
    versions["ruleset_version"] = ruleset
    return {
        "seed": int(payload["seed"]),
        "run_type": payload.get("run_type") or "standard",
        "date": payload.get("date"),
        "versions": versions,
        "ruleset_version": ruleset,
        "playable": ruleset == RULESET_VERSION,
    }


def assert_challenge_playable(payload: dict) -> None:
    """Refuse a token minted under a ruleset this server no longer runs.

    Raises VersionMismatch, which the router already maps to 409 with the
    engine's own human message.
    """
    ruleset = challenge_ruleset(payload)
    if ruleset != RULESET_VERSION:
        raise VersionMismatch(
            saved={**version_tuple(), "ruleset_version": ruleset},
            current=version_tuple(),
            message=(
                f"This challenge link was created under the previous ruleset "
                f"({ruleset}); the rules have since changed to {RULESET_VERSION}, so "
                f"the same seed no longer produces the same board. Ask for a new link."
            ),
        )


# ---------------------------------------------------------------------------
# Create / load / save
# ---------------------------------------------------------------------------

def _stored_from_state(state: RunState, owner_sub: str, run_date: Optional[str]) -> StoredRun:
    versions = state.versions or version_tuple()
    return StoredRun(
        run_id=state.run_id,
        owner_sub=owner_sub,
        seed=state.seed,
        run_type=state.run_type,
        run_date=run_date,
        status=state.status,
        snapshot=state_to_dict(state),
        engine_version=versions["engine_version"],
        ruleset_version=versions["ruleset_version"],
        card_pool_version=versions["card_pool_version"],
    )


async def create_run(
    repo: Any,
    owner_sub: str,
    run_type: str,
    seed: Optional[int] = None,
    date: Optional[str] = None,
    pool: Optional[CardPool] = None,
) -> tuple[StoredRun, RunState, RunBlueprint, bool]:
    """Create (or re-enter) a run.

    Returns `(stored, state, blueprint, created)`. `created` is False when the
    caller already had a daily run for that date, in which case the run already
    in progress is returned untouched -- a daily happens once, and letting a
    reload mint a fresh board would make the shared board meaningless.
    """
    pool = pool or card_pool()
    resolved_seed, resolved_type, run_date = resolve_seed(run_type, seed, date)

    blueprint = generate_blueprint(resolved_seed, resolved_type, run_date, pool)
    run_id = new_run_id(resolved_type, run_date, owner_sub)
    # The pool is required here now, not optional: creating a run LOCKS ACT 1'S
    # BOSS (`state.create_run` -> `ensure_boss_for_act`), which needs cards to
    # build a lineup from.
    state = engine_create_run(blueprint, run_id, owner_sub, pool=pool)

    stored, created = await repo.create_run(_stored_from_state(state, owner_sub, run_date))
    if not created:
        # Re-entering an existing daily: replace the freshly-built state with
        # the persisted one so progress is never discarded.
        state = _rehydrate(stored)
        blueprint = blueprint_for(stored, pool)
    return stored, state, blueprint, created


class DailyNotRestartable(Exception):
    """A daily run may not be abandoned and replaced. -> 409.

    THIS IS THE DAILY CONTRACT, NOT AN INDEX LIMITATION.
    `run_the_table_runs_unique_daily_idx` is a partial UNIQUE on
    (owner_sub, run_type, run_date), and adding `AND status <> 'abandoned'` to
    it would technically let an abandoned daily be replaced. But that would not
    be relaxing a constraint, it would be deleting a rule. "The FIRST attempt is
    the official one" is stated outright in `run_the_table_protocols.py` and in
    the migration header, and it is the only thing that makes one player's daily
    result comparable to another's. If abandoning re-opened the date, a player
    who disliked their board would restart until they liked it, and every daily
    score in the product would quietly become a best-of-N.

    A daily therefore has no "Start New Run". It is not a dead end: the daily
    surface offers a STANDARD run instead -- a new board rather than a re-roll
    of today's -- and the 366-day archive already exists for replaying a date.
    """


class RestartStateConflict(Exception):
    """The run moved on between the client reading it and confirming. -> 409."""


async def restart_run(
    repo: Any,
    run_id: str,
    owner_sub: str,
    pool: Optional[CardPool] = None,
    expected_action_count: Optional[int] = None,
) -> tuple[StoredRun, RunState, RunBlueprint, bool]:
    """Abandon an unfinished run and start a fresh one. Returns the NEW run.

    Ordering is deliberate, and crash-safe in the direction that matters:
    abandon and persist FIRST, then create the successor, then record the link.

    * Interrupted after the abandon, the player has lost the run they chose to
      leave -- their stated intent -- and has no successor yet. The next request
      finds an abandoned run with no `successor_run_id` and creates one, so a
      retry COMPLETES the flow instead of dead-ending.
    * The reverse order would leave a live old run plus an orphan new one, and a
      retry would mint a third.

    IDEMPOTENCY IS `successor_run_id`, not a request key. A second confirm --
    double-click, retry, a refresh that re-fires -- finds the run already
    abandoned WITH a successor recorded and returns that successor untouched.
    That survives a process restart, needs no expiry policy, and cannot drift
    from the thing it protects, because it lives on the row it describes.

    `expected_action_count` is the optimistic-concurrency check: the client
    sends the `action_count` it last rendered, and a mismatch means the run
    advanced in another tab between the dialog opening and the confirmation.
    Refusing there is what stops a stale confirmation from discarding progress
    the player has not seen.
    """
    pool = pool or card_pool()
    stored, state, _blueprint = await load_run(repo, run_id, owner_sub, pool)

    if stored.run_type == "daily":
        raise DailyNotRestartable(
            "Today's daily is a single attempt, so it cannot be restarted. "
            "Start a standard run instead."
        )

    # Already abandoned AND already replaced: hand back the same successor.
    if state.status == STATUS_ABANDONED and state.successor_run_id:
        successor = await repo.get_run(state.successor_run_id)
        if successor is not None and successor.owner_sub == owner_sub:
            return (
                successor,
                _rehydrate(successor),
                blueprint_for(successor, pool),
                False,
            )

    if state.status not in CONCLUDED_STATUSES and state.status != STATUS_ABANDONED:
        if (
            expected_action_count is not None
            and expected_action_count != len(state.action_log)
        ):
            raise RestartStateConflict(
                "This run has moved on since you opened this screen. Reload it "
                "and try again."
            )
        # A CONCLUDED run is never relabelled -- the player earned that result
        # and the receipt that goes with it. Only an unfinished run is abandoned.
        engine_abandon(state)
        await save_run(repo, stored, state)

    new_stored, new_state, new_blueprint, _created = await create_run(
        repo, owner_sub, "standard", None, None, pool
    )

    if state.status == STATUS_ABANDONED and not state.successor_run_id:
        state.successor_run_id = new_stored.run_id
        await save_run(repo, stored, state)

    return new_stored, new_state, new_blueprint, True


def blueprint_for(stored: StoredRun, pool: Optional[CardPool] = None) -> RunBlueprint:
    """Regenerate a run's blueprint from its stored seed. Never read from disk."""
    return generate_blueprint(
        stored.seed, stored.run_type, stored.run_date, pool or card_pool()
    )


def _rehydrate(stored: StoredRun) -> RunState:
    state = state_from_dict(stored.snapshot)
    # Strict on purpose -- see the module docstring. Raises VersionMismatch.
    assert_version_compatible(state.versions)
    return state


async def load_run(
    repo: Any,
    run_id: str,
    owner_sub: str,
    pool: Optional[CardPool] = None,
) -> tuple[StoredRun, RunState, RunBlueprint]:
    """Load a run this owner is allowed to see.

    Raises RunNotFound (404), RunForbidden (403) or VersionMismatch (409).
    """
    stored = await repo.get_run(run_id)
    if stored is None:
        raise RunNotFound(run_id)
    if stored.owner_sub != owner_sub:
        raise RunForbidden(run_id)
    state = _rehydrate(stored)
    return stored, state, blueprint_for(stored, pool or card_pool())


async def save_run(repo: Any, stored: StoredRun, state: RunState) -> StoredRun:
    """Persist a mutated run. Only status and snapshot ever change."""
    stored.status = state.status
    stored.snapshot = state_to_dict(state)
    return await repo.save_run(stored)


def public_view(state: RunState, blueprint: RunBlueprint, pool: CardPool) -> dict:
    """The client payload. Delegates entirely to public.py -- see its docstring."""
    return public_state(state, blueprint, pool)


# ---------------------------------------------------------------------------
# Action dispatch
# ---------------------------------------------------------------------------

def _required(fields: dict, name: str, action_type: str) -> Any:
    value = fields.get(name)
    if value is None:
        raise InvalidActionRequest(
            "missing_field", f"'{action_type}' requires '{name}'."
        )
    return value


def apply_action(
    state: RunState,
    blueprint: RunBlueprint,
    pool: CardPool,
    action_type: str,
    fields: dict,
    idempotency_key: Optional[str] = None,
) -> RunState:
    """Apply one action, mapping `action_type` to the engine function for it.

    `idempotency_key` is handed straight to the engine, which no-ops on a
    repeat. Retrying a request that already landed is therefore safe and leaves
    `action_count` unchanged -- there is no separate replay cache here that
    could disagree with the action log.

    Raises RunActionError (409) for an illegal move and InvalidActionRequest
    (422) for a request that never described a move.
    """
    key = idempotency_key

    if action_type == "select_system":
        return action_select_system(
            state, blueprint, _required(fields, "system_id", action_type),
            idempotency_key=key,
        )
    if action_type == "choose_node":
        # The pool is threaded because choosing a Scout & Prepare node LOCKS
        # that act's boss (it is about to be shown), which needs cards.
        return action_choose_node(
            state, blueprint, _required(fields, "node_id", action_type),
            pool=pool, idempotency_key=key,
        )
    if action_type == "draft_buy":
        return action_draft_buy(
            state, blueprint,
            _required(fields, "card_id", action_type),
            _required(fields, "slot_id", action_type),
            pool=pool,
            use_veteran_minimum=bool(fields.get("use_veteran_minimum", False)),
            idempotency_key=key,
        )
    if action_type == "draft_pass":
        return action_draft_pass(state, blueprint, pool=pool, idempotency_key=key)
    if action_type == "trade":
        return action_trade(
            state, blueprint,
            _required(fields, "outgoing_slot_id", action_type),
            _required(fields, "incoming_card_id", action_type),
            pool=pool,
            idempotency_key=key,
        )
    if action_type == "decline_trade":
        return action_decline_trade(state, blueprint, pool=pool, idempotency_key=key)
    if action_type == "film_room":
        # `lane`, `role` and `card_id` are branch-specific and NOT required
        # here: which one a choice needs is a rules fact the engine owns, and
        # `action_film_room` raises `unknown_lane` / `unknown_role` /
        # `card_not_offered` with the exact reason. Demanding them at this layer
        # would answer 422 "missing field" for what is really a 409 "that is not
        # a legal move", and would hard-code the branch table twice.
        return action_film_room(
            state, blueprint, _required(fields, "choice", action_type),
            lane=fields.get("lane"),
            role=fields.get("role"),
            card_id=fields.get("card_id"),
            pool=pool,
            idempotency_key=key,
        )
    if action_type == "rest_bank":
        return action_rest_bank(
            state, blueprint, _required(fields, "choice", action_type),
            pool=pool, idempotency_key=key,
        )
    if action_type == "market_refresh":
        return action_market_refresh(state, blueprint, pool=pool, idempotency_key=key)
    if action_type == "emergency_recovery":
        return action_emergency_recovery(state, blueprint, idempotency_key=key)
    if action_type == "reveal":
        # `target` defaults to "roster" and `count` to 1 in the request model,
        # so "reveal the next card" is the empty body. An out-of-range target is
        # the engine's `unknown_reveal_target` (409), not a schema error: the
        # legal set is a rules fact.
        return action_reveal(
            state, blueprint,
            target=fields.get("target") or "roster",
            count=int(fields.get("count") or 1),
            idempotency_key=key,
        )
    if action_type == "resolve_boss":
        return action_resolve_boss(state, blueprint, pool=pool, idempotency_key=key)
    if action_type == "advance":
        # Advancing an act locks that act's boss, so the pool is threaded here.
        return action_advance(state, blueprint, pool=pool, idempotency_key=key)

    # Unreachable through the request model's closed Literal; kept so adding an
    # engine action without a mapping here fails loudly instead of 500-ing.
    raise InvalidActionRequest("unknown_action", f"Unknown action '{action_type}'.")
