# Lineup DNA v2

**Version:** `dna_v2` (card profiles v2, model `experimental_lineup_v2`)
**Status:** Experimental — this model is separate from canonical PEAK3 individual scoring.

## Data constraint

The PEAK3 dataset exports exactly **6 aggregate component scores** per peak window:

| Field | Raw range |
|---|---|
| `statistical_impact` | 5.93 – 38.93 |
| `traditional_production` | 0.79 – 15.87 |
| `individual_recognition` | 0.00 – 20.00 |
| `postseason_individual_value` | -2.34 – 13.53 |
| `team_achievement` | 0.00 – 3.00 |
| `teammate_adjustment` | -0.495 – 0.495 |

Plus `data_status` (complete / partial / unknown).

**What does not exist at the card-profile layer:**
- Position or size metadata
- Per-stat box scores (points, rebounds, assists per game)
- Defensive rating, rebound rate, block rate, steal rate, on/off splits
- Lineup metrics or on-court context

Six DNA dimensions is the **maximum defensible** from the available committed data.
Any additional "basketball-specific" dimensions (interior_defense, perimeter_defense, rebounding, spacing) would require fabrication — which is prohibited.

## DNA dimensions (v2)

### 1. `primary_creation` ← `statistical_impact`

| | |
|---|---|
| **Source** | `components.statistical_impact` |
| **Sub-components in SI** | BPM×0.50 + OBPM×0.25 + DBPM×0.25 (composite); VORP; WS; WS/48; PER; EPM/LEBRON/RAPTOR when available |
| **Normalization** | `(value - 5.93) / (38.93 - 5.93) × 100`, clipped to [0, 100] |
| **Missing-data behavior** | SI is always computed; no missing values in committed dataset |
| **Basketball interpretation** | Overall two-way impact via advanced metrics. DBPM is explicitly included, so defensive value contributes here. |

### 2. `scoring_pressure` ← `traditional_production`

| | |
|---|---|
| **Source** | `components.traditional_production` |
| **Sub-components in TP** | Scoring (40%), efficiency (20%), playmaking (16%), rebounding (12%), defense box-scores (12%), minus TOs and availability penalty |
| **Normalization** | `(value - 0.79) / (15.87 - 0.79) × 100`, clipped to [0, 100] |
| **Missing-data behavior** | TP is always computed; no missing values |
| **Basketball interpretation** | Box-score production composite. Includes rebounding and defense box-scores as sub-weights. |

### 3. `individual_validation` ← `individual_recognition`

| | |
|---|---|
| **Source** | `components.individual_recognition` |
| **Sub-components in REC** | MVP vote share, All-NBA 1st/2nd/3rd (diminishing), **DPOY votes**, Finals MVP, statistical titles (scoring, rebounds, assists, steals, blocks, 50-40-90) |
| **Normalization** | `(value - 0.00) / (20.00 - 0.00) × 100`, clipped to [0, 100] |
| **Missing-data behavior** | Zero for players with no awards in covered seasons |
| **Basketball interpretation** | Peer and media validation. Crucially, **DPOY votes and defensive/rebounding statistical titles are included** — so high recognition for a non-scorer reflects defensive or rebounding excellence. |

### 4. `postseason_translation` ← `postseason_individual_value` (floored at 0)

| | |
|---|---|
| **Source** | `components.postseason_individual_value` |
| **Sub-components in PO** | Playoff BPM, WS/48, VORP, PER (impact); playoff pts/ast/trb/stocks/tov (box); playoff TS% (efficiency); reliability weight (minutes × games × series); elevation bonus vs regular season |
| **Normalization** | `max(0, (value - (-2.34)) / (13.53 - (-2.34)) × 100)` — negative PO maps to 0 |
| **Missing-data behavior** | PO can be negative (poor playoff performance relative to regular season); floored at 0 so no negative DNA values |
| **Basketball interpretation** | Playoff performance and availability. The reliability weight captures "was this player present and effective in multiple rounds." |

### 5. `team_context` ← `team_achievement`

| | |
|---|---|
| **Source** | `components.team_achievement` |
| **Sub-components in TEAM** | Championships and Finals appearances, weighted by role on team (best player on title team gets more credit) |
| **Normalization** | `(value - 0.00) / (3.00 - 0.00) × 100`, clipped to [0, 100] |
| **Missing-data behavior** | Zero for players who never reached the Finals |
| **Basketball interpretation** | Championship and winning context. Low weight in overall PEAK3 (3%) and in coverage. |

### 6. `context_completeness` ← `data_status`

| | |
|---|---|
| **Source** | `data_status` field (string: complete / partial / unknown) |
| **Values** | `complete` → 100.0; anything else → 60.0 |
| **Role in coverage** | A catastrophic hole (< 15.0) triggers a −8.0 coverage penalty |
| **Basketball interpretation** | Data quality signal. Not a capability measure. A lineup built from incomplete-data cards has lower coverage confidence. This is the only "non-capability" dimension; it prevents incomplete data from producing falsely strong coverage scores. |

## Removed from v1

| Field | Reason for removal |
|---|---|
| `peer_quality_adjustment` | Teammate adjustment is context, not a lineup capability. A player's ability to perform despite weak teammates is relevant to their individual score but does not describe what they contribute to a lineup. Context belongs in receipts and provenance, not coverage. |

## Changes from v0

| v0 field | v2 equivalent | Note |
|---|---|---|
| `primary_creation` | `primary_creation` | Unchanged |
| `scoring_pressure` | `scoring_pressure` | Unchanged |
| `individual_validation` | `individual_validation` | Unchanged |
| `postseason_translation` | `postseason_translation` | Unchanged |
| `team_context` | `team_context` | Unchanged |
| `peak_tier` | removed | Rank-derived (removed in v1) |
| `prime_index_normalized` | removed | Rank-derived (removed in v1) |
| `peer_quality_adjustment` | removed | Context, not capability (removed in v2) |
| `context_completeness` | `context_completeness` | Unchanged |

## Model uncertainties

1. `primary_creation` captures both offensive and defensive impact (DBPM is a sub-component of SI), but we cannot isolate the defensive contribution at the card-profile layer.
2. `scoring_pressure` includes rebounding and defense box scores as sub-weights, but these are mixed with pure scoring — they are not separately observable.
3. `individual_validation` contains DPOY signal but also MVP/All-NBA signal — we cannot attribute recognition specifically to defense vs. offense without decomposing the source data.
4. No position metadata exists — role assignments are approximate proxies, not position-based.
5. Human basketball review remains required before any competitive use of lineup ratings.
