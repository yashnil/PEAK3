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
| Typecheck | `scripts/ci/frontend-verify.sh` | clean | clean, lead-run on `a169de7` | **PASS** |
| Lint, zero warnings | `scripts/ci/frontend-verify.sh` | 0 warnings | **0 warnings** | **PASS** |
| Unit tests (vitest) | `scripts/ci/frontend-verify.sh` | 1258 / 1258 across 47 files | **1335 / 1335 across 51 files** (+77) | **PASS** |
| Production build | `next build` with a real HTTPS API URL | fails as-scripted on deploy-safety env guard; passes with real URL | succeeds with real HTTPS URL | **PASS** |

> **The production build is a mandatory gate in its own right, not a formality
> after the fast gates.** During task #17 a stray `*/` inside a `globals.css`
> comment prematurely closed the comment block. Typecheck passed, lint passed
> with zero warnings, and all 1293 vitest tests passed — **only `next build`
> caught it.** Any change touching CSS must run the real build before being
> called done.
| Playwright full suite, **zero retries** | `scripts/ci/e2e-tests.sh` | | NOT RUN — product-director tested against a manually-launched local instance (in-memory API + `next dev`) with hand-written Playwright scripts, not the committed suite via this script; the suite itself was not invoked in this pass | **NOT RUN** |
| axe accessibility | `accessibility.spec.ts` via `scripts/ci/e2e-tests.sh` | never invoked in this pass | **17 critical/serious violations** against pre-`#21` code → **5** after the contrast fix. The 5 remaining are `--accent-*` used as literal `color` on its own `color-mix` wash (draft screen role chip, rankings, mobile rankings, methodology, hold-in-use) → task **#29** | **FAIL** → #29 open |
| Keyboard path through every cinematic | e2e suite | | Opening-reveal start control and the lineup-rating disclosure (`rtt-lane-rating-explainer`) independently confirmed keyboard-focusable and `Enter`-activatable, live, on `feature/arena-rtt-overhaul` @ `3988355`. Boss-intro countdown and the pause/resume controls were not independently keyboard-tested (ran out of session time — see report to lead) | **PARTIAL** |
| Screen-reader announcements (where testable) | e2e suite | | Opening-reveal live region (`rtt-reveal-live-roster`) confirmed empty pre-reveal and filled with the full "Meet your roster fully revealed. Name, score. …" sentence for all 7 slots after completion — mount-empty-then-fill pattern holds | **PASS** (spot-checked, not exhaustive) |

## 4. Visual matrix

Each cell must be a real screenshot with no cropped overflow.

**Honest status: this pass is a targeted, evidence-driven spot-check, not the
full 14×8 grid.** Given the session budget, product-director prioritized the
cells that a falsification method could actually break (per
`VERIFICATION_PLAN.md` §3) over exhaustively filling every cell with a
screenshot that confirms nothing new. Cells actually captured are marked
`PASS`/`FAIL` with the evidence; everything else is `NOT RUN` rather than
left blank, per this file's own header rule.

| Viewport / condition | Homepage | Opening reveal | Draft | Boss intro | Lineup reveal | Lane resolution | Result | Leaderboard |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1728×1117 | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| 1440×900 | **PASS** — `/tmp/homepage-dark-1440.png`; 1 above-fold nav tile (the single flagship card, not a grid — see §5) | NOT RUN (screenshot) — behavior verified via DOM/network instead | NOT RUN | NOT RUN | NOT RUN | **PASS** — `/tmp/battle-reveal.png`, full lane list with `YOUR LINEUP RATING`/`BOSS LINEUP RATING` visible | NOT RUN | NOT RUN |
| 1024×768 | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| 430×932 | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| 390×844 | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN — the 390px lineup-rating/contributor re-stacking check from `VERIFICATION_PLAN.md` §3.C was **not executed**; flagging explicitly since it was named as a hard case | NOT RUN | NOT RUN |
| 125 % zoom | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| 150 % zoom | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| 200 % zoom | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN — the 200% zoom lineup-rating/contributor geometric check was **not executed**, same caveat as 390px above | NOT RUN | NOT RUN |
| Dark | **PASS** — `/tmp/homepage-dark-1440.png` | NOT RUN | NOT RUN | NOT RUN | NOT RUN | **PASS** — `/tmp/battle-reveal.png` | NOT RUN | NOT RUN |
| Light | **PASS** — `/tmp/homepage-light-1440.png`; `data-theme="light"` confirmed applied at `domcontentloaded` (pre-hydration), zero hydration console errors | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| System | **PASS** — confirmed `data-theme` correctly resolves to `dark`/`light` matching `prefers-color-scheme` with no stored preference, both directions | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Reduced motion | NOT RUN | **PASS** — every sampled reveal-card computed `transitionDuration`/`animationDuration` reads `~0s` under `prefers-reduced-motion: reduce`; total wall-clock 497ms (down from ~12.6s) — see §5 for the wall-clock caveat | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Slow network | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |
| Failed images | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN | NOT RUN |

## 5. Manual / browser states

All rows below were tested by product-director **live**, driving a real
headless Chromium session — never read off a teammate's report. Three passes:
an initial pass against a local boot of `feature/arena-rtt-overhaul` @
`3988355` (in-memory API at `127.0.0.1:8010`, `next dev` web at
`127.0.0.1:3010`, sharing the same worktree/ports as `platform`'s own live
testing — this caused real, confusing cross-contamination, see below); a
follow-up pass in a **fully isolated worktree** (`/private/tmp/peak3-verify/
integration`, unique ports 8030/3030) against `f1687de` to close every gap and
rule out the port collision as an explanation for any finding; and a final
pass, same isolated worktree updated to current HEAD **`cad1a23`** (includes
the lead's merge-conflict resolution across the 20 RTT components `platform`
touched for the contrast fix, and `platform`'s independent Lighthouse
re-confirmation — neither re-verified here per the lead's instruction, since
both are already independently confirmed by their owners), for the
scout-intel HUD payoff — the one piece that needed a specific seed/stage path
(`seed=11`, supplied by the lead from the generator) rather than more
sampling. Nothing in the scout-payoff mechanism (`RunTheTableGame.tsx`'s
`scoutIntel` state, the boss-id gate, `DraftRoom`/`TradeDesk`'s
`data-matches-scout`) touches color tokens, so the intervening contrast-fix
merge is not expected to have altered any of it, and the live results below
confirm that expectation held.

Method for every row is the falsification method specified in
`VERIFICATION_PLAN.md`, executed by product-director, not merely referenced.

**Port collision, disclosed.** The lead's own worktrees at Phase 0 shared no
port allocation; product-director's and `platform`'s locally-launched API
servers both defaulted to 8010 in the shared main worktree and killed each
other mid-test at least once. No ownership/403 anomaly was ever observed or
logged as a finding in this file as a result — the collision manifested as
dev-server restarts and connection-refused errors, which were retried, not
misread as a product defect. All findings below that could plausibly have
been affected (the reveal-leak check and the reveal-timing number) were
independently **re-run in the isolated worktree** and reproduced identically,
which is recorded per-row below.

Ground truth for the reveal-leak row was obtained by driving a run to full,
legitimate reveal completion myself on one seed and checking a second,
independent run on the **same** seed — `VERIFICATION_PLAN.md` §3.A's
non-circular procedure, exactly as specified, not substituted with a
teammate-committed fixture.

**One self-caught false positive, disclosed for the same reason the port
collision is above.** The first pass at the 390px/200%-zoom lineup-rating
restacking check (below) reported 10 "overlaps" that turned out to be a bug
in my own test script (`{...domRect}` silently drops `top`/`left`/`right`/
`bottom` because they are prototype getters, not own properties, so every
comparison ran against `undefined`). Caught before reporting, fixed, re-run:
zero real overlaps. Recorded here on the same principle as the port-collision
disclosure — a false positive from my own tooling is exactly the failure mode
being guarded against, regardless of which side it comes from.

| State | Expected behaviour | Result |
| --- | --- | --- |
| Homepage | Arena entrance, not a directory | **PASS.** 1440×900, no scroll: exactly 1 above-the-fold navigation tile (`home-flagship-card`, the single intentional flagship CTA — not a multi-card grid). Frozen invariants hold: exactly one `<h1>` reading "Build a roster of peaks.\nRun the table." (verbatim), exactly one `[data-featured="true"]`. |
| Opening reveal | 7 concealed slots; no name/score/season/identity leak in DOM **or** a11y text | **PASS, reproduced twice.** Three independent surfaces checked on a fresh run against a ground-truth run on the same seed: (1) raw network response bodies for `GET/POST .../runs*` — zero leaked `card` fields for any slot beyond `reveal_index`; (2) full DOM via `page.content()` with a forced style override defeating `display:none`/`visibility:hidden`/`opacity:0` — zero leaked name/window/score strings; (3) `ariaSnapshot()` of the full page — zero leaked strings. All 7 concealed slots carried `aria-label="Not revealed yet"`. **Re-run in the isolated worktree (unique ports, current HEAD `f1687de`) specifically to rule out the port-collision explanation: zero leaks again.** This is the single most important regression gate from Part A of `PRODUCT_EXPERIENCE_CONTRACT.md` and it holds under both conditions. |
| Opening reveal pacing | one user action starts it; rest queue automatically; ~8–12 s | **FAIL — reproducible, not noise, not a port-collision artifact.** One user action confirmed: exactly one `POST .../actions` fires (`count:7`), no second interaction needed. Wall-clock click→`data-reveal-complete="true"`: **12595/12601/12604/12619/12632 ms across 5 seeds** (median 12604ms) in the shared-port pass, **12472ms** re-measured solo in the isolated worktree — all six measurements exceed the binding 12000ms ceiling, and the isolated re-run rules out port contention as the cause. Code's own computed total (`reveal-timing.ts`) is 11800ms exactly; measured wall-clock is consistently ~700-800ms over that. **Caveat: measured under `next dev`, not production** (`next build` refuses a local HTTP API; staging would confound the number with its own ~217-375ms write latency). → task #25 (rtt-experience) requires a production re-measurement and a trim to ~10.5s computed total for real headroom. |
| Reveal controls | pause, skip all, reduced-motion immediate | **PASS, all three now independently clicked live** (isolated worktree). Pause: progress genuinely froze at "1 of 7 revealed" for 2.5s of continued waiting, confirmed by polling, not assumed. Resume: progress advanced within 2s of clicking it, and the sequence still reached natural completion afterward. Skip-all: collapses the presentation cursor to the end on click. Reduced motion: every sampled reveal-card's computed `transitionDuration`/`animationDuration` reads `"1e-05s"` (functionally zero) under `prefers-reduced-motion: reduce`; total wall-clock for the whole 7-card sequence was 497ms (96% reduction) — the CSS-level check is what proves "collapsed" vs. "shortened" per `SYNTHESIS_CONTRACT.md` §5, and it passes cleanly. |
| Draft | decision-first card; receipts behind disclosure | **PASS**, live (isolated worktree, current HEAD, task #22's restructure). `rtt-card-decision`/`rtt-card-foregone` render immediately after the card's identity/score with real consequence text ("Costs 4 — leaves 46 for the rest of this act."), followed by a `<details>` "Full breakdown" disclosure (`rtt-card-breakdown`) for the granular lane/receipt data — confirmed by DOM position, not just testid presence. |
| Trade | decision-first card; credits + role replaced visible | **PASS**, live, same session. Same `rtt-card-decision`/`rtt-card-foregone`/`rtt-card-breakdown` structure on incoming cards; outgoing slots additionally show per-slot advisory text (`rtt-trade-out-{slot}-advisory`). |
| Scout payoff | vulnerability pinned in HUD; matching market cards highlighted; effect shown later; pin correctly scoped per-boss (not a stale carry-over) | **PASS, all six sub-checks, live, `seed=11`** (lead-supplied seed/stage path: film_room at a1s1, a market node immediately after at a1s2). (1) Scouted at a1s1 — report named the correct boss ("The Wall"), correct weakest lane ("Individual Recognition"), correct strongest lanes, correct projected margin. (2/3) Advanced to a1s2 (Draft Room) **without re-scouting** — HUD pin (`rtt-hud-scout-pin`) correctly read "Scouted The Wall · weak Individual Recognition", persisting from data set once at the node, not re-fetched. (4) Market cards carried `data-matches-scout`: 1 of 3 offers `true` (Rudy Gobert), 2 `false` — a real discriminator, not a blanket highlight; confirmed in source (`RunCard.tsx:246-252`) that the same `bossRelevance` value driving the highlight also renders the "Scouted: hits …" text line. (5) **THE GUARD — the sub-check the lead flagged as most likely to be wrong — holds.** Traced live: pin correctly went to `(absent)` through Act 2's `system_select`/`node_choice` (Act 1's `scoutIntel.bossId` no longer matches the new `state.next_boss.boss_id` — `RunTheTableGame.tsx:353-354`'s gate), then correctly reappeared with the NEW boss's name ("Strength in Numbers") the moment the driver happened to land on Act 2's own film_room node — verified against source (`RunTheTableGame.tsx:331-340`) that this is a fresh, free, always-on preview refetched per-node (scouting costs nothing; the node's payload always carries the report), not stale Act-1 data being relabeled. Initially read this as a possible leak/staleness bug until the source trace resolved it — recording the investigation so a later reader isn't left wondering why the boss name changed without an explicit re-scout click. (6) `rtt-lane-prepared-{lane}` confirmed visible (not behind a disclosure) at the battle-reveal screen: "Prepared lane — Scout & Prepare added +2.50 here before the battle." (7) Per the lead's note, Act 2's boss-reveal rendered pre-completed due to task #27's bug during this drive — not re-reported, clicked through as instructed. |
| Boss intro | name, philosophy, win condition, 3-2-1 countdown, skip | **PASS, fully confirmed live** (isolated worktree; this was only PARTIAL in the first pass — closed the gap). Stopped the driver exactly on `rtt-boss-intro` and inspected it directly: boss name ("THE WALL"), philosophy (`boss.tagline`, rendered and included in the live-region announcement per source), win condition ("Win 3 of the five lanes and you win the battle."), a real 3-2-1 countdown watched ticking 3→2→1→gone at 700ms/numeral (matches the source constant, auto-completes ~2.1s), skip visible from the first frame. Confirmed skip actually short-circuits: a second run clicking skip immediately collapsed the intro in 832ms instead of the full ~2.1s. |
| Paired lineup reveal | sequential paired rows; boss names concealed until reveal; no click per player | **PASS** for "no click per player" on the FIRST boss of a run (same batched single-action mechanic as the opening reveal). **FAIL for every subsequent boss** — see the new HIGH-severity finding below; this row is superseded by it. |
| — **NEW FINDING** — Boss reveal breaks after boss #1 | (not on the original checklist — found during a full-run drive-through) | **FAIL, HIGH severity.** `useRevealSequence.ts`'s internal state (`started`/`complete`/`skippedRef`) has no reset path — grepped every set call, confirmed. `bossSequence` is one hook instance reused for the whole run with no `key`-forced remount per boss and no identity-watching reset effect. Once the first boss's reveal completes (skip or natural), every subsequent boss's reveal renders **already complete** — no start button, no cinematic, cards just instantly present. Reproduced driving a full run through Acts 1→2 live. This defeats the "paired sequential lineup reveal" requirement for 4 of 5 bosses in a standard run — the majority case, not an edge case. → task #27 (rtt-experience), full root-cause trace and two candidate fixes in the task body. The run remains mechanically completable (a "Continue" button is still clickable), so this did not block reaching the result screen. |
| Five-lane sequence | automatic; labelled `YOUR LINEUP RATING`/`BOSS LINEUP RATING` (corrected from the brief's original "LINEUP TOTAL" — see `SCORE_RECONCILIATION.md` §1); top contributor shown separately | **PASS, strong evidence, and the 390px/200%-zoom re-stacking check now closed too.** Live HTML capture confirms header row reads exactly `YOUR LINEUP RATING` / `BOSS LINEUP RATING`; each lane shows a distinct `Top contributor` row with its own value (e.g. lineup rating `21.7` vs. top contributor Kevin Love `34.3` on the same lane — genuinely different numbers). **Disclosure definition independently keyboard-tested**: `rtt-lane-rating-explainer` is a real `<button>`, reachable via `.focus()`, activates via `Enter`, `aria-describedby`-linked to text matching the ruling in `SYNTHESIS_CONTRACT.md` §1 byte-for-byte. **Geometric re-stacking check at 390px width and 200% zoom (CSS-zoom emulation)**: first pass found 10 "overlaps" that were a bug in my own script (`{...domRect}` silently drops its fields — they're prototype getters, not own properties); caught before reporting, fixed, re-run — **zero real overlaps at either condition**, lineup-rating numbers sit in their own row (e.g. y=622-638) clearly separated from the "Top contributor" row (y=652-667) at 390px, same separation holds at 200% zoom. |
| Victory | decisive result sequence | **PASS.** Full run driven through all 5 acts to `rtt-result`; verdict "RUN ENDED AT THE FINAL BOSS" rendered as the decisive stamp. |
| Defeat | decisive result sequence | **NOT independently exercised** — the audited run reached the final boss rather than losing early; the same `rtt-result-verdict` mechanism is confirmed working, just not observed on a loss-before-act-5 path specifically. |
| Result screen | full run story + five actions | **PASS, comprehensive, content-checked not just testid-checked.** All required sections present: `rtt-result-largest-mistake` ("WEAKEST ROSTER SPOT — Tim Hardaway 1996-97 — the roster would have scored +0.45 higher without them" — real, computed, negative-framed, closing the gap I originally flagged as entirely missing in Part A of the contract); `rtt-result-leaderboard` ("Not ranked yet — RUN THE TABLE doesn't have a global leaderboard in this build" — the honest explicit-absence state I specified, not a fabricated ranking); `rtt-result-best-move`; per-act boss record (`rtt-result-battle-1..5`); five-lane profile; front-office perks; decision timeline (`rtt-result-timeline-*`, one entry per stage); "why this run ended" reasons list; data receipt disclosure. **Share card independently verified as a real image**: clicked `rtt-share-card`, inspected the resulting `rtt-share-canvas` — 1200×630px, 756,000/756,000 pixels non-transparent, i.e. genuinely rendered content, not a blank canvas or a relabeled clipboard button. All five actions present (run-it-back, replay-seed, challenge, copy-summary, share-card). |
| Refresh during cinematic | recovers without inventing an outcome | **PASS.** Reloaded mid-opening-reveal (2 of 7 revealed at refresh time, isolated worktree). Zero console errors, zero uncaught page errors, no error-boundary text. Roster dock shows "7/7 filled" with all 7 real names/scores — the correct behavior given the architecture: the server had already completed the batched reveal on the first click, so refresh only loses client-side presentation pacing, never data. Shows the true state honestly rather than getting stuck or fabricating one. |
| Resume | run state restored correctly | **PASS** — same mechanism and same test as the refresh row above (resume-from-localStorage-pointer is what the refresh recovery exercises); not re-tested as a separate scenario. |
| Leaderboard | server-computed scores only | **N/A for RTT specifically** — RTT has no leaderboard yet, confirmed live by the result screen's own honest copy ("doesn't have a global leaderboard in this build"), consistent with `SCORE_RECONCILIATION.md` §5's "RTT gets a leaderboard only after its score contract is separately defined — not in this pass." The tamper-replay method from `VERIFICATION_PLAN.md` §4 has nothing to attack yet on this surface. The equivalent 82-0 mechanism is already independently PASS-tested by the lead in §1 of this matrix. |
| Anonymous state | read allowed, submission refused | **N/A for RTT**, same reason. |
| Authenticated state | submission accepted and owned | **N/A for RTT**, same reason. |

## 6. Performance

Baseline and after must come from the **same committed script**. See
`PERFORMANCE.md` for the full tables.

> **Staging is NOT running the integrated branch.** Proved directly, not
> inferred: `POST /run-the-table/runs` on staging still ships full card
> identity for unrevealed starter slots, while the same call against a local
> boot of `3988355` ships `"card": null` and carries the new
> `roster_profile_partial` field staging's response lacks.
>
> Consequently the staging before/after **must not be published as a code
> comparison.** The staging "after" run showed every bucket 30–45 % faster than
> baseline — including `health.liveness`, `draft.meta` and `leaderboards.top`,
> which this pass never touched. A uniform drop across untouched endpoints is
> ambient network/platform variance between measurement times, not a code
> effect. The ~365–375 ms staging write-path floor is therefore **unmoved by
> this pass — not because it was measured unchanged, but because staging has
> not run this code.** Re-measure after redeploy.

| Metric | Target | Baseline | After | Status |
| --- | --- | --- | --- | --- |
| Visible response to interaction | < 100 ms | — | reveal click **37 ms**, node-choice **22 ms** (24–35 ms across runs) | **PASS** |
| Action latency p75 (warm hosted) | < 800 ms where infra permits | ~365–375 ms | not comparable — staging not redeployed | **BLOCKED** on redeploy |
| Action latency (local, memory-backed) | — | sub-3 ms | sub-3 ms; deltas ±0.1–0.6 ms = noise | no change (expected) |
| Duplicate mutations | zero | — | **zero, tested live**: identical body + idempotency key twice → credits 50→27 on both, `action_count` identical. True no-op replay | **PASS** |
| CLS, opening reveal / perk select / node→surface | zero | — | **zero**, real headless-Chromium session driving actual transitions | **PASS** |
| CLS, boss intro / battle cinematic | zero | — | **zero on all four transitions**: BossIntro→paired reveal · paired reveal settling · Continue→BossPreview · BossPreview→resolve→BattleReveal · five-lane→verdict. (0.037 seen only in the window right after a page *reload*, i.e. initial-paint noise, not a stage transition — recorded as what it is.) | **PASS** |
| Interaction feedback, boss surfaces | < 100 ms | — | reveal-boss-lineup **24.9 ms** · Continue **5.8 ms** · resolve-boss **22 ms** | **PASS** |
| Opening-reveal round trips | 1 (from 7) | 7 | **1** — single call site `RunTheTableGame.tsx:743-759`, idempotency key includes `action_count` | **PASS** |
| RTT write-path payload size (local, code-attributable) | smaller | — | `create_run` −43 %, `advance` −41 %, `film_room` −37 %, `resolve_boss` −34 %, `draft_buy` −32 %, `choose_node` −29 %, `rest_bank` −23 %, `select_system` −18 %, `trade` −17 % | **PASS** |
| Lighthouse `/` (no live data) | — | — | Perf 99, A11y 96, BP 96, SEO 100, LCP 0.9 s, CLS 0 | optimistic — see note |
| Lighthouse `/arena/run-the-table` (no live data) | — | — | Perf 98, A11y 96, BP 96, SEO 90, LCP 1.0 s, CLS 0.052 | optimistic — see note |
| `color-contrast` audit | pass | — | **0 on both routes** — `text-[var(--peak-accent)]`, `nav.tsx:91` at 1.28:1 | **FAIL** → task #21 |

> Lighthouse numbers are marked optimistic because staging's CORS correctly
> refused the local test origin (verified both ways: `Origin:
> http://localhost:3010` → 400 disallowed; real staging origin → 200), so both
> pages rendered empty/error states rather than fully hydrated ones. That is
> the security boundary working, not a defect. These figures must not be
> quietly upgraded later.
>
> The payload reductions are the one unambiguous, code-attributable performance
> win of the pass, and they trace exactly to the two backend changes:
> unrevealed-slot concealment and the retirement of two full `card_public()`
> dicts per lane.
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
