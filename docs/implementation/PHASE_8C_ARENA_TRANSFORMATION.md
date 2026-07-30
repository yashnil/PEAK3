# Phase 8C — PEAK Season Arena Transformation

Status: **implemented, not committed**. Branch `phase8-peak-season-game-loop`,
continuing from Phase 8B (`02a3672`). See the final report delivered in
conversation for the full before/after, test results, and git status --
this doc captures the durable plan/design record.

## 1. Playtest problem inventory (source of truth for scope)

1. **Spinner/respin doesn't read as a real event.** Phase 8B added a reel-tick
   flourish, but it ticks *both* wheels on every respin — a team-only respin
   and a season-only respin look identical, and neither wheel visibly
   "locks." Backend (`state.py::action_respin_team/_season`) already prefers
   keeping the other axis fixed (same-season/different-team and vice versa,
   falling back to a fully independent pair only if no valid same-axis
   option exists) — the bug is purely that the frontend never told the user
   which axis was actually rerolling.
2. **Court is still a rail, not the main stage.** Phase 8B put it in a sticky
   400px column. That fixed truncation but the court is still visually
   secondary to the candidate list, even during placement — the step where
   the court is the *actual* point of interest.
3. **Cards read as labels, not collectible cards.** Correct information,
   flat hierarchy, no portrait-forward layout.
4. **Portraits still sparse**, no per-pool coverage accounting (only a flat
   resolved/unresolved count from the manifest script).
5. **Result screen reads as a report**, not a broadcast moment — flat
   regardless of whether the roster is elite or disastrous, and doesn't
   visually distinguish complete vs. incomplete-score runs.
6. **Win floor lets true disaster rosters land at "merely bad."** Root cause
   found: `expected_wins = max(15.0, min(82.0, base))` floors the *pre-noise*
   projection at 15, but the final `wins = round(clamp(0, 82, expected_wins +
   uniform(-2.5, 2.5)))` is only clamped to `[0, 82]` — so today's "13-69"
   report is really "15-win floor minus bad luck," not a deliberate
   catastrophe outcome. A genuinely starless, creation-less, scoring-less,
   mostly-unscored roster should be able to fall much lower than 15.
7. **Desktop screen space still underused outside the rail.**
8. **Team identity (colors, safe fallback) should be leaned on harder.**

## 2. Design direction

Stays inside the existing **Arena Archive** identity from the product
blueprint (`docs/product/PEAK3_Product_Implementation_Blueprint.pdf` Part
11: archival scouting file + arena scoreboard + premium sports publication +
research-tool precision; large numerals, structured grids, thin technical
lines, *selective* high-energy accents) and the existing PEAK3 palette
(`--peak-accent` gold, `--comp-*` component tokens, real team colors from
`team-colors.ts`) — no new color system, no literal logos (CLAUDE.md: no
player photographs beyond the existing opt-in headshot-URL policy, no NBA
team logos).

Three structural moves:

- **A "placement mode" shell.** Once a player is selected (step 2 of a
  round), the court becomes the dominant surface — the candidate
  list/spin recap collapses to a secondary strip — instead of a
  permanently-fixed rail. Selection (step 1) keeps the current
  candidate-forward layout. This directly answers "the court should
  become the main interaction, not a small side rail" without
  restructuring the whole game loop.
- **Axis-aware spinner.** `SpinStage` gets an explicit `respinKind:
  "team" | "season" | null` input. Only the matching wheel re-ticks;
  the other gets a distinct "locked" treatment (dim, a small lock
  glyph, no animation). This is a real, verifiable frontend/backend
  correspondence, not just a visual flourish — the plan includes a
  Playwright assertion that inspects which wheel animates.
- **Tiered result reveal.** Complete-score runs keep the precise
  record; incomplete-score runs get explicit "Estimated" / "Provisional"
  language and a visibly different (non-official-looking) score
  treatment, matching the backend's existing
  `incomplete_score_not_eligible` leaderboard gate (already enforced
  server-side in `apps/api/app/api/v1/perfect_season.py::submit_run` —
  the gap is that the frontend doesn't proactively surface this before
  a failed submit attempt).

## 3. Dependencies — considered, decided

| Package | Decision | Reasoning |
|---|---|---|
| `motion` (11.18.2) | **Use.** Already an installed, actively-used dependency (`apps/web/src/components/game/*.tsx` already import from `motion/react`) — no new install. Used for the reel spring/lock/reveal, the rail↔placement-mode layout transition (`layout`/`layoutId` shared-element animation — genuinely hard to do smoothly with pure CSS grid reflow), and a staggered result-reveal sequence. **Must** explicitly gate every new `motion.*` animation with `useReducedMotion()` from `motion/react` — confirmed via docs that the project's existing blanket CSS `prefers-reduced-motion` override (`globals.css`) only neutralizes CSS `@keyframes`/`transition`, not motion's WAAPI/RAF-driven animations, so it does not automatically cover new `motion.*` components. |
| `@dnd-kit/core` / `@dnd-kit/react` | **Decline.** Reviewed `dndkit.com/guides/accessibility`: real drag-and-drop accessibility requires custom ARIA descriptions, a customized live-region `announcements` prop, and keyboard-sensor tuning beyond the library defaults — a genuine, ongoing a11y maintenance surface. The existing click-to-select-then-click-to-place flow is already fully keyboard-operable (covered by the existing "a full round can be completed via keyboard only" Playwright test) and screen-reader-clear. The "collectible/premium" and "big placement stage" goals are achievable through card visual design + `motion` transitions, not spatial dragging — adding a second, redundant input model (click *and* drag) for the same action is complexity without a corresponding UX win here. |
| CSS container queries | **Keep using** (already adopted in Phase 8B for `.court-panel-wrapper`). Extend the same pattern to the new placement-mode court sizing rather than a JS resize observer. |
| CSS view transitions (`View Transition API`) | **Decline for now.** Not yet consistently supported cross-browser at the level this project's Playwright matrix needs, and `motion`'s `layout` animation covers the one transition (rail → placement-mode court) that would benefit from it. Revisit if a future pass needs cross-document transitions. |

## 4. Backend: simulator catastrophe/floor calibration — IMPLEMENTED

Change scope: **`nba_peak/perfect_season/simulation.py` only** (`compute_exact_fit_components`/`simulate_exact_season`) — never the
core PEAK3 individual player score (`peak3.py`, `OFFICIAL_WEIGHTS`,
`calibrate_score()`), per the hard constraint. Scoped to the exact-season
path only — the legacy peak-window `simulate_season()` has no "unscored
card" concept (every `CardProfile` is always scored), so a catastrophe
trigger built around unscored/low-minute cards doesn't apply there; it was
left untouched rather than force-fit.

**User-directed correction from the original plan:** not a global floor
drop. Two floors, chosen deliberately instead of the one accidental one
that produced the "13-69" report:

- `_NORMAL_BAD_WINS_FLOOR = 15.0` (unchanged) — the default floor every
  roster gets. An ordinary bad roster (real, scored NBA talent that just
  doesn't fit together) still lands ~15-25 wins.
- `_CATASTROPHE_WINS_FLOOR = 5.0` — reached ONLY when
  `_is_catastrophe_roster()` returns true:
  `talent_core < 30 AND creation_coverage < 30 AND scoring_coverage < 30
  AND count(cards that are unscored OR real minutes_per_game < 15) >= 2`.
  All four conditions must hold at once — any single bad axis alone keeps
  the roster on the normal floor. Chosen below the real NBA's worst-ever
  82-game-equivalent pace (2011-12 Bobcats, 7-59 in a 66-game lockout
  season = a .106 clip ≈ 9 wins over 82) on purpose: a real team always
  has real replacement-level players in every minute, but a *constructed*
  disaster roster here might not, so it can legitimately be worse than any
  real team ever fielded.
- Final `wins` (post-noise) keeps a small absolute floor, `_MIN_FINAL_WINS
  = 1.0` (was `0.0`) — never a literal 0-82 result, which would read as a
  bug rather than a feature. This is the only change to the "normal"
  path's final clamp.
- No new catastrophe *multiplier* — the existing linear weighted formula
  is left completely alone. Removing the artificial floor is what lets
  its own (already very negative) result show through for a real
  disaster.

**Verified against real data** (not synthetic numbers): built fixtures
from the actual 2011-12 Charlotte Bobcats roster (Basketball-Reference
data already in the committed dataset).
- `NORMAL_BAD_LINEUP` — 8 real, fully-*scored* Bobcats bench players
  (Augustin, Henderson, Maggette, Thomas, Biyombo, Mullens, White, D.
  Brown). `_is_catastrophe_roster()` → `False`. Result: **13-69**
  (board_seed=1) — on the normal floor, matching the exact number
  originally reported as "unexplained," now explained: this is what an
  ordinary-bad, fully-scored roster does on the (unchanged) 15-win floor
  plus noise.
- `DISASTER_LINEUP` — same core group, swap 3 scored bench players for 3
  real *unscored* Bobcats (Higgins, Diop, Najera). `_is_catastrophe_roster()`
  → `True`. Result: **7-75** — right at the real 2011-12 Bobcats' own
  historical pace.
- `INCOMPLETE_DISASTER_LINEUP` — 6 of 8 cards unscored. Result: **3-79**,
  `lineup_peak_score == 0.0` (honestly reported incomplete, never
  estimated), no crash.
- `ALL_TIME_CEILING_LINEUP` (regression) — unaffected, still **82-0**.

New tests in `apps/api/tests/test_perfect_season.py`:
`test_normal_bad_roster_stays_on_the_15_win_floor_not_catastrophe`,
`test_disaster_roster_falls_into_the_catastrophe_range`,
`test_incomplete_score_disaster_roster_degrades_gracefully`,
`test_elite_roster_unaffected_by_catastrophe_floor_change`.

## 5. Portrait coverage: audit script

New `scripts/audit_player_portrait_coverage.py` (offline, reads the
already-committed manifests + team-year dataset — no network calls, so it
can run in CI). Reports, per the request:

- total eligible players (union of 250-canonical + team-year pool, same
  union Phase 8B already resolves against)
- portraits resolved (count + %) with **provider breakdown** (ESPN roster
  match / ESPN broader-athlete-pool match / NBA_CDN)
- unresolved **canonical-250** players (named list — this is the
  highest-visibility pool)
- unresolved **1500-identity-pool** players (named list, cross-referenced
  against `candidate_identity_manifest.v1.json`'s 1510 entries — a
  distinct, smaller, curated pool from the 3494-name full team-year
  candidate set Phase 8B unioned against)
- licensing/cache-policy line (restates `unknown_do_not_cache` /
  `dev_hotlink_preview_only`, gated by `PEAK3_ENABLE_EXTERNAL_ASSET_URLS`)
- an honest NBA CDN status line: re-verified this pass that
  `stats.nba.com` and `cdn.nba.com`'s static JSON endpoints are still
  unreachable/403 from this environment, so the NBA_CDN provider remains
  real-but-inert (0 resolutions) pending a verified local
  `player_slug → NBA.com person_id` crosswalk that does not currently
  exist anywhere in this repo's committed data. This is stated as fact,
  not worked around or faked.
- Likely a further resolution bump from re-running the Phase 8B
  normalization fix (diacritics/suffixes) against the 1500-pool
  specifically, if that pool's name strings differ at all from the
  3494-pool ones already covered — verified during implementation, not
  assumed.

## 6. Frontend: placement mode, card redesign, spinner axis-lock

- `SpinStage`: add `respinKind` prop; only the matching wheel animates on
  respin, the other renders a `locked` visual state (dim + lock glyph,
  `data-testid="wheel-locked"`). Reduced motion: identical instant-settle
  contract as today, just scoped to the correct wheel.
- `CourtBuilder`: introduce a `uiMode: "select" | "place"` derived from
  existing `phase` (no new server state) that swaps which side of the
  `arena-shell` is dominant — court expands via a `motion.div layout`
  transition when entering placement, collapses back on cancel/next
  round. Mobile keeps single-column stacking (placement mode there just
  reorders which section is on top, no dead space to reclaim).
- `PeakCardCourt`/`EligiblePlayerSearch`: restructure card internals into
  a clearer portrait/name/season-team/position-fit/score-status
  hierarchy (still never leaking a hidden score pre-reveal — that
  contract is untouched). Empty slots get a "draft target" treatment
  (dashed target ring + slot-role icon) instead of a flat "Open" label.
- `SeasonResultStub`/`LeaderboardSubmitPanel`: thread
  `lineup_score_status` into the submit panel so an incomplete-score run
  shows a disabled, explained submit state up front instead of only
  failing after a click; result hero gets a staggered `motion` reveal
  (gated by `useReducedMotion`) scaled by tier, reusing Phase 8B's
  `tierGlow` levels rather than inventing a new scale.

## 7. Explicit non-goals / tradeoffs

- No drag-and-drop (see dependency table).
- No change to the core PEAK3 individual scoring formula or its weights.
- No new color/token system — richer use of the *existing* palette only.
- No literal NBA team logos or player photo binaries; URL-metadata +
  explicit opt-in flag policy is unchanged.
- Portrait coverage for the full 1500 pool is not claimed as 100%
  achievable — the audit script exists specifically to state the honest
  ceiling given verified-ID constraints, per the task's own instruction.

## 8b. Implementation results (all sections above implemented)

- **Axis-aware spinner**: `SpinStage.tsx` now takes `respinKind`; only the
  respun wheel re-ticks (via `motion`/`ReelStrip`), the other renders a
  dimmed, `Lock`-icon "Locked" badge. Verified with 2 new Playwright tests
  that assert BOTH the visual badge AND that the locked wheel's actual
  displayed value is byte-identical before/after the respin settles.
- **Placement mode**: `.arena-shell[data-mode="place"]` swaps
  `grid-template-columns` from `1fr 400px` to `300px 1fr` on lg+, animated
  via a plain CSS `transition` (no motion needed -- grid track sizes
  interpolate natively, and it's automatically covered by the existing
  global reduced-motion override). Confirmed visually: the court goes from
  a 400px rail to occupying the majority of a 1440px viewport, and Phase
  8B's container queries on `.court-panel-wrapper` mean the wider court
  also reflows to a roomier internal layout at the same time.
  `data-mode`/`data-testid="arena-shell"` added for testability.
- **Card redesign**: portrait "medallion" (team-color ring, never a logo)
  replaces the plain inline avatar on both court slots and candidate rows;
  team-color dot on the team/season line; `Lock` icon on hidden-score
  states; empty slots get a dashed border + `Target` icon + a slow
  breathing-pulse animation only while they're the active placement
  target (`.draft-target`).
- **Portrait audit**: new `scripts/audit_player_portrait_coverage.py`
  (offline by default, `--recheck-nba-cdn` for a live check) plus 6 new
  tests in `tests/test_audit_player_portrait_coverage.py`. Current
  coverage: 526/3,432 eligible players resolved (15.3%) -- 66/250 (26.4%)
  of the canonical pool, 314/1,510 (20.8%) of the curated identity pool,
  all via ESPN. NBA CDN re-verified live this pass: `stats.nba.com`
  unreachable (connection timeout), `cdn.nba.com` static JSON returns 403
  -- still real, tested, and honestly inert (0 resolutions), not faked.
- **Result reveal**: staggered `motion` reveal (5 sections, 80ms stagger,
  `useReducedMotion`-gated) on the result screen. Incomplete-score runs now
  get an explicit "Estimated" badge next to the record and "Provisional
  record — not all cards are officially scored" framing instead of the
  confident "PERFECT SEASON" treatment, even if the noisy formula happened
  to clamp to 82 wins.
- **Leaderboard proactive gating**: `LeaderboardSubmitPanel` now takes
  `lineupScoreStatus` and shows a disabled "Not eligible yet" state with an
  explanation up front for incomplete-score runs, instead of only failing
  after a click against the backend's existing
  `incomplete_score_not_eligible` gate. 3 new Vitest component tests.
- **Catastrophe win floor**: see Section 4 above (fully updated with real
  results from the actual 2011-12 Bobcats fixtures).

## 8c. Dependencies -- final

`motion` (already installed, already used elsewhere in the codebase) is now
also used in `SpinStage.tsx` (locked-wheel badge, per-tick/reveal pop) and
`SeasonResultStub.tsx` (staggered reveal) -- zero new packages added.
`@dnd-kit` was not added, per the plan's reasoning (Section 3). `lucide-react`
(already installed) gained two new icon imports (`Lock`, `Target`) used in
the card redesign.

## 8. Test plan

Backend: `python -m pytest tests/`, `python -m pytest apps/api/tests/`
(full suites, regression), plus new disaster/incomplete-score/normal-bad/
elite fixture tests in `test_perfect_season.py`, plus a respin-independence
test asserting the *un*-respun axis's `era_label`/`team_id` is unchanged
after a same-axis respin in the common case.

Frontend: `npm run typecheck`, `npm run lint -- --max-warnings 0`, `npm run
test`, `npx playwright test src/tests/e2e/courtbuilder.spec.ts` (chromium +
mobile-chrome), `npx playwright test src/tests/e2e/accessibility.spec.ts`,
`npm run build`. New Playwright coverage: team-only respin leaves the
season wheel in its locked visual state (and vice versa), placement mode
visibly resizes the court, incomplete-score run shows the disabled/labeled
submit state.
