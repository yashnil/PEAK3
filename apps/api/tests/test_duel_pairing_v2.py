"""Peak Duel Daily -- pairing v2 (app/services/duel_pairing.py).

WHAT THESE TESTS LOCK IN.

  * THE CUTOVER. A daily board is re-derived from (date, years) on every
    request and stored answers reference its duel ids, so v2 may only ever
    build boards dated on/after `PEAK_DUEL_PAIRING_V2_FROM`. Earlier dates --
    every archived board -- must replay the v1 draw byte-for-byte. Pinned on
    both the synthetic pool (always runs) and the real dataset.
  * THE STRUCTURE. Every v2 pair satisfies at least two of {score proximity,
    basketball similarity, era proximity}; the warm-ups require similarity; the
    board runs easy -> medium -> close; no player appears twice.
  * THE INVARIANTS v1 ALREADY HAD. Determinism per date, no duplicate pairs,
    no self-matchups, the winner by prime_index, an unbiased side.

The real-data sweeps skip when data/web is absent (CI before
`make build-dataset`), the same convention the other content tests use.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import pytest

from app.core.config import Settings, settings
from app.services import duel_pairing as P
from app.services.duel import (
    generate_daily_duels,
    generate_endless_duels,
    uses_pairing_v2,
)
from tests.conftest import _build_fixture_leaderboards

REPO_ROOT = Path(__file__).resolve().parents[3]
LEADERBOARDS = REPO_ROOT / "data" / "web" / "leaderboards.json"
CUTOVER = "2026-10-08"


def _real_pool(years: int) -> list[dict]:
    if not LEADERBOARDS.exists():
        pytest.skip("data/web/leaderboards.json not generated -- run `make build-dataset`")
    return json.loads(LEADERBOARDS.read_text())[str(years)]


def _v2(pool: list[dict], years: int, day: str) -> list:
    return generate_daily_duels(pool, years, day, count=10, pairing_v2_from=CUTOVER)


def _dates(start: str, n: int) -> list[str]:
    first = date.fromisoformat(start)
    return [(first + timedelta(days=i)).isoformat() for i in range(n)]


def _records(pool: list[dict]) -> dict[str, dict]:
    return {r["id"]: r for r in pool}


# ---------------------------------------------------------------------------
# The cutover: archived boards are never rewritten
# ---------------------------------------------------------------------------

#: v1 boards captured from the generator BEFORE pairing v2 existed.
V1_FIXTURE_PIN_2026_08_05_3Y = [
    "duel-536e012a", "duel-8aa2fb03", "duel-7a4b060d", "duel-3e8782ab", "duel-9e6d6433",
    "duel-98c82344", "duel-f2dfe1ab", "duel-9ae5d573", "duel-5c86fc4b", "duel-f432d4a0",
]
V1_REAL_PINS = {
    1: ["duel-fc9e5404", "duel-3848e707", "duel-8915cab0", "duel-3443d578", "duel-8bddd4c8",
        "duel-3090c6bc", "duel-0e2485db", "duel-4f83233e", "duel-ac2e1126", "duel-9cf6654a"],
    3: ["duel-8ed30945", "duel-15c30d56", "duel-d8564890", "duel-38ee7ad6", "duel-800baa65",
        "duel-b0cdcb12", "duel-3e4acbf9", "duel-99f72227", "duel-e0748563", "duel-ab3d1271"],
}


def test_a_pre_cutover_board_is_the_v1_board_on_the_synthetic_pool():
    pool = _build_fixture_leaderboards(30)[3]
    board = generate_daily_duels(pool, 3, "2026-08-05", count=10, pairing_v2_from=CUTOVER)
    assert [d.id for d in board] == V1_FIXTURE_PIN_2026_08_05_3Y
    # And identical to the generator with no cutover at all.
    assert [d.id for d in generate_daily_duels(pool, 3, "2026-08-05", count=10)] == V1_FIXTURE_PIN_2026_08_05_3Y


@pytest.mark.parametrize("years", [1, 3])
def test_a_pre_cutover_board_is_the_v1_board_on_the_real_pool(years):
    pool = _real_pool(years)
    board = generate_daily_duels(pool, years, "2026-08-05", count=10, pairing_v2_from=CUTOVER)
    assert [d.id for d in board] == V1_REAL_PINS[years]


def test_the_day_before_the_cutover_is_v1_and_the_cutover_day_is_v2():
    assert not uses_pairing_v2("2026-10-07", CUTOVER)
    assert uses_pairing_v2("2026-10-08", CUTOVER)
    assert uses_pairing_v2("2027-01-01", CUTOVER)
    assert not uses_pairing_v2("2027-01-01", None)
    pool = _build_fixture_leaderboards(30)[3]
    assert all(d._pairing is None for d in generate_daily_duels(pool, 3, "2026-10-07", 10, CUTOVER))
    assert all(d._pairing["version"] == "v2" for d in generate_daily_duels(pool, 3, "2026-10-08", 10, CUTOVER))


def test_the_cutover_setting_is_a_validated_daily_key():
    assert settings.PEAK_DUEL_PAIRING_V2_FROM == "2026-10-08"
    for bad in ("2026-13-01", "10/08/2026", "2026-10-8", "tomorrow"):
        with pytest.raises(ValueError):
            Settings(PEAK_DUEL_PAIRING_V2_FROM=bad)


def test_endless_is_untouched_by_pairing_v2():
    pool = _build_fixture_leaderboards(30)[3]
    board = generate_endless_duels(pool, 3, seed=1234, count=20)
    assert all(d._pairing is None for d in board)


def test_the_daily_route_serves_v2_on_and_after_the_cutover(client):
    body = client.get("/api/v1/game/daily", params={"years": 3, "date": "2026-08-05"}).json()
    pool_is_real = LEADERBOARDS.exists()
    if pool_is_real:
        assert [d["id"] for d in body["duels"]] == V1_REAL_PINS[3]
    else:
        assert [d["id"] for d in body["duels"]] == V1_FIXTURE_PIN_2026_08_05_3Y


# ---------------------------------------------------------------------------
# v2 structure, on the real pools
# ---------------------------------------------------------------------------

SWEEP_DATES = _dates("2026-10-08", 64)


@pytest.fixture(scope="module", params=[1, 2, 3, 5])
def sweep(request):
    years = request.param
    pool = _real_pool(years)
    return years, pool, {day: _v2(pool, years, day) for day in SWEEP_DATES}


def test_v2_boards_are_deterministic_and_differ_by_date():
    pool = _real_pool(3)
    first = [d.id for d in _v2(pool, 3, "2026-11-01")]
    assert first == [d.id for d in _v2(pool, 3, "2026-11-01")]
    assert first != [d.id for d in _v2(pool, 3, "2026-11-02")]


def test_every_board_is_ten_v2_duels_with_no_repeated_pair_or_player(sweep):
    years, pool, boards = sweep
    for day, board in boards.items():
        assert len(board) == 10, day
        assert all(d._pairing["version"] == "v2" for d in board), day
        pairs = {frozenset((d.left["peak_id"], d.right["peak_id"])) for d in board}
        assert len(pairs) == 10, day
        players = [d.left["player_slug"] for d in board] + [d.right["player_slug"] for d in board]
        assert len(set(players)) == 20, f"{day}: a player appears twice"
        assert all(d.left["duration_years"] == years == d.right["duration_years"] for d in board)


def test_every_pair_satisfies_at_least_two_of_three_signals(sweep):
    _years, pool, boards = sweep
    records = _records(pool)
    for day, board in boards.items():
        for duel in board:
            facts = P.pair_facts(records[duel.left["peak_id"]], records[duel.right["peak_id"]])
            assert facts.criteria() >= 2, (day, duel.left["player_name"], duel.right["player_name"], facts)
            for side in (duel.left, duel.right):
                assert records[side["peak_id"]]["data_status"] == "complete"


def test_the_board_runs_easy_then_medium_then_close(sweep):
    _years, pool, boards = sweep
    records = _records(pool)
    for day, board in boards.items():
        bands = [d._pairing["band"] for d in board]
        assert bands == list(P.PROGRESSION_10), (day, bands)
        gaps = [
            P.pair_facts(records[d.left["peak_id"]], records[d.right["peak_id"]]).gap for d in board
        ]
        for band, gap in zip(bands, gaps):
            low, high = P.BAND_RANGES[band]
            assert low <= gap <= high, (day, band, gap)
        assert sum(gaps[:2]) / 2 > sum(gaps[-3:]) / 3, day


def test_the_warmups_are_basketball_comparisons_not_just_clear_answers(sweep):
    _years, pool, boards = sweep
    records = _records(pool)
    for day, board in boards.items():
        for duel in board[:2]:
            facts = P.pair_facts(records[duel.left["peak_id"]], records[duel.right["peak_id"]])
            assert facts.similar is True, (day, duel.left["player_name"], duel.right["player_name"])


def test_the_close_duels_are_genuinely_close(sweep):
    _years, pool, boards = sweep
    records = _records(pool)
    hard_gaps = [
        P.pair_facts(records[d.left["peak_id"]], records[d.right["peak_id"]]).gap
        for board in boards.values()
        for d in board[-3:]
    ]
    assert max(hard_gaps) <= P.HARD_MAX_GAP
    assert min(hard_gaps) >= P.MIN_GAP
    assert sorted(hard_gaps)[len(hard_gaps) // 2] <= 2.0


def test_no_kevin_johnson_vs_shaq_pairs(sweep):
    """Different position group AND a big gap: the reported failure shape."""
    _years, pool, boards = sweep
    records = _records(pool)
    for day, board in boards.items():
        for d in board:
            facts = P.pair_facts(records[d.left["peak_id"]], records[d.right["peak_id"]])
            assert facts.gap <= P.EASY_MAX_GAP, (day, facts.gap)
            if facts.similar is False:
                assert facts.gap <= P.MEDIUM_MAX_GAP and facts.era_close, (
                    day, d.left["player_name"], d.right["player_name"], facts.gap,
                )


@pytest.mark.parametrize("years", [1, 2, 3, 5])
def test_the_reported_matchup_could_never_be_dealt(years):
    """Kevin Johnson vs Shaquille O'Neal: guard vs big, a ~25-point gap, a
    decade apart. No band and no relaxation rung may accept it."""
    by_name = {r["player_name"]: r for r in _real_pool(years) if r["rank"] <= 150}
    kj, shaq = by_name.get("Kevin Johnson"), by_name.get("Shaquille O'Neal")
    if kj is None or shaq is None:
        pytest.skip("one of the two players is outside this pool")
    facts = P.pair_facts(kj, shaq)
    assert facts.similar is False and facts.band() is None
    for band in P.BAND_RANGES:
        for _rung, rule, _cap in P.RELAXATION:
            assert not rule(facts, band), (band, _rung)


def test_boards_are_not_one_repeated_question(sweep):
    """Variety: at most `MAX_MIRROR_PAIRS` same-position/same-era mirrors on a
    strict board, and across the sweep plenty of cross-position pairs."""
    _years, pool, boards = sweep
    records = _records(pool)
    cross = total = 0
    for day, board in boards.items():
        facts = [P.pair_facts(records[d.left["peak_id"]], records[d.right["peak_id"]]) for d in board]
        if all(d._pairing["rung"] == "strict" for d in board):
            assert sum(f.mirror for f in facts) <= P.MAX_MIRROR_PAIRS, day
        cross += sum(1 for f in facts if f.similar is False)
        total += len(facts)
    assert cross / total >= 0.10, cross / total


def test_the_strict_rung_fills_almost_every_real_board(sweep):
    _years, _pool, boards = sweep
    rungs = [d._pairing["rung"] for board in boards.values() for d in board]
    assert rungs.count("strict") / len(rungs) >= 0.95
    assert "v1_fallback" not in rungs


def test_the_winner_is_still_the_higher_prime_index_and_sides_are_unbiased(sweep):
    _years, pool, boards = sweep
    records = _records(pool)
    left_wins = total = 0
    for board in boards.values():
        for d in board:
            left, right = records[d.left["peak_id"]], records[d.right["peak_id"]]
            stronger = left if left["prime_index"] >= right["prime_index"] else right
            assert d._correct_winner_id == stronger["id"]
            left_wins += int(stronger is left)
            total += 1
    assert 0.40 <= left_wins / total <= 0.60, left_wins / total


def test_prime_score_never_inverts_prime_index_in_the_pools():
    """The bands are measured in prime_score while the winner is prime_index;
    that is only coherent while the remap is monotone over the served pool."""
    for years in (1, 2, 3, 5):
        pool = sorted(_real_pool(years), key=lambda r: r["prime_index"])
        assert all(a["prime_score"] <= b["prime_score"] for a, b in zip(pool, pool[1:])), years


def test_no_pre_answer_hint_is_added_to_the_payload(client):
    body = client.get("/api/v1/game/daily", params={"years": 3}).json()
    for duel in body["duels"]:
        assert set(duel) == {"id", "left", "right", "difficulty"}
        for side in ("left", "right"):
            assert "prime_score" not in duel[side] and "prime_index" not in duel[side]


# ---------------------------------------------------------------------------
# Graceful degradation: the synthetic pool has no card profiles
# ---------------------------------------------------------------------------


def test_v2_fills_a_board_from_a_pool_without_profiles():
    pool = _build_fixture_leaderboards(30)[3]
    for day in _dates(CUTOVER, 20):
        board = _v2(pool, 3, day)
        assert len(board) == 10
        pairs = {frozenset((d.left["peak_id"], d.right["peak_id"])) for d in board}
        assert len(pairs) == 10
        players = [d.left["player_slug"] for d in board] + [d.right["player_slug"] for d in board]
        assert len(set(players)) == 20
        # No profile means similarity is UNKNOWN, never assumed.
        assert all(d._pairing["rung"] != "strict" or d._pairing["band"] != "easy" for d in board)


def test_a_tiny_pool_tops_up_from_v1_without_repeats():
    pool = _build_fixture_leaderboards(12)[3]
    board = _v2(pool, 3, "2026-11-01")
    assert 1 <= len(board) <= 10
    pairs = {frozenset((d.left["peak_id"], d.right["peak_id"])) for d in board}
    assert len(pairs) == len(board)
