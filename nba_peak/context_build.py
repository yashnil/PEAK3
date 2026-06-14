"""
Context-build orchestrator.

Season-by-season enrichment (one playoff page + one per-game page per season
enriches every player in that season), plus league-wide deterministic
derivations (teammates, awards) computed once.  Results are checkpointed per
season so an interrupted run resumes without losing completed work.

Outputs:
  data/generated/player_season_context.parquet   merged context, all players
  data/generated/provenance.csv                  field-level source/confidence
  cache/processed/context_seasons/{year}.parquet per-season checkpoints
"""
from __future__ import annotations

import datetime as _dt
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from .context import postseason as ps
from .context import stat_titles as st
from .context import teammates as tm
from .context import title_role as tr
from .context.awards import parse_awards_row

BREF = "https://www.basketball-reference.com"

# Field-level provenance: source + derivation method + base confidence.
PROVENANCE: List[Dict] = [
    {"field": "championship", "source_name": "Basketball Reference playoff bracket",
     "derivation_method": "Finals series winner", "confidence": 0.97},
    {"field": "finals_appearance", "source_name": "BR playoff bracket",
     "derivation_method": "team reached Finals series", "confidence": 0.97},
    {"field": "conf_finals", "source_name": "BR playoff bracket",
     "derivation_method": "team reached Conference Finals or deeper", "confidence": 0.97},
    {"field": "playoff_round", "source_name": "BR playoff bracket",
     "derivation_method": "deepest series participated", "confidence": 0.95},
    {"field": "playoff_round_score", "source_name": "BR playoff bracket",
     "derivation_method": "round-reached -> fixed 0-100 map", "confidence": 0.95},
    {"field": "finals_mvp", "source_name": "BR playoffs page",
     "derivation_method": "parsed Finals MVP line", "confidence": 0.96},
    {"field": "opponent_quality_score", "source_name": "BR team ratings + bracket",
     "derivation_method": "series-weighted opponent SRS/Net/Win/Def percentiles", "confidence": 0.82},
    {"field": "playoff_path_difficulty", "source_name": "BR team ratings + bracket",
     "derivation_method": "avg opponent strength scaled by rounds + elite bonus", "confidence": 0.78},
    {"field": "series_success_score", "source_name": "BR playoff bracket",
     "derivation_method": "0.45 round + 0.25 series win% + 0.15 upset + 0.15 result", "confidence": 0.85},
    {"field": "mvp_rank", "source_name": "BR Awards column",
     "derivation_method": "parsed MVP-N token", "confidence": 0.95},
    {"field": "dpoy_rank", "source_name": "BR Awards column",
     "derivation_method": "parsed DPOY-N token", "confidence": 0.95},
    {"field": "all_nba_team", "source_name": "BR Awards column",
     "derivation_method": "parsed NBA1/2/3 token", "confidence": 0.95},
    {"field": "all_defense_team", "source_name": "BR Awards column",
     "derivation_method": "parsed DEF1/2 token", "confidence": 0.95},
    {"field": "all_star", "source_name": "BR Awards column",
     "derivation_method": "parsed AS token", "confidence": 0.9},
    {"field": "scoring_title", "source_name": "BR per-game leaders",
     "derivation_method": "qualified per-game PTS leader", "confidence": 0.85},
    {"field": "assist_title", "source_name": "BR per-game leaders",
     "derivation_method": "qualified per-game AST leader", "confidence": 0.85},
    {"field": "rebound_title", "source_name": "BR per-game leaders",
     "derivation_method": "qualified per-game TRB leader", "confidence": 0.85},
    {"field": "steals_title", "source_name": "BR per-game leaders",
     "derivation_method": "qualified per-game STL leader", "confidence": 0.85},
    {"field": "blocks_title", "source_name": "BR per-game leaders",
     "derivation_method": "qualified per-game BLK leader", "confidence": 0.85},
    {"field": "fifty_forty_ninety", "source_name": "BR per-game shooting",
     "derivation_method": "FG>=.5,3P>=.4,FT>=.9 with volume thresholds", "confidence": 0.85},
    {"field": "teammate_strength_score", "source_name": "BR regular-season VORP/WS",
     "derivation_method": "season-relative supporting-cast percentile (player excluded)", "confidence": 0.85},
    {"field": "teammate_adjustment", "source_name": "derived",
     "derivation_method": "(50 - strength_pct)/10 capped +/-5", "confidence": 0.85},
    {"field": "best_player_title", "source_name": "derived (champions only)",
     "derivation_method": "title-run composite ranking of champion roster", "confidence": 0.8},
]

CONTEXT_FIELDS = [
    "championship", "finals_mvp", "finals_appearance", "conf_finals",
    "playoff_round", "playoff_round_score", "series_success_score",
    "opponent_quality_score", "playoff_path_difficulty",
    "elite_opponents_beaten", "series_wins", "series_losses",
    "teammate_strength_score", "teammate_adjustment",
    "title_team_role", "best_player_title", "co_best_player_title",
    "secondary_star_title",
    "mvp_rank", "mvp_vote_share", "dpoy_rank", "dpoy_vote_share",
    "all_nba_team", "all_defense_team", "all_star",
    "scoring_title", "assist_title", "rebound_title", "steals_title",
    "blocks_title", "fifty_forty_ninety",
]


# --------------------------------------------------------------------- pages

def _parse_per_game(read_tables_fn, html: Optional[str]) -> pd.DataFrame:
    if not html:
        return pd.DataFrame()
    tables = read_tables_fn(html)
    want = ["player", "g", "pts", "ast", "trb", "stl", "blk"]
    table = None
    for t in tables:
        if all(c in t.columns for c in want):
            table = t.copy()
            break
    if table is None:
        return pd.DataFrame()
    table = table[table["player"].astype(str) != "Player"]
    ren = {"FG": "fg", "3P": "threep", "FT": "ft"}
    table = table.rename(columns={k: v for k, v in ren.items() if k in table.columns})
    return table


# --------------------------------------------------------------------- build

def build_context(*, regular: pd.DataFrame, playoffs: pd.DataFrame,
                  teams: pd.DataFrame, fetch_html, read_tables,
                  uncomment_tables, clean_player_name,
                  start: int, end: int,
                  scrape: bool, refresh: bool,
                  out_dir: Path, checkpoint_dir: Path,
                  log=print) -> pd.DataFrame:
    from bs4 import BeautifulSoup
    out_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)

    # ---- league-wide derivations (no network) ----
    log("Deriving teammate strength (league-wide)...")
    teammates = tm.derive_teammates(regular)

    log("Parsing awards (league-wide)...")
    aw = regular.apply(lambda r: parse_awards_row(r.get("awards")), axis=1,
                       result_type="expand")
    awards_df = pd.concat([regular[["player", "season_end"]], aw], axis=1)

    # raw per-player stats needed for title-role composites
    reg_small = regular[["player", "season_end", "team", "bpm"]].rename(
        columns={"bpm": "reg_bpm"})
    po_small = playoffs[["player", "season_end", "team", "bpm", "mp", "pts"]].rename(
        columns={"bpm": "po_bpm", "mp": "po_mp", "pts": "po_pts",
                 "team": "po_team"}) if len(playoffs) else pd.DataFrame(
        columns=["player", "season_end", "po_team", "po_bpm", "po_mp", "po_pts"])

    season_frames = []
    for se in range(start, end + 1):
        ck = checkpoint_dir / f"{se}.parquet"
        if ck.exists() and not refresh:
            season_frames.append(pd.read_parquet(ck))
            continue

        log(f"  context season {se-1}-{str(se)[-2:]}")
        # players active this season (regular)
        base = regular[regular["season_end"] == se][["player", "season_end"]].drop_duplicates()
        if not len(base):
            continue

        # ---- postseason bracket ----
        html = fetch_html(f"{BREF}/playoffs/NBA_{se}.html",
                          f"playoffs_season_{se}.html", scrape=scrape, refresh=refresh)
        team_po = pd.DataFrame()
        finals_mvp_name = None
        if html:
            soup = BeautifulSoup(uncomment_tables(html), "lxml")
            series = ps.parse_playoff_series(soup, se)
            finals_mvp_name = ps.parse_finals_mvp(soup)
            if finals_mvp_name:
                finals_mvp_name = clean_player_name(finals_mvp_name)
            tslice = teams[teams["season_end"] == se] if len(teams) else pd.DataFrame()
            team_po = ps.derive_team_postseason(series, tslice, se)

        # player postseason: join via PLAYOFF team (handles traded players)
        po_players = playoffs[playoffs["season_end"] == se][["player", "team"]] \
            if len(playoffs) else pd.DataFrame(columns=["player", "team"])
        if len(team_po) and len(po_players):
            pp = po_players.merge(team_po, on="team", how="left")
            pp["season_end"] = se
            keep = ["player", "season_end", "playoff_round", "playoff_round_score",
                    "championship", "finals_appearance", "conf_finals",
                    "series_wins", "series_losses", "opponent_quality_score",
                    "playoff_path_difficulty", "elite_opponents_beaten",
                    "series_success_score"]
            pp = pp[[c for c in keep if c in pp.columns]].drop_duplicates("player")
        else:
            pp = pd.DataFrame(columns=["player", "season_end"])

        sdf = base.merge(pp, on=["player", "season_end"], how="left")
        # missed playoffs -> observed zeros / missed
        made = sdf["playoff_round"].notna() if "playoff_round" in sdf.columns else pd.Series(False, index=sdf.index)
        sdf["made_playoffs"] = made.astype(int)
        for col, val in (("championship", 0), ("finals_appearance", 0),
                         ("conf_finals", 0), ("playoff_round_score", 10.0),
                         ("series_wins", 0), ("series_losses", 0),
                         ("elite_opponents_beaten", 0)):
            if col in sdf.columns:
                sdf[col] = sdf[col].fillna(val)
            else:
                sdf[col] = val
        sdf["playoff_round"] = sdf.get("playoff_round")
        sdf.loc[~made, "playoff_round"] = "Missed playoffs"
        # opponent quality / path / series-success are N/A when no playoffs
        for col in ("opponent_quality_score", "playoff_path_difficulty",
                    "series_success_score"):
            if col not in sdf.columns:
                sdf[col] = np.nan

        # ---- finals MVP ----
        sdf["finals_mvp"] = 0
        if finals_mvp_name:
            sdf.loc[sdf["player"] == finals_mvp_name, "finals_mvp"] = 1

        # ---- stat titles ----
        pg_html = fetch_html(f"{BREF}/leagues/NBA_{se}_per_game.html",
                             f"NBA_{se}_per_game.html", scrape=scrape, refresh=refresh)
        pg = _parse_per_game(read_tables, pg_html)
        if len(pg):
            pg["player"] = pg["player"].apply(clean_player_name)
            titles = st.derive_stat_titles(pg, se)
            if len(titles):
                titles = titles.drop_duplicates("player")
                sdf = sdf.merge(titles, on=["player", "season_end"], how="left")
        for c in st.LEADER_STATS.values():
            if c not in sdf.columns:
                sdf[c] = 0
        if "fifty_forty_ninety" not in sdf.columns:
            sdf["fifty_forty_ninety"] = 0

        # ---- title-team role (champions only) ----
        sdf["title_team_role"] = None
        sdf["best_player_title"] = 0
        sdf["co_best_player_title"] = 0
        sdf["secondary_star_title"] = 0
        sdf["title_team_role_score"] = np.nan
        champ_teams = (team_po[team_po["championship"] == 1]["team"].tolist()
                       if len(team_po) else [])
        for ct in champ_teams:
            roster_players = po_players[po_players["team"] == ct]["player"].tolist() \
                if len(po_players) else []
            if not roster_players:
                continue
            r = pd.DataFrame({"player": roster_players})
            r = r.merge(reg_small[reg_small["season_end"] == se][["player", "reg_bpm"]],
                        on="player", how="left")
            if len(po_small):
                r = r.merge(po_small[po_small["season_end"] == se]
                            [["player", "po_bpm", "po_mp", "po_pts"]],
                            on="player", how="left")
            r = r.merge(awards_df[awards_df["season_end"] == se]
                        [["player", "mvp_rank", "all_nba_team"]], on="player", how="left")
            r["finals_mvp"] = (r["player"] == finals_mvp_name).astype(float) \
                if finals_mvp_name else 0.0
            cls = tr.classify_title_team(r)
            for _, rr in cls.iterrows():
                m = sdf["player"] == rr["player"]
                sdf.loc[m, "title_team_role"] = rr["title_team_role"]
                sdf.loc[m, "best_player_title"] = int(rr["best_player_title"])
                sdf.loc[m, "co_best_player_title"] = int(rr["co_best_player_title"])
                sdf.loc[m, "secondary_star_title"] = int(rr["secondary_star_title"])
                sdf.loc[m, "title_team_role_score"] = rr["title_team_role_score"]

        # ---- merge league-wide slices ----
        sdf = sdf.merge(awards_df[awards_df["season_end"] == se], on=["player", "season_end"],
                        how="left", suffixes=("", "_aw"))
        sdf = sdf.merge(teammates[teammates["season_end"] == se]
                        [["player", "season_end", "teammate_strength_score",
                          "teammate_adjustment", "top_teammate_value",
                          "second_teammate_value", "supporting_cast_depth",
                          "star_teammate_count", "_teammate_confidence"]],
                        on=["player", "season_end"], how="left")

        # ---- confidence + coverage ----
        sdf = _finalize_confidence(sdf)
        sdf.to_parquet(ck, index=False)
        season_frames.append(sdf)

    if not season_frames:
        raise RuntimeError("No context could be built (no data in range).")
    context = pd.concat(season_frames, ignore_index=True)

    out_dir.mkdir(parents=True, exist_ok=True)
    context.to_parquet(out_dir / "player_season_context.parquet", index=False)
    prov = pd.DataFrame(PROVENANCE)
    prov["retrieved_at"] = _dt.date.today().isoformat()
    prov.to_csv(out_dir / "provenance.csv", index=False)
    log(f"Context built: {len(context)} player-seasons -> "
        f"{out_dir/'player_season_context.parquet'}")
    return context


def _finalize_confidence(sdf: pd.DataFrame) -> pd.DataFrame:
    sdf = sdf.copy()
    made = sdf.get("made_playoffs", pd.Series(0, index=sdf.index)).astype(bool)

    # Per-field "category": observed (objective), derived (estimated), na, missing.
    # Confidence is a row-level blend; warnings = count of na/missing applicable fields.
    obs = made.astype(float)  # objective postseason facts present when played
    # opponent quality observed only if we actually have a value
    oq_present = sdf.get("opponent_quality_score").notna() if "opponent_quality_score" in sdf else pd.Series(False, index=sdf.index)

    warn = pd.Series(0, index=sdf.index)
    # opponent quality missing for playoff teams we couldn't rate
    warn += (made & ~oq_present).astype(int)
    # teammate strength missing (traded players)
    tmconf = sdf.get("_teammate_confidence", pd.Series(0.85, index=sdf.index)).fillna(0.5)
    warn += (sdf.get("teammate_strength_score").isna()).astype(int) if "teammate_strength_score" in sdf else 0

    # row confidence: average of the structured-fact confidences we actually have
    base_conf = 0.93                              # awards + postseason facts are objective
    conf = pd.Series(base_conf, index=sdf.index)
    conf = conf * 0.6 + tmconf * 0.4
    conf = conf - 0.04 * warn
    sdf["context_confidence"] = conf.clip(0.2, 0.99).round(3)
    sdf["context_warning_count"] = warn.astype(int)

    # observed/estimated/missing coverage fractions per row (for reporting)
    # observed: objective facts; estimated: derived (opp quality, teammates, titles);
    # missing: applicable-but-absent.
    observed_fields = 8 if True else 0  # championship,finals,conf,round,finals_mvp,awards(mvp,allnba),allstar
    sdf["_cov_observed"] = observed_fields
    sdf["_cov_estimated"] = (oq_present.astype(int) +
                             sdf.get("teammate_strength_score").notna().astype(int))
    sdf["_cov_missing"] = warn
    return sdf
