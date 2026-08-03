# RUN THE TABLE / 82-0 — Performance & Platform Audit

Owner: platform (P1-C). Scope: measurement and audit only — no product code
changed in this pass. Everything below is either a number this session
actually observed, or a finding traced to a specific file and line. Anything
that could not be measured is marked **NOT MEASURED**, with the reason,
rather than estimated.

Worktree: `PEAK3-agent-platform` on `wt/arena-platform`, based on
`main`/`feature/arena-rtt-overhaul` at commit `7c743f1244568ee921e98a967d22c1ff6e28be90`.

---

## BASELINE (before)

### Tooling

`scripts/perf/measure_rtt.py` is the measurement script. It is meant to be
re-run **unmodified** after the RTT overhaul lands so the "after" numbers are
comparable to the "before" numbers below — see the script's own docstring.
It:

- drives real, complete RUN THE TABLE playthroughs through the public API
  (`select_system` → `choose_node` → whichever of `draft_buy`/`draft_pass`,
  `trade`/`decline_trade`, `film_room`, `rest_bank` the node requires →
  `resolve_boss` → `advance`, repeated across all 5 acts, plus `reveal`,
  resume, and challenge-link creation/read), choosing at each `node_select`
  step the node type least-exercised so far in that run, so a single run
  touches all four node types;
- drives real, complete 82-0 (CourtBuilder / Peak Season) playthroughs
  (`create` → `select`/`place` × 8 rounds, with one `respin-team` and one
  `respin-season` exercised per run → `complete` → `shared-result`);
- samples static/stateless endpoints (`/health`, `/health/readiness`,
  `run-the-table/readiness`, `/meta`, `/daily`, `draft/meta`,
  `perfect-season/readiness`, `/leaderboards`) independently, N times each;
- records, per call, wall-clock latency (client-observed round trip — see
  "Server duration" below for why nothing finer exists yet), raw response
  bytes, and gzip-recompressed bytes (to state a compression ratio even
  though gzip already happens at the network edge, not in FastAPI — see
  below);
- writes both a JSON report and a Markdown table per target.

Usage:

```bash
python3 scripts/perf/measure_rtt.py \
  --base-url https://peak3-staging.up.railway.app --label hosted-staging \
  --samples 15 --runs 8 --courtbuilder-runs 8 \
  --out docs/implementation/rtt-overhaul/perf-raw/staging-baseline.json

python3 scripts/perf/measure_rtt.py \
  --base-url http://127.0.0.1:8010 --label local-memory-backend \
  --samples 30 --runs 15 --courtbuilder-runs 15 \
  --out docs/implementation/rtt-overhaul/perf-raw/local-baseline.json
```

Raw JSON + Markdown for both runs are committed under
`docs/implementation/rtt-overhaul/perf-raw/`.

### Conditions

| | Hosted staging | Local |
|---|---|---|
| Web | `https://peak3-staging.vercel.app` (not exercised directly — API measured) | n/a |
| API | `https://peak3-staging.up.railway.app` (Railway, `railway-hikari` edge, region `lax1`) | `uvicorn app.main:app` on `127.0.0.1:8010`, this machine |
| DB backend | Real Postgres/Supabase (staging config) | **In-memory repositories** (`PEAK3_DATABASE_URL` unset → `apps/api/app/core/repository_registry.py` resolves every domain to `memory`) — see the "local is not comparable" note below |
| Dataset | `data/web/` built from committed leaderboard CSVs at this commit; card pool v3, 174 eligible 3-year cards | Same build, same commit, run locally via `scripts/ci/build-web-data.sh` |
| Measured at | 2026-08-03T06:36:15Z (see `staging-baseline.json` → `meta.timestamp_utc`) | 2026-08-03T06:33:15Z |
| Client location | This session's egress point (not controlled/known — see "cross-region latency" below) | Same machine as the server (loopback) |
| Sample sizes | 15 samples/static endpoint; 8 full RTT playthroughs; 8 full 82-0 playthroughs | 30 samples/static endpoint; 15 full RTT playthroughs; 15 full 82-0 playthroughs |
| RTT run outcome | All 8 runs ended `failed` (a boss loss before act 5) — expected: the script buys/trades opportunistically for endpoint coverage, not to win. Every run exercised all 4 node types at least once (see `rtt_run_outcomes` in the JSON). | Same — 15/15 `failed`, same reason |
| 82-0 run outcome | 8/8 reached `result_ready` | 15/15 reached `result_ready` |

**Local is not a clean "same conditions, different network" baseline.** It
runs on in-memory repositories, not Postgres, so its numbers show pure
engine/serialization cost with the DB round-trip removed — useful for
isolating "is this slow because of the network, the DB, or the CPU work,"
but it is **not** a fair before/after comparison point for anything that
touches persistence (every write action, i.e. every POST). Any "after"
comparison should be staging-to-staging, or a local run explicitly
reconfigured with `PEAK3_DATABASE_URL` pointed at a real Postgres.

### Server duration

**NOT MEASURED as a distinct number: no timing header exists to read.**
`apps/api/app/main.py` adds no `Server-Timing` header and no
request-duration middleware; Railway's edge (`server: railway-hikari`) adds
none either. The latency numbers below are therefore client-observed wall
clock (`time.perf_counter()` around the full HTTP round trip), which is
network + server combined, not server-only. The local-vs-staging comparison
below is the closest available proxy for "how much is network / infra
versus engine work," and it is a strong signal (see "Top bottlenecks").

### Cold start

**A true platform cold start (Railway scale-to-zero) was NOT MEASURED.**
Triggering one requires idling the staging deployment past its scale-down
window first, which this audit did not do (staging is a shared environment
and idling it on purpose was out of scope for a measurement pass). What
*was* measured is new-TCP-session vs. warm-keep-alive-connection latency,
which is a different and much smaller effect:

| | New TLS/TCP session, first request | Same session, next 5 requests |
|---|---|---|
| Staging | 166.1 ms | 59–60 ms each |
| Local | 0.9 ms | 0.6–0.7 ms each |

On staging the new-connection overhead (TLS handshake + connection setup) is
itself already ~106 ms on top of the ~60 ms steady-state round trip — i.e.
a cold browser tab's *first* API call costs roughly 2.75× a warm one before
any server work happens at all, purely from connection setup. That is a
real, measured cost distinct from (and additive to) any true cold start.

### Cross-region latency

**Not independently isolated.** The ~60 ms floor on every staging static GET
(readiness, meta, daily, draft/meta — all trivial reads) is consistent with
one client↔`lax1`-edge round trip; this session's actual network path to
`lax1` was not otherwise instrumented (no traceroute/geo lookup run), so
"60 ms is mostly network, not app" is an inference from the local-vs-staging
gap, not a directly measured network-only number.

### Results — hosted staging

8 full RUN THE TABLE playthroughs, 8 full 82-0 playthroughs, 15 samples per
static endpoint. Full detail: `perf-raw/staging-baseline.json` /
`.md`.

| bucket | n | p50 ms | p75 ms | p95 ms | raw bytes (median) | gzip bytes (median) |
|---|---|---|---|---|---|---|
| health.liveness | 15 | 60.9 | 64.7 | 102.8 | 61 | 77 |
| health.readiness | 15 | 60.1 | 62.3 | 63.4 | 110 | 110 |
| rtt.readiness | 15 | 59.1 | 62.4 | 65.7 | 376 | 227 |
| rtt.meta | 15 | 59.8 | 61.1 | 64.7 | 4,858 | 1,955 |
| rtt.daily_descriptor | 15 | 59.9 | 62.0 | 64.6 | 312 | 203 |
| draft.meta | 15 | 60.7 | 63.7 | 73.1 | 818 | 473 |
| courtbuilder.readiness | 15 | 63.3 | 63.8 | 73.3 | 7,953 | 1,882 |
| leaderboards.top (years=3, limit=50) | 15 | 65.4 | 67.2 | 77.2 | 25,894 | 5,171 |
| **rtt.create_run** | 8 | 217.0 | 223.4 | 600.7 | 12,038 | 3,229 |
| rtt.resume_get_run | 8 | 217.5 | 226.4 | 286.0 | 13,511 | 3,378 |
| **rtt.select_system** | 16 | 364.4 | 374.0 | 435.2 | 18,146 | 3,819 |
| **rtt.choose_node** | 64 | 369.2 | 374.2 | 404.8 | 32,407 | 5,176 |
| **rtt.draft_buy** (purchase) | 18 | 366.3 | 372.3 | 430.9 | 22,764 | 4,367 |
| **rtt.trade** | 16 | 370.1 | 375.9 | 410.9 | 35,069 | 5,520 |
| **rtt.film_room** | 15 | 370.9 | 386.6 | 409.5 | 29,805 | 5,246 |
| **rtt.rest_bank** | 15 | 369.2 | 373.5 | 406.1 | 32,057 | 5,076 |
| **rtt.resolve_boss** (boss resolution) | 32 | 369.8 | 374.4 | 389.8 | 42,898 | 5,905 |
| **rtt.advance** | 24 | 371.3 | 379.3 | 417.5 | 31,997 | 5,086 |
| rtt.reveal | 8 | 366.9 | 371.6 | 528.7 | — (empty body) | — |
| rtt.create_challenge | 8 | 209.1 | 211.2 | 212.3 | — | — |
| rtt.get_challenge | 8 | 60.2 | 62.6 | 66.4 | 263 | 166 |
| **courtbuilder.create_game** | 8 | 250.0 | 257.3 | 996.5 | 10,227 | 1,474 |
| **courtbuilder.select_player** (candidate loading) | 64 | 389.6 | 400.0 | 484.1 | 7,575 | 1,668 |
| **courtbuilder.place_card** | 64 | 492.4 | 557.8 | 647.4 | 12,350 | 2,157 |
| courtbuilder.respin_team (82-0 spin) | 8 | 397.4 | 439.7 | 559.8 | 10,869 | 1,638 |
| courtbuilder.respin_season (82-0 spin) | 8 | 431.7 | 436.9 | 439.9 | 11,996 | 1,894 |
| **courtbuilder.complete_game** | 8 | 634.9 | 651.6 | 664.5 | 10,987 | 2,970 |
| courtbuilder.shared_result | 8 | 297.5 | 300.9 | 337.5 | 9,888 | 2,678 |

### Results — local (in-memory backend; engine-only floor, see caveat above)

15 full RUN THE TABLE playthroughs, 15 full 82-0 playthroughs, 30 samples
per static endpoint. Full detail: `perf-raw/local-baseline.json` / `.md`.

| bucket | n | p50 ms | p95 ms | raw bytes (median) | gzip bytes (median) |
|---|---|---|---|---|---|
| health.readiness | 30 | 0.7 | 0.9 | 118 | 115 |
| rtt.meta | 30 | 0.8 | 1.1 | 4,858 | 1,955 |
| rtt.create_run | 15 | 2.4 | 4.3 | 11,949 | 3,195 |
| rtt.choose_node | 108 | 2.9 | 3.6 | 31,258 | 4,913 |
| rtt.draft_buy | 32 | 2.9 | 4.3 | 29,083 | 5,059 |
| rtt.trade | 28 | 3.0 | 3.6 | 26,006 | 4,762 |
| rtt.resolve_boss | 54 | 3.3 | 4.6 | 38,377 | 5,557 |
| courtbuilder.select_player | 120 | 22.3 | 40.7 | 7,395 | 1,606 |
| courtbuilder.place_card | 120 | **103.1** | 198.3 | 11,764 | 2,004 |
| courtbuilder.respin_team | 15 | 22.0 | 30.3 | 10,322 | 1,509 |
| courtbuilder.respin_season | 15 | 49.7 | 67.8 | 11,568 | 1,815 |
| courtbuilder.complete_game | 15 | 215.3 | 230.0 | 10,499 | 2,898 |

### Top bottlenecks, ranked

1. **Every RTT action round-trip costs ~300 ms more on staging than the
   network floor, and that gap is not explained by payload size.** Static
   staging GETs (readiness/meta/daily) sit at a ~60 ms floor; RTT action
   POSTs (`choose_node`, `draft_buy`, `trade`, `resolve_boss`, `advance`,
   …) sit at a flat **~365–375 ms p50 regardless of which action it is**.
   Locally, the *same* actions cost **~3 ms**. Payload sizes are comparable
   between fast and slow buckets (rtt.meta: 4.9 KB in 60 ms; rtt.choose_node:
   32 KB in 369 ms — the byte count does not explain a 6× latency jump). The
   ~300 ms is therefore server-side write-path cost specific to POST
   `/runs/{id}/actions` on staging (Postgres round trip(s) for
   load-then-save, most likely — `apps/api/app/services/run_the_table/runs.py`
   does a `load_run` + `save_run` per action) that local's in-memory
   repositories skip entirely. This is the single largest, most consistent,
   and most actionable number in this baseline.

2. **`courtbuilder.place_card` is disproportionately expensive even
   locally**: 103 ms p50 / 198 ms p95 with an in-memory backend, ~10–30×
   slower than every RTT action bucket measured under the same conditions.
   On staging it is 492 ms p50 / 647 ms p95. `action_place_card`
   (`apps/api/app/services/perfect_season/state.py:367`) itself is simple
   state mutation; the cost is almost certainly in `get_public_state`'s
   card-resolution path for `apex_1y` mode (`resolve_card_by_window_id` /
   `resolve_card`, `nba_peak/perfect_season/*`), which is worth profiling
   directly before the overhaul touches this surface.

3. **`courtbuilder.complete_game` is the single slowest bucket measured**:
   634.9 ms p50 on staging (215.3 ms even locally, in-memory). It runs a
   full season simulation (`simulate_season`/`simulate_exact_season`) —
   expected to be heavier than a single action, but worth confirming it is
   not doing more scoring work than the result screen actually needs.

4. **Every RTT action response re-sends the entire run state — there is no
   diff/delta contract.** `RunStateResponse` (`apps/api/app/models/run_the_table.py`)
   is `public_state()`'s whole dict, every time: the 5-act × 2-stage `map`
   array, the full `credit_sinks` catalogue, `armed` effects, `lane_profile`,
   `systems`, both `starters` and `bench`, etc. — all of it, on every single
   POST, whether or not that action touched it. Measured raw sizes climb
   through a run as the map fills in: `rtt.create_run` starts at 12 KB and
   `rtt.resolve_boss` (deep into a run) is 43 KB raw / 5.9 KB gzip. Over a
   ~20–32-action run (the sample runs averaged 20–32 steps) that is
   **600 KB–1.4 MB of raw JSON transferred per playthrough** for state that
   is 90%+ identical between consecutive calls. `rtt.meta` (4.9 KB) is the
   size of what is genuinely static per-run; everything above that in an
   action response is either genuinely new (the one thing that changed) or
   restated. This is the concrete target for a diff-based or
   partial-response contract in the overhaul.

5. **New-connection overhead is ~106 ms on top of the warm-connection
   floor on staging** (166 ms cold vs. 60 ms warm — see "Cold start"
   above). A first-load visitor pays this before their first byte of game
   data.

6. **`getAccessToken()` runs on every single RTT API call, read or write**
   (`apps/web/src/lib/run-the-table-api.ts:63-69`, inside `rttFetch`, the
   one function every read and write funnels through). For a signed-in
   player this is a real Supabase SDK `client.auth.getSession()` call per
   request — including on every `choose_node`/`draft_buy`/etc. during a
   run, and even on the read-only static-endpoint fetches in `boot()`. It
   is not memoized or batched with the action call it guards. This was not
   independently timed (the script above plays as an anonymous guest, where
   `getSupabaseClient()` returns null and the call short-circuits for free —
   see the code comment there), so its cost for a signed-in player is
   **NOT MEASURED**, but the shape of the problem — an auth lookup awaited
   serially before every single one of ~20-30 requests in a run — is a
   real, code-verified finding independent of the number.

### Duplicate requests

No duplicate/redundant requests were found in the RTT boot sequence itself:
`RunTheTableGame.tsx`'s `boot()` fires `readiness`, `daily`, `challenge`
(only when a token is present) and `meta` together via `Promise.allSettled`
— four calls, each to a different endpoint, none repeated
(`apps/web/src/components/run-the-table/RunTheTableGame.tsx:230-244`). No
polling loop, no re-fetch-on-focus beyond the deliberate daily-rollover
listener (`useDailyReset`, armed only at the start gate or during an
in-progress daily run). What *is* effectively "repeated" is not a duplicate
HTTP call but the payload-shape problem in bottleneck #4 above — the same
invariant state repeated inside each response rather than the same request
repeated.

### Rerender counts

**Not measured with React DevTools Profiler** (headless, no browser
attached — per the assignment this had to be reasoned from code with
instrumentation, not run through the profiler UI; no temporary
instrumentation was added in this pass since it would have touched files
owned by `rtt-experience`). From reading `RunTheTableGame.tsx`:

- The entire run is one `useState<RunPublicState | null>` (`state`,
  `RunTheTableGame.tsx:171`). `commit()` (`:224`) replaces the whole object
  on every action. Because the object identity changes on every commit, any
  child that reads any field of `state` — not just the field the action
  changed — is a candidate for re-render unless memoized. `RunTheTableGame`
  itself is not wrapped in anything that would prevent this; it is a large
  function component that computes `screen`, `node`, `battle`, and multiple
  derived values inline on every render (`:609-611` and below) rather than
  via `useMemo`.
- Several `useEffect`s key narrowly on derived primitives rather than the
  whole `state` object (`nodeId`/`nodeType`/`nodeOfferCount` at `:380-392`,
  `terminalStatus`/`receiptRecord` at `:394-409`, `surfaceKey` at `:431-445`)
  — this is a *good* pattern that limits effect re-fires, but it does not
  by itself limit child component re-renders, which are a separate concern
  from effect re-firing.
- No `React.memo` was found wrapping the per-node child components
  (`DraftRoom.tsx`, `TradeDesk.tsx`, `ScoutPrepare.tsx`, `RunMap.tsx`,
  `CreditSinks.tsx`, `LaneProfile.tsx`) in a scan of their exports; each
  likely re-renders on every parent commit regardless of whether its own
  props changed. Given `state` is fully replaced ~20-30 times per run, this
  is consistent with (but not proof of) unnecessary re-render volume — a
  real Profiler run is needed to turn this into a number.

### Blocking image waterfalls / CLS during RTT stage transitions

RUN THE TABLE renders **no images at all** — no headshots, no logos.
`apps/api/app/services/run_the_table/public.py` never references
`headshot_url`/`team_logo_url`/asset URLs anywhere (grepped, zero hits), so
there is no image waterfall to measure on this surface; every card is
text/CSS. Stage transitions swap the decision-surface component
(`DraftRoom`/`TradeDesk`/`ScoutPrepare`/rest-bank choices) under
`RunTheTableGame`'s screen switch — **layout-shift risk here is
structural, not image-driven**: each transition unmounts one surface and
mounts a differently-sized one (a 3-card draft grid vs. a 2-column trade
desk vs. a 3-choice scout list), and nothing in the shell reserves a
fixed-height slot between them (`rtt-decision-surface` in the skeleton has
no matching min-height constraint carried into the live surfaces, from a
read of `RunSkeleton.tsx` vs. the live components). **A real CLS number was
NOT MEASURED** — that requires a Lighthouse or web-vitals run against a
loaded page transitioning through real states, and Lighthouse against a
single static route does not exercise a stage transition at all (see
below).

### Lighthouse

**Lighthouse was RUN.** `lighthouse@13.4.1` added as an `apps/web`
devDependency. Method: `next build` with `NEXT_PUBLIC_API_URL=https://
peak3-staging.up.railway.app` (the deploy-safety guard in `next.config.ts`
refuses a `localhost` value at `next build` time, confirmed again here — see
that file's `assertDeployableEnv()`), served locally via `next start -p 3010`,
audited with `npx lighthouse --preset=desktop --chrome-flags="--headless=new
--no-sandbox"` against both routes. A local API was also booted in-memory on
`127.0.0.1:8010` per the ask, but the *built* bundle's API URL is inlined at
build time and cannot point at it without retriggering the same guard — see
the CORS caveat below for what that means for these numbers.

| Route | Perf | A11y | Best Practices | SEO | FCP | LCP | TBT | CLS | Speed Index | TTI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` (homepage) | 99 | 96 | 96 | 100 | 0.2 s | 0.9 s | 0 ms | 0 | 1.0 s | 0.9 s |
| `/arena/run-the-table` | 98 | 96 | 96 | 90 | 0.3 s | 1.0 s | 0 ms | 0.052 | 0.3 s | 1.0 s |

Raw reports: `homepage.report.{json,html}` / `rtt.report.{json,html}`,
generated in this run (not committed — regenerate with the command above; they
are large Lighthouse artifacts, not source).

**Caveat — this is not a fully-hydrated-page measurement.** The staging API's
CORS allowlist is (correctly, per `apps/api/app/core/config.py`)
`https://peak3-staging.vercel.app` only, verified directly:
`OPTIONS .../run-the-table/meta` with `Origin: http://localhost:3010` returns
`400 Disallowed CORS origin`; the same call with `Origin:
https://peak3-staging.vercel.app` returns `200`. So every live data fetch
(`run-the-table/meta`, `run-the-table/readiness`, `perfect-season/daily`,
`perfect-season/leaderboard`) failed client-side in this local run, and both
pages rendered their empty/error/skeleton states rather than fully populated
ones. This is the CORS boundary working as designed, not a defect — it is a
consequence of auditing a locally-served build against the real staging API
from an origin nothing allowlists. It means the Performance numbers above are
likely optimistic relative to a real fully-hydrated page (less JS work,
smaller payload), and is also *why* the 0.052 CLS on the RTT route is
probably an empty-state artifact, not signal about a real stage transition —
**it still does not answer the stage-transition CLS question this section
originally flagged**, which needs a live run against a real API (Phase 5).

**Real, load-bearing finding despite the caveat — an actual WCAG contrast
failure, live in the rendered page, independent of the CORS issue:**
`color-contrast` scored 0 on both routes. `--peak-accent` (`#f5c842`) is used
as a literal Tailwind arbitrary-value text color (`text-[var(--peak-accent)]`)
against light-mode backgrounds in ~15 files never touched by the `-text`
sibling-token migration (Tasks #17/#20), because that migration's scope was
the 30-file remainder tracked in `THEME_MIGRATION_INVENTORY.md`, not a
codebase-wide grep. Confirmed instances include the header wordmark
(`components/layout/nav.tsx:91`, `<span className="text-[var(--peak-accent)]">
PEAK</span>`, 1.28:1 against `#ece7dc`) and, on the RTT route specifically,
difficulty/rank badges at 1.32:1 and 1.49:1, plus `--foundation-blue` at
3.15:1 and `--apex-coral` at 2.66:1 (both need 4.5:1). Full file list from
`grep -rn "text-\[var(--peak-accent)\]" src/`: `contact`, `privacy`, `terms`,
`accessibility`, `data-sources`, `about`, `methodology`, `players/[slug]`,
`play/endless`, `play/daily`, `c/not-found`, `layout/nav.tsx`,
`layout/Footer.tsx`, `game/reveal-panel.tsx`, `game/game-engine.tsx`,
`game/challenge-summary.tsx`, `rankings/RankingsTable.tsx`,
`rankings/ScoreExplainModal.tsx`. Not fixed here — out of scope for closing
the Lighthouse *measurement* gap — but this is real, reproducible, and the
same bug class as the `--peak-accent-text`/`--comp-*-text` fixes already
shipped; flagging for a follow-up task rather than silently leaving it.

Also observed, noted for completeness, not investigated further (out of
scope for this pass): `label-content-name-mismatch` (nav wordmark's visible
text doesn't fully match its `aria-label`), `errors-in-console` (the CORS
failures above, plus one unrelated 404), and `meta-description` scoring 0 on
the RTT route despite the tag being present and correct in the served HTML
(`curl` confirms it server-side) — Lighthouse's runtime DOM check disagrees
with the static HTML for a reason not chased down here.

### Playwright

`apps/web/playwright.config.ts` exists and is configured
(`screenshot: "only-on-failure"`, Chromium + a `@mobile`-tagged Pixel 5
project) but Playwright **was not run in this pass** — `scripts/ci/e2e-tests.sh`
starts its own API+web services and was out of scope for a
measurement-only phase given the time budget; it is unaffected by anything
in this audit and remains available for whoever runs the full validation
matrix (P6).

### Client hydration window (P6-f/P6-h investigation)

The committed suite later found two failures on this platform's surfaces —
`play-routing.spec.ts`'s "Play panel stays inside the viewport" and
`gameplay.spec.ts`'s "launcher opens by keyboard" — both `getByTestId(...)
element(s) not found` after an interaction fired immediately following
`page.goto(..., { waitUntil: "domcontentloaded" })`. Measured, not assumed:

- **`next dev` (what `dev:e2e`/the committed suite runs):** a click or
  keypress fired immediately after `domcontentloaded` is a real race against
  React attaching its listeners. Measured directly (poll-until-attached, 8
  trials each): nav Play trigger 300-550ms after `domcontentloaded`; homepage
  CTA (keyboard) 300-410ms. Switching only the wait condition to
  `networkidle` took the same test from 10/10 fail to 0/10 fail with nothing
  else changed — this is the mechanism, not a guess.
- **A/B against the specific hypothesis that this pass's nav additions
  (`ThemeToggle`, `AccountMenu`) caused it:** temporarily removed both from
  `nav.tsx`, rebuilt, re-measured. Delay dropped from ~423-554ms to
  ~343-457ms — real, but ~15-20% of the window, not the dominant cause.
  Reverted; `nav.tsx` is unchanged.
- **Production build (`next build` + `next start`, real HTTPS API URL):**
  the same measurement, same two controls, 8 trials each, on a build whose
  integrity was independently confirmed (screenshot + 10/10 scripted
  single-click success before trusting any number): nav Play trigger
  18-112ms after `domcontentloaded` (one 112ms outlier, rest 25-49ms);
  homepage CTA keyboard path 18-44ms. Well under the ~100ms a real user's
  reaction time would need to beat. This is a `next dev` characteristic at
  this project's current size, not a production-facing defect.
- **Could not confirm this last number by running the actual committed spec
  against a production build** — `playwright.setup.ts`'s global setup
  requires the auth surface to render via `NEXT_PUBLIC_PEAK3_E2E_AUTH=1`,
  which is compiled away by `NODE_ENV === "production"` by design (see that
  flag's own docstring) and so can never be true in a real production build.
  The committed suite is structurally wired to run against `next dev` only;
  this is a property of the suite, not something worked around here.
- **A real methodology trap, worth recording so it is not repeated:**
  pointing the committed suite at a manually-served build via `BASE_URL`
  does *not* stop `playwright.config.ts`'s own `webServer` entries from
  trying to start — they key off whether ports 3000/8000 already answer
  healthily, not off `BASE_URL`. If they do not, Playwright starts its own
  `next dev` in the *same* `apps/web` directory as a colocated `next start`,
  and the two write-conflict on the shared `.next/` output — `BUILD_ID`
  disappears, served CSS/JS chunk hashes stop matching the HTML that
  references them, and the page renders unstyled with every static asset
  400ing. That failure looks exactly like the click race under casual
  inspection (`getByTestId(...) not found`) and cost real time here before
  the actual cause (`.next/BUILD_ID` present one moment, gone the next, with
  no edit in between) was traced. Avoid it by ensuring something already
  healthy answers 3000 and 8000 before invoking the suite, not by trusting
  `BASE_URL` alone.

No fix has been made to either test or product for this finding — the
production number was gathered and reported for a scope decision before any
change, per standing instruction on this task.

---

## PLATFORM AUDIT

### Theme: no light mode exists

- Every design token lives under a single unconditional `:root { }` block
  in `apps/web/src/styles/globals.css:23-79` (page backgrounds, text,
  borders, accent, role colors, game states, the six `--comp-*` component
  colors). There is **zero** `prefers-color-scheme`, `data-theme`, or any
  other conditional selector anywhere in the six CSS files under
  `apps/web/src/styles/` (`globals.css`, `nav.css`, `home.css`, `tour.css`,
  `rtt-polish.css`, `spinner.css`, `rankings.css` — grepped, no hits). This
  is a dark-mode-only app by construction, not a dark-mode-by-default app
  with a light mode not yet wired up — there is no second value for any
  token to switch to.
- **217 hardcoded hex colors across 54 `.tsx` files** bypass the token
  system entirely (inline `style={{ color: "#..." }}` or similar), grepped
  across `apps/web/src/components` and `apps/web/src/app`. Every one of
  these is invisible to a future theme switch even if the `:root` tokens
  grow a light variant, because they never reference a `var(--...)` at
  all. Heaviest offenders: `components/draft/DraftReceipt.tsx` (15),
  `components/court/SeasonResultStub.tsx` (11),
  `components/court/SaveRunPanel.tsx` (10),
  `app/(main)/arena/labs/page.tsx` (9),
  `app/(main)/arena/court/history/page.tsx` (9),
  `components/run-the-table/RunMap.tsx` (8),
  `components/court/PeakCardCourt.tsx` (8). A light-mode pass has two
  separate jobs, not one: add the second token set, *and* migrate every one
  of these 217 literals onto tokens first (they cannot follow a theme
  switch as written).
- **SSR/hydration risk**: because there is no theme selection logic at all
  (no `localStorage` read, no cookie, no media-query JS) there is currently
  **no** SSR/hydration mismatch risk from theming — every render, server or
  client, produces the identical single dark palette. This flips the moment
  a theme toggle is added: the standard risk (server renders one theme,
  client re-renders another on hydration once it reads a stored
  preference) does not exist today only because there is nothing to
  mismatch yet. Whoever adds the toggle needs the usual guard (read theme
  before first paint via an inline blocking script or a `suppressHydrationWarning`
  strategy) from day one.

### Homepage: why it reads as a directory

`apps/web/src/app/(main)/page.tsx` was already rewritten once (its own
in-file comments describe a "W2" pass that added `HeroLauncher` and
`HeroVignette` specifically to fix this exact complaint) and the hero
section (`:116-175`) is a real, single-screen arena-style opener: an
eyebrow line, a two-line headline with the gold accent, one CTA, and a live
`HeroVignette` of real ranked peak windows. That part is not a directory.

What makes the page as a whole still read as one: **everything below the
hero is a stacked, labeled list of navigation cards**, in order —

1. "Choose a game" (`:180-306`) — six `GameCard`s across four labeled
   groups (Flagship / Daily · quick play / Full season / Competitive), each
   a clickable tile to a different mode or leaderboard.
2. `ModelProofStrip` (`:312`) — a proof/stats strip.
3. "How a run works" (`:317-418`) — three more cards (Draft/Branch/Battle)
   plus a five-tile component-weight strip.
4. An account CTA band (`:435-492`) with two more buttons (Create an
   account / Sign in).

That is **eleven+ distinct card/tile/button targets** below one hero,
organized under section headings exactly the way a product's `/arena`
catalog page (`apps/web/src/app/(main)/arena/page.tsx`, which this same
page links to at `:186-194` as "Browse the full catalog") would be. The
hero establishes an arena; the page immediately hands the visitor a menu of
everything else the product does, at the same visual weight repeated four
times (once per section), rather than continuing to sell the single
flagship entrance the hero opened with. The structural fix is not
"add more hero" — one already exists — it is that the page has one
arena-quality moment followed by a directory, rather than the arena
extending further down the page before the directory appears.

### Assets

- **Manifest**: `data/game/assets/player_assets.v3.json` (3,494 players)
  and `data/game/assets/team_assets.v2.json` (40 teams), read via
  `nba_peak/perfect_season/assets.py` (`get_player_headshot_url`,
  `get_team_logo_url`, `get_team_logo_url_by_name`) — pure file reads, no
  network calls at request time, cached in-process.
- **Coverage measured directly from the committed manifest**:
  - Players: **534 / 3,494 resolved (15.3%)**, 2,960 unresolved.
  - Teams: **30 / 40 resolved (75%)**.
- **`PEAK3_ENABLE_EXTERNAL_ASSET_URLS`**: implemented
  (`ENABLE_EXTERNAL_ASSET_URLS: bool = False` in
  `apps/api/app/core/config.py:209`), gates every place a URL could reach
  the client (`perfect_season.py`'s readiness/`create_game`/`get_game`/
  `select`/etc. all pass `include_asset_urls=settings.ENABLE_EXTERNAL_ASSET_URLS`).
  **Default off.** RUN THE TABLE never reads this flag at all — it has no
  asset-URL surface to gate.
- **Asset-rights status — reported honestly as unverified, because the
  data itself says so**: every one of the 534 resolved player entries
  carries `"license_status": "unknown_do_not_cache"` and
  `"cache_policy": "dev_hotlink_preview_only"` (verified by reading actual
  manifest rows, e.g. player `a-j-green`: `headshot_url` is a live
  `a.espncdn.com` hotlink). This is not this audit's inference — the
  manifest's own fields already state the rights are unresolved and the
  intended use is dev/preview only, consistent with CLAUDE.md's design
  principle "No player photographs, no NBA/team logos (unlicensed)." Any
  decision to flip `ENABLE_EXTERNAL_ASSET_URLS` on for a real deployment is
  a licensing decision, not an engineering one, and should not be made as a
  side effect of the RTT overhaul.
- **Dimensions / CLS-safety**: `PlayerAvatar.tsx` (the only component that
  ever renders a real `<img>` for a player) sets explicit `width`/`height`
  props and matching inline `style.width`/`style.height`
  (`apps/web/src/components/court/PlayerAvatar.tsx:69-73`) — CLS-safe by
  construction wherever it is used. Team logo `<img>` usages in
  `SpinStage.tsx` and `PeakCardCourt.tsx` were spot-checked and also carry
  fixed container sizing.
- **Local deterministic fallback**: yes, and it is the actual default path
  today (since the flag is off in every environment measured, `imageUrl`
  is never populated for any live caller — confirmed by
  `PlayerAvatar.tsx`'s own docstring: "Absent in every current caller").
  The fallback is a deterministic initials-on-gradient "medallion" —
  `hashString(name)` picks one of six role-palette colors, so the same
  player always gets the same fallback color without any image fetch, and
  an `onError` handler drops back to it if a real `imageUrl` ever 404s.
- **Structurally required anywhere?** No. Grepped
  `apps/api/app/services/run_the_table/public.py` (zero image references)
  and confirmed CourtBuilder's own fallback path is unconditional — no
  code path requires a resolved asset to function.

### Skeleton / loading / error states

- Two skeleton components exist: `components/ui/Skeleton.tsx` (a generic
  primitive) and `components/run-the-table/RunSkeleton.tsx` (a real
  three-zone shell — ladder rail / decision surface / tray — matching
  RTT's actual layout, shown while `booting` is true in
  `RunTheTableGame.tsx:585`, with an `aria-hidden` shell plus a
  screen-reader-only `"Loading your run…"` status line). This is a
  deliberate, well-built skeleton, not a spinner-only placeholder.
- **Where a blank stage can still appear**: between actions (`busy` state,
  `RunTheTableGame.tsx:452-491`), the code disables controls but does not
  swap in any loading affordance — the current surface stays mounted,
  which is generally correct (no flash-to-blank), but on a slow response
  (see the ~370 ms staging p50 above, or its p95 tail past 600 ms on
  `create_run`) there is no visible "working" indicator beyond disabled
  buttons; a player on a slow connection gets no feedback for up to
  ~600 ms+ that anything is happening. This was not visually verified
  (no browser session run) — noted as a code-level gap, not a confirmed
  visual defect.
- Error states: `error`/`retry` state (`RunTheTableGame.tsx:185-191`,
  `465-491`) surfaces the server's own message with a retry that reuses the
  same idempotency key — a real, considered error UX, not a generic
  "Something went wrong" wall (except as an explicit fallback for
  non-API errors).

### Visual regression infrastructure

**None exists today.** No Percy, Chromatic, `toMatchSnapshot`/
`toHaveScreenshot` pixel-diff test, or equivalent was found anywhere in
`apps/web` (grepped `package.json`, all of `apps/web/src/tests`).
Playwright is configured with `screenshot: "only-on-failure"`
(`apps/web/playwright.config.ts:27`) — that is a debugging aid for failed
functional tests, not a baseline comparison. The `capture-*-shots.ts`
scripts under `apps/web/src/tests/tools/` (`capture-readme-shots.ts`,
`capture-ux-polish-shots.ts`, `capture-run-the-table-shots.ts`,
`capture-daily-rtt-pvp-shots.ts`) produce screenshots for human review
(READMEs, PR descriptions) — they are not wired into CI as an automated
diff gate. Anyone wanting before/after visual proof for the overhaul will
need to add that tooling; it does not exist to reuse.

### Frontend test suite (this worktree, this commit)

Ran `scripts/ci/frontend-verify.sh` in full:

| Step | Result |
|---|---|
| `tsc --noEmit` (typecheck) | Pass, no output |
| `next lint --max-warnings 0` | Pass — "No ESLint warnings or errors" |
| `vitest run` (unit) | **47/47 test files passed, 1,258/1,258 tests passed** (8.77s) |
| `next build` (production) | **Failed as run by the script** — `assertDeployableEnv` refuses the build because this worktree's `NEXT_PUBLIC_API_URL` defaults to `http://localhost:8000` (a deploy-safety guard, not a product defect — see `next.config.compiled.js:276`). Re-run manually with `NEXT_PUBLIC_API_URL=https://peak3-staging.up.railway.app npm run build` **succeeded**: all routes compiled, `/arena/run-the-table` is the largest route at 26.9 kB page / 259 kB First Load JS, the homepage (`/`) is 3.67 kB / 194 kB. |

Vitest output included a number of `not wrapped in act(...)` React warnings
(e.g. in `run-the-table-components.test.tsx`, `daily-grid-components.test.tsx`)
— all pre-existing, all non-fatal (every test still passed), noted here
only because they are real console noise in the suite, not a claim that
anything is broken.

---

## Files

- `scripts/perf/measure_rtt.py` — the measurement script (reusable for
  "after").
- `docs/implementation/rtt-overhaul/perf-raw/staging-baseline.{json,md}` —
  raw hosted-staging measurement.
- `docs/implementation/rtt-overhaul/perf-raw/local-baseline.{json,md}` —
  raw local (in-memory backend) measurement.
- `docs/implementation/rtt-overhaul/PERFORMANCE.md` — this file.
