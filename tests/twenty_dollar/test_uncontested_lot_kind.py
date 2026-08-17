"""Coverage for `lot_kind` and forced-fill -- the PEAK3 Pass 1 fix for the
"$20 Showdown auction becomes a near-free acquisition" defect.

THE FINAL DESIGN, AND WHY IT SUPERSEDES AN EARLIER DRAFT OF THIS FILE. A
normal, live lot is now drawn from the INTERSECTION of every still-incomplete
seat's legal wins (`_intersection_eligible_candidates`), not the union --
"legal for at least one roster" was insufficient exactly as CLAUDE.md's
Pass 1 brief warned, because it let a candidate only one side could ever act
on open as an ordinary bid/raise auction with an opponent structurally unable
to answer. The UNION rule (`_eligible_candidates`) still exists and still
means what it always has: "is ANYTHING left in the pool winnable by anybody"
-- it is what proves genuine pool exhaustion, and it is the candidate pool
`_forced_fill_one` draws from once the intersection empties.

WHY AN AND/INTERSECTION RULE DOES NOT BREAK THE DISJOINT-NEEDS ENDGAME. It
looked like it would: `test_eligibility_prefilter.py::
TestTwoBiddersWithDisjointNeeds` proves the UNION rule is what keeps a
PG-only-vs-C-only endgame alive as ordinary lots. Adopting AND for that same
role would have emptied the market outright. The resolution is that AND is
only the rule for what counts as an ORDINARY lot -- the moment it comes up
empty while something is still winnable by SOMEONE, `_forced_fill_one` (not a
starved, spinning market) settles the one stranded position deterministically
and play resumes. `TestTwoBiddersWithDisjointNeeds` itself needed no changes
(confirmed by running it against this change): it tests `_eligible_candidates`
in isolation, a function this change does not alter. What is new here is
coverage of `_advance_lot`'s actual routing decision, which that file never
exercised.
"""
from __future__ import annotations

from nba_peak.twenty_dollar import state as S
from nba_peak.twenty_dollar.config import (
    FORCED_FILL_PRICE_BY_TIER,
    MIN_OPENING_BID,
    SLOTS,
)
from nba_peak.twenty_dollar.rules import forced_fill_reserve_price

from tests.twenty_dollar.test_eligibility_prefilter import _fill_seat_all_but


def _strand_disjoint_needs(state: dict, pool) -> None:
    """Remove every candidate that could bridge a PG-only vs C-only split.

    THE REAL QUALIFIED POOL IS NOT PURELY SINGLE-POSITION. `career_positions`
    credits a handful of true positionless legends -- LeBron James and Giannis
    Antetokounmpo, as of this artifact -- with all five slots, because they
    genuinely started meaningful minutes at all five across their careers.
    That is correct data, not a defect, and it means the intersection is not
    ALWAYS empty for a disjoint PG/C split -- exactly as it should not be: a
    seat that can still draw a real two-way player has a real second bidder,
    and forced-fill must not fire just because the split is usually hard to
    bridge. Tests that need a PROVABLY empty intersection consume those
    bridging candidates first, the same way `TestPoolExhaustion` consumes a
    whole position's supply -- a deliberate, pathological setup, not a claim
    about ordinary play.
    """
    used = {e["player_slug"] for s in state["seats"] for e in s["roster"]} | set(
        state["offered"]
    )
    spanning = [
        c
        for c in pool.qualified
        if c.player_slug not in used and "PG" in c.positions and "C" in c.positions
    ]
    state["offered"].extend(c.player_slug for c in spanning)


class TestUncontestedLotKind:
    def test_single_remaining_bidder_draws_an_uncontested_lot(self, pool):
        """The exact `TestASingleRemainingBidder` shape: seat 1's roster is
        complete, seat 0 needs only SG. With only one incomplete seat, the
        intersection reduces to that seat's own eligibility -- a normal lot
        still opens, flagged uncontested the instant it does, before either
        seat has acted."""
        state = S.initial_state(seed=101)
        _fill_seat_all_but(state, pool, 0, missing={"SG"})
        _fill_seat_all_but(state, pool, 1, missing=set())
        S._advance_lot(state, pool)

        assert state["current_candidate"] is not None, "test setup drew no lot"
        assert state["lot_kind"] == S.LOT_KIND_UNCONTESTED
        # Exactly one seat is live on it -- the other was pre-passed before
        # its first possible action, which is the fact `lot_kind` records.
        assert state["passed"].count(False) == 1
        assert state["passed"][1] is True

    def test_early_match_full_rosters_open_is_always_standard(self, pool):
        """Both rosters wide open (the ordinary start of a match): every seat
        can act on the very first draw, so the first lot must never read as
        uncontested."""
        state = S.initial_state(seed=103)
        assert state["current_candidate"] is not None
        assert state["passed"].count(False) == len(state["seats"])
        assert state["lot_kind"] == S.LOT_KIND_STANDARD

    def test_uncontested_lot_resolves_and_is_receipted_as_such(self, pool):
        """End to end through the public command surface: the sole eligible
        seat's own bid settles the lot (nobody else can answer it), and the
        settled history row -- what a receipt actually reads -- carries
        `lot_kind: "uncontested"` distinct from `decided_by`."""
        state = S.initial_state(seed=104)
        _fill_seat_all_but(state, pool, 0, missing={"SG"})
        _fill_seat_all_but(state, pool, 1, missing=set())
        S._advance_lot(state, pool)
        assert state["lot_kind"] == S.LOT_KIND_UNCONTESTED

        live_seat = next(i for i, p in enumerate(state["passed"]) if not p)
        assert state["active_seat"] == live_seat
        S.submit_action(state, live_seat, S.COMMAND_BID, MIN_OPENING_BID, pool)

        row = state["history"][-1]
        assert row["lot_kind"] == S.LOT_KIND_UNCONTESTED
        assert row["winner_seat"] == live_seat
        assert row["price"] == MIN_OPENING_BID
        # `decided_by` still reads `pass_out` (nobody was left to answer) --
        # `lot_kind` is the additional, distinct fact a receipt needs to avoid
        # narrating this as a won fight.
        assert row["decided_by"] == S.DECIDED_BY_PASS_OUT

    def test_project_publishes_lot_kind_live_before_resolution(self, pool):
        """The live projection -- what the frontend actually polls -- must
        carry `lot_kind` before either seat has acted, not only after the lot
        settles into history. Without this the client would have to infer
        contestedness itself from counting `seats[].in_lot`, which is exactly
        what the brief asked to avoid."""
        state = S.initial_state(seed=105)
        _fill_seat_all_but(state, pool, 0, missing={"SG"})
        _fill_seat_all_but(state, pool, 1, missing=set())
        S._advance_lot(state, pool)

        public, _private, _commands = S.project(state, 0)
        assert public["lot_kind"] == S.LOT_KIND_UNCONTESTED

    def test_autofill_rows_are_labelled_distinctly_from_uncontested(self, pool):
        """Pool exhaustion / max-lots autofill is a distinct case --
        `LOT_KIND_AUTOFILL` -- and must not be confused with a real (if
        uncontested) live lot, or with forced-fill. `_autofill` is untouched
        by this change; this only locks in that the field is populated
        consistently wherever a history row exists."""
        state = S.initial_state(seed=106)
        state["lot_index"] = state["max_lots"]
        S._autofill(state, pool, reason="max_lots")

        assert state["phase"] == S.PHASE_COMPLETE
        assert state["history"], "autofill produced no history at all"
        for row in state["history"]:
            if row["decided_by"] == S.DECIDED_BY_AUTOFILL:
                assert row["lot_kind"] == S.LOT_KIND_AUTOFILL

    def test_no_infinite_loop_and_pool_exhaustion_path_is_unchanged(self, pool):
        """`_eligible_candidates` (the union) returning empty must still route
        through the existing, already-deterministic
        `_autofill(reason="pool_exhausted")` path -- forced-fill only ever
        triggers when the union is non-empty but the intersection is, so a
        genuinely exhausted pool must never reach it."""
        state = S.initial_state(seed=107)
        state["offered"] = [c.player_slug for c in pool.qualified]
        S._advance_lot(state, pool)
        assert state["phase"] == S.PHASE_COMPLETE
        assert state["autofilled"] is True
        assert all(row.get("autofill_reason") for row in state["history"])


class TestForcedFill:
    """The new endgame state: the intersection is empty (no candidate left
    fits every still-incomplete seat) but the union is not (something is
    still winnable by someone). `_forced_fill_one` settles exactly the one
    stranded position, priced by tier, and resumes the market -- it never
    ends the match outright the way `_autofill` does.
    """

    def test_disjoint_needs_triggers_forced_fill_not_a_normal_lot(self, pool):
        """The `TestTwoBiddersWithDisjointNeeds` shape, driven through
        `_advance_lot` itself (not just the pure `_eligible_candidates`
        helper): seat 0 needs only PG, seat 1 needs only C. No ordinary
        player is both a PG and a C, so the intersection is empty and this
        must resolve as a forced-fill row, never as a lot presented for live
        bidding between the two."""
        state = S.initial_state(seed=201)
        _fill_seat_all_but(state, pool, 0, missing={"PG"})
        _fill_seat_all_but(state, pool, 1, missing={"C"})
        _strand_disjoint_needs(state, pool)
        market_skips_before = [s["market_skips"] for s in state["seats"]]

        S._advance_lot(state, pool)

        # PARKED, NOT YET SETTLED (the phantom-lot-fix pattern) -- a client
        # polling right now must see a real, named candidate as current, with
        # nobody able to act on it, exactly like the "nobody can use this
        # candidate" beat.
        assert S.is_forced_fill_pending(state)
        assert not S.is_unwinnable_lot_pending(state), (
            "a forced-fill park must not also read as the unwinnable beat -- "
            "routing it there would settle it unsold instead of awarding it"
        )
        assert state["current_candidate"] is not None
        assert state["active_seat"] is None
        assert not any(r["decided_by"] == S.DECIDED_BY_FORCED_FILL for r in state["history"]), (
            "must not be committed to history before the beat resolves"
        )
        parked_candidate = state["current_candidate"]

        S.resolve_forced_fill(state, pool)

        forced_rows = [r for r in state["history"] if r["decided_by"] == S.DECIDED_BY_FORCED_FILL]
        assert forced_rows, "disjoint PG-only vs C-only needs must force-fill one of them"
        forced = forced_rows[0]
        assert forced["candidate"]["player_slug"] == parked_candidate, (
            "the committed player must be exactly the one that was parked and observable"
        )
        assert forced["lot_kind"] == S.LOT_KIND_FORCED_FILL
        assert forced["winner_seat"] in (0, 1)
        assert forced["actions"] == []
        # NO MARKET SKIP IS EVER SPENT ON A FORCED-FILL.
        assert [s["market_skips"] for s in state["seats"]] == market_skips_before

    def test_forced_fill_price_is_banded_by_tier_not_a_flat_dollar(self, pool):
        """CHEAP-STAR EXPLOIT GUARD. Strand seat 0 on SG with every SG-eligible
        candidate consumed from the qualified pool except one elite,
        rank-<=100 player, and fully consume every C-eligible candidate (seat
        1's need) so the intersection is provably empty. The forced-fill price
        for that elite player must be the tier-appropriate reserve, not
        `AUTOFILL_PRICE`'s flat $1."""
        state = S.initial_state(seed=202)
        _fill_seat_all_but(state, pool, 0, missing={"SG"})
        _fill_seat_all_but(state, pool, 1, missing={"C"})

        used = {e["player_slug"] for s in state["seats"] for e in s["roster"]} | set(
            state["offered"]
        )
        sg_candidates = sorted(
            (c for c in pool.qualified if c.player_slug not in used and "SG" in c.positions),
            key=lambda c: c.rank,
        )
        elite_sg = next(c for c in sg_candidates if c.rank <= 100)
        consume_sg = [c for c in sg_candidates if c.player_slug != elite_sg.player_slug]
        consume_c = [
            c for c in pool.qualified if c.player_slug not in used and "C" in c.positions
        ]
        state["offered"].extend(c.player_slug for c in consume_sg)
        state["offered"].extend(c.player_slug for c in consume_c)

        S._advance_lot(state, pool)
        assert S.is_forced_fill_pending(state)
        assert state["current_candidate"] == elite_sg.player_slug, (
            "test setup must strand the market on exactly the elite SG"
        )
        S.resolve_forced_fill(state, pool)

        forced_rows = [r for r in state["history"] if r["decided_by"] == S.DECIDED_BY_FORCED_FILL]
        assert forced_rows, "expected the elite SG to be forced-filled to seat 0"
        row = forced_rows[0]
        assert row["candidate"]["player_slug"] == elite_sg.player_slug
        expected_price = forced_fill_reserve_price(elite_sg.rank)
        assert expected_price > MIN_OPENING_BID, (
            "test setup did not actually pick an elite-tier candidate -- "
            f"{elite_sg.rank=} priced at {expected_price}, expected the top "
            f"{FORCED_FILL_PRICE_BY_TIER[0][1]} band"
        )
        assert row["price"] == expected_price
        assert row["winner_seat"] == 0

    def test_forced_fill_price_never_exceeds_the_reserve_ceiling(self, pool):
        """A seat too close to broke for the tier price must still pay the
        legal maximum, never more -- the same reserve discipline an ordinary
        bid is held to, so a forced-fill can never leave a seat unable to
        afford a slot it is still guaranteed to fill later."""
        state = S.initial_state(seed=203)
        _fill_seat_all_but(state, pool, 0, missing={"PG"})
        _fill_seat_all_but(state, pool, 1, missing={"C"})
        _strand_disjoint_needs(state, pool)
        # Force the fairness rotation to land on seat 0 first -- see
        # `_park_forced_fill`'s priority comment -- so this test is not at the
        # mercy of whichever seat the rotation happened to favour.
        state["opening_seat"] = 0
        state["next_opening_seat"] = 1
        # Seat 0 holds just the $1 reserve floor for its one remaining slot --
        # any tier-2/3 price above $1 would be illegal to charge in full.
        state["seats"][0]["budget"] = 1

        S._advance_lot(state, pool)
        assert S.is_forced_fill_pending(state), "test setup must actually reach a forced-fill park"
        S.resolve_forced_fill(state, pool)

        forced_rows = [r for r in state["history"] if r["decided_by"] == S.DECIDED_BY_FORCED_FILL]
        seat0_rows = [r for r in forced_rows if r["winner_seat"] == 0]
        assert seat0_rows, "test setup must strand seat 0 specifically, or this assertion is vacuous"
        for row in seat0_rows:
            assert row["price"] <= 1

    def test_forced_fill_advances_lot_index_and_terminates(self, pool):
        """`lot_index` must still advance -- a forced-fill counts as a turn
        against `HARD_MAX_LOTS`, which is what keeps termination bounded --
        and a full disjoint-needs match must reach `PHASE_COMPLETE` without
        an unbounded number of `_advance_lot`/`resolve_forced_fill` re-entries."""
        state = S.initial_state(seed=204)
        _fill_seat_all_but(state, pool, 0, missing={"PG"})
        _fill_seat_all_but(state, pool, 1, missing={"C"})
        _strand_disjoint_needs(state, pool)
        lot_index_before = state["lot_index"]

        S._advance_lot(state, pool)
        assert S.is_forced_fill_pending(state)
        S.resolve_forced_fill(state, pool)

        forced_rows = [r for r in state["history"] if r["decided_by"] == S.DECIDED_BY_FORCED_FILL]
        assert forced_rows
        assert state["lot_index"] > lot_index_before

        # Drive the rest of the match to completion using only legal moves,
        # bounded by `max_lots` plus a safety margin -- this must never spin.
        # Always PASS when legal (never BID): the goal is to prove the state
        # machine itself terminates under the cheapest possible play, not to
        # model realistic bidding.
        guard = 0
        while state["phase"] != S.PHASE_COMPLETE and guard < state["max_lots"] + 5:
            guard += 1
            active = state["active_seat"]
            if active is None:
                if S.is_forced_fill_pending(state):
                    S.resolve_forced_fill(state, pool)
                    continue
                if S.is_unwinnable_lot_pending(state):
                    S.resolve_unwinnable_lot(state, pool)
                    continue
                break
            commands = S.legal_commands(state, active)
            if S.COMMAND_PASS in commands:
                S.submit_action(state, active, S.COMMAND_PASS, 0, pool)
            else:
                S.submit_action(
                    state, active, S.COMMAND_BID, S.rules.minimum_bid(state["current_bid"]), pool
                )
        assert state["phase"] == S.PHASE_COMPLETE, "match did not terminate"
        assert guard <= state["max_lots"] + 5

    def test_a_genuine_positionless_bridge_keeps_the_market_standard(self, pool):
        """The mirror of `_strand_disjoint_needs`: when a true five-position
        player (LeBron James, in this artifact) is STILL in the pool, they
        really can serve either seat's disjoint need, so the intersection is
        genuinely non-empty and this must stay an ordinary lot -- forced-fill
        firing here would be wrong in the other direction, settling a
        position the market could still have fought over."""
        state = S.initial_state(seed=206)
        _fill_seat_all_but(state, pool, 0, missing={"PG"})
        _fill_seat_all_but(state, pool, 1, missing={"C"})
        # Deliberately do NOT call `_strand_disjoint_needs` -- LeBron and
        # Giannis are left in the pool for this one test.

        S._advance_lot(state, pool)

        assert state["current_candidate"] is not None
        assert state["lot_kind"] == S.LOT_KIND_STANDARD
        assert state["passed"].count(False) == 2, (
            "a genuine positionless bridge must leave both seats live on the lot"
        )
        assert not any(r["decided_by"] == S.DECIDED_BY_FORCED_FILL for r in state["history"])

    def test_single_incomplete_seat_is_never_routed_to_forced_fill(self, pool):
        """Regression lock distinguishing forced-fill from the ordinary
        single-remaining-bidder endgame: with only one seat still incomplete,
        the intersection is that seat's own eligibility (non-empty), so this
        must open as a normal (`uncontested`) lot, never as a forced-fill
        row."""
        state = S.initial_state(seed=205)
        _fill_seat_all_but(state, pool, 0, missing={"SG"})
        _fill_seat_all_but(state, pool, 1, missing=set())

        S._advance_lot(state, pool)

        assert state["current_candidate"] is not None
        assert not any(r["decided_by"] == S.DECIDED_BY_FORCED_FILL for r in state["history"])
