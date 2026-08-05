"""Boss lineups for RUN THE TABLE.

Five named opponents, each assembled at run time from canonical exact 3-year
prime windows in the committed card pool, calibrated against the roster that
will actually face them.

WHAT CHANGED IN v4, AND WHY
---------------------------
v3 shipped five CURATED lineups: fixed card ids written into this file, the
same five opponents for every player, every seed and every day. Two defects
followed from that, and neither was fixable inside the curated model.

1. DUPLICATE IDENTITY. Because the boss slate was fixed and the player's
   starting roster was drawn from a percentile band that overlaps it, the same
   player could be dealt to both sides. Fourteen of the thirty-five curated
   boss identities sat inside ``START_ROSTER_PERCENTILE_BAND``; measured over
   2,000 seeds, 88.5% of runs began with a boss's own card on the player's
   roster and 13.8% shared an identity with the FINAL boss. The reported case
   -- Joakim Noah anchoring both the player's roster and The Long Series -- is
   seed 23. ``generate_blueprint`` computed the boss slugs and then discarded
   them; there was nothing to subtract them from, because the roster was drawn
   before the bosses were known and the bosses could not move.

2. RAW-TIER DIFFICULTY. A fixed slate cannot be fair to a roster it has never
   seen. Measured over 100,000 seeds x 8 policies, act 1 was won 97-99% of the
   time by every competent policy and act 5 was won 0.2-35% of the time.

v4 inverts the dependency. The starting roster is still drawn from the seed
FIRST; each boss is then generated to face it, excluding every identity the run
owns. The collision is therefore impossible by construction rather than
prevented by a filter that has to be remembered, and difficulty is expressed as
a delta on the roster's own authoritative lineup rating.

Honesty note
------------
These are **not** reconstructions of real NBA teams, and they never were. Each
card is that player's own career-best 3-year window, frequently from a
different franchise and era than any theme would suggest. The bosses are named
for the statistical identity their RULE creates, not for a historical roster,
and the lineups behind those names are generated -- ``Opponent.source`` says
``"generated"`` and the API publishes it, so the UI can state plainly that the
slate is seed-and-roster derived rather than implying a live opponent or a
scouted real team.

Determinism
-----------
A boss is a pure function of ``(seed, act, the roster it faces, the systems in
play, the identities already excluded)``. It is generated once, when its act
begins, and then PERSISTED on the run state (``RunState.boss_lineups``), so a
refresh, a reload and a replay all serve the lineup that was actually locked
rather than re-deriving one against a roster that has since changed.
"""
from __future__ import annotations

import random
import statistics
from typing import Optional, Sequence

from nba_peak.run_the_table.cards import CardPool
from nba_peak.run_the_table.config import (
    ACTS,
    BENCH_SLOTS,
    BOSS_ELITE_OVERFLOW_PENALTY,
    BOSS_ELITE_PERCENTILE,
    BOSS_MAX_ELITE_CARDS,
    BOSS_ROSTER_ANCHOR,
    BOSS_ROSTER_TRACKING,
    BOSS_RULES,
    BOSS_SEARCH_ATTEMPTS,
    BOSS_TARGET_JITTER,
    BOSS_TARGET_TOLERANCE,
    BOSS_WEIGHT_DIVERSITY,
    BOSS_WEIGHT_RULE_EXPRESSION,
    BOSS_WEIGHT_TARGET,
    boss_combined_target,
    LANE_FIELDS,
    LANE_LABELS,
    LANE_PEAK3_WEIGHTS,
    LANE_ROUNDING,
    ROLES,
    SCOUT_PREP_LANE_BONUS,
    STARTER_WEIGHT,
)
from nba_peak.run_the_table.schemas import Opponent, RunCard


class BossGenerationError(RuntimeError):
    """A boss could not be built from the pool. Always a bug, never a state."""


# ---------------------------------------------------------------------------
# The five acts
# ---------------------------------------------------------------------------
# Identity, copy and RULE only -- no card ids. The rule is the boss: it is what
# the lineup is built to express, what the scout report explains, and what the
# published difficulty offset corrects for. Names and taglines are unchanged
# from v3 so the presentation a player already knows is preserved.
BOSS_SPECS: tuple[dict, ...] = (
    {
        "boss_id": "the_wall",
        "name": "The Wall",
        "tagline": "Five two-way profiles with almost no hardware. They win on impact, not on votes.",
        "act": 1,
        "rule_id": "the_wall",
    },
    {
        "boss_id": "strength_in_numbers",
        "name": "Strength in Numbers",
        "tagline": "No superstar, no weak link. Every lane is covered by somebody.",
        "act": 2,
        "rule_id": "strength_in_numbers",
    },
    {
        "boss_id": "the_ceiling",
        "name": "The Ceiling",
        "tagline": "The highest-rated five you can face. Your bench will not save you.",
        "act": 3,
        "rule_id": "top_heavy",
    },
    {
        "boss_id": "the_standard",
        "name": "The Standard",
        "tagline": "Close is not good enough here. Beat them by a clear margin in three "
                   "lanes or the lane goes to nobody.",
        "act": 4,
        "rule_id": "the_standard",
    },
    {
        "boss_id": "the_long_series",
        "name": "The Long Series",
        "tagline": "No exploitable lane and no cheap three-lane win. Beat them across "
                   "the board or beat them on total margin.",
        "act": 5,
        "rule_id": "the_long_series",
    },
)

BOSS_SPEC_BY_ACT: dict[int, dict] = {spec["act"]: spec for spec in BOSS_SPECS}


def boss_spec_for_act(act: int) -> dict:
    try:
        return BOSS_SPEC_BY_ACT[act]
    except KeyError:
        raise BossGenerationError(
            f"No boss is defined for act {act}; this run has {ACTS}."
        )


# ---------------------------------------------------------------------------
# Rule expression
# ---------------------------------------------------------------------------
# Each boss must EXPRESS its rule rather than merely carry it as a label, and
# the only honest way to score that is against the lane profile of the roster
# it is being built for -- "expresses the wall" is a statement about a matchup,
# not about a lineup in isolation.
#
# Every function below returns a NORMALISED value in roughly [-1, 1], higher
# being a better fit, and they are combined at BOSS_WEIGHT_RULE_EXPRESSION --
# a tenth of the difficulty weight, so the whole rule term is worth at most
# about 0.1 rating points of difficulty miss. It shapes WHICH lineup at a given
# difficulty is chosen; it cannot move the difficulty.
#
# THE NORMALISATION IS LOAD-BEARING, not tidiness. The first implementation
# returned raw lane-index quantities, so the bench-depth term for
# `strength_in_numbers` could reach ~30 while a difficulty miss of 1.0 cost only
# 10 -- the search happily bought 0.75 rating points of extra difficulty to buy
# a deeper bench, and act 2 landed +0.75 off its target while every other act
# was within 0.15. Dividing by each term's natural range is what keeps the
# weights meaning what they say.
_WALL_SCALE = 20.0        # mean per-lane gap, lane-index points
_BENCH_SCALE = 30.0       # bench-minus-starter lane mean, lane-index points
_LANE_GAP_SCALE = 20.0    # single-lane advantage, lane-index points


def _card_lane_mean(card: RunCard) -> float:
    return statistics.mean(card.lane_index[lane] for lane in LANE_FIELDS)


def _express_the_wall(boss: dict[str, float], player: dict[str, float]) -> float:
    """A lane you have not really won is nobody's -- so make many lanes close.

    The rule draws any lane won by 1.50 or less. A boss that expresses it is
    one whose profile TRACKS the player's, so the band actually fires; a boss
    that happens to be 10 points clear everywhere carries the rule without ever
    triggering it (which is precisely the v1 defect this rule replaced).
    """
    gap = sum(abs(boss[lane] - player[lane]) for lane in LANE_FIELDS) / len(LANE_FIELDS)
    return -min(1.0, gap / _WALL_SCALE)


def _express_bench_depth(starters: list[RunCard], bench: list[RunCard]) -> float:
    """Bench weight is 0.65 for both teams -- so bring a bench worth counting.

    Rewards a bench close to (or above) the starters. A top-heavy lineup under
    this rule is handing the player the advantage the rule creates.
    """
    s = statistics.mean(_card_lane_mean(c) for c in starters)
    b = statistics.mean(_card_lane_mean(c) for c in bench)
    return max(-1.0, min(1.0, (b - s) / _BENCH_SCALE))


def _express_top_heavy(starters: list[RunCard], bench: list[RunCard]) -> float:
    """Bench weight is 0.15 for both teams -- so put everything in the five.

    The exact inverse of Strength in Numbers, and the reason the two rules feel
    different rather than merely reading differently.
    """
    return -_express_bench_depth(starters, bench)


def _express_the_standard(boss: dict[str, float], player: dict[str, float]) -> float:
    """A lane is only taken if won by more than 4.00 -- so leave no soft lane.

    Scores the player's BEST lane advantage, negated: the fewer lanes the
    player can clear the 4.00 band in, the better this boss expresses its rule.
    """
    worst = max(player[lane] - boss[lane] for lane in LANE_FIELDS)
    return -max(-1.0, min(1.0, worst / _LANE_GAP_SCALE))


def _express_the_long_series(boss: dict[str, float], player: dict[str, float]) -> float:
    """Four of five lanes, else total margin -- so concede nothing cheaply.

    Rewards raising the boss's WORST lane relative to the player. A lineup with
    one throwaway lane hands the player a quarter of the four it now needs.
    """
    floor = min(boss[lane] - player[lane] for lane in LANE_FIELDS)
    return max(-1.0, min(1.0, floor / _LANE_GAP_SCALE))


def _rule_expression(
    rule_id: Optional[str],
    boss_profile: dict[str, float],
    player_profile: dict[str, float],
    starters: list[RunCard],
    bench: list[RunCard],
) -> float:
    if rule_id == "the_wall":
        return _express_the_wall(boss_profile, player_profile)
    if rule_id == "strength_in_numbers":
        return _express_bench_depth(starters, bench)
    if rule_id == "top_heavy":
        return _express_top_heavy(starters, bench)
    if rule_id == "the_standard":
        return _express_the_standard(boss_profile, player_profile)
    if rule_id == "the_long_series":
        return _express_the_long_series(boss_profile, player_profile)
    return 0.0


# ---------------------------------------------------------------------------
# Diversity
# ---------------------------------------------------------------------------
def _decade(card: RunCard) -> str:
    """The decade of the window's anchor season, e.g. '1995-96' -> '1990'."""
    return f"{card.anchor_season[:3]}0"


def _diversity_score(cards: list[RunCard]) -> float:
    """Reward era spread and penalise a lineup that is all one decade.

    A generated opponent drawn from a 174-card pool will happily return seven
    cards from the same eight-year stretch, which reads as a bug even when the
    difficulty is right. This is a soft preference at BOSS_WEIGHT_DIVERSITY,
    never a constraint -- it can shade a choice between two equally-calibrated
    lineups and can never reject a legal one.
    """
    # Normalised to [0, 1] for the same reason the rule terms are: at raw
    # scale a fifth decade was worth 0.06 rating points of difficulty miss,
    # which is small but not nothing, and "small but not nothing" is exactly
    # what a tie-break term must not be allowed to become.
    return len({_decade(c) for c in cards}) / float(len(ROLES) + BENCH_SLOTS)


def _elite_count(cards: list[RunCard]) -> int:
    return sum(1 for c in cards if c.overall_percentile >= BOSS_ELITE_PERCENTILE)


# ---------------------------------------------------------------------------
# Lineup search
# ---------------------------------------------------------------------------
class _CandidateIndex:
    """Per-role candidate lists and precomputed lane vectors, built once.

    THIS EXISTS FOR SPEED, and the speed is load-bearing rather than cosmetic.
    The obvious implementation re-filters the whole candidate list for every
    role of every attempt -- 220 attempts x 5 roles x ~170 cards -- which
    measured at 24.7 ms per boss, i.e. 124 ms per five-act run and 3.4 hours
    for the 100,000-seed balance audit. That is slow enough that the run would
    not be calibrated at all, so the index is what makes the calibration
    possible rather than what makes it tidy.

    Nothing here changes WHAT is searched: the candidate set, the scarcest-
    first order and the resulting distribution are identical to the naive
    version, and `assert_boss_is_legal` still validates the winner.
    """

    __slots__ = ("cards", "by_role", "scarcity", "lanes", "elite")

    def __init__(self, candidates: list[RunCard]) -> None:
        self.cards = candidates
        self.by_role = {
            role: [c for c in candidates if role in c.eligible_roles] for role in ROLES
        }
        # Scarcest role first. `anchor` has only 28 eligible cards in the whole
        # 3Y pool against 155 for `guard_wing`, so filling it last would fail
        # constantly.
        self.scarcity = sorted(ROLES, key=lambda r: len(self.by_role[r]))
        # lane_index as a fixed-order tuple per card, so the rating loop never
        # touches a dict or the pool.
        self.lanes = {
            c.peak_window_id: tuple(c.lane_index[lane] for lane in LANE_FIELDS)
            for c in candidates
        }
        self.elite = {
            c.peak_window_id: c.overall_percentile >= BOSS_ELITE_PERCENTILE
            for c in candidates
        }


def _legal_lineup(
    index: _CandidateIndex, rng: random.Random
) -> Optional[tuple[list[RunCard], list[RunCard]]]:
    """Fill the five roles scarcest-first, then draw a bench. No duplicate players.

    Rejection sampling rather than re-filtering: a collision needs the same
    identity to be drawn twice out of a list of 28-155, so the expected number
    of redraws is small and each one is O(1) instead of O(candidates).
    """
    used_slugs: set[str] = set()
    by_role: dict[str, RunCard] = {}
    for role in index.scarcity:
        options = index.by_role[role]
        if not options:
            return None
        pick = None
        for _ in range(24):
            candidate = rng.choice(options)
            if candidate.player_slug not in used_slugs:
                pick = candidate
                break
        if pick is None:
            # Dense collision (a tiny or heavily-excluded pool). Fall back to
            # the exhaustive filter so a legal lineup is never missed just
            # because sampling was unlucky.
            remaining = [c for c in options if c.player_slug not in used_slugs]
            if not remaining:
                return None
            pick = rng.choice(remaining)
        by_role[role] = pick
        used_slugs.add(pick.player_slug)

    bench: list[RunCard] = []
    bench_slugs: set[str] = set()
    for _ in range(BENCH_SLOTS):
        pick = None
        for _ in range(24):
            candidate = rng.choice(index.cards)
            if (
                candidate.player_slug not in used_slugs
                and candidate.player_slug not in bench_slugs
            ):
                pick = candidate
                break
        if pick is None:
            remaining = [
                c for c in index.cards
                if c.player_slug not in used_slugs and c.player_slug not in bench_slugs
            ]
            if not remaining:
                return None
            pick = rng.choice(remaining)
        bench.append(pick)
        bench_slugs.add(pick.player_slug)

    return [by_role[r] for r in ROLES], bench


def _fast_profile_and_rating(
    index: _CandidateIndex,
    starters: list[RunCard],
    bench: list[RunCard],
    bench_weight: float,
) -> tuple[dict[str, float], float]:
    """The boss's lane profile and lineup rating, computed without the pool.

    Reproduces `battle.roster_lane_profile` + `battle.roster_total` exactly,
    including both rounding steps, so the value the search optimises is the
    value the battle will use. The only difference is that it reads the
    precomputed lane tuples instead of doing 35 pool lookups per candidate.
    """
    total_weight = len(starters) * STARTER_WEIGHT + len(bench) * bench_weight
    profile: dict[str, float] = {}
    rating = 0.0
    for i, lane in enumerate(LANE_FIELDS):
        acc = 0.0
        for c in starters:
            acc += STARTER_WEIGHT * index.lanes[c.peak_window_id][i]
        for c in bench:
            acc += bench_weight * index.lanes[c.peak_window_id][i]
        value = round(acc / total_weight, LANE_ROUNDING) if total_weight > 0 else 0.0
        profile[lane] = value
        rating += value * LANE_PEAK3_WEIGHTS[lane]
    return profile, round(rating, LANE_ROUNDING)


def _search_pass(
    index: _CandidateIndex,
    rng: random.Random,
    target: float,
    rule_id: Optional[str],
    player_profile: dict[str, float],
    opponent_bench_weight: float,
    best: Optional[tuple[float, list[RunCard], list[RunCard]]],
    best_miss: float,
) -> tuple[Optional[tuple[float, list[RunCard], list[RunCard]]], float]:
    """One sampling pass over a candidate set.

    Carries the incumbent in and out, so passes COMPETE rather than replace --
    which is what guarantees a later pass can never make the result worse.
    """
    for _ in range(BOSS_SEARCH_ATTEMPTS):
        got = _legal_lineup(index, rng)
        if got is None:
            continue
        starters, bench = got
        profile, rating = _fast_profile_and_rating(
            index, starters, bench, opponent_bench_weight
        )
        # The elite cap is PRICED, not enforced. See BOSS_MAX_ELITE_CARDS: as a
        # hard filter it made the top of the difficulty range unreachable and
        # handed the strongest rosters the easiest final boss.
        overflow = max(
            0,
            sum(index.elite[c.peak_window_id] for c in starters + bench)
            - BOSS_MAX_ELITE_CARDS,
        )
        miss = abs(rating - target)
        score = (
            -BOSS_WEIGHT_TARGET * miss
            - BOSS_WEIGHT_TARGET * BOSS_ELITE_OVERFLOW_PENALTY * overflow
            + BOSS_WEIGHT_RULE_EXPRESSION
            * _rule_expression(rule_id, profile, player_profile, starters, bench)
            + BOSS_WEIGHT_DIVERSITY * _diversity_score(starters + bench)
        )
        if best is None or score > best[0]:
            best = (score, starters, bench)
            best_miss = miss
    return best, best_miss


def boss_target_rating(
    player_rating: float, act: int, rule_id: Optional[str], seed: int
) -> float:
    """The lineup rating this act's boss is built to hit.

    Published as its own function because the scout report, the tests and the
    balance audit all need to state the target without restating the formula.
    """
    # PARTIAL tracking, not 1:1. See config.BOSS_ROSTER_TRACKING: an opponent
    # that matched the roster exactly would make every fight the same fight and
    # building a better team worth nothing.
    tracked = BOSS_ROSTER_ANCHOR + BOSS_ROSTER_TRACKING * (
        player_rating - BOSS_ROSTER_ANCHOR
    )
    # Its own keyed stream, so the jitter cannot shift the lineup search's draw
    # and vice versa.
    jitter_rng = random.Random(f"rtt:{seed}:boss-jitter:{act}")
    jitter = jitter_rng.uniform(-BOSS_TARGET_JITTER, BOSS_TARGET_JITTER)
    return tracked + boss_combined_target(act, rule_id) + jitter


def generate_boss_for_act(
    pool: CardPool,
    seed: int,
    act: int,
    player_starters: Sequence[str],
    player_bench: Sequence[str],
    systems: Sequence[str] = (),
    exclude_slugs: frozenset[str] = frozenset(),
) -> Opponent:
    """Build this act's opponent for the roster that will face it.

    Pure function of its arguments. The RNG stream follows the repository's
    keyed-stream convention (``rtt:{seed}:{stream}``) so adding this stream did
    not and cannot shift any existing stream's output.

    ``exclude_slugs`` MUST already contain every identity the player owns.
    Passing it is not an optimisation -- it is the whole of the duplicate-
    identity fix, and :func:`assert_boss_is_legal` re-checks it before the
    lineup is returned so a caller that forgets fails loudly rather than
    shipping a duplicate to a player.
    """
    # Imported here rather than at module scope: `battle` is the resolution
    # layer, and importing it eagerly would make the boss catalogue depend on
    # it for every caller that only wants the specs.
    from nba_peak.run_the_table.battle import (
        bench_weight_for,
        player_lane_profile,
        roster_lane_profile,
        roster_total,
    )

    spec = boss_spec_for_act(act)
    rule_id = spec["rule_id"]

    _, opponent_bench_weight = bench_weight_for(systems, rule_id)
    player_profile = player_lane_profile(
        pool, player_starters, player_bench, systems, rule_id
    )
    player_rating = roster_total(player_profile)
    target = boss_target_rating(player_rating, act, rule_id, seed)

    candidates = [c for c in pool.cards if c.player_slug not in exclude_slugs]
    if len(candidates) < len(ROLES) + BENCH_SLOTS:
        raise BossGenerationError(
            f"Only {len(candidates)} cards remain after exclusions; act {act} needs "
            f"at least {len(ROLES) + BENCH_SLOTS}."
        )

    rng = random.Random(f"rtt:{seed}:boss:{act}")
    best: Optional[tuple[float, list[RunCard], list[RunCard]]] = None
    best_miss = float("inf")

    # TWO PASSES, and the second is load-bearing at the top of the range.
    # Uniform sampling finds a mid-pool target quickly and essentially never
    # finds one in the top tail: measured, the strongest third of rosters
    # reached act 5 at a ~47 lineup rating wanting a ~49 opponent, and 220
    # uniform draws landed at a mean delta of +0.62 against a target of +2.02.
    # Pass 2 re-runs the identical search over the strongest half of the
    # candidates, which is where a high target actually lives. Pass 1's winner
    # still competes, so the middle of the range is untouched -- this only adds
    # reach, and it is skipped entirely once pass 1 is already inside tolerance.
    passes = [candidates]
    strong = sorted(candidates, key=lambda c: -_card_lane_mean(c))[
        : max(len(ROLES) + BENCH_SLOTS, len(candidates) // 2)
    ]
    if len(strong) >= len(ROLES) + BENCH_SLOTS:
        passes.append(strong)

    for candidate_set in passes:
        best, best_miss = _search_pass(
            _CandidateIndex(candidate_set), rng, target, rule_id, player_profile,
            opponent_bench_weight, best, best_miss,
        )
        if best_miss <= BOSS_TARGET_TOLERANCE:
            break

    if best is None:
        raise BossGenerationError(
            f"Could not build a legal boss for act {act} from {len(candidates)} "
            f"candidate cards."
        )

    _, starters, bench = best
    opponent = Opponent(
        boss_id=spec["boss_id"],
        name=spec["name"],
        tagline=spec["tagline"],
        act=act,
        rule_id=rule_id,
        starter_ids=tuple(c.peak_window_id for c in starters),
        bench_ids=tuple(c.peak_window_id for c in bench),
        source="generated",
    )
    assert_boss_is_legal(pool, opponent, exclude_slugs)
    return opponent


# ---------------------------------------------------------------------------
# Server-side legality
# ---------------------------------------------------------------------------
def assert_boss_is_legal(
    pool: CardPool, boss: Opponent, exclude_slugs: frozenset[str] = frozenset()
) -> None:
    """Refuse an illegal boss lineup at the point it is produced.

    A TEST IS NOT ENOUGH HERE. The duplicate-identity defect this replaces was
    invisible for the life of v3 precisely because every check that existed was
    scoped to one side: the balance audit compared the player's roster against
    itself, and the boss tests compared a boss against itself. This assertion
    is on the WRITE path, so a regression cannot reach a player even on a seed
    no test ever draws.
    """
    ids = list(boss.starter_ids) + list(boss.bench_ids)
    if len(ids) != len(ROLES) + BENCH_SLOTS:
        raise BossGenerationError(
            f"Boss '{boss.boss_id}' has {len(ids)} cards; expected "
            f"{len(ROLES) + BENCH_SLOTS}."
        )
    missing = [i for i in ids if not pool.has(i)]
    if missing:
        raise BossGenerationError(
            f"Boss '{boss.boss_id}' names cards outside the pool: {missing}"
        )
    slugs = [pool.get(i).player_slug for i in ids]
    if len(set(slugs)) != len(slugs):
        dupes = sorted({s for s in slugs if slugs.count(s) > 1})
        raise BossGenerationError(
            f"Boss '{boss.boss_id}' fields the same identity twice: {dupes}"
        )
    collision = sorted(set(slugs) & set(exclude_slugs))
    if collision:
        raise BossGenerationError(
            f"Boss '{boss.boss_id}' fields an excluded identity (the run owns it, "
            f"or another boss already has it): {collision}"
        )
    for role, card_id in zip(ROLES, boss.starter_ids):
        if role not in pool.get(card_id).eligible_roles:
            raise BossGenerationError(
                f"Boss '{boss.boss_id}' starts {card_id} at '{role}', which it "
                f"cannot play."
            )


def boss_slugs(pool: CardPool, boss: Opponent) -> frozenset[str]:
    """Every identity this boss fields."""
    return frozenset(
        pool.get(cid).player_slug
        for cid in list(boss.starter_ids) + list(boss.bench_ids)
    )


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------
def boss_reveal_order(pool: CardPool, boss: Opponent) -> list[dict]:
    """The deterministic slot-by-slot reveal of a boss lineup (spec §3).

    Same seven slots and the same order as the opening roster reveal, so a
    client can drive both with one component. Pure lookup -- no seed, no clock,
    no model inference: the lineup was decided when the act began and is stored
    on the run, and labelling the reveal as seed/roster generated rather than
    "an LLM building a team live" is only honest if the data behaves that way.
    """
    out: list[dict] = []
    for idx, (role, card_id) in enumerate(zip(ROLES, boss.starter_ids)):
        card = pool.get(card_id)
        out.append(
            {
                "order": idx,
                "slot_id": role,
                "role": role,
                "is_starter": True,
                "card_id": card_id,
                "player_name": card.player_name,
                "anchor_season": card.anchor_season,
                "prime_score": card.prime_score,
            }
        )
    for idx, card_id in enumerate(boss.bench_ids):
        card = pool.get(card_id)
        out.append(
            {
                "order": len(ROLES) + idx,
                "slot_id": f"bench_{idx + 1}",
                "role": None,
                "is_starter": False,
                "card_id": card_id,
                "player_name": card.player_name,
                "anchor_season": card.anchor_season,
                "prime_score": card.prime_score,
            }
        )
    return out


def scout_report(
    pool: CardPool,
    boss: Opponent,
    player_starters: Sequence[str],
    player_bench: Sequence[str],
    systems: Sequence[str] = (),
    prep_bonus: float = SCOUT_PREP_LANE_BONUS,
) -> dict:
    """Everything "Scout the Boss" reveals, computed from published values.

    Spec §5A: the next boss's rule, its two strongest lanes, its weakest lane,
    and a projected matchup -- then the capped preparation the player may buy on
    top of it. Every number here is one the player can already reproduce from
    the lane profiles the UI shows; scouting buys the *work*, not private
    information the engine is otherwise hiding.

    ``would_flip`` on each preparation option is the whole reason this node is
    not dead content: it tells the player, before they commit, whether the
    2.5-point preparation actually changes a lane result in the fight they are
    about to take.
    """
    from nba_peak.run_the_table.battle import (
        bench_weight_for,
        lane_margin_threshold,
        lanes_to_win_for,
        player_lane_profile,
        roster_lane_profile,
        roster_total,
    )

    _, opponent_bench_weight = bench_weight_for(systems, boss.rule_id)
    boss_profile = roster_lane_profile(
        pool, boss.starter_ids, boss.bench_ids, opponent_bench_weight
    )
    player_profile = player_lane_profile(
        pool, player_starters, player_bench, systems, boss.rule_id
    )
    threshold = lane_margin_threshold(boss.rule_id)
    lanes_needed = lanes_to_win_for(boss.rule_id)

    lanes: list[dict] = []
    projected_player_lanes = 0
    projected_opponent_lanes = 0
    summed_margin = 0.0
    for lane in LANE_FIELDS:
        margin = round(player_profile[lane] - boss_profile[lane], LANE_ROUNDING)
        summed_margin += margin
        if margin > threshold:
            winner = "player"
            projected_player_lanes += 1
        elif margin < -threshold:
            winner = "opponent"
            projected_opponent_lanes += 1
        else:
            winner = "tie"
        lanes.append(
            {
                "lane": lane,
                "label": LANE_LABELS[lane],
                "opponent_score": boss_profile[lane],
                "player_score": player_profile[lane],
                "margin": margin,
                "projected_winner": winner,
            }
        )

    by_strength = sorted(lanes, key=lambda row: (-row["opponent_score"], row["lane"]))
    summed_margin = round(summed_margin, LANE_ROUNDING)

    if projected_player_lanes >= lanes_needed:
        projection = "win"
    elif projected_opponent_lanes >= lanes_needed:
        projection = "loss"
    elif summed_margin > 0:
        projection = "win_on_margin"
    elif summed_margin < 0:
        projection = "loss_on_margin"
    else:
        projection = "draw"

    preparations = []
    for row in lanes:
        prepared = round(row["margin"] + prep_bonus, LANE_ROUNDING)
        preparations.append(
            {
                "lane": row["lane"],
                "label": row["label"],
                "bonus": prep_bonus,
                "margin_before": row["margin"],
                "margin_after": prepared,
                "would_flip": row["projected_winner"] != "player" and prepared > threshold,
            }
        )

    return {
        "boss_id": boss.boss_id,
        "name": boss.name,
        "tagline": boss.tagline,
        "act": boss.act,
        "rule_id": boss.rule_id,
        "rule": dict(BOSS_RULES[boss.rule_id]) if boss.rule_id else None,
        "lane_margin_threshold": threshold,
        "lanes_to_win": lanes_needed,
        "lanes": lanes,
        "strongest_lanes": [row["lane"] for row in by_strength[:2]],
        "weakest_lane": by_strength[-1]["lane"],
        "projected_lanes_won": projected_player_lanes,
        "projected_lanes_lost": projected_opponent_lanes,
        "projected_summed_margin": summed_margin,
        "projection": projection,
        "preparations": preparations,
        "starter_mean": round(boss_starter_mean(pool, boss), 3),
        # v4: the authoritative lineup rating of each side, on the SAME scale
        # the battle scores and the roster panel prints. Published because the
        # boss is now built to a target expressed in exactly this quantity, and
        # a player told "this opponent was built for your roster" is owed the
        # number that claim is made in.
        "opponent_lineup_rating": roster_total(boss_profile),
        "player_lineup_rating": roster_total(player_profile),
    }


def boss_starter_mean(pool: CardPool, boss: Opponent) -> float:
    return statistics.mean(pool.get(i).prime_score for i in boss.starter_ids)


def boss_lineup_rating(
    pool: CardPool, boss: Opponent, systems: Sequence[str] = ()
) -> float:
    """The boss's authoritative lineup rating, scored as the battle will score it."""
    from nba_peak.run_the_table.battle import (
        bench_weight_for,
        roster_lane_profile,
        roster_total,
    )

    _, obw = bench_weight_for(systems, boss.rule_id)
    return roster_total(
        roster_lane_profile(pool, boss.starter_ids, boss.bench_ids, obw)
    )
