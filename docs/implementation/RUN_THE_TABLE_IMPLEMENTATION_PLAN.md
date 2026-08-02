# RUN THE TABLE — Implementation Plan

**Status:** implemented in this pass · **Branch:** `main` · **HEAD at start:** `c806317`

---

## 0. Repository state at the start of this pass

```
$ git status --short
?? PEAK3_Run_The_Table_Claude_Code_Pass.md
$ git diff --stat
(empty)
```

The working tree was **clean** apart from the untracked brief. There was no
pre-existing uncommitted work to preserve, but the same rule was applied
throughout: nothing was reset, stashed, or overwritten, no generated dataset or
migration was deleted, and **no commit or push was made**.

**Baseline test counts, measured (not copied from docs):**

| Suite | Result | Time |
|---|---|---|
| `pytest tests/` | 618 passed, 1 xfailed | 7m20s |
| `cd apps/api && pytest tests/` | 807 passed, 18 skipped | 85s |
| `cd apps/web && npm run test` | 21 files / 454 passed | 7.6s |
| `npx tsc --noEmit` | clean | — |
| `npm run lint` | clean | — |

The Makefile's echo text ("186 canonical model tests", "92 required") and the CI
job names are **stale**; the numbers above are current.

---

## 1. Product decision

RUN THE TABLE is a 10–15 minute front-office roguelike. The player promise:

> Build and evolve a roster of exact NBA 3-year peaks across a branching run,
> manage scarce credits, and defeat increasingly brutal statistical lineups.

This is a documented **deviation from the blueprint**, which still names Peak
Draft as flagship (`docs/product/PEAK3_BLUEPRINT_INDEX.md`) — superseded first by
CourtBuilder and now by RUN THE TABLE. The blueprint's *product principles*
(deterministic seeds, controlled difficulty, role feasibility, "Peak Receipt"
vocabulary, selective high-energy accents) are honored; its stale flagship claim
is not.

---

## 2. Architecture and reuse map

The repo already has two precedents for a game domain, and RUN THE TABLE copies
their shape rather than inventing a third:

```
nba_peak/lineup/          → apps/api/app/services/draft/           (Peak Draft)
nba_peak/perfect_season/  → apps/api/app/services/perfect_season/  (82-0)
nba_peak/run_the_table/   → apps/api/app/services/run_the_table/   (NEW)
```

**Pure engine** (`nba_peak/run_the_table/`, stdlib only, no FastAPI/Pydantic):

| Module | Responsibility |
|---|---|
| `config.py` | every constant, System, boss rule, version string |
| `schemas.py` | frozen/plain dataclasses |
| `cards.py` | card pool join + normalisation + base pricing |
| `pricing.py` | System price modifiers, refunds, trade math |
| `bosses.py` | curated bosses + deterministic themed fallback |
| `battle.py` | lane aggregation and resolution |
| `generation.py` | seed → `RunBlueprint` |
| `state.py` | `RunState` + action functions + `replay` |
| `receipt.py` | final result computation |
| `daily.py` | UTC daily seed derivation |

**Reused, not cloned:**

- Card pool: `data/game/profiles/card_profiles.v3.json` (the same artifact Peak
  Draft uses) joined to `data/web/peak_windows.json`. Verified consistent:
  984/984 ids match, 0 score mismatches.
- Role model: the repo's five roles (`lead_creator`, `guard_wing`,
  `wing_forward`, `forward_big`, `anchor`) from `nba_peak/lineup/board.py`.
- Seeding: `random.Random` + namespaced SHA-256, matching
  `nba_peak/perfect_season/daily.py`. Sub-streams keyed by descriptive string.
- Auth/anon: `app.core.auth.resolve_owner_sub` (mints the `peak3_anon` cookie).
- Challenge tokens: `app.core.security.create_session_token`, `/c/{token}` route.
- Repository split: `_protocols` / `_memory` / `_postgres` + `REPOSITORY_DOMAINS`.
- UI: `PlayerAvatar`, `getTeamColors`, `GameCard`, `.share-card-shell`,
  `.score-number`, `component-comparison.tsx` as the lane-bar precedent.

**Deliberately NOT reused:** no new Tailwind config (the repo has none — all
tokens are CSS custom properties), no seeded RNG in TypeScript (all determinism
is server-side), no second canvas exporter.

---

## 3. Card pool and the canonical/experimental boundary

**Pinned to canonical.** The pool is the 3-year windows of
`card_profiles.v3.json` whose `profile_status != "excluded"`, joined to
`peak_windows.json`. That is **174 cards** (248 3Y windows minus 74 with no
eligible role — the same exclusion Peak Draft applies).

The experimental 884-row `top_1000_peaks.v2.json` board was **not** used. It
would have added cards and precomputed percentiles, but it is a different model
version (`peak3_v2`) and disagrees with the canonical board on the *identity* of
the best 3-year window for 17 of 246 shared players. Consuming it would silently
promote experimental data to production, which the brief forbids. The pool
loader is parameterised on paths, so an explicit adapter can be added later.

Role coverage in the eligible pool: `guard_wing` 155, `wing_forward` 133,
`forward_big` 120, `lead_creator` 62, **`anchor` 28**. Anchor scarcity is a real
and intentional constraint on both the player and every boss.

---

## 4. Deterministic formulas

**Lane normalisation.** Canonical components are *pre-weighted contributions*,
so they live on incommensurable scales (`team_achievement` spans 0–3,
`statistical_impact` spans ~13–37). Each lane is rescaled linearly to 0–100
across the eligible pool:

```
lane_index[l] = 100 × (value[l] − pool_min[l]) / (pool_max[l] − pool_min[l])
```

Linear and monotonic, so it never changes which roster is better in a lane. The
constants are published via `GET /run-the-table/meta`.

**Price.**

```
base_cost = clamp(4 + round(26 × percentile²), 1, 30)
```

`percentile` is the card's rank percentile of `prime_score` in the eligible
pool. Monotonic non-decreasing by construction. On the real board this yields
costs 4–30, with 87 cards ≤10 and 20 cards ≥25.

**Roster lane score.**

```
lane_score = Σ(w_i × lane_index_i) / Σ(w_i)
w = 1.00 starters, 0.35 bench (0.65 with Deep Rotation or Strength in Numbers,
                               0.15 under Top Heavy)
```

**Battle.** First to 3 of 5 lanes. Lane values are rounded to 4dp then compared
with `ε = 1e-6`. If ties prevent either side reaching 3: summed lane margin →
overall weighted roster total → exact draw. A loss costs one life and, if lives
remain, awards 8 comeback credits.

**Run MVP.** Drop-one marginal contribution to the roster's weighted total — a
real counterfactual on published values, not a heuristic.

---

## 5. State machine

```
                ┌──────────────────┐
  create_run ──▶│  system_select   │ (act 1; and again after Boss 1)
                └────────┬─────────┘ select_system
                         ▼
                ┌──────────────────┐
       ┌───────▶│   node_select    │ 2 branching options per stage
       │        └────────┬─────────┘ choose_node
       │                 ▼
       │        ┌──────────────────┐  draft_buy / draft_pass
       │        │   node_active    │  trade / decline_trade
       │        └────────┬─────────┘  film_room / rest_bank
       │                 │
       │   stage 1 ──────┘ (stage → 2)
       │                 │
       │   stage 2 ──────▼
       │        ┌──────────────────┐
       │        │   boss_ready     │ resolve_boss
       │        └────────┬─────────┘
       │                 ▼
       │        ┌──────────────────┐
       │        │  boss_resolved   │ advance
       │        └────────┬─────────┘
       │      lives = 0 ─┴─▶ failed
       └── act < 3 ◀─────────┤
                   act = 3 ──▶ complete
```

6 decision nodes + 3 battles. Every action is
`(state, blueprint, args) → state` and appends to `action_log`, so
`replay(blueprint, action_log)` rebuilds any state exactly. That single
mechanism serves save/resume, challenge replay, and the determinism audit.

---

## 6. API contract

Prefix `/api/v1`, paths under `/run-the-table`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/readiness` | flag state; never 403 so the client can fail closed |
| GET | `/meta` | full ruleset: lanes, Systems, boss rules, economy, pool stats |
| GET | `/daily` | today's descriptor `{date, run_id, seed, ruleset_version}` |
| POST | `/runs` | create (`standard` \| `daily` \| `challenge`) |
| GET | `/runs/{run_id}` | resume |
| POST | `/runs/{run_id}/actions` | apply one action (idempotent by key) |
| POST | `/runs/{run_id}/challenge` | mint a `/c/{token}` link |
| GET | `/challenges/{token}` | spoiler-safe `{seed, run_type, date, versions}` |

`apps/api/app/services/run_the_table/public.py` is the single source of truth
for the client payload. It enforces two rules: **no future content** (offers for
unreached stages are omitted unless a Film Room scout unlocked them) and **no
hidden numbers** (every displayed price/lane/discount is present with the value
the engine used).

*Deviation from ADR-005 Decision 6:* Peak Draft withholds scores until reveal
because guessing which card is better **is** the game. Here the brief explicitly
requires a Draft Room to show "cost, role eligibility, overall PEAK3 score, and
compact component fingerprint" — withholding would make the core decision
unplayable. Documented, not accidental.

Persistence stores only `(run_id, owner_sub, seed, run_type, date, status,
snapshot, versions)`. The blueprint is always regenerated from the seed;
`assert_version_compatible` rejects a snapshot whose versions have moved.

---

## 7. Systems and bosses

Six Systems, at most two held, offered at start and after Boss 1. All thresholds
are centralised in `config.py` and rendered into the player-facing `summary`
string from the same constants, so displayed rules cannot drift from applied
rules.

`two_way_value` carries an upper percentile bound (0.78). Without it, an
all-time great qualifies as "balanced" because every lane is near the ceiling —
turning the System into a 30% GOAT coupon. This was caught in playtesting, not
theory.

Three curated bosses, every window id verified present, role-legal for its
ordered slot, and duplicate-free:

| Act | Boss | Rule | Starter mean |
|---|---|---|---|
| 1 | The Wall | Traditional Production wins exact lane ties | 60.70 |
| 2 | Strength in Numbers | bench weight 0.65 both sides | 64.69 |
| 3 | The Ceiling | bench weight 0.15 both sides | 70.14 |

**Named for their statistical identity, not for real teams.** Each card is that
player's own career-best 3-year window, frequently from a different franchise
and era — labelling a lineup "2004 Detroit" while serving Chauncey Billups'
2005-08 Denver window would be a claim the data does not support. Rip Hamilton,
Tayshaun Prince, Danny Green and Andre Iguodala have no canonical 3Y window in
this pool at all, which independently rules out the historical framing.

`resolve_bosses()` falls back to `generate_themed_boss()` if a curated id ever
leaves the pool; both paths are tested.

---

## 8. Balance

Measured over 300 seeds per policy, after the economy fixes:

| Policy | Boss 1 | Boss 2 | Boss 3 | Ran the table | Run failed |
|---|---|---|---|---|---|
| greedy | 95.0% | 44.3% | 21.3% | **15.0%** | 2.3% |
| random | 78.7% | 30.0% | 19.0% | 8.7% | 6.7% |
| first-option | 83.0% | 29.0% | 14.3% | 7.7% | 5.3% |
| never buy | 57.0% | 2.0% | 0.0% | **0.0%** | 18.7% |

"Never buy" completing 0% of the time is the load-bearing result: upgrades
decide runs. Best play completing 15% is the "one more run" target. GOAT cards
(≥88 prime score) appear on 0.28 starting fives per run — scarcity holds.

Two economy bugs were found and fixed by measurement:
1. Two-Way Value discounted GOATs (above).
2. The Draft Room refunded the displaced card, which inflated the economy to a
   median 71 credits spent against a 40-credit budget. **Draft Room replacement
   now refunds nothing**; the Trade Desk is the only place a departing card
   returns credits. That difference is what makes the two node types a real
   choice rather than "Trade Desk with more options".

---

## 9. File ownership during implementation

| Workstream | Owns |
|---|---|
| main thread | `nba_peak/run_the_table/*`, `services/run_the_table/{public,serialization}.py`, Arena/home cleanup, e2e specs, docs |
| engine-test-implementer | `tests/run_the_table/*`, `scripts/audit_run_the_table.py` |
| engine-api-implementer | `models/run_the_table.py`, `repositories/run_the_table_*`, `api/v1/run_the_table.py`, `services/run_the_table/runs.py`, the migration, `apps/api/tests/test_run_the_table.py`, surgical edits to `main.py`/`config.py`/`dependencies.py`/`repository_registry.py`/`package.json` |
| web-game-implementer | `types/run-the-table.ts`, `lib/run-the-table-{api,state}.ts`, `components/run-the-table/*`, the route, its unit tests, append-only `globals.css` |

No two workstreams write the same file.

---

## 10. UI route and component map

Route: `apps/web/src/app/(main)/arena/run-the-table/page.tsx` (inside `(main)`
so it inherits the nav shell), matching the existing `/arena/...` convention.

Desktop ≥1024px is a three-zone grid (`260px | 1fr | 360px`) — run map, decision
surface, persistent roster/resources — extending the proven `.arena-shell`
pattern. Mobile is one decision at a time with the product's first sticky bottom
tray and a 44×44px minimum touch target.

---

## 11. Test matrix

**Engine** (`tests/run_the_table/`): seed determinism, roster legality over
hundreds of seeds, draft affordability, price monotonicity, all six Systems,
Veteran Minimum per-act reset, trade math, non-negative credits, lane
aggregation, the full tie-break ladder, boss rule symmetry, lives/comeback,
receipt determinism, action replay, idempotency, daily seed stability, challenge
replay, version-mismatch rejection, curated + fallback bosses.

**API** (`apps/api/tests/test_run_the_table.py`): readiness/meta shape,
anonymous creation, full happy-path run to a receipt, 404/409 error codes,
idempotency no-op, daily stability and re-entry, challenge round-trip and
spoiler-safety.

**Web unit**: map branching, roster replacement/cancel, credits/lives/System
display, affordable/disabled offers, keyboard selection, battle skip and reduced
motion, reload/resume, completion and early-loss screens, unavailable fallback.

**Playwright**: full anonymous desktop run, full mobile run, loss → life → 
continue, reload mid-run, daily stability, challenge reproduction, share
fallback, CourtBuilder + Peak Grid smoke, axe on start/decision/battle/result.

**Simulation**: `scripts/audit_run_the_table.py --seeds 10000` — fails nonzero on
any illegal roster, duplicate identity, dead-end run, or replay mismatch.

---

## 12. Acceptance criteria

1. First-time user understands the first decision without a tutorial wall.
2. Complete anonymous run start → result on desktop and mobile.
3. Branching decisions, persistent resources, roster evolution, escalating
   bosses, recoverable losses.
4. Every card, price, battle score and result deterministic and traceable to a
   canonical exact 3Y peak.
5. Nothing implies an LLM or subjective model judged the result.
6. No run dead-ends on illegal or unaffordable offers.
7. Daily and challenge seeds reproduce the same run.
8. Reload/resume does not corrupt state.
9. Result screen tells a run story; replay/challenge are obvious.
10. RUN THE TABLE is the clear flagship; finalized modes still work.
11. Premium, responsive, keyboard operable, reduced-motion aware, axe-clean.
12. Existing model rankings unchanged.
13. Existing suites green apart from documented external integrations.
14. 10,000-seed audit finds no determinism mismatch, illegal roster, duplicate
    identity, or dead-end.
15. No commit or push.

---

## 13. Out of scope

Rewriting the canonical model · training an ML model · subjective lineup
chemistry · LLM-generated ratings · auctions or synchronous rooms · open chat ·
pay-to-win · redesigning the Index or Lab.

**Deferred with clean extension points:** 1Y/5Y variants (the engine is
parameterised on `DURATION_YEARS`), ranked ghost opponents, live multiplayer,
seasonal progression, a larger boss catalog (`CURATED_BOSSES` is a list),
creator campaigns, endless mode, cosmetics.
