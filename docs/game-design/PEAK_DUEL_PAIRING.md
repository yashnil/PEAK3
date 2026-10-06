# Peak Duel Daily — pairing v2

Code: `apps/api/app/services/duel_pairing.py` (rules), `apps/api/app/services/duel.py`
(`generate_daily_duels`, cutover). Tests: `apps/api/tests/test_duel_pairing_v2.py`.

## Why

The v1 daily board drew both cards uniformly from the top 150 of a duration. Measured over
64 days, **36–37% of v1 duels had a display-score gap above 14 points**, and **20–22% were
cross-position blowouts** (different position group and a gap above 14), for example Kevin
Johnson vs Shaquille O'Neal: guard vs big, a 25–27-point gap, a decade apart.

## Rules (v2)

A pair must satisfy **at least two** of:

| Signal | Definition |
|---|---|
| Score proximity | `|prime_score|` gap inside the pair's band (every band ≤ 14.0) |
| Basketball similarity | shared position group (guard PG/SG, wing SF, big PF/C) from the window's own `window_positions` in `card_profiles.v3.json`, **or** the same `primary_role` |
| Era proximity | anchor seasons ≤ 6 years apart, or the two windows overlap |

Bands are in `prime_score` (display) points. The winner is still `prime_index`, as in v1;
the committed pools have zero `prime_score`/`prime_index` inversions (tested).

| Band | Gap | Board slots | Extra requirement |
|---|---|---|---|
| Easy | (7.5, 14.0] | duels 1–2 | similarity **required** |
| Medium | (3.0, 7.5] | duels 3–7 | similarity or era |
| Hard | [0.10, 3.0] | duels 8–10 | similarity or era |

Other rules:

- No player appears twice on a board, and no pair repeats.
- Both cards must have `data_status: complete`.
- **Variety:** at most 3 "mirror" pairs per board. A mirror pair has identical positions and anchors no more than 3 years apart.
- **Draw:** one `random.Random("peak3:duel-pairing:v2:{daily_seed}")` over id-sorted candidate lists. Bands are filled scarcest-first (hard, easy, medium) and displayed in progression order.
- **Unchanged from v1:** side orientation (`stronger_on_left`, same seed), duel ids, payload schema and Endless.
- **The payload's existing `difficulty` field** is filled from the band. The client renders difficulty only at the reveal.

### Thresholds come from the data

Pairwise gaps across the top 150 of each duration, 11,175 pairs each:

| | q10 | q25 | q50 | q75 | q90 |
|---|---|---|---|---|---|
| 1y | 1.38 | 3.57 | 9.10 | 19.51 | 27.41 |
| 2y | 1.42 | 3.73 | 8.62 | 20.11 | 28.05 |
| 3y | 1.33 | 3.54 | 8.36 | 19.69 | 27.98 |
| 5y | 1.35 | 3.48 | 8.32 | 19.44 | 28.52 |

- **Hard** covers about the closest 20% of pairs. **Medium** covers about the 20th–45th percentile. **Easy** covers about the 45th–65th percentile.
- The 0.10 floor keeps rounding ties that display as equal off the board.
- Anchor-gap quartiles are 6–7 / 14 / 23–25 years.

### Measured result (64 days from 2026-10-08)

| | 1y | 3y |
|---|---|---|
| Median gap, easy / medium / hard | 9.8 / 5.0 / 1.6 | 10.0 / 5.1 / 1.6 |
| Pairs with similarity | 79% | 81% |
| Pairs with era proximity | 41% | 42% |
| Pairs with all three signals | 19% | 23% |
| Mirror pairs per board | 0.6 | 0.4 |

On both durations, every duel was filled on the strict rung.

### Relaxation (deterministic, per slot)

The rungs below are tried in order. Each rung still forbids repeats and incomplete data:

1. `strict`
2. `no_mirror_cap`
3. `easy_by_era`: era may stand in for similarity on a warm-up.
4. `neighbour_band`
5. `score_only`: reached only when structural data is missing, such as a synthetic pool. It still allows no blowouts.
6. Top-up from the v1 draw over the unused players.

## Cutover

Daily boards are re-derived from `(date, years)` on every request, and stored results reference
their `duel_id`s. To keep archived boards and stored answers valid, v2 builds only boards dated
on or after `PEAK3_PEAK_DUEL_PAIRING_V2_FROM`. The default is `2026-10-08`, and the value is
validated as an ISO daily key. Earlier dates replay v1 byte-for-byte; the tests pin those boards.

**Set it to a date on or after the deploy day.** A date already played under v1 must never be
rebuilt by v2.
