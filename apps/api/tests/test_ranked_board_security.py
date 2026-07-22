"""Ranked board assignment and hidden-information tests (spec V.16-20)."""
from __future__ import annotations

import dataclasses

from app.services.ranked.board import (
    board_from_dict,
    board_to_dict,
    generate_ranked_board,
    ranked_board_version_key,
)
from nba_peak.lineup.board import _can_fill_all_roles


def _strip_generated_at(d: dict) -> dict:
    d = dict(d)
    d["metadata"] = {k: v for k, v in d["metadata"].items() if k != "generated_at"}
    return d


def test_both_participants_receive_the_same_immutable_board():
    match_id = "11111111-1111-1111-1111-111111111111"
    board = generate_ranked_board("apex_1y", match_id)
    snapshot = board_to_dict(board)

    # Simulate two independent participants deserializing the same stored snapshot.
    board_a = board_from_dict(snapshot)
    board_b = board_from_dict(snapshot)

    offers_a = [[c.peak_window_id for c in r.offers] for r in board_a.rounds]
    offers_b = [[c.peak_window_id for c in r.offers] for r in board_b.rounds]
    assert offers_a == offers_b
    assert board_a.reframe_branches.keys() == board_b.reframe_branches.keys()


def test_board_is_deterministic_from_match_identity():
    match_id = "22222222-2222-2222-2222-222222222222"
    board1 = generate_ranked_board("prime_3y", match_id)
    board2 = generate_ranked_board("prime_3y", match_id)
    assert _strip_generated_at(board_to_dict(board1)) == _strip_generated_at(board_to_dict(board2))


def test_different_matches_get_different_boards():
    board_a = generate_ranked_board("apex_1y", "33333333-3333-3333-3333-333333333333")
    board_b = generate_ranked_board("apex_1y", "44444444-4444-4444-4444-444444444444")
    assert board_a.seed != board_b.seed
    offers_a = [c.peak_window_id for c in board_a.rounds[0].offers]
    offers_b = [c.peak_window_id for c in board_b.rounds[0].offers]
    assert offers_a != offers_b


def test_get_public_state_never_includes_future_round_offers():
    """The same information-hiding contract Daily/Practice/Challenge boards
    already rely on (app.services.draft.state.get_public_state) applies
    unchanged to ranked boards — current_offers only ever reflects the
    active round, never rounds 2-5 in advance.
    """
    from app.services.ranked.board import create_participant_game_state
    from app.services.draft import state as state_machine

    board = generate_ranked_board("apex_1y", "55555555-5555-5555-5555-555555555555")
    game_state = create_participant_game_state(board, "apex_1y")
    public = state_machine.get_public_state(game_state)

    assert public["current_round"] == 1
    current_offer_ids = {c["peak_window_id"] for c in public["current_offers"]}
    round2_offer_ids = {c.peak_window_id for c in board.rounds[1].offers}
    assert current_offer_ids.isdisjoint(round2_offer_ids)
    assert "rounds" not in public  # no raw board/private structure leaked


def test_ranked_board_passes_feasibility_check():
    board = generate_ranked_board("foundation_5y", "66666666-6666-6666-6666-666666666666")
    rounds_raw = [r.offers for r in board.rounds]
    assert _can_fill_all_roles(rounds_raw) is True


def test_ranked_board_version_key_encodes_ranked_generator_version():
    board = generate_ranked_board("apex_1y", "77777777-7777-7777-7777-777777777777")
    key = ranked_board_version_key(board)
    assert "ranked_board_v1" in key
    assert board.board_id in key


def test_historical_match_survives_default_version_change():
    """Once a board is generated and its snapshot stored, later changes to
    generate_ranked_board's inputs (simulated here by generating a board
    under a *different* match_id, standing in for 'the world changed') never
    alter the already-stored snapshot's content.
    """
    match_id = "88888888-8888-8888-8888-888888888888"
    board = generate_ranked_board("apex_1y", match_id)
    stored_snapshot = board_to_dict(board)

    # "time passes", other boards get generated for unrelated matches...
    generate_ranked_board("apex_1y", "99999999-9999-9999-9999-999999999999")

    # ...the original stored snapshot, when reloaded, is bit-identical.
    reloaded = board_from_dict(stored_snapshot)
    assert board_to_dict(reloaded) == stored_snapshot
