"""
Phase 8C: tests for the offline player-portrait-coverage audit script
(scripts/audit_player_portrait_coverage.py).

Proves: the script runs against the real committed manifests without
crashing; its slug function matches the same ASCII-folding convention used
everywhere else in the codebase (regression for the Phase 8B bug where an
un-folded slug silently wrote entries under a key nothing ever looked up);
every player it reports as "resolved" actually has a real URL in the
underlying manifest (never fabricated); and the per-pool counts are
internally consistent (resolved never exceeds total, resolved players never
appear in the unresolved list).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.audit_player_portrait_coverage import (  # noqa: E402
    _slug,
    _load_resolved_manifest,
    _load_250_pool,
    _load_1500_identity_pool,
    _load_team_year_pool,
    build_report,
)


def test_slug_matches_the_real_established_convention_for_diacritic_names():
    """Regression for the Phase 8B bug: an un-ASCII-folded slug would write
    an entry under a garbage key ("luka-don-i") that the running game never
    looks up. Verified against the real slugs already used in the
    committed team-year dataset."""
    assert _slug("Luka Dončić") == "luka-doncic"
    assert _slug("Nikola Vučević") == "nikola-vucevic"
    assert _slug("Jusuf Nurkić") == "jusuf-nurkic"


def test_slug_preserves_generational_suffixes():
    """Unlike the loose name-matching normalize (which strips Jr./Sr./II
    for matching purposes only), the stored slug keeps the suffix -- it's
    part of the real player_slug identity."""
    assert _slug("Xavier Tillman Sr.") == "xavier-tillman-sr"
    assert _slug("GG Jackson II") == "gg-jackson-ii"


def test_pools_load_without_crashing_against_the_real_committed_data():
    resolved = _load_resolved_manifest()
    pool_250 = _load_250_pool()
    pool_1500 = _load_1500_identity_pool()
    pool_team_year = _load_team_year_pool()

    assert len(resolved) > 0, "player_assets.v3.json must exist and have entries"
    assert len(pool_250) == 250, f"expected the 250-canonical pool to have 250 entries, got {len(pool_250)}"
    # Phase 10D: assert LOADER CONSISTENCY against the manifest's own
    # self-reported count rather than a hand-copied magic range. The previous
    # `1400 <= n <= 1600` band encoded the 1510 figure produced by the
    # pre-10D `15_ppg` rate criterion; when that criterion was corrected the
    # pool legitimately moved to 1390 and a band assertion would have failed
    # for the right change while still passing for a genuinely broken loader
    # (e.g. one silently dropping 100 identities).
    import json as _json
    from scripts.audit_player_portrait_coverage import IDENTITY_1500_PATH
    manifest = _json.loads(IDENTITY_1500_PATH.read_text())
    assert len(pool_1500) == manifest["final_identity_count"], (
        f"loader returned {len(pool_1500)} identities but the manifest reports "
        f"{manifest['final_identity_count']}"
    )
    assert len(pool_1500) > 1000, (
        f"identity pool collapsed to {len(pool_1500)} -- far below any documented "
        "criteria outcome; regenerate with scripts/audit_player_pool_expansion.py"
    )
    assert len(pool_team_year) > 3000, f"expected the full team-year pool to be the largest, got {len(pool_team_year)}"


def test_report_structure_and_internal_consistency():
    report = build_report(recheck_nba_cdn=False)

    assert report["report_version"] == "portrait_coverage_audit.v1"
    for pool_key in ("eligible_total", "canonical_250", "identity_1500", "team_year_full_pool"):
        assert pool_key in report["pools"], f"missing pool section: {pool_key}"
        pool = report["pools"][pool_key]
        assert pool["resolved"] <= pool["count"], f"{pool_key}: resolved count exceeds total"
        assert 0.0 <= pool["resolved_pct"] <= 100.0

    # canonical_250 and identity_1500 both report named unresolved lists --
    # every name in there must genuinely be absent from the resolved count,
    # never a stale/contradictory entry.
    assert len(report["pools"]["canonical_250"]["unresolved_players"]) == (
        report["pools"]["canonical_250"]["count"] - report["pools"]["canonical_250"]["resolved"]
    )
    assert len(report["pools"]["identity_1500"]["unresolved_players"]) == (
        report["pools"]["identity_1500"]["count"] - report["pools"]["identity_1500"]["resolved"]
    )


def test_never_reports_a_resolution_without_a_real_url_in_the_manifest():
    """The audit script must only ever be a read-only summary -- every
    player counted as 'resolved' must trace back to a real headshot_url
    already written by scripts/build_espn_asset_manifests.py, never an
    audit-script-invented resolution."""
    resolved_by_slug = _load_resolved_manifest()
    for slug, entry in resolved_by_slug.items():
        if entry.get("resolution_status") == "resolved":
            assert entry.get("headshot_url"), f"{slug} marked resolved but has no headshot_url"
            assert entry["headshot_url"].startswith("https://"), f"{slug} has a non-https headshot_url"


def test_licensing_and_nba_cdn_sections_never_overstate_the_provider_state():
    report = build_report(recheck_nba_cdn=False)
    assert report["licensing"]["license_status"] == "unknown_do_not_cache"
    assert report["licensing"]["cache_policy"] == "dev_hotlink_preview_only"
    # Honest-by-default: without --recheck-nba-cdn, the script must not
    # claim a live reachability result it didn't actually check this run.
    assert "Not rechecked" in report["nba_cdn_status"]["reachability"]
