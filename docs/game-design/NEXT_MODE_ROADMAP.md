# Next-mode roadmap (post-Phase 9B)

Recommendation only. **No new mode is implemented in this phase.**

Cross-checked against `docs/product/ARENA_OVERHAUL_PRODUCT_SPEC.md`, which
already contains an internal 10-mode roadmap — this document largely *confirms*
that prioritization, with one addition it does not cover by name (Daily Mystery
Player), which turns out to be the cheapest and highest-reach option.

---

## What the retention layer now provides (the reuse inventory)

Phase 9A/9B shipped infrastructure that makes some modes nearly free and others
no cheaper at all. This is the single most important input to the ranking below.

| Capability | Where | Reusable by a new mode? |
|---|---|---|
| Deterministic date-keyed daily seed | `nba_peak/perfect_season/daily.py` — `SHA256(namespace:date:mode) % 2**31`, pure, **no stored board** | Yes, verbatim |
| Private saved runs + personal bests with tiebreakers | `apps/api/app/repositories/saved_run_*.py` | Pattern, not code (shaped to an 8-slot roster) |
| Leaderboard eligibility split from saving | `state.py::compute_eligibility` — provisional runs save/share but never rank | Yes, as a pattern |
| Explicit Start gate | `PeakSeasonStartGate.tsx` | Yes |
| Exact player-season data | `exact_season.py` — team, season, games, minutes, starts, position, official score, `score_status` | Yes |
| Real per-team-season rosters | `team_season_roster_slugs()` | Yes |
| Deferred-reveal discipline | ADR-005 Decision 6, enforced server-side | Yes — the hidden-info pattern already exists |
| Colored-square share text | Peak Duel's existing share format | Yes, verbatim |
| Streaks / achievements / progression | `memory_progression.py` + migrations | Yes |
| Glicko2 ranked matchmaking | `services/ranked/` | Pattern only — wired to the **draft** state machine, not CourtBuilder |

**Confirmed gaps** (checked in code, not assumed): no teammate co-membership
graph anywhere; no per-attribute (shooting/handle/defense) breakdown beyond the
5 official components; no player pricing/valuation model; no N-player
room/turn/sync infrastructure (`ranked.py` is strictly 1v1).

---

## Recommendation: **Daily Mystery Player / Season**

### Core loop
1. One hidden real player-season per day, from the same date-seed pattern.
2. Guess a player-season; get progressive clue feedback — team match, season
   proximity, position match, era bucket, minutes/role tier.
3. Six guesses. Colored-square grid to share.
4. Streak tracked via the existing progression tables.

### Why fans play
The lowest-friction daily habit on the list. ~30 seconds, no draft mechanic to
learn, and maximum "everyone played the same puzzle today" social pull. It is
also the only candidate that meaningfully **lowers the entry bar** — CourtBuilder
and a future Blind Draft both require learning a mechanic first, which matters
directly for the mission's "global basketball analytics game" framing.

### What makes it PEAK3-specific rather than generic trivia
Clues come from real fields already queryable per player-season (`team`,
`season`, `position`, `games_played`, `mpg`, `identity_pool_status`), and the
canonical-250 vs 1500-pool split is a **ready-made difficulty lever**. The
post-guess reveal can show the season's real PEAK3 score and component
breakdown — a payoff no other daily guessing game can offer.

### Complexity: **S–M**
Cost is clue-comparison logic plus a small UI. No new game engine, no new
scoring, no new basketball data, and the daily-completion persistence precedent
already exists twice (Peak Duel, PEAK Season).

### MVP scope (one focused phase)
- Canonical-250 pool only (fairness first).
- 6 guesses; clues = team / season / position / era-decade / minutes tier.
- Reuse `daily.py` for the seed and Peak Duel's share format verbatim.
- Reuse the Start gate and the saved-run/streak patterns.
- Reveal the real PEAK3 score + component bars on completion — this is where it
  hooks back into the explainability modal shipped in Phase 9B.

### How it hooks into existing infrastructure
Same date-seed → same puzzle for everyone, no stored board. Anonymous play
allowed; signing in adds streaks and history — the exact split Phase 9A already
established for PEAK Season, so the auth story needs no new thinking.

---

## Runner-up: **Blind Draft Duel** (Six Rings-style)

Names shown, PEAK3 values hidden per pick; one-shot lifelines (reveal-one,
reroll-one, lock-one); full reveal + "rings" result at the end.

**M complexity** — a new lifeline layer over the *existing* select/place/complete
state machine. Reuses `PlayerSeasonCard` verbatim, needs no new data, and maps
cleanly onto the Phase 9A saved-run pattern (rings ⇄ wins/losses, lifelines-used
⇄ respins-used). The internal spec calls this "the core Six Rings loop this whole
product direction is informed by", and it gives a structurally *distinct* second
loop (hidden-value drama vs. 82-0's build-optimization) rather than a reskin.

Ship it after the mystery mode validates the daily-habit thesis cheaply.

---

## Full ranking

| Rank | Mode | Complexity | Reuses 9A infra | New data needed | Cannibalizes 82-0 |
|---|---|---|---|---|---|
| 1 | **Daily Mystery Player** | S–M | Yes (seed, share, streaks) | No | No |
| 2 | **Blind Draft Duel** | M | Yes (saved-run pattern) | No | No |
| 3 | PEAK Grid (immaculate-grid style) | L | Partial (seed) | Yes — rarity backend | No |
| 4 | Era War / decade battles | M | Partial | No | **Yes — real risk** |
| 5 | Franchise GOAT Builder | L–XL | Minimal | Yes, if done honestly | No |
| 6 | Ranked 82-0 | M–L | Ranked pattern only | No | **Yes — real risk** |
| 7 | Salary Cap / Auction Draft | XL | Minimal | Yes — undesigned pricing model | No |
| 8 | Team Chemistry Challenge | L–XL | Minimal | Yes — teammate graph absent | No |
| 9 | Worst-to-First | M–L (uncertain) | Minimal | Possibly — standings data unconfirmed | No |
| 10 | Multiplayer Snake Draft | XL | Minimal | Minimal, but no room infra | No |

---

## What NOT to build next, and why

- **Ranked 82-0** — the same board and mechanics gated behind matchmaking. Not a
  new experience, and it fragments the flagship's player base into "casual" vs
  "ranked" cohorts. The ranked infrastructure exists but is wired to the *draft*
  state machine, so it is not the free win it appears to be.
- **Era War** — mechanically "82-0, but twice". Same spin/pick/slot loop and
  visual identity; high cannibalization risk.
- **Salary Cap** and **Team Chemistry** — both need real, undesigned new work
  before a single line of gameplay UI can be written (a validated pricing model;
  a teammate co-membership table derived from 47 seasons of roster data). That is
  research scope, not next-phase scope.
- **Multiplayer Snake Draft** — the largest infrastructure gap on the list. Good
  idea for after a friend-invite layer exists; wrong for "next".
- **PEAK Grid** — genuinely strong and a proven genre, but the interesting
  version needs population-level guess statistics (for rarity scoring) that no
  table currently supports, plus a constraint-solvability engine to guarantee
  every cell has a real answer. Revisit once there is guess volume to aggregate.

---

## Before any of it: finish the model debt

`docs/implementation/PHASE_9B_RANKINGS_AUDIT.md` §4 documents a reproduced
candidate-universe inclusion bug (`audit_player_pool_expansion.py` uses OR where
the documented rule is AND) and §3 documents unaddressed role-player inflation in
`statistical_impact`. **Both affect the candidate pool any new mode would draw
from.** Shipping a new mode on top of a known-leaky universe means fixing it
later in two places instead of one.

Recommended order: universe fix → Daily Mystery Player → Blind Draft Duel.
