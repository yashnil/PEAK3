# PEAK3 Design Constitution ("Arena Archive")

This documents the system that already exists across
`apps/web/src/styles/globals.css` (base/legacy tokens, still the single
source of truth for color/spacing/motion) and
`apps/web/src/styles/v2/tokens.css` (the V2 alias layer every current route
renders under). **No section below invents a parallel system.** Where a gap
is real, it says so explicitly and proposes the smallest addition — never a
fork of an existing token family. This is the reference the rest of the
Arena Archive program edits against; if a batch needs a new token, it is
added here first, in the appropriate base file, and used everywhere rather
than redeclared locally.

## COLOR

**Already exists, already correct:**
- Background hierarchy: `--bg-page` → `--bg-elevated` → `--bg-surface` →
  `--bg-surface-hover`, four steps, each with a light-theme redefinition
  under `[data-theme="light"]`. `--bg-surface-data` exists as a distinct
  alias for data-table surfaces.
- Text hierarchy: `--text-primary` / `--text-secondary` / `--text-muted` /
  `--text-inverse`, every value contrast-audited in comments against the
  surfaces it's actually used on (e.g. the documented `--v2-court-dim-opacity:
  0.88` fix in `tokens.css` — chosen because it's the exact value where
  `--text-muted`, the *weaker* of two children dimmed by the same opacity,
  clears 4.5:1 AA).
- Borders/dividers: `--border-subtle` / `--border-default` / `--border-emphasis`,
  plus `--divider-strong`.
- Positive/negative/warning: `--correct` / `--incorrect` / `--warning`, each
  with a `-dim` and `-bg` (translucent wash) variant.
- Data-viz / component colors: the six frozen tokens from CLAUDE.md
  (`--comp-si`, `--comp-tp`, `--comp-rec`, `--comp-po`, `--comp-team`,
  `--comp-tm`), each with a `-text` variant independently re-tuned per theme
  for contrast (see the light-theme block's comment trail rebasing
  `--comp-*-text` off `--accent-*` rather than reusing the dark values).
- Selection/focus: `--focus-ring`, theme-specific, `--peak-accent-bg` as the
  one legitimate translucent accent wash for a selected fill (never a
  border or foreground — enforced by comment in `tokens.css`).
- Ranked/role identity: `--role-lead-creator` / `--role-guard-wing` /
  `--role-wing-forward` / `--role-forward-big` / `--role-anchor` (five
  roster-role hues, distinct from the six component colors — don't conflate
  them).

**Real gap:** there is no explicit token for the **1Y / 2Y / 3Y / 5Y peak-window
identity** CLAUDE.md's design principles ask for — window duration currently
has no dedicated color/marker distinct from the six component colors. Any
surface that needs to distinguish window length today improvises with
typography alone. **This program's addition:** a small `--window-1y` /
`--window-2y` / `--window-3y` / `--window-5y` set of *label-only* accents
(never a background wash, to avoid a seventh competing color on data-dense
surfaces), added to `globals.css` alongside the existing role tokens, reusing
existing neutral-adjacent hues rather than inventing new ones.

**Accessible contrast:** already a first-class concern in this codebase —
every color decision above ships with a measured ratio in a code comment.
Any new color this program adds must do the same (measure against every
surface it will realistically sit on, not just the primary one, per the
`--v2-court-dim-opacity` lesson).

## TYPOGRAPHY

**Already exists:** exactly three roles, deliberately capped at three
(`tokens.css` docstring: "does not invent a fourth typography role"):
1. **DISPLAY/MOMENT** — `--v2-font-display` (Instrument Serif, Georgia
   fallback) — cinematic-only: boss names, result headlines, homepage
   statement. Never a routine control.
2. **UI/PLAYER IDENTITY** — `--v2-font-ui` (Space Grotesk, Inter fallback,
   metrics-compatible per `app/layout.tsx`) — everything else: names, nav,
   labels, buttons, body copy.
3. **INSTRUMENTATION** — `--v2-font-mono` (system mono stack) — clocks,
   scores, credits, bids, ratings; always with `--v2-mono-feature: "tnum" 1,
   "lnum" 1` (tabular numerals) and `--v2-mono-track: 0.01em`.

Display scale is fluid (`clamp()`) at three sizes (hero/moment/line) with
`-0.01em` tracking and `1.05` leading — already tuned for a serif at this
size to stay readable, not loose.

**Gap:** no single documented **max readable line length** for body/editorial
copy (Methodology explanations, About page). **This program's rule:** cap
prose blocks at `65ch` via a shared `.v2-prose` utility rather than an
ad hoc `max-width` per component — check for existing per-component
maxwidths before adding this, and consolidate into the one utility if found.

**Do not add a fourth font.** Instrument Serif + Space Grotesk + Inter +
system mono already covers editorial/interface/data — a novelty font is
exactly the anti-pattern this program rejects.

## SPACING

**Already exists:** `--pk-space-0` through `--pk-space-16` (0/2/4/8/12/16/20/
24/32/40/48/64px), aliased 1:1 into `--v2-space-*` rather than forked.
Content widths are role-based, not a single container: `--v2-width-shell`
(1440px outer ceiling — matches the verification viewport exactly),
`--v2-width-live` (1180px, LIVE working width), `--v2-width-live-wide`
(1280px, audited against real laptop viewports, established but not yet
adopted anywhere — available for RTT's three-region layout), `--v2-width-cinematic`
(760px, editorial measure). `--v2-gutter: clamp(16px, 4vw, 48px)` scales
gutter with viewport rather than stepping at breakpoints.

**No separate "compact/data-dense variant" scale exists yet.** Rankings and
any future dense table use the same `--pk-space-*` scale as everything else
at a smaller step (e.g. `--pk-space-2`/`--pk-space-3` for row padding) rather
than a documented "dense" mode. **This program's approach:** don't invent a
parallel dense scale — document which existing steps constitute "dense" usage
(row padding ≤ `--pk-space-3`, section gaps ≥ `--pk-space-8`) so it's applied
consistently instead of per-component guesswork.

## SHAPE

**Already exists, and already disciplined:** exactly three radii
(`tokens.css` comment: "never every surface independently rounds its own
corners"): `--v2-radius-instrument` (3px — timers, scores, bid chips: near-
square, hard), `--v2-radius-control` (8px — buttons/inputs/selectable rows),
`--v2-radius-modal` (22px — genuine modal/cinematic containers only). Legacy
has its own `--pk-r-sm/md/lg/xl/pill` scale, still used by non-V2-shelled
surfaces (the confirmed-legacy routes in `ROUTE_BEHAVIOR_MATRIX.md`).
Elevation is capped at two steps in V2 (`--v2-elev-plane`, `--v2-elev-modal`)
specifically because "LIVE instrumentation and player-identity rows stay
flat — typography + alignment carry hierarchy" (anti-card-nesting rule,
already enforced by convention).

**Enforcement, not invention, is the gap.** The RTT/82-0 start gates
(confirmed via baseline screenshots to currently read as a settings page —
bordered cards with numbered-paragraph microcopy, a bordered two-box
difficulty toggle) are the clearest current violation of the flat/
non-card-nesting rule already declared in `tokens.css`. Fixing them is a
matter of applying the existing radius/elevation discipline, not adding new
shape tokens.

## ICONOGRAPHY

`lucide-react` (`^0.525.0`) is the only icon library in the dependency tree —
keep it that way; do not add a second icon set. No documented standard
size/stroke-width exists yet across call sites. **This program's addition:**
standardize on two sizes only (16px inline-with-text, 20px standalone
control) and `strokeWidth={1.75}` (lucide's near-default, already close to
what most call sites use) as the documented default, matching CLAUDE.md's
"no arbitrary emoji as application UI" rule (already followed — no emoji
found in component source during this audit).

## MOTION

**Already exists and is unusually well specified.** Two duration families:
legacy `--pk-dur-instant/fast/base/slow/slower` (0/120/200/320/480ms) plus
named reveal/count beats, and V2's `--v2-dur-ack/control/transition/reveal/
cinematic` (100/160/210/380/2800ms) — named by *what they communicate*
(acknowledgement, control state, transition, reveal, one full cinematic
sequence), exactly matching the brief's REVEAL/SELECTION/COMMITMENT/
RESOLUTION framing. Easing is four curves (`--pk-ease-standard/out/in/
emphasized`), aliased into V2 rather than re-authored so a V2 surface next
to a legacy one never feels like a different physics engine.

**`prefers-reduced-motion` is already handled at two levels**, and this is a
real, working distinction worth preserving exactly as-is: a global blanket
rule in `globals.css` zeroes `animation-duration`/`transition-duration` for
every element (plus `scroll-behavior`), and a second, narrower rule scoped
to `.pk-*` primitives handles CSS `animation-delay` (which the blanket rule
cannot reach) without desynchronizing cinematic sequences that pair a CSS
delay with a JS timer. Any new animation this program adds must fall under
one of these two mechanisms, not a third one-off media query.

**The "arena light"** (`--v2-light-*`) is the one ambient decorative effect
in the system, and it's already tightly scoped: one light per surface by
default (a documented "paired-ambient-wash exception" exists only for Peak
Duel, at lower opacity specifically because two sources read as more light
overall), low opacity (0.16 / 0.10 paired), tied to game focus via `x`/`y`
props, never purely decorative. **Do not add a second ambient effect
anywhere else** — this is the program's one "signature moment" budget for
glow, already spent correctly.

## RESPONSIVE

**Gap, real:** there is no documented breakpoint scale. Current usage is ad
hoc `max-width: 420px` / `480px` / `640px` and `min-width: 1024px` queries
scattered through `globals.css`, and the verification viewports (per CI/e2e
config) are 390 / 768 / 1440. **This program's rule, not a new token
system:** treat 390 (mobile, matches `--v2-width-shell`'s ceiling logic
downward), 768 (tablet), and 1024 (the existing most-used min-width, treat as
the desktop-layout threshold), 1440 (`--v2-width-shell`) as the four
reference points for any new responsive work, and prefer `clamp()`/container
queries (as `--v2-gutter` and the display scale already do) over adding more
discrete breakpoints. No hover-only affordance may gate a core action —
verify this explicitly for any control this program touches, per the
project's own `--pk-tap-min: 44px` token (already defined, confirm it's
actually applied everywhere touch targets exist).

## DATA UI

**Already exists:** `--v2-mono-feature: "tnum" 1, "lnum" 1` for tabular
numerals on anything that ticks/updates; `--bg-surface-data` as a distinct
table-surface alias; `ErrorState`, `EmptyState`, `Skeleton`/`SkeletonText`,
`ScorePill`, `StatusChip` all exist as shared components in
`apps/web/src/components/ui/` — reuse them, don't rebuild per-route
loading/error/empty treatments. Chart color rules already follow "color plus
another encoding": the six component colors are strictly semantic per
CLAUDE.md (never decorative), and Rankings/Methodology's existing
table/chart logic is explicitly out of scope for this program to touch
(CLAUDE.md: "do NOT touch the table/chart/accordion logic").

**Real gap, confirmed by baseline screenshots:** Ranked-mode and Daily Grid
are not "legacy chrome" (the token system is clean) — they are
under-composed at 1440px, reading as a single centered CTA in mostly-empty
space. This is a density/composition gap the token layer cannot fix by
itself; it needs actual layout work in the route-family batches, not a
token change.

## GAME STATE

**Already exists:** `ScorePill` and `StatusChip` are the shared primitives
for score/status signaling; selection uses `--peak-accent-bg` as a wash
(never color-alone — verify each call site actually pairs it with a second
cue: border, icon, or text, per WCAG 2.2's color-is-not-the-only-indicator
requirement) plus `--v2-color-accent` for active borders. Disabled states
should reduce opacity **and** remove interactivity (`pointer-events`/
`aria-disabled`) — confirmed as existing practice in `.pk-lift`'s documented
`:disabled` handling (a past defect: `.pk-lift` claiming a hover effect it
didn't actually suppress when disabled — already fixed per prior session
notes, worth spot-checking it stayed fixed).

**Highest-value fix, confirmed:** the RTT and 82-0 start-gate screens
currently communicate "next step" via numbered paragraphs and bordered
cards rather than the game-state grammar (selection/active/CTA) the rest of
the system already uses elsewhere (e.g. Peak Duel's decision state). This is
the clearest, most concrete instance of game-state clarity needing work.

---

## AMENDMENT — the room (broadcast-immersion pass, 2026-09-09)

Three sections above need correcting, because the pass changed what they
describe. Full detail: `docs/design/GAME_FEEL.md` and
`docs/implementation/BROADCAST_IMMERSION_REPORT.md`.

### §MOTION — "the arena light" is no longer the only ambient effect

That section says the `--v2-light-*` arena light is "the one ambient
decorative effect in the system" and that this is "the program's one
'signature moment' budget for glow, already spent correctly."

There are now **two, and they are hierarchically distinct**:

1. **The room** (`PeakV2ArenaBackdrop`) — the page-level environment. One
   floodlight, one vignette, one court plane, mounted exactly once, fixed to
   the viewport, never animated. It is not a per-surface effect and does not
   count against a surface's light budget; it is the building the surfaces
   are in.
2. **The arena light** (`PeakV2ArenaLight`) — unchanged, and still **one per
   surface**, still tied to real game focus.

The rule that replaces "one light" is: **one light per surface, inside one
room.** A surface that wants to mark its focus still mounts exactly one
`PeakV2ArenaLight`.

**The documented Peak Duel paired-wash exception is retired.** It existed
because the page behind that face-off was flat black and the pair needed its
own direction. The room supplies direction now; keeping the pair put five
gradient layers on the one surface that already had an exception. The
`--v2-light-opacity-paired` / `--v2-light-neutral` tokens remain in
`tokens.css` for anything that later earns them, but nothing currently uses
them.

### §COLOR — the environment has its own line token

`--court-line` (0.06 alpha) is unchanged and still correct for the 48px grid
motif it was tuned for: hundreds of lines whose *combined* presence is what
you see. A court has about twenty lines in a viewport, and at 0.06 it is
invisible. `--pk-backdrop-line` is a separate token at 0.10 (0.13 light
theme) with its own measured budget: gold at 0.10 over `--bg-page` puts
`--text-muted` at ≈5.1:1 in the worst case of a hairline directly behind
text, against 5.8:1 on the bare page. **0.14 was rejected** at ≈4.6:1 — the
same tenth-of-a-point margin the `--v2-court-dim-opacity` incident already
taught this codebase to avoid. The ceiling is asserted in
`tests/unit/arena-backdrop.test.tsx` rather than left to review.

### §RESPONSIVE — 768px is now a real threshold, not just a reference point

The court is a landscape object. Below 768px the `slice` crop leaves one
vertical hairline and one circle, which reads as a generic motif rather than
as a court and runs through the body copy. The geometry is dropped there; the
light and the vignette remain. This is the first breakpoint in the system
that changes *what is drawn* rather than how it is laid out, and it is
deliberate: a crop that does not read as a court is not worth the noise.

### New: how a route classifies itself

A route states what kind of surface it is with `data-arena="live" | "quiet"`
on its own root element, and `styles/v2/arena-room.css` reads it upward
through `:has()`. No prop threading, no client component, no route table, and
an unclassified route gets `ambient`.

- `live` — an active game board. Firmer court, tighter floodlight.
- `quiet` — anything whose own content is line-dense or prose-dense: a
  ranking table, a reading page, the Daily Grid board (which has its own cell
  grid), the RTT start gate (one URL serving both a gate and a live run).
- `ambient` (default) — hubs, start gates, results.

`data-arena="live"` has a second consumer: `HandleOnboardingPrompt` watches
for it and suppresses itself whenever a live board is mounted, which a route
denylist could not do for a mode whose board mounts in place.

### New: an optional sound layer

`lib/arena-audio` — eight synthesised cues, no assets, no dependency, **off by
default**, control in the header's display cluster. No cue carries information
that is not already visible. See `GAME_FEEL.md`.
