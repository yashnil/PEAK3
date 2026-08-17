# PEAK3 Pass 2 — V2 · Broadcast Arena foundation — progress

Branch: `feature/peak3-v2-ui`, HEAD `a245f20` (Pass 1's checkpoint commit) —
**nothing committed by this pass; working tree only.** Pass 1's own record
is superseded by this file; see git log / the Pass 1 final report in
conversation history for that pass's detail if needed.

## Status: complete and green, not committed

Foundation-only, per instruction: token layer, typography roles, LIVE/
CINEMATIC system, arena-light primitive, motion system, 14 shared V2
primitives, court-card grammar, the legacy/V2 switch mechanism, and ONE
real production integration (the homepage). No production game screen was
redesigned — that is Pass 3.

## Access to the Claude Design artifacts

**No direct access.** `DesignSync.list_projects` returned empty (that tool
reaches design-SYSTEM projects only, a different feature from a design
EXPLORATION canvas), and no local copies of `PEAK3 Direction{s,D,E}.dc.html`
exist in the repo. Built entirely from the detailed creative-direction spec
in the Pass 2 prompt, per the user's own mid-pass instruction not to invent
what the mockups look like beyond that spec.

## Architecture (do not re-litigate without a reason)

- **Switch**: `?ui=v2`/`?ui=legacy` → `lib/ui-version-script.ts` (blocking
  pre-paint script, mirrors `theme-script.ts` exactly) sets
  `data-ui-version` on `<html>` before first paint. `lib/ui-version.ts` is
  the `useSyncExternalStore` client half. Default is always `"legacy"` —
  covered by an explicit `SAFETY:` test in `ui-version.test.ts`.
- **Tokens**: `styles/v2/tokens.css`, every `--v2-*` custom property scoped
  under `[data-ui-version="v2"]`. Brand colors/theme surfaces are ALIASES
  of the existing frozen `--peak-accent`/`--comp-*`/`--bg-*`/`--text-*`
  tokens, never redefined — V2 cannot drift from CLAUDE.md's frozen palette
  and gets light/dark theme support for free.
- **Primitives**: `components/v2/Peak V2*.tsx`, one file per primitive,
  Tailwind + inline `style={{ var(--v2-*) }}` — the same authoring
  convention the rest of the codebase already uses, not a new pattern.
- **Real integration**: `app/(main)/page.tsx` wraps its EXISTING, byte-for-
  byte-unchanged legacy JSX in `<UiVersionSwitch legacy={...} v2={<HomePageV2 .../>} />`
  — nothing was extracted to a new file, nothing in the legacy branch moved.
  `HomePageV2` receives the same server-fetched props legacy already
  computes; it fetches nothing itself.
- **`components/ui/Dialog.tsx`** gained two optional, additive props
  (`panelStyle`/`backdropStyle`) so `PeakV2Modal` reuses its real focus
  trap/restore-focus/scroll-lock/Escape/portal machinery instead of a
  second implementation. Every existing caller is unaffected (props
  optional, unused).
- **Gallery**: `/v2-preview`, same posture as `/arena/labs` (not linked,
  `robots: noindex`), renders V2 unconditionally via `PeakV2Shell`'s own
  self-applied `data-ui-version="v2"`.
- **Dev switch**: `UiVersionDevSwitch`, renders `null` unless
  `NEXT_PUBLIC_PEAK3_UI_VERSION_SWITCH=1` — unset in any real deploy, so it
  does not exist in the DOM there at all (narrower than "hidden from nav").

## Verification, last run clean

- `npx tsc --noEmit`: clean
- `npm run lint -- --max-warnings 0`: clean (caught and fixed one real
  unused-import warning before the final run)
- Full frontend unit suite: **2093/2093 passed** (84 files) — 36 new tests
  across `ui-version.test.ts` (15) and `v2-primitives.test.tsx` (21)
- Production build: succeeds (`scripts/ci/frontend-verify.sh`, verified
  with the real captured exit code after an earlier `| tail` pipeline
  masked a lint failure — do not trust a piped script's apparent success
  without checking `$?`/`PIPESTATUS` directly)
- Targeted e2e (`v2-ui-version.spec.ts`, `play-routing.spec.ts`,
  `gameplay.spec.ts`, chromium-core project): **75/75 passed** after one
  real bug found and fixed (see below)
- Manual screenshot review at 1440×900 and 390×844 (legacy home, V2 home,
  gallery, all four) — see the final report for the actual critique;
  screenshots themselves were not committed (scratch artifacts only)
- `git diff --check`: clean

## The one real bug e2e caught that unit tests could not

`HomePageV2` rendered TWO `<h1>` elements (the cinematic hero's headline
AND `PeakV2LiveHeader`'s own title), breaking heading hierarchy — an actual
accessibility defect, not a test-selector issue. Fixed by giving
`PeakV2LiveHeader` an `as` prop defaulting to `"h2"` (a LIVE header is
almost always a section of a screen that already has its own `<h1>`);
`HomePageV2` needed no change since `h2` was already correct there.

## Deliberately out of scope (Pass 3)

- No production game screen (RTT, $20, TMW, 82-0, Three-Man Weave courts,
  Peak Duel) was redesigned. `PeakV2CourtSlot` establishes grammar only.
- The Claude Design mockups themselves were never seen — Pass 3 needs them
  attached/synced first if the user wants the visual direction verified
  against the actual references rather than the prose spec alone.
- No lifetime-distribution or other Pass-1-deferred product features
  touched.

## Known limits

- `HomePageV2` is deliberately NOT a section-for-section legacy clone —
  it's a restrained "one strong data object" hero plus a compact mode list,
  per the brief's own homepage reference. Full content parity was never
  the goal for this pass.
- Both legacy and V2 homepage trees are sent in the RSC payload regardless
  of which renders (a `UiVersionSwitch` client boundary, not a lazy/split
  boundary) — an accepted tradeoff for a single dev-testing integration
  point in a foundation pass, not something to carry forward unexamined
  once V2 is real production surface area in Pass 3.
