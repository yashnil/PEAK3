"""THREE-MAN WEAVE as an ArenaMode plug-in.

Tests the ADAPTER, not the rules -- the rules have their own suite in
`tests/three_man_weave/`. What matters here is that the mode satisfies the
foundation's contract exactly, and that `project` never shows a seat a future
franchise x decade roll.
"""
from __future__ import annotations

import os
import subprocess
import sys
import textwrap
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = API_ROOT.parent.parent

from app.repositories.arena_protocols import (
    COMMAND_TYPE_TIMEOUT,
    MATCH_STATUS_ACTIVE,
    MATCH_STATUS_COMPLETED,
    TURN_RESOLUTION_ACTION,
    TURN_RESOLUTION_TIMEOUT,
    ArenaMatch,
    ArenaSeat,
    CommandRequest,
    ReducerInput,
)
from app.services.arena.modes import ArenaMode, ModeRegistry
from app.services.three_man_weave.mode import (
    COMMAND_PICK,
    EVENT_MATCH_SCORED,
    EVENT_PICK_MADE,
    EVENT_ROLL_REVEALED,
    MODE_NAME,
    PHASE_PICK,
    REJECT_NOT_YOUR_TURN,
    REJECT_UNKNOWN_COMMAND,
    REJECT_VERSION_MISMATCH,
    ThreeManWeaveMode,
    mode,
    register,
)

from nba_peak.three_man_weave.config import PARTICIPANT_COUNT, ROSTER_SIZE, ROUNDS, RULESET_VERSION

NOW = datetime(2026, 8, 4, 12, 0, 0, tzinfo=timezone.utc)


def _seats(count: int = PARTICIPANT_COUNT, bot_indexes: tuple[int, ...] = ()) -> tuple[ArenaSeat, ...]:
    return tuple(
        ArenaSeat(
            match_id="m1",
            seat_index=index,
            occupant_kind="bot" if index in bot_indexes else "human",
            occupant_sub=None if index in bot_indexes else f"user-{index}",
            bot_id=f"bot-{index}" if index in bot_indexes else None,
        )
        for index in range(count)
    )


def _match(snapshot: dict, *, seed: int = 4242, state_version: int = 0) -> ArenaMatch:
    return ArenaMatch(
        match_id="m1",
        mode=MODE_NAME,
        mode_version=RULESET_VERSION,
        model_version="peak3_v1",
        seat_count=PARTICIPANT_COUNT,
        entry_path="test",
        rated=True,
        seed=seed,
        created_by="user-0",
        expires_at=NOW + timedelta(hours=1),
        status=MATCH_STATUS_ACTIVE,
        state_version=state_version,
        snapshot=snapshot,
    )


def _command(
    command_type: str,
    payload: dict | None = None,
    *,
    seat_index: int | None = None,
    key: str = "k1",
) -> CommandRequest:
    return CommandRequest(
        match_id="m1",
        idempotency_key=key,
        command_type=command_type,
        payload=payload or {},
        actor_sub=None if seat_index is None else f"user-{seat_index}",
        actor_seat_index=seat_index,
        issued_at=NOW,
    )


def _reduce(snapshot: dict, command: CommandRequest, seats=None, seed: int = 4242):
    return mode.reduce(
        ReducerInput(
            match=_match(snapshot, seed=seed),
            seats=seats or _seats(),
            open_turn=None,
            command=command,
            now=NOW,
        )
    )


@pytest.fixture(scope="module")
def opening() -> dict:
    return mode.initial_snapshot(4242, _seats())


def _first_legal_pick(snapshot: dict, seat_index: int) -> tuple[str, str]:
    _public, private, _legal = mode.project(_match(snapshot), _seats(), seat_index)
    slug, slots = next(iter(private["legal_picks"].items()))
    return slug, slots[0]


def _play_to_completion(seed: int = 4242):
    """Drive a whole match through `reduce`, exactly as the foundation would."""
    snapshot = mode.initial_snapshot(seed, _seats())
    outputs = []
    for turn in range(ROUNDS * PARTICIPANT_COUNT):
        seat = snapshot["current_seat"]
        slug, slot = _first_legal_pick(snapshot, seat)
        out = _reduce(
            snapshot,
            _command(
                COMMAND_PICK,
                {"player_slug": slug, "slot_type": slot},
                seat_index=seat,
                key=f"k{turn}",
            ),
            seed=seed,
        )
        assert out.accepted, (turn, out.rejection_code, out.rejection_message)
        snapshot = out.snapshot
        outputs.append(out)
    return snapshot, outputs


# ---------------------------------------------------------------------------
# The contract
# ---------------------------------------------------------------------------
def test_the_mode_satisfies_the_arena_mode_protocol():
    assert isinstance(mode, ArenaMode)


def test_the_six_contract_members_are_present_and_correctly_typed():
    """Built against the real file, not a summary of it -- `turn_seconds`
    (not `turn_duration`), and `initial_phase` exists."""
    assert mode.mode == "three_man_weave"
    assert mode.mode_version == RULESET_VERSION
    assert mode.seat_count == 3
    assert isinstance(mode.turn_seconds, float) and mode.turn_seconds > 0
    assert mode.initial_phase() == PHASE_PICK
    assert callable(mode.initial_snapshot)
    assert callable(mode.reduce)
    assert callable(mode.project)


def test_the_mode_registers_and_refuses_a_duplicate_name():
    """Registered into an ISOLATED registry, never the process-wide one.

    `tests/test_arena_routes.py:129` calls `mode_registry.clear()`, so a test
    asserting presence in the shared registry passes alone and fails in the
    suite. Import-time registration is covered below instead, in a subprocess
    where no other test can have cleared anything.
    """
    registry = ModeRegistry()
    register(registry)
    assert registry.get(MODE_NAME) is mode
    register(registry)  # same singleton -- idempotent, not a collision
    with pytest.raises(ValueError):
        registry.register(ThreeManWeaveMode())


def test_importing_the_module_registers_it_without_a_database_or_network():
    """The three properties the integration wiring depends on, checked in a
    FRESH interpreter with every database variable stripped from the
    environment.

    A subprocess rather than an in-process assertion for two reasons: it is
    immune to `mode_registry.clear()` elsewhere in the suite, and it is the
    only way to observe a genuinely cold import -- this module is already in
    `sys.modules` by the time any test in this file runs.
    """
    script = textwrap.dedent(
        """
        import time
        start = time.perf_counter()
        import app.services.three_man_weave.mode as tmw
        elapsed = time.perf_counter() - start

        from app.services.arena.modes import registry
        assert registry.has("three_man_weave"), "import did not register the mode"
        assert registry.get("three_man_weave") is tmw.mode

        # Idempotent: registering the same singleton again is a no-op.
        before = registry.names()
        tmw.register()
        assert registry.names() == before

        # The caches are genuinely warm, so no file read happens inside
        # reduce() -- where it would sit under the match row lock.
        from nba_peak.three_man_weave.eligibility import get_index
        from nba_peak.perfect_season import career_positions as cp
        assert get_index.cache_info().currsize == 1, "eligibility index not warmed"
        assert cp._CACHE is not None, "career_positions not warmed"

        print(f"OK {elapsed:.3f}")
        """
    )
    env = {
        key: value
        for key, value in os.environ.items()
        # Strip every database handle: a module that needed one fails here.
        if not ("DATABASE" in key.upper() or "POSTGRES" in key.upper())
    }
    env["PYTHONPATH"] = str(REPO_ROOT)
    completed = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(API_ROOT),
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    assert completed.returncode == 0, completed.stderr
    assert completed.stdout.startswith("OK"), completed.stdout


def test_seat_count_is_three_which_the_foundation_supports_natively():
    assert mode.seat_count == PARTICIPANT_COUNT == 3


# ---------------------------------------------------------------------------
# initial_snapshot
# ---------------------------------------------------------------------------
def test_initial_snapshot_opens_round_one_with_a_roll(opening):
    assert opening["current_round"] == 1
    assert opening["current_seat"] == 0
    assert opening["is_complete"] is False
    assert len(opening["rosters"]) == 3
    assert opening["current_roll"] is not None
    assert opening["current_roll"]["round_number"] == 1
    assert opening["used_roll_ids"] == [opening["current_roll"]["roll_id"]]


def test_initial_snapshot_is_a_pure_function_of_seed_and_seats():
    assert mode.initial_snapshot(99, _seats()) == mode.initial_snapshot(99, _seats())
    assert mode.initial_snapshot(99, _seats()) != mode.initial_snapshot(100, _seats())


def test_initial_snapshot_records_the_versions_it_was_built_under(opening):
    assert opening["ruleset_version"] == RULESET_VERSION
    assert opening["eligibility_index_version"]
    assert opening["formula_version"] == "peak3_v1"


# ---------------------------------------------------------------------------
# project -- the hidden-information boundary
# ---------------------------------------------------------------------------
def _round_numbers_mentioned(blob) -> set[int]:
    """Every `round_number` appearing anywhere in a projection, at any depth."""
    found: set[int] = set()
    if isinstance(blob, dict):
        for key, value in blob.items():
            if key == "round_number" and isinstance(value, int):
                found.add(value)
            found |= _round_numbers_mentioned(value)
    elif isinstance(blob, (list, tuple)):
        for item in blob:
            found |= _round_numbers_mentioned(item)
    return found


def test_no_future_roll_appears_in_any_seats_projection(opening):
    """The core guarantee, checked by walking the projection recursively
    rather than by naming the keys a leak would have to use.

    No `round_number` anywhere in either dict may exceed the round being
    played -- that covers the current roll, every recorded pick, and any
    future nesting a later change might introduce."""
    snapshot = opening
    for _ in range(5):
        current_round = snapshot["current_round"]
        for seat_index in range(PARTICIPANT_COUNT):
            public, private, _legal = mode.project(_match(snapshot), _seats(), seat_index)
            mentioned = _round_numbers_mentioned(public) | _round_numbers_mentioned(private)
            assert mentioned, "sanity: the projection does describe rounds"
            assert max(mentioned) <= current_round, (
                f"seat {seat_index} can see round {max(mentioned)} while playing {current_round}"
            )
            assert public["current_roll"]["round_number"] == current_round
            # Exactly one roll per round played so far, and no more.
            assert len(public["used_roll_ids"]) == current_round
        seat = snapshot["current_seat"]
        slug, slot = _first_legal_pick(snapshot, seat)
        out = _reduce(
            snapshot, _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=seat)
        )
        snapshot = out.snapshot


def test_the_snapshot_itself_contains_no_future_roll(opening):
    """Stronger than a projection filter: there is nothing to leak. A future
    roll depends on live draft state, so it cannot exist yet even in the
    authoritative snapshot."""
    assert set(opening) >= {"current_roll", "used_roll_ids"}
    assert not any(key.startswith("future") or key.startswith("upcoming") for key in opening)
    assert len(opening["used_roll_ids"]) == 1


def test_candidates_carry_eligibility_and_scoring_card_as_two_separate_facts(opening):
    """The surface must show them as two labelled facts, so the payload must
    not collapse them into one. Shaq drafted on a 2000s roll is scored on
    2000-01 rather than his better 1999-00 -- which reads as a bug unless both
    facts are visible and distinguishable."""
    public, _private, _legal = mode.project(_match(opening), _seats(), 0)
    candidate = public["current_roll"]["candidates"][0]

    assert candidate["player_name"]
    eligibility = candidate["eligibility"]
    assert eligibility["franchise_id"] == public["current_roll"]["franchise_id"]
    assert eligibility["decade"] == public["current_roll"]["decade"]
    assert eligibility["seasons"], "eligibility must name the seasons that prove it"
    assert all("season" in entry and "via" in entry for entry in eligibility["seasons"])

    card = candidate["scoring_card"]
    assert card["season"] and card["team_name"] and card["prime_score"] > 0
    assert card["formula_version"] == "peak3_v1"
    # Two distinct claims, kept as two objects.
    assert "prime_score" not in eligibility
    assert "franchise_display_name" not in card


def test_a_traded_scoring_card_is_labelled_rather_than_hidden(opening):
    """About 5% of scoring cards land on a traded season whose score exists
    only at whole-season aggregate grain. Labelled, never presented as though
    it were a single-team number."""
    public, _private, _legal = mode.project(_match(opening), _seats(), 0)
    for candidate in public["current_roll"]["candidates"]:
        card = candidate["scoring_card"]
        assert card["score_source"] in ("exact_team_stint", "exact_season_aggregate")
        assert card["is_multi_team_season"] == (card["score_source"] == "exact_season_aggregate")


def test_candidates_exclude_already_drafted_identities(opening):
    """The identity lock is applied in the projection, so a taken player is
    absent rather than merely marked -- a client cannot offer them by mistake."""
    seat = opening["current_seat"]
    slug, slot = _first_legal_pick(opening, seat)
    out = _reduce(
        opening, _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=seat)
    )
    public, _private, _legal = mode.project(_match(out.snapshot), _seats(), 1)
    assert slug not in {c["player_slug"] for c in public["current_roll"]["candidates"]}
    assert slug in public["drafted_identities"]


def test_placed_picks_carry_the_same_two_facts(opening):
    seat = opening["current_seat"]
    slug, slot = _first_legal_pick(opening, seat)
    out = _reduce(
        opening, _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=seat)
    )
    public, _private, _legal = mode.project(_match(out.snapshot), _seats(), 2)
    placed = public["rosters"][seat]["slots"][slot]
    assert placed["player_slug"] == slug
    assert placed["player_name"]
    assert placed["eligibility"]["seasons"]
    assert placed["scoring_card"]["prime_score"] > 0


def test_legal_commands_are_offered_only_to_the_seat_on_turn(opening):
    on_turn = opening["current_seat"]
    for seat_index in range(PARTICIPANT_COUNT):
        _public, private, legal = mode.project(_match(opening), _seats(), seat_index)
        if seat_index == on_turn:
            assert legal == (COMMAND_PICK,)
            assert private["legal_picks"]
        else:
            assert legal == ()
            assert "legal_picks" not in private


def test_projection_exposes_every_seats_picks_because_a_draft_is_open(opening):
    seat = opening["current_seat"]
    slug, slot = _first_legal_pick(opening, seat)
    out = _reduce(
        opening, _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=seat)
    )
    for viewer in range(PARTICIPANT_COUNT):
        public, _private, _legal = mode.project(_match(out.snapshot), _seats(), viewer)
        assert slug in public["drafted_identities"]


def test_projection_of_an_unreadable_snapshot_degrades_rather_than_raising():
    public, private, legal = mode.project(_match({"nonsense": True}), _seats(), 0)
    assert public == {"error": "unreadable_snapshot"}
    assert private == {} and legal == ()


# ---------------------------------------------------------------------------
# reduce
# ---------------------------------------------------------------------------
def test_a_valid_pick_is_accepted_and_opens_the_next_turn(opening):
    seat = opening["current_seat"]
    slug, slot = _first_legal_pick(opening, seat)
    out = _reduce(
        opening, _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=seat)
    )
    assert out.accepted
    assert out.status == MATCH_STATUS_ACTIVE
    assert out.resolve_turn == TURN_RESOLUTION_ACTION
    assert out.open_turn is not None
    assert out.open_turn.phase == PHASE_PICK
    assert out.open_turn.seat_index == 1
    assert out.open_turn.deadline_at == NOW + timedelta(seconds=mode.turn_seconds)
    assert [event.event_type for event in out.events] == [EVENT_PICK_MADE]


def test_a_pick_out_of_turn_is_rejected_without_advancing_anything(opening):
    slug, slot = _first_legal_pick(opening, 0)
    out = _reduce(
        opening, _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=2)
    )
    assert not out.accepted
    assert out.rejection_code == REJECT_NOT_YOUR_TURN
    assert out.snapshot is None and out.events == () and out.status is None


def test_an_unknown_command_is_rejected(opening):
    out = _reduce(opening, _command("do_a_barrel_roll", seat_index=0))
    assert not out.accepted
    assert out.rejection_code == REJECT_UNKNOWN_COMMAND


def test_a_malformed_payload_is_rejected(opening):
    out = _reduce(opening, _command(COMMAND_PICK, {"player_slug": 42}, seat_index=0))
    assert not out.accepted
    assert out.rejection_code == "bad_payload"


def test_an_illegal_slot_is_rejected_by_the_rules(opening):
    """The adapter defers to the pure package's legality, and surfaces its code."""
    _public, private, _legal = mode.project(_match(opening), _seats(), 0)
    slug = next(iter(private["legal_picks"]))
    illegal = next(
        slot for slot in ("PG", "SG", "SF", "PF", "C") if slot not in private["legal_picks"][slug]
    )
    out = _reduce(
        opening, _command(COMMAND_PICK, {"player_slug": slug, "slot_type": illegal}, seat_index=0)
    )
    assert not out.accepted
    assert out.rejection_code == "illegal_slot"


def test_a_snapshot_from_another_ruleset_is_refused_not_reinterpreted(opening):
    stale = dict(opening)
    stale["ruleset_version"] = "tmw_ruleset_v0"
    out = _reduce(stale, _command(COMMAND_PICK, {"player_slug": "x", "slot_type": "PG"}, seat_index=0))
    assert not out.accepted
    assert out.rejection_code == REJECT_VERSION_MISMATCH


def test_reduce_does_not_mutate_its_input_snapshot(opening):
    import copy

    snapshot = copy.deepcopy(opening)
    before = copy.deepcopy(snapshot)
    seat = snapshot["current_seat"]
    slug, slot = _first_legal_pick(snapshot, seat)
    _reduce(snapshot, _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=seat))
    assert snapshot == before


def test_a_new_round_reveals_a_roll_as_a_public_event(opening):
    snapshot = opening
    events: list[str] = []
    for turn in range(PARTICIPANT_COUNT):
        seat = snapshot["current_seat"]
        slug, slot = _first_legal_pick(snapshot, seat)
        out = _reduce(
            snapshot,
            _command(
                COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=seat, key=f"k{turn}"
            ),
        )
        snapshot = out.snapshot
        events = [event.event_type for event in out.events]
    assert EVENT_ROLL_REVEALED in events
    assert snapshot["current_round"] == 2
    assert snapshot["current_roll"]["round_number"] == 2
    assert len(snapshot["used_roll_ids"]) == 2


# ---------------------------------------------------------------------------
# Timeouts
# ---------------------------------------------------------------------------
def test_a_timeout_commits_the_deterministic_auto_pick(opening):
    out = _reduce(opening, _command(COMMAND_TYPE_TIMEOUT))
    assert out.accepted
    assert out.resolve_turn == TURN_RESOLUTION_TIMEOUT
    assert len(out.snapshot["picks"]) == 1
    again = _reduce(opening, _command(COMMAND_TYPE_TIMEOUT, key="k-other"))
    assert again.snapshot["picks"] == out.snapshot["picks"]


def test_a_timeout_never_skips_a_turn(opening):
    """A skipped pick would leave that seat a slot short and unscoreable."""
    out = _reduce(opening, _command(COMMAND_TYPE_TIMEOUT))
    assert out.snapshot["picks"][0]["seat_index"] == opening["current_seat"]
    assert out.snapshot["current_seat"] != opening["current_seat"]


def test_a_timed_out_pick_is_recorded_as_such_in_its_event(opening):
    out = _reduce(opening, _command(COMMAND_TYPE_TIMEOUT))
    payload = next(e.payload for e in out.events if e.event_type == EVENT_PICK_MADE)
    assert payload["resolution"] == TURN_RESOLUTION_TIMEOUT


# ---------------------------------------------------------------------------
# The unscoreable-roster guard
# ---------------------------------------------------------------------------
def test_settling_an_unscoreable_roster_fails_loudly_instead_of_writing_a_zero(monkeypatch):
    """`arena_match_results.score` is NOT NULL and the row is IMMUTABLE once
    written, so a placeholder 0.0 would be permanent -- ranking last while
    looking deliberate, and uncorrectable.

    Today this is unreachable, because eligibility only ever offers identities
    with a real scored season in the drafted decade. That is exactly why it is
    asserted: if the invariant is ever weakened, it must fail HERE rather than
    mint a permanent placeholder. Raising rolls the match transaction back, so
    nothing partial is written.
    """
    import dataclasses

    from app.services.three_man_weave import mode as tmw_mode

    # Play to the final turn honestly, then break the invariant for the last
    # command only -- so the failure lands at settlement, where the guard is.
    snapshot = mode.initial_snapshot(4242, _seats())
    for turn in range(ROUNDS * PARTICIPANT_COUNT - 1):
        seat = snapshot["current_seat"]
        slug, slot = _first_legal_pick(snapshot, seat)
        out = _reduce(
            snapshot,
            _command(
                COMMAND_PICK,
                {"player_slug": slug, "slot_type": slot},
                seat_index=seat,
                key=f"pre{turn}",
            ),
        )
        assert out.accepted
        snapshot = out.snapshot

    real_evaluate = tmw_mode.evaluate_roster

    def unscoreable(roster, index, board_seed):
        return dataclasses.replace(
            real_evaluate(roster, index, board_seed),
            ranking_score=None,
            lineup_peak_score=None,
            score_status="incomplete",
        )

    monkeypatch.setattr(tmw_mode, "evaluate_roster", unscoreable)

    seat = snapshot["current_seat"]
    slug, slot = _first_legal_pick(snapshot, seat)
    with pytest.raises(tmw_mode.UnscoreableRoster) as excinfo:
        _reduce(
            snapshot,
            _command(
                COMMAND_PICK,
                {"player_slug": slug, "slot_type": slot},
                seat_index=seat,
                key="final",
            ),
        )
    assert "eligibility invariant" in str(excinfo.value)


def test_a_normally_completed_match_never_trips_the_unscoreable_guard():
    """The guard is insurance, not a gate: real play always settles cleanly."""
    _snapshot, outputs = _play_to_completion()
    for settled in outputs[-1].results:
        assert settled.detail["score_status"] == "complete"
        assert settled.score > 0


# ---------------------------------------------------------------------------
# Completion and results
# ---------------------------------------------------------------------------
def test_a_full_match_completes_and_writes_one_result_per_seat():
    snapshot, outputs = _play_to_completion()
    final = outputs[-1]
    assert final.status == MATCH_STATUS_COMPLETED
    assert final.open_turn is None
    assert len(final.results) == PARTICIPANT_COUNT
    assert snapshot["is_complete"] is True
    assert len(snapshot["picks"]) == ROUNDS * PARTICIPANT_COUNT
    for roster in snapshot["rosters"]:
        assert roster["complete"] is True
        assert len([p for p in roster["slots"].values() if p]) == ROSTER_SIZE


def test_results_use_standard_competition_ranking_with_ties_sharing():
    """The convention `arena_match_results.placement` documents: 1/1/1 then 4."""
    _snapshot, outputs = _play_to_completion()
    results = sorted(outputs[-1].results, key=lambda r: r.placement)
    placements_seen = [r.placement for r in results]
    assert placements_seen[0] == 1
    # Placements are 1-based, non-decreasing, and skip by group size.
    expected = []
    position = 1
    for index, result in enumerate(results):
        if index and result.score != results[index - 1].score:
            position = index + 1
        expected.append(position)
    assert placements_seen == expected


def test_result_outcomes_are_within_the_columns_check_vocabulary():
    _snapshot, outputs = _play_to_completion()
    assert {r.outcome for r in outputs[-1].results} <= {"win", "loss", "draw"}
    winners = [r for r in outputs[-1].results if r.placement == 1]
    assert winners
    if len(winners) == 1:
        assert winners[0].outcome == "win"
    else:
        assert all(r.outcome == "draw" for r in winners)


def test_result_score_is_the_ranking_score_and_carries_its_status():
    _snapshot, outputs = _play_to_completion()
    for result in outputs[-1].results:
        assert result.detail["score_status"] == "complete"
        assert result.score == pytest.approx(result.detail["lineup_peak_score"], abs=1e-4)
        assert result.detail["formula_version"] == "peak3_v1"
        assert result.detail["tmw_adapter_version"]


def test_completion_emits_a_public_scored_event():
    _snapshot, outputs = _play_to_completion()
    scored = [e for e in outputs[-1].events if e.event_type == EVENT_MATCH_SCORED]
    assert len(scored) == 1
    assert set(scored[0].payload["placements"]) == {"0", "1", "2"}


def test_a_completed_match_refuses_further_commands():
    snapshot, _outputs = _play_to_completion()
    out = _reduce(snapshot, _command(COMMAND_PICK, {"player_slug": "x", "slot_type": "PG"}, seat_index=0))
    assert not out.accepted
    assert out.rejection_code == "match_complete"


def test_a_whole_match_is_reproducible_from_its_seed():
    first, _ = _play_to_completion(seed=777)
    second, _ = _play_to_completion(seed=777)
    assert first["picks"] == second["picks"]
    assert first["used_roll_ids"] == second["used_roll_ids"]


def test_bot_seats_are_recorded_but_change_no_rule():
    """A bot seat plays through exactly the same reducer as a human."""
    snapshot = mode.initial_snapshot(4242, _seats(bot_indexes=(2,)))
    seat = snapshot["current_seat"]
    slug, slot = _first_legal_pick(snapshot, seat)
    out = _reduce(
        snapshot,
        _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=seat),
        seats=_seats(bot_indexes=(2,)),
    )
    assert out.accepted
