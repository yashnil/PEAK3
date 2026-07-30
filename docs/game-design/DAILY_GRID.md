# Daily Grid Challenge (Phase 11A)

PEAK3's lightweight daily game. A 3x3 board whose rows and columns are
basketball/PEAK3 constraints; every square is filled with an **exact NBA
player-season** satisfying both.

Route: **`/daily`**. Everyone gets the same board on the same UTC date.

This mode sits *beside* the 82-0 PEAK Season flagship, never replacing it.
Navbar "Play" still deep-links to `/arena/court/practice/apex_1y`.

---

## Rules

- 3x3 grid. Each cell has a row constraint and a column constraint.
- A valid answer is a player-**season**, not a player identity:
  `1999-00 Shaquille O'Neal`, not `Shaquille O'Neal`.
- **No player identity may be used twice on one board.** All nine squares need
  nine different players.
- Every submission is validated server-side. The client never holds the key.

### Why the distinct-identity rule

The alternative — allowing a player in multiple seasons — collapses in
practice. The hardest cells on almost any board are answerable by the same
handful of all-time greats, so a board fills up with nine Jordan/LeBron/Hakeem
seasons: not strategic, and not interesting. Requiring nine different players
forces the player to spend their obvious answers carefully.

The rule can never make a board unsolvable: the generator proves a
nine-distinct-player solution exists before publishing (see below).

---

## Board generation

`nba_peak/daily_grid/generator.py`

Deterministic: the seed is SHA-256 of a namespaced date string, mirroring the
existing precedent in `nba_peak/perfect_season/daily.py` (which mirrors Peak
Duel's). Same date → same board, for everyone, forever, with no stored per-date
snapshot and no synchronization step. The namespace prefix differs from both
other games so seeds can never collide.

`board_id` is `daily-grid-v1-YYYY-MM-DD`. It is the client's progress key, which
is what makes yesterday's saved board fall away on its own.

### Solvability guarantees

A board is published only if it passes all of these, checked against the real
answer pool at generation time:

| Guarantee | Value |
|---|---|
| Minimum valid answers per cell | 6 (the brief's floor is 3) |
| Minimum **distinct players** per cell | 4 |
| Full nine-distinct-player solution exists | proven by backtracking search |

The distinct-player floor matters independently of the answer floor: a cell
with eight answers that are all the same player is effectively a one-answer
cell under the identity rule.

### Composition rules

Feasibility alone produces dull boards. A board must also have:

- 2–3 team constraints (never all-team, never team-less)
- 1–3 PEAK3-native constraints (score thresholds / component deciles)
- at least 4 distinct categories across the six axes
- at most 3 axes from any one category
- at least one recognizable (team/award/era/position/outcome) constraint on
  **each** axis, so no cell is pure formula or pure trivia
- no nested or mutually-exclusive pair crossing (see below)

### Exclusive groups

Two constraints sharing an `exclusive_group` never appear on opposite axes:

- **Mutually exclusive** — a player-season has exactly one team, one decade,
  one position. "Lakers x Celtics" has no answers, ever.
- **Nested** — "85+ PEAK" is a strict subset of "80+ PEAK", so crossing them
  makes the outer constraint decoration rather than a real condition. Same for
  MVP inside top-5-MVP, All-NBA 1st inside All-NBA, and the
  champion → finals → conference-finals ladder.

The empirical answer-count gate would already reject the mutually-exclusive
pairs (zero answers); nested pairs pass it while still making a bad board, so
the grouping is enforced explicitly.

### Measured behaviour (365-day sample, v1)

- 365/365 boards generated, **all distinct**
- difficulty split ≈ even across easy/medium/hard (median-cell terciles)
- minimum cell across the whole year: 6 answers, 4 distinct players
- every one of the 62 shipped constraints appears at least once
- ~17 ms per board; the pool builds once in ~0.25 s

---

## Constraint taxonomy

`nba_peak/daily_grid/constraints.py` — 62 constraints.

The gate for shipping one is strict: **if the fact cannot be read out of
committed data at player-season grain, the constraint does not exist.** Nothing
is inferred, estimated, or approximated. A grid is only fun if "that answer
should have counted" is never true.

| Category | Count | Examples |
|---|---|---|
| `team` | 30 | Boston Celtics, Chicago Bulls — relocations folded in |
| `award` | 10 | MVP, Top-5 MVP, DPOY, DPOY Votes, Finals MVP, All-NBA (+1st), All-Defense (+1st), All-Star |
| `era` | 5 | 1980s … 2020s |
| `position` | 3 | Guard, Forward, Center — per **season**, not per career |
| `peak` | 5 | 60+ / 70+ / 75+ / 80+ / 85+ PEAK Season |
| `component` | 5 | Top 10% Statistical Impact / Traditional Production / Individual Recognition / Postseason Value / Team Achievement |
| `outcome` | 4 | NBA Champion, Reached the Finals, Reached the Conference Finals, Missed the Playoffs |

Franchise continuity is how fans think about team history, so Sonics seasons
answer "Oklahoma City Thunder" and Bullets seasons answer "Washington Wizards".

### Deliberately not shipped

- **`role`** ("Primary scorer", "Defensive anchor", …) exists in the scored
  table but its classes are far too thin — 54 defensive-anchor seasons across
  1979-80..2025-26 — to intersect with a team or an award and leave a solvable
  cell. Position + component constraints cover the same intent with real
  coverage.
- **A "1970s" era.** The data window opens at 1979-80, so it would be one
  season pretending to be a decade. Those seasons match no era constraint and
  remain valid answers for everything else.

---

## Answer universe

`nba_peak/daily_grid/pool.py` — **9,280 player-seasons across 1,384 players.**

Sources, all committed and local, no network access at any point:

- `cache/processed/scored_1980_2026.parquet` — official PEAK3 per-season
  `prime_score`, the five components, and the real award/postseason columns the
  model already consumes.
- `cache/processed/regular_1980_2026.parquet` — read **only** for `pos`, the
  position logged that season.
- `data/game/experimental/player_pool_1500/candidate_identity_manifest.v1.json`
  — the 1,390 criteria-admitted identities, used as a *recognizability filter
  only*: it decides who can appear as an answer, never what any of their
  numbers are. Without it the pool is 10.4k seasons of mostly deep-bench
  players, which makes a grid unguessable rather than hard.

Answer id: `{player_slug}-{season_nodash}-{team}`, e.g.
`michael-jordan-199091-chi`.

### Known limitation: traded players

Multi-team (`2TM`/`3TM`/`TOT`) rows are dropped. They are season aggregates,
not a real single-team-season, so a team constraint cannot be honestly
evaluated against them.

CourtBuilder's traded-player per-team-stint backfill is deliberately *not*
pulled in here: it resolves team membership but leaves the score at
season-aggregate grain, and a grid cell displays a PEAK3 score next to a team
badge. Rather than show a score that does not correspond to the team shown,
those stints are simply absent from the answer universe.

---

## Validation

`nba_peak/daily_grid/validation.py`

The client is never trusted and never holds the answer key. Rejections are
specific and teachable — `"1996-97 Michael Jordan played for the Bulls, not the
Lakers"` teaches something; `"invalid"` just annoys.

Rejection order is deliberate — structural problems before constraint failures,
so a player who reuses a name is told exactly that:

| `reason_code` | When |
|---|---|
| `cell_filled` | that square already has an answer |
| `unknown_answer` | the id is not a player-season in the pool |
| `player_already_used` | that identity is already on the board |
| `constraint_failed` | the season misses the row or the column condition |

The failure message names the side that actually failed, re-derived from the
constraint predicate rather than trusting the cached key, so the message can
never disagree with the reason the answer was excluded.

### Note on `used_player_slugs`

Phase 11A stores no server-side board state, so the used-identity list is
**client-supplied** — a convenience guard, not a security boundary. That is
acceptable: local progress is explicitly not cheat-proof and not eligible for
global ranking (CLAUDE.md § Security). Constraint validity — the part that must
be right — is decided from server data alone.

---

## Search

`nba_peak/daily_grid/search.py`

**Ranking, not filtering.** When scoped to a cell, valid answers sort first but
invalid ones are still returned, marked `eligible: false`. Hiding them would
leak the key by omission: a player could type "Jordan", see only three seasons,
and learn the answer set without submitting anything.

Name matching is prefix-and-substring with an optional season token
(`"jordan 96"`, `"1996-97 jordan"`). No fuzzy/edit-distance matching — it
produces confident wrong answers, and the pool is small enough that substring
matching finds everything a real query intends.

---

## Scoring

`nba_peak/daily_grid/scoring.py`

```
cell_score = round(prime_score * rarity_multiplier)
```

Two terms, each explainable in one line:

- **quality** — the season's own PEAK3 `prime_score` (the calibrated 0-100
  value the rankings already show). A better season is always worth more.
- **rarity** — a multiplier from how many valid answers the cell had:
  1.50x (very rare, <10) · 1.30x (rare, <25) · 1.15x (uncommon, <75) ·
  1.05x (common, <200) · 1.00x (open).

Kept shallow on purpose so one lucky tight cell cannot outweigh the rest of the
board. A cell is bounded at 150 points; a perfect board is bounded at 1,350.

**Rarity is a proxy for difficulty** — the size of the valid answer set — not a
measure of how rare the pick was among real players. True answer-frequency
rarity needs global submission counts and durable per-board storage, which
Phase 11A deliberately does not build. The proxy is named honestly everywhere
it surfaces.

Game scoring is `arena_points`, never `peak_score` (CLAUDE.md naming).

---

## Answer-key confidentiality

The board response is public and carries, per cell, only:

```
row, col, row_constraint_id, col_constraint_id, rarity_bucket
```

Never `answer_ids`, and never the raw answer count — on a six-answer cell the
count alone would narrow the search almost as much as the key. The coarse
bucket is what the scoring explanation needs and is safe to expose.

`GridBoard.as_public_dict()` is the only serializer the API may use for the
board, and tests assert the exact key set.

---

## Persistence

localStorage only, keyed `peak3.daily-grid.{board_id}`. A new date produces a
new `board_id`, so a new day starts clean without any expiry logic. Saves carry
a `schema_version` so a future shape change discards stale saves rather than
crashing on them.

No account-backed daily grid attempts in Phase 11A.

---

## Deferred

- account-backed saved daily grid attempts
- global completion stats / true answer-frequency rarity
- per-board global leaderboards
