"""Blueprint generation: determinism, variation, roster legality, node feasibility.

The sweeps here run over >= 300 seeds. Blueprint generation is ~0.6 ms against
the process-cached pool, so the whole module stays under a couple of seconds.
"""
from __future__ import annotations

import dataclasses
from collections import Counter

import pytest

from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_SLOTS,
    DRAFT_GUARANTEED_AFFORDABLE_COST,
    NODE_CHOICES_PER_STAGE,
    NODE_TYPES,
    OFFERS_PER_DRAFT,
    OFFERS_PER_TRADE,
    PRICE_BASE,
    ROLES,
    STAGES_PER_ACT,
    STARTER_SLOTS,
    START_ROSTER_PERCENTILE_BAND,
    STARTING_CREDITS,
    SYSTEM_CHOICES_OFFERED,
    SYSTEM_IDS,
    version_tuple,
)
from nba_peak.run_the_table.generation import (
    generate_blueprint,
    generate_starting_roster,
    generate_system_offers,
    node_option,
    offer_prices,
    stage_for,
)

SWEEP = 320


class TestBlueprintDeterminism:
    def test_same_seed_produces_a_deeply_identical_blueprint(self, pool):
        for seed in (0, 1, 7, 4242, 2 ** 20 + 3):
            a = generate_blueprint(seed, pool=pool)
            b = generate_blueprint(seed, pool=pool)
            assert a is not b
            assert dataclasses.asdict(a) == dataclasses.asdict(b)
            assert repr(a) == repr(b)

    def test_same_seed_produces_identical_offers_down_to_ordering(self, pool):
        a = generate_blueprint(99, pool=pool)
        b = generate_blueprint(99, pool=pool)
        for sa, sb in zip(a.stages, b.stages):
            assert sa.payloads == sb.payloads
            assert [o.node_id for o in sa.options] == [o.node_id for o in sb.options]
            assert [o.node_type for o in sa.options] == [o.node_type for o in sb.options]

    def test_system_offers_are_a_pure_function_of_the_seed(self):
        for seed in (0, 3, 500, 123456):
            assert generate_system_offers(seed) == generate_system_offers(seed)

    def test_starting_roster_is_a_pure_function_of_seed_and_pool(self, pool):
        for seed in (0, 11, 909):
            assert generate_starting_roster(pool, seed) == generate_starting_roster(pool, seed)

    def test_blueprint_stamps_the_full_version_tuple(self, pool):
        bp = generate_blueprint(5, pool=pool)
        for key, value in version_tuple().items():
            assert bp.metadata[key] == value
        assert bp.metadata["generation_algorithm"] == "rtt_gen_v1"
        assert bp.metadata["card_pool_size"] == len(pool)

    def test_different_seeds_create_meaningful_variation(self, blueprints):
        rosters = [blueprints(s).starting_starters for s in range(SWEEP)]
        distinct = len(set(rosters))
        assert distinct >= int(0.98 * SWEEP), (
            f"only {distinct}/{SWEEP} distinct starting fives — generation is degenerate"
        )

    def test_different_seeds_vary_the_draft_boards_too(self, blueprints):
        boards = set()
        for seed in range(SWEEP):
            bp = blueprints(seed)
            for plan in bp.stages:
                for opt in plan.options:
                    if opt.node_type == "draft_room":
                        boards.add(tuple(plan.payloads[opt.node_id]["offer_ids"]))
        assert len(boards) >= 500, f"only {len(boards)} distinct draft boards across {SWEEP} seeds"

    def test_seeds_differ_in_node_type_layout(self, blueprints):
        layouts = {
            tuple(o.node_type for plan in blueprints(s).stages for o in plan.options)
            for s in range(SWEEP)
        }
        assert len(layouts) >= 50


class TestStartingRoster:
    def test_roster_is_role_legal_duplicate_free_and_in_band_over_many_seeds(
        self, pool, blueprints
    ):
        lo, hi = START_ROSTER_PERCENTILE_BAND
        for seed in range(SWEEP):
            bp = blueprints(seed)
            starters, bench = bp.starting_starters, bp.starting_bench

            assert len(starters) == STARTER_SLOTS == len(ROLES)
            assert len(bench) == BENCH_SLOTS

            # role-legal, in ROLES order
            for role, card_id in zip(ROLES, starters):
                card = pool.get(card_id)
                assert card.is_eligible_for(role), (
                    f"seed {seed}: {card.player_name} cannot play {role}"
                )

            # duplicate-free by identity, not just by window id
            all_ids = list(starters) + list(bench)
            slugs = [pool.get(cid).player_slug for cid in all_ids]
            assert len(set(slugs)) == len(slugs), f"seed {seed}: duplicate player {slugs}"
            assert len(set(all_ids)) == len(all_ids)

            # drawn from the configured percentile band
            for cid in all_ids:
                pct = pool.get(cid).overall_percentile
                assert lo <= pct <= hi, f"seed {seed}: {cid} at percentile {pct} is outside band"

    def test_roster_never_contains_a_card_outside_the_pool(self, pool, blueprints):
        for seed in range(SWEEP):
            bp = blueprints(seed)
            for cid in list(bp.starting_starters) + list(bp.starting_bench):
                assert pool.has(cid)

    def test_the_band_is_wide_enough_to_actually_vary_the_roster(self, pool):
        lo, hi = START_ROSTER_PERCENTILE_BAND
        band = pool.by_percentile_band(lo, hi)
        assert len(band) > len(ROLES) + BENCH_SLOTS
        for role in ROLES:
            assert any(role in c.eligible_roles for c in band), (
                f"no card in the starting band can play {role}"
            )


class TestNodeGeneration:
    def test_every_stage_offers_two_distinct_node_types(self, blueprints):
        for seed in range(SWEEP):
            bp = blueprints(seed)
            assert len(bp.stages) == ACTS * STAGES_PER_ACT
            for plan in bp.stages:
                assert len(plan.options) == NODE_CHOICES_PER_STAGE
                types = [o.node_type for o in plan.options]
                assert len(set(types)) == NODE_CHOICES_PER_STAGE, (
                    f"seed {seed} act{plan.act} stage{plan.stage}: identical doors {types}"
                )
                assert all(t in NODE_TYPES for t in types)
                assert set(types) != {"rest_bank", "film_room"}, (
                    "two low-agency options must never be paired"
                )

    def test_first_stage_always_offers_a_draft_room(self, blueprints):
        for seed in range(SWEEP):
            plan = stage_for(blueprints(seed), 1, 1)
            assert "draft_room" in [o.node_type for o in plan.options]

    def test_node_ids_are_unique_and_positionally_encoded(self, blueprints):
        for seed in range(0, SWEEP, 7):
            bp = blueprints(seed)
            ids = [o.node_id for plan in bp.stages for o in plan.options]
            assert len(set(ids)) == len(ids)
            for plan in bp.stages:
                for idx, opt in enumerate(plan.options):
                    assert opt.node_id == f"a{plan.act}s{plan.stage}o{idx}"
                    found_plan, found_opt = node_option(bp, opt.node_id)
                    assert found_plan is plan and found_opt is opt

    def test_the_affordability_guarantee_is_not_vacuous(self, pool):
        """The bound must be reachable AND binding.

        The bug this replaces: `_draft_offers` filtered at `STARTING_CREDITS`
        (40) while `PRICE_MAX` is 30, so the "affordable" filter accepted the
        entire pool and the guaranteed anchor was an unconstrained random draw.
        A guarantee no card can fail is not a guarantee.
        """
        assert DRAFT_GUARANTEED_AFFORDABLE_COST >= PRICE_BASE, (
            "the guarantee must be satisfiable by the cheapest card that exists"
        )
        assert DRAFT_GUARANTEED_AFFORDABLE_COST < STARTING_CREDITS
        eligible = [c for c in pool.cards if c.base_cost <= DRAFT_GUARANTEED_AFFORDABLE_COST]
        excluded = len(pool) - len(eligible)
        assert eligible, "no card in the pool can satisfy the guarantee"
        assert excluded > 0, (
            f"every card in the pool costs <= {DRAFT_GUARANTEED_AFFORDABLE_COST}, so the "
            f"filter is the identity and the guarantee is vacuous"
        )
        # Wide enough that the anchor is still a real draw rather than the same
        # handful of cards on every board in the game.
        assert len(eligible) >= 20

    def test_every_draft_room_has_an_affordable_card_and_a_legal_pass(self, pool, blueprints):
        checked = 0
        for seed in range(SWEEP):
            bp = blueprints(seed)
            for plan in bp.stages:
                for opt in plan.options:
                    if opt.node_type != "draft_room":
                        continue
                    checked += 1
                    offers = plan.payloads[opt.node_id]["offer_ids"]
                    assert len(offers) == OFFERS_PER_DRAFT
                    costs = [pool.get(cid).base_cost for cid in offers]
                    # The real guarantee: a player who has spent every credit
                    # they had still has a move here, not merely a player who
                    # has spent nothing.
                    assert min(costs) <= DRAFT_GUARANTEED_AFFORDABLE_COST, (
                        f"seed {seed} node {opt.node_id}: cheapest offer costs {min(costs)}, "
                        f"above the guaranteed {DRAFT_GUARANTEED_AFFORDABLE_COST}"
                    )
                    # `draft_pass` takes no arguments and has no precondition
                    # beyond the node being a Draft Room, so it is always legal.
                    assert opt.node_type == "draft_room"
        assert checked >= SWEEP, f"only {checked} draft rooms sampled"

    def test_the_guarantee_never_flattens_the_board_into_three_cheap_cards(
        self, pool, blueprints
    ):
        """Slot 0 is capped; slots 1-2 are still free draws, so a Draft Room
        must keep offering something aspirational to save for. A board that was
        always three cheap cards would remove the decision the node exists for.
        """
        boards = 0
        with_expensive = 0
        for seed in range(SWEEP):
            for plan in blueprints(seed).stages:
                for opt in plan.options:
                    if opt.node_type != "draft_room":
                        continue
                    boards += 1
                    costs = [
                        pool.get(cid).base_cost
                        for cid in plan.payloads[opt.node_id]["offer_ids"]
                    ]
                    if max(costs) > DRAFT_GUARANTEED_AFFORDABLE_COST:
                        with_expensive += 1
        assert boards > 0
        assert with_expensive / boards >= 0.5, (
            f"only {with_expensive}/{boards} Draft Rooms offer a card above the "
            f"guaranteed floor — the anchor has swallowed the board"
        )

    def test_draft_and_trade_offers_are_duplicate_free(self, pool, blueprints):
        for seed in range(SWEEP):
            bp = blueprints(seed)
            for plan in bp.stages:
                for opt in plan.options:
                    key = {"draft_room": "offer_ids", "trade_desk": "incoming_ids"}.get(
                        opt.node_type
                    )
                    if key is None:
                        continue
                    ids = plan.payloads[opt.node_id][key]
                    slugs = [pool.get(cid).player_slug for cid in ids]
                    assert len(set(slugs)) == len(slugs), (
                        f"seed {seed} node {opt.node_id}: duplicate identity in offers"
                    )

    def test_trade_desks_offer_the_configured_number_of_incoming_cards(self, blueprints):
        for seed in range(SWEEP):
            bp = blueprints(seed)
            for plan in bp.stages:
                for opt in plan.options:
                    if opt.node_type == "trade_desk":
                        assert len(plan.payloads[opt.node_id]["incoming_ids"]) == OFFERS_PER_TRADE

    def test_offers_never_include_a_card_already_on_the_starting_roster(
        self, pool, blueprints
    ):
        for seed in range(SWEEP):
            bp = blueprints(seed)
            owned = {
                pool.get(cid).player_slug
                for cid in list(bp.starting_starters) + list(bp.starting_bench)
            }
            for plan in bp.stages:
                for opt in plan.options:
                    key = {"draft_room": "offer_ids", "trade_desk": "incoming_ids"}.get(
                        opt.node_type
                    )
                    if key is None:
                        continue
                    for cid in plan.payloads[opt.node_id][key]:
                        assert pool.get(cid).player_slug not in owned, (
                            f"seed {seed}: offered {cid}, already on the roster"
                        )

    def test_rest_nodes_publish_their_credit_amount_and_scout_nodes_publish_none(
        self, pool, blueprints
    ):
        """v3: Scout & Prepare pays nothing, so its payload carries no `credits`
        key at all rather than a zero. A zeroed field would let a client keep
        advertising income that no longer exists."""
        from nba_peak.run_the_table.config import RESERVE_CHOICES_OFFERED, REST_CREDITS

        for seed in range(0, SWEEP, 5):
            bp = blueprints(seed)
            owned = {
                pool.get(cid).player_slug
                for cid in list(bp.starting_starters) + list(bp.starting_bench)
            }
            for plan in bp.stages:
                for opt in plan.options:
                    if opt.node_type == "film_room":
                        payload = plan.payloads[opt.node_id]
                        assert set(payload) == {"reserve_candidate_ids"}
                        ids = payload["reserve_candidate_ids"]
                        assert len(ids) == RESERVE_CHOICES_OFFERED
                        slugs = [pool.get(cid).player_slug for cid in ids]
                        assert len(set(slugs)) == len(slugs)
                        assert not (set(slugs) & owned)
                    elif opt.node_type == "rest_bank":
                        assert plan.payloads[opt.node_id] == {"credits": REST_CREDITS}

    def test_the_reserve_candidates_are_a_pure_function_of_the_seed(self, pool):
        for seed in (0, 4, 91, 4242):
            a = generate_blueprint(seed, pool=pool)
            b = generate_blueprint(seed, pool=pool)
            for pa, pb in zip(a.stages, b.stages):
                assert pa.payloads == pb.payloads

    def test_all_four_node_types_actually_appear_across_the_sweep(self, blueprints):
        seen = Counter(
            o.node_type
            for seed in range(SWEEP)
            for plan in blueprints(seed).stages
            for o in plan.options
        )
        assert set(seen) == set(NODE_TYPES), f"unreachable node types: {set(NODE_TYPES) - set(seen)}"
        for node_type in NODE_TYPES:
            assert seen[node_type] > 100


class TestSystemOffers:
    def test_each_offer_is_three_distinct_known_systems(self, blueprints):
        for seed in range(SWEEP):
            bp = blueprints(seed)
            assert len(bp.system_offers) == 2
            for offer in bp.system_offers:
                assert len(offer) == SYSTEM_CHOICES_OFFERED
                assert len(set(offer)) == SYSTEM_CHOICES_OFFERED
                assert set(offer) <= set(SYSTEM_IDS)

    def test_the_second_offer_always_leaves_a_legal_choice(self, blueprints):
        """Three offered, at most one already held, so >= 2 always remain."""
        for seed in range(SWEEP):
            first, second = blueprints(seed).system_offers
            for held in first:
                remaining = [s for s in second if s != held]
                assert len(remaining) >= SYSTEM_CHOICES_OFFERED - 1

    def test_every_system_is_reachable_across_the_sweep(self, blueprints):
        offered = Counter(
            sid for seed in range(SWEEP) for offer in blueprints(seed).system_offers for sid in offer
        )
        assert set(offered) == set(SYSTEM_IDS), (
            f"unreachable systems: {set(SYSTEM_IDS) - set(offered)}"
        )
        for sid in SYSTEM_IDS:
            assert offered[sid] > 100


class TestOfferPricing:
    def test_offer_prices_match_price_for(self, pool, blueprints):
        from nba_peak.run_the_table.pricing import price_for

        bp = blueprints(3)
        for plan in bp.stages:
            for opt in plan.options:
                if opt.node_type != "draft_room":
                    continue
                ids = plan.payloads[opt.node_id]["offer_ids"]
                rows = offer_prices(pool, ids, ["moneyball"])
                assert [r["card_id"] for r in rows] == ids
                for row in rows:
                    cost, mods = price_for(pool.get(row["card_id"]), ["moneyball"])
                    assert row["cost"] == cost
                    assert row["modifiers"] == mods


class TestLookupErrors:
    def test_unknown_stage_raises(self, blueprints):
        with pytest.raises(KeyError):
            stage_for(blueprints(1), 9, 9)

    def test_unknown_node_id_raises(self, blueprints):
        with pytest.raises(KeyError):
            node_option(blueprints(1), "nope")
