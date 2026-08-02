"""
build_web_dataset.py
--------------------
Deterministic exporter: reads committed leaderboard CSVs from leaderboards/
and writes JSON files to data/web/.

Usage (from repo root):
    python scripts/build_web_dataset.py

Exit 0 on success, 1 on failure.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

# The exporter lives in scripts/, so the repo root has to be importable before
# `nba_peak` resolves. Version identity is imported, never retyped -- see the
# MODEL_VERSION block below.
_REPO_ROOT_FOR_IMPORT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT_FOR_IMPORT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT_FOR_IMPORT))

from nba_peak import formula_version as _formula_version  # noqa: E402

# ---------------------------------------------------------------------------
# Try to import unidecode for accent normalisation.
# ---------------------------------------------------------------------------
try:
    from unidecode import unidecode as _unidecode
    _HAS_UNIDECODE = True
except ImportError:
    _HAS_UNIDECODE = False


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
LEADERBOARDS_DIR = REPO_ROOT / "leaderboards"
OUTPUT_DIR = REPO_ROOT / "data" / "web"

CSV_FILES = {
    1: LEADERBOARDS_DIR / "top_250_1_year_prime.csv",
    2: LEADERBOARDS_DIR / "top_250_2_year_prime.csv",
    3: LEADERBOARDS_DIR / "top_250_3_year_prime.csv",
    5: LEADERBOARDS_DIR / "top_250_5_year_prime.csv",
}

SCHEMA_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Model version: derived, not retyped.
# ---------------------------------------------------------------------------
# `nba_peak/formula_version.py` is the declared single source of truth for which
# scoring rules produced a number, and its slugs are UNDERSCORED ("peak3_v1").
# This exporter has always emitted a HYPHENATED "peak3-v1" into
# data/web/metadata.json, and that string is a published API contract: it is
# returned verbatim by GET /api/v1/meta, and apps/api/tests/test_model_version.py
# asserts the duel dataset's model_version is NOT one of the peaks formula slugs
# (`body["model_version"] not in FV.ALL_FORMULA_VERSIONS`) precisely so that a
# duel score can never be mistaken for a peaks-board score.
#
# So the fix for "three spellings of the version" is NOT to change the wire
# value -- that would break a real contract and silently re-namespace every
# stored duel result. It is to stop the two spellings from being able to drift:
# the wire value is now BUILT from the imported source of truth through one
# explicit, visible mapping, and the exporter refuses to run if the mapping ever
# stops covering the default version.
#
#   nba_peak.formula_version.PEAK3_V1  ("peak3_v1")  ->  "peak3-v1"  (wire)
#
# The third spelling found in the audit, "peak3-2026" in
# apps/api/tests/conftest.py:73, belongs to the synthetic fallback fixture, not
# to any generated artifact. It is reported to the lead rather than edited here
# (that file is owned by another workstream).
_WIRE_MODEL_VERSION: dict[str, str] = {
    _formula_version.PEAK3_V1: "peak3-v1",
    _formula_version.PEAK3_V2: "peak3-v2",
}

# The formula this exporter's inputs were scored under. The committed
# leaderboards/*.csv are v1 artifacts; v2 is opt-in and writes to its own files.
SOURCE_FORMULA_VERSION = _formula_version.PEAK3_V1

if SOURCE_FORMULA_VERSION not in _WIRE_MODEL_VERSION:
    raise RuntimeError(
        f"No wire model_version mapped for {SOURCE_FORMULA_VERSION!r}. "
        "Add it to _WIRE_MODEL_VERSION rather than hardcoding a string."
    )

MODEL_VERSION = _WIRE_MODEL_VERSION[SOURCE_FORMULA_VERSION]

# Pinned so a refactor of formula_version cannot silently re-namespace every
# duel artifact. If this ever fires, the wire contract is being changed and that
# needs to be a deliberate, documented decision -- not a side effect.
assert MODEL_VERSION == "peak3-v1", (
    f"data/web model_version must stay 'peak3-v1' (published contract), got {MODEL_VERSION!r}"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def slug(name: str) -> str:
    """Convert a player name to a URL-safe slug."""
    s = name
    if _HAS_UNIDECODE:
        s = _unidecode(s)
    else:
        # Manual ASCII fold for common accented characters
        replacements = {
            "é": "e", "è": "e", "ê": "e", "ë": "e",
            "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a",
            "í": "i", "ì": "i", "î": "i", "ï": "i",
            "ó": "o", "ò": "o", "ô": "o", "ö": "o", "õ": "o",
            "ú": "u", "ù": "u", "û": "u", "ü": "u",
            "ý": "y", "ÿ": "y",
            "ñ": "n", "ç": "c",
            "ć": "c", "č": "c", "š": "s", "ž": "z",
            "ő": "o", "ű": "u", "ő": "o",
            "đ": "d", "ß": "ss",
        }
        for src, dst in replacements.items():
            s = s.replace(src, dst)
            s = s.replace(src.upper(), dst.upper())
    # lowercase, remove apostrophes/periods, replace spaces/underscores with hyphen
    s = s.lower()
    s = re.sub(r"['’\.]", "", s)
    s = re.sub(r"[\s_]+", "-", s)
    s = re.sub(r"[^a-z0-9\-]", "", s)
    s = re.sub(r"-+", "-", s).strip("-")
    return s


def window_id(player_slug: str, n: int, anchor: str) -> str:
    """Build canonical window ID.

    Format: {player_slug}-{n}yr-{anchor_no_dash}
    E.g. michael-jordan-1yr-199091
    """
    anchor_no_dash = anchor.replace("-", "")
    return f"{player_slug}-{n}yr-{anchor_no_dash}"


def get_source_commit() -> str:
    """Return the current HEAD commit SHA via git."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True, text=True, check=True,
            cwd=str(REPO_ROOT),
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


def _git_porcelain(*paths: str) -> str | None:
    """`git status --porcelain` output, or None if git is unavailable."""
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--", *paths] if paths
            else ["git", "status", "--porcelain"],
            capture_output=True, text=True, check=True,
            cwd=str(REPO_ROOT),
        )
        return result.stdout
    except Exception:
        return None


def get_source_tree_dirty() -> bool | None:
    """Was the working tree modified when this build ran?

    WHY THIS EXISTS. `source_commit` alone is a provenance lie waiting to
    happen. A build from a dirty tree records HEAD, but HEAD is not what was
    read -- the files on disk were. That failure was observed, not theorised:
    data/web/metadata.json recorded source_commit d5e8acf while
    data/web/methodology.json was byte-equal to a LATER revision of the
    METHODOLOGY dict, so the recorded commit provably did not produce the
    artifact it labelled.

    None means "git could not answer", which is different from "clean" and is
    recorded as such rather than being flattened to False.
    """
    out = _git_porcelain()
    if out is None:
        return None
    return bool(out.strip())


def sha256_file(path: Path) -> str:
    """SHA-256 of a file's bytes, streamed."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def get_input_digests() -> dict[str, str]:
    """SHA-256 of every input CSV actually read, keyed by repo-relative path.

    These are what make the build self-identifying. `source_commit` says which
    revision was checked out; these say what was on disk. When the two disagree
    -- an uncommitted edit, a partial checkout, a hand-patched CSV -- the digests
    are the half that is still true, and a parity test can verify them without
    needing git at all.
    """
    digests: dict[str, str] = {}
    for _n, path in sorted(CSV_FILES.items()):
        if path.exists():
            digests[str(path.relative_to(REPO_ROOT))] = sha256_file(path)
    return digests


def get_leaderboards_dir_dirty() -> bool | None:
    """Specifically: are the canonical CSVs uncommitted-modified right now?

    Narrower and more actionable than the whole-tree flag -- a dirty README is
    not a provenance problem, a dirty leaderboards/ directory is.
    """
    out = _git_porcelain("leaderboards")
    if out is None:
        return None
    return bool(out.strip())


def safe_float(value, field_name: str, row_ctx: str) -> float:
    """Convert to float, raise on NaN/inf."""
    try:
        f = float(value)
    except (ValueError, TypeError) as exc:
        raise ValueError(
            f"Cannot convert '{value}' to float for field '{field_name}' in {row_ctx}"
        ) from exc
    if math.isnan(f):
        raise ValueError(f"NaN detected in field '{field_name}' in {row_ctx}")
    if math.isinf(f):
        raise ValueError(f"Infinity detected in field '{field_name}' in {row_ctx}")
    return f


def parse_1yr_row(row: pd.Series) -> dict:
    ctx = f"1yr row rank={row['Rank']}"
    player_name = str(row["Player"]).strip()
    player_slug_val = slug(player_name)
    anchor = str(row["Best season"]).strip()

    rank_val = int(row["Rank"])
    prime_raw = safe_float(row["Prime raw"], "prime_raw", ctx)
    prime_display = safe_float(row["Prime display"], "prime_display", ctx)

    si = safe_float(row["SI contribution"], "SI contribution", ctx)
    tp = safe_float(row["TP contribution"], "TP contribution", ctx)
    rec = safe_float(row["Recognition contribution"], "Recognition contribution", ctx)
    post = safe_float(row["Postseason contribution"], "Postseason contribution", ctx)
    team = safe_float(row["Team Achievement contribution"], "Team Achievement contribution", ctx)
    tm_adj = safe_float(row["Teammate adjustment"], "Teammate adjustment", ctx)

    data_status = str(row.get("Data completeness status", "unknown")).strip()

    wid = window_id(player_slug_val, 1, anchor)

    return {
        "id": wid,
        "player_id": player_slug_val,
        "player_slug": player_slug_val,
        "player_name": player_name,
        "duration_years": 1,
        "start_season": anchor,
        "end_season": anchor,
        "anchor_season": anchor,
        "rank": rank_val,
        "prime_score": prime_display,
        "prime_index": prime_raw,
        "components": {
            "statistical_impact": si,
            "traditional_production": tp,
            "individual_recognition": rec,
            "postseason_individual_value": post,
            "team_achievement": team,
            "teammate_adjustment": tm_adj,
        },
        "data_status": data_status,
    }


def parse_multiyear_row(row: pd.Series, n: int) -> dict:
    ctx = f"{n}yr row rank={row['Rank']}"
    player_name = str(row["Player"]).strip()
    player_slug_val = slug(player_name)

    rank_val = int(row["Rank"])
    prime_raw = safe_float(row["Prime raw"], "prime_raw", ctx)
    prime_display = safe_float(row["Prime display"], "prime_display", ctx)

    # Parse "Best window" like "1990-91-1991-92"
    best_window = str(row["Best window"]).strip()
    # NBA seasons look like YYYY-YY; two of them joined by a hyphen
    # Pattern: (DDDD-DD)-(DDDD-DD) where each part is \d{4}-\d{2}
    season_pattern = re.compile(r"(\d{4}-\d{2})")
    seasons_found = season_pattern.findall(best_window)
    if len(seasons_found) < 2:
        raise ValueError(f"Cannot parse Best window '{best_window}' in {ctx}")
    start_season = seasons_found[0]
    end_season = seasons_found[-1]

    anchor = str(row["Anchor season"]).strip()

    si = safe_float(row["Avg SI contribution"], "Avg SI contribution", ctx)
    tp = safe_float(row["Avg TP contribution"], "Avg TP contribution", ctx)
    rec = safe_float(row["Avg Recognition contribution"], "Avg Recognition contribution", ctx)
    post = safe_float(row["Avg Postseason contribution"], "Avg Postseason contribution", ctx)
    team = safe_float(row["Avg Team Achievement contribution"], "Avg Team Achievement contribution", ctx)
    tm_adj = safe_float(row["Avg Teammate adjustment"], "Avg Teammate adjustment", ctx)

    data_status = str(row.get("Data completeness status", "unknown")).strip()

    wid = window_id(player_slug_val, n, anchor)

    return {
        "id": wid,
        "player_id": player_slug_val,
        "player_slug": player_slug_val,
        "player_name": player_name,
        "duration_years": n,
        "start_season": start_season,
        "end_season": end_season,
        "anchor_season": anchor,
        "rank": rank_val,
        "prime_score": prime_display,
        "prime_index": prime_raw,
        "components": {
            "statistical_impact": si,
            "traditional_production": tp,
            "individual_recognition": rec,
            "postseason_individual_value": post,
            "team_achievement": team,
            "teammate_adjustment": tm_adj,
        },
        "data_status": data_status,
    }


# ---------------------------------------------------------------------------
# Methodology JSON (fixed at model v1)
# ---------------------------------------------------------------------------

METHODOLOGY = {
    "weights": {
        "statistical_impact": 0.38,
        "traditional_production": 0.21,
        "individual_recognition": 0.20,
        "postseason_individual_value": 0.18,
        "team_achievement": 0.03,
    },
    "components": [
        {
            "id": "statistical_impact",
            "label": "Statistical Impact",
            "weight": 0.38,
            "weight_pct": 38,
            "short_description": "Raw advanced metrics measuring on-court impact: BPM, VORP, Win Shares, WS/48, and PER.",
            # Phase 10D: this used to lead with "BPM, VORP, WS, PER, EPM, and
            # similar" and list "EPM (when available)" as a key input. The
            # hedge was literally true but read as "the model uses EPM", and
            # EPM/LEBRON are non-null in 0 of the 11,429 scored seasons while
            # RAPTOR/DARKO/RAPM are not columns at all -- so the supplement has
            # never contributed to a single served score. Saying so plainly
            # also explains the component's real shape: with the supplement
            # always absent, the masked average renormalizes over 38 instead of
            # 45 and per-minute rate terms are 73.7% of the component.
            "long_description": (
                "The largest component (38%) captures a player's measurable basketball impact through advanced metrics. "
                "The signals actually used are Box Plus/Minus (BPM), its offensive and defensive splits (OBPM/DBPM), "
                "Value Over Replacement Player (VORP), Win Shares (WS) and WS/48, and Player Efficiency Rating (PER). "
                "The model also defines an optional supplement for modern ensemble metrics (EPM, LEBRON, RAPTOR and "
                "similar), but no season in the published dataset carries those metrics, so the supplement contributes "
                "nothing to any score shown here. "
                "All metrics are evaluated on their raw values using continuous, era-relative formulas — no hard percentile cutoffs. "
                "Because the supplement is absent, per-minute rate metrics (BPM, WS/48, PER) make up about three quarters "
                "of this component — which is why an efficient low-minute player can score well on it. The published "
                "rankings apply a minutes floor for that reason."
            ),
            "key_inputs": ["BPM", "OBPM", "DBPM", "VORP", "WS", "WS/48", "PER"],
            "common_misconceptions": [
                "This is not simply PER.",
                "EPM/LEBRON are defined as an optional supplement but are absent from every season in this dataset, so they never affect a published score.",
                "It captures defense separately through DBPM.",
            ],
        },
        {
            "id": "traditional_production",
            "label": "Traditional Production",
            "weight": 0.21,
            "weight_pct": 21,
            "short_description": "Scoring, rebounding, assists, and efficiency relative to team workload.",
            "long_description": (
                "Traditional Production (21%) captures a player's raw statistical output — points, rebounds, assists — "
                "adjusted for era and weighted by the player's role-specific burden on their team. "
                "Efficiency (true shooting) interacts with volume so that volume alone without efficiency does not earn full credit. "
                "The teammate-adjustment term appears here as a descriptive modifier, not a fifth component."
            ),
            "key_inputs": ["Points", "Rebounds", "Assists", "True Shooting %", "Team scoring share", "Team assist share"],
            "common_misconceptions": [
                "Scoring titles alone do not dominate this component.",
                "The teammate adjustment is additive but small (±0.5 max).",
            ],
        },
        {
            "id": "individual_recognition",
            "label": "Individual Recognition",
            "weight": 0.20,
            "weight_pct": 20,
            "short_description": "MVP, All-NBA, Defensive Player of the Year, Finals MVP, and statistical titles.",
            "long_description": (
                "Individual Recognition (20%) captures peer and media validation of a player's greatness: "
                "MVP votes and finishes (with vote-share weighting so near-misses count), "
                "All-NBA selections (First/Second/Third with diminishing credit), DPOY votes, "
                "Finals MVP awards, and statistical titles (scoring, assists, rebounds). "
                "Overlap discounts prevent triple-counting when a player wins multiple major awards in the same season. "
                "Championships are explicitly excluded — they belong to Team Achievement."
            ),
            "key_inputs": ["MVP vote share", "All-NBA selections", "DPOY votes", "Finals MVP", "Statistical titles"],
            "common_misconceptions": [
                "Championships are NOT in this component.",
                "Third All-NBA counts but at reduced weight.",
                "Finals MVP is an individual award here, not a team outcome.",
            ],
        },
        {
            "id": "postseason_individual_value",
            "label": "Postseason Individual Value",
            "weight": 0.18,
            "weight_pct": 18,
            "short_description": "Personal playoff performance: efficiency, dominance, and deep-run volume.",
            "long_description": (
                "Postseason Individual Value (18%) measures how a player performed in the playoffs on a personal level — "
                "independently of whether their team won. Inputs include playoff BPM/WS, individual efficiency relative to "
                "regular-season baseline, dominance bonuses for historically elite playoff performances, and deep-run volume "
                "(minutes in later rounds weighted by opponent quality and series success). An elevation term captures performing "
                "above one's regular-season level. A safeguard prevents players from being penalized for inadequate team support "
                "while still rewarding genuine greatness. Missing postseason seasons contribute zero — they do not go negative."
            ),
            "key_inputs": ["Playoff BPM", "Playoff WS", "Playoff efficiency", "Deep-run minutes", "Opponent quality", "Series success"],
            "common_misconceptions": [
                "Team wins are captured in Team Achievement, not here.",
                "Missing playoffs = 0, not a penalty.",
                "A dominant first-round exit can outscore a passive Finals appearance.",
            ],
        },
        {
            "id": "team_achievement",
            "label": "Team Achievement",
            "weight": 0.03,
            "weight_pct": 3,
            "short_description": "Championships and Finals appearances, role-adjusted.",
            "long_description": (
                "Team Achievement (3%) is deliberately small. It rewards championships and Finals appearances but adjusts "
                "for the player's role on the team so that a dominant contributor receives more credit than a peripheral one. "
                "A role-adjustment factor prevents a bench player from receiving the same team credit as the best player on a title team. "
                "The weight is intentionally kept at 3% to avoid allowing team success to override individual greatness — "
                "otherwise players on historically great teams would be systematically overrated."
            ),
            "key_inputs": ["Championships", "Finals appearances", "Title role adjustment"],
            "common_misconceptions": [
                "This is only 3% of the score.",
                "A championship does not automatically boost a player's rank significantly.",
                "Role adjustment means the best player on a title team earns more credit here.",
            ],
        },
    ],
    "teammate_adjustment": {
        "id": "teammate_adjustment",
        "label": "Teammate Adjustment",
        "description": (
            "A small descriptive modifier (±0.5 max) that accounts for the strength of teammates. "
            "Playing alongside multiple All-Stars slightly reduces a player's individual credit; "
            "carrying a weak supporting cast slightly increases it. "
            "This is NOT one of the five percentage components."
        ),
        "range": [-0.5, 0.5],
    },
    "calibration": {
        "description": (
            "The prime_index (raw) is a continuous additive score on an open scale. "
            "The prime_score (display) is a separate monotonic remapping of the raw index into a 0-100 historical band for readability. "
            "The calibrated display score is computed ONCE after window aggregation, never by averaging calibrated single-season scores."
        ),
        "raw_label": "Prime Index (Raw)",
        "display_label": "Prime Score (Display)",
    },
    "window_aggregation": {
        "description": "Multi-year windows aggregate raw season scores using rank-weighted averaging before calibrating once. Weights by window size:",
        "weights": {
            "1yr": [1.0],
            "2yr": [0.667, 0.333],
            "3yr": [0.500, 0.333, 0.167],
            "5yr": [0.323, 0.258, 0.194, 0.129, 0.097],
        },
    },
}


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    errors: list[str] = []

    # --- load all durations ---
    all_records: dict[int, list[dict]] = {}

    for n, csv_path in CSV_FILES.items():
        if not csv_path.exists():
            errors.append(f"Missing CSV: {csv_path}")
            continue

        df = pd.read_csv(csv_path)

        # Validate required columns exist
        required_base = {"Rank", "Player", "Prime raw", "Prime display"}
        missing_cols = required_base - set(df.columns)
        if missing_cols:
            errors.append(f"Duration {n}yr CSV missing columns: {missing_cols}")
            continue

        records: list[dict] = []
        seen_ids: set[str] = set()

        for _, row in df.iterrows():
            # Validate required fields are present (not NaN)
            if pd.isna(row.get("Rank")):
                errors.append(f"Duration {n}yr: missing Rank in row: {row.to_dict()}")
                continue
            if pd.isna(row.get("Player")) or str(row["Player"]).strip() == "":
                errors.append(f"Duration {n}yr: missing Player in rank {row.get('Rank')}")
                continue
            if pd.isna(row.get("Prime raw")):
                errors.append(f"Duration {n}yr: missing prime_raw in rank {row.get('Rank')}")
                continue
            if pd.isna(row.get("Prime display")):
                errors.append(f"Duration {n}yr: missing prime_display in rank {row.get('Rank')}")
                continue

            try:
                if n == 1:
                    rec = parse_1yr_row(row)
                else:
                    rec = parse_multiyear_row(row, n)
            except ValueError as exc:
                errors.append(str(exc))
                continue

            # Check for duplicate window IDs
            wid = rec["id"]
            if wid in seen_ids:
                errors.append(f"Duplicate window ID: {wid} (duration {n}yr)")
            seen_ids.add(wid)

            records.append(rec)

        # Regression checks
        if records:
            rank1 = next((r for r in records if r["rank"] == 1), None)
            if n == 1 and rank1 and rank1["player_name"] != "Michael Jordan":
                errors.append(
                    f"Regression: rank 1 for 1yr is '{rank1['player_name']}', expected 'Michael Jordan'"
                )
            if n == 5 and rank1 and rank1["player_name"] != "Michael Jordan":
                errors.append(
                    f"Regression: rank 1 for 5yr is '{rank1['player_name']}', expected 'Michael Jordan'"
                )

        all_records[n] = records
        print(f"  Loaded {n}yr: {len(records)} windows")

    # Abort early if any errors found
    if errors:
        print("\nERRORS detected — aborting output:")
        for e in errors:
            print(f"  ERROR: {e}")
        sys.exit(1)

    # --- build outputs ---
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    source_commit = get_source_commit()
    source_tree_dirty = get_source_tree_dirty()
    leaderboards_dirty = get_leaderboards_dir_dirty()
    input_digests = get_input_digests()
    generated_at = datetime.now(timezone.utc).isoformat()
    total_windows = sum(len(v) for v in all_records.values())

    # metadata.json
    #
    # Every field below `source_commit` is ADDITIVE provenance (this pass). The
    # ranking payload shape is untouched; nothing here is derived from a score.
    metadata = {
        "schema_version": SCHEMA_VERSION,
        "model_version": MODEL_VERSION,
        "generated_at": generated_at,
        "source_commit": source_commit,
        # True  -> the tree had uncommitted changes, so `source_commit` alone
        #          does NOT identify what was read. Trust `source_inputs`.
        # False -> commit and disk agree.
        # None  -> git could not answer (not a checkout, git missing).
        "source_tree_dirty": source_tree_dirty,
        "leaderboards_dir_dirty": leaderboards_dirty,
        # The formula slug these inputs were scored under, imported from
        # nba_peak/formula_version.py, plus the full descriptive string built
        # from OFFICIAL_WEIGHTS. `model_version` above is the hyphenated wire
        # spelling of this same version; the mapping lives at the top of this
        # file and is asserted there.
        "formula_version_id": SOURCE_FORMULA_VERSION,
        "formula_version": _formula_version.description(SOURCE_FORMULA_VERSION),
        "model_label": _formula_version.label(SOURCE_FORMULA_VERSION),
        "supported_durations": sorted(all_records.keys()),
        "player_count": len({r["player_slug"] for recs in all_records.values() for r in recs}),
        "peak_window_count": total_windows,
        "source_artifacts": [
            f"leaderboards/top_250_{n}_year_prime.csv" for n in sorted(all_records.keys())
        ],
        # SHA-256 of the exact bytes read, keyed by repo-relative path. This is
        # the field that makes a build self-identifying: it stays true even when
        # `source_commit` does not.
        "source_inputs": input_digests,
        "source_input_digest_algorithm": "sha256",
    }
    _write_json(OUTPUT_DIR / "metadata.json", metadata)
    print(f"  Wrote metadata.json")

    # leaderboards.json
    leaderboards = {str(n): recs for n, recs in sorted(all_records.items())}
    _write_json(OUTPUT_DIR / "leaderboards.json", leaderboards)
    print(f"  Wrote leaderboards.json")

    # peak_windows.json - flat sorted array across all durations, sorted by prime_index desc
    all_windows: list[dict] = []
    for recs in all_records.values():
        all_windows.extend(recs)
    all_windows.sort(key=lambda r: r["prime_index"], reverse=True)
    _write_json(OUTPUT_DIR / "peak_windows.json", all_windows)
    print(f"  Wrote peak_windows.json ({len(all_windows)} entries)")

    # methodology.json
    _write_json(OUTPUT_DIR / "methodology.json", METHODOLOGY)
    print(f"  Wrote methodology.json")

    # --- Summary ---
    print(f"\nSummary:")
    print(f"  Durations processed: {sorted(all_records.keys())}")
    for n, recs in sorted(all_records.items()):
        print(f"  {n}yr: {len(recs)} windows")
    print(f"  Total windows: {total_windows}")
    print(f"  Unique players: {metadata['player_count']}")
    print(f"  Model version (wire): {MODEL_VERSION}  <- {SOURCE_FORMULA_VERSION}")
    print(f"  Source commit: {source_commit}")
    dirty_label = {True: "YES", False: "no", None: "unknown (git unavailable)"}
    print(f"  Working tree dirty: {dirty_label[source_tree_dirty]}")
    print(f"  leaderboards/ dirty: {dirty_label[leaderboards_dirty]}")
    print("  Input digests (sha256):")
    for rel, digest in input_digests.items():
        print(f"    {digest}  {rel}")
    if source_tree_dirty:
        # Loud, but not fatal: building from a dirty tree is legitimate during
        # development. What is NOT acceptable is doing it silently, which is how
        # metadata.json came to carry a commit that did not produce it.
        print(
            "\n  NOTE: built from a DIRTY working tree. `source_commit` above does not\n"
            "        fully identify these artifacts -- `source_inputs` digests do."
        )
    print(f"  Output dir: {OUTPUT_DIR}")
    print("\nDone. Exit 0.")


def _write_json(path: Path, data: object) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    print("build_web_dataset.py — reading committed leaderboard CSVs\n")
    main()
