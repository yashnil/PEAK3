# Reconciling the 81-1 run onto the 82-0 leaderboard

**Nothing in this document has been run.** It is the exact command sequence,
the exact expected output, and the exact preconditions, derived from
`scripts/reconcile_perfect_season_leaderboard.py`,
`apps/api/app/repositories/leaderboard_postgres.py` and
`apps/api/app/api/v1/perfect_season.py` as they stand.

| | |
|---|---|
| `games.id` | `e564b8d3-4c1f-4d09-8f8c-16e83ecd1104` |
| status | `result_ready` |
| record | 81-1 |
| lineup score | 77.3 |
| completed | `games.updated_at` = 2026-08-04 05:10:08 UTC |
| on `perfect_season_runs` | no |
| the one blocker | the owning account has no `profiles` row, so no public handle |

---

## 0. Before anything: the precondition that is not a command

The tool **refuses** with `handle_required` until the owning account has a
public handle. That refusal is deliberate and is the same one `submit_run`
makes: the board displays handles and only handles, so inventing one would
publish an identity its owner never chose.

**The owner sets a handle at `/profile` on the staging web app.** No script
does this, and no script should — it is the one step that is a person's choice
rather than a data repair.

---

## 1. Environment the commands need

Run from the repository root, on a machine that can reach the staging Postgres.
The script puts both the repo root and `apps/api` on `sys.path` itself.

| Variable | Value | Why |
|---|---|---|
| `PEAK3_DATABASE_URL` | the staging Supabase Postgres connection string (session pooler) | the script's default source for `--database-url`; it connects with `asyncpg` |

Nothing else is read. In particular the script does **not** read
`PEAK3_COURTBUILDER_LEADERBOARD_ENABLED`: that flag gates the HTTP route, and
this tool writes through the repository directly. Turning the flag on is what
makes the board *readable* and future submissions *possible*; it is not a
precondition for reconciliation.

```bash
export PEAK3_DATABASE_URL='postgresql://…'   # staging, session pooler
```

`--database-url` is available if you would rather not export it:

```bash
python scripts/reconcile_perfect_season_leaderboard.py \
  --game e564b8d3-4c1f-4d09-8f8c-16e83ecd1104 \
  --database-url 'postgresql://…'
```

---

## 2. Dry run — the default, and it writes nothing

```bash
python scripts/reconcile_perfect_season_leaderboard.py \
  --game e564b8d3-4c1f-4d09-8f8c-16e83ecd1104
```

`--apply` is required to write. Without it the script performs three reads
(`games`, `perfect_season_runs`, `profiles`), runs the full decision, and
prints a verdict.

### Expected output **before** the handle exists (what it printed on the audit)

```json
{
  "mode": "dry-run",
  "candidates": 1,
  "reconciled": 0,
  "would_reconcile": 0,
  "already_present": 0,
  "refused": 1,
  "verdicts": [
    {
      "game_id": "e564b8d3-4c1f-4d09-8f8c-16e83ecd1104",
      "owner_sub": "…",
      "action": "refused",
      "reason": "handle_required",
      "wins": 81,
      "losses": 1,
      "lineup_score": 77.3,
      "missing": ["profiles.handle"]
    }
  ]
}
```

### Expected output **once the owner has a public handle**

```json
{
  "mode": "dry-run",
  "candidates": 1,
  "reconciled": 0,
  "would_reconcile": 1,
  "already_present": 0,
  "refused": 0,
  "verdicts": [
    {
      "game_id": "e564b8d3-4c1f-4d09-8f8c-16e83ecd1104",
      "owner_sub": "…",
      "action": "would_reconcile",
      "reason": "dry_run",
      "detail": "Every check passed. Re-run with --apply to write.",
      "wins": 81,
      "losses": 1,
      "lineup_score": 77.3,
      "display_name": "<the handle they chose>",
      "completed_at": "2026-08-04 05:10:08+00:00"
    }
  ]
}
```

`action: "would_reconcile"` with `reason: "dry_run"` is the only output that
means "apply would write a row". Anything else is a refusal, and each refusal
names what is missing:

| `reason` | Meaning |
|---|---|
| `no_canonical_game` | no `games` row with that id — there is nothing authoritative to derive from |
| `game_not_complete` | `status != result_ready`, or no `simulation_result` |
| *(an eligibility reason)* | quoted verbatim from `state_machine.compute_eligibility` |
| `handle_required` | the account has no public handle |
| `already_on_the_board` | a `perfect_season_runs` row already exists for this `game_id` |

---

## 3. Apply

```bash
python scripts/reconcile_perfect_season_leaderboard.py \
  --game e564b8d3-4c1f-4d09-8f8c-16e83ecd1104 \
  --apply
```

Expected:

```json
{
  "mode": "apply",
  "candidates": 1,
  "reconciled": 1,
  "would_reconcile": 0,
  "already_present": 0,
  "refused": 0,
  "verdicts": [
    {
      "game_id": "e564b8d3-4c1f-4d09-8f8c-16e83ecd1104",
      "action": "reconciled",
      "reason": "written",
      "run_id": "<uuid the database assigned>",
      "wins": 81,
      "losses": 1,
      "lineup_score": 77.3,
      "display_name": "<the handle>"
    }
  ]
}
```

The write goes through `PostgresPerfectSeasonLeaderboardRepository.submit_run`
— the same method the HTTP route calls — so the row is byte-for-byte the row a
successful submission would have produced. Every scored field is derived from
`games.payload.simulation_result`, never from `perfect_season_saved_runs`.

---

## 4. Idempotency

**Guaranteed by the schema, not by a check.** `perfect_season_runs.game_id` is
`UNIQUE`, and `submit_run` translates the violation into
`DuplicateRunSubmission`.

Running `--apply` a second time takes the earlier branch and never reaches the
insert: the `perfect_season_runs` lookup finds the row, `decide` returns
`action: "already_present"` with `reason: "already_on_the_board"` and the
existing `run_id`, and **nothing is written**.

```json
{
  "mode": "apply",
  "candidates": 1,
  "reconciled": 0,
  "already_present": 1,
  "refused": 0,
  "verdicts": [
    {
      "game_id": "e564b8d3-4c1f-4d09-8f8c-16e83ecd1104",
      "action": "already_present",
      "reason": "already_on_the_board",
      "run_id": "<the uuid from the first run>",
      "detail": "Already leaderboard row … at 81-1. `game_id` is UNIQUE, so this script is idempotent by the schema rather than by a check."
    }
  ]
}
```

The same holds if the owner re-submits from the result screen after the flag is
on: the route's own duplicate handling returns the existing run rather than a
second row.

---

## 5. Verification

### Through the API — what a visitor would see

```bash
curl -s 'https://<api-host>/api/v1/perfect-season/leaderboard?limit=10' | jq
```

Expect `leaderboard_enabled: true` (requires
`PEAK3_COURTBUILDER_ENABLED=true` **and**
`PEAK3_COURTBUILDER_LEADERBOARD_ENABLED=true` on Railway) and the run as a row.

### Against the database — the authoritative check

```sql
SELECT id, owner_sub, display_name, mode, game_id, wins, losses,
       lineup_score, score_status, exact_cards_scored, total_cards,
       team_respins_used, season_respins_used, created_at
FROM perfect_season_runs
WHERE game_id = 'e564b8d3-4c1f-4d09-8f8c-16e83ecd1104';
```

Expect exactly one row: `wins = 81`, `losses = 1`,
`lineup_score = 77.3`, `score_status = 'complete'`,
`exact_cards_scored = total_cards = 8`, and `created_at =
2026-08-04 05:10:08+00` — see below.

And the roster, which is written in the same transaction:

```sql
SELECT slot_index, card_key
FROM perfect_season_run_cards
WHERE run_id = (SELECT id FROM perfect_season_runs
                WHERE game_id = 'e564b8d3-4c1f-4d09-8f8c-16e83ecd1104')
ORDER BY slot_index;
```

Expect eight rows.

---

## 6. Is the original completion timestamp preserved?

**Yes — and it was not before this pass.** This is a behaviour change, made
deliberately, and it is the one thing in this document that is not purely a
report of existing code.

`PerfectSeasonRun.created_at` defaults to `datetime.now(timezone.utc)`. That is
right for a live submission, where the run genuinely was just completed, and
wrong for every row a backfill writes. `build_run` did not pass the field, so a
reconciled 81-1 would have been stamped with the clock of whoever ran the
script.

That matters because `created_at` is not decoration. `list_runs` orders by

```
wins DESC, lineup_score DESC, (team_respins_used + season_respins_used) ASC, created_at ASC
```

and pages on that same tuple, so `created_at` is the final tie-break between
two otherwise identical runs — and it is the only field on the row that says
when any of this happened.

`build_run` now passes `created_at = games.updated_at` (tz-aware UTC), which is
the completion timestamp: `action_complete_game` is the write that produced the
`simulation_result` the row is derived from. It falls back to "now" only if the
game row carries no timestamp at all. Two tests pin both halves
(`test_the_row_carries_the_completion_time_not_the_backfill_time`,
`test_a_game_with_no_timestamp_still_reconciles`).

So for this run the leaderboard row will carry **2026-08-04 05:10:08+00**, not
the date of the reconciliation.

---

## 7. What this does not promise

The board is empty, so on today's data an 81-1 entry would be the only row and
therefore first. That is a statement about an empty table, not about the run.
The ordering it is subject to is wins ↓, lineup score ↓, fewer respins ↑,
earliest completion ↑ — and this run used four respins, which is a real
tie-break cost against a future 81-1 played clean.
