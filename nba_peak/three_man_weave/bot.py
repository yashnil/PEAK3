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

Then it CHOOSES PROBABILISTICALLY from three bands rather than taking the
maximum: roughly 70% from the strongest group, 25% a defensible non-optimal
option, 5% a mild mistake. The bands are ordinal over the ranked options, so
the calibration holds whatever the roll looks like.

WHAT IT WILL NOT DO, EVER
--------------------------
Make an illegal pick, break the identity lock, take a player whose placement
makes its own roster impossible to complete, or intentionally throw. The
"mistake" band is drawn from the middle of the ranking and never from the
bottom quarter: an imperfect drafter takes the third-best wing, not the worst
player on the board.
"""
from __future__ import annotations

import math
import random
from typing import Any, Optional

from nba_peak.three_man_weave.arrangement import (
    FITS_AFTER_REARRANGEMENT,
    FITS_NOW,
)
from nba_peak.three_man_weave.config import (
    BOT_POLICY_VERSION,
    SLOT_TYPES,
    STARTER_SLOT_TYPES,
)

COMMAND_PICK = "tmw_pick"

#: Ordinal bands over the ranked options, as fractions of the option list.
#: The first band is at least one option wide however short the list is, so a
#: two-option roll still has a "strong" choice to make.
_STRONG_BAND = 0.20
_DEFENSIBLE_BAND = 0.55
#: A mistake is drawn from the middle, never the tail. Options ranked below
#: this fraction are unreachable: the bot is imperfect, not self-sabotaging.
_MISTAKE_FLOOR = 0.80

#: Calibration targets from the brief. Not branches -- weights over the bands.
_BAND_WEIGHTS = (0.70, 0.25, 0.05)

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
        best_overall = max(values)
        worst_overall = min(values)
        spread = max(1e-6, best_overall - worst_overall)

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
                out.append(
                    {
                        "player_slug": slug,
                        "slot_type": slot,
                        "state": fit.get("state"),
                        "utility": self._utility(
                            normalised=normalised,
                            replacement_gap=(score - replacement) / spread,
                            slot=slot,
                            open_slots=open_slots,
                            slot_supply=supply.get(slot, 1),
                            candidate_flexibility=len(self._slots_of(fit, open_slots)),
                            needs_rearrangement=fit.get("state") == FITS_AFTER_REARRANGEMENT,
                        ),
                    }
                )

        out.sort(key=lambda option: (-option["utility"], option["player_slug"], option["slot_type"]))
        return out

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

        chosen = self._sample(options, rng)
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
    def _sample(options: list[dict], rng: random.Random) -> dict:
        """Draw one option from the three calibration bands.

        Bands are computed from the list length, so they mean the same thing
        on a two-option roll and a forty-option one. An empty band falls
        through to the previous non-empty one rather than to a uniform draw,
        because falling back to "anything" is how a 5% mistake rate becomes a
        100% one on a short list.
        """
        count = len(options)
        strong_end = max(1, math.ceil(count * _STRONG_BAND))
        defensible_end = max(strong_end, math.ceil(count * _DEFENSIBLE_BAND))
        mistake_end = max(defensible_end, math.ceil(count * _MISTAKE_FLOOR))

        bands = [
            options[0:strong_end],
            options[strong_end:defensible_end],
            options[defensible_end:mistake_end],
        ]

        roll = rng.random()
        cumulative = 0.0
        for band, weight in zip(bands, _BAND_WEIGHTS):
            cumulative += weight
            if roll < cumulative and band:
                return band[rng.randrange(len(band))]
        # Every band above this one was empty (a very short option list).
        for band in reversed(bands):
            if band:
                return band[rng.randrange(len(band))]
        return options[0]  # pragma: no cover - count >= 1 guarantees a band

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
    "ThreeManWeaveBot",
    "archetype_names",
]
