# AUTH / DAILY RESET / RUN THE TABLE — Integration Plan

Lead-authored plan for the pass specified in `PEAK3_AUTH_DAILY_BALANCE_CLAUDE_PASS.md`.
Written **before** any writer agent edits, from six parallel read-only audits.

Baseline: branch `feature/auth-daily-balance`, working tree clean apart from the
untracked pass spec. Baseline suite sizes (measured by collection, not by the
stale numbers in `Makefile`/`ci.yml`): model 789, lineup 43, API 919 collected /
901 CI-selected, Vitest 789, Playwright 300.

---

## 0. What the audits found that changes the plan

Five findings reshaped the approach and are recorded here because the rest of
the plan only makes sense in their light.

**0.1 — The hosted project signs JWTs asymmetrically.** The linked development
project publishes exactly one **ES256 / EC P-256** key at
`/auth/v1/.well-known/jwks.json`. There is no legacy HS256 "JWT secret" to
configure, and the pass must not invent one. The backend's only verification
path was `algorithms=["HS256"]` against `PEAK3_SUPABASE_JWT_SECRET`, so **every
authenticated request against this project would have failed**. Migrating to
JWKS is therefore not an optional modernisation — it is the precondition for
any auth work landing at all.

**0.2 — The API bypasses RLS today, by construction.** One asyncpg pool opened
with `PEAK3_DATABASE_URL` as the table-owning role; no `SET ROLE`, no
`request.jwt.claims`, and no table carries `FORCE ROW LEVEL SECURITY`. Owner
scoping is 100% application code; the 61 RLS policies only bind PostgREST
clients. This is a legitimate architecture and the migrations document it as
defence-in-depth — but it means "add RLS" cannot be the *only* guest-claim
control, and it means RLS tests must be written against PostgREST-shaped
connections (`SET ROLE` + `set_config`), which is what the existing
`test_rls_policies.py` already does.

**0.3 — There is no PT anywhere, and three of five daily modes let the client
decide the date.** Four near-identical `today_utc_date()` helpers plus five
inline `strftime`/`toISOString()` expressions. Peak Duel Daily, Peak Draft
Daily and (partly) PEAK Season Daily send a browser-computed `?date=` that the
server honours. Moving the reset from midnight UTC (17:00 PT — mid-afternoon,
tabs freshly opened) to midnight PT moves it to *exactly* the hour of maximum
idle-tab prevalence, which converts the stale-board bug from an edge case into
the modal experience. Root cause and the four distinct stale paths are in §4.

**0.4 — The RUN THE TABLE engine is not where the spec says it is.** The
authoritative engine is the pure-Python, dependency-free package
`nba_peak/run_the_table/` (2,381 lines). `apps/api/app/services/run_the_table/`
is an HTTP/persistence adapter containing no game rule. All balance work
happens in `nba_peak/`, and the engine is directly drivable headlessly — a
100,000-seed audit is ~3 minutes single-process.

**0.5 — The receipt bug is an engine bug, not a CSS bug.** `receipt.py:235`
emits `"signed_value": -state.credits` — it negates a *holding* purely to make
a shared `signedColorVar()` helper paint it red. The component then prints the
same field it colours with, so the receipt says "Finished holding 15 unspent
credits" and `-15.0` on one line, and `finished holding 15` two sections above.
Three sibling reasons overload the same column with lanes-won, a bare `0`, and
a PEAK3 point delta. The fix is the semantic `ReceiptItem` contract in §7 —
signs stop carrying meaning.

---

## 1. Ownership map — strict disjoint file ownership

No two agents may write the same path. Cross-track needs are satisfied by the
**contracts in §2**, which are frozen before any writer starts. Anything not
listed belongs to the lead.

### Lead
```
apps/api/app/core/auth.py            apps/api/app/core/jwks.py
apps/api/app/core/config.py          apps/api/app/core/security.py
apps/api/app/api/v1/health.py        apps/api/requirements.txt
nba_peak/daily_key.py                apps/api/.env.example   apps/web/.env.example
apps/api/tests/test_auth_jwks.py
docs/implementation/AUTH_DAILY_BALANCE_PLAN.md
docs/implementation/AUTH_DAILY_BALANCE_REPORT.md
docs/implementation/AUTH_CONFIGURATION.md
docs/implementation/DAILY_TIME_AUDIT.md
docs/implementation/auth-daily-balance-review/
```

### Track A — Daily time authority
```
nba_peak/daily_grid/generator.py     nba_peak/perfect_season/daily.py
nba_peak/run_the_table/daily.py
apps/api/app/api/v1/game.py          apps/api/app/api/v1/draft.py
apps/api/app/api/v1/daily_grid.py    apps/api/app/api/v1/perfect_season.py
apps/api/app/api/v1/run_the_table.py
apps/api/app/services/draft/state.py
apps/api/app/services/perfect_season/state.py
apps/web/src/lib/daily-time.ts (new) apps/web/src/lib/use-daily-reset.ts (new)
apps/web/src/lib/utils.ts            apps/web/src/lib/daily-grid-archive.ts
apps/web/src/lib/draft-progress.ts   apps/web/src/lib/resume-state.ts
apps/web/src/components/daily/**     apps/web/src/components/daily-grid/**
apps/web/src/app/(main)/play/daily/page.tsx
apps/web/src/app/(main)/arena/daily/**
tests/test_daily_key.py (new)        apps/api/tests/test_daily_reset_boundaries.py (new)
apps/web/src/tests/unit/daily-time.test.ts (new)
apps/web/src/tests/unit/daily-grid-archive.test.ts
```
Explicitly NOT: anything under `nba_peak/run_the_table/` other than `daily.py`;
anything under `apps/web/src/components/run-the-table/`.

### Track B — Auth surface (web + SSR sessions)
```
apps/web/src/lib/auth.ts             apps/web/src/lib/auth-context.tsx
apps/web/src/lib/supabase/** (new)   apps/web/middleware.ts (new)
apps/web/src/app/auth/**             apps/web/src/app/(main)/signin/page.tsx
apps/web/src/app/(main)/signup/page.tsx
apps/web/src/app/(main)/profile/page.tsx
apps/web/src/app/(main)/history/page.tsx
apps/web/src/components/auth/** (new)
apps/web/src/components/layout/nav.tsx
apps/web/src/components/layout/MobileNavDrawer.tsx
apps/web/src/lib/nav-model.ts        apps/web/package.json
apps/web/src/tests/unit/auth-*.test.ts(x) (new)
apps/web/src/tests/e2e/auth.spec.ts (new)
```

### Track C — Persistence, RLS, guest claim
```
supabase/migrations/20260801*_*.sql (new, C-prefixed names in §5)
supabase/migrations/MIGRATION_INVENTORY.{md,json}
apps/api/app/api/v1/auth.py
apps/api/app/repositories/**         apps/api/app/core/dependencies.py
apps/api/app/core/repository_registry.py
apps/api/tests/test_guest_claim.py (new)
apps/api/tests/integration/test_rls_policies.py
apps/api/tests/integration/test_migrations.py
```

### Track D — RUN THE TABLE Standard v2 engine + balance
```
nba_peak/run_the_table/{config,state,battle,generation,cards,pricing,bosses,
                        schemas,receipt}.py
apps/api/app/services/run_the_table/{public,serialization,runs}.py
apps/api/app/models/run_the_table.py
tests/run_the_table/**
scripts/audit_run_the_table.py       scripts/audit_run_the_table_v2.py (new)
docs/implementation/run-the-table-balance-v2.json
apps/api/tests/test_run_the_table.py
```
Explicitly NOT: `nba_peak/run_the_table/daily.py`, `apps/api/app/api/v1/run_the_table.py`.

### Track E — RUN THE TABLE clarity + receipt rendering
```
apps/web/src/lib/run-the-table-copy.ts
apps/web/src/lib/run-the-table-state.ts
apps/web/src/lib/ordinal.ts (new)
apps/web/src/components/run-the-table/**
apps/web/src/components/ui/tour-steps.ts
apps/web/src/types/run-the-table.ts
apps/web/src/tests/unit/run-the-table-*.test.*   apps/web/src/tests/unit/trade-desk.test.tsx
apps/web/src/tests/unit/guided-tour.test.tsx
apps/web/src/tests/e2e/run-the-table.spec.ts
```

### Track F — Telemetry
```
apps/web/src/lib/analytics.ts        apps/api/app/api/v1/telemetry.py (new)
apps/api/app/models/telemetry.py (new)
apps/api/app/repositories/telemetry_*.py (new)
supabase/migrations/20260801120000_telemetry_events.sql (new)
apps/api/app/main.py                 scripts/telemetry_report.py (new)
apps/api/tests/test_telemetry.py (new)
docs/implementation/TELEMETRY.md (new)
```

---

## 2. Frozen cross-track contracts

These are fixed now so tracks can proceed in parallel without waiting on each
other. A writer that needs to change one must escalate to the lead instead.

### 2.1 Daily window (A → everyone)

Server: `nba_peak/daily_key.py` (already landed by the lead). Public surface:
`DAILY_TIMEZONE`, `daily_key(now=None) -> "YYYY-MM-DD"`,
`daily_window(key=None, now=None) -> DailyWindow`,
`validate_daily_key(value, now=None, ...)`, `InvalidDailyKey`.

Every daily API response embeds exactly this object, at the top level, under
the key `daily`:
```json
{ "daily_key": "2026-08-01", "timezone": "America/Los_Angeles",
  "starts_at": "2026-08-01T07:00:00Z", "ends_at": "2026-08-02T07:00:00Z",
  "seconds_remaining": 12345 }
```
Produced by `DailyWindow.to_payload()`. Clients never recompute a timezone
boundary; they only count down from `seconds_remaining`.

Client: `apps/web/src/lib/daily-time.ts` exposes the mirror types plus
`useDailyReset()` (in `use-daily-reset.ts`), which fires a caller-supplied
refetch when the countdown reaches zero **and** on `visibilitychange`/`focus`
when the stored `daily_key` no longer matches the server's.

### 2.2 Standard v2 run shape (D → E, A)

```
ACTS = 4   STAGES_PER_ACT = 2   DECISION_NODES = 8   BATTLES = 4
STARTING_LIVES = 3   MAX_LIVES = 3   STARTING_CREDITS = 50
LANES_TO_WIN = 3 of 5            RULESET_VERSION = "rtt_ruleset_v2"
```
Terminal semantics:
* run ends **immediately** at `lives == 0`, checked after every battle;
* `table_cleared` ⟺ terminal status is `complete` **and the final boss battle
  was a win**. Winning bosses 1–3 and drawing/losing the final boss is *not* a
  clear.

Outcome taxonomy, exactly three strings, emitted by the engine as
`receipt["outcome"]` with a human `receipt["verdict"]`:
| `outcome` | `verdict` | condition |
|---|---|---|
| `table_cleared` | `TABLE CLEARED` | final boss won |
| `ended_at_final_boss` | `RUN ENDED AT THE FINAL BOSS` | reached boss 4, did not win it |
| `ended_in_act` | `RUN ENDED IN ACT {n}` | ran out of lives before boss 4 |

`"RUN COMPLETE"` is retired: it is currently printed for a 0-for-3 run, which
the spec forbids.

Boss progression (rules are published, symmetric, no hidden penalties):
1. **Boss 1** teaches the lane system — beatable with the starting roster.
2. **Boss 2** punishes one-dimensional rosters.
3. **Boss 3** makes perk/economy strategy matter.
4. **Final Boss** is hard, with one clearly published rule.

### 2.3 Semantic receipt items (D → E)

Replaces the overloaded `signed_value` column entirely.
```ts
type ReceiptItem = {
  kind: "benefit" | "cost" | "neutral" | "record";
  label: string;
  value?: number;
  unit?: "credits" | "score" | "lanes" | "percentage";
  display?: string;
};
```
Rules:
* `kind` — and only `kind` — drives colour. `benefit` positive, `cost`
  negative, `neutral` muted, `record` accent-neutral.
* `value` is always the **true magnitude, unnegated**. "Finished holding 68
  unspent credits" is `{kind:"neutral", value:68, unit:"credits"}` — 68, not
  −68, and not red.
* `display` overrides formatting when a unit needs it (`"3 of 5 lanes"`).
* The engine emits `receipt["items"]`; `receipt["reasons"]` is kept as a
  deprecated alias for one release so old saved receipts still render.

### 2.4 Rules versioning (D → C, E)

`RULESET_VERSION` moves to `rtt_ruleset_v2`. Old runs must not 500:
* an active run whose stored ruleset is v1 **retires gracefully** with status
  409 and a specific, human message ("this run was started under the previous
  ruleset"), never a crash;
* completed v1 receipts stay readable (the receipt renderer must not assume
  `items` exists — fall back to `reasons`);
* challenge tokens gain a `ruleset` field so a link minted under v1 keeps
  reporting v1 instead of silently regenerating a different board under v2.
* the snapshot-schema `ValueError` at `serialization.py:107` must map to 409,
  not the current 500.

### 2.5 Guest ownership token (C → B)

The `peak3_anon` cookie already is a high-entropy, HMAC-signed, httponly
server-side ownership token (`anon:{token_urlsafe(16)}`, 30-day TTL). It is the
claim credential. **No localStorage run ID is ever trusted.** Track B must send
credentials on the claim call; Track C owns the claim endpoint.

---

## 3. Authentication (Tracks B + lead)

**Backend (lead, landed).** `_decode_jwt` is retained for HS256 (local stack +
the ~30 existing tests that mint tokens directly) and joined by
`_decode_jwt_asymmetric`, selected per-token by the `alg` header via
`verify_access_token()`. The JWKS path:
* accepts only `ES256`/`RS256`/`EdDSA` — never a symmetric alg, so a token
  cannot downgrade into having a public key treated as an HMAC secret;
* requires `kid`, and treats "kid not in the published set" (401) as distinct
  from "we could not fetch the set" (logged, 401, never a 500);
* verifies `aud` (`authenticated`) and `iss` (`{SUPABASE_URL}/auth/v1`) — the
  old path verified neither;
* requires `exp` and `sub`; a signed token without `sub` is now unauthenticated
  rather than a `KeyError` → 500.
Key caching is TTL 600 s with a 30 s minimum refresh interval, coalesced behind
one lock, serving stale keys through a transient JWKS outage.

**Frontend (B).** Adopt `@supabase/ssr` with cookie-based sessions so the
server can see the session, add `middleware.ts` to refresh it, and keep the
browser client for interactive calls. Ship **Google OAuth** (`signInWithOAuth`,
PKCE) and **email magic link** (`signInWithOtp`); keep guest play with no auth
wall before first play. Replace the client component at `app/auth/callback` with
a **route handler** doing `exchangeCodeForSession`, and fix the relative
`/api/v1/auth/claim` call to use `NEXT_PUBLIC_API_URL`.

**Return-URL safety.** One shared `safeNext(raw)` helper: accept only same-origin
paths beginning with a single `/`, reject `//host`, `/\host`, any scheme, and
anything decoding to an absolute URL. Everything else falls back to `/`.

**UI.** Unauthenticated: `Sign in` in the global nav, plus a contextual save CTA
after a meaningful result — never a wall. Authenticated: initials avatar,
profile/history, saved runs, daily history/streak, sign out. `/profile`,
`/history`, `/progress` join `nav-model.ts` so the nav-invariant tests can see
them (`/progress` currently has no nav entry at all).

**Blocked on dashboard configuration:** the hosted project reports
`external: ["email"]` — **Google is not enabled**. All Google code, redirect
handling and tests will land and be verified against a mocked provider; the
exact manual steps go in `AUTH_CONFIGURATION.md`. No secret is ever read,
printed, or committed.

---

## 4. Daily reset (Track A)

**Root cause of the stale daily board** — four independent paths, in order of
impact:

* **A (primary), Daily Grid.** `DailyGridGame.tsx:158-181` fetches the board in
  an effect whose dependency array is `[date, initialBoard]`, and on the
  canonical `/daily/grid` route **both are permanently `undefined`**. The effect
  runs once per mount and never again. The persistence layer is innocent — the
  `board_id` is in the storage key — but nothing ever asks the server for a new
  `board_id`. Play through midnight and every answer posts yesterday's date;
  `daily_grid.py:503` then computes `played_on_board_date = false` and files the
  session as an archive replay, so **the player's streak silently breaks even
  though they played straight through the reset**.
* **B, RUN THE TABLE.** `StoredActiveRun` has no `run_date`; the resume path
  clears only on 404/409/410, so yesterday's unfinished daily is resumed
  forever and the start gate never appears.
* **C, Peak Draft.** The resume branch checks `board_type`/`mode` but never
  compares `active.board_id`'s embedded date to today, and returns before
  fetching today's board.
* **D, Peak Duel / Peak Draft.** `today` is computed once from the browser
  clock in render scope and *sent to the server*, which only falls back to its
  own clock when the parameter is absent. `game.py` performs no future-date
  validation at all.

**Fixes.** Route every date through `daily_key()`/`validate_daily_key()`; make
the server the default in all five modes; keep client-supplied dates only as
explicit archive requests, validated and bounded. Add the `daily` payload
(§2.1) to every daily response. Key every client cache and every persisted
resume pointer by `daily_key`, and clear a pointer whose key is not today.
`useDailyReset()` refetches at the boundary and on tab focus. Declare route
caching explicitly rather than relying on Next 15 defaults.

**Uniqueness.** `(owner_sub, mode, daily_key)` server-enforced where the product
allows one attempt. RTT already has the correct partial unique index; Daily Grid
has the correct shape; Peak Duel Daily has **no server-side attempt record at
all** (localStorage only) — Track C adds one.

**Challenge separation.** RTT already forces `run_type="challenge"` with an
explicit comment. **Peak Draft is broken**: a daily-minted challenge token
carries `board_type:"daily"` and the sender's date, so opening a friend's link
writes the recipient's *official* daily completion — and if they had already
played, `ON CONFLICT DO NOTHING` silently discards their real result. Track A
back-ports the RTT fix.

**Tests.** One minute either side of midnight PT; spring-forward (23-hour
window) and fall-back (25-hour window); leap day; year boundary; background-tab
reset; countdown reaching zero; challenge/daily separation; client-server
agreement.

---

## 5. Persistence + RLS + guest claim (Track C)

New migrations (timestamps reserved so tracks cannot collide):
| File | Purpose |
|---|---|
| `20260801100000_rls_gaps.sql` | Enable RLS on `lineup_model_versions`, `ruleset_versions`, `card_pool_versions` — today any anon key can `UPDATE is_current`. Narrow `board_snapshots`/`challenges` `USING (true)` exposure (`seed`, `token_hash`, `challenger_snapshot` are readable by anon) to column-level grants or published views. |
| `20260801110000_guest_claim_and_daily.sql` | `transfer_owner` support + `claimed_at`/`claim_id` columns where needed; `peak_duel_daily_results` with `UNIQUE (owner_sub, mode, daily_key)`; complete owner CRUD policies with `USING` **and** `WITH CHECK`. |
| `20260801120000_telemetry_events.sql` | Track F. |

**Claim flow.** Extend the existing idempotent `POST /auth/claim` to the four
domains it currently misses — `run_the_table_runs`, `daily_grid_results`,
`perfect_season_runs`, `perfect_season_saved_runs` — none of which have a
`transfer_owner` today, so a guest who plays RUN THE TABLE and signs in
permanently loses the association. Preserve: signature-verified cookie only;
403 when the anon subject was already claimed by a different user; two tabs
cannot double-claim (the `ownership_claims.anon_subject_id` UNIQUE already
enforces this); challenge-only participation never confers ownership; mid-run
and from-completion both work. Return a per-domain count so the UI can say what
was imported.

**RLS tests** extend `test_rls_policies.py` beyond its ranked-only coverage to
`profiles`, `games`, `daily_completions`, `perfect_season_*`,
`daily_grid_results` and `run_the_table_runs`, using the existing PostgREST
emulation (`SET ROLE` + `set_config('request.jwt.claims', …)`).

---

## 6. RUN THE TABLE clarity (Track E)

Progressive disclosure, three layers per perk card: **plain effect** → **one
strategic hint** → expandable **`See exact rule`** carrying the engine's
published `summary` verbatim. Transparency is moved, never removed.

Primary copy is fixed by the spec: Two-Way Value *"Balanced players cost 30%
less."*; Deep Rotation *"Your bench matters almost twice as much in most
battles."*; Trade Machine *"Trading away a player refunds more of the original
price."*; Moneyball *"Lower-rated cards are much cheaper."* Note these fix two
real mis-descriptions the audit found: "Unheralded" pointed at recognition when
Moneyball reads overall percentile, and "Big producers" pointed at Traditional
Production when No Hardware reads Statistical Impact. Deep Rotation's
`in most battles` is load-bearing — a boss bench rule overrides the perk.

Player card first-scan order: player · exact 3Y window · role · cost · PEAK3
score · strongest lane · weakest lane · profile label. Percentiles get labelled
fully ("*75.1st percentile of the card pool*"), and ordinals get a real helper —
today `"th"` is unconditional, so **every card renders `75.1th`**, and
`decisiveLane` prints `"1th lane"` for any ruleset where `LANES_TO_WIN ≠ 3`. A
correct `ordinal()` already exists at `rankings-receipts.ts:138` and is not
reused; E extracts it to `lib/ordinal.ts`.

Node copy is fixed by the spec (Rest/Bank, Draft Room, Trade Desk, Film Room).
Film Room needs the most work: four surfaces currently give four mutually
inconsistent accounts, and the node header's version — "scout the next boss's
lane profile and rule, then take one prep advantage" — matches **no code path**
(there is no prep-advantage mechanic).

Pre-boss briefing adds: first-to-3-of-5, the boss rule in plain language,
projected strengths, and estimated favoured lanes **explicitly labelled an
estimate**. Both lane profiles and a fully deterministic rule are already on the
client, so this is presentation, not new modelling. Never imply a literal
basketball simulation.

---

## 7. Balance audit (Track D)

`scripts/audit_run_the_table_v2.py`, ≥100,000 deterministic seeds per policy,
five policies: random-legal, greedy-overall, **lane-aware**, economy-aware,
look-ahead. The lane-aware policy is required because the existing harness
picks by `prime_score` while battles resolve on `lane_index` — measured win
rates today are a lower bound on what is achievable.

Emit `docs/implementation/run-the-table-balance-v2.json` with clear rate by
policy, per-boss win rates, average ending act, lives/credits remaining, perk
pick and win rates, card distribution, dominant strategies, invariant
violations. Tune from the results; do not force target numbers.

Known balance defects to address while retuning: **Deep Rotation is currently a
net nerf** (lane score is a weighted *mean*, so raising bench weight lowers your
score whenever the bench is weaker than the starters — which is the default);
`the_wall`'s tie-break has fired **0 times in 120,000 battles**, so the tutorial
boss is effectively rule-less; and **winning a boss awards nothing**, while
losing pays 8 credits.

---

## 8. Telemetry (Track F)

Minimal first-party events, product-only, with retention limits. Never an
email, OAuth/magic-link token, auth header, or raw localStorage blob. Events
per the spec list. `scripts/telemetry_report.py` produces first-run completion,
tutorial completion, second-run conversion, clear rate, boss win rates, perk
pick/win rates, trade usage, run duration, daily return.

---

## 9. Verification

Full suites with exact output: model, lineup, API (incl. the Postgres/RLS path),
Vitest, Playwright, `tsc --noEmit`, `next lint --max-warnings 0`, production
build. Hosted-Supabase migrations applied via the authenticated CLI (the project
currently has **0 of 21 local migrations applied**). Real browser journeys per
the spec's 14 scenarios, screenshots captured to
`docs/implementation/auth-daily-balance-review/`.

**Known environment blockers**, to be reported rather than worked around:
* `PEAK3_DATABASE_URL` in `apps/api/.env` carries a **stale password** for the
  newly-created hosted project (`password authentication failed`, on both the
  direct and pooler endpoints). The Supabase CLI has working credentials, so
  migrations can be pushed; the API's own asyncpg path needs the operator to
  refresh that one value.
* **Google OAuth is not enabled** on the project (`external: ["email"]`), and
  `mailer_autoconfirm` is false, so a live end-to-end OAuth or magic-link
  session cannot be minted from here without dashboard access or mailbox access.

No commit, push, PR, merge, or stash at any point.
