# Card Profile Provenance (v0)

Every Peak Draft card is a PEAK3 peak window enriched with role eligibility and
eight Lineup DNA dimensions. **Nothing is fabricated**: each field traces back to
a named PEAK3 component or rank that already exists in the committed dataset.

- Builder: `scripts/build_card_profiles.py`
- Source: `data/web/peak_windows.json` (itself built from committed
  `leaderboards/*.csv` via `scripts/build_web_dataset.py`)
- Outputs: `data/game/profiles/card_profiles.v0.json`,
  `profile_metadata.v0.json`, `profile_coverage.v0.json`

## Coverage summary (current build)

| Metric | Value |
|---|---|
| Total profiles | 984 |
| Official-eligible (≥1 role) | 684 |
| Excluded (no eligible role) | 300 |
| Provisional (incomplete data) | 0 |

By duration (total / eligible): 1yr 250/179, 2yr 249/175, 3yr 248/170,
5yr 237/160. (The game uses durations 1, 3, 5; 2yr profiles exist but no 2yr
mode is shipped.)

Profile statuses:
- `verified_data_derived` — `data_status == "complete"` in the source row
- `provisional_data_derived` — derived from an incomplete row (none in current build)
- `excluded` — no eligible role; never offered on official boards

## DNA dimension provenance

| DNA dimension | Source field | Transform |
|---|---|---|
| `primary_creation` | `statistical_impact` | min-max normalised to component range |
| `scoring_pressure` | `traditional_production` | min-max normalised |
| `individual_validation` | `individual_recognition` | min-max normalised |
| `postseason_translation` | `postseason_individual_value` | normalised, floored at 0 |
| `team_context` | `team_achievement` | min-max normalised |
| `peak_tier` | `rank` (within duration) | rank-inverse: rank 1 → 100 |
| `prime_index_normalized` | `prime_index` | percentile rank within duration pool |
| `context_completeness` | `data_status` | 100 if `complete`, else 60 |

Normalisation uses **fixed observed maxima** (`NORM` in the builder, mirrored in
`profile_metadata.v0.json`) so values are stable across re-runs. `prime_index`
is used only for internal ordering and is **never exposed to the client** before
reveal (the API strips it; see the leak check in `tests/`).

## Role eligibility provenance

Roles are assigned from component percentiles **within a duration pool** (not
across durations). Thresholds (`ROLE_RULES`):

| Role | Rule |
|---|---|
| `lead_creator` | SI percentile ≥ 75 |
| `guard_wing` | SI percentile ≥ 40 |
| `wing_forward` | TP percentile ≥ 50 and SI percentile ≥ 30 |
| `forward_big` | TP percentile ≥ 58 |
| `anchor` | PO percentile ≥ 55 and team percentile ≥ 42 |

These are **game mechanics, not scouting claims**. A window can be eligible for
several roles; `primary_role` picks the most distinctive by a fixed priority.

## Known provenance limitations (requires human basketball review)

- **Offense-weighted exclusion.** The 300 excluded windows are dominated by
  defensive specialists and low-usage role players (e.g. Mutombo, Rodman, Eaton,
  Bowen, Ben Simmons) whose SI/TP/recognition percentiles clear no role bar.
  This is a faithful consequence of the offense-oriented PEAK3 components, but it
  means Peak Draft under-represents elite defense. Flagged for review before any
  v1 role redefinition.
- **`context_completeness` is binary-ish** (100/60) — it reflects `data_status`,
  not a granular completeness score.
- **Fixed norm maxima** mean adding players outside the current observed range
  would clip; re-derive and bump `CARD_PROFILE_VERSION` if the universe changes.

## Reproducing
```bash
make build-dataset          # data/web/ from committed CSVs
make build-card-profiles    # data/game/profiles/ from data/web/
make verify-game-data       # assert required files exist
```
The builder asserts: no duplicate `peak_window_id`, ≥100 official profiles, and
Michael Jordan's 1yr window is present and `lead_creator`-eligible (a smoke
anchor, not a hand-picked winner).
