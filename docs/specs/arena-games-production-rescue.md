You are performing a complete production rescue of PEAK3’s interactive game
experience and several adjacent product defects.

This is not another checklist implementation pass.

The currently deployed work technically reaches completed states, but manual
testing shows that important interactions, state synchronization, bot quality,
visual presentation, and basic product details are not production-ready.

The rescue covers:

1. Three-Man Weave
2. The $20 Showdown
3. PEAK3 Rankings player analysis
4. Site-wide Light/Dark theme switching
5. Peak Duel Daily left/right presentation fairness

Repository:
~/Desktop/PEAK3

======================================================================
STARTING STATE AND BRANCH
======================================================================

Before beginning:

1. Fetch origin.
2. Confirm PR #12, the NBA Fact of the Day deployment hotfix, has been merged.
3. Start from the latest origin/main after that merge.
4. Create and work on:

   fix/arena-games-production-rescue

Do not work directly on main.

Do not merge automatically.

Do not modify:

- NBA Fact of the Day behavior or data pipeline;
- legacy Ranked;
- Arena ratings;
- Arena public leaderboard;
- unrelated game modes;
- Supabase migrations unless an unavoidable state-integrity requirement truly
  demands one—in that case, stop and report before creating the migration;
- deployment environment variables;
- PEAK3 component definitions or scoring methodology.

Keep:

- PEAK3_ARENA_RATINGS_ENABLED=false
- PEAK3_ARENA_LEADERBOARD_ENABLED=false
- readiness level closed_alpha

Do not enable either multiplayer mode for a wider audience as part of this pass.

======================================================================
EXECUTION DISCIPLINE
======================================================================

This is one focused rescue pass.

- Do not create an agent team.
- Do not spawn subagents.
- Do not create worktrees.
- Do not perform an unrelated repository-wide cleanup.
- Do not rewrite history.
- Do not redesign unrelated pages.
- Do not add a heavy UI framework.
- Do not add a heavy charting dependency.
- Do not replace deterministic game logic with an LLM.
- Do not use arbitrary sleeps, retries, test skips, or CI-only behavior.
- Do not hide defects behind generic error copy.
- Do not declare completion merely because tests pass.
- Do not reinterpret the manual acceptance findings as optional preferences.

Inspect only the relevant:

- Arena backend state machines;
- Arena API routes;
- Three-Man Weave frontend;
- $20 Showdown frontend;
- shared Arena client state and polling;
- bot policies;
- timers;
- spinner implementation;
- Rankings page and player detail components;
- shared theme system;
- Peak Duel Daily matchup generation and presentation;
- focused tests and styles.

Reuse PEAK3’s strongest existing assets:

- 82-0 spinner mechanics;
- canonical lineup evaluator;
- PEAK3 cards and visual tokens;
- existing radar/composite chart;
- modal, drawer, button, focus, and accessibility conventions;
- deterministic daily-seed utilities;
- current API idempotency/version patterns where sound.

Run narrow tests during development.

Run the consolidated validation set once near completion rather than repeatedly
running the full 35–40 minute CI matrix.

======================================================================
WHY THE CURRENT PRODUCT FAILED MANUAL ACCEPTANCE
======================================================================

----------------------------------------------------------------------
THREE-MAN WEAVE
----------------------------------------------------------------------

The deployed version technically contains many requested concepts but implements
them in the least usable form.

Observed failures:

1. Selecting a player opens a generic list-and-form dialog.

2. After selection, the primary flow relies on a small destination dropdown.

3. The action appears as visually weak text such as:
   “Draft Kevin Garnett”

4. “Back” or cancellation also resembles plain text.

5. The user cannot simply click an open roster slot to place the selected player.

6. The user cannot visually click, move, swap, or reassign existing roster cards.

7. “Fits after rearrangement” is merely a label. The interface does not show the
   required movement or make it directly actionable.

8. The right side of the selection dialog is often mostly empty despite roster
   placement being the most important interaction.

9. The supposed franchise/decade spinner is still effectively a static result
   banner rather than a reel or spin experience.

10. The active participant is indicated by tiny text and a small badge rather
    than the active roster being unmistakably highlighted.

11. Bot picks appear with little visible transition. The user cannot quickly see
    what the bot selected, where it was placed, or what changed.

12. The snake-order strip is tiny and visually detached from the game.

13. Bot quality is unacceptable. A bot passed over available 2010s Stephen Curry
    for Carl Landry.

14. A catastrophic superstar-versus-role-player miss is not an acceptable “mild
    mistake.” It makes the game noncompetitive and destroys trust.

15. The overall design is dark, flat, text-heavy, and visually static.

16. The result screen uses weak text-like Play Again and Back actions.

17. The result screen repeats large roster layouts without creating a satisfying
    first-viewport payoff.

18. Automated tests proved legal completion, but did not prove that the game is
    intuitive, competitive, visually clear, or enjoyable.

----------------------------------------------------------------------
THE $20 SHOWDOWN
----------------------------------------------------------------------

The deployed version contains actual correctness and synchronization failures.

Observed failures:

1. The user attempted to bid $2 on 2015–16 Stephen Curry.

2. The UI displayed:
   “That move was not accepted.”

3. The lot then advanced and awarded Stephen Curry to the bot for $1.

4. The error gave no useful explanation.

5. It did not state whether:
   - the timer expired;
   - the request arrived late;
   - the lot changed;
   - the state version was stale;
   - the bid amount was invalid;
   - the bot acted first;
   - a duplicate action was rejected;
   - polling replaced pending state.

6. The generic error remained visible across later lots.

7. Skip counters appeared inconsistent. A skip was used, but the display still
   appeared to show five skips remaining.

8. Players appeared in settled history without a sufficiently clear lot sequence,
   making it seem like random players were being inserted without the user seeing
   the auction.

9. The timer exists but is too easy to miss.

10. The timer does not clearly explain the consequence of expiration.

11. The game feels laggy.

12. The center and side panels are visually imbalanced.

13. The human and bot sides use asymmetrical information layouts.

14. Settled lots become a tall narrow scrolling column that compresses the actual
    opponent roster.

15. The score-reveal panel pushes current controls below the fold.

16. The user may need to scroll away from the active auction to see what happened.

17. The result screen again renders Play Again and Back to Arena as weak
    text-like actions.

18. The game can technically finish while the player does not trust whether their
    inputs were accepted.

----------------------------------------------------------------------
PEAK3 RANKINGS
----------------------------------------------------------------------

The Rankings page permanently reserves a large right-side panel for a selected
player and radar chart.

Observed product issue:

1. The page automatically selects a player.

2. The chart appears before the user asks to analyze anyone.

3. The ranking table loses useful width because the chart is always present.

4. The chart is visually disconnected from a complete player-analysis experience.

Intended behavior:

- The initial Rankings page should prioritize browsing and comparing rankings.
- No player analysis should be open by default.
- The chart should appear only after the user clicks a player.
- It should appear together with all other peak-analysis information for that
  player.

----------------------------------------------------------------------
THEME TOGGLE
----------------------------------------------------------------------

Observed defect:

- Dark → Light works with one click.
- Light → Dark often requires two clicks.

This is a real state-management or hydration defect.

Theme switching must be symmetrical and immediate in both directions.

----------------------------------------------------------------------
PEAK DUEL DAILY
----------------------------------------------------------------------

Observed defect:

- The higher-scoring or higher-ranked peak appears to consistently be placed on
  the left side.

This makes the game predictable and weakens the comparison.

The left/right orientation must be randomized fairly while preserving the shared
daily matchup.

======================================================================
CORE PRODUCTION STANDARD
======================================================================

Every changed experience must feel:

- immediate;
- clear;
- competitive;
- visually intentional;
- server-authoritative;
- deterministic where required;
- resilient to ordinary latency;
- understandable without reading documentation.

At every decision point, the user must know:

1. whose turn it is;
2. how much time remains;
3. what actions are legal;
4. what will happen on timeout;
5. whether their action is being submitted;
6. whether the server accepted it;
7. what changed;
8. what happens next.

No hidden state transitions.

No generic error messages.

No primary action that looks like plain text.

No interaction that technically exists but is visually undiscoverable.

======================================================================
PHASE 0 — EVIDENCE-FIRST ROOT-CAUSE DIAGNOSIS
======================================================================

Before redesigning, reproduce the deployed failures.

----------------------------------------------------------------------
$20 SHOWDOWN ACTION DIAGNOSIS
----------------------------------------------------------------------

Instrument and reproduce:

- opening an unopened lot;
- using a market skip;
- raising a live bid;
- acting close to a deadline;
- rapid duplicate clicks;
- slow network responses;
- polling during an in-flight mutation;
- a bot action racing a human action;
- lot settlement;
- transition to the next lot;
- reconnecting after one or more unseen lots.

For every mutating action capture:

- match ID;
- lot number;
- market phase;
- active seat;
- current standing bid;
- expected state version;
- submitted state version;
- action ID/idempotency key;
- client submission timestamp;
- server receipt timestamp;
- deadline;
- accepted or rejected;
- exact rejection code;
- exact rejection reason;
- returned state version;
- next active seat;
- next deadline.

Determine exactly why a human `$2` Curry bid could be rejected while the bot
received Curry for `$1`.

Prove or rule out:

- deadline expiration before server receipt;
- client/server timer drift;
- stale version;
- stale lot number;
- stale standing bid;
- bot action winning a race;
- duplicate action;
- out-of-order polling response;
- optimistic state being overwritten;
- control remaining active after turn changed;
- request sent with the wrong actor;
- another precise state-machine failure.

Do not guess.

----------------------------------------------------------------------
SHOWDOWN SKIP DIAGNOSIS
----------------------------------------------------------------------

Determine exactly why the displayed skip count could remain unchanged after the
user believed a skip was used.

Prove whether:

- the action was rejected;
- the counter was stale;
- the counter updated only on another branch;
- polling restored an older value;
- the user actually performed a live-auction pass rather than a market skip;
- the UI displayed the wrong participant’s counter;
- another precise cause exists.

----------------------------------------------------------------------
SHOWDOWN HIDDEN-ADVANCEMENT DIAGNOSIS
----------------------------------------------------------------------

Determine why settled lots appeared without a readable user-facing sequence.

Inspect:

- lot reveal timing;
- bot action timing;
- polling cadence;
- score-reveal timing;
- auto-timeout behavior;
- next-lot creation;
- UI transition state;
- visibility of auction feed;
- reconnect behavior.

----------------------------------------------------------------------
THREE-MAN WEAVE DIAGNOSIS
----------------------------------------------------------------------

Reproduce:

- candidate selection;
- direct placement attempt;
- rearrangement-required candidate;
- existing-player movement;
- bot selection quality;
- bot pick visibility;
- spinner sequence;
- active-seat indication;
- result transition.

----------------------------------------------------------------------
THEME DIAGNOSIS
----------------------------------------------------------------------

Reproduce the Light → Dark double-click defect before changing code.

Capture:

- current root document theme;
- current React state;
- current persisted preference;
- system preference;
- handler invocation count;
- event count;
- effect order;
- localStorage/cookie writes;
- hydration state;
- whether the button node is replaced;
- whether another effect reverts the first click;
- whether two theme sources conflict.

----------------------------------------------------------------------
PEAK DUEL DAILY DIAGNOSIS
----------------------------------------------------------------------

Inspect how daily matchup order is created.

Determine whether the current implementation:

- sorts stronger player first;
- preserves source order that correlates with score;
- reverses only under a narrow condition;
- randomizes matchup selection but not orientation;
- accidentally re-sorts after orientation;
- uses an unstable client shuffle;
- has another systematic left-side bias.

======================================================================
PART 1 — SHARED AUTHORITATIVE ACTION CONTRACT
======================================================================

Use a consistent contract for every mutable Arena action.

Every action must include:

- match ID;
- actor seat;
- action type;
- action payload;
- expected state version;
- unique action ID/idempotency key.

The server must:

1. validate authentication/seat ownership;
2. validate turn ownership;
3. validate state version;
4. validate lot/round identity;
5. validate deadline;
6. validate action legality;
7. apply the mutation atomically;
8. increment state version exactly once;
9. return the authoritative resulting state;
10. return an explicit action receipt.

Success response must include:

- accepted=true;
- action ID;
- action type;
- human-readable result;
- authoritative state;
- new state version;
- next actor;
- next deadline.

Rejected response must include a stable contextual code, such as:

- STALE_STATE
- WRONG_TURN
- LOT_CLOSED
- DEADLINE_EXPIRED
- BID_TOO_LOW
- BUDGET_RESERVE
- ILLEGAL_POSITION
- DUPLICATE_ACTION
- MATCH_COMPLETE

The client must:

- disable conflicting controls during an in-flight action;
- show a clear pending state;
- prevent duplicate submissions;
- reconcile from the mutation response;
- never advance solely from optimistic state;
- never allow polling to overwrite a newer version;
- ignore out-of-order states;
- retain only the highest authoritative state version.

On a stale response:

- load the latest state immediately;
- explain what changed;
- show the next legal action;
- do not leave a permanent generic banner.

Examples:

“Your $2 bid arrived after this lot closed. Stephen Curry was sold to Floor
General for $1.”

“The standing bid changed before your action arrived. It is now $4. Choose a
legal raise or pass.”

“The timer expired before your bid reached the server. Your market skip was used;
4 remain.”

Never display only:

“That move was not accepted.”

Errors must clear when:

- the authoritative state changes;
- a new lot/round begins;
- the user completes another action;
- the user dismisses the message.

======================================================================
PART 2 — SERVER-AUTHORITATIVE TIME
======================================================================

All timers must use server-authoritative deadlines.

Return:

- server current timestamp;
- decision deadline;
- action grace rules if any.

The client derives a local countdown using a measured server offset and a
monotonic timer.

Do not independently create a client deadline.

Use a dedicated timer component so the full game tree does not rerender every
second.

HUMAN BOT-PRACTICE DEFAULT

Use 20 seconds per human decision unless an existing validated product setting
requires another duration.

Clearly display the selected duration before match start.

TIMER PRESENTATION

- large number;
- visual progress;
- attached to the active participant;
- visible near controls;
- clear under-5-second urgency;
- readable at common desktop and mobile sizes;
- accessible threshold announcements at 10, 5, and expiration;
- do not announce every second.

======================================================================
PART 3 — THREE-MAN WEAVE DIRECT PLAYER PLACEMENT
======================================================================

Remove dropdown-first drafting.

When the user selects a candidate:

- strongly highlight the selected candidate;
- highlight every legal roster destination;
- dim illegal destinations;
- preview the resulting roster;
- show any required movement;
- let the user click the destination directly.

Legal targets:

- PG
- SG
- SF
- PF
- C
- Bench

Example:

The user selects Kevin Garnett.

The interface highlights:

- PF
- C
- Bench

The user clicks PF.

The player card visibly stages at PF.

PRIMARY ACTION

Use a real PEAK3 primary button:

“Draft Kevin Garnett at PF”

Requirements:

- semantic button;
- substantial size;
- yellow primary treatment;
- clear hover;
- pressed state;
- loading state;
- disabled state;
- visible focus;
- proper pointer cursor.

SECONDARY ACTION

Use a real secondary button:

“Cancel selection”

Never use visually unstyled text for a primary game action.

A compact destination select may exist as an accessible fallback, but must not be
the principal interaction.

======================================================================
PART 4 — THREE-MAN WEAVE ROSTER MOVEMENT
======================================================================

Users must be able to rearrange their roster at any legal time.

CLICK-TO-MOVE

1. Click an existing roster card.
2. Highlight legal destination slots.
3. Click a destination.
4. Preview the arrangement.
5. Confirm or cancel.

ACCESSIBLE MOVE MENU

Each occupied card must also expose an accessible Move action listing legal
destinations.

DRAG-AND-DROP

Optional progressive enhancement only.

It cannot be the sole method.

Requirements:

- cards visibly appear interactive;
- hover and selected states;
- keyboard support;
- server-authoritative validation;
- no duplicate player;
- no illegal slot;
- no stale mutation;
- smooth movement;
- clear rejection reason.

======================================================================
PART 5 — ACTIONABLE REARRANGEMENT PREVIEW
======================================================================

“Fits after rearrangement” cannot remain a passive label.

When a candidate needs rearrangement:

- show the exact proposed sequence;
- highlight each affected card and slot;
- show the final roster before confirmation.

Example:

Tyrese Haliburton → PG  
Baron Davis: PG → Bench

When multiple legal arrangements exist:

- present them as clear alternatives;
- let the user choose.

Drafting plus every required movement must commit atomically.

Server validation must prevent:

- partial movement;
- duplicates;
- illegal final roster;
- identity-lock violation;
- stale state;
- impossible completion.

======================================================================
PART 6 — THREE-MAN WEAVE DRAFT-ROOM REDESIGN
======================================================================

The pick overlay should feel like a purpose-built basketball draft room.

DESKTOP TOP BAR

- Round X of 6;
- Pick X of 18;
- rolled franchise;
- rolled decade;
- active seat;
- large timer;
- readable compact snake timeline.

LEFT PANEL

- search;
- all eligible undrafted players;
- strong candidate cards;
- player name;
- franchise seasons;
- natural positions;
- fit state;
- no pre-pick exact PEAK3 score;
- selected-card treatment;
- clear scrolling boundary;
- optional position filters.

RIGHT PANEL

- large interactive human roster;
- legal slot targets;
- staged candidate;
- rearrangement preview;
- primary Draft button;
- Cancel button;
- no large unused empty area.

The primary action must remain in view at common laptop heights.

MOBILE

Use a two-step flow:

1. Select candidate.
2. Place candidate.

Requirements:

- persistent timer;
- clear Back action;
- no compressed side-by-side columns;
- no hidden confirmation;
- no horizontal trap.

======================================================================
PART 7 — THREE-MAN WEAVE REAL SPINNER
======================================================================

The current static banner is not a spinner.

Reuse the strongest mechanics from 82-0.

Required sequence:

1. Three rosters remain visible.
2. Franchise reel cycles through multiple teams.
3. Decade reel cycles through multiple decades.
4. Motion visibly decelerates.
5. Server-authoritative result lands.
6. Result locks with visual emphasis.
7. Active roster illuminates.
8. Decision timer begins only after landing.

Use:

- translated reel movement;
- easing;
- motion blur;
- deceleration;
- landing pulse/bounce;
- strong franchise/decade identity;
- reduced-motion fallback.

Do not implement a static text swap disguised by a fade.

======================================================================
PART 8 — THREE-MAN WEAVE ACTIVE TURN
======================================================================

Exactly one roster must be unmistakably active.

ACTIVE ROSTER TREATMENT

- bright border;
- broadcast-style glow;
- elevated participant header;
- timer attached to that roster;
- active snake token;
- recent-action animation;
- inactive rosters slightly dimmed but readable.

Top status should clearly read:

“Your pick”

or:

“The Enforcer is selecting”

Do not rely on tiny corner text.

======================================================================
PART 9 — THREE-MAN WEAVE BOT PICK REVEAL
======================================================================

Every bot pick must be visible.

Sequence:

1. Bot roster becomes active.
2. “Scouting” or thinking animation begins.
3. Wait a seeded 1.2–3.5 seconds.
4. Show the chosen player in a central reveal tray.
5. Display:
   - player name;
   - eligible franchise season;
   - selected position.
6. Animate card into the roster.
7. Reveal the PEAK3 score only after placement.
8. Update the pick feed.
9. Move active state to the next seat.

Do not allow bot picks to appear silently.

======================================================================
PART 10 — THREE-MAN WEAVE BOT QUALITY
======================================================================

The current bot randomness is too destructive.

A bot may not pass over peak Stephen Curry for Carl Landry unless Curry would
make legal completion impossible.

Evaluate every legal completion-safe candidate using:

- franchise-specific card quality;
- marginal authoritative lineup-quality gain;
- positional need;
- positional flexibility;
- scarcity;
- starter versus bench value;
- future roster completion.

Target behavior:

- 90% best legal choice;
- 8% second-best or strategically near-equivalent;
- 2% mild defensible deviation.

DOMINANCE GUARD

When the top candidate exceeds the next viable choice by a major threshold:

- always select the dominant candidate;
- do not apply randomness.

A mild mistake may not create a catastrophic quality gap.

Add explicit regressions for:

- 2010s Stephen Curry versus Carl Landry;
- prime LeBron versus replacement-level forwards;
- prime Jordan versus replacement-level guards;
- prime Kareem versus replacement-level centers;
- major gap with a legitimate completion constraint.

Run at least 2,000 deterministic bot-pick simulations.

Report:

- optimal selection rate;
- near-optimal selection rate;
- mean regret;
- p95 regret;
- maximum regret;
- dominance violations;
- illegal picks;
- completion failures.

Acceptance:

- zero illegal picks;
- zero completion failures;
- zero catastrophic dominance violations.

======================================================================
PART 11 — THREE-MAN WEAVE SNAKE ORDER
======================================================================

Replace tiny disconnected numbered squares with a readable draft timeline.

Show:

- round groups;
- participant name or initial;
- completed picks;
- current pick;
- next pick;
- upcoming direction reversal;
- animated active marker.

The user should understand the order without leaning toward the screen.

======================================================================
PART 12 — THREE-MAN WEAVE RESULT EXPERIENCE
======================================================================

The first result viewport must feel like the payoff.

Show:

- winner;
- second place;
- third place;
- celebration;
- winning roster;
- final lineup-quality score;
- decisive pick;
- best value;
- positional-fit summary.

PRIMARY BUTTON

“Play Again”

SECONDARY BUTTON

“Back to Arena”

Both must visibly look like buttons.

Do not immediately repeat three giant interactive roster boards.

Use compact placement cards and expandable detailed receipts.

Victory treatment:

- confetti or arena particles;
- winner glow;
- placement animation;
- reduced-motion fallback.

======================================================================
PART 13 — $20 SHOWDOWN RULES
======================================================================

Preserve these authoritative rules.

- Two participants.
- $20 each.
- PG, SG, SF, PF, C.
- Random opener for lot 1.
- Opener alternates by lot.
- Whole-dollar bids.
- Minimum open: $1.
- Minimum raise: $1.
- Preserve $1 for each future empty slot.
- PEAK3 score hidden until settlement.
- Winner = sum of five career-best 1Y PEAK3 scores.

NO STANDING BID

- opener may open or use a market skip;
- after opener skips, opponent may open or skip;
- both skip means unsold.

LIVE BID

- alternate raises;
- pass concedes;
- high bidder wins and pays.

MARKET SKIPS

- five per participant;
- consume one only for a voluntary skip on a legal unopened candidate while
  roster is incomplete;
- live-auction concession consumes none;
- illegal-fit auto-pass consumes none;
- counter updates only after authoritative acceptance.

STANDARD MARKET

- 24 lots.

CLOSEOUT MARKET

- bounded completion phase;
- preserve randomness;
- no obvious exact-position vending machine;
- maximum total lots: 36;
- guaranteed legal completion;
- no infinite match.

======================================================================
PART 14 — $20 SHOWDOWN ACTION RELIABILITY
======================================================================

Fix the Curry failure at the state-machine level.

When the user presses “Bid $2”:

1. Disable Bid and Pass immediately.
2. Show:
   “Submitting $2 bid…”
3. Submit:
   - match ID;
   - lot number;
   - current bid;
   - actor seat;
   - expected state version;
   - unique action ID.
4. Server accepts or returns a precise rejection.
5. Bot cannot act from the same stale state.
6. Polling cannot overwrite the pending action.
7. Lot cannot advance until the result is known.

ACCEPTED BID

- animate human bid toward center;
- standing bid becomes $2;
- bot becomes active;
- next deadline starts;
- auction feed records the bid.

REJECTED BID

- explain why;
- refresh to authoritative state;
- do not leave the user with a stale control;
- do not display a generic banner.

Add deterministic tests for:

- bid 500ms before deadline;
- bid 50ms before deadline;
- bid at deadline;
- delayed response;
- duplicate click;
- bot race;
- polling race;
- stale version;
- stale lot;
- stale standing bid;
- out-of-order state response.

No accepted human bid may disappear.

======================================================================
PART 15 — $20 SHOWDOWN SKIP CONSISTENCY
======================================================================

When a market skip is accepted:

- animate 5 → 4;
- update the authoritative counter immediately from the response;
- add:
  “You skipped Malcolm Brogdon. 4 market skips remain.”
- show the candidate as unsold or move turn to the opponent according to the
  rules.

If the action is rejected:

- do not decrement;
- explain the reason.

Never show the user five remaining after an accepted skip.

Distinguish clearly between:

- Market Skip — costs one skip
- Pass — concedes a live auction and costs no skip
- Automatic illegal-fit pass — costs no skip
- Timeout action

Do not use the same visual label for different consequences.

======================================================================
PART 16 — $20 SHOWDOWN TIMER AND TIMEOUTS
======================================================================

Make the timer prominent.

Show:

YOUR TURN  
12 seconds  
Timeout will use 1 market skip.

During a live bid:

YOUR TURN  
8 seconds  
Timeout concedes this auction.

TIMEOUT — NO STANDING BID

If legal fit and skips remain:

- consume one skip;
- display:
  “Time expired — market skip used. 4 remain.”

If legal fit and zero skips:

- auto-open at the minimum legal bid;
- display:
  “Time expired — automatic $1 opening bid.”

If no legal fit:

- automatic free pass;
- display:
  “Time expired — candidate could not fit. No skip used.”

TIMEOUT — LIVE BID

- concede the auction;
- no skip consumed;
- display:
  “Time expired — you passed. Floor General wins Stephen Curry for $4.”

No silent timeout.

======================================================================
PART 17 — $20 SHOWDOWN LOT PRESENTATION
======================================================================

Every lot must have a readable lifecycle.

1. Candidate enters center stage.
2. Opener becomes clearly active.
3. Timer begins.
4. Accepted actions appear in a compact feed.
5. On settlement, display:
   - winner or unsold;
   - final price;
   - revealed score;
   - destination slot;
   - updated budget;
   - updated skips where relevant.
6. Hold for approximately 1.2–2 seconds.
7. Animate card into roster or unsold tray.
8. Only then begin the next lot.

No hidden advancement.

No settled player may appear without:

- a visible lot sequence; or
- a reconnect summary.

RECONNECT SUMMARY

When the user misses state transitions:

“While you were away”

Show each missed lot:

- player;
- bids;
- winner;
- price;
- timeout or skip outcome.

======================================================================
PART 18 — $20 SHOWDOWN BOT POLICY
======================================================================

The bot should be competitive but imperfect.

Use a seeded noisy valuation based on:

- coarse player-quality estimate;
- marginal roster improvement;
- legal positions;
- redundancy;
- positional scarcity;
- remaining budget;
- remaining empty slots;
- reserve requirement;
- remaining market skips;
- current market phase;
- expected future opportunity.

The bot must not:

- inspect future candidates;
- react to an unaccepted human action;
- bid from stale state;
- overpay irrationally for redundant weak players;
- pass on elite value for no strategic reason.

Valid:

- opening $1 on Curry;
- exiting when the price exceeds its valuation;
- occasional mild overpay or underbid.

Impossible:

- receiving Curry for $1 after an accepted human $2 bid.

Run at least 2,000 deterministic full bot-versus-bot matches.

Report:

- completion rate;
- maximum lots;
- average price by tier;
- spend distribution;
- remaining budget;
- market skips used;
- final roster-score distribution;
- illegal actions;
- timeout frequency;
- stale-version conflicts;
- extreme overpayments.

======================================================================
PART 19 — $20 SHOWDOWN SCREEN REDESIGN
======================================================================

Balance both sides.

DESKTOP THREE-COLUMN STAGE

LEFT — HUMAN

- participant name;
- budget;
- skips;
- five roster slots;
- active treatment;
- recent purchase highlight.

CENTER — AUCTION

- lot number;
- market phase;
- candidate;
- positions;
- timer;
- standing bid;
- primary controls;
- compact action feed;
- pending state.

RIGHT — BOT

- participant name;
- budget;
- skips;
- five roster slots;
- active treatment;
- recent purchase highlight.

Use symmetrical side panels.

Do not allocate structurally different information to the two participants.

SETTLED LOTS

Move history into:

- compact bottom tray;
- collapsible drawer;
- or nonintrusive overlay/drawer.

Do not allow a tall history list to compress the opponent roster.

SCORE REVEAL

Use a temporary center-stage reveal.

Do not append a giant chart under the active controls.

A “View breakdown” action may open the radar chart after settlement.

CONTROLS

Primary:

- Open at $1
- Bid $N

Secondary:

- Market Skip — 1 of 5
- Pass

All controls require:

- visible affordance;
- loading state;
- disabled state;
- focus;
- hover;
- pressed state;
- explicit consequence.

======================================================================
PART 20 — $20 SHOWDOWN RESULT EXPERIENCE
======================================================================

Replace the auction with a dedicated result state.

First viewport:

- winner;
- score difference;
- both rosters;
- total spent;
- money remaining;
- best bargain;
- largest overpay;
- decisive lot;
- victory treatment;
- Play Again button;
- Back to Arena button.

Use a collapsible Full Receipt below.

No plain text action links.

No large empty black region.

======================================================================
PART 21 — PEAK3 RANKINGS INITIAL STATE
======================================================================

The Rankings page should initially be a full-width browsing experience.

On load:

- no player analysis open;
- no player selected by default;
- no radar chart visible;
- no empty reserved chart column;
- table uses the available width;
- preserve:
  - Peak Windows / Single Seasons;
  - duration filters;
  - search;
  - sortable columns;
  - component legend.

Rows must visibly appear interactive:

- hover;
- focus;
- pointer cursor;
- pressed state;
- optional “View analysis” affordance.

Do not automatically select Michael Jordan, LeBron James, or anyone else.

======================================================================
PART 22 — RANKINGS PLAYER ANALYSIS
======================================================================

Only after the user selects a row should a complete player-analysis experience
open.

Include:

- player name;
- rank;
- PEAK3 total;
- selected duration;
- exact season/window;
- team;
- all five PEAK3 components;
- completeness;
- radar/composite chart;
- exact accessible values;
- component contribution breakdown;
- concise explanation;
- source window rows or existing receipt data;
- previous/next ranked player where appropriate;
- clear close/back action.

The chart must appear only inside this analysis.

DESKTOP

Use one polished pattern:

- large side drawer;
- modal analysis workspace;
- expandable analysis region;
- dedicated analysis route.

Requirements:

- no permanent right column;
- rankings scroll preserved;
- focus returns to originating row;
- filter/search state preserved;
- chart labels do not clip;
- no unused empty space.

MOBILE

Use a full-width sheet or screen.

Do not compress the table and chart side by side.

INTERACTION

- click opens;
- Enter opens;
- Space opens;
- Escape closes;
- focus moves into analysis;
- close returns focus;
- browser Back works if URL state is used.

CHART

- render only when analysis opens;
- lazy-load where appropriate;
- no heavy dependency;
- all five PEAK3 components plus completeness where supported;
- exact accessible table;
- Light/Dark support;
- 200% zoom;
- reduced motion;
- no clipping.

======================================================================
PART 23 — THEME TOGGLE ROOT-CAUSE FIX
======================================================================

Dark → Light and Light → Dark must both work with one click.

Reproduce the current failure across:

- fresh load;
- repeated toggling;
- route transition;
- reload;
- slow hydration;
- keyboard Enter;
- keyboard Space;
- mobile;
- Rankings analysis open;
- Weave modal open;
- Showdown active;
- result screen.

Determine the exact root cause.

Possible causes to prove or rule out:

- server cookie versus localStorage conflict;
- system theme overriding explicit theme;
- stale React state;
- effect reverting the first change;
- hydration replacement;
- duplicate nested buttons;
- first click only focusing another control;
- old theme written one render late;
- competing providers;
- event propagation conflict.

DEFINITIVE CONTRACT

Use one authoritative preference:

- light;
- dark;
- system only if intentionally supported.

When the user explicitly chooses Light or Dark:

- update root document theme immediately;
- update control state immediately;
- persist consistently;
- explicit choice overrides system preference;
- route transitions preserve it;
- reload preserves it;
- server render and hydration agree;
- no flash;
- no second click.

The control must be:

- one semantic button;
- accessible name;
- correct pressed/current-state semantics;
- pointer and keyboard operable;
- no nested interaction;
- visible focus.

Do not fix using:

- retries;
- delayed second updates;
- synthetic double-click;
- sleeps;
- CI-only handling.

======================================================================
PART 24 — PEAK DUEL DAILY LEFT/RIGHT FAIRNESS
======================================================================

Peak Duel Daily must not systematically place the stronger peak on the left.

Preserve:

- the shared daily matchup;
- daily determinism;
- the same matchup and orientation for all users on the same daily seed;
- stable orientation across refreshes during that day.

Change only presentation order.

RULE

After selecting the two daily candidates, determine left/right orientation from a
deterministic unbiased bit derived from the daily seed and matchup identity.

Do not:

- sort by PEAK3 score after orientation;
- sort by rank;
- always place the “winner” left;
- randomize per page load;
- randomize differently for different users;
- leak the result through layout.

Across many daily seeds, orientation must be approximately 50/50:

- stronger player left;
- stronger player right.

TIES

For exact ties, orientation is still determined by the daily orientation bit.

AUDIT

Search for any later transform that reorders by:

- score;
- player ID;
- rank;
- alphabetical order;
- winner status.

Ensure presentation preserves the chosen orientation through:

- API response;
- frontend state;
- result reveal;
- share links;
- replay/history if applicable.

TESTS

- same daily seed produces same orientation;
- same date for all users produces same orientation;
- refresh does not change sides;
- next dates may change orientation;
- at least 1,000 seeds produce an approximately balanced split;
- stronger player appears on both sides across the sample;
- no correlation with score magnitude;
- reveal does not reorder the cards;
- shared/replayed result preserves orientation.

Acceptance tolerance over 1,000 seeds:

- stronger-left ratio between 45% and 55%.

======================================================================
PART 25 — PERFORMANCE AND LAG
======================================================================

Profile both Arena games.

Inspect:

- full-page rerenders;
- timer-triggered tree rerenders;
- candidate-list rerenders;
- repeated legal-arrangement computation;
- excessive polling;
- duplicate requests;
- out-of-order updates;
- chart rendering during hidden states;
- large hidden receipts;
- layout thrashing;
- animation jank.

Requirements:

- isolate timers;
- memoize candidate lists;
- compute legal arrangements only when relevant inputs change;
- cancel obsolete requests;
- ignore older state versions;
- avoid polling faster than needed;
- do not retain stale subscriptions;
- do not render hidden heavy analysis.

Measure and report:

- action-to-visible-pending latency;
- local action-to-authoritative-response latency;
- candidate-list render count during a 20-second timer;
- largest rerender corrected;
- browser performance trace for one full match of each mode;
- theme transition responsiveness;
- Rankings chart load cost only after analysis opens.

======================================================================
PART 26 — SHARED VISUAL QUALITY
======================================================================

Use PEAK3’s visual identity, but raise the standard materially.

The product should feel like a basketball broadcast/game experience.

Use:

- strong participant identity;
- active lighting;
- court-inspired layout;
- readable hierarchy;
- larger meaningful typography;
- fewer tiny labels;
- clear primary actions;
- card movement;
- restrained but satisfying animation;
- less unused black space;
- consistent buttons;
- consistent focus rings;
- consistent modal/drawer behavior;
- clear Light and Dark surfaces.

Do not solve poor design by adding more explanatory paragraphs.

Show state visually.

Do not add a heavy UI library.

Support:

- Dark;
- Light;
- reduced motion;
- keyboard;
- 390px mobile;
- short-height desktop;
- 200% zoom;
- no horizontal traps;
- visible focus;
- no serious or critical axe violations.

======================================================================
PART 27 — AUTOMATED TEST REQUIREMENTS
======================================================================

----------------------------------------------------------------------
SHARED ARENA STATE
----------------------------------------------------------------------

- expected-version enforcement;
- idempotent duplicate actions;
- precise rejection codes;
- old polling response ignored;
- pending action not overwritten;
- state versions monotonic;
- error clears on authoritative transition;
- deadline based on server time;
- timeout outcome deterministic.

----------------------------------------------------------------------
THREE-MAN WEAVE
----------------------------------------------------------------------

- candidate card selectable;
- legal slot click works;
- illegal slot disabled;
- Cancel clears state;
- direct occupied-card movement;
- accessible Move menu;
- rearrangement preview;
- atomic rearrangement;
- active roster exactly one;
- spinner has visible intermediate reel states;
- timer starts after landing;
- bot thinking visible;
- bot reveal visible;
- Curry-versus-Landry regression;
- dominance guards;
- 2,000-pick simulation;
- no illegal pick;
- no completion failure;
- real result buttons;
- celebration state.

----------------------------------------------------------------------
$20 SHOWDOWN
----------------------------------------------------------------------

- accepted bid persists;
- Curry `$2` regression;
- deadline race;
- bot/human race;
- polling race;
- duplicate click;
- stale-state recovery;
- precise rejection copy;
- accepted skip decrements;
- rejected skip does not decrement;
- live pass costs no skip;
- timeout skip;
- timeout auto-open;
- timeout concession;
- lot reveal before next lot;
- no hidden settlement;
- reconnect missed-lot summary;
- standard-to-closeout transition;
- total lot cap;
- 2,000-match simulation;
- dedicated result screen;
- real result buttons.

----------------------------------------------------------------------
RANKINGS
----------------------------------------------------------------------

- no default analysis;
- no chart on initial load;
- table uses full available width;
- click opens analysis;
- Enter opens;
- Space opens;
- correct selected player;
- correct rank/score/window/team/components;
- chart appears only after opening;
- accessible values match chart;
- Escape closes;
- focus returns;
- scroll position preserved;
- filters preserved;
- mobile analysis;
- Light/Dark;
- 200% zoom;
- axe closed/open.

----------------------------------------------------------------------
THEME
----------------------------------------------------------------------

- Dark → Light in one click;
- Light → Dark in one click;
- twenty alternating cycles;
- root theme correct after each action;
- persisted state;
- route persistence;
- reload persistence;
- explicit preference overrides system;
- pointer;
- Enter;
- Space;
- slow hydration;
- Rankings analysis open;
- Weave overlay open;
- Showdown active;
- result state;
- no first-click dead state;
- no theme flash;
- axe in both themes.

----------------------------------------------------------------------
PEAK DUEL DAILY
----------------------------------------------------------------------

- deterministic orientation;
- stable refresh;
- same orientation for all users on the day;
- stronger player can appear left or right;
- 1,000-seed balance between 45/55;
- no score-based reordering;
- result reveal preserves orientation;
- share/replay preserves orientation.

----------------------------------------------------------------------
BROWSER
----------------------------------------------------------------------

Run complete browser flows with:

- Chromium desktop;
- mobile Chrome;
- zero retries;
- one full human-versus-bots game per Arena mode;
- slow network;
- delayed mutation response;
- keyboard-only interaction;
- reduced motion;
- Light and Dark;
- axe during active, modal, error, analysis, and result states.

Do not use fixed sleeps.

Wait on real states and events.

======================================================================
PART 28 — MANDATORY MANUAL PRODUCT ACCEPTANCE
======================================================================

Automated tests are insufficient.

Play both Arena modes completely in a real browser.

Capture screenshots or short recordings.

----------------------------------------------------------------------
THREE-MAN WEAVE
----------------------------------------------------------------------

1. Spinner visibly moving.
2. Spinner landing.
3. Human draft room.
4. Candidate selected.
5. Legal slots highlighted.
6. Rearrangement preview.
7. Direct roster-card move.
8. Active bot turn.
9. Bot pick reveal.
10. All three rosters midgame.
11. Mobile placement.
12. Final result.

----------------------------------------------------------------------
$20 SHOWDOWN
----------------------------------------------------------------------

1. Unopened lot.
2. Human bid pending.
3. Accepted bid.
4. Bot thinking.
5. Raise exchange.
6. Accepted market skip and counter decrement.
7. Timeout consequence.
8. Sold reveal.
9. Unsold reveal.
10. Settled-history tray.
11. Closeout market.
12. Mobile auction.
13. Final result.

----------------------------------------------------------------------
RANKINGS
----------------------------------------------------------------------

1. Initial full-width rankings.
2. No default chart.
3. Row hover/focus.
4. Open analysis.
5. Chart with all player data.
6. Accessible exact values.
7. Close analysis.
8. Same scroll position.
9. Mobile analysis.
10. Light and Dark analysis.

----------------------------------------------------------------------
THEME
----------------------------------------------------------------------

Record one continuous sequence:

1. Dark → Light once.
2. Light → Dark once.
3. Repeat multiple times.
4. Change routes.
5. Toggle both ways.
6. Reload.
7. Confirm persistence.
8. Open a game overlay.
9. Toggle both ways.
10. Open Rankings analysis.
11. Toggle both ways.

----------------------------------------------------------------------
PEAK DUEL DAILY
----------------------------------------------------------------------

Review multiple deterministic daily seeds and confirm:

- stronger player appears on both sides;
- layout does not reveal the winner;
- orientation remains stable for the same seed.

Do not report completion if:

- any primary action resembles text;
- Weave still uses a dropdown as primary placement;
- roster cards cannot be moved directly;
- active seat is not immediately obvious;
- spinner remains static;
- bot pick is hard to follow;
- bots make catastrophic choices;
- an accepted Showdown action disappears;
- generic “move not accepted” remains;
- skip counters fail to reconcile;
- lots advance without clear explanation;
- auction controls fall below the fold;
- result actions look unfinished;
- Rankings chart appears before selection;
- theme requires two clicks even once;
- Peak Duel stronger peak remains systematically left.

======================================================================
PART 29 — FINAL VALIDATION
======================================================================

During development, run focused tests.

Near completion, run once:

1. focused Arena model tests;
2. focused Arena API tests;
3. action-race/state-version tests;
4. 2,000 Weave bot-pick simulations;
5. 2,000 Showdown simulation matches;
6. 1,000-seed Peak Duel orientation audit;
7. Rankings unit tests;
8. theme unit tests;
9. relevant frontend unit tests;
10. frontend typecheck;
11. lint;
12. production build;
13. focused desktop Playwright;
14. focused mobile Playwright;
15. targeted axe;
16. git diff --check;
17. generated/cache mutation check.

Review the complete diff.

Remove:

- diagnostics;
- local traces;
- temporary recordings;
- screenshots from tracked source unless deliberately stored in an ignored review
  directory;
- generated caches;
- accidental data changes;
- credentials.

======================================================================
PART 30 — COMPLETION STANDARD
======================================================================

The pass is complete only when all of the following are true.

THREE-MAN WEAVE

- direct candidate selection;
- direct slot placement;
- direct roster movement;
- actionable rearrangement;
- true spinner;
- unmistakable active participant;
- visible bot picks;
- competitive bots;
- readable snake order;
- polished result;
- real buttons.

$20 SHOWDOWN

- human actions cannot disappear;
- precise error reasons;
- authoritative skip counters;
- no hidden lot advancement;
- prominent timer;
- explicit timeout rules;
- balanced participant layout;
- settled history does not crush gameplay;
- no active controls pushed below fold;
- competitive bot;
- polished result;
- real buttons.

RANKINGS

- no default chart;
- no default player analysis;
- full-width browsing;
- chart only after user selects a player;
- chart integrated with complete peak analysis;
- focus, scroll, and filters preserved;
- accessible and responsive.

THEME

- exactly one click in both directions;
- no asymmetric behavior;
- no hydration race;
- no flash;
- persisted across routes and reloads.

PEAK DUEL DAILY

- shared daily matchup preserved;
- orientation stable per day;
- stronger peak appears left and right at balanced rates;
- no score-based side ordering.

Do not call the work complete based solely on green tests.

======================================================================
FINISHING INSTRUCTIONS
======================================================================

At completion:

1. Review the diff for unrelated changes.
2. Confirm no environment variables or migrations changed unexpectedly.
3. Confirm no generated canonical data was accidentally modified.
4. Commit all intended work.
5. Push:

   origin/fix/arena-games-production-rescue

6. Open a PR targeting main.
7. Do not merge automatically.

Final report must include:

- exact root cause of the rejected Curry bid;
- exact root cause of skip-count inconsistency;
- exact root cause of hidden lot advancement;
- exact shared state-contract correction;
- exact Three-Man Weave interaction redesign;
- exact Showdown auction redesign;
- exact Weave bot-policy correction;
- exact Showdown bot-policy correction;
- Weave simulation metrics;
- Showdown simulation metrics;
- performance measurements;
- exact Rankings behavior changed;
- chart lazy/render behavior;
- exact Light → Dark double-click root cause;
- final theme-state architecture;
- exact Peak Duel Daily left/right root cause;
- 1,000-seed orientation distribution;
- manual screenshots/recordings reviewed;
- main files changed;
- tests;
- accessibility;
- production build;
- commit hash;
- pushed branch;
- PR URL;
- any genuine remaining blocker.

Begin now.

Do not request intermediate approval unless blocked by:

- credentials;
- destructive database work;
- an irreducible contradiction in canonical data;
- an unavoidable migration requirement.


