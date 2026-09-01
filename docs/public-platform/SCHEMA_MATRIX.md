# Schema matrix — durable PEAK3 tables

Status: Batch P1 (identity: `profiles`, `user_settings`, `anonymous_subjects`,
`ownership_claims`) + Batch P2 (every remaining durable domain: game
records/CourtBuilder/Peak Draft, progression/records/achievements/streaks,
Ranked, H2H, Arena, Peak Duel Daily, RTT, Daily Grid) are covered. See
`§P2 — remaining domains` below for the second pass. Batch P3 (public
result/leaderboard *contracts* — the HTTP/response-model layer over these
same tables, as opposed to the tables/RLS themselves, already documented
here) made no schema changes; its full findings and the one fix it made
(Ranked's `LeaderboardEntry` no longer serializes `owner_sub`, resolving a
`handle` from `profiles` instead — the `queue_ratings`/`profiles` tables
themselves are unchanged) are in `docs/public-platform/PUBLIC_DATA_CONTRACT.md`.

None of these four tables have a Postgres-level foreign key to
`auth.users(id)` — `auth_sub`/`real_user_sub` are plain `TEXT` columns holding
the JWT `sub` claim. Ownership is enforced entirely by RLS (`auth.uid()::text`
comparisons) plus, on the API side, by never accepting a client-submitted
identity (`app/core/auth.py`'s `AuthSubject.sub` is the only identity any
repository call is keyed on).

## `profiles`

| | |
|---|---|
| Primary key | `id UUID` (`gen_random_uuid()`) |
| User FK | `auth_sub TEXT UNIQUE NOT NULL` — no DB-level FK to `auth.users`, matched against the verified JWT `sub` at the app layer |
| Public / private | Mixed per-row: `is_public BOOLEAN DEFAULT false` gates non-owner reads |
| Authoritative writer | `apps/api` (`PUT /api/v1/profiles/me`), never the client directly |
| Client-writable columns | `handle`, `display_name`, `bio`, `region`, `avatar_key`, `is_public`, `history_public` — all through the API's validated `UpdateProfileRequest`, never a direct table write from the browser |
| RLS enabled | Yes (`20260630124900_rls.sql`) |
| SELECT policy | `profiles_public_read`: `is_public = true`. Owner read is covered by `profiles_owner_write`'s `USING`, since that policy is `FOR ALL`. |
| INSERT/UPDATE policy | `profiles_owner_write` (renamed from `profiles_owner_all`, `20260801100000_rls_gaps.sql`): `FOR ALL USING (auth_sub = auth.uid()::text) WITH CHECK (auth_sub = auth.uid()::text)` |
| DELETE policy | Same `profiles_owner_write` (`FOR ALL`) — no separate delete path exists in the API |
| Column privileges | `SELECT` for `anon`/`authenticated` explicitly excludes `auth_sub` (`20260803120000_profile_column_privileges.sql`) — a public-read row cannot leak the auth correlate |
| Grant hardening | `TRUNCATE`, `TRIGGER` revoked from `anon`/`authenticated` (`20260803140000_…`) |
| Indexes | `profiles_normalized_handle_unique_idx` (unique, partial `WHERE normalized_handle IS NOT NULL`) |
| Uniqueness | `handle`, case-insensitive, via generated `normalized_handle TEXT GENERATED ALWAYS AS (lower(handle)) STORED` (`20260803100000_profile_handle_contract.sql`) — supersedes an earlier functional index (`lower(handle)`) with the identical invariant |
| Realtime | Not published (no evidence of a realtime publication grant for `profiles` in the migrations reviewed) |

## `user_settings`

| | |
|---|---|
| Primary key | `profile_id UUID` (also the FK) |
| User FK | `profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE` |
| Public / private | Private — no public-read policy exists |
| Authoritative writer | `apps/api` (`PUT /api/v1/profiles/me/settings`) |
| Client-writable columns | `timezone`, `reduced_motion`, `theme_preference` |
| RLS enabled | Yes |
| SELECT/INSERT/UPDATE/DELETE policy | `user_settings_owner_write` (`FOR ALL`): `profile_id IN (SELECT id FROM profiles WHERE auth_sub = auth.uid()::text)`, `WITH CHECK` identical |
| Grant hardening | `TRUNCATE`, `TRIGGER` revoked from `anon`/`authenticated` |
| Indexes | PK only |
| Uniqueness | One row per `profile_id` (PK) |
| Realtime | Not published |

## `anonymous_subjects`

| | |
|---|---|
| Primary key | `id UUID` |
| User FK | None directly; `linked_profile UUID REFERENCES profiles(id)`, set once claimed |
| Public / private | Private |
| Authoritative writer | `apps/api` guest-claim flow (`POST /api/v1/auth/claim`) |
| Client-writable | No — `sub_hash` is a server-computed `sha256` of the anon subject, never client-supplied |
| RLS enabled | Yes |
| Policy shape | Deny-all by default per `AUDIT.md`'s migration-comment reference (`20260803140000_…`'s own summary: "STRICT … anonymous_subjects and the deny-all shape") — not re-derived line-by-line this batch |
| Indexes | `sub_hash` (`UNIQUE NOT NULL`) |
| Uniqueness | One row per anonymous credential |
| Realtime | Not published |

## `ownership_claims`

| | |
|---|---|
| Primary key | `id UUID` |
| User FK | `real_user_sub TEXT` (the claiming account's `auth_sub`, not a DB FK) |
| Public / private | Private — an audit log, not user-facing |
| Authoritative writer | `apps/api`'s claim flow only |
| Client-writable | No |
| RLS enabled | Yes |
| Policy shape | Scoped to `real_user_sub` per the same migration-comment reference above |
| Indexes | `anon_subject_id` (`UNIQUE NOT NULL`) |
| Uniqueness | One claim row per anonymous subject (a subject can only ever be claimed once) |
| Extra columns (Batch-added, `20260801110000_guest_claim_and_daily.sql`) | `domain_counts JSONB DEFAULT '{}'` — replaces ever-growing per-domain `INTEGER` columns as claimable domains grow; the three original `INTEGER` columns (`game_count`, `completion_count`, `challenge_count`) are kept and still populated for backward reads |
| Realtime | Not published |

## What connects as what

`apps/api`'s own Postgres access (`asyncpg.create_pool(DATABASE_URL)`) is a
single connection-string identity for the whole process — not per-request,
not scoped by RLS role switching. Whether that connection string's role is
subject to RLS (a normal role) or bypasses it (table owner / superuser, the
Supabase default `postgres` user) was **not verified this batch** and is a
named Phase 4/13 follow-up: if it bypasses RLS, RLS is still correct
defense-in-depth against direct PostgREST/client access, but every ownership
guarantee this document credits to RLS for API-originated writes actually
comes from the `auth_sub = auth.sub` scoping applied explicitly in
`postgres_profile.py`'s own SQL — which was verified correct by live
reproduction (`AUDIT.md` §2).

---

# §P2 — remaining domains

Same caveat as the identity tables above: no table below has a Postgres-level
FK to `auth.users`; every `owner_sub` is a bare `TEXT` column matched against
the verified JWT `sub`. Unless stated otherwise, every table has RLS enabled
and no INSERT/UPDATE/DELETE policy at all for `anon`/`authenticated` (Postgres
denies-by-default for a command with no matching policy), and — as of the
grant-hardening migrations in this batch (`§Grant hardening` below) — no
INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER *grant* either, so a direct client write
attempt fails loudly (`InsufficientPrivilegeError`) rather than silently
matching zero rows. SELECT is preserved wherever an owner/public-read policy
already exists.

## CourtBuilder / 82-0 Peak Season, and Peak Draft (shared engine)

`draft.py` ("Peak Draft") and `perfect_season.py` (CourtBuilder/82-0) are two
distinct product surfaces built on the **same** underlying game-state engine
(`app/services/draft/state.py`) and the **same** `games` table, discriminated
by `board_type` (`PostgresGameRepository` for Peak Draft,
`PostgresCourtLineupRepository` for CourtBuilder, `board_type="perfect_season"`
— `postgres.py:140-143`). `apps/api/app/api/v1/game.py` is neither of these —
it is **Peak Duel** (`/game/daily`, `/game/endless`).

| Table | Purpose | PK | Owner key | FK | Status | Unique | RLS write policy |
|---|---|---|---|---|---|---|---|
| `games` | Active/complete session (Peak Draft OR CourtBuilder, by `board_type`) | `id` UUID | `owner_sub` (nullable — anon play allowed) | none | `status` | — | none (SELECT-only `games_owner`); confirmed live: not even the row's own owner can UPDATE/DELETE via direct client access |
| `board_snapshots` | Board identity/versioning, not user data | `id` UUID | — | — | — | version tuple | `FOR SELECT USING (true)` — fully public, intentional |
| `game_actions` | Append-only action log | `id` BIGSERIAL | via `game_id` FK | `game_id → games` CASCADE | — | `(game_id, idempotency_key)` | `FOR ALL USING (false)` — zero client access |
| `result_snapshots` | Immutable Peak Draft result; `/history` source | `id` UUID | `owner_sub` | — (`game_id` stored as TEXT, not FK) | — | — | none (SELECT-only) |
| `daily_completions` | One official Peak Draft completion/owner/day | `id` UUID | `owner_sub` | — | — | **`UNIQUE(owner_sub, board_id)`** — real DB-level one-per-day guard | none (SELECT-only) |
| `perfect_season_runs` | CourtBuilder public leaderboard entry | `id` UUID | `owner_sub` | — | `score_status` | `game_id UNIQUE` (submission idempotency) | owner-INSERT `WITH CHECK`; no UPDATE (visibility toggle goes through the API's service-role connection only) |
| `perfect_season_run_cards` | 8 roster cards/run | — | via parent | `run_id → perfect_season_runs` CASCADE | — | `(run_id, slot_index)` | inherits parent |
| `perfect_season_saved_runs` | CourtBuilder private personal history | `id` UUID | `owner_sub` | — | `score_status` | `(owner_sub, game_id)` | owner-INSERT `WITH CHECK`, owner-DELETE; **no public-read policy at all** (deliberately private) |

CourtBuilder's daily "already played" gate is enforced only by an index +
application logic, unlike Peak Draft's real `UNIQUE(owner_sub, board_id)` —
a narrower race window under concurrent duplicate requests, not currently
exploitable for score inflation (the save/leaderboard paths have their own
idempotency).

**Live-verified this batch**: created a real CourtBuilder practice game via
`POST /perfect-season/games`, killed and restarted the API process, and
confirmed `GET /perfect-season/games/{id}` returned the identical game state —
proves both cross-restart persistence for this vertical and that the
grant-hardening migrations below did not break the legitimate write path (the
API connects as `postgres`, the table-owning role, unaffected by any REVOKE
issued against `anon`/`authenticated`).

## Progression / personal records / achievements / streaks

| Table | Purpose | PK | Owner key | Unique | RLS |
|---|---|---|---|---|---|
| `xp_policy_versions` | XP curve config | `version` | — | — | public read |
| `progression_events` | XP history (private) | `id` | `owner_sub` | — | owner-only |
| `user_progress` | Current XP/level | `owner_sub` | `owner_sub` | PK | owner-only |
| `personal_records` | Best-ever records | `id` | `owner_sub` | `(owner_sub, record_type, mode, lineup_model_version, card_pool_version, ruleset_version)` | owner + public (public profile) |
| `personal_record_events` | Append-only record history | `id` | `owner_sub` | — | owner-only |
| `achievement_definitions` | Catalog | `achievement_key` | — | — | public where `is_hidden = false` |
| `achievement_awards` | Unlocks | `id` | `owner_sub` | — | owner + public |
| `streak_states` | Live streak state | `owner_sub` | `owner_sub` | PK | owner + public |
| `streak_events` | Append-only streak history | `id` | `owner_sub` | — | owner-only |

**Bug found and fixed this batch (not a new gap — pre-existing, newly
surfaced by running the full RLS suite for real):**
`personal_records_public` / `achievement_awards_public` / `streak_states_public`
each subquery `profiles.auth_sub` directly. `20260803120000_profile_column_privileges.sql`
(Batch P1 era) revoked column-level SELECT on `profiles.auth_sub` from
`anon`/`authenticated` to close a different leak. Since Postgres must be able
to evaluate *every* RLS policy attached to a table for a command (they combine
with OR) and a privilege error while evaluating any one of them fails the
*whole* query, this silently broke **all** reads of these three tables for
`authenticated` clients — including the legitimate owner reading their own
row, not just the public-profile case. Verified live: an authenticated
connection reading its own `streak_states` row failed with
`permission denied for table profiles`. Fixed by
`20260901130000_fix_progression_public_policy_privilege.sql`, which adds a
`SECURITY DEFINER` helper `is_public_profile_sub(sub)` (same established
pattern as `is_ranked_match_participant()` below) so the privilege check runs
as the function owner, not the caller — the function returns a boolean only,
so no column value is exposed to the client. Verified fixed: full RLS suite
went from 3 failing to 225/225 passing after this migration.

## Ranked (Glicko-2 duels)

Config/catalog (public read): `ranked_queue_versions`, `rating_algorithm_versions`,
`division_versions`.

| Table | Purpose | PK | Owner key | Notable |
|---|---|---|---|---|
| `ranked_queue_entries` | Waiting-room row | `id` | `owner_sub` | partial unique `(owner_sub, mode) WHERE status='waiting'` — the anti-duplicate-queue guard |
| `ranked_matches` | Immutable pairing + board | `id` | via participants | SELECT via `is_ranked_match_participant()` SECURITY DEFINER (avoids self-recursive RLS) |
| `ranked_match_participants` | One row/seat | `id` | `owner_sub` | opponent row visible only once `ranked_matches.status='settled'` |
| `ranked_match_submissions` | Result/participant | `id` | `owner_sub` | `UNIQUE(match_id, idempotency_key)`, `UNIQUE(match_id, owner_sub)` |
| `ranked_opponent_history` | Repeat-opponent cooldown | `id` | `owner_sub` | `FOR ALL USING (false)` — service-role only |
| `rating_periods` | One/settled match | `id` | — | `match_id UNIQUE`; `FOR ALL USING (false)` |
| `ranked_match_settlements` | Immutable settlement | `id` | via 2 participant cols | `match_id UNIQUE`; **`BEFORE UPDATE/DELETE` trigger raises** — DB-enforced append-only, independent of RLS |
| `rating_ledger_entries` | Append-only rating source of truth | `id` | `owner_sub` | same **immutability trigger** as settlements |
| `rating_snapshots`, `queue_ratings`, `placement_states` | Derived caches | — | `owner_sub` | owner-only; public leaderboard served via a **service-role query gated on `RANKED_PUBLIC_LEADERBOARD_ENABLED`**, not RLS |
| `ranked_integrity_events`, `ranked_abort_allowances` | Abuse/anomaly log, protected-abort credits | `id` | `owner_sub` | `FOR ALL USING (false)` |

**Settlement idempotency (verified against code, not assumed):** `ranked_match_settlements.match_id UNIQUE`
+ one transaction for the whole settlement write; a second `INSERT` raises
`UniqueViolationError` → translated to `DuplicateSettlement`. Proven by
`test_settlement_occurs_exactly_once` / `test_two_simultaneous_completion_requests_create_one_result`
(`tests/test_ranked_settlement.py`), the latter literally running two
`attempt_settlement()` calls concurrently via `asyncio.gather`.

**Known gap, deferred to Batch P4 (matchmaking/settlement), not fixed this
batch:** `record_submission`'s idempotency check does a `SELECT` before an
`INSERT ... ON CONFLICT (match_id, idempotency_key)`; a genuine double-submit
race with two *different* idempotency keys from the same user on the same
match can both pass the initial SELECT and then the second hits the unwrapped
`ranked_match_submissions_user_match_unique` constraint uncaught (→ 500
instead of the idempotent 200 the docstring promises). Narrow window, not
exploitable for a score benefit, but a real correctness gap for Batch P4 to
close alongside the rest of Ranked settlement.

## Head-to-Head (async RTT 1v1)

**Not the same tables as `challenges`/`challenge_participants`/`challenge_settlements`**
(20260630124800_challenges.sql) — deliberately: that table's
`challenges_public_meta` policy is `FOR SELECT USING (true)`, which would leak
`challenger_snapshot` (the spoiler) to anyone with the anon key; H2H's whole
contract is "neither side sees the other's result until both submit."
`challenge_participants`/`challenge_settlements` are, separately, **fully dead
code** — RLS-protected, migrated, indexed, and referenced by zero application
code (grepped the full API tree). Not a live risk (empty table, RLS
default-denies), just schema nobody uses.

| Table | Purpose | PK | Owner key | Public token | RLS |
|---|---|---|---|---|---|
| `head_to_head_matches` | One async match | `match_id` | via participants | `invite_hash = sha256(invite_id)` UNIQUE — the invite itself is never stored | participant-read only |
| `head_to_head_participants` | One seat/side | `(match_id, participant_sub)` | `participant_sub` | — | **self-only** read (not match-scoped — a match-scoped policy on this table would self-recurse; self-only is also the substantively correct rule, since the opponent's row carries their result) |

Settlement: conditional `UPDATE ... WHERE settlement IS NULL` / `WHERE result
IS NULL` — "first write wins," no unique-constraint race needed, proven by
`test_submission_is_idempotent_and_the_first_write_wins` /
`test_the_settlement_is_written_by_the_second_submission_not_by_a_read`
(`tests/test_head_to_head.py`).

## Arena (Three-Man Weave, Twenty-Dollar Showdown) + Peak Duel Daily

Arena is the most concurrency-hardened domain in the codebase: `apply_command`
opens a transaction, `SELECT ... FOR UPDATE` (blocking, not `SKIP LOCKED` —
deliberately serializes all commands on one match), checks the
`(match_id, idempotency_key)` composite PK **first**, and derives actor
identity/seat index from the server session, never the request body.

| Table | Purpose | Notable RLS |
|---|---|---|
| `arena_matches` | Match header | seat-holder read |
| `arena_match_seats` | One row/seat | **self-only** (not seat-holder-wide — another seat's rating/liveness can be a spoiler in a hidden-information mode) |
| `arena_match_commands` | Idempotency ledger, `(match_id, idempotency_key)` PK | `FOR ALL USING (false)` — zero client access |
| `arena_match_events` | Replay log | seat-scoped, gated on a stored `visibility` column (`public`/`seat`) — not a serializer decision |
| `arena_turns` | Clock state | any seat holder |
| `arena_match_results` | Final result/seat | seat-holder AND `match.status='completed'` |
| `arena_public_queue` | Matchmaking queue | partial unique — one active entry/owner; **already correctly hardened at the grant layer before this batch** (verified live, unlike its siblings below) |
| `arena_ratings` | Public rating | `USING (true)` (fully public row) but column-level grant withholds `owner_sub` — the only "public row, private column" pattern in the codebase |
| `arena_rating_history` | Rating change log | owner-only (deliberately NOT match-scoped, to stop inferring an opponent's rating swing) |
| `peak_duel_daily_results` | One Peak Duel Daily attempt | `UNIQUE(owner_sub, mode, daily_key)` — real first-attempt-is-official guard; owner may be a real account OR a signed `anon:...` cookie subject; no public-read policy (not a leaderboard table) |

**Realtime: not used anywhere in this app.** No `ALTER PUBLICATION`/
`supabase_realtime` grant in any migration; no `.channel(`/`postgres_changes`
usage in the frontend. Every "live" surface (Arena included) is poll-driven —
`GET /arena/matches/{id}` calls `clock.enforce()` on every read, substituting
for a push channel. Phase 11 (Realtime audit) will find nothing to configure
here; this is a deliberate architecture choice, not an oversight.

## Grant hardening (Batch P2 — new migrations)

A live grant check (`information_schema.role_table_grants`), not a re-read of
the SQL files, found the class of gap `20260801130000_peak_duel_results_revoke.sql`
and its siblings had already fixed for some tables still present on **~35
more**, most consequentially `ranked_match_settlements` and
`rating_ledger_entries` — rating integrity's two most safety-critical tables
— plus `games`, `daily_completions`, `result_snapshots`, every progression
table, and `anonymous_subjects`/`ownership_claims`. **None were exploitable
today**: every affected table already had RLS enabled with either an
owner-scoped SELECT-only policy (no INSERT/UPDATE/DELETE policy — implicit
deny) or an explicit `FOR ALL USING (false)`, and a live write attempt as a
different authenticated role, or even as the row's own owner, was confirmed
blocked in every case before any of these migrations ran — verified with real
`INSERT`/`UPDATE`/`DELETE` attempts, not assumed from reading policy SQL. The
gap was the weaker of the two layers this codebase's own convention already
argues for (a REVOKE fails loudly at the privilege check; RLS-policy-absence
lets the same attempt return successfully having silently done nothing).
Five new migrations closed it:

- `20260901090000_game_records_client_write_revoke.sql` — `games`, `daily_completions`, `result_snapshots`
- `20260901093000_progression_tables_client_write_revoke.sql` — all 9 progression tables
- `20260901096000_ranked_tables_client_write_revoke.sql` — all 16 Ranked tables
- `20260901120000_revoke_remaining_write_grants.sql` — the remaining ~33 tables (board_snapshots, challenges family, version-catalog tables, game_actions, etc.)
- `20260901140000_anonymous_subjects_ownership_claims_revoke.sql` — these two also had SELECT still open (no legitimate direct-read path for either), unlike every other table here

Final state, verified live: only `profiles` and `user_settings` still carry a
client write grant — both intentional (`FOR ALL ... WITH CHECK` owner-write
policies that legitimately allow a direct client write).
