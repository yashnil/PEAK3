# Phase 5X — Arena Overhaul Implementation Plan

## Phase 6F (this session, 2026-07-24) — ESPN asset resolution, manual lineup simulator, result-explanation fix

Triggered by manual review of Phase 6E: no real player/team images, no
developer way to manually test elite lineups, and a real bug report --
Kevin Johnson / Stockton / Embiid / Hakeem / Shaq / Rasheed Wallace / Walter
Davis / Pau Gasol produced 66-16 with "Weakness: Rasheed Wallace", which
misidentified a fine role player as the problem when the actual issue was
lineup construction (no true wing, Embiid at SF, Stockton at SG).

- **ESPN-backed asset manifests** (`scripts/build_espn_asset_manifests.py`,
  new). Fetches ESPN's public site API live at generation time (team list +
  logos + colors for all 30 current franchises; roster + real athlete IDs +
  headshot URLs for currently-active players only) -- no image binaries are
  fetched or committed, only metadata/URLs. Historical/retired players (the
  large majority of the 250-player canonical pool) are honestly marked
  `resolution_status: "unresolved"` rather than guessed -- there is no
  reliable ESPN historical-player search endpoint, and fuzzy-matching a
  20-years-retired player by name risked silently attaching the wrong
  athlete ID. Ambiguous name collisions are marked `"ambiguous"`, never
  auto-resolved. Output (v2, superseding Phase 6E's placeholder v1):
  `data/game/assets/team_assets.v2.json` (30/40 teams resolved),
  `player_assets.v2.json` (56/250 players resolved, 194 unresolved, 0
  ambiguous), `asset_sources.v1.json` (provenance registry -- endpoint,
  fetch timestamp, license caveat), `unresolved_player_assets.v1.json`.
  Every resolved entry carries `license_status: "unknown_do_not_cache"`
  pending explicit human legal review -- resolution is not the same as
  clearance to display.
- **Image wiring, behind a flag** (`PEAK3_ENABLE_EXTERNAL_ASSET_URLS`,
  default `False`, `apps/api/app/core/config.py`). When on,
  `nba_peak/perfect_season/assets.py` (new, pure read-only lookup, no
  FastAPI dependency) joins `headshot_url`/`team_logo_url` into
  `SpinCandidate`, `PendingSelectionPublic`, `CourtSlotPublic`, and
  `CurrentSpinPublic`, and `/api/v1/peaks` rows. Frontend: `PlayerAvatar`
  (existing `imageUrl` prop from Phase 6E) now actually receives real URLs
  in `EligiblePlayerSearch.tsx`/`PeakCardCourt.tsx`; `SpinStage.tsx` renders
  the real team logo with `onError` fallback to the existing colored-
  initials badge. Off by default -- no behavior change for existing
  deployments until the flag is explicitly enabled.
- **Manual lineup simulator** (`scripts/simulate_peak_season_lineup.py`,
  new dev CLI). Takes either `--slot SLOT:player_slug:season:team`
  arguments or `--input <json>`, resolves exact `PlayerSeasonCard`s via
  `nba_peak.perfect_season.exact_season.resolve_player_season_card` (never
  career-peak substitution), and calls the same
  `nba_peak.perfect_season.simulation.simulate_exact_season` the API uses
  -- no duplicated scoring logic. Hard-fails on unresolvable/mismatched/
  unscored cards unless `--allow-unscored`. `--json` for machine-readable
  output. Two example fixtures added under `examples/perfect_lineups/`:
  `all_time_exact_season_ceiling.json` (Curry '15-16, Jordan '90-91, LeBron
  '12-13 MIA, Garnett '03-04, Jokic '22-23, bench Shaq '99-00/Durant
  '13-14/Duncan '02-03) and `giant_heavy_position_broken.json` (the exact
  bug-report lineup above).
- **Result-explanation fix** (`nba_peak/perfect_season/simulation.py`, new
  `_best_pick_exact`/`_structural_weakness_exact`). The old client-side
  `bestAndWorstPick()` in `SeasonResultStub.tsx` named "weakness" as
  whichever placed card had the lowest raw score, with zero regard for
  position -- the direct cause of the Rasheed Wallace misdiagnosis. The new
  server-computed `structural_weakness` is priority-ordered: (1) missing
  scores, (2) named off-position starter(s) with slot + real position
  (`"LeBron James at SF, real position PF"`), (3) no true wing / no
  interior anchor, (4) thin bench, (5) lowest-scored card only as a last
  resort when the lineup has no structural issue at all. Verified: the
  bug-report lineup now reports `"Position-broken starting five -- John
  Stockton at SG, Joel Embiid at SF, Hakeem Olajuwon at PF"` and never
  mentions Rasheed Wallace. `SimulationResult`/`SimulationResultPublic`
  gained `best_pick`/`structural_weakness` fields (`None` for legacy
  peak-window boards, which don't compute them); `SeasonResultStub.tsx`
  prefers the server fields, falling back to the old client heuristic only
  when they're null.
- **Simulator ceiling calibration verified, not changed**. The all-time
  ceiling fixture already reaches 82-0 / expected_wins 82.0 (range
  77.0-82.0) / Lineup Score 93.2 with the existing (unmodified) win
  formula -- no special-casing was needed to hit the 78-minimum/80-82-
  preferred target. The giant-heavy fixture lands at 74 wins (positional_
  fit 52.0) via the existing off-position penalty -- strong but correctly
  not forced to 82, confirming the penalty mechanism generalizes rather
  than being tuned to one lineup.
- **Dev-only simulate-lineup endpoint**
  (`POST /api/v1/perfect-season/dev/simulate-lineup`), gated behind
  `PEAK3_DEV_TOOLS_ENABLED=true` or `COURTBUILDER_READINESS_LEVEL=
  internal_dev` (403 otherwise). Same resolve-then-simulate path as the
  CLI, exposed over HTTP for scripted/manual testing without a full game
  session.

Tests added (`apps/api/tests/test_perfect_season.py`): both example
lineups resolve to real exact-season cards (never career-peak); ceiling
lineup reaches >= 78 wins; giant-heavy lineup lands strictly between 50 and
78 wins (never forced to 82); giant-heavy weakness names SG/SF/PF structure
and never contains "Rasheed Wallace"; ceiling lineup's weakness has slot
context, not a bare name. Full suite: 389 passed, 18 skipped.

## Phase 6E (this session, 2026-07-24) — game feel + platform roadmap, files changed

Product direction: see `docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md`'s new
"Future Game Modes" section (10 tracks + near/next/later prioritization) --
82-0 PEAK Season stays the only mode actually being built; everything else
is documented so today's data-model choices don't block it later.

This pass fixed game feel/visual quality on the existing flagship, not new
data. Changed:
- `scripts/build_experimental_team_year_dataset.py` -- candidate order is
  now alphabetical by display name (was minutes-descending, i.e.
  star-first, which silently told the user the "best" pick before they
  chose). Regenerated `courtbuilder_team_year.experimental.v2.json` with
  the new order (same 1,310 rollable team-seasons, same coverage --
  ordering only).
- `apps/web/src/components/court/EligiblePlayerSearch.tsx` -- single
  column (was a 2-column grid), compact rows, humanized badges ("Roster
  Only"/"Score Pending" instead of raw enum strings), scrollable panel.
- `apps/api/app/services/perfect_season/state.py` (`_compute_live_build`) +
  `apps/web/src/components/court/LiveBuildPanel.tsx` -- new mid-run
  feedback: placed/scored counts, roster identity tags, needs, a coarse
  provisional record range. Never reveals a hidden score, never
  recommends a specific open-round candidate.
- `apps/web/src/components/court/CourtLayout.tsx` + `globals.css` -- real
  court markings (paint/arc/free-throw-circle/rim) as visible board
  geometry, not faint background decoration; bench visually attached
  directly below the baseline instead of a separate floating block; new
  `court-panel`/`court-paint`/`court-arc`/`court-hoop` testids alongside
  the unchanged `half-court` one.
- `apps/web/src/components/court/PeakCardCourt.tsx` -- two-line name wrap
  instead of single-line truncate (verified: "Stephen Curry", "Shaquille
  O'Neal" etc. never cut off at normal desktop width); soft glow drop-zone
  instead of a dashed yellow box.
- `apps/web/src/components/court/SeasonResultStub.tsx` -- share-card-first
  hierarchy: result tier headline (82-0 Immortal / Dynasty / Contender /
  Playoff Team / Mid Pack / Rebuild), team identity phrase, best-pick/
  weakness, "N/8 exact season cards scored" wording (was "peak scores",
  wrong for exact-season mode), seed/version/formula receipt moved into a
  collapsed `<details>` disclosure.
- `apps/web/src/components/court/SpinStage.tsx` + `CourtBuilder.tsx` --
  replaced "limited coverage" with real numbers ("1,310 rollable
  team-seasons · 1979-80 to 2025-26") when available, else "Experimental
  exact-season mode"; added a `LOCKED` micro-state; board receipt moved
  into a disclosure; header badge "Prototype" → "Experimental".
- `data/game/assets/player_assets.v1.json` (250 players) +
  `team_assets.v1.json` (40 teams), generated by new
  `scripts/build_asset_manifests.py` -- schema + fallback-safe seed data,
  NO image binaries or URLs populated (every entry `license_status:
  "unavailable"/"unknown_do_not_cache"`, `cache_policy: "fallback_only"`).
  `PlayerAvatar.tsx` gained an optional `imageUrl` prop with `onError`
  fallback to initials -- the rendering hook, not an active image source.
- `apps/web/src/app/(main)/rankings/page.tsx` -- Peak Index rows now show
  `PlayerAvatar`; an explanatory note when a window's row count is below
  1000 ("858 rows for 5Y ... real eligible-window count, not a bug").

Tests added: alphabetical-order test (backend + Playwright), single-column
layout, exact-team-season-preserved-after-sort, humanized-badge, court
landmark testids, share-card/tier-headline/exact-season-wording, and an
end-to-end unscored-card selection test (Okaro White, 2016-17/2017-18
Miami Heat -- real, honest `team_year_roster_only`/`exact_season_unscored`
case) proving the lineup score is reported incomplete, not backfilled with
a career-peak value.

## Phase 6D (this session, 2026-07-24) — broad coverage + 1500 universe + PEAK Index, files changed

New:
- `data/game/experimental/player_pool_1500/courtbuilder_team_year.experimental.v2.json`
  (1,310 rollable + 4 unsupported team-seasons, 40 franchises, 47 seasons,
  4.9MB) -- generated by the rewritten `scripts/build_experimental_team_year_dataset.py`
  (now iterates every team-season in `regular_1980_2026.parquet`, not a
  hardcoded list).
- `data/game/experimental/player_pool_1500/candidate_identity_manifest.v1.json`
  (1,510 identities, 1.3MB) + `all_seasons_for_identities.v1.json` (14,133
  rows, 4.1MB) -- generated by the rewritten `scripts/audit_player_pool_expansion.py
  --write-manifest`.
- `data/game/experimental/player_pool_1500/top_1000_peaks.v1.json` (876KB) --
  generated by new `scripts/build_top_peaks.py`.
- `scripts/review_player_pool_manifest.py` -- manifest review CLI.
- `apps/api/app/api/v1/peaks.py` -- `GET /api/v1/peaks?window=1y|3y|5y`.
- Website: `/rankings` gained a "PEAK Index · Top 1000" tab (`getPeaks` in
  `lib/api.ts`, `PeaksResponse`/`PeakRow` in `types/index.ts`) alongside the
  unchanged canonical "Top 250" tab -- no duplicate route.

Changed:
- `nba_peak/perfect_season/board.py` -- `_default_experimental_team_year_path()`
  → v2; `experimental_team_year_summary()` now prefers v2's own precomputed
  coverage fields (franchise_ids_represented, seasons_represented,
  min/max/median candidates, unsupported_team_seasons) over recomputing them.
- `nba_peak/perfect_season/config.py` -- `EXPERIMENTAL_TEAM_YEAR_DATA_VERSION`
  → `courtbuilder_team_year.experimental.v2`.
- `nba_peak/perfect_season/exact_season.py` -- `MANIFEST_1500_PATH` now
  points at the real v1 manifest (was still pointing at the since-deleted
  v0 draft -- every `identity_pool_status` classification was silently
  wrong until this fix).
- `apps/api/app/models/perfect_season.py` -- readiness response gained
  `supported_franchise_count`, `teams_represented_in_spinner`,
  `seasons_represented_in_spinner`.
- `apps/api/app/api/v1/perfect_season.py` -- readiness route passes the new
  fields through.
- `apps/api/tests/test_perfect_season.py` -- new tests: dataset is not
  Warriors-only, spinner draws from >5 distinct teams/seasons across 20
  seeds, 1500-manifest excludes Festus Ezeli / includes Andre Iguodala.

Deleted:
- `courtbuilder_team_year.experimental.v1.json` (superseded by v2).

Not done this session: the two known data gaps from the Phase 6C addendum
below (per-100-vs-per-game stats, traded-player team-stint splits) remain
open and documented, not fabricated around.

## Phase 6C (this session, 2026-07-24) — exact-season card fix, files changed

New:
- `nba_peak/perfect_season/exact_season.py` — `PlayerSeasonCard` dataclass +
  `resolve_player_season_card()` / `resolve_exact_card_by_key()` /
  `component_percentile()`, reading `cache/processed/regular_1980_2026.parquet`
  + `cache/processed/scored_1980_2026.parquet` directly. No network access.

Changed:
- `nba_peak/perfect_season/board.py` — `generate_team_year_board()` rewritten:
  candidates are now a team-season's full real roster (not intersected with
  the career-peak card pool), sampled with replacement across all 8 rounds,
  never falls back to `open_pool`. New `MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON
  = 8` gate. `experimental_team_year_summary()` now reports rollability/
  candidate-count spread.
- `nba_peak/perfect_season/schemas.py` — `SpinPrompt.team_id`,
  `CourtSlot.exact_player_season_key`,
  `CourtLineupState.pending_selection_exact_season_key` added.
- `nba_peak/perfect_season/positions.py` — `parse_real_position()` /
  `classify_fit_from_position()` added: real per-season BR position string
  → primary/secondary, used instead of the archetype fallback for team_year
  cards (fixes the same "Duncan/Shaq show as PG" class of bug for this path).
- `nba_peak/perfect_season/simulation.py` — `simulate_exact_season()` +
  `compute_exact_fit_components()` added (parallel to the existing
  `simulate_season()`, operating on `PlayerSeasonCard`).
- `apps/api/app/services/perfect_season/state.py` — `action_select_player`/
  `action_place_card`/`action_complete_game`/`get_public_state` all branch on
  `spin.spin_type == "team_year"`; the exact-season-match invariant lives in
  `action_select_player`.
- `apps/api/app/models/perfect_season.py` — new optional fields on
  `SpinCandidate`/`PendingSelectionPublic`/`CourtSlotPublic` (team_id,
  team_name, season, identity_pool_status, score_status, season_score);
  `SimulationResultPublic.lineup_score_status`;
  `PublicCourtStateResponse.open_pool_enabled`; readiness response extended
  with the exact-season-card-required contract fields.
- `apps/api/app/api/v1/perfect_season.py` — readiness route passes through
  the new summary fields.
- `apps/api/requirements.txt` — added `pandas`/`pyarrow` (state.py now reads
  `cache/processed/*.parquet` directly for this one mode; the rest of the API
  remains read-only against `data/web/*.json`).
- `scripts/build_experimental_team_year_dataset.py` — now emits `team_id`
  per entry and regenerates
  `data/game/experimental/player_pool_1500/courtbuilder_team_year.experimental.v1.json`
  (v0 file superseded).
- Frontend: `apps/web/src/types/perfect-season.ts`,
  `components/court/{SpinStage,CourtBuilder,PeakCardCourt,EligiblePlayerSearch,
  SeasonResultStub,CourtLayout}.tsx`, `styles/globals.css` (new spatial
  half-court grid: PG top / SG right wing / SF left wing / PF low block / C
  paint, replacing the Phase 6B plain PG..C row; real key/free-throw-circle/
  arc markings behind it).

Not done this session (real, substantial follow-up — see
`PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`'s Phase 6C addendum): scaling
team-season/1500-identity coverage beyond the 3 existing Golden State
Warriors seasons, `scripts/review_player_pool_manifest.py`, and the Peak
section's top-1000 1Y/3Y/5Y pages.

**Status:** 5X.1 (Arena IA), 5X.2 (spin ceremony), 5X.3 (position-aware
slots), and the deferred-reveal contract change originally scoped under
5X.7 have been implemented, on `phase5-courtbuilder-vertical-slice` /
PR #3 (still draft, and a 2026-07-23 manual review means it stays draft
for a while yet — see the new "Phase 5X.7 (this session)" section below).
Four further passes -- each self-labeled by the task that produced it, and
each colliding with an existing number in this document's original
numbering -- have also shipped on the same branch. See the
**Phase-label collision log** below for what actually shipped under each
reused number; do not trust a bare "5X.N" reference anywhere in this
document without checking that table first.

**Phase-label collision log** (chronological; read top to bottom):

| Label used | What it actually shipped | This doc's original meaning for that label | Still planning-only? |
|---|---|---|---|
| "Phase 5X.4" (1st reuse) | Team+era wheels, real half-court, PEAK-value-first scoring (removed the role-overlap/redundancy penalty entirely) | Player database expansion to 500 | Original meaning: yes, see the renamed "Phase 5X.4 (original)" section below |
| "Phase 5X.5" (1st reuse) | Wheel-coverage bug fix (2 dead player_slugs silently excluded 2 franchises from the wheel entirely), half-court visual polish, coverage-summary readiness metadata | Improved search/card selection (card-based candidate UI) | Original meaning: yes, see "Phase 5X.5" section below |
| "Phase 5X.6" (1st reuse) | Product direction reset (durable PEAK3 lineup score concept, working-title options, spinner/imagery/leaderboard design docs), 1000-player expansion target, manual position-override fix (Duncan/Shaq no longer "play PG") | Lineup-fit engine v1 (extend `LineupFitComponents` with position-aware bonus/penalty taxonomy) | Original meaning: yes, see "Phase 5X.6 (original)" section below. Note: the original 5X.6's bonus/penalty taxonomy was already superseded by the 1st "5X.4" reuse's peak-value-first scoring philosophy -- it was never going to be built as originally written regardless of this collision. |
| "Phase 5X.7" (1st reuse, this session) | Manual-review rejection response: cancel/back UX fix (shipped), copy honesty fix (shipped), team+year redesign direction, visual-redesign requirements, randomness-audit requirements (all documentation, not shipped) | Result / reveal / share screen (broadcast reveal, loss timeline, share card) | Original meaning: partially — the deferred-reveal contract change shipped early (under the 5X.4 reuse); loss timeline/share card remain planning-only, see "Phase 5X.7 (original)" section below |

Net effect: 5X.1-5X.3 and the deferred-reveal piece of 5X.7 shipped
close to plan. Everything shipped under a reused "5X.4/5X.5/5X.6/5X.7"
label is new, unplanned-in-this-document work; the *original*
5X.4/5X.5/5X.6/5X.7/5X.8 scopes remain planning-only under their own
renamed headings further down.
**Phase 5X.6 (product direction reset) introduced a numbering concern that
still applies:** it recommends a working title change for the whole mode
and questions whether "82-0" should stay the primary framing at all --
future phase numbers referencing "82-0" by name should be read as "the
mode currently called 82-0 Peak Season, pending the naming decision," not
as a permanent name commitment. **Phase 5X.7 (this session) adds a second,
more fundamental one:** the manual review that produced it found the
*execution* (not just individual bugs) is not product-ready — treat every
"shipped" claim about CourtBuilder's UI/game-feel in this document as
"functionally correct, not yet fun," not as "done."

**Depends on:** `docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md` (the "what and
why" — read that first), `docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md`
(still binding), `docs/architecture/PHASE_5_DATA_MODEL.md` (schema design),
`docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md` (the parallel data
track, now targeting 1000 players not 500), `docs/architecture/PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md`
(new -- team/player imagery plan).
**Branch context:** current work is on `phase5-courtbuilder-vertical-slice`
(PR #3, draft, correctly still draft — see report). This plan does not
prescribe a specific new branch name; that's a decision for whoever starts
5X.1, made against whatever `main`/PR state exists at that time.

**Implementation notes (where the shipped code intentionally differs from
this plan's original 5X.3 description):**
- **No slot-first reordering.** §5X.3 originally proposed reordering the
  round flow so the player picks a target slot *before* seeing candidates.
  The shipped version keeps the existing select-then-place flow (pick a
  candidate, then place them into any open slot) and layers position
  identity onto the *existing* flow instead — smaller, lower-risk change
  with the same "soft placement, never blocked" guarantee. Slot-first
  ordering remains a legitimate future UX experiment, just not part of
  this pass.
- **No separate `COURTBUILDER_POSITION_SLOTS_ENABLED`/
  `COURTBUILDER_DEFERRED_REVEAL_ENABLED` flags.** §"New feature flags for
  overhaul stages" below proposed independent flags for these two changes.
  Both shipped directly gated by the existing `COURTBUILDER_ENABLED`
  instead, since `COURTBUILDER_ENABLED` has never been `true` in any real
  deployment (confirmed before starting) — the same reasoning §5X.3's own
  "breaking change" callout already used to justify a direct rewrite over
  a versioned migration.

---

## Phase 5X.6 (this session, 2026-07-22) — Product Direction Reset

**Trigger:** manual review after the wheel-coverage fix (previous "5X.5"
reuse) found the mode is still far from product-quality: the court isn't
visually compelling, the spinner lacks the visual hook of comparable
products (First Down Studio's 17-0/82-0, Sleeper 17-0), and a real
correctness bug (Tim Duncan/Shaquille O'Neal displaying as "plays PG")
undermined trust in the position system. Separately: 82-0 alone is
probably the wrong primary success metric, because many legitimate
all-time-peak rosters should realistically project near a perfect record --
a mode whose only outcome is "did you go 82-0" flattens exactly the
signal (how good is this roster, really) that PEAK3's actual model
provides.

This section is a **planning pass**, not an implementation pass. Only the
position-correctness bug fix and the interim-dataset Jrue Holiday
correction shipped as code this session (see "What changed now" at the
end); everything else here is direction-setting for future phases.

### Product direction: keep 82-0, add a durable PEAK3 lineup score

**Why 82-0 alone is not enough:** a binary "did you go undefeated" outcome
can't distinguish a merely-great roster from a truly historic one once
both are projected near 82-0 -- the ceiling gets crowded and the number
stops discriminating. It also gives the mode no legible progress metric
below "did you sweep" (a 60-win roster and a 75-win roster both just read
as "you lost"), and no natural leaderboard axis once a global ranked layer
exists (Phase 5X.9) -- "82-0 or not" is a bad sort key, a continuous score
is a good one.

**Resolution:** 82-0 stays as a **visible, celebrated outcome** (the
perfect-season framing, loss timeline, etc. from Sec 3.6 of the product
spec are unchanged), but the **primary durable score becomes a PEAK3
lineup score**, computed from the same `LineupFitComponents` already
implemented (`talent_core`, `bench_strength`, `positional_fit`,
`creation_coverage`, `scoring_coverage`, `postseason_pedigree`,
`team_context_depth`) via a single weighted composite, analogous to how
`calibrate_score()` remaps the core model's raw index to a 0-100 display
value (CLAUDE.md's existing pattern, reused at the game layer, never
touching the core model itself per ADR-005 Decision 3/4).

**Scale decision: 0-100, not 0-1000.** Reuses the existing `individual_peak_score`
display convention (`data/web/*.json`, `card_profiles.v3.json`) that
players already see on every Peak Draft card -- a second, differently-scaled
number for the same underlying kind of quantity (0-1000 lineup score next
to 0-100 player scores) would be a confusing, unforced inconsistency. A
lineup score is not a simple average of 8 player scores (it also reflects
bench_strength/positional_fit/coverage), so it needs its own composite
formula, but it stays on the model's existing 0-100 display scale.

**Scoring outputs (result screen + future receipt), superset of what
`SimulationResultPublic` already returns:**
- Projected record (`wins`-`losses`) -- unchanged, still shown.
- **New: PEAK3 lineup score (0-100)** -- the durable, comparable number.
  Composite of the existing fit components; exact weights are a Phase
  5X.6-follow-up modeling task, not decided here (do not hand-pick weights
  to hit a target result for any specific roster -- same anti-overfitting
  discipline as `OFFICIAL_WEIGHTS` itself).
- **New: percentile/grade** -- where this lineup score falls relative to
  other attempts on the same board seed (needs the durable-attempt storage
  Phase 5X.8 already scopes; cannot ship before that).
- **New: roster receipt** -- a structured breakdown mirroring Peak Draft's
  existing `ReceiptItem`/Peak Receipt pattern (`nba_peak/lineup/schemas.py::ReceiptItem`,
  already proven UI): talent core, bench strength, positional legality per
  starter, weak/open positions, one-line plain-language summary. Reuses
  the existing receipt *pattern*, not the existing receipt *data* (Peak
  Draft's receipt is 5-slot; CourtBuilder's is 8-slot with position
  identity Peak Draft doesn't have).
- **Future: leaderboard rank** -- deferred to Phase 5X.8/5X.9 (needs
  durable history + the schema work already flagged out of scope for
  Phase 5C). See "Game score and leaderboard design" below for the shape
  to build toward, not to build now.

**Working title:** kept as **"82-0 Peak Season"** for this phase -- do not
rename routes, flags, or copy yet. Candidate alternatives considered
("PEAK Season," "PEAK Dynasty," "Perfect Peak," "PEAK Run") all have merit
and none is clearly better enough to justify a rename churn before the
lineup-score concept actually ships and the mode has real usage signal to
name it against. Revisit naming once the lineup-score result screen exists
and the mode has been played by more than the internal dev/alpha loop.

### Team + decade spinner redesign

- **Team wheel: all 30 current NBA franchises** should eventually be
  spinnable (visually -- the actual *resolvable* outcome stays governed by
  interim-dataset/1000-player coverage, same "never show an impossible
  outcome" discipline as the current wheel). Historical-alias support
  (e.g. Seattle SuperSonics -> OKC Thunder, New Orleans Hornets naming
  history) is a data-modeling detail for the 1000-player expansion's
  `team_identity` entity (`PHASE_5_DATA_MODEL.md`), not a CourtBuilder UI
  concern.
- **Decade wheel:** unchanged, 1980s/1990s/2000s/2010s/2020s
  (`config.ERA_LABELS`), already implemented as a real second reel.
- **Visual target:** team logos/icons on the wheel, not just text --
  blocked on the asset strategy (`PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md`,
  new doc) resolving a licensing-safe source before any logo image ships.
  Safe to build the *reel mechanic* improvements (below) without logos
  first, using the existing team-color-accent + text treatment as the
  interim visual.
- **Result stays team + decade by default**, not exact season -- unchanged
  from current behavior (`spin_type: "team_decade"` is already the
  majority case; `"exact_team_season"` already exists as the rarer,
  harder variant per the existing board generator, matching "exact season
  can become a harder sub-mode later" -- it already effectively is one).
- **Reroll/lifeline design (new, not yet implemented):**
  - One team reroll per attempt: re-spins only the team dimension, keeps
    the era locked, consumes a limited resource (mirrors Peak Draft's
    existing Hold/Reframe mechanic shape -- `hold_used`/`reframe_used`
    boolean-flag pattern in `DraftGameState`, directly reusable for
    CourtBuilder's `CourtLineupState`).
  - One decade reroll per attempt: same shape, other dimension.
  - A possible future "scout reveal" (peek at one extra candidate before
    committing to a pick) is explicitly a **later** idea, not scoped for
    implementation in this pass -- flagged here so it isn't lost, not
    because it's ready to build.
  - None of this is implemented yet. Implementing it requires new
    game-state fields (`team_reroll_used`/`decade_reroll_used`) and two
    new state-machine actions, i.e. a real Phase 5X.7-follow-up
    implementation pass, not a docs-only change.

### Team and player imagery

See new companion doc `docs/architecture/PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md`
for the full plan (asset manifest shape, fallback badges, licensing
posture, caching). Summary: build the **asset manifest + fallback-badge
abstraction now** (safe, no copyrighted assets touch the repo), defer
actual logo/headshot ingestion until a licensing/usage decision is made
and documented.

### Position data correctness

Fixed this session -- see `nba_peak/perfect_season/positions.py`'s new
`POSITION_OVERRIDES` table and module docstring for the full explanation of
what was wrong (archetype-only fallback classified nearly every elite
player as `lead_creator`, which maps to PG, regardless of real position)
and how it's fixed (manual override table, keyed by `player_slug`, takes
priority over the archetype fallback; covers every player_slug currently
reachable in the interim team-season dataset). Full strategy (manual v0
now, source-derived table later) is in
`PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`'s "Required source tables" section.

### 1000-player expansion

Target raised from 500 to 1000 -- see `PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`
(updated this session) for the full staged plan, inclusion criteria, source
tables, and QA checks. Not implemented in this pass (docs only, per this
task's explicit constraint).

### Game score and leaderboard design (docs-only, not implemented)

Future durable leaderboard entry shape (design target, not a migration):

```text
peak_lineup_attempt
  attempt_id            uuid, pk
  owner_sub             text (anon:<token> or real auth sub, existing pattern)
  game_mode             "82-0-peak-season" (or renamed mode slug)
  duration_years        1 | 3 | 5
  board_seed            int, deterministic
  board_type            "practice" | "daily" | "challenge" (practice only today)
  is_official           bool  -- first attempt on an official (daily) board;
                                 practice attempts never durable-writeable,
                                 same discipline as Peak Draft's existing
                                 practice/official split
  card_pool_version     text  -- pinned at attempt time, not re-resolved
  board_generator_version, eligibility_ruleset_version, lineup_model_version,
  simulator_version      -- all pinned, all already computed today, just
                             not yet persisted anywhere durable
  wins, losses           int
  peak_lineup_score      float 0-100  -- the new durable score (see above)
  fit_components         jsonb        -- full LineupFitComponents snapshot
  slots                  jsonb        -- 8-slot roster, player identities +
                                          resolved positions, for replay/audit
  completed_at           timestamptz
```

- **Anti-cheat / replay validation:** every field needed to *recompute* the
  result server-side from scratch already exists (board_seed + slot
  player_slugs + pinned versions) -- validate on write by recomputing
  `simulate_season` server-side and rejecting any client-submitted score
  that doesn't match, never trusting a client-submitted score directly.
  Exactly the pattern `nba_peak/lineup/board.py`'s solver-side validation
  already uses for Peak Draft; no new anti-cheat concept needed.
- **Anonymous vs. authenticated:** reuses the existing `resolve_owner_sub`
  anon-cookie-or-JWT pattern unchanged (ADR-005 Decision 1, Phase 4.0A) --
  anonymous attempts are real and gameable into a personal-best comparison,
  but only claimed/authenticated attempts should count toward a *public*
  leaderboard (same discipline already documented for ranked).
- **Share card:** unchanged from the existing Sec 3.7 plan (record, court
  silhouette, one strength/weakness, board seed, playable link -- never a
  spoiler list).
- **Not implemented in this pass.** No new table, no migration, no writes.
  This is the target shape for whoever picks up Phase 5X.8.

### UI direction (target, not implemented this session)

- Full-width dark arena background (current: `max-w-3xl` centered column --
  a deliberate future change, not a mistake to fix reflexively; verify
  against real device testing before widening, mobile-first per below).
- Polished team logo wheel + decade reel (blocked on asset strategy for
  the logos specifically; reel mechanics can improve independently).
- Half-court with real geometry -- already has key/hoop/arc markings
  (shipped under the "5X.5" reuse); further polish (free-throw lane
  shading, baseline, sideline) is incremental, not a rewrite.
- Player cards with headshot-or-silhouette (blocked on asset strategy).
- Team-color accents -- partially possible without logos (color alone is
  public information, not a licensing risk the same way an image is; a
  `team_colors` manifest entry is safe to build now).
- Stronger typography, mobile-first layout, shareable result card,
  lightweight+accessible animation, reduced-motion support -- all already
  partially true (existing reduced-motion discipline, mobile viewport
  tests) and all get incrementally better with each future pass, not a
  single rewrite.

### What changed now (Phase 5X.6 actual code diff)

Per this task's own "decide what to change now" constraint (small, safe,
high-confidence only):
- `nba_peak/perfect_season/positions.py`: `POSITION_OVERRIDES` manual
  table, `classify_fit`/`primary_position`/`secondary_positions` now take
  `player_slug` as their first argument and prefer the override over the
  archetype fallback.
- Every call site of those three functions (`state.py`, `simulation.py`)
  updated to pass `player_slug`.
- `data/game/interim/courtbuilder_team_seasons.v3.json`: added Jrue
  Holiday to `celtics-2020s` (see "Jrue Holiday audit" in the expansion
  strategy doc) -- confirmed via direct data inspection, not assumed.
- New tests locking in the exact regression case (Duncan/Shaq no longer
  "play PG") plus the manual-override-wins-over-archetype guarantee.
- **Everything else in this section is planning only** -- no UI rewrite, no
  1000-player expansion execution, no image ingestion, no leaderboard
  writes, per this task's explicit scope limits.

---

## Phase 5X.7 (this session, 2026-07-23) — CourtBuilder Product Rejection Response

**PR #3 remains draft. Do not mark ready. Do not merge.** See the matching
"Manual Review Rejection" section at the top of
`docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md` for the full product framing
and the round-loop/team+year redesign spec — this section covers the
implementation-level detail that doc doesn't.

### What shipped this session (small, safe code changes only)

**Cancel/back before placing** — the concrete UX bug fix, full stack:
- `nba_peak/perfect_season/schemas.py`: no schema change needed (existing
  `pending_selection_peak_window_id`/`pending_selection_spin_id` fields
  reused).
- `apps/api/app/services/perfect_season/state.py`: new
  `action_cancel_selection(state)` — valid only from `placement_pending`,
  clears the pending selection, reverts `status` to `selection_pending`
  for the *same* `current_round` (does not advance the round, does not
  touch any already-placed slot). `get_public_state()` already re-includes
  `current_spin.candidates` once `status == selection_pending`, so no
  serialization change was needed beyond the new action itself.
- `apps/api/app/models/perfect_season.py`: new `CancelSelectionRequest`.
- `apps/api/app/api/v1/perfect_season.py`: new
  `POST /perfect-season/games/{id}/cancel` route, same shape as
  `select`/`place`/`complete`.
- `apps/web/src/lib/perfect-season-api.ts`: new `cancelSelection()`.
- `apps/web/src/components/court/CourtBuilder.tsx`: new "Choose someone
  else" button (`data-testid="cancel-selection-btn"`) in the Step 2
  placing banner, calling the new endpoint.
- Tests: 3 new API tests (cancel reverts state + preserves the full
  candidate list; select-A/cancel/select-B/place-B ends with B on the
  roster, not A; cancelling with no pending selection is rejected) + 2 new
  Playwright tests (cancel returns to the candidate panel with no slot
  filled; the full select-A/cancel/select-B/place-B flow, asserted via
  the placing banner naming B not A and the filled slot containing B's
  name not A's).

**Copy honesty fix** — `position-logic-note` in `CourtBuilder.tsx`
replaced per the product spec's "Copy fix" section. No test asserted the
old exact string, so no test changes were needed beyond confirming the
`position-logic-note` testid still renders (existing test, unchanged).

**Everything else below is documentation only** — no round-loop rewrite,
no team+year board-generator change, no visual redesign, no randomness-
audit script, per this task's explicit "do not do the full visual
redesign yet" / "1000-player expansion... do not add 1000 players yet"
scope limits.

### Team + year: the architectural work this actually requires (future)

Flipping the default constraint grain from team+decade to team+year is
**not** a config flag — it requires:
1. **Data:** the 1000-player expansion's `team_season_roster_member`
   coverage at the exact-year grain (see the expansion strategy doc's new
   team-year coverage QA section) — the interim dataset's existing
   `exact_team_season_spins` entries are a hand-curated proof of concept
   (4 entries today), not a scalable source.
2. **Board generator:** `nba_peak/perfect_season/board.py`'s
   `_select_interim_entries` and `_all_interim_spin_entries` currently
   treat `team_decade` as the primary spin type and `exact_team_season` as
   a minority draw (Sec "team+decade spinner redesign" in the product
   spec's Phase 5X.6 addendum). Making exact-year the default means
   inverting that weighting once (2) has enough real entries to support
   it — a real code change, gated on data, not scoped for this pass.
3. **Frontend:** `SpinStage.tsx`'s era wheel currently cycles fixed decade
   labels (`config.ERA_LABELS`, 5 entries). An exact-year wheel needs a
   much larger, data-driven label set (every supported season, not 5
   fixed strings) — a real component change, also gated on (1).
4. **Coverage-gate enforcement:** per the expansion strategy doc's new
   rule, exact-year team+year mode must not ship globally while many
   team-years are empty/tiny — this needs the coverage-gate check
   (already precedented by `coverage_summary()`, Phase 5X.5) extended to
   run per-team-year, not just per-team-decade, and to actually block
   the default-mode rollout, not just report numbers.

None of this ships until the 1000-player expansion clears the team-year
coverage gate (expansion strategy doc). Team+decade remains the shipped
default until then — team+year is a documented target, not a flag to flip.

### Visual redesign requirements (future task, not this pass)

Manual review's finding: floating boxes, awkward spacing, weak basketball
feel, overlapping text/cards, "not fun or shareable." The half-court
key/hoop/arc markings shipped under the 5X.5 reuse are real progress and
still nowhere near sufficient. Full requirements for whoever picks this up
next:

- **NBA-arena-style card table** — the overall screen should read as "a
  broadcast desk/card table," not "a form with boxes." This is a layout
  and depth (shadow/elevation) problem as much as a content problem.
- **Proper half-court geometry** — beyond the current key/hoop/arc: real
  proportions, a baseline, sidelines, and enough negative space that
  player cards don't visually collide with court markings at any
  supported viewport width (the exact "overlapping text/cards" complaint).
- **Team-color accents** — safe to build without the asset-strategy
  licensing gate (color is public information, not a licensed asset) —
  see `PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md` Sec 3.
- **Player headshot/silhouette slots** — silhouette/initials fallback is
  safe to build now (same doc, Sec 3); real headshots are blocked on the
  Sec 4 licensing decision in that doc.
- **Team logo reel** — blocked on the same licensing decision; the reel
  *mechanic* (two-dimension cycling reveal) can and should improve
  independently of whether logos ever ship (see "spinner is lame" finding
  above — a better-feeling reel with text-only content is still a real,
  shippable improvement).
- **Responsive roster rail** — the bench/starter layout needs to hold up
  at real mobile widths without the cramped, overlapping feel manual
  review flagged; current mobile-viewport tests only check for horizontal
  overflow, not for visual crowding, so this needs new
  qualitative/visual review, not just a new automated assertion.
- **Shareable result card** — product spec Sec 3.7's existing design,
  restated here as part of the visual system this task needs, not a
  separate concern.

**Explicitly not attempted this pass** — this is a requirements list for
a future, dedicated visual-redesign task, consistent with this task's own
"do not do the full visual redesign yet" instruction.

### Randomness audit

Current state: `generate_board()`'s randomness is already seed-
deterministic (`random.Random(seed + attempt * 997)`, re-derivable from
the board's own committed `seed` field) and already excludes zero-
candidate entries outright (Phase 5X.5). What's not yet true, and needs to
be before team+year (or any future official/ranked CourtBuilder mode)
ships:

- **Seed:** already true — every board is fully reproducible from
  `board_seed`, already surfaced in the public state (`board_seed` field).
- **Visible receipt:** not yet true for the *spin selection* specifically
  — a player can see the board's overall seed, but there's no per-spin
  receipt explaining "why this team+era was offered" (e.g. "weighted
  selection, 3x preference for entries with >=2 candidates" is documented
  in code comments, not surfaced to the player or in an auditable log).
  Future work: either a dev-facing audit endpoint or an extension of
  `scripts/check_courtbuilder_wheel_coverage.py` (see below) to accept a
  specific seed and print the exact selection trace.
- **No hidden deterministic bias:** partially auditable today —
  `scripts/check_courtbuilder_wheel_coverage.py` (Phase 5X.5) already
  samples many seeds and reports franchise/era distribution, which is
  exactly the tool for catching a bias regression. **TODO, not built this
  pass:** extend that script to also report per-exact-year distribution
  once team+year entries exist in the dataset at meaningful scale, and to
  fail loudly (non-zero exit) if any playable combination's observed
  frequency falls outside a documented tolerance band, rather than only
  printing numbers for a human to read.
- **Coverage-aware fallback only in prototype:** already true in spirit
  (the `open_pool` fallback exists specifically because the interim
  dataset doesn't cover every round) but not yet *labeled* as
  prototype-only behavior anywhere a player can see — the UI shows
  "Interim team data — limited coverage" only for team spins, not an
  equivalent disclosure when a round silently falls back to the open pool
  instead of a team+era/team+year spin.
- **Official mode must disclose excluded empty team-years:** not yet
  applicable (no official/daily mode exists yet, Phase 5X.8), but the
  requirement is recorded here so it isn't forgotten when that mode is
  built: if an official board generation excludes any team-year for
  having too few candidates, that exclusion must be part of the board's
  own committed metadata (`PerfectSeasonBoard.metadata`, already a dict
  field, already unused for this), not silently absent.

---

## Phase 6A (this session, 2026-07-23) — Team+Year Engine v0, 1500-Player Audit, Spinner v1

**PR #3 remains draft. Do not mark ready. Do not merge.** This section is
the direct follow-up to Phase 5X.7's "Team + year: the architectural work
this actually requires (future)" and "Visual redesign requirements"
sections above — read those first for the requirements this pass is
scored against.

**Target raised from 1000 to 1500 identities** — see
`PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`'s top-of-document note and Sec 2.3
for the full rationale. `scripts/audit_player_pool_expansion.py` found
**1885 identities qualify via the primary inclusion criteria alone**
(All-Defensive/MVP-vote/DPOY-vote/All-Star/15+PPG/championship-or-Finals-
meaningful-minutes/30+MPG), comfortably clearing 1500 without needing the
25+MPG fallback tier at all. This is Stage A (audit) + Stage B (candidate
manifest) only — no player identities were actually added to the
canonical 250-pool or any gameplay-reachable dataset this pass.

**Team+year engine — real, but deliberately narrow (Stage C/D/E-lite):**
`nba_peak/perfect_season/board.py::generate_team_year_board()` is a new,
purely additive function (the existing `generate_board()`/team+decade path
is byte-for-byte untouched, all its pre-existing tests still pass
unmodified). It reads a new, separately-versioned dataset (originally
`courtbuilder_team_year.experimental.v0.json`; Phase 6C replaced it with
`v1.json`, which adds a `team_id` per entry and switches candidates to the
full real roster -- the v0 file is deleted, nothing at runtime reads it),
`data/game/experimental/player_pool_1500/courtbuilder_team_year.experimental.v1.json`,
covering exactly **three exact team-seasons**: Golden State Warriors
2015-16, 2016-17, 2017-18 — built by
`scripts/build_experimental_team_year_dataset.py` directly from real
per-player-season minutes in `cache/processed/regular_1980_2026.parquet`
(≥50 minutes for that team-season = "meaningfully on the roster," reusing
the same threshold `nba_peak/context/title_role.py` already uses for
postseason minutes). A companion experimental card extension
(`scripts/build_experimental_card_extension.py`,
`data/game/experimental/player_pool_1500/card_profiles.experimental.json`)
gives real, non-fabricated 1-year cards to real GSW rostermates who exist
locally but never had a canonical `card_profiles.v3.json` entry (Shaun
Livingston, Zaza Pachulia, Festus Ezeli, Leandro Barbosa, Marreese
Speights, David West, and others) — every score on those cards is the
player's own real `prime_score`/`contrib_*` values already computed by the
canonical scoring pipeline in `cache/processed/scored_1980_2026.parquet`,
never recomputed or approximated.

Net effect: GSW 2015-16 went from **2 resolvable candidates** (Curry,
Durant — see the Sec 5.1 worked example in the expansion strategy doc,
now stale, see that doc's own Phase 6A update) to **10**; 2016-17 and
2017-18 to **11 each**. This clears the 4-8 team-year target (expansion
strategy doc Sec 4.1b) for these three specific seasons only — it is
**not** the broad, all-team-all-season coverage that gate requires before
team+year can become the default/official mode. Gated behind
`COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED` (default `False`,
independent of `COURTBUILDER_TEAM_SPIN_ENABLED`), never wired into any
official/global/ranked path.

**Spinner v1 (partial answer to "the spinner is lame"):** `SpinStage.tsx`
now shows a real team-color badge (initials + real NBA brand primary/
secondary colors, `apps/web/src/lib/team-colors.ts` — see the asset
strategy doc's own Phase 6A note on how this relates to the Sec 2 manifest
design) next to the team reel, and the second reel switches between "Era"
(decade label, team+decade path, unchanged) and "Season" (exact-year
label, team+year path) rather than always saying "Era" — the two label
sets are never mixed on the same board (enforced at the board-generator
level, not just the label text). A revealed round now also states "You
rolled: [Team] · [Season]" explicitly. Round progress, lock/reveal
states, and reduced-motion handling are unchanged from Phase 5X.2/5X.7.

**PEAK3 Lineup Score, not just 82-0:** the result screen
(`SeasonResultStub.tsx`) now shows a **PEAK3 Lineup Score (0-100)** —
computed server-side in `simulation.py::simulate_season()` as the direct
mean of the 8 placed cards' own real, canonical `individual_peak_score`
values (no new scoring logic, no client-side computation). The 82-0
record stays the fun headline outcome (seeded-noise, capped at a fixed
82-game season, per the product spec's existing chase identity), but the
Lineup Score is the number meant to be durable and comparable across
different rosters/runs, per this session's product direction. A small
receipt strip (seed, `card_pool_version`, `board_generator_version`, and
— for team+year boards only — `experimental_team_year_data_version`/
`formula_version`/`coverage_mode`) is now visible on both the in-progress
board header and the result screen.

**Visual redesign (Phase 5X.7's requirements list above): NOT attempted
this pass, still fully open.** No court-layout/card-table/roster-rail
rework was done. This pass had no way to visually verify a redesign (no
screenshot/browser tool available), so rather than guess at a "product-
ready" visual system, this work is deferred to **Phase 6B** as its own
dedicated task — see that section immediately below for the concrete
target this leaves for whoever picks it up next. Manual review's
underlying finding ("not fun or shareable," floating boxes, weak
basketball feel) should be assumed to still hold until someone actually
looks at the running app and says otherwise.

**Tests added this pass:** 14 new backend tests (determinism, no mixed
decade/exact-year labels, full candidate resolvability, receipt fields,
the experimental-card-extension resolve path, a full end-to-end practice
attempt, `lineup_peak_score` correctness) — see
`apps/api/tests/test_perfect_season.py`. Full regression confirmed green:
227 model tests, 105 perfect_season tests (91 original + 14 new), 368/386
API tests (18 pre-existing skips), 101 frontend unit tests, 20/20
CourtBuilder Playwright (chromium) + 1/1 (mobile-chrome), 23/23 Peak Draft
`gameplay.spec.ts` regression. Team+year-specific Playwright coverage was
deliberately **not** added to the shared CI `webServer` config — flipping
`COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED` on globally would replace
the entire wheel with 3 GSW seasons for every existing decade-path
Playwright test, a disproportionate risk for a feature that must not ship
as the default mode yet. Backend coverage plus the unaffected regression
suites above are this pass's verification.

**No scraped images, headshots, or logos were added.** The team-color
badge is real NBA brand color data (public, factual, not a licensed
asset — same reasoning already laid out in
`PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md` Sec 3/7), rendered as CSS
initials chips, never an image file.

### Phase 6B (not started) — visual system rebuild

Manual review's "not fun or shareable, floating boxes, weak basketball
feel, overlapping text/cards" finding (Phase 5X.7 above) is **still the
product-readiness blocker** — this pass explicitly did not resolve it,
and did not have a way to confirm or deny it visually (no
screenshot/browser tool in this pass's toolset). Concrete target for the
next pass that does have visual verification available:

- **Team-color reel** — extend Phase 6A's badge (currently spinner-only)
  consistently through the rest of the board (result screen, court
  context), not just the spin ceremony.
- **Logo/initials badge** — the initials badge is real and shipped
  (Phase 6A); a licensed logo badge remains blocked on
  `PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md` Sec 4's unresolved licensing
  decision, unchanged.
- **Player portrait/silhouette card shell** — not built; every card is
  still text-only. Sec 3 of the asset strategy doc already specifies the
  initials/silhouette fallback shape — this is the next concrete piece to
  build from that spec.
- **Compact roster board** — the current bench/starter layout needs a
  real pass at mobile and desktop density; existing tests only check for
  horizontal overflow, not visual crowding.
- **Cleaner court-inspired slot grid** — evolve the existing CSS-only
  half-court (hoop/key/arc markings, Phase 5X.5) toward the "broadcast
  desk/card table" feel Phase 5X.7 specified, not a from-scratch rebuild.
- **No overlapping card labels** — the literal "overlapping text/cards"
  complaint from manual review; needs to be re-verified live (screenshot
  or browser walkthrough), not assumed fixed by any code written so far.
- **Share-card-ready final result** — product spec Sec 3.7's design,
  still not implemented; the result screen (Phase 6A) added the Lineup
  Score and receipt but not a shareable-image/card layout.

This section exists so the next task on this doesn't have to re-derive
"is the visual system done" from scratch — it explicitly is not, and this
list is the scoped starting point.

---

## Sequencing: does database expansion happen before or after the UI overhaul?

**In parallel, with UI/mechanical work (5X.1-5X.3, 5X.5-5X.7) starting
first in practice.** Reasoning:

1. The UI/mechanical fixes (spin ceremony, position slots via the v1
   archetype approximation, deferred reveal, result broadcast) require
   **zero new data** — they work today against the existing 250-player
   pool and the existing interim dataset. They are the cheapest, fastest
   way to find out whether the redesigned loop is actually fun before
   committing to a multi-week data-acquisition project.
2. Database expansion (5X.4 here; full detail in the companion strategy
   doc) is a genuinely different kind of work — sourcing, curating, and
   QA-auditing real historical roster and position data — with a
   different critical path (data acquisition and validation, not
   frontend/backend engineering). It should start immediately and run
   continuously, but its completion should not block 5X.1-5X.3 from
   landing.
3. The two tracks converge at 5X.5 (search/selection quality) and
   specifically at the decision to make team+decade spins the **default**
   public experience (vs. an interim/labeled-narrow mode) — that specific
   milestone *is* gated on expansion coverage meeting the acceptance
   threshold defined in the companion strategy doc (≥5 eligible candidates
   per Competitive-Core team-decade). Until that gate is met, team+decade
   spins can still ship and be played — just visibly labeled as narrow
   coverage, exactly as the current interim dataset already honestly does
   via its `coverage_note` and the frontend's "Interim team data — limited
   coverage" badge.

Net effect: nobody is blocked waiting on the other track, but nobody
claims broad team+decade coverage exists until the data actually backs it
up.

---

## Phase 5X.1 — Arena IA and mode hierarchy cleanup

**Deliverables:**
- Arena landing page redesign per product spec Sec 4.1: single primary CTA,
  Peak Draft/Daily/Ranked collapsed into one visually-secondary "Peak Draft
  (Labs)" section, Peak Hunt placeholder card.
- Remove "Prototype" badge language from CourtBuilder once 5X.1-5X.7's exit
  criteria are met (do this at the *end* of the overhaul, not now — the
  badge is honest today and should stay until the redesign actually ships).
- No route changes — `/arena/court/practice/[mode]` and all existing Peak
  Draft routes stay exactly where they are; this phase is presentation and
  navigation only.

**Files touched:**
- `apps/web/src/app/(main)/arena/page.tsx` (already has the flag-gated
  CourtBuilder nav card from Phase 5C — restructure the whole page's
  hierarchy around it)
- New: a small `LabsSection` or similar component if the Peak Draft
  consolidation needs one (judgment call at implementation time — may not
  need a new component if it's just a layout change to the existing page)

**Tests required:**
- Playwright: landing page shows exactly one primary CTA; Peak Draft modes
  are still reachable via the Labs section; existing `gameplay.spec.ts`
  "Arena landing" tests updated only if the heading/CTA text they assert on
  changes (check `src/tests/e2e/gameplay.spec.ts:54` — `"Which player had"`
  heading assertion — must still pass or be deliberately, visibly updated,
  never silently broken).
- Accessibility: landing page re-audited (existing `accessibility.spec.ts`
  "Arena landing" describe block).

**Acceptance criteria:**
- A first-time visitor can identify the primary action within 2 seconds
  without reading body text (informal, eyeball-tested, not automatable).
- No existing route returns a different status code than before this phase.
- Existing CI baseline stays green.

---

## Phase 5X.2 — True spin/randomizer stage

**Deliverables:**
- Replace `SpinStage.tsx`'s static block with an animated ceremony per
  product spec Sec 3.1 step 1: team ribbon spin → lock, era wheel spin →
  lock, eligible-count reveal (count only, no names).
- Modifier spins (product spec Sec 3.2): "No repeat franchise," "One
  player per decade" — pure board-generation-time constraints, no new data.
- Reduced-motion fallback: instant fade + text reveal, zero information
  loss.
- Animation implemented in CSS transitions/keyframes only — no new
  dependency. If a case is later made for a lightweight animation library,
  it needs its own bundle-size justification separate from this phase.

**Files touched:**
- `apps/web/src/components/court/SpinStage.tsx` (rewritten)
- `nba_peak/perfect_season/board.py` (modifier-spin support — new
  `spin_modifier` field on `SpinPrompt`/board metadata, generated
  deterministically from the existing seed, no schema-breaking change to
  the board shape)
- `nba_peak/perfect_season/schemas.py` (extend `SpinPrompt` with an
  optional `modifier` field)

**Tests required:**
- Frontend unit: reduced-motion variant renders the same final state as
  the animated variant (no content difference, only timing).
- Playwright: spin ceremony completes and reaches the candidate stage
  within a bounded time (assert on the *end* state, not the animation
  itself — animations are exactly the kind of thing that makes Playwright
  specs flaky if asserted on directly, per this task's own "flaky test
  waits" audit concern).
- API: modifier-spin board generation is deterministic from seed (mirrors
  existing `test_board_generation_is_deterministic_from_seed`).

**Acceptance criteria:**
- Spin-to-candidates transition completes in under 2 seconds (product spec
  Sec 3.2 budget).
- `prefers-reduced-motion` respected, verified in at least one Playwright
  test with the media feature emulated.
- No score/rank/name leaks during the spin animation before the eligible
  count reveal (a11y tree + DOM text content check, extending the existing
  score-hiding test pattern from `test_perfect_season.py` /
  `courtbuilder.spec.ts`).

---

## Phase 5X.3 — Position-aware CourtBuilder slots

**Note:** the bench slot names below (`sixth_man/defensive_specialist/wildcard`)
and the "real half-court graphic" deliverable were both changed/shipped in
the later "Phase 5X.4" pass, not in this one -- see the Phase 5X.4 naming-
collision callout further down. This section is kept as-shipped-then
history; bench slots actually shipped as plain `bench_1/bench_2/bench_3`,
and the half-court graphic shipped in 5X.4, not here.

**Deliverables:**
- Slot semantics change: `starter_1..5` → `PG/SG/SF/PF/C`; `bench_1..3` →
  `sixth_man/defensive_specialist/wildcard` (product spec Sec 6.1).
- Archetype→position v1 mapping (product spec Sec 6.4b) implemented as a
  pure function, clearly labeled as an approximation in its own docstring
  and in any user-facing "why eligible" text.
- Slot-first round flow: player picks which open slot to fill *before*
  seeing candidates (product spec Sec 3.1 step 2) — this changes
  `action_select_player`'s calling convention (needs a target slot up
  front) rather than the current select-then-place two-step.
- Court UI: real half-court graphic (SVG or styled divs), starters at
  position-relative locations, bench in a distinct rail.
- Off-position placement stays legal (never blocked), now surfaces a
  visible plain-language fit note instead of being silently free.

**Files touched:**
- `nba_peak/perfect_season/config.py` (`SLOT_TYPES` renamed/restructured —
  breaking change to the constant's values, not its count; every reference
  needs updating, not just the constant)
- `nba_peak/perfect_season/schemas.py` (`CourtSlot.slot_type` semantics)
- `nba_peak/perfect_season/board.py` (new position-mapping module, likely
  `nba_peak/perfect_season/positions.py`, keeping `board.py` focused)
- `apps/api/app/services/perfect_season/state.py` (round flow reorder:
  slot-first instead of card-first; eligibility check now also validates
  position fit, not just "not already used")
- `apps/api/app/models/perfect_season.py` (request/response shape changes
  for the reordered flow)
- `apps/web/src/components/court/CourtBuilder.tsx`, `PeakCardCourt.tsx`
  (rewritten for court-relative layout), new `CourtLayout.tsx`
- `apps/web/src/types/perfect-season.ts` (`SlotType` union updated)

**This is a breaking change to the Phase 5C API contract.** Since
`COURTBUILDER_ENABLED` defaults to `False` and nothing has shipped to real
users yet (per ADR-005 Decision 7's own "byte-for-byte unchanged until
flipped" guarantee), this is safe to do as a direct rewrite rather than a
versioned migration — confirm this is still true (no `COURTBUILDER_ENABLED=True`
deployment exists anywhere) before starting.

**Tests required:**
- API: position eligibility (primary/secondary/off-position-with-penalty)
  for every archetype; slot-first flow state transitions; regression that
  "same identity cannot be used twice" and "unconventional lineups remain
  legal" (existing tests) still hold under the new slot semantics.
- Frontend unit: archetype→position mapping pure function, exhaustively
  tested against all 5 archetypes.
- Playwright: full run using real position names in assertions (replacing
  `starter_1`/`bench_1` locators with `PG`/`sixth_man` etc.); off-position
  placement produces a visible fit note, not a blocked action.
- Accessibility: court graphic has an accessible list-view equivalent
  (product spec Sec 4.4), tested via axe + a manual screen-reader-order
  assertion (DOM order matches logical roster order).

**Acceptance criteria:**
- Every one of the 5 archetypes maps to exactly one primary + 0-2
  secondary positions, documented and tested.
- Off-position placement is always legal, never returns an error.
- At least 3 deliberately unconventional lineups (product spec's own bar,
  carried over from Phase 5C's acceptance criteria) remain completable.
- Existing CI baseline stays green; this phase's own new tests pass.

---

## Phase 5X.4 (original) — Player database expansion plan to 500

**Naming collision, flagged explicitly (mirrors the 5X.8 collision callout
further down this document):** a later task independently called its own
work "Phase 5X.4" -- CourtBuilder team/era wheels, a real half-court
layout, plain Bench 1/2/3 slots, and the peak-value-first scoring
correction (see `docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md`'s own
"Correction (Phase 5X.4)" note). That work has SHIPPED, on this same
branch. It is unrelated to the player-database-expansion phase described
below, which remains planning-only under its original name here. Whoever
picks up the actual 500-player expansion next should treat this section's
scope as still open, just aware the "5X.4" label is now ambiguous in this
document's own history -- read commit history / PR #3's description to
disambiguate which "5X.4" a given change belongs to.

**This phase is the parallel data track — see
`docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md` for the full plan.**
Summarized here only for sequencing context:

**Deliverables (from the strategy doc, not re-derived here):**
- Cohort-based candidate list for the 250→500 expansion, auditable and
  reviewable before any data is scraped.
- Position field (`primary_position`/`secondary_position`) sourced per
  player-season — a new field, not currently present anywhere in the
  pipeline (verified this session — same gap ADR-005 already documented
  for team affiliation, extended here to cover position too).
- Team-season roster membership data for the expanded pool, following the
  `nba_peak/data_complete.py` scrape-once/cache/never-scrape-at-request-time
  pattern already established for award votes and team shares.
- QA/audit process (duplicate detection, minimum-candidates-per-team-decade
  threshold, manual exception review) before any of it reaches gameplay.

**Files touched:** primarily new `nba_peak/`/`data/generated/` pipeline
code and `scripts/` — see the strategy doc's own file list.

**Gating relationship to other phases:** does not block 5X.1-5X.3, 5X.5-5X.7.
Gates only the decision to make team+decade spins the **default** (as
opposed to labeled-narrow-coverage) experience — see the "Sequencing"
section above.

---

## Phase 5X.5 (original) — Improved search/card selection

**Naming collision — see the Phase-label collision log at the top of this
document.** "Phase 5X.5" was reused for a wheel-coverage bug-fix and
half-court visual-polish pass. This section's original scope is below,
unchanged, still planning-only (though the card-based candidate UI it
describes overlaps somewhat with the eligible-player-search polish already
shipped -- position badges, "Plays X" labels -- under the reused label).

**Deliverables:**
- Card-based candidate UI (product spec Sec 4.2) replacing the current
  plain-button list — larger touch targets, position badge, qualitative
  trait tags (derived from existing `LineupDNA` thresholds, e.g.
  "Elite Passer" from high `primary_creation`), team/era context.
- Search/filter behavior scales correctly once candidate pools grow past
  the current 1-3 (Phase 5X.4 dependency for *content*, not for the UI
  component itself, which should be built and tested against synthetic
  larger candidate lists in the meantime).
- Trait-tag vocabulary is a small, fixed, versioned list (avoid an
  unbounded tag system that becomes its own maintenance burden) — derive
  from existing `LineupDNA` dimensions plus the new position data, not
  from freeform scouting text.

**Files touched:**
- `apps/web/src/components/court/EligiblePlayerSearch.tsx` (rewritten as
  card-based), new `CandidateCard.tsx`
- `nba_peak/perfect_season/board.py` or a new `traits.py` (qualitative
  trait derivation from existing DNA thresholds)

**Tests required:**
- Frontend unit: trait derivation is a pure function, tested against known
  DNA inputs → expected trait sets.
- Playwright: search/filter still returns correct results with larger
  synthetic candidate lists (10+, to stress-test beyond today's 1-3);
  score-hiding contract re-verified on the new card component (no
  regression of the Phase 5C hardening pass's core guarantee).
- Accessibility: card grid/list is screen-reader-navigable, trait tags
  have text alternatives (not color-only).

**Acceptance criteria:**
- No numeric score/rank anywhere in the candidate UI, verified by the same
  API + frontend + E2E triple-check pattern already established in Phase
  5C (`test_current_spin_candidates_never_expose_score_or_rank` and its
  Playwright equivalent).
- Trait tags are derived, versioned, and documented — never hand-authored
  per player (would violate the "no manual scouting without provenance"
  discipline already established for attributes in the master plan §10.4).

---

## Phase 5X.6 (original) — Lineup-fit engine v1

**Naming collision — see the Phase-label collision log at the top of this
document.** "Phase 5X.6" was reused for an unrelated product-direction-reset
pass. This section's original scope is below, unchanged, still planning-only.

**Superseded in part by the "Phase 5X.4" pass (see the naming-collision
callout above):** `LineupFitComponents`/`compute_fit_components` were
already extended, but NOT with the bonus/penalty taxonomy from product spec
Sec 6.3/6.4 below -- that taxonomy was reviewed and rejected as an
"anti-GOAT"/role-redundancy mechanic PEAK3 must not have (see the product
spec's own Phase 5X.4 correction note). What shipped instead: `bench_strength`
and `positional_fit`, both peak-value-and-real-constraint-based, no
archetype-count penalties. If this phase is picked up again, do not
resurrect Sec 6.3/6.4's taxonomy as originally written -- any future
extension of `LineupFitComponents` must preserve the "no penalty for having
too much elite talent" invariant.

**Deliverables:**
- Extend `nba_peak/perfect_season/simulation.py::LineupFitComponents` and
  `compute_fit_components` with the position-aware bonuses/penalties from
  product spec Sec 6.3/6.4.
- Reuse `nba_peak/lineup/config.py::SYNERGY_RULES`'s existing pattern and,
  where a rule already exists there (`creator_anchor_balance`,
  `creation_overload`, `no_lead_creator`, `no_anchor`, `scoring_desert`,
  `scoring_depth`, `validation_core`), **extend it to CourtBuilder's
  8-slot position-aware context rather than re-deriving equivalent logic
  from scratch.** New rules (too small, too slow, no bench creation, rim
  pressure, switchable defensive group) are net-new but follow the exact
  same declarative rule shape.
- Every "too small"/"too slow" rule ships with an explicit data-constraint
  disclosure in its description field (no real height/weight/speed data
  exists — these are archetype-mix proxies, not measurements), matching
  the existing honesty pattern in `docs/model/LINEUP_DNA_V2.md`.

**Files touched:**
- `nba_peak/perfect_season/simulation.py` (extended)
- `nba_peak/perfect_season/config.py` (new rule constants, mirroring
  `nba_peak/lineup/config.py::SYNERGY_RULES`'s shape)
- Possibly a new shared module if enough rule logic is genuinely
  reusable between Peak Draft's lineup model and CourtBuilder's — evaluate
  at implementation time; do not force a shared abstraction prematurely if
  the two contexts (5-role vs. 8-slot-position) diverge enough that a
  shared module would need more conditionals than it saves.

**Tests required:**
- Unit tests for every new/extended rule: a synthetic lineup that should
  trigger it, and one that shouldn't, per rule (mirrors the rigor of
  existing Peak Draft synergy-rule tests).
- Regression: existing `test_perfect_season.py` fit-component tests still
  pass with the extended component set (field additions, not removals —
  should be additive to `LineupFitComponents`' dataclass).
- Adversarial: fuzz a large number of random valid 8-slot rosters and
  confirm no rule ever produces a nonsensical (NaN, wildly out-of-range)
  score — same discipline as the existing `scripts/check_board_generation.py`
  smoke check, extended to fit-scoring rather than just board validity.

**Acceptance criteria:**
- Every bonus/penalty in product spec Sec 6.3/6.4 is implemented, tested,
  and displayed with a plain-language description at the broadcast reveal.
- No component is ever a single opaque number without a label (ADR-005
  Decision 4, unchanged).

---

## Phase 5X.7 (original) — Result / reveal / share screen

**Naming collision — see the Phase-label collision log at the top of this
document.** "Phase 5X.7" was reused for the CourtBuilder product-rejection-
response pass (2026-07-23). This section's original scope is below; the
deferred-reveal contract change described here already shipped (under the
5X.4 reuse, see the Status line at the top of this document) — the
remaining loss-timeline/share-card pieces are still planning-only.

**Deliverables:**
- Broadcast reveal sequence (product spec Sec 3.1 step 7): full roster
  score reveal → fit breakdown → record count-up → loss timeline → framing
  → share card.
- **API contract change:** `slots[]` no longer includes
  `individual_peak_score`/`individual_peak_rank` until
  `status == "result_ready"` — even for already-filled slots mid-run. This
  is the single change that fixes the "answer-key" complaint (product spec
  Sec 1.2/3.5). Requires updating `state.py::get_public_state` and every
  test that currently asserts scores appear on locked slots mid-run
  (`test_placed_slots_do_reveal_score_once_locked` needs to be
  **rewritten**, not just extended — its current assertion is exactly the
  behavior this phase removes).
- Loss timeline: pseudo-random distribution of losses across an 82-slot
  strip, deterministic from the board seed, explicitly labeled as
  presentational (product spec Sec 3.6) — not a claim of 82 individually
  simulated games.
- Share card: static image (implementation detail — server-side render via
  an image library, or client-side canvas — decide based on what's
  actually available in the stack without adding a heavy new dependency;
  this is a real open implementation question, not pre-decided here).

**Files touched:**
- `apps/api/app/services/perfect_season/state.py` (reveal-timing contract
  change)
- `apps/web/src/components/court/SeasonResultStub.tsx` → rewritten as
  `ResultBroadcast.tsx`, new `LossTimeline.tsx`, new `ShareCard.tsx`
- `apps/api/tests/test_perfect_season.py` (rewrite the mid-run score
  visibility test to assert the *new*, opposite contract)
- `apps/web/src/tests/e2e/courtbuilder.spec.ts` (same)

**Tests required:**
- API: exact-score/rank absent from `slots[]` for every status except
  `result_ready` — new test, and the old contrary test removed/rewritten
  (do not leave both asserting opposite things).
- Playwright: full run confirms zero numeric score/rank anywhere until the
  broadcast reveal begins; share card generation succeeds and contains no
  spoiler list of "optimal" alternatives (product spec Sec 3.7).
- Visual/manual: broadcast sequence is skippable, and skipping still
  leaves the full breakdown reachable afterward (no information loss from
  skipping, only animation time).

**Acceptance criteria:**
- The single most important regression test in this whole overhaul: **no
  score or rank is visible anywhere before `status == "result_ready"`,
  full stop** — verified at the API, frontend-render, and E2E layers, the
  same triple-check discipline already used for pre-selection hiding in
  Phase 5C, now extended to cover the entire run, not just the moment
  before each pick.

---

## Phase 5X.8 — Daily 82 and leaderboard (later)

Not started in this overhaul. Placeholder phase number preserved for
continuity with the original Phase 5 roadmap
(`docs/product/PEAK3_NEXT_AMBITIOUS_STEPS.md` §10's own "5D" row covered
this exact scope before this overhaul plan reused the "5D" prefix for a
different purpose — **naming collision, flagged explicitly**: the original
roadmap's "Phase 5X — Daily 82 and result sharing" is renumbered here as
5X.8 to fit inside this document's own phase sequence; anyone cross-
referencing the original roadmap table should treat this document's 5X.8
as that same scope, now sequenced after the overhaul rather than
immediately after Phase 5C).

**Deliverables (unchanged from the original roadmap row, restated for
continuity):** daily immutable boards, official/practice attempt split,
global/friends leaderboards, streaks, Locker Room shelves, playable
challenge links, archive. Requires the `result_snapshots`/`daily_completions`
schema work explicitly deferred in `PHASE_5_COURTBUILDER_VERTICAL_SLICE.md`
§0 item 2 (those tables carry Peak-Draft-specific `NOT NULL` columns that
don't fit CourtBuilder without an actual migration).

**Not scoped further in this document** — write a dedicated implementation
doc when this phase actually starts, grounded in whatever the overhaul
(5X.1-5X.7) actually shipped, not speculatively now.

---

## Phase 5X.9 — Ranked/multiplayer (later)

Not started in this overhaul. Depends on 5X.8 (needs durable history) and
on 82-0 proving repeat-play value in real usage first, per master plan
§18.9's sequencing discipline (still binding, unchanged). Not scoped
further in this document for the same reason as 5X.8.

---

## Technical architecture summary

### What reuses current CourtBuilder code as-is

- Feature-flag pattern (`COURTBUILDER_ENABLED`/`COURTBUILDER_TEAM_SPIN_ENABLED`/
  `COURTBUILDER_ALPHA_ALLOWLIST`/`COURTBUILDER_READINESS_LEVEL`) — no
  changes needed, new sub-flags are additive (see below).
- `CourtLineupRepository` + the `games` table reuse pattern (Phase 5C
  established this requires zero migrations; still true — the overhaul
  changes payload *shape*, not storage *mechanism*).
- Board seed derivation and the backtracking feasibility check
  (`_can_assign_distinct` in `board.py`) — directly reusable, position
  constraints are an additional filter on top, not a replacement algorithm.
- `owner_sub`/`resolve_owner_sub` anonymous-identity flow — unchanged.
- The existing `SYNERGY_RULES` declarative pattern in
  `nba_peak/lineup/config.py` — extended, not replaced.

### What gets rewritten

- `SpinStage.tsx` → full rewrite (animation state machine).
- `EligiblePlayerSearch.tsx` → full rewrite (card-based, position-aware).
- `PeakCardCourt.tsx`/`CourtBuilder.tsx` → substantial rewrite (court-
  relative layout, slot-first flow).
- `SeasonResultStub.tsx` → full rewrite as `ResultBroadcast.tsx`.
- `state.py::get_public_state`'s reveal-timing logic — the single most
  consequential backend rewrite in this plan.
- `nba_peak/perfect_season/config.py::SLOT_TYPES` — restructured (position
  semantics).

### What gets deleted later, not now

- The `starter_N`/`bench_N` slot-type strings, once 5X.3 ships and nothing
  references the old values (grep-verify zero remaining references before
  deleting, including in test fixtures and any committed example JSON).
- Nothing else — this overhaul is additive/rewrite, not a deletion pass.
  Peak Draft stays fully intact per ADR-005 Decision 2, unchanged by this
  plan.

### New feature flags for overhaul stages

Extend the existing `COURTBUILDER_*` settings rather than inventing a
parallel flag family:

```python
COURTBUILDER_POSITION_SLOTS_ENABLED: bool = False
    # Gates 5X.3's slot-semantics change. Independent of
    # COURTBUILDER_ENABLED so 5X.1/5X.2 can ship and be tested with the
    # old slot shape still active if 5X.3 isn't ready yet.

COURTBUILDER_DEFERRED_REVEAL_ENABLED: bool = False
    # Gates 5X.7's reveal-timing contract change specifically -- kept
    # separate from COURTBUILDER_POSITION_SLOTS_ENABLED because these two
    # phases have independent risk profiles and either could need to ship
    # or roll back without the other.
```

Do not add a flag per sub-phase mechanically — 5X.1 (IA), 5X.2 (spin
animation), 5X.5 (card UI), and 5X.6 (fit engine) are presentation/content
changes with no meaningful "off" state once `COURTBUILDER_ENABLED` is on;
flagging them separately would add validation-matrix complexity (per the
existing `@model_validator` consistency-checking pattern in `config.py`)
without a real rollback benefit.

### Backend services needed

- Position-eligibility resolver (`nba_peak/perfect_season/positions.py`,
  new).
- Extended lineup-fit engine (Sec 5X.6).
- Trait-tag derivation (Sec 5X.5).
- Loss-timeline distribution function (deterministic, presentational, Sec
  5X.7).
- Share-card generation (Sec 5X.7 — implementation approach TBD at that
  phase).

### Frontend components needed

`SpinCeremony` (replaces `SpinStage`), `CourtLayout` (new, position-
relative court graphic), `CandidateCard` (replaces the button list inside
`EligiblePlayerSearch`), `ResultBroadcast` (replaces `SeasonResultStub`),
`LossTimeline` (new), `ShareCard` (new). `LineupInsightPanel` survives with
extended fields, not a rewrite.

### Test strategy across the whole overhaul

- Every phase above lists its own required tests; the cross-cutting rule
  is: **the reveal-timing contract (5X.7) gets the same triple-check rigor
  (API assertion + frontend render assertion + Playwright E2E assertion)
  that the pre-selection hiding contract already has from Phase 5C** — this
  is the single highest-value regression surface in the entire overhaul.
- Existing Peak Draft test suites (`gameplay.spec.ts`, `test_draft.py`,
  etc.) must stay green throughout — this overhaul touches zero Peak Draft
  code, so any failure there indicates an accidental regression, not
  expected fallout.
- Full CI baseline (model + API + frontend + Playwright) re-verified at the
  end of each numbered sub-phase before starting the next, not just once
  at the end of the whole overhaul — catches regressions close to their
  cause.
