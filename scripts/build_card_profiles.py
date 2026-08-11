#!/usr/bin/env python3
"""Build card profiles v3 for Peak Draft from peak_windows.json.

v3 changes vs v2:
  - Role eligibility: anchor redesigned.
      REMOVED: postseason_team_anchor (po_pct≥55, team_pct≥42 — too team-success-oriented)
      KEPT:    recognition_validated_anchor (rec_pct≥55, tp_pct≤35, si_pct≥15)
      ADDED:   playoff_impact_anchor (po_pct≥65, tp_pct≤45, si_pct≥20 — high individual
               playoff performance without being primarily a scorer; PO is an individual
               metric: BPM, WS/48, VORP, PER, playoff box scores, efficiency)
  - Profile version: v2 → v3; RULESET_VERSION: ruleset_v2 → ruleset_v3

v2 changes vs v1:
  - DNA: removed peer_quality_adjustment (teammate_adjustment is context, not lineup capability).
  - DNA dimensions: 7 → 6. All 6 map directly to PEAK3 components + data_status.
  - Data constraint documented: no per-stat breakdowns (defensive rating, rebound rate,
    block rate, position metadata) exist at card-profile layer.
  - Role eligibility: anchor redesigned (removed interior_defensive_profile,
    playoff_team_contributor; added recognition_validated_anchor)
  - Profile version: v1 → v2; RULESET_VERSION: ruleset_v1 → ruleset_v2

v1 changes vs v0:
  - DNA: removed peak_tier and prime_index_normalized (rank-derived)
  - DNA: added peer_quality_adjustment (now removed in v2)
  - Anchor: gained interior_defensive_profile and playoff_team_contributor (now removed in v2)

Card profiles add role eligibility and Lineup DNA dimensions to each peak window
using only data that actually exists in the committed PEAK3 dataset.
Nothing is fabricated: every dimension traces back to a named PEAK3 field.

Outputs:
  data/game/profiles/card_profiles.v3.json
  data/game/profiles/profile_metadata.v3.json
  data/game/profiles/profile_coverage.v3.json
  data/game/profiles/profile_exclusions.v3.json
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# Running a script by path puts scripts/ on sys.path, not the repo root; the
# v4 role derivation imports `nba_peak.perfect_season.career_positions`.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
WINDOWS_PATH = REPO_ROOT / "data" / "web" / "peak_windows.json"
OUT_DIR = REPO_ROOT / "data" / "game" / "profiles"

PROFILE_VERSION = "v3"
CARD_POOL_VERSION = "v3"
TRANSFORM_VERSION = "dna_v2_roles_v5_window_positional"

# ---------------------------------------------------------------------------
# Role eligibility — v4: POSITIONS DECIDE ROLES. (F7)
#
# THE DEFECT v4 REMOVES. The v2/v3 rules above (`ROLE_RULES_V2`, kept for
# traces and for the no-position fallback) derive roles from COMPONENT-SCORE
# PERCENTILES, because at the time "no position ... exists at the card-profile
# layer" (their own docstring). The consequence is exactly the failure the
# polish brief names: `guard_wing`'s only real requirement was SI >= 40th
# percentile, and `lead_creator`'s was SI >= 75th — so any sufficiently GOOD
# player became positionally universal. Shaquille O'Neal's committed v3
# profile read `[lead_creator, guard_wing, wing_forward, forward_big]`:
# a traditional center offered at point guard and NOT offered at anchor,
# because his traditional-production percentile was too high for the anchor
# rule's "non-scorer" filter. Player QUALITY was deciding positional
# flexibility, which is the one thing a role model must never do.
#
# THE DATA EXISTS NOW. `nba_peak.perfect_season.career_positions` derives,
# from committed season data alone (gated on >= 20 games and >= 500 minutes so
# one-game cameos and father/son slug collisions don't count), the set of
# positions each player actually logged real NBA minutes at. CourtBuilder and
# Three-Man Weave already run their legality on it. v4 makes it the basis of
# RTT role eligibility too.
#
# v5: THE WINDOW DECIDES, NOT THE CAREER. v4 unioned every gate-qualified
# position across the player's whole career, so a particular 3-year card
# could be legal somewhere purely because the player played that position
# years earlier or later: LeBron's Miami window carried all five roles off
# career-wide PG/SG/SF/PF/C listings, and Rodman's Pistons windows carried
# guard_wing off an SF grant. Eligibility is a claim about THIS card, so the
# positional evidence is now read from the seasons INSIDE the card's own
# window (`career_positions.listed_position`, per-season, and gate-qualified
# exactly as before: a season counts only at >= 20 games and >= 500 minutes,
# so a positional cameo is never authoritative).
#
# THE MAPPING, tightened with it. Each position ACTUALLY PLAYED IN THE
# WINDOW grants its own family, and nothing else does:
#
#     PG -> lead_creator, guard_wing
#     SG -> guard_wing
#     SF -> wing_forward            (SF ALONE NEVER GRANTS guard_wing — the
#                                    v4 grant is what put Rodman at Guard/
#                                    Wing; guard evidence means PG or SG)
#     PF -> wing_forward, forward_big
#     C  -> forward_big, anchor
#
# The composites in the brief all fall out of the union: SG+SF -> GW+WF;
# SF+PF -> WF+FB; PF+C -> WF+FB+Anchor; a true point-forward window
# (PG+SF) -> LC+GW+WF, with GW carried by the PG evidence, never by the SF.
#
# FALLBACK LADDER, narrowest first, recorded per profile as `role_source`:
#   1. window_positions      — seasons inside the card's own window (v5);
#   2. career_positions      — the v4 career union, under THIS tightened map,
#                              for a window none of whose seasons gate-qualify;
#   3. capability_fallback   — the score-percentile rules, kept only for a
#                              slug with no positional data at all.
# As of this build all 984 windows resolve at step 1; the ladder is a safety
# net, not a live path.
# ---------------------------------------------------------------------------
POSITION_ROLE_MAP: dict[str, tuple[str, ...]] = {
    "PG": ("lead_creator", "guard_wing"),
    "SG": ("guard_wing",),
    "SF": ("wing_forward",),
    "PF": ("wing_forward", "forward_big"),
    "C":  ("forward_big", "anchor"),
}

# ---------------------------------------------------------------------------
# Component normalisation constants (fixed for stable re-runs)
# Derived from observed range in the committed dataset. Changing these
# changes all DNA scores and requires a version bump.
# ---------------------------------------------------------------------------
NORM = {
    "statistical_impact":          {"max": 38.93,  "min": 5.93},
    "traditional_production":      {"max": 15.87,  "min": 0.79},
    "individual_recognition":      {"max": 20.00,  "min": 0.00},
    "postseason_individual_value": {"max": 13.53,  "min": -2.34},
    "team_achievement":            {"max": 3.00,   "min": 0.00},
}

# ---------------------------------------------------------------------------
# Role eligibility — v2 (ruleset_v2)
#
# DESIGN PRINCIPLE: Every path must use POSITIVE evidence for the role.
# Absence of one capability (e.g. low scoring) is only used to confirm that
# recognition/impact came from a different capability domain, not as direct
# evidence of that capability.
#
# DATA LIMITATION: The PEAK3 dataset has only 6 aggregate component scores
# per window. No position, defensive rating, rebound rate, or block/steal rate
# exists at the card-profile layer. Role rules are therefore approximate proxies
# from composite scores.
#
# All percentiles are computed within the duration pool (not global).
# ---------------------------------------------------------------------------
ROLES = ["lead_creator", "guard_wing", "wing_forward", "forward_big", "anchor"]

ROLE_RULES_V2: dict[str, dict] = {
    "lead_creator": {
        "id": "lead_creator_v2",
        "description": (
            "Top-quartile statistical impact reflecting primary offensive initiation. "
            "Statistical impact (SI) is a composite of advanced metrics (BPM, VORP, WS, EPM) "
            "that captures creation, efficiency, and impact."
        ),
        "paths": [
            {
                "path_id": "high_si",
                "description": "Top-quartile statistical impact",
                "si_pct_min": 75,
            },
        ],
    },
    "guard_wing": {
        "id": "guard_wing_v2",
        "description": (
            "Perimeter function: creation, defense, spacing, or connective play. "
            "Above-median SI qualifies; strong postseason presence with any SI also qualifies."
        ),
        "paths": [
            {
                "path_id": "perimeter_impact",
                "description": "Above 40th-percentile SI (broad perimeter baseline)",
                "si_pct_min": 40,
            },
            {
                "path_id": "postseason_presence",
                "description": "Strong postseason + moderate impact (playoff perimeter contributor)",
                "po_pct_min": 60,
                "si_pct_min": 20,
            },
        ],
    },
    "wing_forward": {
        "id": "wing_forward_v2",
        "description": (
            "Versatile forward function: scoring, two-way play, or connective value."
        ),
        "paths": [
            {
                "path_id": "scoring_forward",
                "description": "Above-median TP + moderate SI (scoring forward)",
                "tp_pct_min": 50,
                "si_pct_min": 25,
            },
            {
                "path_id": "impact_forward",
                "description": "Above 58th-percentile SI + any scoring (high-impact non-creator)",
                "si_pct_min": 58,
                "tp_pct_min": 20,
            },
        ],
    },
    "forward_big": {
        "id": "forward_big_v2",
        "description": (
            "Frontcourt scoring or team-enabling high-impact big."
        ),
        "paths": [
            {
                "path_id": "scoring_big",
                "description": "Above 55th-percentile TP (high-scoring frontcourt)",
                "tp_pct_min": 55,
            },
            {
                "path_id": "team_anchor_big",
                "description": "Strong team success + solid SI (team-enabling big)",
                "team_pct_min": 65,
                "si_pct_min": 45,
            },
        ],
    },
    "anchor": {
        "id": "anchor_v3",
        "description": (
            "Interior/defensive/size role. Two data-derived paths: "
            "(1) Recognition-validated non-scorer: strong recognition accolades (DPOY, "
            "defensive/rebounding statistical titles captured in individual_recognition) "
            "combined with very low traditional production (confirms recognition was NOT "
            "for scoring) and moderate statistical impact (screens out pure bench fillers). "
            "(2) Playoff impact anchor: very high postseason individual performance (PO is an "
            "individual metric: BPM, WS/48, VORP, PER, playoff box scores, efficiency) combined "
            "with not being primarily a scorer (tp_pct≤45) and meaningful statistical impact "
            "(si_pct≥20). Identifies players who excel in playoffs through non-scoring means. "
            "Neither path uses positional data (unavailable) or player names. "
            "Neither path infers defense from low TP alone — positive evidence always required."
        ),
        "paths": [
            {
                "path_id": "recognition_validated_anchor",
                "description": (
                    "High individual recognition (≥55th pct) with very low TP (≤35th pct) "
                    "and moderate SI (≥15th pct). "
                    "Interpretation: recognition came from non-scoring contributions — "
                    "DPOY votes, All-Defensive selections, rebounding titles, and block titles "
                    "are all captured in individual_recognition. Low TP confirms the recognition "
                    "was not for scoring. Moderate SI screens out players with essentially no "
                    "measurable statistical impact. "
                    "This path does NOT infer defense from low TP alone. The primary qualifier "
                    "is HIGH recognition; low TP is a confirmation filter."
                ),
                "rec_pct_min": 55,
                "tp_pct_max": 35,
                "si_pct_min": 15,
            },
            {
                "path_id": "playoff_impact_anchor",
                "description": (
                    "Very high individual postseason performance (≥65th pct) with not being "
                    "primarily a scorer (TP ≤45th pct) and meaningful statistical impact "
                    "(SI ≥20th pct). PO is an individual metric (playoff BPM, WS/48, VORP, "
                    "PER, box scores, efficiency) — this path identifies players who translate "
                    "to the playoffs through non-scoring impact (defense, rebounding, positioning). "
                    "tp_pct≤45 confirms the player was not primarily a scorer. "
                    "si_pct≥20 screens out bench-level contributors."
                ),
                "po_pct_min": 65,
                "tp_pct_max": 45,
                "si_pct_min": 20,
            },
        ],
    },
}


def _norm(component: str, raw: float) -> float:
    lo = NORM[component]["min"]
    hi = NORM[component]["max"]
    return max(0.0, min(100.0, (raw - lo) / (hi - lo) * 100.0))


def _percentile_rank(value: float, sorted_vals: list[float]) -> float:
    n = len(sorted_vals)
    if n == 0:
        return 50.0
    rank = sum(1 for v in sorted_vals if v < value)
    return rank / n * 100.0


def _compute_duration_percentiles(pool: list[dict]) -> dict[str, list[float]]:
    return {
        "si":   sorted(w["components"]["statistical_impact"] for w in pool),
        "tp":   sorted(w["components"]["traditional_production"] for w in pool),
        "po":   sorted(w["components"]["postseason_individual_value"] for w in pool),
        "team": sorted(w["components"]["team_achievement"] for w in pool),
        "rec":  sorted(w["components"]["individual_recognition"] for w in pool),
    }


def _check_path(path: dict, si_pct: float, tp_pct: float, po_pct: float,
                team_pct: float, rec_pct: float) -> bool:
    """Check a single role path using computed percentiles."""
    if "si_pct_min"   in path and si_pct   < path["si_pct_min"]:   return False
    if "si_pct_max"   in path and si_pct   > path["si_pct_max"]:   return False
    if "tp_pct_min"   in path and tp_pct   < path["tp_pct_min"]:   return False
    if "tp_pct_max"   in path and tp_pct   > path["tp_pct_max"]:   return False
    if "po_pct_min"   in path and po_pct   < path["po_pct_min"]:   return False
    if "team_pct_min" in path and team_pct < path["team_pct_min"]: return False
    if "rec_pct_min"  in path and rec_pct  < path["rec_pct_min"]:  return False
    return True


def _eligible_roles(
    window: dict,
    pcts: dict[str, list[float]],
) -> tuple[list[str], dict[str, dict]]:
    """Determine eligible roles and reason traces."""
    comp = window["components"]
    si_pct   = _percentile_rank(comp["statistical_impact"],          pcts["si"])
    tp_pct   = _percentile_rank(comp["traditional_production"],      pcts["tp"])
    po_pct   = _percentile_rank(comp["postseason_individual_value"], pcts["po"])
    team_pct = _percentile_rank(comp["team_achievement"],            pcts["team"])
    rec_pct  = _percentile_rank(comp["individual_recognition"],      pcts["rec"])

    eligible = []
    traces: dict[str, dict] = {}

    for role, rule in ROLE_RULES_V2.items():
        qualified_path = None
        for path in rule["paths"]:
            if _check_path(path, si_pct, tp_pct, po_pct, team_pct, rec_pct):
                qualified_path = path["path_id"]
                break

        pct_record = {
            "si_pct":   round(si_pct,   1),
            "tp_pct":   round(tp_pct,   1),
            "po_pct":   round(po_pct,   1),
            "team_pct": round(team_pct, 1),
            "rec_pct":  round(rec_pct,  1),
        }

        if qualified_path:
            eligible.append(role)
            traces[role] = {
                "eligible":         True,
                "path_id":          qualified_path,
                "exclusion_reason": None,
                "percentiles":      pct_record,
            }
        else:
            # Build a minimal exclusion reason from failed path conditions
            first_path = rule["paths"][0]
            failed = []
            if "si_pct_min"   in first_path and si_pct   < first_path["si_pct_min"]:
                failed.append(f"si_pct={si_pct:.1f}<{first_path['si_pct_min']}")
            if "tp_pct_min"   in first_path and tp_pct   < first_path["tp_pct_min"]:
                failed.append(f"tp_pct={tp_pct:.1f}<{first_path['tp_pct_min']}")
            if "po_pct_min"   in first_path and po_pct   < first_path["po_pct_min"]:
                failed.append(f"po_pct={po_pct:.1f}<{first_path['po_pct_min']}")
            if "team_pct_min" in first_path and team_pct < first_path["team_pct_min"]:
                failed.append(f"team_pct={team_pct:.1f}<{first_path['team_pct_min']}")
            if "rec_pct_min"  in first_path and rec_pct  < first_path["rec_pct_min"]:
                failed.append(f"rec_pct={rec_pct:.1f}<{first_path['rec_pct_min']}")
            traces[role] = {
                "eligible":         False,
                "path_id":          None,
                "exclusion_reason": f"no_path_passed; primary: {'; '.join(failed) or 'all_paths_failed'}",
                "percentiles":      pct_record,
            }

    return eligible, traces


def _window_seasons(start_season: str, end_season: str) -> list[str]:
    """Every season label inside [start_season, end_season], inclusive."""
    first, last = int(start_season[:4]), int(end_season[:4])
    return [f"{year}-{str(year + 1)[-2:].zfill(2)}" for year in range(first, last + 1)]


def _position_roles(
    player_slug: str, start_season: str, end_season: str
) -> tuple[list[str], list[str], str]:
    """(roles, positions, source) for one card window. See the v5 comment on
    POSITION_ROLE_MAP for the ladder; `source` names which rung answered."""
    from nba_peak.perfect_season.career_positions import career_positions, listed_position

    window = {
        listed_position(player_slug, season)
        for season in _window_seasons(start_season, end_season)
    } - {None}
    if window:
        positions, source = window, "window_positions"
    else:
        positions, source = set(career_positions(player_slug)), "career_positions"

    roles: set[str] = set()
    for position in positions:
        roles.update(POSITION_ROLE_MAP.get(position, ()))
    ordered_positions = [p for p in ("PG", "SG", "SF", "PF", "C") if p in positions]
    return [r for r in ROLES if r in roles], ordered_positions, source


def _compute_dna(window: dict) -> dict[str, float]:
    """Compute Lineup DNA v2 — 6 dimensions from 5 PEAK3 components + data_status.

    Data constraint: no per-stat breakdowns exist at card-profile layer.
    This is the maximum defensible schema from the committed dataset.
    See docs/model/LINEUP_DNA_V2.md for full provenance documentation.
    """
    comp = window["components"]

    # 1. primary_creation ← statistical_impact
    #    Advanced metrics composite (BPM, VORP, WS, EPM, DBPM all included).
    #    Best available proxy for overall two-way impact.
    primary_creation = _norm("statistical_impact", comp["statistical_impact"])

    # 2. scoring_pressure ← traditional_production
    #    Box score scoring, playmaking, rebounding, defense box (all sub-weighted).
    #    Also includes TS%/efficiency and availability penalty.
    scoring_pressure = _norm("traditional_production", comp["traditional_production"])

    # 3. individual_validation ← individual_recognition
    #    MVP votes, All-NBA 1st/2nd/3rd, DPOY votes, Finals MVP, statistical titles
    #    (scoring, rebounds, assists, steals, blocks, 50-40-90).
    #    Contains direct defensive signal through DPOY votes and defensive statistical titles.
    individual_validation = _norm("individual_recognition", comp["individual_recognition"])

    # 4. postseason_translation ← postseason_individual_value, floored at 0
    #    Playoff BPM, WS, VORP, box scores; includes reliability weight (minutes×games×series)
    #    capturing both performance quality and availability in the postseason.
    po_raw = comp["postseason_individual_value"]
    postseason_translation = max(0.0, _norm("postseason_individual_value", po_raw))

    # 5. team_context ← team_achievement
    #    Championship and Finals appearance contributions, weighted by role on team.
    team_context = _norm("team_achievement", comp["team_achievement"])

    # 6. context_completeness ← data_status
    #    Data quality signal. Does not affect talent score or role eligibility.
    #    Low value = lineup confidence should be reduced.
    status = window.get("data_status", "")
    context_completeness = 100.0 if status == "complete" else 60.0

    return {
        "primary_creation":       round(primary_creation,       2),
        "scoring_pressure":       round(scoring_pressure,       2),
        "individual_validation":  round(individual_validation,  2),
        "postseason_translation": round(postseason_translation, 2),
        "team_context":           round(team_context,           2),
        "context_completeness":   round(context_completeness,   2),
    }


def _primary_role(eligible: list[str]) -> str | None:
    priority = ["lead_creator", "anchor", "forward_big", "wing_forward", "guard_wing"]
    for r in priority:
        if r in eligible:
            return r
    return None


def build_profiles(windows: list[dict]) -> tuple[list[dict], dict]:
    """Build v2 card profiles for all peak windows."""
    by_dur: dict[int, list[dict]] = {}
    for w in windows:
        by_dur.setdefault(w["duration_years"], []).append(w)

    pct_arrays: dict[int, dict[str, list[float]]] = {}
    for dur, pool in by_dur.items():
        pct_arrays[dur] = _compute_duration_percentiles(pool)

    profiles = []
    coverage: dict[str, int] = {
        "total": 0, "verified": 0, "provisional": 0,
        "excluded": 0, "official_eligible": 0,
    }
    by_dur_status: dict[int, dict[str, int]] = {}
    role_counts: dict[str, int] = {r: 0 for r in ROLES}
    no_role_ids: list[str] = []
    exclusion_reasons: list[dict] = []
    role_path_usage: dict[str, dict[str, int]] = {}

    for w in windows:
        dur = w["duration_years"]
        pcts = pct_arrays[dur]

        # CAPABILITY OBSERVATIONS FIRST — kept as traces either way, and as
        # the last-rung eligibility fallback for a slug with no position data.
        capability_roles, traces = _eligible_roles(w, pcts)
        # THE WINDOW'S OWN POSITIONS DECIDE (v5). See POSITION_ROLE_MAP.
        position_derived, positions, role_source = _position_roles(
            w["player_slug"], w["start_season"], w["end_season"]
        )
        if position_derived:
            eligible = position_derived
        else:
            eligible = capability_roles
            role_source = "capability_fallback"
        primary = _primary_role(eligible)
        dna = _compute_dna(w)

        data_ok = w.get("data_status", "") == "complete"
        if not eligible:
            status = "excluded"
            no_role_ids.append(w["id"])
            exclusion_reasons.append({
                "peak_window_id": w["id"],
                "player_name":    w["player_name"],
                "duration_years": dur,
                "rank":           w["rank"],
                "role_traces":    traces,
            })
        elif data_ok:
            status = "verified_data_derived"
        else:
            status = "provisional_data_derived"

        for role, trace in traces.items():
            if trace["eligible"]:
                role_path_usage.setdefault(role, {})
                pid = trace["path_id"] or "unknown"
                role_path_usage[role][pid] = role_path_usage[role].get(pid, 0) + 1

        profile = {
            "peak_window_id":        w["id"],
            "profile_version":       PROFILE_VERSION,
            "player_id":             w["player_id"],
            "player_slug":           w["player_slug"],
            "player_name":           w["player_name"],
            "duration_years":        dur,
            "start_season":          w["start_season"],
            "end_season":            w["end_season"],
            "anchor_season":         w["anchor_season"],
            "individual_peak_score": w["prime_score"],
            "individual_peak_rank":  w["rank"],
            "prime_index":           w["prime_index"],
            "eligible_roles":        eligible,
            "primary_role":          primary,
            # v5: which derivation produced `eligible_roles`, and the real
            # positions it came from (the card window's own seasons, on the
            # primary path) — so a surprising role is auditable back to the
            # exact seasons that earned it.
            "role_source":           role_source,
            "window_positions":      positions,
            "role_traces":           traces,
            "lineup_dna":            dna,
            "data_completeness":     w.get("data_status", "unknown"),
            "profile_status":        status,
            "source_fields": [
                "statistical_impact",
                "traditional_production",
                "individual_recognition",
                "postseason_individual_value",
                "team_achievement",
                "data_status",
            ],
            "transform_ids": [TRANSFORM_VERSION],
        }
        profiles.append(profile)

        coverage["total"] += 1
        if status == "verified_data_derived":
            coverage["verified"] += 1
        elif status == "provisional_data_derived":
            coverage["provisional"] += 1
        else:
            coverage["excluded"] += 1
        if status != "excluded":
            coverage["official_eligible"] += 1

        by_dur_status.setdefault(dur, {
            "total": 0, "verified": 0, "provisional": 0,
            "excluded": 0, "official_eligible": 0
        })
        by_dur_status[dur]["total"] += 1
        if status == "verified_data_derived":
            by_dur_status[dur]["verified"] += 1
        elif status == "provisional_data_derived":
            by_dur_status[dur]["provisional"] += 1
        else:
            by_dur_status[dur]["excluded"] += 1
        if status != "excluded":
            by_dur_status[dur]["official_eligible"] += 1

        for r in eligible:
            role_counts[r] += 1

    era_counts: dict[str, int] = {}
    for p in profiles:
        try:
            year = int(p["anchor_season"].split("-")[0]) if "-" in p["anchor_season"] else int(p["anchor_season"][:4])
        except (ValueError, IndexError):
            year = 0
        decade = f"{(year // 10) * 10}s"
        era_counts[decade] = era_counts.get(decade, 0) + 1

    stats = {
        "overall":           coverage,
        "by_duration":       {str(k): v for k, v in by_dur_status.items()},
        "role_counts":       role_counts,
        "era_counts":        era_counts,
        "no_role_window_ids": no_role_ids,
        "role_path_usage":   role_path_usage,
        "exclusion_reasons": exclusion_reasons,
    }
    return profiles, stats


def _source_commit() -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=REPO_ROOT, text=True,
        ).strip()
    except Exception:
        return "unknown"


# The two fields that change on every run regardless of whether the profile
# data did: a wall-clock stamp and the commit that happened to be checked out.
VOLATILE_METADATA_KEYS = ("generated_at", "source_commit")


def _write_metadata_stably(path: Path, meta: dict) -> None:
    """Write `meta` -- but leave the file alone when only the volatile stamps
    would change.

    WHY THIS EXISTS. `data/game/profiles/profile_metadata.v3.json` is a
    COMMITTED artefact, and `generated_at` (`datetime.now`) plus
    `source_commit` differ on every single run whether or not one profile
    changed. This script is called by `scripts/ci/build-web-data.sh`, which is
    run by three CI jobs AND by `make build-game-data` -- so regenerating on a
    clean tree produced a two-line diff with every other byte identical. That
    makes `git status` and `git diff --check` unusable as release checks, which
    is the actual cost: a real accidental edit would be indistinguishable from
    this permanent, meaningless one.

    Rewriting byte-identical content under a new timestamp is not a
    regeneration. The stamps that are KEPT record when this content was
    genuinely produced and from which commit, which is the more truthful
    reading of both fields, not merely the more convenient one.

    CI is unaffected: a fresh checkout either has no such file or has one whose
    content differs, and both take the write path below.
    """
    if path.exists():
        try:
            existing = json.loads(path.read_text())
        except (OSError, ValueError):
            existing = None
        if isinstance(existing, dict):
            def _without_stamps(d: dict) -> dict:
                return {k: v for k, v in d.items() if k not in VOLATILE_METADATA_KEYS}

            if _without_stamps(existing) == _without_stamps(meta):
                print(
                    f"Metadata unchanged → {path} "
                    f"(kept existing {', '.join(VOLATILE_METADATA_KEYS)})"
                )
                return

    with path.open("w") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote metadata → {path}")


def main() -> int:
    if not WINDOWS_PATH.exists():
        print(f"ERROR: {WINDOWS_PATH} not found. Run `python scripts/build_web_dataset.py` first.")
        return 1

    with WINDOWS_PATH.open() as f:
        windows: list[dict] = json.load(f)

    print(f"Loaded {len(windows)} peak windows from {WINDOWS_PATH}")
    profiles, stats = build_profiles(windows)

    # Validation
    ids = [p["peak_window_id"] for p in profiles]
    assert len(ids) == len(set(ids)), "FATAL: duplicate peak_window_ids"

    official = [p for p in profiles if p["profile_status"] != "excluded"]
    assert len(official) >= 100, f"FATAL: too few official profiles ({len(official)})"

    # v5 sanity: eligibility follows each card window's own positional
    # evidence, never a hand-authored star expectation. The old assert here
    # ("Jordan must be lead_creator") was exactly such an expectation — under
    # capability-derived roles it happened to hold, and under window-honest
    # roles it must NOT: Jordan's windows are SG-listed, so guard_wing is the
    # correct grant and lead_creator would be the defect. What IS asserted is
    # the mapping's own invariants, pool-wide (tests/run_the_table/
    # test_role_eligibility.py holds the per-archetype expectations).
    for p in profiles:
        roles = set(p["eligible_roles"])
        pos = set(p.get("window_positions") or [])
        if p.get("role_source") in ("window_positions", "career_positions"):
            assert roles, f"FATAL: {p['peak_window_id']} has positions {pos} but no roles"
            if "guard_wing" in roles:
                assert pos & {"PG", "SG"}, (
                    f"FATAL: {p['peak_window_id']} carries guard_wing without PG/SG evidence ({pos})"
                )
            if "anchor" in roles:
                assert "C" in pos, (
                    f"FATAL: {p['peak_window_id']} carries anchor without C evidence ({pos})"
                )
            if pos == {"C"}:
                assert roles == {"forward_big", "anchor"}, (
                    f"FATAL: pure-center window {p['peak_window_id']} has roles {roles}"
                )

    # Verify defensive anchors qualify (diagnostic — not regression)
    diagnostics = []
    for pid, pname in [("dikembe-mutombo", "Mutombo"), ("dennis-rodman", "Rodman"),
                       ("ben-wallace", "Ben Wallace")]:
        p = next((x for x in profiles if x["player_id"] == pid and x["duration_years"] == 1), None)
        if p:
            eligible_str = ",".join(p["eligible_roles"]) if p["eligible_roles"] else "NONE"
            anchor_path = (p["role_traces"].get("anchor", {}).get("path_id") or
                           p["role_traces"].get("anchor", {}).get("exclusion_reason", "N/A"))
            diagnostics.append(f"  {pname} 1yr: eligible={eligible_str}; anchor_path={anchor_path}")
    if diagnostics:
        print("Anchor diagnostic (named players, not regression tests):")
        for d in diagnostics:
            print(d)

    # Role feasibility: every role must have enough cards per duration for board gen
    by_dur_roles: dict[int, dict[str, int]] = {}
    for p in profiles:
        if p["profile_status"] == "excluded":
            continue
        d = p["duration_years"]
        by_dur_roles.setdefault(d, {r: 0 for r in ROLES})
        for r in p["eligible_roles"]:
            by_dur_roles[d][r] += 1

    for dur, role_dist in by_dur_roles.items():
        for role, cnt in role_dist.items():
            if cnt < 5:
                print(f"WARNING: {dur}yr has only {cnt} cards eligible for '{role}' (need >= 5)")

    # Write outputs
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    profile_path = OUT_DIR / f"card_profiles.{PROFILE_VERSION}.json"
    with profile_path.open("w") as f:
        json.dump(profiles, f, indent=2)
    print(f"Wrote {len(profiles)} profiles → {profile_path}")

    meta = {
        "profile_version":    PROFILE_VERSION,
        "card_pool_version":  CARD_POOL_VERSION,
        "transform_version":  TRANSFORM_VERSION,
        "generated_at":       datetime.now(timezone.utc).isoformat(),
        "source_commit":      _source_commit(),
        "source_file":        str(WINDOWS_PATH.relative_to(REPO_ROOT)),
        "total_profiles":     len(profiles),
        "official_eligible":  stats["overall"]["official_eligible"],
        "excluded":           stats["overall"]["excluded"],
        "supported_durations": [1, 2, 3, 5],
        "role_names":         ROLES,
        "dna_dimensions": [
            "primary_creation", "scoring_pressure", "individual_validation",
            "postseason_translation", "team_context", "context_completeness",
        ],
        "dna_version":                "v2",
        "dna_dimensions_count":       6,
        "removed_from_v1":            ["peer_quality_adjustment"],
        "rank_derived_fields_removed": ["peak_tier", "prime_index_normalized"],
        "data_constraint": (
            "No per-stat breakdowns (defensive rating, rebound rate, block rate) "
            "exist at card-profile layer. 6 DNA dimensions is the maximum defensible "
            "from available data. Role eligibility (v4) is derived from real career "
            "positions (nba_peak.perfect_season.career_positions), not from these "
            "component scores."
        ),
        "norm_constants":  NORM,
        # v4: positions decide eligibility; the capability rules survive as
        # traces and as the fallback for a slug with no position data.
        "position_role_map": {k: list(v) for k, v in POSITION_ROLE_MAP.items()},
        "role_rules": {
            k: {"id": v["id"], "description": v["description"]}
            for k, v in ROLE_RULES_V2.items()
        },
        "role_path_usage": stats["role_path_usage"],
    }
    meta_path = OUT_DIR / f"profile_metadata.{PROFILE_VERSION}.json"
    _write_metadata_stably(meta_path, meta)

    coverage_path = OUT_DIR / f"profile_coverage.{PROFILE_VERSION}.json"
    with coverage_path.open("w") as f:
        json.dump({k: v for k, v in stats.items() if k != "exclusion_reasons"}, f, indent=2)
    print(f"Wrote coverage report → {coverage_path}")

    exclusions_path = OUT_DIR / f"profile_exclusions.{PROFILE_VERSION}.json"
    with exclusions_path.open("w") as f:
        json.dump(stats["exclusion_reasons"], f, indent=2)
    print(f"Wrote exclusions → {exclusions_path}")

    # Summary
    ov = stats["overall"]
    print()
    print("=== Card Profile Coverage (v3) ===")
    print(f"Total windows:       {ov['total']}")
    print(f"Verified:            {ov['verified']} ({ov['verified']/ov['total']*100:.0f}%)")
    print(f"Provisional:         {ov['provisional']} ({ov['provisional']/ov['total']*100:.0f}%)")
    print(f"Excluded:            {ov['excluded']} ({ov['excluded']/ov['total']*100:.0f}%)")
    print(f"Official eligible:   {ov['official_eligible']}")
    print()
    print("=== Role Counts (all durations) ===")
    for role, cnt in stats["role_counts"].items():
        print(f"  {role:<22} {cnt}")
    print()
    print("=== By Duration ===")
    for dur, d in sorted(stats["by_duration"].items()):
        print(f"  {dur}yr: total={d['total']} verified={d['verified']} provisional={d['provisional']} excluded={d['excluded']}")
    print()
    print("=== Anchor Path Usage ===")
    for path_id, cnt in stats["role_path_usage"].get("anchor", {}).items():
        print(f"  {path_id:<40} {cnt}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
