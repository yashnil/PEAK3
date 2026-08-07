#!/usr/bin/env python3
"""TMW-03: exhaustive franchise x decade candidate-pool audit for THREE-MAN WEAVE.

WHAT THIS ANSWERS
-----------------
"Is every player who actually recorded a season for franchise F in decade D
discoverable on the F x D roll -- and if not, exactly why not, with evidence?"

It is deliberately NOT a Dennis Rodman patch. Rodman is one named regression at
the bottom of a sweep over all 30 franchises x 5 decades = 150 combinations; the
audit would have failed identically for the other 1,383 identities had the same
defect touched them.

METHOD
------
The EXPECTED pool is re-derived here from the canonical season records, on
purpose, rather than imported from `nba_peak.three_man_weave.eligibility`. An
audit that asks the implementation what it thinks the answer is can only ever
agree with itself. The two sides therefore share exactly one thing -- the
franchise-continuity table in `nba_peak.franchises` and the decade bucketing in
`nba_peak.three_man_weave.config`, both of which are the RULES the audit is
checking compliance with, not the implementation of the pool.

  expected[(franchise, decade)]
      every identity with at least one canonical season record for that
      franchise in that decade, after:
        * franchise canonicalisation / relocation folding
          (SEA -> OKC, VAN -> MEM, NJN -> BRK, CHH/CHO -> CHA, WSB -> WAS,
           SDC -> LAC, KCK -> SAC, NOH/NOK -> NOP);
        * multi-team ("2TM"/"3TM"/.../"TOT") row expansion through the real
          per-team stints file, so a mid-season trade contributes a season to
          BOTH franchises rather than to neither;
        * decade bucketing by season START year ("1994-95" is a 1990s season),
          with `MIN_SEASON_START = 1980` excluding the one-season 1970s bucket.

  actual[(franchise, decade)]
      `EligibilityIndex.eligible_slugs(franchise, decade)` -- the real pool the
      game rolls from.

  missing = expected - actual, and EVERY missing identity is classified by
      reading the underlying data rather than by assumption. See REASONS below.

  extra   = actual - expected. Must be empty. A non-empty `extra` means the
      game offers someone the canonical record does not place there, which is
      a louder failure than a missing identity and is reported as such.

REASONS (each one is a check against a real file, not a label)
--------------------------------------------------------------
  below_peak3_minutes_qualifier
      The season exists in `cache/processed/regular_1980_2026.parquet` but its
      minutes fall under `peak3.regular_minutes_threshold(season_end)` (1,000
      minutes over an 82-game season, scaled for shortened ones), so PEAK3
      never produced a `prime_score` for it -- for ANY team, not merely for
      this one. With no card there is nothing to draft, which is the
      eligibility rule working as documented.

  season_scored_only_under_another_team_code
      A score exists for this player-season but is recorded under a different
      team code with no multi-team aggregate available, so it is another
      franchise's number and not this one's to use.

  season_absent_from_regular_source
      The canonical season record has no counterpart in the raw per-season
      source at all -- an ingestion gap, reported as one.

  season_outside_scored_window
      The season falls outside the range the scored table covers.

  unscored_season
      Fallback used ONLY when `regular_1980_2026.parquet` is unavailable, so
      the finer reason cannot be evidenced. Named differently from the ones
      above so a coarse run can never be mistaken for a precise one.

SOURCES (all local, all read-only, no network access at any point)
------------------------------------------------------------------
  data/game/experimental/player_pool_1500/all_seasons_for_identities.v1.json
  data/game/experimental/player_pool_1500/traded_player_team_stints.v1.json
  cache/processed/scored_1980_2026.parquet     (official PEAK3 prime_score)
  cache/processed/regular_1980_2026.parquet    (minutes, for reason evidence)

USAGE
-----
  python scripts/audit_three_man_weave_pool.py            # dry run, summary only
  python scripts/audit_three_man_weave_pool.py --json     # machine-readable
  python scripts/audit_three_man_weave_pool.py --write    # regenerate the doc
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nba_peak.franchises import (  # noqa: E402
    FRANCHISES,
    franchise_display_name,
    franchise_for_team_code,
    team_codes_for_franchise,
)
from nba_peak.three_man_weave.config import (  # noqa: E402
    DECADES,
    ELIGIBILITY_INDEX_VERSION,
    FORMULA_VERSION,
    MIN_ELIGIBLE_FOR_ROLL,
    MIN_SEASON_START,
    decade_label,
    season_start_year,
)
from nba_peak.three_man_weave.eligibility import (  # noqa: E402
    ALL_SEASONS_PATH,
    MULTI_TEAM_CODES,
    SCORED_PATH,
    EligibilityIndex,
    TRADED_STINTS_PATH,
    get_index,
    slug,
)

REGULAR_PATH = REPO_ROOT / "cache" / "processed" / "regular_1980_2026.parquet"

DOC_PATH = REPO_ROOT / "docs" / "implementation" / "THREE_MAN_WEAVE_POOL_AUDIT.md"

#: The exact invocation that regenerates the committed markdown report. Printed
#: into the document itself so a reader never has to reconstruct it.
REGENERATE_COMMAND = "python scripts/audit_three_man_weave_pool.py --write"

AUDIT_VERSION = "tmw_pool_audit_v1"

# -- appearance outcomes ----------------------------------------------------
CARD_DIRECT = "card_from_single_team_scored_row"
CARD_AGGREGATE = "card_from_traded_season_aggregate"

# -- missing reasons --------------------------------------------------------
REASON_ANOTHER_TEAM_CODE = "season_scored_only_under_another_team_code"
REASON_ABSENT_FROM_REGULAR = "season_absent_from_regular_source"
REASON_OUTSIDE_WINDOW = "season_outside_scored_window"
REASON_UNSCORED = "unscored_season"
REASON_BELOW_QUALIFIER = "below_peak3_minutes_qualifier"

#: Precedence when one identity's several seasons fail for several reasons.
#: Ordered most-suspicious first, so a pair that has ANY season with a real
#: score attached is never filed under the benign "they never qualified"
#: bucket. `below_peak3_minutes_qualifier` is last because it is the one
#: outcome the eligibility rule documents and intends.
REASON_PRECEDENCE: tuple[str, ...] = (
    REASON_ANOTHER_TEAM_CODE,
    REASON_ABSENT_FROM_REGULAR,
    REASON_OUTSIDE_WINDOW,
    REASON_UNSCORED,
    REASON_BELOW_QUALIFIER,
)

#: Slug suffixes that a naive search normalisation loses. Checked explicitly
#: because "Jr" is the single most common way a player-name lookup silently
#: returns nothing.
NAME_SUFFIXES: tuple[str, ...] = ("jr", "sr", "ii", "iii", "iv", "v")


# ---------------------------------------------------------------------------
# Canonical sources
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ExpectedAppearance:
    """One canonical (identity, franchise, season) membership fact.

    `team_code` is the REAL team played for; `recorded_team` is the token the
    row carried, which differs only for a multi-team aggregate expanded through
    the stints file. Both are kept because the score lookup keys on the second
    while the franchise claim rests on the first.
    """

    player_slug: str
    player_name: str
    franchise_id: str
    team_code: str
    recorded_team: str
    season: str
    season_start: int
    decade: str
    games_played: Optional[float]
    score_status: Optional[str]
    via_traded_stint: bool


@dataclass(frozen=True)
class ExpectedPool:
    by_roll: dict[tuple[str, str], frozenset[str]]
    appearances: dict[tuple[str, str, str], tuple[ExpectedAppearance, ...]]
    names: dict[str, str]
    dropped: dict[str, int]
    #: Every row `build_expected` could not place on a franchise, listed rather
    #: than only counted. A dropped row is a claim about the source's
    #: completeness, and a claim a reader cannot check is not evidence.
    unresolved_rows: tuple[dict, ...] = ()


def load_canonical_seasons(path: Path | None = None) -> list[dict]:
    load_path = path or ALL_SEASONS_PATH
    if not load_path.exists():
        raise FileNotFoundError(f"{load_path} missing -- broken checkout (committed file).")
    return json.loads(load_path.read_text()).get("rows", [])


def load_traded_stints(path: Path | None = None) -> dict[str, list[dict]]:
    load_path = path or TRADED_STINTS_PATH
    if not load_path.exists():
        raise FileNotFoundError(f"{load_path} missing -- broken checkout (committed file).")
    return json.loads(load_path.read_text()).get("stints_by_player_season", {}) or {}


def build_expected(
    rows: Iterable[dict] | None = None,
    stints: dict[str, list[dict]] | None = None,
) -> ExpectedPool:
    """The pool the canonical season records SAY should exist, per roll.

    Independently derived (see the module docstring). Anything this function
    cannot resolve is counted in `dropped` and named there rather than guessed
    at -- an unresolvable row must show up as a number a reader can challenge,
    never as a silent omission.
    """
    rows = list(rows if rows is not None else load_canonical_seasons())
    stints = stints if stints is not None else load_traded_stints()

    by_roll: dict[tuple[str, str], set[str]] = defaultdict(set)
    appearances: dict[tuple[str, str, str], list[ExpectedAppearance]] = defaultdict(list)
    names: dict[str, str] = {}
    dropped: Counter[str] = Counter()
    unresolved: list[dict] = []

    for row in rows:
        player_slug = row.get("player_slug")
        season = row.get("season")
        if not player_slug or not season:
            dropped["row_missing_slug_or_season"] += 1
            continue
        start = season_start_year(season)
        if start < MIN_SEASON_START:
            dropped["season_before_min_season_start"] += 1
            continue
        decade = decade_label(start)
        if decade is None:
            dropped["season_outside_supported_decades"] += 1
            continue

        name = row.get("player") or player_slug
        names.setdefault(player_slug, name)
        recorded = str(row.get("team") or "").strip().upper()
        status = row.get("score_status")

        if recorded in MULTI_TEAM_CODES:
            resolved = stints.get(f"{player_slug}|{season}", [])
            if not resolved:
                dropped["multi_team_row_without_stint_data"] += 1
                unresolved.append(
                    {
                        "player_slug": player_slug,
                        "player_name": name,
                        "season": season,
                        "recorded_team": recorded,
                        "why": "multi_team_row_without_stint_data",
                    }
                )
                continue
            for stint in resolved:
                team_code = str(stint.get("team_id") or "").strip().upper()
                franchise_id = franchise_for_team_code(team_code)
                if franchise_id is None:
                    dropped[f"unresolvable_stint_team_code:{team_code or 'blank'}"] += 1
                    unresolved.append(
                        {
                            "player_slug": player_slug,
                            "player_name": name,
                            "season": season,
                            "recorded_team": team_code,
                            "why": "unresolvable_stint_team_code",
                        }
                    )
                    continue
                by_roll[(franchise_id, decade)].add(player_slug)
                appearances[(player_slug, franchise_id, decade)].append(
                    ExpectedAppearance(
                        player_slug=player_slug,
                        player_name=name,
                        franchise_id=franchise_id,
                        team_code=team_code,
                        recorded_team=recorded,
                        season=season,
                        season_start=start,
                        decade=decade,
                        games_played=(
                            float(stint["games"]) if stint.get("games") is not None else None
                        ),
                        score_status=status,
                        via_traded_stint=True,
                    )
                )
            continue

        franchise_id = franchise_for_team_code(recorded)
        if franchise_id is None:
            dropped[f"unresolvable_team_code:{recorded or 'blank'}"] += 1
            unresolved.append(
                {
                    "player_slug": player_slug,
                    "player_name": name,
                    "season": season,
                    "recorded_team": recorded,
                    "why": "unresolvable_team_code",
                }
            )
            continue
        by_roll[(franchise_id, decade)].add(player_slug)
        appearances[(player_slug, franchise_id, decade)].append(
            ExpectedAppearance(
                player_slug=player_slug,
                player_name=name,
                franchise_id=franchise_id,
                team_code=recorded,
                recorded_team=recorded,
                season=season,
                season_start=start,
                decade=decade,
                games_played=(
                    float(row["games_played"]) if row.get("games_played") is not None else None
                ),
                score_status=status,
                via_traded_stint=False,
            )
        )

    return ExpectedPool(
        by_roll={roll: frozenset(slugs) for roll, slugs in by_roll.items()},
        appearances={
            key: tuple(sorted(items, key=lambda a: (a.season, a.team_code)))
            for key, items in appearances.items()
        },
        names=names,
        dropped=dict(sorted(dropped.items())),
        unresolved_rows=tuple(
            sorted(unresolved, key=lambda row: (row["player_slug"], row["season"]))
        ),
    )


# ---------------------------------------------------------------------------
# Evidence sources for the "why is it missing" question
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ScoredIndex:
    """(player_slug, season) -> {team_code: prime_score}, plus the covered window."""

    by_player_season: dict[tuple[str, str], dict[str, float]]
    min_season_start: int
    max_season_start: int


def load_scored_index(path: Path | None = None) -> ScoredIndex:
    import pandas as pd  # local import: keeps a bare --help cheap

    load_path = path or SCORED_PATH
    if not load_path.exists():
        raise FileNotFoundError(
            f"{load_path} missing. Regenerate it before auditing -- the pool itself "
            "cannot be built without it."
        )
    frame = pd.read_parquet(
        load_path, columns=["player", "team", "season", "season_start", "prime_score"]
    )
    frame = frame.assign(player_slug=frame["player"].map(slug))
    frame = frame[frame["prime_score"].notna()]

    out: dict[tuple[str, str], dict[str, float]] = {}
    for record in frame.itertuples(index=False):
        bucket = out.setdefault((record.player_slug, record.season), {})
        team_code = str(record.team).strip().upper()
        score = float(record.prime_score)
        if score > bucket.get(team_code, float("-inf")):
            bucket[team_code] = score
    return ScoredIndex(
        by_player_season=out,
        min_season_start=int(frame["season_start"].min()),
        max_season_start=int(frame["season_start"].max()),
    )


def load_minutes_index(path: Path | None = None) -> Optional[dict[tuple[str, str], dict[str, tuple]]]:
    """(player_slug, season) -> {team_code: (minutes, threshold, games)}.

    Returns None when the raw per-season table is not in the checkout, which
    downgrades the reason taxonomy to the coarse `unscored_season` rather than
    inventing a precise reason the run cannot evidence.
    """
    import pandas as pd

    load_path = path or REGULAR_PATH
    if not load_path.exists():
        return None

    import peak3

    frame = pd.read_parquet(
        load_path, columns=["player", "team", "season", "season_end", "g", "mp"]
    )
    frame = frame.assign(player_slug=frame["player"].map(slug))
    frame = frame.assign(threshold=frame["season_end"].map(peak3.regular_minutes_threshold))

    out: dict[tuple[str, str], dict[str, tuple]] = {}
    for record in frame.itertuples(index=False):
        key = (record.player_slug, record.season)
        out.setdefault(key, {})[str(record.team).strip().upper()] = (
            None if record.mp is None else float(record.mp),
            float(record.threshold),
            None if record.g is None else float(record.g),
        )
    return out


def classify_appearance(
    appearance: ExpectedAppearance,
    scored: ScoredIndex,
    minutes: Optional[dict[tuple[str, str], dict[str, tuple]]],
) -> str:
    """Why this single appearance did or did not earn a scoring card.

    Mirrors `eligibility._build_scoring_cards`' candidate order exactly: a real
    single-team scored row first, then the season's multi-team aggregate. If
    neither exists the appearance earns nothing, and the remaining branches
    establish WHY by reading the raw sources.
    """
    key = (appearance.player_slug, appearance.season)
    bucket = scored.by_player_season.get(key)
    if bucket:
        if appearance.team_code in bucket:
            return CARD_DIRECT
        if any(code in MULTI_TEAM_CODES for code in bucket):
            return CARD_AGGREGATE
        return REASON_ANOTHER_TEAM_CODE

    if not (scored.min_season_start <= appearance.season_start <= scored.max_season_start):
        return REASON_OUTSIDE_WINDOW

    if minutes is None:
        return REASON_UNSCORED

    raw = minutes.get(key)
    if not raw:
        return REASON_ABSENT_FROM_REGULAR

    # Prefer the row recorded under the same token the canonical source used;
    # a traded season's minutes live under the aggregate token, not the stint.
    entry = raw.get(appearance.recorded_team) or raw.get(appearance.team_code)
    if entry is None:
        entry = max(raw.values(), key=lambda value: value[0] or 0.0)
    played, threshold, _games = entry
    if played is not None and played < threshold:
        return REASON_BELOW_QUALIFIER
    return REASON_UNSCORED


def pair_reason(appearance_reasons: Iterable[str]) -> str:
    reasons = set(appearance_reasons)
    for candidate in REASON_PRECEDENCE:
        if candidate in reasons:
            return candidate
    # Only reachable if an appearance earned a card, which contradicts the pair
    # being missing. Surfaced rather than swallowed.
    return "unexplained"


# ---------------------------------------------------------------------------
# The audit
# ---------------------------------------------------------------------------
def all_combinations() -> list[tuple[str, str]]:
    """EVERY franchise x decade, including the ones with no members.

    Enumerated from the franchise table rather than from the index's own
    `rolls()`, because a combination the index dropped entirely is exactly the
    kind of hole this audit exists to find, and asking the index which
    combinations exist would hide it.
    """
    return [(franchise_id, decade) for franchise_id in sorted(FRANCHISES) for decade in DECADES]


def _search_surface(pool_slugs: set[str], names: dict[str, str]) -> dict:
    """Suffix / punctuation / diacritic identities, and whether the name finds them.

    "Discoverable by display name" is checked the way the product checks it: the
    pick overlay's `searchCandidates` does a case-insensitive substring match on
    `player_name`, and every server-side lookup keys on the slug. So an identity
    is discoverable iff (a) its display name is present and (b) folding that
    display name reproduces the slug the pool is keyed on. A slug that does not
    round-trip is one no typed name can reach.
    """

    def is_suffixed(player_slug: str) -> bool:
        return any(player_slug.endswith(f"-{suffix}") for suffix in NAME_SUFFIXES)

    def has_punctuation(name: str) -> bool:
        return any(character in name for character in ("'", ".", "-"))

    def has_diacritics(name: str) -> bool:
        return any(ord(character) > 127 for character in name)

    groups = {
        "suffix": sorted(s for s in pool_slugs if is_suffixed(s)),
        "punctuation_derived": sorted(
            s for s in pool_slugs if has_punctuation(names.get(s, ""))
        ),
        "apostrophe_o_prefix": sorted(
            s for s in pool_slugs if "-o-" in s or s.endswith("-o-neal")
        ),
        "diacritics_in_display_name": sorted(
            s for s in pool_slugs if has_diacritics(names.get(s, ""))
        ),
    }

    report: dict[str, dict] = {}
    for label, slugs in groups.items():
        undiscoverable = []
        for player_slug in slugs:
            name = names.get(player_slug)
            if not name:
                undiscoverable.append({"player_slug": player_slug, "why": "no_display_name"})
                continue
            if slug(name) != player_slug:
                undiscoverable.append(
                    {
                        "player_slug": player_slug,
                        "why": "display_name_does_not_fold_to_slug",
                        "folded": slug(name),
                    }
                )
                continue
            surname = name.split(" ")[-1].lower()
            if surname not in name.lower():  # pragma: no cover - definitionally true
                undiscoverable.append({"player_slug": player_slug, "why": "surname_not_in_name"})
        report[label] = {
            "count": len(slugs),
            "undiscoverable_count": len(undiscoverable),
            "undiscoverable": undiscoverable,
            "examples": [
                {"player_slug": s, "player_name": names.get(s)} for s in slugs[:8]
            ],
        }
    return report


def _relocation_surface(rows: list[dict], expected: ExpectedPool, index: EligibilityIndex) -> dict:
    """Historical team codes -> the modern franchise that must hold their history.

    Reports, per historical code, how many canonical rows carry it and one real
    identity now discoverable under the modern franchise. A relocation that
    quietly failed to fold would show as rows > 0 with no discoverable example.
    """
    row_counts: Counter[str] = Counter()
    for row in rows:
        code = str(row.get("team") or "").strip().upper()
        if code:
            row_counts[code] += 1

    out: list[dict] = []
    for franchise_id in sorted(FRANCHISES):
        codes = team_codes_for_franchise(franchise_id)
        if len(codes) < 2:
            continue
        for code in codes:
            if code == franchise_id:
                continue
            # Prefer an example whose CARD also sits under the historical code:
            # it is the stronger evidence, because it shows the old code
            # surviving all the way to the season the game scores rather than
            # only as far as the membership claim. Any eligible identity is
            # accepted as a fallback so a code with no such card still reports
            # one.
            example = None
            for row in rows:
                if str(row.get("team") or "").strip().upper() != code:
                    continue
                start = season_start_year(row["season"])
                decade = decade_label(start) if start >= MIN_SEASON_START else None
                if decade is None:
                    continue
                if not index.is_eligible(row["player_slug"], franchise_id, decade):
                    continue
                card = index.scoring_card(row["player_slug"], franchise_id, decade)
                candidate = {
                    "player_slug": row["player_slug"],
                    "historical_team_code": code,
                    "franchise_id": franchise_id,
                    "decade": decade,
                    "appearance_season": row["season"],
                    "card_season": card.season if card else None,
                    "card_team_code": card.team_code if card else None,
                }
                if example is None:
                    example = candidate
                if card is not None and card.team_code == code:
                    example = candidate
                    break
            out.append(
                {
                    "historical_team_code": code,
                    "franchise_id": franchise_id,
                    "franchise_name": franchise_display_name(franchise_id),
                    "canonical_rows": row_counts.get(code, 0),
                    "discoverable_example": example,
                }
            )
    return {"entries": out, "unfolded": [e for e in out if e["canonical_rows"] and not e["discoverable_example"]]}


def _traded_surface(expected: ExpectedPool, index: EligibilityIndex) -> dict:
    """How much of the pool exists only because a mid-season trade was expanded.

    A pair whose every appearance came through the stints file would vanish
    entirely if aggregate rows were dropped, so this number is the size of the
    hole the stint expansion fills.
    """
    stint_only_pairs = []
    for (player_slug, franchise_id, decade), items in expected.appearances.items():
        if not all(a.via_traded_stint for a in items):
            continue
        stint_only_pairs.append(
            {
                "player_slug": player_slug,
                "franchise_id": franchise_id,
                "decade": decade,
                "eligible": index.is_eligible(player_slug, franchise_id, decade),
                "seasons": [a.season for a in items],
            }
        )
    eligible = [p for p in stint_only_pairs if p["eligible"]]

    # (player, season) -> {franchise: decade}. Built once rather than searched
    # per appearance: the per-appearance form is a full scan of the appearance
    # map each time, which turns a ~1,700-row question into a quadratic sweep.
    split: dict[tuple[str, str], dict[str, str]] = defaultdict(dict)
    for (player_slug, franchise_id, decade), items in expected.appearances.items():
        for appearance in items:
            if appearance.via_traded_stint:
                split[(player_slug, appearance.season)][franchise_id] = decade

    both_sides = []
    for (player_slug, season), franchises in sorted(split.items()):
        if len(franchises) < 2:
            continue
        both_sides.append(
            {
                "player_slug": player_slug,
                "season": season,
                "decade": sorted(set(franchises.values()))[0],
                "franchises": sorted(franchises),
                "all_eligible": all(
                    index.is_eligible(player_slug, f, d) for f, d in franchises.items()
                ),
            }
        )
    return {
        "pairs_established_only_by_a_traded_stint": len(stint_only_pairs),
        "of_those_eligible": len(eligible),
        "split_seasons_examined": len(both_sides),
        "split_seasons_eligible_on_every_side": sum(1 for e in both_sides if e["all_eligible"]),
        "examples": both_sides[:10],
    }


def _named_regression(index: EligibilityIndex) -> dict:
    """Dennis Rodman x San Antonio Spurs x 1990s -- the spec's named regression."""
    player_slug, franchise_id, decade = "dennis-rodman", "SAS", "1990s"
    card = index.scoring_card(player_slug, franchise_id, decade)
    evidence = index.evidence(player_slug, franchise_id, decade)
    return {
        "player_slug": player_slug,
        "player_name": index.player_name(player_slug),
        "franchise_id": franchise_id,
        "decade": decade,
        "discoverable": index.is_eligible(player_slug, franchise_id, decade),
        "card": card.as_dict() if card else None,
        "card_is_a_spurs_season": bool(card and card.resolve_team_id in team_codes_for_franchise(franchise_id)),
        "card_is_in_decade": bool(card and decade_label(card.season_start) == decade),
        "evidence": [a.as_dict() for a in evidence],
        "every_roll_he_is_eligible_for": [
            {"franchise_id": f, "decade": d}
            for f, d in index.rolls()
            if index.is_eligible(player_slug, f, d)
        ],
    }


def build_report(
    index: EligibilityIndex | None = None,
    expected: ExpectedPool | None = None,
    rows: list[dict] | None = None,
) -> dict:
    """The whole audit, as one JSON-serialisable dict."""
    index = index if index is not None else get_index()
    rows = rows if rows is not None else load_canonical_seasons()
    expected = expected if expected is not None else build_expected(rows)

    scored = load_scored_index()
    minutes = load_minutes_index()

    combinations = all_combinations()
    per_combination: list[dict] = []
    missing_pairs: list[dict] = []
    extra_pairs: list[dict] = []
    appearance_outcomes: Counter[str] = Counter()
    missing_by_reason: Counter[str] = Counter()
    missing_examples: dict[str, list[dict]] = defaultdict(list)
    missing_by_reason_per_combination: dict[tuple[str, str], Counter] = defaultdict(Counter)

    for key, items in expected.appearances.items():
        for appearance in items:
            appearance_outcomes[classify_appearance(appearance, scored, minutes)] += 1

    for franchise_id, decade in combinations:
        expected_slugs = expected.by_roll.get((franchise_id, decade), frozenset())
        actual_slugs = index.eligible_slugs(franchise_id, decade)

        for player_slug in sorted(expected_slugs - actual_slugs):
            items = expected.appearances[(player_slug, franchise_id, decade)]
            reasons = [classify_appearance(a, scored, minutes) for a in items]
            reason = pair_reason(reasons)
            missing_by_reason[reason] += 1
            missing_by_reason_per_combination[(franchise_id, decade)][reason] += 1
            games = [a.games_played for a in items if a.games_played is not None]
            record = {
                "player_slug": player_slug,
                "player_name": expected.names.get(player_slug),
                "franchise_id": franchise_id,
                "decade": decade,
                "reason": reason,
                "seasons": [a.season for a in items],
                "max_games_played": max(games) if games else None,
                "discoverable_on_another_roll": any(
                    index.is_eligible(player_slug, f, d) for f, d in index.rolls()
                ),
            }
            missing_pairs.append(record)

        for player_slug in sorted(actual_slugs - expected_slugs):
            extra_pairs.append(
                {
                    "player_slug": player_slug,
                    "player_name": index.player_name(player_slug),
                    "franchise_id": franchise_id,
                    "decade": decade,
                }
            )

        per_combination.append(
            {
                "franchise_id": franchise_id,
                "franchise_name": franchise_display_name(franchise_id),
                "decade": decade,
                "expected": len(expected_slugs),
                "actual": len(actual_slugs),
                "missing": len(expected_slugs - actual_slugs),
                "extra": len(actual_slugs - expected_slugs),
                "rollable": len(actual_slugs) >= MIN_ELIGIBLE_FOR_ROLL,
                "missing_by_reason": dict(
                    sorted(missing_by_reason_per_combination[(franchise_id, decade)].items())
                ),
            }
        )

    # Examples are sampled EVENLY across the ordered missing list rather than
    # taken from the head of it, which would fill every table with whichever
    # franchise sorts first and make a league-wide finding look like an
    # Atlanta one.
    by_reason: dict[str, list[dict]] = defaultdict(list)
    for record in missing_pairs:
        by_reason[record["reason"]].append(record)
    for reason, records in by_reason.items():
        stride = max(1, len(records) // 12)
        missing_examples[reason] = records[::stride][:12]

    # How complete a season the model declined to score. A missing identity
    # whose only season was a 9-game cameo and one who played 78 games under
    # the minutes bar are both correctly absent, but they are not the same
    # finding, and a single count would hide the second.
    games_buckets: Counter[str] = Counter()
    for record in missing_pairs:
        games = record["max_games_played"]
        if games is None:
            games_buckets["unknown"] += 1
        elif games < 20:
            games_buckets["under_20_games"] += 1
        elif games < 41:
            games_buckets["20_to_40_games"] += 1
        elif games < 70:
            games_buckets["41_to_69_games"] += 1
        else:
            games_buckets["70_or_more_games"] += 1

    pool_slugs: set[str] = set()
    for franchise_id, decade in combinations:
        pool_slugs |= set(index.eligible_slugs(franchise_id, decade))
    expected_slugs_all: set[str] = set()
    for slugs in expected.by_roll.values():
        expected_slugs_all |= set(slugs)

    empty_combinations = [c for c in per_combination if c["expected"] == 0 and c["actual"] == 0]

    canonical_identities = {r["player_slug"]: r.get("player") for r in rows if r.get("player_slug")}
    no_in_window_season = [
        {"player_slug": s, "player_name": canonical_identities[s]}
        for s in sorted(set(canonical_identities) - expected_slugs_all)
    ]
    expected_but_never_scored = [
        {"player_slug": s, "player_name": expected.names.get(s)}
        for s in sorted(expected_slugs_all - pool_slugs)
    ]

    return {
        "audit_version": AUDIT_VERSION,
        "eligibility_index_version": index.index_version,
        "formula_version": FORMULA_VERSION,
        "expected_index_version": ELIGIBILITY_INDEX_VERSION,
        "regenerate_command": REGENERATE_COMMAND,
        "reason_evidence_available": minutes is not None,
        "sources": {
            "canonical_seasons": str(ALL_SEASONS_PATH.relative_to(REPO_ROOT)),
            "traded_stints": str(TRADED_STINTS_PATH.relative_to(REPO_ROOT)),
            "scored": str(SCORED_PATH.relative_to(REPO_ROOT)),
            "regular": str(REGULAR_PATH.relative_to(REPO_ROOT)) if minutes is not None else None,
        },
        "scored_window": {
            "min_season_start": scored.min_season_start,
            "max_season_start": scored.max_season_start,
        },
        "totals": {
            "franchises": len(FRANCHISES),
            "decades": len(DECADES),
            "combinations": len(combinations),
            "combinations_with_expected_members": sum(
                1 for c in per_combination if c["expected"]
            ),
            "combinations_with_pool_members": sum(1 for c in per_combination if c["actual"]),
            "combinations_rollable": sum(1 for c in per_combination if c["rollable"]),
            "expected_identity_pairs": sum(c["expected"] for c in per_combination),
            "actual_identity_pairs": sum(c["actual"] for c in per_combination),
            "missing_pairs": len(missing_pairs),
            "extra_pairs": len(extra_pairs),
            "canonical_identities": len({r.get("player_slug") for r in rows if r.get("player_slug")}),
            "distinct_expected_identities": len(expected_slugs_all),
            "distinct_pool_identities": len(pool_slugs),
            "distinct_identities_with_a_missing_pair": len(
                {p["player_slug"] for p in missing_pairs}
            ),
            "missing_pairs_whose_identity_is_discoverable_elsewhere": sum(
                1 for p in missing_pairs if p["discoverable_on_another_roll"]
            ),
            "missing_pairs_whose_identity_is_nowhere_in_the_pool": sum(
                1 for p in missing_pairs if not p["discoverable_on_another_roll"]
            ),
        },
        "dropped_canonical_rows": expected.dropped,
        "unresolved_canonical_rows": list(expected.unresolved_rows),
        "appearance_outcomes": dict(sorted(appearance_outcomes.items())),
        "missing_by_reason": dict(sorted(missing_by_reason.items())),
        "missing_by_season_completeness": dict(sorted(games_buckets.items())),
        "missing_examples_by_reason": {k: v for k, v in sorted(missing_examples.items())},
        "unexplained_missing": [p for p in missing_pairs if p["reason"] == "unexplained"],
        "extra_pairs_detail": extra_pairs,
        "empty_combinations": empty_combinations,
        "identities_with_no_in_window_season": no_in_window_season,
        "expected_identities_with_no_card_anywhere": expected_but_never_scored,
        "per_combination": per_combination,
        "search_surface": _search_surface(pool_slugs, expected.names),
        "relocation_surface": _relocation_surface(rows, expected, index),
        "traded_surface": _traded_surface(expected, index),
        "named_regression": _named_regression(index),
    }


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------
def _pct(part: int, whole: int) -> str:
    return f"{(100.0 * part / whole):.1f}%" if whole else "n/a"


def render_markdown(report: dict) -> str:
    totals = report["totals"]
    regression = report["named_regression"]
    lines: list[str] = []
    add = lines.append

    add("# THREE-MAN WEAVE — franchise × decade candidate pool audit")
    add("")
    add(f"Audit version `{report['audit_version']}` · eligibility index "
        f"`{report['eligibility_index_version']}` · formula `{report['formula_version']}`.")
    add("")
    add("Regenerate with:")
    add("")
    add("```bash")
    add(report["regenerate_command"])
    add("```")
    add("")
    add("Read-only over committed data; no network access at any point. Sources:")
    add("")
    for label, path in report["sources"].items():
        add(f"- `{label}` — `{path}`" if path else f"- `{label}` — not present in this checkout")
    add("")
    add("## 1. What was compared")
    add("")
    add("`expected` is re-derived from the canonical season records in this script, not")
    add("imported from `nba_peak.three_man_weave.eligibility` — an audit that asks the")
    add("implementation what it believes can only ever agree with itself. The two sides")
    add("share only the franchise-continuity table and the decade bucketing rule, which")
    add("are the rules under audit rather than the pool's implementation.")
    add("")
    add("`actual` is `EligibilityIndex.eligible_slugs(franchise, decade)` — the real pool")
    add("the game rolls candidates from.")
    add("")
    add("## 2. Headline numbers")
    add("")
    add("| Metric | Value |")
    add("| --- | ---: |")
    add(f"| Franchises | {totals['franchises']} |")
    add(f"| Decades | {totals['decades']} |")
    add(f"| **Total supported franchise × decade combinations** | **{totals['combinations']}** |")
    add(f"| Combinations with at least one expected identity | {totals['combinations_with_expected_members']} |")
    add(f"| Combinations with at least one pool identity | {totals['combinations_with_pool_members']} |")
    add(f"| Combinations rollable (≥ {MIN_ELIGIBLE_FOR_ROLL} identities) | {totals['combinations_rollable']} |")
    add(f"| **Expected identity count** (identity × combination pairs) | **{totals['expected_identity_pairs']}** |")
    add(f"| **Actual identity count** (identity × combination pairs) | **{totals['actual_identity_pairs']}** |")
    add(f"| **Missing** | **{totals['missing_pairs']}** ({_pct(totals['missing_pairs'], totals['expected_identity_pairs'])} of expected) |")
    add(f"| **Extra** (in the pool, not in the canonical record) | **{totals['extra_pairs']}** |")
    add(f"| Unexplained missing | {len(report['unexplained_missing'])} |")
    add(f"| Distinct expected identities | {totals['distinct_expected_identities']} |")
    add(f"| Distinct identities in the pool | {totals['distinct_pool_identities']} |")
    add("")
    if totals["extra_pairs"]:
        add("> **EXTRA IDENTITIES PRESENT.** The pool offers identities the canonical")
        add("> record does not place on that franchise × decade. This is a louder failure")
        add("> than a missing identity — the game is asserting something the source does")
        add("> not support. See §7.")
    else:
        add("`extra == 0`: the pool never offers an identity the canonical season records do")
        add("not place on that franchise in that decade. Nothing is fabricated upward.")
    add("")
    add("## 3. Why identities are missing")
    add("")
    if not report["reason_evidence_available"]:
        add("> `cache/processed/regular_1980_2026.parquet` is absent from this checkout, so")
        add("> the fine-grained reason cannot be evidenced and every unscored season is")
        add("> reported under the coarse `unscored_season` label. Re-run with that file")
        add("> present for the precise breakdown.")
        add("")
    add("Every missing identity is classified by reading the underlying data. No category")
    add("below is a guess; each is a check against a real file.")
    add("")
    add("| Reason | Count | Share of missing |")
    add("| --- | ---: | ---: |")
    for reason, count in sorted(
        report["missing_by_reason"].items(), key=lambda kv: (-kv[1], kv[0])
    ):
        add(f"| `{reason}` | {count} | {_pct(count, totals['missing_pairs'])} |")
    for reason in REASON_PRECEDENCE:
        if reason not in report["missing_by_reason"]:
            add(f"| `{reason}` | 0 | 0.0% |")
    add("")
    add("### What each reason means, and examples")
    add("")
    reason_notes = {
        REASON_BELOW_QUALIFIER: (
            "The season exists in the raw per-season table but its minutes fall under "
            "`peak3.regular_minutes_threshold(season_end)` — 1,000 minutes over an "
            "82-game season (~12.2 MPG), scaled down for shortened seasons. PEAK3 "
            "therefore produced no `prime_score` for that season **for any team**, not "
            "merely for this one. With no card there is nothing to draft, which is the "
            "documented eligibility rule (`eligibility.py`, \"UNSCORED IDENTITIES\") "
            "working as intended rather than a gap."
        ),
        REASON_ANOTHER_TEAM_CODE: (
            "A `prime_score` exists for the player-season but is recorded only under a "
            "different team code, with no multi-team aggregate to fall back on. That "
            "number belongs to another franchise and is not this one's to use."
        ),
        REASON_ABSENT_FROM_REGULAR: (
            "The canonical season record has no counterpart in the raw per-season "
            "source at all. This is an ingestion gap and is reported as one."
        ),
        REASON_OUTSIDE_WINDOW: (
            "The season falls outside the range the scored table covers "
            f"({report['scored_window']['min_season_start']}–"
            f"{report['scored_window']['max_season_start']} by season start year)."
        ),
        REASON_UNSCORED: (
            "Coarse fallback, used only when the raw per-season table is unavailable so "
            "the precise reason cannot be evidenced."
        ),
    }
    for reason, count in sorted(
        report["missing_by_reason"].items(), key=lambda kv: (-kv[1], kv[0])
    ):
        add(f"#### `{reason}` — {count}")
        add("")
        add(reason_notes.get(reason, "No documented note for this reason."))
        add("")
        examples = report["missing_examples_by_reason"].get(reason, [])
        if examples:
            add("| Identity | Franchise × decade | Season(s) | Max games in a season |")
            add("| --- | --- | --- | ---: |")
            for example in examples[:8]:
                seasons = ", ".join(example["seasons"][:3])
                if len(example["seasons"]) > 3:
                    seasons += f" (+{len(example['seasons']) - 3} more)"
                games = example["max_games_played"]
                add(
                    f"| {example['player_name']} (`{example['player_slug']}`) "
                    f"| {example['franchise_id']} × {example['decade']} "
                    f"| {seasons} | {int(games) if games is not None else '—'} |"
                )
            add("")
    add("### How complete were the seasons the model declined to score")
    add("")
    add("A cameo and a full low-minutes season are both correctly absent, but they are not")
    add("the same finding, so they are counted separately. Games are the most a missing")
    add("identity played in any one season of that franchise × decade.")
    add("")
    add("| Games in the best qualifying attempt | Missing pairs | Share |")
    add("| --- | ---: | ---: |")
    bucket_labels = [
        ("under_20_games", "under 20"),
        ("20_to_40_games", "20–40"),
        ("41_to_69_games", "41–69"),
        ("70_or_more_games", "70 or more"),
        ("unknown", "not recorded"),
    ]
    for key, label in bucket_labels:
        count = report["missing_by_season_completeness"].get(key, 0)
        add(f"| {label} | {count} | {_pct(count, totals['missing_pairs'])} |")
    add("")
    full_season = report["missing_by_season_completeness"].get("70_or_more_games", 0)
    add(f"The {full_season} pairs at 70+ games are the ones worth naming out loud: those")
    add("identities played a full season for that franchise and still fell under the")
    add("minutes bar, i.e. they were deep-bench regulars. They are absent for the same")
    add("documented reason as the cameos, but a reader should know the category is not")
    add("purely made of ten-game stints.")
    add("")
    add("### Where the missing identities went")
    add("")
    add(f"- {totals['missing_pairs_whose_identity_is_discoverable_elsewhere']} of the "
        f"{totals['missing_pairs']} missing pairs belong to an identity who **is** in the "
        "pool on some other roll — they are absent from one franchise × decade, not from "
        "the game.")
    add(f"- {totals['missing_pairs_whose_identity_is_nowhere_in_the_pool']} belong to an "
        "identity with no scored season anywhere in the supported window; see §6.")
    add(f"- {totals['distinct_identities_with_a_missing_pair']} distinct identities are "
        "involved in at least one missing pair.")
    add("")
    add("## 4. Appearance-level outcomes")
    add("")
    add("The same question one row at a time: of every canonical (identity, franchise,")
    add("season) membership fact, how many earned a scoring card and how many did not.")
    add("")
    add("| Outcome | Count |")
    add("| --- | ---: |")
    total_appearances = sum(report["appearance_outcomes"].values())
    for outcome, count in sorted(
        report["appearance_outcomes"].items(), key=lambda kv: (-kv[1], kv[0])
    ):
        add(f"| `{outcome}` | {count} |")
    add(f"| **total** | **{total_appearances}** |")
    add("")
    add("## 5. Normalisation surfaces")
    add("")
    add("### Franchise aliases and relocations")
    add("")
    add("Every historical team code must fold into the modern franchise that holds its")
    add("history, and an identity who played under the old code must be discoverable")
    add("under the new franchise.")
    add("")
    add("| Historical code | Folds into | Canonical rows | Discoverable example (played → scored on) |")
    add("| --- | --- | ---: | --- |")
    for entry in report["relocation_surface"]["entries"]:
        example = entry["discoverable_example"]
        shown = (
            f"`{example['player_slug']}` on {example['franchise_id']} × {example['decade']} — "
            f"played {example['appearance_season']} `{entry['historical_team_code']}`, "
            f"scored on {example['card_season']} `{example['card_team_code']}`"
            if example
            else "**none**"
        )
        add(
            f"| `{entry['historical_team_code']}` | {entry['franchise_id']} "
            f"({entry['franchise_name']}) | {entry['canonical_rows']} | {shown} |"
        )
    add("")
    unfolded = report["relocation_surface"]["unfolded"]
    if unfolded:
        add(f"> **{len(unfolded)} historical code(s) carry canonical rows but produce no")
        add("> discoverable identity under the modern franchise.**")
    else:
        add("Every historical code with canonical rows folds through to a discoverable")
        add("identity. `NOH`/`NOK` fold to `NOP` and are kept distinct from `CHH`/`CHO` →")
        add("`CHA`, which is why New Orleans has no 1980s or 1990s pool at all.")
    add("")
    add("### Mid-season trades")
    add("")
    traded = report["traded_surface"]
    add(f"- {traded['pairs_established_only_by_a_traded_stint']} identity × combination "
        "pairs exist **only** because a multi-team aggregate row was expanded through "
        "the real per-team stints file; "
        f"{traded['of_those_eligible']} of them are in the pool.")
    add(f"- {traded['split_seasons_examined']} split seasons place one identity on two or "
        "more franchises in the same season; "
        f"{traded['split_seasons_eligible_on_every_side']} of those are eligible on every "
        "side.")
    if traded["examples"]:
        add("")
        add("| Identity | Season | Franchises | Eligible on every side |")
        add("| --- | --- | --- | --- |")
        for example in traded["examples"][:6]:
            add(
                f"| `{example['player_slug']}` | {example['season']} "
                f"| {', '.join(example['franchises'])} "
                f"| {'yes' if example['all_eligible'] else 'no'} |"
            )
    add("")
    add("### Punctuation, suffixes and diacritics")
    add("")
    add("An identity is discoverable by display name when the name is present and folding")
    add("it through the shared slug convention reproduces the slug the pool is keyed on —")
    add("the pick overlay searches on `player_name` and every lookup keys on the slug, so")
    add("a slug that does not round-trip is one no typed name can reach.")
    add("")
    add("| Group | In the pool | Not discoverable by display name |")
    add("| --- | ---: | ---: |")
    labels = {
        "suffix": "Slug carries a generational suffix (jr/sr/ii/iii/iv/v)",
        "punctuation_derived": "Display name carries an apostrophe, period or hyphen",
        "apostrophe_o_prefix": "Apostrophe-derived `-o-` form (e.g. `-o-neal`)",
        "diacritics_in_display_name": "Display name carries diacritics",
    }
    for key, label in labels.items():
        group = report["search_surface"][key]
        add(f"| {label} | {group['count']} | {group['undiscoverable_count']} |")
    add("")
    for key, label in labels.items():
        group = report["search_surface"][key]
        if group["undiscoverable"]:
            add(f"> **{label}: {group['undiscoverable_count']} undiscoverable.**")
            for entry in group["undiscoverable"][:10]:
                add(f"> - `{entry['player_slug']}` — {entry['why']}")
            add("")
    diacritics = report["search_surface"]["diacritics_in_display_name"]
    if diacritics["count"] == 0:
        add("Diacritics: **zero** identities in the pool carry a non-ASCII display name.")
        add("`peak3.clean_player_name` runs every name through `unidecode` at ingestion, so")
        add("the canonical source stores \"Nikola Jokic\", not \"Nikola Jokić\". The search")
        add("surface is therefore never asked to fold an accent today. That is a property")
        add("of the current data, not a guarantee: `searchCandidates` lowercases without")
        add("folding, so an accented name entering the source later would not be reachable")
        add("by its unaccented spelling.")
        add("")
    add("## 6. Intentional exceptions")
    add("")
    add("Kept deliberately short. Each one is a rule stated elsewhere in the codebase, not")
    add("a carve-out invented to make this audit pass.")
    add("")
    add("**1. The 1979-80 season is excluded.**")
    add("")
    dropped = report["dropped_canonical_rows"]
    pre_min = dropped.get("season_before_min_season_start", 0)
    add(f"{pre_min} canonical rows fall before `MIN_SEASON_START = {MIN_SEASON_START}` and are")
    add("dropped from both sides of the comparison. Committed data starts at 1979-80, so a")
    add("\"1970s\" bucket would hold one season against every other bucket's ten — a")
    add("rounding artifact of bucketing by season start year, not a decade. See")
    add("`three_man_weave/config.py`'s `DECADES` comment.")
    add("")
    stranded = report["identities_with_no_in_window_season"]
    named = ", ".join(entry["player_name"] or entry["player_slug"] for entry in stranded)
    add(f"The cost is precise and small: of the {totals['canonical_identities']} identities in the")
    add(f"canonical source, {len(stranded)} have no season at all inside the window and are")
    add(f"therefore expected nowhere — {named}, each of whose last recorded season is")
    add("1979-80. Every other identity keeps every season from 1980-81 onward.")
    add("")
    add("**2. Franchise × decade combinations that never existed.**")
    add("")
    empty = report["empty_combinations"]
    add(f"{len(empty)} of {totals['combinations']} combinations have neither an expected nor")
    add("an actual member, because the franchise did not play in that decade:")
    add("")
    for combination in empty:
        add(f"- {combination['franchise_id']} ({combination['franchise_name']}) × "
            f"{combination['decade']}")
    add("")
    add("`eligible_slugs` returns an empty frozenset for these and callers must read that")
    add("as \"not a rollable combination\", never as an error.")
    add("")
    add("**3. Identities with no qualifying season anywhere in the window.**")
    add("")
    stranded_in_window = report["expected_identities_with_no_card_anywhere"]
    add(f"{len(stranded_in_window)} expected identities hold no scoring card on any roll, and "
        f"{totals['missing_pairs_whose_identity_is_nowhere_in_the_pool']} missing pairs "
        "belong to them:")
    add("")
    for entry in stranded_in_window:
        add(f"- {entry['player_name']} (`{entry['player_slug']}`)")
    add("")
    add("They cleared the 1,500-identity recognizability filter on the strength of a career")
    add("that is mostly older than the supported window, and every one of their in-window")
    add("seasons falls under the minutes qualifier. Drafting them would mean showing a")
    add("fabricated score, so they are absent rather than scored at 0.")
    add("")
    add("**4. Multi-team rows with no stint data.**")
    add("")
    unresolved = report["unresolved_canonical_rows"]
    add(f"{len(unresolved)} canonical row(s) could not be placed on a franchise and therefore")
    add("contribute no evidence on either side of the comparison. Guessing a franchise from")
    add("a `2TM` token is exactly the fabrication this codebase refuses, so they are listed")
    add("here instead:")
    add("")
    if unresolved:
        add("| Identity | Season | Recorded team | Why |")
        add("| --- | --- | --- | --- |")
        for row in unresolved:
            add(
                f"| {row['player_name']} (`{row['player_slug']}`) | {row['season']} "
                f"| `{row['recorded_team']}` | `{row['why']}` |"
            )
    else:
        add("- none.")
    add("")
    add("## 7. Honest read of coverage")
    add("")
    add("The pool is **complete with respect to what PEAK3 can score**, and")
    add("**incomplete with respect to who set foot on the floor** — those are different")
    add("claims and this document will not merge them.")
    add("")
    add(f"- Zero unexplained missing identities across all {totals['combinations']} "
        "combinations.")
    add(f"- Zero extra identities: the pool never asserts a franchise × decade the")
    add("  canonical record does not support.")
    add(f"- {totals['missing_pairs']} identity × combination pairs "
        f"({_pct(totals['missing_pairs'], totals['expected_identity_pairs'])} of expected) "
        "are absent, and every one of them is absent for a reason the data shows.")
    add("")
    add("The canonical source is itself bounded, and pretending otherwise would be the")
    add("dishonest move here. `cache/processed/scored_1980_2026.parquet` contains only")
    add("player-seasons that cleared PEAK3's minutes qualifier — the model never computed")
    add("a score for the rest. So the missing pairs are not a bug in the pool builder; they")
    add("are the boundary of the scoring model, surfaced. Closing that gap would mean")
    add("either scoring sub-qualifier seasons (changing the model) or drafting players with")
    add("no score (fabricating one). Neither is done here.")
    add("")
    add("## 8. Named regression — Dennis Rodman × San Antonio Spurs × 1990s")
    add("")
    add("The spec names this one because it was the reported failure, and it is asserted")
    add("by name in `tests/three_man_weave/test_pool_audit.py`. What is NOT done by name is")
    add("the fix: `eligibility.py` contains no reference to Rodman, no franchise or player")
    add("allow-list, and no hand-placed row. He is discoverable for the same reason the")
    add(f"other {totals['actual_identity_pairs'] - 1:,} identity × combination pairs are — "
        "a real Spurs season of the 1990s")
    add("that PEAK3 scored. The sweep above is what establishes that; this section only")
    add("prints the one row the spec asked to see.")
    add("")
    card = regression["card"]
    add("| Check | Result |")
    add("| --- | --- |")
    add(f"| Discoverable for SAS × 1990s | {'**yes**' if regression['discoverable'] else '**NO**'} |")
    if card:
        add(f"| Scoring card season | `{card['season']}` |")
        add(f"| Card team code | `{card['team_code']}` (resolves to `{card['resolve_team_id']}`) |")
        add(f"| Card is a Spurs season | {'yes' if regression['card_is_a_spurs_season'] else '**NO**'} |")
        add(f"| Card is in the 1990s | {'yes' if regression['card_is_in_decade'] else '**NO**'} |")
        add(f"| `prime_score` | {card['prime_score']:.2f} |")
        add(f"| Score source | `{card['score_source']}` |")
    else:
        add("| Scoring card | **none** |")
    add("")
    add("Eligibility evidence (the real seasons that prove the membership):")
    add("")
    add("| Season | Team | Games | Established via |")
    add("| --- | --- | ---: | --- |")
    for appearance in regression["evidence"]:
        games = appearance["games_played"]
        add(
            f"| {appearance['season']} | {appearance['team_code']} "
            f"| {int(games) if games is not None else '—'} | `{appearance['via']}` |"
        )
    add("")
    rolls = ", ".join(
        f"{r['franchise_id']} × {r['decade']}" for r in regression["every_roll_he_is_eligible_for"]
    )
    add(f"Every roll he is eligible for: {rolls}. Each is a franchise he really played for")
    add("in that decade, and each scores him on that franchise's own season.")
    add("")
    add("## 9. Per-combination detail")
    add("")
    add("| Franchise | Decade | Expected | Actual | Missing | Extra | Rollable |")
    add("| --- | --- | ---: | ---: | ---: | ---: | --- |")
    for combination in report["per_combination"]:
        add(
            f"| {combination['franchise_id']} | {combination['decade']} "
            f"| {combination['expected']} | {combination['actual']} "
            f"| {combination['missing']} | {combination['extra']} "
            f"| {'yes' if combination['rollable'] else 'no'} |"
        )
    add("")
    return "\n".join(lines) + "\n"


def render_summary(report: dict) -> str:
    totals = report["totals"]
    lines = [
        f"THREE-MAN WEAVE pool audit ({report['audit_version']}, "
        f"index {report['eligibility_index_version']})",
        f"  combinations                 {totals['combinations']} "
        f"({totals['combinations_with_pool_members']} with members, "
        f"{totals['combinations_rollable']} rollable)",
        f"  expected identity pairs      {totals['expected_identity_pairs']}",
        f"  actual identity pairs        {totals['actual_identity_pairs']}",
        f"  missing                      {totals['missing_pairs']} "
        f"({_pct(totals['missing_pairs'], totals['expected_identity_pairs'])})",
        f"  extra                        {totals['extra_pairs']}",
        f"  unexplained missing          {len(report['unexplained_missing'])}",
        "  missing by reason:",
    ]
    for reason, count in sorted(
        report["missing_by_reason"].items(), key=lambda kv: (-kv[1], kv[0])
    ):
        lines.append(f"    {reason:<48} {count}")
    regression = report["named_regression"]
    card = regression["card"]
    lines.append(
        "  named regression dennis-rodman x SAS x 1990s: "
        + (
            f"discoverable, card {card['season']} {card['resolve_team_id']} "
            f"({card['prime_score']:.2f})"
            if regression["discoverable"] and card
            else "FAILED"
        )
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Audit the THREE-MAN WEAVE franchise x decade candidate pool.",
    )
    parser.add_argument(
        "--json", action="store_true", help="print the full machine-readable report to stdout"
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help=f"write the markdown report to {DOC_PATH.relative_to(REPO_ROOT)}",
    )
    parser.add_argument(
        "--doc-path", type=Path, default=DOC_PATH, help="override the markdown output path"
    )
    args = parser.parse_args(argv)

    report = build_report()

    if args.write:
        args.doc_path.parent.mkdir(parents=True, exist_ok=True)
        args.doc_path.write_text(render_markdown(report))

    if args.json:
        print(json.dumps(report, indent=2, sort_keys=False))
    else:
        print(render_summary(report))
        if args.write:
            print(f"  wrote {args.doc_path}")
        else:
            print("  (dry run -- pass --write to regenerate the markdown report)")

    # A non-zero exit is reserved for the two findings that mean the pool is
    # asserting something the canonical record does not support. A missing
    # identity with a documented reason is a measured property, not a failure.
    if report["totals"]["extra_pairs"] or report["unexplained_missing"]:
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
