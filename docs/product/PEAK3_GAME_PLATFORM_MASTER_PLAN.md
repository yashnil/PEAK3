# PEAK3 Game Platform Master Plan

**Version:** 2.0 product pivot and implementation guide
**Date:** July 2026
**Purpose:** Durable reference for future product, design, data, model, and engineering work
**Status:** Strategic source of truth for the next PEAK3 phases
**Primary repository target:** `yashnil/PEAK3`

---

## Document control

This plan replaces the assumption that the existing three-offer, five-role Peak Draft should remain the flagship game. It does **not** discard the strongest parts of the original 69-page blueprint or the work completed through Phase 4.0A.

The following remain foundational:

- PEAK3 INDEX as the public statistical reference.
- PEAK3 ARENA as the game platform.
- PEAK3 LAB as the methodology, formula, data, and experimentation surface.
- Exact and contiguous historical peaks as versioned content primitives.
- Server-authoritative game state, deterministic seeds, reproducible receipts, durable history, identity, progression, and ranked settlement.
- The separation between the validated individual peak model and any experimental lineup or season simulator.
- The trust promise: no silent formula changes, no pay-to-win ranked advantages, no misleading claims of scientific certainty.

The following are superseded:

- The current flagship interaction of choosing from three visibly scored cards.
- Hard role slots that turn basketball decisions into eligibility checks.
- A single opaque lineup score as the main payoff.
- A product hierarchy centered on one repetitive draft loop.

This plan reframes PEAK3 as a **basketball strategy arcade and research platform** with multiple coherent modes powered by shared engines.

### How future AI agents must use this plan

Before implementing a major feature, an agent should:

1. Read this file in full or read the relevant linked sections.
2. Inspect the current repository, ADRs, migrations, tests, and the Phase 4.0A report.
3. Inspect the relevant original blueprint page images listed in Appendix A.
4. Inspect the reference screenshots in `reference_screenshots/` when the task affects the court, game loop, results, Trophy Case/Locker Room, lobbies, or navigation.
5. Preserve model, data, ruleset, board, simulator, and attribute-version references on every official result.
6. Implement a complete vertical slice rather than adding decorative UI around an unproven loop.
7. Run clean-checkout CI-equivalent validation before claiming completion.

No agent should treat this document as permission to implement every mode at once. The implementation sequence and release gates are binding unless the user explicitly changes them.

---

# 1. Executive decision

## 1.1 The product PEAK3 should become

PEAK3 should become the place where basketball fans can:

- research the best peaks in NBA history;
- build teams from exact historical versions of players;
- create composite players from mathematically quantified attributes;
- simulate seasons and series under transparent game rules;
- compete in daily challenges, ranked duels, team modes, and scheduled drafts;
- understand why a roster or build succeeded;
- share a playable challenge rather than only a screenshot;
- build a persistent public basketball identity through trophies, records, and ranked accomplishments.

The simplest product promise is:

> **Build with the greatest NBA peaks. Prove your basketball judgment. Understand every result.**

The PEAK3 model should be the **invisible physics of the world**, not a number printed on a card that tells the user what to click.

## 1.2 The product is a platform, not one minigame

PEAK3 ARENA should contain three levels of play:

1. **Instant games** that are learned in seconds and completed in one to three minutes.
2. **Competitive games** where player scarcity, counter-drafting, tactics, and opponents create mastery.
3. **Deeper runs** that preserve a roster across multiple challenges and create longer stories.

All modes should reuse the same core systems:

- player identity and team-season membership;
- peak-card resolution;
- attribute vectors;
- court and bench builder;
- lineup-fit model;
- season/series simulation;
- deterministic daily boards;
- profiles, history, progression, trophies, and ranked settlement;
- transparent receipts and playable shares.

## 1.3 Recommended launch hierarchy

The product should eventually support a broad ecosystem, but the main hierarchy should be clear:

| Priority | Mode | Role in the product |
|---|---|---|
| 1 | **82-0: Peak Season** | Accessible front door and viral solo loop |
| 2 | **Daily 82** | Daily retention, fair global comparison, streaks |
| 3 | **PEAK3 Forge** | Original differentiator: build the perfect player from historical attributes |
| 4 | **Peak Draft Duel** | Competitive heart: ranked shared-board 1v1 |
| 5 | **Draft Night** | Scheduled fantasy-style multiplayer event with bots filling seats |
| 6 | **Threepeat Run** | Deeper solo/co-op mastery and historical boss battles |
| 7 | **War Room** | 2v2 collaborative roster construction and tactics |
| 8 | **Peak Hunt / Peak Grid** | Fast knowledge games, discovery, search, and acquisition |
| Later | **Era Wars / Rebuild Blitz / Labs** | Experimental formats after the core ecosystem proves retention |

The existing Peak Draft should become a legacy practice or internal validation mode until removed.

---

# 2. Why the current game must change

## 2.1 Observed failure of the current loop

The current implementation technically works but fails as a game for structural reasons:

- It reveals a rating and rank before the user chooses.
- The optimal action is often “click the largest visible number that fits.”
- Hard role slots create dead ends rather than interesting tradeoffs.
- The user does not see or influence a meaningful opponent.
- There is no season, series, bracket, or narrative between draft and result.
- The result is an opaque judgment rather than a story.
- The visual space is mostly a narrow list of cards on a large empty canvas.
- The tested flow produced a result-loading failure after the user completed the draft.
- The interface teaches the user to optimize the formula rather than build a basketball team.

The screenshots in `reference_screenshots/current-peak-draft-*.png` and `current-result-load-failure.png` should be treated as a product failure record, not merely a styling reference.

## 2.2 What is still valuable

The previous implementation created infrastructure that should be reused:

- deterministic board generation;
- exact peak cards;
- challenge links;
- daily state;
- durable auth, profiles, history, progression, records, achievements, and streaks;
- ranked queue, Glicko-2, placements, rating ledger, and leaderboard foundations;
- Supabase/Postgres migrations and RLS;
- test and CI infrastructure;
- share and result components;
- model artifacts and card profiles.

The pivot is therefore not a rewrite of the platform. It is a replacement of the **primary game grammar**.

## 2.3 Product lesson

A sports game becomes sticky when it combines:

- an instantly understood aspiration;
- uncertainty before the result;
- decisions with visible consequences;
- scarcity or constraints;
- a result worth sharing;
- a reason to replay immediately;
- a persistent identity across sessions.

“Go 82-0,” “win a best-of-seven,” “build the best possible player,” and “win a 10-manager draft league” are understandable goals. “Maximize a lineup score from three visible numbers” is not.

---

# 3. Competitive research and design lessons

## 3.1 First Down Studio-style perfect-season builders

The strongest lesson is the clarity of the loop:

1. Receive a random team, era, season, or category.
2. Choose one eligible player.
3. Place that player into a recognizable roster slot.
4. Repeat.
5. Receive a record and a visual result card.

The goal is iconic and legible: **17-0** or **82-0**. The game is short enough to replay and easy enough to explain in one sentence.

PEAK3 can improve this formula by using:

- exact peak seasons rather than vague career reputation;
- era normalization;
- team-season eligibility;
- flexible court positioning;
- bench depth;
- lineup compatibility and tactical fit;
- transparent reasons for wins and losses;
- daily seeded competition and ranked variants.

## 3.2 Six Rings

Six Rings demonstrates that a simple drafting mechanic can become a durable ecosystem when surrounded by:

- multiple solo modes;
- a Trophy Case;
- daily boards;
- ranked 1v1;
- FFA rooms and scheduled events;
- profiles, ratings, recent results, and leaderboards;
- live lobbies and rematches;
- persistent accomplishments across modes.

PEAK3 should learn from the ecosystem, not clone the presentation or the exact scoring mechanics.

PEAK3’s differentiation should be:

- exact peak versions;
- a visual basketball court and bench;
- lineup construction that reflects basketball roles and interactions;
- season and series simulation;
- a mathematically defensible attribute layer;
- stronger model receipts and uncertainty disclosure;
- original formats such as PEAK3 Forge and historical boss runs.

## 3.3 Basketball GM

Basketball GM proves the enduring appeal of the “I can run this team better” fantasy. Its depth comes from roster management, simulation, statistics, customization, and long-term history.

PEAK3 should not attempt to recreate a full management simulator at launch. It should compress that fantasy into short modes:

- make eight choices and simulate a season;
- make five choices and play a series;
- make three roster moves and attempt a historical upset;
- draft against nine managers and watch a compressed league.

## 3.4 Immaculate Grid and rarity games

Grid games prove that:

- one daily puzzle can create habit;
- rarity gives obscure knowledge social value;
- archives extend content life;
- personal stats and streaks matter;
- a simple share object can create discussion.

PEAK3 should use rarity as a secondary score, not its only game. Peak value can distinguish a merely valid answer from an excellent one.

## 3.5 Perfect-player builders

The “combine different players’ attributes into one perfect athlete” format is naturally social because people argue about which player owns the best shooting, finishing, defense, body, or intelligence. Existing internet challenges generally rely on subjective lists or game ratings.

PEAK3 can turn that familiar conversation into a real product by:

- defining interpretable historical attribute models;
- using team/era or exact-season eligibility spins;
- comparing the user’s build to a deterministic optimal build from the same draws;
- showing the opportunity cost of each choice;
- supporting position-specific templates;
- providing uncertainty and source transparency.

This should become one of PEAK3’s signature modes.

## 3.6 Strategic conclusion

PEAK3 should combine:

- the instant clarity of perfect-season builders;
- the ecosystem and competitive depth of Six Rings;
- the agency and statistical storytelling of management sims;
- the daily habit and rarity layer of grid games;
- an original, mathematically grounded perfect-player builder.

---

# 4. Product architecture

## 4.1 Brand surfaces

### PEAK3 INDEX

Public research surface:

- single-season, 3-year, 5-year, and later other peak leaderboards;
- player identities and exact seasons;
- team-season pages;
- attribute profiles;
- comparisons;
- model versions and source records;
- public exports.

### PEAK3 ARENA

Game surface:

- 82-0;
- Daily 82;
- PEAK3 Forge;
- Draft Duel;
- Draft Night;
- Threepeat;
- War Room;
- Peak Hunt/Grid;
- history, challenges, trophies, rankings, and events.

### PEAK3 LAB

Trust and experimentation surface:

- formula explorer;
- attribute model explorer;
- lineup and simulation methodology;
- data coverage/confidence;
- downloads and API;
- changelog;
- experimental modes clearly marked as Labs.

## 4.2 Recommended top-level navigation

Desktop:

- **Play**
- **Today**
- **Ranked**
- **Locker Room**
- **Index**
- **Lab**
- Search

Mobile bottom navigation:

- Play
- Today
- Ranked
- Locker
- More

The home page should not show ten equal mode cards. It should make the next action obvious:

1. Large “Build an 82-0 Team” primary action.
2. Daily challenge card with countdown and participation.
3. Ranked queue status.
4. Continue/claim recent achievement.
5. Compact “More modes” row.

## 4.3 Persistent identity: the Locker Room

The Locker Room is PEAK3’s equivalent of a trophy case, but it should feel native to basketball.

Display:

- perfect seasons;
- best official record;
- current and peak ranked divisions;
- Threepeat banners;
- Draft Night championships;
- Game 7 record;
- Daily streak;
- Forge best builds;
- favorite player and most-used peak;
- best upset and best value pick;
- saved rosters and shareable result cards;
- seasonal trophies and mode shelves.

Generic XP remains useful for progression, but the identity layer should foreground basketball accomplishments.

---

# 5. Shared game engines

Every mode should be an expression of shared domain systems rather than a separate pile of bespoke logic.

## 5.1 Player identity engine

A player identity represents the real person across teams and seasons.

Required fields include:

- immutable player ID;
- canonical and display names;
- aliases and normalized search names;
- birth/physical data where licensed and reliable;
- season/team membership;
- positions and position flexibility by period;
- active/inactive status;
- source provenance;
- data-coverage flags.

The same identity cannot appear twice on one roster unless a special experimental mode explicitly permits it.

## 5.2 Eligibility engine

The eligibility engine answers deterministic questions such as:

- Which players appeared for the Chicago Bulls in the 2010s?
- Which players were on the 2010-11 Atlanta Hawks?
- Which player-seasons satisfy a team, decade, franchise, award, position, or statistical constraint?
- Is a traded player eligible for one team, both teams, or neither under the selected ruleset?
- Does a brief appearance satisfy the minimum games/minutes threshold?

Eligibility must be versioned by ruleset.

Recommended defaults:

- A decade means seasons whose ending year falls in the decade definition documented by the mode.
- A team-decade pick requires a meaningful appearance threshold, not a one-game cameo.
- An exact team-season pick resolves to that exact season.
- A team-decade pick resolves to the player’s best eligible season or approved peak window while on that team in the selected decade.
- Multi-team seasons require explicit team attribution and minutes/games rules.
- The UI must show why a player is eligible.

## 5.3 Peak-card resolver

Input:

```text
player identity + eligibility context + mode + model release + card ruleset
```

Output:

```text
exact season/window + team context + peak score + attribute vector + role/archetype + confidence + simulator profile
```

Example:

```text
Context: Chicago Bulls, 2010s
Choice: Derrick Rose
Resolved card: 2010-11 Derrick Rose
Reason: highest eligible Bulls season in the selected decade under card_ruleset.v1
```

The selected card must remain immutable in the official result even after newer model versions launch.

## 5.4 Attribute engine

The attribute engine powers PEAK3 Forge, richer cards, lineup-fit logic, and explanations.

It must produce versioned, era-adjusted, role-aware scores with uncertainty. It is specified in detail in Section 10.

## 5.5 Court and rotation builder

The court is the shared primary interaction.

Initial roster:

- five starters;
- three bench slots;
- optional coach/system slot later.

The positions are **soft assignments**, not rigid eligibility locks.

The user may place:

- LeBron at point guard;
- Garnett at center;
- a nominal center at power forward;
- three wings together;
- an unconventional bench.

The model evaluates consequences through:

- offensive role coverage;
- size and mobility;
- shooting and spacing;
- creation hierarchy;
- defensive matchups;
- rebounding;
- rim protection;
- turnover risk;
- usage overlap;
- bench continuity;
- durability.

Cards should show comfort/fit indicators without preventing creative lineups.

## 5.6 Lineup-fit engine

The fit engine must remain separate from the validated individual PEAK3 score.

Recommended dimensions:

- primary creation;
- secondary creation;
- off-ball shooting/gravity;
- rim pressure/finishing;
- connective passing;
- offensive rebounding;
- transition pressure;
- point-of-attack defense;
- wing defense;
- help defense;
- rim protection;
- defensive rebounding;
- switchability;
- size;
- durability;
- role overlap and diminishing returns.

The engine should output components and counterfactuals, not one unexplained chemistry number.

## 5.7 Simulation engine

Supported simulation products:

- one seeded 82-game Arena season;
- a best-of-seven series;
- a compressed round-robin league and playoff bracket;
- a three-boss run;
- later, alternate-era environments.

The simulator should use:

- immutable roster and player cards;
- lineup-fit components;
- rotation and bench depth;
- tactical choices where applicable;
- opponent profiles;
- deterministic seed for official competition;
- stochastic distributions for casual replay;
- transparent tiebreakers and receipts.

Important trust language:

> The simulator is a PEAK3 game model for comparing constructed historical rosters. It is not a scientific claim that a hypothetical roster would literally win a given number of NBA games.

Official results should show both:

- **seeded record/result**, used for the challenge;
- **expected strength range**, used to explain uncertainty.

## 5.8 Board and content engine

The board engine creates:

- team/decade spins;
- exact team-season prompts;
- shared draft pools;
- Forge attribute prompts;
- daily modifiers;
- boss-team sequences;
- scheduled Draft Night pools.

Each official board stores:

- seed;
- model version;
- player-pool version;
- eligibility ruleset;
- simulator version;
- mode ruleset;
- generated candidates;
- publication audit;
- active window and settlement time.

## 5.9 Competitive engine

Shared capabilities:

- casual and ranked queues;
- Glicko-2 or mode-specific rating;
- divisions and placements;
- seasonal resets with historical records;
- match settlement ledger;
- bot fill;
- rematches;
- friend challenges;
- tournaments and scheduled rooms;
- spoiler-safe realtime state;
- anti-cheat and action idempotency.

## 5.10 Receipt engine

Every result should explain:

- what happened;
- why it happened;
- which decisions mattered;
- what the user could have done differently;
- which model/rules/data versions were used.

The receipt should support both casual copy and deeper analytical expansion.

---

# 6. Mode specification: 82-0 - Peak Season

## 6.1 Product role

This is the accessible front door, the most shareable solo loop, and the best place to prove the new court builder.

One-sentence explanation:

> Spin a team and era, choose one eligible player at his best PEAK3 season, place him on your court, and build a roster that can go 82-0.

Target session length: 90 seconds to four minutes.

## 6.2 Default roster

Launch default:

- five starters;
- three bench players;
- eight total rounds.

The user may rearrange players until final lock.

Possible later variants:

- five-player quick mode;
- ten-player deep rotation;
- starters-only speed run;
- current players only;
- full 12-player special events.

## 6.3 Round flow

1. The game animates a franchise and era/decade.
2. The UI states the eligibility rule.
3. The user searches or browses eligible players.
4. The user selects one identity.
5. PEAK3 resolves the exact eligible peak card.
6. The card travels onto the court or bench.
7. The user may move the player or undo until the next lock point.
8. Repeat.

Example:

```text
Spin: Chicago Bulls + 2010s
User searches: Derrick Rose
Resolved: 2010-11 Derrick Rose
Suggested roles: lead guard, downhill creator
User placement: PG
```

## 6.4 Selection interface

Do not dump hundreds of names into a plain dropdown.

Use:

- search with aliases;
- compact eligible roster list;
- filters for position, season, archetype, and familiarity;
- “Why eligible?” details;
- recent or recognizable players without ranking them as the answer;
- optional hint after a delay in casual mode.

The exact total PEAK3 score and all-time rank remain hidden until after the selection in official modes.

## 6.5 Spin types

### Team + decade

The primary all-time mode.

Example: Bulls + 2010s.

The chosen player resolves to his best eligible Bulls season in that decade.

### Exact team-season

Harder and more historical.

Example: 2010-11 Atlanta Hawks.

The chosen player resolves to that exact season.

### Current team

Uses active rosters and the approved current-season or recent-peak ruleset.

### Franchise-only

Every spin remains within one franchise’s history.

### Modifier spin

Examples:

- no MVP winners;
- only one All-NBA First Team player;
- at least two bench specialists;
- one player from every era band;
- no repeated franchise;
- defense-first scoring emphasis;
- durability matters more;
- maximum aggregate cost.

## 6.6 Rerolls and agency

Casual default:

- one board reroll;
- one player-search undo;
- unlimited court rearrangement before final lock.

Daily official:

- no rerolls or a fixed shared reroll budget;
- first completed result is official;
- practice replays clearly separated.

Ultimate mode:

- no rerolls;
- shorter decision timer;
- tougher eligibility thresholds;
- higher bench and fit weight.

## 6.7 Season simulation

The simulator should create an 82-game schedule from a versioned opponent distribution.

Recommended outputs:

- official record;
- expected wins and uncertainty band;
- offensive/defensive percentile;
- point differential;
- clutch record;
- home/road splits;
- strongest lineup combination;
- weakest matchup type;
- top three decisive roster effects;
- complete loss list for near-perfect teams.

The official leaderboard should use:

1. wins;
2. point differential;
3. strength of schedule if variants differ;
4. deterministic tiebreak from board receipt.

## 6.8 The 82-0 result moment

The result reveal should be dramatic but fast.

Sequence:

1. Regular-season record counts upward.
2. Loss markers appear on a season timeline.
3. If undefeated, the arena changes to a perfect-season presentation.
4. The court displays the final roster.
5. The receipt highlights the key interaction.
6. Share and challenge actions appear.

Example near miss:

```text
81-1
Only loss: 1996 Chicago, 112-109
Reason: second-unit creation fell to the 22nd percentile while Jordan generated 14 late-game points.
```

Example perfect result:

```text
82-0
Historic offense: 99.8th percentile
Historic defense: 99.4th percentile
No opponent type projected above a 41% single-game win probability.
```

## 6.9 Variants

### Classic

Recognizable players, broad eras, one reroll, simple results.

### All-Time

Full supported historical pool and team-decade spins.

### Ultimate

Harder spins, no rerolls, full bench and fit consequences.

### Current

Active players and recent approved peaks.

### Blind Scout

Names and descriptive traits visible; exact peak season revealed only after placement.

### One Superstar

Only one apex-tier player allowed; rewards role-player knowledge.

### Bench Mob

Bench contributes more heavily and starter minutes are capped.

### Franchise Journey

Build only from one franchise across eras.

## 6.10 Daily 82

Everyone receives:

- the same spins;
- the same player pool/version;
- the same simulator seed;
- the same modifier;
- the same tool budget.

Daily page:

```text
Your record: 77-5
Percentile: 93rd
Best today: 82-0
Average: 68-14
Rarest useful pick: 2009 Lamar Odom
Official attempts: 1
Practice attempts: 2
```

Daily leaderboards:

- Global;
- Friends;
- Rookie division;
- Verified creator/community board;
- region only if privacy and sample size permit.

## 6.11 Share object

The result card should include:

- official record;
- eight-player court/bench visualization;
- daily or mode identifier;
- one decisive strength;
- one weakness or perfect-season badge;
- challenge link to the same board;
- no spoiler list of optimal eligible players.

The best share is playable: “Beat my 79-3 roster on the same spins.”

## 6.12 Acceptance criteria

The mode is not ready unless:

- a first-time user can explain the goal after one sentence;
- the user can search and place a player without reading methodology;
- no visible single number gives away the optimal choice;
- unconventional lineups are legal but meaningfully evaluated;
- an 82-0 result is possible but rare under validated board distributions;
- a near miss creates a clear replay reason;
- every official result is reproducible from seed and versions;
- the result loads reliably after final lock;
- mobile court interactions are usable with touch and screen readers;
- daily first-attempt rules are enforced server-side.

---

# 7. Mode specification: PEAK3 Forge

## 7.1 Product role

PEAK3 Forge is the most original mode in the portfolio and a natural extension of the product’s quantitative identity.

One-sentence explanation:

> Build the perfect historical player by drafting different skills from eligible NBA players, then see how close you came to the best possible build from the same spins.

It transforms a popular basketball argument into a deterministic game.

## 7.2 Core fantasy

The user chooses a position or archetype and fills a set of attributes from historical players.

Examples:

- perfect point guard;
- perfect two-way wing;
- perfect center;
- perfect offensive engine;
- perfect defender;
- unrestricted “perfect player.”

Each selected source is an exact player-season or eligible peak card, not a career reputation label.

## 7.3 Launch attribute set

Start with 10-12 attributes, not 25. Recommended v1:

1. Rim finishing
2. Shooting gravity
3. Pull-up/self-created shooting
4. Free-throw generation and conversion
5. Ball handling and security
6. Playmaking and passing
7. Offensive decision-making / IQ proxy
8. Perimeter defense
9. Help defense and versatility
10. Interior defense / rim protection
11. Rebounding
12. Athletic tools / movement

Physical template fields can be selected separately:

- height/reach profile;
- strength/mass profile;
- speed/quickness profile;
- durability.

Later versions can split categories further after the model is validated.

## 7.4 Two primary rule formats

### Slot-first Forge

1. The game reveals an attribute, such as Interior Defense.
2. It spins a team + decade or exact team-season.
3. The user selects an eligible player.
4. That player’s resolved season contributes the attribute.
5. Repeat until the build is complete.

This is the easiest format to understand.

Example:

```text
Attribute: Interior Defense
Spin: Houston Rockets + 1990s
Choice: Hakeem Olajuwon
Resolved source: 1993-94 Hakeem Olajuwon
```

### Open-assignment Forge

1. The game spins a team + decade.
2. The user selects one eligible player.
3. The user assigns that player to any remaining attribute slot.
4. The identity cannot be reused.

This format adds opportunity cost and deeper strategy.

Example:

```text
Spin: 2000-01 Lakers
Choice: Shaquille O'Neal
Decision: use Shaq for finishing now, or save the interior-defense slot for a later draw?
```

Launch with Slot-first; add Open-assignment after users understand the attribute language.

## 7.5 Position templates

The same raw attribute vector should produce different build grades depending on target position.

### Lead guard

Higher weights:

- handle/security;
- playmaking;
- pull-up shooting;
- speed;
- decision-making;
- point-of-attack defense.

### Scoring guard

Higher weights:

- self-created shooting;
- finishing;
- off-ball gravity;
- free throws;
- movement.

### Two-way wing

Higher weights:

- shooting;
- finishing;
- perimeter/help defense;
- size/versatility;
- connective passing.

### Forward initiator

Higher weights:

- playmaking at size;
- finishing;
- rebounding;
- versatile defense;
- shooting.

### Center

Higher weights:

- interior defense;
- rebounding;
- finishing;
- screening/roll gravity later;
- passing;
- durability and size.

### Unrestricted perfect player

Uses a balanced but diminishing-return objective so one extreme attribute does not hide severe weaknesses.

## 7.6 Scoring the build

The result should contain three distinct scores:

### Build Quality

How strong the composite player is under the selected position/archetype model.

### Optimality

How close the user came to the mathematical best possible build from the exact same spins and rules.

```text
optimality = user_build_score / oracle_best_score
```

The oracle is a deterministic optimization solver, not an LLM judgment.

### Coherence

How compatible the selected physical and skill package is under the game’s interaction rules.

Examples:

- elite height and rim protection improve interior defense value;
- extreme size may reduce the value of a guard-speed source if the ruleset models physical interaction;
- redundant shooting subskills receive diminishing returns;
- weak ball security limits the full value of high playmaking.

Coherence should be interpretable and bounded. Do not invent pseudo-scientific penalties to force variety.

## 7.7 Result report

Example:

```text
PEAK3 FORGE - PERFECT POINT GUARD
Build grade: S
Build percentile: 99.2
Optimality: 94.7%

Best decisions
- 2016 Curry for shooting gravity
- 2008 Chris Paul for playmaking
- 1996 Gary Payton for perimeter defense

Missed opportunity
- You used 1994 Hakeem for rebounding.
- The optimal build used Hakeem for interior defense and 1995 Dennis Rodman for rebounding.

Primary weakness
- Finishing against size: 72nd percentile
```

The user should be able to open every attribute and see the source metrics and confidence.

## 7.8 Daily Forge

Everyone receives the same:

- target archetype;
- attribute order;
- team/era spins;
- model and attribute versions;
- timer rules.

Leaderboards can rank by:

1. optimality;
2. build quality;
3. time;
4. deterministic tiebreak.

Daily statistics:

- most common choice per slot;
- best choice per slot after settlement;
- rare successful choices;
- percentage of players who saved an elite option for the wrong slot;
- average optimality.

## 7.9 Forge Duel

Later 1v1 version:

- both players receive identical prompts;
- picks are simultaneous and hidden until each round locks;
- one optional “lock” can remove a source player from the opponent in advanced mode;
- winner determined by build score/optimality under the same draw;
- post-match reveals decision-by-decision swing.

## 7.10 Forge 2v2

Two teammates alternate attributes or control offense/defense halves of the build. The final result highlights where the partners’ decisions complemented or conflicted.

## 7.11 Trust requirements

- Every attribute score is versioned.
- Older-era uncertainty is visible.
- Narrative categories such as “IQ” must be grounded in defined proxies and evidence, not arbitrary manual opinions.
- An LLM may write the explanation, but it may not calculate the official score.
- The oracle best build must be reproducible.
- Attribute weights and interaction terms must be inspectable in PEAK3 LAB.

## 7.12 Acceptance criteria

- A user understands the game without knowing advanced statistics.
- The optimal choice is not always the most famous player.
- Multiple viable strategies exist across a large board corpus.
- Position templates create meaningful differences.
- The oracle can compute the true best build for the provided finite choices.
- The receipt identifies at least one decision-level improvement.
- Attribute data coverage and uncertainty are not hidden.

---

# 8. Mode specification: Peak Draft Duel

## 8.1 Product role

This is the flagship ranked 1v1 mode and the main expression of direct basketball strategy.

One-sentence explanation:

> Snake-draft a historical team from one shared board, position it on the court, choose a system, and win a best-of-seven series.

Target duration: three to five minutes.

## 8.2 Shared board

Recommended initial format:

- 14-18 peak cards;
- each player drafts five starters and two bench players;
- snake order;
- 10-second pick timer after onboarding;
- selected cards disappear;
- one short reserve phase if needed.

The board should create tradeoffs, not obvious tiers.

Card information visible before drafting:

- name;
- exact peak window;
- team;
- positions/flexibility;
- archetype;
- salary/cost if the queue uses a cap;
- key trait badges;
- durability indicator;
- limited source stats.

Hidden until after selection or match settlement:

- exact total PEAK3 score;
- exact synergy contribution;
- projected series result;
- complete component fingerprint.

## 8.3 Draft strategy

A pick can serve several purposes:

- acquire talent;
- fill a basketball need;
- deny the opponent;
- force an opponent into a weak archetype;
- preserve cap flexibility;
- counter a visible star;
- improve bench continuity.

The game is successful when two knowledgeable users can reasonably disagree on a pick.

## 8.4 Court and rotation phase

After drafting:

- place starters and bench;
- assign primary and secondary creators;
- choose defensive matchups or auto-match;
- set a compact rotation profile;
- see warnings, not hard invalidation.

Time target: 20-30 seconds.

## 8.5 Tactical phase

Choose one offense and one defense.

Offense launch set:

- Five-out
- Motion
- Pace and pressure
- Post hub
- Mismatch hunting

Defense launch set:

- Switch
- Drop
- Blitz
- Protect the paint
- Stay home on shooters

Choices lock simultaneously.

## 8.6 Series presentation

Simulate Games 1-3, reveal a diagnosis, then allow one timeout adjustment.

Example:

```text
After Game 3: Opponent leads 2-1
- Your drop coverage allowed 16 pull-up attempts per game.
- You hold a +8.4 offensive rebounding advantage.
```

The user may change one tactical setting. Games 4-7 then resolve.

## 8.7 Result

Show:

- series score;
- game scores;
- rating change;
- draft replay;
- largest pick swing;
- best value pick;
- matchup that decided the series;
- what-if counterfactual for one user decision;
- rematch and challenge share.

## 8.8 Ranked integrity

- Same board, ruleset, model, and timer for both players.
- Server authoritative actions and clock.
- No client access to hidden offers or opponent tactics.
- Rating separate by queue/mode if skill transfer is not proven.
- Placement period before public division.
- Abandon and disconnect rules documented.
- Bots never appear in rated matches unless clearly labeled and the queue explicitly permits it.

## 8.9 Casual variants

- no salary cap;
- blind cards;
- one franchise each;
- one decade each;
- current players;
- five-player speed duel;
- private friend room;
- creator boards.

---

# 9. Mode specification: multiplayer and deeper formats

## 9.1 War Room - 2v2

Two teammates control one roster.

Recommended responsibility split:

- teammates alternate draft picks;
- teammate A owns offensive system selection;
- teammate B owns defensive system selection;
- both can ping players and court slots;
- the mid-series adjustment requires a quick vote or designated captain decision.

Target duration: under six minutes.

The mode should create natural communication without requiring voice chat. Use pings and preset messages first.

## 9.2 Draft Night - scheduled 10-manager draft

This is the fantasy basketball-style event.

### Schedule

- new room every 10 minutes;
- 10 seats;
- public, friends, creator, and later private league variants;
- bots fill empty seats shortly before start;
- late joiners can spectate or queue for the next room.

### Draft format

Recommended launch:

- five-round snake draft for starters;
- 8-10 second timer;
- 50 total picks;
- optional simultaneous one-minute bench market after the starter draft;
- position flexibility but court placement required.

A full eight-round snake draft can be added only if wait-time tests show it remains engaging.

### Competition

After drafting:

- compressed round robin;
- top four enter semifinals;
- championship final;
- entire sim presented in two to three minutes;
- standings and bracket remain viewable.

### Bot strategies

Bots need distinct identities:

- Best Available
- Defense First
- Shooting First
- Stars and Scrubs
- Balanced Depth
- Era Specialist
- Franchise Loyalist
- Counter-Drafter

Bots should not read hidden user intents or receive stronger information.

### Rewards

- Draft Night trophy;
- podium placement;
- best value pick;
- best offense/defense;
- saved championship roster;
- event rating or seasonal points separate from core Duel rating until calibrated.

## 9.3 Threepeat Run

Build one roster and defeat three historical boss teams.

Example sequence:

- 1993 Bulls
- 2001 Lakers
- 2017 Warriors

Between series, choose one front-office move:

- replace one player;
- upgrade one peak window;
- add a specialist;
- scout the next opponent;
- change rotation or system;
- trade depth for star power;
- restore durability.

A loss can end the run or consume one life depending on difficulty.

Result:

- rings won;
- boss teams defeated;
- roster evolution;
- decisive transaction;
- permanent banner for a full Threepeat.

## 9.4 Peak Hunt

Fast historical knowledge mode.

Prompt types:

- exact team-season: choose the highest-rated eligible player-season;
- team-decade: choose the player whose best eligible peak is strongest;
- component hunt: choose the best defender, postseason peak, scorer, or playmaker under the selected model.

Do not reveal ratings before the pick.

Scoring:

- accuracy;
- distance from optimal choice;
- response time;
- streak;
- rarity of a correct non-obvious answer where multiple answers are accepted.

## 9.5 Peak Grid

A 3x3 grid combining team, era, award, role, and statistical conditions.

A valid answer receives:

- correctness;
- rarity;
- PEAK3 peak quality;
- optional “optimal valid answer” bonus.

This should primarily serve daily retention, database exploration, and search discovery.

## 9.6 Era Wars

A later original mode that evaluates portability across basketball environments.

One roster faces multiple rule/context presets:

- 1980s pace and spacing;
- 2000s defensive environment;
- modern three-point volume and switching.

This must be labeled experimental until era simulations are strongly validated.

## 9.7 Rebuild Blitz

The user receives a historical team and three moves to beat a known opponent.

Example:

```text
Starting roster: 2017-18 Cavaliers
Goal: Beat the 2017-18 Warriors
Moves: Replace any three rotation players under a peak-point budget
```

This is a compressed front-office puzzle and a bridge toward deeper management gameplay.

---

# 10. Attribute model and PEAK3 Forge methodology

## 10.1 Why a separate attribute model is required

The existing PEAK3 score answers a broad question: how strong was a player’s overall peak under the model’s combination of impact, production, recognition, postseason performance, team success, and context?

It does **not** automatically answer:

- Who was the best rim finisher?
- Who created the most shooting gravity?
- Who was the best help defender?
- Who had the best ball security?
- Who supplied the best combination of size and movement?

PEAK3 Forge and lineup simulation therefore require a separate, versioned attribute layer. The attribute layer can share source data and normalization principles with PEAK3, but it must not be presented as a trivial decomposition of the overall score.

## 10.2 Design principles

The attribute system must be:

- interpretable;
- era-adjusted;
- role-aware;
- shrinkage-aware for small samples;
- robust to missing data;
- explicit about uncertainty;
- versioned and reproducible;
- validated against known player archetypes and external evidence;
- resistant to double counting;
- useful for gameplay rather than optimized only for ranking aesthetics.

The system should prefer 12 good attributes over 35 weakly supported ones.

## 10.3 Proposed attribute taxonomy

### Offensive attributes

1. **Rim finishing**
   Efficiency and volume at the rim, contact finishing, dunk/layup value, role and era adjusted.

2. **Interior scoring / post creation**
   Post efficiency, paint creation, foul pressure, turnover cost, and role.

3. **Pull-up and self-created shooting**
   Off-dribble shooting, shot difficulty, volume, efficiency, and creation burden.

4. **Catch-and-shoot / off-ball shooting**
   Spot-up value, movement shooting where available, spacing effect, and willingness.

5. **Shooting gravity**
   A broader estimate combining range, volume, movement, defensive attention, and team-spacing effect. Must be distinct from raw three-point percentage.

6. **Free-throw pressure**
   Foul generation, conversion, and ability to sustain efficient offense.

7. **Ball handling and security**
   Creation load relative to turnovers, handle proxies, pressure resilience, and position context.

8. **Playmaking and passing**
   Assist creation, quality of created shots where available, turnover cost, role, and on/off offensive effect.

9. **Offensive decision-making**
   Interpretable composite of shot selection, turnover avoidance, passing efficiency, role execution, and impact stability. Avoid presenting this as direct mind-reading.

10. **Off-ball value**
    Cutting, screening, movement, spacing, offensive rebounding, and low-usage contribution where measurable.

### Defensive attributes

11. **Point-of-attack defense**
    Guard/wing containment, screen navigation proxies, matchup evidence where available, and impact.

12. **Wing/perimeter defense**
    Defensive versatility, size, matchup difficulty, deflections/steals without gambling overreward, and team impact.

13. **Help defense**
    Rotations, event creation, positional awareness proxies, and impact.

14. **Interior defense / rim protection**
    Rim deterrence, block value, foul control, defensive rebounding context, and team impact.

15. **Switchability / defensive versatility**
    Role breadth, physical profile, matchup data, and multi-position defensive evidence.

16. **Defensive rebounding**
    Share, contested value where available, box-out/team effect, role and era context.

### Physical and availability attributes

17. **Offensive rebounding**
18. **Speed and quickness**
19. **Vertical athleticism / explosion**
20. **Strength and contact tolerance**
21. **Height / reach profile**
22. **Durability and availability**
23. **Motor / activity proxy**

The launch Forge should select a subset of 10-12. The full vector can exist internally for simulation and future modes.

## 10.4 Source hierarchy

Use a source hierarchy rather than treating all metrics equally:

1. Direct event/tracking measures where historically available.
2. Play-by-play and lineup impact.
3. Box-score-derived production and efficiency.
4. Role/context estimates.
5. Awards and expert recognition as bounded supporting evidence, not direct truth.
6. Manually curated scouting tags only when necessary and accompanied by provenance.

For older eras, the model should use broader confidence intervals and fewer granular claims.

## 10.5 Era normalization

Each attribute should be normalized against relevant season and role populations.

Examples:

- Shooting should account for league efficiency, line distance/rules, and volume norms.
- Rim protection should account for role, team environment, and available evidence.
- Playmaking should compare creators with similar possession responsibility.
- Rebounding should account for position and team opportunity.

Do not erase historical style. Era adjustment should make comparisons fairer, not transform every player into a modern statistical profile.

## 10.6 Role normalization

A center should not receive an elite ball-security grade merely because he handled the ball rarely. A point guard should not receive an elite rebounding grade solely because his team created easy guard rebounds.

Each attribute needs:

- opportunity definition;
- role group;
- minimum sample;
- usage or matchup context;
- shrinkage toward an appropriate prior.

## 10.7 Missingness and confidence

Every attribute value should include:

```text
score_0_100
percentile
confidence_0_1
coverage_tier
source_release
attribute_model_version
```

Coverage tiers might be:

- A: direct tracking/event + impact evidence;
- B: strong play-by-play/box-score evidence;
- C: partial historical evidence with stable proxies;
- D: limited evidence; usable only in casual or clearly labeled modes.

Ranked Forge should initially require a minimum coverage tier.

## 10.8 Attribute score construction

A generic form:

```text
raw_attribute = weighted standardized evidence
adjusted_attribute = role_adjust(raw_attribute)
shrunk_attribute = reliability * adjusted_attribute + (1 - reliability) * prior
final_attribute = monotonic_transform(shrunk_attribute)
```

Interactions should be explicit and limited.

Example for shooting gravity:

```text
gravity = f(three_point_volume, accuracy_above_era, shot_difficulty,
            range_proxy, movement_proxy, team_spacing_on_off, role)
```

This should not be reduced to one arbitrary regression with no public interpretation.

## 10.9 Validation program

Validation should include:

- synthetic monotonicity tests;
- known archetype checks;
- season-to-season stability;
- role-player and superstar calibration;
- era slice audits;
- coverage/confidence audits;
- correlation and redundancy matrix;
- expert review of disagreement cases;
- gameplay distribution tests;
- adversarial search for obviously exploitable players;
- consistency between Index pages and game cards.

## 10.10 Oracle optimizer for Forge

The optimizer receives the finite choice sets and rules, then evaluates all valid assignments or uses an exact optimization method.

For small slot-first games, brute-force or dynamic programming may be enough.

For open assignment with interaction terms, use:

- integer programming;
- branch and bound;
- dynamic programming with bounded state;
- exact enumeration for daily boards generated within safe size limits.

Official daily boards should be solved before publication so the system knows:

- optimal build;
- near-optimal alternatives;
- decision difficulty;
- whether one obvious celebrity dominates every slot;
- whether the board has enough strategic diversity.

---

# 11. Expanding the player universe from 500 toward 1,000-2,000

## 11.1 Why expansion matters

A larger pool is necessary for:

- exact team-season prompts;
- team-decade spins;
- non-obvious role-player choices;
- deeper Draft Night rooms;
- meaningful rarity;
- reduced repetition;
- better franchise coverage;
- attribute diversity;
- historical discovery.

The target should not be “every person who appeared in an NBA game.” It should be broad, high-quality coverage of players who made a meaningful impact.

## 11.2 Distinguish identities from cards

Recommended targets:

- **1,000 validated player identities** as the next major release;
- **2,000 identities** as a later coverage target if data quality supports it;
- many more season cards and peak windows than identities.

One player may produce:

- exact season cards;
- 1-year apex card;
- 3-year prime card;
- 5-year sustained card;
- playoff-run card where supported;
- team/decade-specific resolved card.

The identity and card layers must remain separate.

## 11.3 Inclusion cohorts

Build the expanded pool through auditable cohorts:

### Cohort A - mandatory recognized players

- every All-NBA player in the supported period;
- every All-Star;
- MVP, DPOY, ROY, MIP, Sixth Man, and other major award winners;
- every All-Defensive selection;
- statistical title leaders where meaningful.

### Cohort B - championship and playoff impact

- major rotation players on champions and Finals teams;
- high-impact playoff specialists;
- elite defenders and connectors whose value is underrepresented by basic awards;
- significant sixth men and bench creators.

### Cohort C - model-identified impact cases

- high BPM/VORP/WS/impact seasons without All-Star recognition;
- high-value role players;
- short-prime outliers;
- elite shooting, rebounding, defense, or playmaking specialists;
- players with strong multi-year windows despite limited accolades.

### Cohort D - franchise and team-season coverage

- historically important starters for each franchise;
- best players on weak or niche team-seasons;
- enough eligible choices for every supported team/era prompt;
- current players with meaningful rotation impact.

### Cohort E - manual exceptions

Examples such as Lamar Odom should be included through documented review when a player’s strategic or historical importance is not captured by simple award filters.

## 11.4 Selection algorithm

A candidate selection score can combine:

- mandatory recognition flag;
- peak model percentile;
- multi-year peak percentile;
- playoff contribution;
- championship rotation importance;
- attribute uniqueness;
- franchise/season coverage value;
- minutes/sample sufficiency;
- data coverage/confidence.

Manual exceptions must be listed separately and reviewed.

## 11.5 Team-season membership data

The game requires more than a player list.

For each player-season-team stint, store:

- team and franchise IDs;
- season;
- games/minutes;
- starter/rotation role;
- traded-season attribution;
- postseason team;
- eligibility flags by ruleset;
- source provenance.

Exact team-season modes fail if this layer is incomplete.

## 11.6 Pool tiers

Use three public tiers:

### Competitive Core

High-confidence identities and cards approved for ranked/daily official modes.

### Extended Archive

Broader historical pool available for casual modes and Index research.

### Labs

Low-coverage or experimental cards that cannot enter official ranked competition.

## 11.7 Versioning

Recommended release objects:

```text
player_universe.v4
team_membership.v2
peak_cards.v4
attributes.v1
lineup_model.v1
season_simulator.v1
```

An expansion should not silently alter old results. Historical receipts retain old references.

## 11.8 Data expansion acceptance gates

- Candidate cohorts and exclusions are auditable.
- Every competitive identity has a validated team-season membership history.
- Search aliases are tested.
- Duplicate identities are resolved.
- Traded seasons follow explicit rules.
- Each team-decade prompt has a minimum eligible-choice count.
- Exact team-season boards are checked for impossible or trivial prompts.
- Attribute coverage thresholds are enforced.
- Existing top rankings remain unchanged unless a documented model/data release intentionally changes them.

---

# 12. Season and series simulation design

## 12.1 Product objective

The simulator should make roster construction feel consequential and produce understandable stories. It does not need to mimic every NBA possession.

The simulator should answer:

- How strong is the roster’s talent base?
- Can the lineup create efficient offense?
- Can it defend multiple opponent types?
- Is the bench viable?
- Do roles overlap or complement each other?
- How does the roster perform across a schedule or series?

## 12.2 Layered model

Recommended layers:

1. **Individual peak talent** from validated PEAK3 cards.
2. **Skill/attribute vector** for role and interaction.
3. **Lineup coverage** across offense, defense, size, shooting, creation, rebounding, and durability.
4. **Interaction terms** with strict caps.
5. **Rotation/bench model**.
6. **Tactical matchup adjustments** for series modes.
7. **Opponent and schedule distribution**.
8. **Seeded game outcome model**.

## 12.3 Avoiding obvious failure modes

Do not:

- simply sum five PEAK3 scores;
- hard-code one player at every position;
- make celebrity names inherently synergistic;
- allow five high-usage creators with no diminishing returns;
- over-penalize unconventional positions;
- make the bench cosmetic;
- hide all causality behind a single “chemistry” score;
- claim precise historical truth from thin evidence.

## 12.4 Team strength components

A transparent team state might include:

```text
talent_core
offensive_creation
shooting_and_spacing
rim_pressure
ball_security
rebounding
point_of_attack_defense
wing_defense
rim_protection
switchability
bench_continuity
durability
role_overlap
```

The receipt should show components and changes caused by each selected card.

## 12.5 Expected wins and seeded record

A deterministic official result can coexist with uncertainty.

Example:

```text
Expected wins: 77.8
80% range: 73-81
Official board result: 79-3
```

The official seeded record drives the challenge. The expected range prevents users from treating one simulation as absolute truth.

## 12.6 Opponent distributions

Possible schedule profiles:

- modern league distribution;
- all-time historical distribution;
- current season;
- curated boss schedule;
- daily modifier schedule.

All official users on the same board face the same schedule seed.

## 12.7 Best-of-seven series

Series modes should model:

- opponent-specific matchups;
- tactical choices;
- adjustment after Game 3;
- game-to-game variance;
- home-court assignment;
- fatigue/durability only if calibrated.

The series result should highlight why one team was more portable across matchups, not only stronger in aggregate.

## 12.8 Calibration

Calibration targets:

- historical team win distributions;
- net rating and win relationships;
- upset frequency;
- best-of-seven favorite conversion;
- bench and injury sensitivity;
- lineup archetype performance;
- perfect-season rarity in generated board corpora.

The exact 82-0 frequency should be tuned deliberately. A perfect roster must be possible, memorable, and rare enough to remain an achievement.

---

# 13. User experience and visual system

## 13.1 Design concept

PEAK3 should feel like a fusion of:

- a modern arena;
- a front office war room;
- a film room;
- a statistical laboratory.

It should not imitate Six Rings’ visual system or copy sports-card products.

Recommended visual language:

- dark, high-contrast base;
- PEAK3 gold as the primary prestige accent;
- restrained role colors;
- subtle hardwood and shot-chart geometry;
- crisp typographic hierarchy;
- glass/depth only where it clarifies layers;
- broadcast-inspired result moments;
- model details presented like a research instrument.

## 13.2 The court as the central canvas

The court should occupy the central game area on desktop and the first viewport on mobile.

Features:

- starter spots on a stylized half or full court;
- bench cards on the sideline;
- drag/drop and tap-to-place;
- instant swaps;
- role labels and comfort indicators;
- lineup summary around, not over, the court;
- accessible list alternative synchronized with the visual court.

Visual feedback:

- spacing lanes open or compress;
- weak paint defense glows subtly;
- defensive links show switchability;
- creation hierarchy shows primary/secondary roles;
- bench continuity meter changes as players move;
- warnings appear as coach notes, not red invalid states.

## 13.3 Spin animation

The spin should feel exciting but remain fast.

Recommended sequence under two seconds:

1. Team logos/names move through an arena ribbon.
2. Era or season flips on a scoreboard panel.
3. The result locks with a short light/sound cue.
4. Eligible-player search opens.
5. The selected card moves to the court.

Reduced-motion mode should replace movement with fades and immediate state changes.

## 13.4 Peak card design

Before selection:

- player name;
- team and eligible period;
- archetype;
- flexible positions;
- trait badges;
- confidence indicator if relevant;
- no exact answer-revealing overall score in official modes.

After selection:

- exact resolved season/window;
- key strengths;
- card receipt link;
- model version;
- optional score reveal according to mode.

## 13.5 Forge interface

The perfect-player build should look like a player blueprint, not a spreadsheet.

Center:

- evolving player silhouette or abstract figure;
- attribute radar or body diagram;
- position/archetype label;
- build grade hidden until finish.

Sides:

- attribute slots;
- selected source player-season cards;
- remaining spins;
- opportunity-cost hints in casual mode.

When a source is locked, the relevant part of the figure animates subtly:

- shooting adds arc/shot geometry;
- defense adds coverage zones;
- playmaking adds passing lanes;
- physical selections adjust silhouette proportions within tasteful limits.

## 13.6 Simulation presentation

Do not build a fake 3D basketball game.

Use a fast broadcast layer:

- scoreboard;
- series tracker;
- win-probability or momentum strip;
- possession ticker;
- matchup callouts;
- shot-location flashes;
- key-play cards;
- Game 7 and perfect-season presentations.

The simulation should be skippable after the first viewing, while the full receipt remains available.

## 13.7 Result design

A result page should answer in order:

1. Did I accomplish the goal?
2. How close was I?
3. What caused the result?
4. What should I change?
5. How do I compare globally?
6. Can I replay, challenge, or share?

Result surfaces:

- headline record/series/build grade;
- court or Forge visualization;
- decisive strengths and weakness;
- benchmark percentile;
- trophy/record update;
- share/challenge;
- expandable model receipt.

## 13.8 Near-miss psychology

The best replay trigger is a concrete near miss.

Examples:

- 81-1 with the only loss shown;
- 3-4 Game 7 loss with decisive matchup;
- Forge optimality 98.6%, with one wrong slot assignment;
- Draft Night second place by one tiebreak;
- Daily top 1.4%, 12 points below first.

Never manipulate users with fake scarcity or punitive streak loss. The replay reason should come from the game state.

## 13.9 Sound and haptics

Optional, muted by default where appropriate:

- short scoreboard click for spin;
- court-placement snap;
- draft clock warning;
- series/game win stinger;
- trophy unlock;
- subtle mobile haptic on lock.

No casino-style prolonged animation or sound spam.

## 13.10 Accessibility

- Full keyboard operation.
- Screen-reader alternative for court and bench.
- Status announcements for spins, picks, locks, and results.
- Color never the only role/strength cue.
- Reduced motion.
- High contrast.
- Touch targets at least platform-appropriate size.
- Accessible timers and extensions in unranked modes.
- Charts with textual summaries.
- No critical interaction dependent on drag alone.

## 13.11 Performance

Targets:

- quick first interaction on mobile;
- no large player-image dependency for launch;
- precomputed daily assets;
- code-split simulation/receipt explorers;
- motion at stable frame rates;
- virtualized large search lists;
- resilient loading and retry states;
- result snapshot available even if secondary progression write fails.

---

# 14. Progression, leaderboards, and social systems

## 14.1 Separate skill from participation

Maintain the original blueprint’s separation:

- rating measures competitive skill;
- seasonal points measure accomplishments;
- XP measures engagement;
- trophies and records communicate basketball stories.

No amount of grinding should guarantee a high ranked rating.

## 14.2 Mode-specific leaderboards

### 82-0

- wins;
- point differential;
- official board percentile;
- perfect seasons;
- current streak.

### Forge

- optimality;
- build quality;
- time;
- archetype-specific records.

### Draft Duel

- Glicko-2 rating;
- division;
- season record;
- Game 7 record;
- matchup-specific records.

### Draft Night

- championships;
- podiums;
- average finish;
- event rating later.

### Threepeat

- complete runs;
- difficulty;
- boss streak;
- roster constraints.

## 14.3 Daily systems

Every daily mode needs:

- immutable board ID;
- official first result;
- practice replays;
- settlement window;
- global/friends leaderboard;
- archive;
- share link;
- data and rules version.

## 14.4 Achievements and trophies

Examples:

### 82-0

- Perfect Season
- 80-Win Club
- No MVPs
- Bench Mob
- Five Decades
- Franchise Historian

### Forge

- 99% Optimal
- Perfect Point Guard
- Defensive Monster
- Hidden Gem Builder
- No Top-50 Sources

### Duel

- First Ranked Win
- Game 7 Ice
- Reverse Sweep
- Ten-Win Streak
- Master Division

### Draft Night

- Champion
- Undefeated Pod
- Last Pick Value
- Beat Nine Humans

### Threepeat

- Threepeat
- Beat the 2017 Warriors
- No Roster Changes
- Underdog Run

## 14.5 Playable sharing

Share objects should open:

- same board challenge;
- same Forge spins;
- same Draft Duel replay;
- same Threepeat seed;
- public roster receipt.

Images remain useful, but every image should contain a playable link or short code.

## 14.6 Social features

Launch-safe:

- follow/friend system;
- challenge links;
- recent opponent rematch;
- public profiles;
- saved rosters;
- preset emotes/pings;
- creator boards.

Delay:

- open DMs;
- unrestricted chat;
- algorithmic social feed;
- complex clans/guilds.

---

# 15. Ranked, matchmaking, bots, and events

## 15.1 Rating architecture

Use separate ratings where game skills differ materially:

- Draft Duel rating;
- Forge Duel rating later;
- War Room team/individual rating later;
- Draft Night event standing, not automatically the same rating.

Triple Crown or cross-mode mastery can exist as an accomplishment without merging ratings.

## 15.2 Matchmaking

Ranked Duel:

- rating and uncertainty band;
- region/latency where applicable;
- queue time expansion;
- placement protection;
- rematch controls;
- anti-collusion rules.

## 15.3 Bots

Bots are essential for:

- solo practice;
- Draft Night seat fill;
- onboarding;
- internal board validation;
- offline development.

Bots should have:

- named strategies;
- bounded access to information;
- reproducible decisions from seed;
- difficulty based on search/strategy quality, not hidden score bonuses;
- clear disclosure when present.

Bots should not secretly participate in ranked human ladders.

## 15.4 Scheduled events

Possible cadence:

- Draft Night every 10 minutes;
- hourly special board;
- daily official 82 and Forge;
- weekly Threepeat boss set;
- seasonal ranked ladder;
- creator tournaments.

The interface should show the next event and allow one-click reminders without spamming users.

## 15.5 Tournament formats

Later:

- eight-player single elimination;
- Swiss creator events;
- FFA draft rooms;
- 2v2 brackets;
- weekend perfect-season cups.

Tournament integrity requires settled rules, no hidden admin edits, and replayable receipts.

---

# 16. Technical architecture

## 16.1 Existing foundation to preserve

The repository already contains valuable Phase 2-4/4.0A systems:

- Next.js frontend;
- FastAPI backend;
- Supabase/Postgres schema and RLS;
- auth and anonymous claim flow;
- profiles/history/progression;
- ranked queue and rating ledger;
- deterministic card/board generation;
- model artifacts;
- CI, Playwright, and integration testing.

The new work should extend these systems rather than create parallel stores.

## 16.2 New domain packages

Suggested backend structure:

```text
apps/api/app/
  domains/
    eligibility/
    peak_cards/
    attributes/
    court/
    lineup/
    simulation/
    modes/
      perfect_season/
      forge/
      draft_duel/
      draft_night/
      threepeat/
      peak_hunt/
    boards/
    receipts/
    trophies/
    bots/
```

Existing repository conventions should be followed rather than mechanically adopting this path if the current architecture uses a different clean pattern.

## 16.3 Core immutable version tables

Required version records:

- model_versions;
- data_release_versions;
- player_universe_versions;
- team_membership_versions;
- attribute_model_versions;
- peak_card_ruleset_versions;
- lineup_model_versions;
- simulator_versions;
- mode_ruleset_versions;
- bot_strategy_versions;
- board_generator_versions.

Every official game references all relevant versions.

## 16.4 Suggested database domains

### Player and historical data

- players
- player_aliases
- teams
- franchises
- seasons
- player_team_seasons
- peak_cards
- attribute_vectors
- attribute_evidence
- player_pool_membership

### Boards

- game_boards
- board_prompts
- board_candidate_sets
- board_publication_audits
- daily_board_schedule

### 82-0

- perfect_season_games
- perfect_season_rounds
- roster_slots
- season_sim_results
- season_game_results or compressed loss/highlight records

### Forge

- forge_games
- forge_prompts
- forge_assignments
- forge_results
- forge_oracle_solutions

### Duels

- duel_matches
- duel_boards
- duel_picks
- duel_rosters
- duel_tactics
- duel_series_results

### Draft Night

- draft_rooms
- draft_seats
- draft_picks
- draft_rosters
- draft_league_standings
- draft_brackets

### Progression

Reuse existing progression/records/achievements with new event types rather than inventing a second system.

## 16.5 API examples

```text
POST /v1/perfect-season/games
GET  /v1/perfect-season/games/{id}
POST /v1/perfect-season/games/{id}/select
POST /v1/perfect-season/games/{id}/place
POST /v1/perfect-season/games/{id}/complete

POST /v1/forge/games
POST /v1/forge/games/{id}/assign
GET  /v1/forge/games/{id}/result

POST /v1/duels/queue
GET  /v1/duels/matches/{id}
POST /v1/duels/matches/{id}/pick
POST /v1/duels/matches/{id}/lineup
POST /v1/duels/matches/{id}/tactics
POST /v1/duels/matches/{id}/adjust

GET  /v1/draft-night/schedule
POST /v1/draft-night/rooms/{id}/join
POST /v1/draft-night/rooms/{id}/pick
```

Action endpoints must be idempotent and state-versioned.

## 16.6 State machines

### 82-0

```text
created -> prompt_active -> selection_locked -> placement_active
-> rounds_complete -> simulating -> result_ready -> claimed/shared
```

### Forge

```text
created -> prompt_active -> assignment_locked -> prompts_complete
-> oracle_validated -> result_ready
```

### Duel

```text
queued -> matched -> draft_active -> court_setup -> tactics_locked
-> games_1_3 -> adjustment -> games_4_7 -> settled -> rated
```

### Draft Night

```text
scheduled -> seating -> drafting -> bench_market -> simulating_league
-> playoffs -> settled -> archived
```

## 16.7 Realtime

Use realtime only where it improves the experience:

- Duel draft clock and picks;
- War Room pings;
- Draft Night seating/picks/standings;
- tournament status.

Solo 82-0 and Forge should remain resilient without realtime dependencies.

## 16.8 Jobs and queues

Background jobs:

- board generation and validation;
- Forge oracle solving;
- season/series simulation if too expensive inline;
- daily settlement;
- leaderboard materialization;
- share image generation;
- trophy/progression fan-out;
- data expansion audits.

Result durability should not depend on a noncritical share image or analytics job succeeding.

## 16.9 Frontend architecture

Reusable components:

- CourtBuilder
- BenchRail
- SpinStage
- EligiblePlayerSearch
- PeakCard
- LineupInsightPanel
- SimulationBroadcast
- ResultReceipt
- ForgeBlueprint
- DraftClock
- SharedBoard
- TrophyShelf
- LeaderboardPanel

Each should have mobile, keyboard, loading, empty, error, and reduced-motion states.

## 16.10 Security

- Server-authoritative candidate sets and actions.
- RLS for user history and private match data.
- Hidden opponent selections protected until reveal.
- No simulator secrets or full future board graph bundled to clients.
- Rate limits on search, challenge creation, queueing, and state-changing actions.
- Service-role credentials never public.
- Audit logs for official board changes and ranked settlement.

---

# 17. Analytics and experimentation

## 17.1 North-star metrics

### Activation

- percentage who complete first placement;
- percentage who complete first roster/build;
- time to first meaningful decision;
- result-view success rate.

### Retention

- D1/D7/D30 by first mode;
- daily challenge return;
- average sessions per active user;
- replays after near miss;
- challenge acceptance.

### Fun and mastery

- immediate replay rate;
- quit rate by round;
- choice diversity;
- percentage of boards with multiple competitive strategies;
- rematch rate;
- post-result receipt opens;
- user-reported understanding and fairness.

### Competitive health

- rating calibration;
- queue time;
- disconnect/abandon rate;
- pick-time distribution;
- bot fill rate;
- matchup balance;
- suspicious action patterns.

### Trust

- result dispute rate;
- methodology opens;
- data correction rate;
- simulation explanation usefulness;
- historical receipt reproducibility.

## 17.2 Required event families

- mode viewed/started/completed;
- spin revealed;
- search opened/query;
- candidate selected;
- card resolved;
- court placement/swapped;
- tactic selected;
- simulation started/skipped/completed;
- result loaded/failed;
- receipt expanded;
- replay/challenge/share;
- daily official/practice attempt;
- queue/match/pick/timeout/settlement;
- trophy unlocked;
- model/attribute detail opened.

## 17.3 Experiments worth running

- 5 starters vs 5+3 bench for first-time completion;
- search-first vs browse-first eligible player selection;
- hidden exact score vs approximate tier;
- one reroll vs no reroll;
- expected wins shown before or after official record;
- court half-court vs full-court layout;
- Forge slot-first vs open-assignment onboarding;
- best-of-seven full broadcast vs condensed reveal;
- result copy centered on weakness vs missed opportunity.

Do not A/B test integrity rules, hidden pay advantages, or different ranked outcomes for equivalent users.

---

# 18. Product roadmap

## 18.1 Phase 5.0 - Product pivot and prototype validation

**Goal:** Prove the court builder and the 82-0 loop before large backend expansion.

Deliverables:

- archive or relabel current Peak Draft as Legacy/Labs;
- fix any remaining result-loading defect;
- clickable court-builder prototype;
- team+decade spin prototype;
- eligible-player search prototype;
- exact peak-card resolver proof;
- static season-result prototype;
- user tests with at least 10-20 basketball fans;
- revised information architecture;
- ADR documenting the pivot.

Exit gates:

- 80%+ of testers understand the goal without tutorial assistance;
- users describe at least two strategic considerations beyond “pick the best player”;
- majority prefer replaying the prototype to the legacy draft;
- court works on phone and desktop.

## 18.2 Phase 5.1 - Player universe and eligibility expansion

**Goal:** Build the data foundation for 1,000 identities and team-season prompts.

Deliverables:

- player identity/team-season schema;
- cohort-based candidate builder;
- first 1,000-player candidate release;
- franchise/season membership audits;
- search aliases;
- team+decade and exact-season eligibility resolver;
- peak-card resolver;
- data coverage dashboards;
- versioned artifacts.

Exit gates:

- every supported team-decade has sufficient eligible players;
- exact-season prompts meet minimum choice quality;
- no unresolved duplicate identities;
- clean rebuild is deterministic;
- existing PEAK3 rankings remain stable unless intentionally versioned.

## 18.3 Phase 5.2 - 82-0 vertical slice

**Goal:** Ship one complete, fun, unranked perfect-season mode.

Deliverables:

- eight-round game;
- court + bench;
- search and exact peak resolution;
- lineup-fit v1;
- season simulator v1;
- result receipt;
- share image/link;
- anonymous play and account claim;
- history and best record;
- full tests and observability.

Exit gates:

- first-play completion rate target met in testing;
- no answer-key score shown before choice;
- 10,000+ generated boards pass validity checks;
- 82-0 rare but possible;
- result reliability >99.9% in test runs;
- users can explain why a roster succeeded or failed.

## 18.4 Phase 5.3 - Daily 82 and Locker Room

Deliverables:

- daily immutable boards;
- first official attempt;
- global/friends leaderboards;
- streaks and achievements;
- Locker Room shelves;
- playable challenge links;
- archive;
- daily settlement and moderation tools.

## 18.5 Phase 6.0 - Attribute model and PEAK3 Forge

Deliverables:

- attribute taxonomy v1;
- attribute artifacts and confidence;
- PEAK3 LAB attribute explorer;
- Slot-first Forge;
- oracle solver;
- result explanations;
- Daily Forge;
- position templates;
- board generation/audits.

Exit gates:

- attribute validation report approved;
- oracle solutions reproducible;
- no single celebrity dominates most boards;
- receipts identify decision-level improvements;
- coverage limitations clearly displayed.

## 18.6 Phase 7.0 - Peak Draft Duel

Deliverables:

- shared board snake draft;
- realtime state and timer;
- court/rotation setup;
- tactical choices;
- best-of-seven simulation;
- ranked settlement using existing rating infrastructure;
- replay, rematch, and share;
- anti-cheat and disconnect handling.

Exit gates:

- rating simulation calibrated;
- 3,000+ adversarial boards validated;
- no hidden state leak;
- two clean Playwright runs;
- human pilot reports meaningful counter-drafting.

## 18.7 Phase 8.0 - Draft Night and War Room

Deliverables:

- scheduled rooms;
- bot fill and strategies;
- 10-manager five-round draft;
- compressed league/bracket;
- 2v2 responsibilities and pings;
- event trophies;
- spectating and creator rooms.

## 18.8 Phase 9.0 - Threepeat and experimental modes

Deliverables:

- boss team library;
- persistent run roster;
- between-series transactions;
- weekly boss sets;
- Era Wars/Rebuild Blitz prototypes;
- experimental methodology labels.

## 18.9 Suggested sequencing discipline

Do not begin full Draft Night, 2v2, or Era Wars until:

- 82-0 proves repeat play;
- the court builder is stable;
- the player universe supports variety;
- the lineup simulator has a trustworthy receipt;
- daily systems and profiles work reliably.

---

# 19. Immediate action plan from the current repository

## 19.1 Preserve the current branch

The Phase 4.0A branch and green CI are a stable checkpoint. Do not discard it.

## 19.2 Create the pivot branch

Suggested branch:

```text
phase5-arena-transformation
```

## 19.3 First implementation package

The first coding pass should not build the entire 82-0 backend. It should create:

1. ADR: Peak Draft flagship replaced by court-based platform.
2. Mode shell and navigation update.
3. CourtBuilder component with five starters + three bench.
4. Static team+decade spin animation.
5. Mock eligible-player search using existing pool.
6. Exact peak resolution using current artifacts where possible.
7. Mock result with record and explanation.
8. Usability telemetry.
9. Feature flag protecting existing routes.

## 19.4 Current legacy game treatment

Options in order of preference:

1. Move to `Labs > Legacy Peak Draft` while the new mode is built.
2. Keep accessible only from an internal route for model validation.
3. Remove from primary navigation.

Do not keep it as the homepage’s main game merely because it already exists.

## 19.5 Immediate P0 bugs

- Result loading must never fail after a completed game.
- Dead-end role assignment must be eliminated or handled before any public test.
- Frontend should never display a completed official action while the authoritative result cannot be retrieved.
- Error recovery must use persisted game/result IDs, not restart the user blindly.

---

# 20. Acceptance criteria by product pillar

## 20.1 Fun

- Users replay voluntarily without being asked.
- Users discuss a choice, not only a score.
- Near misses create immediate desire to retry.
- The result produces a story worth sharing.

## 20.2 Clarity

- Each mode has a one-sentence explanation.
- The primary goal is visual and numeric: 82-0, series win, Forge optimality, championship.
- No first-time mode requires methodology reading.

## 20.3 Depth

- Multiple viable strategies exist.
- Role players and bench players can be valuable.
- Positioning and tactics change outcomes.
- Better historical knowledge improves choices without making the game deterministic.

## 20.4 Trust

- Exact versions are visible.
- Results are reproducible.
- Simulation uncertainty is acknowledged.
- Attribute evidence is inspectable.
- Old receipts do not mutate.

## 20.5 Competition

- Ranked outcomes compare users on equal information and rules.
- Skill rating is not XP.
- No pay-to-win tools.
- Bots are disclosed.
- Abandon/disconnect rules are predictable.

## 20.6 Quality

- No result-loss path.
- Mobile interactions are first-class.
- Accessibility passes manual and automated checks.
- Clean-checkout CI is green.
- Daily reset and event start are load tested.

---

# 21. Open product decisions

These should be resolved through prototypes and user tests, not prolonged speculation.

1. Should default 82-0 use 5 starters or 5+3 bench?
   **Recommendation:** 5+3, with a five-player quick mode.

2. Should cards reveal exact PEAK3 scores before selection?
   **Recommendation:** no in official modes; reveal after lock.

3. Should team+decade resolve to best 1Y season or best 3Y window?
   **Recommendation:** 1Y for 82-0 simplicity; offer 3Y/5Y variants later.

4. Should the simulator show a deterministic record or only expected wins?
   **Recommendation:** show both, with deterministic record as the game outcome.

5. Can a player play any position?
   **Recommendation:** yes, with soft comfort/fit consequences.

6. How many Forge attributes at launch?
   **Recommendation:** 10-12.

7. Should Draft Duel use a salary cap?
   **Recommendation:** test both; shared scarcity may be sufficient for the first queue.

8. Should Draft Night include bench picks in the snake draft?
   **Recommendation:** five starter rounds, then simultaneous bench market.

9. Should current and all-time modes share leaderboards?
   **Recommendation:** no.

10. Should exact team-season prompts allow very low-minute players?
    **Recommendation:** no; use explicit minimums and casual exceptions.

11. Should PEAK3 Forge allow physically impossible combinations?
    **Recommendation:** fantasy combinations are allowed, but position template and coherence interactions prevent trivial max-stat builds.

12. How early should player photos/logos be used?
    **Recommendation:** text and original visuals first until rights strategy is complete.

---

# 22. Ideas deliberately deferred or rejected

## Deferred

- auction drafts;
- deep contracts/salary-cap management;
- full dynasty simulation;
- open marketplace/collectible economy;
- WNBA/college/international expansion;
- complex era-rule simulation;
- live possession coaching;
- unrestricted user-generated formulas;
- public chat and DMs;
- native mobile apps before web retention is proven.

## Rejected as flagship concepts

- choosing the highest visible score from three options;
- rigid five-role completion as the main strategy;
- a pure 100-point knapsack game without opponent or simulation;
- a grid-only product;
- a score-only result with no basketball explanation;
- copying Six Rings’ names, visual identity, or exact mode structure.

---

# 23. AI implementation operating contract

Future coding agents should follow this sequence.

## 23.1 Before coding

- Confirm branch and clean working tree.
- Read current ADRs and reports.
- Read this plan’s relevant mode and engine sections.
- Inspect blueprint page PNGs listed in Appendix A.
- Search the repo for existing reusable systems.
- Write a concise before-state matrix.
- Define acceptance tests.

## 23.2 During coding

- Preserve one source of truth per domain.
- Keep in-memory and Postgres implementations protocol-conformant.
- Version all official model/rules/data dependencies.
- Keep hidden state server-side.
- Add explicit loading/error/retry states.
- Keep mobile and accessibility in scope.
- Do not add cosmetic motion before the complete loop works.

## 23.3 Before claiming completion

- Run unit, integration, frontend, build, and Playwright gates.
- Use a clean worktree or clean checkout.
- Test persistence across process restart where relevant.
- Test server/client state reconciliation.
- Test the result after final action.
- Verify no hosted Supabase project is touched unless the task explicitly authorizes it.
- Commit and push with a focused message.
- Confirm GitHub Actions is green.

## 23.4 Required final report

- user-facing behavior;
- architecture changes;
- data/model/rules versions;
- files changed;
- tests and counts;
- screenshots or videos;
- remaining limitations;
- next recommended vertical slice.

---

# 24. Suggested master prompt for the next AI implementation phase

```text
Continue PEAK3 from the latest green branch and implement Phase 5.0: Arena Product Pivot and 82-0 Court Prototype.

Read:
- docs/strategy/PEAK3_GAME_PLATFORM_MASTER_PLAN.md
- docs/implementation/PHASE_4_0A_REPORT.md
- existing ADRs and repository wiring docs
- the original blueprint page images referenced by the master plan

Goal:
Replace the current Peak Draft as the primary product experience with a feature-flagged, court-based 82-0 prototype that proves the new game grammar without destabilizing the Phase 4 infrastructure.

Build:
1. ADR documenting the pivot.
2. Updated Play/Today/Ranked/Locker Room navigation shell.
3. Reusable CourtBuilder with 5 starters and 3 bench slots.
4. Team + decade spin stage.
5. Eligible-player search using current data, with clear rules and aliases.
6. Exact eligible peak-card resolution.
7. Flexible court placement with warnings rather than hard role locks.
8. Prototype lineup-insight panel.
9. Prototype season result with record, expected wins, strengths, weakness, and replay/share actions.
10. Durable game state and reliable result retrieval.
11. Feature flags preserving the legacy draft route in Labs.
12. Analytics for spin, search, selection, placement, completion, result load, replay, and share.
13. Unit, API, integration, accessibility, and Playwright tests.

Do not:
- build hosted Supabase setup unless explicitly asked;
- implement Draft Night, War Room, Forge, or full ranked Duel in this pass;
- expose exact answer-key PEAK3 scores before selection;
- use hard role slots that make valid lineups impossible;
- claim the season simulator is an objective prediction;
- copy Six Rings or First Down Studio visual design.

Completion requires:
- a full anonymous game can be completed on phone and desktop;
- the result always loads after final lock;
- the court is keyboard and touch accessible;
- at least three unconventional lineups remain legal;
- exact card resolution is deterministic;
- all existing CI gates remain green;
- new Playwright coverage validates the full prototype loop.
```

---

# 25. Research sources and inspiration log

Use these as product references, not templates to copy.

- Six Rings official game and guide: solo Trophy Case modes, Duels, FFA, ranked and persistent profiles.
  `https://databallr.com/sixrings`
  `https://databallr.com/sixrings/how-to-play`

- First Down Studio: Build a 17-0 Team, Build the GOAT Team, Build an 82-0 Team, and simple result sharing.
  `https://www.firstdown.studio/`
  `https://www.firstdown.studio/build-a-17-0-team`

- Basketball GM: deep roster-management and simulation reference.
  `https://basketball-gm.com/manual/`

- Immaculate Grid basketball: daily grid, rarity, archive, and personal stats reference.
  `https://www.sports-reference.com/immaculate-grid/basketball/mens/`

- Adjacent perfect-player/draft formats should be reviewed only for interaction lessons; PEAK3’s attribute model and visual identity must be original.

---

# Appendix A. Original 69-page blueprint visual index

The original PDF was rendered into 69 PNG pages. Future agents should inspect the page image when a task touches the listed topic. The PNG is authoritative for charts, tables, and visual layout; the master plan is authoritative for the new product direction.

| Page | Primary topic | Visual reference |
|---:|---|---|
| 01 | Cover and document purpose - BUILD BLUEPRINT / A focused plan for turning PEAK3 into a public | [Open page 01](blueprint_pages/page-01.png) |
| 02 | North-star outcomes, contents, and product flywheel | [Open page 02](blueprint_pages/page-02.png) |
| 03 | North-star outcomes, contents, and product flywheel - CONTENTS / Implementation map | [Open page 03](blueprint_pages/page-03.png) |
| 04 | North-star outcomes, contents, and product flywheel - Figure 1. The product flywheel: credible model -> meaningful play -> social competition -> richer data and debat... | [Open page 04](blueprint_pages/page-04.png) |
| 05 | Vision, strategic thesis, product surfaces, and boundaries - PART 01 / Vision, strategic thesis, and boundaries | [Open page 05](blueprint_pages/page-05.png) |
| 06 | Vision, strategic thesis, product surfaces, and boundaries | [Open page 06](blueprint_pages/page-06.png) |
| 07 | Competitive landscape and distinctive positioning - PART 02 / Competitive landscape and lessons | [Open page 07](blueprint_pages/page-07.png) |
| 08 | Competitive landscape and distinctive positioning | [Open page 08](blueprint_pages/page-08.png) |
| 09 | Audience, jobs, product principles, and first-session journeys - PART 03 / Audience, jobs, and product principles | [Open page 09](blueprint_pages/page-09.png) |
| 10 | Audience, jobs, product principles, and first-session journeys | [Open page 10](blueprint_pages/page-10.png) |
| 11 | Brand architecture, information architecture, navigation, and URLs - PART 04 / Brand architecture and information architecture | [Open page 11](blueprint_pages/page-11.png) |
| 12 | Brand architecture, information architecture, navigation, and URLs | [Open page 12](blueprint_pages/page-12.png) |
| 13 | Brand architecture, information architecture, navigation, and URLs | [Open page 13](blueprint_pages/page-13.png) |
| 14 | Original Peak Draft product specification, tools, state, and board quality - PART 05 / Flagship Peak Draft specification | [Open page 14](blueprint_pages/page-14.png) |
| 15 | Original Peak Draft product specification, tools, state, and board quality | [Open page 15](blueprint_pages/page-15.png) |
| 16 | Original Peak Draft product specification, tools, state, and board quality | [Open page 16](blueprint_pages/page-16.png) |
| 17 | Original Peak Draft product specification, tools, state, and board quality | [Open page 17](blueprint_pages/page-17.png) |
| 18 | Original Peak Draft product specification, tools, state, and board quality | [Open page 18](blueprint_pages/page-18.png) |
| 19 | Competitive modes, Glicko-2, leaderboards, and experimental mode ideas - PART 06 / Competitive modes and global ranked system | [Open page 19](blueprint_pages/page-19.png) |
| 20 | Competitive modes, Glicko-2, leaderboards, and experimental mode ideas | [Open page 20](blueprint_pages/page-20.png) |
| 21 | Competitive modes, Glicko-2, leaderboards, and experimental mode ideas | [Open page 21](blueprint_pages/page-21.png) |
| 22 | Competitive modes, Glicko-2, leaderboards, and experimental mode ideas | [Open page 22](blueprint_pages/page-22.png) |
| 23 | Competitive modes, Glicko-2, leaderboards, and experimental mode ideas | [Open page 23](blueprint_pages/page-23.png) |
| 24 | Retention, progression, achievements, notifications, and social loops - PART 07 / Retention, progression, and social systems | [Open page 24](blueprint_pages/page-24.png) |
| 25 | Retention, progression, achievements, notifications, and social loops | [Open page 25](blueprint_pages/page-25.png) |
| 26 | Retention, progression, achievements, notifications, and social loops | [Open page 26](blueprint_pages/page-26.png) |
| 27 | Lineup scoring, receipts, fairness, and validation - PART 08 / Scoring, lineup logic, and fairness | [Open page 27](blueprint_pages/page-27.png) |
| 28 | Lineup scoring, receipts, fairness, and validation | [Open page 28](blueprint_pages/page-28.png) |
| 29 | Lineup scoring, receipts, fairness, and validation | [Open page 29](blueprint_pages/page-29.png) |
| 30 | Interactive Formula Explorer - PART 09 / The interactive formula explorer | [Open page 30](blueprint_pages/page-30.png) |
| 31 | Interactive Formula Explorer | [Open page 31](blueprint_pages/page-31.png) |
| 32 | Interactive Formula Explorer | [Open page 32](blueprint_pages/page-32.png) |
| 33 | Interactive Formula Explorer | [Open page 33](blueprint_pages/page-33.png) |
| 34 | PEAK3 Index, player pages, comparisons, and public data - PART 10 / PEAK3 Index, comparisons, and public data | [Open page 34](blueprint_pages/page-34.png) |
| 35 | PEAK3 Index, player pages, comparisons, and public data | [Open page 35](blueprint_pages/page-35.png) |
| 36 | PEAK3 Index, player pages, comparisons, and public data | [Open page 36](blueprint_pages/page-36.png) |
| 37 | Visual design, motion, accessibility, and performance - PART 11 / Visual design, motion, accessibility, and performance | [Open page 37](blueprint_pages/page-37.png) |
| 38 | Visual design, motion, accessibility, and performance | [Open page 38](blueprint_pages/page-38.png) |
| 39 | Visual design, motion, accessibility, and performance | [Open page 39](blueprint_pages/page-39.png) |
| 40 | Technical architecture, repository, pipeline, and environments - PART 12 / Technical architecture and data pipeline | [Open page 40](blueprint_pages/page-40.png) |
| 41 | Technical architecture, repository, pipeline, and environments | [Open page 41](blueprint_pages/page-41.png) |
| 42 | Technical architecture, repository, pipeline, and environments | [Open page 42](blueprint_pages/page-42.png) |
| 43 | Technical architecture, repository, pipeline, and environments | [Open page 43](blueprint_pages/page-43.png) |
| 44 | Database, APIs, realtime, and model-version contracts - PART 13 / Database, API, realtime, and model-version contracts | [Open page 44](blueprint_pages/page-44.png) |
| 45 | Database, APIs, realtime, and model-version contracts | [Open page 45](blueprint_pages/page-45.png) |
| 46 | Database, APIs, realtime, and model-version contracts | [Open page 46](blueprint_pages/page-46.png) |
| 47 | Security, anti-cheat, privacy, moderation, and legal - PART 14 / Security, anti-cheat, moderation, privacy, and legal | [Open page 47](blueprint_pages/page-47.png) |
| 48 | Security, anti-cheat, privacy, moderation, and legal | [Open page 48](blueprint_pages/page-48.png) |
| 49 | Security, anti-cheat, privacy, moderation, and legal | [Open page 49](blueprint_pages/page-49.png) |
| 50 | Analytics, experiments, testing, operations, and incidents - PART 15 / Analytics, experimentation, testing, and operations | [Open page 50](blueprint_pages/page-50.png) |
| 51 | Analytics, experiments, testing, operations, and incidents | [Open page 51](blueprint_pages/page-51.png) |
| 52 | Analytics, experiments, testing, operations, and incidents | [Open page 52](blueprint_pages/page-52.png) |
| 53 | Analytics, experiments, testing, operations, and incidents | [Open page 53](blueprint_pages/page-53.png) |
| 54 | Roadmap, team plan, build phases, and launch preparation - PART 16 / Roadmap, team plan, and execution cadence | [Open page 54](blueprint_pages/page-54.png) |
| 55 | Roadmap, team plan, build phases, and launch preparation | [Open page 55](blueprint_pages/page-55.png) |
| 56 | Roadmap, team plan, build phases, and launch preparation | [Open page 56](blueprint_pages/page-56.png) |
| 57 | Roadmap, team plan, build phases, and launch preparation | [Open page 57](blueprint_pages/page-57.png) |
| 58 | Launch positioning, creators, community, and share objects - PART 17 / Launch, creators, community, and growth | [Open page 58](blueprint_pages/page-58.png) |
| 59 | Launch positioning, creators, community, and share objects | [Open page 59](blueprint_pages/page-59.png) |
| 60 | Scope, priorities, acceptance criteria, decisions, and initial backlog - PART 18 / Scope priorities, acceptance criteria, and open | [Open page 60](blueprint_pages/page-60.png) |
| 61 | Scope, priorities, acceptance criteria, decisions, and initial backlog | [Open page 61](blueprint_pages/page-61.png) |
| 62 | Scope, priorities, acceptance criteria, decisions, and initial backlog | [Open page 62](blueprint_pages/page-62.png) |
| 63 | Scope, priorities, acceptance criteria, decisions, and initial backlog | [Open page 63](blueprint_pages/page-63.png) |
| 64 | Appendices: schemas, board checks, analytics definitions, readiness checklist, and resources - PART A / Appendices: implementation reference | [Open page 64](blueprint_pages/page-64.png) |
| 65 | Appendices: schemas, board checks, analytics definitions, readiness checklist, and resources | [Open page 65](blueprint_pages/page-65.png) |
| 66 | Appendices: schemas, board checks, analytics definitions, readiness checklist, and resources | [Open page 66](blueprint_pages/page-66.png) |
| 67 | Appendices: schemas, board checks, analytics definitions, readiness checklist, and resources | [Open page 67](blueprint_pages/page-67.png) |
| 68 | Appendices: schemas, board checks, analytics definitions, readiness checklist, and resources | [Open page 68](blueprint_pages/page-68.png) |
| 69 | Final page / document terminus | [Open page 69](blueprint_pages/page-69.png) |

---

# Appendix B. Reference screenshot manifest

| Reference | File | Product lesson |
|---|---|---|
| Current Peak Draft - round 2 | [Open image](reference_screenshots/current-peak-draft-round-2.png) | Visible ratings and rank make the choice too obvious; narrow card-list layout. |
| Current Peak Draft - round 4 | [Open image](reference_screenshots/current-peak-draft-round-4.png) | Rigid role completion and minimal opponent/story context. |
| Current Peak Draft - role dead end | [Open image](reference_screenshots/current-peak-draft-role-dead-end.png) | A selected player cannot be assigned because all compatible roles are filled or ineligible. |
| Current result failure | [Open image](reference_screenshots/current-result-load-failure.png) | Completed effort ends in a result-loading error; a P0 reliability failure. |
| First Down Studio result card | [Open image](reference_screenshots/first-down-studio-result-card.png) | Simple iconic goal, compact roster, record, grade, and share actions. |
| 100-score gauntlet concept | [Open image](reference_screenshots/idea-100-score-gauntlet.png) | Useful constraint and boss-team ideas, but insufficient alone as a flagship. |
| Peak-Doku concept | [Open image](reference_screenshots/idea-peak-doku.png) | Grid/rarity inspiration for a side mode. |
| Salary-cap draft concept | [Open image](reference_screenshots/idea-salary-cap-draft.png) | Salary/value draft and multiplayer ladder inspiration. |
| Six Rings Trophy Case | [Open image](reference_screenshots/six-rings-trophy-case.png) | Persistent accomplishments, mode shelves, daily entry point, and identity. |
| Six Rings Duels | [Open image](reference_screenshots/six-rings-duels.png) | Ranked, FFA, rooms, lobbies, recent results, events, chat, and ladder ecosystem. |

---

# Appendix C. Source-of-truth hierarchy

When documents conflict, use this order unless the user explicitly overrides it:

1. The user's latest explicit product direction.
2. This Version 2.0 master plan for game portfolio and implementation sequence.
3. Current repository behavior, ADRs, migrations, and verified tests for technical reality.
4. Original 69-page blueprint for unchanged trust, Index, Lab, accessibility, security, and architecture principles.
5. External products only as inspiration; never as authority over PEAK3 identity.

---

# Appendix D. Final strategic statement

PEAK3 has the potential to become more than a ranking website or a single drafting game. Its unique advantage is the ability to convert exact historical peaks into trustworthy, reusable game objects. The product should use that advantage to let fans build teams, create players, outdraft opponents, survive historical challenges, and understand the basketball logic behind every outcome. The accessible hook is 82-0. The original signature is PEAK3 Forge. The competitive heart is Draft Duel. The durable identity is the Locker Room. The long-term moat is the model, data, versioning, and explanation system beneath all of them.
