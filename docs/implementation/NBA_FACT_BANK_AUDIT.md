# NBA Fact of the Day — editorial fact-bank audit

Date of audit: **2026-08-07**. Every entry in `data/facts/editorial_facts.json`
was re-checked against a named published source, and the file now carries the
`checked_on` date above on all 91 entries.

Status: **91 entries audited, 64 rewritten, 0 removed, 1 confirmed-false claim
eliminated.** A new build-time gate (`nba_peak/nba_facts/validation.py`) refuses
any entry that lacks a dereferenceable source, a review date or a declared claim
type, or that uses language a source cannot settle.

---

## 1. Why this audit happened

The bank shipped a sentence that was false by seven championships:

> *"Europe's most successful basketball club has more continental titles than
> any NBA franchise has championships."*

Real Madrid have **eleven** European club titles. The Boston Celtics have
**eighteen** NBA championships. The entry was `verified: true`, scored 5/5 for
`source_confidence`, named two publications, and passed every gate the pipeline
had — because every gate the pipeline had was asking whether the entry was
**filled in**, not whether the claim was **true**.

Three failure classes came out of the sweep, and all three were invisible to the
existing checks:

| Class | Count | Example |
|---|---|---|
| **Claim is false, or was true and has since stopped being true** | 23 | `kobe-81` said 81 was the highest post-merger single-game total outside Wilt's 100. Bam Adebayo scored 83 on 10 March 2026. |
| **Claim is true but the superlative is unbounded or mis-scoped** | 16 | `russell-first-black-coach` said "American professional sport". Fritz Pollard co-coached the Akron Pros in 1921, 45 years earlier. |
| **Sentence is opinion wearing a fact's clothes** | 26 | "the most famous floor in basketball", "the tournament's most quoted number", "a player most fans could not name". |

(The classes overlap; 64 entries were rewritten in total.)

### 1.1 Disposition of every false or expired claim

All 23 are enumerated in §4.1 with the specific defect and the source used to
settle it. Their disposition:

| | |
|---|---|
| False or expired claims found | **23** |
| Corrected and re-verified against a named source | **23** |
| Removed from the publishable bank | **0** |
| Intentionally retained uncorrected | **0** |
| Still false or expired in the published bank | **0** |

Nothing was removed because in every one of the 23 a true, bounded version of
the claim existed and was more interesting than the false one — the Real Madrid
entry is the clearest case: the cross-league comparison was the false half, and
"most-decorated club in European basketball" is both true and the reason anyone
would read the sentence.

**Correction to an earlier count.** The first pass of this document reported 22
here while listing 23 rows in §4.1. Twenty-three is the count; the table is the
authority and `tests/test_nba_facts_retired_claims.py` asserts that this
document's §4.1 and the register agree, so the two cannot drift again.

### 1.2 How "zero false facts" is enforced, and what enforces nothing

`nba_peak/nba_facts/validation.py` is a STRUCTURAL gate. It refuses an entry
with no dereferenceable `source_url`, no `checked_on`, no declared `claim_type`,
or with language a source cannot settle. **It does not and cannot establish that
a sentence is true**, and no schema can. The entry that started this audit
passed every structural check it had.

Truth here is established by human audit — §4 of this document, one entry at a
time against a named published source — and held by
`tests/test_nba_facts_retired_claims.py`, which encodes each retired assertion
as a pattern that must match nothing the bank can serve. That file is a ratchet
on the audit, not a substitute for it: it proves a known-false claim cannot
return, not that the remaining claims are true.

---

## 2. The three items the brief named

### 2.1 `euroleague-titles` — **rewritten**, not deleted

The false half of the claim was the cross-competition comparison, which nobody
had run. The true half — Real Madrid are the most-decorated club in European
basketball — is checkable and still interesting, so the entry survives with the
comparison removed and the population named:

> **Real Madrid has won the European club championship eleven times, more than
> any other club.**
> CSKA Moscow is next with eight. Panathinaikos won a seventh in 2024, thirteen
> years after its sixth, by beating Real Madrid 95–80 in the final in Berlin.

A second error surfaced while checking the first: the old body called
Panathinaikos "second on the list". CSKA Moscow have eight, so Panathinaikos are
third. `claim_type: record`. Source: Wikipedia's EuroLeague all-time title table
(sourced to EuroLeague Basketball) —
<https://en.wikipedia.org/wiki/EuroLeague>.

`tests/test_nba_facts_validation.py` asserts the false claim is not in the bank
**by its shape rather than by its key**, so a reworded re-addition is caught too,
plus a companion test proving the pattern matches the original sentence.

### 2.2 `air-jordan-banned` — **rewritten**

The "$5,000 a game" fine is marketing legend. What is documented:

* The NBA's 1984 uniform rule required footwear to be predominantly white and
  to match a player's teammates.
* In **February 1985** the league wrote to Nike about the red-and-black shoes
  Jordan had worn "on or around October 18, 1984". Those were **Nike Air
  Ships** — the Air Jordan 1 was not finished.
* Nike answered with a television advertisement: *"On October 18th, the NBA
  threw them out of the game."*
* **David Stern said afterwards that the shoes were never banned.**

The rewrite states only that, drops the fine entirely, and features "Air Ship"
as the number-slot. `claim_type: attribution`. Source: Complex, *"Shipwrecked:
The Untold Story Behind Michael Jordan's Banned Sneakers"* —
<https://www.complex.com/sneakers/a/russ-bengtson/nike-air-ship-history>.

### 2.3 `MIN_FACTS` — **not breached**

Nothing was removed, so the question is moot in this pass: the built bank is
**187 facts** against a floor of 180, and the featured tier is unchanged. The
reason removal was avoided is not squeamishness — it is that in every case a
true, bounded, still-interesting version of the claim existed, which is the
outcome the brief asked to prefer. The one entry whose truth genuinely expired
(`kobe-81`) kept its event and lost its superlative.

Two floors would have been at risk had entries been deleted, and they are worth
recording because they are not obvious:

* `bank.MIN_FACTS = 180` over the whole bank, and removing editorial entries
  shrinks the bank **twice** — once directly, and again because
  `quality.MAX_ROTATION_GROUP_SHARE` is a share of the provisional bank, so a
  smaller denominator evicts derived facts as well.
* `coverage.COVERAGE_TARGETS["current_nba"] = 10`, and the bank has exactly ten
  `current_nba` entries. Deleting any one of them fails
  `test_the_bank_meets_every_coverage_target`.

---

## 3. Full audit table

`pass` means the prose is unchanged and the claim was confirmed against the
listed source. `rewritten` means the prose changed; the reason is given below
the table for every one of them.

| Key | Category | `claim_type` | Verdict |
|---|---|---|---|
| `shot-clock-1954` | rules | `record` | pass |
| `biasone-arithmetic` | rules | `attribution` | rewritten |
| `wilt-100-no-film` | nba_history | `event` | rewritten |
| `fiba-1989-vote` | olympics_fiba | `event` | rewritten |
| `dream-team-angola` | olympics_fiba | `event` | rewritten |
| `first-three-pointer` | rules | `rule` | rewritten |
| `short-three-line` | tactics | `rule` | pass |
| `kareem-debut` | player_story | `event` | rewritten |
| `lebron-passes-kareem` | records | `event` | rewritten |
| `argentina-2004` | olympics_fiba | `record` | pass |
| `wnba-first-game` | womens | `event` | rewritten |
| `swoopes-first-signing` | womens | `event` | rewritten |
| `taurasi-record` | womens | `record` | rewritten |
| `wnba-attendance-2024` | current_nba | `record` | rewritten |
| `naismith-1891` | culture | `event` | pass |
| `euroleague-titles` | international_leagues | `record` | rewritten |
| `nbl-australia` | international_leagues | `context` | rewritten |
| `yao-shanghai` | global | `event` | rewritten |
| `draft-1984-bowie` | draft | `event` | rewritten |
| `ginobili-57` | draft | `record` | pass |
| `jokic-41` | draft | `event` | rewritten |
| `lakers-33` | streaks | `record` | rewritten |
| `kareem-ended-and-inherited` | connections | `event` | rewritten |
| `willis-reed-1970` | playoffs_finals | `event` | rewritten |
| `flu-game-1997` | playoffs_finals | `event` | rewritten |
| `ray-allen-2013` | playoffs_finals | `event` | rewritten |
| `horry-seven-rings` | role_players | `record` | rewritten |
| `celtics-eight-straight` | records | `record` | pass |
| `shot-clock-scoring-jump` | statistical_oddity | `record` | pass |
| `three-point-inheritance` | obscure_history | `rule` | pass |
| `olympics-1936-mud` | olympics_fiba | `event` | rewritten |
| `olympics-1972-three-seconds` | olympics_fiba | `event` | rewritten |
| `lithuania-grateful-dead` | olympics_fiba | `event` | rewritten |
| `lithuania-second-religion` | global | `context` | rewritten |
| `sabonis-nine-year-wait` | draft | `event` | pass |
| `petrovic-third-round` | player_story | `event` | rewritten (**key renamed**) |
| `oscar-schmidt-never-nba` | global | `record` | rewritten |
| `basketball-africa-league` | international_leagues | `event` | rewritten |
| `philippines-obsession` | culture | `context` | rewritten |
| `hand-check-2004` | rules | `rule` | rewritten |
| `zone-defence-2001` | rules | `rule` | pass |
| `draft-lottery-1985` | draft | `rule` | rewritten |
| `wilt-55-rebounds` | records | `record` | pass |
| `skiles-30-assists` | records | `record` | rewritten |
| `kobe-81` | historic_games | `event` | rewritten |
| `tallest-and-shortest` | connections | `record` | rewritten |
| `reggie-8-in-9` | historic_games | `event` | pass |
| `tmac-13-in-35` | historic_games | `event` | rewritten |
| `lakers-lakes` | franchise | `context` | rewritten |
| `jazz-new-orleans` | franchise | `context` | pass |
| `grizzlies-mounties` | franchise | `context` | rewritten |
| `raptors-jurassic-park` | franchise | `context` | rewritten |
| `air-jordan-banned` | culture | `attribution` | rewritten |
| `aba-dunk-contest` | obscure_history | `event` | rewritten |
| `nba-jam-1993` | culture | `record` | rewritten |
| `chuck-taylor` | culture | `attribution` | rewritten |
| `comets-four-straight` | womens | `record` | pass |
| `sga-back-to-back-mvp` | current_nba | `record` | pass |
| `knicks-2026-title` | current_nba | `event` | pass |
| `brunson-45-closeout` | current_nba | `record` | rewritten |
| `wembanyama-unanimous-dpoy` | current_nba | `record` | pass |
| `flagg-youngest-fifty` | current_nba | `record` | pass |
| `flagg-roy-2026` | current_nba | `record` | pass |
| `doncic-scoring-title-2026` | current_nba | `event` | rewritten |
| `spurs-2026-finals` | current_nba | `event` | pass |
| `lebron-23-seasons` | current_nba | `record` | pass |
| `international-players-2025-26` | global | `record` | pass |
| `wilson-four-mvps` | womens | `record` | rewritten |
| `aces-2025-sweep` | womens | `event` | rewritten |
| `clark-rookie-assists` | womens | `record` | rewritten |
| `valkyries-inaugural` | womens | `record` | rewritten |
| `unrivaled-2025` | womens | `event` | rewritten |
| `germany-2023-world-cup` | olympics_fiba | `event` | rewritten |
| `spain-golden-generation` | olympics_fiba | `record` | rewritten |
| `slovenia-2017` | olympics_fiba | `event` | pass |
| `yugoslavia-world-cups` | global | `record` | rewritten |
| `ginobili-triple-crown` | international_leagues | `record` | pass |
| `canada-2023-bronze` | olympics_fiba | `event` | rewritten |
| `first-nba-game-1946` | nba_history | `event` | pass |
| `baa-nbl-merger-1949` | nba_history | `event` | pass |
| `earl-lloyd-1950` | nba_history | `event` | rewritten |
| `first-all-star-1951` | historic_games | `attribution` | rewritten |
| `russell-first-black-coach` | nba_history | `record` | rewritten |
| `russell-wilt-142` | nba_history | `record` | rewritten |
| `aba-merger-1976` | nba_history | `event` | pass |
| `territorial-picks` | nba_history | `rule` | rewritten |
| `haywood-supreme-court` | nba_history | `rule` | rewritten |
| `nba-logo-jerry-west` | nba_history | `attribution` | rewritten |
| `magic-bird-1979-final` | historic_games | `record` | rewritten |
| `boston-parquet` | nba_history | `context` | rewritten |
| `curry-unanimous-mvp` | nba_history | `record` | rewritten |

**Totals: 27 pass, 64 rewritten, 0 removed.**

---

## 4. Every rewrite, with its reason and source

### 4.1 The claim was false

| Key | What was wrong | Source |
|---|---|---|
| `euroleague-titles` | Real Madrid 11 European titles vs Boston's 18 NBA championships — the comparison is false by seven. Separately, Panathinaikos are third (7) behind CSKA Moscow (8), not second. | <https://en.wikipedia.org/wiki/EuroLeague> |
| `kobe-81` | "the highest single-game total of the post-merger era outside Wilt Chamberlain's 100" stopped being true on **10 March 2026**, when Bam Adebayo scored 83 for Miami. The comparison is gone; the game remains. | <https://www.espn.com/nba/story/_/id/48169100> |
| `russell-first-black-coach` | "the first Black head coach in American professional sport" — Fritz Pollard co-coached the Akron Pros in **1921**, 45 years before Russell. Bounded to the NBA. | <https://www.profootballhof.com/players/fritz-pollard> |
| `russell-wilt-142` | Basketball-Reference — the source the entry itself named — gives **143** meetings (94 regular season, Russell 57-37; 49 playoff, Russell 29-20) and **86** wins, not 142 and 85. | <https://www.statmuse.com/nba/ask/bill-russell-playoff-record-vs-wilt-chamberlain> |
| `haywood-supreme-court` | 401 U.S. 1204 was **not a merits ruling of the Court**. It was an in-chambers opinion by Justice Douglas as circuit justice, 1 March 1971, reinstating a preliminary injunction; the case settled. | <https://www.law.cornell.edu/supremecourt/text/401/1204> |
| `nba-logo-jerry-west` | "The NBA has never officially said who is in its logo" went stale on **12 June 2024**, when Adam Silver told the New York Times there had never been any doubt. | <https://www.cbssports.com/nba/news/nba-commissioner-adam-silver-finally-says-that-jerry-west-inspired-the-leagues-logo> |
| `magic-bird-1979-final` | "The most-watched basketball game ever played" is false by audience — 1979 drew ~35.1M, Game 6 of the 1998 NBA Finals drew 35.89M. The *rating* claim (24.1 vs 22.3) survives, so the headline now says highest-rated. | <https://www.forbes.com/sites/timcasey/2019/04/06/how-the-1979-final-four-helped-propel-college-basketball-nba-to-new-business-heights/> |
| `germany-2023-world-cup` | "having never won anything before" — Germany won **EuroBasket 1993** (and again in 2025). Replaced with "first world title", which is true. | <https://www.fiba.basketball/en/news/basketballworldcup-2023-news-game-report-germany-v-serbia> |
| `petrovic-third-round` | Petrović was a **third-round** pick, **60th overall**, in 1986 — not second round. The error was in the headline, the `feature` and the entry key, which is why the key was renamed. He was also never an All-Star (All-NBA Third Team, 1992-93). | <https://en.wikipedia.org/wiki/1986_NBA_draft> |
| `oscar-schmidt-never-nba` | "The most prolific scorer in basketball history" stopped being true on **2 April 2024**, when LeBron James passed 49,737. Recast as a past-tense record. | <https://en.wikipedia.org/wiki/List_of_basketball_players_with_most_career_points> |
| `draft-lottery-1985` | "Before 1985 the worst record got the first pick" is wrong. From **1966 to 1984** the first pick was a coin flip between the worst team in each conference. | <https://en.wikipedia.org/wiki/NBA_draft_lottery> |
| `olympics-1936-mud` | "No Olympic basketball game has been played outdoors since" is false — Olympic 3x3 was outdoors at Tokyo 2020 (Aomi) and Paris 2024 (Place de la Concorde). Bounded to five-on-five. | <https://www.olympics.com/en/news/olympic-basketball-s-muddy-beginnings> |
| `wnba-first-game` | "a building the Lakers had just left" — the Lakers played at the Forum until **May 1999**, two years after the WNBA opener. Also adds the correct score, 67–57. | <https://www.espn.com/wnba/story/_/id/16256278/inside-wnba-inaugural-game-25-seasons-later> |
| `swoopes-first-signing` | The two intervals were swapped. Her son was born **25 June 1997, four days after** the opener; she returned **7 August**, six weeks later. | <https://www.wnba.com/news/sheryl-swoopes-career-timeline> |
| `taurasi-record` | She no longer holds the career field-goals record — Tina Charles passed her on **4 September 2025** — and the "2,500 points clear" margin has eroded to ~2,250. Recast as what she held at retirement, which cannot decay. | <https://www.cbssports.com/wnba/news/tina-charles-becomes-wnbas-all-time-fg-leader-what-would-it-take-to-pass-diana-taurasis-scoring-record> |
| `wnba-attendance-2024` | 20,711 was superseded on **10 July 2026** (Dallas Wings v Toronto Tempo, 20,966). "The largest attendance jump in its history" is asserted by no source. | <https://www.espn.com/wnba/story/_/id/41477940/wnba-touts-48-attendance-jump-23m-fans-attend-games> |
| `yao-shanghai` | Yao played **eight** seasons, not nine (he missed 2009-10 entirely), and his CBA chairmanship ran Feb 2017 – **Oct 2024**, seven years eight months — so the headline's comparison was false either way, and "held the role for years afterwards" was written open-ended. | <https://www.basketball-reference.com/players/m/mingya01.html> |
| `jokic-41` | Two errors: Jokić went **38** places after the first centre (Joel Embiid at No. 3), not forty; and "he had never played outside Serbia" is false — he played the 2014 Nike Hoop Summit in Portland, which is where most NBA teams saw him. | <https://www.denverstiffs.com/2014/6/26/5848200/2014-nba-draft-denver-nuggets-select-nikola-jokic-41st-overall> |
| `lakers-33` | The streak ran to **7 January 1972** (the 33rd win, at Atlanta). 9 January was the *defeat* at Milwaukee. | <https://www.nba.com/news/trending-topics-will-any-team-ever-surpass-lakers-33-game-win-streak> |
| `hand-check-2004` | Basketball-Reference gives **93.4** ppg for 2003-04, not 93.7, so the jump is **+3.8**, not +3.5. The old figure came from two secondary outlets that contradict each other. | <https://www.basketball-reference.com/leagues/NBA_stats_per_game.html> |
| `nba-jam-1993` | "the first mass-market NBA product that was not a broadcast" is false — Topps held an NBA card licence from 1969, and *Lakers versus Celtics* (EA, 1989) was the first NBA-endorsed video game. Clause removed; the grossing record kept. | <https://en.wikipedia.org/wiki/NBA_Jam_(1993_video_game)> |
| `chuck-taylor` | Three defects. (1) "108 years later" drifts by one every year and had no `valid_until`. (2) "The first basketball shoe" is not claimed by Converse's own cited history, and Spalding sold canvas basketball high-tops around 1900. (3) It was introduced as the **Non-Skid** in 1917 and branded All Star in 1919. | <https://about.nike.com/en/magazine/converse-chuck-taylor-all-star-iconic-sneaker-true-history> |
| `valkyries-inaugural` | "the first WNBA expansion side to do **either**" is false on the record half — the 1998 Detroit Shock went 17-13 in their first season. Bounded to the playoff berth, which is genuinely a first. | <https://www.espn.com/wnba/story/_/id/46161843/valkyries-first-wnba-expansion-team-reach-playoffs-inaugural-season> |

### 4.2 The claim was true but overstated, mis-scoped or imprecise

| Key | What was tightened | Source |
|---|---|---|
| `olympics-1972-three-seconds` | The American Olympic run was **63** games, not 64 (HISTORY's "64" counts the loss). "Has never accepted the silver medals" rewritten as the bounded, checkable "have refused their silver medals ever since". | <https://en.wikipedia.org/wiki/1972_Olympic_men%27s_basketball_final> |
| `lithuania-grateful-dead` | Snopes records the band as **one** source of funding (a cheque plus licensed merchandise revenue), not the funder; and the tie-dyes were **shirts worn on the podium**, not playing kit. | <https://www.snopes.com/fact-check/grateful-dead-lithuania-basketball/> |
| `basketball-africa-league` | Only **six** of the twelve clubs entered as national champions; the other six came through FIBA qualifying tournaments. | <https://www.espn.com/nba/story/_/id/31158325/nba-basketball-africa-league-do-debut-16-rwanda> |
| `spain-golden-generation` | "built around Pau and Marc Gasol… more or less the same team" fails for 2022, where **neither Gasol played**; only Rudy Fernández remained from 2006, and Willy Hernangómez was that tournament's MVP. | <https://en.wikipedia.org/wiki/EuroBasket_2022_squads> |
| `yugoslavia-world-cups` | Headline said one country, body said two entities. Now states that FIBA counts all five under Yugoslavia and that both states have dissolved. | <https://www.espn.com/nba/story/_/id/48259179/who-won-fiba-basketball-world-cup-all-winners-list> |
| `earl-lloyd-1950` | Clifton's Knicks debut was **three days** later, not one. Adds the 78–70 result at Rochester. | <https://www.history.com/this-day-in-history/october-31/earl-lloyd-becomes-first-black-player-in-the-nba> |
| `first-all-star-1951` | **Haskell Cohen** proposed the game; Walter Brown offered the Garden and underwrote it. The old entry credited Brown with the idea. | <https://www.guinnessworldrecords.com/world-records/428822-first-nba-all-star-game> |
| `territorial-picks` | The rule ran 1949–1965, which is **seventeen drafts**; "sixteen years" was at odds with the entry's own cited span. | <https://en.wikipedia.org/wiki/NBA_territorial_pick> |
| `kareem-debut`, `lebron-passes-kareem` | Abdul-Jabbar held the scoring record **38 years 10 months**, so "39 years" rounded up. Both now say thirty-eight. | <https://www.nbcnews.com/news/us-news/lebron-james-breaks-nba-scoring-record-38388th-point-surpassing-kareem-rcna69064> |
| `tmac-13-in-35` | 35 seconds is the game clock at 76–68; the scoring run itself is ~33 seconds, which is why NBA.com's video says 33. Both now stated. Last three came with **1.7** seconds, not "two". | <https://en.wikipedia.org/wiki/13_points_in_35_seconds> |
| `tallest-and-shortest` | Bol played only **five games** in 1994-95 before a knee injury, so the three-way overlap rests on a narrow window. Heights now given as *listed at*, since Guinness measured Bol just under 231 cm. | <https://www.guinnessworldrecords.com/world-records/64625-tallest-nba-player> |
| `grizzlies-mounties` | The RCMP **objected**; "blocked" is stronger than the record supports. | <https://en.wikipedia.org/wiki/Vancouver_Grizzlies> |
| `raptors-jurassic-park` | The fan contest named the team in **May 1994**; the body's "arrived in 1995" made "the year before" read as an off-by-one. | <https://www.cp24.com/local/toronto/2026/04/13/welcome-back-to-jurassic-park-how-toronto-raptors-fans-can-attend-the-tailgating-party/> |
| `aba-dunk-contest` | "the contest, the three-point line and Erving all came with it" implied all three transferred at the 1976 merger. The line arrived in 1979-80 and the NBA's own dunk contest in 1984. | <https://en.wikipedia.org/wiki/1976_ABA_All-Star_Game> |
| `unrivaled-2025` | The venue is a **purpose-built arena in Medley, Florida**, not "a warehouse in Miami". Tip-off was 17 January 2025. | <https://www.unrivaled.basketball/game/xydxurm98lce> |
| `aces-2025-sweep` | The old headline read as though Las Vegas had never lost a Finals game across all three titles; they lost games in both the 2022 and 2023 Finals. Scoped to 2025. | <https://www.boston.com/sports/sports-news/2025/10/10/wnba-finals-aces-mercury-game-4-aja-wilson/> |
| `brunson-45-closeout` | ESPN scopes the Jordan/Pettit/Antetokounmpo list to a closeout game **to win** the Finals; "a Finals closeout" read broader. | <https://www.espn.com/nba/story/_/id/49056933/knicks-brunson-seals-finals-mvp-honors-45-points-game-5> |
| `wilson-four-mvps` | "Nobody else has more than three" is a live standing with no expiry. Recast as a completed count plus the three players she passed, which cannot decay. | <https://www.cbssports.com/wnba/news/2025-wnba-mvp-aces-aja-wilson-becomes-first-player-to-win-award-four-times-after-leading-vegas-to-playoffs/> |
| `curry-unanimous-mvp` | "Only one MVP has ever been unanimous" is a live standing one May announcement could end. Recast as "In 2016 Stephen Curry became the NBA's first unanimous MVP", which is permanent. (Checked: the 2025-26 vote was 83 of 100.) | <https://www.espn.com/nba/story/_/id/15499690/stephen-curry-golden-state-warriors-first-unanimous-most-valuable-player> |
| `horry-seven-rings` | Career average is exactly **7.0** over sixteen seasons; "seven points a game" was a rounding of an already-round number. | <https://www.basketball-reference.com/players/h/horryro01.html> |
| `flu-game-1997` | The go-ahead three came with **25 seconds** left, and Chicago won **90–88** — neither was stated. | <https://www.nba.com/news/history-finals-moments-jordan-flu-game-1997> |
| `ray-allen-2013` | "out-jumped two Spurs" is embellishment on a rebound; "with the clock off" is not a thing. Replaced with the score and the sequence. | <https://www.nba.com/news/history-finals-moments-ray-allen-3-pointer-game-6> |
| `canada-2023-bronze` | Adds the score (127–118) the entry omitted. | <https://www.basketball.ca/news/canada-captures-historic-bronze-at-fiba-world-cup-with-ot-win-over-usa> |
| `nbl-australia` | The NBL's 1979 season finished before the NBA's 1979-80 season began, so "the same season" is loose; "the same year" is exact. | <https://en.wikipedia.org/wiki/National_Basketball_League_(Australia)> |
| `kareem-ended-and-inherited` | Fourteen of his twenty seasons were in Los Angeles, so "the second half of his career" understated it. | <https://www.nba.com/article/2019/01/09/legendary-moments-bucks-end-lakers-33-game-win-streak> |
| `wilt-100-no-film` | Jim Trelease taped the late-night **rebroadcast**, using a radiator as an aerial. | <https://www.loc.gov/static/programs/national-recording-preservation-board/documents/WiltChamberlin100PointGame.pdf> |
| `fiba-1989-vote` | The body was **ABAUSA** in April 1989; "USA Basketball" is the later name. | <https://www.washingtonpost.com/archive/sports/1989/04/08/vote-means-nba-players-eligible-for-olympics/36866705-8401-472e-b581-0be427eb0663/> |
| `clark-rookie-assists` | 40 **starts**, and the 8.4 average restated as the league high rather than an unbounded comparison. | <https://www.wnba.com/news/2024-kia-rookie-of-the-year> |
| `lakers-lakes` | The franchise began as the Detroit Gems; it took the *name* in Minneapolis. | <https://en.wikipedia.org/wiki/Los_Angeles_Lakers> |
| `doncic-scoring-title-2026` | "one of the largest deals the league has made" is an unbounded superlative nobody sized. Replaced with what actually moved. | <https://www.espn.com/nba/player/_/id/3945274/luka-doncic> |
| `lithuania-second-religion` | "and means it almost literally" is editorial. Replaced with the medals, the 1999 Žalgiris EuroLeague title and the NBA line. | <https://en.wikipedia.org/wiki/Basketball_in_Lithuania> |

### 4.3 The sentence was opinion

| Key | The phrase | Replaced with |
|---|---|---|
| `dream-team-angola` | "the tournament's most quoted number", plus an unsourced anecdote about Angola's players asking for photographs that appears in none of the named sources | the margin, stated plainly |
| `willis-reed-1970` | "the most famous game of his life" | what he actually did: four points, and none after the first two baskets |
| `ray-allen-2013` | "The most famous shot of the 2013 Finals" | the mechanism — an offensive rebound |
| `boston-parquet` | "The most famous floor in basketball"; "dead spots visiting teams never got used to" | "Boston's parquet floor"; "dead spots visiting players complained about for decades" |
| `draft-1984-bowie` | "The most second-guessed pick in NBA history" | the sequence: a centre at No. 2, a year after drafting Drexler |
| `skiles-30-assists` | "a player most fans could not name" | the record it broke (Kevin Porter's 29, 1978) |
| `first-three-pointer` | "a formality nobody wanted" | "adopted as a one-year experiment", which is what the league actually did |
| `philippines-obsession` | "the most popular sport in the country by a distance"; the `feature` "Every barangay" asserted as a census fact | the improvised backboards, which the source photographs |
| `biasone-arithmetic` | "it is still the number the professional game runs on" | "the professional game has used it ever since" |
| `chuck-taylor` | "a man who was never a star" | what he was: a semi-professional player hired to sell shoes |

---

## 5. The validation layer

`nba_peak/nba_facts/validation.py`, called from `editorial._build` and therefore
from `load_editorial`, so **the build stops**. Failures are re-raised as
`EditorialFactError`, the type `scripts/build_nba_facts.py` already catches. The
checks run **after** the existing structural gate, so an unfinished entry still
reports "has no category" rather than a complaint about a sentence that was
never going to ship.

### 5.1 Required metadata (new on all 91 entries)

| Field | Rule | Why |
|---|---|---|
| `source_url` | Non-empty; parses as an absolute `http`/`https` URL with a resolvable host; no whitespace; not a placeholder host | `source_detail` is prose and prose cannot be dereferenced. "NBA.com and Naismith Basketball Hall of Fame accounts…" names two institutions and points at nothing. |
| `checked_on` | Exact `YYYY-MM-DD`, a real calendar date, year ≥ 2000 | A citation with no date cannot go stale, which is the problem rather than the solution. **Never compared against today** — the build is offline and deterministic, and a gate that fails as the calendar moves would make the bank a function of when it was built. |
| `claim_type` | One of `event`, `record`, `rule`, `attribution`, `context` | Makes the superlative rule enforceable. The value describes the **strongest claim** in the entry, not its subject matter. |

### 5.2 Banned phrases

Matching is case-insensitive; word gaps accept whitespace, non-breaking space or
any dash (so `the first ever` catches "the first-ever"); the right edge allows
only the `-est` and `-s` inflections, so `never` cannot reach "nevertheless",
`the most` cannot reach "the mostly white shoe" — which is the NBA's own 1984
uniform rule and is in this bank — and a stem like `record` could not reach
"recorded". Every failure names the entry key, the literal text that matched, the
reason and the fix.

**Family 1 — subjective (banned in every claim type, `record` included).** The
test is: could two well-informed readers disagree without either being wrong
about anything? `greatest`, `best ever`, `best known`, `most famous`, `most
beautiful`, `most impressive`, `most quoted`, `arguably`, `undoubtedly`,
`unquestionably`, `iconic`, `legendary`, `incredible`, `amazing`, `insane`,
`ridiculous`, `unbelievable`, `perhaps the`, `some say`, `many believe`, `widely
considered`, `widely regarded`, `overrated`, `underrated`, `should have won`,
`snubbed`.

**Family 2 — superlatives (permitted only in `claim_type: record`).** The point
is not to delete superlatives; half of what makes a fact worth reading is that
it is the first or the only one. The point is that a superlative is a claim with
a **bound**, and a bound is exactly what quietly goes wrong. `the only`, `only
one`, `first ever`, `more than any`, `never`, `always`, `no one else`, `nobody
else`, `no other`, `still the`, `the most`, `the largest`, `the longest`, `the
highest`, `the youngest`, `the biggest`, `the fewest`, `the shortest`, `the
tallest`, `of all time`.

**Family 3 — hedges (banned everywhere).** Each is the author saying they did not
check, and the fix is never to delete the hedge and keep the sentence:
`reportedly`, `supposedly`, `it is said`, `rumored`, `rumoured`, `allegedly`,
`some sources`, `believed to be`, `purportedly`, `apparently`.

**Family 4 — PEAK3 model voice (banned everywhere).** This panel is general
basketball trivia and never a model claim — the rule is stated in
`apps/web/src/components/home/NbaFactOfTheDay.tsx`'s own docstring. `peak3`,
`peak score`, `prime score`, `prime index`, `arena points`, `the model says`,
`the model gives`, `the model rates`, `peak window`.

### 5.3 What the claim types came out as

`event` 37, `record` 33, `rule` 8, `context` 8, `attribution` 5.

Thirty-three `record` entries out of ninety-one is high, and it is the honest
number: every one of them makes a first/most/only/longest claim whose bound had
to be established. Where a superlative was decoration on a fact that was really
about an event or a rule, the decoration was cut instead — that is most of §4.3.

### 5.4 Tests

`tests/test_nba_facts_validation.py`, 138 cases:

* every banned phrase in every family rejects a synthetic entry, and the
  superlative family is checked against **every** non-`record` claim type;
* every superlative is *accepted* under `claim_type: record`;
* a clean synthetic entry passes, and every claim type in the vocabulary passes;
* `source_url`, `checked_on` and `claim_type` each hard-fail across a table of
  realistic wrong values (a citation string, `ftp://`, a bare domain, two URLs
  in one field, `2026/08/07`, `2026-02-30`, `RECORD`), each asserting the entry
  key and the field name appear in the message;
* hyphen, em-dash and case variants are caught; ordinary English containing a
  banned stem is not;
* `load_editorial` refuses an invalid entry as `EditorialFactError`, and
  structural failures are still reported ahead of language failures;
* **the validator runs over the real committed `editorial_facts.json` and
  asserts zero violations**, reporting every failure rather than the first;
* every committed entry carries the new metadata, asserted independently of the
  validator so a refactor that dropped the field is caught;
* every entry whose prose uses a superlative is declared `record`, asserted as a
  positive statement over the file;
* the false EuroLeague/NBA comparison is absent — matched on the **shape of the
  claim**, not the key, with a companion test proving the pattern does match the
  original sentence.

One interaction worth recording: an early draft of the model-voice remediation
text spelled the column names this repository computes, and
`test_no_fact_depends_on_a_judgment_this_repository_computes` caught it. That
test reads ordinary string literals as well as code, correctly, and it is now
also a guard on this module.

---

## 6. Perishability register

Facts whose truth can be ended by a future event. Where a rewrite could convert a
live standing into a completed result, it did — that is strictly better than an
expiry, because the fact never has to be withdrawn.

| Key | Handling |
|---|---|
| `ginobili-57` | **New `valid_until: 2027-04-30`.** The 1999 draft's sole Hall of Famer is a standing, and Andrei Kirilenko was a 2026 international-committee nominee. Expires before the 2027 class is announced. |
| `curry-unanimous-mvp` | Converted to a completed result ("In 2016 … became the NBA's first unanimous MVP"). No expiry needed. |
| `wilson-four-mvps` | Converted to a completed count plus the players she passed. No expiry needed. |
| `taurasi-record` | Converted to what she held **at retirement**. No expiry needed. |
| `chuck-taylor` | The drifting "108 years later" arithmetic removed entirely. |
| `wnba-attendance-2024` | Keeps `valid_until: 2027-06-30`; the superseded crowd record is now stated in the past tense with the date it fell. |
| `comets-four-straight` | Left as is. The earliest a new four-peat could complete is 2029. |
| `international-players-2025-26` | `valid_until: 2026-10-15` — **69 days out**, and correctly placed: the NBA publishes the next count on opening night in late October. |
| The nine other `current_nba` entries | All carry `valid_until: 2027-06-30`, unchanged. |

---

## 7. What could not be verified, and other limits

* **`euroleaguebasketball.net` blocks automated fetches** (HTTP 403/429). The
  EuroLeague's own milestones page was found in search results but could not be
  opened to confirm, so `source_url` points at Wikipedia's all-time title table,
  which is itself sourced to EuroLeague Basketball and *was* readable. The
  counts (Real Madrid 11, CSKA 8, Panathinaikos 7) were confirmed there.
* **`wembanyama-unanimous-dpoy`**: ESPN says Wembanyama led the NBA in blocks
  for a *second* straight season; AP and NBA.com say a *third*. The entry follows
  AP/NBA.com, which matches total blocks (254 / 176 / 197); ESPN's variant is
  explained by the 58-game qualification threshold he missed in 2024-25 at 46
  games. Recorded in `source_detail` rather than resolved.
* **`flagg-roy-2026`**: the four-category rookie claim is only checkable back to
  **1973-74**, when steals were first recorded. The published sources state the
  scope; the entry now records it in `source_detail`.
* **`biasone-arithmetic`**: the Naismith Hall of Fame and Le Moyne College's
  archive co-credit Nationals general manager **Leo Ferris** with the 2,880 ÷
  120 calculation. The entry still credits Biasone, with the dispute noted.
* **URL liveness is not machine-checked.** Every `source_url` was probed once
  during this audit and none returned 404. Several hosts (ESPN, Olympics.com,
  Washington Post, EuroLeague) answer bots with 202/403/429/timeouts, so a
  link-checker in CI would be a flaky test rather than a guard, and none was
  added. The validator checks that the URL is *well-formed and dereferenceable
  in principle*; whether the page still says what it said is what `checked_on`
  is for.
* **Wikipedia is `source_url` for 16 entries.** In each case it was chosen
  because the primary source is paywalled, bot-blocked, or is a database whose
  stable page is the Wikipedia summary; `source_detail` names the underlying
  record in every one.

---

## 8. Verification

```
$ python scripts/build_nba_facts.py
wrote 187 facts to data/web/nba_facts.v1.json
  candidates 758, rejected 571

$ python -m pytest tests/test_nba_facts.py tests/test_nba_facts_deployment.py \
                   tests/test_nba_facts_validation.py
240 passed
```

Bank size is unchanged at **187** (floor: 180). No existing assertion or gate was
weakened.
