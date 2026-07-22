# Phase 5 Data Model — Identity, Team-Season, Peak-Card, and Attribute Schema

**Status:** Design only. No migrations exist yet for the entities below; this
document is Phase 5B's schema proposal, produced per
`docs/architecture/ADR-005-arena-pivot-and-courtbuilder.md` Decision 5 and
`docs/product/PEAK3_NEXT_AMBITIOUS_STEPS.md` §10 (Phase 5B row).
**Scope:** Proposes entities. Does **not** write SQL, does **not** touch
`supabase/migrations/`, does **not** touch hosted Supabase.
**Grounded in:** `docs/product/PEAK3_GAME_PLATFORM_MASTER_PLAN.md` §5
(shared game engines), §11 (player universe expansion), §16.3–16.4 (version
tables and suggested database domains).

---

## 0. Why this document exists, and the gap it starts from

The master plan's suggested database domains (§16.4: `players`,
`player_aliases`, `teams`, `franchises`, `seasons`, `player_team_seasons`,
`peak_cards`, `attribute_vectors`, ...) are a good north star, but they
assume team/roster data already exists somewhere in the pipeline to migrate
from. It doesn't. Verified this session:

| Existing file | Columns / fields | Team data present? |
|---|---|---|
| `data/generated/player_season_context.parquet` | 47 columns (awards, playoff context, teammate strength, MVP/DPOY votes, etc.) | No team name/ID field |
| `data/generated/team_shares.csv` | `team_scoring_share`, `team_assist_share`, `n_teams` | Share/count only, no team identity |
| `leaderboards/*.csv` | Rank, Player, Best season, component contributions | No team column |
| `data/web/peak_windows.json` | `player_id`, `duration_years`, `anchor_season`, `prime_score`, component breakdown | No team field |
| `data/game/profiles/card_profiles.v3.json` | `eligible_roles`, `primary_role`, `role_traces` | Lineup-archetype roles (`lead_creator`, `guard_wing`, ...), **not** NBA team-roster membership |

**Consequence:** `team_identity`, `team_season`, and
`team_season_roster_member` below are genuinely greenfield — there is no
existing committed dataset to backfill them from. Populating them requires a
new data-acquisition step (most likely Basketball-Reference team-season
roster pages, following the same `nba_peak/data_complete.py`-style
scrape-once/cache/never-scrape-at-request-time pattern already used for
award votes and team shares) that is out of scope for this schema-design
pass and must be scoped explicitly before Phase 5B migrations are written.

---

## 1. `player_identity`

**Purpose:** The real person, independent of any season, team, or scored
window. The stable anchor every other entity here points back to.

**Key fields:**
- `player_identity_id` (immutable, UUID or stable slug-derived key — see
  open question below)
- `player_slug` (existing convention: lowercase, hyphens, no apostrophes,
  ASCII-folded — e.g. `michael-jordan`, per `CLAUDE.md`)
- `canonical_name`, `display_name`
- `aliases` (array of normalized search strings)
- `birth_date`, `physical_profile` (nullable — only where licensed/reliable,
  per master plan §5.1)
- `active_status` (`active` / `retired` / `unknown`)
- `source_provenance` (which upstream source(s) established this identity)
- `data_coverage_flags` (which downstream systems — Index, Arena
  Competitive Core, Extended Archive, Labs — this identity currently has
  sufficient data for; master plan §11.6 pool tiers)

**Source of truth:** Net-new table. `player_id`/`player_slug` values in the
existing `data/web/peak_windows.json` and `leaderboards/*.csv` become the
seed set — this table does not replace those files, it becomes the identity
layer they currently lack.

**Versioning/audit requirements:** Append-only history of alias/name
changes (a player's canonical name can change post-launch — corrections
happen). Referenced by `player_universe_versions` (master plan §16.3) so a
future pool expansion (500 → 1,000 → 2,000, master plan §11.2) is a
versioned release, not a silent mutation of who's eligible in an already-
published board.

**Open questions:**
- Should `player_identity_id` be a new UUID, or should the existing
  `player_slug` remain the primary key to avoid a join-key migration across
  `data/web/`, `leaderboards/`, and `data/game/profiles/`? Slug-as-PK is
  simpler short-term but historically riskier if a slug ever needs to
  change (e.g. a name correction that changes the ASCII-folded form).
- Where does `active_status` get refreshed from, and on what cadence, given
  the "never scrape at request time" rule?

---

## 2. `team_identity`

**Purpose:** A franchise across its history — the stable entity behind
relocations and renames (e.g. Seattle SuperSonics → Oklahoma City Thunder is
one `team_identity`, or two, depending on the ruleset decision below).

**Key fields:**
- `team_identity_id`
- `franchise_slug` (new naming convention needed — none exists yet)
- `canonical_name`, `city_history` (array of `{city, name, seasons}` spans)
- `active_status`
- `source_provenance`

**Source of truth:** Net-new — no existing file has any team data (§0
table). Must be authored/imported fresh.

**Versioning/audit requirements:** `team_membership_versions` (master plan
§16.3). Relocation/rename handling must be decided once and versioned, not
re-litigated per query (see open question).

**Open questions:**
- **Relocation ruleset:** does a relocated/renamed franchise count as one
  `team_identity` (continuous) for "Bulls + 2010s" style prompts, or does a
  rename create a new identity? Master plan §5.2 implies continuity
  ("Chicago Bulls in the 2010s") but doesn't resolve relocation explicitly.
  This must be an explicit, versioned ruleset choice (mirrors ADR-004 §15's
  "ruleset pinned at creation, never re-resolved" pattern), not an ad hoc
  per-team judgment call.
- Expansion teams, defunct pre-merger ABA/BAA franchises — in scope for
  Competitive Core, or Extended Archive/Labs only (§11.6 pool tiers)?

---

## 3. `team_season`

**Purpose:** One franchise's single season — the resolution target for
exact team-season prompts (master plan §6.5 "Exact team-season" spin type,
e.g. "2010-11 Atlanta Hawks").

**Key fields:**
- `team_season_id`
- `team_identity_id` (FK)
- `season` (canonical format matching existing `anchor_season` convention,
  e.g. `"2010-11"`)
- `record` (wins/losses, if used for flavor/context — not authoritative
  simulation input)
- `playoff_result` (nullable — round reached, if any)
- `roster_size`, `data_completeness_status` (mirrors the existing
  `data_status` field already present on `peak_windows.json` entries)
- `source_provenance`

**Source of truth:** Net-new, depends on `team_identity` existing first.

**Versioning/audit requirements:** Immutable once published in any official
board (same "board snapshot, not live regeneration" principle as ADR-001).
A correction to a `team_season` record after boards have referenced it
requires a new version, not an in-place edit — otherwise a previously-issued
"2010-11 Atlanta Hawks" board could silently change its eligible-player set.

**Open questions:**
- Does this table need a `playoff_team_season_id` distinct from the
  regular-season entity for players who were traded mid-season (master plan
  §11.5's "postseason team" field)? Leaning yes — see
  `team_season_roster_member` below.

---

## 4. `team_season_roster_member`

**Purpose:** The join entity answering "which players were on this
team-season, and how" — the single most load-bearing new table, since every
82-0 spin's eligibility check (master plan §5.2) depends on it existing and
being complete.

**Key fields:** (directly enumerated in master plan §11.5)
- `roster_member_id`
- `player_identity_id` (FK)
- `team_season_id` (FK)
- `games_played`, `minutes_played`
- `role` (`starter` / `rotation` / `bench` / `cameo`)
- `traded_season_attribution` (`primary_team` / `secondary_team` / `both`
  under a given ruleset — see open question)
- `postseason_team_flag` (did this stint carry into that team's playoff run)
- `eligibility_flags` (per-ruleset — e.g. "meets team-decade minimum
  appearance threshold under `card_ruleset.v1`," master plan §5.2)
- `source_provenance`

**Source of truth:** Net-new; depends on `team_season` and `player_identity`
existing. This is the table that requires genuine data acquisition (§0) —
it cannot be derived from anything currently committed to the repo.

**Versioning/audit requirements:** Same immutability principle as
`team_season` — a roster-membership correction after a board has referenced
it needs a new version, referenced by `team_membership_versions`.

**Open questions:**
- **Minimum-appearance threshold:** master plan §5.2 says "a team-decade
  pick requires a meaningful appearance threshold, not a one-game cameo,"
  but doesn't set the number. This needs an explicit, versioned constant
  (e.g. `min_games_for_team_decade_eligibility`), not a magic number buried
  in eligibility-engine code.
- **Multi-team season attribution:** for a traded player, is he eligible for
  both teams under the default ruleset, or does `traded_season_attribution`
  gate that per-ruleset (master plan §5.2: "multi-team seasons require
  explicit team attribution and minutes/games rules")? This directly
  affects whether a Bulls+2010s spin including a player traded away
  mid-season is "correct" or a board-generation bug.

---

## 5. `peak_card`

**Purpose:** An exact, versioned, scored player window — the entity that
already exists informally as one row of `data/web/peak_windows.json` /
`data/game/profiles/card_profiles.v3.json`, formalized and separated from
team context (ADR-005 Decision 5).

**Key fields:**
- `peak_card_id` (existing window-ID convention:
  `{player_slug}-{n}yr-{anchor_nodash}`, per `CLAUDE.md` — reused, not
  replaced)
- `player_identity_id` (FK)
- `duration_years` (1 / 3 / 5, matching `SUPPORTED_MODES` in
  `nba_peak/lineup/config.py`; playoff-run cards are a documented future
  addition per master plan §11.2, not in the current model)
- `start_season`, `end_season`, `anchor_season`
- `prime_score`, `prime_index`, `components` (statistical_impact,
  traditional_production, individual_recognition,
  postseason_individual_value, team_achievement, teammate_adjustment — the
  existing, unchanged component breakdown)
- `data_status` (existing field, reused verbatim)
- `card_ruleset_version`, `model_version` (which `peak_card_ruleset_versions`
  / `model_versions` entry produced this card — master plan §16.3)

**Source of truth:** `leaderboards/*.csv` remains authoritative for the
underlying score (`CLAUDE.md`: "never change these without explicit
approval"); `peak_card` is a structured, identity-linked, versioned
representation of that same data, not a second scoring pipeline. Built by
`scripts/build_web_dataset.py`-equivalent tooling, extended to also emit
this shape, not by a new independent scorer.

**Versioning/audit requirements:** Immutable per master plan §5.3 ("the
selected card must remain immutable in the official result even after newer
model versions launch") — an official 82-0 result references a specific
`peak_card` version forever, even if `model_version` later increments.

**Open questions:**
- Does `peak_card_id` need to be independently versioned from the
  underlying score (i.e., can `prime_score` change for the same
  `{player, duration, anchor_season}` between model releases while
  `peak_card_id` stays stable, with the *previous* score preserved under a
  superseded version), or does any score recompute mint a new
  `peak_card_id`? This determines how "old receipts never silently mutate"
  (bridge doc §8) is actually implemented at the row level.

---

## 6. `peak_card_team_affiliation`

**Purpose:** The link between a `peak_card` and the `team_season`(s) it can
be legitimately presented under — the entity that makes "Bulls + 2010s +
Derrick Rose → 2010-11 Derrick Rose" resolvable (master plan §5.3 worked
example).

**Key fields:**
- `affiliation_id`
- `peak_card_id` (FK)
- `team_season_id` (FK)
- `affiliation_type` (`primary` — the team this window's stats/score are
  attributed to — vs. `contextual` — e.g. a multi-team season represented
  under a secondary team for eligibility purposes only, per ruleset)
- `eligibility_ruleset_version`

**Source of truth:** Derived from `peak_card` + `team_season_roster_member`
+ a resolution ruleset — not independently authored. This is the table the
eligibility engine (master plan §5.2) actually queries at spin-resolution
time.

**Versioning/audit requirements:** Recomputed whenever
`team_season_roster_member` data is corrected or `player_universe_versions`
advances; each recomputation is a new version, old boards keep referencing
the affiliation snapshot valid at their creation time (same pattern as
`peak_card` immutability, one layer up).

**Open questions:**
- For a multi-year `peak_card` (3Y/5Y) that spans a trade, which
  `team_season`(s) does it affiliate with — the team at `anchor_season`
  only, or every team touched during the window? This has real gameplay
  consequences (does a 3-year Kevin Garnett window count for both
  Minnesota and Boston spins?) and needs an explicit ruleset decision before
  Phase 5C, not an implicit one baked into whichever code path ships first.

---

## 7. `player_attribute_profile`

**Purpose:** The Forge/lineup-fit attribute vector (master plan §5.4, §10)
— explicitly a separate, experimental model from the canonical PEAK3 score,
per ADR-005 Decision 4.

**Key fields:**
- `attribute_profile_id`
- `peak_card_id` (FK — attributes are computed per scored window, not per
  raw player, since they're era/role-normalized against that specific
  window's context)
- `attribute_model_version`
- `attributes` (map of attribute name → `{score_0_100, percentile,
  confidence_0_1, coverage_tier}`, per master plan §10.7 — launch set of
  10–12 per bridge doc §5, full 23-attribute taxonomy in master plan §10.3
  for later internal use)
- `role_archetype_grades` (position-template-specific composite scores,
  master plan §7.5)

**Source of truth:** Net-new derivation pipeline, out of scope to build in
Phase 5B/5C (Phase 5E per the roadmap). This entity is defined now so
`court_lineup_slot`/`lineup_score_snapshot` below have a stable shape to
reference later without a breaking schema change, but **no attribute values
are computed or populated in Phase 5B/5C** — CourtBuilder's vertical slice
(Phase 5C) does not depend on this table being populated.

**Versioning/audit requirements:** Never treated as a decomposition of
`peak_card.prime_score` (ADR-005 Decision 4, bridge doc §5's "trust
requirement, non-negotiable"). Fully versioned per `attribute_model_versions`
(master plan §16.3); coverage tier (A–D, master plan §10.7) always visible
alongside any displayed value.

**Open questions:** Deferred to Phase 5E per the roadmap
(`PEAK3_NEXT_AMBITIOUS_STEPS.md` §10) — not blocking for this phase.

---

## 8. `court_lineup`

**Purpose:** One user's constructed roster within a single 82-0 attempt (or
future Duel/Draft Night roster) — the CourtBuilder analog of the existing
`DraftGameState` (`nba_peak/lineup/schemas.py`), but for the court-based
mode rather than the three-offer draft.

**Key fields:**
- `court_lineup_id`
- `owner_sub` (server-resolved only, never client-trusted — reusing the
  exact pattern Phase 4.0A established for `DraftGameState.owner_sub` after
  the `_clone()` bug fix documented in `PHASE_4_0A_REPORT.md` §4/H item 3)
- `game_attempt_id` (FK to `perfect_season_attempt`, below)
- `status` (state-machine value — see master plan §16.6's proposed 82-0
  state machine: `created → prompt_active → selection_locked →
  placement_active → rounds_complete → simulating → result_ready →
  claimed/shared`)
- `card_pool_version`, `eligibility_ruleset_version` (pinned at creation,
  never re-resolved — ADR-001/ADR-004 §15 pattern)

**Source of truth:** Net-new, owned by the Phase 5C API domain
(`apps/api/app/domains/modes/perfect_season/` per master plan §16.2's
suggested structure).

**Versioning/audit requirements:** Same durability requirements Phase 4.0A
established for `DraftGameState` — must survive process restart (the
restart-durability smoke test in `PHASE_4_0A_REPORT.md` §6 is the bar to
match), must not silently drop `owner_sub` on any state-transition action.

**Open questions:**
- Does `court_lineup` reuse `DraftGameState`'s repository infrastructure
  (`GameRepoDep` etc.) with a new discriminator, or get its own repository
  protocol? **Partially resolved:** the underlying `games` table
  (`supabase/migrations/20260630124700_game_records.sql`) stores state as a
  generic `payload JSONB NOT NULL` column keyed by `mode`/`board_type`
  discriminator columns, with no Peak-Draft-specific `NOT NULL` columns at
  the `games`-table level — so a new `board_type = "perfect_season"` value
  with a new payload shape fits without any migration, honoring this
  phase's "no new migrations yet" constraint. What's still open is whether
  that reuse happens through the *existing* `GameRepository` protocol
  (simplest, but couples an unrelated protocol's method signatures to a
  different game grammar) or a new, narrower protocol backed by the same
  table (cleaner, more code). See `docs/implementation/PHASE_5_COURTBUILDER_VERTICAL_SLICE.md`
  for the chosen approach. Note this does **not** extend to completion
  tracking — see entity 12's note on `result_snapshots`/`daily_completions`
  carrying Peak-Draft-specific `NOT NULL` columns that do not fit this
  reuse-without-migration approach.

---

## 9. `court_lineup_slot`

**Purpose:** One roster position within a `court_lineup` — five starters +
three bench (master plan §5.5, §6.2), with **soft** position assignment
(a player can be placed anywhere; the model evaluates consequences rather
than blocking placement).

**Key fields:**
- `slot_id`
- `court_lineup_id` (FK)
- `slot_type` (`starter_1`..`starter_5`, `bench_1`..`bench_3` — positional
  labels, not eligibility locks)
- `peak_card_id` (FK, nullable until filled)
- `resolved_via` (which spin/search/eligibility resolution produced this
  card — audit trail back to `peak_card_team_affiliation`)
- `placement_order` (round number the slot was filled in)
- `comfort_indicators` (computed, display-only — "coach notes," never a
  hard validity flag, per master plan §5.5)

**Source of truth:** Net-new, written by the CourtBuilder API as the user
plays each round.

**Versioning/audit requirements:** Once `court_lineup.status` reaches
`rounds_complete`, slots become immutable (feed into `lineup_score_snapshot`
below) — matches the general "official result state is frozen at
completion" principle already used for `ResultSnapshot` (ADR-002 §4).

**Open questions:**
- Should `comfort_indicators` be computed and stored at placement time, or
  computed live from `peak_card_id` + `slot_type` on every read? Storing at
  placement time is simpler to keep consistent with the eventual
  `lineup_score_snapshot`, but live computation avoids a second place
  lineup-fit logic can drift from the simulator's own version.

---

## 10. `lineup_score_snapshot`

**Purpose:** The frozen, versioned lineup-fit and simulation output for a
completed `court_lineup` — the experimental layer (ADR-005 Decision 4) that
sits explicitly apart from `peak_card.prime_score`.

**Key fields:**
- `snapshot_id`
- `court_lineup_id` (FK, one-to-one once complete)
- `lineup_model_version`, `simulator_version` (both required — master plan
  §5.6/§5.7 keep fit and simulation as related but distinct concerns)
- `fit_components` (map of dimension → score, e.g. primary_creation,
  rim_pressure, point_of_attack_defense — master plan §5.6's 16-dimension
  list; components, not one opaque number)
- `simulation_result` (official seeded record, e.g. `82-0`/`81-1`;
  `expected_wins`, `expected_wins_range` — both shown, per master plan
  §6.7/§12.5, never only the seeded record)
- `decisive_factors` (top strengths/weaknesses driving the result — feeds
  the receipt, master plan §5.10)
- `board_seed`, `ruleset_hash` (reproducibility — bridge doc §8's required
  version-stamp set)

**Source of truth:** Net-new; computed once at `court_lineup` completion by
the Phase 5C simulation domain, never recomputed in place afterward (a
`simulator_version` bump produces a new snapshot for a *new* attempt, never
mutates a historical one).

**Versioning/audit requirements:** This is the entity the "official results
must be versioned and reproducible" requirement (bridge doc §8, master plan
§16.3) most directly applies to — every field needed to replay the result
from scratch (seed, ruleset, model versions) must be present here, not
reconstructed after the fact from mutable state elsewhere.

**Open questions:**
- Is `82-0` frequency calibration (master plan §6.7, §12.8 — "must be tuned
  deliberately... possible, memorable, and rare enough to remain an
  achievement") a property of `simulator_version`'s parameters, or a
  separate `season_sim_calibration_version`? Affects whether recalibrating
  perfect-season rarity requires a full simulator version bump or a lighter
  parameter-only version.

---

## 11. `perfect_season_board`

**Purpose:** The published, deterministic prompt sequence for one 82-0
attempt — the team+decade/exact-team-season spins for all eight rounds,
generated once and referenced by every attempt against it (daily or
practice), following the existing `board_snapshots` philosophy already
established for Peak Draft boards (ADR-001).

**Key fields:**
- `board_id`
- `board_type` (`practice` / `daily` / future `ranked`)
- `seed` (server-generated for practice; deterministic from `(date, mode)`
  for daily, per the existing Peak Draft daily-board pattern)
- `spin_sequence` (ordered list of `{spin_type: team_decade|exact_team_season,
  team_identity_id, decade_or_season}` for all 8 rounds)
- `card_pool_version`, `eligibility_ruleset_version`, `board_generator_version`
- `active_window` (for `daily` type — publication/settlement time, matching
  the existing daily-board settlement pattern)
- `publication_audit` (master plan §5.8)

**Source of truth:** Net-new, generated by a Phase 5C-equivalent of
`nba_peak/lineup/board.py::generate_board()`, extended for the 82-0 spin
shape rather than Peak Draft's offer-round shape. Reuses the deterministic
generation principle, not the exact function signature (different game
grammar).

**Versioning/audit requirements:** Immutable once published — identical
principle to `ranked_matches.board_snapshot` (ADR-004 §3): the stored
snapshot, never live regeneration, is authoritative for every attempt
against it, so a later card-pool or eligibility-ruleset default change can
never retroactively alter an already-published board.

**Open questions:**
- Does `perfect_season_board` reuse `nba_peak/lineup/board.py`'s existing
  seed-derivation machinery (`_derive_board_seed()`), extended with a new
  branch, the same way ranked did (ADR-004 §3)? Strongly preferred for
  consistency, but the spin-sequence shape (team+decade prompts, not
  offer-card rounds) is different enough that this needs actual design work
  in Phase 5C, not just a reference here.

---

## 12. `perfect_season_attempt`

**Purpose:** One user's attempt against a `perfect_season_board` — the
top-level record tying a user, a board, and a resulting `court_lineup`
together, and the entity `history`/progression/leaderboards actually query.

**Key fields:**
- `attempt_id`
- `owner_sub`
- `board_id` (FK to `perfect_season_board`)
- `court_lineup_id` (FK, one-to-one)
- `attempt_kind` (`official` / `practice` — mirrors the existing
  Daily-board official/practice split already implemented for Peak Draft)
- `status` (mirrors `court_lineup.status` at a coarser grain for
  history/leaderboard queries)
- `completed_at`
- `result_snapshot_id` (FK — reuses the existing `ResultSnapshot`
  entity/table from ADR-002 rather than inventing a parallel one, per the
  "one durable path" lesson from `REPOSITORY_WIRING_AUDIT.md`'s root-cause
  findings)

**Source of truth:** Net-new top-level record; deliberately designed to
reuse `ResultSnapshotRepository`/`DailyCompletionRepository` (both already
fully durable per `REPOSITORY_WIRING_AUDIT.md`'s post-4.0A state) for
history/daily-completion writes, rather than introducing a second
history-shaped table the way `app/services/draft/store.py` once duplicated
`GameRepository` — the exact mistake Phase 4.0A's report (§4/F) fixed once
already and this document explicitly does not want to reintroduce.

**Versioning/audit requirements:** Write-once on completion (same
`WHERE ... IS NULL` guard pattern `MemoryChallengeRepository.save_settlement`
uses, per `PHASE_4_0A_REPORT.md` §4/G). One official attempt per user per
daily board, enforced server-side (bridge doc §12's explicit non-goal list:
"daily first-attempt rules enforced server-side").

**Open questions:**
- Should `perfect_season_attempt` literally reuse the existing
  `daily_completions` table (adding a `mode_family` discriminator column)
  or get its own table with a shared repository *interface*? **Confirmed
  blocker for reuse-as-is:** both `daily_completions` and `result_snapshots`
  (`supabase/migrations/20260630124700_game_records.sql`) declare
  `lineup_peak_rating NUMERIC(8,4) NOT NULL`, and `daily_completions` also
  declares `hold_used`/`reframe_used BOOLEAN NOT NULL` — all three are
  Peak-Draft-specific and meaningless for CourtBuilder, so writing into
  these tables unmodified would require fabricating placeholder values to
  satisfy `NOT NULL`, which is explicitly disallowed. Reusing them for real
  needs an actual migration (new nullable/mode-specific columns), which is
  out of scope for this phase. **Resulting scope decision** (see
  `PHASE_5_COURTBUILDER_VERTICAL_SLICE.md`): Phase 5C's vertical slice does
  not write to `result_snapshots`/`daily_completions`/history at all —
  `court_lineup` completion is tracked only via the `games` table (entity
  8's resolution). Durable history/leaderboard integration is deferred to
  Phase 5D, which already owns "Daily 82 and result sharing" in the roadmap
  and is the right place to design the actual schema change.

---

## 13. Cross-cutting open questions

These don't belong to one entity but block moving from this design doc to
actual migrations:

1. **Team relocation/rename ruleset** (entity 2) needs an explicit decision
   before `team_identity` can be populated at all.
2. **Minimum-appearance threshold for team-decade eligibility** (entity 4)
   needs a documented constant, not an implicit code default.
3. **Multi-team/traded-season attribution** (entities 4, 6) needs an
   explicit ruleset — this affects correctness of every team-decade and
   exact-team-season prompt.
4. **Data acquisition plan for `team_identity`/`team_season`/
   `team_season_roster_member`** (§0) — genuinely unscoped by this document;
   needs its own short design pass (source, scrape-once/cache pattern,
   provenance) before Phase 5B migrations can be written for those three
   entities specifically. The other nine entities do not have this blocker.
5. **Primary-key strategy** (`player_identity_id` as new UUID vs. reused
   `player_slug`) affects every downstream FK in this document and should be
   settled once, explicitly, rather than defaulting silently per-table.

None of these block Phase 5C's CourtBuilder *prototype* (see
`docs/implementation/PHASE_5_COURTBUILDER_VERTICAL_SLICE.md`'s non-goals —
the vertical slice explicitly does not depend on `team_season_roster_member`
being populated), but all five block writing real Phase 5B migrations.
