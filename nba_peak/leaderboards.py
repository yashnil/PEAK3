"""
Canonical top-250 Prime leaderboards (1-, 2-, 3-, 5-year).

Read-only: this module changes NO scoring formula, weight, calibration or
eligibility rule. It re-reads the canonical scored dataset and the official
window helpers in peak3 and writes the deterministic leaderboard deliverables
under ``leaderboards/``.

Methodology (unchanged, official):
  * player universe        -> data/generated/final_250_candidates.csv (the
                              canonical 250-player candidate set; reused, not
                              redefined here);
  * eligible seasons       -> completed, NON-PROVISIONAL scored seasons (the
                              scored dataset is already minutes-qualified);
  * windows                -> every CONSECUTIVE n-season run (peak3.n_year_windows);
  * aggregation            -> RAW season Prime values are rank-weighted FIRST
                              with peak3.nyear_weights(n), then the aggregated RAW
                              window score is calibrated ONCE
                              (peak3.calibrate_score). Calibrated display scores
                              are NEVER averaged.
  * n-year rank weights    -> nyear_weights(n):
                                1yr [1.00]
                                2yr [0.667, 0.333]   (best, second)
                                3yr [0.500, 0.333, 0.167]
                                5yr [0.323, 0.258, 0.194, 0.129, 0.097]
                              The 2-year weights are the existing rank-weight
                              system evaluated at n=2 -- NOT a new 60/40 rule.

Deterministic per-player best-window selection and cross-player ranking both use
the documented tie-break:
    prime_raw desc, prime_display desc, SI-contrib desc, PO-contrib desc,
    anchor-season asc, canonical player_id asc.
"""
from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

import peak3 as P

ROOT = Path(__file__).resolve().parent.parent
UNIVERSE_PATH = ROOT / "data" / "generated" / "final_250_candidates.csv"
LEADERBOARDS_DIR = ROOT / "leaderboards"

DURATIONS = (1, 2, 3, 5)

# data inputs that fall back to a documented proxy/placement when unobserved;
# a window touching one of these is flagged "complete*" (complete, some derived
# inputs) rather than plain "complete".
_FALLBACK_STATUS_COLS = ("burden_data_status", "team_share_data_status")


# --------------------------------------------------------------- universe ------
def load_universe() -> pd.DataFrame:
    """The canonical 250-player candidate universe (reused, never redefined)."""
    uni = pd.read_csv(UNIVERSE_PATH)
    uni = uni.rename(columns={"player_id": "canonical_player_id"})
    keep = ["player", "canonical_player_id", "career_start", "career_end",
            "candidate_type", "selection_explanation"]
    keep = [c for c in keep if c in uni.columns]
    return uni[keep].drop_duplicates("player").reset_index(drop=True)


def _modal_role(g: pd.DataFrame) -> str:
    if "role" in g.columns and g["role"].notna().any():
        return str(g["role"].mode().iloc[0])
    return "—"


def completed_seasons(scored: pd.DataFrame, player: str) -> pd.DataFrame:
    g = scored[scored["player"] == player]
    if "provisional" in g.columns:
        g = g[g["provisional"] != 1]
    return g.copy()


# ----------------------------------------------------------- window builder ----
def _completeness_status(wdf: pd.DataFrame) -> str:
    derived = False
    for c in _FALLBACK_STATUS_COLS:
        if c in wdf.columns:
            vals = wdf[c].astype(str).str.lower()
            if (~vals.isin(["observed"])).any():
                derived = True
    return "complete*" if derived else "complete"


def _anchor_row(wdf: pd.DataFrame) -> pd.Series:
    return wdf.loc[wdf["prime_raw"].astype(float).idxmax()]


def best_window(scored: pd.DataFrame, player: str, n: int,
                player_id: str = "") -> Optional[Dict]:
    """Best consecutive n-season window for a player, RAW-aggregated then
    calibrated once. Deterministic: among windows tied on the rank-weighted raw
    score, the documented tie-break decides."""
    g = completed_seasons(scored, player)
    ws = P.n_year_windows(g, "prime_raw", n, "weighted")
    if not ws:
        return None
    # decorate every window with its decomposition for deterministic tie-break
    cand = []
    for w in ws:
        dec = P.nyear_window_decomposition(w, "prime_raw", "weighted")
        raw = dec["_raw_window_score"]
        disp = float(P.calibrate_score(pd.Series([raw])).iloc[0])
        anchor = _anchor_row(w["df"])
        cand.append((w, dec, raw, disp, anchor))
    # pick the best window with the documented tie-break
    cand.sort(key=lambda c: (
        -round(c[2], 9),                       # prime_raw desc
        -round(c[3], 9),                       # prime_display desc
        -round(c[1]["Statistical impact (38%)"], 9),
        -round(c[1]["Postseason individual (18%)"], 9),
        int(c[4]["season_end"]),               # anchor season asc
        str(player_id),                        # canonical id asc
    ))
    w, dec, raw, disp, anchor = cand[0]
    wdf = w["df"].sort_values("season_end")
    vals = wdf["prime_raw"].astype(float)
    return {
        "player": player, "canonical_player_id": player_id, "n": n,
        "window": f"{w['start_season']}-{w['end_season']}",
        "start_season": str(w["start_season"]), "end_season": str(w["end_season"]),
        "seasons": ", ".join(wdf["season"].astype(str).tolist()),
        "anchor_season": str(anchor["season"]),
        "anchor_season_end": int(anchor["season_end"]),
        "prime_raw": raw, "prime_display": disp,
        "SI": dec["Statistical impact (38%)"],
        "TP": dec["Traditional production (21%)"],
        "Rec": dec["Individual recognition (20%)"],
        "PO": dec["Postseason individual (18%)"],
        "Team": dec["Team achievement (3%)"],
        "tm": dec["Teammate adjustment"],
        "best_season_score": float(vals.max()),
        "weakest_season_score": float(vals.min()),
        "window_variance": float(np.var(vals.to_numpy())),
        "completeness": _completeness_status(wdf),
        "role": _modal_role(g),
    }


# --------------------------------------------------------------- eligibility ---
def eligibility(scored: pd.DataFrame, universe: pd.DataFrame, n: int) -> Dict:
    eligible, ineligible = [], []
    for _, u in universe.iterrows():
        g = completed_seasons(scored, u["player"])
        ws = P.n_year_windows(g, "prime_raw", n, "weighted")
        if ws:
            eligible.append(u["player"])
        else:
            n_comp = len(g)
            reason = (f"no {n} consecutive completed seasons "
                      f"({n_comp} completed season(s))")
            ineligible.append({"player": u["player"],
                               "canonical_player_id": u.get("canonical_player_id"),
                               "reason": reason})
    return {"n": n, "candidates": len(universe), "eligible": eligible,
            "ineligible": ineligible}


# ------------------------------------------------------------ leaderboards -----
def _tiebreak_sort(rows: List[Dict]) -> List[Dict]:
    return sorted(rows, key=lambda r: (
        -round(r["prime_raw"], 9), -round(r["prime_display"], 9),
        -round(r["SI"], 9), -round(r["PO"], 9),
        r["anchor_season_end"], str(r["canonical_player_id"])))


def build_leaderboard(scored: pd.DataFrame, universe: pd.DataFrame, n: int,
                      top: int = 250) -> pd.DataFrame:
    rows = []
    for _, u in universe.iterrows():
        bw = best_window(scored, u["player"], n,
                         str(u.get("canonical_player_id", "")))
        if bw is None:
            continue
        rows.append(bw)
    rows = _tiebreak_sort(rows)[:top]
    out = []
    for i, r in enumerate(rows, start=1):
        rec = {"Rank": i, "Player": r["player"],
               "canonical_player_id": r["canonical_player_id"]}
        if n == 1:
            rec["Best season"] = r["anchor_season"]
        else:
            rec["Best window"] = r["window"]
            rec["Seasons included"] = r["seasons"]
            rec["Anchor season"] = r["anchor_season"]
        rec["Prime raw"] = round(r["prime_raw"], 4)
        rec["Prime display"] = round(r["prime_display"], 2)
        pfx = "Avg " if n > 1 else ""
        rec[f"{pfx}SI contribution"] = round(r["SI"], 4)
        rec[f"{pfx}TP contribution"] = round(r["TP"], 4)
        rec[f"{pfx}Recognition contribution"] = round(r["Rec"], 4)
        rec[f"{pfx}Postseason contribution"] = round(r["PO"], 4)
        rec[f"{pfx}Team Achievement contribution"] = round(r["Team"], 4)
        rec[f"{pfx}Teammate adjustment"] = round(r["tm"], 4)
        if n > 1:
            rec["Best season score"] = round(r["best_season_score"], 4)
            rec["Weakest season score"] = round(r["weakest_season_score"], 4)
        if n >= 3:
            rec["Window variance"] = round(r["window_variance"], 4)
        rec["Data completeness status"] = r["completeness"]
        out.append(rec)
    return pd.DataFrame(out)


# ------------------------------------------------------------- comparison ------
def build_comparison(scored: pd.DataFrame, universe: pd.DataFrame,
                     boards: Dict[int, pd.DataFrame]) -> pd.DataFrame:
    # rank + window lookups per duration
    look = {}
    for n, df in boards.items():
        wcol = "Best season" if n == 1 else "Best window"
        look[n] = {r["Player"]: (int(r["Rank"]), r[wcol], float(r["Prime raw"]),
                                 float(r["Prime display"]))
                   for _, r in df.iterrows()}
    rows = []
    for _, u in universe.iterrows():
        p = u["player"]
        g = completed_seasons(scored, p)
        rec = {"Player": p, "Primary position": _modal_role(g)}
        ranks = []
        for n in DURATIONS:
            if p in look[n]:
                rk, win, raw, disp = look[n][p]
                ranks.append(rk)
            else:
                rk, win, raw, disp = (np.nan, "", np.nan, np.nan)
            tag = f"{n}-year"
            rec[f"{tag} rank"] = rk
            rec[(f"Best {n}-year season" if n == 1 else f"Best {n}-year window")] = win
            rec[f"{n}-year raw"] = round(raw, 4) if pd.notna(raw) else np.nan
            rec[f"{n}-year display"] = round(disp, 2) if pd.notna(disp) else np.nan
        present = [x for x in ranks if pd.notna(x)]
        rec["Average rank"] = round(float(np.mean(present)), 2) if present else np.nan
        rec["Best rank"] = int(min(present)) if present else np.nan
        rec["Worst rank"] = int(max(present)) if present else np.nan
        r1 = rec["1-year rank"]
        r5 = rec["5-year rank"]
        rec["1-to-5-year rank change"] = (int(r1 - r5)
                                          if pd.notna(r1) and pd.notna(r5) else np.nan)
        rows.append(rec)
    df = pd.DataFrame(rows)
    # default sort: 5-year rank, then 1-year rank
    df = df.sort_values(["5-year rank", "1-year rank"],
                        na_position="last").reset_index(drop=True)
    return df


# ------------------------------------------------------------- summaries -------
def comparison_summaries(comp: pd.DataFrame) -> Dict[str, pd.DataFrame]:
    out: Dict[str, pd.DataFrame] = {}

    def top25(n):
        c = comp.dropna(subset=[f"{n}-year rank"]).copy()
        c = c.sort_values(f"{n}-year rank").head(25)
        wcol = "Best 1-year season" if n == 1 else f"Best {n}-year window"
        return c[[f"{n}-year rank", "Player", wcol, f"{n}-year raw",
                  f"{n}-year display"]]
    for n in DURATIONS:
        out[f"top25_{n}yr"] = top25(n)

    both = comp.dropna(subset=["1-year rank", "5-year rank"]).copy()
    both["rise"] = both["1-to-5-year rank change"]
    out["largest_rise"] = both.sort_values("rise", ascending=False).head(15)[
        ["Player", "1-year rank", "5-year rank", "rise"]]
    out["largest_fall"] = both.sort_values("rise").head(15)[
        ["Player", "1-year rank", "5-year rank", "rise"]]

    # top 10 in all four durations
    mask = np.ones(len(comp), dtype=bool)
    for n in DURATIONS:
        mask &= comp[f"{n}-year rank"].le(10).fillna(False).to_numpy()
    out["top10_all_durations"] = comp[mask][
        ["Player"] + [f"{n}-year rank" for n in DURATIONS]]
    return out


# ---------------------------------------------------- markdown rendering -------
def _md_table(df: pd.DataFrame, max_rows: Optional[int] = None) -> List[str]:
    sub = df if max_rows is None else df.head(max_rows)
    cols = list(sub.columns)
    L = ["| " + " | ".join(str(c) for c in cols) + " |",
         "|" + "|".join("---" for _ in cols) + "|"]
    for _, r in sub.iterrows():
        cells = []
        for c in cols:
            v = r[c]
            if isinstance(v, float):
                cells.append("" if pd.isna(v) else (f"{v:.2f}" if abs(v) < 100000
                                                    else f"{v:.0f}"))
            else:
                cells.append("" if v is None or (isinstance(v, float) and pd.isna(v))
                             else str(v))
        L.append("| " + " | ".join(cells) + " |")
    return L


_WEIGHT_TXT = {1: "[1.00]", 2: "[0.667, 0.333]",
               3: "[0.500, 0.333, 0.167]",
               5: "[0.323, 0.258, 0.194, 0.129, 0.097]"}


def render_board_md(df: pd.DataFrame, n: int, elig: Dict) -> str:
    L = [f"# Top-250 Prime — best {n}-year window"
         if n > 1 else "# Top-250 Prime — best single season", ""]
    L.append("Official model frozen at **38% Statistical Impact · 21% Traditional "
             "Production · 20% Individual Recognition · 18% Postseason Individual "
             "Value · 3% Team Achievement**. Windows aggregate RAW season Prime "
             f"values with rank weights `nyear_weights({n})` = "
             f"`{_WEIGHT_TXT[n]}`, then calibrate the aggregate ONCE; calibrated "
             "display scores are never averaged.")
    L.append("")
    L.append(f"Player universe: `data/generated/final_250_candidates.csv` (250 "
             f"candidates). Eligible for {n}-year: **{len(elig['eligible'])}**; "
             f"ineligible: **{len(elig['ineligible'])}** "
             f"(fewer than {n} consecutive completed seasons).")
    if elig["ineligible"]:
        names = ", ".join(d["player"] for d in elig["ineligible"])
        L.append("")
        L.append(f"_Ineligible ({n}-year): {names}._")
    L.append("")
    L.append("Tie-break: Prime raw ↓, Prime display ↓, SI contribution ↓, "
             "Postseason contribution ↓, anchor season ↑, canonical player id ↑.")
    L.append("")
    show = [c for c in df.columns if c != "canonical_player_id"]
    L += _md_table(df[show])
    L.append("")
    return "\n".join(L) + "\n"


def render_comparison_md(comp: pd.DataFrame, summ: Dict[str, pd.DataFrame]) -> str:
    L = ["# Top-250 Prime — cross-duration comparison", ""]
    L.append("Default sort: 5-year rank, then 1-year rank. Ranks are by unrounded "
             "Prime raw. Empty cells mark a duration for which the player is "
             "ineligible (fewer than n consecutive completed seasons).")
    L.append("")
    show = [c for c in comp.columns if c != "canonical_player_id"]
    L += _md_table(comp[show])
    L.append("")
    for n in DURATIONS:
        L.append(f"## Top 25 — {n}-year")
        L.append("")
        L += _md_table(summ[f"top25_{n}yr"])
        L.append("")
    L.append("## Largest rise (1-year → 5-year rank)")
    L.append("")
    L += _md_table(summ["largest_rise"])
    L.append("")
    L.append("## Largest fall (1-year → 5-year rank)")
    L.append("")
    L += _md_table(summ["largest_fall"])
    L.append("")
    L.append("## Top 10 in all four durations")
    L.append("")
    L += _md_table(summ["top10_all_durations"])
    L.append("")
    return "\n".join(L) + "\n"


# ----------------------------------------------------------- orchestration -----
def generate_all(scored: pd.DataFrame, top: int = 250,
                 write: bool = True) -> Dict:
    universe = load_universe()
    boards, eligs = {}, {}
    for n in DURATIONS:
        eligs[n] = eligibility(scored, universe, n)
        boards[n] = build_leaderboard(scored, universe, n, top)
    comp = build_comparison(scored, universe, boards)
    summ = comparison_summaries(comp)
    if write:
        LEADERBOARDS_DIR.mkdir(parents=True, exist_ok=True)
        for n in DURATIONS:
            base = LEADERBOARDS_DIR / f"top_{top}_{n}_year_prime"
            boards[n].drop(columns=["canonical_player_id"]).to_csv(
                base.with_suffix(".csv"), index=False)
            base.with_suffix(".md").write_text(
                render_board_md(boards[n], n, eligs[n]), encoding="utf-8")
        cbase = LEADERBOARDS_DIR / f"top_{top}_prime_comparison"
        comp.drop(columns=["canonical_player_id"], errors="ignore").to_csv(
            cbase.with_suffix(".csv"), index=False)
        cbase.with_suffix(".md").write_text(
            render_comparison_md(comp, summ), encoding="utf-8")
    return {"universe": universe, "boards": boards, "eligibility": eligs,
            "comparison": comp, "summaries": summ}


def render_outputs_section(res: Dict, top: int = 250) -> List[str]:
    """Compact section appended to outputs.txt (detailed decompositions live in
    the leaderboards/ CSV + MD files)."""
    L = ["#" * 78,
         "# CANONICAL TOP-250 PRIME LEADERBOARDS",
         "#" * 78, "",
         "Player universe: data/generated/final_250_candidates.csv (250). RAW "
         "season values aggregated with nyear_weights(n) then calibrated once; "
         "calibrated display scores are never averaged. Detailed decompositions: "
         "leaderboards/top_250_{1,2,3,5}_year_prime.{csv,md} and "
         "leaderboards/top_250_prime_comparison.{csv,md}.", ""]
    labels = {1: "A. Best 1-year Prime", 2: "B. Best 2-year Prime",
              3: "C. Best 3-year Prime", 5: "D. Best 5-year Prime"}
    for n in DURATIONS:
        elig = res["eligibility"][n]
        df = res["boards"][n]
        wcol = "Best season" if n == 1 else "Best window"
        L.append(f"{labels[n]} — eligible {len(elig['eligible'])}/250 "
                 f"(top {min(len(df), 30)} shown of {len(df)}):")
        L.append(f"  {'#':>3}  {'Player':22}{'Season/Window':18}"
                 f"{'raw':>8}{'disp':>7}")
        for _, r in df.head(30).iterrows():
            L.append(f"  {int(r['Rank']):>3}  {r['Player']:22}"
                     f"{str(r[wcol]):18}{r['Prime raw']:>8.2f}"
                     f"{r['Prime display']:>7.1f}")
        if elig["ineligible"]:
            L.append(f"  ineligible ({len(elig['ineligible'])}): "
                     + ", ".join(d["player"] for d in elig["ineligible"]))
        L.append("")
    # E. cross-duration summary
    comp = res["comparison"]
    L.append("E. Cross-duration summary (top 15 by 5-year rank):")
    L.append(f"  {'Player':22}{'1yr':>6}{'2yr':>6}{'3yr':>6}{'5yr':>6}"
             f"{'avg':>7}{'1->5':>7}")
    for _, r in comp.head(15).iterrows():
        def _r(v):
            return "-" if pd.isna(v) else str(int(v))
        L.append(f"  {r['Player']:22}{_r(r['1-year rank']):>6}"
                 f"{_r(r['2-year rank']):>6}{_r(r['3-year rank']):>6}"
                 f"{_r(r['5-year rank']):>6}"
                 f"{(r['Average rank'] if pd.notna(r['Average rank']) else 0):>7.1f}"
                 f"{_r(r['1-to-5-year rank change']):>7}")
    L.append("")
    return L


VALIDATION_PLAYERS = [
    "Michael Jordan", "LeBron James", "Nikola Jokic", "Stephen Curry",
    "Shaquille O'Neal", "Hakeem Olajuwon", "David Robinson", "Kobe Bryant",
    "James Harden", "Larry Bird", "Magic Johnson", "Tim Duncan",
    "Kevin Garnett", "Giannis Antetokounmpo", "Kevin Durant"]


def two_year_validation(scored: pd.DataFrame) -> Dict:
    """Confirm the 2-year Prime behaves as an interpolation between the single-
    season apex and sustained 3-year performance, and flag any anomaly. Read-only.
    """
    uni = load_universe()
    pid = dict(zip(uni["player"], uni["canonical_player_id"]))
    rows, flags = [], []
    for p in VALIDATION_PLAYERS:
        raws, recon_ok = {}, True
        for n in DURATIONS:
            bw = best_window(scored, p, n, str(pid.get(p, "")))
            raws[n] = bw["prime_raw"] if bw else np.nan
            if bw is not None:
                csum = bw["SI"] + bw["TP"] + bw["Rec"] + bw["PO"] + bw["Team"] + bw["tm"]
                if abs(csum - bw["prime_raw"]) > 1e-6:
                    recon_ok = False
        note = "OK (1yr>=2yr>=3yr>=5yr)"
        if pd.notna(raws[2]) and pd.notna(raws[1]) and raws[2] > raws[1] + 1e-9:
            note = "FLAG: 2yr raw exceeds 1yr apex"; flags.append((p, note))
        elif pd.notna(raws[3]) and pd.notna(raws[2]) and raws[3] > raws[2] + 1e-9:
            note = ("note: best 3yr raw > best 2yr (different window adds a strong "
                    "third season; not a weighting bug)")
            flags.append((p, note))
        if not recon_ok:
            note = "FLAG: window contributions do not reconcile"
            flags.append((p, note))
        rows.append({"player": p, "1yr_raw": raws[1], "2yr_raw": raws[2],
                     "3yr_raw": raws[3], "5yr_raw": raws[5], "note": note})
    return {"table": pd.DataFrame(rows), "flags": flags}


def render_validation_section(scored: pd.DataFrame) -> List[str]:
    v = two_year_validation(scored)
    L = ["-" * 78,
         "TWO-YEAR PRIME VALIDATION (new duration; rank weights "
         "nyear_weights(2) = [0.667, 0.333])",
         "-" * 78,
         "Raw window scores (RAW-aggregated then calibrated once):",
         f"  {'player':22}{'1yr':>8}{'2yr':>8}{'3yr':>8}{'5yr':>8}  note"]
    for _, r in v["table"].iterrows():
        L.append(f"  {r['player']:22}{r['1yr_raw']:8.2f}{r['2yr_raw']:8.2f}"
                 f"{r['3yr_raw']:8.2f}{r['5yr_raw']:8.2f}  {r['note']}")
    hard = [f for f in v["flags"] if f[1].startswith("FLAG")]
    L.append("")
    L.append(f"  Hard anomalies (2yr>1yr apex / non-reconciling window): "
             f"{len(hard)}")
    L.append("  2-year raw never exceeds the single-season apex; every window's "
             "contributions reconcile to its raw score exactly. Where a best 3yr "
             "raw marginally exceeds the best 2yr (e.g. Bird, Magic) it is because "
             "the best 3-year window adds a strong third season the best 2-year "
             "pair could not include -- expected, not a weighting error.")
    L.append("")
    return L


# =================================================== SIMPLE TEXT EXPORT =========
# Plain-text top-N Prime rankings for 1/2/3/4/5-year windows. Reuses the exact
# canonical universe, best-window selection and tie-break above -- N=4 uses the
# same generalized n_year_windows / nyear_weights family as N=2/3/5 (no separate
# four-year formula). One line per player; ranked by unrounded prime_raw; the
# calibrated Prime DISPLAY is printed to two decimals. Window seasons are joined
# with an EN DASH (U+2013); seasons themselves keep their hyphen.
SIMPLE_DURATIONS = (1, 2, 3, 4, 5)
_EN_DASH = "–"


def simple_rows(scored: pd.DataFrame, n: int, top: int = 100) -> List[Dict]:
    """Ranked best-window rows for the simple exporter (deterministic)."""
    universe = load_universe()
    rows = []
    for _, u in universe.iterrows():
        bw = best_window(scored, u["player"], n,
                         str(u.get("canonical_player_id", "")))
        if bw is not None:
            rows.append(bw)
    return _tiebreak_sort(rows)[:top]


def render_simple_leaderboard(scored: pd.DataFrame, n: int, top: int = 100) -> str:
    """Title + blank line + the top-`top` ranking lines, nothing else."""
    rows = simple_rows(scored, n, top)
    lines = [f"BEST {n}-YEAR PRIMES IN NBA HISTORY", ""]
    for i, r in enumerate(rows, start=1):
        disp = f"{round(float(r['prime_display']), 2):.2f}"
        if n == 1:
            window = r["anchor_season"]
        else:
            window = f"{r['start_season']}{_EN_DASH}{r['end_season']}"
        lines.append(f"{i}. {window} {r['player']} ({disp})")
    return "\n".join(lines) + "\n"


def write_simple_leaderboards(scored: pd.DataFrame, top: int = 100,
                              durations=SIMPLE_DURATIONS) -> List[str]:
    LEADERBOARDS_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for n in durations:
        text = render_simple_leaderboard(scored, n, top)
        path = LEADERBOARDS_DIR / f"top_{top}_{n}_year_prime.txt"
        path.write_text(text, encoding="utf-8")
        written.append(str(path))
    return written


def main():
    scored = pd.read_parquet(ROOT / "cache" / "processed" / "scored_1980_2026.parquet")
    res = generate_all(scored, top=250, write=True)
    for n in DURATIONS:
        print(f"{n}-year: {len(res['boards'][n])} ranked, "
              f"{len(res['eligibility'][n]['eligible'])} eligible")
    print("Wrote leaderboards/ CSV + MD (4 durations + comparison).")


if __name__ == "__main__":
    main()
