#!/usr/bin/env python3
"""Phase 6F Part D: developer-only manual PEAK Season lineup simulator.

Bypasses the spinner entirely and directly tests exact player-season cards
through the SAME simulator the UI uses (nba_peak.perfect_season.simulation.
simulate_exact_season) -- for calibration/ceiling testing, not gameplay.
Every card is resolved via nba_peak.perfect_season.exact_season.
resolve_player_season_card, the same exact-team-season resolver PEAK Season
itself uses -- no career-peak substitution, no score fabrication.

Usage:
    python scripts/simulate_peak_season_lineup.py \\
      --slot PG:stephen-curry:2015-16:GSW \\
      --slot SG:michael-jordan:1990-91:CHI \\
      --slot SF:lebron-james:2012-13:MIA \\
      --slot PF:kevin-garnett:2003-04:MIN \\
      --slot C:nikola-jokic:2022-23:DEN \\
      --slot bench_1:shaquille-o-neal:1999-00:LAL \\
      --slot bench_2:kevin-durant:2013-14:OKC \\
      --slot bench_3:tim-duncan:2002-03:SAS

    python scripts/simulate_peak_season_lineup.py --input examples/perfect_lineups/all_time_exact_season_ceiling.json
    python scripts/simulate_peak_season_lineup.py --input examples/perfect_lineups/all_time_exact_season_ceiling.json --json

--slot value format: SLOT:player_slug:season:team_id_or_display_name
  team_id_or_display_name accepts either a BR team code (GSW) or a
  hyphenated/spaced display name (Golden-State-Warriors / "Golden State
  Warriors") -- resolved via nba_peak.perfect_season.exact_season.TEAM_ID_TO_NAME.

Exit codes: 0 = simulated successfully, 1 = a card failed to resolve to the
EXACT requested team/season (or was unscored without --allow-unscored) --
this is a hard failure, never a silent substitution.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nba_peak.perfect_season.config import SLOT_TYPES  # noqa: E402
from nba_peak.perfect_season.exact_season import (  # noqa: E402
    TEAM_ID_TO_NAME,
    PlayerSeasonCard,
    resolve_player_season_card,
)
from nba_peak.perfect_season.positions import parse_real_position  # noqa: E402
from nba_peak.perfect_season.simulation import simulate_exact_season  # noqa: E402

_NAME_TO_TEAM_ID = {v.lower().replace(" ", "-"): k for k, v in TEAM_ID_TO_NAME.items()}
_NAME_TO_TEAM_ID.update({v.lower(): k for k, v in TEAM_ID_TO_NAME.items()})


def resolve_team_id(raw: str) -> str:
    if raw.upper() in TEAM_ID_TO_NAME:
        return raw.upper()
    key = raw.lower().strip()
    if key in _NAME_TO_TEAM_ID:
        return _NAME_TO_TEAM_ID[key]
    raise ValueError(f"Unrecognized team '{raw}' -- use a team_id (e.g. GSW) or exact display name (e.g. 'Golden State Warriors').")


def parse_slot_arg(raw: str) -> dict:
    parts = raw.split(":")
    if len(parts) != 4:
        raise ValueError(f"--slot must be SLOT:player_slug:season:team, got '{raw}'")
    slot, player_slug, season, team_raw = parts
    if slot not in SLOT_TYPES:
        raise ValueError(f"Unknown slot '{slot}'. Valid: {SLOT_TYPES}")
    return {"slot": slot, "player_slug": player_slug, "season": season, "team": resolve_team_id(team_raw)}


def load_input_file(path: Path) -> list[dict]:
    data = json.loads(path.read_text())
    slots_raw = data["slots"] if isinstance(data, dict) else data
    out = []
    for entry in slots_raw:
        team = entry.get("team") or entry.get("team_id")
        out.append({
            "slot": entry["slot"],
            "player_slug": entry["player_slug"],
            "season": entry["season"],
            "team": resolve_team_id(team),
        })
    return out


def resolve_lineup(slot_entries: list[dict], allow_unscored: bool) -> tuple[list[PlayerSeasonCard], list[str], list[str]]:
    """Resolve every slot to an exact PlayerSeasonCard, in SLOT_TYPES order.
    Returns (cards, slot_types, warnings). Raises SystemExit(1) on any hard
    failure (unresolvable card, team/season mismatch, or unscored without
    --allow-unscored) -- never substitutes silently."""
    by_slot = {e["slot"]: e for e in slot_entries}
    missing = [s for s in SLOT_TYPES if s not in by_slot]
    if missing:
        print(f"ERROR: missing slot(s): {missing}. All 8 slots (PG,SG,SF,PF,C,bench_1,bench_2,bench_3) are required.")
        sys.exit(1)

    cards: list[PlayerSeasonCard] = []
    warnings: list[str] = []
    for slot in SLOT_TYPES:
        e = by_slot[slot]
        card = resolve_player_season_card(e["player_slug"], e["team"], e["season"])
        if card is None:
            print(f"ERROR [{slot}]: '{e['player_slug']}' has no real roster record for {e['team']} {e['season']} -- "
                  "not resolvable, never substituted with a different team/season/career-peak card.")
            sys.exit(1)
        if card.season != e["season"] or card.team_id != e["team"]:
            print(f"ERROR [{slot}]: resolved card {card.player_name} {card.team_id} {card.season} does not match "
                  f"the requested {e['team']} {e['season']} -- exact-season invariant violated.")
            sys.exit(1)
        if card.score_status != "exact_season_scored":
            if not allow_unscored:
                print(f"ERROR [{slot}]: {card.player_name} {card.team_id} {card.season} is '{card.score_status}' "
                      "(no official PEAK3 score for this exact season) -- pass --allow-unscored to include it anyway.")
                sys.exit(1)
            warnings.append(f"{slot}: {card.player_name} {card.team_id} {card.season} is unscored ({card.score_status}) -- included via --allow-unscored.")
        cards.append(card)
    return cards, SLOT_TYPES, warnings


def render_text(cards: list[PlayerSeasonCard], slot_types: list[str], warnings: list[str]) -> None:
    from nba_peak.perfect_season.simulation import compute_exact_fit_components

    result = simulate_exact_season(cards, board_seed=1, slot_types=slot_types)
    fit = compute_exact_fit_components(cards, slot_types)

    print("=" * 72)
    print("Resolved exact player-season cards")
    print("=" * 72)
    for slot, card in zip(slot_types, cards):
        primary, secondary = parse_real_position(card.position)
        sec = f"/{'/'.join(secondary)}" if secondary else ""
        score_str = f"{card.season_score:.2f}" if card.season_score is not None else "N/A"
        print(f"  {slot:9s} {card.player_name:24s} {card.team_name:26s} {card.season:8s} "
              f"pos={primary or '?'}{sec:6s} score={score_str:6s} status={card.score_status}")

    print()
    print("=" * 72)
    print("Lineup fit components")
    print("=" * 72)
    for k, v in fit.as_dict().items():
        print(f"  {k:22s} {v:6.2f}")

    print()
    print("=" * 72)
    print("Simulation result")
    print("=" * 72)
    print(f"  Projected record:       {result.wins}-{result.losses}")
    print(f"  Expected wins:          {result.expected_wins} (range {result.expected_wins_low}-{result.expected_wins_high})")
    print(f"  Is perfect season:      {result.is_perfect_season}")
    print(f"  PEAK3 Lineup Score:     {result.lineup_peak_score}")
    scored = sum(1 for c in cards if c.score_status == "exact_season_scored")
    print(f"  Score coverage:         {scored}/{len(cards)} exact season cards scored")
    print(f"  Decisive factors:       {result.decisive_factors}")
    print(f"  Best pick:              {result.best_pick}")
    print(f"  Structural weakness:    {result.structural_weakness}")
    if warnings:
        print(f"  Warnings:               {warnings}")
    print()


def render_json(cards: list[PlayerSeasonCard], slot_types: list[str], warnings: list[str]) -> None:
    from nba_peak.perfect_season.simulation import compute_exact_fit_components

    result = simulate_exact_season(cards, board_seed=1, slot_types=slot_types)
    fit = compute_exact_fit_components(cards, slot_types)
    scored = sum(1 for c in cards if c.score_status == "exact_season_scored")

    payload = {
        "cards": [
            {
                "slot": slot,
                "player_slug": card.player_slug,
                "player_name": card.player_name,
                "team_id": card.team_id,
                "team_name": card.team_name,
                "season": card.season,
                "position": card.position,
                "season_score": card.season_score,
                "score_status": card.score_status,
                "identity_pool_status": card.identity_pool_status,
            }
            for slot, card in zip(slot_types, cards)
        ],
        "fit_components": fit.as_dict(),
        "wins": result.wins,
        "losses": result.losses,
        "expected_wins": result.expected_wins,
        "expected_wins_low": result.expected_wins_low,
        "expected_wins_high": result.expected_wins_high,
        "is_perfect_season": result.is_perfect_season,
        "lineup_peak_score": result.lineup_peak_score,
        "score_coverage": f"{scored}/{len(cards)}",
        "decisive_factors": result.decisive_factors,
        "best_pick": result.best_pick,
        "structural_weakness": result.structural_weakness,
        "warnings": warnings,
    }
    print(json.dumps(payload, indent=2))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--slot", action="append", default=[], help="SLOT:player_slug:season:team")
    parser.add_argument("--input", type=str, help="Path to a JSON lineup file")
    parser.add_argument("--allow-unscored", action="store_true")
    parser.add_argument("--json", action="store_true", help="Machine-readable JSON output")
    args = parser.parse_args()

    if not args.slot and not args.input:
        parser.print_help()
        return 1

    try:
        if args.input:
            slot_entries = load_input_file(Path(args.input))
        else:
            slot_entries = [parse_slot_arg(s) for s in args.slot]
    except (ValueError, KeyError, FileNotFoundError) as exc:
        print(f"ERROR: {exc}")
        return 1

    cards, slot_types, warnings = resolve_lineup(slot_entries, args.allow_unscored)

    if args.json:
        render_json(cards, slot_types, warnings)
    else:
        render_text(cards, slot_types, warnings)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
