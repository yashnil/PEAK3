# Arena Archive visual-polish program — progress

Branch: `feature/arena-archive-visual-polish`. Started from `4534534`
(tagged `backup/pre-visual-polish-2026-08-29`, pushed to origin).

## Status: 9 route-family batches + release-candidate audit complete. Latest work = `1cdc906` (Batch 9).

**Not the same as "the whole app is converged."** The RC audit found
several real, sizeable surfaces that no batch ever actually touched —
Daily Grid (`/daily/grid`, `/daily/history`), `/arena/lobby`, Three-Man
Weave, Twenty-Dollar Showdown. It ALSO claimed "13 of 14 CourtBuilder
sub-panels" were unconverted; Batch 8 investigated that claim directly and
found it substantially overstated (see Batch 8's own section below) — the
real gap was 5 files plus one routing bug, both now fixed. Trust Batch 8's
section over the RC audit's original framing for CourtBuilder specifically.
Batch 9 investigated the Daily Grid claim directly and found it accurate
this time (unlike Batch 8's finding) — see Batch 9's own section below;
that family is now converged. `/arena/lobby`, Three-Man Weave, and
Twenty-Dollar Showdown are still honestly reported as deferred, not
silently absorbed into "done." See "Release-candidate audit" below before
assuming any further route is finished.

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
| `0441872` | **Batch 6**: H2H challenge family (see below) |
| `0b50745` | **Batch 7**: legacy Peak Draft family — Daily/Practice/Labs (see below) |
| `939f8b2` | Batch 7 fix — completion-screen dead space (evaluator finding) |
| `16eb553` | chore — batch 7 status + final-audit proposal |
| `35e4a3c` | RC audit fix — Practice board seedless-visit 400 |
| `e007427` | RC audit fix — keyboard Tab-skip past role panel |
| `e552c45` | RC audit fix — flaky WCAG contrast from card entrance animation |
| `2493af8` | RC audit — `.score-number` consistency within Batch 7's own scope |
| `6652afd` | RC audit — `/u/[handle]` onto shared shell (former RC SHA) |
| `68928fa` | chore — record RC audit results |
| `01d9b8e` | **Batch 8**: CourtBuilder flagship completion (see below) |
| `dda202c` | chore — record batch 8 status, next-batch proposal |
| `0721c53` | **Batch 9**: Daily Grid + Daily History full convergence (candidate, see below) |
| `1cdc906` | Batch 9 fix — Recent Results rail bounded as its own card (evaluator finding) |

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

## Batch 6 — H2H challenge family (DONE, verified, committed as `0441872`)

**Scope, confirmed by reading every file:** `MatchScreen`, `ChallengeCreator`,
`HeadToHeadHistory`, `InviteLanding`, `SideBySideReceipt`
(`components/head-to-head/*.tsx`) and the 3 thin `page.tsx` wrappers under
`/arena/run-the-table/h2h`. Highest interaction-risk batch so far — the
user explicitly flagged this going in, and the discipline held.

**State machine mapped before any edit** (full detail in
`ROUTE_BEHAVIOR_MATRIX.md`): create → invite → accept → waiting/joined →
submitted-awaiting-opponent → settled (side-by-side receipt) → optional
rematch, plus history and every error/expired/invalid/not-found branch.
Nothing invented — e.g. confirmed `opponent_status` is the literal string
`"hidden"` until both sides finish (spoiler safety is the server's, not
the client's), and `InviteDescriptor` structurally cannot carry a spoiler
since it has no seed/roster/score fields at all.

**What changed:** all three pages now use `PeakV2Shell` + kicker/title;
every status label (Submitted/In progress/Hidden until.../Won/Lost/Draw/
Waiting for an opponent/Both players in/Finished) now uses the existing
`StatusChip` component, tone-mapped (positive/negative/neutral/muted/
accent) — color is never the only signal, every chip carries text; every
button/link-as-button now uses `PeakV2PrimaryAction`/`SecondaryAction`;
the settled-match outcome sentence now uses `PeakV2ResultHeadline` (same
serif "moment" treatment as Ranked's result screen — reusing the
component, not inventing new result vocabulary; the sentence text itself,
e.g. "Ada beat Bo.", is unchanged); tie-breaker values, invite expiry
dates, and generated invite/rematch links now use `.score-number`.

**Real, confirmed-by-reading fix, not cosmetic:** raw `opacity-40/50/60/
70` utilities throughout all 5 components (the exact failure class
Batch 5's axe pass caught — opacity stacked on already-dim text pushing
effective contrast below WCAG AA) replaced with `--text-secondary`/
`--text-muted` tokens. `SideBySideReceipt.tsx` had already partially
fixed this in an earlier pass (visible in its own code comments); the
remaining instances (table header, index numbers, not-consulted rows,
footnote) are fixed now too.

**Tests:** `MatchScreen` and `ChallengeCreator` had ZERO coverage before
(confirmed — the two components the user's brief independently flagged
as highest-risk). Added 11 tests to `head-to-head.test.tsx` (6 + 5) and a
new `head-to-head.spec.ts` (5 e2e tests) covering every state reachable
without a second account. All 21 pre-existing tests in the file still
pass unmodified in behavior.

**Independent QA reached FULL SETTLEMENT** (including rematch) via a real
two-account flow — the deepest verification of any batch so far. Zero
spoiler leaks, zero regressions, confirmed via network-level response
inspection (not text-scraping) that `opponent.result` never appears while
`both_complete` is false. Confirmed copy-link, refresh-survives-reload,
keyboard focus, and clean console throughout. **Notable QA process
lesson: the existing `capture-daily-rtt-pvp-shots.ts` tool (a prior
session's screenshot tool with a full two-account RTT+H2H driver) was
found to be STALE** — missing the `rtt-boss-intro` surface and a required
reveal-continue click, and still referencing a removed button — so QA
wrote a fresh minimal driver instead of trusting it wholesale. Two
non-blocking product notes surfaced for future reference (not bugs, not
fixed): `RunTheTableGame.tsx` only reads `?start=`, never `?run=`, so
MatchScreen's "Continue your run" link param is cosmetic; and
`rttFetch` now auto-attaches the bearer token, so the capture tool's
"guest-run-then-claim" workaround is no longer necessary.

**Visual evaluator:** ship-as-is, HEAD verified, with one minor non-
blocking note (the signed-in-no-run hub state is a bit sparse at 1440px —
an edge/transient state, not a primary destination) and an honest
disclosure that the deeper match states (waiting/joined/settled) could
only be judged from source code, since no screenshots existed for those
at evaluation time (QA's real-browser verification covered them instead).

**Verification:** typecheck clean, lint 0 warnings, 2281/2281 vitest (101
files, +11 tests), production build (hub 189kB, match 189kB, invite
188kB — no prior baseline existed for these routes), `accessibility.spec.ts`
15/15 + `play-routing.spec.ts` 35/35 + `head-to-head.spec.ts` 5/5.

## Batch 7 — legacy Peak Draft family: Daily/Practice/Labs + DraftScreen (DONE, verified, committed as `0b50745` + fix `939f8b2`)

**This was the last route-family batch** — per the user's explicit
instruction, the program now moves to a whole-app convergence/release-
candidate audit rather than another route-family pass (see "What's next"
below).

**Scope, confirmed by reading every file and the actual import graph, not
assumed:** `/arena/daily`, `/arena/daily/[mode]`, `/arena/practice/[mode]`,
`/arena/labs`, `/arena/results/[id]`, and every component `DraftScreen`
imports (`DraftCard`, `RoleSelector`, `LineupBoard`, `DraftToolbar`,
`DraftReceipt`, `DecisionReplay`, `ShareChallenge`, `ChallengeComparison`,
`PracticeDraftLoader`). `DNARadar.tsx` was confirmed out of scope (imported
by `twenty-dollar/ComponentSilhouette.tsx`, a different game family) and
left untouched. Full semantic inventory recorded in
`docs/design/ROUTE_BEHAVIOR_MATRIX.md`.

**State machine mapped before any edit:** `lib/draft-state.ts`'s
`DraftUIPhase` — `loading → selecting ⇄ role_select → submitting →
selecting | complete`, plus `tool_confirm` (Hold's pre-selection prompt).
**Found and left alone, not "cleaned up":** `state.phase === "error"` in
`DraftScreen`'s render is dead code — no reducer action ever produces it
(`GAME_LOADED` maps every non-`draft_complete` status, including
`"expired"`, straight to `"selecting"`; `SUBMIT_ERROR`/`SET_ERROR` only
ever land on `"selecting"`/`"complete"`). Documented in the route matrix
rather than silently fixed or removed, per the batch's explicit
preservation rule.

**What changed:** `DraftScreen`, `DraftCard`, `RoleSelector`, `LineupBoard`,
`DraftToolbar`, `PracticeDraftLoader`, and the daily-hub/daily-mode/labs
pages moved onto `PeakV2Shell`/`StatusChip`/`PeakV2PrimaryAction`/
`SecondaryAction` and the existing `.pk-depth`/`.pk-crown`/`.pk-lift`/
`.pk-press`/`.pk-reveal` house motion vocabulary that `DraftReceipt` and
`ChallengeComparison` already carried in from an earlier pass (those two
plus `ShareChallenge`/`DecisionReplay` needed only light consistency
touch-ups, not a rebuild). `DraftScreen` gained a desktop-only (`lg:`)
persistent roster/DNA sidebar during active play — CSS-repositioned from
the same single `LineupBoard`/`DNABar` instance via `lg:hidden`/`hidden
lg:flex` (no duplicate DOM, no state change) — so wide viewports get
roster context alongside the decision instead of just a wider single
column. Mobile's one-decision-at-a-time layout and every phase gate are
byte-for-byte unchanged. Every existing `data-testid`, accessible name, and
pinned copy string (`offer-card`/`role-btn`/`lock-in`, "Peak Draft"
heading, Hold/Reframe/Holding text, mode labels, Legacy Labs banner/back-
link, already-completed heading regex, etc.) is preserved exactly.

**Tests:** this family had **zero component-level tests before this
batch** — only e2e (`gameplay.spec.ts`, `daily-challenge.spec.ts`,
`accessibility.spec.ts`, `play-routing.spec.ts`) and unrelated unit tests
(`game-state.test.ts` covers Peak Duel's different reducer;
`component-labels.test.ts` covers shared label renames; `daily-time.test.ts`
covers the shared daily-key module) actually protected it. Added
`draft-screen.test.tsx` (6 tests: header/offers render, select→role_select,
cancel returns to selecting, lock-in submits and advances the round, a
failed submission surfaces `role="alert"` without crashing, Hold-with-no-
selection opens the prompt without submitting, and the completed state
renders the receipt/lineup/decision-replay/challenge-button),
`daily-hub-page.test.tsx` (3), `legacy-labs-page.test.tsx` (2) — 11 new
tests, all against real component behavior, not snapshots.

**A real regression this process caught and fixed before shipping:**
the independent evaluator flagged genuine dead space on the completion
screen at 1024/1440 (the in-progress two-column grid was still in effect
with an empty second track, since the roster/DNA rail intentionally
doesn't apply once the draft is done). First attempt filled the rail with
a second `DecisionReplay` instance; the QA agent's e2e re-run immediately
caught it duplicating "ROUND 1 · ..." into the DOM and breaking
`gameplay.spec.ts`'s existing unscoped
`getByText(/round 1|pick 1|your picks/i)` assertion. Reverted that and
instead widened the completed state's own single column (`max-w-2xl`,
grid dropped) — same fix, no duplicate DOM node, committed separately as
`939f8b2` after a full re-verify (2292/2292 vitest, clean build, 88/88
targeted e2e). **Lesson for next time:** the `lg:hidden`/`hidden lg:flex`
duplicate-DOM pattern used for the roster/DNA sidebar is fine for content
no existing test bare-queries, but is NOT safe to reuse casually for any
component whose text an existing test asserts on without `.first()`/scoping
— check for that before mounting a second copy of anything.

**Independent evaluator verdict:** ship with minor notes (the one note was
the dead-space finding above, now fixed). All 10 evaluator questions
answered affirmatively with screenshot evidence at 390/768/1024/1440,
both themes spot-checked. No visual bugs, no false affordances, no
settings-page/casino feel found.

**Independent QA verdict:** no regressions from this batch across a full
Practice game, a full Daily game (including reload-resumption via matched
`game_id`, and the already-completed revisit state), Labs navigation, and
a keyboard-access spot check. **Two pre-existing bugs surfaced, confirmed
via `git diff` against the parent commit to be unrelated to this batch's
changes, NOT fixed (out of scope for a visual-only pass):**
1. `/arena/labs`'s "Practice" links (and any other seedless
   `/arena/practice/{mode}` visit) send no `seed`, and the API requires
   one for a practice board (`board_error`: "Board config must have either
   a date (daily) or a seed"), so every Practice link from Labs currently
   404s into "Could not create practice board." `PracticeDraftLoader`
   needs a default/random seed when none is supplied, or Labs needs to
   generate one — a real, pre-existing product bug, worth a dedicated fix.
2. After a keyboard-driven card selection, forward-Tab skips past the
   just-opened `RoleSelector` straight to the page footer (the selected
   card becomes `disabled` and auto-blurs; `RoleSelector` renders before
   the offer-card list in the JSX, so the next Tab stop in DOM order is
   past both). Shift+Tab reaches it fine. Pre-existing DOM-order issue,
   not introduced here.

**Verification:** typecheck clean, lint 0 warnings, 2292/2292 vitest (101
→ 104 files, +11 tests), production build clean (bundle deltas below),
88/88 targeted e2e (gameplay/daily-challenge/accessibility/play-routing)
+ 11/11 `@mobile` overflow checks, all re-run clean after the dead-space
fix.

**Bundle deltas** (First Load JS, candidate vs. parent `e817abb`):
`/arena/daily` 109→119 kB, `/arena/daily/[mode]` 132→133 kB, `/arena/labs`
106→106 kB (flat), `/arena/practice/[mode]` 129→130 kB, `/arena/results/[id]`
128→130 kB — modest, consistent with the rest of the app's V2-component
cost.

## Batch 8 — CourtBuilder flagship completion (DONE, verified, committed as `01d9b8e`)

**Scope, per the user's explicit instruction, following the RC audit's
finding:** the majority-legacy-flagship claim from the RC audit turned out
to be substantially overstated on investigation. Full state/panel inventory
(recorded in `ROUTE_BEHAVIOR_MATRIX.md`) found `CourtBuilder.tsx` already
delegates to mature, multi-pass V2 components (`PeakV2CourtLive`,
`PeakV2CourtChooser`, `PeakV2CourtResult` — documented "Pass 3" cutover and
"Pass 7" human-acceptance-testing fixes), which reuse `CourtLayout`,
`LiveBuildPanel`, `SpinStage`, `EligiblePlayerSearch` verbatim because those
are already correct (`CourtLayout`'s real court markings solved the "reads
as a form" failure in Phase 6C, long before this program existed). The RC
audit's "0 PeakV2 refs" grep was a poor proxy — it counted these
already-good, verbatim-reused files as "legacy" because they're imported by
relative path rather than re-exported under a `PeakV2*` name.

**The real, narrow gap, found by actually reading every file:** five
action panels `PeakV2CourtResult` reuses on the post-game result screen
(`SaveRunPanel`, `PlayAgainPanel`, `LeaderboardSubmitPanel`,
`ShareRunPanel`, `PeakPicksRecap`) were still raw bordered boxes with ad
hoc `<button>`/`<a>` styling — visibly older than the cinematic,
hairline-divided page they sit inside. Restyled onto
`PeakV2PrimaryAction`/`SecondaryAction`, dropped their own outer box.
**Second, more concrete bug:** `/arena/court/results/[id]` (the shared/
permalink URL `ShareRunPanel`'s own "Copy link" generates) rendered the
OLD `SeasonResultStub` instead of `PeakV2CourtResult` — confirmed
identical prop signature and `data-testid`, so a like-for-like swap. This
was the actual "polished promise, then an older generation" bug: the
player who just finished saw the new cinematic result; anyone they shared
the link with saw the old one.

**Left deliberately untouched, documented as out of scope:**
`PeakSeasonLeaderboard.tsx` + `/arena/court/leaderboard` (a separate
destination, not part of the CourtBuilder loop) — flagged for a future
batch. `SpinStage`, `EligiblePlayerSearch` (also shared with Daily Grid's
`GridCell.tsx`), `CourtLayout` — reused verbatim, correctness/UX-critical,
not touched (same discipline as `DNARadar.tsx`).

**Tests:** added `share-run-panel.test.tsx` (5), `peak-picks-recap.test.tsx`
(4), `court-results-page.test.tsx` (3) — all three had zero coverage
before. All pre-existing `save-run-panel`/`play-again-panel`/
`leaderboard-submit-panel` unit tests passed unmodified (testids/behavior
byte-identical).

**Verification:** typecheck clean, lint 0 warnings, 2309/2309 vitest,
clean production build, **99/99 `courtbuilder.spec.ts`** (the largest e2e
file in the app, ~10min, its own CI shard — full select/cancel/reselect/
place/swap/undo/respin/hint/complete/share/download/leaderboard/shared-
read-only-result loop), 15/15 `accessibility.spec.ts`.

**Independent evaluator:** ship as-is. All 9 evaluator questions answered
affirmatively; shared permalink confirmed visually identical generation to
the owner's own result screen (the exact thing this batch fixed); one
pre-existing (not introduced this batch) minor note — long recap rows
truncate at 390px, a `PeakPicksRecap` internal-content issue this batch's
outer-box removal didn't touch.

**Independent QA:** 19/19 checks pass, zero console errors, zero non-2xx
responses. Full free-play run, cancel/reselect (confirmed via a real
`.../cancel` 200, not just a client-side hide), 8-round completion, all
five action panels in both leaderboard-flag states, the shared/permalink
flow byte-identical roster text between owner and shared views, invalid-id
not-found state, and a keyboard-only playthrough of round 1 plus the
result screen's actions. No regressions found.

**Bundle note:** `/arena/court/results/[id]` grew ~128kB→194kB (+66kB)
since it now shares `PeakV2CourtResult`'s richer cinematic bundle instead
of the lighter legacy `SeasonResultStub` — justified: it fixes a real
visual-consistency bug, and the route is a low-traffic shared/permalink
destination, not a hot path.

## Release-candidate audit — DONE, RC = `6652afd`

Ran the user's full "Global Arena Archive Convergence + Release Candidate
Audit" spec (Stages A–L) against branch head `16eb553`. Default posture
was VERIFY AND LEAVE ALONE; only 5 small, evidence-backed commits landed.
Dispatched 7 parallel fork/agent investigations (route reconciliation,
design-drift grep, cleanliness grep, bundle-delta measurement, 2 live
visual reviews, 1 accessibility certification) using the same worktree +
SHA-pinning discipline as every batch's evaluator/QA step.

**Process lesson worth keeping:** the API's CORS allowlist
(`apps/api/app/main.py`) hardcodes only `localhost:3000-3003`. Two of the
worktree agents on ports 3011-3013 got silent fetch failures that looked
like real product bugs (broken pages, axe violations on error screens)
until traced to CORS. Fix for any future off-3000 worktree: start uvicorn
with `PEAK3_CORS_ORIGINS='["http://localhost:PORT"]'` set.

**Route reconciliation (Stage A) — the single most important finding of
this whole audit:** the 7 batches covered real, real surfaces well, but
NOT the whole app. Confirmed via direct `grep -c "PeakV2"` per component,
not assumption:
- **Daily Grid family** (`/daily`, `/daily/grid`, `/daily/history`) —
  `DailyGridGame.tsx` (1247 lines) and `DailyGridHistory.tsx` (208 lines):
  **0** PeakV2 refs. Batch 2's title ("Ranked-mode + Daily Grid 1440px
  density") oversold this — it added one sidebar component, not a system
  conversion. `docs/design/ROUTE_BEHAVIOR_MATRIX.md`'s own entry for this
  route was stale pre-batch language; not yet corrected.
- **`/arena/lobby`** (`ArenaLobby.tsx`, 781 lines) — **0** refs, and not
  mentioned anywhere in the route matrix at all. A real, linked-from-Home
  multiplayer entry point.
- **Three-Man Weave / Twenty-Dollar Showdown** — 8/856 and 6/664 refs
  respectively. The matrix already called these "partial, needs a
  consistency pass" before this program started; no batch ever picked
  them up.
- **CourtBuilder (82-0, the current flagship)** — `CourtBuilder.tsx`
  itself has 8 refs (partial), but 13 of its 14 child sub-panels
  (`PlayAgainPanel`, `PlayerAvatar`, `PeakCardCourt`,
  `LeaderboardSubmitPanel`, `SeasonResultStub`, `CourtLayout`,
  `LineupInsightPanel`, `SpinStage`, `LiveBuildPanel`, `SaveRunPanel`,
  `ShareRunPanel`, `PeakPicksRecap`, `PeakSeasonLeaderboard`,
  `ActionToast`) have **0**. Only the start gate (Batch 1) was ever
  actually restyled. This is the flagship the homepage/nav promote —
  the single highest-priority gap for whenever route-family work resumes.
- **`/c/[token]`** (shared challenge link, 348 lines) — inherits V2 via
  the `DraftScreen`/`ChallengeComparison` it renders, but its own
  landing/pre-game chrome was never itself reviewed.
- Everything else (~40 routes) is accounted for and accurate in the
  matrix: Home, Peak Duel, Rankings, Methodology confirmed **still hold**
  their pre-program "already strong" classification (verified by direct
  read + live 4-viewport visual review this stage, not re-assumed); all
  7 batches' own routes confirmed correct; auth/legal pages confirmed
  intentionally quiet and unchanged.

**Design-system drift (Stage B):** no drift found outside Batch 7's own
scope worth fixing. Real finding: Batch 7 itself was inconsistent —
`DraftCard`/`RoleSelector` got `.score-number`, four sibling components
in the same directory didn't (fixed, `2493af8`). Two shared primitives
(`ScorePill`, `SectionHeader`) exist, are tested, and are never actually
used anywhere — not deleted (not confidently dead), flagged for a future
decision. Two `opacity-70` instances in `BossPreview.tsx`/
`PeakV2RTTBossPreview.tsx` were flagged as *possible* contrast risks but
not confirmed failing by axe — left alone per "verify and leave alone."

**Cleanliness (Stage G):** nothing this program left behind was dead.
Pre-existing, unrelated: a stale screenshot-capture script
(`capture-daily-rtt-pvp-shots.ts`, already known-stale since Batch 6) and
an untracked `apps/web/.env.local.save` (not opened, not touched, flagged
only).

**Bundle/performance (Stage F), whole-program vs. baseline `4534534`:**
zero dependency changes, shared JS flat at 102 kB, worst single-route
delta +12 kB / +9.2% (`/arena/daily`, `/arena/ranked/[mode]/leaderboard`),
no route over +15%. Not a regression.

**Visual review (Stage C), live 4-viewport (390/768/1024/1440), both
themes, on everything an actual batch touched:** two independent agents
— one on Arena game surfaces, one on identity/personal/nav surfaces —
each returned **"ship, no deficiencies found."** One process note: full-
page Playwright screenshots of a page with an open fixed-position overlay
(mobile drawer, an account nudge) visually double the overlay in the
stitched image — a screenshot artifact, not a real rendering bug;
re-verified with a normal viewport screenshot both times.

**Accessibility certification (Stage E):** 15/15 axe pass on
`accessibility.spec.ts` pre-fix; manual keyboard flows passed for global
nav, mobile drawer, Peak Draft selection, Profile label associations, H2H
creation, Daily Grid, 82-0 Begin. Confirmed-reproducible: the keyboard
Tab-skip bug (fixed this stage). Not fully certified, recorded rather
than silently skipped: a full keyboard-driven Ranked round (only
reachability verified), chart/DNA-bar accessible-name check, manual
`<table>`-semantics check on Rankings/leaderboards beyond axe passing,
`prefers-reduced-motion` forced-verification, and 320px zoom/reflow.

**Two known functional/accessibility defects (Stage D) — reproduced,
root-caused, fixed, each its own commit + regression test:**
1. `35e4a3c` — every seedless `/arena/practice/{mode}` visit (every Labs
   "Practice" link) sent no `seed`; the API requires one for a practice
   board and 400'd every time. `PracticeDraftLoader` now picks one
   random seed per mount when none is supplied.
2. `e007427` — after a keyboard-driven offer-card selection, the card
   disables and drops from the tab order; `RoleSelector` renders BEFORE
   the offer list in the DOM, so forward-Tab used to skip past the newly-
   opened role panel into the footer. Fixed with the same `tabIndex={-1}`
   +focus-on-mount pattern `ChallengeComparison` already used.

**One NEW defect found during this stage's own re-verification, not one
of the two named above — its own commit, `e552c45`:** Batch 7's
`.pk-reveal` entrance animation on Peak Draft/Daily-hub/Labs cards caused
an intermittent (~2-in-5, reproduced via 5x and then 8x repeated live-
browser runs) "serious" WCAG contrast violation while a card was still
fading in. Root-caused by scripting repeated axe runs against a live
page — not dismissed as flake. Fixed by removing the animation from
these specific cards (they're the "obvious in 2-3 seconds" decision
surface; needed full contrast from frame one), not by tuning the
animation. Confirmed 8/8 clean after.

**Full gate battery on frozen RC `6652afd` (Stage J):** model tests 1859
passed/1 xfailed · API unit 1804 passed/2 skipped · API integration 116
skipped (no Supabase test project configured, expected) · frontend-verify
(typecheck/lint-0/2297 vitest/build) all green · full Playwright, all 4
projects: 456 passed, 1 skipped, 0 failed (329 chromium-core+mobile-
chrome, 127 passed+1 skipped multiplayer+courtbuilder).

**Deferred, not fixed this stage (too large for a convergence audit —
would be another full route-family batch each):** Daily Grid family,
`/arena/lobby`, Three-Man Weave, Twenty-Dollar Showdown, CourtBuilder's
13 unconverted sub-panels, `/c/[token]`'s own page chrome. Recommend
these as the next actual route-family batch(es) whenever that work
resumes — CourtBuilder's sub-panels first, since it's the flagship.

## Batch 9 — Daily Grid + Daily History full convergence (DONE, verified, committed as `0721c53` + fix `1cdc906`)

**Scope, per the user's explicit instruction, following the RC audit's
finding:** the RC audit's "0 PeakV2 refs" grep flagged the whole Daily Grid
family as legacy. Same lesson as Batch 8 applied up front this time: read
every one of the 12 `components/daily-grid/*` files plus
`components/daily/DailyHub.tsx` before touching anything (recorded in
`ROUTE_BEHAVIOR_MATRIX.md`'s pre-implementation semantic inventory). Found
9 of 12 files (plus the `/daily` hub, a separate "Pass 5" build) already
fully V2-native via an undocumented prior "Pass 7 (human acceptance
testing)" pass that predates this program: `StartGate.tsx`,
`DailyGridBoardView.tsx`+`GridCell.tsx`, `CellPanel.tsx`,
`CompletionTrigger.tsx`, `CompletionModal.tsx`, `CompletionPanel.tsx`. The
RC audit's "0 PeakV2 refs" grep on `DailyGridGame.tsx`/
`DailyGridHistory.tsx` specifically was correct, though — unlike Batch 8,
this family genuinely still needed a dedicated pass.

**The real, narrow gap, found by reading every file:**
1. `DailyGridGame.tsx`'s own outer chrome (~370 of 1247 lines: page
   header, `StatTile`→`StatBox` on `PeakV2Score`, rollover-prompt banner,
   archive-board banner, idle-hint panel, the four early-return branches
   loading/error/gate/playing) — the one part of the whole loop that never
   went through the Pass 7 rebuild.
2. `HowToPlay.tsx`'s own action buttons ("Take the walkthrough" / "Back to
   the grid" / "Close") and step cards — same class of fix as Batch 8's
   action panels. The `Dialog` wrapper and rule content were already fine.
3. `DailyGridHistory.tsx` in full — genuinely untouched: no `PeakV2Shell`,
   its own duplicate `Stat` tile (independently reimplemented, same
   pattern as `DailyGridGame`'s old `StatTile`), raw bordered banners.
   Reuses `RecentResults` (already good) for the actual list — matches
   this batch's "favor dense chronological scanability" brief already, so
   the fix was purely page-chrome.

**Batch 2 sidebar (Recent Results rail), re-evaluated per explicit
instruction — kept, then recomposed after live evaluation:** initially
kept as-is based on its own code comments (real data only, hidden during
completion, uses otherwise-wasted xl+ width) — correct reasoning, but the
*container* around it hadn't been checked against the newly-converged
composition. The independent visual evaluator (below) found the bare
heading+list floated on the page background left a stark unbounded empty
region whenever the board+workbench column ran taller than the ≤6-row
results list — the literal "unnecessary sidebar that doesn't earn its
space" failure mode this batch was told to check for. Fixed in `1cdc906`:
wrapped the rail in the same `pk-depth`/`pk-crown` card treatment as the
rest of the family, added a "View full history" footer link. A shorter
bordered card beside a taller bordered card reads as ordinary editorial
layout; an unbordered list floating in empty space did not.
`RecentResults.tsx` itself stayed untouched throughout.

**Tests:** added `daily-grid-history.test.tsx` (5) and
`daily-grid-how-to-play.test.tsx` (5) — both files had zero dedicated
coverage before. All 75 pre-existing `daily-grid-components.test.tsx`
tests passed unmodified (every `data-testid` preserved exactly, including
the `daily-grid-timer` exact-text assertion via `PeakV2Score`'s new
`valueTestId` prop).

**Verification:** typecheck clean, lint 0 warnings, 2319/2319 vitest,
clean production build, **77/77** on `daily-grid.spec.ts` +
`daily-challenge.spec.ts` (including `@mobile` overflow checks and the
exact `daily-grid-timer` text match) on the candidate, re-run as
**63/63** `daily-grid.spec.ts` after the sidebar fix, 15/15
`accessibility.spec.ts`.

**Independent evaluator:** accept, with the sidebar finding above (fixed)
and two items left deliberately unfixed as out of this batch's scope:
`CompletionTrigger.tsx`'s `position: fixed; bottom-4` pill overlaps the
site footer at the very bottom of a completed board's page, worst at
390px — pre-existing (this file untouched, fixed positioning is viewport-
relative and unaffected by any padding this batch changed), a real bug,
flagged for a future pass. Minor: the mobile stat-tile row is an
asymmetric 4+1 wrap — pre-existing layout, not introduced this batch, not
worth a special-case fix.

**Independent QA:** 10/10 flow checks pass — correct board/date, active-
cell + search, ineligible-player rejection, valid-answer lock, filled-
square immutability, full-board completion matching the server's own
`/daily-grid/result` response byte-for-byte, persistence across refresh,
correct history/streak tiles, history↔grid navigation, and correct
recognition of an already-completed board on revisit. Zero console
errors, zero non-2xx responses across the whole run. Verdict:
functionality preserved, no regression attributable to this batch.

**Bundle note:** `/daily/grid` 22kB→21kB (First Load JS unchanged, 221kB),
`/daily/history` First Load JS 119kB→120kB (+1kB, new V2 imports) —
negligible either way, confirmed against a baseline rebuild of `dda202c`.

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
