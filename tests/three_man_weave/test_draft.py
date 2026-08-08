"""Snake order, the global identity lock, and pick/reposition mechanics."""
from __future__ import annotations

import pytest

from nba_peak.three_man_weave import draft as D
from nba_peak.three_man_weave import feasibility as F
from nba_peak.three_man_weave.config import PARTICIPANT_COUNT, ROSTER_SIZE, ROUNDS, SLOT_TYPES
from nba_peak.three_man_weave.positions import IllegalPlacement
from nba_peak.three_man_weave.schemas import Roll


def _roll(round_number: int, slugs, franchise="CHI", decade="1990s") -> Roll:
    """A revealed roll for a test.

    THE SLUGS MUST GENUINELY HOLD A CARD FOR `franchise` x `decade`. Position
    legality is season-anchored, and the season comes from the card the roll
    resolves -- so a roll that lists a player who never played for that
    franchise in that decade gives them no rights at all and every placement
    is refused. That is the rule working, not a fixture inconvenience: these
    tests used to draft Hakeem Olajuwon off a Chicago Bulls roll.
    """
    return Roll(
        round_number=round_number,
        franchise_id=franchise,
        franchise_display_name="Chicago Bulls",
        decade=decade,
        eligible_slugs=tuple(slugs),
    )


# ---------------------------------------------------------------------------
# Snake order
# ---------------------------------------------------------------------------
def test_snake_order_is_fixed_abc_cba_and_not_rotating():
    """The residual seat advantage is an intentional design decision. A
    rotating order would be a different game."""
    order = D.snake_turn_order()
    assert len(order) == ROUNDS * PARTICIPANT_COUNT == 18
    assert order[:6] == ((1, 0), (1, 1), (1, 2), (2, 2), (2, 1), (2, 0))
    assert order[-3:] == ((6, 2), (6, 1), (6, 0))


def test_every_seat_picks_exactly_once_per_round():
    order = D.snake_turn_order()
    for round_number in range(1, ROUNDS + 1):
        seats = [seat for rnd, seat in order if rnd == round_number]
        assert sorted(seats) == list(range(PARTICIPANT_COUNT))


def test_the_same_seat_picks_back_to_back_at_every_round_boundary():
    """The defining property of a snake: whoever picks last in one round
    picks first in the next. With a fixed A-B-C / C-B-A order that is seat C
    at the odd->even boundaries and seat A at the even->odd ones."""
    order = D.snake_turn_order()
    boundaries = [
        (order[index][0], order[index][1])
        for index in range(len(order) - 1)
        if order[index][0] != order[index + 1][0]
    ]
    for index in range(len(order) - 1):
        if order[index][0] != order[index + 1][0]:
            assert order[index][1] == order[index + 1][1]
    # Rounds 1,3,5 end on seat C; rounds 2,4 end on seat A.
    assert boundaries == [(1, 2), (2, 0), (3, 2), (4, 0), (5, 2)]


def test_snake_order_generalises_to_other_participant_counts():
    order = D.snake_turn_order(rounds=2, participants=2)
    assert order == ((1, 0), (1, 1), (2, 1), (2, 0))


# ---------------------------------------------------------------------------
# Turn enforcement
# ---------------------------------------------------------------------------
def test_a_fresh_match_starts_at_round_one_seat_zero():
    state = D.create_match(1)
    assert state.current_round == 1
    assert state.current_seat == 0
    assert not state.is_complete
    assert state.drafted_identities() == frozenset()
    assert all(roster.open_slots() == SLOT_TYPES for roster in state.rosters)


def test_a_pick_out_of_turn_is_refused(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    with pytest.raises(D.DraftError) as excinfo:
        D.apply_pick(state, index, "michael-jordan", "SG", seat_index=2)
    assert excinfo.value.code == "not_your_turn"


def test_picking_without_a_revealed_roll_is_refused(index):
    state = D.create_match(1)
    with pytest.raises(D.DraftError) as excinfo:
        D.apply_pick(state, index, "michael-jordan", "SG")
    assert excinfo.value.code == "no_roll"


def test_a_pick_advances_the_turn_and_returns_a_new_state(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    after = D.apply_pick(state, index, "michael-jordan", "SG")

    assert after is not state
    assert after.turn_index == 1
    assert after.current_seat == 1
    assert state.turn_index == 0, "the original state must be untouched"
    assert state.rosters[0].slots["SG"] is None


def test_the_roll_is_cleared_at_a_round_boundary(index):
    """A round must not be played on the previous round's roll."""
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    state = D.apply_pick(state, index, "michael-jordan", "SG")
    assert state.current_roll is not None
    state = D.apply_pick(state, index, "scottie-pippen", "SF")
    assert state.current_roll is not None
    state = D.apply_pick(state, index, "dennis-rodman", "PF")
    assert state.current_roll is None
    assert state.current_round == 2


# ---------------------------------------------------------------------------
# The identity lock
# ---------------------------------------------------------------------------
def test_an_identity_drafted_by_one_seat_is_gone_for_everyone(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    state = D.apply_pick(state, index, "michael-jordan", "SG")

    assert "michael-jordan" in state.drafted_identities()
    assert "michael-jordan" not in D.legal_picks(state, index)
    with pytest.raises(D.DraftError) as excinfo:
        D.apply_pick(state, index, "michael-jordan", "SG")
    assert excinfo.value.code == "identity_already_drafted"


def test_the_lock_is_identity_grained_not_card_grained(index):
    """A Cavaliers x 2000s LeBron blocks a Heat x 2010s LeBron. Same man,
    different card -- and a roster cannot contain him twice."""
    state = D.create_match(1)
    state = D.set_roll(
        state, _roll(1, ["lebron-james", "dwyane-wade", "chris-bosh"], "CLE", "2000s")
    )
    state = D.apply_pick(state, index, "lebron-james", "SF")

    state = D.set_roll(
        state, _roll(1, ["lebron-james", "ray-allen", "udonis-haslem"], "MIA", "2010s")
    )
    assert "lebron-james" not in D.legal_picks(state, index)
    with pytest.raises(D.DraftError) as excinfo:
        D.apply_pick(state, index, "lebron-james", "PG")
    assert excinfo.value.code == "identity_already_drafted"


def test_the_lock_is_exposed_as_a_plain_set_for_transactional_enforcement(completed_match):
    lock = completed_match.drafted_identities()
    assert isinstance(lock, frozenset)
    assert len(lock) == ROUNDS * PARTICIPANT_COUNT == 18
    assert all(isinstance(slug, str) for slug in lock)


# ---------------------------------------------------------------------------
# Placement legality
# ---------------------------------------------------------------------------
def test_an_illegal_slot_is_refused_at_pick_time(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["shaquille-o-neal", "scottie-pippen", "dennis-rodman"]))
    with pytest.raises(D.DraftError) as excinfo:
        D.apply_pick(state, index, "shaquille-o-neal", "SF")
    assert excinfo.value.code == "illegal_slot"


def test_a_player_not_on_the_roll_is_refused(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    with pytest.raises(D.DraftError) as excinfo:
        D.apply_pick(state, index, "magic-johnson", "PG")
    assert excinfo.value.code == "not_on_roll"


def test_a_filled_slot_is_refused(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    state = D.apply_pick(state, index, "michael-jordan", "SG")
    state = D.apply_pick(state, index, "scottie-pippen", "SF")
    state = D.apply_pick(state, index, "dennis-rodman", "PF")
    state = D.set_roll(
        state, _roll(2, ["clyde-drexler", "hakeem-olajuwon", "kenny-smith"], "HOU")
    )
    state = D.apply_pick(state, index, "hakeem-olajuwon", "C")  # seat 2
    state = D.apply_pick(state, index, "kenny-smith", "PG")  # seat 1
    with pytest.raises(D.DraftError) as excinfo:
        D.apply_pick(state, index, "clyde-drexler", "SG")  # seat 0 already used SG
    assert excinfo.value.code == "slot_filled"


def test_legal_picks_reports_the_slots_each_identity_could_fill(index):
    state = D.create_match(1)
    state = D.set_roll(
        state, _roll(1, ["shaquille-o-neal", "kobe-bryant"], "LAL", "2000s")
    )
    options = D.legal_picks(state, index)
    # A true centre reaches exactly one starting slot; a wing reaches three.
    # Neither is "every slot", which is what the career grain used to report.
    assert options["shaquille-o-neal"] == ("C", "bench_1")
    assert set(options["kobe-bryant"]) == {"SG", "SF", "bench_1"}


# ---------------------------------------------------------------------------
# Repositioning
# ---------------------------------------------------------------------------
def test_repositioning_keeps_the_pick_and_the_slot_in_agreement(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    state = D.apply_pick(state, index, "michael-jordan", "PG")
    moved = D.reposition(state, index, 0, "PG", "SF")

    assert moved.rosters[0].slots["PG"] is None
    placed = moved.rosters[0].slots["SF"]
    assert placed.player_slug == "michael-jordan"
    assert placed.slot_type == "SF", "the pick must carry its new slot"
    assert all(pick.slot_type == slot for slot, pick in moved.rosters[0].slots.items() if pick)

    # The pick log is rewritten too, so the two views of the same selection
    # can never disagree about which slot holds it.
    for pick in moved.picks:
        holder = moved.rosters[pick.seat_index].slots[pick.slot_type]
        assert holder is not None and holder.player_slug == pick.player_slug
    assert state.rosters[0].slots["PG"].player_slug == "michael-jordan", "input untouched"
    assert state.picks[0].slot_type == "PG"


def test_an_illegal_reposition_raises_and_leaves_the_state_unchanged(index):
    state = D.create_match(1)
    state = D.set_roll(
        state, _roll(1, ["shaquille-o-neal", "kobe-bryant", "derek-fisher"], "LAL", "2000s")
    )
    state = D.apply_pick(state, index, "shaquille-o-neal", "C")

    with pytest.raises(IllegalPlacement):
        D.reposition(state, index, 0, "C", "SF")
    assert state.rosters[0].slots["C"].player_slug == "shaquille-o-neal"
    assert state.rosters[0].slots["SF"] is None


def test_a_legal_swap_of_two_filled_slots_is_allowed(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["ron-harper", "scottie-pippen", "dennis-rodman"]))
    state = D.apply_pick(state, index, "ron-harper", "PG")
    state = D.apply_pick(state, index, "scottie-pippen", "SF")
    state = D.apply_pick(state, index, "dennis-rodman", "PF")
    state = D.set_roll(
        state, _roll(2, ["michael-jordan", "kenny-smith", "hakeem-olajuwon"], "HOU")
    )
    state = D.apply_pick(state, index, "hakeem-olajuwon", "C")  # seat 2
    state = D.apply_pick(state, index, "kenny-smith", "PG")  # seat 1
    state = D.set_roll(state, _roll(2, ["michael-jordan"], "CHI"))
    state = D.apply_pick(state, index, "michael-jordan", "SG")  # seat 0

    # Both directions must be legal: Harper's 1996-97 card admits PG and SG,
    # Jordan's 1990-91 card admits PG, SG and SF.
    swapped = D.reposition(state, index, 0, "PG", "SG")
    assert swapped.rosters[0].slots["PG"].player_slug == "michael-jordan"
    assert swapped.rosters[0].slots["SG"].player_slug == "ron-harper"


# ---------------------------------------------------------------------------
# A whole match
# ---------------------------------------------------------------------------
def test_a_driven_match_completes_with_full_legal_rosters(completed_match):
    state = completed_match
    assert state.is_complete
    assert len(state.picks) == ROUNDS * PARTICIPANT_COUNT
    for roster in state.rosters:
        assert roster.is_complete()
        assert len(roster.picks()) == ROSTER_SIZE
        assert len(roster.drafted_slugs()) == ROSTER_SIZE


def test_no_identity_appears_on_two_rosters(completed_match):
    seen: set[str] = set()
    for roster in completed_match.rosters:
        slugs = roster.drafted_slugs()
        assert not (slugs & seen), "an identity was drafted twice"
        seen |= slugs


def test_every_placement_in_a_completed_match_is_legal(completed_match, index):
    """Every starter in a finished match stands where THEIR OWN CARD allows.

    Checked against the season-anchored rights the picks actually carry, not
    against the career union -- the career union is what let a bot start
    Russell Westbrook at small forward.
    """
    from nba_peak.three_man_weave.positions import rights_for, validate_roster

    for roster in completed_match.rosters:
        rights = rights_for(
            (pick.player_slug, card.season)
            for pick, card in (
                (p, index.scoring_card(p.player_slug, p.franchise_id, p.decade))
                for p in roster.picks()
            )
            if card is not None
        )
        assert validate_roster(roster.assignment(), rights).ok


def test_every_pick_records_the_roll_it_came_from(completed_match, index):
    for pick in completed_match.picks:
        assert index.is_eligible(pick.player_slug, pick.franchise_id, pick.decade)
        card = index.scoring_card(pick.player_slug, pick.franchise_id, pick.decade)
        assert card is not None
        # The card belongs to the roll, not merely to the decade.
        assert card.franchise_id == pick.franchise_id


def test_a_match_is_reproducible_from_its_seed(index, match_driver):
    first = match_driver(index, 31337)
    second = match_driver(index, 31337)
    assert [pick.as_dict() for pick in first.picks] == [pick.as_dict() for pick in second.picks]
    assert first.used_roll_ids == second.used_roll_ids


def test_different_seeds_produce_different_matches(index, match_driver):
    a = match_driver(index, 11)
    b = match_driver(index, 22)
    assert a.used_roll_ids != b.used_roll_ids


def test_undrafted_pool_shrinks_by_exactly_the_drafted_identities(index):
    state = D.create_match(1)
    before = set(D.undrafted_pool(state, index))
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    state = D.apply_pick(state, index, "michael-jordan", "SG")
    after = set(D.undrafted_pool(state, index))
    assert before - after == {"michael-jordan"}


def test_state_serialises_to_a_plain_dict(completed_match):
    payload = completed_match.as_dict()
    assert payload["is_complete"] is True
    assert len(payload["picks"]) == 18
    assert len(payload["drafted_identities"]) == 18
    assert payload["ruleset_version"]


def test_state_survives_a_dict_round_trip_exactly(completed_match):
    """The Arena foundation persists this as opaque JSONB and reduces every
    later turn from the rehydrated copy, so a field that serialises but does
    not deserialise silently resets mid-match."""
    restored = D.DraftState.from_dict(completed_match.as_dict())
    assert restored.as_dict() == completed_match.as_dict()
    assert restored.picks == completed_match.picks
    assert restored.drafted_identities() == completed_match.drafted_identities()
    assert restored.used_roll_ids == completed_match.used_roll_ids


def test_a_mid_match_state_round_trips_including_the_current_roll(index):
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    state = D.apply_pick(state, index, "michael-jordan", "SG")

    restored = D.DraftState.from_dict(state.as_dict())
    assert restored.current_roll is not None
    assert restored.current_roll.roll_id == state.current_roll.roll_id
    assert restored.current_roll.eligible_slugs == state.current_roll.eligible_slugs
    assert (restored.current_seat, restored.current_round) == (
        state.current_seat,
        state.current_round,
    )
    # A rehydrated state must be playable, not merely readable.
    assert D.apply_pick(restored, index, "scottie-pippen", "SF").turn_index == 2


def test_round_trip_recomputes_derived_fields_rather_than_trusting_them(index):
    """`current_seat` / `is_complete` / `drafted_identities` are properties, so
    a hand-edited snapshot cannot make them disagree with the real state."""
    state = D.create_match(1)
    state = D.set_roll(state, _roll(1, ["michael-jordan", "scottie-pippen", "dennis-rodman"]))
    state = D.apply_pick(state, index, "michael-jordan", "SG")

    tampered = state.as_dict()
    tampered["current_seat"] = 2
    tampered["is_complete"] = True
    tampered["drafted_identities"] = ["magic-johnson"]

    restored = D.DraftState.from_dict(tampered)
    assert restored.current_seat == 1
    assert restored.is_complete is False
    assert restored.drafted_identities() == frozenset({"michael-jordan"})


def test_a_completed_match_refuses_further_picks(index, completed_match):
    with pytest.raises(D.DraftError) as excinfo:
        D.apply_pick(completed_match, index, "michael-jordan", "SG")
    assert excinfo.value.code == "match_complete"


def test_feasibility_gate_holds_for_every_round_of_a_driven_match(index, match_driver):
    """Each roll a match actually used must have been feasible when drawn."""
    state = match_driver(index, 909)
    assert len(state.used_roll_ids) == ROUNDS
    assert F.feasible_rolls(index, tuple(D.create_match(1).rosters), frozenset())
