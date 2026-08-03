# VERIFICATION PLAN — Phase 5 Adversarial Harness

**Owner:** product-director. **To be executed by:** product-director, at Phase 5, against the
shipped implementation on `feature/arena-rtt-overhaul`. **Status now:** the plan itself —
read-only, documentation-only, written before any implementation lands so it cannot be shaped
around whatever gets built.

This document exists to be used against me as much as against anyone else. I wrote
`PRODUCT_EXPERIENCE_CONTRACT.md`; I do not get to verify my own contract's wording, only whether
the shipped product meets it. Two of my own recommendations were already overruled during
synthesis (`SYNTHESIS_CONTRACT.md` §1, §7) — that is the standard: evidence overrides authorship,
including mine.

**Operating principle: every method below is a falsification attempt, not a confirmation
checklist.** A method that only checks "does the feature exist" is not on this list. Every method
here specifies what a shipped implementation would have to do to make the check fail, and how to
tell the difference between "actually correct" and "looks correct in the one condition someone
remembered to test."

---

## 0. Scope, inputs, and non-negotiables

**Binding source documents**, in authority order per `SYNTHESIS_CONTRACT.md` line 4-6: where they
disagree, the later one in this list wins.
1. `PRODUCT_EXPERIENCE_CONTRACT.md` (this workstream's contract, as corrected by the two rulings)
2. `SCORE_RECONCILIATION.md` (score/label arbitration)
3. `SYNTHESIS_CONTRACT.md` (Phase 2 gate — binds all four teammates)

**What I verify:** the shipped code on the integration branch, against the 21-item acceptance
checklist in `PRODUCT_EXPERIENCE_CONTRACT.md` §11 (as corrected), plus the explicit auto-rejection
triggers in §4 below, plus the cross-cutting hard cases the lead named directly.

**What I do not verify:** whether the contract's wording itself was the right call — that
question was already settled at Phase 2. I verify conformance, not policy.

**Verdict taxonomy** — every row in `VALIDATION_MATRIX.md` closes as exactly one of:

| Verdict | Meaning | Who may assign it |
|---|---|---|
| `PASS` | Falsification method run, could not break the claim | product-director, with method + evidence cited |
| `FAIL` | Falsification method run, broke the claim | product-director, with method + evidence cited |
| `NOT RUN` | Method could not be executed in this environment (state the concrete reason: no real Postgres, no hosted deploy, tool unavailable) | product-director — never silently blank |
| `BLOCKED` | Reserved for exactly one item: the asset-license flag-flip (§5). An external, non-engineering legal decision, out of this pass's authority. | product-director, only for that item |

**"Future work" is not a verdict.** Nothing else on the checklist may close as deferred,
out-of-scope-for-now, or a follow-up ticket. If a claim was not built, it is `FAIL`. If it was
built but not testable in this environment, it is `NOT RUN` with the reason stated — not treated
as passing by omission. `VALIDATION_MATRIX.md`'s own header states this: "Unit tests alone do not
constitute success for this pass," and a blank cell is explicitly listed as unacceptable.

---

## 1. Instrumentation

Every method below assumes this toolchain, all either already in the repo or standard Playwright
capability — no new dependency is required to execute this plan:

- **Playwright** (`apps/web/playwright.config.ts` already configured, Chromium + a `@mobile`
  Pixel 5 project) driving the actual staging or locally-served app — never a component in
  isolation, since the claims under test (payload gating, network round-trip counts, timing) are
  properties of the integrated system.
- **`page.on('request')` / `page.on('response')`** for network-level capture — the strongest
  instrument in this plan, used for the reveal-leak check, the round-trip-count check, and the
  perf-script cross-check. Raw response bodies are read, not just status codes.
- **`page.emulateMedia({ reducedMotion, colorScheme })`** for reduced-motion and theme-emulation
  conditions, so every timing/CSS claim is checked under the actual media-query condition, not
  simulated by reading source.
- **`page.accessibility.snapshot({ interestingOnly: false })`** — the `false` is load-bearing: the
  default `true` hides exactly the nodes a leak would hide behind (`aria-hidden`, zero-size,
  `display:none`). Every accessibility-tree assertion in this plan uses the full, uninterested
  snapshot.
- **`page.content()`** (full serialized HTML, all nodes, regardless of CSS visibility) alongside
  `page.locator(...).isVisible()` (the visible-only view) — every DOM-leak check runs against
  both and states which one caught what.
- **`getComputedStyle`** via `page.evaluate` for CSS-level truth (`transitionDuration`,
  `animationDuration`, `background-color`) — never inferred from source file inspection alone,
  since the computed value is what actually ships to the browser.
- **`scripts/perf/measure_rtt.py`**, the committed measurement script (confirmed present,
  documented, already produced a real baseline — `PERFORMANCE.md`, `perf-raw/staging-baseline.
  {json,md}`, timestamped `2026-08-03T06:36:15Z`) — the sole instrument for any performance claim.
- **axe-core**, already wired for `e2e/accessibility.spec.ts` — reused, not reimplemented, for
  contrast/focus/name-computation assertions.
- A small standalone luminance/contrast script (WCAG relative-luminance formula) for the theme
  checks in §3.D — this is arithmetic on `getComputedStyle` output, not a new testing framework.

---

## 2. Per-checklist-item falsification methods

Each row: the claim as corrected in `PRODUCT_EXPERIENCE_CONTRACT.md` §11, the method that would
break it if it's false, and the objective pass/fail line. Items with a full worked methodology
live in §3 and are cross-referenced rather than repeated.

| # | Claim | Falsification method | Objective fail line |
|---|---|---|---|
| 1 | Opening reveal shows zero names/windows/scores anywhere (UI or a11y) before the player's first reveal action | §3.A | Any real identity string found in response body, `page.content()`, or full a11y snapshot before that slot's `reveal_index` |
| 2 | One user action starts the reveal; no further click required | §3.B | More than one Playwright-issued interaction required to reach 7/7 revealed on the default path |
| 3 | Total reveal time 8-12s unpaused, unskipped | §3.E | Externally-timed median outside [8000, 12000] ms across ≥5 runs |
| 4 | Reduced motion completes in a single frame, correct final roster | §3.F | Any computed `transitionDuration`/`animationDuration` ≠ `0s` during the sequence, or `t1-t0` ≥ 100ms |
| 5 | Lineup rating vs. top contributor never share an unlabeled/ambiguous number, at any viewport/zoom incl. 200%/390px | §3.C | Two numbers with no independently-associated accessible name, or DOM/bounding-box overlap, at any tested condition |
| 6 | Boss cinematic has named intro, win condition, 3-2-1 countdown, skip control, before lineup reveal begins | Playwright: assert DOM order — countdown/intro elements mount and the skip control is interactive (not merely present but `disabled`) before the first lineup card renders; assert skip actually short-circuits to the lineup screen when clicked mid-countdown | Skip present but inert, or lineup content reachable/inferable before the countdown resolves |
| 7 | Boss lineup reveal uses the identical 9-step grammar as the opening reveal (shared component/hook, not visual similarity) | Static: diff the component/hook import graph — both call sites must import the same reveal-sequencing module. Dynamic: assert both surfaces expose the identical sequence of `data-reveal-step` (or equivalent) attribute values in the same order | Two independently-implemented sequences that merely look similar; any step present in one but absent in the other |
| 8 | Exactly one dominant decision surface at every viewport, map/tray measurably quieter | Compare computed `box-shadow`/elevation token and font-size between the decision surface and the map/tray at each viewport in the visual matrix; assert decision surface's elevation tier and type scale are strictly greater | Map or tray matches or exceeds the decision surface's elevation/type weight at any tested viewport |
| 9 | Run map shows ≤2 stages of unreached future content expanded by default | DOM query: count rendered (non-collapsed, non-summary) future-stage rows beyond the current position; assert ≤2, with everything else behind a documented history-drawer/expand control that is itself keyboard-operable | >2 expanded future rows, or a "collapsed" state that still renders full row content merely visually truncated (still present in DOM/a11y tree) |
| 10 | Roster dock defaults collapsed outside active reveal; fully concealed during active reveal, regardless of user preference | Load a mid-run state with no reveal active: assert dock renders avatar+score only, not full rows, by default with no prior user toggle. Load a run mid-reveal: assert dock shows zero card content for unrevealed slots even if a "show detail" preference was set in a prior session (localStorage/cookie pre-seeded before navigation) | Any full-detail row rendered by default outside a reveal, or a persisted preference overriding concealment during an active reveal |
| 11 | Result screen's verdict is the single largest, highest-contrast element, above the fold, before any highlight card | Compare computed `font-size`/contrast ratio of the verdict element against every other text node above the first highlight card in DOM order; assert verdict is measurably the largest AND first | Any other element above the first highlight card exceeds the verdict's font-size, or the verdict is not the first content node |
| 12 | Result screen includes a negative-framed highlight whenever data supports one | Run against a fixture/seed known to have a negative-`score_delta` acquisition or trade (already have 3 pinned seeds from Phase 1-A); assert a "largest mistake" (or equivalently named) section renders with that transaction's real delta, not a placeholder | Section absent, or present but showing a positive/neutral transaction when a negative one exists in the receipt |
| 13 | Result screen states leaderboard placement or explicit "not ranked yet," never silently omits | Assert the section is present in the DOM for both an eligible and an ineligible run (RTT currently has no leaderboard contract per `SCORE_RECONCILIATION.md` §"Mode separation" — the correct state right now is the explicit "not ranked yet," and its ABSENCE is the fail condition, not the absence of a real ranking) | Section missing entirely from the DOM |
| 14 | Result screen offers a real shareable visual card, not clipboard text alone | Trigger the share action; assert an image/canvas element or exported asset is produced (e.g. a `canvas.toDataURL()` call, a rendered `<img>` with real pixel content, or a download), distinct from the existing clipboard-text `Copy summary` action, which must also still work | Only clipboard text is produced; "share card" is a re-label of the existing text button |
| 15 | Theme toggles with zero FOUC, no hydration warning | §3.D method 8: load with a pre-set `light` cookie/localStorage value BEFORE first paint (simulate returning visitor), screenshot the very first rendered frame (`page.screenshot()` immediately on `domcontentloaded`, before any `load`/hydration event), assert it already matches the light theme, not a dark-then-light flash; capture browser console for React hydration-mismatch warnings across both cold-light and cold-dark loads | Any frame captured before hydration shows the wrong theme, or a hydration warning appears in console |
| 16 | Every frozen token is byte-identical across themes | §3.D method 6 | Any of the listed frozen tokens differs in hex value between `[data-theme="dark"]` and `[data-theme="light"]` |
| 17 | Every new text/background pairing (both themes) meets WCAG AA contrast | axe-core full-page scan in both themes on every touched screen, plus manual spot-computation for any pairing axe cannot reach (e.g. text inside a canvas-rendered share card) | Any pairing below 4.5:1 (body) / 3:1 (large text, UI component) |
| 18 | Every new control: visible focus ≥3:1 contrast, ≥44px target, full keyboard operability | Tab through every new control via `page.keyboard.press('Tab')` in sequence, assert focus lands on each in a sensible order and `getComputedStyle` shows a non-`none` outline/box-shadow meeting contrast; assert `boundingBox()` height/width ≥44px; operate each control via `Enter`/`Space` alone, no mouse | Any control unreachable by Tab, focus indicator absent/low-contrast, target <44px, or a mouse-only affordance |
| 19 | Screen-reader users reach complete correct final state via live region for every cinematic, no reveal leakage in a11y text | §3.A (leakage half) + live-region content assertion: capture the `aria-live` region's final text content after each cinematic and assert it states the complete, correct outcome (matching the visual state), mounted-empty-then-filled per the existing `BattleReveal` pattern (assert the region is empty at mount and filled only after the corresponding visual state resolves, never pre-filled) | Live region missing, pre-filled before the visual reveal, or omitting information present visually |
| 20 | No scoring/pricing/legality/eligibility/randomness decision moved to the client | Diff the network request/response pairs before and after: same server calls, same consumed fields; grep any new client code for arithmetic that recomputes a score/price/legality value already present on the wire rather than reading it; specifically re-verify the `lane_rating`/`top_contributor` numbers are both server-sourced fields (§3.C method 2), never one derived from the other in TypeScript | Any new client-side computation of a value the server already returns, or a new value invented client-side with no server field backing it |
| 21 | Homepage: frozen invariants hold AND reads as an arena entrance under the full adopted scope | §3.G, plus a direct re-check of the frozen invariants list (`UX_ORGANIZATION_POLISH_PLAN.md` §3.4): exactly one `<h1>` containing the frozen sentence, exactly one `[data-featured="true"]`, `MODE_COPY` still the sole copy source, every listed `data-testid` present | Any frozen invariant broken, or the structural directory-criterion in §3.G fails |

---

## 3. Deep-dive methodology — the eight named hard cases

### 3.A No reveal leak — including CSS-hidden and aria-hidden leaks

Three independent surfaces are checked, because a leak can hide behind any one of them while
passing the other two, and the contract's language ("anywhere in the visible UI OR accessibility
text") only names two of the three real vectors:

1. **Network response body (the strongest check — catches a leak the DOM never even has to
   render).** Capture every `GET .../runs/{id}` and `POST .../runs/{id}/actions` response from run
   creation through `reveal.roster.complete`. Parse the JSON. For every slot in `starters[]`/
   `bench[]` whose index is ≥ the current `reveal_index`, assert `card === null` (per the
   corrected backend contract in `SYNTHESIS_CONTRACT.md` §2.1: concealed slots serialize shape
   only — `slot_id`, `role`, `is_starter`, `card: null`). Also assert the top-level `lane_profile`/
   `roster_total`/`bench_weight` block is computed over revealed slots only and carries
   `partial: true` until the reveal completes (the "lower-severity variant" the audit already
   flagged). **This single check makes a CSS-only "fix" (hiding leaked data with `display:none`)
   structurally unable to pass** — if the payload itself carries the identity, this check fails
   regardless of how the client renders it, which is the correct outcome: a determined player
   opening devtools' Network tab sees it either way.
2. **Full DOM, all nodes, regardless of computed visibility.** `page.content()` (raw HTML) and
   `page.evaluate(() => document.body.innerText)` with a forced style override
   (`* { display: revert !important; visibility: visible !important; opacity: 1 !important; }`
   injected via `page.addStyleTag` immediately before the read) — this specifically defeats
   `display:none`/`visibility:hidden`/`opacity:0` concealment attempts and proves whether the
   string is in the document at all, not merely unpainted. Assert none of the 7 known real names/
   window labels/scores (obtained from a prior full-run network capture on the same seed, used
   only as ground truth for the assertion, never rendered to a live player) appear anywhere in
   this dump for a slot not yet at its reveal step.
3. **Full accessibility tree, `interestingOnly: false`.** Assert none of the same strings appear
   in any node's computed `name`/`description`/`value`, including nodes marked `hidden` in the
   snapshot — `aria-hidden="true"` removes a node from what a screen reader announces by default,
   but the string is still present in the served accessibility tree and still discoverable by
   assistive tech configured to include hidden content, or by a browser extension, or simply by
   viewing page source. A leak concealed only by `aria-hidden` is a fail here even though it would
   pass a naive "does the screen reader announce it" test.

Concealed-slot placeholder check (positive assertion, not just absence): every concealed slot must
render `aria-label="Not revealed yet"` (the existing `RevealReel.tsx:145-152` pattern) in **every**
component that can render that slot — the roster dock/rail included, not only the reveal surface
itself. Grep for this exact pattern (or its successor) at every render site that consumes
`starters`/`bench`, not just `RevealReel`.

### 3.B One user action, automatic queueing — proving no disguised click-through

1. Drive the sequence with the test harness issuing **exactly one** interaction (a single
   `page.click()` on the start control), then perform no further `page.click()`/`page.keyboard.
   press()` calls whatsoever, and `await` a promise that resolves on the reveal-complete DOM
   signal. If the promise never resolves without a second synthetic interaction, the claim is
   false — this is checked by literally not providing the second interaction and asserting the
   test still passes.
2. In parallel, capture network requests during the same window. Under the corrected architecture
   (`SYNTHESIS_CONTRACT.md` §2.2 — one batched `reveal("roster", 7)` call, paced client-side from
   already-committed data), assert exactly **one** `action_type: "reveal"` POST fires for the
   entire sequence. If more than one fires, verify each additional one is NOT gated behind
   anything that only a user click could satisfy — inspect the call stack / trigger source in the
   app's own code path (should be a `setTimeout`/animation-frame callback, never inside a click
   handler) to distinguish "auto-paced but chatty" from "click-through disguised as auto-pacing."
   A chatty-but-truly-automatic implementation is a performance finding (§2 item covered
   elsewhere), not a §3.B falsification; a click-gated one is a direct falsification of "automatic
   queueing."
3. Explicit disguise check: after the first click, actively **prevent** any further input from
   having an effect the test could accidentally provide — move the mouse off any actionable
   element and never invoke another synthetic event — and confirm completion regardless. This is
   the direct test for "looks automatic in a demo where someone clicks along with it anyway, but
   secretly requires the click."

### 3.C Lineup rating vs. top contributor — including 200% zoom and 390px re-stacking

1. **Programmatic association, not proximity.** For each lane, locate the `YOUR LINEUP RATING`/
   `BOSS LINEUP RATING` value node and the `TOP CONTRIBUTOR` value node independently. Compute
   each node's accessible name via `page.accessibility.snapshot()` or axe's name-computation and
   assert the lineup-rating node's computed name/description contains "lineup rating" and the
   contributor node's contains "top contributor" — this must hold via `aria-label`,
   `aria-labelledby`, or adjacent semantic markup, not merely CSS proximity that a screen reader
   or a re-stacked layout could sever.
2. **Independent value proof.** Confirm the two values are backed by different response fields
   (`lane_rating` and `top_contributor.own_lane_index_value` per `SYNTHESIS_CONTRACT.md` §2.3) by
   reading the network response directly — and confirm that in at least one captured lane the two
   numbers actually differ, which proves the contributor value is not silently copied from the
   lineup rating (a regression that would be numerically invisible if the two values always
   happened to match).
3. **Geometric proof at the two named stress conditions.** At 200% browser zoom (`page.
   setViewportSize` combined with CSS zoom emulation, or CDP `Emulation.setDeviceMetricsOverride`
   with a `deviceScaleFactor` proxy for zoom, per WCAG 1.4.10 reflow testing convention) and at
   390px width (the narrowest tile in the existing visual matrix), pull `boundingBox()` for both
   value nodes and both label nodes. Assert: (a) the two value boxes never overlap, (b) each
   value's own label box remains adjacent to it (not reflowed to associate with the other value),
   and (c) neither label is dropped from the DOM at this width (grep for `display:none` applied to
   either label specifically at this breakpoint — a narrow-viewport "hide the label to save space"
   shortcut is exactly the regression this check exists to catch, since it would silently restore
   the original ambiguity at the one width most likely to be tested casually).
4. **Screenshot cross-check.** Full-page (not viewport-clipped) screenshots at both stress
   conditions, manually reviewed to confirm the DOM-level proof matches what a human eye actually
   sees — the geometric check proves no overlap in the box model, the screenshot proves no
   *visual* ambiguity (e.g. two numbers that don't technically overlap but sit close enough with
   similar styling to misread as one, which a bounding-box check alone would not catch).

### 3.D Light mode — objectively "not inverted," not a subjective look

1. **Extraction.** In both `data-theme="dark"` and `data-theme="light"`, read the computed value
   of every listed token (`--bg-page`, `--bg-elevated`, `--bg-surface`, `--peak-accent`, all
   `--comp-*`) via `getComputedStyle(document.documentElement).getPropertyValue(...)`.
2. **Relative luminance.** Convert each sRGB value to WCAG relative luminance
   (`L = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin` with the standard gamma linearization).
3. **Elevation-ordering check (must hold in both themes, independently computed):** assert
   `L(bg-page) < L(bg-elevated) < L(bg-surface)` in dark mode (ascending brightness = ascending
   prominence against a near-black base) and assert the analogous ordering — each tier
   distinguishable from its neighbor by a stated minimum luminance delta — holds in light mode on
   its own terms. This is the falsifiable form of "the three-tier elevation stack must remain
   legible in both themes" (`SYNTHESIS_CONTRACT.md` §3).
4. **"Not merely inverted" numeric test.** For each token, compute the naive per-channel
   inversion of its dark-mode value (`255-R, 255-G, 255-B`) and compare in Lab color space against
   the *actual* shipped light-mode value for the corresponding surface role. If the shipped value
   sits within a small ΔE tolerance (e.g. ΔE < 2) of the naive inversion for more than one or two
   of the surface tokens, the palette is, in substance, an inversion regardless of what it's
   called — FAIL. Independently, grep all shipped CSS for a literal `filter: invert(` applied to
   any theme root or surface — an automatic FAIL if present, no numeric test needed.
5. **Frozen-value check (opposite polarity — must be identical, not different).** `--peak-accent`
   and every `--comp-*` token must be byte-identical hex strings across both themes — verified the
   same extraction pass as step 1, compared for equality rather than difference.
6. **Structural-deployment check.** Per the contract's "glow in Arena Night, solid fill/underline
   in Arena Day" requirement: grep the shipped, theme-scoped CSS/component styles for
   `box-shadow` rules referencing `--peak-accent`/`--comp-*` that remain active (unscoped to dark)
   versus new solid-fill (`background-color: var(--peak-accent)`) or `text-decoration: underline`
   rules that are light-theme-specific. FAIL if the light theme's entire diff from dark is
   contained within the `:root[data-theme="light"] { --token: value; }` token block alone, with
   zero additional theme-conditional rules anywhere else in the stylesheet — that shape is, by
   construction, "recolor everything, restructure nothing," which is the substance of "merely
   inverted" independent of whether the specific colors are a mathematical inversion.
7. **Contrast re-verification, independently per theme.** Every text/background pairing
   introduced by the overhaul is re-measured for WCAG AA in light mode on its own — never assumed
   to pass because the dark-mode equivalent passed.
8. **FOUC/hydration check.** Pre-seed the theme preference (cookie/localStorage) to `light` before
   navigation, then capture the screenshot at `domcontentloaded` (before the `load`/hydration
   event) and assert it is already the light theme — a dark-then-light flip visible in that first
   frame is a FOUC failure. Separately, load cold with no stored preference under both
   `page.emulateMedia({ colorScheme: 'dark' })` and `'light'` and capture the browser console for
   any React hydration-mismatch warning.

### 3.E 8-12 second reveal — externally timed, not self-reported

`t0` = harness timestamp at the single triggering interaction. `t1` = harness timestamp at the
observed reveal-complete DOM signal (polled via `MutationObserver` bridged to a Playwright
promise, not read from any in-app "time elapsed" text). Never read a duration the application
itself prints to a log or a UI element — that number could be wrong independent of the actual
wall-clock behavior. Run ≥5 times from a cold run each; report the full distribution and require
the **median** in [8000, 12000] ms, not a cherry-picked sample. Run once under CPU throttling
(`Emulation.setCPUThrottlingRate`) — if total duration shifts by more than ~20%, that indicates
timing is coupled to JS execution rather than declarative, compositor-driven animation, which is
worth flagging even where the raw duration still happens to land in range. Cross-check against the
network capture from §3.B to confirm the measured window is not secretly dominated by a
still-per-card round trip.

### 3.F Reduced motion — zero duration, not merely shortened

`page.emulateMedia({ reducedMotion: 'reduce' })`, then repeat the §3.E timing capture: total time
must be near-zero (a hard ceiling, e.g. <100ms — one render/layout pass, not an animation, however
short). The literal CSS-level falsification: for every element/class participating in each
cinematic beat, read `getComputedStyle(el).transitionDuration` / `.animationDuration` while the
media query is active, and assert each is exactly `"0s"`. A value like `"0.05s"` is still a FAIL —
`SYNTHESIS_CONTRACT.md` §5 states plainly that "the same animation, only shorter" is itself a
rejection, so the check must be able to distinguish "collapsed" from "merely fast," which only a
computed-duration read (not a stopwatch alone) can do. Verify per-beat, not only for the reveal as
a whole: roster reveal, boss intro/countdown, paired lineup reveal, lane resolution, and verdict
stamp are each checked independently, since a partial implementation could correctly zero one beat
and leave another running its full duration.

### 3.G Homepage is not a directory — an objective structural criterion

Reuses the exact diagnostic method `RTT_ARCHITECTURE_AUDIT.md`'s platform audit already applied to
the baseline (its own "eleven-plus card/tile/button targets below the hero" count), so before/after
are comparable by one consistent method rather than two different metrics invented at different
times:

1. **Zero navigation tiles above the fold.** At 1440×900 with no scroll, count DOM elements
   matching the clickable-navigation-tile shape (icon + title + description routing to another
   page/mode). Falsifying condition: any such tile visible in the first viewport.
2. **No catalog section within the first 100vh of scroll.** The adopted full scope's hero content
   (roster-vs-boss visual, rotating cards, comparison widget) must occupy that space instead.
3. **Genuine interactivity, not a static reskin.** The rotating cards must actually change content
   (two screenshots N seconds apart, diffed, must differ); the comparison widget's click-through
   must produce a real navigation or a real expanded panel with real data (assert a URL change or
   a populated detail node, not a dead click handler).
4. **The catalog must still exist, just subordinate — under-delivery is also a fail.** Verify the
   mode gallery and leaderboard preview sections are present further down the page; a homepage
   that deletes them to win the "not a directory" check fails the adopted full-scope requirement
   just as surely as leaving the directory at the top would.
5. Report the new above-the-fold tile count and catalog-section position using the same counting
   method as the baseline audit, so the delta is a real before/after number.

### 3.H Performance claims — same committed script, unmodified, or the claim is rejected

1. `git diff <baseline-commit> <claim-commit> -- scripts/perf/measure_rtt.py` must be empty. Any
   diff invalidates the comparison outright.
2. Same invocation flags as the baseline (`--samples 15 --runs 8 --courtbuilder-runs 8` against
   hosted staging for the staging comparison; the matching local-flags for any local comparison) —
   a smaller sample size invalidates the p95 comparison specifically.
3. Same environment class: hosted-staging-to-hosted-staging, never local-in-memory-to-staging (the
   "local is not comparable" caveat is already documented and binding — `PERFORMANCE.md`).
4. Any performance claim not accompanied by a raw JSON/MD output from this exact script, with its
   own `meta.timestamp_utc` and matching flags, is an automatic rejection per §4 below — including
   an honest-sounding "tested it locally and it felt faster."
5. Specifically re-check the three targets `SYNTHESIS_CONTRACT.md` §6 names: the opening-reveal
   round-trip count (baseline 7 → target 1, verified via network capture, not claimed), the flat
   ~365-375ms write-path floor on every RTT action POST (report honestly as infrastructure-bound
   and unchanged unless a real measured improvement exists — claiming improvement without a number
   is a rejection, not merely "optimistic"), and `getAccessToken()` memoization (verify by
   comparing request counts for a **signed-in** playthrough before vs. after — the baseline
   explicitly could not measure this for a signed-in player and that gap must be closed in the
   after-measurement, not left unmeasured a second time).

---

## 4. Explicit Phase 5 auto-rejection triggers

Any one of the following, found anywhere in the shipped diff, is an automatic rejection of the
relevant workstream's output — independent of whether its own tests pass. Method to detect each:

| Trigger | Detection method |
|---|---|
| Reveal that still leaks identities | §3.A, all three surfaces (network body, full DOM, full a11y tree) |
| Manual click-through disguised as cinematic | §3.B, the "no second interaction" and "disguise" checks |
| Lineup ratings labeled like player values | §3.C — any lineup-wide number rendered with only an individual's name adjacent and no independent "lineup rating" label/accessible name |
| Light mode that is merely inverted | §3.D, methods 4 and 6 (numeric-inversion test and structural-deployment test) |
| Homepage that remains a directory | §3.G |
| Leaderboard with client-provided score | Intercept and mutate any score-bearing field in a leaderboard submission request body before it reaches the server (a tampering replay); assert the stored/displayed entry reflects the server-recomputed value, never the tampered one. Per `SCORE_RECONCILIATION.md` §5, `SubmitRunRequest` carries only `game_id` today — re-verify this remains true for any new RTT leaderboard surface built in this pass, not only the existing 82-0 one |
| Performance claims without measurements | §3.H |
| Tests asserting markup but not interaction | Audit new/changed test files: flag any test on an interactive control (reveal pause/skip, theme toggle, replay, roster-dock expand) that only asserts on rendered markup/snapshot with no preceding `fireEvent`/`userEvent`/`page.click` and no assertion on the resulting state change |
| Screenshots that hide overflow | For every visual-matrix screenshot: verify `fullPage: true` (or equivalent full-scroll capture) was used, not a viewport-clipped capture; verify no capture-time CSS override (`overflow: visible !important` injected only for the screenshot) was applied — diff the computed `overflow` of the captured container against production CSS |
| Retry-based ownership fixes | For any new/changed ownership-sensitive endpoint (leaderboard submission, run creation, challenge creation): send the **first** request only, no retry, with a signed-in session; assert correct ownership (`owner_sub == auth.sub`) on that first attempt. Reject any implementation whose own test suite only demonstrates correctness after a second attempt |
| CSS disabling focus or motion preferences | Grep shipped CSS for `outline:\s*none`/`outline:\s*0` with no adjacent `:focus-visible` replacement in the same rule; grep for any `!important` override that forces animation duration regardless of `prefers-reduced-motion: reduce`, or forces a theme regardless of `prefers-color-scheme` on first, unconfigured load |
| Legal/asset assumptions presented as fact | Grep any implementation report/PR text for "cleared"/"licensed"/"approved" applied to player or team imagery; cross-check the manifest's `license_status` field is still `unknown_do_not_cache` (unless an explicit, out-of-band legal decision is cited and linked — this pass has no authority to make that decision itself); verify `PEAK3_ENABLE_EXTERNAL_ASSET_URLS` still defaults `False` in shipped config |

---

## 5. BLOCKED vs. FAIL — the one legitimate exception

The asset-licensing question — flipping `PEAK3_ENABLE_EXTERNAL_ASSET_URLS` on for public use — is
the **only** item in this entire plan permitted to close as `BLOCKED` rather than `PASS`/`FAIL`.
Reason: every resolved asset in the committed manifest self-declares
`license_status="unknown_do_not_cache"` and `cache_policy="dev_hotlink_preview_only"` — this is
not an engineering gap, it is an external, non-engineering legal decision (whether PEAK3 has
rights to redistribute NBA player/team imagery) that no amount of code review can resolve. Per
CLAUDE.md's own design principle ("No player photographs, no NBA/team logos (unlicensed)"), the
correct, verifiable state for this pass is: the flag stays off, the deterministic initials-on-
gradient fallback (`PlayerAvatar.tsx`) remains the live default path, images are never structurally
required (RTT renders zero images regardless per `RTT_ARCHITECTURE_AUDIT.md`'s own grep), and no
report states the licensing question as resolved. **If all of that holds, this item closes
`BLOCKED` with that reasoning attached — not `PASS` (the underlying question isn't resolved) and
not `FAIL` (there is nothing for engineering to have built differently).**

Everything else on the checklist is engineering work with a knowable, testable answer. "We ran out
of time," "that's a good idea for later," or "the harder viewport wasn't tested" are not `BLOCKED`
— they are `FAIL`, or `NOT RUN` with the specific environmental blocker stated (e.g., "requires a
real Postgres test project," matching the existing, already-honest `NOT RUN` entries in
`VALIDATION_MATRIX.md` for `api-integration-tests.sh`). The distinction that matters: `BLOCKED` is
for questions outside engineering's authority to answer at all; `NOT RUN` is for checks this
environment cannot currently execute but could in principle; `FAIL` is everything else that isn't
done or doesn't hold up under the falsification method.

---

## 6. Execution protocol (for the actual Phase 5 run)

1. Confirm the target: the integration branch (`feature/arena-rtt-overhaul`) after Phase 4
   integration, not any individual teammate's worktree — cherry-pick order and conflicts are
   Phase 4's problem to have already resolved.
2. Re-pull `BASELINE.md`'s recorded state (branch, commit, flag values, canonical hashes) and
   diff against the current HEAD before starting, so any drift since Phase 0 is visible up front.
3. Run every method in §2/§3 against both hosted staging (`https://peak3-staging.vercel.app` /
   `https://peak3-staging.up.railway.app`, per `BASELINE.md`) and, where a real Postgres-backed
   environment is unavailable, note the substitution explicitly rather than silently testing
   against the in-memory backend and calling it equivalent (per the "local is not comparable"
   caveat already established for performance, which generalizes: any ownership/RLS/persistence
   check specifically needs the real backend, not memory-mode).
4. Log every result directly into `VALIDATION_MATRIX.md`'s existing rows — this plan does not
   invent a second scoring surface; it is the method book the matrix's `Status` column is filled
   in from. Where a matrix row doesn't yet have a corresponding method (e.g. new rows added during
   implementation), add the method here first, then fill the row.
5. Every `FAIL` cites: the method used, the exact evidence (response body excerpt, DOM excerpt,
   screenshot, computed value, or command output), and the specific file:line or endpoint
   responsible where determinable — matching the evidentiary standard `PRODUCT_EXPERIENCE_CONTRACT
   .md`'s own audit table already set.
6. No item closes on a re-read of the implementer's own report. Every `PASS` is independently
   reproduced by running the method myself, not by trusting a teammate's stated result — this is
   the entire point of an adversarial pass being a separate phase from implementation.

---

## Repository evidence index (this document)

- `docs/implementation/rtt-overhaul/PRODUCT_EXPERIENCE_CONTRACT.md` §11 — the 21-item checklist
  this plan provides falsification methods for (as corrected).
- `docs/implementation/rtt-overhaul/SCORE_RECONCILIATION.md` §1-3, §5 — lane-label/field ruling
  and leaderboard "already correct" baseline table this plan's rejection triggers are built from.
- `docs/implementation/rtt-overhaul/SYNTHESIS_CONTRACT.md` §1-9 — binding contract this plan
  verifies conformance to.
- `docs/implementation/rtt-overhaul/BASELINE.md` — Phase 0 state, worktrees, staging URLs, known
  defects, and the constraints in force for this pass.
- `docs/implementation/rtt-overhaul/VALIDATION_MATRIX.md` — the row structure this plan's results
  are filed into.
- `PEAK3-agent-platform/docs/implementation/rtt-overhaul/PERFORMANCE.md` — the performance
  baseline and `scripts/perf/measure_rtt.py` usage this plan's §3.H is built from (not yet merged
  to the integration branch at time of writing; re-read from the integration branch once merged).
- `PEAK3-agent-rtt/docs/implementation/rtt-overhaul/RTT_ARCHITECTURE_AUDIT.md` §3, §5 — the
  identity-leak code proof and the homepage-as-directory diagnostic method this plan's §3.A and
  §3.G reuse (not yet merged to the integration branch at time of writing; re-read from the
  integration branch once merged).
