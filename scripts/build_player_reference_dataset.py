#!/usr/bin/env python3
"""Build the committed player-reference dataset the Daily Grid taxonomy reads.

WHAT THIS IS FOR
The Daily Grid's basketball-native categories -- "Top-10 Pick", "International
Player", "7'0\" or Taller", "25+ PPG Season", "200+ Threes", "Played for 5+
Franchises" -- are facts about players and seasons that PEAK3's own model
tables do not carry. PEAK3's committed parquets hold rates per 100 possessions,
award ranks and playoff outcomes; they hold no height, no draft slot, no birth
country and no per-GAME box line. This script builds those, once, into two
committed artifacts, from the same source the rest of the repository already
treats as canonical (Basketball-Reference).

    data/reference/player_season_box.v1.parquet   season grain
    data/reference/player_bio.v1.json             career grain
    data/reference/player_reference_manifest.v1.json  provenance + checksums

WHY A COMMITTED ARTIFACT RATHER THAN A RUNTIME LOOKUP
Same reasoning as docs/implementation/CI_DATA_CONTRACT.md applies to
data/generated/: the inputs need either live network access
(cache/html/reference/, fetched by scripts/fetch_player_reference_html.py) or a
warm 370MB local scrape cache (cache/html/NBA_*_per_game.html), and CI must
depend on neither. So the *derived* artifacts are category-1 committed inputs
and every test and runtime path reads only those.

IDENTITY, AND WHY THERE IS NO NAME MATCHING ANYWHERE HERE
Every source page carries Basketball-Reference's own stable player id
(`data-append-csv`, e.g. `jordami01`), so season rows, bio rows, draft rows and
birthplace rows are joined on that id and never on a display name. That
matters: the league has had three Charles Smiths and two Mike Dunleavys, and a
name join would have silently mixed them. The one place a name is used is the
final bridge onto PEAK3's own tables, which key on the Basketball-Reference
display name -- and that bridge is built HERE, from the per-game pages, as an
(id, season, team) -> name mapping read out of the same rows the stats come
from, so it is exact rather than fuzzy.

SOURCES, AND WHAT EACH ONE DECIDES

  cache/html/NBA_{year}_per_game.html          (1979-80 .. 2025-26)
      Basketball-Reference's season "Per Game" table. Already in this
      repository's scrape cache -- nba_peak/context_build.py reads the same
      files -- and re-scrapable with `peak3.py --build-context`.
      Decides: per-game points/rebounds/assists/steals/blocks, three-pointers
      MADE, games, and the id/season/team/name bridge above.
      Full precision, not the rounded display value: each cell carries a `csk`
      sort key holding the exact ratio, so three-pointers made comes back as
      an exact integer (`fg3_per_g` x `games`) rather than a reconstruction
      from a one-decimal average.
      Traded players appear as a combined "2TM"/"3TM" row AND one row per
      team stint; all are kept, and the team column says which is which.

  cache/html/reference/players_{a..z}.html     Basketball-Reference player index
      Decides: listed height (its `csk` is the height in inches, so no
      feet-inches string parsing), weight, birth date, career span, career
      position string, colleges.

  cache/html/reference/draft_{year}.html       NBA drafts, 1966 onward
      Decides: draft round, overall pick, drafting team. The round comes from
      the table's own "Round N" section headers rather than being inferred
      from the pick number, because the modern two-round draft is a 1989
      invention -- earlier drafts ran to seven, ten, even twenty-one rounds,
      and pick 40 of the 1980 draft is a THIRD-round pick, not a second.

  cache/html/reference/birthplaces_{cc}.html   one page per birth country
  cache/html/reference/birthplaces_US_{st}.html  one page per US state
      Decides: birth country, from positive evidence on both sides -- see
      `_birthplaces` below.

    python3 scripts/build_player_reference_dataset.py
    python3 scripts/build_player_reference_dataset.py --check   # verify only
"""
from __future__ import annotations

import argparse
import hashlib
import html as html_module
import json
import re
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nba_peak.franchises import FRANCHISES  # noqa: E402

HTML_DIR = REPO_ROOT / "cache" / "html"
REFERENCE_HTML_DIR = HTML_DIR / "reference"
OUT_DIR = REPO_ROOT / "data" / "reference"

SEASON_BOX_PATH = OUT_DIR / "player_season_box.v1.parquet"
BIO_PATH = OUT_DIR / "player_bio.v1.json"
MANIFEST_PATH = OUT_DIR / "player_reference_manifest.v1.json"

DATASET_VERSION = "player_reference.v1"

# The PEAK3 data window: 1979-80 (season_end 1980) through 2025-26.
FIRST_SEASON_END = 1980
LAST_SEASON_END = 2026

SOURCE_BASE_URL = "https://www.basketball-reference.com"

# Characters Unicode decomposition alone will not fold to ASCII, because they
# are distinct letters rather than a letter plus a combining accent.
_FOLD_EXCEPTIONS = str.maketrans(
    {
        "ø": "o",
        "Ø": "O",
        "đ": "d",
        "Đ": "D",
        "ł": "l",
        "Ł": "L",
        "ß": "ss",
        "æ": "ae",
        "Æ": "AE",
        "œ": "oe",
        "Œ": "OE",
        # Turkish dotless/dotted i. "Omer Asik" is written "Omer Asik" with a
        # dotless i on Basketball-Reference and with a plain i in PEAK3's
        # tables, and the dotless form is a letter in its own right, so
        # decomposition leaves it alone.
        "ı": "i",
        "İ": "I",
    }
)


def ascii_fold(name: str) -> str:
    """'Anderson Varejao' from 'Anderson Varejao' with the tilde.

    THE BRIDGE ONTO PEAK3'S OWN TABLES. Basketball-Reference's season pages
    write a player's name with its diacritics; the committed PEAK3 parquets
    carry the same names already flattened to ASCII, and `pool.slug()` folds
    only non-alphanumerics, so an accented source name would slug to
    "anderson-varej-o" and match nothing. Folding here, once, in the build, is
    what makes the join exact -- and it is recorded in the manifest's
    normalization block rather than living as an undocumented behaviour of the
    loader.
    """
    decomposed = unicodedata.normalize("NFKD", str(name).translate(_FOLD_EXCEPTIONS))
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


# Slug aliases: a Basketball-Reference display name whose ASCII fold does NOT
# equal the name the same player carries in PEAK3's committed scrape. Each
# entry is a spelling difference between two renderings of one person, never a
# guess about who someone is, and each says which two spellings it reconciles.
#
# `demin` is the only one in the 1979-80..2025-26 window: Basketball-Reference
# writes "Egor Dyomin" with a Cyrillic yo, which no Latin decomposition folds,
# while the committed PEAK3 tables carry the transliteration "Egor Diomin"
# captured at scrape time. Verified as one player by Basketball-Reference id
# (`demineg01`, 2025-26 Brooklyn) rather than by the names agreeing.
SLUG_ALIASES: dict[str, str] = {
    "demineg01": "egor-diomin",
}


def player_slug(name: str, bbref_id: str | None = None) -> str:
    """The PEAK3 player slug for a Basketball-Reference display name."""
    alias = SLUG_ALIASES.get(bbref_id or "")
    if alias is not None:
        return alias
    return re.sub(r"[^a-z0-9]+", "-", ascii_fold(name).lower()).strip("-")


_ROW_RE = re.compile(r"<tr[^>]*>.*?</tr>", re.S)
# Basketball-Reference emits `<tbody>` but OMITS the closing tag on some page
# families (the player index is one), so the body has to be bounded by
# whichever of `</tbody>`, `</table>` or end-of-document comes first rather
# than by a closing tag that may not exist.
_TBODY_OPEN_RE = re.compile(r"<tbody[^>]*>", re.S)
_TBODY_CLOSE_RE = re.compile(r"</tbody>|</table>", re.S)
_ID_RE = re.compile(r'data-append-csv="([^"]+)"')
_ROUND_RE = re.compile(r">Round (\d+)<")
# Basketball-Reference quotes href with a double quote on some page families
# and a single quote on others (the draft tables use single), so both are
# accepted rather than silently matching nothing.
_PLAYER_HREF_RE = re.compile(r"""href=['"]/players/[a-z]/([a-z0-9]+)\.html['"]""")


def _tbody(html: str) -> str:
    opened = _TBODY_OPEN_RE.search(html)
    if opened is None:
        return ""
    body = html[opened.end():]
    closed = _TBODY_CLOSE_RE.search(body)
    return body[: closed.start()] if closed else body


def _cell(row: str, stat: str) -> str | None:
    """The value of one `data-stat` cell, preferring its full-precision `csk`.

    Basketball-Reference renders a rounded value but keeps the exact one in the
    cell's sort key, so `pts_per_g` reads 30.1 and `csk` reads
    30.0632911392. Preferring `csk` is what makes three-pointers-made an exact
    integer rather than a reconstruction from a one-decimal average: 5.1 x 79
    rounds to 403 threes for 2015-16 Stephen Curry, and the real number is 402.
    """
    match = re.search(
        rf'<t[dh]\b([^>]*\bdata-stat="{re.escape(stat)}"[^>]*)>(.*?)</t[dh]>', row, re.S
    )
    if match is None:
        return None
    attributes, content = match.group(1), match.group(2)
    sort_key = re.search(r'\bcsk="([^"]*)"', attributes)
    if sort_key is not None and sort_key.group(1) != "":
        return html_module.unescape(sort_key.group(1))
    text = html_module.unescape(re.sub(r"<[^>]+>", "", content)).strip()
    return text or None


def _float(value: str | None) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _int(value: str | None) -> int | None:
    number = _float(value)
    return None if number is None else int(round(number))


# ---------------------------------------------------------------------------
# Season grain: the per-game box line, from the season "Per Game" pages
# ---------------------------------------------------------------------------

def _season_box() -> pd.DataFrame:
    records: list[dict] = []
    missing: list[int] = []
    for season_end in range(FIRST_SEASON_END, LAST_SEASON_END + 1):
        path = HTML_DIR / f"NBA_{season_end}_per_game.html"
        if not path.exists():
            missing.append(season_end)
            continue
        html = path.read_text(encoding="utf-8", errors="replace")
        for row in _ROW_RE.findall(_tbody(html)):
            player_id_match = _ID_RE.search(row)
            if player_id_match is None:
                continue  # a repeated header row inside the body
            games = _int(_cell(row, "games"))
            if not games:
                continue
            # HTML entities are unescaped here, not left raw: the source
            # writes "Alperen &#350;eng&#252;n", and a raw-entity name would
            # ASCII-fold to a slug PEAK3's own tables never produce, silently
            # dropping every accented player from the join.
            name = html_module.unescape(
                re.sub(
                    r"<[^>]+>",
                    "",
                    re.search(r'data-stat="name_display"[^>]*>(.*?)</td>', row, re.S).group(1),
                )
            ).strip().rstrip("*")
            fg3_per_g = _float(_cell(row, "fg3_per_g"))
            records.append(
                {
                    "bbref_id": player_id_match.group(1),
                    "name": name,
                    # The join key onto PEAK3's own tables -- see ascii_fold().
                    "player_slug": player_slug(name, player_id_match.group(1)),
                    "season_end": season_end,
                    "season": f"{season_end - 1}-{str(season_end)[-2:]}",
                    "team": _cell(row, "team_name_abbr"),
                    "age": _int(_cell(row, "age")),
                    "season_pos": _cell(row, "pos"),
                    "g": games,
                    "gs": _int(_cell(row, "games_started")),
                    "mpg": _float(_cell(row, "mp_per_g")),
                    "pts_pg": _float(_cell(row, "pts_per_g")),
                    "trb_pg": _float(_cell(row, "trb_per_g")),
                    "ast_pg": _float(_cell(row, "ast_per_g")),
                    "stl_pg": _float(_cell(row, "stl_per_g")),
                    "blk_pg": _float(_cell(row, "blk_per_g")),
                    "fg3_pg": fg3_per_g,
                    # EXACT, not rounded: `csk` holds the true ratio, so
                    # ratio x games is the integer the season totals table
                    # would show.
                    "fg3m": None if fg3_per_g is None else int(round(fg3_per_g * games)),
                    "fg_pct": _float(_cell(row, "fg_pct")),
                    "fg3_pct": _float(_cell(row, "fg3_pct")),
                    "ft_pct": _float(_cell(row, "ft_pct")),
                }
            )
    if missing:
        raise SystemExit(
            "missing cached per-game pages for season(s) "
            f"{missing}. Rebuild the scrape cache first "
            "(peak3.py --build-context) -- this script never scrapes."
        )
    frame = pd.DataFrame.from_records(records)
    frame = frame.drop_duplicates(subset=["bbref_id", "season_end", "team"], keep="first")
    frame = _mark_slug_primary(frame)
    return frame.sort_values(["season_end", "bbref_id", "team"]).reset_index(drop=True)


def _mark_slug_primary(frame: pd.DataFrame) -> pd.DataFrame:
    """Flag the one row per (player_slug, season, team) the PEAK3 join may use.

    THE COLLISION IS REAL AND THERE IS EXACTLY ONE OF IT. Basketball-Reference
    ids are unique, PEAK3 slugs are not: two different Charles Joneses played
    for the 1988-89 Washington Bullets, and both fold to `charles-jones`. Every
    other (slug, season, team) key in the whole 1979-80..2025-26 window is
    unique, so this is a single documented case rather than a general fuzziness.

    Resolution is "the row with more games played, then the lower
    Basketball-Reference id" -- deterministic, and for the one case that exists
    it selects `jonesch01` (53 games), which is the row PEAK3's own scored
    table carries for that season (53 games, 21.8 MPG). Verified in
    tests/test_player_reference_dataset.py rather than asserted here.
    """
    ordered = frame.sort_values(
        ["player_slug", "season_end", "team", "g", "bbref_id"],
        ascending=[True, True, True, False, True],
    )
    primary = ~ordered.duplicated(subset=["player_slug", "season_end", "team"], keep="first")
    ordered = ordered.assign(slug_primary=primary.to_numpy())
    return ordered


# ---------------------------------------------------------------------------
# Career grain: the player index
# ---------------------------------------------------------------------------

def _player_index() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for letter in "abcdefghijklmnopqrstuvwxyz":
        path = REFERENCE_HTML_DIR / f"players_{letter}.html"
        if not path.exists():
            raise SystemExit(
                f"missing {path}. Run scripts/fetch_player_reference_html.py first."
            )
        html = path.read_text(encoding="utf-8", errors="replace")
        for row in _ROW_RE.findall(_tbody(html)):
            player_id_match = _ID_RE.search(row)
            if player_id_match is None:
                continue
            name = html_module.unescape(
                re.sub(
                    r"<[^>]+>",
                    "",
                    re.search(r'data-stat="player"[^>]*>(.*?)</th>', row, re.S).group(1),
                )
            ).strip().rstrip("*")
            colleges_cell = re.search(r'data-stat="colleges"[^>]*>(.*?)</td>', row, re.S)
            colleges = (
                [
                    html_module.unescape(part).strip()
                    for part in re.sub(r"<[^>]+>", "|", colleges_cell.group(1)).split("|")
                    # The cell separates multiple colleges with a bare comma
                    # between the links, which survives tag stripping as its own
                    # fragment; a fragment with no letter in it is punctuation,
                    # not a school.
                    if re.search(r"[A-Za-z]", part)
                ]
                if colleges_cell
                else []
            )
            out[player_id_match.group(1)] = {
                "name": name,
                # `csk` on the height cell is the height in inches, which is
                # why no "6-6" string is ever parsed here.
                "height_in": _int(_cell(row, "height")),
                "weight_lb": _int(_cell(row, "weight")),
                "birth_date": _cell(row, "birth_date"),
                "career_pos": _cell(row, "pos"),
                "year_min": _int(_cell(row, "year_min")),
                "year_max": _int(_cell(row, "year_max")),
                "colleges": colleges,
            }
    return out


# ---------------------------------------------------------------------------
# Career grain: the draft
# ---------------------------------------------------------------------------

def _drafts() -> dict[str, dict]:
    """bbref_id -> the player's draft slot.

    ROUND COMES FROM THE PAGE, NOT FROM THE PICK NUMBER. Basketball-Reference
    breaks each draft table into "Round 1", "Round 2", ... sections with an
    in-body header row, and this walks those sections in order. Inferring the
    round arithmetically would be wrong for every draft before 1989: the 1984
    draft ran ten rounds of 23-24 picks, so overall pick 30 there is a
    SECOND-round pick, while in 1996 overall pick 30 is a first-round pick.
    """
    out: dict[str, dict] = {}
    for path in sorted(REFERENCE_HTML_DIR.glob("draft_*.html")):
        year = int(path.stem.split("_")[1])
        html = path.read_text(encoding="utf-8", errors="replace")
        current_round = 1
        for row in _ROW_RE.findall(_tbody(html)):
            round_match = _ROUND_RE.search(row)
            if round_match is not None:
                current_round = int(round_match.group(1))
                continue
            player_href = _PLAYER_HREF_RE.search(row)
            if player_href is None:
                continue
            pick = _int(_cell(row, "pick_overall"))
            if pick is None:
                continue
            player_id = player_href.group(1)
            record = {
                "draft_year": year,
                "draft_round": current_round,
                "draft_pick_overall": pick,
                # `csk` on the team cell is a sort key ("PHI.001"), so the
                # team code is its first dotted segment.
                "draft_team": (_cell(row, "team_id") or "").split(".")[0] or None,
            }
            # A player drafted twice (it happened before the merger, and a
            # handful of players re-entered) keeps the EARLIEST draft, which is
            # the one "was he a top-10 pick" is asking about.
            existing = out.get(player_id)
            if existing is None or (year, pick) < (existing["draft_year"], existing["draft_pick_overall"]):
                out[player_id] = record
    return out


# ---------------------------------------------------------------------------
# Career grain: birth country
# ---------------------------------------------------------------------------

def _birthplaces() -> tuple[dict[str, str], set[str]]:
    """(bbref_id -> ISO-ish birth country code, set of ids positively US-born).

    BOTH SIDES ARE POSITIVE EVIDENCE. The foreign country pages say who was
    born abroad; the 51 US state pages say who was born in the United States.
    A player on neither is left out of both sets and ends up with
    `birth_country: null` and `international: null` -- honestly unknown, never
    defaulted to "American because we did not find him", which is the failure
    mode that would make an International Player square reject a correct
    answer.
    """
    foreign: dict[str, str] = {}
    domestic: set[str] = set()
    for path in sorted(REFERENCE_HTML_DIR.glob("birthplaces_*.html")):
        stem = path.stem[len("birthplaces_"):]
        html = path.read_text(encoding="utf-8", errors="replace")
        ids = {
            _ID_RE.search(row).group(1)
            for row in _ROW_RE.findall(_tbody(html))
            if _ID_RE.search(row)
        }
        if stem == "US":
            # `country=US` with no state returns an empty index -- the US side
            # is fetched state by state. Skipped explicitly so a stale copy of
            # that page can never be read as a country named "US".
            continue
        if stem.startswith("US_"):
            domestic |= ids
        else:
            for player_id in ids:
                foreign.setdefault(player_id, stem)
    return foreign, domestic


# ---------------------------------------------------------------------------
# Career grain: franchise journey, derived from the season box
# ---------------------------------------------------------------------------

_CODE_TO_FRANCHISE: dict[str, str] = {
    code: franchise_id for franchise_id, (_, codes) in FRANCHISES.items() for code in codes
}

_MULTI_TEAM = re.compile(r"^\d+TM$|^TOT$")


def _journey(box: pd.DataFrame) -> dict[str, dict]:
    """bbref_id -> franchises played for and seasons played, 1979-80 onward.

    Read from the PER-TEAM rows of the per-game pages, which is why a player
    traded mid-season is credited with both franchises. PEAK3's own
    regular-season parquet cannot answer this: it carries only the combined
    "2TM" row for a traded season, so counting franchises there would quietly
    lose every trade.

    Relocations and renames fold into today's franchise through
    nba_peak.franchises, so Seattle seasons count towards the Thunder and
    Bullets seasons towards the Wizards -- the same table the Daily Grid's team
    constraints already use, so "played for 5 franchises" and "played for the
    Wizards" can never disagree about what a franchise is.
    """
    franchises: dict[str, set[str]] = defaultdict(set)
    seasons: dict[str, set[int]] = defaultdict(set)
    for row in box.itertuples(index=False):
        seasons[row.bbref_id].add(int(row.season_end))
        if row.team is None or _MULTI_TEAM.match(str(row.team)):
            continue
        franchise = _CODE_TO_FRANCHISE.get(str(row.team))
        if franchise is not None:
            franchises[row.bbref_id].add(franchise)
    return {
        player_id: {
            "franchises": sorted(franchises.get(player_id, ())),
            "franchise_count": len(franchises.get(player_id, ())),
            "seasons_played": len(season_set),
            "first_season_end": min(season_set),
            "last_season_end": max(season_set),
        }
        for player_id, season_set in seasons.items()
    }


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def build_bio(box: pd.DataFrame) -> dict[str, dict]:
    index = _player_index()
    drafts = _drafts()
    foreign, domestic = _birthplaces()
    journey = _journey(box)

    bio: dict[str, dict] = {}
    for player_id, in_window in journey.items():
        base = index.get(player_id, {})
        draft = drafts.get(player_id)
        country = foreign.get(player_id)
        if country is not None:
            international: bool | None = True
        elif player_id in domestic:
            country, international = "US", False
        else:
            international = None

        year_min = base.get("year_min")
        # Is every season this player ever played inside PEAK3's window? Only
        # then can a career-shaped claim ("one franchise", "undrafted") be made
        # from in-window data without risking a false positive -- see
        # nba_peak/daily_grid/constraints.py's career-journey block.
        career_in_window = year_min is not None and year_min >= FIRST_SEASON_END

        bio[player_id] = {
            "name": base.get("name") or _display_name(box, player_id),
            "height_in": base.get("height_in"),
            "weight_lb": base.get("weight_lb"),
            "birth_date": base.get("birth_date"),
            "career_pos": base.get("career_pos"),
            "colleges": base.get("colleges", []),
            "career_year_min": year_min,
            "career_year_max": base.get("year_max"),
            "career_fully_in_window": career_in_window,
            "birth_country": country,
            "international": international,
            "draft_year": draft["draft_year"] if draft else None,
            "draft_round": draft["draft_round"] if draft else None,
            "draft_pick_overall": draft["draft_pick_overall"] if draft else None,
            "draft_team": draft["draft_team"] if draft else None,
            # UNDRAFTED IS A CLAIM, NOT AN ABSENCE. It is only asserted for a
            # career that began after the ABA merger and inside the window,
            # because a player who entered via the 1976 ABA dispersal draft
            # (Moses Malone) has no NBA draft row at all and must never be
            # called undrafted. Everyone else with no draft row is left null.
            "undrafted": _undrafted(draft, career_in_window),
            **in_window,
        }
    return bio


def _undrafted(draft: dict | None, career_in_window: bool) -> bool | None:
    """UNDRAFTED IS A CLAIM, NOT AN ABSENCE OF EVIDENCE.

    True only for a player with no NBA draft row whose whole career sits inside
    PEAK3's window, i.e. who debuted in 1979-80 or later and therefore after
    the ABA merger closed the last non-draft route into the league. A player
    who entered through the 1976 ABA dispersal draft (Moses Malone) or an older
    special draft has no row on any NBA draft page either, and calling him
    undrafted would be false -- so an earlier career with no draft row stays
    `null`, meaning unknown, and fails the constraint rather than passing it
    wrongly.
    """
    if draft is not None:
        return False
    return True if career_in_window else None


def _display_name(box: pd.DataFrame, player_id: str) -> str:
    rows = box.loc[box["bbref_id"] == player_id, "name"]
    return str(rows.iloc[-1]) if len(rows) else player_id


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="build in memory, write nothing")
    args = parser.parse_args()

    print("parsing season per-game pages ...")
    box = _season_box()
    print(f"  {len(box):,} player-season-team rows, {box['bbref_id'].nunique():,} players")

    print("parsing player index / drafts / birthplaces ...")
    bio = build_bio(box)
    print(f"  {len(bio):,} players with at least one in-window season")

    heights = sum(1 for v in bio.values() if v["height_in"])
    drafted = sum(1 for v in bio.values() if v["draft_pick_overall"])
    undrafted = sum(1 for v in bio.values() if v["undrafted"])
    known_country = sum(1 for v in bio.values() if v["international"] is not None)
    international = sum(1 for v in bio.values() if v["international"])
    print(
        f"  height {heights}/{len(bio)} | drafted {drafted} | undrafted {undrafted} "
        f"| birth country known {known_country}/{len(bio)} (international {international})"
    )

    if args.check:
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    box.to_parquet(SEASON_BOX_PATH, index=False)
    BIO_PATH.write_text(
        json.dumps(
            {
                "version": DATASET_VERSION,
                "players": dict(sorted(bio.items())),
            },
            indent=1,
            sort_keys=False,
        )
        + "\n",
        encoding="utf-8",
    )

    manifest = {
        "version": DATASET_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "generator": "scripts/build_player_reference_dataset.py",
        "fetcher": "scripts/fetch_player_reference_html.py",
        "window": {"first_season_end": FIRST_SEASON_END, "last_season_end": LAST_SEASON_END},
        "sources": [
            {
                "name": "season per-game tables",
                "url_pattern": f"{SOURCE_BASE_URL}/leagues/NBA_{{season_end}}_per_game.html",
                "supplies": [
                    "per-game points/rebounds/assists/steals/blocks",
                    "three-pointers made (exact, from the cell sort key x games)",
                    "games, games started, minutes per game",
                    "the (player id, season, team) -> display-name bridge onto PEAK3's tables",
                ],
                "seasons": f"{FIRST_SEASON_END}..{LAST_SEASON_END}",
            },
            {
                "name": "player index",
                "url_pattern": f"{SOURCE_BASE_URL}/players/{{letter}}/",
                "supplies": ["listed height in inches", "weight", "birth date", "career span", "colleges"],
            },
            {
                "name": "draft results",
                "url_pattern": f"{SOURCE_BASE_URL}/draft/NBA_{{year}}.html",
                "supplies": ["draft round (from the table's own round sections)", "overall pick", "drafting team"],
            },
            {
                "name": "birthplaces",
                "url_pattern": f"{SOURCE_BASE_URL}/friv/birthplaces.fcgi?country={{code}}[&state={{state}}]",
                "supplies": ["birth country, as positive evidence on both the foreign and US side"],
            },
        ],
        "normalization": {
            "player_identity": "Basketball-Reference player id (data-append-csv); no name matching anywhere in the build",
            "height": "inches, read from the height cell's numeric sort key rather than parsing a feet-inches string",
            "draft_round": "read from the table's 'Round N' section headers, never inferred from the overall pick",
            "international": "born outside the United States. Puerto Rico and the US Virgin Islands count as international, matching the NBA's own roster convention. Birthplace, never citizenship or national-team affiliation.",
            "franchise": "nba_peak.franchises -- relocations and renames fold into today's franchise",
            "three_pointers_made": "exact integer: the per-game cell's full-precision sort key multiplied by games played",
            "multi_team_seasons": "kept as both the combined 2TM/3TM row and one row per team stint; the team column distinguishes them",
        },
        "counts": {
            "season_rows": int(len(box)),
            "players": len(bio),
            "players_with_height": heights,
            "players_drafted": drafted,
            "players_undrafted": undrafted,
            "players_with_known_birth_country": known_country,
            "players_international": international,
        },
        "artifacts": {
            "player_season_box.v1.parquet": {"sha256": _sha256(SEASON_BOX_PATH)},
            "player_bio.v1.json": {"sha256": _sha256(BIO_PATH)},
        },
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nwrote:\n  {SEASON_BOX_PATH}\n  {BIO_PATH}\n  {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
