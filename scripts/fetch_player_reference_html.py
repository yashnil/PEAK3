#!/usr/bin/env python3
"""Fetch the Basketball-Reference pages the player-reference dataset is built from.

NETWORK STEP, RUN BY HAND, NEVER BY CI. This mirrors the arrangement the rest
of the repository already uses for scraped inputs (see
docs/implementation/CI_DATA_CONTRACT.md): the fetch is a local developer
action that fills `cache/html/reference/` (gitignored), and the *derived*
artifact under `data/reference/` is what gets committed and what every test
and runtime path actually reads.

Three page families, all from basketball-reference.com, which is already this
repository's canonical historical source (nba_peak/context_build.py and
nba_peak/data_complete.py scrape the same site for the committed parquets):

  /players/{a..z}/                     26 pages -- listed height, primary
                                       position, birth date, colleges, and the
                                       stable BBRef player id for every player
                                       in league history.
  /draft/NBA_{year}.html               every draft from DRAFT_FIRST_YEAR on --
                                       round, overall pick and drafting team,
                                       linked to the same player ids.
  /friv/birthplaces.fcgi?country={cc}  one page per birth country BBRef lists,
                                       plus one per US state, which is how
                                       birth country is read without fetching
                                       1,400 individual player pages. BOTH
                                       SIDES are fetched deliberately: a player
                                       found on a foreign country page is
                                       foreign-born and a player found on a US
                                       state page is US-born, so "born outside
                                       the United States" is decided by
                                       positive evidence either way and a
                                       player the site records no birthplace
                                       for stays honestly unknown instead of
                                       being defaulted into one bucket.

Politeness: one request at a time, REQUEST_DELAY_SECONDS apart, well inside
Basketball-Reference's published rate limit, with resume-on-rerun (an already
downloaded page is skipped unless --refresh).

    python3 scripts/fetch_player_reference_html.py
    python3 scripts/fetch_player_reference_html.py --refresh
"""
from __future__ import annotations

import argparse
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / "cache" / "html" / "reference"

BREF = "https://www.basketball-reference.com"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)

# Basketball-Reference throttles aggressively above ~20 requests/minute and
# answers 429 rather than degrading, so this sits comfortably under that.
REQUEST_DELAY_SECONDS = 3.5
MAX_RETRIES = 3

# The earliest draft a player active in the 1979-80..2025-26 data window could
# have come out of. 1966 covers every drafted player in that window with room
# to spare (the oldest such player, Kareem Abdul-Jabbar, was the 1969 first
# overall pick) and costs a handful of extra pages.
DRAFT_FIRST_YEAR = 1966
DRAFT_LAST_YEAR = 2026

LETTERS = "abcdefghijklmnopqrstuvwxyz"

# `country=US` alone returns nothing on Basketball-Reference -- the US index is
# split by state -- so the US side of the birthplace question is fetched one
# state at a time. DC is included; the outlying territories (Puerto Rico, the
# US Virgin Islands) are NOT, because the site lists them as their own
# countries (PR, VI) and the shipped definition counts them as international,
# matching the NBA's own roster convention.
US_STATES: tuple[str, ...] = (
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI",
    "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
    "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH",
    "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA",
    "WV", "WI", "WY",
)


def _fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    last: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise
            last = exc
            time.sleep(REQUEST_DELAY_SECONDS * attempt * 4)
        except Exception as exc:  # noqa: BLE001 -- retry any transport error
            last = exc
            time.sleep(REQUEST_DELAY_SECONDS * attempt * 2)
    raise RuntimeError(f"failed after {MAX_RETRIES} attempts: {url}") from last


def _download(url: str, target: Path, *, refresh: bool) -> bool:
    """Returns True if a network request was actually made."""
    if target.exists() and not refresh and target.stat().st_size > 10_000:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(_fetch(url))
    return True


def _country_codes(sample_html: str) -> list[str]:
    """Every birth country code Basketball-Reference's own country picker lists.

    Read off a fetched birthplaces page rather than hardcoded, so the country
    list can never drift away from the site's.
    """
    codes = set(re.findall(r"birthplaces\.fcgi\?country=([A-Za-z]{2,3})\b", sample_html))
    return sorted(codes)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="re-download pages already cached")
    args = parser.parse_args()

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    fetched = 0

    print(f"[1/4] player index pages -> {CACHE_DIR}")
    for letter in LETTERS:
        target = CACHE_DIR / f"players_{letter}.html"
        if _download(f"{BREF}/players/{letter}/", target, refresh=args.refresh):
            fetched += 1
            time.sleep(REQUEST_DELAY_SECONDS)
        print(f"  players/{letter}", flush=True)

    print("[2/4] draft pages")
    for year in range(DRAFT_FIRST_YEAR, DRAFT_LAST_YEAR + 1):
        target = CACHE_DIR / f"draft_{year}.html"
        try:
            if _download(f"{BREF}/draft/NBA_{year}.html", target, refresh=args.refresh):
                fetched += 1
                time.sleep(REQUEST_DELAY_SECONDS)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                print(f"  draft {year}: no page (404)", flush=True)
                continue
            raise
        print(f"  draft {year}", flush=True)

    print("[3/4] birthplace pages, by country")
    seed = CACHE_DIR / "birthplaces_CA.html"
    if _download(f"{BREF}/friv/birthplaces.fcgi?country=CA", seed, refresh=args.refresh):
        fetched += 1
        time.sleep(REQUEST_DELAY_SECONDS)
    codes = _country_codes(seed.read_text(encoding="utf-8", errors="replace"))
    print(f"  {len(codes)} country codes listed by the site")
    for code in codes:
        if code == "US":
            continue  # split by state -- see US_STATES
        target = CACHE_DIR / f"birthplaces_{code}.html"
        if _download(f"{BREF}/friv/birthplaces.fcgi?country={code}", target, refresh=args.refresh):
            fetched += 1
            time.sleep(REQUEST_DELAY_SECONDS)
        print(f"  birthplaces/{code}", flush=True)

    print("[4/4] US birthplace pages, by state")
    for state in US_STATES:
        target = CACHE_DIR / f"birthplaces_US_{state}.html"
        if _download(
            f"{BREF}/friv/birthplaces.fcgi?country=US&state={state}",
            target,
            refresh=args.refresh,
        ):
            fetched += 1
            time.sleep(REQUEST_DELAY_SECONDS)
        print(f"  birthplaces/US-{state}", flush=True)

    print(f"\ndone: {fetched} pages fetched, cache at {CACHE_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
