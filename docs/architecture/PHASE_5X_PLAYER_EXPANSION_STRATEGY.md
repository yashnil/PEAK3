# Phase 5X — Player Database Expansion Strategy (250 → 1000)

**Status:** Strategy/design only. No scraping, no data acquisition, no new
files under `data/generated/`, `data/web/`, or `data/game/` are created by
this document. No player names in this document represent confirmed,
model-validated additions — every specific name below is an **illustrative
candidate for the cohort-review process**, not a committed inclusion.
**Depends on:** `docs/architecture/PHASE_5_DATA_MODEL.md` (entities 1-4:
`player_identity`, `team_identity`, `team_season`, `team_season_roster_member`
— this document operationalizes those entities toward a concrete 1000-player
target; it does not redefine them).
**Companion:** `docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md` Sec 8,
`docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md` (Phase 5X.4 original
scope, and the new Phase 5X.6 "Product Direction Reset" section),
`docs/architecture/PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md` (team/player
imagery — photo/icon coverage is one of this document's QA gates, Sec 7).

**Target raised from 500 to 1000 (Phase 5X.6, 2026-07-22).** The 500-player
figure was never a ceiling, just the first named milestone (Sec 2.3 always
listed "1,000-player v2" as a later stage) — this revision makes 1000 the
actual staged target and restructures Sec 2 accordingly. Nothing about the
inclusion methodology (Sec 2.2's cohorts) changes; the staged targets and
launch-scope numbers in Sec 2.3/4.2 do.

**Audit findings that motivate this document, in chronological order:**

1. **Phase 5X.5 (wheel-coverage audit):** two players already named in the
   interim team-season dataset — Michael Cooper and Jaylen Brown — have
   `profile_status='excluded'` for every duration in `card_profiles.v3.json`,
   meaning they were in the 250-player pool's raw data but never actually
   resolvable as a playable candidate. This silently starved 3 team-era
   entries down to a single candidate, and (before a separate
   board-generator fix) made 2 whole franchises essentially never appear on
   the wheel. Fixed by swapping in real, resolvable teammates. **Lesson:**
   `profile_status='excluded'` rows exist in the current pipeline for
   players who don't clear the model's data-completeness bar, and any
   future team-era mapping (interim or the eventual real
   `team_season_roster_member` data) must cross-check against resolvable
   status, not just "is this player's slug anywhere in card_profiles.v3.json."
2. **Phase 5X.6 (Jrue Holiday audit, explicitly requested, inspected not
   assumed):** does Jrue Holiday exist in the 250-player data, and why does
   he/doesn't he appear for 2020s Celtics? **Finding, from direct
   inspection of `card_profiles.v3.json` and the interim dataset:** yes, he
   exists and is resolvable — `profile_status='verified_data_derived'` at
   3yr/5yr durations (`excluded` at 1yr/2yr, an honest per-duration gap,
   not a bug). Before this audit he appeared **only** under `bucks-2020s`
   in the interim dataset, reflecting his real 2020-2023 Milwaukee tenure
   and 2021 championship. He was **missing** from `celtics-2020s` even
   though he was traded to Boston in September 2023 and started for the
   2024 champion Celtics — a second, equally real team affiliation the
   dataset simply hadn't captured yet. Fixed by adding him to
   `celtics-2020s` too (dataset bumped to v3); a player_slug legitimately
   appearing under more than one team-decade entry in the same decade
   reflects a real mid-decade trade, not a duplicate-data error. **Lesson:**
   the interim (and eventual real) team-season data model must support a
   player having multiple team affiliations within one decade, and manual
   curation passes need a systematic way to check "did this player change
   teams mid-decade in a way that matters" rather than relying on whoever
   is curating that entry to happen to remember.

---

## 1. Why 250 is insufficient — the actual mechanism, not just the symptom

The current 250-player pool (`data/game/profiles/card_profiles.v3.json`,
sourced from `leaderboards/*.csv`) is an **all-time top-N cohort selected
by peak score**, built for a completely different purpose than CourtBuilder
needs: ranking the greatest individual peaks in NBA history for Peak
Draft's offer-card pool, where the question is "how good was this window,"
full stop, independent of team or era context.

Team+decade CourtBuilder asks a structurally different question: "who was
*meaningfully on this team, in this era*, good enough to be a real choice."
That is an intersection of two independent filters (team, decade) applied
to a pool that was never selected with either filter in mind. Intersecting
two arbitrary filters against a small, score-sorted-only pool produces
exactly what we measured this session against the committed interim
dataset:

| Team + decade | Eligible candidates in current 250-pool |
|---|---|
| San Antonio Spurs · 1990s | 1 |
| Golden State Warriors · 2015-16 (exact season) | 1 |
| Los Angeles Lakers · 2000s | 2 |
| San Antonio Spurs · 2000s | 2 |
| Golden State Warriors · 2010s | 2 |
| Chicago Bulls · 1990-91 (exact season) | 2 |
| Chicago Bulls / Lakers 1980s / Celtics 1980s / Celtics 2000s | 3 each |

**Average 2.4 candidates per spin, with a floor of 1.** This isn't a
data-quality bug — it's the mathematically expected result of applying a
narrow all-time cutoff to a per-team-per-decade slice. A typical
championship-caliber team from any era usually has 8-12 rotation players;
an all-time top-250 cutoff (out of the ~5,000+ players who have played in
the NBA) will, by construction, usually only clear 1-4 of them, because
most excellent role players, defensive specialists, and connective bench
pieces — precisely the players who make a real roster feel textured — do
not have all-time-top-250-caliber peak scores even though they were
clearly good enough to matter on a specific great team.

**CourtBuilder cannot feel good with only 250 players because the game's
core verb (choose a teammate for this team/era) requires depth *within*
narrow slices, and the 250-pool was never selected for slice-depth — it
was selected for absolute peak height.** No UI redesign fixes this; it is
a content problem, not a presentation problem.

## 2. Target: staged expansion to 1000 players

### 2.0 Inclusion vision (Phase 5X.6 — restated as explicit, checkable criteria)

Include every player, since the model's starting season, who matches **at
least one** of:

- averaged 15+ PPG in any season
- made an All-Star team
- received MVP votes (any amount, any year)
- made an All-Defensive team
- started on a championship team
- was a key championship role player (meaningful rotation minutes on a
  title team, even off the bench — "key" is a manual-review judgment call,
  documented per Sec 6, not automatable)
- averaged 30+ MPG in any season
- important manual exceptions for basketball-history relevance (Cohort E,
  Sec 2.2 below — e.g. a player whose statistical record undersells their
  historical importance)

This restates and sharpens Sec 2.2's existing Cohort A-D framework (below)
into criteria that are individually checkable against public box-score/
award data, rather than only described in prose. The cohort framework
remains the *process* (how a candidate gets reviewed and documented); this
list is the *filter* (who becomes a candidate in the first place). Every
inclusion still requires a cohort assignment and provenance note (Sec 6) —
matching one of these criteria makes a player a candidate, not an
automatic inclusion.

### 2.1 Selection criterion change

The current pool's selection criterion (top-N by peak score, unconditioned
on team/era) stays as the source for Peak Draft/Index. The **expansion**
adds players via a **team/era-coverage-aware** cohort process — not simply
"lower the score cutoff and add the next 250 highest scorers," which would
still fail to guarantee any specific team-decade has enough depth (the
next 250 by score are disproportionately more all-time-great players from
already-well-covered teams/eras, not the specific role players narrow
slices are missing).

### 2.2 Inclusion cohorts (adapted from master plan §11.3, sharpened with an
explicit coverage gate)

**Cohort A — mandatory recognized players.** Every All-NBA selection,
every All-Star, every All-Defensive selection, MVP/DPOY/ROY/MIP/6MOY
finalists, in the supported period, not already in the 250-pool. This is
the highest-confidence, lowest-controversy cohort — auditable directly
against public award records, no model judgment required for inclusion
(their inclusion is award-based, not peak-score-based).

**Cohort B — championship/playoff rotation impact.** Major rotation
players (meaningful minutes, not cameo appearances) on championship and
Finals teams; high-impact playoff specialists; players whose value is
underrepresented by All-Star-level accolades but who were clearly
important to a specific title run.

**Cohort C — model-identified impact players.** High BPM/VORP/WS-caliber
seasons (using the *existing* advanced-metric context already computed in
`data/generated/player_season_context.parquet`) without All-Star
recognition; elite specialists in a single dimension (shooting, defense,
playmaking, rebounding) even without broad statistical dominance.

**Cohort D — the coverage-gate cohort (new in this document, not directly
in the master plan's original list).** For every team-decade and
exact-team-season combination intended for **Competitive Core** launch
coverage (Sec 4 below), if Cohorts A-C together do not clear the minimum
candidate threshold (Sec 4.1), add the next-most-defensible candidates
specifically *for that slice* — franchise-important starters, statistically
solid rotation players, or historically notable role players — reviewed
individually, not filtered by a global score cutoff. This cohort exists
specifically to fix the mechanism described in Sec 1, not as a catch-all.

**Cohort E — manual exceptions.** Documented, individually-reviewed
additions whose importance isn't captured by any filter above (the master
plan's own example: Lamar Odom). Every Cohort E addition requires a
written one-paragraph justification in the audit trail (Sec 6) — never a
silent add.

### 2.3 Staged targets

Three stages, each a real gate the next stage depends on, not just a
milestone number:

1. **250 current (baseline).** The existing all-time top-N pool. Already
   shipped, already has the "slice depth" problem Sec 1 describes.
2. **500 — quality gate.** Not a bigger version of 250, a **process
   validation stage**: prove the Cohort A-E methodology (Sec 2.2), the QA
   process (Sec 7), and the coverage-gate test (Sec 8) all work correctly
   at a scale small enough to hand-verify thoroughly (Sec 7 item 6's
   30-player manual spot-check is ~6% of 500, a defensible sample; it would
   be ~3% of 1000, a thinner one). Prioritize Cohorts A and B first
   (highest confidence, award-based), then Cohort D specifically against
   the launch team-decade list (Sec 4) to close coverage gaps, then Cohort
   C to round out remaining budget, then Cohort E as individually-reviewed
   additions throughout. **Gate to clear before proceeding to 1000:** the
   full Sec 7 QA process passes clean on the 500-player set, with zero
   unresolved findings (not "findings fixed post-hoc" — clean on first
   full pass, since the same process runs again, unchanged, at 1000 scale).
3. **1000 — target.** The actual expansion goal (raised from 500 in Phase
   5X.6 — see the top-of-document note). Same cohort methodology, same QA
   process, run again at roughly double the scale, prioritizing broader
   team-decade coverage (more franchises, more decades clearing the
   Sec 4.1 candidate-depth gate) over deepening already-well-covered
   slices further.
4. **Full team-season roster ingestion** (later, separate project, beyond
   1000): every rostered player for every team-season in the supported
   period, primarily for PEAK3 Index research value and Extended
   Archive/Labs-tier CourtBuilder content — not required for Competitive
   Core team+decade gameplay to work well, which only needs the
   1000-player expansion's depth.

## 3. Required source tables

Restated (Phase 5X.6) as an explicit table-by-table list, matching what
the inclusion vision (Sec 2.0) and QA process (Sec 7) actually need to
check against. All sourced via the existing `nba_peak/data_complete.py`
scrape-once/cache/never-scrape-at-request-time pattern already established
for award votes and team shares — no new acquisition mechanism, just more
tables through the same pipe.

| Table | Purpose | Status |
|---|---|---|
| **Player seasons** | One row per player-season: the base unit everything else joins to | Exists (`data/generated/player_season_context.parquet` and predecessors) |
| **Team rosters** (`team_season_roster_member`) | Which players were on which team, which season — the core join for team-decade eligibility | Gap, scoped in `PHASE_5_DATA_MODEL.md` entity 4, not yet sourced |
| **Minutes/game** | Feeds the 30+ MPG inclusion criterion (Sec 2.0) | Partially exists in advanced-metric context; verify per-season coverage before relying on it as an inclusion gate |
| **Points/game** | Feeds the 15+ PPG inclusion criterion (Sec 2.0) | Exists (traditional box-score stats already power `traditional_production`) |
| **Awards** (general) | MVP/DPOY/ROY/MIP/6MOY winners and finalists | Exists (already powers `individual_recognition`) |
| **All-Star selections** | Feeds the All-Star inclusion criterion | Exists |
| **All-Defense** | Feeds the All-Defensive inclusion criterion | Exists |
| **MVP votes** | Feeds the "received MVP votes" inclusion criterion — note this is broader than MVP *finalists* (Cohort A originally said "finalists"; Sec 2.0's restated criterion is "received votes," any amount) | Exists (vote-share data already referenced for `individual_recognition`) — confirm any-vote-share granularity, not just top-5/finalist granularity, is actually retained |
| **Playoff/championship starters** | Feeds "started on a championship team" and the Cohort B championship-rotation criterion | Partially exists (postseason box scores exist; explicit "was this player a starter on a title team" is a derived join, not a stored field yet) |
| **Team-season membership** | Same as "team rosters" row above — listed twice in the original task enumeration, one table | (see above) |
| **Positions** (`primary_position`/`secondary_position`) | **Not previously identified as a gap** in any prior Phase 5 document; surfaced by the position-slot redesign (`ARENA_OVERHAUL_PRODUCT_SPEC.md` Sec 6) and sharpened by the Phase 5X.6 "Duncan/Shaq play PG" bug (Sec 0 of this document's predecessor addendum). Source: Basketball-Reference's per-player-season position field, same scrape pattern as team rosters — source in the same pass to avoid two acquisition efforts hitting the same pages. |

**Positions and team rosters apply to the existing 250-pool too, not just
the expansion** — today's 250 players have no real position data either,
which is why `nba_peak/perfect_season/positions.py::POSITION_OVERRIDES`
(Phase 5X.6) is a *manual* stopgap for the ~40 players currently reachable
in the game, not a substitute for sourcing this table for real. Once this
table exists, `POSITION_OVERRIDES` is deleted (not migrated — same
discipline as the interim team-season dataset itself), and every player in
the pool (not just the manually-covered ones) gets a real, source-derived
position.

## 4. Minimum expansion needed for team/decade gameplay to work

### 4.1 The coverage acceptance gate

**Every team-decade or exact-team-season combination approved for
Competitive Core launch must resolve to at least 5 distinct eligible
candidates at each supported duration (1Y/3Y/5Y).** Below 5, a real choice
doesn't exist (the current 1-2 candidate spins are exactly the failure
mode this gate exists to prevent). This is a testable, automatable gate
(Sec 7), not a subjective judgment call at launch time.

Team-decades that don't clear this gate after the full cohort process stay
**Extended Archive/Labs-tier** (reachable, clearly labeled as
lower-coverage, not offered in the default spin pool) — mirrors the
existing pool-tier concept from master plan §11.6, applied concretely here.

### 4.2 Launch coverage scope (illustrative, not committed)

Rather than attempting broad historical coverage in v1, prioritize a
curated set of ~15-25 iconic team-decade/season combinations most likely
to appear in default spins, expand each to clear the 5-candidate gate,
and grow breadth over time (v2/1,000-player target). This keeps the QA
burden (Sec 6-7) tractable for a first release instead of attempting to
validate hundreds of slices at once.

## 5. Worked examples (illustrative candidates only — not confirmed additions)

### 5.1 2010s Golden State Warriors

**Currently in pool:** Stephen Curry, Kevin Durant (2 candidates).

**Missing, and why they matter for this exact team/era:** Klay Thompson
(All-NBA, elite two-way wing, core of the dynasty), Draymond Green (DPOY,
the connective/defensive engine the current bonus taxonomy explicitly wants
to reward — Sec 6.1's "Defensive Specialist" bench slot and "switchable
defensive group" bonus in the product spec are close to unusable for this
team without him), Andre Iguodala (Finals MVP, elite low-usage connector —
exactly the "complementary usage profile" archetype the fit engine rewards).
All three are Cohort A (All-NBA/major-award) or Cohort B (Finals MVP,
championship rotation) candidates — high-confidence, not speculative.

### 5.2 1990s San Antonio Spurs

**Currently in pool:** David Robinson (1 candidate).

**Missing, illustrative Cohort C/D candidates worth reviewing** (not
statistically pre-validated in this document — real peak scores for these
players have not been computed here and must go through the actual model
pipeline before any inclusion decision): Sean Elliott (All-Star, long-time
Robinson running mate), Avery Johnson (starting point guard across the
mid-to-late 90s Spurs), Vinny Del Negro, Terry Cummings (early-90s
frontcourt piece). These names illustrate the *kind* of player Cohort D
exists to find — solid, franchise-relevant rotation pieces below an
all-time cutoff — not a pre-approved list.

### 5.3 1980s Los Angeles Lakers

**Currently in pool:** Magic Johnson, Kareem Abdul-Jabbar, James Worthy (3
candidates — already the pool's best-covered decade slice, still short of
a genuinely deep roster feel).

**Missing, illustrative Cohort A/C candidates:** Michael Cooper (Defensive
Player of the Year, 1987 — an exact, concrete match for this overhaul's
"Defensive Specialist" bench slot and "no rim protection"/defensive-backbone
mechanics), Byron Scott, A.C. Green, Norm Nixon. Cooper in particular is
worth flagging as a strong Cohort A candidate (a major individual award,
DPOY) that the current all-time-peak-score cutoff apparently excludes —
exactly the mechanism Sec 1 describes.

## 6. Manual exception policy

- Every Cohort E (and any Cohort D addition that isn't a clean award-based
  Cohort A match) requires a short, committed, human-readable justification
  — a markdown or CSV audit trail alongside the expansion script output,
  not a silent data change.
- Justifications cite public, checkable facts (awards, statistical
  leadership, specific team/season context) — never "feels important."
- Exceptions are reviewable and revertible: the expansion is versioned
  (`player_universe_versions`, per `PHASE_5_DATA_MODEL.md`), so a
  disputed inclusion can be corrected in a later version without silently
  rewriting history for boards already generated against the prior
  version (same immutability principle ADR-001/ADR-005 already establish
  for boards and cards).

## 7. QA / audit process

Before any expanded data reaches gameplay (i.e., before `card_profiles.v3.json`'s
successor or a new versioned artifact is wired into `nba_peak/perfect_season/board.py`):

1. **Duplicate-identity check** — no two entries resolve to the same real
   person under different slugs (name variants, suffix handling, etc.).
2. **Coverage-gate check** — automated: every Competitive Core team-decade/
   season in the launch scope (Sec 4.2) has ≥5 eligible candidates at every
   supported duration; fail the build if not.
3. **Cross-reference against existing rankings** — the expansion must not
   silently change any existing top-N ranking in `leaderboards/*.csv`
   (unchanged file, unchanged model, per ADR-005 Decision 3) — this is a
   sanity check that the expansion pipeline only *adds* rows, never
   recomputes existing ones.
4. **Position-field sanity check** — every expanded player-season has
   exactly one primary position from the standard 5, and 0-2 secondary
   positions from a small controlled vocabulary (no freeform text).
5. **Team-season membership sanity check** — every membership row
   references a real, resolvable `team_season`; traded-season attribution
   is explicit (primary/secondary team), never ambiguous.
6. **Manual spot-check** — a human reviews a random sample (suggested: 30
   players at the 500 quality-gate stage, ~6%; a proportionally larger
   sample at 1000, since the same 30-player absolute count would drop to
   ~3% coverage) against public records before the expansion is considered
   launch-ready.
7. **Provenance completeness** — every row has a non-empty
   `source_provenance` field (matches the discipline already enforced for
   the interim CourtBuilder dataset's `source_provenance` notes).
8. **No `profile_status='excluded'` players in eligibility** (Phase 5X.6,
   directly motivated by the Sec 0 audit finding above) — automated: for
   every player-season the expansion adds to a team-decade/exact-season
   interim (or eventual real) mapping, verify its `profile_status` is not
   `excluded` at the duration(s) that mapping claims to use it at. A player
   named in a team-era mapping but unresolvable at every duration is
   exactly the Michael Cooper / Jaylen Brown failure mode this check
   exists to catch automatically instead of by manual audit next time.
9. **Photo/icon fallback coverage** (Phase 5X.6, ties to
   `docs/architecture/PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md`) — every
   player in the expanded pool resolves to *something* renderable (a real
   photo if licensed and available, otherwise the initials/silhouette
   fallback badge) — never a broken image or a blank card. This is a
   frontend/asset-manifest concern, not a data-correctness one, but belongs
   in the same pre-launch QA pass since it's checked against the same
   player list.
10. **Candidate count per team+decade** — restates the Sec 4.1 coverage
    gate as an explicit QA-pass line item: re-run `coverage_summary()`
    (`nba_peak/perfect_season/board.py`, added Phase 5X.5) against the
    expanded pool for every mode/duration and confirm no Competitive Core
    team-decade regresses below its prior candidate count. Distinct from
    item 2 above (which gates the *launch* coverage scope specifically) —
    this one guards against the expansion accidentally *removing* depth
    anywhere, not just failing to add enough.

## 8. Tests needed before using expanded data in gameplay

- **Schema validation tests** — every new entity (`player_identity`,
  `team_identity`, `team_season`, `team_season_roster_member`) round-trips
  through its Python representation without data loss (mirrors the
  existing `nba_peak.lineup.board::CardProfile.from_dict` pattern).
- **Cohort auditability tests** — every included player-season resolves to
  exactly one documented cohort (A-E); a test fails the build if any row
  has no cohort justification.
- **Duplicate-identity tests** — automated version of Sec 7 item 1, run in
  CI, not just at expansion time.
- **Coverage-gate tests** — automated version of Sec 7 item 2, run in CI
  against the launch team-decade list; this becomes a permanent regression
  test (future data corrections must not silently drop a team-decade below
  the 5-candidate floor).
- **No-excluded-status-in-eligibility tests** — automated version of Sec 7
  item 8; run in CI against every interim team-era mapping.
- **Photo/icon fallback coverage tests** — automated version of Sec 7 item
  9; confirms every player in the pool resolves to a manifest entry or the
  documented fallback, per `PHASE_5X_ASSET_AND_IDENTITY_STRATEGY.md`.
- **Existing-ranking stability tests** — extends the existing pattern in
  `apps/api/tests/test_regression.py`/`tests/test_leaderboards.py` (rank-1
  and top-10 regression checks) to confirm the expansion never perturbs
  `leaderboards/*.csv`-derived rankings.
- **Board-generation smoke test** — extends
  `scripts/check_board_generation.py`'s existing pattern to run against
  the expanded pool at scale (thousands of seeds) before considering the
  expansion gameplay-ready, catching any pathological interaction between
  the larger pool and the existing feasibility-check (`_can_assign_distinct`)
  logic.

## 9. Explicit non-goals for this document

- No scraping, no new committed data files — this is a strategy document.
- No changes to `OFFICIAL_WEIGHTS`, `calibrate_score()`, or any existing
  `leaderboards/*.csv` row.
- No hosted Supabase, no migrations (all of this stays local-file/local-DB
  scoped, same as the rest of Phase 5's data work per ADR-005 Decision 8).
- No commitment to any specific named player's inclusion — every name in
  Sec 5 is illustrative of the *process*, not a pre-approved outcome.
- No 1000-player expansion *execution* — this document raises the target
  from 500 to 1000 (Phase 5X.6) and defines the staged path (Sec 2.3), but
  running the actual cohort-review/scraping/QA process against real data
  is future work, not something this revision performs.
- No full-roster-ingestion execution plan — that remains a later-stage
  target beyond 1000 (Sec 2.3 item 4), mentioned for context, not scoped
  here.
