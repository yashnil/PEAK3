# Schema matrix — auth / handle / profile tables

Status: Batch P1 scope only — `profiles`, `user_settings`,
`anonymous_subjects`, `ownership_claims` (the identity domain, migration
`20260630124500_identity.sql` plus everything that later touched it). The
remaining ~30 migrations (game records, versioning, challenges, progression,
ranked, arena, daily grid, run-the-table, head-to-head, telemetry) are
inventoried but not yet matrixed in this format — Batches P2–P4.

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
