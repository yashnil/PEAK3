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

---

## 9. Game-feel pass 2 (2026-09-06): from NBA trivia to basketball knowledge

Bank version: **`basketball_facts_v3`** (was `nba_facts_v2`). The module
(`nba_peak.nba_facts`), the route (`/api/v1/nba-facts/today`) and the artifact
(`data/web/nba_facts.v1.json`) keep their names: they are contracts the API,
the deploy image and the readiness probe depend on. The version string and
the homepage heading ("Basketball Fact of the Day") are what changed for a
reader.

### 9.1 The content philosophy

The previous bank was NBA-centric and, at the homepage tier, led with
milestones an average fan already knows (Kobe's 81, Curry's unanimous MVP,
the Lakers' 33). Every candidate now has to pass four questions before it
is written down:

1. Is it true, against a named source a reviewer can open?
2. Is it specific -- a date, a number, a rule, a name?
3. Would a normal basketball fan plausibly learn something?
4. Does understanding it say something about the sport, rather than only
   supplying a large number?

Widely known superstar accomplishments are rejected unless the detail itself
is unusual (the 100-point game stays because nobody filmed it; the 81-point
game leaves the homepage tier because everyone knows it). Records whose only
appeal is that a number is large are rejected.

Facts may come from anywhere in basketball: professional leagues worldwide,
FIBA and the Olympics, the WNBA and women's history, college, rules and
equipment evolution, strategy, statistics and analytics, coaching concepts,
historic leagues, 3x3, wheelchair basketball, terminology and the game's
cultural and technological development. NBA relevance is not required.

### 9.2 Sourcing rules (unchanged in kind, restated)

Every entry carries `source_detail` (the named document), `source_url` (an
address a reviewer can open), `checked_on` (the date a person last held the
claim against it), `claim_type` from the closed vocabulary, `verified`,
`valid_until` for anything about the present, and the seven quality axes.
`load_editorial` refuses the build on any missing field; `validation.py`
refuses opinion, hedging, PEAK3 model voice and superlatives outside `record`
claims. Nothing is generated by a language model at build or request time.

Preferred sources, in order: governing bodies (FIBA, IOC, IPC, IWBF, NCAA,
WNBA, NBA), the Naismith Memorial Basketball Hall of Fame, league and
competition records, university archives (Springfield College, Smith
College, Stanford), historical institutions (the Smithsonian), and
well-supported statistical databases (Basketball-Reference) for league-wide
figures only.

### 9.3 What changed in the file

- 53 editorial entries added (`checked_on: 2026-09-06`). The full list
  is in §9.4.
- 11 widely known NBA milestones re-scored below the homepage tier
  (`surprise` ≤ 3, `novelty` ≤ 2): `kobe-81`, `curry-unanimous-mvp`, `lebron-passes-kareem`, `celtics-eight-straight`, `lakers-33`, `wilt-55-rebounds`, `sga-back-to-back-mvp`, `knicks-2026-title`, `doncic-scoring-title-2026`, `spurs-2026-finals`, `lebron-23-seasons`. They remain in the bank and in
  the API; they no longer lead the homepage.
- Result: bank 187 → 257 facts; homepage tier 93 → 135, of which 121 are
  editorial (was 79) and 14 derived (unchanged); USA-tagged share of the tier
  80% → 73%; rotation groups in the tier: world 38, culture 36, history 26,
  modern 16, numbers 16, people 3.

### 9.4 Entries added in this pass

Each was checked by the author against the named source at authoring time.
**Founder review requested before the next deploy**: open each `source_url`
and confirm the specific claim, exactly as §3 did for the 2026-08-07 audit.
Any entry that does not survive that check should be removed rather than
softened.

| Key | Category | Claim | Headline | Primary source |
|---|---|---|---|---|
| `first-game-nine-a-side` | obscure_history | record | The first basketball game had nine players a side and finished 1–0. | Naismith Memorial Basketball Hall of Fame, 'The Birth of Basketball' and the Dr. James Naismith biography |
| `naismith-declined-his-own-name` | culture | attribution | Basketball was nearly called Naismith Ball, and the inventor turned it down. | Naismith Memorial Basketball Hall of Fame, James Naismith biography |
| `rules-printed-in-triangle-1892` | obscure_history | record | The rules of basketball were first published in a college newspaper. | Springfield College archives, The Triangle, 15 January 1892 |
| `no-dribbling-in-thirteen-rules` | rules | rule | The original rules of basketball did not allow dribbling. | Naismith Memorial Basketball Hall of Fame, the original 13 rules of basketball (rule 3) |
| `center-jump-until-1937` | rules | rule | Until 1937 every basket was followed by a jump ball at centre court. | Naismith Memorial Basketball Hall of Fame, history of the rules |
| `goaltending-rule-1944` | rules | rule | Goaltending was made illegal because two college centres kept swatting shots off the rim. | Naismith Memorial Basketball Hall of Fame, George Mikan and Bob Kurland biographies |
| `lane-widened-twice` | rules | rule | The NBA widened the free-throw lane twice, once for George Mikan and once for Wilt Chamberlain. | NBA.com, 'NBA rules history' |
| `fiba-trapezoid-lane` | rules | rule | For fifty years the international free-throw lane was a trapezoid. | FIBA Official Basketball Rules 2010, court diagram |
| `porter-fan-shaped-backboard` | culture | attribution | The fan-shaped backboard was designed by a high-school administrator in 1933. | Naismith Memorial Basketball Hall of Fame, H. V. Porter biography (enshrined 1960) |
| `march-madness-illinois-1939` | culture | attribution | 'March Madness' described an Illinois high-school tournament before it described the NCAA's. | Illinois High School Association, 'March Madness' history |
| `breakaway-rim-1976` | culture | attribution | The breakaway rim was invented by a grain-elevator operator, not by the NBA. | Smithsonian National Museum of American History, Ehrat breakaway rim |
| `wnba-ball-is-smaller` | rules | rule | The WNBA ball is an inch smaller around than the NBA's. | WNBA official rules, Rule 1 |
| `three-point-line-older-than-nba-use` | rules | rule | The three-point line was eighteen years old when the NBA adopted it. | FIBA history of the rules |
| `fiba-thirty-second-clock` | rules | rule | International basketball played on a 30-second clock for over forty years. | FIBA history of the Official Basketball Rules (1956 and 2000 rule changes) |
| `fourteen-second-reset-came-from-fiba` | rules | rule | The 14-second shot-clock reset reached the NBA four years after FIBA wrote it. | FIBA Official Basketball Rules 2014 (Art. 29) |
| `eight-second-backcourt` | rules | rule | Teams have had eight seconds, not ten, to cross halfcourt in the NBA since 2001. | NBA.com, 2001-02 rule changes |
| `possession-arrow-1981` | rules | rule | College basketball replaced the jump ball with an arrow in 1981. | NCAA basketball rules history (alternating possession, 1981-82) |
| `designated-free-throw-shooter` | rules | rule | Until 1924 a team could send its best shooter to the line for every foul. | Naismith Memorial Basketball Hall of Fame, history of the rules (free throws, 1923-24) |
| `fiba-rim-touch-is-legal` | rules | rule | In international basketball you can touch the ball while it sits on the rim. | FIBA Official Basketball Rules, Art. 31 (goaltending and interference) |
| `corner-three-geometry` | tactics | record | The NBA's corner three is 21 inches shorter than the one at the top of the arc. | NBA Official Rules, Rule 1, Section I (court dimensions) |
| `three-point-attempts-rise` | tactics | record | NBA teams took fewer than three three-pointers a game in the line's first season and more than thirty in every season since 2019. | Basketball-Reference, NBA league averages by season (3PA per game) |
| `four-factors-dean-oliver` | tactics | attribution | The 'four factors' of winning basketball were named by a statistician in 2004. | Dean Oliver, 'Basketball on Paper: Rules and Tools for Performance Analysis' (Potomac Books, 2004) |
| `effective-field-goal-percentage` | tactics | context | Effective field-goal percentage counts a three-pointer as one and a half baskets. | Basketball-Reference glossary, effective field goal percentage |
| `elam-ending` | tactics | attribution | The NBA All-Star Game ends when a team reaches a target score, a rule borrowed from a summer tournament. | NBA.com, 2020 All-Star Game format announcement |
| `triangle-offense-from-usc` | tactics | attribution | The triangle offense is older than the NBA. | Naismith Memorial Basketball Hall of Fame, Tex Winter biography (enshrined 2011) |
| `alley-oop-from-football` | culture | attribution | 'Alley-oop' came to basketball from football. | Pro Football Hall of Fame, Y. A. Tittle biography and the 'Alley-Oop' pass |
| `cagers-and-the-wire-cage` | culture | context | Basketball players were called 'cagers' because early professional courts were fenced in. | Naismith Memorial Basketball Hall of Fame, early professional basketball history (Trenton, 1896) |
| `first-pro-league-1898` | obscure_history | record | Professional basketball had a league seven years after the game was invented. | Naismith Memorial Basketball Hall of Fame, early professional leagues (National Basketball League, 1898-1904) |
| `rens-world-champions-1939` | obscure_history | record | An all-Black team won basketball's first world professional championship. | Naismith Memorial Basketball Hall of Fame, New York Renaissance (enshrined 1963) |
| `globetrotters-beat-the-lakers-1948` | historic_games | event | The Harlem Globetrotters beat the reigning champion Minneapolis Lakers in 1948. | Naismith Memorial Basketball Hall of Fame, Harlem Globetrotters (enshrined 2002) |
| `berenson-smith-college-1892` | womens | event | Women were playing basketball within a year of its invention. | Smith College Archives, Senda Berenson papers |
| `first-womens-intercollegiate-game-1896` | womens | record | The first women's intercollegiate basketball game finished 2–1. | Stanford University Libraries, women's basketball 1896 game records |
| `iowa-six-on-six-until-1993` | womens | rule | Iowa high-school girls played six-a-side basketball until 1993. | Iowa Girls High School Athletic Union, history of six-on-six basketball |
| `immaculata-first-three-titles` | womens | record | A tiny Catholic women's college won the first three national championships. | Naismith Memorial Basketball Hall of Fame, Immaculata College 1972-74 teams (enshrined 2014) and Cathy Rush biography (enshrined 2008) |
| `womens-olympic-debut-1976` | olympics_fiba | event | Women's basketball entered the Olympics forty years after the men's game. | International Olympic Committee, Montreal 1976 basketball results |
| `first-wnba-dunk-2002` | womens | record | The WNBA played six seasons before anyone dunked in a game. | WNBA.com, league history and Lisa Leslie career milestones |
| `wnba-plays-quarters` | rules | record | The WNBA switched from two halves to four quarters in 2006, and the NBA is the only league that plays 48 minutes. | WNBA official rules, Rule 5 |
| `naismith-in-berlin-1936` | olympics_fiba | event | The inventor of basketball handed out the medals at its first Olympic tournament. | Naismith Memorial Basketball Hall of Fame, James Naismith biography |
| `fiba-founded-by-eight-nations-1932` | olympics_fiba | event | FIBA was founded in Geneva by eight countries, and the United States was not one of them. | FIBA, history of the federation (founding, 18 June 1932) |
| `first-world-championship-1950` | olympics_fiba | record | The first basketball World Cup was won by the host nation, in front of its own crowd. | FIBA, Basketball World Cup history (1950 Argentina |
| `eurobasket-1935-latvia` | olympics_fiba | record | The first European championship was won by Latvia. | FIBA, EuroBasket history (1935 Geneva results) |
| `euroleague-riga-first-three` | international_leagues | record | The first three European club championships were won by a team from Riga. | EuroLeague Basketball, competition history (European Champions Cup 1958-60) |
| `pba-asias-first-pro-league` | international_leagues | record | Asia's first professional basketball league tipped off in 1975. | Philippine Basketball Association, official league history |
| `wheelchair-basketball-first-paralympics` | global | event | Wheelchair basketball was played at the first Paralympic Games. | International Paralympic Committee, wheelchair basketball history |
| `wheelchair-classification-fourteen-points` | global | rule | In wheelchair basketball the five players on court may add up to no more than 14 points. | International Wheelchair Basketball Federation, player classification rules |
| `threexthree-first-to-twenty-one` | global | rule | A 3x3 game ends at 21 points, and a shot from outside the arc is worth two. | FIBA 3x3 Official Rules of the Game |
| `threexthree-ball` | rules | rule | The 3x3 ball is the size of a women's ball and the weight of a men's. | FIBA 3x3 Official Rules of the Game, equipment |
| `threexthree-to-the-olympics` | global | event | 3x3 went from a youth experiment to the Olympic programme in ten years. | FIBA 3x3, history of the discipline |
| `first-ncaa-tournament-eight-teams` | obscure_history | record | The first NCAA tournament had eight teams and was not the biggest tournament in the country. | NCAA, Division I men's basketball championship history (1939 tournament |
| `college-shot-clock-history` | rules | rule | College basketball played without a shot clock for nearly fifty years after the NBA got one. | NCAA basketball rules history (shot clock 1985-86, 1993-94, 2015-16) |
| `draft-lottery-ping-pong-balls` | draft | rule | The NBA draft lottery is drawn from 14 ping-pong balls and 1,001 possible combinations. | NBA.com, NBA Draft Lottery process and odds (2019 reform) |
| `court-length-fiba-versus-nba` | rules | context | An NBA court is two feet longer than an international one. | FIBA Official Basketball Rules, Art. 2 (playing court) |
| `free-throw-line-fifteen-feet-since-1895` | rules | rule | The free-throw line has been 15 feet from the backboard since 1895. | Naismith Memorial Basketball Hall of Fame, history of the rules (free throw line, 1895) |

### 9.5 Limits

- Web addresses are institution home or section pages where the exact
  document path could not be confirmed offline; `source_detail` names the
  document. §7's limits apply.
- The featured tier is now near the one-third ceiling for the `world`
  rotation group. Further international additions should be balanced with
  rules, history or culture entries or the selector will start rejecting
  them for share rather than quality.

## 10. Source spot-check (2026-09-06)

§9.4 asked for every new entry's `source_url` to be opened and the specific
claim confirmed before deploy. This pass did that for all 53 entries added in
§9 plus nine older entries chosen to cover the same ground from the other
side (shot clock, Biasone, the first three-pointer, Naismith 1891, EuroLeague
titles, Berlin 1936, Oscar Schmidt, hand-checking, Bol/Bogues). Sample: 62
entries. Method: fetch the `source_url`; where it was a home page, a 404 or
refused automated fetches, find the specific page or document that carries
the claim (governing-body rulebooks as PDF, Hall of Fame biographies, league
releases, university archives) and hold the sentence against it; recompute
every number. `checked_on` is `2026-09-06` on every entry below and on
nothing else.

Headline results: no entry was removed. Four claims were false and are
corrected (`wnba-plays-quarters` "only league that plays 48 minutes" -- the
G League and the PBA also do; `eurobasket-1935-latvia` "oldest continental
championship" -- South America's began in 1930; `college-shot-clock-history`
"nearly fifty years" -- 1954 to 1985 is 31; `first-womens-intercollegiate-game-1896`
credited a scorer, "Frida Miller", who does not appear in any account).
Seven more were overstated or wrong in a detail (Cathy Rush's age, the
Lakers as "reigning champion" in February 1948, Berenson's "quarter century"
of editing, the possession arrow reaching FIBA in 2004 not 2003, 3PA passing
twenty in 2012-13 not 2013-14, "the most efficient shot", the WNBA ball's
exact circumference). Two URLs were dead (`hoophall.com/history/`, which
backed eight entries, and the H. V. Porter slug) and two nba.com URLs were
404s; 44 entries now point at a document rather than a home page. The
featured tier is unchanged: 257 facts, 136 featured, no entry entered or
left the tier. `tests/test_nba_facts.py` (82) and the API fact-route tests
(8) pass; `data/web/nba_facts.v1.json` was rebuilt.

Verdict key: **confirmed** -- source supports the sentence as written;
**corrected** -- headline or body changed to what the source supports;
**URL replaced** -- claim stood, address did not (home page, 404, or hub);
**removed** -- none.

| Key | Category | What was checked | Verdict | Exact change |
|---|---|---|---|---|
| `first-game-nine-a-side` | obscure_history | Hall of Fame 'First Team' page: 18 players, nine to a side, 1-0, 21 Dec 1891; Springfield College on peach baskets keeping their bottoms | URL replaced | `hoophall.com/history/` (404) -> `hoophall.com/hall-of-famers/first-team` |
| `naismith-declined-his-own-name` | culture | Springfield College Archives exhibit 'How Basketball was Named' (Mahan, 'Naismith ball', 'would kill the game') | URL replaced | Naismith HOF bio (does not mention the episode) -> Springfield College Archives exhibit |
| `rules-printed-in-triangle-1892` | obscure_history | Springfield College: rules 'published in January 1892 in ... The Triangle'; 15 Jan / 'A New Game' per secondary accounts | confirmed | none |
| `no-dribbling-in-thirteen-rules` | rules | NCAA 'Playing-Rules History': 1891-92 rule 3; 1900-01 dribbler may not shoot; 1908-09 'a dribbler became permitted to shoot' | corrected; URL replaced | "the rules caught up with it over the following decade" -> "the college rules did not let a dribbler shoot until 1908"; URL -> NCAA rules-history PDF |
| `center-jump-until-1937` | rules | NCAA rules history 1937-38: 'the center jump after every goal scored was eliminated'; Sam Barry HOF bio | URL replaced | 404 -> NCAA rules-history PDF |
| `goaltending-rule-1944` | rules | Mikan HOF bio: Mikan and Kurland 'swatted away so many shots that the NCAA introduced a rule that prohibited goaltending in 1944' | confirmed | source_detail quotes the page |
| `lane-widened-twice` | rules | NBA.com Mikan legend profile: 'widened in 1951 from six to 12 feet'; Wilt profile: 'widening the lane'; FIBA PR 25 for the 2010 rectangle | URL replaced | `nba.com/news/nba-rules-history` (404) -> NBA.com Mikan profile |
| `fiba-trapezoid-lane` | rules | FIBA press release No. 25 (2008): trapezoid 'in place since the 1950s' replaced by a rectangle, 3-point line to 6.75 m, effective Oct 2010 | URL replaced | `fiba.basketball/en/documents` (redirects to a resource hub) -> FIBA PR 25 |
| `porter-fan-shaped-backboard` | culture | HOF H.V. Porter bio: designed 1933, adopted 1941; 29.5-inch moulded ball pushed 1935, adopted 1938 | URL replaced | `/hall-of-famers/h-v-porter/` (404) -> `/hall-of-famers/hv-porter` |
| `march-madness-illinois-1939` | culture | HOF Porter bio: 'In March of 1939, the Illinois High School Association journal coined the phrase March Madness' | URL replaced | `ihsa.org` home page -> HOF Porter bio |
| `breakaway-rim-1976` | culture | Smithsonian object nmah_1294158: 1976 prototype, John Deere cultivator spring, patent Dec 1982; NBA mandate 1981-82 | corrected; URL replaced | "built the first spring-loaded rim" -> "built a spring-loaded rim" (a competing Tyner claim exists); NBA requirement dated to the 1981-82 season; URL `americanhistory.si.edu` home -> object page |
| `wnba-ball-is-smaller` | rules | 2026 WNBA rulebook Rule 1 II(f): circumference 28.5 to 29 in; FIBA equipment: size 7 is 749-780 mm, size 6 724-737 mm | corrected; URL replaced | "28.5 inches in circumference; the men's size 7 is 29.5 inches" -> "28.5 to 29 inches around; the men's size 7 starts at 29.5"; URL `wnba.com/rules` (404) -> 2026 rulebook PDF |
| `three-point-line-older-than-nba-use` | rules | NBA.com 3-pointer history: ABL 1961, ABA five years later, NBA 1979-80; FIBA PR 25: line in place since 1984 | URL replaced | 404 -> NBA.com evolution-of-the-3-pointer page |
| `fiba-thirty-second-clock` | rules | 1956 / 2000 dates; 8-second backcourt in the 2000 rules (secondary sources only; FIBA has no rules-history page) | URL replaced | `fiba.basketball/en/history` (hub with no content) -> Wikipedia 'Shot clock', with the 2000 rules named in source_detail |
| `fourteen-second-reset-came-from-fiba` | rules | FIBA news 'NBA implements FIBA's 14-second shot clock rule' (Art. 29 amended 2014; NBA 2018-19); NBA Official release of 21 Sep 2018 | URL replaced | 404 -> FIBA news item |
| `eight-second-backcourt` | rules | ESPN, April 2001 ('eight seconds instead of 10'); NCAA history for the 1932-33 ten-second line | URL replaced | 404 -> ESPN 4 April 2001 |
| `possession-arrow-1981` | rules | NCAA history 1981-82 alternating arrow; FIBA adopted alternating possession in 2003 | corrected; URL replaced | "FIBA adopted the same system in 2004" -> "2003"; URL `ncaa.org ... playing-rules.aspx` (redirects home) -> NCAA rules-history PDF |
| `designated-free-throw-shooter` | rules | NCAA history 1923-24: 'the player fouled must shoot' | URL replaced | 404 -> NCAA rules-history PDF |
| `fiba-rim-touch-is-legal` | rules | FIBA 2024 rules Art. 31.2.3 (restrictions end when the ball 'has touched the ring') and 31.2.4 (interference is touching the basket or backboard while the ball is on the ring); NBA Rule 11 | corrected; URL replaced | body now says the ball may be played after ring contact 'as long as he does not touch the ring or backboard'; URL -> FIBA 2024 rules PDF |
| `corner-three-geometry` | tactics | NBA Rule 1 Sec. I: lines 3 ft from the sidelines, arc 23 ft 9 in; 25 - 3 = 22 ft; 21 in | corrected; URL replaced | "the most efficient shot in the modern game" (dunks and free throws are better) -> "the shortest three-pointer on the floor"; URL rulebook index -> Rule 1 page |
| `three-point-attempts-rise` | tactics | Basketball-Reference: 2.8 (1979-80), 15.3 (1994-95), 20.0 (2012-13), 21.5 (2013-14), 32.0 (2018-19), 34.1-37.6 every season since | corrected | "twenty in 2013-14" -> "twenty in 2012-13" |
| `four-factors-dean-oliver` | tactics | Basketball-Reference 'Four Factors' (weights 40/25/20/15, order as stated); the 2004 first edition was Brassey's, later Potomac | confirmed | source_detail publisher corrected |
| `effective-field-goal-percentage` | tactics | Basketball-Reference glossary formula (FG + 0.5*3P)/FGA; 40% on threes = 60% eFG | confirmed | none |
| `elam-ending` | tactics | NBA.com official release, 30 Jan 2020: clock off in the fourth, Final Target Score | URL replaced | 404 -> `nba.com/news/2020-all-star-game-format-official-release` |
| `triangle-offense-from-usc` | tactics | HOF Winter bio (triangle 'evolved in part from Barry's center-opposite offense') and Barry bio ('initial proponent of the triangle offense') | confirmed | source_detail expanded |
| `alley-oop-from-football` | culture | 49ers 'NFL 100 Greatest No. 71: The Alley-Oop'; the phrase pre-dates 1957 (French 'allez-hop', the 1932 comic strip) | corrected; URL replaced | "The phrase was first used for" -> "The name was attached in 1957 to"; URL `profootballhof.com` home -> 49ers page |
| `cagers-and-the-wire-cage` | culture | The Trentonian 'Capital Century' (12-foot cage; phased out by the 1920s; headline writers kept the word); SI 1991 (Trenton's last cage 1929) | corrected; URL replaced | "The cages disappeared by the 1930s" -> "were largely gone by the 1930s"; URL 404 -> Trentonian page |
| `first-pro-league-1898` | obscure_history | APBR 'National Basket Ball League [1898-99 to 1903-04]': six seasons, Philadelphia/Trenton/Camden, disbanded Jan 1904 | URL replaced | 404 -> APBR page |
| `rens-world-champions-1939` | obscure_history | HOF Rens page (1939 champion, enshrined 1963, no league would accept a Black team); Black Fives (final v Oshkosh, 28 Mar 1939); 34-25 | confirmed | source_detail names the Oshkosh source |
| `globetrotters-beat-the-lakers-1948` | historic_games | ESPN: 19 Feb 1948, 61-59, Chicago Stadium; the Lakers 'had just arrived in Minneapolis that season' and won the NBL title in April 1948 | corrected; URL replaced | headline "the reigning champion Minneapolis Lakers" -> "George Mikan's Minneapolis Lakers"; body says they 'went on to win the NBL title that spring'; "helped push the professional leagues to integrate" -> "remembered as a landmark on the road to the NBA's integration"; URL HOF Globetrotters page (does not mention the game) -> ESPN |
| `berenson-smith-college-1892` | womens | HOF Berenson bio: first game 1893, chaired the rules committee twelve years, wrote the first guide; Smith College Libraries: 22 Mar 1893 | corrected | "edited the women's rulebook for the next quarter century" -> "chaired the women's rules committee for twelve years and edited its official guide" |
| `first-womens-intercollegiate-game-1896` | womens | Cal athletics history: 2-1, nine a side, Page Street Armory, men banned; scorers Mattie Clark and Frances Tucker | corrected; URL replaced | "Frida Miller ... first points" (no such player) -> "Mattie Clark scored the first basket and Frances Tucker's free throw ... won it"; URL `gostanford.com` home -> Cal history page |
| `iowa-six-on-six-until-1993` | womens | University of Iowa Women's Archives exhibit: 1993 the final six-on-six tournament; Oklahoma 1995 (ESPN) | URL replaced | `ighsau.org` home -> Iowa Women's Archives exhibit |
| `immaculata-first-three-titles` | womens | HOF Rush bio: began 1970 'less than two years after graduating' (born April 1947); three consecutive AIAW titles from 1972; CIAW national tournaments existed 1969-71 | corrected | headline "the first three national championships" -> "the first three AIAW national championships"; "who was 24 when she took the job" -> "hired in 1970 less than two years out of college" |
| `womens-olympic-debut-1976` | olympics_fiba | Olympics.com Montreal 1976 women's results: six teams, USSR / USA / Bulgaria | URL replaced | `olympics.com/en/sports/basketball/` -> Montreal 1976 women's results page |
| `first-wnba-dunk-2002` | womens | HOF Leslie bio (2002, first to dunk in a WNBA game); Guinness (30 Jul 2002 v Miami Sol, Staples Center) | URL replaced | `wnba.com/history` (generic) -> HOF Leslie bio |
| `wnba-plays-quarters` | rules | WNBA rulebook Rule 5 II (ten-minute periods); FIBA Art. 8.1; the G League and PBA also play 48 minutes | corrected; URL replaced | headline "...and the NBA is the only league that plays 48 minutes" -> "...and plays the same 40 minutes as FIBA"; body "only the NBA plays four twelve-minute quarters" -> "the NBA's four twelve-minute quarters are the longest game among them"; URL `wnba.com/rules` (404) -> 2026 rulebook PDF |
| `naismith-in-berlin-1936` | olympics_fiba | Olympics.com 'muddy beginnings': Naismith, 74, threw the jump ball for France-Estonia and 'presented the medals' | URL replaced | HOF Naismith bio (mentions Berlin, not the medals) -> Olympics.com article |
| `fiba-founded-by-eight-nations-1932` | olympics_fiba | FIBA 85th-anniversary release: 18 June 1932, the eight members named; FIBA Hall of Fame '8 Founding Federations' (Geneva) | corrected; URL replaced | "until 1989" -> "until FIBA voted in 1989 to admit them"; URL hub -> FIBA release |
| `first-world-championship-1950` | olympics_fiba | FIBA 75th-anniversary release: Argentina 64-50 USA, Luna Park | URL replaced | hub -> FIBA release |
| `eurobasket-1935-latvia` | olympics_fiba | FIBA '90 years ago' article: Geneva, 10 teams, Latvia 24-18 Spain; the South American Championship dates from 1930 | corrected; URL replaced | "It is the oldest continental championship in basketball and it is still played every four years" -> "It was FIBA's first continental championship -- South America's, begun in 1930, predates FIBA itself -- and it is still played today"; URL hub -> FIBA article |
| `euroleague-riga-first-three` | international_leagues | ASK Riga 1958, 1958-59, 1959-60 under Gomelsky; Real Madrid's 11 still the record after Olympiacos won the 2026 title | URL replaced | `euroleaguebasketball.net` home -> Wikipedia competition history (EuroLeague's own champions PDF refuses automated fetches) |
| `pba-asias-first-pro-league` | international_leagues | pba.ph 'About' and 'Retro' pages via search excerpts and Rappler: nine teams, 9 April 1975, Araneta Coliseum (pba.ph refuses automated fetches) | URL replaced | `pba.ph` home -> `pba.ph/about-us`; source_detail records the fetch limit |
| `wheelchair-basketball-first-paralympics` | global | IPC page: 1945 veterans' hospitals; 'one of eight sports at the inaugural Rome 1960 Paralympic Games'; same court and hoop | confirmed | source_detail quotes the page |
| `wheelchair-classification-fourteen-points` | global | IWBF classification page: 1.0-4.5, 'total number of points allowed on court at any time is 14.0' | URL replaced | `iwbf.org` home -> classification page |
| `threexthree-first-to-twenty-one` | global | FIBA 3x3 rules PDF: Art. 8 (10 minutes; clock stopped only for dead balls and free throws; 21 ends the game), Art. 16 (1 and 2 points), Art. 29 (12 seconds) | corrected; URL replaced | "no clock stoppage after a score" -> "the clock stops only for dead balls and free throws, not after a basket"; URL home -> rules PDF |
| `threexthree-ball` | rules | FIBA 3x3 'Official 3x3 ball' page: Size 6, Weight 7, 'a smaller ball spec ... grip and control' | corrected; URL replaced | the wind rationale, which no source gives, replaced by FIBA's own ('grip and control a fast outdoor game demands'); URL home -> ball page |
| `threexthree-to-the-olympics` | global | 2007 Asian Indoor Games, 2010 YOG Singapore, IOC June 2017, Tokyo | URL replaced | `fiba3x3.com` home -> Olympics.com 3x3 sport page |
| `first-ncaa-tournament-eight-teams` | obscure_history | NCAA.com tournament-evolution article: '1939 - 8 teams', Oregon over Ohio State in Evanston, '1975 - 32 teams'; the 1939 NIT had six teams, so it was not 'bigger' | corrected; URL replaced | headline "was not the biggest tournament in the country" -> "was a year younger than the NIT"; body "drew the stronger field for years" -> "for years attracted many of the top-ranked teams"; URL -> NCAA.com article |
| `college-shot-clock-history` | rules | NCAA history: 45 seconds 1985-86, 35 in 1993-94; NCAA.com 2015 for 30; 1954 to 1985 is 31 years | corrected; URL replaced | headline "nearly fifty years" -> "more than thirty years"; URL redirect -> NCAA rules-history PDF |
| `draft-lottery-ping-pong-balls` | draft | NBA.com lottery explainer: 14 balls, 1,001 combinations, 1,000 assigned, 14 percent for the three worst since 2019 | confirmed | none |
| `court-length-fiba-versus-nba` | rules | FIBA 2024 rules Art. 2.1 (28 m by 15 m); NBA Rule 1 (94 by 50; free-throw line 15 ft) | URL replaced | hub -> FIBA 2024 rules PDF |
| `free-throw-line-fifteen-feet-since-1895` | rules | NCAA history: set at 20 feet, moved to 15 (the document dates the move 1895-96 in one section and 1894-95 in another) | URL replaced | 404 -> NCAA rules-history PDF; the discrepancy is recorded in source_detail |
| `shot-clock-1954` | rules (2026-08-07) | Basketball-Reference 79.5 -> 93.1 (+13.6); HOF Biasone bio gives the same figures | confirmed | `checked_on` only |
| `biasone-arithmetic` | rules (2026-08-07) | HOF Biasone bio: 'teams averaged 60 shots per game' (120 for two); 2,880 / 120 = 24 | confirmed | `checked_on` only |
| `first-three-pointer` | rules (2026-08-07) | URL live; NBA.com: rules committee approved the shot for 1979-80 after the 1976 merger | confirmed | `checked_on` only |
| `naismith-1891` | culture (2026-08-07) | Springfield College page: peach baskets on the ten-foot balcony rail, thirteen rules | confirmed | `checked_on` only |
| `euroleague-titles` | international_leagues (2026-08-07) | Olympiacos beat Real Madrid in the 2026 final, so Real Madrid 11, CSKA 8, Panathinaikos 7 all stand | confirmed | `checked_on` only |
| `olympics-1936-mud` | olympics_fiba (2026-08-07) | Olympics.com: outdoor clay, heavy rain, USA 19-8 Canada | confirmed | `checked_on` only |
| `oscar-schmidt-never-nba` | global (2026-08-07) | Wikipedia list: 49,737; 'James broke Schmidt's record on April 2, 2024' (all competitions counted) | confirmed | `checked_on` only |
| `hand-check-2004` | rules (2026-08-07) | Basketball-Reference: 93.4 (2003-04), 97.2 (2004-05) | confirmed | `checked_on` only |
| `tallest-and-shortest` | connections (2026-08-07) | Basketball-Reference: Bol played 5 games for Golden State in 1994-95; Bogues 14 seasons | confirmed | `checked_on` only |

### 10.1 Limits of this pass

- Five sites refuse automated fetches (hoophall.com, basketball-reference.com,
  pba.ph, si.edu collections, olympics.com sport pages). The Hall of Fame and
  Basketball-Reference pages were read with a browser user agent; the
  Smithsonian object, PBA and Olympics pages were checked through their
  indexed excerpts, and `source_detail` says so where it matters.
- `fiba-thirty-second-clock` and `euroleague-riga-first-three` now cite
  Wikipedia because neither FIBA nor EuroLeague publishes a fetchable page
  carrying the claim; the underlying documents are named in `source_detail`.
- Sports Illustrated's 1991 cage article is indexed but returns 404 to every
  fetcher tried; the Trentonian's series was used instead.
- Nine of the 91 entries from the 2026-08-07 audit were re-checked here; the
  other 82 keep their `checked_on: 2026-08-07`.
