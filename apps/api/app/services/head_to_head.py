"""Head-to-Head RUN THE TABLE: fairness pinning and the published winner order.

This module holds every rule of the asynchronous two-player mode and no HTTP
and no storage. Three things live here:

1. THE FAIRNESS DIGEST. What "both players got the same game" means, reduced to
   one hash that is pinned at creation and re-checked at every join and every
   submission.
2. THE COMPARISON METRICS. What is extracted from a finished run, and from
   where.
3. THE WINNER ORDER. Spec §6's eight levels, in order, with the
   credit-efficiency rule written out rather than implied.

Nothing here computes a PEAK3 score (CLAUDE.md). Every number is read from the
engine's own receipt (`nba_peak/run_the_table/receipt.build_receipt`) or from
the persisted run state.


FAIRNESS
--------
Spec §6 requires both players to receive the same rules version, starting
roster, initial perk choices, node structure, offer-generation inputs and
bosses, while their choices may diverge.

The engine already makes this true by construction. `generate_blueprint`
(`nba_peak/run_the_table/generation.py:253`) is a pure function of
`(seed, card pool, versions)` -- it ignores `run_type` and `date` entirely --
and every stream inside it is keyed rather than sequential: `_rng(seed, stream)`
at `generation.py:45-46`, with the market-refresh stream keyed literally on
`seed + act + stage + node_type + refresh_index`
(`nba_peak/run_the_table/state.py`, `action_market_refresh`). A new stream
therefore cannot shift an existing one, and two runs from the same seed produce
byte-identical content.

"True by construction" is not the same as "checked", and this feature is the
one where a silent divergence would be a stolen win rather than a cosmetic bug.
So the match PINS a digest of the six fairness inputs at creation, and both
`accept` and `submit` recompute it from the joiner's own regenerated blueprint
and refuse on any mismatch. If a card pool is rebuilt underneath a live match,
or a ruleset ships mid-match, the match stops rather than silently comparing
two different games.


WINNER ORDER (spec §6) -- implemented in exactly this order
-----------------------------------------------------------
    1. Table Cleared                 higher wins (True > False)
    2. bosses defeated               higher wins
    3. final act reached             higher wins
    4. lives remaining               higher wins
    5. aggregate lane differential   higher wins
    6. final roster PEAK3 total      higher wins
    7. credit efficiency             higher wins   <- published rule below
    8. active play time              LOWER wins    <- final tie-breaker only

A level decides the match only if every level above it is exactly equal. If all
eight are equal the match is a draw; there is no ninth level and no coin flip.


THE PUBLISHED CREDIT-EFFICIENCY RULE (level 7)
----------------------------------------------
    net_credits_committed = credits_spent - credits_refunded
    credit_efficiency     = final_roster_peak3_total
                            / max(1, net_credits_committed)
    compared rounded to 6 decimal places; HIGHER wins.

In words: **PEAK3 roster points per credit you actually gave up.**

Why these particular terms:

* `credits_spent` is the engine's own gross figure -- cards plus every credit
  sink (`receipt.py:266-276`), so a Market Refresh counts exactly as much as a
  signing. Charging only for cards would make the four v3 sinks free in the
  tie-break and reward exactly the spending the sinks were added to price.
* `credits_refunded` is subtracted because a refunded credit was never
  committed. The engine tracks refunds separately for the same reason
  (`receipt.py:277`).
* `max(1, ...)` keeps the ratio finite for a player who spent nothing. Zero
  spend is a legal, and very strong, line -- it must score as the best possible
  efficiency, not divide by zero.
* Rounded to 6 dp before comparison so IEEE-754 noise in the roster total can
  never decide a match. Two lines that differ by 1e-12 are equal here, and fall
  through to level 8.
* Credits AWARDED by battles are deliberately not in the denominator. They are
  a function of how the run went, not of how it was managed, and putting them
  in would make level 7 partly re-measure levels 1-5.

Because level 7 is only ever reached when level 6 (roster total) already tied,
it reduces in practice to "the player who committed fewer credits to the same
roster wins". It is nevertheless defined and displayed as a ratio, because that
is the number the receipt shows and a rule that is displayed differently from
how it is applied is the drift this codebase keeps designing against.


ACTIVE PLAY TIME (level 8) -- and what is excluded from it
----------------------------------------------------------
    active_play_seconds = floor(last_action_at - created_at) of the run, >= 0

Both timestamps are written by the server (`nba_peak/run_the_table/state._now`)
and a client can neither supply nor influence a duration.

* TUTORIAL TIME IS EXCLUDED BY CONSTRUCTION. The clock starts when the run is
  created server-side. The invite landing page, the opponent's name, the
  ruleset screen, the rules tour and every second spent deciding whether to
  accept all happen before that call and are outside the window.
* POST-RUN TIME IS EXCLUDED. The clock stops at the last engine action, so
  reading the receipt, sharing it, or leaving the tab open costs nothing.
* NETWORK LATENCY CANNOT DECIDE A MATCH. It cannot be subtracted -- a server
  does not know how long a packet took -- so it is neutralised instead:
  level 8 only separates two players when their times differ by at least
  ``ACTIVE_TIME_MIN_MARGIN_SECONDS``. Inside that band the match is a DRAW.
  A round trip is milliseconds; the margin is two orders of magnitude larger,
  so no realistic latency difference can reach it, and the rule is published
  rather than hoped for.

This does mean idle time inside a run counts. That is deliberate and stated:
per-action timestamps do not exist in the engine's action log
(`RunAction` has no time field), so an idle-gap cap could not be computed
without either changing the engine -- frozen for this pass -- or trusting a
client-reported duration, which is the one thing a competitive tie-break must
never do. Recorded as a known limitation of the eighth tie-breaker.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from nba_peak.run_the_table.bosses import BOSS_SPECS
from nba_peak.run_the_table.config import ACTS, RULESET_VERSION, version_tuple
from nba_peak.run_the_table.schemas import RunBlueprint, RunState

__all__ = [
    "ACTIVE_TIME_MIN_MARGIN_SECONDS",
    "CREDIT_EFFICIENCY_RULE",
    "ComparisonMetrics",
    "FairnessMismatch",
    "H2H_INVITE_TOKEN_KIND",
    "INVITE_TTL_SECONDS",
    "MATCH_TTL_SECONDS",
    "TIEBREAK_ORDER",
    "assert_fairness",
    "compare",
    "fairness_digest",
    "invite_claims",
    "invite_hash",
    "metrics_from_run",
    "published_rules",
]


# ---------------------------------------------------------------------------
# Token and lifetime constants
# ---------------------------------------------------------------------------

#: The `kind` discriminator this mode's HMAC tokens carry.
#:
#: RUN THE TABLE's own challenge token uses `kind = "run_the_table"`
#: (`api/v1/run_the_table.py:95`) and Peak Draft's uses its own; all three are
#: signed with the SAME `PEAK3_SIGNING_SECRET`, so without a distinct `kind` a
#: perfectly valid Draft or RTT-challenge token would verify here and be read
#: for claims it does not have. `_decode_invite` rejects any token whose kind is
#: not exactly this string -- that check is the only thing standing between the
#: three modes' token namespaces.
H2H_INVITE_TOKEN_KIND = "run_the_table_h2h_invite"

#: Two weeks. An asynchronous match has to survive one player being on holiday,
#: but a token must not outlive the ruleset it encodes by much -- and a ruleset
#: change already refuses the match through `assert_fairness` anyway.
INVITE_TTL_SECONDS = 14 * 86400

#: The match row's own expiry. Deliberately identical to the token's, and
#: enforced separately: the token expiry stops a leaked link being replayed,
#: the row expiry stops an already-seated player finishing a match a year late.
#: Two independent clocks, because a single one is a single point of failure.
MATCH_TTL_SECONDS = INVITE_TTL_SECONDS

#: Level 8's dead band. See the module docstring: latency cannot be subtracted,
#: so it is made unable to reach the threshold instead.
ACTIVE_TIME_MIN_MARGIN_SECONDS = 2

#: Machine-readable form of the level-7 rule, served by
#: `GET /run-the-table/h2h/rules` so "published" means published rather than
#: "written in a docstring nobody reads".
CREDIT_EFFICIENCY_RULE: dict[str, Any] = {
    "id": "roster_total_per_net_credit_v1",
    "formula": (
        "credit_efficiency = final_roster_peak3_total / max(1, credits_spent - credits_refunded)"
    ),
    "higher_is_better": True,
    "rounding_decimals": 6,
    "includes": ["credits spent on cards", "credits spent on every credit sink"],
    "excludes": [
        "credits refunded (never committed)",
        "credits awarded by battles (an outcome, not a management decision)",
    ],
    "zero_spend": "denominator floors at 1, so spending nothing scores best rather than dividing by zero",
}


# ---------------------------------------------------------------------------
# Fairness
# ---------------------------------------------------------------------------

class FairnessMismatch(Exception):
    """The joiner's regenerated board is not the board the match pinned.

    Carries the field that differed so the API can say which one, and so a
    failure is diagnosable without a database dump.
    """

    def __init__(self, field: str, expected: Any, actual: Any) -> None:
        super().__init__(
            f"Head-to-head fairness check failed on {field!r}: this match was "
            f"created under a board that no longer regenerates identically."
        )
        self.field = field
        self.expected = expected
        self.actual = actual


def _stable_hash(payload: Any) -> str:
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


def node_structure_signature(blueprint: RunBlueprint) -> str:
    """A digest over the node graph AND every offer-generation input.

    Covers, per stage: the act, the stage, each option's node id and node type,
    and the full payload dict -- which is where the draft offer ids, the trade
    incoming ids and the reserve candidate ids live
    (`generation.py:291-315`). The market-refresh stream is not enumerated here
    because it is keyed on `seed + act + stage + node_type + refresh_index`
    (spec §6): refresh N of a node is a pure function of inputs this digest
    already covers, so pinning the node pins every refresh of it.
    """
    return _stable_hash(
        [
            {
                "act": plan.act,
                "stage": plan.stage,
                "options": [
                    {"node_id": o.node_id, "node_type": o.node_type}
                    for o in plan.options
                ],
                "payloads": plan.payloads,
            }
            for plan in blueprint.stages
        ]
    )


def fairness_digest(blueprint: RunBlueprint) -> dict:
    """The six things spec §6 says both players must receive, plus a digest.

    Stored verbatim on the match at creation. Every field is readable rather
    than hashed away, so a support question ("did we really give them the same
    bosses?") is answerable from the row, and the `digest` is what the code
    actually compares.

    WHAT IS PINNED, WHAT IS NOT, AND WHY THE GAP IS NOT A HOLE
    ----------------------------------------------------------
    PINNED: the seed (the match row's own column), the ruleset version, the
    starting starters and bench, both System offers in order, the five boss
    identities with their rules, and `node_structure_signature` -- which covers
    the whole node graph AND every offer-generation input (draft offer ids,
    trade incoming ids, reserve candidate ids), and therefore every market
    refresh derived from them. That is the entire SHAPE of the run.

    NOT PINNED under v4: the boss LINEUPS. They cannot be, because they do not
    exist at blueprint time -- each is generated when its act begins, against
    the roster that will actually face it.

    THIS IS NOT A FAIRNESS REGRESSION, AND SOMEBODY WILL EVENTUALLY READ IT AS
    ONE. It is symmetric, and arguably fairer than what it replaces. Under v3
    both players faced one fixed lineup, which could happen to suit one
    player's roster and not the other's -- identical opponents, unequal
    difficulty. Under v4 each player faces bosses calibrated to the roster they
    actually built, so what is equalised is the DIFFICULTY RELATIONSHIP rather
    than the opponent. Both players still start from the same roster, so their
    act-1 opponents are identical; the slates diverge only to the extent the
    players themselves diverged, which is the thing a match is measuring.
    """
    body = {
        # `generation.generate_blueprint` builds `metadata` as
        # `{**version_tuple(), ...}` -- the three version strings are top-level
        # keys, not nested under "versions".
        "ruleset_version": blueprint.metadata.get("ruleset_version", RULESET_VERSION),
        "starting_starters": list(blueprint.starting_starters),
        "starting_bench": list(blueprint.starting_bench),
        # "same initial perk choices": both System offers, in order.
        "system_offers": [list(offer) for offer in blueprint.system_offers],
        # v4: boss IDENTITIES (the five names, in act order, each with its
        # rule) are still fixed by the ruleset and still shared by both sides,
        # so they stay in the fairness digest. Their LINEUPS are not pinned
        # here, and cannot be: a boss is now generated against the roster that
        # will face it, so two players on one seed meet an identical act-1
        # opponent (their starting rosters are identical) and thereafter meet
        # opponents scaled to the rosters they each chose to build. Pinning a
        # lineup would mean pinning something that no longer exists at
        # blueprint time.
        "boss_ids": [spec["boss_id"] for spec in BOSS_SPECS],
        "node_signature": node_structure_signature(blueprint),
    }
    return {**body, "digest": _stable_hash(body)}


def assert_fairness(pinned: dict, blueprint: RunBlueprint) -> None:
    """Refuse to proceed unless this blueprint is the pinned one.

    Called at BOTH join and submission, not only at join: a card pool rebuild
    or a ruleset deploy between the two would otherwise let a player finish a
    board their opponent never played and have it compared as if they had.
    """
    actual = fairness_digest(blueprint)
    if actual["digest"] == pinned.get("digest"):
        return
    # Name the first field that differs -- an opaque "digest mismatch" is a
    # support ticket, a named field is a diagnosis.
    for field in (
        "ruleset_version",
        "starting_starters",
        "starting_bench",
        "system_offers",
        "boss_ids",
        "node_signature",
    ):
        if pinned.get(field) != actual.get(field):
            raise FairnessMismatch(field, pinned.get(field), actual.get(field))
    raise FairnessMismatch("digest", pinned.get("digest"), actual["digest"])


# ---------------------------------------------------------------------------
# Invite tokens
# ---------------------------------------------------------------------------

def invite_hash(invite_id: str) -> str:
    """`sha256(invite_id)` -- the only form of an invite that is ever stored.

    A database read must not yield a working invite link, so the row holds the
    hash and the token holds the pre-image. Same discipline as
    `challenges.token_hash` (`20260630124800_challenges.sql:8`).
    """
    return hashlib.sha256(invite_id.encode()).hexdigest()


def invite_claims(invite_id: str, nonce: str) -> dict:
    """The claim SHAPE an invite token is signed over. The router adds `kind`.

    THERE IS NO MATCH ID IN HERE, and that is the point. Spec §6: "the invite
    must not expose mutable resource IDs". `invite_id` is 128 fresh bits whose
    only power is to resolve, through a hash lookup, to a match -- it is not
    the match's primary key, it is not accepted anywhere a mutation happens,
    and a mutation route reads the match id from the caller's own participant
    row instead (`ranked.py:196-203`'s contract).

    `ruleset` rides along so the landing page can say "this link was made under
    an older ruleset" truthfully, exactly as RTT's own challenge token learned
    to do (`services/run_the_table/runs.py:239-246`).
    """
    return {
        "inv": invite_id,
        "ruleset": RULESET_VERSION,
        "nonce": nonce,
    }


# ---------------------------------------------------------------------------
# Comparison metrics
# ---------------------------------------------------------------------------

def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def active_play_seconds(state: RunState) -> int:
    """The run's own server-recorded action span, floored at 0.

    See the module docstring for exactly what this includes and excludes, and
    why a client-reported duration is never accepted.
    """
    start = _parse_iso(state.created_at)
    end = _parse_iso(state.last_action_at)
    if start is None or end is None:
        return 0
    return max(0, int((end - start).total_seconds()))


@dataclass(frozen=True)
class ComparisonMetrics:
    """Everything the winner order reads, and nothing else.

    Built once at submission time from the run's own receipt and frozen into
    the participant row, so a later ruleset change cannot retroactively rewrite
    a settled match's inputs.
    """

    table_cleared: bool
    bosses_defeated: int
    final_act_reached: int
    lives_remaining: int
    lane_differential: int
    roster_peak3_total: float
    credits_spent: int
    credits_refunded: int
    net_credits_committed: int
    credit_efficiency: float
    active_play_seconds: int
    # Context for the side-by-side receipt. Never read by `compare`.
    outcome: str
    run_id: str
    completed_at: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_dict(data: dict) -> "ComparisonMetrics":
        known = {f: data.get(f) for f in ComparisonMetrics.__dataclass_fields__}
        return ComparisonMetrics(**known)  # type: ignore[arg-type]


def credit_efficiency(roster_total: float, net_credits_committed: int) -> float:
    """The published level-7 rule. See CREDIT_EFFICIENCY_RULE and the docstring."""
    return round(
        float(roster_total) / max(1, int(net_credits_committed)),
        CREDIT_EFFICIENCY_RULE["rounding_decimals"],
    )


def metrics_from_run(state: RunState, receipt: dict) -> ComparisonMetrics:
    """Extract the eight comparison levels from one finished run.

    `receipt` is `nba_peak.run_the_table.receipt.build_receipt`'s output,
    unmodified. Nothing here re-derives a battle, a price or a PEAK3 score:
    every figure is the engine's own.
    """
    battles = state.battles
    # Level 3. The highest act the player actually got to. A cleared run is at
    # ACTS; a run that died in act 2 is at 2. Taken as the max of the state's
    # act and the last battle's, so a run that failed on the boss of act 3 is
    # credited with act 3 rather than with wherever the state pointer stopped.
    final_act_reached = max([int(state.act)] + [int(b.act) for b in battles])
    # Level 5. Aggregate lane differential: lanes won minus lanes conceded,
    # summed across every battle the player resolved. Lanes rather than raw
    # score margin, because a lane is the unit the game itself wins and loses
    # (`BattleResult.player_lanes_won`) and a score margin is already what
    # decides an individual battle (`decided_by == "summed_margin"`) -- reusing
    # it here would make level 5 a second vote on the same evidence.
    lane_differential = sum(
        int(b.player_lanes_won) - int(b.opponent_lanes_won) for b in battles
    )
    spent = int(receipt.get("credits_spent", 0))
    refunded = int(receipt.get("credits_refunded", 0))
    net = spent - refunded
    roster_total = float(receipt.get("roster_total", 0.0))
    return ComparisonMetrics(
        table_cleared=bool(receipt.get("table_cleared", False)),
        bosses_defeated=int(receipt.get("bosses_defeated", 0)),
        final_act_reached=min(final_act_reached, ACTS),
        lives_remaining=int(state.lives),
        lane_differential=lane_differential,
        roster_peak3_total=round(roster_total, 6),
        credits_spent=spent,
        credits_refunded=refunded,
        net_credits_committed=net,
        credit_efficiency=credit_efficiency(roster_total, net),
        active_play_seconds=active_play_seconds(state),
        outcome=str(receipt.get("outcome", "")),
        run_id=state.run_id,
        completed_at=state.last_action_at,
    )


# ---------------------------------------------------------------------------
# The winner order
# ---------------------------------------------------------------------------

#: Spec §6, in order. `(level_id, attribute, higher_wins)`.
#:
#: This tuple IS the ordering -- `compare` walks it and does nothing else, so
#: there is no second place where the order is written down and no way for a
#: displayed order and an applied order to drift apart.
TIEBREAK_ORDER: tuple[tuple[str, str, bool], ...] = (
    ("table_cleared", "table_cleared", True),
    ("bosses_defeated", "bosses_defeated", True),
    ("final_act_reached", "final_act_reached", True),
    ("lives_remaining", "lives_remaining", True),
    ("lane_differential", "lane_differential", True),
    ("roster_peak3_total", "roster_peak3_total", True),
    ("credit_efficiency", "credit_efficiency", True),
    # Level 8 is the ONLY level where lower wins, and the only one with a dead
    # band. Both facts are properties of this row, not special cases in the
    # loop, so adding a level cannot accidentally inherit them.
    ("active_play_time", "active_play_seconds", False),
)

#: Human labels for the receipt, keyed by level id. Kept beside the order so a
#: new level cannot ship without a name.
TIEBREAK_LABELS: dict[str, str] = {
    "table_cleared": "Table Cleared",
    "bosses_defeated": "Bosses defeated",
    "final_act_reached": "Final act reached",
    "lives_remaining": "Lives remaining",
    "lane_differential": "Aggregate lane differential",
    "roster_peak3_total": "Final roster PEAK3 total",
    "credit_efficiency": "Credit efficiency",
    "active_play_time": "Active play time",
}


def _level_value(metrics: ComparisonMetrics, attribute: str) -> Any:
    value = getattr(metrics, attribute)
    # bool is a subclass of int, so True > False falls out of the same
    # comparison as every numeric level. Level 1 needs no special case.
    if attribute == "roster_peak3_total" or attribute == "credit_efficiency":
        return round(float(value), CREDIT_EFFICIENCY_RULE["rounding_decimals"])
    return value


def compare(creator: ComparisonMetrics, opponent: ComparisonMetrics) -> dict:
    """Decide a head-to-head. Returns the full, auditable comparison.

    `winner` is "creator" | "opponent" | "draw". `decided_by` names the level
    that separated them (None on a draw). `levels` reports EVERY level with
    both values and its verdict, in order, so the receipt can show the reader
    precisely where the match was decided and that nothing below that point was
    consulted.
    """
    levels: list[dict] = []
    winner: Optional[str] = None
    decided_by: Optional[str] = None

    for level_id, attribute, higher_wins in TIEBREAK_ORDER:
        a = _level_value(creator, attribute)
        b = _level_value(opponent, attribute)

        if winner is not None:
            # Already decided. Report the level, but mark it as not consulted --
            # spec §6's order is strict, and a receipt that showed a lower level
            # "winning" would imply it counted.
            levels.append(
                {
                    "level": level_id,
                    "label": TIEBREAK_LABELS[level_id],
                    "higher_wins": higher_wins,
                    "creator": a,
                    "opponent": b,
                    "verdict": "not_consulted",
                }
            )
            continue

        if level_id == "active_play_time" and abs(float(a) - float(b)) < (
            ACTIVE_TIME_MIN_MARGIN_SECONDS
        ):
            # Inside the latency dead band: treat as equal, which -- this being
            # the last level -- makes the match a draw. See the module
            # docstring for why latency is neutralised rather than subtracted.
            levels.append(
                {
                    "level": level_id,
                    "label": TIEBREAK_LABELS[level_id],
                    "higher_wins": higher_wins,
                    "creator": a,
                    "opponent": b,
                    "verdict": "tied_within_margin",
                    "margin_seconds": ACTIVE_TIME_MIN_MARGIN_SECONDS,
                }
            )
            continue

        if a == b:
            verdict = "tied"
        else:
            creator_ahead = (a > b) if higher_wins else (a < b)
            winner = "creator" if creator_ahead else "opponent"
            decided_by = level_id
            verdict = winner
        levels.append(
            {
                "level": level_id,
                "label": TIEBREAK_LABELS[level_id],
                "higher_wins": higher_wins,
                "creator": a,
                "opponent": b,
                "verdict": verdict,
            }
        )

    return {
        "winner": winner or "draw",
        "decided_by": decided_by,
        "levels": levels,
        "rules_version": "h2h_winner_order_v1",
        "credit_efficiency_rule": CREDIT_EFFICIENCY_RULE["id"],
    }


def published_rules() -> dict:
    """Everything the comparison applies, in the form the client renders.

    Served by `GET /run-the-table/h2h/rules` for the same reason
    `/run-the-table/meta` exists: the rules screen must read from the constants
    the code applies, not from copy that can drift away from them.
    """
    return {
        "rules_version": "h2h_winner_order_v1",
        "versions": version_tuple(),
        "winner_order": [
            {
                "position": i + 1,
                "level": level_id,
                "label": TIEBREAK_LABELS[level_id],
                "higher_wins": higher_wins,
            }
            for i, (level_id, _attr, higher_wins) in enumerate(TIEBREAK_ORDER)
        ],
        "credit_efficiency_rule": CREDIT_EFFICIENCY_RULE,
        "active_play_time": {
            "definition": "server-recorded seconds between the run's creation and its last engine action",
            "min_margin_seconds": ACTIVE_TIME_MIN_MARGIN_SECONDS,
            "excludes": [
                "the invite landing page and everything before the run is created",
                "the rules tour and any onboarding",
                "everything after the last engine action, including reading the receipt",
                "client-reported durations, which are never accepted",
            ],
            "note": (
                "Only ever consulted when all seven levels above are exactly equal, "
                "and only decides when the two times differ by at least the published "
                "margin -- so network latency cannot decide a match."
            ),
        },
        "fairness": {
            "pinned_at_creation": [
                "ruleset version",
                "starting starters",
                "starting bench",
                "both System (perk) offers",
                "boss sequence",
                "node structure and every offer-generation input",
            ],
            "rechecked_at": ["accept", "result submission"],
            "randomness": (
                "keyed streams, never a global sequential RNG: "
                "seed + act + stage + node_type + refresh_index"
            ),
        },
        "daily_attempts": (
            "Head-to-head runs are created with run_type 'challenge', which never "
            "consumes a daily attempt."
        ),
    }
