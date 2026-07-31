# PEAK3 formula variant experiments (Phase 12B)

Companion to
[PEAK3_SCORING_CALIBRATION_DIAGNOSIS.md](PEAK3_SCORING_CALIBRATION_DIAGNOSIS.md).
That document says what the model does; this one says what would happen if we
changed it.

**Nothing here is production.** `scripts/experiment_formula_variants.py` reads
the committed served artifact read-only, re-weights components in memory,
re-sorts, and reports movement. It writes no artifact, touches no
`leaderboards/` file, and changes no score.

```bash
python scripts/experiment_formula_variants.py --markdown
```

---

## Method, and its limits

A row's `prime_index` is exactly the sum of its five weighted contributions plus
the teammate adjustment (verified to 0.01 across the whole board), and
`prime_score` is a **monotonic** remap of `prime_index` (verified across all
1,000 served 1Y rows). So re-sorting a modified index gives the same ordering
the real pipeline would produce — without re-fitting the calibration curve on a
hypothetical distribution, which would move numbers for reasons unrelated to the
variant.

| kind | variants | fidelity |
|---|---|---|
| Re-weight an existing component | B, C, H4, H5, I15, I25, J | **Exact** — the contribution is in the artifact |
| Change how a component is *computed* | D, E | **Approximate** — reconstructed from the scored parquet's PO diagnostic columns |

D and E are labelled approximate because the artifact carries the finished
component, not its internal terms. Saying which is which matters more than
covering every variant.

---

## Results — top 100 of the 1Y board

| Variant | Exact? | Rows moved | Max move | Top-10 retained | Biggest gainer | Biggest loser |
|---|---|---|---|---|---|---|
| **A** Baseline | exact | 0/100 | 0 | 10/10 | — | — |
| **B** PO floor at 0 | exact | 43/100 | 14 | 10/10 | Jalen Duren 2025-26 (−14) | Brandon Roy 2008-09 (+4) |
| **C** PO floor, deep-run starters only | exact | **0/100** | 0 | 10/10 | — | — |
| **D** Smooth PO thresholds | approx | 53/100 | **4** | 9/10 | Hassan Whiteside 2015-16 (−4) | Chauncey Billups 2005-06 (+3) |
| **E** Load-weighted PO | approx | 41/100 | 6 | 10/10 | Ben Wallace 2002-03 (−3) | Hassan Whiteside 2015-16 (+6) |
| **H4** TEAM cap 4 | exact | 58/100 | 4 | 10/10 | Mark Price 1991-92 (−4) | Gilbert Arenas 2005-06 (+4) |
| **H5** TEAM cap 5 | exact | 63/100 | 6 | 10/10 | Mark Price 1991-92 (−6) | Joakim Noah 2013-14 (+6) |
| **I15** REC −15% | exact | 77/100 | 13 | 9/10 | Terrell Brandon 1995-96 (−5) | Ben Wallace 2002-03 (+13) |
| **I25** REC −25% | exact | 84/100 | **19** | 9/10 | Mike Conley 2016-17 (−8) | **Joakim Noah 2013-14 (+19)** |
| **J** No-playoff shrinkage ×0.95 | exact | 33/100 | 14 | 10/10 | Chris Webber 2000-01 (−2) | **Domantas Sabonis 2023-24 (+14)** |

Negative move = ranks **up**. K (UI rename) is not scored — it changes no number.

### Top 10 stability

```
A   (baseline)  Jordan, James, Curry, O'Neal, Jokic, Gilgeous-Alexander, Duncan, Antetokounmpo, Johnson, Olajuwon
H5  (TEAM 5)    Jordan, James, Curry, O'Neal, Jokic, Gilgeous-Alexander, Duncan, Antetokounmpo, Johnson, Olajuwon
I25 (REC −25%)  Jordan, James, Jokic, Curry, O'Neal, Gilgeous-Alexander, Duncan, Antetokounmpo, Durant, Johnson
```

The top of the board is **extremely stable**. Only the most aggressive REC cut
changes membership at all, swapping Olajuwon out for Durant.

---

## Suspicious cases under every variant (depth 200)

| case | base | B | C | D | E | H4 | H5 | I15 | I25 | J |
|---|---|---|---|---|---|---|---|---|---|---|
| Shai Gilgeous-Alexander 2024-25 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 |
| Giannis Antetokounmpo 2019-20 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 |
| Hakeem Olajuwon 1993-94 | 10 | 10 | 10 | 11 | 10 | 10 | 10 | 11 | 11 | 10 |
| Victor Wembanyama 2025-26 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 |
| Kawhi Leonard 2016-17 | 19 | 19 | 19 | 18 | 19 | 19 | 18 | 18 | 17 | 19 |
| **Karl Malone 1996-97** | **20** | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 |
| Joel Embiid 2022-23 | 22 | 21 | 22 | 23 | 21 | 23 | 24 | 21 | 23 | 22 |
| Stephen Curry 2015-16 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 4 | 4 | 3 |
| Manu Ginobili 2004-05 | 39 | 39 | 39 | 39 | 39 | 39 | 37 | 36 | 33 | 39 |
| Jimmy Butler 2022-23 | 40 | 40 | 40 | 40 | 40 | 40 | 40 | 38 | 36 | 40 |
| Kevin Love 2013-14 | 47 | 48 | 47 | 48 | 47 | 48 | 50 | 47 | 45 | **54** |
| **Klay Thompson 2014-15** | **167** | **149** | **148** | 170 | 165 | 160 | 154 | 167 | 165 | 164 |

**Not one variant meaningfully moves the rows the review was most worried
about.** Karl Malone stays at 20 under all ten. Wembanyama and SGA never move at
all. The Butler↔Ginobili ordering (40 vs 39) survives everything except REC
cuts, which move *both* in the same direction.

---

## Variant-by-variant assessment

### B — PO floor at 0 · *rejected*
Moves 43/100 rows. Lifts everyone who had a bad playoff run, including
5-game role-player exits, so the biggest beneficiary is Jalen Duren 2025-26
(−14) rather than any case the review raised. Removes real information: a
below-replacement playoff run genuinely happened.

### C — PO floor for deep-run starters only · *the surgical option*
`>=30 playoff MPG` on a Finals/title team. Moves **0 rows in the top 100** and
26/200 at depth, and its one substantial effect is exactly the case the brief
names: **Klay Thompson 2014-15, 167 → 148**. Nothing in the top 20 shifts.

This is the smallest change that addresses the "a title-winning high-minute
starter should not be negative" objection. It is also the most arbitrary — the
30-MPG and Finals gates are chosen, not derived — which is why it is a *v2
candidate* rather than a patch. **Not recommended for this phase.**

### D — Smooth PO thresholds · *rejected, hypothesis disproved*
Max move **4 ranks**. The 42/50 knees were suspected of cliffing; they are not
(see the diagnosis §3.3 — the level band ramp is smooth, and the thresholds
contribute 28% of the Butler↔Ginobili gap while rate quality contributes 72%).
Adding a softening curve would increase complexity to fix a non-problem.

### E — Load-weighted PO · *interesting, defer to v2*
Scales positive PO by playoff MPG and games. Moves 41/100, max 6. Directionally
right — it is the only variant aimed at PO's near-zero correlation with run
length (r = +0.078) — but the load curve is invented, and the effect on the
cases that motivated it is small. **The right home for this is a versioned v2**,
where the curve can be fitted rather than guessed.

### H4 / H5 — bigger TEAM · *rejected*
Even at a 5-point cap the top 10 is **unchanged** and the max move is 6. TEAM is
small by design because PEAK3 is an individual-peak model; enlarging it does not
fix any flagged case and would make a championship worth more than a 6-point
swing in Statistical Impact.

### I15 / I25 — reduce REC · *rejected*
The largest disruption of any variant (84/100 rows, max 19). It does *not*
target the flagged cases — it demotes **defensive-specialist peaks** (Joakim
Noah +19, Ben Wallace +17, both DPOY seasons) whose value is legitimately mostly
recognition, and promotes high-usage scorers. Trading one distortion for another.

### J — No-playoff shrinkage · *rejected*
A 5% haircut costs Sabonis 14 places and Love 7. But no-playoff seasons already
forfeit 21% of the formula (PO + TEAM = 0) and the highest sits at #47; the
magnitude 0.95 has no principle behind it. A **label** is the honest fix.

### K — UI rename · *shipped*
Changes no number. **Postseason Value → Playoff Rate Impact** and **Team
Achievement → Team Result** describe what the components actually compute, and
would have prevented most of the review's reactions on their own.

Applied at every surface that names a component to a reader: `componentLabel()`
in the web app, the duel-explanation labels in the API, the Daily Grid
constraint labels, the home and methodology weight bars, and the receipt prose.
Component keys, payload shapes and Daily Grid constraint **ids** are unchanged,
so no stored data, API contract or generated puzzle is affected.

---

## Recommendation

**Ship label and data fixes only. No formula change this phase.**

1. **Done** — 2025-26 finalization (a data bug, zero score movement).
2. **Done** — variant K, the UI rename. Still recommended but not shipped:
   stating on the board that 1Y means "highest-scoring single season".
3. **Deferred to a versioned PEAK3 v2** — variants C and E, together with the
   two genuine calibration findings from the diagnosis:
   - 68.3% of playoff participants score below every player who missed the
     playoffs;
   - PO barely responds to how long a run lasted (r = +0.078 with games).

   Both move scores league-wide. They need a formula version bump, regenerated
   artifacts, and their own validation pass — not a patch inside a diagnosis
   phase.

The evidence for "leave the formula alone for now" is the variant table itself:
across ten alternatives, the flagged rows barely move. The problem the review
found is **overwhelmingly one of naming and explanation**, not of arithmetic.
