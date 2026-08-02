"""The "Best seasons in <season>" rail ranks the SEASON, not careers.

WHAT THIS REPLACED. `_comparison_rails` used to select the rows *nearest in
score* to the row being explained::

    peers.sort(key=lambda o: (abs(peer_score - score), rank))

which answers "who scored about the same as this?" — a question the heading
never asked. For a very high row it returned a band clustered around that row,
so the actual leaders of the year could be absent purely for being too far
ahead or behind. It now sorts by that season's PEAK3 score descending.

The property that matters, and the one these tests pin, is that a player
appears on the strength of the SELECTED season alone. A player whose career
peak is some other year still belongs here if their score in *this* year is
among the best; a player whose career peak is this year has no special claim.
Because the rail is built from canonical 1-year rows, that is true by
construction — these tests prove the construction is actually what ships.
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_builder():
    """Import scripts/build_top_seasons.py as a module (it is not a package)."""
    path = _REPO_ROOT / "scripts" / "build_top_seasons.py"
    spec = importlib.util.spec_from_file_location("build_top_seasons", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["build_top_seasons"] = module
    spec.loader.exec_module(module)
    return module


builder = _load_builder()


def _row(row_id, player, season, score, rank, index=None):
    return {
        "row_id": row_id,
        "player_slug": player.lower().replace(" ", "-"),
        "player_name": player,
        "label": season,
        "season": season,
        "prime_score": score,
        "prime_index": index if index is not None else score,
        "rank": rank,
    }


def _peers(rails, row_id):
    return [e["player_name"] for e in rails[row_id]["same_season_peers"]]


def test_peers_are_the_seasons_best_not_the_nearest_scores():
    """The regression, stated directly.

    `mid` sits in the middle of the 1990-91 field. Under the old
    nearest-by-score rule its rail would open with the rows adjacent to it and
    could omit the leaders entirely. The rail must instead open with the
    highest-scoring other rows of 1990-91.
    """
    rows = [
        _row("s1", "Leader One", "1990-91", 96.0, 1),
        _row("s2", "Leader Two", "1990-91", 94.0, 2),
        _row("s3", "Mid Player", "1990-91", 80.0, 3),
        _row("s4", "Just Below", "1990-91", 79.5, 4),
        _row("s5", "Just Above", "1990-91", 80.5, 5),
        _row("s6", "Low Player", "1990-91", 60.0, 6),
    ]
    rails = builder._comparison_rails(rows)

    peers = _peers(rails, "s3")
    assert peers[0] == "Leader One"
    assert peers[1] == "Leader Two"
    # The nearest-by-score rows are still present (they are strong), but they
    # no longer displace the leaders at the top, which is the whole change.
    assert peers.index("Leader One") < peers.index("Just Above")
    assert "Mid Player" not in peers, "the selected row must exclude itself"


def test_a_row_ranks_on_this_season_not_on_its_own_career_peak():
    """A player's best year elsewhere neither helps nor hurts them here.

    `Peaked Later` is mediocre in 1990-91 and outstanding in 1995-96. It must
    be near the bottom of the 1990-91 rail and near the top of the 1995-96 one.
    Nothing about "was this their career peak?" enters the ordering.
    """
    rows = [
        _row("a1", "Steady Star", "1990-91", 90.0, 1),
        _row("a2", "Peaked Later", "1990-91", 62.0, 2),
        _row("a3", "Filler", "1990-91", 70.0, 3),
        _row("b1", "Peaked Later", "1995-96", 97.0, 1),
        _row("b2", "Steady Star", "1995-96", 71.0, 2),
        _row("b3", "Filler", "1995-96", 65.0, 3),
    ]
    rails = builder._comparison_rails(rows)

    # In 1990-91, judged on 1990-91 form.
    assert _peers(rails, "a3") == ["Steady Star", "Peaked Later"]
    # In 1995-96 the same player leads, on that season's form.
    assert _peers(rails, "b3")[0] == "Peaked Later"


def test_peers_never_cross_a_season_boundary():
    rows = [
        _row("x1", "Alpha", "1990-91", 95.0, 1),
        _row("x2", "Beta", "1990-91", 85.0, 2),
        _row("y1", "Gamma", "1991-92", 99.0, 1),
    ]
    rails = builder._comparison_rails(rows)
    assert _peers(rails, "x2") == ["Alpha"], "1991-92 must not leak in"


def test_ordering_is_stable_when_scores_tie():
    """Equal scores fall back to rank, so the export is byte-stable."""
    rows = [
        _row("t1", "Selected", "2000-01", 70.0, 9),
        _row("t2", "Tied Later Rank", "2000-01", 88.0, 5),
        _row("t3", "Tied Better Rank", "2000-01", 88.0, 2),
    ]
    rails = builder._comparison_rails(rows)
    assert _peers(rails, "t1") == ["Tied Better Rank", "Tied Later Rank"]


def test_rail_is_capped_and_excludes_self():
    rows = [_row(f"c{i}", f"P{i}", "1990-91", 100.0 - i, i + 1) for i in range(12)]
    rails = builder._comparison_rails(rows)
    peers = _peers(rails, "c5")
    assert len(peers) == builder._MAX_SEASON_PEERS
    assert "P5" not in peers
    # Capped from the TOP of the season, so the cap cannot hide the leaders.
    assert peers[0] == "P0"


@pytest.mark.parametrize("missing", ["prime_score"])
def test_a_missing_score_sorts_last_rather_than_crashing(missing):
    rows = [
        _row("m1", "Selected", "1990-91", 70.0, 1),
        _row("m2", "Scored", "1990-91", 88.0, 2),
        _row("m3", "Unscored", "1990-91", None, 3),
    ]
    rows[2][missing] = None
    rails = builder._comparison_rails(rows)
    peers = _peers(rails, "m1")
    assert peers[0] == "Scored"
    assert peers[-1] == "Unscored"
