#!/usr/bin/env python3
"""
telemetry_report.py
-------------------
Product-funnel report over `telemetry_events` (Track F).

Answers exactly the nine questions the pass asked for, and nothing else:

    1. first-run completion       6. perk pick rates
    2. tutorial completion        7. perk win rates
    3. second-run conversion      8. trade usage
    4. clear rate                 9. run duration
    5. boss win rates            10. daily return

THE ONE RULE THIS SCRIPT HAS: it never prints a number it did not read from
the database. There is no sample data, no simulated mode, and no "example
output" path. If the database is not reachable it says so, names the reason,
and exits non-zero. A funnel report that quietly falls back to plausible
figures is worse than no report, because somebody will screenshot it.

DEGRADED PATH, WHICH IS THE ONE YOU WILL LIKELY HIT LOCALLY. As of this pass
the `PEAK3_DATABASE_URL` in apps/api/.env carries a stale password for the
hosted project (`password authentication failed`, on both the direct and the
pooler endpoint) -- see docs/implementation/AUTH_DAILY_BALANCE_PLAN.md section
9. That is the expected local outcome, and this script reports it as a
configuration problem rather than as an empty dataset. "Zero runs" and "cannot
connect" must never look the same.

SMALL-SAMPLE HONESTY. Every rate is printed with its numerator and
denominator, and any rate whose denominator is below --min-sample (default 20)
is marked `(low n)` rather than suppressed. Suppressing it hides that the
funnel is thin; printing "100.0%" off two runs invites a decision. Showing
`100.0% (2/2, low n)` does neither.

WHAT IT READS. Only `telemetry_events`. It never joins to `games`,
`profiles`, `run_the_table_runs` or anything else -- it *cannot*, because the
subject column is a salted HMAC and those tables hold the raw subject (see
supabase/migrations/20260801120000_telemetry_events.sql). Every metric is
therefore an aggregate over pseudonymous subjects, which is the whole design.

Usage (from repo root):
    python scripts/telemetry_report.py
    python scripts/telemetry_report.py --days 14 --json
    python scripts/telemetry_report.py --purge        # run retention now

Exit codes:
    0  report produced
    2  not configured / database unreachable (nothing printed but the reason)
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent

#: Rates below this denominator are labelled, not hidden. See the docstring.
DEFAULT_MIN_SAMPLE = 20

#: Default reporting window.
DEFAULT_DAYS = 30


# ---------------------------------------------------------------------------
# Configuration discovery
# ---------------------------------------------------------------------------


def _read_env_file(path: Path) -> dict[str, str]:
    """Minimal .env reader. Values are never printed by this script."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def resolve_database_url() -> Optional[str]:
    """The connection string, from the environment or apps/api/.env.

    Returned, never logged. Every failure message below names the FAILURE, not
    the URL -- a connection string contains a password, and a report script is
    exactly the kind of thing whose output gets pasted into a ticket.
    """
    from_env = os.getenv("PEAK3_DATABASE_URL") or os.getenv("DATABASE_URL")
    if from_env:
        return from_env
    return _read_env_file(REPO_ROOT / "apps" / "api" / ".env").get("PEAK3_DATABASE_URL")


class NotConfigured(RuntimeError):
    """The report cannot run. Carries a human explanation and a remedy."""

    def __init__(self, reason: str, remedy: str) -> None:
        super().__init__(reason)
        self.reason = reason
        self.remedy = remedy


async def connect(url: str):
    try:
        import asyncpg  # type: ignore[import]
    except ImportError:
        raise NotConfigured(
            "asyncpg is not installed in this interpreter.",
            "pip install -r apps/api/requirements.txt",
        )
    try:
        return await asyncpg.connect(url, timeout=10)
    except Exception as exc:
        # The exception type and message are shown; the URL is not.
        raise NotConfigured(
            f"Could not connect to PEAK3_DATABASE_URL ({type(exc).__name__}: {exc}).",
            "Check that PEAK3_DATABASE_URL is current. As of this pass the value "
            "in apps/api/.env has a stale password for the hosted project and "
            "must be refreshed by an operator.",
        )


async def ensure_table(conn) -> None:
    exists = await conn.fetchval(
        "SELECT to_regclass('public.telemetry_events') IS NOT NULL"
    )
    if not exists:
        raise NotConfigured(
            "The telemetry_events table does not exist in this database.",
            "Apply supabase/migrations/20260801120000_telemetry_events.sql "
            "(`supabase db push`).",
        )


# ---------------------------------------------------------------------------
# Metric helpers
# ---------------------------------------------------------------------------


class Rate:
    """A ratio that always remembers where it came from."""

    def __init__(self, label: str, numerator: int, denominator: int) -> None:
        self.label = label
        self.numerator = int(numerator or 0)
        self.denominator = int(denominator or 0)

    @property
    def value(self) -> Optional[float]:
        if self.denominator == 0:
            return None
        return self.numerator / self.denominator

    def render(self, min_sample: int) -> str:
        if self.denominator == 0:
            return "no data"
        pct = f"{self.value * 100:.1f}%"
        note = ", low n" if self.denominator < min_sample else ""
        return f"{pct} ({self.numerator}/{self.denominator}{note})"

    def to_dict(self) -> dict[str, Any]:
        return {
            "label": self.label,
            "numerator": self.numerator,
            "denominator": self.denominator,
            "rate": self.value,
        }


WINDOW = "created_at >= NOW() - ($1::int * INTERVAL '1 day')"


async def collect(conn, days: int) -> dict[str, Any]:
    """Every metric, in one pass of clearly-named queries.

    Written as separate statements rather than one heroic CTE: each one is
    independently readable and independently wrong-able, and the table is
    indexed on (event_name, created_at) so each is cheap.
    """
    report: dict[str, Any] = {"window_days": days}

    report["totals"] = {
        "events": await conn.fetchval(
            f"SELECT COUNT(*) FROM telemetry_events WHERE {WINDOW}", days
        ),
        "subjects": await conn.fetchval(
            f"SELECT COUNT(DISTINCT subject_hash) FROM telemetry_events WHERE {WINDOW}",
            days,
        ),
        "anonymous_subjects": await conn.fetchval(
            f"SELECT COUNT(DISTINCT subject_hash) FROM telemetry_events "
            f"WHERE {WINDOW} AND subject_kind = 'anon'",
            days,
        ),
        "signed_in_subjects": await conn.fetchval(
            f"SELECT COUNT(DISTINCT subject_hash) FROM telemetry_events "
            f"WHERE {WINDOW} AND subject_kind = 'user'",
            days,
        ),
    }

    report["event_counts"] = {
        row["event_name"]: row["n"]
        for row in await conn.fetch(
            f"SELECT event_name, COUNT(*) AS n FROM telemetry_events "
            f"WHERE {WINDOW} GROUP BY event_name ORDER BY n DESC",
            days,
        )
    }

    rates: list[Rate] = []

    # 1. First-run completion. Denominator: subjects whose FIRST run started in
    #    the window. Numerator: those that also produced a run_ended for that
    #    same run_ref. Keyed on run_ref (client-minted, opaque) so an abandoned
    #    first run followed by a completed second one does not count.
    first_run = await conn.fetchrow(
        f"""
        WITH first_runs AS (
            SELECT DISTINCT ON (subject_hash)
                   subject_hash, props->>'run_ref' AS run_ref
            FROM telemetry_events
            WHERE {WINDOW} AND event_name = 'run_started'
              AND props->>'run_ref' IS NOT NULL
            ORDER BY subject_hash, created_at ASC
        )
        SELECT COUNT(*) AS started,
               COUNT(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM telemetry_events e
                   WHERE e.event_name = 'run_ended'
                     AND e.subject_hash = f.subject_hash
                     AND e.props->>'run_ref' = f.run_ref
               )) AS completed
        FROM first_runs f
        """,
        days,
    )
    rates.append(Rate("first-run completion", first_run["completed"], first_run["started"]))

    # 2. Tutorial completion, among subjects who saw the tutorial at all.
    tutorial = await conn.fetchrow(
        f"""
        SELECT COUNT(DISTINCT subject_hash) FILTER (
                   WHERE event_name = 'tutorial_completed') AS completed,
               COUNT(DISTINCT subject_hash) AS saw
        FROM telemetry_events
        WHERE {WINDOW}
          AND event_name IN ('tutorial_completed', 'tutorial_skipped')
        """,
        days,
    )
    rates.append(Rate("tutorial completion", tutorial["completed"], tutorial["saw"]))

    # 3. Second-run conversion. Counted from the explicit `second_run_started`
    #    event where present, and cross-checked against "subjects with 2+
    #    distinct run_refs" -- the two should agree, and a divergence means an
    #    instrumentation bug rather than a product finding.
    second = await conn.fetchrow(
        f"""
        WITH per_subject AS (
            SELECT subject_hash, COUNT(DISTINCT props->>'run_ref') AS runs
            FROM telemetry_events
            WHERE {WINDOW} AND event_name = 'run_started'
              AND props->>'run_ref' IS NOT NULL
            GROUP BY subject_hash
        )
        SELECT COUNT(*) FILTER (WHERE runs >= 2) AS converted,
               COUNT(*) AS with_a_run
        FROM per_subject
        """,
        days,
    )
    rates.append(
        Rate("second-run conversion", second["converted"], second["with_a_run"])
    )
    report["second_run_started_events"] = await conn.fetchval(
        f"SELECT COUNT(DISTINCT subject_hash) FROM telemetry_events "
        f"WHERE {WINDOW} AND event_name = 'second_run_started'",
        days,
    )

    # 4. Clear rate, over ended runs.
    clears = await conn.fetchrow(
        f"""
        SELECT COUNT(*) FILTER (WHERE props->>'outcome' = 'table_cleared') AS cleared,
               COUNT(*) AS ended
        FROM telemetry_events
        WHERE {WINDOW} AND event_name = 'run_ended'
        """,
        days,
    )
    rates.append(Rate("clear rate", clears["cleared"], clears["ended"]))

    # 8. Trade usage: share of runs in which at least one trade completed.
    trades = await conn.fetchrow(
        f"""
        WITH runs AS (
            SELECT DISTINCT props->>'run_ref' AS run_ref
            FROM telemetry_events
            WHERE {WINDOW} AND event_name = 'run_started'
              AND props->>'run_ref' IS NOT NULL
        ), traded AS (
            SELECT DISTINCT props->>'run_ref' AS run_ref
            FROM telemetry_events
            WHERE {WINDOW} AND event_name = 'trade_completed'
              AND props->>'run_ref' IS NOT NULL
        )
        SELECT (SELECT COUNT(*) FROM traded t WHERE t.run_ref IN (SELECT run_ref FROM runs)) AS traded,
               (SELECT COUNT(*) FROM runs) AS runs
        """,
        days,
    )
    rates.append(Rate("runs using a trade", trades["traded"], trades["runs"]))

    # 10. Daily return: of subjects who completed a daily, how many completed
    #     one on 2+ distinct days.
    daily = await conn.fetchrow(
        f"""
        WITH per_subject AS (
            SELECT subject_hash, COUNT(DISTINCT props->>'daily_key') AS days_played
            FROM telemetry_events
            WHERE {WINDOW} AND event_name = 'daily_completed'
              AND props->>'daily_key' IS NOT NULL
            GROUP BY subject_hash
        )
        SELECT COUNT(*) FILTER (WHERE days_played >= 2) AS returned,
               COUNT(*) AS played
        FROM per_subject
        """,
        days,
    )
    rates.append(Rate("daily return (2+ days)", daily["returned"], daily["played"]))

    report["rates"] = [r.to_dict() for r in rates]
    report["_rate_objects"] = rates

    # 5. Boss win rates, per boss.
    report["boss_win_rates"] = [
        {
            "boss": row["boss"],
            "wins": row["wins"],
            "battles": row["battles"],
            "rate": (row["wins"] / row["battles"]) if row["battles"] else None,
        }
        for row in await conn.fetch(
            f"""
            SELECT COALESCE(props->>'boss', props->>'boss_id', 'unknown') AS boss,
                   COUNT(*) FILTER (WHERE event_name = 'boss_won') AS wins,
                   COUNT(*) AS battles
            FROM telemetry_events
            WHERE {WINDOW} AND event_name IN ('boss_won', 'boss_lost')
            GROUP BY 1
            ORDER BY 1
            """,
            days,
        )
    ]

    # 6/7. Perk pick counts and, for each perk, the clear rate of the runs it
    #      was picked in. `picks` is the pick count; `runs_cleared / runs` is
    #      the win rate.
    report["perks"] = [
        {
            "perk": row["perk"],
            "picks": row["picks"],
            "runs": row["runs"],
            "runs_cleared": row["runs_cleared"],
            "clear_rate": (row["runs_cleared"] / row["runs"]) if row["runs"] else None,
        }
        for row in await conn.fetch(
            f"""
            WITH picks AS (
                SELECT COALESCE(props->>'perk', props->>'perk_id') AS perk,
                       props->>'run_ref' AS run_ref
                FROM telemetry_events
                WHERE {WINDOW} AND event_name = 'perk_selected'
                  AND COALESCE(props->>'perk', props->>'perk_id') IS NOT NULL
            ), outcomes AS (
                SELECT DISTINCT ON (props->>'run_ref')
                       props->>'run_ref' AS run_ref, props->>'outcome' AS outcome
                FROM telemetry_events
                WHERE {WINDOW} AND event_name = 'run_ended'
                  AND props->>'run_ref' IS NOT NULL
                ORDER BY props->>'run_ref', created_at DESC
            )
            SELECT p.perk,
                   COUNT(*) AS picks,
                   COUNT(o.run_ref) AS runs,
                   COUNT(*) FILTER (WHERE o.outcome = 'table_cleared') AS runs_cleared
            FROM picks p
            LEFT JOIN outcomes o ON o.run_ref = p.run_ref
            GROUP BY p.perk
            ORDER BY picks DESC
            """,
            days,
        )
    ]

    # 9. Run duration, from the `duration_seconds` property on run_ended.
    duration = await conn.fetchrow(
        f"""
        SELECT COUNT(*) AS n,
               AVG((props->>'duration_seconds')::double precision) AS mean,
               PERCENTILE_CONT(0.5) WITHIN GROUP (
                   ORDER BY (props->>'duration_seconds')::double precision) AS median,
               PERCENTILE_CONT(0.9) WITHIN GROUP (
                   ORDER BY (props->>'duration_seconds')::double precision) AS p90
        FROM telemetry_events
        WHERE {WINDOW} AND event_name = 'run_ended'
          AND props->>'duration_seconds' ~ '^[0-9]+$'
        """,
        days,
    )
    report["run_duration_seconds"] = {
        "n": duration["n"],
        "mean": float(duration["mean"]) if duration["mean"] is not None else None,
        "median": float(duration["median"]) if duration["median"] is not None else None,
        "p90": float(duration["p90"]) if duration["p90"] is not None else None,
    }

    # Retention health: rows that are past their expiry and still on disk. A
    # non-zero number here means nothing is running the purge -- see the
    # migration's retention section.
    report["retention"] = {
        "expired_rows_still_present": await conn.fetchval(
            "SELECT COUNT(*) FROM telemetry_events WHERE expires_at <= NOW()"
        ),
        "oldest_event": await conn.fetchval("SELECT MIN(created_at) FROM telemetry_events"),
    }

    return report


async def purge(conn) -> int:
    return await conn.fetchval("SELECT telemetry_events_purge_expired()")


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _bar(label: str, body: str) -> str:
    return f"  {label:<28} {body}"


def render(report: dict[str, Any], min_sample: int) -> str:
    lines: list[str] = []
    lines.append("PEAK3 product telemetry report")
    lines.append(f"Window: last {report['window_days']} days")
    lines.append("")

    totals = report["totals"]
    lines.append("VOLUME")
    lines.append(_bar("events", str(totals["events"])))
    lines.append(_bar("distinct subjects", str(totals["subjects"])))
    lines.append(
        _bar(
            "anon / signed-in",
            f"{totals['anonymous_subjects']} / {totals['signed_in_subjects']}",
        )
    )
    lines.append("")

    if not totals["events"]:
        lines.append("No events in this window. The database is reachable and the")
        lines.append("table exists — there is simply nothing recorded yet. Telemetry")
        lines.append("is OFF by default; set PEAK3_TELEMETRY_ENABLED=true to collect.")
        return "\n".join(lines)

    lines.append("FUNNEL")
    for rate in report["_rate_objects"]:
        lines.append(_bar(rate.label, rate.render(min_sample)))
    lines.append(
        _bar(
            "second_run_started seen",
            f"{report['second_run_started_events']} subjects (cross-check)",
        )
    )
    lines.append("")

    lines.append("BOSSES")
    if not report["boss_win_rates"]:
        lines.append("  no boss battles recorded")
    for boss in report["boss_win_rates"]:
        rate = Rate(str(boss["boss"]), boss["wins"], boss["battles"])
        lines.append(_bar(f"boss {boss['boss']}", rate.render(min_sample)))
    lines.append("")

    lines.append("PERKS")
    if not report["perks"]:
        lines.append("  no perk selections recorded")
    for perk in report["perks"]:
        rate = Rate(str(perk["perk"]), perk["runs_cleared"], perk["runs"])
        lines.append(
            _bar(str(perk["perk"]), f"{perk['picks']} picks · clear {rate.render(min_sample)}")
        )
    lines.append("")

    duration = report["run_duration_seconds"]
    lines.append("RUN DURATION")
    if not duration["n"]:
        lines.append("  no run durations recorded")
    else:
        lines.append(_bar("runs measured", str(duration["n"])))
        lines.append(_bar("mean", f"{duration['mean'] / 60:.1f} min"))
        lines.append(_bar("median", f"{duration['median'] / 60:.1f} min"))
        lines.append(_bar("p90", f"{duration['p90'] / 60:.1f} min"))
    lines.append("")

    retention = report["retention"]
    lines.append("RETENTION")
    lines.append(_bar("oldest event", str(retention["oldest_event"])))
    expired = retention["expired_rows_still_present"]
    lines.append(_bar("expired rows on disk", str(expired)))
    if expired:
        lines.append(
            "  ! Nothing is purging expired rows. Schedule "
            "telemetry_events_purge_expired() (see the migration header), "
            "or run this script with --purge."
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


async def run(args: argparse.Namespace) -> int:
    url = resolve_database_url()
    if not url:
        raise NotConfigured(
            "PEAK3_DATABASE_URL is not set and apps/api/.env does not define it.",
            "Export PEAK3_DATABASE_URL, or add it to apps/api/.env.",
        )

    conn = await connect(url)
    try:
        await ensure_table(conn)
        if args.purge:
            removed = await purge(conn)
            print(f"Purged {removed} expired telemetry row(s).")
            if not args.report:
                return 0
        report = await collect(conn, args.days)
    finally:
        await conn.close()

    if args.json:
        report.pop("_rate_objects", None)
        print(json.dumps(report, indent=2, default=str))
    else:
        print(render(report, args.min_sample))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[3])
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument("--min-sample", type=int, default=DEFAULT_MIN_SAMPLE)
    parser.add_argument("--json", action="store_true", help="machine-readable output")
    parser.add_argument(
        "--purge", action="store_true", help="delete expired rows before reporting"
    )
    parser.add_argument(
        "--report",
        action="store_true",
        default=True,
        help="produce the report (default; use --purge --no-report to purge only)",
    )
    parser.add_argument("--no-report", dest="report", action="store_false")
    args = parser.parse_args()

    try:
        return asyncio.run(run(args))
    except NotConfigured as exc:
        print("TELEMETRY REPORT NOT AVAILABLE", file=sys.stderr)
        print(f"  reason: {exc.reason}", file=sys.stderr)
        print(f"  fix:    {exc.remedy}", file=sys.stderr)
        print(
            "  No figures are printed. This script never estimates, samples or "
            "simulates telemetry.",
            file=sys.stderr,
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
