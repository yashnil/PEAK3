# VALIDATION MATRIX — Arena RTT Overhaul

Every row is filled with a **measured** result. `NOT RUN` and `FAILED` are
acceptable entries; a blank or an optimistic guess is not. Unit tests alone do
not constitute success for this pass.

Status legend: `PASS` · `FAIL` · `NOT RUN` (+ reason) · `BLOCKED` (+ blocker).

## 1. Numerical integrity

Status as of integration step 1 (`029c830`). Every "After" figure below was
run **by the lead against the branch**, not copied from a teammate report.

| Check | Command / method | Baseline | After | Status |
| --- | --- | --- | --- | --- |
| Canonical ranking hashes unchanged (1Y/2Y/3Y/5Y/comparison) | `shasum -a 256 leaderboards/*.csv` vs `BASELINE.md` | 5 anchors recorded | all 5 identical | **PASS** |
| 1Y / 2Y / 3Y / 5Y regression | `scripts/ci/model-tests.sh` | 939 pass / 0 fail | 946 pass, 9 skip, 1 xfail / **0 fail** | **PASS** |
| RTT known-seed reconciliation (≥3 seeds) | `scripts/audit_rtt_score_semantics.py`, seeds 11/42/2026 | 75/75 bit-identical | **75/75 bit-identical**, `all_math_verified=True`, re-run on `029c830` | **PASS** |
| Receipt components sum to `final_rating` | full-precision assertion over all 75 lanes | n/a (new) | **75/75 exact at `LANE_ROUNDING`**; 67/75 bit-exact, 8/75 differ by ~3.5e-15 | **PASS** — see note |
| Cross-user modification refused on first attempt | live, 3 consecutive non-owner calls | n/a | byte-identical 404 on attempts 1, 2 and 3 | **PASS** |
| Anonymous submission refused | test + live | n/a | 401; identical 404 (no reason leaked) on visibility route | **PASS** |
| Daily / all-time not mixed | day-boundary + pagination tests | n/a | PASS | **PASS** |
| `next_cursor` pagination stable | walks every page to exhaustion, asserts no repeated id | broken (`null` always) | PASS, both boards | **PASS** |
| Visibility route cannot flip another user's row | ownership tests | n/a | PASS, failure does not confirm ownership | **PASS** |
| RLS: no UPDATE/DELETE policy | migration policy test | n/a | PASS | **PASS** |

> **Note on receipt precision — lead ruling.** `pre_perk_rating +
> bench_adjustment + perk_adjustment == final_rating` holds **75/75 exactly at
> `LANE_ROUNDING` (4 dp)**, which is the engine's own authoritative working
> precision and the precision at which every existing comparison in
> `battle.py` already operates (`margin > threshold`, etc.). At raw float64,
> 8 of 75 differ by ~3.5e-15 — ordinary IEEE-754 summation noise from adding
> three already-rounded decimals, the same class of artifact as `0.1 + 0.2`.
>
> **This is not a defect and will not be "fixed".** Switching the residual to
> `Decimal` would modify engine arithmetic to chase a difference no display
> path, no game-logic path, and no comparison in the codebase can observe —
> a design change made for a non-defect, against a pass whose standing rule is
> that correct calculations get presentation changes, not outcome changes. The
> engine diff stays at zero. Recorded here so that a later reader checking
> bit-exact rather than working-precision equality is not surprised.
| RTT simulations | `scripts/audit_run_the_table_v3.py --seeds 300 --replay-sample 40` | never run in this pass | **PASS** — 19 hard invariants held across 300 seeds / 2400 runs / 43 replay checks, 0 soft warnings; 174 of 174 cards reachable, 0 unreachable | **PASS** |
| Lineup tests | `scripts/ci/lineup-tests.sh` | never run in this pass | **43 passed** | **PASS** |
| Web dataset build + exporter validation | `scripts/ci/build-web-data.sh` | never run in this pass | generated and validated: 1yr 250 / 2yr 249 / 3yr 248 / 5yr 237, 0 provisional | **PASS** |
| `OFFICIAL_WEIGHTS` untouched | `git diff` on `peak3.py` | — | empty diff | **PASS** |
| `calibrate_score()` untouched | `git diff` on `peak3.py` | — | empty diff | **PASS** |
| Frozen colour tokens unchanged | `grep` vs CLAUDE.md | 7 tokens | `--peak-accent` `#f5c842` + all 6 `--comp-*` identical | **PASS** |

## 2. Backend

| Check | Command | Baseline | After | Status |
| --- | --- | --- | --- | --- |
| Model tests | `scripts/ci/model-tests.sh` | 939 pass / 0 fail | 946 pass / **0 fail** (lead-run, 521.96 s) | **PASS** |
| FastAPI unit | `scripts/ci/api-unit-tests.sh` | 1198 pass / 0 fail | 1208 pass / **0 fail** (lead-run, 145.19 s) | **PASS** |
| PostgreSQL-backed integration | `scripts/ci/api-integration-tests.sh` | NOT RUN (needs real Postgres/Supabase test project) | | pending Phase 6 |
| Supabase RLS / ownership | integration suite | | | |
| Leaderboard submission | new tests | | | |
| Leaderboard read + pagination | new tests | | | |
| Leaderboard tie-break stability | new tests | | | |
| Migration verification | migration suite | | | |
| Anonymous submission rejected | new test | | | |
| Cross-user modification rejected (IDOR) | new test | | | |
| No cross-mode score mixing | new test | | | |
| Unrevealed identities absent from payload | new test | | | |

## 3. Frontend

| Check | Command | Baseline | After | Status |
| --- | --- | --- | --- | --- |
| Typecheck | `scripts/ci/frontend-verify.sh` | clean | | |
| Lint, zero warnings | `scripts/ci/frontend-verify.sh` | 0 warnings | | |
| Unit tests (vitest) | `scripts/ci/frontend-verify.sh` | 1258 / 1258 across 47 files (342 RTT-owned) | | |
| Production build | `next build` with a real HTTPS API URL | fails as-scripted on deploy-safety env guard; passes with real URL | | |

> **The production build is a mandatory gate in its own right, not a formality
> after the fast gates.** During task #17 a stray `*/` inside a `globals.css`
> comment prematurely closed the comment block. Typecheck passed, lint passed
> with zero warnings, and all 1293 vitest tests passed — **only `next build`
> caught it.** Any change touching CSS must run the real build before being
> called done.
| Playwright full suite, **zero retries** | `scripts/ci/e2e-tests.sh` | | | |
| axe accessibility | e2e suite | | | |
| Keyboard path through every cinematic | e2e suite | | | |
| Screen-reader announcements (where testable) | e2e suite | | | |

## 4. Visual matrix

Each cell must be a real screenshot with no cropped overflow.

| Viewport / condition | Homepage | Opening reveal | Draft | Boss intro | Lineup reveal | Lane resolution | Result | Leaderboard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1728×1117 | | | | | | | | |
| 1440×900 | | | | | | | | |
| 1024×768 | | | | | | | | |
| 430×932 | | | | | | | | |
| 390×844 | | | | | | | | |
| 125 % zoom | | | | | | | | |
| 150 % zoom | | | | | | | | |
| 200 % zoom | | | | | | | | |
| Dark | | | | | | | | |
| Light | | | | | | | | |
| System | | | | | | | | |
| Reduced motion | | | | | | | | |
| Slow network | | | | | | | | |
| Failed images | | | | | | | | |

## 5. Manual / browser states

| State | Expected behaviour | Result |
| --- | --- | --- |
| Homepage | Arena entrance, not a directory | |
| Opening reveal | 7 concealed slots; no name/score/season/identity leak in DOM **or** a11y text | |
| Opening reveal pacing | one user action starts it; rest queue automatically; ~8–12 s | |
| Reveal controls | pause, skip all, reduced-motion immediate | |
| Draft | decision-first card; receipts behind disclosure | |
| Trade | decision-first card; credits + role replaced visible | |
| Scout payoff | vulnerability pinned in HUD; matching market cards highlighted; effect shown later | |
| Boss intro | name, philosophy, win condition, 3-2-1 countdown, skip | |
| Paired lineup reveal | sequential paired rows; boss names concealed until reveal; no click per player | |
| Five-lane sequence | automatic; labelled LINEUP TOTAL; top contributor shown separately | |
| Victory | decisive result sequence | |
| Defeat | decisive result sequence | |
| Result screen | full run story + five actions | |
| Refresh during cinematic | recovers without inventing an outcome | |
| Resume | run state restored correctly | |
| Leaderboard | server-computed scores only | |
| Anonymous state | read allowed, submission refused | |
| Authenticated state | submission accepted and owned | |

## 6. Performance

Baseline and after must come from the **same committed script**. See
`PERFORMANCE.md` for the full tables.

| Metric | Target | Baseline | After | Status |
| --- | --- | --- | --- | --- |
| Visible response to interaction | < 100 ms | | | |
| Action latency p75 (warm hosted) | < 800 ms where infra permits | | | |
| Duplicate mutations | zero | | | |
| CLS during stage transitions | zero | | | |
| RTT readiness p50/p75/p95 | — | | | |
| RTT create p50/p75/p95 | — | | | |
| RTT reveal p50/p75/p95 | — | | | |
| RTT node action p50/p75/p95 | — | | | |
| RTT boss resolution p50/p75/p95 | — | | | |
| RTT resume p50/p75/p95 | — | | | |
| 82-0 spin p50/p75/p95 | — | | | |
| Opening-reveal round trips | 1 (from 7) | 7 | | |

## 7. Hosted staging acceptance

Deploy to the **existing staging targets only**, and only after local and CI
gates are green. Production is not touched.

| Check | Result |
| --- | --- |
| Staging web deploy succeeded | |
| Staging API deploy succeeded | |
| Google sign-in works | |
| RTT save works | |
| RTT resume works | |
| 82-0 save works | |
| Global leaderboard submission works | |
| Second account **cannot** modify the first account's entry | |
| Anonymous submission refused | |
| Ranked still disabled | |
| No secrets in the deployed diff | |

## 8. Pass-level constraints

| Constraint | Confirmed |
| --- | --- |
| No formula change (or documented + proven) | |
| No Ranked enablement | |
| No authorization / RLS / IDOR weakening | |
| No secrets or environment values committed | |
| No merge to `main` | |
| No public deployment | |
