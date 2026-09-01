# PEAK3 "Arena Archive" — Reference Board

Phase 1 research synthesis for the visual-polish program. Sources reviewed
2026-08-29. Each entry: what to borrow, why it applies to a specific PEAK3
surface, and what NOT to copy. Closes with the PEAK3-native synthesis that
`docs/design/DESIGN_SYSTEM.md` builds on.

Grounding read before research: `apps/web/src/styles/v2/tokens.css` (PEAK3's
existing V2 token layer — already disciplined: brand color aliased not
forked, three typography roles, a 3-step radius vocabulary, a "one arena
light" rule, motion durations named by what they communicate, and a
documented contrast audit on the court-dim-opacity token). `docs/product/
PEAK3_BLUEPRINT_INDEX.md` and `ARENA_OVERHAUL_PRODUCT_SPEC.md` (product
structure: INDEX / ARENA / LAB, Peak Draft as flagship). Any recommendation
below that would fight what `tokens.css` already does correctly is rejected
in the "what not to copy" column, not silently adopted.

---

## 1. Apple Human Interface Guidelines

**Borrow:** the four-principle frame — Clarity (legible, precise, minimal
adornment), Deference (chrome recedes, content leads), Depth (layers convey
hierarchy, not decoration), Consistency (familiar patterns repeat).

**Why PEAK3:** Deference is the direct fix for the "settings-page" and
"chip-soup" failures documented in `.claude-private/reconstruction_plan_v5.md`
(Daily hub, RTT/82-0 start gates as bordered cards with numbered-paragraph
microcopy). A player's peak-window card, a live bid, a result headline —
these are the content; nav chrome, badges, and borders must defer to them.

**Not to copy:** Apple's literal "Liquid Glass" translucency system. PEAK3's
own anti-pattern list explicitly rejects "make every object glassy" — Depth
here means typographic/spatial layering (z-order via type scale and
elevation tokens already defined: `--v2-elev-plane`/`--v2-elev-modal`), not
blur layers.

## 2. Nielsen Norman Group — progressive disclosure & user control

**Borrow:** default view shows only what matters most; advanced/rare options
move to a secondary surface without removing capability. NN/g's current
guidance caps this at ~2 disclosure levels per interaction.

**Why PEAK3:** Formula Explorer / Methodology (component weight breakdowns,
provenance) and the Rankings filter set are exactly the "expert surfaces"
this pattern protects — show the ranked list and headline score first,
push exact-component math and data provenance one level down (accordion,
already used: `ComponentAccordion` per `reconstruction_plan_v5.md`'s P3
note — reuse the logic, don't rebuild it). Draft/court-builder screens
should show "make your pick" first, not a rules paragraph.

**Not to copy:** NN/g's enterprise-software examples default to very dense,
low-affect UI. PEAK3 Arena is a game first — progressive disclosure governs
*information*, not game-feel; the primary CTA and current decision state
must stay high-affect even while secondary detail is deferred.

## 3. WCAG 2.2

**Borrow:** the three criteria most likely to be silently violated by a
visual pass — 2.4.11/2.4.13 Focus Appearance (focus ring ≥3:1 contrast, not
fully obscured), 2.5.8 Target Size Minimum (24×24 CSS px, or adequate
spacing if smaller), 2.5.7 Dragging Movements (every drag needs a
non-drag alternative).

**Why PEAK3:** Target Size directly affects mobile court slots, bid
controls, and the 82-0 draft grid — small tap targets on a 390px viewport
are exactly where a "compress desktop to mobile" regression shows up.
Dragging Movements matters if the Daily Grid or any lineup-builder ever
uses drag-to-place; it must have a tap/click alternative regardless of how
satisfying the drag gesture is. Focus Appearance matters everywhere in the
game because keyboard players need the current selectable slot to be
unambiguous — color alone is not enough for a "selected" state.

**Not to copy:** nothing — this is a compliance floor, not a style
reference. Do not treat AA as the finish line if a AAA improvement (e.g.
higher focus-ring contrast) is free.

## 4. web.dev — Core Web Vitals

**Borrow:** INP <200ms is 2026's hardest metric and the one a visual pass is
most likely to quietly regress (new client components, more DOM per row,
heavier hover/animation handlers). LCP/CLS fixes are well-trodden
(dimensioned images, preloaded critical fonts, no layout shift on
font-swap) but INP demands breaking up long tasks and yielding during
interaction.

**Why PEAK3:** the Arena result/reveal sequences and live multiplayer
screens (Showdown, TMW) run timer-driven state updates during exactly the
moment INP matters most — a spin reveal or bid tick must not block the next
input. Rankings/Index tables with many rows are the CLS risk if row height
becomes visually variable.

**Not to copy:** chasing a Lighthouse number in isolation. A synthetic 100
score that comes from stripping motion PEAK3's own brief wants (reveal
ceremonies) is the wrong trade — measure field data (real interaction
timing) before cutting a deliberate game-feel moment.

## 5. Next.js production/performance guidance

**Borrow:** `next/font` (already in use — Space Grotesk + Instrument Serif
per `tokens.css`'s comments) for zero-layout-shift font loading;
`next/image` for any real imagery; Server Components by default, Client
Components only where interaction requires it; code-split heavy
visualization behind dynamic import so Rankings/Lab chart libraries don't
tax every route's first load.

**Why PEAK3:** CLAUDE.md already forbids native mobile apps and licensed
player photography, so the image surface is small — but team-color chips,
share-result cards, and any future ESPN asset manifest (mentioned in
`ARENA_OVERHAUL_PRODUCT_SPEC.md` Phase 6F, currently gated off) must go
through `next/image` when it ships, not a raw `<img>`. The existing
`.claude-private/PROGRESS.md` note about `ResultNumber`'s 74kB bundle cost
from a barrel import is a real, already-observed instance of exactly the
bundle discipline this source recommends — Phase 5 (dependency audit) must
check for that pattern again.

**Not to copy:** rewriting working Client Component boundaries to chase
"Server Components everywhere" — PEAK3's game screens are inherently
interactive; forcing them server-first would fight the product, not help
it.

## 6. Linear Method / Linear UI

**Borrow:** opinionated, narrow interaction vocabulary — one way to do a
thing, not a flexible system users must configure. Modular components that
each render one content shape well, rather than one generic card reused
everywhere.

**Why PEAK3:** directly informs Phase 8 (system-first, not "make everything
a Card"). A peak-window card, a ranked-queue row, and a live bid ticker are
different content shapes and should stay different components — Linear's
discipline is "don't force one wrapper," not "add more wrappers."

**Not to copy:** Linear's own visual skin (its specific purple/graphite
palette, its issue-tracker information density) — PEAK3 is not a project
tracker and copying Linear's literal look is exactly the "Linear clone"
failure mode the brief calls out. Borrow the methodology, not the palette.

## 7. Raycast

**Borrow:** density as a deliberate feature for power-user surfaces — tight
row height, controlled line-height, one strong typographic statement per
section rather than competing headings everywhere.

**Why PEAK3:** PEAK3 INDEX (rankings, player search, peak-window
comparisons) is the one surface in this product that should feel like a
research tool, not a game — Raycast's density-with-restraint is the right
model for that specific surface, distinct from Arena's higher-affect
density.

**Not to copy:** Raycast's keyboard-only, command-palette interaction model
as a literal UI metaphor — PEAK3 is browser-first and mouse/touch-primary;
borrow the *density discipline*, not the command-K paradigm.

## 8. Stripe Dashboard

**Borrow:** right-aligned tabular numerals, muted gridlines, "the chart is a
summary and the table is the truth," accent color reserved for primary
actions/focus states only — never a second hue introduced when a neutral
plus a weight change would do.

**Why PEAK3:** this is close to a direct spec for the Rankings table and any
leaderboard: numeric alignment, `--v2-mono-feature: "tnum" 1` (already
defined in tokens.css for instrumentation) applied consistently, and PEAK3
gold reserved the way Stripe reserves its brand purple — for the thing that
is actually actionable or actually live, never decoration.

**Not to copy:** Stripe's B2B/financial tone (its copy voice, its
enterprise information architecture with nested settings). PEAK3 is
consumer and competitive; "trust through restraint" transfers, "fintech
seriousness" does not.

## 9. Vercel Geist

**Borrow:** the engineering discipline of stripping every token that isn't
load-bearing, hairline borders as the default separator instead of shadow
soup, box-shadow reserved for genuinely elevated surfaces (popovers,
modals) — which is precisely what `--v2-elev-plane`/`--v2-elev-modal`
already do.

**Why PEAK3:** validates and gives language to a rule PEAK3's own tokens
already encode (two elevation steps only, LIVE/identity rows stay flat).
Use this to justify *removing* any stray box-shadow that's crept onto a
flat row during past polish passes, rather than adding new elevation
tokens.

**Not to copy:** Geist's near-monochrome black/white palette and aggressive
negative letter-spacing at every display size — PEAK3's identity is
warm-dark with a gold accent and a serif DISPLAY role for cinematic
moments only; adopting Geist's literal palette would erase that identity,
which is the "Vercel clone" failure mode explicitly rejected.

## 10. Observable Plot / D3

**Borrow:** encode a value with more than color alone (position, shape,
label) so colorblind users and grayscale printing still read the chart;
built-in ARIA roles for SVG chart elements; ship a tabular fallback
alongside any custom chart.

**Why PEAK3:** the five PEAK3 components (statistical impact, traditional
production, recognition, postseason, team achievement) already have fixed
semantic colors (`--comp-si` etc.) — any radar/bar breakdown in Methodology
or a player card must still be legible via label + position if a viewer is
colorblind, not rely on the five hues alone to distinguish components.

**Not to copy:** Plot's default tooltip chrome (documented as
uncustomizable, "comic-book" styling) — build PEAK3's own tooltip primitive
on the existing Dialog/Tooltip token layer instead of accepting a library
default that would look foreign next to the rest of the system.

## 11. Radix Primitives / React Aria

**Borrow:** don't hand-roll focus trapping, roving tabindex, or ARIA
dialog semantics — a headless primitive gets keyboard/screen-reader
correctness for free, leaving 100% of visual control to PEAK3's own tokens.

**Why PEAK3:** `apps/web/src/components/ui/Dialog.tsx` already exists and
is referenced across V2 (`v2-preview`, court chooser, etc.) — before adding
a dependency, verify whether it already wraps a correct focus-trap
implementation; if it's hand-rolled and has gaps (this is exactly the kind
of "critical control hidden/unreachable by keyboard" defect Phase 12 must
catch), Radix's Dialog/Popover primitives are the justified addition per
Phase 5's dependency hierarchy — not a wholesale component-library swap.

**Not to copy:** installing Radix's or React Aria's own visual theme/starter
kit, or reaching for it for something PEAK3 already has working (e.g. tabs,
simple disclosure) — Phase 5 requires a named problem the existing stack
can't solve cleanly.

## 12. Anthropic's current frontend-design skill (`plugins/frontend-design`)

**Borrow — verbatim, this is the single most load-bearing source for this
program:** the skill names three clustered "AI-generated design" defaults —
(1) *Warm Minimalism*: cream background, high-contrast serif, terracotta
accent; (2) **Dark Maximalism: near-black background, single bright
acid-green or vermilion accent** — this is the pattern PEAK3's own brief
explicitly warns against and the one PEAK3's dark/lime identity sits
closest to by construction; (3) *Broadsheet Style*: hairline rules, zero
radius, dense newspaper columns. Its core method: ground distinctive
choices in the subject's own world ("materials, instruments, artifacts,
vernacular"), open with a hero that states the subject's thesis, spend
boldness on one signature element and keep everything around it quiet, and
build to an unannounced quality floor (responsive to mobile, visible
keyboard focus, reduced motion respected).

**Why PEAK3:** this is the literal thing the user's brief is asking this
program not to repeat. PEAK3 must not resolve "dark + lime looks
AI-generated" by discarding the identity (that would just swap into Warm
Minimalism or Broadsheet Style, equally generic) — it resolves by grounding
distinctiveness in *basketball's own vernacular*: exact peak-window cards,
box-score-style instrumentation typography, a scouting-report/archive
register, real component-color semantics — none of which are generic
because they only make sense for this specific product. The "one signature
element, quiet surroundings" rule directly justifies tokens.css's own "one
arena light" and "three radius steps" constraints — this program should
extend that discipline, not add competing signature moments on every page.

**Not to copy:** none of the three named cliché aesthetics, obviously — but
also not a fourth, different cliché in their place. The test for every
proposed visual choice in this program: could this have come from any
subject, or only from basketball/PEAK3?

## 13. The Pudding

**Borrow:** visual-essay structure where data has to carry the conclusion
with few words; the four-stage process (story → data → design →
development) that keeps a chart from being decoration bolted onto prose
after the fact.

**Why PEAK3:** Methodology/Lab pages (formula exploration, provenance) are
PEAK3's closest analog to a Pudding essay — the explanation of *why* a
player's score is what it is should be shown through the actual component
breakdown and real numbers, not a paragraph of prose asserting it (this
mirrors CLAUDE.md's own design principle: "results explained through actual
component differences, not prose opinion").

**Not to copy:** The Pudding's scrollytelling/long-form-article format —
PEAK3 is a game and reference tool with repeat, fast visits, not a
one-time narrative read; don't add scroll-triggered narrative sequences to
utilitarian screens like Rankings.

## 14. Databallr / First Down Studio

**Borrow:** Databallr's focus on "impact" analytics presented directly and
plainly (a solo-built, credibility-through-clarity sports-analytics site,
not a media-brand dashboard) and First Down Studio's game-plus-tool hybrid
model (its "Build a 17-0 team" game sits next to real fantasy-football
rankings tools) — validates PEAK3's own INDEX/ARENA duality: a serious
stats reference and a game, sharing one visual system, not two products
stitched together.

**Why PEAK3:** directly supports keeping Rankings/Index visually of a piece
with Arena rather than skinning them as a separate "data product" — same
type system, same accent discipline, different density.

**Not to copy:** neither site is a large-team production UI; their visual
craft is intentionally utilitarian. Don't import that as a ceiling — PEAK3's
existing tokens.css already sets a higher production bar (measured contrast
audits, named motion semantics) than either reference achieves.

## 15. Playwright visual regression testing (2026 guidance)

**Borrow:** mask dynamic content (timestamps, live counters, avatars) before
diffing; disable CSS animations for the capture; per-component diff
thresholds rather than one global tolerance; capture baselines from a
consistent environment (CI/Docker), not ad hoc local runs.

**Why PEAK3:** the repo already has real Playwright infrastructure
(`scripts/ci/e2e-tests.sh`, specs under `apps/web/src/tests/e2e/`) and prior
sessions already hit exactly the flakiness this guidance predicts — the
Daily Grid avatar-count assertion and the Rankings mobile-sheet
sub-pixel-width assertion documented in `.claude-private/PROGRESS.md` are
textbook instances of "didn't mask dynamic/cross-origin content" and
"zero-tolerance pixel assertion" respectively. Phase 3's screenshot
baseline set should mask the same categories (avatars, timers, live
scores) from the start.

**Not to copy:** introducing a new visual-diffing tool or service — the
existing Playwright setup already does this; Phase 5 says solve with what
exists first.

---

## PEAK3-native synthesis

What makes this a PEAK3 system and not a Linear/Stripe/Vercel/Databallr/
First Down Studio clone: every signature object is basketball-shaped and
data-true, not a borrowed layout trick. The exact peak-window card, the
five-component color semantics (never decorative, only ever real data), the
box-score-register instrumentation typography, the "one arena light" rule,
and the INDEX/ARENA/LAB three-surface structure are all things that only
make sense because this product is PEAK3 — that is the actual test applied
to every reference above (§12). The references above are borrowed as
*methodology and discipline* (restraint, tabular numerals, progressive
disclosure, accessible primitives, INP-aware motion), never as *literal
palette or layout*.

### Anti-patterns explicitly rejected for this program

- Dark Maximalism as a default (near-black + single acid accent used
  everywhere) — PEAK3's existing gold accent stays *semantic and sparse*,
  governed by the one-arena-light and five-real-components rules already in
  `tokens.css`, not decorative glow.
- Warm Minimalism or Broadsheet Style as a "fix" for the above — swapping
  one generic aesthetic for another is not progress.
- A fourth typography role, a second radius system, or a second elevation
  scale invented to make one route feel special — `tokens.css` already
  fixes three type roles / three radii / two elevation steps; extend
  aliases, don't fork new ones.
- Glassmorphism, blur-heavy panels, decorative gradients, hover-triggered
  animation on every element, >400ms routine transitions, icon-only
  controls where a label would remove ambiguity, forcing every content
  block into one generic Card component, and card-inside-card nesting.
- Chasing a synthetic performance score by deleting a deliberate,
  brief-mandated game-feel moment (reveal ceremonies, cinematic stage)
  instead of making that moment cheaper to render.
- Any of the five failure patterns already observed in this repo's own
  history (`reconstruction_plan_v5.md`): legacy-chrome routes with zero
  visual branch, numbered-paragraph "settings page" start gates, flat
  hairline lists standing in for hierarchy, gold-bordered card soup, and
  reused legacy chrome inside an otherwise-updated shell.
