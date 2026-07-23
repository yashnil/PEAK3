# Phase 5X — Player Database Expansion Strategy (250 → 500)

**Status:** Strategy/design only. No scraping, no data acquisition, no new
files under `data/generated/`, `data/web/`, or `data/game/` are created by
this document. No player names in this document represent confirmed,
model-validated additions — every specific name below is an **illustrative
candidate for the cohort-review process**, not a committed inclusion.
**Depends on:** `docs/architecture/PHASE_5_DATA_MODEL.md` (entities 1-4:
`player_identity`, `team_identity`, `team_season`, `team_season_roster_member`
— this document operationalizes those entities toward a concrete 500-player
target; it does not redefine them).
**Companion:** `docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md` Sec 8,
`docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md` Phase 5X.4.

**Phase 5X.5 audit finding (adds a second, distinct reason expansion is
needed, beyond Sec 1's "slice depth" argument):** a wheel-coverage audit
found that two players already named in the interim team-season dataset
(`data/game/interim/courtbuilder_team_seasons.v2.json`) -- Michael Cooper
and Jaylen Brown -- have `profile_status='excluded'` for every duration in
`card_profiles.v3.json`, meaning they were in the 250-player pool's raw
data but never actually resolvable as a playable candidate. This silently
starved 3 team-era entries down to a single candidate, and (before a
separate board-generator fix) made 2 whole franchises essentially never
appear on the wheel. The dataset fix swapped in real teammates who ARE
resolvable; the underlying pattern is worth knowing before the 500-player
expansion executes: **`profile_status='excluded'` rows exist in the current
pipeline for players who don't clear the model's data-completeness bar,
and any future team-era interim mapping (or the eventual real
`team_season_roster_member` data) must cross-check against resolvable
status, not just "is this player's slug anywhere in card_profiles.v3.json."**

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

## 2. Target: 500-player v1 expansion

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

- **500-player v1** (this document's actual scope): the near-term release.
  Prioritize Cohorts A and B first (highest confidence), then run Cohort D
  specifically against the launch team-decade list (Sec 4) to close
  coverage gaps, then Cohort C to round out remaining budget, then Cohort E
  as individually-reviewed additions throughout.
- **1,000-player v2** (later, not scoped in detail here): broader
  historical coverage once v1's process is validated in production.
- **Full team-season roster ingestion** (later, separate project): every
  rostered player for every team-season in the supported period, primarily
  for PEAK3 Index research value and Extended Archive/Labs-tier CourtBuilder
  content — not required for Competitive Core team+decade gameplay to work
  well, which only needs the 500-player expansion's depth.

## 3. Required new fields (not currently present anywhere in the pipeline)

Two fields are needed for every expanded player-season, verified absent
from all current data files this session (extending the same audit
ADR-005 already ran for team affiliation):

1. **Team-season roster membership** — already scoped in
   `PHASE_5_DATA_MODEL.md` entity 4 (`team_season_roster_member`). Source:
   Basketball-Reference team-season roster pages, via the existing
   `nba_peak/data_complete.py` scrape-once/cache pattern.
2. **Primary/secondary NBA position** — **not previously identified as a
   gap** in any prior Phase 5 document; surfaced by this overhaul's
   position-slot redesign (`ARENA_OVERHAUL_PRODUCT_SPEC.md` Sec 6). Source:
   Basketball-Reference's per-player-season position field, same scrape
   pattern, same cache discipline. This is a materially simpler field than
   team-season membership (one categorical value per player-season, no
   roster-join complexity) and should be sourced in the same scraping pass
   to avoid two separate acquisition efforts hitting the same source pages.

Both fields apply to the **existing 250-pool as well as the expansion** —
today's 250 players have no position data either, which is why
`ARENA_OVERHAUL_PRODUCT_SPEC.md` Sec 6.4b specifies a v1 archetype-based
approximation that doesn't wait on this data. Sourcing real position data
should eventually replace that approximation for the full pool, not just
the expansion.

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
   players, ~6% of the 500 target) against public records before the
   expansion is considered launch-ready.
7. **Provenance completeness** — every row has a non-empty
   `source_provenance` field (matches the discipline already enforced for
   the interim CourtBuilder dataset's `source_provenance` notes).

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
- No 1,000-player or full-roster-ingestion execution plan — those are
  later-stage targets, mentioned for context (Sec 2.3) but not scoped here.
