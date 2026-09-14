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
    #: The ranked division ladder's label for this rating
    #: (`services/arena/skill.py`). None while `provisional` -- a rating that is
    #: not yet a measurement does not get a rank name.
    tier: Optional[str] = None


class ArenaTierStep(BaseModel):
    label: str
    min_rating: float


class ArenaPopulationView(BaseModel):
    """Who a mode's board and statistics are computed over. Humans only.

    Two counts because rank and listing answer different questions:
    `rated_population` is every human with a rated match (ranks and percentiles
    are positions in it), `total_rated_players` is the subset with a public
    handle (the rows a board can list). A board showing rank #12 beside ten
    listed names is honest about the two unlisted players ahead.
    """

    #: Humans with a public handle and at least one rated match.
    total_rated_players: int = 0
    #: Every human with at least one rated match, listed or not.
    rated_population: int = 0
    #: Rated humans past the provisional threshold.
    established_players: int = 0
    #: Percentiles are withheld below this rated population.
    percentile_min_population: int = 30
    #: Rated matches before a rating stops being provisional.
    provisional_until: int = 7


class ArenaLeaderboardResponse(BaseModel):
    leaderboard_enabled: bool
    mode: str
    entries: list[ArenaLeaderboardEntry] = Field(default_factory=list)
    #: Paging, over LISTED rows. `total_rated_players` below is the total to
    #: page against.
    limit: int = 50
    offset: int = 0
    population: ArenaPopulationView = Field(default_factory=ArenaPopulationView)
    #: Mirrors `population.total_rated_players` at the top level for clients
    #: that only need the count.
    total_rated_players: int = 0
    tier_version: Optional[str] = None
    tier_ladder: list[ArenaTierStep] = Field(default_factory=list)


class ArenaSkillView(BaseModel):
    """One player's competitive identity in one mode, as they may see it.

    Every "withheld" value carries a reason instead of a silent null, so a
    client can say WHY -- "percentiles appear at 30 rated players" -- rather
    than rendering a blank where a number was expected. Reasons are stable
    strings: `not_rated`, `provisional`, `population_too_small`,
    `ratings_disabled`, `leaderboard_disabled`.
    """

    rated: bool = False
    rating: Optional[float] = None
    rd: Optional[float] = None
    rated_matches: int = 0
    provisional: Optional[bool] = None
    #: Rated matches still needed before the rating is established.
    matches_until_established: Optional[int] = None
    tier: Optional[str] = None
    tier_reason: Optional[str] = None
    #: True when MVP/Legend was earned but is displayed as All-NBA because the
    #: mode's established population is below ranked's high-tier floor.
    tier_capped: bool = False
    next_tier: Optional[str] = None
    next_tier_rating: Optional[float] = None
    #: Global position among every rated human in the mode.
    rank: Optional[int] = None
    rank_reason: Optional[str] = None
    #: False when rated but without a public handle: ranked, not listed.
    listed: bool = False
    handle: Optional[str] = None
    percentile: Optional[float] = None
    percentile_reason: Optional[str] = None
    #: Rated-match record. `matches_with_bots` + `matches_all_human` ==
    #: `rated_matches_counted`: how much of this rating was earned against
    #: calibrated bots rather than people.
    wins: int = 0
    losses: int = 0
    draws: int = 0
    rated_matches_counted: int = 0
    matches_with_bots: int = 0
    matches_all_human: int = 0
    best_rated_score: Optional[float] = None
    population: ArenaPopulationView = Field(default_factory=ArenaPopulationView)
    tier_version: Optional[str] = None


class ArenaAroundMeResponse(BaseModel):
    """`GET /arena/leaderboard/{mode}/around-me` -- the caller and the listed
    players nearest them.

    `status`:
      * `listed`     rated and on the public board under a handle;
      * `unlisted`   rated, counted in every rank, but not shown on the board
                     until a handle is chosen;
      * `not_rated`  no rated match in this mode yet -- `me` carries only the
                     reason, and `above`/`below` are empty.
    """

    leaderboard_enabled: bool
    mode: str
    status: str = "not_rated"
    me: Optional[ArenaSkillView] = None
    #: Listed players ahead of the caller, best first (nearest is LAST).
    above: list[ArenaLeaderboardEntry] = Field(default_factory=list)
    #: Listed players behind the caller, best first (nearest is FIRST).
    below: list[ArenaLeaderboardEntry] = Field(default_factory=list)
    population: ArenaPopulationView = Field(default_factory=ArenaPopulationView)
    total_rated_players: int = 0
    tier_version: Optional[str] = None


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
    #: HOW LONG THE OPEN TURN HAS LEFT, PUBLISHED TO EVERY SEAT.
    #:
    #: `seconds_remaining` above is deliberately narrow: it is populated only
    #: when the open turn is YOURS or belongs to nobody. That is right for a
    #: field a client renders as "your clock", and it is why both game rooms
    #: showed an opponent's turn as a COUNT-UP of elapsed time -- they had no
    #: deadline for a seat that was not theirs, so they timed the wait locally
    #: from the moment they noticed it. The result was a human watching
    #: "Deliberating 1s, 2s, 3s" next to their own counting-DOWN clock, with no
    #: way to tell whether the opponent had eight seconds left or eighty.
    #:
    #: A TURN DEADLINE IS NOT HIDDEN INFORMATION. Whose turn it is, and the
    #: mode's turn length, are both already public; the remaining time is a
    #: fact about a clock, not about a bid, a pick or a card. Nothing a seat
    #: could infer from it is withheld anywhere else, so it is published to
    #: everybody and the count-up timers are gone.
    #:
    #: Kept SEPARATE from `seconds_remaining` rather than widening it, because
    #: "the clock I am on" and "the clock somebody is on" drive different UI and
    #: several surfaces correctly render nothing when the first is null.
    turn_seconds_remaining: Optional[float] = None
    #: THE OPEN TURN'S IDENTITY AND ITS OWN TIMELINE, published to every seat.
    #:
    #: Game-feel reconstruction: a client that animates a phase (the pre-match
    #: intro, the franchise x decade reveal, a turn clock) must render against
    #: the SERVER's timeline, not against a browser timer that started when the
    #: response happened to land. `turn_seq` keys the animation to one exact
    #: turn (a reconnect mid-phase resumes rather than replays), and
    #: `turn_elapsed_seconds` / `turn_total_seconds` say how far into that
    #: phase the server is right now, so two clients that fetched at different
    #: instants still derive the same stage. `turn_seconds_remaining` above is
    #: `total - elapsed` and is kept for the surfaces that already read it.
    turn_seq: Optional[int] = None
    turn_elapsed_seconds: Optional[float] = None
    turn_total_seconds: Optional[float] = None
    #: HOW LONG UNTIL THE BOT ON THE OPEN TURN MAY MOVE, in seconds; None when
    #: the open turn is not a bot's (a human's, nobody's, a seatless beat).
    #:
    #: Bots move lazily: the first authoritative read after their think time
    #: has elapsed is the one that applies the move. A client polling on a
    #: fixed cadence therefore saw a bot's reply up to a whole interval late
    #: on top of the think time, and an auction against an opponent who
    #: answers five seconds after every raise reads as a frozen page. This
    #: lets the room schedule ONE read for the instant the reply is due. Zero
    #: means "due now": the next read will carry the move.
    bot_reply_in_seconds: Optional[float] = None
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
    #: The skill band this entry is currently matched within: the largest
    #: |rating difference| a waiting human may have and still be paired with
    #: you (`matchmaking.rating_band`). Starts at 100 and widens by 100 every
    #: 10 s of YOUR wait. Null while waiting means UNBOUNDED -- the 30 s human
    #: window has lapsed (or you asked to fill now), so any waiting human is
    #: taken and bots fill the rest; `still_seeking_humans` is then false.
    #: Null for `matched` / `not_in_queue`.
    rating_band: Optional[float] = None
    #: Seconds until the band next widens (or becomes unbounded). Null when it
    #: is already unbounded or the caller is not waiting.
    rating_band_widens_in_seconds: Optional[float] = None


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


class PersonalRecordResponse(BaseModel):
    """The caller's OWN record in one mode. Derived from persisted results on
    every read (`services/arena/personal.py`); never another player's."""

    mode: str
    matches_played: int = 0
    rated_matches: int = 0
    wins: int = 0
    podiums: int = 0
    current_win_streak: int = 0
    longest_win_streak: int = 0
    best_score: Optional[float] = None
    bests: dict[str, float] = Field(default_factory=dict)
    #: About the match named by `?match_id=`, when it is one of the caller's.
    match_found: bool = False
    match_score: Optional[float] = None
    match_placement: Optional[int] = None
    previous_best_score: Optional[float] = None
    is_personal_best: bool = False
    streak_after_match: Optional[int] = None
    #: Rating facts are present only while ratings are being written.
    ratings_enabled: bool = False
    rating: Optional[float] = None
    rating_provisional: Optional[bool] = None
    match_rating_change: Optional[float] = None
    #: `matches_played` split by entry path. Only public-queue matches can move
    #: a rating; practice and private rooms never do.
    unrated_matches: int = 0
    practice_matches: int = 0
    private_matches: int = 0
    #: The competitive skill card (tier, rank, percentile-when-meaningful,
    #: rated record and bot composition). None for a local-practice guest, who
    #: cannot enter a rated queue.
    skill: Optional[ArenaSkillView] = None
