# Competitive state machine — Ranked & H2H

Batch P4. Priority order this document supports: exactly-once match
creation, exactly-once settlement, authoritative competitive state,
reconnect correctness, race safety, persistent multiplayer state,
trustworthy polling/fallback behavior.

Every transition below is server-authoritative: the client never supplies
rating, rank, wins/losses, official score, settlement state, or opponent
identity beyond a valid invitation/match context. Confirmed by reading every
request body model on every mutating Ranked/H2H route — no field named
`rating`, `rating_delta`, `rank`, `wins`, `losses`, or `score` exists on any
of them; `POST /ranked/matches/{id}/actions` accepts only game-move fields
(`action`, `card_id`, `role`, `idempotency_key`) validated against
server-held state, and settlement always re-derives its outcome from durably
stored submissions, never from the request.

---

## Ranked

| Transition | Input | Actor | DB read | DB write | Transaction boundary | Idempotency | Authority |
|---|---|---|---|---|---|---|---|
| join → waiting | `POST /queues/{mode}/join` | client | rating/placement snapshot | `INSERT ranked_queue_entries` | single statement | partial unique index `(owner_sub, mode) WHERE status='waiting'` → `ActiveQueueEntryExists` on violation | server (snapshot is server-read) |
| waiting → matched | same request, synchronous `try_match` | server | `list_waiting_entries`, `recent_opponents` | `create_match_atomically`: lock + match insert + 2 participant inserts + 2 queue-entry updates | **one atomic transaction** (`SELECT...FOR UPDATE SKIP LOCKED` + all 5 writes) | lock semantics, not a key | server |
| matched → game created | `POST /matches/{id}/game` | client | match/participant | `create_game`, `set_participant_game`, `set_participant_status` | **three separate statements**, not transactional — safe because re-entrant (`if participant.game_id: return existing`) | none needed (idempotent by construction) | server mints `game_id` |
| gameplay → submitted | `POST /matches/{id}/actions` reaching `draft_complete` | client drives moves, server computes completion | game/participant state | `save_game`, `set_participant_status`, `record_submission` | three separate calls, not one transaction | `idempotency_key` (client-supplied or server-fabricated if omitted — see Known limitations) | server computes `draft_complete`; client supplies moves |
| submitted → awaiting-opponent | same request, `attempt_settlement` returns `None` | server | settlement/match/participants/submissions | `set_participant_status(..., "awaiting_opponent")` | single UPDATE | re-derived from durable submissions every call | server |
| both-submitted → settled | second participant's completion, or any later `attempt_settlement` call | server | `list_submissions` (2 rows) | `commit_settlement`: 1 period + 1 settlement + 2 ledger + 2 rating + 2 placement + match UPDATE (9 statements) | **one atomic transaction** | `ranked_match_settlements.match_id UNIQUE` **and** `rating_periods.match_id UNIQUE` (both now guarded — see Fixes) → `DuplicateSettlement` | server computes outcome via `_decide_outcome` |
| settled → rating reflected on match/participants | same call, after `commit_settlement` returns | server | ledger entries (repair path) | `set_match_rating_period`, `set_match_status`, 2× `set_participant_post_match_rating` | **repaired idempotently on every `attempt_settlement` call**, not just the fresh-commit path — see Fixes | skips once already complete (cheap read, not 4 writes, on the common path) | server |
| cancel | `POST /queues/{mode}/cancel` | client | none | `UPDATE ... WHERE status='waiting'` | single statement | naturally race-safe against pairing (`SKIP LOCKED ... AND status='waiting'`) | client-initiated |
| waiting → expired | on-join sweep (no background worker in closed alpha) | server | none | `UPDATE ... WHERE status='waiting' AND joined_at < cutoff` | single statement, no read-then-write | none needed | server, TTL 10 minutes |

### Exactly-one-match guarantee

`create_match_atomically` (`ranked_postgres.py`): `SELECT id FROM
ranked_queue_entries WHERE id = ANY($1) AND status='waiting' FOR UPDATE
SKIP LOCKED`, inside one transaction with the match/participant inserts and
both queue-entry status updates. A racing transaction that cannot lock
either row gets fewer than 2 rows back (never blocks) and returns `None`
without writing anything; `try_match` then tries the next candidate. **Live
concurrency-tested against real Postgres this batch** (not just reasoned
about): two queue entries, two concurrent `try_match` calls racing to pair
them — result is deterministically exactly one match with exactly the two
correct participants, the loser cleanly `None`
(`tests/test_ranked_concurrency_postgres.py::test_postgres_concurrent_pairing_produces_exactly_one_match`).

### Exactly-one-settlement guarantee

`commit_settlement` is one atomic transaction. Both unique constraints that
protect it (`rating_periods.match_id`, `ranked_match_settlements.match_id`)
are now caught and converted to `DuplicateSettlement`, which `attempt_settlement`
turns into "return the existing settlement" rather than a 500. **Live
concurrency-tested against real Postgres**: three simultaneous
`attempt_settlement` calls on the same match — exactly one settlement row,
exactly one rating-ledger effect per player, zero unhandled exceptions
(`test_postgres_concurrent_settlement_applies_rating_exactly_once`).

---

## H2H

| Transition | Input | Actor | DB read | DB write | Transaction boundary | Idempotency | Authority |
|---|---|---|---|---|---|---|---|
| create → open | `POST /h2h {run_id}` | creator | owned run | 1 match INSERT + 1 participant INSERT | **one transaction** | fresh UUID | server derives seed/fairness from the owned run |
| open → invite viewed | `GET /invite/{token}` | anyone, no auth | match + participants | none | N/A | N/A | server; spoiler-safe by field omission |
| open → in_progress (accepted) | `POST /invite/{token}/accept` | second auth'd user | match, own participant row (idempotency), seat count | new run INSERT (own txn) + `add_participant` (seat INSERT) + `set_match_status` | **seat INSERT and status UPDATE are separate statements**, not one transaction (see Known limitations) | `auth.sub` uniqueness — repeat POST from an already-seated sub returns the cached view | server derives run/seed; client supplies only the token |
| in_progress → submitted | `POST /{id}/result {}` | participant | ownership, run state | `UPDATE ... SET result=... WHERE result IS NULL` | single UPDATE | **`WHERE result IS NULL`** — first write wins, no key needed | server recomputes every metric from the run; body is empty (`extra="forbid"`) |
| both-submitted → settled | second participant's `POST /result` | server, triggered by the second request | both participants' results | `UPDATE ... SET settlement=...,status='complete' WHERE settlement IS NULL` | single UPDATE, separate statement from the triggering result write | **`WHERE settlement IS NULL`** — first write wins | server; `compare()` is a pure function of two stored `ComparisonMetrics` |
| settled → receipt | `GET /{id}/receipt` | either participant | participants, settlement | none — never settles | N/A | N/A | server |
| settled → rematch | `POST /{id}/rematch {}` | either participant | pre-check `find_rematch` (read-then-act) | new run + `create_match` (1 transaction, may catch `UniqueViolationError`) | pre-check is separate from the guarded INSERT | `(rematch_of, creator_sub)` partial unique index; **route now checks `saved.match_id == match.match_id` and 409s on mismatch instead of minting a dead token — see Fixes** | server mints a new random seed |

### Accept-race safety (two users racing to accept the same invite)

Both backends confirmed race-safe by reading, not assumed: the fast-path
`len(participants) >= 2` check is not the guard — the guard is
`head_to_head_participants_role_uniq (match_id, role)`. Postgres: the losing
`INSERT` raises `UniqueViolationError`, caught and converted to
`ParticipantSlotTaken` → clean `409 match_full`. Memory: the equivalent
check-and-append runs under one `asyncio.Lock`, so the second coroutine
deterministically sees the first's already-appended row. No state
corruption possible in either backend; the loser's own already-created run
becomes an ordinary orphaned `challenge` run (documented, accepted
trade-off — "the seat, not the run, is the scarce thing").

### Creator-cannot-accept-own-invite

Not racy by construction: the creator's own participant row is inserted
synchronously inside `create_match`, before the invite token can even be
minted — by the time any `accept` call for that invite can execute,
`get_participant(match_id, creator_sub)` is guaranteed non-`None`. Backed by
the table's own PK `(match_id, participant_sub)` as defense-in-depth even if
the application check were removed.

### Rematch race — fixed this batch

See "Fixes" below — a genuinely concurrent double-rematch could previously
hand the losing request a `200` response containing a valid `match_id` but
an `invite_token` that would 404 on first use.

---

## Fixes made this batch (all live-verified against real Postgres, not reasoned about)

1. **`record_submission` idempotency-key race** (`ranked_postgres.py`) —
   flagged in Batch P2/P3, fixed here. The pre-check `SELECT` and the
   `INSERT` were two separate round trips; two concurrent submissions for
   the same `(match_id, owner_sub)` with different `idempotency_key` values
   could both pass the pre-check and both attempt the `INSERT`, and the
   second's `UniqueViolationError` (on `ranked_match_submissions_user_match_unique`
   or `ranked_match_submissions_participant_unique`) was unhandled → an
   unexpected `500` instead of the idempotent `200` the method promises.
   Fixed by catching the violation and re-reading the winning row. The
   memory-backed repo never exhibited this — its whole check-then-write runs
   under one `asyncio.Lock` — which is exactly why the existing
   memory-only concurrency suite never caught it.
2. **Settlement's trailing writes were outside the atomic transaction**
   (`settlement.py`) — `commit_settlement` is genuinely atomic, but the four
   calls after it (`set_match_rating_period`, `set_match_status`, 2×
   `set_participant_post_match_rating`) hit a *different* repository
   (`matchmaking_repo`, not `rating_repo` — not one connection, so they
   cannot be folded into `commit_settlement`'s own transaction without
   merging the two repositories). A crash in that window left the rating
   ledger correct (source of truth) but `ranked_matches.status` stuck at
   `'matched'` and `post_match_rating` permanently `NULL` for both sides —
   and `attempt_settlement`'s own early return
   (`if existing is not None: return existing`) meant a retry never
   revisited them. Fixed with `_ensure_match_reflects_settlement`, called
   from every exit path that holds a settlement (fresh commit, recovered
   `DuplicateSettlement`, or found already-existing on entry), which reads
   the authoritative post-match values back from the rating ledger and
   idempotently repairs the match/participant rows — skipping entirely once
   already complete, so the common case costs one read, not four writes.
3. **`rating_periods.match_id UNIQUE` was unguarded inside `commit_settlement`**
   — a genuinely new finding, caught only by this batch's own live
   concurrency test, not by code-reading alone. `INSERT INTO rating_periods`
   runs *before* the already-guarded `_insert_settlement` call, inside the
   same transaction; under real concurrent settlement attempts, the second
   transaction could hit *this* constraint first and raise an unhandled
   `UniqueViolationError` before ever reaching the try/except a few lines
   down — defeating the guard's whole purpose. Fixed by wrapping the
   `rating_periods` insert in the identical catch → `DuplicateSettlement`
   pattern.
4. **H2H rematch race could hand the loser a dead invite token** — a
   genuinely concurrent double-rematch request (not the sequential
   double-click the existing test covered) can have both calls pass the
   `find_rematch` pre-check before either commits; `create_match` correctly
   catches the resulting constraint violation and returns the *winner's*
   match to the loser, but the route unconditionally minted an invite token
   from its *own* locally-generated `invite_id` — which was never persisted
   anywhere, since only its hash is ever stored. The result: an HTTP `200`
   with a correct `match_id` and a `invite_token` that 404s on first use.
   Fixed: the route now compares `saved.match_id` against the match it tried
   to create and returns the same clean `409 rematch_already_offered` the
   sequential case already used, instead of fabricating a broken success
   response.
5. **Ranked queue-waiting screen could not recover from a mid-queue refresh**
   (`RankedScreen.tsx`) — the resume-on-mount effect was gated entirely on a
   `localStorage` match-id breadcrumb, which is only written once a match
   exists. A refresh while still `queue_waiting` (before pairing) landed on
   the empty "Join queue" screen even though the server still held a real,
   durable queue entry; clicking "Join queue" again then hit a `409
   already_in_queue` with no recovery path, and the poll that would have
   discovered the eventual match never started (it only runs in
   `queue_waiting` phase). Fixed: the same mount effect now falls back to
   `GET /queues/{mode}/status` — the exact same durable, server-authoritative
   read the waiting-screen poll already uses — when no match breadcrumb
   exists, and recovers the correct phase.

## Known limitations — deferred, not fixed this batch

- **H2H's invite-landing and match-waiting screens have zero live-update
  mechanism** — not polling, not focus/visibility refetch, not Realtime
  (there is no Realtime anywhere in this app — see below). A player sitting
  on "waiting for opponent" only learns of a change on manual reload. This
  may be intentional (H2H is explicitly async — "played whenever each of
  you has time" — unlike Ranked's synchronous-feeling design), but it is a
  real asymmetry against Ranked's 2500ms poll for the equivalent states.
  **Not fixed**: this is a UX responsiveness question, not a correctness
  one — confirmed no screen in this app depends on ephemeral client state
  for correctness (every phase, on every refresh, is re-derived from a
  server GET); adding new polling infrastructure would be a product
  decision and a UI change beyond this batch's "minimal changes,
  correctness over aesthetics" scope.
- **`match.deadline` (Ranked, 48h) is write-only** — stored at match
  creation, returned to the client, never read or enforced by any code
  path. Combined with the next item, an abandoned Ranked match (one side
  never returns) sits at `status='matched'` forever with no deadline
  enforcement despite the column's name.
- **No active-match abandonment/disconnect handling exists in Ranked** —
  `abandonment_state`/`'forfeited'`/`'protected_abort'`/`'integrity_review'`
  are all valid enum values in the schema's own CHECK constraints, and
  `ranked_abort_allowances`'s repository methods exist, but no route ever
  writes any of them. A one-sided abandoned match stays cleanly in
  `awaiting_opponent` from the other side's perspective indefinitely — not
  corrupted state, just permanently pending. Per this batch's explicit
  instruction not to invent penalties casually, no abandonment/forfeit
  policy was designed or implemented here; flagged for a future batch that
  owns that product decision.
- **H2H has no cancellation feature** — an open, never-accepted invite (or
  an accepted-but-unfinished match) cannot be withdrawn by its creator; it
  simply sits until its 14-day TTL. Not exploitable (no excess privilege
  granted to anyone), just a missing feature.
- **`accept`'s expiry check runs before its idempotency check** — an
  already-seated participant's harmless repeat `POST /accept` on a since-expired
  match gets `410` instead of their normal cached view. Minor UX
  inconsistency, not a security issue.
- **`join_queue`/`try_match`'s server-fabricated idempotency key** — when a
  client omits `idempotency_key` on `POST /matches/{id}/actions`, the server
  generates a fresh one (`ranked.py`: `idempotency_key or str(uuid.uuid4())`),
  which means the `ON CONFLICT (match_id, idempotency_key)` upsert only ever
  protects a client that deliberately resends its own key — the common case
  of a client silently double-firing without a stable key relies entirely on
  fix #1's now-corrected SELECT-then-INSERT path, not on the conflict
  clause. Not a bug given fix #1, but worth noting the idempotency key's
  practical protection is narrower than its presence suggests.
- **Ranked's polling interval (2500ms) and Arena's (2000ms/400ms during
  reveal) are inconsistent, independently hardcoded magic numbers** — no
  shared constant. Cosmetic; not a correctness issue.

## Realtime

**Confirmed zero Supabase Realtime usage anywhere in this codebase** —
backend and frontend, verified by exhaustive grep this batch (`ALTER
PUBLICATION`/`supabase_realtime`/`REPLICA IDENTITY` in every migration;
`.channel(`/`postgres_changes` in every frontend source file). The one hit
found is a code *comment* explaining why polling was chosen instead. Every
"live" surface in this product — Ranked (2500ms poll), Arena/Three-Man-Weave
(2000ms, 400ms during reveal), H2H (none) — is poll- or manual-refresh-driven
by design. `@supabase/supabase-js`/`@supabase/ssr` are dependencies but used
exclusively for auth/session plumbing; their Realtime feature is entirely
dormant.

**"Realtime is not authority" audit result: no violation found.** Every
phase transition on every screen, on every refresh, is re-derived from a
server GET (`localStorage` is used strictly as a "which id to ask about"
breadcrumb, never as the source of truth for match/game state) — confirmed
exhaustively across Ranked, H2H, and Arena screens this batch. The
queue-waiting reconnect gap (fix #5 above) was the one real instance of a
screen *failing to check* server state on mount, not of trusting client
state over it, and it is now fixed.

**Production implications**: since Realtime is unused, there is nothing to
configure in Supabase for it — no publication, no channel authorization
policy, no reconnect-interval tuning. See `PRODUCTION_CHECKLIST.md` for the
explicit confirmation of this (a genuine "nothing to do here," not an
oversight).

## What was NOT re-litigated this batch

The narrow settlement-idempotency race first flagged in Batch P2/P3 is
fix #1 above — closed, not deferred. No other previously-known gap was left
open under the "already known" label; everything found this batch (fixes
1–5) was fixed, and everything explicitly deferred is listed under Known
limitations with the reason it was not in scope.
