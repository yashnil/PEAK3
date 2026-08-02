# UX / Organization / Polish pass — integration plan

Lead-authored after Phase A discovery. Writers must not begin until they have read
their own section **and** §3 (shared contracts).

Baseline: `HEAD = efaeff4a5c00b12c8f8c3ed4bd03cf0221609f17` on `feature/run-the-table`.
Working tree at start: one modified file, `PEAK3_UX_ORGANIZATION_POLISH_CLAUDE_PASS.md`
(10 deleted lines — the brief's own "first command" appendix). Nothing else uncommitted.
`git diff --check` reports one pre-existing "new blank line at EOF" in that same file.

Baseline model suite before any edit: `788 passed, 1 xfailed in 406.05s`.

---

## 1. What discovery actually found

The six read-only agents changed several of the brief's premises. Recording them here
because the plan is built on the corrected facts, not the assumed ones.

### 1.1 The "redundant CTA funnel" is deliberate and test-pinned

`/` → `home-primary-cta` ("Start a Run") → `/arena/run-the-table` → `RunStartGate`
("Start a run"). The second gate exists because **merely following a link must never
create a run** — documented at `apps/web/src/app/(main)/arena/run-the-table/page.tsx:19-31`
and `RunStartGate.tsx:5-19`, and pinned by `play-routing.spec.ts:112-134`.

So the fix is *not* to delete the gate. It is to make the homepage control name the
choice it is about to make. See §5 (W2).

### 1.2 `[object Object]` root cause — found exactly

`apps/web/src/components/run-the-table/RunCard.tsx:164-168`:

```tsx
{card.cost_modifiers.length > 0 && (
  <p ...>{card.cost_modifiers.join(" · ")}
```

`cost_modifiers` is `list[dict]` on the server (`nba_peak/run_the_table/pricing.py:74-86`,
passed through untouched at `apps/api/app/services/run_the_table/public.py:64,81`, and
never coerced because `RunStateResponse.active_node` is a bare `Optional[dict]` at
`apps/api/app/models/run_the_table.py:162`). The client type at
`apps/web/src/types/run-the-table.ts:98` declares `cost_modifiers: string[]` — **the type
is a lie**, which is why `tsc` never flagged the `.join()`.

It fires for any card discounted by a System — `moneyball`, `no_hardware`,
`two_way_value` (3 of 6 selectable Systems) — on every `RunCard` instance: Trade Desk
incoming and outgoing, and Draft Room offers. Unit tests miss it because the fixture
hardcodes `cost_modifiers: []` (`run-the-table-components.test.tsx:97`).

### 1.3 Trade Desk "Steve Francis stays highlighted" — found exactly

`TradeDesk.tsx:32-33` holds two independent `useState`s. Neither handler clears the
other column (`:81`, `:138`), and `RunTheTableGame.tsx:459-477` renders `<TradeDesk>`
with no `key`, so nothing resets on node change. Worse, in the border/background ternary
(`:91-97`, `:144-150`) `selected` **outranks** `compatible`, so a card that has become
illegal is still painted accent-gold *and* carries a red "Not eligible" badge at the same
time. `aria-pressed` still reads `true`. Ineligible cards are deliberately not
`disabled` and carry no `aria-disabled`, so a screen reader announces them as ordinary
buttons.

The red `--incorrect-dim` border on *incompatible-but-unselected* cards is what the
screenshot reads as "Steve Francis is highlighted".

### 1.4 Rankings are NOT stale — proven, not assumed

Row-by-row comparison of `data/web/leaderboards.json` against all four canonical CSVs:

```
n=1: csv_rows=250 json_rows=250 mismatches=0
n=2: csv_rows=249 json_rows=249 mismatches=0
n=3: csv_rows=248 json_rows=248 mismatches=0
n=5: csv_rows=237 json_rows=237 mismatches=0
TOTAL MISMATCHES: 0
```

The alarming mtime skew (`leaderboards/` Jul 31 02:18, `data/web/` Jul 30 10:47) is a
checkout artifact: `git status --porcelain leaderboards/` is empty and the CSVs have not
changed content since `17e0db6`. `peak3.py` did gain `postseason_value_v2` in `c806317`,
but v2 is opt-in (`DEFAULT_FORMULA_VERSION = PEAK3_V1`), reads separate parquets and
writes separate artifacts.

**Therefore: no leaderboard row will be regenerated to a different value in this pass.**
What *is* wrong is provenance, and that is what W6 fixes:

1. `data/web/metadata.json` records `source_commit: d5e8acf…`, which is provably wrong —
   `methodology.json` is byte-equal to the *current* `METHODOLOGY` dict, which was
   rewritten after `d5e8acf`. `get_source_commit()` (`scripts/build_web_dataset.py:98-108`)
   does `git rev-parse HEAD` with no dirty check and no hash of its input CSVs.
2. Three spellings of the model version: `"peak3-v1"` hardcoded at
   `scripts/build_web_dataset.py:50`, `"peak3_v1"` in `nba_peak/formula_version.py:31-33`
   (the declared source of truth), `"peak3-2026"` in `apps/api/tests/conftest.py:73`.
3. `apps/api/tests/test_regression.py:16-21` **skips** when `data/web/leaderboards.json`
   is absent, and `data/web/` is gitignored — so on a clean checkout every parity
   assertion silently vanishes.
4. Terminology contradiction: the "1-Year" peak-window board and the "Single Seasons"
   board are the same grain at n=1 and return literally the same top rows
   (`1 Michael Jordan 1990-91 97.53`), yet are presented as two different questions
   (`rankings/page.tsx:26-27`, header at `:158`).

### 1.5 82-0 reroll — no distance policy, no idempotency

- Team and season are one **joint** draw of a `team_id`+`season_label` entry
  (`nba_peak/perfect_season/board.py:665-693`), from a 1,314-entry catalogue covering
  47 seasons (1979-80 … 2025-26) and 40 franchises.
- Reroll (`respin`) narrows to same-season-other-team / same-team-other-season, then
  **falls back to the full catalogue, which still contains the current entry**
  (`apps/api/app/services/perfect_season/state.py:583-588`, `613-618`).
- No repeat suppression anywhere. `respin_history` is written and never read.
- RNG is deterministic and server-side: `_respin_rng(state, kind, count)` at `state.py:516-525`.
- **`RespinRequest` has no idempotency key and the handler is an unguarded
  read-modify-write** (`apps/api/app/api/v1/perfect_season.py:277-320`) — a double-click
  can consume two rerolls. Client `busy` state is the only guard.
- Client RNG: none. `planReel` is pure and always lands on the server value. Confirmed clean.

### 1.6 Dependency reality

Runtime is **9 packages**. `motion@11.18.2` is installed and imported as `motion/react`
(never `framer-motion`); `LazyMotion` is not used anywhere. `lucide-react` is installed.
**Radix, driver.js, floating-ui, and every spin-wheel library are absent from
package.json, package-lock.json and node_modules.**

There is no `Button`, `Tooltip`, `Dialog`, `Drawer`, `Tabs`, `Skeleton`, `EmptyState`,
focus-trap utility or portal helper. `createPortal` appears zero times in the app. Three
divergent hand-rolled dialogs exist.

Tailwind is **v4 CSS-first with no `tailwind.config.*` and no `@theme` block** — the 37
`:root` custom properties generate no utilities, so every consumer uses
`bg-[var(--x)]` arbitrary values or inline `style`.

### 1.7 Test surface (real counts — every count in the Makefile, CI job names and LOCAL_DEV.md is stale)

| Suite | Command | Actual collected |
|---|---|---|
| Model | `make test-model` | **789** (`tests/`, ignoring `tests/lineup`) |
| Lineup | `make test-lineup` | **43** |
| API | `make test-api` | **868** (CI variant selects 850) |
| Vitest | `make test-web` | **562** across 23 files |
| Playwright | `make test-e2e` | **264** (246 chromium + 18 mobile-chrome) |
| Axe subset | `make test-accessibility` | **19** |

---

## 2. Dependency decision — add nothing

**Decision: zero new runtime dependencies.**

| Candidate | Verdict | Reason |
|---|---|---|
| Radix Navigation Menu / Dropdown | **No** | Would be the 10th runtime package and pull `@radix-ui/react-*` transitive tree (~14 packages) for one menu. The nav needs a button trigger, `aria-expanded`, roving arrow keys, Escape and outside-click — ~120 lines, and `nav.tsx` already implements Escape + outside-click + focus restore today. |
| driver.js | **No** | 5 kB, but it owns its own DOM overlay outside React, which fights the portal/focus model we need for the tour and cannot be lazily code-split as cleanly as a dynamic `import()` of our own component. We build `GuidedTour` on `createPortal` + Motion. |
| floating-ui | **No** | The only positioned surfaces are the Play menu (anchored to a fixed-height sticky header) and tooltips (small, edge-clamped). CSS anchoring + a 30-line clamp covers both. |
| `spin-wheel` (crazytim) | **No** | Canvas wheel; our reveal is a dual team+season strip reel with 101 unit tests pinning `planReel`. Adding it would mean maintaining two spinners. |
| `motion` | **Already installed** — adopt `LazyMotion` + `m.*` to shrink the animated routes | |

Bundle policy: the pass must not increase `apps/web` runtime dependency count. Any new
motion surface uses `LazyMotion`/`domAnimation` where practical; the tour is loaded via
`next/dynamic` with `ssr:false` so it costs nothing until invoked.

---

## 3. Shared contracts — agreed BEFORE any writer starts

These are hard constraints. A writer that breaks one has broken another writer's tests.

### 3.1 Token contract — additive only

**No existing CSS custom property may be renamed, removed, or have its value changed.**
The following are asserted verbatim in tests and are frozen:

`--peak-accent`, `--peak-accent-bg`, `--bg-page`, `--bg-elevated`, `--bg-surface`,
`--border-subtle`, `--border-default`, `--text-primary`, `--text-secondary`,
`--text-muted`, `--correct`, `--incorrect`, `--incorrect-dim`, `--incorrect-bg`,
`--comp-si`, `--comp-tp`, `--comp-rec`, `--comp-po`, `--comp-team`, `--comp-tm`,
`--focus-ring`, all `--role-*`.

(`run-the-table-components.test.tsx:628-650` asserts exact `var(--*)` strings and inline-style
equality; `component-labels.test.ts:59-60` asserts `--comp-po` / `--comp-team`;
`play-routing.spec.ts:186` asserts the literal class `bg-[var(--bg-surface)]`.)

New tokens are added by **W7 only**, in `globals.css`, all prefixed `--pk-` (spacing,
radius, elevation, motion duration/easing, surface tiers). Nobody else touches `globals.css`.

### 3.2 Class-name contract — frozen

`.rtt-decision-surface`, `.rtt-offer-btn`, `.rtt-tap`, `.rtt-checkbox-row`,
`.spin-reel`, `.spin-reel-strip`, `.spin-reel-track`, `.spin-reel-row`,
`.spin-reel-payline`, `.spin-ceremony-spinning`, `.card-elevated`, `.card-surface`,
`.score-number`, `.font-display`, `.skip-link`, and the container-query breakpoints
`@[520px]:grid-cols-2` (TradeDesk) and `@[560px]:grid-cols-2` (DraftRoom) are load-bearing
in tests. Keep them.

### 3.3 CSS file ownership

`globals.css` is edited by **W7 only**. W7 adds, immediately after line 1's
`@import "tailwindcss";`, a block of partial imports:

```css
@import "./nav.css";
@import "./home.css";
@import "./tour.css";
@import "./rtt-polish.css";
@import "./spinner.css";
@import "./rankings.css";
```

W7 creates all six partial files as empty stubs with a header comment and **verifies the
production build still passes** before any other writer starts. After that, each partial
has exactly one owner (W1 → `nav.css`, W2 → `home.css`, W3 → `tour.css`,
W4 → `rtt-polish.css`, W5 → `spinner.css`, W6 → `rankings.css`).

### 3.4 Frozen product invariants

- `data-testid` vocabulary is **additive only**: `home-primary-cta`, `home-flagship-card`,
  `home-peak-season-card`, `home-daily-grid-card`, `home-daily-duel-card`,
  `home-leaderboard-card`, `home-daily-hub-link`, `arena-flagship-card`,
  `arena-rtt-daily-link`, `arena-rtt-runs-link`, `arena-daily-grid-card`,
  `arena-daily-duel-card`, `arena-daily-hub-link`, `arena-leaderboard-link`,
  `courtbuilder-hero`, `daily-peak-season-cta`, `court-history-link`, `legacy-labs-link`,
  `begin-run-btn`, `peak-season-start-gate`, every `rtt-*`, every `spin-*`,
  `pool-tab-*`, `peak-window-tab-*`, `rankings-header-*`, `rankings-model-version`,
  `rankings-provenance` — all must still exist and still identify the same thing.
- Exactly **one `<h1>`** on the homepage, and it must still contain
  `"Build a roster of peaks."` and `"Run the table."` (frozen — this removes the only
  W1/W2 test collision; the hero is made smaller, not reworded).
- Exactly one `[data-featured="true"]` per page.
- Nav landmark `aria-label` stays `"Main navigation"`.
- Retired-vocabulary bans hold: no `1Y Apex` / `3Y Prime` / `5Y Foundation` on `/`,
  `/arena`, `/arena/run-the-table` or the 82-0 gates; no `"prototype"` anywhere on
  `/arena`; no `"Chase 82-0"` on `/`; no `"(in progress)"` on rankings.
  Counter-invariant: those three legacy labels must **remain** visible on `/arena/labs`
  and `/arena/daily`.
- `MODE_COPY` in `lib/modes.ts` stays the only source of game names, descriptions,
  hrefs and CTAs. New fields are additive.
- Canonical model field names (`postseason_individual_value`, `team_achievement`, …) are
  never renamed in APIs, payloads or methodology. Only the user-facing label layer changes.

### 3.5 Server authority

No writer may move a scoring, pricing, legality, eligibility or randomness decision to
the client. Animation represents an already-chosen authoritative result. `planReel` stays
a pure function of `(pool, target, travelRows)`.

### 3.6 Existing-spec ownership (one owner each, to prevent merge collisions)

| Spec / test file | Owner |
|---|---|
| `e2e/play-routing.spec.ts` | W1 |
| `e2e/gameplay.spec.ts` | W2 |
| `e2e/run-the-table.spec.ts`, `unit/run-the-table-components.test.tsx`, `unit/run-the-table-state.test.ts` | W4 |
| `e2e/courtbuilder.spec.ts`, `unit/spin-reel.test.ts`, `unit/court-state.test.ts` | W5 |
| `e2e/rankings.spec.ts`, `apps/api/tests/test_regression.py` | W6 |
| `e2e/accessibility.spec.ts` | W7 |
| `e2e/daily-grid.spec.ts`, `e2e/progression.spec.ts`, `e2e/daily-challenge.spec.ts`, `e2e/ranked.spec.ts` | **Lead** (nav-assertion reconciliation only) |

Everyone else adds **new** test files under `apps/web/src/tests/unit/` with a name
prefixed by their workstream.

---

## 4. Agent topology and file ownership

W7 runs **first and alone**. W1–W6 then run in parallel against strictly disjoint file
sets. W8 is read-only and runs after integration.

### W7 — shared visual/motion/a11y primitives (BLOCKING, runs first)

Owns (all new except `globals.css`):
- `apps/web/src/components/ui/Portal.tsx`
- `apps/web/src/components/ui/Dialog.tsx`
- `apps/web/src/components/ui/Tooltip.tsx` (hover **and** focus **and** tap; never hover-only)
- `apps/web/src/components/ui/StatusChip.tsx`
- `apps/web/src/components/ui/SectionHeader.tsx`
- `apps/web/src/components/ui/ScorePill.tsx`
- `apps/web/src/components/ui/AnimatedNumber.tsx` (settles instantly to the authoritative value)
- `apps/web/src/components/ui/Skeleton.tsx`
- `apps/web/src/components/ui/EmptyState.tsx`
- `apps/web/src/components/ui/LiveRegion.tsx`
- `apps/web/src/components/ui/index.ts`
- `apps/web/src/lib/a11y.ts` — `useFocusTrap`, `useRestoreFocus`, `usePrefersReducedMotion`, `FOCUSABLE_SELECTOR`
- `apps/web/src/lib/motion.ts` — `LazyMotion` provider + shared durations/easings
- `apps/web/src/styles/globals.css` — additive `--pk-*` tokens + the six `@import`s
- `apps/web/src/styles/{nav,home,tour,rtt-polish,spinner,rankings}.css` — empty stubs
- `apps/web/src/tests/unit/ui-primitives.test.tsx`
- `apps/web/src/tests/e2e/accessibility.spec.ts` (extend after W1-W6 land)

### W1 — global navigation, mobile drawer, route metadata, launcher

Owns:
- `apps/web/src/components/layout/nav.tsx`
- `apps/web/src/components/layout/PlayMenu.tsx` (new)
- `apps/web/src/components/layout/MobileNavDrawer.tsx` (new)
- `apps/web/src/lib/nav-model.ts` (new)
- `apps/web/src/lib/modes.ts` (extend: `group`, `badge`, `blurb`, `icon` key — additive)
- `apps/web/src/lib/resume-state.ts` (new — the unified "anything in flight?" reader)
- `apps/web/src/styles/nav.css`
- `apps/web/src/tests/unit/nav-model.test.ts`, `nav-components.test.tsx` (new)
- `apps/web/src/tests/e2e/play-routing.spec.ts`

### W2 — homepage, `/arena` catalog, game launcher

Owns:
- `apps/web/src/app/(main)/page.tsx`
- `apps/web/src/app/(main)/arena/page.tsx`
- `apps/web/src/components/shared/GameCard.tsx`
- `apps/web/src/components/home/*` (new: `HeroLauncher.tsx`, `ModelProofStrip.tsx`, `HeroVignette.tsx`)
- `apps/web/src/styles/home.css`
- `apps/web/src/tests/unit/home-launcher.test.tsx` (new)
- `apps/web/src/tests/e2e/gameplay.spec.ts`

### W3 — RUN THE TABLE guided tour, terminology, node education

Owns:
- `apps/web/src/components/ui/GuidedTour.tsx` + `tour-steps.ts` (new; W7 hands over
  `Portal`/`useFocusTrap` and does not touch these)
- `apps/web/src/lib/tour-state.ts` (new — versioned localStorage)
- `apps/web/src/components/run-the-table/RunStartGate.tsx`
- `apps/web/src/components/run-the-table/SystemSelect.tsx`
- `apps/web/src/components/run-the-table/NodeChoice.tsx`
- `apps/web/src/components/run-the-table/ChoiceNode.tsx`
- `apps/web/src/lib/run-the-table-copy.ts` (new — the whole plain-language label layer)
- `apps/web/src/styles/tour.css`
- `apps/web/src/tests/unit/tour-state.test.ts`, `guided-tour.test.tsx` (new)

### W4 — RUN THE TABLE cards, Trade Desk, nodes, battle, completion

Owns:
- `apps/web/src/components/run-the-table/{RunCard,TradeDesk,DraftRoom,BattleReveal,BossPreview,RunResult,RunMap,RunTray,MobileTray,LaneProfile,RunProgressStrip,RunSkeleton,RunTheTableGame}.tsx`
- `apps/web/src/types/run-the-table.ts`
- `apps/web/src/lib/run-the-table-state.ts`
- `apps/web/src/styles/rtt-polish.css`
- `apps/api/app/services/run_the_table/public.py` (only if a payload field must be
  *added*; never renamed)
- `apps/web/src/tests/unit/run-the-table-{components,state}.test.tsx?`
- `apps/web/src/tests/e2e/run-the-table.spec.ts`
- `apps/web/src/tests/unit/trade-desk.test.tsx` (new)

### W5 — 82-0 reroll policy, idempotency, spinner reveal

Owns:
- `nba_peak/perfect_season/{state helpers via}` → `apps/api/app/services/perfect_season/state.py`
- `nba_peak/perfect_season/config.py` (new policy constants + version bump)
- `nba_peak/perfect_season/board.py` (pool accessors only)
- `apps/api/app/models/perfect_season.py`
- `apps/api/app/api/v1/perfect_season.py`
- `apps/api/app/services/perfect_season/serialization.py`
- `apps/web/src/components/court/{SpinStage,CourtBuilder}.tsx`
- `apps/web/src/lib/perfect-season-api.ts`, `apps/web/src/types/perfect-season.ts`
- `apps/web/src/styles/spinner.css`
- `apps/api/tests/test_perfect_season.py`
- `apps/web/src/tests/unit/spin-reel.test.ts`, `court-state.test.ts`
- `apps/web/src/tests/e2e/courtbuilder.spec.ts`
- `scripts/audit_spinner_reroll_policy.py` (new) → `docs/implementation/spinner-audit.json`

### W6 — rankings provenance, terminology, parity tests

Owns:
- `scripts/build_web_dataset.py`
- `apps/api/tests/test_regression.py`
- `apps/api/app/api/v1/{peaks,seasons,meta}.py` (provenance surfacing only)
- `apps/web/src/app/(main)/rankings/page.tsx`
- `apps/web/src/components/rankings/*`
- `apps/web/src/styles/rankings.css`
- `apps/web/src/tests/e2e/rankings.spec.ts`
- `docs/implementation/RANKINGS_SYNC_REPORT.md`

### W8 — adversarial review (read-only, post-integration)

R1 product comprehension · R2 basketball/statistical integrity · R3 accessibility ·
R4 code/state integrity · R5 visual polish. Output to
`docs/implementation/ux-polish-review/`.

---

## 5. Product decisions the lead has already made

Writers implement these; they are not open questions.

### 5.1 Homepage CTA (W2 + W4)

`home-primary-cta` becomes a **button** (`aria-expanded`, `aria-haspopup="menu"`) labelled
**"Play Run the Table"** that opens an in-place launcher listing:

1. **Standard run** → `/arena/run-the-table?start=standard`
2. **Today's shared run** → `/arena/run-the-table?mode=daily&start=daily`
3. **Resume your run** → `/arena/run-the-table` (rendered only when `loadActiveRun()` returns non-null)

`RunTheTableGame` (W4) consumes `?start=` exactly once, starts that mode, and strips the
param with `router.replace`. A bare `/arena/run-the-table` still shows `RunStartGate`, so
`play-routing.spec.ts:112-134` ("route creates no run") continues to pass unchanged.

This is the honest reading of the brief: the label now names the choice, the second
identical "Start a run" confirmation disappears from the main path, and the
never-burn-a-run-on-navigation invariant survives.

W2 updates `gameplay.spec.ts:73-74` and W1 updates `play-routing.spec.ts:231` accordingly —
these are the "legitimately changes with a UX pass" assertions.

### 5.2 Terminology layer (W3), canonical names untouched

| Internal / API (frozen) | User-facing label | Tooltip (exact official name always shown) |
|---|---|---|
| `system` | **Front Office Perk** | "A permanent run modifier. Internally: System." |
| lane profile | **How your roster wins** | five official component names beneath |
| `statistical_impact` | Statistical Impact | one-line explainer |
| `traditional_production` | Traditional Production | one-line explainer |
| `individual_recognition` | Individual Recognition | one-line explainer |
| `postseason_individual_value` | **Playoff Rate Impact** (unchanged label) | one-line explainer |
| `team_achievement` | **Team Result** (unchanged label) | one-line explainer |

`component-labels.test.ts:28-41` already pins the last two; do not change them.
`RunCard`'s unlabeled `"75.1th pct"` becomes an explicit
`"75th percentile of all PEAK3 3-year peak windows"` (W4).

### 5.3 Film Room third choice — DEFERRED, with reason

Not implemented. `nba_peak/run_the_table/generation.py` derives the entire node blueprint
deterministically from the seed; adding a third choice changes offer generation and would
make every existing daily seed and challenge token produce a different run. That is a
correctness regression disguised as a feature. W3 instead makes the two existing choices
unmistakably distinct and documents the deferral in the report.

### 5.4 Spinner — enhance, do not replace

`SpinStage` already lands on the authoritative server value via a pure `planReel`, and is
pinned by 101 unit tests (`strip[targetIndex] === target`, `TRAVELS = [62, 34]`,
`WINDOW_ROWS = 3`, `MAX_STRIP_ROWS = 160`) plus e2e assertions on `.spin-reel-strip`
count, `data-phase`, `data-final-value`, a 500 ms reduced-motion ceiling and a 1700 ms
mid-spin sample calibrated to `SPIN_MS = 2000`.

W5 keeps the reel geometry and timing budget and adds: a synchronized
**Franchise × Season** lockup, perceptible deceleration with one or two suspense ticks, a
decisive snap, a reroll "distance" flourish, and an ARIA live announcement of the final
pair. Replacing the reel with a canvas wheel would discard proven determinism for cosmetics.

### 5.5 Reroll policy (W5) — exact spec

Season reroll, given the current season index `s` in the ordered eligible season list:

1. Exclude the exact current season.
2. Prefer excluding every season within **±2** indices.
3. If the allowed pool is smaller than `MIN_RESPIN_POOL` (8), relax to **±1**.
4. If still too small, relax to exact-current-only.
5. Sample uniformly from the remaining allowed entries with `_respin_rng`.
6. Record `exclusion_radius` and `allowed_pool_size` in state metadata for tests/debug —
   **not** in normal UI.

Team reroll:

1. Exclude the current team.
2. Prefer excluding the most recent **2** teams seen in the run (from `respin_history`
   plus resolved spins).
3. Relax to 1, then to current-only, whenever the pool falls under `MIN_RESPIN_POOL`.
4. Preserve candidate feasibility (`≥ MIN_CANDIDATES_PER_ROLLABLE_TEAM_SEASON`, and at
   least one candidate not already used).

Uniformity is over the allowed post-exclusion pool. No era is weighted.

Idempotency: `RespinRequest` gains an optional `idempotency_key`; the state records the
last applied respin key per kind and returns the current state unchanged on replay, so a
double-click cannot consume two rerolls.

**Daily boards are unaffected** — only respin outcomes change, board generation does not.

### 5.6 Rankings (W6)

No leaderboard value is regenerated to a different number (§1.4). W6 will:

1. Import the model version from `nba_peak/formula_version.py` instead of the hardcoded
   `"peak3-v1"`; keep the emitted wire value byte-identical if the two differ, and record
   the mapping explicitly.
2. Extend `metadata.json` with per-input-CSV SHA-256 hashes and a `source_tree_dirty` flag.
3. Re-run `make build-dataset` and diff hashes before/after; publish both in
   `RANKINGS_SYNC_REPORT.md`.
4. Make `test_regression.py` **fail** rather than skip when `data/web/leaderboards.json`
   is missing, and add parity tests for: API version == artifact version, artifact hash
   == recorded hash, RUN THE TABLE card pool windows all resolve, latest supported season
   present.
5. Resolve the 1-Year / Single Seasons contradiction: the 1-Year board is relabelled
   **"Best single season (one row per player)"** and the Single Seasons board
   **"Every qualifying season"**, with the shared explainer stating plainly that at n=1
   the two differ only by player de-duplication.
6. Surface provenance near the rankings header: model version, data-through season,
   generated date, methodology link, and the serving-gate note promoted out of 10 px
   muted text.

---

## 6. Implementation order

1. **W7** alone → primitives, tokens, CSS partial stubs. Gate: `npm run build` passes.
2. **W1–W6** in parallel.
3. **Lead** integrates: reconcile `daily-grid.spec.ts` / `progression.spec.ts` /
   `daily-challenge.spec.ts` nav assertions, resolve any cross-writer type drift, run
   `typecheck` + `lint` + `vitest`.
4. **Lead** runs the full suites, the production build, the spinner distribution audit,
   and the rankings parity verification.
5. **Real-browser pass** at 1440×900, 1728×1117, 1024×768, 768×1024, 430×932, 390×844 —
   screenshots captured **and inspected**, into `docs/implementation/ux-polish-review/`.
6. **W8** adversarial reviewers, read-only, on the integrated tree.
7. Lead fixes blockers/high findings, reruns affected suites, writes the final report.

---

## 7. Rollback boundaries

Each writer's work is confined to its owned file list, so reverting one workstream is
`git checkout --` over that list. The two edits that reach outside the web app are:

- W5's changes to `apps/api/app/services/perfect_season/state.py`,
  `nba_peak/perfect_season/config.py` and `board.py`. Behaviour change is gated behind the
  new policy constants; setting `RESPIN_EXCLUSION_RADIUS = 0` and
  `RESPIN_TEAM_HISTORY_DEPTH = 0` restores the previous behaviour exactly.
- W6's changes to `scripts/build_web_dataset.py`. Provenance fields are additive; the
  ranking payload shape is unchanged.

No writer may modify `peak3.py`, `OFFICIAL_WEIGHTS`, `calibrate_score`, `nba_peak/leaderboards.py`,
or any file under `leaderboards/`.

---

## 8. Test matrix

| Area | New coverage | Owner |
|---|---|---|
| Nav | menu opens by click and by keyboard; ArrowDown/Up/Home/End roving; Escape closes and restores focus; every mode reachable; active route; mobile drawer focus trap + 44 px targets; no duplicate mode metadata; resume entry appears only with stored state | W1 |
| Homepage | launcher opens in place; each option's href; resume option hidden without stored run; `?start=standard` starts exactly one run; bare route still gates | W2, W4 |
| Guided tour | first-run auto-start; skip; close; next/back; "2 of 7" progress; versioned persistence; replay from Help; never starts during battle animation or a confirm dialog; reduced motion; focus return | W3 |
| RUN THE TABLE | **the exact screenshot scenario** — Sabonis outgoing, Nowitzki incoming, Francis not selected, confirmed transaction is Nowitzki-for-Sabonis at the published net; no `[object Object]` anywhere; changing outgoing clears an incompatible incoming; ineligible cards `aria-disabled` with one concise reason; cancel clears ephemeral state; battle reveal; completion actions; save/resume/challenge intact | W4 |
| Spinner | golden-seed determinism; exact-repeat prevention; adjacent-season prevention while the preferred pool is viable; graceful relaxation on a small pool; reroll-budget idempotency under double-submit; **100 000-sample distribution audit**; no invalid team-season combinations; browser proof the animation lands on the API result; reduced motion; keyboard + SR | W5 |
| Rankings | frontend top rows == generated artifact; API version == artifact version; card pool windows resolve; component totals reconcile; cache keys include model+data version; latest supported season present | W6 |
| A11y | axe zero critical/serious on every changed surface, incl. Play menu open, mobile drawer open, tour active | W7 |

---

## 9. Acceptance criteria

The pass is done when §15 of the brief holds **and** all of:

- `make test-model`, `make test-lineup`, `make test-api`, `make test-web`, `make test-e2e`
  pass, with counts surfaced.
- `npm run typecheck` clean; `npm run lint -- --max-warnings 0` clean; `npm run build` succeeds.
- `docs/implementation/spinner-audit.json` exists with ≥100 000 samples and zero violations.
- `docs/implementation/RANKINGS_SYNC_REPORT.md` carries commands, before/after hashes,
  counts and top rows.
- Screenshots at all six viewports captured and inspected.
- `git status --short` shows no commit, no push, no PR, no merge, no stash — only an
  unstaged diff.
