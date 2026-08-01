# PEAK3 Organization, Navigation, Visual Polish, Run the Table UX, Spinner, and Rankings Sync
## One-pass Claude Code implementation brief

### Mission

Take the current uncommitted PEAK3 working tree after the RUN THE TABLE overnight implementation and complete one disciplined product-quality pass that makes the entire site easier to understand, easier to navigate, more visually polished, and more enjoyable to play—without weakening or replacing the verified game engines, scoring rules, APIs, persistence contracts, daily seeds, challenge links, rankings methodology, or existing modes.

This is not a redesign mockup and not a planning-only pass. Implement, integrate, test, browser-drive, inspect, and report the work in one pass.

The highest-level outcomes are:

1. A first-time visitor instantly understands what PEAK3 is and can launch any game without hunting through a long page.
2. The global navigation is beautiful, responsive, keyboard-accessible, and organizes all games under a clear nested **Play** menu.
3. The homepage has a strong game launcher and clear information hierarchy rather than an ambiguous CTA followed by another redundant start gate.
4. RUN THE TABLE is visually compelling, understandable without jargon, and teaches itself through a polished, dismissible, replayable guided tour.
5. The RUN THE TABLE Trade Desk and other node flows are unambiguous and free of visual state bugs such as unrelated cards remaining highlighted or raw `[object Object]` text appearing.
6. The 82–0 spinner feels like a real game event and its rerolls are meaningfully different—not exact or near-adjacent results disguised as a reroll.
7. The public rankings, API responses, generated artifacts, and game card pools are demonstrably synchronized with the current authoritative PEAK3 methodology and data release.
8. The complete site retains its existing functional correctness, test coverage, accessibility, determinism, and performance discipline.

Do not commit, push, open a PR, merge, stash, or modify repository history. Leave the complete diff unstaged for review.

---

# 1. Read this before editing

## Preserve the current work

The working tree contains the newly implemented RUN THE TABLE game and may include other pre-existing uncommitted changes. Preserve all existing work. Begin with:

```bash
git status --short
git diff --stat
git diff --check
git log -1 --oneline
```

Record the exact baseline in the final report.

Do not reset, clean, checkout over, or broadly format files you do not own.

## Do not change the canonical methodology casually

The user suspects the visible rankings may be stale. Treat this as a synchronization and provenance investigation, not permission to invent new weights or rewrite PEAK3 methodology.

The authoritative Python model and its current versioned outputs remain the source of truth. If the UI is stale, regenerate or reconnect it using the repository’s existing supported pipeline. If the model itself has changed in the current branch but artifacts were not regenerated, propagate that change through the official pipeline. If no mismatch exists, prove that with hashes, top-N comparisons, version IDs, and tests rather than changing scores unnecessarily.

## Protect the shipped game engines

The following must remain server-authoritative and deterministic:

- RUN THE TABLE state transitions, seed behavior, card offers, node graph, credits, lives, systems, battles, challenges, daily state, and receipts.
- 82–0 candidate eligibility, game state, scoring, reroll budgets, and finalized results.
- Daily Grid, Peak Duel, ranked, leaderboard, challenge, and save/resume behavior.
- Any canonical score or component value.

Visual animation must represent the already-selected authoritative result. Animation must never become the source of randomness or scoring.

---

# 2. Product problems visible in the supplied screenshots

Treat these as explicit bugs or UX failures to resolve.

## Navigation and homepage

- The header currently contains flat links such as Play, Daily, Rankings, Methodology, and About. Clicking **Play** opens a long catalog page, forcing the user to scroll to discover all game modes.
- The homepage hero uses a large “Start a Run” CTA, but clicking it leads to another explanatory start gate with another “Start a Run” button. This feels like a redundant funnel and makes the first CTA ambiguous.
- The “Ways to play” catalog is useful, but it should not be the only way to find a specific game.
- The current navigation is functional but visually plain and does not communicate the breadth of PEAK3.
- The oversized homepage hero consumes most of the first viewport while providing little interactive preview or immediate game choice.

## RUN THE TABLE onboarding and clarity

- The game begins with several unfamiliar concepts at once: Systems, credits, lives, acts, node types, five component lanes, starter roles, bench weight, and boss rules.
- “Film Room,” “Rest / Bank,” “Trade Desk,” and “Draft Room” are not sufficiently differentiated for a first-time player.
- System descriptions use dense percentile and component language before the player understands the game.
- The left map, center action area, right front-office rail, roster, Systems panel, and lane profile all compete for attention.
- The page is visually correct but flat: many dark rectangular panels with similar weight, little hierarchy, minimal transition energy, and few moments of delight.
- The result and battle views need stronger visual storytelling and clearer “what just happened?” feedback.

## Trade Desk defects

The supplied trade screenshot demonstrates multiple concrete issues:

- An incoming Steve Francis card is outlined/red-highlighted even though the user is attempting a Dirk Nowitzki-for-Domantas Sabonis transaction.
- Selection ownership is unclear between the incoming and outgoing columns.
- Raw `[object Object]` strings are rendered in the UI.
- Some ineligible cards remain visually actionable instead of being clearly disabled with a concise reason.
- The trade is eventually possible, but the path is hard to understand.
- The user cannot easily see the final transaction, net credits, role legality, and roster change before committing.

Fix the underlying state model and rendering—not merely the colors.

## 82–0 spinner

- Team and year are displayed as static result cards rather than a satisfying, legible spin/reveal.
- A year reroll can produce the immediately adjacent season—for example 1991–92 to 1992–93—which technically may be random but feels like the reroll did almost nothing.
- The existing experience lacks anticipation, readable motion, and a clear separation between authoritative result selection and visual animation.
- The spinner should be fun, creative, and polished, but it must remain deterministic, accessible, testable, and fast.

## Rankings

- The public rankings screen may still be reading stale generated assets or may not visibly identify the active model/data release.
- The UI must not silently mix current rankings with old component columns, game pools, or cached artifacts.
- The 1Y / 3Y / 5Y terminology and “single season” versus “1-year peak window” presentation must be internally consistent.

---

# 3. Research references and implementation principles

Use these references as behavior and engineering inspiration. Do not copy another site’s visual identity or code.

## Competitive interaction reference

- First Down Studio, Build a 17–0 Team:
  https://www.firstdown.studio/build-a-17-0-team

Study its strengths:
- one-sentence comprehension;
- visible round progress;
- an always-visible roster;
- immediate feedback after selection;
- simple but differentiated modes;
- strong final-result payoff;
- easy replay;
- compact, legible controls.

Do not clone its layout, branding, game rules, exact components, or styling. PEAK3 should remain an “Arena Archive”: premium basketball editorial, scouting room, statistical instrument, and competitive game.

## Claude Code execution references

- Best practices:
  https://code.claude.com/docs/en/best-practices
- Custom subagents:
  https://code.claude.com/docs/en/sub-agents
- Parallel worktrees:
  https://code.claude.com/docs/en/worktrees
- Agent teams:
  https://code.claude.com/docs/en/agent-teams
- Common workflows:
  https://code.claude.com/docs/en/common-workflows

Use isolated worktrees for parallel writers whenever file ownership could overlap. Use read-only subagents for discovery and verification. Keep the lead context focused on integration and product decisions.

## UI primitives and motion candidates

Evaluate the repository’s existing dependencies before adding anything.

- Radix Navigation Menu:
  https://www.radix-ui.com/primitives/docs/components/navigation-menu
- Radix Dropdown Menu:
  https://www.radix-ui.com/primitives/docs/components/dropdown-menu
- Motion layout animations:
  https://motion.dev/docs/react-layout-animations
- Motion AnimatePresence:
  https://motion.dev/docs/react-animate-presence
- Motion reduced-motion support:
  https://motion.dev/docs/react-accessibility
- Motion LazyMotion:
  https://motion.dev/docs/react-lazy-motion
- Driver.js guided tours:
  https://driverjs.com/
- Driver.js tour progress:
  https://driverjs.com/docs/tour-progress
- Floating UI React:
  https://floating-ui.com/docs/react
- Open-source spin-wheel reference:
  https://crazytim.github.io/spin-wheel/

Preferred decision order:

1. Reuse existing accessible primitives and packages.
2. Add one focused package only when it materially reduces accessibility or positioning risk.
3. Avoid stacking multiple overlapping UI libraries.
4. Avoid Three.js, GSAP, large Lottie bundles, or ornamental dependencies for effects that Motion/CSS/Canvas/SVG can handle.
5. Enforce reduced-motion behavior and bundle budgets.
6. Use animation to explain state, not decorate every surface.

The supplied wheel code screenshot demonstrates the basic Canvas pattern—draw segments, rotate, use an easing curve, and announce the winner. It is a conceptual reference only. The implementation should be original, typed, responsive, deterministic, and integrated with the actual game state.

---

# 4. Required agent topology

Start with a lead integrator and parallel discovery. Do not let every agent edit the same files.

## Phase A — parallel read-only discovery agents

Launch at least six read-only agents simultaneously:

### Agent A1 — Information architecture and route audit

Map:

- every public route;
- every game route;
- desktop and mobile navigation;
- homepage CTA destinations;
- Play catalog;
- Daily hub;
- ranking, methodology, profile, challenge, and leaderboard routes;
- duplicated mode metadata;
- current component ownership and test coverage.

Deliver a proposed route/nav matrix and identify exactly which files own the header, mobile menu, home hero, and game catalog.

### Agent A2 — RUN THE TABLE UX and state audit

Trace the complete first-time journey:

- homepage CTA;
- start mode choice;
- system selection;
- each node type;
- trade flow;
- battle;
- completion;
- replay;
- challenge;
- save/resume.

Identify jargon, unclear actions, unreachable explanations, focus/scroll problems, selection-state bugs, duplicated client/server rules, and the exact source of `[object Object]`.

### Agent A3 — 82–0 spinner and RNG audit

Find:

- authoritative team/season selection code;
- client animation code;
- reroll budget and action API;
- seed source;
- current repeat suppression;
- eligible season range;
- tests;
- existing visual components.

Propose a deterministic distance-aware reroll policy and a visual spinner/reel architecture. Prove where the authoritative result is chosen.

### Agent A4 — rankings and artifact provenance audit

Find:

- authoritative current methodology/version;
- generation commands;
- player-season and window artifacts;
- public API source;
- web data-loading path;
- cache/version keys;
- game card-pool source;
- current release metadata;
- CI parity checks.

Produce exact evidence of whether the visible rankings are stale. Do not infer from screenshots alone.

### Agent A5 — design system, motion, and dependency audit

Inventory:

- tokens;
- fonts;
- spacing;
- radii;
- colors;
- component primitives;
- icon library;
- animation dependencies;
- bundle sizes;
- accessibility utilities;
- current mobile behavior.

Recommend a minimal technical approach for the mega-menu, guided tour, motion, tooltips, and spinner. Include dependency cost and whether each candidate is already installed.

### Agent A6 — automated-test and browser-risk audit

Map the relevant:

- Pytest;
- API tests;
- Vitest;
- Playwright;
- visual tests;
- accessibility tests;
- data invariants;
- performance budgets.

Identify which existing tests must remain untouched, which intent legitimately changes, and what new tests are required.

## Phase B — integration plan before writing

The lead must synthesize discovery into:

```text
docs/implementation/UX_ORGANIZATION_POLISH_PLAN.md
```

The plan must include:

- exact file ownership;
- agent/worktree allocation;
- no-overlap rules;
- shared contracts that must be agreed before writers start;
- implementation order;
- expected migrations or dependency changes;
- rollback boundaries;
- test matrix;
- acceptance criteria.

Only after this plan exists should writer agents begin.

## Phase C — isolated writer agents

Use worktree-isolated writers or strict disjoint file ownership.

Suggested ownership:

- W1: global navigation, mobile menu, route metadata, game launcher.
- W2: homepage and Play catalog visual hierarchy.
- W3: RUN THE TABLE guided tour, terminology, first-run help, node education.
- W4: RUN THE TABLE cards, Trade Desk state/flow, node and battle polish.
- W5: 82–0 spinner, reroll algorithm, animation, related tests.
- W6: rankings/data synchronization, model-version UI, parity tests.
- W7: shared visual/motion primitives and accessibility, only after contract agreement.
- W8: adversarial verification; read-only until writers finish.

If multiple writers need the same shared primitive, the lead assigns one owner and exposes a small stable API. Do not allow parallel agents to independently rewrite the same header, card, or token files.

---

# 5. Workstream 1 — navigation and information architecture

## Desktop navigation

Replace the flat **Play** link with an accessible nested game launcher.

A strong target structure is:

### Play

**Flagship**
- Run the Table — front-office roguelike
- 82–0 PEAK Season — full-season roster builder

**Daily**
- Daily Grid Challenge
- Peak Duel Daily
- Daily Run the Table, if distinct and available

**Competitive**
- Ranked
- Global leaderboard
- Challenges / match history, if currently available

**Explore**
- View all games
- PEAK3 Rankings / Index
- Methodology / Formula explorer

Requirements:

- Use a true button trigger with `aria-expanded`, proper focus management, Escape dismissal, arrow-key navigation, click/tap support, and route-aware active state.
- Do not rely on hover alone.
- Include concise one-line explanations and icons; avoid a giant unreadable mega-menu.
- Show a “Featured” treatment for RUN THE TABLE without burying other modes.
- Preserve deep links and all routes.
- Use the existing centralized mode metadata as the only source of game names, descriptions, badges, routes, and availability.
- Add a final “View all games” action.
- The nav must remain useful at 200% zoom.

## Mobile navigation

Use a drawer or sheet with accordion groups:

- Play;
- Daily;
- Rankings;
- Learn;
- About/profile controls as applicable.

Requirements:

- Touch targets at least 44×44 CSS pixels.
- No nested hover assumptions.
- Focus trap and focus return.
- Current route clearly marked.
- Avoid forcing users to scroll through every game merely to reach Rankings.
- Include a direct “Resume Run” action when a recoverable RUN THE TABLE state exists.

## Visual design

Improve the navbar without turning it into generic glassmorphism:

- retained PEAK3 identity;
- warm-black background;
- subtle border and depth;
- restrained gold selection indicator;
- clear typography;
- compact height;
- polished open/close transition;
- sticky behavior without covering game rails;
- no layout shift;
- no unreadable low-contrast metadata.

Use a shared nav shell on all public pages. Fix any page that currently renders a different or missing header unless intentionally isolated.

---

# 6. Workstream 2 — homepage and game discovery

## Eliminate the redundant CTA funnel

The homepage primary CTA must do what its label promises.

Recommended behavior:

- **Play Run the Table** launches a standard run directly or opens a compact, focused mode chooser in place with:
  - Standard Run;
  - Today’s Shared Run;
  - Resume existing run, when available.
- **How It Works** opens the explanation without blocking play.
- **Explore All Games** opens the organized catalog.

Do not route “Start a Run” to a second marketing page with another “Start a Run” button.

The destination route can retain a compact start surface for direct visitors, but the homepage CTA and route behavior must be semantically clear and avoid double confirmation.

## Homepage structure

Redesign the first two viewports around action and proof:

1. Compact persistent nav.
2. Hero with:
   - one-line PEAK3 promise;
   - Play Run the Table;
   - Explore Rankings;
   - optional resume state;
   - a live, non-interactive game preview or animated roster/map vignette rather than only giant typography.
3. Compact game launcher:
   - Flagship;
   - Quick play;
   - Daily;
   - Competitive.
4. Current model proof strip:
   - active PEAK3 model version;
   - data through season;
   - number of evaluated player-seasons/windows;
   - link to methodology/changelog.
5. Featured daily challenge or live leaderboard.
6. Browse all modes below.

The existing “Ways to play” page may remain as the complete catalog, but improve its grouping, visual density, and direct action labels. Do not remove any mode.

## Visual principles

- Reduce the oversized headline footprint.
- Use one primary focal point per viewport.
- Introduce an editorial hero composition, not another dashboard.
- Use subtle court/scouting-grid motifs.
- Use exact peak cards and component bars as visual content.
- Make hover/focus states explain where a click goes.
- Add tasteful entrance transitions only for first render.
- Avoid repeated dark rectangles with identical borders.
- Preserve fast LCP and static server-rendered content.

---

# 7. Workstream 3 — RUN THE TABLE first-time experience

## Guided walkthrough

Implement a first-run, versioned, accessible guided tour similar to the user’s requested 1–N sliding window.

The tour must:

- spotlight one actual interface region at a time;
- dim the remainder without making text unreadable;
- support **Next**, **Back**, **Skip**, **Close**, and Escape;
- display progress such as “2 of 7”;
- scroll the target into view;
- position correctly on desktop and mobile;
- preserve focus and return it correctly;
- respect reduced motion;
- never start during a destructive confirmation or battle animation;
- persist completion in a versioned local preference;
- be replayable from a clearly visible **Help / Tour** action;
- not require sign-in;
- not block experienced users on subsequent runs.

Suggested base steps:

1. **Run Map** — “Choose one path at each stage. The other closes.”
2. **Current Decision** — explain the current node and primary action.
3. **Credits** — explain what they buy and that unspent credits matter at the end.
4. **Lives** — explain exactly when a life is lost.
5. **Roster** — explain five starters, two bench, and role legality.
6. **Front Office Perks** — explain the permanent run modifier currently called a System.
7. **Lane Profile** — explain the five official PEAK3 components and that bosses are won by taking three of five lanes.

Add contextual one-time coachmarks when the player first enters:

- Draft Room;
- Film Room;
- Rest / Bank;
- Trade Desk;
- Boss Battle.

Do not replay the entire tour for each node.

Evaluate Driver.js first because it provides spotlighting, next/back controls, progress, mobile support, and a small dependency. If the existing component stack already contains an equivalent accessible primitive, reuse it. Record the decision and bundle impact.

## Plain-language terminology

Keep the game’s identity but reduce jargon.

Possible presentation:

- **System** → display as **Front Office Perk** with “System” as secondary/internal terminology if needed.
- **Lane Profile** → **How your roster wins**, with the official component names beneath.
- **Statistical Impact** → official name plus a one-line tooltip.
- **Traditional Production** → official name plus a one-line tooltip.
- **Individual Recognition** → official name plus a one-line tooltip.
- **Playoff Rate Impact** → official name plus a one-line tooltip.
- **Team Result** → official name plus a one-line tooltip.

Do not rename canonical model fields in APIs or methodology. Improve the user-facing layer and provide exact official names in receipts/tooltips.

## Node differentiation

Each node type needs a distinct icon, color accent, concise purpose, and clear consequence:

- **Draft Room:** buy one exact 3Y peak or keep the credits.
- **Trade Desk:** send one player out and acquire one legal replacement.
- **Film Room:** learn about future offers/boss conditions or take a defined preparation benefit.
- **Rest / Bank:** skip roster improvement for recovery or credits.

The map should show these differences before the user chooses a path.

Where the current game only has two Film Room choices, implement the missing third meaningful choice only if the engine contract already anticipated it or it can be added deterministically and tested. A reasonable third choice is a small, published, one-battle preparation benefit—not hidden AI advice. If adding it would destabilize the engine, instead make the existing two choices much clearer and document the deferral honestly.

---

# 8. Workstream 4 — RUN THE TABLE visual and interaction polish

## Layout hierarchy

Desktop target:

- left: compact progress map;
- center: current decision/battle;
- right: sticky front-office rail.

But improve hierarchy:

- map visually recedes when not active;
- current decision is the dominant surface;
- credits/lives/act use concise scoreboard treatment;
- roster cards are easier to scan;
- lane profile is collapsible or summarized when it is not relevant;
- sticky rail never hides beneath the global nav;
- no horizontal overflow.

Mobile target:

- current decision first;
- persistent compact front-office summary;
- roster/map accessible through tabs or drawers;
- no three-column squeeze;
- tour targets remain usable.

## Card anatomy

Every player card must make these immediately legible:

- player;
- exact 3Y window;
- eligible roles;
- PEAK3 total;
- five-lane fingerprint;
- price/refund;
- selected state;
- affordability;
- legality;
- primary action.

Use progressive disclosure for deeper details.

Do not show an unlabeled secondary number like “63.0th pct” without saying what percentile it represents.

Use disabled states rather than clickable error traps for clearly impossible actions. Provide one concise reason.

## Motion and game feel

Use Motion/CSS/Canvas/SVG selectively:

- selected cards glide into the roster;
- credits count smoothly but settle instantly to the authoritative value;
- current map node advances with a shared-element indicator;
- node cards enter/exit with short directional transitions;
- lane bars animate from prior to new values when the roster changes;
- boss lanes reveal one at a time;
- a third lane win produces a restrained lock-in moment;
- victories receive a brief celebratory accent;
- losses remain clear without shaming;
- final result assembles into a shareable story.

Use `LazyMotion` or an equivalent bundle-conscious approach if Motion is added or already installed. Respect user reduced-motion preferences site-wide. Never add artificial delay to API completion.

## Battle screen

Make the battle readable as a statistical game abstraction:

- “First to 3 lanes” visible before reveal.
- Boss rule visible before the battle begins.
- Each lane shows:
  - your score;
  - opponent score;
  - winning contributor;
  - why the boss rule changed anything, if applicable.
- Keep “Reveal instantly.”
- At completion, show the decisive lane and one sentence explaining the result.
- Never imply this is a literal possession-by-possession NBA simulation.

## Completion screen

Create a polished final payoff:

- run result;
- boss record;
- remaining lives;
- final roster;
- perks;
- strongest and weakest lanes;
- MVP;
- best acquisition/trade;
- closest battle;
- credits spent/held;
- one clear “Why this run ended this way” receipt;
- Run It Back;
- Replay This Seed;
- Challenge a Friend;
- Copy Summary;
- share-image export if materially achievable by adapting the current exporter without compromising the pass.

If image export remains blocked, do not ship a broken button. Explain the blocker precisely.

---

# 9. Workstream 5 — Trade Desk redesign and bug fix

Implement a clear transaction builder.

## Required flow

1. **Choose a player to send out.**
2. **Choose one legal incoming player.**
3. **Review trade.**
4. **Confirm trade.**

The review must show:

- outgoing player and refund;
- incoming player and cost;
- net credit change;
- credits after trade;
- role before and after;
- projected five-lane changes;
- whether roster legality remains valid;
- Confirm and Cancel.

## Selection rules

- Only one outgoing and one incoming selection at a time.
- Highlight only the actual selected cards.
- Changing outgoing player recomputes incoming legality and clears an incompatible incoming selection.
- Changing incoming player does not highlight unrelated offers.
- Ineligible cards are disabled with a reason.
- Selection color, border, icon, and text must all communicate state—never color alone.
- Cancel clears all ephemeral transaction state.
- Server remains authoritative at confirmation.

## Defects to eliminate

- No `[object Object]` anywhere.
- No stale selection border.
- No mismatch between selected card and submitted transaction.
- No transaction requiring trial-and-error to discover role legality.
- No raw enum/object serialization in user-visible copy.
- No role loss hidden until after confirmation.

Add targeted reducer/component/API tests reproducing the exact supplied screenshot scenario: Domantas Sabonis selected as outgoing, Dirk Nowitzki selected as incoming, Steve Francis not selected, and the final confirmed transaction is Dirk for Sabonis with the published net credit result.

---

# 10. Workstream 6 — 82–0 spinner and reroll quality

Dedicate one agent entirely to this workstream.

## Product behavior

The initial result remains uniform over the valid eligible pool unless current game rules specify otherwise.

A reroll should feel materially different.

Implement a transparent distance-aware reroll policy:

### Season reroll

Given current season index `s`:

1. Exclude the exact current season.
2. Prefer excluding seasons within ±2 season indices when the eligible pool remains sufficiently large.
3. If the pool becomes too small, relax in order:
   - exclude ±1;
   - then exact current only.
4. Sample uniformly from the remaining allowed seasons using the authoritative seeded RNG.
5. Record the exclusion radius and allowed-pool size in debug/test metadata, not the normal UI.

This avoids 1991–92 → 1992–93 unless constraints leave no reasonable alternative.

Do not silently bias specific eras. Uniformity is over the allowed post-exclusion pool.

### Team reroll

- Exclude the current team.
- Prefer excluding the most recent one or two team results in the run when enough eligible teams remain.
- Use a small deterministic shuffle-bag/recent-history policy rather than repeated independent draws that frequently feel duplicated.
- Preserve candidate feasibility.

### Determinism

- The server selects and records the result.
- The client receives the result and animates to it.
- Replaying the same state/action/seed produces the same result.
- Refreshing during animation does not reroll.
- Double-clicking cannot consume two rerolls.
- Daily/challenge boards remain reproducible.

## Visual spinner

Create a signature PEAK3 reveal rather than a generic loading indicator.

Recommended direction:

- **Team:** circular franchise dial or compact wheel with readable abbreviations/logomarks where legally permitted.
- **Season:** horizontal archival timeline reel with season tiles moving past a fixed center marker.
- When both are rolled, animate them as a synchronized “Franchise × Season” lockup.
- Use rapid initial movement, perceptible deceleration, one or two suspense ticks near the end, and a decisive snap.
- Duration target roughly 1.2–2.0 seconds, with a skip/instant preference after the first round if user testing suggests it.
- Optional sound must be opt-in/muted by default.
- Use haptics only where supported and appropriate.
- Reduced motion immediately fades or steps to the result without rotation.
- The full result remains text-accessible and announced through an ARIA live region.

Evaluate the open-source `spin-wheel` project and the supplied Canvas concept, but do not add the dependency merely because it exists. A custom SVG/Canvas/DOM timeline may better match PEAK3 and the dual team/year requirement.

## Spinner tests

Add:

- deterministic golden-seed tests;
- exact-repeat prevention;
- adjacent-season prevention while the preferred pool is viable;
- graceful fallback when the eligible pool is small;
- reroll-budget idempotency;
- 100,000-sample distribution audit over allowed pools;
- no invalid team-season combinations;
- browser test proving the visible animation lands on the authoritative API result;
- reduced-motion test;
- keyboard and screen-reader operation.

Write an audit artifact under:

```text
docs/implementation/spinner-audit.json
```

Include policy, sample sizes, violations, and distribution summary.

---

# 11. Workstream 7 — rankings and data synchronization

## Determine the source of truth

Identify:

- current methodology semantic/version identifier;
- current data release identifier;
- latest season covered;
- generation commit or checksum;
- player-season count;
- 1Y, 3Y, and 5Y window counts;
- canonical component names and columns;
- authoritative output files;
- API cache keys;
- frontend source.

## Regenerate safely

Use the repository’s supported generation commands from a clean reproducible environment.

Do not manually edit leaderboard rows.

Compare before/after:

- artifact hashes;
- top 50 for 1Y;
- top 50 for 3Y;
- top 50 for 5Y;
- component columns;
- player/window IDs;
- latest-season inclusion;
- duplicate-player handling;
- API response;
- browser-rendered table;
- RUN THE TABLE card pool;
- 82–0 card/player-season source where relevant.

If generated outputs are unchanged, retain them and prove the page is current.

If generated outputs change, document exactly why:
- stale artifact;
- stale frontend bundle;
- stale API cache/version;
- pipeline correction already present in source;
- newly included data;
- actual methodology change already in the branch.

## UI provenance

Add a concise, nonintrusive status near Rankings:

- PEAK3 model version;
- data through season;
- generated/release date;
- methodology link;
- changelog/release link when available.

Clarify terminology:

- `1-Year` under Peak Windows means the best one-season window per player.
- `Single Seasons` means all eligible player-seasons, if that is the intended distinction.
- Do not display contradictory labels.

## Permanent parity tests

Add tests that fail when:

- frontend top rows differ from the current generated artifact;
- API version differs from artifact version;
- a game card references a missing or old window;
- component totals fail to reconcile;
- UI cache keys omit model/data version;
- latest supported season is missing unexpectedly.

Produce:

```text
docs/implementation/RANKINGS_SYNC_REPORT.md
```

Include commands, hashes, current top rows, counts, and whether any visible rankings changed.

---

# 12. Shared visual system and site-wide polish

Apply a coherent system rather than one-off page styling.

## Arena Archive direction

- Ink-black and warm charcoal surfaces.
- Paper/cream text rather than pure white everywhere.
- Gold used for primary action and progress, not every border.
- Component colors remain semantic.
- Technical grid/scouting lines used subtly.
- Condensed/editorial display typography for moments, highly legible body text for gameplay.
- Tabular numerals.
- Moderate corner radii.
- More varied surface hierarchy: border, inset panel, quiet section, elevated decision card.
- Avoid generic neon dashboard appearance.
- Avoid glass panels on every component.
- Avoid illegible gray-on-black metadata.

## Shared components to improve or create

Only where useful:

- `GlobalNav`
- `PlayMenu`
- `MobileNavDrawer`
- `GameLauncher`
- `ModeCard`
- `SectionHeader`
- `ScorePill`
- `StatusChip`
- `Tooltip/Explainer`
- `GuidedTour`
- `PlayerPeakCard`
- `ComponentFingerprint`
- `ConfirmTransaction`
- `AnimatedNumber`
- `ResultReceipt`
- `EmptyState`
- `Skeleton`

Centralize tokens and variants. Do not create duplicate visual systems for each game.

## Accessibility

Required:

- WCAG 2.2 AA contrast for actual states.
- Keyboard operation for every menu, tour, game action, trade, spinner, and modal.
- Visible focus.
- Screen-reader labels and live-region discipline.
- Reduced motion.
- Non-color state encoding.
- Correct heading hierarchy.
- No hover-only information.
- 200% zoom and reflow.
- Touch target sizing.
- No focus reset to `<body>` after actions.
- No sticky panel hidden behind nav.
- Tour overlay must not trap or lose focus incorrectly.

## Performance

- Preserve or improve Core Web Vitals.
- No artificial loading delay.
- Initial game route JS remains within the existing budget.
- Measure any added dependency.
- Lazy-load tour code until needed.
- Lazy-load noncritical animation features.
- Pause animations when the tab is hidden where appropriate.
- Avoid animating layout-triggering properties during active gameplay.
- Reserve dimensions to prevent CLS.

---

# 13. Verification strategy

## Automated suites

Run and surface exact output for all relevant and full suites:

```text
pytest tests/
pytest apps/api/...
vitest
playwright
tsc
lint
production build
```

Use actual repository commands discovered during Phase A. Do not invent command names.

## Required new automated coverage

### Navigation

- Play menu opens by click and keyboard.
- Arrow/Escape/focus behavior.
- Every game remains reachable.
- Active route.
- Mobile drawer.
- No duplicate mode metadata.
- Homepage CTA launches intended mode directly.
- Resume state.

### Guided tour

- first-run auto-start;
- skip;
- close;
- next/back;
- versioned persistence;
- replay from Help;
- mobile target positioning;
- reduced motion;
- focus behavior.

### RUN THE TABLE

- each node’s plain-language explanation;
- trade state bug reproduction;
- no `[object Object]`;
- legal/illegal cards;
- confirm/cancel;
- focus and scroll retention;
- battle reveal;
- completion actions;
- save/resume and challenge remain intact.

### Spinner

All tests listed in Workstream 6.

### Rankings

All parity tests listed in Workstream 7.

## Real-browser verification

Drive a real browser against a real API.

Capture and inspect—not merely save—screenshots at:

- 1440×900;
- 1728×1117;
- 1024×768;
- 768×1024;
- 430×932;
- 390×844.

Required screenshots:

1. Homepage first viewport.
2. Desktop Play menu open.
3. Mobile nav open.
4. Ways to Play catalog.
5. RUN THE TABLE start/mode choice.
6. Tour steps for map, roster, credits/lives, and lane profile.
7. Draft Room.
8. Film Room.
9. Rest / Bank.
10. Trade Desk outgoing selection.
11. Trade Desk review confirmation.
12. Boss pre-battle.
13. Boss reveal.
14. Completion.
15. 82–0 team spin in motion or deterministic test frame.
16. 82–0 season reel.
17. Rankings with version/provenance.
18. Keyboard focus states.
19. Reduced-motion state.

Use browser recordings if supported for animation review.

## Manual adversarial checks

Fresh-context reviewers must test:

- direct URLs;
- anonymous first session;
- challenge recipient;
- daily and standard run separation;
- double-clicks;
- two tabs;
- refresh during spinner;
- refresh during trade review;
- browser back/forward;
- mobile viewport changes;
- 200% zoom;
- reduced motion;
- empty/slow/error API states;
- very long player names;
- older and latest seasons;
- stale localStorage tour version;
- no sign-in.

---

# 14. Review agents after implementation

Launch fresh read-only reviewers:

### Reviewer R1 — product comprehension

Can a new basketball fan explain the site, launch a specific game, and complete the first RUN THE TABLE stage without external instructions?

### Reviewer R2 — basketball/statistical integrity

Verify exact 3Y windows, component displays, battle arithmetic, rankings version, spinner eligibility, and no misleading simulation language.

### Reviewer R3 — accessibility and interaction

Keyboard, screen reader semantics, focus, tour, menus, reduced motion, contrast, mobile.

### Reviewer R4 — code and state integrity

Look for duplicated game rules, race conditions, stale selection, serialization errors, non-idempotent actions, client-authoritative randomness, and unsafe cache behavior.

### Reviewer R5 — visual polish

Inspect all screenshots for hierarchy, consistency, spacing, density, clipping, animation purpose, and whether the result feels like a premium basketball product rather than a dark admin dashboard.

The lead must fix all blockers and high-severity findings, rerun relevant tests, and record medium/low findings honestly.

---

# 15. Definition of done

The pass is complete only when all of the following are true:

## Navigation and homepage

- Play has a nested, accessible desktop menu and organized mobile navigation.
- Every game/functionality remains reachable.
- Homepage CTA behavior is unambiguous and no longer creates a redundant double-start funnel.
- The homepage is visually improved and action-oriented.
- The full catalog remains available without being the only launcher.

## RUN THE TABLE

- First-time guided tour exists, is skippable, replayable, accessible, persistent, responsive, and versioned.
- Node types are visually and semantically distinct.
- Cards and component values are easier to understand.
- Trade Desk has a clear two-selection review/confirm flow.
- Steve Francis does not remain highlighted during a Dirk-for-Sabonis trade.
- No `[object Object]` or raw serialization appears.
- Battles and results are more engaging and easier to explain.
- Save/resume, daily, challenge, seed replay, and engine correctness remain intact.

## 82–0 spinner

- Team and season results have a polished, deterministic visual reveal.
- A season reroll avoids exact and adjacent/near-adjacent seasons when the pool permits.
- Team rerolls suppress recent repeats when the pool permits.
- Statistical audit passes.
- Reduced motion and accessibility pass.
- The server remains authoritative.

## Rankings

- Current model/data release is proven and surfaced.
- UI, API, generated artifacts, and game pools match.
- 1Y/3Y/5Y terminology is consistent.
- Any changed rankings are generated—not manually edited.
- Permanent parity tests exist.

## Quality

- Full relevant test suite and build pass.
- No new lint warnings.
- No broken routes or hidden games.
- No material accessibility regressions.
- No unacceptable bundle regression.
- Browser screenshots are inspected.
- No commit, push, PR, merge, or stash.

---

# 16. Final deliverables

Write:

```text
docs/implementation/UX_ORGANIZATION_POLISH_PLAN.md
docs/implementation/UX_ORGANIZATION_POLISH_REPORT.md
docs/implementation/RANKINGS_SYNC_REPORT.md
docs/implementation/spinner-audit.json
docs/implementation/ux-polish-review/
```

The final report must include:

1. Executive summary.
2. Baseline git state.
3. Agent topology and file ownership.
4. Research and dependency decisions.
5. Navigation before/after.
6. Homepage before/after.
7. RUN THE TABLE onboarding and terminology changes.
8. Trade Desk defect root causes and fixes.
9. Spinner algorithm, animation, and fairness audit.
10. Rankings provenance, commands, hashes, counts, and changed top rows.
11. Accessibility and performance results.
12. Exact test counts.
13. Screenshot index.
14. Remaining limitations with reasons.
15. Final `git status --short`.
16. Explicit confirmation that canonical methodology was not changed except through already-existing authoritative source changes, if applicable.
17. Explicit confirmation that no commit/push/PR/merge/stash occurred.


