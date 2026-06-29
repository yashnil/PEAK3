# Role Eligibility v2 (ruleset_v2)

**Version:** `ruleset_v2` (card profiles v2)
**Status:** Experimental — role assignments are approximate due to data constraints.

## Design principles

1. Every eligibility path requires **positive evidence** for the role.
2. **Absence of one capability (e.g., low scoring) may be used only as a confirmation filter when combined with positive evidence of another capability.** It may not be the sole qualifier.
3. No player names are referenced in any rule.
4. All thresholds are derived from observed percentile distributions within the duration pool (not global).
5. Rules are documented with source fields, thresholds, and reasoning.

## Data constraint

The PEAK3 dataset has only 6 aggregate component scores per card. No position metadata, defensive rating, rebound rate, or block/steal rates exist at the card-profile layer. Roles are therefore approximate proxies from composite scores.

## Eligibility rules

### `lead_creator`

| Path | Conditions | Rationale |
|---|---|---|
| `high_si` | `si_pct ≥ 75` | Top-quartile statistical impact reflects primary offensive initiation. SI is a composite of advanced metrics including creation and efficiency. |

### `guard_wing`

| Path | Conditions | Rationale |
|---|---|---|
| `perimeter_impact` | `si_pct ≥ 40` | Above-median SI is the minimal bar for any useful perimeter contributor. |
| `postseason_presence` | `po_pct ≥ 60` AND `si_pct ≥ 20` | Strong playoff presence with some statistical contribution. |

### `wing_forward`

| Path | Conditions | Rationale |
|---|---|---|
| `scoring_forward` | `tp_pct ≥ 50` AND `si_pct ≥ 25` | Above-median box score production with moderate advanced impact. |
| `impact_forward` | `si_pct ≥ 58` AND `tp_pct ≥ 20` | High-impact player with minimal scoring floor. |

### `forward_big`

| Path | Conditions | Rationale |
|---|---|---|
| `scoring_big` | `tp_pct ≥ 55` | High-scoring frontcourt. |
| `team_anchor_big` | `team_pct ≥ 65` AND `si_pct ≥ 45` | Strong winning context plus solid advanced impact suggests a dominant frontcourt presence. |

### `anchor`

| Path | Conditions | Rationale |
|---|---|---|
| `postseason_team_anchor` | `po_pct ≥ 55` AND `team_pct ≥ 42` | Dominant playoff force on a winning team. This identifies players who were central to successful playoff runs — typically frontcourt anchors, though the rule is not position-constrained. |
| `recognition_validated_anchor` | `rec_pct ≥ 55` AND `tp_pct ≤ 35` AND `si_pct ≥ 15` | **Primary evidence**: high individual recognition (awards) while **not being a scorer** (low TP as confirmation filter). `individual_recognition` captures DPOY votes, All-Defensive team accolades, and defensive/rebounding statistical titles (rebound, block, steal leaders). A player with high recognition but very low scoring received those awards for defense or rebounding. Moderate SI screens out players with essentially no measurable impact. |

## Paths removed from v1

| Removed path | Reason |
|---|---|
| `interior_defensive_profile` (si_pct∈[15,52], tp_pct≤35) | Used low TP as the primary and nearly sufficient qualifier for "interior defense." No direct defensive evidence exists in the data. Low scoring does not prove interior defense — many low-scoring guards and wings would also qualify. |
| `playoff_team_contributor` (po_pct≥45, team_pct≥55) | Team and postseason success alone do not indicate interior/defensive role. A perimeter star on a championship team would qualify equally. |

## Anchor statistics (v2 vs v1)

| Metric | v1 | v2 |
|---|---|---|
| Total anchor-eligible | 522 | 403 |
| via postseason_team_anchor | 347 | 347 |
| via interior_defensive_profile | 155 | removed |
| via playoff_team_contributor | 20 | removed |
| via recognition_validated_anchor | — | 56 |
| Anchor saturation (% of official pool) | 63.6% | 54.5% |
| Official pool size | 821 | 740 |

## Diagnostic results (named players — not regression tests)

| Player | Duration | Anchor eligible? | Path |
|---|---|---|---|
| Dikembe Mutombo | 1yr | ✅ | recognition_validated_anchor |
| Dennis Rodman | 1yr | ✅ | recognition_validated_anchor |
| Ben Wallace | 1yr | ✅ | postseason_team_anchor |
| Michael Jordan | 1yr | ✅ | postseason_team_anchor (he also passes as lead_creator) |

## Known limitations

1. Without position metadata, no rule guarantees only "big" or "interior" players qualify as Anchor. Elite perimeter players on championship teams (e.g., Jordan) qualify through `postseason_team_anchor`.
2. The `recognition_validated_anchor` path infers "recognized for non-scoring contributions" from award data. `individual_recognition` mixes MVP/All-NBA (scoring bias) with DPOY/All-Defensive/defensive stat titles (defensive signal). Players with very high MVP vote share AND very low TP are rare but would qualify — this is not expected to be a meaningful false-positive rate.
3. Human basketball review remains required before any competitive use of role assignments.
