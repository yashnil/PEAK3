# UX / Organization / Polish pass — final report

Every number, hash and command output below was captured during the pass. Where something
was deferred or left broken, it is named in §14 rather than omitted.


---

---

## 1. Executive summary

One integrated pass over navigation, homepage, RUN THE TABLE, the 82-0 spinner and
rankings provenance. Six read-only discovery agents, then a written plan, then seven
writers on strictly disjoint file sets, then five adversarial reviewers, then fixes.

What actually shipped:

- **Navigation.** `Play` is now a nested, keyboard-operable game launcher (four groups,
  featured flagship, "View all games" last) plus a real mobile drawer built on a focus-
  trapping `Dialog`. The previously orphaned `/play/endless` is reachable again.
- **Homepage.** The `Start a Run` → *another* `Start a run` funnel is gone: the primary
  control is a launcher that names the choice it is about to make. The hero is roughly
  half its former height and carries a live vignette built from the model's real top-3
  three-year windows. A model proof strip and a compact game launcher sit above the fold.
- **RUN THE TABLE.** Both P0 defects fixed at the root — `[object Object]` was a *lying
  client type*, and the "Steve Francis stays highlighted" bug was `selected` outranking
  `compatible` in a border ternary plus two never-cleared `useState`s. The Trade Desk is
  now a four-step transaction builder. A versioned, replayable, focus-managing guided
  tour teaches the mode in seven steps.
- **82-0.** A distance-aware respin policy with a documented relaxation ladder, respin
  idempotency, and a synchronized Franchise × Season reveal — enhanced rather than
  rewritten, so 101 `planReel` unit tests and the reduced-motion timing budget survive.
- **Rankings.** Proven *not* stale, then given the provenance it was missing. Parity
  tests went from 12 skippable to 35 unskippable.

**Zero new runtime dependencies.** `apps/web` still has exactly 9.

Five defects were found by looking at real screenshots that no test would have caught,
and three integrity defects were found by checking copy against the engine. Those are
recorded in §14 with the same weight as the wins.

---

## 2. Baseline git state

Captured before any edit:

```
$ git status --short
 M PEAK3_UX_ORGANIZATION_POLISH_CLAUDE_PASS.md

$ git diff --stat
 PEAK3_UX_ORGANIZATION_POLISH_CLAUDE_PASS.md | 10 ----------
 1 file changed, 10 deletions(-)

$ git diff --check
PEAK3_UX_ORGANIZATION_POLISH_CLAUDE_PASS.md:1176: new blank line at EOF.

$ git log -1 --oneline
efaeff4 Implement Run the Table game

$ git rev-parse HEAD
efaeff4a5c00b12c8f8c3ed4bd03cf0221609f17

$ git stash list
(empty)
```

Branch: `feature/run-the-table`. The only pre-existing uncommitted change was the brief
itself (its own "first command to Claude Code" appendix had been removed). That change is
preserved untouched.

Baseline suites, run before any edit:

```
$ make test-model
================== 788 passed, 1 xfailed in 406.05s (0:06:46) ==================

$ /Users/yashnilmohanty/miniforge3/bin/python3 -m pytest tests/lineup/ -q
43 passed in 0.35s
```

Collected-test baseline (from the read-only audit; note every count printed in the
Makefile help, the CI job names and `docs/implementation/LOCAL_DEV.md` was already stale
before this pass):

| Suite | Real collected count at baseline |
|---|---|
| `tests/` minus `tests/lineup` | 789 |
| `tests/lineup/` | 43 |
| `apps/api/tests/` | 868 |
| vitest | 562 across 23 files |
| Playwright | 264 (246 chromium + 18 mobile-chrome) |
| axe subset (`--grep accessibility`) | 19 |

---

## 3. Agent topology and file ownership

Phase A — six parallel **read-only** discovery agents (A1 information architecture and
routes; A2 RUN THE TABLE UX and state; A3 82-0 spinner and RNG; A4 rankings and artifact
provenance; A5 design system, motion and dependencies; A6 automated tests and browser
risk). None of them wrote a file.

Phase B — the lead synthesised `docs/implementation/UX_ORGANIZATION_POLISH_PLAN.md`,
including the shared contracts in its §3, before any writer started.

Phase C — **strict disjoint file ownership** rather than git worktrees. That is the
choice the plan records and the reason is concrete: all six writers share one
`apps/web/node_modules` and one Next.js build, the contended surfaces reduced to exactly
two files (`globals.css` and `lib/modes.ts`), and both were resolved by assignment —
`globals.css` to W7 alone, with six per-writer CSS partials imported from it, and
`modes.ts` to W1 alone with additive-only fields. Worktrees would have added a
per-writer `npm install` and a merge step for zero additional isolation.

W7 (shared primitives, tokens, CSS partial stubs) ran **first and alone**; W1–W6 ran in
parallel only after W7's production build passed. Full ownership table: plan §4.

### Writer ownership, as executed

| Agent | Owned | Outcome |
|---|---|---|
| **W7** (ran first, alone) | `components/ui/*`, `lib/a11y.ts`, `lib/motion.ts`, `styles/globals.css` + six partial stubs | 11 primitives, 33 `--pk-*` tokens (all additive), 31 tests. Proved the `@import "./x.css"` partial contract holds under Tailwind v4 before anyone else started. |
| **W1** | nav shell, `PlayMenu`, `MobileNavDrawer`, `nav-model.ts`, `resume-state.ts`, `modes.ts`, `play-routing.spec.ts` | 60 new unit tests |
| **W2** | homepage, `/arena`, `GameCard`, `components/home/*`, `gameplay.spec.ts` | 14 new unit tests |
| **W3** | `GuidedTour`, `tour-steps.ts`, `tour-state.ts`, `run-the-table-copy.ts`, 4 RTT components | 57 new unit tests |
| **W4** | 13 RTT components, RTT types + state, `public.py`, 3 RTT test files | 144 tests incl. the screenshot-scenario regression |
| **W5** | `perfect_season` state/models/API/config/board, `SpinStage`, `CourtBuilder`, spinner tests, audit script | 331 API tests, 127 unit, 200k-sample audit |
| **W6** | `build_web_dataset.py`, `test_regression.py`, peaks/seasons/meta, rankings page + components | parity 12 → 35 tests |
| **Reviewers** | read-only | R1 product comprehension · R2 statistical integrity · R3 accessibility · R4 code/state integrity · R5 visual polish |

Two files were genuinely contended and were resolved by assignment rather than
coordination: `globals.css` (W7 alone, with six per-writer partials imported from it) and
`lib/modes.ts` (W1 alone, additive-only). Every existing spec file was given exactly one
owner; the four the lead kept (`daily-grid`, `progression`, `daily-challenge`, `ranked`)
were the ones carrying nav assertions that no single writer owned.

Worktrees were considered and not used. The plan records why: all writers share one
`node_modules` and one Next build, the contended surface reduced to two files, and both
were resolved by ownership — so worktrees would have added a per-writer `npm install` and
a merge step for no additional isolation. A worktree *was* used for one thing: building
`HEAD` in isolation to get the honest before/after bundle numbers in §11.

### Writer ownership, as executed

| Agent | Owned | Outcome |
|---|---|---|
| **W7** (first, alone) | `components/ui/*`, `lib/a11y.ts`, `lib/motion.ts`, `styles/globals.css` + six partial stubs | 11 primitives, 33 additive `--pk-*` tokens, 31 tests. Proved the `@import "./x.css"` partial contract holds under Tailwind v4 before anyone else started. |
| **W1** | nav shell, `PlayMenu`, `MobileNavDrawer`, `nav-model.ts`, `resume-state.ts`, `modes.ts`, `play-routing.spec.ts` | 60 new unit tests |
| **W2** | homepage, `/arena`, `GameCard`, `components/home/*`, `gameplay.spec.ts` | 14 new unit tests |
| **W3** | `GuidedTour`, `tour-steps.ts`, `tour-state.ts`, `run-the-table-copy.ts`, 4 RTT components | 57 new unit tests |
| **W4** | 13 RTT components, RTT types + state, `public.py`, 3 RTT test files | 144 tests incl. the screenshot-scenario regression |
| **W5** | `perfect_season` state/models/API/config/board, `SpinStage`, `CourtBuilder`, spinner tests, audit script | 331 API tests, 127 unit, 200k-sample audit |
| **W6** | `build_web_dataset.py`, `test_regression.py`, peaks/seasons/meta, rankings page + components | parity 12 → 35 tests |
| **Reviewers** | read-only, post-integration | R1 comprehension · R2 statistical integrity · R3 accessibility · R4 code/state · R5 visual polish |

Two files were genuinely contended and were resolved by assignment rather than
coordination: `globals.css` (W7 alone, with six per-writer partials imported from it) and
`lib/modes.ts` (W1 alone, additive-only). Every existing spec file was given exactly one
owner; the four the lead kept — `daily-grid`, `progression`, `daily-challenge`, `ranked` —
were the ones carrying nav assertions no single writer owned.

Worktrees were considered and deliberately not used for the writers: all seven share one
`apps/web/node_modules` and one Next build, and the contended surface reduced to two files
that ownership already resolved, so worktrees would have added a per-writer `npm install`
and a merge step for no additional isolation. One *was* used — to build `HEAD` in
isolation for the honest before/after bundle numbers in §11.

---

## 4. Research and dependency decisions

**Zero new runtime dependencies.** `apps/web` still has exactly 9 runtime packages.

| Candidate | Decision | Reason |
|---|---|---|
| Radix Navigation Menu / Dropdown | Not added | Would pull a transitive `@radix-ui/react-*` tree for one menu; the existing nav already implemented Escape, outside-click and focus restore, so the incremental work was roving arrow keys and `aria-expanded`. |
| driver.js | Not added | 5 kB, but it owns its overlay DOM outside React, which fights the portal/focus model the tour needs and code-splits worse than a `next/dynamic` import of our own component. |
| floating-ui | Not added | Only two positioned surfaces exist (Play menu anchored to a fixed-height sticky header, and tooltips). CSS anchoring plus viewport clamping covers both. |
| `spin-wheel` (crazytim) | Not added | The 82-0 reveal is a dual team+season strip reel with 101 unit tests pinning `planReel`; adding a canvas wheel would mean maintaining two spinners and discarding proven determinism. |
| `motion` | Already installed (`motion@11.18.2`, imported as `motion/react`) | Used for the new motion work. |

`LazyMotion` was built and exported (`apps/web/src/lib/motion.ts`) but deliberately **not**
wired into a layout: six existing components import `motion.*` directly, and `LazyMotion`
only shrinks the bundle once components migrate to the `m.*` API. Wiring it non-strict
would have been a no-op that looked like an optimisation. Recorded as a limitation in §14
rather than shipped as theatre.

---

## 5. Navigation — before / after

| | Before | After |
|---|---|---|
| Play | Flat link to `/arena`; 3 clicks from navbar to a run | Disclosure **button**, nested panel, every mode one click; `/arena` is the last row and ArrowUp lands on it |
| Structure | 5 flat links | Flagship · Daily · Competitive · Explore, sourced from `MODE_COPY` |
| Mobile | In-flow dropdown, `role="dialog"` with no trap, 38px targets | Portalled sheet, focus trap, scroll lock, ≥44px targets, Play expanded by default, Rankings above the fold |
| Resume | None | `lib/resume-state.ts` aggregates the five independent stores; drawer offers "Resume run" only when one exists |
| Orphans | `/play/endless` linked from nothing | Surfaced under Explore |

`aria-label="Main navigation"` and the active-state class `bg-[var(--bg-surface)]` are
preserved — six specs depend on them.

---

## 6. Homepage — before / after

The old first viewport was entirely headline: a `text-5xl/md:7xl` h1, a paragraph, two
buttons, nothing interactive. The new one is a two-column editorial hero — promise line,
the same (frozen) h1 at `text-3xl/sm:4xl/lg:5xl`, the launcher, and a live vignette of
the model's actual rank-1 window with its five component bars — followed immediately by a
grouped game launcher and a provenance strip.

The h1 text is unchanged on purpose: it was the only assertion both W1's and W2's specs
shared, and freezing it removed the collision entirely.

---

## 7. RUN THE TABLE onboarding and terminology

`GuidedTour` is portal-based, SVG-mask spotlit, focus-trapped, Escape-dismissable,
progress-labelled ("1 OF 7"), versioned in localStorage, replayable from a visible
**HOW TO PLAY** control, blocked during battle animations, and lazily mounted. Contextual
one-time coachmarks cover first entry to Draft Room, Film Room, Rest/Bank, Trade Desk and
Boss Battle without replaying the whole tour.

Terminology moved to a display layer (`lib/run-the-table-copy.ts`) that never renames a
canonical field: **System → Front Office Perk** (with "Receipts and the API call these
Systems — same thing." stated in the open, not buried), **Lane Profile → How your roster
wins**, and the five official component names kept verbatim — `Playoff Rate Impact` and
`Team Result` are pinned by `component-labels.test.ts` and did not change.

`RunCard`'s unlabeled `"75.1th pct"` now reads *"75.1th percentile of the card pool"*.
The brief suggested "of all PEAK3 3-year peak windows"; W4 checked `cards.build_pool()`
and that would have been wrong — the ranking is over the role-eligible, non-excluded card
pool. The shipped wording is the true one.

**Film Room's third choice was deliberately not implemented.** `generation.py` derives the
whole node blueprint from the seed, so a third branch would change every existing daily
seed and every issued challenge token — a correctness regression dressed as a feature.
The two existing choices now state what you *give up*, which is the part the payload never
said and the part the decision actually turns on.

---

## 8. Trade Desk defect root causes

Both defects in the brief's screenshot were located in source before any fix was written.

### 8.1 `[object Object]`

`apps/web/src/components/run-the-table/RunCard.tsx:164-168` (pre-fix):

```tsx
{card.cost_modifiers.length > 0 && (
  <p ...>{card.cost_modifiers.join(" · ")}
```

`Array.prototype.join` over an array of **objects**. The server's truth
(`nba_peak/run_the_table/pricing.py:74-86`) is:

```python
applied.append({"system_id": system_id, "discount_pct": round(discount*100),
                "before": int(round(before)), "after": max(PRICE_MIN, int(round(cost)))})
```

passed through untouched at `apps/api/app/services/run_the_table/public.py:64,81`, and
never coerced because `RunStateResponse.active_node` is a bare `Optional[dict]`
(`apps/api/app/models/run_the_table.py:162`).

The reason `tsc` never caught it: `apps/web/src/types/run-the-table.ts:98` declared
`cost_modifiers: string[]`. **The client type was wrong**, so the compiler was satisfied.

Trigger surface: any card discounted by a System — `moneyball`, `no_hardware`,
`two_way_value`, i.e. 3 of the 6 selectable Systems — on every `RunCard` instance (Draft
Room offers, Trade Desk incoming, Trade Desk outgoing). The unit fixture at
`run-the-table-components.test.tsx:97` hardcoded `cost_modifiers: []`, which is precisely
why the bug shipped past 60 component tests.

### 8.2 Unrelated card stays highlighted (the "Steve Francis" defect)

`TradeDesk.tsx:32-33` held two independent `useState`s. Neither handler cleared the other
column (`:81`, `:138`), and `RunTheTableGame.tsx:459-477` rendered `<TradeDesk>` with no
`key`, so nothing reset on node change. In the border/background ternary (`:91-97`,
`:144-150`), `selected` **outranked** `compatible`:

```tsx
borderColor: selected ? "var(--peak-accent)" : compatible ? "var(--border-default)" : "var(--incorrect-dim)"
```

so a card that had become illegal was painted accent-gold *and* carried a red
"Not eligible" badge at the same time, with `aria-pressed="true"` still announced.
Separately, incompatible-but-**unselected** incoming cards were given an
`--incorrect-dim` red border — which is what the supplied screenshot shows on the Steve
Francis card, and why it reads as "highlighted". Ineligible cards were deliberately left
clickable with no `aria-disabled`, so a screen reader announced them as ordinary buttons.

---

## 9. Spinner — algorithm, animation, fairness

Policy `perfect_season_respin_policy_v1`: `MIN_RESPIN_POOL=8`,
`RESPIN_SEASON_EXCLUSION_RADIUS=2`, `RESPIN_TEAM_HISTORY_DEPTH=2`. `plan_respin()` builds
an ordered ladder, takes the first rung whose feasible pool clears the floor, and draws
uniformly from it with the existing seeded RNG. The current entry is excluded at **every**
rung, so "the reroll gave me the same thing" is structurally impossible.

Audit (`docs/implementation/spinner-audit.json`), 200,000 samples over the 1,314-entry
catalogue:

```
TOTAL VIOLATIONS: 0
season  reduced chi2 = 0.9609  z = -0.995   dof 1294
team    reduced chi2 = 0.9377  z = -1.617   dof 1313
```

**Stated plainly, because the headline number could mislead:** 609 of 100,000 season
respins (**0.61%**) still land within ±2 seasons — down from 11.66% under the old policy,
a ~19× reduction. Every remaining case is a short-lived franchise (San Diego Clippers,
Kansas City Kings, Vancouver Grizzlies, the two Hornets identities) where fewer than 8
same-team seasons exist beyond ±2, so the ladder must relax or fail. The audit's
`adjacent_season_while_preferred_pool_viable` counter reads 0 because it scopes "viable"
to the rung the ladder chose; the raw jump histogram is published beside it so the reader
can check the claim rather than take it.

Two aggregate χ² figures look alarming and are not: season-respin *franchise* and
team-respin *season* are dimensions the policy holds fixed by construction. The artifact
marks them `is_structurally_fixed_dimension` rather than leaving that to be misread.

Visually: the reel geometry, class names and `SPIN_MS` budget are untouched (101 unit
tests and a 500ms reduced-motion ceiling depend on them). Added: a Franchise × Season
lockup that seals only when both reels land, detent ticks off the reel's own settling
stage, and a respin flourish naming the axis. No sound at all — the simplest honest
reading of "opt-in, muted by default".

---

## 10. Rankings provenance

### 10.1 The visible rankings were **not** stale — proven before anything was changed

Row-by-row comparison of `data/web/leaderboards.json` against all four canonical CSVs
(rank + player name + `Prime raw` → `prime_index` + `Prime display` → `prime_score`):

```
n=1: csv_rows=250 json_rows=250 mismatches=0
n=2: csv_rows=249 json_rows=249 mismatches=0
n=3: csv_rows=248 json_rows=248 mismatches=0
n=5: csv_rows=237 json_rows=237 mismatches=0
TOTAL MISMATCHES: 0
```

The mtime skew that prompted the suspicion (`leaderboards/` dated Jul 31 02:18–02:21,
`data/web/*.json` dated Jul 30 10:47) is a checkout artifact:
`git status --porcelain leaderboards/` is empty and the CSVs have not changed content
since commit `17e0db6`. `peak3.py` did gain `postseason_value_v2` in `c806317`, but v2 is
opt-in (`DEFAULT_FORMULA_VERSION = PEAK3_V1`), reads separate parquets, and writes
separate artifacts; `apps/api/tests/test_model_version.py` pins the default.

A second, independent pipeline agrees: the served boards (`top_1000_peaks.v1.json`, built
from the full 2,016-identity parquet population rather than the 250-player pool) match
across all ~245 overlapping players per window with zero score or anchor-season
differences and identical top-10 ordering at 1y/3y/5y.

**No leaderboard row was regenerated to a different value in this pass, and no weight,
calibration anchor or leaderboard CSV was touched.**

### 10.2 What was actually wrong — provenance, not numbers

1. `data/web/metadata.json` recorded `source_commit: d5e8acf…`, provably wrong:
   `methodology.json` is byte-equal to the *current* `METHODOLOGY` dict, which was
   rewritten after `d5e8acf`. `get_source_commit()` (`scripts/build_web_dataset.py:98-108`)
   ran `git rev-parse HEAD` with no dirty check and no hash of its inputs.
2. Three spellings of the model version: `"peak3-v1"` hardcoded at
   `scripts/build_web_dataset.py:50`, `"peak3_v1"` in `nba_peak/formula_version.py:31-33`
   (the module whose docstring declares itself the single source of version identity),
   and `"peak3-2026"` in `apps/api/tests/conftest.py:73`.
3. The parity tests **skipped** instead of failing: `apps/api/tests/test_regression.py:16-21`
   calls `pytest.skip()` when `data/web/leaderboards.json` is absent, and `data/web/` is
   gitignored — so on a clean checkout every parity assertion silently vanished. Worse,
   `apps/api/tests/conftest.py:95-99` falls back to 30 synthetic players named
   `First001 Last001`, so leaderboard API tests still "passed" against fabricated data.
4. A genuine terminology contradiction: at the **1-Year** setting a peak window *is* a
   single season, so the "Peak Windows" and "Single Seasons" boards returned literally the
   same top rows (`1 Michael Jordan 1990-91 97.53`, `2 LeBron James 2008-09 95.85`) while
   being presented as two different questions (`rankings/page.tsx:26-27`, header `:158`).

Full commands, hashes, counts and top rows: `docs/implementation/RANKINGS_SYNC_REPORT.md`.

---

## 11. Accessibility and performance

Accessibility work is listed in §14 with the review that found it. Net: one real axe
`serious` violation was introduced and fixed (`<p>` inside a `<dl>`), and six focus /
live-region defects were fixed before shipping.

**Bundle**, measured against a clean worktree build of `HEAD` (not estimated):

| Route | Before | After | Δ |
|---|---|---|---|
| `/` | 168 B / 106 kB | 3.63 kB / 123 kB | +17 kB first load |
| `/arena/run-the-table` | 17.6 kB / 156 kB | 24.3 kB / 180 kB | +24 kB |
| `/rankings` | 16.9 kB / 178 kB | 17.4 kB / 182 kB | +4 kB |
| shared chunk | 103 kB | 102 kB | **−1 kB** |

The homepage went from a pure server component to carrying a client launcher and a live
vignette; that is where its +17 kB is. No dependency was added, and the shared chunk
shrank. `LazyMotion` was built and exported but deliberately **not** wired in — six
components import `motion.*` directly, so wiring it without migrating them to `m.*` would
be a no-op that looked like an optimisation.

---

## 12. Test counts

| Suite | Baseline | Final |
|---|---|---|
| `make test-model` | 788 passed, 1 xfailed | **788 passed, 1 xfailed** |
| `make test-lineup` | 43 | **43** |
| API (`--ignore=tests/integration -m "not supabase_integration"`) | 850 selected | **901 passed, 5 deselected** |
| vitest | 562 | **789 passed (31 files)** |
| Playwright | 264 | **300** |
| `npm run typecheck` | clean | clean |
| `npm run lint -- --max-warnings 0` | clean | clean |
| `npm run build` | passes | passes |

The model suite is **byte-identical to baseline**, which is the point: no scoring path was
touched.

---

## 13. Screenshot index

44 frames, captured against a **production build** (not the dev server) on a real API, at
the six required viewports plus a 720×450 stand-in for 1440×900 at 200% zoom. Every frame
carries an md5 in `screenshot-manifest.json`; **zero duplicate groups** — see §14 for why
that check exists.

| `01-home-1024x768.png` | 1024x768 | Homepage first viewport at 1024x768 |
| `01-home-1440x900.png` | 1440x900 | Homepage first viewport at 1440x900 |
| `01-home-1728x1117.png` | 1728x1117 | Homepage first viewport at 1728x1117 |
| `01-home-390x844.png` | 390x844 | Homepage first viewport at 390x844 |
| `01-home-430x932.png` | 430x932 | Homepage first viewport at 430x932 |
| `01-home-768x1024.png` | 768x1024 | Homepage first viewport at 768x1024 |
| `01f-home-fullpage-1440x900.png` | 1440x900 | Homepage, entire document |
| `02-play-menu-open-1440x900.png` | 1440x900 | Desktop Play menu, opened by click |
| `02b-play-menu-keyboard-1440x900.png` | 1440x900 | Play menu opened with ArrowDown; focus is on the first item |
| `02c-play-menu-200pct-zoom.png` | 720x450 | Play menu at a 720x450 viewport, standing in for 1440x900 at 200% zoom |
| `03-mobile-nav-390x844.png` | 390x844 | Mobile navigation drawer open at 390x844 |
| `03-mobile-nav-430x932.png` | 430x932 | Mobile navigation drawer open at 430x932 |
| `04-arena-catalog-1440x900.png` | 1440x900 | /arena — the full catalog |
| `04b-arena-catalog-768x1024.png` | 768x1024 | /arena at tablet width |
| `05-rtt-start-gate-1440x900.png` | 1440x900 | Direct visit to /arena/run-the-table still shows the start gate (no run created) |
| `05b-rtt-start-gate-390x844.png` | 390x844 | Start gate on mobile |
| `06-tour-01-run-map.png` | 1440x900 | Guided tour step 1 — spotlighting "run-map" |
| `06-tour-02-current-decision.png` | 1440x900 | Guided tour step 2 — spotlighting "current-decision" |
| `06-tour-03-credits.png` | 1440x900 | Guided tour step 3 — spotlighting "credits" |
| `06-tour-04-lives.png` | 1440x900 | Guided tour step 4 — spotlighting "lives" |
| `06-tour-05-roster.png` | 1440x900 | Guided tour step 5 — spotlighting "roster" |
| `06-tour-06-front-office-perks.png` | 1440x900 | Guided tour step 6 — spotlighting "front-office-perks" |
| `06-tour-07-lane-profile.png` | 1440x900 | Guided tour step 7 — spotlighting "lane-profile" |
| `07-system-select-1440x900.png` | 1440x900 | Front Office Perk selection |
| `08-node-choice-1440x900.png` | 1440x900 | Path choice between two node types |
| `09-draft-room-1440x900.png` | 1440x900 | Draft Room |
| `10-trade-desk-1440x900.png` | 1440x900 | Trade Desk |
| `10b-trade-desk-outgoing-selected-1440x900.png` | 1440x900 | Trade Desk with one outgoing player selected — only that card is highlighted |
| `11-choice-node-1440x900.png` | 1440x900 | Film Room / Rest-Bank |
| `12-boss-preview-1440x900.png` | 1440x900 | Boss pre-battle |
| `13-battle-reveal-1440x900.png` | 1440x900 | Boss reveal |
| `14-completion-1440x900.png` | 1440x900 | Completion receipt |
| `14b-rtt-final-390x844.png` | 390x844 | RUN THE TABLE final surface on mobile |
| `15-82-0-team-spin-in-motion-1440x900.png` | 1440x900 | 82-0 spinner mid-flight (sampled ~600ms into the ceremony) |
| `15a-82-0-start-gate-1440x900.png` | 1440x900 | 82-0 start gate |
| `16-82-0-season-reel-revealed-1440x900.png` | 1440x900 | 82-0 franchise x season lockup after the snap |
| `16b-82-0-revealed-390x844.png` | 390x844 | 82-0 reveal on mobile |
| `17-rankings-1440x900.png` | 1440x900 | Rankings with model version and provenance |
| `17b-rankings-provenance-1440x900.png` | 1440x900 | Provenance strip in view |
| `17c-rankings-390x844.png` | 390x844 | Rankings on mobile |
| `18-focus-home-nav-1440x900.png` | 1440x900 | Focus ring after three Tab presses from the top of the homepage |
| `18b-focus-rtt-start-gate-1440x900.png` | 1440x900 | Focus ring inside the RUN THE TABLE start gate |
| `19-reduced-motion-home-1440x900.png` | 1440x900 | Homepage under prefers-reduced-motion: reduce. At rest this is expected to look identical to th |
| `19b-reduced-motion-82-0-1440x900.png` | 1440x900 | 82-0 reveal under reduced motion — revealed within 500ms with zero spin-ceremony-spinning eleme |

---

## 14. Review findings, and what happened to each

Five read-only reviewers ran on the integrated tree. They found real defects. The ones
that mattered were fixed and re-verified; the rest are recorded here rather than dropped.

### 14.1 Found by looking at real screenshots — no test would have caught these

1. **A hamburger button rendered at every width**, beside the full desktop nav.
   `.pk-nav-burger` declared `display: inline-flex` in an unlayered CSS partial, and an
   unlayered declaration beats a layered one regardless of source order — so it silently
   defeated Tailwind's `sm:hidden`. jsdom never applies the stylesheet, so vitest could
   not see it. Fixed with an explicit media query; guarded by a new e2e test asserting
   computed visibility at five widths.
2. **The Play panel ran ~150px off the right edge at 1440×900** — caused *by* fixing (1),
   which moved the nav hard right while the panel was still `left: 0`-anchored. Clamping
   its *width* had never helped, because the overflow came from its *position*. Now
   right-anchored, with a viewport clamp in the 640–860px band where a 200%-zoom viewport
   lands. Guarded by a geometric e2e test at five widths.
3. **The 82-0 spinner printed its own answer mid-flight.** The crest read "HOU" in
   Rockets red while the reel below still cycled Charlotte. The accent *variables* were
   correctly gated on `teamAccentReady`; the badge was not — so the whole deceleration
   animated toward a conclusion already on screen. The crest is now identity-free until
   the reel arrives.
4. **The mobile drawer was ~65% empty** with all four sections collapsed. Play now opens
   by default; Rankings still sits above the fold because only one section is ever open.
5. **The Trade Desk had an unsignposted dead end.** Selecting a roster slot that no offer
   on the board can legally fill left all three incoming cards disabled with no forward
   path — exactly the "trial-and-error to discover role legality" the brief bans. Every
   outgoing card now warns *before* it is clicked, and Step 2 names both ways out.

### 14.2 Found by checking copy against the engine

6. **The guided tour stated the trade refund rule wrongly.** It promised "half their
   current price"; `pricing.refund_for` refunds a fraction of the **undiscounted base
   cost**. The Trade Desk screenshot showed the contradiction on screen (Marion: current
   price 4, refund 4). `config.py`'s own comment was the source of the error and said
   "current price" too — both fixed; `refund_for`'s docstring was already correct.
7. **The homepage headed the PEAK3 weight strip "What decides a battle".** A battle is
   first to 3 of five *equally weighted* lanes; the weights build a player's rating and
   reach a battle only through the second tie-breaker, so Team Result (3% of PEAK3)
   decides a lane exactly as often as Statistical Impact (38%). Retitled "How a player is
   rated", with an explicit sentence stating how a battle differs.
8. **"Ranked peak windows: 984" contradicted "Rows on this board: 1,000".** 984 is
   `sum(len(v))` over the four committed top-250 CSVs; one published board cannot be
   larger than the site's stated total. Relabelled "Leaderboard rows — top 250 at each
   window length".

### 14.3 Found by code review

9. **`?start=daily` would have burned a shared daily attempt on navigation.** This was my
   own plan §5.1 decision and it was wrong for the daily case: a standard run costs
   nothing to create, but the daily is one board and one attempt per UTC day, so a URL
   that spends it meant everyone the link reached lost theirs. `?start=` now accepts
   `standard` only, and the launcher's daily option lands on the gate. Also hardened:
   `?c=<token>&start=standard` no longer discards the challenge token.
10. **Respin idempotency remembered only the last key per kind**, so respin #2 evicted
    #1's key and a delayed duplicate of #1 could burn a third respin *and* reroll a board
    the player had already accepted. Now a bounded ledger sized to the whole run budget,
    tolerant of the previous single-string shape on load.
11. **The relaxation fallback took the *widest* non-empty rung.** The rungs nest, so
    widest always meant least restrictive — discarding the distance and recent-history
    guarantees even when a stricter rung had candidates. Now takes the first
    (most restrictive) viable rung; two synthetic-pool tests were strengthened to assert
    the concrete result, not just the tier name.
12. **The documented rollback constants were unreachable.** `state.py` used
    `from ... import`, binding copies, so setting them on the config module — the obvious
    reading of the plan — did nothing. Read at call time now, and the rollback test
    patches the config module.
13. **`artifact_digest` hashed the file on disk, not the bytes being served.** With a
    never-invalidated `_CACHE` that would report "current" for exactly the staleness it
    exists to detect. Now digested from the same string `_load()` parses.
14. **A new type lie** — `RespinPolicyDebugEntry` declared four fields required that the
    documented rollback path does not send. Made optional; structurally the same defect
    as the `cost_modifiers: string[]` bug this pass exists to fix.
15. **Unbounded `idempotency_key`** persisted into the game's JSONB payload for the life
    of the game. Capped at 128, matching `run_the_table.py`.

### 14.4 Accessibility defects fixed

16. `PlayMenu` announced `aria-haspopup="true"` — an ARIA alias for `"menu"` — while
    deliberately implementing the disclosure-navigation pattern, so it promised menuitems
    and delivered links. Removed; `aria-controls` is now conditional on the panel existing.
17. **Tab out of the homepage launcher dumped focus to `<body>`.** React flushed the close
    before the browser's default Tab, unmounting the element focus was leaving from.
    Deferred to a microtask.
18. **Closing an auto-started tour left focus on `<body>`** — `useRestoreFocus` captured
    `<body>` as the "previously focused element", and restoring to it is a silent no-op.
    It now treats `<body>` as "no origin" and accepts a fallback element.
19. **The battle verdict was announced to nobody.** Its live region rendered already
    populated on mount, which is not a mutation of an existing region and is generally not
    announced. Mounted empty and filled a frame later — which also stopped it racing the
    shell's own polite region in the same tick.
20. **`<p>` inside a `<dl>`** in the model proof strip: a real axe `serious`
    `definition-list` violation that failed the landing-page gate. Folded into the `<dd>`.
21. **The Franchise × Season lockup had no text separator**, so its accessible text read
    "Washington Bullets×1992-93" as one token. The glyph moved into a CSS pseudo-element
    and a real separator was added — caught because a courtbuilder spec cross-checks that
    string against the candidate rows.

### 14.5 Fixed in the screenshot harness itself

The first capture run produced two pairs of **byte-identical frames under different
names** — a "guided tour step 1" that was really the perk-select screen with no tour on
it, and a "reduced motion" homepage that was really the ordinary full-page shot — and
listed both in the manifest as distinct evidence. That is a fabricated artifact, and it
would have made this report's screenshot section a lie.

Fixed three ways: the tour capture now clears tour storage so the auto-start path is the
one exercised, asserts the overlay is genuinely up, and **fails** the run otherwise; every
frame records an md5 in the manifest so duplicates are visible to any reader; and captures
run against a **production build**, because all 38 original frames carried Next's dev
indicator, which occluded product content in five of them.

The final set is 44 frames, **zero duplicate groups**, all seven tour steps present with
their real spotlight targets.

### 14.6 Reported and NOT fixed — with reasons

- **The receipt's "Why this run ended this way" column mixes units.** `receipt.py` emits
  `signed_value` as a battle count, a literal 0, a prime-score delta and negative credits,
  and `RunResult` renders all four through one signed formatter — so "Finished holding 68
  unspent credits" prints as a red `−68.0` (visible in `14-completion-1440x900.png`),
  implying a 68-point penalty no engine quantity supports. Fixing it properly means adding
  a `unit` to the receipt payload, which is engine surface area I was not willing to change
  this late without a full engine-test cycle. **Real defect, precisely located, deferred.**
- **Rankings component columns do not sum to TOTAL** (Jordan: 87.1 vs 97.5) because
  `calibrate_score` is a monotonic remap. Five component columns beside a column named
  TOTAL will be read as a sum. Needs a one-line note on the board; it is a documentation
  gap, not a scoring error, and the weights and components shown are correct.
- **Coachmarks render below the controls they explain**, because the e2e driver clicks the
  first `<button>` in each surface. A test-ordering constraint is dictating reading order
  for first-time players. The fix is a more specific driver selector, then moving them up.
- **The same rule is stated up to six times on the Rest/Bank screen** — three copy layers
  (`NODE_TYPE_COPY.purpose`, the generator `summary`, `NODE_TYPE_COPY.consequence`) were
  each written to be the clarifying one and now stack.
- **Share-image export was not shipped.** `lib/scorecard-export.ts` is hard-typed
  end-to-end to 82-0 (`CourtLineupPublicState`, `SlotType`-keyed pills, team colours, a
  simulated record); a `RunReceipt` shares no field with it. The choice was a broken button
  or no button, and the brief says not to ship a broken one. It needs `scorecard-export.ts`
  reworked into a shared drawing kit plus per-mode layouts.
- **82-0 copy still says "Full-season simulation"** while `simulation.py` is an explicitly
  uncalibrated heuristic. RUN THE TABLE is scrupulous here ("no game is simulated"); the
  82-0 surfaces predate this pass and sat outside its file ownership.
- **Concurrent lost updates on the Postgres path** remain possible for two *different*
  respin actions in two tabs. The idempotency key defeats duplicates, not concurrency;
  closing it needs a version column on `save_lineup`.
- **`/arena` says "Every PEAK3 mode in one place"** but the Play menu now also surfaces
  Ranked, Peak Duel Endless and Match history, which `/arena` does not list.

---

## 15. Final `git status --short`

Captured after the final verification run:

```
 M PEAK3_UX_ORGANIZATION_POLISH_CLAUDE_PASS.md
 M apps/api/app/api/v1/meta.py
 M apps/api/app/api/v1/peaks.py
 M apps/api/app/api/v1/perfect_season.py
 M apps/api/app/api/v1/seasons.py
 M apps/api/app/models/perfect_season.py
 M apps/api/app/services/perfect_season/serialization.py
 M apps/api/app/services/perfect_season/state.py
 M apps/api/app/services/run_the_table/public.py
 M apps/api/tests/conftest.py
 M apps/api/tests/test_perfect_season.py
 M apps/api/tests/test_regression.py
 M apps/web/src/app/(main)/arena/page.tsx
 M apps/web/src/app/(main)/page.tsx
 M apps/web/src/app/(main)/rankings/page.tsx
 M apps/web/src/components/court/CourtBuilder.tsx
 M apps/web/src/components/court/SpinStage.tsx
 M apps/web/src/components/layout/nav.tsx
 M apps/web/src/components/run-the-table/BattleReveal.tsx
 M apps/web/src/components/run-the-table/BossPreview.tsx
 M apps/web/src/components/run-the-table/ChoiceNode.tsx
 M apps/web/src/components/run-the-table/DraftRoom.tsx
 M apps/web/src/components/run-the-table/LaneProfile.tsx
 M apps/web/src/components/run-the-table/MobileTray.tsx
 M apps/web/src/components/run-the-table/NodeChoice.tsx
 M apps/web/src/components/run-the-table/RunCard.tsx
 M apps/web/src/components/run-the-table/RunMap.tsx
 M apps/web/src/components/run-the-table/RunProgressStrip.tsx
 M apps/web/src/components/run-the-table/RunResult.tsx
 M apps/web/src/components/run-the-table/RunStartGate.tsx
 M apps/web/src/components/run-the-table/RunTheTableGame.tsx
 M apps/web/src/components/run-the-table/RunTray.tsx
 M apps/web/src/components/run-the-table/SystemSelect.tsx
 M apps/web/src/components/run-the-table/TradeDesk.tsx
 M apps/web/src/components/shared/GameCard.tsx
 M apps/web/src/lib/api.ts
 M apps/web/src/lib/modes.ts
 M apps/web/src/lib/perfect-season-api.ts
 M apps/web/src/lib/run-the-table-state.ts
 M apps/web/src/styles/globals.css
 M apps/web/src/tests/e2e/courtbuilder.spec.ts
 M apps/web/src/tests/e2e/daily-grid.spec.ts
 M apps/web/src/tests/e2e/gameplay.spec.ts
 M apps/web/src/tests/e2e/play-routing.spec.ts
 M apps/web/src/tests/e2e/progression.spec.ts
 M apps/web/src/tests/e2e/rankings.spec.ts
 M apps/web/src/tests/e2e/run-the-table.spec.ts
 M apps/web/src/tests/unit/court-state.test.ts
 M apps/web/src/tests/unit/run-the-table-components.test.tsx
 M apps/web/src/tests/unit/run-the-table-state.test.ts
 M apps/web/src/tests/unit/spin-reel.test.ts
 M apps/web/src/types/index.ts
 M apps/web/src/types/perfect-season.ts
 M apps/web/src/types/run-the-table.ts
 M nba_peak/perfect_season/board.py
 M nba_peak/perfect_season/config.py
 M nba_peak/perfect_season/schemas.py
 M nba_peak/run_the_table/config.py
 M scripts/build_web_dataset.py
?? apps/web/playwright.ux-polish-shots.config.ts
?? apps/web/src/components/home/
?? apps/web/src/components/layout/MobileNavDrawer.tsx
?? apps/web/src/components/layout/PlayMenu.tsx
?? apps/web/src/components/rankings/RankingsProvenance.tsx
?? apps/web/src/components/rankings/board-copy.ts
?? apps/web/src/components/ui/
?? apps/web/src/lib/a11y.ts
?? apps/web/src/lib/motion.ts
?? apps/web/src/lib/nav-model.ts
?? apps/web/src/lib/resume-state.ts
?? apps/web/src/lib/run-the-table-copy.ts
?? apps/web/src/lib/tour-state.ts
?? apps/web/src/styles/home.css
?? apps/web/src/styles/nav.css
?? apps/web/src/styles/rankings.css
?? apps/web/src/styles/rtt-polish.css
?? apps/web/src/styles/spinner.css
?? apps/web/src/styles/tour.css
?? apps/web/src/tests/tools/capture-ux-polish-shots.ts
?? apps/web/src/tests/unit/guided-tour.test.tsx
?? apps/web/src/tests/unit/home-launcher.test.tsx
?? apps/web/src/tests/unit/nav-components.test.tsx
?? apps/web/src/tests/unit/nav-model.test.ts
?? apps/web/src/tests/unit/rankings-provenance.test.ts
?? apps/web/src/tests/unit/tour-state.test.ts
?? apps/web/src/tests/unit/trade-desk.test.tsx
?? apps/web/src/tests/unit/ui-primitives.test.tsx
?? docs/implementation/RANKINGS_SYNC_REPORT.md
?? docs/implementation/UX_ORGANIZATION_POLISH_PLAN.md
?? docs/implementation/UX_ORGANIZATION_POLISH_REPORT.md
?? docs/implementation/spinner-audit.json
?? docs/implementation/ux-polish-review/
?? scripts/audit_spinner_reroll_policy.py
```

HEAD is still `efaeff4a5c00b12c8f8c3ed4bd03cf0221609f17`. `git stash list` is empty.
`git status --short peak3.py nba_peak/leaderboards.py leaderboards/` returns nothing.

---

## 16. Canonical methodology confirmation

`peak3.py`, `OFFICIAL_WEIGHTS` (statistical_impact 0.38, traditional_production 0.21,
recognition 0.20, postseason 0.18, team_achievement 0.03), `calibrate_score()`,
`nba_peak/leaderboards.py` and every file under `leaderboards/` were **not modified**.
No leaderboard row was hand-edited. Verified in §15's `git status --short`.

---

## 17. Repository-history confirmation

No `git commit`, `git push`, pull request, merge, rebase or `git stash` was performed at
any point. The entire pass is left as an unstaged working-tree diff for review.
