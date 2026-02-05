"""Tests for alert logic."""
import pytest


class AlertChecker:
    """Simple alert checker for testing."""

    def __init__(self, targets: dict, notifications: dict):
        self.targets = targets
        self.notifications = notifications

    def check_temperature(self, temp: float) -> dict | None:
        """Check if temperature is out of range."""
        if not self.notifications.get("alert_temp_out_of_range", True):
            return None

        min_temp = self.targets.get("temp_day_min", 18)
        max_temp = self.targets.get("temp_day_max", 30)

        if temp < min_temp:
            return {
                "type": "temp_out_of_range",
                "severity": "warning",
                "message": f"Temperature {temp}°C is below minimum ({min_temp}°C)"
            }
        elif temp > max_temp:
            return {
                "type": "temp_out_of_range",
                "severity": "warning" if temp <= max_temp + 5 else "critical",
                "message": f"Temperature {temp}°C is above maximum ({max_temp}°C)"
            }
        return None

    def check_humidity(self, humidity: float) -> dict | None:
        """Check if humidity is out of range."""
        if not self.notifications.get("alert_humidity_out_of_range", True):
            return None

        min_hum = self.targets.get("humidity_day_min", 40)
        max_hum = self.targets.get("humidity_day_max", 70)

        if humidity < min_hum:
            return {
                "type": "humidity_out_of_range",
                "severity": "warning",
                "message": f"Humidity {humidity}% is below minimum ({min_hum}%)"
            }
        elif humidity > max_hum:
            return {
                "type": "humidity_out_of_range",
                "severity": "warning",
                "message": f"Humidity {humidity}% is above maximum ({max_hum}%)"
            }
        return None

    def check_leak(self, leak_detected: bool) -> dict | None:
        """Check for water leak."""
        if not self.notifications.get("alert_leak_detected", True):
            return None

        if leak_detected:
            return {
                "type": "leak_detected",
                "severity": "critical",
                "message": "Water leak detected!"
            }
        return None

    def check_reservoir(self, level: float) -> dict | None:
        """Check reservoir level."""
        if not self.notifications.get("alert_reservoir_low", True):
            return None

        if level < 20:
            return {
                "type": "reservoir_low",
                "severity": "warning" if level >= 10 else "critical",
                "message": f"Reservoir level low ({level}%)"
            }
        return None


class TestTemperatureAlerts:
    """Test temperature alert logic."""

    def setup_method(self):
        """Set up test fixtures."""
        self.targets = {
            "temp_day_min": 22,
            "temp_day_max": 28
        }
        self.notifications = {"alert_temp_out_of_range": True}
        self.checker = AlertChecker(self.targets, self.notifications)

    def test_temp_in_range(self):
        """Test no alert when temperature is in range."""
        assert self.checker.check_temperature(25) is None
        assert self.checker.check_temperature(22) is None
        assert self.checker.check_temperature(28) is None

    def test_temp_too_low(self):
        """Test alert when temperature is too low."""
        alert = self.checker.check_temperature(18)
        assert alert is not None
        assert alert["type"] == "temp_out_of_range"
        assert alert["severity"] == "warning"

    def test_temp_too_high(self):
        """Test alert when temperature is too high."""
        alert = self.checker.check_temperature(32)
        assert alert is not None
        assert alert["type"] == "temp_out_of_range"

    def test_temp_critical(self):
        """Test critical alert for extreme temperature."""
        alert = self.checker.check_temperature(38)
        assert alert is not None
        assert alert["severity"] == "critical"

    def test_temp_alerts_disabled(self):
        """Test no alert when notifications disabled."""
        checker = AlertChecker(self.targets, {"alert_temp_out_of_range": False})
        assert checker.check_temperature(38) is None


class TestHumidityAlerts:
    """Test humidity alert logic."""

    def setup_method(self):
        """Set up test fixtures."""
        self.targets = {
            "humidity_day_min": 50,
            "humidity_day_max": 70
        }
        self.notifications = {"alert_humidity_out_of_range": True}
        self.checker = AlertChecker(self.targets, self.notifications)

    def test_humidity_in_range(self):
        """Test no alert when humidity is in range."""
        assert self.checker.check_humidity(60) is None
        assert self.checker.check_humidity(50) is None
        assert self.checker.check_humidity(70) is None

    def test_humidity_too_low(self):
        """Test alert when humidity is too low."""
        alert = self.checker.check_humidity(35)
        assert alert is not None
        assert alert["type"] == "humidity_out_of_range"

    def test_humidity_too_high(self):
        """Test alert when humidity is too high."""
        alert = self.checker.check_humidity(85)
        assert alert is not None
        assert alert["type"] == "humidity_out_of_range"


class TestLeakAlerts:
    """Test leak detection alerts."""

    def setup_method(self):
        """Set up test fixtures."""
        self.checker = AlertChecker({}, {"alert_leak_detected": True})

    def test_no_leak(self):
        """Test no alert when no leak."""
        assert self.checker.check_leak(False) is None

    def test_leak_detected(self):
        """Test critical alert when leak detected."""
        alert = self.checker.check_leak(True)
        assert alert is not None
        assert alert["type"] == "leak_detected"
        assert alert["severity"] == "critical"

    def test_leak_alerts_disabled(self):
        """Test no alert when leak notifications disabled."""
        checker = AlertChecker({}, {"alert_leak_detected": False})
        assert checker.check_leak(True) is None


class TestReservoirAlerts:
    """Test reservoir level alerts."""

    def setup_method(self):
        """Set up test fixtures."""
        self.checker = AlertChecker({}, {"alert_reservoir_low": True})

    def test_reservoir_ok(self):
        """Test no alert when reservoir level is OK."""
        assert self.checker.check_reservoir(50) is None
        assert self.checker.check_reservoir(20) is None

    def test_reservoir_low(self):
        """Test warning when reservoir is low."""
        alert = self.checker.check_reservoir(15)
        assert alert is not None
        assert alert["type"] == "reservoir_low"
        assert alert["severity"] == "warning"

    def test_reservoir_critical(self):
        """Test critical when reservoir is very low."""
        alert = self.checker.check_reservoir(5)
        assert alert is not None
        assert alert["severity"] == "critical"
