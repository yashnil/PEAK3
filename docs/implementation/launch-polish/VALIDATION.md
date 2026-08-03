# VALIDATION — launch polish

Every row is a measured result. `NOT RUN` and `FAIL` are acceptable entries; a
blank or an optimistic guess is not.

Branch `feature/arena-launch-polish`, from `feature/arena-rtt-overhaul` @
`95a41cb`. Not merged. Not deployed.

## Frontend

| Check | Result | Status |
| --- | --- | --- |
| Typecheck | clean | **PASS** |
| Lint, zero warnings | `✔ No ESLint warnings or errors` | **PASS** |
| Unit tests | **1385 passed across 55 files** (from 1355) | **PASS** |
| Production build | succeeds | **PASS** |
| `scripts/ci/frontend-verify.sh` end to end | `✓ Frontend verified` | **PASS** |

The last row is new. Before this pass the script **could not pass its own build
step**: `assertDeployableEnv()` refuses a localhost `NEXT_PUBLIC_API_URL`, and
both the script and `ci.yml:217` set exactly that. It now runs unmodified, with
no manual URL substitution.

## Backend

Running at time of writing — see the final report for totals.

## Regression guarantees

| Check | Result | Status |
| --- | --- | --- |
| Canonical ranking hashes (5 CSVs) | pending final run | |
| `peak3.py` diff | pending final run | |
| RTT battle outcomes untouched | no `nba_peak/run_the_table/battle.py` change in the pass diff | **PASS** |
| Ranked configuration untouched | no ranked flag changed | **PASS** |
| `transition-all` in production code | **0** (2 matches are comments explaining removal) | **PASS** |

## Theme — the headline defect

Measured with a **committed** harness (`measure-theme-switch.mjs`,
`measure-gameplay-theme.mjs`), which is itself a fix: the audit's before-numbers
came from an uncommitted script, so no honest before/after existed until now.

| Surface | Before | After |
| --- | --- | --- |
| `/`, `/rankings` | ~25 ms | unchanged — was already under target |
| 82-0 candidate list | **96.5 ms settle** vs ~25 ms first-change | settle now **numerically identical** to first-change |
| RTT choice buttons | **67–71 ms settle** | within 10–12 ms of first-change, inside noise |

**Root cause was not any hypothesis in the brief.** Ruled out with evidence: no
account API call in the path (there was no account preference at all), no
over-rendering (only `ThemeToggle` subscribes), no provider to remount, no
delayed storage, no alternate stylesheet, no chart rerender. The actual cause
was six **base-state** rules transitioning colour-bearing properties
unconditionally, so gameplay screens cross-faded instead of snapping.

**Instrument corrected twice before being trusted.** v1 imposed a ~64 ms
four-stable-frames floor that survived the fix and would have read as "not
fixed"; v2 hit a computed-style caching quirk. `game-experience` independently
hit the same floor class with its own harness and caught it by calibrating
against a surface already known clean, reaching **1.00× baseline**. Two agents,
two harnesses, one conclusion.

## Independently verified (writer ≠ verifier)

| Claim | Verifier | Result |
| --- | --- | --- |
| Failed account save never reverts the theme | game-experience | **PASS** — forced 500 on every save, three toggles, theme held; no rollback path exists in code |
| Dark default on clean storage | game-experience | **PASS** — incl. the critical OS=light → **dark** case |
| No wrong-theme flash / hydration warning | game-experience | **PASS** — all three preference states, hard refresh |
| Light mode is not an inversion | game-experience | **PASS** — elevation ordering holds per theme; light's tier deltas *larger* (0.068 vs 0.003); ΔE 3.0–7.7 on all three surface tokens vs a <2 suspicion threshold; 7/7 frozen tokens byte-identical; zero `filter: invert(` |
| Handle uniqueness at the DB layer | game-experience | **PASS** — real Postgres, raw SQL, actual constraint violations |
| No email or provider name on any leaderboard path | game-experience | **PASS** — traced end to end; zero `email` columns in any migration |
| 82-0 placement and swapping | lead | **PASS**, one deviation recorded (see below) |
| `auth_sub` column exposure | game-experience | pending re-verification |

## Defects found by verification, not by testing

Each would have shipped as complete.

1. **CI could not pass its own frontend gate.** Found by game-experience running
   the script verbatim; independently confirmed by visual-platform. I had hit the
   same failure in the previous pass and recorded it as an environment quirk
   rather than a defect — that was the error.
2. **The `auth_sub` fix did not exist.** Claimed twice — once in a design note,
   once as "folded into the handle work" — while the migration contained zero
   grant statements. Found adversarially.
3. **`theme_preference` was never added.** The live endpoint returned 200 and
   silently dropped the field, so the account-save requirement was unmet while
   appearing built. Found by curl against the running API.
4. **Daily Grid's 3×3 recap mis-located cells.** `result.cells` arrives in *fill*
   order, not board order — invisible to every test because fixtures happened to
   fill row-major.
5. **The active-route underline was invisible in light mode** at 1.29:1, using
   frozen `--peak-accent` directly. Third instance of that class across two
   passes.

## Recorded deviations

- **82-0 Move button is 32 px, not the project's own `--pk-tap-min: 44px`.** A
  3.5× improvement on the previous 9 px pill and clear of WCAG 2.5.8's 24 px,
  but below the stated floor. The card is `min-h-[72px]` and already carries a
  name, team/season line and fit badge. Accepted and written down rather than
  reported as "fixed".
- **Placement offers "Move", not "Undo"** — `state.py` has no un-place action.
  The weaker true label beats the stronger false one.
- **Reserved-word matching stays exact-match**, with a separate substring
  impersonation guard, because short entries like `me` would otherwise block
  `gamer`.

## Brief premises overturned on evidence

- **No one-item RTT dropdown exists** — `HeroLauncher` renders 2–3 items. The
  observation traced to the stale deployed staging build, as did the theme
  report.
- **"Today's Run" is a genuine mode**, so the brief's own "unless" clause keeps
  it: date-derived sha256 seed deliberately excluding the signing secret, API
  forcing `seed=None`, a real partial unique index, feature flag, guest-claim
  branching, 366-day archive replay.
- **82-0 was already click/tap-only and keyboard-complete** with labelled legal
  targets. The two headline hypotheses were false and were not "fixed".
- **The leaderboard had no duplication defect.** `game_id` idempotency works;
  32 rows were 8 fixture seeds × 4 test-suite executions against staging.

## External blockers

1. **Staging cleanup** — the reviewed SQL is checked in at
   `supabase/maintenance/`, validated against a local Docker stack with an
   appended `ROLLBACK`, and **not executed**. Needs `PEAK3_DATABASE_URL`.
2. **Staging redeploy** — staging still runs pre-RTT-overhaul code, which is why
   two reported defects were not reproducible on this branch.
