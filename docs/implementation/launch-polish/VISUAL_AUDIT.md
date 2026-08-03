# Visual audit — theme-switch delay, Arena Day light mode, nav/homepage polish

Owner: `visual-platform`. Phase 1, read-only audit — no product behavior changed.
Worktree: `PEAK3-lp-visual` (branch `wt/lp-visual`, from `feature/arena-launch-polish`
@ `95a41cb`). Preserves the RTT-overhaul theme system, Arena Day palette, and
`-text` sibling-token mechanism in full — see
`docs/implementation/rtt-overhaul/SYNTHESIS_CONTRACT.md` §3, §5.2, §5.3 and
`THEME_MIGRATION_INVENTORY.md`, both read before this audit started.

**Method.** Real browser measurement (Playwright + Chromium) against the app's
own dev server and API on isolated ports (web `:3001`, API `:8100` — never
`:3000`/`:8000`), plus direct reading of `globals.css` / `nav.css` / `home.css`
/ `rankings.css` and the relevant `.tsx` components, plus computed WCAG
contrast ratios for every elevation/border pairing named below. Screenshots
(light + dark, same pages, same viewport) back every Task B finding; paths are
listed in the Appendix — they are Playwright output in the session scratch
directory, not committed.

---

## Task A — theme-switch delay

### A1. Measured number

**Click → first visual change (data-theme attribute + `body` computed
background-color), Chromium, 1440×900, warm dev server, homepage (`/`) and
Rankings (`/rankings`, 1000-row table already loaded):**

| Page | n (real transitions) | mean | median | p95 | min | max |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | 14 | 28.0 ms | 25.9 ms | 62.7 ms | 19.5 ms | 62.7 ms |
| `/rankings` | 12 | 27.8 ms | 24.9 ms | 68.6 ms | 20.2 ms | 68.6 ms |

Method detail: a `requestAnimationFrame` poll installed immediately before
`page.click('[data-testid="theme-toggle"]')` (Playwright's real, trusted
click) watches `document.documentElement.getAttribute('data-theme')` and
`getComputedStyle(document.body).backgroundColor` and resolves on the first
frame either changes, timestamped against `performance.now()` captured at
click time. This measures wall-clock click → visually-changed, not click →
handler-returned, so it would catch a real async delay (a blocking fetch, a
CSS transition, a remount) if one existed. Script:
`apps/web/measure-theme-switch.mjs` in this worktree (not committed — a
throwaway measurement tool, listed here so the number is reproducible).

One-third of clicks in every run "time out" (5 s safety cap, excluded from
the table above) — that is the toggle's own System→Dark→Light→System cycle
landing on `system` while the test browser's OS-reported color scheme is
already `light`, so the third click is a legitimate no-op, not a hang.

**Verdict: the click-to-paint latency on ordinary pages is already ~20–30 ms
median, under the 50 ms target.** The p95 (~60–68 ms) is consistent with dev-
server JS compile/GC jitter, not a structural delay — there is no code path
between click and DOM write that does anything except a synchronous
`localStorage.setItem` + two `setAttribute`/`style` writes (see A2). If the
lead wants a p95 number off a production build, that requires `next build &&
next start`, which this pass did not run (dev-server timing already answers
the code-shape question; a prod re-measure is cheap to add later).

### A1b. Follow-up measurement — gameplay screens (closes the loop on A2's transition hypothesis)

A1's baseline (`/`, `/rankings`) deliberately avoided gameplay screens because
neither page renders the specific classes flagged in A2 as having
unconditional, non-hover-gated color transitions. That leaves the hypothesis
untested — closed here by driving the actual UI into both target states and
re-measuring, on this branch's own dev server (not staging; see the note on
the second explanation below).

**Reaching the states.** `page.emulateMedia({ reducedMotion: 'reduce' })`
collapses both ceremonies to their final state near-instantly, per
`PRODUCT_EXPERIENCE_CONTRACT.md`'s own "reduced motion → zero duration" rule
— confirmed in code, not assumed: 82-0's reveal totals
`REDUCED_MOTION_LOCK_MS + REDUCED_MOTION_REVEAL_MS` = 40 + 40 = 80 ms
(`SpinStage.tsx:192,517-521`, vs. several seconds normally), and RTT's
opening roster reveal is likewise collapsed. Driven via real UI interaction
(click "Begin 82-0 Run" → spin auto-resolves → candidate panel renders;
click "Start a Run" → skip the first-run guided tour → "Reveal your roster"
→ land on "Choose a Front Office Perk," three `.rtt-choice-btn` cards) —
scripting the API directly was considered but the UI path was cheap enough
here that it wasn't needed. Script: `apps/web/measure-gameplay-theme.mjs`
(uncommitted, same as the other measurement tools).

**Two numbers per click, not one**, because on these screens "first pixel
changed" (body background, which has no transition and so is a poor proxy
here) and "this specific element finished animating" are genuinely
different instants:

| Screen | selector | first-change median | first-change p95 | **settle median** | **settle p95** |
| --- | --- | --- | --- | --- | --- |
| 82-0 candidate list (17 open cards on screen) | `.candidate-row-v3` | 42 ms | 50 ms | **96.5 ms** | **108.5 ms** |
| RTT "Choose a Front Office Perk" (3 cards) | `.rtt-choice-btn` | 32–35 ms | 37–80 ms | **67–71 ms** | **72–80 ms** |

"Settle" = the clicked-on element's own computed `border-color` +
`background-color` stop changing for 4 consecutive animation frames
(~64 ms), i.e. the CSS transition (120 ms/140 ms nominal, per A2's
citations) has visibly finished. Two consecutive runs of each screen
produced consistent numbers (both included above where they differ
slightly); raw per-click data is in the script's stdout, not reproduced
here.

**Verdict: the hypothesis is confirmed true, and now bounded.** Gameplay
screens are measurably slower than `/`/`/rankings` — settle time is
roughly 2.5–4× the ~25 ms baseline, and first-change itself is also higher
(32–42 ms vs. ~25 ms, plausibly just more DOM/CSSOM work with 3–17
transition-eligible cards on screen at once). This is real, reproduced
twice, on **this branch's actual dev server** — not a guess, and not
explained by a stale deployment, since this worktree's code is what was
measured. At the same time, keep the number honest: 65–110 ms is a
noticeable-but-small lag, not a multi-second stall — it sits right at the
edge of human perceptibility, which fits "a pause I noticed" better than
"the app hung." **Fix is exactly what A2 already named**: scope
`.candidate-card-v2`/`.candidate-row-v3`/`.round-progress-dot`/
`.spin-wheel-box`/`.rtt-choice-btn`/`.rtt-offer-btn`'s `border-color`/
`background`/`background-color`/`box-shadow` transitions so they don't fire
on a theme swap (e.g. gate them behind `:hover`/`:active`/`[data-state]`
the way most of the rest of the transition inventory already is, rather
than leaving them unconditional) — no palette or token change required.

**On the "stale staging" alternative explanation**: this measurement can't
speak to whether the user's original report was against a stale deployed
build — that requires comparing against staging, out of this audit's reach.
What it does establish is that the effect is **also real on current code**,
independently of any staging staleness: even if the user's report happened
to be filed against a stale build, fixing the six unconditional-transition
rules above is still correct, measured work on `wt/lp-visual`'s own HEAD.

### A2. Candidate-by-candidate

| Candidate | Verdict | Evidence |
| --- | --- | --- |
| Account-preference API call blocking the visual change | **FALSE** | `setThemePreference()` (`apps/web/src/lib/theme.ts:154-166`) does exactly three things: `localStorage.setItem`, `applyResolvedTheme()` (sets `data-theme`, `style.colorScheme`, the `theme-color` meta), `notify()`. No `fetch`/`await` anywhere in the theme module. `AccountMenu.tsx` renders `<ThemeToggle variant="menu" />` (line 171) as a plain sibling in the signed-in panel — it does not wrap it in any save/submit handler. Grepped the whole theme call graph; zero network calls. |
| React rerendering too much of the app | **FALSE** | Only `ThemeToggle.tsx` imports from `@/lib/theme` (`useTheme`) anywhere in `apps/web/src`. The theme store (`theme.ts:89-99`, a plain `Set<Listener>`, not a React context) only notifies subscribers of `useSyncExternalStore` — i.e. only mounted `<ThemeToggle>` instances re-render on a theme change (up to three: desktop nav icon, mobile drawer menu, account-menu panel). The rest of the app's color change is 100% CSS custom-property cascade, invisible to React. |
| Theme provider remounting children | **FALSE, and inapplicable** | There is no `<ThemeProvider>` component — `lib/theme.ts` is a plain external store, not a React context provider, so there is nothing to remount. Grepped every `resolved === "light"` / `useResolvedTheme` conditional in the app (`ThemeToggle.tsx:81` is the only one) — nothing branches a component tree on theme, so nothing keys/remounts on it. |
| Transitions applied to every element or every CSS property | **TRUE for the narrow, named set — confirmed live in A1b, not just by reading the CSS** | No `* { transition: ... }` or unscoped `html`/`body` color transition exists anywhere in `globals.css`/`home.css`/`nav.css`/`rankings.css`/`rtt-polish.css`/`tour.css`/`spinner.css` (grepped explicitly) — this is not a global rule. **But** several *base-state* (not `:hover`-gated) component rules transition color-bearing properties whose *value itself* changes on a theme swap, so the browser genuinely animates them instead of snapping: `.candidate-card-v2` / `.candidate-row-v3` — `transition: transform 120ms ease, border-color 120ms ease, background 120ms ease` (`globals.css:1057`, `:1088`, unconditional selector); `.round-progress-dot` — `transition: background 150ms ease, transform 150ms ease` (`globals.css:1302`); `.spin-wheel-box` — `transition: box-shadow 200ms ease, transform 200ms ease` (`globals.css:1535`); `.rtt-choice-btn, .rtt-offer-btn` — `transition: border-color 140ms ease, background-color 140ms ease` (`globals.css:1760`). These sit on Peak Draft, 82-0, and RTT gameplay surfaces specifically — none of which appear on `/` or `/rankings`, the two pages measured in A1. **A1b closes the loop**: driven live into the 82-0 candidate list and an RTT choice screen, the clicked element's own transition-settle time measured 65–110 ms vs. the ~25 ms baseline elsewhere — a real, reproduced, ~2.5–4× slowdown, not merely plausible from reading the CSS. `.pk-nav-wordmark`'s own unconditional `transition: color var(--pk-dur-fast)` (`nav.css:41`) is dead code by the file's own comment (children set their own `color`, nothing inherits it) — not a contributor. |
| Delayed localStorage/cookie persistence | **FALSE** | `window.localStorage.setItem` (`theme.ts:159`) is a synchronous browser API call, in the same tick as the DOM write that follows it (`applyResolvedTheme`, line 164) and precedes `notify()` (line 165). No batching, no debounce, no cookie round-trip (theme is never sent to the server at all — see A3). |
| Hydration logic | **Not applicable to a live click** | Hydration only matters for the *first* paint (covered by the blocking inline script in `theme-script.ts`, run before React mounts — no FOUC by construction, verified: the script sets `data-theme` synchronously in `<head>`, first child, before any `[data-theme]`-scoped CSS could apply). A click on an already-mounted page never touches hydration. |
| Loading an alternate stylesheet | **FALSE** | One stylesheet (`globals.css`, statically imported at build time), theming is done entirely via the `:root[data-theme="light"]` attribute-selector override block (`globals.css:204-332`). No `<link>` swap, no dynamic `import()` of a theme CSS module anywhere in the codebase. |
| Image or chart rerendering | **FALSE** | No canvas-based charts in the app (`DNARadar.tsx`, `DraftToolbar.tsx` etc. use SVG/CSS, not `<canvas>`). No component reads `data-theme`/`documentElement` imperatively outside `theme.ts`/`theme-script.ts` themselves (grepped `data-theme`, `documentElement`, `dataset.theme`, `getComputedStyle` across `src` — only test files and the theme module itself). All progress bars / component-percentage fills are CSS `width`/`color` driven by data props, not theme, so they have no theme-triggered recompute. |

### A3. Default-theme behavior — current vs. target contract

**Current behavior, all three cases, is identical: resolves to `system`.**

- `theme-script.ts:54` (the blocking init script, runs before first paint):
  `var pref=(stored==="light"||stored==="dark")?stored:"system";` — no stored
  value → `"system"`.
- `theme.ts:56` (`readStoredPreference`, the client-side store's cold-start
  read): `return isThemePreference(raw) ? raw : "system";` — same fallback.
- `theme.ts:137` (`getPreferenceServerSnapshot`): hardcoded `"system"`.

There is no account-tied theme preference anywhere — grepped the full auth
surface (`AccountMenu.tsx`, `auth-context.ts`, every `apps/api` profile
route) for a `theme` field; none exists. `AccountMenu.tsx:171` renders the
exact same `<ThemeToggle variant="menu">` component reading/writing the same
`peak3-theme` localStorage key that a signed-out visitor gets. So:

- **Brand-new user, clean storage**: resolves to OS `prefers-color-scheme`
  (light or dark depending on the OS, not the product).
- **Signed-out user**: identical — theme has never been server-aware.
- **Signed-in user**: identical — signing in does not read, write, or even
  look at a theme preference; `AccountMenu`'s theme row is purely a second
  entry point to the same localStorage-backed toggle already in the header.

**This is a real, direct mismatch against the target contract** ("Dark by
default, NOT System, with explicitly-saved Light or System winning"). Today
a user who has never touched the toggle and whose OS reports a light color
scheme gets Arena Day on their very first visit, with no explicit choice
behind it — the opposite of the intended "Dark first impression, Light is an
opt-in." Fixing this is three synchronized one-line changes (the inline
script's fallback literal, `readStoredPreference`'s fallback, and
`getPreferenceServerSnapshot`'s return value, all swapping `"system"` →
`"dark"` as the *no-stored-value* fallback — `"system"` must obviously stay
selectable and still track the OS live once *chosen*) — flagged for the
lead's synthesis contract, not implemented here (Phase 1 is read-only).

---

## Task B — Light mode (Arena Day) audit

### B1. Why it reads as "too many nearly identical beige surfaces" — the numbers

Computed WCAG contrast ratios (not assumed) between every adjacent
elevation/border tier, both themes, from the actual `globals.css` token
values (`:root` block for dark, `:root[data-theme="light"]` override for
light, lines 24-332):

| Pairing | Arena Night | Arena Day |
| --- | --- | --- |
| page vs. elevated | 1.06 | 1.08 |
| elevated vs. surface | 1.10 | 1.07 |
| page vs. surface | 1.17 | 1.16 |
| surface vs. border-subtle | 1.06 | **1.37** |
| page vs. border-subtle | 1.23 | 1.18 |
| surface vs. border-default | 1.25 | 1.71 |

**The elevation *ratios* are not meaningfully worse in light mode** — page
vs. surface is 1.16-1.17:1 in both, and light mode's borders are actually
*higher*-contrast by the numbers (surface vs. border-subtle: 1.37 light vs.
1.06 dark). Two things explain why it still reads flatter, and neither is
"the borders are too weak by the numbers":

1. **Same-hue compression.** Every light surface (`--bg-page #ece7dc`,
   `--bg-elevated #f4f0e6`, `--bg-surface #fbf8f2`, `--border-subtle
   #ddd6c4`, `--border-default #c9c0a8`) is a warm beige at a different
   lightness — one hue family, so a step reads as "the same material,
   slightly brighter" rather than "a different material." Dark mode's page
   (`#0a0b0d`, near-black, faint blue undertone) to surface (`#1a1d24`,
   cooler slate) crosses more of a hue shift too, but it *also* pairs with
   near-black, where human contrast sensitivity is higher for the same
   absolute delta — the identical-in-principle "beige-to-beige" and
   "near-black-to-slate" steps do not read as equally distinct.
2. **Elevation shadows are unthemed.** `--pk-elev-0` through `-4`
   (`globals.css:376-380`) are defined once, in the unscoped primitives
   `:root` block, and are **never overridden** under
   `:root[data-theme="light"]` — confirmed by grep, zero `--pk-elev`
   occurrences inside the light block. The block's own comment says they
   are "**Tuned for a dark theme**: shadows read as depth, never as a grey
   haze" (`globals.css:372-375`) — an honest admission the light-mode case
   was never separately validated. Black shadows *are* visible on a light
   surface (unlike on near-black, where they mostly disappear), so this
   isn't inert — it's just unvalidated, and given finding B1's already-thin
   border contrast, shadows are carrying more of the elevation signal in
   light mode than they do in dark, precisely where they were never tuned.

Visual confirmation: `home-light.png` vs. `home-dark.png` (same viewport,
same content, same run) — the hero rank card, the four "Choose a game" tiles,
and the "PEAK Index"/"82-0 Leaderboard" cards are only distinguishable from
the page behind them by their 1px border in light mode; in dark mode the same
elements have a visible, immediate "raised card" read.

### B2. 82-0 — why empty court slots read as stark white blocks

Concrete, reproduced live (`court-afterbegin-light.png` vs.
`court-afterbegin-dark.png`, same run, same team spin in progress):

- **Empty slot**: `.roster-board-slot-card-open` (`globals.css:1493-1501`) —
  `background: var(--bg-surface)` (`#fbf8f2`, near-white) plus a
  `radial-gradient(... rgba(245, 200, 66, 0.05), transparent 70%)` — a 5%
  gold wash, already close to imperceptible, more so against a near-white
  base. Border comes from `PeakCardCourt.tsx:301-303`: `` `1px ${slot.filled
  ? "solid" : "dashed"} ${isBench ? "var(--border-emphasis)" :
  "var(--border-default)"}` `` — for a starter slot that is a **1px dashed
  line at `--border-default` (`#c9c0a8`) on `--bg-surface` (`#fbf8f2`) —
  1.71:1 contrast**, well under the WCAG 1.4.11 non-text/UI-component 3:1
  floor. Combined with the page-vs-surface 1.16:1 from B1, an empty slot has
  almost no legible boundary against its surroundings — it does not read as
  "a socket waiting to be filled," it reads as a blank rectangle, exactly
  the complaint.
- **The court panel background itself is not theme-aware at all.** The
  active `.roster-board` rule (`globals.css:1446-1461`, "Phase 8B —
  richer roster-board court surface," which wins the cascade over an
  earlier, now-shadowed `.roster-board` at `globals.css:738-746`) ends its
  background stack with `linear-gradient(180deg, var(--bg-elevated) 0%,
  #17130a 65%, #14110a 100%)` — **two hardcoded near-black hex stops**,
  never overridden for light. `.roster-board-bench-row`
  (`globals.css:934-937`) has the same problem in the other direction:
  `background: linear-gradient(180deg, #14110a 0%, var(--bg-surface)
  100%)` — hardcoded near-black at the *top*, fading into whatever
  `--bg-surface` resolves to. In Arena Day this makes the court panel
  itself fade from warm cream at the top to near-black at the bottom
  (screenshot: `court-afterbegin-light.png` — the roster board visibly
  darkens toward the bench row), so the near-white empty slot cards sit on
  a floor that is *itself* mid-transition from light to black — a genuinely
  disorienting combination, and the direct cause of "stark white block":
  it's not that the slots are too light in isolation, it's that they're
  bright cutouts on a floor that doesn't commit to either theme. This is
  the single highest-value, most concrete fix candidate in this audit:
  three hardcoded hex stops (`globals.css:1461`, `:937`, plus the shadowed
  duplicate at `:745`) need a light-theme-aware replacement (e.g. driven by
  `--bg-page`/`--border-emphasis` the way every other surface in this pass
  was migrated), not a rewrite of the "arena floor" concept itself.
- **Filled slot's inset highlight is also dark-tuned and inert in light
  mode**: `.roster-board-slot-card-filled` (`globals.css:1481-1491`) —
  `box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.03), ...` — a 3% white
  inset line, meant to catch light on a dark card edge; on
  `--bg-surface` (`#fbf8f2`, already near-white) this is invisible by
  construction, so filled cards lose one of their two edge-definition cues
  in light mode (the colored `border-left` team-accent rail still works —
  that one is fine, it is a solid, non-alpha color).

### B3. Rankings — why it reads as a plain spreadsheet on beige

Concrete, reproduced live (`rankings-light.png` with real data, 1000-row
1-Year board):

- **Row separator and header separator are the same weight.**
  `RankingsTable.tsx:77` (`<thead>`'s `<tr>`) and `:126` (every data
  `<tr>`) both use exactly `border-b border-[var(--border-subtle)]` — no
  extra weight, no background tint on the header row. `--border-subtle` in
  light mode is `#ddd6c4`, measured at only **1.37:1 against
  `--bg-surface`** (B1's table) — a hairline that fails the WCAG UI-
  component 3:1 floor outright. In dark mode the same token is even lower
  by the raw ratio (1.06:1) but reads fine there because rows differentiate
  by *other* cues that are weaker in light mode (next point).
- **The "rhythm" dark mode gets from data no longer carries the same
  weight.** Per `SYNTHESIS_CONTRACT.md` §5.2/§5.3, component-color text
  (`RankingsTable.tsx:176`, `:278` via `componentColor`/`componentTextColor`)
  correctly moved off the raw `--comp-*` hex (1.5-2.6:1, illegible) onto the
  darkened `-text` siblings for AA compliance — a necessary, already-shipped
  fix. Side effect: those darkened values are less saturated/vivid than the
  frozen bright hex, so in light mode the component numerals no longer
  "pop" the way they do in dark mode (where `--comp-*` is used directly and
  clears 6-10:1 while staying visually loud). Dark mode's rows read as
  distinct partly *because* the data itself is vivid against near-black;
  light mode fixed the contrast bug correctly but has nothing compensating
  for the lost visual rhythm — no alternating row tint, no stronger
  separator, no header treatment.
- **Header hierarchy is text-only.** `HEADER_CLASS`
  (`RankingsTable.tsx:36-37`): `text-[11px] font-semibold uppercase
  tracking-wider text-[var(--text-muted)]` — legible (light `--text-muted`
  `#655f4c` was specifically re-measured to clear 5.17:1+, see
  `globals.css:212-218`'s comment) but structurally identical to a data row
  except for the muted color and caps — no background band, no distinct
  bottom-border weight. The header does not visually anchor the table the
  way a filled or heavier-bordered header row conventionally would.

### B4. Other surfaces — briefer pass

- **Homepage hero** (`home-light.png`): the flagship rank card
  (`HeroVignette`) sits on `.home-hero`'s background at near-identical
  lightness to the card itself — the card's `--bg-surface`/`--bg-elevated`
  fill and the hero section's `--bg-page` backdrop are the same B1 problem
  at the product's single most important piece of visual real estate. The
  component-score bars inside the card are fine (bars/fills, not text — the
  frozen-token contract is respected).
- **Nav active-route pill**: `nav.tsx:109-114` — active link gets
  `bg-[var(--bg-surface)]`, same weak page-vs-surface delta (1.16:1) as
  everywhere else in B1; in `rankings-light.png` the active "Rankings" tab
  is legible only via its underline accent and the text going from
  `--text-secondary` to `--text-primary`, not via the background pill,
  which is nearly invisible.
- **Dialogs are in comparatively good shape.** `Dialog.tsx:149,168-170` —
  the modal panel correctly tokenizes to `--pk-surface-decision` (→
  `--bg-elevated`, theme-aware) and `--pk-surface-decision-border` (→
  `--border-emphasis`, theme-aware). `--border-emphasis` is the
  *strongest* border tier in both themes, and — unlike `--border-subtle`/
  `--border-default` in B1 — is actually higher-contrast in light mode
  than dark (elevated-vs-border-emphasis: 2.39:1 light vs. 1.88:1 dark),
  so dialogs do not inherit B1's flatness problem. The backdrop scrim
  (`--pk-surface-overlay`, `globals.css:416`) is a fixed `rgba(6, 7, 9,
  0.72)` in **both** themes, defined once in the unscoped primitives block
  — this reads as intentional (a near-black dimming scrim behind a modal is
  a conventional, theme-independent pattern that makes the modal pop by
  darkening everything behind it, and it is paired with a properly
  theme-aware panel), not a bug worth fixing.
- **Daily Grid / forms / loading-error states**: not independently broken
  by anything new — they inherit the same B1 token set, so they inherit the
  same "flatter than dark mode" read, but nothing component-specific beyond
  B1 was found (the daily-grid and auth-form hardcoded-hex sweep was
  already completed per `THEME_MIGRATION_INVENTORY.md` §1-2, and spot-
  checking `signin`/`about` screenshots shows no new contrast failures —
  the rankings error state in `rankings-light.png`, "Could not load
  rankings," is legible: `--incorrect` was specifically re-darkened for
  light, `globals.css:245-247`).

### B5. Proposed palette principles (not implemented — for the lead's synthesis)

Do NOT darken every border uniformly and do NOT invert Dark. Instead:

1. **Give elevation a second cue besides lightness-step.** Since same-hue
   lightness steps compress perceptually (B1), either widen the actual hex
   delta between `--bg-page`/`--bg-elevated`/`--bg-surface` beyond today's
   ~8-15 RGB units per step, or lean harder on shadow (see next point) so
   elevation isn't carried by hue alone.
2. **Tune `--pk-elev-*` per theme.** A black shadow that "reads as depth,
   never a grey haze" on near-black needs a different alpha/blur recipe on
   a warm-cream page — likely lower blur radius, slightly warmer/brown-
   tinted shadow color rather than pure black, and probably *stronger*
   alpha than the dark-mode values, since light mode currently has nothing
   else doing this job.
3. **Strengthen — don't just darken — dividers in data-dense regions.**
   Rankings-style tables need a separator that clears 3:1 (today's
   `--border-subtle` at 1.37:1 does not), or a structural alternative
   (zebra-striping between `--bg-page`/`--bg-surface`, or a slightly
   heavier header-row treatment) rather than a flat token bump that would
   also darken every other subtle-border use case in the app.
4. **Gold stays an accent, not a border default.** Nothing here should
   route more borders through `--peak-accent`/`--peak-accent-dim` — the
   existing "text-safe sibling" discipline (SYNTHESIS_CONTRACT §5.3) is
   correct and should be preserved exactly, this section is only about
   neutral surface/border tokens.
5. **A cool neutral for data-heavy regions is worth prototyping** (Rankings,
   82-0 court, Arena Leaderboards) — a slightly desaturated cool-grey
   surface variant, distinct from the warm paper backdrop used everywhere
   else, the way a printed stat sheet differs from its cover page, without
   introducing a second hue family into the general UI chrome.
6. **Fix the two hardcoded-hex court gradients (B2) regardless of the
   broader palette decision** — that is a correctness bug (unthemed
   literals), not a design-taste question, and is independent of whatever
   palette direction the lead picks.

---

## Task C — Nav + homepage polish audit

- **Active-route treatment**: functionally correct (`aria-current="page"`,
  frozen test-asserted class string per `nav.tsx:17-18`'s own comment) but
  visually weak in light mode specifically — see B4. In dark mode the same
  pill is clearly legible.
- **"Play" as the primary product area**: `PlayMenu` is a disclosure button
  positioned first in the desktop `<nav>` (`nav.tsx:100`, before the plain
  top-level links), and the homepage's "Choose a game" section leads with a
  visually distinct "FLAGSHIP" tile before "DAILY · QUICK PLAY" / "FULL
  SEASON" / "COMPETITIVE" groups (`home-light.png`/`home-dark.png`) — the
  hierarchy reads correctly: Run the Table is unambiguously the flagship,
  Play is unambiguously the entry point for everything else. No change
  needed here.
- **Theme control affordance**: a single icon-only button
  (`ThemeToggle.tsx:86-102`), unlabeled except via `aria-label`/`title` —
  sits at the end of the desktop nav next to the account control
  (`nav.tsx:122-125`). It is visually the same size/weight as the account
  avatar button next to it (both `--pk-tap-min` 44px, both bordered), so it
  does not read as "bolted on" structurally, but it is the *only* nav-bar
  control with no text label at all (every other nav item is a word) —
  worth a second look for discoverability, though not for a first-time
  visitor who has never customized anything (System is invisible-by-
  design until touched).
- **Account-menu affordance**: could not be visually verified live in this
  pass — `AccountMenu` returns `null` whenever `supabaseEnabled` is false
  (`AccountMenu.tsx:77`), and this worktree's sandboxed dev environment has
  no Supabase project configured, so neither the signed-out "Sign in" link
  nor the signed-in disclosure panel rendered in any captured screenshot.
  Code review only: the component itself (read in full,
  `AccountMenu.tsx:1-193`) looks correct — proper `aria-expanded`/
  `aria-controls`, Escape-to-close, outside-pointerdown-to-close, focus
  restoration on close, no `role="menu"` misuse. If the lead wants this
  surface screenshotted, it needs `NEXT_PUBLIC_PEAK3_E2E_AUTH=1` (per
  CLAUDE.md's `dev:e2e` script) wired into a follow-up capture run.
- **Compact height / mobile nav**: not deeply re-audited this pass beyond
  reading `MobileNavDrawer.tsx` (420 lines, built on the shared `Dialog`,
  per `nav.tsx:10-12`'s comment already a Phase-prior rewrite from an
  in-flow dropdown to a proper portalled/focus-trapped drawer) — no new
  issue found, out of measured-evidence budget for this pass to go deeper.
- **Homepage spacing/typography, hero animation, gallery scannability,
  hero→catalog transition**: no structural issue found distinct from the
  light-mode contrast problem in B4 — the section rhythm (`Choose a game` →
  `DAILY · QUICK PLAY` → `FULL SEASON` → `COMPETITIVE` → model-stats strip →
  `How a run works` → component breakdown → `Leaderboards` → guest CTA →
  footer) reads as a coherent, well-paced single scroll in both themes
  (`home-light.png`/`home-dark.png`); the only thing actually wrong with it
  is the card-vs-background contrast covered in B1/B4, not pacing,
  copy, or layout. Per the brief: no additional explanatory copy, no fake
  usage counts, no testimonials/social proof are proposed here, and none
  are needed — the "model behind every game" stats strip (`Active model`,
  `Data through`, `Leaderboard rows`, `Players evaluated`, `Dataset built`)
  already reads as live, real numbers rather than marketing filler.

---

## Appendix

- Measurement script: `apps/web/measure-theme-switch.mjs` (this worktree,
  uncommitted — throwaway tool, safe to delete or keep).
- Screenshot scripts: `apps/web/screenshot-light.mjs`,
  `apps/web/screenshot-court.mjs` (same — uncommitted).
- Screenshots (session scratch dir, not in the repo):
  `light-audit/{home,rankings,daily,arena,signin,about,court-practice,
  court-leaderboard}-{light,dark}.png`,
  `light-audit/court-afterbegin-{light,dark}.png`.
- Dev server: `PORT=3001 NEXT_PUBLIC_API_URL=http://localhost:8100 npm run
  dev` (3001 chosen because the API's CORS allowlist already includes it —
  `apps/api/app/main.py:118-120` — 3100 is not allowlisted and silently
  fails every fetch, which is why the first capture pass showed "Could not
  load rankings" before this was caught and fixed).
- API: `uvicorn app.main:app --port 8100`, pointed at a copy of the
  already-built `data/web/*.json` dataset (copied read-only from
  `PEAK3-agent-platform`'s worktree, this worktree never had one built —
  `make build-dataset` was not re-run, no model/leaderboard files were
  touched).
- Contrast ratios in B1/B2/B3 computed with the standard WCAG relative-
  luminance formula against the literal hex values in `globals.css`, not
  eyeballed.
