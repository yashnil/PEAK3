#!/usr/bin/env python3
"""
peak3.py - NBA "best consecutive 3-year peak" calculator.

Given a player name, this program:
  1. Automatically scrapes/caches Basketball Reference data (1979-80 .. 2025-26).
  2. Scores every qualifying player-season on an OPEN FIVE-COMPONENT weighted
     raw-value index (see FORMULA_TEXT / METHODOLOGY.md).
  3. Tests every consecutive 3-year window and selects the best one.
  4. Prints a detailed, analytical terminal report.

Each season's PRIME index is the weighted sum of five RAW additive components
(no percentiles inside the index):
  prime_raw = 0.38 Statistical Impact + 0.21 Traditional Production
            + 0.20 Individual Recognition + 0.18 Postseason Individual Value
            + 0.03 Team Achievement  (+ small descriptive teammate adjustment)
The display score, prime_score = calibrate_score(prime_raw), is a SEPARATE
monotonic relabel of the raw index into interpretable 0-100 historical bands.
performance_only drops the recognition + team-achievement components.

Run:
    python peak3.py --player "Dwyane Wade"
    python peak3.py --player "LeBron James" --mode both
    python peak3.py --top 25 --mode stat
    python peak3.py --rebuild           # rebuild processed data from cached HTML
    python peak3.py --refresh           # re-download HTML, then rebuild everything
    python peak3.py --player "Kobe Bryant" --no-scrape   # offline smoke test

Components are continuous functions of RAW basketball units (era-relative
percentiles/z-scores are computed only for role labels and descriptive display,
NEVER inside the official index). Missing optional metrics (EPM/LEBRON, manual
context) never zero a player out and never crash the program.
"""

from __future__ import annotations

import argparse
import difflib
import json
import re
import sys
import time
from io import StringIO
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

try:
    import requests
except Exception:  # pragma: no cover - only needed when scraping
    requests = None

try:
    from bs4 import BeautifulSoup, Comment
except Exception:  # pragma: no cover
    BeautifulSoup = None
    Comment = None

try:
    from unidecode import unidecode
except Exception:  # pragma: no cover - graceful fallback
    def unidecode(x: str) -> str:
        return x


# ======================================================================
# CONFIG
# ======================================================================

DEFAULT_START_SEASON_END = 1980   # season_end=1980 == 1979-80
DEFAULT_END_SEASON_END = 2026     # season_end=2026 == 2025-26

ROOT = Path(__file__).resolve().parent
CACHE_DIR = ROOT / "cache"
HTML_DIR = CACHE_DIR / "html"
PROCESSED_DIR = CACHE_DIR / "processed"
DATA_DIR = ROOT / "data"
EXAMPLES_DIR = DATA_DIR / "examples"

for _d in (CACHE_DIR, HTML_DIR, PROCESSED_DIR, DATA_DIR, EXAMPLES_DIR):
    _d.mkdir(parents=True, exist_ok=True)

BREF_BASE = "https://www.basketball-reference.com"

REQUEST_DELAY_SECONDS = 3.5      # polite: BR tolerates ~20 req/min
MAX_RETRIES = 4
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 "
    "(peak3 educational research; caches locally; polite)"
)

MIN_REGULAR_MINUTES = 1000       # scaled down for shortened seasons
MIN_PLAYOFF_MINUTES = 100

# Team games played per season (used for durability + qualifier scaling).
TEAM_GAMES_BY_SEASON = {
    1999: 50,
    2012: 66,
    2020: 72,   # bubble-shortened for most teams
    2021: 72,
}


def team_games(season_end: int) -> int:
    return TEAM_GAMES_BY_SEASON.get(int(season_end), 82)


def regular_minutes_threshold(season_end: int) -> float:
    """Scale the 1000-minute bar down for shortened seasons."""
    return MIN_REGULAR_MINUTES * team_games(season_end) / 82.0


# ======================================================================
# SMALL UTILITIES
# ======================================================================

def clean_player_name(name) -> str:
    if pd.isna(name):
        return ""
    name = str(name).replace("*", "")
    name = re.sub(r"\s+", " ", name).strip()
    return unidecode(name)


def norm_key(name: str) -> str:
    """Aggressive normalization for matching: lowercase, no punctuation/accents."""
    name = clean_player_name(name).lower()
    name = name.replace(".", "").replace("'", "").replace("-", " ")
    return re.sub(r"\s+", " ", name).strip()


def clamp(value, low: float = 0.0, high: float = 100.0) -> float:
    if value is None or (isinstance(value, float) and np.isnan(value)) or pd.isna(value):
        return 50.0
    return float(max(low, min(high, value)))


def safe_numeric(df: pd.DataFrame, exclude: Optional[List[str]] = None) -> pd.DataFrame:
    """
    Replicates the (removed-in-pandas-3.0) `to_numeric(errors='ignore')`:
    convert a column to numeric only if every non-empty value is numeric.
    """
    exclude = set(exclude or [])
    df = df.copy()
    for col in df.columns:
        if col in exclude:
            continue
        s = df[col]
        converted = pd.to_numeric(s, errors="coerce")
        orig_nonnull = s.replace("", np.nan).notna()
        if bool((converted.notna() | ~orig_nonnull).all()):
            df[col] = converted
    return df


def num(df: pd.DataFrame, col: str) -> pd.Series:
    if col in df.columns:
        return pd.to_numeric(df[col], errors="coerce")
    return pd.Series(np.nan, index=df.index)


# ======================================================================
# SCRAPING + RAW PARSE
# ======================================================================

class ScrapeBlocked(Exception):
    pass


def fetch_html(url: str, cache_name: str, *, scrape: bool, refresh: bool) -> Optional[str]:
    """
    Returns cached HTML, downloading politely if needed.
    - scrape=False  -> never download; return cached or None.
    - refresh=True  -> re-download even if cached.
    Network failures are non-fatal (returns None) so the build continues.
    """
    cache_path = HTML_DIR / cache_name

    if cache_path.exists() and not refresh:
        return cache_path.read_text(encoding="utf-8")

    if not scrape:
        return None

    if requests is None:
        print("  ! 'requests' not installed; cannot scrape.")
        return None

    headers = {"User-Agent": USER_AGENT}
    delay = REQUEST_DELAY_SECONDS
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            print(f"  downloading {url} (try {attempt})")
            resp = requests.get(url, headers=headers, timeout=30)
            if resp.status_code == 429:
                wait = delay * (2 ** attempt)
                print(f"  ! 429 rate-limited; backing off {wait:.0f}s")
                time.sleep(wait)
                continue
            if resp.status_code == 404:
                print(f"  ! 404 not found: {url}")
                return None
            resp.raise_for_status()
            # BR omits charset; requests then defaults to latin-1 and mangles
            # accented names. Force UTF-8 (BR pages are UTF-8).
            resp.encoding = "utf-8"
            html = resp.text
            cache_path.write_text(html, encoding="utf-8")
            time.sleep(delay)
            return html
        except Exception as exc:  # noqa: BLE001
            wait = delay * (2 ** attempt)
            print(f"  ! fetch error: {exc}; retry in {wait:.0f}s")
            time.sleep(wait)
    print(f"  ! giving up on {url}")
    return None


def uncomment_tables(html: str) -> str:
    """BR hides many tables inside HTML comments; expose them to read_html."""
    if BeautifulSoup is None:
        # crude fallback: strip comment markers around tables
        return html.replace("<!--", "").replace("-->", "")
    soup = BeautifulSoup(html, "lxml")
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        if "<table" in comment:
            comment.replace_with(BeautifulSoup(comment, "lxml"))
    return str(soup)


RENAME_MAP = {
    "TS%": "ts_pct", "3PAr": "threepar", "FTr": "ftr",
    "ORB%": "orb_pct", "DRB%": "drb_pct", "TRB%": "trb_pct",
    "AST%": "ast_pct", "STL%": "stl_pct", "BLK%": "blk_pct",
    "TOV%": "tov_pct", "USG%": "usg_pct",
    "WS/48": "ws_per_48", "OBPM": "obpm", "DBPM": "dbpm",
    "BPM": "bpm", "VORP": "vorp", "PER": "per",
    "MP": "mp", "G": "g", "PTS": "pts", "TRB": "trb", "AST": "ast",
    "STL": "stl", "BLK": "blk", "TOV": "tov",
    "FG%": "fg_pct", "3P%": "threep_pct", "FT%": "ft_pct",
    "Awards": "awards", "Player": "player", "Tm": "team", "Team": "team",
    "Age": "age", "Pos": "pos", "Rk": "rk",
}


def clean_columns(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [c[-1] for c in df.columns]
    df = df.copy()
    df.columns = [str(c).strip() for c in df.columns]
    df = df.rename(columns={c: RENAME_MAP.get(c, c) for c in df.columns})
    return df


def read_tables(html: str) -> List[pd.DataFrame]:
    html = uncomment_tables(html)
    tables = pd.read_html(StringIO(html))
    return [clean_columns(t) for t in tables]


def find_table(tables: List[pd.DataFrame], required: List[str]) -> Optional[pd.DataFrame]:
    for t in tables:
        if all(c in t.columns for c in required):
            return t.copy()
    return None


def drop_header_rows(df: pd.DataFrame) -> pd.DataFrame:
    if "player" in df.columns:
        df = df[df["player"].astype(str) != "Player"]
    if "team" in df.columns:
        df = df[df["team"].astype(str) != "Tm"]
    return df.copy()


def collapse_traded(df: pd.DataFrame) -> pd.DataFrame:
    """
    One row per player: prefer the season-total row (TOT/2TM/3TM...),
    else the row with the most minutes.
    """
    df = df.copy()
    df["player_clean"] = df["player"].apply(clean_player_name)
    df["mp"] = num(df, "mp")
    total_tokens = {"TOT", "2TM", "3TM", "4TM", "5TM"}

    out = []
    for _, grp in df.groupby("player_clean", sort=False):
        if "team" in grp.columns:
            tot = grp[grp["team"].astype(str).isin(total_tokens)]
        else:
            tot = grp.iloc[0:0]
        if len(tot):
            row = tot.iloc[0]
        else:
            row = grp.sort_values("mp", ascending=False).iloc[0]
        out.append(row)
    return pd.DataFrame(out).reset_index(drop=True)


PER100_KEEP = ["player_clean", "pts", "trb", "ast", "stl", "blk", "tov",
               "fg_pct", "threep_pct", "ft_pct"]
ADV_REQUIRED = ["player", "g", "mp", "per", "ts_pct", "usg_pct",
                "ws_per_48", "bpm", "vorp"]
PER100_REQUIRED = ["player", "g", "mp", "pts", "trb", "ast", "stl", "blk", "tov"]


def parse_player_season(html_adv: Optional[str], html_per100: Optional[str],
                        season_end: int, is_playoffs: bool) -> pd.DataFrame:
    if not html_adv or not html_per100:
        return pd.DataFrame()

    adv = find_table(read_tables(html_adv), ADV_REQUIRED)
    per100 = find_table(read_tables(html_per100), PER100_REQUIRED)
    if adv is None or per100 is None:
        return pd.DataFrame()

    adv = drop_header_rows(adv)
    per100 = drop_header_rows(per100)
    adv["player"] = adv["player"].apply(clean_player_name)
    per100["player"] = per100["player"].apply(clean_player_name)

    adv = safe_numeric(adv, exclude=["player", "team", "pos", "awards"])
    per100 = safe_numeric(per100, exclude=["player", "team", "pos"])

    adv = collapse_traded(adv)
    per100 = collapse_traded(per100)

    keep = [c for c in PER100_KEEP if c in per100.columns]
    merged = adv.merge(per100[keep], on="player_clean", how="left",
                       suffixes=("", "_p100"))

    merged["player"] = merged["player"].apply(clean_player_name)
    merged["season_end"] = season_end
    merged["season_start"] = season_end - 1
    merged["season"] = f"{season_end - 1}-{str(season_end)[-2:]}"
    merged["is_playoffs"] = is_playoffs
    return merged


WANTED_TEAM_STATS = {
    "wins": "team_wins", "losses": "team_losses", "srs": "team_srs",
    "net_rtg": "team_net_rtg", "off_rtg": "team_ortg", "def_rtg": "team_drtg",
}


def parse_team_ratings(html: Optional[str], season_end: int) -> pd.DataFrame:
    if not html or BeautifulSoup is None:
        return pd.DataFrame()
    soup = BeautifulSoup(uncomment_tables(html), "lxml")
    per_team: Dict[str, Dict[str, float]] = {}

    for table in soup.find_all("table"):
        for tr in table.select("tbody tr"):
            link = tr.find("a", href=re.compile(r"/teams/[A-Z]{3}/"))
            if link is None:
                continue
            m = re.search(r"/teams/([A-Z]{3})/", link.get("href", ""))
            if not m:
                continue
            team = m.group(1)
            rec = per_team.setdefault(team, {})
            for stat, out_col in WANTED_TEAM_STATS.items():
                cell = tr.find(attrs={"data-stat": stat})
                if cell is not None:
                    val = pd.to_numeric(cell.get_text(strip=True), errors="coerce")
                    if pd.notna(val) and out_col not in rec:
                        rec[out_col] = float(val)

    if not per_team:
        return pd.DataFrame()
    rows = [{"season_end": season_end, "team": t, **vals}
            for t, vals in per_team.items()]
    return pd.DataFrame(rows)


def build_dataset(start: int, end: int, *, scrape: bool, refresh: bool
                  ) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Build (regular, playoffs, teams) from cached HTML, downloading as needed."""
    reg_frames, po_frames, team_frames = [], [], []
    missing_seasons = []

    for se in range(start, end + 1):
        label = f"{se - 1}-{str(se)[-2:]}"
        adv = fetch_html(f"{BREF_BASE}/leagues/NBA_{se}_advanced.html",
                         f"NBA_{se}_advanced.html", scrape=scrape, refresh=refresh)
        p100 = fetch_html(f"{BREF_BASE}/leagues/NBA_{se}_per_poss.html",
                          f"NBA_{se}_per_poss.html", scrape=scrape, refresh=refresh)
        reg = parse_player_season(adv, p100, se, is_playoffs=False)
        if len(reg):
            reg_frames.append(reg)
        else:
            missing_seasons.append(label)

        po_adv = fetch_html(f"{BREF_BASE}/playoffs/NBA_{se}_advanced.html",
                            f"NBA_{se}_playoffs_advanced.html",
                            scrape=scrape, refresh=refresh)
        po_p100 = fetch_html(f"{BREF_BASE}/playoffs/NBA_{se}_per_poss.html",
                             f"NBA_{se}_playoffs_per_poss.html",
                             scrape=scrape, refresh=refresh)
        po = parse_player_season(po_adv, po_p100, se, is_playoffs=True)
        if len(po):
            po_frames.append(po)

        summ = fetch_html(f"{BREF_BASE}/leagues/NBA_{se}.html",
                          f"NBA_{se}_league_summary.html",
                          scrape=scrape, refresh=refresh)
        tm = parse_team_ratings(summ, se)
        if len(tm):
            team_frames.append(tm)

    if not reg_frames:
        raise RuntimeError(
            "No regular-season data could be built. Run without --no-scrape, "
            "or check your network / cache.")

    regular = pd.concat(reg_frames, ignore_index=True)
    playoffs = pd.concat(po_frames, ignore_index=True) if po_frames else pd.DataFrame()
    teams = pd.concat(team_frames, ignore_index=True) if team_frames else pd.DataFrame()

    if missing_seasons:
        print(f"  ! no regular-season data for: {', '.join(missing_seasons)}")
    return regular, playoffs, teams


# ======================================================================
# DERIVED COLUMNS + OPTIONAL DATA
# ======================================================================

def add_derived(df: pd.DataFrame) -> pd.DataFrame:
    if not len(df):
        return df
    df = df.copy()
    df["stocks"] = num(df, "stl").fillna(0) + num(df, "blk").fillna(0)
    ftr = num(df, "ftr")
    ftpct = num(df, "ft_pct")
    df["ft_value"] = ftr * ftpct if "ftr" in df.columns else np.nan
    # ---- workload / role / total-value derived inputs ----
    g = num(df, "g")
    mp = num(df, "mp")
    df["mpg"] = mp / g.replace(0, np.nan)
    df["games_frac"] = g / df["season_end"].map(team_games)
    # total Win Shares (cumulative value), if present in the source table
    df["total_ws"] = num(df, "WS") if "WS" in df.columns else np.nan
    # per-75-possession scoring (same ordering as per-100; used for display)
    df["pts_per75"] = num(df, "pts") * 0.75
    df["ast_per75"] = num(df, "ast") * 0.75
    # Total scoring LOAD (proportional to season total points): rate x minutes.
    # This is what separates a high-volume scorer from a part-time finisher,
    # instead of raw per-100 which over-credits low-minute rim-runners.
    df["scoring_load"] = num(df, "pts") * mp / 1000.0
    df["playmaking_load"] = num(df, "ast") * mp / 1000.0
    # creation/ball-handling burden proxy (NOT usage alone)
    df["creation"] = num(df, "usg_pct").fillna(0) + 0.45 * num(df, "ast_pct").fillna(0)
    # Preserve the RAW assist percentage under a non-colliding name: native-value
    # scoring later writes the AST/100 native score into the `ast_pct` column (a
    # legacy collision relied upon by REG_PLAYMAKING), so `ast_pct` no longer holds
    # the raw AST% after scoring. `ast_pct_raw` keeps the true AST% for reporting.
    df["ast_pct_raw"] = num(df, "ast_pct")
    return df


def add_relative_efficiency(df: pd.DataFrame) -> pd.DataFrame:
    """Season-relative true shooting: TS+ (ratio*100) and r_ts (difference)."""
    if not len(df):
        return df
    df = df.copy()
    df["ts_plus"] = np.nan
    df["r_ts"] = np.nan
    mp = num(df, "mp")
    ts = num(df, "ts_pct")
    for se, grp in df.groupby("season_end"):
        thr = regular_minutes_threshold(se) if not df["is_playoffs"].iloc[0] else MIN_PLAYOFF_MINUTES
        qmask = grp.index[mp.loc[grp.index] >= thr]
        league_ts = ts.loc[qmask].mean()
        if pd.isna(league_ts) or league_ts == 0:
            league_ts = ts.loc[grp.index].mean()
        if pd.isna(league_ts) or league_ts == 0:
            continue
        idx = grp.index
        df.loc[idx, "ts_plus"] = ts.loc[idx] / league_ts * 100.0
        df.loc[idx, "r_ts"] = (ts.loc[idx] - league_ts) * 100.0
    return df


def load_optional(path: Path) -> pd.DataFrame:
    if path.exists():
        try:
            return pd.read_csv(path)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! could not read {path}: {exc}")
    return pd.DataFrame()


OPTIONAL_CONTEXT_COLS = [
    "finals_mvp", "championship", "best_player_title", "finals_appearance",
    "conf_finals", "playoff_round_score", "opponent_quality_score",
    "teammate_penalty",
]
OPTIONAL_IMPACT_COLS = ["epm", "lebron", "raptor", "darko", "rapm"]
OPTIONAL_TITLE_COLS = ["scoring_title", "assist_title", "rebound_title",
                       "steals_title", "blocks_title", "fifty_forty_ninety"]


GENERATED_CONTEXT_PATH = DATA_DIR / "generated" / "player_season_context.parquet"


def _apply_override(regular: pd.DataFrame, override: pd.DataFrame,
                    cols: List[str], label: str, debug: bool = False) -> pd.DataFrame:
    """
    Merge an override frame; where it supplies a non-null value, it WINS over
    the existing (automatic/derived) value. Differences are reported, never
    silently dropped.
    """
    override = override.copy()
    override["player"] = override["player"].apply(clean_player_name)
    merged = regular.merge(override, on=["player", "season_end"], how="left",
                           suffixes=("", "_ovr"))
    n_diffs = 0
    for c in cols:
        ovr = f"{c}_ovr" if f"{c}_ovr" in merged.columns else (
            c if c in override.columns and c not in regular.columns else None)
        if ovr is None:
            continue
        ov = merged[ovr]
        if c in merged.columns and ovr != c:
            base = merged[c]
            mask = ov.notna()
            diff = mask & (base.astype(str) != ov.astype(str)) & base.notna()
            n_diffs += int(diff.sum())
            if debug and diff.any():
                for _, r in merged[diff].iterrows():
                    print(f"  [override:{label}] {r['player']} {int(r['season_end'])}: "
                          f"{c} {r[c]} -> {r[ovr]}")
            merged[c] = ov.where(mask, base)
            merged = merged.drop(columns=[ovr])
        else:
            merged = merged.rename(columns={ovr: c})
    if n_diffs:
        print(f"  applied {n_diffs} manual override value(s) from {label}")
    return merged


def merge_optional(regular: pd.DataFrame, context: Optional[pd.DataFrame] = None,
                   debug: bool = False) -> Tuple[pd.DataFrame, Dict[str, bool]]:
    """
    Merge precedence (highest first):
      1. manual override CSV (explicit, non-null)
      2. generated automatic context (high-confidence structured data)
      3. neutral fallback
    """
    regular = regular.copy()
    flags = {"manual_context": False, "external_impact": False,
             "stat_titles": False, "auto_context": False}

    # ---- modern impact (optional) ----
    ext = load_optional(DATA_DIR / "external_impact.csv")
    if len(ext):
        ext["player"] = ext["player"].apply(clean_player_name)
        regular = regular.merge(ext, on=["player", "season_end"], how="left")
        flags["external_impact"] = True
    for c in OPTIONAL_IMPACT_COLS:
        if c not in regular.columns:
            regular[c] = np.nan

    # ---- automatic generated context (layer 2) ----
    if context is None and GENERATED_CONTEXT_PATH.exists():
        try:
            context = pd.read_parquet(GENERATED_CONTEXT_PATH)
        except Exception:
            context = None
    if context is not None and len(context):
        ctx = context.copy()
        ctx["player"] = ctx["player"].apply(clean_player_name)
        # drop overlapping non-key columns so context fields populate cleanly
        dup = [c for c in ctx.columns
               if c in regular.columns and c not in ("player", "season_end")]
        if dup:
            ctx = ctx.drop(columns=dup)
        regular = regular.merge(ctx, on=["player", "season_end"], how="left")
        flags["auto_context"] = True

    # ---- manual override (layer 1, highest precedence) ----
    man = load_optional(DATA_DIR / "manual_context.csv")
    if len(man):
        regular = _apply_override(regular, man, OPTIONAL_CONTEXT_COLS,
                                  "manual_context.csv", debug=debug)
        flags["manual_context"] = True
    for c in OPTIONAL_CONTEXT_COLS:
        if c not in regular.columns:
            regular[c] = np.nan

    titles = load_optional(DATA_DIR / "stat_titles.csv")
    if len(titles):
        regular = _apply_override(regular, titles, OPTIONAL_TITLE_COLS,
                                  "stat_titles.csv", debug=debug)
        flags["stat_titles"] = True
    for c in OPTIONAL_TITLE_COLS:
        if c not in regular.columns:
            regular[c] = np.nan

    # ---- canonical COMPLETED data (actual team shares + real award votes) ----
    regular = _merge_completed_data(regular, flags, debug=debug)

    return regular, flags


# Canonical completed-data files (built deterministically by --rebuild-data).
TEAM_SHARES_PATH = DATA_DIR / "generated" / "team_shares.csv"
MVP_VOTES_PATH = DATA_DIR / "generated" / "mvp_votes.csv"
DPOY_VOTES_PATH = DATA_DIR / "generated" / "dpoy_votes.csv"


def _merge_completed_data(regular: pd.DataFrame, flags: Dict[str, bool],
                          debug: bool = False) -> pd.DataFrame:
    """Merge the canonical team-share and real MVP/DPOY vote datasets and set the
    explicit per-field data-status columns. Missing data is NEVER treated as zero:
    a missing vote share falls back to the smooth placement curve, and a missing
    team share falls back to the flagged USG%/AST% proxy."""
    regular = regular.copy()
    flags.setdefault("team_shares", False)
    flags.setdefault("mvp_votes", False)
    flags.setdefault("dpoy_votes", False)

    # --- actual team scoring / assist shares (replaces USG%/AST% proxies) ---
    # drop any pre-existing (legacy/placeholder) columns so the canonical data
    # populate the real column name instead of colliding into _x/_y suffixes.
    regular = regular.drop(columns=[c for c in (
        "team_scoring_share", "team_assist_share", "n_teams")
        if c in regular.columns])
    if TEAM_SHARES_PATH.exists():
        ts = pd.read_csv(TEAM_SHARES_PATH)
        ts["player"] = ts["player_clean"].apply(clean_player_name)
        keep = ts[["player", "season_end", "team_scoring_share",
                   "team_assist_share", "n_teams"]]
        regular = regular.merge(keep, on=["player", "season_end"], how="left")
        flags["team_shares"] = True
    for c in ("team_scoring_share", "team_assist_share", "n_teams"):
        if c not in regular.columns:
            regular[c] = np.nan
    has_share = regular["team_scoring_share"].notna()
    regular["team_share_data_status"] = np.where(has_share, "observed", "fallback")

    # --- real MVP / DPOY vote share (empty -> placement fallback, NOT zero) ---
    def _merge_votes(path, finish_col, share_out, exists_key):
        nonlocal regular
        # drop legacy/placeholder column so the real share isn't suffixed away
        if share_out in regular.columns:
            regular = regular.drop(columns=[share_out])
        if path.exists():
            v = pd.read_csv(path)
            v["player"] = v["player_clean"].apply(clean_player_name)
            sub = v[["player", "season_end", "vote_share"]].rename(
                columns={"vote_share": share_out})
            # one row per player-season (guard against any dup)
            sub = sub.drop_duplicates(["player", "season_end"])
            regular = regular.merge(sub, on=["player", "season_end"], how="left")
            flags[exists_key] = True
        if share_out not in regular.columns:
            regular[share_out] = np.nan

    _merge_votes(MVP_VOTES_PATH, "mvp_finish", "mvp_vote_share", "mvp_votes")
    _merge_votes(DPOY_VOTES_PATH, "dpoy_finish", "dpoy_vote_share", "dpoy_votes")

    # status fields: observed (real share used) / fallback (ranked but no share,
    # placement curve used) / none (not in the voting => no recognition value).
    mvp_ranked = regular["awards"].apply(
        lambda a: award_rank(a, "MVP") is not None) if "awards" in regular else False
    dpoy_ranked = regular["awards"].apply(
        lambda a: award_rank(a, "DPOY") is not None) if "awards" in regular else False
    regular["mvp_vote_data_status"] = np.select(
        [regular["mvp_vote_share"].notna(), mvp_ranked],
        ["observed", "fallback"], default="none")
    regular["dpoy_vote_data_status"] = np.select(
        [regular["dpoy_vote_share"].notna(), dpoy_ranked],
        ["observed", "fallback"], default="none")
    # burden uses actual team shares when present, else the flagged proxy.
    regular["burden_data_status"] = np.where(has_share, "observed", "proxy_fallback")

    if debug:
        print(f"  [completed] team-share observed: {int(has_share.sum())}/"
              f"{len(regular)}; mvp real share: "
              f"{int(regular['mvp_vote_share'].notna().sum())}; dpoy real share: "
              f"{int(regular['dpoy_vote_share'].notna().sum())}")
    return regular


# ======================================================================
# ERA-RELATIVE PERCENTILES (vectorized)
# ======================================================================

# ===========================================================================
# NATIVE-VALUE-FIRST SCORING
# Each major metric maps from its NATIVE basketball units (documented
# landmarks) to a 0-100 native score, blended with a small bounded era-context
# term (within-season z through a SOFT tail). The native landmarks carry the
# basketball meaning; the era term only adjusts for league pace/inflation.
# Distributional/role metrics with no clean native landmarks fall back to the
# soft era-z term. Percentiles are stored separately as `{metric}_percentile`
# for DESCRIPTIVE reporting only and never enter the official score.
# NOTE: the official native-value score is written to `{metric}_pct` columns,
# kept as a legacy alias to avoid a risky mass rename of every weight dict;
# despite the name it is a native-value score, NOT a percentile (see the FORMULA
# section of METHODOLOGY.md).
# ===========================================================================
NORMALIZATION_MODE = "native"        # native landmarks + soft era context
EMERGENCY_Z_CAP = 8.0                # corrupt-data guard only (well beyond NBA)
ERA_CONTEXT_WEIGHT = 0.20            # native 80% / era-context 20% for native metrics
_SOFT_THRESHOLD = 2.5                # linear below this z; log-soft tail above

# Native landmark maps: metric -> (raw_values, native_scores). Documented
# basketball meaning; np.interp between landmarks, flat extrapolation beyond.
NATIVE_LANDMARKS: Dict[str, Tuple[List[float], List[float]]] = {
    # ---- advanced impact (rate) ----
    "bpm":       ([-6, -3, -1, 0, 3, 6, 9, 12, 15],   [5, 22, 40, 48, 62, 76, 88, 96, 100]),
    "obpm":      ([-4, -1, 0, 2, 5, 8, 11, 14],       [15, 38, 48, 60, 75, 87, 96, 100]),
    "dbpm":      ([-4, -2, -1, 0, 1.5, 3, 5, 7],      [12, 30, 42, 50, 63, 77, 92, 100]),
    "ws_per_48": ([0, .05, .10, .15, .20, .25, .30, .35], [8, 26, 45, 60, 74, 86, 95, 100]),
    "per":       ([8, 12, 15, 18, 22, 26, 30, 34, 38], [12, 30, 46, 58, 70, 83, 93, 99, 100]),
    # ---- advanced impact (total value) ----
    "vorp":      ([-2, -.5, 0, 1, 3, 5, 7, 9, 12],    [10, 35, 45, 55, 68, 80, 90, 97, 100]),
    "total_ws":  ([0, 3, 6, 9, 12, 15, 18, 21],       [15, 35, 52, 66, 78, 88, 96, 100]),
    # ---- scoring (per-100; converted from per-game by source) ----
    "pts":       ([10, 16, 20, 24, 28, 32, 36, 40, 44], [15, 32, 46, 58, 70, 82, 91, 98, 100]),
    "scoring_load": ([15, 30, 45, 60, 75, 90, 105, 120], [20, 40, 55, 68, 80, 90, 97, 100]),
    # ---- efficiency ----
    "ts_plus":   ([85, 92, 97, 100, 104, 108, 113, 118, 124], [10, 30, 42, 50, 62, 74, 87, 96, 100]),
    "r_ts":      ([-10, -5, -2, 0, 3, 6, 9, 12, 16],  [12, 30, 42, 50, 62, 75, 87, 96, 100]),
    # ---- playmaking / rebounding (per-100) ----
    "ast":       ([1, 3, 5, 7, 9, 11, 13, 15],        [22, 38, 52, 66, 78, 88, 96, 100]),
    "playmaking_load": ([3, 8, 14, 20, 26, 32, 40],   [25, 42, 58, 72, 84, 94, 100]),
    "trb":       ([2, 5, 8, 11, 14, 17, 20, 24],      [20, 38, 52, 65, 77, 88, 96, 100]),
    "stocks":    ([0.5, 1.5, 2.5, 3.5, 4.5, 6, 8],    [22, 40, 56, 70, 82, 93, 100]),
}


def soft_z_to_score(z) -> np.ndarray:
    """
    Continuous z -> 0-100 with a SOFT (log) upper/lower tail: no hard clip, so a
    z=5.3 season is NOT identical to z=4.5. Linear core (|z|<=2.5), diminishing
    log tail beyond. Emergency cap only at +/-8 SD (corrupt-data guard).
    """
    z = np.clip(np.asarray(z, dtype=float), -EMERGENCY_Z_CAP, EMERGENCY_Z_CAP)
    thr = _SOFT_THRESHOLD
    core = 50.0 + 13.6 * z                      # z=2.5 -> 84
    hi = 84.0 + 9.0 * np.log1p(np.clip(z - thr, 0, None))
    lo = 16.0 - 9.0 * np.log1p(np.clip(-z - thr, 0, None))
    out = np.where(z > thr, hi, np.where(z < -thr, lo, core))
    return np.clip(out, 0.0, 100.0)


def z_to_score(z) -> np.ndarray:
    """Back-compat shim: now the soft-tail transform (no hard clip)."""
    return soft_z_to_score(z)


def native_value_score(metric: str, x: np.ndarray) -> Optional[np.ndarray]:
    """
    Native landmark score with MONOTONIC NON-FLAT tails: within the landmark
    range use piecewise interpolation; BEYOND the top landmark continue rising
    with a diminishing log tail (so BPM 12/15/18 differ, VORP 9/12/14 differ);
    below the bottom landmark continue falling linearly. No materially different
    realistic value maps to an identical score.
    """
    spec = NATIVE_LANDMARKS.get(metric)
    if spec is None:
        return None
    xp = np.asarray(spec[0], dtype=float)
    fp = np.asarray(spec[1], dtype=float)
    x = np.asarray(x, dtype=float)
    out = np.interp(x, xp, fp)                    # interior
    # upper tail: continue beyond the final landmark with diminishing returns
    top_slope = (fp[-1] - fp[-2]) / (xp[-1] - xp[-2])
    hi = x > xp[-1]
    out = np.where(hi, fp[-1] + top_slope * (xp[-1] - xp[-2]) *
                   np.log1p(np.clip(x - xp[-1], 0, None) / (xp[-1] - xp[-2])), out)
    # lower tail: continue below the first landmark linearly (can go < 0)
    low_slope = (fp[1] - fp[0]) / (xp[1] - xp[0])
    lo = x < xp[0]
    out = np.where(lo, fp[0] + low_slope * (x - xp[0]), out)
    return np.where(np.isnan(x), np.nan, out)


def add_percentiles(df: pd.DataFrame, metrics: List[str], qualifier: pd.Series,
                    inverse: Optional[List[str]] = None, prefix: str = "",
                    mode: Optional[str] = None) -> pd.DataFrame:
    """
    Native-value-first metric scoring. For each metric:
      * `{prefix}{metric}_pct`        = OFFICIAL native-value score (native
                                        landmarks blended with a small soft
                                        era-context term; legacy column name).
      * `{prefix}{metric}_percentile` = descriptive empirical percentile only.
    Metrics with native landmarks use 80% native + 20% soft era context; other
    (distributional/role) metrics use the soft era-z term. Lower-is-better
    metrics in `inverse` are flipped.
    """
    inverse = set(inverse or [])
    mode = mode or NORMALIZATION_MODE
    df = df.copy()
    for metric in metrics:
        out = f"{prefix}{metric}_pct"
        pctl_col = f"{prefix}{metric}_percentile"
        df[out] = np.nan
        df[pctl_col] = np.nan
        if metric not in df.columns:
            continue
        vals_all = pd.to_numeric(df[metric], errors="coerce")
        for se, idx in df.groupby("season_end").groups.items():
            idx = list(idx)
            qidx = [i for i in idx if bool(qualifier.get(i, False))]
            qvals = vals_all.loc[qidx].dropna()
            dist = qvals.sort_values().to_numpy()
            if dist.size == 0:
                continue
            x = vals_all.loc[idx].to_numpy(dtype=float)
            # descriptive percentile (never used in scoring)
            pctl = np.searchsorted(dist, x, side="right") / dist.size * 100.0
            df.loc[idx, pctl_col] = np.where(np.isnan(x), np.nan, pctl)
            if mode == "percentile":
                score = np.where(np.isnan(x), np.nan, pctl)
                if metric in inverse:
                    score = 100.0 - score
                df.loc[idx, out] = score
                continue
            # era-context z (soft tail)
            mu, sd = qvals.mean(), qvals.std(ddof=0)
            if not sd or pd.isna(sd) or dist.size < 3:
                era = np.where(np.isnan(x), np.nan, pctl)
            else:
                z = (x - mu) / sd
                if metric in inverse:
                    z = -z
                era = soft_z_to_score(z)
            native = native_value_score(metric, x)
            if native is not None:
                if metric in inverse:          # native landmarks assume higher=better
                    native = 100.0 - native
                score = (1 - ERA_CONTEXT_WEIGHT) * native + ERA_CONTEXT_WEIGHT * era
            else:
                score = era
            score = np.where(np.isnan(x), np.nan, score)
            df.loc[idx, out] = score
    return df


def add_zscores(df: pd.DataFrame, metrics: List[str], qualifier: pd.Series,
                cap: float = 3.0, prefix: str = "") -> pd.DataFrame:
    """
    Add `{prefix}{metric}_z` = capped z-score of the value within that season's
    QUALIFIER distribution. Caps avoid tiny-sample blowups. Used for the
    volume-efficiency interaction and the hybrid normalization mode.
    """
    df = df.copy()
    for metric in metrics:
        out = f"{prefix}{metric}_z"
        df[out] = np.nan
        if metric not in df.columns:
            continue
        vals_all = pd.to_numeric(df[metric], errors="coerce")
        for se, idx in df.groupby("season_end").groups.items():
            idx = list(idx)
            qidx = [i for i in idx if bool(qualifier.get(i, False))]
            dist = vals_all.loc[qidx].dropna()
            if len(dist) < 2:
                continue
            mu, sd = dist.mean(), dist.std(ddof=0)
            if not sd or pd.isna(sd):
                continue
            z = (vals_all.loc[idx] - mu) / sd
            df.loc[idx, out] = z.clip(-cap, cap)
    return df


def zscore_to_score(z, cap: float = 3.0):
    """DEPRECATED: now routes to the soft-tail transform (no hard z=3 clip).
    Retained only so the volume-efficiency interaction stays continuous."""
    arr = soft_z_to_score(np.asarray(z, dtype=float))
    return pd.Series(arr, index=z.index) if hasattr(z, "index") else arr


def wavail(df: pd.DataFrame, weights: Dict[str, float]) -> pd.Series:
    """
    Weighted-available average of percentile columns.  Missing columns are
    skipped and weights renormalized; if nothing is available -> neutral 50.
    """
    cols = [c for c in weights if c in df.columns]
    if not cols:
        return pd.Series(50.0, index=df.index)
    W = np.array([weights[c] for c in cols], dtype=float)
    M = df[cols].to_numpy(dtype=float)
    mask = ~np.isnan(M)
    num_ = np.where(mask, M * W, 0.0).sum(axis=1)
    den = (mask * W).sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(den > 0, num_ / np.where(den > 0, den, 1.0), 50.0)
    return pd.Series(out, index=df.index)


# ======================================================================
# ACCOLADES (Basketball Reference Awards column + optional context)
# ======================================================================

def award_rank(awards, code: str) -> Optional[int]:
    if pd.isna(awards):
        return None
    m = re.search(rf"{code}-(\d+)", str(awards))
    return int(m.group(1)) if m else None


def has_token(awards, token: str) -> bool:
    if pd.isna(awards):
        return False
    return token in re.split(r",\s*", str(awards))


def mvp_points(awards) -> float:
    r = award_rank(awards, "MVP")
    if r is None:
        return 0.0
    return {1: 100, 2: 75, 3: 62, 4: 48, 5: 48}.get(r, 30 if r <= 10 else 12)


def all_nba_points(awards) -> float:
    if has_token(awards, "NBA1"):
        return 100.0
    if has_token(awards, "NBA2"):
        return 70.0
    if has_token(awards, "NBA3"):
        return 45.0
    return 0.0


def defense_points(awards) -> float:
    best = 0.0
    if has_token(awards, "DEF1"):
        best = 100.0
    elif has_token(awards, "DEF2"):
        best = 65.0
    r = award_rank(awards, "DPOY")
    if r is not None:
        best = max(best, {1: 100, 2: 65, 3: 50}.get(r, 35 if r <= 5 else 15))
    return best


def ranked_award_value(rank, share, *, winner_premium: float, curve_base: float,
                       decay: float, share_scale: float,
                       stabilizer: float) -> float:
    """SMOOTH award-voting recognition for a RANKED voting award (MVP, DPOY).

    Replaces arbitrary placement buckets (which created second-to-fourth cliffs)
    with three transparent pieces:

        award_voting_value = winner_premium                 (only the actual winner)
                           + continuous_vote_share_value    (primary signal; smooth)
                           + small_nonwinner_placement_stabilizer

    * The WINNER PREMIUM is a clear categorical reward for actually winning, so
      first place clearly exceeds second.
    * The CONTINUOUS value is real vote share when reliably available (the primary
      signal); when vote-share data are missing it falls back to a DOCUMENTED
      smooth exponential pseudo-share over placement, so second through tenth
      decline smoothly with NO arbitrary cliff (a fourth-place finish is not
      penalized relative to second/third beyond the smooth curve).
    * A small smooth STABILIZER adds a little placement weight even when vote share
      is present, and never introduces a cliff.

    rank: 1-based placement (None -> 0); share: vote share in [0, 1] or NaN.
    """
    if rank is None or (isinstance(rank, float) and pd.isna(rank)):
        return 0.0
    rank = int(rank)
    if rank < 1:
        return 0.0
    value = winner_premium if rank == 1 else 0.0
    sh = pd.to_numeric(share, errors="coerce")
    if pd.notna(sh):
        # primary continuous signal: actual vote share
        value += share_scale * float(np.clip(sh, 0.0, 1.0))
    else:
        # documented placement FALLBACK: smooth exponential pseudo-share
        value += curve_base * float(np.exp(-decay * (rank - 1)))
    # small smooth non-winner placement stabilizer (no cliffs)
    value += stabilizer * float(np.exp(-decay * (rank - 1)))
    return value


# Smooth award-voting parameters (winner premium + continuous curve + stabilizer).
# Chosen so first place clearly exceeds second, ranks 2..10 decline smoothly, and
# the magnitudes match the prior top-of-scale (a unanimous-style MVP ~ 58).
MVP_VOTING = dict(winner_premium=22.0, curve_base=34.0, decay=0.19,
                  share_scale=42.0, stabilizer=2.0)
DPOY_VOTING = dict(winner_premium=14.0, curve_base=20.0, decay=0.24,
                   share_scale=28.0, stabilizer=1.0)


# Statistical-leadership weights (a scoring title is worth far more than a
# blocks title; 50-40-90 is a marquee individual feat).
TITLE_WEIGHTS = {"scoring_title": 46.0, "assist_title": 30.0,
                 "rebound_title": 24.0, "steals_title": 22.0,
                 "blocks_title": 18.0, "fifty_forty_ninety": 34.0}


def title_points(row: pd.Series) -> float:
    total = 0.0
    for c, w in TITLE_WEIGHTS.items():
        if c in row.index and pd.notna(row.get(c)) and float(row.get(c) or 0) >= 1:
            total += w
    return clamp(total)


def accolade_row(row: pd.Series) -> Dict[str, float]:
    awards = row.get("awards", "")
    mvp = mvp_points(awards)
    nba = all_nba_points(awards)
    dfn = defense_points(awards)

    finals_mvp = 100.0 if float(row.get("finals_mvp") or 0) == 1 else 0.0
    if float(row.get("best_player_title") or 0) == 1:
        champ = 100.0
    elif float(row.get("championship") or 0) == 1:
        champ = 65.0
    elif float(row.get("finals_appearance") or 0) == 1:
        champ = 45.0
    elif float(row.get("conf_finals") or 0) == 1:
        champ = 25.0
    else:
        champ = 0.0
    misc = title_points(row)

    accolade = (0.34 * mvp + 0.18 * finals_mvp + 0.16 * nba +
                0.12 * dfn + 0.12 * champ + 0.08 * misc)
    return {
        "accolade": clamp(accolade),
        "mvp_component": clamp(mvp),
        "finals_mvp_component": clamp(finals_mvp),
        "all_nba_component": clamp(nba),
        "defense_component": clamp(dfn),
        "championship_component": clamp(champ),
        "titles_component": clamp(misc),
    }


# Unanimous MVP is an objective award record (loaded from data/unanimous_mvp.csv;
# the only unanimous MVP in NBA history is Stephen Curry, 2015-16). It is award
# DATA, not a score override, and adds only a small recognition bonus.
def _load_unanimous_mvp() -> set:
    p = DATA_DIR / "unanimous_mvp.csv"
    if p.exists():
        try:
            df = pd.read_csv(p)
            return {(clean_player_name(r["player"]), int(r["season_end"]))
                    for _, r in df.iterrows()}
        except Exception:
            return set()
    return set()


UNANIMOUS_MVP = _load_unanimous_mvp()


# Statistical-leadership ADDITIVE recognition values (a scoring title is a far
# bigger individual feat than a blocks title; 50-40-90 is marquee).
TITLE_RECOG = {"scoring_title": 12.0, "fifty_forty_ninety": 14.0,
               "assist_title": 9.0, "rebound_title": 7.0,
               "steals_title": 6.0, "blocks_title": 5.0}


def _title_recognition(row: pd.Series) -> float:
    total = 0.0
    for c, w in TITLE_RECOG.items():
        if c in row.index and pd.notna(row.get(c)) and float(row.get(c) or 0) >= 1:
            total += w
    return total


RECOGNITION_SCALE = 0.80   # additive award value -> ~0..115 component magnitude


def recognition_breakdown(row: pd.Series) -> Dict[str, float]:
    """Pure decomposition of INDIVIDUAL recognition into its grouped, overlap-
    discounted sub-values (all PRE the RECOGNITION_SCALE multiply). This is the
    single source of truth for the recognition formula; recognition_row() and the
    audit both consume it, so the numbers can never drift. NO championship / team
    result enters here (championships live in Team Achievement); the only
    postseason-linked term is the individual Finals MVP award."""
    awards = row.get("awards", "")
    mvp_r = award_rank(awards, "MVP")
    # Smooth award-voting value: winner premium + continuous vote-share (with a
    # documented smooth placement fallback) + small stabilizer. No buckets/cliffs.
    mvp = ranked_award_value(mvp_r, row.get("mvp_vote_share"), **MVP_VOTING)
    # unanimous MVP (objective record) -> small extra
    unanimous = 0.0
    try:
        if (clean_player_name(row.get("player")), int(row.get("season_end"))) \
                in UNANIMOUS_MVP and mvp_r == 1:
            unanimous = 8.0
    except Exception:
        pass

    # All-NBA, grouped with MVP (overlap discount for a top-3 MVP finisher).
    if has_token(awards, "NBA1"):
        anba = 30.0
    elif has_token(awards, "NBA2"):
        anba = 20.0
    elif has_token(awards, "NBA3"):
        anba = 12.0
    else:
        anba = 0.0
    if mvp_r is not None and mvp_r <= 3:
        anba *= 0.45                       # grouped: don't double-count
    # All-Star is subsumed by All-NBA (only counts on its own otherwise).
    allstar = 0.0 if anba > 0 else (8.0 if has_token(awards, "AS") else 0.0)

    # Defense group: DPOY rank (smooth voting value) grouped with All-Defense.
    dpoy_r = award_rank(awards, "DPOY")
    dpoy = ranked_award_value(dpoy_r, row.get("dpoy_vote_share"), **DPOY_VOTING)
    if has_token(awards, "DEF1"):
        alldef = 16.0
    elif has_token(awards, "DEF2"):
        alldef = 9.0
    else:
        alldef = 0.0
    if dpoy_r is not None and dpoy_r <= 3:
        alldef *= 0.5                      # grouped with DPOY
    defense_rec = dpoy + alldef

    fmvp = 20.0 if float(row.get("finals_mvp") or 0) == 1 else 0.0
    titles = _title_recognition(row)
    return {"mvp": mvp, "unanimous": unanimous, "anba": anba, "allstar": allstar,
            "dpoy": dpoy, "alldef": alldef, "defense_rec": defense_rec,
            "fmvp": fmvp, "titles": titles}


def recognition_row(row: pd.Series) -> Dict[str, float]:
    """
    INDIVIDUAL recognition as ADDITIVE award values (NO championship/team
    result; championships live in Team Achievement). Overlapping awards are
    GROUPED so they do not each count as an independent full bonus:
      * MVP and All-NBA overlap  -> All-NBA is discounted when the player is a
        top-3 MVP finisher (the MVP value already implies first-team All-NBA);
      * DPOY and All-Defense overlap -> All-Defense discounted for a top-3 DPOY;
      * All-Star is subsumed by any All-NBA selection.
    Vote share (when present) adds a small continuous bonus on top of the rank.
    Statistical titles and 50-40-90 are independent feats and add separately.
    Finals MVP is individual postseason recognition. Unanimous MVP (objective
    record) adds a small extra. Output is an open additive value (~0..110).
    """
    b = recognition_breakdown(row)
    # Scale the additive award value onto the same ~0..115 magnitude as the
    # other components so the 20% weight is an honest 20% of the index (a
    # maximal MVP+DPOY+Finals-MVP+titles season tops out near ~115).
    recognition = RECOGNITION_SCALE * (b["mvp"] + b["unanimous"] + b["anba"] +
                                       b["allstar"] + b["defense_rec"] +
                                       b["fmvp"] + b["titles"])
    return {
        "recognition": clamp(recognition, 0, 120),
        "recognition_mvp": clamp(RECOGNITION_SCALE * (b["mvp"] + b["unanimous"]), 0, 75),
        "recognition_titles": clamp(RECOGNITION_SCALE * b["titles"], 0, 50),
        "unanimous_mvp": 1.0 if b["unanimous"] > 0 else 0.0,
    }


def team_achievement_row(row: pd.Series) -> float:
    """
    Team postseason achievement (3% component), attributed by the player's role
    on the team (a championship does NOT give equal credit to every player).

    ZERO BASELINE: positive value is awarded ONLY for genuine team success --
    winning a playoff series, reaching the Conference Finals, the Finals, or a
    championship. A first-round exit, or no playoffs at all, contributes EXACTLY
    zero (no `25`/`8.5`-style default). Because the component carries only a 3%
    weight (max 3.0 index points), team achievement cannot materially offset a
    large individual statistical difference.
    """
    base = _advancement_value(row)
    if base <= 0.0:
        return 0.0
    return clamp(base * _team_role_multiplier(row))


# SMOOTH, BOUNDED playoff-advancement value (0..100), based on measurable team
# results (rounds reached / series won / championship). Replaces the prior coarse
# 0/30/62/80/100 buckets with a monotonic progression; still ZERO for no playoffs
# or a first-round loss. NO Finals MVP and NO individual playoff box score here.
ADVANCEMENT_ANCHORS = {
    # playoff_round_score -> smooth advancement value
    30.0: 0.0,     # reached the first round, lost it (no series won) -> 0
    50.0: 30.0,    # won exactly one series (lost Conf Semis)
    70.0: 58.0,    # reached the Conference Finals
    85.0: 80.0,    # reached the Finals
    100.0: 100.0,  # champion
}


def _advancement_value(row: pd.Series) -> float:
    """Smooth, bounded advancement value in [0, 100] from measurable results.

    Uses explicit round flags when present (championship / Finals / Conf Finals)
    and otherwise the rounds-reached `playoff_round_score`, interpolated smoothly
    between anchors so the progression has no hard 0/50/100 cliffs. A first-round
    loss or no playoffs -> exactly 0."""
    if float(row.get("championship") or 0) == 1 or \
            float(row.get("best_player_title") or 0) == 1 or \
            float(row.get("co_best_player_title") or 0) == 1:
        return 100.0
    if float(row.get("finals_appearance") or 0) == 1:
        base = 80.0
    elif float(row.get("conf_finals") or 0) == 1:
        base = 58.0
    else:
        base = 0.0
    prs = pd.to_numeric(row.get("playoff_round_score"), errors="coerce")
    if pd.notna(prs):
        prs = float(prs)
        xs = sorted(ADVANCEMENT_ANCHORS)
        if prs <= xs[0]:
            interp = 0.0
        elif prs >= xs[-1]:
            interp = 100.0
        else:
            interp = float(np.interp(prs, xs, [ADVANCEMENT_ANCHORS[x] for x in xs]))
        base = max(base, interp)
    return base


# Role-responsibility multiplier for Team Achievement: a champion's credit is NOT
# shared equally. Distinguishes a clear primary player, a co-star, a secondary
# contributor, and a role player. Derived from explicit best/co-best flags, then
# the player's regular-season role/usage burden (data, not narrative).
TEAM_ROLE_PRIMARY = 1.0
TEAM_ROLE_COSTAR = 0.82
TEAM_ROLE_SECONDARY = 0.6
TEAM_ROLE_PLAYER = 0.34


def _team_role_multiplier(row: pd.Series) -> float:
    if float(row.get("best_player_title") or 0) == 1:
        return TEAM_ROLE_PRIMARY
    if float(row.get("co_best_player_title") or 0) == 1:
        return TEAM_ROLE_COSTAR
    # otherwise grade responsibility by CREATION burden (usage + assist share),
    # a smooth, data-driven proxy for how central the player was on BOTH scoring
    # and playmaking -- so a low-usage defensive/playmaking hub is graded as a
    # secondary contributor, not a pure role player. Bounded between role-player
    # and co-star: an unflagged contributor never out-credits a recognized
    # co-star/primary.
    creation = pd.to_numeric(row.get("creation"), errors="coerce")
    if pd.isna(creation):
        creation = pd.to_numeric(row.get("usg_pct"), errors="coerce")
        if pd.isna(creation):
            return TEAM_ROLE_SECONDARY
    frac = float(np.clip((float(creation) - 19.0) / (40.0 - 19.0), 0.0, 1.0))
    return TEAM_ROLE_PLAYER + frac * (TEAM_ROLE_COSTAR - TEAM_ROLE_PLAYER)


# ======================================================================
# SCORING (vectorized component scores + per-season totals)
# ======================================================================

# ---------------------------------------------------------------------------
# REGULAR-SEASON COMPONENTS (redesigned)
#
# Root-cause fix for role players scoring like stars:
#  * RATE impact (per-minute) is SEPARATED from TOTAL impact (cumulative value)
#    so a hyper-efficient bench player can't ride BPM/WS48/PER alone.
#  * A real ROLE/WORKLOAD component rewards minutes, MPG, games, usage burden.
#  * SCORING DOMINANCE multiplies volume x efficiency, so elite efficiency at
#    low volume is NOT treated like elite efficiency at high volume.
#  * Correlated rate metrics (BPM/WS48/PER) live in ONE component with a
#    bounded combined weight instead of each getting independent full weight.
# ---------------------------------------------------------------------------

# Rate impact: per-minute impact. BPM/WS48/PER are correlated -> one component.
REG_RATE_IMPACT = {"bpm_pct": 0.50, "ws_per_48_pct": 0.28, "per_pct": 0.22}
REG_IMPACT_MODERN = {"epm_pct": 0.30, "lebron_pct": 0.30, "raptor_pct": 0.16,
                     "darko_pct": 0.12, "rapm_pct": 0.12}
# Total impact: cumulative value (minutes-weighted), NOT per-minute.
REG_TOTAL_IMPACT = {"vorp_pct": 0.55, "total_ws_pct": 0.30, "mp_pct": 0.15}
# Role / workload: how big a role the player actually carried.
REG_WORKLOAD = {"mp_pct": 0.30, "mpg_pct": 0.30, "games_frac_pct": 0.15,
                "usg_pct_pct": 0.15, "creation_pct": 0.10}
# Playmaking and rebounding (separated so neither dominates "box").
REG_PLAYMAKING = {"ast_pct_pct": 0.40, "playmaking_load_pct": 0.35,
                  "ast_pct": 0.25}                            # AST% + load + AST/100
REG_REBOUNDING = {"trb_pct_pct": 0.60, "trb_pct": 0.40}      # TRB% + TRB/100
# Pure statistical defense (no awards here). DBPM-led; blocks are NOT double
# counted (stocks removed) so it doesn't over-credit shot-blocking bigs.
REG_DEFENSE = {"dbpm_pct": 0.55, "blk_pct_pct": 0.20, "stl_pct_pct": 0.25}
REG_CTX = {"team_srs_pct": 0.40, "team_net_rtg_pct": 0.30, "team_wins_pct": 0.30}

# Top-level regular-score weights (sum to 1.0). Scoring/workload carry the
# largest non-impact weight; team context is modest (it is also credited via
# the team_score and playoff components, so keeping it small avoids
# over-rewarding role players on strong teams).
# Additive value weights. Advanced impact is now CENTRAL (~40%); workload is a
# small adjustment, not a large standalone category (it primarily governs total
# value + reliability elsewhere). Playmaking/rebounding are secondary with
# damped downside.  These are value multipliers, not shares of an average.
REGULAR_WEIGHTS = {
    "impact": 0.40,            # 0.4 rate + 0.6 total  (advanced impact central)
    "scoring_dominance": 0.27,
    "defense": 0.15,
    "role_workload": 0.06,     # small; workload mainly governs total value/reliability
    "playmaking": 0.08,        # secondary (damped downside)
    "rebounding": 0.04,        # secondary (damped downside)
    "context": 0.00,           # NO team context in the INDIVIDUAL regular score
}

PO_IMPACT = {"po_bpm_pct": 0.45, "po_ws_per_48_pct": 0.30, "po_vorp_pct": 0.15,
             "po_per_pct": 0.10}
PO_BOX = {"po_pts_pct": 0.38, "po_ast_pct": 0.24, "po_trb_pct": 0.18,
          "po_stocks_pct": 0.14, "po_tov_pct": 0.06}
PO_EFF = {"po_ts_plus_pct": 0.62, "po_r_ts_pct": 0.38}

TEAM_SCORE_W = {"team_wins_pct": 0.34, "team_srs_pct": 0.34,
                "team_net_rtg_pct": 0.22, "playoff_round_pct": 0.10}


def durability_series(df: pd.DataFrame) -> pd.Series:
    g = num(df, "g")
    tg = df["season_end"].map(team_games)
    avail = g / tg
    base = pd.Series(50.0, index=df.index)
    base[avail >= 0.60] = 50
    base[avail >= 0.72] = 70
    base[avail >= 0.82] = 85
    base[avail >= 0.92] = 100
    base[avail < 0.60] = 30
    base[avail.isna()] = 50.0
    return base


REGULAR_METRICS = ["bpm", "vorp", "ws_per_48", "per", "obpm", "dbpm",
                   "epm", "lebron", "raptor", "darko", "rapm",
                   "pts", "ast", "trb", "stocks", "tov",
                   "ts_plus", "r_ts", "ft_value", "ftr", "threepar",
                   "ast_pct", "trb_pct", "stl_pct", "blk_pct", "usg_pct",
                   "team_srs", "team_net_rtg", "team_wins",
                   # workload / total-value / role inputs
                   "mp", "total_ws", "mpg", "games_frac", "creation",
                   "scoring_load", "playmaking_load"]
REGULAR_INVERSE = ["tov"]
# Metrics needing capped z-scores (for the volume-efficiency interaction).
REGULAR_ZMETRICS = ["scoring_load", "r_ts", "ts_plus", "vorp", "bpm"]
PLAYOFF_METRICS = ["bpm", "ws_per_48", "vorp", "per", "pts", "ast", "trb",
                   "stocks", "tov", "ts_plus", "r_ts"]
PLAYOFF_INVERSE = ["tov"]


# Monotonic calibration mapping the OPEN weighted index (sum of raw-value
# contributions) into interpretable historical bands. Anchors are (raw_index ->
# calibrated). This is a final order-preserving relabel only — it is NOT a
# percentile/z transform and the underlying open index (prime_index/perf_index)
# is preserved separately so apex separation is never lost. The slope keeps
# rising through the top anchors so GOAT seasons never flatten together. Bands:
# ~60s = quality role/starter, mid-70s = credible All-NBA, ~88+ = MVP-level,
# ~95+ = historically dominant peak. Fitted to the index distribution and
# validated against award tiers, not players. The interior raw anchors are
# lowered a couple points each time the component WEIGHTS are rebalanced (most
# recently postseason 12% -> 18%, which shifted prime_raw down slightly because
# the postseason component has a lower mean than the regular-season components);
# this preserves the historical DISPLAY bands without touching any component
# weight or raw formula. Calibration is a pure MONOTONIC relabel, so it never
# changes any ranking.
CALIBRATION_ANCHORS_RAW = [-10, 0, 12, 18, 26, 34, 42, 50, 60, 73, 85, 92, 112]
CALIBRATION_ANCHORS_CAL = [3, 15, 37, 46, 56, 64, 73, 81, 88, 93, 97, 99, 100]


def calibrate_score(raw: pd.Series) -> pd.Series:
    arr = pd.to_numeric(raw, errors="coerce").to_numpy(dtype=float)
    out = np.interp(arr, CALIBRATION_ANCHORS_RAW, CALIBRATION_ANCHORS_CAL)
    out = np.where(np.isnan(arr), np.nan, out)
    return pd.Series(out, index=raw.index).clip(0, 100)


def classify_roles(df: pd.DataFrame) -> pd.DataFrame:
    """
    Pure statistical role classification (no awards as inputs). Uses usage,
    scoring volume, playmaking, defense and workload percentiles already on df.
    """
    df = df.copy()
    # Use the era-relative descriptive percentile columns (0-100) so the role
    # thresholds stay stable and decoupled from the open raw-points scale of the
    # official score (these percentiles are NOT used by the official index).
    usg = num(df, "usg_pct_pct").fillna(50)
    vol = num(df, "scoring_load_pct").fillna(50)
    play = num(df, "ast_pct_pct").fillna(50)
    dfn = num(df, "dbpm_pct").fillna(50)
    sdom = num(df, "pts_pct").fillna(50)
    mpgp = num(df, "mpg_pct").fillna(50)
    mpp = num(df, "mp_pct").fillna(50)

    # "Primary" roles require a genuine starter-level workload, so a high-rate
    # bench player is not mislabeled a primary scorer/engine.
    cond = [
        (mpgp < 35) | (mpp < 22),                                         # Low-minute specialist
        (dfn >= 80) & (usg < 60) & (vol < 70),                            # Defensive anchor
        (usg >= 80) & (vol >= 78) & (play >= 60) & (mpgp >= 60),          # Primary offensive engine
        (play >= 82) & (usg >= 55) & (mpgp >= 55),                        # Primary playmaker
        (usg >= 78) & (vol >= 78) & (mpgp >= 60),                         # Primary scorer
        (dfn >= 62) & ((sdom >= 62) | (play >= 62)) & (usg >= 52) & (mpgp >= 55),  # Two-way engine
        (mpgp >= 50) & ((usg >= 60) | (vol >= 68) | (play >= 66)),        # Secondary star
    ]
    choices = [
        "Low-minute specialist",
        "Defensive anchor",
        "Primary offensive engine",
        "Primary playmaker",
        "Primary scorer",
        "Two-way engine",
        "Secondary star",
    ]
    df["role"] = np.select(cond, choices, default="High-impact role player")
    df["superstar_workload_flag"] = (
        (mpp >= 68) & (mpgp >= 68) & (usg >= 65)).astype(int)
    return df


# Pathway components (each already a 0-100+ skill score) and the descending
# weights applied after sorting each player's pathways best->worst. The best
# pathway counts fully; weaker ones add diminishing partial value; genuinely
# weak (off-role) pathways only damp, they don't penalize.
PATHWAYS = ["scoring_dominance", "playmaking", "defense", "rebounding"]
PATHWAY_WEIGHTS = [0.46, 0.22, 0.11, 0.05]   # strongest -> weakest
PATHWAY_DOWNSIDE_DAMP = 0.30
VERSATILITY_CAP = 4.0


def compute_pathways(df: pd.DataFrame) -> pd.DataFrame:
    """
    Multi-pathway specialty value + cross-position versatility bonus.
    specialty_value = sum over a player's pathways (sorted best->worst) of
    descending weights times the value-above-baseline (weak pathways damped).
    """
    df = df.copy()
    vals = np.column_stack([
        num(df, p).fillna(50.0).to_numpy() - 50.0 for p in PATHWAYS])
    # damp the downside of each pathway so off-role weaknesses ~ neutral
    damped = np.where(vals >= 0, vals, vals * PATHWAY_DOWNSIDE_DAMP)
    order = np.sort(damped, axis=1)[:, ::-1]            # best -> worst per row
    w = np.array(PATHWAY_WEIGHTS, dtype=float)
    df["specialty_value"] = (order * w).sum(axis=1)
    # versatility: extra credit for MULTIPLE genuinely elite pathways
    # (cross-skill / cross-position value), capped so it refines not dominates.
    elite = (vals >= 22).sum(axis=1)                    # pathways >= ~72
    very = (vals >= 35).sum(axis=1)                     # pathways >= ~85
    vers = 1.6 * np.clip(elite - 1, 0, None) + 1.0 * np.clip(very - 1, 0, None)
    df["versatility_bonus"] = np.clip(vers, 0, VERSATILITY_CAP)
    # which pathway is the player's primary (for reporting/explanations)
    df["primary_pathway"] = np.array(PATHWAYS)[np.argmax(vals, axis=1)]
    return df


# ===========================================================================
# OFFICIAL SINGLE-SEASON SCORE  (open weighted raw-value index)
# ---------------------------------------------------------------------------
#   STATISTICAL IMPACT        38%   (raw BPM/OBPM/DBPM, VORP, total WS, WS/48,
#                                    PER, + bounded modern EPM/LEBRON/RAPM)
#   TRADITIONAL PRODUCTION    23%   (nonlinear scoring volume x efficiency,
#                                    efficiency, playmaking, rebounding, def box)
#   INDIVIDUAL RECOGNITION    15%   (additive grouped awards; recognition_row)
#   POSTSEASON INDIVIDUAL     12%   (additive level + elevation + deep-run volume)
#   TEAM ACHIEVEMENT           3%   (championships/finals/CF x role; small)
#
# Every component is built from RAW metric values through metric-specific
# CONTINUOUS formulas. No percentiles, universal z-scores, generic 0-100
# grades, landmark tables or 100-caps enter the official score. The index is
# OPEN (uncapped contributions); a final monotonic calibration only relabels
# the open index into interpretable historical bands (prime_index keeps the
# raw, uncapped value). Workload only translates rate into total value /
# reliability / availability; it is never a standalone scored category.
# ===========================================================================

OFFICIAL_WEIGHTS = {
    "statistical_impact": 0.38,
    "traditional_production": 0.21,
    "recognition": 0.20,
    "postseason": 0.18,
    "team_achievement": 0.03,
}
MODERN_IMPACT_COLS = ["epm", "lebron", "raptor", "darko", "rapm"]


def _soft_above(v, knee: float, scale: Optional[float] = None) -> np.ndarray:
    """
    Identity up to `knee`, then a smooth, strictly-increasing log tail (slope
    diminishes but is never zero, so 12 vs 15 BPM still separate). Continuous in
    value and slope at the knee. NOT a hard cap.
    """
    v = np.asarray(v, dtype=float)
    scale = float(knee if scale is None else scale)
    extra = np.clip(v - knee, 0.0, None)
    return np.where(v <= knee, v, knee + scale * np.log1p(extra / scale))


def _impact_value(x, x0: float, per: float, knee: float = 90.0) -> np.ndarray:
    """
    Continuous raw plus/minus-style metric -> points: `per` points per unit
    above the replacement anchor `x0`, never-flat log tail above `knee`.
    Sub-replacement values go negative (they genuinely subtract). This is a
    metric-specific continuous formula on the RAW value (no percentile/landmark).
    """
    arr = (pd.to_numeric(x, errors="coerce").to_numpy(dtype=float)
           if hasattr(x, "to_numpy") else np.asarray(x, dtype=float))
    return _soft_above(per * (arr - x0), knee)


def _hinge_value(x, thr: float, per: float, knee: float = 72.0) -> np.ndarray:
    """
    Continuous raw -> points that is ~0 until the statistic is genuinely strong
    (above `thr`), then grows `per` points per unit with a never-flat log tail.
    Average or off-role production therefore contributes ~zero rather than
    lowering the score (a center's ordinary assists, a guard's ordinary boards).
    """
    arr = (pd.to_numeric(x, errors="coerce").to_numpy(dtype=float)
           if hasattr(x, "to_numpy") else np.asarray(x, dtype=float))
    return _soft_above(np.clip(per * (arr - thr), 0.0, None), knee)


def _masked_wavg(score_arrays: List[np.ndarray], weights: List[float]) -> np.ndarray:
    """Row-wise weighted average that skips NaN sub-scores and renormalizes the
    remaining weights (so a missing supplement never penalizes)."""
    M = np.column_stack([np.asarray(a, dtype=float) for a in score_arrays])
    W = np.asarray(weights, dtype=float)
    mask = ~np.isnan(M)
    num_ = np.where(mask, M * W, 0.0).sum(axis=1)
    den = (mask * W).sum(axis=1)
    return np.where(den > 0, num_ / np.where(den > 0, den, 1.0), np.nan)


def statistical_impact(df: pd.DataFrame) -> Tuple[pd.Series, Dict[str, np.ndarray]]:
    """STATISTICAL IMPACT (38%) from raw advanced metrics (continuous formulas).
    Sub-weights of the 45: BPM/OBPM/DBPM 15, VORP+total WS 10, WS/48 8, PER 5,
    modern consensus 7 (bounded supplement, excluded when absent)."""
    bpm, obpm, dbpm = num(df, "bpm"), num(df, "obpm"), num(df, "dbpm")
    vorp, tws = num(df, "vorp"), num(df, "total_ws")
    ws48, per = num(df, "ws_per_48"), num(df, "per")

    s_bpm = (0.50 * _impact_value(bpm, -2.0, 8.0) +
             0.25 * _impact_value(obpm, -2.0, 9.0) +
             0.25 * _impact_value(dbpm, -1.5, 11.0))
    s_vorp_ws = (0.55 * _impact_value(vorp, 0.0, 10.0) +
                 0.45 * _impact_value(tws, 0.0, 5.0))
    s_ws48 = _impact_value(ws48, 0.05, 400.0)
    s_per = _impact_value(per, 10.0, 4.5)

    # modern impact consensus (EPM/LEBRON/RAPM/...): bounded supplement only.
    mod_cols = [c for c in MODERN_IMPACT_COLS if c in df.columns]
    if mod_cols:
        s_mod = _masked_wavg(
            [_impact_value(num(df, c), -1.0, 10.0) for c in mod_cols],
            [1.0] * len(mod_cols))
    else:
        s_mod = np.full(len(df), np.nan)

    si = _masked_wavg([s_bpm, s_vorp_ws, s_ws48, s_per, s_mod],
                      [15.0, 10.0, 8.0, 5.0, 7.0])
    parts = {"si_bpm": s_bpm, "si_vorp_ws": s_vorp_ws, "si_ws48": s_ws48,
             "si_per": s_per, "si_modern": s_mod}
    return pd.Series(si, index=df.index), parts


# ---- SUCCESSFUL OFFENSIVE-BURDEN RESIDUAL (inside Traditional Production) ----
# A small, BOUNDED residual that measures unusually difficult offensive creation
# the player SUCCESSFULLY absorbed -- beyond what production/impact already credit.
# It REPLACES the prior raw "heavy-usage burden" term (`0.8*hinge(usg,24)`), which
# rewarded high usage by itself. The residual requires high creation load AND
# beating the usage-adjusted efficiency expectation AND real workload, so high
# usage alone (or strong efficiency on a light role) earns nothing.
#
# DATA-COMPLETION CHANGE (justified by the ablation in outputs.txt): the creation
# LOAD now uses ACTUAL team scoring/assist shares (100*team_scoring_share +
# 0.45*100*team_assist_share) instead of the USG%/AST% PROXY, when the real shares
# are available. The actual-share pivots are PERCENTILE-MATCHED to the proxy
# distribution, so the residual's distribution and the TP scale are preserved
# (mean burden 1.42->1.59; TP mean delta ~+0.07, immaterial) while the signal
# becomes a defensible measure of real production responsibility. When team shares
# are missing the row FALLS BACK to the proxy (flagged via burden_data_status).
BURDEN_USG_PIVOT = 22.0       # usage% at which extra creation load begins
BURDEN_EFF_SLOPE = 0.32       # expected r_TS lost per usage point above the pivot
BURDEN_CREATION_PIVOT = 28.0  # PROXY creation (usg + 0.45*AST%) where load starts
BURDEN_CREATION_SCALE = 22.0  # PROXY creation span over which load saturates
# actual-share creation = 100*team_scoring_share + 0.45*100*team_assist_share;
# pivots percentile-matched to the proxy (distribution-based, NOT player-tuned).
BURDEN_SHARE_PIVOT = 9.0      # actual-share creation where load credit starts
BURDEN_SHARE_SCALE = 13.5     # actual-share creation span over which load saturates
BURDEN_MP_FULL = 2000.0       # minutes for full workload reliability
BURDEN_RESID_CAP = 8.0        # cap on |usage-efficiency residual| (r_TS points)
BURDEN_POS_SCALE = 0.95       # scoring-unit credit per (load x positive residual)
BURDEN_NEG_SCALE = 0.30       # small, bounded penalty for inefficient extreme load
BURDEN_POS_MAX = 9.0          # max positive burden credit (scoring units)
BURDEN_NEG_MAX = 4.0          # max (bounded) negative burden (scoring units)


def successful_burden_residual(df: pd.DataFrame) -> Dict[str, np.ndarray]:
    """Conservative all-era measure of SUCCESSFULLY absorbed offensive burden,
    returned in `scoring` units (added to the scoring term, replacing the old raw
    usage bonus). Creation load uses ACTUAL team scoring/assist shares when present
    (else the USG%/AST% proxy, flagged). Usage%, relative TS and minutes complete
    the signal. OBPM is carried for VALIDATION only and is NOT an additive input."""
    usg = num(df, "usg_pct").to_numpy()
    r_ts = num(df, "r_ts").to_numpy()
    mp = num(df, "mp").to_numpy()
    proxy_creation = num(df, "creation").to_numpy()      # usg + 0.45*AST% (proxy)
    tss = num(df, "team_scoring_share").to_numpy()        # ACTUAL (fraction)
    tas = num(df, "team_assist_share").to_numpy()

    # Expected relative efficiency DECLINES with usage above the pivot (the well-
    # documented usage/efficiency trade-off). Residual = actual - expected.
    expected_r_ts = -BURDEN_EFF_SLOPE * np.clip(
        np.nan_to_num(usg, nan=BURDEN_USG_PIVOT) - BURDEN_USG_PIVOT, 0.0, None)
    usage_eff_residual = np.nan_to_num(r_ts, nan=0.0) - expected_r_ts

    # Creation LOAD, bounded to [0,1]. Prefer ACTUAL shares (combine team scoring
    # share, team assist share, on a usage-comparable scale); fall back to proxy.
    have_share = ~np.isnan(tss)
    actual_creation = 100.0 * np.nan_to_num(tss) + 0.45 * 100.0 * np.nan_to_num(tas)
    load_actual = np.clip((actual_creation - BURDEN_SHARE_PIVOT) / BURDEN_SHARE_SCALE,
                          0.0, 1.0)
    load_proxy = np.clip((np.nan_to_num(proxy_creation, nan=0.0)
                          - BURDEN_CREATION_PIVOT) / BURDEN_CREATION_SCALE, 0.0, 1.0)
    creation_load = np.where(have_share, load_actual, load_proxy)
    # reported creation_share: the bounded actual share combo (fraction units)
    creation_share = np.where(
        have_share, np.nan_to_num(tss) + 0.45 * np.nan_to_num(tas), np.nan)
    workload_reliab = np.clip(np.nan_to_num(mp, nan=0.0) / BURDEN_MP_FULL, 0.0, 1.0)

    pos = np.clip(usage_eff_residual, 0.0, BURDEN_RESID_CAP)
    neg = np.clip(-usage_eff_residual, 0.0, BURDEN_RESID_CAP)
    credit = np.clip(BURDEN_POS_SCALE * creation_load * pos * workload_reliab,
                     0.0, BURDEN_POS_MAX)
    penalty = np.clip(BURDEN_NEG_SCALE * creation_load * neg * workload_reliab,
                      0.0, BURDEN_NEG_MAX)
    residual = credit - penalty
    return {"burden_residual": residual,
            "usage_eff_residual": usage_eff_residual,
            "creation_load": creation_load,
            "creation_share": creation_share,
            "burden_workload": workload_reliab}


def traditional_production(df: pd.DataFrame
                           ) -> Tuple[pd.Series, Dict[str, np.ndarray]]:
    """TRADITIONAL PRODUCTION (21%). Scoring value combines volume and
    efficiency NONLINEARLY (PTS/100, usage, sustained minutes/total points, rTS,
    TS+). Each skill only ADDS when strong (hinge -> ~0 at average). The prior raw
    heavy-usage bonus is REPLACED by a small bounded SUCCESSFUL-BURDEN RESIDUAL
    (high creation load x positive usage-adjusted efficiency x workload). Penalties:
    inefficient high-volume scoring, excessive turnovers, poor availability."""
    pts, usg = num(df, "pts"), num(df, "usg_pct")
    ts_plus, r_ts = num(df, "ts_plus"), num(df, "r_ts")
    mp = num(df, "mp")
    ast, ast_pct = num(df, "ast"), num(df, "ast_pct")
    trb, trb_pct = num(df, "trb"), num(df, "trb_pct")
    stocks, dbpm = num(df, "stocks"), num(df, "dbpm")
    tov, gf = num(df, "tov"), num(df, "games_frac")

    eff_signal = 0.5 * r_ts.fillna(0.0) + 0.5 * (ts_plus.fillna(100.0) - 100.0)
    eff_signal = eff_signal.to_numpy()

    # --- scoring value: nonlinear volume x efficiency ---
    vol = _hinge_value(pts, 18.0, 2.6)                       # rate-driven volume
    load_mult = np.clip(0.55 + 0.45 * (mp.to_numpy() / 2300.0), 0.5, 1.12)
    eff_mult = np.clip(1.0 + 0.030 * eff_signal, 0.60, 1.45)
    scoring = vol * load_mult * eff_mult                     # sustained volume
    # successful-burden residual REPLACES the old raw `0.8*hinge(usg,24)` term:
    # high usage by itself no longer adds; only successfully-carried extreme
    # creation (load x positive usage-adjusted efficiency x workload) does.
    burden = successful_burden_residual(df)
    scoring = scoring + burden["burden_residual"]
    # inefficient high-volume scoring -> penalty
    ineff_pen = (np.clip(pts.to_numpy() - 26.0, 0.0, None) *
                 np.clip(-eff_signal, 0.0, None) * 0.05)
    scoring = scoring - ineff_pen

    efficiency = _hinge_value(eff_signal, 0.0, 6.0)
    playmaking = _hinge_value(ast, 3.5, 6.0) + 0.5 * _hinge_value(ast_pct, 16.0, 0.7)
    rebounding = _hinge_value(trb, 7.0, 5.0) + 0.5 * _hinge_value(trb_pct, 8.0, 0.8)
    defbox = _hinge_value(stocks, 2.5, 8.0) + 0.5 * _hinge_value(dbpm, 0.0, 6.0)

    tp = (0.40 * scoring + 0.20 * efficiency + 0.16 * playmaking +
          0.12 * rebounding + 0.12 * defbox)
    # penalties (single-counted): turnovers, availability
    tov_pen = np.clip(tov.to_numpy() - 4.5, 0.0, None) * 3.0
    avail_pen = np.clip(0.62 - np.nan_to_num(gf.to_numpy(), nan=0.62), 0.0, None) * 120.0
    tp = np.clip(tp - tov_pen - avail_pen, 0.0, None)

    parts = {"scoring": scoring, "scoring_volume": vol * load_mult,
             "efficiency": efficiency, "playmaking": playmaking,
             "rebounding": rebounding, "defense": defbox,
             "burden_residual": burden["burden_residual"],
             "usage_eff_residual": burden["usage_eff_residual"],
             "creation_load": burden["creation_load"],
             "creation_share": burden["creation_share"]}
    return pd.Series(tp, index=df.index), parts


# Replacement-level individual playoff performance: an average playoff
# contributor sits near here, so `level_full - PO_BASELINE` is the value ABOVE a
# routine playoff appearance. Below it produces a small (bounded) penalty.
# Explicit completed-season cutoff: a season is PROVISIONAL (incomplete) unless
# the 90th-percentile rotation games-fraction reaches this level (see below).
COMPLETED_SEASON_PROGRESS_CUTOFF = 0.90

PO_BASELINE = 25.0
PO_PENALTY_CAP = 14.0          # max negative playoff-level value (bounded penalty)
# Elevation (playoff rate impact - regular rate impact): a bounded SUPPLEMENT.
PO_ELEV_SCALE = 0.55           # points of value per point of rate elevation
PO_ELEV_DOWN_DAMP = 0.35       # decline from an extreme baseline is damped
PO_ELEV_UP_CAP = 14.0          # max positive elevation value
PO_ELEV_DOWN_CAP = 6.0         # max negative elevation value (small)
# ---- ELEVATION-REVERSAL SAFEGUARD (bounded, gated, monotonic NON-DECREASING) ----
# The postseason contract (docstring below) states that elevation SUPPLEMENTS
# absolute quality and "does not replace it", and that "a slight decline from an
# extreme regular-season baseline is damped, not heavily punished". The SPECIALIST
# AND POSTSEASON AUDIT found that for a small, cross-era set of clearly valuable,
# well-sampled playoff performers (e.g. McHale 1987, Manu 2008, Shaq 2006, Dirk
# 2005, Nash 2003, KAT 2025, Parish 1981) a large negative elevation nonetheless
# REVERSES a clearly positive, reliability-adjusted absolute level, flipping elite
# individual playoff basketball into a NET-NEGATIVE postseason value -- which
# contradicts that stated contract. The safeguard caps how much a negative
# elevation can erode a clearly-positive, adequately-sampled level: elevation may
# REDUCE but not REVERSE the level below a small retained fraction. It is gated on
# the absolute level and the sample (archetype- and player-agnostic), can ONLY
# raise a score (never lowers one, so no protected big can be penalized), adds NO
# sixth component, and is bounded (single-season Prime-raw effect < ~0.6 pt).
# The elevation term is NOT removed and scores are NOT floored at zero.
PO_ELEV_GUARD_LEVEL = 1.0      # reliability-adjusted level must be clearly positive
PO_ELEV_GUARD_RELIAB = 0.60    # AND the playoff sample must be adequate
PO_ELEV_GUARD_FRACTION = 0.20  # >= this fraction of a positive level is retained

# ---- PLAYOFF-SAMPLE RELIABILITY (minutes x games x series) ------------------
# A SINGLE confidence signal, in [0, 1], built from how MUCH playoff basketball
# the rate statistics were measured over: total minutes, total games, and the
# number of series/rounds reached. It governs the WHOLE upper tail -- the
# absolute level, the elevation, and (most strongly) the convex dominance bonus
# -- so an extreme rate stat over a SHORT run (one or two rounds) is shrunk
# toward the league and cannot dwarf a Finals-length elite run. Series count is
# used only as a SAMPLE signal (how many rounds the rates survived), NEVER as a
# points-for-advancement reward. When games/series are unobserved the blend
# gracefully falls back to the minutes signal alone.
PO_REL_MIN_FULL = 850.0        # playoff minutes for a full (Finals-length) sample
PO_REL_G_FULL = 19.0           # playoff games for a full sample
PO_REL_S_FULL = 4.0            # series/rounds reached for a full sample
PO_REL_W_MIN = 0.40            # sample-reliability weight on minutes
PO_REL_W_G = 0.35              # ... on games
PO_REL_W_S = 0.25              # ... on series count
# The convex dominance bonus is shrunk by an EXTRA series gate on top of the
# shared sample reliability, so the full historical-dominance bonus is reserved
# for elite play sustained through the deepest runs (a short Conference-Finals
# run with extreme rates gets a partial, not full, bonus).
PO_DOM_TAIL_EXP = 1.0          # extra exponent on series-fraction for dominance

# Deep-run / SUSTAINED ELITE VOLUME: elite per-minute quality ACCUMULATED over
# real playoff minutes AND games. NOT team advancement; floored at 0. The volume
# factor rises with BOTH minutes and games (uncapped below a Finals-length run),
# so at equal rates a four-round run earns more sustained volume than a shorter
# one -- the additional value comes from sustaining elite play, never from merely
# reaching a round.
PO_DEEPRUN_QUAL_THR = 42.0     # only genuinely strong playoff levels qualify
PO_DEEPRUN_MIN_FULL = 950.0    # minutes at which the minutes half saturates
PO_DEEPRUN_G_FULL = 21.0       # games at which the games half saturates
PO_DEEPRUN_SCALE = 0.26
# Best-player RESPONSIBILITY for sustained-volume credit, derived purely from the
# playoff usage burden (data, not narrative). A floor keeps elite low-usage
# contributors (e.g. defensive anchors who still reach an elite level) credited,
# while a primary creator (high usage) earns full credit and a low-usage role
# player earns little. Combined with the quality+minutes gates on deep-run.
PO_RESP_FLOOR = 0.55           # minimum responsibility multiplier
PO_RESP_USG_LO = 18.0          # usage% at the responsibility floor
PO_RESP_PER_USG = 0.0333       # responsibility gained per usage% above the floor
PO_RESP_CAP = 1.12             # maximum responsibility multiplier
# Convex DOMINANCE bonus with DIMINISHING RETURNS (a saturating square-root
# curve), applied to the EXCEPTIONAL residual of the level above an elite knee
# and then shrunk by playoff-sample reliability. By construction:
#   level 50 -> no bonus; 60 -> meaningful; 75 -> larger; 90 -> exceptional;
#   the curve flattens so it never explodes above the top of the level scale.
# This REPLACES the old open-ended "+K per level point above the knee" linear
# booster, whose unbounded slope let a short run with extreme rates run away.
PO_DOMINANCE_KNEE = 50.0
PO_DOMINANCE_SCALE = 2.05      # points per sqrt(level-above-knee), pre-reliability


def _po_series_count(prs) -> np.ndarray:
    """Map the rounds-reached encoding (playoff_round_score) to a SAMPLE count of
    series the playoff rates were observed over: 10/NaN=0, 30=1 (R1), 50=2 (CSF),
    70=3 (CF), 85=4 (Finals loss), 100=4 (champion). Used ONLY as a sample-size
    signal for reliability, never as points for advancement."""
    p = np.nan_to_num(np.asarray(prs, dtype=float), nan=0.0)
    out = np.zeros_like(p)
    out = np.where(p >= 30.0, 1.0, out)
    out = np.where(p >= 50.0, 2.0, out)
    out = np.where(p >= 70.0, 3.0, out)
    out = np.where(p >= 85.0, 4.0, out)
    return out


def _rate_impact_value(bpm, obpm, dbpm, ws48, per) -> np.ndarray:
    """Per-minute (RATE) impact on the statistical-impact rate scale, identical
    for regular season and playoffs so the two are directly comparable. Uses the
    SAME continuous anchors as statistical_impact()'s rate terms (BPM/OBPM/DBPM
    consensus + WS/48 + PER); cumulative VORP/total-WS are intentionally excluded
    (those are not a per-minute rate)."""
    s_bpm = (0.50 * _impact_value(bpm, -2.0, 8.0) +
             0.25 * _impact_value(obpm, -2.0, 9.0) +
             0.25 * _impact_value(dbpm, -1.5, 11.0))
    s_ws48 = _impact_value(ws48, 0.05, 400.0)
    s_per = _impact_value(per, 10.0, 4.5)
    return _masked_wavg([s_bpm, s_ws48, s_per], [15.0, 8.0, 5.0])


def postseason_value(df: pd.DataFrame, has_po: pd.Series
                     ) -> Tuple[pd.Series, Dict[str, np.ndarray]]:
    """POSTSEASON INDIVIDUAL VALUE (18%), rewarding ELITE INDIVIDUAL playoff
    performance -- not merely winning -- while staying purely individual:

        postseason_individual_value = absolute_playoff_level
                                    + playoff_elevation     (vs own regular season)
                                    + sustained_elite_volume (carried deep runs)

    Contract:
      * NO playoffs / no playoff minutes -> exactly 0 (no positive default);
      * absolute level is NONLINEAR: ordinary play small, good moderate, elite
        substantial, HISTORICALLY DOMINANT exceptional (convex dominance booster);
        a ring/Finals/deep run by itself does NOT create a large score;
      * elevation SUPPLEMENTS absolute quality (does not replace it) and is
        sample-shrunk; a slight decline from an extreme regular-season baseline
        is damped, not heavily punished (Jokic gets credit for excellent/improved
        play even without a title);
      * sustained-volume requires elite quality AND real minutes AND best-player
        RESPONSIBILITY (usage burden, from data), so reaching the Finals with
        ordinary production -- or as a low-usage role player -- adds little;
      * availability is counted ONCE (minutes reliability) and never twice;
      * championships, round reached and Finals MVP do NOT enter here (Team
        Achievement / Individual Recognition respectively); Finals MVP / clear-
        best-player status only VALIDATE that these metrics found the right
        player -- their points are never duplicated inside Postseason.
    """
    pbpm, pobpm, pdbpm = num(df, "po_bpm"), num(df, "po_obpm"), num(df, "po_dbpm")
    pws, pper = num(df, "po_ws_per_48"), num(df, "po_per")
    ppts = num(df, "po_pts")
    pr_ts, pts_plus = num(df, "po_r_ts"), num(df, "po_ts_plus")
    past, past_pct = num(df, "po_ast"), num(df, "po_ast_pct")
    ptrb, ptrb_pct = num(df, "po_trb"), num(df, "po_trb_pct")
    pstocks = num(df, "po_stocks")
    po_mp = num(df, "po_mp")

    # ---- (a) PLAYOFF LEVEL: absolute raw quality across all skills -----------
    po_rate = _rate_impact_value(pbpm, pobpm, pdbpm, pws, pper)
    po_eff = (0.5 * pr_ts.fillna(0.0) + 0.5 * (pts_plus.fillna(100.0) - 100.0)).to_numpy()
    po_scoring = _hinge_value(ppts, 18.0, 2.6) * np.clip(1.0 + 0.030 * po_eff, 0.6, 1.4)
    po_effv = _hinge_value(po_eff, 0.0, 6.0)
    po_playmaking = (_hinge_value(past, 3.5, 6.0) +
                     0.5 * _hinge_value(past_pct, 16.0, 0.7))
    po_rebounding = (_hinge_value(ptrb, 7.0, 5.0) +
                     0.5 * _hinge_value(ptrb_pct, 8.0, 0.8))
    po_defense = (_hinge_value(pstocks, 2.5, 8.0) +
                  0.5 * _hinge_value(pdbpm.to_numpy(), 0.0, 6.0))
    # a missing skill contributes 0 (never NaN-poisons the additive level)
    z0 = lambda a: np.nan_to_num(np.asarray(a, dtype=float), nan=0.0)
    level_full = (0.50 * z0(po_rate) + 0.18 * z0(po_scoring) +
                  0.10 * z0(po_effv) + 0.08 * z0(po_playmaking) +
                  0.06 * z0(po_rebounding) + 0.08 * z0(po_defense))
    oq = num(df, "opponent_quality_score").fillna(50.0).to_numpy()
    level_full = level_full * np.clip(0.90 + 0.20 * (oq - 50.0) / 50.0, 0.85, 1.15)
    # ABSOLUTE LEVEL: how good the player was, above a replacement playoff
    # baseline. This is now LINEAR in level (the convex dominance bonus lives in
    # its own diminishing-return term below, so an extreme level is not rewarded
    # a second time inside the level itself). The downside is a small bounded
    # penalty.
    abs_level = np.clip(level_full - PO_BASELINE, -PO_PENALTY_CAP, None)

    # ---- PLAYOFF-SAMPLE RELIABILITY (minutes x games x series) ---------------
    # One confidence signal that shrinks the entire upper tail on short/partial
    # runs. Minutes is always present; games/series fall back to the minutes
    # signal when unobserved so synthetic / pre-bracket rows degrade gracefully.
    pm = np.nan_to_num(po_mp.to_numpy(), nan=0.0)
    m_rel = np.clip(pm / PO_REL_MIN_FULL, 0.0, 1.0)
    pg = num(df, "po_g").to_numpy() if "po_g" in df.columns else np.full(len(df), np.nan)
    g_rel = np.where(np.isnan(pg), m_rel, np.clip(pg / PO_REL_G_FULL, 0.0, 1.0))
    prs = (num(df, "playoff_round_score").to_numpy()
           if "playoff_round_score" in df.columns else np.full(len(df), np.nan))
    series_n = _po_series_count(prs)
    s_frac = np.where(np.isnan(prs), m_rel,
                      np.clip(series_n / PO_REL_S_FULL, 0.0, 1.0))
    sample_reliab = (PO_REL_W_MIN * m_rel + PO_REL_W_G * g_rel +
                     PO_REL_W_S * s_frac)
    sample_reliab = np.clip(sample_reliab, 0.0, 1.0)
    # RELIABILITY-ADJUSTED LEVEL: absolute level shrunk by the playoff sample.
    reliab_level = abs_level * sample_reliab

    # ---- (b) PLAYOFF ELEVATION: playoff rate impact - regular rate impact ----
    reg_rate = _rate_impact_value(num(df, "bpm"), num(df, "obpm"),
                                  num(df, "dbpm"), num(df, "ws_per_48"),
                                  num(df, "per"))
    elev_raw = np.nan_to_num(po_rate, nan=0.0) - np.nan_to_num(reg_rate, nan=0.0)
    # gains count fully; declines (esp. from an extreme baseline) are damped
    elev = np.where(elev_raw >= 0.0, elev_raw, PO_ELEV_DOWN_DAMP * elev_raw)
    elevation_raw = np.clip(PO_ELEV_SCALE * elev, -PO_ELEV_DOWN_CAP, PO_ELEV_UP_CAP)
    # SAMPLE-ADJUSTED ELEVATION (shrunk by the same playoff sample as the level,
    # so improvement measured over a short run is not over-trusted).
    elevation = elevation_raw * sample_reliab
    # ELEVATION-REVERSAL SAFEGUARD: when the reliability-adjusted level is clearly
    # positive AND the sample is adequate, a (already damped, capped, reliability-
    # shrunk) negative elevation may REDUCE but not REVERSE the level below a small
    # retained fraction. Flooring `elevation` (not the assembly) keeps the reported
    # components reconciling exactly (level + elevation + deep_run + dominance).
    # This only ever raises a value; it never lowers one and adds no new component.
    elev_guard = (reliab_level >= PO_ELEV_GUARD_LEVEL) & (sample_reliab >= PO_ELEV_GUARD_RELIAB)
    elev_floor = (PO_ELEV_GUARD_FRACTION - 1.0) * np.clip(reliab_level, 0.0, None)
    elevation = np.where(elev_guard, np.maximum(elevation, elev_floor), elevation)

    # ---- (c) SUSTAINED ELITE VOLUME: elite quality x volume x responsibility --
    # Best-player RESPONSIBILITY from the playoff usage burden (data, not
    # narrative): a primary creator carrying a deep run earns full sustained-
    # volume credit; a low-usage role player earns little even with a ring. The
    # VOLUME factor rises with BOTH minutes and games, so at equal rates elite
    # play sustained through more rounds earns more than a shorter run.
    po_usg = num(df, "po_usg_pct").to_numpy()
    responsibility = np.clip(
        PO_RESP_FLOOR + PO_RESP_PER_USG * (np.nan_to_num(po_usg, nan=PO_RESP_USG_LO)
                                           - PO_RESP_USG_LO),
        PO_RESP_FLOOR, PO_RESP_CAP)
    quality_above = np.clip(level_full - PO_DEEPRUN_QUAL_THR, 0.0, None)
    min_part = np.clip(pm / PO_DEEPRUN_MIN_FULL, 0.0, 1.0)
    g_part = np.where(np.isnan(pg), min_part,
                      np.clip(pg / PO_DEEPRUN_G_FULL, 0.0, 1.0))
    volume_factor = 0.5 * min_part + 0.5 * g_part
    deep_run = (PO_DEEPRUN_SCALE * quality_above * volume_factor
                * responsibility)                                  # >= 0

    # ---- (d) CONVEX DOMINANCE BONUS: diminishing returns, reliability-shrunk --
    # Applied ONLY to the exceptional residual of the level above the elite knee,
    # via a saturating square-root curve, and then shrunk by playoff-sample
    # reliability with an EXTRA series gate. A short Conference-Finals run with
    # extreme rates therefore earns only a PARTIAL historical-dominance bonus;
    # the full bonus is reserved for elite play sustained through the deepest
    # runs. level 50 -> 0; the curve flattens so it cannot run away at the top.
    dom_residual = np.clip(level_full - PO_DOMINANCE_KNEE, 0.0, None)
    dominance_raw = PO_DOMINANCE_SCALE * np.sqrt(dom_residual)      # >= 0
    tail_reliab = sample_reliab * (s_frac ** PO_DOM_TAIL_EXP)
    dominance = dominance_raw * tail_reliab                         # >= 0

    # ---- assembly (availability counted ONCE) --------------------------------
    # The rate-quality terms (reliability-adjusted level + elevation) carry the
    # SINGLE small bounded downside; deep-run and dominance are non-negative and
    # add no second availability penalty.
    rate_quality = np.clip(reliab_level + elevation, -PO_PENALTY_CAP, None)
    val = rate_quality + deep_run + dominance
    played = has_po.to_numpy() & (pm > 0)
    val = np.where(played, val, 0.0)

    z = np.zeros(len(df))
    parts = {
        "po_level": np.where(played, reliab_level, z),
        "po_elevation": np.where(played, elevation, z),
        "po_deep_run": np.where(played, deep_run, z),
        "po_dominance": np.where(played, dominance, z),
        # ---- diagnostics for the postseason audit ----
        "po_abs_level": np.where(played, abs_level, z),
        "po_sample_reliab": np.where(played, sample_reliab, z),
        "po_elev_raw": np.where(played, elevation_raw, z),
        "po_dominance_raw": np.where(played, dominance_raw, z),
        "po_series_n": np.where(played, series_n, z),
        "po_reg_rate": np.nan_to_num(reg_rate, nan=0.0),
        "po_play_rate": np.nan_to_num(po_rate, nan=0.0),
        "po_responsibility": np.where(played, responsibility, z),
    }
    return pd.Series(val, index=df.index), parts


def score_dataset(regular: pd.DataFrame, playoffs: pd.DataFrame) -> pd.DataFrame:
    regular = add_derived(regular)
    regular = add_relative_efficiency(regular)

    mp = num(regular, "mp")
    thr = regular["season_end"].map(regular_minutes_threshold)
    qualifier = mp >= thr
    regular = regular.loc[qualifier.values | True].copy()  # keep all; flag below
    regular["_qualifier"] = (mp >= thr).values

    # Era-relative percentiles + capped z-scores among qualifiers.
    regular = add_percentiles(regular, REGULAR_METRICS,
                              qualifier=regular["_qualifier"],
                              inverse=REGULAR_INVERSE)
    regular = add_zscores(regular, REGULAR_ZMETRICS,
                          qualifier=regular["_qualifier"])

    # ----- Playoff RAW value, merged onto regular by (player, season_end) ------
    if len(playoffs):
        playoffs = add_derived(playoffs)
        playoffs = add_relative_efficiency(playoffs)
        playoffs = playoffs.copy()
        # team's deepest-round game count = max games any teammate played
        if "team" in playoffs.columns and "g" in playoffs.columns:
            playoffs["team_po_g"] = playoffs.groupby(
                ["season_end", "team"])["g"].transform("max")
        else:
            playoffs["team_po_g"] = np.nan
        raw_po = ["bpm", "obpm", "dbpm", "vorp", "ws_per_48", "per", "pts",
                  "ts_plus", "r_ts", "ast", "trb", "stl", "blk", "stocks",
                  "ast_pct", "trb_pct", "usg_pct"]
        keep = (["player", "season_end", "mp", "g", "team_po_g"] +
                [c for c in raw_po if c in playoffs.columns])
        ren = {c: f"po_{c}" for c in raw_po}
        ren.update({"mp": "po_mp", "g": "po_g"})
        po_small = playoffs[keep].rename(columns=ren)
        regular = regular.merge(po_small, on=["player", "season_end"], how="left")
    else:
        for c in ("po_mp", "po_g", "team_po_g", "po_bpm", "po_obpm", "po_dbpm",
                  "po_vorp", "po_ws_per_48", "po_per", "po_pts", "po_ts_plus",
                  "po_r_ts", "po_ast", "po_trb", "po_stl", "po_blk", "po_stocks",
                  "po_ast_pct", "po_trb_pct", "po_usg_pct"):
            regular[c] = np.nan

    # ----- Keep only qualifying regular seasons for scoring -------------------
    df = regular[regular["_qualifier"]].copy().reset_index(drop=True)
    has_po = (df["po_mp"].notna() if "po_mp" in df.columns
              else pd.Series(False, index=df.index))

    # ===================================================================
    # OFFICIAL FIVE-COMPONENT INDEX (open, raw-value contributions)
    #   38% statistical impact | 21% traditional production |
    #   20% recognition | 18% postseason individual | 3% team achievement
    # ===================================================================
    si, si_parts = statistical_impact(df)            # 43% component (raw value)
    tp, tp_parts = traditional_production(df)         # 23% component (raw value)
    df["statistical_impact"] = si
    df["traditional_production"] = tp

    # --- diagnostic sub-components (carried for reports/audits/back-compat) ---
    df["rate_impact"] = _masked_wavg(
        [si_parts["si_bpm"], si_parts["si_ws48"], si_parts["si_per"]],
        [0.50, 0.28, 0.22])
    df["total_impact"] = si_parts["si_vorp_ws"]       # cumulative VORP + WS
    df["regular_impact"] = si                         # combined advanced impact
    df["scoring_dominance"] = tp_parts["scoring"]
    df["scoring_volume"] = tp_parts["scoring_volume"]
    df["scoring_efficiency"] = tp_parts["efficiency"]
    df["volume_efficiency"] = tp_parts["scoring"]     # (legacy alias)
    df["playmaking"] = tp_parts["playmaking"]
    df["rebounding"] = tp_parts["rebounding"]
    df["defense"] = tp_parts["defense"]
    # successful offensive-burden residual diagnostics (inside Traditional Prod.)
    df["burden_residual"] = tp_parts["burden_residual"]
    df["usage_eff_residual"] = tp_parts["usage_eff_residual"]
    df["creation_load"] = tp_parts["creation_load"]
    df["creation_share"] = tp_parts["creation_share"]
    # Role/workload DIAGNOSTIC: translates rate into total value/reliability; it
    # is NOT a standalone scored category in the official index.
    mpg_, mp_, usg_ = num(df, "mpg"), num(df, "mp"), num(df, "usg_pct")
    df["role_workload"] = (0.5 * mpg_.fillna(0) + 0.012 * mp_.fillna(0) +
                           0.5 * usg_.fillna(0)).clip(0, 100)
    df["regular_context"] = wavail(df, REG_CTX)
    # legacy pathway columns kept populated but UNUSED by the official index
    df["specialty_value"] = 0.0
    df["versatility_bonus"] = 0.0
    pp = np.array(["scoring_dominance", "playmaking", "defense", "rebounding"])
    ppvals = np.column_stack([df[c].to_numpy() for c in pp])
    df["primary_pathway"] = pp[np.argmax(ppvals, axis=1)]

    # Regular-season individual performance = statistical impact + production
    # (no awards / playoffs / team), on the open weighted-points scale.
    df["regular"] = (OFFICIAL_WEIGHTS["statistical_impact"] * si +
                     OFFICIAL_WEIGHTS["traditional_production"] * tp)
    df["regular_perf"] = df["regular"]
    df["regular_box"] = (0.5 * df["scoring_volume"] + 0.25 * df["playmaking"] +
                         0.25 * df["rebounding"])
    df["regular_efficiency"] = df["scoring_efficiency"]
    df["regular_versatility"] = df["defense"]

    # Role classification (pure statistical; awards are validation only).
    df = classify_roles(df)

    # ----- POSTSEASON individual value (component 4, additive adjustment) -----
    po_val, po_parts = postseason_value(df, has_po)
    df["postseason_perf"] = po_val
    df["po_level_value"] = po_parts["po_level"]            # reliability-adjusted level
    df["po_elevation_value"] = po_parts["po_elevation"]   # vs own regular season
    df["po_deep_run_value"] = po_parts["po_deep_run"]     # sustained elite volume
    df["po_dominance_value"] = po_parts["po_dominance"]   # convex dominance bonus
    df["po_abs_level"] = po_parts["po_abs_level"]         # absolute level (pre-reliability)
    df["po_sample_reliab"] = po_parts["po_sample_reliab"]  # playoff-sample reliability
    df["po_elev_raw"] = po_parts["po_elev_raw"]           # raw elevation (pre-reliability)
    df["po_dominance_raw"] = po_parts["po_dominance_raw"]  # dominance (pre-reliability)
    df["po_series_n"] = po_parts["po_series_n"]           # series observed (sample signal)
    df["po_reg_rate"] = po_parts["po_reg_rate"]
    df["po_play_rate"] = po_parts["po_play_rate"]
    df["po_responsibility"] = po_parts["po_responsibility"]
    po_g, team_po_g = num(df, "po_g"), num(df, "team_po_g")
    po_mp_ = num(df, "po_mp")
    avail = (po_g / team_po_g).clip(0, 1) * 100.0
    avail = avail.where(team_po_g.notna() & (team_po_g > 0),
                        (po_mp_ / 500.0).clip(0, 1) * 100.0)
    df["postseason_availability"] = np.where(
        has_po, avail.clip(lower=80.0).fillna(85.0), 40.0)
    df["made_playoffs"] = has_po
    # playoff diagnostics for the report
    series_comp = num(df, "series_success_score")
    series_round = num(df, "playoff_round_score")
    df["series_observed"] = series_comp.notna() | series_round.notna()
    df["series_success"] = series_comp.fillna(series_round).fillna(50.0)
    opp = num(df, "opponent_quality_score")
    df["opponent_observed"] = opp.notna()
    df["opponent_quality"] = opp.fillna(50.0)
    df["playoff_impact"] = df["postseason_perf"]
    df["playoff_box"] = _hinge_value(num(df, "po_pts"), 18.0, 2.6)
    df["playoff_efficiency"] = _hinge_value(
        0.5 * num(df, "po_r_ts").fillna(0.0) +
        0.5 * (num(df, "po_ts_plus").fillna(100.0) - 100.0), 0.0, 6.0)
    # DISPLAY column mirrors the additive postseason value (0 when no playoffs);
    # never a positive default, so reports match the raw component.
    df["playoff"] = df["postseason_perf"]

    # ----- RECOGNITION (component 3) + ACCOLADES + TEAM ACHIEVEMENT -----------
    acc = df.apply(accolade_row, axis=1, result_type="expand")
    df = pd.concat([df, acc], axis=1)
    rec = df.apply(recognition_row, axis=1, result_type="expand")
    df = pd.concat([df, rec], axis=1)
    df["team_achievement"] = df.apply(team_achievement_row, axis=1)  # component 5

    # ----- TEAM CONTEXT + DURABILITY (diagnostics) ---------------------------
    if "playoff_round_score" in df.columns:
        df["playoff_round_pct"] = num(df, "playoff_round_score")
    df["team_score_raw"] = wavail(df, TEAM_SCORE_W)
    penalty = num(df, "teammate_penalty").fillna(0.0)
    df["team_score"] = (df["team_score_raw"] - penalty).clip(0, 100)
    df["durability"] = durability_series(df)

    # Teammate adjustment: DESCRIPTIVE, capped to +/-0.5 index points.
    tmadj = (num(df, "teammate_adjustment").fillna(0.0) * 0.10).clip(-0.5, 0.5)
    df["teammate_adjustment"] = tmadj

    # ----- WORKLOAD QUALIFICATION + PROVISIONAL FLAGS ------------------------
    g, mp, mpg = num(df, "g"), num(df, "mp"), num(df, "mpg")
    tg = df["season_end"].map(team_games)
    df["games_played_pct"] = (g / tg).clip(0, 1)
    df["workload_score"] = df["role_workload"]
    scale = tg / 82.0
    df["workload_qualified"] = (
        (mp >= 1800 * scale) & (mpg >= 28.0) & (g >= 0.60 * tg)).astype(int)
    df["season_complete"] = (g >= 0.92 * tg).astype(int)
    # ROBUST season-completion: a season is treated as COMPLETE only when a BROAD
    # set of rotation players have played a near-full schedule -- never because a
    # single iron-man reached the game count. We use the 90th-percentile games-
    # played fraction among real rotation players (mp >= 400 scaled), which
    # requires the top ~10% of the rotation (dozens of players) to be near a full
    # slate; a mid-season dataset leaves every player far short, so its p90 is low.
    rotation = (mp >= 400 * scale)
    gf_rot = df["games_played_pct"].where(rotation.values)
    prog = gf_rot.groupby(df["season_end"]).transform(
        lambda s: s.quantile(0.90) if s.notna().sum() >= 10 else np.nan)
    season_maxg = df.groupby("season_end")["g"].transform("max")
    # fallback only for tiny/old samples with too few rotation players
    prog = prog.fillna((season_maxg / tg).clip(0, 1))
    df["season_progress_pct"] = prog.clip(0, 1)
    df["provisional"] = (
        df["season_progress_pct"] < COMPLETED_SEASON_PROGRESS_CUTOFF).astype(int)

    # ===================================================================
    # ASSEMBLE THE OPEN WEIGHTED INDEX (sum of raw-value contributions)
    # ===================================================================
    W = OFFICIAL_WEIGHTS
    recog = num(df, "recognition")
    po_val = num(df, "postseason_perf")
    team_ach = num(df, "team_achievement")
    df["contrib_statistical_impact"] = W["statistical_impact"] * si
    df["contrib_traditional_production"] = W["traditional_production"] * tp
    df["contrib_recognition"] = W["recognition"] * recog
    df["contrib_postseason"] = W["postseason"] * po_val
    df["contrib_team_achievement"] = W["team_achievement"] * team_ach
    # per-metric raw contributions (for --trace-formula / score audits)
    si_share = W["statistical_impact"]
    df["contrib_bpm"] = si_share * (15.0 / 38.0) * si_parts["si_bpm"]
    df["contrib_vorp_ws"] = si_share * (10.0 / 38.0) * si_parts["si_vorp_ws"]
    df["contrib_ws48"] = si_share * (8.0 / 38.0) * si_parts["si_ws48"]
    df["contrib_per"] = si_share * (5.0 / 38.0) * si_parts["si_per"]
    df["contrib_scoring"] = W["traditional_production"] * 0.40 * tp_parts["scoring"]
    df["contrib_efficiency"] = W["traditional_production"] * 0.20 * tp_parts["efficiency"]

    # PERFORMANCE-ONLY index (no awards/team): statistical impact + production +
    # postseason individual value. OPEN sum of raw contributions.
    df["perf_only_raw"] = (df["contrib_statistical_impact"] +
                           df["contrib_traditional_production"] +
                           df["contrib_postseason"])
    # OFFICIAL PRIME index = full open weighted sum + small teammate adjustment.
    df["prime_raw"] = (df["contrib_statistical_impact"] +
                       df["contrib_traditional_production"] +
                       df["contrib_recognition"] +
                       df["contrib_postseason"] +
                       df["contrib_team_achievement"] + tmadj)
    df["recognition_bonus"] = df["contrib_recognition"]
    df["team_bonus"] = df["contrib_team_achievement"]
    # Monotonic calibration into interpretable historical bands (the OPEN raw
    # index is preserved separately so apex separation is never lost).
    df["performance_only"] = calibrate_score(df["perf_only_raw"])
    df["prime_score"] = calibrate_score(df["prime_raw"])
    df["perf_index"] = df["perf_only_raw"].round(2)
    df["prime_index"] = df["prime_raw"].round(2)
    df["regular_perf_score"] = df["regular_perf"]
    df["postseason_perf_score"] = df["postseason_perf"]
    df["recognition_score"] = df["recognition"]
    # Back-compat aliases so existing reporting/commands/tests keep working.
    df["stat_raw"] = df["perf_only_raw"]
    df["legacy_raw"] = df["prime_raw"]
    df["stat_total"] = df["performance_only"]
    df["legacy_total"] = df["prime_score"]

    # ----- Carry convenient raw stats for the report --------------------------
    out_cols = [
        "player", "team", "season", "season_start", "season_end",
        "stat_total", "legacy_total", "stat_raw", "legacy_raw",
        # ---- Prime architecture scores ----
        "performance_only", "prime_score", "perf_index", "prime_index",
        "perf_only_raw", "prime_raw",
        "regular_perf", "postseason_perf", "postseason_availability",
        "po_level_value", "po_elevation_value", "po_deep_run_value",
        "po_dominance_value", "po_abs_level", "po_sample_reliab",
        "po_elev_raw", "po_dominance_raw", "po_series_n", "po_g",
        "po_reg_rate", "po_play_rate", "po_responsibility",
        "recognition", "recognition_mvp", "recognition_titles", "unanimous_mvp",
        "team_achievement", "recognition_bonus", "team_bonus",
        "regular", "playoff", "accolade", "team_score", "durability",
        "regular_impact", "regular_box", "regular_efficiency",
        "regular_versatility", "regular_context",
        # ---- redesigned regular sub-components ----
        "rate_impact", "total_impact", "scoring_volume", "scoring_efficiency",
        "volume_efficiency", "scoring_dominance", "playmaking", "rebounding",
        "defense", "burden_residual", "usage_eff_residual", "creation_load",
        "creation_share", "role_workload", "role", "superstar_workload_flag",
        "specialty_value", "versatility_bonus", "primary_pathway",
        "workload_qualified", "workload_score", "games_played_pct",
        "season_complete", "provisional", "season_progress_pct",
        "mpg", "total_ws", "pts_per75", "ast_per75", "creation",
        "playoff_impact", "playoff_box", "playoff_efficiency",
        "series_success", "opponent_quality", "made_playoffs",
        "series_observed", "opponent_observed",
        "mvp_component", "finals_mvp_component", "all_nba_component",
        "defense_component", "championship_component", "titles_component",
        "teammate_adjustment",
        # ---- official five-component contributions (open weighted index) ----
        "statistical_impact", "traditional_production",
        "contrib_statistical_impact", "contrib_traditional_production",
        "contrib_recognition", "contrib_postseason", "contrib_team_achievement",
        "contrib_bpm", "contrib_vorp_ws", "contrib_ws48", "contrib_per",
        "contrib_scoring", "contrib_efficiency",
        "mp", "g", "po_mp",
        "obpm", "dbpm", "r_ts", "tov", "games_frac",
        "po_bpm", "po_vorp", "po_ws_per_48", "po_per", "po_pts", "po_ts_plus",
        "mvp_vote_share", "dpoy_vote_share",
        # ---- canonical completed-data fields + explicit data-status ----
        "team_scoring_share", "team_assist_share", "n_teams",
        "team_share_data_status", "burden_data_status",
        "mvp_vote_data_status", "dpoy_vote_data_status",
        "bpm", "vorp", "ws_per_48", "per", "ts_pct", "ts_plus",
        "pts", "trb", "ast", "stl", "blk", "stocks", "usg_pct", "ast_pct_raw",
        "epm", "lebron", "awards",
        # ---- enriched context (raw, for the report decomposition) ----
        "championship", "finals_mvp", "finals_appearance", "conf_finals",
        "best_player_title", "co_best_player_title", "title_team_role",
        "playoff_round", "playoff_round_score", "series_success_score",
        "opponent_quality_score", "playoff_path_difficulty",
        "elite_opponents_beaten", "teammate_strength_score",
        "mvp_rank", "dpoy_rank", "all_nba_team", "all_defense_team", "all_star",
        "scoring_title", "assist_title", "rebound_title", "steals_title",
        "blocks_title", "fifty_forty_ninety",
        "context_confidence", "context_warning_count",
        "_cov_observed", "_cov_estimated", "_cov_missing",
    ]
    out_cols = [c for c in out_cols if c in df.columns]
    scored = df[out_cols].copy()
    scored = scored.rename(columns={
        "pts": "pts_per100", "trb": "trb_per100", "ast": "ast_per100",
        "stl": "stl_per100", "blk": "blk_per100", "stocks": "stocks_per100",
    })
    return scored.reset_index(drop=True)


# ======================================================================
# WINDOWS + CONFIDENCE
# ======================================================================

def nyear_weights(n: int) -> List[float]:
    """
    Rank-weighted N-year weights (best season weighted most) with a documented
    minimum-weight floor so weak seasons are never made nearly irrelevant. This is
    the CANONICAL N-year aggregation (used by --years and the top-250 leaderboards):
        N=1 -> [1.000]
        N=2 -> [0.667, 0.333]
        N=3 -> [0.500, 0.333, 0.167]
        N=5 -> [0.323, 0.258, 0.194, 0.129, 0.097]
    The 2-year weights are this same rank-weight system evaluated at N=2, NOT a
    separate 60/40 rule.
    """
    if n <= 1:
        return [1.0]
    base = np.array([n - i for i in range(n)], dtype=float)
    w = base / base.sum()
    floor = 0.5 / n                      # minimum-weight floor (documented)
    w = np.maximum(w, floor)
    return (w / w.sum()).tolist()


def _drop_provisional(player_df: pd.DataFrame, include_provisional: bool
                      ) -> pd.DataFrame:
    """Remove PROVISIONAL/incomplete seasons from official ranking inputs so they
    cannot win best-season results or enter completed N-year windows."""
    if include_provisional or "provisional" not in player_df.columns:
        return player_df
    nonprov = player_df[player_df["provisional"] != 1]
    return nonprov if len(nonprov) else player_df


def n_year_windows(player_df: pd.DataFrame, score_col: str, n: int,
                   weighting: str = "weighted",
                   include_provisional: bool = False) -> List[Dict]:
    """Every eligible CONSECUTIVE n-season window, ranked best->worst.
    PROVISIONAL seasons are excluded unless include_provisional=True."""
    player_df = _drop_provisional(player_df, include_provisional)
    pdf = player_df.sort_values("season_end").reset_index(drop=True)
    years = pdf["season_end"].astype(int).tolist()
    rw = nyear_weights(n)
    windows = []
    for i in range(len(pdf) - n + 1):
        grp = pdf.iloc[i:i + n]
        y = years[i:i + n]
        if y != list(range(y[0], y[0] + n)):     # require consecutive seasons
            continue
        vals = grp[score_col].tolist()
        ordered = sorted(vals, reverse=True)
        weighted = float(sum(w * v for w, v in zip(rw, ordered)))
        equal = float(np.mean(vals))
        peak = equal if weighting == "equal" else weighted
        windows.append({
            "n": n,
            "start_season": grp.iloc[0]["season"],
            "end_season": grp.iloc[-1]["season"],
            "seasons": grp["season"].tolist(),
            "peak_score": peak,
            "weighted_score": weighted,
            "equal_avg": equal,
            "min_season": float(min(vals)),
            "max_season": float(max(vals)),
            "variance": float(np.var(vals)),
            "df": grp.copy(),
        })
    windows.sort(key=lambda w: w["peak_score"], reverse=True)
    return windows


def three_year_windows(player_df: pd.DataFrame, score_col: str,
                       weighting: str = "weighted",
                       include_provisional: bool = False) -> List[Dict]:
    """Best consecutive 3-season windows. PROVISIONAL seasons are excluded from
    official windows unless include_provisional=True."""
    player_df = _drop_provisional(player_df, include_provisional)
    pdf = player_df.sort_values("season_end").reset_index(drop=True)
    years = pdf["season_end"].astype(int).tolist()
    windows = []
    for i in range(len(pdf) - 2):
        trio = pdf.iloc[i:i + 3]
        y = years[i:i + 3]
        if y != [y[0], y[0] + 1, y[0] + 2]:
            continue
        vals = trio[score_col].tolist()
        scores = sorted(vals, reverse=True)
        weighted = 0.40 * scores[0] + 0.35 * scores[1] + 0.25 * scores[2]
        equal = float(np.mean(vals))
        peak = equal if weighting == "equal" else weighted
        windows.append({
            "start_season": trio.iloc[0]["season"],
            "end_season": trio.iloc[-1]["season"],
            "seasons": trio["season"].tolist(),
            "peak_score": peak,
            "weighted_score": weighted,
            "equal_avg": equal,
            "min_season": float(min(vals)),
            "variance": float(np.var(vals)),
            "df": trio.copy(),
        })
    windows.sort(key=lambda w: w["peak_score"], reverse=True)
    return windows


def best_window(player_df: pd.DataFrame, score_col: str,
                weighting: str = "weighted",
                include_provisional: bool = False) -> Optional[Dict]:
    w = three_year_windows(player_df, score_col, weighting, include_provisional)
    return w[0] if w else None


CORE_COLS = ["bpm", "vorp", "ws_per_48", "per", "ts_plus", "regular",
             "playoff", "team_score", "durability"]
OPTIONAL_COLS = ["epm", "lebron", "series_success", "opponent_quality",
                 "finals_mvp_component"]


def confidence(window_df: pd.DataFrame, flags: Dict[str, bool],
               made_playoffs_any: bool) -> Tuple[str, float]:
    avail = total = 0.0
    for _, row in window_df.iterrows():
        for c in CORE_COLS:
            total += 1.0
            if c in row.index and pd.notna(row.get(c)):
                avail += 1.0
    # Optional metrics count lightly and never tank older players.
    optional_present = 0
    if flags.get("external_impact"):
        optional_present += 1
    if flags.get("manual_context"):
        optional_present += 1
    if made_playoffs_any:
        optional_present += 1
    ratio = (avail / total if total else 0.0)
    ratio = 0.85 * ratio + 0.15 * (optional_present / 3.0)
    label = "High" if ratio >= 0.85 else "Medium" if ratio >= 0.65 else "Low"
    return label, ratio


# ======================================================================
# REPORTING
# ======================================================================

BAR = "=" * 72


def fmt(v, nd=2):
    try:
        if pd.isna(v):
            return "-"
        return f"{float(v):.{nd}f}"
    except Exception:
        return str(v)


def season_table(df: pd.DataFrame, mode: str) -> str:
    cols = [("season", "Season", 9), ("team", "Tm", 5)]
    if mode in ("stat", "both"):
        cols += [("stat_total", "Stat", 6)]
    if mode in ("legacy", "both"):
        cols += [("legacy_total", "Legacy", 7)]
    cols += [("regular", "Reg", 6), ("playoff", "PO", 6)]
    if mode in ("legacy", "both"):
        cols += [("accolade", "Accol", 6)]
    cols += [("team_score", "Team", 6), ("durability", "Dur", 5),
             ("bpm", "BPM", 6), ("vorp", "VORP", 6), ("ws_per_48", "WS/48", 6),
             ("per", "PER", 6), ("ts_plus", "TS+", 6),
             ("pts_per100", "PTS", 6), ("ast_per100", "AST", 6),
             ("trb_per100", "TRB", 6), ("stocks_per100", "STK", 6)]
    cols = [(c, h, w) for c, h, w in cols if c in df.columns]
    header = " ".join(h.ljust(w) for _, h, w in cols)
    lines = [header]
    for _, r in df.sort_values("season_end").iterrows():
        cells = []
        for c, _h, w in cols:
            v = r.get(c)
            if c in ("season", "team"):
                cells.append(str(v).ljust(w))
            elif c in ("bpm", "vorp", "ws_per_48", "ts_pct"):
                cells.append(fmt(v, 3 if c == "ws_per_48" else 1).ljust(w))
            else:
                cells.append(fmt(v, 1).ljust(w))
        lines.append(" ".join(cells))
    return "\n".join(lines)


def explain_window(window: Dict, others: List[Dict], score_col: str,
                   mode_name: str) -> List[str]:
    df = window["df"].sort_values(score_col, ascending=False)
    top = df.iloc[0]
    bullets = []
    bullets.append(
        f"{top['season']} was the anchor season "
        f"({mode_name} {fmt(top[score_col],1)}; regular {fmt(top['regular'],1)}, "
        f"playoff {fmt(top['playoff'],1)}).")
    # Highest single advanced markers in window.
    if "bpm" in df.columns and df["bpm"].notna().any():
        b = df.loc[df["bpm"].idxmax()]
        bullets.append(f"Peak BPM {fmt(b['bpm'],1)} in {b['season']}; "
                       f"VORP {fmt(b.get('vorp'),1)}, WS/48 {fmt(b.get('ws_per_48'),3)}.")
    # Playoff translation.
    made = df[df.get("made_playoffs", pd.Series([True]*len(df), index=df.index)) == True]
    if len(made):
        pavg = made["playoff"].mean()
        bullets.append(f"Playoff translation averaged {fmt(pavg,1)} across "
                       f"{len(made)} postseason run(s) in the window.")
    if mode_name == "Legacy":
        if "accolade" in df.columns:
            bullets.append(f"Accolade load averaged {fmt(df['accolade'].mean(),1)} "
                           f"(MVP/All-NBA/All-D/titles).")
        rings = int(num(df, "championship").fillna(0).sum()) if "championship" in df.columns else 0
        fmvps = int(num(df, "finals_mvp").fillna(0).sum()) if "finals_mvp" in df.columns else 0
        fin = int(num(df, "finals_appearance").fillna(0).sum()) if "finals_appearance" in df.columns else 0
        if rings or fin:
            bullets.append(f"Postseason: {rings} championship(s), {fmvps} Finals MVP(s), "
                           f"{fin} Finals appearance(s) in the window (auto-derived).")
        if "opponent_quality_score" in df.columns and num(df, "opponent_quality_score").notna().any():
            bullets.append(f"Avg playoff opponent quality "
                           f"{fmt(num(df,'opponent_quality_score').mean(),1)}; "
                           f"path difficulty {fmt(num(df,'playoff_path_difficulty').mean(),1)}.")
        if "teammate_adjustment" in df.columns and num(df, "teammate_adjustment").abs().sum() > 0.01:
            bullets.append(f"Teammate adjustment averaged "
                           f"{fmt(num(df,'teammate_adjustment').mean(),2)} pts "
                           f"(weak cast=+, stacked cast=-, capped ±5).")
    # Margin over the next window.
    if others:
        nxt = others[0]
        bullets.append(
            f"Edged the next-best window {nxt['start_season']}–{nxt['end_season']} "
            f"({fmt(window['peak_score'],2)} vs {fmt(nxt['peak_score'],2)}).")
    return bullets


def collect_warnings(player_df: pd.DataFrame, flags: Dict[str, bool]) -> List[str]:
    w = []
    if not flags.get("external_impact") or player_df.get("epm", pd.Series(dtype=float)).isna().all():
        w.append("EPM/LEBRON unavailable for these seasons; 100% historical "
                 "impact (BPM/VORP/WS-48/PER) was used. Not penalized.")
    if flags.get("auto_context"):
        if not flags.get("manual_context"):
            w.append("Context (championships, Finals MVP, rounds, opponent "
                     "quality, series success, stat titles, teammates) is "
                     "AUTO-DERIVED from Basketball Reference brackets/awards. "
                     "Add data/manual_context.csv only to override specific values.")
    else:
        w.append("Automatic context cache not found: run "
                 "'python peak3.py --build-context'. Legacy context is currently "
                 "estimated from the Awards column only.")
    if "made_playoffs" in player_df.columns and (~player_df["made_playoffs"].astype(bool)).any():
        missed = player_df[~player_df["made_playoffs"].astype(bool)]["season"].tolist()
        w.append("Missed playoffs (postseason individual value = 0, no penalty; "
                 f"team achievement = 0): {', '.join(missed)}.")
    if "team_score" in player_df.columns and player_df["team_score"].eq(50.0).all():
        w.append("Team ratings (SRS/Net/Wins) missing or neutral for these "
                 "seasons; team context defaulted to neutral.")
    return w


FORMULA_TEXT = """\
FORMULA  (OPEN FIVE-COMPONENT WEIGHTED RAW-VALUE INDEX; not percentile-based)
  prime_raw =
      0.38 * Statistical Impact        (raw advanced metrics: BPM/OBPM/DBPM,
                                         VORP + total WS, WS/48, PER, modern EPM/LEBRON)
    + 0.21 * Traditional Production    (nonlinear scoring volume x efficiency, playmaking,
                                         rebounding, box defense; raw box stats; PLUS a small
                                         bounded SUCCESSFUL-BURDEN RESIDUAL -- creation load x
                                         positive usage-adjusted efficiency x workload -- where
                                         creation load uses ACTUAL team scoring/assist shares
                                         (USG%/AST% proxy only as a flagged fallback). Replaces
                                         the old raw heavy-usage bonus: usage alone earns nothing
                                         and inefficient volume is not rewarded)
    + 0.20 * Individual Recognition    (additive grouped awards. Ranked voting awards (MVP, DPOY)
                                         use a SMOOTH curve: a WINNER PREMIUM + continuous vote
                                         share (REAL award_share from Basketball Reference where
                                         available -- all ranked awards-era seasons; documented
                                         smooth placement FALLBACK only where a vote row is
                                         missing) + a small stabilizer -- no placement buckets/
                                         cliffs (1st clearly > 2nd; 2nd..10th decline smoothly).
                                         Plus All-NBA, All-D, Finals MVP (binary, no runner-up),
                                         stat titles, 50-40-90, unanimous MVP, with overlap
                                         discounts; NO championship/team result; no award = ZERO)
    + 0.18 * Postseason Individual Value = absolute_playoff_level + playoff_elevation + sustained_elite_volume + dominance_bonus
                                         PLAYOFF-SAMPLE RELIABILITY (minutes x games x
                                           series) shrinks the whole upper tail so an extreme
                                           rate stat over a SHORT run cannot dwarf a complete run;
                                         absolute_playoff_level: raw playoff quality (BPM/WS48/
                                           PER rate, scoring, efficiency, playmaking, rebounding,
                                           defense, minutes) above a replacement baseline, LINEAR
                                           in level and reliability-adjusted (strong adds, weak =
                                           small bounded penalty);
                                         playoff_elevation: playoff rate impact - regular rate
                                           impact (gains rewarded, decline from an extreme baseline
                                           damped, sample-shrunk); supplements, never replaces level;
                                         sustained_elite_volume: elite quality x sustained minutes
                                           AND games x best-player RESPONSIBILITY (usage burden,
                                           from data) -- a ring with ordinary production adds little;
                                         dominance_bonus: DIMINISHING-return (sqrt) bonus on the
                                           level above an elite knee, reliability-shrunk -- replaces
                                           the old open-ended linear booster so the tail cannot run
                                           away (HISTORICALLY DOMINANT, Finals-length runs only);
                                         NO playoffs = 0; injury shrinks toward 0; availability
                                         counted ONCE; NO championship / round / Finals MVP here)
    + 0.03 * Team Achievement          (ZERO baseline; a SMOOTH bounded advancement value
                                         (series won / round reached / championship, interpolated
                                         -- not 0/50/100 buckets) x a role-responsibility
                                         multiplier (primary > co-star > secondary > role player,
                                         graded by creation burden); first-round exit / no playoffs
                                         = 0; NO Finals MVP and NO individual playoff box score here)
    + teammate_adjustment              (descriptive, capped +/-0.5 index points)

  Each component is a RAW additive points value (continuous formulas on raw basketball
  units -- no percentiles, no z-scores, no 0-100 landmark caps inside the index).

  REPORTING DISTINGUISHES:
    raw metric            a raw stat (e.g. BPM = 11.8)
    metric contribution   that metric's points into its component (_impact_value/_hinge_value)
    component score       the assembled component (statistical_impact, traditional_production,
                          recognition, postseason_perf, team_achievement)
    weighted Prime contrib  weight * component  (contrib_* columns; these sum to prime_raw)
    display score         prime_score = calibrate_score(prime_raw), a separate MONOTONIC
                          rescale of prime_raw into interpretable 0-100 historical bands

  N-Year windows (canonical, used by --years and the top-250 leaderboards):
    RAW season prime_raw values are RANK-weighted FIRST with nyear_weights(N)
    (best season weighted most, with a documented minimum-weight floor), then the
    aggregated RAW window score is calibrated ONCE -- calibrated display scores are
    NEVER averaged. The weights are:
        1yr [1.00]
        2yr [0.667, 0.333]            (best, second; the rank-weight system at N=2,
                                        NOT a separate 60/40 rule)
        3yr [0.500, 0.333, 0.167]
        5yr [0.323, 0.258, 0.194, 0.129, 0.097]
    --window-weighting equal uses the mean of the N seasons instead.
    (The legacy per-player --best-window / default 3-year report uses the older
    0.40/0.35/0.25 family; the canonical leaderboards and --years use nyear_weights.)
  Completed-season eligibility: only completed, NON-PROVISIONAL seasons feed
  best-season, leaderboard and N-year-window results. The 2025-26 season is treated
  as COMPLETE once its field-by-field completeness checks pass (see
  nba_peak/season_completeness.py); an in-progress season would be flagged
  PROVISIONAL and excluded.

  Postseason / team context (championship, Finals MVP, round reached, opponent quality,
  series success) is AUTO-DERIVED from Basketball Reference playoff brackets. Manual CSV
  files override automatic values; nothing is fabricated silently.
"""


# --- additive decomposition of the LEGACY window score into named buckets ---
# Buckets sum exactly to the weighted (or equal) window legacy score.
def _season_weights(trio: pd.DataFrame, score_col: str, weighting: str) -> List[float]:
    if weighting == "equal":
        return [1 / 3, 1 / 3, 1 / 3] * 1, None
    order = trio[score_col].rank(ascending=False, method="first")
    wmap = {1.0: 0.40, 2.0: 0.35, 3.0: 0.25}
    return [wmap[o] for o in order.tolist()], order


def window_buckets(window: Dict, weighting: str = "weighted") -> Dict[str, float]:
    """
    Additive decomposition of the RAW (open-index) legacy window score into the
    five official components plus the teammate adjustment. The buckets sum
    EXACTLY to the season-weighted legacy_raw (= prime_raw) window score.
    Calibration is a separate monotonic final rescale (see calibrate_score).
    """
    trio = window["df"]
    rank_col = "legacy_total" if "legacy_total" in trio.columns else "legacy_raw"
    weights, _ = _season_weights(trio, rank_col, weighting)

    def g(r, c, d=0.0):
        v = r.get(c)
        return float(v) if pd.notna(v) else d

    buckets = {k: 0.0 for k in (
        "Statistical impact (38%)", "Traditional production (21%)",
        "Individual recognition (20%)", "Postseason individual (18%)",
        "Team achievement (3%)", "Teammate adjustment")}
    for w, (_, r) in zip(weights, trio.iterrows()):
        buckets["Statistical impact (38%)"] += w * g(r, "contrib_statistical_impact")
        buckets["Traditional production (21%)"] += w * g(r, "contrib_traditional_production")
        buckets["Individual recognition (20%)"] += w * g(r, "contrib_recognition")
        buckets["Postseason individual (18%)"] += w * g(r, "contrib_postseason")
        buckets["Team achievement (3%)"] += w * g(r, "contrib_team_achievement")
        buckets["Teammate adjustment"] += w * g(r, "teammate_adjustment")
    return buckets


def nyear_window_decomposition(window: Dict, score_col: str,
                               weighting: str = "weighted") -> Dict[str, float]:
    """
    General N-year (N>=1) additive decomposition consistent with
    n_year_windows(): each season is weighted by its RANK within the window using
    nyear_weights(n) (best season weighted most), or 1/n when weighting=='equal'.
    The five weighted component contributions plus the teammate adjustment sum
    EXACTLY to the rank-weighted RAW window score (prime_raw / legacy_raw).
    Also returns descriptive per-window aggregates for reporting.
    """
    wdf = window["df"].copy()
    n = len(wdf)
    raw_col = "prime_raw" if "prime_raw" in wdf.columns else "legacy_raw"
    if weighting == "equal":
        weights = pd.Series([1.0 / n] * n, index=wdf.index)
    else:
        rw = nyear_weights(n)
        ranks = wdf[score_col].rank(ascending=False, method="first").astype(int)
        weights = ranks.map(lambda r: rw[r - 1])

    def g(c, d=0.0):
        return pd.to_numeric(wdf.get(c), errors="coerce").fillna(d) if c in wdf \
            else pd.Series([d] * n, index=wdf.index)

    comps = {
        "Statistical impact (38%)": float((weights * g("contrib_statistical_impact")).sum()),
        "Traditional production (21%)": float((weights * g("contrib_traditional_production")).sum()),
        "Individual recognition (20%)": float((weights * g("contrib_recognition")).sum()),
        "Postseason individual (18%)": float((weights * g("contrib_postseason")).sum()),
        "Team achievement (3%)": float((weights * g("contrib_team_achievement")).sum()),
        "Teammate adjustment": float((weights * g("teammate_adjustment")).sum()),
    }
    comps["_raw_window_score"] = float((weights * g(raw_col)).sum())
    # descriptive aggregates (unweighted) for the report
    comps["avg_statistical_impact"] = float(g("statistical_impact").mean())
    comps["avg_traditional_production"] = float(g("traditional_production").mean())
    comps["total_postseason_contrib"] = float(g("contrib_postseason").sum())
    comps["total_recognition_contrib"] = float(g("contrib_recognition").sum())
    comps["total_team_contrib"] = float(g("contrib_team_achievement").sum())
    return comps


def decompose_difference(win_a: Dict, win_b: Dict, weighting: str) -> List[str]:
    a, b = window_buckets(win_a, weighting), window_buckets(win_b, weighting)
    total = sum(a.values()) - sum(b.values())
    lines = [f"{win_a['start_season']} to {win_a['end_season']} beat "
             f"{win_b['start_season']} to {win_b['end_season']} by "
             f"{total:+.2f} RAW legacy points (calibrated scores: "
             f"{win_a['peak_score']:.2f} vs {win_b['peak_score']:.2f})", "",
             "Difference on the raw scale (sums to the raw total):"]
    for k in a:
        d = a[k] - b[k]
        if abs(d) >= 0.005:
            lines.append(f"  {k:32} {d:+.2f}")
    return lines


CTX_OBJECTIVE = ["championship", "finals_appearance", "conf_finals",
                 "finals_mvp", "playoff_round_score", "all_star"]
CTX_DERIVED_PLAYOFF = ["opponent_quality_score", "series_success_score",
                       "playoff_path_difficulty"]


def coverage_breakdown(window_df: pd.DataFrame) -> Tuple[float, float, float]:
    observed = estimated = missing = 0
    for _, r in window_df.iterrows():
        for f in CTX_OBJECTIVE:
            if f in r.index:
                observed += 1
        made = bool(r.get("made_playoffs", False))
        if made:
            for f in CTX_DERIVED_PLAYOFF:
                if f in r.index:
                    estimated += 1 if pd.notna(r.get(f)) else 0
                    missing += 0 if pd.notna(r.get(f)) else 1
        # teammate strength applies every season
        if "teammate_strength_score" in r.index:
            if pd.notna(r.get("teammate_strength_score")):
                estimated += 1
            else:
                missing += 1
    tot = observed + estimated + missing
    if tot == 0:
        return 100.0, 0.0, 0.0
    return (100.0 * observed / tot, 100.0 * estimated / tot, 100.0 * missing / tot)


SENSITIVITY_VARIANTS = [
    # name, (wR, wP, wA, wT, wD), use_teammate, weighting
    ("default", (.45, .25, .15, .10, .05), True, "weighted"),
    ("regular-focused", (.60, .20, .08, .08, .04), True, "weighted"),
    ("playoff-focused", (.35, .40, .12, .08, .05), True, "weighted"),
    ("accolade-focused", (.35, .20, .30, .10, .05), True, "weighted"),
    ("equal-season-weighting", (.45, .25, .15, .10, .05), True, "equal"),
    ("no-teammate-adjustment", (.45, .25, .15, .10, .05), False, "weighted"),
    ("balanced", (.40, .30, .20, .07, .03), True, "weighted"),
    ("historical-core-only (≈statistical)", (.55, .30, .00, .10, .05), False, "weighted"),
]


def sensitivity_analysis(player_df: pd.DataFrame) -> Dict:
    pdf = player_df.copy()
    results = {}
    win_counts: Dict[str, int] = {}
    score_ranges: Dict[str, List[float]] = {}
    for name, (wR, wP, wA, wT, wD), use_tm, weighting in SENSITIVITY_VARIANTS:
        s = (wR * num(pdf, "regular") + wP * num(pdf, "playoff") +
             wA * num(pdf, "accolade") + wT * num(pdf, "team_score") +
             wD * num(pdf, "durability"))
        if use_tm:
            s = s + num(pdf, "teammate_adjustment").fillna(0.0)
        tmp = pdf.copy()
        tmp["_variant"] = s.clip(0, 100)
        w = best_window(tmp, "_variant", weighting)
        if not w:
            continue
        label = f"{w['start_season']} to {w['end_season']}"
        win_counts[label] = win_counts.get(label, 0) + 1
        for ww in three_year_windows(tmp, "_variant", weighting):
            lab = f"{ww['start_season']} to {ww['end_season']}"
            score_ranges.setdefault(lab, []).append(ww["peak_score"])
        results[name] = label
    return {"per_variant": results, "win_counts": win_counts,
            "score_ranges": score_ranges, "n_variants": len(SENSITIVITY_VARIANTS)}


SEASON_COMPONENTS = [
    ("rate_impact", "Rate impact"), ("total_impact", "Total impact"),
    ("scoring_dominance", "Scoring dominance"), ("scoring_volume", "Scoring volume"),
    ("scoring_efficiency", "Efficiency"), ("volume_efficiency", "Vol×Eff interaction"),
    ("playmaking", "Playmaking"), ("rebounding", "Rebounding"),
    ("defense", "Defense"), ("role_workload", "Role/workload"),
    ("regular", "Regular (sum)"), ("playoff", "Playoffs"),
    ("accolade", "Accolades"), ("team_score", "Team"),
    ("teammate_adjustment", "Teammate adj"), ("durability", "Durability"),
]


def explain_season(row: pd.Series, mode_name: str, pool: pd.DataFrame) -> List[str]:
    """Data-derived reasons a single season scored as it did."""
    se = int(row["season_end"])
    season_pool = pool[pool["season_end"] == se]

    def pctl(col):
        vals = pd.to_numeric(season_pool[col], errors="coerce").dropna()
        v = row.get(col)
        if not len(vals) or pd.isna(v):
            return None
        return 100.0 * (vals <= v).mean()

    b = []
    bp, vp = pctl("bpm"), pctl("vorp")
    if bp is not None and vp is not None:
        b.append(f"Ranked {bp:.0f}th pct in BPM and {vp:.0f}th in VORP among "
                 f"qualifiers that season.")
    if pd.notna(row.get("ts_plus")):
        b.append(f"Scoring at {fmt(row.get('pts_per75'),1)} pts/75 on "
                 f"{fmt(row.get('ts_plus'),1)} TS+ "
                 f"(volume×efficiency score {fmt(row.get('volume_efficiency'),0)}).")
    if pd.notna(row.get("role_workload")):
        b.append(f"Role/workload score {fmt(row.get('role_workload'),0)} "
                 f"({row.get('role','?')}, {fmt(row.get('mpg'),1)} mpg, "
                 f"{'workload-qualified' if int(row.get('workload_qualified',0)) else 'below full-workload bar'}).")
    if pd.notna(row.get("defense")) and row.get("defense", 0) >= 75:
        b.append(f"Strong statistical defense ({fmt(row.get('defense'),0)} pct).")
    if int(row.get("made_playoffs", 0)):
        b.append(f"Playoff score {fmt(row.get('playoff'),1)} "
                 f"(opponent quality {fmt(row.get('opponent_quality'),0)}).")
    if mode_name == "Legacy" and pd.notna(row.get("accolade")):
        extra = []
        if pd.notna(row.get("mvp_rank")):
            extra.append(f"MVP-{int(row['mvp_rank'])}")
        if pd.notna(row.get("all_nba_team")):
            extra.append(f"All-NBA {int(row['all_nba_team'])}")
        if int(row.get("championship", 0) or 0):
            extra.append("champion")
        if int(row.get("finals_mvp", 0) or 0):
            extra.append("Finals MVP")
        b.append(f"Accolade score {fmt(row.get('accolade'),0)}"
                 + (f" ({', '.join(extra)})." if extra else "."))
    if int(row.get("provisional", 0) or 0):
        b.append("NOTE: provisional/incomplete season.")
    return b


def best_single_season(player_df: pd.DataFrame, col: str,
                       include_provisional: bool = False):
    df = player_df
    if not include_provisional and "provisional" in df.columns:
        nonprov = df[df["provisional"] != 1]
        if len(nonprov):
            df = nonprov
    return df.loc[df[col].idxmax()]


def non_consecutive_top3(player_df: pd.DataFrame, col: str):
    top = player_df.sort_values(col, ascending=False).head(3)
    sc = sorted(top[col].tolist(), reverse=True)
    while len(sc) < 3:
        sc.append(sc[-1] if sc else 0.0)
    score = 0.40 * sc[0] + 0.35 * sc[1] + 0.25 * sc[2]
    return top.sort_values("season_end"), score


def print_best_season(player_df: pd.DataFrame, col: str, mode_name: str,
                      include_provisional: bool):
    row = best_single_season(player_df, col, include_provisional)
    print(f"\nBEST SINGLE {mode_name.upper()} SEASON")
    print(f"Season: {row['season']} ({row.get('team','')})   "
          f"Score: {row[col]:.2f}")
    print(f"Role: {row.get('role','?')}   "
          f"Workload: {'qualified' if int(row.get('workload_qualified',0)) else 'below full bar'}"
          f"   Provisional: {'yes' if int(row.get('provisional',0) or 0) else 'no'}")
    print("Breakdown:")
    for c, lab in SEASON_COMPONENTS:
        if c in row.index and pd.notna(row.get(c)):
            if mode_name == "Statistical" and c in ("accolade", "teammate_adjustment"):
                continue
            print(f"  {lab:22} {float(row[c]):6.2f}")
    print("Why this season won:")
    for b in explain_season(row, mode_name, player_df):
        print(f"  - {b}")
    return row


def report_single(player: str, player_df: pd.DataFrame, mode: str,
                  flags: Dict[str, bool], weighting: str = "weighted",
                  do_sensitivity: bool = False,
                  include_provisional: bool = False,
                  cand_status: Optional[Dict] = None) -> Dict:
    made_any = bool(player_df.get("made_playoffs", pd.Series([False])).any())

    stat_windows = three_year_windows(player_df, "stat_total", weighting,
                                      include_provisional)
    legacy_windows = three_year_windows(player_df, "legacy_total", weighting,
                                       include_provisional)

    print("\n" + BAR)
    print(f"PLAYER: {player}")
    if cand_status:
        print(f"CORE DATASET: YES   CONTEXT CANDIDATE: "
              f"{'YES' if cand_status.get('candidate') else 'NO'}   "
              f"CONTEXT STATUS: {cand_status.get('status','CORE_ONLY')}"
              + (f"   (Tier {cand_status['tier']})" if cand_status.get('tier') else ""))
    if stat_windows:
        label, ratio = confidence(stat_windows[0]["df"], flags, made_any)
        print(f"DATA CONFIDENCE: {label} ({ratio:.0%})")
    print(f"SEASONS ANALYZED: {len(player_df)} qualifying "
          f"({player_df['season'].min()} .. {player_df['season'].max()})")
    if legacy_windows and flags.get("auto_context"):
        obs, est, mis = coverage_breakdown(legacy_windows[0]["df"])
        print(f"CONTEXT COVERAGE (legacy peak window): "
              f"Observed {obs:.0f}%  Estimated {est:.0f}%  Missing {mis:.0f}%")
    print(f"WINDOW WEIGHTING: {weighting}")
    print(BAR)

    export = {"player": player}

    # ---- BEST SINGLE SEASONS (1) and (2) ----
    if mode in ("stat", "both"):
        srow = print_best_season(player_df, "stat_total", "Statistical",
                                 include_provisional)
        export["best_stat_season"] = {"season": srow["season"],
                                      "score": round(float(srow["stat_total"]), 2)}
    if mode in ("legacy", "both"):
        lrow = print_best_season(player_df, "legacy_total", "Legacy",
                                 include_provisional)
        export["best_legacy_season"] = {"season": lrow["season"],
                                        "score": round(float(lrow["legacy_total"]), 2)}

    # ---- SUPPLEMENTAL: best NON-consecutive 3 seasons (official peak stays 3yr) ----
    def _nonconsec(col, label):
        trio, sc = non_consecutive_top3(player_df, col)
        seasons = ", ".join(trio["season"].tolist())
        print(f"\nBEST NON-CONSECUTIVE 3-SEASON {label} SET (supplemental): "
              f"{seasons}  score {sc:.2f}")
    if mode in ("stat", "both"):
        _nonconsec("stat_total", "STATISTICAL")
    if mode in ("legacy", "both"):
        _nonconsec("legacy_total", "LEGACY")

    if mode in ("stat", "both") and stat_windows:
        bw = stat_windows[0]
        print("\nBEST STATISTICAL 3-YEAR PEAK")
        print(f"Window: {bw['start_season']} to {bw['end_season']}")
        print(f"P3Y Statistical Score: {bw['peak_score']:.2f}")
        print("\nSeason breakdown:")
        print(season_table(bw["df"], "stat"))
        print("\nWhy this window won:")
        for b in explain_window(bw, stat_windows[1:], "stat_total", "Stat"):
            print(f"  - {b}")
        export["stat_peak"] = window_export(bw, "stat_total")

    if mode in ("legacy", "both") and legacy_windows:
        bw = legacy_windows[0]
        print("\nBEST LEGACY-ADJUSTED 3-YEAR PEAK")
        print(f"Window: {bw['start_season']} to {bw['end_season']}")
        print(f"P3Y Legacy Score: {bw['peak_score']:.2f}")
        print("\nSeason breakdown:")
        print(season_table(bw["df"], "legacy"))
        print("\nWhy this window won:")
        for b in explain_window(bw, legacy_windows[1:], "legacy_total", "Legacy"):
            print(f"  - {b}")
        export["legacy_peak"] = window_export(bw, "legacy_total")

    if mode == "both" and stat_windows and legacy_windows:
        s, l = stat_windows[0], legacy_windows[0]
        print("\nCOMPARISON (Statistical vs Legacy)")
        if s["seasons"] == l["seasons"]:
            print(f"  Both methods agree on {s['start_season']}–{s['end_season']}: "
                  "the statistical peak is also the accolade peak.")
        else:
            print(f"  Statistical peak: {s['start_season']}–{s['end_season']}; "
                  f"Legacy peak: {l['start_season']}–{l['end_season']}.")
            print("  They differ because the legacy window carries more "
                  "MVP/All-NBA/championship weight, which can outrank a "
                  "statistically louder but less-decorated stretch.")

    # ---- window difference decomposition (legacy) ----
    if mode in ("legacy", "both") and len(legacy_windows) >= 2:
        print("\nLEGACY WINDOW DECOMPOSITION")
        winner = legacy_windows[0]
        runner = legacy_windows[1]
        for line in decompose_difference(winner, runner, weighting):
            print(f"  {line}" if line else "")
        # If the statistical winner differs, decompose against it too.
        if stat_windows and stat_windows[0]["seasons"] != winner["seasons"]:
            alt = next((w for w in legacy_windows
                        if w["seasons"] == stat_windows[0]["seasons"]), None)
            if alt is not None and alt["seasons"] != runner["seasons"]:
                print("\n  vs the statistical-peak window:")
                for line in decompose_difference(winner, alt, weighting):
                    print(f"  {line}" if line else "")

    if mode in ("stat", "both"):
        print("\nALL CONSECUTIVE STATISTICAL WINDOWS (best first)")
        for i, w in enumerate(stat_windows, 1):
            print(f"  {i:2}. {w['start_season']}–{w['end_season']}  "
                  f"score {w['peak_score']:.2f}  (min season {w['min_season']:.1f})")
    if mode in ("legacy", "both"):
        print("\nALL CONSECUTIVE LEGACY WINDOWS (best first)")
        for i, w in enumerate(legacy_windows, 1):
            print(f"  {i:2}. {w['start_season']}–{w['end_season']}  "
                  f"score {w['peak_score']:.2f}  (equal-avg {w['equal_avg']:.1f}, "
                  f"min {w['min_season']:.1f})")

    # ---- sensitivity analysis ----
    if do_sensitivity:
        sa = sensitivity_analysis(player_df)
        print("\nSENSITIVITY ANALYSIS (legacy window across formula variants)")
        for name, _w, _t, _wt in SENSITIVITY_VARIANTS:
            print(f"  {name:38} -> {sa['per_variant'].get(name, '-')}")
        print("\n  Window                          Wins Across Models   Score range")
        ordered = sorted(sa["win_counts"].items(), key=lambda x: -x[1])
        for lab, cnt in ordered:
            rng = sa["score_ranges"].get(lab, [])
            rng_s = f"{min(rng):.1f}–{max(rng):.1f}" if rng else "-"
            print(f"  {lab:30} {cnt}/{sa['n_variants']:<18} {rng_s}")
        export["sensitivity"] = {"win_counts": sa["win_counts"],
                                 "per_variant": sa["per_variant"]}

    warns = collect_warnings(player_df, flags)
    if warns:
        print("\nWARNINGS / MISSING DATA")
        for x in warns:
            print(f"  - {x}")

    print("\n" + FORMULA_TEXT)
    return export


def window_export(window: Dict, score_col: str) -> Dict:
    df = window["df"]
    return {
        "window": f"{window['start_season']} to {window['end_season']}",
        "peak_score": round(window["peak_score"], 3),
        "seasons": [
            {
                "season": r["season"], "team": r.get("team"),
                "score": round(float(r[score_col]), 2),
                "regular": round(float(r["regular"]), 2),
                "playoff": round(float(r["playoff"]), 2),
                "accolade": round(float(r.get("accolade", float("nan"))), 2)
                if pd.notna(r.get("accolade")) else None,
                "team": round(float(r["team_score"]), 2),
                "durability": round(float(r["durability"]), 2),
                "bpm": None if pd.isna(r.get("bpm")) else float(r["bpm"]),
                "vorp": None if pd.isna(r.get("vorp")) else float(r["vorp"]),
                "ts_plus": None if pd.isna(r.get("ts_plus")) else round(float(r["ts_plus"]), 1),
            }
            for _, r in df.sort_values("season_end").iterrows()
        ],
    }


def report_top(scored: pd.DataFrame, n: int, mode: str, flags: Dict[str, bool]):
    score_col = "legacy_total" if mode == "legacy" else "stat_total"
    rows = []
    for player, grp in scored.groupby("player"):
        bw = best_window(grp, score_col)
        if not bw:
            continue
        wdf = bw["df"]
        made_any = bool(grp.get("made_playoffs", pd.Series([False])).any())
        label, _ = confidence(wdf, flags, made_any)
        rows.append({
            "player": player,
            "window": f"{bw['start_season']}–{bw['end_season']}",
            "score": bw["peak_score"],
            "conf": label,
            "best_season": float(wdf[score_col].max()),
            "reg_avg": float(wdf["regular"].mean()),
            "po_avg": float(wdf["playoff"].mean()),
            "acc_avg": float(wdf["accolade"].mean()) if "accolade" in wdf else float("nan"),
            "warns": len(collect_warnings(grp, flags)),
        })
    top = pd.DataFrame(rows).sort_values("score", ascending=False).head(n)

    title = "LEGACY-ADJUSTED" if mode == "legacy" else "STATISTICAL"
    print("\n" + BAR)
    print(f"TOP {n} 3-YEAR PEAKS  ({title})")
    print(BAR)
    head = (f"{'#':>3} {'Player':22} {'Window':13} {'Score':>6} {'Conf':6} "
            f"{'BestYr':>6} {'RegAvg':>6} {'PO Avg':>6}")
    if mode == "legacy":
        head += f" {'AccAvg':>6}"
    head += f" {'Warn':>4}"
    print(head)
    for i, (_, r) in enumerate(top.iterrows(), 1):
        line = (f"{i:>3} {r['player'][:22]:22} {r['window']:13} "
                f"{r['score']:>6.2f} {r['conf']:6} {r['best_season']:>6.1f} "
                f"{r['reg_avg']:>6.1f} {r['po_avg']:>6.1f}")
        if mode == "legacy":
            line += f" {r['acc_avg']:>6.1f}"
        line += f" {r['warns']:>4}"
        print(line)
    print(FORMULA_TEXT)


# ======================================================================
# PLAYER MATCHING
# ======================================================================

NICKNAMES = {
    "lebron": "LeBron James", "king james": "LeBron James",
    "kobe": "Kobe Bryant", "shaq": "Shaquille O'Neal",
    "mj": "Michael Jordan", "kg": "Kevin Garnett",
    "the dream": "Hakeem Olajuwon", "cp3": "Chris Paul",
    "dwade": "Dwyane Wade", "flash": "Dwyane Wade",
    "steph": "Stephen Curry", "chef curry": "Stephen Curry",
    "kd": "Kevin Durant", "the beard": "James Harden",
    "greek freak": "Giannis Antetokounmpo", "giannis": "Giannis Antetokounmpo",
    "dirk": "Dirk Nowitzki", "the admiral": "David Robinson",
    "magic": "Magic Johnson", "the mailman": "Karl Malone",
}


def match_player(scored: pd.DataFrame, query: str) -> Optional[str]:
    players = sorted(scored["player"].dropna().unique())
    keys = {norm_key(p): p for p in players}
    q = norm_key(query)

    if q in keys:
        return keys[q]
    if q in NICKNAMES:
        nk = norm_key(NICKNAMES[q])
        if nk in keys:
            return keys[nk]

    contains = [p for p in players if q in norm_key(p)]
    if len(contains) == 1:
        return contains[0]
    if len(contains) > 1:
        print("\nMultiple matches; using the closest. Candidates:")
        for c in contains[:8]:
            print(f"  - {c}")
        # prefer the one whose key is shortest (closest to a full-name match)
        return min(contains, key=lambda p: len(norm_key(p)))

    close = difflib.get_close_matches(q, list(keys.keys()), n=5, cutoff=0.6)
    if close:
        print("\nNo exact match. Closest names:")
        for c in close:
            print(f"  - {keys[c]}")
        return keys[close[0]]
    return None


# ======================================================================
# PIPELINE (load/build/cache)
# ======================================================================

def processed_paths(start: int, end: int) -> Dict[str, Path]:
    tag = f"{start}_{end}"
    return {
        "regular": PROCESSED_DIR / f"regular_{tag}.parquet",
        "playoffs": PROCESSED_DIR / f"playoffs_{tag}.parquet",
        "teams": PROCESSED_DIR / f"teams_{tag}.parquet",
        "scored": PROCESSED_DIR / f"scored_{tag}.parquet",
    }


def save_parquet(df: pd.DataFrame, path: Path):
    try:
        df.to_parquet(path, index=False)
    except Exception:  # pyarrow missing -> CSV fallback
        df.to_csv(path.with_suffix(".csv"), index=False)


def load_parquet(path: Path) -> Optional[pd.DataFrame]:
    if path.exists():
        try:
            return pd.read_parquet(path)
        except Exception:
            pass
    csv = path.with_suffix(".csv")
    if csv.exists():
        return pd.read_csv(csv)
    return None


def load_raw_frames(args) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Load (or build) the raw regular/playoffs/teams frames + team merge."""
    start, end = args.start_season_end, args.end_season_end
    paths = processed_paths(start, end)
    scrape = not args.no_scrape
    refresh = args.refresh

    regular = None if refresh else load_parquet(paths["regular"])
    playoffs = None if refresh else load_parquet(paths["playoffs"])
    teams = None if refresh else load_parquet(paths["teams"])
    if regular is None:
        print("Building dataset from Basketball Reference (cached afterwards)...")
        regular, playoffs, teams = build_dataset(start, end, scrape=scrape,
                                                 refresh=refresh)
        save_parquet(regular, paths["regular"])
        if playoffs is not None and len(playoffs):
            save_parquet(playoffs, paths["playoffs"])
        if teams is not None and len(teams):
            save_parquet(teams, paths["teams"])
    if playoffs is None:
        playoffs = pd.DataFrame()
    if teams is None:
        teams = pd.DataFrame()
    return regular, playoffs, teams


def _assert_recent_season_complete(scored: pd.DataFrame, debug: bool = False
                                   ) -> None:
    """Fail the rebuild if the most recent COMPLETED season carries a non-
    provisional player-season with a silently-missing required field. Delegated to
    nba_peak.season_completeness (imported lazily to avoid any import overhead on
    paths that never score)."""
    try:
        from nba_peak import season_completeness as _sc
    except Exception:                       # module optional; never block scoring
        return
    if "season_end" not in scored.columns or not len(scored):
        return
    se = int(scored["season_end"].max())
    if se < DEFAULT_END_SEASON_END:         # only guard the canonical end season
        return
    _sc.assert_no_silent_missing(scored, se)
    if debug:
        print(f"[debug] completed-season guard passed for season_end={se}")


def get_scored(args) -> Tuple[pd.DataFrame, Dict[str, bool]]:
    start, end = args.start_season_end, args.end_season_end
    paths = processed_paths(start, end)
    scrape = not args.no_scrape
    refresh = args.refresh

    if refresh or args.rebuild:
        for key in ("regular", "playoffs", "teams", "scored"):
            for p in (paths[key], paths[key].with_suffix(".csv")):
                if p.exists():
                    p.unlink()

    # Invalidate the scored cache if enriched context (or manual overrides) are
    # newer than it, so enrichment takes effect without a manual --rebuild.
    def _newer(a: Path, b: Path) -> bool:
        return a.exists() and b.exists() and a.stat().st_mtime > b.stat().st_mtime
    if paths["scored"].exists():
        for src in (GENERATED_CONTEXT_PATH, DATA_DIR / "manual_context.csv",
                    DATA_DIR / "external_impact.csv", DATA_DIR / "stat_titles.csv"):
            if _newer(src, paths["scored"]):
                if args.debug:
                    print(f"[debug] {src.name} newer than scored cache; re-scoring")
                paths["scored"].unlink()
                break

    # Fast path: cached scored data, no rebuild requested.
    scored = None if (args.rebuild or refresh) else load_parquet(paths["scored"])
    # We always merge optional files (cheap) to refresh confidence flags.
    _, flags = merge_optional(pd.DataFrame({"player": [], "season_end": []}),
                              debug=args.debug)

    if scored is not None and len(scored):
        if args.debug:
            print("[debug] loaded cached scored dataset")
        return scored, flags

    # Build (or load) raw frames.
    regular = None if (args.rebuild or refresh) else load_parquet(paths["regular"])
    playoffs = None if (args.rebuild or refresh) else load_parquet(paths["playoffs"])
    teams = None if (args.rebuild or refresh) else load_parquet(paths["teams"])

    if regular is None:
        print("Building dataset from Basketball Reference (this is cached "
              "afterwards)...")
        regular, playoffs, teams = build_dataset(start, end, scrape=scrape,
                                                 refresh=refresh)
        save_parquet(regular, paths["regular"])
        if playoffs is not None and len(playoffs):
            save_parquet(playoffs, paths["playoffs"])
        if teams is not None and len(teams):
            save_parquet(teams, paths["teams"])
    if playoffs is None:
        playoffs = pd.DataFrame()
    if teams is None:
        teams = pd.DataFrame()

    # Merge team ratings into regular.
    if len(teams):
        regular = regular.merge(teams, on=["season_end", "team"], how="left")
    for c in ("team_wins", "team_srs", "team_net_rtg"):
        if c not in regular.columns:
            regular[c] = np.nan

    regular, flags = merge_optional(regular, debug=args.debug)
    scored = score_dataset(regular, playoffs)
    # COMPLETED-SEASON GUARD: a completed (non-provisional) recent season may not
    # enter official leaderboards while a REQUIRED field is silently missing.
    # `not_applicable` (e.g. not in the MVP voting, missed the playoffs) is fine.
    _assert_recent_season_complete(scored, debug=args.debug)
    save_parquet(scored, paths["scored"])
    if args.debug:
        print(f"[debug] scored {len(scored)} player-seasons, "
              f"{scored['player'].nunique()} players")
    return scored, flags


# ======================================================================
# EXAMPLE TEMPLATES
# ======================================================================

def write_examples():
    samples = {
        "manual_context.csv":
            "player,season_end,finals_mvp,championship,best_player_title,"
            "finals_appearance,conf_finals,playoff_round_score,"
            "opponent_quality_score,teammate_penalty,notes\n"
            "Dwyane Wade,2006,1,1,1,1,1,95,80,0,Finals MVP run\n",
        "external_impact.csv":
            "player,season_end,epm,lebron,raptor,darko,rapm\n"
            "LeBron James,2013,7.8,6.9,8.1,7.4,6.5\n",
        "stat_titles.csv":
            "player,season_end,scoring_title,assist_title,rebound_title,"
            "steals_title,blocks_title,fifty_forty_ninety\n"
            "Stephen Curry,2016,1,0,0,0,0,1\n",
    }
    for name, content in samples.items():
        p = EXAMPLES_DIR / name
        if not p.exists():
            p.write_text(content, encoding="utf-8")


# ======================================================================
# CLI
# ======================================================================

def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        description="NBA best consecutive 3-year peak calculator.")
    p.add_argument("--player", help='e.g. "LeBron James"')
    p.add_argument("--top", type=int, default=0,
                   help="Print the top N 3-year peaks overall.")
    p.add_argument("--mode", choices=["stat", "legacy", "both"], default="both")
    p.add_argument("--start-season-end", type=int, default=DEFAULT_START_SEASON_END,
                   dest="start_season_end")
    p.add_argument("--end-season-end", type=int, default=DEFAULT_END_SEASON_END,
                   dest="end_season_end")
    p.add_argument("--rebuild", action="store_true",
                   help="Rebuild processed data from cached HTML.")
    p.add_argument("--refresh", action="store_true",
                   help="Re-download HTML, then rebuild everything.")
    p.add_argument("--no-scrape", action="store_true",
                   help="Use only cached data; never hit the network.")
    p.add_argument("--export", default=None,
                   help="Write the single-player result to this JSON path.")
    p.add_argument("--season", default=None,
                   help="Target a specific season (e.g. 1994-95) for "
                        "--audit-score.")
    p.add_argument("--debug", action="store_true")
    # ---- context enrichment ----
    p.add_argument("--build-candidates", action="store_true",
                   help="Build/refresh the candidate list and exit.")
    p.add_argument("--build-context", action="store_true",
                   help="Build the automatic context cache (resumable).")
    p.add_argument("--audit-context", action="store_true",
                   help="Validate the context cache and write an audit report.")
    p.add_argument("--stat-candidate-count", "--candidate-count", type=int,
                   default=100, dest="stat_candidate_count",
                   help="Discretionary Tier-2 statistical candidates (does NOT "
                        "limit mandatory All-NBA/MVP/DPOY qualifiers).")
    p.add_argument("--candidates", default=None,
                   help="Path to a candidate CSV to use instead of auto-selection.")
    # ---- inspection / audit ----
    p.add_argument("--list-candidates", action="store_true")
    p.add_argument("--list-all-nba-candidates", action="store_true")
    p.add_argument("--list-all-players", action="store_true")
    p.add_argument("--search-player", default=None, metavar="QUERY")
    p.add_argument("--candidate-status", action="store_true",
                   help="Show context/candidate status for --player.")
    p.add_argument("--tier", default=None, help="Filter --list-candidates by tier.")
    p.add_argument("--audit-score", action="store_true",
                   help="Metric-by-metric score audit for --player.")
    p.add_argument("--audit-candidates", action="store_true")
    p.add_argument("--audit-anomalies", action="store_true")
    p.add_argument("--audit-teammates", action="store_true")
    p.add_argument("--top-seasons", type=int, default=0,
                   help="Top-N single seasons overall.")
    p.add_argument("--best-season", action="store_true")
    p.add_argument("--best-window", action="store_true")
    p.add_argument("--add-candidate", default=None, metavar="NAME")
    p.add_argument("--ensure-context", action="store_true")
    p.add_argument("--build-final-250", action="store_true")
    p.add_argument("--list-final-250", action="store_true")
    p.add_argument("--audit-final-250", action="store_true")
    p.add_argument("--list-exception-candidates", action="store_true")
    p.add_argument("--audit-exception-candidates", action="store_true")
    p.add_argument("--audit-data", action="store_true")
    p.add_argument("--include-all-core-players", action="store_true")
    p.add_argument("--years", type=int, default=None,
                   help="Best consecutive N-year peak (N=1..10).")
    p.add_argument("--compare-seasons", nargs=3, default=None,
                   metavar=("PLAYER", "S1", "S2"))
    p.add_argument("--trace-formula", action="store_true",
                   help="With --compare-seasons/--audit-score: show the raw "
                        "per-component and per-metric contribution differences.")
    p.add_argument("--compare-players", nargs=2, default=None,
                   metavar=("A", "B"))
    p.add_argument("--audit-career-order", action="store_true")
    p.add_argument("--audit-raw-model", action="store_true")
    # ---- analysis options ----
    p.add_argument("--window-weighting", choices=["weighted", "equal"],
                   default="weighted",
                   help="weighted=rank-weighted nyear_weights(N) (default); "
                        "equal=mean of the N seasons.")
    p.add_argument("--workload-policy", choices=["default", "strict", "permissive"],
                   default="default")
    p.add_argument("--include-provisional", action="store_true",
                   help="Allow incomplete (in-progress) seasons to set peaks.")
    p.add_argument("--sensitivity", action="store_true",
                   help="Run the player across formula variants (robustness).")
    p.add_argument("--rebuild-data", action="store_true",
                   help="Rebuild canonical completed-data datasets (team shares, "
                        "MVP/DPOY votes) from Basketball Reference, then re-score.")
    # ---- canonical top-250 Prime leaderboards (offline, deterministic) ----
    p.add_argument("--leaderboard", action="store_true",
                   help="Write the canonical top-N Prime leaderboard for the "
                        "duration in --years (1/2/3/5). Offline; uses the "
                        "canonical 250-player universe. Default --top 250.")
    p.add_argument("--leaderboard-all", action="store_true",
                   help="Write all four (1/2/3/5-year) canonical Prime "
                        "leaderboards + the cross-duration comparison. Offline.")
    p.add_argument("--simple-leaderboards", action="store_true",
                   help="Write the plain-text top-N Prime rankings for all five "
                        "durations (1/2/3/4/5-year) to leaderboards/*.txt. Offline.")
    p.add_argument("--simple-leaderboard", action="store_true",
                   help="Write the plain-text top-N Prime ranking for the single "
                        "duration in --years (1/2/3/4/5). Offline.")
    return p


GENERATED_DIR = DATA_DIR / "generated"
CONTEXT_CHECKPOINT_DIR = PROCESSED_DIR / "context_seasons"


def _user_candidate_players() -> List[str]:
    p = DATA_DIR / "user_candidates.csv"
    if p.exists():
        try:
            return pd.read_csv(p)["player"].dropna().tolist()
        except Exception:
            return []
    return []


def cmd_leaderboard(args, scored: pd.DataFrame) -> int:
    """Write canonical top-N Prime leaderboards from the cached scored data.
    Fully offline + deterministic; uses the canonical 250-player universe and the
    official raw-before-calibration window aggregation. Reports excluded players."""
    from nba_peak import leaderboards as LB
    top = args.top if args.top and args.top > 0 else 250
    if args.leaderboard_all:
        res = LB.generate_all(scored, top=top, write=True)
        for n in LB.DURATIONS:
            e = res["eligibility"][n]
            print(f"  {n}-year: ranked {len(res['boards'][n])}, eligible "
                  f"{len(e['eligible'])}/{len(res['universe'])}, ineligible "
                  f"{len(e['ineligible'])}"
                  + (f" ({', '.join(d['player'] for d in e['ineligible'])})"
                     if e["ineligible"] else ""))
        print(f"Wrote 4 leaderboards + comparison under {LB.LEADERBOARDS_DIR}/")
        return 0
    n = args.years if args.years else 1
    if n not in LB.DURATIONS:
        print(f"--leaderboard supports --years in {LB.DURATIONS}; got {n}.")
        return 1
    universe = LB.load_universe()
    elig = LB.eligibility(scored, universe, n)
    board = LB.build_leaderboard(scored, universe, n, top)
    LB.LEADERBOARDS_DIR.mkdir(parents=True, exist_ok=True)
    base = LB.LEADERBOARDS_DIR / f"top_{top}_{n}_year_prime"
    board.drop(columns=["canonical_player_id"], errors="ignore").to_csv(
        base.with_suffix(".csv"), index=False)
    base.with_suffix(".md").write_text(LB.render_board_md(board, n, elig),
                                       encoding="utf-8")
    wcol = "Best season" if n == 1 else "Best window"
    print(f"{n}-year Prime — eligible {len(elig['eligible'])}/{len(universe)}; "
          f"top 10:")
    for _, r in board.head(10).iterrows():
        print(f"  {int(r['Rank']):>3}  {r['Player']:24}{str(r[wcol]):18}"
              f"raw={r['Prime raw']:.2f}  disp={r['Prime display']:.1f}")
    if elig["ineligible"]:
        print(f"  excluded ({len(elig['ineligible'])}): "
              + ", ".join(f"{d['player']} [{d['reason']}]"
                          for d in elig["ineligible"]))
    print(f"Wrote {base.with_suffix('.csv').name} + .md under "
          f"{LB.LEADERBOARDS_DIR}/")
    return 0


def cmd_simple_leaderboard(args, scored: pd.DataFrame) -> int:
    """Write the plain-text top-N Prime rankings (1/2/3/4/5-year) from the cached
    scored data. Offline + deterministic; reuses the canonical universe and the
    official N-year window logic (N=4 via the same nyear_weights family)."""
    from nba_peak import leaderboards as LB
    top = args.top if args.top and args.top > 0 else 100
    if args.simple_leaderboards:
        written = LB.write_simple_leaderboards(scored, top=top)
        for p in written:
            print(f"  wrote {p}")
        print(f"Wrote {len(written)} simple text leaderboards under "
              f"{LB.LEADERBOARDS_DIR}/")
        return 0
    n = args.years if args.years else 1
    if n not in LB.SIMPLE_DURATIONS:
        print(f"--simple-leaderboard supports --years in {LB.SIMPLE_DURATIONS}; "
              f"got {n}.")
        return 1
    written = LB.write_simple_leaderboards(scored, top=top, durations=(n,))
    print(f"Wrote {written[0]}")
    return 0


def cmd_build_candidates(args, scored: pd.DataFrame) -> int:
    from nba_peak.candidates import build_candidates
    cands, excl = build_candidates(scored, stat_count=args.stat_candidate_count,
                                   user_players=_user_candidate_players())
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    cands.to_csv(GENERATED_DIR / "candidates.csv", index=False)
    excl.to_csv(GENERATED_DIR / "candidate_exclusions.csv", index=False)
    tiers = cands["candidate_tier"].value_counts().sort_index().to_dict()
    print(f"\nSelected {len(cands)} candidates -> {GENERATED_DIR/'candidates.csv'}")
    print(f"  Tier counts: {tiers}")
    print(f"  Mandatory All-NBA: {int(cands['mandatory_all_nba_qualifier'].sum())}")
    print(f"  Excluded (notable): {len(excl)} -> candidate_exclusions.csv")
    print("\nTop of list:")
    show = ["player", "candidate_tier", "all_nba_selections",
            "selection_reasons", "workload_adjusted_peak_score"]
    print(cands[show].head(30).to_string(index=False))
    return 0


def cmd_rebuild_data(args) -> int:
    """Build the CANONICAL completed-data datasets deterministically and re-score.

    Writes (under data/generated/): team_shares.csv, mvp_votes.csv, dpoy_votes.csv.
    Awards + per-game HTML are fetched politely (then cached) so the rebuild is
    reproducible offline thereafter. Model code is NOT changed; the normal offline
    scoring path consumes the merged datasets automatically via merge_optional."""
    from nba_peak import data_complete as dc
    try:
        from bs4 import BeautifulSoup
    except Exception:  # noqa: BLE001
        print("ERROR: beautifulsoup4 required for --rebuild-data"); return 2
    scrape = not args.no_scrape
    start, end = args.start_season_end, args.end_season_end
    seasons = list(range(start, end + 1))

    # ensure per-game + awards HTML are present (download missing if allowed)
    print(f"Ensuring source HTML for {len(seasons)} seasons (scrape={scrape}) ...")
    for se in seasons:
        fetch_html(f"{BREF_BASE}/leagues/NBA_{se}_per_game.html",
                   f"NBA_{se}_per_game.html", scrape=scrape, refresh=args.refresh)
        fetch_html(f"{BREF_BASE}/awards/awards_{se}.html",
                   f"NBA_{se}_awards.html", scrape=scrape, refresh=args.refresh)

    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    print("Building canonical team scoring/assist shares ...")
    ts = dc.build_team_shares(seasons, fetch_html=fetch_html,
                              read_tables=read_tables,
                              drop_header_rows=drop_header_rows,
                              clean_player_name=clean_player_name)
    ts.to_csv(TEAM_SHARES_PATH, index=False)
    print(f"  -> {TEAM_SHARES_PATH}  ({len(ts)} rows, "
          f"{ts['season_end'].nunique()} seasons)")

    for tid, path in (("mvp", MVP_VOTES_PATH), ("dpoy", DPOY_VOTES_PATH)):
        v = dc.build_award_votes(seasons, tid, fetch_html=fetch_html,
                                 uncomment_tables=uncomment_tables,
                                 BeautifulSoup=BeautifulSoup,
                                 clean_player_name=clean_player_name)
        v.to_csv(path, index=False)
        print(f"  -> {path}  ({len(v)} rows, seasons "
              f"{int(v['season_end'].min())}-{int(v['season_end'].max())})")

    # re-score so the new data take effect immediately (offline path unchanged)
    print("Re-scoring with completed data ...")
    args.rebuild = True
    scored, _ = get_scored(args)
    print(f"Done. {len(scored)} player-seasons scored with completed data.")
    return 0


def cmd_build_context(args) -> int:
    from nba_peak import context_build as cb
    from nba_peak.candidates import load_or_build_candidates
    regular, playoffs, teams = load_raw_frames(args)

    # Snapshot the current (pre-enrichment) scored data once, for before/after.
    spath = processed_paths(args.start_season_end, args.end_season_end)["scored"]
    baseline = Path("results/baseline/scored_pre_context.parquet")
    if spath.exists() and not baseline.exists():
        baseline.parent.mkdir(parents=True, exist_ok=True)
        save_parquet(load_parquet(spath), baseline)
        print(f"Saved pre-context baseline -> {baseline}")
    # Ensure a candidate list exists (drives the audit; build is league-wide).
    scored = load_parquet(processed_paths(args.start_season_end,
                                          args.end_season_end)["scored"])
    if scored is not None:
        load_or_build_candidates(scored, GENERATED_DIR / "candidates.csv",
                                 stat_count=args.stat_candidate_count,
                                 candidates_file=args.candidates,
                                 user_players=_user_candidate_players(),
                                 rebuild=True)
    cb.build_context(
        regular=regular, playoffs=playoffs, teams=teams,
        fetch_html=fetch_html, read_tables=read_tables,
        uncomment_tables=uncomment_tables, clean_player_name=clean_player_name,
        start=args.start_season_end, end=args.end_season_end,
        scrape=not args.no_scrape, refresh=args.refresh,
        out_dir=GENERATED_DIR, checkpoint_dir=CONTEXT_CHECKPOINT_DIR)
    print("Context build complete. The scored cache will refresh on next run.")
    return 0


def cmd_audit_context(args) -> int:
    from nba_peak import audit
    ctx_path = GENERATED_DIR / "player_season_context.parquet"
    if not ctx_path.exists():
        print("No context cache found. Run --build-context first.")
        return 2
    context = pd.read_parquet(ctx_path)
    scored = load_parquet(processed_paths(args.start_season_end,
                                          args.end_season_end)["scored"])
    cands = load_parquet(GENERATED_DIR / "candidates.csv")
    if cands is None and (GENERATED_DIR / "candidates.csv").exists():
        cands = pd.read_csv(GENERATED_DIR / "candidates.csv")
    audit.run_audit(context, scored, cands, Path("results"))
    return 0


def _load_candidates_df() -> Optional[pd.DataFrame]:
    p = GENERATED_DIR / "candidates.csv"
    return pd.read_csv(p) if p.exists() else None


def _load_context_df() -> Optional[pd.DataFrame]:
    return load_parquet(GENERATED_CONTEXT_PATH)


def _any_inspection(args) -> bool:
    return any([args.list_candidates, args.list_all_nba_candidates,
                args.list_all_players, args.search_player, args.candidate_status,
                args.audit_score, args.audit_candidates, args.audit_anomalies,
                args.audit_teammates, args.top_seasons, args.add_candidate,
                args.best_season, args.best_window, args.build_final_250,
                args.list_final_250, args.audit_final_250,
                args.list_exception_candidates, args.audit_exception_candidates,
                args.audit_data, args.compare_seasons, args.compare_players,
                args.audit_career_order, args.audit_raw_model])


FINAL250_PATH = DATA_DIR / "generated" / "final_250_candidates.csv"
EXCEPTION_PATH = DATA_DIR / "generated" / "exception_candidates.csv"


def _build_final_250(scored: pd.DataFrame):
    from nba_peak.candidates import build_final_250
    final, exc, n_all_nba = build_final_250(scored, target=250)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    final.to_csv(FINAL250_PATH, index=False)
    exc.to_csv(EXCEPTION_PATH, index=False)
    return final, exc, n_all_nba


def _dispatch_inspection(args, scored: pd.DataFrame) -> Optional[int]:
    import nba_peak.cli_commands as cc
    cands = _load_candidates_df()
    results = Path("results")

    if args.build_final_250:
        final, exc, n = _build_final_250(scored)
        print(f"\nVerified All-NBA players (1979-80+): {n}")
        print(f"Exception slots filled: {len(final) - n}")
        print(f"Final official study population: {len(final)} -> {FINAL250_PATH}")
        print(final.head(15)[["official_rank_seed", "player", "candidate_type",
                              "total_all_nba_count",
                              "best_preliminary_three_year_window"]].to_string(index=False))
        return 0
    if args.list_final_250:
        if not FINAL250_PATH.exists():
            _build_final_250(scored)
        f = pd.read_csv(FINAL250_PATH)
        print(f"\nFINAL 250 STUDY POPULATION ({len(f)} players)")
        with pd.option_context("display.max_rows", None, "display.width", 200):
            print(f[["official_rank_seed", "player", "candidate_type",
                     "total_all_nba_count", "best_preliminary_three_year_window",
                     "selection_explanation"]].to_string(index=False))
        return 0
    if args.audit_final_250:
        if not FINAL250_PATH.exists():
            _build_final_250(scored)
        f = pd.read_csv(FINAL250_PATH)
        n_anba = int(f["all_nba_qualifier"].sum())
        print(f"\nFINAL-250 AUDIT")
        print(f"  Total players:            {len(f)}")
        print(f"  Mandatory All-NBA:        {n_anba}")
        print(f"  Exception candidates:     {len(f) - n_anba}")
        print(f"  Median best 3yr window:   {f['best_preliminary_three_year_window'].median():.1f}")
        print(f"  Lowest-window mandatory:")
        m = f[f["all_nba_qualifier"]].nsmallest(8, "best_preliminary_three_year_window")
        for _, r in m.iterrows():
            print(f"    {r['player']:24} {r['best_preliminary_three_year_window']:.1f}  "
                  f"({r['total_all_nba_count']}x All-NBA)")
        return 0
    if args.list_exception_candidates or args.audit_exception_candidates:
        if not EXCEPTION_PATH.exists():
            _build_final_250(scored)
        e = pd.read_csv(EXCEPTION_PATH)
        inc = e[e["included"]]
        print(f"\nEXCEPTION CANDIDATES (non-All-NBA). Included: {len(inc)}")
        print(e.head(40).to_string(index=False))
        return 0
    if args.compare_seasons:
        player = match_player(scored, args.compare_seasons[0])
        if not player:
            print("player not found"); return 3
        return cc.compare_seasons(scored, player, args.compare_seasons[1],
                                  args.compare_seasons[2], results,
                                  trace=getattr(args, "trace_formula", False))
    if args.compare_players:
        a = match_player(scored, args.compare_players[0])
        b = match_player(scored, args.compare_players[1])
        if not a or not b:
            print("player not found"); return 3
        for who in (a, b):
            cc.career_table(scored, who)
            gg = scored[scored["player"] == who]
            print(f"  {who}: best Prime season "
                  f"{gg.loc[gg.prime_score.idxmax(),'season']} "
                  f"{gg.prime_score.max():.1f}; best 3yr Prime "
                  f"{(best_window(gg,'prime_score') or {}).get('peak_score',0):.1f}")
        return 0
    if args.audit_career_order:
        player = match_player(scored, args.player) if args.player else None
        if not player:
            print("--audit-career-order needs --player"); return 3
        return cc.audit_career_order(scored, player)
    if args.audit_raw_model:
        player = match_player(scored, args.player) if args.player else None
        if not player:
            print("--audit-raw-model needs --player"); return 3
        reg = load_parquet(processed_paths(args.start_season_end,
                                           args.end_season_end)["regular"])
        return cc.audit_raw_model(scored, reg, player)
    if args.audit_data:
        from nba_peak import data_audit
        reg = load_parquet(processed_paths(args.start_season_end,
                                           args.end_season_end)["regular"])
        po = load_parquet(processed_paths(args.start_season_end,
                                          args.end_season_end)["playoffs"])
        return data_audit.run_data_audit(scored, reg, po, _load_context_df(),
                                         results)

    if args.list_candidates or args.list_all_nba_candidates:
        return cc.list_candidates(cands, tier=args.tier,
                                  all_nba_only=args.list_all_nba_candidates)
    if args.list_all_players:
        return cc.list_all_players(scored, cands, results / "all_players.csv")
    if args.search_player:
        return cc.search_player(scored, cands, args.search_player)
    if args.add_candidate:
        return _cmd_add_candidate(args.add_candidate)
    if args.audit_teammates:
        reg = load_parquet(processed_paths(args.start_season_end,
                                           args.end_season_end)["regular"])
        return cc.audit_teammates(reg, results, player=(
            match_player(scored, args.player) if args.player else None))
    if args.audit_candidates:
        excl = load_parquet(GENERATED_DIR / "candidate_exclusions.csv")
        if excl is None and (GENERATED_DIR / "candidate_exclusions.csv").exists():
            excl = pd.read_csv(GENERATED_DIR / "candidate_exclusions.csv")
        return cc.audit_candidates(scored, cands, excl, results)
    if args.audit_anomalies:
        player = match_player(scored, args.player) if args.player else None
        return cc.audit_anomalies(scored, player)
    if args.candidate_status:
        player = match_player(scored, args.player) if args.player else None
        if not player:
            print("--candidate-status needs --player."); return 3
        reg = load_parquet(processed_paths(args.start_season_end,
                                           args.end_season_end)["regular"])
        return cc.candidate_status(scored, cands, _load_context_df(), reg, player)
    if args.audit_score:
        player = match_player(scored, args.player) if args.player else None
        if not player:
            print("--audit-score needs --player."); return 3
        reg = load_parquet(processed_paths(args.start_season_end,
                                           args.end_season_end)["regular"])
        return cc.audit_score(scored, reg, player,
                              trace=getattr(args, "trace_formula", False),
                              season=getattr(args, "season", None))
    return None


def _context_status(player_df: pd.DataFrame, flags: Dict[str, bool]) -> str:
    """FULL / PARTIAL / CORE_ONLY / NOT_AVAILABLE from real coverage."""
    if not flags.get("auto_context"):
        return "NOT_AVAILABLE"
    made = player_df.get("made_playoffs", pd.Series([False] * len(player_df)))
    if "_cov_observed" not in player_df.columns:
        return "CORE_ONLY"
    # derived coverage present where playoffs were made
    if bool(made.any()):
        est = player_df.get("_cov_estimated", pd.Series([0] * len(player_df)))
        return "FULL" if float(est.sum()) > 0 else "PARTIAL"
    return "CORE_ONLY"


def _cmd_add_candidate(name: str) -> int:
    p = DATA_DIR / "user_candidates.csv"
    existing = pd.read_csv(p) if p.exists() else pd.DataFrame(columns=["player"])
    if name in set(existing.get("player", [])):
        print(f"{name} already a user candidate.")
        return 0
    existing = pd.concat([existing, pd.DataFrame({"player": [name]})],
                         ignore_index=True)
    existing.to_csv(p, index=False)
    print(f"Added {name} to {p}. Re-run --build-candidates to include it.")
    return 0


def _report_nyear(player: str, player_df: pd.DataFrame, n: int, mode: str,
                  weighting: str, include_provisional: bool = False) -> int:
    print("\n" + BAR)
    print(f"PLAYER: {player}   N-YEAR PEAK: N={n}   weighting={weighting}")
    print(BAR)
    for col, label in (("performance_only", "PERFORMANCE-ONLY"),
                       ("prime_score", "PRIME")):
        if mode == "stat" and col == "prime_score":
            continue
        if mode == "legacy" and col == "performance_only":
            continue
        ws = n_year_windows(player_df, col, n, weighting, include_provisional)
        if not ws:
            print(f"\nNo eligible consecutive {n}-year window for {label}.")
            continue
        bw = ws[0]
        print(f"\nBEST CONSECUTIVE {n}-YEAR {label} PEAK: "
              f"{bw['start_season']}..{bw['end_season']}  score {bw['peak_score']:.2f}")
        print(f"  seasons: {', '.join(bw['seasons'])}")
        print(f"  weighted {bw['weighted_score']:.2f}  equal-avg {bw['equal_avg']:.1f}"
              f"  best-season {bw['max_season']:.1f}  weakest {bw['min_season']:.1f}"
              f"  variance {bw['variance']:.1f}")
        dec = nyear_window_decomposition(bw, col, weighting)
        print("  Component decomposition (rank-weighted RAW contributions, "
              f"sum = {dec['_raw_window_score']:.2f} raw):")
        for k in ("Statistical impact (38%)", "Traditional production (21%)",
                  "Individual recognition (20%)", "Postseason individual (18%)",
                  "Team achievement (3%)", "Teammate adjustment"):
            print(f"    {k:32} {dec[k]:7.2f}")
        print(f"  Aggregates: avg Statistical Impact {dec['avg_statistical_impact']:.1f}"
              f"  avg Traditional Production {dec['avg_traditional_production']:.1f}"
              f"  total postseason {dec['total_postseason_contrib']:.2f}"
              f"  total recognition {dec['total_recognition_contrib']:.2f}"
              f"  total team {dec['total_team_contrib']:.2f}")
        print(f"  All eligible {n}-year windows (best->worst):")
        for i, w in enumerate(ws, 1):
            print(f"    {i:2}. {w['start_season']}..{w['end_season']}  "
                  f"{w['peak_score']:.2f}")
        if len(ws) > 1:
            print(f"  Winner beat runner-up by "
                  f"{bw['peak_score'] - ws[1]['peak_score']:+.2f} "
                  f"(best season {bw['max_season']:.1f} vs "
                  f"{ws[1]['max_season']:.1f}; floor {bw['min_season']:.1f} vs "
                  f"{ws[1]['min_season']:.1f}).")
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    write_examples()

    # ---- data-completion command (don't require --player/--top) ----
    if args.rebuild_data:
        try:
            return cmd_rebuild_data(args)
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR rebuilding data: {exc}")
            if args.debug:
                import traceback; traceback.print_exc()
            return 2

    # ---- context-build commands (don't require --player/--top) ----
    if args.build_context:
        try:
            return cmd_build_context(args)
        except Exception as exc:  # noqa: BLE001
            print(f"ERROR building context: {exc}")
            if args.debug:
                import traceback; traceback.print_exc()
            return 2
    if args.audit_context:
        return cmd_audit_context(args)

    no_query = (not args.player and not args.top and
                not (args.rebuild or args.refresh) and not args.build_candidates
                and not args.leaderboard and not args.leaderboard_all
                and not args.simple_leaderboards and not args.simple_leaderboard
                and not _any_inspection(args))
    if no_query:
        build_parser().print_help()
        return 1

    try:
        scored, flags = get_scored(args)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR building dataset: {exc}")
        if args.no_scrape:
            print("Hint: run once without --no-scrape to populate the cache.")
        return 2

    if args.build_candidates:
        return cmd_build_candidates(args, scored)

    if args.leaderboard or args.leaderboard_all:
        return cmd_leaderboard(args, scored)

    if args.simple_leaderboards or args.simple_leaderboard:
        return cmd_simple_leaderboard(args, scored)

    if (args.rebuild or args.refresh) and not args.player and not args.top \
            and not _any_inspection(args):
        print(f"Done. {len(scored)} player-seasons scored, "
              f"{scored['player'].nunique()} players.")
        return 0

    # ---- inspection / audit commands ----
    insp = _dispatch_inspection(args, scored)
    if insp is not None:
        return insp

    if args.top_seasons and args.top_seasons > 0:
        from nba_peak.cli_commands import top_seasons
        return top_seasons(scored, args.top_seasons, args.mode,
                           args.include_provisional)

    if args.top and args.top > 0:
        report_top(scored, args.top, args.mode, flags)
        return 0

    player = match_player(scored, args.player)
    if not player:
        print(f"Could not find a player matching: {args.player!r}")
        return 3

    player_df = scored[scored["player"] == player].copy()

    # ---- variable N-year peak (1..10) ----
    if args.years is not None:
        if not (1 <= args.years <= 10):
            print("--years must be an integer 1..10")
            return 4
        import nba_peak.cli_commands as cc
        cc.career_table(scored, player)
        return _report_nyear(player, player_df, args.years, args.mode,
                             args.window_weighting, args.include_provisional)

    if len(player_df) < 3:
        print(f"{player} has only {len(player_df)} qualifying season(s) in "
              "range; need at least 3 for a window.")
        if len(player_df) >= 1:
            import nba_peak.cli_commands as cc
            cc.career_table(scored, player)
        return 4

    # full career table first (name-only query prints every season)
    import nba_peak.cli_commands as cc
    cc.career_table(scored, player)

    # candidate / context status for the header
    cands = _load_candidates_df()
    crow = (cands[cands["player"] == player]
            if cands is not None and (cands["player"] == player).any() else None)
    cand_status = {
        "candidate": crow is not None,
        "tier": int(crow.iloc[0]["candidate_tier"]) if crow is not None else None,
        "status": _context_status(player_df, flags),
    }

    export = report_single(player, player_df, args.mode, flags,
                           weighting=args.window_weighting,
                           do_sensitivity=args.sensitivity,
                           include_provisional=args.include_provisional,
                           cand_status=cand_status)
    if args.export:
        out = Path(args.export)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(export, indent=2), encoding="utf-8")
        print(f"\nExported -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
