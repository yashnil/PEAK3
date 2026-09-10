"""The committed player-reference dataset: is it actually right?

This suite exists because the Daily Grid's basketball-native taxonomy is only
as good as the facts underneath it. A grid square that rejects a correct answer
-- or, worse, accepts a wrong one -- is the single failure mode the whole
design is built to avoid, and "the field is populated" is not evidence the
field is TRUE. So every check here is a named player whose draft slot, height,
birthplace or box-score line is a matter of public record, chosen to cover the
cases that are easy to get wrong:

  * a pre-1989 draft, where the round is not arithmetic on the pick number
  * a genuinely undrafted player vs a pre-merger career with no NBA draft row
  * US territories and foreign-born Americans, where "international" is decided
  * the tallest and shortest players in the window
  * a traded season, where the per-team rows are the real rows
  * the one player-slug collision in 46 seasons

See docs/model/DAILY_GRID_TAXONOMY.md for the definitions being asserted and
data/reference/player_reference_manifest.v1.json for provenance.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

import pandas as pd
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
REFERENCE_DIR = REPO_ROOT / "data" / "reference"
SEASON_BOX_PATH = REFERENCE_DIR / "player_season_box.v1.parquet"
BIO_PATH = REFERENCE_DIR / "player_bio.v1.json"
MANIFEST_PATH = REFERENCE_DIR / "player_reference_manifest.v1.json"


@pytest.fixture(scope="module")
def bio() -> dict:
    return json.loads(BIO_PATH.read_text())["players"]


@pytest.fixture(scope="module")
def box() -> pd.DataFrame:
    return pd.read_parquet(SEASON_BOX_PATH)


# ---------------------------------------------------------------------------
# Artifact integrity
# ---------------------------------------------------------------------------

class TestArtifactIntegrity:
    def test_every_artifact_is_committed(self):
        for path in (SEASON_BOX_PATH, BIO_PATH, MANIFEST_PATH):
            assert path.exists(), f"{path} is a committed input and must be present"

    def test_manifest_checksums_match_the_artifacts(self):
        """The manifest is the provenance record; a stale checksum in it means
        an artifact was edited by something other than its generator."""
        manifest = json.loads(MANIFEST_PATH.read_text())
        for filename, entry in manifest["artifacts"].items():
            digest = hashlib.sha256((REFERENCE_DIR / filename).read_bytes()).hexdigest()
            assert digest == entry["sha256"], f"{filename} does not match its manifest checksum"

    def test_manifest_records_source_and_normalization(self):
        manifest = json.loads(MANIFEST_PATH.read_text())
        assert manifest["sources"], "provenance must name where the data came from"
        for source in manifest["sources"]:
            assert source["url_pattern"].startswith("https://")
            assert source["supplies"]
        for key in ("player_identity", "height", "draft_round", "international", "franchise"):
            assert key in manifest["normalization"], f"{key} normalization rule is undocumented"

    def test_season_rows_are_unique_per_player_season_team(self, box):
        assert not box.duplicated(subset=["bbref_id", "season_end", "team"]).any()

    def test_no_nan_or_inf_in_the_columns_constraints_read(self, box):
        for column in ("g", "pts_pg", "trb_pg", "ast_pg", "stl_pg", "blk_pg", "fg3m"):
            values = pd.to_numeric(box[column], errors="coerce")
            assert values.notna().all(), f"{column} has missing values"
            assert not values.map(lambda v: math.isinf(v)).any(), f"{column} has infinities"

    def test_exactly_one_slug_collision_and_it_resolves_to_peak3s_own_row(self, box):
        """Two different Charles Joneses played for the 1988-89 Bullets.

        That is the ONLY (slug, season, team) collision in the whole window,
        and `slug_primary` has to resolve it to the player PEAK3's own scored
        table carries -- 53 games, not the other one's 43. If a future data
        refresh introduces a second collision this fails, which is the point:
        the resolution rule is documented for one known case, not a general
        licence to guess.
        """
        collisions = box[box.duplicated(subset=["player_slug", "season_end", "team"], keep=False)]
        assert set(collisions["player_slug"]) == {"charles-jones"}
        assert set(collisions["season_end"]) == {1989}

        primary = collisions[collisions["slug_primary"]]
        assert len(primary) == 1
        assert primary.iloc[0]["bbref_id"] == "jonesch01"
        assert int(primary.iloc[0]["g"]) == 53

        # And exactly one primary row per key everywhere else, too.
        chosen = box[box["slug_primary"]]
        assert not chosen.duplicated(subset=["player_slug", "season_end", "team"]).any()


# ---------------------------------------------------------------------------
# Draft: the facts, including the ones arithmetic would get wrong
# ---------------------------------------------------------------------------

class TestDraft:
    @pytest.mark.parametrize(
        "player_id,name,year,round_number,pick",
        [
            # Modern two-round drafts.
            ("jamesle01", "LeBron James", 2003, 1, 1),
            ("jordami01", "Michael Jordan", 1984, 1, 3),
            ("jokicni01", "Nikola Jokic", 2014, 2, 41),
            ("ginobma01", "Manu Ginobili", 1999, 2, 57),
            ("curryst01", "Stephen Curry", 2009, 1, 7),
            ("bryanko01", "Kobe Bryant", 1996, 1, 13),
            # PRE-1989, where the round is NOT the pick number over 30. The
            # 1985 draft ran seven rounds of 23-24 picks and the 1986 draft
            # ran seven of 24, so these two are the whole reason the builder
            # reads the round off the table's own section headers.
            ("webbsp01", "Spud Webb", 1985, 4, 87),
            ("rodmade01", "Dennis Rodman", 1986, 2, 27),
            ("bolma01", "Manute Bol", 1983, 5, 97),
        ],
    )
    def test_draft_slot(self, bio, player_id, name, year, round_number, pick):
        record = bio[player_id]
        assert record["draft_year"] == year, name
        assert record["draft_round"] == round_number, name
        assert record["draft_pick_overall"] == pick, name
        assert record["undrafted"] is False, name

    def test_top_ten_and_second_round_are_mutually_exclusive_in_practice(self, bio):
        jordan, jokic = bio["jordami01"], bio["jokicni01"]
        assert jordan["draft_pick_overall"] <= 10
        assert jordan["draft_round"] != 2
        assert jokic["draft_round"] == 2
        assert jokic["draft_pick_overall"] > 10

    def test_a_genuinely_undrafted_player_is_claimed_as_undrafted(self, bio):
        wallace = bio["wallabe01"]
        assert wallace["name"] == "Ben Wallace"
        assert wallace["undrafted"] is True
        assert wallace["draft_pick_overall"] is None

    def test_a_pre_merger_career_with_no_nba_draft_row_is_unknown_not_undrafted(self, bio):
        """Moses Malone entered through the 1974 ABA draft and the 1976 ABA
        dispersal draft, so no NBA draft page lists him. Calling that
        "undrafted" would be false, and an Undrafted square would then accept
        an answer that is wrong."""
        moses = bio["malonmo01"]
        assert moses["name"] == "Moses Malone"
        assert moses["draft_pick_overall"] is None
        assert moses["undrafted"] is None
        assert moses["career_fully_in_window"] is False


# ---------------------------------------------------------------------------
# Height
# ---------------------------------------------------------------------------

class TestHeight:
    @pytest.mark.parametrize(
        "player_id,name,inches",
        [
            ("muresgh01", "Gheorghe Muresan", 91),   # 7'7"
            ("bolma01", "Manute Bol", 91),           # 7'7"
            ("mingya01", "Yao Ming", 90),            # 7'6"
            ("olajuha01", "Hakeem Olajuwon", 84),    # 7'0"
            ("jordami01", "Michael Jordan", 78),     # 6'6"
            ("paulch01", "Chris Paul", 72),          # 6'0"
            ("boguemu01", "Muggsy Bogues", 63),      # 5'3"
            ("webbsp01", "Spud Webb", 66),           # 5'6"
        ],
    )
    def test_listed_height_in_inches(self, bio, player_id, name, inches):
        assert bio[player_id]["height_in"] == inches, name

    def test_the_seven_foot_line_falls_where_it_should(self, bio):
        assert bio["olajuha01"]["height_in"] >= 84   # Hakeem is exactly 7'0"
        assert bio["duncati01"]["height_in"] < 84    # Duncan is 6'11"


# ---------------------------------------------------------------------------
# International: the definition, exercised on the cases it is chosen for
# ---------------------------------------------------------------------------

class TestInternational:
    @pytest.mark.parametrize(
        "player_id,name,country",
        [
            ("olajuha01", "Hakeem Olajuwon", "NG"),
            ("nowitdi01", "Dirk Nowitzki", "DE"),
            ("jokicni01", "Nikola Jokic", "RS"),
            ("antetgi01", "Giannis Antetokounmpo", "GR"),
            ("embiijo01", "Joel Embiid", "CM"),
            ("mingya01", "Yao Ming", "CN"),
            # US TERRITORIES COUNT, matching the NBA's own roster convention.
            ("duncati01", "Tim Duncan", "VI"),
            # BIRTHPLACE, NOT NATIONALITY: both of these were born abroad to
            # American families and both count under the shipped definition.
            ("ewingpa01", "Patrick Ewing", "JM"),
            ("irvinky01", "Kyrie Irving", "AU"),
            # And birthplace, not the flag he played under: Nash is Canadian
            # basketball's defining figure and was born in Johannesburg.
            ("nashst01", "Steve Nash", "ZA"),
        ],
    )
    def test_foreign_born_players_are_international(self, bio, player_id, name, country):
        record = bio[player_id]
        assert record["birth_country"] == country, name
        assert record["international"] is True, name

    @pytest.mark.parametrize(
        "player_id,name",
        [
            ("jordami01", "Michael Jordan"),
            ("jamesle01", "LeBron James"),
            ("bryanko01", "Kobe Bryant"),
            ("curryst01", "Stephen Curry"),
            # THE OTHER DIRECTION OF THE SAME RULE: born in New York City,
            # played for France. Not international here, on purpose.
            ("noahjo01", "Joakim Noah"),
        ],
    )
    def test_us_born_players_are_not_international(self, bio, player_id, name):
        record = bio[player_id]
        assert record["birth_country"] == "US", name
        assert record["international"] is False, name

    def test_birth_country_is_never_guessed(self, bio):
        """`international` is three-state. A player the source records no
        birthplace for must be None, not False -- False would silently make
        him American."""
        for record in bio.values():
            if record["birth_country"] is None:
                assert record["international"] is None
            else:
                assert record["international"] == (record["birth_country"] != "US")


# ---------------------------------------------------------------------------
# Career journey
# ---------------------------------------------------------------------------

class TestJourney:
    @pytest.mark.parametrize(
        "player_id,name,franchises",
        [
            ("duncati01", "Tim Duncan", 1),
            ("bryanko01", "Kobe Bryant", 1),
            ("curryst01", "Stephen Curry", 1),
            ("nowitdi01", "Dirk Nowitzki", 1),
            ("jordami01", "Michael Jordan", 2),      # Bulls and Wizards
            ("jamesle01", "LeBron James", 3),        # Cavaliers, Heat, Lakers
        ],
    )
    def test_franchise_counts(self, bio, player_id, name, franchises):
        assert bio[player_id]["franchise_count"] == franchises, name

    def test_a_journeyman_clears_the_five_franchise_line(self, bio):
        for player_id in ("thomais02", "boykiea01"):
            assert bio[player_id]["franchise_count"] >= 5, bio[player_id]["name"]

    def test_a_traded_season_credits_both_franchises(self, bio, box):
        """Jimmy Butler played 10 games for Minnesota and 55 for Philadelphia
        in 2018-19. PEAK3's own regular-season parquet stores that as a single
        combined "2TM" row, which is exactly why franchise history is read from
        the reference dataset's per-team rows instead."""
        stints = box[(box["bbref_id"] == "butleji01") & (box["season_end"] == 2019)]
        assert set(stints["team"]) == {"2TM", "MIN", "PHI"}
        assert {"MIN", "PHI"} <= set(bio["butleji01"]["franchises"])

    def test_a_career_that_began_before_the_window_is_flagged(self, bio):
        assert bio["malonmo01"]["career_fully_in_window"] is False   # debuted 1974-75
        assert bio["ervinju01"]["career_fully_in_window"] is False   # ABA from 1971-72
        assert bio["jordami01"]["career_fully_in_window"] is True


# ---------------------------------------------------------------------------
# The per-game box line
# ---------------------------------------------------------------------------

class TestSeasonBox:
    @pytest.mark.parametrize(
        "player_id,season_end,team,ppg,threes",
        [
            # The exactness of the three-point count is the point: it comes
            # from the full-precision per-game sort key times games played, not
            # from multiplying a rounded 5.1.
            ("curryst01", 2016, "GSW", 30.1, 402),
            ("thompkl01", 2019, "GSW", 21.5, 241),
            ("hardeja01", 2019, "HOU", 36.1, 378),
            ("jordami01", 1987, "CHI", 37.1, 12),
        ],
    )
    def test_per_game_line(self, box, player_id, season_end, team, ppg, threes):
        row = box[
            (box["bbref_id"] == player_id)
            & (box["season_end"] == season_end)
            & (box["team"] == team)
        ]
        assert len(row) == 1
        assert round(float(row.iloc[0]["pts_pg"]), 1) == ppg
        assert int(row.iloc[0]["fg3m"]) == threes

    def test_the_window_is_covered_end_to_end(self, box):
        assert int(box["season_end"].min()) == 1980
        assert int(box["season_end"].max()) == 2026
        assert box["season_end"].nunique() == 47
