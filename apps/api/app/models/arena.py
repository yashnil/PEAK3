"""Response and request models for the Arena foundation.

MODE-AGNOSTIC BY CONSTRUCTION. `public_state` and `private_state` are opaque
dicts produced by the mode's own `project`; nothing here declares their shape,
because the moment this module knew what a bid or a pick looked like the
foundation would have stopped being mode-agnostic.

WHAT IS DELIBERATELY ABSENT FROM `ArenaMatchView`: the raw snapshot, the seed,
and any other seat's private state. A route serialising `match.snapshot`
directly would ship every sealed bid to every client, so the snapshot never
appears in a response model at all -- it cannot be leaked by a field that does
not exist. Same reasoning as the head-to-head match view
(`api/v1/head_to_head.py:183-201`, where returning a stored dict verbatim
leaked the opponent's run id).
"""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ArenaLeaderboardEntry(BaseModel):
    """One public leaderboard row.

    WHAT IS DELIBERATELY ABSENT: `owner_sub`. It is a Supabase `auth.uid()` --
    the same value withheld from `profiles` for anon/authenticated by
    20260803120000 -- and a leaderboard row carrying one would be a privacy leak
    dressed as an identifier. `handle` is the only identity that crosses, the
    same rule `SeatPublic` follows. There is no email, no auth provider and no
    Google name anywhere in this model, and none in the query that fills it.

    MATCH COMPOSITION IS ON THE ROW, not a detail view. `matches_with_bots` and
    `matches_all_human` are what let a reader tell a bot-filled rated win from
    an all-human one; a board that reported only the rating would be claiming an
    achievement the player did not necessarily earn against people.
    """

    rank: int
    handle: str
    rating: float
    rd: float
    rated_matches: int
    #: True while the rating is still converging. A rating built from two
    #: matches is not a measurement, and the board says so rather than ranking
    #: it silently beside one built from two hundred.
    provisional: bool
    wins: int
    losses: int
    draws: int
    matches_with_bots: int
    matches_all_human: int
    average_placement: Optional[float] = None
    podium_rate: Optional[float] = None
    #: The mode's own primary comparison value, averaged and best-ever:
    #: Three-Man Weave's lineup rating, the $20 Showdown's roster PEAK3.
    average_score: Optional[float] = None
    best_score: Optional[float] = None
    #: Mode-specific extras keyed by their `detail` name -- `lineup_peak_score`
    #: for the Weave, `budget_remaining` / `peak3_per_dollar` for the Showdown.
    #: A dict rather than named fields so a third mode needs no model change.
    averages: dict[str, float] = Field(default_factory=dict)
    bests: dict[str, float] = Field(default_factory=dict)


class ArenaLeaderboardResponse(BaseModel):
    leaderboard_enabled: bool
    mode: str
    entries: list[ArenaLeaderboardEntry] = Field(default_factory=list)


class ArenaModeInfo(BaseModel):
    """One registered mode, and the seat count that follows from it.

    Exists so seat count has exactly ONE publisher. The lobby carried a
    display-only `seatCountHint` whose own comment said to delete it the moment
    the server published this -- and a client-side copy of a server fact is a
    copy that drifts, whose first symptom would be a lobby showing three seats
    for a two-seat mode. `ArenaMode.seat_count` already knew the number; it
    simply was not on the wire.
    """

    id: str
    seat_count: int


class ArenaReadinessResponse(BaseModel):
    """Always answered, even when the arena is off, so the web app can fail
    closed cleanly rather than guess why it got a 403. Same carve-out RUN THE
    TABLE's /readiness has."""

    readiness_level: str
    arena_enabled: bool
    public_queue_enabled: bool
    bots_enabled: bool
    #: Widened from `list[str]`. Additive in shape but NOT wire-compatible --
    #: each element is now an object. Called out because a client reading
    #: `modes[i]` as a string breaks loudly rather than subtly, which is the
    #: preferable failure and the reason this is not smuggled in as a parallel
    #: field that would leave two lists to keep in step.
    modes: list[ArenaModeInfo] = Field(default_factory=list)


class SeatPublic(BaseModel):
    """One seat as any other seat may see it.

    Carries NO `occupant_sub`. An `auth.uid()` is an identifier for a person and
    showing one player another's is a privacy leak dressed as a label -- the
    rule `head_to_head.py:204-215` already established. `display_name` is the
    only identity that crosses.
    """

    seat_index: int
    display_name: str
    is_bot: bool
    status: str
    # Present only for a bot, and only so a client can say "you are playing a
    # bot rated 1200" rather than hiding it. A human's rating is not here: it is
    # the competition-security pass's to publish or not.
    bot_rating: Optional[float] = None


class ArenaMatchView(BaseModel):
    """One match as ONE seat may see it."""

    match_id: str
    mode: str
    mode_version: str
    model_version: str
    status: str
    # The value a client must echo back as `expected_state_version` on its next
    # command. This is the whole optimistic-concurrency contract from the
    # client's side.
    state_version: int
    seat_count: int
    entry_path: str
    rated: bool
    your_seat_index: Optional[int] = None
    seats: list[SeatPublic] = Field(default_factory=list)
    # Mode-owned projections. Opaque here -- see the module docstring.
    public_state: dict[str, Any] = Field(default_factory=dict)
    private_state: dict[str, Any] = Field(default_factory=dict)
    legal_commands: list[str] = Field(default_factory=list)
    # Whose turn it is, and how long they have. A DURATION rather than an
    # absolute deadline so a client with a skewed clock still counts down
    # correctly; the authoritative instant stays on the server, which is the
    # only place it is ever compared.
    current_turn_seat_index: Optional[int] = None
    seconds_remaining: Optional[float] = None
    #: The open turn's phase, when there is one.
    #:
    #: `seconds_remaining` alone cannot tell a client WHAT is being counted.
    #: A mode may open a turn nobody acts on -- Three-Man Weave's franchise x
    #: decade reveal is one -- and a client that assumed every countdown was a
    #: decision window would render a live pick panel over a ceremony, which is
    #: the exact race this field exists to remove.
    turn_phase: Optional[str] = None
    # The highest event seq this seat may see, so a client can poll
    # /events?after_seq=N without guessing.
    latest_event_seq: int = -1
    room_code: Optional[str] = None


class ArenaEventView(BaseModel):
    """One event this seat is allowed to see. Already filtered by the
    repository query, not by the caller."""

    seq: int
    event_type: str
    actor_seat_index: Optional[int] = None
    payload: dict[str, Any] = Field(default_factory=dict)
    state_version_after: int
    created_at: str


class ArenaEventsResponse(BaseModel):
    match_id: str
    events: list[ArenaEventView] = Field(default_factory=list)
    latest_seq: int = -1


class ArenaResultView(BaseModel):
    seat_index: int
    display_name: str
    placement: int
    score: float
    outcome: str
    was_bot: bool
    detail: dict[str, Any] = Field(default_factory=dict)


class ArenaResultsResponse(BaseModel):
    match_id: str
    mode: str
    rated: bool
    results: list[ArenaResultView] = Field(default_factory=list)


class CreateMatchRequest(BaseModel):
    mode: str = Field(..., min_length=3, max_length=40)


class JoinRoomRequest(BaseModel):
    room_code: str = Field(..., min_length=6, max_length=6)


class SubmitCommandRequest(BaseModel):
    """A mutation.

    All four of the contract's required fields are here or derived: the
    authenticated subject comes from the bearer token (never the body), the
    server timestamp is stamped by the route (never the body), and these two are
    the client's half.
    """

    command_type: str = Field(..., min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)
    # REQUIRED, not optional. An optional idempotency key is a key nobody sends,
    # and a retry without one double-applies a move. The 8-character floor
    # matches the column's own CHECK and rules out a client sending "1".
    idempotency_key: str = Field(..., min_length=8, max_length=128)
    # REQUIRED for the same reason: a client that may omit it is a client that
    # never sends it, and the optimistic-concurrency check silently becomes a
    # no-op for everyone. A caller genuinely willing to clobber can read the
    # current version first and send that, which is at least explicit.
    expected_state_version: int = Field(..., ge=0)


class SubmitCommandResponse(BaseModel):
    accepted: bool
    # True when this key had already been recorded and NOTHING was applied. A
    # client must not count a replay as a fresh acceptance.
    replayed: bool
    rejection_code: Optional[str] = None
    message: Optional[str] = None
    match: ArenaMatchView


class QueueStatusResponse(BaseModel):
    status: str  # 'not_in_queue' | 'waiting' | 'matched'
    mode: str
    match_id: Optional[str] = None
    waited_seconds: Optional[float] = None
    # Whether the matchmaker is still holding out for humans. Surfaced so the UI
    # can say "looking for players..." and then "adding a bot opponent" honestly,
    # rather than a spinner that means nothing.
    still_seeking_humans: Optional[bool] = None


class MatchSummary(BaseModel):
    match_id: str
    mode: str
    status: str
    rated: bool
    entry_path: str
    seat_count: int
    created_at: str


class MatchHistoryResponse(BaseModel):
    matches: list[MatchSummary] = Field(default_factory=list)
