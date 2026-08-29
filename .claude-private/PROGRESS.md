# Arena Archive visual-polish program — progress

Branch: `feature/arena-archive-visual-polish`. Started from `4534534`
(tagged `backup/pre-visual-polish-2026-08-29`, pushed to origin).

## Status: in progress, staged deliberately across sessions

This is a large, incremental program by design — see
`docs/design/VISUAL_POLISH_PLAN.md`'s "scope decision" section for why (this
exact app has a documented history of visual passes causing gameplay
regressions; see that file's "critical context" section for the incident
list). Each batch below is independently committed and independently
verified; do not treat "the program" as done until
`docs/design/ROUTE_BEHAVIOR_MATRIX.md` has been worked through.

## Commits so far (chronological, all on `feature/arena-archive-visual-polish`)

| Commit | What |
|---|---|
| `f380691` | Phase 0 — baseline plan + backup tag recorded |
| `475c1c6` | Phase 2 — `ROUTE_BEHAVIOR_MATRIX.md` (full route/state map, grounded in actual imports/tests, not assumed) |
| `482f132` | Phase 1 — `REFERENCE_BOARD.md` (15-source research synthesis) |
| `d01223d` | Phase 3 — baseline test results recorded (all 4 gates green) |
| `f8dc9c8` | Phase 3 — bundle baseline recorded |
| `997208f` | Phase 6 — `.claude/rules/web-ui-preservation.md` (path-scoped, `apps/web/**`) |
| `4777a9f` | Phase 4 — `DESIGN_SYSTEM.md` + `VISUAL_RUBRIC.md` |
| `5bb5bf8` | Phase 5 — dependency audit (conclusion: no new deps needed) |
| `2bf9409` | **Batch 1**: RTT + 82-0 start-gate redesign (see below) |
| `bb936c6` | **Batch 2**: Ranked-mode + Daily Grid 1440px density (see below) |
| `b04c979` | Process fix — evaluator/investigation agent isolation (see below) |
| `49ad3ff` | **Batch 3**: RankedScreen + ranked leaderboard (see below) |
| `6635f35` | **Batch 4**: profile + progress + history (see below) |
| `bd704a7` | **Batch 5**: `/players/[slug]` PEAK3-native identity (see below) |

## Baseline (Phase 3, all green before any UI edit — see VISUAL_POLISH_PLAN.md for full detail)

Model tests 1859 passed/1 xfailed · API unit 1804 passed/2 skipped ·
frontend-verify 2240/2240 unit + clean build · Playwright e2e+axe 448
passed/1 skipped (27.8min). Bundle: 102kB shared JS baseline recorded per
route.

## Batch 1 — RTT + 82-0 start gates (DONE, verified, committed as `2bf9409`)

**Why this was first:** the Phase-3 screenshot-capture fork gave a
grounded, high-confidence finding — both start gates still read as a
settings/rules page (82-0 had a literal numbered `<ol>` with circular
badges; RTT buried its ruleset counts in a run-on sentence). This is the
single most concrete, bounded, high-value target in the whole matrix.

**What changed:** `PeakSeasonStartGate.tsx`'s numbered list became the same
`.v2-rtt-gate-nodes` grid grammar `RunStartGate.tsx` already used for its
four node types — one shared "roster-deal" grammar instead of two
different anti-patterns (system-level consolidation, not a new component).
`RunStartGate.tsx`'s acts/battles/lives sentence became scannable mono
instrumentation chips (`.v2-rtt-gate-stats`). Mobile: chips stack instead
of wrapping with an orphaned divider (`@media max-width: 560px`).

**What did NOT change:** every data-testid, every conditional-rendering
branch (meta-fetch-failure still drops `rtt-gate-acts`/`rtt-gate-lives`
exactly as before), `aria-pressed` on difficulty buttons, the exact
"place them on the court" substring `courtbuilder.spec.ts:1910` asserts on,
run/game creation logic, auth-loading gate, challenge-token flow — none of
it was touched, only the two components' JSX markup and `rtt.css`.

**Verification:** typecheck clean, lint 0 warnings, 2240/2240 vitest (96
files) both before and after the CSS follow-up fix, production build
(First Load JS for both routes byte-identical to the Phase-3 baseline:
289kB `/arena/run-the-table`, 261kB `/arena/court/daily/[mode]`),
`run-the-table.spec.ts` + `courtbuilder.spec.ts` 122/122 passed. Screenshots
at 390/1440 reviewed directly (not just "tests passed") before and after
the mobile-divider fix.

## Batch 2 — Ranked-mode + Daily Grid 1440px density (DONE, verified, committed as `bb936c6`)

**Why this was second:** the user explicitly scoped this batch (preserve
gameplay/API behavior; improve 1440px density/hierarchy without decorative
filler; keep mobile at least as good; reuse existing components/tokens;
don't read as a generic esports dashboard or make Daily Grid busier than
warranted) and asked for before/after screenshots plus an independent
evaluator pass before committing.

**Process note worth remembering:** the investigation fork launched for
this batch (asked to do read-only investigation + screenshot capture only)
went out of scope on its own and actually implemented the change — because
forks inherit the full conversation, and the user's message in this
conversation already contained the full batch spec, so it "helpfully" ran
ahead instead of just investigating. Caught by checking `git status`/`git
diff` immediately after its notification instead of trusting the summary.
The draft turned out to be good (grounded in real reused components, not
invented), so it was kept and put through the full verification pipeline
from scratch rather than discarded — but this is exactly the failure mode
future batches should watch for: **give fork prompts for read-only/
investigation steps a narrower scope than "whatever's in the conversation,"
and verify with `git status` after any fork returns, before trusting its
self-report.**

**What changed:** Ranked mode's header now uses the shared kicker+serif
pattern; a `RankedStandingRail` (xl+ only) shows real rating/division/
placement data from the same `rankedApi.getRating` the ranked hub already
calls. Daily Grid gets a `RecentResults` rail (xl+ only, reusing the
existing component from the completion panel/history page) gated on
`!complete && archive.entries.length > 0`. Mobile markup untouched in both
(`hidden xl:flex`).

**Regression the independent evaluator caught before commit:** the
refactor had moved the always-visible "{mode} · Ranked" in-game label into
the xl-only rail, silently dropping it below 1280px during actual
gameplay — a real regression with zero existing test coverage (no test
rendered the mid-game phase at all). Fixed by restoring it inline in the
always-visible round header, and added a new regression test
(`ranked-components.test.tsx`) that specifically renders the mid-game
phase and asserts the label is inside `ranked-main-content`, not only the
desktop rail. This is the second time in two batches that a mobile/narrow-
viewport defect only surfaced via direct visual/diff review, not the test
suite — the discipline of not treating "tests pass" as sufficient is
earning its keep.

**Verification:** typecheck clean, lint 0 warnings, 2241/2241 vitest (96
files, +1 regression test), production build (bundle deltas negligible:
`/arena/ranked/[mode]` +1kB, `/daily/grid` unchanged), `ranked.spec.ts` +
`daily-grid.spec.ts` + `accessibility.spec.ts` + `play-routing.spec.ts`
118/118 passed — run twice (before and after the mode-label fix), both
green. Before/after screenshots at 390px/1440px reviewed by a genuinely
independent fresh-context evaluator agent (not a fork of the builder).

## Process fix — evaluator/investigation agent isolation (`b04c979`)

Per explicit user instruction after Batch 2's fork went out of scope on its
own (see Batch 2 section above): fixed structurally, not with more prompt
prose. `.claude/agents/ui-evaluator.md` — a subagent type with `tools: Read`
only (harness-enforced allowlist) — for the pure-inspection evaluator role.
For the screenshot-capture/investigation role (needs Bash for Playwright, so
tool restriction can't apply): use a fresh non-fork agent + `isolation:
"worktree"` instead. Full detail in `docs/design/VISUAL_POLISH_PLAN.md`'s
"Process fix after Batch 2" section.

**Two real gotchas found putting this into practice in Batch 3, both worth
remembering:**

1. **Custom `.claude/agents/*.md` files are not picked up mid-session.**
   Tried to invoke `ui-evaluator` in this same session it was created in —
   the harness returned "Agent type 'ui-evaluator' not found", listing only
   the agents that existed at session start. The fix is committed and
   correct; it just doesn't activate until a fresh session (or whatever
   triggers the harness's agent-registry reload) picks it up. Worked around
   by using `general-purpose` + `isolation: "worktree"` for the rest of this
   session — a real technical isolation guarantee, just not the harness-
   enforced Read-only one, until a future session gets to actually use
   `ui-evaluator`.
2. **`Agent`'s `isolation: "worktree"` branches from `origin/<default-branch>`
   (i.e. `main`), not the caller's current branch/HEAD.** The Batch 3
   investigation fork ran in a worktree checked out from stale `main`
   (pre-batch-1-and-2) — its "before" screenshots and semantic inventory
   silently missed the kicker header and standing rail Batch 2 had already
   added. Caught by cross-checking `git merge-base --is-ancestor
   <batch2-sha> HEAD` inside the worktree, then re-capturing the actually-
   current state directly before trusting anything from that report as a
   literal baseline. **Whoever continues this: if you need a worktree-
   isolated agent to investigate the in-progress branch (not a fresh clone
   of main), verify what ref it actually landed on before trusting its
   findings as current — don't assume `isolation: "worktree"` gives you
   your own HEAD.**

## Batch 3 — RankedScreen + ranked leaderboard (DONE, verified, committed as `49ad3ff`)

**Scope, per the user's explicit instruction:** RankedScreen + closely
related ranked surfaces only (leaderboard, shared ranked components) — not
`/history`/`/profile`/`/progress` this batch.

**What changed:** every ad hoc `<button>` in `RankedScreen.tsx` → shared
`PeakV2PrimaryAction`/`PeakV2SecondaryAction`; `RankedResultView`'s outcome
word → `PeakV2ResultHeadline` (serif "moment" treatment), its numbers →
`.score-number` (mono/tabular), and its content → a constrained centered
`max-w-md` column (was floating unconstrained at 1024/1440); the leaderboard
page (`arena/ranked/[mode]/leaderboard`) — which had literally no shell, a
plain `<h1>`, an unstyled native `<table>` — fully rebuilt onto
`PeakV2Shell` + the shared kicker/title header + `EmptyState`/`ErrorState`/
`Skeleton` (their first real consumers anywhere in the app) + a styled table
matching Rankings' own conventions; a generic error-copy fallback
("Request failed"/"Unknown error") → "Something went wrong. Try again." in
`ranked-api.ts` (wording only, no status/code semantics changed).

**Structural note:** the leaderboard's `page.tsx` used `use(params)` with no
working render harness in this repo (confirmed by trying — a `Suspense`-
wrapped render of the page component just produced an empty `<div/>` with no
error, for reasons not fully root-caused). Extracted the actual UI into
`RankedLeaderboard.tsx` (plain `mode: RankedMode` prop), mirroring
`RankedScreen`'s existing split, with `page.tsx` reduced to a thin
`use(params)` → prop-pass wrapper. This is also what made the surface
unit-testable at all — `ranked-leaderboard.test.tsx` (7 new tests) is the
first coverage this page has ever had.

**Verification:** typecheck clean, lint 0 warnings, 2248/2248 vitest (97
files), production build (bundle deltas modest and explained by newly-
adopted shared components: `/arena/ranked/[mode]` +4kB, leaderboard +10kB),
`ranked.spec.ts` + `accessibility.spec.ts` + `play-routing.spec.ts` 55/55
passed. Independent evaluator (fresh context + isolated worktree, see
process-fix note above on why not the harness-enforced `ui-evaluator` yet)
reviewed real before/after screenshots at 390/768/1024/1440 for both the
result view and the leaderboard and returned ship-as-is for both, with one
disclosed gap: no populated-leaderboard screenshot exists (an "established"
rating needs 7 real placement matches per player — judged not worth the e2e
fixture cost given `ranked-leaderboard.test.tsx` already covers the
populated-table render path directly).

## Batch 4 — profile + progress + history (DONE, verified, committed as `6635f35`)

**Scope, per the user's explicit instruction:** these three authenticated
personal pages as one coherent family, establishing a shared identity/
progression grammar without forcing them into one interchangeable
template. Not `/players/[slug]`, H2H, or old draft routes this batch.

**Product framing preserved, not invented:** `/profile` = "who am I"
(identity + competitive status), `/progress` = "how am I developing"
(participation, explicitly not the same as skill/rating — the existing
"XP measures your exploration, not your skill" copy was kept verbatim),
`/history` = "what have I done" (chronological record). Semantic inventory
recorded in `ROUTE_BEHAVIOR_MATRIX.md` before any edit, per instruction.

**What changed:** all three moved from a plain `max-w mx-auto` div + plain
`<h1>` to the shared `PeakV2Shell` + kicker/title header (kickers: "Player"
/ "Progression" / "Record" — deliberately different per page, not a copy-
paste). `/profile` restructured into three tiers (identity dominant →
`RankedRatingCards` competitive status → a visibly quieter "Account
settings" section for the edit form, behind a muted heading + divider).
`/progress` and `/history` kept everything internal untouched (Level/XP/
Streak/tabs; empty-state/error-state swapped to the shared `EmptyState`/
`ErrorState` components). A new shared `PersonalPageLoading` replaced a
byte-identical spinner duplicated exactly 3x across these three pages
(deliberately left untouched in 3 unrelated pages that happen to share the
same inline pattern — out of scope). Numbers touched with `.score-number`
for tabular treatment (Progress StatCards, History's Lineup Peak Rating).

**Real pre-existing bug found and fixed while writing tests, not part of
the original ask:** `/profile`'s Handle/Display Name/Bio `<label>`s had no
`htmlFor`/`id` association with their inputs at all — a genuine
accessibility gap (screen readers and label-click-to-focus both broken).
Fixed with matching `id`/`htmlFor` pairs; zero behavior change.

**Tests:** zero page-level coverage existed before for any of the three
(existing `profile-api.test.ts`/`progression-components.test.tsx`/
`progress.test.ts` only cover the API client and sub-components in
isolation). Added `profile-page.test.tsx` (7), `history-page.test.tsx` (5),
`progress-page.test.tsx` (4) — 16 new tests total, all mocking at the API-
client boundary the same way `ranked-leaderboard.test.tsx` did in Batch 3.

**A real test-authoring trap worth remembering for future page-level
tests:** a `useRouter` mock that returns a fresh object literal every call
(`() => ({ push: mockPush })`) is NOT equivalent to Next's real stable
reference — if a page's `useEffect` depends on `router`, an unstable mock
makes that effect re-fire on every re-render (e.g. every keystroke in a
form), silently resetting component state. Symptom looked like "typing
into a field does nothing" when it was actually "typing works, then gets
immediately wiped by a spurious effect re-run." Fix: `const mockRouter =
{push: mockPush}` at module scope, return that same reference every call.

**Verification:** typecheck clean, lint 0 warnings, 2264/2264 vitest (100
files), production build (`/profile` 189kB, `/progress` 191kB, `/history`
187kB — consistent with sibling `PeakV2Shell` pages, no prior baseline
existed for these three specifically since they were never touched
before), `progression.spec.ts` + `accessibility.spec.ts` +
`play-routing.spec.ts` + `auth.spec.ts` 91/91 passed. Independent visual
evaluator (fresh context) returned ship-as-is for all three with one
disclosed non-blocking note (fresh account shows raw email twice — a
data-state artifact). Independent functionality QA (fresh context, see
process note below on how its worktree was set up correctly) manually
verified all 7 requested interactions (auth gate, identity display + nav,
save round-trip with actual reload-persistence proof, tab switching,
empty state, keyboard/focus order, browser back) — all pass.

## Process note from Batch 4 — worktree isolation has TWO distinct failure modes, not one

Batch 3 found that `Agent`'s `isolation: "worktree"` defaults to branching
from `origin/<default-branch>` (stale `main`), not the caller's current
branch. Batch 4 found a **second, different** failure mode on top of that:
even when you think you've worked around it, **a worktree can only see
committed state** — if your own changes are still sitting uncommitted in
the main checkout's working tree, no worktree-isolated agent (regardless of
which branch/ref it's based on) can see them at all, because they were
never committed to any ref. The functionality-QA agent for this batch
correctly caught this itself (`git diff` between its worktree and
`feature/arena-archive-visual-polish` showed zero output for the profile/
progress/history paths, i.e. "these pages are identical on both refs") and
stopped rather than silently QA-ing unrelated unchanged code — exactly the
right behavior, worth replicating: **an agent that discovers its premise
doesn't match reality should say so and stop, not proceed anyway.**

**The fix that actually worked:** commit the batch's work first (fully
verified via typecheck/lint/unit/e2e/visual-evaluator, all green), THEN
create the worktree yourself with plain git (`git worktree add --detach
<path> HEAD`), verify its `git rev-parse HEAD` matches, symlink in
`node_modules`/`.venv`/`data/web`/`cache`, and hand the QA agent that exact
fixed path directly in its prompt rather than using the `Agent` tool's
`isolation` parameter at all. This gives full control over the ref AND
guarantees the work under test is actually committed and visible. Used this
for Batch 4's functionality-QA redo and it worked correctly on the first
try — worth using as the default pattern going forward rather than
`isolation: "worktree"`, which has now caused two different silent-wrong-
ref failures in two consecutive batches.

**Also confirmed this batch:** the custom `.claude/agents/ui-evaluator.md`
(from Batch 3's process fix, `tools: Read` allowlist) is still not
recognized by `Agent({subagent_type: "ui-evaluator"})` — tried again in a
genuinely fresh session per the user's instruction, still got "Agent type
'ui-evaluator' not found." This looks like a real harness limitation, not
a mistake in the file (frontmatter matches the documented format) —
flagged to Anthropic via feedback. Until/unless this starts working,
`general-purpose` + a manually-constructed worktree (see above) is the
working substitute for both the evaluator and investigator roles.

## PERMANENT PROCESS CHANGE (from Batch 5 on) — commit before evaluating

Per explicit user instruction, this is now the mandatory sequence for every
batch, not just a Batch-5-specific fix:

1. Implement a cohesive candidate.
2. Run builder-side targeted checks (typecheck/lint/unit/build/relevant e2e).
3. **Commit a checkpoint** — this is the candidate SHA.
4. Record that SHA.
5. Launch evaluator/QA agents **against that exact committed SHA**, not
   uncommitted working-tree state.
6. Inside each agent's environment, explicitly verify `git rev-parse HEAD`
   equals the candidate SHA **before trusting any screenshot or finding**.
7. Fix whatever findings survive.
8. Commit again (if anything changed) / run final verification.
9. Push, verify local HEAD == remote HEAD.

This closes both worktree-isolation failure modes found in batches 3-4 at
the root: an agent can never be pointed at the wrong ref or at not-yet-
committed work if the work is committed first and the SHA is pinned
explicitly in its prompt. Batch 5 used this end to end (manually built two
`git worktree add --detach <path> HEAD` worktrees off the candidate commit,
symlinked deps, verified `git rev-parse HEAD` before dispatch, both agents
re-verified it themselves on arrival) and both came back clean on the first
try — no wrong-ref incidents this batch, for the first time since the
process fix started. The custom `ui-evaluator` agent type is STILL not
recognized (retried once more this batch, in yet another fresh session, per
the user's instruction not to spend further time on it) — `general-purpose`
+ manual worktree pinning remains the working substitute.

## Batch 5 — `/players/[slug]` (DONE, verified, committed as `bd704a7`)

**Scope, confirmed by the actual import graph before touching anything:**
`/players/[slug]` is the ONLY real route in this family. `searchPlayers()`/
`PlayerSearchResponse` in `lib/api.ts` are dead code (zero callers anywhere)
— there is no player Index/search surface to find or touch, and none was
invented. `RankingsAnalysis.tsx` (the Rankings page's "unified player
analysis" drawer) is a separate, unrelated surface that happens to show
similar component data differently — correctly left alone.

**Ground truth: no chart, no window selector, no season table exists on
this page, and none was built.** The page was (and remains) a purely
static list of however many peak-duration windows a player has, rendered
simultaneously — there was never a "selected window" state to preserve.
The user's brief's richer visualization language ("Peak Mountain," chart
axes/tooltips/selected-state) was explicitly conditional on such a thing
already existing; it doesn't, so none of that was built — recorded as a
future product opportunity, not attempted here.

**What changed:** `PeakV2Shell` + kicker/serif-title header; windows now
flow as one continuously-divided list (`divide-y`) instead of stacked
bordered cards; each window's kicker is now color-coded using the app's
**pre-existing** 1yr/3yr/5yr brand identity (`--apex-coral(-text)` /
`--prime-gold(-text)` == `--peak-accent(-text)` / `--foundation-blue
(-text)`, already used for these exact three durations in
`arena/labs/page.tsx`) — no new tokens invented, and 2-year windows
(no named color anywhere in the app) stay neutral rather than getting an
invented fourth color; Prime Score now uses `PeakV2Score role="moment"`
(serif — "the number the screen is actually about," per that component's
own docstring); rank and prime index now get `.score-number` tabular
treatment (previously only the prime score itself did).

**Two real bugs found and fixed, not cosmetic tune-ups:**
1. The rank line was hardcoded `(1-year window)` for literally every
   duration — a 3-year or 5-year window's rank was correct as a NUMBER but
   mislabeled every single time. Now reads `— {d}-year board` correctly.
2. This route's first-ever axe accessibility pass (added this batch)
   caught a serious `color-contrast` violation: the Teammate Adj. row
   stacked `opacity-60` on top of already-muted `--text-muted` text,
   pushing effective contrast below WCAG AA. Fixed by dropping the
   opacity and letting `--text-muted` alone carry the de-emphasis.

Also distinguished a genuine 404 ("Player not found") from any other load
failure (network/5xx) — these used to collapse into the same "no PEAK3
data for X" message, which is a real accuracy problem for a page framed as
an authoritative reference. Added a standard `loading.tsx` (no data/logic
change — the route previously showed nothing at all while the RSC
resolved).

**New pattern for this repo, useful for future server-component pages:**
tested the async Server Component by awaiting it directly
(`await PlayerPage({params: Promise.resolve({slug})})`) and rendering the
resolved JSX, rather than via `use()`/Suspense (confirmed in Batch 4 to
have no working harness here). Worked cleanly first try — prefer this
pattern over `use()` for any future page-level Server Component test.

**Verification:** typecheck clean, lint 0 warnings, 2270/2270 vitest (101
files, +6 new page tests), production build (`/players/[slug]` 115kB First
Load JS — first baseline recorded for this route), `accessibility.spec.ts`
15/15 (including the new player-page entry that caught bug #2 above on its
first run) + `play-routing.spec.ts` 35/35. Screenshots reviewed directly at
390/768/1024/1440 for a 4-window player (Michael Jordan), a 1-window
player (Chet Holmgren), a long name (Shai Gilgeous-Alexander — wraps
cleanly, no overflow at any width), and the not-found state. Independent
visual evaluator: ship-as-is, HEAD verified. Independent functionality/
data-integrity QA: all 8 checks pass, with real number-for-number proof
against the raw API response (not just "looked right") — confirmed
rounding is genuine round-to-nearest (e.g. raw `95.16` → displayed `95.2`,
which truncation would have shown as `95.1`), confirmed all 4 windows'
board-labels are now individually correct, confirmed leaderboard links,
back link, not-found state, keyboard focus, and zero console errors.

## What's next — the user's explicit requested sequence for the "legacy surface" batches

All of these are confirmed zero-`PeakV2*`-composition by the route matrix.
Per the user's explicit instruction: **"legacy surface" is not permission to
modernize product behavior** — preserve exactly what each does first, then
improve how clearly/consistently it presents that, same as batches 1-5.
Take an actual screenshot before assuming a gap's size in any of these —
the ranked/daily-grid batch already proved the "0 imports" grep signal
alone overstates severity (it can mean "sparse but fine" as easily as
"actually broken").

1. **H2H family** (`MatchScreen`, `ChallengeCreator`, `HeadToHeadHistory`,
   `InviteLanding`)
2. **Old draft-game routes** (`/arena/daily/*`, `/arena/practice/*`,
   `/arena/labs` — `DraftScreen`)

The user said to adjust this ordering if the actual route matrix/dependency
graph makes another grouping safer — re-check `ROUTE_BEHAVIOR_MATRIX.md`'s
shared-component notes before starting each group in case something makes
a different order lower-risk.

After these: everything in `ROUTE_BEHAVIOR_MATRIX.md`'s "already strong /
refinement only" category (Home, Peak Duel result, Rankings) — light touch
only. Then full Phase 12/13 accessibility + performance passes (axe scan
beyond what e2e already covers, Lighthouse) once route coverage is further
along.

## Process notes for whoever continues this (same session or a future one)

- Re-run `git rev-parse HEAD` and diff against `2bf9409` before assuming
  this file is current — it is updated per batch, not continuously.
- The hard gate in `VISUAL_RUBRIC.md` Part 1 is non-negotiable before any
  aesthetic judgment; Batch 1 followed it literally (targeted unit → full
  unit/typecheck/lint/build → targeted e2e → screenshot review → fix → full
  frontend-verify rerun → commit) and that discipline is what this program
  exists to enforce given the repo's incident history.
- Ports 3000/8000 must be free before any Playwright run; the baseline
  e2e/screenshot forks in this session occasionally collided with each
  other on this — check `lsof -i :3000 -i :8000` first.
- Any temporary Playwright spec written for ad hoc screenshot capture
  (pattern used: `apps/web/src/tests/e2e/_batch*-screenshots.spec.ts`) must
  be deleted before the next `frontend-verify`/lint run, and screenshots
  belong in the scratchpad, never committed.

---

## Archived: prior "Visual identity + game-feel upgrade" effort (unrelated branch, not merged)

This section documents a **different, earlier session's** work on branch
`fix/gameplay-ux-production-polish` (started from `4a2b50b`), which per its
own final note was "complete and green" but **never pushed** — it is not on
`main` and not part of this program's baseline. Kept here only because it
contains genuinely reusable lessons (methodology traps, architectural
decisions) if that branch or its ideas are ever revisited; do not assume
anything below is reflected in the current `main`/baseline.

### Status: complete and green (per that session)

| Commit | What |
|---|---|
| `353c5a8` | Design foundation — Space Grotesk, token layer, motion primitives, test lock |
| `8dcd82f` | Shared UI primitives — depth by meaning, fine-grey audit, `ScorePill` defect |
| `312925e` | Cross-session progress tracking |
| `75d9d3b` | Two composability traps (`.pk-lift-lg` standalone, `.pk-depth` shorthand) |
| `7f22bef` | `.pk-crown-accent` drew nothing alone; `.pk-lift` lied about `:disabled` |
| `6a77e20` | Game-feel across multiplayer, result screens, homepage, nav + bundle fix |
| `3d9ca61` | Fact-bank hardening — 91 audited, build-time structural gate |
| *(final)* | Review close-out — deterministic e2e, retired-claims register, cleanup |

### Verification (per that session)

- `scripts/ci/frontend-verify.sh` — green (typecheck, lint 0 warnings, 1952 unit tests, prod build)
- `scripts/ci/api-unit-tests.sh` — 1651 passed, 2 skipped
- `scripts/ci/model-tests.sh` — 1677 passed, 1 xfailed
- Fact-bank targeted — 296 passed (`test_nba_facts`, `_validation`, `_retired_claims`, `_deployment`, API route)
- `scripts/ci/e2e-tests.sh` at `PLAYWRIGHT_RETRIES=0` — 411 passed, 0 failed
- Stability: the two repaired specs 10/10 (×5 each); all accessibility specs 130/130 (×5)

### The three e2e defects that were fixed, and what each really was

1. **Daily Grid optimal-grid avatars.** Asserted `img` count 0, which in practice
   meant "all nine `a.espncdn.com` portraits failed to load within 5s". It passed
   when the CDN was slow and failed when it served bytes — green precisely when
   the product worked least well, and no timeout could fix that. Now every
   cross-origin *image* request is aborted before navigation, so `onError` fires
   deterministically and offline, and the assertion is on the rendered fallback
   (nine `div.player-avatar`, no surviving `<img>`).
2. **Rankings mobile sheet.** `390.0000071525574 <= 390` — the residue of the
   browser's 1/64px LayoutUnit → double conversion, not an overflow. Now measured
   against `window.innerWidth` with a 0.5 CSS px tolerance (half a device pixel at
   DPR 1). The zero-tolerance no-horizontal-scroll assertion is untouched.
3. **Draft card season labels (axe, serious `color-contrast`).** `--text-muted`
   is 4.6:1 on `--bg-surface-hover` and the card is hoverable — clearing AA by a
   tenth of a point. Promoted to `--text-secondary` (9.1:1). Also correct on the
   merits: the season window is *which peak this card is*, not metadata.

### A methodology trap worth not repeating

Attributing #1 initially pointed the wrong way. A `git worktree` of the pre-pass
commit passed it twice while this branch failed twice. That baseline was invalid:
the worktree differed from the main working copy, and the test's outcome depends
on external network reachability. Checking `4a2b50b -- apps/web/` out **in the
main working copy** reproduced the failure exactly. Use the same working copy.

### Architectural decisions worth not re-litigating

1. **No new text colours in this pass.** Every measured ratio in `globals.css`
   came from an earlier audit. Where this pass touches text it only moves UP a
   tier, which can only increase contrast.
2. **Reduced-motion is scoped to the `.pk-*` primitives**, not folded into the
   global blanket rule, which collapses `animation-duration` but not
   `animation-delay` — and existing cinematic sequences pair CSS delays with JS
   timers.
3. **`checked_on` is never compared to the clock.** The fact build stays a pure
   function of committed inputs and byte-reproducible.
4. **Deep imports, not the `@/components/ui` barrel**, on any route not already
   carrying `lucide-react`. The barrel reaches it via `ThemeToggle`; one number
   component cost `/play/daily` 74 kB of First Load JS.
5. **Structural validation does not prove truth.** `validation.py` gates
   sourcing, review date, claim type and language. Truth is established by human
   audit and ratcheted by `tests/test_nba_facts_retired_claims.py`.

### Deliberately out of scope (per that session)

- Rankings bar composition logic and the visual bar concept — off limits, untouched.
- `components/court/**`, `spinner.css`, `tour.css` — not named in the brief.
- No CI link-checker for fact `source_url`s: several cited hosts answer
  automated requests with 403/429, so it would be flaky rather than a guard.

### Known limits (per that session)

- `ResultNumber` server-renders `0`; documented in its docstring, not observable
  because every call site is a post-gameplay screen requiring JS.
- The fact schedule's period is 93 days against a 187-fact bank, so roughly half
  the bank is reachable in a cycle. Pre-existing rotation behaviour, unchanged by
  this pass, and worth a look separately.
