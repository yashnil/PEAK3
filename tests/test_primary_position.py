"""`primary_position()` — the ONE canonical position per player.

WHY THIS IS A SEPARATE CONCEPT FROM `career_positions()`, pinned separately:
`career_positions()` answers "where is this player ELIGIBLE to be placed" and is
deliberately generous, because it is the placement legality 82-0 and Three-Man
Weave enforce. The Rankings position tabs asked it the wrong question, and got a
"PG" board led by Michael Jordan with LeBron James second and Giannis
Antetokounmpo fifth.

These tests exist to keep the two apart: the partition property below is what
the rankings tabs rely on, and the eligibility test at the bottom is what stops
a future "fix" from quietly narrowing the games' legality data to match.

Nothing here is keyed to a hand-written name->position table. The expectations
are canonical basketball facts that the minutes-weighted derivation must
reproduce from committed data on its own.
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from nba_peak.perfect_season.career_positions import career_positions, primary_position

REPO_ROOT = Path(__file__).resolve().parent.parent
PEAK_WINDOWS = REPO_ROOT / "data" / "web" / "peak_windows.json"
POSITIONS = ("PG", "SG", "SF", "PF", "C")

# Canonical primary positions. Chosen as players whose primary position is not
# seriously disputed, so a failure here means the derivation broke, not that
# basketball is ambiguous.
CANONICAL = {
    "stephen-curry": "PG",
    "chris-paul": "PG",
    "magic-johnson": "PG",
    "russell-westbrook": "PG",
    "shai-gilgeous-alexander": "PG",
    "michael-jordan": "SG",
    "kobe-bryant": "SG",
    "dwyane-wade": "SG",
    "lebron-james": "SF",
    "kevin-durant": "SF",
    "larry-bird": "SF",
    "scottie-pippen": "SF",
    "giannis-antetokounmpo": "PF",
    "tim-duncan": "PF",
    "karl-malone": "PF",
    "shaquille-oneal": "C",
    "nikola-jokic": "C",
    "hakeem-olajuwon": "C",
}


@pytest.mark.parametrize("slug,expected", sorted(CANONICAL.items()))
def test_canonical_primary_positions(slug, expected):
    assert primary_position(slug) == expected


def test_returns_exactly_one_valid_token_or_none():
    for slug in CANONICAL:
        assert primary_position(slug) in POSITIONS


def test_unknown_and_empty_slugs_return_none_rather_than_guessing():
    assert primary_position(None) is None
    assert primary_position("") is None
    assert primary_position("not-a-real-player-slug-12345") is None


def test_slug_alias_spellings_resolve_to_the_same_answer():
    # The two committed slug conventions ("shaquille-o-neal" vs
    # "shaquille-oneal") must not produce different rankings tabs.
    assert primary_position("shaquille-oneal") == primary_position("shaquille-o-neal") == "C"
    assert primary_position("amare-stoudemire") == primary_position("amar-e-stoudemire")
    assert primary_position("deaaron-fox") == primary_position("de-aaron-fox") == "PG"


@pytest.mark.skipif(not PEAK_WINDOWS.exists(), reason="requires data/web/ (make build-dataset)")
def test_every_ranked_player_resolves_so_the_five_tabs_partition_the_board():
    """THE PROPERTY THE RANKINGS TABS DEPEND ON.

    Union of the five tabs == All, and no player in two tabs. If a ranked
    player ever fails to resolve, they silently vanish from every position tab
    while still appearing under "All" — visible only as a board that does not
    add up, which is exactly the class of bug this asserts away.
    """
    slugs = {row["player_slug"] for row in json.loads(PEAK_WINDOWS.read_text())}
    assert slugs, "no ranked players found"

    resolved = {slug: primary_position(slug) for slug in slugs}
    unresolved = sorted(s for s, p in resolved.items() if p is None)
    assert not unresolved, f"ranked players with no primary position: {unresolved}"

    tabs = {p: {s for s, v in resolved.items() if v == p} for p in POSITIONS}
    assert sum(len(v) for v in tabs.values()) == len(slugs)
    assert set().union(*tabs.values()) == slugs
    for a in POSITIONS:
        for b in POSITIONS:
            if a < b:
                assert not (tabs[a] & tabs[b]), f"{a}/{b} overlap: {sorted(tabs[a] & tabs[b])[:5]}"


def test_eligibility_is_untouched_and_stays_broader_than_primary():
    """Gameplay legality must NOT have been narrowed by this change.

    LeBron is the case that motivated the split: eligible across the whole
    frontcourt/backcourt for placement, and a small forward in the rankings.
    """
    lebron = career_positions("lebron-james")
    assert {"PG", "SF", "C"} <= lebron, f"eligibility narrowed: {sorted(lebron)}"
    assert primary_position("lebron-james") == "SF"
    assert primary_position("lebron-james") in lebron

    # Jordan's curated "+PG" supplement still applies to eligibility, and still
    # does not make him a point guard in the rankings.
    assert "PG" in career_positions("michael-jordan")
    assert primary_position("michael-jordan") == "SG"
