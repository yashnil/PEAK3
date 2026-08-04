# PEAK3 Multiplayer Arena — Implementation Contract

Status: **DRAFT — Phase 1 (audit) in progress.** Implementation is blocked until the
lead approves this document.

---

## 1. Verified preconditions (recorded before any edit)

All four required checks were run in `~/Desktop/PEAK3` before a single file was
created or modified.

| Check | Command | Result |
| --- | --- | --- |
| Starting branch | `git branch --show-current` | `feature/multiplayer-arena-foundation` ✅ required branch |
| Working tree | `git status --short` | *(empty output)* ✅ clean |
| HEAD commit | `git log -1 --format='%H %s'` | `9bb5326531f0cc4c1a81aee777f65c61fea3ac22` — `Merge pull request #10 from yashnil/chore/production-deployment` |
| Baseline ancestry | `git merge-base --is-ancestor 9bb5326531f0cc4c1a81aee777f65c61fea3ac22 HEAD` | exit `0` ✅ HEAD descends from the required baseline |

Notes:

- **Full starting commit hash:** `9bb5326531f0cc4c1a81aee777f65c61fea3ac22`
- **Commit date:** `2026-08-03T20:51:57-07:00`
- HEAD is *identical to* the required baseline commit, so the ancestry
  requirement is satisfied trivially (a commit is an ancestor of itself).
- **Working tree state at start:** clean — no staged, unstaged, or untracked
  changes.
- No stop condition was triggered; implementation may proceed once this
  contract is approved.

### 1.1 Worktree naming

`git worktree list` showed a single worktree (the primary checkout). The
following branch names already exist in the repository from previous passes and
are **explicitly not reused**:

```
wt/arena-platform   wt/arena-rtt   wt/arena-score
wt/lp-game          wt/lp-identity wt/lp-visual
```

New, uniquely named worktree branches for this pass:

| Teammate | Worktree branch |
| --- | --- |
| multiplayer-platform | `wt/mp-platform` |
| three-man-weave | `wt/mp-three-man-weave` |
| twenty-dollar | `wt/mp-twenty-dollar` |
| rtt-balance-integrity | `wt/mp-rtt-balance` |
| competition-security | `wt/mp-competition-security` |

### 1.2 Standing constraints for this pass

- Do **not** merge to `main`. Do **not** deploy publicly.
- Do **not** enable the existing Ranked mode.
- Do **not** change the canonical PEAK3 formula, `OFFICIAL_WEIGHTS`,
  `calibrate_score()`, `leaderboards/*.csv`, ranking rows, player component
  values, or existing 82-0 scoring outputs.
- Do **not** alter the existing 82-0 lineup evaluator; extend it through a
  versioned adapter only.

---

## 2. Audit findings

### 2.1 CI matrix — root cause (CORRECTS A PREMISE IN THE BRIEF)

The brief states that the final pull request to `main` "displayed only Vercel and
Railway checks rather than the complete project CI matrix." **That is not what
happened.** Evidence from the GitHub API:

- `.github/workflows/ci.yml:3-7` already declares the correct trigger:
  ```yaml
  on:
    push:
      branches: [main]
    pull_request:
      branches: [main]
  ```
- PR #10 ran CI run `30875554663` (event `pull_request`, branch
  `chore/production-deployment`) — **completed success in 37m37s**.
- The PR's check rollup contained **ten** checks, not two: eight CI jobs plus
  `Vercel` and `Vercel Preview Comments`. Railway posted **no** check at all.

All eight CI jobs reported success:

| Job | Result |
| --- | --- |
| Python model tests | success |
| Experimental lineup model tests | success |
| Build web dataset + card profiles v3 | success |
| Board generation smoke check (225 seeds × 3 modes) | success |
| FastAPI unit tests (in-memory repositories) | success |
| Frontend (typecheck, lint, unit tests, production build) | success |
| Playwright browser tests + axe accessibility (0 retries) | success |
| Supabase integration tests (ranked release gate) | success |

Most plausible explanation for the reported observation: Vercel posts its checks
within roughly a minute, while the CI matrix takes ~37 minutes. A PR inspected
shortly after opening shows only the deployment checks.

#### The real defect (genuine, and worse than a missing trigger)

The matrix is **incomplete, and one job is a green no-op that is visually
indistinguishable from a real pass.**

1. **`supabase-integration` passes without executing a single test.**
   `.github/workflows/ci.yml:326-338` gates on a secret:
   ```yaml
   if [ -z "${{ secrets.PEAK3_TEST_SUPABASE_URL }}" ]; then
     echo "configured=false" >> "$GITHUB_OUTPUT"
     ...
     echo "::warning::Supabase integration tests skipped — not configured."
   ```
   Every subsequent step carries `if: steps.check.outputs.configured == 'true'`
   (lines 341, 347, 353). The secret is not set, so the confirmed log output for
   run `30875554663` is:
   ```
   ##[warning]Supabase integration tests skipped — not configured.
   ```
   The job nonetheless reports **SUCCESS**. Consequently **real-PostgreSQL
   integration tests and Supabase/RLS tests have never run on any pull request**,
   while the PR page displays a green check whose name asserts that they did.

2. **Migration validation has no job and no script.** `scripts/ci/` contains
   `api-integration-tests.sh`, `api-unit-tests.sh`, `build-web-data.sh`,
   `e2e-tests.sh`, `frontend-verify.sh`, `lib.sh`, `lineup-tests.sh`,
   `model-tests.sh`, `preflight-config.sh` — nothing validates
   `supabase/migrations/MIGRATION_INVENTORY.json`.

#### Required correction (strengthens checks; weakens none)

- ~~Add a **real Postgres integration job** backed by a `services: postgres:`
  container so DB-backed repository tests execute on every PR with **no secrets
  required**.~~ **RETRACTED — this recommendation was wrong.** Measured against
  `postgres:17` in Docker with the chain applied in filename order under
  `ON_ERROR_STOP=1`: **19 of 35 migrations fail.**
  ```
  ERROR:  schema "auth" does not exist      (14 files — every RLS migration)
  ERROR:  role "anon" does not exist        (every GRANT/REVOKE migration)
  ```
  Fourteen migrations write policies against `auth.uid()`; the privilege
  migrations GRANT/REVOKE to `anon`/`authenticated`. **No migration in the chain
  creates the `auth` schema, `auth.uid()`, or those three roles** — Supabase
  provisions them. A bare Postgres container therefore cannot run this suite.

  A bootstrap file faking an `auth` schema and a hand-written `auth.uid()` was
  **deliberately rejected**: `test_rls_policies.py` exists to prove the *real*
  policies behave correctly, and pointing it at an invented `auth.uid()` would
  make it prove the fixture works instead. A test that validates its own fixture
  is worse than no test, because it is green — which is the exact defect being
  fixed. Splitting the suite was likewise rejected as a split by convenience
  rather than by real dependency: only `test_auth_flows.py` needs GoTrue over
  HTTP, but `test_rls_policies.py` and `test_migrations.py` still need Supabase's
  roles and `auth.uid()`, so the notional "DB-only" half is not runnable on bare
  Postgres either.

  **Actual solution: `supabase start` in CI.** One local stack runs all 95 tests,
  no secrets required.
- Keep the hosted-Supabase job for RLS, but its unconfigured state must **stop
  reporting success**. A check that skips must not be green.
- Add a **migration-validation job** plus the `scripts/ci/` script it calls.
- Retain every existing job and assertion unchanged.

### 2.2 Data foundation — verified available and committed

Verified directly against committed data (no network):

| Artifact | Content | Status |
| --- | --- | --- |
| `data/game/experimental/player_pool_1500/all_seasons_for_identities.v1.json` | 1,390 identities, 13,618 player-season rows, 1979-80 → 2025-26, 44 team codes; fields `player_slug`, `player`, `season`, `team`, `season_end`, `games_played`, `position`, `is_multi_team_row`, `score_status` | committed |
| `data/game/experimental/player_pool_1500/traded_player_team_stints.v1.json` | per-team splits for the 1,363 multi-team (`2TM`/`3TM`) rows | committed |
| `cache/processed/scored_1980_2026.parquet` | 11,429 player-seasons × 176 cols incl. per-season `prime_score`, `prime_index`, `team`, `season_start` | committed via `.gitignore:15-18` negation patterns |
| `nba_peak/perfect_season/positions.py`, `career_positions.py` | three-tier canonical position model with a load-bearing games/minutes gate | source |
| `nba_peak/lineup/` | the authoritative 82-0 evaluator (`scoring`, `solver`, `synergy`, `talent`, `receipts`, `coverage`, `board`, `config`, `schemas`) | source |

Franchise-decade eligibility is therefore computable **offline**. Both worked
examples from the brief verify exactly:

- `kawhi-leonard` × `TOR` × 2010s → `2018-19`, SF, 60 GP ✅
- `isaiah-thomas` × `BOS` × 2010s → `2015-16` (82 GP), `2016-17` (76 GP), PG ✅

Position constraints from the brief also verify:

- `shaquille-o-neal` listed-position set = `{C}` → cannot play SF ✅
- `lebron-james` listed-position set includes `PG` ✅
- 727 of 1,390 identities carry more than one listed position (multi-position
  repositioning is meaningful, not a rare edge case).

Distinct listed position values in the committed data: `PG`, `SG`, `SF`, `PF`,
`C`, plus a single stray `F` row (1 of 13,618) that the ingest layer must map or
reject explicitly rather than silently drop.

### 2.3 CI root cause — CORRECTED

An earlier draft of this document claimed the CI matrix ran on the final PR and
that the reported observation was a timing artifact. **That was wrong**, and the
correction is the actual root cause.

`pull_request.branches: [main]` filters on the PR's **base** ref. The PRs that
showed only deployment checks were **stacked onto non-main bases**:

```
PR #9   base=feature/arena-rtt-overhaul     head=feature/arena-launch-polish
PR #8   base=chore/production-deployment    head=feature/arena-rtt-overhaul
PR #10  base=main                           head=chore/production-deployment
```

Observed checks:

| PR | Checks |
| --- | --- |
| #9 | Vercel, Vercel Preview Comments, Railway — **nothing else** |
| #8 | Vercel, Vercel Preview Comments — **nothing else** |
| #10 | all 8 CI jobs + Vercel |

`gh run list` shows **zero** runs for `feature/arena-rtt-overhaul` and
`feature/arena-launch-polish`. Vercel and Railway are GitHub App integrations
that fire on branch push irrespective of base, which is why they were the only
checks visible on the stacked PRs. That asymmetry is the entire observed effect.

Supporting facts, all verified: the YAML parses; `ci.yml` is tracked, not
ignored, identical to `origin/main`; Actions are enabled
(`allowed_actions: all`); the workflow is `active`; there are no `paths:`
filters, no job-level `if:`, no `continue-on-error`, no matrix.

**A PR from `feature/multiplayer-arena-foundation` → `main` will run all 8 jobs
with no YAML change.**

Three genuine defects remain:

1. **`main` has no branch protection.** `gh api repos/yashnil/PEAK3/branches/main/protection`
   → 404 "Branch not protected". Nothing is *required*; CI is advisory.
2. **`supabase-integration` is a green no-op.** It ran in **5 seconds** on PR #10.
   `ci.yml:326-338` gates on `secrets.PEAK3_TEST_SUPABASE_URL`; every real step
   carries `if: steps.check.outputs.configured == 'true'` (`:341,347,353`). All
   95 RLS/integration tests skipped; job reported pass. **Any RLS work landed on
   that signal is unverified.**
3. **Migration validation never runs.** `scripts/validate_migrations.py` and
   `scripts/migration_inventory.py` both exist and are invoked by nothing
   (`grep -rn "migration_inventory" .github/ scripts/ci/ Makefile` → no matches).

### 2.4 Evaluators — THREE exist, and they are distinct

An earlier draft called `nba_peak/lineup/` "the authoritative 82-0 evaluator."
**Wrong on both halves.**

| Evaluator | Path | Used by |
| --- | --- | --- |
| 82-0 Peak Season | `nba_peak/perfect_season/simulation.py` (`TOTAL_GAMES = 82`, `:46`) | CourtBuilder / Peak Season |
| Lineup rating | `nba_peak/lineup/scoring.py` (`talent*w + coverage*w + synergy`; contains no "82") | Peak Draft |
| RTT battle | `nba_peak/run_the_table/battle.py` (`resolve_battle`, `:198-347`) | Run The Table only |

RTT imports **neither** of the other two; every `nba_peak.lineup` string inside
`nba_peak/run_the_table/` is a prose comment.

**The 82-0 evaluator for the Three-Man Weave adapter is
`simulate_exact_season` (`simulation.py:1134`)**, not `simulate_season`
(`:262`). `config.py:198` sets `COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED = True`;
the comment at `simulation.py:288-291` claiming the flag defaults off is stale.

Verified by execution at n=5..8: the simulator is **N-agnostic** and returns a
complete receipt for 6 cards. Two traps:

- **Never ship a benchless 5-card roster** — `_avg([])` returns `0.0`
  (`simulation.py:72-73`), so `bench_strength=0` silently costs −6 expected wins.
  Six slots is safe.
- **`wins` saturates at 82 and `positional_fit` clamps at 100.** Two strong
  rosters both read 82-0. Rank on **`lineup_peak_score`** (`simulation.py:1174`),
  which does not saturate — but it is `0.0` unless every card is
  `exact_season_scored`, so the unscored-rostermate policy must be explicit.

`TOTAL_ROUNDS = 8` binds only the state machine, not the simulator; a 6-slot
variant parameterizes `SLOT_TYPES`/`TOTAL_ROUNDS` at the state layer with **zero**
changes to `simulation.py`.

### 2.5 RTT duplicate identity — ROOT CAUSE (verbatim for the final report)

An earlier draft assumed a card-id-keyed exclusion was letting a slug through
twice. **No such line exists.** Every exclusion set in RTT already keys on
canonical `player_slug`. The bug is a **missing** exclusion, not a mis-keyed one;
re-keying would fix nothing.

> The player's starting roster and the boss slate are produced by two functions
> that share no exclusion state and structurally cannot.
> `generate_starting_roster(pool, seed)` (`generation.py:52`) draws from
> `START_ROSTER_PERCENTILE_BAND = (0.28, 0.68)` (`config.py:161`) knowing nothing
> about bosses, while `resolve_bosses(pool)` (`bosses.py:336`) returns a fixed,
> seed-independent, hardcoded slate. The single place both are visible —
> `generate_blueprint` at `generation.py:261-275` — computes `boss_slugs` at line
> 265, then discards it, setting `exclude = start_slugs` at line 275 under a
> comment that deliberately keeps boss identities purchasable ("Boss cards stay
> available"). That decision was reasoned about for OFFER BOARDS only; no
> corresponding subtraction was ever written for the STARTING ROSTER. Nothing in
> the engine has ever prevented a boss's own card from being dealt to the player
> at run creation. Fourteen of the thirty-five distinct boss identities fall
> inside the starting-roster band, so the collision is structural, not a rare
> seed.

Reproduced: **seed 23** deals `joakim-noah-3yr-201314` as the player's anchor
while the Act-5 boss The Long Series fields the identical card id
(`bosses.py:153`) — the screenshot exactly.

The pool holds **174 cards / 174 distinct slugs / zero slugs with >1 card**
(`DURATION_YEARS = 3`, `config.py:48`; `cards.py:168-169` filters non-3yr), so
this is a **literal same-`peak_window_id`** collision, the strongest possible
form.

Incidence over 2,000 seeds:

| Condition | Rate |
| --- | --- |
| Starting roster shares ≥1 identity with some boss | **1771/2000 = 88.5%** |
| Starting roster shares an identity with the FINAL boss | 277/2000 = 13.8% |
| Some generated board offers a boss identity | **1999/2000 = 100%** |

Top colliders: `draymond-green` 370, `marc-gasol` 367, `kyle-lowry` 330,
`pau-gasol` 308, `ben-wallace` 302, `terry-porter` 287, `elton-brand` 284,
`joakim-noah` 277.

**Why no test caught it:** `scripts/audit_run_the_table_v3.py:292-296` checks
duplicates within `all_ids = list(starters) + list(bench)` — the player's roster
alone — and correctly reports 0 across 800,000 runs.
`tests/run_the_table/test_bosses.py:78` checks within one boss.
`test_generation.py:276` checks boards vs starting roster. **No test anywhere
compares player roster to boss roster.**

**Two further identity defects in the same family:**

1. Exclusion is frozen at blueprint time to the *starting* roster, so a card
   acquired mid-run is never removed from later boards. Same identity appears on
   ≥2 boards in **499/500 seeds**.
2. **A self-trade is legal and charges credits.** `legal_slots_for`
   (`state.py:510-528`) discounts the current occupant so a slot can be refilled;
   for a card already in slot S, `owned - {its own slug}` no longer contains it,
   so S is returned as legal for that same card. `action_trade`
   (`state.py:734-793`) has no `outgoing != incoming` guard, so trading a card
   for itself passes every check and charges cost-minus-refund. Same hole at
   `action_draft_buy` (`state.py:645`).

### 2.6 RTT difficulty — measured, not asserted

Boss escalation is one constant tuple (`config.py:650-651`):

```python
BOSS_TARGET_STARTER_MEAN: Final[tuple[float, ...]] = (61.0, 65.0, 70.0, 74.5, 76.5)
BOSS_TARGET_TOLERANCE: Final[float] = 2.5
```

The seed **never reaches** `resolve_bosses` (`generation.py:264` passes the pool
only), so every seed, every player, every day faces the identical five opponents.
Boss lineups are **not persisted** — regenerated from the hardcoded table on
every load.

Committed 100k-seed evidence (`docs/implementation/run-the-table-balance-v3.json`),
per-act win rate:

```
passive(control)  78.3 /  1.3 /  0.0 /  0.0 /  0.0   clear  0.0%
random_legal      75.3 / 10.0 /  3.1 /  0.4 /  0.2   clear  0.06%
greedy_overall    96.8 / 62.9 / 51.2 / 18.8 / 12.1   clear  9.9%
lane_aware        98.3 / 78.3 / 56.0 / 13.3 /  4.4   clear  4.2%
economy_aware     87.7 / 53.7 / 60.7 / 39.4 / 34.9   clear 27.4%
look_ahead        99.3 / 89.4 / 80.4 / 36.4 / 21.2   clear 21.0%
film_aware        97.1 / 70.9 / 54.3 / 14.8 /  5.6   clear  5.4%
credit_spending   97.4 / 69.6 / 37.3 /  4.0 /  0.7   clear  0.66%
```

Act 1 is 97-99% for any competent policy; Act 5 is 0.2-35%. Targets are
42-55% / 38-51% / 34-47% / 28-43% / 20-38%.

**Acquisition ceiling — the constraint is BUDGET, not offer scarcity.** Best card
reachable per run: mean 91.17, median 91.31. All 28 pool cards ≥80 prime cost
23-30 credits against a **50-credit start**, and mid-tier refunds are only 5-7.
The `anchor` role is the structural bottleneck: 28 eligible cards, 67.33 ceiling
— simultaneously why `joakim-noah` collides and why `config.py:645-650` made
Act 5 the smallest step in the ramp.

### 2.7 Platform primitives — what does NOT exist

Verified by negative grep across `apps/api` and `apps/web/src`:

- **No realtime of any kind.** No WebSockets (no `websockets` package), no SSE,
  no Supabase Realtime subscription (`[realtime] enabled = true` in
  `config.toml:87-88`, but nothing subscribes), no SWR/react-query. The only
  two-client sync in the product is `setInterval(..., 2500)` polling in Ranked
  (`RankedScreen.tsx:113-126`, `:141-164`). Head-to-head has no polling at all.
- **No bots.** No AI opponent or simulated player anywhere in `apps/api` or
  `nba_peak`.
- **No server-authoritative turn timer.** `ranked_matches.deadline` is written
  and **never read for enforcement** — six sites, none a comparison. The
  `'expired'` and `'forfeited'` status values are never written by any code path.
- **No background task runner.** No APScheduler, Celery, cron, `BackgroundTasks`,
  or `asyncio.create_task` in application code. Every expiry is swept lazily on a
  request that happens to touch the domain.
- **One optimistic-concurrency implementation exists** — CourtBuilder's
  `state_version` (`perfect_season.py:557`; bumped only at
  `services/perfect_season/state.py:210-218`; enforced `:660-664`). Ranked and
  head-to-head have none. No ETag, no `If-Match`, no `xmin`.
- **No `SERIALIZABLE`, no advisory locks.** The sole row lock is
  `FOR UPDATE SKIP LOCKED` (`ranked_postgres.py:293-301`) — wrong semantics for a
  blocking global player lock, which must fail rather than skip.
- **No reconnect or connection-liveness concept** on either side.

### 2.8 RLS is NOT an enforcement boundary for API traffic

`20260801100000_rls_gaps.sql:3-18` states it directly: the API opens one asyncpg
pool **as the table-owning role**, never issues `SET ROLE`, never sets
`request.jwt.claims`, and no table carries `FORCE ROW LEVEL SECURITY` (zero hits
across all 37 migrations). A table owner is exempt from its own policies, so
**owner scoping is 100% application code**. RLS binds exactly one caller class: a
PostgREST client holding a Supabase anon/authenticated key.

Consequences that bind every new migration:

1. **Every new table auto-inherits CRUD for `anon` and `authenticated`**
   (`20260630130100_default_privileges.sql:25-32` sets `ALTER DEFAULT PRIVILEGES`).
   Each new table MUST carry the 5-verb revoke —
   `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER ... FROM anon, authenticated`
   — because TRUNCATE is a write RLS does not filter.
2. **Self-referential RLS on a participants table recurses** (observed twice as a
   real error). Fix with a `SECURITY DEFINER STABLE SET search_path = public`
   helper (`is_ranked_match_participant`, `20260630130000_ranked_rls.sql:56-67`)
   or self-only policies.
3. **The precedent for hidden state is head-to-head, and it chose self-only**
   (`20260801160000_head_to_head.sql:221-222`): the direct client path is closed
   and the server reveals the opponent's side when it is safe. **This is the shape
   to copy for sealed bids.** Hidden-bid privacy is enforced in application code;
   RLS + column GRANTs are defence-in-depth against a direct anon-key caller.

### 2.9 Baseline test counts

| Suite | Count |
| --- | --- |
| Python model | 956 |
| Python lineup | 43 |
| API unit | 1,289 |
| API integration (Supabase/RLS) | 95 — **all skip without 4 env vars** |
| Frontend vitest | 1,397 across 56 files |
| Playwright e2e | 351 in 12 files |
| **Total** | **4,131** |

### 2.10 Ranked gate — must stay off

Master flag `RANKED_ENABLED` (env `PEAK3_RANKED_ENABLED`), default `False`
(`config.py:106`), checked in `_require_ranked_access` (`ranked.py:90-97`) which
gates 21 call sites. Three more flags default `False`:
`RANKED_MATCHMAKING_ENABLED` (`:110`), `RANKED_RATING_WRITES_ENABLED` (`:115`),
`RANKED_PUBLIC_LEADERBOARD_ENABLED` (`:118`). `RANKED_READINESS_LEVEL` defaults
`"disabled"`. Two startup cross-validators refuse an inconsistent config
(`config.py:134-141`, `:488-491`).

⚠️ `scripts/ci/e2e-tests.sh:25-28` turns ranked **fully on** for the Playwright
run. Test-local only, but ranked-adjacent E2E assertions run against an enabled
ranked.

**New public ratings get their own flag namespace.** Reusing `RANKED_*` would
make the ranked kill-switch ambiguous.

### 2.11 Auction data + hidden-state findings

**Career-best 1Y cards already exist, committed and served.**
`data/game/experimental/player_pool_1500/top_1000_peaks.v1.json` —
`windows["1y"]["rows"]` is **1,000 rows / 1,000 distinct `player_slug`**, one
career-best 1Y window per player, pre-ranked, `prime_score` 96.75 → 18.85, every
row `data_completeness: "complete"`. Git-tracked, unlike `data/web/` (gitignored
at `.gitignore:63`). Already served by `GET /api/v1/peaks?window=1y&limit=1000`
(`apps/api/app/api/v1/peaks.py:222`). **The $20 Showdown needs no new data
plumbing and no build step.**

**D2 (peak3_v1) is independently confirmed by a stronger argument than the one it
was decided on.** `cache/processed/scored_1980_2026.v2.parquet` is **NOT** in the
`.gitignore` negation list and is ignored — verified by `git check-ignore`. It is
the sole input to `scripts/build_top_peaks.py:71-74` for regenerating
`top_1000_peaks.v2.json`. So the v2 *artifact* is committed and servable, but the
v2 *source* is not: **v2 cannot be regenerated or independently verified in CI or
a clean checkout; v1 can.** v1 is also the API default (`peaks.py:47-52`).
Choosing v2 would mean depending on an artifact nobody can reproduce from the
repo.

The v1/v2 fork is real and must be pinned: 24 of 1,000 players differ, Jokić moves
rank 5→6, Jordan 97.53 vs 96.75. **Every match row pins `model_version`**, exactly
as head-to-head pins `card_pool_version`, or a regeneration silently rescores a
settled match.

**Hard position legality is NEW logic.** `positions.py:423-425` states outright:
"Placement legality is NOT determined here — this function is purely for
display/fit-feedback purposes. Every slot accepts every player." CourtBuilder only
*soft*-penalizes off-position (0.0 / −5.0 / −14.0). Both new games require hard
PG/SG/SF/PF/C legality. This is viable: `career_positions()` coverage is
**1,000/1,000 non-empty**, tokens exactly `{PG,SG,SF,PF,C}`, and the split is 481
single-position / 468 two / 48 three / 1 four / 2 five — so slot scarcity is a
real strategic lever rather than a formality.

**The existing 1v1 concurrency model is hard-capped at two seats.**
`UNIQUE (match_id, role)` with `role CHECK IN ('creator','opponent')`
(`20260801160000_head_to_head.sql:161-162`) caps participation at two, and
`PRIMARY KEY (match_id, participant_sub)` *is* the not-self rule. **Three-Man
Weave cannot reuse this** — hence `arena_match_seats` with an explicit seat index.

**Sealed-bid storage decision.** Store `bid_amount` on a participant-scoped row;
REVOKE `INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER` from `anon, authenticated`;
self-only RLS SELECT; omit the opponent's bid from every response until the
round's both-bids condition holds; first-write-wins via `WHERE bid_amount IS NULL`
so a second tab cannot re-bid.

⚠️ **HMAC session tokens are SIGNED, not ENCRYPTED** (`core/security.py:20-34` —
`b64url(json) + "." + b64url(hmac)`). Base64 is trivially readable. Fine for a
single-player daily; **fatal for a sealed bid**. Bids never ride in a token.

**Hidden state is an omission, not a flag.** The canonical pattern is `_match_view`
(`head_to_head.py:661`): until `both_complete`, the opponent block carries a name
and the literal status `"hidden"` and nothing else — not even progress, because
"they are on act 4" is itself a spoiler about a shared board. Copy this exactly.

**Slug drift across pools — normalize through `slug_variants()`**
(`career_positions.py:115`) at every pool boundary. Five drift cases
(`shaquille-oneal`→`shaquille-o-neal`, `jermaine-oneal`, `deaaron-fox`,
`amare-stoudemire`, `pj-brown`) and three genuinely absent from the 1000-pool:
`andrew-bogut`, `isaiah-hartenstein`, `tony-allen`.

**Component-count disclosure (lead decision).** Neither `top_1000` artifact carries
`teammate_adjustment`; the 250-pool does. A receipt built on the 1000-pool will
therefore show **five** components, not six. It must **say so explicitly** rather
than silently render five where six is the house convention — consistent with the
project rule against replacing missing data with fabricated values.

**Exact component field names** (easy to cross): the components dict uses
`individual_recognition` and `postseason_individual_value`; the WEIGHTS dict in
`metadata.json` uses short forms `recognition` and `postseason`. Do not mix them.

---

## 3. Approved decisions

| # | Decision | Choice | Consequence |
| --- | --- | --- | --- |
| D1 | RTT boss generation | **Generate per-run, change the tests** | Roster-relative calibrated generation as specified; finalized slate persisted for refresh/replay. `test_bosses.py:113` (seed-independence) and `:106` (curated-source) are **deliberately rewritten** — recorded as design decisions, not weakened checks. |
| D2 | PEAK3 formula version | **v1 — match the evaluator** | New games speak `peak3_v1` (`cache/processed/scored_1980_2026.parquet`), consistent with how lineups are actually scored. Rankings pages keep v2. No game shows a score disagreeing with its own result. The v1/v2 split remains an open product issue, documented, not resolved here. |
| D3 | Ruleset version | **Bump `rtt_ruleset_v3` → `v4`, accept invalidation** | In-flight runs and outstanding challenge links break, by design (`state.py:152-161`, `daily.py:70`). |
| D4 | Build order | **RTT + CI first, then multiplayer** | Phase A: RTT identity/balance/ceiling + CI matrix. Phase B: multiplayer foundation + Three-Man Weave. Phase C: $20 Showdown. |

## 4. Realtime technology decision

**Authoritative state in Postgres; authoritative polling as the correctness
baseline; Supabase Broadcast as a latency optimisation carrying notifications
only, never state.**

Evidence:

- The API is **single-instance by coincidence, not by contract** —
  `Dockerfile:90` is one uvicorn with no `--workers`, `railway.toml` has no
  replica key, and there is **no Redis anywhere**. `core/rate_limit.py:9-14`
  already documents this exact failure mode for the in-process limiter: "it does
  NOT coordinate across replicas."
- An in-process WebSocket hub is the same shape. It works today and splits
  silently the moment a dashboard replica bump happens. `restartPolicyType =
  "ON_FAILURE"` (`railway.toml:37`) also drops every socket on restart, and there
  is no reconnect infrastructure anywhere in `apps/web` to extend.
- The web app **already holds** a cookie-backed Supabase browser client carrying
  the session JWT (`lib/supabase/client.ts:50-56`), pointed at the same project
  the RLS policies are written against. Channel authz reuses the existing
  identity model rather than inventing a second one. Zero new dependencies.

**Load-bearing constraint:** Broadcast carries *"match X changed, re-fetch"* and
nothing else. It is not durable, not end-to-end ordered, and not
payload-authenticated; treating a payload as game state would put the match's
truth in a channel a participant can publish to. Combined with the `state_version`
pattern, a stale or duplicated hint is harmless.

Polling is built first and stays the only code path under test; Broadcast only
ever triggers the same re-fetch the poller would have done, so a Broadcast outage
degrades to today's behavior.

## 5. File ownership

No two teammates edit the same shared state-machine or schema file without lead
coordination.

| Teammate | Worktree | Owns |
| --- | --- | --- |
| rtt-balance-integrity | `wt/mp-rtt-balance` | `nba_peak/run_the_table/**`, `tests/run_the_table/**`, RTT simulation scripts |
| competition-security | `wt/mp-competition-security` | `.github/workflows/ci.yml`, `scripts/ci/**`, new rating/leaderboard migrations |
| multiplayer-platform | `wt/mp-platform` | `apps/api/app/repositories/arena_*`, `apps/api/app/services/arena/**`, arena migrations |
| three-man-weave | `wt/mp-three-man-weave` | TMW service + adapter + frontend |
| twenty-dollar | `wt/mp-twenty-dollar` | $20 service + frontend |
| **lead** | primary checkout | `IMPLEMENTATION_CONTRACT.md`, shared schema boundaries, integration, acceptance |

Binding conventions extracted from the audits, applying to all new code:

- Three files per repository domain: `<domain>_protocols.py` / `_memory.py` /
  `_postgres.py`. **`async def` end-to-end**, including the memory impl (a prior
  sync/async mismatch silently returned unawaited coroutines).
- Every new domain MUST be added to `REPOSITORY_DOMAINS`
  (`core/repository_registry.py:32-53`) — "being wired in `core/dependencies.py`
  is the only criterion for membership." Omission silently exempts it from the
  production durability guarantee.
- New repositories go into `tests/test_repository_conformance.py` so a protocol
  guarantee cannot hold for one backend and not the other.
- New tables go into `EXPECTED_TABLES` and `RLS_REQUIRED_TABLES`
  (`tests/integration/test_migrations.py:30-70`) or coverage silently lapses.
- `to_dict`/`from_dict` drift is a known silent-data-loss bug
  (`serialization.py:1-24`): a new state field must be added to the `from_dict`
  path in the same commit.
- Seeds are persisted, never generated content; one `random.Random` per **named
  stream** so adding a stream cannot shift an existing one.
- Route identity: `existing_owner_sub` + `assert_owns` for mutations — **not**
  `resolve_owner_sub`, which mints a fresh anon identity and is correct only on
  creation paths.

## 6. Lead approval

**APPROVED** for implementation, subject to the four decisions in §3.

Approved by: lead
Baseline: `9bb5326531f0cc4c1a81aee777f65c61fea3ac22`
Branch: `feature/multiplayer-arena-foundation`
Phase A begins: RTT identity/balance/ceiling + CI matrix correction.
