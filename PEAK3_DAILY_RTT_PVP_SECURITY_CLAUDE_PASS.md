# PEAK3 Daily Grid, Run the Table Depth, PvP, Security, and Footer Pass

## Mission

Complete one focused product pass that:

1. Proves and fixes Daily Grid freshness so the active board, seed, theme, and attempt always match the current `America/Los_Angeles` daily key.
2. Adds a first-time Daily Grid walkthrough that does not start the timer until the player explicitly begins, with a replayable `?` help control.
3. Makes RUN THE TABLE deeper and more suspenseful with:
   - user-triggered starting-roster reveals;
   - five acts, ten decision nodes, five bosses, three lives;
   - better credit sinks;
   - a useful, actionable Film Room.
4. Adds secure asynchronous two-player RUN THE TABLE challenges using the same seed and rules.
5. Adds a responsive global footer and accurate beta Terms, Privacy, Accessibility, Contact, Data Sources, and Methodology pages.
6. Closes every previously documented ownership/IDOR vulnerability before enabling PvP or broader beta use.

Preserve canonical PEAK3 methodology, rankings, scoring components, authentication, Pacific-time policy, RLS, deterministic seeds, existing challenges, and all current game modes.

Do not commit, push, open a PR, merge, or stash. Leave the full diff unstaged for review.

---

## Important observation from the supplied screenshot

The Daily Grid screenshot displays:

```text
2026-08-01 · TWO-WAY NIGHT
New board in 14h 19m
```

At about 9:40 AM Pacific on 2026-08-01, that date and countdown are consistent with the current Pacific day.

Therefore, do not assume the date label itself is stale. Investigate and distinguish:

- stale daily key;
- stale seed or theme;
- identical board generation across adjacent days;
- a prior-day attempt/result displayed under a new date;
- archived replay state mounted as the current board;
- browser/query cache surviving reset;
- authenticated history being substituted for the current attempt.

Produce adjacent-day evidence including:

```text
daily_key
seed
theme_id
board_hash
criteria IDs
attempt ID
result ID
starts_at
ends_at
```

The current-day route must never reuse the previous day’s active attempt or result.

---

## Preflight

Before editing:

```bash
git status --short
git diff --check
git log -4 --oneline
git branch --show-current
git stash list
```

The auth/daily/balance pass must already be committed and pushed as a checkpoint. If the working tree is not clean, stop and report the exact state.

Read:

```text
docs/implementation/AUTH_DAILY_BALANCE_REPORT.md
docs/implementation/DAILY_TIME_AUDIT.md
docs/implementation/AUTH_CONFIGURATION.md
docs/implementation/UX_ORGANIZATION_POLISH_REPORT.md
```

Also read the documented ownership/IDOR findings in the previous report.

---

## Required parallel discovery agents

Launch read-only agents first.

### A1 — Daily Grid freshness and timer audit

Trace:

- server daily-key generation;
- seed and theme derivation;
- board generation;
- authenticated attempt lookup;
- archive/history lookup;
- query/cache keys;
- reset listeners;
- background-tab behavior;
- server timer start;
- database uniqueness.

Reproduce the user-visible stale-board concern before changing code.

### A2 — Daily Grid onboarding audit

Map:

- when the timer currently starts;
- first-time experience;
- existing RUN THE TABLE tour primitives;
- local preference/version storage;
- keyboard/mobile/focus behavior;
- replayable `?` help action.

### A3 — RUN THE TABLE economy/depth audit

Measure:

- average credits spent and remaining;
- Film Room pick/win rate;
- Rest/Bank usage;
- trade and draft usage;
- clear rate;
- average ending act;
- run duration;
- frequency of finishing with 25+ credits.

### A4 — Film Room usefulness audit

Prove whether current Film Room information can change a later decision. If not, replace it with actionable deterministic choices.

### A5 — PvP/challenge audit

Map current:

- challenge links;
- seed replay;
- authenticated ownership;
- result comparison;
- run versioning;
- anonymous participation;
- daily separation.

Design asynchronous same-seed head-to-head.

### A6 — ownership/security audit

Enumerate every endpoint accepting:

- game ID;
- run ID;
- attempt ID;
- challenge ID;
- match ID.

Test unrelated authenticated and anonymous mutation attempts. Treat known draft/perfect-season IDORs as release blockers.

### A7 — footer/legal/data-practice audit

Inventory actual:

- auth providers;
- stored account data;
- telemetry;
- cookies/localStorage;
- third-party processors;
- deletion/export behavior;
- contact route;
- data sources;
- trademarks/logos.

Do not write generic legal claims unsupported by the actual product.

The lead must write:

```text
docs/implementation/DAILY_RTT_PVP_SECURITY_PLAN.md
```

before writer agents edit. Use isolated worktrees or strict non-overlapping ownership.

---

# 1. Daily Grid freshness

Use the existing server-authoritative Pacific daily utility.

Every current-board response must include:

```json
{
  "daily_key": "YYYY-MM-DD",
  "timezone": "America/Los_Angeles",
  "seed": 123,
  "theme_id": "two-way-night",
  "board_hash": "...",
  "starts_at": "...",
  "ends_at": "...",
  "seconds_remaining": 12345,
  "attempt_status": "not_started"
}
```

Required invariants:

- adjacent daily keys derive distinct seeds;
- adjacent keys produce distinct board hashes unless an explicitly tested rare collision occurs;
- current-day lookup cannot return a prior-day attempt/result;
- archive/history routes remain separate;
- client cache keys include daily key and user identity where needed;
- midnight PT invalidates/refetches;
- returning from a background tab after reset refetches;
- challenge/replay state cannot replace today’s active board.

Create:

```text
docs/implementation/daily-grid-freshness-audit.json
```

with at least 30 consecutive daily keys, seeds, themes, hashes, and criteria signatures. Fail on unintended duplicates.

---

# 2. Daily Grid first-time walkthrough and fair timer

Reuse the existing guided-tour system from RUN THE TABLE.

## Start gate

A first-time player sees:

```text
Today’s Daily Grid
9 squares · 9 different exact player-seasons
Build the highest-scoring valid grid you can.
The timer starts only when you press Start.
```

Actions:

- **How to Play**
- **Start Timed Grid**
- **Skip Tour and Start**

The board may be visually previewed behind a non-interactive overlay, but users cannot search or inspect candidates before starting.

## Tour steps

1. Objective — maximize total PEAK3 score.
2. Rows and columns — each answer satisfies both conditions.
3. Exact seasons — entries use exact player-seasons.
4. One player per board — no duplicate player identity.
5. Picks lock — valid choices are final.
6. Scoring — higher PEAK3 seasons score more; max is shown after completion.
7. Timer — begins only after explicit start.

Controls:

- Next
- Back
- Skip
- Close
- Escape
- progress such as `3 of 7`

Persist a versioned completion preference. Add a permanent `?` / **How to Play** control that reopens the tour without resetting the board or pausing the timer.

## Timer contract

Start through an idempotent server action:

```text
POST /daily-grid/{daily_key}/start
```

Requirements:

- timestamp stored once;
- double-click safe;
- refresh safe;
- two-tab safe;
- tour time excluded;
- page-load/network time excluded;
- existing attempts resume true elapsed time;
- reopening the tour does not pause;
- challenge/archive views do not affect today’s timed attempt.

---

# 3. RUN THE TABLE starting-roster reveal

Add a short interactive **Opening Draft Reveal** before Act 1.

Reveal these slots one by one:

- Lead Creator
- Guard/Wing
- Wing/Forward
- Forward/Big
- Anchor
- Bench 1
- Bench 2

The player clicks:

```text
Reveal next player
```

or uses a polished PEAK3 card reel/spin.

The backend preselects the deterministic authoritative card. The client only animates to it.

Requirements:

- same seed = same roster;
- refresh resumes reveal state;
- reduced motion reveals instantly;
- skip-all available after the first reveal;
- role legality guaranteed;
- no client RNG;
- exact 3Y peaks only.

Before each boss, use a short deterministic reveal of the boss roster/profile. Clearly label it as seed/rule generated, not an LLM constructing a team live.

---

# 4. RUN THE TABLE v3 depth and economy

Implement and balance:

- **5 acts**
- **10 decision nodes**
- **5 boss battles**
- **3 lives**
- **50 starting credits**
- final-boss victory required to Clear the Table
- immediate run end at 0 lives
- 15–22 minute target

Version the state/rules. Old v2 runs and challenge links must remain readable/replayable under their original rules or retire gracefully.

## Credit sinks

### Market Refresh

At Draft Room or Trade Desk:

> Spend 7 credits to replace the current offers once.

- one refresh per node;
- deterministic secondary offers;
- server-authoritative.

### Reserve a Card

At Film Room:

> Spend 5 credits to reserve one revealed future card at its current price.

- appears in the next eligible Draft Room;
- expires after that node;
- deterministic;
- role legality applies.

### Role Focus

At Film Room:

> Spend 6 credits to guarantee at least one next-market offer fits a chosen role.

### Emergency Recovery

At Rest / Bank:

> Spend a published amount to recover one life, with a per-run cap.

## Economy audit

Report:

- median credits remaining by policy;
- percentage spending 50%, 75%, and 90% of available credits;
- clear rate by spend band;
- unused-credit distribution;
- node pick rates.

A competent policy should usually finish with fewer than 20 credits unless intentionally pursuing a bank strategy.

---

# 5. Make Film Room actionable

Replace or expand Film Room into **Scout & Prepare**.

Every visit offers three meaningful choices.

## A. Scout the Boss

Reveal:

- next boss rule;
- strongest two boss lanes;
- weakest lane;
- projected matchup.

Then choose one visible, capped preparation bonus for one selected lane in the next battle.

## B. Shape the Market

Choose a role focus for the next market. Guarantee at least one legal matching offer.

## C. Reserve a Future Card

Reveal a deterministic future set and spend credits to reserve one.

Every Film Room visit must produce either:

- useful information plus an actionable preparation;
- market control;
- a reserved asset.

Measure Film Room pick rate and win contribution after the change.

---

# 6. Asynchronous two-player RUN THE TABLE

Implement account-backed **Head-to-Head Run**.

This is asynchronous first, not live concurrent multiplayer.

## Challenge creation

An authenticated user creates:

- high-entropy invite token;
- rules version;
- seed;
- starting roster;
- boss sequence;
- market/node generation inputs;
- creator result when completed;
- expiration policy.

The invite must not expose mutable resource IDs.

## Fairness

Both users receive:

- same rules version;
- same starting roster;
- same initial perk choices;
- same node structure;
- same offer-generation inputs;
- same bosses.

Choices may diverge.

Derive randomness from stable event keys, not a global sequential RNG:

```text
seed + act + stage + node_type + refresh_index
```

## Winner order

Publish a deterministic comparison:

1. Table Cleared
2. bosses defeated
3. final act reached
4. lives remaining
5. aggregate lane differential
6. final roster PEAK3 total
7. published credit-efficiency rule
8. active play time only as final tie-breaker

Tutorial time and network latency never count.

## Experience

- invite landing page;
- opponent display name;
- challenge status;
- spoiler-safe until both complete;
- side-by-side final receipt;
- rematch;
- profile history.

Challenge play must not consume a daily attempt.

---

# 7. Ownership and IDOR hardening — P0 release blocker

Before enabling PvP, fix all documented ownership weaknesses.

At minimum inspect:

```text
POST /draft/games/{id}/actions
perfect_season.py mutation endpoints
all game/run/attempt/match mutation routes
```

Rules:

- possessing an ID never grants mutation rights;
- authenticated rows require `auth.uid() = owner_user_id`;
- anonymous games require a high-entropy server-bound ownership token;
- challenge tokens permit only intended read/play behavior;
- public result viewing never implies mutation;
- daily-attempt consumption is tied to the owner;
- no cross-user actions, saves, deletes, or result writes;
- two-tab actions remain idempotent.

Add adversarial tests for:

- attacker with victim game ID;
- attacker with victim attempt ID;
- challenge recipient mutation;
- anonymous token swap;
- forged user ID in payload;
- replayed action;
- stale action version.

Do not report completion while a known mutable IDOR remains.

---

# 8. Global footer and beta information pages

Add a responsive global footer to public pages.

## Suggested links

### Play

- Run the Table
- 82–0 Peak Season
- Daily Grid
- Peak Duel
- Rankings

### Learn

- Methodology
- Data Sources
- Changelog
- Accessibility

### Legal

- Terms of Use
- Privacy
- Contact

Footer line:

```text
© {current year} PEAK3 Arena
```

Add an accurate disclaimer:

> PEAK3 is an independent basketball analytics project and is not affiliated with or endorsed by the NBA or its teams. Team names, marks, and logos belong to their respective owners.

Do not make broader legal claims unsupported by review.

## Terms and Privacy

Create beta drafts based on actual behavior:

- account data stored;
- OAuth/email providers;
- game results/history;
- telemetry;
- cookies/localStorage;
- retention;
- deletion/contact process;
- third-party services;
- no-sale-of-data statement only if accurate;
- chosen age requirement;
- analytics/game disclaimer;
- prohibited abuse;
- availability limitations.

Mark source comments for legal review before public launch. Do not claim GDPR, CCPA, COPPA, SOC 2, or other compliance unless established.

Also create:

- accessibility statement;
- actual data-sources page;
- methodology/model-release link;
- contact route.

---

# 9. Tests and audits

## Daily Grid

- adjacent keys distinct seed/hash;
- current result never loads prior attempt;
- midnight PT;
- cache invalidation;
- explicit timer start;
- tour excluded;
- two-tab start idempotency;
- replay tour;
- mobile/keyboard/reduced motion.

## RUN THE TABLE

- 5 acts / 10 decisions / 5 bosses / 3 lives / 50 credits;
- deterministic opening reveal;
- skip/reduced motion;
- market refresh;
- reserve card;
- role focus;
- Film Room actions;
- credit accounting;
- state versioning;
- old challenge compatibility;
- early elimination;
- final boss required for clear.

## PvP

- same seed inputs;
- divergent deterministic choices;
- invite security;
- spoiler safety;
- winner ordering;
- tie-breakers;
- rematch;
- history;
- no daily consumption.

## Security

All ownership/IDOR tests above, including real Postgres/RLS where relevant.

## Balance

Run at least 100,000 seeds per policy:

- random legal;
- greedy overall;
- lane-aware;
- economy-aware;
- look-ahead;
- Film Room-aware;
- credit-spending.

Emit:

```text
docs/implementation/run-the-table-balance-v3.json
```

## Full suites

Surface exact output for:

- model;
- lineup;
- API;
- real Supabase integration/RLS;
- Vitest;
- Playwright;
- typecheck;
- lint with zero warnings;
- production build.

---

# 10. Browser verification

Capture and inspect:

1. current Daily Grid on both sides of simulated midnight PT;
2. first-time Grid start gate;
3. each tour step;
4. timer start;
5. replay via `?`;
6. opening roster reveal;
7. all three Film Room choices;
8. market refresh;
9. five-act map;
10. early elimination;
11. Table Clear;
12. challenge creation;
13. challenge recipient;
14. side-by-side PvP result;
15. footer desktop/mobile;
16. Terms;
17. Privacy;
18. Accessibility;
19. Data Sources.

Use production build and real API/database.

---

# 11. Deliverables

Create:

```text
docs/implementation/DAILY_RTT_PVP_SECURITY_PLAN.md
docs/implementation/DAILY_RTT_PVP_SECURITY_REPORT.md
docs/implementation/daily-grid-freshness-audit.json
docs/implementation/run-the-table-balance-v3.json
docs/implementation/daily-rtt-pvp-review/
```

The report must include:

- exact stale-grid root cause;
- adjacent-day seed/hash evidence;
- timer contract;
- tutorial behavior;
- RUN THE TABLE v2 → v3 changes;
- economy metrics;
- Film Room before/after;
- PvP fairness model;
- ownership/IDOR fixes;
- footer/legal scope;
- exact tests;
- screenshots;
- limitations;
- final git state;
- confirmation of no commit/push/PR/merge/stash.

