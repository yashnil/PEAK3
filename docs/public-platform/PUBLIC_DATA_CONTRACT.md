# PEAK3 Arena — Public Data Contract

Batch P3. Principle: **PRIVATE DATABASE ROW != PUBLIC API RESPONSE.** Every
route below that is reachable without ownership is audited against that
principle; fixes made this batch are called out inline, everything else is
either already correct (with evidence) or a documented, deferred gap.

---

## 1. Public surface inventory

| Surface | Route(s) | Auth required? | Public identifier | Data source | Server endpoint | DB table/view | Real or placeholder? | Safe for anonymous? |
|---|---|---|---|---|---|---|---|---|
| **Public profile** | `GET /profiles/{handle}` | No (owner bypasses the `is_public` gate only) | `handle` (case-insensitive) | `profiles` | `apps/api/app/api/v1/profiles.py::get_public_profile` | `profiles` | Real | **Yes — fixed this batch, see §2** |
| **Peak Draft challenge share** | `GET /draft/challenges/{token}/meta`, `.../comparison` | No | HMAC-signed `challenge_token` | `challenges` | `draft.py` | `challenges` | Real | Yes (spoiler-safe by field selection) |
| **CourtBuilder shared result** | `GET /perfect-season/games/{game_id}/shared-result` | No | bare `game_id` UUID, gated on `status="result_ready"` | `games` (`board_type="perfect_season"`) | `perfect_season.py` | `games` | Real | Yes (404 for not-ready, same as not-found) |
| **CourtBuilder leaderboard** | `GET /perfect-season/leaderboard`, `.../leaderboard/me` | Board: no. `/me`: yes | row `id` | `perfect_season_runs` | `perfect_season.py` | `perfect_season_runs` | Real, immutable rows | Yes |
| **H2H invite** | `GET /run-the-table/h2h/invite/{token}` | No (rate-limited) | HMAC-signed `invite_token` wrapping a 192-bit random id; DB stores only its hash | `head_to_head_matches` | `head_to_head.py` | `head_to_head_matches`/`head_to_head_participants` | Real | Yes (spoiler-free descriptor only) |
| **H2H settled result** | none — no unauthenticated permalink exists | — | — | — | — | — | N/A | N/A — every H2H result route is `RequiredAuth` + participant-gated |
| **RTT non-H2H challenge link** | `POST /run-the-table/runs/{id}/challenge` (mint, no ownership check — deliberate), `GET /run-the-table/challenges/{token}` (descriptor) | No | HMAC-signed, self-describing (seed in plaintext) `challenge_token`; **not persisted server-side at all** | derived from `run_the_table_runs` at mint time | `run_the_table.py` | (stateless after mint) | Real | Yes (seed is not secret by design) |
| **Ranked leaderboard** | `GET /ranked/queues/{mode}/leaderboard`, `.../leaderboard/me` | Board: no. `/me`: yes | `handle` (was `owner_sub`) | `queue_ratings` + `profiles` | `ranked.py` | `queue_ratings` | Real | **Yes — fixed this batch, see §5/§7** |
| **Ranked match** | none — no spectator permalink | — | — | — | — | — | N/A | N/A — every route `RequiredAuth` + participant-gated |
| **Daily Grid leaderboard** | `GET /daily-grid/leaderboard` | No | `handle` | `daily_grid_leaderboard_entries` | `daily_grid.py` | `daily_grid_leaderboard_entries` | Real | Yes |
| **Arena rating leaderboard** | `GET /arena/leaderboard/{mode}` | No | `handle` | `arena_ratings` | `arena.py` | `arena_ratings` | Real backend, **no frontend consumer** (`ARENA_COMING_LATER`) | Yes if ever wired |
| **Static PEAK3 model rankings** | `GET /leaderboards/*`, `GET /peaks/*`, `GET /seasons/*`, `GET /players/*` | No | player slug / rank | `data/web/*.json` (generated, offline) | `leaderboards.py`/`peaks.py`/`seasons.py`/`players.py` | none — no DB, no user data | Real (reference data) | Yes — not a user leaderboard at all, see §6 |

---

## 2. Public profile contract

**Fixed this batch.** `GET /profiles/{handle}` previously returned the same
`ProfileResponse` model used by the private `GET /profiles/me` — including
`id` (internal profile PK), `region`, `is_public`, `history_public`, none of
which any consumer (the `/u/[handle]` page) actually reads. A new, separate
`PublicProfileResponse` model (`apps/api/app/models/profile.py`) is now the
only thing this route can return, to **every** caller including the
profile's own owner:

**Exposed:** `handle`, `display_name`, `bio`, `avatar_key`, `joined_at`.

**Never exposed by this route:** `id` (profile PK), `region`, `is_public`,
`history_public`, and — as always — `auth_sub`/email/any OAuth metadata
(never even reaches the `Profile` dataclass this route reads).

**Verified live** (real Supabase-issued JWTs, real local Postgres,
`docs/public-platform/AUDIT.md`'s live-testing pattern):
- Anonymous → public handle: `200`, exactly the 5 fields above.
- Anonymous → private handle: `403 {"detail":"profile_private"}`.
- Anonymous → unknown handle: `404 {"detail":"profile_not_found"}`.
- Authenticated stranger → same public handle: identical response to
  anonymous (no extra fields for being logged in).
- Authenticated stranger → someone else's private handle: `403`, same as
  anonymous.
- **Owner viewing their own PRIVATE profile via this route**: `200`, still
  the 5-field public projection — not the extended private shape. (Their
  full private profile remains available only via `GET /profiles/me`.)
- Case-insensitive lookup (`P3PUBLICA` resolves the same row as
  `p3publica`) — via `normalized_handle`, unaffected by this batch.
- Cross-account mutation: `PUT /profiles/me` is identity-scoped (keyed off
  the caller's own verified JWT `sub`), not target-id-scoped — there is no
  code path for account B to write to account A's row through this or any
  other profile route.

RLS-level proof (not just API-level): new tests
`test_a_stranger_cannot_update_another_users_public_profile` and
`test_anonymous_cannot_update_a_public_profile`
(`apps/api/tests/integration/test_rls_policies.py`) confirm a direct
Postgres write attempt (bypassing the API entirely) against another user's
`profiles` row returns `UPDATE 0`, for both an authenticated stranger and
`anon`.

---

## 3. Public result contract, by game mode

| Mode | Classification | What's returned | Notes |
|---|---|---|---|
| Peak Draft challenge | Unlisted public (token-gated) | `ChallengeMeta` (board label, challenger display, dates, status) + `ChallengeComparisonResponse` (both sides' `ComparisonPlayer` — display_name, ratings, selected cards, DNA/synergy) once settled | `/comparison` is a **GET that writes** the settlement on first call — guarded by an ownership check on the *recipient's* game id (closing a documented prior IDOR), but the GET-writes shape itself remains a design smell, not currently exploitable |
| CourtBuilder shared result | Fully public (unguessable-UUID-gated) | `SharedCourtResultResponse` — final slots, simulation result, respin history/versions | Access gated purely by `status == "result_ready"`; pre-completion access returns the identical 404 as a nonexistent id (no oracle) |
| CourtBuilder leaderboard entry | Fully public, immutable | `PerfectSeasonRunPublic` — `display_name` (=handle, frozen at submission time), wins/losses/score, versions | Handle staleness noted in §6 |
| H2H invite | Unlisted public | `InviteDescriptorResponse` — creator display name, status, expiry, seat count | Zero result/roster/seed fields — literally cannot render a spoiler, nothing is sent |
| H2H settled result | **Owner/participant-only** | — | No unauthenticated permalink exists for a settled H2H match; this is not a "public share" mechanism despite superficially matching the pattern of the others |
| RTT non-H2H challenge | Unlisted public, board-reproduction only | `ChallengeDescriptorResponse` — seed, run_type, versions | No result is ever exposed by this mechanism — it reproduces a board, not a receipt |
| Ranked match | **Owner/participant-only** | — | No spectator permalink exists |

---

## 4. Token / public-ID security

| Token | Entropy / mechanism | Derived from sensitive data? | DB-unique? | Can it mutate anything? |
|---|---|---|---|---|
| Peak Draft `challenge_token` | HMAC-SHA256 over a **self-describing** JSON payload (board params + 8-byte nonce) — opacity is not the security property, forgery-resistance is | No | `sha256(token)[:32]` stored, not the token itself | Indirectly: `GET .../{token}` (reproduction) creates an owned game as a side effect of a GET; guarded, not a live issue |
| H2H `invite_token` | `secrets.token_urlsafe(24)` = 192 bits CSPRNG; DB stores only `sha256(invite_id)` | No | Yes | Read + self-seat only (`POST .../accept`); cannot submit/settle/touch the opponent's run |
| RTT `challenge_token` | HMAC-SHA256, self-describing (seed in plaintext), **not persisted at all** — stateless | No | N/A (no DB row) | Creates a new run for the *caller* using the token's seed — deliberate, seed isn't secret |
| CourtBuilder `game_id` (shared-result) | Bare, unsigned DB UUID — **not a token** | No | Yes (PK) | No — every mutator requires `_load_owned_lineup` |

**Classification note (P3.4's "don't assume enumeration is always a
vulnerability"):** CourtBuilder's shared-result identifier is intentionally
a raw UUID, not a signed token — its trust model rests on UUID-space
unguessability plus the `result_ready`-only gate, not cryptographic opacity.
This is a materially different (and here, acceptable) model from the
HMAC-signed mechanisms above; documented as "share-by-raw-UUID," not
downgraded to a token and not treated as a defect.

No public ID in this system is derived from `auth_sub` or email. No public
ID, once issued, can be used to rewrite a settled/immutable result — every
write path re-derives the actor from server-side session state (JWT sub /
participant row), never from a client-supplied id, confirmed across every
mutating route in scope this batch.

---

## 5. Leaderboard taxonomy

| | **A — Static PEAK3 rankings** | **B — Daily Grid** | **C — CourtBuilder/82-0** | **D — Ranked** | **E — Arena (Three-Man-Weave/Twenty-Dollar)** |
|---|---|---|---|---|---|
| Source of truth | Committed/generated JSON (`data/web/*.json`) | `daily_grid_leaderboard_entries` | `perfect_season_runs` | `queue_ratings` + rating ledger | `arena_ratings` |
| Metric | `prime_score`/`prime_index` (offline model) | grid score + completion time | wins/losses/lineup_score | Glicko-2 rating/RD | Glicko-2-style rating/RD |
| Settlement event | None (build-time) | `POST /daily-grid/official` | `POST /perfect-season/games/{id}/submit` | `attempt_settlement` inside match action resolution | server-driven `_advance()` → `settle_match_rating` |
| Public fields | rank, player identity, score, components | rank, handle, score, completion_time | id, handle(=display_name), mode, wins/losses/score, versions | rank, **handle** (was owner_sub), rating, rd, division | rank, handle, rating, rd, record, match composition |
| Anonymous readable | Yes | Yes | Yes | Yes | Yes (no frontend consumer yet) |
| Update writer (sole path) | Offline build script, never at request time | `_qualify_for_leaderboard`, called only from official-save/retry-complete | `leaderboard_repo.submit_run` inside `submit_run` only | `rating_repo.record_match_rating` inside settlement only | same, inside server-driven advance only |
| Classification | **Not a user leaderboard** — reference data | Real, persisted | Real, persisted, immutable | Real, persisted — **had a real defect, fixed this batch (§7)** | Real backend, **not yet wired to any frontend page** (deliberate product deferral, `ARENA_COMING_LATER`) |

Category A must never be confused with B–E: it ranks real NBA players by a
computed score and has no relationship to any PEAK3 Arena account,
competitive result, or user data whatsoever.

---

## 6. Ranked leaderboard authority (P3.6)

Traced end-to-end: `submit_action` → on `draft_complete`, `attempt_settlement`
computes rating purely from `new_state.lineup_evaluation` (the server's own
post-action game state) → `rate_match` (Glicko-2) → `rating_repo.record_match_rating`
writes `queue_ratings`/rating ledger in one transaction → `GET
/ranked/queues/{mode}/leaderboard` reads that table (service-role query,
gated by `RANKED_PUBLIC_LEADERBOARD_ENABLED`) → `RankedLeaderboard.tsx`
renders it.

**Confirmed: no client-suppliable field anywhere in this chain sets
rating/rating_delta/rank/wins/losses/official score.** The only
client-controlled input on the settlement path is the in-game action `dict`
(`select_card`/`use_hold`/`use_reframe`/`confirm` + `card_id`/`role`), which
is validated against server-held game state, not trusted as a final number.
This was already correctly server-authoritative before this batch — **the
defect found and fixed was a privacy leak in the response model, not an
authority/integrity gap** (see §7). The known settlement-idempotency race
(two concurrent submissions, different idempotency keys) remains exactly as
documented in Batch P2 — **explicitly deferred to Batch P4**, not touched
here; it does not affect whether the leaderboard is meaningful (settlement
still happens exactly once per match in the normal, non-race path).

---

## 7. Leaderboard privacy — the defect, and the fix

**Found:** `LeaderboardEntry.owner_sub: str` (`app/models/ranked.py`) — the
raw Supabase `auth.uid()` — was returned by `GET /ranked/queues/{mode}/leaderboard`
(**no auth required**) and rendered directly as the "Player" column in
`RankedLeaderboard.tsx`. Every sibling public leaderboard in this codebase
(Daily Grid, CourtBuilder, Arena) already withholds this exact value and
shows only a chosen `handle` instead — Ranked was the one exception.

**Fixed:**
- `LeaderboardEntry.owner_sub` → `LeaderboardEntry.handle`, resolved via
  `profile_repo.get_profile_by_auth_sub` (the same call Arena's leaderboard
  already makes) in both `GET /ranked/queues/{mode}/leaderboard` and `GET
  .../leaderboard/me`.
- A rated player with no chosen public handle is **unlisted** (rating not
  lost — same tradeoff Arena's leaderboard already makes; `rank` reflects
  true position, so gaps are expected and correct).
- `/leaderboard/me` still reports the caller's own `your_rank` regardless of
  whether they have a handle (it's their own authenticated view of their own
  standing), but filters any *other* unlisted player from the returned
  window the same way the public route does.
- Frontend: `apps/web/src/types/ranked.ts`'s `LeaderboardEntry` and
  `RankedLeaderboard.tsx` updated to match (`@handle`, matching the same
  `@handle` convention already used on the profile page).

**Verified:** memory-mode test suite extended
(`test_ranked_placements_leaderboard.py`) — existing tests updated to create
real handles before asserting on leaderboard contents (they previously
asserted on `owner_sub`, which no longer exists in the response), plus a new
`test_leaderboard_omits_a_rated_player_with_no_chosen_handle` proving the
unlisted-without-a-handle behavior and asserting `"owner_sub" not in entry`
on every row. Frontend unit tests updated (`ranked-leaderboard.test.tsx`)
with an explicit `not.toHaveTextContent(/owner_sub/i)` regression test.
Typecheck clean.

No client can set `rating`/`rank`/`wins`/`losses` (see §6) — this fix is
purely about what identity is shown, not the integrity of the numbers shown.

---

## 8. Public result immutability

| Mechanism | Immutable snapshot or live authoritative view? |
|---|---|
| Peak Draft comparison | Write-once cache — `record.settlement` computed and persisted on first call, every subsequent call returns the identical cached dict |
| CourtBuilder shared result | Live view, gated immutable in practice — every mutator route rejects once `status == "result_ready"`, so the row cannot change once shareable |
| CourtBuilder leaderboard row | Immutable — no UPDATE path except the owner's own visibility toggle |
| H2H invite/receipt | Live view with server-side spoiler gating — opponent block is withheld (`status:"hidden"`, `result:None`) until both sides complete; settlement itself is first-write-wins (Batch P2) |
| Ranked leaderboard | Live standing (rating changes every match by design) — not a "result" needing spoiler-safety |
| RTT challenge descriptor | Stateless, derived purely from the token's own signed claims — nothing to go stale |

No public result/leaderboard mechanism in scope allows a browser to rewrite
an official score, opponent, winner, lineup, or rating result — every
mutating route re-derives the actor and target from server-side state, never
a client-supplied id (confirmed for every route touched this batch).

---

## 9. Public profile + history relationship (P3.13)

Per the explicit instruction not to add new history UI or accidentally make
private durable history public merely because it exists:

| History | Classification |
|---|---|
| Peak Draft `result_snapshots` (`/history`) | **PRIVATE ONLY** — owner-only route, no public projection exists or was added |
| RTT past runs (`list_runs_for_owner`) | **NOT EXPOSED** — fully durable server-side (Batch P2), but no route (public or private) currently browses it; documented as a known product gap in Batch P2's `AUDIT.md`, not touched this batch |
| Daily Grid official results (`GET /daily-grid/results`) | **NOT EXPOSED** to any frontend page (same Batch P2 finding) — the route exists and is owner-scoped (`RequiredAuth`), but nothing calls it; not made public this batch |
| CourtBuilder saved runs (`perfect_season_saved_runs`) | **PRIVATE ONLY** — no public-read RLS policy exists at all (Batch P2 finding), unaffected by this batch |
| CourtBuilder submitted leaderboard runs | **PUBLIC SUMMARY** — `PerfectSeasonRunPublic`, the intentional public projection (§3) |
| Progression (personal records/achievements/streaks) | **NOT EXPOSED** — `_public` RLS policies exist in the schema (anticipating a future public-profile projection) but no route currently joins them into `/profiles/{handle}` or anywhere else; `PublicProfileResponse` (§2) deliberately does not include them, per "do not invent profile fields merely because they would look nice" |

Nothing durable and private was made public this batch. `PublicProfileResponse`
was, if anything, narrowed relative to what it previously returned.

---

## 10. Response model / serialization boundary audit (P3.15)

Full route-by-route inventory produced this batch (not reproduced in full
here — see the session's research). Headline findings:

- **Every route that returns cross-user data has an explicit `response_model`.**
- **Several fully-public, non-user-data routes have no `response_model` at
  all**: `GET /methodology`, `GET /meta`, `GET /nba-facts/today`, `GET
  /auth/me`, `POST /auth/anon`, `POST /draft/challenges`, `GET /health`,
  `GET /health/readiness`, `POST /perfect-season/dev/simulate-lineup`
  (flag-gated, 403 by default). None currently leak anything — all either
  serve static/generated build-time content or the caller's own identity —
  but none has a Pydantic-level guard against a future field being added
  upstream and shipping unfiltered. **Documented as a hardening backlog
  item, not fixed this batch** (no evidence of an actual leak; adding ~8
  models is a larger change than this batch's principle of "fix actual
  defects, don't invent work" justifies without a concrete finding driving
  it).
- **`AnswerResponse.winner`/`.loser` and `PlayerDetailResponse.windows` are
  untyped `dict`** carrying full raw public-NBA-dataset records (no PII, no
  ownership field — this is the *static model* data from §5 Category A, not
  user data). Same "fragile but not exploitable" class as above — documented,
  not fixed.
- **`RunStateResponse`/`RulesetMetaResponse` (RTT) deliberately use
  `extra="allow"`** — an intentional, tested design choice (module comment +
  a superset-check test) so new engine fields flow through without a model
  edit. Verified `owner_sub` is never among the fields `public_state()`
  actually constructs. Correct as designed; the tradeoff is that
  response_model itself provides no enforcement here — noted for whoever
  next touches `services/run_the_table/public.py`.
- **The one real, previously-undetected leak was Ranked's `LeaderboardEntry.owner_sub`**
  (§7) — the response model *was* explicit and enforced, it simply included
  the wrong field. Fixed.

---

## 11. Error semantics (P3.16)

The codebase already applies a consistent, deliberate convention across
every domain audited this batch: **404 for "doesn't exist," 403 for "exists
but you may not see it,"** with two notable, intentional exceptions that
avoid leaking existence unnecessarily:

- H2H's invite descriptor collapses "unknown invite" and "forged/malformed
  token" to the **identical** `404 invalid_invite` — "an unknown invite and
  a forged invite answer identically, so a probe learns nothing from the
  difference" (verbatim code comment).
- CourtBuilder's shared-result route returns the **identical** `404 "Result
  not found"` for both "no such game" and "not finished yet" — explicitly
  documented as "never 403 ... not an oracle for which unguessable ids
  exist."
- Public profile is the one deliberate **exception** to identical-response
  collapsing: `403 profile_private` is distinct from `404 profile_not_found`
  at the API level (existing, tested behavior, preserved this batch) — a
  mild, intentional existence signal ("this handle is taken and set to
  private" vs "available"), consistent with how many social products behave
  and explicitly exercised by the frontend, which flattens both to the same
  "not found" UI regardless (`u/[handle]/page.tsx`).

One inconsistency noted, not fixed (cosmetic): Peak Draft's
`_verify_challenge_token` returns a bare string `detail` (`"token_malformed"`)
where the rest of the file uses `{error_code, message}` — the frontend
already works around it via string equality, so this is a documentation
note, not a behavior change.

---

## 12. Known gaps — deferred, not fixed this batch

- **Ranked settlement idempotency race** (Batch P2 finding) — belongs to
  Batch P4 per explicit instruction.
- **Arena rating leaderboard has no frontend page** — backend is correct and
  privacy-safe (`handle` only, no `owner_sub`), but nothing renders it;
  product-scope decision, not a persistence or privacy defect.
- **Response-model hardening backlog** (§10) — ~8 routes with no explicit
  Pydantic model, none currently leaking anything.
- **CourtBuilder leaderboard handle staleness** — a submitted run keeps
  whatever handle its owner had *at submission time*; a later rename does
  not propagate. Contrast with Daily Grid/Arena/Ranked, which resolve the
  current handle live, at read time. Minor, long-lived drift risk on a
  public board; not fixed this batch (would require either a live join at
  read time — a real behavior/performance tradeoff — or a backfill job; both
  are a larger, deliberate decision this batch's scope doesn't cover).
- **Peak Draft `/comparison`'s GET-that-writes shape** — currently guarded
  and safe, but a design smell relative to H2H's pure-read receipt pattern;
  worth a refactor in a later pass, not a live defect.
- **RTT/Daily Grid history browsing UI absence** — Batch P2 finding,
  reiterated in §9, still not fixed (out of scope: persistence already
  exists, this is a UI/product decision).
