"""PRIME CUT boards: which eight peaks each heat deals, and in what order.

DETERMINISTIC FROM THE MATCH SEED. Every seat at the table is dealt the same
three heats in the same card order, because the board is a pure function of the
seed and the committed artifact. Each draw uses its own named random stream
(`prime_cut:{seed}:heat:{h}:attempt:{k}`), so a later heat or a re-draw can
never shift an earlier heat's cards.

WHAT A GOOD HEAT IS, and how it is enforced. `heat_quality` is the validator;
generation re-draws deterministically until a heat passes it:

  * no duplicate player in the heat, and none reused from an earlier heat;
  * at most `MAX_MARQUEE_CARDS` marquee peaks (eight superstars = free choices);
  * a real cut line: 4th and 5th best at least `CUT_LINE_MIN_GAP` apart, so the
    right cut never depends on a decimal the model does not meaningfully draw;
  * a meaningful capture denominator (`HEAT_MIN_CAPTURE_SPREAD`);
  * closeness: `CLOSE_MIN_CARDS` within `CLOSE_BAND` of the line, so there is
    regret to be had.

The scores used here are the canonical `prime_score` values from the artifact.
They are written into the server-side snapshot and never reach a human client
before the heat resolves.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Iterable, Optional, Sequence

from nba_peak.prime_cut import config as C
from nba_peak.prime_cut.pool import PoolCard, get_pool
from nba_peak.prime_modes.artifact import team_label


class BoardGenerationError(RuntimeError):
    """No heat passing the quality validator within the attempt budget."""


@dataclass(frozen=True)
class HeatQuality:
    ok: bool
    reasons: tuple[str, ...]
    cut_gap: float
    capture_spread: float
    close_cards: int
    marquee_cards: int


def heat_quality(scores: Sequence[float], ranks: Sequence[int], players: Sequence[str]) -> HeatQuality:
    reasons: list[str] = []
    if len(scores) != C.CARDS_PER_HEAT:
        reasons.append("card_count")
    if len(set(players)) != len(players):
        reasons.append("duplicate_player")
    ordered = sorted(scores, reverse=True)
    k = C.KEEPS_PER_HEAT
    cut_gap = round(ordered[k - 1] - ordered[k], 4) if len(ordered) > k else 0.0
    capture_spread = round(sum(ordered[:k]) - sum(ordered[k:]), 4)
    line = (ordered[k - 1] + ordered[k]) / 2 if len(ordered) > k else 0.0
    close_cards = sum(1 for s in scores if abs(s - line) <= C.CLOSE_BAND)
    marquee = sum(1 for r in ranks if r <= C.MARQUEE_RANK)
    if cut_gap < C.CUT_LINE_MIN_GAP:
        reasons.append("ambiguous_cut_line")
    if capture_spread < C.HEAT_MIN_CAPTURE_SPREAD:
        reasons.append("insufficient_spread")
    if close_cards < C.CLOSE_MIN_CARDS:
        reasons.append("no_close_decisions")
    if marquee > C.MAX_MARQUEE_CARDS:
        reasons.append("too_many_marquee_peaks")
    return HeatQuality(
        ok=not reasons,
        reasons=tuple(reasons),
        cut_gap=cut_gap,
        capture_spread=capture_spread,
        close_cards=close_cards,
        marquee_cards=marquee,
    )


def _percentile(sorted_values: Sequence[float], pct: float) -> float:
    if not sorted_values:
        raise ValueError("empty pool")
    position = (len(sorted_values) - 1) * pct / 100.0
    lower = int(position)
    upper = min(lower + 1, len(sorted_values) - 1)
    frac = position - lower
    return sorted_values[lower] * (1 - frac) + sorted_values[upper] * frac


def _weighted_sample(rng: random.Random, cards: list[PoolCard], weights: list[float], k: int) -> list[PoolCard]:
    pool = list(zip(cards, weights))
    chosen: list[PoolCard] = []
    for _ in range(k):
        total = sum(w for _, w in pool)
        target = rng.random() * total
        acc = 0.0
        for index, (card, weight) in enumerate(pool):
            acc += weight
            if acc >= target:
                chosen.append(card)
                pool.pop(index)
                break
        else:  # pragma: no cover - floating-point tail
            chosen.append(pool.pop()[0])
    return chosen


def heat_stream(seed: int, heat_index: int, attempt: int) -> random.Random:
    return random.Random(f"prime_cut:{seed}:heat:{heat_index}:attempt:{attempt}")


def _card_payload(card: PoolCard, card_index: int) -> dict:
    window = card.window
    return {
        "card_index": card_index,
        "window_id": window.window_id,
        "canonical_window_id": card.canonical_window_id,
        "player_slug": card.player_slug,
        "player_name": card.player_name,
        "duration": card.duration,
        "start_season": window.start_season,
        "end_season": window.end_season,
        "seasons": [{"season": s.season, "team": team_label(s.team)} for s in card.seasons],
        "prime_score": window.prime_score,
        "prime_index": window.prime_index,
        "canonical_rank": card.canonical_rank,
    }


def generate_heat(seed: int, heat_index: int, excluded_players: Iterable[str] = ()) -> dict:
    duration = C.HEAT_DURATIONS[heat_index]
    excluded = set(excluded_players)
    pool = [c for c in get_pool(duration) if c.player_slug not in excluded]
    scores_sorted = sorted(c.window.prime_score for c in pool)
    low = _percentile(scores_sorted, C.CENTER_PERCENTILE_LOW)
    high = _percentile(scores_sorted, C.CENTER_PERCENTILE_HIGH)

    for attempt in range(C.MAX_GENERATION_ATTEMPTS):
        rng = heat_stream(seed, heat_index, attempt)
        center = low + rng.random() * (high - low)
        weights = [
            2.718281828459045 ** (-0.5 * ((c.window.prime_score - center) / C.SAMPLE_SIGMA) ** 2)
            for c in pool
        ]
        drawn = _weighted_sample(rng, pool, weights, C.CARDS_PER_HEAT)
        quality = heat_quality(
            [c.window.prime_score for c in drawn],
            [c.canonical_rank for c in drawn],
            [c.player_slug for c in drawn],
        )
        if not quality.ok:
            continue
        # The DEAL ORDER is shuffled on the same stream, after selection, so the
        # order in which cards arrive carries no information about their scores.
        rng.shuffle(drawn)
        return {
            "heat_index": heat_index,
            "duration": duration,
            "cards": [_card_payload(card, index) for index, card in enumerate(drawn)],
            "generation": {
                "board_version": C.BOARD_VERSION,
                "attempt": attempt,
                "center": round(center, 4),
                "cut_gap": quality.cut_gap,
                "capture_spread": quality.capture_spread,
                "close_cards": quality.close_cards,
                "marquee_cards": quality.marquee_cards,
                "pool_size": len(pool),
            },
        }
    raise BoardGenerationError(f"seed {seed} heat {heat_index}: no valid heat in {C.MAX_GENERATION_ATTEMPTS} attempts")


def generate_board(seed: int, heat_indexes: Optional[Sequence[int]] = None) -> dict:
    """Every heat of one match. Players never repeat across heats."""
    indexes = list(heat_indexes) if heat_indexes is not None else list(range(len(C.HEAT_DURATIONS)))
    used: set[str] = set()
    heats = []
    for heat_index in indexes:
        heat = generate_heat(seed, heat_index, used)
        used.update(card["player_slug"] for card in heat["cards"])
        heats.append(heat)
    return {"board_version": C.BOARD_VERSION, "seed": seed, "heats": heats}
