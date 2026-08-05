"""Bipartite matching primitives shared by position legality and roll feasibility.

Both "can this roster still be completed legally?" and "can three distinct
players be assigned to this round?" are maximum-bipartite-matching questions,
and both are answered here by a REAL matching algorithm -- Kuhn's augmenting
path -- rather than by a counting shortcut.

Why the shortcut is not acceptable: "there are >= 3 eligible players, so three
picks must be possible" is false the moment eligibility is constrained. Three
players who are all centers cannot fill PG, SG and C. Counting says yes;
basketball says no. The only correct answer comes from actually trying to
build the assignment, which is what these functions do.

Deterministic by construction: every adjacency list is consumed in the order
given, and callers pass sorted orders, so a matching found once is found
identically every time.
"""
from __future__ import annotations

from typing import Hashable, Iterable, Mapping, Optional, Sequence, TypeVar

L = TypeVar("L", bound=Hashable)
R = TypeVar("R", bound=Hashable)


def maximum_matching(
    left: Sequence[L],
    adjacency: Mapping[L, Sequence[R]],
) -> dict[R, L]:
    """Maximum bipartite matching, returned as right-node -> left-node.

    `left` fixes the processing order (so the result is deterministic for a
    deterministic input) and `adjacency[node]` gives that node's candidate
    right-nodes. A left node missing from `adjacency` simply has no edges.
    """
    match_right: dict[R, L] = {}

    def augment(node: L, seen: set[R]) -> bool:
        for target in adjacency.get(node, ()):
            if target in seen:
                continue
            seen.add(target)
            holder = match_right.get(target)
            if holder is None or augment(holder, seen):
                match_right[target] = node
                return True
        return False

    for node in left:
        augment(node, set())
    return match_right


def has_perfect_matching(
    left: Sequence[L],
    adjacency: Mapping[L, Sequence[R]],
) -> bool:
    """Can EVERY left node be matched to a distinct right node?

    This is the "can this roster still be completed" question: left = the
    slots still to fill, right = the players still available.
    """
    return len(maximum_matching(left, adjacency)) == len(left)


def find_assignment(
    left: Sequence[L],
    adjacency: Mapping[L, Sequence[R]],
) -> Optional[dict[L, R]]:
    """A concrete perfect assignment left -> right, or None if none exists.

    Returns the witness rather than just a boolean, because the caller
    usually wants to show it (an auto-pick, a "here is a legal completion"
    hint) and recomputing it would risk showing a different one than the one
    that proved feasibility.
    """
    match_right = maximum_matching(left, adjacency)
    if len(match_right) != len(left):
        return None
    return {node: target for target, node in match_right.items()}


def can_assign_distinct(
    candidate_sets: Iterable[Sequence[R]],
) -> bool:
    """Does some choice of one DISTINCT right-node per set exist?

    The `_can_assign_distinct` question from
    `nba_peak/perfect_season/board.py:247`, answered by matching instead of
    backtracking so the cost stays polynomial when a late-match pool is large
    but heavily overlapping.
    """
    sets = list(candidate_sets)
    left = list(range(len(sets)))
    adjacency = {index: sets[index] for index in left}
    return has_perfect_matching(left, adjacency)


__all__ = [
    "can_assign_distinct",
    "find_assignment",
    "has_perfect_matching",
    "maximum_matching",
]
