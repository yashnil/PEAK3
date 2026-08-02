# RUN THE TABLE — Overnight Pass Report

**Date:** 2026-07-31 · **Branch:** `main` · **Nothing was committed or pushed.**

---

## 1. Executive summary — what is genuinely playable

**RUN THE TABLE ships as a complete, playable vertical slice.** An anonymous
visitor with no sign-in can open `/arena/run-the-table`, press one button, and
play a full 10–15 minute front-office roguelike to a final result screen, on
desktop and on a phone. This was verified by driving a real browser against a
real API — not by reading the code.

A run is:

- a role-legal **5 starters + 2 bench** roster of canonical exact 3-year PEAK3
  peak windows, drawn from the middle of the board;
- **40 credits, 3 lives**, and one of three **Systems** chosen at the start,
  plus a second after Boss 1;
- **3 acts**, each with **2 branching decision nodes** (Draft Room / Trade Desk
  / Film Room / Rest-Bank) and a **boss battle** — 6 decisions, 3 battles;
- battles resolved by comparing **five canonical PEAK3 component lanes**, first
  to three lanes, with a published tie-break ladder and a symmetric boss rule;
- a final **receipt**: record, run MVP by drop-one marginal contribution, best
  acquisition, best trade, closest battle, credit ledger, and a signed-delta
  "why the run went this way".

Everything is deterministic from `(seed, engine, ruleset, card pool, model)`.
The same seed produces a byte-identical run; a challenge link reproduces the
sender's run exactly; reloading mid-run resumes at the same screen.

---

## 2. Repository state

**At the start of the pass:**

```
$ git rev-parse --abbrev-ref HEAD          main
$ git rev-parse HEAD                       c80631757986976c7e22a057e04cdbf022269cff
$ git log -1 --format='%h %s'              c806317 feat(peak3): add PEAK3 v2 with replacement-level postseason calibration
$ git status --short
?? PEAK3_Run_The_Table_Claude_Code_Pass.md
$ git diff --stat
(empty)
```

The tree was **clean** apart from the untracked brief — there was no
pre-existing uncommitted work at risk. The safety rules were followed anyway:
nothing was reset, stashed, discarded, or overwritten; no generated dataset,
migration, asset, or existing game mode was deleted.

**Canonical model artifacts are untouched.** Verified:

```
$ git status --short leaderboards/ data/ peak3.py nba_peak/lineup nba_peak/perfect_season make_outputs.py
(empty)
```

`OFFICIAL_WEIGHTS`, `calibrate_score()`, and every `leaderboards/*.csv` are
byte-identical to `c806317`.

---

## 3. Architecture and reuse decisions

The repo already had two game-domain precedents; RUN THE TABLE copies their
shape rather than inventing a third.

```
nba_peak/lineup/          → apps/api/app/services/draft/           (Peak Draft)
nba_peak/perfect_season/  → apps/api/app/services/perfect_season/  (82-0)
nba_peak/run_the_table/   → apps/api/app/services/run_the_table/   (NEW)
```

**Reused, not cloned:**

| Concern | Reused from |
|---|---|
| Card pool | `data/game/profiles/card_profiles.v3.json` — the same artifact Peak Draft uses |
| Component values | `data/web/peak_windows.json` (verified 984/984 id match, 0 score mismatches) |
| Role model | the repo's five roles from `nba_peak/lineup/board.py` |
| Seeding | namespaced SHA-256 + `random.Random`, per `nba_peak/perfect_season/daily.py` |
| Anonymous identity | `app.core.auth.resolve_owner_sub` (mints the `peak3_anon` cookie) |
| Challenge tokens | `app.core.security.create_session_token` |
| Repository split | `_protocols` / `_memory` / `_postgres` + `REPOSITORY_DOMAINS` |
| Feature flags | the `COURTBUILDER_*` master-switch + readiness-level pattern |
| UI | `PlayerAvatar`, `GameCard`, `.share-card-shell`, `.score-number`, the `component-comparison.tsx` lane-bar precedent |

**Deliberately not done:** no Tailwind config (the repo has none — everything is
CSS custom properties), **no seeded RNG in TypeScript** (all determinism is
server-side), no second canvas exporter, no new UI primitive layer.

### Canonical vs experimental boundary

The pool is pinned to **canonical**: the 3-year windows of
`card_profiles.v3.json` that are not `excluded`, joined to
`peak_windows.json` — **174 cards** (248 3Y windows minus 74 with no eligible
role, the same exclusion Peak Draft applies).

The experimental 884-row `top_1000_peaks.v2.json` board was **not** used. It
would have added cards and precomputed percentiles, but it is a different model
version (`peak3_v2`) and disagrees with the canonical board about *which* window
is a player's best 3-year window for 17 of 246 shared players. Consuming it
would silently promote experimental data to production. The pool loader is
parameterised on its paths, so an explicit adapter can be added later.

Role coverage in the eligible pool: `guard_wing` 155, `wing_forward` 133,
`forward_big` 120, `lead_creator` 62, **`anchor` 28**. Anchor scarcity is a real
constraint on the player and on every boss.

---

## 4. Exact rules and formulas implemented

**Lane normalisation.** Canonical components are *pre-weighted contributions*,
so they sit on incommensurable scales (`team_achievement` spans 0–3,
`statistical_impact` spans ~13–37). Each lane is rescaled linearly across the
eligible pool:

```
lane_index[l] = 100 × (value[l] − pool_min[l]) / (pool_max[l] − pool_min[l])
```

Linear and monotonic, so it never changes which roster is better in a lane. The
constants are published at `GET /api/v1/run-the-table/meta`.

**Price.**

```
base_cost = clamp(4 + round(26 × percentile²), 1, 30)
```

`percentile` is the card's rank percentile of `prime_score` in the eligible
pool. Monotonic non-decreasing by construction. On the real board: costs 4–30,
87 cards ≤ 10, 20 cards ≥ 25.

**Roster lane score.**

```
lane_score = Σ(wᵢ × lane_indexᵢ) / Σ(wᵢ)
w = 1.00 starters, 0.35 bench
    (0.65 with Deep Rotation or the Strength-in-Numbers boss rule,
     0.15 under Top Heavy)
```

**Battle.** First to 3 of 5 lanes. Lane values are rounded to 4 dp then compared
with ε = 1e-6. If ties prevent either side reaching 3: summed lane margin →
overall weighted roster total → exact draw. A loss costs one life and, if lives
remain, awards 8 comeback credits.

**Economy.** The **Draft Room refunds nothing** when you displace a card; the
**Trade Desk** is the only place a departing card returns credits (50%, or 70%
with Trade Machine). That asymmetry is what makes the two node types a real
choice rather than "Trade Desk with more options", and it is what keeps the
economy from inflating to the point where every run ends in GOATs.

**Draft Room affordability.** Every Draft Room is guaranteed to contain at least
one offer at or below `DRAFT_GUARANTEED_AFFORDABLE_COST = 10` — a bound a
broke player can actually reach (it equals the Film Room credit award and is
below the Rest/Bank award). Combined with the always-legal *pass*, a dead-end
node is impossible.

**Run MVP.** Drop-one marginal contribution to the roster's weighted total — a
real counterfactual on published values, not a heuristic.

### Systems

Six, at most two held, offered at the start and after Boss 1. All thresholds are
centralised in `config.py`, and each System's player-facing `summary` is
**derived from the same constants its predicate reads**. A
`SYSTEM_PUBLISHED_THRESHOLDS` contract plus a test that introspects each
predicate's source makes it impossible for a rule to read a constant its summary
does not disclose.

### Bosses

| Act | Boss | Rule | Starter mean (target) |
|---|---|---|---|
| 1 | The Wall | Traditional Production wins exact lane ties, both sides | 60.70 (61) |
| 2 | Strength in Numbers | bench weight 0.65, both sides | 64.69 (65) |
| 3 | The Ceiling | bench weight 0.15, both sides | 70.14 (70) |

**Named for their statistical identity, not for real teams.** Each card is that
player's own career-best 3-year window, frequently from a different franchise
and era — labelling a lineup "2004 Detroit" while serving Chauncey Billups'
2005-08 *Denver* window would be a claim the data does not support. Rip
Hamilton, Tayshaun Prince, Danny Green and Andre Iguodala have no canonical 3Y
window in this pool at all, which independently rules out the historical
framing. A tested deterministic fallback generator covers a curated card ever
leaving the pool.

---

## 5. Files added / modified, by domain

### Engine — `nba_peak/run_the_table/` (new, 10 modules)
`__init__.py`, `config.py`, `schemas.py`, `cards.py`, `pricing.py`, `bosses.py`,
`battle.py`, `generation.py`, `state.py`, `receipt.py`, `daily.py`

### API — `apps/api/`
New: `app/api/v1/run_the_table.py`, `app/models/run_the_table.py`,
`app/services/run_the_table/{__init__,public,serialization,runs}.py`,
`app/repositories/run_the_table_{protocols,memory,postgres}.py`,
`tests/test_run_the_table.py`
Modified (surgical): `app/main.py` (+2), `app/core/config.py` (+50),
`app/core/dependencies.py` (+28), `app/core/repository_registry.py` (+1)

### Web — `apps/web/`
New: `src/app/(main)/arena/run-the-table/page.tsx`,
`src/components/run-the-table/` (17 components),
`src/lib/run-the-table-{api,state}.ts`, `src/lib/modes.ts`,
`src/types/run-the-table.ts`,
`src/tests/unit/run-the-table-{state,components}.test.*`,
`src/tests/e2e/run-the-table.spec.ts`,
`src/tests/tools/capture-run-the-table-shots.ts`,
`playwright.rtt-screenshots.config.ts`
Modified: `src/app/(main)/page.tsx`, `src/app/(main)/arena/page.tsx`,
`src/app/(main)/arena/ranked/page.tsx`, `src/app/(main)/signin/page.tsx`,
`src/components/daily/DailyHub.tsx`, `src/components/layout/nav.tsx`,
`src/styles/globals.css` (append-only section), `package.json` (`start:api` env),
and five e2e specs updated to the new information architecture

### Scripts / data / docs
New: `scripts/audit_run_the_table.py`,
`supabase/migrations/20260731090000_run_the_table.sql`,
`docs/implementation/RUN_THE_TABLE_IMPLEMENTATION_PLAN.md`,
`docs/implementation/RUN_THE_TABLE_PASS_REPORT.md`,
`docs/implementation/run-the-table-review/` (14 screenshots + audit JSON)

---

## 6. Database / migration impact

One new migration: `supabase/migrations/20260731090000_run_the_table.sql`,
creating `run_the_table_runs` (`run_id` PK, `owner_sub`, `seed`, `run_type`,
`run_date`, `status`, `snapshot jsonb`, three version columns, timestamps), an
index on `(owner_sub, created_at desc)`, and a partial unique index on
`(owner_sub, run_type, run_date) where run_type = 'daily'` so the first daily
attempt is the official one.

`scripts/validate_migrations.py` → **PASS**. The domain is registered in
`REPOSITORY_DOMAINS` with both memory and postgres implementations (15/15
domains now resolve).

**The blueprint is never persisted** — it is always regenerated from the stored
seed, and `assert_version_compatible` rejects a snapshot whose versions moved.

**Not exercised:** the Postgres path. All API tests run on the in-memory
fallback (`DATABASE_URL` is not set locally). See §11.

---

## 7. Screenshots and visual review

`docs/implementation/run-the-table-review/` — 14 PNGs captured by driving a real
browser against a real API (`playwright.rtt-screenshots.config.ts`, ports
8010/3001, external asset URLs explicitly off):

| Desktop 1440×1000 | Mobile 390×844 |
|---|---|
| `01-home-desktop` | `09-start-gate-mobile` |
| `02-arena-hub-desktop` | `10-system-select-mobile` |
| `03-start-gate-desktop` | `11-node-choice-mobile` |
| `04-system-select-desktop` | `12-draft-room-mobile` |
| `05-node-choice-desktop` | `13-battle-reveal-mobile` |
| `06-draft-room-desktop` | `14-result-mobile` |
| `07-battle-reveal-desktop` | |
| `08-result-desktop` | |

**Notes from inspecting them (not assuming):**

- The three-zone desktop layout reads correctly: run ladder left, one decision
  centre, persistent front office right. Tabular numerals throughout, component
  colours on the lane bars, monogram avatars, no photos or logos anywhere.
- The battle reveal shows both scores, the lane winner in **text** (not colour
  alone), the top contributing card on each side, a running series count, a
  verdict stamp, and the full arithmetic receipt (summed margin, roster totals,
  bench weight, credits, lives) — plus a persistent "Reveal instantly".
- The result screen carries every field §6 of the brief lists except two
  (see §11).
- **Capture artifact, not a bug:** in `08-result-desktop` the sticky nav appears
  mid-page over the centre column. That is a Playwright `fullPage` +
  `position: sticky` artifact; the nav is a normal `sticky top-0` with a solid
  background. Confirmed by reading the CSS.
- **Real bug found and fixed** in the same screenshot: the sticky *rails* were
  `top: 24px` under a 56px nav, so their headings were permanently occluded once
  the page scrolled. Now `top: 72px` with `max-height: calc(100vh - 96px)`.

---

## 8. Simulation audit — actual numbers

`scripts/audit_run_the_table.py --seeds 10000` → **exit 0**, 40,000 runs across
four deterministic policies, ~16s.

```
-- HARD INVARIANTS -----------------------------------------------------------
illegal_starting_rosters                              0
duplicate_identities                                  0
rosters_outside_percentile_band                       0
draft_boards_above_guaranteed_affordable_cost         0
nodes_with_no_legal_action                            0
dead_end_runs                                         0
replay_receipt_mismatches                             0
negative_credit_states                                0

-- CONTENT -------------------------------------------------------------------
distinct cards offered : 174 of 174   unreachable cards 0   unreachable bosses 0
node types  : draft_room 40128, trade_desk 33307, rest_bank 23347, film_room 23218
era (anchor): 1970s 2657, 1980s 48065, 1990s 60938, 2000s 68841, 2010s 70241, 2020s 39563
battles decided by : lanes 119999, summed_margin 1
```

**Policy outcomes (10,000 seeds each):**

| Policy | Survived | Ran the table | Act 1 | Act 2 | Act 3 | Spend p10/p50/p90 |
|---|---|---|---|---|---|---|
| greedy | 95.4% | **12.0%** | 90.0% | 40.0% | 18.6% | 31 / 41 / 55 |
| random | 91.3% | 6.6% | 75.6% | 23.6% | 11.6% | 0 / 27 / 47 |
| first-option | 92.0% | 6.6% | 75.9% | 24.3% | 11.7% | 0 / 28 / 47 |
| **never buy** | 83.2% | **0.0%** | 58.2% | 0.5% | 0.0% | 0 / 0 / 0 |

The load-bearing result is the last row: **passive play never runs the table**,
so upgrades decide runs. Best play at 12% is a credible "one more run" rate. No
dominant strategy (ceiling is 60%); the passive policy is far under the 5%
warning line.

The script **fails nonzero** on any hard-invariant violation — proven, not
assumed: injecting a narrowed percentile band produced
`FAIL … rosters_outside_percentile_band: 35` with exit 1.

Two balance bugs were found by measurement, not review:
1. **Two-Way Value discounted GOATs** — an all-time great is "balanced" because
   every lane is near the ceiling, making the System a 30% GOAT coupon.
2. **The Draft Room refunded the displaced card**, inflating spend to a median
   of 71 credits against a 40-credit budget.

---

## 9. Every command and its exact result

| Command | Baseline (pre-pass) | Final | Δ |
|---|---|---|---|
| `pytest tests/ -q` | 618 passed, 1 xfailed | **831 passed, 1 xfailed** | +213 |
| `pytest tests/run_the_table/ -q` | — | **213 passed** | new |
| `cd apps/api && pytest tests/ -q` | 807 passed, 18 skipped | **850 passed, 18 skipped** | +43 |
| `cd apps/web && npx tsc --noEmit` | clean | **clean** | — |
| `cd apps/web && npm run lint` | clean | **clean, 0 warnings** | — |
| `cd apps/web && npx vitest run` | 21 files / 454 | **23 files / 562** | +108 |
| `cd apps/web && npm run build` | — | **succeeds**, `/arena/run-the-table` 16.7 kB / 155 kB First Load | — |
| `npx playwright test` | 247 tests | **264 passed, 0 failed** (12.2m) | +6 |
| `scripts/audit_run_the_table.py --seeds 10000` | — | **exit 0, 8/8 invariants, 0 violations** | new |
| `scripts/validate_migrations.py` | PASS | **PASS** | — |

The 18 API skips are the documented external-integration path (Supabase /
Postgres credentials absent locally) and are unchanged from baseline. The 1
`xfailed` is the pre-existing `@pytest.mark.xfail(strict=True)` in
`tests/test_postseason_sample_invariant.py`.

**No test was suppressed, skipped, weakened, or deleted.** Five existing e2e
specs were *updated* because the information architecture deliberately changed
(the flagship destination and the home hero); each assertion was re-pointed at
the new intent with the same rigour, and new assertions were added proving the
promotion did not hide 82-0, Daily Grid, Peak Duel, or the leaderboard.

---

## 10. Fresh-context review findings and resolution

Four independent read-only agents did discovery; four more reviewed the finished
diff with no prior context.

| # | Severity | Finding | Resolution |
|---|---|---|---|
| B1 | **BLOCKER** | Challenge links were broken two ways: the API handed out `/c/{token}`, which is *Peak Draft's* page and 404s an RTT token; and the start gate never offered a way to play a challenge, so a recipient pressing "Start a run" silently got a fresh random seed. | Canonical path is now `/arena/run-the-table?c={token}` at both ends; the gate resolves the token, shows the challenged seed before committing, and offers a primary "Play this challenge". Covered by a new e2e test. |
| B1b | **BLOCKER** | A challenge created from a run kept the *origin's* `run_type`, so a challenge of a daily would consume the recipient's daily attempt. | A challenge-created run is always `run_type = "challenge"`; the token's seed is what makes it identical, its type is only provenance. Caught by the new e2e test. |
| M2 | MAJOR | **Two-Way Value applied an undisclosed threshold.** The published rule described 26 cards; the predicate matched 3. LeBron, Jordan, Jokic, Curry, Duncan, Giannis, Durant and Hakeem all satisfied the stated rule and were charged full price. | All six summaries are now derived from the constants their predicates read, plus a `SYSTEM_PUBLISHED_THRESHOLDS` contract and a test that introspects each predicate's source so this drift cannot recur. Also fixed: Deep Rotation over-promised ("in every lane" — a boss rule overrides it) and Veteran Minimum omitted that it is Draft-Room-only. |
| M3 | MAJOR | **The Draft Room affordability guarantee was vacuous** — it filtered at 40 credits while `PRICE_MAX` is 30, so the "guaranteed affordable" slot was an unconstrained random draw, and the audit invariant certifying it could not fail. | Real bound `DRAFT_GUARANTEED_AFFORDABLE_COST = 10`. Proven non-vacuous: over 1,281 Draft Rooms the new bound gives 0 violations, the old one gives **149**. |
| M4 | MAJOR | **No Playwright coverage for the new mode at all.** | New `run-the-table.spec.ts` with all 6 required scenarios: full desktop run, full mobile run with the overflow contract, reload-and-resume, daily stability, challenge-seed reproduction, and "navigating creates no run". |
| A1 | MAJOR | **Keyboard focus destroyed on every action** — the pressed button was disabled then unmounted, dropping focus to `<body>`, so the next Tab restarted at the skip link. ~12 times per run. | Focus moves to the new surface's heading after each committed change, keyed on screen + node. The resume path deliberately does not steal focus. |
| A2 | MAJOR | **Run-map status words at 1.10:1 contrast** — "LOCKED" was effectively invisible, and it is the only textual state indicator. | Status text split off the border colour; measured 5.21–10.95:1 across all states. |
| A3 | MAJOR | **Sticky rails slid under the sticky nav**, permanently hiding their headings after any scroll. | `top: 72px`, `max-height: calc(100vh - 96px)`. |
| A4 | MAJOR | **Viewport breakpoints inside a column that shrinks as the viewport grows** — the centre column is 324px at 1024px but 724px at 1440px, so `md:grid-cols-3` truncated player names on the primary decision surface at every desktop width. | Converted to container queries; name space went from ~95px to ~207px. |
| A5–A8 | MAJOR | Card lane fingerprint was visual-only; scouted boss values lived in a `title` on an `aria-hidden` node; blocked draft offers were unreachable by keyboard and could render with no reason at all; the Veteran Minimum checkbox was a ~13px target. | `sr-only` text alternatives added; `aria-disabled` + click guard keeps blocked offers focusable with a guaranteed reason; checkbox row is now 44px. |
| m1–m8 | MINOR | Hardcoded disabled-reason reused across two node types; non-disabled buttons at `opacity: 0.55` (2.61:1); silent loading state; sub-44px hub links; `rtt_run_started` firing on every reload. | All fixed. |

Findings accepted but **not** fixed, with reasons, are in §11.

---

## 11. Known limitations and deferred work

**Deliberately not fixed in this pass:**

1. **"Save image" on the result screen.** `lib/scorecard-export.ts` exists but is
   hard-coded to 82-0's data shape (its header string, `resultTier(wins)`,
   `{wins}-{losses}` hero, `lineup_peak_score`, PG–C slot types,
   `peak_picks_recap`, and its filename). A run receipt shares none of those
   fields. Generalising it means refactoring a shared file for another mode's
   benefit — a bigger change than this pass should make unreviewed. Text share,
   link copy, and challenge minting all work.
2. **Daily percentile / rank.** §6 permits omitting this "when the existing
   backend can support it honestly". There is no RTT leaderboard, so no honest
   rank exists yet. The UI says so rather than inventing one.
3. **Film Room's third choice** ("refresh one future offer branch") is not
   implemented; two of the three specified choices ship.
4. **Film Room does not preview the boss profile at the node** — it is revealed
   only after choosing "Scout ahead". §4 asks for the profile at the node.
5. **`/c/{token}` does not redirect RTT tokens.** Nothing has shipped, so no
   such links exist in the wild; the canonical path is correct at both ends.
6. **The result screen still renders the rails and tray**, which duplicate the
   receipt's own roster and lane profile. Fixing it needs the shell to switch to
   a single-column grid on a terminal status.
7. **`MIGRATION_INVENTORY.{md,json}` is stale** — it already missed the previous
   phase's Daily Grid migration before this pass. `validate_migrations.py` does
   not read it and passes. Regenerating it would fold in another phase's missed
   entry, so it was left alone. Run `scripts/migration_inventory.py` when
   convenient.
8. **The Postgres persistence path is unexercised.** All API tests run on the
   in-memory fallback because `DATABASE_URL` is not set locally; the Supabase
   integration suite skips with its documented reason. The migration validates
   and the repository conforms to the protocol, but no test writes a real row.
9. **The tie-break ladder has near-zero production exposure** — 119,999 of
   120,000 battles were decided on lanes, 1 on summed margin. All four rungs are
   unit-tested against synthetic pools.
10. **The audit cannot detect a dominant *System***, only a dominant policy. It
    reports System offer/selection frequency (uniform by construction), not
    win-rate conditioned on the System held.

**Deferred with clean extension points:** 1Y/5Y variants (the engine is
parameterised on `DURATION_YEARS`), ranked ghost opponents, live multiplayer,
seasonal progression, a larger boss catalog (`CURATED_BOSSES` is a list),
creator campaigns, endless mode, cosmetics.

---

## 12. Manual review checklist for tomorrow morning

**Play it first** — `make build-game-data` is not needed (artifacts are present):

```bash
cd apps/api && PEAK3_RUN_THE_TABLE_ENABLED=true uvicorn app.main:app --reload --port 8000
cd apps/web && npm run dev
open http://localhost:3000/arena/run-the-table
```

1. **Does the first decision make sense without a tutorial?** Read the start
   gate cold. Then press "Start a run" and see whether the System choice is
   legible before you understand the game.
2. **Is the difficulty right?** Best play beats all three bosses 12% of the
   time. Play three runs. If Act 1 feels like a formality (90% win rate), the
   lever is `BOSS_TARGET_STARTER_MEAN` in `config.py` — but note the curve is
   steep: +2 on Boss 1's target moved its win rate 96% → 53% in testing.
3. **Check the economy asymmetry.** Draft Room replacement refunds nothing;
   Trade Desk refunds 50%. Confirm that reads as intentional in play, not as a
   bug.
4. **Read a System summary against its predicate** (`config.py`
   `SYSTEM_PUBLISHED_THRESHOLDS` ↔ `pricing.py`). This is the honesty contract
   that broke once already.
5. **Confirm the boss framing.** They are named for statistical identity, not
   real teams. If you would rather they *were* historical rosters, that requires
   the experimental 884-card pool — a canonical/experimental decision, not a
   copy change.
6. **Challenge yourself.** Finish a run → "Challenge a friend" → open the copied
   link in a private window → confirm the seed matches and the roster is
   identical.
7. **Review the Arena/home restructure** (`git diff apps/web/src/app/(main)/`).
   Every mode is still reachable; confirm the hierarchy is what you want and
   that no copy overstates anything.
8. **Skim `lib/modes.ts`** — it is now the single source for mode copy. Nine
   duplicated descriptions collapsed into it.
9. **Decide on the two deferred result-screen items** (§11.1, §11.2).
10. **Nothing is committed.** `git diff` and `git status` are yours to review
    before any commit.

---

## 13. Final `git status --short` and `git diff --stat`

```
M apps/api/app/core/config.py
 M apps/api/app/core/dependencies.py
 M apps/api/app/core/repository_registry.py
 M apps/api/app/main.py
 M apps/web/package.json
 M apps/web/src/app/(main)/arena/page.tsx
 M apps/web/src/app/(main)/arena/ranked/page.tsx
 M apps/web/src/app/(main)/page.tsx
 M apps/web/src/app/(main)/signin/page.tsx
 M apps/web/src/components/daily/DailyHub.tsx
 M apps/web/src/components/layout/nav.tsx
 M apps/web/src/styles/globals.css
 M apps/web/src/tests/e2e/accessibility.spec.ts
 M apps/web/src/tests/e2e/daily-grid.spec.ts
 M apps/web/src/tests/e2e/gameplay.spec.ts
 M apps/web/src/tests/e2e/play-routing.spec.ts
 M apps/web/src/tests/e2e/progression.spec.ts
?? PEAK3_Run_The_Table_Claude_Code_Pass.md
?? apps/api/app/api/v1/run_the_table.py
?? apps/api/app/models/run_the_table.py
?? apps/api/app/repositories/run_the_table_memory.py
?? apps/api/app/repositories/run_the_table_postgres.py
?? apps/api/app/repositories/run_the_table_protocols.py
?? apps/api/app/services/run_the_table/
?? apps/api/tests/test_run_the_table.py
?? apps/web/playwright.rtt-screenshots.config.ts
?? apps/web/src/app/(main)/arena/run-the-table/
?? apps/web/src/components/run-the-table/
?? apps/web/src/lib/modes.ts
?? apps/web/src/lib/run-the-table-api.ts
?? apps/web/src/lib/run-the-table-state.ts
?? apps/web/src/tests/e2e/run-the-table.spec.ts
?? apps/web/src/tests/tools/capture-run-the-table-shots.ts
?? apps/web/src/tests/unit/run-the-table-components.test.tsx
?? apps/web/src/tests/unit/run-the-table-state.test.ts
?? apps/web/src/types/run-the-table.ts
?? docs/implementation/RUN_THE_TABLE_IMPLEMENTATION_PLAN.md
?? docs/implementation/RUN_THE_TABLE_PASS_REPORT.md
?? docs/implementation/run-the-table-review/
?? nba_peak/run_the_table/
?? scripts/audit_run_the_table.py
?? supabase/migrations/20260731090000_run_the_table.sql
?? tests/run_the_table/
```

```
 apps/api/app/core/config.py                   |  50 ++++
 apps/api/app/core/dependencies.py             |  28 +++
 apps/api/app/core/repository_registry.py      |   1 +
 apps/api/app/main.py                          |   2 +
 apps/web/package.json                         |   2 +-
 apps/web/src/app/(main)/arena/page.tsx        | 320 ++++++++++++++++----------
 apps/web/src/app/(main)/arena/ranked/page.tsx |  77 ++++---
 apps/web/src/app/(main)/page.tsx              | 153 ++++++------
 apps/web/src/app/(main)/signin/page.tsx       |  15 +-
 apps/web/src/components/daily/DailyHub.tsx    |  75 ++++--
 apps/web/src/components/layout/nav.tsx        |  40 ++--
 apps/web/src/styles/globals.css               | 255 ++++++++++++++++++++
 apps/web/src/tests/e2e/accessibility.spec.ts  |  22 ++
 apps/web/src/tests/e2e/daily-grid.spec.ts     |  31 ++-
 apps/web/src/tests/e2e/gameplay.spec.ts       |  42 +++-
 apps/web/src/tests/e2e/play-routing.spec.ts   | 212 +++++++++++++----
 apps/web/src/tests/e2e/progression.spec.ts    |  10 +-
 17 files changed, 982 insertions(+), 353 deletions(-)
```

---

## 14. Commit / push confirmation

**No commit, push, PR, merge, branch creation, or remote modification was made
at any point in this pass.** `HEAD` is still `c806317`, the same commit the pass
started on. Every change is in the working tree, unstaged, for manual review.

```
$ git rev-parse HEAD
c80631757986976c7e22a057e04cdbf022269cff
$ git log --oneline -1
c806317 feat(peak3): add PEAK3 v2 with replacement-level postseason calibration
```
