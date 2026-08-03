# RUN THE TABLE "Today's Run" — evidence and verdict (launch-polish LP2-3)

Owner: game-experience. This supersedes the prior pass's audit finding
("daily is a real, tested rules contract, keep it") on the one axis that
finding never actually argued: whether a player experiences anything
different. The prior finding was correct about everything it checked and
incomplete about the one thing that decides this.

## 1. Seed behavior

`daily_seed(date_str)` (`nba_peak/run_the_table/daily.py:68-71`) is a pure
SHA-256 of `f"run-the-table-daily:{RULESET_VERSION}:{date_str}"`, deliberately
excluding the signing secret so the seed is publicly reproducible — anyone can
derive it from the date alone. `resolve_seed` (`apps/api/app/services/run_the_table/runs.py:170-190`)
explicitly forces `seed = None` for `run_type == "daily"` and derives it
server-side; a client-supplied seed is honored only for `standard`
(`apps/api/app/api/v1/run_the_table.py:388-390`: *"a daily's seed comes from
its date, never from a client"*). This is the one genuine mechanical
difference and it is real: two players who both open "Today's Run" get
byte-identical content; two players who both start a standard run do not.

## 2. Reset boundary

Midnight **America/Los_Angeles**, defined once in `nba_peak/daily_key.py:51-52`
(`ZoneInfo("America/Los_Angeles")`, not a fixed UTC offset, so DST transitions
resolve correctly) and consumed by `daily_key()` (`daily_key.py:101`), which
every daily mode in the app shares. `validate_run_date` (`daily.py:54-65`)
allows replaying any of the last `ARCHIVE_DAYS = 366` days (`daily.py:34`) but
rejects future dates.

## 3. Rules differences

**None.** Traced every stage of generation and resolution for a `run_type`
branch:

- `generate_blueprint(seed, run_type, date, pool)` (`nba_peak/run_the_table/generation.py:252-335`)
  stores `run_type`/`date` on the returned `RunBlueprint` (`:334-335`) and
  never reads either as an input to any RNG call, node-type selection
  (`_stage_node_types`, `:229-249`), draft/trade/reserve offer generation, or
  boss resolution (`resolve_bosses(pool)`, `:264`, which takes no seed or
  run-type argument at all). Every piece of content is a pure function of
  `seed` alone.
- `nba_peak/run_the_table/battle.py` and `nba_peak/run_the_table/pricing.py`
  — grepped for `run_type`: zero matches in either file. Combat resolution
  and card pricing cannot see which mode produced the run they're operating
  on.
- `nba_peak/run_the_table/state.py:185` and `receipt.py:520` only ever *carry*
  `run_type` through as a metadata field on the state/receipt — never branch
  on it.

Given the same seed, a daily run and a standard run produce **identical**
acts, stages, node types, draft/trade/reserve offers, bosses, prices and
battle outcomes. This is confirmed by construction, not by sampling — there
is no code path where `run_type` could matter to any of it.

## 4. Persistence

`run_the_table_runs.run_type` is `TEXT NOT NULL CHECK (run_type IN
('standard', 'daily', 'challenge'))` (`supabase/migrations/20260731090000_run_the_table.sql:49`),
with a partial unique index `(owner_sub, run_type, run_date) WHERE run_type =
'daily'` (`:79-81`) enforcing one daily row per player per date at the
database layer. `create_run` (`apps/api/app/services/run_the_table/runs.py:307-333`)
re-enters an existing daily run rather than minting a second one: *"a daily
happens once, and letting a reload mint a fresh board would make the shared
board meaningless"* (`:317-318`). This is real and correctly enforced —
**and it is the one property most likely to look like a rules difference
without actually reading as one to a player** (see §6).

## 5. Scoring / leaderboard differences

**None, because RUN THE TABLE has no leaderboard in any mode.**
`docs/implementation/rtt-overhaul/SCORE_RECONCILIATION.md:179-184`: *"RTT gets
a leaderboard only after its score contract is separately defined — not in
this pass."* Grepped the whole API for a `run-the-table`-scoped leaderboard
route: none exists. There is therefore no mechanism — today, in either
mode — to compare a score, a completion time, or a lives-remaining count
against any other player, daily or otherwise. Whatever value a shared daily
board could unlock through comparison is entirely unbuilt.

## 6. Visible user value — the bar that matters

This is the one the prior pass's finding did not argue, and the evidence
here does not support it as currently shipped.

**What a deterministic shared seed COULD deliver, in principle:** the
ability to compare notes with other players ("did you beat the Act 3 boss on
today's board?"), because everyone's daily run is the identical content.

**What the product actually does with that today: nothing measurable.**

- **No leaderboard** (§5) — there is no server-side ranking or comparison
  surface for any RTT run, so "everyone played the same board" cannot
  resolve into "here's how you did against them."
- **Board-sharing is not daily-exclusive.** `POST /run-the-table/runs/{run_id}/challenge`
  (`apps/api/app/api/v1/run_the_table.py:478-527`) mints a shareable link that
  reproduces ANY run's exact board — standard included, no `run_type` check
  beyond the run existing (`:499-500`: *"no ownership check beyond the run
  existing"*). A player who wants to hand a friend the identical board they
  just played can already do that from a standard run, on demand, with
  whoever they choose. The daily mode's only addition is doing this
  automatically with the whole player base once a day — a real difference in
  degree, but one the product does not surface as a feature (no "share
  today's board" callout distinct from the generic challenge-link action
  every run already has).
- **The "one attempt" property is real but invisible.** The daily descriptor
  route computes `already_played`/`existing_run_id` for a caller who already
  carries an identity (`apps/api/app/api/v1/run_the_table.py:299-304`), and
  the doc comment for the route is explicit that this field exists so a
  client can say something about it (`:290-291`: *"`already_played` is
  present only for a caller who already carries an identity; see
  DailyDescriptorResponse for why it is not defaulted to false"*). **The
  frontend never reads it.** `apps/web/src/types/run-the-table.ts:957-965`'s
  `DailyDescriptor` interface — the type `RunStartGate.tsx` and
  `RunTheTableGame.tsx` actually use — has no `already_played` field at all;
  grepped the whole `apps/web/src` tree and the string `already_played`
  appears only in the **82-0/CourtBuilder** daily-mode files
  (`arena/court/leaderboard/page.tsx:196,214`, `LeaderboardPreview.tsx:197`,
  which correctly render "See today's board" vs. "Play today's daily"). RTT
  built the exact same signal server-side and never wired it to anything. A
  player who already finished today's run, clicking "Today's run" again,
  sees the identical button and identical copy (`RunStartGate.tsx:387-390`:
  *"everyone gets the same acts, the same offers and the same bosses"*) as a
  player who hasn't — then silently lands back on their already-finished
  run with no explanation of why nothing is starting fresh. That is not
  "visible user value"; if anything it is a legible-looking dead end.

**Net:** the daily mode is a real, correctly-implemented, well-tested backend
contract that the current frontend does not turn into anything a player can
point to and say "this is why I'd choose Today's Run over Standard." The
generation, battles and pricing are provably identical; the one player-facing
distinction the backend actually computes (`already_played`) is dropped on
the floor before it reaches a screen.

## Verdict

**Remove the daily entry point from public, discoverable UI. Preserve every
backend contract untouched**, per the instruction: the `/run-the-table/daily`
route, `daily_seed()`, the partial unique index, and any already-saved daily
runs all stay exactly as they are — a saved run must remain loadable, and the
route must not 404 a bookmark. What changes is which UI actively advertises
"Today's Run" as a choice next to Standard.

If a real visible-value feature is built later — a daily-specific comparison
surface, an actual leaderboard, or the `already_played` signal wired into a
real "you already played today, come back tomorrow" state — the entry point
can come back with something to point to. Today it has nothing to point to
beyond an internal seed.

## Entry points found, and what changed

All four discoverable paths into `?mode=daily` / the "Today's Run" choice,
enumerated by grep across `apps/web/src` for `mode=daily` / `rtt-daily` /
`RUN_THE_TABLE_DAILY_HREF` / `dailyRunTheTable`:

| # | File | What it was | Disposition |
| --- | --- | --- | --- |
| 1 | `apps/web/src/components/home/HeroLauncher.tsx` | Secondary "Today's shared run" link beside the primary CTA | Removed |
| 2 | `apps/web/src/app/(main)/arena/page.tsx:126-131` | "Play today's shared run" inline link in the flagship section | Removed |
| 3 | `apps/web/src/components/run-the-table/RunStartGate.tsx` | "Today's run" button, co-equal with "Start a run" | Removed |
| 4 | `apps/web/src/lib/nav-model.ts` (`DEFAULT_AVAILABILITY.dailyRunTheTable`) | Nav "Daily" group's "Daily Run the Table" entry, on by default | Defaulted off |

**Preserved, deliberately:**
- `GET /run-the-table/daily` and every backend route under
  `apps/api/app/api/v1/run_the_table.py` — untouched.
- `daily_seed()`, `daily_key()`, the partial unique index, `create_run`'s
  re-entry behavior — untouched.
- `?mode=daily` and `?start=daily` query-param handling in
  `RunTheTableGame.tsx` — untouched, so an existing bookmark or a link
  already shared before this change still resolves correctly and does not
  spend an attempt by navigation alone (the property the previous pass's
  audit specifically verified and that this change does not touch).
- Any already-created `run_type='daily'` row in the database — untouched;
  nothing here is a migration.

Files #1 and #3 are squarely `game-experience`'s ownership
(`HeroLauncher.tsx`, RTT-entry routing). File #4 (`nav-model.ts`) is a
one-line default flip on the exact extension point its own doc comment
describes for this purpose (`nav-model.ts:118-121`: *"a mode taken offline is
removed from the menu by a caller rather than by editing this file under
time pressure"*) — no `nav.tsx`/`PlayMenu.tsx`/`MobileNavDrawer.tsx` JSX
touched. File #2 (`arena/page.tsx`) is not on any owner's explicit list; it
was touched because it is a third, otherwise-orphaned public entry point to
the exact same choice, and leaving it live would have meant "removed from
public UI" was untrue. Both #2 and #4 are flagged here explicitly for the
lead/visual-platform to confirm or revert.
