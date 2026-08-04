# Game Experience Audit — Launch Polish Phase 1

Read-only audit. No product behavior changed. Worktree: `PEAK3-lp-game` (branch
`wt/lp-game`, from `feature/arena-launch-polish` @ `95a41cb`, which already
includes the RTT-overhaul pass — RTT battle/reveal/boss cinematics, game
shell, decision cards and result screen are preserved and out of scope here).

---

## TASK A — Daily Grid layout

**Root cause, in one sentence:** `DailyGridGame.tsx:861` locks the board and
the "workbench" (search panel / completion panel) into a permanent 50/50 CSS
grid split — `lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]` — inside a
container that is itself capped at `max-w-6xl` (1152px), so two compounding
constraints starve the 3×3 grid: the whole game never gets wider than 1152px
regardless of viewport, and then whatever width remains is roughly halved
with the right column, permanently, in every state (idle, selecting,
*and* after completion).

### Structure

`DailyGridGame.tsx:632-923` renders one `max-w-6xl` wrapper containing:
- a header block (title, stat tiles, rule strip) — full width
- `DailyGridGame.tsx:861`: `<div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">`
  - left cell (`DailyGridGame.tsx:862-874`): `DailyGridBoardView` (the 3×3 grid)
  - right cell (`DailyGridGame.tsx:876-922`, `lg:sticky lg:top-20`): whichever
    of three things applies —
    - `CellPanel` when a square is selected (search UI)
    - an idle hint card when nothing is selected and the board isn't done
    - `CompletionPanel` once all 9 squares are locked

Below `lg` (1024px) there is no `grid-cols-*` override, so the grid falls
back to a single implicit column and the two cells stack — board first, then
workbench, in document order. Mobile/tablet is therefore already a stacked
layout; the compression defect is desktop-only, but it is desktop where the
game is normally played and screenshotted/shared.

### Measured width at the two reference viewports

Both computations use `max-w-6xl` = 1152px, `px-3 sm:px-4` container padding
(32px total at ≥ `sm`), and `gap-4` (16px) between the two grid cells.

- **1024px viewport** (the `lg` breakpoint fires exactly here — Tailwind's
  `lg:` is `min-width: 1024px`, so this is the *worst* case, not a safe
  margin): container content width ≈ 1024 − 32 = 992px. Minus the 16px gap
  → 976px to split 1.05fr / 1fr → **board ≈ 500px, workbench ≈ 476px**. A
  500px-wide 3×3 grid, after its own row-header gutter
  (`DailyGridBoardView.tsx:68`: `minmax(58px, 0.55fr) repeat(3, minmax(0,1fr))`)
  leaves roughly 145px per square.
- **1440px viewport**: the outer container is still capped at `max-w-6xl`
  (1152px) — it does not grow with the viewport past that. Content width ≈
  1152 − 32 = 1120px, minus gap → 1104px → **board ≈ 565px, workbench ≈
  539px**. Barely better than the 1024px case, because the ceiling is the
  `max-w-6xl` cap, not the viewport.

At neither reference width does the board come close to "dominant" — it is
permanently pinned to roughly half of an already-narrow container.

### Where search / candidates live, and independent scroll

`CellPanel.tsx` (rendered in the right column) contains the entire
"selected square" workbench: both constraint blocks
(`CellPanel.tsx:236-239`), the search input (`CellPanel.tsx:290-305`), and
the results list. Results scroll **independently** in a capped box —
`CellPanel.tsx:329`: `className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-y-auto pr-1"`
(`max-h-72` = 288px). So search/candidates are not "beneath the grid" today;
they live in the sticky right rail beside it (`lg:sticky lg:top-20` at
`DailyGridGame.tsx:876`), which is exactly what halves the grid's width.

### Completion state storage — refresh does NOT lose it (good news for the modal target)

`progress` (every locked cell, `completed_at`, `incorrect_attempts`, elapsed
time) is written to `localStorage` on every change
(`DailyGridGame.tsx:387-389`, keyed per `board_id` via
`dailyGridProgressKey` in `lib/daily-grid-state.ts:135-138`) and reloaded on
mount (`DailyGridGame.tsx:217,229`: `loadProgress(b.board_id) ?? emptyProgress(b)`).
`isComplete(progress)` is a pure function of the reloaded `progress` object
(`lib/daily-grid-state.ts:233`), so a hard refresh after finishing a board
still renders the completed state — the `result` (server's "today's max"
comparison) simply re-fetches once more via the effect at
`DailyGridGame.tsx:403-427` (`if (!board || !progress || !isComplete(progress) || result) return;`),
and the local archive re-records idempotently
(`recordCompletedBoard` replaces by `board_id`, `DailyGridGame.tsx:478-486`).
**Conclusion: moving the result screen behind a modal is safe with respect
to refresh — completion state is already refresh-proof and lives entirely
in state that is independent of which component renders it.** The modal
target design requires no new persistence work, only a UI restructure.

### Mobile behavior

Confirmed stacked (board, then workbench) below 1024px — no separate mobile
markup branch exists (unlike `CourtBuilder`, which explicitly documents this
choice; `DailyGridGame` gets it for free from the missing `grid-cols-*`
override). Row/column headers already use `clamp()` font sizing
(`DailyGridBoardView.tsx:45`: `text-[clamp(9px,2.4vw,12px)]`), so they do not
overflow on narrow phones, but at the low end of that clamp (9px) they are
close to the accessibility floor for legibility — worth a look during
implementation, not a launch blocker on its own.

### Label legibility (current)

`HeaderChip` (`DailyGridBoardView.tsx:18-52`) shows only `short_label`
(e.g., "Top 10 SI"), with the full `label`/`description` only in the
native `title` tooltip — undiscoverable on touch, and mouse users have to
hover to get the real constraint. `GridCell.tsx:56-57` does carry the full
constraint in `aria-label`, so screen-reader users are not affected; sighted
mouse/touch users are the ones who lose the fuller wording.

---

## TASK B — 82-0 (CourtBuilder) positional placement and swapping

This is the Peak Season "82-0" builder: `apps/web/src/components/court/CourtBuilder.tsx`
(orchestration/state), `PeakCardCourt.tsx` (one slot's render + button
variants), `CourtLayout.tsx` (spatial grid), `EligiblePlayerSearch.tsx`
(candidate list). Backend actions: `apps/api/app/services/perfect_season/state.py`.

**Important finding up front:** this is measurably more built-out than the
brief's hypothesis list suggests. It is already click/tap-based (no drag
anywhere), already keyboard-operable (every actionable element is a real
`<button>`), and already signals legal destinations visually. The genuine
gaps are narrower and more specific than "selection state is invisible" or
"swapping requires drag" — see the precise list below.

### The exact interaction, file:line

- **Selecting a candidate**: `EligiblePlayerSearch.tsx:87-92` — a plain
  `<button data-testid="candidate-card" onClick={() => onSelect(c.player_slug)}>`.
  `onSelect` is `CourtBuilder.tsx:156-159`'s `handleSelect`, which calls
  `selectPlayer(state.game_id, playerSlug)` and replaces the whole
  `state` with the server's response on success. **There is no optimistic/
  local "this card is now selected" highlight** — the only feedback between
  click and response is that every candidate button becomes `disabled` via
  the shared `busy` flag (`EligiblePlayerSearch.tsx:91`: `disabled={disabled}`,
  passed down as `disabled={busy}` from `CourtBuilder.tsx:432`). On a slow
  network, a player sees all rows go inert with no per-row spinner and no
  indication *which* row they pressed.
- **Choosing a slot (initial placement)**: `CourtBuilder.tsx:259-263` —
  `onClick` is only wired for an OPEN slot during the `"placing"` phase:
  `!isSwapTarget && phase === "placing" && !slot.filled && !busy`. Clicking
  routes to `handlePlace` (`CourtBuilder.tsx:161-164`) → `placeCard(game_id, slotType)`.
  The persistent "who is selected" indicator is the banner text at
  `CourtBuilder.tsx:436-461`: `"Step 2 · Place {player_name}"` — not a
  highlighted source card, just a sentence above the court.
- **Replacing an occupied player (during initial placement)**: **not
  possible, and not explained.** `PeakCardCourt.tsx:338-350` — a filled slot
  with neither `onSwapTarget` nor `onClick` set renders as a plain `<div>`,
  not even a disabled `<button>`. Clicking it does nothing at all: no cursor
  change, no message, no `disabled` styling distinct from an inert idle
  card. A player who just drafted someone and wants to bump an earlier pick
  has no affordance here — they must first place into whatever empty slot
  is available, then separately discover and use "Move" (see below) to
  displace someone else. That two-hop path, with the first hop's target
  looking identical to any other inert slot, is the sharpest concrete gap
  in the whole flow.
- **Swapping two occupied slots (post-placement rearrange)**:
  `CourtBuilder.tsx:90` (`movingSlot` state) → clicking a filled slot's
  small "Move" button (`PeakCardCourt.tsx:232-243`, `data-testid="slot-move-btn"`,
  9px uppercase text, `px-1.5 py-0.5` — well under the ~44px touch-target
  guideline) sets `movingSlot` via `onMove` (wired at `CourtBuilder.tsx:267-271`
  only when `rearrangeAvailable && slot.filled && movingSlot == null && !busy`).
  Every *other* slot then becomes `isSwapTarget` (`CourtBuilder.tsx:254`) and
  renders as a real button (`PeakCardCourt.tsx:312-336`) labeled "Swap here"
  (occupied) or "Move here" (empty) with a dashed gold border. Clicking it
  calls `handleSwap` (`CourtBuilder.tsx:207-218`) → `swapSlots(game_id, from, target)`
  **immediately** — there is no confirmation step and no preview between the
  click and the committed API call. Whether the target is occupied (a real
  swap, displacing someone) or empty (a plain move) is not distinguished in
  any way beyond the button's own label text — same border color, same
  styling.
- **Canceling a selection**: `CourtBuilder.tsx:450-458`, a real "Choose
  someone else" button in the placing banner → `handleCancel` →
  `cancelSelection(game_id)` (server-authoritative undo of the pending pick,
  before it's placed). For rearrange mode specifically: the "Cancel" button
  in the rearrange banner (`CourtBuilder.tsx:496-503`) and `Escape`
  (`CourtBuilder.tsx:104-111`, a real `keydown` listener scoped to
  `movingSlot != null`) both call `cancelRearrange` → `setMovingSlot(null)`,
  purely local, no API call.
- **How the user learns which slots are legal**: for initial placement,
  *every* open slot is legal — `CourtBuilder.tsx:447-448`'s own copy says so
  ("every open spot is a legal placement"), and `PeakCardCourt.tsx:263-269`
  renders a `Target` icon + "Place here" on each. There is no concept of an
  "illegal" placement target in this phase at all. For rearrange, likewise
  every other slot is a legal swap/move target (`CourtBuilder.tsx:254`: any
  slot `!== movingSlot`) — again no "illegal, and here's why" case exists in
  the product's rules, so the target design's "illegal targets visible but
  disabled with an explanation" is not a live gap for this feature (there is
  currently no such thing as an illegal target in 82-0's rules); the gap is
  instead the *occupied slot during placement*, which is legal-but-blocked
  through a UI path that gives it no explanation at all — it should either
  become a real swap target during placement (so "replacing" and "moving"
  use one mental model) or be visibly disabled with a reason.
- **Mobile interaction**: same tap targets as desktop, no separate mobile
  code path. The "Move" button's small size (see above) is the one mobile-
  specific risk — a ~24px-tall label button is below typical touch-target
  guidance.
- **Keyboard interaction**: solid already. Every actionable affordance
  (candidate row, open-slot placement, Move, swap target, Cancel/"Choose
  someone else") is a real `<button>`, so Tab order and Enter/Space work
  natively; `Escape` is wired for rearrange mode. The one gap: no on-screen
  hint that Escape exits rearrange — a keyboard user has to already know the
  convention, or find the visible "Cancel" button instead.

### Precise diagnosis of "awkward"

Not: invisible selection state (the banner names the pending player),
not: unsignaled legal targets (dashed border + explicit "Place here"/"Swap
here"/"Move here" labels already exist), not: drag-dependent (there is no
drag anywhere in this component). The actual gaps, in order of impact:

1. **No preview before commit.** Both `handlePlace` and `handleSwap` fire
   the mutating API call the instant a destination is clicked — there is no
   "Swap A ↔ B, confirm?" step the target design asks for
   (`CourtBuilder.tsx:207-218`, `161-164`).
2. **No undo.** Once `handleSwap`/`handlePlace` succeeds, there is no toast
   and no one-click reversal anywhere in this file or `PeakCardCourt.tsx` —
   reversing a swap means re-entering rearrange mode and repeating the full
   two-click flow by hand.
3. **Occupied slots are inert and unexplained during initial placement** —
   see above; this is the one place a click produces literally no feedback
   of any kind.
4. **Small `Move` touch target** on mobile.

---

## TASK C — RTT entry flow

### Is daily RTT a real rules contract, or just a label? — **Real. Fully implemented, seeded, persisted, and tested. Not a label.**

Evidence:

- **Seeding differs by construction.** `nba_peak/run_the_table/daily.py:68-71`:
  `daily_seed(date_str)` is `sha256("run-the-table-daily:{RULESET_VERSION}:{date}")`
  — a pure function of the calendar date (America/Los_Angeles midnight
  boundary, `nba_peak/run_the_table/daily.py:10-13`), deliberately excluding
  the signing secret so the seed can be published and every player
  independently derives the identical board. A `standard` run instead draws
  from `secrets` (`apps/api/app/services/run_the_table/runs.py`, docstring
  lines 6-11: *"`standard` draws one from `secrets`; `daily` derives it from
  the ... date ... A client-supplied seed is honoured only for `standard` —
  accepting one for a daily would let a player re-roll the shared board."*).
- **Route enforcement, not just data shape.** `apps/api/app/api/v1/run_the_table.py:340-394`:
  creating a `run_type == "daily"` run explicitly sets `seed = None  # a
  daily's seed comes from its date, never from a client`, is gated behind
  `_require_daily_enabled()` / `settings.RUN_THE_TABLE_DAILY_ENABLED`
  (independently toggleable), and re-entering an already-started daily on
  the same date returns the **same persisted run** rather than creating a
  new one (`runs.py:316-323`: *"Re-entering an existing daily: replace the
  freshly-built state with [the stored one] ... a daily happens once, and
  letting a caller already had a daily run for that date [get a fresh one]
  ... the run already in progress is returned untouched"*).
- **Real database schema, not just a service-layer distinction.**
  `supabase/migrations/20260731090000_run_the_table.sql` has a `run_type`
  column with a dedicated **partial unique index**
  `(owner_sub, run_type, run_date) WHERE run_type = 'daily'`
  (referenced in `apps/api/app/repositories/run_the_table_postgres.py:170,193`)
  — the database itself enforces "one daily run per player per date," which
  is a rules guarantee, not cosmetic labeling. The guest→account claim path
  (`run_the_table_postgres.py:193-214`) also branches specifically on
  `run_type = 'daily'` vs. `run_type <> 'daily'`, because a signed-in
  account merging in a guest's daily run has different collision semantics
  than merging a standard run.
- **Archive replay is a real, separate feature.** `daily.py:34`:
  `ARCHIVE_DAYS = 366` — `validate_run_date` allows replaying any of the
  last 12 months' daily boards (`GET /api/v1/run-the-table/daily?date=...`,
  `run_the_table.py:272-305`), which only makes sense because daily seeds
  are reproducible per-date; a "standard run with a label" could not support
  this at all.

**Conclusion for the three questions asked:**

1. **Does daily RTT differ from standard in real rules, seeding, or
   scoring?** Yes — seeding is the concrete, load-bearing difference (server-
   derived deterministic seed vs. client-visible random seed), enforced at
   the API layer, not just displayed differently.
2. **Are there saved runs in the DB with `run_type='daily'` that removal
   would invalidate?** Very likely yes in any environment with real usage —
   the schema is specifically built to store and dedupe them
   (`(owner_sub, run_type, run_date)` unique index), and `get_daily_run`
   is queried on every homepage/daily-descriptor load
   (`run_the_table.py:301-305`) specifically to surface "have you already
   played today." Nothing about removing a *frontend menu item* deletes
   these rows, but it would orphan them from normal navigation (see below).
3. **What backend compatibility must be preserved regardless of UI
   changes?** The `run_type='daily'` seeding rule, the per-day uniqueness
   constraint, the `RUN_THE_TABLE_DAILY_ENABLED` flag, the
   `GET /run-the-table/daily` descriptor route, and the archive-replay date
   window — none of these are UI concerns and none should be touched by a
   frontend-only change.

### Homepage entry path — the brief's premise does not match current code

The task brief describes *"the homepage 'Play Run the Table' button opens a
menu containing only 'Standard run' — a one-item dropdown."* That is **not**
what `apps/web/src/components/home/HeroLauncher.tsx` contains today. Git
blame shows this file has been touched by exactly two commits
(`35145c6`, `6ebb4d5`), both predating the RTT-overhaul work this branch is
built on, and it currently renders:

- `BASE_OPTIONS` (`HeroLauncher.tsx:70-87`) — **two** items, unconditionally:
  `"Standard run"` (`?start=standard`) and `"Today's shared run"`
  (`?mode=daily`, deliberately *not* `?start=daily` — see the file's own
  docstring at lines 40-56 for why: a bare link must never itself spend the
  day's attempt).
- A third, conditional `RESUME_OPTION` (`HeroLauncher.tsx:89-96`,
  `"Resume your run"`) appended whenever `loadActiveRun()` finds a
  localStorage pointer to a run in progress (`HeroLauncher.tsx:128-132`),
  plus a standalone `"You have a run in progress in this browser"` notice
  rendered below the trigger regardless of whether the menu is open
  (`HeroLauncher.tsx:302-313`).

So the menu is already 2-3 items with distinct hint text per option, full
WAI-ARIA menu-button keyboard support (arrow keys, Home/End, Escape,
Tab-closes-without-trapping — documented in the file's own header comment),
and the daily option is already routed through the start gate rather than
auto-starting from the homepage (intentionally, to avoid spending the daily
attempt via a bare link/bookmark/shared-URL navigation).

**"Continue Run" handling**: lives in `RunTheTableGame.tsx`, not in the
launcher. The active run id is mirrored to localStorage
(`RunTheTableGame.tsx:80-82`) and the boot sequence
(`RunTheTableGame.tsx:396+`) resumes it automatically before any `?start=`
param is even consulted (`RunTheTableGame.tsx:700-715`: *"A resumed run wins
outright. The param is still consumed and stripped"*), calling `getRun(stored.run_id)`
(`RunTheTableGame.tsx:472-481`) and emitting an `rtt_run_resumed` telemetry
event. `RunStartGate.tsx` separately surfaces a `resumeNotice` banner
(`RunStartGate.tsx:51-53, 249-256`) when a stored pointer could not actually
be resumed, so a stale/expired local pointer is explained rather than
silently dropped. The gate's own "Continue" / "Continue to the briefing"
buttons (`RunTheTableGame.tsx:895,938`) are the in-run resume affordance
once a run is loaded.

**Net finding for the lead:** if the one-item-dropdown defect was observed,
it was either fixed already by the RTT-overhaul pass that landed before this
audit, was observed on a different branch/environment, or was a
misdiagnosis. Recommend re-confirming the defect against a live
`npm run dev` on this worktree before scoping any Task C implementation —
as read, there is no dropdown-consolidation work to do, and the real
available polish (if any) is smaller: e.g. whether "Today's shared run"
should be more prominent than a same-weight second menu item, or whether
the resume notice/menu-item pairing is redundant. Do not delete the daily
option or its route regardless — the backend evidence above rules that out.
