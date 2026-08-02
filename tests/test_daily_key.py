"""The shared daily reset boundary, proved at the places it can go wrong.

Every globally-shared PEAK3 daily mode -- RUN THE TABLE Daily, Daily Grid, Peak
Duel Daily, Peak Draft Daily, PEAK Season Daily -- resolves "today" through
`nba_peak.daily_key`. This file is where the boundary itself is pinned:

  * midnight America/Los_Angeles, not midnight UTC (they are 7-8 hours apart,
    and the old UTC boundary fired at 17:00 PT -- mid-afternoon, the hour of
    maximum idle-tab prevalence);
  * an IANA zone, never a fixed offset, so the spring-forward day is genuinely
    23 hours long and the fall-back day genuinely 25;
  * one minute either side of the boundary, on both an ordinary day and the two
    DST days;
  * leap day and the year boundary, because "add one to the date string" is the
    shortcut that breaks on exactly those two dates.

The four `today_utc_date()` helpers these replaced all read the clock
internally, so none of this was testable before -- which is the reason the bug
survived four implementations.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from nba_peak.daily_key import (
    DAILY_TIMEZONE,
    DAILY_TZ,
    InvalidDailyKey,
    daily_key,
    daily_window,
    day_start_utc,
    parse_daily_key,
    seconds_until_next_daily,
    validate_daily_key,
)

# US DST transitions in 2026: forward Sunday 8 March, back Sunday 1 November.
SPRING_FORWARD = "2026-03-08"
FALL_BACK = "2026-11-01"

HOUR = 3600


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


class TestZone:
    def test_the_zone_is_the_iana_name_not_an_offset(self):
        assert DAILY_TIMEZONE == "America/Los_Angeles"
        # A fixed -08:00 would silently move the reset to 1am local for the
        # eight months of the year the zone is on daylight time.
        assert DAILY_TZ.utcoffset(datetime(2026, 1, 15)) == timedelta(hours=-8)
        assert DAILY_TZ.utcoffset(datetime(2026, 7, 15)) == timedelta(hours=-7)


class TestOrdinaryBoundary:
    """One minute before and after midnight PT, on a plain summer day."""

    def test_one_minute_before_midnight_is_still_yesterdays_board(self):
        # 2026-07-31 23:59 PDT == 2026-08-01 06:59 UTC
        assert daily_key(utc(2026, 8, 1, 6, 59)) == "2026-07-31"

    def test_midnight_pt_rolls_the_board_over(self):
        assert daily_key(utc(2026, 8, 1, 7, 0)) == "2026-08-01"

    def test_one_minute_after_midnight_is_the_new_board(self):
        assert daily_key(utc(2026, 8, 1, 7, 1)) == "2026-08-01"

    def test_midnight_utc_is_not_a_rollover(self):
        """The regression this whole module exists for: 00:00 UTC is 17:00 the
        previous afternoon in California, and used to swap the board out from
        under everyone mid-session."""
        assert daily_key(utc(2026, 8, 1, 0, 0)) == "2026-07-31"

    def test_winter_boundary_is_eight_hours_behind_utc(self):
        assert daily_key(utc(2026, 1, 15, 7, 59)) == "2026-01-14"
        assert daily_key(utc(2026, 1, 15, 8, 0)) == "2026-01-15"

    def test_a_naive_reference_instant_is_read_as_utc(self):
        """Never as container-local time: the API runs wherever it is deployed,
        and reading that zone would reintroduce the disagreement."""
        assert daily_key(datetime(2026, 8, 1, 6, 59)) == "2026-07-31"

    def test_a_non_utc_aware_instant_is_normalised(self):
        tokyo = timezone(timedelta(hours=9))
        assert daily_key(datetime(2026, 8, 1, 15, 59, tzinfo=tokyo)) == "2026-07-31"


class TestDaylightSavingWindows:
    """DST is the point here, not an edge case."""

    def test_spring_forward_day_is_twenty_three_hours(self):
        window = daily_window(SPRING_FORWARD, now=day_start_utc(parse_daily_key(SPRING_FORWARD)))
        assert (window.ends_at - window.starts_at) == timedelta(hours=23)

    def test_fall_back_day_is_twenty_five_hours(self):
        window = daily_window(FALL_BACK, now=day_start_utc(parse_daily_key(FALL_BACK)))
        assert (window.ends_at - window.starts_at) == timedelta(hours=25)

    def test_an_ordinary_day_is_twenty_four_hours(self):
        window = daily_window("2026-07-15")
        assert (window.ends_at - window.starts_at) == timedelta(hours=24)

    def test_the_spring_forward_boundary_still_lands_on_local_midnight(self):
        # 2026-03-08 00:00 PST == 08:00 UTC; the clocks jump at 02:00 local,
        # so the day OPENS at UTC-8 and CLOSES at UTC-7.
        assert daily_key(utc(2026, 3, 8, 7, 59)) == "2026-03-07"
        assert daily_key(utc(2026, 3, 8, 8, 0)) == "2026-03-08"
        assert daily_key(utc(2026, 3, 9, 6, 59)) == "2026-03-08"
        assert daily_key(utc(2026, 3, 9, 7, 0)) == "2026-03-09"

    def test_the_fall_back_boundary_still_lands_on_local_midnight(self):
        # 2026-11-01 00:00 PDT == 07:00 UTC; closes 2026-11-02 00:00 PST == 08:00 UTC.
        assert daily_key(utc(2026, 11, 1, 6, 59)) == "2026-10-31"
        assert daily_key(utc(2026, 11, 1, 7, 0)) == "2026-11-01"
        assert daily_key(utc(2026, 11, 2, 7, 59)) == "2026-11-01"
        assert daily_key(utc(2026, 11, 2, 8, 0)) == "2026-11-02"

    def test_the_repeated_local_hour_belongs_to_one_day_only(self):
        """01:30 PT happens twice on the fall-back day. Both instants are the
        1st -- an ambiguous local time must never produce two different keys."""
        first = daily_key(utc(2026, 11, 1, 8, 30))   # 01:30 PDT
        second = daily_key(utc(2026, 11, 1, 9, 30))  # 01:30 PST
        assert first == second == "2026-11-01"


class TestCalendarEdges:
    def test_leap_day(self):
        # 2028 is the next leap year.
        assert daily_key(utc(2028, 2, 29, 7, 59)) == "2028-02-28"
        assert daily_key(utc(2028, 2, 29, 8, 0)) == "2028-02-29"
        assert daily_key(utc(2028, 3, 1, 7, 59)) == "2028-02-29"
        assert daily_key(utc(2028, 3, 1, 8, 0)) == "2028-03-01"

    def test_the_day_after_leap_day_in_a_non_leap_year_is_march(self):
        assert daily_key(utc(2027, 3, 1, 8, 0)) == "2027-03-01"
        window = daily_window("2027-02-28")
        assert window.ends_at == day_start_utc(parse_daily_key("2027-03-01"))

    def test_year_boundary(self):
        # 2026-12-31 23:59 PST == 2027-01-01 07:59 UTC
        assert daily_key(utc(2027, 1, 1, 7, 59)) == "2026-12-31"
        assert daily_key(utc(2027, 1, 1, 8, 0)) == "2027-01-01"

    def test_the_last_window_of_the_year_closes_on_new_years_day(self):
        window = daily_window("2026-12-31")
        assert window.ends_at == utc(2027, 1, 1, 8, 0)


class TestWindowPayload:
    def test_the_payload_is_exactly_the_frozen_contract(self):
        window = daily_window("2026-08-01", now=utc(2026, 8, 1, 7, 0))
        assert window.to_payload() == {
            "daily_key": "2026-08-01",
            "timezone": "America/Los_Angeles",
            "starts_at": "2026-08-01T07:00:00Z",
            "ends_at": "2026-08-02T07:00:00Z",
            "seconds_remaining": 24 * HOUR,
        }

    def test_seconds_remaining_counts_down_to_the_boundary(self):
        window = daily_window(now=utc(2026, 8, 2, 6, 59))
        assert window.daily_key == "2026-08-01"
        assert window.seconds_remaining == 60

    def test_an_archive_window_reports_zero_rather_than_a_negative_countdown(self):
        window = daily_window("2026-01-01", now=utc(2026, 8, 1, 12, 0))
        assert window.seconds_remaining == 0

    def test_seconds_until_next_daily_matches_the_window(self):
        now = utc(2026, 8, 1, 12, 0)
        assert seconds_until_next_daily(now) == daily_window(now=now).seconds_remaining

    def test_the_countdown_spans_twenty_three_hours_on_the_spring_forward_day(self):
        start = day_start_utc(parse_daily_key(SPRING_FORWARD))
        assert seconds_until_next_daily(start) == 23 * HOUR

    def test_the_countdown_spans_twenty_five_hours_on_the_fall_back_day(self):
        start = day_start_utc(parse_daily_key(FALL_BACK))
        assert seconds_until_next_daily(start) == 25 * HOUR


class TestValidation:
    NOW = utc(2026, 8, 1, 18, 0)  # 11:00 PDT on 2026-08-01

    def test_today_is_accepted(self):
        assert validate_daily_key("2026-08-01", now=self.NOW) == "2026-08-01"

    def test_a_past_date_inside_the_archive_is_accepted(self):
        assert validate_daily_key("2025-09-09", now=self.NOW) == "2025-09-09"

    def test_a_future_date_is_refused(self):
        with pytest.raises(InvalidDailyKey, match="future"):
            validate_daily_key("2026-08-02", now=self.NOW)

    def test_tomorrow_is_refused_even_one_minute_before_the_rollover(self):
        """A client an hour ahead of Pacific must not be able to open the next
        board early just by asking for its date."""
        one_minute_before = utc(2026, 8, 2, 6, 59)
        with pytest.raises(InvalidDailyKey, match="future"):
            validate_daily_key("2026-08-02", now=one_minute_before)
        assert validate_daily_key("2026-08-02", now=utc(2026, 8, 2, 7, 0)) == "2026-08-02"

    def test_the_archive_window_bound_is_inclusive(self):
        oldest = (self.NOW - timedelta(days=366)).astimezone(DAILY_TZ).strftime("%Y-%m-%d")
        assert validate_daily_key(oldest, now=self.NOW) == oldest
        too_old = (self.NOW - timedelta(days=368)).astimezone(DAILY_TZ).strftime("%Y-%m-%d")
        with pytest.raises(InvalidDailyKey, match="366"):
            validate_daily_key(too_old, now=self.NOW)

    def test_a_wider_archive_window_can_be_requested(self):
        """Daily Grid keeps every past board addressable; the bound is a
        parameter, not a second implementation."""
        assert (
            validate_daily_key("2010-01-01", now=self.NOW, max_age_days=36_525)
            == "2010-01-01"
        )

    @pytest.mark.parametrize(
        "bad",
        ["", "not-a-date", "2026-13-01", "2026-02-30", "08-01-2026", "2026/08/01", None, 20260801],
    )
    def test_malformed_keys_are_refused(self, bad):
        with pytest.raises(InvalidDailyKey):
            validate_daily_key(bad, now=self.NOW)

    def test_an_impossible_leap_day_is_refused(self):
        with pytest.raises(InvalidDailyKey):
            parse_daily_key("2027-02-29")

    def test_allow_future_opts_in_deliberately(self):
        assert (
            validate_daily_key("2026-08-02", now=self.NOW, allow_future=True)
            == "2026-08-02"
        )


class TestAgreementAcrossModes:
    """The five modes must resolve one key, not five."""

    REFERENCE = utc(2026, 11, 1, 8, 30)  # inside the repeated local hour

    def test_every_mode_helper_returns_the_shared_key(self):
        from nba_peak.daily_grid.generator import today_utc_date as grid_today
        from nba_peak.perfect_season.daily import today_utc_date as season_today
        from nba_peak.run_the_table.daily import today_utc_date as rtt_today

        expected = daily_key(self.REFERENCE)
        assert grid_today(self.REFERENCE) == expected
        assert season_today(self.REFERENCE) == expected
        assert rtt_today(self.REFERENCE) == expected

    def test_every_mode_validator_agrees_on_the_future(self):
        from nba_peak.daily_grid.generator import validate_grid_request_date
        from nba_peak.perfect_season.daily import validate_challenge_date
        from nba_peak.run_the_table.daily import validate_run_date

        tomorrow = "2026-11-02"
        for validate in (
            lambda: validate_grid_request_date(tomorrow, now=self.REFERENCE),
            lambda: validate_challenge_date(tomorrow, now=self.REFERENCE),
            lambda: validate_run_date(tomorrow, self.REFERENCE),
        ):
            with pytest.raises(InvalidDailyKey):
                validate()
