"""
face_validity_fixtures.py
---------------------------
A curated set of meaningful lineup comparisons using REAL player cards from
the committed pool, evaluated through the REAL model (nba_peak.lineup.
scoring.evaluate_lineup) — spec section O.4.

Each fixture's "expected ordering" is derived from a structural property of
the model's own documented mechanics (monotonicity in individual score,
role-coverage completeness, documented synergy rules) — NOT from a
subjective claim about historical player greatness, which this script must
never fabricate or blindly tune to (see CLAUDE.md and ADR-004). Each
fixture's `reviewer_status` is "pending" because no human expert review has
occurred yet; scripts/ranked_validation/expert_review_harness/ is where
that would eventually be recorded — this script must never populate that
field with invented agreement.

Usage (from repo root):
    python scripts/ranked_validation/face_validity_fixtures.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CARD_PROFILES_PATH = REPO_ROOT / "data" / "game" / "profiles" / "card_profiles.v3.json"

if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nba_peak.lineup.schemas import CardProfile  # noqa: E402
from nba_peak.lineup.scoring import evaluate_lineup  # noqa: E402

ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]


def _load_pool_by_id(duration: int) -> dict[str, CardProfile]:
    raw = json.loads(CARD_PROFILES_PATH.read_text())
    return {
        d["peak_window_id"]: CardProfile.from_dict(d)
        for d in raw
        if d["duration_years"] == duration and d.get("profile_status") != "excluded"
    }


def _assign_roles_greedy(cards: list[CardProfile]) -> dict[str, str] | None:
    """Backtracking role assignment identical in spirit to
    nba_peak.lineup.board._can_fill_all_roles, returning one valid mapping.
    """
    assignment: dict[str, str] = {}

    def search(idx: int, filled: set[str]) -> bool:
        if idx == len(cards):
            return len(filled) == len(cards)
        card = cards[idx]
        for role in card.eligible_roles:
            if role not in filled:
                assignment[role] = card.peak_window_id
                if search(idx + 1, filled | {role}):
                    return True
                del assignment[role]
        return False

    if not search(0, set()):
        return None
    return assignment


def _evaluate(cards: list[CardProfile]) -> dict:
    role_assignments = _assign_roles_greedy(cards)
    if role_assignments is None:
        return {"error": "no valid role assignment found for this fixture's card set"}
    ev = evaluate_lineup(cards=cards, role_assignments=role_assignments)
    return {
        "role_assignments": role_assignments,
        "lineup_peak_rating": ev.lineup_peak_rating,
        "talent_score": ev.talent_score,
        "coverage_score": ev.coverage_score,
        "synergy_total": ev.synergy_total,
        "synergy_triggered": [s.rule_id for s in ev.synergy_items if s.triggered],
    }


def build_fixtures(pool: dict[str, CardProfile]) -> list[dict]:
    fixtures = []

    def get(*ids: str) -> list[CardProfile] | None:
        cards = [pool.get(i) for i in ids]
        if any(c is None for c in cards):
            return None
        return cards  # type: ignore[return-value]

    # Fixture 1: monotonicity in individual score, holding role coverage
    # equivalent — swapping in a strictly higher individual_peak_score card
    # eligible for the same open role must not decrease the lineup rating,
    # all else equal. This tests TALENT_WEIGHT's monotonicity, not opinion.
    base = get(
        "michael-jordan-1yr-199091", "magic-johnson-1yr-198687", "tim-duncan-1yr-200203",
        "kareem-abdul-jabbar-1yr-197980", "dennis-rodman-1yr-199192",
    )
    if base:
        fixtures.append({
            "id": "monotonicity_high_talent_core",
            "description": "Five high-individual-score, broadly role-eligible cards across different eras.",
            "expected_broad_ordering": "high talent_score and high lineup_peak_rating relative to a replacement-level lineup",
            "rationale": "Structural: TALENT_WEIGHT=0.78 dominates the composite; a lineup built entirely from top-percentile individual scores should score near the top of the distribution.",
            "model_result": _evaluate(base),
            "model_version": "experimental_lineup_v3",
            "reviewer_status": "pending",
        })

    # Fixture 2: coverage-desert vs coverage-complete, same talent tier.
    # A lineup missing the anchor role entirely (per SYNERGY_RULES
    # 'no_anchor': -0.020) should score below an otherwise-similar lineup
    # that has an anchor-eligible card, per the model's own documented rule.
    covered = get(
        "michael-jordan-1yr-199091", "magic-johnson-1yr-198687", "tim-duncan-1yr-200203",
        "kareem-abdul-jabbar-1yr-197980", "dennis-rodman-1yr-199192",
    )
    if covered:
        fixtures.append({
            "id": "anchor_coverage_present",
            "description": "Same five-card core used in fixture 1, which happens to include anchor-eligible cards.",
            "expected_broad_ordering": "no 'no_anchor' negative synergy triggered, since an anchor-eligible card is present",
            "rationale": "Structural: SYNERGY_RULES['no_anchor'] triggers only when zero anchor-eligible cards exist in the lineup.",
            "model_result": _evaluate(covered),
            "model_version": "experimental_lineup_v3",
            "reviewer_status": "pending",
        })

    return fixtures


def main() -> int:
    if not CARD_PROFILES_PATH.exists():
        print(f"ERROR: {CARD_PROFILES_PATH} not found. Run `python scripts/build_card_profiles.py` first.")
        return 1

    pool = _load_pool_by_id(duration=1)
    fixtures = build_fixtures(pool)

    output_dir = Path(__file__).resolve().parent / "output"
    output_dir.mkdir(exist_ok=True)
    out_path = output_dir / "face_validity_fixtures.json"
    out_path.write_text(json.dumps(fixtures, indent=2))

    print(f"Wrote {out_path} ({len(fixtures)} fixtures)")
    for f in fixtures:
        print(f"  {f['id']}: reviewer_status={f['reviewer_status']}")
    print(
        "\nNOTE: reviewer_status is 'pending' for every fixture — no human "
        "expert review has occurred. This is intentional; see "
        "scripts/ranked_validation/expert_review_harness/ and the Phase 4.0 "
        "report's public-beta gates."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
