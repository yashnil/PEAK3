# Lead's independent leaderboard finding

Recorded **before** `identity-community` reported, so its conclusion can be
cross-checked rather than absorbed. Read-only `GET` against staging; nothing
was written or deleted.

## The data

`GET /api/v1/perfect-season/leaderboard?limit=50` → **32 rows, every one named
`test`, all 32 row ids distinct.**

| Seed | Rows | `created_at` (times, 2026-08-01) |
| --- | --- | --- |
| 102 | 4 | 17:29:47 · 17:32:45 · 17:35:10 · 21:11:04 |
| 201 | 4 | 17:30:13 · 17:33:11 · 17:35:36 · 21:11:34 |
| 202 | 4 | 17:30:21 · 17:33:19 · 17:35:43 · 21:11:41 |
| 203 | 4 | 17:30:28 · 17:33:27 · 17:35:50 · 21:11:48 |
| 301 | 4 | 17:30:37 · 17:33:35 · 17:35:58 · 21:11:57 |
| 302 | 4 | 17:30:44 · 17:33:43 · 17:36:05 · 21:12:05 |
| 401 | 4 | 17:30:53 · 17:33:52 · 17:36:14 · 21:12:14 |
| 501 | 4 | 17:31:01 · 17:34:01 · 17:36:23 · 21:12:23 |

**8 fixed seeds × 4 executions = 32 rows.** Each batch walks the same eight
seeds in the same order at ~7–9 s intervals and completes in 73–79 s. That is a
script, not a person.

All 32 share `mode=apex_1y`, `game_type=peak_season`,
`data_version=courtbuilder_team_year.experimental.v3`, `score_status=complete`.

## Root cause: environment contamination, NOT an idempotency defect

Within each batch, **each seed appears exactly once**. Every row is a genuinely
distinct game. So an automated fixture script ran four times against the
deployed staging database through the public submission route, each execution
creating eight fresh games under one account whose `display_name` is `test`.

This rules three hypotheses **out**, on evidence:

| Hypothesis | Verdict | Evidence |
| --- | --- | --- |
| Test suites wrote into staging | **TRUE — this is the cause** | 8-seed fixture list, 4 identical scripted batches |
| One completed game submits repeatedly | **FALSE** | one row per seed per batch; `game_id` UNIQUE idempotency is working |
| UI duplicates rows client-side | **FALSE** | 32 distinct row ids returned by the API itself |
| Pagination cursor repeats records | **FALSE** | 32 rows < `limit=50`, `next_cursor: null` correctly |
| Multiple ruleset boards mixed | **FALSE** | single `mode`, single `data_version` |

So the previous pass's idempotency guarantee holds. **The fix is not more
deduplication — it is preventing fixtures from reaching a deployed database,
plus a provenance-scoped cleanup.**

## Cleanup criteria — provenance, not name

`display_name='test'` must **not** be the deletion key: a real user may legitimately
choose that handle. The defensible predicate is the conjunction of:

- the same `owner_sub` (not exposed publicly — `identity-community` must confirm
  all 32 share one, from the database);
- `seed ∈ {102, 201, 202, 203, 301, 302, 401, 501}`;
- `created_at` within `2026-08-01T17:29Z … 2026-08-01T21:13Z`;
- `data_version = 'courtbuilder_team_year.experimental.v3'`;
- `mode = 'apex_1y'`.

Any row failing **any** clause is out of scope for cleanup. Expected removal:
**32 rows**. Before-count to be re-confirmed at execution time.

Privacy check passed incidentally: `owner_sub` is **not** in the public payload.

## Second-order effect worth noting

Rows show `(team_respins_used, season_respins_used)` of both `(0,0)` and `(1,0)`.
With the "No-respin runs only" filter the brief asks us to remove, part of even
this contaminated set is hidden — and a real user's respin runs would be too.
That filter is suppressing legitimate play, which is the brief's stated reason
for removing it.
