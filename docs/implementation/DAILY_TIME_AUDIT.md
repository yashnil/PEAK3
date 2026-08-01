# Daily-time audit — from midnight UTC to midnight America/Los_Angeles

Audit of every daily-mode time computation in PEAK3, the reproduced root cause
of the stale daily board, and the policy that replaces it.

---

## 1. Baseline: what the code actually did

**There was no PT anywhere in the codebase.** Every daily key in both apps was
derived from UTC, in **four near-identical helper functions** plus **five
inline expressions**:

| Location | Expression |
|---|---|
| `nba_peak/daily_grid/generator.py:189` | `datetime.now(timezone.utc).strftime(DATE_FORMAT)` |
| `nba_peak/perfect_season/daily.py:64` | `datetime.now(timezone.utc).strftime(DATE_FORMAT)` |
| `nba_peak/run_the_table/daily.py:27` | `ref.astimezone(timezone.utc).strftime("%Y-%m-%d")` |
| `apps/api/app/api/v1/game.py:91` | inline `datetime.now(timezone.utc).strftime(...)` |
| `apps/api/app/api/v1/draft.py:130` | inline |
| `apps/api/app/services/draft/state.py:65` | inline |
| `apps/web/src/lib/utils.ts:28` | `new Date().toISOString().split("T")[0]` |
| `apps/web/src/lib/daily-grid-archive.ts:64` | `now.toISOString().slice(0,10)` |
| `apps/web/src/app/(main)/play/daily/page.tsx:9` | a **third** copy of `todayUTC()` |

`docs/architecture/ADR-001-board-snapshot-contract.md:112` explicitly ratified
UTC, so this was a deliberate original decision, not an oversight — but it is
not the decision the product now requires.

The only IANA-aware daily logic in the entire repo was
`apps/api/app/services/progression/streak_service.py:64-68`, which uses a
per-user profile timezone for **progression streaks only** and never touched a
board key. `UserSettings.timezone` was stored, validated, and unused by any
daily board.

### Who decided the date

| Mode | Timezone | Who computed "today" | Could they disagree? |
|---|---|---|---|
| RUN THE TABLE Daily | UTC | **Server** | No for the key — best design in the repo |
| Daily Grid | UTC | **Server** | Key no; **board shown, yes** (see §2) |
| Peak Duel Daily | UTC | **CLIENT** → `?date=` | **Yes** |
| Peak Draft Daily | UTC | **CLIENT** → `?date=` | **Yes** |
| PEAK Season Daily | UTC | Mixed (URL `?date=`, server default) | Partially |
| Daily leaderboards | — | None exist | — |

**Three of five shared daily modes let a browser clock cast the deciding vote**,
and the server honoured it: `game.py:90-91` and `draft.py:129-130` fall back to
their own clock only when the parameter is *absent*. `game.py` performed **no
future-date validation at all** — `?date=2099-01-01` was served. Neither
`validate_grid_date` nor `validate_challenge_date` bounded the future either;
only `validate_run_date` (RTT) did.

### Response shape

There was **no `daily_key`, no `timezone`, no `starts_at`/`ends_at`/
`seconds_remaining`** on any response, and no shared daily-key utility.

---

## 2. Reproduced root cause of the stale daily board

Four independent paths, in decreasing order of impact.

### Cause A (primary) — Daily Grid fetches the board once per mount

`apps/web/src/components/daily-grid/DailyGridGame.tsx:158-181`:

```tsx
useEffect(() => {
  if (initialBoard) { ... return; }
  getDailyGridBoard(date)          // date === undefined on /daily/grid
    .then((b) => { setBoard(b); setProgress(loadProgress(b.board_id) ?? emptyProgress(b)); })
  ...
}, [date, initialBoard]);          // ← both permanently undefined
```

On the canonical `/daily/grid` route, `date` is `undefined`
(`app/(main)/daily/grid/page.tsx:30`) and `initialBoard` is `undefined`. **The
dependency array is `[undefined, undefined]` for the entire lifetime of the
mount.** The effect fires once and never again.

The component's own comment at `:167-168` — *"A new date means a new board_id
means a new storage key, so yesterday's grid can never bleed into today's"* —
is **true of the persistence layer and false of the fetch layer**. The storage
key is correctly keyed by `board_id`; nothing ever asks the server for a new
`board_id`.

**Reproduction:** open `/daily/grid` at 23:50, leave the tab open or
backgrounded, return at 00:05.

* `board` is still yesterday's.
* `saveProgress` keeps writing to yesterday's storage key.
* The `CompletionPanel` countdown (`CompletionPanel.tsx:137-145`) has ticked to
  `0s` and **stays there** — a visible, wrong "0s until the next board" beside
  an expired board.
* Every answer posts yesterday's date, and the server validates it happily
  against the archive board.
* On completion, `daily_grid.py:503` computes
  `played_on_board_date = board.date == today_utc_date()` → **`false`**. The
  session is filed as an archive replay and `counted_for_streak: false`.

**So the player's streak silently breaks *because* they played through the
reset.** That is the sharpest edge of the bug and the reason it reads to users
as data loss rather than as a stale cache.

The surrounding chrome froze the same way: `DailyHub.tsx:42-49` and
`DailyGridHistory.tsx:48-57` capture `today` in a mount-only `useEffect` with
`[]` deps and never re-derive it.

### Cause B — RUN THE TABLE resumes yesterday's daily forever

`StoredActiveRun` (`types/run-the-table.ts:612-618`) carries
`{schema_version, run_id, seed, run_type, updated_at}` — **no `run_date`**.
`RunTheTableGame.tsx:210-236` resumes it unconditionally; `GET /runs/{run_id}`
regenerates yesterday's blueprint from the stored seed and returns **200**;
`shouldClearStoredRun` clears only on 404/409/410. An unfinished daily from
yesterday is silently resumed today, the start gate never appears, and
`daily.already_played` — fetched correctly for *today* — is computed and never
consulted on this path. The player cannot reach today's daily without clearing
localStorage.

### Cause C — Peak Draft short-circuits today's fetch

`app/(main)/arena/daily/[mode]/page.tsx:64-79` resumes when
`active.board_type === "daily" && active.mode === draftMode` and `return`s
before reaching `getDailyDraft(draftMode, today)`. **`active.board_id` embeds
the date and is never compared to today.** On completion the play is recorded
against yesterday's `board_id` in `daily_completions`.

### Cause D — `today` is computed once from the browser clock and sent to the server

`play/daily/page.tsx:20` and `arena/daily/[mode]/page.tsx:33` compute `today` in
render scope and pass it as `?date=`. Because the client *sends* the date, the
server cannot correct it. A long-lived tab, or a device with a wrong clock,
plays a different day's board with full server cooperation.

### Why moving to midnight PT made all four strictly worse

The old boundary was midnight UTC = **17:00 PT** — mid-afternoon for the core
audience, when tabs are relatively likely to have been opened recently.
Midnight `America/Los_Angeles` lands the reset exactly where **idle tabs and
backgrounded phone browsers are most common**, converting Cause A from an edge
case into the modal experience. And with four separate `today_*_date()` helpers
plus five inline expressions, a partial migration would have left modes
disagreeing about what day it is — with three of five modes letting the client
decide the tiebreak.

That is why the timezone change and the single-utility refactor had to ship
together, not in sequence.

---

## 3. The policy that replaces it

**`nba_peak/daily_key.py` is the single source of truth.** One IANA zone, never
a fixed offset:

```python
DAILY_TIMEZONE = "America/Los_Angeles"
daily_key(now=None) -> "YYYY-MM-DD"
daily_window(key=None, now=None) -> DailyWindow
validate_daily_key(value, *, now=None, max_age_days=366, allow_future=False)
```

`now` is injectable throughout, which is what makes boundary, DST, leap-day and
year-rollover cases testable at all — the four helpers it replaces read the
clock internally and were untestable at a boundary. Only the RTT helper was
injectable, and it is the only one that had a rollover test.

Every daily API response embeds the window:

```json
{ "daily_key": "2026-08-01", "timezone": "America/Los_Angeles",
  "starts_at": "2026-08-01T07:00:00Z", "ends_at": "2026-08-02T07:00:00Z",
  "seconds_remaining": 12345 }
```

Clients never recompute a timezone boundary in JavaScript. They count down from
`seconds_remaining` and refetch when it reaches zero.

### DST is the point, not an edge case

`day_start_utc()` uses `ZoneInfo` arithmetic rather than an offset, so:

* **Spring forward** (2nd Sunday in March): the window is **23 hours**.
  `2026-03-08T08:00Z → 2026-03-09T07:00Z`.
* **Fall back** (1st Sunday in November): the window is **25 hours**.
  `2026-11-01T07:00Z → 2026-11-02T08:00Z`.

Both are correct; both are tested. A hardcoded `-08:00` would silently shift the
reset to 01:00 local for roughly eight months of the year.

Midnight is never a nonexistent local time in this zone (US transitions occur
at 02:00), but `fold` is handled defensively so the module stays correct if the
policy zone ever changes.

### Server authority

Every route resolves `validate_daily_key(date) if date else daily_key()`. A
client-supplied date is only ever an **explicit archive request**, validated and
bounded to 366 days, and rejected if it is in the future. The browser no longer
computes or sends "today" in any mode.

### Cache correctness

* The daily key is in every cache key and every persisted resume pointer; a
  pointer whose key is not today is discarded rather than resumed.
* No build-time static daily payload — the daily routes declare their caching
  explicitly instead of relying on the Next 15 `fetch` default, which happened
  to be safe but was undeclared.
* `useDailyReset()` refetches at the boundary **and** on
  `visibilitychange`/`focus` when the stored key no longer matches the server's.
  There was previously no `visibilitychange` or `focus` listener anywhere in the
  daily code: the countdown hit `0s` and nothing happened.

### Uniqueness and challenge separation

Daily attempts are unique per `(owner_sub, mode, daily_key)` where the product
allows one attempt. RTT already had the correct partial unique index; Daily Grid
had the correct shape; **Peak Duel Daily had no server-side attempt record at
all** (localStorage only).

Challenge links never consume a daily attempt. RTT already enforced this with an
explicit comment at `run_the_table.py:354-356`. **Peak Draft did not**: a
daily-minted token carried `board_type:"daily"` and the sender's date into
`create_draft_game`, so opening a friend's link wrote the *recipient's* official
daily completion — and if they had already played, `ON CONFLICT DO NOTHING`
silently discarded their real result. The RTT fix is back-ported.

### UI copy

`"Two PEAK3 games reset at midnight UTC"` → **"New daily board at midnight PT"**,
with a countdown driven by the server's `seconds_remaining`.

---

## 4. Test coverage added

| Case | Why it matters |
|---|---|
| 23:59:00 PT and 00:00:00 PT | The boundary itself, in the policy zone |
| Spring-forward day = 23-hour window | Catches any fixed-offset regression |
| Fall-back day = 25-hour window | Catches naive `+1 day` arithmetic |
| Leap day (2028-02-29) | Date arithmetic across February |
| Year boundary (Dec 31 → Jan 1 PT) | Year rollover in the policy zone, not UTC |
| Background-tab reset | Cause A |
| Countdown reaching zero triggers a refetch | Cause A |
| Stale resume pointer discarded | Causes B and C |
| Challenge does not consume a daily attempt | Peak Draft regression |
| Client and server agree on the key | Cause D |

Previously the **only** rollover-boundary test in the repo was
`tests/run_the_table/test_receipt_and_daily.py:231-233`, and it could only exist
because RTT's helper happened to accept an injectable `now`.

---

## 5. What was deliberately not changed

* **Per-user progression streaks keep their own per-profile timezone**
  (`streak_service.py`). Those are a personal-consistency mechanic, not a shared
  global board; forcing them to PT would move the goalposts for existing users
  in other timezones. The two systems are now explicitly distinct: shared boards
  use `DAILY_TIMEZONE`, personal streaks use the profile timezone.
* **No IP geolocation and no browser location permission**, per the spec. The
  reset is a single global instant, announced as "midnight PT", not localised
  per viewer.
* **Historical `board_id`/`daily_completions` rows are not rewritten.** Boards
  generated under the UTC policy keep their original keys; the archive stays
  readable. Only the derivation of *new* keys changes.
