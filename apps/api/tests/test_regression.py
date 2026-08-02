"""Regression + parity tests: every served ranking surface must agree with the
canonical committed CSVs, and with the artifact it claims to come from.

WHY THIS FILE GREW (UX/organization/polish pass, workstream W6)
--------------------------------------------------------------
Two separate problems were found, and only one of them was a test.

1. THE SKIP THAT ATE THE SUITE. Every assertion below used to hang off a
   module-scoped fixture that called `pytest.skip()` when
   `data/web/leaderboards.json` was absent. `data/web/` is gitignored
   (.gitignore:58). So on a clean checkout -- which is every clean checkout --
   the entire parity suite evaporated into "skipped" and CI stayed green while
   asserting nothing at all. Worse, apps/api/tests/conftest.py falls back to
   FIXTURE_LEADERBOARDS (30 synthetic players literally named "First001
   Last001") when the same file is missing, so the leaderboard API tests kept
   "passing" against fabricated data.

   A parity test that silently disables itself when the thing it guards is
   missing is not a weak test, it is an anti-test: it converts a real failure
   ("the dataset was never built") into a pass. So the fixture now FAILS, with
   the command to fix it. CI already runs `python scripts/build_web_dataset.py`
   in two jobs (.github/workflows/ci.yml:69,89), so failing here is safe.

   One escape hatch exists, and only one: `PEAK3_ALLOW_MISSING_WEB_DATASET=1`.
   It is for genuine bootstrap ordering (a container that runs the API test
   image before the data build step). It is an env var rather than a default so
   that skipping is a decision somebody made and can be grepped for, instead of
   the silent default it used to be.

2. THE SOURCE OF TRUTH IS NOT ONE FILE. The audit assumed the rankings page
   reads data/web/. It does not. There are two independent generated pipelines,
   and conflating them is how "the rankings look stale" became a bug report:

     leaderboards/*.csv          (committed, canonical, 250-player pool)
       -> scripts/build_web_dataset.py
       -> data/web/*.json                       [GITIGNORED]
       -> DatasetStore -> /api/v1/leaderboards, /api/v1/meta, Peak Duel,
                          nba_peak/run_the_table/cards.py (peak_windows.json)

     cache/processed/scored_1980_2026.parquet   (gitignored, rebuild-only)
       -> scripts/build_top_peaks.py / build_top_seasons.py
       -> data/game/.../top_1000_{peaks,seasons}.v{1,2}.json   [COMMITTED]
       -> /api/v1/peaks, /api/v1/seasons -> the /rankings page

   The website's rankings board is fed by the SECOND pipeline. The tests below
   therefore pin BOTH, and -- most importantly -- pin them to each other, since
   nothing previously asserted that the board a visitor sees agrees with the
   CSVs the project calls canonical.

NOTHING HERE ASSERTS A NEW NUMBER. Every expected value is read from a
committed artifact. No score is computed in this file.
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent.parent.parent
DATA_WEB_DIR = ROOT / "data" / "web"
DATA_WEB = DATA_WEB_DIR / "leaderboards.json"
METADATA_PATH = DATA_WEB_DIR / "metadata.json"
PEAK_WINDOWS_PATH = DATA_WEB_DIR / "peak_windows.json"
LEADERBOARDS_DIR = ROOT / "leaderboards"
BOARD_DIR = ROOT / "data" / "game" / "experimental" / "player_pool_1500"
PEAKS_BOARD_PATH = BOARD_DIR / "top_1000_peaks.v1.json"
SEASONS_BOARD_PATH = BOARD_DIR / "top_1000_seasons.v1.json"

BUILD_COMMAND = "python scripts/build_web_dataset.py   (or: make build-dataset)"
ESCAPE_HATCH = "PEAK3_ALLOW_MISSING_WEB_DATASET"

# The canonical CSVs carry 2 decimal places on display scores and 4 on raw
# indices, so a reconciliation tolerance is arithmetic, not slack.
ROUNDING_TOLERANCE = 0.01
COMPONENT_SUM_TOLERANCE = 0.001


# ---------------------------------------------------------------------------
# Loading -- fails loudly, never silently skips
# ---------------------------------------------------------------------------

def _require_web_dataset(path: Path) -> dict:
    """Load a data/web artifact, or fail with the exact command that fixes it."""
    if not path.exists():
        if os.environ.get(ESCAPE_HATCH) == "1":
            pytest.skip(
                f"{ESCAPE_HATCH}=1 set explicitly; skipping parity for {path.name}. "
                "This is a bootstrap-ordering escape hatch, not a normal state."
            )
        pytest.fail(
            f"\n{path} is missing, so the ranking parity suite cannot run.\n"
            f"data/web/ is gitignored by design; it must be generated:\n\n"
            f"    {BUILD_COMMAND}\n\n"
            f"This used to be a pytest.skip(), which meant a clean checkout ran\n"
            f"ZERO parity assertions and reported success. If you genuinely need\n"
            f"to bypass it (bootstrap ordering only), set {ESCAPE_HATCH}=1."
        )
    with path.open() as f:
        return json.load(f)


@pytest.fixture(scope="module")
def web_data() -> dict:
    return _require_web_dataset(DATA_WEB)


@pytest.fixture(scope="module")
def web_metadata() -> dict:
    return _require_web_dataset(METADATA_PATH)


@pytest.fixture(scope="module")
def peak_windows() -> list[dict]:
    return _require_web_dataset(PEAK_WINDOWS_PATH)  # type: ignore[return-value]


def _require_committed(path: Path) -> dict:
    """Load a COMMITTED artifact. Missing is always a hard failure -- these are
    in git, so absence means a broken checkout, never a pending build step."""
    assert path.exists(), (
        f"{path} is committed to the repository but missing from this checkout. "
        "This is not a build-ordering problem; the working tree is broken."
    )
    with path.open() as f:
        return json.load(f)


@pytest.fixture(scope="module")
def peaks_board() -> dict:
    return _require_committed(PEAKS_BOARD_PATH)


@pytest.fixture(scope="module")
def seasons_board() -> dict:
    return _require_committed(SEASONS_BOARD_PATH)


def _csv_rows(filename: str) -> list[dict]:
    path = LEADERBOARDS_DIR / filename
    assert path.exists(), f"Canonical leaderboard missing from checkout: {path}"
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _csv_rank1(filename: str) -> tuple[str, float, float]:
    """Return (player_name, prime_raw, prime_display) for rank 1 in a CSV."""
    rows = _csv_rows(filename)
    assert rows, f"Empty canonical CSV: {filename}"
    row = rows[0]
    return row["Player"].strip(), float(row["Prime raw"]), float(row["Prime display"])


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Original regression coverage (unchanged assertions, now un-skippable)
# ---------------------------------------------------------------------------

def test_1yr_rank1_matches_canonical(web_data):
    player, raw, display = _csv_rank1("top_250_1_year_prime.csv")
    rank1 = next(r for r in web_data["1"] if r["rank"] == 1)
    assert rank1["player_name"] == player, f"1yr rank 1 mismatch: {rank1['player_name']} vs {player}"
    assert abs(rank1["prime_index"] - raw) < ROUNDING_TOLERANCE
    assert abs(rank1["prime_score"] - display) < ROUNDING_TOLERANCE


def test_5yr_rank1_matches_canonical(web_data):
    player, raw, display = _csv_rank1("top_250_5_year_prime.csv")
    rank1 = next(r for r in web_data["5"] if r["rank"] == 1)
    assert rank1["player_name"] == player
    assert abs(rank1["prime_index"] - raw) < ROUNDING_TOLERANCE
    assert abs(rank1["prime_score"] - display) < ROUNDING_TOLERANCE


def test_1yr_top10_order_matches_canonical(web_data):
    canonical = [r["Player"].strip() for r in _csv_rows("top_250_1_year_prime.csv")[:10]]
    web_rows = sorted(web_data["1"], key=lambda r: r["rank"])[:10]
    web_names = [r["player_name"] for r in web_rows]
    assert web_names == canonical, f"Top-10 order mismatch:\nweb:  {web_names}\ncsv: {canonical}"


def test_component_contributions_are_finite(web_data):
    for dur, rows in web_data.items():
        for row in rows:
            for comp_key, val in row["components"].items():
                assert math.isfinite(val), f"NaN/Inf in {row['player_name']} {dur}yr {comp_key}: {val}"


def test_no_duplicate_ids(web_data):
    all_ids = []
    for rows in web_data.values():
        all_ids.extend(r["id"] for r in rows)
    assert len(all_ids) == len(set(all_ids)), "Duplicate window IDs found"


def test_ranks_are_sequential(web_data):
    for dur, rows in web_data.items():
        ranks = sorted(r["rank"] for r in rows)
        assert ranks == list(range(1, len(ranks) + 1)), f"Non-sequential ranks in {dur}yr"


def test_michael_jordan_is_rank1_1yr(web_data):
    rank1 = next(r for r in web_data["1"] if r["rank"] == 1)
    assert "jordan" in rank1["player_name"].lower()


def test_michael_jordan_is_rank1_5yr(web_data):
    rank1 = next(r for r in web_data["5"] if r["rank"] == 1)
    assert "jordan" in rank1["player_name"].lower()


# ---------------------------------------------------------------------------
# NEW: full row-by-row parity, not just rank 1 and the top 10
# ---------------------------------------------------------------------------

CSV_FOR_DURATION = {
    1: "top_250_1_year_prime.csv",
    2: "top_250_2_year_prime.csv",
    3: "top_250_3_year_prime.csv",
    5: "top_250_5_year_prime.csv",
}


@pytest.mark.parametrize("duration", sorted(CSV_FOR_DURATION))
def test_every_exported_row_matches_the_canonical_csv(web_data, duration):
    """Rank 1 and the top 10 were the only rows ever compared. A drift at rank
    137 was therefore invisible. Compare all of them."""
    canonical = _csv_rows(CSV_FOR_DURATION[duration])
    exported = sorted(web_data[str(duration)], key=lambda r: r["rank"])

    assert len(exported) == len(canonical), (
        f"{duration}yr row count: exported {len(exported)} vs canonical {len(canonical)}"
    )

    mismatches: list[str] = []
    for csv_row, json_row in zip(canonical, exported):
        rank = int(csv_row["Rank"])
        if json_row["rank"] != rank:
            mismatches.append(f"rank {rank}: exported rank {json_row['rank']}")
            continue
        if csv_row["Player"].strip() != json_row["player_name"]:
            mismatches.append(
                f"rank {rank}: '{json_row['player_name']}' vs canonical '{csv_row['Player'].strip()}'"
            )
        if abs(float(csv_row["Prime raw"]) - json_row["prime_index"]) > ROUNDING_TOLERANCE:
            mismatches.append(
                f"rank {rank} {csv_row['Player'].strip()}: prime_index "
                f"{json_row['prime_index']} vs {csv_row['Prime raw']}"
            )
        if abs(float(csv_row["Prime display"]) - json_row["prime_score"]) > ROUNDING_TOLERANCE:
            mismatches.append(
                f"rank {rank} {csv_row['Player'].strip()}: prime_score "
                f"{json_row['prime_score']} vs {csv_row['Prime display']}"
            )
    assert not mismatches, (
        f"{duration}yr: {len(mismatches)} row(s) differ from leaderboards/"
        f"{CSV_FOR_DURATION[duration]}:\n  " + "\n  ".join(mismatches[:25])
    )


def test_component_totals_reconcile_to_the_published_score(web_data):
    """The weighted contributions must add up to the index they decompose.

    If they do not, the breakdown shown in the explainability modal is not an
    explanation of the score on the row -- it is a second, different number
    wearing the first one's label.
    """
    worst = (0.0, "")
    for duration, rows in web_data.items():
        for row in rows:
            total = sum(row["components"].values())
            delta = abs(total - row["prime_index"])
            if delta > worst[0]:
                worst = (delta, f"{row['player_name']} {duration}yr")
    assert worst[0] <= COMPONENT_SUM_TOLERANCE, (
        f"Components do not reconcile to prime_index. Worst: {worst[1]} off by {worst[0]:.6f}"
    )


# ---------------------------------------------------------------------------
# NEW: provenance -- metadata.json must describe what was actually read
# ---------------------------------------------------------------------------

def test_metadata_records_the_digest_of_every_input_csv(web_metadata):
    """The defect this closes, concretely: metadata.json recorded
    source_commit=d5e8acf while methodology.json was byte-equal to a LATER
    revision of the METHODOLOGY dict. The recorded commit provably did not
    produce the artifact it labelled, and nothing could detect that, because a
    bare `git rev-parse HEAD` describes the checkout, not the inputs.

    Digests describe the inputs. They stay true when the commit does not.
    """
    digests = web_metadata.get("source_inputs")
    assert isinstance(digests, dict) and digests, (
        "metadata.json is missing `source_inputs`. Rebuild with "
        f"`{BUILD_COMMAND}` -- an artifact without input digests cannot be "
        "verified against the CSVs it claims to come from."
    )
    assert web_metadata.get("source_input_digest_algorithm") == "sha256"

    for rel_path, recorded in digests.items():
        actual_path = ROOT / rel_path
        assert actual_path.exists(), f"metadata.json references a missing input: {rel_path}"
        actual = _sha256(actual_path)
        assert actual == recorded, (
            f"{rel_path} has changed since data/web/ was generated.\n"
            f"  recorded: {recorded}\n"
            f"  on disk:  {actual}\n"
            f"The exported dataset is stale. Rebuild: {BUILD_COMMAND}"
        )


def test_metadata_covers_every_canonical_csv_it_exported(web_metadata):
    exported = set(web_metadata["source_artifacts"])
    digested = set(web_metadata.get("source_inputs", {}))
    assert exported == digested, (
        f"source_artifacts and source_inputs disagree: "
        f"only in source_artifacts={exported - digested}, "
        f"only in source_inputs={digested - exported}"
    )


def test_metadata_declares_whether_the_tree_was_dirty(web_metadata):
    """A build from a dirty tree is legitimate. A build from a dirty tree that
    does not say so is a provenance lie -- it publishes a commit SHA as if that
    commit produced the bytes."""
    assert "source_tree_dirty" in web_metadata, (
        f"metadata.json predates the dirty-tree flag. Rebuild: {BUILD_COMMAND}"
    )
    assert web_metadata["source_tree_dirty"] in (True, False, None)
    assert "leaderboards_dir_dirty" in web_metadata


def test_the_wire_model_version_stays_the_published_contract(web_metadata):
    """data/web uses the HYPHENATED spelling and must keep using it.

    `nba_peak/formula_version.py` is the single source of truth for version
    identity and its slugs are underscored ("peak3_v1"). This dataset emits
    "peak3-v1", deliberately: apps/api/tests/test_model_version.py asserts that
    /api/v1/meta's model_version is NOT one of the peaks formula slugs, so that
    a Peak Duel score can never be read as a peaks-board score. The exporter now
    DERIVES the hyphenated value from the imported slug through one explicit
    mapping instead of hardcoding it, so the two can no longer drift apart --
    but the emitted bytes are unchanged.
    """
    from nba_peak import formula_version as fv

    assert web_metadata["model_version"] == "peak3-v1"
    assert web_metadata["model_version"] not in fv.ALL_FORMULA_VERSIONS
    assert web_metadata["formula_version_id"] == fv.PEAK3_V1
    # The hyphenated wire value and the underscored slug must name the SAME
    # version -- that is the whole point of the mapping.
    assert web_metadata["model_version"].replace("-", "_") == web_metadata["formula_version_id"]
    assert web_metadata["formula_version"] == fv.description(fv.PEAK3_V1)
    assert web_metadata["model_label"] == fv.label(fv.PEAK3_V1)


def test_the_exported_formula_description_matches_the_official_weights(web_metadata):
    """The description string is built from OFFICIAL_WEIGHTS, so a weight change
    that forgot to bump the version would be caught here rather than shipping
    under a v1 label."""
    import peak3

    description = web_metadata["formula_version"]
    for name, weight in peak3.OFFICIAL_WEIGHTS.items():
        assert f"{name}={weight:.2f}" in description or f"{weight:.2f}" in description, (
            f"OFFICIAL_WEIGHTS[{name}]={weight} is not reflected in the exported "
            f"formula_version string: {description}"
        )


# ---------------------------------------------------------------------------
# NEW: the SERVED rankings board (what the website actually renders)
# ---------------------------------------------------------------------------
# /rankings reads /api/v1/peaks and /api/v1/seasons, which read the COMMITTED
# top_1000_*.v1.json artifacts -- a different pipeline from data/web. Nothing
# previously asserted that the board a visitor sees agrees with the CSVs the
# project calls canonical. These tests do.

def test_served_peaks_board_declares_the_default_model(peaks_board):
    from nba_peak import formula_version as fv

    assert peaks_board["model_version"] == fv.PEAK3_V1
    assert peaks_board["formula_version"] == fv.description(fv.PEAK3_V1)


def test_served_seasons_board_declares_the_default_model(seasons_board):
    from nba_peak import formula_version as fv

    assert seasons_board["model_version"] == fv.PEAK3_V1
    assert seasons_board["formula_version"] == fv.description(fv.PEAK3_V1)


def test_api_reports_the_same_version_the_artifact_carries(client, peaks_board, seasons_board):
    """API version == artifact version. A process-lifetime cache serving an old
    artifact under a new label is exactly the staleness class this pass exists
    to close."""
    peaks = client.get("/api/v1/peaks", params={"window": "1y", "limit": 1}).json()
    assert peaks["model_version"] == peaks_board["model_version"]
    assert peaks["formula_version"] == peaks_board["formula_version"]
    assert peaks["dataset_version"] == peaks_board["dataset_version"]

    seasons = client.get("/api/v1/seasons", params={"limit": 1}).json()
    assert seasons["model_version"] == seasons_board["model_version"]
    assert seasons["formula_version"] == seasons_board["formula_version"]
    assert seasons["dataset_version"] == seasons_board["dataset_version"]


def test_the_api_serves_the_bytes_that_are_on_disk(client):
    """Artifact hash == recorded hash, across the process-lifetime cache.

    /api/v1/peaks and /api/v1/seasons cache their artifact in a module-level
    dict keyed only by formula version, populated once and never invalidated or
    mtime-checked. Regenerating an artifact therefore does NOT reach a running
    server -- it needs a restart. That was previously undetectable from outside
    the process. The response now publishes the digest of the bytes it actually
    loaded, so this test can compare server state against disk state.
    """
    peaks = client.get("/api/v1/peaks", params={"window": "1y", "limit": 1}).json()
    assert peaks["artifact_digest"] == _sha256(PEAKS_BOARD_PATH), (
        "The peaks API is serving a board that differs from the file on disk. "
        "The process-lifetime cache in peaks.py is holding a superseded artifact "
        "-- restart the API after regenerating."
    )
    seasons = client.get("/api/v1/seasons", params={"limit": 1}).json()
    assert seasons["artifact_digest"] == _sha256(SEASONS_BOARD_PATH)


def test_provenance_is_passed_through_and_never_fabricated(client, peaks_board):
    """`generated_at` is a pass-through of a field the generator does not yet
    write, so it must be None -- NOT back-filled from a file mtime.

    That distinction is the whole point of this pass: an mtime is a checkout
    artifact (the one that produced the original false "rankings are stale"
    report), so publishing one as a release date would be inventing provenance
    while claiming to fix it. Absent is honest; wrong is not.
    """
    peaks = client.get("/api/v1/peaks", params={"window": "1y", "limit": 1}).json()
    assert peaks["generated_at"] == peaks_board.get("generated_at")
    assert peaks["generation_command"] == peaks_board["generation_command"]
    assert "build_top_peaks.py" in peaks["generation_command"]


@pytest.mark.parametrize(
    "window,csv_name",
    [("1y", "top_250_1_year_prime.csv"),
     ("3y", "top_250_3_year_prime.csv"),
     ("5y", "top_250_5_year_prime.csv")],
)
def test_served_board_rank1_agrees_with_the_canonical_csv(peaks_board, window, csv_name):
    """The served board draws from a BROADER universe than the 250-player CSVs
    and applies a 25.0 MPG display gate, so the two are not row-for-row equal by
    construction. The top of the board is another matter: if the canonical
    rank-1 window were ever displaced on the served board, either the model
    changed or one artifact is stale. Both are things a person must be told.
    """
    player, _raw, display = _csv_rank1(csv_name)
    top = peaks_board["windows"][window]["rows"][0]
    assert top["player_name"] == player, (
        f"{window} board rank 1 is '{top['player_name']}' but the canonical CSV says '{player}'"
    )
    assert abs(top["prime_score"] - display) < ROUNDING_TOLERANCE, (
        f"{window} rank-1 score drift: served {top['prime_score']} vs canonical {display}"
    )


def test_the_frontend_top_rows_are_the_artifact_top_rows(client, peaks_board):
    """Frontend top rows == the current generated artifact.

    The page fetches exactly this response and renders it in order, so pinning
    the response to the artifact pins the table. Covers the stale-API-cache
    vector: /api/v1/peaks caches per formula version in a process-lifetime dict
    with no mtime check (peaks.py `_CACHE`), so a regenerated artifact does not
    reach a running server until it restarts.
    """
    for window in ("1y", "3y", "5y"):
        served = client.get("/api/v1/peaks", params={"window": window, "limit": 50}).json()
        expected = peaks_board["windows"][window]["rows"][:50]
        assert [r["row_id"] for r in served["rows"]] == [r["row_id"] for r in expected], (
            f"{window}: API row order differs from the generated artifact -- "
            "the API is serving a cached or stale board."
        )
        assert [r["prime_score"] for r in served["rows"]] == [r["prime_score"] for r in expected]


def test_the_two_boards_differ_only_by_deduplication_at_one_year(peaks_board, seasons_board):
    """The terminology fix, made checkable.

    At n=1 a "peak window" IS a single season, so the 1-Year Peak Windows board
    and the Single Seasons board are the same grain over the same rows -- the
    peaks board just keeps one row per player. The UI now says exactly that, so
    a test has to hold the claim true: every 1Y peak row must be a real season
    on the seasons pipeline, and the peaks board must be de-duplicated while the
    seasons board is not.
    """
    peak_rows = peaks_board["windows"]["1y"]["rows"]
    slugs = [r["player_slug"] for r in peak_rows]
    assert len(slugs) == len(set(slugs)), (
        "The 1-Year Peak Windows board is labelled 'one row per player' but "
        "contains a repeated player."
    )
    season_slugs = [r["player_slug"] for r in seasons_board["rows"]]
    assert len(season_slugs) > len(set(season_slugs)), (
        "The Single Seasons board is labelled 'every qualifying season, repeats "
        "expected' but every player appears at most once."
    )
    assert seasons_board.get("allows_repeated_players") is True

    # The claim itself: the top of both boards is the same row.
    assert peak_rows[0]["row_id"] == seasons_board["rows"][0]["row_id"]
    assert peak_rows[0]["prime_score"] == seasons_board["rows"][0]["prime_score"]


def test_the_serving_gate_is_declared_wherever_it_is_applied(peaks_board, seasons_board):
    """The 25.0 MPG display gate excludes real windows that ARE in the committed
    CSVs (Isaiah Hartenstein at canonical 1yr rank 185, Tony Allen at 245,
    Andrew Bogut at 3yr 205). A board that filters rows without saying so is
    presenting an edited list as a complete one, so the note is load-bearing,
    not decorative -- the UI now renders it in legible body text.
    """
    assert peaks_board["min_anchor_season_mpg"] == 25.0
    note = peaks_board.get("serving_gate_note")
    assert note and "25.0" in note and "minutes per game" in note
    for window in ("1y", "3y", "5y"):
        bucket = peaks_board["windows"][window]
        assert bucket["min_anchor_season_mpg"] == 25.0
        assert isinstance(bucket["excluded_low_minute_windows"], int)
        assert bucket["excluded_low_minute_windows"] > 0, (
            f"{window} reports zero excluded windows; either the gate stopped "
            "applying or the count stopped being published."
        )
    assert seasons_board.get("min_season_mpg") == 25.0
    assert seasons_board.get("serving_gate_note")


def test_the_latest_supported_season_is_actually_present(peaks_board, seasons_board):
    """"Data through 2025-26" is published in the provenance strip. If the most
    recent season silently stopped appearing, that line becomes a false claim
    while every other assertion in this file still passes."""
    for board, name in ((peaks_board, "peaks"), (seasons_board, "seasons")):
        latest = board["supported_end_season"]
        if name == "peaks":
            rows = [r for w in board["windows"].values() for r in w["rows"]]
            seasons = {r["anchor_season"] for r in rows}
        else:
            seasons = {r["season"] for r in board["rows"]}
        assert latest in seasons, (
            f"The {name} board advertises data through {latest}, but no served row "
            f"has that season. Latest actually present: {max(seasons)}"
        )


def test_served_board_components_reconcile_to_the_published_score(peaks_board):
    """Same reconciliation guarantee as data/web, on the artifact the website
    renders -- but the served board decomposes a score into SIX terms, not five.

    A table row publishes only the five OFFICIAL weighted contributions. The
    sixth, `teammate_adjustment`, is carried in the explain block alone (it is a
    negative correction, -0.2472 on Jordan's 1990-91, and the UI gives it its own
    `--comp-tm` colour token). So the five row-level components deliberately do
    NOT sum to prime_index, and a naive five-term check would either fail
    forever or, if "fixed" by widening the tolerance, would stop detecting real
    drift. Reconcile the way the modal actually presents it: five contributions
    plus the adjustment.

    Tolerance is 0.01 because the served artifact rounds prime_index to two
    decimals (86.87) while the contributions carry four (sum 86.8652). That is
    arithmetic, not slack.
    """
    explain = peaks_board.get("explain") or {}
    checked = 0
    for window, bucket in peaks_board["windows"].items():
        for row in bucket["rows"][:100]:
            block = explain.get(row["row_id"])
            if not block:
                continue
            components = block.get("components")
            index = block.get("prime_index")
            if not components or index is None:
                continue
            total = sum(v for v in components.values() if v is not None)
            total += block.get("teammate_adjustment") or 0.0
            assert abs(total - index) <= ROUNDING_TOLERANCE, (
                f"{window} {row['player_name']}: five contributions + teammate "
                f"adjustment sum to {total:.4f} but prime_index is {index}"
            )
            checked += 1
    assert checked > 0, "No served row published components -- the breakdown is empty."


def test_the_served_row_components_are_exactly_the_five_official_ones(peaks_board):
    """Pins WHY the test above needs six terms: the table row publishes the five
    official weighted contributions and nothing else. If a sixth key ever
    appeared on a row, the reconciliation above would start double-counting and
    must be revisited rather than silently absorbing it."""
    official = {
        "statistical_impact",
        "traditional_production",
        "individual_recognition",
        "postseason_individual_value",
        "team_achievement",
    }
    for window, bucket in peaks_board["windows"].items():
        for row in bucket["rows"][:20]:
            components = row.get("components")
            if not components:
                continue
            assert set(components) == official, (
                f"{window} {row['player_name']} row components changed shape: "
                f"{sorted(components)}"
            )


def test_every_served_row_can_be_explained(peaks_board):
    """A game card or a modal that references a row_id with no explain block is
    a dead link the user only discovers by clicking. Sample the top of each
    board rather than all 2,578 rows, since the explain map is ~18 MB."""
    explain = peaks_board.get("explain") or {}
    missing: list[str] = []
    for window, bucket in peaks_board["windows"].items():
        for row in bucket["rows"][:50]:
            if row["row_id"] not in explain:
                missing.append(f"{window}:{row['row_id']}")
    assert not missing, f"Served rows with no explain block: {missing[:10]}"


# ---------------------------------------------------------------------------
# NEW: game pools must resolve against the CURRENT artifact
# ---------------------------------------------------------------------------

def test_run_the_table_card_pool_resolves_against_the_current_windows(peak_windows):
    """RUN THE TABLE builds its card pool from data/web/peak_windows.json
    (nba_peak/run_the_table/cards.py:41) -- which is GITIGNORED. It is the only
    game that cannot start from a clean checkout without a build step. It
    degrades to a labelled 503 rather than fabricating cards, which is the right
    failure, but it is a deploy-ordering trap and is documented as one in
    RANKINGS_SYNC_REPORT.md.

    This test asserts the pool is built from the SAME windows the exporter just
    wrote: every card must resolve to a live window ID, so a card can never
    reference a stale or deleted window.
    """
    from nba_peak.run_the_table.cards import build_pool, default_windows_path

    assert default_windows_path() == PEAK_WINDOWS_PATH, (
        "RUN THE TABLE is reading a different windows artifact than this test "
        f"verifies: {default_windows_path()} vs {PEAK_WINDOWS_PATH}"
    )

    live = {w["id"]: w for w in peak_windows}
    pool = build_pool()
    assert len(pool) > 0, "RUN THE TABLE card pool is empty."

    orphans = [c.peak_window_id for c in pool if c.peak_window_id not in live]
    assert not orphans, (
        f"{len(orphans)} RUN THE TABLE card(s) reference a window that no longer "
        f"exists in data/web/peak_windows.json: {orphans[:10]}. The card pool is "
        "stale relative to the generated dataset."
    )

    # Not merely present -- carrying the SAME score. A card priced off an old
    # window would be an invisible balance change.
    drift = [
        (c.peak_window_id, c.prime_index, live[c.peak_window_id]["prime_index"])
        for c in pool
        if abs(c.prime_index - live[c.peak_window_id]["prime_index"]) > COMPONENT_SUM_TOLERANCE
    ]
    assert not drift, (
        f"{len(drift)} RUN THE TABLE card(s) are priced off a stale score: {drift[:5]}"
    )


def test_peak_windows_artifact_agrees_with_leaderboards_artifact(web_data, peak_windows):
    """peak_windows.json is the flattened form of leaderboards.json and feeds the
    game pools. If the two ever diverge, a game would price a player off one
    score while the rankings page displays another."""
    flat = {w["id"]: w for w in peak_windows}
    board = {r["id"]: r for rows in web_data.values() for r in rows}
    assert set(flat) == set(board), (
        f"peak_windows.json and leaderboards.json disagree on membership: "
        f"{len(set(flat) - set(board))} only in windows, "
        f"{len(set(board) - set(flat))} only in leaderboards"
    )
    for wid, window in flat.items():
        assert window["prime_index"] == board[wid]["prime_index"], (
            f"{wid}: peak_windows prime_index {window['prime_index']} != "
            f"leaderboards {board[wid]['prime_index']}"
        )
