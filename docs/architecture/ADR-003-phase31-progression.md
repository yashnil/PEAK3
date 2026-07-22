# ADR-003: Phase 3.1 — Progression, Personal Records, Achievements, and Healthy Streaks

Status: Accepted  
Date: 2026-06-30  
Authors: PEAK3 Engineering

---

## Context

Phase 3.0 delivered durable identity and immutable result history. Phase 3.1 adds a progression layer that gives users meaningful reasons to return without corrupting competitive integrity. The central constraint is complete separation of skill from participation: XP, level, streaks, achievements, and personal records must never influence lineup score, Draft Efficiency, offered cards, matchmaking, or any model output.

---

## Decisions

### 1. Progression event model

All progression state is derived from an append-only `progression_events` table. Each row records a single XP-bearing event with a stable idempotency key, owner reference, source type/id, policy version, and awarded XP amount. The event log is the source of truth; aggregate tables (`user_progress`, `streak_states`) are derivable from it.

**Idempotency key format:** `{owner_sub}:{event_type}:{source_type}:{source_id}:{policy_version}`

Events are recorded transactionally alongside result_snapshots to prevent double-awarding on retry.

### 2. XP policy versioning

XP amounts and caps are stored in a `xp_policy_versions` table keyed by a semver-style string (`v1.0`). The active policy version is encoded in every progression event. Policy changes create new rows; old events retain their original policy version for audit. Level calculation always uses the total XP accumulated (regardless of policy version changes) but a re-calculation run can detect if an old event was under-compensated and apply a correction event.

Initial policy `v1.0` values:
- `daily_completion_first`: 100 XP per local day (shared across modes)
- `practice_completion_first_weekly`: 25 XP (once per mode per week)
- `challenge_completion`: 50 XP (once per challenge received, not self-challenges)
- `receipt_exploration`: 20 XP (one-time lifetime)
- `methodology_exploration`: 20 XP (one-time lifetime)
- `first_game_bonus`: 30 XP (one-time, first ever game)
- Local day cap: 150 XP
- Weekly cap: 500 XP

### 3. Level calculation

Level is derived deterministically from total XP using a triangular threshold table:

```
level = largest n where cumulative_xp(n) <= total_xp
cumulative_xp(n) = 100 * n * (n - 1) / 2
```

Level 1: 0 XP  |  Level 2: 100  |  Level 3: 300  |  Level 4: 600  |  Level 5: 1 000  
Level 10: 4 500  |  Level 20: 19 000  |  Level 50: 122 500 (cap)

Level is a participation descriptor, never a skill indicator. The UI copy reads "Level N explorer" not "Level N ranked."

### 4. Personal record identity and versioning

A personal record is scoped to a complete version tuple: `(owner_sub, record_type, mode, lineup_model_version, card_pool_version, ruleset_version)`. Records from incompatible version tuples are never compared. Each board result carries the version tuple from its parent `board_snapshot`.

When a model version changes, existing records are preserved under the old tuple and new records begin accruing under the new tuple. The API exposes both "current version records" and "all-time records" as distinct responses.

### 5. Achievement evaluation

Achievements are evaluated server-side after progression events are recorded. Evaluators are pure functions: `evaluate(achievement_key, owner_sub, event, context) -> bool`. A side-effect-free evaluation ensures idempotency; recording the award is guarded by a `UNIQUE (owner_sub, achievement_key)` constraint.

Retroactive evaluation (for Phase 3.0 history that predates achievements) runs as a bounded, resumable background function triggered at startup when `RETROACTIVE_EVAL=true`. It is idempotent by design.

### 6. Streak local-day semantics

The qualifying event is: completion of at least one canonical Daily Peak board that is the user's official first completion for that board during the user's selected local day.

The local day is derived server-side: `local_date = (completion_timestamp + timezone_offset).date()`. The timezone is the IANA zone stored in `user_settings`. UTC is the safe default; all derivations use pytz/zoneinfo for DST-correct offset calculation.

Timezone-change protection: the timezone cannot be changed more than once per 24-hour period. Each change is logged with a timestamp. Any completion timestamped within a timezone-changed window is evaluated under the timezone that was active at completion time (stored in the streak_event row).

### 7. Streak reserve behavior

Policy `v1.0`:
- One-day gaps consume one reserve token if available
- Two-or-more-day gaps reset current streak unconditionally
- Reserves are earned after a 7-consecutive-day streak (max cap: 1)
- Reserves are never purchasable
- Reserves are shown clearly in the UI with an explanation
- No guilt language; missing a day with no reserve reads as a neutral fact

### 8. Anonymous progression claiming

The Phase 3.0 claim transaction is extended to atomically:
1. Transfer progression_events where `owner_sub = anon_sub` → `owner_sub = real_sub`
2. Merge `user_progress`: union XP, recalculate level
3. Merge `streak_states`: use the chronologically contiguous streak; keep max of longest_streak values
4. Merge `achievement_awards`: union by achievement_key (no duplicates)
5. Merge `personal_records`: keep superior valid record per (record_type, mode, version_tuple)
6. Record merger metadata in `ownership_claims.progression_merge_summary` JSONB column

Conflict resolution is deterministic and documented in the claim_merge_summary:
- XP: add (union by idempotency key prevents double-counting)
- Streaks: recompute from merged event log; longest_streak = max(anon, real)
- Records: higher value wins; ties keep real user's record
- Achievements: union; no duplicate per key

### 9. Idempotency and concurrency

Database-level idempotency:
- `progression_events.idempotency_key` is UNIQUE
- `achievement_awards (owner_sub, achievement_key)` is UNIQUE  
- `streak_states` has one row per owner_sub (upsert)
- `personal_records (owner_sub, record_type, mode, lineup_model_version, card_pool_version, ruleset_version)` is UNIQUE

Application-level: all progression writes use SELECT-FOR-UPDATE or INSERT-ON-CONFLICT-DO-NOTHING patterns. The result-completion endpoint acquires a row-level lock on `user_progress` before writing progression events, preventing two simultaneous completions from awarding XP twice.

### 10. Privacy and public-profile exposure

Private by default. Owner-readable: all progression fields.  
Public only when `profiles.is_public = true` AND the specific field is allowed:
- Level: always shown on public profiles
- Selected achievements: shown unless `achievements_private` setting
- Longest streak: shown unless `streak_private` setting
- Personal records: shown unless `records_private` setting
- Raw XP total and event history: always private

### 11. Future compatibility

Progression is isolated from game scoring. When Phase 4.0 adds Glicko-2:
- Rating is computed from a separate `rating_events` table, not from `progression_events`
- XP and level have zero inputs to the rating algorithm
- Streak state has zero inputs to matchmaking
- Personal records are read-only references in the rating system

A `progression_season_id` column is reserved in `progression_events` for future season scoping without requiring a schema migration.

---

## Alternatives considered

- **Client-side XP accumulation**: Rejected. localStorage is not cheat-proof; progression would be trivially inflatable. Server-authoritative events with idempotency keys are required.
- **Single aggregate user_progress table only**: Rejected. An event log is required for audit, retroactive evaluation, and claim merge idempotency.
- **Streak based on any game type**: Rejected. Only Daily boards count to preserve the qualitative distinction between casual and habitual play.
- **Paid streak repair**: Explicitly rejected per product mission.

---

## Consequences

- Every result completion now triggers a progression evaluation pass (XP + streak + record + achievement). This adds ~5 ms to completion time in-memory; PostgreSQL adds a transaction round-trip (~15 ms estimated).
- Retroactive achievement evaluation at first startup when enabled adds ~2 s for a corpus of 10 000 results.
- Model version changes do not invalidate existing records; they partition records by version tuple.
