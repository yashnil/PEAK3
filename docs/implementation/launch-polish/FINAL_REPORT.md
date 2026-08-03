# FINAL REPORT — launch polish

Branch `feature/arena-launch-polish`, from `feature/arena-rtt-overhaul` @
`95a41cb`. **Not merged. Not deployed.**

**151 files changed, +8520 / −733.**

---

## 1. Root cause of the theme delay, and measured before/after

**Not any hypothesis in the brief.** Every candidate was ruled out with evidence:
no account-preference API call in the path (there was **no account preference at
all**), no React over-rendering (only `ThemeToggle` subscribes; everything else
repaints through the CSS custom-property cascade), no provider to remount
(`theme.ts` is a plain external store), no delayed `localStorage`, no alternate
stylesheet, no image or chart rerender.

**The actual cause:** six **base-state** rules transitioned colour-bearing
properties unconditionally, so a theme swap *cross-faded* instead of snapping —
and only on gameplay screens.

```
globals.css:1057  .candidate-card-v2      globals.css:1535  .spin-wheel-box
globals.css:1088  .candidate-row-v3       globals.css:1760  .rtt-choice-btn / .rtt-offer-btn
globals.css:1302  .round-progress-dot
```

| Surface | Before | After |
| --- | --- | --- |
| `/`, `/rankings` | ~25 ms — already under target | 26.0 / 33.8 ms |
| 82-0 candidate list | **96.5 ms settle** | settle **identical to first-change** |
| RTT choice buttons | **67–71 ms settle** | within 10–11 ms of first-change (noise) |

Also removed: **33 `transition-all`** instances. Production code is now at
**zero**.

**The instrument had to be corrected twice before it could be trusted.** v1
imposed a ~64 ms four-stable-frames floor that *survived the fix* and would have
read as "not fixed"; v2 hit a computed-style caching quirk. A second agent
independently hit the same floor class with its own harness and caught it by
calibrating against a surface already known clean. **Two agents, two harnesses,
one conclusion.** The harness is now committed at `scripts/perf/` — previously
the before-numbers came from an uncommitted script, so no honest comparison was
possible.

## 2. Daily Grid

**Two compounding constraints, not one:** `DailyGridGame.tsx:861` locked board
and workbench into `lg:grid-cols-[1.05fr_1fr]` *inside* a `max-w-6xl` (1152 px)
container. The board measured ~500 px at a 1024 px viewport and only ~565 px at
1440 px, because the ceiling — not the viewport — was the binding constraint.
Both removed.

Completion moved into a modal over the still-visible board, reached by a compact
floating trigger. Focus trap, Escape, scroll-lock and reduced-motion are
inherited from the existing shared `Dialog`. Completion state was already
`localStorage`-backed, so the restructure needed **zero new persistence**.

**Bug found while building it:** `result.cells` arrives in **fill order, not
board order**, so the 3×3 recap silently mis-located cells whenever a player
didn't fill row-major — invisible to every test because the fixtures happened to
fill in order.

## 3. Light mode

Two correctness bugs, fixed before any palette work:

- **The 82-0 court floor faded to black in light mode.** `.roster-board` and
  `.roster-board-bench-row` hardcoded `#17130a` / `#14110a` stops that were never
  made theme-aware. Near-white slot cards on a still-dark floor — **that
  combination, not the slot styling, was the "stark white blocks" report.**
- **Rankings' header was indistinguishable from its rows** — both used
  `--border-subtle`, measuring **1.37:1**, under the 3:1 UI floor. Now
  `--divider-strong` at 3.07–3.57:1 plus a header band.

Then: `--pk-elev-*` themed per mode (its own comment admitted it was dark-tuned),
and `--bg-surface-data`, a hue-differentiated panel rather than another lightness
step.

**Verified as genuinely non-inverted, by measurement:** elevation ordering holds
independently in each theme with light's tier deltas *larger* (0.068 vs 0.003);
Lab ΔE 3.0–7.7 across all three surface tokens against a <2 inversion threshold;
7/7 frozen tokens byte-identical; zero `filter: invert(`.

## 4. Leaderboard duplication root cause

**Environment contamination, not a duplication defect.** `game_id` idempotency
works correctly — all 32 rows were distinct games.

The API's own test suite ran **four times against the staging Postgres
database**. The eight seeds `{102, 201, 202, 203, 301, 302, 401, 501}` match the
literal in-file order of every leaderboard-submitting test in
`test_perfect_season.py`; **seed 302 is the only row with a respin because the
no-respin-filter test deliberately creates one**; `display_name="test"` is
`_mint_test_jwt`'s default `test@example.com` through the old email-local-part
fallback.

**The actual hole — now closed:** `conftest.py`'s leak-guard fired only in
*memory* mode and never validated that a postgres-mode URL was isolated. Two
independent gates now fail at collection time, and the deployed API's own
`PEAK3_DATABASE_URL` is never read even as a fallback. Also established: neither
`api-integration-tests.sh` nor CI ever sets postgres mode, so **CI secrets are
ruled out**.

Ruled out on evidence: repeated submission of one game · client-side row
duplication · cursor repetition · mixed ruleset boards.

## 5. Staging records eligible for cleanup

**32 rows**, identified by provenance rather than name — a real user could
legitimately choose `test`. The predicate is the conjunction of: one `owner_sub`,
`seed ∈ {102,201,202,203,301,302,401,501}`, `created_at` within
`2026-08-01T17:29Z…21:13Z`, `data_version=courtbuilder_team_year.experimental.v3`,
`mode=apex_1y`.

`supabase/maintenance/2026-08-01_cleanup_perfect_season_test_contamination.sql` —
a mandatory verification `SELECT` first, then an explicit 32-UUID `DELETE`, with
before/after counts. **Checked in, deliberately outside `migrations/`, and NOT
executed.** Validated end-to-end against a local Docker stack with an appended
`ROLLBACK`. Every UUID verified to appear exactly four times across the file.

## 6. Database constraints and idempotency

`game_id UNIQUE` was already correct and was **re-verified rather than trusted**.
The eight brief-specified tests were added: same run twice → one entry; two runs
→ two entries; anonymous rejected; incomplete rejected; cross-user mutation
rejected; pagination without duplicates; refresh doesn't resubmit; retry
idempotent.

The **"No-respin runs only" filter is removed** — respins are normal Standard
play and the filter was hiding legitimate runs. Respin counts remain as per-row
metadata.

## 7. Username privacy and RLS

**A retracted finding first.** The audit claimed `profiles` / `user_settings` /
`anonymous_subjects` / `ownership_claims` had *no RLS*. That was **wrong**, and
the author retracted it unprompted before writing a migration against it —
`20260630124900_rls.sql:6-9` has enabled RLS on all four since the initial
commit. Cost: one message. The alternative was a redundant security migration
shipped as closing a gap that was never open.

**The real gap, verified and closed:** `profiles_public_read` is
`FOR SELECT USING (is_public = true)` with **no column restriction**, and RLS is
row-level — so a public row exposed its *entire* row, including **`auth_sub`, the
raw Supabase identity**, to a direct PostgREST caller with the anon key.

Closed by `20260803120000_profile_column_privileges.sql`: `REVOKE SELECT ON
profiles`, then a column-scoped `GRANT` excluding `auth_sub` only.

**This fix was claimed twice while not existing** — once in a design note, once
as "folded into the handle work" — and both times the migration contained zero
grant statements. What made the third attempt credible: **the leak was
reproduced first** (`SET ROLE anon; SELECT auth_sub …` returned the raw value),
then fixed, then the same query re-run and confirmed denied.

Independently verified by a different agent against real Postgres: `auth_sub`
and `SELECT *` denied to anon, to a stranger, **and to the row's own owner** —
the case where a plausible-but-wrong implementation leaks. Safe columns still
readable; a private row's safe columns still invisible.

Handles: `normalized_handle` generated column with a unique index, 3–20 chars,
exact-match reserved words plus a substring impersonation guard with a leetspeak
fold (`adm1n`, `0fficial`, `supp0rt`, `peak_3` all blocked; `player123`,
`team07`, `b2b` unaffected). **Submission now requires a handle**, and the
persisted `display_name` is always `profile.handle` — which **supersedes** the
previous pass's gap #4 rather than building on it: the fallback concept is gone,
so no submission can persist an email-derived name whatever build is deployed.

## 8. Contact storage and spam protection

`contact_submissions`, modelled on the existing `telemetry_events` precedent:
RLS denying every verb via `FOR ALL USING(false)` **plus** an explicit `REVOKE`
(because `default_privileges.sql` auto-grants on every future table),
authenticated create, signed-out only through a rate-limited endpoint (3/10 min)
with a honeypot, capped length, `request_id` echoed, no `GET` route.

**One deliberate divergence from that precedent:** telemetry swallows storage
failures so it never fails a caller's real action — but a contact submission *is*
the caller's action, so a genuine DB failure surfaces as a **503** rather than a
false "accepted". Confirmation copy states plainly that no automated email
follows, because **no delivery service exists**.

## 9. 82-0 placement and swapping

The brief's two headline hypotheses were **false** and were not "fixed": it was
already click/tap-only with no drag, fully keyboard-operable through real
`<button>`s, with legal targets already carrying dashed borders and explicit
labels. None of that regressed.

The four real gaps: preview before commit (`Swap A ↔ B` confirmation) · undo
toast · occupied slots explained rather than inert · touch target grown from
~9 px to 32 px.

**Two honest labels worth keeping.** Placement offers **"Move", not "Undo"**,
because `state.py` has no un-place action — an Undo that doesn't undo teaches a
false model. And the **32 px target is below the project's own `--pk-tap-min:
44px` floor**; it clears WCAG 2.5.8's 24 px and the constraint is real (a 72 px
card already carrying three lines), so it is **recorded as a deviation rather
than reported as fixed**.

**My own verification of this was wrong and is corrected in the record.** I
confirmed both branches of `blockedDuringPlacement` existed and reasoned about
the trade-off — without checking which branch actually renders. `onMove` is live
once any slot is filled, so **the accessible explanation reached a real player
almost never**. Caught by the implementer's own e2e test, not by my source read.
A source read confirms code exists; only running it confirms code runs.

## 10. RTT direct entry

**The brief's premise did not hold.** `HeroLauncher` renders 2–3 items, never 1
— the one-item dropdown was the **stale deployed staging build**, the same
source as the theme-pause report.

**"Today's Run" was kept**, because the brief's own *"unless it has a genuinely
different, implemented and tested rules contract"* clause is satisfied: a
date-derived sha256 seed **deliberately excluding the signing secret** so boards
are publicly reproducible, the API forcing `seed=None` and barring a
client-supplied seed, a real partial unique index
`(owner_sub, run_type, run_date) WHERE run_type='daily'`, a feature flag,
guest-claim branching, and 366-day archive replay that only works *because* the
seed is date-derived. Removing the UI would have stranded that and risked
invalidating saved runs.

The **intent** was implemented: the primary CTA is now a plain link straight to a
standard run, becoming **"Continue Run"** when one exists, with "Start New Run"
and the daily as intentional secondary affordances. The daily keeps `?mode=daily`
start-gate routing — a bare link must never silently spend the day's one attempt.

## 11. Test totals

| Suite | Before | After |
| --- | --- | --- |
| API unit | 1221 | **1278 passed / 0 failed** |
| Model | 955 | **955 passed / 0 failed** |
| Frontend unit | 1355 | **1385+ passed / 0 failed** |
| Typecheck · Lint | clean · 0 warnings | clean · **0 warnings** |
| Production build | — | **succeeds** |
| `frontend-verify.sh` end-to-end | **could not pass** | **`✓ Frontend verified`** |
| axe accessibility | — | **13/13, 0 violations** |
| Playwright full suite, zero retries | — | **348 passed / 0 failed** (21.2 min, clean run) |
| Canonical hashes (5 CSVs) | — | **identical** |
| `peak3.py` / `battle.py` diff | — | **empty** |

## 12. Remaining blockers

1. **Staging cleanup execution** — reviewed SQL checked in and validated, needs
   `PEAK3_DATABASE_URL`, which the lead does not have and did not request.
2. **Staging redeploy** — staging still runs pre-RTT-overhaul code. This is
   *why* two reported defects were not reproducible here, and until it is
   redeployed the hosted surface will keep disagreeing with the branch.

## 13. Defects found by verification, not by testing

Each would have shipped as complete work.

1. **CI could not pass its own frontend gate.** `assertDeployableEnv()` refuses a
   localhost API URL; both the script and `ci.yml:217` set exactly that. I had
   hit this in the previous pass and recorded it as an *environment quirk* —
   that was the error.
2. **The `auth_sub` fix did not exist**, claimed twice.
3. **`theme_preference` was never added** — the live endpoint returned 200 and
   silently dropped the field, so the account-save requirement was unmet while
   appearing built.
4. **Daily Grid's recap mis-located cells** (fill order vs board order).
5. **The active-route underline was invisible in light mode** at 1.29:1.
6. **The occupied-slot explanation was unreachable in real play** — and my own
   verification had passed it.

A seventh was **revealed, not introduced**: `--accent-violet-text` failed at
4.42:1 on a wash of itself in **dark** mode. `git log -S` dates the bad value to
the *previous* pass's own P6-b fix, which measured light's wash contrast but not
dark's. This pass's Dark-by-default change simply made that path render for the
first time — Chromium's unemulated default is light, verified directly.

## 14. Confirmations

- **PEAK3 formula unchanged** — `peak3.py` diff empty.
- **Ranking rows unchanged** — all five canonical CSV hashes identical.
- **RTT battle outcomes unchanged** — `battle.py` diff empty.
- **Authentication ownership rules unchanged** — no weakening; RLS strengthened
  by a column-privilege tightening, independently verified.
- **Ranked configuration untouched** — zero ranked flags changed.
- **No secrets committed** — the one flagged literal is a pre-existing
  test-only HS256 value named `do-not-use-in-prod`, introduced in `6ebb4d5`;
  the only `.env` touched is `.env.example`, a template, and the real `.env`
  is gitignored.
- **No `console.*`** added to shipped frontend code.
- **Not merged to `main`. Not deployed.**
