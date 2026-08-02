"""Pydantic request/response models for Head-to-Head RUN THE TABLE.

REQUEST models are the trust boundary and are therefore closed and bounded.
Note what is NOT in any of them: a match id in a body, a run id at submission,
an opponent's subject, or a single result number. Those are all read from the
caller's own participant row instead (`ranked.py:196-203`'s contract), because
a competitive result a client can name is a competitive result a client can
forge.

RESPONSE models declare their top-level keys for OpenAPI value and type the
nested comparison structures as plain dicts, matching
`app/models/run_the_table.py`'s reasoning: `services/head_to_head.py` is their
schema and `apps/web/src/lib/head-to-head-api.ts` is the consumer-side
declaration. `extra="allow"` so an added field flows through rather than being
silently dropped.
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class CreateHeadToHeadRequest(BaseModel):
    """Create a head-to-head from a run the CALLER OWNS.

    `run_id` is checked against the caller's ownership before anything is
    written -- minting a shareable artefact from a stranger's game is exactly
    the S4 IDOR this pass closed on `POST /draft/challenges`
    (`test_ownership_idor.py:304-314`), and it is not being reintroduced here.
    """

    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=1, max_length=128)


class AcceptInviteRequest(BaseModel):
    """Deliberately empty.

    Everything the accept needs -- which match, which seed, which ruleset -- is
    inside the signed invite token in the path. A body field here would be a
    field a client could disagree with the token about.
    """

    model_config = ConfigDict(extra="forbid")


class SubmitResultRequest(BaseModel):
    """Also deliberately empty. See the module docstring."""

    model_config = ConfigDict(extra="forbid")


class RematchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HeadToHeadCreatedResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    match_id: str
    invite_token: str
    invite_url_path: str
    expires_at: str
    seed: int
    versions: dict[str, Any]
    #: The pinned fairness contract, minus nothing -- it is the creator's own
    #: board, so there is no spoiler in showing it to them.
    fairness: dict[str, Any]


class InviteDescriptorResponse(BaseModel):
    """The invite landing page's payload. SPOILER-SAFE BY OMISSION.

    Carries the creator's display name, the match's status and whether the link
    is still playable. It carries no roster, no bosses, no node map, no seed and
    -- above all -- no result, not even the creator's own. `run_the_table.py`'s
    challenge descriptor makes the same call and states the same reason: the
    recipient plays the board, they do not get to read it first.
    """

    model_config = ConfigDict(extra="allow")

    match_id: Optional[str] = None
    creator_display_name: str
    status: str
    playable: bool
    ruleset_version: str
    versions: dict[str, Any]
    expires_at: str
    expired: bool
    #: "creator" | "opponent" | None -- whether the *viewer* is already in it.
    your_role: Optional[str] = None
    #: True once two players are seated, so the page can say "this invite has
    #: already been accepted" rather than failing at the button.
    seats_taken: int = 1


class ParticipantPublic(BaseModel):
    model_config = ConfigDict(extra="allow")

    role: str
    display_name: str
    status: str
    run_id: Optional[str] = None
    result: Optional[dict[str, Any]] = None


class HeadToHeadMatchResponse(BaseModel):
    """Your side of a match, plus a spoiler-safe view of the other side.

    `opponent.result` is None and `opponent.status` is `"hidden"` until BOTH
    sides have submitted -- ranked's pattern (`ranked.py:213-215`). The
    opponent's `run_id` is never included at all: it is a resource id belonging
    to someone else and this feature is shipping into a codebase that just
    closed four IDORs.
    """

    model_config = ConfigDict(extra="allow")

    match_id: str
    status: str
    seed: int
    versions: dict[str, Any]
    created_at: str
    expires_at: str
    expired: bool
    rematch_of: Optional[str] = None
    you: ParticipantPublic
    opponent: Optional[ParticipantPublic] = None
    opponent_status: str
    both_complete: bool
    settlement: Optional[dict[str, Any]] = None


class HeadToHeadReceiptResponse(BaseModel):
    """The side-by-side final receipt. Only served once both sides are in."""

    model_config = ConfigDict(extra="allow")

    match_id: str
    seed: int
    versions: dict[str, Any]
    creator: dict[str, Any]
    opponent: dict[str, Any]
    settlement: dict[str, Any]
    your_role: str
    #: "won" | "lost" | "draw", from the caller's point of view.
    your_outcome: str


class HeadToHeadHistoryEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    match_id: str
    status: str
    created_at: str
    your_role: str
    opponent_display_name: Optional[str] = None
    #: None until the match settles -- history is spoiler-safe too, because a
    #: player with a match still open would otherwise read the answer here.
    your_outcome: Optional[str] = None
    decided_by: Optional[str] = None


class HeadToHeadHistoryResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    matches: list[HeadToHeadHistoryEntry]


class HeadToHeadRulesResponse(BaseModel):
    """`services.head_to_head.published_rules()` verbatim."""

    model_config = ConfigDict(extra="allow")

    rules_version: str
    versions: dict[str, Any]
    winner_order: list[dict[str, Any]]
    credit_efficiency_rule: dict[str, Any]
    active_play_time: dict[str, Any]
    fairness: dict[str, Any]
    daily_attempts: str


ParticipantRole = Literal["creator", "opponent"]
