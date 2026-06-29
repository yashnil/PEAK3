# Peak Draft — State & Threat Model

Peak Draft is **server-authoritative**. The browser never computes a lineup
rating, never sees future offers, and never sees the solver optimum until the
draft is complete. This document records what is trusted, what is exposed, and
the residual risks for Phase 2.

## Trust boundary

- **Server (`apps/api`)** holds the full `Board` (all 5 rounds + reframe
  branches + seed) and the solver output. It is the only place lineup scores are
  computed (`nba_peak/lineup/`).
- **Client** holds only a `game_id` (opaque 128-bit token) and the public state
  returned by `get_public_state` — current round offers, past selections,
  decision-replay of completed rounds, and (after completion) the evaluation.
- **localStorage** holds non-authoritative progress only. Per CLAUDE.md it is
  explicitly *not cheat-proof and not eligible for global ranking*.

## What is deliberately withheld from every pre-completion payload

Verified by `test_no_*` in `apps/api/tests/test_draft.py` and an independent
deep-key leak scan:

- `future_offers` / full `rounds` structure (rounds 2–5)
- `reframe_branches` (until a branch is actually used)
- `board_seed` / `seed`
- solver `board_optimum`, `board_floor`, `all_ratings`, `optimal_cards`
- card `prime_index` (the internal ordering value)

`board_floor` / `board_optimum` / `draft_efficiency` appear **only** in the
post-completion `lineup_evaluation`, which is correct (the draft is over).

`round_history` (decision replay) contains only rounds already played — the
offers the player already saw — so it leaks nothing about future rounds.

## Daily board seed secrecy

Daily seeds are `HMAC(PEAK3_SIGNING_SECRET, "{date}:{mode}")` (`board.py
_derive_board_seed`). Without the server secret a client cannot reconstruct the
board or precompute the optimum. Practice/challenge seeds are caller-supplied
and intentionally shareable (that is the point of challenge links).

## State machine integrity (`services/draft/state.py`)

Enforced server-side, each with a stable error code:
- one card per round, one card per role, role-eligibility checked;
- Hold and Reframe each usable at most once; Hold blocked in the final round;
- completed/expired games are immutable (`game_complete` / `game_expired`);
- **idempotency**: a repeated `idempotency_key` returns the prior state
  unchanged — checked *before* the active-game assertion, so even a retried
  final-round selection is idempotent rather than a spurious 400.

## Error codes
`400` responses carry `detail = {error_code, message}`. Stable codes:
`card_not_offered, invalid_role, role_filled, role_not_eligible,
card_already_selected, hold_already_used, hold_final_round,
reframe_already_used, reframe_unavailable, game_complete, game_expired,
board_error, invalid_request`. The client tolerates both the structured form and
plain-string `detail` (FastAPI defaults for 404 / shape errors).

## Residual risks (Phase 2, accepted)

| Risk | Status | Mitigation / note |
|---|---|---|
| In-memory store lost on restart | Accepted | Ephemeral by design; Redis/Supabase in Phase 3 (`store.py`). |
| No rate limiting on game creation | Accepted | Add gateway throttling before public launch. |
| `game_id` enumeration | Mitigated | 128-bit `secrets.token_urlsafe`; not guessable. |
| Insecure default signing secret | Mitigated (warns) | App warns at boot if `PEAK3_SIGNING_SECRET` is the default; must be set in prod. |
| localStorage tampering | Accepted | Documented non-authoritative; no server trust placed in it. |
| Challenge token replay | Bounded | Tokens are HMAC-signed with a 7-day TTL. |

## Out of scope (Phase 2)
User accounts, server-side answer storage, global leaderboards, and anti-cheat
beyond the trust boundary above are deferred to Phase 3 per CLAUDE.md.
