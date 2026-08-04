"""The Three-Man Weave bot: a drafting policy that sees only what a human sees.

WHY THIS MODE MUST SHIP ONE
---------------------------
`RandomLegalBot` emits an EMPTY payload, and its own docstring says a mode whose
commands need arguments "should ship its own policy". Three-Man Weave's only
command is `tmw_pick`, which needs a `player_slug` and a `slot_type`. Without a
policy, every bot seat sent an argument-less pick, the reducer rejected it as a
bad payload, and the seat sat there until the 45-second turn clock expired and
the deterministic auto-pick resolved it. A one-human/two-bot draft therefore
took eighteen timeouts -- about thirteen minutes of a player watching nothing
happen -- which is the reported "bots stall the draft".

WHAT IT IS ALLOWED TO KNOW
---------------------------
`decide` takes the two dicts the mode's own `project` produced for THIS seat.
The current roll is in there; FUTURE ROLLS ARE NOT, and not because they are
filtered -- they do not exist yet. A roll is drawn against the live draft state
when its round opens, so there is no future-roll field in the snapshot to leak,
strip or forget (`services/three_man_weave/mode.py`'s module docstring).

Scores ARE visible here, unlike The $20 Showdown. That is the mode's own
published rule and not an asymmetry: `project` puts each candidate's scoring
card in `public_state`, so the human sitting opposite reads exactly the same
numbers. A draft is open information; the hidden-information boundary in this
mode is temporal, not per-seat.

THE POLICY
----------
Best available, deliberately the SAME policy `autopick.auto_pick` commits on a
timeout, expressed against the projection instead of the authoritative state:
rank the roll's undrafted, legal candidates by the scoring card the roster will
actually be graded on, break exact ties with the driver's seeded RNG, and take
the first legal slot in canonical order.

Matching the auto-pick is the point. A bot that drafted differently from the
timeout resolution would mean a match's outcome depended on whether a seat was
occupied by a bot or by an absent human, which is a difference players would
feel and could not see.
"""
from __future__ import annotations

import random
from typing import Any, Optional

from nba_peak.three_man_weave.config import BOT_POLICY_VERSION, SLOT_TYPES

COMMAND_PICK = "tmw_pick"


class ThreeManWeaveBot:
    """A drafting policy for Three-Man Weave.

    Registered against the mode so practice and a bot-filled public queue have a
    real opponent that moves in a second rather than in three quarters of a
    minute.
    """

    def __init__(
        self,
        bot_id: str = "three_man_weave_v1",
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

    def decide(
        self, public: dict, private: dict, rng: random.Random
    ) -> Optional[tuple[str, dict]]:
        """Return `(command_type, payload)`, or None when nothing is legal.

        None is a real answer and NOT an error: a seat with no legal pick is a
        state roll feasibility is supposed to prevent, so the driver escalates
        it to the turn's timeout resolution rather than guessing.
        """
        options = private.get("legal_picks") or {}
        if not options:
            return None

        scores = self._scores(public)

        # One RNG draw per candidate, consumed in SORTED order so the sequence
        # depends only on (projection, seed) and never on dict iteration order.
        jitter = {slug: rng.random() for slug in sorted(options)}

        def rank(slug: str) -> tuple[float, float, str]:
            return (-scores.get(slug, float("-inf")), jitter[slug], slug)

        for slug in sorted(options, key=rank):
            slots = [s for s in SLOT_TYPES if s in (options.get(slug) or ())]
            if not slots:
                continue
            return COMMAND_PICK, {"player_slug": slug, "slot_type": slots[0]}
        return None

    @staticmethod
    def _scores(public: dict) -> dict[str, float]:
        """Each candidate's scoring-card `prime_score`, from the projection.

        A candidate with no scoring card scores `-inf` rather than 0.0: absent
        is not zero, and ranking an unscoreable identity alongside a genuinely
        weak one would draft it by accident.
        """
        roll = public.get("current_roll") or {}
        out: dict[str, float] = {}
        for candidate in roll.get("candidates") or []:
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
            # Not this seat's turn, or the mode offered nothing. Returning an
            # empty pick would be rejected and burn the turn; returning the
            # command with no payload is exactly the baseline bug this policy
            # exists to fix.
            return None
        decision = self.decide(dict(view.public_state), dict(view.private_state), rng)
        if decision is None:
            return None
        command, payload = decision
        return BotCommand(command_type=command, payload=payload)


__all__ = ["ThreeManWeaveBot", "COMMAND_PICK"]
