# The 82-0 PEAK Season leaderboard: audit, defect and reconciliation

Read-only audit of the hosted database, performed from this branch. **No row
was written, updated or deleted**, and no hosted environment variable was
changed. Every figure below is a query result.

Scope: the **82-0 PEAK Season** board (`perfect_season_runs`,
`PEAK3_COURTBUILDER_LEADERBOARD_ENABLED`). It is not Arena ratings, the Arena
multiplayer leaderboard, Ranked, Three-Man Weave or the $20 Showdown — all of
which stay disabled.

---

## 1. What the board contains

```
SELECT count(*) FROM perfect_season_runs;   ->  0
```

**The board has never held a row.** The 32 rows an earlier pass found and
cleaned up (`launch-polish/LEAD_LEADERBOARD_FINDING.md` — a fixture script that
reached staging) are gone, and nothing has been submitted since.

Meanwhile:

```
SELECT count(*) FROM perfect_season_saved_runs;  ->  41
SELECT count(*) FROM games WHERE status='result_ready';  ->  364
```

364 completed, simulated runs exist. None of them is on the board.

---

## 2. The exact submission defect

It is not a bug in the submission path. **The submission path has never been
reachable.**

`POST /perfect-season/games/{game_id}/submit` opens with:

```python
_require_courtbuilder_enabled()
_require_leaderboard_enabled()      # 403 leaderboard_not_enabled
```

and `Settings.COURTBUILDER_LEADERBOARD_ENABLED` defaults to `False`. That flag
appears in **no** environment file in this repository:

| File | `PEAK3_COURTBUILDER_LEADERBOARD_ENABLED` |
|---|---|
| `apps/api/.env` (what `make api` reads) | absent → False *(now set, locally)* |
| `apps/api/.env.example` | **absent entirely** *(now documented)* |
| `scripts/ci/e2e-tests.sh` | absent → False |

So every submission any player has ever attempted returned 403, and
`GET /perfect-season/leaderboard` returned `leaderboard_enabled: false`, which
the UI rendered as *"The global leaderboard isn't enabled yet."* That message
was accurate. The problem was that nothing anywhere said which variable made it
true, because the variable was documented nowhere.

**Saving is deliberately not behind that flag** — a completed run belongs in its
owner's history whether or not a competitive board exists (`perfect_season.py`:
"Deliberately NOT behind COURTBUILDER_LEADERBOARD_ENABLED"). That is why
`perfect_season_saved_runs` filled up while `perfect_season_runs` stayed empty,
and why a player could reasonably believe a run had been recorded.

A second, independent client-side defect made the state unreadable even once
enabled: the leaderboard page's `catch` set `enabled = false`, so a **failed
request** rendered the identical sentence as a **disabled capability**. Fixed
separately — see §6.

### Ruled out, on evidence

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Submission writes but the read query hides rows | **False** | The table is empty; there is nothing for a query to hide |
| An idempotency bug swallows submissions | **False** | `game_id` is `UNIQUE`; no row exists to have collided with |
| Scores are client-submitted and rejected | **False** | `SubmitRunRequest` carries only `game_id`; every scored field is recomputed server-side |
| RLS blocks the insert | **False** | The API writes through a service-role connection; RLS is defence in depth (`20260724150000_perfect_season_leaderboard.sql`) |
| Eligibility rejects real runs | **False** | Every saved run for the audited account carries `leaderboard_eligible = true` |
| The capability was never enabled | **TRUE — this is the cause** | The flag is absent from every environment file |

---

## 3. The user's 81–1 run — found, and authoritative

**The record exists.** Not a screenshot, not a share URL: the canonical
server-side game.

| | |
|---|---|
| `games.id` | `e564b8d3-4c1f-4d09-8f8c-16e83ecd1104` |
| `games.status` | `result_ready` |
| `games.owner_sub` | `c3d1ba74-0c42-481b-a87d-5481d3810eb0` |
| mode | `apex_1y` |
| board seed | `431465972` |
| `simulation_result.wins / losses` | **81 / 1** |
| `simulation_result.lineup_peak_score` | **77.3** |
| `simulation_result.simulator_version` | `perfect_season_simulator_v1` |
| slots exactly scored | 8 of 8 |
| respins | 2 team, 2 season |
| data version | `courtbuilder_team_year.experimental.v3` |
| completed | 2026-08-04 05:10:08 UTC |
| roster | Curry 2015-16 · Kawhi 2018-19 · Bird 1983-84 · Malone 1998-99 · Jokić · Pierce · Kidd · Erving |

The matching saved run (`perfect_season_saved_runs.2022dd2c-…`) carries
`leaderboard_eligible = true` and `score_status = complete`, computed by the
same `compute_eligibility` helper the submit route uses.

`perfect_season_runs` has no row for this `game_id`. It never could have.

A second eligible run by the same account is present at 75–7 (`092f191c-…`,
lineup score 67.6).

### Can it be safely reconciled? Yes — after one thing the user must do

`scripts/reconcile_perfect_season_leaderboard.py` derives a leaderboard entry
from the canonical `games` row through the same helpers, in the same order, as
`submit_run`. Run against the hosted database in **dry-run** (its default), it
reports:

```json
{
  "action": "refused",
  "reason": "handle_required",
  "game_id": "e564b8d3-4c1f-4d09-8f8c-16e83ecd1104",
  "wins": 81, "losses": 1, "lineup_score": 77.3,
  "missing": ["profiles.handle"]
}
```

Every scored check passed. The one blocker is that **this account has no
`profiles` row at all**, so it has no public handle — and the board displays
public handles and nothing else. `submit_run` refuses for exactly this reason,
deliberately: a silent auto-generated fallback would publish an identity its
owner never chose, and would mean the "require a valid handle" rule was never
actually enforced (`launch-polish/IMPLEMENTATION_CONTRACT.md` §8).

**So the fix is one action by the account owner, not a data repair:** set a
public handle at `/profile`. After that, either path puts the run on the board:

* re-submit from the run's own result screen (now that the capability is on), or
* run the reconciliation tool with `--apply`.

Both are idempotent against the same `game_id UNIQUE` constraint, so doing both
produces one row.

### Where would 81–1 rank?

**Nowhere is knowable yet, and #1 is not promised.** The board is empty, so on
today's data an 81–1 entry would be the only row and therefore first. That is a
statement about an empty table, not about the run's standing, and it will stop
being true the moment anyone else submits. The ordering it will be subject to
is: wins desc → lineup score desc → fewer respins first → earliest submission
first. This run used four respins, which is a real tie-break cost against a
same-record, same-score run that used none.

---

## 4. What was audited and found correct

Nothing below needed changing; each was checked because a leaderboard that
looks right and ranks wrong is worse than one that is off.

| Property | Where | Verdict |
|---|---|---|
| Client cannot submit a score | `SubmitRunRequest` carries only `game_id` | correct |
| Every field recomputed server-side | `submit_run` reads `game_state.simulation_result` | correct |
| Ownership enforced | `game_state.owner_sub != auth.sub` → 403 | correct |
| Unfinished run rejected | `status != "result_ready"` → 400 | correct |
| Anonymous submission rejected | `auth.is_anonymous` → 401 | correct |
| One entry per completed run | `game_id UNIQUE` + `DuplicateRunSubmission` → returns the original | correct |
| Refresh does not duplicate | idempotent replay returns the first row | correct |
| Server timestamp | `created_at DEFAULT NOW()` | correct |
| Deterministic ordering | wins ↓, score ↓, respins ↑, `created_at` ↑ | correct |
| Keyset pagination | row-wise `ROW(...) > ROW(...)` on the same key | correct |
| RLS public read / owner read / owner insert, no UPDATE or DELETE policy | migration 017 | correct |
| Submitted runs immutable except `is_public` | service-role, single-column, ownership-scoped | correct |
| Handle required, never derived from email | `profile.handle` or 400 | correct |

Two gaps were real and are closed in this pass: the public row carried **no
`game_id`**, so a board row asserted a record with no route to the roster behind
it; and `GET /perfect-season/leaderboard/me` existed on the API with **no client
at all**, so a player could read the board and never see their own place on it.

---

## 5. Enabling it — the exact settings

**Nothing here was applied to a hosted environment in this pass.**

### API (Railway, or wherever `apps/api` runs)

```
PEAK3_COURTBUILDER_ENABLED=true
PEAK3_COURTBUILDER_LEADERBOARD_ENABLED=true
PEAK3_COURTBUILDER_READINESS_LEVEL=internal_alpha   # or public_beta
PEAK3_DATABASE_URL=<the Supabase Postgres URL>      # already set
```

`PEAK3_COURTBUILDER_READINESS_LEVEL` has **no `closed_alpha` member** (unlike
the Arena's) — the accepted values are `disabled | internal_dev |
internal_alpha | public_beta`, and setting `closed_alpha` is a startup
`ValidationError`.

Leave these **off**, as they are now:

```
PEAK3_ARENA_RATINGS_ENABLED=false
PEAK3_ARENA_LEADERBOARD_ENABLED=false
PEAK3_ARENA_PUBLIC_QUEUE_ENABLED=false
PEAK3_RANKED_PUBLIC_LEADERBOARD_ENABLED=false
```

### Supabase

Migration `20260724150000_perfect_season_leaderboard.sql` creates
`perfect_season_runs` and `perfect_season_run_cards` with their RLS policies.
**Both tables already exist in the hosted project** (verified by the audit
above), so no migration needs applying.

### Vercel (`apps/web`)

Nothing. There is no frontend leaderboard flag: the web app reads
`leaderboard_enabled` off the API response and renders what it is told, so the
server is the single source of truth and the two cannot disagree.

---

## 6. What changed on the board itself

The read surface was a `runs.map()` of flex rows carrying an index, a handle, a
record and a score. It is now a table with rank, name, record, lineup score,
submission date, seed and a link to the run's public receipt; the number-one
entry is marked; "Your best" reads the caller's real placement from
`GET /leaderboard/me` rather than counting the rows on screen; pagination uses
the server's cursor; and the four states — loading, disabled, failed, empty —
say four different things, because a reader's next action differs in each.

The most consequential of those: **failed and disabled used to be the same
state.** A dropped request told the reader the feature was not turned on.
