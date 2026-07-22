"""
adversarial_search.py
----------------------
Searches the REAL card pool and REAL synergy/scoring rules
(nba_peak/lineup/scoring.py, nba_peak/lineup/config.py) for combinations
that might exploit synergy stacking, let a lower-talent lineup out-score a
higher-talent one, or over-rely on a small set of dominant cards (spec
section O.3). Random-sampled search over valid role assignments (not
exhaustive — the pool is too large to enumerate C(pool, 5) combinations
exactly), but large enough to surface systematic issues rather than one-off
noise. Produces reproducible fixtures (via a fixed --seed) for any anomaly
found.

Usage (from repo root):
    python scripts/ranked_validation/adversarial_search.py --samples 20000 --mode apex_1y
"""
from __future__ import annotations

import argparse
import json
import random
import sys
from collections import Counter
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CARD_PROFILES_PATH = REPO_ROOT / "data" / "game" / "profiles" / "card_profiles.v3.json"

for p in (REPO_ROOT,):
    if str(p) not in sys.path:
        sys.path.insert(0, str(p))

from nba_peak.lineup.schemas import CardProfile  # noqa: E402
from nba_peak.lineup.scoring import evaluate_lineup  # noqa: E402
from nba_peak.lineup.config import SYNERGY_MAX, SYNERGY_MIN  # noqa: E402

ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]
MODE_TO_DURATION = {"apex_1y": 1, "prime_3y": 3, "foundation_5y": 5}


def _load_pool(duration: int) -> list[CardProfile]:
    raw = json.loads(CARD_PROFILES_PATH.read_text())
    return [
        CardProfile.from_dict(d)
        for d in raw
        if d.get("duration_years") == duration and d.get("profile_status") != "excluded"
    ]


def _sample_valid_lineup(pool_by_role: dict[str, list[CardProfile]], rng: random.Random) -> dict[str, CardProfile] | None:
    assignment: dict[str, CardProfile] = {}
    used_ids: set[str] = set()
    roles = ROLES[:]
    rng.shuffle(roles)
    for role in roles:
        candidates = [c for c in pool_by_role[role] if c.player_id not in used_ids]
        if not candidates:
            return None
        card = rng.choice(candidates)
        assignment[role] = card
        used_ids.add(card.player_id)
    return assignment


def search(mode: str, n_samples: int, seed: int) -> dict:
    duration = MODE_TO_DURATION[mode]
    pool = _load_pool(duration)
    pool_by_role: dict[str, list[CardProfile]] = {r: [c for c in pool if r in c.eligible_roles] for r in ROLES}

    rng = random.Random(seed)
    results = []
    card_appearance_counter: Counter[str] = Counter()
    bound_violations = []
    talent_synergy_inversions = []

    for _ in range(n_samples):
        assignment = _sample_valid_lineup(pool_by_role, rng)
        if assignment is None:
            continue
        cards = list(assignment.values())
        role_assignments = {role: card.peak_window_id for role, card in assignment.items()}
        ev = evaluate_lineup(cards=cards, role_assignments=role_assignments)

        for c in cards:
            card_appearance_counter[c.peak_window_id] += 1

        if not (SYNERGY_MIN - 1e-9 <= ev.synergy_total <= SYNERGY_MAX + 1e-9):
            bound_violations.append({
                "cards": [c.peak_window_id for c in cards],
                "synergy_total": ev.synergy_total,
            })

        results.append({
            "cards": [c.peak_window_id for c in cards],
            "talent_score": ev.talent_score,
            "coverage_score": ev.coverage_score,
            "synergy_total": ev.synergy_total,
            "lineup_peak_rating": ev.lineup_peak_rating,
        })

    results.sort(key=lambda r: r["lineup_peak_rating"], reverse=True)

    # Talent/synergy inversion check: among sampled lineups, does any
    # meaningfully-lower-talent lineup out-rate a meaningfully-higher-talent
    # one purely because synergy made up the difference? This is the
    # "synergy stacking exploit" shape described in spec O.3.
    by_talent = sorted(results, key=lambda r: r["talent_score"])
    for i in range(len(by_talent) - 1):
        lower, higher = by_talent[i], by_talent[i + 1]
        if higher["talent_score"] - lower["talent_score"] > 5.0 and lower["lineup_peak_rating"] > higher["lineup_peak_rating"]:
            talent_synergy_inversions.append({"lower_talent": lower, "higher_talent": higher})

    dominant_cards = card_appearance_counter.most_common(10)
    total_appearances = sum(card_appearance_counter.values())

    return {
        "mode": mode,
        "n_samples_requested": n_samples,
        "n_valid_lineups_evaluated": len(results),
        "top_10_by_lineup_peak_rating": results[:10],
        "synergy_bound_violations": bound_violations,
        "talent_synergy_inversion_count": len(talent_synergy_inversions),
        "talent_synergy_inversion_examples": talent_synergy_inversions[:5],
        "dominant_card_frequency": [
            {"peak_window_id": cid, "appearances": n, "share_of_all_slots": round(n / total_appearances, 4)}
            for cid, n in dominant_cards
        ] if total_appearances else [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=20000)
    parser.add_argument("--mode", choices=list(MODE_TO_DURATION.keys()), default="apex_1y")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    if not CARD_PROFILES_PATH.exists():
        print(f"ERROR: {CARD_PROFILES_PATH} not found. Run `python scripts/build_card_profiles.py` first.")
        return 1

    report = search(args.mode, args.samples, args.seed)

    output_dir = Path(__file__).resolve().parent / "output"
    output_dir.mkdir(exist_ok=True)
    out_path = output_dir / f"adversarial_search_{args.mode}.json"
    out_path.write_text(json.dumps(report, indent=2))

    print(f"Wrote {out_path}")
    print(f"Mode: {report['mode']}, valid lineups evaluated: {report['n_valid_lineups_evaluated']}")
    print(f"Synergy bound violations: {len(report['synergy_bound_violations'])}")
    print(f"Talent/synergy inversions (gap>5, lower talent scores higher): {report['talent_synergy_inversion_count']}")
    print("Most dominant cards (highest slot share):")
    for entry in report["dominant_card_frequency"][:5]:
        print(f"  {entry['peak_window_id']}: {entry['share_of_all_slots']:.2%} of sampled slots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
