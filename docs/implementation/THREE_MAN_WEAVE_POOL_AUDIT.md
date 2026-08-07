# THREE-MAN WEAVE — franchise × decade candidate pool audit

Audit version `tmw_pool_audit_v1` · eligibility index `tmw_eligibility_index_v2` · formula `peak3_v1`.

Regenerate with:

```bash
python scripts/audit_three_man_weave_pool.py --write
```

Read-only over committed data; no network access at any point. Sources:

- `canonical_seasons` — `data/game/experimental/player_pool_1500/all_seasons_for_identities.v1.json`
- `traded_stints` — `data/game/experimental/player_pool_1500/traded_player_team_stints.v1.json`
- `scored` — `cache/processed/scored_1980_2026.parquet`
- `regular` — `cache/processed/regular_1980_2026.parquet`

## 1. What was compared

`expected` is re-derived from the canonical season records in this script, not
imported from `nba_peak.three_man_weave.eligibility` — an audit that asks the
implementation what it believes can only ever agree with itself. The two sides
share only the franchise-continuity table and the decade bucketing rule, which
are the rules under audit rather than the pool's implementation.

`actual` is `EligibilityIndex.eligible_slugs(franchise, decade)` — the real pool
the game rolls candidates from.

## 2. Headline numbers

| Metric | Value |
| --- | ---: |
| Franchises | 30 |
| Decades | 5 |
| **Total supported franchise × decade combinations** | **150** |
| Combinations with at least one expected identity | 146 |
| Combinations with at least one pool identity | 146 |
| Combinations rollable (≥ 3 identities) | 146 |
| **Expected identity count** (identity × combination pairs) | **6656** |
| **Actual identity count** (identity × combination pairs) | **4751** |
| **Missing** | **1905** (28.6% of expected) |
| **Extra** (in the pool, not in the canonical record) | **0** |
| Unexplained missing | 0 |
| Distinct expected identities | 1384 |
| Distinct identities in the pool | 1379 |

`extra == 0`: the pool never offers an identity the canonical season records do
not place on that franchise in that decade. Nothing is fabricated upward.

## 3. Why identities are missing

Every missing identity is classified by reading the underlying data. No category
below is a guess; each is a check against a real file.

| Reason | Count | Share of missing |
| --- | ---: | ---: |
| `below_peak3_minutes_qualifier` | 1905 | 100.0% |
| `season_scored_only_under_another_team_code` | 0 | 0.0% |
| `season_absent_from_regular_source` | 0 | 0.0% |
| `season_outside_scored_window` | 0 | 0.0% |
| `unscored_season` | 0 | 0.0% |

### What each reason means, and examples

#### `below_peak3_minutes_qualifier` — 1905

The season exists in the raw per-season table but its minutes fall under `peak3.regular_minutes_threshold(season_end)` — 1,000 minutes over an 82-game season (~12.2 MPG), scaled down for shortened seasons. PEAK3 therefore produced no `prime_score` for that season **for any team**, not merely for this one. With no card there is nothing to draft, which is the documented eligibility rule (`eligibility.py`, "UNSCORED IDENTITIES") working as intended rather than a gap.

| Identity | Franchise × decade | Season(s) | Max games in a season |
| --- | --- | --- | ---: |
| Al Wood (`al-wood`) | ATL × 1980s | 1981-82 | 19 |
| Darrell Armstrong (`darrell-armstrong`) | BRK × 2000s | 2007-08 | 50 |
| Vladimir Radmanovic (`vladimir-radmanovic`) | CHI × 2010s | 2012-13 | 25 |
| Carl Herrera (`carl-herrera`) | DEN × 1990s | 1998-99 | 24 |
| Vinny Del Negro (`vinny-del-negro`) | GSW × 2000s | 2000-01 | 29 |
| Alvin Williams (`alvin-williams`) | LAC × 2000s | 2006-07 | 2 |
| Jamaal Tinsley (`jamaal-tinsley`) | MEM × 2000s | 2009-10 | 38 |
| Jon Leuer (`jon-leuer`) | MIL × 2010s | 2011-12 | 46 |

### How complete were the seasons the model declined to score

A cameo and a full low-minutes season are both correctly absent, but they are not
the same finding, so they are counted separately. Games are the most a missing
identity played in any one season of that franchise × decade.

| Games in the best qualifying attempt | Missing pairs | Share |
| --- | ---: | ---: |
| under 20 | 816 | 42.8% |
| 20–40 | 594 | 31.2% |
| 41–69 | 452 | 23.7% |
| 70 or more | 43 | 2.3% |
| not recorded | 0 | 0.0% |

The 43 pairs at 70+ games are the ones worth naming out loud: those
identities played a full season for that franchise and still fell under the
minutes bar, i.e. they were deep-bench regulars. They are absent for the same
documented reason as the cameos, but a reader should know the category is not
purely made of ten-game stints.

### Where the missing identities went

- 1899 of the 1905 missing pairs belong to an identity who **is** in the pool on some other roll — they are absent from one franchise × decade, not from the game.
- 6 belong to an identity with no scored season anywhere in the supported window; see §6.
- 875 distinct identities are involved in at least one missing pair.

## 4. Appearance-level outcomes

The same question one row at a time: of every canonical (identity, franchise,
season) membership fact, how many earned a scoring card and how many did not.

| Outcome | Count |
| --- | ---: |
| `card_from_single_team_scored_row` | 9149 |
| `below_peak3_minutes_qualifier` | 4022 |
| `card_from_traded_season_aggregate` | 1700 |
| **total** | **14871** |

## 5. Normalisation surfaces

### Franchise aliases and relocations

Every historical team code must fold into the modern franchise that holds its
history, and an identity who played under the old code must be discoverable
under the new franchise.

| Historical code | Folds into | Canonical rows | Discoverable example (played → scored on) |
| --- | --- | ---: | --- |
| `NJN` | BRK (Brooklyn Nets) | 298 | `aaron-williams` on BRK × 2000s — played 2000-01 `NJN`, scored on 2001-02 `NJN` |
| `CHO` | CHA (Charlotte Hornets) | 119 | `bismack-biyombo` on CHA × 2010s — played 2014-15 `CHO`, scored on 2014-15 `CHO` |
| `CHH` | CHA (Charlotte Hornets) | 127 | `alonzo-mourning` on CHA × 1990s — played 1992-93 `CHH`, scored on 1994-95 `CHH` |
| `SDC` | LAC (Los Angeles Clippers) | 41 | `al-wood` on LAC × 1980s — played 1982-83 `SDC`, scored on 1982-83 `SDC` |
| `VAN` | MEM (Memphis Grizzlies) | 54 | `anthony-avent` on MEM × 1990s — played 1995-96 `VAN`, scored on 1995-96 `VAN` |
| `NOH` | NOP (New Orleans Pelicans) | 75 | `al-farouq-aminu` on NOP × 2010s — played 2011-12 `NOH`, scored on 2012-13 `NOH` |
| `NOK` | NOP (New Orleans Pelicans) | 20 | `bobby-jackson` on NOP × 2000s — played 2006-07 `NOK`, scored on 2006-07 `NOK` |
| `SEA` | OKC (Oklahoma City Thunder) | 265 | `al-wood` on OKC × 1980s — played 1983-84 `SEA`, scored on 1984-85 `SEA` |
| `KCK` | SAC (Sacramento Kings) | 43 | `billy-knight` on SAC × 1980s — played 1983-84 `KCK`, scored on 1983-84 `KCK` |
| `WSB` | WAS (Washington Wizards) | 161 | `bernard-king` on WAS × 1980s — played 1987-88 `WSB`, scored on 1989-90 `WSB` |

Every historical code with canonical rows folds through to a discoverable
identity. `NOH`/`NOK` fold to `NOP` and are kept distinct from `CHH`/`CHO` →
`CHA`, which is why New Orleans has no 1980s or 1990s pool at all.

### Mid-season trades

- 1378 identity × combination pairs exist **only** because a multi-team aggregate row was expanded through the real per-team stints file; 709 of them are in the pool.
- 1342 split seasons place one identity on two or more franchises in the same season; 865 of those are eligible on every side.

| Identity | Season | Franchises | Eligible on every side |
| --- | --- | --- | --- |
| `a-c-green` | 1996-97 | DAL, PHO | yes |
| `aaron-brooks` | 2010-11 | HOU, PHO | yes |
| `aaron-brooks` | 2012-13 | HOU, SAC | no |
| `aaron-brooks` | 2013-14 | DEN, HOU | yes |
| `aaron-gordon` | 2020-21 | DEN, ORL | yes |
| `aaron-mckie` | 1996-97 | DET, POR | yes |

### Punctuation, suffixes and diacritics

An identity is discoverable by display name when the name is present and folding
it through the shared slug convention reproduces the slug the pool is keyed on —
the pick overlay searches on `player_name` and every lookup keys on the slug, so
a slug that does not round-trip is one no typed name can reach.

| Group | In the pool | Not discoverable by display name |
| --- | ---: | ---: |
| Slug carries a generational suffix (jr/sr/ii/iii/iv/v) | 23 | 0 |
| Display name carries an apostrophe, period or hyphen | 63 | 0 |
| Apostrophe-derived `-o-` form (e.g. `-o-neal`) | 4 | 0 |
| Display name carries diacritics | 0 | 0 |

Diacritics: **zero** identities in the pool carry a non-ASCII display name.
`peak3.clean_player_name` runs every name through `unidecode` at ingestion, so
the canonical source stores "Nikola Jokic", not "Nikola Jokić". The search
surface is therefore never asked to fold an accent today. That is a property
of the current data, not a guarantee: `searchCandidates` lowercases without
folding, so an accented name entering the source later would not be reachable
by its unaccented spelling.

## 6. Intentional exceptions

Kept deliberately short. Each one is a rule stated elsewhere in the codebase, not
a carve-out invented to make this audit pass.

**1. The 1979-80 season is excluded.**

164 canonical rows fall before `MIN_SEASON_START = 1980` and are
dropped from both sides of the comparison. Committed data starts at 1979-80, so a
"1970s" bucket would hold one season against every other bucket's ten — a
rounding artifact of bucketing by season start year, not a decade. See
`three_man_weave/config.py`'s `DECADES` comment.

The cost is precise and small: of the 1390 identities in the
canonical source, 6 have no season at all inside the window and are
therefore expected nowhere — Bingo Smith, Charlie Scott, Dave Meyers, Eric Money, Rick Barry, Terry Furlow, each of whose last recorded season is
1979-80. Every other identity keeps every season from 1980-81 onward.

**2. Franchise × decade combinations that never existed.**

4 of 150 combinations have neither an expected nor
an actual member, because the franchise did not play in that decade:

- MEM (Memphis Grizzlies) × 1980s
- NOP (New Orleans Pelicans) × 1980s
- NOP (New Orleans Pelicans) × 1990s
- TOR (Toronto Raptors) × 1980s

`eligible_slugs` returns an empty frozenset for these and callers must read that
as "not a rollable combination", never as an error.

**3. Identities with no qualifying season anywhere in the window.**

5 expected identities hold no scoring card on any roll, and 6 missing pairs belong to them:

- Bob Dandridge (`bob-dandridge`)
- Jo Jo White (`jo-jo-white`)
- John Roche (`john-roche`)
- Toby Knight (`toby-knight`)
- Tom Boswell (`tom-boswell`)

They cleared the 1,500-identity recognizability filter on the strength of a career
that is mostly older than the supported window, and every one of their in-window
seasons falls under the minutes qualifier. Drafting them would mean showing a
fabricated score, so they are absent rather than scored at 0.

**4. Multi-team rows with no stint data.**

1 canonical row(s) could not be placed on a franchise and therefore
contribute no evidence on either side of the comparison. Guessing a franchise from
a `2TM` token is exactly the fabrication this codebase refuses, so they are listed
here instead:

| Identity | Season | Recorded team | Why |
| --- | --- | --- | --- |
| Omer Asik (`omer-asik`) | 2017-18 | `2TM` | `multi_team_row_without_stint_data` |

## 7. Honest read of coverage

The pool is **complete with respect to what PEAK3 can score**, and
**incomplete with respect to who set foot on the floor** — those are different
claims and this document will not merge them.

- Zero unexplained missing identities across all 150 combinations.
- Zero extra identities: the pool never asserts a franchise × decade the
  canonical record does not support.
- 1905 identity × combination pairs (28.6% of expected) are absent, and every one of them is absent for a reason the data shows.

The canonical source is itself bounded, and pretending otherwise would be the
dishonest move here. `cache/processed/scored_1980_2026.parquet` contains only
player-seasons that cleared PEAK3's minutes qualifier — the model never computed
a score for the rest. So the missing pairs are not a bug in the pool builder; they
are the boundary of the scoring model, surfaced. Closing that gap would mean
either scoring sub-qualifier seasons (changing the model) or drafting players with
no score (fabricating one). Neither is done here.

## 8. Named regression — Dennis Rodman × San Antonio Spurs × 1990s

The spec names this one because it was the reported failure, and it is asserted
by name in `tests/three_man_weave/test_pool_audit.py`. What is NOT done by name is
the fix: `eligibility.py` contains no reference to Rodman, no franchise or player
allow-list, and no hand-placed row. He is discoverable for the same reason the
other 4,750 identity × combination pairs are — a real Spurs season of the 1990s
that PEAK3 scored. The sweep above is what establishes that; this section only
prints the one row the spec asked to see.

| Check | Result |
| --- | --- |
| Discoverable for SAS × 1990s | **yes** |
| Scoring card season | `1994-95` |
| Card team code | `SAS` (resolves to `SAS`) |
| Card is a Spurs season | yes |
| Card is in the 1990s | yes |
| `prime_score` | 52.19 |
| Score source | `exact_team_stint` |

Eligibility evidence (the real seasons that prove the membership):

| Season | Team | Games | Established via |
| --- | --- | ---: | --- |
| 1993-94 | SAS | 79 | `direct_team_season` |
| 1994-95 | SAS | 49 | `direct_team_season` |

Every roll he is eligible for: CHI × 1990s, DET × 1980s, DET × 1990s, LAL × 1990s, SAS × 1990s. Each is a franchise he really played for
in that decade, and each scores him on that franchise's own season.

## 9. Per-combination detail

| Franchise | Decade | Expected | Actual | Missing | Extra | Rollable |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| ATL | 1980s | 35 | 24 | 11 | 0 | yes |
| ATL | 1990s | 41 | 32 | 9 | 0 | yes |
| ATL | 2000s | 45 | 33 | 12 | 0 | yes |
| ATL | 2010s | 53 | 36 | 17 | 0 | yes |
| ATL | 2020s | 38 | 23 | 15 | 0 | yes |
| BOS | 1980s | 28 | 21 | 7 | 0 | yes |
| BOS | 1990s | 48 | 34 | 14 | 0 | yes |
| BOS | 2000s | 55 | 41 | 14 | 0 | yes |
| BOS | 2010s | 61 | 40 | 21 | 0 | yes |
| BOS | 2020s | 30 | 22 | 8 | 0 | yes |
| BRK | 1980s | 50 | 39 | 11 | 0 | yes |
| BRK | 1990s | 54 | 39 | 15 | 0 | yes |
| BRK | 2000s | 55 | 37 | 18 | 0 | yes |
| BRK | 2010s | 67 | 43 | 24 | 0 | yes |
| BRK | 2020s | 47 | 34 | 13 | 0 | yes |
| CHA | 1980s | 16 | 10 | 6 | 0 | yes |
| CHA | 1990s | 52 | 34 | 18 | 0 | yes |
| CHA | 2000s | 51 | 35 | 16 | 0 | yes |
| CHA | 2010s | 57 | 43 | 14 | 0 | yes |
| CHA | 2020s | 33 | 25 | 8 | 0 | yes |
| CHI | 1980s | 47 | 36 | 11 | 0 | yes |
| CHI | 1990s | 42 | 30 | 12 | 0 | yes |
| CHI | 2000s | 49 | 41 | 8 | 0 | yes |
| CHI | 2010s | 53 | 38 | 15 | 0 | yes |
| CHI | 2020s | 37 | 25 | 12 | 0 | yes |
| CLE | 1980s | 52 | 42 | 10 | 0 | yes |
| CLE | 1990s | 36 | 28 | 8 | 0 | yes |
| CLE | 2000s | 60 | 45 | 15 | 0 | yes |
| CLE | 2010s | 69 | 48 | 21 | 0 | yes |
| CLE | 2020s | 37 | 20 | 17 | 0 | yes |
| DAL | 1980s | 29 | 25 | 4 | 0 | yes |
| DAL | 1990s | 43 | 37 | 6 | 0 | yes |
| DAL | 2000s | 65 | 38 | 27 | 0 | yes |
| DAL | 2010s | 68 | 48 | 20 | 0 | yes |
| DAL | 2020s | 43 | 31 | 12 | 0 | yes |
| DEN | 1980s | 23 | 21 | 2 | 0 | yes |
| DEN | 1990s | 54 | 39 | 15 | 0 | yes |
| DEN | 2000s | 51 | 35 | 16 | 0 | yes |
| DEN | 2010s | 51 | 36 | 15 | 0 | yes |
| DEN | 2020s | 30 | 20 | 10 | 0 | yes |
| DET | 1980s | 35 | 24 | 11 | 0 | yes |
| DET | 1990s | 47 | 32 | 15 | 0 | yes |
| DET | 2000s | 52 | 33 | 19 | 0 | yes |
| DET | 2010s | 51 | 40 | 11 | 0 | yes |
| DET | 2020s | 38 | 26 | 12 | 0 | yes |
| GSW | 1980s | 37 | 30 | 7 | 0 | yes |
| GSW | 1990s | 52 | 39 | 13 | 0 | yes |
| GSW | 2000s | 55 | 35 | 20 | 0 | yes |
| GSW | 2010s | 59 | 42 | 17 | 0 | yes |
| GSW | 2020s | 32 | 23 | 9 | 0 | yes |
| HOU | 1980s | 44 | 37 | 7 | 0 | yes |
| HOU | 1990s | 43 | 31 | 12 | 0 | yes |
| HOU | 2000s | 52 | 38 | 14 | 0 | yes |
| HOU | 2010s | 67 | 49 | 18 | 0 | yes |
| HOU | 2020s | 32 | 25 | 7 | 0 | yes |
| IND | 1980s | 37 | 32 | 5 | 0 | yes |
| IND | 1990s | 36 | 25 | 11 | 0 | yes |
| IND | 2000s | 43 | 30 | 13 | 0 | yes |
| IND | 2010s | 47 | 39 | 8 | 0 | yes |
| IND | 2020s | 29 | 19 | 10 | 0 | yes |
| LAC | 1980s | 51 | 42 | 9 | 0 | yes |
| LAC | 1990s | 49 | 35 | 14 | 0 | yes |
| LAC | 2000s | 59 | 36 | 23 | 0 | yes |
| LAC | 2010s | 73 | 48 | 25 | 0 | yes |
| LAC | 2020s | 42 | 27 | 15 | 0 | yes |
| LAL | 1980s | 31 | 21 | 10 | 0 | yes |
| LAL | 1990s | 48 | 30 | 18 | 0 | yes |
| LAL | 2000s | 45 | 34 | 11 | 0 | yes |
| LAL | 2010s | 72 | 50 | 22 | 0 | yes |
| LAL | 2020s | 53 | 36 | 17 | 0 | yes |
| MEM | 1980s | 0 | 0 | 0 | 0 | no |
| MEM | 1990s | 30 | 21 | 9 | 0 | yes |
| MEM | 2000s | 53 | 38 | 15 | 0 | yes |
| MEM | 2010s | 59 | 37 | 22 | 0 | yes |
| MEM | 2020s | 27 | 18 | 9 | 0 | yes |
| MIA | 1980s | 9 | 8 | 1 | 0 | yes |
| MIA | 1990s | 51 | 34 | 17 | 0 | yes |
| MIA | 2000s | 64 | 45 | 19 | 0 | yes |
| MIA | 2010s | 54 | 35 | 19 | 0 | yes |
| MIA | 2020s | 36 | 25 | 11 | 0 | yes |
| MIL | 1980s | 41 | 28 | 13 | 0 | yes |
| MIL | 1990s | 54 | 41 | 13 | 0 | yes |
| MIL | 2000s | 62 | 45 | 17 | 0 | yes |
| MIL | 2010s | 69 | 49 | 20 | 0 | yes |
| MIL | 2020s | 41 | 27 | 14 | 0 | yes |
| MIN | 1980s | 10 | 6 | 4 | 0 | yes |
| MIN | 1990s | 39 | 36 | 3 | 0 | yes |
| MIN | 2000s | 52 | 35 | 17 | 0 | yes |
| MIN | 2010s | 58 | 36 | 22 | 0 | yes |
| MIN | 2020s | 24 | 18 | 6 | 0 | yes |
| NOP | 1980s | 0 | 0 | 0 | 0 | no |
| NOP | 1990s | 0 | 0 | 0 | 0 | no |
| NOP | 2000s | 42 | 32 | 10 | 0 | yes |
| NOP | 2010s | 71 | 47 | 24 | 0 | yes |
| NOP | 2020s | 35 | 23 | 12 | 0 | yes |
| NYK | 1980s | 32 | 28 | 4 | 0 | yes |
| NYK | 1990s | 43 | 33 | 10 | 0 | yes |
| NYK | 2000s | 54 | 42 | 12 | 0 | yes |
| NYK | 2010s | 65 | 44 | 21 | 0 | yes |
| NYK | 2020s | 37 | 28 | 9 | 0 | yes |
| OKC | 1980s | 46 | 37 | 9 | 0 | yes |
| OKC | 1990s | 46 | 26 | 20 | 0 | yes |
| OKC | 2000s | 41 | 29 | 12 | 0 | yes |
| OKC | 2010s | 53 | 43 | 10 | 0 | yes |
| OKC | 2020s | 22 | 15 | 7 | 0 | yes |
| ORL | 1980s | 9 | 8 | 1 | 0 | yes |
| ORL | 1990s | 52 | 36 | 16 | 0 | yes |
| ORL | 2000s | 48 | 38 | 10 | 0 | yes |
| ORL | 2010s | 52 | 37 | 15 | 0 | yes |
| ORL | 2020s | 25 | 19 | 6 | 0 | yes |
| PHI | 1980s | 42 | 30 | 12 | 0 | yes |
| PHI | 1990s | 65 | 43 | 22 | 0 | yes |
| PHI | 2000s | 51 | 31 | 20 | 0 | yes |
| PHI | 2010s | 64 | 43 | 21 | 0 | yes |
| PHI | 2020s | 45 | 24 | 21 | 0 | yes |
| PHO | 1980s | 35 | 25 | 10 | 0 | yes |
| PHO | 1990s | 45 | 36 | 9 | 0 | yes |
| PHO | 2000s | 51 | 31 | 20 | 0 | yes |
| PHO | 2010s | 62 | 45 | 17 | 0 | yes |
| PHO | 2020s | 38 | 24 | 14 | 0 | yes |
| POR | 1980s | 33 | 27 | 6 | 0 | yes |
| POR | 1990s | 48 | 34 | 14 | 0 | yes |
| POR | 2000s | 57 | 40 | 17 | 0 | yes |
| POR | 2010s | 51 | 38 | 13 | 0 | yes |
| POR | 2020s | 35 | 26 | 9 | 0 | yes |
| SAC | 1980s | 40 | 33 | 7 | 0 | yes |
| SAC | 1990s | 44 | 36 | 8 | 0 | yes |
| SAC | 2000s | 51 | 32 | 19 | 0 | yes |
| SAC | 2010s | 59 | 49 | 10 | 0 | yes |
| SAC | 2020s | 41 | 24 | 17 | 0 | yes |
| SAS | 1980s | 57 | 41 | 16 | 0 | yes |
| SAS | 1990s | 44 | 32 | 12 | 0 | yes |
| SAS | 2000s | 57 | 35 | 22 | 0 | yes |
| SAS | 2010s | 48 | 32 | 16 | 0 | yes |
| SAS | 2020s | 32 | 23 | 9 | 0 | yes |
| TOR | 1980s | 0 | 0 | 0 | 0 | no |
| TOR | 1990s | 32 | 24 | 8 | 0 | yes |
| TOR | 2000s | 56 | 40 | 16 | 0 | yes |
| TOR | 2010s | 53 | 38 | 15 | 0 | yes |
| TOR | 2020s | 27 | 19 | 8 | 0 | yes |
| UTA | 1980s | 30 | 21 | 9 | 0 | yes |
| UTA | 1990s | 33 | 23 | 10 | 0 | yes |
| UTA | 2000s | 39 | 29 | 10 | 0 | yes |
| UTA | 2010s | 46 | 38 | 8 | 0 | yes |
| UTA | 2020s | 38 | 26 | 12 | 0 | yes |
| WAS | 1980s | 35 | 30 | 5 | 0 | yes |
| WAS | 1990s | 47 | 35 | 12 | 0 | yes |
| WAS | 2000s | 51 | 39 | 12 | 0 | yes |
| WAS | 2010s | 61 | 45 | 16 | 0 | yes |
| WAS | 2020s | 41 | 27 | 14 | 0 | yes |

