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


def test_a_candidate_carries_eligibility_and_positions_but_no_score(opening):
    """The pre-pick payload: who they are, why they are legal, where they play.

    NOT what they are worth. The exact score is the answer to the question the
    draft asks, and publishing it turned the candidate list into a leaderboard
    with one correct row.
    """
    public, _private, _legal = mode.project(_match(opening), _seats(), 0)
    candidate = public["current_roll"]["candidates"][0]

    assert candidate["player_name"]
    eligibility = candidate["eligibility"]
    assert eligibility["franchise_id"] == public["current_roll"]["franchise_id"]
    assert eligibility["decade"] == public["current_roll"]["decade"]
    assert eligibility["seasons"], "eligibility must name the seasons that prove it"
    assert all("season" in entry and "via" in entry for entry in eligibility["seasons"])
    assert candidate["positions"], "a drafter reasons about position, so it is published"

    assert "scoring_card" not in candidate
    assert "prime_score" not in eligibility


def test_no_undrafted_candidate_leaks_a_score_through_any_field(opening):
    """The boundary, asserted over the whole payload rather than one key.

    A future field carrying a number that correlates with the score would
    reopen the hole without touching `scoring_card`, so the check is on the
    serialised candidate, recursively.
    """
    public, private, _legal = mode.project(_match(opening), _seats(), 0)
    banned = {"prime_score", "scoring_card", "score", "rank", "prime_index"}

    def walk(node, path="candidate"):
        if isinstance(node, dict):
            for key, value in node.items():
                assert key not in banned, f"{path}.{key} leaks a valuation"
                walk(value, f"{path}.{key}")
        elif isinstance(node, list):
            for item in node:
                walk(item, path)

    for candidate in public["current_roll"]["candidates"]:
        walk(candidate)
    for fit in (private.get("candidate_fits") or {}).values():
        walk(fit, "fit")


def test_the_candidate_list_is_the_whole_eligible_pool_in_roll_order(opening):
    """Every undrafted eligible identity, in the roll's own sorted order.

    Two properties at once: nothing is filtered out for not suiting the asking
    seat's open slots, and the order carries no valuation. Sorted order is
    checked directly because "not sorted by score" is unfalsifiable on its own.
    """
    match = _match(opening)
    roll = opening["current_roll"]
    for seat_index in range(PARTICIPANT_COUNT):
        public, _private, _legal = mode.project(match, _seats(), seat_index)
        slugs = [c["player_slug"] for c in public["current_roll"]["candidates"]]
        assert slugs == sorted(roll["eligible_slugs"]), (
            "the pool must not vary by seat, and must not be score-ordered"
        )


def test_every_candidate_is_classified_for_the_seat_on_the_clock(opening):
    """Three states, and every candidate has exactly one of them."""
    from nba_peak.three_man_weave.arrangement import (
        FITS_AFTER_REARRANGEMENT,
        FITS_NOW,
        NO_LEGAL_ARRANGEMENT,
    )

    seat = opening["current_seat"]
    public, private, _legal = mode.project(_match(opening), _seats(), seat)
    fits = private["candidate_fits"]
    slugs = {c["player_slug"] for c in public["current_roll"]["candidates"]}
    assert set(fits) == slugs, "every candidate is classified, none is dropped"
    for slug, fit in fits.items():
        assert fit["state"] in (FITS_NOW, FITS_AFTER_REARRANGEMENT, NO_LEGAL_ARRANGEMENT)
        if fit["state"] == NO_LEGAL_ARRANGEMENT:
            assert fit["reason"], f"{slug} is disabled without an explanation"
    # An empty roster accepts everyone with a position, so round one is all
    # "fits now" -- asserted so the classifier is not silently returning the
    # same answer for everything.
    assert all(fit["state"] == FITS_NOW for fit in fits.values())


def test_a_placed_pick_reveals_the_traded_card_label(opening):
    """About 5% of scoring cards land on a traded season whose score exists
    only at whole-season aggregate grain. Labelled after the pick, never
    presented as though it were a single-team number."""
    seat = opening["current_seat"]
    slug, slot = _first_legal_pick(opening, seat)
    out = _reduce(
        opening, _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot}, seat_index=seat)
    )
    public, _private, _legal = mode.project(_match(out.snapshot), _seats(), 0)
    card = public["rosters"][seat]["slots"][slot]["scoring_card"]
    assert card["score_source"] in ("exact_team_stint", "exact_season_aggregate")
    assert card["is_multi_team_season"] == (card["score_source"] == "exact_season_aggregate")
    # The team named is the ROLLED franchise's, aggregate or not.
    assert card["team_id"] not in {"2TM", "3TM", "4TM", "5TM", "TOT"}


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
            lineup_score=None,
            mean_season_score=None,
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


def test_result_score_is_the_lineup_quality_index_and_carries_its_status():
    _snapshot, outputs = _play_to_completion()
    for result in outputs[-1].results:
        assert result.detail["score_status"] == "complete"
        assert result.score == pytest.approx(result.detail["lineup_score"], abs=1e-4)
        assert result.detail["formula_version"] == "peak3_v1"
        assert result.detail["tmw_adapter_version"]


def test_no_result_detail_carries_a_projected_record():
    """Part of the ruleset. The 82-0 record projection is calibrated for eight
    cards; this mode plays six, so no record is reported at all rather than one
    that reads as a claim the mode cannot stand behind."""
    _snapshot, outputs = _play_to_completion()
    for result in outputs[-1].results:
        for banned in ("wins", "losses", "expected_wins", "is_perfect_season"):
            assert banned not in result.detail, f"{banned} leaked into a settled result"
        # And the receipt still explains itself, from measured components.
        assert result.detail["fit_components"]
        assert result.detail["decisive_pick"]["lineup_quality_drop"] > 0


def test_the_comparator_is_not_the_mean_of_the_drafted_seasons():
    """`mean_season_score` is reported for reading and is NOT the score.

    Over a full match at least one seat must differ between the two, or the
    comparator change has not actually taken effect.
    """
    _snapshot, outputs = _play_to_completion()
    results = outputs[-1].results
    assert any(
        abs(r.score - r.detail["mean_season_score"]) > 1e-6 for r in results
    ), "every seat's lineup score equalled its mean -- the comparator is still the mean"


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


# ---------------------------------------------------------------------------
# Rearrangement: on the board, and atomically with a pick
# ---------------------------------------------------------------------------


def _fill_seat(snapshot, seat_index, count):
    """Play the draft until `seat_index` holds `count` picks. Returns the state."""
    state = snapshot
    guard = 0
    while guard < ROUNDS * PARTICIPANT_COUNT:
        guard += 1
        roster = state["rosters"][seat_index]
        if sum(1 for slot in roster["slots"].values() if slot) >= count:
            return state
        seat = state["current_seat"]
        slug, slot = _first_legal_pick(state, seat)
        out = _reduce(
            state,
            _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot},
                     seat_index=seat, key=f"fill{guard}"),
        )
        assert out.accepted, out.rejection_message
        state = out.snapshot
    raise AssertionError("could not fill the seat")


def test_a_seat_may_rearrange_its_own_roster_without_consuming_a_turn(opening):
    """Tidying your own lineup takes nothing from anybody: no player leaves the
    board, no other seat's options change, and the clock does not move."""
    from app.services.three_man_weave.mode import COMMAND_REARRANGE

    state = _fill_seat(opening, 0, 2)
    roster = state["rosters"][0]["slots"]
    placed = {slot: pick["player_slug"] for slot, pick in roster.items() if pick}
    assert len(placed) == 2

    # A no-op arrangement is still a legal arrangement, and the cheapest way to
    # assert the command's turn behaviour without needing a legal swap.
    out = _reduce(
        state,
        _command(COMMAND_REARRANGE, {"placements": placed}, seat_index=0, key="rearr"),
    )
    assert out.accepted, out.rejection_message
    # NEITHER resolves nor opens a turn -- the open turn is left exactly as it
    # was, so a seat cannot shorten or steal another seat's clock.
    assert out.resolve_turn is None
    assert out.open_turn is None
    assert out.status is None


def test_a_rearrangement_that_drops_a_player_is_refused(opening):
    from app.services.three_man_weave.mode import COMMAND_REARRANGE

    state = _fill_seat(opening, 0, 2)
    roster = state["rosters"][0]["slots"]
    placed = {slot: pick["player_slug"] for slot, pick in roster.items() if pick}
    partial = dict(list(placed.items())[:1])

    out = _reduce(
        state,
        _command(COMMAND_REARRANGE, {"placements": partial}, seat_index=0, key="drop"),
    )
    assert not out.accepted
    assert out.rejection_code == "roster_mismatch"


def test_a_rearrangement_cannot_smuggle_in_an_undrafted_identity(opening):
    from app.services.three_man_weave.mode import COMMAND_REARRANGE

    state = _fill_seat(opening, 0, 2)
    roster = state["rosters"][0]["slots"]
    placed = {slot: pick["player_slug"] for slot, pick in roster.items() if pick}
    smuggled = dict(placed)
    empty = next(slot for slot, pick in roster.items() if not pick)
    smuggled[empty] = "michael-jordan"

    out = _reduce(
        state,
        _command(COMMAND_REARRANGE, {"placements": smuggled}, seat_index=0, key="smuggle"),
    )
    assert not out.accepted
    assert out.rejection_code == "roster_mismatch"


def test_a_pick_and_its_rearrangement_commit_as_one_command(opening):
    """The atomicity guarantee, asserted rather than argued.

    A candidate who fits only after a rearrangement is drafted with the plan in
    the same payload. There is no ordering in which the draft lands and the
    repositioning does not.
    """
    from nba_peak.three_man_weave import draft as D
    from nba_peak.three_man_weave.arrangement import FITS_AFTER_REARRANGEMENT

    state = opening
    # Play until some seat has a candidate that needs a rearrangement. Round
    # one is always "fits now" for everyone (empty rosters), so this walks.
    for turn in range(ROUNDS * PARTICIPANT_COUNT):
        seat = state["current_seat"]
        if seat is None:
            break
        draft_state = D.DraftState.from_dict(state)
        fits = D.candidate_fits(draft_state, seat)
        needy = [
            (slug, fit)
            for slug, fit in sorted(fits.items())
            if fit.state == FITS_AFTER_REARRANGEMENT
        ]
        if needy:
            slug, fit = needy[0]
            before = {
                s: (p["player_slug"] if p else None)
                for s, p in state["rosters"][seat]["slots"].items()
            }
            out = _reduce(
                state,
                _command(
                    COMMAND_PICK,
                    {"player_slug": slug, "placements": fit.plan},
                    seat_index=seat,
                    key="atomic",
                ),
            )
            assert out.accepted, out.rejection_message
            after = {
                s: (p["player_slug"] if p else None)
                for s, p in out.snapshot["rosters"][seat]["slots"].items()
            }
            # The new player is placed AND at least one existing player moved,
            # in one command.
            assert slug in after.values()
            assert after != {**before, **{k: v for k, v in after.items() if v == slug}}
            moved = [s for s in before if before[s] and before[s] != after[s]]
            assert moved, "the arrangement claimed a move that did not happen"
            return

        slug, slot = _first_legal_pick(state, seat)
        out = _reduce(
            state,
            _command(COMMAND_PICK, {"player_slug": slug, "slot_type": slot},
                     seat_index=seat, key=f"walk{turn}"),
        )
        assert out.accepted
        state = out.snapshot
    pytest.skip("no rearrangement-only candidate arose in this seeded match")


def test_a_pick_whose_arrangement_disagrees_with_its_slot_is_refused(opening):
    from nba_peak.three_man_weave import draft as D

    seat = opening["current_seat"]
    draft_state = D.DraftState.from_dict(opening)
    fits = D.candidate_fits(draft_state, seat)
    slug = sorted(fits)[0]
    landing = fits[slug].direct_slots[0]
    other = next(s for s in ("PG", "SG", "SF", "PF", "C", "bench_1") if s != landing)

    out = _reduce(
        opening,
        _command(
            COMMAND_PICK,
            {"player_slug": slug, "slot_type": other, "placements": {landing: slug}},
            seat_index=seat,
        ),
    )
    assert not out.accepted
    assert out.rejection_code == "arrangement_mismatch"


# ---------------------------------------------------------------------------
# The live edge
# ---------------------------------------------------------------------------


def test_the_live_edge_is_ordinal_and_never_a_total(opening):
    state = _fill_seat(opening, 0, 1)
    public, _private, _legal = mode.project(_match(state), _seats(), 0)
    edge = public["current_edge"]
    assert edge["is_live"] is True
    assert set(edge["seats"]) == {"0", "1", "2"}
    for band in edge["seats"].values():
        assert band in ("leading", "close_behind", "needs_a_response", "level")
    # No number of any kind crosses. A partial total is not on the same scale
    # as the final one and a player shown both would compare them.
    assert not any(isinstance(value, (int, float)) for value in edge["seats"].values())


def test_the_live_edge_compares_seats_at_equal_depth(opening):
    """Mid-round the snake has given one seat an extra pick. Ranking on whole
    rosters would show it "Leading" for having picked more recently."""
    state = _fill_seat(opening, 0, 1)
    public, _private, _legal = mode.project(_match(state), _seats(), 0)
    depth = public["current_edge"]["compared_after_picks"]
    filled = [
        sum(1 for slot in roster["slots"].values() if slot)
        for roster in state["rosters"]
    ]
    assert depth == min(filled)


def test_no_edge_is_published_once_the_match_is_over():
    snapshot, _outputs = _play_to_completion()
    public, _private, _legal = mode.project(_match(snapshot), _seats(), 0)
    assert public["current_edge"]["is_live"] is False


# ---------------------------------------------------------------------------
# Bot pacing and naming
# ---------------------------------------------------------------------------


def test_bot_think_time_is_seeded_inside_the_published_window():
    from nba_peak.three_man_weave.config import (
        BOT_THINK_SECONDS_MAX,
        BOT_THINK_SECONDS_MIN,
        bot_think_seconds,
    )

    seen = set()
    for seed in range(40):
        for seat in range(PARTICIPANT_COUNT):
            for turn in range(3):
                value = bot_think_seconds(seed, seat, turn)
                assert BOT_THINK_SECONDS_MIN <= value <= BOT_THINK_SECONDS_MAX
                seen.add(value)
    # Variable rather than a constant dressed up as a range.
    assert len(seen) > 20
    # And deterministic.
    assert bot_think_seconds(7, 1, 2) == bot_think_seconds(7, 1, 2)


def test_bot_names_are_distinct_thematic_archetypes():
    from nba_peak.three_man_weave.bot import BOT_ARCHETYPE_NAMES, archetype_names

    for seed in range(50):
        names = archetype_names(seed, 2)
        assert len(set(names)) == 2, names
        for name in names:
            assert name in BOT_ARCHETYPE_NAMES
            assert "PEAK3" not in name
            assert not any(char.isdigit() for char in name)
    # Seeded, so a replayed match seats the same opponents.
    assert archetype_names(11, 2) == archetype_names(11, 2)
    assert len({archetype_names(s, 2) for s in range(30)}) > 5


def test_the_human_seat_is_drawn_from_the_seed():
    from nba_peak.three_man_weave.config import human_seat_index

    seen = {human_seat_index(seed) for seed in range(60)}
    assert seen == {0, 1, 2}, f"the human only ever sat at {sorted(seen)}"
    assert human_seat_index(4242) == human_seat_index(4242)
