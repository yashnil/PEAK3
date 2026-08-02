# PEAK3 product telemetry

First-party, privacy-conscious, **off by default**. This document is the
contract: what is collected, what is never collected, how long it lives, who
can read it, and what a report can and cannot say.

Track F of the auth / daily-reset / balance pass. Files:

| Path | Role |
|---|---|
| `apps/web/src/lib/analytics.ts` | Browser client: queues, sanitises, batches, respects DNT/GPC |
| `apps/api/app/models/telemetry.py` | The closed allowlists, the validator, the subject hash |
| `apps/api/app/api/v1/telemetry.py` | `POST /api/v1/telemetry/events` — the only route |
| `apps/api/app/repositories/telemetry_{protocols,memory,postgres}.py` | Append-only persistence |
| `supabase/migrations/20260801120000_telemetry_events.sql` | Table, indexes, RLS, retention function |
| `scripts/telemetry_report.py` | The report. Reads the database or says it cannot |
| `apps/api/tests/test_telemetry.py` | 58 tests, mostly about what *cannot* happen |

---

## 1. Never collected

This list is exhaustive and is enforced in three places — the browser strips,
the API rejects, and the schema has nowhere to put them.

* **Email addresses.** No column, no allowlisted property, and `email` is a
  named forbidden key that produces a distinct `forbidden_property` error.
  The value charset also excludes `@`.
* **OAuth tokens, magic-link tokens, access tokens, refresh tokens, ID
  tokens, API keys.** Named forbidden keys; additionally any *value* shaped
  like a JWT (`eyJ…`) or like a 32+ character opaque blob is rejected under
  **any** key.
* **The `Authorization` header, or any part of it.** Read only by the shared
  auth dependency, never by the telemetry route, never logged, never stored.
  `authorization` and `bearer` are named forbidden keys.
* **Raw `localStorage` contents.** Objects and arrays are dropped by the
  browser sanitiser and rejected by the API — the property allowlist admits
  scalars only, so "send the whole state blob" is unrepresentable.
* **IP addresses.** The client IP is a bucket dimension inside the in-process
  rate limiter (`app/core/rate_limit.py`) and nothing else. It is never
  written, never logged by this code, and there is no column for it.
* **User agents / device fingerprints.** No column, `user_agent` is a
  forbidden key, and there is no header capture anywhere on this path.
* **Free-text user input.** Search queries, chat, display names, anything the
  player typed. Enforced by the value charset: no spaces, ASCII slug
  characters only, 64 characters maximum. A sentence cannot pass it.
* **Player selections, board answers, opponent identity, ranked integrity
  signals.** No allowlisted property carries them.
* **Client clocks.** The client's own timestamp is deliberately not stored:
  it is unverifiable and clock skew is a fingerprinting surface. Ordering is
  server-observed.
* **The raw owner subject** — neither the Supabase `sub` nor the `anon:…`
  cookie subject. See §4.

If you need to add a dimension, add it to `PROPERTY_KEYS` in
`apps/api/app/models/telemetry.py` **and** `ALLOWED_PROPERTIES` in
`apps/web/src/lib/analytics.ts`, and update this document. A one-sided change
fails: the server rejects the batch (dev) or the client drops the field (prod).

---

## 2. The event allowlist (21 events, closed)

Enforced server-side; an unknown name is a `422 unknown_event` and stores
nothing. `apps/api/tests/test_telemetry.py` asserts the set literally, so
adding an event cannot happen without a human reading the diff.

| Group | Events |
|---|---|
| Identity | `auth_started`, `auth_completed`, `guest_state_claimed` |
| Session / onboarding | `game_opened`, `tutorial_completed`, `tutorial_skipped` |
| RUN THE TABLE | `run_started`, `run_ended`, `second_run_started`, `run_replayed`, `perk_selected`, `node_selected`, `card_bought`, `trade_completed`, `boss_won`, `boss_lost`, `table_cleared` |
| Social | `challenge_created`, `challenge_completed` |
| Daily | `daily_opened`, `daily_completed` |

Property keys are a second closed allowlist (31 keys: `mode`, `outcome`,
`perk`, `boss`, `act`, `duration_seconds`, `daily_key`, `run_ref`, …). Values
must be a boolean, a finite number, `null`, or a ≤64-character slug.

**Bounds.** 20 events per batch · 12 properties per event · 64 characters per
string value · 1 KB serialised properties per event · 64 KB request body.

---

## 3. Correlation without identity

Two opaque tokens minted **by the browser**, purely so the funnel can be
computed:

* `run_ref` — one random token per RUN THE TABLE run. Lets
  `perk_selected` → `run_ended` be joined, which is what makes a perk win
  rate possible. **It is not the server's `run_id`**, so it does not create a
  path from a telemetry row back to a named account.
* `session_ref` — optional, one per browser session.

---

## 4. Identity is a keyed hash

Stored: `subject_hash = HMAC-SHA256(PEAK3_SIGNING_SECRET, owner_sub)`, hex,
plus `subject_kind ∈ {anon, user}`.

**Why HMAC and not a bare digest.** Anonymous subjects are already
high-entropy (`anon:{token_urlsafe(16)}`), but authenticated subjects are
UUIDs, and an unkeyed SHA-256 of a UUID is reversible by anyone who already
holds the user table. Keying with the signing secret means a telemetry
extract — leaked, exported for analysis, handed to a contractor — cannot be
re-identified on its own.

**The deliberate cost.** `telemetry_events` **cannot be joined** to `games`,
`profiles`, `run_the_table_runs` or anything else that stores the raw
`owner_sub`. Every metric in the report is a per-subject aggregate, so nothing
needs that join, and giving it up is precisely what buys the property above.

**Known limitation, stated rather than hidden.** A guest who plays and then
signs in produces rows under two different hashes (the anon subject and the
user subject). The funnel therefore counts them as two subjects across the
claim boundary. Stitching them would require storing a mapping — which is the
re-identification table this design exists to avoid — so it is not done. The
`guest_state_claimed` event measures how often the boundary is crossed.

---

## 5. Retention: 90 days, enforced by a stamp plus a delete

1. **Every row carries `expires_at`**, set at write time to
   `created_at + PEAK3_TELEMETRY_RETENTION_DAYS` (default 90). It is a fact
   about the row, not a setting somebody can forget to apply retroactively.
2. **`telemetry_events_purge_expired()`** (in the migration) is the delete.
   Idempotent, safe at any frequency, returns the row count.
3. **Something must call it.** The migration does **not** schedule it —
   scheduling needs `pg_cron`, which is an operator decision. The honest
   status is therefore: *until an operator schedules it, the opportunistic
   purge is what runs.*
4. **Opportunistic purge.** `PostgresTelemetryRepository` runs the same delete
   at most once per hour per process on the write path. Sufficient for a
   single-process deployment; not a substitute for cron at scale.
5. **The report tells you if it is not working.**
   `scripts/telemetry_report.py` prints `expired rows on disk` and warns when
   it is non-zero. `--purge` runs the delete immediately.

To schedule it properly (operator, once, out of band):

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
SELECT cron.schedule(
    'telemetry_events_purge', '17 4 * * *',
    $$ SELECT telemetry_events_purge_expired(); $$
);
```

---

## 6. Access control

The API opens **one** asyncpg pool as the table-owning role and therefore
bypasses RLS; owner scoping across this codebase is application code, and the
policies bind PostgREST clients holding the anon/publishable key. For this
table the correct answer to such a client is *nothing at all*:

```sql
ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY telemetry_events_no_client_access ON telemetry_events
    FOR ALL USING (false) WITH CHECK (false);
REVOKE SELECT, INSERT, UPDATE, DELETE ON telemetry_events FROM anon, authenticated;
```

* **No read, not even your own.** "Read your own telemetry" is one broken
  predicate away from "read everyone's", and no product surface needs it.
* **No direct insert either.** Ingest must go through
  `POST /api/v1/telemetry/events`, which is where the allowlist, the PII
  rejection, the size caps and the rate limit live. A PostgREST insert would
  bypass all four.
* **The `REVOKE` matters.** `20260630130100_default_privileges.sql:31` sets
  `ALTER DEFAULT PRIVILEGES` so every new table in schema `public` is granted
  full CRUD to `anon`/`authenticated` automatically — including this one, the
  moment it is created. The deny policy alone would hold, but relying on "there
  happens to be no policy" makes the protection an absence rather than a
  statement. Both layers must be undone deliberately for this table to leak.
* **There is no GET route.** Analysis is server-side only.

---

## 7. Rate limiting

An unauthenticated write endpoint is the obvious abuse surface here, so the
ingest route is the **second** router to opt into `app/core/rate_limit.py`
(after `daily_grid`). It uses the shared `client_key`, which buckets on
scope + IP + anon-cookie subject.

Default: **60 requests per 60 s per client key**, which with the 20-event batch
cap bounds one client at 1200 events/minute. A denied request is a `429`
carrying `Retry-After` and **no budget information** — a remaining-request
count is the calibration signal a prober wants.

The limiter's own honest caveats (in-process, not restart-durable, not
cross-replica) are documented in `app/core/rate_limit.py` and apply here.

---

## 8. Configuration

Telemetry is **OFF unless an operator turns it on**. A privacy-affecting
collection path that enables itself at install time is not a
privacy-conscious one. With the flag off the route answers
`403 telemetry_disabled` and the browser client stops sending for the session.

`apps/api/app/core/config.py` is owned by the lead in this pass, so the
settings below are currently **module constants** in
`apps/api/app/api/v1/telemetry.py`, read from the environment at import. The
resolver checks the `Settings` attribute **first**, so the day these fields
land in `Settings` they take over with no code change.

**Requested `Settings` fields (for the lead):**

```python
# ---------------------------------------------------------------------------
# Product telemetry (Track F). OFF by default — see docs/implementation/TELEMETRY.md
# ---------------------------------------------------------------------------
TELEMETRY_ENABLED: bool = False
TELEMETRY_RATE_LIMIT: int = 60                    # ingest requests per window per client key
TELEMETRY_RATE_LIMIT_WINDOW_SECONDS: float = 60.0
TELEMETRY_MAX_BATCH_SIZE: int = 20
TELEMETRY_RETENTION_DAYS: int = 90
```

Environment variables honoured today (all `PEAK3_`-prefixed, matching the
existing convention): `PEAK3_TELEMETRY_ENABLED`, `PEAK3_TELEMETRY_RATE_LIMIT`,
`PEAK3_TELEMETRY_RETENTION_DAYS`.

**Player-facing opt-out.** The browser client stops collecting when any of
these is present: `navigator.globalPrivacyControl === true` (GPC),
`navigator.doNotTrack === "1"` (legacy DNT), or
`localStorage["peak3:telemetry"] === "off"` (our own switch, set by
`analytics.optOut()`). A browser that throws while being asked — private
mode, blocked storage — is treated as a signal, not as consent.

---

## 9. Client behaviour

`analytics.track(event)` keeps its existing signature and its existing dev
`console.debug`. Additionally, for the 21 collected events only, it:

* strips every property outside the allowlist **before** anything leaves the
  browser, so a mistake never crosses the network;
* queues and flushes on a 5-second timer, plus on `visibilitychange`→hidden
  and `pagehide` (with `keepalive: true`, so the run-ending event survives the
  page unloading);
* sends `credentials: "include"` — the `peak3_anon` identity cookie is
  httponly and set by the API's origin;
* **never throws** (the whole path is wrapped) and **never blocks** (no
  `await` is exposed to a caller);
* stops permanently for the session on `403`/`404`/`422` — the feature is off,
  the endpoint does not exist, or we are sending something wrong, all of which
  are permanent — and simply drops the batch on `429`/`5xx`/network failure.
  There is no retry queue: re-sending into a rate limit is how a client turns
  a limit into an outage.

Events outside the collected set stay console-only. They are not transmitted.

---

## 10. The report

```bash
python scripts/telemetry_report.py                # last 30 days
python scripts/telemetry_report.py --days 14 --json
python scripts/telemetry_report.py --purge        # run retention now
```

Produces: first-run completion, tutorial completion, second-run conversion,
clear rate, boss win rates, perk pick rates, perk win (clear) rates, trade
usage, run duration (mean/median/p90), daily return.

**Honesty rules built into the output:**

* Every rate prints its numerator and denominator. A rate with fewer than
  `--min-sample` (default 20) observations is labelled `low n` rather than
  suppressed — hiding it conceals that the funnel is thin; printing `100.0%`
  off two runs invites a decision; `100.0% (2/2, low n)` does neither.
* **It never prints a number it did not read from the database.** There is no
  sample mode and no example output.
* "Zero events" and "cannot connect" are different messages. If the database
  is unreachable it exits **2**, names the failure type, and prints nothing
  else. It never echoes the connection string.

**Expected local result today:** `PEAK3_DATABASE_URL` in `apps/api/.env`
carries a stale password for the hosted project (see
`AUTH_DAILY_BALANCE_PLAN.md` §9), so the script reports
`TELEMETRY REPORT NOT AVAILABLE` with the connection error and the remedy.
That is the correct behaviour, not a bug in the script.

---

## 11. What this cannot tell you

Stated so nobody over-reads a chart:

* **Nothing about individuals.** Subjects are keyed hashes and there is no
  route that reads a row back.
* **Nothing across the sign-in boundary for one person** — see §4.
* **Nothing from before the flag was switched on**, and nothing older than the
  retention window.
* **Nothing from players who opted out or send GPC/DNT.** They are missing
  from every denominator, which biases the funnel by an unknown and
  unmeasurable amount. That is the intended trade.
* **Nothing about *why*.** These are counts of product events. A drop in
  second-run conversion tells you where to look, not what happened.
