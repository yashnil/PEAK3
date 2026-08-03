# Theme token migration — inventory (P3-G / P3-G2)

Companion to `PERFORMANCE.md`'s original 217-hex-across-54-files finding.
P3-G fixed the homepage/leaderboard remainder and shipped the light theme;
**P3-G2 completed the rest of the hardcoded-hex migration** (Peak Draft,
82-0 gameplay, progression, auth forms, general app pages — everything
outside RTT, which `rtt-experience` owns) and, in the course of measuring
contrast for it, found a second, larger, separate bug class described in
§2 below.

## §1. Hardcoded-hex migration — done

**134 of 137 non-RTT hardcoded hex occurrences fixed** (the 3 remaining —
`GuidedTour.tsx`'s 2 SVG mask fills and `privacy/page.tsx`'s 2 HTML-entity
false-positives from the audit's regex — were never real color bugs; see
§3). RTT's own 18 (`RunMap.tsx`, `RunStartGate.tsx`, `TradeDesk.tsx`, and
five more) are untouched — `rtt-experience`'s exclusively-owned files, per
`FILE_OWNERSHIP.md`.

| Group | Files | Fixed |
| --- | --- | --- |
| Peak Draft | 11 | `DraftReceipt.tsx` (15 — the worst single offender in the original audit), `DraftCard.tsx` (7), `RoleSelector.tsx` (5), `LineupBoard.tsx` (5), `DraftScreen.tsx` (5), `DNABar.tsx` (4), `ChallengeComparison.tsx` (4), `DraftToolbar.tsx` (2), `ShareChallenge.tsx` (1), `PracticeDraftLoader.tsx` (1), `DNARadar.tsx` (1) |
| 82-0 / CourtBuilder gameplay | 11 | `SeasonResultStub.tsx`, `SaveRunPanel.tsx`, `PeakCardCourt.tsx`, `PeakSeasonStartGate.tsx`, `LeaderboardSubmitPanel.tsx`, `CourtBuilder.tsx`, `PeakPicksRecap.tsx`, `LineupInsightPanel.tsx`, `PlayAgainPanel.tsx`, `ShareRunPanel.tsx`, `EligiblePlayerSearch.tsx`, `SpinStage.tsx` |
| Progression | 2 | `AchievementCard.tsx`, `AchievementUnlock.tsx` |
| Auth forms | 3 | `SignInPanel.tsx`, `PasswordForm.tsx`, `MagicLinkForm.tsx` |
| General app pages | 12 | `arena/labs`, `arena/daily/[mode]`, `arena/ranked`, `arena/court/history`, `c/[token]`, `profile`, `history`, `progress`, `arena`, `arena/daily`, `arena/court/results/[id]`, `rankings` |

New reusable tokens this pass added to `globals.css` (dark value = the
pre-existing literal, unchanged; light value measured against the P3-G
surfaces, not assumed):

- `--warning` / `--warning-bg` — promoted from a repeated literal
  `#f59e0b` (measured 2.03:1 on Arena Day; light value `#8a5a05` clears
  5.4:1+).
- `--accent-blue` / `-violet` / `-pink` / `-orange` / `-emerald` — the
  general-purpose text-safe version of the five `--role-*`/`--comp-*`
  hues, for one-off status badges that are not themselves a PEAK3
  component or roster role.
- `--achievement-onboarding` / `-challenge` / `-construction` / `-habit` —
  progression's own category colors (same hue family as `--role-*` by
  coincidence, not by reference), promoted out of hardcoded hex in
  `AchievementCard.tsx`/`AchievementUnlock.tsx`.

**Two real, load-bearing bugs found and fixed while migrating, unrelated to
theming**:
- `DraftScreen.tsx`'s hold-pending banner used `"var(--peak-accent)10"` /
  `"var(--peak-accent)40"` — a hex-alpha suffix appended directly to a
  `var()` reference, which is invalid CSS the browser silently drops. This
  was broken in **every** theme before this pass, not just light mode.
- `SpinStage.tsx` referenced `var(--border-muted, #333)` twice —
  `--border-muted` was never defined anywhere in `globals.css`, so the
  fallback `#333` (unthemed dark gray) was the only value that ever
  rendered. Repointed at the real `--border-subtle` token.

Also fixed 4 more instances of the `rgba(255,255,255,0.06..0.08)` "ghost
white badge" bug this pass's earlier audit already flagged once
(`arena/court/history/page.tsx`, `LiveBuildPanel.tsx`, `PeakCardCourt.tsx`
×2, `SeasonResultStub.tsx`, `EligiblePlayerSearch.tsx` ×3) — a hardcoded
white-alpha wash that reads as invisible-to-muddy on a light card.

**The `${color}NN` hex-alpha-suffix pattern.** Several files (`DraftCard.tsx`,
`LineupBoard.tsx`, `RoleSelector.tsx`, `AchievementCard.tsx`,
`AchievementUnlock.tsx`, `DraftReceipt.tsx`) built a translucent
background/border by string-concatenating a two-digit hex pair onto a color
variable (`${color}20`, `color + "40"`). That only ever worked because the
variable held a literal hex string; the instant it became a `var(--token)`
reference (required for a theme-aware value), the concatenation produced
invalid CSS like `var(--accent-blue)20`, silently dropped by the browser.
Every one of these was rewritten to `color-mix(in srgb, ${color} 20%,
transparent)`, which works with any CSS color value.

## §2. NEW FINDING — `--peak-accent`/`--comp-*` used as literal text color, app-wide

While fixing the hardcoded hex above, contrast measurement (not assumption)
turned up a second, larger, and more severe bug — not a hardcoded-hex
bypass, but a **frozen token used correctly by name and still wrong**:

- `#f5c842` (`--peak-accent`) as text on the new `--bg-surface`: **1.50:1**.
  Fails WCAG AA at every text size — there is no size at which this
  passes, unlike `--correct`/`--incorrect` (§ P3-G's PERFORMANCE.md note),
  which only failed small text.
- `--comp-si`/`-tp`/`-rec`/`-po`/`-team` as text: **1.8–2.6:1** each,
  same failure.

Both are frozen (CLAUDE.md — "Component color tokens" — and the token
contract) so their *value* cannot change; the fix is the same shape as
`--correct`/`--incorrect`'s: a new, additive, text-safe sibling token that
is identical to the frozen one on Arena Night and darkened for Arena Day,
used ONLY where the frozen token would otherwise be read as text (never as
a fill, bar, or border, where the frozen value is exactly right).

**Shipped this pass** (`globals.css` + `lib/utils.ts`):
- `--peak-accent-text` (dark `#f5c842` / light `#7a5807`, 6.14:1).
- `--comp-si-text` / `-tp-text` / `-rec-text` / `-po-text` / `-team-text` /
  `-tm-text` (dark = frozen hex / light = darkened, 4.5:1+ each).
- `componentTextColor(key)` in `lib/utils.ts`, the sibling of the existing
  `componentColor(key)` — same key set, text-safe values.

**Fixed with these tokens, everywhere found**: every file this pass or
Task 8/11 touched directly — `page.tsx` (homepage: hero headline accent,
"Daily hub"/"Explore the full methodology" links, bullet arrows),
`ComponentComparison.tsx`, `LeaderboardPreview.tsx`, `HeroVignette.tsx`,
`ModelProofStrip.tsx`, `rankings/page.tsx`, `arena/court/leaderboard/page.tsx`,
plus the full rankings component-color surface once the pattern was
understood: `RankingsTable.tsx` (column headers + every component score
cell — the single most-visible instance, rendered on every row of the main
rankings table), `ScoreExplainModal.tsx`, `ComponentBreakdown.tsx`,
`players/[slug]/page.tsx`, `components/game/component-comparison.tsx`. Also
every occurrence found in the §1 migration groups above (Peak Draft, 82-0,
general pages) while touching those files for the hex work.

**NOT fixed — genuinely out of scope for one more pass, flagged for the
lead rather than silently left**: a grep for `color:\s*"var(--peak-accent)"`
across the whole non-RTT app still returns **30 files** this pass did not
open: `auth/complete`, `auth/auth-code-error`, `signin`, `signup`, `u/[handle]`,
`AuthShell.tsx`, every `daily-grid/*` component (`DailyGridGame.tsx`,
`GridCell.tsx`, `StartGate.tsx`, `CompletionPanel.tsx`, `RecentResults.tsx`,
`DailyGridHistory.tsx`, `HowToPlay.tsx`), `DailyHub.tsx`,
`RankingsProvenance.tsx`, `ranked/RankedScreen.tsx`,
`ranked/RankedRatingCards.tsx`, `arena/ranked/[mode]/leaderboard/page.tsx`,
every `progression/*` component beyond the two already fixed
(`PersonalRecords.tsx`, `StreakCard.tsx`, `XpProgress.tsx`). These are not
clearly owned by anyone under the current `FILE_OWNERSHIP.md`.

**Also fixed**: `components/ui/StatusChip.tsx` (`platform`-owned, a shared
primitive) — its `accent`/`info` tones rendered `--peak-accent`/`--comp-si`
directly as the chip's own text. Any of the 30 files above that render a
chip via this component now get the fix automatically; the 30-file count
was taken BEFORE this fix and has not been re-measured after it, so the
true remaining count is likely somewhat lower.

### Recommendation

`--peak-accent-text` and `--comp-*-text` already exist and are proven
correct (used in a dozen+ files above, plus the shared `StatusChip`) —
finishing this is now a mechanical find/measure/replace pass, not new
design work: for each `color: "var(--peak-accent)"` (or `componentColor(...)`
used as literal text rather than a fill/border), swap to the `-text`
sibling. Recommend the lead assign an owner for this specific, now
well-defined remainder before Arena Day ships broadly; the theme TOGGLE
already works everywhere (verified), the risk is purely these specific
text colors reading as washed-out gold-on-near-white on the files not yet
touched.

## §3. Not real color bugs (confirmed, left alone)

- `app/layout.tsx` — the static `<meta name="theme-color" content="#0a0b0d">`
  fallback, overwritten synchronously by the blocking init script; matches
  `THEME_COLOR.dark` in `lib/theme-script.ts` by construction.
- `components/ui/GuidedTour.tsx` (2× `fill="#fff"` / `fill="#000"`) — SVG
  luminance-mask values (white = visible, black = masked), not a themeable
  UI color; a mask fill is not lightness-of-page, it is mask math.
- `privacy/page.tsx` (`&#123;`/`&#125;` in a code snippet) — HTML entity
  codes for literal curly braces, matched by the audit's `#[0-9a-f]{3,8}`
  regex as a false positive; not a color at all.
- `arena/daily/page.tsx`'s `background: "var(--correct)", color: "#fff"` —
  white text on a solid `--correct` fill. Measured: 2.28:1 on Arena
  Night's `--correct` (a **pre-existing** dark-mode failure, unrelated to
  this pass) and 6.63:1 on Arena Day's darker `--correct` (fine). Not a
  regression this pass introduces, and fixing the pre-existing dark-mode
  case is outside this pass's mandate (light-mode migration) — noted here
  rather than silently carried forward unmentioned.
