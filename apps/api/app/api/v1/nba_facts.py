"""NBA Fact of the Day.

READ-ONLY, PRECOMPUTED, AND NOT ABOUT PEAK3. The bank is a build artifact
(`scripts/build_nba_facts.py`); this route selects one entry by calendar date
and returns it. No analysis happens per request, no model is consulted, and no
language model is involved at any point -- the facts are generated offline from
committed per-season data with the rows that prove them attached.

WHY THE DATE IS A PARAMETER RATHER THAN A CLOCK READ. `?on=YYYY-MM-DD` makes the
selection testable and cacheable: the same date always returns the same fact,
which is the property the feature promises ("everyone sees the same fact today")
and the one a test needs to assert. The server's own UTC date is the default, so
a normal caller passes nothing.

THE BANK IS LOADED ONCE, AND BY ONE CACHE. `nba_facts.cached_bank` holds it for
the process -- a few hundred kilobytes of immutable JSON shared by every
request rather than re-read per visitor. `/health/readiness` reads the SAME
cache, so the probe and the route can never disagree about whether the bank is
there. They did once, in a way nothing surfaced: the deployed image was missing
the file, this route served 503, and readiness reported "ready".
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from nba_peak.nba_facts import FACT_BANK_VERSION, cached_bank, fact_for_date

router = APIRouter()


@router.get("/nba-facts/today")
async def get_fact_of_the_day(
    on: Optional[str] = Query(
        None,
        description="ISO date (YYYY-MM-DD). Defaults to the server's UTC date.",
    ),
) -> dict:
    """One fact, chosen deterministically for a calendar date."""
    bank = list(cached_bank())
    if not bank:
        # NOT A NORMAL STATE IN A DEPLOYED IMAGE. The bank is generated during
        # the Docker build and the build asserts the file is non-empty, so
        # reaching here means either a local checkout that has not run
        # `make build-dataset`, or something removed the artifact after the
        # build. `/health/readiness` reports the same condition and returns 503
        # for it, so this is visible on a probe rather than only to whoever
        # happened to request a fact.
        raise HTTPException(
            status_code=503,
            detail=(
                "The NBA fact bank has not been built. "
                "Run scripts/build_nba_facts.py."
            ),
        )

    if on is None:
        iso = datetime.now(timezone.utc).date().isoformat()
    else:
        try:
            iso = date.fromisoformat(on[:10]).isoformat()
        except ValueError:
            raise HTTPException(status_code=400, detail="`on` must be YYYY-MM-DD")

    fact = fact_for_date(bank, iso)
    if fact is None:  # pragma: no cover - guarded by the emptiness check above
        raise HTTPException(status_code=503, detail="No fact available.")

    return {
        "date": iso,
        "bank_version": FACT_BANK_VERSION,
        "bank_size": len(bank),
        **fact.as_dict(),
    }
