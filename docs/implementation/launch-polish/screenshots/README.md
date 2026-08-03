# Paired Dark/Light screenshots — launch-polish deliverable

46 images, 21 routes × 2 themes (`{route}-light.png` / `{route}-dark.png`)
plus 82-0's interactive candidate-list state, captured against the fully
integrated `feature/arena-launch-polish` branch (`36f9651` and later —
carries `visual-platform`'s theme/light-mode/nav work, `game-experience`'s
82-0/RTT/Daily Grid work, and `identity-community`'s handle/contact work,
all composed together). 1440×1000 viewport, `reducedMotion` not forced
except where noted, captured with `apps/web/screenshot-light.mjs` and
`apps/web/screenshot-court.mjs` (uncommitted throwaway tools — re-run any
time with the dev server up on `:3001` and the API on `:8100` to refresh).

Full before/after evidence and measurements for what these screenshots
show are in `../VISUAL_AUDIT.md`.

## The three highest-value pairs for this pass's biggest visual claims

- **`court-afterbegin-{light,dark}.png`** — the 82-0 roster with an active
  team spin in progress. The light pair is the direct evidence for the
  "stark white blocks" fix: compare against `court-practice-light.png`
  (the pre-spin start screen, unaffected) to see the court floor gradient
  now reads as a warm hardwood brown instead of fading to near-black under
  near-white slot cards.
- **`rankings-{light,dark}.png`** — 1000-row 1-Year board. The light pair
  shows the header band + `--divider-strong` row separators and the
  `--bg-surface-data` cool-neutral panel; compare row legibility against
  any pre-fix screenshot in git history (`RankingsTable.tsx`'s blame) to
  see the difference from a single shared `--border-subtle` hairline.
- **`home-{light,dark}.png`** — the hero rank card and "Choose a game"
  gallery, both now carrying the light-mode `--pk-elev-*` shadow tuning
  (`color-mix` against warm ink, not neutral black) instead of the
  originally-unvalidated dark-mode shadow values.

## Full route list

`about`, `accessibility`, `arena`, `arena-labs`, `arena-ranked`, `contact`,
`court-history`, `court-leaderboard`, `court-practice`, `daily`,
`data-sources`, `history`, `home`, `methodology`, `privacy`, `profile`,
`progress`, `rankings`, `run-the-table`, `signin`, `signup`, `terms` — every
top-level nav destination, every footer link, both auth entry points, and
`arena/court/practice/apex_1y` (the 82-0 flagship route, twice: the static
start screen as `court-practice`, and the live spin-in-progress state as
`court-afterbegin`).

`profile`/`progress`/`history` are captured signed-out (this session has no
Supabase project configured), so they show the sign-in prompt / empty
state, not an authenticated view — still valid for confirming the light
palette on those pages' own chrome, borders and typography.
