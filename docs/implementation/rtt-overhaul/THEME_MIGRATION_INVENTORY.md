# Theme token migration — inventory (P3-G)

Companion to `PERFORMANCE.md`'s original 217-hex-across-54-files finding.
Counts below are **standalone hardcoded hex** only — `var(--token, #hexfallback)`
is a safe fallback pattern (the token still drives the rendered color; the
hex only covers the CSS-custom-property-unsupported case) and is excluded
from these counts, which is why the numbers here are lower than the original
audit's raw grep.

## What this pass fixed

Files in `platform`'s ownership (globals.css, homepage, header/account-menu,
Arena Leaderboards frontend, shared `ui/**`):

| File | Fixed |
| --- | --- |
| `app/(main)/page.tsx` | `color: "#000"` → `var(--text-inverse)` (gold-fill button text) |
| `app/(main)/rankings/page.tsx` | `color: "#000"` → `var(--text-inverse)`; `color: "#ef4444"` → `var(--incorrect)` (exact same hex as the token — a literal duplicate, not a different color choice) |
| `app/(main)/arena/court/leaderboard/page.tsx` | `color: "#000"` → `var(--text-inverse)` |

Plus new light-theme tokens (`:root[data-theme="light"]` in `globals.css`),
two new motion durations (`--pk-dur-reveal`, `--pk-dur-count`, mirrored in
`lib/motion.ts`), and new shared primitives (`ThemeToggle`, `ErrorState`) —
see the commit for the full theme-system change.

Two occurrences deliberately left alone as **not real color bugs**:
- `app/layout.tsx` — the static `<meta name="theme-color" content="#0a0b0d">`
  fallback, overwritten synchronously by the blocking init script; matches
  `THEME_COLOR.dark` in `lib/theme-script.ts` by construction.
- `components/ui/GuidedTour.tsx` (2× `fill="#fff"` / `fill="#000"`) — SVG
  luminance-mask values (white = visible, black = masked), not a themeable
  UI color; a mask fill is not lightness-of-page, it is mask math.

## Remainder — real standalone hex outside this pass's ownership

**155 standalone hex values across 49 files.** None of the files below are
owned by `platform` under `FILE_OWNERSHIP.md`; several are not clearly owned
by *any* of the four teammates. Recorded here rather than silently left out,
per SYNTHESIS_CONTRACT.md §3's "documented inventory of any remainder"
requirement.

### Owned by `rtt-experience` (exclusive — `platform` does not touch)

18 occurrences / 8 files: `RunMap.tsx` (8), `RunStartGate.tsx` (3),
`TradeDesk.tsx` (2), `RunResult.tsx` (1), `RevealReel.tsx` (1),
`MobileTray.tsx` (1), `BossPreview.tsx` (1), `BattleReveal.tsx` (1).

### Unowned by the current `FILE_OWNERSHIP.md` — needs an explicit owner

**Peak Draft** (the older, deferred card-draft mode — not RTT, not
homepage, not the leaderboard surfaces this pass covers): 50 occurrences /
11 files — `DraftReceipt.tsx` (15, the single worst offender in the
original audit), `DraftCard.tsx` (7), `RoleSelector.tsx` (5),
`LineupBoard.tsx` (5), `DraftScreen.tsx` (5), `DNABar.tsx` (4),
`ChallengeComparison.tsx` (4), `DraftToolbar.tsx` (2), `ShareChallenge.tsx` (1),
`PracticeDraftLoader.tsx` (1), `DNARadar.tsx` (1).

**82-0 / CourtBuilder gameplay** (the spin/build/save flow itself, distinct
from the Arena Leaderboards *listing* page this pass did cover):
24 occurrences / 11 files — `SeasonResultStub.tsx` (4, of 11 total —
7 are safe fallbacks), `SaveRunPanel.tsx` (4 of 10), `PeakCardCourt.tsx`
(3 of 8), `PeakSeasonStartGate.tsx` (3 of 7), `LeaderboardSubmitPanel.tsx`
(3 of 6), `CourtBuilder.tsx` (2 of 4), `PeakPicksRecap.tsx` (1 of 4),
`LineupInsightPanel.tsx` (1 of 4), `PlayAgainPanel.tsx` (1 of 3),
`ShareRunPanel.tsx` (1 of 2), `EligiblePlayerSearch.tsx` (1 of 2).

**Progression** (achievement UI, not itself RTT/homepage/leaderboard):
8 occurrences / 2 files — `AchievementUnlock.tsx` (4), `AchievementCard.tsx` (4).

**Auth forms** (distinct from `AccountMenu.tsx`, which *is* in scope and was
audited clean): 6 occurrences / 3 files — `SignInPanel.tsx` (2),
`PasswordForm.tsx` (2), `MagicLinkForm.tsx` (2).

**General app pages** outside the homepage/leaderboard surfaces this pass
covers: 46 occurrences / 12 files — `arena/labs/page.tsx` (9),
`arena/daily/[mode]/page.tsx` (7), `arena/ranked/page.tsx` (6),
`arena/court/history/page.tsx` (4 of 9), `c/[token]/page.tsx` (4),
`privacy/page.tsx` (4), `profile/page.tsx` (3), `history/page.tsx` (3),
`progress/page.tsx` (2), `arena/page.tsx` (2), `arena/daily/page.tsx`
(1 of 4), `arena/court/results/[id]/page.tsx` (1 of 2).

### Recommendation

None of the four unowned groups above are RTT, homepage, or the Arena
Leaderboards *listing* page — the three surfaces this pass's mandate
covered. Migrating them is genuine, further work (each needs its own
audit for which hex is a real color decision vs. a safe token-equivalent
literal, the same way `"#ef4444"` above turned out to be a literal
duplicate of `--incorrect` rather than an intentional different red).
Recommend the lead assign an owner for a follow-up pass — Peak Draft and
82-0 gameplay are the two largest blocks and the most visible if a light-
theme toggle ships without them: those two modes will render correctly
under Arena Night (nothing changed there) but will keep their *dark-theme*
hardcoded colors under Arena Day, i.e. dark literals on a light background,
until migrated.
