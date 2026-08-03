# IMPLEMENTATION CONTRACT — launch polish

Binding on all three teammates. Where this and a teammate's own audit
disagree, this wins. Resolved on measurement, not on the brief's hypotheses —
**three of the four reported defects turned out to have a different cause than
assumed, or not to reproduce on this branch at all.**

Base: `feature/arena-rtt-overhaul` @ `95a41cb`. Branch:
`feature/arena-launch-polish`.

**Preserve the RTT overhaul entirely** — game direction, boss system, result
screen, roster dock, score semantics. This is polish, not a rewrite.

---

## 1. Theme delay — actual cause

**Measured, not guessed.** Playwright, isolated ports, real trusted clicks,
rAF-polled from click to first paint change.

| Surface | First change | Settle |
| --- | --- | --- |
| `/`, `/rankings` | **~25 ms median**, p95 60–68 ms | n/a |
| 82-0 candidate list (`.candidate-row-v3`) | 42 ms median | **96.5 ms median**, p95 108.5 ms |
| RTT choice buttons (`.rtt-choice-btn`) | 32–35 ms median | **67–71 ms median** |

**Ruled FALSE, with evidence:** account-preference API call (there is *no*
account preference — `setThemePreference` is localStorage + DOM only, zero
network calls anywhere in the path) · React over-rendering (only `ThemeToggle`
subscribes; the rest repaints via pure CSS custom-property cascade) · provider
remounting (there is no React context provider — `theme.ts` is a plain external
store) · delayed localStorage · alternate stylesheet · image/chart rerender.

**TRUE and reproduced:** six **base-state** rules transition colour-bearing
properties unconditionally, so a theme swap cross-fades instead of snapping:

```
globals.css:1057  .candidate-card-v2
globals.css:1088  .candidate-row-v3
globals.css:1302  .round-progress-dot
globals.css:1535  .spin-wheel-box
globals.css:1760  .rtt-choice-btn / .rtt-offer-btn
```

Gameplay screens settle **2.5–4× slower** than ordinary pages, bounded at
65–110 ms — at the edge of perceptibility, which fits "a pause" rather than "it
hung".

**FIX:** gate those six behind `:hover` / `:active` / `[data-state]`, as the
rest of the transition inventory already is. **No token or palette change.**
Do **not** add a global transition-suppression hack.

Also in scope: **33 `transition-all` usages** (Tailwind `transition-property:
all`, which the brief forbids) → replace with explicit property lists.

**Caveat carried honestly:** staging is not running this branch, so the user's
original report may *also* have been filed against a stale build. The effect is
independently real on current `HEAD`, so the fix is correct regardless.

## 2. Theme defaults

Today **every** user — new, signed-out, signed-in — resolves to `system`
(`theme-script.ts:54`, `theme.ts:56/137`). Target contract:

- New and signed-out users default to **Dark**.
- An explicitly saved **Light** preference wins.
- An explicitly saved **System** preference keeps following the OS.
- `System` is no longer the implicit default. All three remain choosable.
- Signed-in users use their stored preference.

The blocking pre-paint script and the resolver must change **together** — a
mismatch is exactly what produces a wrong-theme flash.

**Account preference does not exist yet.** Build it: apply to
`documentElement` synchronously, persist locally immediately, save to the
account **asynchronously in the background**, and **a failed account save must
never revert the visible theme.**

## 3. Light mode

Two causes, neither of which is "borders are too weak by the numbers" —
page/elevated/surface deltas measure *similar* in both themes (~1.16–1.17:1):

1. **Same-hue compression.** Every light surface is a beige at a different
   lightness, so they read as one material. Dark mode gets a cooler slate shift
   that light mode lacks.
2. **`--pk-elev-0..4` (`globals.css:376-380`) is defined once and never
   overridden for light**, and its own source comment admits it is "tuned for a
   dark theme". Shadows should be carrying elevation where borders are thin, and
   they aren't.

### Correctness bugs — fix these first, they are not palette opinions

- **82-0 court floor fades to black in light mode.** `.roster-board`
  (`globals.css:1446-1461`) ends
  `linear-gradient(180deg, var(--bg-elevated) 0%, #17130a 65%, #14110a 100%)`
  and `.roster-board-bench-row` (`:934-937`) runs `#14110a → var(--bg-surface)`.
  Hardcoded near-black stops, never made theme-aware. **This — not the slot
  styling — is why empty slots read as stark white blocks:** near-white cards on
  a floor that is still dark. Theme both gradients.
- **Rankings header is indistinguishable from data rows.** Both use
  `border-b border-[var(--border-subtle)]` (`RankingsTable.tsx:77` and `:126`),
  and light `--border-subtle` is `#ddd6c4` — **1.37:1** against `bg-surface`,
  under the 3:1 UI floor.

### Palette direction

Warm page background · distinct elevated surface · distinct recessed surface ·
stronger but **restrained** separators · dark ink hierarchy · gold as accent
only, never every border · subtle cool neutral for data-dense regions ·
intentional shadows only on elevated objects · accessible focus/selected states.

**Do not uniformly darken all borders. Do not invert Dark.** Strengthen
dividers *in data-dense regions specifically*, and add a second elevation cue
beyond lightness.

Every `--comp-*`, `--peak-accent` and the `-text` siblings from the previous
pass stay **byte-identical**. Contrast is measured, never eyeballed — the rule
from the previous pass holds: a token tuned for one theme must be re-measured
before reuse as text in the other.

## 4. Daily Grid

**Root cause is two compounding constraints**, not one:
`DailyGridGame.tsx:861` locks board + workbench into `lg:grid-cols-[1.05fr_1fr]`
*inside* a `max-w-6xl` (1152 px) container. The grid never exceeds 1152 px
regardless of viewport, and that space is then roughly halved in **every**
state — including after completion, where the 581-line `CompletionPanel`
occupies the same half-width slot. Measured: ~500 px of board at 1024 px
viewport (~145 px/square), only ~565 px at 1440 px, because `max-w-6xl` is the
real ceiling.

**De-risked:** completion state is already `localStorage`-backed and
refresh-proof (`progress` keyed by `board_id`). The modal restructure needs
**zero new persistence work.**

Before completion: grid centred and dominant, full width, labels legible,
search/candidates directly beneath or in a clearly associated lower panel, no
narrow independently-scrolling column when a wider layout is available, mobile
preserved.

After completion: grid stays centred and fully visible; a compact floating
trigger (e.g. `Near perfect · 746 / 766`) opens a modal (desktop) or bottom
sheet / full-screen dialog (mobile) that **overlays rather than compresses**;
closeable and reopenable. Inside, in order: score/max/percentage · **mini 3×3
score map that visually corresponds to the real nine cells** · biggest miss ·
optimal legal grid · streak and history · next-board countdown.

Focus trap · Escape closes · focus returns to trigger · no background scroll ·
reduced-motion support · refresh does not lose completion.

## 5. 82-0 placement

**The brief's two main hypotheses are false and must not be "fixed".** It is
already click/tap-only with no drag anywhere, fully keyboard-operable via real
`<button>`s, and legal targets already carry dashed borders plus explicit
"Place here" / "Swap here" / "Move here" labels. Selection state is visible.

**The four real gaps:**

1. **No preview before commit.** `handlePlace` / `handleSwap`
   (`CourtBuilder.tsx:161-164`, `:207-218`) fire the mutating API call the
   instant a destination is clicked. Add "Swap A ↔ B" confirmation where
   confirmation is useful.
2. **No undo** after a successful place or swap. Add an immediate Undo toast.
3. **Occupied slots are inert during initial placement** — `PeakCardCourt.tsx:338-350`
   renders them as a plain `<div>` with no handler, so clicking one does
   literally nothing with no explanation. **Sharpest gap.** Illegal destinations
   must remain visible but clearly disabled *with a reason*.
4. **The Move button is ~9 px** — under touch-target minimum on mobile.

Never silently replace a player without communicating who moves or leaves.
Preserve role legality. Click/tap and keyboard stay primary and complete; drag
remains absent and that is fine.

## 6. RTT entry — brief premise overturned, intent preserved

**There is no one-item dropdown.** `HeroLauncher`'s `BASE_OPTIONS` has two
unconditional entries and line `132` adds a third when a run is active — 2 or 3
items, never 1. The user's observation traced to the **stale deployed staging
build**, the same source as the theme-pause report.

**"Today's Run" is a genuinely different, implemented, tested rules contract, so
the brief's own "unless" clause says keep it:** `daily_seed()` is a pure sha256
of the date that *deliberately excludes the signing secret* so boards are
publicly reproducible (standard draws from `secrets`); the API forces
`seed=None` and bars a client-supplied seed for daily; there is a real partial
unique index `(owner_sub, run_type, run_date) WHERE run_type='daily'`; plus a
feature flag, idempotent re-entry, guest-claim branching on `run_type`, and
366-day archive replay that only works because the seed is date-derived.
**Deleting the UI would strand all of that and risk invalidating saved runs.**

**The intent is still valid and IS in scope:** the primary action must be a
direct action, not a menu.

- "Play Run the Table" starts Standard **directly**.
- If an unfinished run exists, the primary action becomes **"Continue Run"**.
- "Start New Run" and the daily become intentional **secondary** affordances.
- The daily keeps its `?mode=daily` start-gate routing — a bare link must never
  silently burn the day's attempt.

## 7. Leaderboard — root cause and status

**Root cause: environment contamination, not a duplication defect.** The API's
own test suite ran four times against the staging Postgres database. The eight
seeds `{102, 201, 202, 203, 301, 302, 401, 501}` match the literal in-file order
of every leaderboard-submitting test in `test_perfect_season.py`; seed 302 is the
only row with `respins=(1,0)` because the no-respin-filter test deliberately
creates one; `display_name="test"` is `_mint_test_jwt`'s default
`test@example.com` hitting the old email-local-part fallback.

**`game_id` UNIQUE idempotency works correctly** — 32 distinct games, not 32
resubmits. Client-side duplication, cursor repetition and mixed ruleset boards
are all ruled out on evidence.

**The actual hole — now closed (`e16c95a`):** `conftest.py`'s leak-guard fired
only in memory mode and never validated that a postgres-mode URL was isolated.
Two independent gates now fail at collection time, and the deployed API's own
`PEAK3_DATABASE_URL` is never read even as a fallback. Also established: neither
`api-integration-tests.sh` nor CI ever sets postgres mode, so this path is
reachable only from a deliberate local shell — **CI secrets are ruled out.**

**Remaining leaderboard work:**

- Remove the **"No-respin runs only"** filter from the public board — respins are
  normal Standard play. Frontend (`page.tsx:42,50,122-130`,
  `perfect-season-api.ts:241,247`) plus the `no_respin` param
  (`perfect_season.py:681`) and the two repo filters. Respin counts are already
  on the wire and already rendered per row — keep them as **metadata**.
- Add the tests the brief lists: same run twice → one entry; two runs → two
  entries; anonymous rejected; incomplete rejected; user B cannot mutate user A's
  entry; pagination has no duplicates; refresh does not resubmit; retry after
  timeout is idempotent.
- Cleanup SQL is drafted, validated against the local Docker stack with an
  appended `ROLLBACK`, and **checked in unexecuted** at
  `supabase/maintenance/`. Execution is an **EXTERNAL BLOCKER** — it needs
  `PEAK3_DATABASE_URL`, which the lead does not have and will not request.

**No writes to staging, for any reason, including verification.**

## 8. Public handle / username

`profiles` already exists (`20260630124500_identity.sql`) with `auth_sub UNIQUE`,
`handle` UNIQUE via a case-insensitive functional index, `display_name`,
`is_public`, `history_public`, timestamps — and is Postgres-backed on staging.

**Biggest finding: `profiles`, `user_settings`, `anonymous_subjects` and
`ownership_claims` have NO RLS at all**, unlike every table added since. That is
a live privacy gap sitting directly under the table this work extends. **Close it
first.**

Contract: `user_id` · `public_handle` · `normalized_handle` · optional display
name · visibility preference · `created_at` · `updated_at`.

Handle rules: unique case-insensitively · **3–20** chars (current regex allows
3–30 — tighten) · letters, numbers, underscores · reserved-word protection
(current check is exact-match only — add substring/impersonation guard) ·
MVP-appropriate profanity guard · stable validation errors · **no email, no
auto-published Google name.** Uniqueness enforced at the **database** layer.

Onboarding: prompt after first successful sign-in, explain it is what other
players see, prefill only a non-public suggestion, **do not block private
gameplay forever**, but **require a valid handle before public leaderboard
submission or public social features**. Editable later from Account settings
with a reasonable rename policy and clear confirmation. Existing handle-less
accounts prompted on next sign-in. **Leaderboards display only the public
handle.**

The email-local-part fallback is **already fixed in source**
(`perfect_season.py:613` → `profile.display_name or f"Player-{auth.sub[-6:]}"`).
Deployment status is **UNVERIFIED** and stays that way — confirming it would
require a staging write, which is denied.

RLS: users update only their own profile · public reads expose only intended
public fields · emails, provider metadata and private names stay private.
Test two-account collisions, case-insensitive collisions, reserved handles and
cross-user profile writes.

## 9. Contact / feedback

Nothing exists — the current `contact/page.tsx` is a static `mailto:` to a
deliberate `.invalid` placeholder.

Model it on the existing `telemetry_events` precedent (`api/v1/telemetry.py` +
`core/rate_limit.py`): dedicated `contact_submissions` table · **RLS denying
every PostgREST verb** · authenticated create · signed-out submissions only via
a rate-limited server endpoint with honeypot · never exposed through the client
DB key · capped message length · sanitized admin output · `request_id` echoed
back · timestamps · clear failure and retry states.

Fields: reason dropdown (new mode / improve mode / bug / question a ranking or
data point / accessibility / account or privacy / partnership or press / other) ·
relevant game mode when applicable · subject · message · optional reply email
for signed-out users · account association when signed in · consent note ·
confirmation state.

**Honest copy only — "Feedback received", never "we emailed you", because no
delivery service exists.** Add the footer/homepage invitation.

## 10. Navigation and homepage

Restrained refinement. **Play-as-primary hierarchy is already correct** — do not
restructure it. Improve active-route treatment, spacing and grouping, make the
theme control feel integrated rather than bolted on, improve account-menu
affordance, preserve compact height, improve mobile nav, keep keyboard and focus
excellent, add Contact to nav/footer.

Homepage: tighten spacing and typography, improve hero card animation and depth,
improve gallery scannability, make the leaderboard preview read as live, improve
the hero→catalog transition.

**No added explanatory copy. No fake usage counts, testimonials or social
proof.**

## 11. File ownership

| Owner | Files |
| --- | --- |
| `visual-platform` | `styles/globals.css` **(sole owner)**, `nav.css`, `home.css`, `rankings.css`, `lib/theme.ts`, `lib/theme-script.ts`, `components/ui/ThemeToggle.tsx`, nav + account-menu components, homepage, rankings table + profile drawer |
| `game-experience` | `components/daily-grid/**`, `components/court/**`, `CourtBuilder.tsx`, `PeakCardCourt.tsx`, `HeroLauncher.tsx`, RTT-entry routing |
| `identity-community` | `apps/api/**`, `supabase/migrations/**`, `supabase/maintenance/**`, profile/handle UI, contact route + UI |
| `lead` | `docs/implementation/launch-polish/**`, integration, shared-file conflicts |

`visual-platform` owns `globals.css` exclusively. The 82-0 court gradients live
there but are a **light-mode correctness fix** — `visual-platform` makes that
change; `game-experience` does not touch `globals.css`. Coordinate through the
lead.

## 12. Migration order

1. **conftest guard** — DONE (`e16c95a`). First, so nothing can refill the board.
2. **RLS on `profiles` / `user_settings` / `anonymous_subjects` / `ownership_claims`.**
3. **Handle/public-profile** schema additions.
4. **`contact_submissions`** table + route.
5. **Cleanup SQL** — checked in, executed only by an operator with credentials.

## 13. Standing constraints

No merge. No public deployment. No writes to staging. No change to the PEAK3
formula, ranking rows, RTT battle outcomes, authentication ownership rules or
Ranked configuration. No `transition: all`. No full-page remount on theme change.
No duplicate mutation requests. No layout shift from modal opening or image
loading.
