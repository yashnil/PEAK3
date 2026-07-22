# Repository Wiring Audit — Before State (Phase 4.0A, Section E)

Traced route → service → repository → table for every persistence domain,
as the codebase stood immediately before this pass's fixes. This is the
**before-state**; see `docs/implementation/PHASE_4_0A_REPORT.md` for the
after-state and what changed.

## Classification key

- **Fully durable** — DI-wired, complete Postgres implementation, actually
  called from the route that owns the data.
- **Partially durable** — DI-wired with a complete Postgres implementation,
  but no code path actually writes to it (dead/unpopulated in practice).
- **In-memory only** — either no Postgres implementation exists, or the
  route bypasses DI entirely in favor of a module-level singleton.
- **Placeholder PostgreSQL** — a Postgres class exists and is wired via DI,
  but every method raises `NotImplementedError` (breaks the instant
  `DATABASE_URL` is set).
- **Incorrectly wired** — reads and writes for the same logical data go
  through two different mechanisms that never synchronize.
- **Duplicated source of truth** — more than one independently-mutable
  store exists for the same entity.

## Matrix

| Domain | Classification | Detail |
|---|---|---|
| Auth (JWT verification) | Fully durable | Stateless — `app.core.auth._decode_jwt` verifies against `SUPABASE_JWT_SECRET`; no storage needed. |
| Anonymous identity | In-memory only (by design, no fix needed) | Purely a signed HMAC cookie (`create_anon_subject_cookie`/`verify_anon_subject`); the `anonymous_subjects` table from migration 001 is **never referenced anywhere in application code** — vestigial schema, not a bug, but worth noting as dead DDL. |
| Profiles | In-memory only | `apps/api/app/api/v1/profiles.py:32-33` — raw module-level `_profiles: dict`, `_settings: dict`. **No `ProfileRepository` protocol, no Postgres path, no DI provider exist at all.** |
| Settings | In-memory only | Same file/dict as Profiles — `user_settings` table exists in migration 001 but nothing writes to it. |
| Board snapshots | Unused by design | `board_snapshots` table (migration 003) is never written — boards are deterministically regenerated from `(mode, date/seed)` per ADR-001, so storage was deferred deliberately, not a bug. |
| Practice games | In-memory only | `draft.py` calls `app.services.draft.store.create_game/get_game/save_game`, which wraps its own **separate** `MemoryGameRepository()` singleton (`store.py:31`) — never the DI-based `GameRepoDep`. |
| Daily boards | In-memory only | Same `store.py` path as Practice. |
| Daily completions | Partially durable → dead | `DailyCompletionRepository` is DI-wired and `PostgresDailyCompletionRepository` is fully implemented — but **nothing in the draft-completion flow ever calls `record_completion`**. The repo works; it's just never invoked. |
| Challenge creation | In-memory only | `draft.py`'s `create_challenge` route calls `store.store_challenge(...)`, not `ChallengeRepoDep`. |
| Challenge recipient games | In-memory only | Same `store.py` path. |
| Challenge settlement | In-memory only | `draft.py` calls `store.save_settlement(...)`. `PostgresChallengeRepository` is fully implemented and unused. |
| History | Incorrectly wired | `history.py` correctly uses `ResultSnapshotRepoDep`/`DailyCompletionRepoDep` — but since nothing upstream ever writes a `ResultSnapshot`/`DailyCompletion` row (see above), History reads a repository that is never populated, in **both** memory and Postgres modes. Not a memory-vs-Postgres split — a missing write path entirely. |
| Result snapshots | Partially durable → dead | Same shape as Daily completions: repo complete, write path missing. |
| Progression events | Placeholder PostgreSQL | `PostgresProgressionRepository` — **every method raises `NotImplementedError`** (`postgres_progression.py:34-53`). Memory mode works; Postgres mode breaks instantly. |
| XP summaries | Placeholder PostgreSQL | Same repository as above. |
| Personal records | Placeholder PostgreSQL | `PostgresPersonalRecordRepository` — all methods raise (`postgres_progression.py:60-73`). |
| Achievements | Placeholder PostgreSQL | `PostgresAchievementRepository` — all methods raise (`postgres_progression.py:80-90`). |
| Streaks | Placeholder PostgreSQL | `PostgresStreakRepository` — all methods raise (`postgres_progression.py:97-110`). |
| Anonymous ownership claim | Incorrectly wired | `auth.py`'s `_claim_games`/`_claim_completions`/`_claim_challenges` reach into the **private attributes** of the memory repo classes (`game_repo._games`, `daily_repo._completions`, etc.) via `isinstance` checks, and silently `return 0` (no-op) when the repo is Postgres-backed — claiming is unimplemented in production. |
| Ranked queue entries | Fully durable | `ranked_postgres.py` complete, DI-wired, verified against live Postgres in Phase 4.0. |
| Ranked matches | Fully durable | Same. |
| Ranked submissions | Fully durable | Same. |
| Ranked settlement | Fully durable | Same, including the single-transaction `commit_settlement`. |
| Queue ratings | Fully durable | Same. |
| Rating ledger | Fully durable | Same, append-only triggers verified. |
| Placements | Fully durable | Same. |
| Leaderboards | Fully durable | Reads through the same `RankedRatingRepository.get_leaderboard`. |

## Root causes (not fixed by adding more code — fixed by removing paths)

1. **`app/services/draft/store.py` is a second, independent, always-in-memory
   persistence layer for games/challenges**, parallel to `core/dependencies.py`'s
   DI system. `draft.py` (the router that owns games/challenges) exclusively
   uses it. This is the "known draft/history durability split" from the
   Phase 4.0 report — confirmed still present at the start of Phase 4.0A.
2. **`postgres_progression.py` was never actually implemented** — its own
   module docstring says so. This is a strictly worse finding than the
   Phase 4.0 report recorded: it isn't a partial gap, it's a complete stub.
3. **Profiles/Settings never had a repository abstraction built for them at
   all** in any prior phase — a third, independent persistence mechanism.
4. **`auth.py`'s claim-migration logic reaches past the repository
   interface into concrete memory-class internals**, so it silently breaks
   for any repository that isn't `MemoryGameRepository`/etc.

None of these are fixed by adding synchronization between two stores — each
needs its *extra* store or placeholder removed, with exactly one durable
path remaining, per section F's explicit instruction.
