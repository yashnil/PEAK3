# Peak Draft — Ruleset v1

Peak Draft is a 5-round draft. Each round you choose 1 of 3 offered PEAK3 peak
windows and assign it to one of five distinct lineup roles. After round 5 the
server scores your 5-card lineup with the experimental lineup model and shows a
Peak Receipt explaining the result.

Implementation ruleset version: `ruleset_v0` (`nba_peak/lineup/config.py`).

## Modes
| Mode | Window | Description |
|---|---|---|
| `apex_1y` | 1 year | The single greatest season peak |
| `prime_3y` | 3 years | A 3-season window of excellence |
| `foundation_5y` | 5 years | A sustained 5-year peak |

All five cards in a lineup share the mode's duration. Mixing durations is not
allowed (the evaluator rejects it).

## Board structure
- 5 rounds × 3 offers = 15 cards on the main board.
- No player appears twice anywhere on a board.
- Within a round, offers have a minimum `individual_peak_score` spread so choices
  are non-trivial.
- The board is guaranteed **role-feasible**: at least one selection of 1 card per
  round fills all five distinct roles. (Corpus: 600/600 boards feasible.)
- Boards are deterministic from their seed. Daily boards derive the seed from
  `HMAC(secret, date+mode)`; practice/challenge boards use an explicit seed.

## Roles
`lead_creator, guard_wing, wing_forward, forward_big, anchor`. Each role is
filled exactly once. A card may only fill a role it is eligible for
(eligibility is part of the card profile).

## Tools (each usable once per game)
- **Hold** — set aside one of the current offers; it reappears as an option in a
  later round (alongside two fresh cards). Cannot be used in the final round.
  Using Hold does not advance the round — you still pick from the remaining two.
- **Reframe** — replace the current round's three offers with a pre-computed
  alternate branch of three new players.

## Turn flow
1. Round opens with 3 offers (`round_active`).
2. Optionally Hold or Reframe (each once per game).
3. Select a card and assign an eligible, still-open role.
4. Rounds 1–4 advance; round 5 finalizes and scores the lineup.

## Scoring (see `docs/model/EXPERIMENTAL_LINEUP_V0.md`)
`lineup_peak_rating` (0–100) = talent (0.78) + coverage (0.14), times a bounded
synergy multiplier (±0.06). Context: `board_optimum` (exact solver),
`board_floor` (5th percentile), `draft_efficiency`, `board_percentile`. The
Peak Receipt lists the talent core, strengths, weaknesses, synergy interactions,
data warnings, and efficiency — each item traceable to its inputs.

> **This is a game score, not a basketball prediction.** It does not forecast
> wins or championships; it scores PEAK3 individual peaks under a hypothetical
> model.

## Result & replay
After completion the client shows the lineup, the Peak Receipt, and a
**Decision Replay**: for each round, the three offers shown and which card you
drafted (and to which role). Replay uses only offers you already saw.

## Sharing
A completed game can produce a **challenge link** (`/c/{token}`) that reproduces
the same board for someone else. Daily challenge tokens encode date+mode only;
practice tokens encode the seed. Tokens are HMAC-signed with a 7-day TTL.

## Fairness invariants (enforced server-side)
- One card per round, one card per role, eligibility required.
- Hold/Reframe at most once; Hold not in final round.
- Completed/expired games are immutable.
- Duplicate submissions (same `idempotency_key`) are no-ops.
- No future offers, seeds, solver output, or `prime_index` are ever sent before
  completion.
