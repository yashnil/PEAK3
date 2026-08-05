# RUN THE TABLE — Frontend Architecture Audit

Author: teammate "rtt-experience" (Phase 1, audit only — no product changes in this pass).
Scope: `apps/web/src/components/run-the-table/**`, `apps/web/src/lib/run-the-table-*.ts`,
`apps/web/src/types/run-the-table.ts`, RTT route files under
`apps/web/src/app/(main)/arena/run-the-table/**`, and (read-only, for the identity-leak
proof) `apps/api/app/services/run_the_table/public.py` and
`nba_peak/run_the_table/{state,generation}.py`.

Branch: `wt/arena-rtt`. This document reports what exists today; it recommends nothing
about implementation approach beyond what's asked (shared-primitives ownership split).

---

## 1. State machine: state → component → API-call map

RTT has **no client-side reducer, no context provider, and no server round-trip logic
duplicated per-node.** All state lives in one `useState<RunPublicState | null>` in
`RunTheTableGame.tsx:171`, and every mutation replaces that object wholesale with the
server's response (`commit()` at `RunTheTableGame.tsx:224-227`). There is no optimistic
update anywhere in the tree — the docstring at `RunTheTableGame.tsx:65-77` states this
explicitly and the code matches it.

The "state machine" is really two independent small ones:

- **Screen derivation**: `screenForStatus(state.status)` in
  `apps/web/src/lib/run-the-table-state.ts:205-221` — a pure switch from the server's
  `RunStatus` enum to one of six `RunScreen` values. One status, one screen, always.
- **Reveal override**: `needsOpeningReveal(state)` and `needsBossReveal(state)`
  (`run-the-table-state.ts:242-262`) — these *pre-empt* the screen above. A reveal
  occupies another screen's slot (e.g. the roster reveal displaces `system_select`),
  which is why `surfaceKeyFor` (`RunTheTableGame.tsx:1051-1060`) checks them before
  falling back to `screenForStatus`.

### Node/stage → component → API map

| `RunStatus` / gate | `RunScreen` | Component rendered | Action(s) it can POST |
|---|---|---|---|
| `system_select`, act 1, roster reveal incomplete | (reveal override) | `RevealReel` (kind="roster") | `reveal` |
| `boss_ready`, boss reveal incomplete | (reveal override) | `RevealReel` (kind="boss") | `reveal` |
| `system_select` | `system_select` | `SystemSelect` | `select_system` |
| `node_select` | `node_select` | `NodeChoice` | `choose_node` |
| `node_active` + `node_type=draft_room` | `node_active` | `DraftRoom` + `CreditSinks` | `draft_buy`, `draft_pass`, `market_refresh`, `emergency_recovery` |
| `node_active` + `node_type=trade_desk` | `node_active` | `TradeDesk` + `CreditSinks` | `trade`, `decline_trade`, `market_refresh`, `emergency_recovery` |
| `node_active` + `node_type=film_room` | `node_active` | `ScoutPrepare` | `film_room` (choice=scout_boss\|shape_market\|reserve_card) |
| `node_active` + `node_type=rest_bank` (or any other) | `node_active` | `ChoiceNode` + `CreditSinks` | `rest_bank`, `market_refresh`, `emergency_recovery` |
| `boss_ready` (reveal already complete) | `boss_preview` | `BossPreview` | `resolve_boss` |
| `boss_resolved` | `battle` | `BattleReveal` | `advance` |
| `complete` \| `failed` | `result` | `RunResult` | (reads `createChallenge` via `onChallenge`) |
| status the client doesn't recognise / payload block missing | (fallback, `RunTheTableGame.tsx:898-926`) | inline `role="alert"` box | `getRun` (reload) |

Persistent, non-screen surfaces rendered on **every** status (RunTheTableGame.tsx
Zones 1/3, lines 944-1037): `RunMap` (left rail / `RunProgressStrip` on mobile),
`RunTray` (credits/lives/roster/perks/lane profile), `MobileTray` (sticky mobile
footer). These are not part of the screen switch — they're always mounted alongside
whatever `surface` is showing. **This is exactly what causes finding §3 below.**

`SystemSelect`, `NodeChoice`, `DraftRoom`, `TradeDesk`, `ScoutPrepare`, `ChoiceNode`,
`BossPreview`, `BattleReveal`, `RunResult` all receive slices of `state` as props and
call the `act()`/`run()` closures passed down from `RunTheTableGame` — none of them
call `run-the-table-api.ts` directly (verified: no `fetch(`/`await get`/`await post`
call sites in any component file other than `RunTheTableGame.tsx`).

---

## 2. API surface RTT consumes

All requests go through `apps/web/src/lib/run-the-table-api.ts`'s `rttFetch()`, which
prefixes `/api/v1`, attaches the bearer token when signed in, and throws a typed
`RunTheTableAPIError` (status `0` for network failure, distinguishable from a real
HTTP status).

| Function | Method + path | Mutation? | Fires when |
|---|---|---|---|
| `getRunReadiness()` | `GET /run-the-table/readiness` | no | once, in `boot()` |
| `getDailyRun()` | `GET /run-the-table/daily` | no | once in `boot()`, again on daily rollover (`useDailyReset` → `boot()`) |
| `getChallenge(token)` | `GET /run-the-table/challenges/{token}` | no | once in `boot()`, only if a `challengeToken` prop is present |
| `getRulesetMeta()` | `GET /run-the-table/meta` | no | once, in `boot()` |
| `getRun(runId)` | `GET /run-the-table/runs/{id}` | no | resume path in `boot()`; also the "Reload the run" fallback button |
| `createRun(type, opts)` | `POST /run-the-table/runs` | **yes** | `handleStart`, `handleRunItBack`, `handleReplaySeed`, and the `?start=standard` deep-link effect |
| `postRunAction(runId, body, key)` | `POST /run-the-table/runs/{id}/actions` | **yes** | every `act()` call — see the map in §1 |
| `createChallenge(runId)` | `POST /run-the-table/runs/{id}/challenge` | **yes** | `handleChallenge`, called from `RunResult`'s share button |

`boot()` (`RunTheTableGame.tsx:230-331`) fires the four reads via `Promise.allSettled`
in parallel — readiness failure is fatal, the other three degrade gracefully.

### The opening reveal round-trip count — proven from the code

**Yes, revealing all 7 roster slots by clicking "Reveal next player" is 7 separate
API round trips** — one `POST /run-the-table/runs/{id}/actions` per card, each with
`{action_type: "reveal", target: "roster", count: 1}`.

Proof, `RunTheTableGame.tsx:625-631`:
```ts
const reveal = (target: "roster" | "boss", count: number): void => {
  act(
    runActions.reveal(target, count),
    `reveal:${target}:${state.action_count}`,
    count > 1 ? "Roster revealed." : "Revealed.",
  );
};
```
and `RevealReel.tsx:162-171`, the "Reveal next player" button:
```tsx
<button ... onClick={() => onReveal(1)} ...>
  {kind === "roster" ? "Reveal next player" : "Reveal next"}
</button>
```
Each click is `act(runActions.reveal("roster", 1), ...)`, which is
`postRunAction()` — one network call per card. `runActions.reveal` is defined at
`run-the-table-api.ts:247-251`.

The only way to collapse this to one round trip is the **"Skip all"** button
(`RevealReel.tsx:175-190`), which sends `count = skipAllCount(track)` — the true
remainder — in a single POST; the engine "saturates" (accepts a count beyond what's
left) so this is legal in one call. But skip-all only appears after the first card
is already on the table (`track.can_skip`, server rule `0 < revealed < total`), so
the *minimum* possible round-trip count for a full reveal is **2** (reveal 1, then
skip the remaining 6), and the default click-through path a first-time player is
shown is **7 one-card-at-a-time POSTs**. Same shape applies to the boss reveal
(7 slots, `RevealReel.tsx` reused with `kind="boss"`).

There is no batching, no debounce, and no prefetch-next-card — each reveal is a
full `RunPublicState` round trip, discarded down to one new card.

---

## 3. IDENTITY LEAK — confirmed, and it is a backend contract issue, not presentational

**This is real, and it is the single most important finding in this audit.** The
server sends the full identity of every roster slot — name, exact 3-year window,
`prime_score`, lane percentiles, everything `card_public()` produces — in the **top
level** `starters`/`bench` arrays of `RunPublicState`, unconditionally, from the
moment the run is created, regardless of how far the opening-roster reveal has
progressed. The frontend then renders that array without checking reveal state.
The reveal animation is decorative; the spoiler is already in the payload and
already on screen next to it.

### Backend: `state.starters[i].card_id` is set at run creation, not at reveal time

`nba_peak/run_the_table/generation.py:252-261` (`generate_blueprint`) calls
`generate_starting_roster(pool, seed)` once, up front, to build the whole 5+2 roster
before the run's first status is ever computed. The reveal mechanism
(`state.reveal_index`) is a **separate counter** that only gates the `reveal` block
of the payload — it does not gate whether `card_id` exists on the roster slot.

`apps/api/app/services/run_the_table/public.py:111-117`:
```python
def _slot_public(pool: CardPool, slot, systems: list[str]) -> dict:
    return {
        "slot_id": slot.slot_id,
        "role": slot.role,
        "is_starter": slot.is_starter,
        "card": card_public(pool, slot.card_id, systems) if slot.card_id else None,
    }
```
This is called unconditionally for every slot in `public_state()`:
`apps/api/app/services/run_the_table/public.py:698-699`:
```python
"starters": [_slot_public(pool, s, state.systems) for s in state.starters],
"bench": [_slot_public(pool, s, state.systems) for s in state.bench],
```
There is no `if revealed:` guard here. `card_public()` (`public.py:85-108`) returns
`player_name`, `start_season`/`end_season`/`anchor_season`, `window_label`,
`prime_score`, `overall_percentile`, `lane_index`, `lane_percentiles`, `cost` — the
complete identity, on **every** `GET /run-the-table/runs/{id}` and every
`POST .../actions` response, starting with the very first response the client ever
receives (act 1, `system_select`, roster reveal at 0/7).

**The engine already knows the correct pattern and simply didn't apply it here.**
Compare `boss_public()`, `public.py:125-164`:
```python
def boss_public(pool, boss, revealed, systems):
    """... Unrevealed bosses expose only act, name and rule — enough to plan
    against, never the exact roster."""
    out = {"boss_id": ..., "name": ..., ..., "revealed": revealed}
    if revealed:
        out["starters"] = [card_public(pool, cid, []) for cid in boss.starter_ids]
        out["bench"] = [card_public(pool, cid, []) for cid in boss.bench_ids]
        out["lane_profile"] = [...]
    return out
```
The boss path correctly withholds `starters`/`bench`/`lane_profile` until
`revealed` is true. `reveal_public()` (`public.py:371-437`, the dedicated reveal
block used to drive `RevealReel`) is *also* correct: it only ships
`revealed_slots: slots[:revealed]` and the unrevealed `order` array carries no card
data at all (`{"order", "slot_id", "label"}` only — see `public.py:397-401`). So two
of the three roster-adjacent payload paths in this file already implement
spoiler-safety correctly. The **top-level `RunPublicState.starters`/`.bench` fields
are the one path that doesn't**, and that's the one `RunTray` renders.

Also worth flagging as a secondary, lower-severity instance of the same root
cause: `public_state()` computes `lane_profile`/`roster_total`/`bench_weight` from
`player_lane_profile(pool, starters, bench, ...)` over the **full, real** roster
(`public.py:650-655`) regardless of reveal progress — so even where a name isn't
printed, the aggregate lane numbers in `RunTray`'s collapsible lane-profile panel
are already the true post-reveal numbers before a single card has been shown. Not
a name/identity leak, but the same "reveal gate doesn't reach this payload" defect.

### Frontend: `RunTray` renders `state.starters`/`state.bench` unconditionally, next to the reveal

`RunTray` is mounted in **Zone 3**, which is *not* part of the screen switch — it's
rendered on every status, alongside whatever `surface` currently shows
(`RunTheTableGame.tsx:1035-1037`):
```tsx
<div className="rtt-zone-right rtt-zone-right-fluid">
  <RunTray state={state} laneProfileRelevant={screen === "boss_preview" || screen === "battle"} />
</div>
```
`RunTray.tsx:42-43` builds the roster straight from props with no reveal check:
```tsx
export default function RunTray({ state, laneProfileRelevant = false }: Props) {
  const roster = [...state.starters, ...state.bench];
```
and renders each slot's real name/score whenever `slot.card` is non-null
(`RunTray.tsx:151-171`):
```tsx
{slot.card ? (
  <>
    <PlayerAvatar name={slot.card.player_name} size={22} />
    <span className="flex flex-col min-w-0">
      <span className="truncate text-[11px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {slot.card.player_name}
      </span>
      <span className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
        {slot.card.window_label}
      </span>
    </span>
    <span className="score-number ml-auto shrink-0 text-[11px]" style={{ color: "var(--peak-accent)" }}>
      {slot.card.prime_score.toFixed(1)}
    </span>
  </>
) : ( <span>Empty</span> )}
```
Because the backend populates `card_id` for every slot at run creation (§ above),
`slot.card` is non-null for all 7 slots from the very first frame — including the
frame where `RevealReel` is on screen in Zone 2 titled "Meet your roster" with
`0 of 7 revealed`. **The full roster — all 7 names, all 7 exact 3-year windows,
all 7 `prime_score` values — is already visible in the right-hand rail while the
center column is still animating a face-down card.** A player never has to click
anything to see the spoiler; it's rendered on the same screen, at the same time,
by a sibling component that has no idea a reveal is in progress.

`MobileTray` is **not** affected: `rosterPips()` (`run-the-table-state.ts:907-917`)
only returns `{slot_id, filled, is_starter}` — no card fields — so the mobile
sticky footer shows filled/empty pips, never a name. This makes the leak
desktop/tablet-width specific (wherever `.rtt-zone-right` renders instead of
folding into `.rtt-zone-right-fluid` mobile flow) — but the same unguarded payload
would leak the moment any future surface reads `state.starters`/`state.bench`
directly, on any viewport, so the fix has to be on the payload, not the render site.

### Is this presentational-only, or does the API send it? → **API sends it.**

This is **not** a case where the server correctly withholds data and a client bug
merely mishandles a `null`. The server sends the real `card_public()` object for
every roster slot on every response, independent of `reveal_index`. Fixing this
requires a **backend contract change**: `_slot_public()` (or its caller in
`public_state()`) needs to withhold `card` for a `starters`/`bench` slot whose
index is beyond the player's `reveal_index`, mirroring exactly what `boss_public()`
already does with its `revealed` flag. **This must be routed to teammate
"score-integrity"** (or whichever teammate owns `apps/api/app/services/run_the_table`)
— it is out of scope for `rtt-experience` to fix under this workstream's file
ownership (`apps/web/src/components/run-the-table/**` only), and it is not solely
a frontend fix: even a `RunTray` that adds a reveal-index gate would be
defense-in-depth over data that's already in the browser's network tab, devtools,
and React DevTools props inspector — a determined player (or just "open Network
tab") sees every card instantly regardless of what the UI hides.

Recommended contract (for the lead/score-integrity to decide, not implemented
here): `_slot_public` should accept the player's `reveal_index` (roster) and gate
`card` the same way `boss_public` gates on `revealed`; `public_state()` should pass
`state.reveal_index` through. The `reveal_public()`/`RevealReel` path already
proves the team knows how to do this correctly — it's a matter of applying the same
rule to the second payload path that also carries the roster.

---

## 4. Battle rendering — number → API field map (`BattleReveal.tsx`)

Every number in `BattleReveal.tsx` traces to a field on `BattlePublic`
(`types/run-the-table.ts:252-273`) or `BossPublic` — nothing is computed
client-side beyond formatting/counting already-decided values
(`run-the-table-state.ts`'s docstring: "Nothing here decides a lane, breaks a tie,
or re-derives an outcome").

| Rendered text (example) | Source expression | API field |
|---|---|---|
| "Your five vs {boss name}" | `boss?.name ?? battle.boss_id` | `BossPublic.name` / `BattlePublic.boss_id` |
| "First to {N} of five component lanes" | `lanesToWin` prop | `RunPublicState.lanes_to_win` (or `battle.lanes_to_win` override — `RunTheTableGame.tsx:883`) |
| "Rule in force · {name} — {summary}" | `boss.rule.name` / `.summary` | `BossPublic.rule` (`BossRule`) |
| Lanes-won tally (e.g. "3 — 2") | `runningSeries(battle.lanes, revealed)` (pure count of `winner`) | `BattleLanePublic.winner` per lane |
| Per-lane bar values, e.g. "27.2" | `lane.player_score.toFixed(1)` / `lane.opponent_score.toFixed(1)` | `BattleLanePublic.player_score` / `.opponent_score` |
| Per-lane label ("Statistical Impact") | `lane.label` | `BattleLanePublic.label` |
| Lane winner tag ("You"/"Them"/"Tied") | derived from `lane.winner` | `BattleLanePublic.winner` |
| "This lane was level on totals; {rule} decided it" | gated on `lane.tie_broken_by_rule` | `BattleLanePublic.tie_broken_by_rule` |
| Top contributor per lane, e.g. "Victor Wembanyama" | `lane.player_top_card?.player_name` / `lane.opponent_top_card?.player_name` | `BattleLanePublic.player_top_card.player_name` / `.opponent_top_card.player_name` (a full `RunCardPublic`, only `player_name` is read here) |
| Verdict stamp ("VICTORY"/"DEFEAT"/"DRAW") | `battleVerdict(battle).stamp`, from `battle.outcome` | `BattlePublic.outcome` |
| Verdict detail ("3–2 on lanes. Decided on lanes won.") | `battleVerdict(battle).detail`, `DECIDED_BY_LABELS[battle.decided_by]` | `BattlePublic.player_lanes_won`, `.opponent_lanes_won`, `.decided_by` |
| Decisive-lane sentence | `decisiveLane(battle, lanesToWin)`, pure scan of `battle.lanes` in order | `BattleLanePublic.winner` (counted, not re-derived) |
| "Summed lane margin 4.30" | `battle.summed_margin.toFixed(2)` | `BattlePublic.summed_margin` |
| "roster totals 412.3 vs 401.9" | `battle.player_roster_total` / `.opponent_roster_total` | `BattlePublic.player_roster_total` / `.opponent_roster_total` |
| "bench weight 0.65" | `battle.bench_weight.toFixed(2)` | `BattlePublic.bench_weight` |
| "N credits awarded" / "N lives remaining" | `battle.credits_awarded` / `battle.lives_after` | `BattlePublic.credits_awarded` / `.lives_after` |

`example.g. "27.2 — Victor Wembanyama"` the lead's prompt described maps to two
separate fields rendered in two separate DOM nodes in the same lane `<li>`: the
score (`lane.player_score`/`lane.opponent_score`, top row) and the top contributor
name (`lane.player_top_card.player_name`/`lane.opponent_top_card.player_name`,
second row, `BattleReveal.tsx:288-299`) — they are not concatenated by the client,
each is printed from its own field.

---

## 5. Animation / motion inventory

- **Library**: `motion` (Motion One's React package, formerly Framer Motion),
  `^11.18.2` in `apps/web/package.json:26`. Imported as `import { motion } from
  "motion/react"` (e.g. `RunTheTableGame.tsx:3`, `RevealReel.tsx:2`,
  `BattleReveal.tsx:2`).
- **`prefers-reduced-motion` handling** — two parallel mechanisms, both present in
  the RTT tree:
  - `usePrefersReducedMotion()` from `@/lib/a11y` (`a11y.ts:249`) — a hook that
    presumably subscribes to the media query (used in `RunTheTableGame.tsx:197`,
    `RevealReel.tsx:61`).
  - `useReducedMotion()` from `motion/react` directly (used in `BattleReveal.tsx:3,58`).
  Both collapse to the same effect: `initial={reducedMotion ? false : {...}}` skips
  the enter animation entirely rather than playing a shortened version, and timed
  sequences (`BattleReveal`'s lane-by-lane stagger) fall back to `instant = reduced
  || skipped`, rendering everything on first paint. This is applied consistently —
  every animated surface in the audited files (`RunTheTableGame`'s surface
  transition, `RevealReel`'s card enter, `BattleReveal`'s lane stagger and verdict
  stamp) has a reduced-motion branch. `motionTransition("base", "out",
  reducedMotion)` (`@/lib/motion`) is the shared helper that encodes "zero-length
  under reduced motion" once, reused by `RunTheTableGame.tsx:1010` and
  `RevealReel.tsx:115`.
- **Manual click-through where automatic pacing might be wanted**:
  - `RevealReel` (`RevealReel.tsx:160-190`): **fully manual**. "Reveal next
    player" requires one click per card (and one network round trip — see §2);
    there is no auto-advance, no timer, no auto-play toggle. "Skip all" is the
    only way to avoid per-card clicking, and it discards the reveal animation
    entirely rather than playing it faster.
  - `BattleReveal` (`BattleReveal.tsx:62-77`): this one **is** automatically
    paced — a `setInterval` at `STEP_MS` (90ms stagger × 1000) advances
    `revealed` through all lanes without user input, with a manual "Reveal
    instantly" skip button (`BattleReveal.tsx:156-168`) for anyone who doesn't
    want to wait. So the two reveal-shaped surfaces in RTT use opposite pacing
    models today: the opening/boss roster reveal is click-per-card, the battle
    lane reveal is auto-play-with-skip. Any "cinematic sequence" work in Phase 3
    should treat this inconsistency as a known starting condition, not something
    this audit is asserting should change.
  - `RunTheTableGame.tsx`'s screen-to-screen transition (`motion.div` keyed on
    `surfaceKey`, lines 1006-1013) is a passive enter-only animation triggered by
    state change, not a user-paced sequence.

---

## 6. Existing RTT test inventory (must keep passing)

Ran in this worktree (`cd apps/web && npx vitest run <files>`), all green:

| Suite | File | Tests | Status |
|---|---|---|---|
| Vitest unit | `src/tests/unit/run-the-table-v3.test.tsx` | 48 | ✓ pass |
| Vitest unit | `src/tests/unit/run-the-table-copy.test.ts` | (in combined run below) | ✓ pass |
| Vitest unit | `src/tests/unit/run-the-table-state.test.ts` | (in combined run below) | ✓ pass |
| Vitest unit | `src/tests/unit/run-the-table-components.test.tsx` | 103 | ✓ pass |
| Vitest unit | `src/tests/unit/trade-desk.test.tsx` | 23 | ✓ pass |
| Vitest unit | `src/tests/unit/head-to-head.test.tsx` | 21 | ✓ pass |

Exact run output: `run-the-table-v3.test.tsx` + `run-the-table-copy.test.ts` +
`run-the-table-state.test.ts` + `run-the-table-components.test.tsx` together:
**4 files, 298 tests, all passed** (2.77s). `trade-desk.test.tsx` +
`head-to-head.test.tsx` together: **2 files, 44 tests, all passed** (1.33s).
**Combined RTT-owned vitest total: 342 passing tests**, none skipped.
(`npm install` was required first — this worktree had no `node_modules`.)

Playwright e2e (not run in this pass — needs the API/dev server up; counted
statically via `grep -c "test("` for inventory purposes only, not verified green):

| Spec | Approx. test count | RTT relevance |
|---|---|---|
| `src/tests/e2e/run-the-table.spec.ts` | 14 (871 lines) | RTT-only spec — full run flow, resume, reveals, node types |
| `src/tests/e2e/play-routing.spec.ts` | 31 | shared across game modes; includes the `?start=` / no-run-on-bare-route RTT cases cited in `RunTheTableGame.tsx:213-215` |
| `src/tests/e2e/gameplay.spec.ts` | 35 | shared across game modes, not RTT-exclusive |
| `src/tests/e2e/accessibility.spec.ts` | 13 | shared axe sweep, includes RTT routes |

Also present but not RTT-exclusive: `src/tests/unit/guided-tour.test.tsx`,
`src/tests/unit/tour-state.test.ts` (RTT mounts `TourLauncher`/`Coachmark` but
doesn't own the tour system — see §7), `src/tests/e2e/auth.spec.ts`,
`src/tests/e2e/ranked.spec.ts`, `src/tests/e2e/daily-grid.spec.ts` (unrelated
game modes, not touched).

No RTT unit test currently asserts on the identity-leak finding in §3 (i.e.
nothing today asserts that `RunTray` or `state.starters`/`.bench` withhold
unrevealed card data) — this is a gap Phase 3 should close with a regression
test once the backend contract is fixed.

---

## 7. Shared primitives — ownership arbitration needed with "platform"

Everything RTT imports from outside its own directory
(`apps/web/src/components/run-the-table/**`, `apps/web/src/lib/run-the-table-*.ts`,
`apps/web/src/types/run-the-table.ts`), grepped from every RTT component/lib file:

| Import | What RTT uses it for | Proposed ownership |
|---|---|---|
| `@/components/court/PlayerAvatar` | roster row avatar (`RunTray.tsx:153`) | **platform** — cross-game shared component; RTT is a consumer only |
| `@/components/ui` (barrel: `AnimatedNumber`, and others) | `AnimatedNumber` for the credits tile (`RunTray.tsx:91`) | **platform** — generic UI kit |
| `@/components/ui/GuidedTour` (`TourLauncher`, `Coachmark`) | tour launcher mount + in-surface coachmarks (`RunTheTableGame.tsx:1024`, `BattleReveal.tsx:388`, referenced in `DraftRoom`/`TradeDesk`/`BossPreview` per the docstring at `RunTheTableGame.tsx:1078-1084`) | **platform owns the tour system**; **rtt-experience owns the `data-tour-id` placement contract** documented at `RunTheTableGame.tsx:1062-1085` — any platform change to `GuidedTour`'s API needs to preserve that id list or coordinate with this workstream |
| `@/lib/a11y` (`usePrefersReducedMotion`) | reduced-motion gating everywhere RTT animates | **platform** — shared a11y utility, RTT only calls it |
| `@/lib/motion` (`motionTransition`) | shared enter-transition timing helper | **platform** — shared motion helper; RTT is a consumer |
| `@/lib/analytics` (`analytics.track`, `AnalyticsEvent`) | `trackRunTheTable()` casts through this (`run-the-table-state.ts:1437-1442`) | **platform owns the closed `AnalyticsEvent` union**; RTT owns `RunTheTableAnalyticsEvent` and the one intentional widening cast — do not let platform's edits to `AnalyticsEvent` break the cast site without notice |
| `@/lib/auth` (`getAccessToken`) | bearer token attach in `rttFetch()` (`run-the-table-api.ts:65`) | **platform/auth owner** (not "platform" the UI teammate, but whoever owns `lib/auth.ts`) — RTT depends on `getAccessToken`'s null-on-signed-out / null-on-server contract exactly as documented at `run-the-table-api.ts:48-69` |
| `@/lib/use-daily-reset` | daily rollover detection (`RunTheTableGame.tsx:357-364`) | shared with Daily Grid / other daily modes — **not RTT-owned**, coordinate before changing its contract (`dailyKey`/`secondsRemaining`/`window`/`onReset`) |
| `@/lib/ordinal` (`ordinal`, `ordinalFixed`) | percentile/ordinal formatting (`run-the-table-state.ts:15`) | small shared util, low conflict risk either way |
| `src/styles/globals.css` (`--comp-*`, `--peak-accent`, `--correct`/`--incorrect`, `--bg-*`, `--text-*` design tokens) | every color in every RTT component reads these custom properties | **platform owns the token values**; RTT only ever references `var(--token)`, never redefines one. This is the highest-conflict-risk shared file — 1638 lines, touched by every feature |
| `src/styles/rtt-polish.css` (257 lines) | RTT-specific layout (`.rtt-zone-*`, `.rtt-decision-zone`, `.rtt-tap`, `.rtt-lock-in`, `.rtt-victory-accent`, etc.) | **rtt-experience owns this file outright** — it's RTT-namespaced already |
| `src/styles/tour.css` (404 lines) | tour spotlight/coachmark visuals | **platform** — shared across every feature the tour touches |
| `@/components/head-to-head/*` (`ChallengeCreator`, `HeadToHeadHistory`, `InviteLanding`, `MatchScreen`) + `@/lib/head-to-head-api.ts` | the `h2h` route pages under `arena/run-the-table/h2h/**` | These are RTT route-specific per the lead's file-ownership grant ("RTT route-specific files") but live in their own `components/head-to-head/` directory, not `components/run-the-table/`. **Flagging for the lead**: worth confirming h2h components are unambiguously `rtt-experience`'s and not a third owner's, since the directory split doesn't match the component-vs-route split cleanly. |

**Summary for the lead:** the one file with real day-to-day conflict risk between
`rtt-experience` and `platform` is `src/styles/globals.css` (design tokens) — every
RTT component reads from it, `platform` almost certainly needs to add/adjust tokens
for the overhaul. Recommend: platform adds/renames tokens, rtt-experience never
edits `globals.css` directly and only ever consumes `var(--x)`; changes to
`GuidedTour`'s public props should be flagged to rtt-experience before merge since
the `data-tour-id` contract in `RunTheTableGame.tsx` is load-bearing for W3's
existing spotlight/coachmark tests (`guided-tour.test.tsx`, `tour-state.test.ts`).
`rtt-polish.css` and everything under `components/run-the-table/` stay exclusively
rtt-experience's.

---

## Appendix: files read for this audit (unedited)

- `apps/web/src/components/run-the-table/RunTheTableGame.tsx`
- `apps/web/src/components/run-the-table/RunTray.tsx`
- `apps/web/src/components/run-the-table/RevealReel.tsx`
- `apps/web/src/components/run-the-table/BattleReveal.tsx`
- `apps/web/src/components/run-the-table/MobileTray.tsx` (grep only)
- `apps/web/src/lib/run-the-table-api.ts`
- `apps/web/src/lib/run-the-table-state.ts`
- `apps/web/src/types/run-the-table.ts`
- `apps/web/src/app/(main)/arena/run-the-table/page.tsx`
- `apps/api/app/services/run_the_table/public.py`
- `nba_peak/run_the_table/state.py` (`reveal_progress`)
- `nba_peak/run_the_table/generation.py` (`generate_starting_roster`/`generate_blueprint`, grep only)
- `apps/web/package.json`
