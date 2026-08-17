# PEAK3 Pass 1 — gameplay + interaction correctness — progress

Branch: `main` (working tree only — **nothing committed, per instruction**).
Started from `d7aff08` (HEAD at start of this pass; still HEAD, no commits made).

## Status: complete and green, not committed

All four modes (Run the Table, $20 Showdown, Three-Man Weave, Peak Duel Daily)
implemented and verified locally. See the final report delivered to the user
in-conversation for the full writeup (root causes, before/after semantics,
file-by-file changes, test counts, the two product decisions the user made
mid-pass, and the SAFE-for-Pass-2 recommendation). This file is the
continuation anchor if a future session needs to pick the work back up
before it's committed.

## Verification, last run clean

- `scripts/ci/model-tests.sh`: 1806 passed, 1 xfailed
- `scripts/ci/api-unit-tests.sh`: 1779 passed, 2 skipped, 15 deselected
- `scripts/ci/frontend-verify.sh` (typecheck, lint 0 warnings, vitest, prod build): green, 2057/2057 unit tests
- Targeted Playwright e2e (`run-the-table`, `arena-multiplayer`, `showdown-two-tab`,
  `gameplay`, `daily-challenge`, `duel-viewport`): all green after one fix
  (see below)
- `git diff --check`: clean

## The one bug caught by e2e that unit tests missed

RTT's boss-auto-reveal (the fork's own new test) failed in a real browser:
reloading mid-presentation dropped the player straight to the boss briefing
instead of resuming the reveal, because `bossSequence.started` and the two
dismissal ids (`dismissedBossIntroId`/`dismissedBossRevealId`) are plain
component state, gone on remount, while the server's `boss.complete` flips
true the instant the one-shot batched reveal POST resolves — long before the
paced local presentation or a Continue click. Fixed in
`RunTheTableGame.tsx`'s `bossActive`/`bossIntroDone` derivation: treat
`bossTrack.revealed > 0` (server truth) as proof the presentation already
began, gated on `status === "boss_ready"` so it can never fire once play has
moved past that status (a first attempt without the status gate broke two
unrelated existing tests whose fixtures keep a stale `reveal.boss` block
around after the battle resolves). One pre-existing unit test's expectation
changed as a deliberate, explained consequence (see the test's own comment) —
not an accidental rewrite.

## Two product decisions the user made mid-pass (both implemented as given)

1. **$20 Showdown**: normal-market lots now require candidates legal for
   BOTH incomplete rosters (intersection, not the old union rule). When that
   intersection empties but completion is still required, the engine
   transitions to an explicit `PHASE_LOT_FORCED_FILL` state — never a market
   skip, priced by `forced_fill_reserve_price()` (tier-banded off observed
   contested prices, not a flat $1), capped by the existing reserve ceiling.
2. **Three-Man Weave**: server-visible staged pick (`tmw_stage_pick`),
   survives refresh/reconnect, timeout drafts the staged choice when legal
   else the existing `auto_pick` fallback, race-safe via the existing
   `expected_state_version` mechanism.

## What's deliberately deferred to Pass 2/3 (do not build without the user)

- RTT: the reveal animation's final visual polish (Pass 3, per the user's
  own instruction).
- RTT: a soft balance-audit signal (passive/zero-decision play clears 2.6%
  of runs vs. the harness's own 2% threshold) — flagged, not acted on; no
  named failure mode in the brief matched it.
- Peak Duel Daily: the lifetime 0/10–10/10 distribution graph UI and any new
  GET route to read back accumulated history — only the write path
  (`POST /game/daily/result`, now actually called by the frontend) was
  wired up this pass, per explicit scope boundary.
- $20 Showdown: no pricing-model redesign beyond the forced-fill tier bands;
  `BOT_THINK_SECONDS` left untouched (the poll-kick fix was sufficient).

## Do not re-litigate

- The $20 union-vs-intersection eligibility rule and the TMW staged-pick
  server-visibility requirement are **user decisions**, not open design
  questions — see above.
- RTT lane semantics (`player_lineup_rating`/`boss_lineup_rating` as the
  primary YOU-vs-BOSS numbers, `top_contributor` secondary) were already
  correct going into this pass (prior work, PR #17) — this pass only added
  a regression lock, it did not rebuild anything.
- Round-10 in Peak Duel Daily stays manual ("See results") by deliberate
  choice — auto-advancing rounds 1-9 was extended to 10 and rejected.

## Known limits carried forward

- e2e was run for the four touched modes' spec files, not the full suite
  (explicit instruction: local only, do not spend CI minutes broadly).
- "Manual exercise" of the four flows was done via real-browser Playwright
  runs against a live local API + web server, not literal hands-on clicking
  by a human — flagged as such in the final report rather than overclaimed.
