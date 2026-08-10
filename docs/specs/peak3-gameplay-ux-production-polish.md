# PEAK3 Production Gameplay + Visual Polish Pass

**Status:** implementation specification  
**Priority:** release-blocking product-quality pass  
**Scope:** Three-Man Weave, The $20 Showdown, Daily Grid result UX, homepage/fact experience, global dark/light visual system, and cross-cutting multiplayer reliability  
**Protected surface:** PEAK3 Rankings data visualization and its component-bar semantics must not be redesigned or recolored.

---

# 0. Mission

Turn the current PEAK3 build from “technically functional but still visibly prototype-like” into a production-quality basketball game product.

This pass is not a collection of cosmetic patches. It must fix the state-machine, data-integrity, position-legality, timer, reconnect, and interaction problems underneath the UI, then redesign the presentation so the games feel deliberate, competitive, legible, and fun.

The required standard is:

- a basketball fan can understand what is happening without studying the interface;
- a user cannot gain advantage by timing out or exploiting race conditions;
- every eligible player is actually available for the team/decade in which he played;
- positions are basketball-legitimate, not merely mathematically fillable;
- the two multiplayer/practice games have paced, game-like presentation rather than forms and admin panels;
- light and dark modes both look intentionally designed;
- results feel celebratory/competitive rather than like debug output;
- player imagery is used consistently where it materially improves recognition;
- the site uses richer color and stronger typography without damaging the already-approved Rankings visualization;
- every change is verified in a real browser, not only by unit tests.

Treat every requirement below as binding unless the codebase proves that the requested behavior already exists correctly.

---

# 1. Operating rules

## 1.1 Do not half-implement requirements

For every requirement ID in this document:

1. inspect the current implementation;
2. identify the actual root cause;
3. implement the durable fix;
4. add regression coverage;
5. verify the behavior in a real browser;
6. mark the requirement complete in a tracker only after verification.

Do not close a requirement because:
- a component renders;
- a unit test passes;
- a screenshot “roughly” resembles the request;
- a timeout or reconnect bug cannot be reproduced once;
- a hardcoded special case makes the named example pass.

## 1.2 No production deployment during this pass

Unless the user explicitly changes this instruction:

- do not deploy Railway;
- do not promote Vercel;
- do not alter hosted environment variables;
- do not merge to `main`;
- do not push until the user asks;
- do not create a PR until the user asks.

Work locally on a dedicated branch.

## 1.3 Git hygiene

The user specifically does not want dozens or hundreds of tiny commits.

- Maximum target: **6 logical commits** for the entire pass.
- Hard ceiling: **8 commits** before user review.
- Prefer meaningful phase commits, not “fix typo”, “fix test”, “try again” commits.
- Amend local commits as needed.
- Never rewrite public history without explicit instruction.
- Keep temporary screenshot/capture artifacts gitignored.
- Do not commit local `.env` files, caches, browser traces, generated screenshots, or test databases.

Suggested branch:

`fix/gameplay-ux-production-polish`

If the working tree is not clean, do not discard user work. Report it and adapt safely.

## 1.4 Protected behavior

Do not regress or redesign the following unless a requirement in this spec explicitly says otherwise:

- PEAK3 scoring model and component weights;
- Rankings component bars, their colors, values, and chart semantics;
- the unified Rankings player-analysis interaction;
- the one-click theme switch behavior;
- Peak Duel daily left/right orientation randomization;
- deterministic NBA Fact build/deployment integrity;
- 82–0 leaderboard authorization/data correctness;
- Arena capability/readiness logic;
- existing secure auth/ownership boundaries;
- Daily Grid scoring and puzzle generation;
- Run the Table core game rules.

Visual-system changes may affect shared typography/background/surfaces around Rankings, but must not alter the Rankings bar visualization itself.

---

# 2. Why this workflow is structured this way

Use Claude Code as an implementation coordinator, not as one giant undifferentiated context.

Required workflow:

1. **Explore**
   - inspect the relevant state machines, UI components, data pipelines, timers, and tests;
   - use read-only subagents for codebase archaeology and verbose audits.

2. **Plan**
   - produce a concrete implementation map before editing;
   - identify shared code that can solve multiple requirements cleanly;
   - identify requirements that require API/state-machine changes versus presentation-only changes.

3. **Implement in coherent phases**
   - shared foundations first;
   - Three-Man Weave;
   - $20 Showdown;
   - Daily Grid;
   - visual system/homepage/facts;
   - final integration.

4. **Verify continuously**
   - unit/model/API tests;
   - deterministic simulations where applicable;
   - browser interaction;
   - mobile + desktop;
   - dark + light;
   - accessibility;
   - reconnect/visibility/race scenarios.

5. **Adversarial review**
   - use a fresh review subagent after implementation;
   - it must read the spec and diff, try to prove requirements are incomplete, and report concrete findings;
   - fix verified findings before closure.

This follows the useful Claude Code pattern of exploring and planning before coding, keeping high-volume investigations in subagents, and giving the agent a browser/test feedback loop.

---

# 3. Required agent/workstream structure

The main Claude session is the coordinator and owns the tracker.

Create/update:

`docs/specs/peak3-gameplay-ux-production-polish-tracker.md`

The tracker must contain every requirement ID in this document with:

- status: TODO / IN PROGRESS / VERIFIED / BLOCKED;
- root cause;
- implementation files;
- verification;
- screenshot/frame IDs where applicable;
- remaining caveats.

Use focused subagents rather than asking one subagent to solve the whole project.

Recommended workstreams:

### Agent A — Three-Man Weave correctness/data
Read-only first.

Audit:
- player pool construction;
- team/decade normalization;
- position eligibility;
- rearrangement algorithm;
- timeout fallback;
- bot decision policy;
- turn/timer state machine.

### Agent B — $20 Showdown state machine
Read-only first.

Audit:
- auction phases;
- deadlines;
- skip accounting;
- bid action races;
- client pending behavior;
- visibility/reconnect cursor;
- catch-up/sweep logic;
- bot timing;
- raw API rejection/error surfaces.

### Agent C — visual/product design
Audit screenshots and current components.

Propose:
- shared color tokens;
- typography;
- competitive turn states;
- intro/reveal animation language;
- roster-card/headshot treatment;
- result-screen composition;
- light-mode improvements.

Do not alter Rankings bar colors/geometry.

### Agent D — data/UI support
Audit:
- existing 82–0 player-image pipeline;
- reusable avatar/headshot components;
- Daily Grid result composition;
- Fact of the Day presentation and fact-quality rubric.

### Agent E — adversarial QA
Run only after implementation is largely complete.

Attempt to break:
- timeout behavior;
- position swaps;
- missing-player pools;
- Showdown timing;
- repeated bidding;
- double click;
- visibility changes;
- reload/reconnect;
- two tabs;
- mobile layout;
- light mode;
- reduced motion;
- keyboard interaction.

Use background agents/tasks for long test runs and read-only audits. Do not let multiple agents concurrently edit the same shared files or design tokens. If parallel editing is used, isolate work in worktrees or partition ownership cleanly.

---

# 4. Evidence observed in the supplied screenshots

These are not merely aesthetic preferences; treat them as concrete evidence about the current product.

## 4.1 Three-Man Weave

Observed:

- The selection modal immediately opens with a live countdown, leaving almost no visual breathing room after a franchise/decade reveal.
- The timeout copy explicitly says the timeout drafts “the best available player,” which creates an obvious incentive to do nothing.
- At 0 seconds, the selection panel can remain visibly present rather than cleanly transitioning to a timeout-resolution state.
- The gameplay screen stacks a franchise/decade banner, a separate “X is selecting” band, another “X is scouting/drafted” band, the snake-order strip, three rosters, and an off-the-board ledger. This creates excessive vertical chrome and weak hierarchy.
- The active-seat glow is visible, but the surrounding interface contains so many borders/bands that the turn highlight loses impact.
- The three court cards are cramped; names, positions, scores, and court art compete for limited space.
- The “Draft order · snake” strip is visually busy and requires interpretation without adding enough moment-to-moment value.
- The off-the-board section grows into a large low-value text ledger.
- The result screen stretches roster data across almost the full viewport and reads like an analytics table, not a game result.
- “Decisive pick”, “Best value”, “Positional fit”, and explanatory formula copy create debug/report density.
- Light-mode roster presentation is washed out and does not have the same visual authority as dark mode.
- A screenshot shows Russell Westbrook placed at SF by a bot. That is a legality problem, not just a visual problem.
- Searching “dennis” for 1990s San Antonio returns zero results despite Dennis Rodman having played for San Antonio in that decade. That requires a pool-completeness audit, not a one-player patch.

## 4.2 The $20 Showdown

Observed:

- Side roster columns are narrow enough that player names/year/score wrap awkwardly.
- The center lot card has large empty areas while critical action information is pushed downward.
- “Current bid,” “last action,” “skips remaining,” and “whose turn” are represented by small labels/pills rather than a strong auction hierarchy.
- Bid history appears as a row of tiny chips such as “You $1 / PEAK3 Bot $2 / …”, which becomes clutter.
- Action buttons still resemble generic form controls.
- The timer and action controls visually compete rather than behaving like one unified decision surface.
- “While you were away” can occupy a huge banner and push the current lot below the fold.
- Worse, the banner is appearing while the user considers themselves actively playing; this indicates a reconnect/cursor/timer bug.
- Multiple lots can suddenly appear as settled, including lots the user never saw.
- The results page is visually sparse and administrative: two text rosters, three small callouts, large dead space.
- There is not enough player identity/imagery or celebration for a competitive finish.
- Raw/generic errors such as a move not being accepted or API-style failures have surfaced in prior play and must be eliminated.

## 4.3 Homepage/light mode

Observed:

- Light mode is coherent enough to use but feels washed out and overly beige.
- The homepage Fact card is flat compared with the hero.
- The current example “JaVale McGee won 3 championships without ever being the best player on the team” is interpretive/subjective and not a strong educational fact.
- The five-component Rankings colors are one of the strongest visual elements in the product and should inspire broader accent usage without altering the Rankings visualization itself.

---

# 5. Shared product foundations — implement before mode-specific polish

## SHARED-01 — one competitive timing model

Do not solve pacing with arbitrary client-only `setTimeout` calls while the server deadline is already running.

For timed multiplayer/practice decisions, model the phases explicitly enough that:

- a reveal/read phase can occur before the human decision timer begins;
- an action submitted by the user immediately freezes the local countdown and controls;
- the opponent’s timer cannot visually begin until the prior action has resolved;
- bot “thinking” delay is represented by a real scheduled phase, not fake client animation over an already-completed server action;
- reconnect can reconstruct the correct phase from server state;
- reduced-motion users get the same timing without unnecessary motion.

Use server-authoritative timestamps/state. The exact schema is an implementation decision; correctness is not.

## SHARED-02 — clear pending-action state

Every network action in both Arena games must have:

- one active request at a time;
- disabled duplicate controls while pending;
- a visible but non-technical pending state;
- idempotency or equivalent protection server-side;
- no second timer running behind the pending state;
- no raw response body or generic “API not returned” copy exposed to users.

## SHARED-03 — shared player headshot/avatar primitive

Reuse the proven player-image mechanism already used by 82–0.

Do not create a second source-of-truth or per-mode image fetcher.

Requirements:
- one reusable player avatar/headshot component;
- stable identity mapping;
- graceful fallback initials/silhouette;
- no layout shift when the image fails;
- lazy loading where appropriate;
- accessible alt text;
- theme-safe framing;
- historical players supported wherever the existing asset source supports them.

Apply it to:
- Three-Man Weave roster cards;
- Three-Man Weave result cards;
- $20 Showdown roster cards;
- $20 Showdown results;
- Daily Grid optimal/result board;
- other touched roster surfaces where reuse is trivial.

Do not reveal hidden information that changes gameplay merely by adding imagery.

## SHARED-04 — stronger interactive affordances

Across touched screens:
- primary buttons must look clickable at rest;
- disabled controls use deliberate neutral styling rather than faint opacity;
- hover is enhancement, never the only affordance;
- focus-visible states are obvious;
- touch targets are comfortable on mobile;
- selected/active/disabled/pending states are distinct;
- text links that are actually primary actions should become real buttons.

## SHARED-05 — remove low-value faint microcopy

Outside Rankings, audit fine, low-contrast gray helper text.

Do not blindly delete all secondary text. Instead:
- delete redundant instructions;
- promote important information into clear labels/values;
- use concise readable secondary text at accessible contrast;
- avoid tiny explanations repeating what the UI already communicates;
- keep technical explanation in “How to play”, receipts, methodology, or expandable detail when it is truly useful.

Rankings is exempt from this broad cleanup except for global typography compatibility.

---

# 6. Three-Man Weave — correctness and gameplay

## TMW-01 — timeout must never reward inactivity

Current behavior that advertises “Timeout drafts the best available player for you” is unacceptable.

A user must not improve expected lineup quality by intentionally letting the clock expire.

Implement a **non-exploitable legal fallback**.

Preferred behavior:
- on timeout, choose a deterministic legal candidate from the lower-value portion of the currently feasible pool;
- candidate must preserve at least one legal way to complete the roster;
- if the remaining pool is extremely constrained, choose the lowest-value legal completion-preserving option;
- deterministic seed should use match/round/seat context so refreshes cannot reroll it;
- do not reveal the hidden PEAK3 ordering before the timeout;
- timeout placement must itself be position-legal.

A reasonable implementation is a deterministic pick from the bottom half of completion-preserving legal candidates, with a fallback to the lowest legal candidate if needed. If the existing model has a cleaner anti-exploit policy, use it and document why its expected value is worse than active knowledgeable selection.

UI copy:
- remove “best available”;
- use something like “Time expired — assigning a legal fallback.”
- while resolving, lock the panel and show a short explicit resolution state.

Regression:
- simulate thousands of timeout states;
- prove the timeout policy cannot systematically outperform a strong manual/bot policy;
- prove every timeout completes legally;
- prove no timeout dead-ends the roster.

## TMW-02 — strict player-position legality

A player may occupy a starting position only when that exact player-season is eligible for that slot.

Examples:
- PG/SG can occupy PG or SG;
- SF/PF can occupy SF or PF;
- PG/SG cannot be moved to SF merely because a rearrangement chain can make the roster fit;
- Russell Westbrook must not appear at SF unless the canonical source for that exact season explicitly marks SF eligibility.

Bench accepts any drafted player.

The rearrangement algorithm may solve a matching problem, but every edge in the final matching must be legal.

Do not use “someone else can move, therefore this player can go anywhere” logic.

Add:
- a pure legality validator for final assignments;
- a feasibility solver/bipartite matching using only legal slot edges;
- regression fixtures for narrow and multi-position players;
- explicit Russell Westbrook regression test matching the observed failure;
- property test: every displayed final roster has every starter in a source-supported position.

If position data itself is wrong, fix the data normalization at its source rather than adding UI exceptions.

## TMW-03 — complete team/decade candidate pools

Do not patch Dennis Rodman by name.

Build an exhaustive audit over every supported franchise × decade combination.

Define the expected pool from the canonical season/roster source:
- every player who recorded a season for the franchise in the decade is expected to be discoverable for that franchise/decade;
- use the same franchise canonicalization/relocation rules the game claims to support;
- define decade membership consistently from the season-start convention used elsewhere;
- if a player has multiple eligible seasons, the identity should still be discoverable and resolve to the correct scored season used by the game;
- document intentional exclusions, and keep that list extremely small.

The audit must compare:
`expected identities from canonical season records`
against
`actual candidate-pool identities`.

Target: zero unexplained missing identities across all supported combinations.

Required named regression:
- Dennis Rodman is discoverable for San Antonio Spurs × 1990s and resolves to a valid Spurs season from that decade.

Also inspect:
- franchise alias normalization;
- relocated franchises;
- team abbreviations;
- season ranges that cross calendar years;
- players traded mid-season;
- duplicated identities;
- punctuation/suffix search;
- diacritics;
- search normalization.

Produce:
`docs/implementation/THREE_MAN_WEAVE_POOL_AUDIT.md`

Include:
- total supported franchise×decade combinations;
- expected identity count;
- actual identity count;
- missing/extra counts;
- any intentional exceptions;
- named regression results.

If the canonical source itself is incomplete, say so and fix the underlying source/ingestion if feasible rather than claiming coverage.

## TMW-04 — bot choice quality

Default practice bots should be genuinely competitive.

The earlier experience of bots passing obvious elite choices must not return.

Audit bot policy against lineup-quality marginal value and future roster feasibility.

Desired behavior:
- strong/near-optimal;
- considers current lineup fit and future legal completion;
- does not pass an obviously dominant available choice for a clearly inferior choice without a defensible roster-feasibility reason;
- deterministic enough to reproduce test failures;
- personality labels may influence tie-break style, but not make bots stupid.

Run seeded simulations and report:
- completion rate;
- illegal roster rate (must be 0);
- average lineup quality;
- avoidable-regret distribution versus an optimal/near-optimal policy;
- a sample of “largest regret” picks for human inspection.

## TMW-05 — bot think time: 4–10 seconds

Bots should not select in 1–5 seconds.

For each bot decision:
- schedule a real 4–10 second thought duration;
- preferably seeded/deterministic from match state for reproducibility;
- display the bot’s visible countdown/clock;
- keep the existing animated thinking indicator if it remains visually clean;
- do not add tiny gray narration;
- during this window the user may inspect/rearrange their own roster;
- the bot choice must not be sent to the client before the reveal.

The delay is presentation; do not weaken bot quality to simulate uncertainty.

## TMW-06 — spinner/reveal becomes a game moment

Replace the static top banner with a full-focus reveal overlay.

Required experience:
1. Round starts.
2. The three rosters remain visible but are dimmed/blurred behind an overlay.
3. A polished franchise × decade reveal animates above them.
4. Use the team logo/visual identity plus franchise name and decade.
5. Build suspense with motion, scale, card/wheel movement, or another coherent basketball/game treatment.
6. Do not imitate another game’s assets or exact trade dress.
7. Once the pair is resolved, hold the result long enough to read it.
8. Then transition to the first seat’s decision.
9. Only after that transition does the first human timer begin.

Recommended pacing:
- reveal animation: roughly 1.5–2.5s;
- resolved hold: roughly 0.8–1.3s;
- turn handoff breathing room: roughly 0.6–1.0s.

Tune through browser review, not by blindly using these numbers.

Respect `prefers-reduced-motion`.

## TMW-07 — one turn-status surface, not three stacked rows

Delete the redundant stack of:
- spinner banner;
- “X is selecting” band;
- “X is scouting/drafted” band.

After the spinner overlay leaves, use one strong turn-status region.

Examples:
- “THE SPARK IS ON THE CLOCK”
- then briefly: “THE SPARK SELECTED BRADLEY BEAL”
- then transition to the next seat.

For the user:
- “YOUR PICK”
- then open the selection experience after the reveal delay.

The active roster must also receive a clear visual highlight so the eye can find the seat instantly.

Do not duplicate the same state in three different places.

## TMW-08 — remove Draft order · snake strip

Remove the in-game snake-order chip strip.

Keep only information the player actually needs:
- Round X of 6;
- Pick Y of 18 if useful;
- active seat;
- current franchise × decade;
- roster progress count.

The snake mechanic can be explained in How to Play and/or onboarding.

## TMW-09 — improve three-roster composition

The three rosters should feel like three competing teams, not three compressed forms.

Desktop:
- keep three teams side-by-side;
- constrain the overall game width so it does not become an ultra-wide spreadsheet;
- give each team enough internal room for names, headshots, positions and score;
- stronger seat identity;
- active-seat treatment should be unmistakable but tasteful;
- use layered surfaces and color, not only thin gold borders.

Consider:
- slightly narrower overall canvas with larger cards;
- headshot + position + name as the primary unit;
- court diagram as texture/background, not the thing competing with text;
- bench visually attached to the court rather than floating as a tiny afterthought.

Mobile/tablet:
- do not squash three teams horizontally;
- use a swipe/tab/carousel presentation with active team brought forward;
- preserve visibility of whose turn it is.

## TMW-10 — manual roster rearrangement during normal gameplay

The user must be able to manage their own drafted roster between turns, not only during the draft-selection modal.

Support:
- drag a player from starter slot to another legal starter slot;
- drag starter ↔ bench;
- drag between starter positions;
- drop onto occupied slot to swap when the resulting assignment is fully legal;
- reject illegal drops clearly and immediately;
- no hidden automatic move that places either player somewhere illegal;
- persist the arrangement in match state;
- refresh/reconnect restores it.

Also retain an accessible non-drag interaction:
- click/tap a roster card;
- highlight legal destination slots;
- click destination to move/swap;
- Escape/cancel clears selection.

Keyboard users must be able to accomplish the same legal rearrangement.

Never permit Westbrook-at-SF style illegal assignments through drag/drop or automatic rearrangement.

## TMW-11 — player-selection panel refinement

Keep the useful current idea:
- searchable eligible pool on the left;
- user roster/legal placement on the right;
- explicit selected-player confirmation;
- Cancel Selection.

Improve:
- add player headshots to candidate rows if it remains readable;
- keep search/position filters;
- never reveal hidden scores in the candidate list if that undermines the basketball-knowledge challenge;
- legal destination slots should light up strongly;
- illegal players/slots should not merely look faint; explain the legality concisely when needed;
- current search filter must not affect timeout fallback logic;
- at 0 seconds, transition immediately to a locked timeout-resolution state rather than leaving a live-looking panel at zero.

## TMW-12 — Off the Board becomes a compact activity history

The giant growing text ledger consumes space.

Replace with:
- a compact recent-picks/activity rail or ticker;
- show the most recent 2–4 selections;
- clear seat/player attribution;
- optional “View draft history” control for the full ledger.

The full history may be a drawer/details panel, but should not dominate the live game.

## TMW-13 — game opening sequence

When the user launches Three-Man Weave from Arena, do not immediately drop them into a timer.

Create a short competitive intro:
- Three-Man Weave title;
- the three participants arranged as competitors;
- user identity clearly marked;
- bot identities/personas;
- brief visual statement of the objective: six franchise×decade rounds, build the best legal 5+1 roster;
- then transition into Round 1 spinner.

Think in the pacing spirit of high-quality competitive mobile games: matchup → anticipation → play.

Do not copy proprietary art/animation.

First-time users may get one additional concise onboarding beat. Returning users should not be forced through a long tutorial. Keep “How to play” always available.

## TMW-14 — results screen: full redesign

The current analytics/report presentation is rejected.

Remove from the primary result screen:
- the long “Ranked on PEAK3 lineup score…” paragraph;
- “Decisive pick”;
- “Best value”;
- “Positional fit”;
- mean-season explanation;
- separate “Show all three final rosters” duplicate section.

The result screen should feel like a competitive finish.

### Result hero

Use a response bank keyed by user placement/margin.

Examples of tone:
- first place: “That’s the board.” / “Built different.” / “You took the room.” / “Winner.”
- close loss: “That was close.” / “One pick away.” / “Run it back.”
- clear loss: “Better luck next time.” / “The room got you this time.”

Do not overdo slang. Create a tasteful response bank and choose deterministically/randomly per completed game so repeat plays vary.

Avoid the robotic:
- “You finished 3rd”
- “X wins”

Use:
- placement badge;
- concise celebratory/competitive line;
- winning seat/name;
- final lineup score.

### Three ranking cards

Show all three final teams directly in the ranking cards.

Each card:
- rank/medal;
- seat/team name;
- final PEAK3 lineup score;
- PG / SG / SF / PF / C / BN;
- player headshot;
- player name;
- season/team;
- subtle position label;
- best/highest-value roster card highlighted;
- lowest-value roster card highlighted differently;
- compact but readable.

Do not stretch each ranking card edge-to-edge across a 1700px monitor.

Use a centered max-width composition. On desktop, consider:
- winner card larger/focal;
- second/third cards paired beneath;
or
- three cards with winner elevated.

Use richer color:
- winner gold/championship treatment;
- second/third distinct muted accent families;
- wins/losses not communicated by color alone.

Keep methodology/receipt accessible behind a secondary “Full receipt” or “How scoring worked” disclosure, not in the celebration layer.

## TMW-15 — result and match visual verification

Capture and inspect at minimum:
- desktop 1440×900 dark;
- desktop 1440×900 light;
- desktop 1440×700 dark;
- mobile 390×844 dark;
- mobile 390×844 light;
- spinner in motion/reduced-motion;
- user selection;
- bot selecting;
- drag/swap;
- illegal drop;
- timeout;
- final result for user 1st, 2nd, 3rd.

No screenshot is accepted without actually opening it and judging hierarchy/readability.

---

# 7. The $20 Showdown — correctness and gameplay

## S20-01 — pre-match competitive intro

Launching from Arena should not immediately start a decision clock.

Create a concise matchup intro:
- `$20 SHOWDOWN`;
- YOU vs opponent/bot;
- both start with $20;
- five roster slots;
- market-skip concept summarized in one visual line;
- competitive “auction night” presentation;
- transition into Lot 1.

First-time users may see one short guided explanation integrated into the intro. Do not make them configure tutorial options.

Timers begin only after the intro/reveal phase completes.

## S20-02 — player/lot reveal before human timer

For each new lot:
- reveal player headshot/name/season/team/eligible positions;
- give the human a brief readable beat before the decision timer starts;
- then start the server-authoritative decision phase.

Target roughly 0.8–1.5s of readable reveal, tuned through testing.

This must not secretly consume the human’s 25-second clock.

## S20-03 — unmistakable active-seat highlighting

Highlight the participant currently responsible for the action.

Use:
- stronger seat card treatment;
- top-level turn label;
- timer visually attached to that seat/action;
- not just a tiny “YOUR MOVE” pill.

When the bot is thinking, highlight the bot side.

## S20-04 — redesign the auction decision surface

The current form-like bidding block is not good enough.

The live center should have a clear hierarchy:

1. player identity;
2. **CURRENT BID** as a large number;
3. current leader;
4. last meaningful action;
5. time remaining;
6. primary bid/pass controls;
7. budget and skips remaining.

Example information hierarchy:

`CURRENT BID`
`$6`
`PEAK3 Bot leads`
`Bot raised +$1`
`20s`

Do not use tiny pills for the full bid history.

Delete the row of micro-chips such as:
`You $1 · PEAK3 Bot $2 · You $3 ...`

If full bid history is useful, put it in an expandable auction log.

## S20-05 — better bid controls

Replace generic +/- form presentation with an intentionally designed auction control.

Keep exact monetary rules unchanged unless another requirement explicitly changes them.

Requirements:
- clear primary CTA showing the amount that will be submitted;
- clear alternate action;
- quick increments may remain but must look intentional;
- “Max $X” can remain if useful;
- buttons have strong filled/outlined hierarchy;
- no tiny hidden legal-range copy required to understand the action;
- budget limit is obvious.

Do not bury the primary controls below excessive empty space.

On mobile, keep the action surface reachable without scrolling past the whole roster.

## S20-06 — skips remaining is a first-class number

Do not hide skip count as tiny gray text or only inside a button label.

Each seat card should visibly show:
- budget remaining;
- roster slots filled;
- **market skips remaining** as a clear count.

Do not append “—free” to Pass.

The UI should explain the distinction through state, not punctuation.

## S20-07 — correct skip accounting semantics

A market skip is charged only to the seat that is the **first actor to reject an unopened lot**.

If the other participant has already rejected/skipped the unopened player, the responding participant may also decline without losing one of their own market skips.

Distinguish:
- `market_skip` = first rejection of an unopened lot; token-consuming;
- `follow_pass` / equivalent = following the other seat’s rejection; free;
- `auction_pass` = conceding an already-live auction; free.

Do not call all three “skip.”

Add explicit server-state transitions and regression tests.

Tests:
- user rejects first → user loses exactly 1 skip;
- bot rejects first → user follows → user loses 0;
- user rejects first → bot follows → bot loses 0;
- live auction pass never consumes a market skip;
- timeout behavior follows the correct semantic state;
- retries/double submits cannot double-charge a skip.

## S20-08 — stop the human timer immediately on click

When the user clicks Bid / Pass / Market Skip:

Client:
- immediately enters pending state;
- freezes/hides the local countdown;
- disables all decision controls;
- displays the submitted action clearly.

Server:
- processes exactly one action;
- adjudicates against the authoritative deadline;
- returns the new state;
- does not start an overlapping human timer.

The opponent’s next clock begins only after:
1. action accepted;
2. transition/reveal beat;
3. next turn actually opens.

The user must never watch their own timer continue counting down while the server processes a click.

## S20-09 — inter-turn breathing room

Add a short handoff between auction actions.

Examples:
- “YOU RAISED TO $7”
- 500–900ms hold
- bot side highlights
- bot clock/thinking begins.

Similarly:
- bot raises;
- show “PEAK3 BOT RAISED TO $8”;
- brief hold;
- then user decision timer starts.

Do not make the game sluggish. The purpose is legibility, not animation for its own sake.

## S20-10 — fix the “While you were away” bug at the state-machine level

Current behavior is unacceptable:
- the user can be actively playing and receive “While you were away”;
- several lots can suddenly settle;
- players the user never had a real chance to evaluate appear in the catch-up list.

Do not merely hide the banner.

Audit:
- visibility events;
- reconnect cursor;
- polling;
- persisted seen-lot cursor;
- page reload;
- two tabs;
- server sweep/catch-up loop;
- how deadlines are derived when a new human phase is created;
- whether a single late request can cascade through multiple future human decisions;
- whether cursor acknowledgment occurs before or after render;
- clock skew/server_now handling.

### Critical invariant

A newly created human decision phase must receive a full decision window.

A catch-up/sweep may resolve phases whose deadlines genuinely elapsed, but it must not create a new human decision with a deadline already in the past and immediately auto-resolve it in the same catch-up chain.

For bot practice:
- backgrounding the tab for a few seconds must not cause several unseen human opportunities to vanish;
- if the product chooses to pause bot practice while hidden, implement that deliberately and server-safely;
- if it continues, every human decision must still get its full decision window when control returns.

For real PvP:
- one player cannot pause the entire match by backgrounding the tab;
- server deadlines remain authoritative;
- catch-up UI only reports genuinely missed events.

### “While you were away” presentation

Render it only after a true reconnect/resume boundary with unseen settled lots.

Do not show it during ordinary live polling.

Make it compact:
- 1–3 recent missed lots;
- “View N more” if needed;
- acknowledge/dismiss control;
- never a giant permanent block pushing the current decision below the fold.

## S20-11 — reconnect/reload/two-tab correctness

Regression matrix:
- reload during unopened lot;
- reload during live auction;
- reload immediately after submitting bid;
- reload at 1 second remaining;
- switch tab away/back for 2s;
- switch tab away/back for 30s;
- two tabs viewing same match;
- stale tab tries to act;
- network response delayed after click;
- duplicate POST retry;
- browser sleeps/wakes;
- completed match reconnect.

Invariants:
- no duplicate player awarded;
- no duplicate budget deduction;
- no negative budget;
- no double skip charge;
- no two simultaneous owners of a lot;
- no phantom unseen lots;
- cursor only moves forward;
- completed match remains stable.

## S20-12 — errors become actionable product states

No user should see:
- raw API text;
- “API not returned”;
- generic “That move was not accepted” with no reason.

Map server rejection codes to concise user-facing states:
- “That bid arrived after the lot closed.”
- “You need at least $X to raise.”
- “That action was already processed — board refreshed.”
- “Connection dropped. Reconnecting…”
- “This lot has already moved on.”

For unknown errors:
- show a graceful retry/reconnect state;
- log diagnostic detail server/client-side;
- never expose stack traces or opaque backend wording.

## S20-13 — bot auction quality audit

The bot must make financially coherent decisions:
- values player quality;
- accounts for roster need/position scarcity;
- accounts for remaining budget/lots;
- does not spend irrationally early without reason;
- does not repeatedly donate elite players for $1;
- does not become impossible to beat through perfect hidden-information play.

Run seeded simulations:
- completion rate 100%;
- no cap violations;
- spend distributions;
- score distributions;
- user-seat simulation against a baseline/optimal heuristic;
- largest bot overpays/underbids inspected.

Do not tune the bot merely to force 50/50 wins; make the policy coherent.

## S20-14 — roster/sidebar redesign

Current side columns are too narrow.

Give each side enough width for:
- headshot;
- name;
- season/team;
- price paid;
- position;
- open slot state.

Avoid three-line wrapping for ordinary names.

Balance left and right sides around the auction center.

The active seat should be visually energized; inactive seat remains clear but quieter.

## S20-15 — results screen: full redesign

The current result screen is rejected as too sparse and administrative.

Create a competitive auction result experience.

Hero:
- WIN / LOSS;
- margin;
- celebratory/competitive response-bank line;
- final totals;
- subtle animated entrance;
- no long gray explanatory sentence.

Roster comparison:
- two visually rich team cards;
- five players each;
- headshots;
- positions;
- price paid;
- PEAK3 value;
- clear total;
- spend/unspent money.

Useful callouts may remain if visually integrated:
- best bargain;
- biggest overpay;
- decisive lot.

Do not present them as tiny gray report labels.

Consider:
- bargain badge;
- “steal of the night” treatment;
- biggest swing card;
- spend efficiency visual;
- head-to-head score bar.

Keep full receipt accessible as secondary detail.

Primary actions:
- Play again;
- Back to Arena.

They should look like intentional post-game actions.

## S20-16 — visual/browser verification

Capture and inspect:
- intro;
- unopened lot;
- bot’s turn;
- user’s turn;
- bid pending;
- bot raise;
- follow-pass case;
- market-skip case;
- low time;
- reconnect with 1 missed lot;
- reconnect with several genuinely missed lots;
- no “away” banner during ordinary live play;
- results win;
- results loss;
- dark/light;
- desktop 1440×900;
- desktop 1440×700;
- mobile 390×844.

---

# 8. Daily Grid

## DG-01 — remove redundant textual best-grid list

Under “Best Legal Grid”, the new optimal 3×3 board is the primary explanation.

Remove the redundant nine-line text list that repeats:
- square;
- user choice;
- optimal choice;
- matched/replaced status.

Keep:
- the 3×3 visual;
- row/column headers;
- color legend;
- biggest-miss callout if useful;
- concise overall explanation.

The 3×3 itself must carry the comparison clearly.

## DG-02 — add player headshots to optimal grid

Use the shared player-image primitive.

Each optimal cell should show:
- headshot;
- player name;
- season/team;
- score;
- state treatment.

States:
- exact match;
- user beat the published optimum;
- replacement/different ideal choice.

For changed squares, the user’s choice can be shown compactly without recreating the deleted nine-line list.

Do not let images make the mobile grid unreadable.

## DG-03 — preserve scoring semantics

Do not change:
- Daily Grid puzzle;
- scoring;
- best-legal-grid computation;
- points-left logic;
- streak/history logic.

Only presentation is in scope unless a real correctness bug is discovered.

---

# 9. Homepage + Fact of the Day

## HOME-01 — Fact of the Day must teach something worth returning for

The homepage fact should be:
- objectively verifiable;
- surprising, useful, historical, tactical, rule-related, statistical, cultural, or genuinely interesting;
- understandable without knowing PEAK3’s formula;
- concise;
- free of subjective superlatives unless explicitly attributed to a metric/source.

Reject facts like:
- “X was never the best player on the team” unless the statement is explicitly framed as a defined metric and that framing itself is useful;
- mundane roster-tenure counting;
- trivia that is technically true but not interesting;
- claims that require hidden PEAK3 value judgments;
- overfitted “only player ever” claims outside the source window.

Strong categories:
- NBA history;
- current NBA with expiry;
- basketball rules and rule changes;
- tactics/strategy;
- statistical milestones;
- playoff/Finals history;
- ABA/history;
- international basketball;
- Olympics/FIBA;
- women’s basketball;
- global basketball culture;
- unusual game events;
- iconic innovations;
- roster/team-building history;
- records with important context.

## HOME-02 — use a homepage-quality tier

Keep deterministic build quality.

Do not run an LLM at request time.

An LLM may be used offline only to brainstorm candidate facts, never as the factual source.

Create a clear homepage suitability gate or tier:
- factual certainty;
- surprise/interest;
- educational value;
- clarity;
- non-subjectivity;
- category diversity.

Only high-tier facts rotate onto the homepage.

Prefer a smaller excellent featured set over hundreds of filler facts.

Audit the existing 228-bank and remove/demote weak homepage items rather than padding count.

Current/perishable facts require expiry.

Every published fact remains sourceable in data/tests even if sources are not shown in the homepage UI.

## HOME-03 — redesign the fact card

The card should feel like an editorial “did you know?” moment.

Possible structure:
- category/era eyebrow;
- big numeric/stat hook or icon where appropriate;
- strong headline;
- one concise explanatory line;
- subtle visual motif tied to category;
- optional “Learn more” only when genuinely useful.

Remove the default “See their PEAK3 profile” requirement.

Do not show source rows on the homepage.

Use stronger color and composition in both themes.

---

# 10. Global visual system — ambitious but controlled

This is a critical part of the pass.

The goal is not “make everything gold.” The goal is a coherent sports/game identity with more color, depth, personality, and hierarchy.

## VIS-01 — preserve the strongest existing element

The Rankings component bars and their current component colors are approved.

Do not:
- recolor them;
- change their numerical meaning;
- change their order;
- change chart geometry purely to fit the new theme.

You may reuse their palette elsewhere as accents.

## VIS-02 — typography refresh

Audit the current font stack and replace the generic/flat parts with a coherent two-level system.

Desired feel:
- modern sports editorial;
- geometric/athletic display headings;
- highly readable UI/body font;
- strong numerals for timers/scores/bids.

Use performant variable fonts through the existing Next.js font strategy where possible.

Do not add multiple heavy font files.

Check:
- uppercase tracking;
- tabular numerals for timers/prices;
- mobile wrapping;
- apostrophes/diacritics.

## VIS-03 — dark palette

Move beyond near-black + gray + gold everywhere.

Keep gold as the PEAK3 brand/primary-action color, but introduce restrained supporting color families:
- deep navy/ink surfaces;
- component-derived blue/purple/pink/orange/green accents;
- seat-specific accents in multiplayer;
- richer success/warning/competitive states;
- subtle court/grid textures;
- selected-card tint;
- soft glows only at focal moments.

Avoid neon overload.

## VIS-04 — light palette

The current light theme is too washed/beige.

Build a deliberate light system:
- warm off-white canvas rather than flat beige;
- dark ink text with strong contrast;
- slightly cooler elevated cards;
- richer gold/ochre;
- component accent colors;
- distinct borders/shadows;
- visible active states;
- restrained court texture;
- no low-contrast tan-on-cream UI.

The light theme should feel like a first-class design, not an inverted dark theme.

## VIS-05 — shared surfaces

Refactor repeated visual patterns into tokens/primitives:
- page canvas;
- elevated card;
- competitive card;
- active seat;
- modal/overlay;
- primary/secondary/destructive action;
- score/timer numeral;
- status badge;
- player card;
- result podium card.

Avoid one-off CSS duplication.

## VIS-06 — use color to communicate hierarchy

Examples:
- active player/seat has a seat accent plus text/icon, not only glow;
- timer urgency shifts through semantic states;
- win/loss/podium have clear treatments;
- matched/replacement/beat Daily Grid states remain distinct;
- auction current bid is visually dominant;
- spinner reveal uses team/decade color treatment.

Do not rely on color alone for meaning.

## VIS-07 — animation language

Use animation for:
- pre-match reveal;
- spinner;
- turn handoff;
- player selection confirmation;
- auction bid change;
- result entrance.

Avoid:
- constant ambient movement;
- gratuitous bouncing;
- long blocking sequences;
- animations that conceal state changes;
- animation-induced input lag.

Respect `prefers-reduced-motion`.

## VIS-08 — site-wide audit without destabilizing every game

Apply the new design system through shared tokens/components so the rest of the site benefits.

Smoke-review:
- homepage;
- Arena;
- Three-Man Weave;
- $20 Showdown;
- Run the Table;
- 82–0;
- Daily Grid;
- Peak Duel;
- Rankings;
- Methodology/About shell.

Do not arbitrarily redesign the mechanics/layout of non-target games in this pass.

Fix regressions caused by shared styles.

---

# 11. Accessibility and responsive requirements

All touched experiences must support:

- keyboard navigation;
- visible focus;
- Enter/Space activation;
- Escape to close/cancel overlays where appropriate;
- screen-reader announcement of turn changes without duplicating visual text;
- meaningful aria-live regions for selected events only;
- reduced motion;
- high enough contrast;
- no hover-only controls;
- 390×844 without horizontal page scroll;
- 1440×700 without hiding the main action below the fold;
- 200% zoom for primary interactions;
- drag/drop alternative via click/keyboard.

Timers:
- do not announce every second to screen readers;
- announce meaningful thresholds and turn start.

---

# 12. Performance requirements

The visual upgrade must not make the games feel heavier.

Measure:
- no major new layout shift from headshots;
- no repeated image fetch storms;
- no unnecessary polling increase;
- no interval leak;
- no duplicate timers after route change/reconnect;
- animations primarily transform/opacity;
- no giant client bundle solely for decorative motion unless the dependency already exists and is justified;
- avoid rerendering all three rosters every timer tick when only the timer changes.

Use React profiling/browser performance tools if needed.

---

# 13. Required automated verification

Do not invent test commands. Inspect the repo and use its actual scripts.

At minimum run the relevant equivalents of:

## Model/data
- candidate pool audit;
- position legality;
- TMW bot simulation;
- timeout simulation;
- fact bank build/quality/rotation;
- deterministic generation.

## API
- Arena action tests;
- action race tests;
- Showdown timeout/skip tests;
- reconnect/history tests;
- authorization/ownership tests;
- readiness tests.

## Frontend
- typecheck;
- lint with zero warnings;
- unit tests;
- production build.

## E2E
Target both Chromium desktop and mobile where existing CI supports it.

Three-Man Weave:
- intro;
- spinner;
- turn handoff;
- legal pick;
- illegal position attempt;
- drag/swap;
- timeout;
- bot 4–10 sec timing;
- result screen.

Showdown:
- intro;
- first market skip;
- follow-pass free;
- live bid;
- user click freezes timer;
- bot turn;
- reconnect;
- tab visibility;
- no phantom catch-up;
- result.

Daily Grid:
- completion;
- optimal 3×3;
- no redundant text list;
- player images/fallback.

Theme:
- light ↔ dark;
- dark ↔ light;
- no double click;
- no intermediate broken theme.

Accessibility:
- touched pages with axe or existing equivalent.

---

# 14. Temporal/race-condition verification

Use deterministic fake-clock/unit tests plus at least one real-clock browser flow.

Required invariants:

### Three-Man Weave
- reveal phase does not consume human timer;
- bot delay is 4–10s;
- human timeout fallback happens once;
- at 0s UI does not remain interactive;
- next seat does not start before prior pick/reveal resolves.

### Showdown
- bid click freezes local timer immediately;
- request accepted once;
- next deadline starts after transition;
- follow-pass free when other player rejected first;
- no catch-up avalanche;
- no “away” banner during normal active polling;
- a truly missed event is shown once;
- cursor monotonic;
- two tabs do not duplicate actions.

Run a seeded time-sweep/audit over hundreds of matches and report counts.

---

# 15. Manual visual review protocol

Automated screenshots are evidence, not judgment.

For each target viewport/theme:
1. capture;
2. open the image;
3. inspect it visually;
4. write one sentence in the tracker about hierarchy/readability;
5. fix issues;
6. recapture.

Do not claim “reviewed” because Playwright saved a PNG.

Required matrix:

| Surface | 1440×900 dark | 1440×900 light | 1440×700 dark | 390×844 dark | 390×844 light |
|---|---:|---:|---:|---:|---:|
| TMW intro | ✓ | ✓ |  | ✓ |  |
| TMW spinner | ✓ | ✓ | ✓ | ✓ |  |
| TMW user pick | ✓ | ✓ | ✓ | ✓ | ✓ |
| TMW bot turn | ✓ |  | ✓ | ✓ |  |
| TMW result | ✓ | ✓ | ✓ | ✓ | ✓ |
| S20 intro | ✓ | ✓ |  | ✓ |  |
| S20 unopened | ✓ | ✓ | ✓ | ✓ | ✓ |
| S20 auction live | ✓ | ✓ | ✓ | ✓ |  |
| S20 reconnect recap | ✓ |  | ✓ | ✓ |  |
| S20 result | ✓ | ✓ | ✓ | ✓ | ✓ |
| Daily result | ✓ | ✓ |  | ✓ | ✓ |
| Homepage fact | ✓ | ✓ | ✓ | ✓ | ✓ |

Also inspect Rankings after global visual changes to ensure its approved bars remain unchanged.

---

# 16. Additional defects Claude should proactively look for

Do not stop at the user’s named examples.

During implementation/review, actively inspect for:

## Three-Man Weave
- illegal transitive rearrangements;
- player duplicate across seats;
- search missing suffix/diacritic;
- current filter affecting timeout;
- timer reaching zero but modal remaining live;
- bot action shown before its “thinking” completes;
- headshot/season mismatch;
- active-seat glow on wrong seat;
- stale spinner result after refresh;
- roster order changing unexpectedly;
- result ranking ties;
- bench score/position misread;
- mobile court cards overflowing;
- off-the-board history disagreeing with final rosters.

## $20 Showdown
- negative budget;
- bid above legal max;
- max button wrong after budget changes;
- skipped player later reappearing;
- auction winner occupying illegal position;
- completed roster still bidding unnecessarily;
- bot having more/less skips than UI says;
- old timer interval surviving next lot;
- action button re-enabled before response;
- stale tab overwriting current state;
- unseen history duplicated after reload;
- “caught up” banner reappearing after acknowledgment;
- deadline drift;
- bot actions settling instantly after a long browser sleep;
- result totals not matching displayed five player values;
- result spend not matching prices.

## Shared UI
- theme flash;
- image layout shifts;
- low-contrast gold in light mode;
- gray text below accessible contrast;
- action below fold at 700px height;
- buttons looking like labels;
- keyboard focus trapped in overlays;
- modal scroll trapping body incorrectly;
- reduced-motion still running large transitions.

Any verified issue within these surfaces should be fixed in this pass and added to the tracker.

---

# 17. Implementation quality rules

- Prefer root-cause state/model fixes over render-time patches.
- No hardcoded Dennis Rodman exception.
- No hardcoded Westbrook exception as the sole legality fix.
- No client-side hiding of a server race.
- No “just increase the timeout.”
- No arbitrary retry loop masking rejection.
- No lowering fact-quality gates to get more facts.
- No lowering test coverage to get green.
- No removing error states from tests because they are difficult.
- No visual screenshot assertions that only test existence when the complaint is hierarchy/usability.
- No fake success state.
- No changing PEAK3 scoring because a bot policy is weak.
- No new public dependency without checking whether the repo already has an appropriate library and whether the bundle cost is justified.

---

# 18. Suggested implementation phases and commit budget

Keep the work coherent and below the commit ceiling.

### Commit 1 — shared timing/data correctness foundations
Possible scope:
- server phase/deadline primitives;
- action pending/idempotency support;
- position legality helpers;
- player-pool audit helpers.

### Commit 2 — Three-Man Weave production gameplay
- timeout;
- bot timing/quality;
- spinner/pacing;
- drag/rearrangement;
- roster layout;
- result redesign;
- headshots.

### Commit 3 — $20 Showdown production gameplay
- skip semantics;
- auction timing;
- reconnect;
- errors;
- UI;
- results;
- headshots.

### Commit 4 — Daily Grid + Fact quality
- optimal 3×3 cleanup;
- headshots;
- homepage fact curation/card.

### Commit 5 — visual system/light mode
- typography;
- global colors/surfaces;
- cross-site polish;
- protected Rankings verification.

### Commit 6 — closure fixes/tests/docs
- adversarial findings;
- tracker;
- audit reports;
- final small corrections.

This is guidance, not an excuse to force unrelated changes into a bad commit. Hard ceiling remains 8.

---

# 19. Completion gates

The pass is not complete until all gates are true.

## Gate A — Three-Man Weave gameplay

- [ ] Timeout does not choose “best available”.
- [ ] Timeout policy is deterministic, legal, and non-exploitable.
- [ ] User sees a timeout-resolution state at 0, not a frozen live modal.
- [ ] Westbrook-style illegal position assignments are impossible.
- [ ] Manual drag/click rearrangement works between legal starter/bench slots.
- [ ] Dennis Rodman appears for 1990s Spurs.
- [ ] Full franchise×decade pool audit has zero unexplained omissions.
- [ ] Bots are strong/near-optimal.
- [ ] Bot think duration is 4–10s and visible.
- [ ] Spinner is a polished overlay with logo/team/decade.
- [ ] Spinner result is held long enough to read.
- [ ] Human timer does not start during reveal.
- [ ] One turn-status surface replaces redundant rows.
- [ ] Snake-order strip removed.
- [ ] Three rosters are readable and balanced.
- [ ] Player headshots present.
- [ ] Off-the-board activity is compact.
- [ ] Opening sequence feels competitive.
- [ ] Results screen is redesigned and not analytics-report-like.
- [ ] Result cards include all three full final rosters directly.
- [ ] Primary result view removes decisive pick/best value/positional fit clutter.
- [ ] Placement message bank works.

## Gate B — $20 Showdown gameplay

- [ ] Pre-match competitive intro.
- [ ] Lot reveal beat occurs before timer.
- [ ] Active seat is unmistakable.
- [ ] Current bid is a dominant large number.
- [ ] Last action is legible without micro-pills.
- [ ] Tiny bid-history chips removed.
- [ ] Bid controls redesigned.
- [ ] Skips remaining is prominent.
- [ ] Follow-pass after opponent’s first rejection costs 0 skips.
- [ ] Live auction pass costs 0 skips.
- [ ] User click freezes timer immediately.
- [ ] No overlapping turn timers.
- [ ] Inter-turn breathing room exists.
- [ ] “While you were away” cannot appear during ordinary active polling.
- [ ] No unseen multi-lot catch-up avalanche.
- [ ] Real reconnect shows only genuinely missed lots.
- [ ] Two-tab/reload cases are safe.
- [ ] Raw API/generic rejection copy removed.
- [ ] Bot economics pass simulation audit.
- [ ] Roster columns are readable and balanced.
- [ ] Headshots present.
- [ ] Results screen is fully redesigned.

## Gate C — Daily Grid

- [ ] redundant nine-line Best Legal Grid list removed;
- [ ] optimal 3×3 remains;
- [ ] headshots integrated;
- [ ] state colors remain semantically correct;
- [ ] scoring unchanged.

## Gate D — Homepage/facts

- [ ] weak/subjective homepage facts demoted/rejected;
- [ ] featured fact tier exists;
- [ ] current facts have expiry;
- [ ] fact card redesigned;
- [ ] no mandatory PEAK3 profile link;
- [ ] no source-row clutter;
- [ ] rotation remains deterministic and diverse.

## Gate E — visual system

- [ ] richer dark palette;
- [ ] first-class light palette;
- [ ] typography refreshed;
- [ ] stronger buttons/surfaces;
- [ ] reduced low-value gray microcopy outside Rankings;
- [ ] player imagery consistent;
- [ ] animations deliberate and reduced-motion safe;
- [ ] Rankings bars remain unchanged;
- [ ] no theme-toggle regression;
- [ ] no major performance regression.

## Gate F — validation

- [ ] relevant model tests green;
- [ ] relevant API tests green;
- [ ] frontend verify green;
- [ ] production build green;
- [ ] E2E targeted suites green with zero retries where feasible;
- [ ] accessibility green;
- [ ] deterministic simulations green;
- [ ] visual review matrix completed;
- [ ] fresh adversarial review completed;
- [ ] `git diff --check` clean;
- [ ] working tree clean;
- [ ] <= 8 local commits;
- [ ] nothing pushed/deployed unless user explicitly requested it.

---

# 20. Closure report format

When finished, do not give a vague “done”.

Report exactly:

## 1. Root causes
For each major defect family:
- TMW timeout;
- TMW illegal positions;
- TMW missing player;
- TMW pacing;
- Showdown timing;
- Showdown skip semantics;
- Showdown away/reconnect;
- visual system;
- Fact quality.

## 2. What changed
Grouped by mode and requirement IDs.

## 3. Data audits
Include:
- franchise×decade coverage counts;
- Dennis Rodman regression;
- position-legality audit;
- bot simulation statistics;
- Showdown time/skip simulation statistics;
- fact featured-tier counts/categories.

## 4. Browser review
List every reviewed viewport/theme and the defects found from visual inspection.

## 5. Tests
Exact commands and exact pass/fail counts.

## 6. Git
- branch;
- commit count;
- working-tree status;
- confirmation that nothing was pushed/PR’d/deployed unless explicitly instructed.

## 7. Remaining concerns
Do not hide flakiness, unverified assumptions, or intentionally deferred issues.

---

# 21. Product bar

Before calling this complete, ask:

### Three-Man Weave
Would a basketball fan understand the current franchise/decade, whose turn it is, what the bots just did, and how to manage their roster within two seconds of looking at the screen?

Does timing out feel worse than actually knowing basketball?

Could any displayed starter assignment make a knowledgeable fan say “that player never played that position”?

Does the result screen feel like winning/losing a game rather than reading a model report?

### $20 Showdown
Can the user answer immediately:
- what player is being auctioned;
- current bid;
- who leads;
- whose move;
- time remaining;
- money remaining;
- skips remaining;
- what happens if they press each button?

Can the user trust that a click they made before the clock expired will not keep visually counting down during server processing?

Can they leave and return without the game inventing unseen turns?

Does the finish feel like an auction showdown rather than a database table?

### Whole product
Do dark and light mode both look designed?
Is color doing useful work?
Are headshots improving recognition?
Are primary actions visually obvious?
Is there enough motion to create energy without making the app frantic?
Did we preserve the excellent Rankings visualization?

If any answer is no, the pass is not finished.

---

# 22. Final instruction

Do not optimize for finishing quickly. Optimize for removing the reasons the user keeps having to discover the next obvious flaw manually.

Use the spec as a product contract. Investigate, implement, verify, visually inspect, adversarially review, and only then report closure.
