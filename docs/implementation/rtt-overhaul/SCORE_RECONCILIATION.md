# SCORE RECONCILIATION — lead synthesis

The full audit, the reconciliation script and its 75-row JSON output live on
`wt/arena-score` (commit `a35d703`) and are integrated in Phase 4. This file is
the **binding summary and the lead's arbitration** of that audit.

## 1. Verdict: no numerical defect

**The RTT lane math is correct.** Evidence, not inference:

- 3 deterministic seeds × 5 bosses × 5 lanes = **75 lane-battles** checked.
- In **75 of 75**, an independently recomputed weighted mean matched the
  engine's `player_score` / `opponent_score` **bit-identically**.
- Internally consistent with the canonical CSVs (sha256-verified) and with
  `OFFICIAL_WEIGHTS`.

**The defect is entirely in presentation**, and it is not an edge case:

- In **0 of 75** cases did the named top contributor's own lane value equal the
  number rendered directly above their name.
- So the misleading reading is what a player sees on essentially every lane of
  every battle.

No change to `OFFICIAL_WEIGHTS`, `calibrate_score()`, or any leaderboard CSV is
authorized by this audit, and none will be made.

## 2. What the number actually is

`nba_peak/run_the_table/battle.py:99-125`:

```
lane_score = Σ(wᵢ × lane_indexᵢ) / Σ(wᵢ)      starters wᵢ = 1.00, bench wᵢ = 0.35
```

- `lane_index` is a canonical PEAK3 component **rescaled to 0–100** across the
  eligible card pool. The rescale is linear and monotonic, so it never changes
  which roster is better in a lane.
- The aggregation is a **weighted arithmetic mean**, not a sum.
- It is roster-wide. It is not any individual's value.

### Arbitration: the label

The brief instructed "label values explicitly as LINEUP TOTAL". **Overruled on
evidence, with the product owner's approval.** Two reasons:

1. The quantity is a mean. Calling a mean a "total" replaces one misattribution
   with another.
2. `roster_total` **already names a different quantity** in the engine
   (`battle.py:178-185`) — the weighted sum *across* the five lanes. Reusing
   "total" for the per-lane mean would collide with a live field name.

**Binding decision:**

| Concern | Ruling |
| --- | --- |
| Player-side label | `YOUR LINEUP RATING` |
| Boss-side label | `BOSS LINEUP RATING` |
| Definition (shown in UI, on disclosure) | "The bench-weighted average strength of the lineup in that PEAK3 component, normalized to a 0–100 scale." |
| API / UI contract field | `lane_rating` (per-lane) · `lineup_rating` where a single lineup-level rating is meant |
| `roster_total` | **Reserved** for the existing distinct engine quantity. Not reused, not renamed. |
| Contributor line | `TOP CONTRIBUTOR`, rendered with its **own** value from `card.lane_index` |

The contributor's own value is **already on the wire** via `card_public()`, so
showing both numbers side by side requires no engine work. Both fixes ship
together: relabel *and* show the contributor's own number. A label alone still
leaves two unexplained numbers adjacent to each other.

**No individual player label may visually own a roster-wide number.** This is a
Phase 5 rejection criterion, not a preference.

## 3. Provenance table (binding)

| Displayed as | Field | Classification |
| --- | --- | --- |
| Lane number, e.g. `27.2` | `lanes[i].player_score` / `opponent_score` | **normalized-component lineup rating** (bench-weighted mean of `lane_index`) |
| Name beneath it | `lanes[i].player_top_card.player_name` | individual — **but the adjacent number is not this player's value** |
| `LaneProfile` bars | `lane_profile[i].value` | lineup rating |
| Number beside a roster player's name | `card.prime_score` | genuine individual value — already correctly labeled |
| "roster totals X vs Y" | `battle.player_roster_total` | lineup aggregate across lanes (display / tie-break only) |
| "Summed lane margin" | `battle.summed_margin` | battle tie-break statistic, not a score |
| "bench weight" | `battle.bench_weight` | config coefficient |
| Run MVP "removing them costs X" | `receipt.run_mvp.marginal_contribution` | lineup **delta** — attributable to one player, but not that player's own score |
| "Best acquisition +X" | `receipt.best_acquisition.score_delta` | delta of two genuine individual values — correctly labeled |
| Daily / Practice / 82-0 scoring | `arena_points` | **disjoint system** — never referenced anywhere in `nba_peak/run_the_table/**`. No RTT number is ever an `arena_points` value. |

No PEAK3 score is computed in TypeScript on this surface; every number above
traces to a Python-computed field on the wire. This must remain true.

## 4. Opening-reveal identity leak — confirmed

`apps/api/app/services/run_the_table/public.py`:

- `_slot_public()` (`:111-117`) returns full `card_public()` identity whenever
  `slot.card_id` exists — **never gated on reveal state**.
- `public_state()` (`:698-699`) builds `starters` / `bench` from every slot
  through that function, so all 7 identities ship from the first frame.
- All 7 cards are drafted synchronously at run creation
  (`state.py:167,175-180`), so every slot is filled from the first paint.
- Lower-severity variant: top-level `lane_profile` / `roster_total` /
  `bench_weight` (`:710-721`) are computed from the full real roster, so
  aggregate strength foreshadows the reveal even with names hidden.

**The correct pattern already exists in the same file.** `boss_public()`
(`:159-174`) gates `starters` / `bench` / `lane_profile` behind `if revealed:`,
and `reveal_public()` (`:371-410`) correctly ships `revealed_slots:
slots[:revealed]` — its own docstring states the intent that `public_state()`
violates:

> "Slots past `next_slot` are omitted entirely — the whole point of a reveal is
> that the next card is not known yet, and shipping all seven would make the
> animation theatre over information the client already had."

This is a backend contract defect. `score-integrity` owns the fix; the frontend
must not paper over it by hiding data it still receives.

**Desktop-only leak.** `MobileTray.tsx:54-68` renders roster *pips* (filled dots,
no names), while `RunTray.tsx:130-177` renders full rows. The bug is invisible in
mobile QA — which is why it survived.

## 5. Leaderboard contract — corrected

`score-integrity` listed "migration never applied to hosted Supabase" as the
primary blocker, based on a migration-file header comment. **The lead verified
this against the live system and it is wrong:**

```
GET https://peak3-staging.up.railway.app/api/v1/perfect-season/leaderboard?limit=2
→ leaderboard_enabled: true, 2 rows, real UUIDs, created_at 2026-08-01
```

The tables exist and are populated on staging. The header comment is stale. The
hosted-migration state must be re-verified per environment, not read off a
comment.

**Pagination defect confirmed live**, not merely in code review: the same call
returned exactly `limit` rows with more available and `next_cursor: null`.

### What is already correct — do not regress it

| Item | Status |
| --- | --- |
| Authoritative score source | Server-recomputed. `SubmitRunRequest` carries **only** `game_id`. |
| Completion requirement | `status != "result_ready"` → 400; same eligibility function the UI reads. |
| Authenticated submission | `RequiredAuth` + explicit anonymous rejection → 401. |
| Ownership | `owner_sub != auth.sub` → 403. |
| Model / ruleset version | Recorded from server state, not client input. |
| Tie-breakers | `wins DESC, lineup_score DESC, respins ASC, created_at ASC` — SQL index matches the query's `ORDER BY`. |
| Duplicate submissions | `game_id UNIQUE`; returns the original record. Idempotent. |
| RLS | Enabled on all owner-scoped tables; submitted runs immutable by policy omission. |
| Cross-user access | No IDOR found. |

### Gaps to close in Phase 3 (task #7)

1. **Pagination** — compute and return `next_cursor`. The encoder already
   exists (`leaderboard_postgres.py:32-40`) and is simply never called from the
   route. The Ranked route in the same codebase does it correctly
   (`ranked.py:458`) — follow that. No test asserts on `next_cursor` today; add
   one.
2. **Personal placement** — no endpoint returns the caller's rank. Add one.
3. **Privacy / hide controls** — `is_public` is write-only-at-insert with no
   route to flip it, and there is no report path.
4. **Public-handle privacy** — `display_name` falls back to the **email
   local-part** (`perfect_season.py:602`). This publishes a possibly-identifying
   string derived from the account email, with no consent gate. Must become
   explicit opt-in; the non-consented fallback must be a neutral handle.
5. Keep `COURTBUILDER_LEADERBOARD_ENABLED` behavior intact and Ranked disabled.

Items 1–4 require no change to `OFFICIAL_WEIGHTS`, `calibrate_score()`, or any
CSV.

### Day boundary

82-0 is an all-time board per `mode`; no daily reset applies. The **official
application day boundary** for daily modes is midnight **America/Los_Angeles**,
via one shared function (`nba_peak/daily_key.py` → `run_the_table/daily.py:10-13`).
Any daily board must use that function — it exists precisely because this was
UTC in four places that disagreed.

### Mode separation

82-0, Daily, Practice, RTT and Ranked scores are **not** mixed today and must
not become mixed. `arena_points` is disjoint from every RTT number. RTT gets a
leaderboard only after its score contract is separately defined — **not in this
pass**. Ranked ships as "Coming Later" and stays disabled.
