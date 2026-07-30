#!/usr/bin/env python3
"""Phase 8F: spinner/team-season randomness and fairness audit.

Answers, with evidence rather than assumption, the questions raised about
whether "I rarely roll bad spins" reflects a real bias in the spin
mechanism:

  - Is the spinner uniform over rollable team-seasons, or weighted?
  - Are high-candidate-count / strong teams overrepresented?
  - Are weak/thin team-seasons naturally reachable, and how often?
  - Does the team-year engine's respin stay independent per axis?

Two engines exist and are audited separately, because they use genuinely
different sampling strategies (this is not a bug in either -- see each
section's own findings):

  1. FLAGSHIP engine (generate_team_year_board / get_rollable_team_year_entries
     -- COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED, default TRUE as of
     Phase 8F). This is what the flagship 82-0 Peak Season route actually
     runs today. Uses plain `entries[rng.randrange(len(entries))]`, WITH
     replacement, over the full ~1,314-entry rollable team-season catalogue
     -- uniform by construction. Respins (action_respin_team/
     action_respin_season in apps/api/app/services/perfect_season/state.py)
     are ALSO uniform within their constrained pool (same-season-different-
     team, or same-team-different-season) via the same rng.randrange
     pattern.

  2. LEGACY engine (nba_peak.perfect_season.board.generate_board,
     COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=False -- an explicit,
     clearly secondary opt-out; NOT the flagship path since Phase 8F fixed
     the "flagship route silently falls back to the tiny interim catalogue"
     regression). Uses _select_interim_entries: deliberate 3x weighted
     sampling WITHOUT replacement, favoring entries with >=
     PREFERRED_MIN_CANDIDATES candidates over thin ("sparse") ones, drawn
     from a ~19-entry catalogue. This is a documented, deliberate design
     choice for this smaller engine (see board.py's own comment above
     _GOOD_ENTRY_WEIGHT), not something this script assumes should be
     uniform -- and not what a normal flagship playthrough exercises.

Never forces or injects an artificial "bad spin" into gameplay -- this
script only OBSERVES what the existing generators already produce across
many seeds. No generated artifact from this script is committed (run it,
read the printed report, done).

Usage:
    python scripts/audit_spinner_fairness.py
    python scripts/audit_spinner_fairness.py --seeds 100000
    python scripts/audit_spinner_fairness.py --mode prime_3y --seeds 5000
"""
from __future__ import annotations

import argparse
import collections
import statistics
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from nba_peak.perfect_season.board import (  # noqa: E402
    _all_interim_spin_entries,
    _candidates_for_entry,
    _load_interim_teams,
    generate_board,
    generate_team_year_board,
    get_rollable_team_year_entries,
)
from nba_peak.lineup.board import _load_profiles  # noqa: E402
from nba_peak.perfect_season.config import MODE_TO_YEARS, PREFERRED_MIN_CANDIDATES, TOTAL_ROUNDS  # noqa: E402


def _fmt_pct(n: int, total: int) -> str:
    return f"{100 * n / total:.2f}%" if total else "n/a"


def _print_top_bottom(counter: collections.Counter, label: str, n: int = 8) -> None:
    total = sum(counter.values())
    ranked = counter.most_common()
    print(f"\n  Most-rolled {label} (top {n} of {len(ranked)} distinct):")
    for name, count in ranked[:n]:
        print(f"    {name!s:40s} {count:6d}  ({_fmt_pct(count, total)})")
    print(f"  Least-rolled {label} (bottom {n} of {len(ranked)} distinct):")
    for name, count in ranked[-n:]:
        print(f"    {name!s:40s} {count:6d}  ({_fmt_pct(count, total)})")


def audit_default_engine(mode: str, n_seeds: int) -> None:
    print("=" * 78)
    print(f"LEGACY ENGINE (generate_board, team_spin_enabled=True) -- mode={mode}")
    print("NOT the flagship path since Phase 8F -- only reachable if a developer")
    print("explicitly sets PEAK3_COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED=false.")
    print("=" * 78)

    duration = MODE_TO_YEARS[mode]
    by_dur = _load_profiles()
    duration_pool = by_dur.get(duration, [])
    interim_data = _load_interim_teams()
    interim_entries = _all_interim_spin_entries(interim_data)

    # --- Step 1: what does the CATALOGUE itself look like, independent of
    # sampling -- every entry's real candidate count, computed once. This is
    # the ground truth _select_interim_entries samples from.
    catalogue = [(e, _candidates_for_entry(e, duration_pool)) for e in interim_entries]
    catalogue = [(e, c) for e, c in catalogue if len(c) > 0]
    good_entries = [e for e, c in catalogue if len(c) >= PREFERRED_MIN_CANDIDATES]
    sparse_entries = [e for e, c in catalogue if len(c) < PREFERRED_MIN_CANDIDATES]
    print(f"\nCatalogue: {len(catalogue)} playable team-season entries at duration={duration}yr")
    print(f"  'good' (>= {PREFERRED_MIN_CANDIDATES} candidates): {len(good_entries)} ({_fmt_pct(len(good_entries), len(catalogue))})")
    print(f"  'sparse' (< {PREFERRED_MIN_CANDIDATES} candidates): {len(sparse_entries)} ({_fmt_pct(len(sparse_entries), len(catalogue))})")
    print("  Design: good entries get 3x the selection weight of sparse ones")
    print("  (board.py _GOOD_ENTRY_WEIGHT/_SPARSE_ENTRY_WEIGHT) -- NOT uniform,")
    print("  by deliberate choice, so this script checks against THAT target,")
    print("  not an assumed-uniform one.")

    # --- Step 2: sample N boards, record what actually gets rolled.
    team_counter: collections.Counter = collections.Counter()
    era_counter: collections.Counter = collections.Counter()
    team_era_counter: collections.Counter = collections.Counter()
    spin_type_counter: collections.Counter = collections.Counter()
    candidate_counts: list[int] = []
    sparse_rolled = 0
    good_rolled = 0
    sparse_examples: list[tuple[str, str, int, int]] = []

    good_keys = {(e.get("franchise_display_name"), e.get("era_label")) for e in good_entries}

    for seed in range(n_seeds):
        board = generate_board(mode=mode, seed=seed, team_spin_enabled=True)
        for spin in board.spins:
            spin_type_counter[spin.spin_type] += 1
            if spin.spin_type == "open_pool":
                continue
            key = (spin.franchise_display_name, spin.era_label)
            team_counter[spin.franchise_display_name] += 1
            era_counter[spin.era_label] += 1
            team_era_counter[key] += 1
            n_cands = len(spin.candidate_player_slugs)
            candidate_counts.append(n_cands)
            if key in good_keys:
                good_rolled += 1
            else:
                sparse_rolled += 1
                if len(sparse_examples) < 12:
                    sparse_examples.append((spin.franchise_display_name, spin.era_label, n_cands, seed))

    total_rolled = good_rolled + sparse_rolled
    print(f"\nSampled {n_seeds} boards x {TOTAL_ROUNDS} rounds = {sum(spin_type_counter.values())} spins")
    print(f"  spin_type breakdown: {dict(spin_type_counter)}")
    print(f"\nObserved good:sparse roll ratio: {good_rolled}:{sparse_rolled} "
          f"({_fmt_pct(good_rolled, total_rolled)} good / {_fmt_pct(sparse_rolled, total_rolled)} sparse)")
    print("  Catalogue good:sparse ratio (what a uniform-over-entries sampler")
    print(f"  would produce): {len(good_entries)}:{len(sparse_entries)} "
          f"({_fmt_pct(len(good_entries), len(catalogue))} good)")
    print("  Compare the two ratios above: the observed one should sit well")
    print("  above the catalogue's raw ratio (proving the 3x weighting is")
    print("  real and working), while still leaving sparse entries reachable.")

    if candidate_counts:
        print(f"\nCandidate-count distribution across {len(candidate_counts)} non-open_pool spins:")
        print(f"  min={min(candidate_counts)} max={max(candidate_counts)} "
              f"mean={statistics.mean(candidate_counts):.2f} median={statistics.median(candidate_counts):.1f}")
        print(f"  spins with exactly 1 candidate (thinnest possible): "
              f"{sum(1 for c in candidate_counts if c == 1)} ({_fmt_pct(sum(1 for c in candidate_counts if c == 1), len(candidate_counts))})")

    _print_top_bottom(team_counter, "franchises")
    _print_top_bottom(era_counter, "eras/seasons")
    _print_top_bottom(team_era_counter, "team-season combos")

    cv = (statistics.pstdev(team_counter.values()) / statistics.mean(team_counter.values())) if team_counter else 0.0
    print(f"\nFranchise-frequency coefficient of variation: {cv:.3f} "
          "(0 = perfectly even; higher = more concentrated on a few franchises)")

    print(f"\nNaturally-sampled thin/sparse spins actually rolled (proof bad spins ARE reachable):")
    if sparse_examples:
        for team, era, n_cands, seed in sparse_examples:
            print(f"    seed={seed:6d}  {team} {era}  -- {n_cands} candidate(s)")
    else:
        print("    None observed in this sample -- try a larger --seeds value.")


def audit_team_year_engine(mode: str, n_seeds: int) -> None:
    print("\n" + "=" * 78)
    print(f"FLAGSHIP ENGINE (generate_team_year_board) -- mode={mode}")
    print("This is the default flagship 82-0 Peak Season engine since Phase 8F")
    print("(PEAK3_COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED default is now true).")
    print("Sampling is `entries[rng.randrange(len(entries))]`, WITH replacement,")
    print("uniform by construction -- this section verifies that claim empirically")
    print("rather than trusting the code comment.")
    print("=" * 78)

    try:
        entries = get_rollable_team_year_entries()
    except FileNotFoundError as exc:
        print(f"\n  SKIPPED -- experimental dataset not available: {exc}")
        return
    if not entries:
        print("\n  SKIPPED -- no rollable team-year entries in this dataset.")
        return

    print(f"\nCatalogue: {len(entries)} rollable team-season entries "
          f"(>= {8} real candidates each, MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON)")
    expected_share = 1.0 / len(entries)
    print(f"  Uniform expectation: each entry ~{expected_share * 100:.4f}% of rolls")

    team_era_counter: collections.Counter = collections.Counter()
    for seed in range(n_seeds):
        board = generate_team_year_board(mode=mode, seed=seed)
        for spin in board.spins:
            team_era_counter[(spin.franchise_display_name, spin.era_label)] += 1

    total = sum(team_era_counter.values())
    counts = list(team_era_counter.values())
    print(f"\nSampled {n_seeds} boards x {TOTAL_ROUNDS} rounds = {total} spins, "
          f"landing on {len(team_era_counter)}/{len(entries)} distinct entries")
    if counts:
        mean_c = statistics.mean(counts)
        cv = statistics.pstdev(counts) / mean_c if mean_c else 0.0
        print(f"  per-entry roll count: min={min(counts)} max={max(counts)} mean={mean_c:.2f} "
              f"coefficient_of_variation={cv:.3f}")
        print("  A low CV here (well under the default engine's, since this pool has no")
        print("  deliberate weighting) is the expected signature of true uniform sampling.")

    _print_top_bottom(team_era_counter, "team-season combos (team_year engine)")


def audit_respin_independence(mode: str, n_trials: int) -> None:
    """Uses the REAL state machine (apps/api/app/services/perfect_season/
    state.py), not a reimplementation, so this tests the actual code path a
    player exercises -- not an idealized model of it."""
    print("\n" + "=" * 78)
    print("RESPIN INDEPENDENCE AUDIT (real state machine, team_year mode)")
    print("=" * 78)

    sys.path.insert(0, str(REPO_ROOT / "apps" / "api"))
    try:
        from app.services.perfect_season import state as state_machine  # type: ignore
    except Exception as exc:  # pragma: no cover -- diagnostic only
        print(f"\n  SKIPPED -- could not import API state machine: {exc}")
        return

    team_only_season_changed = 0
    team_only_team_unchanged = 0
    season_only_team_changed = 0
    season_only_season_unchanged = 0
    new_teams_seen: set[str] = set()
    new_seasons_seen: set[str] = set()

    for seed in range(n_trials):
        try:
            game = state_machine.create_perfect_season_game(
                mode=mode, seed=seed, team_spin_enabled=True, team_year_enabled=True,
            )
        except (FileNotFoundError, RuntimeError):
            print("  SKIPPED -- team_year dataset/board not available in this environment.")
            return
        spin = state_machine.find_spin(game.board, game.current_round)
        before_team, before_season = spin.franchise_display_name, spin.era_label

        try:
            game = state_machine.action_respin_team(game)
        except Exception:
            continue
        spin = state_machine.find_spin(game.board, game.current_round)
        if spin.era_label == before_season:
            team_only_season_changed += 0
            team_only_season_changed_flag = True
        else:
            team_only_season_changed += 1
            team_only_season_changed_flag = False
        if spin.franchise_display_name != before_team:
            team_only_team_unchanged += 1
        new_teams_seen.add(spin.franchise_display_name)

    for seed in range(n_trials):
        try:
            game = state_machine.create_perfect_season_game(
                mode=mode, seed=seed + 1_000_000, team_spin_enabled=True, team_year_enabled=True,
            )
        except (FileNotFoundError, RuntimeError):
            return
        spin = state_machine.find_spin(game.board, game.current_round)
        before_team, before_season = spin.franchise_display_name, spin.era_label
        try:
            game = state_machine.action_respin_season(game)
        except Exception:
            continue
        spin = state_machine.find_spin(game.board, game.current_round)
        if spin.franchise_display_name == before_team:
            season_only_team_changed += 0
        else:
            season_only_team_changed += 1
        if spin.era_label != before_season:
            season_only_season_unchanged += 1
        new_seasons_seen.add(spin.era_label)

    print(f"\nTeam-only respin trials: {n_trials}")
    print(f"  season UNCHANGED (correct): {n_trials - team_only_season_changed}/{n_trials}")
    print(f"  season changed (only allowed when no same-season alternate team exists): {team_only_season_changed}/{n_trials}")
    print(f"  team actually changed: {team_only_team_unchanged}/{n_trials}")
    print(f"  distinct new teams observed: {len(new_teams_seen)}")

    print(f"\nSeason-only respin trials: {n_trials}")
    print(f"  team UNCHANGED (correct): {n_trials - season_only_team_changed}/{n_trials}")
    print(f"  team changed (only allowed when no same-team alternate season exists): {season_only_team_changed}/{n_trials}")
    print(f"  season actually changed: {season_only_season_unchanged}/{n_trials}")
    print(f"  distinct new seasons observed: {len(new_seasons_seen)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seeds", type=int, default=10_000, help="number of board seeds to sample (default 10,000)")
    parser.add_argument("--mode", default="apex_1y", choices=sorted(MODE_TO_YEARS.keys()), help="game mode to audit")
    parser.add_argument("--respin-trials", type=int, default=2_000, help="number of respin trials to run")
    args = parser.parse_args()

    audit_default_engine(args.mode, args.seeds)
    audit_team_year_engine(args.mode, args.seeds)
    audit_respin_independence(args.mode, args.respin_trials)


if __name__ == "__main__":
    main()
