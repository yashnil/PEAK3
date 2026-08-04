# PEAK3 Multiplayer Arena — Final Report

Branch: `feature/multiplayer-arena-foundation`
Baseline: `9bb5326531f0cc4c1a81aee777f65c61fea3ac22`
Commits above baseline: 22
Nothing merged to `main`. Nothing deployed. Ranked untouched, all four flags at
their `False` defaults.

---

## 1. Architecture and state-machine summary

A mode-agnostic foundation with the two games plugged in behind one protocol.

```
apps/api/app/services/arena/          FOUNDATION — no game rules
  modes.py        the ArenaMode contract + registry (the seam)
  clock.py        stored, ENFORCED deadlines and the lazy sweep
  matchmaking.py  three entry paths and the rated policy they imply
  bots.py         policies, registry, driver

apps/api/app/services/three_man_weave/mode.py   game adapters, outside the
apps/api/app/services/twenty_dollar/mode.py     foundation directory

nba_peak/three_man_weave/    pure rules, no DB, no FastAPI, no client state
nba_peak/twenty_dollar/
```

`ArenaRepository.apply_command` is the single mutation path. One transaction,
one row lock, in this order: **lock → idempotency → liveness/clock →
expected-version → mode reducer → record verdict → apply.**

Three properties worth naming:

- **The lock BLOCKS.** `SELECT ... FOR UPDATE`, no `SKIP LOCKED`. The one
  pre-existing row lock in the codebase (`ranked_postgres.py:293-301`) skips,
  which is correct when contended rows are interchangeable candidates and wrong
  for a match — two commands against one match are not alternatives, and
  skipping the second silently drops a player's move.
- **A rejected command consumes no state version.** Otherwise a rejected retry
  would invalidate every other client's cached version.
- **The timeout/action race is closed three ways.** The row lock serializes; the
  timeout idempotency key is deterministic so a second sweep replays; and
  `guard_timeout` refuses a timeout whose turn is no longer open. The third is
  what makes the first two sufficient — without it a timeout that lost the race
  would still forfeit a turn the player had just legitimately played.

`ArenaMode.project()` is a **required** method, so the default is "nothing is
visible until the mode says so" rather than "everything is visible unless a
route remembers to strip it."

---

## 2. Exact schemas and migrations

Two migrations, both local-only (not applied to hosted Supabase).

**`20260804100000_arena_foundation.sql`** — `arena_matches`,
`arena_match_seats`, `arena_match_commands`, `arena_match_events`,
`arena_turns`, `arena_match_results`, `arena_public_queue`.

Invariants encoded as constraints rather than conventions:

| Constraint | What it makes impossible |
| --- | --- |
| `PRIMARY KEY (match_id, seat_index)` + `seat_count CHECK BETWEEN 2 AND 6` | a 2-seat model that cannot express 3 seats |
| `CHECK (rated = (entry_path = 'public_queue'))` | application code disagreeing with the rated policy |
| `arena_match_events.visibility` + `visible_to_seat` | hidden state leaking through a serializer that forgot to strip it |
| append-only triggers on events and results | a settled result being edited |
| `arena_matches_room_code_live_uniq` (partial) | a room code that never frees |
| `CHECK (char_length(idempotency_key) BETWEEN 8 AND 128)` | a placeholder key colliding and replaying someone else's verdict |

Seats are **not** the head-to-head model: `UNIQUE (match_id, role)` with
`role CHECK IN ('creator','opponent')` hard-caps at two. The not-self rule here
is a partial unique index on `occupant_sub`, because a bot seat has no subject
and cannot carry a primary key.

**`20260804140000_arena_ratings.sql`** — `arena_ratings` (current) plus
`arena_rating_history` (append-only ledger with immutability triggers),
following the `ranked_rating` split so "how did this player reach 1640" stays
answerable.

**Leaderboard statistics are deliberately not a table.** Every one derives from
`arena_match_results JOIN arena_match_seats` — rows already immutable and
already carrying `rated` and `was_bot`. A materialised aggregate could only
drift, and the first symptom would be a leaderboard disagreeing with the
history it came from.

---

## 3. Realtime technology decision and evidence

**Authoritative state in Postgres; authoritative polling as the only path under
test; Supabase Broadcast deliberately NOT built this pass.**

Evidence, not preference:

- **No realtime of any kind existed.** Zero WebSockets (no `websockets`
  package), zero SSE, zero Supabase Realtime subscriptions (`[realtime]
  enabled = true` in `config.toml:87-88`, nothing subscribes), no
  SWR/react-query. The only two-client sync in the product was
  `setInterval(..., 2500)` in Ranked.
- **The API is single-instance by coincidence, not contract.** `Dockerfile:90`
  is one uvicorn with no `--workers`; `railway.toml` has no replica key; there
  is **no Redis anywhere**. `core/rate_limit.py:9-14` already documents this
  exact failure mode for the in-process limiter: "it does NOT coordinate across
  replicas."
- An in-process WebSocket hub is the same shape — works today, splits silently
  the first time anyone bumps replicas, and `restartPolicyType = "ON_FAILURE"`
  drops every socket on restart.

Broadcast remains the recommended latency optimisation, carrying
*"match X changed, re-fetch"* and never state. It is not durable, not
end-to-end ordered, and not payload-authenticated; treating a payload as game
state would put the match's truth in a channel a participant can publish to.

---

## 4-6. Match recordings

**Not produced.** Both games are driven by unit and adapter tests rather than
recorded live matches. What exists instead:

- Three-Man Weave: a full 18-turn match driven through `reduce()`, plus
  `test_a_whole_match_is_reproducible_from_its_seed`.
- $20 Showdown: 30 bot-vs-bot matches, every one completing in exactly 10 rounds
  (the minimum), zero autofills, roster totals 164.6–322.7.
- Neither has been driven through `POST /arena/matches/{id}/commands` over HTTP.

This is a real gap and is listed in §15.

---

## 7. RTT duplicate-player root cause

> The player's starting roster and the boss slate were produced by two functions
> that share no exclusion state and structurally cannot.
> `generate_starting_roster(pool, seed)` (`generation.py:52`) draws from
> `START_ROSTER_PERCENTILE_BAND = (0.28, 0.68)` knowing nothing about bosses,
> while `resolve_bosses(pool)` (`bosses.py:336`) returned a fixed,
> seed-independent, hardcoded slate. The single place both are visible —
> `generate_blueprint` at `generation.py:261-275` — computed `boss_slugs` at line
> 265, then discarded it, setting `exclude = start_slugs` at line 275 under a
> comment that deliberately keeps boss identities purchasable. That decision was
> reasoned about for OFFER BOARDS only; no corresponding subtraction was ever
> written for the STARTING roster. Fourteen of the thirty-five distinct boss
> identities fall inside the starting-roster band, so the collision was
> structural, not a rare seed.

Every exclusion set was **already** keyed on canonical `player_slug`. The bug
was a *missing* exclusion, not a mis-keyed one.

Fixed by **inverting the dependency**: the roster is drawn first, each boss is
then generated against it. A collision is impossible by construction rather than
prevented by a filter someone has to remember.

**Why no test caught it:** `scripts/audit_run_the_table_v3.py:292-296` compared
the player's roster against *itself*, which is why the defect survived 800,000
audited runs reporting zero.

Two further defects in the same family: exclusions frozen at blueprint time
(same identity on ≥2 boards in 499/500 seeds), and a **self-trade that was legal
and charged credits** — `legal_slots_for` reported a card legal for the slot it
already occupied.

---

## 8-9. RTT boss generation before/after, and win rates by act

Aggregate over the 7 non-control policies, 2,000 seeds × 8 policies = 16,000
runs, 400 replay checks:

| Act | Before (v3) | After (v4) | Target band | |
| --- | --- | --- | --- | --- |
| 1 | 0.916 | **0.465** | 0.42–0.55 | IN |
| 2 | 0.612 | **0.407** | 0.38–0.51 | IN |
| 3 | 0.503 | **0.389** | 0.34–0.47 | IN |
| 4 | 0.190 | **0.343** | 0.28–0.43 | IN |
| 5 | 0.121 | **0.290** | 0.20–0.38 | IN |

Identity invariants, same run: `player_and_boss_share_an_identity` **0**,
`two_bosses_share_an_identity` **0**, `duplicate_identities` **0**,
`replay_receipt_mismatches` **0**. 21 hard invariants held, 0 soft warnings.

Skill spread 21× (best policy clears 38.8%, do-nothing control 1.8%).
Distributions overlap; Act 5 hardest in aggregate; an individual Act 4 boss can
exceed an individual Act 5 boss.

**Partial tracking is 0.90.** At 1.0 the bands were met but the spread collapsed
to 2×. At 0.72 the spread was 6× but the Act 5 gap between an un-upgraded and a
built roster reached ~74 points of win rate — auto-lose for one, auto-win for
the other. Both rejected settings are recorded in the config comment with their
measurements.

---

## 10. Elite-acquisition frequency before/after

The binding constraint was **budget, not supply**: all 28 pool cards ≥80 prime
cost 23-30 credits against a 50-credit start, with mid-tier refunds of only 5-7.

Top-decile share of all offers **10% → ~19%**, asserted to stay under 30% so the
board does not flood. Marquee share of purchases 14%–65% by policy; the
do-nothing control buys 0. One marquee board per act, placed on the **last**
slot so it can never displace the cheap anchor a broke player needs. Trade
refund 0.50 → 0.60.

The anchor bottleneck is unchanged and is a property of the data: 28
anchor-eligible cards in the whole 3Y pool, ceiling 67.33.

---

## 11. Rating and leaderboard proof

Glicko-2 **reused, not reimplemented** (`services/ranked/glicko2.py`).
Placement → pairwise, then all of a seat's opponents into `rate_period` as **one
rating period** — sequential `rate_match` calls would judge the second opponent
against an already-moved rating, making the result depend on iteration order. A
test asserts the two differ.

Ties compare placements rather than assuming placement 1 means "won", so 1/1/1
is three draws and 1/1/3 is a draw plus two wins.

**`MAX_RATING_CHANGE_PER_MATCH` was first set to 64.0 with a docstring claiming
it sat above any honest match. Measurement disproved it:**

| Scenario | Δ | At 64 |
| --- | --- | --- |
| established (RD 50) beats two peers | +14 | not hit |
| mid-RD (150) sweeps two peers | +90 | would clamp |
| provisional (RD 350) sweeps two peers | +247 | would clamp |
| provisional sweeps two 2800-rated | +1386 | would clamp |

At 64 it would have bitten on every provisional and mid-RD match, silently
converting Glicko-2 into a slow linear system while still calling itself
Glicko-2. Corrected to **400**, with the measured table in the comment.

No daily cap: calibrated bot ratings pinned per seat, the bounded per-match
change above, and `unbounded_post_rating` + `bound_applied` on every row so
repeated clamps are queryable. A control whose activations are invisible cannot
be monitored.

The 82-0 leaderboard contract is **untouched**: `wins DESC, lineup_score DESC,
respins ASC, created_at ASC`, `game_id UNIQUE`, no `ON CONFLICT DO NOTHING`.

---

## 12. Hidden-state and RLS proof

**RLS is not the enforcement boundary for API traffic** and never was
(`20260801100000_rls_gaps.sql:3-18`): the API opens one asyncpg pool as the
table-owning role, never issues `SET ROLE`, never sets `request.jwt.claims`, and
no table carries `FORCE ROW LEVEL SECURITY`. Owner scoping is 100% application
code; RLS binds a direct PostgREST caller holding the anon key.

Proven rather than claimed — as the real `anon` role:
`SELECT owner_sub FROM arena_ratings` → **permission denied**;
`SELECT mode, rating` → allowed. SELECT on exactly 9 columns, `owner_sub` not
among them. 13 RLS probes against the foundation tables: every write denied,
command ledger unreadable, all reads 0 rows.

**Both games converged independently on the same test shape: recursive VALUE
search over the rendered output, not key checks** — because a key-based
assertion is passed by any field a future change happens to invent. Each proved
its detector load-bearing by planting a violation several levels deep.

- $20: the opponent's bid amount, the real `prime_score` (97.53) and a raw
  component (37.6059) appear nowhere while a round is live — in text **and every
  attribute**, since a bid in a `data-*` attribute is still a bid.
- Three-Man Weave: future rolls are not merely hidden, they are **not
  computable** — feasibility depends on live draft state, so a round-6 roll
  cannot exist at match creation. There is no future-roll field to leak.

Bots cannot cheat by construction: `BotPolicy.choose(view: SeatView, rng)` and
`SeatView` carries no match, snapshot, seats, or repository handle.

---

## 13. CI workflow correction

**Root cause, and it is not what was assumed.** PRs showing only Vercel/Railway
were **stacked onto non-main bases**. `pull_request.branches: [main]` filters on
the BASE ref:

```
PR #9   base=feature/arena-rtt-overhaul     → Vercel, Vercel Preview, Railway. Nothing else.
PR #8   base=chore/production-deployment    → Vercel, Vercel Preview. Nothing else.
PR #10  base=main                           → all 8 CI jobs + Vercel.
```

`gh run list` shows **zero** runs for those two branches. Vercel and Railway are
GitHub App integrations firing on branch push regardless of base. The trigger
was never broken.

**The real defect was a green no-op.** `supabase-integration` ran in **5 seconds**
on PR #10, skipped all 95 tests, and reported SUCCESS — so real-Postgres and RLS
coverage had never executed on any pull request, behind a check whose name said
it had.

Fixed: 8 jobs → 11. A `supabase start` job runs all 95 with **no secrets**; the
hosted job renders **SKIPPED** rather than green when unconfigured; a new
migration-validation job runs `validate_migrations.py` and fails on inventory
drift (neither script was invoked by anything before).

A bare `services: postgres:` container **cannot** host this suite — measured: 19
of 35 migrations fail on missing `auth` schema and `anon`/`authenticated` roles.
A bootstrap faking `auth.uid()` was rejected: `test_rls_policies.py` exists to
prove the *real* policies behave, and pointing it at an invented fixture would
make it prove the fixture works. **A test that validates its own fixture is
worse than no test, because it is green.**

---

## 14. Test totals

| Suite | Baseline | Now |
| --- | --- | --- |
| Python model | 956 | **1252** |
| Lineup model | 43 | **43** |
| API unit | 1289 | **1504** |
| API integration (real Postgres) | 95 | **96+** |
| Frontend vitest | 1397 / 56 files | **1538 / 61 files** |
| Playwright | 351 / 12 files | **352 / 12 files** |

Also: 21 RTT hard invariants over 16,000 runs, 37 arena schema invariants probed
individually, 13 RLS probes as the real `anon` role.

---

## 15. Remaining blockers

**Genuinely not done:**

1. **No live HTTP match recording for either game.** Both are covered by unit
   and adapter tests; neither has been driven end-to-end through
   `POST /arena/matches/{id}/commands`. The multiplayer scenario matrix (three
   humans, reconnect mid-turn, timeout/action race, cross-user denial, etc.) is
   tested at the mechanism level, not as live scenarios.
2. **Rating flags must stay off** until two tests exist: a route-level test for
   `GET /arena/leaderboard/{mode}`, and an end-to-end test that a completed
   match produces a rating through `_advance`.
3. **Known N+1**: the leaderboard does one profile lookup per row (50 rows = 51
   queries). The fix is a batch method, deliberately not added because an
   untested batch method would compound gap 2.
4. **The 82-0 empty-leaderboard root cause is unresolved.** The server
   write/read path is proven working end to end against real Postgres, so no row
   was ever written. Three candidates remain and cannot be distinguished without
   hosted evidence: saved instead of submitted, `handle_required`, or an
   ineligible roster. The fix is designed and deliberately unimplemented.
5. **Browser acceptance matrix largely unverified** — tablet, screen reader,
   150%/200% zoom, dark/light themes. Unit tests assert structure; nobody has
   seen these surfaces in a browser.
6. **`main` has no branch protection**, so every result here is advisory.
7. **Memory/Postgres divergence recorded, not closed**: the memory rating
   repository does not reproduce the `arena_rating_history.match_id` foreign
   key. Closing it would require a rating repository to depend on a match
   repository, inverting the separation that justified splitting them.
8. **`apps/web/src/tests/setup.ts` has no timer restoration** while eight files
   call `vi.useFakeTimers()`. A latent hazard across all 61 files.

**Two bugs found that were not in scope, both real and both fixed:**

- **A shipped accessibility bug in the shared `Dialog`.** `Portal` returns
  `null` until after its own first effect, so on the render where `open` flips
  true both refs are null. Focus placement lived inside a `requestAnimationFrame`
  racing the portal's mount; when the frame won, every branch fell through and
  focus stayed on `<body>` with no retry. **Every modal in the product.** Fixed
  by placing focus from the panel's ref callback.
- **Two committed artifacts rewritten by ordinary operations**, making
  `git status` useless as a release check. Fixing it required discovering that
  **the scoring pipeline is not bit-deterministic**: 8,498 of 2,011,504 cells
  differ on re-score, max delta 2.84e-14, from summation order.

---

## 16. Commit hashes

```
2a1259b  fix(arena): convert the key-length CheckViolation to a domain exception
06ab577  fix(arena): memory backend enforces the idempotency-key length CHECK
0c3ab67  test(arena): conformance for get_player_stats, on both backends
c606244  feat(arena): rating persistence, settlement wiring, public leaderboard
76da1fe  feat(arena): rating schema and Glicko-2 placement mapping
4674807  fix(ui): place dialog focus deterministically, not on a racing frame
7a8613a  ci: run the real integration suite, validate migrations, stop artifact drift
3490a80  docs(h2h,rtt): state what fairness pins, and stop implying identical bosses
5d9d669  feat(rtt): v4 — identity integrity, calibrated bosses, restart flow
dfce76d  fix(arena lobby): read seat count from readiness, delete the client copy
8d88ed7  feat(arena): host and queue bot-fill routes, readiness publishes seat_count
f36c32f  feat(arena): register both modes at startup
c585f34  feat(twenty-dollar): $20 Showdown sealed-bid auction
64adb41  feat(three-man-weave): franchise x decade snake draft
df2a921  feat(arena): server-authoritative multiplayer foundation
9bb5326  (baseline)
```

---

## 17. Clean git status

`git status --porcelain` → empty. `git diff --check` → clean on every commit.

`leaderboards/` is **byte-identical to baseline**. `cache/processed/scored_1980_2026.parquet`
md5 `157425ea3ebe54f19ded0d01dec5816b`, unchanged after a full model run.

The only baseline diff outside new files is `peak3.py` (+89/−2) — the cache-write
guard. It touches **no weight, no `calibrate_score()`, no scoring value**; it
governs one thing only, whether a cache file is rewritten.

---

## 18. Confirmation

Nothing was merged to `main`. Nothing was deployed. The only network access was
two read-only `GET`s to the staging API's public `/readiness` and
`/perfect-season/leaderboard` endpoints while diagnosing the empty-board report;
no staging data was read, written, or restored.

Ranked remains disabled: `RANKED_ENABLED`, `RANKED_MATCHMAKING_ENABLED`,
`RANKED_RATING_WRITES_ENABLED`, `RANKED_PUBLIC_LEADERBOARD_ENABLED` all `False`,
`RANKED_READINESS_LEVEL` `"disabled"`. New Arena flags live in their own
`ARENA_*` namespace, also all `False`, so the ranked kill-switch stays
unambiguous.
