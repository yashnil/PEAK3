# The $20 Showdown bot v5 — "formidable but beatable" recalibration

Branch `feature/game-feel-reconstruction`, 2026-09-06. Files changed:
`nba_peak/twenty_dollar/bot.py`, `nba_peak/twenty_dollar/config.py`
(`BOT_POLICY_VERSION` → `twenty_dollar_bot_v5`),
`tests/twenty_dollar/test_bot_calibration.py` (one test re-based),
`tests/twenty_dollar/test_bot_opponents.py` (new), `docs/design/GAME_FEEL.md`
(new "Bot v5" subsection). No game rule, no `state.py`, no `apps/web` change.

Harness: `botsim.py` (this directory), `grid.py` (parameter sweeps),
`bot_v4.py` (frozen copy of the v4 policy for the baseline). Raw 2,000-seed
outputs: `sweep_v4_2000_relabelled.md`, `sweep_v5_2000.md` (the shipped
configuration), plus `sweep_v5b_2000.md` / `sweep_v5c_2000.md` (two rejected
variants, see §6).

## 1. Harness and opponent definitions

`botsim.run_match` drives `nba_peak.twenty_dollar.state` one action at a
time — the same loop as `test_bot_calibration.py::_play` — with the bot in
seat `seed % 2` and the opponent in the other seat, so opening-seat advantage
cancels over a sweep. Every seat receives the projection `state.project`
builds for it plus the coarse public rank band (`config.rank_band`), exactly
what `mode._bot_private` gives the shipped bot; nobody sees `prime_score` or
`rank`. One shared `random.Random(seed ^ 0x5EED)` per match, as in the test
harness. Wins are scored on `state.final_scores` (a tie counts one half).

| opponent | definition |
|---|---|
| **rank-aware human proxy** | Reservation price by public band ($9 / $7 / $5 / $3 / $1.50 / $1 for 1-10 / 11-25 / 26-50 / 51-100 / 101-250 / 251-500) at the opening fair share of $3.20 discretionary per open slot, scaled ×0.4…×1.6 with its own money per slot; +10% for a single-fit candidate, +$0.30 for a C or PG need; Gaussian noise σ = $0.90; clamped to the reserve rule; spends 80% of discretionary on any ≤250 candidate when fewer than 2.5 lots per open slot remain; opens at $1 on any ≤250 candidate, skips 251-500 while it has more skips than open slots; never bids above its reservation. |
| **always max-raise** | Wants any top-100 fit (any fit once skips ≤ open slots) and bids `max_legal_bid` — the whole reserve-rule maximum — every time; passes otherwise. |
| **min opener** | Opens at the minimum on every candidate it can use (never spends a skip voluntarily) and only ever bids the legal floor, staying in a contested lot while the floor is inside a noise-free copy of the proxy's reservation. |
| **self-play** | The shipped policy in both seats. |

Reproduced v4 baseline (300 seeds, then 2,000): **proxy 79% / 78.2%, max-raiser
76% / 76.4%, min-opener 88% / 84.5%, self-play 50% / 50.0%**. The prior pass
reported 93 / 97 / 92 / 50. Self-play reproduces exactly; the three opponent
numbers are lower because these reconstructions are stronger than the lost
originals (the proxy scales its price with its wealth and spends down at the
end; the min-opener has a stopping price rather than min-raising to
bankruptcy). The proxy here is the yardstick the v5 band is calibrated on.

### Metric definitions

* **early blowout**: a seat's first two purchases both land inside the first
  6 lots, together cost ≥ 50% of the $20 budget, and that seat wins by ≥ 10
  points. **Heavy**: the same with ≥ 60% ($12+, the v4 double-star shape).
  "front-load" is the spend condition alone. Reported for the bot's seat and
  for either seat.
* **late premium underpriced**: a rank-1-25 candidate sold at lot ≥ 6 for ≤ $2
  while the other seat still had an open slot the candidate fits; the
  **locked-out** subset is where that seat's legal maximum bid was ≤ the
  sale price (it could not have competed). Counted in lots and in matches.
* **max single overpay**: the bot's largest (price − sweep median price for
  that band), with the price and seed.
* roster totals and spend are per match; p10/p50/p90 are percentiles over
  the 2,000 matches; win-rate CI is Wilson 95%.

## 2. v4 reproduction (2,000 seeds each, `bot_v4.py`)

| metric | vs proxy | vs max-raise | vs min-opener | self-play |
|---|---|---|---|---|
| bot win rate (95% CI) | 78.2% (76.3-80.0) | 76.4% (74.5-78.3) | 84.5% (82.8-86.0) | 50.0% (47.8-52.2) |
| bot roster total p10/p50/p90 | 307.7 / 340.5 / 371.9 | 306.6 / 340.2 / 378.9 | 307.2 / 338.7 / 371.3 | 309.1 / 339.1 / 374.4 |
| opp roster total p10/p50/p90 | 273.4 / 311.1 / 354.6 | 271.1 / 311.7 / 357.7 | 261.9 / 303.7 / 344.4 | 308.1 / 338.6 / 371.6 |
| bot spend p10/p50/p90 (mean) | 9 / 15 / 19 ($14.44) | 6 / 7 / 8 ($6.92) | 9 / 14 / 19 ($14.20) | 13 / 17 / 20 ($16.45) |
| early blowout (bot / any) | 13.8% / 16.2% | 0% / 7.1% | 16.7% / 18.2% | 10.0% / 18.8% |
| heavy blowout ≥$12 (bot / any) | 4.4% / 5.1% | 0% / 7.1% | 4.9% / 5.1% | 2.9% / 5.5% |
| late cheap premium lots (matches) | 120 (5.3%) | 688 (32.6%) | 76 (3.1%) | 265 (11.4%) |
| late locked-out premium lots (matches) | 112 (5.0%) | 688 (32.6%) | 72 (2.9%) | 244 (10.5%) |
| max single bot overpay | +$8 ($14, 11-25, r22, seed 1726) | +$2 ($3, 51-100) | +$6 ($12, 1-10, r2) | +$8 ($14, 11-25, r25, seed 155) |
| bot mean price 1-10 / 11-25 / 26-50 / 51-100 | 4.41 / 5.06 / 4.38 / 2.79 | 1.67 / 1.52 / 1.58 / 1.59 | 4.16 / 4.85 / 4.12 / 2.70 | 5.19 / 5.69 / 5.35 / 3.51 |
| mean auctioned lots | 11.9 | 12.9 | 11.3 | 13.3 |

The self-play bot-seat early-blowout rate is exactly the "~10%" the brief
describes; either-seat it is 18.8%.

## 3. Root causes of the two outliers

Traced on self-play seeds 2, 8, 12 (blowouts) with every valuation
intermediate printed (`botsim` + `valuation()`).

**Early two-star blowouts** came from the valuation, not the auction:

1. **The early replacement level was unreachable.** `_replacement_level`
   interpolated from 47 (late) to 64 (early) over `_REPLACEMENT_SPAN_CHANCES
   = 8` chances per slot. A fresh board offers `(24 + 4) × 0.55 / 5 ≈ 3.1`
   chances per slot, so at lot 0 the level was **51.4 points — below the
   101-250 band's own mean (57)**. Every top-100 candidate therefore looked
   27-40 points better than "what I could get otherwise" and priced at
   $7-9 on lot 0; a second star three lots later priced at $6 against a fair
   share of what was left. Two purchases, $12-15, by lot 3.
2. **Money had no option value.** The discretionary budget was everything
   above $1 per open slot; nothing in the price of the second star reflected
   the premium lots still to come. The pacing cap (55% of discretionary
   with five open) bound only the first purchase.
3. The opening jump raise and the star valuation itself (`_BAND_POINTS`)
   were not the cause: band points are the published band means, and the
   jump only shortens a walk-up the ceiling already allowed.

**Late premium players sold too cheaply** is the same defect seen from the
other side: after the double spend, seat budgets were $2 with one slot
open, so LeBron James (r2) went for $2 at lot 8 and Giannis (r8) for $4 —
the locked-out seat's legal maximum was the sale price. 10.5% of v4
self-play matches contain such a lot. It is not the seller "letting one go";
it is the buyer's earlier overspend removing the competition.

A third, quieter cause surfaced in v5 traces (seeds 1805, 683): on a dry
stretch of board, both seats filled three or four slots with $1 players in
the first seven lots (a 101-250 candidate was always within the opening
tolerance of the replacement level), then met the first star with one slot
and $15-17 each — a war to $15-16. The fix is the money-aware replacement
level (§4.3); the $16 that survives in the sweep (seed 683/1426) is
dead-money endgame play, not a valuation error.

## 4. Strategy changes (what and why)

All in `bot.py`; constants named so a reviewer can find each.

1. **Replacement curve re-based** (`_REPLACEMENT_EARLY` 64 → 57,
   `_REPLACEMENT_SPAN_CHANCES` 8 → 2.5). The early level is now reached at
   ~3.5 chances per slot, i.e. on a fresh board. A 51-100 peak is what a
   patient seat can expect from a market that draws 40% of lots from the
   top hundred; 57 rather than 64 because the opponent also bids for those.
2. **Liquidity reserve** (`_LIQUIDITY_PER_SLOT` 1.2, `_LIQUIDITY_SPAN_CHANCES`
   2.5, `_liquidity_per_slot`). Beyond the rules' $1 reserve the bot keeps up
   to $1.20 per OTHER open slot out of any single lot while there are
   chances left, decaying to nothing as the market runs out. The pacing cap
   and a hard cap both read the liquid amount. An early star is allowed
   ($7-8 for a 1-10 at lot 0), but the second is priced as what it costs the
   rest of the roster ($3-5).
3. **Money-aware replacement** (`_REPLACEMENT_MONEY_SLOPE` 0.8 pt/$, cap 8).
   The replacement level rises with discretionary money per open slot above
   the $3.20 opening fair share. A seat holding $8 a slot expects to win the
   next 51-100 peak, so it no longer fills slots with $1 101-250 players on a
   dry stretch. Measured: +11 points vs the max-raiser, +4 vs the
   min-opener, +3 vs the proxy (paid back with variation, item 7).
4. **Contest urgency** (`_CONTEST_URGENCY` {2: 0.75, 1: 0.5, 0: 0.5},
   `_contest_urgency`). From the opponent's public open slots and budget:
   once they are down to two open slots (or to the reserve, or full) a kept
   dollar is worth less, so the money rate and the liquidity reserve are
   scaled down and the money is spent while there is still someone to
   outbid. Mean spend vs the proxy $10.9 → $12.1 with no change in win rate.
   Replacement level is not scaled (what the market offers does not change).
5. **Pacing** (`_PACING_SHARE` {5: .55, 4: .65, 3: .80} → {5: .65, 4: .65,
   3: .85}) now applies to the liquid amount, so the effective early cap is
   similar to v4's for the first purchase and tighter for the second.
6. **Skip economy**: "skips running low" is now `skips < open_slots` (was
   `<=`, which fired on the very first lot with 5 skips and 5 open slots and
   made the bot open on anything at or near replacement from lot 0).
7. **Precision reduced, by a per-lot opinion** (`_opinion`,
   `_MISJUDGE_CHANCE` 0.22 each way, `_MISJUDGE_POINTS` 8, `_OPINION_SCALE`
   0.80-1.20, `_PACING_BLUR` ±0.14). Formed once per lot from a stream keyed
   on public facts only (candidate slug, lot index, deciding seat, both
   budgets): 22% of the time the candidate is read eight points (about half
   a band) better than the band says, 22% worse; the ceiling is scaled by
   ±20%; the pacing share is blurred. Held for the whole lot, so the bot's
   price is an opinion rather than a fresh draw per raise; deterministic, so
   `test_the_bot_replays_identically_from_the_same_seed` holds; and
   `decision_kind` (presentation) stays RNG-free. Per-raise jitter narrowed
   (`_JITTER` ±10% → ±6%) since the opinion carries the variance; stretch
   0.10 → 0.14, flinch 0.08 → 0.12.
8. **Opponent-budget awareness in the jump raise**: a two-dollar jump is never
   made against an opponent who could not legally answer the minimum
   (`_opponent_can_answer`, from the public budget through the reserve
   rule) — raising against nobody read as "forgot how money works".
9. Version: `BOT_POLICY_VERSION = "twenty_dollar_bot_v5"`, `bot_id`
   `twenty_dollar_v5`.

Kept unchanged: band points, roster fit premium, closeout premium, endgame
spend, `_wants_to_open` structure, `_decline`, think-time classification.

## 5. Before / after (2,000 seeds each)

| metric | v4 proxy | **v5 proxy** | v4 max | **v5 max** | v4 min | **v5 min** | v4 self | **v5 self** |
|---|---|---|---|---|---|---|---|---|
| bot win rate | 78.2% | **68.9%** (66.8-70.9) | 76.4% | **83.3%** (81.6-84.8) | 84.5% | **76.2%** (74.3-78.0) | 50.0% | **49.6%** (47.4-51.8) |
| bot roster total p10/p50/p90 | 307.7/340.5/371.9 | 301.3/333.4/370.9 | 306.6/340.2/378.9 | 312.1/348.1/386.7 | 307.2/338.7/371.3 | 301.8/333.0/370.1 | 309.1/339.1/374.4 | 303.8/334.4/369.9 |
| opp roster total p10/p50/p90 | 273.4/311.1/354.6 | 278.3/315.4/353.8 | 271.1/311.7/357.7 | 269.7/309.6/352.8 | 261.9/303.7/344.4 | 266.0/305.9/347.6 | 308.1/338.6/371.6 | 302.3/334.9/371.6 |
| margin p10/p50/p90 | -18.1/26.2/70.9 | -27.6/19.3/66.8 | -25.4/29.9/82.2 | -14.6/38.3/92.8 | -8.5/33.0/80.6 | -22.7/28.5/78.7 | -34.2/0.0/37.5 | -40.6/-0.4/41.5 |
| bot spend p10/p50/p90 (mean) | 9/15/19 ($14.44) | 6/12/17 ($11.72) | 6/7/8 ($6.92) | 6/7/8 ($6.71) | 9/14/19 ($14.20) | 6/11/17 ($11.50) | 13/17/20 ($16.45) | 9/15/19 ($14.51) |
| opp spend mean | $13.95 | $13.84 | $20.00 | $20.00 | $12.68 | $12.46 | $16.49 | $14.38 |
| front-load ≥$10 (bot / any) | 18.9% / 29.2% | 7.5% / 15.1% | 0 / 58.4% | 0 / 66.7% | 20.6% / 29.1% | 12.0% / 17.1% | 24.9% / 42.9% | 6.7% / 13.2% |
| early blowout (bot / any) | 13.8% / 16.2% | **4.3% / 6.8%** | 0 / 7.1% | 0 / 6.7% | 16.7% / 18.2% | **8.6% / 9.9%** | 10.0% / 18.8% | **2.4% / 5.3%** |
| heavy blowout ≥$12 (bot / any) | 4.4% / 5.1% | **0.9% / 1.7%** | 0 / 7.1% | 0 / 6.7% | 4.9% / 5.1% | **1.4% / 1.7%** | 2.9% / 5.5% | **0.2% / 0.5%** |
| late cheap premium lots (matches) | 120 (5.3%) | **37 (1.6%)** | 688 (32.6%) | 973 (42.2%) | 76 (3.1%) | **26 (1.3%)** | 265 (11.4%) | **64 (2.9%)** |
| late locked-out premium lots (matches) | 112 (5.0%) | **33 (1.4%)** | 688 (32.6%) | 973 (42.2%) | 72 (2.9%) | **21 (1.1%)** | 244 (10.5%) | **53 (2.4%)** |
| max single bot overpay | +$8 ($14, 11-25) | +$7 ($13, 11-25, r22, seed 1726) | +$2 ($3) | +$1 ($2) | +$6 ($12, 1-10) | +$8 ($14, 1-10, r9, seed 1085) | +$8 ($14, 11-25) | +$10 ($16, 11-25, r11, seed 683) |
| bot mean price 1-10 / 11-25 / 26-50 / 51-100 / 101-250 | 4.41/5.06/4.38/2.79/1.59 | 3.02/3.17/3.37/2.62/1.59 | 1.67/1.52/1.58/1.59/1.08 | 1.50/1.46/1.48/1.49/1.06 | 4.16/4.85/4.12/2.70/1.77 | 2.62/3.07/3.28/2.49/1.61 | 5.19/5.69/5.35/3.51/1.71 | 5.74/5.36/4.87/2.95/1.34 |
| mean auctioned lots | 11.9 | 12.1 | 12.9 | 13.3 | 11.3 | 11.6 | 13.3 | 13.1 |

Reading the table:

* **Targets met.** Proxy 68.9% (target 60-70), self-play 49.6% (45-55),
  max-raiser up to 83% (v4 76%), min-opener 76% (v4 84.5% — the one number
  that fell; the min-opener is beaten by never letting a $1 opener stand,
  and the deliberate undervaluation now lets some of those through).
* **Early blowouts** (either seat, self-play) 18.8% → 5.3%; heavy 5.5% →
  0.5%. Bot-seat 10.0% → 2.4%. Against the proxy 13.8% → 4.3%.
* **Late premium underpriced** (self-play) 11.4% → 2.9% of matches;
  locked-out 10.5% → 2.4%. Against the max-raiser it *rises* (32.6% →
  42.2%) because that opponent spends $16 on lot one and is locked out of
  everything afterwards — the metric is counting the opponent's defect, and
  the bot correctly buys the stars for $1-2.
* **Spend.** The bot spends less than v4 against the proxy ($11.7 vs $14.4):
  the proxy fills its roster by lot ~7 (median), after which every lot costs
  $1 and there is nothing to spend on. Self-play spend is $14.5. The
  contest-urgency rule raised proxy-matchup spend from $10.9 to $12.1
  without moving the win rate; the residual is structural.
* **Max overpay** is unchanged in shape: a $13-16 price appears only when
  both seats have one or two slots left and $15+ each (seed 683: both had
  $16 and one slot, Durant went for $16 — dead money, the buyer still won
  the match). Prices for a rank-1-25 player at lot 0 top out at $8-9.

## 6. Rejected variants (2,000 seeds)

| variant | proxy | max | min | self | note |
|---|---|---|---|---|---|
| opening tolerance 0 / free-follow 2, misjudge 0.24 (`sweep_v5b`) | 71.8% | 87.7% | 77.1% | 51.8% | pickier when rich; stronger vs everyone, above the band |
| same with misjudge 0.26 (`sweep_v5c`) | 71.5% | 87.1% | 76.0% | 51.4% | misjudgement saturates; not worth the extra noise |
| liquidity 1.2, pacing .55, replacement 62 (300 seeds) | 77.7% | — | — | 53.7% | wins by patience: spends $7.7, buys stars at $1.9 after the human fills — the hoarding shape the brief forbids |
| contest horizon as a continuous lot count | 83% | — | — | 49% | urgency fired from lot 1 (opponent horizon ≈ 10 lots is the whole game); blowouts 29% |

## 7. Tests

* `tests/twenty_dollar/test_bot_calibration.py::test_the_bot_makes_bounded_nonoptimal_decisions`
  now walks the standing bid to the policy's own `valuation()["ceiling"]`
  instead of a hard-coded $6 (v5's price for the same lot is different, and
  the test's purpose is the stay/fold split at the ceiling, not the price).
  No other assertion changed; all v4-era bounds still hold at v5
  (price separation by tier, ≤5% extravagant bottom-tier buys, median deep
  price ≤ $2, spend 45-95%, skip usage, replay determinism, no hidden score).
* New `tests/twenty_dollar/test_bot_opponents.py` (8 tests): the rank-aware
  proxy as a `conftest.Strategy`; 200-seed band **55-75% vs the proxy**
  (measures 69.0% on those seeds; v4 would measure 78%); no hoarding (mean
  spend > $9 vs the proxy); 300-seed self-play symmetry 40-60%; early
  blowouts (either seat) < 10% and heavy < 3% in self-play (v4: 18.8% /
  5.5%); bot-seat early blowouts < 9% vs the proxy; the per-lot opinion is
  deterministic and keyed on public facts.
* `python -m pytest tests/twenty_dollar -q -p no:cacheprovider`: **257 passed**.
* `cd apps/api && PEAK3_TEST_REPOSITORY_MODE=memory python -m pytest
  tests/test_twenty_dollar_bot_timing.py tests/ -q -k "twenty_dollar or
  showdown" -p no:cacheprovider --ignore=tests/integration`: **97 passed**.
  (`mode._bot_private`, `decision_kind` and the think-time hook are
  unchanged; the mode needed no edit.)

## 8. Not done / caveats

* The v4 reproduction lands at 78 / 76 / 85 / 50, not the 93 / 97 / 92 / 50
  recorded last pass: the reconstructed opponents are stronger than the lost
  originals (documented in §1). The v5 band is calibrated against these.
* Win rate vs the min-opener fell 8 points; it remains the bot's easiest
  opponent after the max-raiser and is a degenerate line.
* `git diff --stat` also shows `apps/api/tests/test_arena_practice_e2e.py`
  modified — that is another workstream's uncommitted change, not this one.
