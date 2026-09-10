# Daily Grid category taxonomy (v5)

**What this document is.** Every category the Daily Grid can put on an axis,
what exactly qualifies for it, where the underlying fact comes from, and what
was deliberately left out. It is the reference a reviewer should be able to
open six months from now and answer "why did that square reject my answer"
without reading the generator.

The code is `nba_peak/daily_grid/constraints.py`; this document is its
rationale, not a duplicate of it. Where the two disagree, the code is what
runs and this file is the bug.

---

## 1. The design rule

A Daily Grid axis has to pass one test:

> Would a knowledgeable NBA fan understand what it means in about two seconds?

That is the whole rule, and it is what v5 is for. The v4 taxonomy was
factually sound and produced axes like **Top 10% TP**, **75+ PEAK Season** and
**1.8+ STL/75** — each a real, well-defined measurement, and none of them
something a fan can reason about without first learning PEAK3's methodology or
its choice of denominator. A player looking at a board should think "oh, I know
players who fit that", not "what is TP".

So v5 moves the axes to basketball language and leaves PEAK3 where it belongs:
in the **scoring**. The objective of the mode is still to maximise the PEAK3
value of the nine seasons you place. It is just no longer also the eligibility
test.

Two supporting rules follow from the main one:

- **An advanced idea is fine; an unexplained one is not.** "Elite Efficiency"
  is a good axis because it means something a fan already has an intuition for.
  It carries a definition marker (`needs_definition`) so the exact rule is one
  glance away.
- **The label is never the formula.** Headers read `Elite Eff.`, `2nd Round`,
  `International`. The rule lives in `description`, which the cell panel always
  prints in full.

---

## 2. Where the facts come from

| Layer | Source | Supplies |
|---|---|---|
| PEAK3 model tables | `cache/processed/scored_1980_2026.parquet` (committed) | Awards and vote ranks, All-NBA/All-Defense/All-Star, league-leader titles, playoff outcome, minutes, games, usage rate, TS+ |
| PEAK3 roster table | `cache/processed/regular_1980_2026.parquet` (committed) | Season position, season age |
| **Reference: season** | `data/reference/player_season_box.v1.parquet` | Per-game points/rebounds/assists/steals/blocks, three-pointers made, and the Basketball-Reference player id for each row |
| **Reference: career** | `data/reference/player_bio.v1.json` | Listed height, draft round and overall pick, birth country, franchises played for, seasons played, whether the whole career sits inside the data window |

The two reference artifacts are new in v5 and are the reason the taxonomy could
move at all: PEAK3's own tables carry rates per 100 possessions and no
biography whatsoever, because they were built to *score seasons*, not to
*describe players*. Both are built by
`scripts/build_player_reference_dataset.py` from Basketball-Reference — the
same source the committed parquets were themselves scraped from — and their
provenance, normalization rules, row counts and SHA-256 checksums live in
`data/reference/player_reference_manifest.v1.json`.

`scripts/fetch_player_reference_html.py` is the network step. It is run by hand,
never by CI, and fills a gitignored cache; the committed artifact is what every
test and runtime path reads. This is the arrangement
`docs/implementation/CI_DATA_CONTRACT.md` already prescribes for scraped
inputs.

### Missing data is missing

Every reference column is nullable and every predicate that reads one rejects
a null rather than guessing. A player with no recorded birthplace is not
"American by default"; a career that began before 1979-80 cannot be called
one-franchise or undrafted from in-window data, so it fails those constraints
outright. `tests/test_player_reference_dataset.py` asserts this three-state
behaviour directly.

---

## 3. Season facts and career facts

The answer universe is player-**seasons**, and most of the taxonomy asks about
the season in the square: was he an All-Star *that* year, did he average 25 a
game *that* year, did that team win the title.

Four families ask about the **player** instead — `draft`, `origin`, `size`,
`journey` — and those facts hold for every season of that player's career. So
"Lakers × Top-10 Pick" means *a Lakers season played by someone who was a
top-10 pick*. That is how grid games of this shape have always read. Every one
of those constraints says so in its own description, so the two grains are
never silently mixed.

---

## 4. The active taxonomy

90 constraints in 14 families. Counts are eligible player-seasons out of the
9,280-season answer pool.


### `team` — 30 categories

One per franchise, from `nba_peak.franchises`, with relocations and renames folded into today's team: a Seattle season answers **Thunder**, a Bullets season answers **Wizards**. Four shown.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `team_lal` | **Lakers** | 369 |  | Played for the Los Angeles Lakers that season. |
| `team_bos` | **Celtics** | 346 |  | Played for the Boston Celtics that season. |
| `team_okc` | **Thunder** | 339 |  | Played for the Oklahoma City Thunder that season. Includes seasons under the franchise's earlier names/cities: SEA. |
| `team_was` | **Wizards** | 320 |  | Played for the Washington Wizards that season. Includes seasons under the franchise's earlier names/cities: WSB. |

### `award` — 20 categories

Straight from the scored table's own award and league-leader columns. Sixth Man of the Year, Most Improved Player and Rookie of the Year are parsed from the same raw `awards` string MVP and DPOY were.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `award_all_star` | **All-Star** | 1,152 |  | Selected to the All-Star Game that season. |
| `award_all_nba` | **All-NBA** | 656 |  | Named to an All-NBA team (1st, 2nd, or 3rd) that season. |
| `award_dpoy_votes` | **DPOY Votes** | 602 |  | Received Defensive Player of the Year votes that season. |
| `award_all_defense` | **All-Defense** | 474 |  | Named to an All-Defensive team (1st or 2nd) that season. |
| `award_smoy_votes` | **6MOY Votes** | 446 |  | Received Sixth Man of the Year votes that season. |
| `award_all_defense_first` | **All-Def 1st** | 238 |  | Named to the All-Defensive First Team that season. |
| `award_mvp_top5` | **Top-5 MVP** | 237 |  | Finished top 5 in regular-season MVP voting that season. |
| `award_all_nba_first` | **All-NBA 1st** | 235 |  | Named to the All-NBA First Team that season. |
| `award_stat_leader` | **League Leader** | 211 |  | Led the league that season in points, rebounds, assists, blocks or steals per game. |
| `award_roy` | **ROY** | 49 |  | Won Rookie of the Year that season. |
| `award_mvp` | **MVP** | 47 |  | Won regular-season MVP that season. |
| `award_finals_mvp` | **Finals MVP** | 47 |  | Won Finals MVP that season. |
| `award_scoring_title` | **Scoring Title** | 47 |  | Led the league in points per game that season. |
| `award_assist_title` | **Assist Title** | 46 |  | Led the league in assists per game that season. |
| `award_steals_title` | **Steals Title** | 46 |  | Led the league in steals per game that season. |
| `award_rebound_title` | **Rebound Title** | 45 |  | Led the league in rebounds per game that season. |
| `award_blocks_title` | **Blocks Title** | 45 |  | Led the league in blocks per game that season. |
| `award_smoy` | **6MOY** | 44 |  | Won Sixth Man of the Year that season. |
| `award_dpoy` | **DPOY** | 43 |  | Won Defensive Player of the Year that season. |
| `award_mip` | **MIP** | 41 |  | Won Most Improved Player that season. |

### `era` — 5 categories

Decade of the season's start year. There is no 1970s: the data window opens at 1979-80, which is one season, not a decade.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `era_2010s` | **2010s** | 2,160 |  | Season began in the 2010s (2010-19 season starts). |
| `era_2000s` | **2000s** | 2,073 |  | Season began in the 2000s (2000-09 season starts). |
| `era_1990s` | **1990s** | 1,999 |  | Season began in the 1990s (1990-99 season starts). |
| `era_1980s` | **1980s** | 1,683 |  | Season began in the 1980s (1980-89 season starts). |
| `era_2020s` | **2020s** | 1,234 |  | Season began in the 2020s (2020-29 season starts). |

### `position` — 3 categories

The position the player logged **that season**, not a career label. A hyphenated listing counts for its first token only, so the three stay mutually exclusive.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `pos_guard` | **Guard** | 3,896 |  | Listed as a guard (PG, SG, G) that season. Position is read per season, not per career. |
| `pos_forward` | **Forward** | 3,689 |  | Listed as a forward (SF, PF, F) that season. Position is read per season, not per career. |
| `pos_center` | **Center** | 1,695 |  | Listed as a center (C) that season. Position is read per season, not per career. |

### `context` — 3 categories

Season shape.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `context_games_70` | **70+ Games** | 6,041 |  | Appeared in 70 or more games that season for this team. |
| `context_mpg_30` | **30+ MPG** | 4,119 |  | Played 30+ minutes per game that season. |
| `context_mpg_36` | **36+ MPG** | 1,192 |  | Played 36+ minutes per game that season. |

### `outcome` — 5 categories

How far that season's team actually went.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `outcome_made_playoffs` | **Playoffs** | 5,304 |  | Team reached the playoffs that season. |
| `outcome_missed_playoffs` | **No Playoffs** | 3,976 |  | Team did not make the playoffs that season. |
| `outcome_conf_finals` | **Conf Finals** | 1,474 |  | Team reached at least the conference finals that season. |
| `outcome_finals` | **Finals Run** | 762 |  | Team reached the NBA Finals that season. |
| `outcome_champion` | **Champion** | 385 |  | Won the NBA title that season. |

### `career` — 3 categories

How old the player was that season, from the season's own roster row.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `career_age_30_over` | **30+** | 2,420 |  | The player was 30 or older that season, as listed on the season's own roster row. |
| `career_age_23_under` | **23 & Under** | 2,010 |  | The player was 23 or younger that season, as listed on the season's own roster row. |
| `career_age_34_over` | **34+** | 616 |  | The player was 34 or older that season -- a late-career season, as listed on the season's own roster row. |

### `production` — 6 categories

The per-**game** box line, at the round numbers basketball conversation uses. v4's per-75-possession bands are retired.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `prod_ppg_20` | **20+ PPG** | 1,190 |  | Averaged 20 or more points per game that season, for this team. |
| `prod_rpg_10` | **10+ RPG** | 549 |  | Averaged 10 or more rebounds per game that season, for this team. |
| `prod_apg_7` | **7+ APG** | 525 |  | Averaged 7 or more assists per game that season, for this team. |
| `prod_ppg_25` | **25+ PPG** | 356 |  | Averaged 25 or more points per game that season, for this team. |
| `prod_bpg_2` | **2+ BPG** | 353 |  | Averaged 2 or more blocks per game that season, for this team. |
| `prod_spg_2` | **2+ SPG** | 294 |  | Averaged 2 or more steals per game that season, for this team. |

### `shooting` — 2 categories

Efficiency asked era-relative (because league-average true shooting rose roughly ten points across the window), volume asked in makes.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `shoot_elite_efficiency` | **Elite Eff.** | 1,002 | ● | True shooting percentage at least 110% of the league average that season. Measured against that season's own league, so an efficient 1985 season counts the same as an efficient 2025 one. |
| `shoot_threes_200` | **200+ 3PM** | 201 |  | Made at least 200 three-pointers that season, for this team. The three-pointer arrived in 1979-80 and stayed rare for a decade, so early seasons almost never qualify. |

### `usage` — 2 categories

Share of the team's possessions the player finished while on the floor.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `usage_high` | **25%+ USG** | 1,582 |  | Used at least 25% of the team's possessions while on the floor that season. |
| `usage_primary` | **28%+ USG** | 652 |  | Used at least 28% of the team's possessions while on the floor -- a genuine first option. |

### `draft` — 4 categories

How the player entered the league. Round is read from the draft table's own round sections, never inferred from the pick number.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `draft_top10` | **Top-10 Pick** | 3,623 |  | The player was selected with one of the first 10 overall picks in an NBA draft. |
| `draft_second_round` | **2nd Round** | 1,635 | ● | The player was drafted in the second round -- the round that draft actually ran, not a guess from the pick number. Drafts before 1989 ran well past two rounds, so a 30th overall pick in 1984 was a second-rounder and a 30th overall pick in 1996 was not. |
| `draft_undrafted` | **Undrafted** | 552 | ● | The player was never selected in an NBA draft. Only claimed for players whose careers began in 1979-80 or later, because an earlier route into the league (the 1976 ABA dispersal draft, for instance) leaves no NBA draft record either -- those players are treated as unknown rather than undrafted. |
| `draft_first_overall` | **No. 1 Pick** | 467 |  | The player was the first overall selection in an NBA draft. A fact about the player, so it holds for every season of his career. |

### `origin` — 1 categories

Where the player was born.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `origin_international` | **International** | 1,324 | ● | The player was born outside the United States. Birthplace, not citizenship or national team -- so Patrick Ewing (Jamaica) and Tim Duncan (US Virgin Islands) count, and a US-born player who represented another country does not. |

### `size` — 3 categories

Listed height, in inches, from Basketball-Reference's player index.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `size_6ft10` | **6'10"+** | 2,225 |  | The player's listed height is 6'10" or more. |
| `size_6ft3_under` | **6'3" & Under** | 1,878 |  | The player's listed height is 6'3" or less. |
| `size_7ft` | **7'0"+** | 743 |  | The player's listed height is 7'0" or more. |

### `journey` — 3 categories

What the career looked like, counted over seasons from 1979-80 on.

| id | header | eligible seasons | ⓘ | what qualifies |
|---|---|---|---|---|
| `journey_franchises_5` | **5+ Teams** | 4,023 | ● | The player appeared for at least 5 different NBA franchises across his career, counting seasons from 1979-80 on. Relocated franchises count once: Seattle and Oklahoma City are one team here, as are Washington's Bullets and Wizards. |
| `journey_seasons_15` | **15+ Seasons** | 2,295 | ● | The player appeared in at least 15 NBA seasons, counting seasons from 1979-80 on. |
| `journey_one_franchise` | **One Team** | 760 | ● | The player spent his entire NBA career with a single franchise. Only players whose whole career falls inside PEAK3's 1979-80 onward window are eligible, because an earlier career could have had teams this data cannot see. |

---

## 5. What v5 retired, and why

Seventeen constraints are **retired**: still present in
`nba_peak/daily_grid/constraints.py`, still resolvable by id, and deliberately
never drawn for a new board. See `V5_RETIRED_CONSTRAINT_IDS`.

| retired id | old header | why |
|---|---|---|
| `peak_60_plus` … `peak_85_plus` | `60+ PEAK` … `85+ PEAK` | PEAK3's own output as an eligibility test, in a game whose objective is to maximise PEAK3 output. The square collapses to "name the biggest all-time player who clears the bar." |
| `comp_statistical_impact` | `Top 10% SI` | A percentile of a proprietary model component. Unreadable without the methodology. |
| `comp_traditional_production` | `Top 10% TP` | Same. This is the category the pass was named after. |
| `comp_recognition` | `Top 10% REC` | Same. |
| `comp_postseason` | `Top 10% Postseason` | Same. |
| `comp_team_achievement` | `Top 10% Team` | Same. |
| `prod_scoring` | `22+ PTS/75` | Real, and written in a denominator no fan quotes. Replaced by `20+ PPG` / `25+ PPG`. |
| `prod_rebounding` | `10+ REB/75` | Replaced by `10+ RPG`. |
| `prod_playmaking` | `7+ AST/75` | Replaced by `7+ APG`. |
| `prod_rim_protection` | `2+ BLK/75` | Replaced by `2+ BPG`. |
| `prod_perimeter_defense` | `1.8+ STL/75` | Replaced by `2+ SPG`. |
| `shoot_efficiency` | `Elite TS+` | Same predicate, opaque header. Replaced by `shoot_elite_efficiency`, labelled **Elite Efficiency** with a definition marker. |
| `shoot_three_volume` | `3PT Volume` | Share of attempts taken from three. Replaced by `200+ 3PM`, which is the sentence a fan actually says. |

**Five of them never reached a board and now never will.** `v4` was in force for
exactly two dates (2026-09-09 and 2026-09-10), and the seven ids v4 introduced
that v5 retires could only ever have been drawn on those two. Two of them were
(`prod_perimeter_defense`, `shoot_efficiency`); `prod_scoring`,
`prod_rebounding`, `prod_playmaking`, `prod_rim_protection` and
`shoot_three_volume` were not. They stay registered anyway, because the cost is
five dataclass instances and the alternative is a taxonomy where "was this id
ever drawable" depends on how long its version happened to last. The `peak` and
`component` ids are a different case entirely: they were part of v2 and appear
on many published boards.

This is also why the reachability test is asserted per version and excludes the
retired set. A test that still demanded every registered id turn up would be
demanding that the retirement had not happened.

**Why replace rather than rename.** `shoot_efficiency` and
`shoot_elite_efficiency` have identical predicates. A published board's axis
label is part of that published board, and renaming in place would have changed
what an already-played board shows on the archive page. Adding a new id and
retiring the old one leaves history untouched.

---

## 6. Investigated and not shipped

Every one of these was researched or measured. Each is listed with the reason,
because "we did not think of it" and "we thought about it and it was a bad
idea" are different states and only one of them is worth revisiting.

### Blocked by gameplay, not data

| idea | measurement | verdict |
|---|---|---|
| **50-40-90 season** | 14 qualifying seasons in the whole window (already a column on the scored table) | An axis with 14 answers cannot survive being crossed with anything and still clear the six-answer floor. It is a great *fact* and a bad *axis*. |
| **30+ PPG season** | 56 seasons | Same shape of problem, one rung too tight. `25+ PPG` (356) is the version that works. |
| **10+ APG season** | 81 seasons | Evocative, too thin. `7+ APG` (525) ships instead. |
| **12+ RPG season** | 153 seasons | Redundant next to `10+ RPG` and materially tighter for no new idea. |
| **250+ threes made** | 44 seasons | Same. `200+ 3PM` (201) ships. |
| **Led the league in threes made** | not a column on the scored table; would need a new derivation | The five league-leader flags that exist already ship individually. |
| **4+, 6+, 7+, 8+ franchises** | 63%, 28%, 16%, 8% of seasons | Four rewordings of one question. One rung (`5+`) plus its opposite (`One-Franchise Career`) says everything the family has to say. |
| **10+ season career** | 73% of pool seasons | True of nearly three seasons in four. A filter, not a question. `15+` (25%) ships. |
| **"Born in the USA"** | 86% of pool seasons | Same problem, and it is the trivial complement of a category that already ships. |

### Blocked by definition quality

| idea | why not |
|---|---|
| **Lottery pick** | The lottery has had 7 teams (1985-88), 9 (1989), 11 (1990-94), 13 (1995-2003) and 14 (2004 on). "Lottery pick" therefore names a different pick range in five different eras, and any single cutoff would be wrong for most of the window while *looking* precise. `Top-10 Pick` asks a neighbouring question that has one unambiguous answer in every year. |
| **Drafted straight from high school** | The clean signal is on the individual player page (a `High School:` field with no college), which means roughly 1,400 extra requests to build; the cheap signal — an empty college column on the draft page — does not distinguish Kobe Bryant from Žydrūnas Ilgauskas, because international entrants have no college either. Inferring it from "young and no college" is exactly the kind of guess this taxonomy does not make. Genuinely worth doing later; see §10. |
| **International draft entrant** | The NBA's *draft-eligibility* definition of "international player" (three years' residence abroad, never enrolled at a US college, did not finish high school in the US) is a different concept from birthplace and is not published as a per-player field anywhere reliable. Shipping it alongside `International Player` would put two things called "international" on the same board meaning different things. |
| **Wing / Big** | Position in the source is one code per season, and the three shipped groups (guard / forward / center) are mutually exclusive because of it — which is what lets the generator guarantee a guard × forward square is never empty. "Wing" spans SG and SF and would overlap two of them, breaking that invariant for a label that is a matter of opinion anyway. |
| **Career-grain awards ("was an All-Star at some point")** | The season-grain versions are strictly more precise and already ship. A career-grain duplicate would put "All-Star" on a board meaning something different from the "All-Star" on yesterday's board. |

---

## 7. Generation quality

Measured with `scripts/audit_daily_grid_novelty.py` over the same window length
before and after, against the real committed pool and the same `generate_board`
call path the API uses.

```
.venv/bin/python3 scripts/audit_daily_grid_novelty.py --days 365 --start 2026-09-09   # v4
.venv/bin/python3 scripts/audit_daily_grid_novelty.py --days 365 --start 2026-09-11   # v5
```

| | v4 (365 days) | v5 (365 days) | v5 (1,000 days) |
|---|---|---|---|
| generation failures | 0 | 0 | 0 |
| zero- or one-answer cells | 0 | 0 | 0 |
| mean attempts per board | 783.5 | **256.2** | 256.9 |
| worst-case attempts | 4,941 | **2,038** | 3,022 |
| PEAK3-native share of axis slots | 3.9% | **0%** | 0% |
| boards drawing on 6 distinct families | 121 | **172** | 442 |
| boards drawing on only 4 | 56 | **35** | 86 |
| a family taking both its slots two days running | 1 | **0** | 0 |
| axis repeats inside the id cooldown | 11 | **0** | 0 |
| matchup repeats inside the pair cooldown | 3 | **0** | 0 |
| closest repeat of one axis | 1 board | **4 boards** | 4 boards |
| closest repeat of one matchup | 5 boards | **11 boards** | 11 boards |
| mean gap between matchup repeats | 90.6 boards | **97.8** | 170.6 |
| most-used single axis, share of all slots | 2.60% | 2.69% | 2.53% |
| largest family share (`team`) | 22.1% | **20.3%** | 20.4% |
| difficulty split (easy / medium / hard) | 109 / 127 / 129 | 93 / 150 / 122 | 257 / 374 / 369 |

Cell pools over 1,000 v5 boards (9,000 squares): smallest 6, 10th percentile
15, median 77, 90th percentile 475.

The attempt count falling by two thirds is the load-bearing number behind the
rest. A wider taxonomy of families that actually compose means the generator
finds an acceptable board far sooner, which is what leaves the novelty filters
enough headroom to be satisfied every single day instead of falling back —
hence the zero cooldown violations, where v4 had fourteen.

---

## 8. Historical compatibility

Daily Grid boards are permanently addressable and previous boards have been
played, so a taxonomy revision may never move one.

The mechanism is a **version ladder** in `generator.py`: each entry is the date
at or before which a board resolves under that version, and
`_version_for_date()` is a pure, total function over it.

| dates | version | taxonomy it samples from |
|---|---|---|
| through 2026-08-25 | `daily_grid.v2` | no 6MOY/MIP, no v4 families, no v5 families |
| 2026-08-26 – 2026-09-08 | `daily_grid.v3` | v3 awards, no v4 or v5 families |
| 2026-09-09 – 2026-09-10 | `daily_grid.v4` | everything except v5; **includes** the retired ids |
| from 2026-09-11 | `daily_grid.v5` | everything except the 17 retired ids |

The version is a salt on the seed and part of the board id, so a v4 date and a
v5 date can never collide even before the taxonomy differs.

`_legacy_taxonomy()` reconstructs each version's population by filtering — which
works because `constraints.py` only ever appends within a category block, so
removing exactly the ids that did not exist at a version reproduces that
version's list in the same order. Generation samples that list **by index**
against a date-seeded RNG, so the length and order of the population is itself
part of what a past date's determinism depends on.

**v5 is the first version that also removes**, and that required one real
change: `_legacy_taxonomy` used to be skipped entirely when the date resolved
to the current version, as a no-op that was only valid while every version was
purely additive. It now runs for every version, and subtracts v5's own
retirements when the version is v5.

Evidence the history is intact:

- `TestVersionCutover::test_legacy_dates_resolve_to_their_recorded_board` pins
  three v2 boards by id, both axis tuples and attempt count.
- `TestVersionCutover::test_v3_and_v4_dates_resolve_to_their_recorded_board`
  pins the v3 boundary and **both** v4 dates — chosen because two of the three
  are built from constraints v5 retires, so they are what would break first if
  "retired" ever came to mean "gone".
- `TestV5Taxonomy::test_pre_v5_boards_never_use_a_v5_constraint` and
  `::test_v5_boards_never_use_a_retired_constraint` check the boundary in both
  directions over real generated boards.

---

## 9. Rebuilding the reference dataset

```bash
# 1. Network step. Local developer action, never CI. ~230 requests, ~15 min,
#    politely rate-limited, resumable. Fills cache/html/reference/ (gitignored).
python3 scripts/fetch_player_reference_html.py

# 2. Build the committed artifacts from that cache plus the existing
#    cache/html/NBA_*_per_game.html scrape cache. No network.
python3 scripts/build_player_reference_dataset.py

# 3. Verify.
.venv/bin/python3 -m pytest tests/test_player_reference_dataset.py -q
```

Step 2 rewrites the manifest, including the SHA-256 of each artifact, and
`tests/test_player_reference_dataset.py` fails if a committed artifact and its
recorded checksum ever disagree.

---

## 10. Follow-up data work worth doing

1. **Drafted straight from high school.** Needs the `High School:` / `College:`
   fields from individual player pages, for the 146 pool players whose college
   column is empty (101 of them foreign-born, 45 US-born and therefore the real
   candidates). That is a bounded fetch, not an open-ended one, and it would
   unlock a genuinely great category.
2. **Traded-season stints in the answer pool.** The pool drops multi-team
   ("2TM") rows entirely, so a traded star's season is simply absent as an
   answer. `data/reference/player_season_box.v1.parquet` now carries the real
   per-team rows; what is still missing is a per-stint PEAK3 score, and showing
   a season-aggregate score next to one team's badge would be wrong.
3. **Birth country for the 1979-80 pre-window players.** Coverage is complete
   for everyone in the pool today, but a future window extension backwards would
   need the same both-sides fetch re-run.
4. **`career_fully_in_window` becomes less restrictive if the model window ever
   opens before 1979-80.** Two constraints (`journey_one_franchise`,
   `draft_undrafted`) are gated on it purely because the data starts where it
   starts.
