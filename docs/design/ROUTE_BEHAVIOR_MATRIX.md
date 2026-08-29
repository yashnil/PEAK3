# PEAK3 Route / Behavior Matrix

Built by inspecting `apps/web/src/app/**` (App Router), the components each
route actually imports, `apps/web/src/app/layout.tsx`, and the test suites in
`apps/web/src/tests/{unit,e2e}`. This is the checklist the rest of the
Arena Archive polish program works from — accuracy over completeness of
prose. Where a claim is import-graph-only (page doesn't render the component
tree at runtime for this analysis), it's marked **(unverified at runtime)**.

## Foundational fact: "V2" is now a global system, not a per-page opt-in

`apps/web/src/app/layout.tsx` sets `data-ui-version="v2"` unconditionally and
imports, at the root, **globally for every route**:
`styles/v2/tokens.css`, `nav.css`, `footer.css`, `home.css`, `discovery.css`,
`rtt.css`, `court.css`, `spin.css`, `rtt-result.css`, `game-intro.css`,
`arena-lobby.css`, `info-pages.css`. So `nav.tsx` and `Footer.tsx` — despite
not importing any `PeakV2*` component — already render on the v2 token/CSS
system (this corrects an earlier private planning note that claimed "zero V2
branch" on nav/footer; that was fixed by PR #23/#24, visible in
`styles/v2/nav.css` + `styles/v2/footer.css` existing and being globally
loaded). **What "polish this route" means varies a lot by route**:
- Some routes additionally use dedicated `PeakV2*` page-level components
  (richer, more composed presentation).
- Some routes render older component trees that only inherit the *token
  layer* (colors/type/spacing variables) but not the newer composition
  patterns (`PeakV2Shell`, `PeakV2DataLane`, docked panels, etc.) — these are
  where "still reads like a settings page" is most likely to still be true.

## Global shell (touches every route — highest blast radius)

| Component | File | Contract that must not change |
|---|---|---|
| Nav | `components/layout/nav.tsx` | `aria-label="Main navigation"` (asserted by 6+ specs); active-class string literal `bg-[var(--bg-surface)]` (`play-routing.spec.ts`); wordmark → `/`; `PlayMenu` disclosure listing every mode + "View all games" → `/arena`; `AccountMenu` gated on `supabaseEnabled` (anonymous deployment must render nothing extra); mobile nav is `MobileNavDrawer` on the shared `Dialog` (focus trap) |
| Footer | `components/layout/Footer.tsx` | `FOOTER_COLUMNS` data source, `NBA_DISCLAIMER` verbatim text, tested by `footer.test.tsx` |
| `PlayMenu` / `MobileNavDrawer` | `components/layout/` | disclosure/focus-trap behavior (`nav-components.test.tsx`, `nav-model.test.ts`) |
| `Dialog` | `components/ui/Dialog.tsx` | underlies every modal/sheet/drawer app-wide — focus trap, escape-to-close, used by MobileNavDrawer and game modals |
| `PeakV2Shell` | `components/v2/PeakV2Shell.tsx` | page-frame primitive reused by rankings, methodology, ranked hub, play/daily, play/endless |
| Token layer | `styles/v2/tokens.css` | three-role typography, radius vocabulary, color aliases — changing this ripples to literally every route |
| `AnimatedNumber`, `ScorePill`, `StatusChip`, `Skeleton`, `EmptyState`, `ErrorState`, `Tooltip` | `components/ui/*` | shared primitives used across game/data surfaces; `component-labels.test.ts`, `ui-primitives.test.tsx`, `button-styles.test.ts` cover them |

## Route-by-route

### `/` — Home
- **Renders:** `HomePageV2` (`components/v2/HomePageV2.tsx`) + `HomeV2*` subcomponents (ResumeRow, YourArena, LaneExplainer, PrimaryCta, Faq).
- **Purpose/task:** entry point — surface today's plays, resume in-progress runs, explain the product, funnel into a game.
- **Data deps:** `loadHomeModelData`, `loadNbaFactOfTheDay` (server), `getArenaCatalogue`, `getCourtBuilderReadiness`.
- **Must not change:** server-fetched prop shapes; resume-row logic (which in-progress runs surface).
- **Tests:** `home-comparison-and-leaderboard.test.tsx`, `home-launcher.test.tsx`, `home-fact-data.test.ts`, `nba-fact-of-the-day.test.tsx`, `handle-onboarding-prompt.test.tsx`, e2e `home-fact-of-the-day.spec.ts`.
- **Polish category:** already has a real V2 composition — route-family refinement (density/hierarchy), not a rebuild.

### `/arena` — Arena hub
- **Renders:** `ArenaPageV2` + `ArenaV2ResumeHero`.
- **Data deps:** `getArenaCatalogue` (server), `getCourtBuilderReadiness`.
- **Must not change:** fail-closed readiness checks gating each mode card.
- **Polish category:** route-family refinement.

### `/arena/ranked`, `/arena/ranked/[mode]`, `/arena/ranked/[mode]/leaderboard`
- **Renders:** hub page uses `PeakV2Shell` directly + inline composition; `[mode]` renders `RankedScreen` (`components/ranked/RankedScreen.tsx`, **0 v2 imports found** — legacy composition **(unverified at runtime — worth a screenshot check)**); leaderboard page is bespoke, not V2-shelled.
- **Data deps:** `rankedApi`, `useAuth`/`getAccessToken` (auth-gated queue).
- **Must not change:** exact queue/rating logic, `QueueRatingResponse`/`RankedReadinessResponse` handling, auth gating.
- **Tests:** `ranked-components.test.tsx`, `ranked-state.test.ts`, e2e `ranked.spec.ts`.
- **Polish category:** `[mode]` and leaderboard need real V2 composition work — currently the weakest link in this family.

### `/arena/court/daily`, `/arena/court/daily/[mode]`, `/arena/court/practice/[mode]`, `/arena/court/history`, `/arena/court/leaderboard`, `/arena/court/results/[id]`
- **Renders:** `PeakSeasonStartGate` (2 v2 imports — partial V2), `PeakSeasonLeaderboard`, `SeasonResultStub`; history/leaderboard pages are bespoke fetch+render, no V2 shell.
- **This is the "82-0" mode.**
- **Must not change:** `getCourtBuilderReadiness` readiness logic, saved-run/personal-bests data (`SavedRun`, `PersonalBests` types), difficulty gating.
- **Tests:** `peak-season-difficulty.test.tsx`, `peak-season-leaderboard.test.tsx`, `court-builder-hint.test.tsx`, `court-state.test.ts`, `court-mode-labels.test.ts`, e2e `courtbuilder.spec.ts`.
- **Polish category:** start-gate has partial V2 (verify quality); history/leaderboard/results are route-family polish candidates, currently plain data pages.

### `/arena/run-the-table` (+ `/h2h`, `/h2h/[matchId]`, `/h2h/invite/[token]`)
- **Renders:** `RunTheTableGame` — **13 internal v2 imports**, the most V2-composed game surface in the app.
- **h2h routes** render `MatchScreen`, `ChallengeCreator`, `HeadToHeadHistory`, `InviteLanding` — **0 v2 imports found**, likely still legacy composition **(unverified at runtime)**.
- **Must not change:** run-state machine, timers/deadlines, invite-token flow, match persistence.
- **Tests:** `run-the-table-state.test.ts`, `run-the-table-components.test.tsx`, `run-the-table-reveal.test.tsx`, `run-the-table-v3.test.tsx`, `head-to-head.test.tsx`, e2e `run-the-table.spec.ts`.
- **Polish category:** main RTT flow is system-consistency polish; h2h sub-flows are route-family polish (likely bigger gap).

### `/arena/three-man-weave`, `/arena/three-man-weave/[matchId]`
- **Renders:** `ThreeManWeaveLoader` → `ThreeManWeaveGame` (3 v2 imports — partial).
- **Must not change:** 872-line-class stage/commit/timeout/reconnect logic (per prior planning doc — verify still true); PickOverlay behavior.
- **Tests:** `three-man-weave-components.test.tsx`, `three-man-weave-state.test.ts`, `three-man-weave-v2-geometry.test.tsx`.
- **Polish category:** partial V2 — visual-consistency pass on existing `PeakV2TMW*` components.

### `/arena/twenty-dollar/[matchId]`
- **Renders:** `TwentyDollarGame` (3 v2 imports — partial).
- **Tests:** `twenty-dollar*.test.tsx` (phase, reconnect, room, base).
- **Polish category:** partial V2, needs a consistency pass.

### `/arena/daily`, `/arena/daily/[mode]`, `/arena/practice/[mode]`, `/arena/results/[id]`, `/arena/labs`
- **Renders:** `DraftScreen` (**0 v2 imports**), `PracticeDraftLoader`. `/arena/labs` page is literally named `LegacyLabsPage` in source.
- **These are the legacy "draft" game family** — distinct from Peak Duel (`/play/*`).
- **Must not change:** draft progress/state machine (`draft-progress.ts`), daily-window logic (`daily-time.ts`), challenge-token flow.
- **Tests:** `game-state.test.ts`, `daily-time.test.ts`, `component-labels.test.ts`.
- **Polish category:** confirmed legacy composition — largest genuine gap in the app; needs deliberate route-family work, not just a token pass.

### `/play/daily`, `/play/endless` — Peak Duel
- **Renders:** `GameEngine` wrapped in `PeakV2Shell`; `/play/daily` also uses `PeakDuelV2AlreadyCompleted`.
- **Must not change:** 5s pick timer, streak logic, `useDailyReset` daily-key semantics, `arena_points` scoring (never computed client-side per CLAUDE.md).
- **Tests:** `game-engine.test.tsx`, `game-intro.test.tsx`, `score-derivation.test.tsx`, `peak-duel-v2-reveal.test.tsx`, `peak-duel-v2-history.test.tsx`, `result-tier.test.ts`, e2e `gameplay.spec.ts`, `duel-viewport.spec.ts`.
- **Polish category:** system-consistency polish — already the most-iterated surface (per `PeakDuelV2*` component count).

### `/daily`, `/daily/grid`, `/daily/history`
- **Renders:** `DailyHub` (1 v2 import — partial), `DailyGridGame` (**0 v2 imports**), `DailyGridHistory`.
- **Must not change:** board mechanic, `board_type` handling (flagged as a past bug source in memory), streak/archive logic.
- **Tests:** the large `daily-grid-*` suite (api, archive, completion-v2, components, mobile-labels, retry, rollover, share-card, start-gate-v2, state, tour), e2e `daily-grid.spec.ts`.
- **Polish category:** Daily Grid is confirmed still legacy-composed (`daily-grid-completion-v2.test.tsx` / `daily-grid-start-gate-v2.test.tsx` names suggest partial V2 work exists on *some* states already — verify at runtime before assuming it's 0%). Likely the single largest self-contained polish target given its state-machine complexity.

### `/rankings`, `/methodology`
- **Renders:** `PeakV2Shell` + `PeakV2ResultHeadline` + `PeakV2Rule` wrapping `RankingsTable`/`RankingsAnalysis`/`RankingsProvenance` (rankings) and an accordion (methodology).
- **Must not change:** table/chart/filter logic, accordion content, `getMethodology`/`getPeakWindowBoard`/`getSeasonBoard` data contracts.
- **Tests:** `rankings-analysis.test.tsx`, `rankings-detail.test.tsx`, `rankings-position-filter.test.ts`, `rankings-provenance.test.ts`, `rankings-receipts.test.ts`, `rankings-row-interaction.test.tsx`, e2e `rankings.spec.ts`.
- **Polish category:** already V2-shelled — data-density/chart-chrome refinement only, per CLAUDE.md's explicit "do NOT touch table/chart/accordion logic."

### `/about`, `/accessibility`, `/contact`, `/data-sources`, `/privacy`, `/terms`
- **Renders:** static content pages; `styles/v2/info-pages.css` loaded globally suggests these already have *some* v2 treatment.
- **Polish category:** low-risk, likely typography/spacing-only — verify against `info-pages.css` before assuming a gap exists.

### `/history`, `/profile`, `/progress`, `/u/[handle]`
- **Renders:** all bespoke, **no `PeakV2Shell`/`PeakV2*` imports found**. `/profile` uses `RankedRatingCards`; `/progress` uses `XpProgress`, `StreakCard`, `AchievementCard`, `PersonalRecords`.
- **Must not change:** auth-gated data fetching (`useAuth`/`getAccessToken`), `signInHref` redirect-with-`returnTo` pattern, XP/streak/achievement data contracts.
- **Tests:** `progression-components.test.tsx`, `progress.test.ts`, `profile-api.test.ts`, `perfect-season-auth.test.ts`.
- **Polish category:** genuine route-family polish target — these are exactly the "profile/progression" surfaces CLAUDE.md's product brief calls out for milestone-grouped, uncluttered treatment, and they currently have no V2 composition at all.

### `/signin`, `/signup`, `/auth/complete`, `/auth/auth-code-error`
- **Renders:** `AuthShell` + `SignInPanel`, no V2 shell.
- **Must not change:** `safeNext`/`signInHref` redirect safety, Supabase auth flow, `authSurfaceEnabled` gating (must render nothing when Supabase isn't configured — `NEXT_PUBLIC_PEAK3_E2E_AUTH` semantics).
- **Tests:** `auth-*.test.ts(x)` (callback, claim, complete, safe-next, session, token-cache, ui), e2e `auth.spec.ts`.
- **Polish category:** intentionally quiet per CLAUDE.md's own design principles ("Auth/Settings surfaces — deliberately quieter, no need to theme aggressively") — light consistency pass only, do not "gamify."

### `/players/[slug]`
- **Renders:** bespoke server component, no V2 shell, uses `componentLabel`/`componentColor`/`componentTextColor` (the 6 component-color tokens from CLAUDE.md).
- **Polish category:** route-family polish — a "player card" surface with real data-viz potential (component color bars) that's currently likely under-composed.

### `/c/[token]` — shared challenge link
- **Renders:** `DraftScreen` + `ChallengeComparison`.
- **Must not change:** `challengeTokenKey` semantics, comparison data contract.
- **Polish category:** shared-result surface (CLAUDE.md: "should feel like a strong social artifact... beautiful enough to share").

### `/v2-preview`
- **Internal-only gallery** (`V2PreviewGallery.tsx`) for comparing components — not a real user surface, leave alone unless it breaks.

## Cross-cutting risk notes

1. **Import-graph analysis undercounts real V2 coverage** for routes whose page.tsx doesn't import `PeakV2*` directly but whose child component does (e.g. `RunTheTableGame`, `TwentyDollarGame`, `ThreeManWeaveGame`, `PeakSeasonStartGate`, `DailyHub` all show partial v2 imports; `DraftScreen`, `DailyGridGame`, `MatchScreen`, `RankedScreen` show **zero**). Before polishing any "zero" route, take an actual screenshot — don't assume the gap size from the grep count alone.
2. **Confirmed legacy-composed, no V2 at all (highest-value gap, by grep):** the draft-game family (`/arena/daily/*`, `/arena/practice/*`, `/arena/results/*`, `/arena/labs`), `RankedScreen` (`/arena/ranked/[mode]`), `DailyGridGame` (`/daily/grid`), `MatchScreen`/h2h family, `/history`, `/profile`, `/progress`, `/players/[slug]`, auth pages.
3. **Global shell risk:** any change to `nav.tsx`, `Footer.tsx`, `Dialog.tsx`, or `styles/v2/tokens.css` needs full regression (e2e `play-routing.spec.ts`, `nav-components.test.tsx`, `footer.test.tsx`, `accessibility.spec.ts` at minimum) since every route inherits them.
4. **Anti-pattern precedent:** per `.claude-private/reconstruction_plan_v5.md` (prior session, not authoritative but informative), Run the Table's start-gate and the 82-0 difficulty picker were previously flagged as "gold-bordered card + numbered-list microcopy" — the exact settings-page anti-pattern CLAUDE.md's brief warns against. Worth a direct look before assuming `PeakSeasonStartGate`'s 2 v2 imports mean it already meets the bar.
