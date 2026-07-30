# Phase 8E — Homepage, Game Entry, Assets, and Replay Loop Polish

Status: **implemented, not committed**. Branch `phase8-peak-season-game-loop`,
continuing from the Phase 8D arena/spinner/replay-loop pass. This doc is the
durable record of what was found and changed; see the conversation report
for the full test-run output and git status at hand-off time.

## 1. Homepage / entry-point audit (source of truth for scope)

The homepage (`apps/web/src/app/(main)/page.tsx`) was unchanged since Phase 1
and still presented **Peak Duel** ("Which player had the greater peak?") as
the product, with its primary CTA routed to `/arena/daily` — the *legacy
Peak Draft* daily hub, not even Peak Duel's own daily page (`/play/daily`).
The persistent header's "Play" link had the exact same bug
(`apps/web/src/components/layout/nav.tsx`). Neither link ever mentioned
82-0 Peak Season, the mode every recent phase has actually been building.

Reaching the flagship from the homepage required: click "Play today's
challenge" → land on the Peak Draft hub → click "← Back to Arena" → land on
`/arena` → *then* see the CourtBuilder flagship card. That detour is the
concrete "never need to click Back to Arena" complaint.

## 2. Routing fixes

- `apps/web/src/app/(main)/page.tsx` — full rewrite (see §3). Primary CTA
  now points straight at `/arena/court/practice/apex_1y` (falls back to
  `/arena` if the server reports CourtBuilder disabled — same fail-closed
  pattern `/arena/page.tsx` already used, never assumes the flagship is
  live).
- `apps/web/src/components/layout/nav.tsx` — "Play" now points at `/arena`
  (the hub), not `/arena/daily`. The hub already puts the CourtBuilder
  flagship front and center when enabled; one real click from anywhere in
  the app, no dead end.
- `apps/web/src/app/(main)/arena/page.tsx` — metadata title updated from
  "Arena — Peak Draft" to "Arena — 82-0 Peak Season" to match what the page
  actually leads with.
- `apps/web/src/app/(main)/arena/daily/page.tsx` — the legacy Peak Draft
  hub is **not deleted** (it still works, still has real daily rotation,
  still covered by `daily-challenge.spec.ts`) but now carries a visible
  "New: 82-0 Peak Season →" banner at the very top, so anyone who lands
  there from an old bookmark/link has an immediate way out instead of a
  dead end.
- `/play/daily` (the original Phase 1 Peak Duel daily challenge) is kept as
  an intentionally-supported secondary mode, linked from the homepage's
  "Daily Peak Duel" card — demoted from primary, not removed.

## 3. Homepage redesign direction

Game-portal framing instead of a stats-website framing:

1. **Hero** — "Build a legendary roster. Chase 82-0." with a live coverage
   line (`N rollable team-seasons · <start> to <end>`) pulled from the same
   `getCourtBuilderReadiness()` call `/arena` already uses server-side —
   real numbers, never a hardcoded string, and the whole fetch is
   best-effort (a failure just hides the line, never breaks the page).
2. **How a run works** — a 3-step visual (Spin → Draft → Simulate) using
   the same team-color badge language as `SpinStage`/`PeakCardCourt`
   (colors + initials only, no logos), not another paragraph of prose.
3. **Ways to play** — the flagship 82-0 Peak Season card leads (full-width,
   gold-outlined), followed by three equal cards: Daily Peak Duel, PEAK
   Index (rankings), and the PEAK Season Leaderboard (saved/submitted best
   runs) — the four things explicitly asked for.
4. **Methodology credibility strip** — kept, trimmed. The five-component
   weight breakdown is still real product credibility, just no longer the
   first thing a visitor sees.
5. New `.home-hero-glow` CSS class reuses the exact "two low-opacity corner
   glows, <12% alpha" arena-lighting language Phase 8D introduced for the
   court/spinner, so the front door and the game itself feel like one
   product.

## 4. Asset / portrait pipeline — investigation and fix

### What's possible vs. blocked (unchanged from Phase 8C, re-verified this pass)

- **ESPN**: the only real, working provider. `scripts/build_espn_asset_manifests.py`
  resolves against ESPN's public roster/athlete-search endpoints. Every
  resolved entry's `license_status` is `unknown_do_not_cache` — no human has
  reviewed ESPN's hotlink terms for a shipped product — so
  `PEAK3_ENABLE_EXTERNAL_ASSET_URLS` defaults **off**, no image binaries are
  ever downloaded or committed, and the runtime only ever hotlinks an ESPN
  CDN URL when a developer explicitly opts in locally.
- **NBA CDN**: a real, tested code path with **zero resolutions**, not a
  stub. `stats.nba.com`/`cdn.nba.com` need a verified NBA.com `person_id`
  per player. This repo's pipeline is Basketball-Reference-sourced
  end-to-end and has never carried that ID. A crosswalk file
  (`data/game/assets/nba_player_id_crosswalk.json`) is *supported* by the
  build script if one is ever added from a verified source — none exists
  today, and none was fabricated to force the count up.
- **Team logos**: intentionally never rendered — colors + 2-3 letter
  initials only (`apps/web/src/lib/team-colors.ts`), a deliberate,
  documented substitute for unlicensed logo imagery.

### Coverage numbers (re-run this pass, `scripts/audit_player_portrait_coverage.py`)

| Pool | Resolved | Total | % |
|---|---|---|---|
| Eligible union (canonical 250 ∪ team-year pool) | 526 | 3,432 | 15.3% |
| Canonical 250 | 66 | 250 | 26.4% |
| Curated 1,500-identity pool | 314 | 1,510 | 20.8% |

Unchanged from the last audit — no new provider was integrated (would mean
new scraping infrastructure and an unreviewed legal surface, out of scope
here per the explicit "don't add scraping / don't fabricate IDs"
constraint). Command to reproduce, and the same one to point to for a
current-state debug receipt:

```bash
python scripts/audit_player_portrait_coverage.py
```

### The actual bug found and fixed

Verified live against a running API with `PEAK3_ENABLE_EXTERNAL_ASSET_URLS=true`:
a fresh `apex_1y` board's `exact_team_season` roll for the Denver Nuggets
returned `headshot_url: null` for **Nikola Jokic and Jamal Murray** —
despite both being `resolution_status: "resolved"` in
`data/game/assets/player_assets.v3.json` with real ESPN CDN URLs. Portraits
that should have rendered simply never did.

Root cause, in `apps/api/app/services/perfect_season/state.py`:
`get_public_state()` branches candidate-building on `_is_team_year_spin()`
— only `spin_type == "team_year"` ever called `_candidate_public_exact()`
(which correctly threads `include_asset_urls` through to
`get_player_headshot_url()`). Every OTHER spin type (`team_decade`,
`exact_team_season`, `open_pool` — i.e. what the app actually runs by
default, since `COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED` defaults off)
routed through `_candidate_public()`, which never accepted an
`include_asset_urls` parameter **at all**. The same gap existed twice more:
`pending_card_public`'s peak-window branch, and the filled-slot
peak-window branch — both had a working exact-season sibling right next to
them that made the bug easy to miss by inspection.

Fixed by adding the identical `include_asset_urls` → `get_player_headshot_url()`
gate to all three peak-window/legacy branches, mirroring the exact-season
branches exactly. Verified live (candidate → pending selection → filled
slot all now carry the real ESPN URL) and covered by new regression tests
in `apps/api/tests/test_perfect_season.py` (`assets_client` fixture: assets
on, team_year mode at its *production default* — off — which is exactly
the combination no prior test exercised).

**Re-verified end to end** after this doc was first written (the internal
task tracker had drifted stale — the fix itself was already correct, this
was a bookkeeping gap, not a regression): a fresh `apex_1y` board, seed 42,
`PEAK3_ENABLE_EXTERNAL_ASSET_URLS=true`, default (non-team_year) engine.
`GET`/`POST` responses confirmed `headshot_url` non-null for Nikola Jokic
at all three stages (candidate list → pending selection → filled slot).
In the browser, `PlayerAvatar` renders a real `<img>` pointing at that
exact ESPN URL when the flag is on, and falls back to the initials `<div>`
("NJ") when it's off — both checked live via Playwright against a running
dev server, not just asserted from code reading.

### Frontend fallback (unchanged code, re-verified correct)

`PlayerAvatar.tsx` was already correct: renders a real `<img>` only when
`imageUrl` is a non-empty, safe URL, falls back to initials on a missing
URL or an `onError`. Phase 8D already replaced the flat initials disc with
a glossy gradient medallion (radial gradient + inset highlight/shade +
halo ring) — since production never sets `PEAK3_ENABLE_EXTERNAL_ASSET_URLS`,
this fallback *is* the default portrait experience for effectively every
player, not an edge case, so making it look intentional rather than
placeholder-like was the higher-leverage fix relative to chasing marginal
coverage gains.

## 5. Court + spinner visual polish (pass 2)

- Filled court/bench slot cards (`PeakCardCourt.tsx` / `.roster-board-slot-card-filled`)
  now carry a faint (8% alpha) radial wash of the placed player's own team
  color, not just a flat `--bg-elevated` fill with a color-mixed accent
  rail at the edge — a populated court now reads as "colored in" by the
  actual roster.
- The spin ceremony's "LOCKED" stamp now snaps in with a real overshoot
  scale/rotate keyframe instead of appearing statically — the clearest
  "this roll just got decided" beat in the ceremony earns its own
  punchier entrance.
- Team/season axis independence, no-replay-on-reselect, and the collapsed
  locked-in summary during placement (all Phase 8D work) were re-verified
  unchanged by this pass's regression tests.

## 6. Replay loop / saved best / auth

`apps/web/src/lib/auth.ts` confirms: this app has **Supabase email/password
auth**, not social OAuth (no Google/GitHub provider is wired anywhere in
the codebase). Gated by `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (frontend, `apps/web/.env.example`) and
`PEAK3_SUPABASE_JWT_SECRET` / `PEAK3_DATABASE_URL` (backend,
`apps/api/.env.example`) — none set in this local dev environment (no
`.env` file exists; not touched, per the no-secrets constraint). Both
`/signin` and `PlayAgainPanel`'s new prompt degrade gracefully when these
are absent ("Authentication is not configured... you can still play all
game modes anonymously") rather than presenting a broken form.

`PlayAgainPanel.tsx` (Phase 8D) already had Play Again + personal-best
comparison, reusing `getMyRuns`/`getLeaderboard`/`useAuth` — no parallel
persistence. This pass adds the missing signed-out state: a "Sign in to
save your best run and track it here" prompt, shown only when the
leaderboard feature itself is enabled (matches `LeaderboardSubmitPanel`'s
existing `!user` branch exactly, same copy tone, same `/signin`
destination — one consistent auth pattern across both end-of-run panels).

## 7. Simulator calibration sanity check

No changes to `nba_peak/perfect_season/simulation.py` this pass. Re-ran the
existing Phase 8D regression suite to confirm the generational-elite floor
and the good-contender ceiling both still hold:

- `test_generational_anchor_lineup_lands_80_to_82_across_seeds` — 2015-16
  Curry / 1987-88 Jordan / 2012-13 LeBron / 2003-04 Garnett / 2022-23 Jokic
  still lands 80-82 wins across 10 seeds.
- `test_good_contender_roster_is_unaffected_by_the_generational_floor` —
  a merely-strong roster (not 4+ generational starters) stays in a
  45-72 win band, never flattened up to 82-0.

Core `peak3.py` individual scoring and exact-season semantics untouched.
