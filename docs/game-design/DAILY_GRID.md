# Daily Grid Challenge (Phase 11A, productized in 11B)

PEAK3's competitive daily game. A 3x3 board whose rows and columns are
basketball/PEAK3 constraints; every square is filled with an **exact NBA
player-season** satisfying both.

> **The objective: build the highest-scoring valid 3x3 grid.**

Phase 11A shipped a grid that worked but did not say what winning meant.
Playtesters could not tell whether they were meant to find *any* valid answer,
the rarest one, or the best one — and search results printed each candidate's
PEAK3 score, so the optimal strategy was "type a name, click the biggest
number". Phase 11B made it an optimisation puzzle and removed the shortcut.

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
- **PEAK3 scores are hidden until a pick is locked.**
- **A valid locked pick is final.** There is no reset on the daily board.
- Wrong answers are rejected with a reason and counted.
- Every submission is validated server-side. The client never holds the key.
- When the board is full, it is measured against **today's maximum**.

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

### Composition rules (tightened in 11B)

Feasibility alone produces dull boards. 11A's rules allowed "Center × Nuggets",
"All-Star × Heat" — technically fine, but a database lookup rather than a
puzzle. A board must now also have:

- **1–2** team constraints (was 2–3; a third franchise crowded out everything
  interesting and was the main source of the lookup-table feeling)
- **2–3** PEAK3-native constraints — two is preferred and, in a 365-day
  sample, every board achieves it (the floor of 1 is a fallback that has never
  had to fire)
- at least one **award / playoff outcome / era** anchor
- team + position together may claim **at most half** the six axes
- at least 4 distinct categories, and at most **2** axes from any one category
- at least one recognizable (team/award/era/position/outcome) constraint on
  **each** axis, so no cell is pure formula or pure trivia
- no nested or mutually-exclusive pair crossing (see below)

Two further rules make each *square* a real decision rather than a recall test:

- **Every square offers a genuine choice** — at least 3 distinct players hold a
  qualifying season worth ≥70% of that square's best. A square with one runaway
  answer and a long weak tail is not a decision.
- **No GOAT domination** — no single player may be the single best answer to
  more than 3 of the 9 squares, or the unique-player rule becomes a chore
  instead of a strategy.

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

### Measured behaviour (365-day sample, 11B rules)

- 365/365 boards generated, **all distinct**
- every board carries 2–3 PEAK3-native axes (321 boards with 2, 44 with 3)
- minimum cell across the whole year: 6 answers, 4 distinct players
- every one of the 62 shipped constraints appears at least once
- ~21 ms per board; worst date needs ~1,900 of 6,000 attempts
- today's maximum ranges 702–1,044 points across the year

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

**Ordering carries no score signal (11B).** Within a name-match group, hits are
ordered chronologically, never best-first — ranking a player's seasons by score
would leak the optimisation target just as surely as printing the number, since
the player would simply click the top row every time. Career order is neutral,
and it is also how someone recalls a career they are trying to place ("his
third year, the one they won it"). Eligible hits still sort ahead of ineligible
ones, which is the search's actual job.

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
a `schema_version` (2 as of 11B, when `FilledCell.player_season` lost its
score) so a stale save is discarded rather than crashing.

**No reset.** `clearProgress()` still exists for tests, but nothing in the UI
calls it: a valid pick is locked, and a "start over" button would make both the
day's score and the comparison against today's maximum meaningless. Clearing
localStorage by hand is possible and not worth defending against — what matters
is that the product does not offer it as a move.

A separate `peak3.daily-grid.rules-seen` key records that the player has seen
the how-to-play gate. It is global rather than per-board: the rules do not
change daily, and re-explaining them every morning is friction, not
onboarding.

No account-backed daily grid attempts.

---

## Hiding the score until a pick is locked (11B)

The objective is to maximise total PEAK3 score, so a season's rating **is** the
answer to the puzzle. Four separate channels leaked it in 11A, and all four are
closed:

| Channel | Fix |
|---|---|
| Search results printed each candidate's `prime_score` | `PlayerSeason.as_search_dict()` — the search response has no score field at all |
| Search *sorted* candidates best-first | Ordered chronologically within a name-match group; the top row is no longer the best answer |
| A rejected answer returned its full card | Submit responses return identity only, valid or not |
| A `peak`-threshold rejection printed the exact score | Says it missed the bar, never by how much |

The last two mattered most: together they made any square a free **score
oracle** — submit a season you know will fail, read its rating, optimise the
rest of the board without spending a pick.

A locked square learns its own score through `CellScore.quality_points`, which
only exists on a valid result and therefore cannot be reached by probing.

**Eligibility is still revealed** for a query that names a specific player
(≤6 distinct identities). Knowing *whether* a season qualifies is a different
fact from knowing *how much* it is worth — and with the score hidden, choosing
among a player's several qualifying seasons is exactly the judgement the mode
is asking for. Broad queries reveal nothing (see § Search).

---

## Today's maximum

`nba_peak/daily_grid/optimal.py`

The competitive reference. Computed **exactly**, not approximated.

A cell's rarity multiplier is fixed, so for a given (cell, player) the best
season is simply that player's highest-scoring valid one — there is never a
reason to prefer a lower one. Collapsing each (cell, player) pair to that value
turns the whole thing into a rectangular **linear assignment problem**: 9 rows
by however many distinct players appear on the board, with the no-duplicate
rule becoming assignment's own one-player-per-row constraint.
`scipy.optimize.linear_sum_assignment` solves it to proven optimality in ~1 ms.

So the result screen can honestly say *"today's maximum"* rather than *"the
best we found"*. `OptimalSolution.exact` records which claim is being made, and
the UI wording follows it — overclaiming there would be exactly the kind of
unearned certainty the rest of the project avoids.

Determinism is stronger than "the solver is deterministic": the player list is
sorted and per-(cell, player) ties break on answer id, so the same board yields
the same nine *named seasons* every time. That matters because the result
screen names them.

### Gating

`POST /api/v1/daily-grid/result` is the only route that returns answer-key
material, so completion is **enforced, not trusted**:

1. all nine squares present, each exactly once;
2. every submitted answer re-run through the full validator against server
   data;
3. the no-duplicate-player rule re-checked across the whole board.

A client that has not genuinely finished gets a 400 and learns nothing.
Otherwise posting nine junk ids would read back the optimal solution — the
whole puzzle.

### What the player sees

Total score, today's maximum, percent of it, squares matching the best
available answer, the biggest miss (named, with what PEAK3 would have used),
and an expandable per-square comparison. Share text carries the percent line.

---

## Leaderboards — direction, not a claim

There is **no global leaderboard**, and the UI never shows a global rank. The
competitive reference is today's maximum, which is a real, provable number that
needs no other players to exist.

This is a deliberate stopping point, not an oversight. A daily leaderboard
needs durable per-user daily results and an anti-cheat story that local
progress explicitly does not have (CLAUDE.md § Security: localStorage scores
are not cheat-proof and not eligible for global ranking). Shipping a
leaderboard fed by client-reported scores would be a fake leaderboard.

The API shape is already compatible with one: `POST /daily-grid/result` takes a
board and re-validates it server-side, which is exactly the trust boundary a
leaderboard submission needs. A future phase can persist the validated result
against an account without changing the contract.

---

## Deferred

- account-backed saved daily grid attempts
- global daily leaderboard (see § Leaderboards above for why not yet)
- global completion stats / true answer-frequency rarity
- a separate non-competitive "Practice Grid" with reset and replay
