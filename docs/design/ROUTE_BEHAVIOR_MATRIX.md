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

### `/arena/court/daily`, `/arena/court/daily/[mode]`, `/arena/court/practice/[mode]`, `/arena/court/history`, `/arena/court/leaderboard`, `/arena/court/results/[id]` — Batch 8 semantic inventory (2026-08-30, pre-implementation)

**This entry was stale before this batch** — it named `SeasonResultStub` as the
renderer and missed an entire `components/v2/court/` layer that already
exists. Corrected here from a full read of the actual import graph, not the
RC audit's "0 `PeakV2*` refs in the file itself" grep, which this batch
proved is a poor proxy for this specific family (see "What the RC audit got
wrong" below).

**Actual route → component map:**
- `/arena/court/practice/[mode]`, `/arena/court/daily/[mode]` → `PeakSeasonStartGate` (Batch 1, V2-converted) → on "Begin", creates the game and mounts → `CourtBuilder`.
- `CourtBuilder.tsx` (orchestrator) → `PeakV2CourtLive` (the live/build court), `PeakV2CourtChooser` (the spin+candidate-selection docked panel), `PeakV2CourtResult` (the completion/result screen), `ActionToast` (the undo toast). **All three `PeakV2Court*` components already exist and are heavily V2-native** — multiple documented "Pass" iterations (Pass 3 initial cutover, Pass 7 "human acceptance testing" fixes to geometry/focus/mobile-hit-testing) with real UX-research findings cited in their own comments. This is NOT an unconverted surface.
- `PeakV2CourtLive` reuses `CourtLayout` (the real court markings — paint/arc/rim, already fixed for "reads as a form not a court" in Phase 6C, long before this program) and `LiveBuildPanel` verbatim, on top of a fresh `PeakV2CourtSlotCard` slot renderer.
- `PeakV2CourtChooser` reuses `SpinStage` and `EligiblePlayerSearch` verbatim (both explicitly documented as correctness-critical: reveal timing, ADR-005 Decision 6's "never renders a score"). **`EligiblePlayerSearch` is also used by Daily Grid's `GridCell.tsx`** — cross-family shared, same caution as `DNARadar.tsx`.
- `PeakV2CourtResult` reuses `CourtLayout` again, plus **five genuinely legacy-styled action panels**: `SaveRunPanel`, `PlayAgainPanel`, `LeaderboardSubmitPanel`, `ShareRunPanel`, `PeakPicksRecap` — each its own `rounded-xl` bordered box with raw `<button>`/`<a>` elements styled ad hoc (`background: var(--peak-accent)`, hand-rolled uppercase-tracking classes), never `PeakV2PrimaryAction`/`SecondaryAction`. **This is the real, narrow, evidence-backed gap** — five files, not thirteen.
- `LineupInsightPanel` (also reused by `PeakV2CourtResult`) is a plain bar-chart list, no buttons, tokens already consistent — minor/optional touch only.
- **`/arena/court/results/[id]`** (the shared/permalink result link `ShareRunPanel`'s own "Copy link" button generates) renders `SeasonResultStub` directly — the OLD, pre-`PeakV2CourtResult` component — instead of `PeakV2CourtResult`. Confirmed identical prop signature (`state`, `result`, `onPlayAgain?`, `playAgainBusy?`, `readOnly?`) and identical `data-testid="season-result"`, so this is a like-for-like swap. **This is the single most concrete "polished promise, then an older generation" bug in the whole batch**: the player who just finished sees the new cinematic result; anyone they share the link with sees the old one.
- `/arena/court/leaderboard` (`PeakSeasonLeaderboard`) is a separate destination page, not part of the CourtBuilder in-game loop and not imported by any `PeakV2Court*` component — **out of this batch's scope** per "do not touch unrelated Arena modes"; flagged for a future batch, not silently redesigned.
- `/arena/court/history` — separate route, not investigated this batch (out of scope, not part of the CourtBuilder loop).

**What the RC audit got wrong, for the record:** its Stage A/B grep (`grep -c "PeakV2" file.tsx`) counted zero for `CourtLayout`, `LiveBuildPanel`, `SpinStage`, `EligiblePlayerSearch`, `ActionToast`, `PeakCardCourt`, `PlayerAvatar`, `SeasonResultStub`, and the five action panels — but several of those (`CourtLayout`, `LiveBuildPanel`, `SpinStage`, `EligiblePlayerSearch`, `ActionToast`) are deliberately-reused-verbatim pieces already wrapped by a mature V2 container layer the grep never found (it imports them by relative/absolute path, not by re-exporting `PeakV2*` names). `PeakCardCourt.tsx` and `PlayerAvatar.tsx` are effectively orphaned from the live game (only `SeasonResultStub` — itself about to stop being rendered — still imports `PeakCardCourt`; `PlayerAvatar` is a cross-app shared avatar primitive, not court-specific). The actual gap was five files, not "the majority of the flagship."

**CourtBuilder's real UI phase machine** (`lib/court-state.ts::uiPhaseFromStatus`, verified against the reducer-equivalent logic in `CourtBuilder.tsx`, not inferred):
`spinning` (server `selection_pending`) → `placing` (server `placement_pending`) → `complete` (server `rounds_complete` or `result_ready`). Sub-states layered on top, all client-only view state, never sent to the server:
- `movingSlot` — rearrange-in-progress (pick a filled slot, then a destination); Escape or the Cancel button exits it; available whenever `canRearrange && filledSlotCount >= 1`, independent of the round's own phase (a player can rearrange while a round is still unresolved).
- `respinPending` — true from a respin request until `SpinStage` reports the reel has visually landed; gates what `CourtBuilder` renders directly (never leaks the new team/season before the reel lands, even though `state.current_spin` itself updates immediately).
- `overlayMinimized` — the chooser can be closed to work the court underneath mid-round ("View court" / "Resume selection"); resets to reopened on every new round.
- `hint` — Easy-mode-only, once per run, scoped to the round it was requested for.
- `actionToast` — one-line undo receipt after a place/swap, bounded by the server's own `undo.expires_at`; dismissed the instant `status === "result_ready"`.
- `error`/`busy` — a rejected action surfaces in a `role="alert"` banner; every mutating action gates on `busy`.

**Intentional differences preserved, not touched:** the whole state machine above, `action_place_card`'s "soft placement" rule (every open slot is legal regardless of position — this is gameplay, not a bug), the three-tier pending-fit visual system (`pendingFitTier`), the reveal-discipline gating (`score_status`/`exact_player_season_key`/`peak_locked` — never shown before `result_ready`), Hold's-equivalent-for-CourtBuilder (none — there is no hold mechanic here, only respin/hint), `SpinStage`'s reveal timing, `EligiblePlayerSearch`'s no-score rule (ADR-005 Decision 6), difficulty gating, personal-best/leaderboard data contracts.

**Legacy presentation differences removed (this batch):** `SaveRunPanel`/`PlayAgainPanel`/`LeaderboardSubmitPanel`/`ShareRunPanel` buttons and links restyled onto `PeakV2PrimaryAction`/`PeakV2SecondaryAction`; the ad hoc bordered-box treatment on those four plus `PeakPicksRecap` brought in line with `PeakV2CourtResult`'s own hairline-divided (`PeakV2Rule`) section grammar instead of floating as visibly older bordered cards; `/arena/court/results/[id]` switched from `SeasonResultStub` to `PeakV2CourtResult`.

- **Must not change:** `getCourtBuilderReadiness` readiness logic, saved-run/personal-bests data contracts and comparison logic (server-computed, never recomputed client-side), difficulty gating, respin/hint idempotency keys, the undo window, `action_swap_slots`/`action_place_card`/`action_undo_last_placement` semantics, `SpinStage`'s reveal ceremony and `EligiblePlayerSearch`'s no-score rule (both reused verbatim, shared with/adjacent to other families), `CourtLayout`'s actual court geometry (already correct — do not rebuild it), `drawScorecard`'s canvas export (data-driven, provably independent of which component renders the page).
- **Tests:** `peak-season-difficulty.test.tsx`, `peak-season-leaderboard.test.tsx`, `court-builder-hint.test.tsx`, `court-state.test.ts`, `court-mode-labels.test.ts`, `save-run-panel.test.tsx`, `play-again-panel.test.tsx`, `leaderboard-submit-panel.test.tsx`, `result-tier.test.ts`, e2e `courtbuilder.spec.ts` (the largest single e2e file in the app, ~16 minutes, its own CI shard).
- **Polish category:** narrow, surgical convergence — five action-panel components restyled, one route pointed at the already-correct result component. Not a redesign; `PeakV2CourtLive`/`Chooser`/`Result`/`SlotCard`, `CourtLayout`, `SpinStage`, `EligiblePlayerSearch` are left structurally untouched as already-mature.

### `/arena/run-the-table`
- **Renders:** `RunTheTableGame` — **13 internal v2 imports**, the most V2-composed game surface in the app. Not touched this batch.

### `/arena/run-the-table/h2h`, `/h2h/[matchId]`, `/h2h/invite/[token]` — Batch 6 semantic inventory (2026-08-29, pre-implementation)

**Renders:** `HeadToHeadHubPage` (hub) → `ChallengeCreator` + `HeadToHeadHistory`;
`HeadToHeadMatchPage` → `MatchScreen` (→ `SideBySideReceipt` once settled);
`HeadToHeadInvitePage` → `InviteLanding`. **0 `PeakV2*` imports anywhere in
the family** — confirmed by reading every file, not just grep. All three
pages are thin server-component wrappers; all 5 components are client
components. `SideBySideReceipt` already went through a prior polish pass
(visible in its own code comments — "WAS opacity-75," "used to be text-lg
in body ink") and is meaningfully more considered than its siblings; the
other four still use raw Tailwind `opacity-*` utilities throughout instead
of the app's `--text-secondary`/`--text-muted` tokens.

**The actual state machine (from `lib/head-to-head-api.ts` + the
components — not inferred from names):**

- **ChallengeCreator:** no-active-run (no RTT run in localStorage — shows a
  prompt to go play RTT first, not an error) → signed-out (shows a sign-in
  link, no create button rendered at all) → ready-to-create (signed in,
  has a run) → creating (`busy`) → created (shows the invite URL as
  literal text, a copy-link button, and a link to open the match) → error
  (`role="alert"`, server error message verbatim). **The active run is
  read from a localStorage breadcrumb as a convenience only — the server
  independently re-checks ownership (`assert_owns`), so this can never be
  spoofed into challenging with someone else's run.**
- **InviteLanding:** loading (`aria-busy`) → error-with-no-invite (broken/
  invalid token, distinct render path from a loaded-but-unplayable invite)
  → loaded, one of: expired, already-full (someone else accepted), stale-
  ruleset (old seed no longer reproducible), playable-signed-out (shows
  the acceptance requirement copy BEFORE the button, deliberately, per the
  component's own doc comment), playable-signed-in (Accept button) →
  accepting (`busy`) → navigates to the match on success, or shows an
  error inline on failure. **Deliberately spoiler-free by what the server
  sends, not by client logic** — `InviteDescriptor` has no seed/roster/
  boss/score fields at all; the component could not leak them if it tried.
- **MatchScreen:** error-with-no-match (signed out or genuine failure) →
  loading → loaded: `waiting` (no opponent yet) → opponent joined, your
  run not yet submitted (shows "Continue your run" + "Submit my finished
  run") → submitted, opponent not yet (`both_complete` false — shows a
  spoiler-safety reassurance sentence, tested verbatim) → `both_complete`
  (renders `SideBySideReceipt`) → optionally, a rematch sub-state
  (no-rematch-yet → "Offer a rematch" button → rematch created, shows a
  new invite link + copy button). **`opponent_status` is the literal
  string `"hidden"` until both sides finish — there is no client-side
  "don't reveal yet" flag to bypass, the spoiler data is simply absent
  from the response.**
- **HeadToHeadHistory:** loading → signed-out (shown as a plain sentence,
  not an auth redirect — this component renders standalone, e.g. embedded
  elsewhere) → error → empty (`data-testid="h2h-history-empty"`) →
  populated list, each row's outcome independently one of: "In progress"
  (unsettled, spoiler-safe), "Won", "Lost", "Draw". Optional `limit` prop
  truncates the list (used when embedded elsewhere, not from the hub).
- **SideBySideReceipt** (only rendered once `both_complete`): a fixed
  8-level tie-breaker table in the server's own published order, each row
  showing the "decided by" level in bold, every level after it marked
  "Not consulted" (never a lower level shown as "winning" — server-
  computed only), a verdict per level (creator/opponent/tied/tied_within_
  margin/not_consulted), plus an outcome sentence naming both players
  ("X beat Y." / "X and Y finished level."). **No PEAK3 score of any kind
  is computed client-side — every number is `receipt.settlement.levels`,
  read and formatted, never derived.**

**Must not change:** every API call/shape above, the localStorage
breadcrumb key (`RUN_THE_TABLE_STORAGE_KEY`), invite-token URL structure
(`inviteUrl()`), the 8-level tie-breaker order and "not consulted" logic,
`your_outcome`/`opponent_status` spoiler-safety semantics, the rematch
flow, `noindex` on match/invite pages, auth redirect targets
(`?next=/arena/run-the-table/h2h...`).

**Tests:** `head-to-head.test.tsx` covers `SideBySideReceipt`, value
formatting, `HeadToHeadHistory`, `InviteLanding`, and the `headToHeadApi`
client directly. **Zero coverage for `MatchScreen` or `ChallengeCreator`**
— confirmed by reading every `describe` block in the file — these are the
two components the user's brief independently flags as highest-risk.
**Zero e2e coverage for the entire family** (no spec file, no
`run-the-table/h2h` string anywhere in `tests/e2e/`).

**Polish category:** route-family polish, high interaction-risk — visual
system is the easy part; the hard part is not silently touching any of
the state transitions above.

### `/arena/lobby` — Batch 10 semantic inventory (2026-08-30, pre-implementation)

**Same lesson as Batches 8/9, re-confirmed a third time:** the RC audit's
"0 refs, not mentioned anywhere in the route matrix" was correct about the
*matrix's own omission*, but reading the actual composition before touching
it found this route is NOT a blank legacy slab. `ArenaLobby.tsx` went
through a real, undocumented "closed-alpha capability" rewrite of its own
(see the component's own extensive docstring), and `styles/v2/arena-lobby.
css` is an already-shipped "Pass 5" CSS-only reskin of its `.ar-*` classes,
scoped to `[data-ui-version="v2"]` (which is permanently on `<html>` — see
`app/layout.tsx` — so this reskin is live in production today, not an
experiment). A live screenshot pass at 390/768/1024/1440 (this stage, before
any edit) showed a page that already reads as clean and considered: two
peer mode cards inside one hairline-split panel, real status badges,
clear primary/secondary actions, a "coming later" panel. This is a
refinement pass, not a rescue.

**The real, narrow gap:**
1. `ArenaLobby.tsx`'s own JSX still emits raw `<button className="ar-btn
   ar-btn-primary">`/`<span className="ar-badge">` markup instead of the
   shared `PeakV2PrimaryAction`/`PeakV2SecondaryAction`/`StatusChip`
   primitives, and the outer wrapper hand-mimics `PeakV2Shell` (arena-
   lobby.css's `.ar-lobby` override sets the exact same max-width/padding/
   centering `PeakV2Shell` would) rather than using it.
2. The "Coming later in the alpha" panel's `grid-template-columns:
   repeat(auto-fit, minmax(14rem, 1fr))` produces an uneven 2-col-with-
   orphan-wrap layout at 768px (confirmed live: "Public matchmaking" +
   "Ratings" on row one, "Arena leaderboard" alone on row two under the
   first column) — the one concrete layout defect found.
3. The page header (`.ar-lobby-head`) is hand-rolled kicker/h1/intro
   markup on legacy tokens aliased through the reskin, rather than the
   family's now-established v2-token-direct header grammar.

**A CRITICAL SHARED-CSS CONSTRAINT, found by grepping every consumer
before touching anything:** `arena.css`'s `.ar-btn`, `.ar-btn-primary`,
`.ar-badge`, `.ar-badge-alpha`, `.ar-panel`, `.ar-panel-title`,
`.ar-panel-body`, `.ar-panel-actions`, `.ar-notice`, `.ar-lobby`,
`.ar-lobby-head`, `.ar-lobby-title`, `.ar-lobby-intro`, `.ar-eyebrow` are
NOT lobby-exclusive — `ThreeManWeaveLoader.tsx`'s own start-gate (its
pre-match join/create screen) renders its OWN independent JSX using these
SAME class names, and `arena-lobby.css`'s existing `[data-ui-version="v2"]
.ar-btn` (etc.) overrides are global, not scoped under `.ar-lobby` — so
they already reskin Three-Man Weave's and Twenty-Dollar Showdown's start
gates too. Batch 10's explicit scope is `/arena/lobby` only ("do not touch
Three-Man Weave or Twenty-Dollar Showdown yet"), so this batch changes
WHICH MARKUP `ArenaLobby.tsx`'s own render functions (`LobbyShell`,
`Unavailable`, `ComingLater`, `GameCard`, `QueuePanel`, `RoomPanel`) emit
(swapping in `PeakV2*`/`StatusChip` components, which are self-contained
and only affect this file's own output), and leaves every shared `.ar-*`
CSS RULE and every OTHER consumer's JSX byte-for-byte untouched. Classes
that are genuinely lobby-exclusive (verified 0 hits in
`three-man-weave/*.tsx`/`twenty-dollar/*.tsx`) — `.ar-grid`, `.ar-card`,
`.ar-card-*`, `.ar-facts`, `.ar-actions`, `.ar-action`, `.ar-action-note`,
`.ar-private*`, `.ar-code-input`, `.ar-room-code`, `.ar-queue-facts`,
`.ar-progress`, `.ar-later*` — may be freely restyled.

**`components/arena/HowToPlay.tsx` is explicitly OUT OF SCOPE, and stays
untouched this batch,** despite rendering inside every lobby `GameCard`:
it is imported verbatim by `TwentyDollarGame.tsx` and both
`ThreeManWeaveLoader.tsx`/`ThreeManWeaveGame.tsx` too (same rules content,
same component, by design — "the lobby card, the game room and any future
surface all read the SAME sentences"). Restyling it now would touch both
modes' match rooms before their own batch. Recommended as part of Batch
11 instead, where it can be verified against all three consumers at once.

**No fabricated hierarchy:** `lib/arena-modes.ts`'s `ARENA_MODES` carries
no ranked/featured/tier signal between Three-Man Weave and The $20
Showdown — both are peer closed-alpha multiplayer games, distinguished
only by `kindBadge` ("Multiplayer" vs "Auction"). `lib/arena-capability.ts`
derives ONE posture for the whole page (`unavailable`/`practice_only`/
`open`), never a per-mode rank. Per the brief's own instruction, this
batch does not invent a primary/secondary mode distinction that the data
does not support — both cards stay equally weighted, exactly as today.

**Actual state machine** (`ArenaLobby.tsx`, verified against the code):
`readiness` fetch (null while loading) → `capability` derived once
(`arenaCapability()`) → gates in order: fetch error with no readiness yet
(`lobby-error`) → still loading (`lobby-loading`) → `posture ===
"unavailable"` (`lobby-disabled`/`lobby-no-modes`/`lobby-no-entry-paths`,
one wall, three distinct reasons) → `queueMode` set (public-queue takeover,
`QueuePanel`, 2s poll, cancel/fill-with-bots) → `room` set (private-room
takeover, `RoomPanel`, 2s poll until the last seat fills, host-only
fill-with-bots) → the catalogue (`lobby-mode-grid`, one `GameCard` per
`capability.modes`, `?game=` deep-link highlight). Each `GameCard` builds
its own action list from capability (`practiceAvailable`/
`publicQueueAvailable`/`privateRoomAvailable`) — a posture-closed path is
not rendered at all (no disabled ghost button); a transiently-closed path
(bots off while other doors are open) keeps its control, disabled, with a
reason. `practice_only` posture additionally renders `ComingLater` once,
after the grid, instead of per-card disabled controls.

**Must not change:** every `data-testid` in `arena-lobby.test.tsx` (30
tests) and `arena-multiplayer.spec.ts`'s lobby `describe` blocks (~15
tests, shared file with TMW/Twenty-Dollar's own e2e coverage) — including
exact text assertions (`"Closed alpha"`, `"play vs bots"` case-insensitive,
`"Bot practice is offline right now."`, `"Multiplayer is not open yet"`
only in the true-unavailable case, `"unrated in alpha"`, seat format
`"{n} of {seatCount}"`, countdown format `"{n}s"`); `data-posture` on the
`arena-lobby` element; every `matchPath`/`href`/query-param behavior;
`app/(main)/arena/lobby/page.tsx`'s `<Suspense>` fallback, which hand-
mirrors `LobbyShell`'s markup so the two states don't visibly flash
between two different empties — must be updated in lockstep with any
`LobbyShell` header change.

**Test coverage:** already substantial for a route the matrix had never
recorded — `arena-lobby.test.tsx` (30 tests: routes, rated-state,
catalogue data, both-games rendering, closed-alpha, starting a game,
presentation helpers) plus `arena-multiplayer.spec.ts`'s lobby-specific
`describe` blocks (both-games-reachable navigation, the lobby itself,
closed-alpha in a real browser incl. axe + `@mobile` overflow + keyboard).
No coverage gap identified — this batch adds no new test file, only
re-verifies the existing suite against the restyle.

**Polish category:** narrow refinement pass — the shared-CSS-with-other-
consumers constraint above is the load-bearing fact for this batch, not
a legacy-vs-converged question.

### `/arena/three-man-weave`, `/arena/three-man-weave/[matchId]`
- **Renders:** `ThreeManWeaveLoader` → `ThreeManWeaveGame` (3 v2 imports — partial).
- **Must not change:** 872-line-class stage/commit/timeout/reconnect logic (per prior planning doc — verify still true); PickOverlay behavior.
- **Tests:** `three-man-weave-components.test.tsx`, `three-man-weave-state.test.ts`, `three-man-weave-v2-geometry.test.tsx`.
- **Polish category:** partial V2 — visual-consistency pass on existing `PeakV2TMW*` components.

### `/arena/twenty-dollar/[matchId]`
- **Renders:** `TwentyDollarGame` (3 v2 imports — partial).
- **Tests:** `twenty-dollar*.test.tsx` (phase, reconnect, room, base).
- **Polish category:** partial V2, needs a consistency pass.

### `/arena/daily`, `/arena/daily/[mode]`, `/arena/practice/[mode]`, `/arena/results/[id]`, `/arena/labs` — Batch 7 semantic inventory (2026-08-29, pre-implementation)

**Route → component map (actual imports, not inferred):**
- `/arena/daily` → `DailyHubPage` (client component; purely local, nothing fetched — `today` comes from `localDailyWindow()`, used only to key localStorage, never sent as `?date=`).
- `/arena/daily/[mode]` → `DailyDraftPage` (client; `use(params)`) → `DraftScreen`.
- `/arena/practice/[mode]` → `PracticeDraftPage` (async Server Component; only `generateMetadata` + invalid-mode `notFound()`) → `PracticeDraftLoader` (client) → `DraftScreen`. The board is created **in the browser**, not on the server — a documented P0 fix (server-side creation sent the API's ownership cookie to the Next server instead of the player, so ownership checks 403'd every move).
- `/arena/labs` → `LegacyLabsPage` (server component, static `metadata` with `robots: noindex`) — links out to `/arena/daily/{mode}` and `/arena/practice/{mode}`, does not render `DraftScreen` itself.
- `/arena/results/[id]` → `DraftResultsPage` (async Server Component) → `DraftScreen` (`notFound()` if the game id doesn't resolve).
- `DraftScreen` imports (the actual shared surface, `components/draft/`): `DraftCard`, `LineupBoard`, `DNABar`, `DraftToolbar`, `RoleSelector`, `DraftReceipt`, `DecisionReplay`, `ShareChallenge`, `ChallengeComparison`. `ChallengeComparison` additionally imports `DNABar`.
- **Out of scope, confirmed by grep, not touched:** `DNARadar.tsx` — imported by `components/twenty-dollar/ComponentSilhouette.tsx` (a different game family) and referenced (not imported) by `components/rankings/CompositeChart.tsx`; touching it would regress a surface outside this batch's boundary.
- **`/c/[token]`** (shared challenge link) also renders `DraftScreen` + `ChallengeComparison`, so it inherits every change made to those two components, but its own page chrome is a separate surface (documented at `/c/[token]`'s own entry below) and was not restyled this batch beyond what the shared components carry.

**`DraftScreen`'s actual state machine** (`lib/draft-state.ts`'s `DraftUIPhase`, verified against the reducer, not inferred): `loading → selecting ⇄ role_select → submitting → selecting | complete`, plus `tool_confirm` (Hold's "select a card first" prompt) and a `SUBMIT_ERROR`/`SET_ERROR` path that sets `errorMessage` but returns to `selecting`/`complete` (never a distinct visited "error" UI phase in practice — see next point).
- **`state.phase === "error"` in `DraftScreen`'s render is dead code.** No reducer action ever sets `phase: "error"` — `GAME_LOADED` maps every non-`draft_complete` status (including `"expired"`) to `"selecting"`, and `SUBMIT_ERROR`/`SET_ERROR` only ever land on `"selecting"` or `"complete"`. Left exactly as-is (untouched reducer, only its render restyled) per the explicit instruction not to "clean up" logic while touching UI — flagged here rather than silently fixed or silently removed.
- Phases actually reachable and exercised by the existing e2e suite: `selecting` (offer cards, `data-testid="offer-card"`, `data-eligible`, `aria-pressed`), `role_select` (`RoleSelector`, `data-testid="role-btn"`/`data-role`, `data-testid="lock-in"`), `tool_confirm` for Hold only (Reframe has no confirm step — it submits immediately), `submitting` (offers show "Submitting…"), `complete` (`data-testid="draft-result"` — either `ChallengeComparison` when `challengeToken` is set and a comparison has resolved, or `LineupBoard` + `DraftReceipt` + `DecisionReplay` otherwise).
- **Cancel/reselect is fully supported and was not touched:** `DESELECT_OFFER` (RoleSelector's "✕ Cancel") returns to `selecting` with the offer and any pending role cleared; `CANCEL_TOOL` closes the Hold prompt the same way. Both remain exactly as reachable/discoverable after this batch's restyle.
- **Reversibility gaps that exist today, confirmed, not invented and not added:** once `SUBMIT_START` fires (Lock In / Hold / Reframe clicked), there is no client-side cancel of that in-flight request — the player waits for the server's response. This is pre-existing and out of scope (a state-machine change, not a visual one).

**Hold/Reframe (`DraftToolbar`):** Hold with no card selected opens the `tool_confirm` prompt rather than submitting; Hold with a card already selected submits immediately. Reframe always submits immediately (no confirm step — an intentional asymmetry, not a gap: Reframe replaces the whole round's offers and has nothing to "confirm" a card against). Each tool is single-use per game (`hold_used`/`reframe_used`), not per-round — pinned by e2e ("Hold cannot be used twice" / "Reframe cannot be used twice").

**Daily-specific states (`/arena/daily/[mode]`, all pre-existing, not this batch's to change):** `loading` → `error` (retryable) → one of `already_completed` (heading matches `/today.*complete|✓/i`, shows the stored `DraftCompletionSummary`'s rating/efficiency/percentile, a "View Result" replay button with an explicit "won't update your result" notice, and "Play Other Modes") or `playing` (fetches today's board fresh, or resumes an in-progress game **only if** it is a daily, this mode, and dated today — a stale-board bug fix already shipped, documented in the page's own docstring, untouched this batch). A resumed/replayed game renders the same `isReplay` warning banner outside `DraftScreen`.

**Daily hub (`/arena/daily`) states:** per-mode card is either "Play Now" (no completion) or a completed card (rating + "View Result"); a promo banner links out to 82-0 PEAK Season (the current flagship) so a bookmark/old-link visitor is never dead-ended on the legacy hub.

**Legacy Labs (`/arena/labs`) — intentionally distinct posture, confirmed by e2e (`play-routing.spec.ts`):** reachable only by direct URL or a footnote link, **never** from the navbar or the homepage (`a[href="/arena/labs"]` must have zero matches in nav); explicitly labeled "Legacy Labs" / "not part of the main PEAK3 experience" with a route back to the flagship (`/arena/court/practice/apex_1y`); still the literal home of the demoted 1Y/3Y/5Y draft modes (they render nowhere else). Card scores shown here are the same official PEAK3 scores as everywhere else — only `lineup_peak_rating` is the labeled-experimental model, stated verbatim on the page.

**Shared game grammar already present across this family (kept, made visually consistent, not re-templated):** mode identity (`MODE_LABELS` — "1Y Apex"/"3Y Prime"/"5Y Foundation" — plus the existing `--apex-coral`/`--prime-gold`/`--foundation-blue` per-mode color identity, reused from `arena/labs/page.tsx`'s existing precedent), round/progress (`Round {n}/{total}`), candidate card (score, rank, player name, season window, primary role pill, data-completeness dot), selected state (`aria-pressed`, role-colored ring), roster state (`LineupBoard`, per-role filled/open/held), tool state (Hold/Reframe, single-use), result (`LineupBoard` + `DraftReceipt` + `DecisionReplay`, or `ChallengeComparison` for a challenge recipient).

**Must not change (unchanged this batch, confirmed by reading the reducer/api/progress modules, not assumed):** `draft-state.ts`'s reducer and phase transitions; `draft-progress.ts`'s localStorage schema and the daily-board-date resume check; `daily-time.ts`'s daily-key/rollover computation; `draft-api.ts`'s request/response contracts; role eligibility (`eligibleRolesForCard`), Hold/Reframe single-use flags, round/offer counts, `lineup_peak_rating`/`draft_efficiency`/`board_percentile`/synergy/receipt values (all server-computed, never touched client-side); the challenge-token comparison flow (`challengeToken`, `getChallengeComparison`).

**Tests before this batch:** `game-state.test.ts` and `component-labels.test.ts` cover Peak Duel's *different* reducer (`lib/game-state.ts`) and shared component-label renames respectively — neither actually exercises `draft-state.ts` or any `components/draft/*` component. `daily-time.test.ts` covers the shared daily-key module (used by both Peak Duel and this family). **No component-level test existed for `DraftScreen`, any `components/draft/*` component, or any of this family's five pages before this batch** — e2e coverage (`gameplay.spec.ts`'s Practice draft/Hold/Reframe/Decision Replay/Peak Receipt/Challenge-link/Keyboard-navigation suites, `daily-challenge.spec.ts`'s Daily/Challenge-creation/Challenge-flow suites, `accessibility.spec.ts`'s Draft-screen/Role-selector/Hold-state suites, `play-routing.spec.ts`'s Legacy-Labs suite) is real and was the only net protecting this family. Added this batch: `draft-screen.test.tsx` (phase transitions, submit failure, completion), `daily-hub-page.test.tsx`, `legacy-labs-page.test.tsx`.

- **Polish category:** confirmed legacy composition, now the highest-value gap closed this program — restyled onto `PeakV2Shell`/`StatusChip`/`PeakV2PrimaryAction`/`PeakV2SecondaryAction`/the shared `.pk-depth`/`.pk-crown`/`.pk-lift`/`.pk-press`/`.pk-reveal` motion vocabulary (already used by `DraftReceipt`/`ChallengeComparison` from an earlier pass, now extended to `DraftCard`/`RoleSelector`/`LineupBoard`/`DraftToolbar`/both page shells), with a desktop-only persistent roster/DNA sidebar added to `DraftScreen` (CSS-only repositioning via `lg:hidden`/`hidden lg:flex` of the same data — no duplicate DOM, no state-machine change) so a wide viewport gets roster/DNA context alongside the decision instead of just a wider single column. Mobile layout and phase gating are byte-for-byte unchanged.

### `/play/daily`, `/play/endless` — Peak Duel
- **Renders:** `GameEngine` wrapped in `PeakV2Shell`; `/play/daily` also uses `PeakDuelV2AlreadyCompleted`.
- **Must not change:** 5s pick timer, streak logic, `useDailyReset` daily-key semantics, `arena_points` scoring (never computed client-side per CLAUDE.md).
- **Tests:** `game-engine.test.tsx`, `game-intro.test.tsx`, `score-derivation.test.tsx`, `peak-duel-v2-reveal.test.tsx`, `peak-duel-v2-history.test.tsx`, `result-tier.test.ts`, e2e `gameplay.spec.ts`, `duel-viewport.spec.ts`.
- **Polish category:** system-consistency polish — already the most-iterated surface (per `PeakDuelV2*` component count).

### `/daily`, `/daily/grid`, `/daily/history` — Batch 9 semantic inventory (2026-08-30, pre-implementation)

**Same lesson as Batch 8, applied up front this time:** the matrix's own
prior hedge ("verify at runtime before assuming it's 0%") was correct.
Read every one of the 12 `components/daily-grid/*` files plus
`components/daily/DailyHub.tsx` before touching anything. The real gap is
much narrower than "0 v2 imports" implied, but it is real — this is not a
repeat of Batch 8's "actually already done" finding.

**Already fully V2-native, confirmed by reading the code, NOT touched this
batch** (multiple files reference a "Pass 7 (human acceptance testing)"
pass that predates this program and already rebuilt these):
- `/daily` → `DailyHub.tsx` → `PeakV2DailyHub` — a real, mature "Pass 5"
  V2 build. Fully converged.
- `StartGate.tsx` — `PeakV2Shell`/`PeakV2PrimaryAction`/`SecondaryAction`.
- `DailyGridBoardView.tsx` + `GridCell.tsx` — the board itself, the actual
  hero object — full `--v2-*` token usage, "Pass 7" hardened (focus,
  reveal, fit-tier grammar mirrors `PeakV2CourtSlotCard`'s from Batch 8).
- `CellPanel.tsx` — full `--v2-*` token usage, "Phase 11C" accessibility
  hardening (real status badges, never color-only, disabled+labeled
  unplayable rows).
- `CompletionTrigger.tsx` — `.pk-press`, peak-accent tokens.
- `CompletionModal.tsx` — wraps `PeakV2Modal` directly.
- `CompletionPanel.tsx` — fully rebuilt "Pass 7" onto
  `PeakV2CinematicStage`/`PeakV2ResultHeadline`/`PeakV2Rule`/`PeakV2Score`/
  `PeakV2PrimaryAction`/`SecondaryAction` (cinematic-hero → hairline-
  divided detail, explicitly replacing an earlier "card-in-card-in-card"
  legacy structure this pass already deleted).
- `OptimalGrid.tsx`, `RecentResults.tsx`, `DailyLeaderboard.tsx` — reused
  verbatim by `CompletionPanel` ("their own internal presentation
  untouched by this pass" — its own docstring). Not `PeakV2*`-branded but
  already consistent: shared tokens, `.score-number`, and (`RecentResults`)
  `.pk-depth`/`.pk-crown`/`.pk-lift`/`.pk-press`. Already dense/scannable,
  matching this batch's own "favor dense chronological scanability" goal.
  Untouched.
- `PlayerAvatar.tsx` — shared cross-app primitive (RTT, Twenty-Dollar,
  Three-Man-Weave, Rankings, court, this family). Not this batch's to
  restyle.

**The real, narrow gap, found by reading every file:**
1. **`DailyGridGame.tsx`'s own outer shell** (~370 lines: the page header,
   the `StatTile` row, the rollover-prompt banner, the archive-board
   banner, the idle-hint panel, the outer page wrapper) — the one part of
   this whole family that never went through the Pass 7 rebuild. Ad hoc
   `card-surface` boxes, hand-rolled button chrome for History/Tour/Rules,
   no `PeakV2Shell`. Every phase (loading, error, gate, playing, complete)
   routes through this same file, so this is the actual "does the whole
   loop feel like one thing" surface.
2. **`HowToPlay.tsx`'s own action buttons** ("Take the walkthrough" /
   "Back to the grid" / "Close") — raw ad hoc button styling, same class
   of fix as Batch 8's action panels. The `Dialog` wrapper itself and the
   four rule-step cards are fine; only the buttons.
3. **`DailyGridHistory.tsx`** (`/daily/history`) — genuinely untouched:
   no `PeakV2Shell`, its own duplicate `Stat` tile component (same pattern
   as `DailyGridGame`'s `StatTile`, independently reimplemented), raw
   bordered banners, raw button-styled `Link`s. Reuses `RecentResults`
   (already good) for the actual list.

**Actual state machine** (`DailyGridGame.tsx`, verified against the code,
not inferred): `loading` → (`showGate === null`, pre-localStorage-read) →
`showGate === true` (`StartGate`) → playing → `complete`
(`isComplete(progress)` — all 9 cells filled). Within playing:
`selected` (row,col) drives `CellPanel` mounting; a locked cell is final
(no remove/reset control anywhere); `cellMessage` carries the server's
own rejection sentence per cell; `submitting` gates the search-result
buttons; the clock starts at board REVEAL for a returning player (not on
first move) and is anchored server-side (`beginAttempt`/`withServerTimer`)
with a silent local-clock fallback if that call fails. Sub-flows layered
on top, all independently gated: the rollover prompt (`rolloverFrom`,
fires on window-close, non-destructive — an untouched board silently
swaps, a touched one prompts and waits), the archive-board banner
(`isArchiveBoard`, computed from the server's own window when present),
leaderboard retries (`retryRun`/`retryOutcome`/`retryStarting` — a signed-
in player's replay to challenge their own leaderboard entry, never
touches the canonical result), the completion overlay
(`resultModalOpen` + `CompletionTrigger` reopens it, opens automatically
once on completion including a mount that restores an already-finished
board), the rules gate/panel/guided-tour (three independent surfaces:
`showGate`, `rulesPanelOpen`, `tour.open`), and the desktop-only "Recent
Results" rail (`archive.entries.length > 0 && !complete`, added Batch 2 —
see below).

**The Batch 2 sidebar, re-evaluated per this batch's explicit instruction:**
still earns its place. `DailyGridGame.tsx`'s own comment on it is exactly
right and is being preserved, not just assumed: it renders only with real
data, only while a board is in progress (never alongside `CompletionModal`,
which would be the same information twice), and there is deliberately no
narrower reading column to compress the board into at `xl`+ — the rail is
what actually uses that width. Kept, restyled to match the new outer-shell
treatment (its heading/spacing, not `RecentResults` itself, which is
untouched).

**Must not change:** board/date identity (`board.date`/`board.daily_key`,
server-decided, never computed client-side), `board_type`/`isArchiveBoard`
determination, the timed-attempt handshake and its silent-fallback
behavior, one-player-per-board + locked-pick-is-final rules, search
eligibility (`used`/`no_fit`/`unknown`/`available` — server-decided,
client never re-derives), scoring (`arena_points`/`quality_points`, always
server-issued), the rollover's non-destructive prompt behavior, retry-run
semantics (never touches the canonical official result/archive row),
completion-overlay auto-open-once behavior, streak/archive
localStorage schema, official (account-backed) save being best-effort/
silent-on-failure.

**Tests:** the large existing `daily-grid-*` suite (api, archive,
completion-v2, components [1428 lines/75+ tests], mobile-labels, retry,
rollover, share-card, start-gate-v2, state, tour) plus e2e
`daily-grid.spec.ts` — all testid/text-content based (`toHaveTextContent`
substring/regex), except `daily-grid-timer` which e2e pins with an EXACT
`toHaveText("6:30")` match, meaning that testid's element must contain
ONLY the time value, never the label. **`DailyGridHistory.tsx` and
`HowToPlay.tsx` have no dedicated unit test today** — a real gap, added
this batch.

- **Polish category:** narrow, surgical convergence — same shape as Batch
  8. The board/cell/completion loop is already excellent (Pass 7); the
  gap is the orchestrator's own outer chrome, one dialog's buttons, and
  one genuinely-untouched history page.

### `/rankings`, `/methodology`
- **Renders:** `PeakV2Shell` + `PeakV2ResultHeadline` + `PeakV2Rule` wrapping `RankingsTable`/`RankingsAnalysis`/`RankingsProvenance` (rankings) and an accordion (methodology).
- **Must not change:** table/chart/filter logic, accordion content, `getMethodology`/`getPeakWindowBoard`/`getSeasonBoard` data contracts.
- **Tests:** `rankings-analysis.test.tsx`, `rankings-detail.test.tsx`, `rankings-position-filter.test.ts`, `rankings-provenance.test.ts`, `rankings-receipts.test.ts`, `rankings-row-interaction.test.tsx`, e2e `rankings.spec.ts`.
- **Polish category:** already V2-shelled — data-density/chart-chrome refinement only, per CLAUDE.md's explicit "do NOT touch table/chart/accordion logic."

### `/about`, `/accessibility`, `/contact`, `/data-sources`, `/privacy`, `/terms`
- **Renders:** static content pages; `styles/v2/info-pages.css` loaded globally suggests these already have *some* v2 treatment.
- **Polish category:** low-risk, likely typography/spacing-only — verify against `info-pages.css` before assuming a gap exists.

### `/profile`, `/progress`, `/history` — Batch 4 semantic inventory (2026-08-29, pre-implementation)

All three: **no `PeakV2Shell`/`PeakV2*` imports**, plain `max-w-{lg,2xl} mx-auto px-4 py-8` + `<h1 className="text-xl font-bold">`. All three share a byte-identical ad hoc loading spinner (`animate-spin` div) — also used by 3 unrelated pages outside this batch's scope (`auth/complete`, `arena/daily/[mode]`, `c/[token]`; left untouched, noted for a future pass). All three have an ad hoc `role="alert"` error box that duplicates what `ErrorState` (introduced batch 3) already does.

**`/profile`** — auth-gated (`signInHref("/profile")` redirect if `!user`; separate `!supabaseEnabled` state renders "Authentication is not configured" + a link home, distinct from the auth-gate redirect).
- Identity: `InitialsAvatar`, "Signed in as {email}", "· Joined {date}" if `profile.joined_at` present
- Competitive status: `RankedRatingCards` — one card per queue (1Y/3Y/5Y), each showing established rating+division+uncertainty label, or "Placement N of 7", or omitted entirely if that queue has no data yet; a footnote once fewer than 2 queues are established
- Account settings form: Handle (text, 3–20 chars, helper copy on public visibility), Display Name, Bio (textarea), "Make profile public" checkbox, Save button, `role="alert"` error / `role="status"` "Profile saved."
- Navigation: links to `/progress`, `/history`, "Sign Out" button (`data-testid="profile-signout"`)
- **Does NOT currently show:** achievements/trophies (that data lives only on `/progress`) — Batch 4 will not invent an achievements fetch here; the existing `/progress` link is the "obvious navigation into deeper progression" the product brief asks for, restyled but not duplicated.
- **Tests:** `profile-api.test.ts`. **No component test file for the page itself found** — a gap.

**`/progress`** — auth-gated (`/signin?returnTo=/progress` redirect if `!user`). `data-testid="progress-page"`.
- Header: "My Progress" + "← Profile" link
- Level/XP (`data-testid="level-summary"`): current level, total XP, `XpProgress` bar (`role="progressbar"`, `aria-valuenow`), explicit copy **"XP measures your exploration, not your skill. Level is a participation indicator."** — this sentence is the existing product-principle statement the batch must preserve verbatim in spirit (skill vs. participation are visually and textually distinct)
- `StreakCard`: current streak, longest streak, reserve-day badge if available, contextual copy per state (0 streak / building toward reserve / has reserve)
- Tabs (`role="tablist"`/`role="tab"`/`aria-selected`): Overview (3 `StatCard`s — Achievements/Records/Best Streak counts, plus a "Recent achievements" list), Achievements (Earned (N) / Not yet earned (N), `AchievementCard` per entry — icon, title, category badge, description/requirement copy, earned date), Records (`PersonalRecords` — grouped by record type, one card per mode with formatted value + achieved date, or an empty-state sentence)
- **Tests:** `progression-components.test.tsx`, `progress.test.ts`.

**`/history`** — auth-gated (`signInHref("/history")` redirect if `!user`).
- Header: "Match History" + "← Profile" link
- Empty state: "No completed games yet." + "Play today's Daily" link (`/arena/daily`)
- Per-item card: board-type badge (Daily/Practice/Challenge), mode label (1Y Apex/3Y Prime/5Y Foundation), completed date, Lineup Peak Rating (large number, `tabular-nums` but not yet `.score-number` mono), optional draft-efficiency %, optional board-percentile, optional Hold/Reframe badges
- **Items are NOT currently clickable/linked anywhere** — no detail-page click-through exists today. Batch 4 must not invent one; "easy re-entry into a result/detail page where supported" does not apply here since none is supported.
- Cursor-based "Load more" pagination (disabled while fetching)
- **Tests:** none found specifically for this page — a gap, same as `/profile`.

**Must not change (all three):** `useAuth`/`getAccessToken` gating, `signInHref`/`returnTo` redirect pattern, XP/streak/achievement/rating/history data contracts and API calls, tab state machine, pagination cursor logic, achievement earned/not-earned partitioning, `RankedRatingCards`'s "no composite rank until 2+ queues established" rule.

**Polish category:** genuine route-family polish target — these are exactly the "profile/progression" surfaces CLAUDE.md's product brief calls out for milestone-grouped, uncluttered treatment. Product intent per the user's Batch 4 brief: `/profile` = "who am I," `/progress` = "how am I developing" (participation, not skill), `/history` = "what have I done" (chronological record) — hierarchy should reflect that distinction, not force all three into one interchangeable dashboard template.

### `/u/[handle]` (public profile view — NOT in Batch 4 scope, untouched)
- Separate route from `/profile`; not investigated this batch.

### `/signin`, `/signup`, `/auth/complete`, `/auth/auth-code-error`
- **Renders:** `AuthShell` + `SignInPanel`, no V2 shell.
- **Must not change:** `safeNext`/`signInHref` redirect safety, Supabase auth flow, `authSurfaceEnabled` gating (must render nothing when Supabase isn't configured — `NEXT_PUBLIC_PEAK3_E2E_AUTH` semantics).
- **Tests:** `auth-*.test.ts(x)` (callback, claim, complete, safe-next, session, token-cache, ui), e2e `auth.spec.ts`.
- **Polish category:** intentionally quiet per CLAUDE.md's own design principles ("Auth/Settings surfaces — deliberately quieter, no need to theme aggressively") — light consistency pass only, do not "gamify."

### `/players/[slug]` — Batch 5 semantic inventory (2026-08-29, pre-implementation)

**Renders:** `apps/web/src/app/(main)/players/[slug]/page.tsx` — an ASYNC SERVER
COMPONENT (no `"use client"`, no interactivity at all). No V2 shell. No
`loading.tsx`/`error.tsx` in the route folder. Data fetch is a raw
`fetch()` in the page itself (not the existing typed `getPlayer()` client
in `lib/api.ts` — a real but pre-existing inconsistency, left alone this
batch since it's a data-fetch mechanism change, not presentation).

**No Index/search surface exists.** `searchPlayers()` (`lib/api.ts`) and
`PlayerSearchResponse` are defined but have **zero callers anywhere in the
app** — dead code, not a hidden feature to restore. The only real entry
point into this route is the home page's `NbaFactOfTheDay.tsx` widget
(`href={`/players/${fact.player_slug}`}`) plus direct/shared URLs.
`RankingsTable`'s row action opens an in-page analysis drawer
(`RankingsAnalysis.tsx`), not this route — the two are unrelated surfaces
that happen to both display PEAK3 component data; `RankingsAnalysis` is
out of scope (belongs to `/rankings`, not touched this batch).

**Semantic inventory (what exists today — nothing more):**
- Not-found state: centered card, "Player not found", `No PEAK3 data for
  "{slug}".`, link back to `/rankings`. **Currently conflates a true 404
  with any other fetch failure** (`getPlayerData`'s catch-all returns
  `null` either way) — a real accuracy gap for a page whose whole framing
  is "authoritative reference," addressed this batch (distinguish 404 from
  a genuine load failure) since it's a correctness fix, not a new feature.
- Populated state: breadcrumb link to `/rankings`; header (`player_name`,
  large display font; subtext "PEAK3 profile · N peak window(s)"); for
  each duration in `[1,2,3,5]` present in `player.windows`: a card showing
  kicker "{d}-Year Peak", season range (`start_season`–`end_season` or a
  single year), "Rank #{win.rank}", `prime_score` (large, bold, accent
  color), "Prime Score" label, "Index: {prime_index}"; a component
  breakdown (if `win.components` present) — 5 named components
  (Statistical Impact/Traditional Production/Individual Recognition/
  Playoff Rate Impact/Team Result) as label+bar+value rows using the 6
  frozen `componentColor`/`componentTextColor` tokens, plus a dimmed
  "Teammate Adj." row (value only, no bar); a footer link "View {d}-year
  leaderboard →" to `/rankings?years={d}`; a page-level footer sentence
  with a Methodology link.
- **Confirmed bug, not touched-up cosmetically — fixed this batch:** the
  rank line is hardcoded `Rank #{win.rank} (1–year window)` **regardless
  of `d`** — every window (including 2/3/5-year) currently prints the
  literal string "(1–year window)". The rank *number* is correct; only the
  accompanying label text is wrong. This is exactly the kind of thing an
  "authoritative editorial reference" cannot ship with.
- No loading state (no `loading.tsx`) — added this batch (standard Next.js
  App Router convention, no logic/data change).
- No window selector/toggle, no chart, no season-by-season table, no
  tooltips — **none of this exists today.** The product blueprint's "Peak
  Mountain" concept and any career-trajectory chart are NOT implemented
  here; do not build them in this batch (would require new data/APIs).
  All present windows render simultaneously, always — there is no
  "selected window" state to preserve because none exists.
- Mobile: header row already has `flex-wrap`; not otherwise specially
  handled.
- **Existing color precedent to reuse, not invent:** `--apex-coral(-text)`
  / `--prime-gold(-text)` (= `--peak-accent(-text)`) / `--foundation-blue
  (-text)` already exist in `globals.css` ("Peak Draft mode colors") and
  are already used to color-code 1yr/3yr/5yr in `arena/labs/page.tsx`
  (`apex_1y`/`prime_3y`/`foundation_5y`). This is the same 1/3/5-year
  identity the product brief asks for — reused directly for this page's
  per-window kicker color, not a new token set. 2-year windows (which can
  exist per the model but have no named color anywhere in the app) get no
  invented color — plain neutral treatment.
- **Must not change:** `player.windows[d]` data values (`rank`,
  `prime_score`, `prime_index`, every `components` field), which windows
  are considered present (`durations` filter), the `/rankings?years={d}`
  and `/rankings` link targets, `generateMetadata`'s title logic.
- **Tests:** none exist for this route at all (`player-avatar.test.tsx` is
  an unrelated component). Zero e2e coverage either (grepped all
  `*.spec.ts` — no navigation to `/players/`).
- **Polish category:** route-family polish — a real chance to establish
  PEAK3's "premium basketball editorial + statistical reference" identity
  (per the user's Batch 5 brief), using only what's actually implemented:
  identity → per-window peak figures (now with 1/3/5yr color identity) →
  existing component-breakdown bars, refined. No chart, no selector, no
  new visualization — those would be product development, not polish.

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
