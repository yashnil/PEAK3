# PEAK3

PEAK3 is a basketball analytics model and a set of games built on top of it.

The model, `peak3`, scores every qualifying NBA player-season from 1979-80
through 2025-26 with one transparent five-component formula and finds each
player's best consecutive peak window. PEAK3 Arena, the web product, turns
those exact player-seasons into cards and asks you to build with them: run a
roster through five boss battles, draft against two other people from the same
franchise-and-decade roll, win a $20 auction, chase an 82-0 season, or fill a
daily 3x3 grid. Every score a game shows is the model's own number, produced
offline, explained on screen, and never recomputed in the browser.

---

## Contents

- [Core idea](#core-idea)
- [Product surfaces](#product-surfaces)
- [Game modes](#game-modes)
- [Exact peaks and player-seasons](#exact-peaks-and-player-seasons)
- [The PEAK3 model](#the-peak3-model)
- [Game-feel and server authority](#game-feel-and-server-authority)
- [Accounts, handles, progress and boards](#accounts-handles-progress-and-boards)
- [Technical stack](#technical-stack)
- [Repository layout](#repository-layout)
- [Local development](#local-development)
- [Feature flags and readiness](#feature-flags-and-readiness)
- [Testing and CI](#testing-and-ci)
- [Deployment](#deployment)
- [Data and the fact bank](#data-and-the-fact-bank)
- [Accessibility, motion and responsive support](#accessibility-motion-and-responsive-support)
- [Project status](#project-status)
- [Development workflow](#development-workflow)
- [Further documentation](#further-documentation)

---

## Core idea

Most "greatest ever" arguments compare reputations. PEAK3 compares specific
seasons. A card in any PEAK3 game is either one exact player-season (a player,
a team, a year, with the games and minutes they actually played) or a peak
window of a stated length anchored on a real season. There are no career
composites and no hand-picked winners.

Three principles run through the model and every game:

- **One formula, fixed weights, explained on screen.** The rankings, the
  player pages and the games all read the same committed scores. Any number
  in the UI comes with the component breakdown that produced it.
- **The model is a view, not a verdict.** The product says "PEAK3 rates" and
  "the model gives", because a different defensible weighting would order
  players differently.
- **Missing data stays missing.** A season below the model's minutes
  threshold is reported as unscored, never estimated. Metrics that did not
  exist in an era are handled by era-relative formulas, not substituted values.

---

## Product surfaces

PEAK3 Arena is one Next.js app with three kinds of surface.

### The model surface: rankings, players, methodology

The reference side of the product, where the model is exposed directly.

| Route | What it is |
|---|---|
| `/rankings` | Two boards, *Peak Windows* and *Single Seasons*, sortable by total or any component, filterable by position, with a per-row explanation panel (raw contribution, weight, all-time percentile). |
| `/players/[slug]` | A player's scored seasons and peak windows with the full component breakdown. Reached from the Fact of the Day panel on the home page. |
| `/methodology` | Interactive formula explorer. |
| `/about`, `/data-sources`, `/accessibility`, `/privacy`, `/terms`, `/contact` | Provenance, sources, the accessibility statement and legal pages. |

Both rankings boards apply a 25 minutes-per-game floor on the ranked season.
Seasons below it are still fully scored and still playable in the games; they
are just not ranked.

### The Arena: the games

`/arena` is the catalogue. The navigation groups the modes as Flagship (Run
the Table, 82-0 PEAK Season), Daily (Daily Grid, Peak Duel Daily),
Multiplayer (Three-Man Weave, with its Classic, Franchise Draft and Decade
Draft formats nested beneath it, and The $20 Showdown), Competitive (Ranked,
the 82-0 leaderboard, match history) and Explore (Peak Duel Endless, rankings,
methodology). Entries whose feature is off are left out of the menu rather
than shown broken. `/daily` is the hub for everything that resets once a day.
PRIME CUT and FIND THE PRIME are not in the menu; they appear only as lobby
cards, and only when their flags are on. The modes themselves are described in
the next section.

### Legacy Labs

`/arena/labs` holds the original *Peak Draft* prototypes (1Y Apex, 3Y Prime,
5Y Foundation), their daily and practice boards under `/arena/daily/[mode]`
and `/arena/practice/[mode]`, their result pages, challenge links under
`/c/[token]`, and the ranked Peak Draft queues under `/arena/ranked`. These
routes are live and tested but are not linked from the navigation or the home
page, are marked no-index, and are labelled on the page as not part of the
main PEAK3 experience. `/v2-preview` is an internal component gallery, also
no-index.

---

## Game modes

All rules live in Python under `nba_peak/` and are enforced by the API. The
web app renders state and sends commands; it never decides an outcome.

### Run the Table (flagship)

`/arena/run-the-table`. A single-player run through five acts. Each act has two
decision stages, each offering a choice between two nodes (a Draft Room, a
Trade Desk, a Scout and Prepare stop, or a Rest and Bank stop), and ends in a
boss battle against a lineup generated for your run. You start with 50
credits and 3 lives, pick up to two run-wide "systems" from three offered,
and build a seven-card roster (five starters, two bench) of exact three-year
peak windows. Battles are decided across published lanes, first to three
lanes by default. Credits pay for market refreshes, reserved cards, role
focus and one emergency recovery per run; boss wins and rest stops pay them
back. A run ends with the table cleared, at the final boss, or in an earlier act
when the last life goes.

- No sign-in required. Runs resume from the start screen in the same browser.
- The board is never stored. It is regenerated from the run's seed on every
  load, and a snapshot from a different ruleset is refused.
- Every action is an idempotent command to the server; the engine decides
  what is legal.
- A daily variant with a shared date-derived seed exists on the server and is
  currently not advertised in the navigation.
- Head-to-head (`/arena/run-the-table/h2h`): an asynchronous run against
  another account on the same seed, joined by an invite token. Requires
  sign-in. Your opponent's state is hidden until both sides have submitted,
  and ties are settled by a fixed, published eight-level tie-breaker.

### 82-0 PEAK Season (CourtBuilder)

`/arena/court/practice/apex_1y`, with `/arena/court/daily/[mode]` for the
shared daily board. A reel rolls a real franchise and a real season, eight
times, once per roster spot. Each roll offers the players who were actually on
that team that year. You pick one and place them on a position-aware court
(five starters by position, three bench). Ratings stay hidden until the
lineup is committed. The result is an experimental full-season projection
with a receipt: projected record, lineup score, per-component fit, positional
findings, and the model's own pick for each round. The simulator is labelled
v0 and uncalibrated wherever it appears.

- No sign-in required to play. Saved runs, personal bests and history
  (`/arena/court/history`) need an account; submitting to the public
  leaderboard (`/arena/court/leaderboard`) also needs a public handle.
- Modes: `apex_1y`, `prime_3y`, `foundation_5y`.
- Behind default-off flags; see [Feature flags and readiness](#feature-flags-and-readiness).

### Three-Man Weave (multiplayer, closed alpha)

Three seats, six rounds. Each round the server rolls one franchise and one
decade, and all three drafters pick from the same eligible pool in snake
order under a global identity lock: a name taken by anyone is gone for
everyone. Rosters are five positions plus one bench slot. The lineup PEAK3
rates highest wins. Bots fill empty seats in practice.

Three-Man Weave is one game with three formats, grouped as a single family in
the Play menu, the hub and the lobby:

- **Classic** (`three_man_weave`): a new franchise and decade every round.
- **Franchise Draft** (`three_man_weave_franchise`): one franchise for all 18
  picks.
- **Decade Draft** (`three_man_weave_decade`): one decade for all 18 picks.

Because 18 picks share one small pool in the two constrained formats, a pick
is legal only if every roster can still be completed. Bot think time is
presentation only and scales with how contested the decision is.

### The $20 Showdown (multiplayer, closed alpha)

Two seats, twenty dollars each, a five-slot roster. One player-season at a
time goes on the block; bids alternate upward in whole dollars, each seat
must always keep a dollar per open slot, and a pass exits the lot, not the
match. Twenty-four standard lots, then a closeout phase that guarantees every
roster fills. The lot's PEAK3 score is hidden until the hammer falls. The
practice bot is calibrated to win roughly 55 to 75 percent of games against a
reasonable proxy opponent.

### PRIME CUT and FIND THE PRIME (multiplayer, off by default)

Two four-seat Arena modes built on multi-year peak windows, where every seat
decides at the same time and other seats show only as locked or deciding.
Each has its own flag, and both are off by default.

- **PRIME CUT** (`/arena/prime-cut/[matchId]`): three heats, at 2-, 3- and
  5-year windows. Each heat deals eight career windows one at a time, with the
  PEAK3 score hidden, and you keep four and cut four with 12 seconds per card.
  A heat scores 100 for keeping PEAK3's best four and 0 for its worst four;
  the match score is the mean of the three heats.
- **FIND THE PRIME** (`/arena/find-the-prime/[matchId]`): nine rounds, one
  career each, three rounds apiece asking for a 2-, 3- or 5-year window. You
  place a window on the career timeline within 20 seconds, and the reveal
  shows PEAK3's highest-rated window and every seat's regret against it. The
  match is scored out of 900.

Bots come in four labelled tiers (Rotation, Starter, All-Star, MVP) and see
only a noisy estimate of the current card or career, never future ones. Rules
are in [`docs/game-design/PRIME_CUT.md`](docs/game-design/PRIME_CUT.md) and
[`docs/game-design/FIND_THE_PRIME.md`](docs/game-design/FIND_THE_PRIME.md);
the design record is
[`ADR-006`](docs/architecture/ADR-006-prime-modes-additive.md).

### Shared Arena foundation

All the multiplayer modes share one Arena foundation. From `/arena/lobby` there
are three entry paths: bot practice (immediate, unrated), a private room by
code (unrated), and the public queue (rated). Sign-in is required for all of
them: a seat in a shared match is a Supabase user. Match pages live at
`/arena/three-man-weave/[matchId]`, `/arena/twenty-dollar/[matchId]`,
`/arena/prime-cut/[matchId]` and `/arena/find-the-prime/[matchId]`. Ratings
and the per-mode leaderboard are separately flagged and off by default.
`GET /api/v1/arena/modes/{mode}/me` returns the caller's own record for a
mode (matches, wins, podiums, streaks, bests).

### Daily Grid

`/daily/grid`. A 3x3 board of constraint pairs, the same for everyone that
day. Fill nine squares with nine different exact player-seasons; picks are
final. Categories (constraint set v5) are basketball-native: teams, awards,
eras, playoff runs, and draft, origin, size and career-journey attributes
drawn from committed player reference data. Boards and saved results from
before the v5 cutover are preserved. The answer key never leaves the server, search results mark
ineligible players rather than hiding them, and the attempt clock starts on
the server exactly once per day. Play is anonymous; saving an official result
and appearing on the daily board need an account. `/daily/history` shows your
streak and archive. Boards roll over at midnight America/Los_Angeles, the
same boundary every daily surface in the app uses.

### Peak Duel

`/play/daily` is ten head-to-head comparisons a day, the same ten for
everyone: pick whose peak the model rates higher, then see the numbers.
`/play/endless` is the same loop without a daily limit or shared seed. Scoring
(`arena_points`) is computed on the server. No sign-in required.

### Ranked and public competition

Two separate systems exist, each behind its own flags:

- **Ranked Peak Draft** (`/arena/ranked`): three queues (1Y Apex, 3Y Prime,
  5Y Foundation), the same hidden board as a matched opponent, Glicko-2
  ratings per queue with a seven-game placement. Part of Legacy Labs; off by
  default.
- **Arena ratings and leaderboards** for Three-Man Weave and The $20
  Showdown: only public-queue matches are rated; practice and private rooms
  never are. Off by default.

Public boards that do exist without either system: the 82-0 leaderboard
(flag-gated) and the Daily Grid daily board.

---

## Exact peaks and player-seasons

The unit of play is the player-season. A window ID such as
`michael-jordan-1yr-199091` names one player, one duration and one anchor
season. Run the Table uses three-year peak windows; the rankings and Peak Draft use
windows of 1, 3 or 5 years (the exporter also builds 2-year boards); Peak
Duel compares peak windows; PRIME CUT and FIND THE PRIME use 2-, 3- and
5-year career windows; 82-0, Three-Man Weave, The $20 Showdown and Daily
Grid resolve single exact seasons from real rosters.

When a real roster player's season falls below the model's minutes threshold,
the card is selectable and marked unscored. In 82-0 it contributes a
conservative provisional impact derived from real games and minutes rather
than a neutral placeholder. A card's provenance (`card_source`) and score
status (`exact_season_scored` or `exact_season_unscored`) are explicit fields,
and a resolved card whose team or season disagrees with the board is an
error, not a substitution.

The shared card pool for the drafting games is *card profiles v3*
(`data/game/profiles/card_profiles.v3.json`), which layers role eligibility
and lineup dimensions onto each peak window using only fields present in the
committed dataset. Roles are lineup archetypes, not NBA roster positions.
The two Prime modes read a separate committed artifact,
`data/game/prime_modes/career_windows.v1.json` (250 players, every legal 2-,
3- and 5-year window), built deterministically by
`scripts/build_prime_windows.py` from `peak3.n_year_windows` and
`calibrate_score`.

---

## The PEAK3 model

Every score comes from one formula with fixed weights (`OFFICIAL_WEIGHTS` in
`peak3.py`):

| Component | Weight | What it measures |
|---|---|---|
| Statistical Impact | 38% | Advanced impact metrics: BPM and its splits, VORP, Win Shares and WS/48, PER |
| Traditional Production | 21% | Era-relative box-score production |
| Individual Recognition | 20% | MVP, Finals MVP, All-NBA, All-Defense, DPOY and statistical titles, overlap-discounted |
| Postseason Value | 18% | Individual playoff performance, reliability-adjusted |
| Team Achievement | 3% | Team results, weighted by the player's creation burden |

A teammate adjustment capped at half an index point is reported as a
descriptive modifier, not a sixth component.

The raw weighted sum is the `prime_index`, an open ordering value. A
monotonic piecewise-linear calibration maps it to the 0-100 `prime_score`
shown in the UI, so calibration can never reorder players. Multi-year windows
rank-weight each season's raw index, sum, and calibrate once; calibrated
scores are never averaged. A window is the best consecutive stretch of
completed seasons.

The 82-0 season projection and the Peak Draft lineup model are separate,
explicitly experimental layers. Neither is the PEAK3 individual score, and
both are labelled as uncalibrated where they appear.

Known open model defects are quantified and tracked rather than hidden: the
per-minute weighting inside Statistical Impact, and postseason scores on very
small playoff samples. See §15 of
[`docs/model/SCORING_METHODOLOGY.md`](docs/model/SCORING_METHODOLOGY.md) and
`tests/test_postseason_sample_invariant.py`.

Rules that do not change without explicit approval and regression evidence:
the weights, `calibrate_score()`, and the committed CSVs in `leaderboards/`.
Scores are never computed in TypeScript, and Basketball Reference is never
scraped during a web request.

---

## Game-feel and server authority

The interaction layer shared by every mode is documented in
[`docs/design/GAME_FEEL.md`](docs/design/GAME_FEEL.md) and implemented in
`apps/web/src/lib/game-feel/` and `apps/web/src/components/game-feel/`.

- **One snapshot per render.** A command's response is applied as one
  object, so a message never paints before the state it describes.
- **Newer wins.** Every view carries a version; an older poll can never
  overwrite a newer command result.
- **Commands are serialized, never dropped.** A duplicate press of an
  exclusive action is refused before any handler runs.
- **Human actions are instant; pacing is deliberate.** A pick or a bid is
  acknowledged immediately. Rolls, reveals, post-pick beats and bot moves
  are timed on the server as part of the presentation, never as a wait on a
  command.
- **The timeline is the server's.** Shared intros and reveals in the
  multiplayer modes are server-timed turns; a skip command is rejected with
  `shared_timeline`, and every seat leaves the intro on the same deadline.
  The Prime modes open in an `arrival` phase so the intro starts only once
  every human seat has it on screen.
  Clocks arrive as durations and are converted to a local monotonic deadline
  on arrival; the timer decides nothing, the server owns timeouts.
- **Bots feel like decisions.** The API publishes when the bot on the open
  turn may move, and bot think time is bucketed by how contested the decision
  is, so the move is computed from the board and only the landing waits.
- **Hidden information stays hidden.** Future rolls do not exist until a
  round opens, auction scores are withheld until a lot resolves, and the
  Daily Grid answer key is never sent.

All "live" surfaces poll; Supabase Realtime is not used.

An optional sound layer (`apps/web/src/lib/arena-audio.ts`, toggled from the
navigation) synthesises a few short cues with the Web Audio API. It is off by
default, uses no audio files, and never carries information that is not
already on screen.

---

## Accounts, handles, progress and boards

Accounts are optional and built on Supabase Auth (email, magic link, and
Google when enabled on the project). Sessions live in cookies via
`@supabase/ssr`; the API on its own origin verifies the bearer JWT, supporting
both asymmetric JWKS keys and the legacy HS256 secret.

Anonymous play is the default path, not a fallback. The API issues a signed,
httponly `peak3_anon` cookie; Run the Table, 82-0, Daily Grid, Peak Duel and
Peak Draft all work under it. Signing in later claims that guest activity
across every domain (runs, results, records, progression) in one call.

With an account you get a public handle and profile (`/profile`, public view
at `/u/[handle]`), progression at `/progress` (XP, levels, streaks, a
fifteen-achievement catalogue and personal records; XP measures exploration,
not skill), Peak Draft match history at `/history`, 82-0 saved runs and the
82-0 leaderboard, official Daily Grid results, ranked play, multiplayer, and
Run the Table head-to-head.

Everything that matters is server-side in Postgres: run and match state,
results, profiles, ratings, progression, the Daily Grid attempt clock.
Browser storage holds only conveniences (theme, tour state, the coach marks,
a resume breadcrumb, per-board Daily Grid progress). Client-side stored
values are never eligible for a ranking.

Public data follows a strict contract: private database rows are never the
public API response, raw auth IDs are never exposed, and every durable table
has row-level security. See
[`docs/public-platform/PUBLIC_DATA_CONTRACT.md`](docs/public-platform/PUBLIC_DATA_CONTRACT.md).

---

## Technical stack

| Layer | Technology |
|---|---|
| Web | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, `motion`; V2 design tokens in `apps/web/src/styles/v2/` |
| API | FastAPI on Python 3.12, Pydantic v2, `asyncpg`, PyJWT with `cryptography` for JWKS |
| Model | Python: pandas, numpy, scipy, pyarrow; the model is not a packaged distribution |
| Database and auth | Supabase (Postgres with RLS, Supabase Auth); 46 SQL migrations in `supabase/migrations/` |
| Hosting | Vercel for `apps/web`, Railway for the API from the root `Dockerfile` |
| Frontend tests | Vitest with Testing Library, Playwright with `@axe-core/playwright`, ESLint, `tsc` |
| Python tests | pytest, with a memory and a Postgres repository implementation for every domain |

CI pins Node 20 and Python 3.12.

---

## Repository layout

```
peak3.py               The model: OFFICIAL_WEIGHTS, component formulas, calibrate_score, CLI
nba_peak/              Model package plus one engine per game mode:
                         perfect_season/ (82-0), run_the_table/, three_man_weave/,
                         twenty_dollar/, prime_cut/, find_the_prime/, prime_modes/,
                         daily_grid/, lineup/ (Peak Draft), nba_facts/
leaderboards/          Committed canonical rankings (CSV); the authoritative ranking source
data/generated/        Committed candidate universe, award votes, season context (parquet)
data/game/profiles/    Committed card profiles v3 (the shared draft pool)
data/game/prime_modes/ Committed career windows for PRIME CUT and FIND THE PRIME
data/reference/        Committed player bio and per-season box data (Daily Grid categories)
data/game/assets/      URL manifests only; no images are committed
data/facts/            Curated half of the NBA fact bank
data/web/              GENERATED API dataset and fact bank (gitignored)
cache/processed/       Scored season parquets; partially committed, needed to rebuild leaderboards
scripts/               Offline exporters, audits, and ci/ (the scripts CI and the Makefile both call)
tests/                 Model and mode-engine tests (pytest)
apps/api/              FastAPI service: routers in app/api/v1, services, repositories, tests
apps/web/              Next.js app: app/ routes, components/, lib/, styles/, src/tests/{unit,e2e}
supabase/              config.toml, migrations/, maintenance snippets
docs/                  Architecture, model, design, game design, implementation, public platform
Dockerfile, railway.toml   API container build and Railway service definition
Makefile               Task entry points; every CI-equivalent target delegates to scripts/ci/
```

---

## Local development

Prerequisites: Python 3.12 and Node 20.

```bash
make install          # pip install for the API, npm install for the web app
make build-game-data  # web dataset + fact bank + card profiles v3 into data/web/ and data/game/
```

`make build-dataset` builds only the dataset and fact bank; `make verify-game-data`
checks that every generated artifact is present. The generated files are
gitignored and must be built after every fresh clone.

Run the two services in separate terminals, API first (the web app expects it
on port 8000):

```bash
make api   # FastAPI with --reload on http://localhost:8000
make web   # Next.js dev server on http://localhost:3000
```

`make api` starts the API with every flag at its default. Out of the box that
means Run the Table, Daily Grid, Peak Duel and the rankings work, while 82-0
PEAK Season, the multiplayer Arena and Ranked are disabled and simply do not
appear in the catalogue. To exercise them locally, export the flags before
starting the API, for example:

```bash
PEAK3_COURTBUILDER_ENABLED=true \
PEAK3_COURTBUILDER_TEAM_SPIN_ENABLED=true \
PEAK3_COURTBUILDER_READINESS_LEVEL=internal_dev \
PEAK3_ARENA_ENABLED=true \
PEAK3_ARENA_BOTS_ENABLED=true \
PEAK3_ARENA_PUBLIC_QUEUE_ENABLED=true \
PEAK3_ARENA_READINESS_LEVEL=closed_alpha \
PEAK3_ARENA_PRIME_CUT_ENABLED=true \
PEAK3_ARENA_FIND_THE_PRIME_ENABLED=true \
make api
```

Environment behaviour:

- The API reads `apps/api/.env` (documented in `apps/api/.env.example`);
  `PEAK3_ENV_FILE` points at another file, and an empty value disables dotenv.
  With `PEAK3_DEBUG=true` (the default) and no `PEAK3_DATABASE_URL`, every
  repository runs in memory and state is lost on restart.
- The web app reads `apps/web/.env.local` (documented in
  `apps/web/.env.example`). `NEXT_PUBLIC_API_URL` defaults to
  `http://localhost:8000` in development. `NEXT_PUBLIC_SUPABASE_URL` and
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` are optional; without them no account
  surface renders and the games play anonymously.
- Multiplayer needs a signed-in user. For local work without a hosted
  Supabase project, `npm run dev:e2e` in `apps/web` sets
  `NEXT_PUBLIC_PEAK3_E2E_AUTH=1`, which renders the account surface against
  the test JWT secret the API accepts in debug mode. That switch folds away
  entirely in a production build.
- `PEAK3_SIGNING_SECRET` has an insecure development default that the API
  refuses to start with when `PEAK3_DEBUG=false`.

More detail: [`docs/implementation/LOCAL_DEV.md`](docs/implementation/LOCAL_DEV.md)
and [`docs/implementation/AUTH_CONFIGURATION.md`](docs/implementation/AUTH_CONFIGURATION.md).

---

## Feature flags and readiness

All flags are read by `apps/api/app/core/config.py` with the `PEAK3_` prefix.
The server is the single source of truth: there are no frontend flags, and
every feature exposes a readiness endpoint that answers even when the feature
is off so the web app can fail closed.

| Family | Defaults | Readiness levels |
|---|---|---|
| `RUN_THE_TABLE_ENABLED`, `RUN_THE_TABLE_DAILY_ENABLED` | **on**, level `public_beta` | `disabled`, `internal_dev`, `internal_alpha`, `public_beta` |
| `COURTBUILDER_ENABLED`, `COURTBUILDER_TEAM_SPIN_ENABLED`, `COURTBUILDER_LEADERBOARD_ENABLED` | off, level `disabled`; `COURTBUILDER_EXPERIMENTAL_TEAM_YEAR_ENABLED` on | `disabled`, `internal_dev`, `internal_alpha`, `public_beta` |
| `ARENA_ENABLED`, `ARENA_BOTS_ENABLED`, `ARENA_PUBLIC_QUEUE_ENABLED`, `ARENA_RATINGS_ENABLED`, `ARENA_LEADERBOARD_ENABLED` | off, level `disabled` | `disabled`, `internal_dev`, `internal_alpha`, `closed_alpha`, `public_beta` |
| `ARENA_PRIME_CUT_ENABLED`, `ARENA_FIND_THE_PRIME_ENABLED` | off; each requires `ARENA_ENABLED` | per-mode switches under the Arena's level; when off the mode is absent from `/arena/readiness` and entry returns 403 `mode_not_enabled` |
| `RANKED_ENABLED`, `RANKED_MATCHMAKING_ENABLED`, `RANKED_RATING_WRITES_ENABLED`, `RANKED_PUBLIC_LEADERBOARD_ENABLED` | off, level `disabled` | `disabled`, `simulation_only`, `internal_alpha`, `closed_alpha`, `public_beta` |
| `ENABLE_EXTERNAL_ASSET_URLS` | off (and off in CI) | serves third-party headshot and logo URLs; a licensing decision |
| `TELEMETRY_ENABLED`, `CONTACT_ENABLED`, `DEV_TOOLS_ENABLED` | off | |
| `DAILY_GRID_RATE_LIMIT_ENABLED` | on | the only rate-limited router |

Startup validators refuse inconsistent combinations, such as a leaderboard
without ratings, a daily without its mode, or any `*_ENABLED` at readiness
level `disabled`. `PEAK3_ARENA_ANONYMOUS_PRACTICE_ENABLED` is a local-only
convenience that the API refuses outside debug mode.

Readiness endpoints: `/health` (liveness), `/health/readiness` (503 until the
dataset and the fact bank are loaded; reports `repository_mode` and
`auth_verification_mode`), `/api/v1/arena/readiness`,
`/api/v1/run-the-table/readiness`, `/api/v1/perfect-season/readiness`,
`/api/v1/ranked/readiness`.

---

## Testing and CI

CI runs exactly the scripts in `scripts/ci/`, and the Makefile wraps the same
scripts, so "green locally" and "green in CI" are claims about the same
commands. Adding a check means editing a script, not the workflow YAML.

| Command | Script | What it runs |
|---|---|---|
| `make test-model` | `scripts/ci/model-tests.sh` | Model and mode-engine pytest suites in `tests/` |
| `make test-lineup` | `scripts/ci/lineup-tests.sh` | Peak Draft lineup tests against card profiles v3 |
| `make test-api` | `scripts/ci/api-unit-tests.sh` | FastAPI suite with `PEAK3_TEST_REPOSITORY_MODE=memory`; Postgres tests deselected, not skipped |
| `make test-api-integration` | `scripts/ci/api-integration-tests.sh` | The same integration suite against a hosted Supabase test project |
| `make test-integration-local` | `scripts/ci/supabase-local-integration.sh` | RLS, migrations and auth flows against a local `supabase start` stack, no secrets |
| `make validate-migrations` | `scripts/ci/migration-validate.sh` | Static migration checks and a drift check on the generated migration inventory |
| `make verify-frontend` | `scripts/ci/frontend-verify.sh` | `tsc`, ESLint at zero warnings, Vitest, and a production build with `PEAK3_BUILD_VERIFY_ONLY=1` |
| `make test-e2e` | `scripts/ci/e2e-tests.sh` | Playwright with axe; starts both services with the flag set the suite needs (including both Prime modes) |
| `make build-game-data` | `scripts/ci/build-web-data.sh` | Generates and validates every data artifact with no network |

Aggregates: `make test` (model, lineup, API, web unit), `make test-fast` (adds
board-generation checks), `make test-full` (adds Playwright). `make
test-accessibility` runs only the axe-tagged Playwright tests.

Playwright is split into four projects that partition the suite:
`chromium-core` (everything not listed below), `chromium-courtbuilder`,
`chromium-multiplayer`, and `mobile-chrome` (Pixel 5, only `@mobile`-tagged
tests). Playwright starts the API and web server itself. Retries come from
`playwright.config.ts`: one retry when `CI` is set, none locally; set
`PLAYWRIGHT_RETRIES=0` for a zero-retry release-gate run.
`scripts/ci/assert-e2e-inventory.sh` checks that the projects still
partition the suite with nothing dropped or counted twice.

Current counts on `main`:

| Suite | Count |
|---|---|
| Python model and engines | 2133 (plus 2 skipped, 1 expected failure) |
| Peak Draft lineup | 43 |
| API unit | 2026 (plus 2 skipped) |
| Frontend unit (Vitest) | 2644 across 139 files |
| Playwright | 297 core, 39 mobile, 99 CourtBuilder, 43 multiplayer |

The GitHub workflow (`.github/workflows/ci.yml`) runs on pushes to `main`,
pull requests into `main`, and manual dispatch. A scope-detection job reads
the changed paths and gates the Python, frontend, Supabase-local and
Playwright jobs; on a pull request the two heavier Playwright projects run
only when their surfaces changed, and the full four-project matrix runs on
every push to `main`. The workflow header records that `main` has no branch
protection, so these checks are advisory rather than enforced. A separate
manual workflow runs the hosted-Supabase ranked release suite.

Model test expectations are fixed. Regression tests verify that the
generated web dataset matches the canonical CSVs (rank 1 per duration, top-10
ordering, sequential ranks, finite contributions, no duplicate IDs).

---

## Deployment

The confirmed topology, the fail-closed matrix and the exact dashboard
settings are in
[`docs/public-platform/DEPLOYMENT_ARCHITECTURE.md`](docs/public-platform/DEPLOYMENT_ARCHITECTURE.md),
[`docs/implementation/STAGING_DEPLOYMENT.md`](docs/implementation/STAGING_DEPLOYMENT.md)
and [`docs/public-platform/FOUNDER_LAUNCH_CHECKLIST.md`](docs/public-platform/FOUNDER_LAUNCH_CHECKLIST.md).

**Vercel hosts `apps/web`.** Root Directory `apps/web`, Next.js preset, no
`vercel.json`. Required environment, for every target that should build:
`NEXT_PUBLIC_API_URL` (the API's public `https://` origin, no trailing
slash), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`NEXT_PUBLIC_SITE_URL`. `assertDeployableEnv()` in `apps/web/next.config.ts`
refuses a production build that is missing `NEXT_PUBLIC_API_URL`, points any
public URL at localhost or `http://`, sets the Supabase URL without its anon
key, ships a service-role key, or has the E2E auth switch set. A Vercel preview
can only call the API once its exact origin is in the API's CORS list.

**Railway hosts the API** from the root `Dockerfile` (`railway.toml`). The
root directory must stay `/`, because the API imports `nba_peak` and reads
`data/` by repository-relative paths. The image generates and validates the
dataset and fact bank at build time and fails the build if either is
missing. Required environment: `PEAK3_DEBUG=false` (this is what arms every
deployment check), `PEAK3_SIGNING_SECRET`, `PEAK3_DATABASE_URL` (the Supabase
session pooler URI), `PEAK3_SUPABASE_URL` (the same project the web app
uses), and `PEAK3_CORS_ORIGINS` as a JSON array of exact origins. With
`PEAK3_DEBUG=false` the API refuses to start on a localhost URL, a wildcard or
empty CORS list, a missing database URL, the default signing secret, no token
verification, or a missing generated dataset.

**Readiness.** Railway's health check is `/health`. The human post-deploy
check is `/health/readiness`, which returns 503 until the dataset and fact
bank are loaded and reports whether repositories are `postgres` or `memory`
and how tokens are verified. The per-feature readiness endpoints tell the web
app what to show.

Vercel and Railway deploy on push through their GitHub integrations and are
not gated on the CI workflow.

---

## Data and the fact bank

- **Source.** Basketball Reference, 1979-80 through 2025-26, scraped and
  cached offline by the CLI (`python peak3.py --rebuild-data`). Never during
  a web request. Inputs, normalisation and gaps are catalogued in
  [`DATA_SOURCES.md`](DATA_SOURCES.md).
- **Authoritative rankings.** `leaderboards/top_250_{1,2,3,5}_year_prime.csv`
  are the canonical output. `scripts/build_web_dataset.py` reads them with no
  network access and aborts on NaN or infinite values, duplicate window IDs,
  or a failed rank-1 regression check.
- **Generated, not committed.** `data/web/` holds the API dataset and the fact
  bank and is gitignored. Rebuilding the leaderboards themselves needs the
  scored parquets in `cache/processed/`.
- **Card profiles v3** are committed under `data/game/profiles/` and rebuilt
  by `make build-card-profiles` from the exported peak windows.
- **Prime career windows** (`data/game/prime_modes/career_windows.v1.json`)
  are committed. The CI data build and the API image both run
  `scripts/build_prime_windows.py --check`, which rebuilds the file and fails
  if it differs by a single byte.
- **Player reference data** (`data/reference/`: listed height and weight,
  birth date and birth country, colleges, draft round and team, career span,
  per-season per-game box lines) feeds
  the Daily Grid's draft, origin, size and journey categories. It is fetched
  offline from Basketball Reference by `scripts/fetch_player_reference_html.py`,
  built by `scripts/build_player_reference_dataset.py`, and committed with a
  manifest of its sources.
- **NBA Fact of the Day.** `nba_peak/nba_facts/` combines curated editorial
  facts in `data/facts/` with facts derived from committed per-season data,
  filters and de-duplicates them, and refuses to publish a bank under 180
  facts. The current bank is `basketball_facts_v3` with 257 facts, 136 of
  them in the featured rotation. `GET /api/v1/nba-facts/today` serves one per
  day, precomputed, with no language model anywhere in the path; the home
  page drops the panel rather than fabricate a fact if the endpoint fails.
- **No images.** `data/game/assets/` holds URL manifests only, joined into
  responses solely when `PEAK3_ENABLE_EXTERNAL_ASSET_URLS` is on. Avatars
  fall back to initials and teams to text.

---

## Accessibility, motion and responsive support

- A skip link is the first element in the document, and every modal, sheet
  and drawer is one shared `Dialog` with a focus trap, Escape to close, scroll
  lock and focus restore.
- Reduced motion is honoured in two layers: a global CSS rule zeroes
  animation and transition durations, and JavaScript-driven sequences
  (reveals, count-ups, timer chains) read the preference and resolve
  immediately. Every animated effect is decoration over state that is also
  carried in attributes and copy. The Run the Table battle reveal always
  offers "Skip to result" and places the full verdict in a polite live region
  at time zero.
- Two real themes, Arena Night and Arena Day, with per-theme contrast tests;
  the toggle works with pointer and keyboard and survives navigation and
  reload.
- Timers are `aria-hidden` and announced only at ten seconds, five seconds
  and expiry.
- Playwright runs axe (WCAG 2 A and AA tags) on the landing, hub, Run the
  Table, rankings, player, methodology, draft, CourtBuilder, multiplayer and
  dialog surfaces and fails on any critical or serious violation. The
  `mobile-chrome` project asserts no horizontal overflow at 390 px, tap-target
  sizes, and drawer focus behaviour.
- The public statement at `/accessibility` is a draft pending legal review.
  It makes no WCAG conformance claim and lists its known gaps, including that
  the Daily Grid board is Tab-order only and that no independent audit has
  been done.

---

## Project status

**Shipped on `main`.** Six modes in the catalogue: Run the Table (flagship),
82-0 PEAK Season, Daily Grid, Peak Duel Daily and Endless, Three-Man Weave
(Classic, Franchise Draft and Decade Draft) and The $20 Showdown, plus the
rankings, player pages, methodology explorer, accounts, public handles,
progression, saved runs, and the Fact of the Day. PRIME CUT and FIND THE
PRIME are merged and tested but off by default. The game-feel reconstruction
(command lane, newer-wins, server-timed shared reveals, decision-shaped bots,
instant acknowledgement with deliberate server-timed pacing), the Daily Grid
v5 category taxonomy, and the public-platform readiness work
(row-level security on every durable table, the public data contract,
concurrency-proven ranked and head-to-head settlement, fail-closed deploy
guards on both sides, build-time data validation) are complete.

**Flag-gated or closed.** 82-0 PEAK Season and the multiplayer Arena are off
by default and are promoted per environment through their readiness levels;
the multiplayer modes are badged closed alpha. PRIME CUT and FIND THE PRIME
each have their own switch on top of the Arena's and are meant to be rolled
out one at a time. Ranked Peak Draft lives in
Legacy Labs. The Run the Table daily is served but not advertised.

**Explicitly experimental.** The 82-0 season simulator (v0, uncalibrated) and
the Peak Draft lineup model.

**Open before a public launch**, from the founder checklist: apply the
pending `20260901*` migrations to the production database (and any later
ones not yet applied, such as `20260914100000_contact_feedback_categories`), set the
production Site URL and redirect URLs in Supabase Auth, enable Google OAuth on
the hosted project (the button reports an unsupported provider until then),
and keep `PEAK3_DEBUG=false` on Railway.

**Model debt, tracked.** The candidate-universe inclusion rule and the
per-minute weighting inside Statistical Impact come before any new mode; see
[`docs/game-design/NEXT_MODE_ROADMAP.md`](docs/game-design/NEXT_MODE_ROADMAP.md).

**Deliberately deferred.** Friends and social feeds, live NBA scores,
licensed player photography, native mobile apps, AI-generated commentary, and
payments.

---

## Development workflow

1. Branch from `main`.
2. Make the change with its tests. Model expectations are never weakened;
   the weights, `calibrate_score()` and the leaderboard CSVs are not touched
   without approval and regression evidence. Visual work must not change API
   contracts, scoring, game rules or state machines (see
   [`docs/design/ROUTE_BEHAVIOR_MATRIX.md`](docs/design/ROUTE_BEHAVIOR_MATRIX.md)).
3. Run the gate that matches the change locally: `make verify-frontend`,
   `make test-api`, `make test-model`, and the relevant Playwright project via
   `scripts/ci/e2e-tests.sh --project=<name> <spec>`.
4. Open a pull request into `main`. CI detects the changed scope and runs the
   matching jobs; Vercel builds a preview of `apps/web`.
5. Merge to `main`. The full Playwright matrix runs on the push, and Vercel
   and Railway deploy from it.

Conventions: game scoring is `arena_points`, never `peak_score`; the model's
display value is `prime_score` and its ordering value `prime_index`. Player
slugs are lowercase, hyphenated, ASCII-folded and apostrophe-free. Secrets
live in environment variables and `.env` files are never committed.
[`CLAUDE.md`](CLAUDE.md) holds the working reference in its authoritative
form.

---

## Further documentation

| Directory or file | Contents |
|---|---|
| [`docs/model/`](docs/model/) | `SCORING_METHODOLOGY.md` (component reference, CLI, limitations), formula design and calibration audits, card profile provenance, lineup model notes, `DAILY_GRID_TAXONOMY.md` |
| [`METHODOLOGY.md`](METHODOLOGY.md) | The deepest per-metric derivation of the model |
| [`DATA_SOURCES.md`](DATA_SOURCES.md) | Every external input, normalisation, coverage and fallback |
| [`docs/game-design/`](docs/game-design/) | Daily Grid, Peak Duel, Peak Draft, PRIME CUT and FIND THE PRIME rules; the next-mode roadmap |
| [`docs/design/`](docs/design/) | Design system, `GAME_FEEL.md`, broadcast immersion plan, visual rubric, route behaviour matrix |
| [`docs/architecture/`](docs/architecture/) | ADRs 001 to 006 (board snapshots, durable identity, progression, ranked, the 82-0 pivot, the additive Prime modes) and the web architecture |
| [`docs/public-platform/`](docs/public-platform/) | Deployment architecture, founder and production checklists, public data contract, schema matrix, competitive state machine |
| [`docs/implementation/`](docs/implementation/) | Local dev and auth configuration, staging deployment, CI data contract, telemetry, and the phase and feature reports with their review evidence |
| [`docs/product/`](docs/product/) | The product blueprint and index, master plan, Arena overhaul spec |
| [`docs/security/`](docs/security/) | Peak Draft state threat model |
| [`apps/api/.env.example`](apps/api/.env.example), [`apps/web/.env.example`](apps/web/.env.example) | Every environment variable, with the reasoning behind each |
