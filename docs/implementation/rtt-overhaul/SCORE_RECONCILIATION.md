# RUN THE TABLE score-semantics reconciliation + leaderboard/security contract audit

**Owner:** score-integrity (Teammate 2) · **Scope:** P1-A + P1-D + P1-E, read-only audit (§1-2), plus a
confirmed-defect + proposed-fix writeup for P1-E (§3) — no product behavior changed by this document itself.
**Worktree:** `PEAK3-agent-score` @ `wt/arena-score`.

Companion machine-checkable artifact: [`rtt_score_semantics_audit.json`](./rtt_score_semantics_audit.json),
produced by [`scripts/audit_rtt_score_semantics.py`](../../../scripts/audit_rtt_score_semantics.py).
Run it yourself: `python scripts/audit_rtt_score_semantics.py` (no network access, no state mutation).

---

## 0. Baseline facts

Canonical leaderboard CSV sha256 (recomputed in this worktree via
`python scripts/build_web_dataset.py`, matches the hashes supplied in the task brief exactly):

| duration | sha256 |
|---|---|
| 1y | `298ec24a3f573b1af3bacb3bc2de7c4f6082aefa96582ed3dcb32256a1f0b387` |
| 2y | `9723ad7ec2915878069273e27687c1c57a21c9c7ec5b6938088429a6565c5eac` |
| 3y | `83bf92bf6f20c97ff3702cda0e3fc79a0926f8556745fb4cef2802e6fa831b71` |
| 5y | `ef59f6f2a8bd9cd7a460de90c121d88f7a868abce09aefc37b9b018569a37c6c` |

Test totals, run in this worktree (`scripts/ci/model-tests.sh`, `scripts/ci/api-unit-tests.sh`):

| suite | result |
|---|---|
| `scripts/ci/model-tests.sh` (`tests/`, excl. `tests/lineup`) | **939 passed, 9 skipped, 1 xfailed**, 0 failed (529.07s) |
| `scripts/ci/api-unit-tests.sh` (`apps/api/tests/`, in-memory repos) | **1198 passed, 2 skipped, 5 deselected**, 0 failed |

(`5 deselected` = the real-Postgres `supabase_integration`-marked tests, deliberately excluded from this
suite by design — see `scripts/ci/api-unit-tests.sh`'s own header comment. Not run in this pass; no hosted
Supabase credentials available in this worktree.)

Nothing in `OFFICIAL_WEIGHTS`, `calibrate_score()`, or any `leaderboards/*.csv` file was modified.

---

## 1. TASK #1 — RTT score-semantics reconciliation

### 1.1 The question

The battle UI (`apps/web/src/components/run-the-table/BattleReveal.tsx`) renders, per lane, a number directly
above a player's name:

```
27.2                              [Statistical Impact]                    35.6
———you———                                                              ———them———
Victor Wembanyama                     led by                      Clyde Drexler
```

This reads as "Victor Wembanyama's Statistical Impact is 27.2." **It is not.** It is the player's whole
5+2 roster's weighted-mean Statistical Impact lane score for that battle; Wembanyama is only the roster
member who happened to score highest in that lane, and his own value in that lane is a different,
unshown number.

### 1.2 Method

1. Read the engine: `nba_peak/run_the_table/{battle,cards,bosses,config,schemas,receipt}.py`.
2. Read the API projection: `apps/api/app/services/run_the_table/{public,serialization}.py`,
   `apps/api/app/services/arena_points.py`.
3. Read the frontend consumers: `BattleReveal.tsx`, `LaneProfile.tsx`, `BossPreview.tsx`, `RunResult.tsx`,
   `ScoutPrepare.tsx`, tracing every rendered number back to its exact payload field name.
4. Wrote `scripts/audit_rtt_score_semantics.py`, which for **3 deterministic seeds** (`11`, `42`, `2026`):
   - builds the real 3Y card pool from the committed artifacts (`cards.build_pool`);
   - generates each seed's blueprint (`generation.generate_blueprint`) — this fixes the starting 5+2
     roster; the five bosses are **seed-independent** (`bosses.resolve_bosses` takes no seed — confirmed
     by the script: three independent calls to `resolve_bosses(pool)` return identical boss-id tuples);
   - resolves all 5 boss battles with `battle.resolve_battle`, the exact function the API's
     `_battle_public()` serializes (`apps/api/app/services/run_the_table/public.py:178-222`);
   - **independently reimplements** the lane-score formula from the docstring spec (not by importing
     the function under test) and asserts it against the engine's own output;
   - for every lane's "top contributor" card, joins it back to its canonical row in
     `leaderboards/top_250_3_year_prime.csv` and compares the contributor's *own* lane value to the
     lineup number displayed above their name.
5. Ran it for real; results below and in the JSON artifact are actual output, not projected.

### 1.3 Results (real script output)

**75 lane-battles checked** (3 seeds × 5 bosses × 5 lanes). For every single one:

- `engine_math_verified_bit_identical: {player: true, opponent: true}` — the independently-recomputed
  weighted mean matched the engine's `lane.player_score` / `lane.opponent_score` exactly.
- `does_top_contributor_own_value_equal_the_displayed_lane_number: false` — **in 0 of 75 cases** did the
  named top contributor's own lane value equal the number displayed directly above their name.

Sample row (seed 11, Act 4 "The Standard", Statistical Impact lane):

```json
{
  "lane": "statistical_impact",
  "displayed_player_score": 23.78,
  "recomputed_player_score_from_lane_index": 23.78,
  "engine_math_verified_bit_identical": {"player": true, "opponent": true},
  "top_contributor": {
    "player_name": "<roster's top SI card for this seed>",
    "own_lane_index_value_in_this_lane": "<a different number from 23.78>",
    "does_top_contributor_own_value_equal_the_displayed_lane_number": false
  }
}
```

Full per-seed, per-lane detail (all 75 rows, with card ids, canonical CSV cross-reference, and every
intermediate value) is in `rtt_score_semantics_audit.json`.

### 1.4 Field-by-field provenance table

| Displayed as | Payload field | Engine source | Classification |
|---|---|---|---|
| `BattleReveal.tsx` lane number (e.g. "27.2") | `battle.lanes[i].player_score` / `opponent_score` | `battle.py: player_lane_profile` → `lane_score()` | **lineup_total** |
| "led by `<Name>`" line beneath it | `battle.lanes[i].player_top_card.player_name` | `battle.py: _top_contributor` | name is `individual_player_contribution`; **the adjacent number is not this player's value** |
| `LaneProfile.tsx` bars (roster panel / boss briefing / result screen) | `lane_profile[i].value` | `battle.py: roster_lane_profile` / `player_lane_profile` | **lineup_total** |
| Per-card number beside a roster player's name (`BossPreview.tsx`, `RunResult.tsx` roster lists) | `card.prime_score` | `leaderboards/top_250_3_year_prime.csv` "Prime display" → `peak_windows.json` → `cards.build_pool` | **individual_player_contribution** (genuinely this player's own calibrated score; correctly labeled) |
| "roster totals X vs Y" | `battle.player_roster_total` / `opponent_roster_total` | `battle.py: roster_total` | **lineup_total** (weighted blend of the 5 lineup lane totals via `LANE_PEAK3_WEIGHTS`, display/tie-break only) |
| "Summed lane margin" | `battle.summed_margin` | `battle.py: resolve_battle` | **other(battle_aggregate_margin)** — a tie-break statistic, not a score |
| "bench weight" | `battle.bench_weight` | `config.py: BENCH_WEIGHT_*` via `bench_weight_for` | **other(config_coefficient)** |
| Run MVP "removing them costs the roster X" | `receipt.run_mvp.marginal_contribution` | `receipt.py: _marginal_contribution` (drop-one delta of `roster_total`) | **perk_adjusted_lineup_total** (delta form; attributable to one player's removal, but the quantity is a lineup delta, not that player's own score) |
| "Best acquisition ... +X.XX PEAK3 over `<replaced>`" | `receipt.best_acquisition.score_delta` | `receipt.py: build_receipt` (delta of two individual `prime_score`s) | **individual_player_contribution** (delta of two genuine individual values — correctly labeled) |
| Daily/Practice/82-0 quiz scoring | `arena_points` | `apps/api/app/services/arena_points.py` | **other(quiz_game_score, disjoint system)** — never referenced anywhere in `nba_peak/run_the_table/**`; no RTT number is ever an `arena_points` value |

`prime_score`/`prime_index` naming and the `arena_points` game-scoring convention both match
`CLAUDE.md`'s naming rules; no PEAK3 score is computed in TypeScript anywhere in this surface (every
number above traces to a Python-computed field on the wire).

### 1.5 Verdict

> **No numerical defect. Presentation defect confirmed by direct evidence.**

The lane math is correct, deterministic, and bit-for-bit reproducible from the published `lane_index`
values across every seed/lane/battle tested (75/75). It is internally consistent with the canonical
leaderboard CSVs (sha256-verified above) and with the official PEAK3 weights (reproduced for *display
only* in `LANE_PEAK3_WEIGHTS`, never re-derived as a score).

The defect is entirely in **presentation**: `BattleReveal.tsx` renders a lineup-level number and a single
player's name in the same visual block with no connecting language that says "led by" applies to *rank
within the lane*, not "this is their score." Across 75 audited lane-battles the top contributor's own
value coincided with the displayed lineup number **zero times** — i.e., the misleading reading is not a
rare edge case, it is what a player sees on essentially every lane, every battle. `LaneProfile.tsx`'s own
code comment (line 8-11) already states the correct semantics ("Every value is `lane_index` rescaled...
by the ENGINE") but that comment is developer-facing only; nothing in the rendered UI says so to the
player.

**Recommendation for the P2 synthesis gate (not implemented here — audit only):** either (a) relabel the
lane number as a roster/lineup value explicitly (e.g. "Your five" / "Roster avg") and keep the
contributor line clearly subordinate ("top performer: ..."), or (b) show the contributor's own value
alongside the roster number so the two are visually distinguishable, per `card.lane_index` (already on
the wire via `card_public()`, so no new engine work is needed — this is a pure frontend/copy fix).

---

## 2. TASK #4 — Leaderboard + security contract audit

### 2.1 Inventory: what "leaderboard" means per game mode

The task brief's five modes map to structurally separate tables, repositories, and routers — **confirmed
no mixing**:

| Mode | Table(s) | Repository | Router |
|---|---|---|---|
| 82-0 (PEAK Season / CourtBuilder) | `perfect_season_runs`, `perfect_season_run_cards` | `leaderboard_postgres.py` / `leaderboard_memory.py` | `apps/api/app/api/v1/perfect_season.py` |
| Daily (Peak Duel) | `peak_duel_daily_results` | — | `apps/api/app/api/v1/*` (daily) |
| Daily Grid | `daily_grid_results`, `daily_grid_attempts` | `daily_grid_protocols.py` | `apps/api/app/api/v1/daily_grid.py` |
| RTT (RUN THE TABLE) | `run_the_table_runs` | `apps/api/app/services/run_the_table/runs.py` | `apps/api/app/api/v1/run_the_table.py` |
| Ranked | `ranked_matches`, `ranked_match_participants`, `rating_ledger_entries`, `queue_ratings`, `placement_states`, etc. | `ranked_postgres.py` / `ranked_memory.py` | `apps/api/app/api/v1/ranked.py` |
| Practice / 82-0 personal history | `perfect_season_saved_runs` | `saved_run_postgres.py` | `apps/api/app/api/v1/perfect_season.py` |

**RTT itself has no global leaderboard at all today** — `run_the_table_runs` is private, owner-only, live
run state (RLS: owner-only SELECT/INSERT/UPDATE/DELETE, no public-read policy exists). This is consistent
with the parent task board's `#7 P3-K: Global 82-0 leaderboard backend + RLS` still being pending — the
only *global* leaderboard implemented anywhere in the codebase today is the 82-0 (PEAK Season) one audited
below, and even that is feature-flagged off and its migration is unapplied to hosted Supabase (§2.6).

### 2.2 The 82-0 (PEAK Season) leaderboard contract — as implemented

Source: `apps/api/app/api/v1/perfect_season.py` (routes `/perfect-season/games/{id}/submit`,
`/perfect-season/leaderboard`, `/perfect-season/me/runs`), `apps/api/app/repositories/leaderboard_postgres.py`,
`supabase/migrations/20260724150000_perfect_season_leaderboard.sql`.

| Contract item | Status | Evidence |
|---|---|---|
| Authoritative score source | ✅ Server-recomputed | `SubmitRunRequest` carries **only** `game_id` (`apps/api/app/models/perfect_season.py:86-92`, docstring: "the ONLY client-controlled input... every scored/roster field is recomputed server-side"). `wins`/`losses`/`lineup_score` are read from the server-saved `game_state.simulation_result`, never the request body. |
| Completion requirement | ✅ Enforced | `game_state.status != "result_ready"` → 400 `game_not_complete` (`perfect_season.py:562-566`); `eligibility["leaderboard_eligible"]` (fully-scored roster) is also required (`perfect_season.py:582-590`), via the **same** `state_machine.compute_eligibility` the UI reads, so the UI can never show "eligible" for a submission the server would reject. |
| Authenticated submission | ✅ Enforced | `RequiredAuth` dependency + explicit `auth.is_anonymous` rejection → 401 `sign_in_required` (`perfect_season.py:552-556`). Anonymous CourtBuilder play is allowed; leaderboard submission is not. |
| Ownership check | ✅ Enforced | `game_state.owner_sub != auth.sub` → 403 `not_your_game` (`perfect_season.py:560`). |
| Model/ruleset version | ✅ Recorded | `data_version`, `formula_version`, `simulation_version` columns, populated from the saved game state/result, not client input. |
| Tie-breakers | ✅ Published + indexed | `wins DESC, lineup_score DESC, (respins used) ASC, created_at ASC` — identical in the SQL index (`20260724150000_perfect_season_leaderboard.sql:43-45`) and the query `ORDER BY` (`leaderboard_postgres.py:148`), so the index actually serves the query it names. |
| Duplicate submissions | ✅ Idempotent | `game_id UNIQUE` constraint; `asyncpg.UniqueViolationError` → `DuplicateRunSubmission` → route returns the **original** record rather than erroring or duplicating (`perfect_season.py:566-570, 625-628`). |
| Pagination | ⚠️ **Broken** | See §2.3 below — a real gap, not a design choice. |
| Personal placement | ❌ **Not implemented** | No endpoint returns "your rank" or "runs around you" on the global board; `/perfect-season/me/runs` returns only the caller's own submitted runs, unranked. A player cannot see where they place without paging the whole board. |
| Daily boundaries | N/A by design | PEAK Season/82-0 is an all-time leaderboard per `mode`, not date-scoped — no daily reset applies here. (RTT's own `daily` run type **does** define an "official application day boundary": midnight **America/Los_Angeles**, `nba_peak/daily_key.py` via `run_the_table/daily.py:10-13`, one shared boundary function reused by every daily mode — the code comment notes this used to be UTC in 4 different places and disagreed.) |
| Public handles | ⚠️ **Privacy gap** | `display_name = profile.display_name or (auth.email.split("@")[0] if auth.email else f"Player-{auth.sub[-6:]}")` (`perfect_season.py:602`). If a user never sets a display name, their **email local-part** is published on the global leaderboard. No consent gate for this fallback. |
| Privacy / report / hide controls | ❌ **Not implemented** | `is_public` exists as a column (default `TRUE`) and is read by the RLS/query filters, but **no route ever lets a client set it to `false`**, and there is no report/flag/moderation route of any kind for leaderboard entries. |
| RLS | ✅ Present, correctly scoped | See §2.4. |
| Cross-user access (IDOR) | ✅ No issue found | See §2.4/§2.5. |

### 2.3 Pagination — confirmed broken (not inferred)

`GET /perfect-season/leaderboard` (`perfect_season.py:643-652`):

```python
runs = await leaderboard_repo.get_leaderboard(mode, no_respin, limit, cursor)
return LeaderboardResponse(leaderboard_enabled=True, runs=[_run_to_public(r) for r in runs])
```

`LeaderboardResponse.next_cursor` (`apps/api/app/models/perfect_season.py:118`) is **never set** — it
defaults to `None` on every response, always, regardless of whether `len(runs) == limit` (i.e., whether
more rows exist). The repository layer already has everything needed to fix this
(`leaderboard_postgres.py:32-40` defines `_encode_cursor`; `leaderboard_memory.py` even exports
`encode_leaderboard_cursor = _encode_cursor` at module level) — it is simply never called from the route.
The **request-side** `cursor` query param is fully implemented and honored (keyset pagination via a
row-wise comparison, `leaderboard_postgres.py:129-142`); only the response never tells the client what
cursor to send next.

This is a real, verifiable regression relative to the codebase's own established pattern: the Ranked
leaderboard route in the same codebase does this correctly —
`apps/api/app/api/v1/ranked.py:458`: `next_cursor = _build_leaderboard_cursor(ratings[-1]) if len(ratings) == limit else None`.
No test in `apps/api/tests/test_perfect_season.py` asserts on `next_cursor` (confirmed by grep — zero
matches), so nothing currently guards against this gap.

**Practical effect:** a client can request `limit` rows and a `cursor`, but has no way to construct the
`cursor` for page 2 unless it already knows the last row's own field values and replicates the encoding
client-side — i.e., pagination beyond page 1 does not work through the documented API contract.

### 2.4 RLS review

All owner-scoped/leaderboard tables have RLS **enabled**, following one consistent, explicitly-documented
pattern (`supabase/migrations/20260630130000_ranked_rls.sql`'s own comment, repeated verbatim in every
later migration): the API connects with a **service-role** Postgres connection and enforces
ownership/visibility in application code; RLS is a **second, independent layer** in case these tables are
ever exposed through Supabase's own REST API to a client holding a bare `anon`/`authenticated` key.

- `perfect_season_runs` / `perfect_season_run_cards`: public SELECT only where `is_public = TRUE`; owner
  can always SELECT their own rows; INSERT only as `auth.uid() = owner_sub`; **no UPDATE/DELETE policy at
  all**, so submitted runs are immutable under RLS by omission (not by an explicit deny-rule, but the
  effect is the same: no matching policy = denied). Confirmed correct for the stated "immutable submitted
  runs" design.
- `run_the_table_runs`: **no public-read policy exists** — private-by-default, owner-only SELECT/
  INSERT/UPDATE/DELETE. The migration's own comment explains why: a run's `snapshot` contains
  unrevealed bosses/offers, which is spoiler material, so sharing is done only via a signed challenge
  token carrying the seed, never by another user reading the row directly.
- Anonymous owners (`owner_sub` = an anon-cookie subject, not a Supabase `auth.uid()`): `auth.uid()` is
  `NULL` for these, so RLS policies match **nothing** for them — correctly documented as intentional
  ("an anon key can never reach an anonymous player's run through Supabase's REST API at all"; the API's
  service-role connection is the only path, and it does its own `owner_sub` check in
  `apps/api/app/services/run_the_table/runs.py:load_run`).
- Defense-in-depth follow-through: `20260801170000_revoke_truncate_and_trigger.sql` found and closed a
  **real gap** — `TRUNCATE` (a table-level operation RLS row-policies cannot filter at all) and `TRIGGER`
  were still granted to `anon`/`authenticated` on every owner-scoped table via the blanket
  `GRANT ... ON ALL TABLES` in `20260630130100_default_privileges.sql`. The migration itself is careful to
  state this is "a defence-in-depth finding, not a live breach" since PostgREST does not expose `TRUNCATE`
  and the deployed topology does not hand out direct Postgres connections as those roles — an honest,
  non-inflated severity call worth preserving in any summary of this audit.

**No cross-user access (IDOR) issue found** in the code paths read: every owner-scoped mutation route
checks `game_state.owner_sub != auth.sub` (or the RTT/daily-grid equivalent) before acting, and RLS
independently backs that check at the database layer for the direct-Postgres-REST-API threat model.

### 2.5 `PEAK3_COURTBUILDER_LEADERBOARD_ENABLED` — current state

`apps/api/app/core/config.py:222`: `COURTBUILDER_LEADERBOARD_ENABLED: bool = False` — **off by default**.
Gated behind two flags stacked: `_require_courtbuilder_enabled()` (CourtBuilder/82-0 play itself) **and**
`_require_leaderboard_enabled()` (this flag specifically) on every submit/read/me-runs route. When off,
`GET /perfect-season/leaderboard` returns `{leaderboard_enabled: false, runs: [], next_cursor: null}`
rather than an error — a documented "read is public once enabled" contract (route comment,
`perfect_season.py:494-500`).

### 2.6 What's missing to complete an authenticated global 82-0 leaderboard

In order of what would actually block turning the flag on in production:

1. **Migration never applied to hosted Supabase.** `20260724150000_perfect_season_leaderboard.sql`'s own
   header states: *"LOCAL MIGRATION ONLY — not applied to hosted Supabase as part of this pass...
   `supabase link`/`supabase db push` were never run."* The same is true of
   `20260729180000_perfect_season_saved_runs.sql`, `20260730190000_daily_grid_results.sql`, and
   `20260731090000_run_the_table.sql`. **The leaderboard tables do not exist in the hosted database today**
   — this is the primary blocker, ahead of any application-code gap.
2. **Pagination is broken** (§2.3) — `next_cursor` must actually be computed and returned.
3. **No personal-placement endpoint** — a player has no way to see their own rank/percentile on the global
   board short of paging through it entirely (and pagination doesn't currently work past page 1 anyway).
4. **No privacy/report/hide controls** — `is_public` is write-only-at-insert with no client-facing route to
   flip it, and there is no abuse-report path for a leaderboard entry (e.g., an inappropriate
   `display_name`).
5. **Public-handle privacy fallback** — the email-local-part fallback for `display_name` (§2.2) should be
   reconsidered before any leaderboard entry is shown to strangers by default; at minimum it should require
   explicit opt-in rather than silently deriving a possibly-identifying string from the account email.
6. **`COURTBUILDER_LEADERBOARD_ENABLED` stays `False`** until the above are resolved and a readiness
   decision is made (see `COURTBUILDER_READINESS_LEVEL`, currently `"disabled"`, which the config module
   validates for consistency with the booleans above).

None of items 2-5 require touching `OFFICIAL_WEIGHTS`, `calibrate_score()`, or any leaderboard CSV — they
are API/schema/product-flow work, in scope for whatever implementation task follows this audit (task board
item `#7 P3-K`).

---

## 3. TASK #15 (P1-E) — RTT opening-reveal identity leak + batched reveal

Routed from rtt-experience's Phase 1 audit; confirmed independently against the source below (not taken
on faith).

### 3.1 Confirmed: unrevealed identities ARE serialized from the first frame

`apps/api/app/services/run_the_table/public.py`:

```python
# lines 111-117
def _slot_public(pool: CardPool, slot, systems: list[str]) -> dict:
    return {
        "slot_id": slot.slot_id,
        "role": slot.role,
        "is_starter": slot.is_starter,
        "card": card_public(pool, slot.card_id, systems) if slot.card_id else None,
    }
```

```python
# lines 698-699, inside public_state()
"starters": [_slot_public(pool, s, state.systems) for s in state.starters],
"bench": [_slot_public(pool, s, state.systems) for s in state.bench],
```

The only gate is `slot.card_id else None` — whether a card is *assigned* to the slot, never whether it has
been *revealed*. `state.starters`/`state.bench` are populated with real card ids at run creation,
unconditionally, before any reveal has happened:

```python
# nba_peak/run_the_table/state.py:167,175-180 (create_run)
starters = [
    RosterSlot(slot_id=role, is_starter=True, role=role, card_id=cid)
    for role, cid in zip(ROLES, blueprint.starting_starters)
]
bench = [
    RosterSlot(slot_id=sid, is_starter=False, role=None, card_id=cid)
    for sid, cid in zip(BENCH_SLOT_IDS, blueprint.starting_bench)
]
...
reveal_index=0,   # line 215 — separate counter, gates nothing about `starters`/`bench` above
```

`card_public()` (`public.py:85-108`) returns the full identity: `player_name`, `player_slug`,
`anchor_season`, `window_label`, `prime_score`, `overall_percentile`, `eligible_roles`, `lane_index`,
`lane_percentiles`, `base_cost`, `cost`, `cost_modifiers`, `refund_value` — i.e. everything, including the
five raw component lanes. So **every `GET`/`POST` response for a brand-new run ships all 7 real
identities in the top-level `starters`/`bench` fields**, regardless of `state.reveal_index`, from the very
first frame — confirmed, not inferred.

This is a genuine payload contract bug, not a hypothetical: the client-side gating
(`needsOpeningReveal()`/`RevealReel.tsx`) only controls what is *rendered*; a player who opens devtools,
or any other consumer of the same API response, already has the full roster before the reveal animation
plays a single card.

**Contrast with the boss side, which is correct:** `boss_public()` (`public.py:125-175`) gates the entire
roster block behind a boolean:

```python
# public.py:159-174
out["revealed"] = revealed
if revealed:
    ...
    out["starters"] = [card_public(pool, cid, []) for cid in boss.starter_ids]
    out["bench"] = [card_public(pool, cid, []) for cid in boss.bench_ids]
    out["lane_profile"] = [...]
    out["roster_total"] = roster_total(profile)
```

If `revealed` is `False`, none of `starters`/`bench`/`lane_profile`/`roster_total` are present in the
response at all — not nulled, *absent*. The player-side serializer needs the same discipline.

### 3.2 Confirmed: the lower-severity aggregate leak

`public_state()` lines 710-721 compute `lane_profile`, `roster_total`, and `bench_weight` from
`player_lane_profile(pool, starters, bench, state.systems, None)` — the **complete real roster**,
independent of `state.reveal_index`. Even in a hypothetical fixed world where `starters`/`bench` conceal
unrevealed *names*, these three top-level fields still leak the unrevealed cards' *strength* in aggregate
from frame one: a player who reveals cards 1-5 and watches `roster_total` can back out bounds on the
combined value of cards 6-7 before ever seeing them, because the number was never withheld.

Checked whether any legitimate consumer needs these during an active reveal: `RunTheTableGame.tsx` renders
`needsOpeningReveal(state)` **before** the `screen === "system_select"` branch (confirmed at
`RunTheTableGame.tsx:653` vs. `:682` — the reveal check is strictly first in the if/else-if chain), so
`SystemSelect` (the only other surface reachable at `status: "system_select"`) is never on screen
concurrently with an incomplete reveal. There is no legitimate frontend consumer of these three fields
while `!reveal.roster.complete`, so withholding them has no product cost.

### 3.3 Proposed corrected payload contract

**Payload-only fix. No authoritative score changes** — `battle.resolve_battle` and every other engine
function already read `state.starters`/`state.bench` card ids directly, server-side; nothing about what
is *computed* for a battle, a receipt, or persistence changes. Only what is *serialized to the client*
changes.

1. **Per-slot reveal gating**, mirroring `boss_public`'s pattern but at the finer per-card grain
   `reveal_public()` already uses internally:

   ```python
   def _slot_public(pool: CardPool, slot, systems: list[str], revealed: bool) -> dict:
       return {
           "slot_id": slot.slot_id,
           "role": slot.role,
           "is_starter": slot.is_starter,
           "card": card_public(pool, slot.card_id, systems) if (slot.card_id and revealed) else None,
       }

   # in public_state():
   "starters": [
       _slot_public(pool, s, state.systems, revealed=(i < state.reveal_index))
       for i, s in enumerate(state.starters)
   ],
   "bench": [
       _slot_public(pool, s, state.systems, revealed=(len(ROLES) + i < state.reveal_index))
       for i, s in enumerate(state.bench)
   ],
   ```

   The index arithmetic is not new: it is exactly `opening_reveal()`'s own published order
   (`generation.py:537-579` — starters 0..4 in `ROLES` order, bench at `len(ROLES) + idx`), and
   `create_run` already builds `state.starters`/`state.bench` in that same order
   (`zip(ROLES, blueprint.starting_starters)`), so no new ordering concept is introduced — this reuses the
   one that already exists and that `reveal_public()` already trusts. Once `reveal_index` reaches
   `ROSTER_SIZE` (reveal complete, which is unconditionally true for any run past act 1), every slot is
   `revealed=True` and the payload is identical to today's — this only withholds cards during the narrow
   window that is actually still hidden.

2. **Withhold the aggregates until the roster reveal is complete**, same all-or-nothing shape as
   `boss_public`'s gate:

   ```python
   roster_revealed = state.reveal_index >= ROSTER_SIZE
   ...
   "lane_profile": (
       [ ... ] if roster_revealed else None
   ),
   "roster_total": roster_total(profile) if roster_revealed else None,
   "bench_weight": p_bw if roster_revealed else None,
   ```

   (Or omit the keys entirely rather than nulling them, matching `boss_public`'s "absent, not null"
   convention — either is fine; the frontend already gates on `needsOpeningReveal()` and never renders
   these during the reveal regardless, so this is a hardening change with no visible product impact for a
   client that behaves correctly today.)

3. A run resumed after act 1 (the overwhelmingly common case, and the only path for daily/challenge runs
   reopened later) has `reveal_index` already saturated at `ROSTER_SIZE` from having finished act 1's
   reveal, so this change is invisible outside the opening-reveal window — no other screen's payload shape
   changes.

Existing coverage this should extend rather than replace: `apps/api/tests/test_run_the_table.py` already
asserts end-to-end determinism of the reveal sequence; a new test should assert that `starters[i].card` /
`bench[i].card` are `None` for `i >= state.reveal_index` and that `lane_profile`/`roster_total`/
`bench_weight` are absent/`None` while `reveal_index < ROSTER_SIZE`, on a freshly created run before any
`reveal` action is taken.

### 3.4 Batched reveal — the round-trip count, and why the fix is smaller than it sounds

**Confirmed:** the "Reveal next player" button always sends `count=1`
(`RevealReel.tsx:165`, `onClick={() => onReveal(1)}`), and "Skip all" only appears once
`track.can_skip` is true, which is the server's own rule `0 < revealed < total`
(`public.py`'s `reveal_public()`, mirrored in `RevealReel.tsx:173-175`'s comment) — i.e. it never appears
before at least one card has already been revealed. So the two paths are exactly as described: **7 round
trips** if a player reveals card-by-card (one `POST /run-the-table/runs/{id}/actions` per card), or
**2 round trips minimum** (1 "reveal next" + 1 "skip all" for the remaining 6) if they skip early. Same
shape for the 7-slot boss reveal at every act.

**However:** the backend action this calls, `action_reveal` (`nba_peak/run_the_table/state.py:1039-1082`),
**already accepts an arbitrary `count`** and saturates at `ROSTER_SIZE` — its own docstring states this
directly: *"`count` may exceed what is left; it saturates at the roster size, which is what makes the
skip-all button one call."* The frontend action builder
(`apps/web/src/lib/run-the-table-api.ts:runActions.reveal`) and state helper
(`apps/web/src/lib/run-the-table-state.ts:skipAllCount`) already exist and already implement "send the
true remaining count in one call" for the skip-all path. **The server-side atomic batch primitive already
exists; it is simply never used for the *default* (non-skip) path**, because the product intent for that
path is a card-by-card animated reveal, and today "animated" is implemented as "one network round trip per
animation frame."

**Proposed batched/atomic shape** (preserves server authority; the client never invents an outcome):

- Client sends **one** `reveal` action with `count = ROSTER_SIZE` (or any value `>= remaining`) the moment
  the reveal screen mounts — functionally identical to today's "skip all," just issued automatically and
  immediately instead of waiting for a player tap.
- The single response already contains everything needed to animate all 7 cards locally:
  `reveal.roster.revealed_slots` is populated for every slot up to `revealed` (already implemented,
  `public.py:401`, `reveal_public()`), so after this one call the client holds the full **server-decided,
  server-ordered** list of 7 real cards.
- The client then re-plays the existing per-card `motion` stagger (`RevealReel.tsx`'s `motion.div` enter
  transition) **entirely client-side**, on data it already has — no further network calls, no client-side
  randomness, no invented card ever shown: every card the animation lands on is the exact card the single
  server response already named, just paced with local `setTimeout`/stagger instead of gated behind a
  round trip per card.
- "Reveal next" / "Skip all" as separate user affordances become unnecessary under this shape (there is
  nothing left to skip — the reveal is a single instant fetch with a client-paced animation on top), but if
  product wants to preserve manual pacing as a feature (e.g. for suspense), the same one-call-then-animate
  approach still works with the manual "next" button advancing a **local** animation index bounded by data
  already on the client, rather than issuing a new `reveal` action per press. Either way, network round
  trips for a full reveal drop from 7 (or 2, minimum, today) to **1**.
- Determinism is unaffected: `opening_reveal()`/`boss_reveal_order()` already fully determine the sequence
  from `(seed, versions)` before any reveal action is taken; batching the reveal call changes *when* the
  client learns the sequence, never *what* the sequence is or who decides it.
- Idempotency is unaffected: the existing `idempotency_key` scheme
  (`` `reveal:${target}:${state.action_count}` ``) already handles a double-submitted single call the same
  way it handles a double-submitted `count=1` call today.

This is a frontend-driven behavior change (call `reveal` once with the full count instead of on every
tap) with **no required backend code change** — `action_reveal`'s `count` saturation already supports it.
The backend change in §3.3 (per-slot reveal gating) is what makes this safe: today, batching the reveal
call to `count=7` would be harmless from a spoiler standpoint only because the spoiler already happened at
run creation regardless; once §3.3 lands, the reveal action becomes the *only* legitimate way to learn
each card's identity, which is what makes "one call, then animate locally" a real fix rather than a
no-op.

---

## 4. Constraints honored

- `OFFICIAL_WEIGHTS` and `calibrate_score()` unmodified (grep-verified: no diff in `peak3.py`).
- No `leaderboards/*.csv` file modified (sha256 hashes in §0 match the task brief's supplied baseline
  exactly).
- No secrets committed; no `.env` file touched.
- No merge to `main`; all work on `wt/arena-score` in the isolated worktree.
