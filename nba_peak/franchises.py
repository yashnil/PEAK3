"""Shared NBA franchise-continuity mapping.

Promoted verbatim out of ``nba_peak.daily_grid.constraints`` (where it was the
Daily Grid's private team-constraint table) so more than one game can read it
without importing another game's module. The data and its documented editorial
choices are unchanged -- this move is a relocation, not a revision.
``nba_peak.daily_grid.constraints`` re-exports ``FRANCHISES`` from here, so
every existing import path keeps working.

Franchise continuity is how fans actually think about team history: Sonics
seasons answer "Thunder", Bullets seasons answer "Wizards". Every game that
asks "did this player play for franchise F" needs the same answer, which is
exactly why this table cannot live inside one game's package.
"""
from __future__ import annotations

# Current franchise -> every Basketball-Reference team code that franchise has
# played under since 1979-80. Real, publicly documented franchise history:
# relocations and renames only, never a merger of distinct franchises. The
# 1988-2002 Charlotte Hornets (CHH) are grouped with today's Charlotte
# Hornets/Bobcats (CHO/CHA) because the current franchise holds that history
# and records; the 2002+ New Orleans franchise (NOH/NOK/NOP) is its own entry.
FRANCHISES: dict[str, tuple[str, tuple[str, ...]]] = {
    "ATL": ("Atlanta Hawks", ("ATL",)),
    "BOS": ("Boston Celtics", ("BOS",)),
    "BRK": ("Brooklyn Nets", ("BRK", "NJN")),
    "CHA": ("Charlotte Hornets", ("CHO", "CHA", "CHH")),
    "CHI": ("Chicago Bulls", ("CHI",)),
    "CLE": ("Cleveland Cavaliers", ("CLE",)),
    "DAL": ("Dallas Mavericks", ("DAL",)),
    "DEN": ("Denver Nuggets", ("DEN",)),
    "DET": ("Detroit Pistons", ("DET",)),
    "GSW": ("Golden State Warriors", ("GSW",)),
    "HOU": ("Houston Rockets", ("HOU",)),
    "IND": ("Indiana Pacers", ("IND",)),
    "LAC": ("Los Angeles Clippers", ("LAC", "SDC")),
    "LAL": ("Los Angeles Lakers", ("LAL",)),
    "MEM": ("Memphis Grizzlies", ("MEM", "VAN")),
    "MIA": ("Miami Heat", ("MIA",)),
    "MIL": ("Milwaukee Bucks", ("MIL",)),
    "MIN": ("Minnesota Timberwolves", ("MIN",)),
    "NOP": ("New Orleans Pelicans", ("NOP", "NOH", "NOK")),
    "NYK": ("New York Knicks", ("NYK",)),
    "OKC": ("Oklahoma City Thunder", ("OKC", "SEA")),
    "ORL": ("Orlando Magic", ("ORL",)),
    "PHI": ("Philadelphia 76ers", ("PHI",)),
    "PHO": ("Phoenix Suns", ("PHO",)),
    "POR": ("Portland Trail Blazers", ("POR",)),
    "SAC": ("Sacramento Kings", ("SAC", "KCK")),
    "SAS": ("San Antonio Spurs", ("SAS",)),
    "TOR": ("Toronto Raptors", ("TOR",)),
    "UTA": ("Utah Jazz", ("UTA",)),
    "WAS": ("Washington Wizards", ("WAS", "WSB")),
}


# Reverse index: any historical team code -> the current franchise_id that
# holds its history. Derived from FRANCHISES rather than hand-maintained, so
# the two can never disagree. A code absent here (e.g. a multi-team aggregate
# token like "2TM") has no franchise and callers must treat it as unresolvable
# rather than guessing.
TEAM_CODE_TO_FRANCHISE: dict[str, str] = {
    code: franchise_id
    for franchise_id, (_name, codes) in FRANCHISES.items()
    for code in codes
}


def franchise_for_team_code(team_code: str | None) -> str | None:
    """The current franchise_id that owns `team_code`'s history, or None.

    None means "not a real single-team code" -- either an unknown string or a
    multi-team aggregate ("2TM"/"3TM"/"TOT"). Never falls back to a guess.
    """
    if not team_code:
        return None
    return TEAM_CODE_TO_FRANCHISE.get(str(team_code).strip().upper())


def franchise_display_name(franchise_id: str) -> str | None:
    """Display name for a franchise_id, or None if it isn't one."""
    entry = FRANCHISES.get(franchise_id)
    return entry[0] if entry else None


def team_codes_for_franchise(franchise_id: str) -> tuple[str, ...]:
    """Every Basketball-Reference code this franchise has played under."""
    entry = FRANCHISES.get(franchise_id)
    return entry[1] if entry else ()


__all__ = [
    "FRANCHISES",
    "TEAM_CODE_TO_FRANCHISE",
    "franchise_for_team_code",
    "franchise_display_name",
    "team_codes_for_franchise",
]
