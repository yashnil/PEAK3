# Daily Grid, RUN THE TABLE v3, PvP, Security & Footer — Pass Report

Companion to `DAILY_RTT_PVP_SECURITY_PLAN.md`, which was written before any
writer agent edited a file. This report records what was actually built,
measured, and proved.

> **Status: in progress.** Sections are filled in as each workstream lands and
> is verified. Anything not yet verified is marked as such rather than
> asserted — a half-finished pass that says so is more useful than one that
> reads complete.

---

## 1. The stale-grid question, answered by measurement

The spec was explicit that the date label in the screenshot
(`2026-08-01 · TWO-WAY NIGHT`, "New board in 14h 19m") is *consistent* with the
current Pacific day, and that we should not assume the key itself was stale. It
listed seven candidate causes. We measured rather than guessed.

### 1.1 Generation is not stale

`grid_seed()` (`nba_peak/daily_grid/generator.py:246-255`) is

```
sha256("peak3-daily-grid:daily_grid.v2:<date>") % 2**31
```

— a pure function of the daily key, with no clock read, no randomness and no
I/O. Generated over 365 consecutive keys (2026-01-01 → 2026-12-31) from the
repo venv:

```
distinct seeds                    365 / 365
distinct sorted-criteria hashes   365 / 365
distinct board_ids                365 / 365
```

The three keys around the screenshot are completely disjoint:

| daily_key | seed | axes |
|---|---|---|
| 2026-07-31 | 1210089035 | `award_all_defense, team_det, era_2000s` × `comp_traditional_production, context_games_70, outcome_champion` |
| 2026-08-01 | 1218729072 | `era_2010s, pos_guard, context_mpg_36` × `outcome_missed_playoffs, team_sac, award_all_defense` |
| 2026-08-02 | 1210097203 | `team_por, team_okc, award_all_defense_first` × `outcome_conf_finals, era_2010s, context_games_70` |

So: not a stale daily key, not a stale seed, not identical board generation, not
an archived replay mounted as today, and not authenticated history substituted
for the current attempt. Six of the spec's seven candidates are ruled out by
measurement.

### 1.2 The theme *label* is the defect

`board_theme(rows, cols)` (`generator.py:403-430`) is a memoryless
first-match-wins ladder over the axis set, with no anti-repeat term and no
knowledge of the previous day. Over the same 365 keys:

```
adjacent-day identical theme            93 / 364  = 25.5 %
adjacent-day identical theme AND diff   42 / 364  = 11.5 %
3-consecutive-day identical theme       26 occurrences
longest identical-theme run             6 days (ending 2026-03-14, "Award Season")

Award Season      141 (38.6 %)
Franchise Icons    89
Two-Way Night      59
Ring Chasers       37
Playoff Pressure   31
Throwback Night     5
Modern Era          3
Open Court          0   ← unreachable
```

**2026-07-31 and 2026-08-01 are identical in both theme and difficulty**
(`Two-Way Night / easy`). The theme is the most prominent identity on the page,
rendered next to the date on the board screen and on the start gate.

**Root cause: theme-label collision on adjacent daily keys.** One day in four, a
genuinely-new board wears yesterday's headline. The user's report was accurate;
the mechanism was one layer above where it was being looked for.

Ten further Daily Grid defects were found (D1–D10 in the plan), two of them
higher-severity than the reported symptom and not previously known — see §3.

---

## 2. Ownership and IDOR hardening — P0 release blocker

Spec §7 gates PvP on this and says: *"Do not report completion while a known
mutable IDOR remains."*

### 2.1 What was found

Nine mutation routes violated *possessing an ID never grants mutation rights*.
Three were documented as knowingly-unfixed in
`AUTH_DAILY_BALANCE_REPORT.md:571-584`. **A fourth appears in no prior report
and was found by this pass's own audit.**

| # | Sev | Route | file:line | Before |
|---|---|---|---|---|
| S1 | P0 | `POST /draft/games/{game_id}/actions` | `draft.py:199-254` | no `auth`, no `Response`, no cookie in the signature at all |
| S2 | P0 | 7 × Perfect Season mutators (`select`, `cancel`, `respin-team`, `respin-season`, `place`, `swap-slots`, `complete`) | `perfect_season.py:244,267,290,318,342,365,401` | no identity |
| S3 | P0 | `GET /draft/challenges/{token}/comparison` (a **write**) | `draft.py:581-675`, `save_settlement` at `:673` | settled on a caller-supplied `recipient_game_id` |
| S4 | **P0, undocumented** | `POST /draft/challenges?game_id=…` | `draft.py:442-509` | minted from any completed game, storing the victim's lineup and `owner_sub` |
| S5 | P1 | RLS payload forgery, 4 tables + 1 child | `…190000:88`, `…090000:105,109`, `…150000:84`, `…180000:97` | owner `WITH CHECK` pins ownership, not payload; no `REVOKE` |
| S6 | P1 | unauth reads `GET /draft/games/{id}`, `GET /perfect-season/games/{id}` | `draft.py:187`, `perfect_season.py:231` | any id holder read a stranger's board |

S1 has the worst blast radius. On completion, `_record_completion`
(`draft.py:249-252`) writes a `ResultSnapshot`, a `DailyCompletion` under
`ON CONFLICT DO NOTHING` — **permanently burning the victim's daily attempt
with a lineup they never picked** — plus XP, personal records, achievements and
streak, all under the victim's `owner_sub`.

S4 chains with S3 into a lineup-exfiltration path: mint a challenge from a
stranger's completed game, then read their `challenger_snapshot` back out
through `/comparison`.

### 2.2 What was built

New `apps/api/app/core/ownership.py` — the rule stated once, tested once:

* `existing_owner_sub(auth, anon_cookie, signing_secret)` — verified JWT `sub`,
  else HMAC-verified `peak3_anon` cookie sub, else `None`. **Never mints.**
  This is the crux: `resolve_owner_sub` issues a fresh anonymous subject and a
  30-day cookie when the caller has none. That is right for a *creation* route
  and fatal for a *mutation* route, where it would hand the attacker a
  credential and then compare it against the victim's row.
* `assert_owns(resource_owner_sub, caller_sub, …)` — 403 unless both are
  non-`None` and equal. **Fails closed** on a null owner (a pre-ownership
  legacy row) and on a null caller (no credential presented).

403, not 404, follows the precedent already set at `run_the_table.py:189-194`
(`run_not_owned`); the two-tab idempotency behaviour depends on distinguishing
"not yours" from "gone", and game ids are unguessable UUIDs.

Applied through two hoisted gates so the check cannot be forgotten again:
`_load_owned_game` in `draft.py` and `_load_owned_lineup` in
`perfect_season.py`. The seven Perfect Season mutators now go through the same
path that `submit` (`:485`) and `save` (`:729`) already used correctly.

S3 now resolves the settling game through `_load_owned_game`, so a settlement
can only ever be written by someone who owns the game being submitted. S4
requires the minting caller to own `game_id`.

**Cookie transport was verified before designing the fix**, because an
ownership check is worthless if the browser never sends the credential: every
web API client already sets `credentials: "include"`
(`daily-grid-api.ts:55`, `perfect-season-api.ts:45`, `run-the-table-api.ts:47`,
`supabase/claim.ts:156`) and `main.py:107` sets `allow_credentials=True`.
Anonymous play is unaffected.

One robustness bug surfaced by the new tests was fixed alongside: `games.id` is
a real `uuid` column, so `GET /draft/games/doesnotexist` raised an asyncpg
`DataError` and returned **500** where it should return 404. `_is_uuid` in
`repositories/postgres.py` now treats an unparseable id as a miss — which
matters more now that these same lookups gate authorization.

### 2.3 S5 — proved against real Postgres

`20260801130000_peak_duel_results_revoke.sql` had already diagnosed this exact
bug and fixed it for one table: an owner-scoped RLS policy pins *ownership*, not
the *payload*. The fix was never extended to its four siblings, all created
after `20260630130100_default_privileges.sql:31-32` granted
`INSERT, UPDATE, DELETE` to `anon, authenticated` by default.

New migration `20260801140000_owned_results_revoke.sql`. Verified against the
running local stack (`supabase_db_PEAK3`, PostgreSQL 17.6, all migrations
applied, RLS on all 40 public tables):

**Before**

```
daily_grid_results        | anon          | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
daily_grid_results        | authenticated | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
perfect_season_run_cards  | anon          | DELETE,INSERT,…,UPDATE
perfect_season_runs       | anon          | DELETE,INSERT,…,UPDATE
perfect_season_saved_runs | anon          | DELETE,INSERT,…,UPDATE
run_the_table_runs        | anon          | DELETE,INSERT,…,UPDATE
  (and the same for `authenticated` on every row)
```

**After**

```
daily_grid_results        | anon          | REFERENCES,SELECT,TRIGGER,TRUNCATE
daily_grid_results        | authenticated | REFERENCES,SELECT,TRIGGER,TRUNCATE
perfect_season_run_cards  | …             | REFERENCES,SELECT,TRIGGER,TRUNCATE
perfect_season_runs       | …             | REFERENCES,SELECT,TRIGGER,TRUNCATE
perfect_season_saved_runs | …             | REFERENCES,SELECT,TRIGGER,TRUNCATE
run_the_table_runs        | …             | REFERENCES,SELECT,TRIGGER,TRUNCATE
```

A sweep of **2 roles × 5 tables × 3 operations = 30 write attempts** now raises
`insufficient_privilege` in all 30 cases. `SELECT` is deliberately preserved on
all five: the owner-read policies already narrow it to the caller's own rows,
and a blanket `REVOKE ALL` would have been the easy over-correction.

`run_the_table_runs` was the sharpest of the four — it granted **UPDATE on
`snapshot`**, the entire engine state blob, so server-authoritative play was
fully bypassable with the anon key that ships in the browser bundle.

### 2.4 Tests

`apps/api/tests/test_ownership_idor.py` — **16 adversarial tests, all passing.**
Kept out of `test_draft.py` / `test_perfect_season.py` on purpose: those files
test the game, this one tests the boundary, and a boundary regression should
name itself when it breaks.

Coverage against the spec's required list (§7):

| Spec case | Test |
|---|---|
| attacker with victim game ID | `test_attacker_with_victim_draft_game_id_cannot_act` |
| attacker with victim attempt ID | the 7-way parametrised Perfect Season sweep |
| challenge recipient mutation | `test_challenge_recipient_cannot_settle_with_a_game_they_do_not_own` |
| anonymous token swap | `test_credential_less_caller_cannot_act_on_a_draft_game` |
| forged user ID in payload | body `game_id` is cross-checked against the URL and identity comes only from a verified JWT or a signed cookie — never the body |
| replayed action | `test_replayed_action_stays_idempotent_for_the_owner` |
| stale action version | covered for RTT by the pre-existing `test_version_mismatch_is_409` |

Plus: both unauthenticated-read routes (S6), challenge minting (S4), and two
"the legitimate owner is unaffected" tests, so the gate cannot be declared
correct merely by refusing everyone.

Real-Postgres write-denial tests were added to
`apps/api/tests/integration/test_rls_policies.py`, whose entire existing body
was SELECT-only — before this pass **no test anywhere asserted that a client
could not write**.

Two test-harness notes worth recording, both of which initially produced 16
false failures:

* `with TestClient(app)` fires the app's lifespan handlers a second time. The
  session-scoped `client` fixture has already opened the asyncpg pool, so a
  nested lifespan opens another and closes the shared one on exit —
  `InterfaceError: pool is closed` for every subsequent test.
* A bare, un-entered `TestClient(app)` avoids that but drives requests on its
  own event loop while the pool's connections belong to the session client's —
  `RuntimeError: got Future attached to a different loop`.

The second player is therefore modelled by swapping the cookie jar on one
client, which is a faithful model of the threat anyway: for a guest, identity
*is* the `peak3_anon` cookie.

### 2.5 Regression result

```
PEAK3_DATABASE_URL="" pytest tests/test_draft.py tests/test_challenges.py \
                          tests/test_perfect_season.py tests/test_ownership_idor.py
405 passed in 103.75s
```

Zero regressions from the ownership changes.

### 2.6 A regression the ownership fix caused, and how it was found

Closing S1 broke Peak Draft practice, and **only the Playwright suite caught
it** — every API test passed, because `TestClient` keeps a cookie jar and the
real browser flow did not.

Two distinct causes, both invisible before the fix (a route that accepts anyone
does not care whether you identified yourself):

1. **`lib/draft-api.ts` never sent `credentials: "include"`.** It was the only
   API client in the app that didn't — `daily-grid-api`, `perfect-season-api`,
   `run-the-table-api`, `head-to-head-api` and `supabase/claim` all did. The
   `peak3_anon` cookie is therefore omitted cross-origin and every action on
   your own game returns 403.
2. **`/arena/practice/[mode]` was an async Server Component that created the
   board itself.** The API establishes ownership by setting the signed cookie
   on the *create* response; when the create runs on the Next server, that
   `Set-Cookie` lands on a server-to-server fetch and is discarded. The browser
   never receives a credential for the board it is looking at.

Peak Draft practice was the **only** surface with this shape. `/arena/daily/[mode]`,
`/c/[token]`, Daily Grid and RUN THE TABLE are all client components that call
the API from the browser, which is why they were unaffected.

Fixes: `credentials: "include"` added to `draft-api.ts`, and the board fetch
moved into a new client component `PracticeDraftLoader` (the page stays a
Server Component so `generateMetadata` and the invalid-mode `notFound()` are
unchanged). Verified: `gameplay.spec.ts` **35/35 passed with zero 403s**, having
been 25/35 with seven 403s.

Pinned against regression by `apps/web/src/tests/unit/api-credentials.test.ts`,
which asserts every cookie-scoped client sets the flag — and asserts each named
file exists, so a rename cannot silently empty the test. `progression-api` and
`ranked-api` are deliberately excluded (they use `Authorization: Bearer` on
`RequiredAuth` routes), as is `api.ts` (public routes only).

The general lesson is recorded because it will recur: **an ownership check and
the credential that satisfies it are one change, not two**, and only a real
browser exercises the second half.

### 2.7 A gap in this pass's own REVOKE migration

The head-to-head writer, verifying its own migration against real Postgres
rather than trusting the previous one's stated intent, found that all three
REVOKE migrations — `20260801130000` (previous pass), `20260801140000` (this
pass) and its own — named exactly `INSERT, UPDATE, DELETE` and therefore all
missed the same two privileges. Every owner-scoped table still reported
`REFERENCES, SELECT, TRIGGER, TRUNCATE` for `anon` and `authenticated`.

**TRUNCATE is a write that RLS does not filter.** Row-level policies constrain
which rows a statement may touch; TRUNCATE is a table-level operation that
removes every row regardless of any policy. A role holding it can erase a table
whose per-row policies are perfectly correct.

Stated honestly: PostgREST does not expose TRUNCATE, and these grants are only
reachable by a client that can open a direct Postgres connection as
`anon`/`authenticated`, which the deployed topology does not hand out. **This is
a defence-in-depth finding, not a live breach.** It is still worth closing,
because all three migrations argue that the REVOKE is the layer that fails
loudly — and that argument only holds for the privileges actually revoked.

`20260801170000_revoke_truncate_and_trigger.sql` closes it across all ten
owner-scoped tables. Verified against the local stack — every one now reports
only `REFERENCES, SELECT` (`telemetry_events` only `REFERENCES`, as it never had
SELECT).

### 2.8 Environment finding — the 104-failure baseline

The API suite was measured **before** any edit and produced
**104 failed, 942 passed, 1 skipped** in 14m19s. None of those failures is a
code defect. `apps/api/.env` points `PEAK3_DATABASE_URL` at the hosted Supabase
project whose password is stale — the condition
`AUTH_DAILY_BALANCE_REPORT.md:635-643` already flagged as needing an operator
refresh. The app connects, then fails mid-query, and several tests additionally
assert against in-memory repositories while the app is using Postgres.

Same suite against the running local stack, or with repositories forced to
memory as CI does, is clean. **Operator action: refresh
`PEAK3_DATABASE_URL`.** Until then, treat any full-suite run from a shell that
loads `apps/api/.env` as meaningless.

---

## 3. Daily Grid

### 3.1 The theme fix, measured

`docs/implementation/daily-grid-freshness-audit.json` (generated by
`scripts/audit_daily_grid_freshness.py`) covers **60 consecutive daily keys**,
2026-07-01 → 2026-08-29, each recording `daily_key`, `board_id`, `seed`,
`theme_id`, `theme`, `theme_candidates`, `difficulty`, `board_hash`, the full
row/column criteria ids, `starts_at` and `ends_at`.

| Metric | Before | After |
|---|---|---|
| adjacent-day identical theme | 25.5 % (93/364) | **0 % (0/59)** |
| adjacent identical theme *and* difficulty | 11.5 % | **0 %** |
| longest identical-theme run | 6 days | **1 day** |
| most common theme's share | 38.6 % (`Award Season`) | 23 % (`two-way-night`, 14/60) |
| themes reachable | 7 of 8 (`Open Court` never occurred) | **8 of 8** |
| distinct seeds / board hashes / criteria signatures | 365/365 each | 60/60 each |
| `unintended_duplicates` | — | `[]` |

Over a wider 1,100-key window the same holds: **0 / 1099** adjacent repeats,
largest theme share 20.1 %, `Open Court` at 4.7 %.

### 3.2 Why the repeat is now impossible rather than merely unlikely

`theme_candidates(rows, cols)` replaces the old first-match ladder: a board now
has a *ranked list of every description that is true of its axes*, ordered
rarest-predicate-first. Rarity ordering is what flattens the distribution, and
`Open Court` stopped being the unreachable no-match fallback and got a real rule
(the board is about who was on the floor).

`resolve_theme_id(date)` then publishes **the first description that was not
also true of yesterday's board**. Today's label is by construction *outside*
yesterday's candidate set while yesterday's own label is necessarily *inside*
it — so an adjacent repeat is structurally impossible, not statistically rare.
The ~10 % degenerate case (every description of today was also true yesterday)
resolves yesterday's actual label and steps past it, capped at 8 days of
lookback. The headroom this needs is guaranteed: the composition rules force at
least one team axis and two anchors, so every board has ≥2 true descriptions —
asserted as a test and as `min_theme_candidates: 2` in the artifact.

### 3.3 Independently verified by the lead

The writer's numbers were not taken on trust. Re-derived from scratch:

* **800-key sweep**: 0/799 adjacent repeats, 8/8 themes reachable, largest
  share 20.6 %.
* **Boards are bit-for-bit unchanged.** Criteria hashes for five sample dates
  were computed *before* any edit in this pass and re-computed after; all five
  match exactly.

```
OK  2026-07-20  ec6d83873928804b -> ec6d83873928804b   Throwback Night
OK  2026-07-31  e681d1fd86db90fa -> e681d1fd86db90fa   Two-Way Night
OK  2026-08-01  bcdff84fd6cbb8eb -> bcdff84fd6cbb8eb   Modern Era
OK  2026-08-02  2c0b428ff866dd3e -> 2c0b428ff866dd3e   Franchise Icons
OK  2026-08-19  835153e4f521fa3b -> 835153e4f521fa3b   Throwback Night
```

The exact pair from the screenshot went from `Two-Way Night → Two-Way Night` to
`Two-Way Night → Modern Era`. **The fix relabels; it changes no gameplay.**

### 3.4 Board response contract

```
GET /api/v1/daily-grid/board[?date=]
{ board_id, date, version, difficulty, theme, theme_id, board_hash, seed,
  rows, cols, cells, rules,
  daily_key, timezone, starts_at, ends_at, seconds_remaining, attempt_status,
  daily: { daily_key, timezone, starts_at, ends_at, seconds_remaining } }
```

Top-level window fields and the nested `daily` block come from **one**
`DailyWindow`, so they cannot drift apart. `board_hash` is
`sha256("peak3-daily-grid:board-hash:<version>|rows=<ids>|cols=<ids>")[:16]` and
is **order-sensitive** — rows and columns swapped is a different puzzle.

**On exposing `seed`.** The writer exposed it and relaxed one API assertion
(`seed` was in `FORBIDDEN_KEYS`) to do so. Because that is a security-relevant
relaxation, the lead verified it independently rather than accepting the
argument:

* `grid_seed` is `sha256("peak3-daily-grid:<version>:<date>") mod 2**31` with
  **no server secret** — confirmed by recomputing `2026-08-01`'s seed
  (`1218729072`) from first principles outside the codebase, and by grepping
  `generator.py` for `SIGNING_SECRET` (no hits).
* Any caller could therefore already compute the seed for any date, past or
  future, from published code. Publishing it adds nothing.
* Its only consumers are the axis sampler — whose output *is* the `rows`/`cols`
  already in the payload — and `_native_allowance`. Answer sets are
  (axes × the committed player pool); the pool is the withheld part and is not
  seed-derived.
* `attempts` stays forbidden, because it leaks how tightly constrained a board
  is.

The relaxation is sound and is recorded here rather than buried.

### 3.5 Server-authoritative timer

```
POST /api/v1/daily-grid/{daily_key}/start
200 { daily_key, started_at, server_now, elapsed_seconds, attempt_status }
409 { error_code: "not_todays_key", message, daily_key, today }
400 { error_code: "invalid_grid_date" }
```

Idempotent **at the database level**, not by convention:
`INSERT … ON CONFLICT (owner_sub, daily_key) DO NOTHING RETURNING *`, then read
back — so a double-click, a refresh and a second tab all resolve to the same
`started_at`. Deliberately not `DO UPDATE`: a restartable clock measures
nothing. There is no UPDATE path in the repository and no UPDATE policy on the
table.

New migration `20260801150000_daily_grid_attempts.sql`, applied to the local
stack and re-run to prove idempotency. Verified by the lead:
`UNIQUE (owner_sub, daily_key)` present, `relrowsecurity = t`, exactly one
owner-read SELECT policy and no write policy, and grants reduced to
`REFERENCES, SELECT, TRIGGER, TRUNCATE` for both `anon` and `authenticated` —
identical to its `daily_grid_results` sibling. Live role probes return
`permission denied` for INSERT, UPDATE and DELETE.

Tour time and page-load time are excluded because the clock starts only on this
call. `POST /official` now derives `elapsed_seconds` from `now - started_at`
when a server clock exists, falling back to the client number only for archive
replays and pre-`/start` clients.

### 3.6 Client behaviour

The start gate ships the spec's copy verbatim with three actions — **How to
Play**, **Start Timed Grid**, **Skip Tour and Start**. The board is deliberately
*not* previewed behind the gate: `CellPanel` is the only search surface and
mounts solely when a cell is selected, so rendering no board removes the
possibility of an overlay leaking rather than relying on a `pointer-events`
rule. Unit and e2e both assert the board, cells and search input are absent at
the gate. The cost is that first-run tour steps render centred with no
spotlight — `GuidedTour`'s documented degradation, and exactly what
`RunStartGate` already does.

The seven briefed tour steps reuse the existing `GuidedTour` and the versioned
multi-tour store; `TOUR_TARGET_IDS` was widened with `dg-*` ids so the RTT tour
compiles untouched, with a test asserting each tour aims only at its own prefix.
A permanent `?` control replays the tour without resetting the board or pausing
the timer — there is a test that advances a minute with the tour open and
asserts 5:00 → 6:00. The unversioned `peak3.daily-grid.rules-seen` key is now
**read-only legacy**; state moved to the versioned `peak3.tour.state`, and all
8 hardcoded e2e sites were migrated.

Three audited client defects are fixed:

* **D1** — a rollover with any board state now raises a non-modal prompt
  ("Play today's grid" / "Finish this board") instead of silently discarding
  work; the copy states honestly that finishing the old board will not extend
  the streak. An untouched board still swaps silently.
* **D2** — the `firedForRef.current = null` reset was deleted, so the guard is
  permanent per daily key and a new window object cannot re-arm the same fire.
  The regression test replays the audited scenario (clock a day ahead, ten
  refetches, ten new window objects) and asserts exactly one fire.
* **D6** — the board effect now clears `officialSavedRef` as well as
  `officialSaved`; the stale ref could also have suppressed the *new* day's
  save entirely.

`HowToPlay` was rebuilt on the canonical `Dialog`, which wires all five
`lib/a11y` primitives and already shares one `isTopLayer` predicate between
`useFocusTrap` and `useEscapeKey` — satisfying the contract at `a11y.ts:114-121`
that the hand-rolled version violated.

### 3.7 Known gap

The board response carries `attempt_status` but not `attempt_started_at` /
`attempt_elapsed_seconds`. Since `/start` is never called on page load, a player
resuming on a second device with status `in_progress` sees "—" on the timer
until their first move, at which point `/start`'s idempotent response restores
the true elapsed time (tested). Adding an elapsed field to the board response
would make the timer correct from first paint.

## 4. RUN THE TABLE v2 → v3

### 4.1 Constants

All in `nba_peak/run_the_table/config.py`, which is by explicit contract the
only place any tunable number lives.

| Constant | v2 | v3 | Why |
|---|---|---|---|
| `RULESET_VERSION` | `rtt_ruleset_v2` | `rtt_ruleset_v3` | mandatory |
| `ACTS` | 4 | **5** | auto-derives `DECISION_NODES` 8→**10** and `BATTLES` 4→**5** |
| `STARTING_LIVES` / `MAX_LIVES` | 3 / 3 | unchanged | already met the spec |
| `STARTING_CREDITS` | 50 | unchanged | already met the spec |
| `REST_CREDITS` | 12 | 11 | two more nodes ⇒ the deposit is taken more often |
| `BOSS_WIN_CREDITS` | 10 | 9 | one more battle; stays above comeback |
| `COMEBACK_CREDITS` | 8 | 6 | same |
| `FILM_CREDITS` | 10 | **deleted** | the single biggest income cut — deleted, not zeroed, so a stale client fails loudly instead of silently paying 0 |
| `DRAFT_GUARANTEED_AFFORDABLE_COST` | 10 | 8 | must stay ≤ `REST_CREDITS`, which is now the *only* income node |
| `BOSS_TARGET_STARTER_MEAN` | 4-tuple ending 74.5 | 5-tuple ending **76.5** | see §4.2 |
| new | — | `MARKET_REFRESH_COST=7`, `RESERVE_CARD_COST=5`, `ROLE_FOCUS_COST=6`, `EMERGENCY_RECOVERY_COST=20`, `MARKET_REFRESHES_PER_NODE=1`, `EMERGENCY_RECOVERY_MAX_PER_RUN=1`, `CREDIT_SINKS`, `SCOUT_CHOICES`, `SCOUT_PREP_LANE_BONUS=2.5`, `BOSS_LANES_TO_WIN` | — |

### 4.2 The fifth boss, and a target chosen by measurement rather than by ramp

**`the_long_series` — "The Long Series"**, act 5, with a new published rule
`BOSS_LANES_TO_WIN["the_long_series"] = 4`: four of five lanes are needed to win
outright, **for both teams**, and anything short is settled on total margin.
Symmetric by construction — one threshold compared against both lane counts.
`BOSS_RULE_PUBLISHED_THRESHOLDS` was updated in lockstep, and a test asserts
every rule is implemented by exactly one of the three mechanic tables and that
they stay disjoint.

The plan proposed continuing the 61/65/70/74.5 ramp to 78.0. **The writer
measured 78.0 and rejected it**: the best required policy cleared 12.5 % and
four of seven policies cleared 0.0 %. At 76.5 the spread is 0.8 %–28.3 %. The
ramp is therefore +4 / +5 / +4.5 / **+2.0**, with the smallest step last —
because the anchor slot has 28 eligible cards and none above 67.33, so every
lineup at that level, the player's included, is four strong cards and one weak
anchor. Measured starter mean **76.496 against a 76.5 target**.

That is the right way round: the plan proposed a number, the simulation refuted
it, and the number changed. Recorded here because the plan's 78.0 is now wrong.

Building the fifth boss also exposed a real bug in `generate_themed_boss`: its
±8.0 band around 76.5 contains **no** anchor-eligible card, so `_legal_lineup`
returned `None` on every attempt and the fallback raised on a pool that can
obviously field a lineup. Fixed by topping up any role the band cannot cover
with the closest-scoring eligible cards, rather than collapsing onto the whole
pool.

### 4.3 Determinism and version retirement

The keyed-stream contract is preserved: every new mechanic got its own stream
key, so no existing stream's output shifted. The market-refresh stream key is
literally the spec §6 formula, `seed + act + stage + node_type + refresh_index`.

v2 retires **gracefully rather than silently**. `TestVersionRetirement` asserts
by name that a saved `rtt_ruleset_v2` run raises `VersionMismatch` with
`changed_fields == ["ruleset_version"]` and a message naming both versions, that
no lenient path exists, and that `daily_seed` — salted by `RULESET_VERSION` —
differs from the v2 seed for the same date, so no stored v2 daily result can be
re-scored under v3 rules.

## 5. Film Room → Scout & Prepare

### 5.1 Before: proven dead content

Over 100 000 seeds × 6 policies in `run-the-table-balance-v2.json`:

| Policy | film_room pick rate | `scout_offers` chosen |
|---|---|---|
| lane_aware | **0.0 %** (zero times in 100 000 runs) | 0 |
| look_ahead | 5.5 % | — |
| greedy_overall | 8.7 % | **0** (69 455 × `take_credits`) |

A4's question — *can Film Room information change a later decision?* — answered
itself: no policy that could use it did. The node was a credit dispenser wearing
an information costume.

### 5.2 After

`node_type` stays `"film_room"` so an API/UI switch keeps resolving, but the
title is now "Scout & Prepare", the choices changed completely (a stale client
gets `unknown_choice`, not a silent different purchase), and **there is no
credit payout branch at all**.

* **A. Scout the Boss — free.** Returns the boss's rule, its two strongest
  lanes, its weakest lane and a per-lane projected matchup — plus a `would_flip`
  flag per lane telling the player *before committing* whether the 2.5-point
  preparation actually changes that lane's result. Then arms one capped,
  single-lane, single-battle bonus. Free by design: it is what keeps the node
  dead-end-proof for a broke player, exactly as `draft_pass` does at a Draft
  Room. A test asserts the projection agrees with a real `resolve_battle` on
  lane counts, margin and lane bar — so the scouting report cannot lie.
* **B. Shape the Market — 6 credits.** Guarantees ≥1 legal offer for a chosen
  role in the next market and reveals the next stage's boards. Verified over
  60 seeds × every market node × all 5 roles.
* **C. Reserve a Future Card — 5 credits.** Three deterministic candidates per
  node from a new `reserve:{node_id}` stream. Reserving locks today's price; the
  card appears in the next Draft Room and expires after it.

`generation.market_offers()` is the single place refresh, role focus and
reservation compose, in a fixed published order, and `state.node_offers()` is
what both the state machine's legality check and the API's render must call — so
what is displayed and what is legal cannot drift apart.

### 5.3 Credit sinks

| Sink | Price | Where | Limit | Rationale |
|---|---|---|---|---|
| Market Refresh | 7 | Draft / Trade | 1 per node | just under a mid-board card, capped so it cannot become a re-roll slot machine. The replacement board excludes the replaced board's identities, so 7 credits always buys a genuinely different market |
| Reserve a Card | 5 | Scout | 1 live at a time | cheaper than Role Focus because it commits you to one named card |
| Role Focus | 6 | Scout | next market only | keeps every card in that role live |
| Emergency Recovery | 20 | Rest / Bank | 1 per run | 40 % of the starting purse. **Additive** to the free `recover_life` at the same node (1 life → 3 in one visit), which is what makes it worth its price rather than a strictly-worse paid copy of a free option |

Neither Refresh nor Emergency Recovery resolves its node; both keep it open.

### 5.4 Measured effect

Film Room pick rate went from v2's 0.0 % / 5.5 % / 8.7 %-with-zero-scouts to
`look_ahead` **23.2 %**, `economy_aware` 17.5 %, `credit_spending` 18.0 %,
`film_aware` 17.1 %, `greedy` 9.1 % — and a preparation changes a **battle
outcome** 5.2–12.5 % of the times it is spent. `lane_aware` remains 0.0 % **on
purpose**: its node ranking was left exactly as v2 had it so the v2/v3 numbers
stay comparable, and the dead-content warning is now pooled across required
policies plus a second check that preparations are not inert.

**Honest finding:** `credit_spending` — the policy that uses every sink at every
opportunity — clears only 0.7 %. The sinks are priced as real costs, not free
value, and reserved cards go unbought about two-thirds of the time even under
lane-aware selection. That is a design outcome worth stating plainly rather than
hiding: buying everything is a losing strategy.

### 5.5 Balance sweep — 100 000 seeds × 8 policies

`docs/implementation/run-the-table-balance-v3.json`, produced by
`scripts/audit_run_the_table_v3.py --seeds 100000`.

```
PASS — 19 hard invariants held across 100000 seeds (800000 runs, 400 replay
checks). 0 soft warning(s).
```

Run shape recorded in the artifact: `acts 5, stages_per_act 2,
decision_nodes 10, battles 5, starting_lives 3, starting_credits 50,
lanes_to_win 3, boss_win_credits 9, comeback_credits 6, rest_credits 11,
scout_prep_lane_bonus 2.5`.

The spec required at least 100 000 seeds across seven named policies. All seven
ran, plus a `passive` control:

| Policy | clear rate | median credits left | share &lt;20 | Scout pick rate |
|---|---|---|---|---|
| random_legal | 0.06 % | 46 | — | 19.6 % |
| greedy_overall | 9.85 % | 15 | — | 8.9 % |
| lane_aware | 4.19 % | 12 | — | 0.0 %¹ |
| economy_aware | **27.36 %** | 26² | — | 17.2 % |
| look_ahead | 20.98 % | 13 | **77.8 %** | 22.9 % |
| film_aware | 5.44 % | 14 | — | 16.9 % |
| credit_spending | 0.66 % | 13 | — | 18.0 % |
| *passive (control)* | **0.00 %** | 82 | — | 19.6 % |

¹ deliberately unchanged from v2 so the two runs stay comparable — see §5.4.
² the bank strategy the spec explicitly carves out.

**The economy target is met.** The spec asks that a competent policy *usually*
finish with fewer than 20 credits unless deliberately banking. Every competent
policy now sits at a median of 12–15 (v2: only two of five did; `greedy` was 23,
`economy` 35, `random` 67, and the do-nothing control ended on 87.6 against a
50-credit purse). For `look_ahead`, unused credits are
`p10 7 · p25 9 · p50 13 · p75 19 · p90 25`, with **77.8 % of runs finishing
under 20**.

Spend fractions for `look_ahead`: **99.9 %** of runs spend at least half their
available credits, **89.7 %** at least 75 %, **28.0 %** at least 90 %.

Clear rate by spend band — the shape the design wanted:

```
0–25 %     0.00 %   (2 runs)
25–50 %    0.81 %   (124)
50–75 %   17.68 %   (10 139)
75–90 %   23.53 %   (61 755)   <- peak
90–100 %+ 16.64 %   (27 980)
```

Spending is rewarded; hoarding is punished; spending past ~90 % is *also*
punished. The sinks are a real trade-off rather than a tax or a giveaway.

Scout & Prepare effectiveness for `look_ahead`: 228 031 visits, 202 830
preparations actually spent, **44 256 flipped a lane** and **10 673 flipped a
whole battle** — a 5.3 % battle-flip rate on a node that in v2 the best policies
refused to visit at all.

Load-bearing sanity checks all hold: the passive control **never** clears (so
decisions matter), the best required policy at 27.4 % is far under the 60 %
dominance ceiling and well over the 10 % clearability floor, and the clear-rate
spread is 0.7 %–27.4 %.

**Process note.** The first 100 000-seed sweep was discarded, not reported: the
engine's `state.py` was modified at 11:21:53 while the sweep had started at
11:20:30, so its results could not be attributed to any one version of the code.
It was killed, the engine re-verified green at 309 tests, and the sweep re-run
from scratch against the final code.

### 5.6 API and UI

`SNAPSHOT_SCHEMA_VERSION` went 1 → **2** because the snapshot *shape* changed.
All nine new state fields round-trip, plus `BattleResult.lanes_to_win` /
`.lane_bonuses` and `LaneResult.player_prep_bonus` — each has a dataclass
default, so omitting them would have silently re-read a resolved battle as
"no preparation, three lanes".

Two real bugs were found and fixed while wiring the payload:

* `_active_node_public` read `plan.payloads[node_id]["offer_ids"]` directly, so a
  **paid** Market Refresh would have rendered the *original* board while the
  engine sold from the refreshed one. It now goes through `node_offers()` — the
  same accessor `action_draft_buy` validates against, which is what stops what
  is shown and what is legal from drifting apart.
* `payload["credits"]` on a film_room node became a hard `KeyError` → HTTP 500
  under v3, since Scout & Prepare has no payout branch.

**Reveal contract.** `reveal.roster` carries
`{revealed, total, complete, order[], revealed_slots[], next_slot, can_skip, remaining}`.
`order` is slot ids and labels only — no cards. `next_slot` is the
**authoritative preselected card**; the client animates to it and never rolls
it. `can_skip` is the server's `0 < revealed < total`, so skip-all is available
only after the first reveal, as the spec requires. Reveal progress lives in run
state, so a refresh resumes it. Reduced motion finishes on first paint.
`reveal.boss` is the same shape and is `null` — not an empty lineup — until
revealed, and is labelled in the UI as *"Seed and rule generated… not a team
being built live."*

Credit sinks surface with their live cost, limit and summary from the payload;
when locked they stay **visible** with the reason spelled out
(`insufficient_credits` / `refresh_limit` / `recovery_limit` / `lives_full` /
`role_focus_active` / `reservation_active` each get a distinct sentence). A new
tray "Armed" block shows the prepared lane, the focused role and the reserved
card's locked price — the three things whose credits are spent but whose effect
lands off-screen.

**v2 retirement, verified end to end.** All three gates fire as 409
`version_mismatch` with messages a player can act on, e.g.:

> This challenge link was created under the previous ruleset (rtt_ruleset_v2);
> the rules have since changed to rtt_ruleset_v3, so the same seed no longer
> produces the same board. Ask for a new link.

**Stale copy.** The previous pass had already been caught shipping "3 acts · 3
boss battles" after the v2 rebalance. The same class of drift was hunted again:
`page.tsx` metadata, `RunStartGate` (now reads `run_shape` from `GET /meta`
rather than hardcoding), `run-the-table-copy.ts`, and the `film_room` labels →
"Scout & Prepare". Four further sites outside the writer's ownership were
reported rather than silently edited, and the lead fixed them: `modes.ts`
("4 acts · 4 boss battles" → 5/5, "12–18 minutes" → "15–22 minutes"), the
homepage (×2), the arena index, and — the worst of them — the `film_room`
coachmark in `tour-steps.ts`, which still read *"First Film Room… Two choices…
bank the credits instead"* and **renders on screen**, describing a button v3
deleted. `RUN_THE_TABLE_TOUR_VERSION` was bumped 2 → 3 so returning players
re-see the corrected tour.

## 6. Asynchronous head-to-head

Nine routes under `/api/v1/run-the-table/h2h`, in a **purely additive** router.
Head-to-head runs are created through the existing `run_service.create_run` and
then **played through the existing RTT routes** — nothing in `run_the_table.py`,
`services/run_the_table/`, `nba_peak/**` or the RTT web files was modified. Only
`main.py` (+5), `dependencies.py` (+20) and `repository_registry.py` (+1) were
touched outside the new files.

### 6.1 `challenge_participants` was evaluated and rejected

The plan suggested reusing the dormant `challenge_participants` /
`challenge_settlements` tables. On inspection they were the wrong home, in
descending order of severity:

1. **`challenges_public_meta` is `FOR SELECT USING (true)`**
   (`20260630124900_rls.sql:76-79`) — the whole row, including
   `challenger_snapshot`, is world-readable through PostgREST with the anon key
   that ships in the browser bundle. Head-to-head is spoiler-safe by contract;
   storing it there would build the leak in at the storage layer, where no
   amount of application care can close it.
2. `challenges` is Peak-Duel-shaped: `board_id`, `mode`, `board_type`,
   `duration_years` are all NOT NULL with no RTT meaning. Filling them would be
   inventing data.
3. `challenger_snapshot` is NOT NULL and documented immutable at creation — but
   a head-to-head is created *before* the creator finishes.
4. There is no status, result, submission time or completion ordering.

New tables `head_to_head_matches` and `head_to_head_participants`. Neat detail:
the participants **primary key `(match_id, participant_sub)` is the not-self
rule** — the creator already holds a row, so their own accept collides. The 2026
challenges migration needed a trigger for this only because its challenger lived
in a different table.

### 6.2 Invite token

`kind = "run_the_table_h2h_invite"` — distinct from RTT's `"run_the_table"` and
from Draft's. All three share `PEAK3_SIGNING_SECRET`, so the `kind` check is the
only thing separating the namespaces; a test replays a **real, live** invite
value under three other kinds and gets 404 each time while the genuine token
still resolves.

Claims are exactly `{inv, ruleset, nonce, kind, exp}`. `inv` is 192 bits of
`token_urlsafe(24)`; the database stores only `sha256(inv)` and lookup is by
hash. **No match id, run id, or any other mutable resource id is in the token** —
asserted by test, satisfying the spec's "the invite must not expose mutable
resource IDs".

### 6.3 Fairness — pinned *and re-derived*, not assumed

`fairness_digest(blueprint)` pins all six spec §6 inputs: ruleset version,
starting starters, starting bench, both System offers, the boss sequence, and a
`node_signature` over every stage's options and payloads (i.e. all
offer-generation inputs). `assert_fairness` **re-derives it from the joiner's own
regenerated blueprint** at both accept and submission, so a card-pool rebuild
mid-match stops the match with 409 `fairness_mismatch` rather than silently
comparing two different games.

Tested by: both live runs asserted field-for-field identical; a tampered pin
rejected by name; and the refresh stream proven keyed — two independently
generated blueprints from one seed give the same refresh-1 board while refresh-2
differs, which is spec §6's `seed + act + stage + node_type + refresh_index`
demonstrated rather than asserted. Divergence and determinism are covered in one
test: two different policies on one seed produce different runs, and a third run
replaying the first's exact action list reproduces its signature byte for byte.

### 6.4 Winner order

`TIEBREAK_ORDER` **is** the ordering — `compare()` walks it and does nothing
else, so the code cannot drift from the published rule. Exactly spec §6:
table_cleared → bosses_defeated → final_act_reached → lives_remaining →
lane_differential → roster_peak3_total → credit_efficiency → active_play_time
(the only level where lower wins). Levels after the deciding one report
`not_consulted`. One test per level, each isolating that level.

**Published credit-efficiency rule** (`roster_total_per_net_credit_v1`, served
at `GET /h2h/rules` rather than left implicit):

```
net_credits_committed = credits_spent - credits_refunded
credit_efficiency     = roster_peak3_total / max(1, net_credits_committed)
```

Higher wins. It includes card spend *and* every v3 credit sink, so the sinks are
not free in the tiebreak; it excludes refunds (never committed) and
battle-awarded credits (an outcome, not management — counting them would
re-measure levels 1–5). The floor of 1 means zero spend scores best.

**Active play time** is `floor(last_action_at − created_at)`, both server-written.
Tutorial and landing time are outside the window by construction (the clock
starts at run creation), receipt-reading is outside it (it stops at the last
action), and a client-reported duration is never accepted — which satisfies the
spec's "tutorial time and network latency never count". Latency cannot be
subtracted, so it is neutralised instead: level 8 only decides when the gap is
≥ 2 seconds, and inside that band the match is a draw. **Stated limitation:**
idle time *inside* a run does count, because `RunAction` carries no timestamp
and the engine was frozen for this pass; the alternative was trusting a
client-reported duration, which is worse.

### 6.5 Adversarial results

All passing. Non-participant cannot read the match, submit, read the receipt or
offer a rematch (403 `not_a_participant`); a stranger cannot mint from your run
(403 `not_your_run` — the same shape as S4); anonymous cannot create (401).
**Cannot submit on the other participant's behalf**: every smuggling attempt
(`run_id`, `participant_sub`, `result`, `table_cleared`) is rejected at the
schema boundary with 422, and an honest submission resolves to the caller's own
run id. Invite security: forged → 404, broken signature → 404, expired → 404 on
both read and accept. Creator cannot accept their own invite (409); a third
player is refused (409 `match_full`); an invite holder cannot read or act on the
creator's run (403 `run_not_owned`).

Spoiler safety: the opponent is hidden and `/receipt` returns 409
`awaiting_opponent` until both submit, then both open at once. **The settlement
is written by the second submission, never by a read** — deliberately not
repeating Draft's `/comparison`-settles-on-GET shape, which was S3.

No daily consumption is proven end to end: the creator mints from a real daily,
the opponent accepts, the opponent's `/daily` still reports
`already_played: false`, their run is `run_type: "challenge"` on the same seed,
and their own daily is still available afterwards.

Two real defects were found by running this rather than asserting it: an RLS
policy that self-referenced and produced `infinite recursion detected in policy`
(rewritten to self-only, which is also the better rule), and
`ComparisonMetrics.run_id` leaking into the opponent's settled result — found by
the writer's own test and fixed with a `_public_result(..., own=False)` that
strips it.

## 7. Footer and beta information pages

A footer already existed but was two sentences of prose with **zero links**
(`apps/web/src/app/(main)/layout.tsx:12-23`). It is now a responsive
three-column `<footer>` (Play / Learn / Legal) with a `<nav aria-label="Footer">`,
stacked on mobile via `grid gap-8 sm:grid-cols-3`, the copyright year computed
at render rather than hardcoded, and the spec's NBA disclaimer verbatim. Both
original sentences are preserved and pinned by a test.

Five new pages follow the `(main)/about/page.tsx` convention exactly: `/terms`,
`/privacy`, `/accessibility`, `/contact`, `/data-sources`. Each opens with a
visible "beta draft — pending legal review" callout and carries a
`LEGAL REVIEW REQUIRED BEFORE PUBLIC LAUNCH` comment at the top of its source.

Every factual claim traces to the A7 code inventory. What the pages
**deliberately do not claim**, because it could not be verified from the repo:
hosting provider; exact Supabase cookie names; which auth providers are live on
any given deployment; any licence or permission from Basketball Reference; the
SMTP provider; and GDPR / CCPA / COPPA / SOC 2 or any other compliance posture.
The age-13 minimum is framed as a product choice, "not a statement about any
particular law".

Honest negatives are stated on-page rather than papered over:

* the telemetry opt-out is honoured (GPC, DNT, `peak3:telemetry`) but **has no
  UI control yet**;
* **no account deletion and no data export endpoint exist** — deletion is a
  manual request via `/contact`;
* the Daily Grid board is **Tab-order only, with no arrow-key roving tabindex**;
* no WCAG conformance level is claimed and no independent audit has happened.

"PEAK3 does not sell personal data" *is* asserted, because it is backed by a
verified fact: zero third-party analytics in `package.json` or `src/`.

Verification: `footer.test.tsx` 12/12 passed; `tsc --noEmit` clean;
`next lint` — "No ESLint warnings or errors".

`nav-model.ts` was deliberately **not** changed: `navModelIssues()` requires
every entry to carry a blurb, an icon key and a `MODE_COPY` mapping, which
"Terms of Use" cannot have, and footer links must not appear in a "which games
exist" listing. The `nav-model.ts:406` reachability invariant only walks nav
hrefs, so new routes cannot break it (nav suites still 71/71). `footer.test.tsx`
carries its own route-existence check instead, plus a guard proving that check
can fail — so the footer's link inventory is not the one list nothing verifies.

### Operator action required

`apps/web/src/app/(main)/contact/page.tsx` defines

```ts
const CONTACT_EMAIL = "TODO-set-before-launch@example.invalid";
```

No contact address exists anywhere in the repository, so none was invented. The
page detects the `.invalid` TLD and renders a "no contact address has been set"
block instead of a dead `mailto:`; setting a real address flips it
automatically. **`/privacy` (deletion requests), `/accessibility` (defect
reports) and `/terms` (security reports) all route users here, so until an
operator sets this, those routes are dead ends.**

---

## 8. Tests, audits and full suites

*(in progress — exact output for model, lineup, API, real-Supabase RLS, Vitest,
Playwright, typecheck, lint and production build is recorded here as each
completes)*

| Suite | Baseline (pre-pass) | Current |
|---|---|---|
| Vitest | 1089 passed / 39 files | **1238 passed / 45 files** |
| API full suite (memory repos) | — | **1183 passed, 1 skipped, 0 failed** (2m11s) |
| Playwright `gameplay.spec.ts` | 25/35 (after the S1 fix, before §2.6) | **35/35, zero 403s** |
| PvP (`test_head_to_head.py`) | did not exist | **51 passed** |
| API (with `apps/api/.env` as-is) | **104 failed** / 942 passed | environment, see §2.6 — unchanged, not a code defect |
| Model (`tests/`, excl. run_the_table) | — | **660 passed, 1 xfailed** (7m15s) |
| RTT engine (`tests/run_the_table/`) | 283 passed | **309 passed** |
| RTT API (`test_run_the_table.py`) | 51 tests | **97 passed** |
| Daily Grid API | — | **155 passed** |
| Daily Grid API vs **real local Postgres** | — | **136 passed** |
| Adversarial IDOR | did not exist | **16 passed** |
| Real-Postgres write denial | did not exist | **30/30 denied** |
| Balance sweep | 100k × 6 policies | **100k × 8 policies, 800 000 runs, 19/19 invariants, 0 warnings** |
| `tsc --noEmit` | clean | clean |
| `next lint` | — | **zero warnings** |

## 9. Playwright — and an honest note about the numbers

`gameplay.spec.ts`, run in isolation on freshly-killed ports:
**35 passed / 35, zero 403s** (it was 25/35 with seven 403s before §2.6's fix).
That run is the one that matters, because it is the suite that found the
regression and the one that proves it closed.

The **full** 334-test suite was run three times and did not produce a
trustworthy number, for an infrastructure reason rather than a product one:

| Run | Result | Cause |
|---|---|---|
| 1 | 237 failed / 97 passed | web server died mid-run; **and** the real §2.6 regression |
| 2 | 191 failed / 143 passed | **189 of 191 were `ERR_CONNECTION_REFUSED`** |
| 3 (daily-grid + RTT only) | 62 failed / 2 passed | **60 of 62 were `ERR_CONNECTION_REFUSED`** |

The screenshot-capture agent was running concurrently and competing for port
3000, repeatedly killing the dev server under the suite. `kill-ports.js` before
each run did not help, because the competing process reclaimed the port
afterwards. This is the same class of trap already recorded for this repo —
Playwright reuses an existing server on a fixed port, so a second thing on that
port silently changes what is under test.

**The full suite therefore needs one clean, uncontended re-run before this pass
is signed off.** It is listed in §10 as outstanding rather than reported as a
pass or a failure — 189 connection refusals are not evidence of anything about
the product, and quoting "191 failed" as a result would be misleading in the
opposite direction.

## 9a. What the browser verification found

35 frames in `docs/implementation/daily-rtt-pvp-review/` with a manifest;
**duplicate-MD5 check returns none**, so no filename is lying about its pixels.
29 frames on the production build; the 6 head-to-head frames need the e2e
test-auth channel, which is dead-code-eliminated under `NODE_ENV=production`,
so those ran against the dev server and are labelled `server: "dev-server"`,
`authMethod: "e2e-test-channel"` — deliberately not quietly mixed.

Everything in spec §10 is covered except **11, Table Clear**. Eighteen full
UI-driven runs across twelve fixed seeds all ended in an act. Nothing was staged
to fake one, and frame filenames are derived from the DOM's `data-outcome`, so a
filename cannot claim an outcome the engine did not return.

**The capture caught a release-blocking bug that every test suite missed.**

* **R1 (fixed here) — RUN THE TABLE never sent the bearer token.** `rttFetch`
  sent `credentials: "include"` and nothing else, but `resolve_owner_sub`
  returns the account's `auth.sub` **only** when an `Authorization` header is
  present, and otherwise falls back to the `peak3_anon` cookie. A signed-in
  player's runs were therefore filed under their *guest* subject. Invisible for
  as long as runs were only read back the same way — but head-to-head is
  account-backed, so `POST /h2h` compared the run's anon owner against
  `auth.sub` and returned 403 `not_your_run`. **PvP was unreachable end to
  end**, and a guest run claimed into an account became unloadable by the very
  browser playing it. Verified against the live API with curl before the fix.
  Fixed inside `rttFetch` rather than threaded through ~10 call sites, so no
  future caller can forget it.

  This is the *same bug class* as §2.6 — an ownership rule and the credential
  that satisfies it are one change — showing up a second time, in a second
  client, and again only findable in a real browser.

* **R2 (fixed here)** — `ChallengeCreator.tsx` and `InviteLanding.tsx` both
  linked to `/auth/sign-in`, which is not a route (the app's is `/signin`).
  Both PvP sign-in CTAs 404'd. `/signin` reads `next` through `safeNext`, so
  the redirect works now.

Reported and **not** fixed (below the bar for this pass, recorded so they are
not lost):

* **R3** `?run=` is ignored by the RTT route, so `MatchScreen`'s resume link
  does nothing; resume relies on a localStorage breadcrumb `accept` never
  writes.
* **R4** the opening reveal is spoiled — the tray already lists all seven
  players while the reel still says "1 OF 7 REVEALED".
* **R5** a fully-revealed reel never renders: `needsOpeningReveal()` unmounts it
  on the last card, so 6 of 7 is the maximum visible state.
* **R6** the five-act rail **clips its own last row**. `.rtt-zone-left` is
  `max-height: calc(100vh - 96px); overflow-y: auto`, and the 15-row v3 ladder
  overflows it — "ACT 5 BOSS" is cut mid-row at 1440×900 with no scroll
  affordance. It does not wrap and does not cause horizontal page overflow.
* **R7** the PvP receipt reads "PEAK3 player beat PEAK3 player." — both columns
  carry the same placeholder name.
* **R8** frame 20 shows "Challenge created…" directly above "No head-to-heads
  yet."
* **R9 (copy)** tour step 7 claims reopening the steps "cost you nothing", but
  the manifest's per-step clock readings show 0:00 → 0:03 across a replayed
  tour. True at the gate, false on replay.

Frames the lead opened and inspected personally — the Daily Grid start gate,
the mobile footer, and the five-act run map — are correct. The start gate
confirms the headline fix in the product itself: it reads
**"2026-08-01 · Modern Era"**, the exact date from the reported screenshot,
which was `Two-Way Night` on two consecutive days before this pass.

## 10. Limitations and outstanding items

**Outstanding verification**

1. **One clean full Playwright run** (§9). Everything needed for it is in place;
   it needs a machine with nothing else holding port 3000.
2. **Review screenshots**: 35 frames written to
   `docs/implementation/daily-rtt-pvp-review/` with a manifest, and the
   duplicate-MD5 check returns **0 duplicates** — so no frame's filename is
   lying about its pixels. Frames the lead opened and inspected personally:
   the Daily Grid start gate, the mobile footer, and the five-act run map. All
   three are correct. A full Table Clear and an early elimination were not
   reachable through a capture harness in the time available and are the two
   journeys from spec §10 with no frame.
3. **One accessibility violation is real and unfixed**: `[serious]
   color-contrast` on the Peak Draft Hold button
   (`accessibility.spec.ts:127`). It is pre-existing — nothing in this pass
   touched that button — but it is a genuine WCAG AA failure and is named here
   rather than left in a log.

**Operator actions required**

4. **`PEAK3_DATABASE_URL` in `apps/api/.env` carries a stale password** for the
   hosted project (§2.8). Until it is refreshed, any suite run from a shell that
   loads that file produces ~100 spurious asyncpg failures.
5. **`CONTACT_EMAIL` is a deliberate placeholder** —
   `TODO-set-before-launch@example.invalid`. No contact address exists anywhere
   in the repository, so none was invented. `/privacy` (deletion requests),
   `/accessibility` (defect reports) and `/terms` (security reports) all route
   users to `/contact`, so until an operator sets a real address those are dead
   ends. The page detects the `.invalid` TLD and renders an explicit "no contact
   address has been set" block rather than a broken `mailto:`.
6. **The new migrations are applied to the local stack only.**
   `20260801140000`, `20260801150000`, `20260801160000` and `20260801170000`
   were each verified against `supabase_db_PEAK3`; none was pushed to a hosted
   project.
7. **`supabase/migrations/MIGRATION_INVENTORY.{json,md}` is stale** — it
   predates all four new migrations. It is generated by
   `scripts/migration_inventory.py` and enforced by no test; regenerating it was
   left to an operator so it lands as one deliberate change.

**Product limitations**

8. **Daily Grid timer on a second device** shows "—" until the player's first
   move, because the board response carries `attempt_status` but not
   `attempt_elapsed_seconds` and `/start` is deliberately not called on page
   load. The idempotent `/start` restores the true elapsed time on that first
   move (tested). Adding an elapsed field to the board response would make it
   correct from first paint.
9. **Head-to-head active play time counts idle time inside a run**, because
   `RunAction` carries no timestamp and the engine was frozen this pass. It is
   the eighth and last tie-breaker and only decides when the gap exceeds 2
   seconds. The alternative — trusting a client-reported duration — is worse.
10. **`lane_aware` still picks Scout & Prepare 0 % of the time.** Its node
    ranking was deliberately left as v2 had it so the two balance runs stay
    comparable; the dead-content check is now pooled across the required
    policies plus a separate assertion that preparations are not inert.
11. **v2 RUN THE TABLE runs and challenge links retire rather than migrate.**
    They return 409 with a message explaining why. This is the documented
    intent of the version gate, not an oversight.
12. **`assert_owns` fails closed on a null `owner_sub`**, so any pre-ownership
    legacy game row becomes unmutatable. Every creation path sets an owner
    today, and games expire on their own, so this affects only rows that
    predate ownership.

## 11. Final git state

```
git branch --show-current   feature/daily-rtt-pvp-security
git log -1 --oneline        253a05a Add PEAK3 accounts, Pacific daily resets, and Run the Table v2
git stash list              (empty)
git diff --check            (clean)
git diff --stat             64 files changed, 8125 insertions(+), 644 deletions(-)
git status --porcelain      43 untracked
```

`HEAD` is the same commit it was at preflight, so nothing in this pass has been
recorded in history.

**No commit, push, pull request, merge, or stash occurred at any point in this
pass.** The working tree still points at the same commit it did at preflight;
the entire diff is unstaged and available for review.

No commit, push, pull request, merge, or stash has occurred at any point in this
pass. The full diff is unstaged.
