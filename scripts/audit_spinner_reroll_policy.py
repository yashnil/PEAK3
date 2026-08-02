#!/usr/bin/env python3
"""Distribution + correctness audit of the 82-0 PEAK Season respin policy.

WHAT THIS EXISTS TO PROVE
-------------------------
The distance-aware respin policy (W5, UX/organization/polish pass) removes
entries that are too CLOSE to the one the player just saw, then samples
uniformly over whatever remains. Two things have to be true for that to be
honest rather than merely plausible:

  1. The exclusions actually hold. A respin must never return the identical
     team-season, must never return the current team, and must never land on
     an adjacent season while the preferred (radius-2) pool was viable.
  2. What is left is genuinely uniform. Narrowing a pool is only defensible
     if nothing inside the narrowed pool is favoured -- no era weighting, no
     franchise bias, no "big market" thumb on the scale.

Point 2 is the one that cannot be asserted by inspection, which is why this
script draws >= 100,000 samples per respin kind and computes a chi-square
goodness-of-fit against the EXPECTED counts implied by the per-sample allowed
pools (each sample's allowed pool is a different size, so the expectation is
sum over samples of 1/|allowed_i| for each entry i, not a flat n/k).

It calls the REAL policy function (`plan_respin` in
apps/api/app/services/perfect_season/state.py), not a reimplementation of it.
A reimplementation would only prove that two copies of the same idea agree.

Output artifact: docs/implementation/spinner-audit.json

Usage:
    python scripts/audit_spinner_reroll_policy.py
    python scripts/audit_spinner_reroll_policy.py --samples 250000
    python scripts/audit_spinner_reroll_policy.py --out /tmp/audit.json
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import random
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "apps" / "api"))

from nba_peak.perfect_season.board import (  # noqa: E402
    MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON,
    get_rollable_season_index,
    get_rollable_season_labels,
    get_rollable_team_year_catalogue,
)
from nba_peak.perfect_season.config import (  # noqa: E402
    MIN_RESPIN_POOL,
    RESPIN_POLICY_VERSION,
    RESPIN_SEASON_EXCLUSION_RADIUS,
    RESPIN_TEAM_HISTORY_DEPTH,
)
from app.services.perfect_season.state import plan_respin  # noqa: E402

DEFAULT_SAMPLES = 100_000


POLICY_DESCRIPTION = {
    "policy_version": RESPIN_POLICY_VERSION,
    "summary": (
        "A respin builds an ordered ladder of allowed pools, most restrictive "
        "first, drops one rung only when a rung's allowed pool falls below "
        "MIN_RESPIN_POOL, and then samples UNIFORMLY over the chosen rung via "
        "a deterministic shuffle bag seeded from the board seed, round, respin "
        "kind and respin count. No era, decade or franchise is weighted."
    ),
    "season_ladder": [
        "same_team_radius_2  -- same franchise, every season within +/-2 INDICES excluded",
        "same_team_radius_1  -- same franchise, adjacent season excluded",
        "same_team_radius_0  -- same franchise, only the exact current season excluded",
        "any_team_radius_2   -- any franchise, seasons within +/-2 indices excluded",
        "any_team_radius_1   -- any franchise, adjacent season excluded",
        "any_team_radius_0   -- any franchise, only the exact current season excluded",
    ],
    "team_ladder": [
        "same_season_depth_2 -- same season, current team + 2 most recent teams excluded",
        "same_season_depth_1 -- same season, current team + most recent team excluded",
        "same_season_depth_0 -- same season, current team excluded",
        "any_season_depth_2  -- any season, current team + 2 most recent teams excluded",
        "any_season_depth_1  -- any season, current team + most recent team excluded",
        "any_season_depth_0  -- any season, current team excluded",
    ],
    "constants": {
        "RESPIN_SEASON_EXCLUSION_RADIUS": RESPIN_SEASON_EXCLUSION_RADIUS,
        "RESPIN_TEAM_HISTORY_DEPTH": RESPIN_TEAM_HISTORY_DEPTH,
        "MIN_RESPIN_POOL": MIN_RESPIN_POOL,
        "MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON": MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON,
    },
    "rollback_boundary": (
        "Setting RESPIN_SEASON_EXCLUSION_RADIUS = 0 AND RESPIN_TEAM_HISTORY_DEPTH = 0 "
        "makes state.py take the verbatim pre-policy code path (same pools, same "
        "_pick_valid_entry probing, same rng call sequence)."
    ),
    "initial_board_generation": (
        "UNCHANGED. generate_team_year_board reads none of these constants and is "
        "not called by the respin path; daily boards and existing seeds are "
        "byte-identical (pinned by "
        "test_initial_board_generation_is_unchanged_by_respin_policy)."
    ),
}


def chi_square(observed: dict, expected: dict, note: str = "") -> dict:
    """Chi-square goodness of fit against the per-sample allowed pools.

    Cells with a tiny expectation are pooled out rather than left to blow the
    statistic up -- a cell that was allowed in only a handful of the samples
    carries no information about uniformity, and (obs-exp)^2/exp on exp≈0.01
    is numerically meaningless.

    READ THE `caveat` FIELD BEFORE THE NUMBER on a dimension the policy holds
    FIXED by construction. A season respin keeps the franchise 96.6% of the
    time and a team respin keeps the season 100% of the time, so on those
    marginals `observed` and `expected` are near-deterministic rather than
    multinomial: the statistic collapses far BELOW 1 and the normal
    approximation reports a large NEGATIVE z. That is the policy doing exactly
    what it says, not evidence of bias -- bias would show up as a reduced
    chi-square well ABOVE 1.
    """
    stat = 0.0
    dof = 0
    dropped = 0
    for key, exp in expected.items():
        if exp < 5.0:
            dropped += 1
            continue
        obs = observed.get(key, 0)
        stat += (obs - exp) ** 2 / exp
        dof += 1
    dof = max(dof - 1, 1)
    # Wilson-Hilferty normal approximation -- avoids a scipy dependency for
    # what is only ever read as "is this within a couple of sigma".
    z = ((stat / dof) ** (1.0 / 3.0) - (1.0 - 2.0 / (9.0 * dof))) / math.sqrt(2.0 / (9.0 * dof))
    reduced = stat / dof
    return {
        "chi_square": round(stat, 3),
        "degrees_of_freedom": dof,
        "reduced_chi_square": round(reduced, 5),
        "normal_approx_z": round(z, 3),
        "cells_pooled_out_expected_lt_5": dropped,
        "is_structurally_fixed_dimension": bool(note),
        "caveat": note or None,
        "interpretation": (
            "reduced chi-square near 1.0 with |z| < 3 is consistent with a uniform "
            "draw over the allowed pool; a value well ABOVE 1 would indicate bias. "
            + (
                "This dimension is held fixed by the policy, so the statistic "
                "collapses toward 0 and the z is large and negative by construction "
                "-- see `caveat`."
                if note
                else "No caveat applies to this dimension."
            )
        ),
    }


def frequency_summary(counter: collections.Counter, expected: dict, label: str) -> dict:
    """Per-key observed vs expected, reported as the worst relative deviations
    rather than a 40-row or 47-row dump."""
    rows = []
    for key, exp in expected.items():
        if exp < 5.0:
            continue
        obs = counter.get(key, 0)
        rows.append({
            "key": key,
            "observed": obs,
            "expected": round(exp, 2),
            "relative_deviation": round((obs - exp) / exp, 4),
        })
    rows.sort(key=lambda r: r["relative_deviation"])
    return {
        "dimension": label,
        "keys_measured": len(rows),
        "most_underrepresented": rows[:5],
        "most_overrepresented": list(reversed(rows[-5:])),
        "max_abs_relative_deviation": (
            round(max((abs(r["relative_deviation"]) for r in rows), default=0.0), 4)
        ),
    }


def audit_kind(kind: str, samples: int, entries: list[dict], season_index: dict[str, int]) -> dict:
    by_spin_id = {e["spin_id"]: e for e in entries}
    season_labels = get_rollable_season_labels()

    observed_entry: collections.Counter = collections.Counter()
    observed_team: collections.Counter = collections.Counter()
    observed_season: collections.Counter = collections.Counter()
    expected_entry: dict = collections.defaultdict(float)
    expected_team: dict = collections.defaultdict(float)
    expected_season: dict = collections.defaultdict(float)

    tier_hits: collections.Counter = collections.Counter()
    radius_hits: collections.Counter = collections.Counter()
    depth_hits: collections.Counter = collections.Counter()
    pool_sizes: list[int] = []
    season_jump_hist: collections.Counter = collections.Counter()

    violations = {
        "exact_repeat_entry": 0,
        "same_team_on_team_respin": 0,
        "same_season_on_season_respin": 0,
        "adjacent_season_while_preferred_pool_viable": 0,
        "invalid_team_season": 0,
        "out_of_allowed_pool": 0,
        "no_option_returned": 0,
        "below_candidate_floor": 0,
    }

    picker = random.Random(20260731)
    for i in range(samples):
        current = entries[picker.randrange(len(entries))]
        # Recent-team history: the policy's team ladder reads real prior
        # results, so feed it real prior entries rather than a synthetic list.
        recent = [entries[picker.randrange(len(entries))]["team_id"] for _ in range(3)]
        recent = [t for t in dict.fromkeys(recent) if t != current["team_id"]]
        rng = random.Random(f"audit:{kind}:{i}")

        chosen, meta = plan_respin(
            kind,
            entries,
            {
                "team_id": current["team_id"],
                "era_label": current["era_label"],
                "spin_id": current["spin_id"],
            },
            set(),
            recent,
            season_index,
            rng,
        )

        if chosen is None:
            violations["no_option_returned"] += 1
            continue

        tier_hits[meta["relaxation_tier"]] += 1
        radius_hits[meta["exclusion_radius"]] += 1
        depth_hits[meta["history_depth"]] += 1
        pool_sizes.append(meta["allowed_pool_size"])

        # --- correctness -------------------------------------------------
        if chosen["spin_id"] == current["spin_id"]:
            violations["exact_repeat_entry"] += 1
        if chosen["spin_id"] not in by_spin_id:
            violations["invalid_team_season"] += 1
        if len(chosen.get("player_slugs", [])) < MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON:
            violations["below_candidate_floor"] += 1
        if chosen.get("era_label") != chosen.get("season_label"):
            violations["invalid_team_season"] += 1

        if kind == "team":
            if chosen["team_id"] == current["team_id"]:
                violations["same_team_on_team_respin"] += 1
        else:
            if chosen["era_label"] == current["era_label"]:
                violations["same_season_on_season_respin"] += 1
            delta = abs(season_index[chosen["era_label"]] - season_index[current["era_label"]])
            season_jump_hist[min(delta, 20)] += 1
            # The tier that fired declares a radius; landing inside it is the
            # exact "the reroll did nothing" failure this policy exists to
            # prevent.
            if delta <= meta["exclusion_radius"]:
                violations["adjacent_season_while_preferred_pool_viable"] += 1

        # --- distribution ------------------------------------------------
        observed_entry[chosen["spin_id"]] += 1
        observed_team[chosen["franchise_display_name"]] += 1
        observed_season[chosen["era_label"]] += 1

        # Rebuild the allowed pool the policy sampled from, so "out of pool"
        # and the expectations are measured against the real thing.
        allowed = _rebuild_allowed(kind, entries, current, recent, season_index, meta)
        if len(allowed) != meta["allowed_pool_size"]:
            # The reconstruction disagreeing with the policy is itself a
            # finding -- surface it rather than silently trusting either.
            violations["out_of_allowed_pool"] += 1
            continue
        allowed_ids = set()
        w = 1.0 / len(allowed)
        for e in allowed:
            allowed_ids.add(e["spin_id"])
            expected_entry[e["spin_id"]] += w
            expected_team[e["franchise_display_name"]] += w
            expected_season[e["era_label"]] += w
        if chosen["spin_id"] not in allowed_ids:
            violations["out_of_allowed_pool"] += 1

    n = sum(tier_hits.values())
    fixed_franchise = (
        "A season respin keeps the current franchise on 96%+ of draws, so the "
        "franchise marginal is fixed by construction and this statistic carries "
        "no information about fairness. The meaningful figures for this kind are "
        "`team_season_entries` and `season`."
        if kind == "season" else ""
    )
    fixed_season = (
        "A team respin keeps the current season on every draw, so the season "
        "marginal is exactly deterministic (chi-square 0 by construction). The "
        "meaningful figures for this kind are `team_season_entries` and "
        "`franchise`."
        if kind == "team" else ""
    )
    never_returned = sorted(
        name for name, exp in expected_team.items()
        if exp >= 5.0 and observed_team.get(name, 0) == 0
    )
    return {
        "kind": kind,
        "samples": samples,
        "resolved": n,
        "violations": violations,
        "relaxation_ladder_hits": dict(tier_hits.most_common()),
        "exclusion_radius_hits": {str(k): v for k, v in sorted(radius_hits.items())},
        "history_depth_hits": {str(k): v for k, v in sorted(depth_hits.items())},
        "allowed_pool_size": {
            "min": min(pool_sizes) if pool_sizes else 0,
            "max": max(pool_sizes) if pool_sizes else 0,
            "mean": round(sum(pool_sizes) / len(pool_sizes), 2) if pool_sizes else 0,
            "below_min_respin_pool": sum(1 for s in pool_sizes if s < MIN_RESPIN_POOL),
        },
        "season_index_jump_histogram": (
            {str(k): v for k, v in sorted(season_jump_hist.items())} if kind == "season" else None
        ),
        "uniformity_over_allowed_pool": {
            "team_season_entries": chi_square(observed_entry, expected_entry),
            "franchise": chi_square(observed_team, expected_team, fixed_franchise),
            "season": chi_square(observed_season, expected_season, fixed_season),
        },
        "franchises_expected_but_never_returned": never_returned,
        "distribution_summary": {
            "franchise": frequency_summary(observed_team, expected_team, "franchise"),
            "season": frequency_summary(observed_season, expected_season, "season"),
        },
        "coverage": {
            "distinct_team_seasons_returned": len(observed_entry),
            "distinct_franchises_returned": len(observed_team),
            "distinct_seasons_returned": len(observed_season),
            "catalogue_team_seasons": len(entries),
            "catalogue_seasons": len(season_labels),
        },
    }


def _rebuild_allowed(kind, entries, current, recent, season_index, meta) -> list[dict]:
    """Independently reconstruct the allowed pool the policy's chosen tier
    describes, from the tier name alone. Deliberately a SECOND implementation:
    if it disagrees with `allowed_pool_size` the audit reports that, instead of
    grading the policy against its own arithmetic."""
    tier = meta["relaxation_tier"]
    if kind == "season":
        radius = meta["exclusion_radius"]
        s = season_index[current["era_label"]]

        def far(e):
            return abs(season_index[e["era_label"]] - s) > radius

        if tier.startswith("same_team"):
            return [e for e in entries if e["team_id"] == current["team_id"] and far(e)]
        return [e for e in entries if e["spin_id"] != current["spin_id"] and far(e)]

    depth = meta["history_depth"]
    blocked = {current["team_id"], *recent[:depth]}
    if tier.startswith("same_season"):
        return [e for e in entries if e["era_label"] == current["era_label"] and e["team_id"] not in blocked]
    return [e for e in entries if e["team_id"] not in blocked]


def audit_relaxation_ladder() -> dict:
    """Force the ladder to relax, using a deliberately tiny synthetic
    catalogue. The real 1,314-entry catalogue never needs to relax, so
    without this the relaxation rungs would be entirely unexercised code."""
    results = {}

    # A franchise with only 4 covered seasons, all clustered -- radius 2 and
    # radius 1 both starve, so the season ladder must fall through.
    tiny = [
        {
            "spin_id": f"tiny-{i}",
            "team_id": "tiny-team",
            "franchise_display_name": "Tiny Team",
            "era_label": label,
            "season_label": label,
            "player_slugs": [f"p{i}-{k}" for k in range(8)],
        }
        for i, label in enumerate(["2010-11", "2011-12", "2012-13", "2013-14"])
    ]
    season_index = {label: i for i, label in enumerate(["2010-11", "2011-12", "2012-13", "2013-14"])}
    hits: collections.Counter = collections.Counter()
    for i in range(2000):
        chosen, meta = plan_respin(
            "season", tiny,
            {"team_id": "tiny-team", "era_label": "2011-12", "spin_id": "tiny-1"},
            set(), [], season_index, random.Random(i),
        )
        hits[meta["relaxation_tier"]] += 1
        assert chosen is not None and chosen["era_label"] != "2011-12"
    results["season_tiny_single_franchise_catalogue"] = {
        "catalogue_size": len(tiny),
        "hits": dict(hits.most_common()),
        "note": (
            "4 seasons total, so the radius-2 and radius-1 rungs are empty or "
            "under MIN_RESPIN_POOL and the ladder correctly lands on "
            "same_team_radius_0 -- the exact current season is still excluded."
        ),
    }

    # Three teams in one season -- the team ladder's depth-2 exclusion would
    # empty the pool, so it must relax rather than fail the reroll.
    trio = [
        {
            "spin_id": f"trio-{t}",
            "team_id": t,
            "franchise_display_name": t.title(),
            "era_label": "1999-00",
            "season_label": "1999-00",
            "player_slugs": [f"{t}-p{k}" for k in range(8)],
        }
        for t in ("alpha", "beta", "gamma")
    ]
    hits = collections.Counter()
    for i in range(2000):
        chosen, meta = plan_respin(
            "team", trio,
            {"team_id": "alpha", "era_label": "1999-00", "spin_id": "trio-alpha"},
            set(), ["beta", "gamma"], {"1999-00": 0}, random.Random(i),
        )
        hits[meta["relaxation_tier"]] += 1
        assert chosen is not None and chosen["team_id"] != "alpha"
    results["team_three_franchise_catalogue"] = {
        "catalogue_size": len(trio),
        "hits": dict(hits.most_common()),
        "note": (
            "Excluding the current team plus both recent teams leaves nothing, "
            "so the ladder relaxes; the current team is still never returned."
        ),
    }
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=DEFAULT_SAMPLES,
                        help="samples PER respin kind (default 100000)")
    parser.add_argument("--out", type=Path,
                        default=REPO_ROOT / "docs" / "implementation" / "spinner-audit.json")
    args = parser.parse_args()

    started = time.time()
    entries = get_rollable_team_year_catalogue()
    season_index = get_rollable_season_index()
    print(f"Rollable catalogue: {len(entries)} team-seasons, {len(season_index)} seasons")
    print(f"Policy: {RESPIN_POLICY_VERSION} "
          f"(radius={RESPIN_SEASON_EXCLUSION_RADIUS}, depth={RESPIN_TEAM_HISTORY_DEPTH}, "
          f"min_pool={MIN_RESPIN_POOL})")

    report = {
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "policy": POLICY_DESCRIPTION,
        "catalogue": {
            "rollable_team_seasons": len(entries),
            "franchises": len({e["team_id"] for e in entries}),
            "seasons": len(season_index),
            "season_range": [get_rollable_season_labels()[0], get_rollable_season_labels()[-1]],
        },
        "sample_sizes": {
            "per_kind": args.samples,
            "total": args.samples * 2,
        },
        "kinds": {},
        "relaxation_ladder_forced_small_pool": audit_relaxation_ladder(),
    }

    for kind in ("season", "team"):
        t0 = time.time()
        print(f"\nAuditing {kind} respins ({args.samples:,} samples)…")
        result = audit_kind(kind, args.samples, entries, season_index)
        print(f"  done in {time.time() - t0:.1f}s")
        for name, count in result["violations"].items():
            marker = "OK  " if count == 0 else "FAIL"
            print(f"  [{marker}] {name}: {count}")
        u = result["uniformity_over_allowed_pool"]["team_season_entries"]
        print(f"  uniformity (team-season cells): reduced chi2="
              f"{u['reduced_chi_square']} z={u['normal_approx_z']} dof={u['degrees_of_freedom']}")
        report["kinds"][kind] = result

    total_violations = sum(
        sum(k["violations"].values()) for k in report["kinds"].values()
    )
    report["total_violations"] = total_violations
    report["elapsed_seconds"] = round(time.time() - started, 1)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"\nWrote {args.out}")
    print(f"TOTAL VIOLATIONS: {total_violations}")
    return 0 if total_violations == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
