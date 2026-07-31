# Daily Grid Challenge (11A shipped, 11B productized, 11C tuned, 11D hardened)

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

Phase 11D made it a daily habit rather than a one-off: a local streak and
history, a come-back-tomorrow loop, an account-backed official result for
signed-in players, and rate limits on every endpoint.

Routes: **`/daily`** (today's board, or `?date=` for an archive replay) and
**`/daily/history`** (your own record). Everyone gets the same board on the
same UTC date.

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

## Rate limiting and the probing model

`apps/api/app/core/rate_limit.py`, applied in `app/api/v1/daily_grid.py`.

The Daily Grid is the only router in this project that carries limits, because
it is the only one that answers repeated questions about a secret it is trying
to keep. Everything else serves data that is already public.

| Route | Default | Bucket key |
|---|---|---|
| `GET /board` | 120/min | client |
| distinct dates per client | 30/min | client (set of dates) |
| `GET /search` | 60/min | client + board date |
| `POST /answer` | 30/min | client + board date |
| `POST /result` | 20/min | client + board date |
| `POST /official` | 20/min | client + board date |

Every value is configurable (`PEAK3_DAILY_GRID_*`), and the defaults sit far
above human play — filling nine squares is about nine searches and nine
submissions — and far below what enumerating an answer set needs.

### What the limiter is and is not

It is a fixed-window counter in a bounded dict, and it is honest about the
shape of deployment it fits: **a single API process**. It does not survive a
restart, does not coordinate across replicas, and keys partly on client IP,
which a caller behind a rotating proxy can change. A Redis-backed limiter is
the upgrade path when the API runs more than one process; `RateLimiter` is the
seam.

None of that makes it useless. The threat it addresses is one client scripting
the search endpoint faster than a person could, and a per-process bucket is the
right size of answer for that. **The real defence against reading the key is
still the search module's own eligibility cap** — this is the second layer,
deliberately cheap.

### Why the distinct-DATE cap is its own primitive

"How many board requests?" and "how many different DATES?" are different
questions, and only the second one distinguishes normal play from corpus
building. Reloading today's board fifty times is ordinary; pulling fifty
different dates is assembling an offline library of boards. A plain counter
cannot tell those apart, and folding the date into the bucket key cannot either
(that just gives every date its own budget) — so `check_distinct` keeps the set
of dates seen in the window. **A date already seen is free, forever**, which is
what keeps reload, retry and archive replay unaffected.

### What a 429 says

Nothing a prober can calibrate against. There is no `X-RateLimit-Remaining` on
the success path and no bucket name or limit in the error body: a running count
of requests left is precisely the signal that would let someone ride just under
the limit indefinitely. `Retry-After` is sent, because a well-behaved client
genuinely needs it and it says nothing about the budget's size.

The client turns a 429 into "you're searching faster than the grid allows —
your board is safe", because a rate limit is a wait, not data loss: the locked
picks and the timer are untouched.

### Input hygiene

- Query length is clamped in `search.py` as well as at the route's
  `max_length`, so a caller that bypasses the route cannot reintroduce a
  full-pool scan on a 5,000-character string.
- Whitespace collapses during normalization, so `"jordan"`, `"  jordan  "` and
  `"jordan..."` are one query rather than three novel-looking ones.
- Response size is capped at `MAX_LIMIT` (50) regardless of the `limit` asked
  for.

### How this is tested, and why Playwright is not throttled

Limits are **on by default everywhere**, including local dev — a limiter that
is only enabled in production is a limiter nobody has tested. The API tests
therefore exercise the limited path, and the 429 cases work by deliberately
exceeding a limit rather than by flipping a switch nothing else uses. An
autouse fixture resets the limiter before every test, so each one starts with
exactly the configured budget and test order cannot change an outcome.

`RateLimiter` takes an injectable clock, so the unit tests assert exact
allow/deny and window-reset boundaries without sleeping. Nothing about the
limiter's tests depends on how fast the machine is.

The Playwright server (`npm run start:api`) raises every limit via
`PEAK3_DAILY_GRID_*` env vars. That is not the limiter being disabled — the
code path still runs, so a bug in it would still surface — it is an
acknowledgement that the e2e harness legitimately drives search far harder
than a human can: it discovers real answers by probing the live endpoint
rather than hardcoding a key.

### What is still client-supplied

`used_player_slugs` on `/answer` and `used` on `/search` are the client's own
view of its board. They are a **convenience** — they let the server mark
already-spent identities — and they are never a security boundary. The
distinct-identity rule that matters is re-enforced server-side on `/answer` and
re-checked across the whole board on `/result` and `/official`, where `used`
accumulates as the server walks the nine squares.

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

A third key, `peak3.daily-grid.archive`, is the one Daily Grid value that
deliberately OUTLIVES a single day — see § Streaks and local history.

Signed-in players additionally get a durable server-side copy of each completed
board (§ Official account-backed results). Anonymous play is unaffected.

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

Phase 11D adds the loop underneath: the streak trio (current / longest / total),
a "come back tomorrow" line with a countdown to the next UTC board, a preview of
recent grids, and a link to `/daily/history`. The badge says which of two things
is true — **Saved on this device** for an anonymous player, **Saved to your
account** once the server has a validated copy — and neither implies a ranking.

Share text carries the date, theme, score-against-maximum, grade, time, misses
and a plain-text 3x3 recap (`#` best, `+` close, `-` fair, `.` weak) with its
legend. ASCII rather than emoji, matching this product's existing share style.
A streak line is added only from a real local record and only at 2+ days — a
"1 day streak" is just "I played", and a streak shared out of an empty archive
would be a number the sharer cannot themselves see. It states no rank and no
percentile, because there is nothing to state.

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
- **Sent to the server only as part of a signed-in player's official result
  (11D), where it is stored presentationally.** The server does not time
  attempts, so the value is bounded rather than believed, and it is never
  scored, compared or ranked. Anonymous players' times never leave the browser.

**Why it does not affect the score.** The number is client wall-clock: nothing
server-side observes when a board was started or finished. Scoring or ranking
an unverified duration would be inventing a competition that cannot be
checked — the same reason there is no leaderboard. Making time count would mean
timing attempts server-side first, which is listed as a prerequisite in
§ Leaderboards. The clock is real; the claims made about it are not more than
it can support.

---

## Streaks and local history (11D)

`apps/web/src/lib/daily-grid-archive.ts`

An anonymous player gets a full retention loop with no account: a streak, a
record of every board they have finished, and a `/daily/history` page. All of
it is localStorage, and every surface that shows it says so.

### What is kept per completed board

Board id, date, theme, difficulty, start/completion timestamps, elapsed
seconds, score, today's maximum, percent of it, grade, misses, filled count,
whether it counted for the streak, and the nine picks **as display labels**.

Labels, not answer ids — deliberately. A stored answer key would turn a
finished archive into a solution sheet for anyone else using that browser.

Each row is a **snapshot**, not a pointer: it stores the numbers as they stood
on the day. Re-deriving them later would let a taxonomy or model change quietly
rewrite someone's own history, which is the opposite of what a personal record
is for (the same reasoning as `SavedRun` on the 82-0 side).

### The streak rule

**Only a board played on its own UTC date counts.** Finishing today's grid
continues the streak; finishing an archive board through `?date=` is recorded
and shown, but never touches `current_streak`.

The looser rule — any completion extends the streak — is unshippable here,
because every past board is permanently available at a guessable URL. A streak
that can be reconstructed in an afternoon by walking the calendar measures
nothing, and the number would be a lie told to the only person it matters to.
The strict rule costs a genuine case (you played, the browser lost the write)
and that is the right trade: a streak is only worth showing if missing a day
actually breaks it.

Yesterday still counts as live. A player who finished last night and opens the
page this morning has not broken anything — they simply have not played yet.

### Derived, not accumulated

`current_streak`, `longest_streak`, `total_completed` and the bests are
**recomputed from the stored entries on every read and every write**, never
incremented in place. A counter that is only ever `+= 1` cannot recover from a
bad write, a clock change, or a hand-edited localStorage value; a derivation
can. It also means a tampered "900-day streak" is corrected the moment it is
loaded rather than displayed once and fixed later.

Recording is idempotent per `board_id`: the completion effect fires on every
mount of a finished board and again when the comparison lands, so a re-record
REPLACES the row (upgrading it with today's max when that arrives) rather than
appending. Replaying the same day cannot double-count it either, because the
streak counts distinct dates.

UTC throughout, matching the clock boards are generated on — using the
browser's local date would put a player in UTC+13 on "tomorrow's" streak day
while the API is still serving today's board.

### Known limits

localStorage is per-browser, editable, and cleared with site data. It is not
cheat-proof and is explicitly not eligible for ranking (CLAUDE.md § Security).
That is exactly why the label says "Saved on this device" and why the official
result below exists.

---

## Official account-backed results (11D)

`supabase/migrations/20260730190000_daily_grid_results.sql`,
`app/repositories/daily_grid_*.py`, `POST /api/v1/daily-grid/official`

A signed-in player also gets a durable, server-validated copy: one official
result per user per (board date, board version).

### What is actually verified

Everything scored. The whole board goes through the **same**
`_revalidate_completed_board` helper the result comparison uses — all nine
squares present, every answer re-checked against server data, the
distinct-identity rule re-checked across the board — and then every stored
number (score, today's maximum, percentage, squares matched) is **recomputed**
by `build_result`. The request model carries no score field at all, so a client
cannot report a false one; it cannot report one.

Sharing the validation helper between the two routes is deliberate: two copies
of "is this board real?" is two chances for one to drift into being more
permissive, and the more permissive one is the one an attacker would use.

### What is not verified

`elapsed_seconds` is client wall-clock — the server does not time attempts — so
it is stored presentationally, bounded rather than believed, and never scored
or ranked. **That asymmetry is precisely why the timer must not become a
scoring term until the server times attempts itself.** `theme` is display copy
and is re-derived server-side rather than trusted.

### Immutable and idempotent

A second POST for the same board returns the existing record with
`created: false` and HTTP 200. A daily attempt happens once; a retry after a
reload is not new information, and letting it overwrite would let a player
resubmit until they liked the number. There is no UPDATE policy on the table
and no update path in the repository.

### Not a leaderboard

No public-read policy, no ranking endpoint, no read route for anyone but the
owner. RLS is owner-only for select/insert/delete, as a second layer behind the
API's own service-role owner scoping. Anonymous play is never blocked or
degraded — the local archive is the whole product for those players, and the
official save is strictly additive.

The migration is **local only**; `supabase db push` was not run, matching the
discipline of the leaderboard and saved-run migrations.

---

## Archive and replay (11D)

`?date=YYYY-MM-DD` loads any past or future board. It is supported, and it is
labelled:

- a banner on the board names the date and states that it does not count toward
  the streak, with a link back to today;
- the completion screen points at today's grid rather than at tomorrow;
- history rows carry a **Replay** tag;
- progress keys are `board_id`-scoped, so opening an old date can never
  overwrite today's board;
- the share text leads with the board's own date.

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

**Phase 11D built the foundation and stopped there.** `daily_grid_results` now
holds one immutable, fully server-validated result per signed-in user per
board — which is exactly the record a ranking would have to be computed from.
What is still missing before anything can be published:

1. **A decision about what a verified attempt is.** Today an anonymous player
   can complete a board and a signed-in player can complete the same board
   later at their leisure; ranking those together needs a rule about when the
   clock starts and whether replays are eligible at all.
2. **Server-side timing**, if time is ever to be ranked. `elapsed_seconds` is
   client-reported and will stay unranked until it is not.
3. **Abuse controls beyond a per-process limiter** — an account-creation cost,
   or at minimum a shared limiter — since a leaderboard turns board-probing
   from pointless into profitable.
4. **A published projection with its own RLS**, rather than relaxing the
   owner-only policy on the record table.

Until all four exist, no rank, percentile or "you beat X% of players" appears
anywhere in the UI or the share text, and the tests assert their absence.

---

## Deferred

- global daily leaderboard (see § Leaderboards above for the four prerequisites)
- a read route for a user's own official results (11D writes them; nothing
  reads them back yet, because the local archive already serves the history UI
  and a second source of truth would need a reconciliation rule first)
- global completion stats / true answer-frequency rarity
- importing a local streak into an account (would mean trusting client history)
- a calendar heat-map view; `/daily/history` ships as a list this pass
- a separate non-competitive "Practice Grid" with reset and replay
- a verified speed leaderboard, or time as a scoring term (see § Timer)

---

## Known limitations

- **Local progress is not cheat-proof.** localStorage can be edited; the server
  re-validates every submitted answer and re-validates the whole board before
  releasing today's maximum, so a tampered board cannot unlock the answer key —
  but a tampered *score display* is possible and is not eligible for any
  ranking (CLAUDE.md § Security). The same applies to the local streak, which
  is why it is derived from the stored entries rather than trusted as a number.
- **The rate limiter is per process.** Restarting the API clears it, and N
  replicas mean N times the limit. It is a nuisance cost, not a security
  boundary — see § Rate limiting for what actually protects the answer key.
- **A streak lives in one browser.** Switching device or clearing site data
  loses it, and signing in does not import it: the official result table starts
  from the day the account first completes a board. Backfilling a local archive
  into an account would mean trusting client-reported history, which is the one
  thing the official record exists not to do.
- **`elapsed_seconds` is unverified** on the official record and is stored for
  display only.
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
