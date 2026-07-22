# Atomic State Transitions Audit — Phase 4.0A Section H

Scope: does a restart or partial failure ever leave a **genuinely inconsistent,
non-repairable** state for any of: game creation, action application,
result completion, first-daily-completion, challenge lifecycle, anonymous
claim, XP award, record update, achievement award, streak transition, ranked
pairing/settlement/ledger write.

## Already fully transactional (single DB transaction, real constraints)

- **Ranked settlement** (`app/services/ranked/settlement.py`, Phase 4.0): the
  match-settlement row, both symmetric `rating_ledger_entries`, and the
  `queue_ratings`/`placement_states` updates all commit inside one
  `conn.transaction()`. A unique constraint on settlement-per-match makes
  retries idempotent rather than duplicating.
- **Personal record claim-transfer** (`PostgresPersonalRecordRepository.transfer_records`):
  per-record merge-keep-better-value logic runs inside `conn.transaction()`.
- **Achievement claim-transfer** (`PostgresAchievementRepository.transfer_awards`):
  `ON CONFLICT DO NOTHING` insert + delete of the old row, one transaction.
- **Streak claim-transfer** (`PostgresStreakRepository.transfer_streak`):
  merge (via `merge_streak_states`, shared with the memory implementation) +
  upsert + delete-old-row, one transaction.
- **Daily-completion claim-transfer** (`PostgresDailyCompletionRepository.transfer_owner`):
  first-wins merge expressed as one `UPDATE ... WHERE NOT IN (...)` followed
  by one `DELETE`, both against the same connection.
- **Single-row writes** (game creation, challenge storage, XP event
  recording, personal-record upsert, achievement award, profile
  create/update): each is one `INSERT`/`UPDATE` statement — atomic by
  construction, no partial-write window exists within the statement itself.
- **Write-once guarantees enforced by the data itself, not by request
  ordering**: `ResultSnapshotRepository` is append-only; `save_settlement`
  only succeeds once (`WHERE settlement IS NULL`, matched now in both the
  memory and Postgres implementations — see `MemoryChallengeRepository` fix
  below); `DailyCompletionRepository.record_completion` is first-write-wins
  keyed on `(owner_sub, board_id)`.

## Idempotent-retry-safe rather than single-transaction (by design)

- **`process_game_completion`** (`app/services/progression/engine.py`):
  awards XP, updates `user_progress`, evaluates streak/records/achievements
  as a sequence of separate repository calls, not one transaction. Every
  step is individually idempotent (idempotency-key-guarded events, first-wins
  daily/practice/weekly checks, `ON CONFLICT DO NOTHING` awards) — a crash
  mid-sequence leaves a state that is a strict subset of the fully-applied
  state, never a corrupted one, and is safe to naturally "complete" on the
  next qualifying event rather than requiring an explicit retry. This
  mirrors the ranked settlement's own progression call, which is
  additive and explicitly excluded from the settlement transaction itself
  (ADR-004 §17: a progression failure must never appear as a settlement
  failure).
- **`/auth/claim`** (`app/api/v1/auth.py`): transfers games, daily
  completions, challenges, result snapshots, progression events, personal
  records, achievements, and streak state via eight independent repository
  calls, then writes one `OwnershipClaim` audit record at the end. Each
  individual transfer is itself atomic and idempotent (re-running
  `transfer_owner`/`transfer_records`/etc. after a partial failure only
  moves the rows not already moved). If the request fails before the final
  `OwnershipClaim` write, the client sees an error and may safely retry the
  whole `/auth/claim` call — the idempotency check on `get_claim_by_anon`
  only short-circuits once the claim record exists, so a retry after
  partial failure correctly resumes rather than duplicating.
- **Draft completion write path** (`app/api/v1/draft.py::_record_completion`):
  writes a `ResultSnapshot`, then (for Daily boards) a `DailyCompletion`,
  then calls `process_game_completion`. These are three separate calls, not
  one transaction. If the process crashes between the first and second, the
  result snapshot exists but the daily-completion record does not — History
  still shows the completed result (from `result_snapshots`, the primary
  source), only the hold/reframe-used metadata (sourced from
  `daily_completions`, joined optionally in `history.py`) is unavailable
  for that one entry. This is a narrow, low-severity, self-contained gap
  (no financial/ranking data, no ability to replay or duplicate a
  completion) rather than a corrupted state, and was judged not to justify
  a cross-repository shared-connection transaction abstraction that does
  not otherwise exist in this codebase — flagged here explicitly rather than
  silently accepted.

## Bugs found and fixed during this audit (see also REPOSITORY_WIRING_AUDIT.md)

- `MemoryChallengeRepository.save_settlement` did not enforce write-once —
  it silently overwrote an existing settlement on every call, unlike the
  Postgres implementation's `WHERE settlement IS NULL` guard. Fixed to match
  (`app/repositories/memory.py`) and now covered by
  `tests/test_repository_conformance.py`, which runs the identical assertion
  against both backends.
- `PostgresGameRepository.get_game` reconstructed `owner_sub` from the
  JSON `payload` blob rather than the dedicated `owner_sub` column, so a
  `transfer_owner` claim (which only updates the column) was silently
  invisible on the next read — the stale pre-claim owner kept coming back
  from the payload. Fixed by treating the column as authoritative and
  overriding the reconstructed value.
- `state.py::_clone()` (used by every `select_card`/`use_hold`/
  `use_reframe`/`confirm` action) did not propagate `owner_sub` to the new
  state object, so ownership was silently cleared by the first action taken
  on any game. Fixed; regression test in `tests/test_draft.py`.

## Conclusion

No operation in this codebase can leave a state that requires manual repair:
every multi-step write is either (a) inside a real DB transaction, or (b)
composed of individually-idempotent steps that converge to the fully-applied
state on retry or on the next qualifying event. The one identified narrow
gap (daily-completion metadata after a mid-request crash) is documented
above rather than fixed with a new cross-repository transaction primitive,
since it does not corrupt or duplicate any record and no such primitive
exists elsewhere in the codebase to extend consistently.
