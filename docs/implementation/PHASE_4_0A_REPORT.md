# Phase 4.0A Report — Local Supabase Canonicalization and Durable Repository Unification

**Status:** Engineering complete. All identified durability gaps closed and validated against a real local Supabase stack.
**Date:** 2026-07-01
**Branch:** `phase4-ranked-alpha`

---

## 0. Why this phase existed

Phase 4.0's report (`PHASE_4_0_REPORT.md`, §1 item 3) documented, as an
explicit known gap, that `apps/api/app/api/v1/draft.py` persisted
Practice/Daily/Challenge game state through a second, always-in-memory
module (`app/services/draft/store.py`) — completely independent of the
Postgres-backed repositories that `history.py`/`profiles.py` used. That
report also flagged that every repository protocol declared synchronous
methods while `postgres.py`'s implementations were `async def`, with call
sites invoking them unawaited. Phase 4.0A's mandate was to close both gaps,
canonicalize the migration source into one chain runnable against a real
local Supabase stack (never a hosted project), and validate the result for
real rather than by inspection alone.

## 1. Safety preflight (section A)

Confirmed before any work began:
- Branch `phase4-ranked-alpha`, clean working tree, HEAD reachable.
- No `supabase/.temp/project-ref`, no hosted-project reference anywhere in
  the repo or shell environment.
- No `PEAK3_DATABASE_URL`, `DATABASE_URL`, Supabase URL, or Supabase key
  environment variables were set at the start of the session.
- No committed real `.env` files; `.env.example` only.
- No Dissio references anywhere in the repository.
- At no point in this phase was `supabase link`, a remote `supabase db
  push`, or a remote `supabase db pull` run. Every `supabase` CLI invocation
  in this phase (`init`, `start`, `status`, `db reset`, `migration new`)
  operated on the local Docker-based stack only.

## 2. Canonical migration chain (sections B–D)

- `supabase/config.toml` + `supabase/migrations/` initialized via
  `npx supabase init` (local CLI, no hosted project).
- All 16 pre-existing `infra/migrations/001–016*.sql` files ported verbatim
  into `supabase/migrations/` under timestamped names
  (`20260630124500_identity.sql` … `20260630130000_ranked_rls.sql`), then
  `infra/migrations/*.sql` deleted (`git rm`) and replaced with a single
  `infra/migrations/README.md` pointing at the new canonical location — one
  editable migration source, not two.
- `scripts/migration_inventory.py` (new): parses every migration for
  tables/columns/indexes/constraints/functions/triggers/RLS/policies/
  grants/extensions/external-dependencies, writing
  `supabase/migrations/MIGRATION_INVENTORY.{json,md}`.
- `scripts/validate_migrations.py` (new): cross-file validation — ordering,
  unique identifiers, referenced-tables-exist (cumulative), no-duplicate-
  policy-names, extensions-declared-before-use, no-unresolved-legacy-source.
  Currently reports:
  ```
  PASS: migration chain is well-ordered, unique, internally consistent,
  and no unresolved legacy migration source remains.
  ```
- A 17th migration (`20260630130100_default_privileges.sql`) was added
  mid-phase after real-stack validation surfaced a genuine gap — see §4.

The full chain (17 migrations) was applied end-to-end against a real local
Supabase stack via `supabase db reset` multiple times during this phase,
including the final verification pass — not just parsed/inspected.

## 3. Repository wiring audit (section E)

Full before-state matrix in `docs/architecture/REPOSITORY_WIRING_AUDIT.md`.
Root causes identified for ~26 domains:
1. `app/services/draft/store.py` — a second, always-in-memory persistence
   layer for games and challenges, entirely independent of the DI-based
   repositories `history.py`/`auth.py` used.
2. `postgres_progression.py` — every method raised `NotImplementedError`;
   the module docstring admitted these were placeholders.
3. Profiles/settings had no repository abstraction at all — raw
   module-level dicts in `profiles.py`.
4. `auth.py`'s anonymous-claim logic reached into memory-repository private
   attributes (`repo._games`, etc.) via `isinstance` checks, silently
   returning 0 for Postgres and being wrong even for memory (checked a
   `DraftGameState` attribute — `anon_subject_id` — that never existed).

## 4. Fixes (sections F–H)

### F. Draft/history durability split — resolved by removing the split, not syncing it

- `nba_peak/lineup/schemas.py::DraftGameState` gained a real `owner_sub`
  field (server-resolved only, never client-trusted).
- `app/core/auth.py::resolve_owner_sub()` — one shared function (auth JWT →
  verified anon cookie → freshly-issued anon cookie), used identically by
  `draft.py` and `auth.py` so both routers read/write the same
  `peak3_anon` cookie.
- `app/services/draft/serialization.py` (new) — the real
  `DraftGameState` ↔ dict serialization `postgres.py` was missing entirely
  (it previously called a function that unconditionally raised
  `NotImplementedError`).
- **`app/services/draft/store.py` deleted outright.** `draft.py` was
  rewired to `GameRepoDep`/`ChallengeRepoDep`/`DailyCompletionRepoDep`/
  `ResultSnapshotRepoDep` (the same DI pattern `history.py` already used),
  closing Phase 4.0's documented gap rather than adding a synchronization
  layer between two stores.
- **The missing write-path was added**: `draft.py` never called
  `daily_repo.record_completion`/`result_repo.record_result` on game
  completion for Practice/Daily/Challenge games (only ranked matches did,
  from Phase 4.0) — confirmed and fixed. Completion now writes a durable
  `ResultSnapshot` (all board types) and a `DailyCompletion` (Daily board
  type), then additively calls the existing Phase 3.1 progression engine
  (participation XP, records, achievements, streaks) exactly the way ranked
  settlement already did, never allowed to fail the draft response.
- **Full async conversion**: `GameRepository`, `ChallengeRepository`,
  `DailyCompletionRepository`, `ResultSnapshotRepository`,
  `OwnershipClaimRepository`, `ProgressionRepository`,
  `PersonalRecordRepository`, `AchievementRepository`, `StreakRepository`
  protocols converted to `async def` throughout, matching the pattern
  `ranked_protocols.py` already used specifically to prevent this bug
  class. Every call site (`draft.py`, `history.py`, `auth.py`,
  `progression.py`, `engine.py`, `ranked.py`) updated to `await`.
- `auth.py`'s claim flow rewritten around a new `transfer_owner`/
  `transfer_events`/`transfer_records`/`transfer_awards`/`transfer_streak`
  protocol method on each repository — real for both memory and Postgres —
  replacing the private-attribute-reaching helpers that silently no-op'd
  against Postgres (and were broken even for memory).

### G. Complete PostgreSQL implementations

- `postgres_progression.py` rewritten from a 100%-stub file into a full
  asyncpg implementation (all 4 progression repositories).
- New `ProfileRepository` protocol + `MemoryProfileRepository` +
  `PostgresProfileRepository`, replacing `profiles.py`'s raw dicts;
  `profiles/{me,me/settings,{handle}}` routes rewired to the repository,
  wired into `core/dependencies.py`/`ProfileRepoDep` following the existing
  pattern exactly.
- `tests/test_repository_conformance.py` (new): runs the identical behavior
  assertions against **both** the memory and the real PostgreSQL
  implementation of `GameRepository`, `ChallengeRepository`,
  `DailyCompletionRepository`, `ResultSnapshotRepository`, and
  `ProfileRepository`. The Postgres half skips with an explicit
  "not configured" reason when `PEAK3_TEST_DATABASE_URL` is unset; it was
  run for real against the local stack for this report (see §6).
- This conformance suite caught a real divergence during development:
  `MemoryChallengeRepository.save_settlement` did not enforce write-once,
  unlike the Postgres implementation's `WHERE settlement IS NULL` guard —
  fixed to match.

### H. Atomic state transitions

Full audit in `docs/architecture/ATOMIC_TRANSITIONS_AUDIT.md`. Summary:
ranked settlement, and every claim-transfer method (records, achievements,
streak, daily completions), already commit inside one DB transaction.
Multi-step orchestration without a shared transaction (`process_game_completion`,
`/auth/claim`, the draft completion write path) is composed entirely of
individually-idempotent steps that converge to the fully-applied state on
retry rather than corrupting or duplicating data — one narrow,
low-severity gap (daily-completion display metadata after a mid-request
crash) is documented explicitly rather than fixed with a new
cross-repository transaction primitive that doesn't otherwise exist in this
codebase.

## 5. Production repository-mode contract (section I)

New `app/core/repository_registry.py`: enumerates all 13 repository
domains, logs a safe (no secrets/connection strings) summary at startup —
`Repository registry: postgres (13/13 domains)` — and fails production
startup (`PEAK3_DEBUG=false`) outright if any domain would resolve to
memory or if backends are ever mixed. Verified live:
```
INFO:app.main:PostgreSQL connection pool initialized
INFO:app.core.repository_registry:Repository registry: postgres (13/13 domains)
```
7 new unit tests in `tests/test_repository_registry.py`.

## 6. Real local Supabase validation (section A callback / this phase's own §28)

This is the substantive difference between this phase and simply reading
the code: the local stack was actually started (`supabase start`), the full
17-migration chain was actually applied (`supabase db reset`), and the
previously-written-but-never-executed `tests/integration/` suite
(Phase 4.0's honest gap — "written but not yet run against a live project")
was actually run against it, with real secrets pointed at the local stack.
**Running it for the first time surfaced three genuine, previously-latent
bugs, all fixed and re-verified:**

1. **Self-referential RLS recursion.** `ranked_match_participants`'s own
   opponent-visibility policy queried `ranked_match_participants` from
   inside its own policy (and, once fixed, `ranked_matches`'s policy queried
   `ranked_match_participants`, which queried `ranked_matches` back — mutual
   recursion). Postgres raised
   `InvalidObjectDefinitionError: infinite recursion detected in policy for
   relation "ranked_match_participants"` — this table's RLS could never
   have worked against any real Postgres instance, hosted or local. Fixed
   with a `SECURITY DEFINER` helper function
   (`is_ranked_match_participant`) that both tables' policies now call
   instead of querying each other directly.
2. **Missing base table privileges.** Every table created by these
   migrations is owned by `postgres`, whose default ACL for `anon`/
   `authenticated` on this stack grants only `TRUNCATE`/`REFERENCES`/
   `TRIGGER` — not `SELECT`/`INSERT`/`UPDATE`/`DELETE`. RLS policies only
   ever *restrict* rows; Postgres separately requires the base object
   privilege before a role may attempt the query at all. Every RLS-
   protected table in the entire project — not just ranked — would have
   returned `permission denied` for any `anon`/`authenticated` Postgres-role
   access regardless of policy correctness. Fixed with a new migration
   granting `SELECT, INSERT, UPDATE, DELETE` to `anon, authenticated` plus
   `ALTER DEFAULT PRIVILEGES` so future tables inherit it automatically.
   (This does not bypass RLS — deny-all policies on service-only tables
   remain fully enforced regardless of the grant.)
3. **`owner_sub` silently cleared by every game action.** `state.py`'s
   `_clone()` helper (used by `select_card`/`use_hold`/`use_reframe`/
   `confirm`) did not copy `owner_sub` onto the new state object, so
   ownership set correctly at game creation was silently wiped by the first
   action taken on any game — meaning even after the `store.py` fix, a
   real Postgres write of a completed game would have persisted
   `owner_sub = NULL`. Found by playing a full game against the real local
   stack and inspecting the `games` table directly; confirmed and fixed,
   with a new regression test (`test_owner_sub_survives_actions_and_completion_is_recorded`).

None of these three bugs were visible from code inspection alone or from
the in-memory test suite — the in-memory repositories don't have real RLS,
real base-privilege enforcement, or (in the case of bug 3) a Postgres round
trip that would expose a value silently defaulting back to `None`. All
three are exactly the kind of gap this phase existed to find.

**Full restart-durability smoke test**, run against the real local stack:
created a Practice game, played it to `draft_complete` via the API, killed
the `uvicorn` process, restarted it, and re-fetched the same `game_id` —
the completed state (including `lineup_evaluation`) was returned correctly,
confirming the durable-restart property the phase set out to establish.

## 7. Local Supabase environment (section J)

- `apps/api/.env.example` expanded with an explicit local-stack section
  mapping every `supabase status` output field to the corresponding
  `PEAK3_*` env var, and documenting that `PEAK3_TEST_*` vars can now point
  at the local stack (still never a hosted project).
- `docs/implementation/LOCAL_DEV.md` updated: `supabase start`/`db reset`/
  `migration new` workflow (already partially done pre-session), plus new
  instructions for running the real integration + conformance suites
  locally, and how to read the startup repository-registry log line.

## 8. Final verification

```
python -m pytest tests/ -q                              # 227 passed (model + lineup)
cd apps/api && python -m pytest tests/ -q                # 264 passed, 18 skipped (honest "not configured" gaps)
python scripts/validate_migrations.py                    # PASS
python scripts/migration_inventory.py                    # 17 migrations inventoried
```

With the local Supabase stack running and `PEAK3_TEST_*` env vars pointed at
it:
```
cd apps/api && python -m pytest tests/integration/ tests/test_repository_conformance.py -q
# 23 passed (13 real auth/RLS integration + 10 real memory-vs-Postgres conformance)
```

The 18 skipped tests in the default run are exactly the `supabase_integration`-
marked and conformance-suite Postgres-half tests — they report "not
configured" rather than a fabricated pass, and were demonstrated to
actually pass against the real stack above.

## 9. What this phase deliberately did not do

- No hosted Supabase project was created, linked, or pushed to.
- No public ranked launch features, season systems, or product redesign.
- No existing test was weakened; 12 new tests were added
  (`test_repository_conformance.py` ×10 net-new assertions across 5
  domains × 2 backends, `test_repository_registry.py` ×7,
  `test_owner_sub_survives_actions_and_completion_is_recorded` +
  `test_daily_completion_is_recorded_on_finish` in `test_draft.py`).
- The one identified non-atomic (but non-corrupting, idempotent-safe) gap
  in the draft completion write path was documented, not silently patched
  with an unproven new transaction abstraction.

## 10. Recommended next phase

**Phase 4.1** should focus on: (a) a seeded `supabase/seed.sql` for local
dev convenience, (b) extending the conformance suite to the remaining
ranked/progression repository pairs, (c) revisiting whether the draft
completion write path's three-call sequence should be collapsed behind a
shared-connection transaction helper if production telemetry ever shows the
narrow crash window in §4/H actually manifesting, and (d) proceeding with
the ranked closed-alpha readiness work Phase 4.0's own report already
recommended (real Supabase project credentials for the dedicated CI job,
real expert pairwise-review data) — now on top of a repository layer with
no known unvalidated gaps.
