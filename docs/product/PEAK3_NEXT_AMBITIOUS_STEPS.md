# PEAK3 Next Ambitious Steps

**Relationship to the existing master plan:** a complete 3,210-line, version-2.0
game-platform master plan already exists at the repo root:
[`PEAK3_GAME_PLATFORM_MASTER_PLAN.md`](../../PEAK3_GAME_PLATFORM_MASTER_PLAN.md)
(currently untracked — see `docs/implementation/CURRENT_PROJECT_STATE.md` §7 for
a path/asset discrepancy that should be resolved before it's committed). That
plan already covers, in far more depth than this document repeats: competitive
research (§3), full product architecture and shared engines (§4–5), mode
specs for 82-0, Forge, Draft Duel, and every multiplayer format (§6–9), the
attribute model methodology (§10), player-universe expansion (§11), simulation
design (§12), UX/visual direction (§13), progression/social systems (§14),
ranked/matchmaking (§15), technical architecture (§16), analytics (§17), a
9-phase roadmap (§18), and an AI operating contract (§23). **Read that
document for the "what" and "why."** This document is the practical bridge:
what to do *next*, concretely, given exactly where this repository stands
today (`phase4-ranked-alpha` @ `9905bcc`, CI green, Phase 4.0A complete).

Do not treat this file as a replacement for the master plan. Where they
overlap, the master plan is authoritative on product design; this file is
authoritative on immediate sequencing against the current repo state.

---

## 1. Current reality

The current game — a three-card, five-role Peak Draft — technically works.
Phase 4.0A closed every known durability gap in the repository layer, and CI
is green across model tests, API tests, frontend, Playwright, and (at least
in "not configured, expected" form) the Supabase integration gate. But the
loop is not compelling enough to remain the long-term flagship: it reveals a
rating/rank before the user chooses, the optimal action collapses to "click
the largest visible number that fits," hard role slots create dead ends, there
is no visible opponent or season narrative, and a tested flow produced a
result-loading failure after draft completion (documented in the master
plan's §2.1 and its Appendix B screenshot manifest, once that manifest is
populated). Unless substantially transformed, the current draft loop should
become a **legacy / prototype / internal-validation / Labs** surface — not
deleted, since its underlying infrastructure (deterministic boards, exact
peak cards, challenge links, durable identity/history/progression, ranked
queue and Glicko-2, Supabase/Postgres schema and RLS, CI and Playwright
harnesses) is exactly what the next phase builds on.

## 2. Product north star

> PEAK3 should become a basketball strategy arcade and research platform
> where users build, simulate, compare, and compete with mathematically
> quantified historical NBA peaks.

## 3. Core product pillars

- **PEAK3 Index** — the public statistical reference: rankings, player pages,
  team-season pages, comparisons, model versions, public data exports.
- **PEAK3 Arena** — the game platform: 82-0, Daily 82, Forge, Draft Duel,
  Draft Night, Threepeat, War Room, Peak Hunt/Grid, history, trophies,
  ranked ladders, and events.
- **PEAK3 Lab** — the trust and experimentation surface: formula explorer,
  attribute model explorer, lineup/simulation methodology, data
  coverage/confidence, downloads/API, changelog, and clearly-labeled
  experimental modes.
- **PEAK3 Locker Room / profile identity** — the persistent basketball
  identity layer: perfect seasons, ranked divisions, Threepeat banners,
  Draft Night championships, Daily streaks, Forge best builds, saved
  rosters, and shareable result cards — foregrounding basketball
  accomplishments over generic XP.
- **PEAK3 Data Platform** — the player-identity, team-season-membership,
  peak-card, and attribute-vector layer that every mode above is an
  expression of, versioned and reproducible end to end.

## 4. Flagship mode: 82-0 Peak Season

> Spin a team and era, choose one eligible player at his best PEAK3 season,
> place him on your court, and build a roster that can go 82-0.

Core mechanics (full spec: master plan §6):

- **Spins:** team + decade (e.g. Bulls + 2010s) and exact team-season (e.g.
  2010-11 Atlanta Hawks); a decade spin resolves to the player's best
  eligible season/window on that team within the decade — e.g. Chicago
  Bulls + 2010s + Derrick Rose resolves to **2010-11 Derrick Rose**, not a
  career-average abstraction.
- **Roster:** five starters + three bench slots (eight rounds), soft
  position assignments (LeBron can be placed at center; the model evaluates
  the consequences rather than blocking the placement).
- **Hidden scores during selection:** exact PEAK3 total and all-time rank
  stay hidden until after the player is chosen and placed, so the game
  rewards basketball judgment, not "click the biggest number."
- **Lineup fit and chemistry:** offensive role coverage, size/mobility,
  shooting/spacing, creation hierarchy, defensive matchups, rebounding, rim
  protection, turnover risk, usage overlap, bench continuity, durability —
  shown as components and counterfactuals, never one opaque "chemistry"
  number.
- **Season simulation:** seeded 82-game season producing an official
  record, an expected-wins uncertainty band, offense/defense percentiles,
  strongest lineup combination, weakest matchup type, and (for near-misses)
  the exact game and reason for the one loss.
- **Daily 82:** shared spins/seed/modifier for every player that day, one
  official attempt, practice replays, global/friends/rookie leaderboards.
- **Shareable result card:** record, court/bench visualization, one
  decisive strength, one weakness or perfect-season badge, and a playable
  challenge link to the same board — never a spoiler list of optimal picks.
- **Transparent receipt:** every result cites its model version, board seed,
  ruleset, and ties back to why the roster won or lost.

## 5. PEAK3 Forge: build the perfect player

> Build the perfect historical player by drafting different skills from
> eligible NBA players, then see how close you came to the best possible
> build from the same spins.

- **Format:** launch with Slot-first Forge (the game reveals an attribute
  like Interior Defense, spins a team+decade or exact team-season, the user
  picks an eligible player, that player's resolved season fills the
  attribute); add Open-assignment Forge (draw a player first, then choose
  which remaining attribute slot to fill) once the attribute language is
  established.
- **Starter attribute set (10–12 at launch, full taxonomy in master plan
  §10.3 has 23 for later internal use):** shooting, free-throw shooting,
  finishing/rim pressure, handle, playmaking/passing, basketball IQ /
  decision-making proxy, offensive rebounding, defensive rebounding,
  perimeter defense, help defense, interior/rim protection,
  switchability, athleticism, speed/quickness, strength/physicality,
  size/length, durability/availability, playoff translation/clutch proxy.
- **Quantification hierarchy:** era-relative percentiles first; then box
  score inputs; advanced metrics where reliable; tracking/modern data when
  available; awards/recognition as secondary supporting evidence only, never
  primary truth; manual/scouting tags only when documented with provenance;
  explicit uncertainty flags and coverage tiers (A–D); every attribute
  versioned (`attribute_model_version`) and never silently mutated.
- **Scoring:** three distinct, separately-computed scores — Build Quality
  (strength under the position/archetype model), Optimality (`user_build /
  oracle_best_build`, where the oracle is a deterministic solver, never an
  LLM judgment), and Coherence (interpretable, bounded interaction effects —
  no invented pseudo-scientific penalties).
- **Variants:** Daily Forge (shared prompts, leaderboard by optimality),
  practice mode, and later Forge Duel (1v1, simultaneous hidden picks) and
  Forge 2v2.
- **Trust requirement, non-negotiable:** Forge attribute scores are
  explicitly a separate, experimental model from the canonical PEAK3 peak
  score. They must never be presented as a decomposition of `arena_points`
  or `prime_score`, and every Forge result must disclose its attribute
  model version and coverage/confidence.

## 6. Competitive modes

| Mode | Pitch | Player loop | Scoring | Why it's fun | Difficulty | Priority |
|---|---|---|---|---|---|---|
| **Peak Draft Duel** (ranked 1v1) | Snake-draft a team from one shared board, place it, win a best-of-seven. | Draft → court/rotation → tactics → Games 1-3 → one adjustment → Games 4-7. | Series score, Glicko-2 rating change. | Direct counter-drafting against a real opponent under scarcity; a pick can deny, need-fill, or bait. | High (realtime state, draft clock, series sim, ranked integrity) | P0 |
| **War Room** (2v2) | Two teammates co-build one roster and split system control. | Alternating picks; A owns offense system, B owns defense; ping-based coordination. | Series result; team rating. | Forces communication without requiring voice chat; shared agency. | High (builds on Duel's realtime + adds 2-player state) | P1 |
| **Draft Night** (10-manager scheduled) | Fantasy-style scheduled event with bots filling empty seats. | 5-round snake draft for starters, bench market, compressed round-robin + bracket. | Standings, podiums, event trophies. | Familiar fantasy-draft fantasy at a 2-3 minute compressed timescale. | High (scheduling, bot strategies, league sim) | P1 |
| **Threepeat Run** | Build one roster and defeat three historical boss teams in sequence. | Series vs. boss 1 → one front-office move → boss 2 → move → boss 3. | Rings won, boss streak, permanent banner. | Escalating difficulty narrative; roster evolves under pressure. | Medium (reuses Duel's series sim + boss data) | P2 |
| **Peak Hunt** | Given a random exact team-season, identify the best PEAK3 player on that roster. | Prompt → pick → reveal. | Accuracy, distance from optimal, response time, streak. | Fast knowledge test; rewards deep roster knowledge over surface fame. | Low (read-only over existing card data) | P0 |
| **Peak Grid** | 3x3 grid combining team/era/award/role/statistical constraints. | Pick a valid player per cell. | Correctness, rarity, peak quality. | Daily-habit puzzle; social debate over rare valid answers. | Low-Medium (needs constraint-satisfaction board generator) | P1 |
| **Era Wars** | One roster faces multiple historical rule/pace environments. | Build once, see performance across eras. | Portability score across environments. | Tests whether a build is genuinely era-flexible. | High (requires validated era-simulation calibration) | P2 (label experimental) |
| **Rebuild Blitz** | Given a historical team, make three moves to beat a known opponent. | Swap ≤3 rotation players under a peak-point budget → simulate vs. target. | Win/loss vs. target, budget efficiency. | Compressed front-office puzzle; bridge toward deeper management play. | Medium | P2 |

## 7. Database expansion plan

Grow from the current ~250/500-player pool toward:

- **500 → 1,000 validated player identities** (next major release target).
- **2,000 identities** as a later coverage target, gated on data quality.
- Many more **season cards** and **approved peak-window cards** (1Y/3Y/5Y/
  playoff) per identity than there are identities.

**Inclusion cohorts** (auditable, not vibes-based): every All-Star, every
All-NBA selection, every All-Defensive selection, major award winners
(MVP/DPOY/ROY/MIP/6MOY), championship/Finals high-impact rotation players,
elite sixth men, important playoff specialists, model-identified strong
advanced-metric non-All-Stars, franchise-significant starters needed for
team-decade prompt coverage, and documented manual exceptions (e.g. Lamar
Odom) reviewed individually rather than filtered by award logic alone.

**Distinguish, as separate schema layers:**

- **Player identity** — the real person, immutable ID, aliases, physical
  data where licensed, source provenance.
- **Team-season membership** — which team(s) a player appeared for in a
  given season, games/minutes, starter/rotation role, traded-season
  attribution, postseason team.
- **Season card** — an exact season's resolved statistical/peak profile.
- **Peak window card** — 1Y/3Y/5Y/playoff-run windows, each independently
  versioned.
- **Attribute profile** — the Forge/lineup-fit vector, versioned separately
  from the peak score (see §5, §8).
- **Game eligibility profile** — which modes/rulesets a given card is
  approved for (Competitive Core vs. Extended Archive vs. Labs tiers).

Full cohort algorithm, pool tiers, and acceptance gates: master plan §11.

## 8. Simulation and scoring contract

- The canonical PEAK3 individual score (`OFFICIAL_WEIGHTS`,
  `calibrate_score()` in `peak3.py`) **remains the sole authoritative
  individual rating** and is never modified for game purposes — this
  matches the existing, non-negotiable `CLAUDE.md` rule.
- Lineup fit, season/series simulation, and the Forge attribute model are
  **separate, versioned, explicitly experimental layers** on top of that
  score — never a silent decomposition of it, never presented with false
  scientific certainty ("The simulator is a PEAK3 game model for comparing
  constructed historical rosters. It is not a scientific claim that a
  hypothetical roster would literally win a given number of NBA games.").
- Every official result must expose its assumptions and store: board seed,
  ruleset hash, model version, attribute-model version, card-pool version,
  and simulator version — so results are reproducible and old receipts
  never silently mutate when a newer model version ships.
- Receipts must explain *why* a result happened (component-level, not a
  single opaque number), consistent with the existing `arena_points` /
  `explanation.py` pattern already in `apps/api/app/services/`.

## 9. Visual and UX direction

- The **basketball court** is the central, shared game object across 82-0,
  Duel, War Room, and Draft Night — not a side panel.
- Player cards visibly travel from spin/search onto the court; bench stays
  visible on the sideline; comfort/fit indicators appear as coach notes,
  never hard invalid states.
- A fast (<2s) spin/scoreboard-ribbon animation drives team/era/year
  reveals, with a reduced-motion fallback that replaces movement with
  fades.
- Chemistry/fit is shown through spacing lanes, defensive-link glows, and a
  bench-continuity meter — never one unexplained number.
- Broadcast-style presentation for season/series simulation (scoreboard,
  series tracker, win-probability strip, key-play cards), skippable after
  first viewing, full receipt always available.
- Near-miss framing (81-1, Game 7 loss, 98.6% Forge optimality) drives
  replay — generated from real game state, never manipulated scarcity.
- Mobile-first: the court occupies the first viewport on mobile; full
  keyboard operability, screen-reader court/bench alternative, color never
  the sole cue, reduced-motion and high-contrast modes, no drag-only
  critical interaction.

Full visual system: master plan §13.

## 10. Implementation roadmap

| Phase | Deliverables | Files/systems likely touched | Tests required | Acceptance criteria |
|---|---|---|---|---|
| **5A — Research/state audit and plan lock** | Reconcile master-plan location/asset mismatch (§7 of `CURRENT_PROJECT_STATE.md`); ADR documenting the flagship pivot; revised information architecture. | `docs/architecture/ADR-005-*.md`; possibly relocate `PEAK3_GAME_PLATFORM_MASTER_PLAN.md` to `docs/strategy/`; `reference_screenshots/`. | None (docs-only phase). | ADR merged; master plan's internal links resolve to real files; no code changed. |
| **5B — Data expansion schema** | Player-identity / team-season-membership / peak-card / attribute-profile schema; cohort-based candidate builder; first expansion audit report. | New `nba_peak/` or `data/generated/` schema modules; new Supabase migrations under `supabase/migrations/` (local only); `scripts/` for cohort building and coverage audits. | New Python unit tests for schema validation, cohort auditability, duplicate-identity resolution; existing 186 model tests must stay green. | Every supported team-decade has a minimum eligible-player count; no unresolved duplicate identities; existing PEAK3 rankings unchanged unless intentionally versioned. |
| **5C — 82-0 Peak Season vertical slice** | Feature-flagged CourtBuilder (5 starters + 3 bench), team+decade spin stage, eligible-player search, exact peak-card resolution, lineup-fit v1, season simulator v1, result receipt, share link. | `apps/api/app/domains/{eligibility,peak_cards,court,lineup,simulation,modes/perfect_season}/` (new); `apps/web/src/components/` new CourtBuilder/SpinStage/PeakCard components; `apps/web/src/app/(main)/arena` route additions. | New API tests per domain; frontend unit tests for court state; new Playwright flow for a full anonymous 82-0 game; existing 264 API + 87 frontend + 62 Playwright tests must stay green. | Result always loads after final lock; no answer-key score shown pre-selection; ≥3 unconventional lineups remain legal; court usable via touch and keyboard; 10,000+ generated boards pass validity checks. |
| **5D — Daily 82 and result sharing** | Daily immutable boards, official/practice attempt split, global/friends leaderboards, streaks, Locker Room shelves, playable challenge links, archive. | Reuse existing daily-board and challenge-link infra from Peak Draft (`apps/api/app/services/duel.py`-adjacent patterns, `app/c/[token]` route); progression repos. | Daily settlement tests; leaderboard ordering tests; challenge-link E2E. | Daily first-attempt rules enforced server-side; leaderboards materialize correctly; streaks/achievements fire once per completion. |
| **5E — PEAK3 Forge prototype** | Attribute taxonomy v1 artifacts, Slot-first Forge, oracle solver, result explanations, Daily Forge. | New `apps/api/app/domains/attributes/`, `modes/forge/`; new attribute-generation scripts alongside `scripts/build_card_profiles.py`. | Oracle-solution reproducibility tests; attribute coverage/confidence audit tests. | Oracle solutions reproducible; no single celebrity dominates most boards; receipts identify ≥1 decision-level improvement; coverage limitations always visible. |
| **5F — Ranked Peak Draft Duel** | Shared-board snake draft, realtime clock/state, court/rotation setup, tactical choices, best-of-seven sim, ranked settlement via existing rating infra. | `apps/api/app/domains/modes/draft_duel/`; reuse `ranked_*.py` repositories/protocols and Glicko-2 already built in Phase 4.0. | Adversarial board validation (3,000+ boards); ranked settlement tests; two clean Playwright runs. | Rating simulation calibrated; no hidden-state leak; human pilot reports meaningful counter-drafting. |
| **5G — Locker Room, trophies, leaderboards** | Basketball-identity-first profile surface; mode-specific trophies/achievements. | `apps/web/src/app/(main)/profile`, `u/[handle]`; `apps/api/app/repositories/*progression*`. | Achievement-fanout tests; profile RLS tests. | Locker Room foregrounds basketball accomplishments, not generic XP. |
| **5H — Draft Night and 2v2** | Scheduled 10-manager rooms, bot fill/strategies, compressed league sim; War Room 2v2. | New `modes/draft_night/`, `modes/war_room/` domains; realtime scheduling infra. | Bot-strategy determinism tests; scheduled-room load tests. | Bots disclosed, bounded information, reproducible from seed. |
| **5I — Index/Lab polish and public launch** | Attribute/formula explorer polish, public data exports, accessibility/performance passes, launch readiness checklist. | `apps/web/src/features/methodology`, `apps/web/src/app/(main)/methodology`. | Full accessibility audit (axe), performance budget checks. | All acceptance criteria in master plan §20 met. |

## 11. Immediate next sprint recommendation

**Phase 5A/5B combined**: lock the game-platform plan, add visual blueprint
snapshots, audit the repo, design the expanded schema, and prototype the
82-0 court builder — **without ripping out working infrastructure.**
Concretely, in this order:

1. Resolve the master-plan location/asset discrepancy (§7 of
   `CURRENT_PROJECT_STATE.md`) and land it as a committed ADR-adjacent
   strategy doc.
2. Write the pivot ADR (`docs/architecture/ADR-005-arena-flagship-pivot.md`
   or similar).
3. Design and land the player-identity / team-season-membership / peak-card
   / attribute-profile schema (§7 above), as local-only Supabase migrations
   plus Python-side cohort-builder scripts — no hosted Supabase, no data
   fabrication, existing 186 model tests must stay green throughout.
4. Build the CourtBuilder + team-decade spin-stage prototype behind a
   feature flag, on a new branch (suggested: `phase5-arena-transformation`,
   per master plan §19.2), with the current Peak Draft demoted to a
   `Labs > Legacy Peak Draft` route rather than deleted.
5. Run clean-checkout CI-equivalent validation (model, API, frontend,
   Playwright) before claiming any part of this complete.

## 12. Risks and non-goals

- Do not copy Six Rings' presentation, mode names, or exact scoring
  mechanics directly — use it only as an ecosystem-structure lesson.
- Do not overbuild modes (Draft Night, War Room, Era Wars) before the 82-0
  core loop proves repeat-play value in testing.
- Do not present season/series simulation or Forge attribute scores as
  objective, scientifically certain predictions — every simulated/
  experimental result must disclose its model version and uncertainty.
- Do not require login before first play — anonymous play with account
  claim must remain supported, consistent with the existing anon-claim flow
  from Phase 3.0.
- Do not use NBA/team logos or player photographs without a resolved rights
  strategy — text and original visuals only, per the existing `CLAUDE.md`
  rule ("No player photographs, no NBA/team logos (unlicensed)").
- Do not let generated docs (this one included) substitute for tests —
  every phase in §10 has explicit test requirements and must not be marked
  complete without them actually passing.
- Do not break existing green CI (186 model / 264 API / 87 frontend / 62
  Playwright tests as of `9905bcc`) while building new modes.
- Do not connect to hosted Supabase, run `supabase link`, or push remote
  migrations as part of this planning-and-prototyping phase.

## 13. Acceptance criteria for this planning pass

- [x] All 69 blueprint pages rendered to
      `docs/product/blueprint_pages/page-01.png` … `page-69.png`.
- [x] `docs/product/BLUEPRINT_VISUAL_INDEX.md` written with source PDF path,
      exact render command, page count, checksum/size summary, and full
      page list.
- [x] `docs/implementation/CURRENT_PROJECT_STATE.md` written from live
      inspection (`git`, `gh`, file listings — not fabricated).
- [x] This file (`docs/product/PEAK3_NEXT_AMBITIOUS_STEPS.md`) written,
      referencing rather than duplicating the existing master plan.
- [x] No product code was modified or broken during this pass — only new
      docs and rendered images were added.
- [x] No hosted Supabase project was touched; no `supabase link`; no remote
      migration push.
- [x] Repo status reported precisely, including the untracked-file state
      and the un-fabricated CI caveat in §6 of the state report.
- [x] Exact next implementation prompt suggested (§11 above; a fuller
      version already exists in the master plan's §24).
