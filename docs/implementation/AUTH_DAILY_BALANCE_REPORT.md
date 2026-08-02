# AUTH / DAILY RESET / RUN THE TABLE — Final Report

Companion to `AUTH_DAILY_BALANCE_PLAN.md`. Records what shipped, what it was
verified against, and what is still blocked on configuration nobody here can
supply.

**No commit, push, pull request, merge, or stash occurred.** `git stash list`
is empty and `HEAD` is still `35145c6`, the pre-existing checkpoint. The entire
diff is unstaged, for review.

---

## 1. Baseline and final state

| | Baseline | Final |
|---|---|---|
| Branch | `feature/auth-daily-balance` | unchanged |
| `HEAD` | `35145c6` | unchanged — nothing committed |
| Working tree | clean, 1 untracked (the pass spec) | 123 modified · 50 untracked · 1 deleted |
| Stashes | 0 | 0 |
| Model tests | 789 | **864 passed, 1 xfailed** |
| Lineup tests | 43 | **43 passed** |
| API tests | 919 collected / 901 CI-selected | **1046 passed, 1 skipped, 5 deselected** |
| Supabase integration + RLS (real DB) | 0 — had never run | **72 passed** |
| Vitest | 789 | **1089 passed** (39 files) |
| Playwright | 300 | **331 passed** (29 auth + 2 RTT specs added) |
| Migrations applied to the hosted project | **0 of 21** | **25 of 25** |

The one deleted file is `apps/web/src/app/auth/callback/page.tsx`, replaced by a
route handler (§3).

---

## 2. Agent topology and ownership

Six parallel read-only audits ran first; the lead wrote
`AUTH_DAILY_BALANCE_PLAN.md` before any writer touched a file. Six writers then
worked under **strict disjoint file ownership** (plan §1) against frozen
cross-track contracts (plan §2). No two agents wrote the same path, and no
merge conflict occurred.

| Track | Scope | Outcome |
|---|---|---|
| Lead | JWKS verification, config, health, docs, integration, screenshots | §3, §9, §10 |
| A | Daily-time authority across five modes, both apps | §5 |
| B | Google + magic link, SSR cookie sessions, auth UI | §3 |
| C | Persistence, RLS, guest claim | §4 |
| D | Standard v2 engine, receipt semantics, balance audit | §6, §7 |
| E | RUN THE TABLE clarity, receipt rendering | §6 |
| F | Telemetry | §8 |

Cross-track handoffs that the contracts made possible: Track E coded the
receipt renderer against the `ReceiptItem` contract while Track D was still
implementing it, and the two matched field-for-field on first integration.

---

## 3. Authentication

### 3.1 The finding that reordered the work

The hosted development project publishes a single **ES256 / EC P-256** key at
`/auth/v1/.well-known/jwks.json` and has **no symmetric JWT secret**. The
backend's only verification path was `algorithms=["HS256"]` against
`PEAK3_SUPABASE_JWT_SECRET`, so **every authenticated request against this
project would have failed**. Migrating to JWKS was the precondition for the
rest of the pass, not an optional modernisation — and the correct response to
"there is no JWT secret" was to stop looking for one, not to fabricate a
placeholder.

### 3.2 Backend — `app/core/jwks.py`, `app/core/auth.py`

`verify_access_token()` selects a regime **per token** from its `alg` header, so
a project mid-migration works with both key types live.

* **Asymmetric path** accepts only `ES256`/`RS256`/`EdDSA`. A symmetric `alg`
  can never reach it, so a token cannot downgrade itself into having a public
  key treated as an HMAC secret. A hand-assembled HS256 token signed with the
  project's own public key is rejected — tested.
* **`aud` and `iss` are now verified.** The old path verified neither, so any
  holder of the shared secret — including a token from an unrelated project
  sharing it — was accepted.
* **`kid` is required**, and "not in the published key set" (401) is distinct
  from "we could not fetch the set" (logged, still 401, never a 500).
* **`sub` is required.** Previously `claims["sub"]` was unguarded, so a validly
  signed token without a subject produced a **500 instead of a 401**.
* **Key cache**: 600 s TTL, 30 s minimum refresh interval, concurrent misses
  coalesced behind one lock, stale keys served through a transient JWKS outage
  so a network blip does not sign everyone out. An unknown `kid` triggers at
  most one refetch per cooldown, so a hostile client cannot turn tokens into an
  outbound-request amplifier.
* **HS256 is retained** for the local `supabase start` stack and the ~30
  existing tests that mint tokens directly.

`GET /health/readiness` now reports `auth_verification_mode`
(`jwks` | `hs256` | `jwks+hs256` | `unconfigured`), and `unconfigured` is a
**hard startup error** when `DEBUG=False`. It was previously one WARNING line
and a silent, total auth outage in which every authenticated route 401'd for
everyone. The same validator now also rejects the public default
`PEAK3_SIGNING_SECRET` in production — that check previously ran *only* under
`DEBUG`, so a production deploy that forgot the variable started silently on a
publicly known secret and could forge guest-ownership cookies.

`cryptography>=42` was added to `apps/api/requirements.txt`; without it PyJWT
cannot verify EC signatures at all.

### 3.3 Frontend — SSR cookie sessions

`@supabase/ssr@0.12.4` replaces the localStorage-backed browser client, so the
session and the PKCE verifier live in cookies the server can see.
`src/middleware.ts` revalidates with `getUser()` per navigation and copies
rotated cookies onto the response.

> Middleware lives at `apps/web/src/middleware.ts`, **not** `apps/web/middleware.ts`.
> Next resolves it relative to the directory containing `app/`; with `src/app`,
> a root-level file is silently ignored.

The client-component callback became a **route handler**
(`app/auth/callback/route.ts`) handling three inputs — `?code=` (Google and
PKCE magic link), `?token_hash=&type=` (allowlisted OTP types), and provider
errors, which are checked *before* `code` so a cancelled consent screen is
never retried. All outcomes are 303 (the grant is single-use).

The claim call was fixed: it used a **relative** `/api/v1/auth/claim` while
every other call site uses `NEXT_PUBLIC_API_URL`, so on a split deployment it
404'd against the Next server and an empty `catch {}` swallowed it. It now uses
the configured API origin with `credentials: "include"`, sends **no body at
all**, and surfaces a failure to the user.

**Open-redirect defence is two independent layers.** Supabase's redirect
allowlist at the provider boundary, and `safeNext()` in the app, which accepts
only a single-leading-slash same-origin path and rejects `//host`, `///host`,
`/\host`, `\\host`, `\/host`, any `scheme:` in any case, `/%2f%2fhost`,
`/%252f%252fhost`, `/%5Chost`, embedded NUL/CR/LF/TAB, bare hosts, relative
paths, malformed escapes, and an unsafe fallback argument — re-validated
through three decode rounds and a WHATWG `URL` origin comparison.

**UI.** Signed out: one `Sign in` link in the global nav carrying `?returnTo=`
for the current page, and contextual save CTAs after a result — **no auth wall
before first play**. Signed in: an initials avatar (no photographs, which also
means no `googleusercontent.com` request) opening Profile / Progress / History
and **sign out from the header**, which previously required navigating to
`/profile` first. `MobileNavDrawer` finally renders the account section its
`SectionId` union had declared since it was written. `/profile`, `/progress`
and `/history` joined `nav-model.ts`, so the nav reachability invariant now
covers them — `/progress` previously had no nav entry at all.

Four result-screen sign-in CTAs (`SaveRunPanel`, `LeaderboardSubmitPanel`,
`PlayAgainPanel`, `arena/court/history`) linked to a bare `/signin` and dropped
the player on the homepage; they now carry a validated `returnTo`.

> Moving the session from localStorage to cookies signs out anyone currently
> signed in, once. No automatic migration is attempted — deliberately, because
> silently re-minting a session from a storage medium we are abandoning is
> exactly the kind of thing that should be visible.

---

## 4. Persistence, RLS, and the guest claim

### 4.1 The architecture, stated plainly

The API opens **one asyncpg pool as the table-owning role** and never sets
`SET ROLE` or `request.jwt.claims`; no table carries `FORCE ROW LEVEL SECURITY`.
So **the API bypasses RLS and owner scoping is application code**. RLS binds
PostgREST clients holding an anon/authenticated key. Both layers are kept.
`FORCE ROW LEVEL SECURITY` was deliberately **not** added — it would subject
every write to policies checking `auth.uid()`, which is NULL on that connection,
and break the app. This is now documented in the migrations and both test files
so nobody "fixes" it later.

### 4.2 RLS gaps closed — `20260801100000_rls_gaps.sql`

* `lineup_model_versions`, `ruleset_versions`, `card_pool_versions` had **RLS
  never enabled**, while `20260630130100_default_privileges.sql` grants full
  CRUD on *all* tables to `anon` and `authenticated`. Any anon key could flip
  `is_current`. Now RLS-enabled, public-read, with writes `REVOKE`d as well as
  policy-denied — the REVOKE matters because an `UPDATE` matching no policy
  affects zero rows **silently**, so only the privilege check fails loudly.
* `board_snapshots` and `challenges` carried `FOR SELECT USING (true)` — a *row*
  rule, not a column one — so an anon key could read `board_snapshots.seed`,
  `challenges.seed`, `challenges.token_hash` and `challenges.challenger_snapshot`
  despite comments claiming the seed was server-only. Replaced with column-level
  `GRANT SELECT (…)` that withholds exactly those columns. The row rules were
  correct and were left alone.

### 4.3 Guest claim

The credential is the **HMAC-signed, httponly `peak3_anon` cookie** — a
high-entropy server-issued token. No localStorage run ID is ever trusted; a
request body carrying `{"anon_sub": victim, "run_id": …}` moves zero rows
(tested).

| Property | Enforcement |
|---|---|
| Cookie-only credential | `verify_anon_subject()`; the body is never read |
| Forged/expired cookie rejected | Indistinguishable failure modes, so probing reveals nothing |
| A different user gets **403** | One decision point shared by the fresh and repeat paths |
| Two tabs cannot double-claim | `ownership_claims.anon_subject_id UNIQUE` + `ON CONFLICT DO NOTHING`; the loser re-reads and reports the winner's counts |
| Idempotent | A repeat returns the stored per-domain counts rather than recounting rows that have already moved |
| Challenge access ≠ ownership | Only `challenges.anon_subject_id` moves; `challenge_participants` never does |

`MemoryOwnershipClaimRepository.record_claim` **overwrote** rather than
conflicting — the double-claim race was the one place the guarantee did not
actually hold, in the backend the tests run against. Fixed.

**Four domains could not be claimed at all**: `run_the_table_runs`,
`daily_grid_results`, `perfect_season_runs`, `perfect_season_saved_runs` had no
`transfer_owner` on any protocol or repository. RUN THE TABLE is anon-first by
design, so a guest who played it and then signed in permanently lost the
association. All four now transfer, plus the new `peak_duel_daily_results`.
The claim returns **14 per-domain counts, always all present including zeros** —
an absent key can only say "we forgot to look", which is how four domains went
unnoticed.

### 4.4 Peak Duel Daily gained a server-side record

`peak_duel_daily_results`, `UNIQUE (owner_sub, mode, daily_key)`, immutable
insert-only policies. `POST /game/daily/result` (§5) is wired to it. Of the five
daily modes this was the only one with **no server-side attempt record at all**,
so "one attempt per day" was a convention the client agreed to.

`REPOSITORY_DOMAINS` gained four entries it was missing (`court_lineup`,
`perfect_season_leaderboard`, `perfect_season_saved_run`, `peak_duel_daily_result`),
which had been escaping the production-durability assertion despite the module
docstring claiming it enumerated every domain.

`POST /game/daily/result` scores the attempt **server-side** from the signed
session token and the dataset; a client-submitted score is ignored, an
unanswered duel counts as wrong rather than absent, and there is no field a
client can set to choose which day it played. The recorded `arena_points`
deliberately exclude the speed bonus, because that component derives from a
client-supplied `elapsed_ms` the server cannot verify and this row can become a
personal best — every point in it is one the server can prove. The endpoint is
rate-limited (`PEAK3_PEAK_DUEL_RESULT_RATE_LIMIT`, default 20/min per identity):
it is a write endpoint that does not require an account, and the legitimate
ceiling is one attempt per day plus retries.

---

## 5. Daily reset

Full audit in `DAILY_TIME_AUDIT.md`. Summary of what changed:

**There was no PT anywhere.** Four near-identical `today_utc_date()` helpers and
five inline `strftime`/`toISOString()` expressions, and **three of five shared
daily modes let the browser cast the deciding vote** on what day it was —
`game.py` performed no future-date validation at all and would serve
`?date=2099-01-01`.

Everything now resolves through `nba_peak/daily_key.py`: one IANA zone, never a
fixed offset; `now` injectable throughout, which is what makes boundary cases
testable at all. Every daily response carries the frozen window block, so
clients count down from `seconds_remaining` and never recompute a timezone
boundary in JavaScript.

**The stale-daily root cause**, reproduced: `DailyGridGame.tsx`'s board fetch
ran in an effect whose dependency array is `[date, initialBoard]`, and on the
canonical `/daily/grid` route **both are permanently `undefined`** — so the
board was fetched once per mount and never again. The persistence layer was
innocent (the `board_id` is in the storage key); the *fetch* was stale. Play
through midnight and every answer posted yesterday's date, the server filed the
session as an archive replay, and **the player's streak silently broke because
they played through the reset**. Three further paths (RUN THE TABLE resume with
no `run_date`, Peak Draft's resume branch never comparing the board's embedded
date, and browser-computed dates sent to a server that only falls back when the
parameter is absent) are documented and fixed.

Moving the reset from midnight UTC (17:00 PT) to midnight PT made all four
strictly worse — it lands the boundary exactly where idle tabs and backgrounded
phone browsers are most common — which is why the timezone change and the
single-utility refactor had to ship together.

**Peak Draft challenge/daily collision fixed.** A daily-minted challenge token
carried `board_type:"daily"` and the sender's date into `create_draft_game`, so
opening a friend's link wrote the *recipient's* official daily completion — and
if they had already played, `ON CONFLICT DO NOTHING` silently discarded their
real result. The naive fix (force `board_type="challenge"`) breaks board
reproduction, because `board_id` and the seed derivation both key off it; the
board is now built under the token's own type while the *game* is labelled
`challenge`. Reverting the fix fails three tests, including one that plays the
challenge and then the recipient's own daily and asserts which completion
survives.

Copy: *"Two PEAK3 games reset at midnight UTC"* → **"New daily board at midnight
PT"**, with a countdown driven by the server's `seconds_remaining` (screenshot
`06`).

---

## 6. RUN THE TABLE — clarity and receipts

**Progressive disclosure**, identical on all three perk surfaces: plain-language
effect → one strategic hint → a collapsed `<details>` carrying the engine's
published `summary` **verbatim**. `RunResult` previously showed no plain line at
all. A `<details>` rather than the old tooltip, because the tooltip trigger was
a real `<button>` and the e2e driver clicks the first button in the perk panel.

Two perk descriptions were pointing at the wrong lane: *"Unheralded cards cost
you less"* implies recognition, but Moneyball reads **overall** percentile; *"Big
producers who never won the awards"* implies Traditional Production, but No
Hardware reads **Statistical Impact**. Both corrected. "In most battles" in Deep
Rotation and "original price" in Trade Machine are load-bearing clauses now
pinned by tests.

**Ordinal grammar.** `percentileSentence` appended `"th"` unconditionally, so
**every player card rendered `75.1th percentile`**, and `decisiveLane` printed
`"1th lane"` for any ruleset where `LANES_TO_WIN ≠ 3` — which Track D was about
to make reachable. A correct `ordinal()` already existed in
`rankings-receipts.ts` and was not reused; it is now extracted to
`lib/ordinal.ts`, used everywhere, and the duplicate deleted.

**Player cards** lead with player · exact 3Y window · role · cost · PEAK3 score ·
strongest lane · weakest lane · profile label. The last three are new.

**Pre-boss briefing** shows "First to {n} of {m} lanes" (both threaded from the
payload), the rule in plain language, projected strengths, and leaning lanes
**explicitly labelled an estimate** — with the reason stated on screen: the
player's profile is built with a neutral bench weight while the boss's is built
under its own rule, so a bench-weight rule applies to their displayed numbers
and not yours. "No game is simulated" is retained.

**Film Room** had four surfaces giving four mutually inconsistent accounts, and
the engine's node header promised a "prep advantage" mechanic **that does not
exist in any code path**. The web copy now states what scouting actually does,
including the boss-roster reveal that nothing previously mentioned.

### The receipt bug

`receipt.py` emitted `"signed_value": -state.credits` — negating a *holding*
purely so a shared colour helper would paint it red. The receipt therefore said
"Finished holding 15 unspent credits" and `-15.0` **on the same line**, while the
Credits section two blocks above said `finished holding 15`. Three sibling
reasons overloaded the same unlabelled one-decimal column with lanes-won, a bare
`0` for a stated weakness (rendered neutral grey — the only negative finding was
the only one not red), and a PEAK3 point delta.

Replaced by the semantic contract: `kind` — and only `kind` — carries valence;
`value` is always the true unnegated magnitude. Unspent credits are
`{kind:"neutral", value:68, unit:"credits"}`. `reasons[]` survives as a
deprecated projection so **old saved receipts still render**, and the renderer
takes `Math.abs` at that edge, so even a v1 receipt now shows `68` neutral
rather than red `−68`.

---

## 7. Standard v2 balance

`ACTS 3→4`, `DECISION_NODES 6→8`, `BATTLES 3→4`, `STARTING_CREDITS 40→50`,
lives unchanged at 3, `RULESET_VERSION rtt_ruleset_v1→v2`. Run ends immediately
at zero lives — previously `lives <= 0` was checked only when advancing past a
boss, so with 3 lives and 3 battles a do-nothing policy "survived" 83% of runs.

**Clear the Table now requires beating the final boss.** Previously
`ran_the_table` meant "won all bosses" and the verdict string `"RUN COMPLETE"`
was printed for a clean sweep *and* for an 0-for-3 survival — victory framing on
a losing run. The taxonomy is now `TABLE CLEARED` / `RUN ENDED AT THE FINAL
BOSS` / `RUN ENDED IN ACT {n}`, and a **drawn** final boss is not a clear.

### 100,000 seeds × 6 policies = 600,000 runs, 183 s

`docs/implementation/run-the-table-balance-v2.json`. All **11 hard invariants**
held; 500 replay-determinism checks byte-identical; zero warnings.

| policy | clear | reached final boss | B1 | B2 | B3 | Final | avg ending act | lives left (mean) | credits left (p50) |
|---|---|---|---|---|---|---|---|---|---|
| `random_legal` | **0.4%** | 84.0% | 74.5% | 9.7% | 3.1% | 0.4% | 3.84 | 0.42 | 67 |
| `greedy_overall` | **25.2%** | 98.7% | 96.4% | 60.9% | 53.3% | 25.5% | 3.99 | 1.56 | 23 |
| `lane_aware` | **15.7%** | 99.7% | 98.3% | 78.7% | 58.5% | 15.8% | 4.00 | 1.87 | 14 |
| `economy_aware` | **47.9%** | 93.4% | 81.9% | 53.7% | 63.2% | 51.3% | 3.93 | 1.64 | 35 |
| `look_ahead` | **38.5%** | 99.9% | 99.0% | 87.3% | 76.7% | 38.6% | 4.00 | 2.24 | 17 |
| `passive` *(control)* | **0.0%** | 89.6% | 74.7% | 0.6% | 0.0% | 0.0% | 3.90 | 0.66 | 86 |

Tuning was measured, not asserted: the final boss's margin band was swept
2.5→3.0→4.0→5.0 and boss 1's 0.75→1.0→1.5→2.0, each re-run at scale, and
`BOSS_WIN_CREDITS` was swept 0/6/10/12/14 — 10 keeps the strongest policy under
50% while preserving a wide skill gradient.

Three real defects were fixed rather than documented around:

* **Deep Rotation was a net nerf.** Lane score is a weighted *mean*, so raising
  bench weight lowered your score whenever the bench was weaker than the
  starters — the default. Measured over 30,000 applicable lanes, v1 lowered
  **53.0%** of them while claiming to be a buff. v2 takes the better of the two
  bench weights per lane: **0 lanes lowered**, 172 battles improved, 0 worsened.
* **Boss 1's rule had fired 0 times in 120,000 battles** — an exact-tie
  tie-break on scores rounded to 4 dp is unreachable, so the tutorial boss was
  effectively rule-less. Re-expressed as a margin band; it now changes 10.3% of
  act-1 outcomes.
* **Winning a boss paid nothing** while losing paid 8 credits. Winning now pays
  10.

**Versioning.** A v1 saved run retires with a specific 409 rather than a crash;
old completed receipts stay readable; challenge tokens now carry their ruleset.
That last one mattered: `get_challenge` reported the *server's current* versions
for any token, so a week-old link silently described a board it would never
produce. The router now reports the token's own ruleset and refuses to start a
run from a stale link — proven at the HTTP layer, not just in the service.
`serialization`'s bare `ValueError` (HTTP **500**) became a typed mismatch
mapped to **409**.

`team_achievement` still carries PEAK3 weight 0.03 while voting equally with
`statistical_impact` (0.38) in first-to-3. Left unchanged deliberately and
flagged: it is the single largest lever in the design and not a defect to fix
inside a balance pass.

---

## 8. Telemetry

Off by default (`PEAK3_TELEMETRY_ENABLED=false`) — a privacy-affecting
collection path that turns itself on at install time is not a privacy-conscious
one. A **closed 21-event allowlist**; an unknown name rejects the whole batch.

Never collected: emails; OAuth / magic-link / access / refresh / ID tokens and
API keys; the `Authorization` header; raw localStorage; IP addresses; user
agents; free-text input; board answers; client clocks; and the raw owner
subject. Enforced by a property allowlist, a named forbidden-key set, and a
value rule that rejects JWT-shaped and long opaque values under *any* key —
that last rule closed a real hole found in testing, since a JWT is entirely
slug-shaped and the charset check alone let it through. Rejections name the
offending key, never the value.

Identity is `HMAC-SHA256(SIGNING_SECRET, owner_sub)` — keyed, not a bare digest,
because authenticated subjects are UUIDs and an unkeyed hash of a UUID is
reversible by anyone holding the user table. The deliberate cost is that the
table cannot be joined to game data; every metric is a per-subject aggregate.

RLS is `FOR ALL USING (false) WITH CHECK (false)` plus an explicit `REVOKE` —
write-only from a client's perspective, with no read path at all, and the
REVOKE is required because the default-privileges migration auto-grants CRUD on
new tables. Retention is a 90-day `expires_at` stamp plus a purge function; the
migration does **not** schedule it (that needs `pg_cron` and is an operator
decision) and says so rather than pretending.

`scripts/telemetry_report.py` exits non-zero with an honest "not configured"
message when the database is unreachable, and prints no figures.

---

## 9. Real database verification

The RLS/integration suite had **never run** in this repo — its own conftest
said so. It now does.

* Local Supabase stack booted, **all 25 migrations applied from scratch**, and
  `pytest -m supabase_integration` → **72 passed**, covering real sign-up /
  sign-in / session restoration, JWT rejection paths, migration idempotency, and
  cross-user RLS denial on all owned tables.
* Track C independently stood up a `postgres:16` container with a Supabase shim
  and re-ran the chain (58 passed) before handing over — so the RLS gaps are
  demonstrably closed, not merely asserted.
* **The hosted development project now has all 25 migrations applied** (it had
  0 of 21 at baseline).

> PEAK3's local stack ports were shifted +100 (API 54421, DB 54422, Studio
> 54423, Mailpit 54424) because another local Supabase project already held the
> default 5432x block. Stopping that project's stack would have disrupted
> unrelated work; moving ours is what the CLI's own error suggests. `supabase
> status` prints the live values.

---

## 10. Test and build results

| Suite | Command | Result |
|---|---|---|
| Model | `pytest tests/ --ignore=tests/lineup` | **864 passed, 1 xfailed** |
| Lineup | `pytest tests/lineup/` | **43 passed** |
| API | `pytest tests/ --ignore=tests/integration -m "not supabase_integration"` (apps/api) | **1046 passed, 1 skipped, 5 deselected** |
| JWKS (incl. live key set) | `pytest tests/test_auth_jwks.py` | **21 passed** |
| Supabase integration + RLS (real Postgres) | `pytest tests/integration/ tests/test_repository_conformance.py -m supabase_integration` | **72 passed** |
| Vitest | `npx vitest run` (apps/web) | **1089 passed** (39 files) |
| Typecheck | `npx tsc --noEmit` | clean |
| Lint | `npx next lint --max-warnings 0` | **No ESLint warnings or errors** |
| Production build | `rm -rf .next && npm run build` | succeeded; middleware compiled (91 kB) |
| Service-role bundling | `pytest tests/test_service_role_not_bundled.py` (after the build) | **2 passed** — it normally *skips*, because no CI job builds `.next` before running Python |
| Balance audit | `scripts/audit_run_the_table_v2.py --seeds 100000` | exit 0, 11/11 invariants, 0 warnings |
| Playwright | `npx playwright test` (CI env, `PLAYWRIGHT_RETRIES=0`) | **331 passed, 0 failed** (14.8m) |

`test_auth_jwks.py::test_live_jwks_document_is_usable` fetches the hosted
project's **real published key set** and asserts every key uses an algorithm
this API can verify — so a project that rotates to something unsupported fails
loudly there rather than as a mass 401 in production.

### What the browser suite actually caught

The suite grew from 300 tests to **331** (Track B added 29 auth specs, Track E
added 2). Getting it green took four passes, and three of the four found
something real:

**1. A tour-version drift that failed six specs at once.** The RUN THE TABLE
spec kept its own copy of `RUN_THE_TABLE_TOUR_VERSION = 1`, "duplicated rather
than imported because this file runs in Playwright's Node context". Standard v2
bumped the real constant to 2 — correctly, since the run went from 3 acts to 4
and returning players *should* see the tour again. The copy stayed at 1, so the
"seed tour already seen" helper wrote a version that no longer matched,
`shouldAutoStartTour` returned true for every gameplay test, and the tour's
full-screen scrim swallowed the clicks. Six specs failed with click timeouts
that read as slowness and were nothing of the kind. Both source modules are
plain TypeScript with no React and no browser API at module scope, so the
duplication was never necessary — the spec now imports all four constants and
cannot drift again.

**2. A real Play-panel regression.** Adding the account menu moved the Play
trigger left, and the right-anchored panel's left edge landed at **x = −50.7**
at 1024px. This was the *second* time this panel has been pushed off-screen by
an unrelated nav change (the first was `left: 0` running off the right at
1440px). Both share one cause: the panel's position depended on where the
trigger happened to sit. It is now anchored to the viewport, so no future
header content can move it, and the 640–860px band reduces to a full-bleed
preference rather than a correctness fix.

**3. Two Daily Grid tests encoded behaviour this pass deliberately removed.**
They navigated to `?date=2026-09-09` — a *future* board — which only ever
worked because the Grid accepted any well-formed date. That is the same
permissiveness that let a browser clock decide which day it was playing. They
now use a past archive date, which proves the same thing (a different date is a
different board; progress does not bleed across `board_id`s) without asserting
that the server will serve a board that has not opened.

**4. A stale time budget.** `FULL_RUN_TIMEOUT_MS = 60_000` was documented as
sized for "6 node choices, 6 node resolutions, 3 boss resolutions and 3
advances — ~20 sequential POSTs". Standard v2 is 8/8/4/4 ≈ 26 POSTs, and full
runs were timing out at ~66 s. The runs were correct; the clock was stale.
Raised to 120 s, and the driver's docstring — which still described "finishing
act 3 or losing three battles" — now describes the v2 terminal conditions.

### A false failure worth recording

The first local Playwright run reported **26 failures**, 25 of them in the
CourtBuilder spec. None was a regression: `PEAK3_COURTBUILDER_ENABLED` and the
ranked flags default to `false`, and CI supplies them as job env
(`ci.yml:315-328`) while `npm run test:e2e` did not. A local run therefore
failed 26 tests for reasons unrelated to any change, which is the kind of noise
that trains people to ignore red.

`package.json`'s `start:api` — which the Playwright `webServer` uses — already
hardcoded the Daily Grid rate-limit overrides, so the pattern was established;
it now also sets the ranked and CourtBuilder flags and the shared test JWT
secret (deferring to `PEAK3_TEST_JWT_SECRET` when set). Local e2e and CI now
run against the same configuration.

Separately, every advertised test count in `Makefile` and `ci.yml` was stale by
3–10× ("186 required", "92 required", "vitest, 87"), which made the "0 skipped"
guarantees meaningless. They now match the measured numbers above.

---

## 10a. Independent security review

A fresh reviewer with no prior context audited the whole working diff against
the spec's checklist. It could not defeat `safeNext` (48 hostile payloads), the
PKCE callback, the JWKS verifier, the HMAC session tokens, or the guest-claim
endpoint, and found no SQL injection, no XSS sink, no secret in browser code,
and no secret in the diff.

**Four findings were fixed in response**, each with a test:

| # | Finding | Fix |
|---|---|---|
| Introduced here | `peak_duel_daily_results` got no `REVOKE`, so `ALTER DEFAULT PRIVILEGES` from an earlier migration left it INSERT/DELETE-able through PostgREST. The owner policy pins *ownership*, not the *payload* — a client could have written its own `arena_points`, and DELETE-then-INSERT is an UPDATE once the UNIQUE constraint clears. | New migration `20260801130000_peak_duel_results_revoke.sql` (a separate file, because the original is already applied to two databases and an applied migration must not be edited in place). **Proved against a real Postgres**: three new RLS tests assert `InsufficientPrivilegeError` on INSERT and DELETE while owner SELECT still works. |
| Introduced here | The callback trusted `x-forwarded-host` gated only on `NODE_ENV`, so an app reachable without traversing its proxy could be made to issue an open redirect from its own domain. | Allowlisted against `NEXT_PUBLIC_SITE_URL` and the request's own host; an unrecognised value falls back to the request origin rather than failing sign-in. |
| Pre-existing, undermined our own claim | The e2e test-session backdoor gated only its *writer*. The **read** path shipped in production and ran at module evaluation, so anything able to write one `sessionStorage` key controlled the app's identity and its outbound bearer token — while two comments asserted the code "does not exist in a production bundle". | The reader is now gated on the same build-time constant. The comment is now true rather than aspirational. |
| Pre-existing, newly load-bearing | `client_key()` folded the **unverified** anon cookie in as a bucket *dimension*, so rotating it bought a fresh budget each time — 50 forged cookies from one IP meant 50 full budgets. Its own comment argued the opposite. This nullified the limits on both write endpoints this pass adds. | The cookie's HMAC is verified; unverifiable cookies collapse to the per-IP bucket. Four tests, including the 50-forgery case and a check that two genuinely signed cookies still get separate buckets behind one NAT. |

`.gitignore` was also tightened from exact `.env` paths to globs (with the
`.env.example` templates explicitly re-included), so a future
`apps/web/.env.production` cannot be committed silently.

**Findings NOT fixed, deliberately.** Three pre-existing IDORs sit in files this
pass edits, and closing them is a separate piece of work with its own test
burden — widening scope silently would be worse than naming them:

* **HIGH** — `POST /draft/games/{game_id}/actions` (`draft.py:199-252`) takes no
  identity at all. Anyone holding a leaked `game_id` can drive a victim's Peak
  Draft game to completion, burning their daily attempt with a garbage lineup.
  The same file's own docstring says this must never happen, and this pass fixes
  it for the *challenge* path — but not the actions path.
* **MEDIUM** — Seven Perfect Season mutators (`perfect_season.py:244…401`) omit
  the ownership check that the same file performs correctly at `:485`.
* **MEDIUM** — `GET /draft/challenges/{token}/comparison` writes a settlement
  keyed on a caller-supplied `recipient_game_id`, letting an attacker pre-settle
  a challenge with a chosen result.

Also unfixed and worth a decision: sign-out clears the Supabase session but not
the device-local caches (`peak3.daily-grid.archive`, `peak3_ranked_match_*`,
`peak3_arena_progress`), so the next signer-in on a shared device inherits the
previous user's history and can be dropped into their ranked match.

The reviewer's own RLS findings were static-SQL only, because its integration
run had no test-project credentials. The same suite **did** execute here against
a real Postgres (§9), which is how the `peak_duel_daily_results` fix was
verified rather than assumed.

---

## 11. Screenshots

14 frames in `docs/implementation/auth-daily-balance-review/`, with
`screenshot-manifest.json` recording each frame's URL, title, `h1`, viewport,
auth method and **MD5**.

The capture harness fails loudly rather than writing a misleading frame, and the
byte-identity check earned its keep immediately: the first reduced-motion frame
came out **byte-identical to the guest start gate**, because the start gate has
no motion at rest — a frame whose filename claimed something its pixels could
not support. It now targets the animated home surface.

Reviewing the frames also surfaced a defect no test caught: the Daily hub still
advertised **"3 acts · 3 boss battles"** and "10–15 minutes" after the v2
rebalance. Six stale strings across `modes.ts`, the homepage, the arena index,
and the RTT route metadata were corrected.

**Signed-in frames use the existing e2e test-auth channel, not a live provider**
— recorded as `e2e-test-channel` in every affected manifest row. See §12.

---

## 12. What is still blocked, and on what

Three things cannot be completed from this environment. None is a code gap.

**1. Google OAuth is not enabled on the project.** `/auth/v1/settings` reports
`external: ["email"]`. All Google code, redirect handling, callback contract and
tests are implemented and verified against a mocked provider; the button renders
and surfaces the provider's own error verbatim. Enabling it requires a Google
Cloud OAuth client and the Supabase dashboard — exact steps in
`AUTH_CONFIGURATION.md` §3. No credential was read, requested, or fabricated.

**2. No mailbox is reachable, and `mailer_autoconfirm` is false.** A live
magic-link session cannot be minted here. The callback's `verifyOtp` branch is
implemented and driven directly over HTTP in tests.

**3. `PEAK3_DATABASE_URL` in `apps/api/.env` carries a stale password** for the
hosted project, which was created today. Both the direct and pooler endpoints
return `password authentication failed`; the Supabase CLI has working
credentials, which is how migrations were pushed. **The operator needs to
refresh that one value** (Dashboard → Settings → Database). Until then the API
falls back to in-memory repositories against the hosted project, with the loud
startup warning it is designed to emit. This did not block verification: the
real-database path was exercised against a real Postgres via the local stack
(§9).

No secret value was read, printed, logged, or committed at any point.

---

## 13. Known limitations

* The signed-in screenshots exercise the e2e auth channel, which is
  dead-code-eliminated in production builds. They demonstrate the authenticated
  UI, not a live Supabase round-trip.
* Telemetry retention needs `pg_cron` scheduling by an operator; the
  in-process purge is a single-node safety net, not a substitute.
* The telemetry table deliberately cannot be joined to game data, so a guest who
  signs in appears as two subjects. Stitching would require the
  re-identification table the design avoids.
* Daily Grid keeps a deliberately wide archive window (past open, future
  closed) because the streak rule and history links depend on every past board
  staying addressable; the other four modes use the shared 366-day bound.
* `team_achievement`'s equal lane vote (§7) is unchanged.
* `docs/implementation/LOCAL_DEV.md` has been corrected: it said the project
  never links to a hosted one (now false), still listed the pre-shift local
  ports, and told operators to copy a "JWT Secret" that an asymmetric project
  does not have.

---

## 14. Final state

```
git branch --show-current   feature/auth-daily-balance
git log -1 --oneline        35145c6 Polish PEAK3 navigation, game UX, spinner, and rankings sync
git stash list              (empty)
git status --short          123 modified · 50 untracked · 1 deleted
git diff --check            (clean)
                            124 files changed, 8296 insertions(+), 1455 deletions(-)
```

No commit, push, pull request, merge, or stash occurred. The full diff is
unstaged and available for review.
