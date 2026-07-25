"""Tests for the light cycle scheduler helpers."""
import pytest
import sys
sys.path.insert(0, '../backend')

from light_scheduler import (
    PHOTOPERIOD_BOUNDS,
    PHOTOPERIOD_PRESETS,
    compute_off_time,
    desired_light_state,
    duration_hours_from_times,
    format_hhmm,
    parse_hhmm,
    validate_light_cycle,
)


class TestTimeParsing:
    """Test HH:MM parsing and formatting."""

    def test_parse_valid(self):
        assert parse_hhmm("06:00") == 360
        assert parse_hhmm("00:00") == 0
        assert parse_hhmm("23:59") == 23 * 60 + 59
        assert parse_hhmm("06:00:00") == 360  # tolerates seconds

    def test_parse_invalid(self):
        for bad in ["", None, "6", "24:00", "12:60", "ab:cd"]:
            with pytest.raises(ValueError):
                parse_hhmm(bad)

    def test_format(self):
        assert format_hhmm(0) == "00:00"
        assert format_hhmm(360) == "06:00"
        assert format_hhmm(24 * 60) == "00:00"  # wraps
        assert format_hhmm(25 * 60 + 30) == "01:30"


class TestOffTimeComputation:
    """Test off-time computation from on-time + photoperiod."""

    def test_veg_18_6(self):
        assert compute_off_time("06:00", 18) == "00:00"

    def test_flower_12_12(self):
        assert compute_off_time("06:00", 12) == "18:00"

    def test_wraps_midnight(self):
        assert compute_off_time("20:00", 12) == "08:00"

    def test_half_hours(self):
        assert compute_off_time("06:00", 12.5) == "18:30"

    def test_24h(self):
        assert compute_off_time("06:00", 24) == "06:00"


class TestDurationFromTimes:
    """Test duration = (off - on) mod 24h, equal times = 24h (never 0)."""

    def test_simple(self):
        assert duration_hours_from_times("06:00", "18:00") == 12
        assert duration_hours_from_times("06:00", "00:00") == 18

    def test_wraps_midnight(self):
        assert duration_hours_from_times("20:00", "14:00") == 18
        assert duration_hours_from_times("18:00", "06:00") == 12

    def test_equal_times_is_24h(self):
        assert duration_hours_from_times("06:00", "06:00") == 24
        assert duration_hours_from_times("00:00", "00:00") == 24

    def test_quarter_hours(self):
        assert duration_hours_from_times("06:00", "18:15") == 12.25
        assert duration_hours_from_times("06:30", "18:00") == 11.5

    def test_roundtrip_with_compute_off_time(self):
        for on, hours in [("06:00", 18), ("20:00", 18), ("06:00", 12.25), ("00:00", 24)]:
            off = compute_off_time(on, hours)
            assert duration_hours_from_times(on, off) == hours


class TestValidation:
    """Test per-mode photoperiod bounds: veg 12-24h, flower 6-12h."""

    def test_veg_bounds(self):
        validate_light_cycle("veg", 12)
        validate_light_cycle("veg", 18)
        validate_light_cycle("veg", 24)
        with pytest.raises(ValueError):
            validate_light_cycle("veg", 11.5)
        with pytest.raises(ValueError):
            validate_light_cycle("veg", 24.5)

    def test_flower_bounds(self):
        validate_light_cycle("flower", 6)
        validate_light_cycle("flower", 12)
        with pytest.raises(ValueError):
            validate_light_cycle("flower", 12.5)
        with pytest.raises(ValueError):
            validate_light_cycle("flower", 5)

    def test_invalid_mode(self):
        with pytest.raises(ValueError):
            validate_light_cycle("seedling", 18)

    def test_presets_within_bounds(self):
        for mode, hours in PHOTOPERIOD_PRESETS.items():
            lo, hi = PHOTOPERIOD_BOUNDS[mode]
            assert lo <= hours <= hi


class TestDesiredState:
    """Test desired light state at a given time of day."""

    def test_veg_18_6_on_at_6am(self):
        # On 06:00 for 18h -> off at 00:00
        assert desired_light_state(6 * 60, "06:00", 18) is True
        assert desired_light_state(12 * 60, "06:00", 18) is True
        assert desired_light_state(23 * 60 + 59, "06:00", 18) is True
        assert desired_light_state(0, "06:00", 18) is False
        assert desired_light_state(3 * 60, "06:00", 18) is False
        assert desired_light_state(5 * 60 + 59, "06:00", 18) is False

    def test_flower_12_12(self):
        # On 06:00 for 12h -> off at 18:00
        assert desired_light_state(6 * 60, "06:00", 12) is True
        assert desired_light_state(17 * 60 + 59, "06:00", 12) is True
        assert desired_light_state(18 * 60, "06:00", 12) is False
        assert desired_light_state(0, "06:00", 12) is False

    def test_overnight_cycle(self):
        # Lights on overnight: on 18:00 for 12h -> off at 06:00
        assert desired_light_state(20 * 60, "18:00", 12) is True
        assert desired_light_state(0, "18:00", 12) is True
        assert desired_light_state(5 * 60 + 59, "18:00", 12) is True
        assert desired_light_state(6 * 60, "18:00", 12) is False
        assert desired_light_state(12 * 60, "18:00", 12) is False

    def test_24h_always_on(self):
        for minute in (0, 6 * 60, 12 * 60, 23 * 60):
            assert desired_light_state(minute, "06:00", 24) is True

    def test_zero_hours_always_off(self):
        for minute in (0, 6 * 60, 12 * 60):
            assert desired_light_state(minute, "06:00", 0) is False

    def test_half_hour_boundary(self):
        # On 06:00 for 12.5h -> off at 18:30
        assert desired_light_state(18 * 60 + 29, "06:00", 12.5) is True
        assert desired_light_state(18 * 60 + 30, "06:00", 12.5) is False
