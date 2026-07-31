# Daily Grid Challenge (Phase 11A, productized in 11B, tuned in 11C)

PEAK3's competitive daily game. A 3x3 board whose rows and columns are
**basketball facts** — franchises, awards, eras, positions, playoff runs,
season workload; every square is filled with an **exact NBA player-season**
satisfying both.

> **The objective: use basketball knowledge to fill the grid.
> PEAK3 reveals how strong your picks were.**

Phase 11A shipped a grid that worked but did not say what winning meant.
Playtesters could not tell whether they were meant to find *any* valid answer,
the rarest one, or the best one — and search results printed each candidate's
PEAK3 score, so the optimal strategy was "type a name, click the biggest
number". Phase 11B made it an optimisation puzzle and removed the shortcut.

Phase 11C fixed what 11B's own framing exposed. Once the objective is *maximise
your PEAK3 total*, an axis reading `60+ PEAK` or `Top 10% Statistical Impact`
is asking the player to do, as an eligibility test, the same thing the scoring
already rewards — so those squares collapsed to "name the biggest all-time
player who clears the bar", and the same five or six legends answered every
board. **PEAK3 is now the hidden scoring layer, not the category.** 11C also
made the search say plainly what each result is, rebuilt the completion state
into a game result, and added a clock.

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
- **Search confirms eligibility but never a score.** Results that cannot be
  played — a player already used, or a season that does not fit — are labelled
  and disabled rather than left to be discovered by clicking.
- Wrong answers are rejected with a reason and counted.
- Every submission is validated server-side. The client never holds the key.
- **A clock runs from your first move.** It is for you: it does not affect your
  score and is not ranked.
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

`board_id` is `daily-grid-v2-YYYY-MM-DD`. It is the client's progress key, which
is what makes yesterday's saved board fall away on its own. The version moved
to `v2` in 11C because the composition rules changed enough that every date's
board changed — a `v1` id must never resolve to a `v2` board.

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

Feasibility alone produces dull boards. 11A's rules allowed "Center × Nuggets",
"All-Star × Heat" — technically fine, but a database lookup rather than a
puzzle. 11B tightened that and then over-corrected the other way by *requiring*
two PEAK3-native axes. A board must now have:

- **1–2** team constraints (a third franchise crowds out everything
  interesting and was the main source of the lookup-table feeling)
- **at most 1** PEAK3 score/component axis, and on most dates **zero** — see
  "Why score-derived constraints are mostly excluded" below
- **at most 1** season-context axis (minutes/games); two crossed with each
  other is an availability quiz, not a puzzle
- at least **2** award / playoff-outcome / era anchors — these are what make
  "Lakers × MVP" rather than "Lakers × Center"
- team + position together may claim **at most half** the six axes
- at least 4 distinct categories, and at most **2** axes from any one category
- at least one recognizable constraint on **each** axis
- no nested or mutually-exclusive pair crossing (see below)

Two further rules make each *square* a real decision rather than a recall test:

- **Every square offers a genuine choice** — at least 3 distinct players hold a
  qualifying season worth ≥70% of that square's best. A square with one runaway
  answer and a long weak tail is not a decision.
- **No GOAT domination** — no single player may be the single best answer to
  more than 3 of the 9 squares, or the unique-player rule becomes a chore
  instead of a strategy.

Boards this produces: `Lakers × MVP`, `Heat × 2000s`, `Bulls × All-Defense`,
`Spurs × Champion`, `Knicks × Guard`, `DPOY × Finals Run`, `Center × All-NBA`,
`2010s × Finals MVP`, `Suns × 1990s`, `Pistons × DPOY`.

### Why score-derived constraints are mostly excluded

The `peak` and `component` families are still shipped — they are honest,
well-defined predicates over real data, and `/daily-grid/constraints` still
enumerates them. What changed in 11C is how often the generator may use one.

The reason is game design, not data quality. The mode's objective is to
maximise total PEAK3 score. An axis that reads `60+ PEAK` therefore restates
the objective as an eligibility rule, which has three effects:

1. the square's best answer is whoever has the highest PEAK3 season that
   clears the bar — i.e. the answer *is* the optimisation target;
2. the same handful of all-time greats answer every such square, so boards
   converge on the same names;
3. the player learns nothing about basketball by solving it.

So `generator._native_allowance()` gives a date **one** such axis on roughly
one date in five (keyed off the seed, so it is deterministic and cannot line up
with a weekday), and **zero** on the rest. The hard ceiling is 1; two score or
component axes on one board is impossible by construction and asserted in
tests. When one does appear it is a spice, never the shape of the board.

### Board theme

Each board carries a short, deterministic label derived from the axes it
actually has — `Ring Chasers`, `Award Season`, `Franchise Icons`,
`Two-Way Night`, `Playoff Pressure`, `Modern Era`, `Throwback Night`,
`Open Court`. It is a *description*, never a generation input: `board_theme()`
is a pure function of the axis set, so it cannot drift from the board it labels
and cannot influence which board a date gets. It carries no answer information
(it is computed from labels the client already has).

### Exclusive groups

Two constraints sharing an `exclusive_group` never appear on opposite axes:

- **Mutually exclusive** — a player-season has exactly one team, one decade,
  one position. "Lakers x Celtics" has no answers, ever.
- **Nested** — "85+ PEAK" is a strict subset of "80+ PEAK", so crossing them
  makes the outer constraint decoration rather than a real condition. Same for
  MVP inside top-5-MVP, All-NBA 1st inside All-NBA, Scoring Champion inside
  League Leader, 36+ MPG inside 30+ MPG, and the
  champion → finals → conference-finals → made-the-playoffs ladder.

The empirical answer-count gate would already reject the mutually-exclusive
pairs (zero answers); nested pairs pass it while still making a bad board, so
the grouping is enforced explicitly.

### Measured behaviour (365-day sample, 11C rules)

- 365/365 boards generated, **all distinct**
- **298 boards (82%) carry zero PEAK3-native axes**; the other 67 carry exactly
  one. No board carries two.
- minimum cell across the whole year: 6 answers, 4 distinct players
- 65 of the 68 shipped constraints appear at least once
- ~21 ms per board; worst date needs ~3,300 of 8,000 attempts
- difficulty splits evenly across the year (122 easy / 123 medium / 120 hard)
- today's maximum ranges roughly 700–910 points

---

## Constraint taxonomy

`nba_peak/daily_grid/constraints.py` — 68 constraints.

The gate for shipping one is strict: **if the fact cannot be read out of
committed data at player-season grain, the constraint does not exist.** Nothing
is inferred, estimated, or approximated. A grid is only fun if "that answer
should have counted" is never true.

| Category | Count | Examples |
|---|---|---|
| `team` | 30 | Boston Celtics, Chicago Bulls — relocations folded in |
| `award` | 12 | MVP, Top-5 MVP, DPOY, DPOY Votes, Finals MVP, All-NBA (+1st), All-Defense (+1st), All-Star, Scoring Champion, Led the League in a Major Category |
| `era` | 5 | 1980s … 2020s |
| `position` | 3 | Guard, Forward, Center — per **season**, not per career |
| `context` | 3 | 30+ MPG, 36+ MPG, Played 70+ Games — real `mpg`/`g` columns, per season |
| `outcome` | 5 | NBA Champion, Reached the Finals, Reached the Conference Finals, Made the Playoffs, Missed the Playoffs |
| `peak` | 5 | 60+ / 70+ / 75+ / 80+ / 85+ PEAK Season — **rationed**, see above |
| `component` | 5 | Top 10% Statistical Impact / Traditional Production / Individual Recognition / Postseason Value / Team Achievement — **rationed**, see above |

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
- **Per-game statistical thresholds** ("25+ PPG", "10+ APG"). The per-75 and
  per-100 rates on the scored table are pace/possession-adjusted, so a
  threshold on them would not mean what a fan reads it to mean; the raw
  per-game columns a fan *does* mean are not all present at this grain. The
  league-leader flags cover the same "who was the best at X" intent from data
  that is exactly what it says.

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

Search's job is to help the player *place* a name they have already thought of,
without answering the puzzle for them and without ever revealing a score.

### Every result says what it is (11C)

Each hit carries a **status**, and the UI disables the ones that cannot be
played. Up to 11B the list marked "Fits" / "No fit" but left everything
clickable — so the only way to learn a result was unplayable was to submit it,
and worse, a player already spent on the board still showed as fitting.

| Status | Meaning | Selectable |
|---|---|---|
| `available` | fits this square, identity unused | yes |
| `used` | this player is already on the board, so the distinct-identity rule rules out **all** of their seasons | no |
| `no_fit` | does not satisfy the square's two constraints | no |
| `unknown` | verdict withheld for this query (below) | yes — the player may submit and find out |

`used` wins over eligibility in both directions: an identity already on the
board cannot be played here whether or not the season qualifies, and that is
the reason the player needs to see. It is derived from client-supplied board
state (`?used=slug&used=slug`), so it tells the client nothing it did not
already know and stays truthful even when eligibility is withheld.

**Ranking, not filtering.** Unusable hits are still returned, marked and
disabled. Hiding them would leak the key by omission: a player could type
"Jordan", see only three seasons, and learn the answer set without submitting
anything. Order is `available`/`unknown` → `used` → `no_fit`, then name-match
quality, then chronological.

### How much eligibility a query earns

11B gated verdicts on "is this query narrow?" — at most 6 distinct matching
identities. That withheld a verdict from a query like `br` on a Knicks × Guard
square even though barely any `br` names qualify, so the player had to click
Brad Daugherty to discover he was a Cleveland centre. Friction with no security
value.

11C measures the thing actually at risk instead: **how many of this square's
answers would one response hand over.** If a query's hits contain more than
`MAX_REVEALED_ELIGIBLE_IDENTITIES` (3) distinct *qualifying players*, every hit
comes back `unknown` and the client cannot tell valid from invalid.

- counted in distinct **players**, because the distinct-identity rule makes the
  player the real unit of an answer — and because "which of Alex English's
  seasons is the one?" is one identity however many seasons it matches, so
  naming a player always earns a verdict;
- computed over the whole matched set, not the returned page, so raising
  `limit` cannot buy a bigger reveal;
- all-or-nothing per response, so withheld verdicts cannot be inferred from
  the ones that were given.

The incentive shape is the point: the closer a query gets to being a bulk
answer-key extractor, the less it says.

### What search never carries

No `prime_score`, no `arena_points`, no cell points, and no score-derived
ordering. Within a name-match group hits are ordered **chronologically**, never
best-first — ranking a player's seasons by score would leak the optimisation
target just as surely as printing the number, since the player would simply
click the top row every time. Career order is neutral, and it is also how
someone recalls a career they are trying to place ("his third year, the one
they won it").

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
a `schema_version` (**3** as of 11C, when `started_at` was added; 2 came from
11B, when `FilledCell.player_season` lost its score) so a stale save is
discarded rather than migrated. A board is one day old at most, and the
`board_id` itself moved with the generator version anyway.

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

### What the player sees (rebuilt in 11C)

The 11B recap was accurate but had to be *read* — a player could not tell at a
glance whether they had done well. The completion state is now a game result:

1. **Headline** earned from percent of today's maximum — `Perfect Grid` (100%),
   `Near Perfect` (≥90), `Strong Run` (≥75), `Room to Improve`. "Perfect Grid"
   is reserved for actually matching the maximum; with the score hidden until
   each pick locks, a 100% board is a genuine achievement and calling anything
   less by that name would cheapen it.
2. **Score trio** — your score, today's maximum, percent of it.
3. **Time, misses, squares at the max** on one line.
4. **3x3 mini recap** — each square shows the points it paid, coloured by how
   close it came to the best answer available *there*, `Max` on squares where
   no better answer existed, and a red outline on the biggest miss.
5. **Biggest miss card** — the square, what you used, what PEAK3 would have
   used, and the points left.
6. **"What PEAK3 would have used"** — only the squares it would have *changed*
   by default, expandable to all nine. Listing nine rows when six matched
   buries the three that did not.

Share text carries the date, theme, score-against-maximum, grade, time, misses
and a plain-text 3x3 recap (`#` best, `+` close, `-` fair, `.` weak) with its
legend. ASCII rather than emoji, matching this product's existing share style.
It states no rank and no percentile, because there is nothing to state.

---

## Timer (11C)

A local, presentational clock. It exists to add pressure and give a personal
benchmark, and it deliberately does **not** enter the score.

- **Starts on the player's first move** (dismissing the rules gate, or the
  first square selection for a returning player), not on page load — a
  returning player lands straight on the board and should not be charged for
  reading it.
- **Persists across a refresh.** Stored as a start *timestamp*, not an
  accumulated duration, so a reload continues it rather than restarting or
  double-counting it, and no tick loop writes to localStorage. The trade-off is
  that it keeps running while the tab is closed, which is the honest reading of
  "how long did today's grid take you".
- **Stops at completion.** Elapsed time is `(completed_at ?? now) − started_at`,
  so once `completed_at` is stamped the number is frozen by construction rather
  than by remembering to clear an interval.
- **Never negative** — a clock skew between two sessions floors at zero rather
  than printing `-3:12`.
- Shown in the status bar, on the result screen, and in the share text.
- Client-side only: not sent to the server, not persisted to an account, not
  ranked.

**Why it does not affect the score.** Tying time to score, or ranking on it,
before account-backed attempts and rate limits exist would be inventing a
competition that cannot be verified — the same reason there is no leaderboard.
The clock is real; the claims made about it are not more than it can support.

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
- a verified speed leaderboard, or time as a scoring term (see § Timer)

---

## Known limitations

- **Local progress is not cheat-proof.** localStorage can be edited; the server
  re-validates every submitted answer and re-validates the whole board before
  releasing today's maximum, so a tampered board cannot unlock the answer key —
  but a tampered *score display* is possible and is not eligible for any
  ranking (CLAUDE.md § Security).
- **Rarity is a proxy for difficulty**, not real answer-frequency rarity: it is
  the size of a cell's valid answer set, not how rare the pick was among
  players. Named as "answer pool" everywhere it surfaces so it is never
  mistaken for "only 2% of players found this".
- **The timer keeps running while the tab is closed** — see § Timer for why
  that trade-off was taken.
- **Traded players are absent at the per-team-stint grain.** Multi-team rows
  (`2TM`/`TOT`) are dropped rather than shown with a season-aggregate score
  next to a single team badge.
- **`used` is client-supplied.** It drives the `used` status as a convenience;
  the distinct-identity rule that *matters* is re-enforced server-side on both
  `/answer` and `/result`.
