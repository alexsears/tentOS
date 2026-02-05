"""Tests for VPD calculation and environment scoring."""
import pytest
import sys
sys.path.insert(0, '../backend')

from state_manager import calculate_vpd, calculate_environment_score


class TestVPDCalculation:
    """Test VPD calculation accuracy."""

    def test_vpd_normal_conditions(self):
        """Test VPD at typical grow conditions."""
        # 25°C, 60% RH should give ~1.0 kPa VPD
        vpd = calculate_vpd(25, 60)
        assert 0.9 <= vpd <= 1.1

    def test_vpd_high_humidity(self):
        """Test VPD with high humidity."""
        # 25°C, 80% RH should give low VPD
        vpd = calculate_vpd(25, 80)
        assert vpd < 0.7

    def test_vpd_low_humidity(self):
        """Test VPD with low humidity."""
        # 25°C, 40% RH should give high VPD
        vpd = calculate_vpd(25, 40)
        assert vpd > 1.5

    def test_vpd_cold_temperature(self):
        """Test VPD at lower temperature."""
        # 18°C, 60% RH
        vpd = calculate_vpd(18, 60)
        assert 0.5 <= vpd <= 0.9

    def test_vpd_hot_temperature(self):
        """Test VPD at higher temperature."""
        # 30°C, 60% RH
        vpd = calculate_vpd(30, 60)
        assert vpd > 1.2

    def test_vpd_invalid_humidity(self):
        """Test VPD with invalid humidity returns 0."""
        assert calculate_vpd(25, 0) == 0.0
        assert calculate_vpd(25, -10) == 0.0
        assert calculate_vpd(25, 101) == 0.0

    def test_vpd_precision(self):
        """Test VPD returns 2 decimal places."""
        vpd = calculate_vpd(25, 55)
        assert vpd == round(vpd, 2)


class TestEnvironmentScore:
    """Test environment scoring logic."""

    def test_perfect_conditions(self):
        """Test score with perfect conditions."""
        state = {"temperature": 25, "humidity": 60, "vpd": 1.0}
        targets = {
            "temp_day_min": 22,
            "temp_day_max": 28,
            "humidity_day_min": 50,
            "humidity_day_max": 70
        }
        score = calculate_environment_score(state, targets)
        assert score >= 90

    def test_temp_out_of_range(self):
        """Test score with temperature out of range."""
        state = {"temperature": 35, "humidity": 60, "vpd": 1.0}
        targets = {
            "temp_day_min": 22,
            "temp_day_max": 28,
            "humidity_day_min": 50,
            "humidity_day_max": 70
        }
        score = calculate_environment_score(state, targets)
        assert score < 80

    def test_humidity_out_of_range(self):
        """Test score with humidity out of range."""
        state = {"temperature": 25, "humidity": 30, "vpd": 1.5}
        targets = {
            "temp_day_min": 22,
            "temp_day_max": 28,
            "humidity_day_min": 50,
            "humidity_day_max": 70
        }
        score = calculate_environment_score(state, targets)
        assert score < 80

    def test_no_data(self):
        """Test score with no sensor data."""
        score = calculate_environment_score({}, {})
        assert score == 0

    def test_partial_data(self):
        """Test score with partial sensor data."""
        state = {"temperature": 25}
        targets = {"temp_day_min": 22, "temp_day_max": 28}
        score = calculate_environment_score(state, targets)
        assert score > 0


class TestVPDRanges:
    """Test VPD falls within expected ranges for different conditions."""

    @pytest.mark.parametrize("temp,humidity,expected_min,expected_max", [
        (20, 70, 0.3, 0.6),   # Seedling conditions
        (24, 60, 0.7, 1.1),   # Veg conditions
        (26, 55, 1.0, 1.4),   # Late veg
        (28, 50, 1.3, 1.8),   # Flower
    ])
    def test_vpd_ranges(self, temp, humidity, expected_min, expected_max):
        """Test VPD falls within expected range for given conditions."""
        vpd = calculate_vpd(temp, humidity)
        assert expected_min <= vpd <= expected_max, f"VPD {vpd} not in range [{expected_min}, {expected_max}]"
