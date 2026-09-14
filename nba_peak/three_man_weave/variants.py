"""Three-Man Weave rulesets that hold ONE constraint for the whole draft.

  standard    a fresh franchise x decade roll every round (the original game)
  franchise   FRANCHISE DRAFT: one franchise, drawn once, for all 18 picks
  decade      DECADE DRAFT: one decade, drawn once, for all 18 picks

WHAT STAYS THE SAME. Three seats, six rounds, the fixed A-B-C / C-B-A snake,
six position-legal slots, the global identity lock, rearrangement, staging,
timeouts, bots, scoring. A variant changes exactly one thing: which pool a
round draws from. Everything else is the draft engine the standard game uses.

WHICH SEASON A PICK IS SCORED ON. The standard game scores a pick on the
player's best PEAK3 season FOR the rolled franchise IN the rolled decade. A
variant fixes only one of those two, so the card is the same rule over the
open dimension: Franchise Draft scores the player's best season with that
franchise in any decade; Decade Draft scores the best season in that decade
with any franchise. The resolved card stays on the server until the pick is
made -- exactly like the standard game, where the season is published only
once drafted -- so the projection never reveals which decade (or franchise) a
player's best card sits in.

WHY THE WHOLE DRAFT MUST STAY COMPLETABLE. The standard game draws a fresh,
feasibility-checked roll every round from a pool of well over a thousand
identities, so only the current round can be stranded (`draft.round_keepers`).
A variant draws all eighteen picks from one pool of a few dozen to a few hundred
players: taking the franchise's last real centre in round two can leave a seat
with an open C slot in round six and nobody to fill it. So in a variant a pick
is legal only if every roster can still be completed from what remains
(`CompletionOracle`), which also guarantees every later seat in the round a
distinct pick. The check is the same fixed-open-slot matching roll feasibility
has always used.
"""
from __future__ import annotations

import functools
from dataclasses import dataclass, field
from typing import Mapping, Optional, Sequence

from nba_peak.franchises import franchise_display_name
from nba_peak.three_man_weave.config import PARTICIPANT_COUNT, SLOT_TYPES, stream_rng
from nba_peak.three_man_weave.eligibility import EligibilityIndex, rights_for_cards
from nba_peak.three_man_weave.matching import maximum_matching
from nba_peak.three_man_weave.positions import SlotRights, is_legal
from nba_peak.three_man_weave.schemas import Roll

VARIANT_STANDARD = "standard"
VARIANT_FRANCHISE = "franchise"
VARIANT_DECADE = "decade"
VARIANTS: tuple[str, ...] = (VARIANT_STANDARD, VARIANT_FRANCHISE, VARIANT_DECADE)

#: The open dimension's placeholder on a variant's per-round `Roll`.
ANY_FRANCHISE = "ANY"
ANY_DECADE = "any"

#: A constraint is offered only if its pool is at least this deep. Eighteen
#: picks are needed; a pool barely larger than that is a forced march rather
#: than a draft, so the floor keeps real choices on the board in round six.
MIN_POOL_IDENTITIES = 36

#: Bumped whenever the constraint space, the card rule or the viability rule
#: changes what a seeded variant match looks like.
VARIANT_RULES_VERSION = "tmw_variants_v1"


@dataclass(frozen=True)
class Constraint:
    """The one constraint a variant match drafts under, fixed at creation."""

    kind: str  # VARIANT_FRANCHISE | VARIANT_DECADE
    value: str  # a franchise id or a decade label
    label: str  # "Golden State Warriors" / "1980s"
    #: Every eligible identity's scoring card under this constraint, as
    #: (player_slug, franchise_id, decade), sorted by slug. Persisted in the
    #: snapshot so a match never re-resolves its cards mid-draft.
    cards: tuple[tuple[str, str, str], ...] = field(default=())

    @functools.cached_property
    def _by_slug(self) -> dict[str, tuple[str, str]]:
        return {slug: (franchise_id, decade) for slug, franchise_id, decade in self.cards}

    @property
    def pool(self) -> tuple[str, ...]:
        return tuple(slug for slug, _f, _d in self.cards)

    def card_key(self, player_slug: str) -> Optional[tuple[str, str]]:
        return self._by_slug.get(player_slug)

    @property
    def franchise_id(self) -> str:
        return self.value if self.kind == VARIANT_FRANCHISE else ANY_FRANCHISE

    @property
    def decade(self) -> str:
        return self.value if self.kind == VARIANT_DECADE else ANY_DECADE

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "value": self.value,
            "label": self.label,
            "rules_version": VARIANT_RULES_VERSION,
            "cards": [list(card) for card in self.cards],
        }

    def public_dict(self) -> dict:
        """What a seat may see: the constraint, never the resolved cards."""
        return {"kind": self.kind, "value": self.value, "label": self.label}

    @classmethod
    def from_dict(cls, data: dict) -> "Constraint":
        return cls(
            kind=data["kind"],
            value=data["value"],
            label=data["label"],
            cards=tuple(tuple(card) for card in data.get("cards") or ()),  # type: ignore[misc]
        )


def constraint_roll(constraint: Constraint, round_number: int, drafted: frozenset[str]) -> Roll:
    """A variant round's `Roll`: the constraint, with the players still undrafted.

    A variant still hands the draft engine one `Roll` per round so every piece
    that reads a roll -- the candidate list, the identity lock, slot rights,
    the pick surface -- works unchanged. The open dimension is a placeholder
    (`ANY_FRANCHISE` / `ANY_DECADE`); a candidate's actual card comes from
    `DraftState.card_key`, never from the roll.
    """
    return Roll(
        round_number=round_number,
        franchise_id=constraint.franchise_id,
        franchise_display_name=constraint.label if constraint.kind == VARIANT_FRANCHISE else "All franchises",
        decade=constraint.decade,
        eligible_slugs=tuple(slug for slug in constraint.pool if slug not in drafted),
    )


# ---------------------------------------------------------------------------
# Cards and pools
# ---------------------------------------------------------------------------


def resolve_cards(index: EligibilityIndex, kind: str, value: str) -> tuple[tuple[str, str, str], ...]:
    """Each eligible identity's best card under a constraint.

    Ties keep the first (franchise, decade) in the index's stable sorted roll
    order, so the answer never depends on dict iteration.
    """
    best: dict[str, tuple[float, str, str]] = {}
    for franchise_id, decade in index.rolls():
        if kind == VARIANT_FRANCHISE and franchise_id != value:
            continue
        if kind == VARIANT_DECADE and decade != value:
            continue
        for slug in sorted(index.eligible_slugs(franchise_id, decade)):
            card = index.scoring_card(slug, franchise_id, decade)
            if card is None:
                continue
            if slug not in best or card.prime_score > best[slug][0]:
                best[slug] = (card.prime_score, franchise_id, decade)
    return tuple(sorted((slug, f, d) for slug, (_score, f, d) in best.items()))


def _label(kind: str, value: str) -> str:
    if kind == VARIANT_FRANCHISE:
        return franchise_display_name(value) or value
    return value


def _rights(index: EligibilityIndex, cards: Sequence[tuple[str, str, str]]) -> SlotRights:
    return rights_for_cards(index, committed=list(cards), potential=())


@functools.lru_cache(maxsize=4)
def viable_constraints(kind: str, participants: int = PARTICIPANT_COUNT) -> tuple[Constraint, ...]:
    """Every constraint of `kind` a match may draw: deep enough, and able to
    complete every roster from its own pool. Cached per process -- the index
    is immutable -- and warmed at API import so no request pays for it."""
    from nba_peak.three_man_weave.eligibility import get_index

    index = get_index()
    if kind == VARIANT_FRANCHISE:
        values = sorted({franchise_id for franchise_id, _decade in index.rolls()})
    elif kind == VARIANT_DECADE:
        values = sorted({decade for _franchise_id, decade in index.rolls()})
    else:
        raise ValueError(f"{kind!r} is not a one-constraint variant")

    out: list[Constraint] = []
    for value in values:
        cards = resolve_cards(index, kind, value)
        if len(cards) < MIN_POOL_IDENTITIES:
            continue
        oracle = CompletionOracle(
            {seat: SLOT_TYPES for seat in range(participants)},
            [slug for slug, _f, _d in cards],
            _rights(index, cards),
        )
        if not oracle.complete:
            continue
        out.append(Constraint(kind=kind, value=value, label=_label(kind, value), cards=cards))
    return tuple(out)


def choose_constraint(kind: str, seed: int | str, participants: int = PARTICIPANT_COUNT) -> Constraint:
    """The constraint a seeded match drafts under. Deterministic from the seed,
    on its own named stream, uniform over the viable space."""
    options = viable_constraints(kind, participants)
    if not options:  # pragma: no cover - the committed index always has some
        raise ValueError(f"no viable {kind} constraint in the eligibility index")
    rng = stream_rng(seed, f"constraint:{kind}")
    return options[rng.randrange(len(options))]


def best_card_score(kind: str, value: str, player_slug: str) -> Optional[float]:
    """The prime score of `player_slug`'s card under a constraint, or None.
    Used by the bot, which estimates a candidate on exactly what it would be
    scored on (the standard game's bot reads the rolled cell's card)."""
    return _scores_for(kind, value).get(player_slug)


@functools.lru_cache(maxsize=64)
def _scores_for(kind: str, value: str) -> dict[str, float]:
    from nba_peak.three_man_weave.eligibility import get_index

    index = get_index()
    scores: dict[str, float] = {}
    for slug, franchise_id, decade in resolve_cards(index, kind, value):
        card = index.scoring_card(slug, franchise_id, decade)
        if card is not None:
            scores[slug] = float(card.prime_score)
    return scores


# ---------------------------------------------------------------------------
# Completability
# ---------------------------------------------------------------------------


class CompletionOracle:
    """Can every open slot, across every roster, still be filled from a pool --
    and would it still be possible after the seat on the clock takes player
    `p` into its open slot `x`?

    One maximum matching of (seat, slot) -> player is computed up front. A
    query then costs at most ONE augmenting-path search: removing the queried
    slot frees the player it was matched to, and only the slot that `p` was
    matched to (if any) needs a replacement. That keeps a whole candidate list
    of several hundred players to a few milliseconds.
    """

    def __init__(
        self,
        open_slots_by_seat: Mapping[int, Sequence[str]],
        pool: Sequence[str],
        rights: SlotRights,
    ) -> None:
        self.left: list[tuple[int, str]] = [
            (seat, slot) for seat, slots in sorted(open_slots_by_seat.items()) for slot in slots
        ]
        players = list(dict.fromkeys(pool))
        by_slot = {
            slot: tuple(player for player in players if is_legal(player, slot, rights))
            for slot in {slot for _seat, slot in self.left}
        }
        self.adjacency = {node: by_slot[node[1]] for node in self.left}
        self.match_right = maximum_matching(self.left, self.adjacency)  # player -> node
        self.match_left = {node: player for player, node in self.match_right.items()}
        self.complete = len(self.match_right) == len(self.left)

    def keeps_completable(self, seat: int, slot: str, player: str) -> bool:
        if not self.complete:
            # Already cornered: not this rule's to refuse (see `draft.round_keepers`).
            return True
        taken = (seat, slot)
        freed = self.match_left.get(taken)
        if freed is None:  # pragma: no cover - every open slot is matched when complete
            return False
        if freed == player or player not in self.match_right:
            return True
        needs = self.match_right[player]
        match_right = dict(self.match_right)
        del match_right[freed]
        del match_right[player]

        def augment(node: tuple[int, str], seen: set[str]) -> bool:
            for target in self.adjacency.get(node, ()):
                if target == player or target in seen:
                    continue
                seen.add(target)
                holder = match_right.get(target)
                if holder is None or augment(holder, seen):
                    match_right[target] = node
                    return True
            return False

        return augment(needs, set())


__all__ = [
    "ANY_DECADE",
    "ANY_FRANCHISE",
    "CompletionOracle",
    "Constraint",
    "MIN_POOL_IDENTITIES",
    "VARIANTS",
    "VARIANT_DECADE",
    "VARIANT_FRANCHISE",
    "VARIANT_RULES_VERSION",
    "VARIANT_STANDARD",
    "best_card_score",
    "choose_constraint",
    "constraint_roll",
    "resolve_cards",
    "viable_constraints",
]
