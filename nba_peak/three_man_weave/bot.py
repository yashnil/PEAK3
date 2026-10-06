"""The Three-Man Weave bot: a drafting policy that is good, and not perfect.

WHY THIS MODE MUST SHIP ONE
---------------------------
`RandomLegalBot` emits an EMPTY payload, and its own docstring says a mode whose
commands need arguments "should ship its own policy". Three-Man Weave's only
command is `tmw_pick`, which needs a `player_slug` and a `slot_type`. Without a
policy, every bot seat sent an argument-less pick, the reducer rejected it as a
bad payload, and the seat sat there until the turn clock expired and the
deterministic auto-pick resolved it.

WHAT IT IS ALLOWED TO KNOW
---------------------------
`decide` takes the two dicts the mode's own `project` produced for THIS seat.
The current roll is in there; FUTURE ROLLS ARE NOT, and not because they are
filtered -- they do not exist yet. A roll is drawn against the live draft state
when its round opens, so there is no future-roll field in the snapshot to leak,
strip or forget.

THE ONE THING IT READS THAT THE PROJECTION NO LONGER CARRIES
-------------------------------------------------------------
Candidate scores are hidden from every seat until a pick is confirmed, which is
a deliberate product rule: the game is knowing who these players were, not
comparing two numbers. A bot has no such knowledge, so it reads each
candidate's scoring card from the committed eligibility index directly -- the
same index the reducer scores the match with, looked up for the SAME franchise
and decade the pick would be made on.

That is a stand-in for basketball knowledge, not a private channel, and it is
stated rather than hidden for two reasons. It cannot see anything a human
cannot in principle know (these are published PEAK3 season scores for real
players), and it is deliberately BLUNTED: the policy below never simply takes
the highest number, because a bot that did would be an oracle and the mode
would be a game against arithmetic. Nothing here reads a future roll, another
seat's unsubmitted action, or any state the match has not already produced.

THE POLICY
----------
Score every legal option -- including the ones that need a rearrangement --
on five things a drafter actually weighs:

  * QUALITY        the candidate's franchise-decade PEAK3 season, normalised
                   against the rest of this roll so it means "good FOR THIS
                   ROLL" rather than "good in the abstract".
  * REPLACEMENT    how much better they are than the next-best option for the
                   same slot. Taking the only centre on a Bulls x 1990s roll
                   is worth more than taking the best of six wings.
  * NEED           whether the slot is one this seat still has open, and
                   whether a starter or the bench.
  * SCARCITY       how many other candidates on this roll could fill that slot.
  * FLEXIBILITY    a small penalty for spending a versatile player on a slot
                   only they can fill, and for taking a one-position player
                   early when the roll is deep at that position.

Then it CHOOSES WITH OPINIONS rather than taking the maximum (tmw_bot_v4). Each
surviving option gets a TASTE: its utility, plus a seeded drafting STYLE's
weighting of roster need, plus a bounded game-only RECOGNITION lean (see
`recognition.py` -- people reach for names they know), and one option is drawn
by Gumbel-max at the style's temperature from the options within
`_MILD_DEVIATION_REGRET` utility of the best. Strong options stay much more
likely than weak ones, near-peers genuinely vary, and the same situation in a
different match can produce a different pick -- while the same seed always
produces the same one.

WHY v4 REPLACED THE 90/8/2 BANDS. The bands made the bot a slightly blurred
argmax: nine picks in ten were exactly "the best available player by PEAK3",
so after a few matches a player could predict it from the numbers alone. The
regret unit below is kept -- it is still what bounds every deviation.

WHY REGRET AND NOT RANK, which is the correction this file exists to record.
The bands used to be ordinal -- fractions of the ranked option list, sampled
70/25/5. On a forty-option roll that meant 30% of picks came from options 8
through 32, and a rank is a rank whether the gap behind the leader is 0.01 or
0.9. A roll containing peak Stephen Curry and Carl Landry therefore produced
"Landry over Curry" roughly three times in ten. That is not a mild mistake, it
is a different kind of decision, and no ordinal band can tell the two apart.

WHAT IT WILL NOT DO, EVER
--------------------------
Make an illegal pick, break the identity lock, take a player whose placement
makes its own roster impossible to complete, or intentionally throw. The last
one is enforced by ONE structural rule rather than left to the distribution:

  THE QUALITY GATE (`viable_options`). A candidate more than
  `_MAX_QUALITY_REGRET_POINTS` behind the best candidate this seat can legally
  take is removed before anything is ranked or sampled. The dominance guard is
  this same rule reported rather than a second mechanism: when only one player
  survives the gate the pick is forced, because there is nothing else to
  choose. Deriving both from one filter is what stops them drifting apart.
"""
from __future__ import annotations

import math
import random
from collections import Counter
from typing import Any, Optional

from nba_peak.three_man_weave.arrangement import (
    FITS_AFTER_REARRANGEMENT,
    FITS_NOW,
)
from nba_peak.three_man_weave.positions import canonical_positions
from nba_peak.three_man_weave.config import (
    BOT_POLICY_VERSION,
    SLOT_TYPES,
    STARTER_SLOT_TYPES,
)
from nba_peak.three_man_weave.recognition import recognition

COMMAND_PICK = "tmw_pick"

#: BANDS ARE MEASURED IN UTILITY REGRET, NOT IN RANK.
#:
#: THE DEFECT THIS REPLACES. The bands used to be ORDINAL -- fractions of the
#: ranked option list (`0.20` / `0.55` / `0.80`) sampled at `(0.70, 0.25,
#: 0.05)`. On a forty-option roll that put 30% of picks in options 8-32
#: regardless of whether option 8 was a hair behind the best or a chasm behind
#: it. A roll holding peak Stephen Curry and Carl Landry produced exactly the
#: reported catastrophe about three times in ten, because rank 12 is rank 12
#: whether it costs 0.01 of lineup value or 0.9 of it.
#:
#: Regret is the right unit because it is the thing a spectator judges. A
#: drafter who takes the second-best wing when the two are near-identical has
#: made a defensible call; one who takes a role player over a superstar has
#: made a different KIND of decision, and no rank-based band can tell those
#: apart. This cap is in the same units as `_utility` returns, whose quality
#: term is normalised to [0, 1] across the roll -- so `0.18` means "within
#: eighteen percent of this roll's whole quality spread". v4 draws only inside
#: it (`candidate_pool`); v3's separate 0.06 "near-equivalent" band is gone
#: with the 90/8/2 band weights it served.
_MILD_DEVIATION_REGRET = 0.18

# ---------------------------------------------------------------------------
# DRAFTING STYLES (tmw_bot_v4)
# ---------------------------------------------------------------------------
#: Three internal personalities plus a neutral default. Never shown in the UI;
#: they exist so two bots at one table do not share one deterministic taste.
#:
#:   peak        x on the utility itself (PEAK3 quality + positional terms)
#:   need        extra weight on the ROSTER-NEED part of utility (replacement
#:               gap, starter bonus, slot scarcity), on top of what utility has
#:   star        weight of the game-only recognition lean
#:   temperature Gumbel-max temperature over taste; lower = closer to argmax
#:
#: Every style samples only inside the regret cap, so a "fan" can prefer
#: Worthy to a near-equal Marques Johnson but can never take a role player
#: over a star (the QUALITY GATE runs first, on raw PEAK3 points).
BOT_STYLES: dict[str, dict[str, float]] = {
    "balanced": {"peak": 1.0, "need": 0.0, "star": 0.10, "temperature": 0.070},
    "analyst": {"peak": 1.15, "need": 0.0, "star": 0.04, "temperature": 0.055},
    "fan": {"peak": 1.0, "need": 0.0, "star": 0.20, "temperature": 0.075},
    "builder": {"peak": 1.0, "need": 0.45, "star": 0.08, "temperature": 0.070},
}
#: The styles a bot SEAT can be dealt (the adapter's `bot_style`). "balanced"
#: is only the fallback for a projection that names none.
SEAT_STYLES: tuple[str, ...] = ("analyst", "fan", "builder")
DEFAULT_STYLE = "balanced"


def style_for_seat(seed: int | str, seat_index: int) -> str:
    """The style a bot in this seat drafts with. Seeded, stable for the match."""
    return random.Random(f"tmw:{seed}:bot-style:{seat_index}").choice(SEAT_STYLES)


def _style(private: dict) -> dict[str, float]:
    return BOT_STYLES.get(str(private.get("bot_style") or DEFAULT_STYLE), BOT_STYLES[DEFAULT_STYLE])

#: THE QUALITY GATE, IN PEAK3 SCORE POINTS. The single rule that makes a
#: catastrophic pick unreachable.
#:
#: A candidate more than this far below the BEST CANDIDATE THIS SEAT CAN
#: LEGALLY TAKE is not viable, and is removed before the policy ranks anything.
#: `viable_options` applies it; `_sample` never sees the excluded options at
#: all. Three consequences, and each one is a requirement from PART 10:
#:
#:   * "A bot may not pass over peak Stephen Curry for Carl Landry" -- Landry
#:     is fifty points behind and is simply not on the list.
#:   * "...unless Curry would make legal completion impossible" -- a candidate
#:     who cannot be legally placed produces no option, so the gate measures
#:     against the best LEGAL candidate and the carve-out needs no special
#:     case.
#:   * "When the top candidate exceeds the next viable choice by a major
#:     threshold, always select the dominant candidate; do not apply
#:     randomness" -- when only one player survives the gate there is nothing
#:     to sample from, so the guard is the gate rather than a second mechanism
#:     that could disagree with it. `dominant_option` reports exactly that.
#:
#: WHY POINTS AND NOT NORMALISED UNITS. `_utility`'s quality term is normalised
#: against the roll's own spread, which is right for RANKING -- "good for this
#: roll" is what a drafter weighs -- and useless for judging whether a gap is
#: catastrophic, because normalisation destroys the scale. On a two-candidate
#: roll the better player scores 1.0 and the other 0.0 whether they are fifty
#: points apart or half a point apart, so a normalised gate would fire
#: identically for Curry-vs-Landry (50.4 points) and Bogut-vs-Lee (0.54), and
#: would turn the bot into a maximiser on exactly the close calls that should
#: be judgement.
#:
#: WHY 12 AND NOT 5. The positional terms in `_utility` (scarcity, the starter
#: bonus, the replacement gap) exist to let the bot draft around its roster
#: shape rather than down a leaderboard, and taking a scarce centre over a
#: somewhat better wing is a real basketball answer, not a mistake. Twelve
#: points is roughly the difference between a good starter and a very good one
#: in the committed franchise-decade index -- wide enough that genuine
#: positional judgement survives, narrow enough that the thirty-two-point
#: overrides the unbounded model produced cannot recur.
_MAX_QUALITY_REGRET_POINTS = 12.0

#: The smallest quality range `options` will normalise against, in PEAK3
#: points. See the comment at its use site: without a floor, a roll whose
#: candidates are half a point apart normalises to a full 0-1 spread and the
#: utility bands read a rounding difference as a decisive one.
_QUALITY_SPREAD_FLOOR = 20.0

# ---------------------------------------------------------------------------
# A FRANCHISE OR DECADE DRAFT'S ROSTER LEAN (tmw_bot_v3; recognition moved out in v4)
# ---------------------------------------------------------------------------
#: WHY THE ONE-CONSTRAINT DRAFTS NEED MORE THAN THE STANDARD POLICY. A standard
#: round rolls a fresh, shallow franchise x decade cell, so "best for this
#: roll" is a small, local question and the slot/scarcity terms already make
#: the bot draft around its shape. A Franchise or Decade Draft deals all
#: eighteen picks from ONE deep pool, and there the same policy reads as a
#: machine: it would happily take three bigs in a row whenever they topped the
#: list, and it never behaved like a person who has heard of one player and not
#: the other. Two small, general terms fix that -- no player is named anywhere:
#:
#:   * ROSTER CONSTRUCTION. Each player has a natural position GROUP (guard,
#:     wing, big) when most of their canonical positions fall in one. A
#:     candidate whose group this roster already holds twice is marked down per
#:     extra body; one whose group the roster has none of yet (after two picks)
#:     is marked up. Slot legality is untouched -- this only moves close calls.
#:   * RECOGNITION. People lean toward names they know. The general, data-only
#:     proxy for that is a player's career-best PEAK3 season ANYWHERE in the
#:     index, not the constrained card they would be scored on -- so a star who
#:     is merely good under this constraint gets a mild pull. Small on purpose.
#:
#: Both are bounded by the QUALITY GATE, which runs on raw scores before any
#: utility is compared: no lean can reach a player more than
#: `_MAX_QUALITY_REGRET_POINTS` behind the best legal one.
#:
#: v4: RECOGNITION moved out of this variant-only lean into every draft's TASTE
#: (see `BOT_STYLES`), and it is now the honors-based game-only signal in
#: `recognition.py` rather than a career-best PEAK3 score -- a PEAK3 number is
#: not fame, and using it made the "human" lean another read of the same model.
POSITION_GROUPS: dict[str, str] = {"PG": "guard", "SG": "guard", "SF": "wing", "PF": "big", "C": "big"}
_STACKED_GROUP_PENALTY = 0.07
_MISSING_GROUP_BONUS = 0.05
#: A one-constraint draft deals all eighteen picks from ONE deep pool, so many
#: more near-peers sit inside the regret cap than on a standard roll. At the
#: standard temperature that diluted the bot (measured: best option 0.37 of
#: decade picks, mean quality regret 3.1 points). Cooling it keeps the variant
#: bot as strong as the standard one while near-peers still vary (measured at
#: 0.4 over 10 seeds: franchise 0.70 / 1.5 pts, decade 0.56-0.60 / 1.6-1.7).
_VARIANT_TEMPERATURE_SCALE = 0.4

# ---------------------------------------------------------------------------
# DELIBERATION -- how hard a decision LOOKS, for think time only
# ---------------------------------------------------------------------------
#: A utility gap at or above this between the best two PLAYERS reads as an easy
#: call; below it the call closes linearly toward a toss-up.
_DELIBERATION_CLEAR_GAP = 0.20
#: Players and slots within this much utility of the best option count as
#: live contenders for the decision.
_DELIBERATION_CONTENDER_REGRET = 0.06
#: Contenders beyond the best before the crowd term saturates. A one-constraint
#: draft's deep pool always has several; only a real crowd should read as one.
_DELIBERATION_CROWD_SATURATION = 10


def natural_group(player_slug: str | None) -> Optional[str]:
    """guard / wing / big when MOST of a player's canonical positions sit in
    one group; None for a genuinely versatile player (who stacks nothing)."""
    groups = Counter(POSITION_GROUPS[p] for p in canonical_positions(player_slug) if p in POSITION_GROUPS)
    if not groups:
        return None
    group, count = groups.most_common(1)[0]
    return group if count * 2 > sum(groups.values()) else None


#: Basketball archetypes, never real player names. A drafted player's name has
#: to be unambiguous on a board where every other label is also a person, and
#: "The Microwave picks Vinnie Johnson" would be a puzzle rather than a joke.
BOT_ARCHETYPE_NAMES: tuple[str, ...] = (
    "Floor General",
    "The Microwave",
    "Board Man",
    "The Lock",
    "Sixth Man",
    "Stretch Five",
    "The Closer",
    "Glue Guy",
    "Rim Runner",
    "The Enforcer",
    "Point Forward",
    "The Spark",
)


def archetype_names(seed: int | str, count: int) -> tuple[str, ...]:
    """`count` DISTINCT archetype names, deterministic from the match seed.

    Distinct is the requirement, not merely likely: two bots called "The Lock"
    in the same draft would make the pick feed unreadable. Drawn by shuffling
    a copy of the pool, so distinctness is structural rather than a retry loop.
    """
    pool = list(BOT_ARCHETYPE_NAMES)
    random.Random(f"tmw:{seed}:bot-names").shuffle(pool)
    if count <= len(pool):
        return tuple(pool[:count])
    # More bots than archetypes is not a shape this game has, and is numbered
    # rather than duplicated if it ever happens.
    return tuple(
        pool[index % len(pool)] + (f" {index // len(pool) + 1}" if index >= len(pool) else "")
        for index in range(count)
    )


class ThreeManWeaveBot:
    """A drafting policy for Three-Man Weave. Competent, beatable, seeded."""

    def __init__(
        self,
        bot_id: str = "three_man_weave_v2",
        policy_version: str = BOT_POLICY_VERSION,
        rating: float = 1100.0,
    ) -> None:
        self._bot_id = bot_id
        self._policy_version = policy_version
        self._rating = rating

    @property
    def bot_id(self) -> str:
        return self._bot_id

    @property
    def policy_version(self) -> str:
        return self._policy_version

    @property
    def rating(self) -> float:
        return self._rating

    # -- the decision ------------------------------------------------------

    def options(self, public: dict, private: dict) -> list[dict]:
        """Every legal (player, slot) this seat could commit, scored and ranked.

        Ranked highest-utility first, ties broken by slug so the order is a
        function of the projection alone. The caller then SAMPLES from this --
        it is deliberately not "the answer".
        """
        fits = private.get("candidate_fits") or {}
        if not fits:
            return []

        quality = self._quality(public, private)
        open_slots = set(private.get("open_slots") or ())
        supply = self._slot_supply(fits, open_slots)

        values = [value for value in quality.values() if math.isfinite(value)]
        if not values:
            return []
        # A one-constraint draft adds the human lean (see POSITION_GROUPS).
        variant = bool((public.get("constraint") or {}).get("kind"))
        own_picks = [slug for slug in (private.get("assignment") or {}).values() if slug]
        own_groups = Counter(g for g in (natural_group(slug) for slug in own_picks) if g)
        best_overall = max(values)
        worst_overall = min(values)
        # THE SPREAD HAS A FLOOR, and it is not merely a divide-by-zero guard.
        #
        # Normalising against the roll's OWN min and max means the top and
        # bottom candidates always land on 1.0 and 0.0 -- whether they are
        # fifty PEAK3 points apart or half a point apart. On a thin roll that
        # manufactures a chasm out of nothing: two near-identical bigs would
        # produce a utility gap of over 1.0, which the deviation bands would
        # then read as "decisive" and refuse to choose between. Clamping the
        # denominator to `_QUALITY_SPREAD_FLOOR` points makes `normalised` mean
        # the same thing on every roll -- "how far ahead, on a scale where this
        # many points is the whole range" -- so a small real difference stays a
        # small utility difference and the bands stay calibrated.
        spread = max(_QUALITY_SPREAD_FLOOR, best_overall - worst_overall)

        # Replacement level per slot: the best OTHER candidate who could fill
        # it. What a slot is really worth is the gap to its alternative.
        by_slot_scores: dict[str, list[float]] = {}
        for slug, fit in fits.items():
            score = quality.get(slug)
            if score is None or not math.isfinite(score):
                continue
            for slot in self._slots_of(fit, open_slots):
                by_slot_scores.setdefault(slot, []).append(score)
        for scores in by_slot_scores.values():
            scores.sort(reverse=True)

        out: list[dict] = []
        for slug in sorted(fits):
            fit = fits[slug]
            score = quality.get(slug)
            if score is None or not math.isfinite(score):
                # No card for this roll means the reducer could not score them
                # either. Never drafted by accident.
                continue
            normalised = (score - worst_overall) / spread
            for slot in self._slots_of(fit, open_slots):
                alternatives = by_slot_scores.get(slot, ())
                replacement = alternatives[1] if len(alternatives) > 1 else worst_overall
                replacement_gap = (score - replacement) / spread
                out.append(
                    {
                        "player_slug": slug,
                        "slot_type": slot,
                        "state": fit.get("state"),
                        # BOTH SCALES ARE CARRIED. `quality` is the
                        # roll-normalised value the utility ranking is built
                        # from; `score` is the raw franchise-decade PEAK3
                        # season the guards are measured in. Keeping them
                        # separate is what stops a two-candidate roll from
                        # looking like a chasm -- see `_DOMINANCE_SCORE_GAP`.
                        "quality": normalised,
                        "score": score,
                        # The roster-NEED share of utility, carried so a
                        # "builder" style can lean on it (`_taste`).
                        "need": self._need(
                            replacement_gap=replacement_gap,
                            slot=slot,
                            slot_supply=supply.get(slot, 1),
                        ),
                        "utility": self._utility(
                            normalised=normalised,
                            replacement_gap=replacement_gap,
                            slot=slot,
                            open_slots=open_slots,
                            slot_supply=supply.get(slot, 1),
                            candidate_flexibility=len(self._slots_of(fit, open_slots)),
                            needs_rearrangement=fit.get("state") == FITS_AFTER_REARRANGEMENT,
                        )
                        + (self._drafter_lean(slug, own_groups, len(own_picks)) if variant else 0.0),
                    }
                )

        out.sort(key=lambda option: (-option["utility"], option["player_slug"], option["slot_type"]))
        return out

    @staticmethod
    def _drafter_lean(player_slug: str, own_groups: Counter, picks_made: int) -> float:
        """Roster construction, for a one-constraint draft. (Recognition moved
        to every draft's taste in v4 -- see `BOT_STYLES`.)"""
        value = 0.0
        group = natural_group(player_slug)
        if group is not None:
            held = own_groups.get(group, 0)
            if held >= 2:
                value -= _STACKED_GROUP_PENALTY * (held - 1)
            elif held == 0 and picks_made >= 2:
                value += _MISSING_GROUP_BONUS
        return value

    @staticmethod
    def _slots_of(fit: dict, open_slots: set[str]) -> tuple[str, ...]:
        """The slots this fit lets the candidate land on, in canonical order."""
        state = fit.get("state")
        if state == FITS_NOW:
            return tuple(
                slot for slot in SLOT_TYPES if slot in (fit.get("direct_slots") or ())
            )
        if state == FITS_AFTER_REARRANGEMENT:
            plan = fit.get("plan") or {}
            landed = [slot for slot, slug in plan.items() if slug == fit.get("player_slug")]
            return tuple(landed)
        return ()

    @staticmethod
    def _slot_supply(fits: dict, open_slots: set[str]) -> dict[str, int]:
        """How many candidates on this roll could fill each open slot."""
        supply: dict[str, int] = {slot: 0 for slot in open_slots}
        for fit in fits.values():
            for slot in fit.get("direct_slots") or ():
                if slot in supply:
                    supply[slot] += 1
        return supply

    @staticmethod
    def _need(*, replacement_gap: float, slot: str, slot_supply: int) -> float:
        """The roster-need terms of `_utility`, on their own: the replacement
        gap, the starter-vs-bench term and slot scarcity."""
        return (
            replacement_gap * 0.35
            + (0.12 if slot in STARTER_SLOT_TYPES else -0.10)
            + 0.25 / max(1, slot_supply)
        )

    @staticmethod
    def _utility(
        *,
        normalised: float,
        replacement_gap: float,
        slot: str,
        open_slots: set[str],
        slot_supply: int,
        candidate_flexibility: int,
        needs_rearrangement: bool,
    ) -> float:
        """One option's worth, on an arbitrary but consistent scale.

        Quality dominates, as it should -- but not so completely that the
        other four terms are decoration. Measured over seeded matches, the
        non-quality terms change the chosen option often enough that the bot
        drafts around its roster shape rather than down a leaderboard.
        """
        value = normalised * 1.0
        # A big gap to the next-best option for the same slot is the real
        # prize: it is the part of quality nobody else can take from you.
        value += replacement_gap * 0.35
        # Starters carry the lineup; the bench slot is worth filling but not
        # worth spending the roll's best player on.
        value += 0.12 if slot in STARTER_SLOT_TYPES else -0.10
        # Scarcity: the fewer candidates who can fill this slot, the more
        # urgent it is to fill it now.
        value += 0.25 / max(1, slot_supply)
        # A candidate who fits many of my slots keeps options open, so
        # spending them is slightly cheaper to defer.
        value -= 0.04 * max(0, candidate_flexibility - 1)
        # Rearranging is legal and sometimes right, but a bot should prefer
        # the simpler board when the two are otherwise close.
        if needs_rearrangement:
            value -= 0.08
        return value

    def decide(
        self, public: dict, private: dict, rng: random.Random
    ) -> Optional[tuple[str, dict]]:
        """Return `(command_type, payload)`, or None when nothing is legal.

        None is a real answer and NOT an error: a seat with no legal pick is a
        state roll feasibility is supposed to prevent, so the driver escalates
        it to the turn's timeout resolution rather than guessing.
        """
        options = self.options(public, private)
        if not options:
            return None

        variant = bool((public.get("constraint") or {}).get("kind"))
        chosen = self._sample(options, rng, _style(private), variant=variant)
        payload: dict = {
            "player_slug": chosen["player_slug"],
            "slot_type": chosen["slot_type"],
        }
        if chosen["state"] == FITS_AFTER_REARRANGEMENT:
            fit = (private.get("candidate_fits") or {}).get(chosen["player_slug"]) or {}
            plan = fit.get("plan")
            if plan:
                # The SERVER's own plan, echoed back rather than reinvented, so
                # the arrangement the bot commits is the one the projection
                # said was legal.
                payload["placements"] = dict(plan)
        return COMMAND_PICK, payload

    @staticmethod
    def viable_options(options: list[dict]) -> list[dict]:
        """`options`, minus everyone the quality gate excludes.

        THE ONE PLACE A CATASTROPHIC PICK IS MADE UNREACHABLE, and it is a
        FILTER rather than a tie-break, because a tie-break can always be
        outvoted by enough positional bonus. Measured in PEAK3 points against
        the best candidate this seat can legally take -- see
        `_MAX_QUALITY_REGRET_POINTS` for why points and why twelve.

        Applied AFTER `options` has ranked everything, not inside it, so the
        full ranking stays available for diagnostics and for the regret
        measurements the simulation reports. The order is preserved, so
        `viable_options(...)[0]` is still the best option the policy may take.
        """
        if not options:
            return []
        floor = max(option["score"] for option in options) - _MAX_QUALITY_REGRET_POINTS
        viable = [option for option in options if option["score"] >= floor]
        # The top-scoring option always clears its own floor, so this cannot be
        # empty; kept as a guarantee rather than an assumption.
        return viable or [max(options, key=lambda option: option["score"])]

    @staticmethod
    def dominant_option(options: list[dict]) -> Optional[dict]:
        """The option the policy is REQUIRED to take, or None if it is a
        judgement call.

        Dominance is not a second mechanism sitting beside the quality gate --
        it IS the gate, reported. When only one player survives
        `viable_options`, every alternative is more than
        `_MAX_QUALITY_REGRET_POINTS` behind and there is nothing left to
        sample: randomness is not "switched off", it has nothing to act on.
        Deriving it this way rather than from a second threshold means the two
        rules cannot drift apart.

        Published so a regression can assert it directly. "Given this roll the
        bot must take Curry" is a statement about this function, and a test
        that could only observe it through two thousand samples would be a slow
        proxy for a rule.
        """
        viable = ThreeManWeaveBot.viable_options(options)
        if not viable:
            return None
        if len({option["player_slug"] for option in viable}) > 1:
            return None
        # `viable` preserves the utility order, so this is that player's best
        # slot rather than an arbitrary one.
        return viable[0]

    @staticmethod
    def is_dominant(options: list[dict]) -> bool:
        """Whether this roll is decisive at all. A convenience over
        `dominant_option`, kept because "is this a judgement call" reads better
        at an assertion site than a None check."""
        return ThreeManWeaveBot.dominant_option(options) is not None

    @staticmethod
    def taste(option: dict, style: dict[str, float]) -> float:
        """What this style thinks of one option: utility, the style's extra
        weight on roster need, and the game-only recognition lean."""
        return (
            style["peak"] * option["utility"]
            + style["need"] * option.get("need", 0.0)
            + style["star"] * recognition(option["player_slug"])
        )

    @staticmethod
    def candidate_pool(options: list[dict]) -> list[dict]:
        """The options a draw may land on: viable (the quality gate) AND within
        `_MILD_DEVIATION_REGRET` utility of the best viable option. Utility
        order preserved; never empty when `options` is not."""
        viable = ThreeManWeaveBot.viable_options(options)
        if not viable:
            return []
        best = viable[0]
        return [o for o in viable if best["utility"] - o["utility"] <= _MILD_DEVIATION_REGRET]

    @staticmethod
    def _sample(
        options: list[dict],
        rng: random.Random,
        style: Optional[dict[str, float]] = None,
        *,
        variant: bool = False,
    ) -> dict:
        """Draw one option. THE ORDER OF THE THREE RULES BELOW IS THE POLICY.

        1. THE QUALITY GATE FIRST. When one candidate is decisively ahead of
           the board they are the only survivor and the pick is forced: no
           randomness is consumed -- a bot that rolled dice on "superstar or
           role player" would be broken however good its distribution looked.
        2. THE REGRET CAP. Only options within `_MILD_DEVIATION_REGRET` of the
           best surviving utility are drawable, so no draw is a catastrophic
           miss -- a property of the list, not of the noise.
        3. GUMBEL-MAX OVER TASTE at the style's temperature: equivalent to a
           softmax draw, so an option is chosen with probability proportional
           to exp(taste / T). Clearly better options dominate, near-peers
           vary, and a recognised name gets a modest pull. One uniform is drawn
           per option in the list's fixed order, so a seed reproduces a pick.
        """
        if not options:  # pragma: no cover - callers check first
            raise ValueError("no options to sample from")
        style = style or BOT_STYLES[DEFAULT_STYLE]
        pool = ThreeManWeaveBot.candidate_pool(options)
        if len(pool) == 1:
            return pool[0]
        temperature = style["temperature"] * (_VARIANT_TEMPERATURE_SCALE if variant else 1.0)
        best_option, best_key = pool[0], float("-inf")
        for option in pool:
            u = min(max(rng.random(), 1e-12), 1.0 - 1e-12)
            key = ThreeManWeaveBot.taste(option, style) / temperature - math.log(-math.log(u))
            if key > best_key:
                best_option, best_key = option, key
        return best_option

    # -- deliberation: presentation only ------------------------------------

    def deliberation(self, public: dict, private: dict) -> float:
        """How hard this decision LOOKS, 0 (obvious) .. 1 (agonising).

        Read by the mode's think-time hook and nothing else: it never changes
        what the bot picks. RNG-free and a pure function of the projection, so
        every poller computes the same think time.

          * FORCED -- the quality gate leaves one player -- is near zero.
          * CLOSENESS: the utility gap between the best two PLAYERS (their best
            slot each), closing linearly below `_DELIBERATION_CLEAR_GAP`.
          * CROWD: how many players are live contenders.
          * FIT: how many different slots the live contenders would fill -- a
            decision about roster shape as well as about players.
          * A best option that needs a rearrangement adds a little.
        """
        options = self.options(public, private)
        if not options:
            return 0.0
        if self.dominant_option(options) is not None:
            return 0.05
        viable = self.viable_options(options)
        best = viable[0]
        per_player: dict[str, float] = {}
        for option in viable:  # utility order, so the first seen is each player's best
            per_player.setdefault(option["player_slug"], option["utility"])
        utilities = sorted(per_player.values(), reverse=True)
        gap = utilities[0] - utilities[1] if len(utilities) > 1 else _DELIBERATION_CLEAR_GAP
        closeness = 1.0 - min(1.0, max(0.0, gap) / _DELIBERATION_CLEAR_GAP)
        contenders = sum(1 for u in utilities if utilities[0] - u <= _DELIBERATION_CONTENDER_REGRET)
        crowd = min(1.0, (contenders - 1) / _DELIBERATION_CROWD_SATURATION)
        slots = {
            option["slot_type"]
            for option in viable
            if best["utility"] - option["utility"] <= _DELIBERATION_CONTENDER_REGRET
        }
        fit = min(1.0, (len(slots) - 1) / 3)
        value = 0.60 * closeness + 0.15 * crowd + 0.15 * fit
        if best.get("state") == FITS_AFTER_REARRANGEMENT:
            value += 0.08
        return round(min(1.0, max(0.0, value)), 4)

    # -- quality, the one thing the projection no longer publishes ----------

    @staticmethod
    def _quality(public: dict, private: dict) -> dict[str, float]:
        """Each candidate's franchise-decade PEAK3 season score.

        Read from the committed eligibility index, for the SAME franchise and
        decade the pick would be made on -- so the bot is estimating exactly
        what the match will be scored on, never a career best from elsewhere.

        Falls back to whatever the projection carries if the index is
        unavailable (it is not, in any shipped configuration), so a policy is
        never left unable to decide.
        """
        roll = public.get("current_roll") or {}
        franchise_id = roll.get("franchise_id")
        decade = roll.get("decade")
        slugs = [
            candidate.get("player_slug")
            for candidate in (roll.get("candidates") or [])
            if candidate.get("player_slug")
        ]

        out: dict[str, float] = {}
        constraint = public.get("constraint") or None
        if constraint and constraint.get("kind") and constraint.get("value"):
            # FRANCHISE / DECADE DRAFT: every candidate is scored on its best
            # card under the one constraint -- the same estimate as the rolled
            # cell in the standard game, over the open dimension.
            from nba_peak.three_man_weave.variants import best_card_score

            for slug in slugs:
                score = best_card_score(constraint["kind"], constraint["value"], slug)
                out[slug] = float(score) if score is not None else float("-inf")
            return out
        if franchise_id and decade:
            try:
                from nba_peak.three_man_weave.eligibility import get_index

                index = get_index()
            except Exception:  # pragma: no cover - defensive
                index = None
            if index is not None:
                for slug in slugs:
                    card = index.scoring_card(slug, franchise_id, decade)
                    out[slug] = float(card.prime_score) if card else float("-inf")
                return out

        for candidate in roll.get("candidates") or []:  # pragma: no cover - fallback
            card = candidate.get("scoring_card") or {}
            value = card.get("prime_score")
            out[candidate.get("player_slug")] = (
                float(value) if isinstance(value, (int, float)) else float("-inf")
            )
        return out

    # -- the foundation's async entry point ---------------------------------

    async def choose(self, view: Any, rng: Any) -> Any:
        """Adapt `decide` to the `BotPolicy` protocol.

        Imported lazily so this module stays importable -- and unit-testable --
        without the API package on the path. `nba_peak/` is the pure-rules layer
        and must not hard-depend on `apps/api`.
        """
        from app.repositories.arena_protocols import BotCommand

        if COMMAND_PICK not in (view.legal_commands or ()):
            return None
        decision = self.decide(dict(view.public_state), dict(view.private_state), rng)
        if decision is None:
            return None
        command, payload = decision
        return BotCommand(command_type=command, payload=payload)


__all__ = [
    "BOT_ARCHETYPE_NAMES",
    "COMMAND_PICK",
    "POSITION_GROUPS",
    "natural_group",
    "recognition",
    "style_for_seat",
    "BOT_STYLES",
    "SEAT_STYLES",
    "ThreeManWeaveBot",
    "archetype_names",
]
