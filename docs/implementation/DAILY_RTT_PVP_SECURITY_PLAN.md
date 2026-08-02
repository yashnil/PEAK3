# Daily Grid, RUN THE TABLE v3, PvP, Security & Footer — Integration Plan

Written by the lead **before** any writer agent edits a file, per the pass spec
(`PEAK3_DAILY_RTT_PVP_SECURITY_CLAUDE_PASS.md` §"Required parallel discovery
agents"). Seven read-only audits (A1–A7) ran first; their findings are folded in
below with `file:line` citations.

Preflight state at plan time:

```
git branch --show-current   feature/daily-rtt-pvp-security
git log -1 --oneline        253a05a Add PEAK3 accounts, Pacific daily resets, and Run the Table v2
git stash list              (empty)
git status --short          ?? PEAK3_DAILY_RTT_PVP_SECURITY_CLAUDE_PASS.md   (only the spec)
git diff --check            clean
```

The auth/daily/balance checkpoint is committed. The tree was otherwise clean.

Baseline suites before any edit: **Vitest 1089 passed / 39 files**; API suite
re-run in progress at plan time (recorded in the report).

---

## 0. Headline discovery result — the stale-board question is answered

The spec asked us not to assume the date label is stale, and to distinguish
seven candidate causes. We measured instead of assuming.

**Board generation is not stale.** `grid_seed()`
(`nba_peak/daily_grid/generator.py:246-255`) is
`sha256("peak3-daily-grid:daily_grid.v2:<date>") % 2**31` — a pure function of
the daily key. Generated independently by the lead over 365 consecutive keys:

```
distinct seeds                    365 / 365
distinct sorted-criteria hashes   365 / 365
distinct board_ids                365 / 365
```

Adjacent keys `2026-07-31 / 2026-08-01 / 2026-08-02` derive seeds
`1210089035 / 1218729072 / 1210097203` with **completely disjoint axis sets**.

**But the user-visible label does repeat.** `board_theme()`
(`generator.py:403-430`) is a memoryless first-match-wins ladder over the axis
set, with no anti-repeat term:

```
adjacent-day identical theme            93 / 364  = 25.5 %
adjacent-day identical theme AND diff   42 / 364  = 11.5 %
longest identical-theme run             6 days
theme skew                              Award Season 141/365 = 38.6 %
                                        "Open Court" occurs 0 times
```

`2026-07-31` and `2026-08-01` are identical in **both** theme and difficulty
(`Two-Way Night / easy`). The screenshot in the spec showed
`2026-08-01 · TWO-WAY NIGHT` — and the day before was also `TWO-WAY NIGHT`.

**Root cause of the reported symptom: theme-label collision on adjacent daily
keys, not a stale key, seed, board, attempt, or cache.** The theme is the most
prominent identity on the page (`DailyGridGame.tsx:588` and the gate screen), so
one day in four a genuinely-new board reads as yesterday's.

That is the headline. Ten further real defects (A1 D1–D10) are separately
scheduled below; two of them (D1, D2) are higher-severity than the reported
symptom and were not previously known.

---

## 1. Confirmed defect register

### Security — P0 release blockers (A5/A6)

`possessing an ID never grants mutation rights` is violated by **nine mutation
routes**. Four distinct P0 findings; one is new to this audit and appears in no
prior report.

| # | Sev | Route | file:line | Ownership check |
|---|---|---|---|---|
| S1 | **P0** | `POST /draft/games/{game_id}/actions` | `draft.py:199-254` | none — no `auth`, no `Response`, no cookie in the signature |
| S2 | **P0** | 7 × Perfect Season mutators (`select`, `cancel`, `respin-team`, `respin-season`, `place`, `swap-slots`, `complete`) | `perfect_season.py:244,267,290,318,342,365,401` | none |
| S3 | **P0** | `GET /draft/challenges/{token}/comparison` | `draft.py:581-675`, write at `:673` | none on caller-supplied `recipient_game_id` |
| S4 | **P0 — undocumented** | `POST /draft/challenges?game_id=…` | `draft.py:442-509` | none; stores victim's lineup + `owner_sub` |
| S5 | **P1** | RLS payload forgery: `daily_grid_results`, `run_the_table_runs`, `perfect_season_runs`, `perfect_season_saved_runs` | `…190000:88`, `…090000:105,109`, `…150000:84`, `…180000:97` | owner `WITH CHECK` pins ownership, not payload; no `REVOKE` |
| S6 | **P1** | unauth state read `GET /draft/games/{id}`, `GET /perfect-season/games/{id}` | `draft.py:187`, `perfect_season.py:231` | none |
| S7 | **P2** | Draft challenge tokens carry no `kind` claim | `draft.py:466-472` | RTT hardened (`run_the_table.py:317`), Draft did not |
| S8 | **P2** | sign-out leaves device-local caches | documented `AUTH_DAILY_BALANCE_REPORT.md:586-589` | — |

S1's blast radius is the worst: `_record_completion` (`draft.py:249-252`) writes
a `ResultSnapshot`, a `DailyCompletion` under `ON CONFLICT DO NOTHING`
(**permanently burning the victim's daily attempt with a garbage lineup**), and
XP/records/achievements/streak — all under the victim's `owner_sub`.

The correct pattern already exists twice in this codebase:
`perfect_season.py:485` (`if game_state.owner_sub != auth.sub: 403
not_your_game`) and `run_the_table.py`/`runs.py:362` (`RunForbidden` → 403
`run_not_owned`). `ranked.py:196-203` `_get_participant_or_404` is the reference
authorization primitive and never accepts a client-supplied game id.

**Gate: PvP does not ship until S1–S4 are closed with adversarial tests.**
Per spec §7: *"Do not report completion while a known mutable IDOR remains."*

### Daily Grid (A1)

| # | Sev | Defect | Location |
|---|---|---|---|
| D5 | **headline** | theme repeats on adjacent keys 25.5 % of the time, runs to 6 days, `Award Season` takes 38.6 % of the year, `Open Court` unreachable | `generator.py:403-430` |
| D1 | **high** | midnight-PT rollover in an open tab **discards a partially-filled board** with no prompt; the recovered board is then flagged `counted_for_streak:false` | `DailyGridGame.tsx:225-228`, `:184-197` |
| D2 | **high** | refetch storm when the device clock is wrong: `firedForRef` cleared on every new window object → 1 fetch/s → 429 at `DAILY_GRID_BOARD_RATE_LIMIT=120/min` | `use-daily-reset.ts:112,129` |
| D3 | high | no authenticated attempt lookup exists at all; `list_results_for_owner` is dead code; second device / cleared storage shows a blank board despite a durable official row | `daily_grid_protocols.py:91` (0 callers) |
| D4 | med | `board_hash`, `attempt_status`, `theme_id` do not exist; `daily_key` only nested under `daily.` | `models/daily_grid.py:89-103` |
| D6 | med | `officialSaved` never reset across a rollover → false "official" badge | `DailyGridGame.tsx:159,305` |
| D7 | med | board generation (up to 8000 attempts) runs **before** the rate limiter | `daily_grid.py:240-242` |
| D8 | med | timer is 100 % client-authoritative; `elapsed_seconds` stored unvalidated; clock runs while the tab is closed | `daily-grid-state.ts:245-265` |
| D9 | med | `20260730190000_daily_grid_results.sql` never pushed to hosted Supabase → the UNIQUE constraint backing idempotency is absent there | migration header `:4-7` |
| D10 | low | stale "UTC" contracts after the Pacific move | `models/daily_grid.py:93`, `types/daily-grid.ts:69`, `generator.py:202` |

### RUN THE TABLE (A3/A4)

Film Room is measurably dead content. Over 100 000 seeds × 6 policies
(`docs/implementation/run-the-table-balance-v2.json`):

| Policy | film_room pick rate |
|---|---|
| lane_aware | **0.0 %** (zero times in 100 000 runs) |
| look_ahead | 5.5 % |
| greedy_overall | 8.7 % (and **0** `scout_offers` — 69 455 `take_credits`) |

Every competent policy either avoids it or takes the credits and ignores the
intel. **A4's question — "can Film Room information change a later decision?" —
answers itself: no policy that could use it does.** Replacement, not expansion.

Economy is over-generous: `passive` (the do-nothing control) ends with a mean of
**87.6 unspent credits** against `STARTING_CREDITS = 50`, because mid-run income
(Rest 12, Film 10, boss win 10, comeback 8, trade refunds) roughly doubles the
budget. Spec target: *"a competent policy should usually finish with fewer than
20 credits."* Only `lane_aware` (15.7) and `look_ahead` (18.4) currently do.

Structural: `ACTS = 4` (`config.py:201`) auto-derives `DECISION_NODES = 8` and
`BATTLES = 4`. Going to 5 needs a 5th curated boss (`bosses.py:50-124` is a
4-tuple), a 5th `BOSS_TARGET_STARTER_MEAN` band (`config.py:484`), and a
`RULESET_VERSION` bump.

### Footer / legal (A7)

A footer already exists but is **two sentences of prose with zero links**
(`apps/web/src/app/(main)/layout.tsx:12-23`). No `/terms`, `/privacy`,
`/accessibility`, `/contact`, `/data-sources`, or `/changelog` route exists.

Facts that constrain what the legal pages may say — all code-derived:

* Auth: Google OAuth, email magic link, email+password are **implemented**
  (`lib/auth.ts:220-284`). Apple is not. `enable_anonymous_sign_ins = false`;
  guest identity is a first-party signed cookie `peak3_anon`.
* Telemetry is **off by default** (`config.py:329`), unauthenticated, a closed
  21-event allowlist, subject pseudonymised by HMAC so it **cannot** be joined
  to game data, 90-day retention. Honours GPC and DNT. `optOut()` is exported
  but **has no UI call site** — so "you can opt out" is not yet true in-product.
* **Zero third-party analytics.** No posthog/plausible/GA/segment/sentry/vercel
  analytics in `package.json` or `src/`.
* **No account deletion and no data export exist.** `@router.delete` has zero
  matches across the whole API.
* **No contact address exists anywhere in the repo.**
* External asset URLs (NBA/ESPN logos, headshots) are gated OFF by
  `ENABLE_EXTERNAL_ASSET_URLS = False` (`config.py:190`), and the manifests
  themselves record `"license_status": "unknown_do_not_cache"`.

**Must-not-claim list** (A7 §"Explicitly unverified"): hosting provider, exact
Supabase cookie names, which providers are live on the hosted project,
Basketball Reference license posture, SMTP provider, and whether
`ENABLE_EXTERNAL_ASSET_URLS` is true anywhere deployed. No GDPR/CCPA/COPPA/
SOC 2 claim will be made. Pages ship marked as **beta drafts pending legal
review**.

---

## 2. Sequencing

Security first, because the spec makes it a gate on PvP, and because PvP built
on Peak Draft today would inherit all four P0s.

```
Phase 1  Security S1–S6            ← gate
Phase 2  Daily Grid  (server, then web)
Phase 3  RUN THE TABLE v3 engine → API → web
Phase 4  PvP head-to-head          ← gated on Phase 1
Phase 5  Footer + legal pages
Phase 6  Balance sim, full suites, browser capture, report
```

Phases 2, 3 and 5 are mutually disjoint and may run concurrently. Phase 4
serialises after Phase 3 (both own `run_the_table.py`).

## 3. File ownership map — strict, non-overlapping

No two concurrent writers may hold the same path. A writer that needs a file it
does not own raises it to the lead instead of editing.

| Writer | Owns (exclusive) |
|---|---|
| **W1 Security** | `apps/api/app/core/ownership.py` *(new)*, `apps/api/app/api/v1/draft.py`, `apps/api/app/api/v1/perfect_season.py`, `supabase/migrations/20260801140000_*.sql` *(new)*, `apps/api/tests/test_ownership_idor.py` *(new)*, `apps/api/tests/integration/test_rls_policies.py` |
| **W2 Daily Grid server** | `nba_peak/daily_grid/generator.py`, `apps/api/app/api/v1/daily_grid.py`, `apps/api/app/models/daily_grid.py`, `apps/api/app/repositories/daily_grid_*.py`, `supabase/migrations/20260801150000_*.sql` *(new)*, `apps/api/tests/test_daily_grid*.py`, `tests/daily_grid/` |
| **W3 Daily Grid web** | `apps/web/src/components/daily-grid/**`, `apps/web/src/lib/daily-grid-*.ts`, `apps/web/src/lib/use-daily-reset.ts`, `apps/web/src/types/daily-grid.ts`, `apps/web/src/components/ui/tour-steps.ts`, `apps/web/src/tests/unit/daily-grid-*.test.*` |
| **W4 RTT engine** | `nba_peak/run_the_table/**`, `tests/run_the_table/**`, `scripts/audit_run_the_table_v3.py` *(new)* |
| **W5 RTT API+web** | `apps/api/app/services/run_the_table/**`, `apps/api/app/api/v1/run_the_table.py`, `apps/api/app/models/run_the_table.py`, `apps/web/src/components/run-the-table/**`, `apps/web/src/lib/run-the-table-*.ts`, `apps/web/src/types/run-the-table.ts` |
| **W6 PvP** | *(after W5 releases)* `apps/api/app/api/v1/run_the_table.py`, plus `apps/api/app/services/head_to_head.py` *(new)*, `apps/web/src/app/(main)/arena/run-the-table/h2h/**` *(new)*, `supabase/migrations/20260801160000_*.sql` *(new)* |
| **W7 Footer/legal** | `apps/web/src/components/layout/Footer.tsx` *(new)*, `apps/web/src/app/(main)/layout.tsx`, `apps/web/src/app/(main)/{terms,privacy,accessibility,contact,data-sources}/**` *(new)*, `apps/web/src/lib/nav-model.ts` |
| **Lead** | `docs/implementation/**`, cross-cutting arbitration, all verification runs |

Shared-but-frozen (no writer edits without lead sign-off): `nba_peak/daily_key.py`,
`peak3.py`, `OFFICIAL_WEIGHTS`, `leaderboards/*.csv`,
`apps/api/app/core/auth.py`, `apps/api/app/core/security.py`.

---

## 4. Design decisions

### 4.1 Ownership (W1)

New `apps/api/app/core/ownership.py` with two functions, so the rule is stated
once and tested once:

```python
def existing_owner_sub(auth, anon_cookie, signing_secret) -> str | None
    # verified JWT sub, else HMAC-verified anon cookie sub, else None.
    # NEVER mints. A mutation route must not hand out a credential.

def assert_owns(resource_owner_sub, caller_sub, *, code, message) -> None
    # 403 unless both are non-None and equal. Fails closed on a null owner.
```

`resolve_owner_sub` (which mints) stays for *creation* routes only. Mutation
routes use `existing_owner_sub` — a caller with no credential cannot be the
owner, and issuing them one mid-mutation would paper over the bug.

Rationale for **403, not 404**: `run_the_table.py:189-194` already chose 403
`run_not_owned`, and the two-tab/idempotency tests depend on distinguishing
"not yours" from "gone". Consistency beats the marginal enumeration hardening,
and the ids are already unguessable UUIDs.

Rationale for **fail-closed on `owner_sub IS NULL`**: all three Draft creation
paths (`draft.py:128`, `:174`, `:718`) and both Perfect Season ones
(`perfect_season.py:192,221`) set a non-null owner today, so a null owner means
a pre-ownership legacy row. Games expire; refusing to mutate an ownerless row is
the safe reading. Recorded as a known limitation.

**Cookie transport is already correct** — verified before designing: every web
API client sends `credentials: "include"`
(`daily-grid-api.ts:55`, `perfect-season-api.ts:45`, `run-the-table-api.ts:47`,
`supabase/claim.ts:156`) and `main.py:107` sets `allow_credentials=True`. So
adding the check does not break anonymous play.

S3 fix: derive the settlement's recipient game from the **caller's** ownership,
never from the query string. S4 fix: require the minting caller to own
`game_id`. S5 fix: one new migration mirroring the already-shipped
`20260801130000_peak_duel_results_revoke.sql` across the four remaining tables,
proved against real Postgres — the local `supabase_db_PEAK3` container is up and
fully migrated with RLS on all 40 public tables.

### 4.2 Daily Grid (W2/W3)

* **D5 (headline).** Add a deterministic anti-repeat term to theme selection
  that is a pure function of the daily key *and its predecessor* — no clock, no
  state. Rebalance the ladder so `Award Season` cannot swallow 38.6 % and
  `Open Court` is reachable. Constraint: this must not change which *board* a
  date gets, only its label; `board_theme` is documented as a description, never
  a generation input (`generator.py:403-411`), and that property is preserved.
* **D4.** Add top-level `daily_key`, `timezone`, `seed`, `theme_id`,
  `board_hash`, `starts_at`, `ends_at`, `seconds_remaining`, `attempt_status`
  to the board response, per spec §1. `board_hash` = stable digest over the
  criteria signature; `seed` becomes safe to expose because the board is already
  fully public and the seed adds no hidden information (answers were never
  seed-derived secrets — but this is re-verified before exposing it, and if any
  hidden state is seed-derived the field is omitted and the omission reported).
* **D1.** A rollover mid-play must **prompt**, not discard. Keep the finished-
  but-unsaved board addressable and offer an explicit move to the new day.
* **D2.** Fix the guard so a new window object cannot re-arm the same fire.
* **D3.** Add an authenticated `attempt_status` lookup for today, wiring the
  already-existing dead `list_results_for_owner`.
* **D7.** Move `_enforce` before `_resolve_board`, matching `/answer`'s correct
  order at `:350-351`.
* **Timer (spec §2).** New idempotent `POST /daily-grid/{daily_key}/start`.
  Timestamp written once; double-click, refresh and two-tab safe. Tour time and
  page-load time are excluded because the clock starts only on that call.
  Existing attempts resume true elapsed time. Archive/challenge views never
  touch today's attempt.
* **Walkthrough (spec §2).** Reuse `GuidedTour`/`TourLauncher`
  (`components/ui/GuidedTour.tsx`) and the versioned multi-tour store
  (`lib/tour-state.ts`, already keyed by `tourId` — no storage change needed).
  Widen the RTT-only `TOUR_TARGET_IDS` union (`tour-steps.ts:56-79`). Migrate
  the unversioned `"peak3.daily-grid.rules-seen"` flag (hardcoded in ~8 e2e
  sites) into the versioned store so onboarding is replayable after a copy
  change. Rebuild `HowToPlay`'s panel on `Dialog` — it currently has no focus
  trap, no layer stack, no scroll lock and no focus restoration
  (`HowToPlay.tsx:72-82`).

### 4.3 RUN THE TABLE v3 (W4/W5)

`ACTS = 5` auto-derives 10 decision nodes and 5 battles. Also required:
a 5th curated boss + target band; `RULESET_VERSION → rtt_ruleset_v3`;
re-tuned income against the 4 new credit sinks.

Film Room → **Scout & Prepare**, three actionable choices every visit
(spec §5): Scout the Boss (+ one visible capped lane prep bonus), Shape the
Market (role focus, guarantees a legal matching offer), Reserve a Future Card.
Sinks: Market Refresh 7, Reserve 5, Role Focus 6, Emergency Recovery (published
price, per-run cap).

Determinism is preserved by the existing keyed-stream design
(`generation.py:45-46`, `_rng(seed, stream)`): every new mechanic gets its own
stream key so it **cannot shift any existing stream's output**. Spec §6's
`seed + act + stage + node_type + refresh_index` is exactly this contract.

Back-compat: the version gate (`state.py:129-138`) already rejects mismatched
saved runs with a 409 and a human sentence, and challenge tokens carry their
ruleset (`runs.py:265-281`). v2 runs retire gracefully through that existing
path; no v2 run is silently reinterpreted under v3 rules.

`SYSTEM_PUBLISHED_THRESHOLDS` / `BOSS_RULE_PUBLISHED_THRESHOLDS`
(`config.py:357-391`, `:464-477`) must be updated in lockstep with any rule
change or `test_cards_and_pricing.py` fails — this is a feature, not an
obstacle.

### 4.4 PvP (W6)

Built on the **ranked** authorization model (`ranked.py:196-203`), not the Draft
one, and on the `challenge_participants` / `challenge_settlements` tables which
already exist with RLS and a not-self trigger and have **zero** application
references today (`…124800:31-79`) — a ready-made foundation.

Invite = high-entropy HMAC token with a `kind` discriminator (RTT's pattern,
`run_the_table.py:317`), carrying no mutable resource id. Both sides get the
same rules version, roster, node structure, offer inputs and bosses; choices
diverge. Winner order exactly as spec §6. Spoiler-safe via ranked's
`opponent_status = "hidden"` pattern. Challenge play does not consume a daily
attempt (RTT already enforces this at `run_the_table.py:378-384`).

### 4.5 Footer / legal (W7)

Responsive three-column footer (Play / Learn / Legal), copyright, and the exact
NBA disclaimer from spec §8. New routes follow the `(main)/about/page.tsx`
convention. Every factual claim traces to §1's inventory; each page carries a
source comment marking it a beta draft for legal review. Note the nav-model
invariant test ("every nav href resolves to a route", `nav-model.ts:406`) — new
links are subject to it.

---

## 5. Verification contract

| Area | How |
|---|---|
| Daily freshness | `docs/implementation/daily-grid-freshness-audit.json`, ≥30 consecutive keys with `daily_key/seed/theme_id/board_hash/criteria`; fails on unintended duplicates |
| Security | adversarial cross-user API tests (attacker with victim game/attempt id, challenge-recipient mutation, anon token swap, forged payload sub, replayed action, stale version) **plus** real-Postgres RLS write-denial tests — the existing `test_rls_policies.py` is SELECT-only today |
| Balance | ≥100 000 seeds × 7 policies → `docs/implementation/run-the-table-balance-v3.json` |
| Suites | model, lineup, API, real-Supabase RLS, Vitest, Playwright, typecheck, lint (zero warnings), production build — exact output surfaced |
| Browser | production build against the real API/DB; the 19 frames of spec §10, each inspected, into `docs/implementation/daily-rtt-pvp-review/` |

Real Postgres is available: the local `supabase_db_PEAK3` stack is running
(PostgreSQL 17.6) with all 25 migrations applied and RLS enabled on all 40
public tables.

Screenshots are inspected, not merely captured — the prior pass caught a frame
whose pixels contradicted its filename that way
(`AUTH_DAILY_BALANCE_REPORT.md:598-613`).

---

## 6. Constraints held throughout

* `OFFICIAL_WEIGHTS`, `calibrate_score()` and `leaderboards/*.csv` are untouched.
* No PEAK3 scoring in TypeScript; no scraping in a request path; no hardcoded
  players; no fabricated data; game scoring stays `arena_points`.
* Pacific daily policy, RLS, deterministic seeds, existing challenge links and
  all five current game modes keep working.
* **No commit, push, pull request, merge, or stash.** The full diff is left
  unstaged for review.
