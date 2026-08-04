# Paired Dark / Light screenshots — launch-polish deliverable

46 images: 21 routes × 2 themes (`{route}-{light,dark}.png`) plus 82-0's live
candidate-list state. Captured at 1440×1000 against the **fully integrated**
branch (`36f9651` and later), so every agent's work is composed — including
`identity-community`'s real contact form and handle-onboarding UI rather than
the mid-session placeholders an earlier capture caught.

Full before/after measurements for what these show are in `../VISUAL_AUDIT.md`.

## The three pairs carrying this pass's biggest visual claims

- **`court-afterbegin-{light,dark}`** — the 82-0 roster mid-spin, and the direct
  evidence for the "stark white blocks" fix. `.roster-board` hardcoded
  `#17130a`/`#14110a` gradient stops that were never made theme-aware, so the
  court floor **faded to black in light mode** while empty slot cards stayed
  near-white. That combination — not the slot styling — was the cause. Compare
  against `court-practice-light` (the pre-spin screen) to see the floor now read
  as warm hardwood.
- **`rankings-{light,dark}`** — header band plus `--divider-strong` separators
  (3.07–3.57:1, was a single shared `--border-subtle` hairline at **1.37:1**,
  under the 3:1 UI floor) and the hue-differentiated `--bg-surface-data` panel
  rather than another lightness step.
- **`home-{light,dark}`** — hero card and gallery carrying light-tuned
  `--pk-elev-*` (`color-mix` against warm ink, not the originally-unvalidated
  dark-mode shadow values). Also the surface where the active-route underline
  measured **1.29:1** using frozen `--peak-accent` directly — functionally
  invisible — before moving to `--peak-accent-text`.

## Full route list

`about` · `accessibility` · `arena` · `arena-labs` · `arena-ranked` · `contact` ·
`court-history` · `court-leaderboard` · `court-practice` · `daily` ·
`data-sources` · `history` · `home` · `methodology` · `privacy` · `profile` ·
`progress` · `rankings` · `run-the-table` · `signin` · `signup` · `terms` —
every top-level nav destination, every footer link, both auth entry points, and
the 82-0 flagship route twice (static start as `court-practice`, live spin as
`court-afterbegin`).

**Caveat:** `profile` / `progress` / `history` are captured **signed-out**, since
this session had no Supabase project configured. They show the sign-in prompt or
empty state, not an authenticated view — still valid for the light palette on
those pages' own chrome, borders and typography, but not evidence about
authenticated layouts.

## These illustrate. The measurements are the evidence.

Light mode was verified as a genuinely different palette rather than a recolour
by measurement, independently, by an agent that did not build it:

- Elevation ordering holds **independently in each theme**, and light's tier
  deltas are **larger** (0.068 vs 0.003) — tiers are more distinguishable in
  light, not less.
- Naive-inversion ΔE (Lab, CIE76) measures **3.0–7.7** across all three surface
  tokens, well clear of the ΔE < 2 threshold that would suggest an inversion.
- All seven frozen tokens (`--peak-accent` + six `--comp-*`) are
  **byte-identical** across themes.
- Zero `filter: invert(` anywhere in `globals.css`.
- A second `:root[data-theme="light"]` block redefines `--pk-elev-1..4` with a
  different base colour and alpha/blur recipe — structural deployment, not a
  token swap.

A screenshot can make an inverted palette look intentional. These numbers are
what rule that out.
