# ADR-001: Board Snapshot Contract and Versioning

**Status:** Accepted  
**Date:** 2026-06-29  
**Deciders:** PEAK3 engineering

---

## Context

PEAK3 Arena needs immutable, reproducible game boards for two scenarios:
1. **Daily Peak** — same date + mode must always produce the same 5 rounds of offer cards.
2. **Challenge links** — a shared `/c/{token}` URL must replay the exact same board as the challenger played.

The game uses a deterministic board generator (`nba_peak/lineup/board.py`) seeded by a numeric value derived from the board's identity. The card pool is versioned (`card_profiles.v3.json`). The official PEAK3 scoring model is authoritative and server-side only.

---

## Decision

### Board Identity

A board is identified by its **board_id**:

| Board type | board_id format |
|------------|----------------|
| Daily | `daily-{mode}-{YYYY-MM-DD}` |
| Practice | `practice-{mode}-{seed}` |
| Challenge | `challenge-{mode}-{seed}` |

**Invariant:** The same `board_id` always generates the same offer tree, reframe branches, and Hold-compatible state, provided:
1. The card pool version is unchanged (`card_profiles.v3.json`).
2. The signing secret is unchanged (daily boards only).

### Version pinning

Board snapshots store:
- `lineup_model_version` (e.g., `experimental_lineup_v3`)
- `ruleset_version` (e.g., `ruleset_v3`)
- `card_pool_version` (e.g., `v3`)

If the default card pool is bumped to v4, all existing daily `board_id`s are unchanged **but** the cards generated from those IDs may differ. This is an accepted risk for Phase 1 because:
- Card profile updates are rare (deliberate model passes).
- The board_id embeds no version — it encodes identity, not snapshot content.
- A future upgrade path: include `card_pool_version` in the board_id (e.g., `daily-apex_1y-2026-06-29-v3`). Deferred to Phase 3.

### Challenge token

A challenge token is an HMAC-SHA256-signed payload containing:
```json
{
  "board_type": "practice",
  "mode": "apex_1y",
  "duration_years": 1,
  "board_id": "practice-apex_1y-42",
  "seed": 42,
  "nonce": "<random>",
  "exp": 1751328000
}
```

The nonce ensures tokens from the same game are unique. The token is signed with `PEAK3_SIGNING_SECRET`. TTL is 7 days.

**Security properties:**
- Client cannot forge a token without the secret.
- Client cannot alter board parameters without invalidating the signature.
- Client-provided seeds, scores, and lineup assignments are NEVER trusted.

### Challenger result persistence

At challenge creation:
1. The challenger's `lineup_evaluation` is extracted from the server-side game state.
2. A `ChallengeRecord` is stored in the in-memory challenge store, keyed by `sha256(token)[:32]`.
3. The record includes a `challenger_snapshot` (selected cards + lineup evaluation) that survives beyond the 24h game TTL.

At comparison:
1. The challenger's result comes from `ChallengeRecord.challenger_snapshot`.
2. The recipient's result comes from the active game state by `game_id`.
3. After first computation, the `settlement` is cached in `ChallengeRecord` for durability.

### Server authority

- The server generates all boards and scores.
- The client stores only: `game_id` for resumption, completion summary for UI.
- The client NEVER receives future rounds, reframe branches, or private board state.
- Settlement is computed server-side; the client displays it.

### Spoiler protection

The `GET /challenges/{token}/meta` endpoint returns spoiler-safe metadata only. It never includes:
- Challenger score, efficiency, or percentile
- Challenger selected cards, roles, or player names
- Any round-history or receipt data

The comparison data (`GET /challenges/{token}/comparison`) is only returned after both players have `status == "draft_complete"`.

---

## In-memory store (Phase 1 limitation)

All game state and challenge records are stored in a module-level Python dict. This means:
- Games expire after 24 hours.
- Challenge records expire after 7 days.
- All state is lost on server restart.

**Accepted for Phase 1.** Phase 3 will replace the in-memory store with Supabase or equivalent.

---

## Daily UTC settlement

Daily boards use UTC date: `datetime.now(timezone.utc).strftime("%Y-%m-%d")`. Players in UTC-5 playing after midnight UTC see the next day's board at 7pm local time. This is documented as the intended behavior. No separate "settlement job" is needed; the board is deterministic from the date alone.

---

## Rejected alternatives

1. **Store seed in URL**: Exposes implementation detail; guessable sequences possible.
2. **Store challenger game_id in token**: Token bloat; game_id reveals implementation; game expires in 24h breaking comparisons.
3. **Database-backed boards**: Correct but premature for Phase 1. Deferred to Phase 3 (Supabase).
4. **Client-side board generation**: Would allow cheating. REJECTED — all boards must be server-generated.
