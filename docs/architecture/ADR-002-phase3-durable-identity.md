# ADR-002 — Phase 3.0: Durable Identity, Authentication, and Immutable History

**Status:** Accepted  
**Date:** 2026-06-30  
**Deciders:** PEAK3 Engineering

---

## Context

Phase 2.4 shipped a fully playable Peak Draft with ephemeral (process-local) game and challenge persistence. Every API restart destroys game state, history, and challenges. There are no user accounts, no durable result records, and no anonymous ownership model. Phase 3.0 must make results durable, add anonymous-first authentication, and allow users to claim anonymous activity after signing in.

---

## Decisions

### 1. Database: Supabase PostgreSQL

**Decision:** Use Supabase-managed PostgreSQL as the production database.

**Rationale:**
- Supabase provides PostgreSQL (including JSONB, UUIDs, advisory locks, `FOR UPDATE SKIP LOCKED`) with a hosted API, dashboard, and built-in RLS engine.
- Row Level Security is a first-class feature — policies are SQL, version-controlled alongside migrations, and enforced at the database layer.
- Supabase's local dev stack (`supabase start`) provides a deterministic isolated environment for CI.
- The team already intends to use Supabase Auth (see §2 below); using the same platform avoids cross-service JWT complexity.

**Rejected:**
- **Raw PostgreSQL on Fly.io:** More operational burden without additional capability.
- **SQLite:** Not suitable for multi-process deployments or RLS.
- **Redis:** Good for TTL caches but inappropriate as the authoritative store for immutable result history.

**Trade-offs:**
- Supabase vendor lock-in on hosted features (RLS, realtime). Mitigated by: the schema and policies are plain SQL, and the application code accesses the database via standard PostgreSQL drivers (`asyncpg` / `psycopg`), not Supabase-specific client SDKs in hot paths.

---

### 2. Authentication provider: Supabase Auth

**Decision:** Use Supabase Auth for user sign-up, sign-in, session management, and OAuth.

**Rationale:**
- Supabase Auth issues standard JWTs signed with the project's JWT secret. The FastAPI backend verifies these with PyJWT — no Supabase SDK required on the server.
- Anonymous sign-in (Supabase Auth anonymous sessions) provides a stable auth identity even before email registration, enabling the anonymous → claim flow without a separate custom mechanism.
- Google OAuth is available without additional infrastructure when configured.
- Email/password flow is available out of the box.

**Anonymous subject model:**
- A visitor who has not signed in receives a Supabase anonymous session (or a server-issued signed cookie if Supabase anonymous sessions are unavailable in the project tier).
- The anonymous `sub` claim from the JWT/cookie identifies the subject server-side.
- Only a hash of the credential is stored server-side (not the raw credential or session token).
- LocalStorage is used only for resumable UI state (game_id, progress), never as the authoritative ownership source.

**Verification in FastAPI:**
- The `Authorization: Bearer <access_token>` header is verified using `PyJWT` against the Supabase project's JWT secret (`SUPABASE_JWT_SECRET`).
- The verified `sub` claim is the canonical user identifier for all ownership checks.
- The client never submits a user ID directly in a request body for authorization purposes.

---

### 3. Anonymous ownership model

**Decision:** Anonymous games/completions/challenges are owned by the anonymous `sub` from the verified credential, not by a browser-side list of game IDs.

**Invariants:**
- Creating a game, daily completion, or challenge records the owner `sub` at creation time.
- The client cannot re-assign ownership by sending a different `sub`.
- Only the credential holder (verified JWT) can read or claim their anonymous records.

---

### 4. Result immutability contract

**Decision:** A `result_snapshots` table stores the complete serialized result payload at the moment of official completion. This record is append-only; no column is updated after insert.

**Implications:**
- Historical result pages are rendered from stored snapshots, not by rerunning the current model.
- Changing `LINEUP_MODEL_VERSION`, `RULESET_VERSION`, or `CARD_PROFILE_VERSION` does not alter historical results.
- A model bug fixed in v4 does not retroactively change v3 results.

---

### 5. Board version identity

**Decision:** The `board_snapshots` table stores the complete version tuple:
- `lineup_model_version`
- `ruleset_version`
- `card_pool_version`
- `board_generation_algorithm` (currently "v1")

The public `board_id` field (used in URLs and API responses) remains `{board_type}-{mode}-{date_or_seed}` for compactness, but the database uniqueness constraint uses `(board_type, mode, date_or_seed, lineup_model_version, ruleset_version, card_pool_version)`.

**Implications:**
- Upgrading a default version creates a new canonical board identity for future dates; historical boards are unaffected.
- Challenge recipients always play the challenger's stored board snapshot (same version).
- `board_version_key` is exposed in `board_metadata` API responses for client-side transparency.

---

### 6. Repository boundaries

Each persistence domain has an explicit Python `Protocol` interface in `apps/api/app/repositories/protocols.py`. The implementations are:

| Implementation | Purpose |
|---|---|
| `MemoryGameRepo` | In-process in-memory store — for unit tests only |
| `MemoryChallengeRepo` | In-process in-memory store — for unit tests only |
| `PostgresGameRepo` | Asyncpg-backed production implementation |
| `PostgresChallengeRepo` | Asyncpg-backed production implementation |

The API routers and state machine code reference the `Protocol`, not a concrete class. Dependency injection is wired in `apps/api/app/core/dependencies.py`.

**At startup:** The API must fail clearly in production when `DATABASE_URL` is unset. In-memory implementations are never silently selected for deployed environments.

---

### 7. Transaction boundaries

The following operations run inside a single database transaction:

| Operation | Isolation level |
|---|---|
| Create canonical daily board | `SERIALIZABLE` (or advisory lock) |
| Submit official daily completion | `READ COMMITTED` + uniqueness constraint |
| Create challenge | `READ COMMITTED` |
| Settle challenge (first comparison) | `READ COMMITTED` + upsert |
| Anonymous ownership claim | `SERIALIZABLE` |
| Profile handle claim | `READ COMMITTED` + uniqueness constraint |

---

### 8. RLS strategy

Policies are defined in `infra/migrations/005_rls.sql`. Summary:

| Table | Public reads | Owner reads | Server writes |
|---|---|---|---|
| `board_snapshots` | Board metadata only | — | Yes |
| `games` | No | Own games only | Yes |
| `result_snapshots` | If public-sharing enabled | Own results | Yes |
| `daily_completions` | No | Own completions | Yes |
| `challenges` | Spoiler-safe metadata only | Own challenges | Yes |
| `profiles` | If `is_public = true` | Full profile | Yes |
| `user_settings` | No | Owner only | Yes |

Service-role operations (administrative writes) bypass RLS using the Supabase service key, which is never exposed to clients.

---

### 9. Local test strategy

- Unit/integration tests use the `MemoryGameRepo` and `MemoryChallengeRepo` in-memory implementations via dependency injection.
- The `conftest.py` `client` fixture injects memory repositories.
- Full persistence tests use a Supabase local Docker stack (`supabase start`) or a `pytest-asyncio` fixture that spins up a `postgresql` test container via `pytest-docker`.
- All tests remain deterministic and do not share state between test cases.

---

### 10. Rollback and migration approach

- Migrations are numbered SQL files in `infra/migrations/`.
- `infra/migrations/` is applied via `supabase db push` (hosted) or `psql -f` (CI).
- Each migration is reversible where feasible; a corresponding `down` statement is included in comments.
- Phase 2 records that existed only in process memory cannot be migrated (they were never persisted). This is documented and accepted.

---

## Consequences

**Positive:**
- Game history, Daily completions, challenges, and result snapshots survive API restarts.
- Historical boards never silently upgrade to a new model version.
- Authorization is enforced at the database layer (RLS), not solely by application routing.
- Anonymous play is fully preserved; authentication is opt-in.

**Negative / Risks:**
- Supabase dependency requires `DATABASE_URL` and `SUPABASE_JWT_SECRET` in production.
- Local dev requires either `supabase start` or a DATABASE_URL pointing to a test database.
- RLS policies add complexity to local testing; misconfigured policies could block reads silently.
- The in-memory implementations used in tests diverge from PostgreSQL semantics over time; the `test_persistence` test suite (which tests against a real database) must be run before any release.

---

## Migration path from Phase 2

1. Existing in-memory game and challenge stores are preserved as `MemoryGameRepo` and `MemoryChallengeRepo` — used in tests.
2. The API startup sequence checks for `DATABASE_URL`:
   - If present: inject `PostgresGameRepo` and `PostgresChallengeRepo`.
   - If absent in production (`DEBUG=False`): fail loudly with a clear error.
   - If absent in development (`DEBUG=True`): fall back to in-memory with a startup warning.
3. Phase 2 anonymous results stored only in localStorage remain in localStorage (unclaimable). Explicit migration tooling is out of scope for Phase 3.0.
