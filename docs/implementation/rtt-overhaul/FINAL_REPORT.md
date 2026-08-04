# FINAL REPORT — Arena RTT Overhaul

Branch `feature/arena-rtt-overhaul`, from `7c743f1`. Not merged. Not deployed.

## 1. Team and ownership

| Agent | Role | Worktree / branch |
| --- | --- | --- |
| `lead` | Task graph, contracts, integration, arbitration, hosted validation | `~/Desktop/PEAK3` · `feature/arena-rtt-overhaul` |
| `product-director` | Product/UX research, then adversarial verifier. **Read-only on code throughout.** | none |
| `score-integrity` | Score semantics, Python engine, API, leaderboard, migrations | `~/Desktop/PEAK3-agent-score` · `wt/arena-score` |
| `rtt-experience` | RTT frontend experience | `~/Desktop/PEAK3-agent-rtt` · `wt/arena-rtt` |
| `platform` | Theme, homepage, leaderboard UI, assets, performance | `~/Desktop/PEAK3-agent-platform` · `wt/arena-platform` |

35 tasks tracked with explicit dependencies. `#8` (theme tokens) gated `#9`/`#10`/`#11`
so no two agents could invent competing visual systems — the single most important
edge in the graph.

## 2. Integration

Cherry-pick order held: score/API → theme/shared primitives → RTT frontend →
homepage/leaderboards → test and generated-file reconciliation.

| Commit | Content |
| --- | --- |
| `029c830` | score: reveal concealment, battle receipts, leaderboard gaps, daily board |
| `c8d6151` | platform: theme system, homepage, Arena Leaderboards hub, token migration |
| `f6db64b` | platform: migration inventory closure |
| `6db8b9c` | rtt: reveal, boss cinematic, game shell, decisions, result, receipts |
| `3988355` | text-safe token convergence + Lighthouse |
| `67489cb` | lead: retired the integration-window aliases |
| `f1687de` | rtt: decision-first cards + scout intel payoff |
| `cad1a23` | platform: live color-contrast fix — **first real conflict, resolved centrally** |
| `a169de7` | rtt: boss-reveal reset, reveal timing trim, raw ids out of copy |
| `f428f45` | platform: remaining axe contrast failures |
| `6e91619` | platform: measured raw-accent sweep in the last CSS files |
| `86b5555` | rtt: 390px boss-reveal overflow + e2e driver repair |
| `422be1b` | rtt: three reveal e2e tests fixed against the ruled skip behaviour |
| `f1eb4a6` | platform: two e2e tests repaired for the hydration race |

**One conflict in the whole pass**, in `RunTray.tsx` / `RunResult.tsx`. It was
structural: platform edited an older `RunTray` where a position held a score,
which rtt had since rebuilt into the concealment-aware dock. Resolved by keeping
rtt's structure and re-applying platform's intent mechanically (13 token swaps,
verified zero remaining), confirming a file rtt deleted was not resurrected, and
checking all five rtt features survived. Neither side's work was dropped.

## 3. Files changed by subsystem

| Subsystem | Files |
| --- | --- |
| `apps/web` (non-RTT) | 122 |
| RTT components | 23 |
| `docs/` | 16 |
| `apps/api` | 10 |
| `supabase/` | 4 |
| `scripts/` + `tests/` | 4 |
| `nba_peak/` | 2 |

## 4. Score-semantic reconciliation

`27.2` is a **bench-weighted mean of a 0–100 normalized component index across
the whole roster** — `Σ(wᵢ × lane_indexᵢ) / Σ(wᵢ)`, starters 1.00, bench 0.35
(`battle.py:99-125`). Not an individual's value, and not a sum.

Labels are now **`YOUR LINEUP RATING`** / **`BOSS LINEUP RATING`**, defined in the
UI as "the bench-weighted average strength of the lineup in that PEAK3 component,
normalized to a 0–100 scale". Contract field `lane_rating`/`lineup_rating`;
`roster_total` reserved for the distinct existing quantity. The top contributor
renders its **own** value from `card.lane_index` — two numbers, each attributed.

The brief specified `LINEUP TOTAL`. Overruled on evidence with the product
owner's approval: the quantity is a mean, and `roster_total` already names a
different thing.

## 5. Was there a numerical defect?

**No.** 3 seeds × 5 bosses × 5 lanes = **75 lane-battles**, independently
recomputed, **75/75 bit-identical**. In **0 of 75** did the named contributor's
own value equal the number displayed above their name — so the misread was not an
edge case, it was every lane of every battle. The defect was **entirely
presentational**.

## 6. Ranking regression evidence

| Check | Result |
| --- | --- |
| 5 canonical CSV sha256 hashes | identical to Phase 0 anchors |
| `peak3.py` diff | empty — `OFFICIAL_WEIGHTS` and `calibrate_score()` untouched |
| model-tests | 939 → **955 pass / 0 fail** |
| api-unit | 1198 → **1209 pass / 0 fail** |
| RTT simulation audit | **PASS** — 19 invariants, 300 seeds, 2400 runs, 43 replays, 0 warnings, 174/174 cards reachable |
| lineup tests | **43 pass** |
| dataset exporter | regenerates and validates |

Engine diff is **+39 lines, 0 deletions** — purely additive receipt fields.
Lane scores, margins and winners untouched.

## 7. Opening reveal — before / after

| | Before | After |
| --- | --- | --- |
| Identities on screen | all 7 from frame one (`public.py:698-699`) | 7 concealed slots |
| Round trips | 7 | **1** |
| Pacing | manual click per card | one action, auto-queued |
| Duration | n/a | **10853 ms** median (production build), 1147 ms under ceiling |
| Controls | skip-all only, after card 1 | pause · skip-all · reduced-motion |

Leak verified fixed across **three independent surfaces** — network body, full DOM
defeating `display:none`/`visibility:hidden`/`aria-hidden`, and the accessibility
tree — using non-circular ground truth (a real run driven to completion, then a
second independent run on the same seed).

## 8. Boss sequence — before / after

Before: no cinematic at all. `BossPreview` was a static briefing panel — no intro,
no countdown, no skip, nothing to skip.

After: named intro, philosophy, stated win condition, 3-2-1 countdown at 700 ms
per numeral, skip live from frame one, paired sequential lineup reveal using the
**same hook** as the roster reveal, automatic five-lane resolution, persistent
scoreboard, decisive verdict, pause/skip/replay.

**A HIGH-severity bug was found here by live verification and fixed**: one
`useRevealSequence` instance served the whole session with no reset path, so every
boss after the first rendered fully resolved with no start control — 4 of 5 bosses
in every run. Invisible to every test in the codebase, because they all exercise
exactly one boss reveal per run.

## 9. Homepage — before / after

Before: hero-first but catalog-shaped below the fold — a grouped grid of nav
cards at equal visual weight to the hero.

After: full brief scope — hero with real rotating canonical player-window cards
and the mode grid visually subordinate; interactive five-component comparison
built from the real `/api/v1/methodology` payload with click-through into exact
rankings entries; mode gallery; leaderboard preview showing real 82-0 all-time,
daily status and personal best (and **nothing** to signed-out visitors rather than
a fake placeholder); credibility section with no fabricated metrics.

Frozen invariants preserved: single `<h1>` with its exact sentence, exactly one
`[data-featured="true"]`, `MODE_COPY` single source, every `data-testid`.

## 10. Theme

System / Dark / Light via `data-theme`, set by a blocking pre-paint script.
Dark = Arena Night (existing palette, unchanged). Light = Arena Day / Press Box —
warm-white to light-grey, never pure white.

Verified as an **objective property, not a look**: elevation ordering
(page < elevated < surface) holds in both themes by relative luminance, and a
naive-inversion distance test proves light is **not** the mathematical inverse of
dark. Zero FOUC, zero hydration errors, system preference resolves both
directions. `--peak-accent` and all six `--comp-*` byte-identical across themes.

## 11. Performance

Measured with a committed script, re-run **unmodified**.

| Metric | Result |
| --- | --- |
| RTT write-path payloads | **−17 % to −43 %** across every bucket |
| Opening-reveal round trips | 7 → **1** |
| Duplicate mutations | **zero**, tested live (credits moved once, not twice) |
| CLS, all surfaces incl. boss cinematic | **zero** |
| Interaction feedback | 4.1–37 ms against a 100 ms budget |
| Lighthouse | Perf 99/98, A11y **100** after fixes |

**Staging p50/p75/p95 before/after is deliberately NOT published as a code
comparison.** Staging is not running this branch — proved directly, not inferred.
Its "after" run showed every bucket 30–45 % faster including endpoints this pass
never touched, which is ambient variance, not a code effect. The ~365–375 ms
write-path floor is infrastructure-bound and unmoved.

## 12. Global leaderboard

Server-computed scores only; the submit request carries **only** `game_id`.
Authenticated submission enforced, anonymous refused, ownership enforced,
duplicate submissions idempotent, tie-breakers indexed to match the query.

Closed this pass: `next_cursor` pagination (was always `null` — reproduced live on
staging), personal placement, privacy/hide controls, the email-local-part handle
fallback, and a daily board using the shared America/Los_Angeles boundary.

Cross-user modification verified **live**: three consecutive non-owner calls
returned byte-identical 404s — no retry-count path to defeat — and an anonymous
caller received the same 404, leaking no reason.

`COURTBUILDER_LEADERBOARD_ENABLED` remains `False`. Ranked untouched and disabled.

## 12a. What verification caught that nothing else did

Eight defects in this pass were invisible to typecheck, lint and 1335 unit
tests. Each surfaced only by running a real artifact, and each by a *different*
runner — which is the transferable result.

| Defect | Surfaced only by |
| --- | --- |
| `*/` inside a CSS comment closing the block early | `next build` |
| `text-[var(--peak-accent)]` at 1.28:1 on every page | Lighthouse |
| `--accent-*` as text on its own `color-mix` wash | the axe suite |
| Boss reveal broken for 4 of 5 bosses per run | driving a multi-act run |
| Boss reveal card overflowing the viewport at 390px | watching it at 390px |
| e2e driver missing the `rtt-boss-intro` case | running the suite at all |
| e2e driver not clicking Continue past a reveal | running the new test |
| axe's own false PASS at 1.40:1 | a `getComputedStyle` cross-check |

Two of these — the driver defects — were regressions **this pass introduced
into its own test suite**, invisible because the suite had never been run.

Four false positives were also self-caught by the agents that found them,
before reporting: a `DOMRect` spread silently dropping prototype getters; a
BSD-grep `\b` zero-result that had matched nothing; Playwright `fullPage`
screenshots stitching sticky elements mid-page; and a `.next/` write-conflict
presenting identically to a click race.

## 12b. Testing-architecture gaps found

- **The committed Playwright suite can never exercise a production build.**
  `NEXT_PUBLIC_PEAK3_E2E_AUTH` is compiled away by `NODE_ENV=production` by
  design, and `playwright.setup.ts`'s global setup requires it, so a production
  build fails setup before any test runs. The e2e layer therefore only ever
  tests `next dev`. Permanent, structural, and previously unknown.
- **`BASE_URL` does not suppress `playwright.config.ts`'s own `webServer`**, so
  a manual `next start` and Playwright's `next dev` write-conflict on the shared
  `.next/` output — a failure that presents identically to a click race.
- **Client hydration**: 300–550 ms in `next dev`, **18–112 ms in a production
  build**. Two e2e tests raced it. Ruled a test defect on that measurement, with
  the threshold fixed before the number was known. The unconditional
  `@supabase/ssr` static import is the identified lever, documented and
  deliberately **not** acted on — auth-adjacent refactoring is a separate pass.

## 13. Test totals

| Suite | Baseline | Final |
| --- | --- | --- |
| model | 939 / 0 fail | **955 / 0 fail** |
| api unit | 1198 / 0 fail | **1209 / 0 fail** |
| frontend vitest | 1258 across 47 files | **1335+ across 51 files** |
| lineup | not run | **43 / 0 fail** |
| axe accessibility | never invoked | **13/13 specs, 0 violations** (17 → 5 → 0 across two fixes) |
| typecheck / lint | clean / 0 warnings | clean / **0 warnings** |
| production build | — | succeeds with real HTTPS API URL |

## 14. Hosted staging acceptance

**BLOCKED — awaiting redeploy.** Staging does not run this branch; 47+ commits are
unpushed and no Railway/Vercel CLI is available. Google sign-in, RTT save/resume,
82-0 save, leaderboard submission and the cross-account IDOR check cannot be
exercised against hosted staging until it is redeployed. The new migration
`20260803090000_perfect_season_daily_leaderboard_index.sql` has never run against
hosted Postgres.

## 15. Remaining external blockers

1. **Staging redeploy** — needs console access or a push the lead did not take
   unilaterally.
2. **Asset licensing** — every resolved asset self-declares
   `license_status="unknown_do_not_cache"` and
   `cache_policy="dev_hotlink_preview_only"`. Enabling
   `PEAK3_ENABLE_EXTERNAL_ASSET_URLS` publicly is a **licensing decision, not an
   engineering one**, and is not presented as resolved.

## 16. Confirmations

- **No formula change.** `peak3.py` diff empty; `OFFICIAL_WEIGHTS` and
  `calibrate_score()` untouched; 5/5 canonical CSV hashes identical.
- **No Ranked enablement.** All four ranked flags `False` and untouched by the pass.
- **No authorization weakening.** RLS intact, ownership enforced, IDOR verified
  live on first attempt, anonymous submission refused.
- **No secrets committed.** Clean scan across the full diff; zero `.env` files
  touched.
- **No merge to `main`.**
- **No public deployment.**
