"""Tests for schedule logic."""
import pytest
from datetime import datetime, time


def parse_schedule_time(time_str: str) -> time:
    """Parse a schedule time string like '06:00' to a time object."""
    if not time_str:
        return None
    parts = time_str.split(":")
    return time(int(parts[0]), int(parts[1]))


def is_light_period(current_time: time, on_time: time, off_time: time) -> bool:
    """Determine if lights should be on based on schedule."""
    if on_time is None or off_time is None:
        return True  # Default to on if no schedule

    if on_time < off_time:
        # Normal schedule (e.g., 06:00 - 22:00)
        return on_time <= current_time < off_time
    else:
        # Overnight schedule (e.g., 22:00 - 06:00)
        return current_time >= on_time or current_time < off_time


class TestScheduleParsing:
    """Test schedule time parsing."""

    def test_parse_valid_time(self):
        """Test parsing valid time strings."""
        assert parse_schedule_time("06:00") == time(6, 0)
        assert parse_schedule_time("22:30") == time(22, 30)
        assert parse_schedule_time("00:00") == time(0, 0)
        assert parse_schedule_time("23:59") == time(23, 59)

    def test_parse_empty_time(self):
        """Test parsing empty time string."""
        assert parse_schedule_time("") is None
        assert parse_schedule_time(None) is None


class TestLightSchedule:
    """Test light schedule logic."""

    def test_normal_schedule_during_day(self):
        """Test 18/6 schedule during light period."""
        on = time(6, 0)
        off = time(0, 0)  # Midnight

        assert is_light_period(time(12, 0), on, off) is True
        assert is_light_period(time(6, 0), on, off) is True
        assert is_light_period(time(23, 59), on, off) is True

    def test_normal_schedule_during_night(self):
        """Test 18/6 schedule during dark period."""
        on = time(6, 0)
        off = time(0, 0)

        assert is_light_period(time(0, 0), on, off) is False
        assert is_light_period(time(3, 0), on, off) is False
        assert is_light_period(time(5, 59), on, off) is False

    def test_12_12_schedule(self):
        """Test 12/12 flowering schedule."""
        on = time(6, 0)
        off = time(18, 0)

        assert is_light_period(time(12, 0), on, off) is True
        assert is_light_period(time(6, 0), on, off) is True
        assert is_light_period(time(17, 59), on, off) is True
        assert is_light_period(time(18, 0), on, off) is False
        assert is_light_period(time(0, 0), on, off) is False

    def test_overnight_schedule(self):
        """Test overnight light schedule (lights on at night)."""
        on = time(18, 0)
        off = time(12, 0)

        assert is_light_period(time(20, 0), on, off) is True
        assert is_light_period(time(0, 0), on, off) is True
        assert is_light_period(time(6, 0), on, off) is True
        assert is_light_period(time(11, 59), on, off) is True
        assert is_light_period(time(12, 0), on, off) is False
        assert is_light_period(time(15, 0), on, off) is False

    def test_no_schedule(self):
        """Test behavior with no schedule set."""
        assert is_light_period(time(12, 0), None, None) is True
        assert is_light_period(time(0, 0), None, None) is True


class TestQuietHours:
    """Test quiet hours logic."""

    def is_quiet_hours(self, current: time, start: time, end: time) -> bool:
        """Check if current time is within quiet hours."""
        if start is None or end is None:
            return False

        if start < end:
            return start <= current < end
        else:
            return current >= start or current < end

    def test_quiet_hours_overnight(self):
        """Test quiet hours spanning midnight."""
        start = time(22, 0)
        end = time(7, 0)

        assert self.is_quiet_hours(time(23, 0), start, end) is True
        assert self.is_quiet_hours(time(3, 0), start, end) is True
        assert self.is_quiet_hours(time(12, 0), start, end) is False
        assert self.is_quiet_hours(time(21, 0), start, end) is False

    def test_quiet_hours_daytime(self):
        """Test quiet hours during day (unusual but valid)."""
        start = time(12, 0)
        end = time(14, 0)

        assert self.is_quiet_hours(time(13, 0), start, end) is True
        assert self.is_quiet_hours(time(11, 0), start, end) is False
        assert self.is_quiet_hours(time(15, 0), start, end) is False
