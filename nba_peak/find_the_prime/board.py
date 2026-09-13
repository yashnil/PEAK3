"""FIND THE PRIME boards: nine prompts, deterministic from the match seed.

Exactly three prompts at each of 2Y, 3Y and 5Y, in a SEEDED order, with no
player asked twice. Every seat is dealt the same nine prompts in the same order
because the board is a pure function of the seed and the committed artifact.

A dealt round carries EVERYTHING needed to score it forever -- every window's
canonical score, the best window, the equivalent-best windows and the scale --
so a historical match never re-reads a number a future artifact might move.
This payload lives in the server snapshot; `state.project` decides what of it a
seat may see and when.
"""
from __future__ import annotations

import random

from nba_peak.find_the_prime import config as C
from nba_peak.find_the_prime.pool import Prompt, prompts, scale_for
from nba_peak.prime_modes.artifact import team_label


class BoardGenerationError(RuntimeError):
    """Not enough distinct eligible players to deal a full match."""


def _round_payload(prompt: Prompt, round_index: int) -> dict:
    best_score = prompt.best.prime_score
    windows = [
        {
            "window_id": w.window_id,
            "start_season": w.start_season,
            "end_season": w.end_season,
            "start_season_end": w.start_season_end,
            "end_season_end": w.end_season_end,
            "prime_score": w.prime_score,
            "prime_index": w.prime_index,
        }
        for w in prompt.windows
    ]
    return {
        "round_index": round_index,
        "duration": prompt.duration,
        "player_slug": prompt.player_slug,
        "player_name": prompt.player_name,
        "canonical_rank": prompt.canonical_rank,
        "seasons": [
            {"season": s.season, "season_end": s.season_end, "team": team_label(s.team)}
            for s in prompt.seasons
        ],
        "windows": windows,
        "best_window_id": prompt.best.window_id,
        "best_start_season_end": prompt.best.start_season_end,
        "equivalent_window_ids": [
            w["window_id"] for w in windows if best_score - w["prime_score"] <= C.EQUIVALENT_REGRET
        ],
        "best_score": best_score,
        "floor": prompt.floor,
        "scale": scale_for(prompt),
    }


def generate_board(seed: int) -> dict:
    rng = random.Random(f"find_the_prime:{seed}:rounds")
    durations = list(C.ROUND_DURATIONS)
    rng.shuffle(durations)
    used: set[str] = set()
    rounds = []
    for round_index, duration in enumerate(durations):
        available = [p for p in prompts(duration) if p.player_slug not in used]
        if not available:
            raise BoardGenerationError(f"no unused eligible {duration}Y prompt for round {round_index}")
        prompt = rng.choice(available)
        used.add(prompt.player_slug)
        rounds.append(_round_payload(prompt, round_index))
    return {"board_version": C.BOARD_VERSION, "seed": seed, "rounds": rounds}
