"""A player's own record in one Arena mode: matches, wins, streaks, bests.

DERIVED, NEVER MATERIALISED -- the same decision `get_player_stats` records
for leaderboard statistics (migration 20260804140000): there is no table to
fall out of step with `arena_match_results`. This module is the pure half: it
takes one player's results in completion order and returns the facts a result
screen shows. The repository supplies the rows; the route supplies the rating.

WHAT COUNTS. Every COMPLETED match the player held a seat in, in any entry path
(practice, private room, public queue) -- a personal best against bots is still
the player's best score on a board-relative scale. `rated_matches` is reported
separately, and only a public-queue match can move a rating.

A WIN STREAK counts consecutive outright wins. A shared first place (`draw`)
or any loss ends it: "you won" is a claim a tie does not support.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Sequence


@dataclass(frozen=True)
class PersonalResultRow:
    match_id: str
    placement: int
    outcome: str
    score: float
    rated: bool
    seat_count: int
    detail: dict = field(default_factory=dict)


@dataclass
class PersonalRecord:
    matches_played: int = 0
    rated_matches: int = 0
    wins: int = 0
    podiums: int = 0
    current_win_streak: int = 0
    longest_win_streak: int = 0
    best_score: Optional[float] = None
    bests: dict[str, float] = field(default_factory=dict)
    # About one match, when asked for.
    match_found: bool = False
    match_score: Optional[float] = None
    match_placement: Optional[int] = None
    previous_best_score: Optional[float] = None
    is_personal_best: bool = False
    streak_after_match: Optional[int] = None


def _podium(row: PersonalResultRow) -> bool:
    return row.placement <= max(1, row.seat_count // 2)


def compute_record(
    rows: Sequence[PersonalResultRow],
    *,
    detail_keys: Sequence[str] = (),
    match_id: Optional[str] = None,
) -> PersonalRecord:
    """`rows` must be in completion order, oldest first."""
    record = PersonalRecord()
    streak = 0
    for row in rows:
        record.matches_played += 1
        record.rated_matches += 1 if row.rated else 0
        record.wins += 1 if row.outcome == "win" else 0
        record.podiums += 1 if _podium(row) else 0
        streak = streak + 1 if row.outcome == "win" else 0
        record.longest_win_streak = max(record.longest_win_streak, streak)

        if match_id is not None and row.match_id == match_id:
            record.match_found = True
            record.match_score = row.score
            record.match_placement = row.placement
            record.previous_best_score = record.best_score
            record.is_personal_best = record.best_score is None or row.score > record.best_score
            record.streak_after_match = streak

        record.best_score = row.score if record.best_score is None else max(record.best_score, row.score)
        for key in detail_keys:
            value = row.detail.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                continue  # a missing measurement is missing, never zero
            current = record.bests.get(key)
            record.bests[key] = float(value) if current is None else max(current, float(value))
    record.current_win_streak = streak
    return record
