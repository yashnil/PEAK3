# Phase 5C — CourtBuilder Vertical Slice Implementation Checklist

**Status:** Implemented (PR #3, `phase5-courtbuilder-vertical-slice`,
behind `COURTBUILDER_ENABLED`, default off) and hardened for review. This
document originally served as the pre-implementation checklist; it is kept
as the historical record of that pass's scope, not updated to describe the
shipped code line-by-line.
**This is the implementation checklist for Phase 5C**, per
`docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md` and
`docs/product/PEAK3_NEXT_AMBITIOUS_STEPS.md` §10 (Phase 5C row).
**Depends on:** ADR-005 (decisions 1, 2, 3, 4, 5, 6, 7, 8 all apply
directly) and `docs/architecture/PHASE_5_DATA_MODEL.md` (entities 5, 8, 9,
10, 11, 12 — the six entities this slice actually touches).

**Read this next:** the shipped vertical slice is a **technical
scaffold, not a product-complete experience.** It proved the game grammar
end-to-end (spin → search → select → place → simulate → result) and passed
every acceptance criterion in §8 below, but a manual product review found
it is not yet fun: no real spin ceremony, sparse team/decade candidate
pools (some spins resolve to a single eligible player), fully positionless
slots, an exact-score reveal immediately after every pick that undercuts
the suspense the hidden-score mechanic was supposed to create, and weak
mode identity overall. The redesign response lives in
`docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md` (product spec),
`docs/implementation/PHASE_5X_ARENA_OVERHAUL_PLAN.md` (engineering phases
5X.1-5X.9), and `docs/architecture/PHASE_5X_PLAYER_EXPANSION_STRATEGY.md`
(the 250→500 player database expansion this redesign depends on). Read
those before extending this vertical slice further.

---

## 0. Scope framing (read before implementing)

This is a **vertical slice**, not the full 82-0 feature. It proves the
CourtBuilder game grammar end to end — spin, search, select, place, repeat,
simulate, result — without depending on Phase 5B's full player-universe
expansion or team-season data acquisition (`PHASE_5_DATA_MODEL.md` §0/§13,
which are genuinely unscoped blockers for entities 2–4 and 6). Two scope
decisions fall directly out of research done while writing this checklist,
not out of the source docs, and are binding for this phase:

1. **No new Supabase migrations.** `court_lineup`/`court_lineup_slot` state
   is persisted via the existing `games` table's generic
   `payload JSONB NOT NULL` column (`supabase/migrations/20260630124700_game_records.sql`),
   using a new `board_type = "perfect_season"` discriminator — the same
   table Peak Draft's `DraftGameState` already uses, just a different
   payload shape under a different discriminator value. This was verified
   to require zero schema changes.
2. **No durable completion/history/leaderboard writes.** `result_snapshots`
   and `daily_completions` both declare Peak-Draft-specific
   `NOT NULL` columns (`lineup_peak_rating`, and `hold_used`/`reframe_used`
   on `daily_completions`) that don't fit CourtBuilder and would require
   fabricated placeholder values to satisfy without a real migration.
   Phase 5C's official-result tracking is therefore `games.payload` only —
   a completed attempt is retrievable by `game_id`, but does not appear in
   `/history`, does not write a `ResultSnapshot`, and does not trigger
   progression/XP. This is deferred to **Phase 5X** ("Daily 82 and result
   sharing" in the roadmap), which is exactly where the actual schema
   change belongs.
3. **No real team-season data.** The team+decade/exact-team-season spin
   mechanic is prototyped against a small, explicitly-labeled **interim,
   hand-curated dataset** (see §4 below), not the full Phase 5B
   `team_identity`/`team_season`/`team_season_roster_member` schema (which
   has no source data yet, per `PHASE_5_DATA_MODEL.md` §0). This keeps the
   target mechanic (exact team+era resolution) real and testable while
   being explicit that full franchise/decade coverage is not yet built.

---

## 1. Feature flags

Mirrors the existing `RANKED_*` pattern in `apps/api/app/core/config.py`
exactly (independent boolean capability switches + a validated human-facing
readiness enum), extended with the `PEAK3_` env prefix already in use:

```python
# New in Settings (apps/api/app/core/config.py)
COURTBUILDER_ENABLED: bool = False
    # Master switch: CourtBuilder routes/API exist at all.

COURTBUILDER_TEAM_SPIN_ENABLED: bool = False
    # Whether team+decade/exact-team-season spins are offered, vs. a
    # simpler duration/archetype-only spin fallback. Separately switchable
    # because the interim dataset (§4) is intentionally narrow — this flag
    # lets the vertical slice ship with team spins off if the interim
    # dataset isn't ready, without blocking the rest of the loop.

COURTBUILDER_ALPHA_ALLOWLIST: list[str] = []
    # Closed-cohort allowlist of Supabase auth_sub values (and/or signed
    # anon-cookie subjects) permitted to see CourtBuilder while
    # COURTBUILDER_ENABLED=True but not yet publicly linked from nav.
    # Empty + enabled = internal engineering only, same semantics as
    # RANKED_ALPHA_ALLOWLIST.

COURTBUILDER_READINESS_LEVEL: Literal[
    "disabled", "internal_dev", "internal_alpha", "public_beta"
] = "disabled"
    # Human-facing summary, validated for consistency with the booleans
    # above using the same @model_validator pattern RANKED_READINESS_LEVEL
    # already uses. "public_beta" here means "linked from primary nav" —
    # a decision this document does not authorize; see §5 rollout
    # boundaries.
```

Frontend reads readiness through a server-provided value (e.g. a
`/api/v1/courtbuilder/readiness` endpoint mirroring the existing
`/api/v1/ranked/readiness` pattern), never a client-side env var alone —
consistent with keeping the flag's source of truth server-side.

**Default state on `main` after this phase lands:** `COURTBUILDER_ENABLED=False`.
The app is byte-for-byte behaviorally unchanged for any user until this is
flipped in a specific environment.

---

## 2. API domains and routes

New backend domain package, per master plan §16.2's suggested structure
(adapted to only what this slice needs):

```text
apps/api/app/domains/
  perfect_season/
    eligibility.py     # interim spin resolution (§4) — NOT the full
                        # eligibility engine from PHASE_5_DATA_MODEL.md
    peak_cards.py       # thin read layer over existing data/web/ +
                        # data/game/profiles/ — no new scoring, ever
    court.py            # court_lineup / court_lineup_slot state machine
    simulation.py       # v0 simulator — see §3 non-goals; explicitly a
                        # labeled placeholder, not a calibrated model
    schemas.py           # CourtLineup, CourtLineupSlot, PerfectSeasonBoard,
                        # PerfectSeasonAttempt — the entity shapes from
                        # PHASE_5_DATA_MODEL.md entities 8-11, Pydantic-side
```

Routes (per master plan §16.5, unchanged from the source doc's proposal):

```text
POST /api/v1/perfect-season/games
GET  /api/v1/perfect-season/games/{id}
POST /api/v1/perfect-season/games/{id}/select
POST /api/v1/perfect-season/games/{id}/place
POST /api/v1/perfect-season/games/{id}/complete
```

Wiring requirements:
- All five routes check `COURTBUILDER_ENABLED` (and `COURTBUILDER_ALPHA_ALLOWLIST`
  when non-empty) exactly as ranked routes check `RANKED_ENABLED`/
  `RANKED_ALPHA_ALLOWLIST` — a `404`-shaped or `403`-shaped response when
  disabled, never a silent fallback.
- `owner_sub` resolution reuses `app.core.auth.resolve_owner_sub()`
  unchanged — the same anon-cookie-or-JWT function Peak Draft's `draft.py`
  and `auth.py` already share (Phase 4.0A §4/F). No new identity mechanism.
- State persistence reuses the `games` table via a repository call, per §0
  item 1. Whether this goes through the existing `GameRepository` protocol
  with a new `board_type` value, or a new narrow protocol backed by the
  same table, is an implementation-time decision — either is acceptable as
  long as it does not reintroduce a second in-memory-only store (the exact
  `app/services/draft/store.py` mistake `PHASE_4_0A_REPORT.md` §4/F fixed
  once already).

---

## 3. Frontend routes and components

**New route**, additive, not a replacement of any existing route:

```text
apps/web/src/app/(main)/arena/court/practice/[mode]/page.tsx
```

`practice` only in this phase — no `daily` variant (§0 item 2: no durable
completion tracking yet, and Daily requires the settlement/leaderboard
infrastructure explicitly deferred to Phase 5X). `[mode]` mirrors the
existing `apex_1y`/`prime_3y`/`foundation_5y` duration convention so the
same `data/web/peak_windows.json` durations apply.

**No changes to existing Peak Draft routes** (`/arena/practice/[mode]`,
`/arena/daily/[mode]`, `/arena/ranked/[mode]`, `/arena/results/[id]`) —
per ADR-005 Decision 2, these are untouched in this phase. A nav-label
change (e.g. adding a "Court (new)" or similar entry pointing at the new
route) is in scope; re-labeling Peak Draft's existing nav entry as
Legacy/Labs is **not** in scope for this phase (see §5) to avoid bundling a
navigation-IA decision into this vertical slice's review surface.

**New components**, under `apps/web/src/components/court/` (parallel to
the existing `apps/web/src/components/draft/`, not inside it):

| Component | Purpose | Master plan ref |
|---|---|---|
| `CourtBuilder` | Top-level court canvas: 5 starter slots + 3 bench slots, soft placement | §5.5, §13.2 |
| `SpinStage` | Team+decade or exact-team-season spin animation and prompt display | §6.3, §13.3 |
| `EligiblePlayerSearch` | Search/browse eligible players for the current spin — **never displays `prime_score` or rank** (ADR-005 Decision 6) | §6.4 |
| `PeakCardCourt` | A new card variant for court placement — distinct from the existing Peak Draft `PeakCard`/offer-card component, since pre-selection it must omit score/rank entirely | §13.4 |
| `LineupInsightPanel` | Post-placement comfort/fit indicators — display-only, never blocking (ADR-005 Decision 4 boundary) | §5.6, §13.2 |
| `SeasonResultStub` | v0 result display: seeded record, expected-wins range, one decisive factor — explicitly not the full broadcast presentation (§13.6) in this phase | §6.8 (simplified) |

**Explicitly deferred in this phase:** the full broadcast-style simulation
presentation (scoreboard, series tracker, win-probability strip) from
master plan §13.6 — `SeasonResultStub` is a static result screen, not an
animated broadcast layer. Animation quality is a Phase 5C-follow-up or
Phase 5X concern, not blocking for proving the game grammar.

---

## 4. Interim team-decade dataset (explicit, labeled, small)

Since no team-season data exists anywhere in the repo (`PHASE_5_DATA_MODEL.md`
§0), this slice ships with a small, hand-curated, explicitly-labeled interim
dataset — **not** wired into `PHASE_5_DATA_MODEL.md`'s real
`team_identity`/`team_season`/`team_season_roster_member` schema, and not
committed as if it were that schema's seed data.

Requirements:
- A flat file (e.g. `data/game/interim/courtbuilder_team_seasons.v0.json`),
  clearly named `.v0` and interim, covering a small number of team-decade
  and exact-team-season combinations (suggested: 3–5 franchises × 2 decades
  each, hand-verified against public sources, enough to exercise both spin
  types from master plan §6.5 without claiming broad coverage).
- Every entry carries a `source_provenance` note (what was checked, when) —
  same discipline as the model's existing `source`/`source_url` columns in
  `data/generated/*.csv`, not a bare guess.
- A visible, non-dismissable label in the UI (e.g. "Interim team data —
  limited coverage") whenever `COURTBUILDER_TEAM_SPIN_ENABLED` is on,
  so testers don't mistake a 3-franchise prototype for full coverage.
- Explicitly **not** used to backfill or seed `PHASE_5_DATA_MODEL.md`'s real
  schema later — when real team-season data acquisition happens (a
  Phase 5B follow-up, out of scope here), this interim file is deleted, not
  migrated.

---

## 5. Test plan

Mirrors the existing test-layering already proven for Peak Draft/ranked:

**API (`apps/api/tests/`):**
- New `tests/test_perfect_season.py` (or a `tests/perfect_season/` package)
  covering: game creation, spin resolution against the interim dataset,
  select/place state transitions, completion, and the explicit "no score
  visible before lock" contract — the last one as a real assertion (the
  select-round response schema must not contain `prime_score`/`prime_index`
  fields), not just a manual UI check.
- Flag-gating tests: `COURTBUILDER_ENABLED=False` → all five routes return
  the gated response; `COURTBUILDER_ALPHA_ALLOWLIST` non-empty → non-member
  subjects are rejected. Mirrors `test_ranked_board_security.py`'s pattern.
- Regression guard: existing `tests/test_draft.py`,
  `tests/test_repository_conformance.py`, and the rest of the existing 264
  API tests must still pass unmodified — no shared repository/protocol
  change in this phase should touch their behavior, but this is the
  explicit check that confirms it.

**Frontend (`apps/web/src/tests/unit/`):**
- Court-state reducer/hook tests: slot placement, swap, unconventional
  lineup legality (5 players in starter slots regardless of position, per
  ADR-005 Decision — soft placement, never blocked).
- `EligiblePlayerSearch`/`PeakCardCourt` render tests asserting no
  score/rank text node is present pre-lock (a second, UI-layer version of
  the API-layer assertion above — belt and suspenders on the single most
  important product requirement in this phase).

**Playwright (`apps/web/src/tests/e2e/`):**
- New `courtbuilder.spec.ts` (parallel to the existing `gameplay.spec.ts`,
  not appended to it): a full anonymous practice attempt — spin, search,
  select, place, repeat through all 8 rounds, complete, view result. Must
  reach a result reliably (this is the exact P0 failure class — "result
  loading must never fail after a completed game" — ADR-005 Context and
  master plan §19.5 — that this slice must not reproduce).
- Keyboard-only completion path (no mouse), mirroring the existing
  `Keyboard navigation` describe block in `gameplay.spec.ts`.
- Mobile viewport no-horizontal-overflow check, mirroring the existing
  `@mobile` tagged tests.
- Axe accessibility pass on the new route, consistent with the existing
  Playwright + axe CI job.

**Regression requirement:** the existing CI baseline (8/8 jobs green on
`main` before this branch, per this task's own stated context) must remain
green throughout — new tests are additive; nothing existing is skipped,
weakened, or deleted to make this phase land.

---

## 6. Rollout boundaries

- `COURTBUILDER_ENABLED=False` by default in every environment until this
  checklist's acceptance criteria (§7) are independently verified, matching
  how `RANKED_ENABLED` shipped through `internal_alpha` before any public
  exposure (ADR-004 §18).
- Not linked from primary navigation in this phase — reachable only via
  direct URL and (optionally) an internal-only nav entry gated by
  `COURTBUILDER_ALPHA_ALLOWLIST`, never the home page's primary CTA (that
  promotion is explicitly a later decision, master plan §4.2's navigation
  redesign, ADR-005 Decision 1's own phrasing: "once Phase 5C ships behind
  its feature flag and clears the exit gates").
- No changes to Peak Draft's routes, nav position, or labeling in this
  phase (§3) — the Legacy/Labs re-label is a distinct, smaller follow-up
  task, deliberately not bundled here.
- No ranked, Duel, Draft Night, Forge, or War Room integration — this slice
  is solo/practice-only.
- No hosted Supabase, no `supabase link`, no production `.env`/secrets
  changes, no new Supabase migrations (§0).
- No changes to `OFFICIAL_WEIGHTS`, `calibrate_score()`, or any committed
  `leaderboards/*.csv` (ADR-005 Decision 3, restating the pre-existing
  `CLAUDE.md` rule).

---

## 7. Explicit non-goals

- **Full team-season data / real eligibility engine** — interim dataset
  only (§4); `PHASE_5_DATA_MODEL.md` entities 2–4, 6 remain design-only.
- **Daily 82, leaderboards, streaks, achievements for CourtBuilder** —
  Phase 5X. This slice writes no `ResultSnapshot`, no `DailyCompletion`, no
  progression event.
- **PEAK3 Forge, attribute engine, `player_attribute_profile` population** —
  Phase 5E. `LineupInsightPanel` in this slice uses lineup-fit heuristics
  only (master plan §5.6 dimensions), not the attribute engine.
- **Ranked Peak Draft Duel, War Room, Draft Night, Threepeat, Peak
  Hunt/Grid** — later phases (5F–5I per the roadmap); zero code shared
  beyond the generic domain-package convention.
- **Calibrated season simulation** — the v0 simulator (§2, §3) is a
  labeled placeholder that produces a plausible seeded record and an
  expected-wins range from lineup-fit components; it is explicitly not
  calibrated against real historical win distributions (master plan §12.8)
  and must say so in its own receipt text, not imply precision it doesn't
  have.
- **Broadcast-style simulation presentation** — deferred (§3).
- **Legacy/Labs re-labeling of Peak Draft's navigation** — deferred (§6).
- **Any new Supabase migration** — deferred; §0 explains why none is needed
  for this slice specifically, not that migrations are permanently avoided.
- **Public launch, marketing, or home-page promotion** — gated behind
  future, separate acceptance criteria (§6).

---

## 8. Acceptance criteria

This phase is not complete unless all of the following hold, verified by
the tests in §5 (not by inspection alone):

1. `COURTBUILDER_ENABLED=False` leaves every existing route, test, and
   user-visible behavior unchanged — verified by the full existing suite
   passing unmodified.
2. A full anonymous practice CourtBuilder attempt (spin → search → select
   → place, ×8 rounds → complete → result) succeeds end to end, and the
   result is always retrievable after completion — no result-loading
   failure class, matching master plan §6.12's own bar.
3. No response payload or rendered DOM node exposes `prime_score`,
   `prime_index`, or rank for any candidate before that round's selection
   is locked — verified by both an API-layer test and a frontend render
   test (§5).
4. At least 3 deliberately unconventional lineups (e.g., five bench-labeled
   players started, or a single archetype repeated across all five starter
   slots) remain legal and produce a result rather than being blocked —
   soft placement is real, not cosmetic.
5. The full round-trip is keyboard-operable and passes an automated
   accessibility (axe) check with no new critical/serious violations.
6. The interim team-decade dataset (§4) is present, source-cited, and
   visibly labeled as interim in the UI whenever team spins are shown.
7. Every official completed attempt exposes its board seed, card-pool
   version, and (labeled-experimental) simulator version in its receipt —
   reproducibility from stored versions, not just from the current default
   config, per bridge doc §8.
8. Peak Draft's existing routes, tests, and CI jobs are unaffected — same
   pass/fail status before and after this phase lands.
9. CI baseline stays 8/8 green (the 8 jobs already established on `main`),
   with any new jobs this phase adds passing as well — no existing job is
   weakened, skipped, or removed to achieve this.
10. No hosted Supabase project, `supabase link`, or production secret was
    touched at any point in implementing this phase.
