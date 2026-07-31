"""Pydantic request/response models for RUN THE TABLE.

WHAT THIS FILE IS AND IS NOT RESPONSIBLE FOR

`apps/api/app/services/run_the_table/public.py` is the single source of truth
for the client payload -- `public_state()` decides what a browser may see, and
it already enforces the two rules that matter (no future content, no hidden
numbers). This file must therefore NOT re-state that payload field by field.

Two failure modes to avoid, which is why the response models below are
declared with `extra="allow"`:

1. A restated model with `extra="ignore"` (Pydantic's default) SILENTLY DROPS
   any key `public.py` adds. The engine layer would ship a new field, every
   test in this package would still pass, and the browser would simply never
   receive it. That is the worst kind of contract drift: invisible.
2. A restated model with `extra="forbid"` turns an additive, backwards-
   compatible engine change into a 500 at request time.

So the top-level keys are declared for OpenAPI/documentation value and typed
permissively; anything `public.py` adds flows through untouched. The nested
structures (`starters`, `active_node`, `receipt`, ...) are deliberately typed
as plain dicts: `public.py` is their schema, and the TypeScript contract in
`apps/web/src/types/run-the-table.ts` is their consumer-side declaration.

REQUEST models are the opposite: they are the trust boundary, so they are
closed, explicitly typed, and bounded. Every action field the engine's
`action_*` functions accept is declared here and nowhere else.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# Mirrors nba_peak.run_the_table.config.RUN_TYPES.
RunType = Literal["standard", "daily", "challenge"]

# Mirrors the `action_*` functions in nba_peak.run_the_table.state. Declared as
# a closed Literal on purpose: an action added to the engine without a route
# mapping should fail loudly at the schema boundary rather than 404 at runtime.
ActionType = Literal[
    "select_system",
    "choose_node",
    "draft_buy",
    "draft_pass",
    "trade",
    "decline_trade",
    "film_room",
    "rest_bank",
    "resolve_boss",
    "advance",
]

# Same readiness ladder as COURTBUILDER_READINESS_LEVEL.
ReadinessLevel = Literal["disabled", "internal_dev", "internal_alpha", "public_beta"]

# Bound on every free-form client string. Card ids, slot ids and node ids are
# all short generated tokens; a longer value is never legitimate.
_MAX_ID_LENGTH = 128


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------

class CreateRunRequest(BaseModel):
    """Start a run.

    `seed` is honoured only for `standard`: a daily's seed is a pure function
    of its date (so everyone gets the same run by construction) and a
    challenge's seed comes from the signed token. Accepting a client seed for
    either would let a player re-roll the shared board.
    """

    model_config = ConfigDict(extra="forbid")

    run_type: RunType = "standard"
    seed: Optional[int] = Field(
        default=None,
        ge=0,
        lt=2 ** 31,
        description="standard runs only; ignored for daily/challenge",
    )
    date: Optional[str] = Field(
        default=None,
        max_length=32,
        description="YYYY-MM-DD (UTC); daily runs only, defaults to today",
    )
    challenge_token: Optional[str] = Field(
        default=None,
        max_length=2048,
        description="required for run_type='challenge'",
    )


class RunActionRequest(BaseModel):
    """One action against a run.

    A single closed model rather than ten -- the engine dispatches on
    `action_type` and the route unpacks only the fields that action needs, so
    an extra irrelevant field is inert rather than an error. `extra="forbid"`
    still rejects a field this schema has never heard of.

    `idempotency_key` is passed straight through to the engine, which no-ops on
    a repeat (`nba_peak.run_the_table.state._already_applied`). Retrying a
    request that already landed is therefore safe and leaves `action_count`
    unchanged.
    """

    model_config = ConfigDict(extra="forbid")

    action_type: ActionType
    idempotency_key: Optional[str] = Field(default=None, max_length=_MAX_ID_LENGTH)

    # select_system
    system_id: Optional[str] = Field(default=None, max_length=_MAX_ID_LENGTH)
    # choose_node
    node_id: Optional[str] = Field(default=None, max_length=_MAX_ID_LENGTH)
    # draft_buy
    card_id: Optional[str] = Field(default=None, max_length=_MAX_ID_LENGTH)
    slot_id: Optional[str] = Field(default=None, max_length=_MAX_ID_LENGTH)
    use_veteran_minimum: bool = False
    # trade
    outgoing_slot_id: Optional[str] = Field(default=None, max_length=_MAX_ID_LENGTH)
    incoming_card_id: Optional[str] = Field(default=None, max_length=_MAX_ID_LENGTH)
    # film_room / rest_bank
    choice: Optional[str] = Field(default=None, max_length=_MAX_ID_LENGTH)


# ---------------------------------------------------------------------------
# Responses
# ---------------------------------------------------------------------------

class RunStateResponse(BaseModel):
    """The full client payload -- exactly `public_state()`'s dict.

    See the module docstring for why this is `extra="allow"` and why nested
    values are plain dicts.
    """

    model_config = ConfigDict(extra="allow")

    run_id: str
    seed: int
    run_type: str
    date: Optional[str] = None
    status: str
    act: int
    stage: int
    acts_total: int
    stages_per_act: int
    credits: int
    lives: int
    max_lives: int
    starting_credits: int
    starters: list[dict]
    bench: list[dict]
    systems: list[dict]
    pending_system_offer: Optional[list[dict]] = None
    stage_options: Optional[list[dict]] = None
    active_node: Optional[dict] = None
    next_boss: Optional[dict] = None
    map: list[dict]
    battles: list[dict]
    lane_profile: list[dict]
    roster_total: float
    bench_weight: float
    veteran_minimum_used_this_act: bool
    action_count: int
    receipt: Optional[dict] = None
    versions: dict[str, str]
    created_at: str
    last_action_at: str


class RulesetMetaResponse(BaseModel):
    """`ruleset_meta()`'s dict -- static, cacheable, carries no run state."""

    model_config = ConfigDict(extra="allow")

    versions: dict[str, str]
    lanes: list[dict]
    systems: list[dict]
    boss_rules: list[dict]
    roster: dict
    economy: dict
    battle: dict
    card_pool: dict


class CardPoolStatus(BaseModel):
    """Whether the committed card artifacts are actually loadable right now.

    `available: false` is a real, expected state on a fresh clone (the pool is
    built from generated artifacts -- see CLAUDE.md's data export rules), which
    is precisely why readiness must report it instead of 503-ing: the client
    needs to distinguish "turned off" from "data not built" from "broken".
    """

    available: bool
    duration_years: Optional[int] = None
    card_count: Optional[int] = None
    excluded_count: Optional[int] = None
    prime_score_min: Optional[float] = None
    prime_score_max: Optional[float] = None
    error: Optional[str] = None


class RunTheTableReadinessResponse(BaseModel):
    """Safe diagnostic. NEVER 403s and never requires auth -- this endpoint is
    how the web app decides to fail closed, so gating it behind the same flag
    it reports would make that impossible."""

    enabled: bool
    daily_enabled: bool
    readiness_level: ReadinessLevel
    versions: dict[str, str]
    card_pool: CardPoolStatus


class DailyDescriptorResponse(BaseModel):
    """Today's (or an archive date's) daily descriptor.

    Spoiler-free by construction: the seed is a published pure function of the
    date (`nba_peak.run_the_table.daily`), so revealing it gives away nothing a
    player cannot derive, and it is what makes a challenge link to a daily run
    reproducible.

    `already_played` is None when the caller carries no identity at all -- a
    first-time anonymous visitor with no cookie. It is deliberately not a
    silent `false`: "we do not know" and "we know you have not" are different
    answers and the client shows different things for them.
    """

    date: str
    run_id: str
    seed: int
    ruleset_version: str
    already_played: Optional[bool] = None
    existing_run_id: Optional[str] = None


class ChallengeLinkResponse(BaseModel):
    """A minted challenge link. The token is an HMAC-signed, 7-day payload --
    it carries the seed, never the run's state, so it can be shared before the
    sender has finished."""

    challenge_token: str
    public_url_path: str


class ChallengeDescriptorResponse(BaseModel):
    """What a challenge token resolves to, for the recipient's landing page.

    SPOILER-SAFE BY OMISSION. Seed, run type, date and versions only: no
    roster, no bosses, no offers, no map. The recipient plays the same run the
    sender did; they do not get to read it first.
    """

    seed: int
    run_type: str
    date: Optional[str] = None
    versions: dict[str, str]


def error_detail(message: str, error_code: str) -> dict[str, Any]:
    """The error envelope every Arena router uses (see daily_grid.py)."""
    return {"error_code": error_code, "message": message}
