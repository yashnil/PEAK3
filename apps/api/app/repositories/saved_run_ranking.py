"""Personal-best comparison for saved PEAK Season runs (Phase 9A).

Shared by BOTH repository implementations (in-memory and Postgres) so the
tiebreaker order can never diverge between dev/CI and production -- the
Postgres repo sorts in SQL for the common list query but uses these same
helpers for the personal-best aggregate, and the in-memory repo uses them
throughout.

Tiebreaker order, exactly as specified for Phase 9A:
  1. wins (more is better)
  2. official lineup score (higher is better) -- ONLY counts for a
     fully-scored run. A provisional run's lineup_score is honestly 0.0
     (simulate_exact_season refuses to fabricate one), so comparing it as a
     real number would rank every provisional run below every scored run
     even when it won more games. Rule 1 already handles wins; this rule only
     breaks ties among runs that both have real scores.
  3. fewer provisional/unscored cards (more official coverage is better)
  4. earliest completion timestamp, then run id -- a deterministic final
     fallback, resolved toward whoever got there FIRST (a later run must
     strictly beat your best to replace it, so "tied" reads as "tied", not
     as a new best).
"""
from __future__ import annotations

from app.repositories.saved_run_protocols import SavedRun

SCORE_STATUS_COMPLETE = "complete"


def is_officially_scored(run: SavedRun) -> bool:
    """True when this run's lineup_score is a real, official, comparable
    number (every placed card had an official PEAK3 score)."""
    return run.score_status == SCORE_STATUS_COMPLETE


def comparable_lineup_score(run: SavedRun) -> float:
    """The run's lineup score for ranking purposes: its real value when the
    run is fully scored, else -1.0 so a provisional run never outranks a
    genuinely scored one on this criterion alone. Never mutates or
    fabricates the stored lineup_score itself."""
    return run.lineup_score if is_officially_scored(run) else -1.0


def unscored_card_count(run: SavedRun) -> int:
    return max(0, run.total_cards - run.exact_cards_scored)


def personal_best_sort_key(run: SavedRun) -> tuple:
    """Sort key implementing the tiebreaker order above. Ascending sort puts
    the BEST run first, so "more is better" fields are negated -- the same
    single-sort-call convention leaderboard_memory.py::_sort_key already
    uses."""
    return (
        -run.wins,
        -comparable_lineup_score(run),
        unscored_card_count(run),
        run.created_at.isoformat() if hasattr(run.created_at, "isoformat") else str(run.created_at),
        run.id,
    )


def best_of(runs: list[SavedRun]) -> SavedRun | None:
    """The single best run by personal_best_sort_key, or None for an empty
    list."""
    return min(runs, key=personal_best_sort_key) if runs else None


# ---------------------------------------------------------------------------
# "Did I beat my best?" comparison, used by the save route to tell the UI
# what to say. Computed against the user's PREVIOUS bests (i.e. excluding
# the run just saved), so a first-ever run is honestly "first run", not a
# self-referential "new personal best".
# ---------------------------------------------------------------------------

COMPARISON_FIRST_RUN = "first_run"
COMPARISON_NEW_BEST = "new_personal_best"
COMPARISON_TIED_BEST = "tied_personal_best"
COMPARISON_BELOW_BEST = "below_personal_best"


def compare_to_previous_best(run: SavedRun, previous_best: SavedRun | None) -> str:
    """One of the COMPARISON_* codes above.

    "Tied" is a real, distinct outcome (not folded into "below"): matching
    your own best 82-0 attempt is worth acknowledging, and calling it "below
    your best" would read as wrong. Ties are judged on the MEANINGFUL
    criteria only (wins + official score + coverage), never on the
    timestamp/id fallback -- those exist to make sorting deterministic, not
    to declare two otherwise-identical runs unequal.
    """
    if previous_best is None:
        return COMPARISON_FIRST_RUN
    new_key = personal_best_sort_key(run)[:3]
    old_key = personal_best_sort_key(previous_best)[:3]
    if new_key < old_key:
        return COMPARISON_NEW_BEST
    if new_key == old_key:
        return COMPARISON_TIED_BEST
    return COMPARISON_BELOW_BEST
